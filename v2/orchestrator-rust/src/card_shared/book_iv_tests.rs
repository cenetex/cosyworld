use super::{engine, full_store, full_world::World, now, store};
use serde_json::{json, Value};

const PHAEDRA: &str = "greek-book-iv-hippolytus-phaedra";
const NURSE: &str = "greek-book-iv-hippolytus-nurse";
const ROOM: &str = "greek-book-iv-hippolytus-sickroom";

fn action(world: &World, fields: &[(&str, &str)]) -> Option<Value> {
    action_for(world, 0, fields)
}

fn action_for(world: &World, actor: usize, fields: &[(&str, &str)]) -> Option<Value> {
    world.project(actor).unwrap()["actions"]
        .as_array()
        .unwrap()
        .iter()
        .find(|a| fields.iter().all(|(key, value)| a[key] == *value))
        .cloned()
}

fn play(c: &rusqlite::Connection, id: &str, world: &mut World, fields: &[(&str, &str)]) -> Value {
    let selected =
        action(world, fields).unwrap_or_else(|| panic!("Missing Book IV play {fields:?}"));
    full_store::commit(
        c,
        id,
        world,
        json!({"op":"play","actor":"vale","action":selected}),
        now(),
    )
    .unwrap()
}

fn party_play(
    c: &rusqlite::Connection,
    id: &str,
    world: &mut World,
    actor: usize,
    fields: &[(&str, &str)],
) -> Value {
    let selected = action_for(world, actor, fields)
        .unwrap_or_else(|| panic!("Missing party play {actor} {fields:?}"));
    full_store::commit(
        c,
        id,
        world,
        json!({"op":"play","actor":if actor == 0 {"vale"} else {"mara"},"action":selected}),
        now(),
    )
    .unwrap()
}

fn database(label: &str, world: &World) -> (std::path::PathBuf, rusqlite::Connection, String) {
    let path =
        std::env::temp_dir().join(format!("book-iv-{label}-{}.sqlite", crate::random_hex(12)));
    let c = store::open(&path).unwrap();
    full_store::schema(&c).unwrap();
    let id = "d".repeat(48);
    store::create(&c, &id, "owner", now()).unwrap();
    full_store::seed(&c, &id, world, label, now()).unwrap();
    (path, c, id)
}

fn assert_rebuild(path: &std::path::Path, c: rusqlite::Connection, id: &str, expected: &World) {
    drop(c);
    let c = store::open(path).unwrap();
    assert_eq!(&full_store::world(&c, id, now()).unwrap(), expected);
    c.execute("DELETE FROM card_full_checkpoints", []).unwrap();
    assert_eq!(&full_store::world(&c, id, now()).unwrap(), expected);
}

#[test]
fn book_iv_retirement_report_recovers_a_prior_gift_and_rebuilds_from_the_journal() {
    let root = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .unwrap()
        .parent()
        .unwrap();
    let fixture = std::process::Command::new("node").current_dir(root).args([
        "--input-type=module", "-e",
        "import {hippolytusCare,ivWalk,ivTake,ivId} from './test/helpers/book-iv.mjs'; let w=hippolytusCare(); w.items.cloth.holder='lamp'; w=ivTake(ivWalk(w,'greek-courtyard'),'lamp'); w=ivWalk(w,ivId('hippolytus','sickroom')); console.log(JSON.stringify(w));",
    ]).output().expect("Node prepares the played Book IV source scene");
    assert!(
        fixture.status.success(),
        "{}",
        String::from_utf8_lossy(&fixture.stderr)
    );
    let save = String::from_utf8(fixture.stdout).unwrap();
    let mut world = World::create(Some(&save)).unwrap();
    world.claimed[0] = 1;
    world.present[0] = 1;
    let (path, c, id) = database("gift-before-report", &world);
    let stale_talk = action(&world, &[("kind", "talk"), ("target", PHAEDRA)]).unwrap();
    let stale_give = action(
        &world,
        &[("kind", "give"), ("item", "lamp"), ("target", PHAEDRA)],
    )
    .unwrap();
    play(
        &c,
        &id,
        &mut world,
        &[("kind", "give"), ("item", "lamp"), ("target", PHAEDRA)],
    );
    let actor = world.game["actors"][PHAEDRA].clone();
    let cloth = world.game["items"]["cloth"].clone();
    let known = world.game["knowledge"]["known"][PHAEDRA].clone();
    let remembered = world.game["memories"][PHAEDRA]["text"].clone();
    let lamp = world.game["items"]["lamp"].clone();
    let result = play(&c, &id, &mut world, &[("kind", "talk"), ("target", NURSE)]);
    assert_eq!(world.game["items"]["lamp"]["holder"], PHAEDRA);
    let disclosures = result["context"]["disclosures"].clone();
    assert_eq!(
        disclosures[0]["factId"],
        "greek-book-iv-hippolytus-phaedra-death-words"
    );
    assert!(action(&world, &[("kind", "talk"), ("target", PHAEDRA)]).is_some());
    full_store::commit(&c, &id, &mut world, json!({
        "op":"speech","actor":"vale","room":ROOM,"disclosures":disclosures,
        "lines":[{"actorId":"vale","text":"Please tell me the household report."},{"actorId":NURSE,"text":disclosures[0]["text"]}]
    }), now()).unwrap();
    assert_eq!(world.game["actors"][PHAEDRA], actor);
    assert_eq!(world.game["items"]["cloth"], cloth);
    assert_eq!(world.game["items"]["lamp"]["holder"], ROOM);
    for field in ["fuel", "lit"] {
        assert_eq!(world.game["items"]["lamp"][field], lamp[field]);
    }
    assert!(world.game["items"]["lamp"]["history"]
        .as_array()
        .unwrap()
        .last()
        .unwrap()
        .as_str()
        .unwrap()
        .contains("Phaedra’s carried belongings"));
    assert_eq!(world.game["knowledge"]["known"][PHAEDRA], known);
    assert_eq!(world.game["memories"][PHAEDRA]["text"], remembered);
    let death_turn = world.game["packs"]["greek-drama"]["receipts"]
        ["greek-book-iv-hippolytus-phaedra-death"]
        .as_u64()
        .unwrap();
    let report = world.game["log"]
        .as_array()
        .unwrap()
        .iter()
        .find(|e| e["actorId"] == NURSE && e["generated"] == true && e["turn"] == death_turn)
        .unwrap();
    assert_eq!(report["actorId"], NURSE);
    assert!(!world.project(0).unwrap()["scene"]["slots"]
        .as_array()
        .unwrap()
        .iter()
        .any(|v| v == PHAEDRA));
    assert!(action(&world, &[("kind", "talk"), ("target", PHAEDRA)]).is_none());
    play(&c, &id, &mut world, &[("kind", "take"), ("item", "lamp")]);
    for stale in [
        stale_talk,
        stale_give,
        json!({"kind":"accompany","actor":"vale","target":PHAEDRA,"destination":"greek-troezen"}),
    ] {
        let before = world.clone();
        let count: i64 = c
            .query_row("SELECT count(*) FROM card_full_log", [], |r| r.get(0))
            .unwrap();
        assert!(full_store::commit(
            &c,
            &id,
            &mut world,
            json!({"op":"play","actor":"vale","action":stale}),
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
    }
    assert_eq!(world.game["items"]["cloth"]["holder"], "lamp");
    let expected = world.clone();
    assert_rebuild(&path, c, &id, &expected);
}

#[test]
fn book_iv_retirement_upgrade_preserves_a_released_twenty_visit_and_checkpoint_free_replay() {
    let version = engine::TWENTIETH_VERSION;
    let seed = engine::reduce_version(version, json!({"op":"create"})).unwrap();
    let mut old = World {
        version: version.into(),
        game: seed["world"].clone(),
        claimed: [1, 0, 0, 0, 0, 0, 0, 0],
        present: [1, 0, 0, 0, 0, 0, 0, 0],
    };
    old.game.as_object_mut().unwrap().remove("opening");
    old.game["packs"]["greek-drama"]["scope"] = json!("full");
    old.game["actors"]["vale"]["place"] = json!("greek-corinth");
    old.game["items"]["lamp"]["holder"] = json!("vale");
    old.game["crossings"]["pond-greek-harbor"]["discovered"] = json!(true);
    let (path, c, id) = database("released-twenty-household", &old);
    play(&c, &id, &mut old, &[("kind", "wait")]);
    c.execute("DELETE FROM card_full_checkpoints", []).unwrap();
    let mut current = full_store::world(&c, &id, now()).unwrap();
    assert_eq!(current.version, engine::VERSION);
    assert_eq!(current.game["packs"]["greek-drama"]["revision"], 8);
    assert_eq!(current.game["actors"]["vale"]["place"], "greek-corinth");
    for field in ["turn", "eventSeq", "log", "transports", "knowledge"] {
        assert_eq!(current.game[field], old.game[field], "Preserve {field}");
    }
    super::epic_capacity_tests::assert_retained(
        &old.game["routeKnowledge"],
        &current.game["routeKnowledge"],
        "routeKnowledge",
    );
    for (key, item) in old.game["items"].as_object().unwrap() {
        assert_eq!(&current.game["items"][key], item);
    }
    for (key, saved) in old.game["actors"].as_object().unwrap() {
        let mut retained = current.game["actors"][key].clone();
        retained["trust"]
            .as_object_mut()
            .unwrap()
            .retain(|id, value| {
                if saved["trust"].get(id).is_some() {
                    true
                } else {
                    assert_eq!(*value, json!(0));
                    false
                }
            });
        assert_eq!(&retained, saved);
    }
    super::full_tests::assert_saved_memories(&current.game["memories"], &old.game["memories"]);
    for field in ["choices", "flags", "receipts", "met", "recitals", "scope"] {
        assert_eq!(
            current.game["packs"]["greek-drama"][field],
            old.game["packs"]["greek-drama"][field]
        );
    }
    assert!(current.game["actors"].get(PHAEDRA).is_some());
    assert!(current.game["packs"]["greek-drama"]["met"]
        .get(PHAEDRA)
        .is_none());
    play(
        &c,
        &id,
        &mut current,
        &[("kind", "move"), ("target", "greek-argolid-road")],
    );
    let expected = current.clone();
    assert_rebuild(&path, c, &id, &expected);
}

#[test]
fn book_iv_public_account_survives_moved_evidence_and_a_second_carrier_journal() {
    const COURT: &str = "greek-book-iv-helen-court";
    const KING: &str = "greek-book-iv-helen-theoclymenus";
    const PAPER: &str = "greek-book-iv-helen-account";
    const ENDING: &str = "greek-book-iv-helen-finish-hearing";
    const TOPIC: &str = "greek-book-iv-helen-finish-hearing-words";
    let root = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .unwrap()
        .parent()
        .unwrap();
    let fixture = std::process::Command::new("node").current_dir(root).args([
        "--input-type=module", "-e", "import {helenEnding} from './test/helpers/book-iv.mjs'; console.log(JSON.stringify(helenEnding('hearing')));",
    ]).output().unwrap();
    assert!(
        fixture.status.success(),
        "{}",
        String::from_utf8_lossy(&fixture.stderr)
    );
    let mut world = World::create(Some(&String::from_utf8(fixture.stdout).unwrap())).unwrap();
    world.claimed = [1, 1, 0, 0, 0, 0, 0, 0];
    world.present = world.claimed;
    world.game["actors"]["mara"]["place"] = json!(COURT);
    let (path, c, id) = database("public-account-carrier", &world);
    let original_receipt = world.game["packs"]["greek-drama"]["receipts"][ENDING].clone();
    party_play(
        &c,
        &id,
        &mut world,
        0,
        &[("kind", "take"), ("item", "greek-egypt-testimony")],
    );
    party_play(
        &c,
        &id,
        &mut world,
        0,
        &[("kind", "give"), ("item", PAPER), ("target", "mara")],
    );
    assert_eq!(
        world.game["items"]["greek-egypt-testimony"]["holder"],
        "vale"
    );
    assert_eq!(world.game["items"][PAPER]["holder"], "mara");
    assert!(world.game["knowledge"]["known"]["mara"]
        .get(TOPIC)
        .is_none());
    // The next native play fulfils the already-earned singer visit.
    // Capture that settled visit before testing the later reader's speech.
    let original_stanza = world.game["packs"]["greek-drama"]["recitals"][ENDING].clone();
    let spoken = party_play(
        &c,
        &id,
        &mut world,
        1,
        &[("kind", "talk"), ("target", KING)],
    );
    let disclosures = spoken["context"]["disclosures"].clone();
    assert_eq!(disclosures[0]["factId"], TOPIC);
    assert!(world.game["knowledge"]["known"]["mara"]
        .get(TOPIC)
        .is_none());
    full_store::commit(&c,&id,&mut world,json!({
        "op":"speech","actor":"mara","room":COURT,"disclosures":disclosures,
        "lines":[{"actorId":"mara","text":"Please read this signed account."},{"actorId":KING,"text":disclosures[0]["text"]}]
    }),now()).unwrap();
    assert!(world.game["knowledge"]["known"]["mara"]
        .get(TOPIC)
        .is_some());
    assert_eq!(
        world.game["packs"]["greek-drama"]["receipts"][ENDING],
        original_receipt
    );
    assert_eq!(
        world.game["packs"]["greek-drama"]["recitals"][ENDING],
        original_stanza
    );
    for target in [
        "greek-egypt-tomb",
        "greek-book-iv-helen-landing",
        "greek-ship",
        "greek-harbor",
        "greek-courtyard",
    ] {
        if target == "greek-ship" {
            for _ in 0..32 {
                if action_for(&world, 1, &[("kind", "move"), ("target", target)]).is_some() {
                    break;
                }
                party_play(&c, &id, &mut world, 1, &[("kind", "wait")]);
            }
        }
        party_play(
            &c,
            &id,
            &mut world,
            1,
            &[("kind", "move"), ("target", target)],
        );
    }
    party_play(
        &c,
        &id,
        &mut world,
        1,
        &[("choiceId", "greek-book-iv-helen-return-hearing")],
    );
    assert_eq!(world.game["items"][PAPER]["holder"], "greek-courtyard");
    assert_eq!(
        world.game["items"]["greek-egypt-testimony"]["holder"],
        "vale"
    );
    assert_eq!(
        world.game["packs"]["greek-drama"]["receipts"][ENDING],
        original_receipt
    );
    assert_eq!(
        world.game["packs"]["greek-drama"]["recitals"][ENDING],
        original_stanza
    );
    assert_eq!(
        world.game["log"]
            .as_array()
            .unwrap()
            .iter()
            .filter(|e| e["choiceId"] == ENDING)
            .count(),
        1
    );
    assert_eq!(
        world.game["quests"]["records"]["greek-drama:story-quest-greek-book-iv-helen-return"]
            ["completion"]["actorId"],
        "mara"
    );
    let expected = world.clone();
    assert_rebuild(&path, c, &id, &expected);
}
