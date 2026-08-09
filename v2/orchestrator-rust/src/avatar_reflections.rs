use super::*;
use crate::ai_voice_routing::{route_certified_voice, VoiceAttemptRequest};

const AVATAR_THOUGHT_PROMPT_VERSION: &str = "avatar-thought-v1";
const AVATAR_DREAM_PROMPT_VERSION: &str = "avatar-dream-v1";
pub(super) const AVATAR_REFLECTION_DC: u16 = 18;

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
        Some(AvatarReflectionJob {
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
}

fn reflection_system(kind: AvatarReflectionKind) -> &'static str {
    match kind {
        AvatarReflectionKind::Thought => {
            "Write one brief first-person interior thought for a fictional game avatar. This is character voice, not hidden model reasoning or an explanation of decisions. Express a desire, preference, hesitation, curiosity, or feeling. Ground every concrete reference in the supplied facts. Do not invent possessions, items, companions, memories, actions, or world facts. Do not address the player. Output only the thought, with no label or quotation marks, under 45 words."
        }
        AvatarReflectionKind::Dream => {
            "Write one brief first-person dream fragment for a fictional game avatar waking from a long rest. This is character voice, not hidden model reasoning. It may transform supplied facts dreamily but must not assert a new possession, item, companion, memory, action, or world fact. Express desire and preference through the dream. Output only the dream fragment, with no label or quotation marks, under 55 words."
        }
    }
}

fn reflection_user(job: &AvatarReflectionJob) -> String {
    let recent = if job.recent_lines.is_empty() {
        "No recent conversation is recorded here.".to_string()
    } else {
        job.recent_lines.join("\n")
    };
    let roll = job
        .roll
        .as_ref()
        .map(|roll| {
            format!(
                "authoritative {} check: {} + {} = {} against DC {} — success",
                roll.ability, roll.raw_roll, roll.modifier, roll.total, roll.dc
            )
        })
        .unwrap_or_else(|| "authoritative reflection check: unavailable".to_string());
    format!(
        "avatar: {name} — {title}\n\
first-person persona: {persona}\n\
current desire or calling: {calling}\n\
verified place: {location}\n\
verified place description: {location_description}\n\
recent committed conversation, oldest to newest:\n{recent}\n\
{roll}\n\
\nStay inside {name}'s own stream of consciousness. Use at least one verified place or conversation detail. Refer to the avatar only by the verified name above; never invent a label or identity.",
        name = job.actor_name,
        title = job.actor_title,
        persona = job.persona,
        calling = job.calling,
        location = job.location_name,
        location_description = job.location_description,
        roll = roll,
    )
}

fn reflection_gate(job: &AvatarReflectionJob) -> SpeechGateContext {
    let mut anchors = vec![
        job.location_name.clone(),
        job.location_description.clone(),
        job.calling.clone(),
        job.persona.clone(),
    ];
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
            AvatarReflectionKind::Dream => 55,
        },
        anchors,
        recent_lines: job.recent_lines.clone(),
        recent_speaker_shingle_hashes: Vec::new(),
        has_proposed_action: false,
        envelope_valid: true,
        candidate_round: 1,
    }
}

pub(super) async fn complete_avatar_reflection(
    state: &AppState,
    job: AvatarReflectionJob,
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
            prompt: PromptEnvelope::default()
                .system(reflection_system(job.reflection_kind))
                .user(
                    reflection_user(&job),
                    PromptSegmentKind::UniqueEvidence,
                    100,
                    true,
                ),
            temperature: 0.85,
            max_tokens: 100,
            referer: "http://127.0.0.1:3102",
            model_binding: None,
            room_id: Some(job.source_location_id),
        },
        reflection_gate(&job),
    )
    .await
    .map_err(|error| error.to_string())?;
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

pub(super) fn insert_avatar_reflection_job(
    conn: &Connection,
    job: &AvatarReflectionJob,
    trigger_events: &[EventView],
) -> io::Result<bool> {
    let Some(job) = job.clone().with_committed_check(trigger_events) else {
        return Ok(false);
    };
    let payload = ActorJobPayload::AvatarReflection(job.clone());
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
    record.queued_actor_job = Some(ActorJobPayload::AvatarReflection(job.clone()));
}

#[cfg(test)]
mod tests {
    use super::*;

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
}
