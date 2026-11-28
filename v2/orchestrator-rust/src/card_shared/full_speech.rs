use super::{full_world::actor_id, store::Result};
use crate::ai_gateway::{AiConfig, ModelCapability};
use crate::routes::card_game::narrative::{shared_lines_with_introduction, Introduction};
use serde_json::{json, Value};
use std::collections::BTreeMap;

pub(super) fn prepared(actor: usize, work: &Value) -> Result<(Value, Vec<String>)> {
    let scene = &work["context"];
    if !scene.is_object() {
        return Err("The play is saved. Its scene needs another moment.".into());
    }
    let room = scene["location"]
        .as_str()
        .or_else(|| work["room"].as_str())
        .ok_or("The scene needs a place.")?;
    let mut ids: Vec<String> = scene["speakers"]
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(Value::as_str)
        .map(str::to_owned)
        .collect();
    if scene["scenery"].as_bool().unwrap_or(true) && !ids.iter().any(|id| id == room) {
        ids.push(room.to_string());
    }
    let profiles = work["profiles"]
        .as_object()
        .ok_or("The scene needs its character profiles.")?;
    let selected: serde_json::Map<String, Value> = profiles
        .iter()
        .filter(|(id, _)| ids.contains(id))
        .map(|(k, v)| (k.clone(), v.clone()))
        .collect();
    if ids.iter().any(|id| !selected.contains_key(id)) {
        return Err("The scene needs its character profiles.".into());
    }
    Ok((
        json!({"requested_ids":ids,"acting_avatar":actor_id(actor),"profiles":selected,"scene":scene}),
        ids,
    ))
}
/// Each requested voice publishes one clear line or stays silent.
pub(super) fn parse(text: &str, work: &Value, ids: &[String]) -> Result<Value> {
    let error = "The play is saved. Its words need another moment.";
    let parsed: Value = serde_json::from_str(text).map_err(|_| error.to_string())?;
    let entries = parsed["entries"].as_array().ok_or(error)?;
    let mut lines = Vec::new();
    for id in ids {
        let mut found = entries.iter().filter(|e| e["id"] == *id);
        let (Some(entry), None) = (found.next(), found.next()) else {
            continue;
        };
        let profile = &work["profiles"][id];
        let (Some(text), Some(name)) = (entry["text"].as_str(), profile["name"].as_str()) else {
            continue;
        };
        let text = text.trim();
        if text.is_empty() || text.chars().count() > 240 || text.chars().any(char::is_control) {
            continue;
        }
        let mut line = json!({"reflection":entry["reflection"],"model":entry["model"],"speaker":name,"text":text,"entityId":id,"actorId":if profile["kind"]=="avatar"{Some(id)}else{None}});
        for key in ["elysiumName", "disclosed"] {
            if let Some(value) = entry.get(key) {
                line[key] = value.clone();
            }
        }
        lines.push(line);
    }
    Ok(json!(lines))
}
/// The avatars a play's words were due from, the acting avatar included.
pub(super) fn voices(work: &Value, actor: usize) -> Vec<String> {
    let Ok((_, ids)) = prepared(actor, work) else {
        return Vec::new();
    };
    ids.into_iter()
        .filter(|id| work["profiles"][id]["kind"] == "avatar")
        .collect()
}
/// Requested avatars without published lines remain silent in the scene record.
pub(super) fn silent(work: &Value, actor: usize, lines: &Value) -> Vec<String> {
    let Ok((_, ids)) = prepared(actor, work) else {
        return Vec::new();
    };
    ids.into_iter()
        .filter(|id| work["profiles"][id]["kind"] == "avatar")
        .filter(|id| {
            !lines
                .as_array()
                .is_some_and(|lines| lines.iter().any(|l| l["entityId"] == *id))
        })
        .collect()
}
/// The story service's settings for shared voices and reflections.
pub(super) fn story(state: &crate::AppState) -> Result<(AiConfig, BTreeMap<String, String>)> {
    let mut config = state
        .ai_config
        .as_ref()
        .clone()
        .ok_or("The play is saved. The story service is warming up.")?;
    let models: Value = std::env::var("COSYWORLD_CARD_CHARACTER_MODELS_JSON")
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or(Value::Null);
    if let Some(model) = std::env::var("COSYWORLD_CARD_TEXT_MODEL")
        .ok()
        .filter(|m| !m.trim().is_empty())
    {
        config
            .capability_models
            .insert(ModelCapability::WorldContent, model);
    }
    config.reasoning_effort = std::env::var("COSYWORLD_CARD_TEXT_REASONING_EFFORT")
        .ok()
        .or(config.reasoning_effort);
    let models: BTreeMap<String, String> = serde_json::from_value(models).unwrap_or_default();
    Ok((config, models))
}
pub(super) async fn generate(
    state: &crate::AppState,
    actor: usize,
    work: &Value,
    introduction: Option<&Introduction>,
) -> Result<Value> {
    let (payload, ids) = prepared(actor, work)?;
    // A silent play voices no one: it finishes with no lines and no model call.
    if ids.is_empty() {
        return Ok(json!([]));
    }
    let (config, models) = story(state)?;
    let value = shared_lines_with_introduction(
        &config,
        &payload["scene"],
        actor_id(actor),
        &ids,
        &models,
        introduction,
    )
    .await?;
    parse(&value.to_string(), work, &ids)
}
#[cfg(test)]
mod tests {
    use super::super::{
        full, full_store,
        full_world::{actor_index, World},
        now, store,
    };
    use super::*;

    #[cfg(feature = "rules-wasm")]
    #[test]
    fn sqlite_rules_wasm_parity_opening_speech() {
        use super::super::{content, engine};

        let artifact = std::env::var_os("COSYWORLD_RULES_WASM").expect("build the rules artifact");
        let guest =
            cosyworld_orchestrator::rules_wasm::Rules::new(&std::fs::read(artifact).unwrap())
                .unwrap();
        let c = store::open(std::path::Path::new(":memory:")).unwrap();
        full_store::schema(&c).unwrap();
        let id = "opening-speech";
        store::create(&c, id, "owner", 0).unwrap();
        let mut world = World::seeded(None, Some(19)).unwrap();
        full_store::seed(&c, id, &world, "test-create", 0).unwrap();
        for (at, op) in [(1, "claim"), (2, "enter")] {
            full_store::commit(&c, id, &mut world, json!({"op":op,"actor":"vale"}), at).unwrap();
        }
        let work = full_store::commit(
            &c,
            id,
            &mut world,
            json!({"op":"play", "actor":"vale", "action":"wait:vale::"}),
            3,
        )
        .unwrap();
        let (_, voices) = prepared(0, &work).unwrap();
        assert_eq!(voices, ["vale"]);
        let drafted = json!({"entries":[{"id":"vale","text":"I hear the wind."}]});
        let lines = parse(&drafted.to_string(), &work, &voices).unwrap();
        assert_eq!(lines.as_array().unwrap().len(), 1);
        full_store::commit(
            &c,
            id,
            &mut world,
            json!({
                "op":"speech", "actor":"vale", "room":"attic", "entries":[], "lines":lines,
            }),
            4,
        )
        .unwrap();

        let mut checked = 0;
        let (_, replayed) = full_store::replay(&c, id, 0, None, |_, world, command| {
            world.apply_with(command, &mut |version, pack, request| {
                let expected = engine::reduce_journal(version, pack, request.clone())?;
                if request["op"] == "speech" {
                    let pack = pack.ok_or("Rules WASM requires pinned pack content.")?;
                    if guest
                        .reduce_with_pack(&request, &content::text(pack)?)?
                        .as_ref()
                        != Some(&expected)
                    {
                        return Err("The opening speech candidate differs from QuickJS.".into());
                    }
                    checked += 1;
                }
                Ok(expected)
            })?;
            Ok(())
        })
        .unwrap();
        assert_eq!(checked, 1);
        assert!(replayed.is_some_and(|replayed| replayed == world));
    }

    #[test]
    fn shared_bard_can_comment_on_the_earned_poem() {
        let verse = "I told her I would turn away. Her brother waited by the wall.";
        let work = json!({"room":"greek-harbor","context":{
            "location":"greek-harbor","speakers":["vale","greek-rhapsode"],"scenery":false,
            "outcome":{"card":{"kind":"talk","target":"greek-rhapsode"}},
            "entities":[{"id":"greek-rhapsode","facts":[format!("Verse 1, Vale: {verse}")]}]
        },"profiles":{"vale":{"name":"Vale","kind":"avatar"},"greek-rhapsode":{"name":"The Bard","kind":"avatar"}}});
        let (payload, ids) = prepared(0, &work).unwrap();
        assert_eq!(payload["scene"], work["context"]);
        let response = |text: &str| {
            json!({"entries":[{"id":"vale","text":"I hear you."},{"id":"greek-rhapsode","text":text}]}).to_string()
        };
        assert!(parse(&response(verse), &work, &ids).is_ok());
        assert!(parse(
            &response("The dark keeps every name the waves release."),
            &work,
            &ids
        )
        .is_ok());
    }
    #[test]
    fn listed_player_and_resident_voices_share_one_scene() {
        let mut work = json!({"room":"station","context":{"location":"station","speakers":["vale","pip","mara"],"scenery":false,"outcome":{"card":{"target":"pip"}}},"profiles":{"vale":{"name":"Vale","kind":"avatar"},"pip":{"name":"Pip","kind":"avatar"},"mara":{"name":"Mara","kind":"avatar"},"rue":{"name":"Rue","kind":"avatar"},"station":{"name":"Empty station","kind":"location"}}});
        let (payload, ids) = prepared(0, &work).unwrap();
        assert_eq!(ids, vec!["vale", "pip", "mara"]);
        assert_eq!(payload["acting_avatar"], "vale");
        assert!(payload["profiles"].get("rue").is_none());
        let result=parse(r#"{"entries":[{"id":"vale","text":"What caught your eye?"},{"id":"pip","text":"That shine belongs in my collection."},{"id":"mara","text":"I see it too."},{"id":"rue","text":"I'm here."}]}"#, &work, &ids).unwrap();
        assert_eq!(result.as_array().unwrap().len(), 3);
        assert_eq!(result[1]["actorId"], "pip");
        assert_eq!(result[2]["actorId"], "mara");
        assert!(silent(&work, 0, &result).is_empty());
        // A line that does not come stays silent, the actor's too.
        let quiet = parse(
            r#"{"entries":[{"id":"vale","text":"What caught your eye?"}]}"#,
            &work,
            &ids,
        )
        .unwrap();
        assert_eq!(quiet.as_array().unwrap().len(), 1);
        assert_eq!(silent(&work, 0, &quiet), vec!["pip", "mara"]);
        let reply = r#"{"entries":[{"id":"pip","text":"Mine."},{"id":"vale","text":" "}]}"#;
        let reply = parse(reply, &work, &ids).unwrap();
        assert_eq!(reply[0]["entityId"], "pip");
        assert_eq!(silent(&work, 0, &reply), vec!["vale", "mara"]);
        work["context"]["scenery"] = json!(true);
        assert_eq!(
            prepared(0, &work).unwrap().1,
            vec!["vale", "pip", "mara", "station"]
        );
    }

    #[test]
    fn shared_talk_publishes_the_claimed_target_reply_and_replays_it() {
        let path =
            std::env::temp_dir().join(format!("player-dialogue-{}.sqlite", crate::random_hex(12)));
        let c = store::open(&path).unwrap();
        full_store::schema(&c).unwrap();
        let id = "d".repeat(48);
        store::create(&c, &id, "owner", now()).unwrap();
        let mut world = World::create(None).unwrap();
        world.game.as_object_mut().unwrap().remove("opening");
        let mut command = full::Command {
            op: "claim".into(),
            avatar: None,
            action: Value::Null,
            target: None,
            key: String::new(),
            moving: false,
            surface: "browser".into(),
            revealed: None,
        };
        for actor in ["vale", "rue", "mara"] {
            world.game["actors"][actor]["place"] = json!("station");
        }
        full_store::seed(&c, &id, &world, "player-dialogue", now()).unwrap();
        for actor in ["vale", "rue", "mara"] {
            command.avatar = Some(actor.into());
            full::run(&c, &id, actor, &command, now()).unwrap();
        }
        let world = full_store::world(&c, &id, now()).unwrap();
        command.op = "play".into();
        command.avatar = None;
        command.key = "shared-player-dialogue".into();
        command.action = world.project(actor_index("vale").unwrap()).unwrap()["actions"]
            .as_array()
            .unwrap()
            .iter()
            .find(|action| action["kind"] == "talk" && action["target"] == "rue")
            .unwrap()
            .clone();
        full::run(&c, &id, "vale", &command, now()).unwrap();
        let app = crate::test_app_state(Some(path));
        let work = full::take_work(&app, &id).unwrap().unwrap();
        let (_, ids) = prepared(work.actor, &work.context).unwrap();
        assert_eq!(ids, vec!["vale", "rue"]);
        let reply = "The timetable has me curious.";
        let entries = json!({"entries":[
            {"id":"vale","text":"What caught your eye?"},
            {"id":"rue","text":reply},
            {"id":"mara","text":"I am here too."}
        ]});
        let lines = parse(&entries.to_string(), &work.context, &ids).unwrap();
        let committed = full_store::world(&c, &id, now()).unwrap();
        full::finish_work(&app, &id, work, Ok(lines)).unwrap();
        let expected = full_store::world(&c, &id, now()).unwrap();
        assert_eq!(expected.claimed, committed.claimed);
        assert_eq!(expected.present, committed.present);
        for key in ["turn", "items"] {
            assert_eq!(expected.game[key], committed.game[key]);
        }
        for actor in ["vale", "rue", "mara"] {
            assert_eq!(
                store::member(&c, &id, actor).unwrap(),
                Some(actor_index(actor).unwrap() as i32)
            );
            let view = full_store::snapshot(&c, &id, actor, now()).unwrap();
            let lines = &view["history"][0]["lines"];
            assert_eq!(lines.as_array().unwrap().len(), 2);
            assert_eq!(lines[1]["actorId"], "rue");
            assert_eq!(lines[1]["text"], reply);
        }
        assert_eq!(
            crate::routes::shared_voice_line(&c, &id, &command.key, 1).unwrap(),
            Some(("rue".into(), reply.into()))
        );
        c.execute("DELETE FROM card_full_checkpoints", []).unwrap();
        assert_eq!(full_store::world(&c, &id, now()).unwrap(), expected);
    }
    #[test]
    fn shared_scenes_voice_only_their_given_speakers() {
        let mut work = json!({"room":"station","context":{"location":"station","speakers":["pip"],"scenery":false,"outcome":{"card":{"kind":"give","target":"pip","accepted":false}}},"profiles":{"vale":{"name":"Vale","kind":"avatar"},"pip":{"name":"Pip","kind":"avatar"},"station":{"name":"Empty station","kind":"location"}}});
        let (_, ids) = prepared(0, &work).unwrap();
        assert_eq!(ids, vec!["pip"]);
        let refused = parse(
            r#"{"entries":[{"id":"pip","text":"Not that one."}]}"#,
            &work,
            &ids,
        )
        .unwrap();
        assert_eq!(refused[0]["entityId"], "pip");
        // A refuser whose words do not come leaves the scene with no lines.
        let none = parse(r#"{"entries":[]}"#, &work, &ids).unwrap();
        assert_eq!(none, json!([]));
        assert_eq!(silent(&work, 0, &none), vec!["pip"]);
        work["context"]["speakers"] = json!([]);
        assert!(prepared(0, &work).unwrap().1.is_empty());
        work["context"]["scenery"] = json!(true);
        let (_, place) = prepared(0, &work).unwrap();
        assert_eq!(place, vec!["station"]);
        assert!(parse(
            r#"{"entries":[{"id":"station","text":"Dust settles."}]}"#,
            &work,
            &place
        )
        .is_ok());
    }
    #[test]
    fn quiet_shared_turns_keep_the_actor_and_legacy_exchanges() {
        let mut work = json!({"room":"station","context":{"location":"station","speakers":["vale"],"scenery":false,"outcome":{"card":{"target":null}}},"profiles":{"vale":{"name":"Vale","kind":"avatar"},"station":{"name":"Empty station","kind":"location"}}});
        let (_, ids) = prepared(0, &work).unwrap();
        assert_eq!(ids, vec!["vale"]);
        let response = r#"{"entries":[{"id":"vale","text":"I can wait here."}]}"#;
        assert_eq!(
            parse(response, &work, &ids)
                .unwrap()
                .as_array()
                .unwrap()
                .len(),
            1
        );
        work["context"]["scenery"] = json!(true);
        let (_, scenic) = prepared(0, &work).unwrap();
        assert_eq!(scenic, vec!["vale", "station"]);
        assert!(parse(response, &work, &scenic).is_ok());
        let place = r#"{"entries":[{"id":"station","text":"Dust settles."}]}"#;
        let place = parse(place, &work, &scenic).unwrap();
        assert_eq!(place[0]["entityId"], "station");
        assert_eq!(silent(&work, 0, &place), vec!["vale"]);
        let twice = r#"{"entries":[{"id":"vale","text":"I can wait."},{"id":"vale","text":"I can wait."}]}"#;
        assert_eq!(parse(twice, &work, &scenic).unwrap(), json!([]));
        assert!(parse("not json", &work, &scenic).is_err());
        work["context"].as_object_mut().unwrap().remove("scenery");
        assert_eq!(prepared(0, &work).unwrap().1, scenic);
    }
}
