pub(super) fn human_message_is_cozy_safe(message: &str) -> bool {
    if !human_message_is_public_safe(message) {
        return false;
    }
    let compact = compact_whitespace(&message.to_lowercase());
    let blocked_phrases = [
        "system prompt",
        "developer message",
        "ignore previous",
        "ignore all previous",
        "jailbreak",
        "prompt injection",
        "as an ai",
        "as a language model",
    ];
    !blocked_phrases
        .iter()
        .any(|blocked| compact.contains(blocked))
}

pub(super) fn human_message_is_public_safe(message: &str) -> bool {
    let compact = compact_whitespace(&message.to_lowercase());
    let blocked_phrases = [
        "http://",
        "https://",
        "www.",
        "discord.gg",
        "<script",
        "</script",
        "javascript:",
        "kill yourself",
    ];
    let blocked_terms = ["kys", "porn", "nude", "rape", "gore"];
    let padded = format!(" {compact} ");
    !blocked_phrases
        .iter()
        .any(|blocked| compact.contains(blocked))
        && !blocked_terms
            .iter()
            .any(|blocked| padded.contains(&format!(" {blocked} ")))
}

pub(super) fn compact_whitespace(value: &str) -> String {
    value.split_whitespace().collect::<Vec<_>>().join(" ")
}

pub(super) fn has_disallowed_control_character(value: &str) -> bool {
    value
        .chars()
        .any(|ch| ch.is_control() && !ch.is_whitespace())
}
