use super::{content, engine, full_store, full_world::World, now, store};
use serde_json::{json, Value};

const ROADS: [&str; 2] = ["greek-road-coast", "greek-road-north"];

// This binary's content without the Coast and Northern roads (#2049): every
// mention of them, as a place, an exit, a section or release entry, a route
// or a weather region, leaves.
fn without_roads(value: &mut Value) {
    match value {
        Value::Object(map) => {
            map.retain(|key, _| !ROADS.contains(&key.as_str()));
            map.values_mut().for_each(without_roads);
        }
        Value::Array(list) => {
            list.retain(|v| match v {
                Value::String(s) => !ROADS.contains(&s.as_str()),
                Value::Object(o) => !["from", "to"].iter().any(|k| {
                    o.get(*k)
                        .and_then(Value::as_str)
                        .is_some_and(|s| ROADS.contains(&s))
                }),
                _ => true,
            });
            list.iter_mut().for_each(without_roads);
        }
        _ => {}
    }
}

// A shared world saved on rules 92 before the roads were authored. Rules 92
// cannot read it under the new content: the roads have no memory slots and
// it asks for a fresh start. Loading it journals one upgrade onto rules 93
// with the new content, which gives the roads their slots, and replays.
#[test]
fn a_rules_92_world_takes_the_new_roads_without_a_fresh_start() {
    let path = std::env::temp_dir().join(format!(
        "card-road-upgrade-{}.sqlite",
        crate::random_hex(12)
    ));
    let c = store::open(&path).unwrap();
    full_store::schema(&c).unwrap();
    let id = "f".repeat(48);
    store::create(&c, &id, "owner", now()).unwrap();
    let mut before: Value =
        serde_json::from_str(&content::text(content::current()).unwrap()).unwrap();
    without_roads(&mut before);
    let text = before.to_string();
    let hash = content::hash(&text);
    c.execute(
        "INSERT INTO card_full_packs(hash,revision,content) VALUES(?,?,?)",
        rusqlite::params![hash, "before-roads", text],
    )
    .unwrap();
    content::preload(&c, &hash).unwrap();
    let version = engine::NINETY_SECOND_VERSION;
    let game = engine::reduce_pack(version, Some(&hash), json!({"op":"create","seed":5})).unwrap()
        ["world"]
        .clone();
    assert!(game["memories"].get(ROADS[0]).is_none());
    // The earlier failure: rules 92 under the new content.
    let refused = engine::reduce_pack(
        version,
        Some(content::current()),
        json!({"op":"validate","world":game,"actor":"vale","claimed":[],"present":[]}),
    )
    .unwrap_err();
    assert!(refused.to_string().contains("fresh start"), "{refused}");

    let old = World {
        version: version.into(),
        game,
        claimed: [0; 8],
        present: [0; 8],
        pack: Some(hash),
    };
    full_store::seed(&c, &id, &old, "before-roads", now()).unwrap();
    let w = full_store::world(&c, &id, now()).unwrap();
    assert_eq!(w.version, engine::VERSION);
    assert_eq!(w.pack.as_deref(), Some(content::current()));
    for road in ROADS {
        assert_eq!(w.game["memories"][road]["events"], json!([]), "{road}");
    }
    c.execute("DELETE FROM card_full_checkpoints", []).unwrap();
    assert_eq!(full_store::world(&c, &id, now()).unwrap(), w);
    let _ = std::fs::remove_file(path);
}
