use super::*;

#[derive(Clone, Debug)]
pub(super) struct ActorJob {
    pub(super) id: i64,
    pub(super) kind: String,
    pub(super) actor_id: u64,
    pub(super) attempts: u32,
    pub(super) payload: ActorJobPayload,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(tag = "payload_kind", content = "payload", rename_all = "snake_case")]
pub(super) enum ActorJobPayload {
    PlayerTick(PlayerTickObservation),
    OrbChat(OrbChatJob),
    ModelInteraction(ModelInteractionJob),
    AvatarReflection(AvatarReflectionJob),
}

#[derive(Clone, Debug, Deserialize, Serialize)]
pub(super) struct OrbChatJob {
    pub(super) actor_id: u64,
    pub(super) target_actor_id: u64,
    pub(super) plan: AvatarChatPlan,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(super) queue_event_id: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(super) source_world_tick: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(super) observed_through_seq: Option<u64>,
}

pub(super) const ACTOR_JOB_KIND_PLAYER_TICK: &str = "player_tick_observation";
pub(super) const ACTOR_JOB_KIND_ORB_CHAT: &str = "orb_chat";
pub(super) const ACTOR_JOB_KIND_MODEL_INTERACTION: &str = "model_interaction";
pub(super) const ACTOR_JOB_KIND_AVATAR_REFLECTION: &str = "avatar_reflection";
pub(super) const ACTOR_JOB_LEASE_MS: u64 = 120_000;
pub(super) const ACTOR_JOB_MAX_ATTEMPTS: u32 = 3;
pub(super) const ACTOR_JOB_IDLE_POLL: Duration = Duration::from_secs(2);
pub(super) const CARD_REACTION_HEARTBEAT_DELAY_MS: u64 = 3_000;
