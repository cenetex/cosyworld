use axum::{
    routing::{get, post},
    Router,
};
use tower_http::{cors::CorsLayer, trace::TraceLayer};

use super::*;

pub(super) fn app_router(state: AppState) -> Router {
    Router::new()
        .route("/", get(index))
        .route("/moderation", get(moderation_console))
        .route(
            "/assets/locations/cosy-cottage.png",
            get(cosy_cottage_asset),
        )
        .route("/assets/cards/{card_file}", get(ruby_high_card_asset))
        .route(
            "/assets/lonely-forest/characters/{asset_file}",
            get(lonely_forest_character_asset),
        )
        .route(
            "/assets/generated/cards/{card_file}",
            get(generated_seed_card_asset),
        )
        .route(
            "/assets/generated/avatars/{avatar_file}",
            get(generated_avatar_asset),
        )
        .route(
            "/assets/generated/boxes/{box_state}/{box_file}",
            get(generated_box_asset),
        )
        .route("/assets/cosy-cottage.png", get(cosy_cottage_asset))
        .route("/assets/rati.png", get(legacy_rati_asset))
        .route("/health", get(health))
        .route("/meta", get(meta))
        .route("/wallet/challenge", get(wallet_challenge))
        .route("/wallet/session", post(wallet_session))
        .route("/wallet/qr/start", post(wallet_qr_start))
        .route("/wallet/qr/status", get(wallet_qr_status))
        .route("/wallet/qr/{login_id}/code.svg", get(wallet_qr_code))
        .route("/wallet/qr/{login_id}", get(wallet_qr_page))
        .route("/nft/boxes/burn-prepare", post(box_burn_prepare))
        .route("/nft/boxes/burn-confirm", post(box_burn_confirm))
        .route("/nft/packs/open", post(pack_open))
        .route("/state", get(state_view))
        .route("/inspect", get(inspect_view))
        .route("/world", get(world_view))
        .route("/events", get(events_view))
        .route("/moderation/activation", get(activation_metrics_view))
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
            "/moderation/actors/{actor_id}/suspend",
            post(moderation_suspend_actor),
        )
        .route(
            "/moderation/actors/{actor_id}/unsuspend",
            post(moderation_unsuspend_actor),
        )
        .route("/dev/reset", post(dev_reset))
        .route("/avatar", post(create_avatar))
        .route("/presence/ping", post(ping_presence))
        .route("/presence/leave", post(leave_presence))
        .route("/actions/timeout", post(request_turn_timeout))
        .route("/actions/narrative-move", post(submit_narrative_move))
        .route("/actions/chat", post(chat))
        .route("/actions/say", post(say))
        .route("/actions/report", post(report_actor))
        .route("/actions/move", post(move_actor))
        .route("/actions/check", post(ability_check))
        .route("/actions/pick-up", post(pick_up_item))
        .route("/actions/drop", post(drop_item))
        .route("/actions/use-item", post(use_item))
        .route("/actions/give-item", post(give_item))
        .route("/actions/trade-item", post(trade_item))
        .route("/actions/craft", post(craft))
        .route("/actions/attack", post(attack))
        .route("/actions/defend", post(defend))
        .route("/actions/prepare", post(prepare))
        .route("/actions/work", post(work))
        .route("/actions/help", post(help_room))
        .route("/actions/rest", post(rest))
        .route("/actions/bank-ledger", post(bank_ledger))
        .route("/actions/revise-calling", post(revise_calling))
        .route("/actions/create-bond", post(create_bond))
        .route("/actions/revise-bond", post(revise_bond))
        .route("/actions/train-skill", post(train_skill))
        .route("/actions/resolve-bond", post(resolve_bond))
        .route("/actions/flee", post(flee))
        .route("/commands", post(command))
        .route("/stream", get(stream))
        .layer(TraceLayer::new_for_http())
        .layer(CorsLayer::permissive())
        .with_state(state)
}
