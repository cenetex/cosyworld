//! Shared vocabulary for the spine: actions, events, mutations, envelopes.
//!
//! Everything in this file is data. The pipeline, world loop, and storage
//! layers exchange only these types, which is what keeps the commit path
//! replayable: a journal record is an `Action` + seed + `ProjectionMutation`s,
//! and replay is a pure function of the journal.

use serde::{Deserialize, Serialize};

/// Closed action vocabulary. Turn taxonomy is declared on the kind, mirroring
/// ENG.md invariant 7: new verbs must declare turn-consuming or turn-exempt.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum ActionKind {
    /// Turn-exempt speech (like `say` in the live orchestrator).
    Say {
        text: String,
    },
    Move {
        destination: u64,
    },
    PickUp {
        item: u64,
    },
    Drop {
        item: u64,
    },
    /// Deterministic seeded check; exercises seed fidelity across replay.
    Search,
    /// Commits the turn and rotates the room; never a free redeal.
    Pass,
}

impl ActionKind {
    pub fn is_turn_consuming(&self) -> bool {
        !matches!(self, ActionKind::Say { .. })
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Action {
    pub actor_id: u64,
    #[serde(flatten)]
    pub kind: ActionKind,
}

/// Kernel rejection codes mirror `CW_ERR_*` in `cosy_kernel.h`.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum KernelStatus {
    Ok,
    Invalid,
    Full,
    NotFound,
    Rule,
}

impl KernelStatus {
    pub fn is_ok(self) -> bool {
        matches!(self, KernelStatus::Ok)
    }
}

/// An event as emitted by the kernel, before sequencing.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct KernelEvent {
    pub kind: String,
    pub actor_id: u64,
    pub location_id: u64,
    #[serde(default)]
    pub content: serde_json::Value,
}

/// A public, sequenced world event. This is the SSE/broadcast contract.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct WorldEvent {
    pub seq: u64,
    pub journal_seq: u64,
    pub tick: u64,
    pub kind: String,
    pub actor_id: u64,
    pub location_id: u64,
    #[serde(default)]
    pub content: serde_json::Value,
}

/// A declared, journaled change to Rust-owned projection state. The live
/// system's key idea, kept intact: projection state changes are data recorded
/// alongside the kernel action, never ad-hoc writes inside handlers.
///
/// `claim_key` makes the mutation idempotent (ENG.md invariant 5): a mutation
/// whose key was already claimed is a silent no-op at apply time, so retries
/// never double-mint or double-spend.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct ProjectionMutation {
    /// Registry id of the owning projection, e.g. "ledger".
    pub projection: String,
    pub op: String,
    #[serde(default)]
    pub payload: serde_json::Value,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub claim_key: Option<String>,
}

/// Authorization verdict produced at the edge by the session service and
/// carried with the envelope. The pipeline re-validates binding and
/// suspension; it never trusts client-supplied identity fields.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct AuthContext {
    pub actor_id: u64,
    pub session_verified: bool,
    pub suspended: bool,
}

/// Room-turn context supplied by the edge for turn-consuming actions.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct TurnContext {
    pub room_id: u64,
}

/// Work that must happen after commit, outside the world lock: resident
/// observations, AI jobs, media jobs. The pipeline returns these; the world
/// loop schedules them. Inference never runs inside commit.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum PostCommitIntent {
    /// Queue a resident-observation job for a room after a committed action.
    ScheduleObservation { room_id: u64, triggering_seq: u64 },
}

/// One unit of world mutation. Replaces the `apply_and_broadcast_*` wrapper
/// family: hosted-access grants, projection mutations, and post-commit work
/// are fields, not function-name suffixes.
#[derive(Clone, Debug)]
pub struct CommitEnvelope {
    pub action: Action,
    pub auth: AuthContext,
    pub turn: Option<TurnContext>,
    pub mutations: Vec<ProjectionMutation>,
    pub intents: Vec<PostCommitIntent>,
}

impl CommitEnvelope {
    pub fn new(action: Action, auth: AuthContext) -> Self {
        Self {
            action,
            auth,
            turn: None,
            mutations: Vec::new(),
            intents: Vec::new(),
        }
    }
}

/// Why a commit was rejected before any state changed. Rejections leave no
/// journal record and emit no events.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Rejection {
    /// Missing, mismatched, or suspended identity.
    Auth,
    /// Not this actor's turn in this room.
    NotYourTurn { room_id: u64 },
    /// A projection refused its mutation during preflight (e.g. spend
    /// exceeds balance, advance on a completed clock).
    Projection { projection: String, reason: String },
    /// The kernel rule layer rejected the action.
    Kernel { status: KernelStatus },
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum CommitOutcome {
    Committed {
        journal_seq: u64,
        events: Vec<WorldEvent>,
        intents: Vec<PostCommitIntent>,
    },
    Rejected(Rejection),
    /// Infrastructure failure (journal append). Distinct from rejection:
    /// the live system distinguishes 400-class from 500-class outcomes.
    Failed {
        reason: String,
    },
}

impl CommitOutcome {
    pub fn is_committed(&self) -> bool {
        matches!(self, CommitOutcome::Committed { .. })
    }
}
