use super::{opening, opening_play, opening_view};
use serde_json::{json, Value};

const ACTOR: &str = "vale";
const ROOM: &str = "attic";

pub fn completed_wait_response(
    mut world: Value,
    files: &Value,
    before_seq: u64,
    present: &[&str],
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

    let mut response =
        opening_play::after_wait_response(opening::stored_response(world)?, files, mirror)?;
    response["events"] = json!(events);
    Some(response)
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

fn vale_action(entry: &Value) -> bool {
    entry["kind"] == "action" && entry["actorId"] == ACTOR && entry["generated"] != true
}

fn ordinary_attic_wait(entry: &Value) -> bool {
    vale_action(entry)
        && entry["locationId"] == ROOM
        && entry["verb"] == "wait"
        && entry["sleep"] != true
        && entry["guards"].is_null()
}

pub(super) fn apply_vale_voice(world: &mut Value) -> Option<()> {
    world
        .as_object_mut()?
        .entry("speechVoices")
        .or_insert_with(|| json!({}))
        .as_object_mut()?
        .insert(ACTOR.into(), json!([ACTOR]));
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
}
