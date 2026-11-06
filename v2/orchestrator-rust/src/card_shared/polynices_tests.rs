use super::{engine, full_store, full_world::World, now, store};
use serde_json::{json, Value};

#[test]
fn polynices_rites_match_the_source_model_and_replay_from_the_journal() {
    let root = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .unwrap()
        .parent()
        .unwrap();
    let source = r#"
        import { createWorld, encodeSave } from './v2/card-game/world.mjs';
        import { dispatchShared } from './v2/card-game/shared-world.mjs';
        // serde_json sends object keys to QuickJS in sorted order.
        const sorted = v => Array.isArray(v) ? v.map(sorted) : v && typeof v === 'object'
            ? Object.fromEntries(Object.keys(v).sort().map(k => [k, sorted(v[k])])) : v;
        const s = createWorld({ packScopes: { 'greek-drama': 'full' } });
        const hollow = 'greek-polynices-hollow';
        s.turn = s.revision = 20;
        s.crossings['pond-greek-harbor'].discovered = true;
        s.actors.vale.place = s.actors['greek-antigone'].place = hollow;
        s.actors.vale.visited.push('pond', hollow);
        s.items['greek-creon-writ'].holder = 'greek-guard';
        for (const id of ['greek-oil-flask', 'greek-funeral-cloth', 'greek-shovel'])
            s.items[id].holder = hollow;
        const save = encodeSave(s);
        let world = sorted(dispatchShared({ op: 'create', save }).world);
        const initial = world, steps = [];
        for (const choiceId of ['greek-anoint-polynices', 'greek-shroud-polynices', 'greek-bury-polynices']) {
            const request = { world, actor: 'vale', claimed: ['vale'], present: ['vale'] };
            const action = dispatchShared({ ...request, op: 'view' }).actions.find(a => a.choiceId === choiceId);
            if (!action) throw new Error(`Missing rite ${choiceId}`);
            world = sorted(dispatchShared({ ...request, op: 'play', action }).world);
            steps.push({ action, world });
        }
        console.log(JSON.stringify({ save, initial, steps }));
    "#;
    let output = std::process::Command::new("node")
        .current_dir(root)
        .args(["--input-type=module", "-e", source])
        .output()
        .expect("Node creates the source-model funeral");
    assert!(
        output.status.success(),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );
    let fixture: Value = serde_json::from_slice(&output.stdout).unwrap();
    let mut world = World::create(fixture["save"].as_str()).unwrap();
    assert_eq!(world.version, engine::VERSION);
    assert_eq!(world.game, fixture["initial"]);
    world.claimed[0] = 1;
    world.present[0] = 1;
    let path = std::env::temp_dir().join(format!("polynices-{}.sqlite", crate::random_hex(12)));
    let c = store::open(&path).unwrap();
    full_store::schema(&c).unwrap();
    let id = "c".repeat(48);
    store::create(&c, &id, "owner", now()).unwrap();
    full_store::seed(&c, &id, &world, "polynices-prepared-rites", now()).unwrap();
    for step in fixture["steps"].as_array().unwrap() {
        let before_turn = world.game["turn"].as_u64().unwrap();
        assert!(world.project(0).unwrap()["actions"]
            .as_array()
            .unwrap()
            .contains(&step["action"]));
        let command = json!({"op":"play", "actor":"vale", "action":step["action"]});
        full_store::commit(&c, &id, &mut world, command.clone(), now()).unwrap();
        assert_eq!(world.game, step["world"]);
        assert_eq!(world.game["turn"], before_turn + 1);
        let saved = world.clone();
        let count: i64 = c
            .query_row("SELECT count(*) FROM card_full_log", [], |r| r.get(0))
            .unwrap();
        assert!(full_store::commit(&c, &id, &mut world, command, now()).is_err());
        assert_eq!(world, saved);
        assert_eq!(
            c.query_row("SELECT count(*) FROM card_full_log", [], |r| r
                .get::<_, i64>(0))
                .unwrap(),
            count
        );
        c.execute("DELETE FROM card_full_checkpoints WHERE world=?", [&id])
            .unwrap();
        assert_eq!(full_store::world(&c, &id, now()).unwrap(), world);
    }
    let flags = &world.game["packs"]["greek-drama"]["flags"];
    assert_eq!(flags["greek-burial-performed"], true);
    assert_eq!(flags["greek-open-door-open"], true);
    assert_eq!(
        world.game["items"]["greek-oil-flask"]["holder"],
        "greek-colonus"
    );
    assert_eq!(
        world.game["items"]["greek-funeral-cloth"]["holder"],
        "greek-eleusis"
    );
    assert_eq!(
        world.game["items"]["greek-shovel"]["holder"],
        "greek-polynices-hollow"
    );
    let _ = std::fs::remove_file(path);
}
