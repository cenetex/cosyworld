use super::super::compact_whitespace;
use serde_json::Value;

const REASONING_TRACE_MAX_CHARS: usize = 2_048;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum Problem {
    MalformedJson,
    UnreadableBody,
    MissingChoice,
    MissingMessage,
    EmptyContent,
    ReasoningOnly,
    ProviderDeclined,
    ToolReply,
}

impl Problem {
    pub(super) fn label(self) -> &'static str {
        match self {
            Self::MalformedJson => "malformed_json",
            Self::UnreadableBody => "unreadable_body",
            Self::MissingChoice => "missing_choice",
            Self::MissingMessage => "missing_message",
            Self::EmptyContent => "empty_content",
            Self::ReasoningOnly => "reasoning_only",
            Self::ProviderDeclined => "provider_declined",
            Self::ToolReply => "tool_reply",
        }
    }

    pub(super) fn retryable(self) -> bool {
        matches!(
            self,
            Self::MalformedJson
                | Self::MissingChoice
                | Self::MissingMessage
                | Self::EmptyContent
                | Self::ReasoningOnly
        )
    }
}

pub(super) struct VisibleReply {
    pub(super) text: String,
    pub(super) reasoning_trace: Option<String>,
    pub(super) finish_reason: String,
}

fn populated(value: &Value) -> bool {
    match value {
        Value::Null => false,
        Value::Bool(value) => *value,
        Value::String(text) => !text.trim().is_empty(),
        Value::Array(values) => !values.is_empty(),
        Value::Object(values) => !values.is_empty(),
        Value::Number(_) => true,
    }
}

pub(super) fn visible_reply(body: &Value) -> Result<VisibleReply, Problem> {
    if !body["error"].is_null() {
        return Err(Problem::ProviderDeclined);
    }
    let choice = body["choices"]
        .get(0)
        .filter(|v| v.is_object())
        .ok_or(Problem::MissingChoice)?;
    let finish_reason = choice["finish_reason"].as_str().unwrap_or("unknown");
    let ends = [
        finish_reason,
        choice["native_finish_reason"].as_str().unwrap_or(""),
    ];
    let ended_as = |reasons: &[&str]| {
        ends.iter().any(|end| {
            reasons
                .iter()
                .any(|reason| end.eq_ignore_ascii_case(reason))
        })
    };
    let message = &choice["message"];
    if !choice["error"].is_null()
        || !message["error"].is_null()
        || populated(&message["refusal"])
        || message["content"]
            .as_array()
            .is_some_and(|parts| parts.iter().any(|part| part["type"] == "refusal"))
        || ended_as(&[
            "content_filter",
            "content_filtered",
            "safety",
            "blocklist",
            "prohibited_content",
            "spii",
            "recitation",
            "refusal",
            "blocked",
            "error",
        ])
    {
        return Err(Problem::ProviderDeclined);
    }
    if populated(&message["tool_calls"])
        || populated(&message["function_call"])
        || ended_as(&["tool_calls", "function_call"])
    {
        return Err(Problem::ToolReply);
    }
    if !message.is_object() {
        return Err(Problem::MissingMessage);
    }
    let text = readable_message_content(message).ok_or_else(|| {
        if ["reasoning", "reasoning_content", "reasoning_details"]
            .iter()
            .any(|key| populated(&message[key]))
        {
            Problem::ReasoningOnly
        } else {
            Problem::EmptyContent
        }
    })?;
    Ok(VisibleReply {
        text,
        reasoning_trace: readable_reasoning_trace(message),
        finish_reason: finish_reason.to_string(),
    })
}

fn bounded_reasoning_trace(value: &str) -> Option<String> {
    let value = compact_whitespace(value);
    if value.is_empty() || value.eq_ignore_ascii_case("[redacted]") {
        return None;
    }
    if value.chars().count() <= REASONING_TRACE_MAX_CHARS {
        return Some(value);
    }
    let mut bounded = value
        .chars()
        .take(REASONING_TRACE_MAX_CHARS.saturating_sub(1))
        .collect::<String>();
    bounded.push('…');
    Some(bounded)
}

/// Chat-completion providers normally return a string, but OpenAI-compatible
/// gateways also emit text-part arrays. Accept both without treating tool,
/// image, or opaque parts as resident speech.
pub(super) fn readable_message_content(message: &Value) -> Option<String> {
    let content = message.get("content")?;
    let text = if let Some(text) = content.as_str() {
        text.to_string()
    } else {
        content
            .as_array()?
            .iter()
            .filter_map(|part| {
                part.as_str().or_else(|| {
                    if part
                        .get("type")
                        .and_then(Value::as_str)
                        .is_some_and(|kind| !matches!(kind, "text" | "output_text"))
                    {
                        return None;
                    }
                    part.get("text")
                        .and_then(Value::as_str)
                        .or_else(|| part.get("content").and_then(Value::as_str))
                })
            })
            .collect::<Vec<_>>()
            .join("\n")
    };
    let text = text.trim();
    (!text.is_empty()).then(|| text.to_string())
}

/// Extracts only readable reasoning. Structured summaries are preferred over
/// raw text, while encrypted or redacted blocks are deliberately ignored.
pub(super) fn readable_reasoning_trace(message: &Value) -> Option<String> {
    let details = message.get("reasoning_details").and_then(Value::as_array);
    let detail_fragments = |field: &str| {
        details
            .into_iter()
            .flatten()
            .filter_map(|detail| detail.get(field).and_then(Value::as_str))
            .filter_map(bounded_reasoning_trace)
            .collect::<Vec<_>>()
    };
    let summaries = detail_fragments("summary");
    if !summaries.is_empty() {
        return bounded_reasoning_trace(&summaries.join(" "));
    }
    let texts = detail_fragments("text");
    if !texts.is_empty() {
        return bounded_reasoning_trace(&texts.join(" "));
    }
    message
        .get("reasoning")
        .or_else(|| message.get("reasoning_content"))
        .and_then(Value::as_str)
        .and_then(bounded_reasoning_trace)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn absent_visible_text_is_retryable_but_refusals_and_tools_are_terminal() {
        for (body, expected, retryable) in [
            (json!({"choices":[]}), Problem::MissingChoice, true),
            (json!({"choices":[{}]}), Problem::MissingMessage, true),
            (
                json!({"choices":[{"message":{"content":"  "}}]}),
                Problem::EmptyContent,
                true,
            ),
            (
                json!({"choices":[{"message":{"reasoning_details":[{"type":"reasoning.encrypted","data":"opaque"}]}}]}),
                Problem::ReasoningOnly,
                true,
            ),
            (
                json!({"choices":[{"message":{"content":[{"type":"refusal","refusal":"declined"}]}}]}),
                Problem::ProviderDeclined,
                false,
            ),
            (
                json!({"choices":[{"native_finish_reason":"SAFETY","message":{"content":"Some partial words"}}]}),
                Problem::ProviderDeclined,
                false,
            ),
            (
                json!({"choices":[{"finish_reason":"tool_calls","message":{"content":null}}]}),
                Problem::ToolReply,
                false,
            ),
        ] {
            let problem = visible_reply(&body).err().unwrap();
            assert_eq!(problem, expected);
            assert_eq!(problem.retryable(), retryable);
        }
    }
}
