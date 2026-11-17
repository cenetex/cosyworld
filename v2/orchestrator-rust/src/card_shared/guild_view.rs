use rusqlite::{Connection, OpenFlags};
use serde_json::{json, Map, Value};
use std::path::Path;

const LINES: usize = 4;
const MOST: usize = 8;

pub(crate) fn guild_view(guild: &str, residents: &[String]) -> Option<Value> {
    view(&crate::event_store_path_from_env()?, guild, residents)
}

fn ids(all: &Value, key: &str, at: &str, but: &str) -> Vec<Value> {
    all.as_object()
        .into_iter()
        .flatten()
        .filter(|(id, entry)| id.as_str() != but && entry[key] == at)
        .map(|(id, _)| json!(id))
        .take(MOST)
        .collect()
}

fn lines(c: &Connection, world: &str, place: &str) -> Option<Vec<Value>> {
    let mut q = c
        .prepare(
            "SELECT content FROM card_full_scenes WHERE world=? AND room=? \
             ORDER BY seq DESC LIMIT 8",
        )
        .ok()?;
    let scenes = q
        .query_map([world, place], |r| r.get::<_, String>(0))
        .ok()?
        .collect::<Result<Vec<_>, _>>()
        .ok()?;
    let mut said = Vec::new();
    for scene in scenes {
        let scene: Value = serde_json::from_str(&scene).ok()?;
        for line in scene["lines"].as_array().into_iter().flatten().rev() {
            let (speaker, text) = (line["speaker"].as_str(), line["text"].as_str());
            if let (Some(speaker), Some(text), true) = (speaker, text, said.len() < LINES) {
                said.push(json!({"speaker": speaker, "text": text}));
            }
        }
    }
    said.reverse();
    Some(said)
}

fn open(path: &Path, guild: &str, fields: &str) -> Option<(Connection, String, Value)> {
    if guild.is_empty() || !guild.bytes().all(|b| b.is_ascii_digit()) {
        return None;
    }
    let c = Connection::open_with_flags(path, OpenFlags::SQLITE_OPEN_READ_ONLY).ok()?;
    let (world, state): (String, String) = c
        .query_row(
            &format!(
                "SELECT t.id,json_object({fields}) \
                 FROM card_tables t JOIN card_full_checkpoints k ON k.world=t.id \
                 WHERE t.owner=? AND t.retired_at IS NULL ORDER BY t.created DESC,t.id LIMIT 1"
            ),
            [format!("discord-guild:{guild}")],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .ok()?;
    Some((c, world, serde_json::from_str(&state).ok()?))
}

pub(crate) fn guild_talked(guild: &str) -> Option<Vec<String>> {
    talked(&crate::event_store_path_from_env()?, guild)
}

fn talked(path: &Path, guild: &str) -> Option<Vec<String>> {
    let (c, world, _) = open(path, guild, "")?;
    let mut q = c
        .prepare(
            "SELECT json_extract(command,'$.actor'),json_extract(command,'$.action.target') \
             FROM card_full_log WHERE world=? AND json_extract(command,'$.op')='play' \
             AND json_extract(command,'$.action.kind')='talk' ORDER BY seq DESC LIMIT 400",
        )
        .ok()?;
    let talks = q
        .query_map([world], |r| Ok([r.get::<_, Option<String>>(0)?, r.get(1)?]))
        .ok()?
        .collect::<Result<Vec<_>, _>>()
        .ok()?;
    let mut seen: Vec<String> = Vec::new();
    for id in talks.into_iter().flatten().flatten() {
        if !seen.contains(&id) {
            seen.push(id);
        }
    }
    Some(seen)
}

fn view(path: &Path, guild: &str, residents: &[String]) -> Option<Value> {
    let (c, world, state) = open(path, guild, "'game',json_extract(k.state,'$.game')")?;
    let game = &state["game"];
    let (actors, items) = (&game["actors"], &game["items"]);
    let own = super::narrator::own(game, residents).unwrap_or_default();
    let mut seen = Map::new();
    for id in residents {
        let Some(place) = actors[id.as_str()]["place"].as_str() else {
            continue;
        };
        let view = json!({
            "place": place,
            "here": ids(actors, "place", place, id),
            "holds": ids(items, "holder", id, ""),
            "items": ids(items, "holder", place, ""),
            "lines": lines(&c, &world, place)?,
            "own": own.get(id).cloned().unwrap_or_else(|| json!([])),
        });
        seen.insert(id.clone(), view);
    }
    Some(Value::Object(seen))
}

#[cfg(test)]
mod tests {
    use super::super::{full_store, full_world::World, store};
    use super::*;

    const GUILD: &str = "100000000000000001";
    const SECRET: &str = "nobody may hear this thought";

    fn saved(owner: &str) -> (std::path::PathBuf, World) {
        let mut w = World::create(None).unwrap();
        w.game["memories"]["moth"]["innerLife"] =
            json!({"thoughts": [{"turn": 0, "text": SECRET}]});
        w.game["knowledge"]["secret"] = json!(SECRET);
        w.game["actors"]["moth"]["secret"] = json!(SECRET);
        (kept(owner, &w), w)
    }

    fn kept(owner: &str, w: &World) -> std::path::PathBuf {
        let path = std::env::temp_dir().join(format!("card-view-{}.sqlite", crate::random_hex(12)));
        let c = store::open(&path).unwrap();
        full_store::schema(&c).unwrap();
        store::create(&c, "world", owner, 1).unwrap();
        full_store::seed(&c, "world", w, "test-view", 1).unwrap();
        let place = w.game["actors"]["moth"]["place"].as_str().unwrap();
        for n in 1..=6 {
            let lines = json!([{"speaker": "Pip", "text": format!("line {n}"), "reflection": {"thought": SECRET}}]);
            let scene = json!({"lines": lines, "context": SECRET});
            c.execute(
                "INSERT INTO card_full_scenes(world,room,play,content) VALUES('world',?,?,?)",
                rusqlite::params![place, format!("play-{n}"), scene.to_string()],
            )
            .unwrap();
        }
        path
    }

    #[test]
    fn a_resident_sees_its_place_company_things_and_the_last_public_lines() {
        let (path, w) = saved(&format!("discord-guild:{GUILD}"));
        let before = std::fs::read(&path).unwrap();
        let all = view(&path, GUILD, &["moth".into(), "nobody".into()]).unwrap();
        let moth = &all["moth"];
        let place = w.game["actors"]["moth"]["place"].as_str().unwrap();
        assert_eq!(moth["place"], place);
        assert!(all.get("nobody").is_none());
        let here = moth["here"].as_array().unwrap();
        assert!(!here.contains(&json!("moth")));
        assert!(here
            .iter()
            .all(|id| w.game["actors"][id.as_str().unwrap()]["place"] == place));
        let holds = moth["holds"].as_array().unwrap();
        assert!(holds.contains(&json!("cloth")), "{holds:?}");
        assert!(moth["items"]
            .as_array()
            .unwrap()
            .iter()
            .all(|id| w.game["items"][id.as_str().unwrap()]["holder"] == place));
        let said: Vec<&str> = moth["lines"]
            .as_array()
            .unwrap()
            .iter()
            .map(|l| l["text"].as_str().unwrap())
            .collect();
        assert_eq!(said, ["line 3", "line 4", "line 5", "line 6"]);
        assert_eq!(
            moth["lines"][0],
            json!({"speaker": "Pip", "text": "line 3"})
        );
        assert_eq!(std::fs::read(&path).unwrap(), before);
    }

    #[test]
    fn the_view_follows_the_latest_saved_state() {
        let (path, _) = saved(&format!("discord-guild:{GUILD}"));
        let c = store::open(&path).unwrap();
        c.execute(
            "UPDATE card_full_checkpoints SET state=json_set(state,\
             '$.game.items.cloth.holder','vale','$.game.actors.vale.place','greek-courtyard')",
            [],
        )
        .unwrap();
        drop(c);
        let all = view(&path, GUILD, &["moth".into(), "vale".into()]).unwrap();
        assert_eq!(all["vale"]["place"], "greek-courtyard");
        assert_eq!(all["vale"]["lines"], json!([]));
        let holds = |id: &str| {
            all[id]["holds"]
                .as_array()
                .unwrap()
                .contains(&json!("cloth"))
        };
        assert!(holds("vale") && !holds("moth"), "{all}");
    }

    #[test]
    fn private_thoughts_and_unknown_facts_never_leave_the_world() {
        let (path, _) = saved(&format!("discord-guild:{GUILD}"));
        let ids: Vec<String> = ["moth", "vale", "keeper"].map(String::from).into();
        let all = view(&path, GUILD, &ids).unwrap();
        assert_eq!(all.as_object().unwrap().len(), 3);
        assert!(!all.to_string().contains(SECRET));
        let mut keys: Vec<&str> = all["moth"]
            .as_object()
            .unwrap()
            .keys()
            .map(String::as_str)
            .collect();
        keys.sort_unstable();
        assert_eq!(keys, ["here", "holds", "items", "lines", "own", "place"]);
    }

    #[test]
    fn a_resident_knows_its_own_want_and_favours_and_no_one_elses() {
        let mut w = World::create(None).unwrap();
        let pond = w.game["actors"]["moth"]["place"].clone();
        w.game["actors"]["keeper"]["place"] = pond.clone();
        w.game["actors"]["vale"]["place"] = pond;
        w.game["actors"]["moth"]["trust"]["vale"] = json!(2);
        w.game["actors"]["moth"]["secret"] = json!(SECRET);
        w.game["memories"]["moth"]["innerLife"] =
            json!({"persona": null, "thoughts": [{"turn": 0, "text": SECRET}], "dreams": []});
        let path = kept(&format!("discord-guild:{GUILD}"), &w);
        let ids: Vec<String> = ["moth", "keeper", "vale", "greek-baker"]
            .map(String::from)
            .into();
        let all = view(&path, GUILD, &ids).unwrap();
        let baker = json!(["I want the Water Jar laid in Theban Courtyard."]);
        assert_eq!(all["greek-baker"]["own"], baker);
        let favour = "Owes a favour to Vale; willing to share a spare or take a detour with them.";
        assert_eq!(all["moth"]["own"], json!(["I want the Lamp.", favour]));
        assert_eq!(all["keeper"]["own"], json!(["I want the Bell."]));
        assert_eq!(all["vale"]["own"], json!([]));
        assert!(!all["moth"].to_string().contains("Bell."), "{all}");
        assert!(!all["keeper"].to_string().contains("Lamp."), "{all}");
        assert!(!all.to_string().contains(SECRET));
    }

    #[test]
    fn a_server_without_a_world_has_no_view() {
        let (path, _) = saved("ann");
        assert!(view(&path, GUILD, &["moth".into()]).is_none());
        assert!(view(&path, "", &["moth".into()]).is_none());
        assert!(view(&path, "1 OR 1", &["moth".into()]).is_none());
        let missing = std::env::temp_dir().join(format!("none-{}.sqlite", crate::random_hex(12)));
        assert!(view(&missing, GUILD, &["moth".into()]).is_none());
        assert!(talked(&path, GUILD).is_none());
    }

    #[test]
    fn the_talkers_and_the_talked_to_come_most_recent_first_once_each() {
        let (path, _) = saved(&format!("discord-guild:{GUILD}"));
        assert_eq!(talked(&path, GUILD).unwrap(), Vec::<String>::new());
        let c = store::open(&path).unwrap();
        let plays = [
            ("mara", "talk", "keeper"),
            ("mara", "talk", "greek-antigone"),
            ("sage", "take", "rati"),
            ("rue", "talk", "moth"),
            ("mara", "talk", "vale"),
            ("mara", "talk", "keeper"),
        ];
        for (actor, kind, target) in plays {
            let action =
                json!({"op": "play", "actor": actor, "action": {"kind": kind, "target": target}});
            c.execute(
                "INSERT INTO card_full_log(world,command,at) VALUES('world',?,1)",
                [action.to_string()],
            )
            .unwrap();
        }
        c.execute(
            "UPDATE card_full_checkpoints SET state=json_set(state,'$.claimed[5]',1)",
            [],
        )
        .unwrap();
        drop(c);
        assert_eq!(super::super::full_world::actor_id(5), "rue");
        assert_eq!(
            talked(&path, GUILD).unwrap(),
            ["mara", "keeper", "vale", "rue", "moth", "greek-antigone"]
        );
    }

    #[test]
    fn a_real_talk_play_brings_the_chorus_elder_to_the_server() {
        let mut w = World::create(None).unwrap();
        w.game.as_object_mut().unwrap().remove("opening");
        w.game["crossings"]["pond-greek-harbor"]["discovered"] = json!(true);
        w.game["actors"]["vale"]["place"] = json!("greek-well");
        w.game["actors"]["greek-elder"]["place"] = json!("greek-well");
        let path = kept(&format!("discord-guild:{GUILD}"), &w);
        let c = store::open(&path).unwrap();
        for op in ["claim", "enter"] {
            full_store::commit(&c, "world", &mut w, json!({"op":op,"actor":"vale"}), 2).unwrap();
        }
        let talk = w.project(0).unwrap()["actions"]
            .as_array()
            .unwrap()
            .iter()
            .find(|a| a["kind"] == "talk" && a["target"] == "greek-elder")
            .unwrap()
            .clone();
        let play = json!({"op":"play","actor":"vale","action":talk,"surface":"browser"});
        full_store::commit(&c, "world", &mut w, play, 3).unwrap();
        drop(c);
        assert_eq!(talked(&path, GUILD).unwrap(), ["vale", "greek-elder"]);
    }
}
