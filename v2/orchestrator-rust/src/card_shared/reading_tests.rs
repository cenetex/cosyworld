use super::{engine, full_store, full_world::World, now, store};
use serde_json::{json, Value};
use std::time::Instant;

const PACK: &str = "greek-drama";
const SITE: &str = "greek-viii-frogs-court";
const READING: &str = "site:greek-viii-frogs-court:vale";
const COURT: &str = "greek-viii-poets-court";

fn fixture() -> World {
    let root = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .unwrap()
        .parent()
        .unwrap();
    let output = std::process::Command::new("node").current_dir(root).args([
        "--input-type=module", "-e",
        "import {courtJourney} from './test/helpers/greek-readings.mjs'; let w=courtJourney(); w.sharedVersion=1;w.actors.mara.place='greek-viii-poets-court';w.actors.ash.place='greek-underworld';console.log(JSON.stringify(w));",
    ]).output().expect("Node 24 prepares the real reading journey");
    assert!(
        output.status.success(),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );
    let mut world = World::create(Some(std::str::from_utf8(&output.stdout).unwrap())).unwrap();
    world.claimed = [1, 1, 1, 0, 0, 0, 0, 0];
    world.present = world.claimed;
    assert_eq!(world.game["actors"].as_object().unwrap().len(), 203);
    world
}

fn select(world: &World, actor: usize, fields: &[(&str, &str)]) -> Value {
    world.project(actor).unwrap()["actions"]
        .as_array()
        .unwrap()
        .iter()
        .find(|action| fields.iter().all(|(key, value)| action[*key] == *value))
        .unwrap_or_else(|| panic!("Missing reading action: {fields:?}"))
        .clone()
}

fn play(world: &mut World, actor: usize, fields: &[(&str, &str)]) -> Value {
    let action = select(world, actor, fields);
    let began = Instant::now();
    let result = world
        .apply(&json!({"op":"play","actor":super::full_world::actor_id(actor),"action":action}))
        .unwrap();
    assert!(began.elapsed().as_millis() < 2000);
    result
}

fn start(world: &mut World) {
    play(
        world,
        0,
        &[
            ("readingOp", "invite"),
            ("invitee", "mara"),
            ("siteId", SITE),
        ],
    );
    play(world, 0, &[("readingOp", "start"), ("siteId", SITE)]);
}

#[test]
fn readings_keep_original_pages_and_require_an_explicit_replay_after_a_guest_returns() {
    let mut world = fixture();
    start(&mut world);
    let original = world.game["packs"][PACK]["poemReadings"]["readings"][READING].clone();
    play(&mut world, 0, &[("readingOp", "page")]);
    play(
        &mut world,
        1,
        &[("kind", "move"), ("target", "greek-underworld")],
    );
    play(&mut world, 1, &[("kind", "move"), ("target", COURT)]);
    play(&mut world, 0, &[("readingOp", "page")]);
    let view = world.project(1).unwrap();
    let pages = view["world"]["readingView"]["packs"][PACK]["readings"][0]["pages"]
        .as_array()
        .unwrap();
    assert_eq!(pages.len(), 1);
    assert_eq!(pages[0][0], 0);
    let published =
        world.game["packs"][PACK]["poemReadings"]["readings"][READING]["pages"][1].clone();
    let replay = format!(
        "read:vale:greek-drama:replay:{}",
        format!("{READING}/1/mara")
            .replace(':', "%3A")
            .replace('/', "%2F")
    );
    world
        .apply(&json!({"op":"play","actor":"vale","action":{"key":replay}}))
        .unwrap();
    let current = &world.game["packs"][PACK]["poemReadings"]["readings"][READING];
    assert_eq!(current["turn"], original["turn"]);
    assert_eq!(current["through"], original["through"]);
    assert_eq!(current["selection"], original["selection"]);
    assert_eq!(current["pages"][1][0], published[0]);
    assert_eq!(current["pages"][1][1], published[1]);
    assert_eq!(
        world.project(1).unwrap()["world"]["readingView"]["packs"][PACK]["readings"][0]["pages"]
            .as_array()
            .unwrap()
            .len(),
        2
    );
    assert!(world.apply(&json!({"op":"play","actor":"ash","action":{"key":format!("read:ash:greek-drama:replay:{READING}/0/ash")}})).is_err());
}

#[test]
fn readings_keep_disconnects_in_the_journal_and_filter_raw_history_and_cached_views() {
    let mut world = fixture();
    start(&mut world);
    let first = play(&mut world, 0, &[("readingOp", "page")]);
    let private_to = first["context"]["privateTo"].clone();
    let hearing = first["context"]["hearing"].clone();
    let poem = first["context"]["entities"]
        .as_array()
        .unwrap()
        .iter()
        .find(|e| e["id"] == "greek-viii-aeschylus")
        .unwrap()["poem"]
        .clone();
    let couplet = poem["stanzas"][0]["lines"]
        .as_array()
        .unwrap()
        .iter()
        .map(|s| s.as_str().unwrap())
        .collect::<Vec<_>>()
        .join(" ");
    let path = std::env::temp_dir().join(format!("card-readings-{}.sqlite", crate::random_hex(12)));
    let c = store::open(&path).unwrap();
    full_store::schema(&c).unwrap();
    let id = "c".repeat(48);
    store::create(&c, &id, "owner", now()).unwrap();
    for (actor, user) in [(0, "owner"), (1, "guest"), (2, "outsider")] {
        c.execute(
            "INSERT INTO card_members(world,actor,user,seen) VALUES(?,?,?,?)",
            rusqlite::params![id, actor, user, now()],
        )
        .unwrap();
    }
    full_store::seed(&c, &id, &world, "reading-privacy-source", now()).unwrap();
    full_store::commit(
        &c,
        &id,
        &mut world,
        json!({"op":"speech","actor":"vale","room":COURT,
      "lines":[{"actorId":"vale","text":couplet}],"privateTo":private_to,"hearing":hearing}),
        now(),
    )
    .unwrap();
    let scene = json!({"play":"private-page","room":COURT,"privateTo":private_to,"hearing":hearing,"lines":[{"text":couplet}]});
    c.execute(
        "INSERT INTO card_full_scenes(world,room,play,content) VALUES(?,?,?,?)",
        rusqlite::params![id, COURT, "private-page", scene.to_string()],
    )
    .unwrap();
    full_store::commit(
        &c,
        &id,
        &mut world,
        json!({"op":"leave","actor":"mara"}),
        now(),
    )
    .unwrap();
    full_store::commit(
        &c,
        &id,
        &mut world,
        json!({"op":"enter","actor":"mara"}),
        now(),
    )
    .unwrap();
    let action = select(&world, 0, &[("readingOp", "page")]);
    full_store::commit(
        &c,
        &id,
        &mut world,
        json!({"op":"play","actor":"vale","action":action}),
        now(),
    )
    .unwrap();
    assert_eq!(
        world.game["packs"][PACK]["poemReadings"]["readings"][READING]["departedMask"],
        8
    );
    assert_eq!(
        world.project(1).unwrap()["world"]["readingView"]["packs"][PACK]["readings"][0]["pages"]
            .as_array()
            .unwrap()
            .len(),
        1
    );
    let action = select(&world, 2, &[("kind", "move"), ("target", COURT)]);
    full_store::commit(
        &c,
        &id,
        &mut world,
        json!({"op":"play","actor":"ash","action":action}),
        now(),
    )
    .unwrap();
    for _ in 0..2 {
        let outsider = full_store::snapshot(&c, &id, "outsider", now()).unwrap();
        assert!(!outsider.to_string().contains(&couplet));
        assert_eq!(outsider["history"], json!([]));
        assert_eq!(
            outsider["world"]["readingView"]["packs"][PACK]["readings"],
            json!([])
        );
        let owner = full_store::snapshot(&c, &id, "owner", now()).unwrap();
        assert!(owner.to_string().contains(&couplet));
        assert_eq!(owner["history"].as_array().unwrap().len(), 1);
    }
    c.execute("DELETE FROM card_full_checkpoints WHERE world=?", [&id])
        .unwrap();
    let rebuilt = full_store::world(&c, &id, now()).unwrap();
    assert_eq!(rebuilt, world);
    let _ = std::fs::remove_file(path);
    assert_eq!(engine::VERSION, "full-card-world/22");
}

#[test]
#[ignore = "Run in an exclusive native audit window"]
fn readings_full_archive_and_forty_scene_history_fit_the_game_limits() {
    let save = if let Ok(path) = std::env::var("COSYWORLD_READING_AUDIT_SAVE") {
        std::fs::read_to_string(path).unwrap()
    } else {
        let root = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .parent()
            .unwrap()
            .parent()
            .unwrap();
        let output = std::process::Command::new("node").current_dir(root).args([
            "--input-type=module", "-e",
            "import {fullReadingArchiveWorld} from './test/helpers/greek-reading-envelope.mjs';console.log(JSON.stringify(fullReadingArchiveWorld()));",
        ]).output().unwrap();
        assert!(
            output.status.success(),
            "{}",
            String::from_utf8_lossy(&output.stderr)
        );
        String::from_utf8(output.stdout).unwrap()
    };
    assert!(save.len() <= 2 * 1024 * 1024);
    let imported = Instant::now();
    let mut world = World::create(Some(&save)).unwrap();
    let import_ms = imported.elapsed().as_secs_f64() * 1000.0;
    world.claimed = [1; 8];
    world.present = [1; 8];
    let archive = &world.game["packs"][PACK]["poemReadings"];
    assert_eq!(archive["readings"].as_object().unwrap().len(), 56);
    assert!(archive["readings"]
        .as_object()
        .unwrap()
        .values()
        .all(|r| r["complete"] == true));
    let archive_bytes = serde_json::to_vec(archive).unwrap().len();
    assert!(archive_bytes <= 384 * 1024);
    assert_eq!(world.game["actors"].as_object().unwrap().len(), 203);
    let mut operations = Vec::new();
    for op in ["validate", "context", "play"] {
        for sample in 0..3 {
            let mut request = world.request(op, 0);
            request["world"]["revision"] =
                json!(world.game["revision"].as_u64().unwrap() + sample + 1000);
            if op == "play" {
                request["action"] = json!({"key":"wait:vale::"});
            }
            let began = Instant::now();
            let result = engine::reduce(request).unwrap_or_else(|error| {
                panic!(
                    "Full archive {op} sample {sample}, {:.2} ms: {error}",
                    began.elapsed().as_secs_f64() * 1000.0
                )
            });
            let bytes = serde_json::to_vec(&result).unwrap().len();
            let elapsed_ms = began.elapsed().as_secs_f64() * 1000.0;
            assert!(bytes <= 4 * 1024 * 1024);
            assert!(
                elapsed_ms < 2000.0,
                "Full archive {op} sample {sample} took {elapsed_ms:.2} ms"
            );
            operations.push(json!({"op":op,"sample":sample,"elapsed_ms":elapsed_ms,"bytes":bytes}));
        }
    }
    let path = std::env::temp_dir().join(format!(
        "card-reading-envelope-{}.sqlite",
        crate::random_hex(12)
    ));
    let c = store::open(&path).unwrap();
    full_store::schema(&c).unwrap();
    let id = "d".repeat(48);
    store::create(&c, &id, "viewer-0", now()).unwrap();
    full_store::seed(&c, &id, &world, "full-accepted-reading-archive", now()).unwrap();
    for actor in 0..8 {
        c.execute(
            "INSERT INTO card_members(world,actor,user,seen) VALUES(?,?,?,?)",
            rusqlite::params![id, actor, format!("viewer-{actor}"), now()],
        )
        .unwrap();
    }
    let line = format!(
        "{}.",
        "The company keeps its heard account beside the scales. "
            .repeat(5)
            .chars()
            .take(239)
            .collect::<String>()
    );
    for index in 0..40 {
        let scene = json!({"play":format!("envelope-{index}"),"actor":"vale","room":"greek-harbor","turn":world.game["turn"],
          "privateTo":["vale","greek-viii-aeschylus","greek-viii-euripides"],
          "lines":[{"actorId":"vale","text":line},{"actorId":"greek-viii-aeschylus","text":line}],
          "starts_at":index,"until_at":index+1,"error":null});
        c.execute(
            "INSERT INTO card_full_scenes(world,room,play,content) VALUES(?,?,?,?)",
            rusqlite::params![
                id,
                "greek-harbor",
                format!("envelope-{index}"),
                scene.to_string()
            ],
        )
        .unwrap();
    }
    let mut views = Vec::new();
    for pass in 0..2 {
        for actor in 0..8 {
            let began = Instant::now();
            let snapshot =
                full_store::snapshot(&c, &id, &format!("viewer-{actor}"), now()).unwrap();
            let bytes = serde_json::to_vec(&snapshot).unwrap().len();
            assert!(bytes <= 4 * 1024 * 1024);
            if actor == 0 {
                assert_eq!(snapshot["history"].as_array().unwrap().len(), 40);
            } else {
                assert!(!snapshot.to_string().contains(&line));
            }
            views.push(json!({"pass":pass,"actor":actor,"elapsed_ms":began.elapsed().as_secs_f64()*1000.0,"bytes":bytes}));
        }
    }
    let report = json!({"source_commit":std::env::var("COSYWORLD_AUDIT_BASE_COMMIT").ok(),
      "actors":203,"complete_readings":56,"scene_history":40,"archive_bytes":archive_bytes,"save_bytes":save.len(),"import_ms":import_ms,
      "limits":{"heap_bytes":96*1024*1024,"operation_ms":2000,"reading_bytes":384*1024,"save_bytes":2*1024*1024,"input_output_bytes":4*1024*1024},
      "operations":operations,"views":views});
    if let Ok(path) = std::env::var("COSYWORLD_READING_AUDIT_REPORT") {
        std::fs::write(path, serde_json::to_vec_pretty(&report).unwrap()).unwrap();
    }
    println!("reading_archive_audit {report}");
    let _ = std::fs::remove_file(path);
}
