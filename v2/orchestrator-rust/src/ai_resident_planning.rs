use super::*;

const RESIDENT_PLANNER_PROMPT_VERSION: &str = "resident-intent-v1";
const RESIDENT_PLANNER_ELIGIBILITY_POLICY: &str = "resident-planner-offers-v1";
const RESIDENT_PLANNER_ELIGIBLE_KINDS: &[&str] = &[
    "move",
    "pick_up",
    "drop_item",
    "give_item",
    "trade_item",
    "use_item",
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

impl ResidentSpeechAct {
    pub(super) fn as_str(self) -> &'static str {
        match self {
            Self::Inform => "inform",
            Self::Propose => "propose",
            Self::Commit => "commit",
            Self::Refuse => "refuse",
            Self::React => "react",
        }
    }
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub(super) enum ResidentPlanningStatus {
    Absent,
    Requested,
    Proposed,
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
    pub(super) supersedes_generation_id: Option<String>,
}

impl ResidentPlanningTrace {
    pub(super) fn absent(plan: &AvatarReplyPlan) -> Self {
        Self {
            schema_version: 1,
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
            return plan;
        }
        plan.planner_candidates = self.resident_planner_candidates(plan.speaker_actor_id);
        plan
    }

    fn resident_planner_candidates(&self, actor_id: u64) -> Vec<ResidentPlannerCandidate> {
        let (_, offers) = self.legal_action_candidates(Some(actor_id), &AccessContext::default());
        offers
            .iter()
            .filter(|offer| action_offer_is_reachable(offer))
            .filter_map(|offer| self.resident_planner_candidate_from_offer(actor_id, offer))
            .collect()
    }

    fn resident_planner_candidate_from_offer(
        &self,
        actor_id: u64,
        offer: &RankedActionOffer,
    ) -> Option<ResidentPlannerCandidate> {
        if !resident_planner_offer_kind_is_eligible(&offer.kind) {
            return None;
        }
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
        };
        match (offer.kind.as_str(), parts.as_slice()) {
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
            _ => return None,
        }
        Some(candidate)
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

fn resident_planner_offer_kind_is_eligible(kind: &str) -> bool {
    RESIDENT_PLANNER_ELIGIBLE_KINDS.contains(&kind)
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
    let candidates =
        serde_json::to_string(&plan.planner_candidates).unwrap_or_else(|_| "[]".to_string());
    let system = "You are a bounded intent selector. Select exactly one candidate from the supplied authoritative planner-eligible list. Return one JSON object only. Echo candidate_id and state_revision exactly. speech_act must be inform, propose, commit, refuse, or react. reason is private proposal metadata, not a world fact. Never invent an action, target, item, destination, cost, outcome, reward, belief, candidate, or revision.";
    let user = format!(
        "Resident actor: {actor_id}\nTriggering public event: {event}\nBounded continuity and goals:\n{continuity}\n{goals}\nEligibility policy: {policy}; closed offer kinds: {eligible_kinds}\nExact current planner-eligible legal candidates:\n{candidates}\nReturn only {{\"candidate_id\":\"exact id\",\"state_revision\":0,\"speech_act\":\"inform|propose|commit|refuse|react\",\"reason\":\"brief selection rationale\"}}.",
        actor_id = plan.speaker_actor_id,
        event = plan.user_text,
        continuity = format_resident_continuity(&plan.resident_continuity),
        goals = format_goal_lines(&plan.goals),
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
    ResidentPlanningResult {
        proposed_action,
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
        }];
        plan
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
            .first()
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
        let expected = offers
            .iter()
            .filter(|offer| action_offer_is_reachable(offer))
            .filter(|offer| resident_planner_offer_kind_is_eligible(&offer.kind))
            .map(|offer| {
                runtime
                    .resident_planner_candidate_from_offer(RATI_ACTOR_ID, offer)
                    .expect("every seeded reachable offer in the closed policy is executable")
            })
            .collect::<Vec<_>>();
        assert_eq!(runtime.resident_planner_candidates(RATI_ACTOR_ID), expected);
        assert!(!resident_planner_offer_kind_is_eligible("search"));
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
            .first()
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
        .contains("status=committed"));

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
        let mut replayed = RuntimeWorld::seeded();
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
