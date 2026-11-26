use super::{conversation, name, voiced, AiConfig, Context, SceneClosed, VoiceSettings};
use crate::{
    card_shared::{cast, is_elysium_introduction, personal_introduction},
    AppState,
};
use axum::response::Response;
use serde_json::{json, Value};
use std::collections::BTreeMap;

fn unnamed_target(context: &Context) -> Option<String> {
    let outcome = context.outcome.as_ref()?;
    let actor = &outcome.avatars.first()?.id;
    let (_, target) = conversation::reply_target_for(context, &voiced(context), actor)?;
    let action = format!("{} has a conversation with {}.", name(actor), name(&target));
    (target.starts_with("elysium-")
        && cast()["avatars"]
            .as_array()?
            .iter()
            .any(|seat| seat["id"] == *actor)
        && context.action.as_deref() == Some(&action)
        && [actor, &target].iter().all(|id| {
            outcome
                .avatars
                .iter()
                .any(|avatar| &avatar.id == *id && avatar.location == context.location)
        })
        && context.elysium_introduced.as_ref() != Some(&target)
        && !context
            .conversation
            .iter()
            .any(|line| line.actor_id == target && is_elysium_introduction(&line.text)))
    .then_some(target)
}

pub(super) async fn complete(
    app: Option<&AppState>,
    config: &AiConfig,
    context: &Context,
    character_models: &BTreeMap<String, String>,
    settings: &VoiceSettings,
    on_delta: Option<&(dyn Fn(&str) -> bool + Send + Sync)>,
) -> Result<Value, Box<Response>> {
    if let Some((app, target)) = app.zip(unnamed_target(context)) {
        if let Some((text, model)) = personal_introduction(app, &target, &context.location).await {
            let entry = json!({"id": target, "text": text, "model": model});
            if on_delta.is_some_and(|emit| !emit(&entry.to_string())) {
                return Err(SceneClosed.into());
            }
            let omitted: Vec<_> = context
                .entities
                .iter()
                .filter(|e| e.id != target)
                .map(|e| &e.id)
                .collect();
            return Ok(
                json!({"revision": context.revision, "entries": [entry], "omitted": omitted, "model": model, "silent": []}),
            );
        }
    }
    super::complete(config, context, character_models, settings, on_delta).await
}

#[cfg(test)]
mod tests {
    use super::super::{
        router_with_models,
        tests::{plain_provider, serve, test_config},
        valid, ConnectInfo, SocketAddr,
    };
    use super::*;
    use crate::{
        ai_gateway::CapabilityRegistrySnapshot,
        routes::signed_envelope::{content_hash, keys, Envelope, Verdict},
        test_support::test_app_state,
    };
    use axum::{
        body::{to_bytes, Body},
        http::{Request, StatusCode},
        Extension,
    };
    use std::sync::{
        atomic::{AtomicUsize, Ordering},
        Arc, Mutex,
    };
    use tower::ServiceExt;

    const ID: &str = "elysium-deepseek";
    const ROOM: &str = "elysium-void-006";
    const MODEL: &str = "deepseek/deepseek-v4.1-flash";
    const LINE: &str =
        "I call myself Echo Thread. My token has slipped into the world beyond this Void.";

    fn talk() -> Context {
        serde_json::from_value(json!({
            "revision":31, "turn":31, "location":ROOM, "scenery":false,
            "action":"Vale has a conversation with Resident of Void 006.",
            "speakers":["vale",ID],
            "entities":[
                {"id":ROOM,"facts":[],"memories":[]},
                {"id":"vale","facts":[],"memories":[],"desire":{"items":[],"avatars":[]}},
                {"id":ID,"facts":[],"memories":[],"desire":{"items":[],"avatars":[]}}
            ],
            "outcome":{
                "card":{"kind":"talk","target":ID},
                "avatars":[
                    {"id":"vale","location":ROOM,"holding":[]},
                    {"id":ID,"location":ROOM,"holding":[]}
                ],
                "items":[]
            }
        }))
        .unwrap()
    }

    #[test]
    fn introduction_requires_direct_colocated_talk_and_stops_after_learning() {
        let mut context = talk();
        assert!(valid(&context));
        assert_eq!(unnamed_target(&context).as_deref(), Some(ID));
        context.elysium_introduced = Some("elysium-qwen".into());
        assert!(unnamed_target(&context).is_some());
        context.elysium_introduced = Some(ID.into());
        assert!(unnamed_target(&context).is_none());
        context.elysium_introduced = None;
        context.outcome.as_mut().unwrap().avatars[1].location = "elysium-void-005".into();
        assert!(unnamed_target(&context).is_none());
        context.outcome.as_mut().unwrap().avatars[1].location = ROOM.into();
        context.outcome.as_mut().unwrap().card.kind = "move".into();
        assert!(unnamed_target(&context).is_none());
    }

    fn assert_signed(entry: &Value, (line, model): (&str, &str)) {
        assert_eq!(entry["id"], ID);
        assert_eq!(entry["text"], line);
        assert_eq!(entry["model"], model);
        let envelope: Envelope = serde_json::from_value(entry["signed"].clone()).unwrap();
        assert_eq!(keys().verify(&envelope), Verdict::Valid);
        assert_eq!(envelope.claims.entity, ID);
        assert_eq!(envelope.claims.kind, "line");
        assert_eq!(envelope.claims.content, content_hash(line));
        assert_eq!(envelope.claims.seq, 31);
    }

    #[tokio::test]
    async fn personal_talk_uses_bound_model_and_signs_json_and_sse() {
        let seen = Arc::new(Mutex::new(Vec::new()));
        let attempts = Arc::new(AtomicUsize::new(0));
        let (address, server) = serve(plain_provider(seen.clone(), move |_, _| {
            match attempts.fetch_add(1, Ordering::Relaxed) {
                0 => "I have several good ideas.".into(),
                1 => "My name is".into(),
                _ => "**“Echo Thread”**.".into(),
            }
        }))
        .await;
        let mut config = test_config(address);
        config.registry = Some(Arc::new(
            CapabilityRegistrySnapshot::from_json(
                &json!({
                    "schema_version":1,"snapshot_version":"elysium-intro-test",
                    "declared":[{
                        "requested_model_id":MODEL,"provider":"openai_compatible",
                        "concrete_model":{"model_id":MODEL},
                        "input_modalities":["text"],"output_modalities":["text"],
                        "supported_parameters":{"structured_output":true},
                        "data_policy":{"retention":"none","training":"prohibited"},
                        "capabilities":["world_content"],
                        "prompt_adapter":{"id":"openai-chat","version":"1"}
                    }],"discovered":[]
                })
                .to_string(),
            )
            .unwrap(),
        ));
        let mut state = test_app_state(None);
        state.ai_config = Arc::new(Some(config));
        let root = std::env::temp_dir().join(format!("personal-elysium-{}", crate::random_hex(8)));
        state.generated_asset_dir = Arc::new(root.clone());
        let app = router_with_models::<()>(
            state.ai_config.clone(),
            Ok(BTreeMap::new()),
            Ok(VoiceSettings::hosted()),
        )
        .layer(Extension(state));
        let before_name = (
            "My name is still taking shape. Ask me again, traveler.",
            "elysium-authored",
        );
        for (accept, expected) in [
            ("application/json", before_name),
            ("text/event-stream", (LINE, MODEL)),
            ("application/json", (LINE, MODEL)),
        ] {
            let mut request = Request::post("/card-game/text")
                .header("content-type", "application/json")
                .header("host", "localhost")
                .header("accept", accept)
                .body(Body::from(serde_json::to_vec(&talk()).unwrap()))
                .unwrap();
            request
                .extensions_mut()
                .insert(ConnectInfo("127.0.0.1:1234".parse::<SocketAddr>().unwrap()));
            let response = app.clone().oneshot(request).await.unwrap();
            let status = response.status();
            let body = to_bytes(response.into_body(), 1 << 20).await.unwrap();
            assert_eq!(status, StatusCode::OK, "{}", String::from_utf8_lossy(&body));
            if accept == "text/event-stream" {
                let frames: Vec<Value> = String::from_utf8_lossy(&body)
                    .lines()
                    .filter_map(|line| line.strip_prefix("data: "))
                    .map(|line| serde_json::from_str(line).unwrap())
                    .collect();
                assert_eq!(frames.len(), 2, "{frames:?}");
                assert_eq!(frames[0]["type"], "delta");
                assert_signed(
                    &serde_json::from_str(frames[0]["text"].as_str().unwrap()).unwrap(),
                    expected,
                );
                assert_eq!(frames[1]["type"], "complete");
                assert_eq!(frames[1]["silent"], json!([]));
                assert_signed(&frames[1]["entries"][0], expected);
            } else {
                let value: Value = serde_json::from_slice(&body).unwrap();
                assert_eq!(value["silent"], json!([]));
                assert_signed(&value["entries"][0], expected);
                if expected == before_name {
                    assert!(!root
                        .join("elysium-models")
                        .join(ID)
                        .join("name.txt")
                        .exists());
                }
            }
        }
        let seen = seen.lock().unwrap();
        assert_eq!(
            seen.len(),
            3,
            "two initial attempts and one on the next Talk"
        );
        assert!(seen.iter().all(|request| request["model"] == MODEL));
        assert!(seen[0].to_string().contains("an indigo well"));
        assert!(!seen[0].to_string().contains("Vale"));
        std::fs::remove_dir_all(root).unwrap();
        server.abort();
    }
}
