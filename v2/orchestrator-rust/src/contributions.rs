use super::*;

const ROUTABLE_CONTRIBUTION_KINDS: [&str; 5] = ["work", "help", "check", "study", "use_item"];

pub(super) fn room_feature_use_tag_id(location_id: u64, feature_key: &str, item_id: u64) -> String {
    format!("room:{location_id}:feature_use:{feature_key}:{item_id}")
}

pub(super) fn combat_resolution_tag_id(job_id: &str, winning_side: i16) -> String {
    format!("job:{job_id}:combat_resolved:side:{winning_side}")
}

impl RuntimeWorld {
    pub(super) fn refresh_authored_job_contracts(&mut self) {
        for authored_job in &active_content().jobs {
            if let Some(existing_job) = self.jobs.get_mut(&authored_job.id) {
                let status = existing_job.status.clone();
                let focused_encounter = existing_job.focused_encounter.clone();
                *existing_job = authored_job.clone();
                existing_job.status = status;
                existing_job.focused_encounter = focused_encounter;
            } else {
                self.jobs
                    .insert(authored_job.id.clone(), authored_job.clone());
            }
        }
    }

    pub(super) fn backfill_room_feature_use_evidence(&mut self) {
        let mut backfilled = BTreeMap::new();
        for tag in self.tags.values().filter(|tag| tag.active) {
            let Some(source_event_seq) = tag.source_event_seq else {
                continue;
            };
            let Some(rest) = tag.id.strip_prefix("actor:") else {
                continue;
            };
            let Some((prefix, item_id)) = rest.rsplit_once(':') else {
                continue;
            };
            let mut parts = prefix.splitn(4, ':');
            let Some(actor_id) = parts.next().and_then(|part| part.parse::<u64>().ok()) else {
                continue;
            };
            if parts.next() != Some("feature_use") {
                continue;
            }
            let Some(location_id) = parts.next().and_then(|part| part.parse::<u64>().ok()) else {
                continue;
            };
            let Some(feature_key) = parts.next().filter(|part| !part.is_empty()) else {
                continue;
            };
            let Some(item_id) = item_id.parse::<u64>().ok() else {
                continue;
            };
            if tag.scope != "actor" || tag.scope_id != actor_id {
                continue;
            }
            let room_tag_id = room_feature_use_tag_id(location_id, feature_key, item_id);
            let candidate = RpgTagState {
                id: room_tag_id.clone(),
                scope: "room".to_string(),
                scope_id: location_id,
                label: tag.label.clone(),
                kind: "discovery".to_string(),
                active: true,
                source_event_seq: Some(source_event_seq),
                expires: None,
            };
            backfilled
                .entry(room_tag_id)
                .and_modify(|existing: &mut RpgTagState| {
                    if existing.source_event_seq > candidate.source_event_seq {
                        *existing = candidate.clone();
                    }
                })
                .or_insert(candidate);
        }
        for (tag_id, tag) in backfilled {
            self.tags.entry(tag_id).or_insert(tag);
        }
    }

    pub(super) fn contribution_strategy_binding_is_active(
        &self,
        strategy: &JobContributionStrategy,
    ) -> bool {
        let Some(binding) = resolved_action_binding(&strategy.action_kind) else {
            return false;
        };
        let pack_matches = active_content()
            .manifest
            .packs
            .iter()
            .any(|pack| pack.id == strategy.pack_id && pack.version == strategy.pack_version);
        strategy.version == JOB_CONTRIBUTION_SCHEMA_VERSION
            && strategy.rules_profile == active_content().manifest.rules_profile
            && strategy.rules_action == binding.rules_action
            && strategy.operation == binding.operation
            && strategy.rules_pack_id == binding.pack_id
            && strategy.rules_pack_version == binding.pack_version
            && pack_matches
    }

    pub(super) fn contribution_requirement_met(
        &self,
        actor_id: u64,
        requirement: &ContributionRequirement,
    ) -> bool {
        let Some(actor) = self.actor_by_id(actor_id) else {
            return false;
        };
        match requirement {
            ContributionRequirement::AtLocation { location_id } => {
                actor.location_id == *location_id
            }
            ContributionRequirement::HeldItem { item_id } => self
                .item_by_id(*item_id)
                .is_some_and(|item| item.holder_actor_id == actor_id),
            ContributionRequirement::ActiveTag { tag_id } => {
                self.tags.get(tag_id).is_some_and(|tag| tag.active)
            }
            ContributionRequirement::RoomFeature {
                location_id,
                feature_key,
            } => {
                actor.location_id == *location_id
                    && active_content().room_features.iter().any(|feature| {
                        feature.location_id == *location_id && feature.key == *feature_key
                    })
            }
            ContributionRequirement::FeatureSearched {
                location_id,
                feature_key,
            } => self
                .tags
                .get(&room_feature_search_tag_id(*location_id, feature_key))
                .is_some_and(|tag| tag.active),
            ContributionRequirement::FeatureUsed {
                location_id,
                feature_key,
                item_id,
            } => self
                .tags
                .get(&room_feature_use_tag_id(
                    *location_id,
                    feature_key,
                    *item_id,
                ))
                .is_some_and(|tag| tag.active),
            ContributionRequirement::EncounterResolved {
                job_id,
                winning_side,
            } => self
                .tags
                .get(&combat_resolution_tag_id(job_id, *winning_side))
                .is_some_and(|tag| tag.active),
        }
    }

    pub(super) fn contribution_requirement_source_event_seq(
        &self,
        requirement: &ContributionRequirement,
    ) -> Option<u64> {
        let tag_id = match requirement {
            ContributionRequirement::ActiveTag { tag_id } => tag_id.clone(),
            ContributionRequirement::FeatureSearched {
                location_id,
                feature_key,
            } => room_feature_search_tag_id(*location_id, feature_key),
            ContributionRequirement::FeatureUsed {
                location_id,
                feature_key,
                item_id,
            } => room_feature_use_tag_id(*location_id, feature_key, *item_id),
            ContributionRequirement::EncounterResolved {
                job_id,
                winning_side,
            } => combat_resolution_tag_id(job_id, *winning_side),
            ContributionRequirement::AtLocation { .. }
            | ContributionRequirement::HeldItem { .. }
            | ContributionRequirement::RoomFeature { .. } => return None,
        };
        self.tags
            .get(&tag_id)
            .filter(|tag| tag.active)
            .and_then(|tag| tag.source_event_seq)
    }

    pub(super) fn resolve_contribution_target(
        &self,
        actor_id: u64,
        job: &JobState,
        strategy: &JobContributionStrategy,
        target_hint: Option<(&str, &str)>,
    ) -> Option<ResolvedContributionTarget> {
        let actor = self.actor_by_id(actor_id)?;
        let descriptor = &strategy.target;
        if let Some(id) = descriptor.id.as_deref() {
            if target_hint
                .is_some_and(|(kind, target_id)| kind != descriptor.kind || target_id != id)
            {
                return None;
            }
            let available = match descriptor.kind.as_str() {
                "job" => id == job.id,
                "room" => id
                    .parse::<u64>()
                    .ok()
                    .is_some_and(|location_id| actor.location_id == location_id),
                "feature" => job.location_ids.contains(&actor.location_id),
                "actor" => id.parse::<u64>().ok().is_some_and(|target_actor_id| {
                    target_actor_id != actor_id
                        && self.actor_by_id(target_actor_id).is_some_and(|target| {
                            Self::actor_can_act(target)
                                && target.location_id == actor.location_id
                                && self.actor_visible_in_projection(target, Some(actor_id), None)
                                && !self.actors_blocked(actor_id, target_actor_id)
                        })
                }),
                "item" => id.parse::<u64>().ok().is_some_and(|item_id| {
                    self.item_by_id(item_id).is_some_and(|item| {
                        item.holder_actor_id == actor_id || item.location_id == actor.location_id
                    })
                }),
                _ => false,
            };
            return available.then(|| ResolvedContributionTarget {
                kind: descriptor.kind.clone(),
                id: id.to_string(),
                label: descriptor.label.clone(),
            });
        }

        match descriptor.predicate.as_deref()? {
            "current_room" => Some(ResolvedContributionTarget {
                kind: "room".to_string(),
                id: actor.location_id.to_string(),
                label: self
                    .location_name(actor.location_id)
                    .unwrap_or_else(|| descriptor.label.clone()),
            }),
            "job_participant_here" => job
                .participant_ids
                .iter()
                .filter_map(|target_actor_id| self.actor_by_id(*target_actor_id))
                .find(|target| {
                    target.id != actor_id
                        && Self::actor_can_act(*target)
                        && target.location_id == actor.location_id
                        && self.actor_visible_in_projection(*target, Some(actor_id), None)
                        && !self.actors_blocked(actor_id, target.id)
                })
                .map(|target| ResolvedContributionTarget {
                    kind: "actor".to_string(),
                    id: target.id.to_string(),
                    label: self
                        .actor_name(target.id)
                        .unwrap_or_else(|| descriptor.label.clone()),
                }),
            "co_present_avatar" => self.world.actors[..self.world.actor_count]
                .iter()
                .find(|target| {
                    target.id != actor_id
                        && Self::actor_can_act(**target)
                        && target.location_id == actor.location_id
                        && self.actor_visible_in_projection(**target, Some(actor_id), None)
                        && !self.actors_blocked(actor_id, target.id)
                })
                .map(|target| ResolvedContributionTarget {
                    kind: "actor".to_string(),
                    id: target.id.to_string(),
                    label: self
                        .actor_name(target.id)
                        .unwrap_or_else(|| descriptor.label.clone()),
                }),
            _ => None,
        }
    }

    pub(super) fn job_contribution_record_preconditions_hold(
        &self,
        record: &JournalRecord,
    ) -> bool {
        let has_contribution = record
            .projection_mutations
            .iter()
            .any(|mutation| matches!(mutation, ProjectionMutation::ResolveJobContribution { .. }));
        if !has_contribution {
            return true;
        }
        if record.worldpack_bundle_hash != active_content().manifest.bundle_hash {
            return record.worldpack_bundle_hash.is_empty()
                || active_content()
                    .manifest
                    .persistence_compatibility
                    .replay_compatible_bundle_hashes
                    .contains(&record.worldpack_bundle_hash);
        }
        record
            .projection_mutations
            .iter()
            .filter_map(|mutation| match mutation {
                ProjectionMutation::ResolveJobContribution { intent } => Some(intent),
                _ => None,
            })
            .all(|intent| {
                self.job_contribution_intent_preconditions_hold(record.action.actor_id, intent)
                    && (record.action.kind != CW_ACTION_PROJECT_PUSH
                        || self.project_push_input(
                            record.action.actor_id,
                            intent,
                            record.action.project_push.prepared == 1,
                        ) == Some(record.action.project_push))
            })
    }

    pub(super) fn job_contribution_intent_preconditions_hold(
        &self,
        actor_id: u64,
        intent: &JobContributionIntent,
    ) -> bool {
        let Some(actor) = self.actor_by_id(actor_id) else {
            return false;
        };
        let Some(job) = self.jobs.get(&intent.job_id) else {
            return false;
        };
        let Some(current_strategy) = job
            .contribution_strategies
            .iter()
            .find(|strategy| strategy.id == intent.strategy.id)
        else {
            return false;
        };
        if !Self::actor_can_act(actor)
            || self.tired_tag_active(actor_id)
            || !job.location_ids.contains(&actor.location_id)
            || self.job_status(job) != "active"
            || current_strategy != &intent.strategy
            || !focused_job_action_available(self, actor_id, &job.id, &intent.strategy.action_kind)
            || !intent
                .strategy
                .requirements
                .iter()
                .all(|requirement| self.contribution_requirement_met(actor_id, requirement))
            || self
                .clocks
                .get(&intent.strategy.clock_id)
                .is_none_or(|clock| clock.filled >= clock.segments)
        {
            return false;
        }
        let target_hint = (intent.target.kind.as_str(), intent.target.id.as_str());
        if self.resolve_contribution_target(actor_id, job, &intent.strategy, Some(target_hint))
            != Some(intent.target.clone())
        {
            return false;
        }
        Self::contribution_claim_key(actor_id, &intent.job_id, &intent.strategy, &intent.target)
            .is_none_or(|claim_key| !self.rpg_claims.contains(&claim_key))
    }

    pub(super) fn job_contribution_intents(
        &self,
        actor_id: u64,
        action_kind: Option<&str>,
        requested_job_id: Option<&str>,
        requested_strategy_id: Option<&str>,
        target_hint: Option<(&str, &str)>,
    ) -> Vec<JobContributionIntent> {
        let Some(actor) = self.actor_by_id(actor_id) else {
            return Vec::new();
        };
        if !Self::actor_can_act(actor) || self.tired_tag_active(actor_id) {
            return Vec::new();
        }
        let mut intents = self
            .jobs
            .values()
            .filter(|job| job.delivery.is_none())
            .filter(|job| {
                requested_job_id.is_none_or(|requested| job.id == requested)
                    && job.location_ids.contains(&actor.location_id)
                    && self.job_status(job) == "active"
                    && job.contribution_schema_version == JOB_CONTRIBUTION_SCHEMA_VERSION
            })
            .flat_map(|job| {
                job.contribution_strategies
                    .iter()
                    .map(move |strategy| (job, strategy))
            })
            .filter(|(job, strategy)| {
                action_kind.is_none_or(|kind| strategy.action_kind == kind)
                    && requested_strategy_id.is_none_or(|requested| strategy.id == requested)
                    && focused_job_action_available(self, actor_id, &job.id, &strategy.action_kind)
                    && self.contribution_strategy_binding_is_active(strategy)
                    && strategy
                        .requirements
                        .iter()
                        .all(|requirement| self.contribution_requirement_met(actor_id, requirement))
                    && self
                        .clocks
                        .get(&strategy.clock_id)
                        .is_some_and(|clock| clock.filled < clock.segments)
            })
            .filter_map(|(job, strategy)| {
                let target =
                    self.resolve_contribution_target(actor_id, job, strategy, target_hint)?;
                let claim_key = Self::contribution_claim_key(actor_id, &job.id, strategy, &target);
                if claim_key
                    .as_ref()
                    .is_some_and(|claim_key| self.rpg_claims.contains(claim_key))
                {
                    return None;
                }
                Some(JobContributionIntent {
                    job_id: job.id.clone(),
                    strategy: strategy.clone(),
                    target,
                })
            })
            .collect::<Vec<_>>();
        intents.sort_by(|left, right| {
            let job_order = self
                .jobs
                .get(&left.job_id)
                .zip(self.jobs.get(&right.job_id))
                .map(|(left, right)| self.compare_job_presentation(left, right))
                .unwrap_or_else(|| left.job_id.cmp(&right.job_id));
            job_order
                .then_with(|| left.strategy.id.cmp(&right.strategy.id))
                .then_with(|| left.target.id.cmp(&right.target.id))
        });
        intents
    }

    pub(super) fn job_contribution_intent(
        &self,
        actor_id: u64,
        action_kind: &str,
        requested_job_id: Option<&str>,
        requested_strategy_id: Option<&str>,
        target_hint: Option<(&str, &str)>,
    ) -> Option<JobContributionIntent> {
        self.job_contribution_intents(
            actor_id,
            Some(action_kind),
            requested_job_id,
            requested_strategy_id,
            target_hint,
        )
        .into_iter()
        .next()
    }

    pub(super) fn exact_job_contribution_intent(
        &self,
        actor_id: u64,
        job_id: &str,
        strategy_id: &str,
    ) -> Option<JobContributionIntent> {
        self.job_contribution_intents(actor_id, None, Some(job_id), Some(strategy_id), None)
            .into_iter()
            .next()
    }

    pub(super) fn contribution_progress_amount(
        &self,
        actor_id: u64,
        intent: &JobContributionIntent,
    ) -> u8 {
        let prepared = self
            .actor_by_id(actor_id)
            .is_some_and(|actor| self.prepared_tag_active(actor_id, actor.location_id));
        if intent.strategy.action_kind == "work" {
            return self
                .project_push_input(actor_id, intent, prepared)
                .and_then(Self::resolve_project_push)
                .unwrap_or(0);
        }
        intent
            .strategy
            .baseline_progress
            .saturating_add(intent.strategy.success_progress)
            .saturating_add(if prepared {
                intent.strategy.prepared_bonus_progress
            } else {
                0
            })
    }

    pub(super) fn project_push_input(
        &self,
        actor_id: u64,
        intent: &JobContributionIntent,
        prepared: bool,
    ) -> Option<CwProjectPushInput> {
        if intent.strategy.action_kind != "work"
            || !matches!(
                intent.strategy.resolution,
                ContributionResolutionPolicy::Certain
            )
        {
            return None;
        }
        let job = self.jobs.get(&intent.job_id)?;
        let clock = self.clocks.get(&intent.strategy.clock_id)?;
        let remaining_progress = clock.segments.checked_sub(clock.filled)?;
        let location_count = u8::try_from(job.location_ids.len()).ok()?;
        let evidence_count =
            u8::try_from(self.project_location_evidence_count(actor_id, job)).ok()?;
        let base_progress = intent
            .strategy
            .baseline_progress
            .checked_add(intent.strategy.success_progress)?;
        let input = CwProjectPushInput {
            base_progress,
            prepared_bonus_progress: intent.strategy.prepared_bonus_progress,
            prepared: u8::from(prepared),
            evidence_count,
            location_count,
            remaining_progress,
        };
        Self::resolve_project_push(input).map(|_| input)
    }

    pub(super) fn resolve_project_push(input: CwProjectPushInput) -> Option<u8> {
        let mut progress = 0;
        let status = unsafe { cw_resolve_project_push(&input, &mut progress) };
        (status == CW_OK).then_some(progress)
    }

    pub(super) fn project_push_progress(
        &self,
        actor_id: u64,
        intent: &JobContributionIntent,
        prepared: bool,
    ) -> Option<u8> {
        self.project_push_input(actor_id, intent, prepared)
            .and_then(Self::resolve_project_push)
    }

    fn project_push_evidence_effect(input: CwProjectPushInput) -> u8 {
        if input.evidence_count == 0 {
            0
        } else if input.location_count > 1 && input.evidence_count == input.location_count {
            2
        } else {
            1
        }
    }

    fn project_push_evidence_text(input: CwProjectPushInput) -> String {
        let evidence_effect = Self::project_push_evidence_effect(input);
        if input.location_count == 1 {
            if input.evidence_count == 1 {
                "Evidence complete: 1/1 location (+1 prepared segment).".to_string()
            } else {
                "Evidence: 0/1 location; finding it adds 1 prepared segment.".to_string()
            }
        } else if input.evidence_count == input.location_count {
            format!(
                "Evidence complete: {}/{} locations (+{evidence_effect} prepared segments).",
                input.evidence_count, input.location_count
            )
        } else if input.evidence_count > 0 {
            format!(
                "Partial evidence: {}/{} locations (+{evidence_effect} prepared segment now); complete evidence adds 2.",
                input.evidence_count, input.location_count
            )
        } else {
            format!(
                "Evidence: 0/{} locations; any evidence adds 1 prepared segment, complete evidence adds 2.",
                input.location_count
            )
        }
    }

    pub(super) fn project_push_effect_text(
        &self,
        actor_id: u64,
        intent: &JobContributionIntent,
        prepared: bool,
        prepare_preview: bool,
    ) -> Option<String> {
        let input = self.project_push_input(actor_id, intent, prepared)?;
        let amount = Self::resolve_project_push(input)?;
        let evidence_text = Self::project_push_evidence_text(input);
        if prepare_preview {
            let direct_input = self.project_push_input(actor_id, intent, false)?;
            let direct = Self::resolve_project_push(direct_input)?;
            return Some(format!(
                "Next Push advances {amount} {}; Push now advances {direct}. {evidence_text}",
                if amount == 1 { "segment" } else { "segments" }
            ));
        }

        let gross = u16::from(input.base_progress)
            + if prepared {
                u16::from(input.prepared_bonus_progress.max(1))
                    + u16::from(Self::project_push_evidence_effect(input))
            } else {
                0
            };
        let breakdown = if prepared {
            format!(
                "{} base + {} preparation + {} evidence",
                input.base_progress,
                input.prepared_bonus_progress.max(1),
                Self::project_push_evidence_effect(input)
            )
        } else {
            format!("{} base", input.base_progress)
        };
        let cap = if u16::from(amount) < gross {
            format!(
                " Only {} remain, so {amount} of {gross} gross segments apply.",
                input.remaining_progress
            )
        } else {
            String::new()
        };
        Some(format!(
            "Advances {amount} {} now ({breakdown}).{cap} {evidence_text}",
            if amount == 1 { "segment" } else { "segments" }
        ))
    }

    fn contribution_project_view(
        &self,
        actor_id: u64,
        intent: &JobContributionIntent,
    ) -> Option<ActionProjectView> {
        let job = self.jobs.get(&intent.job_id)?;
        Some(ActionProjectView {
            id: job.id.clone(),
            verb: self
                .action_vocabulary_for_actor(actor_id)
                .map(|vocabulary| vocabulary.contribute.clone())
                .unwrap_or_else(|| "Contribute".to_string()),
            label: self.job_action_label(job),
            summary: self.job_action_summary(job),
            progress_clock_id: intent.strategy.clock_id.clone(),
            strategy_id: Some(intent.strategy.id.clone()),
            strategy_label: Some(intent.strategy.strategy_label.clone()),
            resolution: Some(
                contribution_resolution_label(&intent.strategy.resolution).to_string(),
            ),
            claim_key: Self::contribution_claim_key(
                actor_id,
                &intent.job_id,
                &intent.strategy,
                &intent.target,
            ),
        })
    }

    fn retarget_job_contribution_offer(
        &self,
        actor_id: u64,
        mut offer: RankedActionOffer,
        intent: JobContributionIntent,
    ) -> RankedActionOffer {
        let preserves_legacy_project_copy =
            matches!(intent.strategy.action_kind.as_str(), "work" | "help");
        let target = ActionTargetView {
            kind: intent.target.kind.clone(),
            id: intent.target.id.parse::<u64>().ok(),
            label: Some(intent.target.label.clone()),
        };
        let project = self.contribution_project_view(actor_id, &intent);
        let legacy_id = format!(
            "contribution:{}:{}:{}",
            intent.strategy.action_kind, intent.job_id, intent.strategy.id
        );
        offer.id = legacy_id.clone();
        offer.offer_id = format!(
            "{}:{}:{}",
            offer.rules_profile, offer.state_revision, legacy_id
        );
        offer.command = format!("contribute {}", intent.strategy.id);
        if !preserves_legacy_project_copy {
            offer.label = intent.strategy.strategy_label.clone();
            offer.accessible_label = intent.strategy.strategy_label.clone();
        }
        offer.target = Some(target.clone());
        offer.project = project.clone();
        offer.progress = Some(self.contribution_progress_amount(actor_id, &intent));
        if !preserves_legacy_project_copy {
            offer.claim_key = Self::contribution_claim_key(
                actor_id,
                &intent.job_id,
                &intent.strategy,
                &intent.target,
            );
            offer.effect = Some(format!(
                "{} advances {}",
                intent.strategy.strategy_label,
                project
                    .as_ref()
                    .map(|project| project.label.as_str())
                    .unwrap_or("the shared work")
            ));
            offer.risk = match &intent.strategy.resolution {
                ContributionResolutionPolicy::SrdCheck { dc, .. } => {
                    Some(format!("the authored check is DC {dc}"))
                }
                _ => offer.risk,
            };
        }
        if intent.strategy.action_kind == "use_item" {
            if let Ok(item_id) = intent.target.id.parse::<u64>() {
                if let Some(source) = self.item_source_collectible(item_id) {
                    offer.source_collectible = Some(source.clone());
                    offer
                        .composition_trace
                        .source_card_instances
                        .retain(|existing| existing.kind != "item");
                    offer
                        .composition_trace
                        .source_card_instances
                        .insert(0, source);
                }
                let item_name = self
                    .item_name(item_id)
                    .unwrap_or_else(|| format!("Item {item_id}"));
                offer.provider = action_provider(
                    "held_item",
                    format!("item:{item_id}"),
                    item_name.clone(),
                    format!("From {item_name} in your hand"),
                    30,
                );
            }
        } else if let Some(project) = project {
            offer.provider = action_provider(
                "job",
                format!("job:{}", project.id),
                project.label.clone(),
                format!("From {}", project.label),
                50,
            );
        }
        offer.composition_trace.target = Some(target);
        offer
    }

    pub(super) fn expand_job_contribution_offers(
        &self,
        actor_id: u64,
        offers: Vec<RankedActionOffer>,
    ) -> Vec<RankedActionOffer> {
        let mut expanded = Vec::new();
        for offer in offers {
            if !ROUTABLE_CONTRIBUTION_KINDS.contains(&offer.kind.as_str())
                || offer.project.is_none()
            {
                expanded.push(offer);
                continue;
            }
            let intents = self.job_contribution_intents(
                actor_id,
                Some(&offer.kind),
                offer.project.as_ref().map(|project| project.id.as_str()),
                None,
                None,
            );
            if intents.is_empty() {
                let schema_backed = offer
                    .project
                    .as_ref()
                    .and_then(|project| self.jobs.get(&project.id))
                    .is_some_and(|job| {
                        job.contribution_schema_version == JOB_CONTRIBUTION_SCHEMA_VERSION
                    });
                if !schema_backed {
                    expanded.push(offer);
                }
            } else {
                expanded.extend(intents.into_iter().map(|intent| {
                    self.retarget_job_contribution_offer(actor_id, offer.clone(), intent)
                }));
            }
        }
        expanded
    }

    pub(super) fn clear_job_resolved_tags_from_events(
        &mut self,
        events: &[EventView],
    ) -> Vec<EventView> {
        let mut resolved_jobs = Vec::new();
        for event in events {
            if event.type_name == "job.contribution.resolved" {
                let Some(trace) = event
                    .content
                    .as_deref()
                    .and_then(|content| serde_json::from_str::<JobContributionTrace>(content).ok())
                else {
                    continue;
                };
                let resolved = self.jobs.get(&trace.job_id).is_some_and(|job| {
                    matches!(self.job_status(job).as_str(), "completed" | "failed")
                });
                if resolved {
                    resolved_jobs.push((trace.job_id, event.actor_id.unwrap_or(0)));
                }
                continue;
            }
            if event.type_name != "job.updated" {
                continue;
            }
            let Some(content) = event.content.as_deref() else {
                continue;
            };
            let Some(status) = job_status_from_event_content(content) else {
                continue;
            };
            let Some(job_id) = job_id_from_event_content(content) else {
                continue;
            };
            if matches!(status, "completed" | "failed") {
                resolved_jobs.push((job_id, event.actor_id.unwrap_or(0)));
            }
        }
        let mut cleared = Vec::new();
        for (job_id, actor_id) in resolved_jobs {
            cleared.extend(self.clear_job_resolved_tags(&job_id, actor_id, "job_resolved"));
        }
        cleared
    }

    fn clear_job_resolved_tags(
        &mut self,
        job_id: &str,
        actor_id: u64,
        reason: &str,
    ) -> Vec<EventView> {
        let Some(job) = self.jobs.get(job_id).cloned() else {
            return Vec::new();
        };
        let tag_ids: Vec<String> = self
            .tags
            .values()
            .filter(|tag| tag.active && tag.expires.as_deref() == Some("when_job_resolves"))
            .filter(|tag| match tag.scope.as_str() {
                "room" => job.location_ids.contains(&tag.scope_id),
                "actor" => job.location_ids.iter().any(|location_id| {
                    tag.id
                        == project_preparation_spent_tag_id(
                            tag.scope_id,
                            *location_id,
                            &job.progress_clock_id,
                        )
                }),
                _ => false,
            })
            .map(|tag| tag.id.clone())
            .collect();
        tag_ids
            .into_iter()
            .filter_map(|tag_id| self.clear_rpg_tag(&tag_id, actor_id, reason))
            .collect()
    }
}

fn contribution_request_ids(
    payload: &JobContributionRequest,
) -> Result<(String, String), Json<ActionResponse>> {
    let job_id = payload
        .job_id
        .as_deref()
        .filter(|value| !value.trim().is_empty())
        .ok_or_else(|| action_offer_rejected("Contribution needs an exact job_id"))?;
    let strategy_id = payload
        .strategy_id
        .as_deref()
        .filter(|value| !value.trim().is_empty())
        .ok_or_else(|| action_offer_rejected("Contribution needs an exact strategy_id"))?;
    Ok((job_id.to_string(), strategy_id.to_string()))
}

pub(super) async fn contribute(
    ConnectInfo(client_addr): ConnectInfo<SocketAddr>,
    State(state): State<AppState>,
    Json(payload): Json<JobContributionRequest>,
) -> Json<ActionResponse> {
    let (job_id, strategy_id) = match contribution_request_ids(&payload) {
        Ok(ids) => ids,
        Err(response) => return response,
    };
    let action_kind = {
        let runtime = state.inner.lock().await;
        runtime
            .jobs
            .get(&job_id)
            .and_then(|job| {
                job.contribution_strategies
                    .iter()
                    .find(|strategy| strategy.id == strategy_id)
            })
            .map(|strategy| strategy.action_kind.clone())
    };
    let Some(action_kind) = action_kind else {
        return action_offer_rejected("That contribution strategy is no longer authored");
    };
    match action_kind.as_str() {
        "work" => {
            return work(ConnectInfo(client_addr), State(state), Json(payload)).await;
        }
        "help" => {
            return help_room(ConnectInfo(client_addr), State(state), Json(payload)).await;
        }
        _ => {}
    }
    if !allow_actor_mutation(
        &state,
        client_addr,
        payload.actor_id,
        "action-actor",
        GENERAL_ACTION_LIMIT,
    ) {
        return action_rate_limited_response();
    }
    let planned = {
        let runtime = state.inner.lock().await;
        let Some(intent) =
            runtime.exact_job_contribution_intent(payload.actor_id, &job_id, &strategy_id)
        else {
            return action_offer_rejected("That contribution strategy is no longer available");
        };
        let action = match (&*action_kind, &intent.strategy.resolution) {
            ("check", ContributionResolutionPolicy::SrdCheck { ability, dc }) => CwAction {
                kind: CW_ACTION_RULES_SEARCH,
                actor_id: payload.actor_id,
                ability: ability_from_string(ability),
                dc: *dc,
                ..CwAction::default()
            },
            ("study", ContributionResolutionPolicy::SrdCheck { ability, dc }) => CwAction {
                kind: CW_ACTION_RULES_STUDY,
                actor_id: payload.actor_id,
                ability: ability_from_string(ability),
                dc: *dc,
                ..CwAction::default()
            },
            ("use_item", ContributionResolutionPolicy::ExistingKernelOutcome { event_type })
                if event_type == "item.used" && intent.target.kind == "item" =>
            {
                let Ok(item_id) = intent.target.id.parse::<u64>() else {
                    return action_offer_rejected("That contribution item is invalid");
                };
                CwAction {
                    kind: CW_ACTION_RULES_UTILIZE_ITEM,
                    actor_id: payload.actor_id,
                    item_id,
                    ..CwAction::default()
                }
            }
            _ => {
                return action_offer_rejected(
                    "That contribution strategy has an incompatible resolution",
                );
            }
        };
        let mut mutations = vec![ProjectionMutation::ResolveJobContribution {
            intent: intent.clone(),
        }];
        if let Some(pathway_id) =
            runtime.generated_pathway_id_for_progress_clock(&intent.strategy.clock_id)
        {
            mutations.push(ProjectionMutation::UpgradePathwayIfReady {
                pathway_id,
                progress_clock_id: intent.strategy.clock_id.clone(),
            });
        }
        (action, mutations)
    };
    apply_and_broadcast_with_mutations(
        state,
        planned.0,
        payload.actor_session.as_deref(),
        planned.1,
    )
    .await
}

#[cfg(test)]
mod tests {
    use super::*;

    fn request(actor_session: &str, strategy_id: &str) -> JobContributionRequest {
        JobContributionRequest {
            actor_id: 5000,
            actor_session: Some(actor_session.to_string()),
            job_id: Some(FIRST_TALE_JOB_ID.to_string()),
            strategy_id: Some(strategy_id.to_string()),
        }
    }

    #[tokio::test]
    async fn solo_rain_garden_completes_through_check_and_work_strategies() {
        let mut runtime = RuntimeWorld::seeded();
        create_test_human(
            &mut runtime,
            5000,
            RAIN_SOFT_GARDEN_LOCATION_ID,
            "Solo Gardener",
        );
        runtime.world.actors[..runtime.world.actor_count]
            .iter_mut()
            .find(|actor| actor.id == 5000)
            .expect("test actor")
            .stats
            .wisdom = 30;
        let state = test_app_state(runtime, None);
        let (actor_session, _) = issue_actor_session(&state, 5000);
        let client_addr: SocketAddr = "127.0.0.1:43330".parse().expect("client address");

        let check = contribute(
            ConnectInfo(client_addr),
            State(state.clone()),
            Json(request(&actor_session, "inspect-washed-stones")),
        )
        .await
        .0;
        assert!(check.ok, "{:?}", check.events);
        assert!(check.events.iter().any(|event| {
            event.type_name == "job.contribution.resolved"
                && event.content.as_deref().is_some_and(|content| {
                    content.contains("\"strategy_id\":\"inspect-washed-stones\"")
                        && content.contains("\"action_kind\":\"check\"")
                })
        }));

        let prepared = prepare(
            ConnectInfo(client_addr),
            State(state.clone()),
            Json(ActorRequest {
                actor_id: 5000,
                actor_session: Some(actor_session.clone()),
            }),
        )
        .await
        .0;
        assert!(prepared.ok, "{:?}", prepared.events);

        let work = contribute(
            ConnectInfo(client_addr),
            State(state.clone()),
            Json(request(&actor_session, "clear-garden-drain")),
        )
        .await
        .0;
        assert!(work.ok, "{:?}", work.events);
        assert!(work.events.iter().any(|event| {
            event.type_name == "job.contribution.resolved"
                && event.content.as_deref().is_some_and(|content| {
                    content.contains("\"strategy_id\":\"clear-garden-drain\"")
                        && content.contains("\"action_kind\":\"work\"")
                })
        }));
        assert!(work.events.iter().any(|event| {
            event.type_name == "tag.cleared"
                && event.tag_label.as_deref() == Some("spent preparation")
        }));

        let runtime = state.inner.lock().await;
        let clock = runtime
            .clocks
            .get(FIRST_TALE_PROGRESS_CLOCK_ID)
            .expect("Rain Garden clock");
        assert_eq!(clock.filled, clock.segments);
        assert_eq!(
            runtime
                .jobs
                .get(FIRST_TALE_JOB_ID)
                .map(|job| runtime.job_status(job)),
            Some("completed".to_string())
        );
        assert!(!runtime.project_preparation_spent_for_actor(5000));
    }

    #[tokio::test]
    async fn study_strategy_derives_its_authored_ability_and_dc() {
        let mut runtime = RuntimeWorld::seeded();
        create_test_human(
            &mut runtime,
            5000,
            MOONLIT_TRAIL_LOCATION_ID,
            "Moonlit Reader",
        );
        runtime.world.actors[..runtime.world.actor_count]
            .iter_mut()
            .find(|actor| actor.id == 5000)
            .expect("test actor")
            .stats
            .intelligence = 30;
        let state = test_app_state(runtime, None);
        let (actor_session, _) = issue_actor_session(&state, 5000);

        let response = contribute(
            ConnectInfo("127.0.0.1:43332".parse().expect("client address")),
            State(state),
            Json(JobContributionRequest {
                actor_id: 5000,
                actor_session: Some(actor_session),
                job_id: Some(MOONLIT_JOB_ID.to_string()),
                strategy_id: Some("read-moonlit-signs".to_string()),
            }),
        )
        .await
        .0;

        assert!(response.ok, "{:?}", response.events);
        assert!(response.events.iter().any(|event| {
            event.type_name == "ability_check.rolled"
                && event.modifier == Some(10)
                && event.dc == Some(12)
        }));
        assert!(response
            .events
            .iter()
            .any(|event| event.type_name == "study.resolved"));
        assert!(response.events.iter().any(|event| {
            event.type_name == "job.contribution.resolved"
                && event.content.as_deref().is_some_and(|content| {
                    content.contains("\"strategy_id\":\"read-moonlit-signs\"")
                        && content.contains("\"action_kind\":\"study\"")
                })
        }));
    }

    #[tokio::test]
    async fn help_strategy_submits_through_its_exact_authored_identity() {
        let mut runtime = RuntimeWorld::seeded();
        create_test_human(
            &mut runtime,
            5000,
            MOONLIT_TRAIL_LOCATION_ID,
            "Trail Helper",
        );
        let state = test_app_state(runtime, None);
        let (actor_session, _) = issue_actor_session(&state, 5000);

        let response = contribute(
            ConnectInfo("127.0.0.1:43333".parse().expect("client address")),
            State(state),
            Json(JobContributionRequest {
                actor_id: 5000,
                actor_session: Some(actor_session),
                job_id: Some(MOONLIT_JOB_ID.to_string()),
                strategy_id: Some("steady-beside-traveler".to_string()),
            }),
        )
        .await
        .0;

        assert!(response.ok, "{:?}", response.events);
        assert!(response.events.iter().any(|event| {
            event.type_name == "job.contribution.resolved"
                && event.content.as_deref().is_some_and(|content| {
                    content.contains("\"strategy_id\":\"steady-beside-traveler\"")
                        && content.contains("\"action_kind\":\"help\"")
                })
        }));
    }

    #[tokio::test]
    async fn item_strategy_uses_its_authored_item_without_consuming_it() {
        let mut runtime = RuntimeWorld::seeded();
        create_test_human(
            &mut runtime,
            5000,
            MOONLIT_TRAIL_LOCATION_ID,
            "Marker Bearer",
        );
        let marker = runtime
            .world
            .items
            .iter_mut()
            .take(runtime.world.item_count)
            .find(|item| item.id == 2003)
            .expect("Wolfprint Charm");
        marker.location_id = 0;
        marker.holder_actor_id = 5000;
        marker.zone = CW_CARD_ZONE_CARRIED;
        let before = runtime.clocks[MOONLIT_PROGRESS_CLOCK_ID].filled;
        let state = test_app_state(runtime, None);
        let (actor_session, _) = issue_actor_session(&state, 5000);

        let response = contribute(
            ConnectInfo("127.0.0.1:43331".parse().expect("client address")),
            State(state.clone()),
            Json(JobContributionRequest {
                actor_id: 5000,
                actor_session: Some(actor_session),
                job_id: Some(MOONLIT_JOB_ID.to_string()),
                strategy_id: Some("set-wolfprint-marker".to_string()),
            }),
        )
        .await
        .0;

        assert!(response.ok, "{:?}", response.events);
        assert!(response.events.iter().any(|event| {
            event.type_name == "item.used"
                && event.actor_id == Some(5000)
                && event.item_id == Some(2003)
        }));
        assert!(response.events.iter().any(|event| {
            event.type_name == "job.contribution.resolved"
                && event.content.as_deref().is_some_and(|content| {
                    content.contains("\"strategy_id\":\"set-wolfprint-marker\"")
                        && content.contains("\"action_kind\":\"use_item\"")
                })
        }));
        let runtime = state.inner.lock().await;
        assert_eq!(runtime.clocks[MOONLIT_PROGRESS_CLOCK_ID].filled, before + 1);
        assert_eq!(runtime.item_by_id(2003).map(|item| item.charges), Some(1));
    }

    #[test]
    fn rain_garden_offers_exact_strategy_keyed_commands() {
        let mut runtime = RuntimeWorld::seeded();
        create_test_human(
            &mut runtime,
            5000,
            RAIN_SOFT_GARDEN_LOCATION_ID,
            "Offer Gardener",
        );

        let (_, offers) = runtime.legal_action_candidates(Some(5000), &AccessContext::default());
        for (kind, strategy_id) in [
            ("check", "inspect-washed-stones"),
            ("work", "clear-garden-drain"),
        ] {
            let offer = offers
                .iter()
                .find(|offer| {
                    offer.kind == kind
                        && offer.project.as_ref().is_some_and(|project| {
                            project.id == FIRST_TALE_JOB_ID
                                && project.strategy_id.as_deref() == Some(strategy_id)
                        })
                })
                .unwrap_or_else(|| panic!("missing {kind} offer for {strategy_id}"));
            assert_eq!(offer.command, format!("contribute {strategy_id}"));
            let command = runtime
                .resolve_command(
                    &CommandRequest {
                        actor_id: 5000,
                        actor_session: None,
                        command: offer.command.clone(),
                        offer_id: None,
                        wallet_address: None,
                        wallet: None,
                        wallet_session: None,
                        owned_card_ids: None,
                        cards: None,
                        envelope: None,
                    },
                    &AccessContext::default(),
                )
                .expect("advertised contribution command parses");
            assert!(matches!(
                command.dispatch,
                CommandDispatch::Contribute {
                    ref job_id,
                    ref strategy_id,
                    ref action_kind,
                } if job_id == FIRST_TALE_JOB_ID
                    && strategy_id == offer.project.as_ref().unwrap().strategy_id.as_ref().unwrap()
                    && action_kind == kind
            ));
        }
    }
}
