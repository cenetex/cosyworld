use super::{engine, full_store, full_world::World, now, store};
use serde_json::{json, Value};

const RECORD: &str = "greek-argos-household-record";
const WITNESS: &str = "greek-argos-housekeeper";

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
            "Missing House of Blood play at {}: {fields:?}",
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

fn fixture() -> (std::path::PathBuf, rusqlite::Connection, String, World) {
    let root = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .unwrap()
        .parent()
        .unwrap();
    let output = std::process::Command::new("node").current_dir(root).args([
        "--input-type=module", "-e",
        "import { housePrepared } from './test/helpers/greek-house-of-blood.mjs'; console.log(JSON.stringify(housePrepared('agamemnon')));",
    ]).output().expect("Node 24 creates the House of Blood source fixture");
    assert!(
        output.status.success(),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );
    let save = String::from_utf8(output.stdout).unwrap();
    let mut world = World::create(Some(&save)).unwrap();
    world.claimed = [1, 1, 0, 0, 0, 0, 0, 0];
    world.present = world.claimed;
    world.game["actors"]["mara"]["place"] = json!("greek-argolid-road");
    world.project(0).unwrap();
    world.project(1).unwrap();
    let path =
        std::env::temp_dir().join(format!("house-of-blood-{}.sqlite", crate::random_hex(12)));
    let c = store::open(&path).unwrap();
    full_store::schema(&c).unwrap();
    let id = "f".repeat(48);
    store::create(&c, &id, "owner", now()).unwrap();
    full_store::seed(&c, &id, &world, "house-of-blood-prepared-record", now()).unwrap();
    (path, c, id, world)
}

#[test]
fn house_of_blood_agreed_arrival_and_second_carrier_replay_from_the_journal() {
    let (path, c, id, mut world) = fixture();
    assert_eq!(world.version, engine::VERSION);
    play(
        &c,
        &id,
        &mut world,
        1,
        &[("kind", "move"), ("target", "greek-argos-refuge")],
    );
    assert!(action(&world, 1, &[("choiceId", "greek-v-agamemnon-refuge")]).is_none());
    play(
        &c,
        &id,
        &mut world,
        0,
        &[("choiceId", "greek-v-agamemnon-agree-refuge")],
    );
    assert_eq!(world.game["actors"][WITNESS]["place"], "greek-argos-palace");
    for destination in [
        "greek-argos-tomb",
        "greek-argolid-road",
        "greek-argos-refuge",
    ] {
        play(
            &c,
            &id,
            &mut world,
            0,
            &[
                ("kind", "accompany"),
                ("target", WITNESS),
                ("destination", destination),
            ],
        );
        assert_eq!(world.game["actors"][WITNESS]["place"], destination);
        assert_eq!(world.game["actors"]["vale"]["place"], destination);
    }
    play(
        &c,
        &id,
        &mut world,
        0,
        &[("choiceId", "greek-v-agamemnon-refuge")],
    );
    assert_eq!(world.game["items"][RECORD]["holder"], "greek-argos-refuge");
    play(
        &c,
        &id,
        &mut world,
        0,
        &[("kind", "take"), ("item", RECORD)],
    );
    play(
        &c,
        &id,
        &mut world,
        0,
        &[("kind", "give"), ("item", RECORD), ("target", "mara")],
    );
    play(
        &c,
        &id,
        &mut world,
        1,
        &[("kind", "move"), ("target", "greek-argolid-road")],
    );
    let topic = "greek-v-agamemnon-account-refuge";
    assert!(world.game["knowledge"]["known"]["mara"]
        .get(topic)
        .is_none());
    for expected in ["greek-v-agamemnon-beacon", topic] {
        let result = play(
            &c,
            &id,
            &mut world,
            1,
            &[("kind", "talk"), ("target", "greek-argos-watchman")],
        );
        let disclosures = result["context"]["disclosures"].clone();
        assert_eq!(disclosures[0]["factId"], expected);
        full_store::commit(&c, &id, &mut world, json!({
            "op":"speech", "actor":"mara", "room":"greek-argolid-road", "disclosures":disclosures,
            "lines":[{"actorId":"mara","text":"Tell me your account for Dione."},{"actorId":"greek-argos-watchman","text":disclosures[0]["text"]}]
        }),now()).unwrap();
    }
    for target in ["greek-harbor", "greek-courtyard"] {
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
        &[("choiceId", "greek-v-agamemnon-return-refuge")],
    );
    assert_eq!(world.game["items"][RECORD]["holder"], "greek-courtyard");
    assert_eq!(
        world.game["quests"]["records"]["greek-drama:story-quest-greek-v-agamemnon-return"]
            ["completion"]["actorId"],
        "mara"
    );
    assert!(action(
        &world,
        1,
        &[("choiceId", "greek-v-agamemnon-return-refuge")]
    )
    .is_none());
    let expected = world.clone();
    drop(c);
    let c = store::open(&path).unwrap();
    assert_eq!(full_store::world(&c, &id, now()).unwrap(), expected);
    c.execute("DELETE FROM card_full_checkpoints", []).unwrap();
    assert_eq!(full_store::world(&c, &id, now()).unwrap(), expected);
}
