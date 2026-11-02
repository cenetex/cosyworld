//! Signed callback hints are durable before acknowledgment; only provider GETs settle credits.
use super::*;
use axum::body::Bytes;

#[derive(Clone, Default)]
pub(super) enum Config {
    #[default]
    Disabled,
    Enabled {
        origin: String,
        secret: String,
    },
    Invalid,
}

impl Config {
    pub(super) fn from_env() -> Self {
        // An explicitly non-Unicode value is invalid, not an unset option.
        let read = |key| std::env::var_os(key).map(|v| v.into_string().unwrap_or_default());
        let origin = read("COSYWORLD_VIDEO_CALLBACK_ORIGIN");
        let secret = read("COSYWORLD_VIDEO_WEBHOOK_SECRET");
        Self::parse(origin.as_deref(), secret.as_deref())
    }

    fn parse(origin: Option<&str>, secret: Option<&str>) -> Self {
        let (Some(origin), Some(secret)) = (origin, secret) else {
            return if origin.is_none() && secret.is_none() {
                Self::Disabled
            } else {
                Self::Invalid
            };
        };
        let Ok(url) = reqwest::Url::parse(origin) else {
            return Self::Invalid;
        };
        if url.scheme() != "https"
            || origin.strip_suffix('/').unwrap_or(origin) != url.origin().ascii_serialization()
            || secret.len() < 32
            || secret.trim().is_empty()
        {
            return Self::Invalid;
        }
        Self::Enabled {
            origin: url.origin().ascii_serialization(),
            secret: secret.into(),
        }
    }

    pub(super) fn target(&self) -> Result<Option<(String, String)>, ()> {
        match self {
            Self::Disabled => Ok(None),
            Self::Invalid => Err(()),
            Self::Enabled { origin, .. } => {
                let token = crate::random_hex(32);
                let url = format!("{origin}/internal/video/callback/{token}");
                Ok(Some((token, url)))
            }
        }
    }
}

fn mac(secret: &str, timestamp: &str, body: &[u8]) -> [u8; 32] {
    let mut signed = format!("{timestamp},").into_bytes(); // OpenRouter uses a comma, not Stripe's dot.
    signed.extend_from_slice(body);
    credits::stripe::hmac_sha256(secret.as_bytes(), &signed)
}

fn verified(secret: &str, signature: &str, body: &[u8], now: u64) -> Option<()> {
    let fields: Vec<_> = signature
        .split(',')
        .map(|p| p.trim().split_once('='))
        .collect::<Option<_>>()?;
    if fields.len() != 2 {
        return None;
    }
    let timestamp = fields.iter().find(|(k, _)| *k == "t")?.1;
    let hash = fields.iter().find(|(k, _)| *k == "v1")?.1;
    if now.abs_diff(timestamp.parse().ok()?) > 300 || hash.len() != 64 {
        return None;
    }
    let expected: String = mac(secret, timestamp, body)
        .iter()
        .map(|b| format!("{b:02x}"))
        .collect();
    (expected
        .bytes()
        .zip(hash.bytes())
        .fold(0, |diff, (a, b)| diff | (a ^ b))
        == 0)
        .then_some(())
}

pub(super) async fn receive(
    State(state): State<AppState>,
    Extension(config): Extension<Config>,
    Path(token): Path<String>,
    headers: HeaderMap,
    body: Bytes,
) -> Response {
    let Config::Enabled { secret, .. } = config else {
        return StatusCode::SERVICE_UNAVAILABLE.into_response();
    };
    let signature = headers
        .get("X-OpenRouter-Signature")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("");
    if verified(&secret, signature, &body, crate::util::now_unix_secs()).is_none() {
        return StatusCode::UNAUTHORIZED.into_response();
    }
    let Ok(event) = serde_json::from_slice::<Value>(&body) else {
        return StatusCode::BAD_REQUEST.into_response();
    };
    let status = event["data"]["status"].as_str().unwrap_or("");
    let job = event["data"]["id"].as_str().unwrap_or("");
    if !matches!(status, "completed" | "failed" | "cancelled" | "expired")
        || event["type"] != format!("video.generation.{status}")
        || job.is_empty()
        || job.len() > 200
    {
        return StatusCode::BAD_REQUEST.into_response();
    }
    if token.len() != 64 || !token.bytes().all(|b| b.is_ascii_hexdigit()) {
        return StatusCode::NOT_FOUND.into_response();
    }
    let Some(path) = state.event_store_path.as_ref() else {
        return StatusCode::SERVICE_UNAVAILABLE.into_response();
    };
    let job = job.to_owned();
    match store(path, move |c| record(c, &token, &job)).await {
        Ok(status) => status.into_response(),
        Err(response) => response,
    }
}

fn record(c: &mut rusqlite::Connection, token: &str, job: &str) -> rusqlite::Result<StatusCode> {
    let tx = c.transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)?;
    let row: Option<(String, String, String)> = tx
        .query_row(
            "SELECT r.job_id, b.job_hint, r.state
        FROM credit_video_callbacks b JOIN credit_video_requests r USING (payer, request_id)
        WHERE b.token = ?1",
            [token],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
        )
        .optional()?;
    let Some((known, hint, state)) = row else {
        return Ok(StatusCode::NOT_FOUND);
    };
    if (!known.is_empty() && known != job)
        || (!hint.is_empty() && hint != job)
        || (known.is_empty() && !matches!(state.as_str(), "submitting" | "submission_unknown"))
    {
        tx.execute("UPDATE credit_video_requests SET state = 'submission_conflict', detail = ?2
            WHERE (payer, request_id) = (SELECT payer, request_id FROM credit_video_callbacks WHERE token = ?1)
            AND state IN ('submitting', 'submission_unknown', 'submitted')",
            params![token, format!("Conflicting video receipts: known={known}, hinted={hint}, received={job}")])?;
        tx.commit()?;
        return Ok(StatusCode::CONFLICT);
    }
    if !receipts::terminal(&state) {
        tx.execute(
            "UPDATE credit_video_callbacks SET job_hint = ?2 WHERE token = ?1",
            params![token, job],
        )?;
    }
    tx.commit()?;
    Ok(StatusCode::NO_CONTENT)
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::{body::Body, http::Request};
    use tower::ServiceExt;
    const SECRET: &str = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

    fn signature(time: u64, body: &[u8]) -> String {
        let hash: String = mac(SECRET, &time.to_string(), body)
            .iter()
            .map(|b| format!("{b:02x}"))
            .collect();
        format!("t={time},v1={hash}")
    }

    #[tokio::test]
    async fn callbacks_are_authenticated_durable_and_bound_to_one_reservation() {
        let path = std::env::temp_dir().join(format!("callback-{}.sqlite", crate::random_hex(8)));
        let mut c = credits::open(&path).unwrap();
        jobs(&c).unwrap();
        credits::grant(&mut c, "u1", 200, "pack", "").unwrap();
        let body = json!({"model": MODEL, "prompt": "scene"});
        let config = Config::parse(Some("https://site.test/"), Some(SECRET));
        let target = config.target().unwrap().unwrap();
        let token = target.0.clone();
        for proposed in [Some(target.clone()), config.target().unwrap()] {
            reservations::reserve_with_callback(&mut c, "u1", "", "film-1234", &body, proposed)
                .unwrap();
        }
        assert_eq!(
            c.query_row("SELECT url FROM credit_video_callbacks", [], |r| r
                .get::<_, String>(0))
                .unwrap(),
            target.1
        );
        assert!(reservations::claim(&c, "u1", "", "film-1234").unwrap());
        let state =
            crate::test_support::test_app_state(crate::RuntimeWorld::seeded(), Some(path.clone()));
        let app = router_with_callbacks(config).with_state(state);
        let event =
            json!({"type":"video.generation.failed", "data":{"id":"job-1", "status":"failed"}})
                .to_string();
        let now = crate::util::now_unix_secs();
        let send = |payload: &str, sig: &str| {
            app.clone().oneshot(
                Request::post(format!("/internal/video/callback/{token}"))
                    .header("X-OpenRouter-Signature", sig)
                    .body(Body::from(payload.to_owned()))
                    .unwrap(),
            )
        };
        assert_eq!(
            send(&event, "broken").await.unwrap().status(),
            StatusCode::UNAUTHORIZED
        );
        for _ in 0..2 {
            assert_eq!(
                send(&event, &signature(now, event.as_bytes()))
                    .await
                    .unwrap()
                    .status(),
                StatusCode::NO_CONTENT
            );
        }
        let other = event.replace("job-1", "job-2");
        assert_eq!(
            send(&other, &signature(now, other.as_bytes()))
                .await
                .unwrap()
                .status(),
            StatusCode::CONFLICT
        );
        assert!(!reservations::finish(
            &mut c,
            "u1",
            "",
            "film-1234",
            "rejected",
            "",
            "contradiction"
        )
        .unwrap());
        drop(c);
        let c = credits::open(&path).unwrap();
        assert_eq!(
            c.query_row("SELECT job_hint FROM credit_video_callbacks", [], |r| {
                r.get::<_, String>(0)
            })
            .unwrap(),
            "job-1"
        );
        assert_eq!(
            reservations::get(&c, "u1", "", "film-1234")
                .unwrap()
                .unwrap()
                .2,
            "submission_conflict"
        );
        assert_eq!(
            credits::balance(&c, "u1").unwrap(),
            100,
            "callback alone cannot refund"
        );
        let _ = std::fs::remove_file(path);
    }

    #[test]
    fn exact_raw_bytes_comma_and_bounded_timestamps_are_required() {
        let reference =
            "t=1234,v1=2f2e167a4998a38c638e08808d690a6ed162fbedbcdeefc466c105307bc647ac";
        assert!(verified(SECRET, reference, br#"{"a":1}"#, 1234).is_some());
        assert!(verified(SECRET, reference, br#"{ "a":1}"#, 1234).is_none());
        for time in [933, 1535, u64::MAX] {
            assert!(verified(SECRET, reference, br#"{"a":1}"#, time).is_none());
        }
        for origin in [
            "http://site.test",
            "https://site.test/path",
            "https://u@site.test",
            "https://site.test?x=1",
            "https://site.test#x",
        ] {
            assert!(matches!(
                Config::parse(Some(origin), Some(SECRET)),
                Config::Invalid
            ));
        }
        for (origin, secret) in [
            (None, Some(SECRET)),
            (Some("https://site.test"), None),
            (Some("https://site.test"), Some("short")),
            (
                Some("https://site.test"),
                Some("                                "),
            ),
        ] {
            assert!(matches!(Config::parse(origin, secret), Config::Invalid));
        }
        assert!(matches!(Config::parse(None, None), Config::Disabled));
    }

    #[tokio::test]
    async fn malformed_stale_future_oversized_and_unknown_callbacks_are_rejected() {
        let path =
            std::env::temp_dir().join(format!("callback-invalid-{}.sqlite", crate::random_hex(8)));
        let state =
            crate::test_support::test_app_state(crate::RuntimeWorld::seeded(), Some(path.clone()));
        let app = router_with_callbacks(Config::parse(Some("https://site.test"), Some(SECRET)))
            .with_state(state);
        let token = "b".repeat(64);
        let event =
            json!({"type":"video.generation.failed","data":{"id":"job", "status":"failed"}})
                .to_string();
        let now = crate::util::now_unix_secs();
        for (payload, sig, expected) in [
            (
                event.clone(),
                signature(now - 301, event.as_bytes()),
                StatusCode::UNAUTHORIZED,
            ),
            (
                event.clone(),
                signature(now + 301, event.as_bytes()),
                StatusCode::UNAUTHORIZED,
            ),
            ("{".into(), signature(now, b"{"), StatusCode::BAD_REQUEST),
            ("{}".into(), signature(now, b"{}"), StatusCode::BAD_REQUEST),
            (
                "x".repeat(65537),
                String::new(),
                StatusCode::PAYLOAD_TOO_LARGE,
            ),
            (
                event.clone(),
                signature(now, event.as_bytes()),
                StatusCode::NOT_FOUND,
            ),
        ] {
            let response = app
                .clone()
                .oneshot(
                    Request::post(format!("/internal/video/callback/{token}"))
                        .header("X-OpenRouter-Signature", sig)
                        .body(Body::from(payload))
                        .unwrap(),
                )
                .await
                .unwrap();
            assert_eq!(response.status(), expected);
        }
        let _ = std::fs::remove_file(path);
    }

    #[tokio::test]
    async fn signed_hints_recover_lost_submit_receipts_before_response_and_after_restart() {
        use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
        use sha2::{Digest, Sha256};
        use std::sync::{
            atomic::{AtomicUsize, Ordering},
            Arc, Mutex,
        };
        use tokio::sync::{mpsc, Semaphore};
        let path =
            std::env::temp_dir().join(format!("callback-recover-{}.sqlite", crate::random_hex(8)));
        let receipt = Arc::new(Mutex::new(json!({"id":"wrong", "status":"failed"})));
        let count = Arc::new(AtomicUsize::new(0));
        let gate = Arc::new(Semaphore::new(0));
        let (tx, mut submitted) = mpsc::unbounded_channel::<Value>();
        let (pause, calls, outcome) = (gate.clone(), count.clone(), receipt.clone());
        let provider = Router::new()
            .route(
                "/videos",
                post(move |Json(body): Json<Value>| {
                    let (pause, tx, calls) = (pause.clone(), tx.clone(), calls.clone());
                    async move {
                        calls.fetch_add(1, Ordering::SeqCst);
                        let conflict = body["prompt"] == "film-conflict";
                        tx.send(body).unwrap();
                        pause.acquire().await.unwrap().forget();
                        (
                            StatusCode::ACCEPTED,
                            Json(if conflict {
                                json!({"id":"job-other"})
                            } else {
                                json!({"status":"pending"})
                            }),
                        )
                    }
                }),
            )
            .route(
                "/videos/{id}",
                get(move |headers: HeaderMap| {
                    let outcome = outcome.clone();
                    async move {
                        assert_eq!(headers[header::AUTHORIZATION], "Bearer test-key");
                        Json(outcome.lock().unwrap().clone())
                    }
                }),
            );
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let ai = AiConfig {
            api_key: "test-key".into(),
            base_url: format!("http://{}", listener.local_addr().unwrap()),
            ..AiConfig::default()
        };
        let server = tokio::spawn(async move { axum::serve(listener, provider).await.unwrap() });
        let callbacks = Config::parse(Some("https://site.test"), Some(SECRET));
        let mut state =
            crate::test_support::test_app_state(crate::RuntimeWorld::seeded(), Some(path.clone()));
        state.ai_config = Arc::new(Some(ai.clone()));
        let mut c = credits::open(&path).unwrap();
        c.execute_batch(
            "INSERT INTO auth_users VALUES ('u1','u1','u1','active',0,0);
            CREATE TABLE card_members(world TEXT, actor INTEGER, user TEXT, seen INTEGER);
            CREATE TABLE card_bindings(world TEXT, actor INTEGER, user TEXT);
            INSERT INTO card_members VALUES ('w1',0,'u1',0);",
        )
        .unwrap();
        let hash = URL_SAFE_NO_PAD.encode(Sha256::digest(b"u1"));
        c.execute(
            "INSERT INTO auth_sessions VALUES (?1,'u1',0,0,0,9999999999,NULL)",
            [hash],
        )
        .unwrap();
        credits::grant(&mut c, "u1", 300, "pack", "").unwrap();
        credits::pool::commit(&mut c, "u1", "w1", 300, "pool").unwrap();
        let request = |id: &str| {
            Request::post("/card-game/video")
                .header(header::COOKIE, "cosyworld_session=u1")
                .header(header::CONTENT_TYPE, "application/json")
                .body(Body::from(
                    json!({"request_id":id,"prompt":id,"options":{},"world":"w1"}).to_string(),
                ))
                .unwrap()
        };
        let invalid = router_with_callbacks(Config::parse(Some("https://site.test"), None))
            .with_state(state.clone());
        assert_eq!(
            invalid
                .oneshot(request("film-invalid"))
                .await
                .unwrap()
                .status(),
            StatusCode::SERVICE_UNAVAILABLE
        );
        assert_eq!(credits::balance(&c, Payer::of("w1", "u1")).unwrap(), 300);
        let app = router_with_callbacks(callbacks.clone()).with_state(state);
        let deliver = |url: &str, job: &str, status: &str| {
            let body = json!({"type":format!("video.generation.{status}"),"data":{"id":job,"status":status}}).to_string();
            let sig = signature(crate::util::now_unix_secs(), body.as_bytes());
            app.clone().oneshot(
                Request::post(reqwest::Url::parse(url).unwrap().path())
                    .header("X-OpenRouter-Signature", sig)
                    .body(Body::from(body))
                    .unwrap(),
            )
        };
        for terminal in ["failed", "completed"] {
            let id = format!("film-{terminal}");
            let job = format!("job-{terminal}");
            let mut pending = Some(tokio::spawn(app.clone().oneshot(request(&id))));
            let body = tokio::time::timeout(std::time::Duration::from_secs(5), submitted.recv())
                .await
                .unwrap()
                .unwrap();
            let url = body["callback_url"].as_str().unwrap();
            assert!(url.starts_with("https://site.test/internal/video/callback/"));
            if terminal == "completed" {
                gate.add_permits(1);
                let response = pending.take().unwrap().await.unwrap().unwrap();
                assert_eq!(
                    super::super::tests::read(response).await.1["status"],
                    "submission_unknown"
                );
            }
            assert_eq!(
                deliver(url, &job, terminal).await.unwrap().status(),
                StatusCode::NO_CONTENT
            );
            c.execute(
                "UPDATE credit_video_requests SET updated_at_unix = ?1",
                [crate::util::now_unix_secs() as i64 - 31],
            )
            .unwrap();
            reconcile::run(&path, &ai).await; // A live submitting hint cannot settle early.
            if terminal == "failed" {
                assert_eq!(
                    reservations::get(&c, "u1", "w1", &id).unwrap().unwrap().2,
                    "submitting"
                );
                gate.add_permits(1);
                let response = pending.take().unwrap().await.unwrap().unwrap();
                assert_eq!(
                    super::super::tests::read(response).await.1["status"],
                    "submission_unknown"
                );
                c.execute("UPDATE credit_video_requests SET updated_at_unix = 0", [])
                    .unwrap();
                reconcile::run(&path, &ai).await; // Wrong provider ID still cannot adopt/refund.
            }
            assert_eq!(
                reservations::get(&c, "u1", "w1", &id).unwrap().unwrap().0,
                ""
            );
            *receipt.lock().unwrap() = json!({"id":job,"status":terminal});
            c.execute("UPDATE credit_video_requests SET updated_at_unix = 0", [])
                .unwrap();
            if terminal == "completed" {
                c.execute("DELETE FROM card_members", []).unwrap();
                drop(c);
                let mut restarted = crate::test_support::test_app_state(
                    crate::RuntimeWorld::seeded(),
                    Some(path.clone()),
                );
                restarted.ai_config = Arc::new(Some(ai.clone()));
                let worker = reconcile::start(&restarted).unwrap();
                tokio::time::timeout(std::time::Duration::from_secs(5), async {
                    loop {
                        let connection = credits::open(&path).unwrap();
                        if reservations::get(&connection, "u1", "w1", &id)
                            .unwrap()
                            .unwrap()
                            .2
                            == "completed"
                        {
                            break;
                        }
                        tokio::task::yield_now().await;
                    }
                })
                .await
                .unwrap();
                worker.abort();
                c = credits::open(&path).unwrap();
            } else {
                reconcile::run(&path, &ai).await;
            }
            assert_eq!(
                reservations::get(&c, "u1", "w1", &id).unwrap().unwrap().2,
                terminal
            );
            assert_eq!(
                deliver(url, &job, "failed").await.unwrap().status(),
                StatusCode::NO_CONTENT
            );
            *receipt.lock().unwrap() = json!({"id":job,"status":"failed"});
            assert_eq!(
                receipts::observe(&path, &ai, "u1", "w1", &id, &job).await["status"],
                terminal
            );
        }
        c.execute("INSERT INTO card_members VALUES ('w1',0,'u1',0)", [])
            .unwrap();
        let id = "film-conflict";
        let job = "job-conflict";
        let pending = tokio::spawn(app.clone().oneshot(request(id)));
        let body = tokio::time::timeout(std::time::Duration::from_secs(5), submitted.recv())
            .await
            .unwrap()
            .unwrap();
        let url = body["callback_url"].as_str().unwrap();
        assert_eq!(
            deliver(url, job, "failed").await.unwrap().status(),
            StatusCode::NO_CONTENT
        );
        c.execute(
            "UPDATE credit_video_requests SET updated_at_unix = ?1",
            [crate::util::now_unix_secs() as i64 - 31],
        )
        .unwrap();
        *receipt.lock().unwrap() = json!({"id":job,"status":"failed"});
        reconcile::run(&path, &ai).await;
        assert_eq!(
            reservations::get(&c, "u1", "w1", id).unwrap().unwrap().2,
            "submitting"
        );
        gate.add_permits(1);
        let response = pending.await.unwrap().unwrap();
        assert_eq!(
            super::super::tests::read(response).await.1["status"],
            "submission_unknown"
        );
        let retry = app.clone().oneshot(request(id)).await.unwrap();
        assert_eq!(
            super::super::tests::read(retry).await.1["status"],
            "submission_unknown"
        );
        assert_eq!(
            c.query_row(
                "SELECT job_hint FROM credit_video_callbacks WHERE request_id = ?1",
                [id],
                |r| r.get::<_, String>(0)
            )
            .unwrap(),
            "job-conflict"
        );
        let conflicting = reservations::get(&c, "u1", "w1", id).unwrap().unwrap();
        assert_eq!(
            (conflicting.0.as_str(), conflicting.2.as_str()),
            ("job-other", "submission_conflict")
        );
        let late = receipts::observe(&path, &ai, "u1", "w1", id, job).await;
        assert_eq!(late["status"], "submission_unknown");
        c.execute("UPDATE credit_video_requests SET updated_at_unix = 0", [])
            .unwrap();
        reconcile::run(&path, &ai).await;
        assert_eq!(credits::balance(&c, Payer::of("w1", "u1")).unwrap(), 100);
        let target = callbacks.target().unwrap().unwrap();
        reservations::reserve_with_callback(
            &mut c,
            "u1",
            "w1",
            "film-alias",
            &json!({"prompt":"other"}),
            Some(target.clone()),
        )
        .unwrap();
        reservations::claim(&c, "u1", "w1", "film-alias").unwrap();
        assert_eq!(
            deliver(&target.1, "job-failed", "failed")
                .await
                .unwrap()
                .status(),
            StatusCode::NO_CONTENT
        );
        *receipt.lock().unwrap() = json!({"id":"job-failed","status":"failed"});
        c.execute("UPDATE credit_video_requests SET updated_at_unix = 0, state = 'submission_unknown' WHERE request_id = 'film-alias'", [])
            .unwrap();
        reconcile::run(&path, &ai).await;
        assert_eq!(
            reservations::get(&c, "u1", "w1", "film-alias")
                .unwrap()
                .unwrap()
                .0,
            ""
        );
        assert_eq!(credits::balance(&c, Payer::of("w1", "u1")).unwrap(), 0);
        assert_eq!(credits::balance(&c, "u1").unwrap(), 0);
        assert_eq!(count.load(Ordering::SeqCst), 3);
        server.abort();
        let _ = std::fs::remove_file(path);
    }
}
