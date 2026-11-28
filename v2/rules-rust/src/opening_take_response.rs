use super::{
    lamp_state, opening, opening_play, opening_play::Mirror, opening_view, opening_wait_response,
    profiles,
};
use serde_json::{json, Value};

const VALE: &str = "vale";
const ATTIC: &str = "attic";
const LAMP: &str = "lamp";

fn attic_lamp_action(entry: &Value, verb: &str, turn: u64) -> bool {
    entry["verb"] == verb
        && entry["turn"] == turn
        && entry["itemId"] == LAMP
        && entry["locationId"] == ATTIC
        && entry["fromLocationId"] == ATTIC
}

fn mentions_attic(entry: &Value) -> bool {
    entry["locationId"] == ATTIC || entry["fromLocationId"] == ATTIC
}

pub(super) fn settled_take(world: &Value) -> Option<u64> {
    let vale = &world["actors"][VALE];
    let lamp = &world["items"][LAMP];
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
        || !world["placeCard"][ATTIC].is_null()
        || !world["defeats"][VALE].is_null()
        || vale["place"] != ATTIC
        || vale["heldItem"] != LAMP
        || vale.get("want") != Some(&Value::Null)
        || vale["waitSpeech"] != json!({"place":ATTIC,"turn":null})
        || fuel.fuel_place != ATTIC
        || !fuel.fuel_visit
        || lamp["lit"] != (fuel.fuel_rooms > 0)
        || lamp["fuel"] != fuel.fuel_rooms * 4
    {
        return None;
    }
    opening_play::quiet_attic(world)?;
    let log = world["log"].as_array()?;
    let mut actions = log.iter().filter(|entry| {
        entry["kind"] == "action" && entry["actorId"] == VALE && entry["generated"] != true
    });
    let drop = actions.next()?;
    let take = actions.next()?;
    let take_seq = take["seq"].as_u64()?;
    if actions.next().is_some()
        || !attic_lamp_action(drop, "drop", 1)
        || drop["targetId"] != ATTIC
        || drop["seq"].as_u64()? >= take_seq
        || !attic_lamp_action(take, "take", 2)
        || !take["targetId"].is_null()
        || log.iter().any(|entry| {
            entry["turn"] == 2
                && entry["seq"] != take_seq
                && entry["generated"] != true
                && mentions_attic(entry)
        })
    {
        return None;
    }
    let mut custody = lamp["history"].as_array()?.iter().rev();
    let take_note = format!("Turn 2: {}", take["text"].as_str()?);
    let drop_note = format!("Turn 1: {}", drop["text"].as_str()?);
    (custody.next()?.as_str()? == take_note && custody.next()?.as_str()? == drop_note)
        .then_some(take_seq)
}

pub(super) fn mirror_after_take(world: &Value, present: &[&str]) -> Option<Mirror> {
    if world["items"][LAMP]["lit"] == false {
        Some(Mirror::Open {
            pond_available: !opening_view::pond_at_capacity(world, present),
        })
    } else {
        opening_view::attic_mirror(world, present)
    }
}

pub fn completed_take_response(
    world: Value,
    files: &Value,
    before_seq: u64,
    present: &[&str],
) -> Option<Value> {
    completed_take_response_with_profiles(world, files, before_seq, present, || {
        profiles::project(files)
    })
}

pub(super) fn completed_take_response_with_profiles(
    mut world: Value,
    files: &Value,
    before_seq: u64,
    present: &[&str],
    projected: impl FnOnce() -> Option<Value>,
) -> Option<Value> {
    if present != [VALE]
        || settled_take(&world)? != before_seq.checked_add(1)?
        || files["v2/card-game/speech.json"]["action"] != json!(["actor"])
    {
        return None;
    }
    opening_play::attic_content(files)?;
    if opening_view::other_attic_content(files)? {
        return None;
    }
    let mirror = mirror_after_take(&world, present)?;
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
    if world["eventSeq"] != last || events.first()?["seq"].as_u64()? != before_seq.checked_add(1)? {
        return None;
    }
    opening_wait_response::apply_vale_voice(&mut world)?;
    let mut response = opening_play::attic_response_with_profiles(
        opening::stored_response(world)?,
        files,
        mirror,
        projected()?,
    )?;
    response["events"] = json!(events);
    Some(response)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::opening_content;
    use std::{path::Path, process::Command};

    #[test]
    fn completed_second_take_projects_exact_pinned_returns() {
        let root = Path::new(env!("CARGO_MANIFEST_DIR")).join("../..");
        let (files, _) = opening_content::wait_files(&json!({
            "packContentJson":include_str!("../../orchestrator-rust/src/card_shared/content.json")
        }))
        .unwrap();
        let script = r#"
import assert from 'node:assert/strict';
import { currentSharedEngine } from './test/fixtures/shared-engine.mjs';
const { cardShared } = currentSharedEngine();
function pinned(request) {
  const result = JSON.parse(cardShared(JSON.stringify(request)));
  assert.equal(result.ok, true, result.error);
  return result;
}
const seats = { actor: 'vale', claimed: ['vale'], present: ['vale'] };
for (const seed of [undefined,0,2,17,42,4242,4294967295]) {
  for (const mode of ['held','stowed','dry']) {
    let {world} = pinned({op:'create', seed});
    if (mode === 'stowed')
      world = pinned({...seats, op:'hold', world, choice:{item:null, revision:world.revision}}).world;
    if (mode === 'dry')
      Object.assign(world.items.lamp, {fuel:0, fuelRooms:0, lit:false});
    world = pinned({...seats, op:'play', world, action:'drop:vale:lamp:attic'}).world;
    const voices = {mara:['mara']};
    world.speechVoices = voices;
    const expected = pinned({...seats, op:'play', world, action:'take:vale:lamp:'});
    assert.equal(expected.events.length, [2,4242,4294967295].includes(seed) ? 2 : 1);
    console.log(JSON.stringify({beforeSeq:world.eventSeq, expected, voices, title:{seed,mode}}));
  }
}
"#;
        let output = Command::new("node")
            .args(["--input-type=module", "--eval", script])
            .current_dir(root)
            .output()
            .expect("Node runs the pinned shared reducer");
        assert!(
            output.status.success(),
            "{}",
            String::from_utf8_lossy(&output.stderr)
        );
        let lines = String::from_utf8(output.stdout).unwrap();
        assert_eq!(lines.lines().count(), 21);
        for line in lines.lines() {
            let case: Value = serde_json::from_str(line).unwrap();
            let expected = &case["expected"];
            let mut world = expected["world"].clone();
            world["speechVoices"] = case["voices"].clone();
            world["playerActorId"] = json!(VALE);
            for field in ["heldActors", "controlledActors", "presentActors"] {
                world[field] = json!([VALE]);
            }
            let reply = completed_take_response(
                world,
                &files,
                case["beforeSeq"].as_u64().unwrap(),
                &[VALE],
            )
            .unwrap_or_else(|| panic!("Unsupported {}", case["title"]));
            for (field, value) in expected.as_object().unwrap() {
                assert_eq!(&reply[field], value, "{field} for {}", case["title"]);
            }
            assert_eq!(
                reply.as_object().unwrap().len(),
                expected.as_object().unwrap().len()
            );
        }
    }
}
