//! Decision-model client (OpenRouter Decisions API) and its pack opt-in.
//!
//! A decision model answers typed questions with probabilities instead of
//! prose. It fits the places where the engine only needs a judgment: whether a
//! resident speaks now, and whether a candidate line repeats an idea the room
//! already heard. Probabilities steer a seeded draw, so a world stays lively
//! without a language model deciding every beat.
//!
//! Authority is unchanged. A decision proposes; the publication gate, the
//! kernel, and the journal still decide what happens. Every call fails open to
//! the existing path: a missing model, a transport error, or an unreadable
//! answer returns `None` and the caller keeps its previous behaviour.

use crate::{
    ai_gateway::{post_bounded_exact_json, AiConfig, AiGatewayError},
    content_load::{SeedContent, SeedWorldpackPack},
};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::{collections::BTreeMap, time::Duration};
use tokio::time::Instant;

pub(crate) const DECISION_MODEL_ENV: &str = "COSYWORLD_AI_DECISION_MODEL";
pub(crate) const DECISIONS_EXTENSION: &str = "x-cosyworld-decisions";
const DECISIONS_ENDPOINT: &str = "alpha/decisions";
const DECISIONS_MAX_RESPONSE_BYTES: usize = 64 * 1024;
/// Jev reads at most 32k tokens of state; stay well inside that.
const DECISIONS_MAX_STATE_BYTES: usize = 24 * 1024;
const DECISIONS_TIMEOUT: Duration = Duration::from_secs(4);
const DEFAULT_REPEAT_THRESHOLD: f64 = 0.8;

/// The operator-declared decision model, or `None` when decisions are off.
pub(crate) fn configured_model() -> Option<String> {
    std::env::var(DECISION_MODEL_ENV)
        .ok()
        .map(|model| model.trim().to_string())
        .filter(|model| {
            !model.is_empty() && model.len() <= 128 && !model.chars().any(char::is_control)
        })
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub(crate) struct DecisionPolicy {
    /// Decide whether a resident speaks with a decision model.
    pub(crate) chat_floor: bool,
    /// Probability above which a candidate line counts as a repeat, when the
    /// repeat judge is on.
    pub(crate) repeat_threshold: Option<f64>,
}

pub(crate) fn parse_decision_policy(
    pack: &SeedWorldpackPack,
) -> Result<Option<DecisionPolicy>, String> {
    let Some(config) = pack.extensions.get(DECISIONS_EXTENSION) else {
        return Ok(None);
    };
    let invalid =
        |detail: &str| format!("pack {} has an invalid decisions policy: {detail}", pack.id);
    let config = config.as_object().ok_or_else(|| invalid("not an object"))?;
    for key in config.keys() {
        if !matches!(
            key.as_str(),
            "schema_version" | "chat_floor" | "repeat_judge" | "repeat_threshold"
        ) {
            return Err(invalid(&format!("unknown field {key}")));
        }
    }
    if config.get("schema_version").and_then(Value::as_u64) != Some(1) {
        return Err(invalid("schema_version must be 1"));
    }
    let flag = |name: &str| -> Result<bool, String> {
        match config.get(name) {
            None => Ok(false),
            Some(value) => value
                .as_bool()
                .ok_or_else(|| invalid(&format!("{name} must be a boolean"))),
        }
    };
    let chat_floor = flag("chat_floor")?;
    let repeat_judge = flag("repeat_judge")?;
    let threshold = match config.get("repeat_threshold") {
        None => DEFAULT_REPEAT_THRESHOLD,
        Some(value) => value
            .as_f64()
            .filter(|value| value.is_finite() && (0.5..=0.99).contains(value))
            .ok_or_else(|| invalid("repeat_threshold must be between 0.5 and 0.99"))?,
    };
    Ok(Some(DecisionPolicy {
        chat_floor,
        repeat_threshold: repeat_judge.then_some(threshold),
    }))
}

fn policy_in(content: &SeedContent) -> Option<DecisionPolicy> {
    content
        .manifest
        .packs
        .iter()
        .find_map(|pack| parse_decision_policy(pack).ok().flatten())
}

/// The decision policy of the active world, only when an operator model is set.
pub(crate) fn active_policy() -> Option<(DecisionPolicy, String)> {
    let model = configured_model()?;
    let policy = policy_in(crate::content_registry::active_content())?;
    Some((policy, model))
}

#[allow(dead_code)] // Choice backs resident intent next; Noul serves the chat floor and repeat judge
#[derive(Clone, Debug, PartialEq)]
pub(crate) enum DecisionQuestion {
    /// A yes/no question; the answer is the probability of yes.
    Noul {
        instructions: String,
        yes: String,
        no: String,
    },
    /// A closed choice; the answer carries a probability per option.
    Choice {
        instructions: String,
        options: Vec<(String, String)>,
    },
}

impl DecisionQuestion {
    fn to_json(&self) -> Value {
        match self {
            Self::Noul {
                instructions,
                yes,
                no,
            } => json!({
                "type": "noul",
                "instructions": instructions,
                "criteria": { "true": yes, "false": no },
            }),
            Self::Choice {
                instructions,
                options,
            } => json!({
                "type": "choice",
                "instructions": instructions,
                "criteria": options
                    .iter()
                    .map(|(key, meaning)| (key.clone(), Value::String(meaning.clone())))
                    .collect::<serde_json::Map<_, _>>(),
            }),
        }
    }
}

#[allow(dead_code)]
#[derive(Clone, Debug, PartialEq)]
pub(crate) enum DecisionAnswer {
    Noul(f64),
    Choice {
        choice: String,
        probabilities: BTreeMap<String, f64>,
    },
}

#[allow(dead_code)]
#[derive(Clone, Debug)]
pub(crate) struct DecisionResult {
    pub(crate) answers: BTreeMap<String, DecisionAnswer>,
    pub(crate) resolved_model: String,
    pub(crate) input_tokens: u64,
    pub(crate) cost_usd: Option<f64>,
    pub(crate) latency: Duration,
}

/// Ask a decision model typed questions about a state. Every question must be
/// answered, in its own type, or the whole call is an invalid response.
pub(crate) async fn request_decisions(
    config: &AiConfig,
    model: &str,
    feature: &str,
    state: &Value,
    questions: &BTreeMap<String, DecisionQuestion>,
) -> Result<DecisionResult, AiGatewayError> {
    let started_at = Instant::now();
    let state_bytes = serde_json::to_vec(state)
        .map(|bytes| bytes.len())
        .unwrap_or(usize::MAX);
    if questions.is_empty() || state_bytes > DECISIONS_MAX_STATE_BYTES {
        return Err(AiGatewayError::invalid_response(feature));
    }
    let payload = json!({
        "model": model,
        "state": state,
        "questions": questions
            .iter()
            .map(|(id, question)| (id.clone(), question.to_json()))
            .collect::<serde_json::Map<_, _>>(),
    });
    let (body, _attempt) = post_bounded_exact_json(
        config,
        feature,
        DECISIONS_ENDPOINT,
        "http://127.0.0.1:3102",
        &payload,
        DECISIONS_TIMEOUT,
        2,
        DECISIONS_MAX_RESPONSE_BYTES,
        &started_at,
    )
    .await?;
    parse_decisions(feature, &body, questions, started_at.elapsed())
}

fn parse_decisions(
    feature: &str,
    body: &Value,
    questions: &BTreeMap<String, DecisionQuestion>,
    latency: Duration,
) -> Result<DecisionResult, AiGatewayError> {
    let bad = || AiGatewayError::invalid_response(feature);
    let answers = body
        .get("answers")
        .and_then(Value::as_object)
        .ok_or_else(bad)?;
    let mut parsed = BTreeMap::new();
    for (id, question) in questions {
        let answer = answers.get(id).ok_or_else(bad)?;
        let parsed_answer = match question {
            DecisionQuestion::Noul { .. } => {
                let probability = answer
                    .get("noul")
                    .and_then(Value::as_f64)
                    .filter(|value| value.is_finite() && (0.0..=1.0).contains(value))
                    .ok_or_else(bad)?;
                DecisionAnswer::Noul(probability)
            }
            DecisionQuestion::Choice { options, .. } => {
                let choice = answer
                    .get("choice")
                    .and_then(Value::as_str)
                    .filter(|choice| options.iter().any(|(key, _)| key == choice))
                    .ok_or_else(bad)?
                    .to_string();
                let mut probabilities = BTreeMap::new();
                if let Some(map) = answer.get("probabilities").and_then(Value::as_object) {
                    for (key, value) in map {
                        let value = value
                            .as_f64()
                            .filter(|value| value.is_finite() && (0.0..=1.0).contains(value))
                            .ok_or_else(bad)?;
                        if options.iter().any(|(option, _)| option == key) {
                            probabilities.insert(key.clone(), value);
                        }
                    }
                }
                DecisionAnswer::Choice {
                    choice,
                    probabilities,
                }
            }
        };
        parsed.insert(id.clone(), parsed_answer);
    }
    let usage = body.get("usage");
    Ok(DecisionResult {
        answers: parsed,
        resolved_model: body
            .get("model")
            .and_then(Value::as_str)
            .unwrap_or_default()
            .to_string(),
        input_tokens: usage
            .and_then(|usage| usage.get("input_tokens"))
            .and_then(Value::as_u64)
            .unwrap_or_default(),
        cost_usd: usage
            .and_then(|usage| usage.get("cost"))
            .and_then(Value::as_f64),
        latency,
    })
}

/// A stable draw in `[0, 1)` from a seed, so the same beat always draws the
/// same number. The probabilities may vary from call to call; the draw does not.
pub(crate) fn unit_draw(seed: &str) -> f64 {
    let digest = Sha256::digest(seed.as_bytes());
    let value = u64::from_be_bytes(digest[..8].try_into().expect("eight bytes"));
    (value >> 11) as f64 / (1u64 << 53) as f64
}

/// Whether a yes/no probability wins its seeded draw.
pub(crate) fn noul_draw(probability: f64, seed: &str) -> bool {
    unit_draw(seed) < probability.clamp(0.0, 1.0)
}

/// Sample one option by its probabilities. The provider's own choice is the
/// fallback when it sent no usable probabilities.
#[allow(dead_code)] // used by the resident-intent decision, which builds on this client
pub(crate) fn sample_choice(
    choice: &str,
    probabilities: &BTreeMap<String, f64>,
    seed: &str,
) -> String {
    let total: f64 = probabilities.values().sum();
    if total <= 0.0 {
        return choice.to_string();
    }
    let mut point = unit_draw(seed) * total;
    for (key, probability) in probabilities {
        if point < *probability {
            return key.clone();
        }
        point -= probability;
    }
    choice.to_string()
}

#[allow(clippy::too_many_arguments)]
/// Whether a resident with a decision model speaks now. `None` means decisions
/// are off for this world or the call failed, and the caller falls back.
pub(crate) async fn chat_floor_decision(
    config: &AiConfig,
    speaker_actor_id: u64,
    speaker_name: &str,
    speaker_persona: &str,
    round: u8,
    others: &[String],
    recent_lines: &[(u64, String)],
    last_line_seq: u64,
) -> Option<bool> {
    let (policy, model) = active_policy()?;
    if !policy.chat_floor {
        return None;
    }
    let state = json!({
        "speaker": { "name": speaker_name, "persona": speaker_persona },
        "others_present": others,
        "round": round,
        "recent_lines": recent_lines
            .iter()
            .map(|(_, line)| line.as_str())
            .collect::<Vec<_>>(),
    });
    let questions = BTreeMap::from([(
        "speak".to_string(),
        DecisionQuestion::Noul {
            instructions: format!(
                "Decide whether {speaker_name} wants to say something right now. They speak \
                 when the last line was aimed at them, when they have a take nobody has voiced, \
                 or when their persona would jump in. They stay quiet when they just spoke, when \
                 the exchange is repeating itself, or when nothing new can be added."
            ),
            yes: format!("{speaker_name} speaks now."),
            no: format!("{speaker_name} lets the moment pass."),
        },
    )]);
    let result =
        match request_decisions(config, &model, "chat_floor_decision", &state, &questions).await {
            Ok(result) => result,
            Err(error) => {
                tracing::warn!(
                    code = error.code(),
                    "decision model unavailable for the chat floor; using the language model"
                );
                return None;
            }
        };
    let DecisionAnswer::Noul(probability) = result.answers.get("speak")? else {
        return None;
    };
    let seed = format!(
        "{}\0floor\0{speaker_actor_id}\0{round}\0{last_line_seq}",
        crate::content_registry::active_content().manifest.id
    );
    tracing::info!(
        speaker_actor_id,
        probability,
        latency_ms = result.latency.as_millis() as u64,
        model = %result.resolved_model,
        "chat floor decided by a decision model"
    );
    Some(noul_draw(*probability, &seed))
}

/// Whether a candidate line repeats an idea the room already heard, even when
/// it is reworded. `None` means the judge is off or failed, so the line is
/// judged by the deterministic gate alone.
pub(crate) async fn candidate_repeats_room(
    config: &AiConfig,
    speaker_name: &str,
    candidate: &str,
    recent_lines: &[String],
) -> Option<bool> {
    let (policy, model) = active_policy()?;
    let threshold = policy.repeat_threshold?;
    if recent_lines.is_empty() {
        return Some(false);
    }
    let state = json!({
        "speaker": speaker_name,
        "recent_lines": recent_lines.iter().rev().take(8).rev().collect::<Vec<_>>(),
        "candidate_line": candidate,
    });
    let questions = BTreeMap::from([(
        "repeat".to_string(),
        DecisionQuestion::Noul {
            instructions: "Does the candidate line repeat an idea, image, or turn of phrase \
                           already present in the recent lines, even when reworded? A reply that \
                           answers the last line with something new is not a repeat."
                .to_string(),
            yes: "The candidate repeats what the room already said.".to_string(),
            no: "The candidate adds something new.".to_string(),
        },
    )]);
    match request_decisions(config, &model, "repeat_judge", &state, &questions).await {
        Ok(result) => match result.answers.get("repeat") {
            Some(DecisionAnswer::Noul(probability)) => Some(*probability >= threshold),
            _ => None,
        },
        Err(error) => {
            tracing::warn!(
                code = error.code(),
                "decision model unavailable for the repeat judge; the gate decides alone"
            );
            None
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::ai_gateway::DataPolicyMode;
    use axum::{routing::post, Json, Router};
    use std::sync::{Arc, Mutex};
    use tokio::net::TcpListener;

    fn pack_with(extension: Value) -> SeedWorldpackPack {
        let mut pack: SeedWorldpackPack = serde_json::from_value(json!({
            "id": "test.pack", "name": "t", "version": "1.0.0", "kind": "content",
            "license": "MIT", "license_url": "https://example.test",
            "integrity": "sha256:0",
            "provenance": {"author": "t", "source_name": "t", "source_url": "https://example.test"}
        }))
        .expect("test pack parses");
        pack.extensions = json!({ DECISIONS_EXTENSION: extension });
        pack
    }

    #[test]
    fn parses_a_valid_policy_and_rejects_malformed_ones() {
        let policy = parse_decision_policy(&pack_with(json!({
            "schema_version": 1, "chat_floor": true, "repeat_judge": true, "repeat_threshold": 0.7
        })))
        .unwrap()
        .unwrap();
        assert!(policy.chat_floor);
        assert_eq!(policy.repeat_threshold, Some(0.7));
        let off = parse_decision_policy(&pack_with(json!({"schema_version": 1})))
            .unwrap()
            .unwrap();
        assert!(!off.chat_floor && off.repeat_threshold.is_none());
        for bad in [
            json!({"schema_version": 2}),
            json!({"schema_version": 1, "chat_floor": "yes"}),
            json!({"schema_version": 1, "repeat_threshold": 0.1}),
            json!({"schema_version": 1, "model": "x/y"}),
            json!("on"),
        ] {
            assert!(
                parse_decision_policy(&pack_with(bad.clone())).is_err(),
                "{bad}"
            );
        }
    }

    #[test]
    fn the_draw_is_stable_uniform_and_follows_the_probability() {
        assert_eq!(unit_draw("a"), unit_draw("a"));
        assert_ne!(unit_draw("a"), unit_draw("b"));
        let wins = (0..2000)
            .filter(|index| noul_draw(0.25, &format!("seed-{index}")))
            .count();
        assert!((400..600).contains(&wins), "{wins} of 2000 at p=0.25");
        assert!(!noul_draw(0.0, "any"));
        assert!(noul_draw(1.0, "any"));
    }

    #[test]
    fn sampling_follows_probabilities_and_falls_back_to_the_provider_choice() {
        let probabilities = BTreeMap::from([("a".to_string(), 0.8), ("b".to_string(), 0.2)]);
        let b_wins = (0..2000)
            .filter(|index| sample_choice("a", &probabilities, &format!("s{index}")) == "b")
            .count();
        assert!((250..550).contains(&b_wins), "{b_wins} of 2000 at p=0.2");
        assert_eq!(sample_choice("a", &BTreeMap::new(), "s"), "a");
    }

    #[test]
    fn alpha_endpoints_sit_beside_the_versioned_api_root() {
        use crate::ai_gateway::exact_endpoint_url as url;
        assert_eq!(
            url("https://openrouter.ai/api/v1", "alpha/decisions"),
            "https://openrouter.ai/api/alpha/decisions"
        );
        assert_eq!(
            url("http://127.0.0.1:9", "alpha/decisions"),
            "http://127.0.0.1:9/alpha/decisions"
        );
        assert_eq!(
            url("https://openrouter.ai/api/v1", "rerank"),
            "https://openrouter.ai/api/v1/rerank"
        );
    }

    async fn serve(
        answer: Value,
    ) -> (
        String,
        Arc<Mutex<Option<Value>>>,
        tokio::task::JoinHandle<()>,
    ) {
        let captured = Arc::new(Mutex::new(None::<Value>));
        let seen = Arc::clone(&captured);
        let app = Router::new().route(
            "/alpha/decisions",
            post(move |Json(body): Json<Value>| {
                let seen = Arc::clone(&seen);
                let answer = answer.clone();
                async move {
                    *seen.lock().expect("capture") = Some(body);
                    Json(answer)
                }
            }),
        );
        let listener = TcpListener::bind("127.0.0.1:0").await.expect("bind");
        let address = listener.local_addr().expect("address");
        let server = tokio::spawn(async move {
            let _ = axum::serve(listener, app).await;
        });
        (format!("http://{address}"), captured, server)
    }

    fn config_for(base_url: String) -> AiConfig {
        AiConfig {
            api_key: "test".to_string(),
            base_url,
            data_policy_mode: DataPolicyMode::Development,
            ..AiConfig::default()
        }
    }

    #[tokio::test]
    async fn a_noul_and_a_choice_round_trip_and_are_validated() {
        let (base, captured, server) = serve(json!({
            "id": "gen-dec-1",
            "model": "typesafe/jev-1.13-20260917",
            "answers": {
                "speak": { "type": "noul", "noul": 0.62 },
                "go": { "type": "choice", "choice": "garden",
                        "probabilities": { "garden": 0.7, "tank": 0.3, "ghost": 0.1 } }
            },
            "usage": { "input_tokens": 476, "output_tokens": 70, "cost": 0.00002 }
        }))
        .await;
        let questions = BTreeMap::from([
            (
                "speak".to_string(),
                DecisionQuestion::Noul {
                    instructions: "Speak?".to_string(),
                    yes: "yes".to_string(),
                    no: "no".to_string(),
                },
            ),
            (
                "go".to_string(),
                DecisionQuestion::Choice {
                    instructions: "Where?".to_string(),
                    options: vec![
                        ("garden".to_string(), "Stay.".to_string()),
                        ("tank".to_string(), "Go to the tank.".to_string()),
                    ],
                },
            ),
        ]);
        let result = request_decisions(
            &config_for(base),
            "typesafe/jev-1.13",
            "decision_test",
            &json!({"who": "Tapi"}),
            &questions,
        )
        .await
        .expect("decisions");
        let body = captured.lock().unwrap().clone().expect("request captured");
        assert_eq!(body["model"], "typesafe/jev-1.13");
        assert_eq!(body["state"]["who"], "Tapi");
        assert_eq!(body["questions"]["speak"]["type"], "noul");
        assert_eq!(body["questions"]["speak"]["criteria"]["true"], "yes");
        assert_eq!(body["questions"]["go"]["type"], "choice");
        assert_eq!(
            body["questions"]["go"]["criteria"]["tank"],
            "Go to the tank."
        );
        assert_eq!(result.answers["speak"], DecisionAnswer::Noul(0.62));
        match &result.answers["go"] {
            DecisionAnswer::Choice {
                choice,
                probabilities,
            } => {
                assert_eq!(choice, "garden");
                // An option the question never offered is dropped.
                assert_eq!(probabilities.len(), 2);
            }
            other => panic!("unexpected {other:?}"),
        }
        assert_eq!(result.input_tokens, 476);
        assert_eq!(result.resolved_model, "typesafe/jev-1.13-20260917");
        server.abort();
    }

    #[tokio::test]
    async fn out_of_range_missing_and_unknown_answers_are_invalid() {
        for answer in [
            json!({"answers": {"speak": {"type": "noul", "noul": 1.4}}}),
            json!({"answers": {}}),
            json!({"answers": {"speak": {"type": "choice", "choice": "x"}}}),
            json!({"nothing": true}),
        ] {
            let (base, _captured, server) = serve(answer.clone()).await;
            let questions = BTreeMap::from([(
                "speak".to_string(),
                DecisionQuestion::Noul {
                    instructions: "Speak?".to_string(),
                    yes: "yes".to_string(),
                    no: "no".to_string(),
                },
            )]);
            let result = request_decisions(
                &config_for(base),
                "typesafe/jev-1.13",
                "decision_test",
                &json!({}),
                &questions,
            )
            .await;
            assert!(result.is_err(), "{answer}");
            server.abort();
        }
    }
}
