use axum::{
    extract::{ConnectInfo, State},
    Json,
};
use serde::Serialize;
use std::collections::BTreeSet;
use std::net::SocketAddr;

use super::*;

pub(super) const ORDERED_SCENE_BASE_GRACE_MS: u64 = 45_000;
pub(super) const ORDERED_SCENE_NEED_TIME_MS: u64 = 60_000;

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(super) enum ConcurrencyPolicy {
    Concurrent,
    TargetSerialized,
    SceneTurn,
    #[allow(dead_code)]
    GovernedChoice,
}

impl ConcurrencyPolicy {
    pub(super) const fn as_str(self) -> &'static str {
        match self {
            Self::Concurrent => "concurrent",
            Self::TargetSerialized => "target-serialized",
            Self::SceneTurn => "scene-turn",
            Self::GovernedChoice => "governed-choice",
        }
    }
}

#[derive(Clone, Debug, Serialize)]
pub(super) struct RoomTurnView {
    pub enabled: bool,
    pub policy: &'static str,
    pub scene_kind: Option<&'static str>,
    pub explanation: Option<String>,
    pub room_id: u64,
    pub current_actor_id: Option<u64>,
    pub current_actor_name: Option<String>,
    pub is_current_actor: bool,
    pub can_pass: bool,
    pub can_need_time: bool,
    pub grace_period_ms: u64,
    pub need_time_extension_ms: u64,
    pub handoff_key: Option<String>,
    // Legacy fields remain in the wire shape for old clients. Ordinary rooms no
    // longer create a ping or a reflex countdown.
    pub can_request_timeout: bool,
    pub timeout_requests: Vec<u64>,
    pub waiting_actor_ids: Vec<u64>,
    pub ping_active: bool,
    pub ping_remaining_ms: u64,
    pub ping_expires_at_ms: Option<u64>,
    pub ping_responder_ids: Vec<u64>,
    pub ping_target_actor_id: Option<u64>,
    pub round: u64,
}

impl RoomTurnView {
    pub(super) fn idle(room_id: u64) -> Self {
        Self {
            enabled: false,
            policy: ConcurrencyPolicy::Concurrent.as_str(),
            scene_kind: None,
            explanation: None,
            room_id,
            current_actor_id: None,
            current_actor_name: None,
            is_current_actor: false,
            can_pass: false,
            can_need_time: false,
            grace_period_ms: 0,
            need_time_extension_ms: 0,
            handoff_key: None,
            can_request_timeout: false,
            timeout_requests: Vec::new(),
            waiting_actor_ids: Vec::new(),
            ping_active: false,
            ping_remaining_ms: 0,
            ping_expires_at_ms: None,
            ping_responder_ids: Vec::new(),
            ping_target_actor_id: None,
            round: 0,
        }
    }
}

pub(super) fn action_concurrency_policy(kind: u8) -> ConcurrencyPolicy {
    match kind {
        CW_ACTION_COMBAT_START
        | CW_ACTION_COMBAT_JOIN
        | CW_ACTION_COMBAT_ATTACK
        | CW_ACTION_COMBAT_FINESSE_ATTACK
        | CW_ACTION_COMBAT_DODGE
        | CW_ACTION_COMBAT_ESCAPE
        | CW_ACTION_COMBAT_PASS
        | CW_ACTION_COMBAT_NEED_TIME => ConcurrencyPolicy::SceneTurn,
        CW_ACTION_PICK_UP_ITEM
        | CW_ACTION_DROP_ITEM
        | CW_ACTION_USE_ITEM
        | CW_ACTION_GIVE_ITEM
        | CW_ACTION_TRADE_ITEM
        | CW_ACTION_CRAFT
        | CW_ACTION_THEFT => ConcurrencyPolicy::TargetSerialized,
        _ => ConcurrencyPolicy::Concurrent,
    }
}

pub(super) fn command_concurrency_policy(dispatch: &CommandDispatch) -> ConcurrencyPolicy {
    match dispatch {
        CommandDispatch::Attack { .. } | CommandDispatch::Defend | CommandDispatch::Flee { .. } => {
            ConcurrencyPolicy::SceneTurn
        }
        CommandDispatch::PickUp { .. }
        | CommandDispatch::Drop { .. }
        | CommandDispatch::UseItem { .. }
        | CommandDispatch::UseFeature { .. }
        | CommandDispatch::GiveItem { .. }
        | CommandDispatch::TradeItem { .. }
        | CommandDispatch::ResolveTransferOffer { .. }
        | CommandDispatch::RequestGift { .. }
        | CommandDispatch::Theft { .. }
        | CommandDispatch::Craft { .. }
        | CommandDispatch::Work
        | CommandDispatch::Help
        | CommandDispatch::CreateBond { .. }
        | CommandDispatch::ReviseBond { .. }
        | CommandDispatch::ResolveBond { .. }
        | CommandDispatch::Influence { .. }
        | CommandDispatch::CastSpell { .. }
        | CommandDispatch::SetCharmEquipped { .. }
        | CommandDispatch::SetSpellPrepared { .. }
        | CommandDispatch::SetItemEquipped { .. }
        | CommandDispatch::SetItemContained { .. } => ConcurrencyPolicy::TargetSerialized,
        _ => ConcurrencyPolicy::Concurrent,
    }
}

pub(super) fn combat_need_time_used(
    runtime: &RuntimeWorld,
    encounter_id: u64,
    current_actor_id: u64,
) -> bool {
    let turn_started_seq = runtime
        .event_log
        .iter()
        .rev()
        .find(|event| {
            event.type_name == "combat.turn.started"
                && event.content_id == Some(encounter_id)
                && event.actor_id == Some(current_actor_id)
        })
        .map(|event| event.seq)
        .unwrap_or_default();
    runtime.event_log.iter().any(|event| {
        event.seq > turn_started_seq
            && event.type_name == "combat.need_time"
            && event.content_id == Some(encounter_id)
            && event.actor_id == Some(current_actor_id)
    })
}

pub(super) fn combat_turn_view(
    runtime: &RuntimeWorld,
    actor_id: u64,
    room_id: u64,
) -> Option<RoomTurnView> {
    let encounter = runtime.active_combat_encounter_for_actor(actor_id)?;
    let current_actor_id = runtime.combat_current_actor_id(encounter.id)?;
    let current_actor_name = runtime.actor_name(current_actor_id);
    let is_current_actor = current_actor_id == actor_id;
    let need_time_used = combat_need_time_used(runtime, encounter.id, current_actor_id);
    let waiting_actor_ids = encounter.participants[..encounter.participant_count]
        .iter()
        .filter(|participant| participant.flags & CW_COMBAT_PARTICIPANT_ESCAPED == 0)
        .map(|participant| participant.actor_id)
        .filter(|participant_id| *participant_id != current_actor_id)
        .collect::<Vec<_>>();
    let explanation = Some(format!(
        "Combat is an ordered scene. {} acts now; chat and inspection stay available.",
        current_actor_name
            .clone()
            .unwrap_or_else(|| format!("Avatar {current_actor_id}"))
    ));
    Some(RoomTurnView {
        enabled: true,
        policy: ConcurrencyPolicy::SceneTurn.as_str(),
        scene_kind: Some("combat"),
        explanation,
        room_id,
        current_actor_id: Some(current_actor_id),
        current_actor_name,
        is_current_actor,
        can_pass: is_current_actor,
        can_need_time: is_current_actor && !need_time_used,
        grace_period_ms: ORDERED_SCENE_BASE_GRACE_MS.saturating_add(
            need_time_used
                .then_some(ORDERED_SCENE_NEED_TIME_MS)
                .unwrap_or_default(),
        ),
        need_time_extension_ms: ORDERED_SCENE_NEED_TIME_MS,
        handoff_key: Some(format!(
            "combat:{}:{}:{}",
            encounter.id, encounter.round, current_actor_id
        )),
        can_request_timeout: false,
        timeout_requests: Vec::new(),
        waiting_actor_ids,
        ping_active: false,
        ping_remaining_ms: 0,
        ping_expires_at_ms: None,
        ping_responder_ids: Vec::new(),
        ping_target_actor_id: None,
        round: u64::from(encounter.round),
    })
}

pub(super) fn room_turn_view_for_runtime(
    _state: &AppState,
    runtime: &RuntimeWorld,
    location_id: u64,
    viewer_actor_id: Option<u64>,
    _active_actor_ids: &BTreeSet<u64>,
) -> RoomTurnView {
    viewer_actor_id
        .and_then(|actor_id| combat_turn_view(runtime, actor_id, location_id))
        .unwrap_or_else(|| RoomTurnView::idle(location_id))
}

pub(super) fn actor_room_turn_view(
    state: &AppState,
    runtime: &RuntimeWorld,
    actor_id: u64,
    active_actor_ids: &BTreeSet<u64>,
) -> Option<RoomTurnView> {
    let actor = runtime.actor_by_id(actor_id)?;
    Some(room_turn_view_for_runtime(
        state,
        runtime,
        actor.location_id,
        Some(actor_id),
        active_actor_ids,
    ))
}

fn ordered_scene_rejection_view(runtime: &RuntimeWorld, actor_id: u64) -> Option<RoomTurnView> {
    let actor = runtime.actor_by_id(actor_id)?;
    combat_turn_view(runtime, actor_id, actor.location_id)
}

fn actor_ordered_scene_rejection(
    runtime: &RuntimeWorld,
    actor_id: u64,
) -> Option<Json<ActionResponse>> {
    let view = ordered_scene_rejection_view(runtime, actor_id)?;
    let current_actor_id = view.current_actor_id;
    let type_name = if view.is_current_actor {
        "combat.action.required"
    } else {
        "combat.turn.waiting"
    };
    let events = vec![EventView {
        type_name: type_name.to_string(),
        success: false,
        reason: 20,
        actor_id: current_actor_id,
        actor_name: view.current_actor_name.clone(),
        location_id: Some(view.room_id),
        content: view.explanation.clone(),
        ..EventView::default()
    }];
    Some(Json(ActionResponse {
        ok: false,
        status: 423,
        events,
    }))
}

pub(super) fn actor_turn_rejection(
    _state: &AppState,
    runtime: &RuntimeWorld,
    actor_id: u64,
) -> Option<Json<ActionResponse>> {
    actor_ordered_scene_rejection(runtime, actor_id)
}

pub(super) fn actor_action_turn_rejection(
    _state: &AppState,
    runtime: &RuntimeWorld,
    action: &CwAction,
) -> Option<Json<ActionResponse>> {
    if action.kind == CW_ACTION_SAY
        || matches!(
            action_concurrency_policy(action.kind),
            ConcurrencyPolicy::SceneTurn
        )
    {
        return None;
    }
    actor_ordered_scene_rejection(runtime, action.actor_id)
}

pub(super) fn command_dispatch_consumes_room_turn(dispatch: &CommandDispatch) -> bool {
    if command_concurrency_policy(dispatch) == ConcurrencyPolicy::SceneTurn {
        return false;
    }
    !matches!(
        dispatch,
        CommandDispatch::Read { .. }
            | CommandDispatch::Disabled { .. }
            | CommandDispatch::Say { .. }
            | CommandDispatch::Emote { .. }
            | CommandDispatch::Report { .. }
            | CommandDispatch::SetActorSafety { .. }
    )
}

pub(super) fn command_actor_turn_rejection(
    _state: &AppState,
    runtime: &RuntimeWorld,
    actor_id: u64,
    dispatch: &CommandDispatch,
) -> Option<RoomTurnView> {
    if matches!(
        dispatch,
        CommandDispatch::Attack { .. } | CommandDispatch::Defend | CommandDispatch::Flee { .. }
    ) {
        return None;
    }
    ordered_scene_rejection_view(runtime, actor_id)
}

pub(super) fn command_turn_rejected_response(
    resolved: ResolvedCommand,
    view: RoomTurnView,
    mut events: Vec<EventView>,
) -> Json<CommandResponse> {
    events.push(EventView {
        type_name: if view.is_current_actor {
            "combat.action.required".to_string()
        } else {
            "combat.turn.waiting".to_string()
        },
        success: false,
        reason: 20,
        actor_id: view.current_actor_id,
        actor_name: view.current_actor_name.clone(),
        location_id: Some(view.room_id),
        content: view.explanation.clone(),
        ..EventView::default()
    });
    Json(CommandResponse {
        ok: false,
        status: 423,
        command: resolved.command,
        verb: resolved.verb,
        output: view.explanation,
        action: resolved.action,
        receipt: None,
        events,
    })
}

pub(super) fn advance_actor_room_turn_after_commit(
    state: &AppState,
    runtime: &RuntimeWorld,
    _location_id: Option<u64>,
    actor_id: u64,
    status: u32,
    events: &[EventView],
) {
    if status != CW_OK || events.is_empty() {
        return;
    }
    if let Some(event) = events
        .iter()
        .find(|event| event.success && event.actor_id == Some(actor_id))
        .or_else(|| events.iter().find(|event| event.success))
    {
        record_first_turn_committed(state, actor_id, event.seq);
    }
    if let Some(event_seq) = runtime.first_tale_trace_event_seq(actor_id) {
        record_first_public_trace(state, actor_id, event_seq);
    }
}

pub(super) async fn request_turn_timeout(
    ConnectInfo(client_addr): ConnectInfo<SocketAddr>,
    State(state): State<AppState>,
    Json(payload): Json<ActorRequest>,
) -> Json<ActionResponse> {
    if !allow_actor_mutation(
        &state,
        client_addr,
        payload.actor_id,
        "turn-need-time",
        GENERAL_ACTION_LIMIT,
    ) {
        return action_rate_limited_response();
    }
    apply_combat_choice(
        state,
        payload.actor_id,
        CombatChoice::NeedTime,
        payload.actor_session.as_deref(),
    )
    .await
}

pub(super) async fn pass_ordered_scene_turn(
    ConnectInfo(client_addr): ConnectInfo<SocketAddr>,
    State(state): State<AppState>,
    Json(payload): Json<ActorRequest>,
) -> Json<ActionResponse> {
    if !allow_actor_mutation(
        &state,
        client_addr,
        payload.actor_id,
        "turn-pass",
        GENERAL_ACTION_LIMIT,
    ) {
        return action_rate_limited_response();
    }
    apply_combat_choice(
        state,
        payload.actor_id,
        CombatChoice::Pass,
        payload.actor_session.as_deref(),
    )
    .await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ordinary_operations_have_explicit_concurrency_policies() {
        assert_eq!(
            action_concurrency_policy(CW_ACTION_MOVE),
            ConcurrencyPolicy::Concurrent
        );
        assert_eq!(
            action_concurrency_policy(CW_ACTION_PICK_UP_ITEM),
            ConcurrencyPolicy::TargetSerialized
        );
        assert_eq!(
            action_concurrency_policy(CW_ACTION_COMBAT_ATTACK),
            ConcurrencyPolicy::SceneTurn
        );
        assert_eq!(
            ConcurrencyPolicy::GovernedChoice.as_str(),
            "governed-choice"
        );
    }

    #[test]
    fn command_policy_is_about_targets_not_controller_kind() {
        assert_eq!(
            command_concurrency_policy(&CommandDispatch::Move {
                destination_location_id: 2,
            }),
            ConcurrencyPolicy::Concurrent
        );
        assert_eq!(
            command_concurrency_policy(&CommandDispatch::PickUp { item_id: 2001 }),
            ConcurrencyPolicy::TargetSerialized
        );
        assert_eq!(
            command_concurrency_policy(&CommandDispatch::Defend),
            ConcurrencyPolicy::SceneTurn
        );
    }

    #[test]
    fn ordinary_rooms_never_enable_a_global_turn() {
        let runtime = RuntimeWorld::seeded();
        assert!(combat_turn_view(&runtime, 1001, 1).is_none());
        let view = RoomTurnView::idle(1);
        assert!(!view.enabled);
        assert_eq!(view.policy, "concurrent");
        assert!(!view.ping_active);
        assert_eq!(view.grace_period_ms, 0);
    }

    #[test]
    fn safety_commands_never_wait_for_an_ordered_scene() {
        assert!(!command_dispatch_consumes_room_turn(
            &CommandDispatch::SetActorSafety {
                target_actor_id: 1001,
                control: ActorSafetyControl::Mute,
                enabled: true,
            }
        ));
    }
}
