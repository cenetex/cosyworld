use axum::{
    extract::{ConnectInfo, State},
    Json,
};
use serde::{Deserialize, Serialize};
use std::collections::BTreeSet;
use std::net::SocketAddr;

use super::*;

pub(super) const ORDERED_SCENE_BASE_GRACE_MS: u64 = 45_000;
pub(super) const ORDERED_SCENE_NEED_TIME_MS: u64 = 60_000;
pub(super) const FOCUSED_ENCOUNTER_PROTOCOL: &str = "cosyworld.focused-encounter/1";
pub(super) const FOCUSED_COMBAT_PROFILE_ID: &str = "cosyworld.focused.combat";
pub(super) const FOCUSED_COMBAT_PROFILE_VERSION: u16 = 1;
pub(super) const FOCUSED_ENCOUNTER_JOURNAL_VERSION: u32 = 8;
const FOCUSED_ENCOUNTER_SCHEMA_VERSION: u8 = 1;
const FOCUSED_ENCOUNTER_MIN_PARTICIPANTS: usize = 2;
const FOCUSED_ENCOUNTER_MAX_PARTICIPANTS: usize = 6;

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub(super) enum FocusedActivationStep {
    Control,
    Setup,
    Commit,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub(super) struct FocusedEncounterJournalContext {
    pub(super) protocol: String,
    pub(super) encounter_id: u64,
    pub(super) profile_id: String,
    pub(super) profile_version: u16,
    pub(super) activation_step: FocusedActivationStep,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
pub(super) struct FocusedActivationBudget {
    pub(super) setup_limit: u8,
    pub(super) setup_remaining: u8,
    pub(super) commit_remaining: u8,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
#[allow(dead_code)]
pub(super) struct FocusedActivationEffect {
    pub(super) advances_world: bool,
    pub(super) activation_complete: bool,
}

impl FocusedActivationBudget {
    fn new(setup_available: bool) -> Self {
        Self {
            setup_limit: u8::from(setup_available),
            setup_remaining: u8::from(setup_available),
            commit_remaining: 1,
        }
    }

    #[allow(dead_code)]
    fn consume(
        &mut self,
        step: FocusedActivationStep,
    ) -> Result<FocusedActivationEffect, &'static str> {
        match step {
            FocusedActivationStep::Control => Ok(FocusedActivationEffect {
                advances_world: false,
                activation_complete: false,
            }),
            FocusedActivationStep::Setup if self.setup_remaining > 0 => {
                self.setup_remaining = 0;
                Ok(FocusedActivationEffect {
                    advances_world: false,
                    activation_complete: false,
                })
            }
            FocusedActivationStep::Commit if self.commit_remaining > 0 => {
                self.commit_remaining = 0;
                self.setup_remaining = 0;
                Ok(FocusedActivationEffect {
                    advances_world: true,
                    activation_complete: true,
                })
            }
            FocusedActivationStep::Setup => Err("focused encounter setup already used"),
            FocusedActivationStep::Commit => Err("focused encounter commit already used"),
        }
    }
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
pub(super) struct FocusedEncounterNode {
    pub(super) id: String,
    pub(super) kind: String,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
pub(super) struct FocusedEncounterRelation {
    pub(super) from: String,
    pub(super) kind: String,
    pub(super) to: String,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
pub(super) struct FocusedEncounterCondition {
    pub(super) id: String,
    pub(super) source: String,
    pub(super) trigger: String,
    pub(super) expiry: String,
    pub(super) consumed: bool,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
pub(super) struct FocusedEncounterView {
    pub(super) schema_version: u8,
    pub(super) protocol: &'static str,
    pub(super) encounter_id: u64,
    pub(super) profile_id: String,
    pub(super) profile_version: u16,
    pub(super) location_id: u64,
    pub(super) phase: String,
    pub(super) concurrency_policy: &'static str,
    pub(super) participant_order: Vec<u64>,
    pub(super) current_actor_id: u64,
    pub(super) round: u64,
    pub(super) activation_budget: FocusedActivationBudget,
    pub(super) objective_clock_id: String,
    pub(super) danger_clock_id: Option<String>,
    pub(super) pressure_trigger: String,
    pub(super) local_nodes: Vec<FocusedEncounterNode>,
    pub(super) relations: Vec<FocusedEncounterRelation>,
    pub(super) conditions: Vec<FocusedEncounterCondition>,
    pub(super) completion_predicate: String,
    pub(super) stop_predicate: String,
    pub(super) retreat_predicate: String,
    pub(super) worldpack_bundle_hash: String,
    pub(super) rules_profile: String,
}

impl FocusedEncounterView {
    fn validate(&self) -> Result<(), &'static str> {
        if self.schema_version != FOCUSED_ENCOUNTER_SCHEMA_VERSION
            || self.protocol != FOCUSED_ENCOUNTER_PROTOCOL
            || self.encounter_id == 0
            || self.profile_id.trim().is_empty()
            || self.profile_version == 0
            || self.location_id == 0
            || self.phase.trim().is_empty()
            || self.concurrency_policy != ConcurrencyPolicy::SceneTurn.as_str()
            || self.objective_clock_id.trim().is_empty()
            || self.worldpack_bundle_hash.trim().is_empty()
            || self.rules_profile.trim().is_empty()
        {
            return Err("focused encounter contract is incomplete");
        }
        let max_participants = if self.profile_id == FOCUSED_COMBAT_PROFILE_ID {
            CW_MAX_COMBAT_PARTICIPANTS
        } else {
            FOCUSED_ENCOUNTER_MAX_PARTICIPANTS
        };
        if !(FOCUSED_ENCOUNTER_MIN_PARTICIPANTS..=max_participants)
            .contains(&self.participant_order.len())
            || self.participant_order.contains(&0)
            || self
                .participant_order
                .iter()
                .copied()
                .collect::<BTreeSet<_>>()
                .len()
                != self.participant_order.len()
            || !self.participant_order.contains(&self.current_actor_id)
        {
            return Err("focused encounter participant order is invalid");
        }
        Ok(())
    }

    fn waiting_actor_ids(&self) -> Vec<u64> {
        self.participant_order
            .iter()
            .copied()
            .filter(|actor_id| *actor_id != self.current_actor_id)
            .collect()
    }

    #[allow(dead_code)]
    fn pass(&mut self, actor_id: u64) -> Result<(), &'static str> {
        if actor_id != self.current_actor_id {
            return Err("only the current participant can pass");
        }
        let current_index = self
            .participant_order
            .iter()
            .position(|participant_id| *participant_id == actor_id)
            .ok_or("focused encounter current participant is missing")?;
        let next_index = (current_index + 1) % self.participant_order.len();
        if next_index == 0 {
            self.round = self.round.saturating_add(1);
        }
        self.current_actor_id = self.participant_order[next_index];
        self.activation_budget =
            FocusedActivationBudget::new(self.activation_budget.setup_limit > 0);
        Ok(())
    }
}

pub(super) fn focused_encounter_context_for_action(
    action: &CwAction,
) -> Option<FocusedEncounterJournalContext> {
    let activation_step = match action.kind {
        CW_ACTION_COMBAT_NEED_TIME => FocusedActivationStep::Control,
        CW_ACTION_COMBAT_START
        | CW_ACTION_COMBAT_JOIN
        | CW_ACTION_COMBAT_ATTACK
        | CW_ACTION_COMBAT_FINESSE_ATTACK
        | CW_ACTION_COMBAT_DODGE
        | CW_ACTION_COMBAT_ESCAPE
        | CW_ACTION_COMBAT_PASS => FocusedActivationStep::Commit,
        _ => return None,
    };
    (action.content_id != 0).then(|| FocusedEncounterJournalContext {
        protocol: FOCUSED_ENCOUNTER_PROTOCOL.to_string(),
        encounter_id: action.content_id,
        profile_id: FOCUSED_COMBAT_PROFILE_ID.to_string(),
        profile_version: FOCUSED_COMBAT_PROFILE_VERSION,
        activation_step,
    })
}

pub(super) fn focused_encounter_journal_context_is_supported(record: &JournalRecord) -> bool {
    let Some(expected) = focused_encounter_context_for_action(&record.action) else {
        return record.focused_encounter.is_none();
    };
    let Some(context) = record.focused_encounter.as_ref() else {
        // Historical combat rows predate this envelope and retain combat/1 semantics.
        return record.version < FOCUSED_ENCOUNTER_JOURNAL_VERSION;
    };
    context == &expected
}

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
    #[serde(skip_serializing_if = "Option::is_none")]
    pub focused: Option<FocusedEncounterView>,
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
            focused: None,
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
        CommandDispatch::Governance { .. } => ConcurrencyPolicy::GovernedChoice,
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

fn focused_combat_encounter(runtime: &RuntimeWorld, actor_id: u64) -> Option<FocusedEncounterView> {
    let encounter = runtime.active_combat_encounter_for_actor(actor_id)?;
    let job_id = runtime.combat_job_id_for_encounter(encounter.id)?;
    let job = runtime.jobs.get(&job_id)?;
    let current_actor_id = runtime.combat_current_actor_id(encounter.id)?;
    let participant_order = encounter.participants[..encounter.participant_count]
        .iter()
        .filter(|participant| participant.flags & CW_COMBAT_PARTICIPANT_ESCAPED == 0)
        .map(|participant| participant.actor_id)
        .collect::<Vec<_>>();
    let rules_profile = runtime
        .scene_rules_context(
            encounter.location_id,
            runtime.world.next_event_seq.saturating_sub(1),
        )
        .map(|context| context.rules_profile)
        .unwrap_or_else(|| active_content().manifest.rules_profile.clone());
    let focused = FocusedEncounterView {
        schema_version: FOCUSED_ENCOUNTER_SCHEMA_VERSION,
        protocol: FOCUSED_ENCOUNTER_PROTOCOL,
        encounter_id: encounter.id,
        profile_id: FOCUSED_COMBAT_PROFILE_ID.to_string(),
        profile_version: FOCUSED_COMBAT_PROFILE_VERSION,
        location_id: encounter.location_id,
        phase: "conflict".to_string(),
        concurrency_policy: ConcurrencyPolicy::SceneTurn.as_str(),
        participant_order,
        current_actor_id,
        round: u64::from(encounter.round),
        activation_budget: FocusedActivationBudget::new(false),
        objective_clock_id: job.progress_clock_id.clone(),
        danger_clock_id: (!job.danger_clock_id.trim().is_empty())
            .then(|| job.danger_clock_id.clone()),
        pressure_trigger: "activation_end".to_string(),
        local_nodes: Vec::new(),
        relations: Vec::new(),
        conditions: Vec::new(),
        completion_predicate: "objective_clock_completed".to_string(),
        stop_predicate: "hostility_resolved".to_string(),
        retreat_predicate: "participant_escaped".to_string(),
        worldpack_bundle_hash: active_content().manifest.bundle_hash.clone(),
        rules_profile,
    };
    focused.validate().ok()?;
    Some(focused)
}

pub(super) fn combat_turn_view(
    runtime: &RuntimeWorld,
    actor_id: u64,
    room_id: u64,
) -> Option<RoomTurnView> {
    let focused = focused_combat_encounter(runtime, actor_id)?;
    let current_actor_id = focused.current_actor_id;
    let current_actor_name = runtime.actor_name(current_actor_id);
    let is_current_actor = current_actor_id == actor_id;
    let need_time_used = combat_need_time_used(runtime, focused.encounter_id, current_actor_id);
    let waiting_actor_ids = focused.waiting_actor_ids();
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
        focused: Some(focused.clone()),
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
            focused.encounter_id, focused.round, current_actor_id
        )),
        can_request_timeout: false,
        timeout_requests: Vec::new(),
        waiting_actor_ids,
        ping_active: false,
        ping_remaining_ms: 0,
        ping_expires_at_ms: None,
        ping_responder_ids: Vec::new(),
        ping_target_actor_id: None,
        round: focused.round,
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
    if matches!(
        command_concurrency_policy(dispatch),
        ConcurrencyPolicy::SceneTurn | ConcurrencyPolicy::GovernedChoice
    ) {
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

pub(super) fn advance_turn_and_capture_player_tick_observation(
    state: &AppState,
    runtime: &mut RuntimeWorld,
    location_id: Option<u64>,
    actor_id: u64,
    status: u32,
    events: &mut Vec<EventView>,
) -> Option<PlayerTickObservation> {
    advance_actor_room_turn_after_commit(state, runtime, location_id, actor_id, status, events);
    let observation = player_tick_observation(runtime, location_id, actor_id, status, events);
    if status == CW_OK {
        append_action_receipt(state, runtime, actor_id, events);
    }
    observation
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
        assert!(view.focused.is_none());
        assert!(
            serde_json::to_value(&view)
                .expect("idle turn serializes")
                .get("focused")
                .is_none(),
            "ordinary rooms omit the focused encounter envelope"
        );
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

    #[test]
    fn combat_projects_the_versioned_focused_encounter_contract() {
        let mut runtime = RuntimeWorld::seeded();
        let create = JournalRecord::new(
            CwAction {
                kind: CW_ACTION_CREATE_ACTOR,
                actor_id: 5000,
                location_id: MOONLIT_TRAIL_LOCATION_ID,
                ..CwAction::default()
            },
            81_000,
        );
        assert_eq!(runtime.apply_journal_record(&create).0, CW_OK);

        let encounter_id = combat_encounter_id(MOONLIT_JOB_ID);
        let start = JournalRecord::new(
            CwAction {
                kind: CW_ACTION_COMBAT_START,
                actor_id: 5000,
                target_actor_id: MOONLIT_ECHO_ACTOR_ID,
                content_id: encounter_id,
                ..CwAction::default()
            },
            81_001,
        )
        .into_system();
        assert_eq!(runtime.apply_journal_record(&start).0, CW_OK);

        let focused =
            focused_combat_encounter(&runtime, 5000).expect("combat projects focused state");
        assert_eq!(focused.protocol, FOCUSED_ENCOUNTER_PROTOCOL);
        assert_eq!(focused.profile_id, FOCUSED_COMBAT_PROFILE_ID);
        assert_eq!(focused.profile_version, FOCUSED_COMBAT_PROFILE_VERSION);
        assert_eq!(focused.objective_clock_id, MOONLIT_PROGRESS_CLOCK_ID);
        assert_eq!(
            focused.danger_clock_id.as_deref(),
            Some(MOONLIT_DANGER_CLOCK_ID)
        );
        assert_eq!(focused.activation_budget.setup_limit, 0);
        assert_eq!(focused.activation_budget.setup_remaining, 0);
        assert_eq!(focused.activation_budget.commit_remaining, 1);
        assert_eq!(focused.pressure_trigger, "activation_end");
        assert!(focused.validate().is_ok());

        let turn = combat_turn_view(&runtime, 5000, MOONLIT_TRAIL_LOCATION_ID)
            .expect("combat turn uses focused projection");
        assert_eq!(turn.focused, Some(focused));
        assert_eq!(
            serde_json::to_value(&turn).expect("focused turn serializes")["focused"]["protocol"],
            FOCUSED_ENCOUNTER_PROTOCOL
        );
    }

    #[test]
    fn combat_and_work_share_one_scheduler_and_activation_budget() {
        let mut combat = FocusedEncounterView {
            schema_version: FOCUSED_ENCOUNTER_SCHEMA_VERSION,
            protocol: FOCUSED_ENCOUNTER_PROTOCOL,
            encounter_id: 90_001,
            profile_id: FOCUSED_COMBAT_PROFILE_ID.to_string(),
            profile_version: FOCUSED_COMBAT_PROFILE_VERSION,
            location_id: 3,
            phase: "conflict".to_string(),
            concurrency_policy: ConcurrencyPolicy::SceneTurn.as_str(),
            participant_order: vec![5000, 5001],
            current_actor_id: 5000,
            round: 1,
            activation_budget: FocusedActivationBudget::new(false),
            objective_clock_id: "coach-practice.objective".to_string(),
            danger_clock_id: Some("coach-practice.danger".to_string()),
            pressure_trigger: "activation_end".to_string(),
            local_nodes: Vec::new(),
            relations: Vec::new(),
            conditions: Vec::new(),
            completion_predicate: "objective_clock_completed".to_string(),
            stop_predicate: "yield".to_string(),
            retreat_predicate: "leave_practice".to_string(),
            worldpack_bundle_hash: "sha256:test".to_string(),
            rules_profile: "cosyworld.srd5/1".to_string(),
        };
        let mut work = FocusedEncounterView {
            encounter_id: 90_002,
            profile_id: "cosyworld.focused.work".to_string(),
            phase: "repair".to_string(),
            activation_budget: FocusedActivationBudget::new(true),
            objective_clock_id: "bridge-repair.progress".to_string(),
            danger_clock_id: Some("bridge-repair.delay".to_string()),
            stop_predicate: "work_withdrawn".to_string(),
            retreat_predicate: "materials_recovered".to_string(),
            ..combat.clone()
        };
        assert!(combat.validate().is_ok());
        assert!(work.validate().is_ok());

        let setup = work
            .activation_budget
            .consume(FocusedActivationStep::Setup)
            .expect("work setup");
        assert!(!setup.advances_world);
        assert!(!setup.activation_complete);
        let commit = work
            .activation_budget
            .consume(FocusedActivationStep::Commit)
            .expect("work commit");
        assert!(commit.advances_world);
        assert!(commit.activation_complete);
        assert!(work
            .activation_budget
            .consume(FocusedActivationStep::Commit)
            .is_err());

        combat.pass(5000).expect("combat pass");
        work.pass(5000).expect("work pass");
        assert_eq!(combat.current_actor_id, 5001);
        assert_eq!(work.current_actor_id, 5001);
        assert_eq!(combat.round, work.round);
        assert_eq!(combat.activation_budget.setup_remaining, 0);
        assert_eq!(work.activation_budget.setup_remaining, 1);
        assert_eq!(combat.activation_budget.commit_remaining, 1);
        assert_eq!(work.activation_budget.commit_remaining, 1);
    }

    #[test]
    fn focused_journal_context_defaults_historical_combat_and_fails_closed() {
        let action = CwAction {
            kind: CW_ACTION_COMBAT_ATTACK,
            actor_id: 5000,
            target_actor_id: 1004,
            content_id: 90_003,
            ..CwAction::default()
        };
        let record = JournalRecord::new(action, 81_002);
        let context = record
            .focused_encounter
            .as_ref()
            .expect("new combat row carries focused context");
        assert_eq!(context.protocol, FOCUSED_ENCOUNTER_PROTOCOL);
        assert_eq!(context.profile_id, FOCUSED_COMBAT_PROFILE_ID);
        assert_eq!(context.profile_version, FOCUSED_COMBAT_PROFILE_VERSION);
        assert_eq!(context.activation_step, FocusedActivationStep::Commit);
        assert!(focused_encounter_journal_context_is_supported(&record));

        let mut historical_json = serde_json::to_value(&record).expect("journal row serializes");
        historical_json["version"] = serde_json::json!(7);
        historical_json
            .as_object_mut()
            .expect("journal row object")
            .remove("focused_encounter");
        let historical: JournalRecord =
            serde_json::from_value(historical_json).expect("historical combat row defaults");
        assert!(focused_encounter_journal_context_is_supported(&historical));

        let mut missing_context = historical;
        missing_context.version = FOCUSED_ENCOUNTER_JOURNAL_VERSION;
        assert!(!focused_encounter_journal_context_is_supported(
            &missing_context
        ));

        let mut incompatible = record;
        incompatible
            .focused_encounter
            .as_mut()
            .expect("focused context")
            .profile_version += 1;
        let mut runtime = RuntimeWorld::seeded();
        let before = RuntimeSnapshot::from_runtime(&runtime);
        assert_eq!(runtime.apply_journal_record(&incompatible).0, CW_ERR_RULE);
        assert_eq!(
            serde_json::to_value(RuntimeSnapshot::from_runtime(&runtime)).unwrap(),
            serde_json::to_value(before).unwrap()
        );
    }
}
