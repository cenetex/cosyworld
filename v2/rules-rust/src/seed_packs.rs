use super::{pack_state::Catalog, seed::hash};
use serde_json::{json, Value};
use std::collections::{BTreeMap, BTreeSet};

const KINDS: [&str; 3] = ["places", "avatars", "items"];

type Cover<'a> = BTreeMap<&'a str, BTreeSet<&'a str>>;

fn kind_of(pack: &Value, id: &str) -> Option<&'static str> {
    KINDS.into_iter().find(|kind| pack[*kind].get(id).is_some())
}

fn section_holder<'a>(pack: &'a Value, item: &'a Value) -> Option<&'a str> {
    let holder = item["holder"].as_str()?;
    if pack["places"].get(holder).is_some() {
        Some(holder)
    } else {
        pack["avatars"][holder]["place"].as_str()
    }
}

fn coverage(pack: &Value) -> Option<Cover<'_>> {
    let mut cover = Cover::new();
    for entry in pack["specials"]["pool"].as_array()? {
        let Some(id) = entry["id"].as_str() else {
            continue;
        };
        cover.entry(id).or_default().insert(id);
        if kind_of(pack, id) != Some("places") {
            continue;
        }
        for (group, location) in [
            ("avatars", "place"),
            ("fixtures", "at"),
            ("items", "holder"),
        ] {
            let Some(entities) = pack.get(group) else {
                continue;
            };
            for (entity, record) in entities.as_object()? {
                let place = if location == "holder" {
                    section_holder(pack, record)
                } else {
                    record[location].as_str()
                };
                if place == Some(id) {
                    cover.entry(entity).or_default().insert(id);
                }
            }
        }
    }
    Some(cover)
}

struct Entry<'a> {
    id: Option<&'a str>,
    weight: u32,
}

impl<'a> Entry<'a> {
    fn parse(entry: &'a Value) -> Option<Self> {
        let id = if entry["none"] == true {
            None
        } else {
            Some(entry["id"].as_str()?)
        };
        let weight = match entry["rarity"].as_str()? {
            "common" => 8,
            "uncommon" => 4,
            "rare" => 2,
            "epic" => 1,
            "legendary" => 0,
            _ => return None,
        };
        Some(Self { id, weight })
    }
}

fn draw<'a>(pack: &'a Value, seed: u32, cover: &Cover<'a>) -> Option<Vec<&'a str>> {
    let id = pack["id"].as_str()?;
    let specials = &pack["specials"];
    let entries = specials["pool"]
        .as_array()?
        .iter()
        .map(Entry::parse)
        .collect::<Option<Vec<_>>>()?;
    let mut drawn = Vec::new();
    for kind in KINDS {
        let mut pool: Vec<_> = entries
            .iter()
            .filter(|entry| {
                entry.id.is_none_or(|id| {
                    kind_of(pack, id) == Some(kind)
                        && cover.get(id).is_none_or(|ids| {
                            !ids.iter()
                                .any(|other| *other != id && drawn.contains(other))
                        })
                })
            })
            .collect();
        let draws = specials["draw"].get(kind).map_or(Some(0), Value::as_u64)?;
        for slot in 0..draws {
            let total = pool
                .iter()
                .try_fold(0_u32, |sum, entry| sum.checked_add(entry.weight))?;
            if total == 0 {
                break;
            }
            let mut pick = hash(&format!("{seed}:{id}:{kind}:{slot}")) % total;
            let index = pool.iter().position(|entry| {
                let picked = pick < entry.weight;
                pick = pick.saturating_sub(entry.weight);
                picked
            })?;
            if let Some(id) = pool.remove(index).id {
                drawn.push(id);
            }
        }
    }
    Some(drawn)
}

pub(super) fn install(world: &mut Value, catalog: &Catalog<'_>, seed: u32) -> Option<()> {
    for pack in catalog.packs().filter(|pack| pack["specials"].is_object()) {
        let id = pack["id"].as_str()?;
        let entry = pack["entry"].as_str()?;
        let pool = pack["specials"]["pool"].as_array()?;
        let state = world.get_mut("packs")?.get_mut(id)?.as_object_mut()?;
        if state.contains_key("specials") {
            return None;
        }
        let cover = coverage(pack)?;
        let drawn = draw(pack, seed, &cover)?;
        state.insert("specials".into(), json!(drawn));
        for special in &drawn {
            let anchor = pool.iter().find(|entry| entry["id"] == *special)?["anchor"]
                .as_str()
                .unwrap_or(entry);
            let target = match kind_of(pack, special)? {
                "avatars" => Some(("actors", "place")),
                "items" => Some(("items", "holder")),
                _ => None,
            };
            if let Some((group, field)) = target {
                world
                    .get_mut(group)?
                    .get_mut(*special)?
                    .as_object_mut()?
                    .insert(field.into(), json!(anchor));
            }
        }
        for (id, actor) in world.get_mut("actors")?.as_object_mut()? {
            if !cover.contains_key(id.as_str())
                && cover
                    .get(actor["place"].as_str()?)
                    .is_some_and(|places| !places.iter().any(|id| drawn.contains(id)))
            {
                actor["place"] = json!(entry);
            }
        }
    }
    Some(())
}
