use super::{full_store, full_world::World, now, store};
use serde_json::Value;

fn assert_same(expected: &Value, actual: &Value, path: &str) {
    match expected {
        Value::Object(fields) => {
            assert_eq!(
                actual.as_object().unwrap().len(),
                fields.len(),
                "Keys at {path}"
            );
            for (key, value) in fields {
                assert_same(value, &actual[key], &format!("{path}.{key}"));
            }
        }
        Value::Array(entries) => {
            let observed = actual.as_array().unwrap();
            assert_eq!(observed.len(), entries.len(), "Length at {path}");
            for (index, value) in entries.iter().enumerate() {
                assert_same(value, &observed[index], &format!("{path}[{index}]"));
            }
        }
        _ => assert_eq!(actual, expected, "Value at {path}"),
    }
}

#[test]
fn book_one_spoken_sources_carried_returns_and_route_choices_rebuild_from_the_journal() {
    let root = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .unwrap()
        .parent()
        .unwrap();
    for part in ["seven", "tyrannus", "bacchae"] {
        let script = format!(
            "import {{bookReplay}} from './test/fixtures/card-book-one-replay.mjs'; console.log(JSON.stringify(bookReplay('{part}')));"
        );
        let output = std::process::Command::new("node")
            .current_dir(root)
            .args(["--input-type=module", "-e", &script])
            .output()
            .unwrap();
        assert!(
            output.status.success(),
            "{}",
            String::from_utf8_lossy(&output.stderr)
        );
        let fixture: Value = serde_json::from_slice(&output.stdout).unwrap();
        let mut world = World::create(fixture["save"].as_str()).unwrap();
        world.claimed = [1, if part == "seven" { 1 } else { 0 }, 0, 0, 0, 0, 0, 0];
        world.present = world.claimed;
        let path = std::env::temp_dir().join(format!("book-one-{}.sqlite", crate::random_hex(12)));
        let c = store::open(&path).unwrap();
        full_store::schema(&c).unwrap();
        let id = "c".repeat(48);
        store::create(&c, &id, "owner", now()).unwrap();
        full_store::seed(&c, &id, &world, "book-one-source-journey", now()).unwrap();
        for command in fixture["commands"].as_array().unwrap() {
            full_store::commit(&c, &id, &mut world, command.clone(), now()).unwrap();
        }
        assert_same(&fixture["expected"], &world.game, part);
        let expected = world.clone();
        drop(c);
        let c = store::open(&path).unwrap();
        assert_eq!(full_store::world(&c, &id, now()).unwrap(), expected);
        c.execute("DELETE FROM card_full_checkpoints", []).unwrap();
        assert_eq!(full_store::world(&c, &id, now()).unwrap(), expected);
        println!(
            "Book I {part}: {} journal commands and full replay passed",
            fixture["commands"].as_array().unwrap().len()
        );
        drop(c);
        std::fs::remove_file(path).unwrap();
    }
}
