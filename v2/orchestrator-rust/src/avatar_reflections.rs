use super::*;
use crate::ai_voice_routing::{route_certified_voice, VoiceAttemptRequest};

const AVATAR_THOUGHT_PROMPT_VERSION: &str = "avatar-thought-context-spine-v2";
const AVATAR_DREAM_PROMPT_VERSION: &str = "avatar-dream-context-spine-v2";
const AVATAR_SELF_DESCRIPTION_PROMPT_VERSION: &str = "avatar-self-description-context-spine-v4";
const ITEM_SELF_DESCRIPTION_PROMPT_VERSION: &str = "item-self-description-context-spine-v2";
const LOCATION_SELF_DESCRIPTION_PROMPT_VERSION: &str = "location-self-description-context-spine-v2";
// The prose publication gate also enforces a 360-character ceiling. Ninety
// words invited valid prompt-following output that the gate could never
// publish; 48 words leaves room for ordinary word lengths and punctuation.
const SELF_DESCRIPTION_MAX_WORDS: usize = 48;
const SELF_DESCRIPTION_MAX_TOKENS: u32 = 128;
pub(super) const AVATAR_REFLECTION_DC: u16 = 18;

#[derive(Clone, Debug, Deserialize, Serialize)]
pub(super) struct AvatarSelfDescriptionProjection {
    pub(super) content_id: u64,
    pub(super) location_id: u64,
    pub(super) level: u8,
    pub(super) caused_by_event_seq: Option<u64>,
    pub(super) source_world_tick: u64,
    pub(super) observed_through_seq: u64,
    #[serde(default)]
    pub(super) identity: AvatarLevelIdentity,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub(super) enum AvatarReflectionKind {
    Thought,
    Dream,
}

impl AvatarReflectionKind {
    fn event_type(self) -> &'static str {
        match self {
            Self::Thought => "avatar.thought",
            Self::Dream => "avatar.dream",
        }
    }

    fn feature(self) -> &'static str {
        match self {
            Self::Thought => "avatar_thought",
            Self::Dream => "avatar_dream",
        }
    }

    fn prompt_version(self) -> &'static str {
        match self {
            Self::Thought => AVATAR_THOUGHT_PROMPT_VERSION,
            Self::Dream => AVATAR_DREAM_PROMPT_VERSION,
        }
    }
}

#[derive(Clone, Debug, Deserialize, Serialize)]
pub(super) struct AvatarReflectionJob {
    #[serde(default)]
    pub(super) context_spine: AvatarContextSpine,
    pub(super) actor_id: u64,
    pub(super) reflection_kind: AvatarReflectionKind,
    pub(super) source_world_tick: u64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(super) caused_by_event_seq: Option<u64>,
    pub(super) observed_through_seq: u64,
    pub(super) source_location_id: u64,
    pub(super) actor_name: String,
    pub(super) actor_title: String,
    pub(super) persona: String,
    pub(super) calling: String,
    pub(super) location_name: String,
    pub(super) location_description: String,
    pub(super) recent_lines: Vec<String>,
    #[serde(default)]
    pub(super) other_speaker_names: Vec<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(super) roll: Option<AvatarReflectionRoll>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
pub(super) struct AvatarReflectionRoll {
    pub(super) ability: String,
    pub(super) raw_roll: i16,
    pub(super) modifier: i16,
    pub(super) total: i16,
    pub(super) dc: i16,
    pub(super) success: bool,
}

impl AvatarReflectionJob {
    fn with_committed_check(mut self, events: &[EventView]) -> Option<Self> {
        let expected_ability = match self.reflection_kind {
            AvatarReflectionKind::Thought => "Intelligence",
            AvatarReflectionKind::Dream => "Wisdom",
        };
        let roll_event = events.iter().find(|event| {
            event.type_name == "ability_check.rolled"
                && event.actor_id == Some(self.actor_id)
                && event.dc == Some(AVATAR_REFLECTION_DC as i16)
                && event.ability.as_deref() == Some(expected_ability)
        })?;
        self.caused_by_event_seq = Some(roll_event.seq);
        self.observed_through_seq = self.observed_through_seq.max(
            events
                .iter()
                .map(|event| event.seq)
                .max()
                .unwrap_or(roll_event.seq),
        );
        self.roll = Some(AvatarReflectionRoll {
            ability: expected_ability.to_string(),
            raw_roll: roll_event.raw_roll.unwrap_or_default(),
            modifier: roll_event.modifier.unwrap_or_default(),
            total: roll_event.total.unwrap_or_default(),
            dc: roll_event.dc.unwrap_or(AVATAR_REFLECTION_DC as i16),
            success: roll_event.success
                && roll_event
                    .total
                    .zip(roll_event.dc)
                    .is_some_and(|(total, dc)| total >= dc),
        });
        if let Some(roll) = self.roll.as_ref() {
            self.context_spine = self.context_spine.clone().with_current_beat(format!(
                "An authoritative {} check succeeded: {} + {} = {} against DC {}.",
                roll.ability, roll.raw_roll, roll.modifier, roll.total, roll.dc
            ));
        }
        self.roll
            .as_ref()
            .is_some_and(|roll| roll.success)
            .then_some(self)
    }

    fn generation_key(&self) -> String {
        format!(
            "avatar-{}:{}:{}:{}",
            self.reflection_kind.feature(),
            self.actor_id,
            self.source_world_tick,
            self.caused_by_event_seq
                .unwrap_or(self.observed_through_seq)
        )
    }
}

impl RuntimeWorld {
    pub(super) fn avatar_reflection_job(
        &self,
        actor_id: u64,
        reflection_kind: AvatarReflectionKind,
    ) -> Option<AvatarReflectionJob> {
        let actor = self.actor_by_id(actor_id)?;
        let meta = self.actors.get(&actor_id)?;
        let location = self.location_meta_for(actor.location_id);
        let calling = self
            .calling_view(actor_id)
            .map(|calling| calling.statement)
            .unwrap_or_else(|| default_calling_statement().to_string());
        let actor_name = grounded_avatar_name_for_prompt(actor_id, &meta.name);
        let other_speaker_names = self
            .room_cast_names(actor.location_id)
            .into_iter()
            .filter(|name| !name.eq_ignore_ascii_case(&actor_name))
            .collect();
        let current_beat = match reflection_kind {
            AvatarReflectionKind::Thought => {
                format!("{actor_name} pauses after passing a turn and notices what presses inward.")
            }
            AvatarReflectionKind::Dream => format!(
                "{actor_name} settles into restorative sleep at {}.",
                self.location_name(actor.location_id)
                    .unwrap_or_else(|| "an unnamed place".to_string())
            ),
        };
        let context_spine = self.avatar_context_spine(actor_id, None, None, current_beat)?;
        Some(AvatarReflectionJob {
            context_spine,
            actor_id,
            reflection_kind,
            source_world_tick: self.world.tick,
            caused_by_event_seq: None,
            observed_through_seq: self.world.next_event_seq.saturating_sub(1),
            source_location_id: actor.location_id,
            actor_name,
            actor_title: meta.title.clone(),
            persona: grounded_avatar_persona_for_prompt(actor_id, &meta.description),
            calling,
            location_name: self
                .location_name(actor.location_id)
                .unwrap_or_else(|| "an unnamed place".to_string()),
            location_description: location.description,
            recent_lines: self.recent_room_lines(actor.location_id, 6),
            other_speaker_names,
            roll: None,
        })
    }

    pub(super) fn apply_avatar_reflection_check_presentation(
        &mut self,
        reflection_kind: AvatarReflectionKind,
        actor_id: u64,
        events: &mut [EventView],
    ) {
        let content = match reflection_kind {
            AvatarReflectionKind::Thought => "think",
            AvatarReflectionKind::Dream => "dream",
        };
        for event in events.iter_mut().filter(|event| {
            event.type_name == "ability_check.rolled"
                && event.actor_id == Some(actor_id)
                && event.dc == Some(AVATAR_REFLECTION_DC as i16)
        }) {
            event.content = Some(content.to_string());
            self.replace_projected_event(event);
        }
    }

    #[allow(clippy::too_many_arguments)]
    pub(super) fn append_avatar_reflection_event(
        &mut self,
        actor_id: u64,
        reflection_kind: AvatarReflectionKind,
        content_id: u64,
        location_id: u64,
        content: String,
        caused_by_event_seq: Option<u64>,
        source_world_tick: Option<u64>,
        observed_through_seq: Option<u64>,
    ) -> EventView {
        let mut event = self.append_async_job_event(
            reflection_kind.event_type(),
            actor_id,
            None,
            Some(content),
        );
        event.content_id = Some(content_id);
        event.location_id = Some(location_id);
        event.location_name = self.location_name(location_id);
        event.caused_by_event_seq = caused_by_event_seq;
        event.source_world_tick = source_world_tick;
        event.observed_through_seq = observed_through_seq;
        event.source_location_id = Some(location_id);
        self.replace_projected_event(&event);
        event
    }

    #[allow(clippy::too_many_arguments)]
    pub(super) fn append_avatar_self_description_event(
        &mut self,
        actor_id: u64,
        content_id: u64,
        location_id: u64,
        level: u8,
        content: String,
        caused_by_event_seq: Option<u64>,
        source_world_tick: Option<u64>,
        observed_through_seq: Option<u64>,
    ) -> EventView {
        let mut event =
            self.append_async_job_event("avatar.self_description", actor_id, None, Some(content));
        event.content_id = Some(content_id);
        event.location_id = Some(location_id);
        event.location_name = self.location_name(location_id);
        event.total = Some(i16::from(level));
        event.caused_by_event_seq = caused_by_event_seq;
        event.source_world_tick = source_world_tick;
        event.observed_through_seq = observed_through_seq;
        event.source_location_id = Some(location_id);
        self.replace_projected_event(&event);
        event
    }

    pub(super) fn append_avatar_self_description_projection(
        &mut self,
        actor_id: u64,
        projection: &AvatarSelfDescriptionProjection,
    ) -> Option<EventView> {
        let current_level = self.actor_by_id(actor_id)?.stats.level.max(1);
        if projection.level != current_level
            || !self.avatar_self_description_due(actor_id, projection.level)
        {
            return None;
        }
        let content = self
            .content
            .get(&projection.content_id)
            .cloned()
            .unwrap_or_default();
        self.entity_memories
            .entry(WorldEntityRef::avatar(actor_id).key())
            .or_default()
            .identity_by_level
            .insert(projection.level, projection.identity.clone());
        self.reset_community_art_after_avatar_description(actor_id, projection.level);
        Some(self.append_avatar_self_description_event(
            actor_id,
            projection.content_id,
            projection.location_id,
            projection.level,
            content,
            projection.caused_by_event_seq,
            Some(projection.source_world_tick),
            Some(projection.observed_through_seq),
        ))
    }
}

#[cfg(test)]
pub(super) fn avatar_level_identity_content(identity: &AvatarLevelIdentity) -> String {
    format!(
        "PERSONA: {}\nAPPEARANCE: {}\nCONTINUITY: {}",
        identity.persona, identity.appearance, identity.continuity
    )
}

pub(super) async fn queue_avatar_self_description(
    state: &AppState,
    actor_id: u64,
) -> Result<bool, String> {
    let job = {
        let runtime = state.inner.lock().await;
        let actor = runtime
            .actor_by_id(actor_id)
            .ok_or_else(|| "the self-describing avatar no longer exists".to_string())?;
        let level = actor.stats.level.max(1);
        if !runtime.avatar_can_redescribe_appearance(actor_id, level) {
            return Ok(false);
        }
        runtime
            .avatar_reflection_job(actor_id, AvatarReflectionKind::Thought)
            .ok_or_else(|| "self-description context could not be constructed".to_string())?
    };
    if let Some(path) = state.event_store_path.as_deref() {
        let queued = open_event_store(path)
            .and_then(|conn| insert_avatar_self_description_job(&conn, &job))
            .map_err(|error| error.to_string())?;
        state.actor_job_notify.notify_waiters();
        Ok(queued)
    } else {
        schedule_avatar_self_description(state, job);
        Ok(true)
    }
}

fn parse_avatar_level_identity(content: &str) -> Result<AvatarLevelIdentity, String> {
    let mut identity = AvatarLevelIdentity::default();
    for line in content
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty())
    {
        let Some((label, value)) = line.split_once(':') else {
            continue;
        };
        let value = value
            .trim()
            .trim_matches(|character| matches!(character, '*' | '_' | '`'))
            .trim();
        let label = label
            .trim()
            .trim_start_matches(['-', '*'])
            .trim()
            .trim_matches(|character| matches!(character, '*' | '_' | '`'));
        match label.to_ascii_uppercase().as_str() {
            "PERSONA" => identity.persona = value.to_string(),
            "APPEARANCE" => identity.appearance = value.to_string(),
            "CONTINUITY" => identity.continuity = value.to_string(),
            _ => {}
        }
    }
    if identity.persona.trim().is_empty()
        || identity.appearance.trim().is_empty()
        || identity.continuity.trim().is_empty()
    {
        return Err(
            "avatar self-description must contain PERSONA, APPEARANCE, and CONTINUITY lines"
                .to_string(),
        );
    }
    Ok(identity)
}

fn avatar_self_description_route_error(gate: AiReadinessGate) -> Option<&'static str> {
    let reason = gate.reason_code()?;
    Some(
        if gate.is_retryable_block()
            && !matches!(
                reason,
                AI_READINESS_PROBING | AI_RATE_LIMITED | AI_PROVIDER_UNAVAILABLE
            )
        {
            AI_PROVIDER_UNAVAILABLE
        } else {
            reason
        },
    )
}

fn reflection_context_spine(job: &AvatarReflectionJob) -> AvatarContextSpine {
    if job.context_spine.is_current() {
        return job.context_spine.clone();
    }
    let mut spine = AvatarContextSpine {
        schema_version: AVATAR_CONTEXT_SPINE_VERSION,
        world_tick: job.source_world_tick,
        observed_through_seq: job.observed_through_seq,
        speaker: AvatarContextActor {
            actor_id: job.actor_id,
            name: job.actor_name.clone(),
            title: job.actor_title.clone(),
            description: job.persona.clone(),
            calling: job.calling.clone(),
            control_mode: "autonomous".to_string(),
            level: 1,
            ..AvatarContextActor::default()
        },
        location: AvatarContextLocation {
            location_id: job.source_location_id,
            name: job.location_name.clone(),
            description: job.location_description.clone(),
            ..AvatarContextLocation::default()
        },
        recent_dialogue: job
            .recent_lines
            .iter()
            .map(|content| AvatarContextDialogueTurn {
                content: content.clone(),
                ..AvatarContextDialogueTurn::default()
            })
            .collect(),
        ..AvatarContextSpine::default()
    };
    spine.current_beat = job
        .roll
        .as_ref()
        .map(|roll| {
            format!(
                "An authoritative {} check succeeded: {} + {} = {} against DC {}.",
                roll.ability, roll.raw_roll, roll.modifier, roll.total, roll.dc
            )
        })
        .unwrap_or_else(|| "The avatar turns inward.".to_string());
    spine.refresh_semantic_recollections();
    spine
}

fn reflection_prompt(job: &AvatarReflectionJob) -> PromptEnvelope {
    let (mode, max_words, response_job) = match job.reflection_kind {
        AvatarReflectionKind::Thought => (
            AvatarContextMode::Think,
            45,
            "Follow the current inner pressure. Let the retrieved recollections influence the thought only where they are relevant.".to_string(),
        ),
        AvatarReflectionKind::Dream => (
            AvatarContextMode::Dream,
            75,
            "Dream associatively from this larger context. Transform its imagery without turning dream events into waking facts.".to_string(),
        ),
    };
    reflection_context_spine(job).prompt(AvatarContextPromptOptions {
        mode,
        speech_mode: SpeechMode::Prose,
        max_words,
        response_job,
    })
}

#[cfg(test)]
fn reflection_user(job: &AvatarReflectionJob) -> String {
    reflection_prompt(job).render_for_test().user
}

fn reflection_gate(job: &AvatarReflectionJob) -> SpeechGateContext {
    let mode = match job.reflection_kind {
        AvatarReflectionKind::Thought => AvatarContextMode::Think,
        AvatarReflectionKind::Dream => AvatarContextMode::Dream,
    };
    let mut anchors = reflection_context_spine(job).anchors(mode);
    anchors.extend(job.recent_lines.iter().cloned());
    SpeechGateContext {
        feature: job.reflection_kind.feature(),
        generation_key: job.generation_key(),
        speaker_actor_id: job.actor_id,
        speaker_name: job.actor_name.clone(),
        other_speaker_names: job.other_speaker_names.clone(),
        mode: SpeechMode::Prose,
        max_words: match job.reflection_kind {
            AvatarReflectionKind::Thought => 45,
            AvatarReflectionKind::Dream => 75,
        },
        anchors,
        signpost_openers: Vec::new(),
        recent_lines: job.recent_lines.clone(),
        recent_speaker_shingle_hashes: Vec::new(),
        has_proposed_action: false,
        requirements: VoiceBeatRequirements::default(),
        envelope_valid: true,
        candidate_round: 1,
    }
}

async fn complete_avatar_reflection_entry(
    state: &AppState,
    job: &AvatarReflectionJob,
) -> Result<(), String> {
    let config = state
        .ai_config
        .as_ref()
        .as_ref()
        .ok_or_else(|| "avatar reflection inference is not configured".to_string())?;
    let speech = route_certified_voice(
        config,
        state
            .event_store_path
            .as_deref()
            .map(std::path::PathBuf::as_path),
        VoiceAttemptRequest {
            feature: job.reflection_kind.feature(),
            prompt_version: job.reflection_kind.prompt_version(),
            prompt: reflection_prompt(job),
            temperature: match job.reflection_kind {
                AvatarReflectionKind::Thought => 0.82,
                AvatarReflectionKind::Dream => 0.95,
            },
            max_tokens: match job.reflection_kind {
                AvatarReflectionKind::Thought => 100,
                AvatarReflectionKind::Dream => 150,
            },
            referer: "http://127.0.0.1:3102",
            model_binding: None,
            room_id: Some(job.source_location_id),
        },
        reflection_gate(job),
    )
    .await
    .map_err(|error| {
        crate::ai_publication::record_ai_publication_rejections_with_logs(
            state,
            error.rejections(),
        );
        error.to_string()
    })?;
    let (content, receipt) = into_recorded_speech_parts(state, speech);

    let events = {
        let mut runtime = state.inner.lock().await;
        if runtime.actor_by_id(job.actor_id).is_none() {
            return Err("the reflecting avatar no longer exists".to_string());
        }
        let content_id = runtime.next_content_id_value();
        let mut record = JournalRecord::new(
            CwAction {
                kind: CW_ACTION_NONE,
                actor_id: job.actor_id,
                location_id: job.source_location_id,
                content_id,
                ..CwAction::default()
            },
            runtime.next_seed_value(),
        )
        .into_actor_consequence(job.source_world_tick, job.caused_by_event_seq);
        record.observed_through_seq = Some(job.observed_through_seq);
        record.source_location_id = Some(job.source_location_id);
        record.content_upserts.insert(content_id, content);
        record.ai_publication = Some(receipt);
        record
            .projection_mutations
            .push(ProjectionMutation::RecordAvatarReflection {
                reflection_kind: job.reflection_kind,
                content_id,
                location_id: job.source_location_id,
                caused_by_event_seq: job.caused_by_event_seq,
                source_world_tick: job.source_world_tick,
                observed_through_seq: job.observed_through_seq,
            });
        let (status, events) = commit_journal_record(state, &mut runtime, record)
            .map_err(|error| error.to_string())?;
        if status != CW_OK || events.is_empty() {
            return Err("the avatar reflection no longer fit the committed world".to_string());
        }
        events
    };
    broadcast_events(state, &events);
    Ok(())
}

pub(super) async fn complete_avatar_self_description(
    state: &AppState,
    source_job: &AvatarReflectionJob,
) -> Result<(), String> {
    let (spine, mut model_binding) = {
        let runtime = state.inner.lock().await;
        let actor = runtime
            .actor_by_id(source_job.actor_id)
            .ok_or_else(|| "the self-describing avatar no longer exists".to_string())?;
        let level = actor.stats.level.max(1);
        if !runtime.avatar_self_description_due(actor.id, level) {
            return Ok(());
        }
        let spine = runtime
            .avatar_context_spine(
                actor.id,
                None,
                None,
                format!(
                    "At level {level}, {} notices how lived events have changed their sense of self.",
                    source_job.actor_name
                ),
            )
            .ok_or_else(|| "self-description context could not be constructed".to_string())?;
        let model_binding = active_content()
            .actor_model_bindings
            .iter()
            .find(|binding| {
                binding.actor_id == actor.id
                    && binding.input_modalities.iter().any(|mode| mode == "text")
                    && binding.output_modalities.iter().any(|mode| mode == "text")
            })
            .cloned();
        if runtime
            .avatar_identity_policy(actor.id)
            .is_some_and(|identity| identity.mode != "authored")
            && model_binding.is_none()
        {
            return Err(
                "self-authored identity requires the avatar's exact text model".to_string(),
            );
        }
        (spine, model_binding)
    };
    let level = spine.speaker.level;
    let speech_mode = if model_binding.is_some() {
        SpeechMode::Raw
    } else {
        SpeechMode::Prose
    };
    let prompt = spine.prompt(AvatarContextPromptOptions {
        mode: AvatarContextMode::SelfDescription,
        speech_mode,
        max_words: SELF_DESCRIPTION_MAX_WORDS,
        response_job: "Describe the current self from lived evidence. Preserve continuity; make any change an interpretation, not a newly invented deed or fact.".to_string(),
    });
    let generation_key = avatar_self_description_generation_key(source_job);
    let config = state
        .ai_config
        .as_ref()
        .as_ref()
        .ok_or_else(|| "avatar self-description inference is not configured".to_string())?;
    match config.voice_route_gate(model_binding.as_ref()) {
        Ok(route_gate) => {
            if let Some(error) = avatar_self_description_route_error(route_gate) {
                if model_binding.is_some() {
                    warn!(
                        event = "avatar_self_description_server_fallback",
                        actor_id = source_job.actor_id,
                        level,
                        exact_error = error,
                        "avatar's exact model is unavailable for the internal portrait description; using the server voice model"
                    );
                    model_binding = None;
                } else {
                    return Err(error.to_string());
                }
            }
        }
        Err(error) if model_binding.is_some() => {
            warn!(
                event = "avatar_self_description_server_fallback",
                actor_id = source_job.actor_id,
                level,
                exact_error = %error,
                "avatar's exact model route could not be prepared for the internal portrait description; using the server voice model"
            );
            model_binding = None;
        }
        Err(error) => {
            return Err(format!(
                "avatar self-description model is unavailable: {error}"
            ));
        }
    }
    let request = VoiceAttemptRequest {
        feature: "avatar_self_description",
        prompt_version: AVATAR_SELF_DESCRIPTION_PROMPT_VERSION,
        prompt,
        temperature: 0.86,
        max_tokens: SELF_DESCRIPTION_MAX_TOKENS,
        referer: "http://127.0.0.1:3102",
        model_binding: model_binding.clone(),
        room_id: Some(source_job.source_location_id),
    };
    let gate = SpeechGateContext {
        feature: "avatar_self_description",
        generation_key,
        speaker_actor_id: source_job.actor_id,
        speaker_name: source_job.actor_name.clone(),
        other_speaker_names: source_job.other_speaker_names.clone(),
        mode: speech_mode,
        max_words: SELF_DESCRIPTION_MAX_WORDS,
        anchors: spine.anchors(AvatarContextMode::SelfDescription),
        signpost_openers: Vec::new(),
        recent_lines: spine
            .recent_dialogue
            .iter()
            .map(|turn| turn.content.clone())
            .collect(),
        recent_speaker_shingle_hashes: Vec::new(),
        has_proposed_action: false,
        requirements: VoiceBeatRequirements::default(),
        envelope_valid: true,
        candidate_round: 1,
    };
    let exact_result = route_certified_voice(
        config,
        state
            .event_store_path
            .as_deref()
            .map(std::path::PathBuf::as_path),
        request.clone(),
        gate.clone(),
    )
    .await;
    let speech = match exact_result {
        Ok(speech) => speech,
        Err(error) if model_binding.is_some() => {
            crate::ai_publication::record_ai_publication_rejections_with_logs(
                state,
                error.rejections(),
            );
            warn!(
                event = "avatar_self_description_server_fallback",
                actor_id = source_job.actor_id,
                level,
                exact_error = error.code(),
                "avatar's exact model could not complete the internal portrait description; using the server voice model"
            );
            let mut fallback_request = request;
            fallback_request.model_binding = None;
            let mut fallback_gate = gate;
            fallback_gate.generation_key.push_str(":server-fallback");
            route_certified_voice(
                config,
                state
                    .event_store_path
                    .as_deref()
                    .map(std::path::PathBuf::as_path),
                fallback_request,
                fallback_gate,
            )
            .await
            .map_err(|fallback_error| {
                crate::ai_publication::record_ai_publication_rejections_with_logs(
                    state,
                    fallback_error.rejections(),
                );
                fallback_error.to_string()
            })?
        }
        Err(error) => {
            crate::ai_publication::record_ai_publication_rejections_with_logs(
                state,
                error.rejections(),
            );
            return Err(error.to_string());
        }
    };
    let (content, receipt) = into_recorded_speech_parts(state, speech);
    let identity = parse_avatar_level_identity(&content)?;
    let events = {
        let mut runtime = state.inner.lock().await;
        if !runtime.avatar_self_description_due(source_job.actor_id, level) {
            return Ok(());
        }
        let content_id = runtime.next_content_id_value();
        let mut record = JournalRecord::new(
            CwAction {
                kind: CW_ACTION_NONE,
                actor_id: source_job.actor_id,
                location_id: source_job.source_location_id,
                content_id,
                ..CwAction::default()
            },
            runtime.next_seed_value(),
        )
        .into_actor_consequence(source_job.source_world_tick, source_job.caused_by_event_seq);
        record.observed_through_seq = Some(spine.observed_through_seq);
        record.source_location_id = Some(source_job.source_location_id);
        record.content_upserts.insert(content_id, content);
        record.ai_publication = Some(receipt);
        record
            .projection_mutations
            .push(ProjectionMutation::RecordAvatarSelfDescription(
                AvatarSelfDescriptionProjection {
                    content_id,
                    location_id: source_job.source_location_id,
                    level,
                    caused_by_event_seq: source_job.caused_by_event_seq,
                    source_world_tick: source_job.source_world_tick,
                    observed_through_seq: spine.observed_through_seq,
                    identity,
                },
            ));
        let (status, events) = commit_journal_record(state, &mut runtime, record)
            .map_err(|error| error.to_string())?;
        if status != CW_OK || events.is_empty() {
            return Err(
                "the avatar self-description no longer fit the committed world".to_string(),
            );
        }
        events
    };
    broadcast_events(state, &events);
    resume_avatar_art_after_self_description(state, source_job.actor_id).await;
    Ok(())
}

async fn complete_world_entity_self_description(
    state: &AppState,
    source_job: &AvatarReflectionJob,
    subject: WorldEntityRef,
) -> Result<(), String> {
    if subject.kind == WorldEntityKind::Avatar {
        return Ok(());
    }
    let spine = {
        let runtime = state.inner.lock().await;
        if !runtime.world_entity_self_description_due(subject) {
            return Ok(());
        }
        runtime
            .world_entity_context_spine(
                subject,
                format!(
                    "At level {}, this {} reconsiders what its recorded history has made of it.",
                    runtime.world_entity_level(subject).unwrap_or(1),
                    subject.kind.as_str()
                ),
            )
            .ok_or_else(|| "entity self-description context could not be constructed".to_string())?
    };
    let (feature, prompt_version) = match subject.kind {
        WorldEntityKind::Item => (
            "item_self_description",
            ITEM_SELF_DESCRIPTION_PROMPT_VERSION,
        ),
        WorldEntityKind::Location => (
            "location_self_description",
            LOCATION_SELF_DESCRIPTION_PROMPT_VERSION,
        ),
        WorldEntityKind::Avatar => return Ok(()),
    };
    let max_words = SELF_DESCRIPTION_MAX_WORDS;
    let generation_key = format!(
        "{}-self-description:{}:level:{}",
        subject.kind.as_str(),
        subject.id,
        spine.level
    );
    let config = state
        .ai_config
        .as_ref()
        .as_ref()
        .ok_or_else(|| "entity self-description inference is not configured".to_string())?;
    let speech = route_certified_voice(
        config,
        state
            .event_store_path
            .as_deref()
            .map(std::path::PathBuf::as_path),
        VoiceAttemptRequest {
            feature,
            prompt_version,
            prompt: spine.self_description_prompt(max_words),
            temperature: 0.88,
            max_tokens: SELF_DESCRIPTION_MAX_TOKENS,
            referer: "http://127.0.0.1:3102",
            model_binding: None,
            room_id: Some(source_job.source_location_id),
        },
        SpeechGateContext {
            feature,
            generation_key,
            speaker_actor_id: source_job.actor_id,
            speaker_name: spine.name.clone(),
            other_speaker_names: source_job.other_speaker_names.clone(),
            mode: SpeechMode::Prose,
            max_words,
            anchors: spine.anchors(),
            signpost_openers: Vec::new(),
            recent_lines: spine
                .selected_recollections
                .iter()
                .map(|memory| memory.text.clone())
                .collect(),
            recent_speaker_shingle_hashes: Vec::new(),
            has_proposed_action: false,
            requirements: VoiceBeatRequirements::default(),
            envelope_valid: spine.is_current(),
            candidate_round: 1,
        },
    )
    .await
    .map_err(|error| {
        crate::ai_publication::record_ai_publication_rejections_with_logs(
            state,
            error.rejections(),
        );
        error.to_string()
    })?;
    let (content, receipt) = into_recorded_speech_parts(state, speech);
    let events = {
        let mut runtime = state.inner.lock().await;
        if runtime.world_entity_level(subject) != Some(spine.level)
            || !runtime.world_entity_self_description_due(subject)
        {
            return Ok(());
        }
        let content_id = runtime.next_content_id_value();
        let mut record = JournalRecord::new(
            CwAction {
                kind: CW_ACTION_NONE,
                actor_id: source_job.actor_id,
                location_id: source_job.source_location_id,
                content_id,
                ..CwAction::default()
            },
            runtime.next_seed_value(),
        )
        .into_actor_consequence(source_job.source_world_tick, source_job.caused_by_event_seq);
        record.observed_through_seq = Some(spine.observed_through_seq);
        record.source_location_id = Some(source_job.source_location_id);
        record.content_upserts.insert(content_id, content);
        record.ai_publication = Some(receipt);
        record
            .projection_mutations
            .push(ProjectionMutation::RecordEntitySelfDescription(
                EntitySelfDescriptionProjection {
                    subject,
                    content_id,
                    level: spine.level,
                    source_actor_id: source_job.actor_id,
                    source_location_id: source_job.source_location_id,
                    caused_by_event_seq: source_job.caused_by_event_seq,
                    source_world_tick: source_job.source_world_tick,
                    observed_through_seq: spine.observed_through_seq,
                },
            ));
        let (status, events) = commit_journal_record(state, &mut runtime, record)
            .map_err(|error| error.to_string())?;
        if status != CW_OK || events.is_empty() {
            return Err(
                "the entity self-description no longer fit the committed world".to_string(),
            );
        }
        events
    };
    broadcast_events(state, &events);
    Ok(())
}

pub(super) async fn complete_avatar_reflection(
    state: &AppState,
    job: AvatarReflectionJob,
) -> Result<(), String> {
    complete_avatar_reflection_entry(state, &job).await?;
    if let Err(error) = complete_avatar_self_description(state, &job).await {
        warn!("avatar self-description failed after reflection: {}", error);
    }
    let (location_subject, item_subject) = {
        let runtime = state.inner.lock().await;
        (
            WorldEntityRef::location(job.source_location_id),
            runtime.next_due_item_description_subject(job.actor_id, job.source_location_id),
        )
    };
    if let Err(error) = complete_world_entity_self_description(state, &job, location_subject).await
    {
        warn!(
            "location self-description failed after reflection: {}",
            error
        );
    }
    if let Some(item_subject) = item_subject {
        if let Err(error) = complete_world_entity_self_description(state, &job, item_subject).await
        {
            warn!("item self-description failed after reflection: {}", error);
        }
    }
    Ok(())
}

pub(super) fn schedule_avatar_reflection(
    state: &AppState,
    job: AvatarReflectionJob,
    trigger_events: &[EventView],
) {
    if state.event_store_path.is_some() {
        state.actor_job_notify.notify_waiters();
        return;
    }
    let Some(job) = job.with_committed_check(trigger_events) else {
        return;
    };
    let state = state.clone();
    tokio::spawn(async move {
        if let Err(error) = complete_avatar_reflection(&state, job).await {
            warn!("asynchronous avatar reflection failed: {}", error);
        }
    });
}

static AVATAR_SELF_DESCRIPTION_JOBS: OnceLock<StdMutex<BTreeSet<String>>> = OnceLock::new();

fn avatar_self_description_generation_key(job: &AvatarReflectionJob) -> String {
    format!(
        "avatar-self-description:{}:level:{}:prompt:{}",
        job.actor_id,
        job.context_spine.speaker.level.max(1),
        AVATAR_SELF_DESCRIPTION_PROMPT_VERSION
    )
}

pub(super) fn schedule_avatar_self_description(state: &AppState, job: AvatarReflectionJob) {
    let key = avatar_self_description_generation_key(&job);
    let jobs = AVATAR_SELF_DESCRIPTION_JOBS.get_or_init(|| StdMutex::new(BTreeSet::new()));
    if !jobs
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
        .insert(key.clone())
    {
        return;
    }
    let state = state.clone();
    tokio::spawn(async move {
        if let Err(error) = complete_avatar_self_description(&state, &job).await {
            warn!("asynchronous avatar self-description failed: {}", error);
        }
        if let Some(jobs) = AVATAR_SELF_DESCRIPTION_JOBS.get() {
            jobs.lock()
                .unwrap_or_else(|poisoned| poisoned.into_inner())
                .remove(&key);
        }
    });
}

pub(super) fn insert_avatar_self_description_job(
    conn: &Connection,
    job: &AvatarReflectionJob,
) -> io::Result<bool> {
    let payload = ActorJobPayload::AvatarSelfDescription(Box::new(job.clone()));
    let generation_key = avatar_self_description_generation_key(job);
    if insert_actor_job_payload(
        conn,
        ACTOR_JOB_KIND_AVATAR_SELF_DESCRIPTION,
        job.actor_id,
        job.caused_by_event_seq,
        job.source_world_tick,
        job.observed_through_seq,
        Some(job.source_location_id),
        &generation_key,
        &payload,
        0,
    )? {
        return Ok(true);
    }
    let context_json = serde_json::to_string(&payload)
        .map_err(|error| io::Error::new(io::ErrorKind::InvalidData, error))?;
    let now = now_millis() as i64;
    let revived = conn
        .execute(
            "UPDATE actor_jobs
             SET actor_id = ?2, cause_event_seq = ?3, source_tick = ?4,
                 observed_through_seq = ?5, location_id = ?6, status = 'pending',
                 attempts = 0, lease_until_ms = NULL, available_at_ms = ?7,
                 context_json = ?8, last_error = NULL, updated_at_ms = ?7
             WHERE dedupe_key = ?1 AND kind = ?9 AND status = 'dead'
               AND last_error IN (
                   'ai_readiness_probing', 'ai_rate_limited',
                   'ai_provider_unavailable', 'voice_latency_exhausted',
                   'voice_provider_unavailable', 'voice_job_retry_exhausted',
                   'voice_no_eligible_candidates', 'voice_candidates_exhausted',
                   'voice_generation_in_flight', 'voice_spend_exhausted',
                   'avatar self-description must contain PERSONA, APPEARANCE, and CONTINUITY lines'
               )",
            params![
                generation_key,
                job.actor_id as i64,
                job.caused_by_event_seq.map(|seq| seq as i64),
                job.source_world_tick as i64,
                job.observed_through_seq as i64,
                job.source_location_id as i64,
                now,
                context_json,
                ACTOR_JOB_KIND_AVATAR_SELF_DESCRIPTION,
            ],
        )
        .map_err(sqlite_error)?;
    Ok(revived > 0)
}

pub(super) fn insert_avatar_reflection_job(
    conn: &Connection,
    job: &AvatarReflectionJob,
    trigger_events: &[EventView],
) -> io::Result<bool> {
    let Some(job) = job.clone().with_committed_check(trigger_events) else {
        return Ok(false);
    };
    let payload = ActorJobPayload::AvatarReflection(Box::new(job.clone()));
    insert_actor_job_payload(
        conn,
        ACTOR_JOB_KIND_AVATAR_REFLECTION,
        job.actor_id,
        job.caused_by_event_seq,
        job.source_world_tick,
        job.observed_through_seq,
        Some(job.source_location_id),
        &job.generation_key(),
        &payload,
        0,
    )
}

pub(super) fn reflection_check_action(
    actor_id: u64,
    source_location_id: u64,
    reflection_kind: AvatarReflectionKind,
) -> CwAction {
    CwAction {
        kind: CW_ACTION_ABILITY_CHECK,
        actor_id,
        location_id: source_location_id,
        ability: match reflection_kind {
            AvatarReflectionKind::Thought => CW_ABILITY_INTELLIGENCE,
            AvatarReflectionKind::Dream => CW_ABILITY_WISDOM,
        },
        dc: AVATAR_REFLECTION_DC,
        ..CwAction::default()
    }
}

pub(super) fn attach_avatar_reflection_check(record: &mut JournalRecord, job: AvatarReflectionJob) {
    let check_seed = record.seed.rotate_left(17)
        ^ match job.reflection_kind {
            AvatarReflectionKind::Thought => 0x7468_6f75_6768_7401,
            AvatarReflectionKind::Dream => 0x6472_6561_6d00_0001,
        };
    record
        .projection_mutations
        .push(ProjectionMutation::AvatarReflectionCheck {
            reflection_kind: job.reflection_kind,
            source_location_id: job.source_location_id,
            seed: check_seed,
        });
    record.queued_actor_job = Some(ActorJobPayload::AvatarReflection(Box::new(job.clone())));
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn avatar_identity_output_is_split_into_typed_fields() {
        let identity = parse_avatar_level_identity(
            "PERSONA: I am curious and deliberate.\nAPPEARANCE: I wear a silver-edged silhouette.\nCONTINUITY: I remember the first threshold I crossed.",
        )
        .expect("typed identity");
        assert_eq!(identity.persona, "I am curious and deliberate.");
        assert_eq!(identity.appearance, "I wear a silver-edged silhouette.");
        assert_eq!(
            identity.continuity,
            "I remember the first threshold I crossed."
        );
    }

    #[test]
    fn avatar_identity_output_accepts_harmless_markdown_labels() {
        let identity = parse_avatar_level_identity(
            "- **PERSONA:** Curious and deliberate.\n- **APPEARANCE:** A round blue form with bright eyes and a wool coat.\n- **CONTINUITY:** Keeps the same blue colouring.",
        )
        .expect("markdown-decorated typed identity");
        assert_eq!(identity.persona, "Curious and deliberate.");
        assert_eq!(
            identity.appearance,
            "A round blue form with bright eyes and a wool coat."
        );
        assert_eq!(identity.continuity, "Keeps the same blue colouring.");
    }

    #[test]
    fn avatar_identity_output_requires_persona_appearance_and_continuity() {
        assert!(parse_avatar_level_identity("PERSONA: I am still forming.").is_err());
    }

    #[test]
    fn reflection_prompt_uses_names_and_facts_without_runtime_ids() {
        let mut runtime = RuntimeWorld::seeded();
        runtime.actors.get_mut(&1002).expect("Gust metadata").name = "Traveler 1002".to_string();
        let job = runtime
            .avatar_reflection_job(1002, AvatarReflectionKind::Thought)
            .expect("Gust can think");
        let prompt = reflection_user(&job);
        assert!(!prompt.contains("1002"));
        assert!(!prompt.contains("Traveler 1002"));
        assert!(!prompt.contains("actor_id"));
    }

    fn roll_event(actor_id: u64, ability: &str, total: i16, success: bool) -> EventView {
        EventView {
            seq: 77,
            type_name: "ability_check.rolled".to_string(),
            success,
            actor_id: Some(actor_id),
            ability: Some(ability.to_string()),
            raw_roll: Some(total - 2),
            modifier: Some(2),
            total: Some(total),
            dc: Some(AVATAR_REFLECTION_DC as i16),
            ..EventView::default()
        }
    }

    #[test]
    fn thought_and_dream_checks_use_their_authoritative_abilities() {
        let runtime = RuntimeWorld::seeded();
        let thought = runtime
            .avatar_reflection_job(1002, AvatarReflectionKind::Thought)
            .expect("Gust can think");
        let dream = runtime
            .avatar_reflection_job(1002, AvatarReflectionKind::Dream)
            .expect("Gust can dream");
        let thought_action = reflection_check_action(
            thought.actor_id,
            thought.source_location_id,
            thought.reflection_kind,
        );
        let dream_action = reflection_check_action(
            dream.actor_id,
            dream.source_location_id,
            dream.reflection_kind,
        );
        assert_eq!(thought_action.kind, CW_ACTION_ABILITY_CHECK);
        assert_eq!(thought_action.ability, CW_ABILITY_INTELLIGENCE);
        assert_eq!(thought_action.dc, AVATAR_REFLECTION_DC);
        assert_eq!(dream_action.kind, CW_ACTION_ABILITY_CHECK);
        assert_eq!(dream_action.ability, CW_ABILITY_WISDOM);
        assert_eq!(dream_action.dc, AVATAR_REFLECTION_DC);
        assert!(thought
            .clone()
            .with_committed_check(&[roll_event(1002, "Wisdom", 18, true)])
            .is_none());
        assert!(dream
            .with_committed_check(&[roll_event(1002, "Wisdom", 18, true)])
            .is_some());
    }

    #[test]
    fn only_a_successful_rare_check_becomes_an_ai_job() {
        let runtime = RuntimeWorld::seeded();
        let job = runtime
            .avatar_reflection_job(1002, AvatarReflectionKind::Thought)
            .expect("Gust can think");
        assert!(job
            .clone()
            .with_committed_check(&[roll_event(1002, "Intelligence", 17, false)])
            .is_none());
        let accepted = job
            .with_committed_check(&[roll_event(1002, "Intelligence", 18, true)])
            .expect("successful check queues inference");
        assert!(accepted.roll.is_some_and(|roll| roll.success));
        assert_eq!(accepted.caused_by_event_seq, Some(77));
    }

    #[test]
    fn self_description_projection_is_journaled_with_its_level() {
        let mut runtime = RuntimeWorld::seeded();
        let actor = runtime.actor_by_id(1002).expect("Gust exists");
        let level = actor.stats.level.max(1);
        let content_id = 770_002;
        let mut record = JournalRecord::new(
            CwAction {
                kind: CW_ACTION_NONE,
                actor_id: actor.id,
                location_id: actor.location_id,
                content_id,
                ..CwAction::default()
            },
            770_003,
        );
        record.content_upserts.insert(
            content_id,
            "I am becoming more patient with unanswered weather.".to_string(),
        );
        record
            .projection_mutations
            .push(ProjectionMutation::RecordAvatarSelfDescription(
                AvatarSelfDescriptionProjection {
                    content_id,
                    location_id: actor.location_id,
                    level,
                    caused_by_event_seq: Some(77),
                    source_world_tick: runtime.world.tick,
                    observed_through_seq: runtime.world.next_event_seq.saturating_sub(1),
                    identity: AvatarLevelIdentity::default(),
                },
            ));
        let (status, events) = runtime.apply_journal_record(&record);
        assert_eq!(status, CW_OK);
        assert!(events.iter().any(|event| {
            event.type_name == "avatar.self_description"
                && event.actor_id == Some(actor.id)
                && event.total == Some(i16::from(level))
                && event.content.as_deref()
                    == Some("I am becoming more patient with unanswered weather.")
        }));
        assert!(!runtime.avatar_self_description_due(actor.id, level));
    }

    #[test]
    fn durable_outbox_never_queues_a_failed_reflection_check() {
        let path = std::env::temp_dir().join(format!(
            "cosyworld-avatar-reflection-outbox-{}-{}.sqlite",
            std::process::id(),
            now_seed()
        ));
        let _ = fs::remove_file(&path);
        init_event_store(&path).expect("initialize reflection outbox");
        let runtime = RuntimeWorld::seeded();
        let job = runtime
            .avatar_reflection_job(1002, AvatarReflectionKind::Thought)
            .expect("Gust can think");
        let conn = open_event_store(&path).expect("open reflection outbox");

        assert!(!insert_avatar_reflection_job(
            &conn,
            &job,
            &[roll_event(1002, "Intelligence", 17, false)],
        )
        .expect("failed check is a valid no-op"));
        let failed_count: i64 = conn
            .query_row("SELECT COUNT(*) FROM actor_jobs", [], |row| row.get(0))
            .expect("failed-check job count");
        assert_eq!(failed_count, 0);

        assert!(insert_avatar_reflection_job(
            &conn,
            &job,
            &[roll_event(1002, "Intelligence", 18, true)],
        )
        .expect("successful check queues one job"));
        drop(conn);
        let claimed = claim_next_actor_job_of_kind(&path, ACTOR_JOB_KIND_AVATAR_REFLECTION)
            .expect("claim reflection job")
            .expect("successful check left one durable job");
        let ActorJobPayload::AvatarReflection(committed) = claimed.payload else {
            panic!("reflection lane returned the wrong payload");
        };
        assert_eq!(committed.caused_by_event_seq, Some(77));
        assert_eq!(committed.roll.as_ref().map(|roll| roll.total), Some(18));
        let _ = fs::remove_file(path);
    }

    #[test]
    fn self_description_has_its_own_durable_once_per_level_job() {
        let path = std::env::temp_dir().join(format!(
            "cosyworld-avatar-self-description-outbox-{}-{}.sqlite",
            std::process::id(),
            now_seed()
        ));
        let _ = fs::remove_file(&path);
        init_event_store(&path).expect("initialize self-description outbox");
        let runtime = RuntimeWorld::seeded();
        let job = runtime
            .avatar_reflection_job(1002, AvatarReflectionKind::Thought)
            .expect("Gust can describe themself");
        let conn = open_event_store(&path).expect("open self-description outbox");

        assert!(insert_avatar_self_description_job(&conn, &job).expect("first level job is queued"));
        let dedupe_key: String = conn
            .query_row("SELECT dedupe_key FROM actor_jobs", [], |row| row.get(0))
            .expect("read versioned self-description key");
        assert_eq!(
            dedupe_key,
            format!(
                "avatar-self-description:1002:level:{}:prompt:{}",
                job.context_spine.speaker.level.max(1),
                AVATAR_SELF_DESCRIPTION_PROMPT_VERSION
            )
        );
        assert!(!insert_avatar_self_description_job(&conn, &job)
            .expect("duplicate level job is ignored"));
        conn.execute(
            "UPDATE actor_jobs SET status = 'dead', attempts = 3,
                    lease_until_ms = NULL, last_error = 'voice_no_eligible_candidates'",
            [],
        )
        .expect("dead-letter the old self-description attempt");
        assert!(insert_avatar_self_description_job(&conn, &job)
            .expect("an old exact-model failure is revived for server fallback"));
        let revived: (String, u32, Option<String>) = conn
            .query_row(
                "SELECT status, attempts, last_error FROM actor_jobs",
                [],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
            )
            .expect("read revived self-description job");
        assert_eq!(revived, ("pending".to_string(), 0, None));
        assert!(!insert_avatar_self_description_job(&conn, &job)
            .expect("the revived pending level job is still deduplicated"));
        drop(conn);
        let claimed = claim_next_actor_job_of_kind(&path, ACTOR_JOB_KIND_AVATAR_SELF_DESCRIPTION)
            .expect("claim self-description job")
            .expect("self-description job remains durable");
        let ActorJobPayload::AvatarSelfDescription(committed) = claimed.payload else {
            panic!("self-description lane returned the wrong payload");
        };
        assert_eq!(committed.actor_id, 1002);
        let _ = fs::remove_file(path);
    }

    #[test]
    fn self_description_route_errors_preserve_retryable_and_terminal_meaning() {
        let probing = AiReadiness::probing_with_low_credit_threshold(5.0);
        assert_eq!(
            avatar_self_description_route_error(probing.gate("chat/completions", "provider/model")),
            Some(AI_READINESS_PROBING)
        );

        let exact_route = AiReadiness::default();
        exact_route.record_http_failure("chat/completions", "provider/model", 404, None);
        assert_eq!(
            avatar_self_description_route_error(
                exact_route.gate("chat/completions", "provider/model")
            ),
            Some(AI_PROVIDER_UNAVAILABLE),
            "a temporary incompatible route stays retryable without spending an attempt"
        );

        probing.record_probe_http_failure(401);
        assert_eq!(
            avatar_self_description_route_error(probing.gate("chat/completions", "provider/model")),
            Some(AI_ACCOUNT_UNAUTHORIZED),
            "a permanent account failure must not enter the endless retry lane"
        );
    }
}
