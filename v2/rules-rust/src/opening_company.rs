use serde_json::{json, Value};
use std::collections::BTreeMap;

const TRUST_FADE_TURNS: u64 = 96;

pub(super) fn fade_trust(world: &mut Value) -> Option<()> {
    let now = world["turn"].as_u64()?;
    let actors = world.get_mut("actors")?.as_object_mut()?;
    let places = actors
        .iter()
        .map(|(id, actor)| Some((id.clone(), actor["place"].as_str()?.to_owned())))
        .collect::<Option<BTreeMap<_, _>>>()?;
    for (id, actor) in actors {
        let actor = actor.as_object_mut()?;
        let Some(contact) = actor.remove("contact") else {
            continue;
        };
        let mut contact = match contact {
            Value::Object(map) => map,
            _ => return None,
        };
        let trust = actor.get_mut("trust")?.as_object_mut()?;
        let mut expired = Vec::new();
        for (other, entry) in &mut contact {
            let [last, floor] = entry.as_array()?.as_slice() else {
                return None;
            };
            let last = last.as_u64()?;
            let floor = floor.as_u64()?;
            if places.get(other) == places.get(id) {
                *entry = json!([now, floor]);
            } else if now.checked_sub(last)? >= TRUST_FADE_TURNS {
                let mut amount = trust.get(other).and_then(Value::as_u64).unwrap_or(0);
                if amount > floor {
                    amount -= 1;
                    trust.insert(other.clone(), json!(amount));
                }
                if amount > floor {
                    *entry = json!([now, floor]);
                } else {
                    expired.push(other.clone());
                }
            }
        }
        for other in expired {
            contact.remove(&other);
        }
        if !contact.is_empty() {
            actor.insert("contact".into(), Value::Object(contact));
        }
    }
    Some(())
}

pub(super) fn projection(request: &Value) -> Option<Value> {
    let mut world = request.get("world")?.clone();
    fade_trust(&mut world)?;
    let mut response = json!({"ok":true});
    response["world"] = world;
    Some(response)
}
