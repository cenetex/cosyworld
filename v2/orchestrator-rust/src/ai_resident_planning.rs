use super::*;
#[cfg(test)]
use cosyworld_orchestrator::card_policy::CardPolicyModel;
use cosyworld_orchestrator::card_policy::{
    card_kind_code_q15, CardPolicyAction, CARD_POLICY_FEATURES,
};

const RESIDENT_PLANNER_PROMPT_VERSION: &str = "resident-intent-awakening-context-v1";
const RESIDENT_PLANNER_ELIGIBILITY_POLICY: &str = "resident-planner-offers-v1";
const RESIDENT_PLANNER_ELIGIBLE_KINDS: &[&str] = &[
    "pass",
    "attack",
    "defend",
    "flee",
    "move",
    "pick_up",
    "drop_item",
    "give_item",
    "trade_item",
    "use_item",
    "use_feature",
    "cast_spell",
    "open",
    "rest",
    "search",
    "craft",
    "influence",
    NOTICE_ACTOR_OFFER_KIND,
    "check",
    "explore_path",
    "prepare",
    "work",
    "help",
    "study",
    FOCUSED_NOTICE_OFFER_KIND,
    DISCOVERY_SEARCH_OFFER_KIND,
    DISCOVERY_STUDY_OFFER_KIND,
    DISCOVERY_SCOUT_OFFER_KIND,
];

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
pub(super) struct ResidentPlannerCandidate {
    pub(super) candidate_id: String,
    pub(super) composition_id: String,
    pub(super) state_revision: u64,
    pub(super) kind: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(super) target_actor_id: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(super) item_id: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(super) target_item_id: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(super) destination_location_id: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(super) hand_generation: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(super) scene_key: Option<String>,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
pub(super) struct ResidentCardPolicySnapshot {
    pub(super) schema_version: u32,
    pub(super) hand_signature: String,
    pub(super) hand_offset: u16,
    pub(super) next_hand_offset: u16,
    pub(super) draw_count: u32,
    pub(super) hand_candidate_ids: [Option<String>; 2],
    pub(super) hand_candidate_indices: [Option<usize>; 2],
    pub(super) deck_candidate_ids: Vec<String>,
    pub(super) candidate_features_q15: Vec<Vec<i16>>,
    #[serde(default)]
    pub(super) personalization_scores_q8: Vec<i32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(super) branch_label: Option<TreasureBranchLabel>,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
pub(super) struct ResidentCardPolicyTrace {
    pub(super) schema_version: u32,
    pub(super) rollout_mode: String,
    pub(super) model_hash: u64,
    pub(super) action: CardPolicyAction,
    pub(super) top_k: usize,
    pub(super) ranked_candidate_ids: Vec<String>,
    pub(super) scores_q8: Vec<i32>,
    #[serde(default)]
    pub(super) personalization_scores_q8: Vec<i32>,
    /// Frozen per-avatar observation used for replay and gated online learning.
    pub(super) candidate_features_q15: Vec<Vec<i16>>,
    pub(super) hand_signature: String,
    pub(super) hand_offset: u16,
    pub(super) next_hand_offset: u16,
    pub(super) hand_candidate_ids: [Option<String>; 2],
    pub(super) deck_candidate_ids: Vec<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(super) branch_label: Option<TreasureBranchLabel>,
    pub(super) top_candidate_id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(super) selected_offer_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(super) llm_offer_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(super) agrees_with_llm: Option<bool>,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
pub(super) struct CardPolicyPreferenceUpdate {
    pub(super) actor_id: u64,
    pub(super) preference_key: String,
    pub(super) delta: i8,
    pub(super) reason: String,
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub(super) enum ResidentSpeechAct {
    Inform,
    Propose,
    Commit,
    Refuse,
    React,
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub(super) enum ResidentPlanningStatus {
    Absent,
    Requested,
    Proposed,
    Drew,
    Accepted,
    Committed,
    Rejected,
    Superseded,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct ResidentPlannerOutput {
    candidate_id: String,
    state_revision: u64,
    speech_act: ResidentSpeechAct,
    reason: String,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
pub(super) struct ResidentPlanningTrace {
    pub(super) schema_version: u32,
    pub(super) generation_id: String,
    pub(super) prompt_version: String,
    pub(super) actor_id: u64,
    pub(super) state_revision: u64,
    pub(super) candidates: Vec<ResidentPlannerCandidate>,
    #[serde(default)]
    pub(super) eligibility_policy: String,
    #[serde(default)]
    pub(super) eligible_offer_kinds: Vec<String>,
    pub(super) status: ResidentPlanningStatus,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(super) candidate_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(super) speech_act: Option<ResidentSpeechAct>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(super) proposal_reason: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(super) failure_code: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(super) model_attribution: Option<ModelAttribution>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(super) context_hash: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(super) card_policy: Option<ResidentCardPolicyTrace>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(super) card_policy_failure_code: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(super) supersedes_generation_id: Option<String>,
}

impl ResidentPlanningTrace {
    pub(super) fn absent(plan: &AvatarReplyPlan) -> Self {
        Self {
            schema_version: 2,
            generation_id: resident_planning_generation_id(plan),
            prompt_version: RESIDENT_PLANNER_PROMPT_VERSION.to_string(),
            actor_id: plan.speaker_actor_id,
            state_revision: plan
                .planner_candidates
                .first()
                .map(|candidate| candidate.state_revision)
                .unwrap_or_else(|| plan.observed_through_seq.unwrap_or(0)),
            candidates: plan.planner_candidates.clone(),
            eligibility_policy: RESIDENT_PLANNER_ELIGIBILITY_POLICY.to_string(),
            eligible_offer_kinds: RESIDENT_PLANNER_ELIGIBLE_KINDS
                .iter()
                .map(|kind| (*kind).to_string())
                .collect(),
            status: ResidentPlanningStatus::Absent,
            candidate_id: None,
            speech_act: None,
            proposal_reason: None,
            failure_code: None,
            model_attribution: None,
            context_hash: None,
            card_policy: None,
            card_policy_failure_code: None,
            supersedes_generation_id: None,
        }
    }

    pub(super) fn reject(&mut self, code: impl Into<String>) {
        let has_valid_proposal = matches!(
            self.status,
            ResidentPlanningStatus::Proposed | ResidentPlanningStatus::Accepted
        );
        self.status = ResidentPlanningStatus::Rejected;
        self.failure_code = Some(code.into());
        if !has_valid_proposal {
            self.candidate_id = None;
            self.speech_act = None;
            self.proposal_reason = None;
        }
    }
}

#[derive(Clone, Debug, Deserialize, Serialize)]
pub(super) struct ResidentPlanningDisposition {
    pub(super) trace: ResidentPlanningTrace,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(super) proposed_action: Option<AvatarProposedAction>,
}

#[derive(Clone, Debug)]
pub(super) struct ResidentPlanningResult {
    pub(super) proposed_action: Option<AvatarProposedAction>,
    pub(super) trace: ResidentPlanningTrace,
}

pub(super) struct ResidentPlanningLifecycleSnapshot {
    matched_pending_action: bool,
    previous_pending_action: Option<AvatarProposedAction>,
    previous_pending_planning: Option<ResidentPlanningTrace>,
}

impl RuntimeWorld {
    pub(super) fn prepare_resident_planner_snapshot(
        &self,
        mut plan: AvatarReplyPlan,
    ) -> AvatarReplyPlan {
        let inference_controlled = self
            .actor_by_id(plan.speaker_actor_id)
            .is_some_and(|actor| self.actor_uses_inference(actor.id));
        if !plan.planner_requested || !inference_controlled {
            plan.planner_requested = false;
            plan.planner_candidates.clear();
            plan.card_policy_snapshot = None;
            return plan;
        }
        plan.planner_candidates = self.resident_planner_candidates(plan.speaker_actor_id);
        plan.card_policy_snapshot = self.resident_card_policy_snapshot(plan.speaker_actor_id);
        plan
    }

    fn resident_planner_candidates(&self, actor_id: u64) -> Vec<ResidentPlannerCandidate> {
        let (_, offers) = self.legal_action_candidates(Some(actor_id), &AccessContext::default());
        let hand = self.action_hand_for(Some(actor_id), &offers);
        let mut candidates = self
            .current_action_hand_offers(actor_id, &offers)
            .into_iter()
            .filter_map(|offer| self.resident_planner_candidate_from_offer(actor_id, offer))
            .collect::<Vec<_>>();
        candidates.push(self.resident_planner_pass_candidate(actor_id, &hand));
        candidates
    }

    fn resident_card_policy_snapshot(&self, actor_id: u64) -> Option<ResidentCardPolicySnapshot> {
        let (_, offers) = self.legal_action_candidates(Some(actor_id), &AccessContext::default());
        self.resident_card_policy_snapshot_from_offers(actor_id, &offers)
    }

    fn resident_card_policy_snapshot_from_offers(
        &self,
        actor_id: u64,
        offers: &[RankedActionOffer],
    ) -> Option<ResidentCardPolicySnapshot> {
        let mut ranked_offers = offers
            .iter()
            .filter(|offer| offer.ranked_hand_eligible && action_offer_is_reachable(offer))
            .collect::<Vec<_>>();
        ranked_offers.sort_by(|left, right| {
            left.provider
                .priority
                .cmp(&right.provider.priority)
                .then_with(|| left.rank.cmp(&right.rank))
                .then_with(|| left.id.cmp(&right.id))
        });
        ranked_offers.dedup_by(|left, right| {
            action_offer_hand_group(left) == action_offer_hand_group(right)
        });
        let deck = ranked_offers
            .iter()
            .copied()
            .filter_map(|offer| {
                self.resident_planner_candidate_from_offer(actor_id, offer)
                    .map(|candidate| (offer, candidate))
            })
            .collect::<Vec<_>>();
        if deck.is_empty() {
            return None;
        }
        let offer_deck = deck.iter().map(|(offer, _)| *offer).collect::<Vec<_>>();
        let hand = self.action_hand_for(Some(actor_id), offers);
        let hand_candidate_ids = std::array::from_fn(|index| {
            hand.entries.get(index).and_then(|entry| {
                deck.iter()
                    .find(|(_, candidate)| candidate.candidate_id == entry.offer_id)
                    .map(|(_, candidate)| candidate.candidate_id.clone())
            })
        });
        let hand_candidate_indices = std::array::from_fn(|index| {
            hand_candidate_ids[index].as_ref().and_then(|candidate_id| {
                deck.iter()
                    .position(|(_, candidate)| &candidate.candidate_id == candidate_id)
            })
        });
        let hand_offset = hand_candidate_indices[0].unwrap_or_default();
        let think_slot = STORY_HAND_SLOTS
            .iter()
            .position(|slot| *slot == hand.pass.slot)
            .unwrap_or_default();
        let next_hand = self.action_hand_after_think_for(actor_id, offers, think_slot);
        let next_hand_offset = next_hand
            .entries
            .first()
            .and_then(|entry| {
                deck.iter()
                    .position(|(_, candidate)| candidate.candidate_id == entry.offer_id)
            })
            .unwrap_or(hand_offset);
        let deck_candidate_ids = deck
            .iter()
            .map(|(_, candidate)| candidate.candidate_id.clone())
            .collect::<Vec<_>>();
        let candidate_features_q15 = self
            .resident_card_policy_features(
                actor_id,
                &deck,
                u32::try_from(hand.generation).unwrap_or(u32::MAX),
            )
            .into_iter()
            .map(|features| features.to_vec())
            .collect();
        let personalization_scores_q8 = deck
            .iter()
            .map(|(offer, candidate)| {
                let key = resident_card_policy_preference_key(offer, candidate);
                i32::from(
                    self.card_policy_preferences
                        .get(&actor_id)
                        .and_then(|preferences| preferences.get(&key))
                        .copied()
                        .unwrap_or_default(),
                )
                .saturating_mul(64)
            })
            .collect();
        Some(ResidentCardPolicySnapshot {
            schema_version: 2,
            hand_signature: resident_card_policy_hand_signature(&offer_deck),
            hand_offset: hand_offset as u16,
            next_hand_offset: next_hand_offset as u16,
            draw_count: u32::try_from(hand.generation).unwrap_or(u32::MAX),
            hand_candidate_ids,
            hand_candidate_indices,
            deck_candidate_ids,
            candidate_features_q15,
            personalization_scores_q8,
            branch_label: self.treasure_branch_label(actor_id, &deck),
        })
    }

    fn resident_planner_pass_candidate(
        &self,
        _actor_id: u64,
        hand: &ActionHandView,
    ) -> ResidentPlannerCandidate {
        ResidentPlannerCandidate {
            candidate_id: hand.pass.offer_id.clone(),
            // There is no ranked action offer for Think. Its synthetic
            // composition id freezes the same focused-scene binding as the
            // certificate without letting a model supply either value.
            composition_id: format!("think:{}:{}", hand.pass.scene_key, hand.pass.slot),
            state_revision: hand.pass.state_revision,
            kind: "pass".to_string(),
            target_actor_id: None,
            item_id: None,
            target_item_id: None,
            destination_location_id: None,
            hand_generation: Some(hand.pass.generation),
            scene_key: Some(hand.pass.scene_key.clone()),
        }
    }

    pub(crate) fn resident_planner_pass_is_current(
        &self,
        actor_id: u64,
        proposal: &AvatarProposedAction,
    ) -> bool {
        if proposal.kind != "pass"
            || proposal.target_actor_id.is_some()
            || proposal.item_id.is_some()
            || proposal.target_item_id.is_some()
            || proposal.destination_location_id.is_some()
        {
            return false;
        }
        let (Some(candidate_id), Some(composition_id), Some(state_revision)) = (
            proposal.candidate_id.as_deref(),
            proposal.composition_id.as_deref(),
            proposal.state_revision,
        ) else {
            return false;
        };
        let (_, offers) = self.legal_action_candidates(Some(actor_id), &AccessContext::default());
        let hand = self.action_hand_for(Some(actor_id), &offers);
        if composition_id != format!("think:{}:{}", hand.pass.scene_key, hand.pass.slot) {
            return false;
        }
        if state_revision == hand.pass.state_revision {
            return candidate_id == hand.pass.offer_id;
        }
        let frozen_prefix = format!(
            "think:{actor_id}:{state_revision}:{}:{}:{}:",
            hand.pass.slot, hand.pass.generation, hand.pass.scene_key,
        );
        let Some(frozen_hash) = candidate_id.strip_prefix(&frozen_prefix) else {
            return false;
        };
        if frozen_hash.len() != 16 || !frozen_hash.bytes().all(|byte| byte.is_ascii_hexdigit()) {
            return false;
        }
        // Publishing the accepted resident sentence appends exactly one SAY
        // event before its selected consequence runs. That event changes the
        // generic state revision but not the selected hand generation or
        // scene. Permit only that tightly linked one-revision translation;
        // every other intervening mutation expires the frozen certificate.
        self.resident_continuities
            .get(&actor_id)
            .and_then(|continuity| continuity.pending_planning.as_ref())
            .is_some_and(|planning| {
                planning.status == ResidentPlanningStatus::Accepted
                    && planning.candidate_id.as_deref() == Some(candidate_id)
                    && planning.state_revision == state_revision
                    && proposal.planning_generation_id.as_deref()
                        == Some(planning.generation_id.as_str())
                    && hand.pass.state_revision == state_revision.saturating_add(1)
            })
    }

    pub(crate) fn resident_pending_planner_pass_record(
        &self,
        actor: CwActor,
        seed: u64,
        caused_by_event_seq: Option<u64>,
    ) -> Option<JournalRecord> {
        let proposal = self
            .resident_continuities
            .get(&actor.id)
            .and_then(|continuity| continuity.pending_action.as_ref())?;
        if !self.resident_planner_pass_is_current(actor.id, proposal) {
            return None;
        }
        let (_, offers) = self.legal_action_candidates(Some(actor.id), &AccessContext::default());
        let hand = self.action_hand_for(Some(actor.id), &offers);
        let think = hand.pass;
        let slot = STORY_HAND_SLOTS
            .iter()
            .position(|candidate| *candidate == think.slot)?;
        if !think.available {
            return None;
        }
        let mut record = JournalRecord::new(
            CwAction {
                kind: CW_ACTION_NONE,
                actor_id: actor.id,
                location_id: actor.location_id,
                ..CwAction::default()
            },
            seed,
        )
        .into_actor_consequence(self.world.tick, caused_by_event_seq);
        record.bind_offer_kind("pass");
        record.source_location_id = Some(actor.location_id);
        record
            .projection_mutations
            .push(ProjectionMutation::ThinkHand {
                slot: u8::try_from(slot).ok()?,
                scene_key: think.scene_key,
                replaces_offer_id: think.replaces_offer_id,
                free: think.free,
                reason: "resident_planner_pass".to_string(),
            });
        self.append_resident_autonomy_intent_projection(actor, &mut record);
        Some(record)
    }

    fn resident_planner_candidate_from_offer(
        &self,
        actor_id: u64,
        offer: &RankedActionOffer,
    ) -> Option<ResidentPlannerCandidate> {
        if !resident_planner_offer_kind_is_eligible(&offer.kind) {
            return None;
        }
        let actor = self.actor_by_id(actor_id)?;
        self.resident_card_policy_record_for_offer(actor, offer, 0, None)?;
        let parts = offer.id.split(':').collect::<Vec<_>>();
        let mut candidate = ResidentPlannerCandidate {
            candidate_id: offer.offer_id.clone(),
            composition_id: offer.composition_id.clone(),
            state_revision: offer.state_revision,
            kind: String::new(),
            target_actor_id: None,
            item_id: None,
            target_item_id: None,
            destination_location_id: None,
            hand_generation: None,
            scene_key: None,
        };
        if let Some(target) = offer.target.as_ref() {
            match target.kind.as_str() {
                "actor" => candidate.target_actor_id = target.id,
                "item" => candidate.item_id = target.id,
                "location" => candidate.destination_location_id = target.id,
                _ => {}
            }
        }
        match (offer.kind.as_str(), parts.as_slice()) {
            (kind @ ("check" | "use_item"), _) if offer.project.is_some() => {
                candidate.kind = kind.to_string();
            }
            ("move", ["move", destination]) => {
                candidate.kind = "move".to_string();
                candidate.destination_location_id = Some(destination.parse().ok()?);
            }
            ("pick_up", ["pick_up", item]) => {
                let item_id = item.parse().ok()?;
                self.plan_item_choice_action(actor_id, "pick_up", item_id, 0)
                    .ok()?;
                candidate.kind = "pick_up".to_string();
                candidate.item_id = Some(item_id);
            }
            ("drop_item", ["drop_item", item]) => {
                candidate.kind = "drop".to_string();
                candidate.item_id = Some(item.parse().ok()?);
            }
            ("give_item", ["give_item", item, target]) => {
                candidate.kind = "give".to_string();
                candidate.item_id = Some(item.parse().ok()?);
                candidate.target_actor_id = Some(target.parse().ok()?);
            }
            ("trade_item", ["trade_item", item, target, target_item]) => {
                candidate.kind = "trade".to_string();
                candidate.item_id = Some(item.parse().ok()?);
                candidate.target_actor_id = Some(target.parse().ok()?);
                candidate.target_item_id = Some(target_item.parse().ok()?);
            }
            ("use_item", ["use_item", item, target]) => {
                candidate.kind = "use".to_string();
                candidate.item_id = Some(item.parse().ok()?);
                candidate.target_actor_id = Some(target.parse().ok()?);
            }
            ("open", ["open", _gate, _method, destination]) => {
                candidate.kind = "open".to_string();
                candidate.destination_location_id = Some(destination.parse().ok()?);
            }
            (
                kind @ (FOCUSED_NOTICE_OFFER_KIND
                | DISCOVERY_SEARCH_OFFER_KIND
                | DISCOVERY_STUDY_OFFER_KIND
                | DISCOVERY_SCOUT_OFFER_KIND),
                _,
            ) => {
                candidate.kind = kind.to_string();
            }
            ("use_feature", ["use_feature", item, location, ..]) => {
                candidate.kind = "use_feature".to_string();
                candidate.item_id = Some(item.parse().ok()?);
                candidate.destination_location_id = Some(location.parse().ok()?);
            }
            (kind, _)
                if matches!(
                    kind,
                    "attack"
                        | "defend"
                        | "flee"
                        | "cast_spell"
                        | "rest"
                        | "search"
                        | "craft"
                        | "influence"
                        | NOTICE_ACTOR_OFFER_KIND
                        | "check"
                        | "explore_path"
                        | "prepare"
                        | "work"
                        | "help"
                        | "study"
                ) =>
            {
                candidate.kind = kind.to_string();
            }
            _ => return None,
        }
        Some(candidate)
    }

    pub(super) fn resident_card_policy_record_for_offer(
        &self,
        actor: CwActor,
        offered: &RankedActionOffer,
        seed: u64,
        caused_by_event_seq: Option<u64>,
    ) -> Option<JournalRecord> {
        let offer = self.current_reachable_offer(actor.id, offered)?;
        let mut record = match offer.kind.as_str() {
            "check" | "use_item" if offer.project.is_some() => {
                self.resident_card_policy_job_record(actor, &offer, seed)?
            }
            "rest"
            | NOTICE_ACTOR_OFFER_KIND
            | "check"
            | FOCUSED_NOTICE_OFFER_KIND
            | DISCOVERY_SEARCH_OFFER_KIND
            | DISCOVERY_STUDY_OFFER_KIND
            | DISCOVERY_SCOUT_OFFER_KIND
            | "influence"
            | "explore_path"
            | "open"
            | "search"
            | "craft" => self.resident_record_for_shared_offer(actor, &offer, seed)?,
            "prepare" => self
                .resident_card_policy_job_record(actor, &offer, seed)
                .or_else(|| self.resident_card_policy_prepare_record(actor, seed))?,
            "work" | "help" | "study" => {
                self.resident_card_policy_job_record(actor, &offer, seed)?
            }
            "use_feature" => {
                let rest = offer.id.strip_prefix("use_feature:")?;
                let mut parts = rest.splitn(3, ':');
                let item_id = parts.next()?.parse().ok()?;
                let location_id = parts.next()?.parse().ok()?;
                let feature_key = parts.next()?.trim();
                if feature_key.is_empty() {
                    return None;
                }
                let candidate = self
                    .plan_feature_use_choice(actor.id, item_id, location_id, feature_key)
                    .ok()?;
                let mut record = JournalRecord::new(
                    CwAction {
                        kind: CW_ACTION_NONE,
                        actor_id: actor.id,
                        ..CwAction::default()
                    },
                    seed,
                )
                .into_actor_consequence(self.world.tick, caused_by_event_seq);
                record
                    .projection_mutations
                    .push(ProjectionMutation::UseFeature {
                        item_id: candidate.item_id,
                        location_id: candidate.location_id,
                        feature_key: candidate.feature_key,
                        content: candidate.content,
                        reason: "resident_card_policy".to_string(),
                    });
                record
            }
            "attack" | "defend" | "flee" => {
                let action = self.plan_combat_offer_action(actor.id, &offer).ok()?;
                JournalRecord::new(action, seed)
                    .into_actor_consequence(self.world.tick, caused_by_event_seq)
            }
            "cast_spell" => {
                let item = self.default_spell_card(actor.id)?;
                let action = self.fresh_resident_autonomy_action(
                    actor,
                    CwAction {
                        kind: CW_ACTION_RULES_MAGIC,
                        actor_id: actor.id,
                        target_actor_id: actor.id,
                        item_id: item.id,
                        ..CwAction::default()
                    },
                )?;
                JournalRecord::new(action, seed)
                    .into_actor_consequence(self.world.tick, caused_by_event_seq)
            }
            "move" | "pick_up" | "drop_item" | "give_item" | "trade_item" | "use_item" => {
                let parts = offer.id.split(':').collect::<Vec<_>>();
                let requested = match (offer.kind.as_str(), parts.as_slice()) {
                    ("move", ["move", destination]) => CwAction {
                        kind: CW_ACTION_MOVE,
                        actor_id: actor.id,
                        destination_location_id: destination.parse().ok()?,
                        ..CwAction::default()
                    },
                    ("pick_up", ["pick_up", item]) => CwAction {
                        kind: CW_ACTION_PICK_UP_ITEM,
                        actor_id: actor.id,
                        item_id: item.parse().ok()?,
                        target_item_id: self
                            .deterministic_pickup_exchange_item(actor.id, item.parse().ok()?)
                            .ok()?
                            .unwrap_or_default(),
                        ..CwAction::default()
                    },
                    ("drop_item", ["drop_item", item]) => CwAction {
                        kind: CW_ACTION_DROP_ITEM,
                        actor_id: actor.id,
                        item_id: item.parse().ok()?,
                        ..CwAction::default()
                    },
                    ("give_item", ["give_item", item, target]) => CwAction {
                        kind: CW_ACTION_GIVE_ITEM,
                        actor_id: actor.id,
                        item_id: item.parse().ok()?,
                        target_actor_id: target.parse().ok()?,
                        ..CwAction::default()
                    },
                    ("trade_item", ["trade_item", item, target, target_item]) => CwAction {
                        kind: CW_ACTION_TRADE_ITEM,
                        actor_id: actor.id,
                        item_id: item.parse().ok()?,
                        target_actor_id: target.parse().ok()?,
                        target_item_id: target_item.parse().ok()?,
                        ..CwAction::default()
                    },
                    ("use_item", ["use_item", item, target]) => CwAction {
                        kind: CW_ACTION_USE_ITEM,
                        actor_id: actor.id,
                        item_id: item.parse().ok()?,
                        target_actor_id: target.parse().ok()?,
                        ..CwAction::default()
                    },
                    _ => return None,
                };
                let action = self.fresh_resident_autonomy_action(actor, requested)?;
                JournalRecord::new(action, seed)
                    .into_actor_consequence(self.world.tick, caused_by_event_seq)
            }
            _ => return None,
        };
        record.caused_by_event_seq = caused_by_event_seq;
        record.source_location_id = Some(actor.location_id);
        record.bind_offer_kind(&offer.kind);
        if offer.kind == "prepare"
            && focused_encounter_offer_context(self, actor.id, "prepare").is_some()
        {
            record.origin = JournalOrigin::PlayerControl;
        }
        record.projection_mutations.retain(|mutation| {
            !matches!(
                mutation,
                ProjectionMutation::UpdateResidentContinuity { .. }
            )
        });
        Some(record)
    }

    fn resident_card_policy_prepare_record(
        &self,
        actor: CwActor,
        seed: u64,
    ) -> Option<JournalRecord> {
        if !self.prepare_available(actor.id) {
            return None;
        }
        let mut record = JournalRecord::new(
            CwAction {
                kind: CW_ACTION_NONE,
                actor_id: actor.id,
                ..CwAction::default()
            },
            seed,
        )
        .into_actor_consequence(self.world.tick, None);
        record
            .projection_mutations
            .push(ProjectionMutation::SetTag {
                tag: RpgTagState {
                    id: prepared_tag_id(actor.id, actor.location_id),
                    scope: "actor".to_string(),
                    scope_id: actor.id,
                    label: "prepared".to_string(),
                    kind: "aspect".to_string(),
                    active: true,
                    source_event_seq: None,
                    expires: Some("after_work".to_string()),
                },
                reason: "resident_card_policy".to_string(),
            });
        Some(record)
    }

    fn resident_card_policy_job_record(
        &self,
        actor: CwActor,
        offer: &RankedActionOffer,
        seed: u64,
    ) -> Option<JournalRecord> {
        let intent = match offer.project.as_ref() {
            Some(project) => self.job_contribution_intent(
                actor.id,
                &offer.kind,
                Some(&project.id),
                project.strategy_id.as_deref(),
                None,
            )?,
            None => self.job_contribution_intent(actor.id, &offer.kind, None, None, None)?,
        };
        let progress_clock_id = intent.strategy.clock_id.clone();
        let action = match (offer.kind.as_str(), &intent.strategy.resolution) {
            ("check", ContributionResolutionPolicy::SrdCheck { ability, dc }) => CwAction {
                kind: CW_ACTION_RULES_SEARCH,
                actor_id: actor.id,
                ability: ability_from_string(ability),
                dc: *dc,
                ..CwAction::default()
            },
            ("study", ContributionResolutionPolicy::SrdCheck { ability, dc }) => CwAction {
                kind: CW_ACTION_RULES_STUDY,
                actor_id: actor.id,
                ability: ability_from_string(ability),
                dc: *dc,
                ..CwAction::default()
            },
            ("use_item", ContributionResolutionPolicy::ExistingKernelOutcome { event_type })
                if event_type == "item.used" && intent.target.kind == "item" =>
            {
                CwAction {
                    kind: CW_ACTION_RULES_UTILIZE_ITEM,
                    actor_id: actor.id,
                    item_id: intent.target.id.parse().ok()?,
                    ..CwAction::default()
                }
            }
            ("work", ContributionResolutionPolicy::Certain) => CwAction {
                kind: CW_ACTION_PROJECT_PUSH,
                actor_id: actor.id,
                project_push: self.project_push_input(
                    actor.id,
                    &intent,
                    self.prepared_tag_active(actor.id, actor.location_id),
                )?,
                ..CwAction::default()
            },
            ("prepare" | "help", _) => CwAction {
                kind: CW_ACTION_NONE,
                actor_id: actor.id,
                ..CwAction::default()
            },
            _ => return None,
        };
        let mut record =
            JournalRecord::new(action, seed).into_actor_consequence(self.world.tick, None);
        record
            .projection_mutations
            .push(ProjectionMutation::ResolveJobContribution { intent });
        if let Some(pathway_id) = self.generated_pathway_id_for_progress_clock(&progress_clock_id) {
            record
                .projection_mutations
                .push(ProjectionMutation::UpgradePathwayIfReady {
                    pathway_id,
                    progress_clock_id,
                });
        }
        Some(record)
    }

    pub(super) fn resident_card_policy_action_record(
        &self,
        plan: &AvatarReplyPlan,
        planning: &ResidentPlanningResult,
        seed: u64,
    ) -> Option<(JournalRecord, RankedActionOffer)> {
        let policy = planning.trace.card_policy.as_ref().filter(|policy| {
            policy.rollout_mode == CardPolicyRolloutMode::Live.as_str()
                && matches!(policy.action, CardPolicyAction::A | CardPolicyAction::B)
        })?;
        let selected_offer_id = policy.selected_offer_id.as_deref()?;
        let actor = self
            .actor_by_id(plan.speaker_actor_id)
            .filter(|actor| Self::actor_can_act(*actor))?;
        let (_, offers) = self.legal_action_candidates(Some(actor.id), &AccessContext::default());
        let hand = self.action_hand_for(Some(actor.id), &offers);
        let offer = offers
            .iter()
            .find(|offer| {
                offer.offer_id == selected_offer_id
                    && hand
                        .entries
                        .iter()
                        .any(|entry| entry.offer_id == offer.offer_id)
            })?
            .clone();
        let frozen = plan
            .planner_candidates
            .iter()
            .find(|candidate| candidate.candidate_id == selected_offer_id)?;
        if frozen.composition_id != offer.composition_id
            || frozen.state_revision != offer.state_revision
        {
            return None;
        }
        let mut record = self.resident_card_policy_record_for_offer(
            actor,
            &offer,
            seed,
            plan.caused_by_event_seq,
        )?;
        let mut trace = planning.trace.clone();
        trace.status = ResidentPlanningStatus::Committed;
        trace.candidate_id = Some(selected_offer_id.to_string());
        trace.failure_code = None;
        if let Some(update) =
            resident_card_policy_preference_update(plan.speaker_actor_id, &offer, frozen, policy)
        {
            record
                .projection_mutations
                .push(ProjectionMutation::UpdateCardPolicyPreference { update });
        }
        record.resident_planning = Some(trace);
        record.source_world_tick = plan.source_world_tick;
        record.observed_through_seq = plan.observed_through_seq;
        record.source_location_id = plan.source_location_id.or(Some(actor.location_id));
        Some((record, offer))
    }

    pub(super) fn resident_card_policy_draw_record(
        &self,
        plan: &AvatarReplyPlan,
        planning: &ResidentPlanningResult,
        seed: u64,
    ) -> Option<JournalRecord> {
        let policy = planning.trace.card_policy.as_ref().filter(|policy| {
            policy.rollout_mode == CardPolicyRolloutMode::Live.as_str()
                && policy.action == CardPolicyAction::Draw
        })?;
        let current = self.resident_card_policy_snapshot(plan.speaker_actor_id)?;
        if current.hand_signature != policy.hand_signature
            || current.hand_candidate_ids != policy.hand_candidate_ids
            || current.deck_candidate_ids != policy.deck_candidate_ids
            || current.deck_candidate_ids.len() <= 2
        {
            return None;
        }
        let actor = self
            .actor_by_id(plan.speaker_actor_id)
            .filter(|actor| Self::actor_can_act(*actor))?;
        let (_, offers) =
            self.legal_action_candidates(Some(plan.speaker_actor_id), &AccessContext::default());
        let hand = self.action_hand_for(Some(plan.speaker_actor_id), &offers);
        let think = hand.pass;
        let slot = STORY_HAND_SLOTS
            .iter()
            .position(|candidate| *candidate == think.slot)?;
        if !think.available {
            return None;
        }
        let mut record = JournalRecord::new(
            CwAction {
                kind: CW_ACTION_NONE,
                actor_id: actor.id,
                location_id: actor.location_id,
                ..CwAction::default()
            },
            seed,
        )
        .into_actor_consequence(self.world.tick, plan.caused_by_event_seq);
        record.bind_offer_kind("draw");
        record.source_world_tick = plan.source_world_tick;
        record.observed_through_seq = plan.observed_through_seq;
        record.source_location_id = plan.source_location_id.or(Some(actor.location_id));
        record.resident_planning = Some(planning.trace.clone());
        record
            .projection_mutations
            .push(ProjectionMutation::ThinkHand {
                slot: u8::try_from(slot).ok()?,
                scene_key: think.scene_key,
                replaces_offer_id: think.replaces_offer_id,
                free: think.free,
                reason: "resident_card_policy_draw".to_string(),
            });
        Some(record)
    }

    fn resident_card_policy_features(
        &self,
        actor_id: u64,
        deck: &[(&RankedActionOffer, ResidentPlannerCandidate)],
        draw_count: u32,
    ) -> Vec<[i16; CARD_POLICY_FEATURES]> {
        let Some(actor) = self.actor_by_id(actor_id) else {
            return vec![[0; CARD_POLICY_FEATURES]; deck.len()];
        };
        let location_id = actor.location_id;
        let visits = self.resident_location_visit_counts(actor_id);
        let searched = self.resident_searched_locations(actor_id);
        let previous_location_id = self.resident_previous_location(actor_id);
        let hinted_destinations = self
            .beliefs
            .values()
            .filter(|belief| {
                belief.holder_actor_id == actor_id
                    && belief.location_id == location_id
                    && matches!(
                        belief.kind.as_str(),
                        BELIEF_KIND_SEED_EXIT | BELIEF_KIND_HIDDEN_EXIT
                    )
            })
            .map(|belief| belief.subject_id)
            .collect::<BTreeSet<_>>();
        let location_count = self.world.location_count.max(1);
        let current_degree = self.world.exits[..self.world.exit_count]
            .iter()
            .filter(|exit| exit.from_location_id == location_id)
            .count();
        let mut observation = [0_i16; 12];
        observation[0] = card_policy_fraction_q15(location_count, 16);
        observation[1] = card_policy_fraction_q15(current_degree, 8);
        observation[2] = card_policy_fraction_q15(visits.len(), location_count);
        observation[3] = card_policy_fraction_q15(searched.len(), location_count);
        observation[4] = self
            .treasure_objectives
            .values()
            .find(|objective| objective.actor_id == actor_id && objective.active())
            .map(|objective| {
                card_policy_fraction_q15(
                    usize::from(objective.max_turns.saturating_sub(objective.turns_taken)),
                    usize::from(objective.max_turns),
                )
            })
            .unwrap_or(i16::MAX);
        observation[5] = card_policy_bool_q15(visits.get(&location_id).copied().unwrap_or(0) > 1);
        observation[6] = card_policy_bool_q15(searched.contains(&location_id));
        observation[7] = card_policy_bool_q15(!hinted_destinations.is_empty());
        observation[8] = card_policy_fraction_q15(deck.len(), 8);
        observation[9] = card_policy_bool_q15(previous_location_id.is_some());
        observation[10] = card_policy_fraction_q15(draw_count.min(4) as usize, 4);
        observation[11] = i16::MAX;

        deck.iter()
            .map(|(offer, candidate)| {
                let mut features = [0_i16; CARD_POLICY_FEATURES];
                features[..12].copy_from_slice(&observation);
                let card = self.resident_card_policy_card_features(
                    actor_id,
                    location_id,
                    offer,
                    candidate,
                    &visits,
                    &searched,
                    previous_location_id,
                    &hinted_destinations,
                );
                features[12..].copy_from_slice(&card.encoded);
                features
            })
            .collect()
    }

    #[allow(clippy::too_many_arguments)]
    fn resident_card_policy_card_features(
        &self,
        actor_id: u64,
        current_location_id: u64,
        offer: &RankedActionOffer,
        candidate: &ResidentPlannerCandidate,
        visits: &BTreeMap<u64, usize>,
        searched: &BTreeSet<u64>,
        previous_location_id: Option<u64>,
        hinted_destinations: &BTreeSet<u64>,
    ) -> ResidentEncodedCard {
        let target_id = candidate
            .destination_location_id
            .or_else(|| {
                offer
                    .target
                    .as_ref()
                    .filter(|target| target.kind == "location")
                    .and_then(|target| target.id)
            })
            .unwrap_or(current_location_id);
        let is_move = candidate.destination_location_id.is_some();
        let is_search = resident_card_kind_is_search(&candidate.kind);
        let target_visits = visits.get(&target_id).copied().unwrap_or(0);
        let target_degree = self.world.exits[..self.world.exit_count]
            .iter()
            .filter(|exit| exit.from_location_id == target_id)
            .count();
        let edge_was_used = self.event_log.iter().any(|event| {
            event.success
                && event.actor_id == Some(actor_id)
                && event.type_name == "actor.moved"
                && ((event.location_id == Some(current_location_id)
                    && event.destination_location_id == Some(target_id))
                    || (event.location_id == Some(target_id)
                        && event.destination_location_id == Some(current_location_id)))
        });
        let matches_hint = candidate
            .destination_location_id
            .is_some_and(|destination| hinted_destinations.contains(&destination));
        let kind_history = self.resident_card_kind_history_count(actor_id, &offer.kind);
        ResidentEncodedCard {
            encoded: [
                card_policy_bool_q15(is_move),
                card_policy_bool_q15(is_search),
                card_kind_code_q15(&offer.kind),
                card_policy_bool_q15(target_visits > 0),
                card_policy_bool_q15(searched.contains(&target_id)),
                card_policy_fraction_q15(target_degree, 8),
                card_policy_bool_q15(matches_hint),
                card_policy_bool_q15(previous_location_id == Some(target_id)),
                card_policy_bool_q15(if is_move {
                    edge_was_used
                } else {
                    kind_history > 0
                }),
                card_policy_fraction_q15(
                    if is_move { target_visits } else { kind_history }.min(4),
                    4,
                ),
                card_policy_fraction_q15(usize::from(offer.rank.min(100)), 100),
                i16::MAX,
            ],
        }
    }

    fn resident_card_kind_history_count(&self, actor_id: u64, kind: &str) -> usize {
        self.event_log
            .iter()
            .filter(|event| {
                event.success
                    && event.actor_id == Some(actor_id)
                    && resident_event_matches_card_kind(event.type_name.as_str(), kind)
            })
            .count()
    }

    fn resident_location_visit_counts(&self, actor_id: u64) -> BTreeMap<u64, usize> {
        let mut visits = BTreeMap::new();
        if let Some(actor) = self.actor_by_id(actor_id) {
            visits.insert(actor.location_id, 1);
        }
        for event in self
            .event_log
            .iter()
            .filter(|event| event.success && event.actor_id == Some(actor_id))
        {
            let location_id = event.destination_location_id.or(event.location_id);
            if matches!(
                event.type_name.as_str(),
                "actor.created" | "actor.entered_location" | "actor.moved"
            ) {
                if let Some(location_id) = location_id {
                    *visits.entry(location_id).or_default() += 1;
                }
            }
        }
        visits
    }

    fn resident_searched_locations(&self, actor_id: u64) -> BTreeSet<u64> {
        self.event_log
            .iter()
            .filter(|event| {
                event.success
                    && event.actor_id == Some(actor_id)
                    && matches!(
                        event.type_name.as_str(),
                        "location.searched" | "feature.searched" | "exit.discovered"
                    )
            })
            .filter_map(|event| event.location_id)
            .collect()
    }

    fn resident_previous_location(&self, actor_id: u64) -> Option<u64> {
        self.event_log
            .iter()
            .rev()
            .find(|event| {
                event.success
                    && event.actor_id == Some(actor_id)
                    && event.type_name == "actor.moved"
            })
            .and_then(|event| event.location_id)
    }

    pub(super) fn resident_planner_proposal_is_current(
        &self,
        plan: &AvatarReplyPlan,
        proposal: &AvatarProposedAction,
    ) -> bool {
        let (Some(candidate_id), Some(revision), Some(composition_id)) = (
            proposal.candidate_id.as_deref(),
            proposal.state_revision,
            proposal.composition_id.as_deref(),
        ) else {
            return false;
        };
        let Some(frozen) = plan.planner_candidates.iter().find(|candidate| {
            candidate.candidate_id == candidate_id
                && candidate.composition_id == composition_id
                && candidate.state_revision == revision
        }) else {
            return false;
        };
        if frozen.kind != proposal.kind
            || frozen.target_actor_id != proposal.target_actor_id
            || frozen.item_id != proposal.item_id
            || frozen.target_item_id != proposal.target_item_id
            || frozen.destination_location_id != proposal.destination_location_id
        {
            return false;
        }
        self.resident_planner_candidates(plan.speaker_actor_id)
            .iter()
            .any(|current| current == frozen)
    }

    pub(super) fn resident_planner_proposal_for_action(
        &self,
        actor: CwActor,
        action: &CwAction,
    ) -> Option<&AvatarProposedAction> {
        let proposal = self
            .resident_continuities
            .get(&actor.id)
            .and_then(|continuity| continuity.pending_action.as_ref())
            .filter(|proposal| proposal.planning_generation_id.is_some())?;
        let pending = self.resident_pending_proposed_action(actor)?;
        (pending.kind == action.kind
            && pending.actor_id == action.actor_id
            && pending.target_actor_id == action.target_actor_id
            && pending.item_id == action.item_id
            && pending.target_item_id == action.target_item_id
            && pending.destination_location_id == action.destination_location_id)
            .then_some(proposal)
    }

    pub(super) fn resident_planning_lifecycle_snapshot(
        &self,
        action: &CwAction,
    ) -> ResidentPlanningLifecycleSnapshot {
        let matched_pending_action = action.kind != CW_ACTION_SAY
            && self.actor_by_id(action.actor_id).is_some_and(|actor| {
                self.resident_pending_proposed_action(actor)
                    .is_some_and(|pending| {
                        pending.kind == action.kind
                            && pending.actor_id == action.actor_id
                            && pending.target_actor_id == action.target_actor_id
                            && pending.item_id == action.item_id
                            && pending.target_item_id == action.target_item_id
                            && pending.destination_location_id == action.destination_location_id
                    })
            });
        let (previous_pending_action, previous_pending_planning) = self
            .resident_continuities
            .get(&action.actor_id)
            .map(|continuity| {
                (
                    continuity.pending_action.clone(),
                    continuity.pending_planning.clone(),
                )
            })
            .unwrap_or_default();
        ResidentPlanningLifecycleSnapshot {
            matched_pending_action,
            previous_pending_action,
            previous_pending_planning,
        }
    }

    pub(super) fn apply_resident_planning_lifecycle(
        &mut self,
        record: &JournalRecord,
        status: u32,
        before: ResidentPlanningLifecycleSnapshot,
    ) {
        let resident_id = record.action.actor_id;
        let Some(continuity) = self.resident_continuities.get_mut(&resident_id) else {
            return;
        };
        if record.action.kind != CW_ACTION_SAY {
            if let Some(mut trace) = record.resident_planning.clone().filter(|trace| {
                trace.card_policy.as_ref().is_some_and(|policy| {
                    policy.rollout_mode == CardPolicyRolloutMode::Live.as_str()
                })
            }) {
                continuity.pending_action = None;
                continuity.pending_planning = None;
                if status != CW_OK {
                    trace.status = ResidentPlanningStatus::Rejected;
                    trace.failure_code = Some(format!("kernel_rejected:{status}"));
                }
                continuity.last_planning_disposition = Some(ResidentPlanningDisposition {
                    trace,
                    proposed_action: None,
                });
                return;
            }
        }
        if record.action.kind != CW_ACTION_SAY && before.matched_pending_action {
            continuity.pending_action = None;
            continuity.pending_planning = None;
            if let Some(mut trace) = before.previous_pending_planning {
                trace.status = if status == CW_OK {
                    ResidentPlanningStatus::Committed
                } else {
                    trace.failure_code = Some(format!("kernel_rejected:{status}"));
                    ResidentPlanningStatus::Rejected
                };
                continuity.last_planning_disposition = Some(ResidentPlanningDisposition {
                    trace,
                    proposed_action: before.previous_pending_action,
                });
            }
            return;
        }
        if status != CW_OK {
            return;
        }
        let Some(incoming) = record.resident_planning.clone() else {
            return;
        };
        match incoming.status {
            ResidentPlanningStatus::Accepted => {
                if before
                    .previous_pending_planning
                    .as_ref()
                    .is_some_and(|previous| previous.generation_id != incoming.generation_id)
                {
                    let mut superseded = before
                        .previous_pending_planning
                        .expect("checked previous generation");
                    superseded.status = ResidentPlanningStatus::Superseded;
                    continuity.last_planning_disposition = Some(ResidentPlanningDisposition {
                        trace: superseded,
                        proposed_action: before.previous_pending_action,
                    });
                }
                continuity.pending_planning = Some(incoming);
            }
            ResidentPlanningStatus::Rejected
            | ResidentPlanningStatus::Superseded
            | ResidentPlanningStatus::Committed => {
                if continuity
                    .last_planning_disposition
                    .as_ref()
                    .is_some_and(|disposition| {
                        disposition.trace.generation_id == incoming.generation_id
                    })
                {
                    continuity.last_planning_disposition = None;
                }
            }
            _ => {}
        }
    }
}

#[derive(Clone, Copy)]
struct ResidentEncodedCard {
    encoded: [i16; 12],
}

fn card_policy_bool_q15(value: bool) -> i16 {
    if value {
        i16::MAX
    } else {
        0
    }
}

fn resident_card_policy_hand_signature(offers: &[&RankedActionOffer]) -> String {
    let mut hash = 0xcbf2_9ce4_8422_2325_u64;
    for offer in offers {
        for byte in offer.offer_id.bytes().chain(core::iter::once(0)) {
            hash ^= u64::from(byte);
            hash = hash.wrapping_mul(0x0000_0100_0000_01b3);
        }
    }
    format!("{hash:016x}")
}

fn resident_card_policy_preference_key(
    offer: &RankedActionOffer,
    candidate: &ResidentPlannerCandidate,
) -> String {
    format!(
        "{}:actor={}:item={}:target_item={}:destination={}",
        offer.kind,
        candidate.target_actor_id.unwrap_or_default(),
        candidate.item_id.unwrap_or_default(),
        candidate.target_item_id.unwrap_or_default(),
        candidate.destination_location_id.unwrap_or_default(),
    )
}

fn resident_card_policy_preference_update(
    actor_id: u64,
    offer: &RankedActionOffer,
    candidate: &ResidentPlannerCandidate,
    policy: &ResidentCardPolicyTrace,
) -> Option<CardPolicyPreferenceUpdate> {
    let label = policy.branch_label.as_ref()?;
    let selected_index = policy
        .deck_candidate_ids
        .iter()
        .position(|candidate_id| candidate_id == &offer.offer_id)?;
    let selected_loss = *label.child_losses.get(selected_index)?;
    let best_loss = *label.child_losses.iter().min()?;
    let regret = selected_loss.saturating_sub(best_loss);
    Some(CardPolicyPreferenceUpdate {
        actor_id,
        preference_key: resident_card_policy_preference_key(offer, candidate),
        delta: if regret == 0 { 1 } else { -1 },
        reason: format!("treasure_branch_regret:{regret}"),
    })
}

pub(super) fn card_policy_preference_record_preconditions_hold(record: &JournalRecord) -> bool {
    let updates = record
        .projection_mutations
        .iter()
        .filter_map(|mutation| match mutation {
            ProjectionMutation::UpdateCardPolicyPreference { update } => Some(update),
            _ => None,
        })
        .collect::<Vec<_>>();
    if updates.is_empty() {
        return true;
    }
    if updates.len() != 1 || record.action.kind == CW_ACTION_SAY {
        return false;
    }
    let update = updates[0];
    if update.actor_id == 0
        || update.actor_id != record.action.actor_id
        || update.preference_key.is_empty()
        || update.preference_key.len() > 256
        || update
            .preference_key
            .chars()
            .any(|character| character.is_control())
        || !matches!(update.delta, -1 | 1)
    {
        return false;
    }
    let Some(policy) = record
        .resident_planning
        .as_ref()
        .and_then(|planning| planning.card_policy.as_ref())
    else {
        return false;
    };
    let Some(label) = policy.branch_label.as_ref() else {
        return false;
    };
    let Some(selected_offer_id) = policy.selected_offer_id.as_ref() else {
        return false;
    };
    let Some(selected_index) = policy
        .deck_candidate_ids
        .iter()
        .position(|candidate_id| candidate_id == selected_offer_id)
    else {
        return false;
    };
    let Some(selected_loss) = label.child_losses.get(selected_index) else {
        return false;
    };
    let Some(best_loss) = label.child_losses.iter().min() else {
        return false;
    };
    update.delta == if selected_loss == best_loss { 1 } else { -1 }
}

fn card_policy_fraction_q15(numerator: usize, denominator: usize) -> i16 {
    if denominator == 0 {
        return 0;
    }
    ((numerator.min(denominator) as u64 * i16::MAX as u64) / denominator as u64) as i16
}

fn resident_card_kind_is_search(kind: &str) -> bool {
    matches!(
        kind,
        "search"
            | "check"
            | NOTICE_ACTOR_OFFER_KIND
            | "study"
            | FOCUSED_NOTICE_OFFER_KIND
            | DISCOVERY_SEARCH_OFFER_KIND
            | DISCOVERY_STUDY_OFFER_KIND
            | DISCOVERY_SCOUT_OFFER_KIND
    )
}

fn resident_event_matches_card_kind(event_type: &str, kind: &str) -> bool {
    match kind {
        "move" | "explore_path" => event_type == "actor.moved",
        "flee" => matches!(event_type, "actor.moved" | "combat.flee.success"),
        "pick_up" => event_type == "item.picked_up",
        "drop_item" => event_type == "item.dropped",
        "give_item" => event_type == "item.given",
        "trade_item" => event_type == "item.traded",
        "use_item" | "use_feature" => event_type == "item.used",
        "cast_spell" => event_type == "magic.spell_cast",
        "rest" => event_type == "actor.rested",
        "search" | FOCUSED_NOTICE_OFFER_KIND | DISCOVERY_SEARCH_OFFER_KIND => matches!(
            event_type,
            "location.searched" | "feature.searched" | "discovery.resolved"
        ),
        NOTICE_ACTOR_OFFER_KIND => event_type == "notice.actor_observed",
        DISCOVERY_STUDY_OFFER_KIND | "study" => {
            matches!(event_type, "location.studied" | "discovery.resolved")
        }
        DISCOVERY_SCOUT_OFFER_KIND => event_type == "discovery.resolved",
        "craft" => event_type == "item.crafted",
        "influence" => event_type == "influence.committed",
        "check" => event_type == "ability_check.rolled",
        "prepare" | "work" | "help" => event_type.starts_with("job."),
        "attack" => matches!(
            event_type,
            "combat.attack.attempt" | "combat.attack.hit" | "combat.attack.miss"
        ),
        "defend" => event_type == "combat.defend",
        _ => false,
    }
}

fn resident_planner_offer_kind_is_eligible(kind: &str) -> bool {
    RESIDENT_PLANNER_ELIGIBLE_KINDS.contains(&kind)
}

pub(super) fn request_resident_card_policy(
    rollout: &CardPolicyRollout,
    plan: &AvatarReplyPlan,
) -> ResidentPlanningResult {
    let mut trace = ResidentPlanningTrace::absent(plan);
    trace.status = ResidentPlanningStatus::Requested;
    match resident_card_policy_trace(rollout, plan) {
        Ok(policy) => resident_card_policy_result(plan, trace, policy),
        Err(code) => {
            trace.reject(code.clone());
            trace.card_policy_failure_code = Some(code);
            ResidentPlanningResult {
                proposed_action: None,
                trace,
            }
        }
    }
}

pub(super) async fn request_resident_plan(
    config: &AiConfig,
    plan: &AvatarReplyPlan,
) -> ResidentPlanningResult {
    if !plan.planner_requested || plan.planner_candidates.is_empty() {
        return ResidentPlanningResult {
            proposed_action: None,
            trace: ResidentPlanningTrace::absent(plan),
        };
    }
    let mut trace = ResidentPlanningTrace::absent(plan);
    trace.status = ResidentPlanningStatus::Requested;
    let card_policy = config
        .card_policy
        .as_deref()
        .map(|rollout| resident_card_policy_trace(rollout, plan));
    if let Some(Ok(card_policy_trace)) = card_policy.as_ref() {
        if config
            .card_policy
            .as_ref()
            .is_some_and(|rollout| rollout.mode == CardPolicyRolloutMode::Live)
        {
            return resident_card_policy_result(plan, trace, card_policy_trace.clone());
        }
    }
    if let Some(Err(code)) = card_policy.as_ref() {
        trace.card_policy_failure_code = Some(code.clone());
    }
    let candidates =
        serde_json::to_string(&plan.planner_candidates).unwrap_or_else(|_| "[]".to_string());
    let spine = if plan.context_spine.is_current() {
        plan.context_spine.clone()
    } else {
        AvatarContextSpine {
            schema_version: AVATAR_CONTEXT_SPINE_VERSION,
            speaker: AvatarContextActor {
                actor_id: plan.speaker_actor_id,
                name: plan.speaker_name.clone(),
                description: plan.resident_continuity.stable_identity.clone(),
                voice: plan.speaker_voice.clone(),
                calling: default_calling_statement().to_string(),
                control_mode: "autonomous".to_string(),
                level: 1,
                ..AvatarContextActor::default()
            },
            location: AvatarContextLocation {
                location_id: plan.location_id,
                name: plan.location_name.clone(),
                title: plan.location_title.clone(),
                description: plan.location_description.clone(),
                persona: plan.location_persona.clone(),
            },
            current_beat: plan.user_text.clone(),
            goals: plan.goals.clone(),
            location_evidence: plan.location_evidence.clone(),
            public_room_memory: plan.public_room_memory.clone(),
            cast: plan.cast.clone(),
            recent_activity: plan.recent_activity.clone(),
            ..AvatarContextSpine::default()
        }
    };
    let rendered_spine = spine
        .prompt(AvatarContextPromptOptions {
            mode: AvatarContextMode::Think,
            speech_mode: SpeechMode::Prose,
            max_words: 45,
            response_job: "present motive · legal candidate only · no new fact".to_string(),
        })
        .render_for(Some(32_768), 120);
    let spine_context = format!(
        "AWAKENING\n{}\nSCENE\n{}",
        rendered_spine.system, rendered_spine.user
    );
    let system = "You are a bounded intent selector. Select exactly one candidate from the supplied authoritative planner-eligible list. Return one JSON object only. Echo candidate_id and state_revision exactly. speech_act must be inform, propose, commit, refuse, or react. reason is private proposal metadata, not a world fact. Never invent an action, target, item, destination, cost, outcome, reward, belief, candidate, or revision.";
    let user = format!(
        "Avatar context spine:\n{spine_context}\nEligibility policy: {policy}; closed offer kinds: {eligible_kinds}\nExact current planner-eligible legal candidates:\n{candidates}\nReturn only {{\"candidate_id\":\"exact id\",\"state_revision\":0,\"speech_act\":\"inform|propose|commit|refuse|react\",\"reason\":\"brief in-character motive\"}}.",
        policy = RESIDENT_PLANNER_ELIGIBILITY_POLICY,
        eligible_kinds = RESIDENT_PLANNER_ELIGIBLE_KINDS.join(","),
    );
    let response_format = serde_json::json!({ "type": "json_object" });
    let completion = request_chat_completion(
        config,
        ChatCompletionRequest {
            feature: "resident_intent",
            prompt_version: RESIDENT_PLANNER_PROMPT_VERSION,
            capability: ModelCapability::IntentJson,
            system,
            user: &user,
            temperature: 0.0,
            max_tokens: 100,
            timeout: Duration::from_secs(8),
            max_attempts: 1,
            referer: "http://127.0.0.1:3102",
            response_format: Some(&response_format),
            room_id: Some(plan.location_id),
        },
    )
    .await;
    let text = match completion {
        Ok(completion) => {
            trace.model_attribution = completion.model_attribution;
            trace.context_hash = Some(completion.context_hash);
            completion.text
        }
        Err(error) => {
            trace.reject(format!("planner_unavailable:{}", error.code()));
            return ResidentPlanningResult {
                proposed_action: None,
                trace,
            };
        }
    };
    let proposed_action = validate_resident_planner_output(plan, &text, &mut trace);
    if let Some(Ok(mut card_policy_trace)) = card_policy {
        card_policy_trace.llm_offer_id = trace.candidate_id.clone();
        card_policy_trace.agrees_with_llm = Some(
            card_policy_trace.selected_offer_id.is_some()
                && card_policy_trace.selected_offer_id == trace.candidate_id,
        );
        trace.card_policy = Some(card_policy_trace);
    }
    ResidentPlanningResult {
        proposed_action,
        trace,
    }
}

fn resident_card_policy_trace(
    rollout: &CardPolicyRollout,
    plan: &AvatarReplyPlan,
) -> Result<ResidentCardPolicyTrace, String> {
    let snapshot = plan
        .card_policy_snapshot
        .as_ref()
        .ok_or_else(|| "card_policy_snapshot_missing".to_string())?;
    if snapshot.schema_version != 2 {
        return Err("card_policy_snapshot_version".to_string());
    }
    if snapshot.deck_candidate_ids.len() != snapshot.candidate_features_q15.len()
        || snapshot.deck_candidate_ids.is_empty()
        || snapshot.deck_candidate_ids.len() != snapshot.personalization_scores_q8.len()
        || snapshot
            .branch_label
            .as_ref()
            .is_some_and(|label| label.child_losses.len() != snapshot.deck_candidate_ids.len())
    {
        return Err("card_policy_deck_shape".to_string());
    }
    let candidate_features = snapshot
        .candidate_features_q15
        .iter()
        .map(|features| {
            let features: &[i16; CARD_POLICY_FEATURES] = features
                .as_slice()
                .try_into()
                .map_err(|_| "card_policy_feature_shape".to_string())?;
            Ok::<[i16; CARD_POLICY_FEATURES], String>(*features)
        })
        .collect::<Result<Vec<[i16; CARD_POLICY_FEATURES]>, _>>()?;
    let mut decision = rollout
        .model
        .rank(&candidate_features)
        .map_err(|_| "card_policy_inference_failed".to_string())?;
    for (score, personalization) in decision
        .scores_q8
        .iter_mut()
        .zip(&snapshot.personalization_scores_q8)
    {
        *score = score.saturating_add(*personalization);
    }
    decision
        .ranked_candidate_indices
        .sort_by_key(|index| (std::cmp::Reverse(decision.scores_q8[*index]), *index));
    let action = decision
        .action_for_hand(snapshot.hand_candidate_indices, rollout.top_k)
        .map_err(|_| "card_policy_adapter_failed".to_string())?;
    let selected_offer_id = match action {
        CardPolicyAction::A => snapshot.hand_candidate_ids[0].clone(),
        CardPolicyAction::B => snapshot.hand_candidate_ids[1].clone(),
        CardPolicyAction::Draw => None,
    };
    let ranked_candidate_ids = decision
        .ranked_candidate_indices
        .iter()
        .map(|index| snapshot.deck_candidate_ids[*index].clone())
        .collect::<Vec<_>>();
    Ok(ResidentCardPolicyTrace {
        schema_version: 2,
        rollout_mode: rollout.mode.as_str().to_string(),
        model_hash: rollout.model_hash,
        action,
        top_k: rollout.top_k,
        top_candidate_id: ranked_candidate_ids[0].clone(),
        ranked_candidate_ids,
        scores_q8: decision.scores_q8,
        personalization_scores_q8: snapshot.personalization_scores_q8.clone(),
        candidate_features_q15: snapshot.candidate_features_q15.clone(),
        hand_signature: snapshot.hand_signature.clone(),
        hand_offset: snapshot.hand_offset,
        next_hand_offset: snapshot.next_hand_offset,
        hand_candidate_ids: snapshot.hand_candidate_ids.clone(),
        deck_candidate_ids: snapshot.deck_candidate_ids.clone(),
        branch_label: snapshot.branch_label.clone(),
        selected_offer_id,
        llm_offer_id: None,
        agrees_with_llm: None,
    })
}

fn resident_card_policy_result(
    plan: &AvatarReplyPlan,
    mut trace: ResidentPlanningTrace,
    card_policy: ResidentCardPolicyTrace,
) -> ResidentPlanningResult {
    trace.model_attribution = None;
    trace.context_hash = Some(format!("card-policy:{:016x}", card_policy.model_hash));
    trace.card_policy = Some(card_policy.clone());
    if card_policy.action == CardPolicyAction::Draw {
        trace.status = ResidentPlanningStatus::Drew;
        trace.speech_act = Some(ResidentSpeechAct::React);
        trace.proposal_reason =
            Some("The bounded policy Thought about one Story Hand card.".to_string());
        return ResidentPlanningResult {
            proposed_action: None,
            trace,
        };
    }
    let candidate = card_policy
        .selected_offer_id
        .as_deref()
        .and_then(|offer_id| {
            plan.planner_candidates
                .iter()
                .find(|candidate| candidate.candidate_id == offer_id)
        });
    let Some(candidate) = candidate else {
        trace.reject("card_policy_candidate_missing");
        return ResidentPlanningResult {
            proposed_action: None,
            trace,
        };
    };
    trace.status = ResidentPlanningStatus::Proposed;
    trace.candidate_id = Some(candidate.candidate_id.clone());
    trace.speech_act = Some(ResidentSpeechAct::Propose);
    trace.proposal_reason = Some(format!(
        "The bounded policy selected card {}.",
        match card_policy.action {
            CardPolicyAction::A => "A",
            CardPolicyAction::B => "B",
            CardPolicyAction::Draw => unreachable!(),
        }
    ));
    ResidentPlanningResult {
        proposed_action: Some(AvatarProposedAction {
            kind: candidate.kind.clone(),
            target_actor_id: candidate.target_actor_id,
            item_id: candidate.item_id,
            target_item_id: candidate.target_item_id,
            destination_location_id: candidate.destination_location_id,
            candidate_id: Some(candidate.candidate_id.clone()),
            composition_id: Some(candidate.composition_id.clone()),
            state_revision: Some(candidate.state_revision),
            planning_generation_id: Some(trace.generation_id.clone()),
            speech_act: Some(ResidentSpeechAct::Propose),
            reason: None,
        }),
        trace,
    }
}

fn validate_resident_planner_output(
    plan: &AvatarReplyPlan,
    text: &str,
    trace: &mut ResidentPlanningTrace,
) -> Option<AvatarProposedAction> {
    let output = match serde_json::from_str::<ResidentPlannerOutput>(text.trim()) {
        Ok(output) => output,
        Err(_) => {
            trace.reject("planner_invalid_json");
            return None;
        }
    };
    let Some(candidate) = plan.planner_candidates.iter().find(|candidate| {
        candidate.candidate_id == output.candidate_id
            && candidate.state_revision == output.state_revision
    }) else {
        trace.reject("planner_candidate_mismatch");
        return None;
    };
    let reason = sanitize_planner_reason(&output.reason);
    if reason.is_none() {
        trace.reject("planner_invalid_reason");
        return None;
    }
    trace.status = ResidentPlanningStatus::Proposed;
    trace.candidate_id = Some(candidate.candidate_id.clone());
    trace.speech_act = Some(output.speech_act);
    trace.proposal_reason = reason.clone();
    Some(AvatarProposedAction {
        kind: candidate.kind.clone(),
        target_actor_id: candidate.target_actor_id,
        item_id: candidate.item_id,
        target_item_id: candidate.target_item_id,
        destination_location_id: candidate.destination_location_id,
        candidate_id: Some(candidate.candidate_id.clone()),
        composition_id: Some(candidate.composition_id.clone()),
        state_revision: Some(candidate.state_revision),
        planning_generation_id: Some(trace.generation_id.clone()),
        speech_act: Some(output.speech_act),
        reason: None,
    })
}

pub(super) fn resident_planning_generation_id(plan: &AvatarReplyPlan) -> String {
    format!(
        "resident-plan:{}:{}:{}",
        plan.speaker_actor_id,
        plan.publication_beat_id,
        plan.planner_candidates
            .first()
            .map(|candidate| candidate.state_revision)
            .unwrap_or_else(|| plan.observed_through_seq.unwrap_or(0))
    )
}

fn sanitize_planner_reason(value: &str) -> Option<String> {
    let value = value.split_whitespace().collect::<Vec<_>>().join(" ");
    let count = value.chars().count();
    (count > 0 && count <= 180 && !value.chars().any(char::is_control)).then_some(value)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn planning_speech_record(
        runtime: &RuntimeWorld,
        mut trace: ResidentPlanningTrace,
        proposed_action: Option<AvatarProposedAction>,
        speech: &str,
        seed: u64,
    ) -> JournalRecord {
        let content_id = runtime.next_content_id_value();
        let mut record = JournalRecord::new(
            CwAction {
                kind: CW_ACTION_SAY,
                actor_id: RATI_ACTOR_ID,
                content_id,
                ..CwAction::default()
            },
            seed,
        );
        record
            .content_upserts
            .insert(content_id, speech.to_string());
        if proposed_action.is_some() {
            trace.status = ResidentPlanningStatus::Accepted;
        }
        record.resident_planning = Some(trace);
        record
            .projection_mutations
            .push(ProjectionMutation::UpdateResidentContinuity {
                resident_id: RATI_ACTOR_ID,
                proposal: AvatarIntentProposal {
                    speech: speech.to_string(),
                    intent: None,
                    belief: None,
                    desire: None,
                    promise: None,
                    refusal: None,
                    proposed_action,
                },
                reason: "resident_intent".to_string(),
            });
        record
    }

    fn plan_with_candidate() -> AvatarReplyPlan {
        let runtime = RuntimeWorld::seeded();
        let mut plan = runtime
            .resident_reply_plan_for_target(RATI_ACTOR_ID, SKULL_ACTOR_ID, "The kettle tipped.")
            .expect("seeded residents share a room");
        plan.planner_requested = true;
        plan.planner_candidates = vec![ResidentPlannerCandidate {
            candidate_id: "cosy:77:move:2".to_string(),
            composition_id: "composition-move".to_string(),
            state_revision: 77,
            kind: "move".to_string(),
            target_actor_id: None,
            item_id: None,
            target_item_id: None,
            destination_location_id: Some(2),
            hand_generation: None,
            scene_key: None,
        }];
        plan
    }

    fn prepared_card_policy_plan(runtime: &RuntimeWorld) -> AvatarReplyPlan {
        let mut plan = runtime
            .resident_reply_plan_for_target(RATI_ACTOR_ID, SKULL_ACTOR_ID, "The kettle tipped.")
            .expect("seeded residents share a room");
        plan.planner_requested = true;
        let mut plan = runtime.prepare_resident_planner_snapshot(plan);
        assert!(plan.planner_candidates.len() >= 3);
        assert!(plan
            .card_policy_snapshot
            .as_ref()
            .is_some_and(|snapshot| snapshot.deck_candidate_ids.len() >= 3));
        // Seeded discovery offers intentionally collapse to the same semantic
        // feature vector. Give this inference-path fixture one varying signal;
        // deck-order invariance is covered by the library adapter tests.
        if let Some(snapshot) = plan.card_policy_snapshot.as_mut() {
            let denominator = snapshot.candidate_features_q15.len().saturating_sub(1);
            for (index, features) in snapshot.candidate_features_q15.iter_mut().enumerate() {
                features[23] = card_policy_fraction_q15(index, denominator);
            }
        }
        plan
    }

    fn live_rollout_selecting(
        plan: &AvatarReplyPlan,
        target: CardPolicyAction,
    ) -> Arc<CardPolicyRollout> {
        let snapshot = plan
            .card_policy_snapshot
            .as_ref()
            .expect("prepared ranker snapshot");
        let features = snapshot
            .candidate_features_q15
            .iter()
            .map(|features| {
                let features: &[i16; CARD_POLICY_FEATURES] =
                    features.as_slice().try_into().expect("fixed feature shape");
                *features
            })
            .collect::<Vec<[i16; CARD_POLICY_FEATURES]>>();
        for seed in 0..10_000 {
            let model = CardPolicyModel::new(seed);
            if model
                .rank(&features)
                .expect("ranker inference")
                .action_for_hand(snapshot.hand_candidate_indices, 1)
                .expect("hand adapter")
                == target
            {
                return Arc::new(CardPolicyRollout {
                    mode: CardPolicyRolloutMode::Live,
                    model_hash: model.model_hash(),
                    model: Arc::new(model),
                    top_k: 1,
                });
            }
        }
        panic!("no deterministic test model selected {target:?}");
    }

    #[test]
    fn strict_planner_output_rejects_extra_and_invented_fields() {
        assert!(serde_json::from_str::<ResidentPlannerOutput>(
            r#"{"candidate_id":"cosy:77:move:2","state_revision":77,"speech_act":"propose","reason":"Step outside.","kind":"move"}"#
        )
        .is_err());
        assert!(serde_json::from_str::<ResidentPlannerOutput>(
            r#"{"candidate_id":"cosy:77:move:2","state_revision":77,"speech_act":"propose","reason":"Step outside.","success":true}"#
        )
        .is_err());
    }

    #[tokio::test]
    async fn live_ranker_selects_only_a_b_or_draw_without_calling_remote_planner() {
        let runtime = RuntimeWorld::seeded();
        let plan = prepared_card_policy_plan(&runtime);
        let snapshot = plan.card_policy_snapshot.as_ref().unwrap();
        // The seeded hand's A and B cards have identical policy features, so
        // deterministic deck-order tie-breaking correctly makes B unreachable
        // in this fixture. The ranker unit test covers the B adapter path.
        for action in [CardPolicyAction::A, CardPolicyAction::Draw] {
            let config = AiConfig {
                card_policy: Some(live_rollout_selecting(&plan, action)),
                ..AiConfig::default()
            };
            let result = request_resident_plan(&config, &plan).await;
            let policy = result
                .trace
                .card_policy
                .as_ref()
                .expect("live decision is traced");
            assert_eq!(policy.action, action);
            assert_eq!(policy.rollout_mode, "live");
            assert!(result.trace.model_attribution.is_none());
            match action {
                CardPolicyAction::A | CardPolicyAction::B => {
                    let slot = action.index();
                    assert_eq!(
                        result
                            .proposed_action
                            .as_ref()
                            .and_then(|proposal| proposal.candidate_id.as_ref()),
                        snapshot.hand_candidate_ids[slot].as_ref()
                    );
                    assert_eq!(result.trace.status, ResidentPlanningStatus::Proposed);
                }
                CardPolicyAction::Draw => {
                    assert!(result.proposed_action.is_none());
                    assert_eq!(result.trace.status, ResidentPlanningStatus::Drew);
                }
            }
        }
    }

    #[test]
    fn every_ranked_resident_card_is_executable_or_an_explicit_dialogue_card() {
        let runtime = RuntimeWorld::seeded();
        let mut unsupported = BTreeSet::new();
        let mut checked = 0;
        for actor in runtime.world.actors[..runtime.world.actor_count]
            .iter()
            .copied()
            .filter(|actor| {
                RuntimeWorld::actor_can_act(*actor) && runtime.actor_uses_inference(actor.id)
            })
        {
            let (_, offers) =
                runtime.legal_action_candidates(Some(actor.id), &AccessContext::default());
            for offer in offers
                .iter()
                .filter(|offer| offer.ranked_hand_eligible && action_offer_is_reachable(offer))
            {
                if !resident_planner_offer_kind_is_eligible(&offer.kind) {
                    unsupported.insert(offer.kind.clone());
                    continue;
                }
                let Some(candidate) =
                    runtime.resident_planner_candidate_from_offer(actor.id, offer)
                else {
                    // Some shared offer views remain visible outside their
                    // tighter turn/focus preconditions. They are not part of
                    // the resident policy deck until the exact resolver accepts
                    // them in this state.
                    continue;
                };
                let actor = runtime.actor_by_id(actor.id).expect("seeded actor");
                assert!(runtime
                    .resident_card_policy_record_for_offer(actor, offer, 7, None)
                    .is_some());
                assert_eq!(candidate.candidate_id, offer.offer_id);
                checked += 1;
            }
            if let Some(snapshot) =
                runtime.resident_card_policy_snapshot_from_offers(actor.id, &offers)
            {
                for candidate_id in snapshot.deck_candidate_ids {
                    let offer = offers
                        .iter()
                        .find(|offer| offer.offer_id == candidate_id)
                        .expect("policy deck identity came from the current legal offers");
                    assert!(runtime
                        .resident_card_policy_record_for_offer(actor, offer, 8, None)
                        .is_some());
                }
            }
        }
        assert!(checked > 0);
        assert!(
            unsupported.is_subset(&BTreeSet::from([
                "chat".to_string(),
                "create_bond".to_string(),
                "resolve_bond".to_string(),
                "player_growth".to_string(),
                "theft".to_string(),
            ])),
            "new ranked card kinds need an exact resident adapter or an explicit controller exclusion: {unsupported:?}"
        );
    }

    #[test]
    fn avatar_preference_history_changes_only_that_avatars_scores() {
        let mut runtime = RuntimeWorld::seeded();
        let mut base_plan = runtime
            .resident_reply_plan_for_target(SKULL_ACTOR_ID, RATI_ACTOR_ID, "Choose a path.")
            .expect("seeded residents share a room");
        base_plan.planner_requested = true;
        let base_plan = runtime.prepare_resident_planner_snapshot(base_plan);
        let base_snapshot = base_plan
            .card_policy_snapshot
            .as_ref()
            .expect("base snapshot");
        let selected_id = base_snapshot.deck_candidate_ids[0].clone();
        let (_, offers) =
            runtime.legal_action_candidates(Some(RATI_ACTOR_ID), &AccessContext::default());
        let offer = offers
            .iter()
            .find(|offer| offer.offer_id == selected_id)
            .expect("snapshot card remains legal");
        let candidate = runtime
            .resident_planner_candidate_from_offer(RATI_ACTOR_ID, offer)
            .expect("snapshot card has an adapter");
        let preference_key = resident_card_policy_preference_key(offer, &candidate);
        runtime
            .card_policy_preferences
            .entry(RATI_ACTOR_ID)
            .or_default()
            .insert(preference_key, 4);

        let personalized_plan = runtime.prepare_resident_planner_snapshot(base_plan.clone());
        let personalized_snapshot = personalized_plan.card_policy_snapshot.as_ref().unwrap();
        let selected_index = personalized_snapshot
            .deck_candidate_ids
            .iter()
            .position(|candidate_id| candidate_id == &selected_id)
            .unwrap();
        assert_eq!(
            personalized_snapshot.personalization_scores_q8[selected_index],
            256
        );

        let model = CardPolicyModel::new(44);
        let rollout = CardPolicyRollout {
            mode: CardPolicyRolloutMode::Live,
            model_hash: model.model_hash(),
            model: Arc::new(model),
            top_k: 1,
        };
        let base = resident_card_policy_trace(&rollout, &base_plan).expect("base inference");
        let personalized = resident_card_policy_trace(&rollout, &personalized_plan)
            .expect("personalized inference");
        assert_eq!(
            personalized.scores_q8[selected_index] - base.scores_q8[selected_index],
            256
        );
        assert!(base
            .personalization_scores_q8
            .iter()
            .all(|score| *score == 0));
    }

    #[test]
    fn authored_card_semantics_match_their_public_event_history() {
        assert!(resident_card_kind_is_search("search"));
        assert!(resident_card_kind_is_search("check"));
        assert!(resident_event_matches_card_kind(
            "combat.attack.hit",
            "attack"
        ));
        assert!(resident_event_matches_card_kind("combat.defend", "defend"));
        assert!(resident_event_matches_card_kind(
            "combat.flee.success",
            "flee"
        ));
        assert!(resident_event_matches_card_kind(
            "magic.spell_cast",
            "cast_spell"
        ));
        assert!(resident_event_matches_card_kind("item.used", "use_feature"));
    }

    #[test]
    fn absent_trace_is_deterministic_and_contains_no_hidden_reason() {
        let plan = plan_with_candidate();
        let trace = ResidentPlanningTrace::absent(&plan);
        assert_eq!(trace.status, ResidentPlanningStatus::Absent);
        assert_eq!(trace.state_revision, 77);
        assert!(trace.proposal_reason.is_none());
        assert!(trace.generation_id.contains("resident-plan:"));
    }

    #[test]
    fn valid_output_can_only_select_the_exact_frozen_candidate() {
        let plan = plan_with_candidate();
        let mut trace = ResidentPlanningTrace::absent(&plan);
        let action = validate_resident_planner_output(
            &plan,
            r#"{"candidate_id":"cosy:77:move:2","state_revision":77,"speech_act":"propose","reason":"The public event makes this route relevant."}"#,
            &mut trace,
        )
        .expect("exact output selects the server candidate");
        assert_eq!(action.kind, "move");
        assert_eq!(action.destination_location_id, Some(2));
        assert_eq!(action.state_revision, Some(77));
        assert!(action.reason.is_none());
        assert_eq!(
            trace.proposal_reason.as_deref(),
            Some("The public event makes this route relevant.")
        );
        assert_eq!(trace.status, ResidentPlanningStatus::Proposed);
    }

    #[test]
    fn stale_and_unknown_candidates_fail_without_an_action() {
        let plan = plan_with_candidate();
        for (json, code) in [
            (
                r#"{"candidate_id":"cosy:77:move:2","state_revision":76,"speech_act":"propose","reason":"stale"}"#,
                "planner_candidate_mismatch",
            ),
            (
                r#"{"candidate_id":"invented","state_revision":77,"speech_act":"commit","reason":"illegal"}"#,
                "planner_candidate_mismatch",
            ),
        ] {
            let mut trace = ResidentPlanningTrace::absent(&plan);
            assert!(validate_resident_planner_output(&plan, json, &mut trace).is_none());
            assert_eq!(trace.status, ResidentPlanningStatus::Rejected);
            assert_eq!(trace.failure_code.as_deref(), Some(code));
        }
    }

    #[test]
    fn commit_time_rejection_keeps_the_valid_proposal_link_trace_only() {
        let plan = plan_with_candidate();
        let mut trace = ResidentPlanningTrace::absent(&plan);
        let action = validate_resident_planner_output(
            &plan,
            r#"{"candidate_id":"cosy:77:move:2","state_revision":77,"speech_act":"commit","reason":"private route ranking"}"#,
            &mut trace,
        )
        .expect("valid proposal");
        assert!(action.reason.is_none());

        trace.reject("planner_stale_or_illegal");
        assert_eq!(trace.status, ResidentPlanningStatus::Rejected);
        assert_eq!(trace.candidate_id.as_deref(), Some("cosy:77:move:2"));
        assert_eq!(trace.speech_act, Some(ResidentSpeechAct::Commit));
        assert_eq!(
            trace.proposal_reason.as_deref(),
            Some("private route ranking")
        );
        assert_eq!(
            trace.failure_code.as_deref(),
            Some("planner_stale_or_illegal")
        );
    }

    #[tokio::test]
    async fn unavailable_planner_degrades_to_rejected_trace_without_an_action() {
        let config = AiConfig {
            api_key: "offline-test".to_string(),
            base_url: "http://127.0.0.1:9".to_string(),
            model: "offline-model".to_string(),
            vision_model: "offline-vision".to_string(),
            ..AiConfig::default()
        };
        let result = request_resident_plan(&config, &plan_with_candidate()).await;
        assert!(result.proposed_action.is_none());
        assert_eq!(result.trace.status, ResidentPlanningStatus::Rejected);
        assert!(result
            .trace
            .failure_code
            .as_deref()
            .is_some_and(|code| code.starts_with("planner_unavailable:")));
    }

    #[test]
    fn direct_controller_snapshot_and_ordinary_talk_skip_planning() {
        let runtime = RuntimeWorld::seeded();
        let mut direct = plan_with_candidate();
        direct.speaker_actor_id = 5000;
        direct.planner_requested = true;
        let direct = runtime.prepare_resident_planner_snapshot(direct);
        assert!(!direct.planner_requested);
        assert!(direct.planner_candidates.is_empty());

        let mut ordinary = plan_with_candidate();
        ordinary.planner_requested = false;
        let ordinary = runtime.prepare_resident_planner_snapshot(ordinary);
        assert!(!ordinary.planner_requested);
        assert!(ordinary.planner_candidates.is_empty());
    }

    #[test]
    fn current_snapshot_rejects_forged_fields_and_newer_revision() {
        let mut runtime = RuntimeWorld::seeded();
        let executable_offer = runtime
            .draw_until_test_offer(RATI_ACTOR_ID, &AccessContext::default(), |offer| {
                offer.kind == "pick_up"
            })
            .expect("the seeded resident can draw a kernel-executable card");
        let plan = runtime
            .resident_reply_plan_for_target(
                SKULL_ACTOR_ID,
                RATI_ACTOR_ID,
                "Choose what to do next.",
            )
            .expect("Rati can react")
            .requesting_planner();
        let plan = runtime.prepare_resident_planner_snapshot(plan);
        let candidate = plan
            .planner_candidates
            .iter()
            .find(|candidate| candidate.candidate_id == executable_offer.offer_id)
            .expect("seeded Rati has a legal planner candidate")
            .clone();
        let proposal = AvatarProposedAction {
            kind: candidate.kind.clone(),
            target_actor_id: candidate.target_actor_id,
            item_id: candidate.item_id,
            target_item_id: candidate.target_item_id,
            destination_location_id: candidate.destination_location_id,
            candidate_id: Some(candidate.candidate_id.clone()),
            composition_id: Some(candidate.composition_id.clone()),
            state_revision: Some(candidate.state_revision),
            planning_generation_id: Some("resident-plan:eventual-action".to_string()),
            speech_act: Some(ResidentSpeechAct::Propose),
            reason: Some("private selector rationale".to_string()),
        };
        assert!(runtime.resident_planner_proposal_is_current(&plan, &proposal));
        runtime.apply_resident_intent_projection(
            RATI_ACTOR_ID,
            &AvatarIntentProposal {
                speech: "I can try the exact offered action.".to_string(),
                intent: None,
                belief: None,
                desire: None,
                promise: None,
                refusal: None,
                proposed_action: Some(proposal.clone()),
            },
            "resident_intent",
        );
        let continuity = runtime
            .resident_continuities
            .get(&RATI_ACTOR_ID)
            .expect("accepted proposal is durable");
        assert!(!format_resident_continuity(continuity).contains("private selector rationale"));
        assert!(!continuity
            .desires
            .iter()
            .any(|note| note.text.contains("private selector rationale")));
        let actor = runtime.actor_by_id(RATI_ACTOR_ID).expect("Rati exists");
        let action = runtime
            .resident_pending_proposed_action(actor)
            .expect("accepted candidate reaches deterministic hands");
        let decision = runtime.resident_decision_trace(&ResidentAutonomyCandidate {
            actor_id: RATI_ACTOR_ID,
            rank: 0,
            score: 0,
            record: JournalRecord::new(action, 392),
        });
        assert_eq!(
            decision.planning_generation_id.as_deref(),
            Some("resident-plan:eventual-action")
        );
        assert_eq!(
            decision.planner_candidate_id.as_deref(),
            Some(candidate.candidate_id.as_str())
        );
        assert_eq!(
            decision.planner_state_revision,
            Some(candidate.state_revision)
        );
        let mut forged = proposal.clone();
        forged.kind = "invented".to_string();
        assert!(!runtime.resident_planner_proposal_is_current(&plan, &forged));
        runtime.world.next_event_seq = runtime.world.next_event_seq.saturating_add(1);
        assert!(!runtime.resident_planner_proposal_is_current(&plan, &proposal));
    }

    #[test]
    fn planner_candidates_are_complete_for_the_declared_closed_policy() {
        let runtime = RuntimeWorld::seeded();
        let (_, offers) =
            runtime.legal_action_candidates(Some(RATI_ACTOR_ID), &AccessContext::default());
        let hand = runtime.action_hand_for(Some(RATI_ACTOR_ID), &offers);
        let expected = runtime
            .current_action_hand_offers(RATI_ACTOR_ID, &offers)
            .into_iter()
            .filter(|offer| resident_planner_offer_kind_is_eligible(&offer.kind))
            .map(|offer| {
                runtime
                    .resident_planner_candidate_from_offer(RATI_ACTOR_ID, offer)
                    .expect("every seeded reachable offer in the closed policy is executable")
            })
            .chain(std::iter::once(
                runtime.resident_planner_pass_candidate(RATI_ACTOR_ID, &hand),
            ))
            .collect::<Vec<_>>();
        assert_eq!(runtime.resident_planner_candidates(RATI_ACTOR_ID), expected);
        assert!(expected.len() <= hand.entries.len() + 1);
        assert!(expected.iter().any(|candidate| {
            candidate.kind == "pass"
                && candidate.candidate_id == hand.pass.offer_id
                && candidate.state_revision == hand.pass.state_revision
                && candidate.hand_generation == Some(hand.pass.generation)
                && candidate.scene_key.as_deref() == Some(hand.pass.scene_key.as_str())
        }));
        assert!(resident_planner_offer_kind_is_eligible("search"));
        assert!(RESIDENT_PLANNER_ELIGIBLE_KINDS
            .iter()
            .all(|kind| resident_planner_offer_kind_is_eligible(kind)));

        let mut plan = plan_with_candidate();
        plan.planner_candidates = expected;
        let trace = ResidentPlanningTrace::absent(&plan);
        assert_eq!(
            trace.eligibility_policy,
            RESIDENT_PLANNER_ELIGIBILITY_POLICY
        );
        assert_eq!(
            trace.eligible_offer_kinds,
            RESIDENT_PLANNER_ELIGIBLE_KINDS
                .iter()
                .map(|kind| (*kind).to_string())
                .collect::<Vec<_>>()
        );
    }

    #[test]
    fn model_selected_think_is_certificate_bound_and_commits_one_slot_rotation() {
        let mut runtime = RuntimeWorld::seeded();
        let plan = runtime
            .resident_reply_plan_for_target(
                SKULL_ACTOR_ID,
                RATI_ACTOR_ID,
                "Choose only from the exact current candidates.",
            )
            .expect("Rati can react")
            .requesting_planner();
        let plan = runtime.prepare_resident_planner_snapshot(plan);
        let pass = plan
            .planner_candidates
            .iter()
            .find(|candidate| candidate.kind == "pass")
            .expect("planner receives the current certified Pass")
            .clone();
        assert!(pass.candidate_id.starts_with("think:"));
        assert!(pass.composition_id.starts_with("think:"));
        assert!(pass.hand_generation.is_some());
        assert!(pass.scene_key.is_some());

        let mut trace = ResidentPlanningTrace::absent(&plan);
        let output = serde_json::json!({
            "candidate_id": pass.candidate_id,
            "state_revision": pass.state_revision,
            "speech_act": "commit",
            "reason": "I will take a moment to reconsider.",
        })
        .to_string();
        let proposal = validate_resident_planner_output(&plan, &output, &mut trace)
            .expect("model can select the frozen Pass candidate");
        let mut forged = proposal.clone();
        forged.item_id = Some(STORY_BUTTON_ITEM_ID);
        assert!(
            !runtime.resident_planner_proposal_is_current(&plan, &forged),
            "a planner cannot add action fields to a Think certificate"
        );

        let accepted = planning_speech_record(
            &runtime,
            trace.clone(),
            Some(proposal),
            "I will pause before I decide.",
            392_200,
        );
        assert_eq!(runtime.apply_journal_record(&accepted).0, CW_OK);
        let actor = runtime
            .actor_by_id(RATI_ACTOR_ID)
            .expect("Rati remains active");
        let pending = runtime
            .resident_continuities
            .get(&RATI_ACTOR_ID)
            .and_then(|continuity| continuity.pending_action.as_ref())
            .expect("accepted Think remains pending until its consequence");
        assert!(
            runtime.resident_planner_pass_is_current(RATI_ACTOR_ID, pending),
            "the accepted Think certificate remains current across its own SAY"
        );
        let before_tick = runtime.world.tick;
        let before_generation = runtime
            .hand_generations
            .get(&RATI_ACTOR_ID)
            .copied()
            .unwrap_or_default();
        let mut stale_runtime = runtime.clone();
        let unrelated_content_id = stale_runtime.next_content_id_value();
        let mut unrelated = JournalRecord::new(
            CwAction {
                kind: CW_ACTION_SAY,
                actor_id: SKULL_ACTOR_ID,
                content_id: unrelated_content_id,
                ..CwAction::default()
            },
            392_202,
        );
        unrelated.content_upserts.insert(
            unrelated_content_id,
            "The room changes before Rati can act.".to_string(),
        );
        assert_eq!(stale_runtime.apply_journal_record(&unrelated).0, CW_OK);
        let stale_actor = stale_runtime
            .actor_by_id(RATI_ACTOR_ID)
            .expect("Rati remains active after the unrelated event");
        assert!(
            stale_runtime
                .resident_pending_planner_pass_record(stale_actor, 392_203, None)
                .is_none(),
            "an unrelated public revision after the accepted SAY must expire the frozen Think"
        );
        let record = runtime
            .resident_economy_autonomy_record(actor, 392_201)
            .expect("accepted Think becomes the resident's only committed action");
        let record = runtime
            .attach_resident_decision_trace(ResidentAutonomyCandidate {
                actor_id: RATI_ACTOR_ID,
                rank: 89,
                score: 0,
                record,
            })
            .record;
        assert_eq!(record.origin, JournalOrigin::ActorConsequence);
        assert!(record.projection_mutations.iter().any(|mutation| {
            matches!(mutation, ProjectionMutation::ThinkHand { reason, .. }
                if reason == "resident_planner_pass")
        }));
        let event_store_path = std::env::temp_dir().join(format!(
            "cosyworld-resident-planner-pass-{}-{}.sqlite",
            std::process::id(),
            now_millis()
        ));
        let _ = fs::remove_file(&event_store_path);
        let state = test_app_state(runtime.clone(), Some(event_store_path.clone()));
        let (status, events) =
            commit_journal_record(&state, &mut runtime, record).expect("Think commits");
        assert_eq!(status, CW_OK);
        assert!(events.iter().any(
            |event| event.type_name == "hand.thought" && event.actor_id == Some(RATI_ACTOR_ID)
        ));
        assert_eq!(
            runtime.world.tick, before_tick,
            "an autonomous resident Pass does not add a second played-time tick"
        );
        assert_eq!(
            runtime
                .hand_generations
                .get(&RATI_ACTOR_ID)
                .copied()
                .unwrap_or_default(),
            before_generation + 1
        );
        let committed = read_action_journal(&event_store_path)
            .expect("committed Pass journal reads")
            .pop()
            .expect("Think is journaled");
        let decision = committed
            .resident_decision
            .as_ref()
            .expect("committed Think retains its decision trace");
        assert_eq!(decision.choice.offer_kind, "pass");
        assert_eq!(
            decision.choice.offer_id.as_deref(),
            Some(pass.candidate_id.as_str())
        );
        assert!(decision
            .candidates
            .iter()
            .any(|candidate| candidate.kind == "pass" && candidate.selected));
        assert_eq!(
            decision.planner_candidate_id.as_deref(),
            Some(pass.candidate_id.as_str())
        );
        assert_eq!(
            decision.outcome.as_ref().map(|outcome| outcome.status),
            Some(CW_OK)
        );
        drop(state);
        let _ = fs::remove_file(event_store_path);
    }

    #[test]
    fn planner_and_autonomy_consume_the_exact_frozen_discovery_offer() {
        let mut runtime = RuntimeWorld::seeded();
        let catalog: DiscoveryAuthorityCatalog =
            serde_json::from_str(include_str!("../fixtures/discovery-authority-v1.json"))
                .expect("discovery fixture");
        runtime.install_discovery_catalog_for_test(
            catalog,
            "fixture.discovery",
            "1.0.0",
            COSY_COTTAGE_LOCATION_ID,
            Some("fixture.discovery:region/mossy-verge"),
        );
        let actor = runtime.actor_by_id(RATI_ACTOR_ID).expect("Rati exists");
        let offer = runtime
            .discovery_action_offers(actor.id)
            .into_iter()
            .find(|offer| offer.kind == FOCUSED_NOTICE_OFFER_KIND)
            .expect("focused discovery offer");
        let candidate = runtime
            .resident_planner_candidate_from_offer(actor.id, &offer)
            .expect("planner accepts the exact offer");
        assert_eq!(candidate.candidate_id, offer.offer_id);
        assert_eq!(candidate.composition_id, offer.composition_id);
        let record = runtime
            .resident_record_for_shared_offer(actor, &offer, 92_001)
            .expect("autonomy consumes the same offer");
        assert!(runtime.resident_offer_matches_record(&offer, &record));
        assert!(record.projection_mutations.iter().any(|mutation| {
            matches!(mutation, ProjectionMutation::ResolveDiscovery { intent }
                if intent.receipt.id == offer.discovery.as_ref().unwrap().receipt_id)
        }));
    }

    #[test]
    fn pickup_that_requires_an_exchange_is_excluded_from_planner_candidates() {
        let mut runtime = RuntimeWorld::seeded();
        for item in &mut runtime.world.items[..runtime.world.item_count] {
            match item.id {
                DEWBRIGHT_BUTTON_ITEM_ID => {
                    item.location_id = 0;
                    item.holder_actor_id = RATI_ACTOR_ID;
                    item.held_since_tick = 20;
                    item.weight_tenths = 150;
                }
                2004 => {
                    item.location_id = COSY_COTTAGE_LOCATION_ID;
                    item.holder_actor_id = 0;
                    item.held_since_tick = 0;
                }
                2001 | 2003 | STORY_BUTTON_ITEM_ID => {
                    item.location_id = 0;
                    item.holder_actor_id = 0;
                    item.held_since_tick = 0;
                }
                _ => {}
            }
        }
        runtime
            .world
            .actors
            .iter_mut()
            .find(|actor| actor.id == RATI_ACTOR_ID)
            .expect("Rati exists")
            .stats
            .strength = 1;
        assert!(runtime.actor_inventory_full(RATI_ACTOR_ID));
        let (_, offers) =
            runtime.legal_action_candidates(Some(RATI_ACTOR_ID), &AccessContext::default());
        assert!(offers
            .iter()
            .any(|offer| offer.kind == "pick_up" && offer.id == "pick_up:2004"));
        assert!(runtime
            .plan_item_choice_action(RATI_ACTOR_ID, "pick_up", 2004, 0)
            .is_err());
        assert!(!runtime
            .resident_planner_candidates(RATI_ACTOR_ID)
            .iter()
            .any(|candidate| candidate.kind == "pick_up" && candidate.item_id == Some(2004)));
    }

    #[test]
    fn accepted_rejected_committed_lifecycle_replays_without_a_gateway() {
        let mut runtime = RuntimeWorld::seeded();
        let executable_offer = runtime
            .draw_until_test_offer(RATI_ACTOR_ID, &AccessContext::default(), |offer| {
                offer.kind == "pick_up"
            })
            .expect("the seeded resident can draw a kernel-executable card");
        let replay_base = RuntimeSnapshot::from_runtime(&runtime);
        let plan = runtime
            .resident_reply_plan_for_target(
                SKULL_ACTOR_ID,
                RATI_ACTOR_ID,
                "Choose what to do next.",
            )
            .expect("Rati can react")
            .requesting_planner();
        let plan = runtime.prepare_resident_planner_snapshot(plan);
        let candidate = plan
            .planner_candidates
            .iter()
            .find(|candidate| candidate.candidate_id == executable_offer.offer_id)
            .expect("seeded Rati has an executable planner candidate")
            .clone();
        let mut accepted_trace = ResidentPlanningTrace::absent(&plan);
        let output = serde_json::json!({
            "candidate_id": candidate.candidate_id,
            "state_revision": candidate.state_revision,
            "speech_act": "commit",
            "reason": "private route ranking",
        })
        .to_string();
        let accepted_action = validate_resident_planner_output(&plan, &output, &mut accepted_trace)
            .expect("exact candidate validates");
        assert!(accepted_action.reason.is_none());

        let accepted_record = planning_speech_record(
            &runtime,
            accepted_trace.clone(),
            Some(accepted_action.clone()),
            "I will take the offered path.",
            392_001,
        );
        let accepted_json =
            serde_json::to_string(&accepted_record).expect("accepted record serializes");
        assert_eq!(accepted_json.matches("private route ranking").count(), 1);
        assert_eq!(runtime.apply_journal_record(&accepted_record).0, CW_OK);

        let mut records = vec![accepted_record];
        let mut noop = JournalRecord::new(
            CwAction {
                kind: CW_ACTION_NONE,
                actor_id: RATI_ACTOR_ID,
                ..CwAction::default()
            },
            392_002,
        );
        noop.projection_mutations
            .push(ProjectionMutation::UpdateResidentContinuity {
                resident_id: RATI_ACTOR_ID,
                proposal: AvatarIntentProposal {
                    speech: String::new(),
                    intent: None,
                    belief: None,
                    desire: None,
                    promise: None,
                    refusal: None,
                    proposed_action: None,
                },
                reason: "resident_autonomy_intent".to_string(),
            });
        assert_eq!(runtime.apply_journal_record(&noop).0, CW_OK);
        records.push(noop);
        assert_eq!(
            runtime
                .resident_continuities
                .get(&RATI_ACTOR_ID)
                .and_then(|continuity| continuity.pending_planning.as_ref())
                .map(|trace| trace.generation_id.as_str()),
            Some(accepted_trace.generation_id.as_str())
        );

        let mut rejected_trace = ResidentPlanningTrace::absent(&plan);
        rejected_trace.generation_id = "resident-plan:rejected-newer".to_string();
        rejected_trace.reject("planner_invalid_json");
        let rejected_record = planning_speech_record(
            &runtime,
            rejected_trace,
            None,
            "I will not replace the earlier plan.",
            392_003,
        );
        assert_eq!(runtime.apply_journal_record(&rejected_record).0, CW_OK);
        records.push(rejected_record);
        let continuity = runtime
            .resident_continuities
            .get(&RATI_ACTOR_ID)
            .expect("continuity persists");
        assert_eq!(
            continuity
                .pending_planning
                .as_ref()
                .map(|trace| trace.generation_id.as_str()),
            Some(accepted_trace.generation_id.as_str())
        );
        assert_eq!(
            continuity
                .pending_action
                .as_ref()
                .and_then(|action| action.planning_generation_id.as_deref()),
            Some(accepted_trace.generation_id.as_str())
        );

        let actor = runtime.actor_by_id(RATI_ACTOR_ID).expect("Rati exists");
        let committed_action = runtime
            .resident_pending_proposed_action(actor)
            .expect("accepted action remains executable");
        let action_record = JournalRecord::new(committed_action, 392_004);
        assert_eq!(runtime.apply_journal_record(&action_record).0, CW_OK);
        records.push(action_record);
        let outcome_plan = runtime
            .resident_economy_action_reply_plan(&committed_action)
            .expect("committed action has a Voice reply plan");
        let disposition = outcome_plan
            .resident_continuity
            .last_planning_disposition
            .clone()
            .expect("committed disposition reaches Voice");
        assert_eq!(disposition.trace.status, ResidentPlanningStatus::Committed);
        assert!(resident_voice_planning_brief(&ResidentPlanningResult {
            proposed_action: disposition.proposed_action.clone(),
            trace: disposition.trace.clone(),
        })
        .contains("the room has already seen me"));

        let outcome_record = planning_speech_record(
            &runtime,
            disposition.trace,
            None,
            "That path is now behind me.",
            392_005,
        );
        assert_eq!(runtime.apply_journal_record(&outcome_record).0, CW_OK);
        records.push(outcome_record);
        let continuity = runtime
            .resident_continuities
            .get(&RATI_ACTOR_ID)
            .expect("continuity persists");
        assert!(continuity.pending_action.is_none());
        assert!(continuity.pending_planning.is_none());
        assert!(continuity.last_planning_disposition.is_none());

        let expected = serde_json::to_value(RuntimeSnapshot::from_runtime(&runtime))
            .expect("final runtime serializes");
        let encoded = serde_json::to_string(&records).expect("records serialize");
        let replay_records: Vec<JournalRecord> =
            serde_json::from_str(&encoded).expect("records deserialize");
        let mut replayed = replay_base
            .into_runtime()
            .expect("the pre-lifecycle snapshot restores");
        for record in &replay_records {
            assert_eq!(replayed.apply_journal_record(record).0, CW_OK);
        }
        assert_eq!(
            serde_json::to_value(RuntimeSnapshot::from_runtime(&replayed))
                .expect("replayed runtime serializes"),
            expected
        );
    }

    #[test]
    fn accepted_generation_supersedes_only_the_previous_generation() {
        let mut runtime = RuntimeWorld::seeded();
        let mut trace_a = ResidentPlanningTrace::absent(&plan_with_candidate());
        trace_a.generation_id = "resident-plan:a".to_string();
        let action_a = AvatarProposedAction {
            kind: "move".to_string(),
            destination_location_id: Some(MOONLIT_TRAIL_LOCATION_ID),
            planning_generation_id: Some(trace_a.generation_id.clone()),
            ..AvatarProposedAction::default()
        };
        let record_a = planning_speech_record(
            &runtime,
            trace_a.clone(),
            Some(action_a),
            "Plan A.",
            392_101,
        );
        assert_eq!(runtime.apply_journal_record(&record_a).0, CW_OK);

        let mut trace_b = trace_a.clone();
        trace_b.generation_id = "resident-plan:b".to_string();
        trace_b.supersedes_generation_id = Some(trace_a.generation_id.clone());
        let action_b = AvatarProposedAction {
            kind: "move".to_string(),
            destination_location_id: Some(MOONLIT_TRAIL_LOCATION_ID),
            planning_generation_id: Some(trace_b.generation_id.clone()),
            ..AvatarProposedAction::default()
        };
        let record_b = planning_speech_record(
            &runtime,
            trace_b.clone(),
            Some(action_b),
            "Plan B.",
            392_102,
        );
        assert_eq!(runtime.apply_journal_record(&record_b).0, CW_OK);
        let continuity = runtime
            .resident_continuities
            .get(&RATI_ACTOR_ID)
            .expect("continuity persists");
        assert_eq!(
            continuity
                .pending_planning
                .as_ref()
                .map(|trace| trace.generation_id.as_str()),
            Some("resident-plan:b")
        );
        assert_eq!(
            continuity
                .last_planning_disposition
                .as_ref()
                .map(|disposition| (
                    disposition.trace.generation_id.as_str(),
                    disposition.trace.status,
                )),
            Some(("resident-plan:a", ResidentPlanningStatus::Superseded))
        );
    }
}
