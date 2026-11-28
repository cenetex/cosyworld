use serde_json::{Map, Value};
use std::collections::BTreeSet;

pub fn begin(world: &mut Value, files: &Value) -> Option<()> {
    let changes = files["v2/card-game/world-history.json"]["changes"].as_array()?;
    if changes.is_empty() {
        return Some(());
    }
    for change in changes {
        let [path, value @ ..] = change.as_array()?.as_slice() else {
            return None;
        };
        let path = path.as_array()?;
        match value {
            [] => patch(world, path, None)?,
            [value] => patch(world, path, Some(value))?,
            _ => return None,
        }
    }
    let turn = world["turn"].as_u64()?;
    world["began"] = turn.into();
    let mut opening = BTreeSet::new();
    for entry in world["log"].as_array_mut()? {
        opening.insert(entry["seq"].as_u64()?);
        entry["turn"] = turn.into();
    }
    if let Some(knowledge) = world.get_mut("knowledge") {
        for fact in values(knowledge.get_mut("facts")) {
            redate(fact.get_mut("source")?, "eventSeq", "turn", &opening, turn);
        }
        for known in values(knowledge.get_mut("known")) {
            for memory in values(Some(known)) {
                redate(memory, "eventSeq", "learnedTurn", &opening, turn);
            }
        }
    }
    for memory in world["memories"].as_object_mut()?.values_mut() {
        for event in entries(memory.get_mut("events")) {
            redate(event, "seq", "turn", &opening, turn);
        }
        for record in values(memory.get_mut("subjects")) {
            if let Some(sight) = record.get_mut("sight") {
                redate(sight, "seq", "turn", &opening, turn);
            }
            for deed in entries(record.get_mut("deeds")) {
                redate(deed, "seq", "turn", &opening, turn);
            }
        }
    }
    Some(())
}

fn patch(world: &mut Value, path: &[Value], value: Option<&Value>) -> Option<()> {
    let (key, rest) = path.split_first()?;
    let key = key.as_str()?;
    let object = world.as_object_mut()?;
    if !rest.is_empty() {
        let child = object.entry(key).or_insert(Value::Null);
        if child.is_null() {
            *child = Value::Object(Map::new());
        }
        return patch(child, rest, value);
    }
    if let Some(value) = value {
        object.insert(key.to_owned(), value.clone());
    } else {
        object.remove(key);
    }
    Some(())
}

fn values(value: Option<&mut Value>) -> impl Iterator<Item = &mut Value> {
    value
        .and_then(Value::as_object_mut)
        .into_iter()
        .flat_map(Map::values_mut)
}

fn entries(value: Option<&mut Value>) -> impl Iterator<Item = &mut Value> {
    value.and_then(Value::as_array_mut).into_iter().flatten()
}

fn redate(event: &mut Value, seq: &str, date: &str, opening: &BTreeSet<u64>, turn: u64) {
    if event[seq]
        .as_u64()
        .is_some_and(|seq| opening.contains(&seq))
    {
        event[date] = turn.into();
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use std::{path::Path, process::Command};

    #[test]
    fn authored_history_matches_the_javascript_patch() {
        let root = Path::new(env!("CARGO_MANIFEST_DIR")).join("../..");
        let script = r#"
import { beginHistory } from './v2/card-game/world/history.mjs';
import { currentSharedEngine } from './test/fixtures/shared-engine.mjs';
const engine = currentSharedEngine();
console.log(JSON.stringify([0, 17, 4294967295].map((seed) => {
  const {world} = JSON.parse(engine.cardShared(JSON.stringify({op: 'create', seed})));
  return [world, beginHistory(structuredClone(world))];
})));
"#;
        let output = Command::new("node")
            .args(["--input-type=module", "--eval", script])
            .current_dir(root)
            .output()
            .unwrap();
        assert!(
            output.status.success(),
            "{}",
            String::from_utf8_lossy(&output.stderr)
        );
        let pairs: Vec<(Value, Value)> = serde_json::from_slice(&output.stdout).unwrap();
        let content: Value = serde_json::from_str(include_str!(
            "../../orchestrator-rust/src/card_shared/content.json"
        ))
        .unwrap();
        assert_eq!(pairs.len(), 3);
        for (mut world, expected) in pairs {
            assert_eq!(begin(&mut world, &content["files"]), Some(()));
            assert_eq!(world, expected);
        }
    }

    #[test]
    fn history_patch_redates_only_opening_evidence() {
        let mut world = json!({
            "turn": 0,
            "log": [{"seq": 2, "turn": 0}],
            "knowledge": {
                "facts": {"forest": {"source": {"eventSeq": 2, "turn": 0}}},
                "known": {"vale": {"forest": {"eventSeq": 2, "learnedTurn": 0}}}
            },
            "memories": {"vale": {
                "events": [{"seq": 2, "turn": 0}, {"seq": 1, "turn": 3}],
                "subjects": {"pip": {"sight": {"seq": 2, "turn": 0},
                    "deeds": [{"seq": 1, "turn": 3}, {"seq": 2, "turn": 0}]}},
                "old": "remove me"
            }, "pip": {"events": []}}
        });
        let files = json!({"v2/card-game/world-history.json": {"changes": [
            [["turn"], 480], [["memories", "vale", "old"]],
            [["actors", "vale", "place"], "attic"]
        ]}});
        assert_eq!(begin(&mut world, &files), Some(()));
        assert_eq!(
            world,
            json!({
                "turn": 480, "began": 480,
                "log": [{"seq": 2, "turn": 480}],
                "knowledge": {
                    "facts": {"forest": {"source": {"eventSeq": 2, "turn": 480}}},
                    "known": {"vale": {"forest": {"eventSeq": 2, "learnedTurn": 480}}}
                },
                "memories": {"vale": {
                    "events": [{"seq": 2, "turn": 480}, {"seq": 1, "turn": 3}],
                    "subjects": {"pip": {"sight": {"seq": 2, "turn": 480},
                        "deeds": [{"seq": 1, "turn": 3}, {"seq": 2, "turn": 480}]}}
                }, "pip": {"events": []}},
                "actors": {"vale": {"place": "attic"}}
            })
        );
    }
}
