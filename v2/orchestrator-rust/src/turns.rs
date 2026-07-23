use axum::{
    extract::{ConnectInfo, State},
    Json,
};
use serde::Serialize;
use std::collections::{BTreeMap, BTreeSet};
use std::net::SocketAddr;
use std::time::{Duration, Instant};

use super::*;

pub(super) const TURN_PING_COUNTDOWN: Duration = Duration::from_secs(8);
const PONG_INITIATIVE_BOOST: i16 = 1000;

#[derive(Clone, Debug)]
pub(super) struct RoomTurnActor {
    pub actor_id: u64,
    pub name: String,
    pub initiative: i16,
}

#[derive(Clone, Debug, Serialize)]
pub(super) struct RoomTurnView {
    pub enabled: bool,
    pub room_id: u64,
    pub current_actor_id: Option<u64>,
    pub current_actor_name: Option<String>,
    pub is_current_actor: bool,
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

#[derive(Clone, Debug)]
pub(super) struct RoomTurnOutcome {
    pub accepted: bool,
    pub ping_started: bool,
    pub pong_recorded: bool,
    pub advanced: bool,
    pub previous_actor_id: Option<u64>,
    pub event_actor_id: Option<u64>,
    pub ping_id: Option<u64>,
}

#[derive(Clone, Debug)]
struct RoomTurnPingState {
    id: u64,
    started_by_actor_id: u64,
    target_actor_id: Option<u64>,
    responder_ids: BTreeSet<u64>,
    expires_at: Instant,
}

#[derive(Clone, Debug, Default)]
struct RoomTurnState {
    current_actor_id: Option<u64>,
    timeout_requests: BTreeMap<u64, u64>,
    ping: Option<RoomTurnPingState>,
    round: u64,
}

#[derive(Debug, Default)]
pub(super) struct RoomTurns {
    rooms: BTreeMap<u64, RoomTurnState>,
    next_ping_id: u64,
}

impl RoomTurnView {
    pub(super) fn idle(room_id: u64) -> Self {
        Self {
            enabled: false,
            room_id,
            current_actor_id: None,
            current_actor_name: None,
            is_current_actor: false,
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

impl RoomTurns {
    pub(super) fn view(
        &mut self,
        room_id: u64,
        actors: &[RoomTurnActor],
        viewer_actor_id: Option<u64>,
    ) -> RoomTurnView {
        if actors.len() < 2 {
            self.rooms.remove(&room_id);
            return RoomTurnView::idle(room_id);
        }
        self.ensure_current_actor(room_id, actors);
        self.view_from_state(room_id, actors, viewer_actor_id)
    }

    pub(super) fn advance_after_action(
        &mut self,
        room_id: u64,
        actors: &[RoomTurnActor],
        actor_id: u64,
    ) -> RoomTurnView {
        if actors.len() < 2 {
            self.rooms.remove(&room_id);
            return RoomTurnView::idle(room_id);
        }
        self.ensure_current_actor(room_id, actors);
        if self
            .rooms
            .get(&room_id)
            .and_then(|state| state.current_actor_id)
            != Some(actor_id)
        {
            return self.view_from_state(room_id, actors, Some(actor_id));
        }
        let next_actor_id = self.next_actor_id_after(room_id, actors, actor_id);
        let state = self.rooms.entry(room_id).or_default();
        state.current_actor_id = next_actor_id;
        state.timeout_requests.clear();
        state.ping = None;
        state.round = state.round.saturating_add(1);
        self.view_from_state(room_id, actors, Some(actor_id))
    }

    pub(super) fn request_timeout(
        &mut self,
        room_id: u64,
        actors: &[RoomTurnActor],
        requester_actor_id: u64,
    ) -> RoomTurnOutcome {
        self.request_ping(room_id, actors, requester_actor_id, TURN_PING_COUNTDOWN)
    }

    pub(super) fn request_ping(
        &mut self,
        room_id: u64,
        actors: &[RoomTurnActor],
        requester_actor_id: u64,
        countdown: Duration,
    ) -> RoomTurnOutcome {
        if actors.len() < 2
            || !actors
                .iter()
                .any(|actor| actor.actor_id == requester_actor_id)
        {
            self.rooms.remove(&room_id);
            return RoomTurnOutcome {
                accepted: false,
                ping_started: false,
                pong_recorded: false,
                advanced: false,
                previous_actor_id: None,
                event_actor_id: None,
                ping_id: None,
            };
        }

        self.ensure_current_actor(room_id, actors);
        let previous_actor_id = self
            .rooms
            .get(&room_id)
            .and_then(|state| state.current_actor_id);
        if previous_actor_id == Some(requester_actor_id) {
            return RoomTurnOutcome {
                accepted: false,
                ping_started: false,
                pong_recorded: false,
                advanced: false,
                previous_actor_id,
                event_actor_id: None,
                ping_id: None,
            };
        }

        let now = Instant::now();
        let expires_at = now.checked_add(countdown).unwrap_or(now);
        {
            let state = self.rooms.entry(room_id).or_default();
            state.timeout_requests.clear();

            if let Some(ping) = state
                .ping
                .as_mut()
                .filter(|ping| ping.target_actor_id == previous_actor_id && ping.expires_at > now)
            {
                let pong_recorded = ping.responder_ids.insert(requester_actor_id);
                return RoomTurnOutcome {
                    accepted: true,
                    ping_started: false,
                    pong_recorded,
                    advanced: false,
                    previous_actor_id,
                    event_actor_id: Some(requester_actor_id).filter(|_| pong_recorded),
                    ping_id: Some(ping.id),
                };
            }
        }

        self.next_ping_id = self.next_ping_id.saturating_add(1).max(1);
        let ping_id = self.next_ping_id;
        let state = self.rooms.entry(room_id).or_default();
        state.ping = Some(RoomTurnPingState {
            id: ping_id,
            started_by_actor_id: requester_actor_id,
            target_actor_id: previous_actor_id,
            responder_ids: BTreeSet::from([requester_actor_id]),
            expires_at,
        });

        RoomTurnOutcome {
            accepted: true,
            ping_started: true,
            pong_recorded: true,
            advanced: false,
            previous_actor_id,
            event_actor_id: Some(requester_actor_id),
            ping_id: Some(ping_id),
        }
    }

    pub(super) fn resolve_ping(
        &mut self,
        room_id: u64,
        actors: &[RoomTurnActor],
        ping_id: u64,
    ) -> RoomTurnOutcome {
        if actors.len() < 2 {
            self.rooms.remove(&room_id);
            return RoomTurnOutcome {
                accepted: false,
                ping_started: false,
                pong_recorded: false,
                advanced: false,
                previous_actor_id: None,
                event_actor_id: None,
                ping_id: None,
            };
        }

        self.ensure_current_actor(room_id, actors);
        let Some(state) = self.rooms.get_mut(&room_id) else {
            return RoomTurnOutcome {
                accepted: false,
                ping_started: false,
                pong_recorded: false,
                advanced: false,
                previous_actor_id: None,
                event_actor_id: None,
                ping_id: None,
            };
        };
        let Some(ping) = state.ping.clone().filter(|ping| ping.id == ping_id) else {
            return RoomTurnOutcome {
                accepted: false,
                ping_started: false,
                pong_recorded: false,
                advanced: false,
                previous_actor_id: state.current_actor_id,
                event_actor_id: None,
                ping_id: None,
            };
        };

        let previous_actor_id = state.current_actor_id;
        if ping.target_actor_id != previous_actor_id {
            state.ping = None;
            return RoomTurnOutcome {
                accepted: false,
                ping_started: false,
                pong_recorded: false,
                advanced: false,
                previous_actor_id,
                event_actor_id: None,
                ping_id: Some(ping_id),
            };
        }

        let actor_ids = actors
            .iter()
            .map(|actor| actor.actor_id)
            .collect::<BTreeSet<_>>();
        let responder_ids = ping
            .responder_ids
            .iter()
            .copied()
            .filter(|actor_id| Some(*actor_id) != previous_actor_id && actor_ids.contains(actor_id))
            .collect::<BTreeSet<_>>();
        let next_actor_id = previous_actor_id.and_then(|actor_id| {
            next_actor_id_for_ping_responders(actors, actor_id, &responder_ids)
        });
        state.ping = None;

        let advanced = if next_actor_id.is_some() {
            state.current_actor_id = next_actor_id;
            state.timeout_requests.clear();
            state.round = state.round.saturating_add(1);
            true
        } else {
            false
        };

        RoomTurnOutcome {
            accepted: true,
            ping_started: false,
            pong_recorded: false,
            advanced,
            previous_actor_id,
            event_actor_id: Some(ping.started_by_actor_id),
            ping_id: Some(ping_id),
        }
    }

    fn ensure_current_actor(&mut self, room_id: u64, actors: &[RoomTurnActor]) {
        let ordered = ordered_actor_ids(actors);
        let state = self.rooms.entry(room_id).or_default();
        state
            .timeout_requests
            .retain(|actor_id, _| ordered.contains(actor_id));
        let current_still_present = state
            .current_actor_id
            .map(|actor_id| ordered.contains(&actor_id))
            .unwrap_or(false);
        if !current_still_present {
            state.current_actor_id = ordered.first().copied();
            state.timeout_requests.clear();
            state.ping = None;
            state.round = state.round.saturating_add(1);
        } else if state
            .ping
            .as_ref()
            .map(|ping| ping.target_actor_id != state.current_actor_id)
            .unwrap_or(false)
        {
            state.ping = None;
        }
    }

    fn next_actor_id_after(
        &self,
        room_id: u64,
        actors: &[RoomTurnActor],
        actor_id: u64,
    ) -> Option<u64> {
        self.rooms
            .get(&room_id)
            .and_then(|state| state.current_actor_id)
            .or(Some(actor_id))
            .and_then(|current| next_actor_id_in_order(actors, current))
    }

    fn view_from_state(
        &self,
        room_id: u64,
        actors: &[RoomTurnActor],
        viewer_actor_id: Option<u64>,
    ) -> RoomTurnView {
        let Some(state) = self.rooms.get(&room_id) else {
            return RoomTurnView::idle(room_id);
        };
        let current_actor_id = state.current_actor_id;
        let current_actor_name = current_actor_id
            .and_then(|id| actors.iter().find(|actor| actor.actor_id == id))
            .map(|actor| actor.name.clone());
        let waiting_actor_ids = waiting_actor_ids(actors, current_actor_id);
        let is_current_actor = viewer_actor_id
            .zip(current_actor_id)
            .map(|(viewer, current)| viewer == current)
            .unwrap_or(false);
        let can_request_timeout = viewer_actor_id
            .map(|viewer| !is_current_actor && waiting_actor_ids.contains(&viewer))
            .unwrap_or(false);
        let ping = state
            .ping
            .as_ref()
            .filter(|ping| ping.target_actor_id == current_actor_id);
        let ping_remaining_ms = ping
            .map(|ping| {
                duration_millis_u64(ping.expires_at.saturating_duration_since(Instant::now()))
            })
            .unwrap_or(0);
        let ping_expires_at_ms =
            (ping_remaining_ms > 0).then(|| now_millis().saturating_add(ping_remaining_ms));
        RoomTurnView {
            enabled: actors.len() >= 2,
            room_id,
            current_actor_id,
            current_actor_name,
            is_current_actor,
            can_request_timeout,
            timeout_requests: state.timeout_requests.keys().copied().collect(),
            waiting_actor_ids,
            ping_active: ping.is_some(),
            ping_remaining_ms,
            ping_expires_at_ms,
            ping_responder_ids: ping
                .map(|ping| ping.responder_ids.iter().copied().collect())
                .unwrap_or_default(),
            ping_target_actor_id: ping.and_then(|ping| ping.target_actor_id),
            round: state.round,
        }
    }
}

pub(super) fn initiative_bonus_from_dexterity(dexterity: i8) -> i16 {
    (i16::from(dexterity) - 10).div_euclid(2)
}

pub(super) fn room_turn_actors_for_location(
    runtime: &RuntimeWorld,
    active_direct_actor_ids: &BTreeSet<u64>,
    location_id: u64,
) -> Vec<RoomTurnActor> {
    runtime.world.actors[..runtime.world.actor_count]
        .iter()
        .filter(|actor| {
            RuntimeWorld::actor_is_active_avatar(**actor)
                && actor.location_id == location_id
                && active_direct_actor_ids.contains(&actor.id)
        })
        .map(|actor| RoomTurnActor {
            actor_id: actor.id,
            name: runtime
                .actor_name(actor.id)
                .unwrap_or_else(|| format!("Avatar {}", actor.id)),
            initiative: initiative_bonus_from_dexterity(actor.stats.dexterity),
        })
        .collect()
}

pub(super) fn room_turn_view_for_runtime(
    state: &AppState,
    runtime: &RuntimeWorld,
    location_id: u64,
    viewer_actor_id: Option<u64>,
    active_direct_actor_ids: &BTreeSet<u64>,
) -> RoomTurnView {
    let actors = room_turn_actors_for_location(runtime, active_direct_actor_ids, location_id);
    state
        .room_turns
        .lock()
        .map(|mut turns| turns.view(location_id, &actors, viewer_actor_id))
        .unwrap_or_else(|_| RoomTurnView::idle(location_id))
}

pub(super) fn actor_room_turn_view(
    state: &AppState,
    runtime: &RuntimeWorld,
    actor_id: u64,
    active_direct_actor_ids: &BTreeSet<u64>,
) -> Option<RoomTurnView> {
    let actor = runtime.actor_by_id(actor_id)?;
    Some(room_turn_view_for_runtime(
        state,
        runtime,
        actor.location_id,
        Some(actor_id),
        active_direct_actor_ids,
    ))
}

fn actor_not_current_turn_response(view: RoomTurnView) -> Json<ActionResponse> {
    let mut events = Vec::new();
    if let Some(current_actor_id) = view.current_actor_id {
        events.push(EventView {
            type_name: "turn.waiting".to_string(),
            success: true,
            actor_id: Some(current_actor_id),
            actor_name: view.current_actor_name.clone(),
            location_id: Some(view.room_id),
            content: Some("wait".to_string()),
            ..EventView::default()
        });
    }
    Json(ActionResponse {
        ok: false,
        status: 423,
        events,
    })
}

pub(super) fn actor_turn_rejection(
    state: &AppState,
    runtime: &RuntimeWorld,
    actor_id: u64,
) -> Option<Json<ActionResponse>> {
    let mut active_direct_actors = active_turn_actor_ids_for_state(state);
    active_direct_actors.insert(actor_id);
    let view = actor_room_turn_view(state, runtime, actor_id, &active_direct_actors)?;
    (view.enabled && !view.is_current_actor).then(|| actor_not_current_turn_response(view))
}

pub(super) fn actor_action_turn_rejection(
    state: &AppState,
    runtime: &RuntimeWorld,
    action: &CwAction,
) -> Option<Json<ActionResponse>> {
    if matches!(
        action.kind,
        CW_ACTION_COMBAT_START
            | CW_ACTION_COMBAT_JOIN
            | CW_ACTION_COMBAT_ATTACK
            | CW_ACTION_COMBAT_DODGE
            | CW_ACTION_COMBAT_ESCAPE
    ) {
        return None;
    }
    if action_is_welcoming_listen(runtime, action) {
        return None;
    }
    actor_turn_rejection(state, runtime, action.actor_id)
}

fn action_is_welcoming_listen(runtime: &RuntimeWorld, action: &CwAction) -> bool {
    action_is_listen_check(action) && !runtime.listen_attempted_here(action.actor_id)
}

pub(super) fn command_dispatch_consumes_room_turn(dispatch: &CommandDispatch) -> bool {
    !matches!(
        dispatch,
        CommandDispatch::Read { .. }
            | CommandDispatch::Disabled { .. }
            | CommandDispatch::Say { .. }
            | CommandDispatch::Emote { .. }
            | CommandDispatch::Report { .. }
            | CommandDispatch::BankLedger
            | CommandDispatch::TrainSkill { .. }
    )
}

pub(super) fn command_actor_turn_rejection(
    state: &AppState,
    runtime: &RuntimeWorld,
    actor_id: u64,
    dispatch: &CommandDispatch,
) -> Option<RoomTurnView> {
    if matches!(dispatch, CommandDispatch::Check) && !runtime.listen_attempted_here(actor_id) {
        return None;
    }
    let mut active_direct_actors = active_turn_actor_ids_for_state(state);
    active_direct_actors.insert(actor_id);
    let view = actor_room_turn_view(state, runtime, actor_id, &active_direct_actors)?;
    (view.enabled && !view.is_current_actor).then_some(view)
}

pub(super) fn command_turn_rejected_response(
    resolved: ResolvedCommand,
    view: RoomTurnView,
    mut events: Vec<EventView>,
) -> Json<CommandResponse> {
    let current = view
        .current_actor_name
        .unwrap_or_else(|| "someone".to_string());
    if let Some(current_actor_id) = view.current_actor_id {
        events.push(EventView {
            type_name: "turn.waiting".to_string(),
            success: true,
            actor_id: Some(current_actor_id),
            actor_name: Some(current.clone()),
            location_id: Some(view.room_id),
            content: Some("wait".to_string()),
            ..EventView::default()
        });
    }
    Json(CommandResponse {
        ok: false,
        status: 423,
        command: resolved.command,
        verb: resolved.verb,
        output: Some(format!(
            "{current} has the room. Send a gentle nudge if they seem away."
        )),
        action: resolved.action,
        receipt: None,
        events,
    })
}

pub(super) fn advance_actor_room_turn_after_commit(
    state: &AppState,
    runtime: &RuntimeWorld,
    location_id: Option<u64>,
    actor_id: u64,
    status: u32,
    events: &[EventView],
) {
    if status != CW_OK || events.is_empty() {
        return;
    }
    if events.iter().any(|event| {
        matches!(
            event.type_name.as_str(),
            "combat.encounter.started"
                | "combat.participant.joined"
                | "combat.turn.started"
                | "combat.turn.ended"
                | "combat.encounter.resolved"
        )
    }) {
        return;
    }
    if let Some(event) = events
        .iter()
        .find(|event| event.success && event.actor_id == Some(actor_id))
        .or_else(|| events.iter().find(|event| event.success))
    {
        record_first_turn_committed(state, actor_id, event.seq);
    }
    let Some(location_id) = location_id else {
        return;
    };
    let mut active_direct_actors = active_turn_actor_ids_for_state(state);
    active_direct_actors.insert(actor_id);
    let actors = room_turn_actors_for_location(runtime, &active_direct_actors, location_id);
    if let Ok(mut turns) = state.room_turns.lock() {
        turns.advance_after_action(location_id, &actors, actor_id);
    }
}

impl RuntimeWorld {
    fn append_turn_event(
        &mut self,
        type_name: &str,
        actor_id: u64,
        target_actor_id: Option<u64>,
        location_id: u64,
        content: &str,
    ) -> EventView {
        let event = EventView {
            seq: self.world.next_event_seq,
            type_name: type_name.to_string(),
            success: true,
            reason: 0,
            actor_id: Some(actor_id),
            actor_name: self.actor_name(actor_id),
            target_actor_id,
            target_actor_name: target_actor_id.and_then(|id| self.actor_name(id)),
            location_id: Some(location_id),
            location_name: self.location_name(location_id),
            content: Some(content.to_string()),
            ..EventView::default()
        };
        self.world.next_event_seq += 1;
        self.push_projected_event(event.clone());
        event
    }

    fn append_turn_ping_events(
        &mut self,
        requester_actor_id: u64,
        current_actor_id: Option<u64>,
        location_id: u64,
        ping_started: bool,
        pong_recorded: bool,
    ) -> Vec<EventView> {
        let mut events = Vec::new();
        if ping_started {
            events.push(self.append_turn_event(
                "turn.ping_started",
                requester_actor_id,
                current_actor_id,
                location_id,
                "ping",
            ));
        } else if pong_recorded {
            events.push(self.append_turn_event(
                "turn.pong",
                requester_actor_id,
                current_actor_id,
                location_id,
                "pong",
            ));
        }
        events
    }

    fn append_turn_ping_skipped_event(
        &mut self,
        requester_actor_id: u64,
        skipped_actor_id: Option<u64>,
        location_id: u64,
    ) -> EventView {
        self.append_turn_event(
            "turn.ping_skipped",
            requester_actor_id,
            skipped_actor_id,
            location_id,
            "skipped",
        )
    }
}

fn schedule_turn_ping_resolution(state: AppState, location_id: u64, ping_id: u64) {
    tokio::spawn(async move {
        tokio::time::sleep(TURN_PING_COUNTDOWN).await;
        resolve_turn_ping_after_countdown(state, location_id, ping_id).await;
    });
}

async fn resolve_turn_ping_after_countdown(state: AppState, location_id: u64, ping_id: u64) {
    let mut runtime = state.inner.lock().await;
    let active_direct_actors = active_turn_actor_ids_for_state(&state);
    let actors = room_turn_actors_for_location(&runtime, &active_direct_actors, location_id);
    let outcome = state
        .room_turns
        .lock()
        .map(|mut turns| turns.resolve_ping(location_id, &actors, ping_id))
        .unwrap_or_else(|_| RoomTurnOutcome {
            accepted: false,
            ping_started: false,
            pong_recorded: false,
            advanced: false,
            previous_actor_id: None,
            event_actor_id: None,
            ping_id: None,
        });

    if !outcome.accepted || !outcome.advanced {
        return;
    }

    let Some(event_actor_id) = outcome.event_actor_id else {
        return;
    };
    let events = vec![runtime.append_turn_ping_skipped_event(
        event_actor_id,
        outcome.previous_actor_id,
        location_id,
    )];
    state.mark_activity();
    persist_runtime(&state, &runtime);
    persist_events(&state, &events);
    drop(runtime);

    broadcast_events(&state, &events);
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
        "turn-ping",
        GENERAL_ACTION_LIMIT,
    ) {
        return action_rate_limited_response();
    }

    let mut runtime = state.inner.lock().await;
    if !client_actor_authorized_for_state(
        &runtime,
        &state,
        payload.actor_id,
        payload.actor_session.as_deref(),
    ) {
        return client_actor_rejected_response();
    }
    let Some(actor) = runtime.actor_by_id(payload.actor_id) else {
        return Json(ActionResponse {
            ok: false,
            status: 404,
            events: Vec::new(),
        });
    };
    let location_id = actor.location_id;
    let mut active_direct_actors = active_turn_actor_ids_for_state(&state);
    active_direct_actors.insert(payload.actor_id);
    let actors = room_turn_actors_for_location(&runtime, &active_direct_actors, location_id);
    let outcome = state
        .room_turns
        .lock()
        .map(|mut turns| turns.request_timeout(location_id, &actors, payload.actor_id))
        .unwrap_or_else(|_| RoomTurnOutcome {
            accepted: false,
            ping_started: false,
            pong_recorded: false,
            advanced: false,
            previous_actor_id: None,
            event_actor_id: None,
            ping_id: None,
        });
    if !outcome.accepted {
        return Json(ActionResponse {
            ok: false,
            status: 409,
            events: Vec::new(),
        });
    }

    let events = runtime.append_turn_ping_events(
        outcome.event_actor_id.unwrap_or(payload.actor_id),
        outcome.previous_actor_id,
        location_id,
        outcome.ping_started,
        outcome.pong_recorded,
    );
    state.mark_activity();
    persist_runtime(&state, &runtime);
    persist_events(&state, &events);
    let mut response_events = events.clone();
    append_action_receipt(&state, &runtime, payload.actor_id, &mut response_events);
    drop(runtime);

    broadcast_events(&state, &events);
    if outcome.ping_started {
        if let Some(ping_id) = outcome.ping_id {
            schedule_turn_ping_resolution(state.clone(), location_id, ping_id);
        }
    }
    Json(ActionResponse {
        ok: true,
        status: CW_OK,
        events: response_events,
    })
}

fn ordered_actor_ids(actors: &[RoomTurnActor]) -> Vec<u64> {
    let mut ordered = actors.to_vec();
    ordered.sort_by(|left, right| {
        right
            .initiative
            .cmp(&left.initiative)
            .then_with(|| left.actor_id.cmp(&right.actor_id))
    });
    ordered.into_iter().map(|actor| actor.actor_id).collect()
}

fn next_actor_id_in_order(actors: &[RoomTurnActor], current_actor_id: u64) -> Option<u64> {
    let ordered = ordered_actor_ids(actors);
    let Some(index) = ordered
        .iter()
        .position(|actor_id| *actor_id == current_actor_id)
    else {
        return ordered.first().copied();
    };
    ordered.get((index + 1) % ordered.len()).copied()
}

fn next_actor_id_for_ping_responders(
    actors: &[RoomTurnActor],
    current_actor_id: u64,
    responder_ids: &BTreeSet<u64>,
) -> Option<u64> {
    let mut ordered = actors
        .iter()
        .filter(|actor| actor.actor_id != current_actor_id)
        .filter(|actor| responder_ids.contains(&actor.actor_id))
        .cloned()
        .collect::<Vec<_>>();
    ordered.sort_by(|left, right| {
        boosted_initiative(right)
            .cmp(&boosted_initiative(left))
            .then_with(|| left.actor_id.cmp(&right.actor_id))
    });
    ordered.first().map(|actor| actor.actor_id)
}

fn boosted_initiative(actor: &RoomTurnActor) -> i16 {
    actor.initiative.saturating_add(PONG_INITIATIVE_BOOST)
}

fn duration_millis_u64(duration: Duration) -> u64 {
    u64::try_from(duration.as_millis()).unwrap_or(u64::MAX)
}

fn waiting_actor_ids(actors: &[RoomTurnActor], current_actor_id: Option<u64>) -> Vec<u64> {
    actors
        .iter()
        .map(|actor| actor.actor_id)
        .filter(|actor_id| Some(*actor_id) != current_actor_id)
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn actor(actor_id: u64, initiative: i16) -> RoomTurnActor {
        RoomTurnActor {
            actor_id,
            name: format!("Actor {actor_id}"),
            initiative,
        }
    }

    #[test]
    fn room_turns_start_with_highest_initiative_and_advance_after_card() {
        let actors = vec![actor(10, 0), actor(20, 3), actor(30, 1)];
        let mut turns = RoomTurns::default();

        let first = turns.view(1, &actors, Some(20));
        assert_eq!(first.current_actor_id, Some(20));
        assert!(first.is_current_actor);

        let next = turns.advance_after_action(1, &actors, 20);
        assert_eq!(next.current_actor_id, Some(30));
        assert!(!next.is_current_actor);

        let next = turns.view(1, &actors, Some(30));
        assert!(next.is_current_actor);
    }

    #[test]
    fn welcoming_action_does_not_steal_or_advance_another_players_turn() {
        let actors = vec![actor(10, 3), actor(20, 2), actor(30, 1)];
        let mut turns = RoomTurns::default();

        assert_eq!(turns.view(1, &actors, Some(20)).current_actor_id, Some(10));
        let after_welcome = turns.advance_after_action(1, &actors, 20);

        assert_eq!(after_welcome.current_actor_id, Some(10));
        assert!(!after_welcome.is_current_actor);
        assert_eq!(after_welcome.round, 1);
    }

    #[test]
    fn only_a_players_first_listen_in_the_room_is_welcoming() {
        let mut runtime = RuntimeWorld::seeded();
        let create = CwAction {
            kind: CW_ACTION_CREATE_ACTOR,
            actor_id: 5000,
            location_id: 1,
            ..CwAction::default()
        };
        let record = JournalRecord::new(create, 81001);
        assert_eq!(runtime.apply_journal_record(&record).0, CW_OK);
        let listen = CwAction {
            kind: CW_ACTION_ABILITY_CHECK,
            actor_id: 5000,
            ability: LISTEN_ABILITY,
            dc: LISTEN_DC,
            ..CwAction::default()
        };

        assert!(action_is_welcoming_listen(&runtime, &listen));
        runtime
            .listen_attempt_claims
            .insert(listen_attempt_claim_key(5000, 1));
        assert!(!action_is_welcoming_listen(&runtime, &listen));

        let search = CwAction {
            kind: CW_ACTION_SEARCH,
            actor_id: 5000,
            ..CwAction::default()
        };
        assert!(!action_is_welcoming_listen(&runtime, &search));
    }

    #[test]
    fn personal_growth_commands_do_not_consume_the_room_turn() {
        assert!(!command_dispatch_consumes_room_turn(
            &CommandDispatch::BankLedger
        ));
        assert!(!command_dispatch_consumes_room_turn(
            &CommandDispatch::TrainSkill {
                skill_id: "listening".to_string(),
            }
        ));
        assert!(command_dispatch_consumes_room_turn(
            &CommandDispatch::CreateBond {
                target_actor_id: 1001,
                statement: "I bring small kindnesses to Rati.".to_string(),
            }
        ));
        assert!(command_dispatch_consumes_room_turn(&CommandDispatch::Check));
    }

    #[test]
    fn ping_skips_to_best_responder_after_countdown() {
        let actors = vec![actor(10, 3), actor(20, 2), actor(30, 1)];
        let mut turns = RoomTurns::default();

        assert_eq!(turns.view(1, &actors, Some(10)).current_actor_id, Some(10));
        let ping = turns.request_ping(1, &actors, 20, Duration::from_secs(15));
        assert!(ping.accepted);
        assert!(ping.ping_started);
        assert!(!ping.advanced);
        assert_eq!(turns.view(1, &actors, Some(20)).current_actor_id, Some(10));
        assert!(turns.view(1, &actors, Some(20)).ping_active);

        let pong = turns.request_ping(1, &actors, 30, Duration::from_secs(15));
        assert!(pong.accepted);
        assert!(!pong.ping_started);
        assert!(pong.pong_recorded);
        assert_eq!(turns.view(1, &actors, Some(30)).current_actor_id, Some(10));

        let skipped = turns.resolve_ping(1, &actors, ping.ping_id.unwrap());
        assert!(skipped.accepted);
        assert!(skipped.advanced);
        assert_eq!(skipped.previous_actor_id, Some(10));
        assert_eq!(turns.view(1, &actors, Some(20)).current_actor_id, Some(20));
    }

    #[test]
    fn current_actor_cannot_ping_their_own_turn() {
        let actors = vec![actor(10, 3), actor(20, 2)];
        let mut turns = RoomTurns::default();

        assert_eq!(turns.view(1, &actors, Some(10)).current_actor_id, Some(10));
        let outcome = turns.request_timeout(1, &actors, 10);
        assert!(!outcome.accepted);
        assert!(!outcome.advanced);
        assert_eq!(turns.view(1, &actors, Some(10)).current_actor_id, Some(10));
    }

    #[test]
    fn ping_skips_inactive_waiting_players_who_do_not_pong() {
        let actors = vec![actor(10, 3), actor(20, 2), actor(30, 1)];
        let mut turns = RoomTurns::default();
        assert_eq!(turns.view(1, &actors, Some(10)).current_actor_id, Some(10));

        let ping = turns.request_ping(1, &actors, 30, Duration::from_secs(15));
        assert!(ping.accepted);
        assert!(ping.ping_started);

        let skipped = turns.resolve_ping(1, &actors, ping.ping_id.unwrap());
        assert!(skipped.accepted);
        assert!(skipped.advanced);
        assert_eq!(skipped.previous_actor_id, Some(10));
        assert_eq!(turns.view(1, &actors, Some(30)).current_actor_id, Some(30));
    }
}
