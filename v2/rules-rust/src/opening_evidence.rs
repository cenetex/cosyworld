use serde_json::{json, Map, Value};
use std::collections::BTreeSet;

const KEEPER: &str = "keeper";
const MOTH: &str = "moth";
const STATION: &str = "station";

const MEMORY_LIMIT: usize = 16;
const LOG_LIMIT: usize = 100;

pub(super) fn remember_moment(events: &mut Vec<Value>, moment: &Value) {
    if !events.iter().any(|event| event["seq"] == moment["seq"]) {
        events.push(moment.clone());
        events.drain(..events.len().saturating_sub(MEMORY_LIMIT));
    }
}

pub(super) fn trim_log(log: &mut Vec<Value>) {
    while log
        .iter()
        .filter(|entry| entry["generated"] != true)
        .count()
        > LOG_LIMIT
    {
        let last = log
            .iter()
            .rposition(|entry| entry["generated"] != true)
            .unwrap_or_default();
        let oldest = log[..last]
            .iter()
            .position(|entry| {
                entry["generated"] != true
                    && matches!(entry["kind"].as_str(), Some("input" | "hint"))
            })
            .or_else(|| log.iter().position(|entry| entry["generated"] != true));
        let Some(oldest) = oldest else {
            break;
        };
        log.remove(oldest);
    }
    let generated = log
        .iter()
        .filter(|entry| entry["generated"] == true)
        .count();
    let mut excess = generated.saturating_sub(LOG_LIMIT);
    let mut authoritative = false;
    log.retain(|entry| {
        if entry["generated"] != true {
            authoritative = true;
            return true;
        }
        if !authoritative || excess > 0 {
            excess = excess.saturating_sub(1);
            return false;
        }
        true
    });
}

fn new_memories(profiles: &Map<String, Value>) -> Map<String, Value> {
    profiles
        .iter()
        .map(|(id, profile)| {
            let mut memory = json!({"events":[], "landmarks":[], "text":null, "turn":null});
            if profile["kind"] == "avatar" {
                memory["seen"] = json!({});
                memory["subjects"] = json!({});
            }
            (id.to_owned(), memory)
        })
        .collect()
}

pub(super) fn remember(
    memories: &mut Map<String, Value>,
    profiles: &Map<String, Value>,
    entry: &Value,
) -> Option<()> {
    let seq = entry["seq"].as_u64()?;
    let turn = entry["turn"].as_u64()?;
    let place = entry["locationId"].as_str()?;
    let actor = entry["actorId"].as_str();
    let target = entry["targetId"].as_str();
    let cast: Vec<_> = entry["cast"]
        .as_array()?
        .iter()
        .map(Value::as_str)
        .collect::<Option<_>>()?;
    let avatar = |id: &str| {
        profiles
            .get(id)
            .is_some_and(|profile| profile["kind"] == "avatar")
    };
    let items: Vec<_> = entry["items"]
        .as_array()?
        .iter()
        .map(|item| Some((item["id"].as_str()?, item["holder"].as_str()?)))
        .collect::<Option<_>>()?;
    let text = format!(
        "{}: {}",
        entry["speaker"].as_str()?,
        entry["text"].as_str()?
    );
    if text.encode_utf16().count() > 650 {
        return None;
    }
    let moment = json!({"seq":seq, "turn":turn, "kind":"event", "text":text});
    let related = std::iter::once(place)
        .chain(actor)
        .chain(target)
        .chain(cast.iter().copied())
        .chain(items.iter().map(|(id, _)| *id))
        .collect::<BTreeSet<_>>();
    for id in related {
        let Some(memory) = memories.get_mut(id) else {
            continue;
        };
        remember_moment(memory["events"].as_array_mut()?, &moment);
        if !avatar(id) || !cast.contains(&id) {
            continue;
        }
        let company: Vec<_> = cast
            .iter()
            .copied()
            .filter(|other| *other != id && avatar(other))
            .take(4)
            .collect();
        let things: Vec<_> = items
            .iter()
            .filter_map(|(item, holder)| (*holder == place).then_some(*item))
            .take(4)
            .collect();
        let sight = |holder, company: &[&str], things: &[&str]| json!({"seq":seq, "turn":turn, "place":place, "holder":holder, "company":company,"things":things});
        memory["subjects"][place]["sight"] = sight(None, &company, &things);
        for other in company {
            memory["seen"][other] = json!({"place":place,"turn":turn,"seq":seq});
            memory["subjects"][other]["sight"] = sight(None, &[], &[]);
        }
        for (item, holder) in &items {
            if profiles
                .get(*item)
                .is_some_and(|profile| profile["kind"] == "item")
                && (*holder == place || cast.contains(holder))
            {
                memory["subjects"][*item]["sight"] = sight(Some(*holder), &[], &[]);
            }
        }
        if entry["verb"] == "talk" {
            let other = match (actor, target) {
                (Some(speaker), Some(listener)) if id == speaker => listener,
                (Some(speaker), Some(listener)) if id == listener => speaker,
                _ => continue,
            };
            let deed = json!({
                "seq":seq,"turn":turn,"verb":"talk","actorId":actor,"targetId":target,
                "itemId":null,"receiveId":null,"ownerId":null,"locationId":place,"accepted":null,
            });
            for subject in [other, place] {
                memory["subjects"][subject]["deeds"] = json!([deed]);
            }
        }
    }
    Some(())
}

fn call_lead(want: &Value, forest: &Value, place: &str, knowledge: &mut Value) -> Option<Value> {
    let target = want["target"].as_str()?;
    let who = forest["people"][KEEPER]["name"].as_str()?;
    let cloth = forest["things"]["cloth"]["name"].as_str()?;
    let lamp = forest["things"]["lamp"]["name"].as_str()?;
    let pond = forest["places"][target]["name"].as_str()?;
    let id = format!("quest:{KEEPER}:{target}");
    let text = format!("{who} wants you to call the ship: hold {cloth} at {pond} while {lamp} burns on the ground there.");
    knowledge["facts"][&id] = json!({
        "id":id,"text":text,"source":{
            "kind":"quest","eventSeq":2,"turn":0,"actorId":KEEPER,
            "locationId":place,"witnesses":[],"topic":null,
        },
    });
    knowledge["known"][MOTH][&id] = json!({
        "kind":"heard","teller":KEEPER,"eventSeq":2,"learnedTurn":0,
    });
    Some(json!({
        "seq":2,"turn":0,"speaker":"World",
        "text":"Before Vale arrived, the keeper told Pip how to call the ship.",
        "kind":"action","verb":"talk","actorId":KEEPER,"targetId":MOTH,
        "locationId":STATION,"cast":[KEEPER,MOTH],"witnesses":[KEEPER,MOTH],"items":[],"light":false,
    }))
}

pub fn install(world: &mut Value, files: &Value) -> Option<()> {
    let forest = &files["v2/card-game/forest.json"];
    let mut log = forest["opening"]["log"].as_array()?.clone();
    if log.len() != 1
        || log[0]["seq"] != 1
        || log[0]["turn"] != 0
        || log[0]["kind"] != "narration"
        || world["turn"] != 0
        || world["opening"]["crossed"] != false
        || world["actors"]["vale"]["place"] != "attic"
        || world["items"]["lamp"]["holder"] != "vale"
    {
        return None;
    }
    let profiles = super::profiles::project(files)?;
    let profiles = profiles.as_object()?;
    let mut memories = new_memories(profiles);
    remember(&mut memories, profiles, &log[0])?;
    let mut knowledge = json!({"version":1,"facts":{},"known":{},"pending":[]});
    let actors = world["actors"].as_object()?;
    let keeper = actors.get(KEEPER)?;
    let calls_ship = keeper["want"]["step"]["verb"] == "call";
    if calls_ship {
        let lead = call_lead(
            &keeper["want"],
            forest,
            keeper["place"].as_str()?,
            &mut knowledge,
        )?;
        remember(&mut memories, profiles, &lead)?;
        log.push(lead);
        let existing = actors.get(MOTH)?.as_object()?;
        let prior = existing.get("told").and_then(Value::as_array);
        let mut told = prior
            .into_iter()
            .flatten()
            .filter_map(Value::as_str)
            .filter(|id| *id != MOTH && actors.contains_key(*id))
            .map(str::to_owned)
            .collect::<BTreeSet<_>>();
        told.insert(KEEPER.into());
        world["actors"][MOTH]["told"] = json!(told);
    }
    world["eventSeq"] = log.last()?["seq"].clone();
    world["log"] = Value::Array(log);
    world["memories"] = Value::Object(memories);
    world["knowledge"] = knowledge;
    Some(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{path::Path, process::Command};

    #[test]
    fn a_new_play_retains_the_latest_event_and_prefers_to_drop_hints() {
        let mut log = (1..=102)
            .map(|seq| json!({"seq":seq, "kind":if seq == 10 { "hint" } else { "action" }}))
            .collect::<Vec<_>>();
        log.insert(0, json!({"seq":0, "generated":true}));
        trim_log(&mut log);
        assert_eq!(log.len(), 100);
        assert_eq!(log.first().unwrap()["seq"], 2);
        assert_eq!(log.last().unwrap()["seq"], 102);
        assert!(log.iter().all(|entry| entry["seq"] != 10));

        let mut events = (1..=16).map(|seq| json!({"seq":seq})).collect::<Vec<_>>();
        remember_moment(&mut events, &json!({"seq":16}));
        assert_eq!(events[0]["seq"], 1);
        remember_moment(&mut events, &json!({"seq":17}));
        assert_eq!(events.len(), 16);
        assert_eq!(events[0]["seq"], 2);
        assert_eq!(events[15]["seq"], 17);
    }

    #[test]
    fn opening_evidence_matches_fresh_pinned_worlds() {
        let root = Path::new(env!("CARGO_MANIFEST_DIR")).join("../..");
        let script = r#"
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { currentSharedEngine } from './test/fixtures/shared-engine.mjs';
const engine = currentSharedEngine();
const {files} = JSON.parse(readFileSync('v2/orchestrator-rust/src/card_shared/content.json'));
const variants = [{}, {seed: 0}, {seed: 17}, {seed: 4242},
  {seed: 4294967295, homecoming: 'ada', hidden: 'mara', absent: ['ash', 'nell']}];
const worlds = variants.map((variant) => {
  const {ok, world, error} = JSON.parse(engine.cardShared(JSON.stringify({op: 'create', ...variant})));
  assert.equal(ok, true, error);
  const {memories, knowledge, log, eventSeq, actors: {moth: {told}}} = world;
  return {memories, knowledge, log, eventSeq, told};
});
console.log(JSON.stringify({files, worlds}));
"#;
        let output = Command::new("node")
            .args(["--input-type=module", "--eval", script])
            .current_dir(root)
            .output()
            .expect("Node runs the pinned JavaScript reducer");
        assert!(
            output.status.success(),
            "{}",
            String::from_utf8_lossy(&output.stderr)
        );
        let fixture: Value = serde_json::from_slice(&output.stdout).unwrap();
        let files = &fixture["files"];
        let forest = &files["v2/card-game/forest.json"];
        let mut world = forest["initialState"].clone();
        world["turn"] = json!(0);
        world["opening"] = forest["opening"]["discovery"].clone();
        for table in ["actors", "items"] {
            for (id, fields) in forest["opening"][table].as_object().unwrap() {
                world[table][id]
                    .as_object_mut()
                    .unwrap()
                    .extend(fields.as_object().unwrap().clone());
            }
        }
        let mut want = forest["people"][KEEPER]["want"].clone();
        want["since"] = json!(0);
        want["refusals"] = json!(0);
        world["actors"][KEEPER]["want"] = want;
        install(&mut world, files).unwrap();
        for expected in fixture["worlds"].as_array().unwrap() {
            for key in ["knowledge", "log", "eventSeq"] {
                assert_eq!(world[key], expected[key], "opening {key}");
            }
            assert_eq!(world["actors"][MOTH]["told"], expected["told"]);
            let expected_memories = expected["memories"].as_object().unwrap();
            assert_eq!(
                world["memories"].as_object().unwrap().len(),
                expected_memories.len()
            );
            for (id, expected) in expected_memories {
                assert_eq!(&world["memories"][id], expected, "{id} memory");
            }
        }
    }
}
