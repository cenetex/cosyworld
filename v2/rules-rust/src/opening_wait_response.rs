use super::{lamp_state, opening, opening_play, opening_play::Mirror, opening_view, profiles};
use serde_json::{json, Value};

const ACTOR: &str = "vale";
const ROOM: &str = "attic";

pub fn completed_wait_response(
    world: Value,
    files: &Value,
    before_seq: u64,
    present: &[&str],
) -> Option<Value> {
    completed_wait_response_with_profiles(world, files, before_seq, present, || {
        profiles::project(files)
    })
}

pub(super) fn completed_wait_response_with_profiles(
    mut world: Value,
    files: &Value,
    before_seq: u64,
    present: &[&str],
    projected: impl FnOnce() -> Option<Value>,
) -> Option<Value> {
    first_wait_attic(&world)?;
    if !present.contains(&ACTOR) {
        return None;
    }
    opening_play::attic_content(files)?;
    if opening_view::other_attic_content(files)? {
        return None;
    }
    let mirror = opening_view::attic_mirror(&world, present)?;
    let events = released_events(&world, before_seq)?;
    let speech = &files["v2/card-game/speech.json"];
    let met = events
        .iter()
        .any(|entry| entry["verb"] == "want_met" && entry["actorId"] == ACTOR);
    if speech["first_wait"] != json!(["actor"])
        || (met && speech["want_met"] != json!(["met", "giver"]))
        || files["v2/card-game/entity-profiles.json"][ACTOR]["kind"] != "avatar"
    {
        return None;
    }
    apply_vale_voice(&mut world)?;

    let mut response = opening_play::after_wait_response_with_profiles(
        opening::stored_response(world)?,
        files,
        mirror,
        projected()?,
    )?;
    response["events"] = json!(events);
    Some(response)
}

pub fn completed_second_wait_response(
    world: Value,
    files: &Value,
    before_seq: u64,
    present: &[&str],
) -> Option<Value> {
    completed_second_wait_response_with_profiles(world, files, before_seq, present, || {
        profiles::project(files)
    })
}

pub(super) fn completed_second_wait_response_with_profiles(
    mut world: Value,
    files: &Value,
    before_seq: u64,
    present: &[&str],
    projected: impl FnOnce() -> Option<Value>,
) -> Option<Value> {
    if present != [ACTOR] || settled_second_wait(&world)? != before_seq.checked_add(1)? {
        return None;
    }
    opening_play::attic_content(files)?;
    if opening_view::other_attic_content(files)? {
        return None;
    }
    let mirror = second_wait_mirror(&world, present)?;
    let events = second_wait_events(&world, before_seq)?;
    set_vale_voices(&mut world, &[])?;
    let mut response = opening_play::after_wait_response_with_profiles(
        opening::stored_response(world)?,
        files,
        mirror,
        projected()?,
    )?;
    response["events"] = json!(events);
    Some(response)
}

pub(super) fn settled_second_wait(world: &Value) -> Option<u64> {
    let vale = &world["actors"][ACTOR];
    let lamp = &world["items"]["lamp"];
    let held = vale.get("heldItem")?;
    let fuel = lamp_state(lamp).ok()?;
    if world["schema"] != 8
        || world["sharedVersion"] != 1
        || world["turn"] != 2
        || world.get("began").is_some()
        || !(2..=opening::MAX_REVISION).contains(&world["revision"].as_u64()?)
        || world["opening"]["crossed"] != false
        || ["absent", "hidden", "homecoming", "disabledPacks", "gone"]
            .iter()
            .any(|key| !world[*key].is_null())
        || !world["placeCard"][ROOM].is_null()
        || !world["defeats"][ACTOR].is_null()
        || vale["place"] != ROOM
        || vale.get("want") != Some(&Value::Null)
        || vale["waitSpeech"] != json!({"place":ROOM,"turn":1})
        || (!held.is_null() && held != "lamp")
        || fuel.fuel_place != ROOM
        || !fuel.fuel_visit
        || lamp["lit"] != (held == "lamp" && fuel.fuel_rooms > 0)
        || lamp["fuel"] != fuel.fuel_rooms * 4
    {
        return None;
    }
    opening_play::quiet_attic(world)?;
    let log = world["log"].as_array()?;
    let mut actions = log.iter().filter(|entry| vale_action(entry));
    let first = actions.next()?;
    let second = actions.next()?;
    let seq = second["seq"].as_u64()?;
    if actions.next().is_some()
        || !ordinary_attic_wait(first)
        || first["turn"] != 1
        || first["seq"].as_u64()? >= seq
        || !ordinary_attic_wait(second)
        || second["turn"] != 2
        || log.iter().any(|entry| {
            entry["turn"] == 2
                && entry["seq"] != seq
                && entry["generated"] != true
                && (entry["locationId"] == ROOM
                    || entry["fromLocationId"] == ROOM
                    || (entry["verb"] == "want_met" && entry["actorId"] == ACTOR))
        })
    {
        return None;
    }
    Some(seq)
}

pub(super) fn second_wait_mirror(world: &Value, present: &[&str]) -> Option<Mirror> {
    let lamp = &world["items"]["lamp"];
    if lamp["fuelRooms"] == 0 {
        return Some(Mirror::Open {
            pond_available: !opening_view::pond_at_capacity(world, present),
        });
    }
    opening_view::attic_mirror(world, present)
}

fn second_wait_events(world: &Value, before_seq: u64) -> Option<Vec<Value>> {
    let mut events = Vec::new();
    let mut last = before_seq;
    for entry in world["log"].as_array()? {
        let seq = entry["seq"].as_u64()?;
        if seq <= before_seq {
            continue;
        }
        if seq <= last || entry["turn"] != 2 || entry["generated"] == true {
            return None;
        }
        events.push(entry.clone());
        last = seq;
    }
    (events.first()?["seq"].as_u64() == before_seq.checked_add(1) && world["eventSeq"] == last)
        .then_some(events)
}

fn first_wait_attic(world: &Value) -> Option<u64> {
    let turn = world["turn"].as_u64()?;
    let began = world.get("began").map_or(Some(0), Value::as_u64)?;
    let vale = &world["actors"][ACTOR];
    if world["schema"] != 8
        || world["sharedVersion"] != 1
        || turn.checked_sub(1) != Some(began)
        || vale["place"] != ROOM
        || vale.get("want") != Some(&Value::Null)
        || vale["waitSpeech"] != json!({"place":ROOM,"turn":turn})
        || !world["placeCard"][ROOM].is_null()
        || !world["defeats"][ACTOR].is_null()
        || world["absent"]
            .as_array()
            .is_some_and(|ids| ids.iter().any(|id| id == ACTOR))
    {
        return None;
    }
    opening_play::quiet_attic(world)?;
    Some(turn)
}

pub(super) fn settled_first_wait(world: &Value) -> Option<u64> {
    let turn = first_wait_attic(world)?;
    let mut actions = world["log"]
        .as_array()?
        .iter()
        .filter(|entry| vale_action(entry));
    let wait = actions.next()?;
    (ordinary_attic_wait(wait) && wait["turn"] == turn && actions.next().is_none()).then_some(turn)
}

pub(super) fn vale_action(entry: &Value) -> bool {
    entry["kind"] == "action" && entry["actorId"] == ACTOR && entry["generated"] != true
}

pub(super) fn ordinary_attic_wait(entry: &Value) -> bool {
    vale_action(entry)
        && entry["locationId"] == ROOM
        && entry["verb"] == "wait"
        && entry["sleep"] != true
        && entry["guards"].is_null()
}

pub(super) fn apply_vale_voice(world: &mut Value) -> Option<()> {
    set_vale_voices(world, &[ACTOR])
}

fn set_vale_voices(world: &mut Value, voices: &[&str]) -> Option<()> {
    world
        .as_object_mut()?
        .entry("speechVoices")
        .or_insert_with(|| json!({}))
        .as_object_mut()?
        .insert(ACTOR.into(), json!(voices));
    Some(())
}

fn released_events(world: &Value, before_seq: u64) -> Option<Vec<Value>> {
    let log = world["log"].as_array()?;
    let mut released = Vec::new();
    let mut last = before_seq;
    for entry in log {
        let seq = entry["seq"].as_u64()?;
        if vale_action(entry) && seq != before_seq.checked_add(1)? {
            return None;
        }
        if seq <= before_seq {
            continue;
        }
        let touches_attic = entry["locationId"] == ROOM || entry["fromLocationId"] == ROOM;
        if seq <= last
            || entry["turn"] != world["turn"]
            || (touches_attic
                && (entry["actorId"] != ACTOR
                    || entry["fromLocationId"] == ROOM
                    || !matches!(entry["verb"].as_str(), Some("wait" | "want_met"))))
        {
            return None;
        }
        released.push(entry.clone());
        last = seq;
    }
    let wait = released.first()?;
    if wait["seq"].as_u64() != before_seq.checked_add(1)
        || !ordinary_attic_wait(wait)
        || world["eventSeq"].as_u64() != Some(last)
    {
        return None;
    }
    Some(released)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{path::Path, process::Command};

    #[test]
    fn projects_the_complete_pinned_first_wait_response() {
        let root = Path::new(env!("CARGO_MANIFEST_DIR")).join("../..");
        let content: Value = serde_json::from_str(include_str!(
            "../../orchestrator-rust/src/card_shared/content.json"
        ))
        .unwrap();
        let script = r#"
import assert from 'node:assert/strict';
import { currentSharedEngine } from './test/fixtures/shared-engine.mjs';
const engine = currentSharedEngine();
const reduce = (request) => {
  const result = JSON.parse(engine.cardShared(JSON.stringify(request)));
  assert.equal(result.ok, true, result.error);
  return result;
};
const variants = [
  {}, { seed: 42, history: true }, { seed: 4294967295, history: true },
  { seed: 17, history: true, hidden: 'mara', absent: ['ash'] },
];
for (const options of variants) {
  for (const stowed of [false, true]) {
    for (const full of stowed && !options.hidden ? [false, true] : [false]) {
      let { world } = reduce({ op: 'create', ...options });
      const others = full ? ['mara', 'ash', 'nell', 'tavi'] : [];
      for (const id of others) world.actors[id].place = 'pond';
      const present = ['vale', ...others];
      const seats = { actor: 'vale', claimed: present, present };
      if (stowed) {
        world = reduce({ ...seats, op: 'hold', world, choice: {item: null, revision: world.revision} }).world;
      }
      world.speechVoices = { mara: ['mara'] };
      const expected = reduce({ ...seats, op: 'play', world, action: 'wait:vale::' });
      console.log(JSON.stringify({
        expected, present, voices: world.speechVoices, beforeSeq: world.eventSeq,
        title: { options, stowed, full },
      }));
    }
  }
}
"#;
        let output = Command::new("node")
            .args(["--input-type=module", "--eval", script])
            .current_dir(root)
            .output()
            .expect("Node runs the pinned reducer");
        assert!(
            output.status.success(),
            "{}",
            String::from_utf8_lossy(&output.stderr)
        );
        let lines = String::from_utf8(output.stdout).unwrap();
        assert_eq!(lines.lines().count(), 11);
        for line in lines.lines() {
            let case: Value = serde_json::from_str(line).unwrap();
            let expected = &case["expected"];
            let mut progressed = expected["world"].clone();
            progressed["speechVoices"] = case["voices"].clone();
            progressed["playerActorId"] = json!("vale");
            for field in ["heldActors", "controlledActors", "presentActors"] {
                progressed[field] = case["present"].clone();
            }
            let files = &content["files"];
            let present = opening::seats(&case["present"]).unwrap();
            let before_seq = case["beforeSeq"].as_u64().unwrap();
            assert!(completed_wait_response(progressed.clone(), files, before_seq, &[]).is_none());
            let actual = completed_wait_response(progressed, files, before_seq, &present)
                .unwrap_or_else(|| panic!("Unsupported wait response for {}", case["title"]));
            for (field, value) in expected.as_object().unwrap() {
                assert_eq!(&actual[field], value, "{field} for {}", case["title"]);
            }
            assert_eq!(
                actual.as_object().unwrap().len(),
                expected.as_object().unwrap().len()
            );
        }
    }

    #[test]
    fn projects_the_pinned_second_wait_reply_and_private_view() {
        const PACK: &str = include_str!("../../orchestrator-rust/src/card_shared/content.json");
        let content: Value = serde_json::from_str(PACK).unwrap();
        let root = Path::new(env!("CARGO_MANIFEST_DIR")).join("../..");
        let script = r#"
import assert from 'node:assert/strict';
import { currentSharedEngine } from './test/fixtures/shared-engine.mjs';
const engine = currentSharedEngine();
const pinned = (request) => {
  const result = JSON.parse(engine.cardShared(JSON.stringify(request)));
  assert.equal(result.ok, true, result.error);
  return result;
};
const seats = { actor: 'vale', claimed: ['vale'], present: ['vale'] };
const wait = (world) => pinned({...seats, op:'play', world, action:'wait:vale::'});
for (const [seed, voiced] of [[17, false], [2, true], [4242, true]]) {
  for (const mode of ['held', 'stowed', 'dry']) {
    let {world} = pinned({op:'create', seed});
    if (mode === 'stowed')
      world = pinned({...seats, op:'hold', world, choice:{item:null, revision:world.revision}}).world;
    if (mode === 'dry')
      Object.assign(world.items.lamp, {fuel:0, fuelRooms:0, lit:false});
    world.speechVoices = {mara:['mara']};
    world = wait(world).world;
    assert.deepEqual(world.speechVoices.vale, ['vale']);
    if (voiced) world = pinned({...seats, op:'speech', room:'attic', world, entries:[], lines:[
      {entityId:'attic', actorId:null, text:'The attic grows quiet.'},
      {entityId:'vale', actorId:'vale', text:'I can wait a little longer.'},
    ]}).world;
    const expected = wait(world);
    assert.deepEqual(expected.world.speechVoices, {mara:['mara'], vale:[]});
    assert.deepEqual(expected.world.actors.vale.waitSpeech, {place:'attic', turn:1});
    assert.equal(expected.events.length, seed === 17 ? 1 : 2);
    if (voiced) assert.ok(expected.world.log.some(event => event.generated));
    const present = mode === 'dry' ? [] : ['vale'];
    const view = pinned({...seats, present, op:'view', world:expected.world});
    console.log(JSON.stringify({
      expected, view, present, voices:world.speechVoices, beforeSeq:world.eventSeq, title:{seed, mode},
    }));
  }
}
"#;
        let output = Command::new("node")
            .args(["--input-type=module", "--eval", script])
            .current_dir(root)
            .output()
            .expect("Node runs the pinned reducer");
        assert!(
            output.status.success(),
            "{}",
            String::from_utf8_lossy(&output.stderr)
        );
        let lines = String::from_utf8(output.stdout).unwrap();
        assert_eq!(lines.lines().count(), 9);
        for line in lines.lines() {
            let case: Value = serde_json::from_str(line).unwrap();
            let expected = &case["expected"];
            let saved = &expected["world"];
            let mut progressed = saved.clone();
            progressed["speechVoices"] = case["voices"].clone();
            progressed["playerActorId"] = json!(ACTOR);
            for field in ["heldActors", "controlledActors", "presentActors"] {
                progressed[field] = json!([ACTOR]);
            }
            let files = &content["files"];
            let before_seq = case["beforeSeq"].as_u64().unwrap();
            assert!(completed_second_wait_response(
                progressed.clone(),
                files,
                before_seq - 1,
                &[ACTOR]
            )
            .is_none());
            let actual = completed_second_wait_response(progressed, files, before_seq, &[ACTOR])
                .unwrap_or_else(|| panic!("Unsupported second Wait {}", case["title"]));
            for (key, expected) in expected.as_object().unwrap() {
                assert_eq!(&actual[key], expected, "{key} for {}", case["title"]);
            }
            assert_eq!(
                actual.as_object().unwrap().len(),
                expected.as_object().unwrap().len()
            );
            let view = crate::reduce(&json!({
                "op":"view", "world":saved, "actor":ACTOR, "claimed":[ACTOR],
                "present":case["present"], "packContentJson":PACK,
            }));
            let expected = &case["view"];
            for (key, expected) in expected.as_object().unwrap() {
                assert_eq!(&view[key], expected, "view {key} for {}", case["title"]);
            }
            assert_eq!(
                view.as_object().unwrap().len(),
                expected.as_object().unwrap().len()
            );
        }
    }
}
