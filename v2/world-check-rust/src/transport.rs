use super::{
    distinct,
    schema::{Bridge, Pack, Transport},
};
use serde_json::Value;
use std::collections::{BTreeMap, BTreeSet};

pub(super) fn check(
    pack: &Pack,
    bridge: &Bridge,
    known_place: impl Fn(&str) -> bool,
) -> Result<(), String> {
    if bridge.transports.len() > 8 {
        return Err(format!(
            "{}: a pack may define at most eight transports",
            pack.id
        ));
    }
    let mut decks = BTreeSet::new();
    for (id, transport) in &bridge.transports {
        let problem = |message: &str| format!("{}: transport {id} {message}", pack.id);
        let deck = &transport.place;
        if !pack
            .places
            .get(deck)
            .is_some_and(|place| place.exits.is_empty())
            || !decks.insert(deck)
            || !(2..=12).contains(&transport.docks.len())
            || !distinct(&transport.docks)
            || !transport.docks.contains(&transport.at)
            || transport
                .docks
                .iter()
                .any(|dock| dock == deck || !known_place(dock))
        {
            return Err(problem(
                "needs its own place, known docks and an initial dock",
            ));
        }
        if pack.places.values().any(|place| place.exits.contains(deck))
            || pack.routes.iter().any(|route| {
                ["from", "to"]
                    .into_iter()
                    .any(|key| route.get(key).and_then(Value::as_str) == Some(deck.as_str()))
            })
        {
            return Err(problem("must use its dock routes"));
        }
        check_lanes(transport).map_err(|error| problem(&error))?;
    }
    let mut boarding = BTreeSet::new();
    for crossing in &bridge.crossings {
        let Some(id) = &crossing.transport else {
            continue;
        };
        if !bridge.transports.get(id).is_some_and(|transport| {
            transport.docks.contains(&crossing.from) && transport.docks.contains(&crossing.to)
        }) || !boarding.insert((id, &crossing.from))
        {
            return Err(format!(
                "{}: crossing {} has an invalid or repeated transport dock",
                pack.id, crossing.id
            ));
        }
    }
    Ok(())
}

fn check_lanes(transport: &Transport) -> Result<(), String> {
    if transport.lanes.is_empty() {
        return Err("needs sea lanes".into());
    }
    let mut directions = BTreeSet::new();
    let mut neighbors = BTreeMap::<_, BTreeSet<_>>::new();
    for lane in &transport.lanes {
        let (from, to) = (&lane.from, &lane.to);
        if from == to
            || !transport.docks.contains(from)
            || !transport.docks.contains(to)
            || lane.one_way == Some(false)
        {
            return Err(format!("has an invalid lane from {from} to {to}"));
        }
        if lane
            .opens_with
            .as_ref()
            .is_some_and(|conditions| !(1..=4).contains(&conditions.len()))
            || lane
                .sealed
                .is_some_and(|sealed| !sealed || lane.opens_with.is_none())
        {
            return Err(format!(
                "has an invalid gate on the lane from {from} to {to}"
            ));
        }
        if !directions.insert((from, to))
            || (lane.one_way.is_none() && !directions.insert((to, from)))
        {
            return Err(format!("repeats the lane from {from} to {to}"));
        }
        neighbors.entry(from).or_default().insert(to);
        neighbors.entry(to).or_default().insert(from);
    }
    for (dock, adjacent) in neighbors {
        if adjacent.len() > 4 {
            return Err(format!("dock {dock} has more than four lanes"));
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::pack_sources;
    use std::path::Path;

    #[test]
    fn rejects_invalid_initial_dock_and_duplicate_lanes() {
        let v2 = Path::new(env!("CARGO_MANIFEST_DIR")).join("..");
        let (pack, mut bridge) = pack_sources(&v2, "greek-drama").unwrap();
        let transport = bridge.transports.get_mut("greek-ship").unwrap();
        let dock = std::mem::replace(&mut transport.at, "unknown-dock".into());
        let docks = transport.docks.clone();
        let known = |place: &str| docks.iter().any(|dock| dock == place);
        assert!(check(&pack, &bridge, known)
            .unwrap_err()
            .contains("initial dock"));
        let transport = bridge.transports.get_mut("greek-ship").unwrap();
        transport.at = dock;
        assert!(check(&pack, &bridge, known).is_ok());
        let transport = bridge.transports.get_mut("greek-ship").unwrap();
        let [first, second, ..] = &mut transport.lanes[..] else {
            panic!("expected multiple lanes");
        };
        second.from.clone_from(&first.from);
        second.to.clone_from(&first.to);
        assert!(check(&pack, &bridge, known)
            .unwrap_err()
            .contains("repeats the lane"));
    }
}
