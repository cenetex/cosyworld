use super::{engine, full_store, full_world::World, now, store};
use serde_json::{json, Value};

const MYRINE: &str = "greek-household-witness";

fn play(
    c: &rusqlite::Connection,
    id: &str,
    world: &mut World,
    actor: usize,
    fields: &[(&str, &str)],
) -> Value {
    let action = world.project(actor).unwrap()["actions"]
        .as_array()
        .unwrap()
        .iter()
        .find(|a| fields.iter().all(|(key, value)| a[key] == *value))
        .unwrap_or_else(|| panic!("Missing {fields:?} for actor {actor}"))
        .clone();
    full_store::commit(
        c,
        id,
        world,
        json!({"op":"play", "actor":if actor == 0 {"vale"} else {"mara"}, "action":action}),
        now(),
    )
    .unwrap();
    action
}

fn rejected(c: &rusqlite::Connection, id: &str, world: &mut World, actor: &str, action: Value) {
    let before = world.clone();
    let count: i64 = c
        .query_row("SELECT count(*) FROM card_full_log", [], |r| r.get(0))
        .unwrap();
    assert!(full_store::commit(
        c,
        id,
        world,
        json!({"op":"play", "actor":actor, "action":action}),
        now()
    )
    .is_err());
    assert_eq!(*world, before);
    assert_eq!(
        c.query_row("SELECT count(*) FROM card_full_log", [], |r| r
            .get::<_, i64>(0))
            .unwrap(),
        count
    );
}

fn fixture() -> (rusqlite::Connection, String) {
    let path = std::env::temp_dir().join(format!("homecoming-{}.sqlite", crate::random_hex(12)));
    let c = store::open(&path).unwrap();
    full_store::schema(&c).unwrap();
    let id = "e".repeat(48);
    store::create(&c, &id, "owner", now()).unwrap();
    (c, id)
}

fn released_berth(c: &rusqlite::Connection, id: &str) -> World {
    let result = engine::reduce_version(engine::ELEVENTH_VERSION, json!({"op":"create"})).unwrap();
    let mut world = World {
        version: engine::ELEVENTH_VERSION.into(),
        game: result["world"].clone(),
        claimed: [1, 1, 0, 0, 0, 0, 0, 0],
        present: [1, 1, 0, 0, 0, 0, 0, 0],
    };
    world.game.as_object_mut().unwrap().remove("opening");
    world.game["packs"]["greek-drama"]["scope"] = json!("full");
    world.game["actors"]["vale"]["place"] = json!("greek-courtyard");
    world.game["actors"]["mara"]["place"] = json!("greek-eleusis");
    world.game["items"]["greek-water-jar"]["holder"] = json!("vale");
    full_store::seed(c, id, &world, "released-open-door", now()).unwrap();
    let steps = [
        ("choose", "choiceId", "greek-return-water-jar"),
        ("drop", "item", "lamp"),
        ("move", "target", "greek-gate"),
        ("choose", "choiceId", "greek-hear-decree"),
        ("choose", "choiceId", "greek-decline-burial"),
        ("move", "target", "greek-courtyard"),
        ("choose", "choiceId", "greek-courtyard-refusal"),
        ("choose", "choiceId", "greek-open-door-invite-refusal"),
        ("move", "target", "greek-harbor"),
        ("move", "target", "greek-athens"),
        ("move", "target", "greek-eleusis"),
        ("choose", "choiceId", "greek-open-door-hear-mothers"),
        ("choose", "choiceId", "greek-open-door-hear-adrastus"),
        ("take", "item", "greek-burial-petition"),
        ("move", "target", "greek-athens"),
        ("choose", "choiceId", "greek-open-door-register-plea"),
        ("choose", "choiceId", "greek-open-door-request-truce"),
        ("choose", "choiceId", "greek-open-door-hear-truce-report"),
        ("move", "target", "greek-piraeus"),
        ("choose", "choiceId", "greek-open-door-hear-quay"),
        ("take", "item", "greek-provision-basket"),
        ("choose", "choiceId", "greek-open-door-set-provisions"),
        ("take", "item", "greek-return-cloths"),
        ("move", "target", "greek-athens"),
        ("move", "target", "greek-eleusis"),
        ("choose", "choiceId", "greek-open-door-lay-cloths"),
        ("take", "item", "greek-ash-urn"),
        ("choose", "choiceId", "greek-open-door-lay-ashes"),
        ("choose", "choiceId", "greek-open-door-hear-pyre"),
        ("choose", "choiceId", "greek-open-door-eleusis-care"),
        ("take", "item", "greek-return-list"),
        ("move", "target", "greek-athens"),
        ("move", "target", "greek-piraeus"),
    ];
    for (kind, field, value) in steps {
        play(c, id, &mut world, 0, &[("kind", kind), (field, value)]);
    }
    assert_eq!(world.game["packs"]["greek-drama"]["revision"], 3);
    assert!(world.game["actors"].get(MYRINE).is_none());
    world
}

#[test]
fn agreed_household_journey_replays_after_released_history_with_both_care_choices() {
    // Build the shared historical scene once through the real v11 actions.
    // Each case then journals its old berth choice and every new journey step.
    let (history, history_id) = fixture();
    let prepared = released_berth(&history, &history_id);
    for policy in ["family", "open"] {
        for keep_checkpoint in [true, false] {
            let (c, id) = fixture();
            let mut old = prepared.clone();
            full_store::seed(&c, &id, &old, "released-prepared-quay", now()).unwrap();
            play(
                &c,
                &id,
                &mut old,
                0,
                &[("choiceId", &format!("greek-open-door-{policy}-berth"))],
            );
            if !keep_checkpoint {
                c.execute("DELETE FROM card_full_checkpoints", []).unwrap();
            }
            let mut world = full_store::world(&c, &id, now()).unwrap();
            assert_eq!(world.version, engine::VERSION);
            assert_eq!(world.game["actors"][MYRINE]["place"], "greek-eleusis");
            for key in ["turn", "eventSeq", "log", "transports"] {
                assert_eq!(world.game[key], old.game[key]);
            }
            for field in ["items", "crossings"] {
                for (key, value) in old.game[field].as_object().unwrap() {
                    assert_eq!(&world.game[field][key], value);
                }
            }
            for key in ["receipts", "choices", "flags", "recitals"] {
                assert_eq!(
                    world.game["packs"]["greek-drama"][key],
                    old.game["packs"]["greek-drama"][key]
                );
            }
            let receive = format!("choose:vale:greek-drama:greek-homecoming-receive-{policy}");
            rejected(&c, &id, &mut world, "vale", json!({"key":receive}));
            let escort = format!("accompany:mara::{MYRINE}:greek-piraeus");
            rejected(&c, &id, &mut world, "mara", json!({"key":escort}));
            play(
                &c,
                &id,
                &mut world,
                0,
                &[("kind", "move"), ("target", "greek-eleusis")],
            );
            let agreement = play(
                &c,
                &id,
                &mut world,
                0,
                &[("choiceId", "greek-homecoming-agree-journey")],
            );
            rejected(&c, &id, &mut world, "vale", agreement);
            play(
                &c,
                &id,
                &mut world,
                0,
                &[("kind", "move"), ("target", "greek-piraeus")],
            );
            assert_eq!(world.game["actors"][MYRINE]["place"], "greek-eleusis");
            c.execute("DELETE FROM card_full_checkpoints", []).unwrap();
            assert_eq!(full_store::world(&c, &id, now()).unwrap(), world);
            let travel = play(
                &c,
                &id,
                &mut world,
                1,
                &[
                    ("kind", "accompany"),
                    ("target", MYRINE),
                    ("destination", "greek-piraeus"),
                ],
            );
            assert_eq!(world.game["actors"][MYRINE]["place"], "greek-piraeus");
            assert_eq!(world.game["actors"]["mara"]["place"], "greek-piraeus");
            assert_eq!(
                world.game["packs"]["greek-drama"]["flags"]["greek-homecoming-arrived"],
                Value::Null
            );
            rejected(&c, &id, &mut world, "mara", travel);
            if policy == "family" {
                rejected(
                    &c,
                    &id,
                    &mut world,
                    "mara",
                    json!({"key":"choose:mara:greek-drama:greek-homecoming-receive-family"}),
                );
                play(
                    &c,
                    &id,
                    &mut world,
                    1,
                    &[("kind", "take"), ("item", "greek-provision-basket")],
                );
                play(
                    &c,
                    &id,
                    &mut world,
                    1,
                    &[
                        ("kind", "give"),
                        ("item", "greek-provision-basket"),
                        ("target", MYRINE),
                    ],
                );
                assert_eq!(
                    world.game["items"]["greek-provision-basket"]["holder"],
                    MYRINE
                );
            }
            let arrival = play(
                &c,
                &id,
                &mut world,
                1,
                &[("choiceId", &format!("greek-homecoming-receive-{policy}"))],
            );
            assert_eq!(
                world.game["packs"]["greek-drama"]["flags"]["greek-homecoming-arrived"],
                true
            );
            rejected(&c, &id, &mut world, "mara", arrival);
            play(
                &c,
                &id,
                &mut world,
                1,
                &[("kind", "move"), ("target", "greek-harbor")],
            );
            assert_eq!(world.game["actors"][MYRINE]["place"], "greek-piraeus");
            c.execute("DELETE FROM card_full_checkpoints", []).unwrap();
            assert_eq!(full_store::world(&c, &id, now()).unwrap(), world);
            let upgrades: i64 = c.query_row("SELECT count(*) FROM card_full_log WHERE json_extract(command,'$.op')='upgrade'", [], |r| r.get(0)).unwrap();
            assert_eq!(upgrades, 1);
        }
    }
}
