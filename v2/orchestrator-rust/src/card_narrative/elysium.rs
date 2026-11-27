use super::{conversation, untrusted::ELYSIUM_LINE_RULES_SUFFIX, Context, Memory};
use crate::{
    card_shared::{
        cast, elysium_name, elysium_resident_at, elysium_setting, is_legacy_elysium_introduction,
    },
    AppState,
};
use std::{collections::BTreeMap, sync::OnceLock};

fn retired_utterances() -> &'static BTreeMap<String, Vec<String>> {
    #[derive(serde::Deserialize)]
    struct LegacyLines {
        waiting: BTreeMap<String, Vec<String>>,
    }
    static LINES: OnceLock<LegacyLines> = OnceLock::new();
    &LINES
        .get_or_init(|| {
            serde_json::from_str(cosyworld_orchestrator::card_assets::text(
                "card-game/legacy-elysium-lines.json",
            ))
            .expect("retired Elysium dialogue")
        })
        .waiting
}

fn retired_utterance(actor: &str, text: &str) -> bool {
    if crate::card_shared::elysium_model(actor).is_none() {
        return false;
    }
    let text = text.trim();
    is_legacy_elysium_introduction(text)
        || ["all", actor].iter().any(|key| {
            retired_utterances()
                .get(*key)
                .is_some_and(|lines| lines.iter().any(|line| line == text))
        })
}

fn retired_memory(memory: &Memory) -> bool {
    let Some((speaker, text)) = memory.text.split_once(": ") else {
        return false;
    };
    match &memory.signed {
        Some(proof) => retired_utterance(&proof.claims.entity, text),
        // Shared memories use the pack name and need no browser signature.
        None => retired_utterances().keys().any(|id| {
            super::profiles()[id]["name"].as_str() == Some(speaker) && retired_utterance(id, text)
        }),
    }
}

/// Earlier releases wrote introductions and waiting lines as dialogue. Keep
/// receipts and history intact, but leave those utterances out of model input.
pub(super) fn prompt_context(context: &Context) -> Option<Context> {
    let retired = |id: &str, text: Option<&str>| text.is_some_and(|t| retired_utterance(id, t));
    let has_retired = context
        .conversation
        .iter()
        .any(|line| retired_utterance(&line.actor_id, &line.text))
        || context.entities.iter().any(|entity| {
            retired(&entity.id, entity.previous.as_deref())
                || entity.memories.iter().any(retired_memory)
                || entity
                    .between
                    .iter()
                    .flat_map(|b| &b.said)
                    .any(|line| retired_utterance(&line.actor_id, &line.text))
        });
    if !has_retired {
        return None;
    }
    let mut copy = conversation::copy_context(context)?;
    copy.conversation
        .retain(|line| !retired_utterance(&line.actor_id, &line.text));
    for entity in &mut copy.entities {
        if retired(&entity.id, entity.previous.as_deref()) {
            entity.previous = None;
            entity.previous_signed = None;
        }
        entity.memories.retain(|memory| !retired_memory(memory));
        for between in &mut entity.between {
            between
                .said
                .retain(|line| !retired_utterance(&line.actor_id, &line.text));
        }
    }
    Some(copy)
}

pub(super) fn personal_talk(context: &Context, voiced: &[String]) -> Option<(String, String)> {
    let outcome = context.outcome.as_ref()?;
    let actor = &outcome.avatars.first()?.id;
    let target = outcome.card.target.as_ref()?;
    (outcome.card.kind == "talk"
        && target != actor
        && voiced.contains(target)
        && elysium_resident_at(target, &context.location)
        && cast()["avatars"]
            .as_array()?
            .iter()
            .any(|seat| seat["id"] == actor.as_str())
        && [actor, target].iter().all(|id| {
            outcome
                .avatars
                .iter()
                .any(|avatar| &avatar.id == *id && avatar.location == context.location)
        }))
    .then(|| (actor.clone(), target.clone()))
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

pub(super) async fn prepare_name(
    state: &AppState,
    context: &Context,
    target: &str,
) -> Option<String> {
    elysium_name(
        state,
        target,
        &context.location,
        needs_introduction(context, target),
    )
    .await
}

pub(super) const SELF_INTRODUCTION: &str =
    "Introduce yourself to the traveler in your own words using your chosen name.";

pub(super) fn add_talk_facts(context: &mut Context, target: &str, name: Option<&str>) {
    let Some(setting) = elysium_setting(target, &context.location) else {
        return;
    };
    let introducing = name.is_some() && needs_introduction(context, target);
    let Some(resident) = context
        .entities
        .iter_mut()
        .find(|entity| entity.id == target)
    else {
        return;
    };
    resident.facts.push(format!("Home setting: {setting}."));
    if context.elysium_token_scattered {
        resident
            .facts
            .push("Token history: scattered beyond this Void.".into());
    }
    if let Some(name) = name {
        resident
            .facts
            .push(format!("Privately chosen name: {name}."));
    }
    resident
        .facts
        .push("Personal information can emerge over several conversations.".into());
    if introducing {
        context.elysium_introducer = Some(target.to_owned());
    }
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
    const EARLY: &str = "I listen to what the well gives back.";
    const LATER: &str = "I hear your voice beside the well.";
    const REVEAL: &str = "I go by Echo Thread, friend.";
    const LINE: &str =
        "I call myself Echo Thread. My token has slipped into the world beyond this Void.";

    fn talk() -> Context {
        serde_json::from_value(json!({
            "revision":31, "turn":31, "location":ROOM, "scenery":false,
            "action":"Vale has a conversation with Resident of Void 006.",
            "elysiumTokenScattered":true,
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
        assert!(personal_talk(&context, &[ID.to_string()]).is_some());
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

    #[test]
    fn token_facts_require_a_scatter_in_the_scene() {
        let mut context = talk();
        context.elysium_token_scattered = false;
        add_talk_facts(&mut context, ID, None);
        assert!(context.entities[2]
            .facts
            .iter()
            .all(|fact| !fact.contains("Token history")));
    }

    #[test]
    fn old_void_lines_keep_their_signed_evidence_but_leave_the_prompt() {
        use super::super::{messages, untrusted, Part};

        let mut context = talk();
        let wait = &retired_utterances()[ID][0];
        for text in [REVEAL, LINE, wait] {
            context.conversation.push(
                serde_json::from_value(json!({
                    "actorId":ID,"witnesses":["vale",ID],"text":text
                }))
                .unwrap(),
            );
        }
        context.entities[2].previous = Some(wait.clone());
        let vale = &mut context.entities[1];
        vale.memories.push(
            serde_json::from_value(json!({
                "turn":30,"kind":"expression","text":format!("{}: {wait}", super::super::name(ID))
            }))
            .unwrap(),
        );
        vale.between.push(
            serde_json::from_value(json!({
                "with":ID,"said":[{"actorId":ID,"turn":30,"text":LINE}]
            }))
            .unwrap(),
        );

        let signed = untrusted::signed(&context);
        let clean = prompt_context(&signed).unwrap();
        assert!(!needs_introduction(&signed, ID));
        assert_eq!(signed.conversation.len(), 3);
        assert_eq!(clean.conversation.len(), 1);
        assert_eq!(clean.conversation[0].text, REVEAL);
        assert!(clean.entities[2].previous.is_none());
        assert!(clean.entities[1].memories.is_empty());
        assert!(clean.entities[1].between[0].said.is_empty());
        for part in [Part::Line, Part::Thought, Part::Dream] {
            let prompt = format!("{:?}", messages(&clean, &clean.entities[1], part));
            assert!(!prompt.contains(LINE));
            assert!(!prompt.contains(wait));
        }
        assert!(!retired_utterance("vale", wait));
        assert!(prompt_context(&clean).is_none());
    }

    fn assert_signed(
        entry: &Value,
        id: &str,
        line: &str,
        model: Option<&str>,
        identity: Option<&str>,
    ) {
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
            assert_eq!(entry.get("elysiumName"), Some(&json!(identity)));
            if let Some(identity) = identity {
                let proof: Envelope =
                    serde_json::from_value(entry["elysiumNameSigned"].clone()).unwrap();
                assert_eq!(keys().verify(&proof), Verdict::Valid);
                assert_eq!(proof.claims.kind, "elysium-name");
                assert_eq!(proof.claims.content, content_hash(identity));
                assert_eq!(proof.claims.entity, envelope.claims.entity);
                assert_eq!(proof.claims.turn, envelope.claims.turn);
                assert_eq!(proof.claims.seq, envelope.claims.seq);
                assert_eq!(proof.claims.rules, envelope.claims.rules);
            } else {
                assert!(entry.get("elysiumNameSigned").is_none());
            }
        }
    }

    #[test]
    fn only_legacy_signed_lines_or_verified_typed_names_restore_introduction() {
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

        let mut intro = json!({"entries":[{"id":ID,"text":EARLY,"elysiumName":"Echo Thread"}]});
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
    async fn void_talk_signs_and_shares_the_model_identity_independently_of_speech() {
        let seen = Arc::new(Mutex::new(Vec::new()));
        let attempts = Arc::new(AtomicUsize::new(0));
        let replies = Arc::new(AtomicUsize::new(0));
        let (address, server) = serve(plain_provider(seen.clone(), move |body, _| {
            if body["model"] == TRAVELER_MODEL {
                return OPENING.into();
            }
            let prompt = body.to_string();
            if !prompt.contains("Choose a name for yourself")
                && !prompt.contains("Give yourself an original fantasy name")
            {
                return match replies.fetch_add(1, Ordering::Relaxed) {
                    1 | 4 => EARLY,
                    _ => LATER,
                }
                .into();
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
        for (index, (accept, expected, identity)) in [
            ("application/json", LATER, None),
            ("application/json", EARLY, Some("Echo Thread")),
            ("text/event-stream", LATER, Some("Echo Thread")),
            ("application/json", LATER, None),
        ]
        .into_iter()
        .enumerate()
        {
            let mut context = talk();
            if index == 3 {
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
                for (frame, id, text, name) in [
                    (&frames[0], "vale", OPENING, None),
                    (&frames[1], ID, expected, identity),
                ] {
                    assert_eq!(frame["type"], "delta");
                    assert_signed(
                        &serde_json::from_str(frame["text"].as_str().unwrap()).unwrap(),
                        id,
                        text,
                        None,
                        name,
                    );
                }
                assert_eq!(frames[2]["type"], "complete");
                frames[2].clone()
            } else {
                serde_json::from_slice(&body).unwrap()
            };
            assert_signed(
                &result["entries"][0],
                "vale",
                OPENING,
                Some(TRAVELER_MODEL),
                None,
            );
            assert_signed(&result["entries"][1], ID, expected, Some(MODEL), identity);
            if index == 0 {
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
        assert_eq!(shared["entries"][1]["text"], EARLY);
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
        let resident_replies: Vec<_> = seen
            .iter()
            .filter(|body| body["model"] == MODEL && !naming.contains(body))
            .collect();
        assert_eq!(resident_replies.len(), 5);
        for (index, body) in resident_replies.into_iter().enumerate() {
            let messages = body["messages"].as_array().unwrap();
            assert_eq!(
                messages.last().unwrap()["content"],
                format!("Vale says, “{OPENING}”")
            );
            let contains_instruction = |message: &Value| {
                message["content"]
                    .as_str()
                    .is_some_and(|content| content.contains(SELF_INTRODUCTION))
            };
            assert_eq!(
                messages.iter().any(contains_instruction),
                matches!(index, 1 | 2 | 4)
            );
            assert!(messages
                .iter()
                .filter(|message| contains_instruction(message))
                .all(|message| message["role"] == "system"));
            let prompt = body.to_string();
            assert!(prompt.contains("an indigo well"));
            assert!(prompt.contains("Token history: scattered beyond this Void"));
            assert_eq!(prompt.contains("Echo Thread"), index > 0);
        }
        assert!(seen
            .iter()
            .filter(|body| body["model"] == TRAVELER_MODEL)
            .all(|body| {
                let prompt = body.to_string();
                !prompt.contains("Token history: scattered beyond this Void")
                    && !prompt.contains("Echo Thread")
                    && !prompt.contains(SELF_INTRODUCTION)
            }));
        std::fs::remove_dir_all(root).unwrap();
        server.abort();
    }
}
