use super::{content, engine, full_store, full_world::World, now, store};
use serde_json::{json, Value};

fn fixture(name: &str, world: &World) -> (std::path::PathBuf, rusqlite::Connection, String) {
    let path = std::env::temp_dir().join(format!("{name}-{}.sqlite", crate::random_hex(12)));
    let c = store::open(&path).unwrap();
    full_store::schema(&c).unwrap();
    let id = "f".repeat(48);
    store::create(&c, &id, "owner", now()).unwrap();
    full_store::seed(&c, &id, world, name, now()).unwrap();
    (path, c, id)
}

fn created(version: &str) -> World {
    let pack = engine::takes_content(version).then(|| content::seeded(version).into());
    let game = engine::reduce_pack(
        version,
        Some(content::seeded(version)),
        json!({"op":"create","seed":9}),
    )
    .unwrap()["world"]
        .clone();
    World {
        version: version.into(),
        game,
        claimed: [0; 8],
        present: [0; 8],
        pack,
    }
}

fn pick(world: &World, test: impl Fn(&Value) -> bool) -> Option<Value> {
    let view = world.project(0).unwrap();
    view["actions"]
        .as_array()
        .unwrap()
        .iter()
        .find(|a| test(a))
        .cloned()
}

fn play(action: Value) -> Value {
    json!({"op":"play","actor":"vale","action":action})
}

fn plain_wait(a: &Value) -> bool {
    a["kind"] == "wait" && a["sleep"] != true && a.get("guards").is_none()
}

const GUARD: &str = "greek-guard";

#[test]
fn resident_passage_checks_each_traveller_in_the_c_host() {
    let mut inputs: Value = serde_json::from_str(content::current_text()).unwrap();
    let beyond =
        inputs["files"]["v2/card-game/world-life.json"]["residents"][GUARD]["guards"].clone();
    let greek = inputs["files"]["v2/card-game/packs.json"]["packs"]
        .as_array_mut()
        .unwrap()
        .iter_mut()
        .find(|pack| pack["id"] == "greek-drama")
        .unwrap();
    greek["avatars"][GUARD]["passWhen"] = json!([{"kind":"trusted","actor":GUARD,"min":1}]);
    let text = inputs.to_string();
    let hash = content::hash(&text);
    let c = rusqlite::Connection::open_in_memory().unwrap();
    full_store::schema(&c).unwrap();
    c.execute(
        "INSERT INTO card_full_packs(hash,revision,content) VALUES(?,?,?)",
        rusqlite::params![hash, "resident-passage", text],
    )
    .unwrap();
    content::preload(&c, &hash).unwrap();
    let game = engine::reduce_pack(
        engine::VERSION,
        Some(&hash),
        json!({"op":"create","seed":9}),
    )
    .unwrap()["world"]
        .clone();
    let mut world = World {
        version: engine::VERSION.into(),
        game,
        claimed: [0; 8],
        present: [0; 8],
        pack: Some(hash),
    };
    world.claimed[0] = 1;
    world.present[0] = 1;
    world.claimed[1] = 1;
    world.present[1] = 1;
    world.game.as_object_mut().unwrap().remove("opening");
    for actor in ["vale", "mara", "greek-ismene"] {
        world.game["actors"][actor]["place"] = json!("greek-gate");
    }
    world.game["packs"]["greek-drama"]["met"]["greek-ismene"] = json!(0);
    world.game["actors"][GUARD]["trust"]["vale"] = json!(1);
    let permitted = world.project(0).unwrap();
    let blocked = world.project(1).unwrap();
    assert!(permitted["exits"].as_array().unwrap().contains(&beyond));
    assert!(!blocked["exits"].as_array().unwrap().contains(&beyond));
    assert!(!permitted["actions"]
        .as_array()
        .unwrap()
        .iter()
        .any(|action| {
            action["kind"] == "accompany"
                && action["target"] == "greek-ismene"
                && action["destination"] == beyond
        }));
    world.game["actors"][GUARD]["trust"]["greek-ismene"] = json!(1);
    let accompanied = world.project(0).unwrap();
    assert!(accompanied["actions"]
        .as_array()
        .unwrap()
        .iter()
        .any(|action| {
            action["kind"] == "accompany"
                && action["target"] == "greek-ismene"
                && action["destination"] == beyond
        }));
    assert_eq!(world.game["actors"][GUARD]["guarding"], beyond);
}

// Rules 100 in the C QuickJS host: residents fall asleep on their scattered
// schedules (`sleeping.until`, `slept`), the Gate Guard bars the battlefield
// (`guarding`), is knocked through by a lost fight (`homeward`), walks home
// off-stage and bars it again, and a player stands guard (`guarding` on a
// seat, `guards` on its Wait). The journal alone rebuilds every new record
// exactly, here and reopened.
#[test]
fn rules_100_world_life_commits_and_replays_in_the_c_host() {
    let mut world = created(engine::VERSION);
    let game = &mut world.game;
    game.as_object_mut().unwrap().remove("opening");
    game["turn"] = json!(116);
    game["revision"] = json!(116);
    game["actors"]["vale"]["place"] = json!("greek-gate");
    game["crossings"]["pond-greek-harbor"]["discovered"] = json!(true);
    let (path, c, id) = fixture("world-life", &world);
    let commit = |w: &mut World, command: Value| {
        full_store::commit(&c, &id, w, command.clone(), now())
            .unwrap_or_else(|e| panic!("{command}: {e}"))
    };
    commit(&mut world, json!({"op":"claim","actor":"vale"}));
    commit(&mut world, json!({"op":"enter","actor":"vale"}));
    assert_eq!(world.game["actors"][GUARD]["guarding"], "greek-battlefield");
    let wait = |w: &World| play(pick(w, plain_wait).expect("a wait"));

    // Through dusk into the night: the Theban cast sleeps at home.
    for _ in 0..14 {
        let next = wait(&world);
        commit(&mut world, next);
    }
    let creon = &world.game["actors"]["greek-creon"];
    assert_eq!(creon["sleeping"]["place"], "greek-palace");
    assert!(creon["sleeping"]["until"].as_i64().unwrap() > world.game["turn"].as_i64().unwrap());
    assert!(creon["slept"].is_i64());
    // Asleep, Creon is no one to ask: the guard at the gate never sleeps.
    assert!(world.game["actors"][GUARD].get("sleeping").is_none());

    // Beat the guard at his post: he is knocked onto the battlefield.
    let threat = pick(&world, |a| a["kind"] == "threaten" && a["target"] == GUARD).unwrap();
    commit(&mut world, play(threat));
    for _ in 0..24 {
        if world.game["actors"][GUARD]["place"] != "greek-gate" {
            break;
        }
        let next = pick(&world, |a| a["kind"] == "attack" && a["target"] == GUARD)
            .unwrap_or_else(|| pick(&world, plain_wait).unwrap());
        commit(&mut world, play(next));
    }
    assert_eq!(world.game["actors"][GUARD]["place"], "greek-battlefield");
    assert_eq!(world.game["actors"][GUARD]["homeward"], true);
    for _ in 0..6 {
        if world.game["standoffs"].as_array().unwrap().is_empty() {
            break;
        }
        let next = wait(&world);
        commit(&mut world, next);
    }
    // While he is away the way is open, and Vale stands guard over it.
    let guard = pick(&world, |a| a["guards"] == "greek-battlefield").expect("Guard");
    assert_eq!(guard["label"], "Guard");
    commit(&mut world, play(guard));
    assert_eq!(
        world.game["actors"]["vale"]["guarding"],
        "greek-battlefield"
    );
    let stood = world.game["log"]
        .as_array()
        .unwrap()
        .iter()
        .rev()
        .find(|e| e["actorId"] == "vale" && e["verb"] == "wait")
        .unwrap()
        .clone();
    assert_eq!(stood["guards"], "greek-battlefield");
    // He walks home after the peace and bars the way again.
    for _ in 0..8 {
        if world.game["actors"][GUARD]["place"] == "greek-gate" {
            break;
        }
        let next = wait(&world);
        commit(&mut world, next);
    }
    assert_eq!(world.game["actors"][GUARD]["place"], "greek-gate");
    assert_eq!(world.game["actors"][GUARD]["guarding"], "greek-battlefield");
    assert!(world.game["actors"][GUARD].get("homeward").is_none());
    assert!(world.game["actors"]["vale"].get("guarding").is_none());

    // The journal alone rebuilds the same world, here and reopened.
    c.execute("DELETE FROM card_full_checkpoints WHERE world=?", [&id])
        .unwrap();
    assert_eq!(full_store::world(&c, &id, now()).unwrap(), world);
    drop(c);
    let reopened = store::open(&path).unwrap();
    full_store::schema(&reopened).unwrap();
    assert_eq!(full_store::world(&reopened, &id, now()).unwrap(), world);
    let _ = std::fs::remove_file(path);
}

// A rules 99 world mid-opening, its player holding a halfway quest and a
// glimpse, upgrades to 100 through the one recorded upgrade: its opening,
// packs, glimpse and halfway records are kept, every new field is absent
// but the guard's post, its journal replays on rules 99 and then 100, and
// the opening plays on.
#[test]
#[ignore = "rules bump: old worlds retire (package 6 fixtures)"]
fn rules_99_world_upgrades_to_100_keeping_its_opening_and_packs() {
    let mut world = created(engine::NINETY_NINTH_VERSION);
    let vale = &mut world.game["actors"]["vale"];
    vale["level"] = json!(1);
    vale["xp"] = json!(2);
    vale["carried"] = json!(2);
    vale["halfwayIssued"] = json!(2);
    vale["glimpse"] = json!({"level":2,"kind":"place","id":"attic","at":"attic"});
    let (path, c, id) = fixture("rules-99-upgrade", &world);
    let commit = |w: &mut World, command: Value| {
        full_store::commit(&c, &id, w, command.clone(), now())
            .unwrap_or_else(|e| panic!("{command}: {e}"))
    };
    commit(&mut world, json!({"op":"claim","actor":"vale"}));
    commit(&mut world, json!({"op":"enter","actor":"vale"}));
    let waited = play(pick(&world, plain_wait).unwrap());
    commit(&mut world, waited);
    let old = world.game.clone();
    assert_eq!(old["opening"]["crossed"], false);
    assert!(old["actors"][GUARD].get("guarding").is_none());

    let upgraded = full_store::world(&c, &id, now()).unwrap();
    assert_eq!(upgraded.version, engine::VERSION);
    // Greek revision 20 and Hoppy revision 4 update their rooms and things.
    let old = super::saved_items::current_pack_changes(&old, &upgraded.game);
    for field in ["opening", "packs", "items", "turn", "log"] {
        assert_eq!(
            upgraded.game[field],
            super::saved_items::current_field(&old, field),
            "Keep {field}"
        );
    }
    assert_eq!(upgraded.game.get("disabledPacks"), old.get("disabledPacks"));
    for (actor, before) in old["actors"].as_object().unwrap() {
        for (key, value) in before.as_object().unwrap() {
            assert_eq!(&upgraded.game["actors"][actor][key], value, "{actor}.{key}");
        }
        let after = &upgraded.game["actors"][actor];
        for key in ["homeward", "slept", "sleeping"] {
            assert!(after.get(key).is_none(), "{actor}.{key}");
        }
    }
    // The only new record: the guard takes his post.
    assert_eq!(
        upgraded.game["actors"][GUARD]["guarding"],
        "greek-battlefield"
    );
    assert_eq!(upgraded.game["actors"]["vale"]["halfwayIssued"], 2);
    assert_eq!(upgraded.game["actors"]["vale"]["glimpse"]["id"], "attic");
    // Under current rules, quietly stowing the lamp opens the mirror.
    let mut world = upgraded;
    let turn = world.game["turn"].clone();
    let history = world.game["log"].clone();
    let stow = json!({"op":"hold","actor":"vale","choice":{
        "item":null,"revision":world.game["revision"]}});
    commit(&mut world, stow);
    assert_eq!(world.game["turn"], turn);
    assert_eq!(world.game["log"], history);
    assert_eq!(world.game["items"]["lamp"]["lit"], false);
    c.execute("DELETE FROM card_full_checkpoints WHERE world=?", [&id])
        .unwrap();
    assert_eq!(full_store::world(&c, &id, now()).unwrap(), world);
    let _ = std::fs::remove_file(path);
}

// Rules 100's round stays cheap in bounded QuickJS: on a busy world, every
// ranged resident walking home and the cast going to sleep through dusk, the
// slowest play stays far inside the 2 s deadline.
#[test]
#[ignore = "rules bump: old worlds retire (package 6 fixtures)"]
fn rules_100_busy_world_plays_well_inside_the_deadline() {
    let mut world: Value = serde_json::from_str(include_str!(
        "../../../../test/fixtures/card-world-life-busy.json"
    ))
    .unwrap();
    let seats = |op: &str, world: &Value| json!({"op":op,"world":world,"actor":"vale","claimed":["vale"],"present":["vale"]});
    let mut slowest = std::time::Duration::ZERO;
    for _ in 0..12 {
        let view = engine::reduce(seats("view", &world)).unwrap();
        let wait = view["actions"]
            .as_array()
            .unwrap()
            .iter()
            .find(|a| plain_wait(a))
            .unwrap()
            .clone();
        let mut request = seats("play", &world);
        request["action"] = wait;
        let started = std::time::Instant::now();
        let done = engine::reduce(request).unwrap();
        slowest = slowest.max(started.elapsed());
        assert_eq!(done["ok"], true, "{}", done["error"]);
        world = done["world"].clone();
    }
    eprintln!("rules 100 busy world: slowest play {slowest:?}");
    assert!(slowest < std::time::Duration::from_millis(1500));
}

#[test]
fn current_company_replays_real_talk_and_separation_without_checkpoints() {
    let mut world = World::seeded(None, Some(7)).unwrap();
    world.claimed[0] = 1;
    world.present[0] = 1;
    world.claimed[1] = 1;
    world.present[1] = 1;
    world.game.as_object_mut().unwrap().remove("opening");
    let fable = "hoppycat-fable";
    world.game["actors"]["vale"]["place"] = world.game["actors"][fable]["place"].clone();
    world.game["packs"]["hoppycat-archive"]["met"][fable] = json!(0);
    let (path, c, id) = fixture("current-company", &world);
    let pair = |w: &World| {
        w.game["conversations"]
            .as_array()
            .unwrap()
            .iter()
            .find(|row| {
                row["actors"].as_array().unwrap().contains(&json!(fable))
                    && row["actors"].as_array().unwrap().contains(&json!("vale"))
            })
            .unwrap()
            .clone()
    };
    let talk = pick(&world, |a| a["kind"] == "talk" && a["target"] == fable).unwrap();
    full_store::commit(&c, &id, &mut world, play(talk), now()).unwrap();
    let first = pair(&world);
    assert!(first["company"].as_u64().unwrap() >= first["seq"].as_u64().unwrap());
    let view = world.project(1).unwrap();
    let wait = view["actions"]
        .as_array()
        .unwrap()
        .iter()
        .find(|a| plain_wait(a))
        .unwrap()
        .clone();
    full_store::commit(
        &c,
        &id,
        &mut world,
        json!({"op":"play","actor":"mara","action":wait}),
        now(),
    )
    .unwrap();
    assert_eq!(pair(&world), first);
    c.execute("DELETE FROM card_full_checkpoints WHERE world=?", [&id])
        .unwrap();
    assert_eq!(full_store::world(&c, &id, now()).unwrap(), world);
    let walk = pick(&world, |a| a["kind"] == "move").unwrap();
    full_store::commit(&c, &id, &mut world, play(walk), now()).unwrap();
    assert!(pair(&world).get("company").is_none());
    assert_eq!(pair(&world)["seq"], first["seq"]);
    c.execute("DELETE FROM card_full_checkpoints WHERE world=?", [&id])
        .unwrap();
    drop(c);
    let reopened = store::open(&path).unwrap();
    full_store::schema(&reopened).unwrap();
    assert_eq!(full_store::world(&reopened, &id, now()).unwrap(), world);
    drop(reopened);
    std::fs::remove_file(path).unwrap();
}

// Synthetic, reachable rules-130 opening. No inventory, gate or meeting edits.
#[test]
#[ignore = "rules bump: old worlds retire (package 6 fixtures)"]
fn radio_entry_consequences_replay_without_checkpoints() {
    use sha2::{Digest, Sha256};
    let trace: Value = serde_json::from_str(include_str!(
        "../../../../test/fixtures/radio-entry-rules-130.json"
    ))
    .unwrap();
    let text = include_str!("../../../../test/fixtures/card-content-rules-130.json");
    let hash = content::hash(text);
    assert_eq!(hash, trace["contentSha256"]);
    assert_eq!(
        format!("{:x}", Sha256::digest(include_bytes!("engine-v130.js"))),
        trace["engineSha256"]
    );
    let mut world = World {
        version: trace["version"].as_str().unwrap().into(),
        game: trace["initial"].clone(),
        claimed: [1, 1, 0, 0, 0, 0, 0, 0],
        present: [1, 0, 0, 0, 0, 0, 0, 0],
        pack: Some(hash.clone()),
    };
    let (path, c, id) = fixture("radio-entry-consequences", &world);
    c.execute(
        "INSERT OR IGNORE INTO card_full_packs(hash,revision,content) VALUES(?,?,?)",
        rusqlite::params![hash, "rules130", text],
    )
    .unwrap();
    content::preload(&c, &hash).unwrap();
    let mut reached = 0;
    for step in trace["steps"].as_array().unwrap() {
        let request = &step["request"];
        if request["actor"] == "mara" && world.present[1] == 0 {
            full_store::commit(
                &c,
                &id,
                &mut world,
                json!({"op":"enter","actor":"mara"}),
                now(),
            )
            .unwrap();
        }
        if request["op"] == "play" {
            let actor = if request["actor"] == "mara" { 1 } else { 0 };
            assert!(world.project(actor).unwrap()["actions"]
                .as_array()
                .unwrap()
                .contains(&request["action"]));
        }
        full_store::commit(&c, &id, &mut world, request.clone(), now()).unwrap();
        assert_eq!(world.game, step["world"], "transition {reached}");
        reached += 1;
    }
    assert_eq!(reached, 15);
    let key = "ratiradio-station-key";
    assert_eq!(
        world.game["items"][key]["holder"],
        "ratiradio-staff-kitchen"
    );
    assert_eq!(
        world.game["packs"]["ratiradio"]["flags"],
        json!({"station-open":true})
    );
    assert_eq!(
        world.game["actors"]["mara"]["place"],
        "ratiradio-staff-kitchen"
    );
    // Neither a view nor a forged old transfer can recreate custody or a deed.
    let before = world.clone();
    for actor in 0..2 {
        world.project(actor).unwrap();
    }
    assert_eq!(world, before);
    let count = || {
        c.query_row(
            "SELECT count(*) FROM card_full_log WHERE world=?",
            [&id],
            |r| r.get::<_, i64>(0),
        )
        .unwrap()
    };
    let rows = count();
    assert!(full_store::commit(
        &c,
        &id,
        &mut world,
        json!({"op":"play","actor":"vale","action":{"kind":"drop","item":key}}),
        now()
    )
    .is_err());
    assert_eq!(world, before);
    assert_eq!(count(), rows);
    for op in ["leave", "enter"] {
        full_store::commit(&c, &id, &mut world, json!({"op":op,"actor":"mara"}), now()).unwrap();
        assert_eq!(world.game["items"][key], before.game["items"][key]);
        assert_eq!(
            world.game["packs"]["ratiradio"],
            before.game["packs"]["ratiradio"]
        );
    }
    c.execute("DELETE FROM card_full_checkpoints WHERE world=?", [&id])
        .unwrap();
    drop(c);
    let reopened = store::open(&path).unwrap();
    full_store::schema(&reopened).unwrap();
    let mut expected = world.clone();
    if engine::historical(&expected.version) {
        expected
            .apply(&json!({"op":"upgrade", "from":world.version,
            "to":engine::VERSION, "seed":super::full_world::run_seed(&id),
            "pack":content::current()}))
            .unwrap();
    } else if expected.pack.as_deref() != Some(content::current()) {
        expected
            .apply(&json!({"op":"repack", "from":world.pack,
            "to":content::current(), "revision":content::REVISION}))
            .unwrap();
    }
    let replayed = full_store::world(&reopened, &id, now()).unwrap();
    assert_eq!(replayed, expected);
    assert_eq!(
        replayed.game["items"][key]["holder"],
        "ratiradio-staff-kitchen"
    );
    assert_eq!(
        replayed.game["packs"]["ratiradio"]["flags"],
        json!({"station-open":true})
    );
    drop(reopened);
    std::fs::remove_file(path).unwrap();
}

#[test]
#[ignore = "rules bump: old worlds retire (package 6 fixtures)"]
fn forest_charm_consequences_replay_without_checkpoints() {
    // Shared worlds reject local dormancy, including after upgrading old history.
    fn reject_toggle(c: &rusqlite::Connection, id: &str, world: &mut World) {
        let before = world.clone();
        let rows = || {
            c.query_row(
                "SELECT count(*) FROM card_full_log WHERE world=?",
                [id],
                |row| row.get::<_, i64>(0),
            )
            .unwrap()
        };
        let count = rows();
        for enable in [false, true] {
            let error = full_store::commit(
                c,
                id,
                world,
                json!({"op":"play","actor":"vale",
                    "action":{"kind":"pack","pack":"cottage","enable":enable}}),
                now(),
            )
            .unwrap_err();
            assert!(error.contains("Shared worlds keep every pack"), "{error}");
            assert_eq!(*world, before);
            assert_eq!(rows(), count);
        }
    }

    use sha2::{Digest, Sha256};
    let trace: Value = serde_json::from_str(include_str!(
        "../../../../test/fixtures/forest-charm-rules-131.json"
    ))
    .unwrap();
    let text = include_str!("../../../../test/fixtures/card-content-rules-131.json");
    let hash = content::hash(text);
    assert_eq!(hash, trace["contentSha256"]);
    assert_eq!(
        format!("{:x}", Sha256::digest(include_bytes!("engine-v131.js"))),
        trace["engineSha256"]
    );
    let charm = "forest-wolfprint-charm";
    for ending in ["keep", "give"] {
        let mut world = World {
            version: trace["version"].as_str().unwrap().into(),
            game: trace["initial"].clone(),
            claimed: [1, 1, 0, 0, 0, 0, 0, 0],
            present: [1, 0, 0, 0, 0, 0, 0, 0],
            pack: Some(hash.clone()),
        };
        let (path, c, id) = fixture(&format!("forest-{ending}-consequences"), &world);
        c.execute(
            "INSERT OR IGNORE INTO card_full_packs(hash,revision,content) VALUES(?,?,?)",
            rusqlite::params![hash, "rules131", text],
        )
        .unwrap();
        content::preload(&c, &hash).unwrap();
        let steps = trace["branches"][ending].as_array().unwrap();
        assert_eq!(steps.len(), 16);
        for (i, step) in steps.iter().enumerate() {
            let request = &step["request"];
            assert!(world.project(0).unwrap()["actions"]
                .as_array()
                .unwrap()
                .contains(&request["action"]));
            full_store::commit(&c, &id, &mut world, request.clone(), now()).unwrap();
            assert_eq!(world.game, step["world"], "{ending} transition {i}");
            // Reject the repeated gift at the cottage, not merely an absent recipient.
            if ending == "give" && i == 11 {
                let before = world.clone();
                let rows = || {
                    c.query_row(
                        "SELECT count(*) FROM card_full_log WHERE world=?",
                        [&id],
                        |row| row.get::<_, i64>(0),
                    )
                    .unwrap()
                };
                let count = rows();
                assert!(full_store::commit(&c, &id, &mut world, request.clone(), now()).is_err());
                assert_eq!(world, before);
                assert_eq!(rows(), count);
            }
        }
        let kept = ending == "keep";
        let holder = if kept { "vale" } else { "forest-cottage" };
        let check = |game: &Value| {
            let forest = &game["packs"]["lonely-forest"];
            assert_eq!(game["items"][charm]["holder"], holder);
            assert_eq!(forest["flags"]["forest-homecoming-shared"], true);
            assert_eq!(
                forest["receipts"]["forest-keep-charm"],
                if kept { json!(12) } else { Value::Null }
            );
            assert_eq!(
                forest["receipts"]["forest-leave-charm"],
                if kept { Value::Null } else { json!(12) }
            );
            for (who, turn) in [("rati", 1), ("skull", 5), ("oak", 8)] {
                assert_eq!(forest["met"][who], turn);
            }
        };
        check(&world.game);
        reject_toggle(&c, &id, &mut world);
        assert_eq!(
            pick(&world, |a| a["kind"] == "move"
                && a["target"] == "forest-trail")
            .is_some(),
            kept
        );
        // Mara reconnects at her real Theatre. A public homecoming is not travel.
        for op in ["enter", "leave", "enter"] {
            full_store::commit(&c, &id, &mut world, json!({"op":op,"actor":"mara"}), now())
                .unwrap();
            check(&world.game);
        }
        let before = world.clone();
        for _ in 0..2 {
            let mara = world.project(1).unwrap();
            assert_eq!(mara["room"], "theatre");
            check(&mara["world"]);
        }
        assert_eq!(world, before);
        c.execute("DELETE FROM card_full_checkpoints WHERE world=?", [&id])
            .unwrap();
        drop(c);
        let reopened = store::open(&path).unwrap();
        full_store::schema(&reopened).unwrap();
        let mut expected = world.clone();
        if engine::historical(&expected.version) {
            expected
                .apply(&json!({"op":"upgrade", "from":world.version,
                "to":engine::VERSION, "seed":super::full_world::run_seed(&id),
                "pack":content::current()}))
                .unwrap();
        } else if expected.pack.as_deref() != Some(content::current()) {
            expected
                .apply(&json!({"op":"repack", "from":world.pack,
                "to":content::current(), "revision":content::REVISION}))
                .unwrap();
        }
        let mut replayed = full_store::world(&reopened, &id, now()).unwrap();
        assert_eq!(replayed, expected);
        check(&replayed.game);
        reject_toggle(&reopened, &id, &mut replayed);
        assert_eq!(full_store::world(&reopened, &id, now()).unwrap(), replayed);
        drop(reopened);
        std::fs::remove_file(path).unwrap();
    }
}

// Fresh seed-92 traversal: historical hashes never follow current migrations.
#[test]
#[ignore = "rules bump: old worlds retire (package 6)"]
fn raven_return_replays_reachable_awakening_and_second_traveler() {
    use sha2::{Digest, Sha256};
    let trace: Value = serde_json::from_str(include_str!(
        "../../../../test/fixtures/raven-return-rules-131.json"
    ))
    .unwrap();
    let text = include_str!("../../../../test/fixtures/card-content-rules-131.json");
    let hash = content::hash(text);
    let digest = |v: &Value| format!("{:x}", Sha256::digest(v.to_string().as_bytes()));
    assert_eq!(hash, trace["contentSha256"]);
    assert_eq!(
        format!("{:x}", Sha256::digest(include_bytes!("engine-v131.js"))),
        trace["engineSha256"]
    );
    assert_eq!(digest(&trace["initial"]), trace["initialSha256"]);
    let mut world = World {
        version: trace["version"].as_str().unwrap().into(),
        game: trace["initial"].clone(),
        claimed: [1, 0, 0, 0, 0, 0, 0, 0],
        present: [1, 0, 0, 0, 0, 0, 0, 0],
        pack: Some(hash.clone()),
    };
    let (path, c, id) = fixture("raven-return", &world);
    c.execute(
        "INSERT OR IGNORE INTO card_full_packs(hash,revision,content) VALUES(?,?,?)",
        rusqlite::params![hash, "rules131", text],
    )
    .unwrap();
    content::preload(&c, &hash).unwrap();
    let home = "ratiradio-listening-room";
    let raven = "ratiradio-raven";
    let receipt = "ratiradio-return-things";
    let steps = trace["steps"].as_array().unwrap();
    assert_eq!(steps.len(), 81);
    for (index, step) in steps.iter().enumerate() {
        let request = &step["request"];
        let actor = if request["actor"] == "mara" { 1 } else { 0 };
        if request["op"] == "play" {
            assert!(world.project(actor).unwrap()["actions"]
                .as_array()
                .unwrap()
                .contains(&request["action"]));
        }
        // Native claims/presence are journal operations, not ordinary plays.
        let command = step.get("nativeCommand").unwrap_or(request);
        let before = command.clone();
        full_store::commit(&c, &id, &mut world, command.clone(), now())
            .unwrap_or_else(|e| panic!("operation {}: {e}", index + 1));
        assert_eq!(command, &before);
        assert_eq!(
            digest(&world.game),
            step["worldSha256"],
            "operation {}",
            index + 1
        );
        let radio = &world.game["packs"]["ratiradio"];
        assert_eq!(radio["flags"]["raven-awake"] == true, index >= 58);
        if index >= 58 {
            assert_eq!(radio["receipts"][receipt], 55);
            assert_eq!(radio["met"][raven], 55);
        }
        if (60..=63).contains(&index) {
            assert_eq!(
                world.game["actors"][raven]["place"],
                [
                    "ratiradio-dispatch-window",
                    "ratiradio-staff-kitchen",
                    "station",
                    "pond"
                ][index - 60]
            );
        }
        if index == 69 {
            assert!(!world.project(1).unwrap()["actions"]
                .as_array()
                .unwrap()
                .iter()
                .any(|a| a["kind"] == "move" && a["target"] == "clearing"));
        }
        if index == 79 {
            assert_eq!(world.present[1], 0);
        }
        if index == 80 {
            assert_eq!(world.present[1], 1);
        }
    }
    let assert_return = |w: &World| {
        assert_eq!(w.game["packs"]["ratiradio"]["flags"]["raven-awake"], true);
        assert_eq!(w.game["packs"]["ratiradio"]["receipts"][receipt], 55);
        assert_eq!(w.game["packs"]["ratiradio"]["met"][raven], 55);
        assert_eq!(w.game["items"]["ratiradio-glass"]["holder"], "vale");
        assert_eq!(w.game["items"]["ratiradio-raven-figurine"]["holder"], home);
        assert_eq!(w.game["items"]["mask"]["holder"], "mara");
        assert_eq!(w.game["actors"]["mara"]["place"], home);
        assert_eq!(w.game["actors"]["vale"]["place"], home);
        assert_eq!(w.game["actors"][raven]["place"], "pond");
        assert!(!w.game["conversations"]
            .as_array()
            .unwrap()
            .iter()
            .any(|row| {
                let actors = row["actors"].as_array().unwrap();
                actors.contains(&json!("mara")) && actors.contains(&json!(raven))
            }));
    };
    assert_return(&world);
    let before = world.clone();
    let count = || {
        c.query_row(
            "SELECT count(*) FROM card_full_log WHERE world=?",
            [&id],
            |r| r.get::<_, i64>(0),
        )
        .unwrap()
    };
    let rows = count();
    assert_eq!(rows, 82); // One fresh seed plus every real operation.
    for actor in 0..2 {
        world.project(actor).unwrap();
    }
    for command in [
        json!({"op":"play","actor":"vale","action":steps[58]["request"]["action"]}),
        json!({"op":"hold","actor":"vale","choice":{"item":null,"revision":76}}),
    ] {
        assert!(full_store::commit(&c, &id, &mut world, command, now()).is_err());
        assert_eq!(world, before);
        assert_eq!(count(), rows);
    }
    // Remove only this synthetic database's checkpoints, then close and reopen.
    c.execute("DELETE FROM card_full_checkpoints WHERE world=?", [&id])
        .unwrap();
    drop(c);
    let reopened = store::open(&path).unwrap();
    full_store::schema(&reopened).unwrap();
    let mut expected = world.clone();
    let changed = if engine::historical(&world.version) {
        Some(
            json!({"op":"upgrade","from":world.version,"to":engine::VERSION,
            "seed":super::full_world::run_seed(&id),"pack":content::current()}),
        )
    } else if world.pack.as_deref() != Some(content::current()) {
        Some(
            json!({"op":"repack","from":world.pack,"to":content::current(),"revision":content::REVISION}),
        )
    } else {
        None
    };
    if let Some(command) = &changed {
        expected.apply(command).unwrap();
    }
    let replayed = full_store::world(&reopened, &id, now()).unwrap();
    assert_eq!(replayed, expected);
    assert_return(&replayed);
    let after: i64 = reopened
        .query_row(
            "SELECT count(*) FROM card_full_log WHERE world=?",
            [&id],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(after, rows + i64::from(changed.is_some()));
    if let Some(command) = changed {
        let last: String = reopened
            .query_row(
                "SELECT command FROM card_full_log WHERE world=? ORDER BY seq DESC LIMIT 1",
                [&id],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(serde_json::from_str::<Value>(&last).unwrap(), command);
    }
    // The explicit upgrade/repack must itself survive checkpoint-free replay.
    reopened
        .execute("DELETE FROM card_full_checkpoints WHERE world=?", [&id])
        .unwrap();
    assert_eq!(full_store::world(&reopened, &id, now()).unwrap(), expected);
    drop(reopened);
    std::fs::remove_file(path).unwrap();
}

#[test]
#[ignore = "rules bump: old worlds retire (package 6)"]
fn earned_forest_scarf_replays_without_checkpoints() {
    use sha2::{Digest, Sha256};
    let trace: Value = serde_json::from_str(include_str!(
        "../../../../test/fixtures/forest-scarf-rules-132.json"
    ))
    .unwrap();
    let text = include_str!("../../../../test/fixtures/card-content-rules-132.json");
    let hash = content::hash(text);
    assert_eq!(hash, trace["contentSha256"]);
    assert_eq!(
        format!("{:x}", Sha256::digest(include_bytes!("engine-v132.js"))),
        trace["engineSha256"]
    );
    let path = std::env::temp_dir().join(format!(
        "earned-forest-scarf-{}.sqlite",
        crate::random_hex(12)
    ));
    let c = store::open(&path).unwrap();
    full_store::schema(&c).unwrap();
    c.execute(
        "INSERT INTO card_full_packs(hash,revision,content) VALUES(?,?,?)",
        rusqlite::params![hash, "rules132", text],
    )
    .unwrap();
    content::preload(&c, &hash).unwrap();
    let version = trace["version"].as_str().unwrap();
    let game = engine::reduce_pack(
        version,
        Some(&hash),
        json!({"op":"create","seed":17,"save":trace["save"]}),
    )
    .unwrap()["world"]
        .clone();
    let digest = |game: &Value| content::hash(&game.to_string());
    assert_eq!(digest(&game), trace["initialSha256"]);
    let mut world = World {
        version: version.into(),
        game,
        claimed: [0; 8],
        present: [0; 8],
        pack: Some(hash),
    };
    let id = "f".repeat(48);
    store::create(&c, &id, "owner", now()).unwrap();
    full_store::seed(&c, &id, &world, "unplayed-forest-landing", now()).unwrap();
    let rows = || {
        c.query_row(
            "SELECT count(*) FROM card_full_log WHERE world=?",
            [&id],
            |row| row.get::<_, i64>(0),
        )
        .unwrap()
    };
    let mut reached = 0;
    for step in trace["steps"].as_array().unwrap() {
        let command = &step["command"];
        let actor = if command["actor"] == "mara" { 1 } else { 0 };
        if command["op"] == "claim" {
            let user = if actor == 0 { "owner" } else { "visitor" };
            super::bindings::claim(&c, &id, user, actor).unwrap();
        }
        if command["op"] == "play" {
            assert!(world.project(actor).unwrap()["actions"]
                .as_array()
                .unwrap()
                .contains(&command["action"]));
            reached += 1;
        }
        full_store::commit(&c, &id, &mut world, command.clone(), now()).unwrap();
        assert_eq!(digest(&world.game), step["sha256"], "transition {reached}");
        if command["op"] == "play" && world.game["turn"] == 50 {
            // Vale left the sewn scarf behind, without completing the keepsake.
            assert!(world.game["actors"]["vale"]["upgrades"].is_null());
            assert_eq!(
                world.game["items"]["forest-scarf-vale"]["holder"],
                "forest-cottage"
            );
            assert_eq!(
                world.game["packs"]["lonely-forest"]["receipts"]["forest-sew-scarf-vale"],
                49
            );
            assert!(
                world.game["packs"]["lonely-forest"]["receipts"]["forest-wear-scarf-vale"]
                    .is_null()
            );
        }
        // Retry each consuming action while its recipient/place is still present.
        if command["action"]["kind"] == "give" || command["action"]["item"] == "forest-scarf-vale" {
            let before = world.clone();
            let count = rows();
            assert!(full_store::commit(&c, &id, &mut world, command.clone(), now()).is_err());
            assert_eq!(world, before);
            assert_eq!(rows(), count);
        }
    }
    assert_eq!(reached, 54);
    assert_eq!(rows(), 61); // One seed, four claims/entries, two reconnects, 54 plays.
    let check = |w: &World| {
        let forest = &w.game["packs"]["lonely-forest"];
        assert_eq!(w.game["actors"]["vale"]["upgrades"], json!(["scarf"]));
        assert!(w.game["actors"]["mara"]["upgrades"].is_null());
        for (choice, turn) in [("hide-button", 45), ("sew-scarf", 49), ("wear-scarf", 52)] {
            assert_eq!(forest["receipts"][format!("forest-{choice}-vale")], turn);
        }
        assert_eq!(forest["flags"]["forest-scarf-vale-worn"], true);
        assert!(forest["receipts"]["forest-wear-scarf-mara"].is_null());
        for item in ["forest-button-vale", "forest-scarf-vale"] {
            assert_eq!(
                w.game["items"][item],
                json!({"holder":"forest-cottage","history":[]})
            );
            assert!(!w.project(0).unwrap()["actions"]
                .as_array()
                .unwrap()
                .iter()
                .any(|a| a["item"] == item));
        }
    };
    check(&world);
    let before = world.clone();
    let count = rows();
    // The play adapter checks revisions; the host journals canonical choices.
    let mut stale = world.request("play", 0);
    stale["action"] = pick(&world, plain_wait).unwrap();
    stale["revision"] = json!(world.game["revision"].as_u64().unwrap() - 1);
    assert!(engine::reduce_pack(version, world.pack.as_deref(), stale).is_err());
    // Quiet held choices carry their revision all the way into commit.
    let stale_hold = json!({"op":"hold","actor":"vale","choice":{"item":null,
        "revision":world.game["revision"].as_u64().unwrap()-1}});
    assert!(full_store::commit(&c, &id, &mut world, stale_hold, now()).is_err());
    assert_eq!(world.project(1).unwrap()["room"], "theatre");
    assert_eq!(world, before);
    assert_eq!(rows(), count);
    assert_eq!(
        super::bindings::upgrades(&c, "owner", 0).unwrap(),
        vec!["scarf"]
    );
    assert!(super::bindings::upgrades(&c, "visitor", 1)
        .unwrap()
        .is_empty());
    c.execute("DELETE FROM card_full_checkpoints WHERE world=?", [&id])
        .unwrap();
    drop(c);
    let reopened = store::open(&path).unwrap();
    full_store::schema(&reopened).unwrap();
    let mut expected = world.clone();
    if engine::historical(&expected.version) {
        expected
            .apply(
                &json!({"op":"upgrade","from":world.version,"to":engine::VERSION,
            "seed":super::full_world::run_seed(&id),"pack":content::current()}),
            )
            .unwrap();
    } else if expected.pack.as_deref() != Some(content::current()) {
        expected
            .apply(
                &json!({"op":"repack","from":world.pack,"to":content::current(),
            "revision":content::REVISION}),
            )
            .unwrap();
    }
    let replayed = full_store::world(&reopened, &id, now()).unwrap();
    assert_eq!(replayed, expected);
    check(&replayed);
    assert_eq!(
        super::bindings::upgrades(&reopened, "owner", 0).unwrap(),
        vec!["scarf"]
    );
    assert!(super::bindings::upgrades(&reopened, "visitor", 1)
        .unwrap()
        .is_empty());
    drop(reopened);
    std::fs::remove_file(path).unwrap();
}
