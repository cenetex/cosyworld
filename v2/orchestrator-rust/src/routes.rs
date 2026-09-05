use axum::{
    extract::{MatchedPath, Request},
    http::HeaderValue,
    middleware,
    middleware::Next,
    routing::{get, post},
    Router,
};
use tokio::sync::Semaphore;
use tower_http::{compression::CompressionLayer, cors::CorsLayer};
use tracing::Instrument;

use super::*;

// Keep command work bounded without making routine player and resident activity
// contend for a single slot. Saturated callers fail fast and can safely retry
// the same intent while health endpoints continue to bypass this admission gate.
const COMMAND_CONCURRENCY_LIMIT: usize = 16;
const REQUEST_ID_HEADER: HeaderName = HeaderName::from_static("x-request-id");
const MAX_REQUEST_ID_LENGTH: usize = 128;

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
            worldpack: active_content().manifest.id.clone(),
        }
    }
}

pub(super) fn action_path_accepts_kind(path: &str, kind: &str) -> bool {
    match path {
        "/actions/chat" => kind == "chat",
        "/actions/model-interaction" => kind == "model_interaction",
        "/actions/move" => kind == "move",
        "/actions/explore-path" => kind == "explore_path",
        "/actions/discover" => matches!(
            kind,
            FOCUSED_NOTICE_OFFER_KIND
                | DISCOVERY_SEARCH_OFFER_KIND
                | DISCOVERY_STUDY_OFFER_KIND
                | DISCOVERY_SCOUT_OFFER_KIND
        ),
        "/actions/flee" => kind == "flee",
        "/actions/notice" => kind == NOTICE_ACTOR_OFFER_KIND,
        "/actions/check" => kind == "check",
        "/actions/study" => kind == "study",
        "/actions/influence" => kind == "influence",
        "/actions/cast-spell" => kind == "cast_spell",
        "/actions/pick-up" => kind == "pick_up",
        "/actions/drop" => kind == "drop_item",
        "/actions/use-item" => matches!(kind, "use_item" | "use_feature"),
        "/actions/give-item" => kind == "give_item",
        "/actions/trade-item" => kind == "trade_item",
        "/actions/accept-transfer-offer" => kind == ACCEPT_TRANSFER_OFFER_KIND,
        "/actions/theft" => kind == "theft",
        "/actions/craft" => kind == "craft",
        "/actions/declare-combat" => kind == "attack",
        "/actions/attack" => kind == "attack",
        "/actions/defend" => kind == "defend",
        "/actions/prepare" => kind == "prepare",
        "/actions/contribute" => {
            matches!(kind, "work" | "help" | "check" | "study" | "use_item")
        }
        "/actions/work" => kind == "work",
        "/actions/help" => kind == "help",
        "/actions/rest" => kind == "rest",
        "/actions/bank-ledger" => kind == "bank_ledger",
        "/actions/unlock-charm-slot" => kind == "unlock_charm_slot",
        "/actions/create-bond" => kind == "create_bond",
        "/actions/resolve-bond" => kind == "resolve_bond",
        _ => false,
    }
}

#[cfg(test)]
pub(super) fn app_router(state: AppState) -> Router {
    app_router_with_dependencies(
        state,
        Arc::new(Semaphore::new(COMMAND_CONCURRENCY_LIMIT)),
        ShutdownSubscription::idle(),
    )
}

#[cfg(test)]
fn app_router_with_command_capacity(state: AppState, command_capacity: Arc<Semaphore>) -> Router {
    app_router_with_dependencies(state, command_capacity, ShutdownSubscription::idle())
}

pub(super) fn app_router_with_shutdown(state: AppState, shutdown: ShutdownSubscription) -> Router {
    app_router_with_dependencies(
        state,
        Arc::new(Semaphore::new(COMMAND_CONCURRENCY_LIMIT)),
        shutdown,
    )
}

fn app_router_with_dependencies(
    state: AppState,
    command_capacity: Arc<Semaphore>,
    shutdown: ShutdownSubscription,
) -> Router {
    let request_log_context = RequestLogContext::from_state(&state);
    Router::new()
        .route("/", get(index))
        .route("/moderation", get(moderation_console))
        .route(
            "/assets/packs/{pack_id}/{*asset_path}",
            get(worldpack_asset),
        )
        .route(
            "/assets/generated/cards/{card_file}",
            get(generated_seed_card_asset),
        )
        .route(
            "/assets/generated/pathways/{asset_file}",
            get(generated_pathway_asset),
        )
        .route(
            "/assets/generated/community/{subject_kind}/{asset_file}",
            get(generated_community_art_asset),
        )
        .route(
            "/assets/generated/room-scenes/{asset_file}",
            get(generated_room_scene_asset),
        )
        .route(
            "/assets/generated/journal-pages/{asset_file}",
            get(generated_daily_journal_page_asset),
        )
        .route(
            "/assets/generated/resident-images/{asset_file}",
            get(generated_resident_image_asset),
        )
        .route(
            "/assets/generated/model-audio/{asset_file}",
            get(generated_model_audio_asset),
        )
        .route(
            "/assets/generated/avatars/{avatar_file}",
            get(generated_avatar_asset),
        )
        .route(
            "/assets/generated/boxes/{box_state}/{box_file}",
            get(generated_box_asset),
        )
        .route("/assets/cosy-cottage.png", get(legacy_cosy_cottage_asset))
        .route("/assets/rati.png", get(legacy_rati_asset))
        .route("/assets/{*asset_path}", get(public_pack_asset))
        .route("/health", get(health))
        .route("/health/live", get(health_live))
        .route("/meta", get(meta))
        .route("/licenses", get(licenses_view))
        .route("/content-packs", get(content_packs_view))
        .route("/auth/account", get(account_identity))
        .route("/auth/logout", post(account_logout))
        .route("/ai/openrouter/exchange", post(openrouter_exchange))
        .route("/ai/openrouter/verify", post(openrouter_verify))
        .route("/ai/openrouter/disconnect", post(openrouter_disconnect))
        .route(
            "/auth/passkey/register/start",
            post(passkey_registration_start),
        )
        .route(
            "/auth/passkey/register/finish",
            post(passkey_registration_finish),
        )
        .route("/auth/passkey/login/start", post(passkey_login_start))
        .route("/auth/passkey/login/finish", post(passkey_login_finish))
        .route("/auth/wallets/link/start", post(wallet_link_start))
        .route("/auth/wallets/link/finish", post(wallet_link_finish))
        .route("/auth/wallet-claims/start", post(wallet_claim_start))
        .route("/auth/wallet-claims/status", get(wallet_claim_status))
        .route("/auth/wallets/select", post(wallet_select))
        .route("/auth/wallets/unlink", post(wallet_unlink))
        .route("/wallet/challenge", get(wallet_challenge))
        .route("/wallet/session", post(wallet_session))
        .route("/wallet/qr/start", post(wallet_qr_start))
        .route("/wallet/qr/status", get(wallet_qr_status))
        .route("/wallet/qr/{login_id}/code.svg", get(wallet_qr_code))
        .route("/wallet/qr/{login_id}", get(wallet_qr_page))
        .route("/wallet/claim/{claim_id}", get(wallet_claim_page))
        .route("/wallet/claim/{claim_id}/code.svg", get(wallet_claim_code))
        .route(
            "/wallet/claim/{claim_id}/challenge",
            post(wallet_claim_challenge),
        )
        .route("/wallet/claim/{claim_id}/finish", post(wallet_claim_finish))
        .route("/state", get(super::account_avatars::state_for_account))
        .route(
            "/story/world-beat-exposures",
            post(acknowledge_world_beat_exposure),
        )
        .route(
            "/story/clock-presentations",
            post(acknowledge_clock_presentation),
        )
        .route(
            "/story/first-tale-presentations",
            post(acknowledge_first_tale_presentation),
        )
        .route("/inspect", get(inspect_view))
        .route("/world", get(world_view))
        .route("/events", get(events_view))
        .route("/profiles", get(canonical_profile))
        .route("/invites", post(create_canonical_invite))
        .route("/invites/{invite_id}", get(canonical_invite))
        .route("/invites/{invite_id}/follow", post(follow_canonical_invite))
        .route("/parties/{party_id}/leave", post(leave_rendezvous_party))
        .route(
            "/parties/{party_id}/members/{guest_actor_id}/remove",
            post(remove_rendezvous_party_member_action),
        )
        .route(
            "/parties/{party_id}/revoke",
            post(revoke_rendezvous_party_action),
        )
        .route("/moderation/activation", get(activation_metrics_view))
        .route(
            "/moderation/activation/{player_ref}/delete",
            post(delete_story_metrics_for_player),
        )
        .route("/moderation/events", get(moderation_events_view))
        .route("/moderation/reports", get(moderation_reports_view))
        .route(
            "/moderation/reports/{report_id}/resolve",
            post(moderation_resolve_report),
        )
        .route(
            "/moderation/reports/{report_id}/delete",
            post(moderation_delete_report),
        )
        .route("/moderation/economy", get(moderation_economy_view))
        .route(
            "/moderation/media-verdicts",
            get(media_recipes::media_verdict::moderation_media_verdicts),
        )
        .route(
            "/moderation/media-verdicts/{record_id}",
            get(media_recipes::media_verdict::moderation_media_verdict)
                .post(media_recipes::media_verdict::moderation_update_media_verdict),
        )
        .route(
            "/moderation/community-art/{subject_kind}/{subject_id}/reject",
            post(moderation_reject_community_art),
        )
        .route(
            "/moderation/economy/reconciliations/{run_id}/resolve",
            post(moderation_resolve_economy_reconciliation),
        )
        .route(
            "/moderation/actors/{actor_id}/suspend",
            post(moderation_suspend_actor),
        )
        .route(
            "/moderation/actors/{actor_id}/unsuspend",
            post(moderation_unsuspend_actor),
        )
        .route(
            "/moderation/card-policy/treasure-objectives",
            post(start_treasure_objective),
        )
        .route("/dev/reset", post(dev_reset))
        .route(
            "/avatar",
            post(super::account_avatars::create_avatar_for_account),
        )
        .route("/auth/avatar", post(super::account_avatars::account_avatar))
        .route(
            "/avatar/session",
            post(super::actor_presence::renew_avatar_session),
        )
        .route("/avatar/class", post(choose_avatar_class))
        .route("/presence/ping", post(ping_presence))
        .route("/presence/leave", post(leave_presence))
        .route("/actions/submit", post(submit_action_offer))
        .route("/actions/timeout", post(request_turn_timeout))
        .route("/actions/need-time", post(request_turn_need_time))
        .route("/actions/pass", post(legacy_pass_requires_certificate))
        .route("/actions/narrative-move", post(submit_narrative_move))
        .route("/actions/chat", post(legacy_action_requires_certificate))
        .route(
            "/actions/model-interaction",
            post(legacy_action_requires_certificate),
        )
        .route("/actions/fund-image", post(fund_community_image))
        .route("/media/room-scenes", post(create_room_scene))
        .route("/media/room-scenes/{job_id}", get(room_scene_status))
        .route(
            "/moderation/room-scenes/{job_id}/review",
            post(review_room_scene),
        )
        .route("/actions/report", post(report_actor))
        .route("/actions/move", post(legacy_action_requires_certificate))
        .route(
            "/actions/explore-path",
            post(legacy_action_requires_certificate),
        )
        .route(
            "/actions/discover",
            post(legacy_action_requires_certificate),
        )
        .route("/actions/check", post(legacy_action_requires_certificate))
        .route("/actions/notice", post(legacy_action_requires_certificate))
        .route("/actions/study", post(legacy_action_requires_certificate))
        .route(
            "/actions/influence",
            post(legacy_action_requires_certificate),
        )
        .route(
            "/actions/cast-spell",
            post(legacy_action_requires_certificate),
        )
        .route("/actions/pick-up", post(legacy_action_requires_certificate))
        .route("/actions/drop", post(legacy_action_requires_certificate))
        .route(
            "/actions/use-item",
            post(legacy_action_requires_certificate),
        )
        .route(
            "/actions/give-item",
            post(legacy_action_requires_certificate),
        )
        .route(
            "/actions/trade-item",
            post(legacy_action_requires_certificate),
        )
        .route("/actions/transfer-offer", post(resolve_transfer_offer))
        .route("/actions/actor-safety", post(set_actor_safety))
        .route("/actions/request-gift", post(request_gift_auto_accept))
        .route("/actions/theft", post(legacy_action_requires_certificate))
        .route("/actions/craft", post(legacy_action_requires_certificate))
        .route(
            "/actions/declare-combat",
            post(legacy_action_requires_certificate),
        )
        .route("/actions/attack", post(legacy_action_requires_certificate))
        .route("/actions/defend", post(legacy_action_requires_certificate))
        .route("/actions/prepare", post(legacy_action_requires_certificate))
        .route(
            "/actions/contribute",
            post(legacy_action_requires_certificate),
        )
        .route("/actions/work", post(legacy_action_requires_certificate))
        .route("/actions/help", post(legacy_action_requires_certificate))
        .route("/actions/rest", post(legacy_action_requires_certificate))
        .route("/actions/bank-ledger", post(bank_ledger))
        .route("/actions/revise-calling", post(revise_calling))
        // Releasing a knocked-out avatar is a lifecycle action with no dealt
        // offer, so it needs its own route rather than an offer certificate.
        .route("/actions/abandon-avatar", post(abandon_avatar))
        .route(
            "/actions/create-bond",
            post(legacy_action_requires_certificate),
        )
        .route("/actions/revise-bond", post(revise_bond))
        .route("/actions/train-skill", post(train_skill))
        .route("/actions/unlock-charm-slot", post(unlock_charm_slot))
        .route("/actions/set-charm-equipped", post(set_charm_equipped))
        .route("/actions/set-spell-prepared", post(set_spell_prepared))
        .route("/actions/set-item-equipped", post(set_item_equipped))
        .route("/actions/set-item-contained", post(set_item_contained))
        .route(
            "/actions/resolve-bond",
            post(legacy_action_requires_certificate),
        )
        .route("/actions/flee", post(legacy_action_requires_certificate))
        .route(
            "/commands",
            post(command).layer(middleware::from_fn_with_state(
                command_capacity,
                command_admission,
            )),
        )
        .route(
            "/internal/canonical/commands",
            post(internal_canonical_command),
        )
        .route(
            "/internal/canonical/presence",
            post(internal_canonical_presence),
        )
        .route(
            "/internal/canonical/invites/follow",
            post(internal_follow_canonical_invite),
        )
        .route(
            "/internal/canonical/ownership/handoff",
            post(internal_canonical_ownership_handoff),
        )
        .route(
            "/internal/canonical/regions/checkpoint",
            post(internal_canonical_region_checkpoint),
        )
        .route(
            "/internal/canonical/regions/promote",
            post(internal_canonical_region_promote),
        )
        .route(
            "/internal/canonical/imports",
            post(internal_canonical_legacy_import),
        )
        .route("/stream", get(stream).layer(Extension(shutdown.clone())))
        // Action handlers return JSON envelopes with their authoritative
        // status field. Promote that field to the HTTP status after handlers
        // finish, before compression obscures the JSON body.
        .layer(middleware::map_response(action_response_http_status))
        // Extractor and method rejections happen before the command handler.
        // Normalize those last so /commands never leaks Axum's plain-text body.
        .layer(middleware::from_fn(command_response_json_contract))
        // Existing keep-alive connections must not submit fresh work after the
        // process begins draining. Liveness remains available to distinguish a
        // draining process from a dead one.
        .layer(middleware::from_fn_with_state(shutdown, shutdown_admission))
        .layer(CompressionLayer::new())
        .layer(CorsLayer::permissive())
        .layer(middleware::from_fn_with_state(
            request_log_context,
            request_observability,
        ))
        .with_state(state)
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

    let mut response = if request.uri().path() == "/commands" {
        canonical_command_error_with_kind(
            "",
            503,
            "The server is restarting. Reconnect and retry with the same intent_id.",
            Some(CommandErrorKind::ServerUnavailable),
        )
        .into_response()
    } else {
        Json(serde_json::json!({
            "ok": false,
            "status": 503,
            "error": "server_draining",
            "output": "The server is restarting. Reconnect and retry."
        }))
        .into_response()
    };
    *response.status_mut() = StatusCode::SERVICE_UNAVAILABLE;
    response
        .headers_mut()
        .insert(header::RETRY_AFTER, HeaderValue::from_static("1"));
    response
        .headers_mut()
        .insert(header::CONNECTION, HeaderValue::from_static("close"));
    response
}

async fn command_admission(
    State(command_capacity): State<Arc<Semaphore>>,
    request: Request,
    next: Next,
) -> Response {
    let Ok(_permit) = command_capacity.try_acquire() else {
        let mut response = canonical_command_error_with_kind(
            "",
            503,
            "The world is busy. Retry this command with the same intent_id.",
            Some(CommandErrorKind::ServerOverloaded),
        )
        .into_response();
        *response.status_mut() = StatusCode::SERVICE_UNAVAILABLE;
        response
            .headers_mut()
            .insert(header::RETRY_AFTER, HeaderValue::from_static("1"));
        return response;
    };
    next.run(request).await
}

async fn command_response_json_contract(request: Request, next: Next) -> Response {
    let is_command = request.uri().path() == "/commands";
    let response = next.run(request).await;
    if !is_command
        || !(response.status().is_client_error() || response.status().is_server_error())
        || response
            .headers()
            .get(header::CONTENT_TYPE)
            .and_then(|value| value.to_str().ok())
            .is_some_and(|value| value.starts_with("application/json"))
    {
        return response;
    }

    let status = response.status();
    let error_kind = if status.is_server_error() {
        CommandErrorKind::ServerUnavailable
    } else {
        CommandErrorKind::InvalidRequest
    };
    let output = match status {
        StatusCode::BAD_REQUEST => "The command request body is invalid JSON.",
        StatusCode::METHOD_NOT_ALLOWED => "POST this command as JSON.",
        StatusCode::PAYLOAD_TOO_LARGE => "The command request body is too large.",
        StatusCode::UNSUPPORTED_MEDIA_TYPE => {
            "Send the command with Content-Type: application/json."
        }
        StatusCode::UNPROCESSABLE_ENTITY => {
            "The command request is missing required fields or has invalid field values."
        }
        StatusCode::TOO_MANY_REQUESTS => {
            "Too many command requests. Retry with the same intent_id."
        }
        status if status.is_server_error() => {
            "The command could not be served. Retry with the same intent_id."
        }
        _ => "The command request was rejected. Refresh and retry.",
    };
    let allow = response.headers().get(header::ALLOW).cloned();
    let retry_after = response.headers().get(header::RETRY_AFTER).cloned();
    let mut replacement =
        canonical_command_error_with_kind("", u32::from(status.as_u16()), output, Some(error_kind))
            .into_response();
    *replacement.status_mut() = status;
    if let Some(value) = allow {
        replacement.headers_mut().insert(header::ALLOW, value);
    }
    if let Some(value) = retry_after {
        replacement.headers_mut().insert(header::RETRY_AFTER, value);
    }
    replacement
}

pub(super) async fn action_response_http_status(response: Response) -> Response {
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
            let mut response = canonical_command_error_with_kind(
                "",
                500,
                "The response could not be encoded. Retry with the same intent_id.",
                Some(CommandErrorKind::ResponseEncodingFailed),
            )
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
    use axum::body::Bytes;
    use tower::ServiceExt;

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
        let app = app_router(test_app_state(RuntimeWorld::seeded(), None));
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

    fn request(method: &str, body: Body, content_type: Option<&str>) -> Request {
        let mut builder = Request::builder().method(method).uri("/commands");
        if let Some(content_type) = content_type {
            builder = builder.header(header::CONTENT_TYPE, content_type);
        }
        let mut request = builder.body(body).expect("command request");
        request.extensions_mut().insert(ConnectInfo(
            "127.0.0.1:12345"
                .parse::<SocketAddr>()
                .expect("test address"),
        ));
        request
    }

    async fn assert_command_error(
        response: Response,
        expected_status: StatusCode,
    ) -> CommandResponse {
        assert_eq!(response.status(), expected_status);
        assert!(response
            .headers()
            .get(header::CONTENT_TYPE)
            .and_then(|value| value.to_str().ok())
            .is_some_and(|value| value.starts_with("application/json")));
        let body = to_bytes(response.into_body(), 1024 * 1024)
            .await
            .expect("command error body");
        let payload: CommandResponse =
            serde_json::from_slice(&body).expect("parseable command error envelope");
        assert!(!payload.ok);
        assert_eq!(payload.status, u32::from(expected_status.as_u16()));
        assert!(payload
            .output
            .as_deref()
            .is_some_and(|output| !output.is_empty()));
        payload
    }

    fn registered_route_paths(router_source: &str) -> BTreeSet<&str> {
        router_source
            .split(".route(")
            .skip(1)
            .filter_map(|segment| segment.split('"').nth(1))
            .collect()
    }

    fn quoted_action_paths(source: &str) -> BTreeSet<&str> {
        source
            .split('"')
            .filter(|value| value.starts_with("/actions/"))
            .collect()
    }

    fn posted_action_paths(source: &str) -> BTreeSet<&str> {
        source
            .split("action(\"")
            .skip(1)
            .filter_map(|segment| segment.split('"').next())
            .filter(|path| path.starts_with("/actions/"))
            .collect()
    }

    /// The browser client posts a plain action path unless that path is offer
    /// bound, in which case it travels through /actions/submit with a
    /// certificate. A path that is neither served nor offer bound answers 404
    /// on every attempt: that is how Abandon Avatar shipped unreachable and
    /// left knocked-out players with no way back into play.
    #[test]
    fn every_client_action_path_stays_reachable() {
        let registered = registered_route_paths(include_str!("routes.rs"));
        let offer_bound_block = INDEX_HTML
            .split("const offerBoundPaths = new Set([")
            .nth(1)
            .and_then(|block| block.split("]);").next())
            .expect("the client declares its offer-bound action paths");
        let offer_bound = quoted_action_paths(offer_bound_block);
        assert!(offer_bound.contains("/actions/chat"));
        let posted = posted_action_paths(INDEX_HTML);
        assert!(posted.contains("/actions/abandon-avatar"));
        for path in posted {
            assert!(
                registered.contains(path) || offer_bound.contains(path),
                "the client posts to {path}, but no route serves it and it is not offer bound",
            );
        }
    }

    #[test]
    fn model_interaction_has_its_own_certificate_bound_path() {
        assert!(action_path_accepts_kind(
            "/actions/model-interaction",
            "model_interaction"
        ));
        assert!(!action_path_accepts_kind(
            "/actions/model-interaction",
            "chat"
        ));
    }

    #[tokio::test]
    async fn every_commands_rejection_is_a_parseable_json_envelope() {
        let app = app_router(test_app_state(RuntimeWorld::seeded(), None));
        let cases = [
            (
                request("POST", Body::from("{"), Some("application/json")),
                StatusCode::BAD_REQUEST,
            ),
            (
                request("POST", Body::from("{}"), Some("text/plain")),
                StatusCode::UNSUPPORTED_MEDIA_TYPE,
            ),
            (
                request("POST", Body::from("{}"), Some("application/json")),
                StatusCode::UNPROCESSABLE_ENTITY,
            ),
            (
                request("GET", Body::empty(), None),
                StatusCode::METHOD_NOT_ALLOWED,
            ),
            (
                request(
                    "POST",
                    Body::from(
                        r#"{"actor_id":18446744073709551615,"actor_session":null,"wallet_session":null}"#,
                    ),
                    Some("application/json"),
                ),
                StatusCode::NOT_FOUND,
            ),
        ];

        for (request, status) in cases {
            assert_command_error(
                app.clone()
                    .oneshot(request)
                    .await
                    .expect("command response"),
                status,
            )
            .await;
        }
    }

    #[tokio::test]
    async fn command_overload_is_json_and_does_not_queue_health() {
        let capacity = Arc::new(Semaphore::new(1));
        let _held = capacity
            .clone()
            .acquire_owned()
            .await
            .expect("hold command capacity");
        let app = app_router_with_command_capacity(
            test_app_state(RuntimeWorld::seeded(), None),
            capacity,
        );
        let command = request(
            "POST",
            Body::from(r#"{"actor_id":1,"actor_session":null,"wallet_session":null}"#),
            Some("application/json"),
        );
        let overloaded = assert_command_error(
            app.clone()
                .oneshot(command)
                .await
                .expect("overload response"),
            StatusCode::SERVICE_UNAVAILABLE,
        )
        .await;
        assert_eq!(
            overloaded.error_kind,
            Some(CommandErrorKind::ServerOverloaded)
        );

        let health = tokio::time::timeout(
            Duration::from_millis(100),
            app.oneshot(
                Request::builder()
                    .uri("/health/live")
                    .body(Body::empty())
                    .expect("health request"),
            ),
        )
        .await
        .expect("health must bypass command admission")
        .expect("health response");
        assert_eq!(health.status(), StatusCode::OK);
    }

    #[tokio::test]
    async fn shutdown_rejects_new_work_but_keeps_liveness_available() {
        let (trigger, shutdown) = shutdown_channel();
        let app = app_router_with_shutdown(test_app_state(RuntimeWorld::seeded(), None), shutdown);
        trigger.notify(ShutdownReason::Test);

        let command = request(
            "POST",
            Body::from(r#"{"actor_id":1,"actor_session":null,"wallet_session":null}"#),
            Some("application/json"),
        );
        let draining = assert_command_error(
            app.clone()
                .oneshot(command)
                .await
                .expect("draining response"),
            StatusCode::SERVICE_UNAVAILABLE,
        )
        .await;
        assert_eq!(
            draining.error_kind,
            Some(CommandErrorKind::ServerUnavailable)
        );

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
        let payload = assert_command_error(
            action_response_http_status(response).await,
            StatusCode::INTERNAL_SERVER_ERROR,
        )
        .await;
        assert_eq!(
            payload.error_kind,
            Some(CommandErrorKind::ResponseEncodingFailed)
        );
    }
}
