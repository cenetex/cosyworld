use super::*;
use crate::{opening_content, pack_state::Catalog};
use std::{path::Path, process::Command};

#[test]
fn reading_the_keeper_log_matches_the_whole_pinned_primary_stage() {
    let raw = include_str!("../../orchestrator-rust/src/card_shared/content.json");
    let (files, authored) = opening_content::wait_files(&json!({"packContentJson":raw})).unwrap();
    let catalog = Catalog::from_files(&files).unwrap();
    let geo = Geography::new(&files, catalog.packs()).unwrap();
    let evidence = ResidentEvidence::new(&files).unwrap();
    let script = r#"
import assert from 'node:assert/strict';
import { currentSharedEngine } from './test/fixtures/shared-engine.mjs';
const marker = 'if (itemOf(bookPack(a.item), a.item).lifecycle === "spent")\n      giveUpForGood(s, a.item);';
const runtime = currentSharedEngine(source => {
    assert.equal(source.split(marker).length, 2);
    return source.replace(marker, marker + '\n    globalThis.readPhase = structuredClone(s);');
});
const raw = (request) => JSON.parse(runtime.cardShared(JSON.stringify(request)));
const pinned = (request) => {
    const reply = raw(request);
    assert.equal(reply.ok, true, reply.error);
    return reply;
};
const seats = { actor: 'vale', claimed: ['vale'], present: ['vale'] };
const play = (world, action) => pinned({ ...seats, op: 'play', world, action });
const key = 'read:vale:keeper-log:';
for (const [seed, dry, spoken, sorted, object] of [
    [undefined, false, false, false, false],
    [0, true, false, true, true],
    [2, false, true, false, true],
    [42, true, true, true, false],
    [4242, false, false, true, false],
    [4294967295, true, false, false, false],
]) {
    let {world} = pinned({op:'create', seed});
    if (dry) Object.assign(world.items.lamp, {fuel:0, fuelRooms:0, lit:false});
    else ({world} = pinned({...seats, op:'hold', world, choice:{item:null, revision:world.revision}}));
    ({world} = play(world, 'move:vale::pond'));
    assert.equal(raw({...seats, op:'play', world, action:key}).ok, false);
    ({world} = play(world, dry ? 'move:vale:lamp:station' : 'move:vale::station'));
    if (spoken) ({world} = pinned({...seats, op:'speech', world, room:'station',
        lines:[{actorId:'keeper',text:'Wait beside the timetable.'}]}));
    if (sorted) world.actors = Object.fromEntries(Object.entries(world.actors).toSorted());
    const request = {...seats, op:'play', world, action:object ? {key} : key, revision:world.revision};
    assert.equal(raw({...request, revision:world.revision - 1}).ok, false);
    const full = pinned(request);
    const expected = runtime.readPhase;
    assert.deepEqual(full.events.map(({actorId,verb}) => [actorId,verb]), [['vale','read'],['moth','wait']]);
    assert.deepEqual(full.world.speechVoices.vale, []);
    assert.deepEqual(full.events[0], expected.log.at(-1));
    assert.equal(expected.knowledge.facts['quest:keeper:pond'].source.turn, 0);
    assert.deepEqual(expected.knowledge.facts['quest:keeper:pond'].source.witnesses, ['vale']);
    const repeat = play(full.world, key);
    assert.deepEqual(repeat.events.map(({actorId,verb}) => [actorId,verb]), [['vale','read'],['moth','give']]);
    assert.deepEqual(repeat.world.knowledge.known.vale['claim:hub:keeper-log:pond-signal'],
        full.world.knowledge.known.vale['claim:hub:keeper-log:pond-signal']);
    console.log(JSON.stringify({request, expected, settled:full.world, order:Object.keys(world.actors),
        title:{seed,dry,spoken,sorted,object}}));
}
"#;
    let root = Path::new(env!("CARGO_MANIFEST_DIR")).join("../..");
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
        let order = row["order"]
            .as_array()
            .unwrap()
            .iter()
            .map(|id| id.as_str().unwrap())
            .collect::<Vec<_>>();
        let mut request = row["request"].clone();
        let begin =
            |request: &Value| begin_station_log_read(request, &geo, &authored, &order, &evidence);
        let actual = begin(&request).unwrap_or_else(|| panic!("read declined {}", row["title"]));
        assert_eq!(
            actual["log"].as_array().unwrap().last(),
            row["expected"]["log"].as_array().unwrap().last()
        );
        for (key, expected) in row["expected"].as_object().unwrap() {
            assert!(
                actual[key] == *expected,
                "read differs at {key} in {}",
                row["title"]
            );
        }
        assert_eq!(actual, row["expected"]);

        request["revision"] = json!(request["world"]["revision"].as_u64().unwrap() - 1);
        assert!(begin(&request).is_none());
        request["world"] = row["settled"].clone();
        request["revision"] = request["world"]["revision"].clone();
        assert!(begin(&request).is_none());
    }
}
