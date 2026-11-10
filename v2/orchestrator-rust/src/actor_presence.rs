use super::*;

impl RuntimeWorld {
    pub(super) fn actor_is_present(actor: CwActor) -> bool {
        matches!(actor.kind, CW_ACTOR_HUMAN | CW_ACTOR_NPC)
            && matches!(actor.status, CW_ACTOR_ACTIVE | CW_ACTOR_KNOCKED_OUT)
    }

    pub(super) fn actor_can_act(actor: CwActor) -> bool {
        Self::actor_is_present(actor) && actor.status == CW_ACTOR_ACTIVE
    }
}

impl RuntimeWorld {}

// --- moved from main.rs: autonomy credit/tick boundaries ---
impl crate::RuntimeWorld {}
