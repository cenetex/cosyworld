use axum::{
    extract::{ConnectInfo, State},
    Json,
};
use serde::{Deserialize, Serialize};
use std::collections::BTreeSet;
use std::net::SocketAddr;
use std::time::{Duration, Instant};

use super::*;

pub(super) const ORDERED_SCENE_BASE_GRACE_MS: u64 = 45_000;
pub(super) const ORDERED_SCENE_NEED_TIME_MS: u64 = 60_000;
pub(super) const FOCUSED_ENCOUNTER_PROTOCOL: &str = "cosyworld.focused-encounter/1";
pub(super) const FOCUSED_COMBAT_PROFILE_ID: &str = "cosyworld.focused.combat";
pub(super) const FOCUSED_COMBAT_PROFILE_VERSION: u16 = 1;
pub(super) const FOCUSED_WORK_PROFILE: &str = "cosyworld.focused.cooperative-work/1";
pub(super) const FOCUSED_WORK_PROFILE_ID: &str = "cosyworld.focused.cooperative-work";
pub(super) const FOCUSED_WORK_PROFILE_VERSION: u16 = 1;
pub(super) const FOCUSED_ENCOUNTER_JOURNAL_VERSION: u32 = 8;
const FOCUSED_WORK_JOURNAL_VERSION: u32 = 10;
const FOCUSED_ENCOUNTER_SCHEMA_VERSION: u8 = 1;
const FOCUSED_JOB_STATE_VERSION: u8 = 1;
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

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub(super) struct FocusedEncounterOfferContext {
    pub(super) protocol: String,
    pub(super) encounter_id: u64,
    pub(super) profile_id: String,
    pub(super) profile_version: u16,
    pub(super) activation_step: FocusedActivationStep,
    pub(super) current_actor_id: u64,
    pub(super) round: u64,
    pub(super) handoff_key: String,
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

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub(super) struct FocusedJobEncounterState {
    pub(super) version: u8,
    pub(super) encounter_id: u64,
    pub(super) profile_id: String,
    pub(super) profile_version: u16,
    pub(super) location_id: u64,
    pub(super) phase: String,
    pub(super) participant_order: Vec<u64>,
    pub(super) current_index: usize,
    pub(super) round: u64,
    pub(super) setup_remaining: u8,
    pub(super) status: String,
}

impl FocusedJobEncounterState {
    fn current_actor_id(&self) -> Option<u64> {
        self.participant_order.get(self.current_index).copied()
    }

    fn pass(&mut self, actor_id: u64) -> Result<(), &'static str> {
        if self.current_actor_id() != Some(actor_id) {
            return Err("only the current participant can pass");
        }
        let next_index = (self.current_index + 1) % self.participant_order.len();
        if next_index == 0 {
            self.round = self.round.saturating_add(1);
        }
        self.current_index = next_index;
        self.setup_remaining = 1;
        Ok(())
    }
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
    pub(super) fn handoff_key(&self) -> String {
        format!(
            "{}:{}:{}:{}:{}",
            self.profile_id,
            self.profile_version,
            self.encounter_id,
            self.round,
            self.current_actor_id
        )
    }

    fn offer_context(
        &self,
        activation_step: FocusedActivationStep,
    ) -> FocusedEncounterOfferContext {
        FocusedEncounterOfferContext {
            protocol: self.protocol.to_string(),
            encounter_id: self.encounter_id,
            profile_id: self.profile_id.clone(),
            profile_version: self.profile_version,
            activation_step,
            current_actor_id: self.current_actor_id,
            round: self.round,
            handoff_key: self.handoff_key(),
        }
    }

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
        | CW_ACTION_COMBAT_ABANDON
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

fn focused_encounter_context_for_record(
    runtime: &RuntimeWorld,
    record: &JournalRecord,
) -> Option<FocusedEncounterJournalContext> {
    if let Some(context) = focused_encounter_context_for_action(&record.action) {
        return Some(context);
    }
    let activation_step = match record.offer_kind.as_deref()? {
        "need_time" => FocusedActivationStep::Control,
        "prepare" => FocusedActivationStep::Setup,
        "pass" | "check" | "study" | "work" | "help" => FocusedActivationStep::Commit,
        _ => return None,
    };
    let focused = focused_job_encounter(runtime, record.action.actor_id)?;
    Some(FocusedEncounterJournalContext {
        protocol: focused.protocol.to_string(),
        encounter_id: focused.encounter_id,
        profile_id: focused.profile_id,
        profile_version: focused.profile_version,
        activation_step,
    })
}

pub(super) fn bind_focused_encounter_context(runtime: &RuntimeWorld, record: &mut JournalRecord) {
    if record.focused_encounter.is_none() {
        record.focused_encounter = focused_encounter_context_for_record(runtime, record);
    }
}

pub(super) fn focused_encounter_journal_context_is_supported(
    runtime: &RuntimeWorld,
    record: &JournalRecord,
) -> bool {
    let focused_controls = record
        .projection_mutations
        .iter()
        .filter_map(|mutation| match mutation {
            ProjectionMutation::FocusedControl { control } => Some(control.as_str()),
            _ => None,
        })
        .collect::<Vec<_>>();
    if focused_controls.len() > 1
        || focused_controls
            .first()
            .is_some_and(|control| Some(*control) != record.offer_kind.as_deref())
    {
        return false;
    }
    let expected = focused_encounter_context_for_record(runtime, record);
    match (expected, record.focused_encounter.as_ref()) {
        (Some(expected), Some(context)) => context == &expected,
        (Some(expected), None) => {
            record.version
                < if expected.profile_id == FOCUSED_WORK_PROFILE_ID {
                    FOCUSED_WORK_JOURNAL_VERSION
                } else {
                    FOCUSED_ENCOUNTER_JOURNAL_VERSION
                }
        }
        (None, None) => true,
        (None, Some(_)) => false,
    }
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
        | CW_ACTION_COMBAT_ABANDON
        | CW_ACTION_COMBAT_NEED_TIME => ConcurrencyPolicy::SceneTurn,
        CW_ACTION_PICK_UP_ITEM
        | CW_ACTION_DROP_ITEM
        | CW_ACTION_USE_ITEM
        | CW_ACTION_RULES_UTILIZE_ITEM
        | CW_ACTION_PROJECT_PUSH
        | CW_ACTION_GIVE_ITEM
        | CW_ACTION_TRADE_ITEM
        | CW_ACTION_CRAFT
        | CW_ACTION_THEFT
        | CW_ACTION_GATE_TRANSITION => ConcurrencyPolicy::TargetSerialized,
        _ => ConcurrencyPolicy::Concurrent,
    }
}

pub(super) fn command_concurrency_policy(dispatch: &CommandDispatch) -> ConcurrencyPolicy {
    match dispatch {
        CommandDispatch::Attack { .. } | CommandDispatch::Defend | CommandDispatch::Flee { .. } => {
            ConcurrencyPolicy::SceneTurn
        }
        CommandDispatch::Contribute { action_kind, .. }
            if matches!(action_kind.as_str(), "work" | "help" | "use_item") =>
        {
            ConcurrencyPolicy::TargetSerialized
        }
        CommandDispatch::PickUp { .. }
        | CommandDispatch::OpenThreshold { .. }
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
        | CommandDispatch::Chat { .. }
        | CommandDispatch::ModelInteraction { .. }
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

pub(super) fn active_actor_ids_for_focused_grace(
    state: &AppState,
    grace_period_ms: u64,
) -> BTreeSet<u64> {
    let active_window = Duration::from_millis(grace_period_ms);
    let mut ids = active_actor_ids_with_window(&state.actor_sessions, active_window);
    if let Ok(mut presence) = state.regional_presence.lock() {
        let now = Instant::now();
        presence.retain(|_, state| {
            now.saturating_duration_since(state.last_seen_at) <= ACTIVE_ACTOR_WINDOW
        });
        ids.extend(presence.iter().filter_map(|(actor_id, state)| {
            (state.active && now.saturating_duration_since(state.last_seen_at) <= active_window)
                .then_some(*actor_id)
        }));
    }
    if let Ok(suspensions) = state.actor_suspensions.lock() {
        ids.retain(|id| !suspensions.contains_key(id));
    }
    ids
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

fn focused_job_encounter(runtime: &RuntimeWorld, actor_id: u64) -> Option<FocusedEncounterView> {
    let actor = runtime.actor_by_id(actor_id)?;
    runtime.jobs.values().find_map(|job| {
        let state = job.focused_encounter.as_ref()?;
        if state.version != FOCUSED_JOB_STATE_VERSION
            || state.status != "active"
            || state.location_id != actor.location_id
            || !state.participant_order.contains(&actor_id)
            || runtime.job_status(job) != "active"
        {
            return None;
        }
        let current_actor_id = state.current_actor_id()?;
        let focused = FocusedEncounterView {
            schema_version: FOCUSED_ENCOUNTER_SCHEMA_VERSION,
            protocol: FOCUSED_ENCOUNTER_PROTOCOL,
            encounter_id: state.encounter_id,
            profile_id: state.profile_id.clone(),
            profile_version: state.profile_version,
            location_id: state.location_id,
            phase: state.phase.clone(),
            concurrency_policy: ConcurrencyPolicy::SceneTurn.as_str(),
            participant_order: state.participant_order.clone(),
            current_actor_id,
            round: state.round,
            activation_budget: FocusedActivationBudget {
                setup_limit: 1,
                setup_remaining: state.setup_remaining,
                commit_remaining: 1,
            },
            objective_clock_id: job.progress_clock_id.clone(),
            danger_clock_id: (!job.danger_clock_id.trim().is_empty())
                .then(|| job.danger_clock_id.clone()),
            pressure_trigger: "activation_end".to_string(),
            local_nodes: Vec::new(),
            relations: Vec::new(),
            conditions: Vec::new(),
            completion_predicate: "objective_clock_completed".to_string(),
            stop_predicate: "withdrawal_or_authored_failure".to_string(),
            retreat_predicate: "participant_withdrew".to_string(),
            worldpack_bundle_hash: active_content().manifest.bundle_hash.clone(),
            rules_profile: active_content().manifest.rules_profile.clone(),
        };
        focused.validate().ok()?;
        Some(focused)
    })
}

pub(super) fn focused_encounter_for_actor(
    runtime: &RuntimeWorld,
    actor_id: u64,
) -> Option<FocusedEncounterView> {
    focused_combat_encounter(runtime, actor_id).or_else(|| focused_job_encounter(runtime, actor_id))
}

pub(super) fn focused_job_action_available(
    runtime: &RuntimeWorld,
    actor_id: u64,
    job_id: &str,
    offer_kind: &str,
) -> bool {
    if !runtime
        .actor_by_id(actor_id)
        .is_some_and(RuntimeWorld::actor_can_act)
    {
        return false;
    }
    let Some(job) = runtime.jobs.get(job_id) else {
        return false;
    };
    let Some(state) = job.focused_encounter.as_ref() else {
        return true;
    };
    if state.status != "active"
        || state.current_actor_id() != Some(actor_id)
        || !state.participant_order.contains(&actor_id)
    {
        return false;
    }
    offer_kind != "prepare" || state.setup_remaining > 0
}

fn focused_job_encounter_id(job_id: &str) -> u64 {
    stable_hash_u64(&["focused-job", job_id]).max(1)
}

fn focused_job_need_time_used(
    runtime: &RuntimeWorld,
    encounter_id: u64,
    current_actor_id: u64,
) -> bool {
    let turn_started_seq = runtime
        .event_log
        .iter()
        .rev()
        .find(|event| {
            event.type_name == "focused.turn.started"
                && event.content_id == Some(encounter_id)
                && event.actor_id == Some(current_actor_id)
        })
        .map(|event| event.seq)
        .unwrap_or_default();
    runtime.event_log.iter().any(|event| {
        event.seq > turn_started_seq
            && event.type_name == "focused.need_time"
            && event.content_id == Some(encounter_id)
            && event.actor_id == Some(current_actor_id)
    })
}

fn focused_job_contributors(runtime: &RuntimeWorld, job: &JobState, location_id: u64) -> Vec<u64> {
    let Some(clock) = runtime.clocks.get(&job.progress_clock_id) else {
        return Vec::new();
    };
    let mut seen = BTreeSet::new();
    clock
        .recent_contributions
        .iter()
        .filter_map(|contribution| {
            let actor = runtime.actor_by_id(contribution.actor_id)?;
            (RuntimeWorld::actor_can_act(actor)
                && actor.location_id == location_id
                && seen.insert(actor.id))
            .then_some(actor.id)
        })
        .take(FOCUSED_ENCOUNTER_MAX_PARTICIPANTS)
        .collect()
}

fn append_focused_job_event(
    runtime: &mut RuntimeWorld,
    type_name: &str,
    encounter_id: u64,
    actor_id: u64,
    location_id: u64,
    content: impl Into<String>,
) -> EventView {
    let mut event = runtime.append_async_job_event(type_name, actor_id, None, Some(content.into()));
    event.content_id = Some(encounter_id);
    event.location_id = Some(location_id);
    runtime.replace_projected_event(&event);
    event
}

impl RuntimeWorld {
    fn maybe_start_focused_job_encounter(&mut self, record: &JournalRecord) -> Vec<EventView> {
        if record.focused_policy_version == 0 || record.focused_encounter.is_some() {
            return Vec::new();
        }
        let Some(job_id) = record
            .projection_mutations
            .iter()
            .find_map(|mutation| match mutation {
                ProjectionMutation::ResolveJobContribution { intent } => {
                    Some(intent.job_id.clone())
                }
                _ => None,
            })
        else {
            return Vec::new();
        };
        let Some(actor) = self.actor_by_id(record.action.actor_id) else {
            return Vec::new();
        };
        let location_id = actor.location_id;
        let Some(job) = self.jobs.get(&job_id) else {
            return Vec::new();
        };
        if job.focused_profile.as_deref() != Some(FOCUSED_WORK_PROFILE)
            || job.focused_encounter.is_some()
            || self.job_status(job) != "active"
        {
            return Vec::new();
        }
        let participant_order = focused_job_contributors(self, job, location_id);
        if !(FOCUSED_ENCOUNTER_MIN_PARTICIPANTS..=FOCUSED_ENCOUNTER_MAX_PARTICIPANTS)
            .contains(&participant_order.len())
        {
            return Vec::new();
        }
        let Some(trigger_index) = participant_order
            .iter()
            .position(|actor_id| *actor_id == record.action.actor_id)
        else {
            return Vec::new();
        };
        let encounter_id = focused_job_encounter_id(&job_id);
        let current_index = (trigger_index + 1) % participant_order.len();
        let current_actor_id = participant_order[current_index];
        let state = FocusedJobEncounterState {
            version: FOCUSED_JOB_STATE_VERSION,
            encounter_id,
            profile_id: FOCUSED_WORK_PROFILE_ID.to_string(),
            profile_version: FOCUSED_WORK_PROFILE_VERSION,
            location_id,
            phase: "work".to_string(),
            participant_order,
            current_index,
            round: 1,
            setup_remaining: 1,
            status: "active".to_string(),
        };
        let Some(job) = self.jobs.get_mut(&job_id) else {
            return Vec::new();
        };
        job.focused_encounter = Some(state);
        vec![
            append_focused_job_event(
                self,
                "focused.encounter.started",
                encounter_id,
                record.action.actor_id,
                location_id,
                "The shared work becomes an ordered scene.",
            ),
            append_focused_job_event(
                self,
                "focused.turn.started",
                encounter_id,
                current_actor_id,
                location_id,
                "The next participant may set up once, then commit.",
            ),
        ]
    }

    pub(super) fn apply_focused_job_record(&mut self, record: &JournalRecord) -> Vec<EventView> {
        let Some(context) = record.focused_encounter.as_ref().filter(|context| {
            context.profile_id == FOCUSED_WORK_PROFILE_ID
                && context.profile_version == FOCUSED_WORK_PROFILE_VERSION
        }) else {
            return self.maybe_start_focused_job_encounter(record);
        };
        let Some(job_id) = self.jobs.iter().find_map(|(job_id, job)| {
            job.focused_encounter
                .as_ref()
                .is_some_and(|state| state.encounter_id == context.encounter_id)
                .then(|| job_id.clone())
        }) else {
            return Vec::new();
        };
        let actor_id = record.action.actor_id;
        let offer_kind = record.offer_kind.as_deref().unwrap_or_default();
        let (encounter_id, location_id, next_actor_id, completed) = {
            let Some(job) = self.jobs.get_mut(&job_id) else {
                return Vec::new();
            };
            let objective_completed = self
                .clocks
                .get(&job.progress_clock_id)
                .is_some_and(|clock| clock.filled >= clock.segments);
            let Some(state) = job.focused_encounter.as_mut() else {
                return Vec::new();
            };
            if state.current_actor_id() != Some(actor_id) {
                return Vec::new();
            }
            if context.activation_step == FocusedActivationStep::Setup {
                if state.setup_remaining == 0 {
                    return Vec::new();
                }
                state.setup_remaining = 0;
                (
                    state.encounter_id,
                    state.location_id,
                    state.current_actor_id(),
                    false,
                )
            } else if offer_kind == "need_time" {
                (
                    state.encounter_id,
                    state.location_id,
                    state.current_actor_id(),
                    false,
                )
            } else if objective_completed || job.status != "active" {
                state.status = "completed".to_string();
                (state.encounter_id, state.location_id, None, true)
            } else {
                if state.pass(actor_id).is_err() {
                    return Vec::new();
                }
                (
                    state.encounter_id,
                    state.location_id,
                    state.current_actor_id(),
                    false,
                )
            }
        };
        if context.activation_step == FocusedActivationStep::Setup {
            return vec![append_focused_job_event(
                self,
                "focused.setup",
                encounter_id,
                actor_id,
                location_id,
                "Setup is ready; the same activation still has one commit.",
            )];
        }
        if offer_kind == "need_time" {
            return vec![append_focused_job_event(
                self,
                "focused.need_time",
                encounter_id,
                actor_id,
                location_id,
                "The scene keeps its current participant and adds one grace window.",
            )];
        }
        if completed {
            return vec![append_focused_job_event(
                self,
                "focused.encounter.completed",
                encounter_id,
                actor_id,
                location_id,
                "The ordered work is complete.",
            )];
        }
        let Some(next_actor_id) = next_actor_id else {
            return Vec::new();
        };
        let mut events = vec![append_focused_job_event(
            self,
            "focused.turn.ended",
            encounter_id,
            actor_id,
            location_id,
            "The committed activation ends.",
        )];
        if offer_kind == "pass" {
            events.push(append_focused_job_event(
                self,
                "focused.pass",
                encounter_id,
                actor_id,
                location_id,
                "The current participant passes.",
            ));
        }
        events.push(append_focused_job_event(
            self,
            "focused.turn.started",
            encounter_id,
            next_actor_id,
            location_id,
            "The next participant may set up once, then commit.",
        ));
        events
    }
}

pub(super) fn focused_encounter_offer_context(
    runtime: &RuntimeWorld,
    actor_id: u64,
    offer_kind: &str,
) -> Option<FocusedEncounterOfferContext> {
    if !runtime
        .actor_by_id(actor_id)
        .is_some_and(RuntimeWorld::actor_can_act)
    {
        return None;
    }
    let activation_step = match offer_kind {
        "prepare" => FocusedActivationStep::Setup,
        "attack" | "defend" | "flee" | "check" | "study" | "work" | "help" => {
            FocusedActivationStep::Commit
        }
        _ => return None,
    };
    let focused = focused_encounter_for_actor(runtime, actor_id)?;
    let profile_accepts_offer = if focused.profile_id == FOCUSED_COMBAT_PROFILE_ID {
        matches!(offer_kind, "attack" | "defend" | "flee")
    } else {
        matches!(offer_kind, "prepare" | "check" | "study" | "work" | "help")
    };
    if !profile_accepts_offer {
        return None;
    }
    if activation_step == FocusedActivationStep::Setup
        && focused.activation_budget.setup_remaining == 0
    {
        return None;
    }
    (focused.current_actor_id == actor_id).then(|| focused.offer_context(activation_step))
}

pub(super) fn combat_turn_view(
    runtime: &RuntimeWorld,
    actor_id: u64,
    room_id: u64,
) -> Option<RoomTurnView> {
    focused_turn_view(runtime, actor_id, room_id, None)
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum TurnTimeoutRefusal {
    NoFocusedScene,
    RequesterHoldsTurn,
    ParticipantsBelowTwo,
    RequesterNotEligible,
    Cooldown,
}

impl TurnTimeoutRefusal {
    fn event_type(self) -> &'static str {
        match self {
            Self::NoFocusedScene => "turn.timeout_refused.no_focused_scene",
            Self::RequesterHoldsTurn => "turn.timeout_refused.requester_holds_turn",
            Self::ParticipantsBelowTwo => "turn.timeout_refused.participants_below_two",
            Self::RequesterNotEligible => "turn.timeout_refused.requester_not_eligible",
            Self::Cooldown => "turn.timeout_refused.cooldown",
        }
    }

    fn status(self) -> u32 {
        match self {
            Self::Cooldown => 429,
            Self::RequesterNotEligible => 403,
            Self::NoFocusedScene | Self::RequesterHoldsTurn | Self::ParticipantsBelowTwo => 409,
        }
    }

    fn message(self) -> &'static str {
        match self {
            Self::NoFocusedScene => {
                "There is no ordered scene to nudge. Check what is here and choose an available action."
            }
            Self::RequesterHoldsTurn => {
                "You already hold this turn. Play an action, pass, or ask for more time."
            }
            Self::ParticipantsBelowTwo => {
                "Fewer than two eligible participants remain, so nobody can be nudged. The ordered scene will recover when another participant returns."
            }
            Self::RequesterNotEligible => {
                "You are no longer an eligible participant in this ordered scene. Rejoin the scene before nudging its current player."
            }
            Self::Cooldown => {
                "That player was nudged too recently. Give the scene a moment, then try again if the turn is still waiting."
            }
        }
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
struct FocusedTimeoutEligibility {
    focused: FocusedEncounterView,
    eligible_participant_ids: Vec<u64>,
}

fn focused_timeout_eligibility(
    runtime: &RuntimeWorld,
    requester_actor_id: u64,
    active_direct_actor_ids: &BTreeSet<u64>,
) -> Result<FocusedTimeoutEligibility, TurnTimeoutRefusal> {
    let focused = focused_encounter_for_actor(runtime, requester_actor_id)
        .ok_or(TurnTimeoutRefusal::NoFocusedScene)?;
    if focused.current_actor_id == requester_actor_id {
        return Err(TurnTimeoutRefusal::RequesterHoldsTurn);
    }
    let eligible_participant_ids = focused
        .participant_order
        .iter()
        .copied()
        .filter(|participant_id| {
            runtime
                .actor_by_id(*participant_id)
                .is_some_and(RuntimeWorld::actor_can_act)
                && (runtime.actor_uses_inference(*participant_id)
                    || active_direct_actor_ids.contains(participant_id))
        })
        .collect::<Vec<_>>();
    if eligible_participant_ids.len() < FOCUSED_ENCOUNTER_MIN_PARTICIPANTS {
        return Err(TurnTimeoutRefusal::ParticipantsBelowTwo);
    }
    if !eligible_participant_ids.contains(&requester_actor_id) {
        return Err(TurnTimeoutRefusal::RequesterNotEligible);
    }
    Ok(FocusedTimeoutEligibility {
        focused,
        eligible_participant_ids,
    })
}

fn focused_turn_view(
    runtime: &RuntimeWorld,
    actor_id: u64,
    room_id: u64,
    active_direct_actor_ids: Option<&BTreeSet<u64>>,
) -> Option<RoomTurnView> {
    let focused = focused_encounter_for_actor(runtime, actor_id)?;
    let current_actor_id = focused.current_actor_id;
    let current_actor_name = runtime.actor_name(current_actor_id);
    let is_current_actor = current_actor_id == actor_id;
    let is_combat = focused.profile_id == FOCUSED_COMBAT_PROFILE_ID;
    let need_time_used = if is_combat {
        combat_need_time_used(runtime, focused.encounter_id, current_actor_id)
    } else {
        focused_job_need_time_used(runtime, focused.encounter_id, current_actor_id)
    };
    let timeout_eligibility = active_direct_actor_ids
        .map(|active_actor_ids| focused_timeout_eligibility(runtime, actor_id, active_actor_ids));
    let waiting_actor_ids = timeout_eligibility
        .as_ref()
        .and_then(|eligibility| eligibility.as_ref().ok())
        .map(|eligibility| {
            eligibility
                .eligible_participant_ids
                .iter()
                .copied()
                .filter(|participant_id| *participant_id != current_actor_id)
                .collect()
        })
        .unwrap_or_else(|| focused.waiting_actor_ids());
    let explanation = Some(format!(
        "{} {} acts now; chat and inspection stay available.",
        if is_combat {
            "Combat is an ordered scene."
        } else {
            "The shared work is focused."
        },
        current_actor_name
            .clone()
            .unwrap_or_else(|| format!("Avatar {current_actor_id}"))
    ));
    Some(RoomTurnView {
        enabled: true,
        policy: ConcurrencyPolicy::SceneTurn.as_str(),
        scene_kind: Some(if is_combat { "combat" } else { "work" }),
        focused: Some(focused.clone()),
        explanation,
        room_id,
        current_actor_id: Some(current_actor_id),
        current_actor_name,
        is_current_actor,
        can_pass: is_current_actor,
        can_need_time: is_current_actor && !need_time_used,
        grace_period_ms: ORDERED_SCENE_BASE_GRACE_MS.saturating_add(if need_time_used {
            ORDERED_SCENE_NEED_TIME_MS
        } else {
            0
        }),
        need_time_extension_ms: ORDERED_SCENE_NEED_TIME_MS,
        handoff_key: Some(focused.handoff_key()),
        can_request_timeout: timeout_eligibility.is_some_and(|eligibility| eligibility.is_ok()),
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
    active_actor_ids: &BTreeSet<u64>,
) -> RoomTurnView {
    viewer_actor_id
        .and_then(|actor_id| {
            focused_turn_view(runtime, actor_id, location_id, Some(active_actor_ids))
        })
        .unwrap_or_else(|| RoomTurnView::idle(location_id))
}

#[cfg(test)]
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
    let is_combat = view.scene_kind == Some("combat");
    let type_name = if view.is_current_actor {
        if is_combat {
            "combat.action.required"
        } else {
            "focused.action.required"
        }
    } else {
        if is_combat {
            "combat.turn.waiting"
        } else {
            "focused.turn.waiting"
        }
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
    let offer_kind = match action.kind {
        CW_ACTION_COMBAT_ATTACK | CW_ACTION_COMBAT_FINESSE_ATTACK | CW_ACTION_ATTACK => "attack",
        CW_ACTION_COMBAT_DODGE | CW_ACTION_DEFEND => "defend",
        CW_ACTION_COMBAT_ESCAPE | CW_ACTION_FLEE => "flee",
        CW_ACTION_RULES_SEARCH | CW_ACTION_ABILITY_CHECK => "check",
        CW_ACTION_RULES_STUDY => "study",
        CW_ACTION_RULES_UTILIZE_ITEM => "use_item",
        CW_ACTION_PROJECT_PUSH => "work",
        _ => "",
    };
    if action.kind == CW_ACTION_SAY
        || (!offer_kind.is_empty()
            && focused_encounter_offer_context(runtime, action.actor_id, offer_kind).is_some())
    {
        return None;
    }
    actor_ordered_scene_rejection(runtime, action.actor_id)
}

pub(super) fn actor_offer_turn_rejection(
    runtime: &RuntimeWorld,
    actor_id: u64,
    offer_kind: &str,
) -> Option<Json<ActionResponse>> {
    if focused_encounter_offer_context(runtime, actor_id, offer_kind).is_some() {
        return None;
    }
    actor_ordered_scene_rejection(runtime, actor_id)
}

pub(super) fn command_dispatch_consumes_room_turn(dispatch: &CommandDispatch) -> bool {
    if matches!(
        command_concurrency_policy(dispatch),
        ConcurrencyPolicy::SceneTurn | ConcurrencyPolicy::GovernedChoice
    ) {
        return false;
    }
    let non_mutating_transfer_response = matches!(
        dispatch,
        CommandDispatch::ResolveTransferOffer { decision, .. }
            if matches!(decision.as_str(), "decline" | "withdraw")
    );
    !non_mutating_transfer_response
        && !matches!(
            dispatch,
            CommandDispatch::Read { .. }
                | CommandDispatch::Disabled { .. }
                | CommandDispatch::Report { .. }
                | CommandDispatch::SetActorSafety { .. }
        )
}

/// Local configuration, moderation, and transfer-offer responses do not require
/// one of the finite hand's two cards at the command boundary. Accepting an
/// offer still consumes a room turn because it moves an item; declining or
/// withdrawing remains available while a focused scene is locked.
pub(super) fn command_dispatch_is_visible_room_control(dispatch: &CommandDispatch) -> bool {
    matches!(
        dispatch,
        CommandDispatch::Disabled { .. }
            | CommandDispatch::Report { .. }
            | CommandDispatch::SetActorSafety { .. }
            | CommandDispatch::SetCharmEquipped { .. }
            | CommandDispatch::SetSpellPrepared { .. }
            | CommandDispatch::SetItemEquipped { .. }
            | CommandDispatch::SetItemContained { .. }
            | CommandDispatch::ResolveTransferOffer { .. }
    )
}

pub(super) fn command_actor_turn_rejection(
    _state: &AppState,
    runtime: &RuntimeWorld,
    actor_id: u64,
    dispatch: &CommandDispatch,
) -> Option<RoomTurnView> {
    let offer_kind = match dispatch {
        CommandDispatch::Attack { .. } => "attack",
        CommandDispatch::Defend => "defend",
        CommandDispatch::Flee { .. } => "flee",
        CommandDispatch::OpenThreshold { .. } => "open",
        CommandDispatch::Check => "check",
        CommandDispatch::Study => "study",
        CommandDispatch::Discover { procedure, .. } => match procedure.as_str() {
            "notice" => FOCUSED_NOTICE_OFFER_KIND,
            "search" => DISCOVERY_SEARCH_OFFER_KIND,
            "study" => DISCOVERY_STUDY_OFFER_KIND,
            "scout" => DISCOVERY_SCOUT_OFFER_KIND,
            _ => "",
        },
        CommandDispatch::Prepare => "prepare",
        CommandDispatch::Contribute { action_kind, .. } => action_kind.as_str(),
        CommandDispatch::Work => "work",
        CommandDispatch::Help => "help",
        _ => "",
    };
    if !offer_kind.is_empty()
        && focused_encounter_offer_context(runtime, actor_id, offer_kind).is_some()
    {
        return None;
    }
    ordered_scene_rejection_view(runtime, actor_id)
}

pub(super) fn direct_command_turn_rejection(
    _state: &AppState,
    runtime: &RuntimeWorld,
    actor_id: u64,
    dispatch: &CommandDispatch,
) -> Option<Json<ActionResponse>> {
    if !command_dispatch_consumes_room_turn(dispatch) {
        return None;
    }
    actor_ordered_scene_rejection(runtime, actor_id)
}

pub(super) fn command_turn_rejected_response(
    resolved: ResolvedCommand,
    view: RoomTurnView,
    mut events: Vec<EventView>,
) -> Json<CommandResponse> {
    let is_combat = view.scene_kind == Some("combat");
    events.push(EventView {
        type_name: if view.is_current_actor {
            if is_combat {
                "combat.action.required"
            } else {
                "focused.action.required"
            }
        } else {
            if is_combat {
                "combat.turn.waiting"
            } else {
                "focused.turn.waiting"
            }
        }
        .to_string(),
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
        error_kind: None,
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
    if status != CW_OK {
        if let Some(first_tale) = runtime.first_tale_view(actor_id) {
            let phase = first_tale
                .continuation
                .map(|continuation| continuation.phase)
                .unwrap_or(first_tale.phase);
            record_first_tale_action_rejection(
                state,
                actor_id,
                &phase,
                status,
                events
                    .iter()
                    .map(|event| event.seq)
                    .filter(|seq| *seq > 0)
                    .min(),
            );
        }
        return;
    }
    if events.is_empty() {
        return;
    }
    record_canonical_activation_milestones(state, actor_id, events);
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
        append_action_receipt(runtime, actor_id, events);
    }
    observation
}

pub(super) async fn recover_available_focused_job_turns(
    state: &AppState,
) -> io::Result<Vec<EventView>> {
    let mut runtime = state.inner.lock().await;
    let job_ids = runtime
        .jobs
        .iter()
        .filter_map(|(job_id, job)| {
            if job
                .focused_encounter
                .as_ref()
                .is_some_and(|focused| focused.status == "active")
            {
                Some(job_id.clone())
            } else {
                None
            }
        })
        .collect::<Vec<_>>();
    let mut events = Vec::new();
    for job_id in job_ids {
        for _ in 0..FOCUSED_ENCOUNTER_MAX_PARTICIPANTS {
            let Some(focused) = runtime
                .jobs
                .get(&job_id)
                .and_then(|job| job.focused_encounter.as_ref())
                .filter(|focused| focused.status == "active")
                .cloned()
            else {
                break;
            };
            let Some(current_actor_id) = focused.current_actor_id() else {
                break;
            };
            let grace_period_ms = ORDERED_SCENE_BASE_GRACE_MS.saturating_add(
                if focused_job_need_time_used(&runtime, focused.encounter_id, current_actor_id) {
                    ORDERED_SCENE_NEED_TIME_MS
                } else {
                    0
                },
            );
            let active_direct_actors = active_actor_ids_for_focused_grace(state, grace_period_ms);
            let current_can_act = runtime
                .actor_by_id(current_actor_id)
                .is_some_and(RuntimeWorld::actor_can_act);
            let inference_controlled = runtime.actor_uses_inference(current_actor_id);
            if current_can_act
                && !inference_controlled
                && active_direct_actors.contains(&current_actor_id)
            {
                break;
            }
            let another_available = focused
                .participant_order
                .iter()
                .copied()
                .filter(|actor_id| *actor_id != current_actor_id)
                .any(|actor_id| {
                    runtime
                        .actor_by_id(actor_id)
                        .is_some_and(RuntimeWorld::actor_can_act)
                        && (runtime.actor_uses_inference(actor_id)
                            || active_direct_actors.contains(&actor_id))
                });
            let inference_record = if current_can_act && inference_controlled {
                runtime.actor_by_id(current_actor_id).and_then(|actor| {
                    let (_, offers) = runtime
                        .legal_action_candidates(Some(current_actor_id), &AccessContext::default());
                    let hand = runtime.action_hand_for(Some(current_actor_id), &offers);
                    runtime
                        .resident_job_autonomy_record(actor, runtime.next_seed_value())
                        .filter(|record| {
                            offers.iter().any(|offer| {
                                hand.entries
                                    .iter()
                                    .any(|entry| entry.offer_id == offer.offer_id)
                                    && runtime.resident_offer_matches_record(offer, record)
                            })
                        })
                        .map(|mut record| {
                            record = runtime
                                .attach_resident_decision_trace(ResidentAutonomyCandidate {
                                    actor_id: current_actor_id,
                                    rank: 0,
                                    score: 0,
                                    record,
                                })
                                .record;
                            record.origin = if record.offer_kind.as_deref() == Some("prepare") {
                                JournalOrigin::PlayerControl
                            } else {
                                JournalOrigin::PlayerCard
                            };
                            record
                        })
                })
            } else {
                None
            };
            let forced_certified_pass =
                current_can_act && inference_controlled && inference_record.is_none();
            let record = if let Some(record) = inference_record {
                record
            } else {
                if !another_available {
                    break;
                }
                let mut record = JournalRecord::new(
                    CwAction {
                        kind: CW_ACTION_NONE,
                        actor_id: current_actor_id,
                        content_id: focused.encounter_id,
                        ..CwAction::default()
                    },
                    runtime.next_seed_value(),
                );
                record = if forced_certified_pass {
                    record.into_player_card()
                } else {
                    record.into_system()
                };
                record.bind_offer_kind("pass");
                record
                    .projection_mutations
                    .push(ProjectionMutation::FocusedControl {
                        control: "pass".to_string(),
                    });
                if forced_certified_pass {
                    // Recovery cannot play an undealt focused-work contribution.
                    // It consumes the current certified Pass instead, rotating the
                    // hand, spending one world tick, and handing off once.
                    record
                        .projection_mutations
                        .push(ProjectionMutation::ShuffleHand {
                            reason: "resident_focused_pass".to_string(),
                        });
                    runtime
                        .attach_resident_decision_trace(ResidentAutonomyCandidate {
                            actor_id: current_actor_id,
                            rank: 89,
                            score: 0,
                            record,
                        })
                        .record
                } else {
                    record
                }
            };
            let (status, committed) = commit_journal_record(state, &mut runtime, record)?;
            events.extend(committed);
            if status != CW_OK {
                return Err(io::Error::other(format!(
                    "focused work {job_id} recovery failed with status {status}"
                )));
            }
            // Do not let the recovery loop immediately spend the next
            // inference participant after handing focus over.  A certified
            // Pass is one bounded recovery decision, not a way to bypass the
            // finite hand by searching the rest of the turn order.
            if forced_certified_pass {
                break;
            }
        }
    }
    Ok(events)
}

pub(super) async fn request_turn_need_time(
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
    apply_focused_control(
        state,
        payload.actor_id,
        "need_time",
        payload.actor_session.as_deref(),
    )
    .await
}

fn turn_timeout_refusal_response(
    runtime: Option<&RuntimeWorld>,
    actor_id: u64,
    refusal: TurnTimeoutRefusal,
) -> Json<ActionResponse> {
    let focused = runtime.and_then(|runtime| focused_encounter_for_actor(runtime, actor_id));
    Json(ActionResponse {
        ok: false,
        status: refusal.status(),
        events: vec![EventView {
            type_name: refusal.event_type().to_string(),
            success: false,
            actor_id: Some(actor_id),
            actor_name: runtime.and_then(|runtime| runtime.actor_name(actor_id)),
            target_actor_id: focused.as_ref().map(|focused| focused.current_actor_id),
            target_actor_name: focused.as_ref().and_then(|focused| {
                runtime.and_then(|runtime| runtime.actor_name(focused.current_actor_id))
            }),
            location_id: focused.as_ref().map(|focused| focused.location_id),
            content_id: focused.as_ref().map(|focused| focused.encounter_id),
            content: Some(refusal.message().to_string()),
            ..EventView::default()
        }],
    })
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
        "turn-timeout",
        GENERAL_ACTION_LIMIT,
    ) {
        return turn_timeout_refusal_response(None, payload.actor_id, TurnTimeoutRefusal::Cooldown);
    }

    let was_active = payload
        .actor_session
        .as_deref()
        .and_then(|token| {
            actor_session_active_for_actor(&state.actor_sessions, payload.actor_id, token)
        })
        .unwrap_or(false);
    let mut runtime = state.inner.lock().await;
    if !client_actor_authorized_for_state(
        &runtime,
        &state,
        payload.actor_id,
        payload.actor_session.as_deref(),
    ) {
        return client_actor_rejected_response();
    }
    let active_direct_actor_ids = active_actor_ids_for_state(&state);
    let eligibility =
        match focused_timeout_eligibility(&runtime, payload.actor_id, &active_direct_actor_ids) {
            Ok(eligibility) => eligibility,
            Err(refusal) => {
                return turn_timeout_refusal_response(Some(&runtime), payload.actor_id, refusal);
            }
        };
    let focused = eligibility.focused;
    let current_actor_id = focused.current_actor_id;
    let turn_location_id = Some(focused.location_id);
    let timeout_requested = EventView {
        type_name: "turn.timeout_requested".to_string(),
        success: true,
        actor_id: Some(payload.actor_id),
        actor_name: runtime.actor_name(payload.actor_id),
        target_actor_id: Some(current_actor_id),
        target_actor_name: runtime.actor_name(current_actor_id),
        location_id: turn_location_id,
        content_id: Some(focused.encounter_id),
        content: Some(
            "The waiting participant asked the current player to play or pass.".to_string(),
        ),
        ..EventView::default()
    };
    let mut record = JournalRecord::new(
        CwAction {
            kind: if focused.profile_id == FOCUSED_COMBAT_PROFILE_ID {
                CW_ACTION_COMBAT_PASS
            } else {
                CW_ACTION_NONE
            },
            actor_id: current_actor_id,
            content_id: focused.encounter_id,
            ..CwAction::default()
        },
        runtime.next_seed_value(),
    )
    .into_system();
    if focused.profile_id != FOCUSED_COMBAT_PROFILE_ID {
        record.bind_offer_kind("pass");
        record
            .projection_mutations
            .push(ProjectionMutation::FocusedControl {
                control: "pass".to_string(),
            });
        bind_focused_encounter_context(&runtime, &mut record);
    }
    let Ok((mut status, mut events)) = commit_journal_record(&state, &mut runtime, record) else {
        return Json(ActionResponse {
            ok: false,
            status: 500,
            events: Vec::new(),
        });
    };
    if status == CW_OK && focused.profile_id == FOCUSED_COMBAT_PROFILE_ID {
        status = drive_available_combat_turns(
            &state,
            &mut runtime,
            focused.encounter_id,
            current_actor_id,
            &mut events,
        )
        .unwrap_or(500);
    }
    let observation = advance_turn_and_capture_player_tick_observation(
        &state,
        &mut runtime,
        turn_location_id,
        payload.actor_id,
        status,
        &mut events,
    );
    events.insert(0, timeout_requested);
    drop(runtime);

    broadcast_events(&state, &events);
    if let Some(observation) = observation {
        schedule_player_tick_observation(&state, observation);
    }
    if !was_active {
        events.extend(commit_presence_event(&state, payload.actor_id, true).await);
    }
    Json(ActionResponse {
        ok: status == CW_OK,
        status,
        events,
    })
}

pub(super) async fn pass_action(
    ConnectInfo(client_addr): ConnectInfo<SocketAddr>,
    State(state): State<AppState>,
    Json(payload): Json<ActorRequest>,
    pass_offer_id: &str,
) -> Json<ActionResponse> {
    if !allow_actor_mutation(
        &state,
        client_addr,
        payload.actor_id,
        "action-pass",
        GENERAL_ACTION_LIMIT,
    ) {
        return action_rate_limited_response();
    }

    let was_active = payload
        .actor_session
        .as_deref()
        .and_then(|token| {
            actor_session_active_for_actor(&state.actor_sessions, payload.actor_id, token)
        })
        .unwrap_or(false);
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
        drop(runtime);
        return Json(ActionResponse {
            ok: false,
            status: 404,
            events: Vec::new(),
        });
    };
    if !RuntimeWorld::actor_can_act(actor) {
        drop(runtime);
        return Json(ActionResponse {
            ok: false,
            status: 409,
            events: Vec::new(),
        });
    }
    if runtime
        .action_hand_for(Some(payload.actor_id), &[])
        .pass
        .offer_id
        != pass_offer_id
    {
        drop(runtime);
        if let Some(path) = state.event_store_path.as_deref() {
            if let Err(error) = record_stale_pass_rejection(path, payload.actor_id, pass_offer_id) {
                warn!(
                    "failed to record stale pass certificate metric for actor {}: {}",
                    payload.actor_id, error
                );
            }
        }
        return Json(ActionResponse {
            ok: false,
            status: 409,
            events: Vec::new(),
        });
    }
    if ordered_scene_rejection_view(&runtime, payload.actor_id)
        .is_some_and(|view| !view.is_current_actor)
    {
        let response = actor_ordered_scene_rejection(&runtime, payload.actor_id)
            .expect("the ordered scene rejection remains current");
        drop(runtime);
        return response;
    }
    // Certificate and turn validation must be side-effect free. In particular,
    // a stale or forged Pass cannot trigger unrelated inactive-inventory
    // cleanup before it is refused.
    let released_events = release_inactive_direct_inventory_locked(&state, &mut runtime);
    let turn_location_id = runtime
        .actor_by_id(payload.actor_id)
        .map(|actor| actor.location_id);
    let focused = focused_encounter_for_actor(&runtime, payload.actor_id);
    let thought_job = focused
        .is_none()
        .then(|| runtime.avatar_reflection_job(payload.actor_id, AvatarReflectionKind::Thought))
        .flatten();
    // A focused Pass is one authoritative action, not a hand shuffle followed
    // by a second control mutation. Keeping both consequences in this record
    // means the journal cannot retain a new hand if the focused scene rejects
    // or fails to advance the pass.
    let mut record = if let Some(focused) = focused.as_ref() {
        if focused.profile_id == FOCUSED_COMBAT_PROFILE_ID {
            JournalRecord::new(
                CwAction {
                    kind: CW_ACTION_COMBAT_PASS,
                    actor_id: payload.actor_id,
                    content_id: focused.encounter_id,
                    ..CwAction::default()
                },
                runtime.next_seed_value(),
            )
            .into_player_card()
        } else {
            let mut record = JournalRecord::new(
                CwAction {
                    kind: CW_ACTION_NONE,
                    actor_id: payload.actor_id,
                    content_id: focused.encounter_id,
                    location_id: turn_location_id.unwrap_or_default(),
                    ..CwAction::default()
                },
                runtime.next_seed_value(),
            )
            .into_player_card();
            record.bind_offer_kind("pass");
            record
                .projection_mutations
                .push(ProjectionMutation::FocusedControl {
                    control: "pass".to_string(),
                });
            bind_focused_encounter_context(&runtime, &mut record);
            record
        }
    } else {
        JournalRecord::new(
            CwAction {
                kind: CW_ACTION_NONE,
                actor_id: payload.actor_id,
                location_id: turn_location_id.unwrap_or_default(),
                ..CwAction::default()
            },
            runtime.next_seed_value(),
        )
        .into_player_card()
    };
    record
        .projection_mutations
        .push(ProjectionMutation::ShuffleHand {
            reason: "player_pass".to_string(),
        });
    if let Some(job) = thought_job.clone() {
        attach_avatar_reflection_check(&mut record, job);
    }
    let Ok((status, mut events)) = commit_journal_record(&state, &mut runtime, record) else {
        drop(runtime);
        broadcast_events(&state, &released_events);
        return Json(ActionResponse {
            ok: false,
            status: 500,
            events: Vec::new(),
        });
    };
    let mut status = status;
    if status == CW_OK
        && focused
            .as_ref()
            .is_some_and(|focused| focused.profile_id == FOCUSED_COMBAT_PROFILE_ID)
    {
        status = drive_available_combat_turns(
            &state,
            &mut runtime,
            focused
                .as_ref()
                .expect("the checked combat focus remains available")
                .encounter_id,
            payload.actor_id,
            &mut events,
        )
        .unwrap_or(500);
    }
    let observation = advance_turn_and_capture_player_tick_observation(
        &state,
        &mut runtime,
        turn_location_id,
        payload.actor_id,
        status,
        &mut events,
    );
    drop(runtime);
    broadcast_events(&state, &released_events);
    broadcast_events(&state, &events);
    if let Some(observation) = observation {
        schedule_player_tick_observation(&state, observation);
    }
    if status == CW_OK {
        if let Some(job) = thought_job {
            schedule_avatar_reflection(&state, job, &events);
        }
    }

    if !was_active {
        events.extend(commit_presence_event(&state, payload.actor_id, true).await);
    }
    Json(ActionResponse {
        ok: status == CW_OK,
        status,
        events,
    })
}

pub(super) async fn legacy_pass_requires_certificate(
    payload: Json<ActorRequest>,
) -> (StatusCode, Json<ActionResponse>) {
    legacy_action_requires_certificate(payload).await
}

/// Legacy per-action transports cannot prove that the submitted mutation was
/// dealt in the actor's current hand.  Keep the handler helpers available for
/// trusted composition and direct unit tests, but require public clients to
/// submit the versioned offer certificate through `/actions/submit`.
pub(super) async fn legacy_action_requires_certificate(
    Json(_payload): Json<ActorRequest>,
) -> (StatusCode, Json<ActionResponse>) {
    (
        StatusCode::BAD_REQUEST,
        Json(ActionResponse {
            ok: false,
            status: 400,
            events: Vec::new(),
        }),
    )
}

#[cfg(test)]
pub(super) async fn draw_action(
    client: ConnectInfo<SocketAddr>,
    State(state): State<AppState>,
    Json(payload): Json<ActorRequest>,
) -> Json<ActionResponse> {
    let offer_id = state
        .inner
        .lock()
        .await
        .action_hand_for(Some(payload.actor_id), &[])
        .pass
        .offer_id;
    pass_action(client, State(state), Json(payload), &offer_id).await
}

async fn apply_focused_control(
    state: AppState,
    actor_id: u64,
    control: &str,
    actor_session: Option<&str>,
) -> Json<ActionResponse> {
    let work_focused = {
        let runtime = state.inner.lock().await;
        focused_job_encounter(&runtime, actor_id).is_some()
    };
    if !work_focused {
        return apply_combat_choice(
            state,
            actor_id,
            if control == "need_time" {
                CombatChoice::NeedTime
            } else {
                CombatChoice::Pass
            },
            actor_session,
        )
        .await;
    }

    let was_active = actor_session
        .and_then(|token| actor_session_active_for_actor(&state.actor_sessions, actor_id, token))
        .unwrap_or(false);
    let mut runtime = state.inner.lock().await;
    if !client_actor_authorized_for_state(&runtime, &state, actor_id, actor_session) {
        return client_actor_rejected_response();
    }
    let released_events = release_inactive_direct_inventory_locked(&state, &mut runtime);
    let Some(focused) = focused_job_encounter(&runtime, actor_id) else {
        drop(runtime);
        broadcast_events(&state, &released_events);
        return Json(ActionResponse {
            ok: false,
            status: 409,
            events: Vec::new(),
        });
    };
    if focused.current_actor_id != actor_id {
        let event = EventView {
            type_name: "focused.turn.waiting".to_string(),
            success: false,
            actor_id: Some(focused.current_actor_id),
            actor_name: runtime.actor_name(focused.current_actor_id),
            location_id: Some(focused.location_id),
            content_id: Some(focused.encounter_id),
            content: Some("The focused scene belongs to another participant.".to_string()),
            ..EventView::default()
        };
        drop(runtime);
        broadcast_events(&state, &released_events);
        return Json(ActionResponse {
            ok: false,
            status: 423,
            events: vec![event],
        });
    }
    if control == "need_time"
        && focused_job_need_time_used(&runtime, focused.encounter_id, actor_id)
    {
        drop(runtime);
        broadcast_events(&state, &released_events);
        return Json(ActionResponse {
            ok: false,
            status: 409,
            events: Vec::new(),
        });
    }
    let turn_location_id = Some(focused.location_id);
    let mut record = JournalRecord::new(
        CwAction {
            kind: CW_ACTION_NONE,
            actor_id,
            content_id: focused.encounter_id,
            ..CwAction::default()
        },
        runtime.next_seed_value(),
    );
    record = if control == "need_time" {
        record.into_player_control()
    } else {
        record.into_player_card()
    };
    record.bind_offer_kind(control);
    record
        .projection_mutations
        .push(ProjectionMutation::FocusedControl {
            control: control.to_string(),
        });
    let Ok((status, mut events)) = commit_journal_record(&state, &mut runtime, record) else {
        drop(runtime);
        broadcast_events(&state, &released_events);
        return Json(ActionResponse {
            ok: false,
            status: 500,
            events: Vec::new(),
        });
    };
    let observation = if control == "need_time" {
        if status == CW_OK {
            append_action_receipt(&runtime, actor_id, &mut events);
        }
        None
    } else {
        advance_turn_and_capture_player_tick_observation(
            &state,
            &mut runtime,
            turn_location_id,
            actor_id,
            status,
            &mut events,
        )
    };
    drop(runtime);
    broadcast_events(&state, &released_events);
    broadcast_events(&state, &events);
    if let Some(observation) = observation {
        schedule_player_tick_observation(&state, observation);
    }
    let mut response_events = events;
    if !was_active {
        response_events.extend(commit_presence_event(&state, actor_id, true).await);
    }
    Json(ActionResponse {
        ok: status == CW_OK,
        status,
        events: response_events,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn focused_work_record(runtime: &RuntimeWorld, actor_id: u64, seed: u64) -> JournalRecord {
        let intent = runtime
            .job_contribution_intent(actor_id, "work", Some(FIRST_TALE_JOB_ID), None, None)
            .expect("focused fixture offers Work");
        let mut record = JournalRecord::new(
            CwAction {
                kind: CW_ACTION_NONE,
                actor_id,
                ..CwAction::default()
            },
            seed,
        )
        .into_player_card();
        record.bind_offer_kind("work");
        record
            .projection_mutations
            .push(ProjectionMutation::ResolveJobContribution { intent });
        bind_focused_encounter_context(runtime, &mut record);
        record
    }

    fn focused_control_record(
        runtime: &RuntimeWorld,
        actor_id: u64,
        control: &str,
        seed: u64,
    ) -> JournalRecord {
        let focused = focused_job_encounter(runtime, actor_id).expect("focused fixture is active");
        let mut record = JournalRecord::new(
            CwAction {
                kind: CW_ACTION_NONE,
                actor_id,
                content_id: focused.encounter_id,
                ..CwAction::default()
            },
            seed,
        );
        record = if matches!(control, "prepare" | "need_time") {
            record.into_player_control()
        } else {
            record.into_player_card()
        };
        record.bind_offer_kind(control);
        record
            .projection_mutations
            .push(ProjectionMutation::FocusedControl {
                control: control.to_string(),
            });
        bind_focused_encounter_context(runtime, &mut record);
        record
    }

    fn focused_timeout_fixture() -> RuntimeWorld {
        let mut runtime = RuntimeWorld::seeded();
        create_test_human(
            &mut runtime,
            5000,
            RAIN_SOFT_GARDEN_LOCATION_ID,
            "Current Worker",
        );
        create_test_human(
            &mut runtime,
            5001,
            RAIN_SOFT_GARDEN_LOCATION_ID,
            "Waiting Worker",
        );
        for actor_id in [5000, 5001] {
            runtime
                .actor_autonomy
                .entry(actor_id)
                .or_default()
                .control_mode = ActorControlMode::DirectInput;
        }
        {
            let job = runtime
                .jobs
                .get_mut(FIRST_TALE_JOB_ID)
                .expect("focused timeout fixture job");
            job.status = "active".to_string();
            job.focused_profile = Some(FOCUSED_WORK_PROFILE.to_string());
            job.focused_encounter = None;
        }
        for clock_id in [
            FIRST_TALE_PROGRESS_CLOCK_ID,
            "rain-soft-garden.path-washes-out",
        ] {
            let clock = runtime
                .clocks
                .get_mut(clock_id)
                .expect("focused timeout fixture clock");
            clock.segments = 12;
            clock.filled = 0;
            clock.status = "active".to_string();
            clock.recent_contributions.clear();
            clock.completion = None;
        }
        let first = focused_work_record(&runtime, 5000, 83_100);
        assert_eq!(runtime.apply_journal_record(&first).0, CW_OK);
        let second = focused_work_record(&runtime, 5001, 83_101);
        assert_eq!(runtime.apply_journal_record(&second).0, CW_OK);
        assert_eq!(
            focused_job_encounter(&runtime, 5000)
                .expect("focused timeout fixture starts")
                .current_actor_id,
            5000
        );
        runtime
    }

    fn runtime_snapshot_bytes(runtime: &RuntimeWorld) -> Vec<u8> {
        serde_json::to_vec(&RuntimeSnapshot::from_runtime(runtime))
            .expect("runtime snapshot serializes")
    }

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
            command_concurrency_policy(&CommandDispatch::PickUp {
                item_id: 2001,
                exchange_item_id: None,
            }),
            ConcurrencyPolicy::TargetSerialized
        );
        assert_eq!(
            command_concurrency_policy(&CommandDispatch::Defend),
            ConcurrencyPolicy::SceneTurn
        );
    }

    #[test]
    fn transfer_offer_responses_are_card_exempt_and_only_non_mutating_choices_skip_turns() {
        for decision in ["accept", "decline", "withdraw"] {
            let dispatch = CommandDispatch::ResolveTransferOffer {
                offer_id: "offer:test".to_string(),
                decision: decision.to_string(),
            };
            assert!(command_dispatch_is_visible_room_control(&dispatch));
            assert_eq!(
                command_dispatch_consumes_room_turn(&dispatch),
                decision == "accept"
            );
        }
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
    fn timeout_refusal_contract_has_distinct_machine_stable_types() {
        let refusals = [
            TurnTimeoutRefusal::NoFocusedScene,
            TurnTimeoutRefusal::RequesterHoldsTurn,
            TurnTimeoutRefusal::ParticipantsBelowTwo,
            TurnTimeoutRefusal::RequesterNotEligible,
            TurnTimeoutRefusal::Cooldown,
        ];
        let event_types = refusals
            .iter()
            .map(|refusal| refusal.event_type())
            .collect::<BTreeSet<_>>();
        assert_eq!(event_types.len(), refusals.len());
        assert!(event_types
            .iter()
            .all(|event_type| event_type.starts_with("turn.timeout_refused.")));
        assert!(refusals
            .iter()
            .all(|refusal| !refusal.message().trim().is_empty()));
    }

    #[tokio::test]
    async fn current_holder_timeout_refusal_is_actionable_and_byte_unchanged() {
        let state = test_app_state(focused_timeout_fixture(), None);
        let (current_session, _) = issue_actor_session(&state, 5000);
        let (waiting_session, _) = issue_actor_session(&state, 5001);
        assert_eq!(
            actor_for_session(&state.actor_sessions, &current_session),
            Some(5000)
        );
        assert_eq!(
            actor_for_session(&state.actor_sessions, &waiting_session),
            Some(5001)
        );
        let before = {
            let runtime = state.inner.lock().await;
            runtime_snapshot_bytes(&runtime)
        };

        let response = request_turn_timeout(
            ConnectInfo("127.0.0.1:45170".parse().unwrap()),
            State(state.clone()),
            Json(ActorRequest {
                actor_id: 5000,
                actor_session: Some(current_session),
            }),
        )
        .await
        .0;

        assert!(!response.ok);
        assert_eq!(response.status, 409);
        assert_eq!(response.events.len(), 1);
        assert_eq!(
            response.events[0].type_name,
            "turn.timeout_refused.requester_holds_turn"
        );
        assert_eq!(
            response.events[0].content.as_deref(),
            Some("You already hold this turn. Play an action, pass, or ask for more time.")
        );
        let after = {
            let runtime = state.inner.lock().await;
            runtime_snapshot_bytes(&runtime)
        };
        assert_eq!(after, before, "a holder refusal cannot mutate turn state");
    }

    #[tokio::test]
    async fn participants_below_two_timeout_refusal_is_actionable_and_byte_unchanged() {
        let state = test_app_state(focused_timeout_fixture(), None);
        let (current_session, _) = issue_actor_session(&state, 5000);
        let (waiting_session, _) = issue_actor_session(&state, 5001);
        assert_eq!(
            actor_for_session(&state.actor_sessions, &current_session),
            Some(5000)
        );
        assert_eq!(
            actor_for_session(&state.actor_sessions, &waiting_session),
            Some(5001)
        );
        assert!(mark_actor_session_inactive(
            &state.actor_sessions,
            5000,
            &current_session
        ));
        let active_actor_ids = active_actor_ids_for_state(&state);
        let before = {
            let runtime = state.inner.lock().await;
            let turn = actor_room_turn_view(&state, &runtime, 5001, &active_actor_ids)
                .expect("waiting actor projects a turn");
            assert!(!turn.can_request_timeout);
            runtime_snapshot_bytes(&runtime)
        };

        let response = request_turn_timeout(
            ConnectInfo("127.0.0.1:45171".parse().unwrap()),
            State(state.clone()),
            Json(ActorRequest {
                actor_id: 5001,
                actor_session: Some(waiting_session),
            }),
        )
        .await
        .0;

        assert!(!response.ok);
        assert_eq!(response.status, 409);
        assert_eq!(response.events.len(), 1);
        assert_eq!(
            response.events[0].type_name,
            "turn.timeout_refused.participants_below_two"
        );
        assert_eq!(
            response.events[0].content.as_deref(),
            Some(
                "Fewer than two eligible participants remain, so nobody can be nudged. The ordered scene will recover when another participant returns."
            )
        );
        let after = {
            let runtime = state.inner.lock().await;
            runtime_snapshot_bytes(&runtime)
        };
        assert_eq!(
            after, before,
            "a participant-count refusal cannot mutate turn state"
        );
    }

    #[tokio::test]
    async fn projected_timeout_eligibility_matches_replayable_nudge_advancement() {
        let path = std::env::temp_dir().join(format!(
            "cosyworld-focused-timeout-{}-{}.sqlite",
            std::process::id(),
            now_seed()
        ));
        let _ = fs::remove_file(&path);
        let runtime = RuntimeSnapshot::from_runtime(&focused_timeout_fixture())
            .into_runtime()
            .expect("timeout fixture reconnects before the replay test");
        let state = test_app_state(runtime, Some(path.clone()));
        let (current_session, _) = issue_actor_session(&state, 5000);
        let (waiting_session, _) = issue_actor_session(&state, 5001);
        assert_eq!(
            actor_for_session(&state.actor_sessions, &current_session),
            Some(5000)
        );
        assert_eq!(
            actor_for_session(&state.actor_sessions, &waiting_session),
            Some(5001)
        );
        let active_actor_ids = active_actor_ids_for_state(&state);
        let replay_base = {
            let runtime = state.inner.lock().await;
            let eligibility = focused_timeout_eligibility(&runtime, 5001, &active_actor_ids)
                .expect("waiting actor is eligible");
            assert_eq!(eligibility.eligible_participant_ids, vec![5000, 5001]);
            let turn = actor_room_turn_view(&state, &runtime, 5001, &active_actor_ids)
                .expect("waiting actor projects a turn");
            assert!(turn.can_request_timeout);
            assert_eq!(turn.waiting_actor_ids, vec![5001]);
            RuntimeSnapshot::from_runtime(&runtime)
        };

        let response = request_turn_timeout(
            ConnectInfo("127.0.0.1:45172".parse().unwrap()),
            State(state.clone()),
            Json(ActorRequest {
                actor_id: 5001,
                actor_session: Some(waiting_session),
            }),
        )
        .await
        .0;

        assert!(response.ok);
        assert_eq!(response.status, CW_OK);
        assert!(response
            .events
            .iter()
            .any(|event| event.type_name == "turn.timeout_requested"
                && event.actor_id == Some(5001)
                && event.target_actor_id == Some(5000)));
        assert!(response
            .events
            .iter()
            .any(|event| event.type_name == "focused.pass" && event.actor_id == Some(5000)));
        let (expected, committed_journal_seq) = {
            let runtime = state.inner.lock().await;
            assert_eq!(
                focused_job_encounter(&runtime, 5001)
                    .expect("nudge keeps the focus active")
                    .current_actor_id,
                5001
            );
            (runtime_snapshot_bytes(&runtime), runtime.action_journal_seq)
        };

        let journal = read_action_journal(&path).expect("timeout journal");
        assert_eq!(journal.len(), 1);
        assert_eq!(journal[0].origin, JournalOrigin::System);
        assert_eq!(journal[0].action.actor_id, 5000);
        assert_eq!(journal[0].offer_kind.as_deref(), Some("pass"));
        let mut replayed = replay_base
            .into_runtime()
            .expect("timeout replay base restores");
        assert_eq!(replayed.apply_journal_record(&journal[0]).0, CW_OK);
        // The reducer replays world state; the durable store supplies its row
        // sequence separately when continuity restoration completes.
        replayed.action_journal_seq = committed_journal_seq;
        let replayed_bytes = runtime_snapshot_bytes(&replayed);
        if replayed_bytes != expected {
            let expected_value: serde_json::Value =
                serde_json::from_slice(&expected).expect("expected snapshot parses");
            let replayed_value: serde_json::Value =
                serde_json::from_slice(&replayed_bytes).expect("replayed snapshot parses");
            let differing_keys = expected_value
                .as_object()
                .expect("expected snapshot object")
                .iter()
                .filter_map(|(key, expected)| {
                    (replayed_value.get(key) != Some(expected)).then_some(key.as_str())
                })
                .collect::<Vec<_>>();
            panic!(
                "the successful nudge must replay to the identical focused state; differing top-level keys: {differing_keys:?}"
            );
        }
        let _ = fs::remove_file(path);
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

        let offered = runtime
            .legal_action_candidates(Some(5000), &AccessContext::default())
            .1
            .into_iter()
            .find(|offer| offer.kind == "attack")
            .expect("current actor receives a certified attack");
        let reconnected = RuntimeSnapshot::from_runtime(&runtime)
            .into_runtime()
            .expect("focused encounter reconnects from its snapshot");
        let reconnected_offer = reconnected
            .legal_action_candidates(Some(5000), &AccessContext::default())
            .1
            .into_iter()
            .find(|offer| offer.kind == "attack")
            .expect("reconnect projects the current attack");
        assert_eq!(reconnected_offer.offer_id, offered.offer_id);
        assert_eq!(reconnected_offer.composition_id, offered.composition_id);
        assert_eq!(
            reconnected_offer.composition_trace.focused_encounter,
            offered.composition_trace.focused_encounter
        );

        let pass = JournalRecord::new(
            CwAction {
                kind: CW_ACTION_COMBAT_PASS,
                actor_id: 5000,
                content_id: encounter_id,
                ..CwAction::default()
            },
            81_002,
        )
        .into_player_card();
        assert_eq!(runtime.apply_journal_record(&pass).0, CW_OK);
        assert!(
            runtime.plan_combat_offer_action(5000, &offered).is_err(),
            "the prior turn certificate expires after Pass"
        );
    }

    #[test]
    fn cooperative_work_uses_the_focused_scheduler_and_replays_absence_recovery() {
        std::thread::Builder::new()
            .name("focused-work-scheduler-replay".to_string())
            .stack_size(16 * 1024 * 1024)
            .spawn(|| {
                tokio::runtime::Builder::new_current_thread()
                    .enable_all()
                    .build()
                    .expect("build focused work test runtime")
                    .block_on(run_cooperative_work_scheduler_replay());
            })
            .expect("spawn focused work scheduler test")
            .join()
            .expect("focused work scheduler test completes");
    }

    async fn run_cooperative_work_scheduler_replay() {
        let mut runtime = RuntimeWorld::seeded();
        create_test_human(
            &mut runtime,
            5000,
            RAIN_SOFT_GARDEN_LOCATION_ID,
            "First Worker",
        );
        create_test_human(
            &mut runtime,
            5001,
            RAIN_SOFT_GARDEN_LOCATION_ID,
            "Second Worker",
        );
        for actor_id in [5000, 5001] {
            runtime
                .actor_autonomy
                .entry(actor_id)
                .or_default()
                .control_mode = ActorControlMode::DirectInput;
        }
        {
            let job = runtime
                .jobs
                .get_mut(FIRST_TALE_JOB_ID)
                .expect("focused fixture job");
            job.status = "active".to_string();
            job.focused_profile = Some(FOCUSED_WORK_PROFILE.to_string());
            job.focused_encounter = None;
        }
        for clock_id in [
            FIRST_TALE_PROGRESS_CLOCK_ID,
            "rain-soft-garden.path-washes-out",
        ] {
            let clock = runtime
                .clocks
                .get_mut(clock_id)
                .expect("focused fixture clock");
            clock.segments = 12;
            clock.filled = 0;
            clock.status = "active".to_string();
            clock.recent_contributions.clear();
            clock.completion = None;
        }

        let first = focused_work_record(&runtime, 5000, 82_100);
        assert_eq!(runtime.apply_journal_record(&first).0, CW_OK);
        assert!(focused_job_encounter(&runtime, 5000).is_none());
        let second = focused_work_record(&runtime, 5001, 82_101);
        let (status, started_events) = runtime.apply_journal_record(&second);
        assert_eq!(status, CW_OK);
        assert!(started_events
            .iter()
            .any(|event| event.type_name == "focused.encounter.started"));

        let focused = focused_job_encounter(&runtime, 5000).expect("shared work becomes focused");
        assert_eq!(focused.profile_id, FOCUSED_WORK_PROFILE_ID);
        assert_eq!(focused.profile_version, FOCUSED_WORK_PROFILE_VERSION);
        assert_eq!(focused.current_actor_id, 5000);
        assert_eq!(focused.objective_clock_id, FIRST_TALE_PROGRESS_CLOCK_ID);
        assert_eq!(
            focused.danger_clock_id.as_deref(),
            Some("rain-soft-garden.path-washes-out")
        );
        assert_eq!(focused.activation_budget.setup_remaining, 1);
        assert_eq!(focused.activation_budget.commit_remaining, 1);
        assert!(focused.validate().is_ok());

        let direct_offer = runtime
            .legal_action_candidates(Some(5000), &AccessContext::default())
            .1
            .into_iter()
            .find(|offer| {
                offer.kind == "work"
                    && offer
                        .project
                        .as_ref()
                        .is_some_and(|project| project.id == FIRST_TALE_JOB_ID)
            })
            .expect("current participant receives certified Work");
        let offer_context = direct_offer
            .composition_trace
            .focused_encounter
            .as_ref()
            .expect("Work carries focused identity");
        assert_eq!(offer_context.profile_id, FOCUSED_WORK_PROFILE_ID);
        assert_eq!(offer_context.activation_step, FocusedActivationStep::Commit);
        let reconnected = RuntimeSnapshot::from_runtime(&runtime)
            .into_runtime()
            .expect("focused work reconnects from its snapshot");
        let reconnected_offer = reconnected
            .legal_action_candidates(Some(5000), &AccessContext::default())
            .1
            .into_iter()
            .find(|offer| {
                offer.kind == "work"
                    && offer
                        .project
                        .as_ref()
                        .is_some_and(|project| project.id == FIRST_TALE_JOB_ID)
            })
            .expect("reconnect projects the current Work");
        assert_eq!(reconnected_offer.offer_id, direct_offer.offer_id);
        assert_eq!(
            reconnected_offer.composition_id,
            direct_offer.composition_id
        );
        assert_eq!(
            reconnected_offer.composition_trace.focused_encounter,
            direct_offer.composition_trace.focused_encounter
        );

        runtime
            .actor_autonomy
            .get_mut(&5000)
            .expect("first worker controller")
            .control_mode = ActorControlMode::LocalAi;
        let inference_offer = runtime
            .legal_action_candidates(Some(5000), &AccessContext::default())
            .1
            .into_iter()
            .find(|offer| {
                offer.kind == "work"
                    && offer
                        .project
                        .as_ref()
                        .is_some_and(|project| project.id == FIRST_TALE_JOB_ID)
            })
            .expect("inference receives the same Work");
        assert_eq!(
            serde_json::to_value(&inference_offer).expect("inference offer serializes"),
            serde_json::to_value(&direct_offer).expect("direct offer serializes")
        );
        runtime
            .actor_autonomy
            .get_mut(&5000)
            .expect("first worker controller")
            .control_mode = ActorControlMode::DirectInput;

        let before_setup_tick = runtime.world.tick;
        let setup = focused_control_record(&runtime, 5000, "prepare", 82_102);
        let (status, setup_events) = runtime.apply_journal_record(&setup);
        assert_eq!(status, CW_OK);
        assert_eq!(runtime.world.tick, before_setup_tick);
        assert!(setup_events
            .iter()
            .any(|event| event.type_name == "focused.setup"));
        let after_setup = focused_job_encounter(&runtime, 5000).expect("focus remains active");
        assert_eq!(after_setup.current_actor_id, 5000);
        assert_eq!(after_setup.activation_budget.setup_remaining, 0);

        let committed_offer = runtime
            .legal_action_candidates(Some(5000), &AccessContext::default())
            .1
            .into_iter()
            .find(|offer| {
                offer.kind == "work"
                    && offer
                        .project
                        .as_ref()
                        .is_some_and(|project| project.id == FIRST_TALE_JOB_ID)
            })
            .expect("Setup leaves one Work commit");
        let before_commit_tick = runtime.world.tick;
        let commit = focused_work_record(&runtime, 5000, 82_103);
        assert_eq!(runtime.apply_journal_record(&commit).0, CW_OK);
        assert_eq!(runtime.world.tick, before_commit_tick + 1);
        assert_eq!(
            focused_job_encounter(&runtime, 5001)
                .expect("focus hands off")
                .current_actor_id,
            5001
        );
        assert!(
            runtime
                .current_reachable_offer(5000, &committed_offer)
                .is_none(),
            "the prior activation certificate is stale after Commit"
        );

        let before_pass_tick = runtime.world.tick;
        let pass = focused_control_record(&runtime, 5001, "pass", 82_104);
        assert_eq!(runtime.apply_journal_record(&pass).0, CW_OK);
        assert_eq!(runtime.world.tick, before_pass_tick + 1);
        assert_eq!(
            focused_job_encounter(&runtime, 5000)
                .expect("Pass hands focus back")
                .current_actor_id,
            5000
        );

        let replay_base = RuntimeSnapshot::from_runtime(&runtime);
        let path = std::env::temp_dir().join(format!(
            "cosyworld-focused-work-recovery-{}-{}.sqlite",
            std::process::id(),
            now_seed()
        ));
        let _ = fs::remove_file(&path);
        let state = test_app_state(runtime, Some(path.clone()));
        assert!(
            recover_available_focused_job_turns(&state)
                .await
                .expect("idle recovery succeeds")
                .is_empty(),
            "a focused job with nobody available must not churn Pass records"
        );

        let (downed_session, _) = issue_actor_session(&state, 5000);
        assert_eq!(
            actor_for_session(&state.actor_sessions, &downed_session),
            Some(5000)
        );
        {
            let mut runtime = state.inner.lock().await;
            let actor_count = runtime.world.actor_count;
            let downed = runtime
                .world
                .actors
                .iter_mut()
                .take(actor_count)
                .find(|actor| actor.id == 5000)
                .expect("current worker exists");
            downed.status = CW_ACTOR_KNOCKED_OUT;
            downed.conditions |= CW_CONDITION_UNCONSCIOUS;
            assert!(!focused_job_action_available(
                &runtime,
                5000,
                FIRST_TALE_JOB_ID,
                "work"
            ));
        }
        let (session, _) = issue_actor_session(&state, 5001);
        assert_eq!(
            actor_for_session(&state.actor_sessions, &session),
            Some(5001)
        );
        let unavailable_hand_generation = {
            let runtime = state.inner.lock().await;
            runtime.hand_generations.get(&5000).copied()
        };
        let recovery_events = recover_available_focused_job_turns(&state)
            .await
            .expect("focused work recovery succeeds");
        assert!(recovery_events
            .iter()
            .any(|event| { event.type_name == "focused.pass" && event.actor_id == Some(5000) }));
        let runtime = state.inner.lock().await;
        assert_eq!(
            focused_job_encounter(&runtime, 5001)
                .expect("available participant receives focus")
                .current_actor_id,
            5001
        );
        assert_eq!(
            runtime.hand_generations.get(&5000).copied(),
            unavailable_hand_generation,
            "an unavailable worker's system recovery must not rotate a hand"
        );
        drop(runtime);

        let journal = read_action_journal(&path).expect("focused work recovery journal");
        assert_eq!(journal.len(), 1);
        assert!(journal.iter().any(|record| {
            record.action.actor_id == 5000
                && record.origin == JournalOrigin::System
                && record.offer_kind.as_deref() == Some("pass")
                && record.focused_encounter.as_ref().is_some_and(|context| {
                    context.profile_id == FOCUSED_WORK_PROFILE_ID
                        && context.activation_step == FocusedActivationStep::Commit
                })
        }));
        let mut replayed = replay_base
            .into_runtime()
            .expect("focused work recovery checkpoint restores");
        for record in &journal {
            assert_eq!(replayed.apply_journal_record(record).0, CW_OK);
        }
        assert_eq!(
            focused_job_encounter(&replayed, 5001)
                .expect("replay restores the same handoff")
                .current_actor_id,
            5001
        );

        {
            let mut runtime = state.inner.lock().await;
            let active = runtime
                .world
                .actors
                .iter_mut()
                .find(|actor| actor.id == 5000)
                .expect("first worker remains in the scene");
            active.status = CW_ACTOR_ACTIVE;
            active.conditions &= !CW_CONDITION_UNCONSCIOUS;
        }
        let (waiting_session, _) = issue_actor_session(&state, 5000);
        assert_eq!(
            actor_for_session(&state.actor_sessions, &waiting_session),
            Some(5000)
        );
        let before_inference_tick = {
            let mut runtime = state.inner.lock().await;
            runtime
                .actor_autonomy
                .get_mut(&5001)
                .expect("second worker controller")
                .control_mode = ActorControlMode::LocalAi;
            let actor = runtime.actor_by_id(5001).expect("focused inference actor");
            let mut dealt_generation = None;
            for generation in 0..64 {
                runtime.hand_generations.insert(5001, generation);
                let (_, offers) =
                    runtime.legal_action_candidates(Some(5001), &AccessContext::default());
                let hand = runtime.action_hand_for(Some(5001), &offers);
                let preferred = runtime
                    .resident_job_autonomy_record(actor, 82_199)
                    .expect("focused worker has a preferred contribution");
                if offers.iter().any(|offer| {
                    hand.entries
                        .iter()
                        .any(|entry| entry.offer_id == offer.offer_id)
                        && runtime.resident_offer_matches_record(offer, &preferred)
                }) {
                    dealt_generation = Some(generation);
                    break;
                }
            }
            assert!(
                dealt_generation.is_some(),
                "a finite hand eventually deals the focused contribution"
            );
            runtime.world.tick
        };
        let inference_events = recover_available_focused_job_turns(&state)
            .await
            .expect("inference-controlled Work succeeds");
        assert!(inference_events.iter().any(|event| {
            event.type_name == "job.contribution.resolved" && event.actor_id == Some(5001)
        }));
        let runtime = state.inner.lock().await;
        assert_eq!(
            runtime.world.tick,
            before_inference_tick + 1,
            "an inference Commit advances the same one world tick as direct control"
        );
        assert_eq!(
            focused_job_encounter(&runtime, 5000)
                .expect("inference Commit hands focus to the direct participant")
                .current_actor_id,
            5000
        );
        drop(runtime);

        let journal = read_action_journal(&path).expect("focused inference journal");
        assert_eq!(journal.len(), 2);
        let inference_record = journal.last().expect("inference Commit is journaled");
        assert_eq!(inference_record.action.actor_id, 5001);
        assert_eq!(inference_record.origin, JournalOrigin::PlayerCard);
        assert!(inference_record.resident_decision.is_some());
        assert!(matches!(
            inference_record.offer_kind.as_deref(),
            Some("work" | "help" | "study")
        ));
        assert_eq!(replayed.apply_journal_record(inference_record).0, CW_OK);
        assert_eq!(replayed.world.tick, before_inference_tick + 1);
        assert_eq!(
            focused_job_encounter(&replayed, 5000)
                .expect("replay restores the inference handoff")
                .current_actor_id,
            5000
        );

        let (off_hand_generation, before_off_hand_tick, before_off_hand_progress, journal_len) = {
            let mut runtime = state.inner.lock().await;
            runtime
                .actor_autonomy
                .get_mut(&5000)
                .expect("first worker controller")
                .control_mode = ActorControlMode::LocalAi;
            let actor = runtime.actor_by_id(5000).expect("focused inference actor");
            let mut off_hand_generation = None;
            for generation in 0..64 {
                runtime.hand_generations.insert(5000, generation);
                let (_, offers) =
                    runtime.legal_action_candidates(Some(5000), &AccessContext::default());
                let hand = runtime.action_hand_for(Some(5000), &offers);
                let preferred = runtime
                    .resident_job_autonomy_record(actor, 82_200)
                    .expect("focused worker has a preferred contribution");
                let preferred_is_dealt = offers.iter().any(|offer| {
                    hand.entries
                        .iter()
                        .any(|entry| entry.offer_id == offer.offer_id)
                        && runtime.resident_offer_matches_record(offer, &preferred)
                });
                if !preferred_is_dealt {
                    off_hand_generation = Some(generation);
                    break;
                }
            }
            (
                off_hand_generation.expect("a finite hand eventually excludes the preferred Work"),
                runtime.world.tick,
                runtime
                    .clocks
                    .get(FIRST_TALE_PROGRESS_CLOCK_ID)
                    .expect("focused progress clock")
                    .filled,
                read_action_journal(&path)
                    .expect("focused journal before off-hand recovery")
                    .len(),
            )
        };
        let off_hand_events = recover_available_focused_job_turns(&state)
            .await
            .expect("off-hand focused recovery chooses the certified Pass");
        assert!(off_hand_events
            .iter()
            .any(|event| { event.type_name == "focused.pass" && event.actor_id == Some(5000) }));
        assert!(
            !off_hand_events
                .iter()
                .any(|event| event.type_name == "job.contribution.resolved"),
            "an undealt preferred contribution must not bypass the current hand"
        );
        let runtime = state.inner.lock().await;
        assert_eq!(
            runtime.world.tick,
            before_off_hand_tick + 1,
            "an inference-controlled certified Pass spends one world tick"
        );
        assert_eq!(
            runtime
                .clocks
                .get(FIRST_TALE_PROGRESS_CLOCK_ID)
                .expect("focused progress clock")
                .filled,
            before_off_hand_progress,
            "the certified focused Pass cannot advance project progress"
        );
        assert_eq!(
            runtime.hand_generations.get(&5000).copied(),
            Some(off_hand_generation + 1)
        );
        assert_eq!(
            focused_job_encounter(&runtime, 5001)
                .expect("off-hand Pass hands focus over once")
                .current_actor_id,
            5001
        );
        drop(runtime);
        let journal = read_action_journal(&path).expect("focused journal after off-hand recovery");
        assert_eq!(journal.len(), journal_len + 1);
        assert!(journal.last().is_some_and(|record| {
            record.action.actor_id == 5000
                && record.origin == JournalOrigin::PlayerCard
                && record.offer_kind.as_deref() == Some("pass")
                && record.projection_mutations.iter().any(|mutation| {
                    matches!(
                        mutation,
                        ProjectionMutation::ShuffleHand { reason }
                            if reason == "resident_focused_pass"
                    )
                })
        }));
        let _ = fs::remove_file(path);
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
    fn common_post_commit_hook_records_live_growth_once() {
        let path = std::env::temp_dir().join(format!(
            "cosyworld-activation-post-commit-{}-{}.sqlite",
            std::process::id(),
            now_seed()
        ));
        let _ = fs::remove_file(&path);
        let state = test_app_state(RuntimeWorld::seeded(), Some(path.clone()));
        let runtime = RuntimeWorld::seeded();
        let events = vec![EventView {
            seq: 70_001,
            type_name: "ledger.banked".to_string(),
            success: true,
            actor_id: Some(5000),
            ..EventView::default()
        }];

        advance_actor_room_turn_after_commit(&state, &runtime, None, 5000, CW_OK, &events);
        advance_actor_room_turn_after_commit(&state, &runtime, None, 5000, CW_OK, &events);

        let conn = open_event_store(&path).expect("open post-commit activation store");
        for event_kind in [
            "first_turn_committed",
            "first_ledger_banked",
            "first_growth_settled",
        ] {
            let count: i64 = conn
                .query_row(
                    "SELECT COUNT(*) FROM activation_events WHERE actor_id = ?1 AND event_kind = ?2",
                    params![5000_i64, event_kind],
                    |row| row.get(0),
                )
                .expect("count post-commit activation rows");
            assert_eq!(count, 1, "{event_kind} must be idempotent");
        }

        drop(conn);
        let _ = fs::remove_file(path);
    }

    #[test]
    fn focused_journal_context_defaults_historical_combat_and_fails_closed() {
        let mut runtime = RuntimeWorld::seeded();
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
        assert!(focused_encounter_journal_context_is_supported(
            &runtime, &record
        ));

        let mut historical_json = serde_json::to_value(&record).expect("journal row serializes");
        historical_json["version"] = serde_json::json!(7);
        historical_json
            .as_object_mut()
            .expect("journal row object")
            .remove("focused_encounter");
        let historical: JournalRecord =
            serde_json::from_value(historical_json).expect("historical combat row defaults");
        assert!(focused_encounter_journal_context_is_supported(
            &runtime,
            &historical
        ));

        let mut missing_context = historical;
        missing_context.version = FOCUSED_ENCOUNTER_JOURNAL_VERSION;
        assert!(!focused_encounter_journal_context_is_supported(
            &runtime,
            &missing_context
        ));

        let mut incompatible = record;
        incompatible
            .focused_encounter
            .as_mut()
            .expect("focused context")
            .profile_version += 1;
        let before = RuntimeSnapshot::from_runtime(&runtime);
        assert_eq!(runtime.apply_journal_record(&incompatible).0, CW_ERR_RULE);
        assert_eq!(
            serde_json::to_value(RuntimeSnapshot::from_runtime(&runtime)).unwrap(),
            serde_json::to_value(before).unwrap()
        );
    }
}
