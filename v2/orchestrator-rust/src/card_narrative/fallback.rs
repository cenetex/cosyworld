//! The voice's fallback chain (owner, 2026-11-04: characters can be any
//! model, with fallbacks). A part tries its own model, then each fallback in
//! order, inside its one scene deadline. Each attempt goes through its own
//! model's route, so it gets that provider's layout (`chat_messages`).
use super::{bounded, tier_config, VoiceSettings};
use crate::ai_gateway::{AiConfig, ConcreteModelIdentity, ModelCapability};
use std::time::Duration;

const LIST: &str = "COSYWORLD_CARD_FALLBACK_MODELS";

/// `COSYWORLD_CARD_FALLBACK_MODELS`: a JSON array of up to six exact model
/// IDs. It replaces the one-model `COSYWORLD_CARD_ESCALATION_MODEL`.
pub(super) fn models(list: Option<String>, alias: bool) -> Result<Vec<String>, String> {
    let Some(list) = list.filter(|list| !list.trim().is_empty()) else {
        return Ok(Vec::new());
    };
    if alias {
        return Err(format!("{LIST} replaces COSYWORLD_CARD_ESCALATION_MODEL"));
    }
    serde_json::from_str::<Vec<String>>(&list)
        .ok()
        .filter(|models| {
            let exact = |model: &String| bounded(model, 160) && model.trim() == model;
            models.len() <= 6 && models.iter().all(exact)
        })
        .ok_or_else(|| format!("{LIST} must be a JSON array of at most 6 exact model IDs"))
}

/// One model in a part's chain, with its registry labels for the metrics.
pub(super) struct Link {
    pub(super) config: AiConfig,
    pub(super) model: String,
    pub(super) provider: String,
    concrete: Option<ConcreteModelIdentity>,
}

impl Link {
    fn of(config: AiConfig) -> Option<Self> {
        let selected = config.pin_model(ModelCapability::WorldContent).ok()?;
        let candidate = selected.candidate();
        Some(Self {
            model: candidate.requested_model_id().to_string(),
            provider: candidate.provider().to_string(),
            concrete: candidate.concrete_model().cloned(),
            config,
        })
    }

    /// One registry ID, or two IDs that name one concrete model.
    fn same(&self, other: &Self) -> bool {
        self.model == other.model
            || matches!((&self.concrete, &other.concrete), (Some(a), Some(b)) if a == b)
    }

    fn benched(&self) -> bool {
        self.config.readiness.is_benched(&self.model)
    }
}

/// The part's own model, then each fallback that is not the same model as
/// an earlier one, leaving out benched models. With every model benched the
/// own model stays alone and fails at once, as a benched model does.
pub(super) fn chain(config: &AiConfig, own: AiConfig, fallbacks: &[String]) -> Option<Vec<Link>> {
    let mut chain = vec![Link::of(own)?];
    for model in fallbacks {
        let link = Link::of(tier_config(config, Some(model)));
        if let Some(link) = link.filter(|link| !chain.iter().any(|seen| seen.same(link))) {
            chain.push(link);
        }
    }
    if chain.iter().any(|link| !link.benched()) {
        chain.retain(|link| !link.benched());
    } else {
        chain.truncate(1);
    }
    Some(chain)
}

/// Why an attempt gave no line.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(super) enum Miss {
    /// The validator blocked the reply; the model may try again.
    Blocked,
    /// A provider error (a 5xx among them) or an empty reply.
    Failed,
}

impl Miss {
    pub(super) fn of(reason: &str) -> Self {
        match reason {
            "empty" => Self::Failed,
            _ => Self::Blocked,
        }
    }
}

/// Run a chain of `links` models inside the scene deadline. Each model's
/// share is the time that remains over the models still to try. A failure or
/// a timeout moves on at once, and blocked replies after the voice's
/// attempts. A lone model keeps every attempt, as it did before the chain.
/// `request` gets the link, the part's attempt number and its time budget.
pub(super) async fn run<T, F, Fut>(
    settings: &VoiceSettings,
    deadline: tokio::time::Instant,
    links: usize,
    mut request: F,
) -> Result<T, ()>
where
    F: FnMut(usize, u8, Duration) -> Fut,
    Fut: std::future::Future<Output = Result<T, Miss>>,
{
    let mut attempt = 0u8;
    for link in 0..links {
        let start = tokio::time::Instant::now();
        let share = deadline.saturating_duration_since(start) / (links - link) as u32;
        let until = if link + 1 == links {
            deadline
        } else {
            start + share
        };
        for _ in 0..settings.attempts.max(1) {
            let now = tokio::time::Instant::now();
            let budget = until
                .saturating_duration_since(now)
                .min(settings.call_timeout);
            if budget.is_zero() {
                break;
            }
            let result =
                tokio::time::timeout_at(now + budget, request(link, attempt, budget)).await;
            attempt = attempt.saturating_add(1);
            match result {
                Ok(Ok(spoken)) => return Ok(spoken),
                Ok(Err(Miss::Blocked)) => {}
                _ if links == 1 => {}
                _ => break,
            }
        }
    }
    Err(())
}

#[cfg(test)]
mod tests {
    use super::super::tests::{context, models_for, serve, solo_departure, stem_of, tiered_config};
    use super::super::{complete_selected, voice_metrics};
    use super::*;
    use axum::{http::StatusCode, routing::post, Json, Router};
    use serde_json::{json, Value};
    use std::sync::{Arc, Mutex};

    #[test]
    fn the_list_parses_and_replaces_the_escalation_model() {
        let list = |text: &str| models(Some(text.into()), false);
        assert_eq!(list(r#"["a","b"]"#).unwrap(), ["a", "b"]);
        assert_eq!(list(" "), Ok(Vec::new()));
        for bad in [r#""a""#, r#"[" a"]"#, r#"[""]"#, &format!("{:?}", ["a"; 7])] {
            assert!(list(bad).unwrap_err().starts_with(LIST));
        }
        assert!(models(Some("[]".into()), true).is_err());
        // The escalation model alone is a one-model chain.
        let alias = VoiceSettings::from_lookup(|name| {
            (name == "COSYWORLD_CARD_ESCALATION_MODEL").then(|| "a/b".into())
        });
        assert_eq!(alias.unwrap().fallbacks(), ["a/b"]);
    }

    #[test]
    fn the_chain_keeps_its_order_and_skips_the_speakers_own_and_benched_models() {
        let address = "127.0.0.1:9".parse().unwrap();
        let config = tiered_config(address, &[("a", false), ("b", false)]);
        let models = |own: &str| {
            let fallbacks = ["test-entity-model", "a", "b", "a", "missing"].map(String::from);
            let chain = chain(&config, tier_config(&config, Some(own)), &fallbacks).unwrap();
            chain.into_iter().map(|link| link.model).collect::<Vec<_>>()
        };
        assert_eq!(models("a"), ["a", "test-entity-model", "b"]);
        let bench = |model: &str| {
            while !config.readiness.is_benched(model) {
                config.readiness.record_voice_outcome(model, false);
            }
        };
        bench("b");
        assert_eq!(models("a"), ["a", "test-entity-model"]);
        assert_eq!(models("b"), ["test-entity-model", "a"]);
        bench("a");
        bench("test-entity-model");
        assert_eq!(models("b"), ["b"]);
    }

    #[tokio::test(start_paused = true)]
    async fn each_failure_moves_on_and_blocked_replies_move_on_after_the_attempts() {
        let settings = VoiceSettings::hosted();
        let deadline = tokio::time::Instant::now() + settings.scene_timeout;
        let mut seen = Vec::new();
        let result = run(&settings, deadline, 4, |link, attempt, _| {
            seen.push((link, attempt));
            async move {
                match link {
                    0 => Err(Miss::Failed),
                    1 => std::future::pending().await,
                    2 => Err(Miss::Blocked),
                    _ => Ok(link),
                }
            }
        })
        .await;
        assert_eq!(result, Ok(3));
        assert_eq!(seen, [(0, 0), (1, 1), (2, 2), (2, 3), (3, 4)]);
    }

    /// Pip's line walks the chain: an empty reply, a 5xx, a reply blocked
    /// twice, then a line. Each attempt has its own provider's layout, and the
    /// line and the metrics name the model that spoke.
    #[tokio::test]
    async fn a_failing_line_walks_the_chain_in_each_models_own_layout() {
        let seen = Arc::new(Mutex::new(Vec::<Value>::new()));
        let log = seen.clone();
        let provider = post(move |Json(body): Json<Value>| async move {
            log.lock().unwrap().push(body.clone());
            let text = match body["model"].as_str().unwrap() {
                _ if stem_of(&body) != "Pip:" => "The clock stopped again, Pip.",
                "test-entity-model" => "",
                "mistralai/m" => return (StatusCode::BAD_GATEWAY, Json(json!({}))),
                "anthropic/c" => "As an AI, I can explain the clock.",
                _ => "I remember the kindness beside the lamp.",
            };
            let choice = json!({"message": {"content": text}, "finish_reason": "stop"});
            let reply = json!({"model": body["model"], "choices": [choice]});
            (StatusCode::OK, Json(reply))
        });
        let (address, server) = serve(Router::new().route("/chat/completions", provider)).await;
        let chain = ["mistralai/m", "anthropic/c", "openai/d"];
        let config = tiered_config(address, &chain.map(|model| (model, false)));
        let settings = VoiceSettings {
            fallback_models: chain.map(String::from).to_vec(),
            ..VoiceSettings::hosted()
        };
        // Vale talks to Pip, who answers the line Vale says this turn.
        let mut c = context();
        (c.scenery, c.focus) = (false, None);
        let mut outcome = solo_departure();
        outcome.avatars[1].travel = None;
        outcome.avatars[1].location = "station".into();
        for item in &mut outcome.items {
            if item.holder == "moth" {
                item.location = "station".into();
            }
        }
        outcome.card.kind = "talk".into();
        outcome.card.target = Some("moth".into());
        c.outcome = Some(outcome);
        let ids = ["vale".to_string(), "moth".into()];
        let none = Default::default();
        let result = complete_selected(&config, &c, &none, &settings, &ids, false, None);
        let result = result.await.unwrap();
        assert_eq!(result["entries"][1]["model"], "openai/d");
        let requests = seen.lock().unwrap();
        let tried = "test-entity-model mistralai/m anthropic/c anthropic/c openai/d";
        assert_eq!(models_for(&requests, "Pip:").join(" "), tried);
        for body in requests.iter().filter(|body| stem_of(body) == "Pip:") {
            let last = body["messages"].as_array().unwrap().last().unwrap();
            // Only Mistral continues an opening quote; Claude gets none.
            let quoted = body["model"] == "mistralai/m";
            assert_eq!(last["prefix"] == true, quoted, "{}", body["model"]);
            assert_eq!(last["role"] == "assistant", quoted, "{}", body["model"]);
        }
        let metrics = voice_metrics::snapshot();
        assert!(metrics["by_model"]["openai/d"]["fallbacks"].as_u64() >= Some(1));
        server.abort();
    }
}
