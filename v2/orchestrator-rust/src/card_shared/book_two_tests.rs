use super::{engine, full_store, full_world::World, now, store};
use rusqlite::Connection;
use serde_json::{json, Value};

fn play_fields(c: &Connection, id: &str, world: &mut World, actor: &str, fields: &[(&str, &str)]) {
    let index = match actor {
        "vale" => 0,
        "mara" => 1,
        _ => panic!("Choose one of the two test humans"),
    };
    let view = world.project(index).unwrap();
    let action = view["actions"]
        .as_array()
        .unwrap()
        .iter()
        .find(|action| fields.iter().all(|(key, value)| action[key] == *value))
        .unwrap_or_else(|| {
            panic!(
                "Missing {actor} {fields:?} under {} at turn {} in {}",
                world.version, world.game["turn"], world.game["actors"][actor]["place"]
            )
        })
        .clone();
    full_store::commit(
        c,
        id,
        world,
        json!({"op":"play","actor":actor,"action":action}),
        now(),
    )
    .unwrap_or_else(|error| panic!("Commit {actor} {fields:?}: {error}"));
}

fn nearby_poem(world: &World, index: usize) -> Value {
    let view = world.project(index).unwrap();
    let talk = view["actions"]
        .as_array()
        .unwrap()
        .iter()
        .find(|action| action["kind"] == "talk" && action["target"] == "greek-rhapsode")
        .expect("The Bard is present for the poem check")
        .clone();
    let mut request = world.request("context", index);
    request["action"] = talk;
    let result = engine::reduce_version(&world.version, request).unwrap();
    let poem = result["context"]["entities"]
        .as_array()
        .unwrap()
        .iter()
        .find(|entity| entity["id"] == "greek-rhapsode")
        .expect("The present Bard has poem context")["poem"]
        .clone();
    assert!(poem["stanzas"].is_array());
    poem["stanzas"].clone()
}

const NEW_ACTORS: [&str; 14] = [
    "greek-danaid-melia",
    "greek-danaid-nera",
    "greek-alcestis-alcestis",
    "greek-alcestis-heracles",
    "greek-alcestis-chloris",
    "greek-heracles-megara",
    "greek-heracles-amphitryon",
    "greek-heracles-heracles",
    "greek-heracles-theseus",
    "greek-trachis-deianira",
    "greek-trachis-iole",
    "greek-trachis-hyllus",
    "greek-trachis-lichas",
    "greek-trachis-heracles",
];
const NEW_ITEMS: [&str; 20] = [
    "greek-danaid-branch",
    "greek-danaid-water-jug",
    "greek-danaid-host-pledge",
    "greek-danaid-provisions",
    "greek-alcestis-cup",
    "greek-alcestis-wine-jug",
    "greek-alcestis-loaf",
    "greek-alcestis-care-tablet",
    "greek-heracles-bread",
    "greek-heracles-water-cup",
    "greek-heracles-care-cloth",
    "greek-heracles-funeral-cloth",
    "greek-heracles-help-tablet",
    "greek-heracles-remembrance-tablet",
    "greek-trachis-meal",
    "greek-trachis-wool-remnant",
    "greek-trachis-treated-robe",
    "greek-trachis-plain-cloth",
    "greek-trachis-gift-casket",
    "greek-trachis-water-flask",
];
const NEW_PLACES: [&str; 5] = [
    "greek-danaid-refuge-court",
    "greek-heracles-theban-house",
    "greek-heracles-athens-road",
    "greek-heracles-athens-guest-room",
    "greek-trachis-canae-approach",
];

#[test]
fn book_two_upgrades_rules_twenty_and_replays_the_agreed_danaid_journey() {
    let path = std::env::temp_dir().join(format!("book-two-{}.sqlite", crate::random_hex(12)));
    let c = store::open(&path).unwrap();
    full_store::schema(&c).unwrap();
    let id = "b".repeat(48);
    store::create(&c, &id, "owner", now()).unwrap();
    let result = engine::reduce_version(engine::TWENTIETH_VERSION, json!({"op":"create"})).unwrap();
    let mut world = World {
        version: engine::TWENTIETH_VERSION.into(),
        game: result["world"].clone(),
        claimed: [1, 1, 0, 0, 0, 0, 0, 0],
        present: [1, 1, 0, 0, 0, 0, 0, 0],
    };
    // The fixture starts after the two humans reach the Greek shore.
    // Every deed after this seed is an accepted journal command.
    world.game.as_object_mut().unwrap().remove("opening");
    world.game["packs"]["greek-drama"]["scope"] = json!("full");
    world.game["actors"]["vale"]["place"] = json!("greek-courtyard");
    world.game["actors"]["mara"]["place"] = json!("greek-well");
    world.game["items"]["lamp"]["holder"] = json!("greek-courtyard");
    full_store::seed(&c, &id, &world, "released-book-two-predecessor", now()).unwrap();
    for (actor, kind, key, value) in [
        ("mara", "take", "item", "greek-water-jar"),
        ("mara", "move", "target", "greek-courtyard"),
        ("mara", "choose", "choiceId", "greek-return-water-jar"),
        ("mara", "take", "item", "greek-bread"),
        ("vale", "move", "target", "greek-gate"),
        ("vale", "choose", "choiceId", "greek-hear-decree"),
        ("vale", "choose", "choiceId", "greek-decline-burial"),
        ("vale", "move", "target", "greek-courtyard"),
        ("vale", "choose", "choiceId", "greek-courtyard-refusal"),
        (
            "vale",
            "choose",
            "choiceId",
            "greek-open-door-invite-refusal",
        ),
        ("vale", "take", "item", "lamp"),
    ] {
        play_fields(&c, &id, &mut world, actor, &[("kind", kind), (key, value)]);
    }
    for _ in 0..8 {
        if world.game["actors"]["greek-rhapsode"]["place"] == "greek-courtyard" {
            break;
        }
        play_fields(&c, &id, &mut world, "vale", &[("kind", "wait")]);
    }
    assert_eq!(world.version, engine::TWENTIETH_VERSION);
    assert_eq!(world.game["packs"]["greek-drama"]["revision"], 7);
    let old_poem = nearby_poem(&world, 0);
    assert_eq!(
        old_poem
            .as_array()
            .unwrap()
            .iter()
            .map(|verse| verse["id"].as_str().unwrap())
            .collect::<Vec<_>>(),
        [
            "greek-return-water-jar",
            "greek-decline-burial",
            "greek-courtyard-refusal"
        ]
    );
    let before = world.clone();
    let old_checkpoint: String = c
        .query_row(
            "SELECT state FROM card_full_checkpoints WHERE world=?",
            [&id],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(
        serde_json::from_str::<World>(&old_checkpoint).unwrap(),
        before
    );

    // Loading the checkpoint records one upgrade to the current interpreter.
    let mut world = full_store::world(&c, &id, now()).unwrap();
    assert_eq!(world.version, engine::VERSION);
    assert_eq!(world.claimed, before.claimed);
    assert_eq!(world.present, before.present);
    assert_eq!(
        world.game["revision"].as_u64(),
        before.game["revision"].as_u64().map(|n| n + 1)
    );
    let mut expected_pack = before.game["packs"]["greek-drama"].clone();
    expected_pack["revision"] = json!(8);
    assert_eq!(world.game["packs"]["greek-drama"], expected_pack);
    for field in [
        "turn",
        "eventSeq",
        "log",
        "transports",
        "crossings",
        "routeKnowledge",
        "invitedPlaces",
    ] {
        assert_eq!(
            world.game[field], before.game[field],
            "Preserve released {field}"
        );
    }
    let mut expected_quests = before.game["quests"].clone();
    for actor in NEW_ACTORS {
        assert!(before.game["quests"]["hands"].get(actor).is_none());
        assert_eq!(world.game["quests"]["hands"][actor], json!([]));
        expected_quests["hands"][actor] = json!([]);
    }
    assert_eq!(world.game["quests"], expected_quests);
    for (actor, saved) in before.game["actors"].as_object().unwrap() {
        let mut expected = saved.clone();
        for added in NEW_ACTORS {
            expected["trust"][added] = json!(0);
        }
        assert_eq!(
            world.game["actors"][actor], expected,
            "Preserve released actor {actor}"
        );
    }
    for field in ["items", "memories", "peaceUntil"] {
        for (key, value) in before.game[field].as_object().unwrap() {
            assert_eq!(
                &world.game[field][key], value,
                "Preserve released {field}/{key}"
            );
        }
    }
    assert_eq!(
        world.game["actors"].as_object().unwrap().len(),
        before.game["actors"].as_object().unwrap().len() + 14
    );
    assert_eq!(
        world.game["items"].as_object().unwrap().len(),
        before.game["items"].as_object().unwrap().len() + 20
    );
    assert_eq!(
        world.game["memories"].as_object().unwrap().len(),
        before.game["memories"].as_object().unwrap().len() + 39
    );
    let catalog: Value =
        serde_json::from_str(include_str!("../../../card-game/packs.json")).unwrap();
    let greek = catalog["packs"]
        .as_array()
        .unwrap()
        .iter()
        .find(|pack| pack["id"] == "greek-drama")
        .unwrap();
    for actor in NEW_ACTORS {
        assert!(before.game["actors"].get(actor).is_none());
        assert_eq!(
            world.game["actors"][actor]["place"],
            greek["avatars"][actor]["place"]
        );
        assert_eq!(
            world.game["actors"][actor]["progress"],
            json!({"program":0,"step":0,"marks":[]})
        );
        assert_eq!(world.game["actors"][actor]["crossed"], 0);
        assert_eq!(world.game["actors"][actor]["lastTalk"], -9);
        assert_eq!(
            world.game["memories"][actor],
            json!({"events":[],"landmarks":[],"text":null,"turn":null,"seen":{}})
        );
    }
    for item in NEW_ITEMS {
        assert!(before.game["items"].get(item).is_none());
        assert_eq!(
            world.game["items"][item],
            json!({"holder":greek["items"][item]["holder"],"history":[]})
        );
    }
    for place in NEW_PLACES {
        assert!(before.game["memories"].get(place).is_none());
        assert_eq!(
            world.game["memories"][place],
            json!({"events":[],"landmarks":[],"text":null,"turn":null})
        );
    }
    assert_eq!(nearby_poem(&world, 0), old_poem);

    // Vale prepares the present care and records Nera's own agreement.
    for (kind, key, value) in [
        ("choose", "choiceId", "greek-danaid-invitation"),
        ("move", "target", "greek-harbor"),
        ("move", "target", "greek-argolid-road"),
        ("move", "target", "greek-argos-sanctuary"),
        ("choose", "choiceId", "greek-danaid-hear-terms"),
        ("move", "target", "greek-danaid-refuge-court"),
        ("choose", "choiceId", "greek-danaid-hear-flight"),
        ("take", "item", "greek-danaid-water-jug"),
        ("take", "item", "greek-danaid-branch"),
        ("move", "target", "greek-argos-sanctuary"),
        ("choose", "choiceId", "greek-danaid-lay-branches"),
        ("move", "target", "greek-danaid-refuge-court"),
        ("choose", "choiceId", "greek-danaid-offer-roof"),
        ("take", "item", "greek-danaid-host-pledge"),
        ("take", "item", "greek-danaid-provisions"),
        ("move", "target", "greek-argos-sanctuary"),
        ("choose", "choiceId", "greek-danaid-set-provisions"),
        ("move", "target", "greek-danaid-refuge-court"),
        ("choose", "choiceId", "greek-danaid-hear-herald"),
        ("move", "target", "greek-argos-sanctuary"),
        ("choose", "choiceId", "greek-danaid-choose-common"),
        ("choose", "choiceId", "greek-danaid-agree-journey"),
    ] {
        play_fields(&c, &id, &mut world, "vale", &[("kind", kind), (key, value)]);
    }
    assert_eq!(
        world.game["actors"]["greek-danaid-nera"]["place"],
        "greek-argos-sanctuary"
    );
    assert_eq!(full_store::world(&c, &id, now()).unwrap(), world);
    // Mara resumes the same agreement. Give and Accompany retain real custody.
    for target in [
        "greek-harbor",
        "greek-argolid-road",
        "greek-argos-sanctuary",
    ] {
        play_fields(
            &c,
            &id,
            &mut world,
            "mara",
            &[("kind", "move"), ("target", target)],
        );
    }
    for item in ["greek-danaid-host-pledge", "greek-danaid-provisions"] {
        play_fields(
            &c,
            &id,
            &mut world,
            "mara",
            &[("kind", "take"), ("item", item)],
        );
    }
    play_fields(
        &c,
        &id,
        &mut world,
        "mara",
        &[
            ("kind", "give"),
            ("item", "greek-danaid-provisions"),
            ("target", "greek-danaid-nera"),
        ],
    );
    assert_eq!(
        world.game["items"]["greek-danaid-provisions"]["holder"],
        "greek-danaid-nera"
    );
    play_fields(
        &c,
        &id,
        &mut world,
        "mara",
        &[
            ("kind", "accompany"),
            ("target", "greek-danaid-nera"),
            ("destination", "greek-danaid-refuge-court"),
        ],
    );
    assert_eq!(
        world.game["actors"]["greek-danaid-nera"]["place"],
        "greek-danaid-refuge-court"
    );
    assert_eq!(
        world.game["actors"]["vale"]["place"],
        "greek-argos-sanctuary"
    );
    play_fields(
        &c,
        &id,
        &mut world,
        "mara",
        &[
            ("kind", "choose"),
            ("choiceId", "greek-danaid-receive-common"),
        ],
    );
    let journey = &world.game["quests"]["records"]["greek-drama:story-quest-greek-danaid-journey"]
        ["completion"];
    assert_eq!(journey["actorId"], "mara");
    assert_eq!(journey["participants"], json!(["mara", "vale"]));
    assert_eq!(
        world.game["items"]["greek-danaid-provisions"]["holder"],
        "greek-danaid-nera"
    );
    for target in [
        "greek-argos-sanctuary",
        "greek-argolid-road",
        "greek-harbor",
        "greek-courtyard",
    ] {
        play_fields(
            &c,
            &id,
            &mut world,
            "mara",
            &[("kind", "move"), ("target", target)],
        );
    }
    play_fields(
        &c,
        &id,
        &mut world,
        "mara",
        &[
            ("kind", "choose"),
            ("choiceId", "greek-danaid-return-common"),
        ],
    );
    assert_eq!(
        world.game["items"]["greek-danaid-host-pledge"]["holder"],
        "greek-courtyard"
    );
    assert_eq!(world.game["items"]["lamp"]["holder"], "vale");
    assert_eq!(world.game["items"]["greek-bread"]["holder"], "mara");
    let recitals = &world.game["packs"]["greek-drama"]["recitals"];
    assert_eq!(recitals["greek-return-water-jar"]["actor"], "mara");
    assert_eq!(recitals["greek-decline-burial"]["actor"], "vale");
    assert_eq!(recitals["greek-danaid-lay-branches"]["actor"], "vale");
    assert_eq!(recitals["greek-danaid-receive-common"]["actor"], "mara");
    assert_eq!(recitals["greek-danaid-return-common"]["actor"], "mara");

    let mut reader = None;
    for _ in 0..=8 {
        reader = ["vale", "mara"].iter().position(|actor| {
            world.game["actors"][*actor]["place"] == world.game["actors"]["greek-rhapsode"]["place"]
        });
        if reader.is_some() {
            break;
        }
        play_fields(&c, &id, &mut world, "mara", &[("kind", "wait")]);
    }
    let poem = nearby_poem(
        &world,
        reader.expect("The Bard reaches a human along the open route"),
    );
    let old_ids: Vec<_> = old_poem
        .as_array()
        .unwrap()
        .iter()
        .map(|verse| verse["id"].clone())
        .collect();
    let retained: Vec<_> = poem
        .as_array()
        .unwrap()
        .iter()
        .filter(|verse| old_ids.contains(&verse["id"]))
        .cloned()
        .collect();
    assert_eq!(Value::Array(retained), old_poem);
    let new_ids: Vec<_> = poem
        .as_array()
        .unwrap()
        .iter()
        .filter_map(|verse| verse["id"].as_str())
        .filter(|id| id.starts_with("greek-danaid-"))
        .collect();
    assert_eq!(
        new_ids,
        [
            "greek-danaid-lay-branches",
            "greek-danaid-set-provisions",
            "greek-danaid-receive-common",
            "greek-danaid-return-common"
        ]
    );

    let expected = world.clone();
    assert_eq!(full_store::world(&c, &id, now()).unwrap(), expected);
    let restored = store::open(&path).unwrap();
    full_store::schema(&restored).unwrap();
    assert_eq!(full_store::world(&restored, &id, now()).unwrap(), expected);
    restored
        .execute("DELETE FROM card_full_checkpoints WHERE world=?", [&id])
        .unwrap();
    assert_eq!(full_store::world(&restored, &id, now()).unwrap(), expected);
    assert_eq!(full_store::world(&c, &id, now()).unwrap(), expected);
    let upgrades: i64 = c.query_row(
        "SELECT COUNT(*) FROM card_full_log WHERE world=? AND json_extract(command,'$.op')='upgrade' AND json_extract(command,'$.from')=? AND json_extract(command,'$.to')=?",
        rusqlite::params![id, engine::TWENTIETH_VERSION, engine::VERSION], |row| row.get(0),
    ).unwrap();
    assert_eq!(upgrades, 1);
}
