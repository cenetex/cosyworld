use super::{
    engine, full, full_store,
    full_world::{self, actor_id, actor_index, World},
    store, *,
};
use serde_json::json;

// The authored Greek pack revision that an upgraded save should reach.
pub(super) fn greek_revision() -> Value {
    pack_revision("greek-drama")
}

pub(super) fn pack_revision(id: &str) -> Value {
    let catalog: Value =
        serde_json::from_str(include_str!("../../../card-game/packs.json")).unwrap();
    catalog["packs"]
        .as_array()
        .unwrap()
        .iter()
        .find(|pack| pack["id"] == id)
        .unwrap()["revision"]
        .clone()
}

pub(super) fn assert_saved_actors(current: &Value, old: &Value) {
    for (id, saved) in old.as_object().unwrap() {
        let mut actor = current[id].clone();
        actor["trust"]
            .as_object_mut()
            .unwrap()
            .retain(|other, trust| {
                if saved["trust"].get(other).is_some() {
                    true
                } else {
                    assert_eq!(*trust, json!(0));
                    false
                }
            });
        // The upgrade drops quest progress and gives every actor one want.
        let mut saved = saved.clone();
        saved.as_object_mut().unwrap().remove("progress");
        // Greek revision 12 retired the Underworld Landing into Colonus.
        for field in ["place", "home"] {
            if saved[field] == "greek-underworld" {
                saved[field] = json!("greek-colonus");
            }
        }
        for field in ["want", "xp", "visited", "talked", "metTurn", "gaveUp"] {
            actor.as_object_mut().unwrap().remove(field);
            saved.as_object_mut().unwrap().remove(field);
        }
        assert_eq!(actor, saved, "saved actor {id}");
    }
}

// The upgrade drops quest records from history, the way forgetQuests does.
pub(super) fn quest_free_log(log: &Value) -> Value {
    Value::Array(
        log.as_array()
            .unwrap()
            .iter()
            .filter(|e| {
                e["kind"] != "quest"
                    && !["drop-quest", "join-quest", "share-quest", "pursue"]
                        .contains(&e["verb"].as_str().unwrap_or(""))
            })
            .map(|e| {
                let mut e = e.clone();
                for key in ["questPlan", "consequence", "questKey"] {
                    e.as_object_mut().unwrap().remove(key);
                }
                e
            })
            .collect(),
    )
}

pub(super) fn assert_saved_memories(current: &Value, old: &Value) {
    for (id, saved) in old.as_object().unwrap() {
        // Lonely Forest revision 2 retires these things with their memories.
        if [
            "forest-story-button",
            "forest-dewbright-button",
            "forest-watch-bell",
        ]
        .contains(&id.as_str())
        {
            assert!(current.get(id).is_none(), "retired memory {id}");
            continue;
        }
        let mut retained = current[id].clone();
        if saved.get("seen").is_none() {
            retained.as_object_mut().unwrap().remove("seen");
        }
        assert_eq!(&retained, saved, "saved memory {id}");
    }
}

fn assert_saved_items(current: &Value, old: &Value) {
    for (id, saved) in super::saved_items::upgraded(old).as_object().unwrap() {
        assert_eq!(&current[id], saved, "saved item {id}");
    }
}

fn assert_saved_packs(current: &Value, old: &Value) {
    let mut expected = old.clone();
    expected["greek-drama"]["revision"] = greek_revision();
    expected["boardyai"] = current["boardyai"].clone();
    expected["hoppycat-archive"] = current["hoppycat-archive"].clone();
    expected["willows"] = current["willows"].clone();
    expected["lonely-forest"] = current["lonely-forest"].clone();
    assert_eq!(current, &expected);
}
fn fixture() -> (std::path::PathBuf, rusqlite::Connection, String) {
    let path =
        std::env::temp_dir().join(format!("full-card-world-{}.sqlite", crate::random_hex(12)));
    let c = store::open(&path).unwrap();
    full_store::schema(&c).unwrap();
    let id = "b".repeat(48);
    store::create(&c, &id, "owner", now()).unwrap();
    let world = World::create(None).unwrap();
    full_store::seed(&c, &id, &world, "test-create", now()).unwrap();
    (path, c, id)
}
#[test]
fn name_seed_reads_the_run_seed_and_falls_back_to_the_id() {
    let (_path, c, id) = fixture();
    let saved = full_store::world(&c, &id, now()).unwrap().game["run"]["seed"].as_u64();
    let expected = saved.map_or_else(|| full_world::run_seed(&id), |s| s as u32);
    assert_eq!(full_store::name_seed(&c, &id).unwrap(), expected);
    let shared = "c".repeat(48);
    store::create(&c, &shared, "owner", now()).unwrap();
    let w = World::seeded(None, Some(4_242)).unwrap();
    full_store::seed(&c, &shared, &w, "test-create", now()).unwrap();
    assert_eq!(full_store::name_seed(&c, &shared).unwrap(), 4_242);
    assert_eq!(
        full_store::name_seed(&c, "missing").unwrap(),
        full_world::run_seed("missing")
    );
}
fn body(op: &str, avatar: Option<&str>) -> full::Command {
    full::Command {
        op: op.into(),
        avatar: avatar.map(str::to_string),
        action: Value::Null,
        target: None,
        key: String::new(),
        moving: false,
    }
}
// An avatar is in one world at a time (#1846): a claim elsewhere empties its
// old seat, which starts over, and its level goes with it.
#[test]
fn a_claim_elsewhere_frees_the_old_seat_and_carries_the_level() {
    let path =
        std::env::temp_dir().join(format!("full-card-world-{}.sqlite", crate::random_hex(12)));
    let mut c = store::open(&path).unwrap();
    full_store::schema(&c).unwrap();
    let (first, second) = ("b".repeat(48), "c".repeat(48));
    // Mara has grown in the first world.
    let mut grown = World::create(None).unwrap();
    grown.game["actors"]["mara"]["carried"] = 6.into();
    grown.game["actors"]["mara"]["xp"] = 6.into();
    grown.game["actors"]["mara"]["level"] = 3.into();
    for (id, w) in [(&first, grown), (&second, World::create(None).unwrap())] {
        store::create(&c, id, "owner", now()).unwrap();
        full_store::seed(&c, id, &w, "test-create", now()).unwrap();
    }
    let tx = c.transaction().unwrap();
    full::run(&tx, &first, "u", &body("claim", Some("mara")), now()).unwrap();
    full::run(&tx, &second, "u", &body("claim", Some("mara")), now()).unwrap();
    let rows: Vec<String> = tx
        .prepare("SELECT world FROM card_bindings WHERE user='u'")
        .unwrap()
        .query_map([], |r| r.get(0))
        .unwrap()
        .map(|row| row.unwrap())
        .collect();
    assert_eq!(rows, vec![second.clone()]);
    let mara = actor_index("mara").unwrap();
    let old = full_store::world(&tx, &first, now()).unwrap();
    assert_eq!((old.claimed[mara], old.present[mara]), (0, 0));
    assert_eq!(old.game["actors"]["mara"]["xp"], 0);
    let new = full_store::world(&tx, &second, now()).unwrap();
    assert_eq!(new.claimed[mara], 1);
    assert_eq!(new.game["actors"]["mara"]["xp"], 6);
    assert_eq!(new.game["actors"]["mara"]["level"], 3);
    // Freed by the owner, Mara keeps her level for her next seat.
    full::run(&tx, &second, "owner", &body("reset", Some("mara")), now()).unwrap();
    let kept = super::bindings::take_progress(&tx, "u", mara).unwrap();
    assert_eq!(kept, Some(serde_json::json!({"xp":6,"level":3})));
}
#[test]
fn a_cosmetic_upgrade_stays_with_the_passkey_in_every_world() {
    let path =
        std::env::temp_dir().join(format!("full-card-world-{}.sqlite", crate::random_hex(12)));
    let mut c = store::open(&path).unwrap();
    full_store::schema(&c).unwrap();
    let (first, second) = ("d".repeat(48), "e".repeat(48));
    for id in [&first, &second] {
        store::create(&c, id, "owner", now()).unwrap();
        full_store::seed(&c, id, &World::create(None).unwrap(), "test-create", now()).unwrap();
    }
    let mara = actor_index("mara").unwrap();
    let tx = c.transaction().unwrap();
    full::run(&tx, &first, "u", &body("claim", Some("mara")), now()).unwrap();
    full::run(&tx, &first, "w", &body("claim", Some("vale")), now()).unwrap();
    // The rules gave Mara an upgrade here; her next committed play keeps it.
    // Vale's, from a scarf she was handed, is kept by the same play.
    let mut w = full_store::world(&tx, &first, now()).unwrap();
    w.game["actors"]["mara"]["upgrades"] = json!(["scarf"]);
    w.game["actors"]["vale"]["upgrades"] = json!(["scarf"]);
    let action = home_action(&w, mara, "take");
    full_store::commit(
        &tx,
        &first,
        &mut w,
        json!({"op":"play","actor":"mara","action":action}),
        now(),
    )
    .unwrap();
    assert_eq!(
        super::bindings::upgrades(&tx, "u", mara).unwrap(),
        vec!["scarf"]
    );
    let vale = actor_index("vale").unwrap();
    assert_eq!(
        super::bindings::upgrades(&tx, "w", vale).unwrap(),
        vec!["scarf"]
    );
    // Claimed in a second world, Mara arrives wearing it; it is never taken.
    full::run(&tx, &second, "u", &body("claim", Some("mara")), now()).unwrap();
    let new = full_store::world(&tx, &second, now()).unwrap();
    assert_eq!(new.game["actors"]["mara"]["upgrades"], json!(["scarf"]));
    full::run(&tx, &second, "owner", &body("reset", Some("mara")), now()).unwrap();
    assert_eq!(
        super::bindings::upgrades(&tx, "u", mara).unwrap(),
        vec!["scarf"]
    );
    // Another passkey taking Mara does not wear it, and replay agrees.
    full::run(&tx, &second, "v", &body("claim", Some("mara")), now()).unwrap();
    let other = full_store::world(&tx, &second, now()).unwrap();
    assert!(other.game["actors"]["mara"]["upgrades"].is_null());
    tx.execute("DELETE FROM card_full_checkpoints", []).unwrap();
    assert_eq!(full_store::world(&tx, &second, now()).unwrap(), other);
}
fn claim(c: &mut rusqlite::Connection, id: &str, a: usize) {
    let tx = c
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .unwrap();
    full::run(
        &tx,
        id,
        &format!("user{a}"),
        &body("claim", Some(actor_id(a))),
        now(),
    )
    .unwrap();
    tx.commit().unwrap();
}
#[test]
fn full_world_has_existing_residents_and_packs_and_replays_from_seed() {
    let (path, mut c, id) = fixture();
    for a in 0..8 {
        claim(&mut c, &id, a);
    }
    let before = full_store::world(&c, &id, now()).unwrap();
    assert!(before.game["actors"]["moth"].is_object());
    assert!(before.game["actors"]["keeper"].is_object());
    assert!(!before.game["packs"].as_object().unwrap().is_empty());
    assert_eq!(before.claimed, [1; 8]);
    drop(c);
    let c = store::open(&path).unwrap();
    full_store::schema(&c).unwrap();
    assert_eq!(full_store::world(&c, &id, now()).unwrap(), before);
    c.execute("DELETE FROM card_full_checkpoints", []).unwrap();
    assert_eq!(full_store::world(&c, &id, now()).unwrap(), before);
}
fn home_action(w: &World, actor: usize, kind: &str) -> Value {
    w.project(actor).unwrap()["actions"]
        .as_array()
        .unwrap()
        .iter()
        .find(|a| a["kind"] == kind)
        .unwrap()
        .clone()
}

#[test]
fn music_waits_for_each_avatars_first_committed_play_and_survives_reload() {
    let (path, mut c, id) = fixture();
    for a in 0..8 {
        claim(&mut c, &id, a);
    }
    let mut w = full_store::world(&c, &id, now()).unwrap();
    for a in 0..8 {
        let user = format!("user{a}");
        assert_eq!(
            full_store::snapshot(&c, &id, &user, now()).unwrap()["music_started"],
            false
        );
        assert!(full_store::commit(
            &c,
            &id,
            &mut w,
            json!({"op":"play","actor":actor_id(a),"action":{"key":"stale-card"}}),
            now(),
        )
        .is_err());
        assert_eq!(
            full_store::snapshot(&c, &id, &user, now()).unwrap()["music_started"],
            false
        );
        let action = home_action(&w, a, if a == 0 { "snuff" } else { "take" });
        full_store::commit(
            &c,
            &id,
            &mut w,
            json!({"op":"play","actor":actor_id(a),"action":action}),
            now(),
        )
        .unwrap();
        for other in 0..8 {
            assert_eq!(
                full_store::snapshot(&c, &id, &format!("user{other}"), now()).unwrap()
                    ["music_started"],
                other <= a,
            );
        }
    }
    drop(c);
    let mut c = store::open(&path).unwrap();
    full_store::schema(&c).unwrap();
    c.execute("DELETE FROM card_full_checkpoints", []).unwrap();
    for a in 0..8 {
        assert_eq!(
            full_store::snapshot(&c, &id, &format!("user{a}"), now()).unwrap()["music_started"],
            true
        );
    }
    let fresh = "c".repeat(48);
    store::create(&c, &fresh, "owner", now()).unwrap();
    full_store::seed(&c, &fresh, &World::create(None).unwrap(), "new-game", now()).unwrap();
    claim(&mut c, &fresh, 0);
    assert_eq!(
        full_store::snapshot(&c, &fresh, "user0", now()).unwrap()["music_started"],
        false
    );
}

#[test]
fn first_ship_signal_unlocks_shared_round_trips_and_replays() {
    let (path, c, id) = fixture();
    c.execute("DELETE FROM card_full_checkpoints", []).unwrap();
    c.execute("DELETE FROM card_full_log", []).unwrap();
    let mut w = World::create(None).unwrap();
    w.game.as_object_mut().unwrap().remove("opening");
    w.claimed = [1, 1, 0, 0, 0, 0, 0, 0];
    w.present = w.claimed;
    w.game["actors"]["vale"]["place"] = json!("pond");
    w.game["actors"]["mara"]["place"] = json!("greek-harbor");
    // The keeper watches the far dock during this transport fixture.
    w.game["actors"]["keeper"]["place"] = json!("greek-harbor");
    w.game["items"]["lamp"]["holder"] = json!("vale");
    w.game["items"]["lamp"]["lit"] = json!(true);
    w.game["items"]["lamp"]["fuel"] = json!(12);
    w.game["items"]["cloth"]["holder"] = json!("vale");
    for actor in [0, 1] {
        assert!(!w.project(actor).unwrap()["actions"]
            .as_array()
            .unwrap()
            .iter()
            .any(|a| a["target"] == "greek-ship"));
    }
    let before = w.clone();
    assert!(w
        .apply(&json!({"op":"play","actor":"mara","action":{"key":"move:mara::greek-ship"}}))
        .is_err());
    assert_eq!(w, before);
    w.game["actors"]["mara"]["place"] = json!("pond");
    full_store::seed(&c, &id, &w, "first-ship-signal", now()).unwrap();
    // One cover and one uncover of the burning lamp call the ship (#1625).
    for kind in ["cover", "take"] {
        assert_eq!(
            w.game["crossings"]["pond-greek-harbor"]["discovered"],
            false
        );
        let action = w.project(0).unwrap()["actions"]
            .as_array()
            .unwrap()
            .iter()
            .find(|a| {
                a["kind"] == kind
                    && a["item"] == "cloth"
                    && (kind != "cover" || a["target"] == "lamp")
            })
            .unwrap()
            .clone();
        full_store::commit(
            &c,
            &id,
            &mut w,
            json!({"op":"play","actor":"vale","action":action}),
            now(),
        )
        .unwrap();
    }
    assert_eq!(w.game["crossings"]["pond-greek-harbor"]["discovered"], true);
    let snuff = w.project(0).unwrap()["actions"]
        .as_array()
        .unwrap()
        .iter()
        .find(|a| a["kind"] == "snuff" && a["item"] == "lamp")
        .unwrap()
        .clone();
    full_store::commit(
        &c,
        &id,
        &mut w,
        json!({"op":"play","actor":"vale","action":snuff}),
        now(),
    )
    .unwrap();
    for target in ["greek-ship", "greek-harbor", "greek-ship", "pond"] {
        // A voyage is a course card, a round at sea and the Disembark card.
        for _ in 0..8 {
            if w.game["actors"]["mara"]["place"] == target {
                break;
            }
            let action = super::sea_steps::toward(&w.project(1).unwrap()["actions"], target);
            full_store::commit(
                &c,
                &id,
                &mut w,
                json!({"op":"play","actor":"mara","action":action}),
                now(),
            )
            .unwrap();
        }
        assert_eq!(w.game["actors"]["mara"]["place"], target);
    }
    assert_eq!(w.game["actors"]["mara"]["place"], "pond");
    assert_eq!(w.game["items"]["lamp"]["lit"], false);
    assert_eq!(w.game["crossings"]["pond-greek-harbor"]["discovered"], true);
    drop(c);
    let c = store::open(&path).unwrap();
    assert_eq!(full_store::world(&c, &id, now()).unwrap(), w);
    c.execute("DELETE FROM card_full_checkpoints", []).unwrap();
    assert_eq!(full_store::world(&c, &id, now()).unwrap(), w);
}

#[test]
fn released_ship_upgrade_keeps_npc_arrivals_locked_and_human_passengers_safe() {
    for passenger in [None, Some("moth"), Some("vale")] {
        let (_, c, id) = fixture();
        c.execute("DELETE FROM card_full_checkpoints", []).unwrap();
        c.execute("DELETE FROM card_full_log", []).unwrap();
        let old = engine::reduce_version(engine::SEVENTH_VERSION, json!({"op":"create"})).unwrap();
        let mut w = World {
            version: engine::SEVENTH_VERSION.into(),
            game: old["world"].clone(),
            claimed: [1, 0, 0, 0, 0, 0, 0, 0],
            present: [1, 0, 0, 0, 0, 0, 0, 0],
            pack: None,
        };
        w.game.as_object_mut().unwrap().remove("opening");
        w.game["actors"]["vale"]["place"] = json!("pond");
        w.game["items"]["lamp"]["holder"] = json!("greek-harbor");
        w.game["crossings"]["greek-harbor-pond"]["discovered"] = json!(true);
        if let Some(actor) = passenger {
            w.game["actors"][actor]["place"] = json!("greek-ship");
            w.game["transports"]["greek-ship"] =
                json!({"dock":null,"destination":"greek-harbor","recall":null});
        } else {
            w.game["transports"]["greek-ship"]["dock"] = json!("pond");
        }
        w.project(0).unwrap();
        full_store::seed(&c, &id, &w, "released-unsignaled-ship", now()).unwrap();
        let old_actors = w.game["actors"].clone();
        w = full_store::world(&c, &id, now()).unwrap();
        assert_saved_actors(&w.game["actors"], &old_actors);
        assert_eq!(
            w.game["crossings"]["pond-greek-harbor"]["discovered"],
            passenger == Some("vale")
        );
        if passenger != Some("vale") {
            assert!(!w.project(0).unwrap()["actions"]
                .as_array()
                .unwrap()
                .iter()
                .any(|a| a["target"] == "greek-ship"));
            let action = home_action(&w, 0, "wait");
            full_store::commit(
                &c,
                &id,
                &mut w,
                json!({"op":"play","actor":"vale","action":action}),
                now(),
            )
            .unwrap();
            assert_eq!(
                w.game["crossings"]["pond-greek-harbor"]["discovered"],
                false
            );
        }
        c.execute("DELETE FROM card_full_checkpoints", []).unwrap();
        assert_eq!(full_store::world(&c, &id, now()).unwrap(), w);
    }
}

#[test]
fn occupied_ship_upgrade_preserves_shared_boarding_return_riders_and_replay() {
    for version in [engine::FOURTH_VERSION, engine::SEVENTH_VERSION] {
        let path =
            std::env::temp_dir().join(format!("ship-upgrade-{}.sqlite", crate::random_hex(12)));
        let c = store::open(&path).unwrap();
        full_store::schema(&c).unwrap();
        let id = "f".repeat(48);
        store::create(&c, &id, "owner", now()).unwrap();
        let old = engine::reduce_version(version, json!({"op":"create"})).unwrap();
        let mut w = World {
            version: version.into(),
            game: old["world"].clone(),
            claimed: [1, 1, 0, 0, 0, 0, 0, 0],
            present: [1, 1, 0, 0, 0, 0, 0, 0],
            pack: None,
        };
        w.game.as_object_mut().unwrap().remove("opening");
        w.game["actors"]["vale"]["place"] = json!("pond");
        w.game["actors"]["mara"]["place"] = json!("pond");
        w.game["transports"]["greek-ship"]["dock"] = json!("pond");
        full_store::seed(&c, &id, &w, "released-ship", now()).unwrap();
        let sail = |world: &mut World, actor: usize, target: &str| {
            for _ in 0..8 {
                if world.game["actors"][actor_id(actor)]["place"] == target {
                    return;
                }
                let action =
                    super::sea_steps::toward(&world.project(actor).unwrap()["actions"], target);
                full_store::commit(
                    &c,
                    &id,
                    world,
                    json!({"op":"play","actor":actor_id(actor),"action":action}),
                    now(),
                )
                .unwrap();
            }
            panic!("{} never reached {target}", actor_id(actor));
        };
        sail(&mut w, 0, "greek-ship");
        assert!(w.game["transports"]["greek-ship"]["dock"].is_null());
        let old_log = w.game["log"].clone();
        w = full_store::world(&c, &id, now()).unwrap();
        assert_eq!(w.version, engine::VERSION);
        assert_eq!(w.game["log"], quest_free_log(&old_log));
        assert_eq!(w.game["transports"]["greek-ship"]["dock"], "pond");
        sail(&mut w, 1, "greek-ship");
        sail(&mut w, 0, "greek-harbor");
        assert_eq!(w.game["transports"]["greek-ship"]["dock"], "greek-harbor");
        sail(&mut w, 0, "greek-ship");
        // Mara rode in and stays aboard; Vale boarded here and sets the course.
        assert_eq!(w.game["actors"]["mara"]["place"], "greek-ship");
        assert_eq!(w.game["transports"]["greek-ship"]["phase"], "arrived");
        sail(&mut w, 0, "pond");
        sail(&mut w, 1, "pond");
        c.execute("DELETE FROM card_full_checkpoints", []).unwrap();
        assert_eq!(full_store::world(&c, &id, now()).unwrap(), w);
    }
}
#[test]
fn home_item_pickup_and_drop_control_authoritative_travel_and_replay() {
    for (actor, index, item, home, destination) in [
        ("mara", 1, "mask", "theatre", "pond"),
        ("rue", 5, "routes", "train", "pond"),
    ] {
        let (_path, mut c, id) = fixture();
        claim(&mut c, &id, index);
        let mut w = full_store::world(&c, &id, now()).unwrap();
        assert_eq!(w.game["items"][item]["holder"], home);
        assert!(!w.project(index).unwrap()["exits"]
            .as_array()
            .unwrap()
            .contains(&json!(destination)));
        let take = home_action(&w, index, "take");
        full_store::commit(
            &c,
            &id,
            &mut w,
            json!({"op":"play","actor":actor,"action":take}),
            now(),
        )
        .unwrap();
        let travel = home_action(&w, index, "move");
        assert_eq!(travel["target"], destination);
        let put_down = home_action(&w, index, "drop");
        full_store::commit(
            &c,
            &id,
            &mut w,
            json!({"op":"play","actor":actor,"action":put_down}),
            now(),
        )
        .unwrap();
        let before = w.clone();
        assert!(w
            .apply(&json!({"op":"play","actor":actor,"action":travel}))
            .is_err());
        assert_eq!(w, before);
        assert!(full::run(
            &c,
            &id,
            &format!("user{index}"),
            &body("upgrade", None),
            now()
        )
        .is_err());
        c.execute("DELETE FROM card_full_checkpoints", []).unwrap();
        let replayed = full_store::world(&c, &id, now()).unwrap();
        assert_eq!(replayed, before);
        assert!(!replayed.project(index).unwrap()["exits"]
            .as_array()
            .unwrap()
            .contains(&json!(destination)));
        let take = home_action(&w, index, "take");
        full_store::commit(
            &c,
            &id,
            &mut w,
            json!({"op":"play","actor":actor,"action":take}),
            now(),
        )
        .unwrap();
        let travel = home_action(&w, index, "move");
        assert_eq!(travel["target"], destination);
        full_store::commit(
            &c,
            &id,
            &mut w,
            json!({"op":"play","actor":actor,"action":travel}),
            now(),
        )
        .unwrap();
        assert_eq!(w.game["actors"][actor]["place"], destination);
        assert!(w.project(index).unwrap()["exits"]
            .as_array()
            .unwrap()
            .contains(&json!(home)));
        c.execute("DELETE FROM card_full_checkpoints", []).unwrap();
        assert_eq!(full_store::world(&c, &id, now()).unwrap(), w);
    }
}

#[test]
fn earlier_home_travel_replays_before_one_recorded_rules_upgrade() {
    let path = std::env::temp_dir().join(format!(
        "home-rules-upgrade-{}.sqlite",
        crate::random_hex(12)
    ));
    let c = store::open(&path).unwrap();
    full_store::schema(&c).unwrap();
    let id = "d".repeat(48);
    store::create(&c, &id, "owner", now()).unwrap();
    let result = engine::reduce_version(engine::LEGACY_VERSION, json!({"op":"create"})).unwrap();
    let mut old = World {
        version: engine::LEGACY_VERSION.into(),
        game: result["world"].clone(),
        claimed: [0; 8],
        present: [0; 8],
        pack: None,
    };
    full_store::seed(&c, &id, &old, "previous-rules", now()).unwrap();
    for a in [1, 2] {
        for op in ["claim", "enter"] {
            full_store::commit(
                &c,
                &id,
                &mut old,
                json!({"op":op,"actor":actor_id(a)}),
                now(),
            )
            .unwrap();
        }
        let action = home_action(&old, a, "drop");
        full_store::commit(
            &c,
            &id,
            &mut old,
            json!({"op":"play","actor":actor_id(a),"action":action}),
            now(),
        )
        .unwrap();
    }
    // Version 2 accepted this trip after Ash left the item on the home floor.
    let action = home_action(&old, 2, "move");
    full_store::commit(
        &c,
        &id,
        &mut old,
        json!({"op":"play","actor":"ash","action":action}),
        now(),
    )
    .unwrap();
    assert_eq!(old.game["actors"]["ash"]["place"], "pond");
    assert!(old.project(1).unwrap()["exits"]
        .as_array()
        .unwrap()
        .contains(&json!("pond")));
    let upgraded = full_store::world(&c, &id, now()).unwrap();
    assert_eq!(upgraded.version, engine::VERSION);
    assert_eq!(upgraded.game["turn"], old.game["turn"]);
    assert_eq!(
        upgraded.game["revision"].as_u64(),
        old.game["revision"].as_u64().map(|n| n + 1)
    );
    assert_saved_actors(&upgraded.game["actors"], &old.game["actors"]);
    assert_eq!(upgraded.game["log"], quest_free_log(&old.game["log"]));
    assert_eq!(upgraded.game["items"]["mask"], old.game["items"]["mask"]);
    assert_eq!(upgraded.claimed, old.claimed);
    assert_eq!(upgraded.present, old.present);
    assert!(!upgraded.project(1).unwrap()["exits"]
        .as_array()
        .unwrap()
        .contains(&json!("pond")));
    let nell_item = cast()["avatars"][3]["item"]["id"].as_str().unwrap();
    let nell_home = cast()["avatars"][3]["home"]["id"].as_str().unwrap();
    assert_eq!(upgraded.game["items"][nell_item]["holder"], nell_home);
    assert_eq!(full_store::world(&c, &id, now()).unwrap(), upgraded);
    drop(c);
    let c = store::open(&path).unwrap();
    full_store::schema(&c).unwrap();
    c.execute("DELETE FROM card_full_checkpoints", []).unwrap();
    assert_eq!(full_store::world(&c, &id, now()).unwrap(), upgraded);
    let upgrades: i64 = c.query_row(
        "SELECT count(*) FROM card_full_log WHERE world=? AND json_extract(command,'$.op')='upgrade'",
        [&id], |r| r.get(0),
    ).unwrap();
    assert_eq!(upgrades, 1);
}
#[test]
fn full_world_bard_visit_and_song_replay_from_the_journal() {
    let path = std::env::temp_dir().join(format!("bard-world-{}.sqlite", crate::random_hex(12)));
    let c = store::open(&path).unwrap();
    full_store::schema(&c).unwrap();
    let id = "d".repeat(48);
    store::create(&c, &id, "owner", now()).unwrap();
    let mut w = World::create(None).unwrap();
    // Set the Theban scene, then use real choices through the C interpreter.
    w.game.as_object_mut().unwrap().remove("opening");
    w.game["crossings"]["pond-greek-harbor"]["discovered"] = json!(true);
    w.game["actors"]["vale"]["place"] = json!("greek-courtyard");
    w.game["items"]["greek-water-jar"]["holder"] = json!("vale");
    // Every avatar now holds a want (#1700), and the Bard's would take it
    // off along the roads. Clearing it keeps the Bard content in the
    // courtyard while Vale's deeds enter its song.
    w.game["actors"]["greek-rhapsode"]["place"] = json!("greek-courtyard");
    w.game["actors"]["greek-rhapsode"]["want"] = json!(null);
    full_store::seed(&c, &id, &w, "bard-test", now()).unwrap();
    for op in ["claim", "enter"] {
        full_store::commit(&c, &id, &mut w, json!({"op":op,"actor":"vale"}), now()).unwrap();
    }
    // Giving Dione the jar returns it; Thebes has no story buttons.
    for (field, value) in [
        ("item", "greek-water-jar"),
        ("kind", "wait"),
        ("target", "greek-well"),
        ("target", "greek-courtyard"),
        ("target", "greek-rhapsode"),
    ] {
        let view = w.project(0).unwrap();
        let action = view["actions"]
            .as_array()
            .unwrap()
            .iter()
            .find(|a| {
                a[field] == value
                    && (value != "greek-rhapsode" || a["kind"] == "talk")
                    && (value != "greek-water-jar"
                        || (a["kind"] == "give" && a["target"] == "greek-baker"))
            })
            .unwrap()
            .clone();
        let result = full_store::commit(
            &c,
            &id,
            &mut w,
            json!({"op":"play","actor":"vale","action":action}),
            now(),
        )
        .unwrap();
        if value == "wait" {
            assert_eq!(
                w.game["actors"]["greek-rhapsode"]["place"],
                "greek-courtyard"
            );
        }
        if value == "greek-rhapsode" {
            assert_eq!(
                w.game["actors"]["greek-rhapsode"]["place"],
                "greek-courtyard"
            );
            let bard = result["context"]["entities"]
                .as_array()
                .unwrap()
                .iter()
                .find(|e| e["id"] == "greek-rhapsode")
                .unwrap();
            let stanza = bard["poem"]["stanzas"]
                .as_array()
                .unwrap()
                .iter()
                .find(|stanza| stanza["id"] == "greek-return-water-jar")
                .unwrap();
            assert_eq!(stanza["authorId"], "vale");
            assert_eq!(stanza["authorName"], "Vale");
            // Couplet text is lore, not dialogue context.
            assert!(stanza.get("lines").is_none());
            assert!(bard["poem"].get("newLines").is_none());
        }
    }
    drop(c);
    let c = store::open(&path).unwrap();
    assert_eq!(full_store::world(&c, &id, now()).unwrap(), w);
    c.execute("DELETE FROM card_full_checkpoints", []).unwrap();
    assert_eq!(full_store::world(&c, &id, now()).unwrap(), w);
}
#[test]
fn earlier_completed_quests_gain_a_pending_bard_visit_after_recorded_upgrade() {
    for version in [
        engine::LEGACY_VERSION,
        "full-card-world/3",
        "full-card-world/4",
    ] {
        let path =
            std::env::temp_dir().join(format!("bard-upgrade-{}.sqlite", crate::random_hex(12)));
        let c = store::open(&path).unwrap();
        full_store::schema(&c).unwrap();
        let id = "e".repeat(48);
        store::create(&c, &id, "owner", now()).unwrap();
        let old = engine::reduce_version(version, json!({"op":"create"})).unwrap();
        let mut w = World {
            version: version.into(),
            game: old["world"].clone(),
            claimed: [0; 8],
            present: [0; 8],
            pack: None,
        };
        w.game.as_object_mut().unwrap().remove("opening");
        w.game["crossings"]["pond-greek-harbor"]["discovered"] = json!(true);
        w.game["actors"]["vale"]["place"] = json!("greek-courtyard");
        w.game["items"]["greek-water-jar"]["holder"] = json!("vale");
        full_store::seed(&c, &id, &w, "earlier-song", now()).unwrap();
        for op in ["claim", "enter"] {
            full_store::commit(&c, &id, &mut w, json!({"op":op,"actor":"vale"}), now()).unwrap();
        }
        let view = w.project(0).unwrap();
        let action = view["actions"]
            .as_array()
            .unwrap()
            .iter()
            .find(|a| a["choiceId"] == "greek-return-water-jar")
            .unwrap()
            .clone();
        full_store::commit(
            &c,
            &id,
            &mut w,
            json!({"op":"play","actor":"vale","action":action}),
            now(),
        )
        .unwrap();
        if version == engine::LEGACY_VERSION {
            // A previously recorded 2 -> 3 upgrade still replays as it did then.
            full_store::commit(
                &c,
                &id,
                &mut w,
                json!({"op":"upgrade","from":version,"to":"full-card-world/3"}),
                now(),
            )
            .unwrap();
        }
        if w.version != "full-card-world/4" {
            let from = w.version.clone();
            full_store::commit(
                &c,
                &id,
                &mut w,
                json!({"op":"upgrade","from":from,"to":"full-card-world/4"}),
                now(),
            )
            .unwrap();
        }
        let previous = w.game.clone();
        let mut upgraded = full_store::world(&c, &id, now()).unwrap();
        assert_eq!(upgraded.version, engine::VERSION);
        assert_saved_actors(&upgraded.game["actors"], &previous["actors"]);
        assert_eq!(upgraded.game["log"], quest_free_log(&previous["log"]));
        assert_eq!(
            upgraded.game["packs"]["greek-drama"]["receipts"],
            previous["packs"]["greek-drama"]["receipts"]
        );
        assert_eq!(
            upgraded.game["packs"]["greek-drama"]["recitals"]["greek-return-water-jar"],
            json!({"actor":"vale","visit":null})
        );
        // Without a quest to follow, the Bard keeps its saved place; its own
        // want and the ordinary roads move it from there.
        let spawn = previous["actors"]["greek-rhapsode"]["place"].clone();
        assert_eq!(upgraded.game["actors"]["greek-rhapsode"]["place"], spawn);
        let view = upgraded.project(0).unwrap();
        let action = view["actions"]
            .as_array()
            .unwrap()
            .iter()
            .find(|a| a["kind"] == "move" && a["target"] == "greek-well")
            .unwrap()
            .clone();
        full_store::commit(
            &c,
            &id,
            &mut upgraded,
            json!({"op":"play","actor":"vale","action":action}),
            now(),
        )
        .unwrap();
        for _ in 0..2 {
            let action = home_action(&upgraded, 0, "wait");
            full_store::commit(
                &c,
                &id,
                &mut upgraded,
                json!({"op":"play","actor":"vale","action":action}),
                now(),
            )
            .unwrap();
        }
        // Content with no want, the Bard stays put and the visit stays pending.
        assert_eq!(upgraded.game["actors"]["greek-rhapsode"]["place"], spawn);
        assert!(upgraded.game["actors"]["greek-rhapsode"]["want"].is_null());
        assert_eq!(
            upgraded.game["packs"]["greek-drama"]["recitals"]["greek-return-water-jar"],
            json!({"actor":"vale","visit":null})
        );
        c.execute("DELETE FROM card_full_checkpoints", []).unwrap();
        assert_eq!(full_store::world(&c, &id, now()).unwrap(), upgraded);
    }
}
#[test]
fn full_world_c_guard_counts_humans_in_arbitrary_existing_rooms() {
    let mut w = World::create(None).unwrap();
    for a in 0..8 {
        w.apply(&json!({"op":"claim","actor":actor_id(a)})).unwrap();
    }
    // This fixture isolates the C presence guard from authored travel rules.
    for a in 0..8 {
        w.game["actors"][actor_id(a)]["place"] = json!("station");
    }
    for a in 0..4 {
        w.apply(&json!({"op":"enter","actor":actor_id(a)})).unwrap();
    }
    let before = w.clone();
    assert!(w.apply(&json!({"op":"enter","actor":actor_id(4)})).is_err());
    assert_eq!(w, before);
    w.apply(&json!({"op":"leave","actor":actor_id(0)})).unwrap();
    w.apply(&json!({"op":"enter","actor":actor_id(4)})).unwrap();
}
#[test]
fn full_world_claims_queue_authority_and_request_ids() {
    let (_path, mut c, id) = fixture();
    claim(&mut c, &id, 0);
    let mut b = body("play", None);
    b.key = "full-world-action-0001".into();
    let w = full_store::world(&c, &id, now()).unwrap();
    let view = w.project(0).unwrap();
    b.action = view["actions"]
        .as_array()
        .unwrap()
        .iter()
        .find(|a| a["kind"] == "wait")
        .unwrap()
        .clone();
    let tx = c
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .unwrap();
    full::run(&tx, &id, "user0", &b, now()).unwrap();
    full::run(&tx, &id, "user0", &b, now()).unwrap();
    let count: i32 = tx
        .query_row("SELECT count(*) FROM card_full_plays", [], |r| r.get(0))
        .unwrap();
    assert_eq!(count, 1);
    b.key = "full-world-action-0002".into();
    b.action["actor"] = json!("mara");
    assert!(full::run(&tx, &id, "user0", &b, now()).is_err());
    assert!(full::run(&tx, &id, "user0", &body("claim", Some("mara")), now()).is_err());
    tx.commit().unwrap();
}
#[test]
fn full_world_npc_turn_and_speech_survive_worker_restart() {
    let (path, mut c, id) = fixture();
    claim(&mut c, &id, 0);
    let w = full_store::world(&c, &id, now()).unwrap();
    let view = w.project(0).unwrap();
    let mut b = body("play", None);
    b.key = "worker-recovery-0001".into();
    b.action = view["actions"]
        .as_array()
        .unwrap()
        .iter()
        .find(|a| a["kind"] == "wait")
        .unwrap()
        .clone();
    let tx = c
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .unwrap();
    full::run(&tx, &id, "user0", &b, now()).unwrap();
    tx.commit().unwrap();
    let app = crate::test_app_state(crate::RuntimeWorld::seeded(), Some(path));
    let work = full::take_work(&app, &id).unwrap().unwrap();
    let before = full_store::world(&c, &id, now()).unwrap();
    assert_eq!(
        before.game["turn"].as_u64().unwrap(),
        w.game["turn"].as_u64().unwrap() + 1
    );
    assert!(work.context["context"].is_object());
    assert!(full::take_work(&app, &id).unwrap().is_none());
    c.execute("UPDATE card_full_plays SET until_at=0", [])
        .unwrap();
    let mut recovered = before.clone();
    full_store::expire(&c, &id, &mut recovered, now()).unwrap();
    assert_eq!(full_store::world(&c, &id, now()).unwrap().game, before.game);
    assert!(full::take_work(&app, &id).unwrap().is_none());
    let view = full_store::snapshot(&c, &id, "user0", now()).unwrap();
    assert!(view["history"][0]["error"].is_string());
    assert!(view["history"][0].get("context").is_none());
}
#[tokio::test]
async fn server_dialogue_keeps_a_legacy_browser_scene_through_retry_and_replay() {
    use crate::routes::card_game::narrative::browser;
    use axum::{
        body::Body,
        http::{Request, StatusCode},
    };
    use tower::ServiceExt;
    let (path, mut c, id) = fixture();
    claim(&mut c, &id, 0);
    let w = full_store::world(&c, &id, now()).unwrap();
    let mut b = body("play", None);
    b.key = "browser-funded-play-0001".into();
    b.action = home_action(&w, 0, "wait");
    full::run(&c, &id, "user0", &b, now()).unwrap();
    c.execute(
        "UPDATE card_full_plays SET narrative=? WHERE id=?",
        params![json!({"browser_chat":true}).to_string(), b.key],
    )
    .unwrap();
    let state = crate::test_app_state(crate::RuntimeWorld::seeded(), Some(path));
    let work = full::take_work(&state, &id).unwrap().unwrap();
    assert_eq!(work.context["browser_chat"], false);
    let projected = full_store::snapshot(&c, &id, "user0", now()).unwrap();
    assert_eq!(projected["queue"][0]["browser_chat"], false);
    assert_eq!(projected["queue"][0]["attempt"], 0);
    let response = full::router()
        .with_state(state.clone())
        .oneshot(
            Request::post(format!("/card-game/shared/worlds/{id}/browser-chat"))
                .header("content-type", "application/json")
                .body(Body::from(json!({"key":b.key}).to_string()))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
    full::finish_work(&state, &id, work, Err("Connect OpenRouter again.".into())).unwrap();
    let mut retry = body("retry", None);
    retry.key = b.key;
    full::run(&c, &id, "user0", &retry, now()).unwrap();
    let work = full::take_work(&state, &id).unwrap().unwrap();
    assert_eq!(work.context["browser_chat"], false);
    assert_eq!(
        full_store::snapshot(&c, &id, "user0", now()).unwrap()["queue"][0]["attempt"],
        1
    );
    let (payload, ids) = full_speech::prepared(0, &work.context).unwrap();
    let prepared = browser::prepare(&payload["scene"], Some(&ids), None).unwrap();
    assert!(prepared["calls"]
        .as_array()
        .unwrap()
        .iter()
        .all(|call| ids.iter().any(|id| call["id"] == *id)));
    let answers = serde_json::from_value(
        json!([{"id":"vale","part":"line","text":"I hear you.","finish":"stop"}]),
    )
    .unwrap();
    let checked = browser::complete(&payload["scene"], Some(&ids), answers).unwrap();
    let lines = full_speech::parse(&checked.to_string(), "stop", &work.context, 0, &ids).unwrap();
    full::finish_work(&state, &id, work, Ok(lines)).unwrap();
    let expected = full_store::world(&c, &id, now()).unwrap();
    assert!(expected.game["log"]
        .as_array()
        .unwrap()
        .iter()
        .any(|e| e["text"] == "I hear you."));
    c.execute("DELETE FROM card_full_checkpoints", []).unwrap();
    assert_eq!(full_store::world(&c, &id, now()).unwrap(), expected);
}
#[test]
fn server_dialogue_resumes_a_working_browser_scene_and_fences_its_old_reply() {
    let (path, mut c, id) = fixture();
    claim(&mut c, &id, 0);
    let w = full_store::world(&c, &id, now()).unwrap();
    let mut b = body("play", None);
    b.key = "legacy-browser-working-0001".into();
    b.action = home_action(&w, 0, "wait");
    full::run(&c, &id, "user0", &b, now()).unwrap();
    let state = crate::test_app_state(crate::RuntimeWorld::seeded(), Some(path));
    let old = full::take_work(&state, &id).unwrap().unwrap();
    let saved = old.context["context"].clone();
    let committed = full_store::world(&c, &id, now()).unwrap();
    c.execute(
        "UPDATE card_full_plays SET narrative=json_set(narrative,'$.browser_chat',json('true')) WHERE id=?",
        [&b.key],
    ).unwrap();
    let resumed = full::take_work(&state, &id).unwrap().unwrap();
    assert_eq!(resumed.id, old.id);
    assert_eq!(resumed.context["context"], saved);
    assert_eq!(resumed.context["browser_chat"], false);
    assert_eq!(full_store::world(&c, &id, now()).unwrap(), committed);
    full::finish_work(&state, &id, old, Err("Old browser reply".into())).unwrap();
    let view = full_store::snapshot(&c, &id, "user0", now()).unwrap();
    assert_eq!(view["queue"][0]["status"], "working");
    assert_eq!(view["queue"][0]["attempt"], 1);
    assert!(view["history"].as_array().unwrap().is_empty());
    assert!(full::take_work(&state, &id).unwrap().is_none());
}
#[test]
fn legacy_invitation_migrates_claims_and_items_once() {
    let path = std::env::temp_dir().join(format!("card-migrate-{}.sqlite", crate::random_hex(12)));
    let c = store::open(&path).unwrap();
    full_store::schema(&c).unwrap();
    let id = "c".repeat(48);
    store::create(&c, &id, "owner", now()).unwrap();
    let mut old = kernel::World::new();
    for kind in [1, 3] {
        store::commit(
            &c,
            &id,
            &mut old,
            kernel::Action {
                kind,
                actor: 0,
                item: -1,
                target: -1,
            },
            now(),
        )
        .unwrap();
    }
    c.execute(
        "INSERT INTO card_members(world,actor,user,seen) VALUES(?,0,'owner',?)",
        params![id, now()],
    )
    .unwrap();
    let memory = json!({"play":"old-shared-scene","actor":0,"room":0,"turn":1,"action":"Vale waits.","lines":[{"speaker":"Vale","text":"I remember the light on the water."},{"speaker":"Pond","text":"The reeds move softly."}],"starts_at":1234,"until_at":8234,"error":null});
    c.execute(
        "INSERT INTO card_scenes(world,room,play,content) VALUES(?,0,'old-shared-scene',?)",
        params![id, memory.to_string()],
    )
    .unwrap();
    let w = full_store::world(&c, &id, now()).unwrap();
    assert_eq!(w.claimed[0], 1);
    assert_eq!(w.game["items"]["lamp"]["holder"], "vale");
    assert!(w.game["actors"]["moth"].is_object());
    assert_eq!(full_store::world(&c, &id, now()).unwrap(), w);
    let preserved: String = c
        .query_row(
            "SELECT content FROM card_full_scenes WHERE world=? AND play='old-shared-scene'",
            [&id],
            |r| r.get(0),
        )
        .unwrap();
    let preserved: Value = serde_json::from_str(&preserved).unwrap();
    assert_eq!(preserved["room"], "pond");
    assert_eq!(preserved["starts_at"], 1234);
    assert_eq!(preserved["until_at"], 8234);
    assert_eq!(preserved["lines"][0]["text"], memory["lines"][0]["text"]);
    assert!(w.game["log"]
        .as_array()
        .unwrap()
        .iter()
        .any(|line| line["text"] == memory["lines"][0]["text"]
            && line["seq"] == preserved["lines"][0]["seq"]));
    c.execute("DELETE FROM card_full_checkpoints", []).unwrap();
    assert_eq!(full_store::world(&c, &id, now()).unwrap(), w);
    let scenes: i32 = c
        .query_row(
            "SELECT count(*) FROM card_full_scenes WHERE world=?",
            [&id],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(scenes, 1);
    let count: i32 = c
        .query_row(
            "SELECT count(*) FROM card_full_log WHERE world=?",
            [&id],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(count, 1);
}
#[test]
fn imported_save_cannot_supply_server_claims_or_authority() {
    let result = engine::reduce(
        json!({"op":"create","save":"{\"claimed\":[1,1,1,1,1,1,1,1],\"present\":[1]}"}),
    );
    assert!(result.is_err());
}

#[test]
fn full_world_shared_speech_is_journaled_with_matching_log_sequences() {
    for with_scenery in [false, true] {
        let (path, mut c, id) = fixture();
        claim(&mut c, &id, 0);
        let w = full_store::world(&c, &id, now()).unwrap();
        let mut b = body("play", None);
        b.key = "shared-speech-0001".into();
        b.action = w.project(0).unwrap()["actions"]
            .as_array()
            .unwrap()
            .iter()
            .find(|a| a["kind"] == "wait")
            .unwrap()
            .clone();
        let tx = c
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .unwrap();
        full::run(&tx, &id, "user0", &b, now()).unwrap();
        tx.commit().unwrap();
        let state = crate::test_app_state(crate::RuntimeWorld::seeded(), Some(path));
        let work = full::take_work(&state, &id).unwrap().unwrap();
        assert_eq!(work.context["context"]["scenery"], false);
        let mut lines = json!([{"speaker":"Vale","actorId":"vale","entityId":"vale","text":"I could stay a little longer."}]);
        if with_scenery {
            lines.as_array_mut().unwrap().push(json!({"speaker":"Empty station","actorId":null,"entityId":work.room,"text":"A moth circles the glass."}));
        }
        full::finish_work(&state, &id, work, Ok(lines)).unwrap();
        let expected = full_store::world(&c, &id, now()).unwrap();
        let snap = full_store::snapshot(&c, &id, "user0", now()).unwrap();
        let lines = snap["history"][0]["lines"].as_array().unwrap();
        assert_eq!(lines.len(), if with_scenery { 2 } else { 1 });
        for line in lines {
            assert!(expected.game["log"]
                .as_array()
                .unwrap()
                .iter()
                .any(|e| e["seq"] == line["seq"] && e["text"] == line["text"]));
        }
        c.execute("DELETE FROM card_full_checkpoints", []).unwrap();
        assert_eq!(full_store::world(&c, &id, now()).unwrap(), expected);
    }
}

#[test]
fn shared_speech_retry_reuses_committed_play_without_another_turn() {
    let (path, mut c, id) = fixture();
    claim(&mut c, &id, 0);
    let w = full_store::world(&c, &id, now()).unwrap();
    let mut b = body("play", None);
    b.key = "speech-retry-000001".into();
    b.action = w.project(0).unwrap()["actions"]
        .as_array()
        .unwrap()
        .iter()
        .find(|a| a["kind"] == "wait")
        .unwrap()
        .clone();
    let tx = c
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .unwrap();
    full::run(&tx, &id, "user0", &b, now()).unwrap();
    tx.commit().unwrap();
    let app = crate::test_app_state(crate::RuntimeWorld::seeded(), Some(path));
    let work = full::take_work(&app, &id).unwrap().unwrap();
    let stale_attempt = work.clone();
    full::finish_work(
        &app,
        &id,
        work,
        Err("The story service is warming up.".into()),
    )
    .unwrap();
    let committed = full_store::world(&c, &id, now()).unwrap();
    let mut retry = body("retry", None);
    retry.key = b.key;
    let tx = c
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .unwrap();
    full::run(&tx, &id, "user0", &retry, now()).unwrap();
    tx.commit().unwrap();
    let work = full::take_work(&app, &id).unwrap().unwrap();
    full::finish_work(
        &app,
        &id,
        stale_attempt,
        Err("An earlier attempt finished late.".into()),
    )
    .unwrap();
    let status: String = c
        .query_row(
            "SELECT status FROM card_full_plays WHERE id=?",
            [&retry.key],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(status, "working");
    assert_eq!(
        full_store::world(&c, &id, now()).unwrap().game,
        committed.game
    );
    let lines = json!([{"speaker":"Vale","actorId":"vale","entityId":"vale","text":"The quiet suits me."},{"speaker":"Empty station","actorId":null,"entityId":work.room,"text":"A moth circles the glass."}]);
    full::finish_work(&app, &id, work, Ok(lines)).unwrap();
    let after = full_store::world(&c, &id, now()).unwrap();
    assert_eq!(after.game["turn"], committed.game["turn"]);
    assert_eq!(after.game["items"], committed.game["items"]);
    let count: i32 = c
        .query_row("SELECT count(*) FROM card_full_scenes", [], |r| r.get(0))
        .unwrap();
    assert_eq!(count, 1);
}

#[test]
fn shared_speech_publication_retries_a_write_lock_with_the_original_reply() {
    let (path, mut c, id) = fixture();
    c.pragma_update(None, "journal_mode", "WAL").unwrap();
    for a in 0..2 {
        claim(&mut c, &id, a);
        let world = full_store::world(&c, &id, now()).unwrap();
        let mut command = body("play", None);
        command.key = format!("publication-lock-{a:04}");
        command.action = home_action(&world, a, "wait");
        let tx = c
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .unwrap();
        full::run(&tx, &id, &format!("user{a}"), &command, now()).unwrap();
        tx.commit().unwrap();
    }
    let app = crate::test_app_state(crate::RuntimeWorld::seeded(), Some(path.clone()));
    let work = full::take_work(&app, &id).unwrap().unwrap();
    assert_eq!(work.actor, 0);
    let evidence: Vec<Value> = work.context["context"]["entities"]
        .as_array()
        .unwrap()
        .iter()
        .find(|entity| entity["id"] == "vale")
        .unwrap()["memories"]
        .as_array()
        .unwrap()
        .iter()
        .filter(|memory| memory["kind"] == "event")
        .map(|memory| memory["seq"].clone())
        .collect();
    let reflection = json!({
        "thought":"I have time to listen.",
        "persona":"I listen closely to the people near me.",
        "models":{"thought":"private-fixture","persona":"private-fixture"},
        "evidence":evidence,
    });
    let lines = json!([{"speaker":"Vale","actorId":"vale","entityId":"vale",
        "text":"I pause for 60 quiet breaths.","model":"fixed-fixture-model","reflection":reflection}]);
    let before = full_store::world(&c, &id, now()).unwrap();
    let (locked, ready) = std::sync::mpsc::channel();
    let blocker = std::thread::spawn(move || {
        let mut connection = store::open(&path).unwrap();
        let tx = connection
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .unwrap();
        locked.send(()).unwrap();
        std::thread::sleep(std::time::Duration::from_millis(250));
        tx.commit().unwrap();
    });
    ready.recv().unwrap();
    full::finish_work_with_lock_budget(
        &app,
        &id,
        work.clone(),
        Ok(lines.clone()),
        std::time::Duration::from_secs(3),
    )
    .unwrap();
    blocker.join().unwrap();
    full::finish_work(&app, &id, work.clone(), Ok(lines.clone())).unwrap();
    let after = full_store::world(&c, &id, now()).unwrap();
    assert_eq!(after.game["turn"], before.game["turn"]);
    assert_eq!(
        after.game["memories"]["vale"]["innerLife"]["thoughts"][0]["text"],
        reflection["thought"]
    );
    let commands: Vec<String> = c
        .prepare("SELECT command FROM card_full_log WHERE json_extract(command,'$.op')='speech'")
        .unwrap()
        .query_map([], |row| row.get(0))
        .unwrap()
        .collect::<rusqlite::Result<_>>()
        .unwrap();
    assert_eq!(commands.len(), 1);
    let published: Value = serde_json::from_str(&commands[0]).unwrap();
    assert_eq!(published["lines"], lines);
    let (status, retries): (String, i32) = c
        .query_row(
            "SELECT status,retries FROM card_full_plays WHERE id=?",
            [&work.id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .unwrap();
    assert_eq!(status, "playing");
    assert_eq!(retries, 0, "The original speech attempt stays unchanged.");
    assert_eq!(
        c.query_row("SELECT count(*) FROM card_full_scenes", [], |row| row
            .get::<_, i64>(0))
            .unwrap(),
        1
    );
    c.execute(
        "UPDATE card_full_plays SET until_at=0 WHERE id=?",
        [&work.id],
    )
    .unwrap();
    let next = full::take_work(&app, &id).unwrap().unwrap();
    assert_eq!(next.actor, 1);
    assert_eq!(
        full_store::world(&c, &id, now()).unwrap().game["turn"]
            .as_u64()
            .unwrap(),
        before.game["turn"].as_u64().unwrap() + 1
    );
}

#[test]
fn shared_speech_publication_reports_an_exhausted_write_lock_budget() {
    let (path, mut c, id) = fixture();
    c.pragma_update(None, "journal_mode", "WAL").unwrap();
    claim(&mut c, &id, 0);
    let world = full_store::world(&c, &id, now()).unwrap();
    let mut command = body("play", None);
    command.key = "publication-lock-exhausted".into();
    command.action = home_action(&world, 0, "wait");
    let tx = c
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .unwrap();
    full::run(&tx, &id, "user0", &command, now()).unwrap();
    tx.commit().unwrap();
    let app = crate::test_app_state(crate::RuntimeWorld::seeded(), Some(path.clone()));
    let work = full::take_work(&app, &id).unwrap().unwrap();
    let lines = json!([{"speaker":"Vale","actorId":"vale","entityId":"vale","text":"I have a moment to listen."}]);
    let mut connection = store::open(&path).unwrap();
    let held = connection
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .unwrap();
    assert!(full::finish_work_with_lock_budget(
        &app,
        &id,
        work.clone(),
        Ok(lines.clone()),
        std::time::Duration::from_millis(150)
    )
    .is_err());
    held.commit().unwrap();
    let (status, retries): (String, i32) = c
        .query_row(
            "SELECT status,retries FROM card_full_plays WHERE id=?",
            [&work.id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .unwrap();
    assert_eq!(status, "working");
    assert_eq!(
        retries, 0,
        "A lock timeout keeps the original speech attempt."
    );
    assert_eq!(
        c.query_row("SELECT count(*) FROM card_full_scenes", [], |row| row
            .get::<_, i64>(0))
            .unwrap(),
        0
    );
    full::finish_work(&app, &id, work, Ok(lines)).unwrap();
    assert_eq!(
        c.query_row("SELECT count(*) FROM card_full_scenes", [], |row| row
            .get::<_, i64>(0))
            .unwrap(),
        1
    );
}
#[test]
fn existing_save_progress_and_inventory_are_preserved_on_share() {
    let mut w = World::create(None).unwrap();
    w.apply(&json!({"op":"claim","actor":"vale"})).unwrap();
    w.apply(&json!({"op":"enter","actor":"vale"})).unwrap();
    for _ in 0..3 {
        let view = w.project(0).unwrap();
        let action = view["actions"]
            .as_array()
            .unwrap()
            .iter()
            .find(|a| a["kind"] == "wait")
            .unwrap()
            .clone();
        w.apply(&json!({"op":"play","actor":"vale","action":action}))
            .unwrap();
    }
    let save = w.game.to_string();
    let imported = World::create(Some(&save)).unwrap();
    assert_eq!(imported.game["turn"], w.game["turn"]);
    assert_eq!(imported.game["items"], w.game["items"]);
    assert_eq!(imported.game["actors"], w.game["actors"]);
    assert_eq!(imported.claimed, [0; 8]);
    assert_eq!(imported.present, [0; 8]);
}

#[test]
fn cached_views_follow_actor_claim_presence_and_committed_turn_changes() {
    let mut w = World::create(None).unwrap();
    w.apply(&json!({"op":"claim","actor":"vale"})).unwrap();
    w.apply(&json!({"op":"enter","actor":"vale"})).unwrap();
    let first = w.project(0).unwrap();
    assert_eq!(w.project(0).unwrap(), first);
    w.apply(&json!({"op":"claim","actor":"mara"})).unwrap();
    w.apply(&json!({"op":"enter","actor":"mara"})).unwrap();
    let claimed = w.project(0).unwrap();
    assert!(claimed["world"]["controlledActors"]
        .as_array()
        .unwrap()
        .contains(&json!("mara")));
    assert!(claimed["world"]["presentActors"]
        .as_array()
        .unwrap()
        .contains(&json!("mara")));
    assert_eq!(w.project(1).unwrap()["world"]["playerActorId"], "mara");
    assert_eq!(w.project(0).unwrap()["world"]["playerActorId"], "vale");
    w.apply(&json!({"op":"leave","actor":"mara"})).unwrap();
    let absent = w.project(0).unwrap();
    assert!(!absent["world"]["presentActors"]
        .as_array()
        .unwrap()
        .contains(&json!("mara")));
    let action = absent["actions"]
        .as_array()
        .unwrap()
        .iter()
        .find(|a| a["kind"] == "wait")
        .unwrap()
        .clone();
    w.apply(&json!({"op":"play","actor":"vale","action":action}))
        .unwrap();
    let after = w.project(0).unwrap();
    assert_eq!(
        after["world"]["turn"].as_u64().unwrap(),
        first["world"]["turn"].as_u64().unwrap() + 1
    );
    assert_eq!(w.project(0).unwrap(), after);
    w.apply(&json!({"op":"release","actor":"mara"})).unwrap();
    assert!(!w.project(0).unwrap()["world"]["controlledActors"]
        .as_array()
        .unwrap()
        .contains(&json!("mara")));
}

#[test]
fn unchanged_snapshots_leave_the_checkpoint_and_journal_untouched() {
    let (_path, mut c, id) = fixture();
    claim(&mut c, &id, 0);
    let before: i64 = c
        .query_row("SELECT total_changes()", [], |r| r.get(0))
        .unwrap();
    let first = full_store::snapshot(&c, &id, "user0", 1234).unwrap();
    let second = full_store::snapshot(&c, &id, "user0", 2234).unwrap();
    let after: i64 = c
        .query_row("SELECT total_changes()", [], |r| r.get(0))
        .unwrap();
    assert_eq!(before, after);
    assert_eq!(first["world"], second["world"]);
    assert_eq!(second["now"], 2234);
    assert_eq!(first["now"], 1234);
    let mut play = body("play", None);
    play.key = "fresh-queue-cached-view".into();
    play.action = first["actions"]
        .as_array()
        .unwrap()
        .iter()
        .find(|a| a["kind"] == "wait")
        .unwrap()
        .clone();
    full::run(&c, &id, "user0", &play, now()).unwrap();
    let queued = full_store::snapshot(&c, &id, "user0", now()).unwrap();
    assert_eq!(first["music_started"], false);
    assert_eq!(queued["music_started"], false);
    assert_eq!(queued["world"], first["world"]);
    assert_eq!(first["queue"].as_array().unwrap().len(), 0);
    assert_eq!(queued["queue"].as_array().unwrap().len(), 1);
}

#[test]
fn old_rule_history_upgrades_once_and_replays_with_either_checkpoint_path() {
    for version in [
        engine::LEGACY_VERSION,
        engine::PREVIOUS_VERSION,
        engine::FOURTH_VERSION,
    ] {
        let mut checkpointed = None;
        for keep_checkpoint in [true, false] {
            let (_path, c, id) = fixture();
            c.execute("DELETE FROM card_full_checkpoints", []).unwrap();
            c.execute("DELETE FROM card_full_log", []).unwrap();
            let result = engine::reduce_version(version, json!({"op":"create"})).unwrap();
            let mut old = World {
                version: version.into(),
                game: result["world"].clone(),
                claimed: [0; 8],
                present: [0; 8],
                pack: None,
            };
            old.game["turn"] = json!(2);
            old.game["revision"] = json!(2);
            old.game["life"]["actors"]["vale"]["experiences"] = json!([
                {"kind":"care","key":"care:lamp:oil:station","turn":1,"points":2}
            ]);
            full_store::seed(&c, &id, &old, "old-full-world", now()).unwrap();
            for a in 0..8 {
                full_store::commit(
                    &c,
                    &id,
                    &mut old,
                    json!({"op":"claim","actor":actor_id(a)}),
                    now(),
                )
                .unwrap();
            }
            full_store::commit(
                &c,
                &id,
                &mut old,
                json!({"op":"enter","actor":"vale"}),
                now(),
            )
            .unwrap();
            let wait = old.project(0).unwrap()["actions"]
                .as_array()
                .unwrap()
                .iter()
                .find(|a| a["kind"] == "wait")
                .unwrap()
                .clone();
            full_store::commit(
                &c,
                &id,
                &mut old,
                json!({"op":"play","actor":"vale","action":wait}),
                now(),
            )
            .unwrap();
            if !keep_checkpoint {
                c.execute("DELETE FROM card_full_checkpoints", []).unwrap();
            }
            let upgraded = full_store::world(&c, &id, now()).unwrap();
            // The checkpoint path must reach the same upgraded world; the rest of
            // the case runs once, from the journal.
            if keep_checkpoint {
                checkpointed = Some(upgraded.clone());
                continue;
            }
            assert_eq!(Some(&upgraded), checkpointed.as_ref());
            assert_eq!(upgraded.version, engine::VERSION);
            assert_eq!(upgraded.claimed, [1; 8]);
            assert_eq!(upgraded.present, old.present);
            assert_saved_actors(&upgraded.game["actors"], &old.game["actors"]);
            assert_saved_items(&upgraded.game["items"], &old.game["items"]);
            assert_eq!(upgraded.game["log"], quest_free_log(&old.game["log"]));
            // Life version 3 keeps experiences and drops quest collections.
            assert_eq!(upgraded.game["life"]["version"], 3);
            assert_eq!(
                upgraded.game["life"]["actors"]["vale"]["experiences"][0],
                json!({"kind":"care","turn":1,"other":null,"item":"lamp","place":"station"})
            );
            assert_eq!(full_store::world(&c, &id, now()).unwrap(), upgraded);
            c.execute("DELETE FROM card_full_checkpoints", []).unwrap();
            assert_eq!(full_store::world(&c, &id, now()).unwrap(), upgraded);
            let mut continued = upgraded.clone();
            let wait = continued.project(0).unwrap()["actions"]
                .as_array()
                .unwrap()
                .iter()
                .find(|action| action["kind"] == "wait")
                .unwrap()
                .clone();
            full_store::commit(
                &c,
                &id,
                &mut continued,
                json!({"op":"play","actor":"vale","action":wait}),
                now(),
            )
            .unwrap();
            let room = continued.room(0).unwrap().to_string();
            full_store::commit(
                &c,
                &id,
                &mut continued,
                json!({"op":"speech","actor":"vale","room":room,"lines":[
                    {"actorId":"vale","text":"I have time to choose my next step."},
                    {"actorId":null,"entityId":room,"text":"A small light rests by the wall."}
                ]}),
                now(),
            )
            .unwrap();
            assert_eq!(
                continued.game["turn"].as_u64().unwrap(),
                upgraded.game["turn"].as_u64().unwrap() + 1
            );
            assert!(continued.game["life"]["actors"]["vale"]
                .get("collection")
                .is_none());
            assert!(continued.game["log"]
                .as_array()
                .unwrap()
                .iter()
                .any(|entry| entry["text"] == "I have time to choose my next step."));
            c.execute("DELETE FROM card_full_checkpoints", []).unwrap();
            assert_eq!(full_store::world(&c, &id, now()).unwrap(), continued);
            let upgrades: i64 = c
            .query_row(
                "SELECT count(*) FROM card_full_log WHERE json_extract(command,'$.op')='upgrade'",
                [],
                |r| r.get(0),
            )
            .unwrap();
            assert_eq!(upgrades, 1);
        }
    }
}

#[test]
fn released_pickup_journal_replays_through_both_recorded_upgrades() {
    let mut checkpointed = None;
    for keep_checkpoint in [true, false] {
        let (_path, c, id) = fixture();
        c.execute("DELETE FROM card_full_checkpoints", []).unwrap();
        c.execute("DELETE FROM card_full_log", []).unwrap();
        let result =
            engine::reduce_version(engine::LEGACY_VERSION, json!({"op":"create"})).unwrap();
        let mut old = World {
            version: engine::LEGACY_VERSION.into(),
            game: result["world"].clone(),
            claimed: [0; 8],
            present: [0; 8],
            pack: None,
        };
        full_store::seed(&c, &id, &old, "version-two-seed", now()).unwrap();
        for op in ["claim", "enter"] {
            full_store::commit(&c, &id, &mut old, json!({"op":op,"actor":"mara"}), now()).unwrap();
        }
        let drop = home_action(&old, 1, "drop");
        full_store::commit(
            &c,
            &id,
            &mut old,
            json!({"op":"play","actor":"mara","action":drop}),
            now(),
        )
        .unwrap();
        full_store::commit(
            &c,
            &id,
            &mut old,
            json!({"op":"upgrade","from":engine::LEGACY_VERSION,"to":engine::PREVIOUS_VERSION}),
            now(),
        )
        .unwrap();
        assert_eq!(old.version, engine::PREVIOUS_VERSION);
        assert_eq!(old.game["life"]["version"], 1);
        for kind in ["take", "drop", "take", "move"] {
            let action = home_action(&old, 1, kind);
            full_store::commit(
                &c,
                &id,
                &mut old,
                json!({"op":"play","actor":"mara","action":action}),
                now(),
            )
            .unwrap();
            if kind == "drop" {
                assert!(!old.project(1).unwrap()["exits"]
                    .as_array()
                    .unwrap()
                    .contains(&json!("pond")));
            }
        }
        assert_eq!(old.game["actors"]["mara"]["place"], "pond");
        assert_eq!(old.game["items"]["mask"]["holder"], "mara");
        let speech = |text: &str| {
            json!({"op":"speech","actor":"mara","room":"pond","lines":[
                {"actorId":"mara","text":text},
                {"actorId":null,"entityId":"pond","text":"The water is still."}
            ]})
        };
        full_store::commit(
            &c,
            &id,
            &mut old,
            speech("I carried the mask to the shore."),
            now(),
        )
        .unwrap();
        if !keep_checkpoint {
            c.execute("DELETE FROM card_full_checkpoints", []).unwrap();
        }
        let mut upgraded = full_store::world(&c, &id, now()).unwrap();
        // The checkpoint path must reach the same upgraded world; the rest of
        // the case runs once, from the journal.
        if keep_checkpoint {
            checkpointed = Some(upgraded.clone());
            continue;
        }
        assert_eq!(Some(&upgraded), checkpointed.as_ref());
        assert_eq!(upgraded.version, engine::VERSION);
        assert_saved_actors(&upgraded.game["actors"], &old.game["actors"]);
        assert_saved_items(&upgraded.game["items"], &old.game["items"]);
        assert_eq!(upgraded.game["log"], quest_free_log(&old.game["log"]));
        assert_eq!(upgraded.claimed, old.claimed);
        assert_eq!(upgraded.present, old.present);
        assert_eq!(
            upgraded.game["revision"].as_u64().unwrap(),
            old.game["revision"].as_u64().unwrap() + 1
        );
        let talk = home_action(&upgraded, 1, "talk");
        full_store::commit(
            &c,
            &id,
            &mut upgraded,
            json!({"op":"play","actor":"mara","action":talk}),
            now(),
        )
        .unwrap();
        // No quest is offered to pick up; Mara keeps her one want.
        assert!(!upgraded.project(1).unwrap()["actions"]
            .as_array()
            .unwrap()
            .iter()
            .any(|a| a["kind"] == "pursue"));
        assert!(upgraded.game["actors"]["mara"].get("want").is_some());
        full_store::commit(
            &c,
            &id,
            &mut upgraded,
            speech("I know what I want next."),
            now(),
        )
        .unwrap();
        c.execute("DELETE FROM card_full_checkpoints", []).unwrap();
        assert_eq!(full_store::world(&c, &id, now()).unwrap(), upgraded);
        assert_eq!(full_store::world(&c, &id, now()).unwrap(), upgraded);
        let upgrades: i64 = c.query_row("SELECT count(*) FROM card_full_log WHERE world=? AND json_extract(command,'$.op')='upgrade'", [&id], |r| r.get(0)).unwrap();
        assert_eq!(upgrades, 2);
    }
}

#[test]
fn version_three_upgrade_keeps_released_untouched_belongings() {
    let mut checkpointed = None;
    for keep_checkpoint in [true, false] {
        let (_path, c, id) = fixture();
        c.execute("DELETE FROM card_full_checkpoints", []).unwrap();
        c.execute("DELETE FROM card_full_log", []).unwrap();
        let result =
            engine::reduce_version(engine::LEGACY_VERSION, json!({"op":"create"})).unwrap();
        let mut old = World {
            version: engine::LEGACY_VERSION.into(),
            game: result["world"].clone(),
            claimed: [0; 8],
            present: [0; 8],
            pack: None,
        };
        old.apply(&json!({"op":"claim","actor":"mara"})).unwrap();
        old.apply(
            &json!({"op":"upgrade","from":engine::LEGACY_VERSION,"to":engine::PREVIOUS_VERSION}),
        )
        .unwrap();
        old.apply(&json!({"op":"release","actor":"mara"})).unwrap();
        assert_eq!(old.game["items"]["mask"]["holder"], "mara");
        assert!(old.game["items"]["mask"]["history"]
            .as_array()
            .unwrap()
            .is_empty());
        full_store::seed(&c, &id, &old, "released-version-three-seed", now()).unwrap();
        if !keep_checkpoint {
            c.execute("DELETE FROM card_full_checkpoints", []).unwrap();
        }
        let upgraded = full_store::world(&c, &id, now()).unwrap();
        // The checkpoint path must reach the same upgraded world; the rest of
        // the case runs once, from the journal.
        if keep_checkpoint {
            checkpointed = Some(upgraded.clone());
            continue;
        }
        assert_eq!(Some(&upgraded), checkpointed.as_ref());
        assert_eq!(upgraded.version, engine::VERSION);
        assert_saved_items(&upgraded.game["items"], &old.game["items"]);
        assert_saved_actors(&upgraded.game["actors"], &old.game["actors"]);
        assert_eq!(upgraded.claimed, old.claimed);
        c.execute("DELETE FROM card_full_checkpoints", []).unwrap();
        assert_eq!(full_store::world(&c, &id, now()).unwrap(), upgraded);
    }
}

#[test]
fn released_greek_upgrades_and_recitals_replay_after_quests_are_dropped() {
    for path in [
        vec![engine::FIFTH_VERSION],
        vec![engine::FOURTH_VERSION, engine::FIFTH_VERSION],
        vec![engine::LEGACY_VERSION, engine::FOURTH_VERSION],
        vec![engine::PREVIOUS_VERSION, engine::FOURTH_VERSION],
        vec![
            engine::LEGACY_VERSION,
            engine::PREVIOUS_VERSION,
            engine::FOURTH_VERSION,
        ],
    ] {
        let mut checkpointed = None;
        for keep_checkpoint in [true, false] {
            let (_file, c, id) = fixture();
            c.execute("DELETE FROM card_full_checkpoints", []).unwrap();
            c.execute("DELETE FROM card_full_log", []).unwrap();
            let result = engine::reduce_version(path[0], json!({"op":"create"})).unwrap();
            let mut w = World {
                version: path[0].into(),
                game: result["world"].clone(),
                claimed: [0; 8],
                present: [0; 8],
                pack: None,
            };
            w.game.as_object_mut().unwrap().remove("opening");
            w.game["crossings"]["pond-greek-harbor"]["discovered"] = json!(true);
            w.game["actors"]["vale"]["place"] = json!("greek-courtyard");
            w.game["items"]["greek-water-jar"]["holder"] = json!("vale");
            full_store::seed(&c, &id, &w, "released-greek", now()).unwrap();
            for op in ["claim", "enter"] {
                full_store::commit(&c, &id, &mut w, json!({"op":op,"actor":"vale"}), now())
                    .unwrap();
            }
            let action = w.project(0).unwrap()["actions"]
                .as_array()
                .unwrap()
                .iter()
                .find(|a| a["choiceId"] == "greek-return-water-jar")
                .unwrap()
                .clone();
            full_store::commit(
                &c,
                &id,
                &mut w,
                json!({"op":"play","actor":"vale","action":action}),
                now(),
            )
            .unwrap();
            for target in &path[1..] {
                let from = w.version.clone();
                full_store::commit(
                    &c,
                    &id,
                    &mut w,
                    json!({"op":"upgrade","from":from,"to":target}),
                    now(),
                )
                .unwrap();
            }
            let action = w.project(0).unwrap()["actions"]
                .as_array()
                .unwrap()
                .iter()
                .find(|a| a["kind"] == "move" && a["target"] == "greek-well")
                .unwrap()
                .clone();
            full_store::commit(
                &c,
                &id,
                &mut w,
                json!({"op":"play","actor":"vale","action":action}),
                now(),
            )
            .unwrap();
            assert_eq!(w.game["actors"]["greek-rhapsode"]["place"], "greek-well");
            full_store::commit(&c, &id, &mut w, json!({"op":"speech","actor":"vale","room":"greek-well","lines":[{"actorId":"vale","text":"The well is quiet today."},{"actorId":null,"entityId":"greek-well","text":"Water shines in the shade."}]}), now()).unwrap();
            let previous = w.clone();
            if !keep_checkpoint {
                c.execute("DELETE FROM card_full_checkpoints", []).unwrap();
            }
            w = full_store::world(&c, &id, now()).unwrap();
            // The checkpoint path must reach the same upgraded world; the rest of
            // the case runs once, from the journal.
            if keep_checkpoint {
                checkpointed = Some(w.clone());
                continue;
            }
            assert_eq!(Some(&w), checkpointed.as_ref());
            assert_eq!(w.version, engine::VERSION);
            assert_saved_actors(&w.game["actors"], &previous.game["actors"]);
            assert_saved_items(&w.game["items"], &previous.game["items"]);
            assert_saved_packs(&w.game["packs"], &previous.game["packs"]);
            assert_eq!(w.game["log"], quest_free_log(&previous.game["log"]));
            assert_eq!(w.game["turn"], previous.game["turn"]);
            assert_eq!(
                w.game["revision"].as_u64().unwrap(),
                previous.game["revision"].as_u64().unwrap() + 1
            );
            // The upgrade drops quest collections and records; the Bard keeps
            // its place at the well, where Vale talks with it.
            assert!(w.game["life"]["actors"]["vale"].get("collection").is_none());
            assert!(w.game.get("quests").is_none());
            assert_eq!(w.game["actors"]["greek-rhapsode"]["place"], "greek-well");
            let action = w.project(0).unwrap()["actions"]
                .as_array()
                .unwrap()
                .iter()
                .find(|a| a["kind"] == "talk" && a["target"] == "greek-rhapsode")
                .unwrap()
                .clone();
            let result = full_store::commit(
                &c,
                &id,
                &mut w,
                json!({"op":"play","actor":"vale","action":action}),
                now(),
            )
            .unwrap();
            let poem = result["context"]["entities"]
                .as_array()
                .unwrap()
                .iter()
                .find(|e| e["id"] == "greek-rhapsode")
                .unwrap()["poem"]
                .clone();
            assert!(poem["stanzas"]
                .as_array()
                .unwrap()
                .iter()
                .any(|s| s["id"] == "greek-return-water-jar"));
            assert_eq!(
                w.game["packs"]["greek-drama"]["receipts"],
                previous.game["packs"]["greek-drama"]["receipts"]
            );
            full_store::commit(&c, &id, &mut w, json!({"op":"speech","actor":"vale","room":"greek-well","lines":[{"actorId":"vale","text":"I remember the bread we shared."},{"actorId":"greek-rhapsode","text":"The song keeps that day."}]}), now()).unwrap();
            c.execute("DELETE FROM card_full_checkpoints", []).unwrap();
            assert_eq!(full_store::world(&c, &id, now()).unwrap(), w);
            let upgrades: usize = c.query_row("SELECT count(*) FROM card_full_log WHERE json_extract(command,'$.op')='upgrade'", [], |r| r.get(0)).unwrap();
            assert_eq!(upgrades, path.len());
        }
    }
}

#[test]
fn pruned_shared_recital_keeps_unknown_author_through_upgrade_and_replay() {
    let mut checkpointed = None;
    for keep_checkpoint in [true, false] {
        let (_file, c, id) = fixture();
        c.execute("DELETE FROM card_full_checkpoints", []).unwrap();
        c.execute("DELETE FROM card_full_log", []).unwrap();
        let result =
            engine::reduce_version(engine::PREVIOUS_VERSION, json!({"op":"create"})).unwrap();
        let mut old = World {
            version: engine::PREVIOUS_VERSION.into(),
            game: result["world"].clone(),
            claimed: [0; 8],
            present: [0; 8],
            pack: None,
        };
        old.game.as_object_mut().unwrap().remove("opening");
        old.game["crossings"]["pond-greek-harbor"]["discovered"] = json!(true);
        old.game["actors"]["mara"]["place"] = json!("greek-gate");
        for op in ["claim", "enter"] {
            old.apply(&json!({"op":op,"actor":"mara"})).unwrap();
        }
        for choice in ["greek-hear-decree", "greek-report-plan"] {
            let action = old.project(1).unwrap()["actions"]
                .as_array()
                .unwrap()
                .iter()
                .find(|a| a["choiceId"] == choice)
                .unwrap()
                .clone();
            old.apply(&json!({"op":"play","actor":"mara","action":action}))
                .unwrap();
        }
        assert!(old.game["log"]
            .as_array()
            .unwrap()
            .iter()
            .any(|e| e["choiceId"] == "greek-report-plan" && e["actorId"] == "mara"));
        old.game["log"] = json!([]);
        full_store::seed(&c, &id, &old, "pruned-shared-song", now()).unwrap();
        if !keep_checkpoint {
            c.execute("DELETE FROM card_full_checkpoints", []).unwrap();
        }
        let mut upgraded = full_store::world(&c, &id, now()).unwrap();
        // The checkpoint path must reach the same upgraded world; the rest of
        // the case runs once, from the journal.
        if keep_checkpoint {
            checkpointed = Some(upgraded.clone());
            continue;
        }
        assert_eq!(Some(&upgraded), checkpointed.as_ref());
        assert_eq!(upgraded.version, engine::VERSION);
        assert_eq!(
            upgraded.game["packs"]["greek-drama"]["recitals"]["greek-report-plan"],
            json!({"actor":null,"visit":null})
        );
        assert_eq!(
            upgraded.game["packs"]["greek-drama"]["receipts"],
            old.game["packs"]["greek-drama"]["receipts"]
        );
        let action = upgraded.project(1).unwrap()["actions"]
            .as_array()
            .unwrap()
            .iter()
            .find(|a| a["kind"] == "move" && a["target"] == "greek-courtyard")
            .unwrap()
            .clone();
        full_store::commit(
            &c,
            &id,
            &mut upgraded,
            json!({"op":"play","actor":"mara","action":action}),
            now(),
        )
        .unwrap();
        assert!(
            upgraded.game["packs"]["greek-drama"]["recitals"]["greek-report-plan"]["visit"]
                .is_null()
        );
        c.execute("DELETE FROM card_full_checkpoints", []).unwrap();
        assert_eq!(full_store::world(&c, &id, now()).unwrap(), upgraded);
    }
}

#[test]
fn released_carriage_route_replays_before_the_station_connection_upgrade() {
    let mut checkpointed = None;
    for keep_checkpoint in [true, false] {
        let (_file, c, id) = fixture();
        c.execute("DELETE FROM card_full_checkpoints", []).unwrap();
        c.execute("DELETE FROM card_full_log", []).unwrap();
        let result =
            engine::reduce_version(engine::FOURTH_VERSION, json!({"op":"create"})).unwrap();
        let mut w = World {
            version: engine::FOURTH_VERSION.into(),
            game: result["world"].clone(),
            claimed: [0; 8],
            present: [0; 8],
            pack: None,
        };
        full_store::seed(&c, &id, &w, "released-carriage", now()).unwrap();
        for op in ["claim", "enter"] {
            full_store::commit(&c, &id, &mut w, json!({"op":op,"actor":"rue"}), now()).unwrap();
        }
        for kind in ["take", "move"] {
            let action = home_action(&w, 5, kind);
            if kind == "move" {
                assert_eq!(action["target"], "pond");
            }
            full_store::commit(
                &c,
                &id,
                &mut w,
                json!({"op":"play","actor":"rue","action":action}),
                now(),
            )
            .unwrap();
        }
        let earlier = w.clone();
        if !keep_checkpoint {
            c.execute("DELETE FROM card_full_checkpoints", []).unwrap();
        }
        w = full_store::world(&c, &id, now()).unwrap();
        // The checkpoint path must reach the same upgraded world; the rest of
        // the case runs once, from the journal.
        if keep_checkpoint {
            checkpointed = Some(w.clone());
            continue;
        }
        assert_eq!(Some(&w), checkpointed.as_ref());
        assert_saved_actors(&w.game["actors"], &earlier.game["actors"]);
        assert_saved_items(&w.game["items"], &earlier.game["items"]);
        assert_eq!(w.game["log"], quest_free_log(&earlier.game["log"]));
        for (key, value) in earlier.game["crossings"].as_object().unwrap() {
            assert_eq!(&w.game["crossings"][key], value);
        }
        assert_eq!(w.version, engine::VERSION);
        assert!(w.project(5).unwrap()["exits"]
            .as_array()
            .unwrap()
            .contains(&json!("train")));
        let action = w.project(5).unwrap()["actions"]
            .as_array()
            .unwrap()
            .iter()
            .find(|a| a["kind"] == "move" && a["target"] == "train")
            .unwrap()
            .clone();
        full_store::commit(
            &c,
            &id,
            &mut w,
            json!({"op":"play","actor":"rue","action":action}),
            now(),
        )
        .unwrap();
        assert_eq!(w.game["actors"]["rue"]["place"], "train");
        c.execute("DELETE FROM card_full_checkpoints", []).unwrap();
        assert_eq!(full_store::world(&c, &id, now()).unwrap(), w);
    }
}

#[test]
fn released_shared_quest_receipts_drop_on_upgrade_and_replay() {
    let mut checkpointed = None;
    for (version, keep_checkpoint) in [
        (engine::SIXTH_VERSION, true),
        (engine::SIXTH_VERSION, false),
        (engine::SEVENTH_VERSION, true),
        (engine::SEVENTH_VERSION, false),
        (engine::EIGHTH_VERSION, true),
        (engine::EIGHTH_VERSION, false),
    ] {
        let (_file, c, id) = fixture();
        c.execute("DELETE FROM card_full_checkpoints", []).unwrap();
        c.execute("DELETE FROM card_full_log", []).unwrap();
        let result = engine::reduce_version(version, json!({"op":"create"})).unwrap();
        let mut w = World {
            version: version.into(),
            game: result["world"].clone(),
            claimed: [0; 8],
            present: [0; 8],
            pack: None,
        };
        w.game.as_object_mut().unwrap().remove("opening");
        w.game["actors"]["vale"]["place"] = json!("station");
        let receipt = json!({"id":"world:quest:0:terminal:1","seq":1,"eventSeq":0,"turn":0,"questKey":"world:quest:0","terminalRevision":1,"actorId":"keeper","locationId":"greek-well","participants":["keeper"],"outcome":"fulfilled","cause":null});
        w.game["quests"] = json!({"version":1,"next":1,"records":{},"focus":{}});
        w.game["quests"]["records"]["world:quest:0"] = json!({
          "key":"world:quest:0","mode":"shared","holder":{"kind":"item","id":"bell"},
          "subjectActor":null,"rewardActor":null,"participants":["keeper"],
          "program":{"id":"well-deed","name":"A deed at the well","steps":[{"items":[],"avatars":[],"location":"greek-well"}]},
          "step":1,"origin":null,"createdTurn":0,"completedTurn":0,"cause":null,"terminalRevision":1,"completion":receipt
        });
        w.game["questCompletions"] = json!({"next":2,"recent":[receipt],"latest":receipt});
        full_store::seed(&c, &id, &w, "released-shared-quest", now()).unwrap();
        for op in ["claim", "enter"] {
            full_store::commit(&c, &id, &mut w, json!({"op":op,"actor":"vale"}), now()).unwrap();
        }
        let action = home_action(&w, 0, "wait");
        full_store::commit(
            &c,
            &id,
            &mut w,
            json!({"op":"play","actor":"vale","action":action}),
            now(),
        )
        .unwrap();
        full_store::commit(&c, &id, &mut w, json!({"op":"speech","actor":"vale","room":"station","lines":[{"actorId":"vale","text":"I remember the well."},{"actorId":null,"entityId":"station","text":"The platform is quiet."}]}), now()).unwrap();
        let previous = w.clone();
        if !keep_checkpoint {
            c.execute("DELETE FROM card_full_checkpoints", []).unwrap();
        }
        w = full_store::world(&c, &id, now()).unwrap();
        // The checkpoint path must reach the same upgraded world; the rest of
        // the case runs once, from the journal.
        if keep_checkpoint {
            checkpointed = Some(w.clone());
            continue;
        }
        assert_eq!(Some(&w), checkpointed.as_ref());
        // Older versions prove their upgrade; the new story plays once.
        if version != engine::EIGHTH_VERSION {
            continue;
        }
        assert_eq!(w.version, engine::VERSION);
        assert_saved_actors(&w.game["actors"], &previous.game["actors"]);
        assert_saved_items(&w.game["items"], &previous.game["items"]);
        assert_saved_packs(&w.game["packs"], &previous.game["packs"]);
        assert_eq!(w.game["log"], quest_free_log(&previous.game["log"]));
        assert_eq!(w.game["turn"], previous.game["turn"]);
        // The want model keeps no quest receipts; the Bard is no longer drawn
        // to the old deed's site and keeps its saved place.
        for key in ["quests", "questCompletions", "roamingQuests"] {
            assert!(w.game.get(key).is_none(), "Drop {key}");
        }
        assert_eq!(w.claimed, previous.claimed);
        assert_eq!(
            w.game["actors"]["greek-rhapsode"]["place"],
            previous.game["actors"]["greek-rhapsode"]["place"]
        );
        for _ in 0..2 {
            let action = home_action(&w, 0, "wait");
            full_store::commit(
                &c,
                &id,
                &mut w,
                json!({"op":"play","actor":"vale","action":action}),
                now(),
            )
            .unwrap();
        }
        full_store::commit(&c, &id, &mut w, json!({"op":"speech","actor":"vale","room":"station","lines":[{"actorId":"vale","text":"The journey continues."},{"actorId":null,"entityId":"station","text":"A breeze crosses the platform."}]}), now()).unwrap();
        c.execute("DELETE FROM card_full_checkpoints", []).unwrap();
        assert_eq!(full_store::world(&c, &id, now()).unwrap(), w);
    }
}

#[test]
fn released_quest_offers_are_dropped_by_the_upgrade_and_replay() {
    for (version, protected) in [
        (engine::SEVENTH_VERSION, false),
        (engine::SEVENTH_VERSION, true),
        (engine::EIGHTH_VERSION, false),
        (engine::EIGHTH_VERSION, true),
    ] {
        let (path, c, id) = fixture();
        c.execute("DELETE FROM card_full_checkpoints", []).unwrap();
        c.execute("DELETE FROM card_full_log", []).unwrap();
        let result = engine::reduce_version(version, json!({"op":"create"})).unwrap();
        let mut w = World {
            version: version.into(),
            game: result["world"].clone(),
            claimed: [1, 1, 0, 0, 0, 0, 0, 0],
            present: [1, 1, 0, 0, 0, 0, 0, 0],
            pack: None,
        };
        w.game.as_object_mut().unwrap().remove("opening");
        w.game["turn"] = json!(3);
        w.game["revision"] = json!(3);
        w.game["actors"]["vale"]["place"] = json!("station");
        w.game["actors"]["vale"]["progress"] = json!({"program":0,"step":if protected {1} else {0},"marks":if protected {vec![2]} else {vec![]}});
        w.game["life"]["actors"]["vale"]["phase"] =
            json!(if protected { "active" } else { "seeking" });
        w.game["life"]["actors"]["vale"]["collection"] = json!({
            "next":4,"active":if protected {Some("vale:quest:1")} else {None},
            "cards":["vale:quest:1","vale:quest:2","vale:quest:3"],"archive":[],
            "earned":if protected {1} else {0},"archivedCompleted":0,"authoredThrough":2,"collectedThrough":0
        });
        w.game["quests"] = json!({"version":1,"next":1,"records":{},"focus":{}});
        for (serial, companions) in [
            (1, ["mara", "ash"]),
            (2, ["mara", "nell"]),
            (3, ["ash", "nell"]),
        ] {
            let key = format!("vale:quest:{serial}");
            w.game["quests"]["records"][&key] = json!({
                "key":key,"mode":"personal","holder":{"kind":"avatar","id":"vale"},
                "subjectActor":"vale","rewardActor":"vale","participants":["vale"],"cause":null,
                "program":{"id":"generated-vale-1","name":"Keep a light for everyone","purpose":"Share the light.",
                    "generated":{"turn":serial,"level":1,"item":"lamp","owner":"vale","partner":"keeper","situation":"gathering"},
                    "steps":[
                        {"items":["lamp"],"location":"station","avatars":companions,"conditions":[{"kind":"lit","item":"lamp"}]},
                        {"items":[],"location":"station","avatars":[companions[0]],"conditions":[{"kind":"heldBy","item":"lamp","avatar":companions[0]}],"consequence":{"kind":"trust","avatar":companions[0]}}
                    ]},
                "step":0,"origin":null,"createdTurn":serial,"completedTurn":null
            });
        }
        if protected {
            w.game["quests"]["focus"]["vale"] = json!("vale:quest:1");
            w.game["quests"]["records"]["vale:quest:1"]["step"] = json!(1);
            w.game["quests"]["records"]["vale:quest:1"]["lastProgressTurn"] = json!(2);
            w.game["quests"]["records"]["vale:quest:2"]["participants"] = json!(["mara", "vale"]);
            w.game["quests"]["records"]["vale:quest:2"]["holder"] =
                json!({"kind":"item","id":"lamp"});
        }
        let receipt = json!({"id":"world:quest:0:terminal:1","seq":1,"eventSeq":0,"turn":0,"questKey":"world:quest:0","terminalRevision":1,"actorId":"keeper","locationId":"greek-well","participants":["keeper"],"outcome":"fulfilled","cause":null});
        w.game["quests"]["records"]["world:quest:0"] = json!({
            "key":"world:quest:0","mode":"shared","holder":{"kind":"item","id":"bell"},
            "subjectActor":null,"rewardActor":null,"participants":["keeper"],
            "program":{"id":"well-deed","name":"A deed at the well","steps":[{"items":[],"avatars":[],"location":"greek-well"}]},
            "step":1,"origin":null,"createdTurn":0,"completedTurn":0,"cause":null,"terminalRevision":1,"completion":receipt
        });
        w.game["questCompletions"] = json!({"next":2,"recent":[receipt],"latest":receipt});
        w.project(0).unwrap();
        full_store::seed(&c, &id, &w, "released-quest-offers", now()).unwrap();
        full_store::commit(&c, &id, &mut w, json!({"op":"speech","actor":"vale","room":"station","lines":[{"actorId":"vale","text":"We can share the light."},{"actorId":null,"entityId":"station","text":"A breeze crosses the platform."}]}), now()).unwrap();
        let previous = w.clone();
        // Exercise both the historical checkpoint and journal-only upgrade paths.
        if !protected {
            c.execute("DELETE FROM card_full_checkpoints", []).unwrap();
        }
        w = full_store::world(&c, &id, now()).unwrap();
        assert_eq!(w.version, engine::VERSION);
        assert_saved_actors(&w.game["actors"], &previous.game["actors"]);
        assert_saved_items(&w.game["items"], &previous.game["items"]);
        assert_eq!(w.game["log"], quest_free_log(&previous.game["log"]));
        assert_eq!(w.game["turn"], previous.game["turn"]);
        // Offers, hands, focus and collections were quest machinery; the
        // upgrade drops them and Vale keeps one want instead.
        for key in ["quests", "questCompletions"] {
            assert!(w.game.get(key).is_none(), "Drop {key}");
        }
        assert!(w.game["life"]["actors"]["vale"].get("collection").is_none());
        assert!(w.game["actors"]["vale"].get("progress").is_none());
        assert!(w.game["actors"]["vale"].get("want").is_some());
        assert!(!w.project(0).unwrap()["actions"]
            .as_array()
            .unwrap()
            .iter()
            .any(|a| ["drop-quest", "join-quest", "share-quest", "pursue"]
                .contains(&a["kind"].as_str().unwrap_or(""))));
        for _ in 0..2 {
            let action = home_action(&w, 0, "wait");
            full_store::commit(
                &c,
                &id,
                &mut w,
                json!({"op":"play","actor":"vale","action":action}),
                now(),
            )
            .unwrap();
        }
        let upgraded = w.clone();
        drop(c);
        let c = store::open(&path).unwrap();
        full_store::schema(&c).unwrap();
        assert_eq!(full_store::world(&c, &id, now()).unwrap(), upgraded);
        c.execute("DELETE FROM card_full_checkpoints", []).unwrap();
        assert_eq!(full_store::world(&c, &id, now()).unwrap(), upgraded);
    }
}

#[test]
fn dousing_the_held_lamp_meets_vales_want_once_and_replays() {
    let (_path, c, id) = fixture();
    c.execute("DELETE FROM card_full_checkpoints", []).unwrap();
    c.execute("DELETE FROM card_full_log", []).unwrap();
    let mut w = World::create(None).unwrap();
    w.claimed = [1, 0, 0, 0, 0, 0, 0, 0];
    w.present = w.claimed;
    // A player holds no quest before the Black Pond (#1768), so this test
    // gives Vale the lamp want she used to start with.
    assert!(w.game["actors"]["vale"]["want"].is_null());
    w.game["actors"]["vale"]["want"] =
        json!({"kind":"item","target":"lamp","since":0,"refusals":0});
    full_store::seed(&c, &id, &w, "want-met", now()).unwrap();
    // Vale already holds the lamp, so the first play meets that want.
    let action = home_action(&w, 0, "snuff");
    full_store::commit(
        &c,
        &id,
        &mut w,
        json!({"op":"play","actor":"vale","action":action}),
        now(),
    )
    .unwrap();
    let met = |w: &World| {
        w.game["log"]
            .as_array()
            .unwrap()
            .iter()
            .filter(|e| e["verb"] == "want_met" && e["actorId"] == "vale")
            .cloned()
            .collect::<Vec<_>>()
    };
    let first = met(&w);
    assert_eq!(first.len(), 1);
    assert_eq!(first[0]["wantMet"], json!({"kind":"item","target":"lamp"}));
    assert_eq!(first[0]["turn"], w.game["turn"]);
    assert_eq!(w.game["actors"]["vale"]["xp"], 1);
    assert_ne!(w.game["actors"]["vale"]["want"]["target"], "lamp");
    assert!(w.game.get("quests").is_none());
    for _ in 0..2 {
        let action = home_action(&w, 0, "wait");
        full_store::commit(
            &c,
            &id,
            &mut w,
            json!({"op":"play","actor":"vale","action":action}),
            now(),
        )
        .unwrap();
        assert_eq!(met(&w), first, "a met want is recorded once");
    }
    c.execute("DELETE FROM card_full_checkpoints", []).unwrap();
    assert_eq!(full_store::world(&c, &id, now()).unwrap(), w);
}

#[test]
fn bard_passage_help_uses_authoritative_home_and_ship_actions_and_replays() {
    for sea in [false, true] {
        let (_file, c, id) = fixture();
        c.execute("DELETE FROM card_full_checkpoints", []).unwrap();
        c.execute("DELETE FROM card_full_log", []).unwrap();
        let mut w = World::create(None).unwrap();
        w.game.as_object_mut().unwrap().remove("opening");
        // Keep this passage fixture separate from unrelated shore quests.
        w.game["actors"]["moth"]["place"] = json!("greek-battlefield");
        w.game["actors"]["keeper"]["place"] = json!("greek-battlefield");
        let start = if sea { "greek-harbor" } else { "theatre" };
        // Vale waits away from the ship, so the Bard may call it.
        w.game["actors"]["vale"]["place"] = json!(if sea { "station" } else { "theatre" });
        w.game["actors"]["greek-rhapsode"]["place"] = json!(start);
        w.game["items"]["mask"]["holder"] = json!("theatre");
        w.game["items"]["lamp"]["holder"] = json!("vale");
        w.game["transports"]["greek-ship"]["dock"] = json!("pond");
        w.game["crossings"]["pond-greek-harbor"]["discovered"] = json!(true);
        // The Bard's own want sends it to the shore; no quest record does.
        w.game["actors"]["greek-rhapsode"]["want"] =
            json!({"kind":"place","target":"pond","since":0,"refusals":0});
        full_store::seed(&c, &id, &w, "blocked-bard-passage", now()).unwrap();
        for op in ["claim", "enter"] {
            full_store::commit(&c, &id, &mut w, json!({"op":op,"actor":"vale"}), now()).unwrap();
        }
        let play = |w: &mut World, kind: &str, field: &str, value: &str| {
            let action = w.project(0).unwrap()["actions"]
                .as_array()
                .unwrap()
                .iter()
                .find(|a| a["kind"] == kind && (field.is_empty() || a[field] == value))
                .unwrap_or_else(|| panic!("Missing {kind} {field} {value}"))
                .clone();
            full_store::commit(
                &c,
                &id,
                w,
                json!({"op":"play","actor":"vale","action":action}),
                now(),
            )
            .unwrap();
        };
        play(&mut w, "wait", "", "");
        assert_eq!(w.game["actors"]["greek-rhapsode"]["place"], start);
        if sea {
            // Waiting to board, the Bard calls the empty ship one lane to the
            // harbor, boards, sets his own course and spends a round at sea.
            assert_eq!(w.game["transports"]["greek-ship"]["dock"], "greek-harbor");
            for _ in 0..6 {
                if w.game["actors"]["greek-rhapsode"]["place"] == "pond" {
                    break;
                }
                play(&mut w, "wait", "", "");
            }
        } else {
            // The theatre door stays shut to the Bard until someone carries
            // the mask; then it walks through on its own want.
            play(&mut w, "wait", "", "");
            assert_eq!(w.game["actors"]["greek-rhapsode"]["place"], "theatre");
            play(&mut w, "take", "item", "mask");
        }
        assert_eq!(w.game["actors"]["greek-rhapsode"]["place"], "pond");
        // Reaching the shore meets the want and is recorded once.
        assert_eq!(w.game["actors"]["greek-rhapsode"]["xp"], 1);
        assert!(w.game["log"].as_array().unwrap().iter().any(|e| {
            e["verb"] == "want_met"
                && e["actorId"] == "greek-rhapsode"
                && e["wantMet"]["target"] == "pond"
        }));
        let arrived = w.clone();
        c.execute("DELETE FROM card_full_checkpoints", []).unwrap();
        assert_eq!(full_store::world(&c, &id, now()).unwrap(), arrived);
    }
}

#[test]
fn invited_carriage_trip_preserves_agreement_visited_places_and_replays() {
    for agrees in [false, true] {
        let (_file, c, id) = fixture();
        c.execute("DELETE FROM card_full_checkpoints", []).unwrap();
        c.execute("DELETE FROM card_full_log", []).unwrap();
        let mut w = World::create(None).unwrap();
        w.game.as_object_mut().unwrap().remove("opening");
        w.game["actors"]["rue"]["place"] = json!("pond");
        w.game["actors"]["moth"]["place"] = json!("pond");
        w.game["actors"]["moth"]["trust"]["rue"] = json!(if agrees { 1 } else { 0 });
        w.game["items"]["routes"]["holder"] = json!("rue");
        full_store::seed(&c, &id, &w, "invited-carriage", now()).unwrap();
        for op in ["claim", "enter"] {
            full_store::commit(&c, &id, &mut w, json!({"op":op,"actor":"rue"}), now()).unwrap();
        }
        let action = w.project(5).unwrap()["actions"]
            .as_array()
            .unwrap()
            .iter()
            .find(|a| {
                a["kind"] == "accompany" && a["target"] == "moth" && a["destination"] == "train"
            })
            .unwrap()
            .clone();
        let before = w.clone();
        full_store::commit(
            &c,
            &id,
            &mut w,
            json!({"op":"play","actor":"rue","action":action}),
            now(),
        )
        .unwrap();
        let place = if agrees { "train" } else { "pond" };
        assert_eq!(w.game["actors"]["rue"]["place"], place);
        assert_eq!(w.game["actors"]["moth"]["place"], place);
        assert_eq!(w.game["items"]["routes"]["holder"], "rue");
        if agrees {
            assert_eq!(w.game["invitedPlaces"]["moth"], json!(["train"]));
        } else {
            assert!(w.game["invitedPlaces"].is_null());
        }
        c.execute("DELETE FROM card_full_checkpoints", []).unwrap();
        assert_eq!(full_store::world(&c, &id, now()).unwrap(), w);
        let mut closed = before;
        closed.game["items"]["routes"]["holder"] = json!("train");
        assert!(closed
            .apply(&json!({"op":"play","actor":"rue","action":action}))
            .is_err());
        assert_eq!(closed.game["actors"]["moth"]["place"], "pond");
        assert!(closed.game["invitedPlaces"].is_null());
    }
}

#[test]
fn embedded_selected_cards_match_with_no_quest_plays() {
    let mut w = World::create(None).unwrap();
    for op in ["claim", "enter"] {
        w.apply(&json!({"op":op,"actor":"vale"})).unwrap();
    }
    let action = w.project(0).unwrap()["actions"]
        .as_array()
        .unwrap()
        .iter()
        .find(|a| a["kind"] == "snuff")
        .unwrap()
        .clone();
    w.apply(&json!({"op":"play", "actor":"vale", "action":action}))
        .unwrap();
    w.game["items"]["cloth"]["holder"] = json!("vale");
    let view = w.project(0).unwrap();
    let actions = view["actions"].as_array().unwrap();
    // Quests are not plays: no card-less quest offers sit beside the cards.
    for kind in ["pursue", "share-quest", "join-quest", "drop-quest"] {
        assert!(!actions.iter().any(|a| a["kind"] == kind));
    }
    let cover = actions
        .iter()
        .find(|a| a["kind"] == "cover")
        .unwrap()
        .clone();
    let mut selected = w.request("play", 0);
    selected["selectedIds"] = json!(["vale", "cloth", "lamp", "cloth"]);
    let actual = engine::reduce(selected).unwrap();
    assert_eq!(actual["ok"], true);
    w.apply(&json!({"op":"play","actor":"vale","action":cover}))
        .unwrap();
    assert_eq!(actual["world"], w.game);
    assert_eq!(w.game["items"]["cloth"]["holder"], "lamp");
}

#[test]
fn stranded_home_rescue_replays_after_version_nine_upgrade() {
    let mut checkpointed = None;
    for keep_checkpoint in [true, false] {
        let (_file, c, id) = fixture();
        c.execute("DELETE FROM card_full_checkpoints", []).unwrap();
        c.execute("DELETE FROM card_full_log", []).unwrap();
        let result = engine::reduce_version(engine::NINTH_VERSION, json!({"op":"create"})).unwrap();
        let mut old = World {
            version: engine::NINTH_VERSION.into(),
            game: result["world"].clone(),
            claimed: [1, 0, 0, 0, 0, 0, 0, 0],
            present: [1, 0, 0, 0, 0, 0, 0, 0],
            pack: None,
        };
        old.game["items"]["lamp"]["fuel"] = json!(0);
        old.game["items"]["lamp"]["lit"] = json!(false);
        assert_eq!(old.project(0).unwrap()["exits"], json!([]));
        full_store::seed(&c, &id, &old, "released-nine-dry-lamp", now()).unwrap();
        if !keep_checkpoint {
            c.execute("DELETE FROM card_full_checkpoints", []).unwrap();
        }
        let mut upgraded = full_store::world(&c, &id, now()).unwrap();
        // The checkpoint path must reach the same upgraded world; the rest of
        // the case runs once, from the journal.
        if keep_checkpoint {
            checkpointed = Some(upgraded.clone());
            continue;
        }
        assert_eq!(Some(&upgraded), checkpointed.as_ref());
        assert_eq!(upgraded.version, engine::VERSION);
        assert_eq!(upgraded.project(0).unwrap()["exits"], json!(["pond"]));
        assert_eq!(upgraded.game["turn"], old.game["turn"]);
        for (item, state) in super::saved_items::upgraded(&old.game["items"])
            .as_object()
            .unwrap()
        {
            assert_eq!(&upgraded.game["items"][item], state);
        }
        let action = home_action(&upgraded, 0, "move");
        full_store::commit(
            &c,
            &id,
            &mut upgraded,
            json!({"op":"play","actor":"vale","action":action}),
            now(),
        )
        .unwrap();
        assert_eq!(upgraded.game["actors"]["vale"]["place"], "pond");
        let onward = upgraded.project(0).unwrap()["actions"]
            .as_array()
            .unwrap()
            .iter()
            .find(|a| a["kind"] == "move" && a["target"] == "station")
            .unwrap()
            .clone();
        full_store::commit(
            &c,
            &id,
            &mut upgraded,
            json!({"op":"play","actor":"vale","action":onward}),
            now(),
        )
        .unwrap();
        assert_eq!(upgraded.game["actors"]["vale"]["place"], "station");
        c.execute("DELETE FROM card_full_checkpoints", []).unwrap();
        assert_eq!(full_store::world(&c, &id, now()).unwrap(), upgraded);
    }
}

#[test]
fn each_shared_home_rescue_commits_through_c_and_replays() {
    for (a, item) in [
        (1, "mask"),
        (2, "float"),
        (3, "can"),
        (4, "kite"),
        (5, "routes"),
        (6, "board"),
        (7, "shears"),
    ] {
        let (_file, c, id) = fixture();
        c.execute("DELETE FROM card_full_checkpoints", []).unwrap();
        c.execute("DELETE FROM card_full_log", []).unwrap();
        let mut w = World::create(None).unwrap();
        w.claimed = [1; 8];
        w.present = [1; 8];
        w.game["items"][item]["holder"] = json!("station");
        full_store::seed(&c, &id, &w, "stranded-home", now()).unwrap();
        assert_eq!(w.project(a).unwrap()["exits"], json!(["pond"]));
        let action = home_action(&w, a, "move");
        full_store::commit(
            &c,
            &id,
            &mut w,
            json!({"op":"play","actor":actor_id(a),"action":action}),
            now(),
        )
        .unwrap();
        assert_eq!(w.game["actors"][actor_id(a)]["place"], "pond");
        c.execute("DELETE FROM card_full_checkpoints", []).unwrap();
        assert_eq!(full_store::world(&c, &id, now()).unwrap(), w);
    }
}

#[path = "learning_tests.rs"]
mod learning_tests;

#[test]
fn hoppycat_upgrade_keeps_released_history_and_replays_new_story_choices() {
    let mut checkpointed = None;
    for (previous_version, keep_checkpoint) in [
        (engine::SIXTEENTH_VERSION, true),
        (engine::SIXTEENTH_VERSION, false),
        (engine::SEVENTEENTH_VERSION, true),
        (engine::SEVENTEENTH_VERSION, false),
        (engine::EIGHTEENTH_VERSION, true),
        (engine::EIGHTEENTH_VERSION, false),
    ] {
        let path =
            std::env::temp_dir().join(format!("hoppycat-upgrade-{}.sqlite", crate::random_hex(12)));
        let c = store::open(&path).unwrap();
        full_store::schema(&c).unwrap();
        let id = "f".repeat(48);
        store::create(&c, &id, "owner", now()).unwrap();
        let seed = engine::reduce_version(previous_version, json!({"op":"create"})).unwrap();
        let mut old = World {
            version: previous_version.into(),
            game: seed["world"].clone(),
            claimed: [1, 1, 0, 0, 0, 0, 0, 0],
            present: [1, 1, 0, 0, 0, 0, 0, 0],
            pack: None,
        };
        old.game.as_object_mut().unwrap().remove("opening");
        old.game["actors"]["vale"]["place"] = json!("pond");
        old.game["actors"]["moth"]["place"] = json!("attic");
        old.game["actors"]["keeper"]["place"] = json!("station");
        old.game["items"]["bell"]["holder"] = json!("vale");
        old.game["items"]["lamp"]["holder"] = json!("vale");
        assert!(old.game["packs"].get("hoppycat-archive").is_none());
        full_store::seed(&c, &id, &old, "before-hoppycat-refresh", now()).unwrap();

        // Produce item history and accepted plays with the released interpreter.
        for kind in ["drop", "take"] {
            let action = old.project(0).unwrap()["actions"]
                .as_array()
                .unwrap()
                .iter()
                .find(|action| action["kind"] == kind && action["item"] == "bell")
                .unwrap()
                .clone();
            full_store::commit(
                &c,
                &id,
                &mut old,
                json!({"op":"play","actor":"vale","action":action}),
                now(),
            )
            .unwrap();
        }
        assert_eq!(old.game["items"]["bell"]["holder"], "vale");
        assert_eq!(
            old.game["items"]["bell"]["history"]
                .as_array()
                .unwrap()
                .len(),
            2
        );
        let count = || -> i64 {
            c.query_row(
                "SELECT COUNT(*) FROM card_full_log WHERE world=?",
                [&id],
                |row| row.get(0),
            )
            .unwrap()
        };
        let before_upgrade = count();
        if !keep_checkpoint {
            c.execute("DELETE FROM card_full_checkpoints", []).unwrap();
        }
        let mut world = full_store::world(&c, &id, now()).unwrap();
        // The checkpoint path must reach the same upgraded world; the rest of
        // the case runs once, from the journal.
        if keep_checkpoint {
            checkpointed = Some(world.clone());
            continue;
        }
        assert_eq!(Some(&world), checkpointed.as_ref());
        // Older versions prove their upgrade; the new story plays once.
        if previous_version != engine::EIGHTEENTH_VERSION {
            continue;
        }
        assert_eq!(world.version, engine::VERSION);
        assert_eq!(world.claimed, old.claimed);
        assert_eq!(world.present, old.present);
        assert_eq!(world.game["turn"], old.game["turn"]);
        assert_eq!(
            world.game["revision"].as_u64().unwrap(),
            old.game["revision"].as_u64().unwrap() + 1
        );
        assert_saved_actors(&world.game["actors"], &old.game["actors"]);
        assert_saved_items(&world.game["items"], &old.game["items"]);
        assert_saved_memories(&world.game["memories"], &old.game["memories"]);
        for field in ["packs", "crossings"] {
            for (key, saved) in old.game[field].as_object().unwrap() {
                let mut expected = saved.clone();
                if field == "packs" && key == "greek-drama" {
                    expected["revision"] = greek_revision();
                }
                if field == "packs" && key == "boardyai" {
                    expected["revision"] = json!(2);
                }
                assert_eq!(world.game[field][key], expected, "saved {field}/{key}");
            }
        }
        assert_eq!(world.game["log"], quest_free_log(&old.game["log"]));
        assert_eq!(
            world.game["packs"]["hoppycat-archive"]["revision"],
            pack_revision("hoppycat-archive")
        );
        assert_eq!(
            world.game["actors"]["hoppycat-hoppy-cat"]["place"],
            "hoppycat-halfway-tea-garden"
        );
        assert_eq!(
            world.game["items"]["hoppycat-halfway-cup"]["holder"],
            "hoppycat-halfway-tea-garden"
        );
        assert_eq!(count(), before_upgrade + 1);
        assert_eq!(full_store::world(&c, &id, now()).unwrap(), world);
        assert_eq!(count(), before_upgrade + 1);

        // The red thread from Black pond is retired: a newly joined Hoppy Cat
        // has no pond door, and its ship lane is learned. Continue from a
        // visitor already in the garden.
        assert!(!world.project(0).unwrap()["actions"]
            .as_array()
            .unwrap()
            .iter()
            .any(|a| a["kind"] == "move" && a["target"] == "hoppycat-halfway-tea-garden"));
        world.game["actors"]["vale"]["place"] = json!("hoppycat-halfway-tea-garden");
        let id = "g".repeat(48);
        store::create(&c, &id, "owner", now()).unwrap();
        full_store::seed(&c, &id, &world, "hoppycat-garden-visitor", now()).unwrap();
        let mut world = full_store::world(&c, &id, now()).unwrap();

        // Use the pack's custody rule (taking the cup beside Hoppy Cat commits
        // the welcome), then return through the bridge using the current
        // C-hosted rules.
        for (kind, field, value) in [
            ("take", "item", "hoppycat-halfway-cup"),
            ("move", "target", "pond"),
        ] {
            let action = world.project(0).unwrap()["actions"]
                .as_array()
                .unwrap()
                .iter()
                .find(|action| action["kind"] == kind && action[field] == value)
                .unwrap()
                .clone();
            full_store::commit(
                &c,
                &id,
                &mut world,
                json!({"op":"play","actor":"vale","action":action}),
                now(),
            )
            .unwrap();
        }
        assert_eq!(world.game["actors"]["vale"]["place"], "pond");
        assert_eq!(
            world.game["packs"]["hoppycat-archive"]["flags"]["hoppycat-welcome"],
            true
        );
        assert!(world.game["packs"]["hoppycat-archive"]["receipts"]["hoppycat-welcome"].is_u64());
        assert_eq!(
            world.game["items"]["hoppycat-halfway-cup"]["holder"],
            "vale"
        );
        let views = [world.project(0).unwrap(), world.project(1).unwrap()];
        drop(c);
        let c = store::open(&path).unwrap();
        full_store::schema(&c).unwrap();
        assert_eq!(full_store::world(&c, &id, now()).unwrap(), world);
        c.execute("DELETE FROM card_full_checkpoints", []).unwrap();
        let replay = full_store::world(&c, &id, now()).unwrap();
        assert_eq!(replay, world);
        assert_eq!(replay.project(0).unwrap(), views[0]);
        assert_eq!(replay.project(1).unwrap(), views[1]);
        drop(c);
        std::fs::remove_file(path).unwrap();
    }
}

#[test]
fn shared_run_seed_is_the_world_id_hash() {
    // SHA-256("abc") starts ba 78 16 bf.
    assert_eq!(super::full_world::run_seed("abc"), 0xba78_16bf);
}

// A refused save says where validation failed, so the host log of a 409
// names the check without the world's contents (2026-11-01).
#[test]
fn a_refused_save_names_where_the_rules_refused_it() {
    let request = json!({
        "op":"validate", "world":{"schema":1}, "actor":"vale",
        "claimed":["vale"], "present":["vale"]
    });
    let error = super::engine::reduce_pack(
        super::engine::VERSION,
        Some(super::content::current()),
        request,
    )
    .unwrap_err();
    assert!(
        error.contains("fresh start") && error.contains("decodeSave:"),
        "{error}"
    );
}
