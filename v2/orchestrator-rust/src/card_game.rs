#[path = "card_narrative.rs"]
mod narrative;
pub(crate) use narrative::recital;

pub(super) fn text_router<S: Clone + Send + Sync + 'static>(
    ai: std::sync::Arc<Option<crate::ai_gateway::AiConfig>>,
    primary: bool,
) -> Router<S> {
    if primary {
        narrative::router(ai)
    } else {
        Router::new()
    }
}

use axum::{
    extract::Path,
    http::{header, HeaderMap, Method, StatusCode},
    response::{IntoResponse, Redirect, Response},
    routing::get,
    Router,
};

const CSP: &str = "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'self'";

pub(super) fn router<S: Clone + Send + Sync + 'static>(primary: bool) -> Router<S> {
    Router::new()
        .route(
            "/",
            if primary {
                get(index)
            } else {
                get(crate::index)
            },
        )
        .route("/classic", get(crate::index))
        .route(
            "/card-game",
            get(|| async { Redirect::permanent("/card-game/") }),
        )
        .route("/card-game/", get(index))
        .route("/card-game/{*path}", get(asset))
}

async fn index() -> Response {
    serve("index.html")
}

async fn asset(Path(path): Path<String>, method: Method, headers: HeaderMap) -> Response {
    let response = serve(&path);
    if path.ends_with(".mp3") && response.status() == StatusCode::OK {
        return music_range(
            response,
            if method == Method::GET {
                headers
                    .get(header::RANGE)
                    .and_then(|value| value.to_str().ok())
            } else {
                None
            },
        )
        .await;
    }
    response
}

// Browsers use byte ranges to load MP3 metadata and resume long tracks.
async fn music_range(response: Response, range: Option<&str>) -> Response {
    let (mut parts, body) = response.into_parts();
    let Ok(bytes) = axum::body::to_bytes(body, usize::MAX).await else {
        return StatusCode::INTERNAL_SERVER_ERROR.into_response();
    };
    let length = bytes.len();
    parts
        .headers
        .insert(header::ACCEPT_RANGES, "bytes".parse().unwrap());
    parts.headers.insert(header::CONTENT_LENGTH, length.into());
    let Some(value) = range.and_then(|value| value.strip_prefix("bytes=")) else {
        return Response::from_parts(parts, bytes.into());
    };
    // A full response also satisfies clients that ask for several ranges.
    if value.contains(',') {
        return Response::from_parts(parts, bytes.into());
    }
    let bounds = value.split_once('-').and_then(|(start, end)| {
        if start.is_empty() {
            let count = end.parse::<usize>().ok()?;
            (count > 0).then_some((length.saturating_sub(count), length - 1))
        } else {
            let start = start.parse::<usize>().ok()?;
            let end = if end.is_empty() {
                length - 1
            } else {
                end.parse::<usize>().ok()?.min(length - 1)
            };
            (start <= end).then_some((start, end))
        }
    });
    if let Some((start, end)) = bounds {
        parts.status = StatusCode::PARTIAL_CONTENT;
        parts.headers.insert(
            header::CONTENT_RANGE,
            format!("bytes {start}-{end}/{length}").parse().unwrap(),
        );
        parts
            .headers
            .insert(header::CONTENT_LENGTH, (end - start + 1).into());
        Response::from_parts(parts, bytes.slice(start..=end).into())
    } else {
        parts.status = StatusCode::RANGE_NOT_SATISFIABLE;
        parts.headers.insert(
            header::CONTENT_RANGE,
            format!("bytes */{length}").parse().unwrap(),
        );
        parts.headers.insert(header::CONTENT_LENGTH, 0.into());
        Response::from_parts(parts, axum::body::Body::empty())
    }
}

fn serve(path: &str) -> Response {
    let Some((content_type, bytes)) = cosyworld_orchestrator::card_assets::get(path) else {
        return StatusCode::NOT_FOUND.into_response();
    };
    (
        [
            (header::CONTENT_TYPE, content_type),
            (header::CACHE_CONTROL, "no-store"),
            (header::X_CONTENT_TYPE_OPTIONS, "nosniff"),
            (header::CONTENT_SECURITY_POLICY, CSP),
            (
                header::HeaderName::from_static("x-cosyworld-card-version"),
                env!("CARGO_PKG_VERSION"),
            ),
        ],
        bytes,
    )
        .into_response()
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::{
        body::{to_bytes, Body},
        http::Request,
    };
    use tower::ServiceExt;

    async fn request(primary: bool, path: &str, method: &str) -> Response {
        router::<()>(primary)
            .oneshot(
                Request::builder()
                    .uri(path)
                    .method(method)
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap()
    }

    #[tokio::test]
    async fn primary_page_and_named_worlds_choose_their_own_shell() {
        let response = request(true, "/?table=release-check", "GET").await;
        assert_eq!(response.status(), StatusCode::OK);
        assert_eq!(
            response.headers()["x-cosyworld-card-version"],
            env!("CARGO_PKG_VERSION")
        );
        assert_eq!(response.headers()[header::CACHE_CONTROL], "no-store");
        let body = to_bytes(response.into_body(), usize::MAX).await.unwrap();
        assert_eq!(&body[..], include_bytes!("../../card-game/index.html"));
        for (primary, path) in [(false, "/"), (true, "/classic")] {
            let response = request(primary, path, "GET").await;
            let body = to_bytes(response.into_body(), usize::MAX).await.unwrap();
            assert_eq!(&body[..], crate::INDEX_HTML.as_bytes());
        }
    }

    #[tokio::test]
    async fn deployed_table_serves_every_module_and_scene_image() {
        for path in [
            "index.html",
            "style.css",
            "entry.mjs",
            "awakening.css",
            "assets/badger-forest/steam-clock-background.png",
            "assets/badger-forest/badger-sleeping.png",
            "assets/badger-forest/badger-grumpy.png",
            "app.mjs",
            "world.mjs",
            "scene.mjs",
            "cards.mjs",
            "lessons.mjs",
            "quests.mjs",
            "quest-cards.mjs",
            "motives.mjs",
            "life.mjs",
            "situations.mjs",
            "memory.mjs",
            "narrative.mjs",
            "dialogue.mjs",
            "music.mjs",
            "pack-schema.mjs",
            "pack-registry.mjs",
            "pack-rules.mjs",
            "pack-transport.mjs",
            "legacy-saves.mjs",
            "packs.json",
            "assets/music/greek-harbor.mp3",
            "assets/music/greek-courtyard.mp3",
            "assets/music/greek-well.mp3",
            "assets/music/attic-1.mp3",
            "assets/music/attic-2.mp3",
            "assets/music/pond-1.mp3",
            "assets/music/pond-2.mp3",
            "assets/music/station-1.mp3",
            "assets/music/station-2.mp3",
            "assets/music/ship-1.mp3",
            "assets/music/ship-2.mp3",
            "assets/music/ship-3.mp3",
            "assets/music/ship-4.mp3",
            "entity-profiles.json",
            "assets/lamp-card.png",
            "assets/oil-card.png",
            "assets/bell-card.png",
            "assets/cloth-card.png",
            "assets/lamp-card.jpg",
            "assets/oil-card.jpg",
            "assets/bell-card.jpg",
            "assets/cloth-card.jpg",
            "assets/station.png",
            "assets/attic.png",
            "assets/pond.png",
            "assets/vale.png",
            "assets/moth.png",
            "assets/keeper.png",
            "assets/keeper-right.png",
        ] {
            let url = format!("/card-game/{path}");
            let response = request(true, &url, "GET").await;
            assert_eq!(response.status(), StatusCode::OK, "{path}");
            let content_type = response.headers()[header::CONTENT_TYPE]
                .to_str()
                .unwrap()
                .to_owned();
            let body = to_bytes(response.into_body(), usize::MAX).await.unwrap();
            assert!(!body.is_empty());
            if path.ends_with(".svg") {
                assert_eq!(content_type, "image/svg+xml");
                assert!(std::str::from_utf8(&body).unwrap().starts_with("<svg"));
            } else if path.ends_with(".png") {
                assert_eq!(content_type, "image/png");
                assert_eq!(&body[..8], b"\x89PNG\r\n\x1a\n");
            } else if path.ends_with(".jpg") {
                assert_eq!(content_type, "image/jpeg");
                assert_eq!(&body[..3], b"\xff\xd8\xff");
            } else if path.ends_with(".mp3") {
                assert_eq!(content_type, "audio/mpeg");
                assert_eq!(&body[..3], b"ID3");
            } else if path.ends_with(".mjs") {
                assert_eq!(content_type, "text/javascript; charset=utf-8");
            }
            let head = request(true, &url, "HEAD").await;
            assert_eq!(head.status(), StatusCode::OK);
            assert!(to_bytes(head.into_body(), usize::MAX)
                .await
                .unwrap()
                .is_empty());
        }
        assert_eq!(
            request(true, "/card-game/serve.mjs", "GET").await.status(),
            StatusCode::NOT_FOUND
        );
        assert_eq!(
            request(true, "/card-game/../Cargo.toml", "GET")
                .await
                .status(),
            StatusCode::NOT_FOUND
        );
        assert_eq!(
            request(true, "/", "POST").await.status(),
            StatusCode::METHOD_NOT_ALLOWED
        );
    }

    #[tokio::test]
    async fn deployed_table_serves_every_mounted_pack_image() {
        // Pack art is named by the compiled pack data; each file must be embedded.
        let packs: serde_json::Value =
            serde_json::from_str(include_str!("../../card-game/packs.json")).unwrap();
        let mut media = Vec::new();
        for pack in packs["packs"].as_array().unwrap() {
            for place in pack["places"].as_object().unwrap().values() {
                media.push(place["backdrop"].as_str().unwrap().to_owned());
            }
            for avatar in pack["avatars"].as_object().unwrap().values() {
                let variants = avatar["variants"].as_object().into_iter().flatten();
                for path in std::iter::once(&avatar["portrait"])
                    .chain(variants.map(|(_, v)| &v["portrait"]))
                    .filter_map(|p| p.as_str())
                {
                    media.push(path.to_owned());
                }
            }
        }
        for pack in packs["packs"].as_array().unwrap() {
            if let Some(items) = pack["items"].as_object() {
                for item in items.values() {
                    if let Some(path) = item["art"].as_str() {
                        media.push(path.to_owned());
                    }
                }
            }
            for crossing in pack["crossings"].as_array().unwrap() {
                for key in ["overlay", "cardArt"] {
                    if let Some(path) = crossing["scenery"][key].as_str() {
                        media.push(path.to_owned());
                    }
                }
            }
        }
        assert!(!media.is_empty());
        for path in media {
            let response = request(true, &format!("/card-game/{path}"), "GET").await;
            assert_eq!(response.status(), StatusCode::OK, "{path}");
            let expected = if path.ends_with(".svg") {
                "image/svg+xml"
            } else if path.ends_with(".webp") {
                "image/webp"
            } else {
                "image/png"
            };
            assert_eq!(response.headers()[header::CONTENT_TYPE], expected, "{path}");
        }
    }

    #[tokio::test]
    async fn music_supports_browser_range_requests() {
        let song = include_bytes!("../../card-game/assets/music/attic-1.mp3");
        for (range, expected) in [
            ("bytes=0-2", Some((0, 2))),
            ("bytes=100-", Some((100, song.len() - 1))),
            ("bytes=-32", Some((song.len() - 32, song.len() - 1))),
            ("bytes=4-999999999", Some((4, song.len() - 1))),
            ("bytes=999999999-", None),
            ("bytes=9-2", None),
            ("bytes=-0", None),
        ] {
            let response = router::<()>(true)
                .oneshot(
                    Request::builder()
                        .uri("/card-game/assets/music/attic-1.mp3")
                        .header(header::RANGE, range)
                        .body(Body::empty())
                        .unwrap(),
                )
                .await
                .unwrap();
            assert_eq!(response.headers()[header::ACCEPT_RANGES], "bytes");
            if let Some((start, end)) = expected {
                assert_eq!(response.status(), StatusCode::PARTIAL_CONTENT, "{range}");
                assert_eq!(
                    response.headers()[header::CONTENT_RANGE],
                    format!("bytes {start}-{end}/{}", song.len())
                );
                let body = to_bytes(response.into_body(), usize::MAX).await.unwrap();
                assert_eq!(&body[..], &song[start..=end]);
            } else {
                assert_eq!(
                    response.status(),
                    StatusCode::RANGE_NOT_SATISFIABLE,
                    "{range}"
                );
            }
        }
    }
}
