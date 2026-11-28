use super::{
    content, engine, full_floor as floor,
    full_world::{actor_id, actor_index, run_seed, World},
    store::{self, sql_error, Result},
};
use rusqlite::{params, Connection, OptionalExtension};
use serde_json::{json, Value};

pub(super) fn schema(c: &Connection) -> Result<()> {
    schema_sqlite(c).map_err(sql_error)
}
pub(super) fn schema_sqlite(c: &Connection) -> rusqlite::Result<()> {
    c.execute_batch("
      CREATE TABLE IF NOT EXISTS card_full_log(seq INTEGER PRIMARY KEY AUTOINCREMENT,world TEXT NOT NULL,command TEXT NOT NULL,at INTEGER NOT NULL);
      CREATE INDEX IF NOT EXISTS card_full_log_world ON card_full_log(world,seq);
      CREATE INDEX IF NOT EXISTS card_full_log_actor_plays ON card_full_log(world,json_extract(command,'$.actor')) WHERE json_extract(command,'$.op')='play';
      CREATE TABLE IF NOT EXISTS card_full_checkpoints(world TEXT PRIMARY KEY,seq INTEGER NOT NULL,state TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS card_full_plays(id TEXT PRIMARY KEY,world TEXT NOT NULL,actor INTEGER NOT NULL,user TEXT NOT NULL,room TEXT NOT NULL,command TEXT NOT NULL,status TEXT NOT NULL,created INTEGER NOT NULL,until_at INTEGER NOT NULL DEFAULT 0,result TEXT NOT NULL DEFAULT '{}',narrative TEXT NOT NULL DEFAULT '{}',retries INTEGER NOT NULL DEFAULT 0);
      CREATE INDEX IF NOT EXISTS card_full_plays_room ON card_full_plays(world,room,status,created);
      CREATE INDEX IF NOT EXISTS card_full_plays_user ON card_full_plays(user,created);
      CREATE TABLE IF NOT EXISTS card_full_scenes(seq INTEGER PRIMARY KEY AUTOINCREMENT,world TEXT NOT NULL,room TEXT NOT NULL,play TEXT NOT NULL UNIQUE,content TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS card_full_scenes_room ON card_full_scenes(world,room,seq);
      CREATE TABLE IF NOT EXISTS card_full_packs(hash TEXT PRIMARY KEY,revision TEXT NOT NULL,content TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS card_full_elysium_receipts(world TEXT NOT NULL,resident TEXT NOT NULL,scattered INTEGER NOT NULL,returned INTEGER,PRIMARY KEY(world,resident));
    ")
}
fn checkpoint(c: &Connection, id: &str, w: &World, seq: i64) -> Result<()> {
    c.execute("INSERT INTO card_full_checkpoints(world,seq,state) VALUES(?,?,?) ON CONFLICT(world) DO UPDATE SET seq=excluded.seq,state=excluded.state",params![id,seq,serde_json::to_string(w).map_err(sql_error)?]).map_err(sql_error)?;
    Ok(())
}
pub(super) fn name_seed(c: &Connection, id: &str) -> Result<u32> {
    let seed: Option<i64> = c
        .query_row(
            "SELECT json_extract(state,'$.game.run.seed') FROM card_full_checkpoints WHERE world=?",
            [id],
            |r| r.get(0),
        )
        .optional()
        .map_err(sql_error)?
        .flatten();
    Ok(seed
        .and_then(|s| u32::try_from(s).ok())
        .unwrap_or_else(|| run_seed(id)))
}
pub(super) fn seed(c: &Connection, id: &str, w: &World, reason: &str, now: i64) -> Result<()> {
    if w.pack.is_some() {
        content::save(c)?;
    }
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
pub(super) fn replay(
    c: &Connection,
    id: &str,
    mut seq: i64,
    mut state: Option<World>,
    mut apply: impl FnMut(i64, &mut World, &Value) -> Result<()>,
) -> Result<(i64, Option<World>)> {
    if let Some(pack) = state.as_ref().and_then(|w| w.pack.as_deref()) {
        content::preload(c, pack)?;
    }
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
        let mut command: Value = serde_json::from_str(&text).map_err(sql_error)?;
        take_surface(&mut command);
        if command["op"] == "seed" {
            if state.is_some() {
                return Err("This world's history needs attention.".into());
            }
            let seeded: World =
                serde_json::from_value(command["state"].clone()).map_err(sql_error)?;
            if let Some(pack) = seeded.pack.as_deref() {
                content::preload(c, pack)?;
            }
            state = Some(seeded);
        } else {
            let pack = match command["op"].as_str() {
                Some("repack") => command["to"].as_str(),
                _ => command["pack"].as_str(),
            };
            if let Some(pack) = pack {
                content::preload(c, pack)?;
            }
            apply(
                s,
                state
                    .as_mut()
                    .ok_or("This world's history needs its first record.")?,
                &command,
            )?;
        }
        seq = s;
    }
    Ok((seq, state))
}

pub(super) fn world(c: &Connection, id: &str, now: i64) -> Result<World> {
    store::exists(c, id)?;
    if floor::below(c, id)? {
        return Err(floor::CLOSED.into());
    }
    let cached: Option<(i64, String)> = c
        .query_row(
            "SELECT seq,state FROM card_full_checkpoints WHERE world=?",
            [id],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .optional()
        .map_err(sql_error)?;
    let (seq, state) = match cached {
        Some((seq, state)) => (
            seq,
            Some(serde_json::from_str::<World>(&state).map_err(sql_error)?),
        ),
        None => (0, None),
    };
    let checkpoint_seq = seq;
    let (seq, state) = replay(c, id, seq, state, |_, world, command| {
        world.apply(command).map(|_| ())
    })?;
    if let Some(mut w) = state {
        if engine::historical(&w.version) {
            let from = w.version.clone();
            let mut upgrade =
                json!({"op":"upgrade", "from":from, "to":engine::version(), "seed":run_seed(id)});
            content::save(c)?;
            upgrade["pack"] = json!(content::current());
            commit(c, id, &mut w, upgrade, now)?;
            return Ok(w);
        }
        if engine::newer(&w.version) {
            return Err(engine::UPDATING.into());
        }
        if w.version != engine::version() {
            return Err("This world's rules need a saved migration.".into());
        }
        if w.pack.as_deref() != Some(content::current()) {
            content::save(c)?;
            let repack = json!({"op":"repack", "from":w.pack, "to":content::current(), "revision":content::REVISION});
            commit(c, id, &mut w, repack, now)?;
            return Ok(w);
        }
        if seq > checkpoint_seq {
            checkpoint(c, id, &w, seq)?;
        }
        return Ok(w);
    }
    Err(floor::CLOSED.into())
}
pub(super) fn commit(
    c: &Connection,
    id: &str,
    w: &mut World,
    command: Value,
    now: i64,
) -> Result<Value> {
    commit_with_reveal(c, id, w, command, None, now)
}

pub(super) fn commit_with_reveal(
    c: &Connection,
    id: &str,
    w: &mut World,
    mut command: Value,
    revealed: Option<Value>,
    now: i64,
) -> Result<Value> {
    let surface = take_surface(&mut command);
    let mut result = w.apply(&command)?;
    if let Some(surface) = surface {
        command["surface"] = surface;
    }
    c.execute(
        "INSERT INTO card_full_log(world,command,at) VALUES(?,?,?)",
        params![id, command.to_string(), now],
    )
    .map_err(sql_error)?;
    let seq = c.last_insert_rowid();
    checkpoint(c, id, w, seq)?;
    // The play is already journaled, so narrator work must not return an error here.
    if command["op"] == "play" {
        let Ok(a) = actor_index(command["actor"].as_str().unwrap_or_default()) else {
            return Ok(result);
        };
        // Passkeys retain all upgrades from a play, including gifts or trades to other travelers (#1873).
        for seat in 0..8 {
            let kept = super::bindings::holder(c, id, seat).and_then(|holder| match holder {
                Some(user) => super::bindings::record_upgrades(c, &user, seat, &w.game),
                None => Ok(()),
            });
            if let Err(error) = kept {
                tracing::error!(error = %error, "could not keep an avatar's upgrades")
            }
        }
        unlock(c, id, &result, seq, now);
        let mut scene = w.request("context", a);
        scene["action"] = command["action"].clone();
        if let Some(revealed) = revealed {
            scene["revealed"] = revealed;
        }
        match super::narrator::context(&scene) {
            Ok(context) => result["context"] = context,
            Err(error) => {
                tracing::error!(error = %error, "the narrator could not describe a committed play")
            }
        }
    }
    Ok(result)
}
// Meeting unlocks the avatar for the talker's passkey. Its world hides the next when space opens (#1936).
fn unlock(c: &Connection, id: &str, result: &Value, seq: i64, now: i64) {
    let found = super::unlocks::record(c, id, result, seq).unwrap_or_else(|error| {
        tracing::error!(%error, "could not record an unlock");
        vec![]
    });
    for (user, a) in found {
        let opened = c
            .execute_batch("SAVEPOINT unlock_world")
            .map_err(sql_error)
            .and_then(|()| super::full::found(c, &user, a, None, now));
        let end = if opened.is_ok() {
            "RELEASE unlock_world"
        } else {
            "ROLLBACK TO unlock_world; RELEASE unlock_world"
        };
        if let Err(error) = opened.and(c.execute_batch(end).map_err(sql_error)) {
            tracing::warn!(%error, "an unlocked avatar's world waits for a free slot");
        }
    }
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
    // Interrupted speech stays silent, with "…" in the view and no retry.
    for (play, room, text) in interrupted {
        let mut scene: Value = serde_json::from_str(&text).map_err(sql_error)?;
        let voices = scene["actor"]
            .as_str()
            .and_then(|actor| actor_index(actor).ok())
            .map(|actor| super::full_speech::voices(&scene, actor))
            .unwrap_or_default();
        if let Some(seq) = scene["events"].as_array().and_then(|events| {
            events
                .iter()
                .filter_map(|e| e["seq"].as_f64())
                .reduce(f64::max)
        }) {
            scene["after"] = json!(seq);
        }
        for key in ["context", "profiles", "events"] {
            scene
                .as_object_mut()
                .ok_or("The scene needs attention.")?
                .remove(key);
        }
        scene["lines"] = json!([]);
        if !voices.is_empty() {
            scene["silent"] = json!(voices);
        }
        scene["failed"] = json!(true);
        scene["starts_at"] = json!(now);
        scene["until_at"] = json!(now);
        c.execute(
            "INSERT OR IGNORE INTO card_full_scenes(world,room,play,content) VALUES(?,?,?,?)",
            params![id, room, play, scene.to_string()],
        )
        .map_err(sql_error)?;
        c.execute(
            "UPDATE card_full_plays SET status='done',result=? WHERE id=?",
            params![scene.to_string(), play],
        )
        .map_err(sql_error)?;
        // Late words for this play are dropped; its voices show "…".
        tracing::warn!(feature = "card_voice", %play, voices = voices.len(), "shared card words lease expired");
        crate::routes::card_game::narrative::voice_scenes::shared("expired", voices.len());
    }
    c.execute("UPDATE card_full_plays SET status='done' WHERE world=? AND status='playing' AND until_at<=?",params![id,now]).map_err(sql_error)?;
    Ok(())
}
pub(super) fn snapshot(c: &Connection, id: &str, user: &str, now: i64) -> Result<Value> {
    let w = world(c, id, now)?;
    let actor = store::member(c, id, user)?;
    // An owner can free even a released bound avatar (#1825). `holders` omits account IDs.
    let bound = super::bindings::bound(c, id)?;
    let holders = super::bindings::holders(c, id)?;
    let owner = super::bindings::owner(c, id, user)?;
    let Some(a) = actor else {
        let mine = super::bindings::mine(c, id, user)?.map(actor_id);
        // The seed names the world on a friend's link (#1877).
        let seed = name_seed(c, id)?;
        return Ok(
            json!({"id":id,"actor":null,"claimed":w.claimed,"bound":bound,"holders":holders,"mine":mine,"owner":owner,"seed":seed,"now":now,"version":w.version}),
        );
    };
    let a = usize::try_from(a)
        .ok()
        .filter(|a| *a < 8)
        .ok_or("The avatar claim needs attention.")?;
    let room = w.room(a)?;
    let here = w.present[a] == 1;
    let projected = w.project(a)?;
    // Only this avatar's committed plays count, even after their scenes leave recent history.
    let music_started: bool = c
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM card_full_log WHERE world=? AND json_extract(command,'$.actor')=? AND json_extract(command,'$.op')='play')",
            params![id, actor_id(a)],
            |r| r.get(0),
        )
        .map_err(sql_error)?;
    let mut q=c.prepare("SELECT id,actor,status,retries,coalesce(json_extract(narrative,'$.opening'),0) FROM card_full_plays WHERE world=? AND (room=? OR actor=?) AND status IN ('waiting','retry','working','playing') ORDER BY created,id").map_err(sql_error)?;
    let queue=q.query_map(params![id,room,a],|r|Ok(json!({"id":r.get::<_,String>(0)?,"actor":actor_id(r.get::<_,usize>(1)?),"status":r.get::<_,String>(2)?,"attempt":r.get::<_,i32>(3)?,"opening":r.get::<_,bool>(4)?}))).map_err(sql_error)?.collect::<std::result::Result<Vec<_>,_>>().map_err(sql_error)?;
    // Retain 100 action scene references, including silent plays, to voice older visible words.
    let mut q=c.prepare("SELECT content FROM card_full_scenes WHERE world=? AND room=? ORDER BY seq DESC LIMIT 100").map_err(sql_error)?;
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
        json!({"id":id,"version":w.version,"actor":actor_id(a),"music_started":music_started,"claimed":w.claimed,"bound":bound,"holders":holders,"owner":owner,"present":w.present,"world":projected["world"],"actions":projected["actions"],"exits":projected["exits"],"queue":if here{queue}else{vec![]},"history":history,"nudge":nudge.filter(|a|*a<8).map(actor_id),"now":now,"notice":notice}),
    )
}
pub(super) struct PlayRequest<'a> {
    pub action: Value,
    pub key: &'a str,
    pub revealed: Option<&'a [String]>,
    pub surface: &'a str,
}

fn take_surface(command: &mut Value) -> Option<Value> {
    command.as_object_mut()?.remove("surface")
}

pub(super) fn take_revealed(command: &mut Value) -> Option<Value> {
    command.as_object_mut()?.remove("revealed")
}

fn valid_reveal(ids: &[String]) -> bool {
    ids.len() <= 512
        && ids
            .iter()
            .all(|id| id.len() < 128 && crate::routes::card_game::narrative::known_card(id))
        && ids.iter().collect::<std::collections::BTreeSet<_>>().len() == ids.len()
}
/// Record a rejection or check its separate per-user budget, sized to the queued-play minute limit.
fn rejections(user: &str, record: bool) -> bool {
    use crate::rate_limit::{RateLimit, RateLimiter};
    use std::{
        sync::{Mutex, OnceLock, PoisonError},
        time::{Duration, Instant},
    };
    const LIMIT: RateLimit = RateLimit {
        max_hits: 24,
        window: Duration::from_secs(60),
    };
    static LIMITS: OnceLock<Mutex<RateLimiter>> = OnceLock::new();
    let mut limits = LIMITS
        .get_or_init(Default::default)
        .lock()
        .unwrap_or_else(PoisonError::into_inner);
    let key = format!("full-reject:{user}");
    if record {
        limits.allow(key, LIMIT, Instant::now());
        false
    } else {
        limits.spent(&key, LIMIT, Instant::now())
    }
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
    let PlayRequest {
        action,
        key,
        revealed,
        surface,
    } = play;
    if revealed.is_some_and(|ids| !valid_reveal(ids)) {
        return Err("Choose valid revealed cards.".into());
    }
    let mut command = json!({"op":"play","actor":actor_id(a),"action":action});
    command["surface"] = json!(surface);
    let old: Option<(String, String, String)> = c
        .query_row(
            "SELECT world,user,command FROM card_full_plays WHERE id=?",
            [key],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
        )
        .optional()
        .map_err(sql_error)?;
    if let Some((world, owner, prior)) = old {
        let mut prior: Value = serde_json::from_str(&prior).map_err(sql_error)?;
        take_revealed(&mut prior);
        return if world == id && owner == user && prior == command {
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
    let pending:i32=c.query_row("SELECT count(*) FROM card_full_plays WHERE world=? AND actor=? AND status IN ('waiting','retry','working','playing')",params![id,a],|r|r.get(0)).map_err(sql_error)?;
    if pending > 0 {
        return Err("Your play is already at the table.".into());
    }
    // Rejected plays leave no queue row, so budget probes that hold the shared writer lock separately.
    if rejections(user, false) {
        return Err("The table is resting for a moment. Try your play shortly.".into());
    }
    let mut probe = w.clone();
    let surface_field = take_surface(&mut command);
    let probe_result = probe.apply(&command);
    if let Some(surface) = surface_field {
        command["surface"] = surface;
    }
    if let Err(error) = probe_result {
        rejections(user, true);
        return Err(error);
    }
    let room = w.room(a)?;
    let count:i32=c.query_row("SELECT count(*) FROM card_full_plays WHERE world=? AND room=? AND status IN ('waiting','retry','working','playing')",params![id,room],|r|r.get(0)).map_err(sql_error)?;
    if count >= 4 {
        return Err("Four plays are at the table. Yours can follow shortly.".into());
    }
    // The queue keeps the first reveal snapshot until the worker removes it before rules and journaling.
    if let Some(revealed) = revealed {
        command["revealed"] = json!(revealed);
    }
    c.execute("INSERT INTO card_full_plays(id,world,actor,user,room,command,status,created) VALUES(?,?,?,?,?,?,'waiting',?)",params![key,id,a,user,room,command.to_string(),now]).map_err(sql_error)?;
    Ok(())
}
#[cfg(test)]
mod tests {
    use super::*;
    const T: i64 = 1_000_000;
    fn opened(version: &str, then: Option<Value>) -> Result<World> {
        let path =
            std::env::temp_dir().join(format!("card-newer-{}.sqlite", crate::random_hex(12)));
        let c = store::open(&path).unwrap();
        schema(&c).unwrap();
        let id = "a".repeat(48);
        store::create(&c, &id, "ann", T).unwrap();
        let mut w = World::create(None).unwrap();
        w.version = version.into();
        seed(&c, &id, &w, "test-create", T).unwrap();
        if let Some(command) = then {
            c.execute(
                "INSERT INTO card_full_log(world,command,at) VALUES(?,?,?)",
                params![id, command.to_string(), T],
            )
            .unwrap();
        }
        let opened = world(&c, &id, T + 1);
        let _ = std::fs::remove_file(path);
        opened
    }
    #[test]
    fn newer_rules_wait_for_the_swap_and_older_ones_are_closed() {
        let next = format!(
            "full-card-world/{}",
            engine::version()[16..].parse::<u32>().unwrap() + 1
        );
        let closed = floor::CLOSED;
        assert_eq!(opened(&next, None).unwrap_err(), engine::UPDATING);
        let play = json!({"op":"release","actor":"mara"});
        assert_eq!(opened(&next, Some(play)).unwrap_err(), engine::UPDATING);
        let upgrade = json!({"op":"upgrade","from":engine::version(),"to":next,"seed":1});
        assert_eq!(
            opened(engine::version(), Some(upgrade)).unwrap_err(),
            engine::UPDATING
        );
        assert_eq!(opened("full-card-world/1", None).unwrap_err(), closed);
        assert_eq!(opened("full-card-world/132", None).unwrap_err(), closed);
        assert_eq!(opened("full-card-world/x", None).unwrap_err(), closed);
        assert_eq!(opened("other-world/999", None).unwrap_err(), closed);
        assert!(opened(engine::version(), None).is_ok());
    }
}
