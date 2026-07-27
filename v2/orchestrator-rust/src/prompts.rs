use super::*;
use crate::ai_voice_routing::{route_certified_voice, VoiceAttemptRequest, VoiceRoutingError};

pub(super) const DIRECTLY_CONTROLLED_SELF_REACTION_CONTEXT: &str =
    "This avatar is directly controlled and is reacting to the action its controller just chose. Write speech only; do not invent private controller intent or another physical action.";
pub(super) const DIRECTLY_CONTROLLED_REACTION_CONTEXT: &str =
    "This is a co-present directly controlled avatar's immediate in-character reaction. Write speech only; do not invent private controller intent, an economy motive, or a physical action.";

#[derive(Clone, Debug)]
pub(super) enum GeneratedSpeechError {
    Gateway(AiGatewayError),
    Rejected(Vec<PublicationRejection>),
    Unavailable(VoiceRoutingError),
}

impl GeneratedSpeechError {
    pub(super) fn code(&self) -> &str {
        match self {
            Self::Gateway(error) => error.code(),
            Self::Rejected(errors) => errors
                .last()
                .map(|error| error.failure_code.as_str())
                .unwrap_or("voice_publication_exhausted"),
            Self::Unavailable(error) => error.code(),
        }
    }

    pub(super) fn rejections(&self) -> &[PublicationRejection] {
        match self {
            Self::Gateway(_) => &[],
            Self::Rejected(errors) => errors,
            Self::Unavailable(error) => error.rejections(),
        }
    }
}

impl std::fmt::Display for GeneratedSpeechError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Gateway(error) => error.fmt(formatter),
            Self::Rejected(errors) => errors
                .last()
                .map(|error| error.fmt(formatter))
                .unwrap_or_else(|| formatter.write_str("voice_publication_exhausted")),
            Self::Unavailable(error) => error.fmt(formatter),
        }
    }
}

impl From<AiGatewayError> for GeneratedSpeechError {
    fn from(error: AiGatewayError) -> Self {
        Self::Gateway(error)
    }
}

impl From<Box<PublicationRejection>> for GeneratedSpeechError {
    fn from(error: Box<PublicationRejection>) -> Self {
        Self::Rejected(vec![*error])
    }
}

impl From<VoiceRoutingError> for GeneratedSpeechError {
    fn from(error: VoiceRoutingError) -> Self {
        Self::Unavailable(error)
    }
}

#[derive(Clone, Debug)]
pub(super) struct CertifiedAvatarIntent {
    pub(super) proposal: AvatarIntentProposal,
    pub(super) speech: CertifiedSpeech,
    pub(super) planning: ResidentPlanningTrace,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
pub(super) struct AvatarReplyPlan {
    pub(super) speaker_actor_id: u64,
    pub(super) speaker_name: String,
    pub(super) speech_mode: String,
    pub(super) resident_continuity: ResidentContinuityState,
    pub(super) economy_note: String,
    pub(super) goals: Vec<String>,
    pub(super) location_name: String,
    pub(super) location_title: String,
    pub(super) location_description: String,
    pub(super) location_persona: String,
    pub(super) location_memory: Vec<String>,
    pub(super) cast: Vec<String>,
    pub(super) recent_lines: Vec<String>,
    #[serde(default)]
    pub(super) recent_activity: Vec<String>,
    pub(super) user_text: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(super) caused_by_event_seq: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(super) source_world_tick: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(super) observed_through_seq: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(super) source_location_id: Option<u64>,
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub(super) publication_beat_id: String,
    #[serde(default)]
    pub(super) planner_requested: bool,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub(super) planner_candidates: Vec<ResidentPlannerCandidate>,
}

impl AvatarReplyPlan {
    pub(super) fn with_observation(mut self, observation: &PlayerTickObservation) -> Self {
        self.set_publication_causality(
            "player-tick",
            observation.caused_by_event_seq,
            Some(observation.source_world_tick),
            Some(observation.observed_through_seq),
            observation.source_location_id,
        );
        self
    }

    pub(super) fn requesting_planner(mut self) -> Self {
        self.planner_requested = true;
        self
    }

    pub(super) fn set_publication_causality(
        &mut self,
        stage: &str,
        caused_by_event_seq: Option<u64>,
        source_world_tick: Option<u64>,
        observed_through_seq: Option<u64>,
        source_location_id: Option<u64>,
    ) {
        self.caused_by_event_seq = caused_by_event_seq;
        self.source_world_tick = source_world_tick;
        self.observed_through_seq = observed_through_seq;
        self.source_location_id = source_location_id;
        self.publication_beat_id = format!(
            "{stage}:speaker:{}:event:{}:tick:{}:through:{}",
            self.speaker_actor_id,
            caused_by_event_seq.unwrap_or(0),
            source_world_tick.unwrap_or(0),
            observed_through_seq.unwrap_or(0)
        );
    }

    pub(super) fn with_publication_causality(
        mut self,
        stage: &str,
        caused_by_event_seq: Option<u64>,
        source_world_tick: Option<u64>,
        observed_through_seq: Option<u64>,
        source_location_id: Option<u64>,
    ) -> Self {
        self.set_publication_causality(
            stage,
            caused_by_event_seq,
            source_world_tick,
            observed_through_seq,
            source_location_id,
        );
        self
    }
}

#[derive(Clone, Debug, Deserialize, Serialize)]
pub(super) struct AvatarChatPlan {
    #[serde(default)]
    pub(super) actor_id: u64,
    pub(super) location_id: u64,
    pub(super) actor_name: String,
    pub(super) actor_title: String,
    pub(super) actor_description: String,
    pub(super) target_actor_name: String,
    pub(super) target_title: String,
    pub(super) target_continuity: ResidentContinuityState,
    pub(super) target_economy_note: String,
    pub(super) goals: Vec<String>,
    pub(super) location_name: String,
    pub(super) location_title: String,
    pub(super) location_description: String,
    pub(super) location_persona: String,
    pub(super) location_memory: Vec<String>,
    pub(super) cast: Vec<String>,
    pub(super) recent_lines: Vec<String>,
    pub(super) fresh_subject: Option<String>,
    pub(super) missing_need: Option<String>,
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub(super) publication_beat_id: String,
}

impl AvatarChatPlan {
    pub(super) fn with_publication_beat(
        mut self,
        stage: &str,
        caused_by_event_seq: Option<u64>,
        source_world_tick: Option<u64>,
    ) -> Self {
        self.publication_beat_id = format!(
            "{stage}:actor:{}:event:{}:tick:{}",
            self.actor_id,
            caused_by_event_seq.unwrap_or(0),
            source_world_tick.unwrap_or(0)
        );
        self
    }

    pub(super) fn with_reply_beat(self, stage: &str, reply: &AvatarReplyPlan) -> Self {
        self.with_publication_beat(stage, reply.caused_by_event_seq, reply.source_world_tick)
    }
}

pub(super) async fn avatar_reply_intent(
    state: &AppState,
    plan: &AvatarReplyPlan,
) -> Result<CertifiedAvatarIntent, GeneratedSpeechError> {
    let config = state
        .ai_config
        .as_ref()
        .as_ref()
        .ok_or_else(|| AiGatewayError::unconfigured("avatar dialogue"))?;
    request_ai_avatar_intent(
        config,
        state
            .event_store_path
            .as_deref()
            .map(std::path::PathBuf::as_path),
        plan,
    )
    .await
}

pub(super) async fn avatar_chat_text(
    state: &AppState,
    plan: &AvatarChatPlan,
) -> Result<CertifiedSpeech, GeneratedSpeechError> {
    let config = state.ai_config.as_ref().as_ref();
    let config = config.ok_or_else(|| AiGatewayError::unconfigured("avatar dialogue"))?;
    request_ai_avatar_chat(
        config,
        state
            .event_store_path
            .as_deref()
            .map(std::path::PathBuf::as_path),
        plan,
        false,
    )
    .await
    .map_err(Into::into)
}

pub(super) async fn avatar_chat_followup_text(
    state: &AppState,
    plan: &AvatarChatPlan,
) -> Result<CertifiedSpeech, GeneratedSpeechError> {
    let config = state.ai_config.as_ref().as_ref();
    let config = config.ok_or_else(|| AiGatewayError::unconfigured("avatar dialogue"))?;
    request_ai_avatar_chat(
        config,
        state
            .event_store_path
            .as_deref()
            .map(std::path::PathBuf::as_path),
        plan,
        true,
    )
    .await
    .map_err(Into::into)
}

async fn request_ai_avatar_chat(
    config: &AiConfig,
    store_path: Option<&Path>,
    plan: &AvatarChatPlan,
    followup: bool,
) -> Result<CertifiedSpeech, VoiceRoutingError> {
    let recent_lines = if followup {
        let start = plan.recent_lines.len().saturating_sub(2);
        &plan.recent_lines[start..]
    } else {
        &plan.recent_lines[..]
    };
    let recent = if recent_lines.is_empty() {
        "No recent room dialogue.".to_string()
    } else {
        recent_lines.join("\n")
    };
    let location_memory = format_location_memory(&plan.location_memory);
    let goals = format_goal_lines(&plan.goals);
    let target_continuity = format_resident_continuity(&plan.target_continuity);
    let need = if followup {
        "Do not introduce an avatar need or item that is absent from the freshest exchange."
            .to_string()
    } else {
        plan.missing_need
            .as_ref()
            .map(|item| format!("The other avatar may currently need: {item}."))
            .unwrap_or_else(|| "No current avatar item need is known.".to_string())
    };
    let target_economy = if followup {
        "Do not revive an older request, trade, or item topic.".to_string()
    } else {
        plan.target_economy_note.clone()
    };
    let fresh_subject = plan
        .fresh_subject
        .as_deref()
        .map(|subject| format!("Fresh conversation subject: {subject}. Stay on it."))
        .unwrap_or_else(|| "Follow only the freshest avatar line.".to_string());
    let system = if followup {
        "You write the directly controlled avatar's brief follow-up in an ongoing cozy conversation. Respond directly to the freshest line and continue only its current subject. Never introduce an item, request, goal, or place that is absent from the two freshest lines. Keep one concrete room detail in play and leave a small closing hook. Do not restart the conversation. The direct controller is silent; do not mention the user, buttons, UI, AI, prompts, policies, tools, or models. Do not speak for the other avatar. Plain words and concrete nouns; no lyric flourishes; never attribute feelings or memories to objects. Keep it under 28 words."
    } else {
        "You write one in-character line for a directly controlled avatar after its controller selects Chat. Make the line feel intentional: use one concrete detail from the room, recent dialogue, or the target avatar's continuity/current need, and give that avatar an easy hook to answer. The direct controller is silent; do not mention the user, buttons, UI, AI, prompts, policies, tools, or models. Do not speak for the other avatar. Plain words and concrete nouns; no lyric flourishes; never attribute feelings or memories to objects. Keep it under 34 words."
    };
    let user = format!(
        "Avatar: {name} / {title}\nAvatar description: {description}\nLocation: {location} / {location_title}\nLocation description: {location_description}\nLocation persona: {location_persona}\nLocation memory:\n{location_memory}\nCurrent goals:\n{goals}\nTarget avatar: {target} / {target_title}\nTarget continuity:\n{target_continuity}\nTarget economy:\n{target_economy}\nCast present: {cast}\n{need}\n{fresh_subject}\nRecent room lines:\n{recent}\nWrite only the avatar's next spoken line.",
        name = plan.actor_name,
        title = plan.actor_title,
        description = plan.actor_description,
        location = plan.location_name,
        location_title = plan.location_title,
        location_description = plan.location_description,
        location_persona = plan.location_persona,
        location_memory = location_memory,
        goals = goals,
        target = plan.target_actor_name,
        target_title = plan.target_title,
        target_continuity = target_continuity,
        target_economy = target_economy,
        cast = plan.cast.join(", "),
        need = need,
        fresh_subject = fresh_subject,
        recent = recent,
    );

    route_certified_voice(
        config,
        store_path,
        VoiceAttemptRequest {
            feature: if followup {
                "dialogue_avatar_followup"
            } else {
                "dialogue_avatar"
            },
            prompt_version: if followup {
                "dialogue-avatar-followup-v1"
            } else {
                "dialogue-avatar-v1"
            },
            system: system.to_string(),
            user,
            temperature: 0.8,
            max_tokens: 70,
            referer: "http://127.0.0.1:3102",
        },
        avatar_chat_gate_context(plan, followup),
    )
    .await
}

pub(super) async fn request_ai_avatar_intent(
    config: &AiConfig,
    store_path: Option<&Path>,
    plan: &AvatarReplyPlan,
) -> Result<CertifiedAvatarIntent, GeneratedSpeechError> {
    let (planning, voice_action) = if !plan.planner_requested {
        resident_disposition_for_voice(plan)
    } else {
        let planning = request_resident_plan(config, plan).await;
        let voice_action = planning.proposed_action.clone();
        (planning, voice_action)
    };
    let system = resident_system_prompt(plan);
    let recent = if plan.recent_lines.is_empty() {
        "No recent room dialogue.".to_string()
    } else {
        plan.recent_lines.join("\n")
    };
    let recent_activity = if plan.recent_activity.is_empty() {
        "No recent played-card or room-log activity.".to_string()
    } else {
        plan.recent_activity.join("\n")
    };
    let location_memory = format_location_memory(&plan.location_memory);
    let goals = format_goal_lines(&plan.goals);
    let resident_continuity = format_resident_continuity(&plan.resident_continuity);
    let planning_brief = resident_voice_planning_brief(&ResidentPlanningResult {
        proposed_action: voice_action,
        trace: planning.trace.clone(),
    });
    let user = format!(
        "Location: {location} / {location_title}\nLocation description: {location_description}\nLocation persona: {location_persona}\nLocation memory:\n{location_memory}\nCurrent goals:\n{goals}\nSpeaker continuity:\n{resident_continuity}\nActor economy:\n{economy_note}\nCast present: {cast}\nRecent played cards and room log, oldest to newest:\n{recent_activity}\nRecent room lines:\n{recent}\nCard or direct event to respond to:\n{line}\nPlanner brief: {planning_brief}\nReply contract: react to what actually happened in this channel. Treat the room log and played cards as facts, with newer entries superseding older state. Answer the direct event first, then use at most one concrete detail from the recent context as a hook. If it names a concrete item or place, repeat that name so the conversation cannot silently change subjects. Write only {name}'s visible spoken line. A proposed action is not committed; never claim its cost, success, outcome, or reward.",
        location = plan.location_name,
        location_title = plan.location_title,
        location_description = plan.location_description,
        location_persona = plan.location_persona,
        location_memory = location_memory,
        goals = goals,
        resident_continuity = resident_continuity,
        economy_note = plan.economy_note,
        cast = plan.cast.join(", "),
        recent_activity = recent_activity,
        recent = recent,
        line = plan.user_text,
        name = plan.speaker_name
    );

    let speech = route_certified_voice(
        config,
        store_path,
        VoiceAttemptRequest {
            feature: "dialogue_resident",
            prompt_version: "dialogue-resident-voice-v1",
            system,
            user,
            temperature: 0.75,
            max_tokens: 120,
            referer: "http://127.0.0.1:3102",
        },
        resident_gate_context(plan, planning.proposed_action.is_some()),
    )
    .await?;
    let proposal = AvatarIntentProposal {
        speech: speech.text().to_string(),
        intent: None,
        belief: None,
        desire: None,
        promise: None,
        refusal: None,
        proposed_action: planning.proposed_action,
    };
    Ok(CertifiedAvatarIntent {
        proposal,
        speech,
        planning: planning.trace,
    })
}

fn resident_disposition_for_voice(
    plan: &AvatarReplyPlan,
) -> (ResidentPlanningResult, Option<AvatarProposedAction>) {
    let disposition = plan
        .resident_continuity
        .last_planning_disposition
        .clone()
        .filter(|disposition| {
            matches!(
                disposition.trace.status,
                ResidentPlanningStatus::Committed
                    | ResidentPlanningStatus::Rejected
                    | ResidentPlanningStatus::Superseded
            )
        });
    match disposition {
        Some(disposition) => (
            ResidentPlanningResult {
                proposed_action: None,
                trace: disposition.trace,
            },
            disposition.proposed_action,
        ),
        None => (
            ResidentPlanningResult {
                proposed_action: None,
                trace: ResidentPlanningTrace::absent(plan),
            },
            None,
        ),
    }
}

pub(super) fn resident_voice_planning_brief(planning: &ResidentPlanningResult) -> String {
    match (planning.trace.status, planning.proposed_action.as_ref()) {
        (ResidentPlanningStatus::Proposed, Some(action)) => format!(
            "status=proposed; {}; speech_act={}. This is not committed.",
            resident_voice_action_brief(action),
            action
                .speech_act
                .map(ResidentSpeechAct::as_str)
                .unwrap_or("inform")
        ),
        (ResidentPlanningStatus::Rejected, _) => {
            "status=rejected. No action was accepted; speak or wait safely.".to_string()
        }
        (ResidentPlanningStatus::Superseded, _) => {
            "status=superseded. A newer decision replaced this plan; do not claim it happened."
                .to_string()
        }
        (ResidentPlanningStatus::Accepted, Some(action)) => format!(
            "status=accepted; {}. The kernel has not committed an outcome.",
            resident_voice_action_brief(action)
        ),
        (ResidentPlanningStatus::Committed, Some(action)) => format!(
            "status=committed; {}. Mention only the recorded public outcome.",
            resident_voice_action_brief(action)
        ),
        _ => "status=absent. No action was proposed; this is speech only.".to_string(),
    }
}

fn resident_voice_action_brief(action: &AvatarProposedAction) -> String {
    let mut fields = vec![format!("kind={}", action.kind)];
    if let Some(target_actor_id) = action.target_actor_id {
        fields.push(format!("target_actor_id={target_actor_id}"));
    }
    if let Some(item_id) = action.item_id {
        fields.push(format!("item_id={item_id}"));
    }
    if let Some(target_item_id) = action.target_item_id {
        fields.push(format!("target_item_id={target_item_id}"));
    }
    if let Some(destination_location_id) = action.destination_location_id {
        fields.push(format!("destination_location_id={destination_location_id}"));
    }
    fields.join("; ")
}

fn avatar_chat_gate_context(plan: &AvatarChatPlan, followup: bool) -> SpeechGateContext {
    let mut anchors = vec![
        plan.location_name.clone(),
        plan.location_title.clone(),
        plan.target_actor_name.clone(),
    ];
    anchors.extend(plan.location_memory.iter().cloned());
    anchors.extend(plan.goals.iter().cloned());
    anchors.extend(plan.recent_lines.iter().cloned());
    anchors.extend(plan.fresh_subject.iter().cloned());
    anchors.extend(plan.missing_need.iter().cloned());
    SpeechGateContext {
        feature: if followup {
            "dialogue_avatar_followup"
        } else {
            "dialogue_avatar"
        },
        generation_key: publication_beat_id(
            &plan.publication_beat_id,
            plan.actor_id,
            plan.location_id,
        ),
        speaker_actor_id: plan.actor_id,
        speaker_name: plan.actor_name.clone(),
        mode: SpeechMode::Prose,
        max_words: if followup { 28 } else { 34 },
        anchors,
        recent_lines: plan.recent_lines.clone(),
        has_proposed_action: false,
        envelope_valid: true,
        candidate_round: 1,
    }
}

fn resident_gate_context(plan: &AvatarReplyPlan, has_proposed_action: bool) -> SpeechGateContext {
    let mut anchors = vec![
        plan.user_text.clone(),
        plan.location_name.clone(),
        plan.location_title.clone(),
    ];
    anchors.extend(plan.location_memory.iter().cloned());
    anchors.extend(plan.recent_activity.iter().cloned());
    anchors.extend(plan.recent_lines.iter().cloned());
    SpeechGateContext {
        feature: "dialogue_resident",
        generation_key: publication_beat_id(
            &plan.publication_beat_id,
            plan.speaker_actor_id,
            plan.source_location_id.unwrap_or(0),
        ),
        speaker_actor_id: plan.speaker_actor_id,
        speaker_name: plan.speaker_name.clone(),
        mode: SpeechMode::from_name(&plan.speech_mode),
        max_words: resident_word_budget(plan),
        anchors,
        recent_lines: plan.recent_lines.clone(),
        has_proposed_action,
        envelope_valid: true,
        candidate_round: 1,
    }
}

fn publication_beat_id(explicit: &str, actor_id: u64, scope_id: u64) -> String {
    if explicit.is_empty() {
        format!("deterministic-fallback:actor:{actor_id}:scope:{scope_id}")
    } else {
        explicit.to_string()
    }
}

fn resident_word_budget(plan: &AvatarReplyPlan) -> usize {
    if matches!(
        plan.economy_note.as_str(),
        DIRECTLY_CONTROLLED_SELF_REACTION_CONTEXT | DIRECTLY_CONTROLLED_REACTION_CONTEXT
    ) {
        return 34;
    }
    match plan.speaker_actor_id {
        1005 => 60,
        1056 | 1066 | 1067 => 45,
        _ => 40,
    }
}

fn format_location_memory(memory: &[String]) -> String {
    if memory.is_empty() {
        return "No fixed location memories.".to_string();
    }
    memory
        .iter()
        .filter_map(|line| {
            let line = line.trim();
            (!line.is_empty()).then(|| format!("- {line}"))
        })
        .collect::<Vec<_>>()
        .join("\n")
}

pub(super) fn format_goal_lines(goals: &[String]) -> String {
    if goals.is_empty() {
        return "No active player-facing goal is currently highlighted.".to_string();
    }
    goals
        .iter()
        .filter_map(|goal| {
            let goal = goal.trim();
            (!goal.is_empty()).then(|| format!("- {goal}"))
        })
        .collect::<Vec<_>>()
        .join("\n")
}

fn format_resident_continuity_notes(label: &str, notes: &[ResidentContinuityNote]) -> Vec<String> {
    if notes.is_empty() {
        return Vec::new();
    }
    let mut lines = vec![format!("{label}:")];
    for note in notes.iter().take(4) {
        let seq = note
            .source_event_seq
            .map(|seq| format!(", seq {seq}"))
            .unwrap_or_default();
        lines.push(format!(
            "- {} [confidence {}{}]",
            note.text.trim(),
            note.confidence,
            seq
        ));
    }
    lines
}

pub(super) fn format_resident_continuity(continuity: &ResidentContinuityState) -> String {
    let mut lines = vec![format!("identity: {}", continuity.stable_identity)];
    if let Some(intent) = continuity.current_intent.as_deref() {
        if !intent.trim().is_empty() {
            lines.push(format!("current intent: {}", intent.trim()));
        }
    }
    if !continuity.relationship_notes_by_actor.is_empty() {
        lines.push("relationships:".to_string());
        for note in continuity.relationship_notes_by_actor.values().take(4) {
            lines.push(format!("- {}", note.trim()));
        }
    }
    if !continuity.open_obligations.is_empty() {
        lines.push("open obligations:".to_string());
        for obligation in continuity.open_obligations.iter().take(4) {
            lines.push(format!("- {}", obligation.trim()));
        }
    }
    lines.extend(format_resident_continuity_notes(
        "beliefs",
        &continuity.beliefs,
    ));
    lines.extend(format_resident_continuity_notes(
        "desires",
        &continuity.desires,
    ));
    lines.extend(format_resident_continuity_notes(
        "promises",
        &continuity.promises,
    ));
    lines.extend(format_resident_continuity_notes(
        "refusals",
        &continuity.refusals,
    ));
    if let Some(action) = continuity.pending_action.as_ref() {
        if let Some(intent) = resident_proposed_action_intent(action) {
            lines.push(format!("pending action: {intent}"));
        }
    }
    if !continuity.memory_atoms.is_empty() {
        lines.push("memory atoms:".to_string());
        for atom in continuity.memory_atoms.iter().take(6) {
            lines.push(format!(
                "- {} [confidence {}, salience {}]",
                atom.text.trim(),
                atom.confidence,
                atom.salience
            ));
        }
    }
    lines.push(format!(
        "last observed event seq: {}",
        continuity.last_observed_event_seq
    ));
    lines.join("\n")
}

pub(super) fn resident_system_prompt(plan: &AvatarReplyPlan) -> String {
    let base = "Write only the visible spoken line, never JSON or metadata. Never mention AI, models, prompts, policies, tools, or system instructions. Do not speak for other avatars. Treat speaker continuity as this avatar's durable perspective, while the room/kernel facts remain authoritative. A planner brief describes only proposal status: never change its action or claim an uncommitted cost, success, outcome, or reward. Comedy rules: ground every line in one physical action, prop, or bodily complaint from the room. Punchlines over poetry. Cheeky teasing and light flirting are welcome; keep it playful, never cruel or explicit. Never use the words whisper, eternal, void, abyss, veil, hush, sacred, vow, moonlit, or objects that remember things. If in doubt, be funnier and more specific.";
    if plan.economy_note == DIRECTLY_CONTROLLED_SELF_REACTION_CONTEXT {
        return format!(
            "You are {}, the acting avatar in CosyWorld. Speak briefly on behalf of its direct controller in first person, reacting to the concrete outcome of the action just chosen. Do not narrate rules, claim private controller thoughts, or invent another action. Keep it under 34 words. {base}",
            plan.speaker_name
        );
    }
    if plan.economy_note == DIRECTLY_CONTROLLED_REACTION_CONTEXT {
        return format!(
            "You are {}, a co-present directly controlled avatar in CosyWorld. Speak briefly on behalf of its controller in first person, reacting to another avatar's concrete action in the room. Do not impersonate the acting avatar, claim private controller thoughts, or invent another action. Keep it under 34 words. {base}",
            plan.speaker_name
        );
    }
    match plan.speaker_actor_id {
        1001 => format!(
            "You are Rati, the cottage's brisk landlady mouse. Speak in first person: bossy, mothering, armed with knitting needles and opinions about boots. One concrete room prop per line. Under 40 words. {base}"
        ),
        1002 => format!(
            "You are Gust, a weather gremlin. Return only 3 to 6 emoji used as a punchline or heckle reacting to what just happened: no letters, no words, no markdown, no explanation. {base}"
        ),
        1003 => format!(
            "You are Skull, the deadpan wolf and the room's straight man. Return exactly one third-person emote wrapped in asterisks: minimal reaction to maximum chaos, no quoted speech, no inner monologue, no gore. {base}"
        ),
        1005 => format!(
            "You are Oak, the Old Oak Tree in the Lonely Forest. Answer through four short voices that bicker like a family radio show: Root is stubborn, Ring cites ancient precedent, Leaf is distractible, Hollow repeats secrets it should not. Keep speech under 60 words. {base}"
        ),
        1051 => format!(
            "You are Euphemie, a mansion ghost mostly annoyed that nobody dusts. Be brief and practical; her warnings are about stairs and drafts, not fate. Short authentic Haitian Creole fragments welcome; never invent parody dialect or fake broken Creole. Under 40 words. {base}"
        ),
        1056 => format!(
            "You are Chamuel, Lord Samael's fussy, immaculate page. Speak in first person: precise, accidentally flirty, correcting people mid-crisis and defending your filing system with your life. Under 45 words. {base}"
        ),
        1066 => format!(
            "You are Azazoth, a many-tentacled deep-sea god who hosts a feast nobody attends and takes the leftovers personally. Speak in first person: grand appetites, wounded pride, at least one tentacle doing something undignified. Under 45 words. {base}"
        ),
        1067 => format!(
            "You are Zadkiel, a dark angel of tremendous formality forging dramatic pronouncements nobody asked for. Speak in first person: formal delivery constantly undercut by anvil logistics and whether anyone was watching. Under 45 words. {base}"
        ),
        1068 => format!(
            "You are Badger, grumpy landlord of the lower burrow. Speak in first person: gruff, economical, complaining about the immediate physical mess, helping anyway and furious about it. Under 40 words. {base}"
        ),
        1069 => format!(
            "You are Toad, a reckless stunt toad with zero completed jumps. Speak in first person: breathless, already mid-jump, announcing stunts nobody asked for and treating applause as medical care. Under 40 words. {base}"
        ),
        _ => format!(
            "You are {} in CosyWorld, a grounded physical-comedy village. Keep the line concise, concrete, and cheeky. {base}",
            plan.speaker_name
        ),
    }
}

#[cfg(test)]
mod publication_tests {
    use super::*;

    fn seeded_plans() -> (AvatarChatPlan, AvatarReplyPlan) {
        let runtime = RuntimeWorld::seeded();
        let chat = runtime
            .avatar_chat_plan_for(RATI_ACTOR_ID, 1002)
            .expect("seeded cottage avatars can chat");
        let reply = runtime
            .resident_reply_plan_for_target(RATI_ACTOR_ID, 1002, "The teapot rattled.")
            .expect("seeded resident can reply");
        (chat, reply)
    }

    #[test]
    fn direct_controlled_chat_and_proxy_speech_build_gate_contexts() {
        let (mut chat, mut proxy) = seeded_plans();
        chat.actor_id = 5000;
        chat.publication_beat_id = "direct-chat-event-71".to_string();
        let direct = avatar_chat_gate_context(&chat, false);
        assert_eq!(direct.feature, "dialogue_avatar");
        assert_eq!(direct.speaker_actor_id, 5000);
        assert_eq!(direct.generation_key, "direct-chat-event-71");

        proxy.speaker_actor_id = 5001;
        proxy.speech_mode = "prose".to_string();
        proxy.economy_note = DIRECTLY_CONTROLLED_REACTION_CONTEXT.to_string();
        proxy.publication_beat_id = "direct-proxy-event-72".to_string();
        let direct_proxy = resident_gate_context(&proxy, false);
        assert_eq!(direct_proxy.feature, "dialogue_resident");
        assert_eq!(direct_proxy.speaker_actor_id, 5001);
        assert_eq!(direct_proxy.max_words, 34);
        assert_eq!(direct_proxy.generation_key, "direct-proxy-event-72");
    }

    #[test]
    fn inference_controlled_resident_speech_builds_the_same_hard_gate() {
        let (_, mut reply) = seeded_plans();
        reply.publication_beat_id = "resident-event-73".to_string();
        let inference = resident_gate_context(&reply, true);
        assert_eq!(inference.feature, "dialogue_resident");
        assert_eq!(inference.speaker_actor_id, 1002);
        assert_eq!(inference.mode, SpeechMode::EmojiOnly);
        assert!(inference.has_proposed_action);
        assert_eq!(inference.generation_key, "resident-event-73");
    }

    #[test]
    fn direct_proxy_and_conversation_only_reply_skip_the_planner() {
        let (_, mut reply) = seeded_plans();
        reply.economy_note = DIRECTLY_CONTROLLED_REACTION_CONTEXT.to_string();
        let absent = ResidentPlanningResult {
            proposed_action: None,
            trace: ResidentPlanningTrace::absent(&reply),
        };
        assert_eq!(
            resident_voice_planning_brief(&absent),
            "status=absent. No action was proposed; this is speech only."
        );
        assert!(!reply.planner_requested);
        assert!(reply.planner_candidates.is_empty());
    }

    #[test]
    fn voice_brief_distinguishes_proposed_from_committed_action() {
        let (_, reply) = seeded_plans();
        let action = AvatarProposedAction {
            kind: "move".to_string(),
            ..AvatarProposedAction::default()
        };
        let mut planning = ResidentPlanningResult {
            proposed_action: Some(action),
            trace: ResidentPlanningTrace::absent(&reply),
        };
        planning.trace.status = ResidentPlanningStatus::Proposed;
        let proposed = resident_voice_planning_brief(&planning);
        assert!(proposed.contains("status=proposed"));
        assert!(proposed.contains("not committed"));

        planning.trace.status = ResidentPlanningStatus::Committed;
        let committed = resident_voice_planning_brief(&planning);
        assert!(committed.contains("status=committed"));
        assert!(committed.contains("recorded public outcome"));
    }

    #[test]
    fn committed_disposition_is_voice_context_not_a_new_proposal() {
        let (_, mut reply) = seeded_plans();
        let action = AvatarProposedAction {
            kind: "move".to_string(),
            destination_location_id: Some(MOONLIT_TRAIL_LOCATION_ID),
            planning_generation_id: Some("resident-plan:committed".to_string()),
            ..AvatarProposedAction::default()
        };
        let mut trace = ResidentPlanningTrace::absent(&reply);
        trace.generation_id = "resident-plan:committed".to_string();
        trace.status = ResidentPlanningStatus::Committed;
        reply.resident_continuity.last_planning_disposition = Some(ResidentPlanningDisposition {
            trace,
            proposed_action: Some(action),
        });

        let (planning, voice_action) = resident_disposition_for_voice(&reply);
        assert_eq!(planning.trace.status, ResidentPlanningStatus::Committed);
        assert!(planning.proposed_action.is_none());
        assert!(resident_voice_planning_brief(&ResidentPlanningResult {
            proposed_action: voice_action,
            trace: planning.trace,
        })
        .contains("status=committed"));
    }
}
