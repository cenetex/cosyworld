use serde::de::{IgnoredAny, MapAccess, Visitor};
use serde::{Deserialize, Deserializer};
use serde_json::{json, Map, Value};
use std::fmt;

const PACKS: &str = "v2/card-game/packs.json";

#[derive(Deserialize)]
struct Document {
    schema: u64,
    files: Files,
}

struct Files(Value);

impl<'de> Deserialize<'de> for Files {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        deserializer.deserialize_map(FilesVisitor)
    }
}

struct FilesVisitor;

impl<'de> Visitor<'de> for FilesVisitor {
    type Value = Files;

    fn expecting(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str("compiled content files")
    }

    fn visit_map<M: MapAccess<'de>>(self, mut map: M) -> Result<Files, M::Error> {
        let mut files = Map::new();
        while let Some(file) = map.next_key::<String>()? {
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
    Value::Array(
        choices
            .into_iter()
            .filter_map(|choice| {
                let id = choice.id?;
                let effects: Vec<_> = choice
                    .effects?
                    .into_iter()
                    .filter(|effect| {
                        effect.kind.as_deref() == Some("retire_item")
                            && effect.wait_at_home == Some(true)
                    })
                    .map(|effect| {
                        json!({"kind":"retire_item", "item":effect.item, "waitAtHome":true})
                    })
                    .collect();
                (!effects.is_empty()).then(|| json!({"id":id,"effects":effects}))
            })
            .collect(),
    )
}

pub(super) fn files(request: &Value) -> Option<Value> {
    let document: Document = serde_json::from_str(request["packContentJson"].as_str()?).ok()?;
    (document.schema == 1).then_some(document.files.0)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn preserves_opening_pack_data_and_waiting_retire_effects() {
        let input = json!({"schema":1,"files":{
            "v2/card-game/packs.json":{"hub":{"places":["station"]},"packs":[
                {"id":"example","works":{"a":"metadata"},"places":{"home":{}}, "choices":[
                    {"id":"one","text":"A choice", "effects":[
                        {"kind":"retire_item", "item":"a"},
                        {"kind":"retire_item", "item":"b", "waitAtHome":true},
                        {"kind":"mark_choice", "item":"b", "waitAtHome":true}
                    ]},
                    {"id":"two", "effects":[]}
                ]},
                {"id":"empty", "choices":[]},
                {"id":"absent"}
            ]},
            "other-file":["kept"]
        }});
        let actual = files(&json!({"packContentJson":input.to_string()}));
        assert_eq!(
            actual,
            Some(json!({
                "v2/card-game/packs.json":{"hub":{"places":["station"]},"packs":[
                    {"id":"example", "places":{"home":{}}, "choices":[
                        {"id":"one", "effects":[{"kind":"retire_item", "item":"b", "waitAtHome":true}]}
                    ]},
                    {"id":"empty", "choices":[]},
                    {"id":"absent"}
                ]},
                "other-file":["kept"]
            }))
        );
    }
}
