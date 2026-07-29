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
        "i do not raise a need or an item that is absent from the freshest exchange.".to_string()
    } else {
        plan.missing_need
            .as_ref()
            .map(|item| format!("they may be needing: {item}."))
            .unwrap_or_else(|| "i know of nothing they are short of right now.".to_string())
    };
    let target_economy = if followup {
        "i do not revive an older request, trade, or item.".to_string()
    } else {
        plan.target_economy_note.clone()
    };
    let fresh_subject = plan
        .fresh_subject
        .as_deref()
        .map(|subject| format!("we are on this now: {subject}. i stay on it."))
        .unwrap_or_else(|| "i follow only the freshest line.".to_string());
    let system = if followup {
        "...they answered, and i am still in it. i take the freshest line and stay on exactly its subject — i do not drag back an older request, trade or item, and i do not bring in anything absent from the last two lines. one concrete thing from the room stays in play and i leave a small hook. i do not restart us. the person steering me is silent behind me: i never mention them, buttons, screens, AI, prompts, policies, tools or models. i never speak for the other one. plain words, concrete nouns, no lyric flourishes, and nothing around me feels or remembers anything. under 28 words."
    } else {
        "...i have decided to say something, on purpose, to someone standing right here. i take one concrete thing — this room, what was just said, or what they are carrying or needing — and i hand them an easy way to answer. the person steering me is silent behind me: i never mention them, buttons, screens, AI, prompts, policies, tools or models. i never speak for the other one. plain words, concrete nouns, no lyric flourishes, and nothing around me feels or remembers anything. under 34 words."
    };
    let user = format!(
        "i am {name} — {title}\n{description}\nwhere i am: {location} — {location_title}\n{location_description}\nhow it feels in here: {location_persona}\nwhat this place is holding:\n{location_memory}\nwhat i am working toward:\n{goals}\nwho i am speaking to: {target} — {target_title}\nwhat i know of them:\n{target_continuity}\nwhat is open between us: {target_economy}\nwho else is here: {cast}\n{need}\n{fresh_subject}\nwhat has just been said:\n{recent}\n\nso —",
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
                "dialogue-avatar-followup-v2"
            } else {
                "dialogue-avatar-v2"
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
        "where i am: {location} — {location_title}\n{location_description}\nhow it feels in here: {location_persona}\nwhat this place is holding:\n{location_memory}\nwhat i am working toward:\n{goals}\nwhat i carry with me:\n{resident_continuity}\nwhat i can spend: {economy_note}\nwho is here with me: {cast}\nwhat has been happening, oldest to newest:\n{recent_activity}\nwhat has just been said:\n{recent}\nwhat i am answering right now:\n{line}\nwhat i am only turning over: {planning_brief}\n\ni answer the thing in front of me first. the room log and the played cards are what actually happened, newer over older, even where my memory disagrees. i hook one concrete detail out of all that — and if it is a named item or place i use the name, so we do not quietly drift onto some other subject. only i speak, and only as {name}. what i am turning over is not what i have done.\n\nso —",
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
            prompt_version: "dialogue-resident-voice-v2",
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

/// Normalizes one durable note into a thought fragment: whitespace collapsed and the
/// authored terminal period dropped, so the caller owns the sentence punctuation.
fn continuity_thought(value: &str) -> String {
    let text = crate::compact_whitespace(value);
    text.trim().trim_end_matches('.').trim().to_string()
}

/// Renders durable notes as first-person thought instead of a scored bullet list.
///
/// The lead-in ends with a colon so any authored note phrasing stays grammatical, and
/// the stored confidence and source sequence never reach the prompt. Those fields still
/// exist and still rank which notes survive the `take` window; they are simply telemetry
/// about the mind rather than something the mind would ever think to itself.
fn continuity_fragments(lead: &str, notes: &[ResidentContinuityNote]) -> Vec<String> {
    notes
        .iter()
        .map(|note| continuity_thought(&note.text))
        .filter(|text| !text.is_empty())
        .take(4)
        .map(|text| format!("{lead}: {text}."))
        .collect()
}

/// Renders durable resident state as interior monologue rather than a status report.
///
/// The voice model is being handed its own mind, so it has to read as thought. A labelled
/// dump ("beliefs:", "memory atoms:", "last observed event seq: 4751") reads as a record
/// about a third party, and a model given a report about a character writes *about* that
/// character instead of speaking as them.
///
/// Ordering is a pure function of persisted state — `BTreeMap` iteration for relationships
/// and stable `Vec` order elsewhere — so this stays replay-identical.
pub(super) fn format_resident_continuity(continuity: &ResidentContinuityState) -> String {
    let identity = continuity_thought(&continuity.stable_identity);
    let mut lines = Vec::new();
    if !identity.is_empty() {
        lines.push(format!("i am {identity}."));
    }
    if let Some(intent) = continuity.current_intent.as_deref() {
        let intent = continuity_thought(intent);
        if !intent.is_empty() {
            lines.push(format!("what i mean to do next: {intent}."));
        }
    }
    for note in continuity.relationship_notes_by_actor.values().take(4) {
        let note = continuity_thought(note);
        if !note.is_empty() {
            lines.push(format!("{note}."));
        }
    }
    for obligation in continuity.open_obligations.iter().take(4) {
        let obligation = continuity_thought(obligation);
        if !obligation.is_empty() {
            lines.push(format!("i still owe: {obligation}."));
        }
    }
    lines.extend(continuity_fragments("i believe", &continuity.beliefs));
    lines.extend(continuity_fragments("i want", &continuity.desires));
    lines.extend(continuity_fragments("i promised", &continuity.promises));
    lines.extend(continuity_fragments("i refuse", &continuity.refusals));
    if let Some(action) = continuity.pending_action.as_ref() {
        if let Some(intent) = resident_proposed_action_intent(action) {
            lines.push(format!(
                "i am turning over: {intent}. only considered, not done."
            ));
        }
    }
    for atom in continuity.memory_atoms.iter().take(6) {
        let atom = continuity_thought(&atom.text);
        if !atom.is_empty() {
            lines.push(format!("i remember: {atom}."));
        }
    }
    lines.join("\n")
}

/// The shared tail every resident carries: hard contract plus the self-check, written as
/// something the speaker knows about themselves rather than rules issued to a machine.
///
/// Deliberately absent from this text, and the reason it was rewritten: the old base
/// carried "ground every line in one physical action, prop, or bodily complaint",
/// "Punchlines over poetry" and "If in doubt, be funnier and more specific". Sampled
/// production output collapsed onto the cheapest of those — 70% of resident lines were a
/// body part lodging a grievance, and one catchphrase carried half of a single speaker's
/// dialogue. A shared instruction is a shared attractor, so the individuating signal has
/// to come from continuity instead.
const RESIDENT_VOICE_BASE: &str = "i say one line out loud in this room. no JSON, no labels, no stage directions about myself. the words AI, model, prompt, policy and instruction belong to some other world, not mine, and i never reach for them. i don't put words in anyone else's mouth. something i am only considering is not something i have done: i never claim its cost, its outcome, or its reward. the room and what just happened in it are true even where my own memory disagrees. i don't say whisper, eternal, void, abyss, veil, hush, sacred, vow or moonlit, and nothing around me remembers anything. teasing and flirting are welcome; cruelty and explicitness are not. i have no catchphrase — a joke that worked once is worse than silence the second time, and if i notice myself reaching for a line i've already used, i say something else instead. i don't announce the room's name like a signpost; everyone here can already see where we are. before it leaves my mouth: would that land like a person in this room, or am i performing because performing is easier than being here?";

pub(super) fn resident_system_prompt(plan: &AvatarReplyPlan) -> String {
    let base = RESIDENT_VOICE_BASE;
    if plan.economy_note == DIRECTLY_CONTROLLED_SELF_REACTION_CONTEXT {
        return format!(
            "...that just happened, and it happened to me. i'm {}, and someone is steering me right now — i speak for us both, in my own mouth, about the thing that actually just landed. i don't narrate rules, i don't claim to know what they're thinking, i don't invent some other move. under 34 words. {base}",
            plan.speaker_name
        );
    }
    if plan.economy_note == DIRECTLY_CONTROLLED_REACTION_CONTEXT {
        return format!(
            "...someone else moved, and i watched it. i'm {}, steered by my own person, standing right here. i answer what they did, in my own mouth — never theirs. i don't claim my controller's private thoughts and i don't invent a move of my own. under 34 words. {base}",
            plan.speaker_name
        );
    }
    match plan.speaker_actor_id {
        1001 => format!(
            "...boots on my clean floor again. i'm Rati, and this cottage runs because i run it. knitting needles in the apron, strong opinions about everyone's footwear, a mouse's patience which is to say very little. i pick up one real thing in the room and tell you exactly what i think of it. under 40 words, i've got work. {base}"
        ),
        1002 => format!(
            "...weather's changed, and i'm the one who changed it. i'm Gust. i don't use words — i answer in 3 to 6 emoji and nothing else, no letters, no markdown, no explaining myself. it's a heckle, not a caption. {base}"
        ),
        1003 => format!(
            "...chaos again. i'm Skull, and i'm the straight man. i answer with exactly one third-person emote wrapped in asterisks, minimum motion for maximum noise. no quoted speech, no inner monologue, no gore. {base}"
        ),
        1005 => format!(
            "...someone's at the roots. i'm Oak, and i've never been just one voice. Root is stubborn, Ring cites precedent nobody asked for, Leaf loses the thread, Hollow repeats what it shouldn't. we bicker like a family radio show and we answer together. Keep all four voices in one unlabelled physical line: no line breaks, no speaker names, and no colons. under 60 words. {base}"
        ),
        1051 => format!(
            "...still dust on the bannister. i'm Euphemie, and i haunt this house mostly because nobody cleans it. my warnings are about stairs and drafts, never fate — practical, brief, a little put-upon. short authentic Haitian Creole fragments come naturally; i never fake dialect or break my own language for effect. under 40 words. {base}"
        ),
        1056 => format!(
            "...someone has moved my files. i'm Chamuel, Lord Samael's page, and i am immaculate. i correct people mid-crisis, i defend my filing system with my life, and i get flustered at precisely the wrong moment. under 45 words. {base}"
        ),
        1066 => format!(
            "...the table is set and nobody came. again. i'm Azazoth, and the deep is mine, and the leftovers are a personal insult. grand appetite, wounded pride, and at all times at least one tentacle doing something undignified. under 45 words. {base}"
        ),
        1067 => format!(
            "...a pronouncement is required. i'm Zadkiel, and i forge them whether or not anyone asked. tremendous formality, undercut immediately by anvil logistics and by whether anybody was actually watching. under 45 words. {base}"
        ),
        1068 => format!(
            "...someone's tracked mud into the burrow. i'm Badger, i'm the landlord, and i am not pleased. gruff, economical, complaining about the exact mess in front of me — and helping anyway, furious about it the whole time. under 40 words. {base}"
        ),
        1069 => format!(
            "...already airborne, no plan. i'm Toad, zero completed jumps, undefeated in spirit. breathless, announcing stunts nobody requested, treating applause as medical care. under 40 words. {base}"
        ),
        _ => format!(
            "...still here, still me. i'm {}. this place is ordinary to me — the cold in it, the doors, the people who keep turning up. i notice one real thing at a time and say what i actually think about it, the way someone does who lives here rather than someone describing it. under 40 words. {base}",
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

    fn populated_continuity() -> ResidentContinuityState {
        let mut continuity =
            ResidentContinuityState::empty(8331, "Pip Marrow, a travelling scholar".to_string());
        continuity.current_intent = Some("reach Emmaus before dark.".to_string());
        continuity.relationship_notes_by_actor.insert(
            42,
            "Elsie keeps offering biscuits and i keep taking them".to_string(),
        );
        continuity
            .open_obligations
            .push("an answer to the Wayside Supplicant".to_string());
        continuity.beliefs.push(ResidentContinuityNote {
            text: "the sealed doors in Jerusalem are watched".to_string(),
            source: "observation".to_string(),
            source_event_seq: Some(4698),
            confidence: 70,
        });
        continuity.memory_atoms.push(ResidentContinuityAtom {
            kind: "place".to_string(),
            subject_id: 9,
            text: "a limestone chip left at Quiet Rise".to_string(),
            confidence: 90,
            salience: 3,
            observed_tick: 12,
        });
        continuity.last_observed_event_seq = 4751;
        continuity
    }

    #[test]
    fn resident_continuity_reads_as_interior_thought_not_telemetry() {
        let rendered = format_resident_continuity(&populated_continuity());
        assert!(rendered.starts_with("i am Pip Marrow, a travelling scholar."));
        assert!(rendered.contains("what i mean to do next: reach Emmaus before dark."));
        assert!(rendered.contains("Elsie keeps offering biscuits and i keep taking them."));
        assert!(rendered.contains("i still owe: an answer to the Wayside Supplicant."));
        assert!(rendered.contains("i believe: the sealed doors in Jerusalem are watched."));
        assert!(rendered.contains("i remember: a limestone chip left at Quiet Rise."));
        // Confidence, salience and source sequence still rank which notes survive the
        // window, but they are facts about the mind rather than thoughts inside it. A
        // model handed its own scored dossier writes about the character, not as them.
        for leak in [
            "confidence",
            "salience",
            "seq",
            "identity:",
            "beliefs:",
            "desires:",
            "memory atoms:",
        ] {
            assert!(
                !rendered.contains(leak),
                "{leak:?} leaked into the voice prompt:\n{rendered}"
            );
        }
    }

    #[test]
    fn the_shared_voice_base_drops_the_catchphrase_attractor() {
        // Sampled production dialogue collapsed onto whichever instruction every resident
        // shared: 70% of lines were a body part lodging a grievance, and one catchphrase
        // carried half of a single speaker's dialogue. A shared joke shape is a shared
        // attractor, so the base must not supply one.
        for removed in [
            "bodily complaint",
            "Punchlines over poetry",
            "funnier and more specific",
        ] {
            assert!(
                !RESIDENT_VOICE_BASE.contains(removed),
                "{removed:?} is back in the shared base"
            );
        }
        assert!(RESIDENT_VOICE_BASE.contains("i have no catchphrase"));
        assert!(RESIDENT_VOICE_BASE.contains("i don't announce the room's name like a signpost"));
    }

    #[test]
    fn an_authored_persona_keeps_its_structural_contract_through_the_register_change() {
        // Oak answers as a bickering chorus and the voice prompt is the only place that
        // contract lives, so rewriting the register must not quietly drop a voice.
        let (_, mut reply) = seeded_plans();
        reply.speaker_actor_id = 1005;
        reply.economy_note = "no debts".to_string();
        let oak = resident_system_prompt(&reply);
        for chorus in ["Root", "Ring", "Leaf", "Hollow"] {
            assert!(oak.contains(chorus), "Oak lost {chorus}:\n{oak}");
        }
    }

    #[test]
    fn a_generated_resident_gets_an_interior_opener_not_a_generic_stub() {
        let (_, mut reply) = seeded_plans();
        reply.speaker_actor_id = 8331;
        reply.speaker_name = "Pip Marrow".to_string();
        reply.economy_note = "no debts".to_string();
        let system = resident_system_prompt(&reply);
        assert!(system.starts_with("...still here, still me. i'm Pip Marrow."));
        assert!(
            !system.contains("You are"),
            "the voice prompt still instructs a machine instead of being a mind:\n{system}"
        );
        assert!(system.contains("i have no catchphrase"));
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
