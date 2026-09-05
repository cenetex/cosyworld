use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum ActionKind {
    Say { text: String },
    Move { destination: u64 },
    PickUp { item: u64 },
    Drop { item: u64 },
    Search,
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

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct KernelEvent {
    pub kind: String,
    pub actor_id: u64,
    pub location_id: u64,
    #[serde(default)]
    pub content: serde_json::Value,
}

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

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct ProjectionMutation {
    pub projection: String,
    pub op: String,
    #[serde(default)]
    pub payload: serde_json::Value,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub claim_key: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct AuthContext {
    pub actor_id: u64,
    pub session_verified: bool,
    pub suspended: bool,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct TurnContext {
    pub room_id: u64,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum PostCommitIntent {
    ScheduleObservation { room_id: u64, triggering_seq: u64 },
}

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

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Rejection {
    Auth,
    NotYourTurn { room_id: u64 },
    Projection { projection: String, reason: String },
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
    Failed {
        reason: String,
    },
}

impl CommitOutcome {
    pub fn is_committed(&self) -> bool {
        matches!(self, CommitOutcome::Committed { .. })
    }
}
