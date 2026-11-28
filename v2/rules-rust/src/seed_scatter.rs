use super::{pack_state::Catalog, seed::hash};
use serde_json::{json, Value};
use std::collections::{BTreeMap, BTreeSet};

struct Group<'a> {
    id: &'a str,
    places: Vec<&'a str>,
}

struct Registry<'a> {
    domains: BTreeMap<&'a str, &'a str>,
    packs: BTreeMap<&'a str, &'a Value>,
    defaults: Vec<Group<'a>>,
}

fn list(value: &Value) -> impl Iterator<Item = &Value> {
    value.as_array().into_iter().flatten()
}

fn contains(value: &Value, id: &str) -> bool {
    list(value).any(|entry| entry == id)
}

impl<'a> Registry<'a> {
    fn new(files: &'a Value, catalog: &'a Catalog<'_>) -> Option<Self> {
        let hub = files["v2/card-game/packs.json"].get("hub")?;
        let cast = files["v2/card-game/shared-cast.json"]["avatars"].as_array()?;
        let mut registry = Self {
            domains: BTreeMap::new(),
            packs: BTreeMap::new(),
            defaults: vec![Group {
                id: "hub",
                places: list(&hub["places"])
                    .map(Value::as_str)
                    .collect::<Option<_>>()?,
            }],
        };
        for item in ["places", "avatars", "items"]
            .iter()
            .flat_map(|key| list(&hub[*key]))
        {
            let item = item.as_str()?;
            if !cast.iter().any(|avatar| avatar["id"] == item) {
                registry.domains.insert(item, "hub");
            }
        }
        for pack in catalog.packs() {
            let id = pack["id"].as_str()?;
            registry.packs.insert(id, pack);
            for key in ["places", "avatars", "items", "fixtures"] {
                for item in pack[key].as_object().into_iter().flat_map(|map| map.keys()) {
                    registry.domains.insert(item, id);
                }
            }
            if hub["packEntries"].get(id).is_some() {
                registry.defaults.push(Group {
                    id,
                    places: vec![pack["entry"].as_str()?],
                });
            }
        }
        Some(registry)
    }

    fn active(&self, world: &Value, group: &str, id: &str) -> Option<bool> {
        if self.domains.get(id) != Some(&group) || contains(&world["usedUp"], id) {
            return Some(false);
        }
        if group == "hub" {
            return Some(true);
        }
        let coordinate = id.strip_prefix("elysium-void-").is_some_and(|number| {
            number.len() == 3 && number.bytes().all(|byte| byte.is_ascii_digit()) && number > "007"
        });
        let pack = self.packs.get(group)?;
        let place = pack["places"].get(id)?;
        let Some(state) = world["packs"].get(group) else {
            return Some(false);
        };
        if place["retired"] == true
            || list(&place["requires"]).next().is_some()
            || (coordinate && world["elysiumCoordinates"].get(id).is_none())
            || (state["scope"] != "full"
                && pack.get("release").is_some()
                && !contains(&pack["release"]["places"], id))
            || (list(&pack["specials"]["pool"]).any(|entry| entry["id"] == id)
                && !contains(&state["specials"], id))
        {
            return Some(false);
        }
        let section = list(&pack["sections"]).find(|part| contains(&part["places"], id));
        (place.get("road").is_none()
            && list(&place["appearsWhen"]).next().is_none()
            && (state["scope"] == "full"
                || section.is_none_or(|part| list(&part["requires"]).next().is_none())))
        .then_some(true)
    }

    fn candidates(
        &self,
        world: &Value,
        owner: &str,
        authored: &'a Value,
    ) -> Option<Vec<Group<'a>>> {
        let authored_places = if authored.is_array() {
            Some(
                list(authored)
                    .map(Value::as_str)
                    .collect::<Option<Vec<_>>>()?,
            )
        } else {
            None
        };
        let mut result = Vec::new();
        for group in self.defaults.iter().filter(|group| group.id != owner) {
            let mut places = Vec::new();
            for &id in authored_places.as_ref().unwrap_or(&group.places) {
                if self.active(world, group.id, id)? {
                    places.push(id);
                }
            }
            if !places.is_empty() {
                result.push(Group {
                    id: group.id,
                    places,
                });
            }
        }
        Some(result)
    }
}

fn root<'a>(world: &'a Value, mut holder: &'a str) -> Option<&'a str> {
    for _ in 0..32 {
        let Some(item) = world["items"].get(holder) else {
            break;
        };
        holder = item["holder"].as_str()?;
    }
    Some(holder)
}

pub(super) fn place(
    world: &mut Value,
    files: &Value,
    catalog: &Catalog<'_>,
    seed: u32,
) -> Option<()> {
    if list(&world["disabledPacks"]).next().is_some() {
        return None;
    }
    let registry = Registry::new(files, catalog)?;
    let mut items = BTreeMap::new();
    for (&owner, pack) in &registry.packs {
        for (id, item) in pack["items"].as_object().into_iter().flatten() {
            let scatter = &item["scatterOutside"];
            if scatter == true || scatter.is_array() {
                items.insert(id.as_str(), (owner, item));
            }
        }
    }
    let mut taken = BTreeMap::<&str, BTreeSet<&str>>::new();
    let mut pending = Vec::new();
    for (id, (owner, authored)) in items {
        let Some(item) = world["items"].get(id) else {
            continue;
        };
        let holder = item["holder"].as_str()?;
        if authored["holder"] != holder
            || !item["history"].as_array()?.is_empty()
            || contains(&world["usedUp"], id)
        {
            if let Some(domain) = registry.domains.get(root(world, holder)?) {
                taken.entry(owner).or_default().insert(*domain);
            }
            continue;
        }
        let candidates = registry.candidates(world, owner, &authored["scatterOutside"])?;
        if !candidates.is_empty() {
            pending.push((id, owner, candidates));
        }
    }
    pending.sort_by_key(|(_, _, candidates)| candidates.len());
    let turn = world["turn"].as_u64()?;
    for (id, owner, candidates) in pending {
        let used = taken.entry(owner).or_default();
        let mut choices: Vec<_> = candidates.iter().filter(|g| !used.contains(g.id)).collect();
        if choices.is_empty() {
            choices.extend(candidates.iter());
        }
        let group =
            choices[hash(&format!("{seed}:scatter-world:{owner}:{id}")) as usize % choices.len()];
        let holder =
            group.places[hash(&format!("{seed}:scatter-place:{id}")) as usize % group.places.len()];
        let item = world.get_mut("items")?.get_mut(id)?;
        item["holder"] = json!(holder);
        item["history"] = json!([format!("Turn {turn}: Waiting beyond its home world.")]);
        used.insert(group.id);
    }
    Some(())
}
