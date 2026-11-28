use serde::{
    de::{IgnoredAny, MapAccess, Visitor},
    Deserialize, Deserializer,
};
use std::{collections::BTreeSet, fmt};

#[derive(Default)]
pub struct Order {
    pub actors: Vec<String>,
    pub items: Vec<String>,
}

#[derive(Deserialize)]
struct Document {
    schema: u64,
    files: Files,
}

#[derive(Deserialize)]
struct Files {
    #[serde(rename = "v2/card-game/forest.json")]
    forest: Forest,
    #[serde(rename = "v2/card-game/packs.json")]
    compiled: Compiled,
    #[serde(rename = "v2/card-game/shared-cast.json")]
    shared: Shared,
    #[serde(rename = "v2/card-game/boardyai.json")]
    boardy: Pack,
}

#[derive(Deserialize)]
struct Forest {
    people: Keys,
    things: Keys,
}

#[derive(Deserialize)]
struct Compiled {
    packs: Vec<Pack>,
}

#[derive(Deserialize)]
struct Pack {
    #[serde(default)]
    avatars: Keys,
    #[serde(default)]
    items: Keys,
}

#[derive(Deserialize)]
struct Shared {
    avatars: Vec<Avatar>,
}

#[derive(Deserialize)]
struct Avatar {
    id: String,
    item: Belonging,
}

#[derive(Deserialize)]
struct Belonging {
    id: String,
}

#[derive(Default)]
struct Keys(Vec<String>);

impl<'de> Deserialize<'de> for Keys {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        struct KeyVisitor;

        impl<'de> Visitor<'de> for KeyVisitor {
            type Value = Keys;

            fn expecting(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
                formatter.write_str("an authored catalog object")
            }

            fn visit_map<M: MapAccess<'de>>(self, mut map: M) -> Result<Keys, M::Error> {
                let mut keys = Vec::new();
                while let Some((key, _)) = map.next_entry::<String, IgnoredAny>()? {
                    keys.push(key);
                }
                Ok(Keys(keys))
            }
        }

        deserializer.deserialize_map(KeyVisitor)
    }
}

fn array_index(key: &str) -> Option<u32> {
    let index = key.parse::<u32>().ok()?;
    (index != u32::MAX && index.to_string() == key).then_some(index)
}

fn object_keys(keys: impl IntoIterator<Item = String>) -> Vec<String> {
    let mut seen = BTreeSet::new();
    let mut keys: Vec<_> = keys
        .into_iter()
        .filter(|key| seen.insert(key.clone()))
        .collect();
    keys.sort_by_cached_key(|key| array_index(key).unwrap_or(u32::MAX));
    keys
}

impl Order {
    pub(super) fn extend(&mut self, other: Self) {
        self.actors.extend(other.actors);
        self.items.extend(other.items);
    }

    pub(super) fn assemble(forest: Self, mut compiled: Self, shared: Self, boardy: Self) -> Self {
        compiled.extend(shared);
        compiled.extend(boardy);
        compiled.items.extend(forest.items);
        let mut actors = object_keys(forest.actors);
        actors.extend(object_keys(compiled.actors));
        Self {
            actors,
            items: object_keys(compiled.items),
        }
    }

    pub fn from_pack(raw: &str) -> Option<Self> {
        let Document { schema, files } = serde_json::from_str(raw).ok()?;
        if schema != 1 {
            return None;
        }
        let mut compiled = Self::default();
        for pack in files.compiled.packs {
            compiled.actors.extend(pack.avatars.0);
            compiled.items.extend(pack.items.0);
        }
        let mut shared = Self::default();
        for avatar in files.shared.avatars {
            if avatar.id != "vale" {
                shared.actors.push(avatar.id);
                shared.items.push(avatar.item.id);
            }
        }
        Some(Self::assemble(
            Self {
                actors: files.forest.people.0,
                items: files.forest.things.0,
            },
            compiled,
            shared,
            Self {
                actors: files.boardy.avatars.0,
                items: files.boardy.items.0,
            },
        ))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::Value;
    use std::{path::Path, process::Command};

    #[test]
    fn ordering_matches_pinned_catalog_and_move_witnesses() {
        let raw = include_str!("../../orchestrator-rust/src/card_shared/content.json");
        let order = Order::from_pack(raw).unwrap();
        let request = serde_json::json!({"packContentJson":raw});
        let (_, decoded) = crate::opening_content::wait_files(&request).unwrap();
        assert_eq!(order.actors, decoded.actors);
        assert_eq!(order.items, decoded.items);
        let root = Path::new(env!("CARGO_MANIFEST_DIR")).join("../..");
        let script = r#"
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { newest } from './v2/scripts/rules-pins.mjs';
const read = name => readFileSync(`v2/orchestrator-rust/src/card_shared/${name}`, 'utf8');
const runtime = vm.createContext({structuredClone, cardContent: JSON.parse(read('content.json'))});
const artifact = read(`engine-v${newest(read('rules.json'))}.js`);
const afterCatalog = /\n  var actorIds = [^\n]+;/;
assert.match(artifact, afterCatalog);
vm.runInContext(artifact.replace(afterCatalog, '$&\n  globalThis.order = {actors: actorIds, items: ids};'), runtime);
const apply = request => {
  const result = JSON.parse(runtime.cardShared(JSON.stringify(request)));
  assert.equal(result.ok, true, result.error);
  return result.world;
};
const witnesses = [17, 4242].map(seed => {
  const world = apply({op:'create', seed});
  const next = apply({op:'play', world, actor:'vale', claimed:['vale'], present:['vale'], action:'wait:vale::'});
  return next.log.find(entry => entry.actorId === 'greek-rhapsode' && entry.verb === 'move').witnesses;
});
console.log(JSON.stringify({...runtime.order, witnesses}));
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
        let pinned: Value = serde_json::from_slice(&output.stdout).unwrap();
        assert_eq!(serde_json::json!(order.actors), pinned["actors"]);
        assert_eq!(serde_json::json!(order.items), pinned["items"]);
        for witnesses in pinned["witnesses"].as_array().unwrap() {
            let witnesses: Vec<_> = witnesses
                .as_array()
                .unwrap()
                .iter()
                .map(|id| id.as_str().unwrap())
                .collect();
            let authored: Vec<_> = order
                .actors
                .iter()
                .chain(&order.items)
                .map(String::as_str)
                .filter(|id| witnesses.contains(id))
                .collect();
            assert_eq!(authored, witnesses);
        }
    }

    #[test]
    fn javascript_object_order_places_array_indexes_first() {
        let keys = ["x", "4294967295", "3", "03", "1", "x", "4294967294", "+1"];
        assert_eq!(
            object_keys(keys.map(str::to_owned)),
            ["1", "3", "4294967294", "x", "4294967295", "03", "+1"]
        );
    }
}
