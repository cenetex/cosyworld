use serde_json::{json, Map, Value};
use std::collections::BTreeSet;

fn valid_upgrade(id: &str) -> bool {
    id.len() <= 40
        && id.as_bytes().first().is_some_and(u8::is_ascii_lowercase)
        && id
            .bytes()
            .all(|byte| byte.is_ascii_lowercase() || byte.is_ascii_digit() || byte == b'-')
}

fn merge_upgrades(actor: &mut Map<String, Value>, upgrades: &Value) -> Option<()> {
    let added = upgrades.as_array()?;
    if added.len() > 40 {
        return None;
    }
    let retained = match actor.get("upgrades") {
        Some(value) => value.as_array()?.as_slice(),
        None => &[],
    };
    let mut merged = BTreeSet::new();
    for id in retained.iter().chain(added) {
        merged.insert(id.as_str().filter(|id| valid_upgrade(id))?);
    }
    let merged = json!(merged);
    actor.insert("upgrades".into(), merged);
    Some(())
}

fn carry_progress(actor: &mut Map<String, Value>, progress: &Value) -> Option<()> {
    if progress.is_null() {
        return Some(());
    }
    let progress = progress.as_object()?;
    if let Some(upgrades) = progress.get("upgrades") {
        merge_upgrades(actor, upgrades)?;
        if !progress.contains_key("xp") && !progress.contains_key("level") {
            return Some(());
        }
    }
    let count = |value: &Value| value.as_u64().filter(|count| *count <= 1_000_000);
    let xp = count(progress.get("xp")?)?;
    let level = match progress.get("level") {
        Some(value) => Some(count(value).filter(|level| *level > 0)?),
        None => None,
    };
    if let Some(level) = level {
        actor.insert("level".into(), json!(level));
    } else {
        actor.remove("level");
    }
    let carried = xp.max(level.map_or(0, |level| level * (level - 1) / 2));
    actor.insert("xp".into(), json!(xp));
    actor.insert("carried".into(), json!(carried));
    Some(())
}

pub(super) fn apply(world: &mut Value, actor: &str, progress: &Value) -> Option<()> {
    let record = world["actors"].get_mut(actor)?.as_object_mut()?;
    carry_progress(record, progress)?;
    if let Some(absent) = world.get_mut("absent") {
        let absent = absent.as_array_mut()?;
        absent.retain(|id| id != actor);
        if absent.is_empty() {
            world.as_object_mut()?.remove("absent");
        }
    }
    Some(())
}
