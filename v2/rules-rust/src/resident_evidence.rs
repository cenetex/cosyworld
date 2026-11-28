use super::{opening::MAX_REVISION, opening_evidence, profiles};
use serde_json::{json, Map, Value};

pub struct ResidentEvidence(Map<String, Value>);

impl ResidentEvidence {
    pub fn new(files: &Value) -> Option<Self> {
        let Value::Object(profiles) = profiles::project(files)? else {
            return None;
        };
        Some(Self(profiles))
    }

    pub(super) fn into_profiles(self) -> Value {
        Value::Object(self.0)
    }

    pub fn record(
        &self,
        world: &mut Value,
        cast: &[&str],
        visible_items: &[&str],
        detail: Value,
        retain: bool,
    ) -> Option<()> {
        if !matches!(
            (detail["kind"].as_str(), detail["verb"].as_str()),
            (Some("action"), Some("take" | "move" | "drop" | "ask"))
                | (Some("narration"), Some("want_met"))
        ) {
            return None;
        }
        self.stamp(world, cast, visible_items, detail, retain)
    }

    pub(super) fn narrate(
        &self,
        world: &mut Value,
        cast: &[&str],
        visible_items: &[&str],
        place: &str,
        text: &str,
    ) -> Option<()> {
        self.narrate_by(world, cast, visible_items, None, place, text)
    }

    pub(super) fn narrate_by(
        &self,
        world: &mut Value,
        cast: &[&str],
        visible_items: &[&str],
        actor: Option<&str>,
        place: &str,
        text: &str,
    ) -> Option<()> {
        let detail = json!({
            "speaker":"World", "text":text, "kind":"narration", "actorId":actor,
            "locationId":place,
        });
        self.stamp(world, cast, visible_items, detail, true)
    }

    fn stamp(
        &self,
        world: &mut Value,
        cast: &[&str],
        visible_items: &[&str],
        mut detail: Value,
        retain: bool,
    ) -> Option<()> {
        let seq = world["eventSeq"].as_u64()?.checked_add(1)?;
        if seq > MAX_REVISION {
            return None;
        }
        let turn = world["turn"].as_u64()?;
        let mut items = Vec::with_capacity(visible_items.len());
        for id in visible_items {
            let mut item = world["items"][*id].as_object()?.clone();
            item.remove("history");
            item.entry("id").or_insert_with(|| json!(id));
            items.push(item);
        }
        let lamp = &world["items"]["lamp"];
        let light =
            visible_items.contains(&"lamp") && lamp["lit"] == true && lamp["fuel"].as_u64()? > 0;
        detail["seq"] = json!(seq);
        detail["turn"] = json!(turn);
        detail["cast"] = json!(cast);
        detail["items"] = json!(items);
        detail["light"] = json!(light);
        let controlled = world["controlledActors"]
            .as_array()
            .cloned()
            .unwrap_or_default();
        let present = world["presentActors"]
            .as_array()
            .cloned()
            .unwrap_or_default();
        opening_evidence::remember_for_seats(
            world["memories"].as_object_mut()?,
            &self.0,
            &detail,
            &controlled,
            &present,
        )?;
        let log = world["log"].as_array_mut()?;
        if retain {
            log.push(detail);
        }
        opening_evidence::trim_log(log);
        world["eventSeq"] = json!(seq);
        Some(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{path::Path, process::Command};

    #[test]
    fn resident_observations_match_pinned_first_wait() {
        let root = Path::new(env!("CARGO_MANIFEST_DIR")).join("../..");
        let script = r#"
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { currentSharedEngine } from './test/fixtures/shared-engine.mjs';
const engine = currentSharedEngine();
const {files} = JSON.parse(readFileSync('v2/orchestrator-rust/src/card_shared/content.json'));
const run = request => {
  const result = JSON.parse(engine.cardShared(JSON.stringify(request)));
  assert.equal(result.ok, true, result.error);
  return result.world;
};
const cases = [{seed:17}, {seed:4242, hidden:'ada', absent:['ash']}, {seed:11, homecoming:'ada'}];
const variants = cases.map(options => {
  const before = run({op:'create', ...options});
  const seats = ['vale'];
  const after = run({op:'play', world:before, actor:'vale', claimed:seats, present:seats, action:'wait:vale::'});
  return {before, log:after.log, turn:after.turn, eventSeq:after.eventSeq, memories:after.memories};
});
console.log(JSON.stringify({files, variants}));
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
        let evidence = ResidentEvidence::new(&fixture["files"]).unwrap();
        for variant in fixture["variants"].as_array().unwrap() {
            let mut world = variant["before"].clone();
            let start = world["log"].as_array().unwrap().len();
            let log = variant["log"].as_array().unwrap();
            world["turn"] = variant["turn"].clone();
            opening_evidence::remember(
                world["memories"].as_object_mut().unwrap(),
                &evidence.0,
                &log[start],
            )
            .unwrap();
            world["eventSeq"] = log[start]["seq"].clone();
            world["log"]
                .as_array_mut()
                .unwrap()
                .push(log[start].clone());
            assert!(log.len() > start + 2);
            for expected in &log[start + 1..] {
                let actor = expected["actorId"].as_str().unwrap();
                let mut detail = expected.as_object().unwrap().clone();
                for key in ["seq", "turn", "cast", "items", "light"] {
                    detail.remove(key).unwrap();
                }
                let (cast, items) = if expected["verb"] == "take" {
                    let item = expected["itemId"].as_str().unwrap();
                    world["items"][item]["holder"] = json!(actor);
                    (vec![actor], vec![item])
                } else {
                    assert_eq!(actor, "greek-rhapsode");
                    world["actors"][actor]["place"] = expected["locationId"].clone();
                    (vec![], vec![])
                };
                if expected["verb"] == "move" {
                    let mut unseen = world.clone();
                    evidence
                        .record(
                            &mut unseen,
                            &cast,
                            &items,
                            Value::Object(detail.clone()),
                            false,
                        )
                        .unwrap();
                    assert_eq!(unseen["log"], world["log"]);
                    assert_eq!(unseen["eventSeq"], expected["seq"]);
                    assert_eq!(unseen["memories"], variant["memories"]);
                }
                evidence
                    .record(&mut world, &cast, &items, Value::Object(detail), true)
                    .unwrap();
                assert_eq!(world["log"].as_array().unwrap().last().unwrap(), expected);
            }
            assert_eq!(world["eventSeq"], variant["eventSeq"]);
            for (id, expected) in variant["memories"].as_object().unwrap() {
                assert_eq!(&world["memories"][id], expected, "{id} memory");
            }
        }
    }
}
