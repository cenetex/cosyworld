use super::{engine, full_store, full_world::World, now, store};
use serde_json::{json, Value};

fn action(world: &World, actor: usize, fields: &[(&str, &str)]) -> Option<Value> {
    world.project(actor).unwrap()["actions"]
        .as_array()
        .unwrap()
        .iter()
        .find(|a| fields.iter().all(|(key, value)| a[key] == *value))
        .cloned()
}

fn play(
    c: &rusqlite::Connection,
    id: &str,
    world: &mut World,
    actor: usize,
    fields: &[(&str, &str)],
) -> Value {
    let selected = action(world, actor, fields).unwrap_or_else(|| {
        panic!(
            "Missing Ajax play at {}: {fields:?}",
            world.room(actor).unwrap()
        )
    });
    full_store::commit(
        c,
        id,
        world,
        json!({"op":"play", "actor":if actor == 0 {"vale"} else {"mara"}, "action":selected}),
        now(),
    )
    .unwrap()
}

fn talk(c: &rusqlite::Connection, id: &str, world: &mut World, actor: usize, topic: &str) {
    let result = play(
        c,
        id,
        world,
        actor,
        &[("kind", "talk"), ("target", "greek-ajax-teucer")],
    );
    let disclosures = result["context"]["disclosures"].clone();
    assert_eq!(disclosures[0]["factId"], topic);
    full_store::commit(
        c,
        id,
        world,
        json!({
            "op":"speech", "actor":if actor == 0 {"vale"} else {"mara"},
            "room":"greek-greek-camp", "disclosures":disclosures,
            "lines":[
                {"actorId":if actor == 0 {"vale"} else {"mara"}, "text":"Tell me your account for Dione."},
                {"actorId":"greek-ajax-teucer", "text":disclosures[0]["text"]}
            ]
        }),
        now(),
    )
    .unwrap();
    assert!(
        world.game["knowledge"]["known"][if actor == 0 { "vale" } else { "mara" }]
            .get(topic)
            .is_some()
    );
}

// The source-model fixture reaches this saved vigil through every earlier
// journey. The native host validates it before journaling the remaining rite.
fn fixture() -> (std::path::PathBuf, rusqlite::Connection, String, World) {
    let root = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .unwrap()
        .parent()
        .unwrap();
    let output = std::process::Command::new("node")
        .current_dir(root)
        .args([
            "--input-type=module",
            "-e",
            "import { ajaxGrave } from './test/helpers/greek-ajax.mjs'; console.log(JSON.stringify(ajaxGrave('appeal', false)));",
        ])
        .output()
        .expect("Node 24 creates the Ajax source fixture");
    assert!(
        output.status.success(),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );
    let save = String::from_utf8(output.stdout).unwrap();
    let mut world = World::create(Some(&save)).unwrap();
    world.claimed = [1, 1, 0, 0, 0, 0, 0, 0];
    world.present = world.claimed;
    world.game["actors"]["mara"]["place"] = json!("greek-greek-camp");
    world.project(0).unwrap();
    world.project(1).unwrap();
    let path = std::env::temp_dir().join(format!("ajax-{}.sqlite", crate::random_hex(12)));
    let c = store::open(&path).unwrap();
    full_store::schema(&c).unwrap();
    let id = "b".repeat(48);
    store::create(&c, &id, "owner", now()).unwrap();
    full_store::seed(&c, &id, &world, "ajax-prepared-vigil", now()).unwrap();
    (path, c, id, world)
}

#[test]
#[ignore = "package 6 fixtures"]
fn ajax_appeal_custody_spoken_accounts_and_second_carrier_replay_from_the_journal() {
    let (path, c, id, mut world) = fixture();
    assert_eq!(world.version, engine::VERSION);
    assert!(world.game["packs"]["greek-drama"]["receipts"]["greek-ajax-bury-appeal"].is_null());
    play(
        &c,
        &id,
        &mut world,
        0,
        &[("kind", "move"), ("target", "greek-greek-camp")],
    );
    play(
        &c,
        &id,
        &mut world,
        0,
        &[("kind", "talk"), ("target", "greek-ajax-odysseus")],
    );
    play(
        &c,
        &id,
        &mut world,
        0,
        &[("kind", "move"), ("target", "greek-ajax-grave")],
    );
    play(
        &c,
        &id,
        &mut world,
        1,
        &[("kind", "move"), ("target", "greek-ajax-grave")],
    );
    play(
        &c,
        &id,
        &mut world,
        1,
        &[("kind", "take"), ("item", "greek-ajax-cloth")],
    );
    play(&c, &id, &mut world, 0, &[("kind", "wait")]);
    assert!(world.game["packs"]["greek-drama"]["receipts"]["greek-ajax-bury-appeal"].is_null());
    assert_eq!(world.game["items"]["greek-ajax-cloth"]["holder"], "mara");
    play(
        &c,
        &id,
        &mut world,
        1,
        &[("kind", "drop"), ("item", "greek-ajax-cloth")],
    );
    play(&c, &id, &mut world, 0, &[("kind", "wait")]);
    assert_eq!(
        world.game["packs"]["greek-drama"]["choices"]["greek-ajax-ending"],
        "appeal"
    );
    for actor in [0, 1] {
        play(
            &c,
            &id,
            &mut world,
            actor,
            &[("kind", "move"), ("target", "greek-greek-camp")],
        );
    }
    play(
        &c,
        &id,
        &mut world,
        0,
        &[("kind", "take"), ("item", "greek-ajax-plea")],
    );
    talk(&c, &id, &mut world, 0, "greek-ajax-account-appeal");
    let signed = world.game["packs"]["greek-drama"]["receipts"]["greek-ajax-record-appeal"].clone();
    play(
        &c,
        &id,
        &mut world,
        0,
        &[
            ("kind", "give"),
            ("item", "greek-ajax-plea"),
            ("target", "mara"),
        ],
    );
    for topic in ["greek-ajax-plea", "greek-ajax-account-appeal"] {
        talk(&c, &id, &mut world, 1, topic);
    }
    assert_eq!(
        world.game["packs"]["greek-drama"]["receipts"]["greek-ajax-record-appeal"],
        signed
    );
    // Home from the landing by the Northern Road, outside the City Gate:
    // the Charybdis never calls at Troy (rules 94).
    for target in [
        "greek-ajax-landing",
        "greek-road-north",
        "greek-harbor",
        "greek-road-thebes",
        "greek-courtyard",
    ] {
        play(
            &c,
            &id,
            &mut world,
            1,
            &[("kind", "move"), ("target", target)],
        );
    }
    play(
        &c,
        &id,
        &mut world,
        1,
        &[
            ("kind", "give"),
            ("item", "greek-ajax-plea"),
            ("target", "greek-baker"),
        ],
    );
    assert_eq!(
        world.game["items"]["greek-ajax-plea"]["holder"],
        "greek-courtyard"
    );
    // The return is Mara's recorded choice; no quest record carries it.
    assert!(world.game.get("quests").is_none());
    let returned = world.game["log"]
        .as_array()
        .unwrap()
        .iter()
        .find(|e| {
            e["verb"] == "give"
                && e["itemId"] == "greek-ajax-plea"
                && e["targetId"] == "greek-baker"
        })
        .unwrap();
    assert_eq!(returned["actorId"], "mara");
    assert_eq!(
        world.game["packs"]["greek-drama"]["receipts"]["greek-ajax-return-appeal"],
        returned["turn"]
    );
    let expected = world.clone();
    drop(c);
    let c = store::open(&path).unwrap();
    assert_eq!(full_store::world(&c, &id, now()).unwrap(), expected);
    c.execute("DELETE FROM card_full_checkpoints", []).unwrap();
    assert_eq!(full_store::world(&c, &id, now()).unwrap(), expected);
}
