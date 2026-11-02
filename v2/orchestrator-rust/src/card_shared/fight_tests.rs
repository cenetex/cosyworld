use super::*;

// One avatar's projected play of a kind against a target.
fn fight_action(w: &World, actor: usize, kind: &str, target: &str) -> Option<Value> {
    w.project(actor).unwrap()["actions"]
        .as_array()
        .unwrap()
        .iter()
        .find(|a| a["kind"] == kind && a["target"] == target)
        .cloned()
}
fn fight_play(c: &rusqlite::Connection, id: &str, w: &mut World, actor: usize, action: Value) {
    full_store::commit(
        c,
        id,
        w,
        json!({"op":"play","actor":actor_id(actor),"action":action}),
        now(),
    )
    .unwrap();
}

#[test]
fn two_humans_fight_through_c_and_the_loser_goes_home_on_replay() {
    let (_file, c, id) = fixture();
    c.execute("DELETE FROM card_full_checkpoints", []).unwrap();
    c.execute("DELETE FROM card_full_log", []).unwrap();
    let mut w = World::create(None).unwrap();
    w.claimed = [1, 1, 0, 0, 0, 0, 0, 0];
    w.present = [1, 1, 0, 0, 0, 0, 0, 0];
    let actors: Vec<String> = w.game["actors"].as_object().unwrap().keys().cloned().collect();
    for actor in actors {
        if w.game["actors"][&actor]["place"] == "pond" {
            w.game["actors"][&actor]["place"] = json!("station");
        }
    }
    w.game.as_object_mut().unwrap().remove("opening");
    w.game["turn"] = json!(2);
    w.game["revision"] = json!(2);
    w.game["actors"]["vale"]["place"] = json!("pond");
    w.game["actors"]["mara"]["place"] = json!("pond");
    w.game["items"]["mask"]["holder"] = json!("mara");
    w.game["defeats"] = json!({"mara": 2});
    full_store::seed(&c, &id, &w, "two-humans", now()).unwrap();

    let threat = fight_action(&w, 0, "threaten", "mara").expect("a human can be threatened");
    fight_play(&c, &id, &mut w, 0, threat);
    assert_eq!(w.game["standoffs"][0]["defender"], "mara");
    // An unanswered human is not struck.
    assert!(fight_action(&w, 0, "attack", "mara").is_none());
    let guard = fight_action(&w, 1, "guard", "vale").unwrap();
    fight_play(&c, &id, &mut w, 1, guard);
    let strike = fight_action(&w, 0, "attack", "mara").unwrap();
    fight_play(&c, &id, &mut w, 0, strike.clone());
    // A second strike waits for Mara's next play, at the authority too.
    let before = w.clone();
    assert!(w
        .apply(&json!({"op":"play","actor":"vale","action":strike}))
        .is_err());
    assert_eq!(w, before);
    for _ in 0..4 {
        if w.game["standoffs"].as_array().unwrap().is_empty() {
            break;
        }
        let wait = home_action(&w, 1, "wait");
        fight_play(&c, &id, &mut w, 1, wait);
        let strike = fight_action(&w, 0, "attack", "mara").unwrap();
        fight_play(&c, &id, &mut w, 0, strike);
    }
    let attack = w.game["log"]
        .as_array()
        .unwrap()
        .iter()
        .rev()
        .find(|e| e["verb"] == "attack")
        .unwrap()
        .clone();
    assert_eq!(attack["outcome"], "sent-home");
    assert_eq!(attack["lossCount"], 3);
    assert_eq!(w.game["actors"]["mara"]["place"], "theatre");
    assert_eq!(w.game["items"]["mask"]["holder"], "pond");
    assert!(w.project(1).unwrap()["exits"]
        .as_array()
        .unwrap()
        .contains(&json!("pond")));
    c.execute("DELETE FROM card_full_checkpoints", []).unwrap();
    assert_eq!(full_store::world(&c, &id, now()).unwrap(), w);
}
