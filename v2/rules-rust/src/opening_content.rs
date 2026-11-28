use super::authored_order::Order;
use serde::de::{DeserializeSeed, IgnoredAny, MapAccess, Visitor};
use serde::{Deserialize, Deserializer};
use serde_json::{json, Map, Value};
use std::fmt;

const PACKS: &str = "v2/card-game/packs.json";
const HISTORY: &str = "v2/card-game/world-history.json";
const FOREST: &str = "v2/card-game/forest.json";
const BOARDY: &str = "v2/card-game/boardyai.json";
const SHARED: &str = "v2/card-game/shared-cast.json";

#[derive(Deserialize)]
struct Document<const FULL_CATALOG: bool> {
    schema: u64,
    files: Files<FULL_CATALOG>,
}

#[derive(Deserialize)]
struct HistoryClock {
    turns: Option<u64>,
}

struct Files<const FULL_CATALOG: bool>(Value, Option<Order>);

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
        let mut compiled = None;
        let mut forest = None;
        let mut boardy = None;
        while let Some(file) = map.next_key::<String>()? {
            if !FULL_CATALOG
                && matches!(file.as_str(), FOREST | PACKS | BOARDY | SHARED)
                && files.contains_key(&file)
            {
                return Err(serde::de::Error::custom("duplicate authored catalog file"));
            }
            let content = match file.as_str() {
                HISTORY if !FULL_CATALOG => {
                    let clock: HistoryClock = map.next_value()?;
                    json!({"turns": clock.turns})
                }
                PACKS => {
                    let PackFile(content, keys) = map.next_value::<PackFile<FULL_CATALOG>>()?;
                    compiled = Some(keys);
                    content
                }
                FOREST | BOARDY if !FULL_CATALOG => {
                    let inner = if file == FOREST {
                        PackVisitor::<false>::standalone("people", "things")
                    } else {
                        PackVisitor::<false>::standalone("avatars", "items")
                    };
                    let Pack(content, keys) = map.next_value_seed(inner)?;
                    if file == FOREST {
                        forest = Some(keys);
                    } else {
                        boardy = Some(keys);
                    }
                    content
                }
                _ => map.next_value()?,
            };
            files.insert(file, content);
        }
        let order = match (forest, compiled, boardy) {
            (Some(forest), Some(compiled), Some(boardy)) => {
                let shared = files.get(SHARED).and_then(shared_order);
                shared.map(|shared| Order::assemble(forest, compiled, shared, boardy))
            }
            _ => None,
        };
        Ok(Files(Value::Object(files), order))
    }
}

fn shared_order(content: &Value) -> Option<Order> {
    let mut order = Order::default();
    for avatar in content["avatars"].as_array()? {
        let id = avatar["id"].as_str()?;
        let item = avatar["item"]["id"].as_str()?;
        if id != "vale" {
            order.actors.push(id.into());
            order.items.push(item.into());
        }
    }
    Some(order)
}

struct PackFile<const FULL_CATALOG: bool>(Value, Order);

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
        let mut order = Order::default();
        while let Some(field) = map.next_key::<String>()? {
            let content = if field == "packs" {
                if !FULL_CATALOG && fields.contains_key("packs") {
                    return Err(serde::de::Error::duplicate_field("packs"));
                }
                let packs: Vec<Pack<FULL_CATALOG>> = map.next_value()?;
                let mut values = Vec::with_capacity(packs.len());
                for Pack(content, keys) in packs {
                    values.push(content);
                    order.extend(keys);
                }
                Value::Array(values)
            } else {
                map.next_value()?
            };
            fields.insert(field, content);
        }
        Ok(PackFile(Value::Object(fields), order))
    }
}

struct Pack<const FULL_CATALOG: bool>(Value, Order);

impl<'de, const FULL_CATALOG: bool> Deserialize<'de> for Pack<FULL_CATALOG> {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        deserializer.deserialize_map(PackVisitor::<FULL_CATALOG> {
            actors: "avatars",
            items: "items",
            compiled: true,
        })
    }
}

struct PackVisitor<const FULL_CATALOG: bool> {
    actors: &'static str,
    items: &'static str,
    compiled: bool,
}

impl<const FULL_CATALOG: bool> PackVisitor<FULL_CATALOG> {
    fn standalone(actors: &'static str, items: &'static str) -> Self {
        Self {
            actors,
            items,
            compiled: false,
        }
    }
}

impl<'de, const FULL_CATALOG: bool> DeserializeSeed<'de> for PackVisitor<FULL_CATALOG> {
    type Value = Pack<FULL_CATALOG>;

    fn deserialize<D: Deserializer<'de>>(self, deserializer: D) -> Result<Self::Value, D::Error> {
        deserializer.deserialize_map(self)
    }
}

impl<'de, const FULL_CATALOG: bool> Visitor<'de> for PackVisitor<FULL_CATALOG> {
    type Value = Pack<FULL_CATALOG>;

    fn expecting(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str("a compiled world pack")
    }

    fn visit_map<M: MapAccess<'de>>(self, mut map: M) -> Result<Self::Value, M::Error> {
        let mut fields = Map::new();
        let mut order = Order::default();
        while let Some(field) = map.next_key::<String>()? {
            match field.as_str() {
                "works" if self.compiled => {
                    map.next_value::<IgnoredAny>()?;
                }
                "choices" if self.compiled => {
                    let choices = map.next_value::<Option<Vec<Choice>>>()?;
                    fields.insert(field, choices.map_or(Value::Null, project_choices));
                }
                "places" if self.compiled && !FULL_CATALOG => {
                    let (content, _) = map.next_value_seed(Entities {
                        project: true,
                        keep_order: false,
                    })?;
                    fields.insert(field, content);
                }
                collection
                    if !FULL_CATALOG && (collection == self.actors || collection == self.items) =>
                {
                    if fields.contains_key(collection) {
                        return Err(serde::de::Error::custom(
                            "duplicate authored entity collection",
                        ));
                    }
                    let (content, keys) = map.next_value_seed(Entities {
                        project: self.compiled,
                        keep_order: true,
                    })?;
                    if collection == self.actors {
                        order.actors = keys;
                    } else {
                        order.items = keys;
                    }
                    fields.insert(field, content);
                }
                _ => {
                    fields.insert(field, map.next_value()?);
                }
            }
        }
        if !self.compiled && self.actors == "people" {
            for field in [self.actors, self.items] {
                if !fields.contains_key(field) {
                    return Err(serde::de::Error::missing_field(field));
                }
            }
        }
        Ok(Pack(Value::Object(fields), order))
    }
}

struct Entities {
    project: bool,
    keep_order: bool,
}

impl<'de> DeserializeSeed<'de> for Entities {
    type Value = (Value, Vec<String>);

    fn deserialize<D: Deserializer<'de>>(self, deserializer: D) -> Result<Self::Value, D::Error> {
        deserializer.deserialize_map(self)
    }
}

impl<'de> Visitor<'de> for Entities {
    type Value = (Value, Vec<String>);

    fn expecting(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str("an authored entity catalog")
    }

    fn visit_map<M: MapAccess<'de>>(self, mut map: M) -> Result<Self::Value, M::Error> {
        let mut entities = Map::new();
        let mut order = Vec::new();
        while let Some(id) = map.next_key::<String>()? {
            if self.keep_order {
                order.push(id.clone());
            }
            let entity = if self.project {
                map.next_value::<WaitEntity>()?.0
            } else {
                map.next_value()?
            };
            entities.insert(id, entity);
        }
        Ok((Value::Object(entities), order))
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
    let opening_choice = matches!(
        (choice.at.as_deref(), choice.on.as_deref()),
        (Some("attic"), Some("wait" | "meet")) | (Some("pond"), Some("meet"))
    );
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
    if !opening_choice && effects.is_empty() {
        return None;
    }
    let mut projected = Map::new();
    if let Some(id) = choice.id {
        projected.insert("id".into(), Value::String(id));
    }
    if opening_choice {
        projected.insert("at".into(), json!(choice.at));
        projected.insert("on".into(), json!(choice.on));
    }
    if !effects.is_empty() {
        projected.insert("effects".into(), Value::Array(effects));
    }
    Some(Value::Object(projected))
}

pub(super) fn files(request: &Value) -> Option<Value> {
    Some(projected_files::<true>(request)?.0)
}

pub(super) fn wait_files(request: &Value) -> Option<(Value, Order)> {
    let Files(content, order) = projected_files::<false>(request)?;
    Some((content, order?))
}

fn projected_files<const FULL_CATALOG: bool>(request: &Value) -> Option<Files<FULL_CATALOG>> {
    let document: Document<FULL_CATALOG> =
        serde_json::from_str(request["packContentJson"].as_str()?).ok()?;
    (document.schema == 1).then_some(document.files)
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
        let actual = projected_files::<false>(&request).map(|files| files.0);
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
