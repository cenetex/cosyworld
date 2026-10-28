use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::{collections::BTreeSet, sync::OnceLock};

#[derive(Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub(super) struct Reading {
    id: String,
    turn: u64,
}

fn catalog() -> &'static Value {
    static CATALOG: OnceLock<Value> = OnceLock::new();
    CATALOG.get_or_init(|| {
        serde_json::from_str(include_str!("../../../card-game/packs.json"))
            .expect("embedded source readings")
    })
}

fn passage(actor: &str, id: &str) -> Option<&'static Value> {
    catalog()["packs"]
        .as_array()?
        .iter()
        .flat_map(|p| p["readings"].as_array().into_iter().flatten())
        .find(|r| r["actor"] == actor && r["id"] == id)
}

pub(super) fn valid(actor: &str, readings: &[Reading], turn: u64) -> bool {
    let mut ids = BTreeSet::new();
    readings.len() <= 8
        && readings
            .iter()
            .all(|r| r.turn <= turn && ids.insert(&r.id) && passage(actor, &r.id).is_some())
}

pub(super) fn facts(actor: &str, readings: &[Reading]) -> Vec<String> {
    if readings.is_empty() {
        return vec![];
    }
    let mut facts = vec!["These passages from your story have become known through play. Treat them as memories of the island. Ground your reply in the revealed passages and the current world facts. The original first-person traveller is represented by the visiting player; the locations speak as the landscape.".into()];
    facts.extend(readings.iter().filter_map(|r| {
        let p = passage(actor, &r.id)?;
        Some(format!("{}\n{}", p["title"].as_str()?, p["text"].as_str()?))
    }));
    facts
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn source_readings_use_the_catalog_and_reject_unknown_or_future_passages() {
        let read = |id: &str, turn| Reading {
            id: id.into(),
            turn,
        };
        assert!(valid(
            "willows-swede",
            &[read("willows-arrival-text", 1)],
            1
        ));
        assert!(!valid("vale", &[read("willows-arrival-text", 1)], 1));
        assert!(!valid("willows-swede", &[read("invented", 1)], 1));
        assert!(!valid(
            "willows-swede",
            &[read("willows-arrival-text", 2)],
            1
        ));
        assert!(!valid(
            "willows-swede",
            &[
                read("willows-arrival-text", 1),
                read("willows-arrival-text", 1)
            ],
            1
        ));
        let early = facts("willows-swede", &[read("willows-arrival-text", 1)]).join("\n");
        assert!(early.contains("separate little kingdom of wonder and magic"));
        assert!(!early.contains("skin and flesh were indented"));
        assert!(facts("willows-swede", &[]).is_empty());
    }
}
