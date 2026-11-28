use super::super::World;
use super::{directory, earned, read_portrait, sql_error, Result, RESIDENTS};
use rusqlite::Connection;
use serde_json::{json, Value};
use std::path::Path;

pub(in super::super) fn attach_ready_portraits(
    c: &Connection,
    world: &str,
    saved: &World,
    root: &Path,
    command: &mut Value,
) -> Result<()> {
    let Some(command) = command
        .as_object_mut()
        .filter(|command| command.get("op").is_some_and(|op| op == "play"))
    else {
        return Ok(());
    };
    command.remove("elysiumPortraits");
    if saved
        .version
        .strip_prefix("full-card-world/")
        .and_then(|version| version.parse::<u32>().ok())
        .is_none_or(|version| version < 230)
    {
        return Ok(());
    }
    let mut portraits = Vec::new();
    for resident in &RESIDENTS {
        let encounter = &saved.game["elysiumEncounters"][resident.id];
        let Some(returned_at) = encounter["returnedAt"].as_u64() else {
            continue;
        };
        if encounter["portraitReady"] == true
            || saved.game["items"][resident.token]["holder"] != resident.id
            || !earned(c, world, resident, true).map_err(sql_error)?
            || read_portrait(&directory(root, resident)).is_none()
        {
            continue;
        }
        portraits.push(json!({"resident":resident.id,"returnedAt":returned_at}));
    }
    if !portraits.is_empty() {
        command.insert("elysiumPortraits".into(), json!(portraits));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::super::super::{db, now, take_work};
    use super::super::hash;
    use super::*;
    use crate::card_shared::{full_store as store, store as world_store};
    use rusqlite::params;
    use std::{fs, io::Cursor, sync::Arc};

    fn twin_lens_return() -> Value {
        json!({"scatteredAt":7,"talkedAt":9,"returnedAt":21,"returnedBy":"vale"})
    }

    #[test]
    fn ready_portraits_require_verified_assets_and_the_return_in_this_world() {
        let c = Connection::open_in_memory().unwrap();
        store::schema_sqlite(&c).unwrap();
        let resident = &RESIDENTS[0];
        let root = std::env::temp_dir().join(format!("elysium-ready-{}", crate::random_hex(8)));
        let dir = directory(&root, resident);
        fs::create_dir_all(&dir).unwrap();
        let mut png = Cursor::new(Vec::new());
        image::DynamicImage::new_rgba8(1, 1)
            .write_to(&mut png, image::ImageFormat::Png)
            .unwrap();
        let png = png.into_inner();
        let file = dir.join(format!("{}.png", hash(&png)));
        fs::write(&file, b"corrupted PNG").unwrap();
        let mut save = World {
            version: "full-card-world/230".into(),
            game: json!({"items":{resident.token:{"holder":resident.id}},
                "elysiumEncounters":{resident.id:twin_lens_return()}}),
            present: [0; 8],
            claimed: [0; 8],
            pack: None,
        };
        let prepare = |world, saved: &World| {
            let mut command =
                json!({"op":"play","elysiumPortraits":[{"resident":"injected","returnedAt":42}]});
            attach_ready_portraits(&c, world, saved, &root, &mut command).unwrap();
            command["elysiumPortraits"].clone()
        };
        c.execute(
            "INSERT INTO card_full_elysium_receipts(world,resident,scattered,returned) VALUES(?,?,?,?)",
            params!["world", resident.id, 10, 20],
        ).unwrap();
        assert!(prepare("world", &save).is_null());
        fs::write(&file, png).unwrap();
        assert!(prepare("other-world", &save).is_null());
        save.version = "full-card-world/229".into();
        assert!(prepare("world", &save).is_null());
        save.version = "full-card-world/230".into();
        assert_eq!(
            prepare("world", &save),
            json!([{"resident":resident.id,"returnedAt":21}])
        );
        save.game["items"][resident.token]["holder"] = json!("station");
        assert!(prepare("world", &save).is_null());
        save.game["items"][resident.token]["holder"] = json!(resident.id);
        save.game["elysiumEncounters"][resident.id]["portraitReady"] = json!(true);
        assert!(prepare("world", &save).is_null());
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn shared_portrait_readiness_replays_without_the_png() {
        let root = std::env::temp_dir().join(format!("elysium-replay-{}", crate::random_hex(8)));
        fs::create_dir(&root).unwrap();
        let mut state = crate::test_app_state(Some(root.join("world.sqlite")));
        state.generated_asset_dir = Arc::new(root.join("generated"));
        let c = db(&state).unwrap();
        store::schema(&c).unwrap();
        let world = "a".repeat(48);
        world_store::create(&c, &world, "owner", now()).unwrap();
        c.execute(
            "INSERT INTO card_members(world,actor,user,seen) VALUES(?,0,'owner',?)",
            params![world, now()],
        )
        .unwrap();
        let resident = &RESIDENTS[1];
        let mut save = World::seeded(None, Some(17)).unwrap();
        save.game.as_object_mut().unwrap().remove("opening");
        save.game["eventSeq"] = json!(21);
        save.game["elysiumEncounters"] = json!({resident.id:twin_lens_return()});
        save.game["items"][resident.token]["holder"] = json!(resident.id);
        store::seed(&c, &world, &save, "portrait return fixture", now()).unwrap();
        c.execute(
            "INSERT INTO card_full_elysium_receipts(world,resident,scattered,returned) VALUES(?,?,?,?)",
            params![world, resident.id, 10, 20],
        ).unwrap();
        for op in ["claim", "enter"] {
            store::commit(
                &c,
                &world,
                &mut save,
                json!({"op":op,"actor":"vale"}),
                now(),
            )
            .unwrap();
        }
        let dir = directory(&state.generated_asset_dir, resident);
        fs::create_dir_all(&dir).unwrap();
        let mut png = Cursor::new(Vec::new());
        image::DynamicImage::new_rgba8(1, 1)
            .write_to(&mut png, image::ImageFormat::Png)
            .unwrap();
        let png = png.into_inner();
        fs::write(dir.join(format!("{}.png", hash(&png))), png).unwrap();
        let view = save.project(0).unwrap();
        let action = view["actions"]
            .as_array()
            .unwrap()
            .iter()
            .find(|action| action["kind"] == "wait")
            .unwrap()
            .clone();
        store::enqueue(
            &c,
            &world,
            "owner",
            &save,
            0,
            store::PlayRequest {
                action,
                key: "fixture-portrait-ready",
                revealed: None,
                surface: "browser",
            },
            now(),
        )
        .unwrap();
        assert!(take_work(&state, &world).unwrap().is_some());
        let expected = store::world(&c, &world, now()).unwrap();
        assert_eq!(
            expected.game["elysiumEncounters"][resident.id]["portraitReady"],
            true
        );
        fs::remove_dir_all(dir).unwrap();
        c.execute("DELETE FROM card_full_checkpoints WHERE world=?", [&world])
            .unwrap();
        assert_eq!(store::world(&c, &world, now()).unwrap(), expected);
        fs::remove_dir_all(root).unwrap();
    }
}
