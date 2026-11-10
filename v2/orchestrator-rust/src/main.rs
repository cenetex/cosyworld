// The hosted server boots card-only. The classic world modules that the card
// path never reaches are being deleted in slices (#1652); what remains is kept
// alive only by the inert classic fields of `AppState` and `RuntimeWorld`.
#![allow(dead_code)]
mod account_auth;
mod account_avatars;
mod activation;
mod actor_interaction_profiles;
mod actor_practice;
mod actor_presence;
mod actor_rules_facets;
mod ai_bench;
mod ai_context;
mod ai_gateway;
mod ai_publication;
mod ai_readiness;
mod ai_resident_planning;
mod ai_voice_routing;
mod authoring_draft;
mod avatar_autonomy;
mod avatar_rescue;
mod card_authoring;
mod card_boot;
mod card_shared;
// The closed-vocabulary Calling Forge and event-derived Bond scripting.
// Its candidate/proposal entry points power the client surface in a follow-up;
// `is_calling_forge_statement` is wired into the authoritative calling path.
#[allow(dead_code)]
mod calling_forge;
mod canonical_journal;
mod canonical_world;
mod card_policy_objective;
mod cards;
mod communal_governance;
mod community_art;
mod composition;
mod config;
mod content_load;
mod content_policy;
mod content_registry;
mod crafting;
mod daily_journal;
mod discovery_pipeline;
mod entity_context;
mod entity_levels;
mod first_tale;
mod generated_asset_budget;
mod generated_places;
mod generation_policy;
mod hosted_access;
mod item_identity;
mod jobs;
mod kernel;
mod keys;
mod legacy_import;
mod local_leads;
mod materialization_retirement;
mod room_history;
// The legacy canary evaluator remains readable for frozen-job compatibility
// and audit tests, while live evolution now always preserves its parent image.
mod ai_decisions;
mod free_context;
#[allow(dead_code)]
mod media_evolution;
mod media_jobs;
mod media_recipes;
mod model_interaction;
mod moderation;
mod movement;
mod mud;
mod natural_affordances;
mod ownership;
mod projection;
mod projection_cache;
mod projection_character;
mod projection_items;
mod projection_ledger;
mod proxim8;
mod quest_loot;
mod rate_limit;
mod relationships;
mod residents;
mod rest;
mod room_memory;
mod routes;
mod rpg;
mod rules_context;
mod settlement_buildings;
mod shutdown;
mod snapshot_persistence;
mod solana;
mod spatial;
mod startup;
mod story_metrics;
#[cfg(test)]
mod test_support;
mod topology;
mod turns;
mod util;
mod views;
mod voice_pool;
mod world_causality;
mod world_events;
mod world_simulation;
use account_auth::*;
use activation::*;
use actor_practice::*;
use actor_rules_facets::*;
use ai_context::*;
use ai_gateway::*;
use ai_publication::*;
use ai_readiness::*;
use ai_resident_planning::*;
use avatar_rescue::*;
use axum::{
    body::{to_bytes, Body},
    extract::{ConnectInfo, State},
    http::{header, HeaderMap, HeaderName, StatusCode},
    response::{IntoResponse, Response},
    Json,
};
use canonical_journal::*;
use canonical_world::*;
use card_policy_objective::*;
use cards::*;
use communal_governance::*;
use community_art::*;
use composition::*;
pub(crate) use config::{
    deployment_config_error, CanonicalRecoveryConfig, CanonicalRoutingConfig, DeploymentConfig,
    RegionalPresence, DEFAULT_CANONICAL_LEASE_TTL,
};
use content_load::*;
use content_policy::*;
use content_registry::*;
use crafting::*;
use daily_journal::*;
use discovery_pipeline::*;
use entity_context::*;
use entity_levels::*;
use first_tale::*;
use generated_places::*;
use generation_policy::*;
use hosted_access::*;
use item_identity::*;
use jobs::*;
use kernel::*;
use legacy_import::*;
use local_leads::*;
use media_evolution::*;
use media_jobs::*;
use media_recipes::*;
use model_interaction::*;
use moderation::*;
use movement::*;
use mud::*;
use natural_affordances::*;
use ownership::*;
use projection_cache::*;
use quest_loot::*;
use rate_limit::*;
use relationships::*;
use residents::*;
use rest::*;
use room_memory::*;
use rpg::*;
use rules_context::*;
use rusqlite::{params, Connection, OptionalExtension};
use serde::{de::DeserializeOwned, Deserialize, Serialize};
pub(crate) use solana::*;
use {settlement_buildings::*, snapshot_persistence::*, spatial::*};

#[cfg(test)]
pub(crate) use config::DEFAULT_CANONICAL_REGION_ID;
use keys::*;
use shutdown::*;
use std::{
    cmp::Reverse,
    collections::{BTreeMap, BTreeSet},
    fs, io,
    net::SocketAddr,
    path::{Path, PathBuf},
    sync::{atomic::AtomicU64, Arc, Mutex as StdMutex, OnceLock},
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};
use story_metrics::*;
#[cfg(test)]
use test_support::*;
use tokio::{
    net::TcpListener,
    sync::{broadcast, Mutex, Notify, RwLock},
};
use topology::*;
use tracing::{error, info, warn};
use turns::*;
pub(crate) use util::*;
use views::*;
use world_causality::*;
use world_simulation::*;

#[derive(Clone)]
struct AppState {
    inner: Arc<Mutex<RuntimeWorld>>,
    projection_cache: Arc<ProjectionCache>,
    tx: broadcast::Sender<EventView>,
    deployment: DeploymentConfig,
    snapshot_path: Option<Arc<PathBuf>>,
    /// Wall-clock millis of the last scheduled snapshot. Zero means never.
    last_snapshot_at_ms: Arc<AtomicU64>,
    resident_continuity_path: Option<Arc<PathBuf>>,
    snapshot_writer: Option<Arc<SnapshotWriter>>,
    event_store_path: Option<Arc<PathBuf>>,
    event_store_writer: Option<Arc<StdMutex<Connection>>>,
    event_store_health: Arc<StdMutex<EventStoreHealth>>,
    account_auth: Arc<AccountAuth>,
    ownership_index: Arc<RwLock<OwnershipIndex>>,
    trust_client_card_ids: bool,
    dev_reset_enabled: bool,
    card_policy: Option<Arc<CardPolicyRollout>>,
    ai_config: Arc<Option<AiConfig>>,
    generation_controls: Arc<GenerationControls>,
    avatar_art_config: Arc<Option<ReplicateAvatarArtConfig>>,
    generated_asset_dir: Arc<PathBuf>,
    ownership_feed: Arc<OwnershipFeedConfig>,
    rendezvous_party_config: Arc<RendezvousPartyConfig>,
    wallet_sessions: Arc<StdMutex<WalletSessions>>,
    qr_wallet_logins: Arc<StdMutex<QrWalletLogins>>,
    wallet_actor_links: Arc<StdMutex<BTreeMap<String, u64>>>,
    avatar_creation_lock: Arc<Mutex<()>>,
    actor_sessions: Arc<StdMutex<ActorSessions>>,
    actor_suspensions: Arc<StdMutex<BTreeMap<u64, ActorSuspension>>>,
    rate_limiter: Arc<StdMutex<RateLimiter>>,
    transient_openrouter_keys: Arc<StdMutex<BTreeMap<u64, TransientOpenRouterKey>>>,
    inactive_inventory_release_conflicts: Arc<StdMutex<BTreeSet<(u64, u64)>>>,
    canonical_command_lock: Arc<Mutex<()>>,
    canonical_owner_id: Arc<String>,
    canonical_store_id: Arc<String>,
    canonical_region_id: Arc<String>,
    canonical_lease_ttl: Duration,
    canonical_applied_journal_seq: Arc<AtomicU64>,
    canonical_fanout_seq: Arc<AtomicU64>,
    canonical_fanout_lock: Arc<StdMutex<()>>,
    canonical_routing: Arc<CanonicalRoutingConfig>,
    canonical_recovery: Arc<Option<CanonicalRecoveryConfig>>,
    regional_presence: Arc<StdMutex<BTreeMap<u64, RegionalPresence>>>,
    room_memory_cache: Arc<StdMutex<BTreeMap<u64, RoomMemoryCacheEntry>>>,
    room_memory_jobs: Arc<StdMutex<BTreeSet<(u64, u64, u64)>>>,
    room_memory_retries: Arc<StdMutex<RoomMemoryRetries>>,
    room_chat_heartbeats: Arc<StdMutex<BTreeSet<u64>>>,
    actor_job_notify: Arc<Notify>,
    actor_job_generation: Arc<AtomicU64>,
    avatar_chat_delay: Duration,
    moderation_token: Option<Arc<String>>,
    moderation_report_retention: ModerationReportRetention,
    story_metrics_retention: StoryMetricsRetention,
    command_receipt_retention: CommandReceiptRetention,
    checkpoint_rejections: u64,
    last_checkpoint_rejection: Option<String>,
    allow_unsigned_wallet_claims: bool,
}

#[derive(Clone, Debug, Default)]
struct EventStoreHealth {
    last_append_success_at_unix: Option<u64>,
    last_read_success_at_unix: Option<u64>,
    last_failure_at_unix: Option<u64>,
    consecutive_append_failures: u32,
    consecutive_read_failures: u32,
    last_error_code: Option<String>,
    pending_events: BTreeMap<u64, EventView>,
}

impl EventStoreHealth {
    fn status(&self, configured: bool) -> &'static str {
        if !configured {
            "disabled"
        } else if self.consecutive_append_failures > 0
            || self.consecutive_read_failures > 0
            || !self.pending_events.is_empty()
        {
            "degraded"
        } else if self.last_append_success_at_unix.is_some()
            || self.last_read_success_at_unix.is_some()
        {
            "healthy"
        } else {
            "pending"
        }
    }

    fn record_append_success(&mut self) {
        self.last_append_success_at_unix = Some(now_unix_secs());
        self.consecutive_append_failures = 0;
        self.refresh_error_code();
    }

    fn refresh_error_code(&mut self) {
        if self.consecutive_append_failures == 0 && self.consecutive_read_failures == 0 {
            self.last_error_code = None;
        }
    }
}

#[derive(Clone, Debug)]
struct RoomMemoryCacheEntry {
    day_index: u64,
    latest_seq: u64,
    summary: String,
    source: String,
    prior_chapters: Vec<RoomMemoryChapter>,
}

#[derive(Clone, Debug)]
struct RoomMemoryChapter {
    day_index: u64,
    latest_seq: u64,
    summary: String,
    source: String,
}

#[derive(Clone, Copy)]
struct FeatureBondTarget {
    location_id: u64,
    feature_key: &'static str,
    item_id: u64,
    target_actor_id: u64,
    reason: &'static str,
}

const LISTEN_DC: u16 = 12;
const ZONE_SANCTUARY: &str = "sanctuary";
const ZONE_FRONTIER: &str = "frontier";
const COSY_COTTAGE_LOCATION_ID: u64 = 1;
const RAIN_SOFT_GARDEN_LOCATION_ID: u64 = 2;
const RATI_ACTOR_ID: u64 = 1001;
const WHISKERWIND_ACTOR_ID: u64 = 1002;
const SKULL_ACTOR_ID: u64 = 1003;
const DEWBRIGHT_BUTTON_ITEM_ID: u64 = 2002;
const STORY_BUTTON_ITEM_ID: u64 = 2005;
const WATCH_BELL_ITEM_ID: u64 = 2007;
const BELIEF_KIND_ITEM_LOCATION: &str = "item_location";
const BELIEF_KIND_ACTOR_LOCATION: &str = "actor_location";

#[derive(Clone, Copy)]
struct BeliefTuning {
    capacity: usize,
    firsthand_confidence: u8,
    firsthand_salience: u8,
    minimum_action_confidence: u8,
    decay_interval_ticks: u64,
    confidence_decay: u8,
    salience_decay: u8,
    gossip_confidence_decay: u8,
    gossip_salience_decay: u8,
}

// The former stores agreed on confidence, threshold, and decay amounts. The
// unified policy keeps search's slightly stronger initial salience while using
// resident autonomy's shorter decay interval so stale beliefs stop driving
// actions promptly.
const BELIEF_TUNING: BeliefTuning = BeliefTuning {
    capacity: 32,
    firsthand_confidence: 240,
    firsthand_salience: 220,
    minimum_action_confidence: 80,
    decay_interval_ticks: 12,
    confidence_decay: 6,
    salience_decay: 8,
    gossip_confidence_decay: 28,
    gossip_salience_decay: 18,
};
const LOW_DOORWAY_FEATURE_KEY: &str = "low_doorway";
const SCARF_BASKET_FEATURE_KEY: &str = "scarf_basket";
const BROAD_LEAVES_FEATURE_KEY: &str = "broad_leaves";
const MOONLIT_TRAIL_LOCATION_ID: u64 = 3;
const FEATURE_BOND_TARGETS: &[FeatureBondTarget] = &[
    FeatureBondTarget {
        location_id: COSY_COTTAGE_LOCATION_ID,
        feature_key: LOW_DOORWAY_FEATURE_KEY,
        item_id: WATCH_BELL_ITEM_ID,
        target_actor_id: SKULL_ACTOR_ID,
        reason: "watch_bell_threshold",
    },
    FeatureBondTarget {
        location_id: COSY_COTTAGE_LOCATION_ID,
        feature_key: SCARF_BASKET_FEATURE_KEY,
        item_id: STORY_BUTTON_ITEM_ID,
        target_actor_id: RATI_ACTOR_ID,
        reason: "story_button_scarf",
    },
    FeatureBondTarget {
        location_id: RAIN_SOFT_GARDEN_LOCATION_ID,
        feature_key: BROAD_LEAVES_FEATURE_KEY,
        item_id: DEWBRIGHT_BUTTON_ITEM_ID,
        target_actor_id: WHISKERWIND_ACTOR_ID,
        reason: "dewbright_leaf",
    },
];
const MOONLIT_PROGRESS_CLOCK_ID: &str = "moonlit-trail.progress";

#[derive(Clone, Debug, Deserialize, Serialize)]
struct ActorMeta {
    name: String,
    speech_mode: String,
    #[serde(default)]
    title: String,
    #[serde(default)]
    description: String,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
struct LocationMeta {
    title: String,
    description: String,
    persona: String,
    #[serde(default)]
    memory: Vec<String>,
    #[serde(default)]
    biome: String,
    #[serde(default)]
    terrain: Vec<String>,
    #[serde(default)]
    environment: EnvironmentProfile,
    #[serde(default)]
    natural_potentials: Vec<NaturalPotentialRule>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    interior_view: Option<InteriorViewMode>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    image_url: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    art_prompt: Option<String>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
struct GeneratedWaypointState {
    id: u64,
    #[serde(default)]
    canonical_id: String,
    name: String,
    meta: LocationMeta,
    #[serde(default)]
    generation_policy: GeneratedPolicyBinding,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
struct GeneratedPathwayState {
    id: String,
    #[serde(default)]
    identity_version: u8,
    #[serde(default)]
    canonical_id: String,
    #[serde(default)]
    source_route_id: String,
    #[serde(default)]
    source_route_version: u64,
    #[serde(default)]
    owner_pack_id: String,
    #[serde(default)]
    owner_pack_version: String,
    #[serde(default)]
    generation_policy: GeneratedPolicyBinding,
    origin_location_id: u64,
    destination_location_id: u64,
    distance: u8,
    created_by_actor_id: u64,
    #[serde(default)]
    way_class: PathwayWayClass,
    #[serde(default)]
    traffic_count: u64,
    waypoints: Vec<GeneratedWaypointState>,
    #[serde(default)]
    generation: GenerationProvenance,
    #[serde(default)]
    revealed_edges: BTreeSet<String>,
    #[serde(default)]
    art_eligible: bool,
    #[serde(default)]
    familiar: bool,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
struct JourneyState {
    actor_id: u64,
    pathway_id: String,
    origin_location_id: u64,
    destination_location_id: u64,
    destination_name: String,
    path: Vec<u64>,
    current_step: usize,
    explorer: bool,
}

const JOB_CONTRIBUTION_SCHEMA_VERSION: u8 = 1;
const CLOCK_PRESENTATION_SCHEMA_VERSION: u8 = 1;

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
struct ContributionTargetDescriptor {
    kind: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    predicate: Option<String>,
    label: String,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
enum ContributionRequirement {
    AtLocation {
        location_id: u64,
    },
    HeldItem {
        item_id: u64,
    },
    ActiveTag {
        tag_id: String,
    },
    RoomFeature {
        location_id: u64,
        feature_key: String,
    },
    FeatureSearched {
        location_id: u64,
        feature_key: String,
    },
    FeatureUsed {
        location_id: u64,
        feature_key: String,
        item_id: u64,
    },
    EncounterResolved {
        job_id: String,
        winning_side: i16,
    },
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
enum ContributionResolutionPolicy {
    Certain,
    SrdCheck { ability: String, dc: u16 },
    ExistingKernelOutcome { event_type: String },
}

#[derive(Clone, Copy, Debug, Default, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
enum ContributionClaimPolicy {
    #[default]
    Repeatable,
    OncePerActor,
    OncePerTarget,
    OncePerActorTarget,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
struct JobContributionStrategy {
    version: u8,
    id: String,
    action_kind: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    rules_action: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    operation: Option<String>,
    target: ContributionTargetDescriptor,
    #[serde(default)]
    requirements: Vec<ContributionRequirement>,
    resolution: ContributionResolutionPolicy,
    clock_id: String,
    baseline_progress: u8,
    #[serde(default)]
    success_progress: u8,
    #[serde(default)]
    prepared_bonus_progress: u8,
    #[serde(default)]
    on_success: Vec<EffectDescriptor>,
    #[serde(default)]
    on_failure: Vec<EffectDescriptor>,
    #[serde(default)]
    claim_policy: ContributionClaimPolicy,
    strategy_label: String,
    narration_key: String,
    rules_profile: String,
    rules_pack_id: String,
    rules_pack_version: String,
    pack_id: String,
    pack_version: String,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
struct JobNarratedThreshold {
    clock_id: String,
    filled: u8,
    narration_key: String,
    text: String,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
struct ResolvedContributionTarget {
    kind: String,
    id: String,
    label: String,
}

#[derive(Clone, Debug, Default, Deserialize, Eq, PartialEq, Serialize)]
struct ClockPresentation {
    #[serde(default)]
    version: u8,
    #[serde(default)]
    question: String,
    #[serde(default)]
    rhythm: String,
    #[serde(default)]
    attention: String,
    #[serde(default)]
    priority: i16,
    #[serde(default)]
    situation: String,
    #[serde(default)]
    stakes: String,
    #[serde(default)]
    outcome: String,
    #[serde(default)]
    completion_memory: String,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
struct ClockContributionMemory {
    actor_id: u64,
    strategy_id: String,
    strategy_label: String,
    target_label: String,
    progress: u8,
    contribution_event_seq: u64,
    clock_event_seq: u64,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
struct ClockCompletionMemory {
    actor_id: u64,
    event_seq: u64,
    text: String,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
struct ClockState {
    id: String,
    scope: String,
    scope_id: u64,
    kind: String,
    #[serde(default = "default_zone")]
    zone: String,
    label: String,
    segments: u8,
    filled: u8,
    visible_to_players: bool,
    #[serde(default)]
    status: String,
    #[serde(default)]
    presentation: ClockPresentation,
    #[serde(default)]
    on_fill: Vec<EffectDescriptor>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    recent_contributions: Vec<ClockContributionMemory>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    completion: Option<ClockCompletionMemory>,
    #[serde(default)]
    created_event_seq: Option<u64>,
    #[serde(default)]
    updated_event_seq: Option<u64>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
struct RpgTagState {
    id: String,
    scope: String,
    scope_id: u64,
    label: String,
    kind: String,
    #[serde(default)]
    active: bool,
    #[serde(default)]
    source_event_seq: Option<u64>,
    #[serde(default)]
    expires: Option<String>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
struct RoomSheetState {
    id: String,
    location_id: u64,
    name: String,
    safety: String,
    #[serde(default = "default_zone")]
    zone: String,
    aspects: Vec<String>,
    boons: Vec<String>,
    hooks: Vec<String>,
    resources: BTreeMap<String, i16>,
    projects: Vec<String>,
    #[serde(default)]
    season_clock_id: Option<String>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
struct CallingState {
    actor_id: u64,
    statement: String,
    #[serde(default)]
    source_event_seq: Option<u64>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
struct AvatarIdentityState {
    actor_id: u64,
    profile_id: String,
    species_id: String,
    origin_id: String,
    #[serde(default)]
    physical_description: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    class_id: Option<String>,
    #[serde(default)]
    class_selection_ready: bool,
    #[serde(default)]
    qualifying_world_actions: u8,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    class_source_event_seq: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    class_readiness_evidence: Option<ClassReadinessEvidence>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
struct ClassReadinessEvidence {
    offer_kind: String,
    strategy_label: String,
    target: ResolvedContributionTarget,
    outcome: String,
    #[serde(default, skip_serializing_if = "String::is_empty")]
    summary: String,
    #[serde(default)]
    progress: u8,
    source_event_seq: u64,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
struct SkillState {
    actor_id: u64,
    skill_id: String,
    label: String,
    rank: u8,
    #[serde(default)]
    updated_event_seq: Option<u64>,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
struct NpcCooperationState {
    actor_id: u64,
    target_actor_id: u64,
    desired_cooperation: String,
    attitude: String,
    outcome: String,
    attempts: u32,
    source_event_seq: u64,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
struct ItemProvenanceState {
    item_id: u64,
    origin: String,
    acquisition: String,
    previous_holder_actor_id: Option<u64>,
    current_holder_actor_id: Option<u64>,
    current_location_id: Option<u64>,
    transfer_count: u32,
    source_event_seq: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    possession_journey: Option<PossessionJourneyState>,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
struct MaterializationReceiptState {
    id: String,
    actor_id: u64,
    card_id: String,
    item_id: u64,
    status: String,
    source_wallet: Option<String>,
    source_event_seq: u64,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
struct VisitLedgerMarkState {
    id: String,
    actor_id: u64,
    category: String,
    label: String,
    source_event_seq: u64,
    #[serde(default)]
    banked: bool,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
struct AdvancementSpendState {
    id: String,
    actor_id: u64,
    kind: String,
    label: String,
    cost: u8,
    source_event_seq: u64,
}

#[derive(Clone, Copy, Debug, Default, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
enum ActorControlMode {
    #[default]
    #[serde(alias = "human")]
    DirectInput,
    ReactiveAi,
    LocalAi,
    RoamingAi,
    DelegatedAi,
}

impl ActorControlMode {}

const ACCEPT_TRANSFER_OFFER_KIND: &str = "accept_transfer";

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
enum TransferOfferKind {
    Gift,
    Trade,
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
enum TransferOfferStatus {
    Pending,
    Accepted,
    Declined,
    Withdrawn,
    Expired,
    Invalidated,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
struct TransferOfferState {
    id: String,
    kind: TransferOfferKind,
    offered_by_actor_id: u64,
    offered_to_actor_id: u64,
    offered_item_id: u64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    requested_item_id: Option<u64>,
    created_tick: u64,
    expires_tick: u64,
    status: TransferOfferStatus,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    resolved_by_actor_id: Option<u64>,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
struct GiftAutoAcceptPolicy {
    id: String,
    recipient_actor_id: u64,
    offered_by_actor_id: u64,
    item_id: u64,
    created_tick: u64,
    expires_tick: u64,
    consumed: bool,
}

#[derive(Clone, Debug, Default, Deserialize, Serialize, PartialEq, Eq)]
struct ActorSafetyState {
    #[serde(default)]
    muted_actor_ids: BTreeSet<u64>,
    #[serde(default)]
    blocked_actor_ids: BTreeSet<u64>,
}

#[derive(Clone, Debug, Default, Deserialize, Serialize)]
struct ActorAutonomyState {
    control_mode: ActorControlMode,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    owner_delegation: Option<avatar_autonomy::OwnerDelegation>,
    #[serde(default)]
    current_desires: Vec<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pending_intent: Option<String>,
    #[serde(default)]
    last_observed_tick: u64,
    #[serde(default)]
    last_acted_tick: u64,
    #[serde(default)]
    last_acted_event_seq: u64,
    #[serde(default)]
    attention_credits: u8,
}

#[derive(Clone, Debug, Default, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct AvatarProposedAction {
    kind: String,
    #[serde(default)]
    target_actor_id: Option<u64>,
    #[serde(default)]
    item_id: Option<u64>,
    #[serde(default)]
    target_item_id: Option<u64>,
    #[serde(default)]
    destination_location_id: Option<u64>,
    #[serde(default)]
    candidate_id: Option<String>,
    #[serde(default)]
    composition_id: Option<String>,
    #[serde(default)]
    state_revision: Option<u64>,
    #[serde(default)]
    planning_generation_id: Option<String>,
    #[serde(default)]
    speech_act: Option<ResidentSpeechAct>,
    #[serde(default)]
    reason: Option<String>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
struct ItemMeta {
    name: String,
    description: String,
    #[serde(default)]
    skill_id: Option<String>,
    #[serde(default)]
    skill_bonus: i8,
    #[serde(default)]
    mechanics: Option<SeedPlayableItemMechanics>,
}

#[derive(Clone, Debug)]
enum SearchRevealCandidate {
    SeedExit {
        from_location_id: u64,
        to_location_id: u64,
    },
    HiddenExit {
        hidden_exit_id: String,
    },
    Avatar {
        actor_id: u64,
        location_id: u64,
    },
    Item {
        item_id: u64,
    },
}

#[derive(Clone, Debug)]
struct RuntimeWorld {
    // Boxed so `RuntimeWorld` stays small enough to move cheaply. The kernel
    // world is a flat 285 KB struct; keeping it inline put several copies in
    // the bootstrap match and its async state machine, which overflowed the
    // main thread stack in unoptimized builds.
    world: Box<CwWorld>,
    canonical_identities: CanonicalIdentityState,
    command_receipts: CommandReceiptCache,
    ai_publications: BTreeMap<String, AiPublicationReceipt>,
    actors: BTreeMap<u64, ActorMeta>,
    items: BTreeMap<u64, ItemMeta>,
    locations: BTreeMap<u64, String>,
    location_meta: BTreeMap<u64, LocationMeta>,
    content: BTreeMap<u64, String>,
    branches: BTreeMap<u64, DialogueBranch>,
    clocks: BTreeMap<String, ClockState>,
    tags: BTreeMap<String, RpgTagState>,
    jobs: BTreeMap<String, JobState>,
    room_sheets: BTreeMap<u64, RoomSheetState>,
    routes: BTreeMap<String, RouteRecordState>,
    threshold_gate_sources: BTreeMap<u64, ThresholdGateSource>,
    threshold_hazard_states: BTreeMap<String, ThresholdHazardRuntimeState>,
    discovery_sources: BTreeMap<String, DiscoveryRuntimeSource>,
    discovery_claims: BTreeMap<String, DiscoveryClaimState>,
    generated_pathways: BTreeMap<String, GeneratedPathwayState>,
    generated_places: BTreeMap<u64, GeneratedPlaceState>,
    governance_decisions: BTreeMap<String, GovernanceDecisionState>,
    settlement_buildings: BTreeMap<String, SettlementBuildingState>,
    building_footprint_claims: BTreeMap<String, BuildingFootprintClaimState>,
    loot_allocations: BTreeMap<String, LootAllocationState>,
    item_identity_reveals: BTreeMap<u64, ItemIdentityRevealState>,
    natural_affordances: BTreeMap<u64, NaturalAffordanceState>,
    community_art_generations: BTreeMap<String, CommunityArtGenerationState>,
    journeys: BTreeMap<u64, JourneyState>,
    avatar_rescue_predecessors: BTreeMap<u64, u64>,
    character_identities: BTreeMap<u64, AvatarIdentityState>,
    callings: BTreeMap<u64, CallingState>,
    skills: BTreeMap<String, SkillState>,
    charm_slots: BTreeMap<u64, u8>,
    equipped_charms: BTreeMap<u64, BTreeSet<u64>>,
    prepared_spells: BTreeMap<u64, BTreeSet<u64>>,
    npc_cooperation: BTreeMap<String, NpcCooperationState>,
    local_leads: BTreeMap<String, LocalLeadState>,
    item_provenance: BTreeMap<u64, ItemProvenanceState>,
    materialization_receipts: BTreeMap<String, MaterializationReceiptState>,
    item_materialization_migrations:
        BTreeMap<String, materialization_retirement::ItemMaterializationMigrationReceipt>,
    craft_receipts: BTreeMap<String, CraftReceiptState>,
    ledger_marks: BTreeMap<String, VisitLedgerMarkState>,
    advancement_spends: BTreeMap<String, AdvancementSpendState>,
    bonds: BTreeMap<String, BondState>,
    beliefs: BTreeMap<String, BeliefState>,
    entity_memories: BTreeMap<String, WorldEntityMemoryState>,
    entity_levels: EntityLevelLedger,
    goal_ledger: BTreeMap<String, EntityGoalState>,
    resident_continuities: BTreeMap<u64, ResidentContinuityState>,
    avatar_rescues: BTreeMap<String, AvatarRescueState>,
    actor_autonomy: BTreeMap<u64, ActorAutonomyState>,
    actor_rules_facets: BTreeMap<u64, BTreeMap<String, ActorRulesFacetState>>,
    deeds: BTreeMap<String, DeedRecord>,
    deed_ids_by_actor: BTreeMap<u64, Vec<String>>,
    actor_practices: BTreeMap<u64, ActorPracticeState>,
    transfer_offers: BTreeMap<String, TransferOfferState>,
    gift_auto_accepts: BTreeMap<String, GiftAutoAcceptPolicy>,
    actor_safety: BTreeMap<u64, ActorSafetyState>,
    treasure_objectives: BTreeMap<String, TreasureObjectiveState>,
    card_policy_preferences: BTreeMap<u64, BTreeMap<String, i16>>,
    world_simulation: WorldSimulationState,
    /// Clocks filling right now; transient. See `apply_bounded_clock_fill`.
    clock_fill_cascade: Vec<String>,
    rpg_claims: BTreeSet<String>,
    orb_balances: BTreeMap<u64, i32>,
    orb_reward_claims: BTreeSet<String>,
    listen_attempt_claims: BTreeSet<String>,
    pack_mount_state: PackMountState,
    action_journal_seq: u64,
    // This is the authoritative per-actor hand rotation. The event log is a
    // bounded presentation projection and must never determine a certificate.
    hand_generations: BTreeMap<u64, u64>,
    story_hand_states: BTreeMap<u64, StoryHandActorState>,
    room_initiatives: BTreeMap<u64, RoomInitiativeState>,
    daily_journals: BTreeMap<u64, AvatarDailyJournalState>,
    presence_states: BTreeMap<u64, bool>,
    event_log: Vec<EventView>,
    recent_room_lines: BTreeMap<u64, Vec<EventView>>,
    next_actor_id: u64,
    next_content_id: u64,
    next_seed: u64,
}

#[derive(Debug, Deserialize, Serialize)]
struct RuntimeSnapshot {
    version: u32,
    #[serde(default)]
    worldpack_bundle_hash: String,
    #[serde(default, skip_serializing_if = "content_reference_context_is_empty")]
    content_context: ContentReferenceContext,
    #[serde(default)]
    rules_profile: String,
    #[serde(default)]
    active_rules_variants: Vec<String>,
    #[serde(default)]
    active_rules_extensions: Vec<String>,
    #[serde(default, skip_serializing_if = "PackMountState::is_empty")]
    pack_mount_state: PackMountState,
    #[serde(default)]
    action_journal_seq: u64,
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    hand_generations: BTreeMap<u64, u64>,
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    story_hand_states: BTreeMap<u64, StoryHandActorState>,
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    room_initiatives: BTreeMap<u64, RoomInitiativeState>,
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    daily_journals: BTreeMap<u64, AvatarDailyJournalState>,

    world_version: u32,
    tick: u64,
    next_event_seq: u64,
    #[serde(default)]
    canonical_identities: CanonicalIdentityState,
    /// Read for compatibility with snapshots written before receipts moved out
    /// of the checkpoint. Never written: receipts are recoverable from the
    /// durable `canonical_command_receipts` table and are not world state.
    #[serde(default, skip_serializing)]
    command_receipts: BTreeMap<String, StoredCommandResponse>,
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    ai_publications: BTreeMap<String, AiPublicationReceipt>,
    world_actors: Vec<CwActor>,
    world_items: Vec<CwItem>,
    world_locations: Vec<CwLocation>,
    #[serde(default)]
    world_exits: Vec<CwExit>,
    #[serde(default)]
    routes: BTreeMap<String, RouteRecordState>,
    #[serde(default)]
    threshold_authority: ThresholdKernelSnapshot,
    #[serde(default)]
    discovery_sources: BTreeMap<String, DiscoveryRuntimeSource>,
    #[serde(default)]
    discovery_claims: BTreeMap<String, DiscoveryClaimState>,
    #[serde(default)]
    world_evolution_tracks: Vec<CwEvolutionTrack>,
    #[serde(default)]
    world_combat_encounters: Vec<CwCombatEncounter>,
    actor_meta: BTreeMap<u64, ActorMeta>,
    item_meta: BTreeMap<u64, ItemMeta>,
    location_names: BTreeMap<u64, String>,
    #[serde(default)]
    location_meta: BTreeMap<u64, LocationMeta>,
    content: BTreeMap<u64, String>,
    #[serde(default)]
    branches: BTreeMap<u64, DialogueBranch>,
    #[serde(default)]
    clocks: BTreeMap<String, ClockState>,
    #[serde(default)]
    tags: BTreeMap<String, RpgTagState>,
    #[serde(default)]
    jobs: BTreeMap<String, JobState>,
    #[serde(default)]
    room_sheets: BTreeMap<u64, RoomSheetState>,
    #[serde(default)]
    generated_pathways: BTreeMap<String, GeneratedPathwayState>,
    #[serde(default)]
    generated_places: BTreeMap<u64, GeneratedPlaceState>,
    #[serde(default)]
    governance_decisions: BTreeMap<String, GovernanceDecisionState>,
    #[serde(default)]
    settlement_buildings: BTreeMap<String, SettlementBuildingState>,
    #[serde(default)]
    building_footprint_claims: BTreeMap<String, BuildingFootprintClaimState>,
    #[serde(default)]
    loot_allocations: BTreeMap<String, LootAllocationState>,
    #[serde(default)]
    item_identity_reveals: BTreeMap<u64, ItemIdentityRevealState>,
    #[serde(default)]
    natural_affordances: BTreeMap<u64, NaturalAffordanceState>,
    #[serde(default)]
    community_art_generations: BTreeMap<String, CommunityArtGenerationState>,
    #[serde(default)]
    journeys: BTreeMap<u64, JourneyState>,
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    avatar_rescue_predecessors: BTreeMap<u64, u64>,
    #[serde(default)]
    character_identities: BTreeMap<u64, AvatarIdentityState>,
    #[serde(default)]
    callings: BTreeMap<u64, CallingState>,
    #[serde(default)]
    skills: BTreeMap<String, SkillState>,
    #[serde(default)]
    charm_slots: BTreeMap<u64, u8>,
    #[serde(default)]
    equipped_charms: BTreeMap<u64, BTreeSet<u64>>,
    #[serde(default)]
    prepared_spells: BTreeMap<u64, BTreeSet<u64>>,
    #[serde(default)]
    npc_cooperation: BTreeMap<String, NpcCooperationState>,
    #[serde(default)]
    local_leads: BTreeMap<String, LocalLeadState>,
    #[serde(default)]
    item_provenance: BTreeMap<u64, ItemProvenanceState>,
    #[serde(default)]
    materialization_receipts: BTreeMap<String, MaterializationReceiptState>,
    #[serde(default)]
    item_materialization_migrations:
        BTreeMap<String, materialization_retirement::ItemMaterializationMigrationReceipt>,
    #[serde(default)]
    craft_receipts: BTreeMap<String, CraftReceiptState>,
    #[serde(default)]
    ledger_marks: BTreeMap<String, VisitLedgerMarkState>,
    #[serde(default)]
    advancement_spends: BTreeMap<String, AdvancementSpendState>,
    #[serde(default)]
    bonds: BTreeMap<String, BondState>,
    #[serde(default)]
    beliefs: BTreeMap<String, BeliefState>,
    #[serde(default)]
    entity_memories: BTreeMap<String, WorldEntityMemoryState>,
    #[serde(default)]
    entity_levels: EntityLevelLedger,
    #[serde(default)]
    goal_ledger: BTreeMap<String, EntityGoalState>,
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    resident_memories: BTreeMap<String, LegacyResidentMemoryState>,
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    search_memories: BTreeMap<String, LegacySearchMemoryState>,
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    resident_continuities: BTreeMap<u64, ResidentContinuityState>,
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    avatar_rescues: BTreeMap<String, AvatarRescueState>,
    #[serde(default)]
    actor_autonomy: BTreeMap<u64, ActorAutonomyState>,
    #[serde(default)]
    actor_rules_facets: BTreeMap<u64, BTreeMap<String, ActorRulesFacetState>>,
    #[serde(default)]
    deeds: BTreeMap<String, DeedRecord>,
    #[serde(default)]
    deed_ids_by_actor: BTreeMap<u64, Vec<String>>,
    #[serde(default)]
    actor_practices: BTreeMap<u64, ActorPracticeState>,
    #[serde(default)]
    transfer_offers: BTreeMap<String, TransferOfferState>,
    #[serde(default)]
    gift_auto_accepts: BTreeMap<String, GiftAutoAcceptPolicy>,
    #[serde(default)]
    actor_safety: BTreeMap<u64, ActorSafetyState>,
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    treasure_objectives: BTreeMap<String, TreasureObjectiveState>,
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    card_policy_preferences: BTreeMap<u64, BTreeMap<String, i16>>,
    #[serde(default)]
    world_simulation: WorldSimulationState,
    #[serde(default)]
    rpg_claims: BTreeSet<String>,
    #[serde(default)]
    orb_balances: BTreeMap<u64, i32>,
    #[serde(default)]
    orb_reward_claims: BTreeSet<String>,
    #[serde(default)]
    listen_attempt_claims: BTreeSet<String>,
    event_log: Vec<EventView>,
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    recent_room_lines: BTreeMap<u64, Vec<EventView>>,
    next_actor_id: u64,
    next_content_id: u64,
    next_seed: u64,
}

#[derive(Debug, Serialize)]
struct HealthResponse {
    ok: bool,
    service: &'static str,
    status: &'static str,
    #[serde(skip_serializing_if = "Option::is_none")]
    error: Option<String>,
}

#[derive(Debug, Serialize)]
struct MetaEventStoreHealth {
    status: &'static str,
    last_append_success_at_unix: Option<u64>,
    last_read_success_at_unix: Option<u64>,
    last_failure_at_unix: Option<u64>,
    consecutive_append_failures: u32,
    consecutive_read_failures: u32,
    pending_event_count: usize,
    last_error_code: Option<String>,
}

#[derive(Clone, Debug, Serialize)]
struct CharacterCreationProfileView {
    pack_id: String,
    schema_version: u32,
    id: String,
    name: String,
    description: String,
    entry_location_id: u64,
    entry_location_name: String,
    prompt: String,
    class_prompt: Option<String>,
    default_choice_id: String,
    choices: Vec<CharacterCreationChoiceView>,
    default_species_id: Option<String>,
    species: Vec<CharacterCreationIdentityCardView>,
    default_origin_id: Option<String>,
    origins: Vec<CharacterCreationIdentityCardView>,
}

#[derive(Clone, Debug, Serialize)]
struct CharacterCreationChoiceView {
    id: String,
    label: String,
    detail: String,
    calling: String,
    title: String,
    description: String,
    starting_skill_id: String,
    starting_skill_label: String,
    starting_ability: String,
    starting_bonus: i16,
    campaign_use: String,
}

#[derive(Clone, Debug, Serialize)]
struct CharacterCreationIdentityCardView {
    id: String,
    label: String,
    detail: String,
    title: String,
    description: String,
    visual_prompt: String,
    campaign_rule: String,
}

#[derive(Clone, Debug, Serialize)]
struct CharacterClassRecommendationView {
    class_id: String,
    class_label: String,
    explanation: String,
}

#[derive(Clone, Debug, Serialize)]
struct CharacterIdentityView {
    profile_id: String,
    species_id: String,
    species_label: String,
    origin_id: String,
    origin_label: String,
    class_id: Option<String>,
    class_label: Option<String>,
    class_selection_ready: bool,
    qualifying_world_actions: u8,
    class_readiness_evidence: Option<ClassReadinessEvidence>,
    class_recommendation: Option<CharacterClassRecommendationView>,
    level: u8,
}

#[allow(dead_code)]
#[derive(Clone, Debug)]
struct RoomMemoryView {
    location_id: u64,
    summary: String,
    latest: Option<RoomMemoryEntryView>,
    recent: Vec<RoomMemoryEntryView>,
    latest_seq: Option<u64>,
    source: String,
}

#[derive(Clone, Debug, Serialize)]
struct RoomMemoryEntryView {
    seq: u64,
    actor_id: Option<u64>,
    kind: String,
    label: String,
    text: String,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
struct DialogueBranch {
    id: u64,
    actor_id: u64,
    target_actor_id: u64,
    #[serde(default = "default_branch_expires_at_tick")]
    expires_at_tick: u64,
    prompt: String,
    options: Vec<DialogueOption>,
}

fn default_branch_expires_at_tick() -> u64 {
    u64::MAX
}

#[derive(Clone, Debug, Deserialize, Serialize)]
struct DialogueOption {
    id: String,
    label: String,
    content: String,
}

#[derive(Clone, Debug, Serialize)]
struct BranchView {
    id: u64,
    target_actor_id: u64,
    target_actor_name: String,
    expires_at_tick: u64,
    prompt: String,
    options: Vec<DialogueOptionView>,
}

#[derive(Clone, Debug, Serialize)]
struct DialogueOptionView {
    id: String,
    label: String,
}

#[derive(Clone, Debug, Serialize)]
struct PrimaryAction {
    kind: String,
    label: String,
    command: String,
    disabled: bool,
    options: Vec<ActionOption>,
}

#[derive(Clone, Debug, Serialize)]
struct ActionOption {
    kind: String,
    label: String,
    command: String,
}

#[derive(Clone, Debug)]
struct RankedActionOffer {
    id: String,
    offer_id: String,
    kind: String,
    intention: String,
    rules_action: Option<String>,
    operation: Option<String>,
    rules_profile: String,
    resolver: String,
    source_collectible: Option<ActionSourceCollectibleView>,
    pack_provenance: ActionPackProvenanceView,
    composition_trace: ActionCompositionTraceView,
    composition_id: String,
    state_revision: u64,
    route: Option<RouteOfferBinding>,
    threshold_method: Option<ThresholdMethodOfferView>,
    discovery: Option<DiscoveryOfferView>,

    category: String,
    verb: String,
    label: String,
    accessible_label: String,
    command: String,
    rank: u16,
    disabled: bool,
    disabled_reason: Option<String>,
    zone: String,
    source: String,
    provider: ActionProviderView,
    target: Option<ActionTargetView>,
    project: Option<ActionProjectView>,
    cost: Option<ActionCostView>,
    risk: Option<String>,
    effect: Option<String>,
    progress: Option<u8>,
    claim_key: Option<String>,
    reason: String,
    ranked_hand_eligible: bool,
}

/// Public semantics for an action card. These dimensions deliberately stay
/// separate: suit is navigation, verb is the exact action, source explains
/// why it is available, and provenance/rarity describe collectibility rather
/// than power.
#[derive(Clone, Debug, Serialize)]
struct ActionCardPresentationView {
    family: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    suit: Option<String>,
    verb: String,
    source: ActionCardSourceView,
    state: String,
    provenance: String,
    rarity: String,
    power: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    cost: Option<ActionCostView>,
    #[serde(skip_serializing_if = "Option::is_none")]
    risk: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    effect: Option<String>,
}

#[derive(Clone, Debug, Serialize)]
struct ActionCardSourceView {
    kind: String,
    id: String,
    label: String,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
struct ActionSourceCollectibleView {
    kind: String,
    instance_id: u64,
    card_id: String,
    pack_id: String,
}

#[derive(Clone, Debug, Serialize)]
struct ActionPackProvenanceView {
    pack_id: String,
    pack_version: String,
    rules_namespace: String,
}

#[derive(Clone, Debug, Serialize)]
struct ActionProjectView {
    id: String,
    verb: String,
    label: String,
    summary: String,
    progress_clock_id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    strategy_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    strategy_label: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    resolution: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    claim_key: Option<String>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq)]
struct ActionTargetView {
    kind: String,
    id: Option<u64>,
    label: Option<String>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
struct ActionCostView {
    orbs: i32,
    reason: String,
}

fn content_reference_context_is_empty(context: &ContentReferenceContext) -> bool {
    context.mapping_version == 0
        && context.references.is_empty()
        && context.active_rulesets.is_empty()
}

#[derive(Clone, Debug, Serialize)]
struct WoodenBoxReceiptView {
    box_asset_address: String,
    owner_wallet_address: String,
    status: String,
    burn_signature: String,
    verification_status: String,
    pack_id: String,
    created_at_ms: u64,
    updated_at_ms: u64,
}

#[derive(Clone, Debug)]
struct WalletChallenge {
    wallet_address: String,
    message: String,
    expires_at: Instant,
}

#[derive(Clone, Debug)]
struct WalletSession {
    wallet_address: String,
    linked_wallet_addresses: Vec<String>,
    expires_at: Instant,
}

#[derive(Debug, Default)]
struct WalletSessions {
    challenges: BTreeMap<String, WalletChallenge>,
    sessions: BTreeMap<String, WalletSession>,
    narrative_move_nonces: BTreeMap<String, Instant>,
}

#[derive(Clone, Debug)]
struct QrWalletLogin {
    poll_token: String,
    expires_at: Instant,
    expires_at_unix: u64,
    wallet_address: Option<String>,
    wallet_session: Option<String>,
    completed_at: Option<Instant>,
}

#[derive(Debug, Default)]
struct QrWalletLogins {
    logins: BTreeMap<String, QrWalletLogin>,
}

#[derive(Clone, Debug)]
struct ActorSession {
    actor_id: u64,
    expires_at: Instant,
    expires_at_unix: u64,
    last_seen_at: Instant,
    explicitly_inactive: bool,
}

#[derive(Debug, Default)]
struct ActorSessions {
    sessions: BTreeMap<String, ActorSession>,
}

#[derive(Clone, Debug)]
struct ActorSuspension {
    reason: String,
    created_at_unix: u64,
}

fn placement_target_kind_from_str(kind: &str) -> Option<u8> {
    match kind {
        "actor_hand" => Some(CW_PLACEMENT_ACTOR_HAND),
        "location_floor" => Some(CW_PLACEMENT_LOCATION_FLOOR),
        _ => None,
    }
}

fn wallet_for_session(
    wallet_sessions: &StdMutex<WalletSessions>,
    session_token: &str,
) -> Option<String> {
    let token = session_token.trim();
    if token.is_empty() {
        return None;
    }
    let now = Instant::now();
    let Ok(mut sessions) = wallet_sessions.lock() else {
        return None;
    };
    sessions
        .sessions
        .retain(|_, session| session.expires_at > now);
    sessions
        .sessions
        .get(token)
        .map(|session| session.wallet_address.clone())
}

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    startup::run().await
}

impl AppState {
    fn allow_rate_limit(&self, key: impl Into<String>, limit: RateLimit) -> bool {
        self.rate_limiter
            .lock()
            .map(|mut limiter| limiter.allow(key.into(), limit, Instant::now()))
            .unwrap_or(false)
    }
}

impl RuntimeSnapshot {}
fn default_zone() -> String {
    ZONE_SANCTUARY.to_string()
}

fn clock_presentation_is_valid(presentation: &ClockPresentation) -> bool {
    presentation.version == CLOCK_PRESENTATION_SCHEMA_VERSION
        && !presentation.question.trim().is_empty()
        && matches!(
            presentation.rhythm.as_str(),
            "immediate" | "session" | "multi_session" | "construction" | "civic" | "seasonal"
        )
        && matches!(
            presentation.attention.as_str(),
            "immediate" | "local" | "communal" | "background"
        )
        && !presentation.situation.trim().is_empty()
        && !presentation.stakes.trim().is_empty()
        && !presentation.outcome.trim().is_empty()
        && !presentation.completion_memory.trim().is_empty()
}

fn clock_attention_rank(attention: &str) -> u8 {
    match attention {
        "immediate" => 4,
        "local" => 3,
        "communal" => 2,
        "background" => 1,
        _ => 0,
    }
}

fn default_pathway_distance() -> u8 {
    1
}

fn zone_for_safety(safety: &str) -> &'static str {
    match safety {
        "risky" | "dangerous" => ZONE_FRONTIER,
        _ => ZONE_SANCTUARY,
    }
}

impl RuntimeWorld {
    fn actor_name(&self, actor_id: u64) -> Option<String> {
        self.actors.get(&actor_id).map(|meta| meta.name.clone())
    }

    fn actor_by_id(&self, actor_id: u64) -> Option<CwActor> {
        self.world.actors[..self.world.actor_count]
            .iter()
            .copied()
            .find(|actor| actor.id == actor_id)
    }

    fn seed_exit_discovered(&self, from_location_id: u64, to_location_id: u64) -> bool {
        self.route_discovered_for_edge(from_location_id, to_location_id)
            || self
                .tags
                .get(&seed_exit_discovered_tag_id(
                    from_location_id,
                    to_location_id,
                ))
                .is_some_and(|tag| tag.active)
    }

    fn seed_exit_candidate_for_search(&self, location_id: u64) -> Option<&'static SeedExitContent> {
        let mut candidates = active_content()
            .exits
            .iter()
            .filter(|exit| exit.from_location_id == location_id)
            .filter(|exit| !self.seed_exit_discovered(exit.from_location_id, exit.to_location_id))
            .collect::<Vec<_>>();
        candidates.sort_by_key(|exit| {
            (
                Reverse(search_reveal_chance_percent_for_subject(
                    "location",
                    exit.to_location_id,
                )),
                exit.to_location_id,
            )
        });
        candidates.first().copied()
    }

    fn hidden_search_item_for_location(&self, location_id: u64) -> Option<u64> {
        let mut hidden = self.world.items[..self.world.item_count]
            .iter()
            .copied()
            .filter(|item| {
                item.holder_actor_id == 0
                    && item.charges > 0
                    && ((item.location_id == 0 && item.zone == CW_CARD_ZONE_HIDDEN)
                        || self.forgotten_search_item_at_location(*item, location_id))
                    && !self.search_item_remembered(item.id)
            })
            .collect::<Vec<_>>();
        hidden.sort_by_key(|item| {
            let home_rank = active_content()
                .items
                .iter()
                .find(|seed_item| seed_item.id == item.id)
                .map(|seed_item| {
                    if seed_item.location_id == location_id {
                        0
                    } else {
                        1
                    }
                })
                .unwrap_or(2);
            (
                home_rank,
                Reverse(search_reveal_chance_percent_for_subject("item", item.id)),
                item.id,
            )
        });
        hidden.first().map(|item| item.id)
    }

    fn hidden_exit_by_id(&self, hidden_exit_id: &str) -> Option<&'static SeedHiddenExitContent> {
        active_content()
            .hidden_exits
            .iter()
            .find(|hidden_exit| hidden_exit.id == hidden_exit_id)
    }

    fn hidden_exit_discovered(&self, hidden_exit: &SeedHiddenExitContent) -> bool {
        self.route_discovered_for_edge(hidden_exit.from_location_id, hidden_exit.to_location_id)
            || self
                .tags
                .get(&hidden_exit_discovered_tag_id(&hidden_exit.id))
                .is_some_and(|tag| tag.active)
    }

    fn hidden_exit_candidate_for_search(
        &self,
        location_id: u64,
        feature_key: &str,
    ) -> Option<&'static SeedHiddenExitContent> {
        active_content().hidden_exits.iter().find(|hidden_exit| {
            hidden_exit.from_location_id == location_id
                && hidden_exit.feature_key == feature_key
                && !self.hidden_exit_discovered(hidden_exit)
        })
    }

    fn default_hidden_exit_candidate(
        &self,
        location_id: u64,
    ) -> Option<&'static SeedHiddenExitContent> {
        active_content().hidden_exits.iter().find(|hidden_exit| {
            hidden_exit.from_location_id == location_id && !self.hidden_exit_discovered(hidden_exit)
        })
    }

    fn hidden_exit_reveal_chance_percent(&self, hidden_exit: &SeedHiddenExitContent) -> u8 {
        hidden_exit
            .reveal_chance_percent
            .min(search_reveal_chance_percent_for_subject(
                "location",
                hidden_exit.to_location_id,
            ))
    }

    fn avatar_hidden_until_discovered(&self, actor: CwActor) -> bool {
        if !Self::actor_can_act(actor)
            || !active_content()
                .actors
                .iter()
                .any(|seed_actor| seed_actor.id == actor.id)
        {
            return false;
        }
        let hidden_location = active_content()
            .hidden_exits
            .iter()
            .any(|hidden_exit| hidden_exit.to_location_id == actor.location_id);
        let hidden_rarity = seed_card_rarity_for_subject("actor", actor.id)
            .map(|rarity| search_reveal_chance_percent_for_rarity(rarity) <= 35)
            .unwrap_or(false);
        hidden_location || hidden_rarity
    }

    fn hidden_avatar_candidate_for_search(&self, location_id: u64) -> Option<CwActor> {
        let mut candidates = self.world.actors[..self.world.actor_count]
            .iter()
            .copied()
            .filter(|actor| Self::actor_can_act(*actor))
            .filter(|actor| actor.location_id == location_id)
            .filter(|actor| self.avatar_hidden_until_discovered(*actor))
            .filter(|actor| !self.avatar_discovered(actor.id))
            .collect::<Vec<_>>();
        candidates.sort_by_key(|actor| {
            (
                Reverse(search_reveal_chance_percent_for_subject("actor", actor.id)),
                actor.id,
            )
        });
        candidates.first().copied()
    }

    fn search_reveal_candidates_for_feature(
        &self,
        location_id: u64,
        feature_key: &str,
    ) -> Vec<SearchRevealCandidate> {
        if feature_key == "room" {
            return self.search_reveal_candidates_for_location(location_id);
        }

        let mut candidates = Vec::new();
        if let Some(hidden_exit) = self.hidden_exit_candidate_for_search(location_id, feature_key) {
            candidates.push(SearchRevealCandidate::HiddenExit {
                hidden_exit_id: hidden_exit.id.clone(),
            });
        }
        let hidden_item_id = self.hidden_search_item_for_location(location_id);
        let feature_uses_hidden_item = self
            .room_features(location_id)
            .into_iter()
            .find(|feature| feature.key == feature_key)
            .is_some_and(|feature| {
                feature
                    .uses
                    .iter()
                    .any(|use_case| Some(use_case.item_id) == hidden_item_id)
            });
        if feature_uses_hidden_item {
            if let Some(item_id) = hidden_item_id {
                candidates.push(SearchRevealCandidate::Item { item_id });
            }
        }
        candidates.sort_by_key(|candidate| self.search_candidate_sort_key(candidate));
        candidates
    }

    fn search_reveal_candidates_for_location(
        &self,
        location_id: u64,
    ) -> Vec<SearchRevealCandidate> {
        let mut candidates = Vec::new();
        if let Some(exit) = self.seed_exit_candidate_for_search(location_id) {
            candidates.push(SearchRevealCandidate::SeedExit {
                from_location_id: exit.from_location_id,
                to_location_id: exit.to_location_id,
            });
        }
        if let Some(hidden_exit) = self.default_hidden_exit_candidate(location_id) {
            candidates.push(SearchRevealCandidate::HiddenExit {
                hidden_exit_id: hidden_exit.id.clone(),
            });
        }
        if let Some(actor) = self.hidden_avatar_candidate_for_search(location_id) {
            candidates.push(SearchRevealCandidate::Avatar {
                actor_id: actor.id,
                location_id,
            });
        }
        if let Some(item_id) = self.hidden_search_item_for_location(location_id) {
            candidates.push(SearchRevealCandidate::Item { item_id });
        }
        candidates.sort_by_key(|candidate| self.search_candidate_sort_key(candidate));
        candidates
    }

    fn search_candidate_sort_key(
        &self,
        candidate: &SearchRevealCandidate,
    ) -> (u8, Reverse<u8>, u64, u64) {
        match candidate {
            SearchRevealCandidate::SeedExit {
                from_location_id,
                to_location_id,
            } => (
                0,
                Reverse(self.search_candidate_reveal_chance_percent(candidate)),
                *from_location_id,
                *to_location_id,
            ),
            SearchRevealCandidate::HiddenExit { hidden_exit_id } => (
                1,
                Reverse(self.search_candidate_reveal_chance_percent(candidate)),
                stable_hash_u64(&["hidden-exit", hidden_exit_id]),
                0,
            ),
            SearchRevealCandidate::Avatar {
                actor_id,
                location_id,
            } => (
                2,
                Reverse(self.search_candidate_reveal_chance_percent(candidate)),
                *location_id,
                *actor_id,
            ),
            SearchRevealCandidate::Item { item_id } => (
                3,
                Reverse(self.search_candidate_reveal_chance_percent(candidate)),
                *item_id,
                0,
            ),
        }
    }

    fn search_candidate_reveal_chance_percent(&self, candidate: &SearchRevealCandidate) -> u8 {
        match candidate {
            SearchRevealCandidate::SeedExit { to_location_id, .. } => {
                search_reveal_chance_percent_for_subject("location", *to_location_id)
            }
            SearchRevealCandidate::HiddenExit { hidden_exit_id } => self
                .hidden_exit_by_id(hidden_exit_id)
                .map(|hidden_exit| self.hidden_exit_reveal_chance_percent(hidden_exit))
                .unwrap_or(0),
            SearchRevealCandidate::Avatar { actor_id, .. } => {
                search_reveal_chance_percent_for_subject("actor", *actor_id)
            }
            SearchRevealCandidate::Item { item_id } => {
                search_reveal_chance_percent_for_subject("item", *item_id)
            }
        }
    }

    fn active_progress_clock_id_for_location(&self, location_id: u64) -> Option<String> {
        let has_location_job = self.location_has_job(location_id);
        self.active_job_for_location(location_id)
            .map(|job| job.progress_clock_id.clone())
            .or_else(|| {
                if has_location_job {
                    return None;
                }
                listen_progress_clock_id_for_location(location_id).and_then(|clock_id| {
                    self.clocks
                        .get(clock_id)
                        .filter(|clock| clock.filled < clock.segments)
                        .map(|_| clock_id.to_string())
                })
            })
    }

    fn location_has_job(&self, location_id: u64) -> bool {
        self.jobs
            .values()
            .any(|job| job.delivery.is_none() && job.location_ids.contains(&location_id))
    }

    fn active_job_for_location(&self, location_id: u64) -> Option<&JobState> {
        self.jobs
            .values()
            .filter(|job| job.delivery.is_none())
            .filter(|job| job.location_ids.contains(&location_id))
            .filter(|job| self.job_status(job) == "active")
            .filter_map(|job| {
                self.clocks
                    .get(&job.progress_clock_id)
                    .map(|clock| (job, clock))
            })
            .filter(|(_, clock)| clock.filled < clock.segments)
            .min_by(|(left, _), (right, _)| self.compare_job_presentation(left, right))
            .map(|(job, _)| job)
    }

    fn is_completed_building_follow_up_job(&self, job_id: &str) -> bool {
        self.settlement_buildings.values().any(|building| {
            building.status == SettlementBuildingStatus::Completed
                && building
                    .follow_up_job_ids
                    .iter()
                    .any(|follow_up_job_id| follow_up_job_id == job_id)
        })
    }

    fn compare_job_presentation(&self, left: &JobState, right: &JobState) -> std::cmp::Ordering {
        let presentation_for = |job: &JobState| {
            self.clocks
                .get(&job.progress_clock_id)
                .map(|clock| &clock.presentation)
        };
        let left_presentation = presentation_for(left);
        let right_presentation = presentation_for(right);
        self.is_completed_building_follow_up_job(&right.id)
            .cmp(&self.is_completed_building_follow_up_job(&left.id))
            .then_with(|| {
                right_presentation
                    .map(|presentation| presentation.priority)
                    .unwrap_or_default()
                    .cmp(
                        &left_presentation
                            .map(|presentation| presentation.priority)
                            .unwrap_or_default(),
                    )
            })
            .then_with(|| {
                clock_attention_rank(
                    right_presentation
                        .map(|presentation| presentation.attention.as_str())
                        .unwrap_or_default(),
                )
                .cmp(&clock_attention_rank(
                    left_presentation
                        .map(|presentation| presentation.attention.as_str())
                        .unwrap_or_default(),
                ))
            })
            .then_with(|| left.id.cmp(&right.id))
    }

    fn room_features(&self, location_id: u64) -> Vec<&'static SeedRoomFeatureContent> {
        active_content()
            .room_features
            .iter()
            .filter(|feature| feature.location_id == location_id)
            .collect()
    }

    #[allow(dead_code)]
    fn room_feature_use_effect(
        &self,
        actor_id: Option<u64>,
        location_id: u64,
        feature_key: &str,
        item_id: u64,
    ) -> Option<String> {
        let mut parts = Vec::new();
        if let Some(progress) =
            self.room_feature_project_progress_effect(actor_id, location_id, item_id)
        {
            parts.push(progress);
        }
        if let Some(target) = FEATURE_BOND_TARGETS.iter().find(|target| {
            target.location_id == location_id
                && target.feature_key == feature_key
                && target.item_id == item_id
        }) {
            let target_name = self
                .actor_name(target.target_actor_id)
                .unwrap_or_else(|| format!("Resident {}", target.target_actor_id));
            parts.push(format!("friendship with {target_name} grows"));
        }
        (!parts.is_empty()).then(|| parts.join(", "))
    }

    #[allow(dead_code)]
    fn room_feature_project_progress_effect(
        &self,
        actor_id: Option<u64>,
        location_id: u64,
        item_id: u64,
    ) -> Option<String> {
        let clock_id = self.active_progress_clock_id_for_location(location_id)?;
        let target_id = item_id.to_string();
        let amount: u8 = lifecycle_hooks_for("on_use", "item", &target_id)
            .into_iter()
            .filter(|hook| {
                lifecycle_hook_requirements_met(hook, &self.tags)
                    && actor_id
                        .and_then(|id| lifecycle_hook_claim_key(hook, id, "item", &target_id, 0))
                        .map(|claim_key| !self.rpg_claims.contains(&claim_key))
                        .unwrap_or(true)
            })
            .flat_map(|hook| hook.effects.iter())
            .filter_map(|effect| match effect {
                EffectDescriptor::AdvanceClock {
                    clock_id: effect_clock_id,
                    amount,
                    ..
                } if effect_clock_id == &clock_id => Some(*amount),
                _ => None,
            })
            .sum();
        (amount > 0).then(|| format!("+{amount} progress"))
    }

    fn feature_use_claimed(
        &self,
        actor_id: u64,
        location_id: u64,
        feature_key: &str,
        item_id: u64,
    ) -> bool {
        self.tags
            .get(&feature_use_tag_id(
                actor_id,
                location_id,
                feature_key,
                item_id,
            ))
            .map(|tag| tag.active)
            .unwrap_or(false)
    }

    fn feature_search_claimed(&self, actor_id: u64, location_id: u64, feature_key: &str) -> bool {
        self.tags
            .get(&feature_search_tag_id(actor_id, location_id, feature_key))
            .map(|tag| tag.active)
            .unwrap_or(false)
    }

    fn room_feature_search_claimed(&self, location_id: u64, feature_key: &str) -> bool {
        self.tags
            .get(&room_feature_search_tag_id(location_id, feature_key))
            .map(|tag| tag.active)
            .unwrap_or(false)
    }

    fn job_status(&self, job: &JobState) -> String {
        let danger_filled = self
            .clocks
            .get(&job.danger_clock_id)
            .map(|clock| clock.filled >= clock.segments)
            .unwrap_or(false);
        if danger_filled {
            return "failed".to_string();
        }
        let progress_filled = self
            .clocks
            .get(&job.progress_clock_id)
            .map(|clock| clock.filled >= clock.segments)
            .unwrap_or(false);
        if progress_filled {
            return "completed".to_string();
        }
        let explicit = job.status.trim();
        if matches!(explicit, "completed" | "failed") {
            // Legacy snapshots may only have the terminal status. New quest state
            // derives its terminal phase from journaled clock/effect events first.
            return explicit.to_string();
        }
        if explicit.is_empty() {
            "active".to_string()
        } else {
            explicit.to_string()
        }
    }
}

fn event_store_readiness(state: &AppState) -> Result<(), String> {
    if state.event_store_path.is_none() {
        return Ok(());
    }
    let health = state
        .event_store_health
        .lock()
        .map_err(|_| "event store health is unavailable".to_string())?;
    if health.status(true) == "healthy" {
        Ok(())
    } else {
        Err(format!("event store is {}", health.status(true)))
    }
}

async fn health(State(state): State<AppState>) -> (StatusCode, Json<HealthResponse>) {
    if let Err(error) = event_store_readiness(&state) {
        return (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(HealthResponse {
                ok: false,
                service: "cosyworld-orchestrator",
                status: "not_ready",
                error: Some(error),
            }),
        );
    }
    if let Err(error) = required_processes_ready(&required_health_urls_from_env()).await {
        return (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(HealthResponse {
                ok: false,
                service: "cosyworld-orchestrator",
                status: "not_ready",
                error: Some(error),
            }),
        );
    }
    (
        StatusCode::OK,
        Json(HealthResponse {
            ok: true,
            service: "cosyworld-orchestrator",
            status: "ready",
            error: None,
        }),
    )
}

async fn health_live() -> (StatusCode, Json<HealthResponse>) {
    (
        StatusCode::OK,
        Json(HealthResponse {
            ok: true,
            service: "cosyworld-orchestrator",
            status: "alive",
            error: None,
        }),
    )
}

fn canonical_command_error_with_kind(
    command: &str,
    status: u32,
    output: impl Into<String>,
    error_kind: Option<CommandErrorKind>,
) -> Json<CommandResponse> {
    Json(CommandResponse {
        ok: false,
        status,
        command: normalize_command_text(command),
        verb: String::new(),
        output: Some(output.into()),
        error_kind,
        action: None,
        receipt: None,
        events: Vec::new(),
    })
}

fn skill_label(skill_id: &str) -> Option<&'static str> {
    match skill_id {
        "lifting" => Some("Lifting"),
        "nimble_hands" => Some("Nimble Hands"),
        "steadiness" => Some("Steadiness"),
        "lorecraft" => Some("Lorecraft"),
        "listening" => Some("Listening"),
        "kindness" => Some("Kindness"),
        _ => None,
    }
}

fn clock_zone(clock: &ClockState) -> &str {
    let zone = clock.zone.trim();
    if zone.is_empty() {
        default_zone_for_scope(&clock.scope, clock.scope_id)
    } else {
        zone
    }
}

fn room_sheet_zone(sheet: &RoomSheetState) -> &str {
    let zone = sheet.zone.trim();
    if zone.is_empty() {
        zone_for_safety(&sheet.safety)
    } else {
        zone
    }
}

fn default_zone_for_scope(scope: &str, scope_id: u64) -> &'static str {
    if scope == "room" && scope_id == MOONLIT_TRAIL_LOCATION_ID {
        ZONE_FRONTIER
    } else {
        ZONE_SANCTUARY
    }
}

fn tag_scope_is_allowed(scope: &str) -> bool {
    matches!(
        scope,
        "actor" | "room" | "resident" | "faction" | "job" | "season" | "shard"
    )
}

fn tag_kind_is_allowed(kind: &str) -> bool {
    matches!(
        kind,
        "aspect" | "condition" | "memory" | "bond" | "boon" | "hook"
    )
}

fn normalize_job_status(value: &str) -> Option<&'static str> {
    match value.trim() {
        "complete" | "completed" => Some("completed"),
        "fail" | "failed" => Some("failed"),
        _ => None,
    }
}

/// Operator opt-in for the one-time event store auto_vacuum conversion
/// (issue #886). Set only for the maintenance-window deploy; unset after.
fn one_time_auto_vacuum_requested() -> bool {
    std::env::var("COSYWORLD_ONE_TIME_AUTO_VACUUM")
        .map(|value| value == "1" || value.eq_ignore_ascii_case("true"))
        .unwrap_or(false)
}

fn event_store_path_from_env() -> Option<PathBuf> {
    match std::env::var("COSYWORLD_V2_EVENT_DB_PATH") {
        Ok(value) if value.trim().is_empty() => None,
        Ok(value) if value.eq_ignore_ascii_case("off") || value.eq_ignore_ascii_case("none") => {
            None
        }
        Ok(value) => Some(PathBuf::from(value)),
        Err(_) => Some(PathBuf::from(".runtime/cosyworld-v2-events.sqlite")),
    }
}

/// Schema version stamped after DDL runs. Bump it when a table is added so
/// existing stores self-heal once on their next initialization.
const EVENT_STORE_SCHEMA_VERSION: i64 = 7;

/// Ensures the schema exists without taking its write lock on steady-state
/// commits. Missing, replaced, and older stores rerun the idempotent DDL.
fn init_event_store(path: &Path) -> io::Result<()> {
    if path.exists() {
        let conn = open_event_store(path)?;
        let version: i64 = conn
            .query_row("PRAGMA user_version", [], |row| row.get(0))
            .map_err(sqlite_error)?;
        if version >= EVENT_STORE_SCHEMA_VERSION {
            return Ok(());
        }
    }
    initialize_event_store_schema(path)
}

fn initialize_event_store_schema(path: &Path) -> io::Result<()> {
    if let Some(parent) = path.parent() {
        if !parent.as_os_str().is_empty() {
            fs::create_dir_all(parent)?;
        }
    }
    let conn = open_canonical_store_for_initialization(path)?;
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS world_events (
            seq INTEGER PRIMARY KEY,
            world_id TEXT NOT NULL DEFAULT 'world://cosyworld/official',
            world_epoch INTEGER NOT NULL DEFAULT 1,
            event_type TEXT NOT NULL,
            location_id INTEGER,
            destination_location_id INTEGER,
            payload_json TEXT NOT NULL,
            created_at_ms INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_world_events_type ON world_events(event_type);
        CREATE TABLE IF NOT EXISTS room_memory_chapters (
            location_id INTEGER NOT NULL,
            day_index INTEGER NOT NULL,
            latest_seq INTEGER NOT NULL,
            summary TEXT NOT NULL,
            source TEXT NOT NULL,
            updated_at_ms INTEGER NOT NULL,
            PRIMARY KEY (location_id, day_index)
        );
        CREATE INDEX IF NOT EXISTS idx_room_memory_chapters_location_day
            ON room_memory_chapters(location_id, day_index);
        CREATE TABLE IF NOT EXISTS action_journal (
            journal_seq INTEGER PRIMARY KEY AUTOINCREMENT,
            action_kind INTEGER NOT NULL,
            seed INTEGER NOT NULL,
            record_json TEXT NOT NULL,
            created_at_ms INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_action_journal_kind ON action_journal(action_kind);
        CREATE TABLE IF NOT EXISTS persistence_compaction (
            singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
            action_journal_floor_seq INTEGER NOT NULL DEFAULT 0,
            canonical_commit_floor_journal_seq INTEGER NOT NULL DEFAULT 0,
            world_event_floor_seq INTEGER NOT NULL DEFAULT 0,
            last_compacted_at_ms INTEGER,
            deleted_action_journal_rows INTEGER NOT NULL DEFAULT 0,
            deleted_canonical_commit_rows INTEGER NOT NULL DEFAULT 0,
            deleted_world_event_rows INTEGER NOT NULL DEFAULT 0
        );
        CREATE TABLE IF NOT EXISTS canonical_command_receipts (
            world_id TEXT NOT NULL,
            intent_id TEXT NOT NULL,
            request_hash TEXT NOT NULL,
            response_json TEXT NOT NULL,
            created_at_ms INTEGER NOT NULL,
            PRIMARY KEY (world_id, intent_id)
        );
        CREATE INDEX IF NOT EXISTS idx_canonical_command_receipts_created
            ON canonical_command_receipts(created_at_ms);
        CREATE TABLE IF NOT EXISTS actor_jobs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            kind TEXT NOT NULL,
            actor_id INTEGER NOT NULL,
            cause_event_seq INTEGER,
            source_tick INTEGER NOT NULL,
            observed_through_seq INTEGER NOT NULL,
            location_id INTEGER,
            status TEXT NOT NULL DEFAULT 'pending',
            attempts INTEGER NOT NULL DEFAULT 0,
            lease_until_ms INTEGER,
            available_at_ms INTEGER NOT NULL DEFAULT 0,
            context_json TEXT NOT NULL,
            dedupe_key TEXT NOT NULL UNIQUE,
            last_error TEXT,
            created_at_ms INTEGER NOT NULL,
            updated_at_ms INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_actor_jobs_ready
            ON actor_jobs(status, available_at_ms, lease_until_ms, id);
        CREATE INDEX IF NOT EXISTS idx_actor_jobs_actor
            ON actor_jobs(actor_id, status, id);
        CREATE TABLE IF NOT EXISTS actor_sessions (
            session_token TEXT PRIMARY KEY,
            actor_id INTEGER NOT NULL,
            expires_at_unix INTEGER NOT NULL,
            created_at_ms INTEGER NOT NULL,
            updated_at_ms INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_actor_sessions_actor_id ON actor_sessions(actor_id);
        CREATE INDEX IF NOT EXISTS idx_actor_sessions_expires_at ON actor_sessions(expires_at_unix);
        CREATE TABLE IF NOT EXISTS avatar_session_handoffs (
            from_actor_id INTEGER PRIMARY KEY,
            to_actor_id INTEGER NOT NULL,
            reason TEXT NOT NULL,
            created_at_ms INTEGER NOT NULL,
            updated_at_ms INTEGER NOT NULL,
            consumed_count INTEGER NOT NULL DEFAULT 0,
            last_consumed_at_ms INTEGER,
            retired_at_ms INTEGER
        );
        CREATE INDEX IF NOT EXISTS idx_avatar_session_handoffs_target
            ON avatar_session_handoffs(to_actor_id, retired_at_ms);
        CREATE TABLE IF NOT EXISTS wallet_avatar_links (
            wallet_address TEXT PRIMARY KEY,
            actor_id INTEGER NOT NULL,
            created_at_ms INTEGER NOT NULL,
            updated_at_ms INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_wallet_avatar_links_actor_id ON wallet_avatar_links(actor_id);
        CREATE TABLE IF NOT EXISTS actor_suspensions (
            actor_id INTEGER PRIMARY KEY,
            reason TEXT NOT NULL,
            created_at_unix INTEGER NOT NULL,
            updated_at_ms INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS moderation_reports (
            report_id INTEGER PRIMARY KEY AUTOINCREMENT,
            status TEXT NOT NULL DEFAULT 'open',
            reporter_actor_id INTEGER NOT NULL,
            reporter_actor_name TEXT NOT NULL,
            reporter_actor_kind TEXT NOT NULL DEFAULT 'human',
            target_actor_id INTEGER NOT NULL,
            target_actor_name TEXT NOT NULL,
            target_actor_kind TEXT NOT NULL DEFAULT 'unknown',
            location_id INTEGER NOT NULL,
            location_name TEXT NOT NULL,
            reason TEXT NOT NULL,
            created_at_ms INTEGER NOT NULL,
            resolved_at_ms INTEGER,
            resolved_by TEXT,
            resolution_note TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_moderation_reports_target ON moderation_reports(target_actor_id);
        CREATE INDEX IF NOT EXISTS idx_moderation_reports_created ON moderation_reports(created_at_ms);
        CREATE TABLE IF NOT EXISTS orb_ledger (
            idempotency_key TEXT PRIMARY KEY,
            actor_id INTEGER NOT NULL,
            delta INTEGER NOT NULL,
            reason TEXT NOT NULL,
            source_event_id INTEGER,
            balance_after INTEGER NOT NULL,
            metadata_json TEXT NOT NULL,
            created_at_ms INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_orb_ledger_actor_id ON orb_ledger(actor_id);
        CREATE INDEX IF NOT EXISTS idx_orb_ledger_source_event_id ON orb_ledger(source_event_id);
        CREATE TABLE IF NOT EXISTS ai_usage_ledger (
            idempotency_key TEXT PRIMARY KEY,
            actor_id INTEGER,
            feature TEXT NOT NULL,
            payer_mode TEXT NOT NULL,
            provider TEXT NOT NULL,
            model TEXT NOT NULL,
            status TEXT NOT NULL,
            source_event_id INTEGER,
            orb_delta INTEGER NOT NULL DEFAULT 0,
            error_code TEXT,
            latency_ms INTEGER NOT NULL DEFAULT 0,
            created_at_ms INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_ai_usage_ledger_actor_id ON ai_usage_ledger(actor_id);
        CREATE INDEX IF NOT EXISTS idx_ai_usage_ledger_source_event_id ON ai_usage_ledger(source_event_id);
        CREATE TABLE IF NOT EXISTS wooden_box_receipts (
            box_asset_address TEXT PRIMARY KEY,
            owner_wallet_address TEXT NOT NULL,
            status TEXT NOT NULL,
            burn_signature TEXT NOT NULL UNIQUE,
            verification_status TEXT NOT NULL,
            metadata_uri TEXT,
            pack_id TEXT NOT NULL UNIQUE,
            created_at_ms INTEGER NOT NULL,
            updated_at_ms INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_wooden_box_receipts_owner ON wooden_box_receipts(owner_wallet_address);
        CREATE TABLE IF NOT EXISTS avatar_pack_openings (
            idempotency_key TEXT PRIMARY KEY,
            owner_wallet_address TEXT NOT NULL,
            box_asset_address TEXT,
            pack_id TEXT NOT NULL UNIQUE,
            reveal_seed TEXT NOT NULL,
            catalog_hash TEXT NOT NULL,
            card_ids_json TEXT NOT NULL,
            provenance_json TEXT NOT NULL,
            created_at_ms INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_avatar_pack_openings_owner ON avatar_pack_openings(owner_wallet_address);
        CREATE TABLE IF NOT EXISTS economy_reconciliation_runs (
            run_id INTEGER PRIMARY KEY AUTOINCREMENT,
            source TEXT NOT NULL,
            wallet_count INTEGER NOT NULL,
            active_box_count INTEGER NOT NULL,
            unopened_pack_count INTEGER NOT NULL,
            anomaly_count INTEGER NOT NULL,
            anomalies_json TEXT NOT NULL,
            status TEXT NOT NULL DEFAULT 'open',
            created_at_ms INTEGER NOT NULL,
            resolved_at_ms INTEGER,
            resolved_by TEXT,
            resolution_note TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_economy_reconciliation_runs_created
            ON economy_reconciliation_runs(created_at_ms);",
    )
    .map_err(sqlite_error)?;
    init_ai_publication_store(&conn)?;
    ai_voice_routing::init_ai_voice_routing_store(&conn)?;
    model_interaction::init_model_interaction_batch_store(&conn)?;
    init_media_job_store(&conn)?;
    ensure_sqlite_column(
        &conn,
        "persistence_compaction",
        "canonical_commit_floor_journal_seq",
        "ALTER TABLE persistence_compaction
         ADD COLUMN canonical_commit_floor_journal_seq INTEGER NOT NULL DEFAULT 0",
    )?;
    ensure_sqlite_column(
        &conn,
        "persistence_compaction",
        "deleted_canonical_commit_rows",
        "ALTER TABLE persistence_compaction
         ADD COLUMN deleted_canonical_commit_rows INTEGER NOT NULL DEFAULT 0",
    )?;
    ensure_sqlite_column(
        &conn,
        "world_events",
        "world_id",
        "ALTER TABLE world_events ADD COLUMN world_id TEXT NOT NULL DEFAULT 'world://cosyworld/official'",
    )?;
    ensure_sqlite_column(
        &conn,
        "world_events",
        "world_epoch",
        "ALTER TABLE world_events ADD COLUMN world_epoch INTEGER NOT NULL DEFAULT 1",
    )?;
    ensure_sqlite_column(
        &conn,
        "world_events",
        "location_id",
        "ALTER TABLE world_events ADD COLUMN location_id INTEGER",
    )?;
    ensure_sqlite_column(
        &conn,
        "world_events",
        "destination_location_id",
        "ALTER TABLE world_events ADD COLUMN destination_location_id INTEGER",
    )?;
    conn.execute(
        "UPDATE world_events SET
            location_id = json_extract(payload_json, '$.location_id'),
            destination_location_id = json_extract(payload_json, '$.destination_location_id')
         WHERE location_id IS NULL AND destination_location_id IS NULL",
        [],
    )
    .map_err(sqlite_error)?;
    conn.execute(
        "CREATE UNIQUE INDEX IF NOT EXISTS idx_world_events_canonical_identity
         ON world_events(world_id, world_epoch, seq)",
        [],
    )
    .map_err(sqlite_error)?;
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_world_events_canonical_type_seq
         ON world_events(world_id, world_epoch, event_type, seq)",
        [],
    )
    .map_err(sqlite_error)?;
    conn.execute_batch(
        "CREATE INDEX IF NOT EXISTS idx_world_events_canonical_location_seq
            ON world_events(world_id, world_epoch, location_id, seq);
         CREATE INDEX IF NOT EXISTS idx_world_events_canonical_destination_seq
            ON world_events(world_id, world_epoch, destination_location_id, seq);",
    )
    .map_err(sqlite_error)?;
    room_history::initialize_index(&conn)?;
    init_canonical_journal(&conn, OFFICIAL_WORLD_ID, OFFICIAL_WORLD_EPOCH)?;
    init_hosted_access_store(&conn)?;
    init_story_metrics_store(&conn)?;
    init_legacy_import_store(&conn)?;
    init_activation_store(&conn)?;
    ensure_sqlite_column(
        &conn,
        "moderation_reports",
        "reporter_actor_kind",
        "ALTER TABLE moderation_reports ADD COLUMN reporter_actor_kind TEXT NOT NULL DEFAULT 'human'",
    )?;
    ensure_sqlite_column(
        &conn,
        "moderation_reports",
        "target_actor_kind",
        "ALTER TABLE moderation_reports ADD COLUMN target_actor_kind TEXT NOT NULL DEFAULT 'unknown'",
    )?;
    ensure_sqlite_column(
        &conn,
        "moderation_reports",
        "status",
        "ALTER TABLE moderation_reports ADD COLUMN status TEXT NOT NULL DEFAULT 'open'",
    )?;
    ensure_sqlite_column(
        &conn,
        "moderation_reports",
        "resolved_at_ms",
        "ALTER TABLE moderation_reports ADD COLUMN resolved_at_ms INTEGER",
    )?;
    ensure_sqlite_column(
        &conn,
        "moderation_reports",
        "resolved_by",
        "ALTER TABLE moderation_reports ADD COLUMN resolved_by TEXT",
    )?;
    ensure_sqlite_column(
        &conn,
        "moderation_reports",
        "resolution_note",
        "ALTER TABLE moderation_reports ADD COLUMN resolution_note TEXT",
    )?;
    ensure_sqlite_column(
        &conn,
        "economy_reconciliation_runs",
        "status",
        "ALTER TABLE economy_reconciliation_runs ADD COLUMN status TEXT NOT NULL DEFAULT 'open'",
    )?;
    ensure_sqlite_column(
        &conn,
        "economy_reconciliation_runs",
        "resolved_at_ms",
        "ALTER TABLE economy_reconciliation_runs ADD COLUMN resolved_at_ms INTEGER",
    )?;
    ensure_sqlite_column(
        &conn,
        "economy_reconciliation_runs",
        "resolved_by",
        "ALTER TABLE economy_reconciliation_runs ADD COLUMN resolved_by TEXT",
    )?;
    ensure_sqlite_column(
        &conn,
        "economy_reconciliation_runs",
        "resolution_note",
        "ALTER TABLE economy_reconciliation_runs ADD COLUMN resolution_note TEXT",
    )?;
    conn.execute(
        "UPDATE economy_reconciliation_runs
         SET status = 'clear'
         WHERE anomaly_count = 0 AND status = 'open' AND resolved_at_ms IS NULL",
        [],
    )
    .map_err(sqlite_error)?;
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_moderation_reports_status ON moderation_reports(status, report_id)",
        [],
    )
    .map_err(sqlite_error)?;
    conn.pragma_update(None, "user_version", EVENT_STORE_SCHEMA_VERSION)
        .map_err(sqlite_error)?;
    conn.execute_batch(account_avatars::SCHEMA)
        .map_err(sqlite_error)?;
    Ok(())
}

fn ensure_sqlite_column(
    conn: &Connection,
    table: &str,
    column: &str,
    alter_sql: &str,
) -> io::Result<()> {
    let pragma = format!("PRAGMA table_info({table})");
    let mut stmt = conn.prepare(&pragma).map_err(sqlite_error)?;
    let rows = stmt
        .query_map([], |row| row.get::<_, String>(1))
        .map_err(sqlite_error)?;
    for row in rows {
        if row.map_err(sqlite_error)? == column {
            return Ok(());
        }
    }
    conn.execute(alter_sql, []).map_err(sqlite_error)?;
    Ok(())
}

#[allow(dead_code)]
fn insert_wooden_box_receipt(
    path: &Path,
    wallet_address: &str,
    box_asset_address: &str,
    burn_signature: &str,
    verification_status: &str,
    pack_id: &str,
) -> io::Result<WoodenBoxReceiptView> {
    init_event_store(path)?;
    let conn = open_event_store(path)?;
    let now = now_millis() as i64;
    conn.execute(
        "INSERT INTO wooden_box_receipts
            (box_asset_address, owner_wallet_address, status, burn_signature,
             verification_status, metadata_uri, pack_id, created_at_ms, updated_at_ms)
         VALUES (?1, ?2, 'burned', ?3, ?4, NULL, ?5, ?6, ?6)",
        params![
            box_asset_address,
            wallet_address,
            burn_signature,
            verification_status,
            pack_id,
            now,
        ],
    )
    .map_err(sqlite_error)?;
    wooden_box_receipt_by_box(path, box_asset_address)?
        .ok_or_else(|| io::Error::other("wooden box receipt insert did not return a row"))
}

#[allow(dead_code)]
fn wooden_box_receipt_by_box(
    path: &Path,
    box_asset_address: &str,
) -> io::Result<Option<WoodenBoxReceiptView>> {
    init_event_store(path)?;
    let conn = open_event_store(path)?;
    conn.query_row(
        "SELECT box_asset_address, owner_wallet_address, status, burn_signature,
                verification_status, pack_id, created_at_ms, updated_at_ms
         FROM wooden_box_receipts
         WHERE box_asset_address = ?1",
        params![box_asset_address],
        |row| {
            Ok(WoodenBoxReceiptView {
                box_asset_address: row.get(0)?,
                owner_wallet_address: row.get(1)?,
                status: row.get(2)?,
                burn_signature: row.get(3)?,
                verification_status: row.get(4)?,
                pack_id: row.get(5)?,
                created_at_ms: row.get::<_, i64>(6)?.max(0) as u64,
                updated_at_ms: row.get::<_, i64>(7)?.max(0) as u64,
            })
        },
    )
    .optional()
    .map_err(sqlite_error)
}

#[allow(dead_code)]
fn wooden_box_receipt_by_pack(
    path: &Path,
    pack_id: &str,
) -> io::Result<Option<WoodenBoxReceiptView>> {
    init_event_store(path)?;
    let conn = open_event_store(path)?;
    conn.query_row(
        "SELECT box_asset_address, owner_wallet_address, status, burn_signature,
                verification_status, pack_id, created_at_ms, updated_at_ms
         FROM wooden_box_receipts
         WHERE pack_id = ?1",
        params![pack_id],
        |row| {
            Ok(WoodenBoxReceiptView {
                box_asset_address: row.get(0)?,
                owner_wallet_address: row.get(1)?,
                status: row.get(2)?,
                burn_signature: row.get(3)?,
                verification_status: row.get(4)?,
                pack_id: row.get(5)?,
                created_at_ms: row.get::<_, i64>(6)?.max(0) as u64,
                updated_at_ms: row.get::<_, i64>(7)?.max(0) as u64,
            })
        },
    )
    .optional()
    .map_err(sqlite_error)
}

#[allow(dead_code)]
fn mark_wooden_box_receipt_opened(path: &Path, pack_id: &str) -> io::Result<()> {
    init_event_store(path)?;
    let conn = open_event_store(path)?;
    conn.execute(
        "UPDATE wooden_box_receipts
         SET status = 'opened', updated_at_ms = ?2
         WHERE pack_id = ?1",
        params![pack_id, now_millis() as i64],
    )
    .map_err(sqlite_error)?;
    Ok(())
}
