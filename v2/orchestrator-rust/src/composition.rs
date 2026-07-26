use super::*;

fn submitted_payload_target(
    path: &str,
    target: &ActionTargetView,
    payload: &serde_json::Value,
) -> Option<u64> {
    let key = match (path, target.kind.as_str()) {
        ("/actions/move" | "/actions/flee", "location") => "destination_location_id",
        ("/actions/craft", "recipe") => "recipe_id",
        ("/actions/pick-up" | "/actions/drop", "item") => "item_id",
        ("/actions/trade-item" | "/actions/theft", "item") => "target_item_id",
        (
            "/actions/chat"
            | "/actions/attack"
            | "/actions/give-item"
            | "/actions/create-bond"
            | "/actions/resolve-bond"
            | "/actions/cast-spell"
            | "/actions/influence"
            | "/actions/use-item",
            "actor",
        ) => "target_actor_id",
        _ => return None,
    };
    payload.get(key).and_then(serde_json::Value::as_u64)
}

fn submitted_offer_legacy_id(submission: &ActionOfferSubmissionRequest) -> Option<&str> {
    let prefix = format!(
        "{}:{}:",
        submission.rules_profile, submission.state_revision
    );
    submission.offer_id.strip_prefix(&prefix)
}

fn action_offer_kind_requires_actor_target(kind: &str) -> bool {
    matches!(
        kind,
        "chat" | "influence" | "attack" | "defend" | "give_item" | "create_bond" | "resolve_bond"
    )
}

fn offer_composition_matches_at_submitted_revision(
    offer: &RankedActionOffer,
    submission: &ActionOfferSubmissionRequest,
) -> bool {
    if offer.state_revision <= submission.state_revision {
        return false;
    }
    // Unrelated world events advance every offer envelope. Rebind only that
    // volatile revision so the certificate still detects real scene changes.
    let mut trace = offer.composition_trace.clone();
    trace.state_revision = submission.state_revision;
    if let Some(rules_context) = trace.rules_context.as_mut() {
        rules_context.state_revision = submission.state_revision;
    }
    trace.certificate() == submission.composition_id
}

impl RuntimeWorld {
    #[cfg(test)]
    pub(super) fn validate_action_offer_submission(
        &self,
        actor_id: u64,
        access: &AccessContext,
        submission: &ActionOfferSubmissionRequest,
    ) -> Result<(), &'static str> {
        self.validate_action_offer_submission_with_presence(actor_id, access, submission, None)
    }

    pub(super) fn validate_action_offer_submission_with_presence(
        &self,
        actor_id: u64,
        access: &AccessContext,
        submission: &ActionOfferSubmissionRequest,
        active_direct_actor_ids: Option<&BTreeSet<u64>>,
    ) -> Result<(), &'static str> {
        let (_, offers) = self.legal_action_candidates_with_presence(
            Some(actor_id),
            access,
            active_direct_actor_ids,
        );
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
        let revision_rebound = exact_offer.is_none()
            && offer_composition_matches_at_submitted_revision(offer, submission);
        if !revision_rebound
            && (exact_offer.is_none() || offer.composition_id != submission.composition_id)
        {
            Err("the scene composition changed; refresh and choose a current action")
        } else if offer.kind != submission.kind
            || offer.rules_action != submission.rules_action
            || offer.operation != submission.operation
            || offer.rules_profile != submission.rules_profile
            || (offer.state_revision != submission.state_revision && !revision_rebound)
            || offer.route != submission.route
            || offer.target != submission.target
            || offer.cost != submission.cost
            || offer.disabled
        {
            Err("offer identity, rules binding, target, cost, or availability was changed")
        } else if offer.target.as_ref().is_some_and(|target| {
            submitted_payload_target(&submission.path, target, &submission.payload)
                .is_some_and(|submitted| target.id != Some(submitted))
        }) {
            Err("submitted payload target does not match the authoritative offer")
        } else if offer.project.as_ref().is_some_and(|project| {
            submission
                .payload
                .get("job_id")
                .and_then(serde_json::Value::as_str)
                .is_some_and(|job_id| job_id != project.id)
                || submission
                    .payload
                    .get("strategy_id")
                    .and_then(serde_json::Value::as_str)
                    .is_some_and(|strategy_id| project.strategy_id.as_deref() != Some(strategy_id))
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
                    self.actor_visible_in_projection(
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
        } else {
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
                        .and_then(|target| target.label.as_deref())
                        .map(|label| format!("chat {label}"))
                        .unwrap_or_else(|| option.command.clone())
                } else {
                    option.command.clone()
                };
                let project = self.action_offer_project(&option.kind, &command, actor_id);
                let intention = action_offer_intention(&option.kind).to_string();
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
                let state_revision = self.world.next_event_seq.saturating_sub(1);
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
                }
            })
            .collect();
        offers = self.expand_item_action_offers(actor_id, offers);
        offers = self.expand_job_contribution_offers(actor_id, offers);
        offers = self.expand_use_action_offers(actor_id, offers);
        offers = self.expand_transfer_action_offers(actor_id, offers);
        offers = self.expand_route_action_offers(actor_id, access, offers);
        if let Some(target) = self.scout_action_offer_target(actor_id, access) {
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
            let state_revision = self.world.next_event_seq.saturating_sub(1);
            let source_collectible = self.location_source_collectible(actor_id);
            let source_card_instances = source_collectible.clone().into_iter().collect();
            let legacy_id = format!("explore_path:{}", target.id.clone().unwrap_or_default());
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
                category: action_offer_category(kind).to_string(),
                verb,
                label,
                accessible_label,
                command,
                rank: action_offer_rank(kind),
                disabled: false,
                disabled_reason: None,
                zone: zone.clone(),
                source: "journey+exit_projection".to_string(),
                provider,
                target: Some(target),
                project: None,
                cost: None,
                risk: None,
                effect: Some("reveals the next adjacent route segment without moving".to_string()),
                progress: None,
                claim_key: None,
                reason: "ranked from an unrevealed journey edge or long route".to_string(),
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
        if kind == "rest"
            && self
                .actor_by_id(actor_id)
                .is_some_and(|actor| !self.location_is_frontier(actor.location_id))
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
        let state_revision = self.world.next_event_seq.saturating_sub(1);
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
        if kind == "rest" && actor.is_some_and(|_| self.tired_tag_active(actor_id)) {
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
            "chat" | "help" | "give_item" | "trade_item" | "resolve_bond"
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

    pub(super) fn scout_action_offer_target(
        &self,
        actor_id: u64,
        access: &AccessContext,
    ) -> Option<ActionTargetView> {
        let actor = self.actor_by_id(actor_id)?;
        let exits = self.exit_views(actor.location_id, access);
        if let Some(journey) = self.journey_view(actor_id) {
            let next_is_revealed = journey.next_location_id.is_some_and(|next_id| {
                exits.iter().any(|exit| {
                    exit.destination_location_id == next_id && exit.accessible && !exit.locked
                })
            });
            if journey.next_location_id.is_some() && !next_is_revealed {
                return Some(ActionTargetView {
                    kind: "location".to_string(),
                    id: Some(journey.destination_location_id),
                    label: Some(journey.destination_name),
                });
            }
            return None;
        }
        exits
            .into_iter()
            .find(|exit| exit.distance > 1 && exit.accessible && !exit.locked)
            .map(|exit| ActionTargetView {
                kind: "location".to_string(),
                id: Some(exit.destination_location_id),
                label: Some(exit.destination_location_name),
            })
            .or_else(|| {
                active_content()
                    .exits
                    .iter()
                    .find(|exit| {
                        exit.from_location_id == actor.location_id
                            && exit.flags & CW_EXIT_LOCKED == 0
                            && location_access_allowed(exit.to_location_id, access)
                            && !self
                                .seed_exit_discovered(exit.from_location_id, exit.to_location_id)
                            && self
                                .pathway_for_anchors(actor.location_id, exit.to_location_id)
                                .is_none()
                    })
                    .map(|exit| ActionTargetView {
                        kind: "location".to_string(),
                        id: Some(exit.to_location_id),
                        label: self.location_name(exit.to_location_id),
                    })
            })
    }

    pub(super) fn action_offer_source_collectible(
        &self,
        kind: &str,
        actor_id: u64,
    ) -> Option<ActionSourceCollectibleView> {
        let source_item = match kind {
            "cast_spell" => self.default_spell_card(actor_id),
            "attack" => self.equipped_weapon_item(actor_id),
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
            "chat" | "influence" => {
                self.default_chat_target(actor_id)
                    .map(|target| ActionTargetView {
                        kind: "actor".to_string(),
                        id: Some(target.id),
                        label: self.actor_name(target.id),
                    })
            }

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
                self.exit_views(actor.location_id, access)
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
                .filter(|_| !self.hearth_tonic_warmth_guards_rest(actor.location_id))
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
            "chat" => self
                .default_chat_target(actor_id)
                .and_then(|target| self.actor_name(target.id))
                .map(|name| format!("opens a small exchange with {name}")),
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
                let amount = self.prepared_project_progress_amount(actor_id, actor.location_id);
                let setup_effect = "makes the next try count";
                let multi_room_partial = self
                    .active_job_for_location(actor.location_id)
                    .is_some_and(|job| {
                        job.location_ids.len() > 1
                            && self.project_location_evidence_count(actor_id, job)
                                < job.location_ids.len()
                    });
                if amount > 2 {
                    Some(format!(
                        "brings together every clue you found; {setup_effect}"
                    ))
                } else if multi_room_partial {
                    Some(format!("uses the clues you found here; {setup_effect}"))
                } else {
                    Some(setup_effect.to_string())
                }
            }
            "defend" if self.prepare_available(actor_id) => {
                Some("guards carefully and makes the next try count".to_string())
            }
            "defend" => Some("raises a careful guard".to_string()),
            "work" => self
                .job_contribution_intent(actor_id, "work", None, None, None)
                .map(|intent| {
                    self.project_headway_text(
                        &intent.strategy.clock_id,
                        self.contribution_progress_amount(actor_id, &intent),
                    )
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
            "rest"
                if self
                    .active_danger_clock_id_for_location(actor.location_id)
                    .is_some_and(|clock_id| self.clock_is_frontier(&clock_id))
                    && self.hearth_tonic_warmth_guards_rest(actor.location_id) =>
            {
                Some(
                    "helps you feel fresh and uses the tonic's warmth; trouble stays back"
                        .to_string(),
                )
            }
            "rest" if self.trained_since_rest_tag_active(actor_id) => {
                Some("helps you feel fresh; practice settles into something lasting".to_string())
            }
            "rest"
                if self
                    .active_danger_clock_id_for_location(actor.location_id)
                    .is_some_and(|clock_id| self.clock_is_frontier(&clock_id)) =>
            {
                Some("helps you feel fresh; trouble may draw nearer out here".to_string())
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

#[cfg(test)]
mod tests {
    use super::*;

    fn command_request(actor_id: u64, command: &str) -> CommandRequest {
        CommandRequest {
            actor_id,
            actor_session: None,
            command: command.to_string(),
            wallet_address: None,
            wallet: None,
            wallet_session: None,
            owned_card_ids: None,
            cards: None,
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
            CommandDispatch::Scout
        ));
        assert!(destination_location_id > 0);
    }
}
