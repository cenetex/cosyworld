use super::{engine, full_store, full_world::World, now, store};
use serde_json::{json, Value};

// The live rules before the Signal Jetty: Hoppy Cat revision 1 and the red
// thread from Black pond.
const BEFORE_JETTY: &str = "full-card-world/30";
const GARDEN: &str = "hoppycat-halfway-tea-garden";
const THREAD: &str = "hoppycat-pond-garden";

fn upgraded(found: bool) -> (rusqlite::Connection, String, World) {
    let path = std::env::temp_dir().join(format!("hoppycat-{}.sqlite", crate::random_hex(12)));
    let c = store::open(&path).unwrap();
    full_store::schema(&c).unwrap();
    let id = "h".repeat(48);
    store::create(&c, &id, "owner", now()).unwrap();
    let released = engine::reduce_version(BEFORE_JETTY, json!({"op":"create"})).unwrap();
    let mut old = World {
        version: BEFORE_JETTY.into(),
        game: released["world"].clone(),
        claimed: [1, 1, 0, 0, 0, 0, 0, 0],
        present: [1, 1, 0, 0, 0, 0, 0, 0],
        pack: None,
    };
    old.game.as_object_mut().unwrap().remove("opening");
    assert_eq!(old.game["packs"]["hoppycat-archive"]["revision"], 1);
    old.game["actors"]["vale"]["place"] = json!(if found { GARDEN } else { "pond" });
    old.game["actors"]["mara"]["place"] = json!("pond");
    old.game["crossings"][THREAD]["discovered"] = json!(found);
    full_store::seed(&c, &id, &old, "before-signal-jetty", now()).unwrap();
    let w = full_store::world(&c, &id, now()).unwrap();
    assert_eq!(w.version, engine::VERSION);
    assert_eq!(
        w.game["log"],
        super::full_tests::quest_free_log(&old.game["log"])
    );
    assert_eq!(
        w.game["packs"]["hoppycat-archive"]["revision"],
        super::full_tests::pack_revision("hoppycat-archive")
    );
    // A loaded save follows the current content: the retired thread closes.
    assert_eq!(w.game["crossings"][THREAD]["discovered"], json!(false));
    (c, id, w)
}

fn knows_jetty(w: &World, actor: &str) -> bool {
    w.game["routeKnowledge"][actor]
        .as_array()
        .is_some_and(|edges| {
            edges.contains(&json!(["sea:greek-piraeus", "sea:hoppycat-signal-jetty"]))
        })
}

fn moves(actions: &Value) -> Vec<String> {
    actions
        .as_array()
        .unwrap()
        .iter()
        .filter(|a| a["kind"] == "move")
        .map(|a| a["target"].as_str().unwrap().to_string())
        .collect()
}

#[test]
fn an_earlier_save_closes_a_found_red_thread_and_teaches_its_visitor_the_jetty_lane() {
    let (c, id, mut w) = upgraded(true);
    assert!(knows_jetty(&w, "vale"));
    assert!(!knows_jetty(&w, "mara"));
    let home = w.project(0).unwrap()["actions"]
        .as_array()
        .unwrap()
        .iter()
        .find(|a| a["kind"] == "move" && a["target"] == "pond")
        .unwrap()
        .clone();
    full_store::commit(
        &c,
        &id,
        &mut w,
        json!({"op":"play","actor":"vale","action":home}),
        now(),
    )
    .unwrap();
    assert_eq!(w.game["actors"]["vale"]["place"], "pond");
    assert!(!moves(&w.project(0).unwrap()["actions"]).contains(&GARDEN.to_string()));
}

#[test]
fn an_earlier_save_that_never_found_the_red_thread_has_no_pond_door() {
    let (_, _, w) = upgraded(false);
    assert!(!knows_jetty(&w, "vale"));
    assert!(!moves(&w.project(0).unwrap()["actions"]).contains(&GARDEN.to_string()));
}
