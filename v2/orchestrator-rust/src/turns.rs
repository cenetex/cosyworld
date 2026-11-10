use serde::{Deserialize, Serialize};

use super::*;

#[derive(Clone, Debug, Default, Deserialize, Eq, PartialEq, Serialize)]
pub(super) struct RoomInitiativeState {
    pub(super) schema_version: u8,
    pub(super) participant_order: Vec<u64>,
    pub(super) current_index: usize,
    pub(super) round: u64,
    pub(super) activation: u64,
}

impl RoomInitiativeState {}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub(super) enum FocusedActivationStep {
    Control,
    Setup,
    Commit,
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

impl FocusedJobEncounterState {}

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
    #[serde(skip_serializing_if = "Option::is_none")]
    pub seat_expires_at_ms: Option<u64>,
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

impl RoomTurnView {}

impl RuntimeWorld {}
