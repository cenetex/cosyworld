#[path = "card_narrative.rs"]
mod narrative;

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
    http::{header, StatusCode},
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

async fn asset(Path(path): Path<String>) -> Response {
    serve(&path)
}

fn serve(path: &str) -> Response {
    // The release embeds this exact table and its art. Requests select only
    // these public files, so filesystem paths and source tools stay private.
    let (content_type, bytes): (&str, &[u8]) = match path {
        "index.html" => (
            "text/html; charset=utf-8",
            include_bytes!("../../card-game/index.html"),
        ),
        "style.css" => (
            "text/css; charset=utf-8",
            include_bytes!("../../card-game/style.css"),
        ),
        "app.mjs" => (
            "text/javascript; charset=utf-8",
            include_bytes!("../../card-game/app.mjs"),
        ),
        "world.mjs" => (
            "text/javascript; charset=utf-8",
            include_bytes!("../../card-game/world.mjs"),
        ),
        "scene.mjs" => (
            "text/javascript; charset=utf-8",
            include_bytes!("../../card-game/scene.mjs"),
        ),
        "cards.mjs" => (
            "text/javascript; charset=utf-8",
            include_bytes!("../../card-game/cards.mjs"),
        ),
        "quests.mjs" => (
            "text/javascript; charset=utf-8",
            include_bytes!("../../card-game/quests.mjs"),
        ),
        "memory.mjs" => (
            "text/javascript; charset=utf-8",
            include_bytes!("../../card-game/memory.mjs"),
        ),
        "narrative.mjs" => (
            "text/javascript; charset=utf-8",
            include_bytes!("../../card-game/narrative.mjs"),
        ),
        "entity-profiles.json" => (
            "application/json; charset=utf-8",
            include_bytes!("../../card-game/entity-profiles.json"),
        ),
        "assets/station.png" => (
            "image/png",
            include_bytes!("../../card-game/assets/station.png"),
        ),
        "assets/attic.png" => (
            "image/png",
            include_bytes!("../../card-game/assets/attic.png"),
        ),
        "assets/pond.png" => (
            "image/png",
            include_bytes!("../../card-game/assets/pond.png"),
        ),
        "assets/vale.png" => (
            "image/png",
            include_bytes!("../../card-game/assets/vale.png"),
        ),
        "assets/moth.png" => (
            "image/png",
            include_bytes!("../../card-game/assets/moth.png"),
        ),
        "assets/keeper.png" => (
            "image/png",
            include_bytes!("../../card-game/assets/keeper.png"),
        ),
        _ => return StatusCode::NOT_FOUND.into_response(),
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
            "app.mjs",
            "world.mjs",
            "scene.mjs",
            "cards.mjs",
            "quests.mjs",
            "memory.mjs",
            "narrative.mjs",
            "entity-profiles.json",
            "assets/station.png",
            "assets/attic.png",
            "assets/pond.png",
            "assets/vale.png",
            "assets/moth.png",
            "assets/keeper.png",
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
            if path.ends_with(".png") {
                assert_eq!(content_type, "image/png");
                assert_eq!(&body[..8], b"\x89PNG\r\n\x1a\n");
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
}
