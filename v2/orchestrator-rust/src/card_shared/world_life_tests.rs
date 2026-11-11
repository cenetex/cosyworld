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
    // A way is the party's (rules 133): open for the traveller, open for the
    // resident asked along.
    assert!(permitted["actions"]
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

// Rules 100's round stays cheap in bounded QuickJS: on a busy world, every
// ranged resident walking home and the cast going to sleep through dusk, the
// slowest play stays far inside the 2 s deadline.
#[test]
#[ignore = "package 6 fixtures"]
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
