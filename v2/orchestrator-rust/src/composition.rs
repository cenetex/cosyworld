use super::*;

fn submitted_payload_target_key(path: &str, target: &ActionTargetView) -> Option<&'static str> {
    Some(match (path, target.kind.as_str()) {
        ("/actions/move" | "/actions/flee" | "/actions/explore-path", "location") => {
            "destination_location_id"
        }
        ("/actions/craft", "recipe") => "recipe_id",
        ("/actions/pick-up" | "/actions/drop", "item") => "item_id",
        ("/actions/trade-item" | "/actions/theft", "item") => "target_item_id",
        ("/actions/use-item", "feature") => "location_id",
        (
            "/actions/chat"
            | "/actions/model-interaction"
            | "/actions/attack"
            | "/actions/give-item"
            | "/actions/create-bond"
            | "/actions/resolve-bond"
            | "/actions/cast-spell"
            | "/actions/influence",
            "actor",
        ) => "target_actor_id",
        ("/actions/use-item", "actor") => "target_actor_id",
        _ => return None,
    })
}

fn submitted_payload_target(
    path: &str,
    target: &ActionTargetView,
    payload: &serde_json::Value,
) -> Option<u64> {
    submitted_payload_target_key(path, target)
        .and_then(|key| payload.get(key).and_then(serde_json::Value::as_u64))
}

fn submitted_feature_binding_matches(
    offer: &RankedActionOffer,
    payload: &serde_json::Value,
) -> bool {
    if offer.kind != "use_feature" {
        return true;
    }
    let Some(rest) = offer.id.strip_prefix("use_feature:") else {
        return false;
    };
    let mut parts = rest.splitn(3, ':');
    let (Some(item_id), Some(location_id), Some(feature_key)) =
        (parts.next(), parts.next(), parts.next())
    else {
        return false;
    };
    payload.get("item_id").and_then(serde_json::Value::as_u64) == item_id.parse::<u64>().ok()
        && payload
            .get("location_id")
            .and_then(serde_json::Value::as_u64)
            == location_id.parse::<u64>().ok()
        && payload
            .get("feature_key")
            .and_then(serde_json::Value::as_str)
            == Some(feature_key)
}

fn submitted_discovery_binding_matches(
    offer: &RankedActionOffer,
    payload: &serde_json::Value,
) -> bool {
    let Some(discovery) = offer.discovery.as_ref() else {
        return true;
    };
    payload.get("procedure").and_then(serde_json::Value::as_str)
        == Some(discovery.procedure.as_str())
        && payload.get("slot_id").and_then(serde_json::Value::as_str)
            == Some(discovery.slot_id.as_str())
        && payload
            .get("receipt_id")
            .and_then(serde_json::Value::as_str)
            .is_none_or(|receipt_id| receipt_id == discovery.receipt_id)
}

fn submitted_payload_u64(payload: &serde_json::Value, key: &str) -> Option<u64> {
    payload.get(key).and_then(serde_json::Value::as_u64)
}

fn offer_provider_item_id(offer: &RankedActionOffer) -> Option<u64> {
    offer
        .provider
        .id
        .strip_prefix("item:")
        .and_then(|item_id| item_id.parse().ok())
        .or_else(|| {
            offer
                .source_collectible
                .as_ref()
                .filter(|source| source.kind == "item")
                .map(|source| source.instance_id)
        })
}

fn submitted_stable_offer_payload_matches(
    offer: &RankedActionOffer,
    submission: &ActionOfferSubmissionRequest,
) -> bool {
    let payload = &submission.payload;
    let parts = |prefix| {
        offer
            .id
            .strip_prefix(prefix)
            .map(|rest| rest.split(':').collect::<Vec<_>>())
    };
    match offer.kind.as_str() {
        "give_item" => {
            let Some(parts) = parts("give_item:") else {
                return false;
            };
            let [item_id, target_actor_id] = parts.as_slice() else {
                return false;
            };
            submitted_payload_u64(payload, "item_id") == item_id.parse().ok()
                && submitted_payload_u64(payload, "target_actor_id") == target_actor_id.parse().ok()
        }
        "trade_item" => {
            let Some(parts) = parts("trade_item:") else {
                return false;
            };
            let [item_id, target_actor_id, target_item_id] = parts.as_slice() else {
                return false;
            };
            submitted_payload_u64(payload, "item_id") == item_id.parse().ok()
                && submitted_payload_u64(payload, "target_actor_id") == target_actor_id.parse().ok()
                && submitted_payload_u64(payload, "target_item_id") == target_item_id.parse().ok()
        }
        "use_item"
            if submission.path == "/actions/use-item" && offer.id.starts_with("use_item:") =>
        {
            submitted_payload_u64(payload, "item_id") == offer_provider_item_id(offer)
        }
        "cast_spell" if submission.path == "/actions/cast-spell" => {
            submitted_payload_u64(payload, "item_id") == offer_provider_item_id(offer)
        }
        _ => true,
    }
}

fn submitted_offer_legacy_id(submission: &ActionOfferSubmissionRequest) -> Option<&str> {
    let mut parts = submission.offer_id.splitn(3, ':');
    parts.next()?;
    parts.next()?.parse::<u64>().ok()?;
    parts.next()
}

fn submitted_offer_state_revision(submission: &ActionOfferSubmissionRequest) -> Option<u64> {
    let mut parts = submission.offer_id.splitn(3, ':');
    parts.next()?;
    parts.next()?.parse().ok()
}

fn action_offer_kind_requires_actor_target(kind: &str) -> bool {
    matches!(
        kind,
        "chat"
            | "model_interaction"
            | "influence"
            | "attack"
            | "defend"
            | "give_item"
            | "create_bond"
            | "resolve_bond"
    )
}

fn offer_composition_matches_at_submitted_revision(
    offer: &RankedActionOffer,
    submission: &ActionOfferSubmissionRequest,
) -> bool {
    let Some(submitted_revision) = submitted_offer_state_revision(submission) else {
        return false;
    };
    if offer.state_revision <= submitted_revision {
        return false;
    }
    // Unrelated world events advance every offer envelope. Rebind only that
    // volatile revision so the certificate still detects real scene changes.
    let mut trace = offer.composition_trace.clone();
    trace.state_revision = submitted_revision;
    if let Some(rules_context) = trace.rules_context.as_mut() {
        rules_context.state_revision = submitted_revision;
    }
    trace.certificate() == submission.composition_id
}

impl RuntimeWorld {
    pub(super) fn current_state_revision(&self) -> u64 {
        self.world.next_event_seq.saturating_sub(1)
    }

    fn submitted_pickup_exchange_matches(
        &self,
        actor_id: u64,
        offer: &RankedActionOffer,
        payload: &serde_json::Value,
    ) -> bool {
        if offer.kind != "pick_up" {
            return true;
        }
        let Some(incoming_item_id) = offer
            .target
            .as_ref()
            .filter(|target| target.kind == "item")
            .and_then(|target| target.id)
        else {
            return false;
        };
        let Ok(expected_exchange_item_id) =
            self.deterministic_pickup_exchange_item(actor_id, incoming_item_id)
        else {
            return false;
        };
        match expected_exchange_item_id {
            Some(expected) => submitted_payload_u64(payload, "target_item_id") == Some(expected),
            None => {
                submitted_payload_u64(payload, "target_item_id").is_none_or(|item_id| item_id == 0)
            }
        }
    }

    #[cfg(test)]
    pub(super) fn validate_action_offer_submission(
        &self,
        actor_id: u64,
        access: &AccessContext,
        submission: &ActionOfferSubmissionRequest,
    ) -> Result<(), &'static str> {
        self.validate_action_offer_submission_with_presence(
            actor_id, access, submission, None, None,
        )
    }

    pub(super) fn validate_action_offer_submission_with_presence(
        &self,
        actor_id: u64,
        access: &AccessContext,
        submission: &ActionOfferSubmissionRequest,
        active_direct_actor_ids: Option<&BTreeSet<u64>>,
        model_config: Option<&AiConfig>,
    ) -> Result<(), &'static str> {
        let (mut primary_action, mut offers) = self.legal_action_candidates_with_presence(
            Some(actor_id),
            access,
            active_direct_actor_ids,
        );
        retain_configured_model_interaction_offers(&mut primary_action, &mut offers, model_config);
        let exact_offer = offers
            .iter()
            .find(|offer| offer.offer_id == submission.offer_id);
        let stable_offer = exact_offer.or_else(|| {
            let legacy_id = submitted_offer_legacy_id(submission)?;
            offers
                .iter()
                .find(|offer| offer.id == legacy_id && offer.kind == submission.kind)
        });
        let Some(offer) = stable_offer else {
            return Err("that offer expired; refresh the scene and submit a current offer_id");
        };
        let hand = self.action_hand_for(Some(actor_id), &offers);
        if !hand
            .entries
            .iter()
            .any(|entry| entry.offer_id == offer.offer_id)
        {
            return Err("that offer is not in the current two-card hand");
        }
        let revision_rebound = exact_offer.is_none()
            && offer_composition_matches_at_submitted_revision(offer, submission);
        if !revision_rebound
            && (exact_offer.is_none() || offer.composition_id != submission.composition_id)
        {
            Err("the scene composition changed; refresh and choose a current action")
        } else if offer.kind != submission.kind || offer.disabled {
            Err("offer identity, rules binding, target, cost, or availability was changed")
        } else if (!submission.rules_profile.is_empty()
            || submission.state_revision != 0
            || submission.rules_action.is_some()
            || submission.operation.is_some()
            || submission.route.is_some()
            || submission.target.is_some()
            || submission.cost.is_some())
            && (offer.rules_action != submission.rules_action
                || offer.operation != submission.operation
                || offer.rules_profile != submission.rules_profile
                || (offer.state_revision != submission.state_revision && !revision_rebound)
                || offer.route != submission.route
                || offer.target != submission.target
                || offer.cost != submission.cost)
        {
            // Older clients echoed this expanded identity. Accept it only when
            // every field still matches, while current clients submit the
            // opaque offer/composition certificates and action payload alone.
            Err("offer identity, rules binding, target, cost, or availability was changed")
        } else if offer.target.as_ref().is_some_and(|target| {
            target.id.is_some_and(|expected| {
                submitted_payload_target_key(&submission.path, target).is_some()
                    && submitted_payload_target(&submission.path, target, &submission.payload)
                        != Some(expected)
            })
        }) {
            Err("submitted payload target does not match the authoritative offer")
        } else if submission.path == "/actions/pick-up"
            && !self.submitted_pickup_exchange_matches(actor_id, offer, &submission.payload)
        {
            Err("submitted pickup exchange does not match the authoritative offer")
        } else if !submitted_feature_binding_matches(offer, &submission.payload) {
            Err("submitted feature binding does not match the authoritative offer")
        } else if !submitted_discovery_binding_matches(offer, &submission.payload) {
            Err("submitted discovery binding does not match the authoritative offer")
        } else if !submitted_stable_offer_payload_matches(offer, submission) {
            Err("submitted payload does not match the authoritative offer binding")
        } else if matches!(
            submission.path.as_str(),
            "/actions/contribute"
                | "/actions/work"
                | "/actions/help"
                | "/actions/study"
                | "/actions/prepare"
        ) && offer.project.as_ref().is_some_and(|project| {
            submission
                .payload
                .get("job_id")
                .and_then(serde_json::Value::as_str)
                != Some(project.id.as_str())
                || submission
                    .payload
                    .get("strategy_id")
                    .and_then(serde_json::Value::as_str)
                    != project.strategy_id.as_deref()
        }) {
            Err("submitted contribution does not match the authoritative quest strategy")
        } else {
            Ok(())
        }
    }

    pub(super) fn contextual_action_contributions(
        &self,
        actor_id: u64,
        rules_action: &str,
    ) -> (Option<String>, Vec<String>, Vec<String>) {
        let Some(location_id) = self.actor_by_id(actor_id).map(|actor| actor.location_id) else {
            return (None, Vec::new(), Vec::new());
        };
        let mut reskins = active_content()
            .contributions
            .iter()
            .flat_map(|bundle| bundle.reskins.iter())
            .filter(|reskin| {
                reskin.based_on == rules_action
                    && reskin.scope.kind == "location"
                    && reskin.scope.id == location_id
            })
            .collect::<Vec<_>>();
        let mut offers = active_content()
            .contributions
            .iter()
            .flat_map(|bundle| bundle.offers.iter())
            .filter(|offer| {
                offer.based_on == rules_action
                    && offer.subject.kind == "location"
                    && offer.subject.id == location_id
                    && self.contextual_cooperation_available(actor_id, offer)
            })
            .collect::<Vec<_>>();
        reskins.sort_by(|left, right| left.id.cmp(&right.id));
        offers.sort_by(|left, right| left.id.cmp(&right.id));
        let label = reskins
            .first()
            .map(|reskin| reskin.label.clone())
            .or_else(|| offers.first().map(|offer| offer.label.clone()));
        (
            label,
            reskins
                .into_iter()
                .map(|reskin| reskin.id.clone())
                .collect(),
            offers.into_iter().map(|offer| offer.id.clone()).collect(),
        )
    }

    pub(super) fn practice_recognition_for_offer(
        &self,
        actor_id: u64,
        kind: &str,
    ) -> Option<String> {
        let practice = self.actor_practice_view(actor_id)?;
        let recognized_category = std::iter::once(practice.primary.as_str())
            .chain(practice.secondary.as_deref())
            .find(|category| practice_category_matches_offer(category, kind))?;
        let evidence = practice
            .evidence
            .iter()
            .find(|evidence| evidence.category == recognized_category)?;
        Some(format!(
            "Known for {}; recent evidence: {}",
            practice.known_for,
            evidence.description.trim_end_matches('.')
        ))
    }

    pub(super) fn legal_action_candidates(
        &self,
        actor_id: Option<u64>,
        access: &AccessContext,
    ) -> (PrimaryAction, Vec<RankedActionOffer>) {
        self.legal_action_candidates_with_presence(actor_id, access, None)
    }

    pub(super) fn legal_action_candidates_with_presence(
        &self,
        actor_id: Option<u64>,
        access: &AccessContext,
        active_direct_actor_ids: Option<&BTreeSet<u64>>,
    ) -> (PrimaryAction, Vec<RankedActionOffer>) {
        let mut primary_action = self.primary_action(actor_id, access);
        let mut action_offers =
            self.ranked_action_offers(actor_id, access, &primary_action, active_direct_actor_ids);
        action_offers.retain(|offer| {
            if action_offer_kind_requires_actor_target(&offer.kind)
                && !offer
                    .target
                    .as_ref()
                    .is_some_and(|target| target.kind == "actor" && target.id.is_some())
            {
                return false;
            }
            let Some(target) = offer
                .target
                .as_ref()
                .filter(|target| target.kind == "actor")
            else {
                return true;
            };
            target
                .id
                .and_then(|target_actor_id| self.actor_by_id(target_actor_id))
                .is_some_and(|target_actor| {
                    self.actor_target_visible_in_projection(
                        target_actor,
                        actor_id,
                        active_direct_actor_ids,
                    )
                })
        });

        primary_action.options.retain_mut(|option| {
            let Some(offer) = action_offers.iter().find(|offer| offer.kind == option.kind) else {
                return false;
            };
            if option.kind == "create_bond" {
                option.command = offer.command.clone();
            }
            true
        });
        let primary_offer_kind = match primary_action.kind.as_str() {
            "travel" => "move",
            kind => kind,
        };
        let selected_offer = action_offers
            .iter()
            .find(|offer| offer.kind == primary_offer_kind)
            .or_else(|| action_offers.first());
        if let Some(offer) = selected_offer {
            if offer.kind != primary_offer_kind {
                primary_action.kind = match offer.kind.as_str() {
                    "move" => "travel",
                    kind => kind,
                }
                .to_string();
                primary_action.label = offer.verb.clone();
                primary_action.disabled = offer.disabled;
            }
            primary_action.command = offer.command.clone();
        } else if !primary_action.disabled {
            primary_action = PrimaryAction {
                kind: "wait".to_string(),
                label: "Wait".to_string(),
                command: "wait".to_string(),
                disabled: true,
                options: Vec::new(),
            };
        }
        for offer in &mut action_offers {
            offer.composition_trace.focused_encounter = actor_id
                .and_then(|actor_id| focused_encounter_offer_context(self, actor_id, &offer.kind));
            offer.composition_id = offer.composition_trace.certificate();
        }
        (primary_action, action_offers)
    }

    pub(super) fn ranked_action_offers(
        &self,
        actor_id: Option<u64>,
        access: &AccessContext,
        primary_action: &PrimaryAction,
        active_direct_actor_ids: Option<&BTreeSet<u64>>,
    ) -> Vec<RankedActionOffer> {
        let Some(actor_id) = actor_id else {
            return vec![self.ranked_offer_from_parts(
                "create_avatar",
                "Create Avatar",
                "create avatar",
                0,
                false,
                None,
                None,
                None,
                None,
                Some("Creates a new avatar at the cottage threshold.".to_string()),
                None,
                "no_active_avatar",
            )];
        };
        // Knockout preserves the canonical actor but permits observation only.
        // Terminal actors may begin again; downed actors receive no mutation
        // offer while another participant can still rescue them.
        if self
            .actor_by_id(actor_id)
            .is_some_and(|actor| Self::actor_is_present(actor) && !Self::actor_can_act(actor))
        {
            return Vec::new();
        }
        if self
            .actor_by_id(actor_id)
            .is_some_and(|actor| !Self::actor_is_present(actor) && !Self::actor_can_act(actor))
        {
            return vec![self.ranked_offer_from_parts(
                "create_avatar",
                "Create Avatar",
                "create avatar",
                0,
                false,
                None,
                None,
                None,
                None,
                Some("Creates a new avatar at the cottage threshold.".to_string()),
                None,
                "no_active_avatar",
            )];
        }
        let actor_location_id = self.actor_by_id(actor_id).map(|actor| actor.location_id);
        let zone = actor_location_id
            .map(|location_id| {
                self.room_sheets
                    .get(&location_id)
                    .map(|sheet| room_sheet_zone(sheet).to_string())
                    .unwrap_or_else(|| default_zone_for_scope("room", location_id).to_string())
            })
            .unwrap_or_else(default_zone);
        let options: Vec<ActionOption> = if primary_action.options.is_empty() {
            vec![ActionOption {
                kind: primary_action.kind.clone(),
                label: primary_action.label.clone(),
                command: primary_action.command.clone(),
            }]
        } else {
            primary_action
                .options
                .iter()
                .map(|option| ActionOption {
                    kind: option.kind.clone(),
                    label: option.label.clone(),
                    command: option.command.clone(),
                })
                .collect()
        };
        let mut offers: Vec<_> = options
            .into_iter()
            .map(|option| {
                let binding = resolved_action_binding(&option.kind).unwrap_or_else(|| {
                    panic!(
                        "validated action offer kind has no rules binding: {}",
                        option.kind
                    )
                });
                let (authored_label, applied_reskins, contextual_offers) = binding
                    .rules_action
                    .as_deref()
                    .map(|action_id| self.contextual_action_contributions(actor_id, action_id))
                    .unwrap_or_default();
                let rank = self.action_offer_rank_for_actor(&option.kind, actor_id);
                let target = self.action_offer_target(
                    &option.kind,
                    actor_id,
                    access,
                    active_direct_actor_ids,
                );
                let command = if option.kind == "create_bond" {
                    target
                        .as_ref()
                        .and_then(|target| target.id.zip(target.label.as_deref()))
                        .map(|(target_id, label)| {
                            let statement = self
                                .relationship_contract(target_id)
                                .map(|relationship| relationship.statement.clone())
                                .unwrap_or_else(|| default_bond_statement(label));
                            format!("bond {label}: {statement}")
                        })
                        .unwrap_or_else(|| option.command.clone())
                } else {
                    option.command.clone()
                };
                let project = self.action_offer_project(&option.kind, &command, actor_id);
                let intention = if option.kind == "model_interaction" {
                    self.model_interaction_offer_profile(actor_id)
                        .map(|profile| profile.intention())
                        .unwrap_or("model_interaction")
                } else {
                    action_offer_intention(&option.kind)
                }
                .to_string();
                let verb = self.action_offer_verb(&option.kind, actor_id);
                let label = self.action_offer_label(
                    &option.kind,
                    &verb,
                    &option.label,
                    target.as_ref(),
                    project.as_ref(),
                );
                let label = authored_label.unwrap_or(label);
                let accessible_label = self.action_offer_accessible_label(
                    &option.kind,
                    &verb,
                    &label,
                    target.as_ref(),
                    project.as_ref(),
                );
                let cost = self.action_offer_cost(&option.kind, actor_id);
                let risk = self.action_offer_risk(&option.kind, actor_id);
                let effect =
                    self.action_offer_effect(&option.kind, actor_id, active_direct_actor_ids);
                let progress = self.action_offer_progress(&option.kind, actor_id);
                let claim_key =
                    self.action_offer_claim_key(&option.kind, actor_id, active_direct_actor_ids);
                let provider = self.action_offer_provider(
                    &option.kind,
                    actor_id,
                    target.as_ref(),
                    project.as_ref(),
                );
                let state_revision = self.current_state_revision();
                let source_collectible =
                    self.action_offer_source_collectible(&option.kind, actor_id);
                let mut source_card_instances =
                    source_collectible.clone().into_iter().collect::<Vec<_>>();
                if let Some(location_source) = self.location_source_collectible(actor_id) {
                    if !source_card_instances
                        .iter()
                        .any(|source| source.card_id == location_source.card_id)
                    {
                        source_card_instances.push(location_source);
                    }
                }
                let legacy_id = format!("{}:{}", option.kind, normalize_command_text(&command));
                let offer_id = format!(
                    "{}:{}:{}",
                    active_content().manifest.rules_profile,
                    state_revision,
                    legacy_id
                );
                let pack_provenance = ActionPackProvenanceView {
                    pack_id: binding.pack_id.clone(),
                    pack_version: binding.pack_version.clone(),
                    rules_namespace: binding.namespace.clone(),
                };
                let composition_trace = self.action_composition_trace(
                    actor_location_id,
                    state_revision,
                    &binding,
                    ActionCompositionContributions {
                        source_card_instances,
                        target: target.clone(),
                        applied_reskins: applied_reskins.clone(),
                        contextual_offers: contextual_offers.clone(),
                    },
                );
                let ranked_hand_eligible =
                    option.kind != "rest" || self.rest_has_recovery_target(actor_id);

                RankedActionOffer {
                    id: legacy_id,
                    offer_id,
                    rules_action: binding.rules_action,
                    operation: binding.operation,
                    rules_profile: active_content().manifest.rules_profile.clone(),
                    resolver: binding.resolver,
                    source_collectible,
                    pack_provenance,
                    composition_trace,
                    composition_id: String::new(),
                    state_revision,
                    route: None,
                    threshold_method: None,
                    discovery: None,
                    category: action_offer_category(&option.kind).to_string(),
                    intention,
                    kind: option.kind,
                    verb,
                    label,
                    accessible_label,

                    command,
                    rank,
                    disabled: primary_action.disabled,
                    disabled_reason: primary_action
                        .disabled
                        .then(|| "primary action is currently unavailable".to_string()),
                    zone: zone.clone(),
                    source: "kernel_flags+rpg_projection".to_string(),
                    provider,
                    target,
                    project,
                    cost,
                    risk,
                    effect,
                    progress,
                    claim_key,
                    reason: "ranked from current room affordances and RPG projection".to_string(),
                    ranked_hand_eligible,
                }
            })
            .collect();
        offers = self.expand_item_action_offers(actor_id, offers);
        offers = self.expand_job_contribution_offers(actor_id, offers);
        offers = self.expand_use_action_offers(actor_id, offers);
        offers = self.expand_transfer_action_offers(actor_id, offers);
        offers = self.expand_route_action_offers(actor_id, access, offers);
        offers.extend(self.threshold_method_action_offers(actor_id, access));
        offers.extend(self.discovery_action_offers(actor_id));
        if let Some(reason) = self.rest_offer_unavailable_reason(actor_id) {
            let mut unavailable = self.ranked_offer_from_parts(
                "rest",
                "Rest",
                "rest",
                action_offer_rank("rest"),
                true,
                Some(reason.clone()),
                None,
                None,
                None,
                Some("requires equipped shelter in the frontier".to_string()),
                None,
                &reason,
            );
            unavailable.zone = zone.clone();
            unavailable.source = "place+equipped_item_capability".to_string();
            unavailable.provider = self.action_offer_provider("rest", actor_id, None, None);
            offers.push(unavailable);
        }
        for target in self.scout_action_offer_targets(actor_id, access) {
            let local_lead = self
                .actionable_local_lead(actor_id)
                .filter(|lead| target.id == Some(lead.destination_location_id))
                .cloned();
            let kind = "explore_path";
            let binding = resolved_action_binding(kind)
                .expect("explore_path must resolve through the SRD search action");
            let intention = action_offer_intention(kind).to_string();
            let verb = self.action_offer_verb(kind, actor_id);
            let label = self.action_offer_label(kind, &verb, "Scout", Some(&target), None);
            let accessible_label =
                self.action_offer_accessible_label(kind, &verb, &label, Some(&target), None);
            let command = format!(
                "scout {}",
                target.label.as_deref().unwrap_or("the journey destination")
            );
            let provider = self.action_offer_provider(kind, actor_id, Some(&target), None);
            let state_revision = self.current_state_revision();
            let source_collectible = self.location_source_collectible(actor_id);
            let source_card_instances = source_collectible.clone().into_iter().collect();
            let legacy_id = local_lead
                .as_ref()
                .map(|lead| local_lead_offer_id(&lead.id))
                .unwrap_or_else(|| {
                    format!("explore_path:{}", target.id.clone().unwrap_or_default())
                });
            let offer_id = format!(
                "{}:{}:{}",
                active_content().manifest.rules_profile,
                state_revision,
                legacy_id
            );
            let pack_provenance = ActionPackProvenanceView {
                pack_id: binding.pack_id.clone(),
                pack_version: binding.pack_version.clone(),
                rules_namespace: binding.namespace.clone(),
            };
            let composition_trace = self.action_composition_trace(
                actor_location_id,
                state_revision,
                &binding,
                ActionCompositionContributions {
                    source_card_instances,
                    target: Some(target.clone()),
                    applied_reskins: Vec::new(),
                    contextual_offers: Vec::new(),
                },
            );
            let route = target.id.and_then(|destination_location_id| {
                self.scout_route_offer_binding(actor_id, destination_location_id)
            });
            offers.push(RankedActionOffer {
                id: legacy_id,
                offer_id,
                kind: kind.to_string(),
                intention,
                rules_action: binding.rules_action,
                operation: binding.operation,
                rules_profile: active_content().manifest.rules_profile.clone(),
                resolver: binding.resolver,
                source_collectible,
                pack_provenance,
                composition_trace,
                composition_id: String::new(),
                state_revision,
                route,
                threshold_method: None,
                discovery: None,
                category: action_offer_category(kind).to_string(),
                verb,
                label,
                accessible_label,
                command,
                rank: action_offer_rank(kind),
                disabled: false,
                disabled_reason: None,
                zone: zone.clone(),
                source: if local_lead.is_some() {
                    "local_lead+exit_projection".to_string()
                } else {
                    "journey+exit_projection".to_string()
                },
                provider,
                target: Some(target),
                project: None,
                cost: None,
                risk: None,
                effect: Some(
                    local_lead
                        .as_ref()
                        .map(|lead| {
                            format!(
                                "follows the lead from {}: {}",
                                self.actor_name(lead.source_actor_id)
                                    .unwrap_or_else(|| "a local resident".to_string()),
                                lead.destination_hint
                            )
                        })
                        .unwrap_or_else(|| {
                            "reveals the next adjacent route segment without moving".to_string()
                        }),
                ),
                progress: None,
                claim_key: local_lead.as_ref().map(|lead| lead.id.clone()),
                reason: if local_lead.is_some() {
                    "ranked from durable authored local-lead knowledge".to_string()
                } else {
                    "ranked from an unrevealed journey edge or long route".to_string()
                },
                ranked_hand_eligible: true,
            });
        }
        for offer in &mut offers {
            let Some(recognition) = self.practice_recognition_for_offer(actor_id, &offer.kind)
            else {
                continue;
            };
            offer.rank = offer.rank.saturating_sub(5);
            offer.reason = recognition;
        }
        offers.sort_by_key(|offer| offer.rank);
        offers
    }

    pub(super) fn action_offer_rank_for_actor(&self, kind: &str, actor_id: u64) -> u16 {
        if kind == "work" && self.work_finishes_active_progress(actor_id) {
            return if self
                .actor_by_id(actor_id)
                .is_some_and(|actor| self.prepared_tag_active(actor_id, actor.location_id))
            {
                33
            } else {
                36
            };
        }
        if self.project_preparation_spent_for_actor(actor_id) {
            match kind {
                "work" => return 36,
                "help" => return 37,
                _ => {}
            }
        }
        if kind == "check"
            && self
                .actor_by_id(actor_id)
                .is_some_and(|actor| self.listen_attempt_claimed_at(actor_id, actor.location_id))
        {
            return 82;
        }
        if kind == "chat" {
            return 83;
        }
        if kind == "model_interaction" {
            return 71;
        }
        if kind == "rest"
            && (!self.rest_has_recovery_target(actor_id)
                || self
                    .actor_by_id(actor_id)
                    .is_some_and(|actor| !self.location_is_frontier(actor.location_id)))
        {
            return 84;
        }
        action_offer_rank(kind)
    }

    pub(super) fn ranked_offer_from_parts(
        &self,
        kind: &str,
        label: &str,
        command: &str,
        rank: u16,
        disabled: bool,
        disabled_reason: Option<String>,
        target: Option<ActionTargetView>,
        cost: Option<ActionCostView>,
        risk: Option<String>,
        effect: Option<String>,
        claim_key: Option<String>,
        reason: &str,
    ) -> RankedActionOffer {
        let binding = resolved_action_binding(kind)
            .unwrap_or_else(|| panic!("validated action offer kind has no rules binding: {kind}"));
        let state_revision = self.current_state_revision();
        let legacy_id = format!("{kind}:{}", normalize_command_text(command));
        let offer_id = format!(
            "{}:{}:{}",
            active_content().manifest.rules_profile,
            state_revision,
            legacy_id
        );
        let pack_provenance = ActionPackProvenanceView {
            pack_id: binding.pack_id.clone(),
            pack_version: binding.pack_version.clone(),
            rules_namespace: binding.namespace.clone(),
        };
        let composition_trace = self.action_composition_trace(
            None,
            state_revision,
            &binding,
            ActionCompositionContributions {
                source_card_instances: Vec::new(),
                target: target.clone(),
                applied_reskins: Vec::new(),
                contextual_offers: Vec::new(),
            },
        );
        RankedActionOffer {
            id: legacy_id,
            offer_id,
            rules_action: binding.rules_action,
            operation: binding.operation,
            rules_profile: active_content().manifest.rules_profile.clone(),
            resolver: binding.resolver.clone(),
            source_collectible: None,
            pack_provenance,
            composition_trace,
            composition_id: String::new(),
            state_revision,
            route: None,
            threshold_method: None,
            discovery: None,
            kind: kind.to_string(),
            intention: action_offer_intention(kind).to_string(),
            category: action_offer_category(kind).to_string(),
            verb: label.to_string(),
            label: label.to_string(),
            accessible_label: label.to_string(),
            command: normalize_command_text(command),
            rank,
            disabled,
            disabled_reason,
            zone: default_zone(),
            source: "server".to_string(),
            provider: action_provider(
                "system",
                format!("system:{kind}"),
                "World rules",
                "Available from the current world rules",
                70,
            ),
            target,
            project: None,
            cost,
            risk,
            effect,
            progress: None,
            claim_key,
            reason: reason.to_string(),
            ranked_hand_eligible: true,
        }
    }

    pub(super) fn action_offer_provider(
        &self,
        kind: &str,
        actor_id: u64,
        target: Option<&ActionTargetView>,
        project: Option<&ActionProjectView>,
    ) -> ActionProviderView {
        let actor = self.actor_by_id(actor_id);

        if matches!(kind, "attack" | "defend" | "flee") {
            return action_provider(
                "rules",
                "rules:danger",
                "Immediate danger",
                "Because danger is pressing",
                0,
            );
        }
        if kind == "rest" && self.rest_has_recovery_target(actor_id) {
            return action_provider(
                "rules",
                "rules:recovery",
                "Your condition",
                "Because you need to recover",
                0,
            );
        }

        if matches!(kind, "train_skill" | "create_bond") {
            let reason = match kind {
                "train_skill" => "From growth recorded in your Journal",
                "create_bond" => "From growth recorded in your Journal",
                _ => unreachable!(),
            };
            return action_provider(
                "journal",
                format!("journal:{actor_id}"),
                "Your Journal",
                reason,
                10,
            );
        }

        if matches!(
            kind,
            "chat" | "model_interaction" | "help" | "give_item" | "trade_item" | "resolve_bond"
        ) {
            if let Some(target_actor_id) = target.and_then(|target| target.id) {
                if let Some(bond) = self.active_bond(actor_id, target_actor_id) {
                    let target_name = self
                        .actor_name(target_actor_id)
                        .unwrap_or_else(|| format!("Friend {target_actor_id}"));
                    let reason = if bond.strength >= 2 {
                        format!("Because {target_name} trusts you")
                    } else {
                        format!("Because you know {target_name}")
                    };
                    return action_provider("friendship", bond.id.clone(), target_name, reason, 20);
                }
            }
        }

        let held_item = match kind {
            "use_feature" => self
                .default_player_feature_use_candidate(actor_id)
                .map(|candidate| (candidate.item_id, candidate.item_name)),
            "use_item" => self
                .actor_held_items(actor_id)
                .into_iter()
                .filter(|item| item.kind == CW_ITEM_POTION && item.charges > 0)
                .min_by_key(|item| item.id)
                .map(|item| {
                    let name = self
                        .item_name(item.id)
                        .unwrap_or_else(|| format!("Item {}", item.id));
                    (item.id, name)
                }),
            "give_item" => self.actor_give_candidate(actor_id).map(|(item, _)| {
                let name = self
                    .item_name(item.id)
                    .unwrap_or_else(|| format!("Item {}", item.id));
                (item.id, name)
            }),
            "trade_item" => self
                .default_item_trade_candidate(actor_id)
                .map(|candidate| {
                    let item = candidate.offered_item;
                    let name = self
                        .item_name(item.id)
                        .unwrap_or_else(|| format!("Item {}", item.id));
                    (item.id, name)
                }),
            "craft" => self
                .actor_held_items(actor_id)
                .into_iter()
                .min_by_key(|item| item.id)
                .map(|item| {
                    let name = self
                        .item_name(item.id)
                        .unwrap_or_else(|| format!("Item {}", item.id));
                    (item.id, name)
                }),
            _ => None,
        };
        if let Some((item_id, item_name)) = held_item {
            return action_provider(
                "held_item",
                format!("item:{item_id}"),
                item_name.clone(),
                format!("From {item_name} in your hand"),
                30,
            );
        }

        if let Some(calling) = self.callings.get(&actor_id) {
            let calling_matches = match kind {
                "check" => calling_matches_listen(&calling.statement),
                "search" => calling_matches_inspect(&calling.statement),
                "explore_path" | "move" => calling_statement_is_explorer(&calling.statement),
                _ => false,
            };
            if calling_matches {
                return action_provider(
                    "calling",
                    format!("calling:{actor_id}"),
                    "Your Calling",
                    "From your Calling",
                    40,
                );
            }
        }

        if let Some(project) = project {
            return action_provider(
                "job",
                format!("job:{}", project.id),
                project.label.clone(),
                format!("From {}", project.label),
                50,
            );
        }

        if let Some(actor) = actor {
            let location_name = self
                .location_name(actor.location_id)
                .unwrap_or_else(|| format!("Location {}", actor.location_id));
            return action_provider(
                "location",
                format!("location:{}", actor.location_id),
                location_name.clone(),
                format!("From {location_name}"),
                60,
            );
        }

        action_provider(
            "rules",
            "rules:foundation",
            "World rules",
            "Available from the current world rules",
            70,
        )
    }

    pub(super) fn action_vocabulary_for_actor(
        &self,
        actor_id: u64,
    ) -> Option<&SeedActionVocabulary> {
        let location_id = self.actor_by_id(actor_id)?.location_id;
        let pack_id = active_content()
            .locations
            .iter()
            .find(|location| location.id == location_id)
            .map(|location| location.pack_id.as_str())
            .unwrap_or_default();
        active_content()
            .action_vocabulary
            .iter()
            .find(|vocabulary| vocabulary.pack_id == pack_id)
            .or_else(|| {
                active_content()
                    .action_vocabulary
                    .iter()
                    .find(|vocabulary| vocabulary.pack_id == "cosyworld.core")
            })
            .or_else(|| active_content().action_vocabulary.first())
    }

    pub(super) fn action_offer_verb(&self, kind: &str, actor_id: u64) -> String {
        if kind == "model_interaction" {
            return self
                .model_interaction_offer_profile(actor_id)
                .map(|profile| profile.label())
                .unwrap_or("Model interaction")
                .to_string();
        }
        let vocabulary = self.action_vocabulary_for_actor(actor_id);
        let authored = match action_offer_intention(kind) {
            "notice" => vocabulary.map(|value| value.notice.as_str()),
            "inspect" => vocabulary.map(|value| value.inspect.as_str()),
            "scout" => vocabulary.map(|value| value.scout.as_str()),
            "travel" => vocabulary.map(|value| value.travel.as_str()),
            "contribute" if kind == "work" => vocabulary.map(|value| value.push.as_str()),
            "contribute" if kind == "help" => vocabulary.map(|value| value.help.as_str()),
            "contribute" => vocabulary.map(|value| value.contribute.as_str()),
            _ => None,
        };
        authored
            .unwrap_or_else(|| default_action_offer_verb(kind))
            .to_string()
    }

    pub(super) fn job_action_label(&self, job: &JobState) -> String {
        non_empty_text(&job.action_copy.label)
            .map(str::to_string)
            .unwrap_or_else(|| fallback_job_action_label(&job.id))
    }

    pub(super) fn job_action_summary(&self, job: &JobState) -> String {
        non_empty_text(&job.action_copy.summary)
            .map(str::to_string)
            .unwrap_or_else(|| format!("Choose how to help: {}", job.premise))
    }

    pub(super) fn action_offer_project(
        &self,
        kind: &str,
        command: &str,
        actor_id: u64,
    ) -> Option<ActionProjectView> {
        if !matches!(
            kind,
            "prepare" | "work" | "help" | "check" | "study" | "use_item"
        ) {
            return None;
        }
        if matches!(kind, "check" | "use_item")
            && canonical_command_verb(command.split_whitespace().next().unwrap_or_default())
                != "contribute"
        {
            return None;
        }
        let actor = self.actor_by_id(actor_id)?;
        let contribution = self.job_contribution_intent(actor_id, kind, None, None, None);
        let progress_clock_id = contribution
            .as_ref()
            .map(|intent| intent.strategy.clock_id.clone())
            .or_else(|| self.active_progress_clock_id_for_location(actor.location_id))?;
        let verb = self
            .action_vocabulary_for_actor(actor_id)
            .map(|vocabulary| vocabulary.contribute.clone())
            .unwrap_or_else(|| "Contribute".to_string());
        let job = contribution
            .as_ref()
            .and_then(|intent| self.jobs.get(&intent.job_id))
            .or_else(|| {
                self.active_job_for_location(actor.location_id)
                    .filter(|job| job.progress_clock_id == progress_clock_id)
            });
        if let Some(job) = job {
            let claim_key = contribution.as_ref().and_then(|intent| {
                Self::contribution_claim_key(
                    actor_id,
                    &intent.job_id,
                    &intent.strategy,
                    &intent.target,
                )
            });
            return Some(ActionProjectView {
                id: job.id.clone(),
                verb,
                label: self.job_action_label(job),
                summary: self.job_action_summary(job),
                progress_clock_id,
                strategy_id: contribution
                    .as_ref()
                    .map(|intent| intent.strategy.id.clone()),
                strategy_label: contribution
                    .as_ref()
                    .map(|intent| intent.strategy.strategy_label.clone()),
                resolution: contribution.as_ref().map(|intent| {
                    contribution_resolution_label(&intent.strategy.resolution).to_string()
                }),
                claim_key,
            });
        }
        let label = self
            .clocks
            .get(&progress_clock_id)
            .map(|clock| clock.label.trim())
            .filter(|label| !label.is_empty())
            .unwrap_or("Help the shared work")
            .to_string();
        Some(ActionProjectView {
            id: progress_clock_id.clone(),
            verb,
            summary: format!("Choose how to help with {label}."),
            label,
            progress_clock_id,
            strategy_id: None,
            strategy_label: None,
            resolution: None,
            claim_key: None,
        })
    }

    pub(super) fn action_offer_label(
        &self,
        kind: &str,
        verb: &str,
        fallback: &str,
        target: Option<&ActionTargetView>,
        project: Option<&ActionProjectView>,
    ) -> String {
        let target_label = target.and_then(|value| value.label.as_deref());
        match action_offer_intention(kind) {
            "notice" => verb.to_string(),
            "inspect" => action_target_phrase(verb, "", target_label),
            "scout" => action_target_phrase(verb, "toward", target_label),
            "travel" => action_target_phrase(verb, "to", target_label),
            "contribute" if kind == "help" => match (target_label, project) {
                (Some(target), Some(project)) => {
                    format!("{verb} {target} with {}", project.label)
                }
                (Some(target), None) => format!("{verb} {target}"),
                (None, Some(project)) => format!("{verb} with {}", project.label),
                (None, None) => verb.to_string(),
            },
            "contribute" => project
                .map(|project| format!("{verb} {}", project.label))
                .unwrap_or_else(|| verb.to_string()),
            _ => fallback.to_string(),
        }
    }

    pub(super) fn action_offer_accessible_label(
        &self,
        kind: &str,
        verb: &str,
        label: &str,
        target: Option<&ActionTargetView>,
        project: Option<&ActionProjectView>,
    ) -> String {
        match action_offer_intention(kind) {
            "notice" => {
                action_target_phrase(verb, "at", target.and_then(|value| value.label.as_deref()))
            }
            "inspect" | "scout" | "travel" | "contribute" => label.to_string(),
            _ => project
                .map(|project| format!("{label}: {}", project.label))
                .unwrap_or_else(|| label.to_string()),
        }
    }

    pub(super) fn scout_action_offer_targets(
        &self,
        actor_id: u64,
        access: &AccessContext,
    ) -> Vec<ActionTargetView> {
        let Some(actor) = self.actor_by_id(actor_id) else {
            return Vec::new();
        };
        let exits = self.exit_views(Some(actor_id), actor.location_id, access);
        if let Some(journey) = self.journey_at_actor_location(actor_id) {
            let next_step = journey.current_step + 1;
            let next_location_id = journey.path.get(next_step).copied();
            let next_is_revealed = next_location_id.is_some_and(|next_id| {
                let current_location_id = journey.path[journey.current_step];
                self.generated_pathways
                    .get(&journey.pathway_id)
                    .is_some_and(|pathway| {
                        pathway
                            .revealed_edges
                            .contains(&pathway_edge_key(current_location_id, next_id))
                    })
            });
            if next_location_id.is_some() && !next_is_revealed {
                return vec![ActionTargetView {
                    kind: "location".to_string(),
                    id: Some(journey.destination_location_id),
                    label: Some(journey.destination_name),
                }];
            }
            return Vec::new();
        }
        if let Some(lead) = self.actionable_local_lead(actor_id) {
            return vec![ActionTargetView {
                kind: "location".to_string(),
                id: Some(lead.destination_location_id),
                label: self.location_name(lead.destination_location_id),
            }];
        }

        let mut targets = exits
            .into_iter()
            .filter(|exit| exit.distance > 1 && exit.accessible && !exit.locked)
            .map(|exit| ActionTargetView {
                kind: "location".to_string(),
                id: Some(exit.destination_location_id),
                label: Some(exit.destination_location_name),
            })
            .collect::<Vec<_>>();
        targets.extend(
            active_content()
                .exits
                .iter()
                .filter(|exit| {
                    exit.from_location_id == actor.location_id
                        && !self.authored_route_locked_for_edge(
                            exit.from_location_id,
                            exit.to_location_id,
                        )
                        && location_access_allowed(exit.to_location_id, access)
                        && !self.seed_exit_discovered(exit.from_location_id, exit.to_location_id)
                        && self
                            .pathway_for_anchors(actor.location_id, exit.to_location_id)
                            .is_none()
                })
                .map(|exit| ActionTargetView {
                    kind: "location".to_string(),
                    id: Some(exit.to_location_id),
                    label: self.location_name(exit.to_location_id),
                }),
        );
        targets.sort_by_key(|target| {
            (
                target.label.clone().unwrap_or_default(),
                target.id.unwrap_or_default(),
            )
        });
        targets.dedup_by_key(|target| target.id);
        targets
    }

    pub(super) fn action_offer_source_collectible(
        &self,
        kind: &str,
        actor_id: u64,
    ) -> Option<ActionSourceCollectibleView> {
        let source_item = match kind {
            "cast_spell" => self.default_spell_card(actor_id),
            "attack" => self.authoritative_combat_weapon_item(actor_id),
            "use_item" | "use_feature" => self
                .actor_held_items(actor_id)
                .into_iter()
                .find(|item| item.role != CW_ITEM_ROLE_GENERIC),
            _ => None,
        };
        if let Some(item) = source_item {
            return self.item_source_collectible(item.id);
        }
        let actor = self.actor_by_id(actor_id)?;
        let card = seed_card_for_subject("location", actor.location_id)?;
        Some(ActionSourceCollectibleView {
            kind: "location".to_string(),
            instance_id: actor.location_id,
            card_id: card.card_id,
            pack_id: card.pack_id.unwrap_or_else(|| "cosyworld.core".to_string()),
        })
    }

    pub(super) fn location_source_collectible(
        &self,
        actor_id: u64,
    ) -> Option<ActionSourceCollectibleView> {
        let location_id = self.actor_by_id(actor_id)?.location_id;
        let card = seed_card_for_subject("location", location_id)?;
        Some(ActionSourceCollectibleView {
            kind: "location".to_string(),
            instance_id: location_id,
            card_id: card.card_id,
            pack_id: card.pack_id.unwrap_or_else(|| "cosyworld.core".to_string()),
        })
    }

    pub(super) fn pickup_offer_items(&self, actor_id: u64) -> Vec<CwItem> {
        let Some(actor) = self
            .actor_by_id(actor_id)
            .filter(|actor| Self::actor_can_act(*actor))
        else {
            return Vec::new();
        };
        let held_items = self.actor_held_items(actor_id);
        self.loose_items_at_location(actor.location_id)
            .into_iter()
            .filter(|incoming| {
                self.actor_can_receive_item(actor, incoming.id)
                    || held_items.iter().any(|outgoing| {
                        self.actor_can_exchange_items(actor_id, Some(*outgoing), *incoming)
                    })
            })
            .collect()
    }

    pub(super) fn drop_offer_items(&self, actor_id: u64) -> Vec<CwItem> {
        let mut items = self.actor_held_items(actor_id);
        items.sort_by_key(|item| item.id);
        items
    }

    pub(super) fn item_action_offer_items(&self, kind: &str, actor_id: u64) -> Vec<CwItem> {
        match kind {
            "pick_up" => self.pickup_offer_items(actor_id),
            "drop_item" => self.drop_offer_items(actor_id),
            _ => Vec::new(),
        }
    }

    pub(super) fn retarget_item_action_offer(
        &self,
        actor_id: u64,
        mut offer: RankedActionOffer,
        item: CwItem,
    ) -> RankedActionOffer {
        let item_name = self
            .item_name(item.id)
            .unwrap_or_else(|| format!("Item {}", item.id));
        let target = ActionTargetView {
            kind: "item".to_string(),
            id: Some(item.id),
            label: Some(item_name.clone()),
        };
        let verb = self.action_offer_verb(&offer.kind, actor_id);
        let command = match offer.kind.as_str() {
            "pick_up" => format!("take {item_name}"),
            "drop_item" => format!("drop {item_name}"),
            _ => offer.command.clone(),
        };
        let legacy_id = format!("{}:{}", offer.kind, item.id);
        offer.id = legacy_id.clone();
        offer.offer_id = format!(
            "{}:{}:{}",
            offer.rules_profile, offer.state_revision, legacy_id
        );
        offer.verb = verb.clone();
        offer.label = format!("{verb} {item_name}");
        offer.accessible_label = offer.label.clone();
        offer.command = normalize_command_text(&command);
        offer.target = Some(target.clone());
        offer.composition_trace.target = Some(target);
        offer.effect = match offer.kind.as_str() {
            "pick_up" => self.actor_by_id(actor_id).map(|actor| {
                if self.actor_can_receive_item(actor, item.id) {
                    "adds the item card to your carried deck".to_string()
                } else {
                    "keeps the chosen item and leaves one carried item here".to_string()
                }
            }),
            "drop_item" => Some("leaves the item card in this room".to_string()),
            _ => offer.effect,
        };
        offer
    }

    pub(super) fn expand_item_action_offers(
        &self,
        actor_id: u64,
        offers: Vec<RankedActionOffer>,
    ) -> Vec<RankedActionOffer> {
        let mut expanded = Vec::new();
        for offer in offers {
            if !matches!(offer.kind.as_str(), "pick_up" | "drop_item") {
                expanded.push(offer);
                continue;
            }
            expanded.extend(
                self.item_action_offer_items(&offer.kind, actor_id)
                    .into_iter()
                    .map(|item| self.retarget_item_action_offer(actor_id, offer.clone(), item)),
            );
        }
        expanded
    }

    pub(super) fn action_offer_target(
        &self,
        kind: &str,
        actor_id: u64,
        access: &AccessContext,
        active_direct_actor_ids: Option<&BTreeSet<u64>>,
    ) -> Option<ActionTargetView> {
        let actor = self.actor_by_id(actor_id)?;
        match kind {
            "check" => Some(ActionTargetView {
                kind: "location".to_string(),
                id: Some(actor.location_id),
                label: self.location_name(actor.location_id),
            }),
            "chat" => self
                .default_inference_chat_target(actor_id)
                .map(|target| ActionTargetView {
                    kind: "actor".to_string(),
                    id: Some(target.id),
                    label: self.actor_name(target.id),
                }),
            "model_interaction" => self
                .default_model_interaction_target(actor_id)
                .map(|target| ActionTargetView {
                    kind: "actor".to_string(),
                    id: Some(target.id),
                    label: self.actor_name(target.id),
                }),
            "influence" => self
                .default_chat_target(actor_id)
                .map(|target| ActionTargetView {
                    kind: "actor".to_string(),
                    id: Some(target.id),
                    label: self.actor_name(target.id),
                }),

            "attack" | "defend" => self
                .active_combat_encounter_for_actor(actor_id)
                .and_then(|encounter| self.combat_target_for_actor(encounter.id, actor_id))
                .or_else(|| {
                    self.combat_job_for_actor(actor_id, None)
                        .map(|(_, target_id)| target_id)
                })
                .and_then(|target_id| self.actor_by_id(target_id))
                .map(|target| ActionTargetView {
                    kind: "actor".to_string(),
                    id: Some(target.id),
                    label: self.actor_name(target.id),
                }),
            "prepare" => self
                .job_contribution_intent(actor_id, "prepare", None, None, None)
                .map(|intent| ActionTargetView {
                    kind: intent.target.kind,
                    id: intent.target.id.parse::<u64>().ok(),
                    label: Some(intent.target.label),
                })
                .or_else(|| {
                    self.active_job_for_location(actor.location_id)
                        .map(|job| ActionTargetView {
                            kind: "project".to_string(),
                            id: Some(actor.location_id),
                            label: Some(format!("{} ({})", job.premise, job.id)),
                        })
                }),
            "work" | "help" | "study" => self
                .job_contribution_intent(actor_id, kind, None, None, None)
                .map(|intent| ActionTargetView {
                    kind: intent.target.kind,
                    id: intent.target.id.parse::<u64>().ok(),
                    label: Some(intent.target.label),
                }),
            "use_feature" => self
                .default_player_feature_use_candidate(actor_id)
                .map(|candidate| ActionTargetView {
                    kind: "feature".to_string(),
                    id: Some(candidate.location_id),
                    label: Some(candidate.feature_name),
                }),
            "use_item" => self.world.actors[..self.world.actor_count]
                .iter()
                .find(|target| self.healing_target_is_offerable(&actor, target))
                .map(|target| ActionTargetView {
                    kind: "actor".to_string(),
                    id: Some(target.id),
                    label: self.actor_name(target.id),
                }),
            "give_item" => self
                .actor_give_candidate(actor_id)
                .map(|(offered_item, target)| ActionTargetView {
                    kind: "actor".to_string(),
                    id: Some(target.id),
                    label: Some(format!(
                        "{} to {}",
                        self.item_name(offered_item.id)
                            .unwrap_or_else(|| format!("Item {}", offered_item.id)),
                        self.actor_name(target.id)
                            .unwrap_or_else(|| format!("Avatar {}", target.id))
                    )),
                }),
            "trade_item" => self
                .default_item_trade(actor_id)
                .map(|(_, target, target_item)| ActionTargetView {
                    kind: "item".to_string(),
                    id: Some(target_item.id),
                    label: Some(format!(
                        "{} from {}",
                        self.item_name(target_item.id)
                            .unwrap_or_else(|| format!("Item {}", target_item.id)),
                        self.actor_name(target.id)
                            .unwrap_or_else(|| format!("Resident {}", target.id))
                    )),
                }),
            "pick_up" => self
                .pickup_offer_items(actor_id)
                .into_iter()
                .next()
                .map(|item| ActionTargetView {
                    kind: "item".to_string(),
                    id: Some(item.id),
                    label: self.item_name(item.id),
                }),
            "drop_item" => self
                .drop_offer_items(actor_id)
                .into_iter()
                .next()
                .map(|item| ActionTargetView {
                    kind: "item".to_string(),
                    id: Some(item.id),
                    label: self.item_name(item.id),
                }),
            "theft" => self
                .default_theft_candidate(actor_id)
                .map(|(target, item)| ActionTargetView {
                    kind: "item".to_string(),
                    id: Some(item.id),
                    label: Some(format!(
                        "{} carried by {}",
                        self.item_name(item.id)
                            .unwrap_or_else(|| format!("Item {}", item.id)),
                        self.actor_name(target.id)
                            .unwrap_or_else(|| format!("Resident {}", target.id))
                    )),
                }),
            "search" => self
                .default_search_target(actor_id)
                .map(|target| ActionTargetView {
                    kind: "feature".to_string(),
                    id: Some(target.location_id),
                    label: Some(target.name),
                }),
            "cast_spell" => Some(ActionTargetView {
                kind: "actor".to_string(),
                id: Some(actor_id),
                label: self.actor_name(actor_id),
            }),
            "craft" => self
                .default_craft_recipe(actor_id)
                .map(|recipe| ActionTargetView {
                    kind: "recipe".to_string(),
                    id: Some(recipe.id),
                    label: Some(recipe.name.clone()),
                }),
            "move" | "flee" => {
                let journey_next_location_id = (kind == "move")
                    .then(|| {
                        self.journey_view(actor_id)
                            .and_then(|journey| journey.next_location_id)
                    })
                    .flatten();
                self.exit_views(Some(actor_id), actor.location_id, access)
                    .into_iter()
                    .filter(|exit| exit.accessible && !exit.locked)
                    .min_by_key(|exit| {
                        usize::from(journey_next_location_id != Some(exit.destination_location_id))
                    })
                    .map(|exit| ActionTargetView {
                        kind: "location".to_string(),
                        id: Some(exit.destination_location_id),
                        label: Some(exit.destination_location_name),
                    })
            }
            "create_bond" => self
                .default_bondable_resident_with_presence(actor_id, active_direct_actor_ids)
                .map(|target| ActionTargetView {
                    kind: "actor".to_string(),
                    id: Some(target.id),
                    label: self.actor_name(target.id),
                }),
            "resolve_bond" => self
                .default_resolvable_bond(actor_id)
                .map(|bond| ActionTargetView {
                    kind: "actor".to_string(),
                    id: Some(bond.target_actor_id),
                    label: self.actor_name(bond.target_actor_id),
                }),
            _ => None,
        }
    }

    pub(super) fn action_offer_cost(&self, kind: &str, actor_id: u64) -> Option<ActionCostView> {
        let _ = actor_id;
        match kind {
            // Orbs are reserved for community image generation. Conversation,
            // observation, and every other ordinary world verb are free.
            "chat" | "check" => None,
            _ => None,
        }
    }

    pub(super) fn action_offer_risk(&self, kind: &str, actor_id: u64) -> Option<String> {
        let actor = self.actor_by_id(actor_id)?;
        match kind {
            "attack"
                if self
                    .active_danger_clock_id_for_location(actor.location_id)
                    .is_some() =>
            {
                Some(
                    "the scuffle grows more dangerous; someone may be hurt or fall quiet"
                        .to_string(),
                )
            }
            "attack" => Some("someone may be hurt or fall quiet".to_string()),
            "defend" => Some("you guard instead of striking".to_string()),
            "flee" => Some("you leave the danger and this room behind".to_string()),
            "check" if self.location_is_frontier(actor.location_id) => {
                Some("listening again out here may tire you".to_string())
            }
            "study" => self
                .job_contribution_intent(actor_id, "study", None, None, None)
                .and_then(|intent| match intent.strategy.resolution {
                    ContributionResolutionPolicy::SrdCheck { dc, .. } => Some(format!(
                        "the authored check is DC {dc}; on failure, only the careful groundwork and declared consequences remain"
                    )),
                    _ => None,
                }),
            "influence" => Some(
                "the resident may cooperate or cautiously decline; no reward or attitude is chosen by narration"
                    .to_string(),
            ),
            "theft" => Some(
                "failure leaves possession unchanged and is visible; success transfers exactly one card and provokes a consequence"
                    .to_string(),
            ),
            "work" if !self.prepared_tag_active(actor_id, actor.location_id) => {
                Some("rushing in may tire you".to_string())
            }
            "help" if self.repeated_unprepared_help_tires(actor_id, actor.location_id) => {
                Some("helping again may tire you".to_string())
            }
            "rest" => self
                .active_danger_clock_id_for_location(actor.location_id)
                .filter(|clock_id| self.clock_is_frontier(clock_id))
                .filter(|_| self.rest_entitlement(actor_id).grade == CW_REST_GRADE_CAMP)
                .map(|_| "trouble may draw nearer while you rest".to_string()),
            _ => None,
        }
    }

    pub(super) fn action_offer_progress(&self, kind: &str, actor_id: u64) -> Option<u8> {
        let actor = self.actor_by_id(actor_id)?;
        match kind {
            "check" => lifecycle_effects_for("on_listen", "room", &actor.location_id.to_string())
                .into_iter()
                .find_map(|effect| match effect {
                    EffectDescriptor::AdvanceClock { amount, .. } => Some(amount),
                    _ => None,
                }),
            "prepare" => self
                .job_contribution_intent(actor_id, "prepare", None, None, None)
                .map(|intent| self.contribution_progress_amount(actor_id, &intent))
                .or_else(|| {
                    Some(self.prepared_project_progress_amount(actor_id, actor.location_id))
                }),
            "defend" if self.prepare_available(actor_id) => {
                Some(self.prepared_project_progress_amount(actor_id, actor.location_id))
            }
            "work"
                if self
                    .job_contribution_intent(actor_id, "work", None, None, None)
                    .is_some() =>
            {
                Some(self.work_project_progress_amount(actor_id, actor.location_id))
            }
            "help"
                if self
                    .job_contribution_intent(actor_id, "help", None, None, None)
                    .is_some() =>
            {
                Some(self.help_project_progress_amount(actor_id, actor.location_id))
            }
            "study" => self
                .job_contribution_intent(actor_id, "study", None, None, None)
                .map(|intent| self.contribution_progress_amount(actor_id, &intent)),
            _ => None,
        }
    }

    pub(super) fn action_offer_effect(
        &self,
        kind: &str,
        actor_id: u64,
        active_direct_actor_ids: Option<&BTreeSet<u64>>,
    ) -> Option<String> {
        let actor = self.actor_by_id(actor_id)?;
        match kind {
            "attack" => Some(self.combat_method_effect(actor_id)),
            "chat" => self
                .default_chat_target(actor_id)
                .and_then(|target| self.actor_name(target.id))
                .map(|name| format!("opens a small exchange with {name}")),
            "model_interaction" => self.model_interaction_offer_effect(actor_id),
            "influence" => self
                .default_chat_target(actor_id)
                .and_then(|target| self.actor_name(target.id))
                .map(|name| {
                    format!(
                        "asks {name} to share one useful local lead; allowed outcomes are cooperates or declines"
                    )
                }),
            "check" => {
                if self.listen_attempt_claimed_at(actor_id, actor.location_id) {
                    return Some(
                        "listens once more, though the room may have nothing new yet"
                            .to_string(),
                    );
                }
                let effects =
                    lifecycle_effects_for("on_listen", "room", &actor.location_id.to_string());
                if effects.is_empty() {
                    Some("lets the room share one useful clue".to_string())
                } else {
                    Some(
                        "lets the room share one useful clue; what you hear may help the shared work"
                            .to_string(),
                    )
                }
            }
            "study" => self
                .job_contribution_intent(actor_id, "study", None, None, None)
                .map(|intent| {
                    format!(
                        "{} examines {}; its {} result can help the shared work",
                        intent.strategy.strategy_label,
                        intent.target.label,
                        contribution_resolution_label(&intent.strategy.resolution)
                    )
                }),
            "cast_spell" => Some(
                "spends Steady Light and gives one nearby traveler a glow until rest"
                    .to_string(),
            ),
            "prepare" => {
                if let Some(intent) =
                    self.job_contribution_intent(actor_id, "prepare", None, None, None)
                {
                    return Some(self.project_headway_text(
                        &intent.strategy.clock_id,
                        self.contribution_progress_amount(actor_id, &intent),
                    ));
                }
                self.job_contribution_intent(actor_id, "work", None, None, None)
                    .and_then(|intent| {
                        self.project_push_effect_text(actor_id, &intent, true, true)
                    })
            }
            "defend" if self.prepare_available(actor_id) => {
                Some("guards carefully and makes the next try count".to_string())
            }
            "defend" => Some("raises a careful guard".to_string()),
            "work" => self
                .job_contribution_intent(actor_id, "work", None, None, None)
                .map(|intent| {
                    let prepared = self.prepared_tag_active(actor_id, actor.location_id);
                    self.project_push_effect_text(actor_id, &intent, prepared, false)
                        .unwrap_or_else(|| "Push inputs are no longer valid.".to_string())
                }),
            "help" => self
                .job_contribution_intent(actor_id, "help", None, None, None)
                .map(|intent| {
                    let amount = self.contribution_progress_amount(actor_id, &intent);
                    let progress_effect =
                        self.project_headway_text(&intent.strategy.clock_id, amount);
                    if let Ok(target_actor_id) = intent.target.id.parse::<u64>() {
                        let target_name = intent.target.label;
                        let claim_key = help_bond_claim_key(actor_id, target_actor_id);
                        if !self.rpg_claims.contains(&claim_key) {
                            format!(
                                "helps {target_name}; {progress_effect}; first help brings you closer to {target_name}"
                            )
                        } else {
                            format!("helps a resident and {progress_effect}")
                        }
                    } else {
                        format!("helps a resident and {progress_effect}")
                    }
                }),
            "rest" if !self.rest_has_recovery_target(actor_id) => {
                Some("takes time; nothing currently needs recovery".to_string())
            }
            "rest"
                if self.rest_entitlement(actor_id).grade >= CW_REST_GRADE_LODGED
                    && self.trained_since_rest_tag_active(actor_id) =>
            {
                Some("helps you feel fresh; practice settles into something lasting".to_string())
            }
            "rest"
                if self.rest_entitlement(actor_id).grade == CW_REST_GRADE_CAMP
                    && self
                        .active_danger_clock_id_for_location(actor.location_id)
                        .is_some_and(|clock_id| self.clock_is_frontier(&clock_id)) =>
            {
                let clock = self
                    .active_danger_clock_id_for_location(actor.location_id)
                    .and_then(|clock_id| self.clocks.get(&clock_id));
                Some(match clock {
                    Some(clock) => format!(
                        "helps you feel fresh; {} advances from {}/{} to {}/{}",
                        clock.label,
                        clock.filled,
                        clock.segments,
                        clock.filled.saturating_add(1).min(clock.segments),
                        clock.segments,
                    ),
                    None => "helps you feel fresh; trouble may draw nearer out here".to_string(),
                })
            }
            "rest" => Some("helps you feel fresh".to_string()),
            "move" => Some("takes you to a nearby room".to_string()),
            "flee" => Some("returns from the frontier with something worth remembering".to_string()),
            "search" => self.default_search_target(actor_id).map(|target| {
                let candidates =
                    self.search_reveal_candidates_for_feature(actor.location_id, &target.key);
                let Some(candidate) = candidates.first() else {
                    return format!("looks closely around {}", target.name);
                };
                match candidate {
                    SearchRevealCandidate::SeedExit { .. } => {
                        format!("looks closely around {}; uncovers a new path", target.name)
                    }
                    SearchRevealCandidate::HiddenExit { .. } => {
                        format!(
                            "looks closely around {}; uncovers a hidden entrance",
                            target.name
                        )
                    }
                    SearchRevealCandidate::Avatar { .. } => {
                        format!("looks closely around {}; finds someone hidden", target.name)
                    }
                    SearchRevealCandidate::Item { .. } => {
                        format!("looks closely around {}; finds a hidden item", target.name)
                    }
                }
            }),
            "craft" => self.default_craft_recipe(actor_id).map(|recipe| {
                if recipe.schema_version == 2 {
                    recipe.description.clone()
                } else {
                    let output = recipe
                        .output
                        .as_ref()
                        .map(|output| output.name.as_str())
                        .unwrap_or("a new keepsake");
                    format!("creates {output} from the two present keepsakes")
                }
            }),
            "create_bond" => self
                .default_bondable_resident_with_presence(actor_id, active_direct_actor_ids)
                .and_then(|target| {
                    self.actor_name(target.id)
                        .map(|name| format!("a friendship with {name} begins"))
                }),
            "resolve_bond" => self.default_resolvable_bond(actor_id).and_then(|bond| {
                self.actor_name(bond.target_actor_id)
                    .map(|name| format!("keeps what mattered with {name}; leaves you something to remember"))
            }),
            "give_item" => self
                .actor_give_candidate(actor_id)
                .map(|(offered_item, target)| {
                    let item_name = self
                        .item_name(offered_item.id)
                        .unwrap_or_else(|| format!("Item {}", offered_item.id));
                    let target_name = self
                        .actor_name(target.id)
                        .unwrap_or_else(|| format!("Avatar {}", target.id));
                    let request_reason = self
                        .economy_known_by(actor_id, target.id)
                        .then(|| self.resident_request_for_holder(target, actor_id))
                        .flatten()
                        .filter(|request| request.item_id == offered_item.id)
                        .map(|request| request.reason)
                        .unwrap_or_else(|| format!("{target_name} can receive {item_name}"));
                    let reason = request_reason.trim_end_matches('.');
                    if let Some(return_item) =
                        self.resident_player_gift_return_item(target, offered_item)
                    {
                        let return_name = self
                            .item_name(return_item.id)
                            .unwrap_or_else(|| format!("Item {}", return_item.id));
                        format!(
                            "{reason}; offers {item_name} to {target_name}; {target_name} hands you {return_name} to make room"
                        )
                    } else {
                        format!("{reason}; offers {item_name} to {target_name}")
                    }
                }),
            "trade_item" => self
                .default_item_trade_candidate(actor_id)
                .map(|candidate| {
                    let ResidentTradeCandidate {
                        offered_item,
                        target,
                        target_item,
                        preference,
                    } = candidate;
                    format!(
                        "{} swaps {} with {} for {}",
                        preference.reason,
                        self.item_name(offered_item.id)
                            .unwrap_or_else(|| format!("Item {}", offered_item.id)),
                        self.actor_name(target.id)
                            .unwrap_or_else(|| format!("Resident {}", target.id)),
                        self.item_name(target_item.id)
                            .unwrap_or_else(|| format!("Item {}", target_item.id))
                    )
                }),
            "theft" => self.default_theft_candidate(actor_id).map(|(target, item)| {
                format!(
                    "attempts to take {} from {}; the server resolves the transfer atomically",
                    self.item_name(item.id)
                        .unwrap_or_else(|| format!("Item {}", item.id)),
                    self.actor_name(target.id)
                        .unwrap_or_else(|| format!("Resident {}", target.id))
                )
            }),
            "use_item" => Some("uses a held item on a valid room or actor target".to_string()),
            "use_feature" => self
                .default_player_feature_use_candidate(actor_id)
                .map(|candidate| candidate.effect),
            "pick_up" => {
                let actor = self.actor_by_id(actor_id)?;
                let item = self.loose_items_at_location(actor.location_id).into_iter().next()?;
                if self.actor_can_receive_item(actor, item.id) {
                    Some("adds the item card to your carried deck".to_string())
                } else {
                    Some("needs more carrying capacity or an explicit item exchange".to_string())
                }
            }
            _ => None,
        }
    }

    pub(super) fn action_offer_claim_key(
        &self,
        kind: &str,
        actor_id: u64,
        active_direct_actor_ids: Option<&BTreeSet<u64>>,
    ) -> Option<String> {
        let actor = self.actor_by_id(actor_id)?;
        match kind {
            "chat" => None,
            "influence" => self
                .default_chat_target(actor_id)
                .map(|target| format!("influence:{}:{}:local-lead", actor_id, target.id)),
            "study" | "work" | "help" => self
                .job_contribution_intent(actor_id, kind, None, None, None)
                .and_then(|intent| {
                    Self::contribution_claim_key(
                        actor_id,
                        &intent.job_id,
                        &intent.strategy,
                        &intent.target,
                    )
                })
                .or_else(|| {
                    (kind == "help")
                        .then(|| self.job_contribution_intent(actor_id, "help", None, None, None))
                        .flatten()
                        .and_then(|intent| intent.target.id.parse::<u64>().ok())
                        .map(|target_actor_id| help_bond_claim_key(actor_id, target_actor_id))
                        .filter(|claim_key| !self.rpg_claims.contains(claim_key))
                }),
            "check" => Some(ability_check_success_claim_key(
                actor_id,
                actor.location_id,
                LISTEN_ABILITY,
                LISTEN_DC as i16,
            )),
            "cast_spell" => self
                .default_spell_card(actor_id)
                .map(|spell| format!("spell_use:{}:{}", actor_id, spell.id)),
            "theft" => self
                .default_theft_candidate(actor_id)
                .map(|(target, item)| format!("theft:{}:{}:{}", actor_id, target.id, item.id)),
            "rest" => Some(tired_tag_id(actor_id)),
            "create_bond" => self
                .default_bondable_resident_with_presence(actor_id, active_direct_actor_ids)
                .map(|target| bond_id(actor_id, target.id)),
            "resolve_bond" => self
                .default_resolvable_bond(actor_id)
                .map(|bond| format!("bond_resolved:{}", bond.id)),
            _ => None,
        }
    }
}

pub(super) fn action_provider(
    kind: impl Into<String>,
    id: impl Into<String>,
    label: impl Into<String>,
    reason: impl Into<String>,
    priority: u8,
) -> ActionProviderView {
    ActionProviderView {
        kind: kind.into(),
        id: id.into(),
        label: label.into(),
        reason: reason.into(),
        priority,
    }
}

pub(super) fn calling_matches_inspect(statement: &str) -> bool {
    let statement = statement.to_ascii_lowercase();
    [
        "clue", "lost", "stuck", "shy room", "strange", "warning", "errand",
    ]
    .iter()
    .any(|needle| statement.contains(needle))
}

pub(super) fn action_offer_requires_target(kind: &str) -> bool {
    matches!(
        kind,
        "chat"
            | "model_interaction"
            | "influence"
            | "attack"
            | "defend"
            | "flee"
            | "pick_up"
            | "use_item"
            | "use_feature"
            | "give_item"
            | "trade_item"
            | "search"
            | "study"
            | "work"
            | "help"
            | "craft"
            | "move"
            | "create_bond"
            | "resolve_bond"
            | "explore_path"
            | FOCUSED_NOTICE_OFFER_KIND
            | DISCOVERY_SEARCH_OFFER_KIND
            | DISCOVERY_STUDY_OFFER_KIND
            | DISCOVERY_SCOUT_OFFER_KIND
            | "open"
    )
}

pub(super) fn action_offer_is_reachable(offer: &RankedActionOffer) -> bool {
    if offer.disabled {
        return false;
    }
    if action_offer_requires_target(&offer.kind) && offer.target.is_none() {
        return false;
    }
    if matches!(offer.kind.as_str(), "prepare" | "work" | "help" | "study")
        && offer.project.is_none()
    {
        return false;
    }
    true
}

pub(super) fn action_offer_hand_group(offer: &RankedActionOffer) -> String {
    // A finite hand rotates exact certified offers. Collapsing by display
    // kind made otherwise legal targets permanently unreachable once the
    // full-action chooser was removed.
    offer.offer_id.clone()
}

#[cfg(test)]
pub(super) fn action_offer_is_generally_useful(offer: &RankedActionOffer) -> bool {
    matches!(
        offer.kind.as_str(),
        "check"
            | "search"
            | FOCUSED_NOTICE_OFFER_KIND
            | DISCOVERY_SEARCH_OFFER_KIND
            | DISCOVERY_STUDY_OFFER_KIND
            | DISCOVERY_SCOUT_OFFER_KIND
            | "move"
            | "chat"
            | "model_interaction"
            | "rest"
    )
}

#[cfg(test)]
pub(super) fn compose_action_hand(offers: &[RankedActionOffer]) -> ActionHandView {
    compose_action_hand_at(offers, 0)
}

pub(super) fn compose_action_hand_at(
    offers: &[RankedActionOffer],
    draw_count: usize,
) -> ActionHandView {
    const CAPACITY: usize = 2;
    let mut candidates: Vec<_> = offers
        .iter()
        .filter(|offer| offer.ranked_hand_eligible && action_offer_is_reachable(offer))
        .collect();
    candidates.sort_by(|left, right| {
        left.provider
            .priority
            .cmp(&right.provider.priority)
            .then_with(|| left.rank.cmp(&right.rank))
            .then_with(|| left.id.cmp(&right.id))
    });

    let mut grouped = Vec::new();
    let mut seen_groups = BTreeSet::new();
    for offer in candidates {
        if seen_groups.insert(action_offer_hand_group(offer)) {
            grouped.push(offer);
        }
    }

    let deck_size = grouped.len();
    let selected = if deck_size == 0 {
        Vec::new()
    } else {
        let start = draw_count.saturating_mul(CAPACITY) % deck_size;
        (0..CAPACITY.min(deck_size))
            .map(|offset| grouped[(start + offset) % deck_size])
            .collect::<Vec<_>>()
    };

    ActionHandView {
        schema_version: 1,
        capacity: CAPACITY as u8,
        deck_size: u16::try_from(deck_size).unwrap_or(u16::MAX),
        draw_available: deck_size > CAPACITY,
        generation: u64::try_from(draw_count).unwrap_or(u64::MAX),
        pass: ActionHandPassView {
            offer_id: String::new(),
            label: "Think".to_string(),
            state_revision: 0,
            generation: u64::try_from(draw_count).unwrap_or(u64::MAX),
            scene_key: "ordinary".to_string(),
        },
        entries: selected
            .into_iter()
            .map(|offer| ActionHandEntryView {
                offer_id: offer.offer_id.clone(),
                kind: offer.kind.clone(),
                intention: offer.intention.clone(),
                provider: offer.provider.clone(),
            })
            .collect(),
    }
}

fn pin_action_hand_offer(
    hand: &mut ActionHandView,
    offers: &[RankedActionOffer],
    draw_count: usize,
    pinned_offer: &RankedActionOffer,
    excluded_offer_ids: &BTreeSet<String>,
) {
    let companion_capacity = usize::from(hand.capacity).saturating_sub(1);
    let mut companion_candidates = offers
        .iter()
        .filter(|candidate| {
            candidate.ranked_hand_eligible
                && action_offer_is_reachable(candidate)
                && !excluded_offer_ids.contains(&candidate.offer_id)
        })
        .collect::<Vec<_>>();
    companion_candidates.sort_by(|left, right| {
        left.provider
            .priority
            .cmp(&right.provider.priority)
            .then_with(|| left.rank.cmp(&right.rank))
            .then_with(|| left.id.cmp(&right.id))
    });
    let mut seen_groups = BTreeSet::new();
    companion_candidates.retain(|candidate| seen_groups.insert(action_offer_hand_group(candidate)));
    let companion_count = companion_candidates.len();
    let companions = if companion_count == 0 || companion_capacity == 0 {
        Vec::new()
    } else {
        let start = draw_count.saturating_mul(companion_capacity) % companion_count;
        (0..companion_capacity.min(companion_count))
            .map(|offset| companion_candidates[(start + offset) % companion_count])
            .collect::<Vec<_>>()
    };
    hand.entries = std::iter::once(ActionHandEntryView {
        offer_id: pinned_offer.offer_id.clone(),
        kind: pinned_offer.kind.clone(),
        intention: pinned_offer.intention.clone(),
        provider: pinned_offer.provider.clone(),
    })
    .chain(companions.into_iter().map(|companion| ActionHandEntryView {
        offer_id: companion.offer_id.clone(),
        kind: companion.kind.clone(),
        intention: companion.intention.clone(),
        provider: companion.provider.clone(),
    }))
    .collect();
    let guided_deck_size = companion_count.saturating_add(1);
    hand.deck_size = u16::try_from(guided_deck_size).unwrap_or(u16::MAX);
    hand.draw_available = companion_count > companion_capacity;
}

impl RuntimeWorld {
    pub(super) fn current_action_hand_offers<'a>(
        &self,
        actor_id: u64,
        offers: &'a [RankedActionOffer],
    ) -> Vec<&'a RankedActionOffer> {
        let hand = self.action_hand_for(Some(actor_id), offers);
        hand.entries
            .iter()
            .filter_map(|entry| offers.iter().find(|offer| offer.offer_id == entry.offer_id))
            .collect()
    }

    pub(super) fn planner_action_offers<'a>(
        &self,
        actor_id: u64,
        offers: &'a [RankedActionOffer],
        planner_backed: bool,
    ) -> Vec<&'a RankedActionOffer> {
        if planner_backed {
            self.current_action_hand_offers(actor_id, offers)
                .into_iter()
                .filter(|offer| action_offer_is_reachable(offer))
                .collect()
        } else {
            offers
                .iter()
                .filter(|offer| action_offer_is_reachable(offer))
                .collect()
        }
    }

    pub(super) fn action_hand_for(
        &self,
        actor_id: Option<u64>,
        offers: &[RankedActionOffer],
    ) -> ActionHandView {
        let draw_count = actor_id
            .and_then(|actor_id| self.hand_generations.get(&actor_id).copied())
            .map(|generation| usize::try_from(generation).unwrap_or(usize::MAX))
            .unwrap_or_default();
        let mut hand = compose_action_hand_at(offers, draw_count);
        if let Some(actor_id) = actor_id {
            if let Some(journey_offer) = self.journey_advancing_offer(actor_id, offers) {
                let journey_offer_ids = BTreeSet::from([journey_offer.offer_id.clone()]);
                pin_action_hand_offer(
                    &mut hand,
                    offers,
                    draw_count,
                    journey_offer,
                    &journey_offer_ids,
                );
            } else {
                let (advancing_offer_id, advancing_offer_ids) =
                    self.first_tale_advancing_offer_selection(actor_id, offers);
                if let Some(offer) = advancing_offer_id
                    .as_ref()
                    .and_then(|offer_id| offers.iter().find(|offer| offer.offer_id == *offer_id))
                {
                    pin_action_hand_offer(
                        &mut hand,
                        offers,
                        draw_count,
                        offer,
                        &advancing_offer_ids,
                    );
                }
            }
        }
        let state_revision = self.current_state_revision();
        let scene_key = focused_encounter_for_actor(self, actor_id.unwrap_or_default())
            .map(|focused| focused.handoff_key())
            .unwrap_or_else(|| "ordinary".to_string());
        let label = if scene_key == "ordinary" {
            "Think"
        } else {
            "Pass"
        };
        hand.pass = ActionHandPassView {
            offer_id: format!(
                "pass:{}:{}:{}:{}",
                actor_id.unwrap_or_default(),
                state_revision,
                hand.generation,
                scene_key
            ),
            label: label.to_string(),
            state_revision,
            generation: hand.generation,
            scene_key,
        };
        hand
    }

    #[cfg(test)]
    pub(super) fn draw_until_test_offer(
        &mut self,
        actor_id: u64,
        access: &AccessContext,
        mut predicate: impl FnMut(&RankedActionOffer) -> bool,
    ) -> Option<RankedActionOffer> {
        let direct_input = self.actor_control_mode(actor_id) == ActorControlMode::DirectInput;
        let (mut initial_primary_action, mut initial_offers) =
            self.legal_action_candidates_with_presence(Some(actor_id), access, None);
        if direct_input {
            retain_configured_model_interaction_offers(
                &mut initial_primary_action,
                &mut initial_offers,
                None,
            );
        }
        let attempts = initial_offers.len().max(1);
        drop(initial_offers);
        for _ in 0..attempts {
            let (mut primary_action, mut offers) =
                self.legal_action_candidates_with_presence(Some(actor_id), access, None);
            if direct_input {
                retain_configured_model_interaction_offers(&mut primary_action, &mut offers, None);
            }
            let hand = self.action_hand_for(Some(actor_id), &offers);
            if let Some(offer) = offers.into_iter().find(|offer| {
                hand.entries
                    .iter()
                    .any(|entry| entry.offer_id == offer.offer_id)
                    && predicate(offer)
            }) {
                return Some(offer);
            }
            self.append_hand_shuffled_event(actor_id, "test_draw");
        }
        None
    }
}

pub(super) fn action_offer_rank(kind: &str) -> u16 {
    match kind {
        "give_item" => 10,
        "open" => 18,
        "use_item" | "use_feature" => 20,
        "rest" => 25,
        "pick_up" | "drop_item" => 30,
        "craft" => 31,
        "prepare" => 32,
        "attack" => 40,
        "defend" => 45,
        "work" => 48,
        "help" => 49,
        "flee" => 50,
        FOCUSED_NOTICE_OFFER_KIND => 52,
        DISCOVERY_SEARCH_OFFER_KIND => 53,
        DISCOVERY_STUDY_OFFER_KIND => 54,
        "explore_path" | DISCOVERY_SCOUT_OFFER_KIND => 55,
        "search" => 58,
        "check" => 60,
        "study" => 61,
        "cast_spell" => 22,
        "chat" => 70,
        "model_interaction" => 71,
        "trade_item" => 74,
        "train_skill" => 76,
        "create_bond" => 77,
        "resolve_bond" => 79,
        "move" => 80,
        _ => 500,
    }
}

pub(super) fn practice_category_matches_offer(category: &str, kind: &str) -> bool {
    match category {
        "exploration" => matches!(
            kind,
            "explore_path"
                | "search"
                | "check"
                | FOCUSED_NOTICE_OFFER_KIND
                | DISCOVERY_SEARCH_OFFER_KIND
                | DISCOVERY_SCOUT_OFFER_KIND
                | "open"
                | "move"
        ),
        "craft" => matches!(kind, "craft" | "use_feature"),
        "delivery" => matches!(kind, "move" | "give_item" | "trade_item"),
        "stewardship" => matches!(kind, "prepare" | "work" | "help"),
        "care" => matches!(kind, "defend" | "use_item" | "rest"),
        "mediation" => matches!(
            kind,
            "influence" | "chat" | "model_interaction" | "create_bond" | "resolve_bond"
        ),
        "lore" => matches!(
            kind,
            "study"
                | "search"
                | "check"
                | FOCUSED_NOTICE_OFFER_KIND
                | DISCOVERY_SEARCH_OFFER_KIND
                | DISCOVERY_STUDY_OFFER_KIND
        ),
        _ => false,
    }
}

pub(super) fn action_offer_intention(kind: &str) -> &str {
    match kind {
        "check" => "notice",
        "search" => "inspect",
        "explore_path" => "scout",
        FOCUSED_NOTICE_OFFER_KIND => "notice",
        DISCOVERY_SEARCH_OFFER_KIND => "inspect",
        DISCOVERY_STUDY_OFFER_KIND => "study",
        DISCOVERY_SCOUT_OFFER_KIND => "scout",
        "move" => "travel",
        "model_interaction" => "illustrate",
        "open" => "open",
        "work" | "help" => "contribute",
        _ => kind,
    }
}

pub(super) fn contribution_resolution_label(policy: &ContributionResolutionPolicy) -> &'static str {
    match policy {
        ContributionResolutionPolicy::Certain => "certain",
        ContributionResolutionPolicy::SrdCheck { .. } => "srd_check",
        ContributionResolutionPolicy::ExistingKernelOutcome { .. } => "existing_kernel_outcome",
    }
}

pub(super) fn default_action_offer_verb(kind: &str) -> &str {
    match kind {
        "check" => "Notice",
        "search" => "Inspect",
        "explore_path" => "Scout",
        FOCUSED_NOTICE_OFFER_KIND => "Notice",
        DISCOVERY_SEARCH_OFFER_KIND => "Search",
        DISCOVERY_STUDY_OFFER_KIND => "Study",
        DISCOVERY_SCOUT_OFFER_KIND => "Scout",
        "move" => "Travel",
        "model_interaction" => "Illustrate",
        "open" => "Open",
        "work" => "Push",
        "help" => "Help",
        "flee" => "Flee",
        "prepare" => "Prepare",
        "pick_up" => "Take",
        "drop_item" => "Drop",
        _ => "Act",
    }
}

pub(super) fn non_empty_text(value: &str) -> Option<&str> {
    let value = value.trim();
    (!value.is_empty()).then_some(value)
}

pub(super) fn action_target_phrase(verb: &str, preposition: &str, target: Option<&str>) -> String {
    let Some(target) = target.and_then(non_empty_text) else {
        return verb.to_string();
    };
    if preposition.is_empty()
        || verb
            .to_ascii_lowercase()
            .ends_with(&format!(" {preposition}"))
    {
        format!("{verb} {target}")
    } else {
        format!("{verb} {preposition} {target}")
    }
}

pub(super) fn fallback_job_action_label(job_id: &str) -> String {
    let words = job_id
        .rsplit_once(':')
        .map(|(_, suffix)| suffix)
        .unwrap_or(job_id)
        .split(['-', '_'])
        .filter(|word| !word.is_empty())
        .collect::<Vec<_>>();
    let fallback = if words.is_empty() {
        "Contribute".to_string()
    } else {
        words.join(" ")
    };
    let mut characters = fallback.chars();
    characters
        .next()
        .map(|first| first.to_uppercase().collect::<String>() + characters.as_str())
        .unwrap_or_else(|| "Contribute".to_string())
}

pub(super) fn action_offer_category(kind: &str) -> &'static str {
    match kind {
        "create_avatar" => "system",
        "move" | "flee" | "explore_path" => "travel",
        "attack" | "defend" => "danger",
        "pick_up" | "drop_item" | "use_item" | "use_feature" | "give_item" | "trade_item"
        | "open" => "inventory",
        "craft" => "craft",
        "chat" | "model_interaction" | "help" | "create_bond" | "resolve_bond" => "social",
        "check"
        | "search"
        | FOCUSED_NOTICE_OFFER_KIND
        | DISCOVERY_SEARCH_OFFER_KIND
        | DISCOVERY_STUDY_OFFER_KIND
        | DISCOVERY_SCOUT_OFFER_KIND => "discovery",
        "prepare" | "work" => "project",
        "rest" => "recovery",
        "train_skill" | "revise_calling" | "revise_bond" => "growth",
        _ => "other",
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn command_request(actor_id: u64, command: &str) -> CommandRequest {
        CommandRequest {
            actor_id,
            actor_session: None,
            command: command.to_string(),
            offer_id: None,
            wallet_session: None,
            envelope: None,
        }
    }

    #[test]
    fn composed_offers_advertise_commands_the_typed_client_can_resolve() {
        let mut runtime = RuntimeWorld::seeded();
        create_test_human(&mut runtime, 5000, COSY_COTTAGE_LOCATION_ID, "Offer Tester");
        let access = AccessContext::default();
        let (primary, offers) = runtime.legal_action_candidates(Some(5000), &access);

        for offer in &offers {
            runtime
                .resolve_command(&command_request(5000, &offer.command), &access)
                .unwrap_or_else(|error| {
                    panic!(
                        "{} advertised unroutable command {:?}: {}",
                        offer.offer_id, offer.command, error.output
                    )
                });
        }
        runtime
            .resolve_command(&command_request(5000, &primary.command), &access)
            .expect("the primary action advertises a routable command");
        assert!(offers.iter().any(|offer| offer.command == primary.command));

        let offer = offers
            .iter()
            .find(|offer| {
                offer
                    .composition_trace
                    .contextual_offers
                    .iter()
                    .any(|id| id == "cosyworld.core:cottage-ask-local-lead")
            })
            .expect("the core pack contributes its Cottage offer");
        assert_eq!(offer.label, "Ask for a local lead");
        assert_eq!(offer.command, "influence Rati");
        let resolved = runtime
            .resolve_command(&command_request(5000, &offer.command), &access)
            .expect("the advertised contextual command resolves");
        assert_eq!(resolved.command, offer.command);
        assert!(matches!(
            resolved.dispatch,
            CommandDispatch::Influence {
                target_actor_id: RATI_ACTOR_ID
            }
        ));

        let scout = offers
            .iter()
            .find(|offer| offer.kind == "explore_path")
            .expect("the seeded long journey exposes Scout");
        assert!(scout.route.is_some(), "Scout is bound to its route version");
        let destination_location_id = scout
            .target
            .as_ref()
            .and_then(|target| target.id)
            .expect("Scout advertises its destination");
        let destination_label = scout
            .target
            .as_ref()
            .and_then(|target| target.label.as_deref())
            .expect("Scout advertises its destination label");
        assert_eq!(scout.command, format!("scout {destination_label}"));
        assert!(matches!(
            runtime
                .resolve_command(&command_request(5000, &scout.command), &access)
                .expect("the advertised Scout command resolves")
                .dispatch,
            CommandDispatch::Scout {
                destination_location_id: resolved_destination_location_id
            }
                if resolved_destination_location_id == destination_location_id
        ));
        assert!(destination_location_id > 0);
    }

    #[test]
    fn branching_undiscovered_routes_each_expose_a_targetable_scout_offer() {
        const RAIN_SOFT_GARDEN_LOCATION_ID: u64 = 2;
        const MOONLIT_TRAIL_LOCATION_ID: u64 = 3;
        const CIRCLE_OF_THE_MOON_LOCATION_ID: u64 = 35;
        const ALPINE_FOREST_LOCATION_ID: u64 = 50;

        let mut runtime = RuntimeWorld::seeded();
        create_test_human(
            &mut runtime,
            5000,
            MOONLIT_TRAIL_LOCATION_ID,
            "Branch Mapper",
        );
        let access = AccessContext::default();
        let (_, offers) = runtime.legal_action_candidates(Some(5000), &access);
        let scouts = offers
            .iter()
            .filter(|offer| offer.kind == "explore_path")
            .collect::<Vec<_>>();
        let destinations = scouts
            .iter()
            .filter_map(|offer| offer.target.as_ref().and_then(|target| target.id))
            .collect::<BTreeSet<_>>();

        assert_eq!(
            destinations,
            BTreeSet::from([
                RAIN_SOFT_GARDEN_LOCATION_ID,
                CIRCLE_OF_THE_MOON_LOCATION_ID,
                ALPINE_FOREST_LOCATION_ID,
            ])
        );
        for offer in scouts {
            let destination_location_id = offer
                .target
                .as_ref()
                .and_then(|target| target.id)
                .expect("Scout offer has a destination");
            assert!(matches!(
                runtime
                    .resolve_command(&command_request(5000, &offer.command), &access)
                    .expect("each advertised Scout command resolves")
                    .dispatch,
                CommandDispatch::Scout {
                    destination_location_id: resolved_destination_location_id
                } if resolved_destination_location_id == destination_location_id
            ));
        }
        let ambiguous = runtime
            .resolve_command(&command_request(5000, "scout"), &access)
            .expect_err("a branch requires naming the Scout destination");
        assert_eq!(ambiguous.status, 404);
        assert!(ambiguous.output.contains("matches"));
    }

    #[test]
    fn revealed_public_journey_segment_does_not_offer_scout_again() {
        const ALPINE_FOREST_LOCATION_ID: u64 = 50;
        const LIBRARY_LOCATION_ID: u64 = 12;

        let mut runtime = RuntimeWorld::seeded();
        create_test_human(&mut runtime, 5000, ALPINE_FOREST_LOCATION_ID, "Map Reader");
        let mut pathway = runtime
            .generated_pathway(5000, ALPINE_FOREST_LOCATION_ID, LIBRARY_LOCATION_ID, 3)
            .expect("generated pathway");
        let path = runtime.pathway_path(&pathway, ALPINE_FOREST_LOCATION_ID, LIBRARY_LOCATION_ID);
        for edge in path.windows(2) {
            pathway
                .revealed_edges
                .insert(pathway_edge_key(edge[0], edge[1]));
            runtime.ensure_generated_pathway_edge(&pathway, edge[0], edge[1]);
        }
        let current_step = path.len() - 2;
        let current_location_id = path[current_step];
        let pathway_id = pathway.id.clone();
        runtime
            .generated_pathways
            .insert(pathway_id.clone(), pathway);
        runtime.journeys.insert(
            5000,
            JourneyState {
                actor_id: 5000,
                pathway_id,
                origin_location_id: ALPINE_FOREST_LOCATION_ID,
                destination_location_id: LIBRARY_LOCATION_ID,
                destination_name: "Library".to_string(),
                path,
                current_step,
                explorer: true,
            },
        );
        let actor_count = runtime.world.actor_count;
        runtime.world.actors[..actor_count]
            .iter_mut()
            .find(|actor| actor.id == 5000)
            .expect("test traveller exists")
            .location_id = current_location_id;

        let state = runtime.state_response(Some(5000), &AccessContext::default());
        let library_exit = state
            .exits
            .iter()
            .find(|exit| exit.destination_location_id == LIBRARY_LOCATION_ID)
            .expect("the revealed Library edge stays projected");
        assert!(library_exit.accessible);
        assert!(!state
            .action_offers
            .iter()
            .any(|offer| offer.kind == "explore_path"));
    }

    #[test]
    fn actionable_local_lead_does_not_override_a_revealed_journey_segment() {
        const ALPINE_FOREST_LOCATION_ID: u64 = 50;
        const LIBRARY_LOCATION_ID: u64 = 12;

        let mut runtime = RuntimeWorld::seeded();
        create_test_human(&mut runtime, 5000, ALPINE_FOREST_LOCATION_ID, "Lead Keeper");
        let mut pathway = runtime
            .generated_pathway(5000, ALPINE_FOREST_LOCATION_ID, LIBRARY_LOCATION_ID, 3)
            .expect("generated pathway");
        let path = runtime.pathway_path(&pathway, ALPINE_FOREST_LOCATION_ID, LIBRARY_LOCATION_ID);
        let first_edge: [u64; 2] = path[0..2].try_into().expect("journey has a first edge");
        pathway
            .revealed_edges
            .insert(pathway_edge_key(first_edge[0], first_edge[1]));
        runtime.ensure_generated_pathway_edge(&pathway, first_edge[0], first_edge[1]);
        let pathway_id = pathway.id.clone();
        runtime
            .generated_pathways
            .insert(pathway_id.clone(), pathway);
        runtime.journeys.insert(
            5000,
            JourneyState {
                actor_id: 5000,
                pathway_id,
                origin_location_id: ALPINE_FOREST_LOCATION_ID,
                destination_location_id: LIBRARY_LOCATION_ID,
                destination_name: "Library".to_string(),
                path,
                current_step: 0,
                explorer: true,
            },
        );
        runtime.local_leads.insert(
            "lead:5000:library".to_string(),
            LocalLeadState {
                id: "lead:5000:library".to_string(),
                actor_id: 5000,
                source_actor_id: RATI_ACTOR_ID,
                source_offer_id: "test-lead".to_string(),
                source_reference: "test".to_string(),
                source_event_seq: 1,
                origin_location_id: ALPINE_FOREST_LOCATION_ID,
                destination_location_id: LIBRARY_LOCATION_ID,
                destination_hint: "the old library road".to_string(),
                received_tick: runtime.world.tick,
                consumed: false,
                settled: false,
                forgotten: false,
                consumed_event_seq: None,
                settled_event_seq: None,
            },
        );

        let state = runtime.state_response(Some(5000), &AccessContext::default());
        assert!(
            state.action_offers.iter().any(|offer| offer.kind == "move"
                && offer.target.as_ref().and_then(|target| target.id) == Some(first_edge[1])),
            "the revealed next edge must be advertised as Travel"
        );
        assert!(
            !state
                .action_offers
                .iter()
                .any(|offer| offer.kind == "explore_path"),
            "an old local lead must not re-advertise Scout during an active journey"
        );
    }
}
