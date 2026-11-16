use super::{
    super::store::{create, sql_error, Result},
    actor_id, admit, bindings, blocking, db, floor, leave, now, reply, store, turn, writer, World,
};
use crate::AppState;
use axum::{extract::State, http::HeaderMap, response::Response, Json};
use rusqlite::{params, Connection, TransactionBehavior};
use serde::Deserialize;
use serde_json::{json, Value};

const OWNER: &str = "discord-guild:";
pub(super) const IDLE_MS: i64 = 30 * 60_000;

fn owner(guild: &str) -> Result<String> {
    if (15..=20).contains(&guild.len()) && guild.bytes().all(|b| b.is_ascii_digit()) {
        Ok(format!("{OWNER}{guild}"))
    } else {
        Err("Name a Discord server.".into())
    }
}

pub(super) fn owned(c: &Connection, id: &str) -> Result<bool> {
    c.query_row(
        "SELECT EXISTS(SELECT 1 FROM card_tables WHERE id=? AND owner LIKE 'discord-guild:%')",
        [id],
        |r| r.get(0),
    )
    .map_err(sql_error)
}

pub(super) fn unbind(c: &Connection, id: &str, w: &World, a: usize) -> Result<()> {
    if let Some(holder) = bindings::holder(c, id, a)? {
        let progress = bindings::progress_of(&w.game, actor_id(a));
        bindings::save_progress(c, &holder, a, &progress)?;
    }
    bindings::free(c, id, a)
}

pub(super) fn free_idle(
    c: &Connection,
    id: &str,
    w: &mut World,
    but: &str,
    time: i64,
) -> Result<()> {
    if !owned(c, id)? {
        return Ok(());
    }
    let idle = {
        let mut q = c
            .prepare("SELECT actor FROM card_members WHERE world=? AND user<>? AND seen<?")
            .map_err(sql_error)?;
        let seats = q
            .query_map(params![id, but, time - IDLE_MS], |r| r.get::<_, usize>(0))
            .map_err(sql_error)?
            .collect::<std::result::Result<Vec<_>, _>>()
            .map_err(sql_error)?;
        seats
    };
    for a in idle.into_iter().filter(|a| *a < 8) {
        if w.claimed[a] == 1 && leave(c, id, w, a, "release", time).is_err() {
            continue;
        }
        c.execute(
            "DELETE FROM card_members WHERE world=? AND actor=?",
            params![id, a],
        )
        .map_err(sql_error)?;
        unbind(c, id, w, a)?;
    }
    Ok(())
}

pub(super) fn ensure(c: &Connection, guild: &str, time: i64) -> Result<String> {
    let owner = owner(guild)?;
    let live = {
        let mut q = c
            .prepare(
                "SELECT id FROM card_tables WHERE owner=? AND retired_at IS NULL \
                 ORDER BY created DESC, id",
            )
            .map_err(sql_error)?;
        let ids = q
            .query_map([&owner], |r| r.get::<_, String>(0))
            .map_err(sql_error)?
            .collect::<std::result::Result<Vec<_>, _>>()
            .map_err(sql_error)?;
        ids
    };
    for id in live {
        if !floor::retire(c, &id, time)? {
            return Ok(id);
        }
    }
    let id = crate::random_hex(24);
    let seed = super::super::full_world::run_seed(&id);
    let w = World::hiding(None, Some(seed), &Value::Null)?;
    create(c, &id, &owner, time)?;
    store::seed(c, &id, &w, "discord-guild-world", time)?;
    Ok(id)
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub(super) struct Ensure {
    guild: String,
}

fn authorized(h: &HeaderMap) -> bool {
    let token = std::env::var("COSYWORLD_BOT_TOKEN").ok();
    let expected = token.as_deref().filter(|token| token.len() >= 32);
    crate::moderation::moderation_authorized_token(expected, h)
}

pub(super) async fn route(
    State(state): State<AppState>,
    h: HeaderMap,
    Json(body): Json<Ensure>,
) -> Response {
    reply(
        blocking(move || {
            if !authorized(&h) {
                return Err("Sign in with your passkey.".into());
            }
            admit("discord-guild")?;
            let mut c = db(&state)?;
            store::schema(&c)?;
            let gate = writer(&state);
            let _turn = turn(&gate);
            let tx = c
                .transaction_with_behavior(TransactionBehavior::Immediate)
                .map_err(sql_error)?;
            let id = ensure(&tx, &body.guild, now())?;
            tx.commit().map_err(sql_error)?;
            Ok(json!({"id": id, "path": format!("/?world={id}")}))
        })
        .await,
    )
}

#[cfg(test)]
mod tests {
    use super::super::{super::store as tables, retire, run as play, Command};
    use super::*;

    const T: i64 = 1_000_000;
    const GUILD: &str = "100000000000000001";

    fn open() -> (std::path::PathBuf, Connection) {
        let path =
            std::env::temp_dir().join(format!("card-guild-{}.sqlite", crate::random_hex(12)));
        let c = tables::open(&path).unwrap();
        store::schema(&c).unwrap();
        (path, c)
    }
    fn op(op: &str, avatar: Option<&str>) -> Command {
        Command {
            op: op.into(),
            avatar: avatar.map(str::to_string),
            action: Value::Null,
            target: None,
            key: String::new(),
            moving: false,
            surface: "browser".to_string(),
            revealed: None,
        }
    }

    #[test]
    fn each_server_gets_one_world_and_keeps_it() {
        let (_, c) = open();
        let id = ensure(&c, GUILD, T).unwrap();
        assert_eq!(ensure(&c, GUILD, T + 1).unwrap(), id);
        assert_ne!(ensure(&c, "100000000000000002", T).unwrap(), id);
        assert!(owned(&c, &id).unwrap());
        assert!(store::world(&c, &id, T).is_ok());
        for bad in [
            "",
            "12345",
            "not-a-server-id-0001",
            "1000000000000000019999",
        ] {
            assert!(ensure(&c, bad, T).is_err(), "{bad}");
        }
    }

    #[test]
    fn an_empty_server_world_stays_and_a_released_seat_is_free() {
        let (_, c) = open();
        let id = ensure(&c, GUILD, T).unwrap();
        play(&c, &id, "ann", &op("claim", Some("mara")), T).unwrap();
        let taken = play(&c, &id, "bob", &op("claim", Some("mara")), T).unwrap_err();
        assert_eq!(taken, "That avatar belongs to someone else in this world.");
        play(&c, &id, "ann", &op("release", None), T + 1).unwrap();
        assert!(retire::open(&c, &id).is_ok());
        assert!(retire::pending(&c, &owner(GUILD).unwrap())
            .unwrap()
            .is_empty());
        assert!(!retire::if_empty(&c, &id, &owner(GUILD).unwrap(), T + 2).unwrap());
        play(&c, &id, "bob", &op("claim", Some("mara")), T + 3).unwrap();
        assert_eq!(ensure(&c, GUILD, T + 4).unwrap(), id);
        assert!(!owned(&c, "none").unwrap());
    }

    fn seat(c: &Connection, id: &str, user: &str) -> Option<usize> {
        bindings::mine(c, id, user).unwrap()
    }
    fn kept(c: &Connection, id: &str, time: i64) -> (Value, Vec<String>, Value) {
        let game = store::world(c, id, time).unwrap().game;
        let items = game["items"].as_object().unwrap().iter();
        let held = items.filter(|(_, item)| item["holder"] == "mara");
        (
            game["actors"]["mara"]["place"].clone(),
            held.map(|(id, _)| id.clone()).collect(),
            game["turn"].clone(),
        )
    }

    #[test]
    fn an_idle_seat_in_a_server_world_frees_itself_and_nothing_else_moves() {
        let (_, c) = open();
        let id = ensure(&c, GUILD, T).unwrap();
        play(&c, &id, "ann", &op("claim", Some("mara")), T).unwrap();
        play(&c, &id, "ann", &op("leave", None), T + 1).unwrap();
        play(&c, &id, "bob", &op("claim", Some("ash")), T + 1000).unwrap();
        assert!(seat(&c, &id, "ann").is_some());
        let before = kept(&c, &id, T + 1000);
        play(&c, &id, "bob", &op("heartbeat", None), T + IDLE_MS).unwrap();
        assert_eq!(seat(&c, &id, "ann"), None);
        assert_eq!(tables::member(&c, &id, "ann").unwrap(), None);
        let after = T + 3 * IDLE_MS;
        assert_eq!(kept(&c, &id, after), before);
        let alone = play(&c, &id, "bob", &op("heartbeat", None), after).unwrap();
        assert_eq!(alone["actor"], "ash");
        play(&c, &id, "ann", &op("claim", Some("mara")), after + 1).unwrap();
        assert!(seat(&c, &id, "ann").is_some() && seat(&c, &id, "bob").is_some());
    }

    #[test]
    fn an_idle_seat_in_a_persons_own_world_stays() {
        let (_, c) = open();
        let id = "a".repeat(48);
        create(&c, &id, "ann", T).unwrap();
        store::seed(&c, &id, &World::create(None).unwrap(), "test-create", T).unwrap();
        play(&c, &id, "bob", &op("claim", Some("ash")), T).unwrap();
        play(&c, &id, "ann", &op("claim", Some("mara")), T + 3 * IDLE_MS).unwrap();
        assert!(seat(&c, &id, "bob").is_some());
        assert!(tables::member(&c, &id, "bob").unwrap().is_some());
    }

    #[test]
    fn a_world_below_the_rules_floor_is_replaced_by_a_fresh_one() {
        let (_, c) = open();
        let mut w = World::create(None).unwrap();
        w.version = "full-card-world/132".into();
        create(&c, "old", &owner(GUILD).unwrap(), T).unwrap();
        store::seed(&c, "old", &w, "test-old-world", T).unwrap();
        let id = ensure(&c, GUILD, T + 1).unwrap();
        assert_ne!(id, "old");
        assert!(retire::open(&c, "old").is_err());
        assert!(store::world(&c, &id, T + 1).is_ok());
        assert_eq!(ensure(&c, GUILD, T + 2).unwrap(), id);
    }

    #[tokio::test]
    async fn a_request_without_the_bot_token_is_refused() {
        let (path, _c) = open();
        let state = crate::test_app_state(Some(path));
        let body = Ensure {
            guild: GUILD.into(),
        };
        let response = route(State(state), HeaderMap::new(), Json(body)).await;
        assert_eq!(response.status(), axum::http::StatusCode::UNAUTHORIZED);
    }
}
