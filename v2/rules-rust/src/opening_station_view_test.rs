use super::*;
use std::{path::Path, process::Command};

#[test]
fn first_and_second_pond_moves_project_the_pinned_station_reply() {
    let raw = include_str!("../../orchestrator-rust/src/card_shared/content.json");
    let (files, authored) = opening_content::wait_files(&json!({"packContentJson":raw})).unwrap();
    let catalog = Catalog::from_files(&files).unwrap();
    let geo = Geography::new(&files, catalog.packs()).unwrap();
    let root = Path::new(env!("CARGO_MANIFEST_DIR")).join("../..");
    let script = r#"
import assert from 'node:assert/strict';
import { currentSharedEngine } from './test/fixtures/shared-engine.mjs';
const { cardShared } = currentSharedEngine();
const pinned = (request) => {
    const reply = JSON.parse(cardShared(JSON.stringify(request)));
    assert.equal(reply.ok, true, reply.error);
    return reply;
};
const seats = { actor: 'vale', claimed: ['vale'], present: ['vale'] };
const play = (world, action) => pinned({ ...seats, op: 'play', world, action });
const quiet = [
    [undefined, false, false, false, false],
    [0, false, true, true, true],
    [2, false, true, false, false],
    [17, true, false, true, true],
    [42, true, true, false, false],
    [4242, false, false, true, false],
    [4294967295, false, false, false, true],
    [4294967295, true, true, true, false],
];
const rue = [73, 75].flatMap(seed => [false, true].flatMap(dry =>
    [false, true].map(sorted => [seed, false, dry, sorted, dry !== sorted])));
const historic = [undefined, 2, 42, 4242].flatMap(seed => [false, true].flatMap(dry =>
    [false, true].map(sorted => [seed, false, dry, sorted, dry !== sorted, true])));
for (const [seed, second, dry, sorted, carry, history] of [...quiet, ...rue, ...historic]) {
    let {world} = pinned({op:'create', seed, history});
    if (dry) Object.assign(world.items.lamp, {fuel:0, fuelRooms:0, lit:false});
    else ({world} = pinned({...seats, op:'hold', world, choice:{item:null, revision:world.revision}}));
    if (second) ({world} = play(world, 'wait:vale::'));
    ({world} = play(world, 'move:vale::pond'));
    if (history && sorted) ({world} = pinned({
        ...seats, op:'speech', world, room:'pond',
        lines:[{entityId:'pond',text:'Only ripples stir.'}],
    }));
    if (sorted) world.actors = Object.fromEntries(Object.entries(world.actors).sort());
    world.speechVoices.mara = ['mara'];
    const expected = play(world, carry ? 'move:vale:lamp:station' : 'move:vale::station');
    const withRue = !history && rue.some(([candidate]) => candidate === seed);
    assert.equal(expected.world.actors.rue.place === 'station', withRue);
    if (withRue) {
        assert.deepEqual(expected.world.speechVoices.vale, ['vale', 'keeper', 'rue']);
        assert.deepEqual(expected.events.map(event => event.actorId), ['vale', 'moth', 'rue']);
    }
    if (history) {
        assert.equal(expected.world.turn, 482);
        assert.equal(expected.world.actors.moth.place, 'pond');
        assert.equal(expected.world.actors.moth.sleeping.since, 481);
        assert.equal(Boolean(expected.world.actors.keeper.sleeping), seed === 4242);
        assert.deepEqual(expected.events.map(event => event.actorId), ['vale']);
    }
    const views = (withRue ? [seats.present] : [seats.present, []]).map(present =>
        pinned({...seats, op:'view', present, world:expected.world}));
    console.log(JSON.stringify({
        beforeSeq: world.eventSeq, priorVoices: world.speechVoices,
        order: Object.keys(world.actors), expected, views, label: {seed,second,dry,sorted,carry,history},
    }));
}
"#;
    let output = Command::new("node")
        .args(["--input-type=module", "-e", script])
        .current_dir(root)
        .output()
        .unwrap();
    assert!(
        output.status.success(),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );
    for line in String::from_utf8(output.stdout).unwrap().lines() {
        let row: Value = serde_json::from_str(line).unwrap();
        let order = entries(&row["order"])
            .map(|id| id.as_str().unwrap())
            .collect::<Vec<_>>();
        let before = row["beforeSeq"].as_u64().unwrap();
        let mut world = row["expected"]["world"].clone();
        world["speechVoices"] = row["priorVoices"].clone();
        assert_eq!(
            response_chronology(&world),
            Some(before + 1),
            "{}",
            row["label"]
        );
        assert!(
            station_scene(&world, &geo, &order, false, false).is_some(),
            "scene {}",
            row["label"]
        );
        assert!(
            station_paths(&world, &geo).is_some(),
            "paths {}",
            row["label"]
        );
        let actual = completed_station_response(world, &geo, &authored, before, &order, &[VALE])
            .unwrap_or_else(|| panic!("station scope rejected {}", row["label"]));
        assert_eq!(
            actual["actions"], row["expected"]["actions"],
            "{}",
            row["label"]
        );
        assert_eq!(actual, row["expected"], "{}", row["label"]);
        for expected in entries(&row["views"]) {
            let present = &expected["world"]["presentActors"];
            let mut request = json!({
                "op":"view", "actor":VALE, "claimed":[VALE], "present":present,
                "world":actual["world"], "actorOrder":row["order"], "packContentJson":raw,
            });
            let actual = crate::reduce(&request);
            assert_eq!(actual["actions"], expected["actions"], "{}", row["label"]);
            assert_eq!(actual, *expected, "{}", row["label"]);
            if historic_station(&actual["world"]) {
                request["world"]["actors"][PIP]["sleeping"] = Value::Null;
            } else {
                request["world"]["actors"][PIP]["place"] = json!(POND);
            }
            assert!(crate::reduce(&request).is_null(), "{}", row["label"]);
        }
    }
}
