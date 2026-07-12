pub(super) const MAX_HUMAN_MESSAGE_CHARS: usize = 500;
pub(super) const MAX_CALLING_STATEMENT_CHARS: usize = 96;
pub(super) const MAX_BOND_STATEMENT_CHARS: usize = 96;

pub(super) fn normalize_human_message(content: &str) -> Option<String> {
    if has_disallowed_control_character(content) {
        return None;
    }
    let normalized = compact_whitespace(content);
    if normalized.is_empty()
        || normalized.chars().count() > MAX_HUMAN_MESSAGE_CHARS
        || !human_message_is_cozy_safe(&normalized)
    {
        None
    } else {
        Some(normalized)
    }
}

pub(super) fn normalized_resident_speech_key(value: &str) -> String {
    let punctuation_folded = value
        .chars()
        .map(|character| match character {
            '\u{2018}' | '\u{2019}' | '\u{0060}' => '\'',
            '\u{201c}' | '\u{201d}' => '"',
            '\u{2013}' | '\u{2014}' => '-',
            '\u{00a0}' => ' ',
            other => other,
        })
        .collect::<String>();
    compact_whitespace(punctuation_folded.trim().trim_matches('"')).to_lowercase()
}

pub(super) fn human_message_is_cozy_safe(message: &str) -> bool {
    let compact = compact_whitespace(&message.to_lowercase());
    let blocked_phrases = [
        "http://",
        "https://",
        "www.",
        "discord.gg",
        "<script",
        "</script",
        "javascript:",
        "system prompt",
        "developer message",
        "ignore previous",
        "ignore all previous",
        "jailbreak",
        "prompt injection",
        "as an ai",
        "as a language model",
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

pub(super) fn normalize_calling_statement(statement: &str) -> Option<String> {
    normalize_safe_statement(statement, MAX_CALLING_STATEMENT_CHARS)
}

pub(super) fn normalize_bond_statement(statement: &str) -> Option<String> {
    normalize_safe_statement(statement, MAX_BOND_STATEMENT_CHARS)
}

fn normalize_safe_statement(statement: &str, max_chars: usize) -> Option<String> {
    if has_disallowed_control_character(statement) {
        return None;
    }
    let normalized = compact_whitespace(statement);
    if normalized.is_empty()
        || normalized.chars().count() > max_chars
        || !human_message_is_cozy_safe(&normalized)
        || !normalized.chars().any(|ch| ch.is_ascii_alphanumeric())
    {
        None
    } else {
        Some(normalized)
    }
}

pub(super) fn compact_whitespace(value: &str) -> String {
    value.split_whitespace().collect::<Vec<_>>().join(" ")
}

pub(super) fn has_disallowed_control_character(value: &str) -> bool {
    value
        .chars()
        .any(|ch| ch.is_control() && !ch.is_whitespace())
}
