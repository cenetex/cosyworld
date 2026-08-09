use axum::{
    middleware,
    routing::{get, post},
    Router,
};
use tower_http::{compression::CompressionLayer, cors::CorsLayer, trace::TraceLayer};

use super::*;

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
        "/actions/check" => kind == "check",
        "/actions/study" => kind == "study",
        "/actions/influence" => kind == "influence",
        "/actions/cast-spell" => kind == "cast_spell",
        "/actions/pick-up" => kind == "pick_up",
        "/actions/drop" => kind == "drop_item",
        "/actions/use-item" => matches!(kind, "use_item" | "use_feature"),
        "/actions/give-item" => kind == "give_item",
        "/actions/trade-item" => kind == "trade_item",
        "/actions/theft" => kind == "theft",
        "/actions/craft" => kind == "craft",
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

pub(super) fn app_router(state: AppState) -> Router {
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
        .route("/nft/boxes/burn-prepare", post(box_burn_prepare))
        .route("/nft/boxes/burn-confirm", post(box_burn_confirm))
        .route("/nft/packs/open", post(pack_open))
        .route("/state", get(state_view))
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
        .route("/parties/{party_id}/leave", post(leave_hosted_party))
        .route(
            "/parties/{party_id}/members/{guest_actor_id}/remove",
            post(remove_hosted_party_member_action),
        )
        .route(
            "/parties/{party_id}/revoke",
            post(revoke_hosted_party_action),
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
        .route("/avatar", post(create_avatar))
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
        .route("/collection/materialize", post(materialize_collection_item))
        .route(
            "/collection/unmaterialize",
            post(unmaterialize_collection_item),
        )
        .route(
            "/actions/resolve-bond",
            post(legacy_action_requires_certificate),
        )
        .route("/actions/flee", post(legacy_action_requires_certificate))
        .route("/commands", post(command))
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
        .route("/stream", get(stream))
        // Action handlers return JSON envelopes with their authoritative
        // status field. Promote that field to the HTTP status after handlers
        // finish, before compression obscures the JSON body.
        .layer(middleware::map_response(action_response_http_status))
        .layer(CompressionLayer::new())
        .layer(TraceLayer::new_for_http())
        .layer(CorsLayer::permissive())
        .with_state(state)
}

#[cfg(test)]
mod tests {
    use super::*;

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
}
