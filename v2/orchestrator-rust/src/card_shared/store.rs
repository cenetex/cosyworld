use super::kernel::{Action, World};
use rusqlite::{params, Connection, OptionalExtension};
use serde_json::{json, Value};
use std::{path::Path, time::Duration};

pub(super) type Result<T> = std::result::Result<T, String>;
pub(super) fn open(path: &Path) -> Result<Connection> {
    open_sqlite(path, busy_timeout()).map_err(err)
}
#[cfg(not(test))]
fn busy_timeout() -> Duration {
    Duration::from_secs(5)
}
#[cfg(test)]
thread_local! {
    /// A test thread can shorten the wait so any SQLite writer contention
    /// fails at once instead of hiding behind the five-second timeout.
    pub(super) static TEST_BUSY_TIMEOUT: std::cell::Cell<Duration> =
        const { std::cell::Cell::new(Duration::from_secs(5)) };
}
#[cfg(test)]
fn busy_timeout() -> Duration {
    TEST_BUSY_TIMEOUT.with(std::cell::Cell::get)
}
pub(super) fn open_sqlite(path: &Path, busy_timeout: Duration) -> rusqlite::Result<Connection> {
    let c = Connection::open(path)?;
    c.busy_timeout(busy_timeout)?;
    // Back-fill bindings only when their table is new: a write on every open
    // would contend with the world's writers.
    let new_bindings = c
        .query_row(
            "SELECT 1 FROM sqlite_master WHERE type='table' AND name='card_bindings'",
            [],
            |_| Ok(()),
        )
        .optional()?
        .is_none();
    c.execute_batch("
      CREATE TABLE IF NOT EXISTS card_tables(id TEXT PRIMARY KEY, owner TEXT NOT NULL, created INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS card_members(world TEXT NOT NULL, actor INTEGER NOT NULL, user TEXT NOT NULL, seen INTEGER NOT NULL DEFAULT 0, PRIMARY KEY(world,actor), UNIQUE(world,user));
      CREATE TABLE IF NOT EXISTS card_checkpoints(world TEXT PRIMARY KEY, seq INTEGER NOT NULL, state TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS card_tables_owner ON card_tables(owner);
      CREATE INDEX IF NOT EXISTS card_members_user ON card_members(user);
      -- A passkey's avatar in a world (bindings.rs).
      CREATE TABLE IF NOT EXISTS card_bindings(world TEXT NOT NULL, actor INTEGER NOT NULL, user TEXT NOT NULL, PRIMARY KEY(world,actor), UNIQUE(world,user));
      -- An avatar's level between seats (bindings.rs).
      CREATE TABLE IF NOT EXISTS card_avatar_progress(user TEXT NOT NULL, actor INTEGER NOT NULL, progress TEXT NOT NULL, PRIMARY KEY(user,actor));
      -- A passkey's one-way cosmetic upgrades for an avatar (bindings.rs).
      CREATE TABLE IF NOT EXISTS card_avatar_upgrades(user TEXT NOT NULL, actor INTEGER NOT NULL, upgrade TEXT NOT NULL, PRIMARY KEY(user,actor,upgrade));
      CREATE TABLE IF NOT EXISTS card_log(seq INTEGER PRIMARY KEY AUTOINCREMENT, world TEXT NOT NULL, command TEXT NOT NULL, at INTEGER NOT NULL);
      CREATE INDEX IF NOT EXISTS card_log_world ON card_log(world,seq);
      CREATE TABLE IF NOT EXISTS card_plays(id TEXT PRIMARY KEY, world TEXT NOT NULL, actor INTEGER NOT NULL, user TEXT NOT NULL, room INTEGER NOT NULL, command TEXT NOT NULL, status TEXT NOT NULL, created INTEGER NOT NULL, until_at INTEGER NOT NULL DEFAULT 0, result TEXT NOT NULL DEFAULT '{}');
      CREATE INDEX IF NOT EXISTS card_plays_user_time ON card_plays(user,created);
      CREATE INDEX IF NOT EXISTS card_plays_time ON card_plays(created);
      CREATE INDEX IF NOT EXISTS card_plays_room ON card_plays(world,room,status,created);
      CREATE TABLE IF NOT EXISTS card_scenes(seq INTEGER PRIMARY KEY AUTOINCREMENT, world TEXT NOT NULL, room INTEGER NOT NULL, play TEXT NOT NULL UNIQUE, content TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS card_scenes_room ON card_scenes(world,room,seq);
      CREATE TABLE IF NOT EXISTS card_nudges(world TEXT NOT NULL, target INTEGER NOT NULL, sender INTEGER NOT NULL, at INTEGER NOT NULL, PRIMARY KEY(world,target));
    ")?;
    // Current members are bound; an avatar released before bindings existed
    // was never recorded.
    if new_bindings {
        c.execute(
            "INSERT OR IGNORE INTO card_bindings(world,actor,user) SELECT world,actor,user FROM card_members",
            [],
        )?;
    }
    Ok(c)
}
fn err(e: impl std::fmt::Display) -> String {
    {
        tracing::warn!(error=%e, "shared world storage error");
        "The shared world is taking a moment. Try again.".into()
    }
}
pub(super) fn exists(c: &Connection, id: &str) -> Result<()> {
    if c.query_row("SELECT 1 FROM card_tables WHERE id=?", [id], |r| {
        r.get::<_, i32>(0)
    })
    .optional()
    .map_err(err)?
    .is_some()
    {
        Ok(())
    } else {
        Err("Open a shared world from its invitation.".into())
    }
}
pub(super) fn world(c: &Connection, id: &str) -> Result<World> {
    exists(c, id)?;
    let checkpoint: Option<(i64, String)> = c
        .query_row(
            "SELECT seq,state FROM card_checkpoints WHERE world=?",
            [id],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .optional()
        .map_err(err)?;
    let (seq, mut w) = match checkpoint {
        Some((seq, text)) => (seq, serde_json::from_str::<World>(&text).map_err(err)?),
        None => (0, World::new()),
    };
    let mut q = c
        .prepare("SELECT command FROM card_log WHERE world=? AND seq>? ORDER BY seq")
        .map_err(err)?;
    let rows = q
        .query_map(params![id, seq], |r| r.get::<_, String>(0))
        .map_err(err)?;
    for row in rows {
        let a: Action = serde_json::from_str(&row.map_err(err)?).map_err(err)?;
        w.apply(a)
            .map_err(|_| "This world's history needs attention.".to_string())?;
    }
    Ok(w)
}
#[cfg(test)]
pub(super) fn commit(c: &Connection, id: &str, w: &mut World, a: Action, now: i64) -> Result<()> {
    w.apply(a)?;
    c.execute(
        "INSERT INTO card_log(world,command,at) VALUES(?,?,?)",
        params![id, serde_json::to_string(&a).map_err(err)?, now],
    )
    .map_err(err)?;
    // Cache the C result in the same transaction as its replayable command.
    let seq = c.last_insert_rowid();
    c.execute("INSERT INTO card_checkpoints(world,seq,state) VALUES(?,?,?) ON CONFLICT(world) DO UPDATE SET seq=excluded.seq,state=excluded.state", params![id,seq,serde_json::to_string(w).map_err(err)?]).map_err(err)?;
    Ok(())
}
pub(super) fn member(c: &Connection, id: &str, user: &str) -> Result<Option<i32>> {
    c.query_row(
        "SELECT actor FROM card_members WHERE world=? AND user=?",
        params![id, user],
        |r| r.get(0),
    )
    .optional()
    .map_err(err)
}
#[cfg(test)]
pub(super) fn expire(c: &Connection, id: &str, w: &mut World, now: i64) -> Result<()> {
    let mut q = c
        .prepare("SELECT actor FROM card_members WHERE world=? AND seen<?")
        .map_err(err)?;
    let actors = q
        .query_map(params![id, now - 60_000], |r| r.get::<_, i32>(0))
        .map_err(err)?
        .collect::<std::result::Result<Vec<_>, _>>()
        .map_err(err)?;
    for actor in actors {
        if w.present[actor as usize] == 1 {
            commit(
                c,
                id,
                w,
                Action {
                    kind: 4,
                    actor,
                    item: -1,
                    target: -1,
                },
                now,
            )?;
        }
        c.execute("UPDATE card_plays SET status='cancelled' WHERE world=? AND actor=? AND status='waiting'",params![id,actor]).map_err(err)?;
    }
    // A worker may end with its process. A committed action stays committed.
    // Its expired narration lease is published as a visible speech failure.
    let mut q=c.prepare("SELECT id,room,result FROM card_plays WHERE world=? AND status='working' AND until_at<?").map_err(err)?;
    let rows = q
        .query_map(params![id, now], |r| {
            Ok((
                r.get::<_, String>(0)?,
                r.get::<_, i32>(1)?,
                r.get::<_, String>(2)?,
            ))
        })
        .map_err(err)?
        .collect::<std::result::Result<Vec<_>, _>>()
        .map_err(err)?;
    for (play, room, result) in rows {
        let mut scene: Value = serde_json::from_str(&result).map_err(err)?;
        scene.as_object_mut().unwrap().remove("world");
        scene["error"] = json!("The play is saved. Speech was interrupted.");
        scene["starts_at"] = json!(now);
        scene["until_at"] = json!(now);
        c.execute(
            "INSERT OR IGNORE INTO card_scenes(world,room,play,content) VALUES(?,?,?,?)",
            params![id, room, play, scene.to_string()],
        )
        .map_err(err)?;
        c.execute(
            "UPDATE card_plays SET status='failed', result=? WHERE id=?",
            params![scene.to_string(), play],
        )
        .map_err(err)?;
    }
    c.execute(
        "UPDATE card_plays SET status='done' WHERE world=? AND status='playing' AND until_at<=?",
        params![id, now],
    )
    .map_err(err)?;
    Ok(())
}
pub(super) fn create(c: &Connection, id: &str, user: &str, now: i64) -> Result<()> {
    let count: i64 = c
        .query_row(
            "SELECT count(*) FROM card_tables WHERE owner=?",
            [user],
            |r| r.get(0),
        )
        .map_err(err)?;
    // Eight world slots per passkey (#1846).
    if count >= 8 {
        return Err("You have 8 worlds. Continue one of them.".into());
    }
    c.execute(
        "INSERT INTO card_tables(id,owner,created) VALUES(?,?,?)",
        params![id, user, now],
    )
    .map_err(err)?;
    Ok(())
}
pub(super) fn list(c: &Connection, user: &str) -> Result<Value> {
    // `bound` is the avatar this person returns as there (bindings.rs), and
    // `full` says every avatar there belongs to someone. `owner` marks the
    // person's own world slots, and `held` the seats someone holds (#1877).
    let mut q=c.prepare("SELECT t.id,m.actor,(SELECT count(*) FROM card_members c WHERE c.world=t.id),b.actor,(SELECT count(*) FROM card_bindings f WHERE f.world=t.id),t.owner=?,(SELECT group_concat(actor) FROM card_members c WHERE c.world=t.id),(SELECT group_concat(actor) FROM card_bindings f WHERE f.world=t.id) FROM card_tables t LEFT JOIN card_members m ON m.world=t.id AND m.user=? LEFT JOIN card_bindings b ON b.world=t.id AND b.user=? WHERE t.owner=? OR m.user=? OR b.user=? ORDER BY t.created DESC LIMIT 64").map_err(err)?;
    let rows=q.query_map(params![user,user,user,user,user,user],|r|{
        let mut held=[0;8];
        for seats in [r.get::<_,Option<String>>(6)?,r.get::<_,Option<String>>(7)?].into_iter().flatten() {
            for a in seats.split(',').filter_map(|a| a.parse::<usize>().ok()).filter(|a| *a < 8) {
                held[a]=1;
            }
        }
        Ok(json!({"id":r.get::<_,String>(0)?,"actor":r.get::<_,Option<i32>>(1)?,"claimed":r.get::<_,i32>(2)?,"bound":r.get::<_,Option<i32>>(3)?,"full":r.get::<_,i32>(4)?>=8,"owner":r.get::<_,bool>(5)?,"held":held}))
    }).map_err(err)?.collect::<std::result::Result<Vec<_>,_>>().map_err(err)?;
    Ok(json!({"worlds":rows}))
}
#[cfg(test)]
pub(super) fn snapshot(c: &Connection, id: &str, user: &str, now: i64) -> Result<Value> {
    let w = world(c, id)?;
    let actor = member(c, id, user)?;
    // The invitation reveals the cast and claim availability. Room scenes and
    // belongings are delivered only to a member present in that room.
    let Some(a) = actor else {
        return Ok(json!({"id":id,"actor":null,"claimed":w.claimed,"now":now}));
    };
    let room = w.places[a as usize];
    let here = w.present[a as usize] == 1;
    let mut q=c.prepare("SELECT id,actor,status,result FROM card_plays WHERE world=? AND (room=? OR actor=?) AND status IN ('waiting','working','playing') ORDER BY created,id").map_err(err)?;
    let queue=q.query_map(params![id,room,a],|r|Ok(json!({"id":r.get::<_,String>(0)?,"actor":r.get::<_,i32>(1)?,"status":r.get::<_,String>(2)?}))).map_err(err)?.collect::<std::result::Result<Vec<_>,_>>().map_err(err)?;
    let mut q = c
        .prepare(
            "SELECT content FROM card_scenes WHERE world=? AND room=? ORDER BY seq DESC LIMIT 40",
        )
        .map_err(err)?;
    let history = if here {
        q.query_map(params![id, room], |r| r.get::<_, String>(0))
            .map_err(err)?
            .map(|r| serde_json::from_str::<Value>(&r.map_err(err)?).map_err(err))
            .collect::<Result<Vec<_>>>()?
    } else {
        vec![]
    };
    let nudge: Option<i32> = c
        .query_row(
            "SELECT sender FROM card_nudges WHERE world=? AND target=? AND at>?",
            params![id, a, now - 15_000],
            |r| r.get(0),
        )
        .optional()
        .map_err(err)?;
    let recent:Option<String>=c.query_row("SELECT result FROM card_plays WHERE world=? AND actor=? AND status IN ('failed','cancelled') ORDER BY created DESC LIMIT 1",params![id,a],|r|r.get(0)).optional().map_err(err)?;
    let mut view = w.clone();
    // Only local custody and avatar places reach the shared scene client.
    for i in 0..8 {
        if !here || !w.present[i].eq(&1) || w.places[i] != room {
            view.present[i] = 0;
            view.places[i] = -1;
        }
        let holder = w.holders[i];
        let local = if (0..8).contains(&holder) {
            here && w.present[holder as usize] == 1 && w.places[holder as usize] == room
        } else {
            here && holder == 8 + room
        };
        if !local {
            view.holders[i] = -1;
            view.uses[i] = 0;
        }
    }
    view.places[a as usize] = room;
    Ok(
        json!({"id":id,"actor":a,"world":view,"exits":if here{w.exits(a)}else{vec![]},"queue":if here{queue}else{vec![]},"history":history,"nudge":nudge,"notice":recent.and_then(|s|serde_json::from_str::<Value>(&s).ok()).and_then(|v|v["error"].as_str().map(str::to_string)),"now":now}),
    )
}
#[cfg(test)]
pub(super) fn enqueue(
    c: &Connection,
    id: &str,
    user: &str,
    w: &World,
    a: Action,
    key: &str,
    now: i64,
) -> Result<()> {
    if !(5..=11).contains(&a.kind) {
        return Err("Choose an available play.".into());
    }
    let previous: Option<(String, String, String)> = c
        .query_row(
            "SELECT world,user,command FROM card_plays WHERE id=?",
            [key],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
        )
        .optional()
        .map_err(err)?;
    let serialized = serde_json::to_string(&a).map_err(err)?;
    if let Some((world, owner, command)) = previous {
        return if world == id && owner == user && command == serialized {
            Ok(())
        } else {
            Err("Use a fresh play request.".into())
        };
    }
    let (minute, hour): (i32, i32) = c
        .query_row(
            "SELECT coalesce(sum(created>?),0),count(*) FROM card_plays WHERE user=? AND created>?",
            params![now - 60_000, user, now - 3_600_000],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .map_err(err)?;
    let total: i32 = c
        .query_row(
            "SELECT count(*) FROM card_plays WHERE created>?",
            [now - 3_600_000],
            |r| r.get(0),
        )
        .map_err(err)?;
    if minute >= 24 || hour >= 240 || total >= 1200 {
        return Err("The table is resting for a moment. Try your play shortly.".into());
    }
    let mut probe = w.clone();
    probe.apply(a)?;
    let room = w.places[a.actor as usize];
    let pending:i32=c.query_row("SELECT count(*) FROM card_plays WHERE world=? AND actor=? AND status IN ('waiting','working','playing')",params![id,a.actor],|r|r.get(0)).map_err(err)?;
    if pending > 0 {
        return Err("Your play is already at the table.".into());
    }
    let queued:i32=c.query_row("SELECT count(*) FROM card_plays WHERE world=? AND room=? AND status IN ('waiting','working','playing')",params![id,room],|r|r.get(0)).map_err(err)?;
    if queued >= 4 {
        return Err("Four plays are at the table. Yours can follow shortly.".into());
    }
    c.execute("INSERT INTO card_plays(id,world,actor,user,room,command,status,created) VALUES(?,?,?,?,?,?,'waiting',?)",params![key,id,a.actor,user,room,serialized,now]).map_err(err)?;
    Ok(())
}
pub(super) fn sql_error(e: impl std::fmt::Display) -> String {
    err(e)
}
