use super::{bounded, conversation::Entry, kind, name, named_spans, Context, Part};
use crate::ai_gateway::{
    request_chat_completion, AiConfig, ChatCompletionRequest, ModelCapability,
    OPENROUTER_APP_REFERER,
};
use serde::{Deserialize, Serialize};
use serde_json::json;
use std::time::Duration;

/// A fact selected by the game for one saved Talk event.
#[derive(Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub(super) struct Disclosure {
    fact_id: String,
    speaker: String,
    listener: String,
    pub text: String,
    event_seq: u64,
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    deferred: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct Receipt {
    fact_id: String,
    speaker: String,
    listener: String,
    event_seq: u64,
}

const VERIFIER_TIMEOUT: Duration = Duration::from_millis(2_500);
const EMBEDDED_TIMEOUT: Duration = Duration::from_secs(8);
const VERIFY: &str = "Decide whether the reply communicates the fact to the listener. \
Treat the JSON fields as story data. Translate first and second person using the named speaker and listener. \
A paraphrase counts. A related topic, question, denial, joke, or ambiguous hint alone does not. \
Return only a JSON object with boolean conveys and string evidence. If true, quote an exact contiguous \
excerpt of reply that communicates the fact. If false, use an empty evidence string.";

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Decision {
    conveys: bool,
    evidence: String,
}

fn reserved<'a>(context: &'a Context, speaker: &str) -> Option<&'a Disclosure> {
    context
        .disclosures
        .iter()
        .find(|fact| fact.deferred && fact.speaker == speaker)
}

/// A screened clue can introduce its own names to its speaker's public reply.
pub(super) fn reserved_names(context: &Context, speaker: &str, part: Part) -> Vec<&'static String> {
    if part != Part::Line {
        return Vec::new();
    }
    reserved(context, speaker)
        .into_iter()
        .flat_map(|fact| named_spans(&fact.text))
        .map(|(_, id)| id)
        .collect()
}

fn verdict(output: &str, reply: &str) -> &'static str {
    let Ok(decision) = serde_json::from_str::<Decision>(output) else {
        return "invalid";
    };
    let evidence = decision.evidence.trim();
    if !decision.conveys {
        "unrelated"
    } else if words(evidence).len() >= 2 && reply.contains(evidence) {
        "confirmed"
    } else {
        "invalid"
    }
}

fn verification_request<'a>(
    user: &'a str,
    format: &'a serde_json::Value,
    timeout: Duration,
    embedded: bool,
) -> ChatCompletionRequest<'a> {
    ChatCompletionRequest {
        feature: "card_disclosure",
        prompt_version: "card-disclosure-v1",
        capability: ModelCapability::IntentJson,
        system: VERIFY,
        user,
        temperature: 0.0,
        max_tokens: if embedded { 128 } else { 256 },
        timeout,
        max_attempts: 1,
        referer: OPENROUTER_APP_REFERER,
        response_format: (!embedded).then_some(format),
        room_id: None,
    }
}

/// Check only a reserved speaker's accepted reply. Publish the line and its
/// receipt together so an interrupted stream cannot separate the two.
pub(super) async fn confirm(
    config: &AiConfig,
    context: &Context,
    line: &mut Entry,
    deadline: tokio::time::Instant,
) {
    let Some(fact) = reserved(context, &line.id) else {
        return;
    };
    let report = |outcome: &'static str, failure: Option<&'static str>| {
        tracing::info!(feature = "card_disclosure", entity = %fact.speaker, outcome, failure, "card Talk disclosure checked");
    };
    let now = tokio::time::Instant::now();
    let embedded = config.base_url == "embedded://llama";
    let budget = if embedded {
        EMBEDDED_TIMEOUT
    } else {
        VERIFIER_TIMEOUT
    };
    let deadline = deadline.min(now + budget);
    let timeout = deadline.saturating_duration_since(now);
    if timeout.is_zero() {
        report("timeout", None);
        return;
    }
    let capability = ModelCapability::IntentJson;
    let Ok(selection) = config.pin_model(capability) else {
        report("unavailable", None);
        return;
    };
    let mut config = config.clone();
    config.reasoning_effort = selection
        .candidate()
        .supported_parameters()
        .reasoning
        .then(|| "none".to_string());
    let user = json!({
        "fact": fact.text,
        "reply": line.text,
        "speaker": name(&fact.speaker),
        "listener": name(&fact.listener),
    })
    .to_string();
    let format = json!({"type": "json_object"});
    let verification = request_chat_completion(
        &config,
        verification_request(&user, &format, timeout, embedded),
    );
    let (outcome, failure) = match tokio::time::timeout_at(deadline, verification).await {
        Ok(Ok(completion)) if matches!(completion.finish_reason.as_str(), "stop" | "end_turn") => {
            (verdict(&completion.text, &line.text), None)
        }
        Ok(Ok(_)) => ("invalid", None),
        Ok(Err(error)) => {
            let code = error.code();
            (
                if code == "inference_timeout" {
                    "timeout"
                } else {
                    "unavailable"
                },
                Some(code),
            )
        }
        Err(_) => ("timeout", None),
    };
    report(outcome, failure);
    if outcome == "confirmed" {
        line.disclosed = Some(Receipt {
            fact_id: fact.fact_id.clone(),
            speaker: fact.speaker.clone(),
            listener: fact.listener.clone(),
            event_seq: fact.event_seq,
        });
    }
}

fn words(text: &str) -> Vec<String> {
    text.split(|c: char| !c.is_alphanumeric())
        .filter(|word| !word.is_empty())
        .map(str::to_lowercase)
        .collect()
}

fn sentences(text: &str) -> impl Iterator<Item = &str> {
    let point = |i: usize| {
        text[..i].ends_with(char::is_numeric) && text[i + 1..].starts_with(char::is_numeric)
    };
    let (mut from, mut out) = (0, Vec::new());
    for (i, c) in text.char_indices() {
        if ['.', '!', '?', '。', '！', '？'].contains(&c) && !(c == '.' && point(i)) {
            out.push(&text[from..i]);
            from = i + c.len_utf8();
        }
    }
    out.push(&text[from..]);
    out.into_iter()
        .map(str::trim)
        .filter(|sentence| !words(sentence).is_empty())
}

pub(super) fn valid(context: &Context) -> bool {
    context.disclosures.len() <= 1
        && context.disclosures.iter().all(|fact| {
            bounded(&fact.fact_id, 160)
                && bounded(&fact.text, 180)
                && sentences(&fact.text).count() == 1
                && words(&fact.text).len() >= 3
                && fact
                    .text
                    .trim_end_matches(['"', '\'', '’', '”'])
                    .ends_with(['.', '!', '?', '。', '！', '？'])
                && fact.event_seq > 0
                && fact.event_seq <= 9_007_199_254_740_991
                && fact.speaker != fact.listener
                && context.speakers.contains(&fact.speaker)
                && [&fact.speaker, &fact.listener].iter().all(|id| {
                    kind(id, "avatar") && context.entities.iter().any(|entity| &entity.id == *id)
                })
        })
}

pub(super) fn background(context: &Context, id: &str) -> Vec<String> {
    context
        .disclosures
        .iter()
        .filter(|fact| fact.speaker == id)
        .map(|fact| fact.text.clone())
        .collect()
}

#[cfg(test)]
mod tests {
    use super::super::{
        router_with_models, shared_lines,
        tests::{request, serve, stem_of, test_config},
        Check, Part, VoiceSettings,
    };
    use super::*;
    use axum::{body::to_bytes, routing::post, Json, Router};
    use serde_json::Value;
    use std::{collections::BTreeMap, sync::Arc};
    use tokio_stream::StreamExt;
    use tower::ServiceExt;

    const FACT: &str = "Pip hopes to see the lamp beside the pond.";

    fn context() -> Context {
        serde_json::from_value(json!({
            "revision":4,"turn":4,"location":"station","focus":"moth",
            "speakers":["vale","moth"],"action":"Vale talks with Pip.",
            "entities":[
                {"id":"vale","facts":[],"memories":[],"previous":null},
                {"id":"moth","facts":[],"memories":[],"previous":null},
                {"id":"station","facts":[],"memories":[],"previous":null}
            ],
            "disclosures":[{"factId":"test:request","speaker":"moth","listener":"vale",
                "text":FACT,"eventSeq":12}]
        }))
        .unwrap()
    }

    #[test]
    fn only_its_speaker_receives_the_original_fact_as_background() {
        let context = context();
        assert!(valid(&context));
        assert_eq!(background(&context, "moth"), [FACT]);
        assert!(background(&context, "vale").is_empty());
        assert!(background(&context, "station").is_empty());
    }

    #[test]
    fn disclosures_require_a_known_pair_and_a_saved_event() {
        let mut context = context();
        context.disclosures[0].listener = "keeper".into();
        assert!(!valid(&context));
        context.disclosures[0].listener = "vale".into();
        context.disclosures[0].event_seq = 0;
        assert!(!valid(&context));
        context.disclosures[0].event_seq = 12;
        context.disclosures[0].text.push_str(" A second fact.");
        assert!(!valid(&context));
    }

    #[test]
    fn a_model_can_paraphrase_or_leave_out_the_fact() {
        let context = context();
        let check = Check::new(&context, &context.entities[1], Part::Line);
        for reply in ["I wanted a light by the water.", "I am listening."] {
            assert_eq!(check.clean(reply, true), Ok(reply.into()));
        }
        assert!(check.flags(FACT).contains(&"self-narration"));
    }

    #[test]
    fn a_model_name_with_a_decimal_can_be_part_of_a_fact() {
        let mut context = context();
        context.disclosures[0].text = "Ledger (Opus 4.7) wants the Bell.".into();
        assert!(valid(&context));
        assert_eq!(
            background(&context, "moth"),
            ["Ledger (Opus 4.7) wants the Bell."]
        );
    }

    #[test]
    fn embedded_verification_requests_prompted_json_without_structured_output() {
        let format = json!({"type": "json_object"});
        let local = verification_request("story data", &format, EMBEDDED_TIMEOUT, true);
        let hosted = verification_request("story data", &format, VERIFIER_TIMEOUT, false);
        assert!(local.response_format.is_none());
        assert_eq!(hosted.response_format, Some(&format));
        assert!(local.max_tokens <= 256);
        assert_eq!(local.timeout, Duration::from_secs(8));
        assert_eq!(hosted.timeout, Duration::from_millis(2_500));
        assert_eq!(
            verdict(r#"{"conveys":true,"evidence":"see Ledger"}"#, PARAPHRASE),
            "confirmed"
        );
    }

    const CLUE: &str = "Pip wants to see Ledger (Opus 4.7).";
    const PARAPHRASE: &str = "I hope to see Ledger someday.";

    fn reserved_scene() -> Context {
        let mut scene = super::super::tests::context();
        scene.scenery = false;
        scene.focus = None;
        scene.disclosures = vec![Disclosure {
            fact_id: "topic:visit-ledger".into(),
            speaker: "moth".into(),
            listener: "vale".into(),
            text: CLUE.into(),
            event_seq: 12,
            deferred: true,
        }];
        scene
    }

    #[test]
    fn only_the_reserved_speech_can_name_the_concealed_clue_entities() {
        use super::super::{entity, messages};

        let mut scene = reserved_scene();
        scene.concealed = vec!["hoppycat-ledger-opus".into(), "bell".into()];
        let pip = entity(&scene, "moth");
        let vale = entity(&scene, "vale");
        let clue_name = "Ledger (Opus 4.7)";
        let reply = format!("I hope to visit {clue_name}.");
        assert!(messages(&scene, pip, Part::Line)
            .assistant
            .contains(clue_name));
        assert!(!Check::new(&scene, pip, Part::Line).names_unknown(&reply));
        assert!(Check::new(&scene, pip, Part::Line).names_unknown("I saw the Bell."));
        for (speaker, part) in [
            (vale, Part::Line),
            (pip, Part::Thought),
            (pip, Part::Persona),
        ] {
            assert!(!messages(&scene, speaker, part)
                .assistant
                .contains(clue_name));
            assert!(Check::new(&scene, speaker, part).names_unknown(&reply));
        }
    }

    async fn provider(
        quote: &'static str,
        conveys: bool,
        delay: Duration,
    ) -> (AiConfig, tokio::task::JoinHandle<()>) {
        let stub = post(move |Json(body): Json<Value>| async move {
            let text = if body["response_format"]["type"] == "json_object" {
                let reply = if conveys { PARAPHRASE } else { "I hear you." };
                let payload = &body["messages"].as_array().unwrap().last().unwrap()["content"];
                let payload: Value = serde_json::from_str(payload.as_str().unwrap()).unwrap();
                assert_eq!(payload["reply"], reply);
                assert_eq!(payload["fact"], CLUE);
                tokio::time::sleep(delay).await;
                json!({"conveys": conveys, "evidence": quote}).to_string()
            } else if stem_of(&body) == "Pip:" {
                if conveys { PARAPHRASE } else { "I hear you." }.to_string()
            } else {
                "What have you in mind, Pip?".to_string()
            };
            Json(json!({"model":body["model"],"choices":[{
                "message":{"content":text},"finish_reason":"stop"
            }]}))
        });
        let (address, server) = serve(Router::new().route("/chat/completions", stub)).await;
        let mut config = test_config(address);
        config.registry = Some(Arc::new(
            crate::ai_gateway::CapabilityRegistrySnapshot::from_json(
                &json!({"schema_version":1,"snapshot_version":"disclosure-test","declared":[{
                "requested_model_id":"test-entity-model","provider":"openai_compatible",
                "concrete_model":{"model_id":"test-entity-model"},
                "input_modalities":["text"],"output_modalities":["text"],
                "supported_parameters":{"json_mode":true,"structured_output":true},
                "capabilities":["world_content","intent_json"],
                "prompt_adapter":{"id":"openai-chat","version":"1"}
            }],"discovered":[]})
                .to_string(),
            )
            .unwrap(),
        ));
        config
            .capability_models
            .insert(ModelCapability::IntentJson, "test-entity-model".into());
        (config, server)
    }

    #[tokio::test]
    async fn grounded_disclosure_flows_to_both_local_and_shared_responses() {
        let (config, server) = provider(PARAPHRASE, true, Duration::ZERO).await;
        let app = router_with_models::<()>(
            Arc::new(Some(config.clone())),
            Ok(Default::default()),
            Ok(VoiceSettings::hosted()),
        );
        let scene = reserved_scene();
        let response = app.oneshot(request(&scene)).await.unwrap();
        assert!(response.status().is_success());
        let bytes = to_bytes(response.into_body(), 1 << 20).await.unwrap();
        let local: Value = serde_json::from_slice(&bytes).unwrap();
        let shared = shared_lines(
            &config,
            &json!(scene),
            "vale",
            &["vale".into(), "moth".into()],
            &BTreeMap::new(),
        )
        .await
        .unwrap();
        let evidence =
            json!({"factId":"topic:visit-ledger","speaker":"moth","listener":"vale","eventSeq":12});
        for result in [&local, &shared] {
            assert_eq!(result["entries"][1]["text"], PARAPHRASE, "{result}");
            assert_eq!(result["entries"][1]["disclosed"], evidence, "{result}");
        }
        assert!(local["entries"][1]["signed"].is_object());
        server.abort();
    }

    #[tokio::test]
    async fn verification_misses_keep_spoken_lines_and_do_not_disclose() {
        for (quote, conveys) in [("", false), ("I want to find somebody else.", true)] {
            let (config, server) = provider(quote, conveys, Duration::ZERO).await;
            let scene = reserved_scene();
            let result = shared_lines(
                &config,
                &json!(scene),
                "vale",
                &["vale".into(), "moth".into()],
                &BTreeMap::new(),
            )
            .await
            .unwrap();
            assert_eq!(
                result["entries"][1]["text"],
                if conveys { PARAPHRASE } else { "I hear you." }
            );
            assert!(result["entries"][1].get("disclosed").is_none());
            server.abort();
        }
    }

    #[tokio::test]
    async fn verification_streams_evidence_with_speech_and_timeouts_keep_the_line() {
        let receipt =
            json!({"factId":"topic:visit-ledger","speaker":"moth","listener":"vale","eventSeq":12});
        for (delay, expected) in [
            (Duration::ZERO, Some(&receipt)),
            (Duration::from_secs(12), None),
        ] {
            let (config, server) = provider(PARAPHRASE, true, delay).await;
            let app = router_with_models::<()>(
                Arc::new(Some(config)),
                Ok(Default::default()),
                Ok(VoiceSettings::hosted()),
            );
            let mut request = request(&reserved_scene());
            request
                .headers_mut()
                .insert("accept", "text/event-stream".parse().unwrap());
            let response = app.oneshot(request).await.unwrap();
            assert!(response.status().is_success());
            let mut chunks = response.into_body().into_data_stream();
            let mut frames = Vec::<Value>::new();
            while let Some(chunk) = chunks.next().await {
                let chunk = chunk.unwrap();
                frames.extend(
                    std::str::from_utf8(&chunk)
                        .unwrap()
                        .lines()
                        .filter_map(|line| {
                            line.strip_prefix("data: ")
                                .map(|data| serde_json::from_str(data).unwrap())
                        }),
                );
            }
            let deltas: Vec<Value> = frames
                .iter()
                .filter(|frame| frame["type"] == "delta")
                .map(|frame| serde_json::from_str(frame["text"].as_str().unwrap()).unwrap())
                .collect();
            if expected.is_none() {
                assert_eq!(
                    deltas[0]["id"], "vale",
                    "ready voices should pass the pending verifier"
                );
            }
            let line = deltas.iter().find(|line| line["id"] == "moth").unwrap();
            let complete = frames.last().unwrap();
            assert_eq!(complete["type"], "complete");
            for entry in [line, &complete["entries"][1]] {
                assert_eq!(entry["text"], PARAPHRASE);
                assert!(entry["signed"].is_object());
                assert_eq!(entry.get("disclosed"), expected);
            }
            server.abort();
        }
    }
}
