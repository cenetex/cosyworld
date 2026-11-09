use axum::{http::header, response::IntoResponse, Json};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
    sync::OnceLock,
    time::{SystemTime, UNIX_EPOCH},
};

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct Track {
    file: String,
    title: String,
    duration_ms: u64,
}

#[derive(Deserialize)]
struct Catalog {
    version: String,
    tracks: Vec<Track>,
    #[serde(skip)]
    duration_ms: u64,
}

impl Catalog {
    fn parse(source: &str) -> Self {
        let mut catalog: Self = serde_json::from_str(source).expect("invalid radio catalog JSON");
        assert!(
            catalog.version.len() == 64 && catalog.version.bytes().all(|b| b.is_ascii_hexdigit()),
            "invalid radio catalog version"
        );
        assert!(!catalog.tracks.is_empty(), "empty radio catalog");
        for track in &catalog.tracks {
            assert!(
                track.duration_ms > 0 && !track.file.is_empty() && !track.title.is_empty(),
                "invalid radio track"
            );
            catalog.duration_ms = catalog
                .duration_ms
                .checked_add(track.duration_ms)
                .expect("radio catalog duration overflow");
        }
        catalog
    }

    fn at(&self, now: u64) -> Value {
        // Epoch zero, not process uptime: every world and restart uses the same loop.
        let mut offset = now % self.duration_ms;
        for track in &self.tracks {
            if offset < track.duration_ms {
                let start = now - offset;
                return json!({"station": "ratiradio", "version": self.version,
                    "serverTimeMs": now, "track": track, "startedAtMs": start,
                    "endsAtMs": start.checked_add(track.duration_ms).expect("radio timestamp overflow")});
            }
            offset -= track.duration_ms;
        }
        unreachable!("validated radio catalog covers the entire loop")
    }
}

pub(super) async fn now_playing() -> impl IntoResponse {
    static CATALOG: OnceLock<Catalog> = OnceLock::new();
    let catalog = CATALOG.get_or_init(|| {
        Catalog::parse(include_str!(
            "../../card-game/assets/music/radio-catalog.json"
        ))
    });
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("clock before radio epoch")
        .as_millis();
    (
        [(header::CACHE_CONTROL, "no-store")],
        Json(catalog.at(u64::try_from(now).expect("radio clock overflow"))),
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::{
        body::{to_bytes, Body},
        http::Request,
    };
    use tower::ServiceExt;

    fn source() -> String {
        json!({"version": "a".repeat(64), "tracks": [
            {"file": "one.mp3", "title": "One", "durationMs": 100},
            {"file": "two.mp3", "title": "Two", "durationMs": 200}]})
        .to_string()
    }

    #[test]
    fn boundaries_wrap_and_restart_are_deterministic() {
        let before_restart = Catalog::parse(&source());
        for (now, file, start, end) in [
            (0, "one.mp3", 0, 100),
            (99, "one.mp3", 0, 100),
            (100, "two.mp3", 100, 300),
            (299, "two.mp3", 100, 300),
            (300, "one.mp3", 300, 400),
            (
                1_700_000_000_000,
                "two.mp3",
                1_699_999_999_900u64,
                1_700_000_000_100u64,
            ),
        ] {
            let actual = before_restart.at(now);
            assert_eq!(actual, Catalog::parse(&source()).at(now));
            assert_eq!(actual["track"]["file"], file);
            assert_eq!(actual["startedAtMs"], start);
            assert_eq!(actual["endsAtMs"], end);
        }
    }

    #[test]
    fn rejects_empty_zero_and_overflowing_catalogs() {
        for durations in [vec![], vec![0], vec![u64::MAX, 1]] {
            let tracks: Vec<_> = durations
                .iter()
                .map(|n| json!({"file":"a.mp3", "title":"A", "durationMs":n}))
                .collect();
            let invalid = json!({"version":"a".repeat(64), "tracks":tracks}).to_string();
            assert!(std::panic::catch_unwind(|| Catalog::parse(&invalid)).is_err());
        }
    }

    #[tokio::test]
    async fn route_returns_current_schedule_without_cache() {
        let response = super::super::router::<()>()
            .oneshot(
                Request::builder()
                    .uri("/card-game/radio")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), 200);
        assert_eq!(response.headers()[header::CACHE_CONTROL], "no-store");
        let body: Value =
            serde_json::from_slice(&to_bytes(response.into_body(), usize::MAX).await.unwrap())
                .unwrap();
        assert_eq!(body["station"], "ratiradio");
        assert_eq!(body["version"].as_str().unwrap().len(), 64);
        let now = body["serverTimeMs"].as_u64().unwrap();
        let start = body["startedAtMs"].as_u64().unwrap();
        let end = body["endsAtMs"].as_u64().unwrap();
        assert!(start <= now && now < end);
        assert_eq!(end - start, body["track"]["durationMs"].as_u64().unwrap());
        assert!(body["track"]["file"].is_string() && body["track"]["title"].is_string());
    }
}
