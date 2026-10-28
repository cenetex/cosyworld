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
fn ajax_appeal_custody_spoken_accounts_and_second_carrier_replay_from_the_journal() {
    let (path, c, id, mut world) = fixture();
    assert_eq!(world.version, engine::VERSION);
    assert!(action(&world, 0, &[("choiceId", "greek-ajax-bury-appeal")]).is_none());
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
        &[("choiceId", "greek-ajax-witness-appeal")],
    );
    play(
        &c,
        &id,
        &mut world,
        0,
        &[("kind", "move"), ("target", "greek-ajax-grave")],
    );
    let burial = action(&world, 0, &[("choiceId", "greek-ajax-bury-appeal")]).unwrap();
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
    let before = world.clone();
    let count: i64 = c
        .query_row("SELECT count(*) FROM card_full_log", [], |r| r.get(0))
        .unwrap();
    assert!(full_store::commit(
        &c,
        &id,
        &mut world,
        json!({"op":"play","actor":"vale","action":burial}),
        now()
    )
    .is_err());
    assert_eq!(world, before);
    assert_eq!(
        c.query_row("SELECT count(*) FROM card_full_log", [], |r| r
            .get::<_, i64>(0))
            .unwrap(),
        count
    );
    play(
        &c,
        &id,
        &mut world,
        1,
        &[("kind", "drop"), ("item", "greek-ajax-cloth")],
    );
    play(
        &c,
        &id,
        &mut world,
        0,
        &[("choiceId", "greek-ajax-bury-appeal")],
    );
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
    for target in [
        "greek-ajax-landing",
        "greek-ship",
        "greek-harbor",
        "greek-courtyard",
    ] {
        if target == "greek-ship" {
            for _ in 0..32 {
                if action(&world, 1, &[("kind", "move"), ("target", target)]).is_some() {
                    break;
                }
                play(&c, &id, &mut world, 1, &[("kind", "wait")]);
            }
        }
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
        &[("choiceId", "greek-ajax-return-appeal")],
    );
    assert_eq!(
        world.game["items"]["greek-ajax-plea"]["holder"],
        "greek-courtyard"
    );
    assert_eq!(
        world.game["quests"]["records"]["greek-drama:story-quest-greek-ajax-return"]["completion"]
            ["actorId"],
        "mara"
    );
    let expected = world.clone();
    drop(c);
    let c = store::open(&path).unwrap();
    assert_eq!(full_store::world(&c, &id, now()).unwrap(), expected);
    c.execute("DELETE FROM card_full_checkpoints", []).unwrap();
    assert_eq!(full_store::world(&c, &id, now()).unwrap(), expected);
}
