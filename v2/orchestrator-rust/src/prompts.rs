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

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub(super) struct DirectedDialogueTurn {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(super) source_event_seq: Option<u64>,
    pub(super) speaker_actor_id: u64,
    pub(super) speaker_name: String,
    pub(super) recipient_actor_id: u64,
    pub(super) recipient_name: String,
    pub(super) content: String,
}

impl DirectedDialogueTurn {
    pub(super) fn new(
        speaker_actor_id: u64,
        speaker_name: impl Into<String>,
        recipient_actor_id: u64,
        recipient_name: impl Into<String>,
        content: impl Into<String>,
    ) -> Self {
        Self {
            source_event_seq: None,
            speaker_actor_id,
            speaker_name: speaker_name.into(),
            recipient_actor_id,
            recipient_name: recipient_name.into(),
            content: content.into(),
        }
    }
}

#[derive(Clone, Debug, Deserialize, Serialize)]
pub(super) struct AvatarReplyPlan {
    #[serde(default)]
    pub(super) context_spine: AvatarContextSpine,
    pub(super) speaker_actor_id: u64,
    pub(super) speaker_name: String,
    #[serde(default)]
    pub(super) speaker_voice: String,
    pub(super) speech_mode: String,
    #[serde(default)]
    pub(super) location_id: u64,
    pub(super) resident_continuity: ResidentContinuityState,
    pub(super) economy_note: String,
    pub(super) goals: Vec<String>,
    pub(super) location_name: String,
    pub(super) location_title: String,
    pub(super) location_description: String,
    pub(super) location_persona: String,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub(super) location_evidence: Vec<PromptEvidence>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub(super) public_room_memory: Vec<PromptEvidence>,
    pub(super) cast: Vec<String>,
    pub(super) recent_lines: Vec<String>,
    #[serde(default)]
    pub(super) recent_activity: Vec<String>,
    pub(super) user_text: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(super) incoming_turn: Option<DirectedDialogueTurn>,
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
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(super) card_policy_snapshot: Option<ResidentCardPolicySnapshot>,
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
    pub(super) context_spine: AvatarContextSpine,
    #[serde(default)]
    pub(super) actor_id: u64,
    pub(super) location_id: u64,
    pub(super) actor_name: String,
    pub(super) actor_title: String,
    pub(super) actor_description: String,
    #[serde(default)]
    pub(super) actor_voice: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(super) actor_continuity: Option<ResidentContinuityState>,
    #[serde(default)]
    pub(super) target_actor_id: u64,
    pub(super) target_actor_name: String,
    pub(super) target_title: String,
    pub(super) target_economy_note: String,
    pub(super) goals: Vec<String>,
    pub(super) location_name: String,
    pub(super) location_title: String,
    pub(super) location_description: String,
    pub(super) location_persona: String,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub(super) location_evidence: Vec<PromptEvidence>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub(super) public_room_memory: Vec<PromptEvidence>,
    pub(super) cast: Vec<String>,
    pub(super) recent_lines: Vec<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub(super) recent_speaker_shingle_hashes: Vec<u64>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub(super) exchange_turns: Vec<DirectedDialogueTurn>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub(super) initiative_order: Vec<u64>,
    pub(super) fresh_subject: Option<String>,
    pub(super) missing_need: Option<String>,
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub(super) publication_beat_id: String,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(super) enum ChatFloorChoice {
    Chat,
    Pass,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct ChatFloorChoiceOutput {
    decision: String,
    #[serde(default)]
    target_actor_id: Option<u64>,
}

pub(super) async fn request_chat_floor_choice(
    config: &AiConfig,
    location_id: u64,
    speaker_actor_id: u64,
    speaker_name: &str,
    round: u8,
    available_targets: &[(u64, String)],
    recent_lines: &[CommittedOrbChatLine],
) -> Result<ChatFloorChoice, AiGatewayError> {
    let targets = available_targets
        .iter()
        .map(|(actor_id, name)| format!("{actor_id}: {name}"))
        .collect::<Vec<_>>()
        .join("\n");
    let transcript = recent_lines
        .iter()
        .rev()
        .take(6)
        .collect::<Vec<_>>()
        .into_iter()
        .rev()
        .map(|line| format!("{}: {}", line.speaker_actor_id, line.content))
        .collect::<Vec<_>>()
        .join("\n");
    let user = format!(
        "Initiative round: {round}\nSpeaker: {speaker_name} ({speaker_actor_id})\nPeople in the conversation:\n{targets}\nRecent public conversation:\n{transcript}\nChoose whether this speaker has something worthwhile to add now. Return only {{\"decision\":\"chat\"}} or {{\"decision\":\"pass\"}}. Passing is normal and should be preferred over repetition, filler, or forced agreement."
    );
    let response_format = serde_json::json!({ "type": "json_object" });
    let completion = request_chat_completion(
        config,
        ChatCompletionRequest {
            feature: "chat_floor_choice",
            prompt_version: "chat-floor-choice-v1",
            capability: ModelCapability::IntentJson,
            system: "You chair a bounded conversational floor. Choose exactly chat or pass for one speaker. Never invent a participant. Return one JSON object and no prose.",
            user: &user,
            temperature: 0.65,
            max_tokens: 48,
            timeout: Duration::from_secs(8),
            max_attempts: 1,
            referer: "http://127.0.0.1:3102",
            response_format: Some(&response_format),
            room_id: Some(location_id),
        },
    )
    .await?;
    let output = serde_json::from_str::<ChatFloorChoiceOutput>(completion.text.trim())
        .map_err(|_| AiGatewayError::invalid_response("chat floor choice"))?;
    match output.decision.trim().to_ascii_lowercase().as_str() {
        "pass" if output.target_actor_id.is_none() => Ok(ChatFloorChoice::Pass),
        "chat"
            if output.target_actor_id.is_none_or(|target_actor_id| {
                available_targets
                    .iter()
                    .any(|(candidate_id, _)| *candidate_id == target_actor_id)
            }) =>
        {
            Ok(ChatFloorChoice::Chat)
        }
        _ => Err(AiGatewayError::invalid_response("chat floor choice")),
    }
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
    let mut prompt_plan = plan.clone();
    prompt_plan
        .public_room_memory
        .extend(public_room_memory_for_state(state, plan.location_id));
    request_ai_avatar_intent(
        config,
        state
            .event_store_path
            .as_deref()
            .map(std::path::PathBuf::as_path),
        &prompt_plan,
    )
    .await
}

pub(super) async fn avatar_chat_text(
    state: &AppState,
    plan: &AvatarChatPlan,
) -> Result<CertifiedSpeech, GeneratedSpeechError> {
    let config = state.ai_config.as_ref().as_ref();
    let config = config.ok_or_else(|| AiGatewayError::unconfigured("avatar dialogue"))?;
    let mut prompt_plan = plan.clone();
    prompt_plan
        .public_room_memory
        .extend(public_room_memory_for_state(state, plan.location_id));
    request_ai_avatar_chat(
        config,
        state
            .event_store_path
            .as_deref()
            .map(std::path::PathBuf::as_path),
        &prompt_plan,
        false,
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
                "dialogue-avatar-followup-context-spine-v6"
            } else {
                "dialogue-avatar-context-spine-v6"
            },
            prompt: avatar_chat_prompt(plan, followup),
            temperature: 0.8,
            max_tokens: 70,
            referer: "http://127.0.0.1:3102",
            model_binding: None,
            room_id: Some(plan.location_id),
        },
        avatar_chat_gate_context(plan, followup),
    )
    .await
}

fn avatar_chat_context_spine(plan: &AvatarChatPlan, followup: bool) -> AvatarContextSpine {
    let mut spine = if plan.context_spine.is_current() {
        plan.context_spine.clone()
    } else {
        let continuity = plan
            .actor_continuity
            .as_ref()
            .map(|state| format_resident_continuity_for(state, Some(plan.target_actor_id)))
            .unwrap_or_default()
            .lines()
            .map(str::trim)
            .filter(|line| !line.is_empty())
            .map(ToString::to_string)
            .collect();
        AvatarContextSpine {
            schema_version: AVATAR_CONTEXT_SPINE_VERSION,
            speaker: AvatarContextActor {
                actor_id: plan.actor_id,
                name: plan.actor_name.clone(),
                title: plan.actor_title.clone(),
                description: plan.actor_description.clone(),
                voice: plan.actor_voice.clone(),
                calling: default_calling_statement().to_string(),
                control_mode: "direct_input".to_string(),
                level: 1,
                ..AvatarContextActor::default()
            },
            counterpart: Some(AvatarContextActor {
                actor_id: plan.target_actor_id,
                name: plan.target_actor_name.clone(),
                title: plan.target_title.clone(),
                ..AvatarContextActor::default()
            }),
            location: AvatarContextLocation {
                location_id: plan.location_id,
                name: plan.location_name.clone(),
                title: plan.location_title.clone(),
                description: plan.location_description.clone(),
                persona: plan.location_persona.clone(),
            },
            continuity,
            goals: plan.goals.clone(),
            location_evidence: plan.location_evidence.clone(),
            public_room_memory: plan.public_room_memory.clone(),
            cast: plan.cast.clone(),
            ..AvatarContextSpine::default()
        }
    };
    spine.speaker.actor_id = plan.actor_id;
    spine.speaker.name = plan.actor_name.clone();
    spine.speaker.title = plan.actor_title.clone();
    spine.speaker.description = plan.actor_description.clone();
    spine.speaker.voice = plan.actor_voice.clone();
    spine.speaker.control_mode = "direct_input".to_string();
    spine.counterpart = Some(AvatarContextActor {
        actor_id: plan.target_actor_id,
        name: plan.target_actor_name.clone(),
        title: plan.target_title.clone(),
        ..spine.counterpart.take().unwrap_or_default()
    });
    spine.location = AvatarContextLocation {
        location_id: plan.location_id,
        name: plan.location_name.clone(),
        title: plan.location_title.clone(),
        description: plan.location_description.clone(),
        persona: plan.location_persona.clone(),
    };
    spine.continuity = plan
        .actor_continuity
        .as_ref()
        .map(|state| format_resident_continuity_for(state, Some(plan.target_actor_id)))
        .unwrap_or_default()
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty())
        .map(ToString::to_string)
        .collect();
    spine.goals = plan.goals.clone();
    spine.location_evidence = plan.location_evidence.clone();
    spine.public_room_memory = plan.public_room_memory.clone();
    spine.cast = plan.cast.clone();
    if !plan.exchange_turns.is_empty() {
        spine.recent_dialogue = plan
            .exchange_turns
            .iter()
            .map(|turn| AvatarContextDialogueTurn {
                source_event_seq: turn.source_event_seq,
                speaker_actor_id: turn.speaker_actor_id,
                speaker_name: turn.speaker_name.clone(),
                recipient_actor_id: Some(turn.recipient_actor_id),
                recipient_name: Some(turn.recipient_name.clone()),
                content: turn.content.clone(),
            })
            .collect();
    }
    let directed = followup
        .then(|| {
            plan.exchange_turns
                .iter()
                .rev()
                .find(|turn| turn.recipient_actor_id == plan.actor_id)
                .cloned()
        })
        .flatten();
    let beat = directed
        .as_ref()
        .map(|turn| {
            format!(
                "{} has just addressed {} directly: {}",
                turn.speaker_name, turn.recipient_name, turn.content
            )
        })
        .or_else(|| {
            plan.fresh_subject
                .as_ref()
                .map(|subject| format!("A live subject between them is {subject}."))
        })
        .unwrap_or_else(|| spine.current_beat.clone());
    spine.with_incoming_turn(directed).with_current_beat(beat)
}

fn avatar_chat_prompt(plan: &AvatarChatPlan, followup: bool) -> PromptEnvelope {
    let word_budget = if followup { 28 } else { 34 };
    avatar_chat_context_spine(plan, followup).prompt(AvatarContextPromptOptions {
        mode: AvatarContextMode::Respond,
        speech_mode: SpeechMode::Prose,
        max_words: word_budget,
        response_job: if followup {
            format!(
                "Answer the directed turn as {}. Keep clear that {} is the speaker now; do not reverse who is asking whom, repeat the question, or fall into generic assistant talk.",
                plan.actor_name, plan.actor_name
            )
        } else {
            format!(
                "Open a conversation with {} because {}'s controller selected Chat. Follow a concrete live detail, preference, curiosity, or open thread. Do not ask about real-world work or tasks, and do not merely mirror a prior question.",
                plan.target_actor_name, plan.actor_name
            )
        },
    })
}

#[cfg(test)]
fn avatar_chat_user_prompt(plan: &AvatarChatPlan, followup: bool) -> String {
    avatar_chat_prompt(plan, followup).render_for_test().user
}

pub(super) async fn request_ai_avatar_intent(
    config: &AiConfig,
    store_path: Option<&Path>,
    plan: &AvatarReplyPlan,
) -> Result<CertifiedAvatarIntent, GeneratedSpeechError> {
    let model_binding = active_content()
        .actor_model_bindings
        .iter()
        .find(|binding| binding.actor_id == plan.speaker_actor_id)
        .cloned();
    if let Some(binding) = model_binding {
        let planning = if plan.planner_requested && !plan.planner_candidates.is_empty() {
            config
                .card_policy
                .as_deref()
                .map(|rollout| request_resident_card_policy(rollout, plan))
                .unwrap_or_else(|| resident_disposition_for_voice(plan).0)
        } else {
            resident_disposition_for_voice(plan).0
        };
        let planning_brief = resident_voice_planning_brief(&planning);
        let speech = route_certified_voice(
            config,
            store_path,
            VoiceAttemptRequest {
                feature: "dialogue_resident_raw",
                prompt_version: "dialogue-resident-raw-context-spine-v3",
                prompt: resident_voice_prompt(plan, &planning_brief),
                temperature: 0.0,
                max_tokens: 160,
                referer: "http://127.0.0.1:3102",
                model_binding: Some(binding),
                room_id: Some(plan.location_id),
            },
            resident_gate_context(plan, false),
        )
        .await?;
        let proposal = AvatarIntentProposal {
            speech: speech.text().to_string(),
            intent: None,
            belief: None,
            desire: None,
            promise: None,
            refusal: None,
            proposed_action: None,
        };
        return Ok(CertifiedAvatarIntent {
            proposal,
            speech,
            planning: planning.trace,
        });
    }
    let (planning, voice_action) = if !plan.planner_requested {
        resident_disposition_for_voice(plan)
    } else {
        let planning = request_resident_plan(config, plan).await;
        let voice_action = planning.proposed_action.clone();
        (planning, voice_action)
    };
    let planning_brief = resident_voice_planning_brief(&ResidentPlanningResult {
        proposed_action: voice_action,
        trace: planning.trace.clone(),
    });
    let prompt = resident_voice_prompt(plan, &planning_brief);

    let speech = route_certified_voice(
        config,
        store_path,
        VoiceAttemptRequest {
            feature: "dialogue_resident",
            prompt_version: "dialogue-resident-voice-context-spine-v6",
            prompt,
            temperature: 0.75,
            max_tokens: 120,
            referer: "http://127.0.0.1:3102",
            model_binding: None,
            room_id: Some(plan.location_id),
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

fn resident_voice_prompt(plan: &AvatarReplyPlan, planning_brief: &str) -> PromptEnvelope {
    let mut spine = if plan.context_spine.is_current() {
        plan.context_spine.clone()
    } else {
        let relationship_actor_id = plan
            .incoming_turn
            .as_ref()
            .map(|turn| turn.speaker_actor_id);
        let continuity =
            format_resident_continuity_for(&plan.resident_continuity, relationship_actor_id)
                .lines()
                .map(str::trim)
                .filter(|line| !line.is_empty())
                .map(ToString::to_string)
                .collect();
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
            counterpart: plan.incoming_turn.as_ref().map(|turn| AvatarContextActor {
                actor_id: turn.speaker_actor_id,
                name: turn.speaker_name.clone(),
                ..AvatarContextActor::default()
            }),
            location: AvatarContextLocation {
                location_id: plan.location_id,
                name: plan.location_name.clone(),
                title: plan.location_title.clone(),
                description: plan.location_description.clone(),
                persona: plan.location_persona.clone(),
            },
            continuity,
            goals: plan.goals.clone(),
            location_evidence: plan.location_evidence.clone(),
            public_room_memory: plan.public_room_memory.clone(),
            cast: plan.cast.clone(),
            recent_activity: plan.recent_activity.clone(),
            ..AvatarContextSpine::default()
        }
    };
    let relationship_actor_id = plan
        .incoming_turn
        .as_ref()
        .map(|turn| turn.speaker_actor_id);
    spine.speaker.actor_id = plan.speaker_actor_id;
    spine.speaker.name = plan.speaker_name.clone();
    spine.speaker.voice = plan.speaker_voice.clone();
    spine.location = AvatarContextLocation {
        location_id: plan.location_id,
        name: plan.location_name.clone(),
        title: plan.location_title.clone(),
        description: plan.location_description.clone(),
        persona: plan.location_persona.clone(),
    };
    spine.continuity =
        format_resident_continuity_for(&plan.resident_continuity, relationship_actor_id)
            .lines()
            .map(str::trim)
            .filter(|line| !line.is_empty())
            .map(ToString::to_string)
            .collect();
    spine.goals = plan.goals.clone();
    spine.location_evidence = plan.location_evidence.clone();
    spine.public_room_memory = plan.public_room_memory.clone();
    spine.cast = plan.cast.clone();
    spine.recent_activity = plan.recent_activity.clone();
    spine = spine
        .with_incoming_turn(plan.incoming_turn.clone())
        .with_current_beat(plan.user_text.clone());
    let response_job = if let Some(turn) = plan.incoming_turn.as_ref() {
        format!(
            "Respond as {} to {}'s directed line. {} is speaking now and {} is being answered. Do not reverse the roles, paraphrase the question back, or ask for a real-world task. {}",
            plan.speaker_name,
            turn.speaker_name,
            plan.speaker_name,
            turn.speaker_name,
            planning_brief
        )
    } else {
        format!(
            "Give {}'s immediate in-world response to the current beat. Prefer a concrete reaction, preference, or self-directed intention over generic assistance. {}",
            plan.speaker_name, planning_brief
        )
    };
    spine.prompt(AvatarContextPromptOptions {
        mode: AvatarContextMode::Respond,
        speech_mode: SpeechMode::from_name(&plan.speech_mode),
        max_words: resident_word_budget(plan),
        response_job,
    })
}

#[cfg(test)]
pub(super) fn resident_voice_user_prompt(plan: &AvatarReplyPlan, planning_brief: &str) -> String {
    resident_voice_prompt(plan, planning_brief)
        .render_for_test()
        .user
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
            "i am only considering {}; it has not happened",
            resident_voice_action_brief(action)
        ),
        (ResidentPlanningStatus::Rejected, _) => {
            "the move i considered did not fit; nothing changed".to_string()
        }
        (ResidentPlanningStatus::Superseded, _) => {
            "that older intention has passed; it did not happen".to_string()
        }
        (ResidentPlanningStatus::Accepted, Some(action)) => format!(
            "i mean to {}; no outcome has happened yet",
            resident_voice_action_brief(action)
        ),
        (ResidentPlanningStatus::Committed, Some(action)) => format!(
            "the room has already seen me {}",
            resident_voice_action_brief(action)
        ),
        _ => String::new(),
    }
}

fn resident_voice_action_brief(action: &AvatarProposedAction) -> String {
    action.kind.replace('_', " ")
}

fn avatar_chat_gate_context(plan: &AvatarChatPlan, followup: bool) -> SpeechGateContext {
    let recent_lines = if followup && !plan.exchange_turns.is_empty() {
        plan.exchange_turns
            .iter()
            .map(|turn| turn.content.clone())
            .collect()
    } else {
        plan.recent_lines.clone()
    };
    let mut anchors = vec![
        plan.location_name.clone(),
        plan.location_title.clone(),
        plan.target_actor_name.clone(),
    ];
    anchors.extend(
        plan.location_evidence
            .iter()
            .chain(&plan.public_room_memory)
            .map(|evidence| evidence.text.clone()),
    );
    anchors.extend(plan.goals.iter().cloned());
    anchors.extend(recent_lines.iter().cloned());
    anchors.extend(plan.exchange_turns.iter().flat_map(|turn| {
        [
            turn.speaker_name.clone(),
            turn.recipient_name.clone(),
            turn.content.clone(),
        ]
    }));
    anchors.extend(plan.fresh_subject.iter().cloned());
    anchors.extend(plan.missing_need.iter().cloned());
    // Whoever is actually in the room grounds a line as well as the room's own
    // name does. Without this the place name is the only anchor guaranteed to be
    // present, which made announcing it the cheapest way to pass the gate. See
    // issue #553.
    anchors.extend(plan.cast.iter().cloned());
    anchors.extend(avatar_chat_context_spine(plan, followup).anchors(AvatarContextMode::Respond));
    let other_speaker_names = std::iter::once(plan.target_actor_name.clone())
        .chain(plan.cast.iter().cloned())
        .chain(
            plan.exchange_turns
                .iter()
                .flat_map(|turn| [turn.speaker_name.clone(), turn.recipient_name.clone()]),
        )
        .filter(|name| !name.eq_ignore_ascii_case(&plan.actor_name))
        .collect();
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
        other_speaker_names,
        mode: SpeechMode::Prose,
        max_words: if followup { 28 } else { 34 },
        anchors,
        recent_lines,
        recent_speaker_shingle_hashes: plan.recent_speaker_shingle_hashes.clone(),
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
    anchors.extend(
        plan.location_evidence
            .iter()
            .chain(&plan.public_room_memory)
            .map(|evidence| evidence.text.clone()),
    );
    anchors.extend(plan.recent_activity.iter().cloned());
    anchors.extend(plan.recent_lines.iter().cloned());
    anchors.extend(plan.incoming_turn.iter().flat_map(|turn| {
        [
            turn.speaker_name.clone(),
            turn.recipient_name.clone(),
            turn.content.clone(),
        ]
    }));
    // As in avatar chat: the present cast and the speaker's own goals ground a
    // line as well as the room's name, so naming the room stops being the only
    // guaranteed way through the gate. See issue #553.
    anchors.extend(plan.cast.iter().cloned());
    anchors.extend(plan.goals.iter().cloned());
    if plan.context_spine.is_current() {
        anchors.extend(plan.context_spine.anchors(AvatarContextMode::Respond));
    }
    let other_speaker_names = plan
        .cast
        .iter()
        .cloned()
        .chain(
            plan.incoming_turn
                .iter()
                .flat_map(|turn| [turn.speaker_name.clone(), turn.recipient_name.clone()]),
        )
        .filter(|name| !name.eq_ignore_ascii_case(&plan.speaker_name))
        .collect();
    SpeechGateContext {
        feature: if plan.speech_mode == "raw" {
            "dialogue_resident_raw"
        } else {
            "dialogue_resident"
        },
        generation_key: publication_beat_id(
            &plan.publication_beat_id,
            plan.speaker_actor_id,
            plan.source_location_id.unwrap_or(0),
        ),
        speaker_actor_id: plan.speaker_actor_id,
        speaker_name: plan.speaker_name.clone(),
        other_speaker_names,
        mode: SpeechMode::from_name(&plan.speech_mode),
        max_words: resident_word_budget(plan),
        anchors,
        recent_lines: plan.recent_lines.clone(),
        recent_speaker_shingle_hashes: plan.resident_continuity.recent_voice_shingle_hashes.clone(),
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
    if plan.speech_mode == "raw" {
        return 80;
    }
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

/// Normalizes one durable note into a thought fragment: whitespace collapsed and the
/// authored terminal period dropped, so the caller owns the sentence punctuation.
fn continuity_thought(value: &str) -> String {
    let text = crate::compact_whitespace(value);
    // Continuity artifacts written before action intents became prompt-safe may still
    // contain the old machine projection, e.g. `propose pick_up; item 11453577331`.
    // Collapse only that exact generated shape so restored state cannot reintroduce an
    // entity id after the code path that created it has been fixed.
    let text = prompt_safe_legacy_action_intent(&text).unwrap_or(text);
    text.trim().trim_end_matches('.').trim().to_string()
}

fn prompt_safe_legacy_action_intent(value: &str) -> Option<String> {
    let (head, details) = value.split_once(';')?;
    let kind = head.trim().strip_prefix("propose ")?;
    let machine_details = details.split(';').all(|detail| {
        let words = detail.split_whitespace().collect::<Vec<_>>();
        match words.as_slice() {
            ["item" | "destination", id] => id.chars().all(|ch| ch.is_ascii_digit()),
            ["target", "actor", id] => id.chars().all(|ch| ch.is_ascii_digit()),
            _ => false,
        }
    });
    machine_details.then(|| {
        format!(
            "propose {}",
            crate::compact_whitespace(&kind.replace(['_', '-'], " "))
        )
    })
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
pub(super) fn format_resident_continuity_for(
    continuity: &ResidentContinuityState,
    relationship_actor_id: Option<u64>,
) -> String {
    let identity = continuity_thought(&continuity.stable_identity);
    let pending_action_intent = continuity
        .pending_action
        .as_ref()
        .and_then(resident_proposed_action_intent)
        .map(|intent| continuity_thought(&intent));
    let mut lines = Vec::new();
    if !identity.is_empty() {
        lines.push(format!("i am {identity}."));
    }
    if let Some(intent) = continuity.current_intent.as_deref() {
        let intent = continuity_thought(intent);
        if !intent.is_empty() && pending_action_intent.as_deref() != Some(intent.as_str()) {
            lines.push(format!("what i mean to do next: {intent}."));
        }
    }
    if let Some(note) = relationship_actor_id
        .and_then(|actor_id| continuity.relationship_notes_by_actor.get(&actor_id))
    {
        let note = continuity_thought(note);
        if !note.is_empty() {
            lines.push(format!("{note}."));
        }
    }
    for (_, note) in continuity
        .relationship_notes_by_actor
        .iter()
        .filter(|(actor_id, _)| Some(**actor_id) != relationship_actor_id)
        .take(3)
    {
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
    if let Some(intent) = pending_action_intent {
        lines.push(format!(
            "i am turning over: {intent}. only considered, not done."
        ));
    }
    for atom in continuity.memory_atoms.iter().take(6) {
        let atom = continuity_thought(&atom.text);
        if !atom.is_empty() {
            lines.push(format!("i remember: {atom}."));
        }
    }
    lines.join("\n")
}

#[cfg(test)]
pub(super) fn format_resident_continuity(continuity: &ResidentContinuityState) -> String {
    format_resident_continuity_for(continuity, None)
}

#[cfg(test)]
pub(super) fn resident_system_prompt(plan: &AvatarReplyPlan) -> String {
    let truth = "use supplied verified facts only · do not invent possessions, companions, memories, or completed actions";
    match SpeechMode::from_name(&plan.speech_mode) {
        SpeechMode::EmojiOnly => format!(
            "only {}'s next line · 3–6 emoji · no words · {truth}",
            plan.speaker_name,
        ),
        SpeechMode::EmoteOnly => format!(
            "only {}'s next line · one third-person emote in *asterisks* · no quoted speech · {truth}",
            plan.speaker_name,
        ),
        _ => format!(
            "only {}'s next spoken line · at most {} words · {truth}",
            plan.speaker_name,
            resident_word_budget(plan)
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
    fn pending_action_ids_never_reach_the_resident_voice_prompt() {
        let mut continuity = populated_continuity();
        continuity.current_intent = Some("propose pick_up; item 11453577331".to_string());

        let restored = format_resident_continuity(&continuity);
        assert!(restored.contains("what i mean to do next: propose pick up."));
        assert!(!restored.contains("11453577331"), "{restored}");

        continuity.pending_action = Some(AvatarProposedAction {
            kind: "pick_up".to_string(),
            item_id: Some(11_453_577_331),
            ..AvatarProposedAction::default()
        });

        let rendered = format_resident_continuity(&continuity);
        assert!(rendered.contains("i am turning over: propose pick up."));
        assert_eq!(rendered.matches("propose pick up").count(), 1);
        assert!(!rendered.contains("11453577331"), "{rendered}");
    }

    #[test]
    fn the_shared_voice_contract_contains_only_output_shape() {
        let (_, mut reply) = seeded_plans();
        reply.speaker_name = "Rati".to_string();
        reply.speech_mode = "prose".to_string();
        let system = resident_system_prompt(&reply);
        assert_eq!(
            system,
            "only Rati's next spoken line · at most 40 words · use supplied verified facts only · do not invent possessions, companions, memories, or completed actions"
        );
        for attractor in ["bodily", "catchphrase", "room's name", "teapot", "funny"] {
            assert!(
                !system.contains(attractor),
                "shared attractor leaked: {system}"
            );
        }
    }

    #[test]
    fn an_authored_persona_keeps_its_structural_contract_through_the_register_change() {
        // Oak answers as a bickering chorus and the voice prompt is the only place that
        // contract lives, so rewriting the register must not quietly drop a voice.
        let (_, mut reply) = seeded_plans();
        reply.speaker_actor_id = 1005;
        reply.economy_note = "no debts".to_string();
        reply.speaker_voice = "Root is stubborn, Ring cites precedent, Leaf loses the thread, and Hollow repeats what it should not; all four answer together without speaker labels or line breaks.".to_string();
        let oak = reply.speaker_voice;
        for chorus in ["Root", "Ring", "Leaf", "Hollow"] {
            assert!(oak.contains(chorus), "Oak lost {chorus}:\n{oak}");
        }
    }

    #[test]
    fn a_generated_resident_gets_an_interior_opener_not_a_generic_stub() {
        let (_, mut reply) = seeded_plans();
        reply.speaker_actor_id = 8331;
        reply.speaker_name = "Pip Marrow".to_string();
        reply.speech_mode = "prose".to_string();
        reply.economy_note = "no debts".to_string();
        let system = resident_system_prompt(&reply);
        assert_eq!(
            system,
            "only Pip Marrow's next spoken line · at most 40 words · use supplied verified facts only · do not invent possessions, companions, memories, or completed actions"
        );
    }

    fn gate_completion(text: &str) -> AiCompletion {
        AiCompletion {
            text: text.to_string(),
            reasoning_trace: None,
            attempts: 1,
            latency: std::time::Duration::from_millis(9),
            model_attribution: None,
            resolved_model_id: "test/model".to_string(),
            finish_reason: "stop".to_string(),
            usage: AiTokenUsage {
                prompt_tokens: Some(10),
                completion_tokens: Some(6),
                total_tokens: Some(16),
            },
            context_hash: "context".to_string(),
            prompt_version: "test-v1".to_string(),
        }
    }

    /// Issue #553: the anchor gate rejected any line without a deterministic
    /// anchor, and the room name was the only anchor guaranteed to be present.
    /// The cheapest way for a model to pass was therefore to front-load the
    /// place name, which it did on nearly every line ("Mossbell Inn, I've
    /// arrived—"). Whoever is actually in the room grounds a line just as well,
    /// so the cast now counts and naming the room stops being the cheap default.
    #[test]
    fn a_line_grounded_on_the_present_cast_passes_without_naming_the_room() {
        let (chat, _) = seeded_plans();
        let context = avatar_chat_gate_context(&chat, false);
        let companion = chat
            .cast
            .iter()
            .find(|name| **name != chat.actor_name)
            .cloned()
            .expect("the seeded cottage has another present actor");
        assert!(
            context.anchors.contains(&companion),
            "the present cast must be able to ground a line: {:?}",
            context.anchors
        );

        // A line that speaks to the person in front of it and never announces
        // where it is standing.
        let text = format!("{companion}, your hands are cold. Come sit nearer the kettle.");
        assert!(
            !text.contains(&chat.location_name),
            "the fixture line must not name the room: {text}"
        );
        certify_speech(
            None,
            gate_completion(&text),
            &text,
            avatar_chat_gate_context(&chat, false),
        )
        .expect("a cast-grounded line certifies without naming the room");
    }

    #[test]
    fn resident_speech_is_grounded_by_the_cast_and_its_own_goals() {
        let (_, reply) = seeded_plans();
        let context = resident_gate_context(&reply, false);
        for anchor in reply.cast.iter().chain(reply.goals.iter()) {
            assert!(
                context.anchors.contains(anchor),
                "{anchor:?} must ground resident speech: {:?}",
                context.anchors
            );
        }
    }

    #[test]
    fn direct_controlled_chat_and_proxy_speech_build_gate_contexts() {
        let (mut chat, mut proxy) = seeded_plans();
        chat.actor_id = 5000;
        chat.actor_name = "Elsie Starfield".to_string();
        chat.publication_beat_id = "direct-chat-event-71".to_string();
        let direct = avatar_chat_gate_context(&chat, false);
        assert_eq!(direct.feature, "dialogue_avatar");
        assert_eq!(direct.speaker_actor_id, 5000);
        assert_eq!(direct.speaker_name, "Elsie Starfield");
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
    fn avatar_followup_prompt_preserves_elsies_turn_and_ignores_room_chatter() {
        let (mut chat, _) = seeded_plans();
        chat.actor_id = 5000;
        chat.actor_name = "Elsie Starfield".to_string();
        chat.target_actor_name = "Judas Iscariot".to_string();
        chat.recent_lines = vec![
            "Passerby: I changed the subject after the reply.".to_string(),
            "Another passerby: Follow me instead.".to_string(),
        ];
        chat.exchange_turns = vec![
            DirectedDialogueTurn::new(
                5000,
                "Elsie Starfield",
                7013,
                "Judas Iscariot",
                "Judas, will you look at what changed here with me?",
            ),
            DirectedDialogueTurn::new(
                7013,
                "Judas Iscariot",
                5000,
                "Elsie Starfield",
                "I will look with you first. Bethlehem can wait.",
            ),
        ];

        let prompt = avatar_chat_user_prompt(&chat, true);
        assert!(prompt.contains("SELF · Elsie Starfield"));
        assert!(prompt.contains("Judas Iscariot said to Elsie Starfield:"));
        assert!(!prompt.contains("actor_id="));
        assert!(prompt.contains("I will look with you first. Bethlehem can wait."));
        assert!(!prompt.contains("Passerby"));

        let gate = avatar_chat_gate_context(&chat, true);
        assert_eq!(gate.speaker_actor_id, 5000);
        assert_eq!(gate.speaker_name, "Elsie Starfield");
        assert_eq!(
            gate.recent_lines,
            vec![
                "Judas, will you look at what changed here with me?".to_string(),
                "I will look with you first. Bethlehem can wait.".to_string(),
            ]
        );
    }

    #[test]
    fn direct_avatar_prompt_never_adopts_the_targets_first_person_continuity() {
        let (mut chat, _) = seeded_plans();
        chat.actor_id = 5000;
        chat.actor_name = "Elsie Starfield".to_string();
        chat.target_actor_name = "Judas Iscariot".to_string();
        chat.target_title = "traveller".to_string();
        let mut continuity = ResidentContinuityState::empty(
            5000,
            "Elsie Starfield, a road-worn witness.".to_string(),
        );
        continuity.current_intent = Some("keep pace with Judas on the road".to_string());
        continuity.beliefs = vec![ResidentContinuityNote {
            text: "the biscuit in my pocket is still warm".to_string(),
            source: "test".to_string(),
            confidence: 90,
            source_event_seq: Some(77),
        }];
        chat.actor_continuity = Some(continuity);

        let prompt = avatar_chat_user_prompt(&chat, false);
        assert!(prompt.contains("OTHER · Judas Iscariot — traveller"));
        assert!(prompt.contains("keep pace with Judas"));
        assert!(prompt.contains("biscuit in my pocket"));
        assert!(!prompt.contains("i am Judas"));
        assert_eq!(prompt.matches("SELF · Elsie Starfield").count(), 1);
    }

    #[test]
    fn native_model_avatar_receives_the_same_speaker_and_addressee_spine() {
        let (_, mut reply) = seeded_plans();
        reply.speaker_name = "Anthropic: Claude".to_string();
        reply.speech_mode = "raw".to_string();
        reply.incoming_turn = Some(DirectedDialogueTurn::new(
            5000,
            "Marnie Bramblewick",
            reply.speaker_actor_id,
            "Anthropic: Claude",
            "What are you noticing in this room?",
        ));
        let rendered = resident_voice_prompt(&reply, "").render_for_test();
        assert!(rendered.system.contains("native identity and voice"));
        assert!(rendered.user.contains("SELF · Anthropic: Claude"));
        assert!(rendered.user.contains(
            "DIRECTED TURN · Marnie Bramblewick said to Anthropic: Claude: What are you noticing in this room?"
        ));
        assert!(rendered.user.contains(
            "Anthropic: Claude is speaking now and Marnie Bramblewick is being answered"
        ));
    }

    #[test]
    fn directed_exchange_context_survives_avatar_chat_plan_serialization() {
        let (mut chat, _) = seeded_plans();
        chat.exchange_turns = vec![DirectedDialogueTurn::new(
            5000,
            "Elsie Starfield",
            7013,
            "Judas Iscariot",
            "Will you look at the road with me?",
        )];

        let encoded = serde_json::to_string(&chat).expect("serialize avatar Chat plan");
        let decoded: AvatarChatPlan =
            serde_json::from_str(&encoded).expect("deserialize avatar Chat plan");
        assert_eq!(decoded.exchange_turns, chat.exchange_turns);
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
        assert!(resident_voice_planning_brief(&absent).is_empty());
        assert!(!reply.planner_requested);
        assert!(reply.planner_candidates.is_empty());
    }

    #[test]
    fn cross_pack_direct_reaction_request_excludes_stale_economy_and_planner_intent() {
        let mut runtime = RuntimeWorld::seeded();
        create_test_human(
            &mut runtime,
            5000,
            COSY_COTTAGE_LOCATION_ID,
            "Lila Wayfarer",
        );
        let bethlehem_id = runtime
            .locations
            .iter()
            .find_map(|(location_id, name)| (name == "Bethlehem").then_some(*location_id))
            .expect("official world includes Bethlehem");
        runtime
            .world
            .actors
            .iter_mut()
            .take(runtime.world.actor_count)
            .find(|actor| actor.id == 5000)
            .expect("direct avatar exists")
            .location_id = bethlehem_id;
        runtime.event_log.push(EventView {
            seq: 90_001,
            type_name: "actor.moved".to_string(),
            success: true,
            actor_id: Some(5000),
            actor_name: Some("Lila Wayfarer".to_string()),
            location_id: Some(COSY_COTTAGE_LOCATION_ID),
            location_name: Some("The Cosy Cottage".to_string()),
            destination_location_id: Some(bethlehem_id),
            destination_location_name: Some("Bethlehem".to_string()),
            ..EventView::default()
        });

        let initial = runtime
            .resident_reaction_plan_for_target(
                5000,
                5000,
                "Lila Wayfarer just arrived in Bethlehem.",
            )
            .expect("direct avatar can react to her arrival");
        let proposed_action = AvatarProposedAction {
            kind: "search".to_string(),
            item_id: Some(HEARTH_TONIC_ITEM_ID),
            reason: Some("the old cottage motive is still pending".to_string()),
            ..AvatarProposedAction::default()
        };
        let mut pending_trace = ResidentPlanningTrace::absent(&initial);
        pending_trace.status = ResidentPlanningStatus::Accepted;
        let mut committed_trace = pending_trace.clone();
        committed_trace.status = ResidentPlanningStatus::Committed;
        let mut stale = initial.resident_continuity.clone();
        stale.current_intent = Some("seek Hearth Tonic near The Cosy Cottage".to_string());
        stale
            .open_obligations
            .push("return for Hearth Tonic at The Cosy Cottage".to_string());
        stale.pending_action = Some(proposed_action.clone());
        stale.pending_planning = Some(pending_trace);
        stale.last_planning_disposition = Some(ResidentPlanningDisposition {
            trace: committed_trace,
            proposed_action: Some(proposed_action),
        });
        runtime.resident_continuities.insert(5000, stale);

        let direct = runtime
            .resident_reaction_plan_for_target(
                5000,
                5000,
                "Lila Wayfarer just arrived in Bethlehem.",
            )
            .expect("direct reaction plan remains available");
        assert_eq!(
            direct.economy_note,
            DIRECTLY_CONTROLLED_SELF_REACTION_CONTEXT
        );
        assert!(direct.resident_continuity.current_intent.is_none());
        assert!(direct.resident_continuity.open_obligations.is_empty());
        assert!(direct.resident_continuity.pending_action.is_none());
        assert!(direct.resident_continuity.pending_planning.is_none());
        assert!(direct
            .resident_continuity
            .last_planning_disposition
            .is_none());
        assert!(direct
            .resident_continuity
            .memory_atoms
            .iter()
            .all(|atom| atom.kind != BELIEF_KIND_ACTOR_WANTS_ITEM));
        assert!(direct
            .resident_continuity
            .memory_atoms
            .iter()
            .any(|atom| atom.kind == BELIEF_KIND_ACTOR_LOCATION));
        let (planning, voice_action) = resident_disposition_for_voice(&direct);
        assert_eq!(planning.trace.status, ResidentPlanningStatus::Absent);
        assert!(voice_action.is_none());
        let request =
            resident_voice_user_prompt(&direct, &resident_voice_planning_brief(&planning));
        assert!(request.contains("Lila Wayfarer just arrived in Bethlehem."));
        assert!(request.contains("SCENE · Bethlehem"));
        assert!(!request.contains("Hearth Tonic"), "{request}");
        assert!(!request.contains("status=committed"));
        assert!(direct
            .recent_activity
            .iter()
            .any(|activity| activity.contains("Bethlehem")));

        let rati = runtime
            .actor_by_id(RATI_ACTOR_ID)
            .expect("inference resident exists");
        let npc_initial = runtime
            .resident_reply_plan_for_target(RATI_ACTOR_ID, RATI_ACTOR_ID, "The kettle rattled.")
            .expect("inference resident can speak");
        let mut npc_trace = ResidentPlanningTrace::absent(&npc_initial);
        npc_trace.status = ResidentPlanningStatus::Committed;
        let mut npc_continuity = runtime.resident_continuity_for(rati);
        npc_continuity.current_intent = Some("seek Moonwool Thread".to_string());
        npc_continuity.pending_action = Some(AvatarProposedAction {
            kind: "search".to_string(),
            ..AvatarProposedAction::default()
        });
        npc_continuity.last_planning_disposition = Some(ResidentPlanningDisposition {
            trace: npc_trace,
            proposed_action: npc_continuity.pending_action.clone(),
        });
        runtime
            .resident_continuities
            .insert(RATI_ACTOR_ID, npc_continuity);
        let npc = runtime
            .resident_reply_plan_for_target(RATI_ACTOR_ID, RATI_ACTOR_ID, "The kettle rattled.")
            .expect("inference resident keeps full continuity");
        assert_eq!(
            npc.resident_continuity.current_intent.as_deref(),
            Some("seek Moonwool Thread")
        );
        assert!(npc.resident_continuity.pending_action.is_some());
        assert!(npc.resident_continuity.last_planning_disposition.is_some());
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
        assert_eq!(proposed, "i am only considering move; it has not happened");

        planning.trace.status = ResidentPlanningStatus::Committed;
        let committed = resident_voice_planning_brief(&planning);
        assert_eq!(committed, "the room has already seen me move");
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
        .contains("the room has already seen me move"));
    }
}
