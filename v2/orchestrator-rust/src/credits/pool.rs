//! A shared world's credit pool (#1924). Any passkey may commit credits from
//! its balance to a world; commits are never withdrawn. The world's voices
//! and videos spend from the pool, once per line for the whole world.
use axum::{
    extract::{Query, State},
    http::{HeaderMap, StatusCode},
    response::Response,
    routing::{get, post},
    Json, Router,
};
use rusqlite::{params, Connection, OptionalExtension, TransactionBehavior};
use serde::Deserialize;
use serde_json::{json, Value};

use super::{insert, open, prices, reply, schema, sum, Payer};
use crate::AppState;

const MAX_COMMIT: i64 = 10_000;

#[derive(Debug, PartialEq, Eq)]
pub(crate) enum Commit {
    Committed { balance: i64, pool: i64 },
    Insufficient { balance: i64 },
}

/// Move credits into a world's pool once per request id; a repeat reports it.
pub(crate) fn commit(
    c: &mut Connection,
    user: &str,
    world: &str,
    credits: i64,
    request_id: &str,
) -> rusqlite::Result<Commit> {
    let tx = c.transaction_with_behavior(TransactionBehavior::Immediate)?;
    schema(&tx)?;
    let pool = Payer::World { world, by: user };
    let seen = tx
        .query_row(
            "SELECT 1 FROM credit_events WHERE user_id = ?1 AND request_id = ?2 AND kind = 'commit'",
            params![user, request_id],
            |_| Ok(()),
        )
        .optional()?
        .is_some();
    let balance = sum(&tx, Payer::Person(user))?;
    if seen {
        let pool = sum(&tx, pool)?;
        return Ok(Commit::Committed { balance, pool });
    }
    if balance < credits {
        return Ok(Commit::Insufficient { balance });
    }
    insert(&tx, pool, request_id, "commit", None, -credits, "")?;
    let committed = Commit::Committed {
        balance: balance - credits,
        pool: sum(&tx, pool)?,
    };
    tx.commit()?;
    Ok(committed)
}

/// The world's pool and its largest contributors by display name.
pub(crate) fn view(c: &Connection, world: &str) -> rusqlite::Result<Value> {
    schema(c)?;
    let pool = sum(c, Payer::World { world, by: "" })?;
    let mut q = c.prepare(
        "SELECT COALESCE(u.display_name, ''), -SUM(e.delta) AS credits
         FROM credit_events e LEFT JOIN auth_users u ON u.id = e.user_id
         WHERE e.world_id = ?1 AND e.kind = 'commit'
         GROUP BY e.user_id ORDER BY credits DESC, MIN(e.id) LIMIT 8",
    )?;
    let contributors = q
        .query_map(params![world], |row| {
            Ok(json!({"name": row.get::<_, String>(0)?, "credits": row.get::<_, i64>(1)?}))
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    Ok(json!({"world": world, "pool": pool, "contributors": contributors}))
}

pub(super) fn router() -> Router<AppState> {
    Router::new()
        .route("/card-game/credits/pool", get(pool_view))
        .route("/card-game/credits/commit", post(commit_route))
}

#[derive(Deserialize)]
struct WorldQuery {
    world: String,
}

fn valid(value: &str) -> bool {
    (1..=128).contains(&value.len())
        && value
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b"-_:.".contains(&b))
}

fn unavailable() -> Response {
    reply(
        StatusCode::SERVICE_UNAVAILABLE,
        json!({"error": "Credits need another moment."}),
    )
}

async fn pool_view(State(state): State<AppState>, Query(q): Query<WorldQuery>) -> Response {
    let Some(path) = state.event_store_path.clone().filter(|_| valid(&q.world)) else {
        return reply(
            StatusCode::BAD_REQUEST,
            json!({"error": "Choose a shared world."}),
        );
    };
    let result = tokio::task::spawn_blocking(move || -> Result<Value, String> {
        let c = open(&path).map_err(|e| e.to_string())?;
        view(&c, &q.world).map_err(|e| e.to_string())
    })
    .await;
    match result {
        Ok(Ok(mut body)) => {
            body["prices"] = prices();
            reply(StatusCode::OK, body)
        }
        _ => unavailable(),
    }
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct CommitRequest {
    world: String,
    credits: i64,
    request_id: String,
}

async fn commit_route(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(body): Json<CommitRequest>,
) -> Response {
    if headers
        .get("sec-fetch-site")
        .is_some_and(|v| v == "cross-site")
    {
        return reply(
            StatusCode::FORBIDDEN,
            json!({"error": "Open the card game on this site."}),
        );
    }
    let Some(user) = state
        .account_auth
        .authenticated_user_id(&headers)
        .ok()
        .flatten()
    else {
        return reply(
            StatusCode::UNAUTHORIZED,
            json!({"error": "Sign in with your passkey to commit credits.", "reason": "signed_out"}),
        );
    };
    if !(1..=MAX_COMMIT).contains(&body.credits) || !valid(&body.world) || !valid(&body.request_id)
    {
        return reply(
            StatusCode::BAD_REQUEST,
            json!({"error": "Commit 1-10000 credits to a shared world."}),
        );
    }
    let Some(path) = state.event_store_path.clone() else {
        return unavailable();
    };
    let result = tokio::task::spawn_blocking(move || -> Result<Option<(Commit, Value)>, String> {
        let mut c = open(&path).map_err(|e| e.to_string())?;
        let exists = "SELECT EXISTS(SELECT 1 FROM card_tables WHERE id = ?1)";
        if !c
            .query_row(exists, [&body.world], |r| r.get(0))
            .map_err(|e| e.to_string())?
        {
            return Ok(None);
        }
        let done = commit(&mut c, &user, &body.world, body.credits, &body.request_id)
            .map_err(|e| e.to_string())?;
        Ok(Some((
            done,
            view(&c, &body.world).map_err(|e| e.to_string())?,
        )))
    })
    .await;
    match result {
        Ok(Ok(Some((Commit::Insufficient { balance }, _)))) => reply(
            StatusCode::PAYMENT_REQUIRED,
            json!({"error": "Not enough credits to commit.", "reason": "credits", "balance": balance}),
        ),
        Ok(Ok(Some((Commit::Committed { balance, .. }, mut body)))) => {
            body["balance"] = json!(balance);
            reply(StatusCode::OK, body)
        }
        Ok(Ok(None)) => reply(
            StatusCode::NOT_FOUND,
            json!({"error": "No shared world by that id."}),
        ),
        _ => unavailable(),
    }
}

#[cfg(test)]
mod tests {
    use super::super::{balance, grant, refund, spend, Spend, SpendKind};
    use super::*;

    fn db() -> Connection {
        let c = Connection::open_in_memory().unwrap();
        c.execute_batch(
            "CREATE TABLE auth_users (id TEXT PRIMARY KEY, display_name TEXT NOT NULL);
             INSERT INTO auth_users VALUES ('u1', 'Moss'), ('u2', 'Fern');",
        )
        .unwrap();
        schema(&c).unwrap();
        c
    }

    fn pool<'a>(world: &'a str, by: &'a str) -> Payer<'a> {
        Payer::World { world, by }
    }

    #[test]
    fn a_commit_moves_credits_into_the_world_once() {
        let mut c = db();
        grant(&mut c, "u1", 100, "pack", "speech pack").unwrap();
        assert_eq!(
            commit(&mut c, "u1", "w1", 30, "c-1").unwrap(),
            Commit::Committed {
                balance: 70,
                pool: 30
            }
        );
        assert_eq!(
            commit(&mut c, "u1", "w1", 30, "c-1").unwrap(),
            Commit::Committed {
                balance: 70,
                pool: 30
            }
        );
        assert_eq!(
            commit(&mut c, "u1", "w1", 71, "c-2").unwrap(),
            Commit::Insufficient { balance: 70 }
        );
        grant(&mut c, "u2", 5, "gift", "test").unwrap();
        commit(&mut c, "u2", "w1", 5, "c-1").unwrap();
        assert_eq!(balance(&c, pool("w1", "")).unwrap(), 35);
        assert_eq!(balance(&c, pool("w2", "")).unwrap(), 0);
        assert_eq!(balance(&c, "u1").unwrap(), 70);
        assert_eq!(
            view(&c, "w1").unwrap()["contributors"],
            json!([{"name": "Moss", "credits": 30}, {"name": "Fern", "credits": 5}])
        );
    }

    #[test]
    fn the_pool_pays_each_line_once_for_every_player_and_takes_refunds() {
        let mut c = db();
        grant(&mut c, "u1", 100, "pack", "speech pack").unwrap();
        commit(&mut c, "u1", "w1", 2, "c-1").unwrap();
        assert_eq!(
            spend(&mut c, pool("w1", "u1"), SpendKind::Tts, "line-a").unwrap(),
            Spend::Spent { balance: 1 }
        );
        // Another player hearing the same line pays nothing more.
        assert_eq!(
            spend(&mut c, pool("w1", "u2"), SpendKind::Tts, "line-a").unwrap(),
            Spend::AlreadyPaid { balance: 1 }
        );
        assert_eq!(
            spend(&mut c, pool("w1", "u2"), SpendKind::Video, "film").unwrap(),
            Spend::Insufficient {
                balance: 1,
                price: 100
            }
        );
        spend(&mut c, pool("w1", "u2"), SpendKind::Tts, "line-b").unwrap();
        assert!(refund(&mut c, pool("w1", "u1"), SpendKind::Tts, "line-b", "503").unwrap());
        assert!(!refund(&mut c, pool("w1", "u1"), SpendKind::Tts, "line-b", "503").unwrap());
        assert_eq!(balance(&c, pool("w1", "")).unwrap(), 1);
        // The pool's spends never touch the players' own balances, and a
        // personal line with the same id is a different request.
        assert_eq!(
            (balance(&c, "u1").unwrap(), balance(&c, "u2").unwrap()),
            (98, 0)
        );
        assert_eq!(
            spend(&mut c, "u1", SpendKind::Tts, "line-a").unwrap(),
            Spend::Spent { balance: 97 }
        );
        assert_eq!(balance(&c, pool("w1", "")).unwrap(), 1);
    }
}
