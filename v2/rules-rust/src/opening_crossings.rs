use super::{opening_play::attic_stairs_requirements, Geography};
use serde_json::{json, Value};

pub(super) fn no_crossing_unlocks(world: &Value, geography: &Geography) -> Option<()> {
    for pack in geography.packs() {
        for crossing in pack["crossings"].as_array()? {
            if crossing["unlockWhen"].is_null() {
                continue;
            }
            let id = crossing["id"].as_str()?;
            let pack_id = pack["id"].as_str()?;
            let discovered = world["crossings"][id]["discovered"].as_bool()?;
            if !discovered
                && !crossing["unlockWhen"].as_array()?.iter().any(|condition| {
                    blocked_by_grounding(world, condition)
                        || (condition["kind"] == "light"
                            && geography.crossing_conditions(
                                world,
                                pack_id,
                                &json!([condition]),
                                None,
                            ) == Some(false))
                })
            {
                return None;
            }
        }
    }
    Some(())
}

fn blocked_by_grounding(world: &Value, condition: &Value) -> bool {
    if condition["kind"] != "grounded" {
        return false;
    }
    let Some(item) = condition["item"].as_str() else {
        return false;
    };
    let Some(holder) = world["items"][item]["holder"].as_str() else {
        return false;
    };
    world["actors"].get(holder).is_some()
        || world["items"].get(holder).is_some()
        || world["usedUp"]
            .as_array()
            .is_some_and(|ids| ids.iter().any(|id| id == item))
}

pub(super) fn no_attic_crossing_narration(
    before: &Value,
    after: &Value,
    geography: &Geography,
) -> Option<()> {
    if before["actors"]["vale"]["place"] != "attic"
        || after["actors"]["vale"]["place"] != "attic"
        || geography.packs().any(|pack| {
            pack["items"]
                .as_object()
                .is_some_and(|items| items.values().any(|item| item["type"] == "cloth"))
        })
    {
        return None;
    }
    let stair_rules = attic_stairs_requirements();
    for pack in geography.packs() {
        let pack_id = pack["id"].as_str()?;
        for crossing in pack["crossings"].as_array()? {
            let opened = crossing["opened"].as_str().is_some_and(|s| !s.is_empty());
            let closed = crossing["closed"].as_str().is_some_and(|s| !s.is_empty());
            if crossing["from"] != "attic" || !(opened || closed) {
                continue;
            }
            if crossing["to"] != "forest-cottage"
                || !crossing["signal"].is_null()
                || !crossing["transport"].is_null()
                || crossing["requires"] != stair_rules
            {
                return None;
            }
            let gate_open = |world: &Value| -> Option<bool> {
                let id = crossing["id"].as_str()?;
                let discovered = world["crossings"][id]["discovered"].as_bool()?;
                if (crossing["retired"] == true && !discovered)
                    || !geography.entity_active(world, "attic")?
                    || !geography.entity_active(world, "forest-cottage")?
                {
                    return Some(false);
                }
                geography.crossing_conditions(world, pack_id, &crossing["requires"], Some("vale"))
            };
            let was_open = gate_open(before)?;
            let is_open = gate_open(after)?;
            if was_open != is_open && (if is_open { opened } else { closed }) {
                return None;
            }
        }
    }
    Some(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{create, pack_state::Catalog};
    use serde_json::json;

    #[test]
    fn opening_the_cottage_stairs_requires_narration() {
        let content: Value = serde_json::from_str(include_str!(
            "../../orchestrator-rust/src/card_shared/content.json"
        ))
        .unwrap();
        let files = &content["files"];
        let before = create::fresh(files, None, false).unwrap();
        let catalog = Catalog::from_files(files).unwrap();
        let geography = Geography::new(files, catalog.packs()).unwrap();

        let mut after = before.clone();
        after["items"]["cloth"]["holder"] = json!("attic");
        assert_eq!(
            no_attic_crossing_narration(&before, &before, &geography),
            Some(())
        );
        assert_eq!(
            no_attic_crossing_narration(&before, &after, &geography),
            None
        );
    }
}
