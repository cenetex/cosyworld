//! Many players and the narration worker write one shared world at once.
use super::{
    full, full_store,
    full_world::{actor_id, World},
    store, *,
};
use std::{
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Barrier, Mutex,
    },
    time::Duration,
};

const PLAYERS: usize = 4;
const ROUNDS: usize = 6;
// `sql_error` turns every SQLite failure, including "database is locked",
// into this reply. It is the 409 the browser smoke saw.
const STORAGE_ERROR: &str = "The shared world is taking a moment. Try again.";

fn play(a: usize, view: &Value, round: usize) -> Option<full::Command> {
    let action = view["actions"]
        .as_array()?
        .iter()
        .find(|action| action["kind"] == "wait")?
        .clone();
    Some(full::Command {
        op: "play".into(),
        avatar: None,
        action,
        target: None,
        key: format!("concurrent-play-{a}-{round:02}"),
        moving: false,
    })
}

#[test]
fn concurrent_writes_to_one_world_never_hit_the_lock_and_keep_each_play_once() {
    let path = std::env::temp_dir().join(format!(
        "shared-world-concurrency-{}.sqlite",
        crate::random_hex(12)
    ));
    let mut c = store::open(&path).unwrap();
    // The event store runs in WAL mode in production.
    c.pragma_update(None, "journal_mode", "WAL").unwrap();
    full_store::schema(&c).unwrap();
    let id = "c".repeat(48);
    store::create(&c, &id, "owner", now()).unwrap();
    full_store::seed(&c, &id, &World::create(None).unwrap(), "test-create", now()).unwrap();
    for a in 0..PLAYERS {
        let tx = c
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .unwrap();
        let claim = full::Command {
            op: "claim".into(),
            avatar: Some(actor_id(a).into()),
            action: Value::Null,
            target: None,
            key: String::new(),
            moving: false,
        };
        full::run(&tx, &id, &format!("user{a}"), &claim, now()).unwrap();
        tx.commit().unwrap();
    }
    let app = crate::test_app_state(crate::RuntimeWorld::seeded(), Some(path.clone()));
    let errors = Arc::new(Mutex::new(Vec::<String>::new()));
    let accepted = Arc::new(Mutex::new(Vec::<String>::new()));
    let start = Arc::new(Barrier::new(PLAYERS + 1));
    let playing = Arc::new(AtomicBool::new(true));

    let players: Vec<_> = (0..PLAYERS)
        .map(|a| {
            let (app, id, errors, accepted, start) = (
                app.clone(),
                id.clone(),
                errors.clone(),
                accepted.clone(),
                start.clone(),
            );
            std::thread::spawn(move || {
                // Fail at once on any SQLite writer contention.
                store::TEST_BUSY_TIMEOUT.set(Duration::from_millis(1));
                let u = format!("user{a}");
                start.wait();
                for round in 0..ROUNDS {
                    let view = match full::view_as(&app, &id, &u, None) {
                        Ok(view) => view,
                        Err(e) => {
                            errors.lock().unwrap().push(format!("view {a}: {e}"));
                            continue;
                        }
                    };
                    if let Some(command) = play(a, &view, round) {
                        match full::command_as(&app, &id, &u, &command, None) {
                            Ok(_) => accepted.lock().unwrap().push(command.key),
                            // Queue limits and moved scenes are ordinary refusals.
                            Err(e) if e != STORAGE_ERROR => {}
                            Err(e) => errors.lock().unwrap().push(format!("play {a}: {e}")),
                        }
                    }
                    let heartbeat = full::Command {
                        op: "heartbeat".into(),
                        avatar: None,
                        action: Value::Null,
                        target: None,
                        key: String::new(),
                        moving: false,
                    };
                    if let Err(e) = full::command_as(&app, &id, &u, &heartbeat, None) {
                        errors.lock().unwrap().push(format!("heartbeat {a}: {e}"));
                    }
                }
            })
        })
        .collect();

    let worker = {
        let (app, id, path, errors, playing) = (
            app.clone(),
            id.clone(),
            path.clone(),
            errors.clone(),
            playing.clone(),
        );
        std::thread::spawn(move || {
            store::TEST_BUSY_TIMEOUT.set(Duration::from_millis(1));
            start.wait();
            // An ordinary connection ends each scene early so the next play can
            // start. It takes the world's write turn like any other writer.
            let clock = store::open_sqlite(&path, Duration::from_secs(5)).unwrap();
            let mut idle = 0;
            while playing.load(Ordering::SeqCst) || idle < 3 {
                match full::take_work(&app, &id) {
                    Ok(Some(work)) => {
                        idle = 0;
                        let a = work.actor;
                        let key = work.id.clone();
                        let lines = json!([{"speaker":cast()["avatars"][a]["name"],
                            "actorId":actor_id(a),"entityId":actor_id(a),
                            "text":format!("I wait for play {key}.")}]);
                        if let Err(e) = full::finish_work(&app, &id, work, Ok(lines)) {
                            errors.lock().unwrap().push(format!("finish {key}: {e}"));
                        }
                        // The clock is a writer too: outside the turn it
                        // starves behind back-to-back gated writes (#1756).
                        full::in_write_turn(&app, || {
                            clock
                                .execute("UPDATE card_full_plays SET until_at=0 WHERE id=?", [&key])
                        })
                        .unwrap();
                    }
                    Ok(None) => {
                        if !playing.load(Ordering::SeqCst) {
                            idle += 1;
                        }
                        // A view expires the finished scene; mimic a poll.
                        if let Err(e) = full::view_as(&app, &id, "user0", None) {
                            errors.lock().unwrap().push(format!("worker view: {e}"));
                        }
                    }
                    Err(e) => errors.lock().unwrap().push(format!("take: {e}")),
                }
            }
        })
    };
    for player in players {
        player.join().unwrap();
    }
    playing.store(false, Ordering::SeqCst);
    worker.join().unwrap();

    let errors = errors.lock().unwrap().clone();
    assert!(
        errors.is_empty(),
        "storage errors under concurrency: {errors:#?}"
    );
    let accepted = accepted.lock().unwrap().clone();
    assert!(
        accepted.len() >= PLAYERS,
        "each player gets at least one play accepted: {accepted:?}"
    );

    // Every accepted play was taken exactly once, in queue order, and each
    // committed play has one journal record and one speech record.
    let rows: Vec<(String, usize, String)> = c
        .prepare("SELECT id,actor,status FROM card_full_plays WHERE world=? ORDER BY created,id")
        .unwrap()
        .query_map([&id], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)))
        .unwrap()
        .collect::<rusqlite::Result<_>>()
        .unwrap();
    let mut keys: Vec<_> = rows.iter().map(|(key, _, _)| key.clone()).collect();
    keys.sort();
    let mut expected = accepted.clone();
    expected.sort();
    assert_eq!(keys, expected, "no accepted play is lost or duplicated");
    assert!(
        rows.iter()
            .all(|(_, _, status)| status == "done" || status == "playing" || status == "failed"),
        "every play left the queue: {rows:?}"
    );
    let committed: Vec<&str> = rows
        .iter()
        .filter(|(_, _, status)| status != "failed")
        .map(|(_, a, _)| actor_id(*a))
        .collect();
    let log: Vec<Value> = c
        .prepare("SELECT command FROM card_full_log WHERE world=? ORDER BY seq")
        .unwrap()
        .query_map([&id], |r| r.get::<_, String>(0))
        .unwrap()
        .map(|text| serde_json::from_str(&text.unwrap()).unwrap())
        .collect();
    let played: Vec<&str> = log
        .iter()
        .filter(|command| command["op"] == "play")
        .map(|command| command["actor"].as_str().unwrap())
        .collect();
    let spoken: Vec<&str> = log
        .iter()
        .filter(|command| command["op"] == "speech")
        .map(|command| command["actor"].as_str().unwrap())
        .collect();
    assert_eq!(
        played, committed,
        "one journal play per accepted play, in queue order"
    );
    assert_eq!(
        spoken, committed,
        "one speech per committed play, in the same order"
    );

    // The journal still replays to the cached checkpoint.
    let cached = full_store::world(&c, &id, now()).unwrap();
    c.execute("DELETE FROM card_full_checkpoints", []).unwrap();
    assert_eq!(full_store::world(&c, &id, now()).unwrap(), cached);
    drop(c);
    let _ = std::fs::remove_file(path);
}
