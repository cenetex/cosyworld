use serde_json::{json, Map, Value};
use std::collections::BTreeSet;

const KEEPER: &str = "keeper";
const MOTH: &str = "moth";
const STATION: &str = "station";

const MEMORY_LIMIT: usize = 16;
const LANDMARK_LIMIT: usize = 6;
const LOG_LIMIT: usize = 100;

pub(super) fn remember_moment(events: &mut Vec<Value>, moment: &Value) -> bool {
    if events.iter().any(|event| event["seq"] == moment["seq"]) {
        return false;
    }
    events.push(moment.clone());
    events.drain(..events.len().saturating_sub(MEMORY_LIMIT));
    true
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
    remember_for_seats(memories, profiles, entry, &[], &[])
}

pub(super) fn remember_for_seats(
    memories: &mut Map<String, Value>,
    profiles: &Map<String, Value>,
    entry: &Value,
    controlled: &[Value],
    present: &[Value],
) -> Option<()> {
    let seq = entry["seq"].as_u64()?;
    let turn = entry["turn"].as_u64()?;
    let place = entry["locationId"].as_str()?;
    let keys = [
        "actorId",
        "targetId",
        "fromLocationId",
        "entityId",
        "itemId",
        "receiveId",
    ];
    let actor = entry["actorId"].as_str();
    let target = entry["targetId"].as_str();
    let cast = room_ids(&entry["cast"]);
    let witnesses = room_ids(&entry["witnesses"]);
    let kind = |id: &str, kind: &str| profiles.get(id).is_some_and(|v| v["kind"] == kind);
    let known = |id: &str| profiles.contains_key(id);
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
    let generated = entry["generated"] == true;
    let moment_kind = if generated { "expression" } else { "event" };
    let moment = json!({"seq":seq,"turn":turn,"kind":moment_kind,"text":text});
    let related = std::iter::once(place)
        .chain(keys.into_iter().filter_map(|key| entry[key].as_str()))
        .chain(witnesses.iter().copied())
        .chain(cast.iter().copied())
        .chain(items.iter().map(|(id, _)| *id))
        .collect::<BTreeSet<_>>();
    let items: Vec<_> = items
        .into_iter()
        .filter(|(id, holder)| kind(id, "item") && (*holder == place || cast.contains(holder)))
        .collect();
    for id in related.into_iter().filter(|id| known(id)) {
        let mine = actor == Some(id);
        let avatar = kind(id, "avatar");
        if avatar
            && !mine
            && controlled.iter().any(|seat| seat == id)
            && !present.iter().any(|seat| seat == id)
        {
            continue;
        }
        let memory = memories.get_mut(id)?;
        let added = remember_moment(memory["events"].as_array_mut()?, &moment);
        if added && entry["kind"] == "action" && entry["verb"] == "give" {
            if memory["landmarks"].is_null() {
                memory["landmarks"] = json!([]);
            }
            let landmarks = memory["landmarks"].as_array_mut()?;
            landmarks.push(moment.clone());
            landmarks.drain(..landmarks.len().saturating_sub(LANDMARK_LIMIT));
        }
        let visible = cast.contains(&id);
        if !avatar || !(visible || mine || witnesses.contains(&id)) {
            continue;
        }
        let company: Vec<_> = cast
            .iter()
            .copied()
            .filter(|other| *other != id && kind(other, "avatar"))
            .collect();
        if visible {
            for other in &company {
                if memory["seen"][*other]["seq"].as_u64().unwrap_or(0) < seq {
                    memory["seen"][*other] = json!({"place":place,"turn":turn,"seq":seq});
                }
            }
        }
        if generated {
            continue;
        }
        let subjects = memory["subjects"].as_object_mut()?;
        if known(place) && (visible || mine) {
            let things: Vec<_> = items
                .iter()
                .filter_map(|(item, holder)| (*holder == place).then_some(*item))
                .take(4)
                .collect();
            let mut observe = |subject: &str, holder, company: &[&str], things: &[&str]| {
                let record = subjects.entry(subject).or_insert_with(|| json!({}));
                if record["sight"]["seq"].as_u64().unwrap_or(0) < seq {
                    record["sight"] = json!({"seq":seq,"turn":turn,"place":place,"holder":holder,"company":company,"things":things});
                }
            };
            if place != id {
                observe(place, None, &company[..company.len().min(4)], &things);
            }
            for other in company {
                observe(other, None, &[], &[]);
            }
            for (item, holder) in &items {
                observe(item, known(holder).then_some(*holder), &[], &[]);
            }
        }
        if matches!(
            entry["verb"].as_str(),
            Some("talk" | "take" | "drop" | "read" | "want_met" | "ask" | "give")
        ) && (mine || target == Some(id))
        {
            let reference = |value: Option<&str>| json!(value.filter(|id| known(id)));
            let item = entry["itemId"]
                .as_str()
                .or_else(|| target.filter(|id| kind(id, "item")));
            let deed = json!({
                "seq":seq,"turn":turn,"verb":entry["verb"],"actorId":reference(actor),
                "targetId":reference(target),"itemId":reference(item),
                "receiveId":reference(entry["receiveId"].as_str()),"ownerId":reference(entry["ownerId"].as_str()),
                "locationId":reference(Some(place)),"accepted":entry["accepted"].as_bool(),
            });
            for subject in [
                if mine { target } else { actor },
                item,
                deed["receiveId"].as_str(),
                deed["ownerId"].as_str(),
                Some(place),
            ]
            .into_iter()
            .flatten()
            .filter(|subject| *subject != id && known(subject))
            {
                let record = subjects.entry(subject).or_insert_with(|| json!({}));
                remember_deed(record, &deed)?;
            }
        }
        trim_subjects(subjects);
    }
    Some(())
}

fn room_ids(value: &Value) -> Vec<&str> {
    value
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(Value::as_str)
        .collect()
}

fn remember_deed(record: &mut Value, deed: &Value) -> Option<()> {
    let deeds = record
        .as_object_mut()?
        .entry("deeds")
        .or_insert_with(|| json!([]));
    let deeds = deeds.as_array_mut()?;
    if !deeds.iter().any(|d| d["seq"] == deed["seq"]) {
        let keys = [
            "verb",
            "actorId",
            "targetId",
            "itemId",
            "receiveId",
            "ownerId",
            "accepted",
        ];
        deeds.retain(|d| keys.iter().any(|key| d[*key] != deed[*key]));
        deeds.push(deed.clone());
        deeds.sort_by_key(|d| std::cmp::Reverse(d["seq"].as_u64()));
        deeds.truncate(2);
    }
    Some(())
}

fn trim_subjects(subjects: &mut Map<String, Value>) {
    if subjects.len() <= 64 {
        return;
    }
    let mut ranked: Vec<_> = subjects
        .iter()
        .map(|(id, record)| {
            let newest = record["deeds"]
                .as_array()
                .into_iter()
                .flatten()
                .filter_map(|deed| deed["seq"].as_u64())
                .chain(record["sight"]["seq"].as_u64())
                .max()
                .unwrap_or(0);
            (std::cmp::Reverse(newest), id.clone())
        })
        .collect();
    ranked.sort_unstable();
    for (_, id) in ranked.into_iter().skip(64) {
        subjects.remove(&id);
    }
}

pub(super) fn keeper_call_goal(cloth: &str, pond: &str, lamp: &str) -> String {
    format!("call the ship: hold {cloth} at {pond} while {lamp} burns on the ground there")
}

fn call_lead(want: &Value, forest: &Value, place: &str, knowledge: &mut Value) -> Option<Value> {
    let target = want["target"].as_str()?;
    let who = forest["people"][KEEPER]["name"].as_str()?;
    let cloth = forest["things"]["cloth"]["name"].as_str()?;
    let lamp = forest["things"]["lamp"]["name"].as_str()?;
    let pond = forest["places"][target]["name"].as_str()?;
    let id = format!("quest:{KEEPER}:{target}");
    let goal = keeper_call_goal(cloth, pond, lamp);
    let text = format!("{who} wants you to {goal}.");
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
