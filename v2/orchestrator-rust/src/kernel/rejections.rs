use super::*;

pub(crate) const UNKNOWN_KERNEL_REJECTION_MESSAGE: &str =
    "That action could not be completed. Refresh the room and try again.";

pub(crate) fn kernel_rejection_message(reason: u16) -> &'static str {
    match reason {
        CW_REASON_INVALID_ACTION => {
            "That action is not available. Choose one of the actions shown and try again."
        }
        CW_REASON_ACTOR_NOT_FOUND => {
            "That traveler is no longer here. Refresh the room and try again."
        }
        CW_REASON_ACTOR_INACTIVE => {
            "You cannot act right now. Return when your traveler is active."
        }
        CW_REASON_LOCATION_NOT_FOUND => {
            "That place is no longer available. Refresh the room and choose another destination."
        }
        CW_REASON_ITEM_NOT_FOUND => {
            "That item is no longer here. Refresh the room and choose another item."
        }
        CW_REASON_ITEM_NOT_AVAILABLE => {
            "That item has moved or cannot be used right now. Refresh the room and try again."
        }
        CW_REASON_TARGET_NOT_FOUND => {
            "That person is no longer here. Refresh the room and choose someone nearby."
        }
        CW_REASON_TARGET_UNAVAILABLE => {
            "That person cannot take part right now. Choose someone else or try again later."
        }
        CW_REASON_NOT_SAME_LOCATION => {
            "You need to be in the same place to do that. Move closer and try again."
        }
        CW_REASON_COMBAT_NOT_ALLOWED => "Combat is not allowed here. Choose a non-combat action.",
        CW_REASON_SELF_TARGET => "Choose someone other than yourself for that action.",
        CW_REASON_NO_EXIT => "There is no path that way. Choose one of the available exits.",
        CW_REASON_EXIT_LOCKED => {
            "That way is locked. Find a way to unlock it or choose another exit."
        }
        CW_REASON_ENCOUNTER_NOT_FOUND => {
            "That scuffle has already ended or is no longer here. Refresh the room and try again."
        }
        CW_REASON_ENCOUNTER_FULL => {
            "That scuffle has no room for another participant. Wait for it to end."
        }
        CW_REASON_NOT_PARTICIPANT => {
            "You are not part of that scuffle. Join it before choosing a combat action."
        }
        CW_REASON_NOT_CURRENT_TURN => "It is not your turn yet. Wait for your turn before acting.",
        CW_REASON_NOT_HOSTILE => "That target is not an opponent. Choose a hostile participant.",
        CW_REASON_ENCOUNTER_ACTIVE => {
            "That scuffle is already underway. Choose an action available in the current scuffle."
        }
        CW_REASON_COMBAT_ACTION_REQUIRED => {
            "Finish the current scuffle before doing that. Choose a combat action now."
        }
        CW_REASON_CAPACITY_EXCEEDED => {
            "You cannot carry that much. Make room in your inventory and try again."
        }
        CW_REASON_REST_GRADE_OVERCLAIMED => {
            "That rest is not available here. Choose a rest option this shelter supports."
        }
        CW_REASON_GATE_CLOSED => {
            "That threshold is still closed to you. Meet one of its shown requirements or choose another way."
        }
        CW_REASON_STALE_GATE_OFFER => {
            "That threshold changed after this choice was offered. Refresh the room and choose again."
        }
        CW_REASON_GATE_CLAIM_CONFLICT => {
            "That threshold transition was already claimed by another result. Refresh the room before trying again."
        }
        CW_REASON_ACCOMPANIED => {
            "Your companion could not travel with you. Refresh the room and choose again."
        }
        _ => UNKNOWN_KERNEL_REJECTION_MESSAGE,
    }
}

pub(crate) fn rule_rejection_content(event: &CwEvent) -> Option<String> {
    (event.type_ == CW_EVENT_RULE_REJECTED)
        .then(|| kernel_rejection_message(event.reason).to_string())
}
