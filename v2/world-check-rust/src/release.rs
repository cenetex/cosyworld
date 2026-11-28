use super::{distinct, schema::Pack, valid_id};
use serde_json::Value;
use std::collections::BTreeMap;

pub(super) fn check(pack: &Pack) -> Result<(), String> {
    let problem = |message: &str| format!("{}: {message}", pack.id);
    let mut choices = BTreeMap::new();
    for choice in &pack.choices {
        let id = choice
            .get("id")
            .and_then(Value::as_str)
            .filter(|id| valid_id(id))
            .ok_or_else(|| problem("choice needs a valid id"))?;
        if choices.insert(id, choice).is_some() {
            return Err(problem(&format!("duplicate choice {id}")));
        }
    }
    let Some(release) = &pack.release else {
        return Ok(());
    };
    for (name, ids, known) in [
        (
            "places",
            &release.places,
            release.places.iter().all(|id| pack.places.contains_key(id)),
        ),
        (
            "avatars",
            &release.avatars,
            release
                .avatars
                .iter()
                .all(|id| pack.avatars.contains_key(id)),
        ),
        (
            "items",
            &release.items,
            release.items.iter().all(|id| pack.items.contains_key(id)),
        ),
        (
            "choices",
            &release.choices,
            release
                .choices
                .iter()
                .all(|id| choices.contains_key(id.as_str())),
        ),
    ] {
        if !distinct(ids) || !known {
            return Err(problem(&format!(
                "release {name} has duplicate or unknown ids"
            )));
        }
    }
    let recital_actor = pack
        .recital
        .as_ref()
        .and_then(|recital| recital.get("actor"))
        .and_then(Value::as_str);
    let includes = |ids: &[String], value: Option<&Value>| {
        value
            .and_then(Value::as_str)
            .is_some_and(|value| ids.iter().any(|id| id == value))
    };
    for id in &release.avatars {
        if !includes(&release.places, pack.avatars[id].get("place"))
            && recital_actor != Some(id.as_str())
        {
            return Err(problem(&format!(
                "released avatar {id} is outside its places"
            )));
        }
    }
    for id in &release.items {
        let holder = pack.items[id].get("holder");
        if !includes(&release.places, holder) && !includes(&release.avatars, holder) {
            return Err(problem(&format!(
                "released item {id} has an unavailable holder"
            )));
        }
    }
    for id in &release.choices {
        let choice = choices[id.as_str()];
        if !includes(&release.places, choice.get("at"))
            || ![&release.places, &release.avatars, &release.items]
                .into_iter()
                .any(|ids| includes(ids, choice.get("subject")))
        {
            return Err(problem(&format!("released choice {id} is unavailable")));
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn fixture() -> Value {
        json!({
            "schemaVersion": 1,
            "id": "forest",
            "packId": "cosyworld.forest",
            "revision": 1,
            "name": "Forest",
            "description": "A forest",
            "entry": "glade",
            "places": {"glade": {"name": "Glade", "exits": [], "backdrop": "glade.png"}},
            "avatars": {"hare": {"place": "glade"}},
            "items": {"ring": {"holder": "hare"}},
            "choices": [{"id": "ask", "at": "glade", "subject": "hare"}],
            "release": {"places": ["glade"], "avatars": ["hare"], "items": ["ring"], "choices": ["ask"]}
        })
    }

    fn validate(value: Value) -> Result<(), String> {
        check(&serde_json::from_value(value).unwrap())
    }

    #[test]
    fn checks_released_references_and_destinations() {
        assert!(validate(fixture()).is_ok());
        for (pointer, value, error) in [
            ("/release/items", json!(["ring", "ring"]), "release items"),
            ("/release/choices", json!(["absent"]), "release choices"),
            ("/avatars/hare/place", json!("pond"), "released avatar hare"),
            ("/items/ring/holder", json!("fox"), "released item ring"),
            ("/choices/0/subject", json!("fox"), "released choice ask"),
        ] {
            let mut input = fixture();
            *input.pointer_mut(pointer).unwrap() = value;
            assert!(validate(input).unwrap_err().contains(error));
        }
    }

    #[test]
    fn accepts_released_recital_actor_without_a_local_place() {
        let mut input = fixture();
        input["avatars"]["hare"]["place"] = json!("hall");
        input["recital"] = json!({"actor": "hare"});
        assert!(validate(input).is_ok());
    }
}
