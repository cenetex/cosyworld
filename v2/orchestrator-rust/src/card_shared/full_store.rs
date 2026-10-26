use super::{
    engine,
    full_world::{actor_id, World},
    store::{self, sql_error, Result},
};
use rusqlite::{params, Connection, OptionalExtension};
use serde_json::{json, Value};

pub(super) fn schema(c: &Connection) -> Result<()> {
    c.execute_batch("
      CREATE TABLE IF NOT EXISTS card_full_log(seq INTEGER PRIMARY KEY AUTOINCREMENT,world TEXT NOT NULL,command TEXT NOT NULL,at INTEGER NOT NULL);
      CREATE INDEX IF NOT EXISTS card_full_log_world ON card_full_log(world,seq);
      CREATE TABLE IF NOT EXISTS card_full_checkpoints(world TEXT PRIMARY KEY,seq INTEGER NOT NULL,state TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS card_full_plays(id TEXT PRIMARY KEY,world TEXT NOT NULL,actor INTEGER NOT NULL,user TEXT NOT NULL,room TEXT NOT NULL,command TEXT NOT NULL,status TEXT NOT NULL,created INTEGER NOT NULL,until_at INTEGER NOT NULL DEFAULT 0,result TEXT NOT NULL DEFAULT '{}',narrative TEXT NOT NULL DEFAULT '{}',retries INTEGER NOT NULL DEFAULT 0);
      CREATE INDEX IF NOT EXISTS card_full_plays_room ON card_full_plays(world,room,status,created);
      CREATE INDEX IF NOT EXISTS card_full_plays_user ON card_full_plays(user,created);
      CREATE TABLE IF NOT EXISTS card_full_scenes(seq INTEGER PRIMARY KEY AUTOINCREMENT,world TEXT NOT NULL,room TEXT NOT NULL,play TEXT NOT NULL UNIQUE,content TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS card_full_scenes_room ON card_full_scenes(world,room,seq);
    ").map_err(sql_error)
}
fn checkpoint(c: &Connection, id: &str, w: &World, seq: i64) -> Result<()> {
    c.execute("INSERT INTO card_full_checkpoints(world,seq,state) VALUES(?,?,?) ON CONFLICT(world) DO UPDATE SET seq=excluded.seq,state=excluded.state",params![id,seq,serde_json::to_string(w).map_err(sql_error)?]).map_err(sql_error)?;
    Ok(())
}
pub(super) fn seed(c: &Connection, id: &str, w: &World, reason: &str, now: i64) -> Result<()> {
    c.execute(
        "INSERT INTO card_full_log(world,command,at) VALUES(?,?,?)",
        params![
            id,
            json!({"op":"seed","reason":reason,"state":w}).to_string(),
            now
        ],
    )
    .map_err(sql_error)?;
    checkpoint(c, id, w, c.last_insert_rowid())
}
pub(super) fn world(c: &Connection, id: &str, now: i64) -> Result<World> {
    store::exists(c, id)?;
    let cached: Option<(i64, String)> = c
        .query_row(
            "SELECT seq,state FROM card_full_checkpoints WHERE world=?",
            [id],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .optional()
        .map_err(sql_error)?;
    let (mut seq, mut state) = match cached {
        Some((seq, state)) => (
            seq,
            Some(serde_json::from_str::<World>(&state).map_err(sql_error)?),
        ),
        None => (0, None),
    };
    let checkpoint_seq = seq;
    let mut q = c
        .prepare("SELECT seq,command FROM card_full_log WHERE world=? AND seq>? ORDER BY seq")
        .map_err(sql_error)?;
    let rows = q
        .query_map(params![id, seq], |r| {
            Ok((r.get::<_, i64>(0)?, r.get::<_, String>(1)?))
        })
        .map_err(sql_error)?;
    for row in rows {
        let (s, text) = row.map_err(sql_error)?;
        let command: Value = serde_json::from_str(&text).map_err(sql_error)?;
        if command["op"] == "seed" {
            if state.is_some() {
                return Err("This world's history needs attention.".into());
            }
            state = Some(serde_json::from_value(command["state"].clone()).map_err(sql_error)?);
        } else {
            state
                .as_mut()
                .ok_or("This world's history needs its first record.")?
                .apply(&command)?;
        }
        seq = s;
    }
    if let Some(mut w) = state {
        if w.version == engine::LEGACY_VERSION || w.version == engine::PREVIOUS_VERSION {
            let from = w.version.clone();
            commit(
                c,
                id,
                &mut w,
                json!({"op":"upgrade", "from":from, "to":engine::VERSION}),
                now,
            )?;
            return Ok(w);
        }
        if w.version != engine::VERSION {
            return Err("This world's rules need a saved migration.".into());
        }
        if seq > checkpoint_seq {
            checkpoint(c, id, &w, seq)?;
        }
        return Ok(w);
    }
    // Keep the old command interpreter intact. Migration is one explicit seed
    // record, preserving the invite and account claims while extending the map.
    let old = store::world(c, id)?;
    let mut q = c.prepare("SELECT room,play,content FROM (SELECT seq,room,play,content FROM card_scenes WHERE world=? AND length(content)<=32768 ORDER BY seq DESC LIMIT 80) ORDER BY seq").map_err(sql_error)?;
    let legacy_scenes = q
        .query_map([id], |r| {
            Ok((
                r.get::<_, i32>(0)?,
                r.get::<_, String>(1)?,
                r.get::<_, String>(2)?,
            ))
        })
        .map_err(sql_error)?
        .collect::<std::result::Result<Vec<_>, _>>()
        .map_err(sql_error)?;
    let legacy_scenes: Vec<Value> = legacy_scenes.into_iter().filter_map(|(room,play,text)| {
        let scene: Value = serde_json::from_str(&text).ok()?;
        Some(json!({"play":play,"room":room,"actor":scene["actor"],"turn":scene["turn"],"action":scene["action"],"lines":scene["lines"],"starts_at":scene["starts_at"],"until_at":scene["until_at"],"error":scene["error"]}))
    }).collect();
    let result = engine::reduce(json!({"op":"migrate","legacy":old,"legacyScenes":legacy_scenes}))?;
    let w = World {
        version: engine::VERSION.into(),
        game: result["world"].clone(),
        claimed: old.claimed,
        present: [0; 8],
    };
    seed(c, id, &w, "legacy-nine-room-to-full-world", now)?;
    for scene in result["legacyScenes"].as_array().into_iter().flatten() {
        let room = scene["room"]
            .as_str()
            .ok_or("The remembered scene needs a place.")?;
        let play = scene["play"]
            .as_str()
            .ok_or("The remembered scene needs its record.")?;
        c.execute(
            "INSERT OR IGNORE INTO card_full_scenes(world,room,play,content) VALUES(?,?,?,?)",
            params![id, room, play, scene.to_string()],
        )
        .map_err(sql_error)?;
    }
    c.execute("UPDATE card_plays SET status='cancelled' WHERE world=? AND status IN ('waiting','working','playing')",[id]).map_err(sql_error)?;
    Ok(w)
}
pub(super) fn commit(
    c: &Connection,
    id: &str,
    w: &mut World,
    command: Value,
    now: i64,
) -> Result<Value> {
    let result = w.apply(&command)?;
    c.execute(
        "INSERT INTO card_full_log(world,command,at) VALUES(?,?,?)",
        params![id, command.to_string(), now],
    )
    .map_err(sql_error)?;
    checkpoint(c, id, w, c.last_insert_rowid())?;
    Ok(result)
}
pub(super) fn expire(c: &Connection, id: &str, w: &mut World, now: i64) -> Result<()> {
    let mut q = c
        .prepare("SELECT actor FROM card_members WHERE world=? AND seen<?")
        .map_err(sql_error)?;
    let stale = q
        .query_map(params![id, now - 60_000], |r| r.get::<_, usize>(0))
        .map_err(sql_error)?
        .collect::<std::result::Result<Vec<_>, _>>()
        .map_err(sql_error)?;
    for a in stale {
        if a >= 8 {
            return Err("This world's avatar claims need attention.".into());
        }
        if w.present[a] == 1 {
            commit(c, id, w, json!({"op":"leave","actor":actor_id(a)}), now)?;
        }
        c.execute("UPDATE card_full_plays SET status='cancelled' WHERE world=? AND actor=? AND status IN ('waiting','retry')",params![id,a]).map_err(sql_error)?;
    }
    let mut q=c.prepare("SELECT id,room,result FROM card_full_plays WHERE world=? AND status='working' AND until_at<?").map_err(sql_error)?;
    let interrupted = q
        .query_map(params![id, now], |r| {
            Ok((
                r.get::<_, String>(0)?,
                r.get::<_, String>(1)?,
                r.get::<_, String>(2)?,
            ))
        })
        .map_err(sql_error)?
        .collect::<std::result::Result<Vec<_>, _>>()
        .map_err(sql_error)?;
    for (play, room, text) in interrupted {
        let mut scene: Value = serde_json::from_str(&text).map_err(sql_error)?;
        for key in ["context", "profiles", "events"] {
            scene
                .as_object_mut()
                .ok_or("The scene needs attention.")?
                .remove(key);
        }
        scene["error"] = json!("The play is saved. Speech was interrupted.");
        scene["starts_at"] = json!(now);
        scene["until_at"] = json!(now);
        c.execute(
            "INSERT OR IGNORE INTO card_full_scenes(world,room,play,content) VALUES(?,?,?,?)",
            params![id, room, play, scene.to_string()],
        )
        .map_err(sql_error)?;
        c.execute(
            "UPDATE card_full_plays SET status='failed',result=? WHERE id=?",
            params![scene.to_string(), play],
        )
        .map_err(sql_error)?;
    }
    c.execute("UPDATE card_full_plays SET status='done' WHERE world=? AND status='playing' AND until_at<=?",params![id,now]).map_err(sql_error)?;
    Ok(())
}
pub(super) fn snapshot(c: &Connection, id: &str, user: &str, now: i64) -> Result<Value> {
    let w = world(c, id, now)?;
    let actor = store::member(c, id, user)?;
    let Some(a) = actor else {
        return Ok(json!({"id":id,"actor":null,"claimed":w.claimed,"now":now,"version":w.version}));
    };
    let a = usize::try_from(a)
        .ok()
        .filter(|a| *a < 8)
        .ok_or("The avatar claim needs attention.")?;
    let room = w.room(a)?;
    let here = w.present[a] == 1;
    let projected = w.project(a)?;
    let mut q=c.prepare("SELECT id,actor,status FROM card_full_plays WHERE world=? AND (room=? OR actor=?) AND status IN ('waiting','retry','working','playing') ORDER BY created,id").map_err(sql_error)?;
    let queue=q.query_map(params![id,room,a],|r|Ok(json!({"id":r.get::<_,String>(0)?,"actor":actor_id(r.get::<_,usize>(1)?),"status":r.get::<_,String>(2)?}))).map_err(sql_error)?.collect::<std::result::Result<Vec<_>,_>>().map_err(sql_error)?;
    let mut q=c.prepare("SELECT content FROM card_full_scenes WHERE world=? AND room=? ORDER BY seq DESC LIMIT 40").map_err(sql_error)?;
    let history = if here {
        q.query_map(params![id, room], |r| r.get::<_, String>(0))
            .map_err(sql_error)?
            .map(|r| serde_json::from_str::<Value>(&r.map_err(sql_error)?).map_err(sql_error))
            .collect::<Result<Vec<_>>>()?
    } else {
        vec![]
    };
    let nudge: Option<usize> = c
        .query_row(
            "SELECT sender FROM card_nudges WHERE world=? AND target=? AND at>?",
            params![id, a, now - 15_000],
            |r| r.get(0),
        )
        .optional()
        .map_err(sql_error)?;
    let recent:Option<String>=c.query_row("SELECT result FROM card_full_plays WHERE world=? AND actor=? AND status IN ('failed','cancelled') ORDER BY created DESC LIMIT 1",params![id,a],|r|r.get(0)).optional().map_err(sql_error)?;
    let notice = recent
        .and_then(|s| serde_json::from_str::<Value>(&s).ok())
        .and_then(|s| s["error"].as_str().map(str::to_owned));
    Ok(
        json!({"id":id,"version":w.version,"actor":actor_id(a),"claimed":w.claimed,"present":w.present,"world":projected["world"],"actions":projected["actions"],"exits":projected["exits"],"queue":if here{queue}else{vec![]},"history":history,"nudge":nudge.filter(|a|*a<8).map(actor_id),"now":now,"notice":notice}),
    )
}
pub(super) struct PlayRequest<'a> {
    pub action: Value,
    pub key: &'a str,
}
pub(super) fn enqueue(
    c: &Connection,
    id: &str,
    user: &str,
    w: &World,
    a: usize,
    play: PlayRequest<'_>,
    now: i64,
) -> Result<()> {
    let PlayRequest { action, key } = play;
    let command = json!({"op":"play","actor":actor_id(a),"action":action});
    let text = command.to_string();
    let old: Option<(String, String, String)> = c
        .query_row(
            "SELECT world,user,command FROM card_full_plays WHERE id=?",
            [key],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
        )
        .optional()
        .map_err(sql_error)?;
    if let Some((world, owner, prior)) = old {
        return if world == id && owner == user && prior == text {
            Ok(())
        } else {
            Err("Use a fresh play request.".into())
        };
    }
    let (minute,hour):(i32,i32)=c.query_row("SELECT coalesce(sum(created>?),0),count(*) FROM card_full_plays WHERE user=? AND created>?",params![now-60_000,user,now-3_600_000],|r|Ok((r.get(0)?,r.get(1)?))).map_err(sql_error)?;
    let total: i32 = c
        .query_row(
            "SELECT count(*) FROM card_full_plays WHERE created>?",
            [now - 3_600_000],
            |r| r.get(0),
        )
        .map_err(sql_error)?;
    if minute >= 24 || hour >= 240 || total >= 1200 {
        return Err("The table is resting for a moment. Try your play shortly.".into());
    }
    let mut probe = w.clone();
    probe.apply(&command)?;
    let pending:i32=c.query_row("SELECT count(*) FROM card_full_plays WHERE world=? AND actor=? AND status IN ('waiting','retry','working','playing')",params![id,a],|r|r.get(0)).map_err(sql_error)?;
    if pending > 0 {
        return Err("Your play is already at the table.".into());
    }
    let room = w.room(a)?;
    let count:i32=c.query_row("SELECT count(*) FROM card_full_plays WHERE world=? AND room=? AND status IN ('waiting','retry','working','playing')",params![id,room],|r|r.get(0)).map_err(sql_error)?;
    if count >= 4 {
        return Err("Four plays are at the table. Yours can follow shortly.".into());
    }
    c.execute("INSERT INTO card_full_plays(id,world,actor,user,room,command,status,created) VALUES(?,?,?,?,?,?,'waiting',?)",params![key,id,a,user,room,text,now]).map_err(sql_error)?;
    Ok(())
}
