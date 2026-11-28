use serde::de::{IgnoredAny, MapAccess, Visitor};
use serde::{Deserialize, Deserializer};
use serde_json::{json, Map, Value};
use std::fmt;

const PACKS: &str = "v2/card-game/packs.json";
const HISTORY: &str = "v2/card-game/world-history.json";

#[derive(Deserialize)]
struct Document<const KEEP_HISTORY: bool> {
    schema: u64,
    files: Files<KEEP_HISTORY>,
}

#[derive(Deserialize)]
struct HistoryClock {
    turns: Option<u64>,
}

struct Files<const KEEP_HISTORY: bool>(Value);

impl<'de, const KEEP_HISTORY: bool> Deserialize<'de> for Files<KEEP_HISTORY> {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        deserializer.deserialize_map(FilesVisitor::<KEEP_HISTORY>)
    }
}

struct FilesVisitor<const KEEP_HISTORY: bool>;

impl<'de, const KEEP_HISTORY: bool> Visitor<'de> for FilesVisitor<KEEP_HISTORY> {
    type Value = Files<KEEP_HISTORY>;

    fn expecting(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str("compiled content files")
    }

    fn visit_map<M: MapAccess<'de>>(self, mut map: M) -> Result<Self::Value, M::Error> {
        let mut files = Map::new();
        while let Some(file) = map.next_key::<String>()? {
            if !KEEP_HISTORY && file == HISTORY {
                let clock: HistoryClock = map.next_value()?;
                files.insert(file, json!({"turns": clock.turns}));
                continue;
            }
            let content = if file == PACKS {
                map.next_value::<PackFile>()?.0
            } else {
                map.next_value()?
            };
            files.insert(file, content);
        }
        Ok(Files(Value::Object(files)))
    }
}

struct PackFile(Value);

impl<'de> Deserialize<'de> for PackFile {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        deserializer.deserialize_map(PackFileVisitor)
    }
}

struct PackFileVisitor;

impl<'de> Visitor<'de> for PackFileVisitor {
    type Value = PackFile;

    fn expecting(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str("a compiled pack catalog")
    }

    fn visit_map<M: MapAccess<'de>>(self, mut map: M) -> Result<PackFile, M::Error> {
        let mut fields = Map::new();
        while let Some(field) = map.next_key::<String>()? {
            let content = if field == "packs" {
                let packs: Vec<Pack> = map.next_value()?;
                Value::Array(packs.into_iter().map(|pack| pack.0).collect())
            } else {
                map.next_value()?
            };
            fields.insert(field, content);
        }
        Ok(PackFile(Value::Object(fields)))
    }
}

struct Pack(Value);

impl<'de> Deserialize<'de> for Pack {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        deserializer.deserialize_map(PackVisitor)
    }
}

struct PackVisitor;

impl<'de> Visitor<'de> for PackVisitor {
    type Value = Pack;

    fn expecting(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str("a compiled world pack")
    }

    fn visit_map<M: MapAccess<'de>>(self, mut map: M) -> Result<Pack, M::Error> {
        let mut fields = Map::new();
        while let Some(field) = map.next_key::<String>()? {
            match field.as_str() {
                "works" => {
                    map.next_value::<IgnoredAny>()?;
                }
                "choices" => {
                    let choices = map.next_value::<Option<Vec<Choice>>>()?;
                    fields.insert(field, choices.map_or(Value::Null, project_choices));
                }
                _ => {
                    fields.insert(field, map.next_value()?);
                }
            }
        }
        Ok(Pack(Value::Object(fields)))
    }
}

#[derive(Deserialize)]
struct Choice {
    id: Option<String>,
    at: Option<String>,
    on: Option<String>,
    archived: Option<bool>,
    effects: Option<Vec<Effect>>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Effect {
    kind: Option<String>,
    item: Option<String>,
    wait_at_home: Option<bool>,
}

fn project_choices(choices: Vec<Choice>) -> Value {
    Value::Array(choices.into_iter().filter_map(project_choice).collect())
}

fn project_choice(choice: Choice) -> Option<Value> {
    let wait_sign = choice.at.as_deref() == Some("attic") && choice.on.as_deref() == Some("wait");
    let effects: Vec<_> = choice
        .effects
        .into_iter()
        .flatten()
        .filter_map(|effect| match effect.kind.as_deref() {
            Some("retire_item") if effect.wait_at_home == Some(true) => {
                Some(json!({"kind":"retire_item","item":effect.item,"waitAtHome":true}))
            }
            Some("drop_item") if choice.archived != Some(true) => {
                Some(json!({"kind":"drop_item","item":effect.item}))
            }
            _ => None,
        })
        .collect();
    if !wait_sign && effects.is_empty() {
        return None;
    }
    let mut projected = Map::new();
    if let Some(id) = choice.id {
        projected.insert("id".into(), Value::String(id));
    }
    if wait_sign {
        projected.insert("at".into(), json!("attic"));
        projected.insert("on".into(), json!("wait"));
    }
    if !effects.is_empty() {
        projected.insert("effects".into(), Value::Array(effects));
    }
    Some(Value::Object(projected))
}

pub(super) fn files(request: &Value) -> Option<Value> {
    projected_files::<true>(request)
}

pub(super) fn wait_files(request: &Value) -> Option<Value> {
    projected_files::<false>(request)
}

fn projected_files<const KEEP_HISTORY: bool>(request: &Value) -> Option<Value> {
    let document: Document<KEEP_HISTORY> =
        serde_json::from_str(request["packContentJson"].as_str()?).ok()?;
    (document.schema == 1).then_some(document.files.0)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn preserves_choice_markers_used_by_opening_rules() {
        let input = json!({"schema":1,"files":{
            "v2/card-game/world-history.json":{"turns":480,"changes":[[["turn"],480]]},
            "v2/card-game/packs.json":{"hub":{"places":["station"]},"packs":[
                {"id":"example","works":{"a":"metadata"},"places":{"home":{}}, "choices":[
                    {"id":"one","text":"A choice", "effects":[
                        {"kind":"retire_item", "item":"a"},
                        {"kind":"retire_item", "item":"b", "waitAtHome":true},
                        {"kind":"mark_choice", "item":"b", "waitAtHome":true}
                    ]},
                    {"id":"two", "effects":[]},
                    {"at":"attic", "on":"wait", "text":"A sign"},
                    {"id":"drop", "effects":[{"kind":"drop_item", "item":"b"}]},
                    {"id":"archived", "archived":true, "effects":[{"kind":"drop_item", "item":"c"}]}
                ]},
                {"id":"empty", "choices":[]},
                {"id":"absent"}
            ]},
            "other-file":["kept"]
        }});
        let request = json!({"packContentJson":input.to_string()});
        assert_eq!(files(&request).unwrap()[HISTORY], input["files"][HISTORY]);
        let actual = wait_files(&request);
        assert_eq!(
            actual,
            Some(json!({
                "v2/card-game/world-history.json":{"turns":480},
                "v2/card-game/packs.json":{"hub":{"places":["station"]},"packs":[
                    {"id":"example", "places":{"home":{}}, "choices":[
                        {"id":"one", "effects":[{"kind":"retire_item", "item":"b", "waitAtHome":true}]},
                        {"at":"attic", "on":"wait"},
                        {"id":"drop", "effects":[{"kind":"drop_item", "item":"b"}]}
                    ]},
                    {"id":"empty", "choices":[]},
                    {"id":"absent"}
                ]},
                "other-file":["kept"]
            }))
        );
    }
}
