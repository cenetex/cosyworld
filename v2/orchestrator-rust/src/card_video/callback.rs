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
            "submitting"
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
}
