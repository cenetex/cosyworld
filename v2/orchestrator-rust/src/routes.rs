use axum::{
    extract::{MatchedPath, Request},
    http::HeaderValue,
    middleware,
    middleware::Next,
    routing::{get, post},
    Router,
};
use tower_http::{
    compression::{
        predicate::{DefaultPredicate, NotForContentType, Predicate},
        CompressionLayer,
    },
    cors::CorsLayer,
};
use tracing::Instrument;

use super::*;

#[path = "card_authoring_generation.rs"]
mod card_authoring_generation;
#[path = "card_game.rs"]
pub(crate) mod card_game;
#[path = "card_voices.rs"]
mod card_voices;
#[cfg(test)]
pub(crate) use card_voices::authority::line as shared_voice_line;
#[path = "play_metrics.rs"]
pub(crate) mod play_metrics;
#[path = "signed_envelope.rs"]
pub(crate) mod signed_envelope;

const REQUEST_ID_HEADER: HeaderName = HeaderName::from_static("x-request-id");
const MAX_REQUEST_ID_LENGTH: usize = 128;

fn response_compression() -> CompressionLayer<impl Predicate> {
    CompressionLayer::new().compress_when(
        DefaultPredicate::new()
            .and(NotForContentType::const_new("audio/"))
            .and(NotForContentType::const_new("video/")),
    )
}

#[derive(Clone, Debug)]
struct RequestLogContext {
    app: String,
    machine_id: String,
    region: String,
    process: String,
    tenant: String,
    worldpack: String,
}

impl RequestLogContext {
    fn from_state(state: &AppState) -> Self {
        Self {
            app: startup::log_context_env("FLY_APP_NAME", "local"),
            machine_id: startup::log_context_env("FLY_MACHINE_ID", "local"),
            region: startup::log_context_env("FLY_REGION", "local"),
            process: state.deployment.process_id.clone(),
            tenant: startup::log_context_env("COSYWORLD_LOG_TENANT", "primary"),
            worldpack: startup::log_context_env("COSYWORLD_LOG_WORLDPACK", "card-table"),
        }
    }
}

/// The hosted server (#1652): the card table, accounts, shared worlds,
/// dialogue, voices, authoring, play metrics, `/meta` and `/health`. The
/// classic routes are not mounted, and the classic world is never loaded.
pub(super) fn card_app_router(state: AppState, shutdown: ShutdownSubscription) -> Router {
    let routes = Router::new()
        .merge(crate::card_authoring::router())
        .merge(card_authoring_generation::router())
        .merge(crate::card_shared::router())
        .merge(card_voices::router())
        .merge(card_game::router())
        .merge(play_metrics::router())
        .merge(card_game::text_router(state.ai_config.clone(), true))
        .route("/health", get(health))
        .route("/health/live", get(health_live))
        .route("/meta", get(super::card_boot::card_meta))
        .route("/auth/account", get(account_identity))
        .route("/auth/logout", post(account_logout))
        .route(
            "/auth/passkey/register/start",
            post(passkey_registration_start),
        )
        .route(
            "/auth/passkey/register/finish",
            post(passkey_registration_finish),
        )
        .route("/auth/passkey/login/start", post(passkey_login_start))
        .route("/auth/passkey/login/finish", post(passkey_login_finish));
    with_ingress_layers(routes, state, shutdown)
}

fn with_ingress_layers(
    routes: Router<AppState>,
    state: AppState,
    shutdown: ShutdownSubscription,
) -> Router {
    let request_log_context = RequestLogContext::from_state(&state);
    routes
        // Action handlers return JSON envelopes with their authoritative
        // status field. Promote that field to the HTTP status after handlers
        // finish, before compression obscures the JSON body.
        .layer(middleware::map_response(action_response_http_status))
        // Existing keep-alive connections must not submit fresh work after the
        // process begins draining. Liveness remains available to distinguish a
        // draining process from a dead one.
        .layer(middleware::from_fn_with_state(shutdown, shutdown_admission))
        // `COSYWORLD_PASSKEYS=members` keeps play to known passkeys.
        .layer(middleware::from_fn_with_state(
            state.account_auth.clone(),
            crate::account_auth::passkey_access::members_only_gate,
        ))
        .layer(response_compression())
        .layer(CorsLayer::permissive())
        .layer(middleware::from_fn_with_state(
            request_log_context,
            request_observability,
        ))
        // Every per-IP rate limit reads `ConnectInfo`. Resolve it once at
        // ingress so all of them see the real client behind Fly's proxy.
        .layer(middleware::from_fn_with_state(
            ClientIpSource::from_env(),
            resolve_client_address,
        ))
        .with_state(state)
}

/// Replace the socket peer in `ConnectInfo` with the derived client address
/// (see `rate_limit::client_addr`). Handlers keep extracting
/// `ConnectInfo<SocketAddr>` and never read forwarding headers themselves.
async fn resolve_client_address(
    State(source): State<ClientIpSource>,
    mut request: Request,
    next: Next,
) -> Response {
    if let Some(ConnectInfo(peer)) = request
        .extensions()
        .get::<ConnectInfo<SocketAddr>>()
        .copied()
    {
        let client = client_addr(peer, request.headers(), source);
        request.extensions_mut().insert(ConnectInfo(client));
    }
    next.run(request).await
}

async fn request_observability(
    State(context): State<RequestLogContext>,
    mut request: Request,
    next: Next,
) -> Response {
    let request_id = request_id(&request);
    let request_id_header = HeaderValue::from_str(&request_id)
        .expect("validated or generated request IDs must be valid header values");
    request
        .headers_mut()
        .insert(REQUEST_ID_HEADER, request_id_header.clone());
    let method = request.method().to_string();
    let route = request
        .extensions()
        .get::<MatchedPath>()
        .map(|path| path.as_str().to_string())
        .unwrap_or_else(|| "<unmatched>".to_string());
    let started = Instant::now();
    let span = tracing::info_span!(
        "http_request",
        request_id = %request_id,
        method = %method,
        route = %route,
        app = %context.app,
        machine_id = %context.machine_id,
        region = %context.region,
        process = %context.process,
        tenant = %context.tenant,
        worldpack = %context.worldpack,
    );
    let mut response = next.run(request).instrument(span.clone()).await;
    let status = response.status().as_u16();
    span.in_scope(|| {
        info!(
            event = "http_request_complete",
            status,
            latency_ms = started.elapsed().as_millis() as u64,
        );
    });
    response
        .headers_mut()
        .insert(REQUEST_ID_HEADER, request_id_header);
    response
}

fn request_id(request: &Request) -> String {
    request
        .headers()
        .get(REQUEST_ID_HEADER)
        .and_then(|value| value.to_str().ok())
        .map(str::trim)
        .filter(|value| valid_request_id(value))
        .map(str::to_string)
        .unwrap_or_else(|| format!("cw-{}", random_hex(16)))
}

fn valid_request_id(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= MAX_REQUEST_ID_LENGTH
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'.' | b'_' | b':' | b'-'))
}

async fn shutdown_admission(
    State(shutdown): State<ShutdownSubscription>,
    request: Request,
    next: Next,
) -> Response {
    if !shutdown.is_draining() || request.uri().path() == "/health/live" {
        return next.run(request).await;
    }

    let mut response = Json(serde_json::json!({
        "ok": false,
        "status": 503,
        "error": "server_draining",
        "output": "The server is restarting. Reconnect and retry."
    }))
    .into_response();
    *response.status_mut() = StatusCode::SERVICE_UNAVAILABLE;
    response
        .headers_mut()
        .insert(header::RETRY_AFTER, HeaderValue::from_static("1"));
    response
        .headers_mut()
        .insert(header::CONNECTION, HeaderValue::from_static("close"));
    response
}

#[derive(Clone)]
pub(super) struct ExplicitResponseStatus;

pub(super) async fn action_response_http_status(response: Response) -> Response {
    if response
        .extensions()
        .get::<ExplicitResponseStatus>()
        .is_some()
    {
        return response;
    }
    let (mut parts, body) = response.into_parts();
    let is_json = parts
        .headers
        .get(header::CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .is_some_and(|value| value.starts_with("application/json"));
    if !is_json {
        return Response::from_parts(parts, body);
    }
    let bytes = match to_bytes(body, 2 * 1024 * 1024).await {
        Ok(bytes) => bytes,
        Err(error) => {
            warn!("failed to encode JSON action response: {error}");
            let mut response = Json(serde_json::json!({
                "ok": false,
                "status": 500,
                "error": "response_encoding_failed",
                "output": "The response could not be encoded. Retry."
            }))
            .into_response();
            *response.status_mut() = StatusCode::INTERNAL_SERVER_ERROR;
            return response;
        }
    };
    if let Some(status) = serde_json::from_slice::<serde_json::Value>(&bytes)
        .ok()
        .and_then(|value| value.get("status").and_then(serde_json::Value::as_u64))
        .and_then(|status| u16::try_from(status).ok())
        .and_then(|status| StatusCode::from_u16(status).ok())
    {
        parts.status = status;
    }
    Response::from_parts(parts, Body::from(bytes))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_support::test_app_state;
    use axum::body::Bytes;
    use tower::ServiceExt;

    fn card_app(shutdown: ShutdownSubscription) -> Router {
        card_app_router(test_app_state(None), shutdown)
    }

    #[tokio::test]
    async fn ingress_resolves_the_client_address_handlers_see() {
        async fn echo(ConnectInfo(client): ConnectInfo<SocketAddr>) -> String {
            client.ip().to_string()
        }
        let peer: SocketAddr = "172.16.0.2:40000".parse().unwrap();
        for (source, fly_header, expected) in [
            (ClientIpSource::FlyProxy, Some("203.0.113.5"), "203.0.113.5"),
            (ClientIpSource::FlyProxy, None, "172.16.0.2"),
            (
                ClientIpSource::SocketPeer,
                Some("203.0.113.5"),
                "172.16.0.2",
            ),
        ] {
            let app = Router::new()
                .route("/ip", get(echo))
                .layer(middleware::from_fn_with_state(
                    source,
                    resolve_client_address,
                ));
            let mut builder = Request::builder()
                .uri("/ip")
                .header("x-forwarded-for", "9.9.9.9");
            if let Some(value) = fly_header {
                builder = builder.header(FLY_CLIENT_IP_HEADER, value);
            }
            let mut request = builder.body(Body::empty()).unwrap();
            request.extensions_mut().insert(ConnectInfo(peer));
            let response = app.oneshot(request).await.unwrap();
            let body = to_bytes(response.into_body(), 1024).await.unwrap();
            assert_eq!(body, expected.as_bytes());
        }
    }

    #[test]
    fn request_ids_are_bounded_log_safe_tokens() {
        assert!(valid_request_id("incident-2026.08.21:smoke_1"));
        assert!(!valid_request_id(""));
        assert!(!valid_request_id("contains space"));
        assert!(!valid_request_id("contains?query=secret"));
        assert!(!valid_request_id(&"a".repeat(MAX_REQUEST_ID_LENGTH + 1)));
    }

    #[tokio::test]
    async fn requests_propagate_valid_ids_and_replace_unsafe_ids() {
        let app = card_app(ShutdownSubscription::idle());
        let accepted = app
            .clone()
            .oneshot(
                Request::builder()
                    .uri("/health/live?token=must-not-be-logged")
                    .header(REQUEST_ID_HEADER, "incident-smoke-1")
                    .body(Body::empty())
                    .expect("health request"),
            )
            .await
            .expect("health response");
        assert_eq!(
            accepted.headers().get(REQUEST_ID_HEADER).unwrap(),
            "incident-smoke-1"
        );

        let replaced = app
            .oneshot(
                Request::builder()
                    .uri("/health/live")
                    .header(REQUEST_ID_HEADER, "unsafe request id")
                    .body(Body::empty())
                    .expect("health request"),
            )
            .await
            .expect("health response");
        let generated = replaced
            .headers()
            .get(REQUEST_ID_HEADER)
            .and_then(|value| value.to_str().ok())
            .expect("generated response request ID");
        assert!(generated.starts_with("cw-"));
        assert!(valid_request_id(generated));
    }

    #[tokio::test]
    async fn shutdown_rejects_new_work_but_keeps_liveness_available() {
        let (trigger, shutdown) = shutdown_channel();
        let app = card_app(shutdown);
        trigger.notify(ShutdownReason::Test);

        let draining = app
            .clone()
            .oneshot(
                Request::builder()
                    .uri("/health")
                    .body(Body::empty())
                    .expect("draining request"),
            )
            .await
            .expect("draining response");
        assert_eq!(draining.status(), StatusCode::SERVICE_UNAVAILABLE);
        assert_eq!(draining.headers().get(header::RETRY_AFTER).unwrap(), "1");

        let health = app
            .oneshot(
                Request::builder()
                    .uri("/health/live")
                    .body(Body::empty())
                    .expect("liveness request"),
            )
            .await
            .expect("liveness response");
        assert_eq!(health.status(), StatusCode::OK);
    }

    #[tokio::test]
    async fn a_failed_json_body_is_replaced_by_an_actionable_envelope() {
        let body = Body::from_stream(tokio_stream::once(Err::<Bytes, io::Error>(
            io::Error::other("fixture body failure"),
        )));
        let response = Response::builder()
            .header(header::CONTENT_TYPE, "application/json")
            .body(body)
            .expect("failing JSON response");
        let response = action_response_http_status(response).await;
        assert_eq!(response.status(), StatusCode::INTERNAL_SERVER_ERROR);
        let body = to_bytes(response.into_body(), 1024 * 1024)
            .await
            .expect("error body");
        let payload: serde_json::Value =
            serde_json::from_slice(&body).expect("parseable error envelope");
        assert_eq!(payload["ok"], false);
        assert_eq!(payload["error"], "response_encoding_failed");
    }
}
