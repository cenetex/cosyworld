#[path = "card_local.rs"]
pub(crate) mod local;
#[path = "card_media_http.rs"]
mod media_http;

#[path = "card_game_metadata.rs"]
pub(crate) mod metadata;
#[path = "card_narrative.rs"]
pub(crate) mod narrative;

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
    extract::{Path, RawQuery},
    http::{header, HeaderMap, Method, StatusCode},
    response::{IntoResponse, Redirect, Response},
    routing::get,
    Router,
};

const CSP: &str = "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self' https://openrouter.ai; media-src 'self' blob:; object-src 'none'; base-uri 'self'; frame-ancestors 'self'; form-action 'self'";

pub(super) fn router<S: Clone + Send + Sync + 'static>() -> Router<S> {
    Router::new()
        .route("/", get(index))
        .route(
            "/card-game",
            get(|| async { Redirect::permanent("/card-game/") }),
        )
        .route("/card-game/", get(index))
        .route("/card-game/{*path}", get(asset))
}

async fn index() -> Response {
    let budget = narrative::client_budget_ms();
    let mut page = String::from_utf8_lossy(include_bytes!("../../card-game/index.html")).replacen(
        r#"name="cosy-story-budget-ms" content="30000""#,
        &format!(r#"name="cosy-story-budget-ms" content="{budget}""#),
        1,
    );
    if std::env::var("COSYWORLD_LOCAL_APP").as_deref() == Ok("1") {
        page = page.replacen(
            "<head>",
            "<head><meta name=\"cosy-local-app\" content=\"1\">",
            1,
        );
    }
    let mut response = serve("index.html");
    *response.body_mut() = page.into();
    response.headers_mut().remove(header::CONTENT_LENGTH);
    response
}

async fn asset(
    Path(path): Path<String>,
    RawQuery(query): RawQuery,
    method: Method,
    headers: HeaderMap,
) -> Response {
    if path == "index.html" {
        return index().await;
    }
    let Some((content_type, bytes)) = cosyworld_orchestrator::card_assets::get(&path) else {
        return StatusCode::NOT_FOUND.into_response();
    };
    let Some(etag) = cosyworld_orchestrator::card_assets::etag(&path) else {
        return StatusCode::NOT_FOUND.into_response();
    };
    media_http::serve(
        content_type,
        bytes,
        etag,
        query.as_deref(),
        &method,
        &headers,
    )
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
            (header::REFERRER_POLICY, "no-referrer"),
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

    async fn request(path: &str, method: &str) -> Response {
        router::<()>()
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
    async fn the_root_page_is_the_card_table_and_classic_is_retired() {
        let response = request("/?table=release-check", "GET").await;
        assert_eq!(response.status(), StatusCode::OK);
        assert_eq!(
            response.headers()["x-cosyworld-card-version"],
            env!("CARGO_PKG_VERSION")
        );
        assert_eq!(response.headers()[header::CACHE_CONTROL], "no-store");
        let body = to_bytes(response.into_body(), usize::MAX).await.unwrap();
        assert_eq!(&body[..], include_bytes!("../../card-game/index.html"));
        let response = request("/classic", "GET").await;
        assert_eq!(response.status(), StatusCode::NOT_FOUND);
    }

    #[tokio::test]
    async fn deployed_table_serves_every_module_and_scene_image() {
        for path in [
            "index.html",
            "style.css",
            "entry.mjs",
            "assets/badger-forest/steam-clock-background.png",
            "assets/badger-forest/badger-sleeping.png",
            "assets/badger-forest/badger-grumpy.png",
            "app.mjs",
            "world.mjs",
            "scene.mjs",
            "cards.mjs",
            "want.mjs",
            "motives.mjs",
            "life.mjs",
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
            "assets/music/willows-keep-to-bank-1.m4a",
            "assets/music/willows-keep-to-bank-2.m4a",
            "assets/music/willows-dont-answer-trees.m4a",
            "assets/music/willows-keep-to-bank-3.m4a",
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
            let response = request(&url, "GET").await;
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
            } else if path.ends_with(".m4a") {
                assert_eq!(content_type, "audio/mp4");
                assert_eq!(&body[4..8], b"ftyp");
            } else if path.ends_with(".mjs") {
                assert_eq!(content_type, "text/javascript; charset=utf-8");
            }
            let head = request(&url, "HEAD").await;
            assert_eq!(head.status(), StatusCode::OK);
            assert!(to_bytes(head.into_body(), usize::MAX)
                .await
                .unwrap()
                .is_empty());
        }
        assert_eq!(
            request("/card-game/serve.mjs", "GET").await.status(),
            StatusCode::NOT_FOUND
        );
        assert_eq!(
            request("/card-game/../Cargo.toml", "GET").await.status(),
            StatusCode::NOT_FOUND
        );
        assert_eq!(
            request("/", "POST").await.status(),
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
            let response = request(&format!("/card-game/{path}"), "GET").await;
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
            let response = router::<()>()
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

    #[tokio::test]
    async fn html_aliases_stay_fresh_while_static_assets_use_content_validators() {
        use sha2::{Digest, Sha256};
        for path in ["/", "/card-game/", "/card-game/index.html"] {
            let response = request(path, "HEAD").await;
            assert_eq!(response.status(), StatusCode::OK);
            assert_eq!(response.headers()[header::CACHE_CONTROL], "no-store");
            assert!(!response.headers().contains_key(header::ETAG));
            assert!(to_bytes(response.into_body(), usize::MAX)
                .await
                .unwrap()
                .is_empty());
        }
        let song = include_bytes!("../../card-game/assets/music/attic-1.mp3");
        let hash = format!("{:x}", Sha256::digest(song));
        let response = request(
            &format!("/card-game/assets/music/attic-1.mp3?v={hash}"),
            "HEAD",
        )
        .await;
        assert_eq!(response.headers()[header::ETAG], format!("\"{hash}\""));
        assert_eq!(
            response.headers()[header::CACHE_CONTROL],
            "public, max-age=31536000, immutable"
        );
        assert_eq!(
            response.headers()[header::CONTENT_LENGTH],
            song.len().to_string()
        );
        assert!(to_bytes(response.into_body(), usize::MAX)
            .await
            .unwrap()
            .is_empty());
    }

    #[tokio::test]
    async fn response_compression_keeps_music_bytes_and_text_cache_variants() {
        for range in [None, Some("bytes=0-31")] {
            let mut builder = Request::builder()
                .uri("/card-game/assets/music/attic-1.mp3")
                .header(header::ACCEPT_ENCODING, "gzip");
            if let Some(range) = range {
                builder = builder.header(header::RANGE, range);
            }
            let response = router::<()>()
                .layer(super::super::response_compression())
                .oneshot(builder.body(Body::empty()).unwrap())
                .await
                .unwrap();
            assert!(!response.headers().contains_key(header::CONTENT_ENCODING));
            assert!(response.headers()[header::ETAG]
                .to_str()
                .unwrap()
                .starts_with('"'));
            assert_eq!(
                response.status(),
                if range.is_some() {
                    StatusCode::PARTIAL_CONTENT
                } else {
                    StatusCode::OK
                }
            );
            let body = to_bytes(response.into_body(), usize::MAX).await.unwrap();
            assert_eq!(
                body.len(),
                if range.is_some() {
                    32
                } else {
                    include_bytes!("../../card-game/assets/music/attic-1.mp3").len()
                }
            );
        }
        for path in ["shared.mjs", "assets/greek-drama/antigone.svg"] {
            let response = router::<()>()
                .layer(super::super::response_compression())
                .oneshot(
                    Request::builder()
                        .uri(format!("/card-game/{path}"))
                        .header(header::ACCEPT_ENCODING, "gzip")
                        .body(Body::empty())
                        .unwrap(),
                )
                .await
                .unwrap();
            assert_eq!(response.headers()[header::CONTENT_ENCODING], "gzip");
            assert_eq!(response.headers()[header::VARY], "accept-encoding");
            let etag = response.headers()[header::ETAG].clone();
            assert!(etag.to_str().unwrap().starts_with("W/"));
            let revalidated = router::<()>()
                .layer(super::super::response_compression())
                .oneshot(
                    Request::builder()
                        .uri(format!("/card-game/{path}"))
                        .header(header::ACCEPT_ENCODING, "gzip")
                        .header(header::IF_NONE_MATCH, etag)
                        .body(Body::empty())
                        .unwrap(),
                )
                .await
                .unwrap();
            assert_eq!(revalidated.status(), StatusCode::NOT_MODIFIED);
            assert_eq!(revalidated.headers()[header::VARY], "accept-encoding");
        }
    }
}
