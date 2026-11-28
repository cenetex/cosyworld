use super::{
    schema::{Bridge, Crossing, Hub, Pack, Table},
    transport, valid_id,
};
use std::collections::{BTreeMap, BTreeSet};

pub(super) fn check_groups(table: &Table) -> Result<(), String> {
    let groups = &table.hub.switchable;
    if groups.is_empty() {
        return Err("card-table.json: the hub needs switchable groups".into());
    }
    let mut assigned = BTreeSet::new();
    for (id, group) in groups {
        if group.packs.is_empty()
            || group
                .reached_by
                .as_ref()
                .is_some_and(|entry| entry == id || !groups.contains_key(entry))
        {
            return Err(format!("card-table.json: invalid switchable group {id}"));
        }
        for pack in &group.packs {
            if (pack != "hub" && !table.packs.contains(pack)) || !assigned.insert(pack) {
                return Err(format!(
                    "card-table.json: unknown or repeated pack {pack} in group {id}"
                ));
            }
        }
    }
    Ok(())
}

fn register_ids<'a>(
    entities: &mut BTreeMap<&'a str, &'a str>,
    owner: &'a str,
    ids: impl Iterator<Item = &'a String>,
) -> Result<(), String> {
    for id in ids {
        if !valid_id(id) {
            return Err(format!("{owner}: invalid entity id {id}"));
        }
        if let Some(previous) = entities.insert(id, owner) {
            return Err(format!(
                "{owner}: entity {id} is also defined by {previous}"
            ));
        }
    }
    Ok(())
}

pub(super) fn crossings<'a>(
    hub: &'a Hub,
    packs: &'a BTreeMap<&str, (Pack, Bridge)>,
) -> Result<BTreeMap<&'a str, &'a Crossing>, String> {
    let mut entities = BTreeMap::new();
    register_ids(
        &mut entities,
        "hub",
        hub.places.iter().chain(&hub.avatars).chain(&hub.items),
    )?;
    let mut places = hub
        .places
        .iter()
        .map(String::as_str)
        .collect::<BTreeSet<_>>();
    let mut transports = BTreeMap::new();
    for (id, (pack, bridge)) in packs {
        register_ids(
            &mut entities,
            id,
            pack.places
                .keys()
                .chain(pack.avatars.keys())
                .chain(pack.items.keys())
                .chain(pack.fixtures.keys()),
        )?;
        register_ids(&mut transports, id, bridge.transports.keys())?;
        places.extend(pack.places.keys().map(String::as_str));
    }

    let mut crossings = BTreeMap::new();
    let mut directions = BTreeSet::new();
    for (id, (pack, bridge)) in packs {
        transport::check(pack, bridge, |place| places.contains(place))?;
        if bridge.crossings.is_empty() {
            return Err(format!("{id}: bridge needs crossings"));
        }
        for crossing in &bridge.crossings {
            let crossing_id = crossing.id.as_str();
            let (from, to) = (crossing.from.as_str(), crossing.to.as_str());
            if !valid_id(crossing_id) || crossings.insert(crossing_id, crossing).is_some() {
                return Err(format!("{id}: invalid or duplicate crossing {crossing_id}"));
            }
            if !places.contains(from)
                || !places.contains(to)
                || pack.places.contains_key(from) == pack.places.contains_key(to)
            {
                return Err(format!(
                    "{id}: crossing {crossing_id} must connect this pack to a known outside place"
                ));
            }
            if !directions.insert((from, to)) {
                return Err(format!("{id}: duplicate crossing from {from} to {to}"));
            }
        }
    }
    Ok(crossings)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{load, pack_sources};
    use std::path::Path;

    #[test]
    fn rejects_unknown_switchable_packs() {
        let v2 = Path::new(env!("CARGO_MANIFEST_DIR")).join("..");
        let mut table: Table = load(&v2.join("worlds/card-table.json")).unwrap();
        assert!(check_groups(&table).is_ok());
        let group = table.hub.switchable.values_mut().next().unwrap();
        group.packs.push("unknown-shore".into());
        assert!(check_groups(&table).unwrap_err().contains("unknown-shore"));
    }

    #[test]
    fn rejects_duplicate_entities_and_invalid_crossings() {
        let v2 = Path::new(env!("CARGO_MANIFEST_DIR")).join("..");
        let table: Table = load(&v2.join("worlds/card-table.json")).unwrap();
        let id = "badger-forest";
        let sources = pack_sources(&v2, id).unwrap();
        let mut packs = BTreeMap::from([(id, sources)]);
        assert!(crossings(&table.hub, &packs).is_ok());

        let (pack, _) = packs.get_mut(id).unwrap();
        pack.fixtures
            .insert(table.hub.start.clone(), BTreeMap::new());
        assert!(crossings(&table.hub, &packs)
            .err()
            .unwrap()
            .contains("also defined by hub"));
        let (pack, bridge) = packs.get_mut(id).unwrap();
        pack.fixtures.remove(&table.hub.start);
        let [first, second, ..] = &mut bridge.crossings[..] else {
            panic!("expected a crossing in each direction");
        };
        second.from.clone_from(&first.from);
        second.to.clone_from(&first.to);
        assert!(crossings(&table.hub, &packs)
            .err()
            .unwrap()
            .contains("duplicate crossing from"));
        packs.get_mut(id).unwrap().1.crossings[1].from = "unknown-place".into();
        assert!(crossings(&table.hub, &packs)
            .err()
            .unwrap()
            .contains("known outside place"));
    }
}
