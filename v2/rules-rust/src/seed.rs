use serde_json::{json, Value};
use std::collections::{BTreeMap, BTreeSet};

const LINK_CAP: usize = 3;
type LinkMap<'a> = BTreeMap<&'a str, BTreeSet<&'a str>>;

pub(super) fn hash(key: &str) -> u32 {
    key.chars().fold(2_166_136_261, |hash, ch| {
        let mut units = [0; 2];
        let unit = ch.encode_utf16(&mut units)[0];
        (hash ^ u32::from(unit)).wrapping_mul(16_777_619)
    })
}

pub(super) fn packs(files: &Value) -> Option<impl Iterator<Item = &Value>> {
    Some(
        files["v2/card-game/packs.json"]["packs"]
            .as_array()?
            .iter()
            .chain(std::iter::once(files.get("v2/card-game/boardyai.json")?)),
    )
}

struct Home<'a> {
    actor: &'a str,
    id: &'a str,
    doors: Vec<&'a str>,
}

fn homes(files: &Value) -> Option<Vec<Home<'_>>> {
    files["v2/card-game/shared-cast.json"]["avatars"]
        .as_array()?
        .iter()
        .filter(|avatar| avatar["id"] != "vale")
        .map(|avatar| {
            Some(Home {
                actor: avatar["id"].as_str()?,
                id: avatar["home"]["id"].as_str()?,
                doors: avatar["home"]["doors"]
                    .as_array()?
                    .iter()
                    .map(Value::as_str)
                    .collect::<Option<_>>()?,
            })
        })
        .collect()
}

fn links<'a>(files: &'a Value, homes: &[Home<'a>]) -> Option<(LinkMap<'a>, BTreeSet<&'a str>)> {
    let mut ships = BTreeMap::new();
    for pack in packs(files)? {
        if let Some(transports) = pack.get("transports") {
            for (id, ship) in transports.as_object()? {
                ships.insert(id.as_str(), ship["place"].as_str()?);
            }
        }
    }
    let home_ids: BTreeSet<_> = homes.iter().map(|home| home.id).collect();
    let mut links = LinkMap::new();
    let mut link = |from, to| {
        if !home_ids.contains(to) {
            links.entry(from).or_default().insert(to);
        }
    };
    let forest = files.get("v2/card-game/forest.json")?;
    let places =
        std::iter::once(&forest["places"]).chain(packs(files)?.map(|pack| &pack["places"]));
    for places in places {
        for (from, place) in places.as_object()? {
            for to in place["exits"].as_array()? {
                link(from.as_str(), to.as_str()?);
            }
        }
    }
    let routes = forest["reflectionRoutes"]
        .as_array()?
        .iter()
        .chain(packs(files)?.flat_map(|pack| pack["routes"].as_array().into_iter().flatten()));
    for route in routes {
        link(route["from"].as_str()?, route["to"].as_str()?);
    }
    for pack in packs(files)? {
        for crossing in pack["crossings"].as_array()? {
            if crossing["retired"] == true {
                continue;
            }
            let to = match crossing["transport"].as_str() {
                Some(id) => ships.get(id).copied()?,
                None => crossing["to"].as_str()?,
            };
            link(crossing["from"].as_str()?, to);
        }
    }
    for home in homes {
        for &door in &home.doors {
            link(home.id, door);
        }
    }
    Some((links, ships.into_values().collect()))
}

pub(super) fn place_doors(files: &Value, seed: u32, owner: Option<&str>) -> Option<Value> {
    let homes = homes(files)?;
    if owner.is_some_and(|id| !homes.iter().any(|home| home.actor == id)) {
        return None;
    }
    let lampless = files["v2/card-game/shared-cast.json"]["lampless"].as_array()?;
    let (linked, ships) = links(files, &homes)?;
    let mut order: Vec<_> = homes.iter().collect();
    order.sort_by_key(|home| {
        if home.doors.len() == 1 {
            0
        } else if Some(home.actor) == owner {
            1
        } else {
            2
        }
    });
    let mut used = BTreeMap::<&str, usize>::new();
    let mut doors = BTreeMap::new();
    for home in order {
        let mut wanted: Vec<_> = home
            .doors
            .iter()
            .copied()
            .filter(|door| Some(home.actor) == owner && lampless.iter().any(|id| id == *door))
            .collect();
        if wanted.is_empty() {
            wanted.extend(home.doors.iter().copied());
        }
        let free: Vec<_> = wanted
            .iter()
            .copied()
            .filter(|door| {
                ships.contains(door)
                    || linked.get(door).map_or(0, BTreeSet::len) + used.get(door).unwrap_or(&0)
                        < LINK_CAP
            })
            .collect();
        let candidates = if free.is_empty() { wanted } else { free };
        if candidates.is_empty() {
            return None;
        }
        let door =
            candidates[hash(&format!("{seed}:door:{}", home.id)) as usize % candidates.len()];
        *used.entry(door).or_default() += 1;
        doors.insert(home.id, door);
    }
    Some(json!(doors))
}

pub(super) fn door_projection(request: &Value) -> Option<Value> {
    let content: Value = serde_json::from_str(request["packContentJson"].as_str()?).ok()?;
    if content["schema"] != 1 {
        return None;
    }
    let seed = u32::try_from(request["seed"].as_u64()?).ok()?;
    let owner = match request.get("homecoming") {
        None | Some(Value::Null) => None,
        Some(value) => Some(value.as_str()?),
    };
    let doors = place_doors(content.get("files")?, seed, owner)?;
    Some(json!({"ok": true, "doors": doors}))
}
