use serde_json::{json, Map, Value};

pub(super) fn project(files: &Value) -> Option<Value> {
    let mut profiles = files["v2/card-game/entity-profiles.json"]
        .as_object()?
        .clone();
    let packs = files["v2/card-game/packs.json"]["packs"].as_array()?;
    for pack in packs {
        insert_pack(&mut profiles, pack)?;
    }
    for avatar in files["v2/card-game/shared-cast.json"]["avatars"].as_array()? {
        let id = avatar["id"].as_str()?;
        if id == "vale" {
            continue;
        }
        let home = &avatar["home"];
        let item = &avatar["item"];
        let name = item["name"].as_str()?;
        let effect = item["effect"].as_str()?;
        profiles.insert(
            id.into(),
            json!({"kind": "avatar", "name": avatar["name"], "seed": avatar["seed"]}),
        );
        profiles.insert(
            home["id"].as_str()?.into(),
            json!({"kind": "location", "name": home["name"], "persona": home["text"]}),
        );
        profiles.insert(
            item["id"].as_str()?.into(),
            json!({"kind": "item", "name": name, "persona": format!("{name}. {effect}.")}),
        );
    }
    insert_pack(&mut profiles, files.get("v2/card-game/boardyai.json")?)?;
    Some(Value::Object(profiles))
}

fn insert_pack(profiles: &mut Map<String, Value>, pack: &Value) -> Option<()> {
    for (collection, kind) in [
        ("items", "item"),
        ("places", "location"),
        ("avatars", "avatar"),
    ] {
        let Some(entities) = pack.get(collection) else {
            continue;
        };
        for (id, entity) in entities.as_object()? {
            let mut profile = json!({"kind": kind, "name": entity["name"]});
            if kind == "avatar" {
                if let Some(seed) = entity.get("seed") {
                    profile["seed"] = seed.clone();
                }
                if entity["expression"]
                    .as_str()
                    .is_some_and(|value| !value.is_empty())
                {
                    profile["expression"] = entity["expression"].clone();
                }
            } else if let Some(persona) = entity.get("persona") {
                profile["persona"] = persona.clone();
            }
            profiles.insert(id.clone(), profile);
        }
    }
    Some(())
}
