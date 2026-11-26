use super::{conversation, error, name, voiced, AiConfig, Context, SceneClosed, VoiceSettings};
use crate::{
    card_shared::{cast, is_elysium_introduction, personal_introduction},
    AppState,
};
use axum::{http::StatusCode, response::Response};
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
        if let Some(result) = personal_introduction(app, &target, &context.location).await {
            let (text, model) = result.map_err(|reason| {
                tracing::warn!(resident = %target, %reason, "personal Elysium introduction pending");
                Box::new(error(StatusCode::BAD_GATEWAY, "The resident's name needs another try."))
            })?;
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
                json!({"revision": context.revision, "entries": [entry], "omitted": omitted, "model": model}),
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
        http::Request,
        Extension,
    };
    use std::sync::{Arc, Mutex};
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

    fn assert_signed(entry: &Value) {
        assert_eq!(entry["id"], ID);
        assert_eq!(entry["text"], LINE);
        assert_eq!(entry["model"], MODEL);
        let envelope: Envelope = serde_json::from_value(entry["signed"].clone()).unwrap();
        assert_eq!(keys().verify(&envelope), Verdict::Valid);
        assert_eq!(envelope.claims.entity, ID);
        assert_eq!(envelope.claims.kind, "line");
        assert_eq!(envelope.claims.content, content_hash(LINE));
        assert_eq!(envelope.claims.seq, 31);
    }

    #[tokio::test]
    async fn personal_talk_uses_bound_model_and_signs_json_and_sse() {
        let seen = Arc::new(Mutex::new(Vec::new()));
        let (address, server) =
            serve(plain_provider(seen.clone(), |_, _| "Echo Thread".into())).await;
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
        for (accept, stream) in [("application/json", false), ("text/event-stream", true)] {
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
            if stream {
                let frames: Vec<Value> = String::from_utf8_lossy(&body)
                    .lines()
                    .filter_map(|line| line.strip_prefix("data: "))
                    .map(|line| serde_json::from_str(line).unwrap())
                    .collect();
                assert_eq!(frames.len(), 2, "{frames:?}");
                assert_eq!(frames[0]["type"], "delta");
                assert_signed(&serde_json::from_str(frames[0]["text"].as_str().unwrap()).unwrap());
                assert_eq!(frames[1]["type"], "complete");
                assert_signed(&frames[1]["entries"][0]);
            } else {
                let value: Value = serde_json::from_slice(&body).unwrap();
                assert_signed(&value["entries"][0]);
            }
        }
        let seen = seen.lock().unwrap();
        assert_eq!(seen.len(), 1, "the committed name is reused");
        assert_eq!(seen[0]["model"], MODEL);
        assert!(seen[0].to_string().contains("an indigo well"));
        assert!(!seen[0].to_string().contains("Vale"));
        std::fs::remove_dir_all(root).unwrap();
        server.abort();
    }
}
