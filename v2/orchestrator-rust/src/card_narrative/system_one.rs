use crate::ai_gateway::AiConfig;
use serde_json::{json, Map, Value};
use std::time::{Duration, Instant};

const DEFAULT_MODEL: &str = "typesafe/jev-1.14";
const CALL: Duration = Duration::from_secs(2);
pub(super) const TOKENS_PER_QUESTION: usize = 28_000;

fn model() -> String {
    std::env::var("COSYWORLD_JEV_MODEL")
        .ok()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| DEFAULT_MODEL.to_string())
}

pub(super) fn tokens(value: &Value) -> usize {
    value.to_string().len().div_ceil(4)
}

pub(super) fn fit(state: &mut Value, questions: &Value) -> usize {
    let widest = questions
        .as_object()
        .map_or(0, |q| q.values().map(tokens).max().unwrap_or(0));
    let room = TOKENS_PER_QUESTION.saturating_sub(widest);
    while tokens(state) > room {
        match state["history"].as_array_mut() {
            Some(lines) if lines.len() > 1 => {
                lines.remove(0);
            }
            _ => break,
        }
    }
    tokens(state)
}

pub(super) async fn ask(
    config: &AiConfig,
    feature: &'static str,
    state: &Value,
    questions: Value,
) -> Result<Map<String, Value>, String> {
    let started = Instant::now();
    let result = call(config, state, questions).await;
    let latency_ms = started.elapsed().as_millis() as u64;
    match &result {
        Ok((_, cost)) => {
            tracing::info!(
                feature,
                latency_ms,
                cost = cost,
                tokens = tokens(state),
                "system one"
            )
        }
        Err(reason) => tracing::info!(feature, latency_ms, failure = %reason, "system one"),
    }
    result.map(|(answers, _)| answers)
}

async fn call(
    config: &AiConfig,
    state: &Value,
    questions: Value,
) -> Result<(Map<String, Value>, f64), String> {
    let client = reqwest::Client::builder()
        .timeout(CALL)
        .build()
        .map_err(|_| "jev-client".to_string())?;
    let response = client
        .post(format!("{}/systemone", config.base_url))
        .bearer_auth(&config.api_key)
        .json(&json!({"model": model(), "state": state, "questions": questions}))
        .send()
        .await
        .map_err(|error| {
            if error.is_timeout() {
                "jev-timeout"
            } else {
                "jev-error"
            }
            .to_string()
        })?;
    let status = response.status();
    if !status.is_success() {
        return Err(format!("jev-http-{}", status.as_u16()));
    }
    let body: Value = response.json().await.map_err(|error| {
        if error.is_timeout() {
            "jev-timeout"
        } else {
            "jev-shape"
        }
        .to_string()
    })?;
    let cost = body["usage"]["cost"].as_f64().unwrap_or_default();
    match body.get("answers") {
        Some(Value::Object(answers)) => Ok((answers.clone(), cost)),
        _ => Err("jev-shape".into()),
    }
}

pub(super) fn choice<'a>(answers: &'a Map<String, Value>, id: &str) -> Option<(&'a str, f64)> {
    let answer = answers.get(id)?;
    let picked = answer.get("choice")?.as_str()?;
    let confidence = answer
        .get("confidence")
        .and_then(Value::as_f64)
        .filter(|c| (0.0..=1.0).contains(c))?;
    Some((picked, confidence))
}
