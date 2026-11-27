use super::{conversation, untrusted::ELYSIUM_LINE_RULES_SUFFIX, Context};
use crate::{
    card_shared::{
        cast, elysium_resident_at, is_legacy_elysium_introduction, resident_introduction,
    },
    AppState,
};

pub(super) fn personal_talk(context: &Context, voiced: &[String]) -> Option<(String, String)> {
    let outcome = context.outcome.as_ref()?;
    let (actor, target) =
        conversation::reply_target_for(context, voiced, &outcome.avatars.first()?.id)?;
    (elysium_resident_at(&target, &context.location)
        && cast()["avatars"]
            .as_array()?
            .iter()
            .any(|seat| seat["id"] == actor)
        && [&actor, &target].iter().all(|id| {
            outcome
                .avatars
                .iter()
                .any(|avatar| &avatar.id == *id && avatar.location == context.location)
        }))
    .then_some((actor, target))
}

pub(super) fn needs_introduction(context: &Context, target: &str) -> bool {
    context.elysium_introduced.as_deref() != Some(target)
        && !context.conversation.iter().any(|line| {
            line.actor_id == target
                && match &line.elysium_name {
                    Some(name) => name.is_some(),
                    None => {
                        line.signed.as_ref().is_some_and(|proof| {
                            !proof.claims.rules.ends_with(ELYSIUM_LINE_RULES_SUFFIX)
                        }) && is_legacy_elysium_introduction(&line.text)
                    }
                }
        })
}

pub(super) async fn reply(
    state: &AppState,
    context: &Context,
    target: &str,
) -> Option<conversation::Entry> {
    let previous = context
        .conversation
        .iter()
        .rev()
        .find(|line| line.actor_id == target)
        .map(|line| line.text.as_str());
    let reply = resident_introduction(state, target, &context.location, previous).await?;
    let mut entry = conversation::Entry::spoken(target, reply.text, reply.model.to_owned());
    entry.elysium_name = Some(reply.name);
    Some(entry)
}

#[cfg(test)]
mod tests {
    use super::super::{
        router_with_models,
        tests::{plain_provider, serve, test_config},
        valid, voiced, ConnectInfo, SocketAddr, VoiceSettings,
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
    use serde_json::{json, Value};
    use std::collections::BTreeMap;
    use std::sync::{
        atomic::{AtomicUsize, Ordering},
        Arc, Mutex,
    };
    use tower::ServiceExt;

    const ID: &str = "elysium-deepseek";
    const ROOM: &str = "elysium-void-006";
    const MODEL: &str = "deepseek/deepseek-v4.1-flash";
    const TRAVELER_MODEL: &str = "test-traveler-model";
    const OPENING: &str = "What should I call you?";
    const LATER: &str = "I hear your voice beside the well.";
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
        let selected = |context: &Context| {
            let pair = personal_talk(context, &voiced(context))?;
            needs_introduction(context, &pair.1).then_some(pair)
        };
        context.action = None;
        assert_eq!(selected(&context), Some(("vale".into(), ID.into())));
        context.elysium_introduced = Some("elysium-qwen".into());
        assert!(selected(&context).is_some());
        context.elysium_introduced = Some(ID.into());
        assert!(selected(&context).is_none());
        context.elysium_introduced = None;
        context.outcome.as_mut().unwrap().avatars[1].location = "elysium-void-005".into();
        assert!(selected(&context).is_none());
        context.outcome.as_mut().unwrap().avatars[1].location = ROOM.into();
        context.outcome.as_mut().unwrap().card.kind = "move".into();
        assert!(selected(&context).is_none());
        context.outcome.as_mut().unwrap().card.kind = "talk".into();
        context.outcome.as_mut().unwrap().avatars[0].id = "mara".into();
        context.speakers[0] = "mara".into();
        context.entities[1].id = "mara".into();
        context.action = Some("Mara has a conversation with Resident of Void 006.".into());
        context.elysium_introduced = Some(ID.into());
        assert_eq!(
            personal_talk(&context, &voiced(&context)),
            Some(("mara".into(), ID.into()))
        );
        assert!(!needs_introduction(&context, ID));
    }

    fn assert_signed(entry: &Value, id: &str, line: &str, model: Option<&str>) {
        assert_eq!(entry["id"], id);
        assert_eq!(entry["text"], line);
        if let Some(model) = model {
            assert_eq!(entry["model"], model);
        }
        let envelope: Envelope = serde_json::from_value(entry["signed"].clone()).unwrap();
        assert_eq!(keys().verify(&envelope), Verdict::Valid);
        assert_eq!(envelope.claims.entity, id);
        assert_eq!(envelope.claims.kind, "line");
        assert_eq!(envelope.claims.content, content_hash(line));
        assert_eq!(envelope.claims.seq, 31);
        if id == ID {
            assert!(envelope.claims.rules.ends_with(ELYSIUM_LINE_RULES_SUFFIX));
            assert_eq!(
                entry.get("elysiumName"),
                Some(&if line == LINE {
                    json!("Echo Thread")
                } else {
                    Value::Null
                })
            );
            if line == LINE {
                let proof: Envelope =
                    serde_json::from_value(entry["elysiumNameSigned"].clone()).unwrap();
                assert_eq!(keys().verify(&proof), Verdict::Valid);
                assert_eq!(proof.claims.kind, "elysium-name");
                assert_eq!(proof.claims.content, content_hash("Echo Thread"));
            } else {
                assert!(entry.get("elysiumNameSigned").is_none());
            }
        }
    }

    #[test]
    fn only_legacy_signed_captions_or_verified_typed_names_restore_introduction() {
        use super::super::untrusted::{sign_lines, signed, trusted, ScreeningFailure};

        let mut legacy = talk();
        legacy
            .conversation
            .push(serde_json::from_value(json!({"actorId":ID,"text":LINE})).unwrap());
        assert!(!needs_introduction(&trusted(signed(&legacy)).unwrap(), ID));

        let restored = |entry: &Value| {
            let mut context = talk();
            let mut line = entry.clone();
            let fields = line.as_object_mut().unwrap();
            fields.remove("id");
            fields.insert("actorId".into(), json!(ID));
            context
                .conversation
                .push(serde_json::from_value(line).unwrap());
            trusted(context)
        };
        let mut modern = json!({"entries":[{"id":ID,"text":LINE,"elysiumName":null}]});
        sign_lines(&mut modern, &talk());
        assert!(needs_introduction(
            &restored(&modern["entries"][0]).unwrap(),
            ID
        ));
        modern["entries"][0]
            .as_object_mut()
            .unwrap()
            .remove("elysiumName");
        assert!(needs_introduction(
            &restored(&modern["entries"][0]).unwrap(),
            ID
        ));

        let mut intro = json!({"entries":[{"id":ID,"text":"You may know me as Echo Thread.","elysiumName":"Echo Thread"}]});
        sign_lines(&mut intro, &talk());
        assert!(!needs_introduction(
            &restored(&intro["entries"][0]).unwrap(),
            ID
        ));
        intro["entries"][0]["elysiumName"] = json!("A Different Name");
        assert!(matches!(
            restored(&intro["entries"][0]),
            Err(ScreeningFailure::SavedWords)
        ));
    }

    #[tokio::test]
    async fn personal_talk_uses_bound_model_and_signs_json_and_sse() {
        let seen = Arc::new(Mutex::new(Vec::new()));
        let attempts = Arc::new(AtomicUsize::new(0));
        let (address, server) = serve(plain_provider(seen.clone(), move |body, _| {
            if body["model"] == TRAVELER_MODEL {
                return OPENING.into();
            }
            let prompt = body.to_string();
            if !prompt.contains("Choose a name for yourself")
                && !prompt.contains("Give yourself an original fantasy name")
            {
                return LATER.into();
            }
            match attempts.fetch_add(1, Ordering::Relaxed) {
                0 => "I have several good ideas.".into(),
                1 => "My name is".into(),
                _ => "**“Echo Thread”**.".into(),
            }
        }))
        .await;
        let mut config = test_config(address);
        let declared = [MODEL, TRAVELER_MODEL].map(|model| {
            json!({
                "requested_model_id":model,"provider":"openai_compatible",
                "concrete_model":{"model_id":model},
                "input_modalities":["text"],"output_modalities":["text"],
                "supported_parameters":{"structured_output":true},
                "data_policy":{"retention":"none","training":"prohibited"},
                "capabilities":["world_content"],
                "prompt_adapter":{"id":"openai-chat","version":"1"}
            })
        });
        config.registry = Some(Arc::new(
            CapabilityRegistrySnapshot::from_json(
                &json!({
                    "schema_version":1,"snapshot_version":"elysium-intro-test",
                    "declared":declared,"discovered":[]
                })
                .to_string(),
            )
            .unwrap(),
        ));
        let mut state = test_app_state(None);
        state.ai_config = Arc::new(Some(config));
        let root = std::env::temp_dir().join(format!("personal-elysium-{}", crate::random_hex(8)));
        state.generated_asset_dir = Arc::new(root.clone());
        let models = BTreeMap::from([("vale".into(), TRAVELER_MODEL.into())]);
        let app = router_with_models::<()>(
            state.ai_config.clone(),
            Ok(models.clone()),
            Ok(VoiceSettings::hosted()),
        )
        .layer(Extension(state.clone()));
        let before_name = (
            "My name is still taking shape. Ask me again, traveler.",
            "elysium-authored",
        );
        for (accept, expected) in [
            ("application/json", before_name),
            ("text/event-stream", (LINE, MODEL)),
            ("application/json", (LINE, MODEL)),
            ("application/json", (LATER, MODEL)),
        ] {
            let mut context = talk();
            if expected.0 == LATER {
                context.elysium_introduced = Some(ID.into());
            }
            let mut request = Request::post("/card-game/text")
                .header("content-type", "application/json")
                .header("host", "localhost")
                .header("accept", accept)
                .body(Body::from(serde_json::to_vec(&context).unwrap()))
                .unwrap();
            request
                .extensions_mut()
                .insert(ConnectInfo("127.0.0.1:1234".parse::<SocketAddr>().unwrap()));
            let response = app.clone().oneshot(request).await.unwrap();
            let status = response.status();
            let body = to_bytes(response.into_body(), 1 << 20).await.unwrap();
            assert_eq!(status, StatusCode::OK, "{}", String::from_utf8_lossy(&body));
            let result = if accept == "text/event-stream" {
                let frames: Vec<Value> = String::from_utf8_lossy(&body)
                    .lines()
                    .filter_map(|line| line.strip_prefix("data: "))
                    .map(|line| serde_json::from_str(line).unwrap())
                    .collect();
                assert_eq!(frames.len(), 3, "{frames:?}");
                for (frame, id, text) in
                    [(&frames[0], "vale", OPENING), (&frames[1], ID, expected.0)]
                {
                    assert_eq!(frame["type"], "delta");
                    assert_signed(
                        &serde_json::from_str(frame["text"].as_str().unwrap()).unwrap(),
                        id,
                        text,
                        None,
                    );
                }
                assert_eq!(frames[2]["type"], "complete");
                frames[2].clone()
            } else {
                serde_json::from_slice(&body).unwrap()
            };
            assert_signed(&result["entries"][0], "vale", OPENING, Some(TRAVELER_MODEL));
            assert_signed(&result["entries"][1], ID, expected.0, Some(expected.1));
            if expected == before_name {
                assert!(!root
                    .join("elysium-models")
                    .join(ID)
                    .join("name.txt")
                    .exists());
            }
        }
        let introduction = (state.clone(), ID.into());
        let shared = super::super::shared_lines_with_introduction(
            state.ai_config.as_ref().as_ref().unwrap(),
            &json!(talk()),
            "vale",
            &["vale".into(), ID.into()],
            &models,
            Some(&introduction),
        )
        .await
        .unwrap();
        assert_eq!(shared["entries"][0]["text"], OPENING);
        assert_eq!(shared["entries"][1]["text"], LINE);
        assert_eq!(shared["entries"][1]["elysiumName"], "Echo Thread");
        assert!(shared["entries"][1].get("elysiumNameSigned").is_none());
        let seen = seen.lock().unwrap();
        let naming: Vec<_> = seen
            .iter()
            .filter(|body| body.to_string().contains("Use only this public setting."))
            .collect();
        assert_eq!(
            naming.len(),
            3,
            "two initial attempts and one on the next Talk"
        );
        assert!(naming.iter().all(|request| request["model"] == MODEL));
        assert!(naming[0].to_string().contains("an indigo well"));
        assert!(!naming[0].to_string().contains("Vale"));
        std::fs::remove_dir_all(root).unwrap();
        server.abort();
    }
}
