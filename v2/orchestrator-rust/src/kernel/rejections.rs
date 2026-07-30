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
        _ => UNKNOWN_KERNEL_REJECTION_MESSAGE,
    }
}

pub(crate) fn rule_rejection_content(event: &CwEvent) -> Option<String> {
    (event.type_ == CW_EVENT_RULE_REJECTED)
        .then(|| kernel_rejection_message(event.reason).to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::*;
    use std::collections::HashSet;

    #[test]
    fn kernel_rejection_messages_cover_the_current_reason_contract() {
        assert_eq!(
            unsafe { cw_rejection_reason_max() },
            CW_REASON_MAX_KNOWN,
            "a new authoritative kernel rejection needs player-facing copy"
        );
        let messages = (1..=CW_REASON_MAX_KNOWN)
            .map(kernel_rejection_message)
            .collect::<Vec<_>>();

        assert_eq!(messages.len(), 25);
        assert_eq!(messages.iter().copied().collect::<HashSet<_>>().len(), 25);
        assert!(messages
            .iter()
            .all(|message| *message != UNKNOWN_KERNEL_REJECTION_MESSAGE));
        assert!(messages.iter().all(|message| {
            let message = message.to_ascii_lowercase();
            !message.contains("kernel")
                && !message.contains("reason code")
                && !message.contains("cw_reason")
        }));

        assert_eq!(
            kernel_rejection_message(CW_REASON_INVALID_ACTION),
            "That action is not available. Choose one of the actions shown and try again."
        );
        assert_eq!(
            kernel_rejection_message(CW_REASON_ACTOR_INACTIVE),
            "You cannot act right now. Return when your traveler is active."
        );
        assert_eq!(
            kernel_rejection_message(CW_REASON_EXIT_LOCKED),
            "That way is locked. Find a way to unlock it or choose another exit."
        );
        assert_eq!(
            kernel_rejection_message(CW_REASON_CAPACITY_EXCEEDED),
            "You cannot carry that much. Make room in your inventory and try again."
        );
        assert_eq!(
            kernel_rejection_message(CW_REASON_NOT_CURRENT_TURN),
            "It is not your turn yet. Wait for your turn before acting."
        );

        for unknown in [0, CW_REASON_MAX_KNOWN + 1, u16::MAX] {
            assert_eq!(
                kernel_rejection_message(unknown),
                UNKNOWN_KERNEL_REJECTION_MESSAGE
            );
        }
    }

    #[test]
    fn rule_rejection_view_adds_copy_without_changing_the_canonical_reason() {
        let runtime = RuntimeWorld::seeded();
        let view = runtime.event_view(&CwEvent {
            type_: CW_EVENT_RULE_REJECTED,
            success: 0,
            reason: CW_REASON_ITEM_NOT_AVAILABLE,
            actor_id: 5000,
            ..CwEvent::default()
        });

        assert_eq!(view.type_name, "rule.rejected");
        assert_eq!(view.reason, CW_REASON_ITEM_NOT_AVAILABLE);
        assert_eq!(
            view.content.as_deref(),
            Some(
                "That item has moved or cannot be used right now. Refresh the room and try again."
            )
        );
    }

    #[test]
    fn rule_rejection_consumers_prefer_projected_copy_and_fall_back_safely() {
        let projected = EventView {
            type_name: "rule.rejected".to_string(),
            reason: CW_REASON_NO_EXIT,
            content: Some("Choose another visible path.".to_string()),
            ..EventView::default()
        };
        let legacy_unknown = EventView {
            type_name: "rule.rejected".to_string(),
            reason: u16::MAX,
            content: None,
            ..EventView::default()
        };

        assert_eq!(
            command_event_output(&projected).as_deref(),
            Some("Choose another visible path.")
        );
        assert_eq!(
            command_event_output(&legacy_unknown).as_deref(),
            Some(UNKNOWN_KERNEL_REJECTION_MESSAGE)
        );
        assert!(INDEX_HTML.contains(
            "return String(event.content || \"\").trim()\n          || \"That action could not be completed. Refresh the room and try again.\";"
        ));

        let cli = include_str!("../../../cli/cosy_cli.py");
        assert!(cli.contains("reason = \" \".join(str(event.get(\"content\") or \"\").split())"));
        assert!(cli.contains(UNKNOWN_KERNEL_REJECTION_MESSAGE));
        assert!(!cli.contains("Rule rejected for {actor} (reason"));
    }
}
