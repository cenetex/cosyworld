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
    ")
}
fn checkpoint(c: &Connection, id: &str, w: &World, seq: i64) -> Result<()> {
    c.execute("INSERT INTO card_full_checkpoints(world,seq,state) VALUES(?,?,?) ON CONFLICT(world) DO UPDATE SET seq=excluded.seq,state=excluded.state",params![id,seq,serde_json::to_string(w).map_err(sql_error)?]).map_err(sql_error)?;
    Ok(())
}
// The world's run seed, which names it; a world saved before seeds uses its id's.
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
pub(super) fn world(c: &Connection, id: &str, now: i64) -> Result<World> {
    store::exists(c, id)?;
    // Rules older than the floor are never replayed (full_floor.rs).
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
    let (mut seq, mut state) = match cached {
        Some((seq, state)) => (
            seq,
            Some(serde_json::from_str::<World>(&state).map_err(sql_error)?),
        ),
        None => (0, None),
    };
    if let Some(pack) = state.as_ref().and_then(|w| w.pack.as_deref()) {
        content::preload(c, pack)?;
    }
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
            let seeded: World =
                serde_json::from_value(command["state"].clone()).map_err(sql_error)?;
            if let Some(pack) = seeded.pack.as_deref() {
                content::preload(c, pack)?;
            }
            state = Some(seeded);
        } else {
            // Replay reads each recorded content revision from the store.
            let pack = match command["op"].as_str() {
                Some("repack") => command["to"].as_str(),
                _ => command["pack"].as_str(),
            };
            if let Some(pack) = pack {
                content::preload(c, pack)?;
            }
            state
                .as_mut()
                .ok_or("This world's history needs its first record.")?
                .apply(&command)?;
        }
        seq = s;
    }
    if let Some(mut w) = state {
        if engine::historical(&w.version) {
            let from = w.version.clone();
            let mut upgrade =
                json!({"op":"upgrade", "from":from, "to":engine::VERSION, "seed":run_seed(id)});
            if engine::takes_content(engine::VERSION) {
                content::save(c)?;
                upgrade["pack"] = json!(content::current());
            }
            commit(c, id, &mut w, upgrade, now)?;
            return Ok(w);
        }
        if engine::newer(&w.version) {
            return Err(engine::UPDATING.into());
        }
        if w.version != engine::VERSION {
            return Err("This world's rules need a saved migration.".into());
        }
        if engine::takes_content(&w.version) && w.pack.as_deref() != Some(content::current()) {
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
    let result = engine::reduce(
        json!({"op":"migrate","legacy":old,"legacyScenes":legacy_scenes,"seed":run_seed(id)}),
    )?;
    let w = World {
        version: engine::VERSION.into(),
        game: result["world"].clone(),
        claimed: old.claimed,
        present: [0; 8],
        pack: engine::takes_content(engine::VERSION).then(|| content::current().into()),
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
    commit_with_reveal(c, id, w, command, None, now)
}

pub(super) fn commit_with_reveal(
    c: &Connection,
    id: &str,
    w: &mut World,
    command: Value,
    revealed: Option<Value>,
    now: i64,
) -> Result<Value> {
    let mut result = w.apply(&command)?;
    c.execute(
        "INSERT INTO card_full_log(world,command,at) VALUES(?,?,?)",
        params![id, command.to_string(), now],
    )
    .map_err(sql_error)?;
    let seq = c.last_insert_rowid();
    checkpoint(c, id, w, seq)?;
    // A committed play's dialogue context comes from the narrator, never the
    // rules. Replay applies commands directly and never asks for it.
    // The play is already journaled, so nothing here may return an error.
    if command["op"] == "play" {
        let Ok(a) = actor_index(command["actor"].as_str().unwrap_or_default()) else {
            return Ok(result);
        };
        // Each seat's passkey keeps any upgrade the play gave (#1873). A
        // gift or trade can upgrade a traveler other than the one who played.
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
// A Talk that met the hidden avatar unlocks it for the talker's passkey and
// opens that avatar's own world, which hides the next (#1936). With all
// eight world slots used, the unlock stays and the world waits.
fn unlock(c: &Connection, id: &str, result: &Value, seq: i64, now: i64) {
    let found = super::unlocks::record(c, id, result, seq).unwrap_or_else(|error| {
        tracing::error!(%error, "could not record an unlock");
        vec![]
    });
    for (user, a) in found {
        // A world that cannot open leaves nothing half-made behind.
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
    // Words cut off with their worker are silence like any failed words:
    // the play's voices show "…" and nothing waits or retries.
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
    // Bound avatars belong to someone even while released; the owner may
    // free one (#1825). `holders` names each holder without their id.
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
    // A committed play belongs to this avatar even after its scene leaves the
    // recent history. Claims, queued plays and other avatars keep this false.
    let music_started: bool = c
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM card_full_log WHERE world=? AND json_extract(command,'$.actor')=? AND json_extract(command,'$.op')='play')",
            params![id, actor_id(a)],
            |r| r.get(0),
        )
        .map_err(sql_error)?;
    let mut q=c.prepare("SELECT id,actor,status,coalesce(json_extract(narrative,'$.browser_chat'),0),retries,coalesce(json_extract(narrative,'$.opening'),0) FROM card_full_plays WHERE world=? AND (room=? OR actor=?) AND status IN ('waiting','retry','working','playing') ORDER BY created,id").map_err(sql_error)?;
    let queue=q.query_map(params![id,room,a],|r|Ok(json!({"id":r.get::<_,String>(0)?,"actor":actor_id(r.get::<_,usize>(1)?),"status":r.get::<_,String>(2)?,"browser_chat":r.get::<_,bool>(3)?,"attempt":r.get::<_,i32>(4)?,"opening":r.get::<_,bool>(5)?}))).map_err(sql_error)?.collect::<std::result::Result<Vec<_>,_>>().map_err(sql_error)?;
    // Silent plays also occupy scenes. Keep references through the rules'
    // 100 retained action entries, so visible older words can still be voiced.
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
/// Rejected plays per user, matching the queued-play minute limit. With
/// `record`, count one rejection; without it, report whether the budget is spent.
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
    } = play;
    if revealed.is_some_and(|ids| !valid_reveal(ids)) {
        return Err("Choose valid revealed cards.".into());
    }
    let mut command = json!({"op":"play","actor":actor_id(a),"action":action});
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
    // The probe is a full rules run under the shared writer lock, and a
    // rejected play leaves no row for the limits above to count. Spend a
    // per-user budget on rejections so they cannot keep that lock busy.
    if rejections(user, false) {
        return Err("The table is resting for a moment. Try your play shortly.".into());
    }
    let mut probe = w.clone();
    if let Err(error) = probe.apply(&command) {
        rejections(user, true);
        return Err(error);
    }
    let room = w.room(a)?;
    let count:i32=c.query_row("SELECT count(*) FROM card_full_plays WHERE world=? AND room=? AND status IN ('waiting','retry','working','playing')",params![id,room],|r|r.get(0)).map_err(sql_error)?;
    if count >= 4 {
        return Err("Four plays are at the table. Yours can follow shortly.".into());
    }
    // The first accepted reveal snapshot stays with this queue entry. The
    // worker takes it out before the action reaches the rules and journal.
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
    // A world whose saved rules read `version`, opened by this server.
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
            engine::VERSION[16..].parse::<u32>().unwrap() + 1
        );
        let closed = floor::CLOSED;
        // The release swap: a newer checkpoint, a newer play, a newer upgrade.
        assert_eq!(opened(&next, None).unwrap_err(), engine::UPDATING);
        let play = json!({"op":"release","actor":"mara"});
        assert_eq!(opened(&next, Some(play)).unwrap_err(), engine::UPDATING);
        let upgrade = json!({"op":"upgrade","from":engine::VERSION,"to":next,"seed":1});
        assert_eq!(
            opened(engine::VERSION, Some(upgrade)).unwrap_err(),
            engine::UPDATING
        );
        // Rules older than the floor, or unreadable, are closed (full_floor.rs).
        assert_eq!(opened("full-card-world/1", None).unwrap_err(), closed);
        assert_eq!(opened("full-card-world/132", None).unwrap_err(), closed);
        assert_eq!(opened("full-card-world/x", None).unwrap_err(), closed);
        assert_eq!(opened("other-world/999", None).unwrap_err(), closed);
        assert!(opened(engine::VERSION, None).is_ok());
    }
}
