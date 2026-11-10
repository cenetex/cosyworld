use super::*;
use crate::{test_support::test_app_state, RuntimeWorld};
use axum::{body::Body, http::Request};
use tower::ServiceExt;

const TODAY: i64 = 20_394;

fn batch(body: serde_json::Value) -> Option<Batch> {
    parse(body.to_string().as_bytes(), TODAY)
}

#[test]
fn only_allowlisted_counters_within_caps_on_a_near_day_are_accepted() {
    let ok = batch(json!({"day": TODAY, "counters": {"play.talk": 3, "travel": 0}})).unwrap();
    assert_eq!(
        ok.counters.into_iter().collect::<Vec<_>>(),
        vec![("play.talk".into(), 3)]
    );
    assert!(batch(json!({"day": TODAY - 1, "counters": {"defeat": 1}})).is_some());
    for refused in [
        json!({"day": TODAY, "counters": {"play.talk": 1, "who.am.i": 1}}),
        json!({"day": TODAY, "counters": {"play.talk": MAX_COUNT + 1}}),
        json!({"day": TODAY, "counters": {"play.talk": -1}}),
        json!({"day": TODAY - 2, "counters": {"play.talk": 1}}),
        json!({"day": TODAY + 2, "counters": {"play.talk": 1}}),
        // No identifiers or text ride along: unknown fields refuse the batch.
        json!({"day": TODAY, "counters": {}, "session": "abc"}),
        json!({"day": TODAY, "counters": {}, "world": "w1"}),
        json!({"day": TODAY, "counters": {"play.talk": "hello"}}),
        json!({"counters": {"play.talk": 1}}),
    ] {
        assert!(batch(refused.clone()).is_none(), "{refused}");
    }
    assert!(parse(b"not json", TODAY).is_none());
}

#[test]
fn totals_add_up_per_day_and_old_days_are_purged() {
    let mut conn = Connection::open_in_memory().unwrap();
    let old = batch(json!({"day": TODAY, "counters": {"play.talk": 2}})).unwrap();
    store(&mut conn, &old, TODAY - RETENTION_DAYS - 1).unwrap();
    store(&mut conn, &old, TODAY).unwrap();
    store(&mut conn, &old, TODAY).unwrap();
    let total: i64 = conn
        .query_row(
            "SELECT SUM(count) FROM play_metrics_daily WHERE day = ?1",
            [TODAY],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(total, 6);
    conn.execute(
        "INSERT INTO play_metrics_daily VALUES (?1, 'travel', 9), (?2, 'travel', 4)",
        params![TODAY - RETENTION_DAYS - 1, TODAY - RETENTION_DAYS],
    )
    .unwrap();
    store(&mut conn, &old, TODAY).unwrap();
    let days: Vec<i64> = conn
        .prepare("SELECT DISTINCT day FROM play_metrics_daily ORDER BY day")
        .unwrap()
        .query_map([], |r| r.get(0))
        .unwrap()
        .map(Result::unwrap)
        .collect();
    assert_eq!(days, vec![TODAY - RETENTION_DAYS, TODAY]);
    let summary = read_summary(&conn, TODAY).unwrap();
    assert_eq!(
        summary,
        vec![json!({"day": TODAY, "counters": {"play.talk": 8}})]
    );
}

fn post_metrics(body: impl Into<Body>, site: &str) -> Request<Body> {
    let mut request = Request::post("/card-game/metrics")
        .header("content-type", "text/plain")
        .header("host", "localhost")
        .header("sec-fetch-site", site)
        .body(body.into())
        .unwrap();
    request
        .extensions_mut()
        .insert(ConnectInfo("127.0.0.1:1234".parse::<SocketAddr>().unwrap()));
    request
}

#[tokio::test]
async fn the_endpoint_refuses_bad_batches_limits_clients_and_keeps_no_identity() {
    let path = std::env::temp_dir().join(format!(
        "cosyworld-play-metrics-{}-{}.sqlite",
        std::process::id(),
        now_millis()
    ));
    let state = test_app_state(RuntimeWorld::empty(), Some(path.clone()));
    let app = router().with_state(state);
    let today = utc_day(now_millis());
    let good = json!({"day": today, "counters": {"play.talk": 1, "session.start": 1}}).to_string();
    let send = |body: String, site: &'static str| {
        let app = app.clone();
        async move {
            app.oneshot(post_metrics(body, site))
                .await
                .unwrap()
                .status()
        }
    };
    assert_eq!(
        send(good.clone(), "cross-site").await,
        StatusCode::FORBIDDEN
    );
    assert_eq!(
        send(good.clone(), "same-origin").await,
        StatusCode::NO_CONTENT
    );
    let unknown = json!({"day": today, "counters": {"nope": 1}}).to_string();
    assert_eq!(send(unknown, "same-origin").await, StatusCode::BAD_REQUEST);
    let huge = format!(
        "{{\"day\":{today},\"counters\":{{}},\"pad\":\"{}\"}}",
        "x".repeat(5000)
    );
    assert_eq!(
        send(huge, "same-origin").await,
        StatusCode::PAYLOAD_TOO_LARGE
    );
    let mut limited = false;
    for _ in 0..METRICS_LIMIT.max_hits {
        limited |= send(good.clone(), "same-origin").await == StatusCode::TOO_MANY_REQUESTS;
    }
    assert!(limited, "a client is rate-limited within one window");

    // The table holds only day, name and count.
    let conn = Connection::open(&path).unwrap();
    let columns: Vec<String> = conn
        .prepare("SELECT name FROM pragma_table_info('play_metrics_daily')")
        .unwrap()
        .query_map([], |r| r.get(0))
        .unwrap()
        .map(Result::unwrap)
        .collect();
    assert_eq!(columns, ["day", "name", "count"]);

    let summary = Request::get("/moderation/play-metrics")
        .body(Body::empty())
        .unwrap();
    assert_eq!(
        app.oneshot(summary).await.unwrap().status(),
        StatusCode::FORBIDDEN
    );
    drop(conn);
    let _ = std::fs::remove_file(path);
}
