use serde::de::{IgnoredAny, MapAccess, Visitor};
use serde::{Deserialize, Deserializer};
use serde_json::{json, Map, Value};
use std::fmt;

const PACKS: &str = "v2/card-game/packs.json";
const HISTORY: &str = "v2/card-game/world-history.json";

#[derive(Deserialize)]
struct Document<const FULL_CATALOG: bool> {
    schema: u64,
    files: Files<FULL_CATALOG>,
}

#[derive(Deserialize)]
struct HistoryClock {
    turns: Option<u64>,
}

struct Files<const FULL_CATALOG: bool>(Value);

impl<'de, const FULL_CATALOG: bool> Deserialize<'de> for Files<FULL_CATALOG> {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        deserializer.deserialize_map(FilesVisitor::<FULL_CATALOG>)
    }
}

struct FilesVisitor<const FULL_CATALOG: bool>;

impl<'de, const FULL_CATALOG: bool> Visitor<'de> for FilesVisitor<FULL_CATALOG> {
    type Value = Files<FULL_CATALOG>;

    fn expecting(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str("compiled content files")
    }

    fn visit_map<M: MapAccess<'de>>(self, mut map: M) -> Result<Self::Value, M::Error> {
        let mut files = Map::new();
        while let Some(file) = map.next_key::<String>()? {
            if !FULL_CATALOG && file == HISTORY {
                let clock: HistoryClock = map.next_value()?;
                files.insert(file, json!({"turns": clock.turns}));
                continue;
            }
            let content = if file == PACKS {
                map.next_value::<PackFile<FULL_CATALOG>>()?.0
            } else {
                map.next_value()?
            };
            files.insert(file, content);
        }
        Ok(Files(Value::Object(files)))
    }
}

struct PackFile<const FULL_CATALOG: bool>(Value);

impl<'de, const FULL_CATALOG: bool> Deserialize<'de> for PackFile<FULL_CATALOG> {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        deserializer.deserialize_map(PackFileVisitor::<FULL_CATALOG>)
    }
}

struct PackFileVisitor<const FULL_CATALOG: bool>;

impl<'de, const FULL_CATALOG: bool> Visitor<'de> for PackFileVisitor<FULL_CATALOG> {
    type Value = PackFile<FULL_CATALOG>;

    fn expecting(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str("a compiled pack catalog")
    }

    fn visit_map<M: MapAccess<'de>>(self, mut map: M) -> Result<Self::Value, M::Error> {
        let mut fields = Map::new();
        while let Some(field) = map.next_key::<String>()? {
            let content = if field == "packs" {
                let packs: Vec<Pack<FULL_CATALOG>> = map.next_value()?;
                Value::Array(packs.into_iter().map(|pack| pack.0).collect())
            } else {
                map.next_value()?
            };
            fields.insert(field, content);
        }
        Ok(PackFile(Value::Object(fields)))
    }
}

struct Pack<const FULL_CATALOG: bool>(Value);

impl<'de, const FULL_CATALOG: bool> Deserialize<'de> for Pack<FULL_CATALOG> {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        deserializer.deserialize_map(PackVisitor::<FULL_CATALOG>)
    }
}

struct PackVisitor<const FULL_CATALOG: bool>;

impl<'de, const FULL_CATALOG: bool> Visitor<'de> for PackVisitor<FULL_CATALOG> {
    type Value = Pack<FULL_CATALOG>;

    fn expecting(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str("a compiled world pack")
    }

    fn visit_map<M: MapAccess<'de>>(self, mut map: M) -> Result<Self::Value, M::Error> {
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
                "places" | "avatars" | "items" if !FULL_CATALOG => {
                    fields.insert(field, map.next_value::<WaitCatalog>()?.0);
                }
                _ => {
                    fields.insert(field, map.next_value()?);
                }
            }
        }
        Ok(Pack(Value::Object(fields)))
    }
}

struct WaitCatalog(Value);

impl<'de> Deserialize<'de> for WaitCatalog {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        struct CatalogVisitor;

        impl<'de> Visitor<'de> for CatalogVisitor {
            type Value = WaitCatalog;

            fn expecting(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
                formatter.write_str("an authored entity catalog")
            }

            fn visit_map<M: MapAccess<'de>>(self, mut map: M) -> Result<Self::Value, M::Error> {
                let mut entities = Map::new();
                while let Some((id, entity)) = map.next_entry::<String, WaitEntity>()? {
                    entities.insert(id, entity.0);
                }
                Ok(WaitCatalog(Value::Object(entities)))
            }
        }

        deserializer.deserialize_map(CatalogVisitor)
    }
}

struct WaitEntity(Value);

impl<'de> Deserialize<'de> for WaitEntity {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        struct EntityVisitor;

        impl<'de> Visitor<'de> for EntityVisitor {
            type Value = WaitEntity;

            fn expecting(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
                formatter.write_str("an authored entity")
            }

            fn visit_map<M: MapAccess<'de>>(self, mut map: M) -> Result<Self::Value, M::Error> {
                let mut fields = Map::new();
                while let Some(field) = map.next_key::<String>()? {
                    match field.as_str() {
                        "text" | "tastes" | "portrait" | "art" | "backdrop" | "backdrops"
                        | "poses" | "voice" | "stage" | "recordText" | "questReadText" => {
                            map.next_value::<IgnoredAny>()?;
                        }
                        _ => {
                            fields.insert(field, map.next_value()?);
                        }
                    }
                }
                Ok(WaitEntity(Value::Object(fields)))
            }
        }

        deserializer.deserialize_map(EntityVisitor)
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
    let attic_choice = choice.at.as_deref() == Some("attic")
        && matches!(choice.on.as_deref(), Some("wait" | "meet"));
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
    if !attic_choice && effects.is_empty() {
        return None;
    }
    let mut projected = Map::new();
    if let Some(id) = choice.id {
        projected.insert("id".into(), Value::String(id));
    }
    if attic_choice {
        projected.insert("at".into(), json!("attic"));
        projected.insert("on".into(), json!(choice.on));
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

fn projected_files<const FULL_CATALOG: bool>(request: &Value) -> Option<Value> {
    let document: Document<FULL_CATALOG> =
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
                {"id":"example","works":{"a":"metadata"},"places":{
                    "home":{"name":"Home","text":"A short description","persona":"At home",
                        "backdrop":"home.webp","requires":[{"kind":"shared_world"}]}
                }, "avatars":{
                    "resident":{"name":"Resident","seed":"A trusted voice","expression":"smiling",
                        "portrait":"resident.webp","tastes":{"likes":"good company"}}
                }, "choices":[
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
        let full = files(&request).unwrap();
        assert_eq!(full[HISTORY], input["files"][HISTORY]);
        assert_eq!(
            full[PACKS]["packs"][0]["places"],
            input["files"][PACKS]["packs"][0]["places"]
        );
        let actual = wait_files(&request);
        assert_eq!(
            actual,
            Some(json!({
                "v2/card-game/world-history.json":{"turns":480},
                "v2/card-game/packs.json":{"hub":{"places":["station"]},"packs":[
                    {"id":"example","places":{
                        "home":{"name":"Home","persona":"At home",
                            "requires":[{"kind":"shared_world"}]}
                    },"avatars":{
                        "resident":{"name":"Resident","seed":"A trusted voice","expression":"smiling"}
                    },"choices":[
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
