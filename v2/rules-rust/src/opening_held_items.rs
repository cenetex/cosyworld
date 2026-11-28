use super::{opening_content, pack_state::Catalog, Geography};
use serde_json::{json, Value};
use std::collections::BTreeMap;

pub(super) type Hands = BTreeMap<String, Vec<String>>;

pub(super) fn snapshot(world: &Value, geo: &Geography) -> Option<Hands> {
    let mut hands = Hands::new();
    let actors = world["actors"].as_object()?;
    for (id, item) in world["items"].as_object()? {
        let holder = item["holder"].as_str()?;
        if actors.contains_key(holder) && geo.entity_enabled(world, id)? {
            hands.entry(holder.into()).or_default().push(id.clone());
        }
    }
    for choices in hands.values_mut() {
        choices.sort_unstable();
    }
    Some(hands)
}

pub(super) fn settle(world: &mut Value, geo: &Geography, before: Option<&Value>) -> Option<()> {
    let prior = match before {
        Some(before) => Some(snapshot(before, geo)?),
        None => None,
    };
    settle_from(world, geo, prior.as_ref())
}

pub(super) fn settle_from(world: &mut Value, geo: &Geography, prior: Option<&Hands>) -> Option<()> {
    let current = snapshot(world, geo)?;
    let items = world["items"].as_object()?;
    let actors = world["actors"].as_object()?;
    for actor in actors.values() {
        if let Some(held) = actor.get("heldItem").filter(|held| !held.is_null()) {
            if !items.contains_key(held.as_str()?) {
                return None;
            }
        }
    }
    for (id, actor) in world["actors"].as_object_mut()? {
        let options = current.get(id).map_or(&[][..], Vec::as_slice);
        let saved = actor.get("heldItem");
        let saved_choice = saved.and_then(Value::as_str);
        let mut receipt = None;
        if let Some(prior) = prior {
            let had = prior.get(id).map_or(&[][..], Vec::as_slice);
            let mut arrived = options.iter().rev().filter(|item| !had.contains(item));
            receipt = arrived.next();
            if receipt.is_some_and(|item| saved_choice == Some(item.as_str()))
                || arrived.any(|item| saved_choice == Some(item.as_str()))
            {
                continue;
            }
        }
        if receipt.is_none()
            && (saved == Some(&Value::Null)
                || options
                    .iter()
                    .any(|item| saved_choice == Some(item.as_str())))
        {
            continue;
        }
        actor.as_object_mut()?.insert(
            "heldItem".into(),
            receipt
                .or_else(|| options.first())
                .map_or(Value::Null, |item| json!(item)),
        );
    }
    Some(())
}

pub(super) fn projection(request: &Value) -> Option<Value> {
    let (files, _) = opening_content::wait_files(request)?;
    let catalog = Catalog::from_files(&files)?;
    let geo = Geography::new(&files, catalog.packs())?;
    let mut world = request.get("world")?.clone();
    settle(&mut world, &geo, request.get("before"))?;
    let mut result = json!({"ok":true});
    result["world"] = world;
    Some(result)
}
