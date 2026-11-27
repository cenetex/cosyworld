#![forbid(unsafe_code)]

use serde::de::DeserializeOwned;
use std::{
    collections::{BTreeMap, BTreeSet},
    ffi::OsString,
    fs,
    path::Path,
};

#[allow(dead_code)]
mod schema;
use schema::{Bridge, Crossing, Pack, Table};

fn load<T: DeserializeOwned>(path: &Path) -> Result<T, String> {
    let bytes = fs::read(path).map_err(|error| format!("{}: {error}", path.display()))?;
    serde_json::from_slice(&bytes).map_err(|error| format!("{}: {error}", path.display()))
}

fn valid_id(id: &str) -> bool {
    let bytes = id.as_bytes();
    bytes.len() <= 80
        && bytes.first().is_some_and(u8::is_ascii_lowercase)
        && bytes
            .iter()
            .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || *c == b'-')
}

fn distinct(ids: &[String]) -> bool {
    ids.iter().collect::<BTreeSet<_>>().len() == ids.len()
}

fn released(pack: &Pack, place: &str) -> bool {
    pack.places.contains_key(place)
        && pack
            .release
            .as_ref()
            .is_none_or(|release| release.places.iter().any(|id| id == place))
}

fn pack_sources(v2: &Path, id: &str) -> Result<(Pack, Bridge), String> {
    let pack: Pack = load(&v2.join("content").join(id).join("card-world.json"))?;
    let bridge: Bridge = load(&v2.join("worlds").join(id).join("card-bridge.json"))?;
    if pack.schema_version != 1
        || pack.id != id
        || pack.pack_id != format!("cosyworld.{id}")
        || !(1..=1_000_000).contains(&pack.revision)
        || !released(&pack, &pack.entry)
    {
        return Err(format!(
            "{id}: invalid pack identity, revision or released entry"
        ));
    }
    if bridge.schema_version != 1 || bridge.pack != id || bridge.entries.is_empty() {
        return Err(format!(
            "{id}: invalid bridge version, pack name or entries"
        ));
    }
    for (place_id, place) in &pack.places {
        if !valid_id(place_id)
            || !distinct(&place.exits)
            || place
                .exits
                .iter()
                .any(|exit| exit == place_id || !pack.places.contains_key(exit))
        {
            return Err(format!("{id}: invalid place id or exits at {place_id}"));
        }
    }
    Ok((pack, bridge))
}

fn check_worlds(v2: &Path) -> Result<usize, String> {
    let table: Table = load(&v2.join("worlds/card-table.json"))?;
    if table.schema_version != 1
        || !distinct(&table.packs)
        || table.packs.iter().any(|id| id == "hub" || !valid_id(id))
        || !table.hub.places.contains(&table.hub.start)
    {
        return Err(
            "card-table.json: expected version 1, distinct pack ids and a hub start place".into(),
        );
    }

    let packs = table
        .packs
        .iter()
        .map(|id| pack_sources(v2, id).map(|sources| (id.as_str(), sources)))
        .collect::<Result<BTreeMap<_, _>, _>>()?;
    let known_place = |pack_id: &str, place: &str| {
        if pack_id == "hub" {
            table.hub.places.iter().any(|id| id == place)
        } else {
            packs
                .get(pack_id)
                .is_some_and(|(pack, _)| released(pack, place))
        }
    };
    let mut crossings = BTreeMap::<&str, &Crossing>::new();
    for (id, (_, bridge)) in &packs {
        for crossing in &bridge.crossings {
            if !valid_id(&crossing.id) || crossings.insert(&crossing.id, crossing).is_some() {
                return Err(format!(
                    "{id}: invalid or duplicate crossing {}",
                    crossing.id
                ));
            }
        }
    }
    for (id, (_, bridge)) in &packs {
        for entry in &bridge.entries {
            let joins_places = crossings.get(entry.via.as_str()).is_some_and(|crossing| {
                !crossing.retired
                    && ((crossing.from == entry.at && crossing.to == entry.arrive)
                        || (crossing.from == entry.arrive && crossing.to == entry.at))
            });
            if entry.joins == *id
                || !known_place(&entry.joins, &entry.at)
                || !known_place(id, &entry.arrive)
                || !joins_places
            {
                return Err(format!(
                    "{id}: entry via {} needs a live crossing between released places",
                    entry.via
                ));
            }
        }
    }
    Ok(packs.len())
}

pub fn run(args: impl IntoIterator<Item = OsString>) -> Result<(), String> {
    let args: Vec<_> = args.into_iter().collect();
    let usage = "Usage: check-world [v2-directory] | check-world --schema <table|pack|bridge>";
    let directory = match args.as_slice() {
        [flag, kind] if flag == "--schema" => {
            let schema = match kind.to_str() {
                Some("table") => schemars::schema_for!(Table),
                Some("pack") => schemars::schema_for!(Pack),
                Some("bridge") => schemars::schema_for!(Bridge),
                _ => return Err(usage.into()),
            };
            println!(
                "{}",
                serde_json::to_string_pretty(&schema).map_err(|error| error.to_string())?
            );
            return Ok(());
        }
        [flag] if flag == "--help" || flag == "-h" => {
            println!("{usage}");
            return Ok(());
        }
        [path] if !path.to_string_lossy().starts_with('-') => Path::new(path),
        [] => Path::new("v2"),
        _ => return Err(usage.into()),
    };
    let count = check_worlds(directory)?;
    println!("Checked {count} built-in world packs.");
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn checks_current_builtin_packs() {
        let v2 = Path::new(env!("CARGO_MANIFEST_DIR")).join("..");
        assert!(check_worlds(&v2).unwrap() > 0);
    }

    #[test]
    fn rejects_paths_as_pack_ids() {
        assert!(valid_id("badger-forest"));
        for id in ["", "..", "../content", "/content", "BADGER", "1-world"] {
            assert!(!valid_id(id));
        }
    }
}
