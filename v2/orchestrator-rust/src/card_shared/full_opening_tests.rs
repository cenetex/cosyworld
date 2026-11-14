use super::super::super::{full, full_store, now, store};
use super::*;
use rusqlite::TransactionBehavior;

fn fresh(a: usize) -> (crate::AppState, Connection, String) {
    let path = std::env::temp_dir().join(format!("card-opening-{}.sqlite", crate::random_hex(12)));
    let mut c = store::open(&path).unwrap();
    full_store::schema(&c).unwrap();
    let tx = c
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .unwrap();
    let id = full::found(&tx, "owner", a, None, now()).unwrap();
    tx.commit().unwrap();
    (crate::test_app_state(Some(path)), c, id)
}
fn command(op: &str) -> full::Command {
    full::Command {
        op: op.into(),
        avatar: None,
        action: Value::Null,
        target: None,
        key: String::new(),
        moving: false,
        surface: "browser".to_string(),
        revealed: None,
    }
}
fn words(a: usize) -> Value {
    json!([{"entityId":actor_id(a),"actorId":actor_id(a),"speaker":actor_id(a),"text":"I can hear myself waking up."}])
}

#[test]
fn new_shared_avatars_open_once_and_keep_their_words_through_replay() {
    for a in 0..8 {
        let (app, c, id) = fresh(a);
        let before = full_store::world(&c, &id, now()).unwrap();
        assert_eq!(
            full_store::snapshot(&c, &id, "owner", now()).unwrap()["queue"][0]["opening"],
            true
        );
        enqueue(&c, &id, "owner", &before, a, now()).unwrap();
        assert_eq!(
            c.query_row(
                "SELECT count(*) FROM card_full_plays WHERE world=?",
                [&id],
                |r| r.get::<_, i32>(0)
            )
            .unwrap(),
            1
        );
        let mut play = command("play");
        play.key = "opening-first-play-0001".into();
        play.action = before.project(a).unwrap()["actions"][0].clone();
        assert!(full::command_as(&app, &id, "owner", &play, None)
            .unwrap_err()
            .contains("already at the table"));
        let work = full::take_work(&app, &id).unwrap().unwrap();
        assert_eq!(work.context["opening"], true);
        assert_eq!(work.context["context"]["waking"], true);
        assert_eq!(work.context["context"]["speakers"], json!([actor_id(a)]));
        assert_eq!(work.context["context"]["scenery"], false);
        assert!(work.context["context"]["covered"]
            .as_array()
            .unwrap()
            .contains(&json!(before.room(a).unwrap())));
        assert!(!work.context["context"]["covered"]
            .as_array()
            .unwrap()
            .contains(&json!(actor_id(a))));
        assert_eq!(full_store::world(&c, &id, now()).unwrap().game["turn"], 0);
        full::publish(&app, &id, work, Ok(words(a))).unwrap();
        let saved = full_store::world(&c, &id, now()).unwrap();
        assert_eq!(saved.game["turn"], 0);
        assert_eq!(
            full_store::snapshot(&c, &id, "owner", now()).unwrap()["history"][0]["opening"],
            true
        );
        c.execute("DELETE FROM card_full_checkpoints WHERE world=?", [&id])
            .unwrap();
        assert_eq!(full_store::world(&c, &id, now()).unwrap(), saved);
        resume(&c, &id, &saved, a).unwrap();
        assert!(full::take_work(&app, &id).unwrap().is_none());
    }
}

#[test]
fn reentering_resumes_an_interrupted_opening_and_fences_its_old_worker() {
    let (app, c, id) = fresh(0);
    let old = full::take_work(&app, &id).unwrap().unwrap();
    c.execute("UPDATE card_full_plays SET until_at=0 WHERE world=?", [&id])
        .unwrap();
    let mut w = full_store::world(&c, &id, now()).unwrap();
    full_store::expire(&c, &id, &mut w, now()).unwrap();
    let expired = full_store::snapshot(&c, &id, "owner", now()).unwrap();
    assert_eq!(expired["history"][0]["after"], w.game["eventSeq"]);
    assert!(expired["history"][0]["after"].is_number());
    full::command_as(&app, &id, "owner", &command("enter"), None).unwrap();
    let next = full::take_work(&app, &id).unwrap().unwrap();
    assert_eq!(next.id, old.id);
    full::publish(&app, &id, old, Ok(words(0))).unwrap();
    assert_eq!(
        full_store::snapshot(&c, &id, "owner", now()).unwrap()["history"][0]["failed"],
        true
    );
    full::publish(&app, &id, next, Ok(words(0))).unwrap();
    let snapshot = full_store::snapshot(&c, &id, "owner", now()).unwrap();
    assert_eq!(snapshot["history"].as_array().unwrap().len(), 1);
    assert_eq!(snapshot["history"][0]["lines"].as_array().unwrap().len(), 1);
    assert_eq!(snapshot["world"]["turn"], 0);
}

#[test]
fn returning_games_keep_their_saved_first_line() {
    let (app, c, id) = fresh(0);
    let work = full::take_work(&app, &id).unwrap().unwrap();
    full::publish(&app, &id, work, Ok(words(0))).unwrap();
    let w = full_store::world(&c, &id, now()).unwrap();
    let imported = "e".repeat(48);
    enqueue(&c, &imported, "owner", &w, 0, now()).unwrap();
    let mut later = w;
    later.game["turn"] = json!(1);
    enqueue(&c, &imported, "owner", &later, 1, now()).unwrap();
    assert_eq!(
        c.query_row(
            "SELECT count(*) FROM card_full_plays WHERE world=?",
            [&imported],
            |r| r.get::<_, i32>(0)
        )
        .unwrap(),
        0
    );
}

#[test]
fn cancelled_openings_resume_on_entry() {
    let (app, _c, id) = fresh(0);
    let mut cancel = command("cancel");
    cancel.key = key(&id, 0);
    full::command_as(&app, &id, "owner", &cancel, None).unwrap();
    assert!(full::take_work(&app, &id).unwrap().is_none());
    full::command_as(&app, &id, "owner", &command("enter"), None).unwrap();
    assert_eq!(full::take_work(&app, &id).unwrap().unwrap().id, cancel.key);
}

#[test]
fn failed_opening_has_an_anchor_for_its_silent_line() {
    let (app, c, id) = fresh(0);
    let w = full_store::world(&c, &id, now()).unwrap();
    let work = full::take_work(&app, &id).unwrap().unwrap();
    full::publish(&app, &id, work, Err("The voice needs another try.".into())).unwrap();
    let snapshot = full_store::snapshot(&c, &id, "owner", now()).unwrap();
    let scene = &snapshot["history"][0];
    assert_eq!(scene["after"], w.game["eventSeq"]);
    assert!(scene["after"].is_number());
    assert_eq!(scene["lines"], json!([]));
    assert_eq!(scene["silent"], json!(["vale"]));
    assert_eq!(scene["opening"], true);
}

#[test]
fn opening_precedes_a_guest_play_queued_at_the_same_time() {
    let (app, c, id) = fresh(0);
    let mut claim = command("claim");
    claim.avatar = Some("mara".into());
    full::command_as(&app, &id, "guest", &claim, None).unwrap();
    let mut play = command("play");
    play.key = "0000000000000000".into();
    let w = full_store::world(&c, &id, now()).unwrap();
    play.action = w.project(1).unwrap()["actions"][0].clone();
    full::command_as(&app, &id, "guest", &play, None).unwrap();
    c.execute("UPDATE card_full_plays SET created=1 WHERE world=?", [&id])
        .unwrap();
    let first = full::take_work(&app, &id).unwrap().unwrap();
    assert_eq!(first.id, key(&id, 0));
    assert!(full::take_work(&app, &id).unwrap().is_none());
    full::publish(&app, &id, first, Ok(words(0))).unwrap();
    c.execute(
        "UPDATE card_full_plays SET until_at=0 WHERE world=? AND status='playing'",
        [&id],
    )
    .unwrap();
    let next = full::take_work(&app, &id).unwrap().unwrap();
    assert_eq!(next.id, play.key);
}

#[test]
fn queued_opening_reads_the_latest_hand_and_keeps_its_reveal_limits() {
    let (app, c, id) = fresh(0);
    let mut w = full_store::world(&c, &id, now()).unwrap();
    let mut choose = command("hold");
    choose.action = json!({"item":null,"revision":w.game["revision"]});
    full::run(&c, &id, "owner", &choose, now()).unwrap();
    let work = full::take_work(&app, &id).unwrap().unwrap();
    assert_eq!(work.context["context"]["speakers"], json!(["vale"]));
    assert_eq!(work.context["context"]["waking"], true);
    assert_eq!(work.context["context"]["scenery"], false);
    w = full_store::world(&c, &id, now()).unwrap();
    let expected = narrator::context(&w.request("context", 0)).unwrap();
    assert_eq!(work.context["context"]["entities"], expected["entities"]);
    assert!(work.context["context"]["covered"]
        .as_array()
        .unwrap()
        .contains(&json!(w.room(0).unwrap())));
    // Refresh survives a database reopen and has no extra gameplay turn.
    let mut choose = command("hold");
    choose.action = json!({"item":"lamp","revision":w.game["revision"]});
    full::run(&c, &id, "owner", &choose, now()).unwrap();
    assert!(!full::publish(&app, &id, work, Ok(words(0))).unwrap());
    drop(c);
    let next = full::take_work(&app, &id).unwrap().unwrap();
    assert_eq!(next.context["turn"], 0);
    assert!(full::publish(&app, &id, next, Ok(words(0))).unwrap());
}
