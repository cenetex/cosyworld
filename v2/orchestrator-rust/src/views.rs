use super::*;
use serde::ser::SerializeStruct;

#[derive(Clone, Debug, Deserialize, Serialize)]
pub(super) struct EventView {
    #[serde(default = "official_world_id")]
    pub(super) world_id: String,
    #[serde(default = "official_world_epoch")]
    pub(super) world_epoch: u64,
    pub(super) seq: u64,
    #[serde(rename = "type")]
    pub(super) type_name: String,
    pub(super) success: bool,
    pub(super) reason: u16,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(super) actor_id: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(super) actor_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(super) target_actor_id: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(super) target_actor_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(super) location_id: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(super) location_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(super) destination_location_id: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(super) destination_location_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(super) content_id: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(super) content: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(super) item_id: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(super) item_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(super) target_item_id: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(super) target_item_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(super) raw_roll: Option<i16>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(super) modifier: Option<i16>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(super) total: Option<i16>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(super) dc: Option<i16>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(super) damage: Option<i16>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(super) current_hp: Option<i16>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(super) combat_method: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(super) ability: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(super) clock_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(super) clock_scope: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(super) clock_scope_id: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(super) clock_kind: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(super) clock_label: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(super) clock_filled: Option<u8>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(super) clock_segments: Option<u8>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(super) clock_delta: Option<i16>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(super) tag_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(super) tag_scope: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(super) tag_scope_id: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(super) tag_kind: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(super) tag_label: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(super) caused_by_event_seq: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(super) source_world_tick: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(super) observed_through_seq: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(super) source_location_id: Option<u64>,
    #[serde(default, skip_serializing_if = "content_reference_context_is_empty")]
    pub(super) content_context: ContentReferenceContext,
}

impl Serialize for RoomMemoryView {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        let mut out = serializer.serialize_struct("RoomMemoryView", 4)?;
        out.serialize_field("summary", &self.summary)?;
        if let Some(latest) = &self.latest {
            out.serialize_field("latest", latest)?;
        }
        out.serialize_field("recent", &self.recent)?;
        if let Some(latest_seq) = &self.latest_seq {
            out.serialize_field("latest_seq", latest_seq)?;
        }
        out.end()
    }
}

impl Serialize for RankedActionOffer {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        let presentation = action_card_presentation(self).map_err(serde::ser::Error::custom)?;
        let mut out = serializer.serialize_struct("RankedActionOffer", 23)?;
        out.serialize_field("id", &self.id)?;
        out.serialize_field("offer_id", &self.offer_id)?;
        out.serialize_field("composition_id", &self.composition_id)?;
        out.serialize_field("kind", &self.kind)?;
        out.serialize_field("intention", &self.intention)?;
        out.serialize_field("presentation", &presentation)?;
        if let Some(source) = &self.source_collectible {
            out.serialize_field(
                "source_collectible",
                &PublicActionSourceCollectibleView(source),
            )?;
        }
        if let Some(method) = &self.threshold_method {
            out.serialize_field("threshold_method", &PublicThresholdMethodView(method))?;
        }
        if let Some(discovery) = &self.discovery {
            out.serialize_field("discovery", &PublicDiscoveryOfferView(discovery))?;
        }
        out.serialize_field("verb", &self.verb)?;
        out.serialize_field("label", &self.label)?;
        out.serialize_field("accessible_label", &self.accessible_label)?;
        out.serialize_field("command", &self.command)?;
        out.serialize_field("rank", &self.rank)?;
        out.serialize_field("disabled", &self.disabled)?;
        if let Some(reason) = &self.disabled_reason {
            out.serialize_field("disabled_reason", reason)?;
        }
        out.serialize_field("provider", &PublicActionProviderView(&self.provider))?;
        if let Some(target) = &self.target {
            out.serialize_field("target", target)?;
        }
        if let Some(project) = &self.project {
            out.serialize_field("project", &PublicActionProjectView(project))?;
        }
        if let Some(cost) = &self.cost {
            out.serialize_field("cost", &PublicActionCostView(cost))?;
        }
        if let Some(risk) = &self.risk {
            out.serialize_field("risk", risk)?;
        }
        if let Some(effect) = &self.effect {
            out.serialize_field("effect", effect)?;
        }
        if let Some(progress) = &self.progress {
            out.serialize_field("progress", progress)?;
        }
        out.end()
    }
}

struct PublicThresholdMethodView<'a>(&'a ThresholdMethodOfferView);

impl Serialize for PublicThresholdMethodView<'_> {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        let value = self.0;
        let mut out = serializer.serialize_struct("ThresholdMethodOfferView", 7)?;
        out.serialize_field("descriptor_id", &value.descriptor_id)?;
        out.serialize_field("method_id", &value.method_id)?;
        out.serialize_field("method", &value.method)?;
        out.serialize_field("requirement", &value.requirement)?;
        out.serialize_field("economy", &value.economy)?;
        out.serialize_field("effect", &value.effect)?;
        out.serialize_field("consequence", &value.consequence)?;
        out.end()
    }
}

struct PublicDiscoveryOfferView<'a>(&'a DiscoveryOfferView);

impl Serialize for PublicDiscoveryOfferView<'_> {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        let value = self.0;
        let mut out = serializer.serialize_struct("DiscoveryOfferView", 5)?;
        out.serialize_field("procedure", &value.procedure)?;
        out.serialize_field("slot_id", &value.slot_id)?;
        out.serialize_field("receipt_id", &value.receipt_id)?;
        out.serialize_field("target_kind", &value.target_kind)?;
        out.serialize_field("resolution", &value.resolution)?;
        out.end()
    }
}

struct PublicActionSourceCollectibleView<'a>(&'a ActionSourceCollectibleView);

impl Serialize for PublicActionSourceCollectibleView<'_> {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        let mut out = serializer.serialize_struct("ActionSourceCollectibleView", 2)?;
        out.serialize_field("kind", &self.0.kind)?;
        out.serialize_field("instance_id", &self.0.instance_id)?;
        out.end()
    }
}

struct PublicActionProviderView<'a>(&'a ActionProviderView);

impl Serialize for PublicActionProviderView<'_> {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        let mut out = serializer.serialize_struct("ActionProviderView", 4)?;
        out.serialize_field("kind", &self.0.kind)?;
        out.serialize_field("id", &self.0.id)?;
        out.serialize_field("reason", &self.0.reason)?;
        out.serialize_field("priority", &self.0.priority)?;
        out.end()
    }
}

impl Serialize for ActionHandView {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        let mut out = serializer.serialize_struct("ActionHandView", 7)?;
        out.serialize_field("schema_version", &self.schema_version)?;
        out.serialize_field("capacity", &self.capacity)?;
        out.serialize_field("noun_queue_size", &self.deck_size)?;
        out.serialize_field("think_available", &self.draw_available)?;
        out.serialize_field("generation", &self.generation)?;
        out.serialize_field("pass", &self.pass)?;
        out.serialize_field("entries", &self.entries)?;
        out.end()
    }
}

impl Serialize for ActionHandPassView {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        let mut out = serializer.serialize_struct("ActionHandPassView", 10)?;
        out.serialize_field("offer_id", &self.offer_id)?;
        out.serialize_field("label", &self.label)?;
        out.serialize_field("state_revision", &self.state_revision)?;
        out.serialize_field("scene_key", &self.scene_key)?;
        out.serialize_field("slot", &self.slot)?;
        out.serialize_field("replaces_offer_id", &self.replaces_offer_id)?;
        out.serialize_field("free", &self.free)?;
        out.serialize_field("consumes_turn", &self.consumes_turn)?;
        out.serialize_field("generation", &self.generation)?;
        out.serialize_field("available", &self.available)?;
        out.end()
    }
}

impl Serialize for ActionHandEntryView {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        let mut out = serializer.serialize_struct("ActionHandEntryView", 9)?;
        out.serialize_field("card_id", &self.card_id)?;
        out.serialize_field("slot", &self.slot)?;
        out.serialize_field("card_type", &self.card_type)?;
        out.serialize_field("entity_kind", &self.entity_kind)?;
        out.serialize_field("entity_id", &self.entity_id)?;
        out.serialize_field("label", &self.label)?;
        out.serialize_field("offer_ids", &self.offer_ids)?;
        out.serialize_field("think", &self.think)?;
        out.serialize_field("replacement_count", &self.replacement_count)?;
        out.end()
    }
}

struct PublicActionProjectView<'a>(&'a ActionProjectView);

impl Serialize for PublicActionProjectView<'_> {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        let value = self.0;
        let mut out = serializer.serialize_struct("ActionProjectView", 8)?;
        out.serialize_field("id", &value.id)?;
        out.serialize_field("verb", &value.verb)?;
        out.serialize_field("label", &value.label)?;
        out.serialize_field("summary", &value.summary)?;
        out.serialize_field("progress_clock_id", &value.progress_clock_id)?;
        if let Some(strategy_id) = &value.strategy_id {
            out.serialize_field("strategy_id", strategy_id)?;
        }
        if let Some(strategy_label) = &value.strategy_label {
            out.serialize_field("strategy_label", strategy_label)?;
        }
        if let Some(resolution) = &value.resolution {
            out.serialize_field("resolution", resolution)?;
        }
        out.end()
    }
}

impl Serialize for ActionTargetView {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        let mut out = serializer.serialize_struct("ActionTargetView", 3)?;
        out.serialize_field("kind", &self.kind)?;
        if let Some(id) = &self.id {
            out.serialize_field("id", id)?;
        }
        if let Some(label) = &self.label {
            out.serialize_field("label", label)?;
        }
        out.end()
    }
}

struct PublicActionCostView<'a>(&'a ActionCostView);

impl Serialize for PublicActionCostView<'_> {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        let mut out = serializer.serialize_struct("ActionCostView", 2)?;
        out.serialize_field("orbs", &self.0.orbs)?;
        out.serialize_field("reason", &self.0.reason)?;
        out.end()
    }
}

impl Default for EventView {
    fn default() -> Self {
        Self {
            world_id: official_world_id(),
            world_epoch: official_world_epoch(),
            seq: 0,
            type_name: String::new(),
            success: false,
            reason: 0,
            actor_id: None,
            actor_name: None,
            target_actor_id: None,
            target_actor_name: None,
            location_id: None,
            location_name: None,
            destination_location_id: None,
            destination_location_name: None,
            content_id: None,
            content: None,
            item_id: None,
            item_name: None,
            target_item_id: None,
            target_item_name: None,
            raw_roll: None,
            modifier: None,
            total: None,
            dc: None,
            damage: None,
            current_hp: None,
            combat_method: None,
            ability: None,
            clock_id: None,
            clock_scope: None,
            clock_scope_id: None,
            clock_kind: None,
            clock_label: None,
            clock_filled: None,
            clock_segments: None,
            clock_delta: None,
            tag_id: None,
            tag_scope: None,
            tag_scope_id: None,
            tag_kind: None,
            tag_label: None,
            caused_by_event_seq: None,
            source_world_tick: None,
            observed_through_seq: None,
            source_location_id: None,
            content_context: ContentReferenceContext::default(),
        }
    }
}

impl EventView {}

#[derive(Clone, Debug, Serialize)]
pub(super) struct JourneyView {
    pub(super) origin_location_id: u64,
    pub(super) origin_name: String,
    pub(super) destination_location_id: u64,
    pub(super) destination_name: String,
    pub(super) way_class: PathwayWayClass,
    pub(super) way_name: String,
    pub(super) current_step: usize,
    pub(super) total_steps: usize,
    pub(super) steps_remaining: usize,
    pub(super) on_pathway: bool,
    pub(super) explorer: bool,
    pub(super) previous_location_id: Option<u64>,
    pub(super) previous_location_name: Option<String>,
    pub(super) next_location_id: Option<u64>,
    pub(super) next_location_name: Option<String>,
}

#[allow(dead_code)]
#[derive(Clone, Debug)]
pub(super) struct FirstTaleView {
    pub(super) schema_version: u8,
    pub(super) phase: String,
    pub(super) phase_exposure_id: String,
    pub(super) state_revision: u64,
    pub(super) phase_source_event_seq: u64,
    pub(super) lead_location_id: u64,
    pub(super) destination_location_id: u64,
    pub(super) job_id: String,
    pub(super) progress_clock_id: String,
    pub(super) required_location_id: Option<u64>,
    pub(super) advancing_offer_id: Option<String>,
    pub(super) question: String,
    pub(super) instruction: String,
    pub(super) target_label: String,
    pub(super) consequence: String,
    pub(super) completion_memory: String,
    pub(super) next_invitation: String,
    pub(super) public_trace_created: bool,
    pub(super) presentation: Option<FirstTalePresentation>,
    pub(super) recognition: Option<String>,
    pub(super) shared_progress: u8,
    pub(super) shared_goal: u8,
    pub(super) trace_event_seq: Option<u64>,
    pub(super) continuation: Option<FirstTaleContinuationView>,
}

impl Serialize for FirstTaleView {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        let mut out = serializer.serialize_struct("FirstTaleView", 15)?;
        out.serialize_field("phase", &self.phase)?;
        out.serialize_field("phase_exposure_id", &self.phase_exposure_id)?;
        out.serialize_field("state_revision", &self.state_revision)?;
        out.serialize_field("lead_location_id", &self.lead_location_id)?;
        out.serialize_field("destination_location_id", &self.destination_location_id)?;
        out.serialize_field("job_id", &self.job_id)?;
        out.serialize_field("progress_clock_id", &self.progress_clock_id)?;
        out.serialize_field("required_location_id", &self.required_location_id)?;
        out.serialize_field("advancing_offer_id", &self.advancing_offer_id)?;
        out.serialize_field("question", &self.question)?;
        out.serialize_field("consequence", &self.consequence)?;
        out.serialize_field("presentation", &self.presentation)?;
        out.serialize_field("recognition", &self.recognition)?;
        out.serialize_field("shared_progress", &self.shared_progress)?;
        out.serialize_field("shared_goal", &self.shared_goal)?;
        out.serialize_field("instruction", &self.instruction)?;
        out.serialize_field("completion_memory", &self.completion_memory)?;
        out.serialize_field("next_invitation", &self.next_invitation)?;
        out.serialize_field("trace_event_seq", &self.trace_event_seq)?;
        if let Some(continuation) = &self.continuation {
            out.serialize_field("continuation", continuation)?;
        }
        out.end()
    }
}

#[allow(dead_code)]
#[derive(Clone, Debug)]
pub(super) struct FirstTaleContinuationView {
    pub(super) destination_location_id: u64,
    pub(super) target_actor_id: u64,
    pub(super) job_id: String,
    pub(super) phase: String,
    pub(super) instruction: String,
    pub(super) required_location_id: Option<u64>,
    pub(super) advancing_offer_id: Option<String>,
}

impl Serialize for FirstTaleContinuationView {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        let mut out = serializer.serialize_struct("FirstTaleContinuationView", 6)?;
        out.serialize_field("destination_location_id", &self.destination_location_id)?;
        out.serialize_field("target_actor_id", &self.target_actor_id)?;
        out.serialize_field("phase", &self.phase)?;
        out.serialize_field("instruction", &self.instruction)?;
        out.serialize_field("required_location_id", &self.required_location_id)?;
        out.serialize_field("advancing_offer_id", &self.advancing_offer_id)?;
        out.end()
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub(super) enum JournalBeatCategory {
    Story,
    Discovery,
    Travel,
    Search,
    Relationship,
    Growth,
    Work,
    Item,
    Consequence,
}

#[allow(dead_code)]
#[derive(Clone, Debug, Eq, PartialEq)]
pub(super) struct JournalBeatView {
    pub(super) id: String,
    pub(super) source_event_seqs: Vec<u64>,
    pub(super) category: JournalBeatCategory,
    pub(super) headline: String,
    pub(super) location_id: u64,
    pub(super) ordering_seq: u64,
    pub(super) world_beat_exposure_id: Option<String>,
}

impl Serialize for JournalBeatView {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        let mut out = serializer.serialize_struct("JournalBeatView", 5)?;
        out.serialize_field("source_event_seqs", &self.source_event_seqs)?;
        out.serialize_field("category", &self.category)?;
        out.serialize_field("headline", &self.headline)?;
        out.serialize_field("ordering_seq", &self.ordering_seq)?;
        if let Some(exposure_id) = &self.world_beat_exposure_id {
            out.serialize_field("world_beat_exposure_id", exposure_id)?;
        }
        out.end()
    }
}

#[derive(Clone, Debug, Serialize)]
pub(super) struct CommandContextView {
    pub(super) actor_ref: String,
    pub(super) actor_version: u64,
    pub(super) location_version: u64,
}

#[allow(dead_code)]
#[derive(Debug)]
pub(super) struct StateResponse {
    pub(super) avatar_autonomy: Option<avatar_autonomy::AvatarAutonomyView>,
    pub(super) world_id: String,
    pub(super) world_epoch: u64,
    pub(super) world_seq: u64,
    pub(super) room_event_seq: u64,
    pub(super) state_revision: u64,
    pub(super) command_context: Option<CommandContextView>,
    pub(super) rules_context: Option<SceneRulesContextView>,
    pub(super) spatial_scene: Option<SpatialSceneView>,
    pub(super) location: LocationView,
    pub(super) exits: Vec<ExitView>,
    pub(super) actors: Vec<ActorView>,
    pub(super) items: Vec<ItemView>,
    // These internal projections remain available to Rust-side invariant tests;
    // clients receive the explicitly named visible projection below.
    #[allow(dead_code)]
    pub(super) factions: Vec<FactionView>,
    pub(super) room_features: Vec<RoomFeatureView>,
    pub(super) scene_notices: Vec<DiscoverySceneNoticeView>,
    pub(super) search_available: bool,
    pub(super) clocks: Vec<ClockView>,
    pub(super) shared_questions: Vec<SharedQuestionView>,
    pub(super) tags: Vec<TagView>,
    pub(super) jobs: Vec<JobView>,
    pub(super) fronts: Vec<FrontView>,
    pub(super) room_sheet: Option<RoomSheetView>,
    pub(super) journey: Option<JourneyView>,
    pub(super) first_tale: Option<FirstTaleView>,
    pub(super) calling: Option<CallingView>,
    pub(super) skills: Vec<SkillView>,
    pub(super) ledger: VisitLedgerView,
    pub(super) goals: Vec<EntityGoalState>,
    pub(super) bonds: Vec<BondView>,
    pub(super) chat_bond_claimed_target_ids: Vec<u64>,
    pub(super) cards: CardRegistryView,
    #[allow(dead_code)]
    pub(super) card_transactions: Vec<CardTransactionView>,
    pub(super) account: AccountView,
    pub(super) economy: EconomyView,
    pub(super) deck: DeckView,
    pub(super) combat: Option<CombatView>,
    pub(super) turn: RoomTurnView,
    pub(super) branch: Option<BranchView>,
    pub(super) safety: ActorSafetyView,
    // The current-state endpoint must not resend room history on every
    // projection refresh. Keep it available for server-side memory assembly;
    // clients load the same bounded, visibility-filtered history from /events.
    pub(super) recent_events: Vec<EventView>,
    pub(super) journal_beats: Vec<JournalBeatView>,
    pub(super) journal: DailyJournalView,
    pub(super) room_memory: RoomMemoryView,
    #[allow(dead_code)]
    pub(super) primary_action: PrimaryAction,
    pub(super) visible_primary_action: PrimaryAction,
    #[allow(dead_code)]
    pub(super) action_offers: Vec<RankedActionOffer>,
    pub(super) visible_action_offers: Vec<RankedActionOffer>,
    pub(super) action_hand: ActionHandView,
    pub(super) inspector: InspectorView,
    pub(super) character_creation: Vec<CharacterCreationProfileView>,
    pub(super) character_identity: Option<CharacterIdentityView>,
}

// `/state` is a browser capability, not a dump of RuntimeWorld's projections.
// Keep this allowlist explicit: adding an internal field above must never make
// it public unless it is deliberately added here as something the UI renders
// or submits.
impl Serialize for StateResponse {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        let mut out = serializer.serialize_struct("StateResponse", 36)?;
        if let Some(value) = &self.avatar_autonomy {
            out.serialize_field("avatar_autonomy", value)?;
        }
        out.serialize_field("world_id", &self.world_id)?;
        out.serialize_field("world_epoch", &self.world_epoch)?;
        out.serialize_field("world_seq", &self.world_seq)?;
        out.serialize_field("room_event_seq", &self.room_event_seq)?;
        out.serialize_field("state_revision", &self.state_revision)?;
        if let Some(value) = &self.command_context {
            out.serialize_field("command_context", value)?;
        }
        if let Some(value) = &self.spatial_scene {
            out.serialize_field("spatial_scene", value)?;
        }
        out.serialize_field("location", &self.location)?;
        out.serialize_field("exits", &self.exits)?;
        out.serialize_field("actors", &self.actors)?;
        out.serialize_field("items", &self.items)?;
        out.serialize_field("room_features", &self.room_features)?;
        out.serialize_field("scene_notices", &self.scene_notices)?;
        out.serialize_field("search_available", &self.search_available)?;
        out.serialize_field("clocks", &self.clocks)?;
        out.serialize_field("shared_questions", &self.shared_questions)?;
        out.serialize_field("tags", &self.tags)?;
        out.serialize_field("jobs", &self.jobs)?;
        out.serialize_field("fronts", &self.fronts)?;
        if let Some(value) = &self.room_sheet {
            out.serialize_field("room_sheet", &PublicRoomSheetView(value))?;
        }
        if let Some(value) = &self.journey {
            out.serialize_field("journey", value)?;
        }
        if let Some(value) = &self.first_tale {
            out.serialize_field("first_tale", value)?;
        }
        if let Some(value) = &self.calling {
            out.serialize_field("calling", value)?;
        }
        out.serialize_field("skills", &self.skills)?;
        out.serialize_field("ledger", &self.ledger)?;
        out.serialize_field("bonds", &self.bonds)?;
        out.serialize_field("cards", &self.cards)?;
        out.serialize_field("economy", &self.economy)?;
        out.serialize_field("deck", &self.deck)?;
        if let Some(value) = &self.combat {
            out.serialize_field("combat", value)?;
        }
        out.serialize_field("turn", &self.turn)?;
        if let Some(value) = &self.branch {
            out.serialize_field("branch", value)?;
        }
        out.serialize_field("safety", &PublicActorSafetyView(&self.safety))?;
        out.serialize_field("journal", &self.journal)?;
        out.serialize_field("room_memory", &self.room_memory)?;
        out.serialize_field("primary_action", &self.visible_primary_action)?;
        out.serialize_field("action_offers", &self.visible_action_offers)?;
        out.serialize_field("action_hand", &self.action_hand)?;
        out.serialize_field("character_creation", &self.character_creation)?;
        if let Some(value) = &self.character_identity {
            out.serialize_field("character_identity", value)?;
        }
        out.end()
    }
}

#[derive(Clone, Debug, Serialize)]
pub(super) struct CombatView {
    pub(super) protocol: &'static str,
    pub(super) concurrency_policy: &'static str,
    pub(super) turn_rule: &'static str,
    pub(super) encounter_id: u64,
    pub(super) location_id: u64,
    pub(super) round: u16,
    pub(super) current_actor_id: u64,
    pub(super) current_actor_name: Option<String>,
    pub(super) is_current_actor: bool,
    pub(super) available_actions: Vec<&'static str>,
    pub(super) grace_period_ms: u64,
    pub(super) need_time_extension_ms: u64,
    pub(super) can_pass: bool,
    pub(super) can_need_time: bool,
    pub(super) participants: Vec<CombatParticipantView>,
}

#[derive(Clone, Debug, Serialize)]
pub(super) struct CombatParticipantView {
    pub(super) actor_id: u64,
    pub(super) actor_name: Option<String>,
    pub(super) side: u8,
    pub(super) initiative: i16,
    pub(super) status: &'static str,
    pub(super) current_hp: i16,
    pub(super) max_hp: i16,
    pub(super) dodging: bool,
    pub(super) unconscious: bool,
    pub(super) escaped: bool,
}

#[allow(dead_code)]
#[derive(Debug)]
pub(super) struct EconomyView {
    pub(super) orbs: i32,
    pub(super) chat_cost_orbs: i32,
    pub(super) can_chat_with_orbs: bool,
    pub(super) inventory_count: usize,
    pub(super) inventory_capacity: usize,
    pub(super) carried_weight_tenths: u32,
    pub(super) base_carrying_capacity_tenths: u32,
    pub(super) container_capacity_tenths: u32,
    pub(super) carrying_capacity_tenths: u32,
    pub(super) encumbered: bool,
    pub(super) listen_cost_orbs: i32,
    pub(super) listen_reward_claimable: bool,
    pub(super) listen_attempted_here: bool,
    pub(super) openrouter_connected: bool,
    pub(super) chat_payer: String,
}

impl Serialize for EconomyView {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        let mut out = serializer.serialize_struct("EconomyView", 4)?;
        out.serialize_field("orbs", &self.orbs)?;
        out.serialize_field("carried_weight_tenths", &self.carried_weight_tenths)?;
        out.serialize_field("carrying_capacity_tenths", &self.carrying_capacity_tenths)?;
        out.serialize_field("listen_attempted_here", &self.listen_attempted_here)?;
        out.end()
    }
}

#[allow(dead_code)]
#[derive(Debug)]
pub(super) struct DeckView {
    pub(super) actor_id: Option<u64>,
    pub(super) carried_cards: Vec<ItemView>,
    pub(super) carried_weight_tenths: u32,
    pub(super) base_carrying_capacity_tenths: u32,
    pub(super) container_capacity_tenths: u32,
    pub(super) carrying_capacity_tenths: u32,
    pub(super) bracelet_slots: u8,
    pub(super) equipped_charms: Vec<ItemView>,
    pub(super) available_charms: Vec<ItemView>,
    pub(super) charm_slot_expansion: Option<CharmSlotExpansionView>,
    pub(super) spell_cards: Vec<ItemView>,
    pub(super) prepared_spell_cards: Vec<ItemView>,
    pub(super) exhausted_spell_cards: Vec<ItemView>,
    pub(super) exhausted_cards: Vec<ItemView>,
    pub(super) spell_deck_slots: u8,
    pub(super) equipped_weapon: Option<ItemView>,
    pub(super) equipped_containers: Vec<ItemView>,
    pub(super) containers: Vec<ContainerDeckView>,
    pub(super) zone_counts: BTreeMap<String, usize>,
    pub(super) validation_errors: Vec<String>,
    pub(super) bag_previews: Vec<String>,
}

impl Serialize for DeckView {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        let mut out = serializer.serialize_struct("DeckView", 20)?;
        out.serialize_field("actor_id", &self.actor_id)?;
        out.serialize_field("carried_cards", &self.carried_cards)?;
        out.serialize_field("carried_weight_tenths", &self.carried_weight_tenths)?;
        out.serialize_field(
            "base_carrying_capacity_tenths",
            &self.base_carrying_capacity_tenths,
        )?;
        out.serialize_field("container_capacity_tenths", &self.container_capacity_tenths)?;
        out.serialize_field("carrying_capacity_tenths", &self.carrying_capacity_tenths)?;
        out.serialize_field("bracelet_slots", &self.bracelet_slots)?;
        out.serialize_field("equipped_charms", &self.equipped_charms)?;
        out.serialize_field("available_charms", &self.available_charms)?;
        out.serialize_field("charm_slot_expansion", &self.charm_slot_expansion)?;
        out.serialize_field("spell_cards", &self.spell_cards)?;
        out.serialize_field("prepared_spell_cards", &self.prepared_spell_cards)?;
        out.serialize_field("exhausted_spell_cards", &self.exhausted_spell_cards)?;
        out.serialize_field("exhausted_cards", &self.exhausted_cards)?;
        out.serialize_field("spell_deck_slots", &self.spell_deck_slots)?;
        out.serialize_field("equipped_weapon", &self.equipped_weapon)?;
        out.serialize_field("equipped_containers", &self.equipped_containers)?;
        out.serialize_field("containers", &self.containers)?;
        out.serialize_field("validation_errors", &self.validation_errors)?;
        out.serialize_field("bag_previews", &self.bag_previews)?;
        out.end()
    }
}

#[derive(Debug, Serialize)]
pub(super) struct CharmSlotExpansionView {
    pub(super) charm: ItemView,
    pub(super) label: String,
    pub(super) explanation: String,
    pub(super) advancement_cost: u8,
}

#[allow(dead_code)]
#[derive(Debug)]
pub(super) struct ContainerDeckView {
    pub(super) container: ItemView,
    pub(super) contents: Vec<ItemView>,
    pub(super) opening_size: String,
    pub(super) allowed_contents: Vec<String>,
    pub(super) equipped: bool,
    pub(super) active_capacity_tenths: u16,
}

impl Serialize for ContainerDeckView {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        let mut out = serializer.serialize_struct("ContainerDeckView", 4)?;
        out.serialize_field("container", &self.container)?;
        out.serialize_field("contents", &self.contents)?;
        out.serialize_field("opening_size", &self.opening_size)?;
        out.serialize_field("equipped", &self.equipped)?;
        out.end()
    }
}

#[allow(dead_code)]
#[derive(Clone, Debug)]
pub(super) struct LocationSimulationView {
    pub(super) weather: String,
    pub(super) weather_intensity: u8,
    pub(super) trade_stock: i16,
    pub(super) trade_pressure: i8,
    pub(super) imports: BTreeMap<String, u8>,
    pub(super) conflict_pressure: u8,
    pub(super) faction_influence: Vec<FactionInfluenceView>,
    pub(super) last_pulse_tick: u64,
}

impl Serialize for LocationSimulationView {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        let mut out = serializer.serialize_struct("LocationSimulationView", 6)?;
        out.serialize_field("weather", &self.weather)?;
        out.serialize_field("trade_pressure", &self.trade_pressure)?;
        out.serialize_field("imports", &self.imports)?;
        out.serialize_field("conflict_pressure", &self.conflict_pressure)?;
        out.serialize_field("faction_influence", &self.faction_influence)?;
        out.serialize_field("last_pulse_tick", &self.last_pulse_tick)?;
        out.end()
    }
}

#[derive(Clone, Debug, Serialize)]
pub(super) struct FactionInfluenceView {
    pub(super) faction_id: String,
    pub(super) faction_name: String,
    pub(super) influence: u8,
}

#[allow(dead_code)]
#[derive(Clone, Debug)]
pub(super) struct LocationView {
    pub(super) id: u64,
    pub(super) canonical_ref: String,
    pub(super) entity_version: u64,
    pub(super) pack_id: Option<String>,
    pub(super) name: String,
    pub(super) title: String,
    pub(super) description: String,
    pub(super) persona: String,
    pub(super) memory: Vec<String>,
    pub(super) interior_view: Option<InteriorViewMode>,
    pub(super) factions: Vec<FactionRefView>,
    pub(super) simulation: LocationSimulationView,
}

impl Serialize for LocationView {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        let mut out = serializer.serialize_struct("LocationView", 4)?;
        out.serialize_field("id", &self.id)?;
        out.serialize_field("name", &self.name)?;
        out.serialize_field("description", &self.description)?;
        out.serialize_field("simulation", &self.simulation)?;
        out.end()
    }
}

#[derive(Clone, Debug, Serialize)]
pub(super) struct FactionRefView {
    pub(super) id: String,
    pub(super) name: String,
    pub(super) axis: String,
    pub(super) player_facing: bool,
}

#[derive(Clone, Debug, Serialize)]
pub(super) struct FactionView {
    pub(super) id: String,
    pub(super) name: String,
    pub(super) axis: String,
    pub(super) opposes: Vec<String>,
    pub(super) truth: String,
    pub(super) shadow: String,
    pub(super) doctrine: String,
    pub(super) verbs: Vec<String>,
    pub(super) motif: Vec<String>,
    pub(super) home_location_ids: Vec<u64>,
    pub(super) player_facing: bool,
    pub(super) member_actor_ids: Vec<u64>,
}

#[derive(Debug)]
pub(super) struct ExitView {
    pub(super) route_id: String,
    pub(super) route_version: u64,
    pub(super) destination_location_id: u64,
    pub(super) destination_location_name: String,
    pub(super) route_label: String,
    pub(super) direction: Option<String>,
    pub(super) distance: u8,
    pub(super) locked: bool,
    pub(super) accessible: bool,
    pub(super) threshold: Option<ThresholdOfferBinding>,
}

impl Serialize for ExitView {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        let mut out = serializer.serialize_struct("ExitView", 6)?;
        out.serialize_field("destination_location_id", &self.destination_location_id)?;
        out.serialize_field("destination_location_name", &self.destination_location_name)?;
        out.serialize_field("route_label", &self.route_label)?;
        out.serialize_field("distance", &self.distance)?;
        out.serialize_field("locked", &self.locked)?;
        out.serialize_field("accessible", &self.accessible)?;
        out.end()
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize)]
pub(super) struct ExpeditionRingView {
    pub(super) filled_count: u8,
    pub(super) pip_total: u8,
    pub(super) needs_rest: bool,
}

#[allow(dead_code)]
#[derive(Debug)]
pub(super) struct ActorView {
    pub(super) id: u64,
    pub(super) canonical_ref: String,
    pub(super) entity_version: u64,
    pub(super) pack_id: Option<String>,
    pub(super) name: String,
    pub(super) title: String,
    pub(super) description: String,
    pub(super) practice: Option<ActorPracticeView>,
    pub(super) control_mode: ActorControlMode,
    pub(super) kind: String,
    pub(super) status: String,
    pub(super) speech_mode: String,
    pub(super) speech_available: bool,
    pub(super) muted_by_you: bool,
    pub(super) blocked_by_you: bool,
    pub(super) location_id: u64,
    pub(super) relationship: Option<RelationshipPreviewView>,
    pub(super) factions: Vec<FactionRefView>,
    pub(super) resident_economy: Option<ResidentEconomyView>,
    pub(super) expedition_ring: ExpeditionRingView,
    pub(super) hp: i16,
    pub(super) bloodied: bool,
    pub(super) stats: StatView,
}

impl Serialize for ActorView {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        let mut out = serializer.serialize_struct("ActorView", 17)?;
        out.serialize_field("id", &self.id)?;
        out.serialize_field("name", &self.name)?;
        out.serialize_field("title", &self.title)?;
        out.serialize_field("description", &self.description)?;
        out.serialize_field("practice", &self.practice)?;
        out.serialize_field("control_mode", &self.control_mode)?;
        out.serialize_field("kind", &self.kind)?;
        out.serialize_field("status", &self.status)?;
        out.serialize_field("speech_available", &self.speech_available)?;
        out.serialize_field("muted_by_you", &self.muted_by_you)?;
        out.serialize_field("blocked_by_you", &self.blocked_by_you)?;
        out.serialize_field("location_id", &self.location_id)?;
        if let Some(value) = &self.relationship {
            out.serialize_field("relationship", value)?;
        }
        if let Some(value) = &self.resident_economy {
            out.serialize_field("economy", value)?;
        }
        out.serialize_field("expedition_ring", &self.expedition_ring)?;
        out.serialize_field("hp", &self.hp)?;
        out.serialize_field("stats", &PublicStatView(&self.stats))?;
        out.end()
    }
}

#[derive(Clone, Debug, Default, Serialize)]
pub(super) struct ActorSafetyView {
    pub(super) muted_actor_ids: Vec<u64>,
    pub(super) blocked_actor_ids: Vec<u64>,
    pub(super) incoming_offers: Vec<TransferOfferView>,
    pub(super) outgoing_offers: Vec<TransferOfferView>,
    pub(super) gift_auto_accepts: Vec<GiftAutoAcceptView>,
}

struct PublicActorSafetyView<'a>(&'a ActorSafetyView);

impl Serialize for PublicActorSafetyView<'_> {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        let incoming = self
            .0
            .incoming_offers
            .iter()
            .map(PublicTransferOfferView)
            .collect::<Vec<_>>();
        let outgoing = self
            .0
            .outgoing_offers
            .iter()
            .map(PublicTransferOfferView)
            .collect::<Vec<_>>();
        let gift_auto_accepts = self
            .0
            .gift_auto_accepts
            .iter()
            .map(PublicGiftAutoAcceptView)
            .collect::<Vec<_>>();
        let mut out = serializer.serialize_struct("ActorSafetyView", 4)?;
        out.serialize_field("muted_actor_ids", &self.0.muted_actor_ids)?;
        out.serialize_field("incoming_offers", &incoming)?;
        out.serialize_field("outgoing_offers", &outgoing)?;
        out.serialize_field("gift_auto_accepts", &gift_auto_accepts)?;
        out.end()
    }
}

#[derive(Clone, Debug, Serialize)]
pub(super) struct TransferOfferView {
    pub(super) id: String,
    pub(super) kind: TransferOfferKind,
    pub(super) offered_by_actor_id: u64,
    pub(super) offered_by_actor_name: String,
    pub(super) offered_to_actor_id: u64,
    pub(super) offered_to_actor_name: String,
    pub(super) offered_item_id: u64,
    pub(super) offered_item_name: String,
    pub(super) requested_item_id: Option<u64>,
    pub(super) requested_item_name: Option<String>,
    pub(super) expires_tick: u64,
    pub(super) can_accept: bool,
    pub(super) can_decline: bool,
    pub(super) can_withdraw: bool,
}

struct PublicTransferOfferView<'a>(&'a TransferOfferView);

impl Serialize for PublicTransferOfferView<'_> {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        let mut out = serializer.serialize_struct("TransferOfferView", 6)?;
        out.serialize_field("id", &self.0.id)?;
        out.serialize_field("kind", &self.0.kind)?;
        out.serialize_field("offered_by_actor_id", &self.0.offered_by_actor_id)?;
        out.serialize_field("offered_to_actor_id", &self.0.offered_to_actor_id)?;
        out.serialize_field("offered_item_name", &self.0.offered_item_name)?;
        if let Some(item_name) = &self.0.requested_item_name {
            out.serialize_field("requested_item_name", item_name)?;
        }
        out.end()
    }
}

#[derive(Clone, Debug, Serialize)]
pub(super) struct GiftAutoAcceptView {
    pub(super) id: String,
    pub(super) offered_by_actor_id: u64,
    pub(super) offered_by_actor_name: String,
    pub(super) item_id: u64,
    pub(super) item_name: String,
    pub(super) expires_tick: u64,
}

struct PublicGiftAutoAcceptView<'a>(&'a GiftAutoAcceptView);

impl Serialize for PublicGiftAutoAcceptView<'_> {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        let mut out = serializer.serialize_struct("GiftAutoAcceptView", 2)?;
        out.serialize_field("offered_by_actor_id", &self.0.offered_by_actor_id)?;
        out.serialize_field("item_id", &self.0.item_id)?;
        out.end()
    }
}

#[allow(dead_code)]
#[derive(Clone, Debug)]
pub(super) struct ResidentEconomyView {
    pub(super) held_item_ids: Vec<u64>,
    pub(super) held_items: Vec<ResidentHeldItemView>,
    pub(super) inventory_count: usize,
    pub(super) inventory_capacity: usize,
    pub(super) carried_weight_tenths: u32,
    pub(super) carrying_capacity_tenths: u32,
    pub(super) desired_item_ids: Vec<u64>,
    pub(super) sought_item_ids: Vec<u64>,
    pub(super) sought_items: Vec<ResidentSoughtItemView>,
    pub(super) attached_item_ids: Vec<u64>,
    pub(super) seeking_item_id: Option<u64>,
    pub(super) seeking_location_id: Option<u64>,
    pub(super) seeking_location_name: Option<String>,
    pub(super) request: Option<ResidentRequestView>,
    pub(super) trade_offer: Option<ResidentTradeOfferView>,
    pub(super) trade_stance: Option<ResidentTradeStanceView>,
    pub(super) motive: String,
}

impl Serialize for ResidentEconomyView {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        let mut out = serializer.serialize_struct("ResidentEconomyView", 9)?;
        out.serialize_field("held_items", &self.held_items)?;
        out.serialize_field("inventory_count", &self.inventory_count)?;
        out.serialize_field("carried_weight_tenths", &self.carried_weight_tenths)?;
        out.serialize_field("carrying_capacity_tenths", &self.carrying_capacity_tenths)?;
        out.serialize_field("sought_items", &self.sought_items)?;
        if let Some(value) = &self.request {
            out.serialize_field("request", value)?;
        }
        if let Some(value) = &self.trade_offer {
            out.serialize_field("trade_offer", value)?;
        }
        if let Some(value) = &self.trade_stance {
            out.serialize_field("trade_stance", value)?;
        }
        out.serialize_field("motive", &self.motive)?;
        out.end()
    }
}

#[allow(dead_code)]
#[derive(Clone, Debug)]
pub(super) struct ResidentHeldItemView {
    pub(super) item_id: u64,
    pub(super) disposition: String,
    pub(super) reason: String,
    pub(super) keep_score: i16,
    pub(super) available_actions: Vec<String>,
}

impl Serialize for ResidentHeldItemView {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        let mut out = serializer.serialize_struct("ResidentHeldItemView", 4)?;
        out.serialize_field("item_id", &self.item_id)?;
        out.serialize_field("disposition", &self.disposition)?;
        out.serialize_field("reason", &self.reason)?;
        out.serialize_field("available_actions", &self.available_actions)?;
        out.end()
    }
}

#[allow(dead_code)]
#[derive(Clone, Debug)]
pub(super) struct ResidentSoughtItemView {
    pub(super) item_id: u64,
    pub(super) source: String,
    pub(super) reason: String,
    pub(super) world_status: String,
    pub(super) world_location_id: Option<u64>,
    pub(super) world_location_name: Option<String>,
    pub(super) world_holder_actor_id: Option<u64>,
    pub(super) world_holder_actor_name: Option<String>,
    pub(super) memory_location_id: Option<u64>,
    pub(super) memory_location_name: Option<String>,
    pub(super) holder_actor_id: Option<u64>,
    pub(super) holder_actor_name: Option<String>,
    pub(super) confidence: Option<u8>,
    pub(super) salience: Option<u8>,
}

impl Serialize for ResidentSoughtItemView {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        let mut out = serializer.serialize_struct("ResidentSoughtItemView", 7)?;
        out.serialize_field("item_id", &self.item_id)?;
        out.serialize_field("world_status", &self.world_status)?;
        out.serialize_field("world_location_name", &self.world_location_name)?;
        out.serialize_field("world_holder_actor_id", &self.world_holder_actor_id)?;
        out.serialize_field("world_holder_actor_name", &self.world_holder_actor_name)?;
        out.serialize_field("memory_location_name", &self.memory_location_name)?;
        out.serialize_field("holder_actor_name", &self.holder_actor_name)?;
        out.end()
    }
}

#[allow(dead_code)]
#[derive(Clone, Debug)]
pub(super) struct ResidentRequestView {
    pub(super) item_id: u64,
    pub(super) holder_actor_id: u64,
    pub(super) reason: String,
}

impl Serialize for ResidentRequestView {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        let mut out = serializer.serialize_struct("ResidentRequestView", 2)?;
        out.serialize_field("item_id", &self.item_id)?;
        out.serialize_field("reason", &self.reason)?;
        out.end()
    }
}

#[allow(dead_code)]
#[derive(Clone, Debug)]
pub(super) struct ResidentTradeOfferView {
    pub(super) offered_item_id: u64,
    pub(super) requested_item_id: u64,
    pub(super) willingness: String,
    pub(super) reason: String,
}

impl Serialize for ResidentTradeOfferView {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        let mut out = serializer.serialize_struct("ResidentTradeOfferView", 4)?;
        out.serialize_field("offered_item_id", &self.offered_item_id)?;
        out.serialize_field("requested_item_id", &self.requested_item_id)?;
        out.serialize_field("willingness", &self.willingness)?;
        out.serialize_field("reason", &self.reason)?;
        out.end()
    }
}

#[allow(dead_code)]
#[derive(Clone, Debug)]
pub(super) struct ResidentTradeStanceView {
    pub(super) offered_item_id: u64,
    pub(super) requested_item_id: u64,
    pub(super) willingness: String,
    pub(super) reason: String,
    pub(super) accepted: bool,
}

impl Serialize for ResidentTradeStanceView {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        let mut out = serializer.serialize_struct("ResidentTradeStanceView", 4)?;
        out.serialize_field("offered_item_id", &self.offered_item_id)?;
        out.serialize_field("requested_item_id", &self.requested_item_id)?;
        out.serialize_field("willingness", &self.willingness)?;
        out.serialize_field("reason", &self.reason)?;
        out.end()
    }
}

#[derive(Debug, Serialize)]
pub(super) struct StatView {
    pub(super) strength: i8,
    pub(super) dexterity: i8,
    pub(super) constitution: i8,
    pub(super) intelligence: i8,
    pub(super) wisdom: i8,
    pub(super) charisma: i8,
    pub(super) hp_base: i16,
    pub(super) level: u8,
}

struct PublicStatView<'a>(&'a StatView);

impl Serialize for PublicStatView<'_> {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        let mut out = serializer.serialize_struct("StatView", 2)?;
        out.serialize_field("hp_base", &self.0.hp_base)?;
        out.serialize_field("level", &self.0.level)?;
        out.end()
    }
}

#[allow(dead_code)]
#[derive(Debug)]
pub(super) struct ItemView {
    pub(super) id: u64,
    pub(super) canonical_ref: String,
    pub(super) entity_version: u64,
    pub(super) pack_id: Option<String>,
    pub(super) name: String,
    pub(super) description: String,
    pub(super) kind: String,
    pub(super) role: String,
    pub(super) weight_tenths: u16,
    pub(super) size: String,
    pub(super) container_capacity_tenths: u16,
    pub(super) container_contents_weight_tenths: u32,
    pub(super) container_remaining_capacity_tenths: u32,
    pub(super) transferable: bool,
    pub(super) theft_eligible: bool,
    pub(super) available_actions: Vec<&'static str>,
    pub(super) blocked_reason: Option<&'static str>,
    pub(super) skill_id: Option<String>,
    pub(super) skill_bonus: i8,
    pub(super) mechanics: Option<SeedPlayableItemMechanics>,
    pub(super) zone: String,
    pub(super) container_item_id: Option<u64>,
    pub(super) provenance: Option<ItemProvenanceState>,
    pub(super) location_id: Option<u64>,
    pub(super) holder_actor_id: Option<u64>,
    pub(super) charges: u8,
}

impl Serialize for ItemView {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        let mut out = serializer.serialize_struct("ItemView", 21)?;
        out.serialize_field("id", &self.id)?;
        out.serialize_field("name", &self.name)?;
        out.serialize_field("description", &self.description)?;
        out.serialize_field("kind", &self.kind)?;
        out.serialize_field("role", &self.role)?;
        out.serialize_field("weight_tenths", &self.weight_tenths)?;
        out.serialize_field("size", &self.size)?;
        out.serialize_field("container_capacity_tenths", &self.container_capacity_tenths)?;
        out.serialize_field(
            "container_contents_weight_tenths",
            &self.container_contents_weight_tenths,
        )?;
        out.serialize_field(
            "container_remaining_capacity_tenths",
            &self.container_remaining_capacity_tenths,
        )?;
        out.serialize_field("transferable", &self.transferable)?;
        out.serialize_field("theft_eligible", &self.theft_eligible)?;
        out.serialize_field("available_actions", &self.available_actions)?;
        out.serialize_field("blocked_reason", &self.blocked_reason)?;
        out.serialize_field("skill_id", &self.skill_id)?;
        out.serialize_field("skill_bonus", &self.skill_bonus)?;
        out.serialize_field("zone", &self.zone)?;
        out.serialize_field("container_item_id", &self.container_item_id)?;
        out.serialize_field("location_id", &self.location_id)?;
        out.serialize_field("holder_actor_id", &self.holder_actor_id)?;
        out.serialize_field("charges", &self.charges)?;
        out.end()
    }
}

#[derive(Debug, Serialize)]
pub(super) struct RoomFeatureView {
    pub(super) key: String,
    pub(super) name: String,
    pub(super) aliases: Vec<String>,
    pub(super) look: String,
    pub(super) search: String,
    pub(super) searched: bool,
    pub(super) uses: Vec<RoomFeatureUseView>,
}

#[derive(Debug, Serialize)]
pub(super) struct RoomFeatureUseView {
    pub(super) item_id: u64,
    pub(super) feature_key: String,
    pub(super) text: String,
    pub(super) used: bool,
    pub(super) effect: Option<String>,
}

#[allow(dead_code)]
#[derive(Debug)]
pub(super) struct ClockView {
    pub(super) id: String,
    pub(super) scope: String,
    pub(super) scope_id: u64,
    pub(super) kind: String,
    pub(super) zone: String,
    pub(super) label: String,
    pub(super) segments: u8,
    pub(super) filled: u8,
    pub(super) status: String,
}

impl Serialize for ClockView {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        let mut out = serializer.serialize_struct("ClockView", 4)?;
        out.serialize_field("id", &self.id)?;
        out.serialize_field("kind", &self.kind)?;
        out.serialize_field("segments", &self.segments)?;
        out.serialize_field("filled", &self.filled)?;
        out.end()
    }
}

#[derive(Debug, Serialize)]
pub(super) struct SharedQuestionStrategyView {
    pub(super) id: String,
    pub(super) action_kind: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(super) route: Option<RouteOfferBinding>,
    pub(super) label: String,
    pub(super) target_kind: String,
    pub(super) target_id: Option<String>,
    pub(super) target_label: String,
    pub(super) available: bool,
    pub(super) availability_reason: String,
}

#[allow(dead_code)]
#[derive(Debug)]
pub(super) struct SharedQuestionContributionView {
    pub(super) actor_id: u64,
    pub(super) actor_name: String,
    pub(super) strategy_label: String,
    pub(super) target_label: String,
    pub(super) progress: u8,
    pub(super) event_seq: u64,
}

impl Serialize for SharedQuestionContributionView {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        let mut out = serializer.serialize_struct("SharedQuestionContributionView", 1)?;
        out.serialize_field("event_seq", &self.event_seq)?;
        out.end()
    }
}

#[derive(Debug, Serialize)]
pub(super) struct SharedQuestionMilestoneView {
    pub(super) filled: u8,
    pub(super) text: String,
}

#[derive(Clone, Debug, Serialize)]
pub(super) struct SharedQuestionSuggestionView {
    pub(super) offer_id: String,
    pub(super) state_revision: u64,
    pub(super) kind: String,
    pub(super) label: String,
    pub(super) target_label: String,
    pub(super) source: String,
    pub(super) likely_effect: String,
    pub(super) likely_progress: Option<u8>,
    pub(super) risk: Option<String>,
}

#[allow(dead_code)]
#[derive(Debug)]
pub(super) struct SharedQuestionView {
    pub(super) id: String,
    pub(super) provenance: String,
    pub(super) participant_ids: Vec<u64>,
    pub(super) participant_names: Vec<String>,
    pub(super) presentation_version: u8,
    pub(super) question: String,
    pub(super) rhythm: String,
    pub(super) attention: String,
    pub(super) priority: i16,
    pub(super) presentation_state: String,
    pub(super) promoted: bool,
    pub(super) promotion_rank: Option<usize>,
    pub(super) resolution: String,
    pub(super) situation: String,
    pub(super) stakes: String,
    pub(super) outcome: String,
    pub(super) progress_clock_id: String,
    pub(super) filled: u8,
    pub(super) segments: u8,
    pub(super) danger_clock_id: String,
    pub(super) danger_filled: u8,
    pub(super) danger_segments: u8,
    pub(super) danger_situation: String,
    pub(super) danger_consequence: String,
    pub(super) next_revelation: Option<SharedQuestionMilestoneView>,
    pub(super) strategies: Vec<SharedQuestionStrategyView>,
    pub(super) suggested_actions: Vec<SharedQuestionSuggestionView>,
    pub(super) recent_contributions: Vec<SharedQuestionContributionView>,
    pub(super) completion_memory: Option<String>,
    pub(super) updated_event_seq: Option<u64>,
}

impl Serialize for SharedQuestionView {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        let mut out = serializer.serialize_struct("SharedQuestionView", 14)?;
        out.serialize_field("id", &self.id)?;
        out.serialize_field("question", &self.question)?;
        out.serialize_field("presentation_state", &self.presentation_state)?;
        out.serialize_field("promoted", &self.promoted)?;
        if let Some(rank) = &self.promotion_rank {
            out.serialize_field("promotion_rank", rank)?;
        }
        out.serialize_field("situation", &self.situation)?;
        out.serialize_field("progress_clock_id", &self.progress_clock_id)?;
        out.serialize_field("filled", &self.filled)?;
        out.serialize_field("segments", &self.segments)?;
        out.serialize_field("danger_filled", &self.danger_filled)?;
        out.serialize_field("danger_segments", &self.danger_segments)?;
        out.serialize_field("recent_contributions", &self.recent_contributions)?;
        if let Some(event_seq) = &self.updated_event_seq {
            out.serialize_field("updated_event_seq", event_seq)?;
        }
        out.end()
    }
}

#[allow(dead_code)]
#[derive(Debug)]
pub(super) struct TagView {
    pub(super) id: String,
    pub(super) scope: String,
    pub(super) scope_id: u64,
    pub(super) label: String,
    pub(super) kind: String,
    pub(super) expires: Option<String>,
}

impl Serialize for TagView {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        let mut out = serializer.serialize_struct("TagView", 4)?;
        out.serialize_field("id", &self.id)?;
        out.serialize_field("scope", &self.scope)?;
        out.serialize_field("scope_id", &self.scope_id)?;
        out.serialize_field("label", &self.label)?;
        out.end()
    }
}

#[allow(dead_code)]
#[derive(Debug)]
pub(super) struct JobView {
    pub(super) id: String,
    pub(super) premise: String,
    pub(super) stakes: String,
    pub(super) status: String,
    pub(super) progress_clock_id: String,
    pub(super) danger_clock_id: String,
    pub(super) reward: String,
    pub(super) consequence: String,
    pub(super) action_label: String,
    pub(super) action_summary: String,
    pub(super) contribution_schema_version: u8,
    pub(super) contribution_strategies: Vec<JobContributionStrategy>,
    pub(super) narrated_thresholds: Vec<JobNarratedThreshold>,
}

impl Serialize for JobView {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        let mut out = serializer.serialize_struct("JobView", 3)?;
        out.serialize_field("id", &self.id)?;
        out.serialize_field("status", &self.status)?;
        out.serialize_field("progress_clock_id", &self.progress_clock_id)?;
        out.end()
    }
}

#[allow(dead_code)]
#[derive(Debug)]
pub(super) struct FrontView {
    pub(super) id: String,
    pub(super) premise: String,
    pub(super) zone: String,
    pub(super) status: String,
    pub(super) presentation_state: String,
    pub(super) outcome_statement: String,
    pub(super) location_ids: Vec<u64>,
    pub(super) participant_ids: Vec<u64>,
    pub(super) participant_names: Vec<String>,
    pub(super) stakes_questions: Vec<String>,
    pub(super) portent_clock_id: String,
    pub(super) job_ids: Vec<String>,
    pub(super) impending_outcome: String,
}

impl Serialize for FrontView {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        let mut out = serializer.serialize_struct("FrontView", 4)?;
        out.serialize_field("premise", &self.premise)?;
        out.serialize_field("presentation_state", &self.presentation_state)?;
        out.serialize_field("outcome_statement", &self.outcome_statement)?;
        out.serialize_field("stakes_questions", &self.stakes_questions)?;
        out.end()
    }
}

#[derive(Debug, Serialize)]
pub(super) struct RoomSheetView {
    pub(super) id: String,
    pub(super) location_id: u64,
    pub(super) name: String,
    pub(super) safety: String,
    pub(super) zone: String,
    pub(super) aspects: Vec<String>,
    pub(super) boons: Vec<String>,
    pub(super) hooks: Vec<String>,
    pub(super) resources: BTreeMap<String, i16>,
    pub(super) natural_features: Vec<NaturalFeatureState>,
    pub(super) generated_place: Option<GeneratedPlaceView>,
    pub(super) eligible_building_archetypes: Vec<String>,
    pub(super) governance_decisions: Vec<GovernanceDecisionView>,
    pub(super) settlement_buildings: Vec<SettlementBuildingView>,
    pub(super) loot_allocations: Vec<LootAllocationView>,
    pub(super) building_slots: BuildingSlotView,
    pub(super) projects: Vec<String>,
}

struct PublicRoomSheetView<'a>(&'a RoomSheetView);

impl Serialize for PublicRoomSheetView<'_> {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        let value = self.0;
        let mut out = serializer.serialize_struct("RoomSheetView", 3)?;
        out.serialize_field("safety", &value.safety)?;
        out.serialize_field("zone", &value.zone)?;
        out.serialize_field("hooks", &value.hooks)?;
        out.end()
    }
}

#[allow(dead_code)]
#[derive(Debug)]
pub(super) struct CallingView {
    pub(super) actor_id: u64,
    pub(super) statement: String,
}

impl Serialize for CallingView {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        let mut out = serializer.serialize_struct("CallingView", 1)?;
        out.serialize_field("statement", &self.statement)?;
        out.end()
    }
}

#[derive(Debug, Serialize)]
pub(super) struct SkillView {
    pub(super) skill_id: String,
    pub(super) label: String,
    pub(super) rank: u8,
    pub(super) tier: String,
    pub(super) bonus: i16,
}

#[allow(dead_code)]
#[derive(Debug)]
pub(super) struct VisitLedgerView {
    pub(super) journal_ref: Option<String>,
    pub(super) entity_version: u64,
    pub(super) unbanked_count: usize,
    pub(super) banked_count: usize,
    pub(super) spent_count: usize,
    pub(super) advancement_points: usize,
    pub(super) learned_truth_count: usize,
    pub(super) unbanked_marks: Vec<VisitLedgerMarkView>,
}

impl Serialize for VisitLedgerView {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        let mut out = serializer.serialize_struct("VisitLedgerView", 3)?;
        out.serialize_field("unbanked_count", &self.unbanked_count)?;
        out.serialize_field("advancement_points", &self.advancement_points)?;
        out.serialize_field("unbanked_marks", &self.unbanked_marks)?;
        out.end()
    }
}

#[allow(dead_code)]
#[derive(Debug)]
pub(super) struct VisitLedgerMarkView {
    pub(super) id: String,
    pub(super) category: String,
    pub(super) label: String,
    pub(super) source_event_seq: u64,
}

impl Serialize for VisitLedgerMarkView {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        let mut out = serializer.serialize_struct("VisitLedgerMarkView", 2)?;
        out.serialize_field("category", &self.category)?;
        out.serialize_field("label", &self.label)?;
        out.end()
    }
}

#[allow(dead_code)]
#[derive(Debug)]
pub(super) struct BondView {
    pub(super) id: String,
    pub(super) canonical_ref: String,
    pub(super) entity_version: u64,
    pub(super) actor_id: u64,
    pub(super) target_actor_id: u64,
    pub(super) target_actor_name: Option<String>,
    pub(super) statement: String,
    pub(super) strength: u8,
    pub(super) status: String,
    pub(super) source_event_seq: Option<u64>,
    pub(super) updated_event_seq: Option<u64>,
    pub(super) dialogue_status: String,
    pub(super) dialogue_event_seq: Option<u64>,
}

impl Serialize for BondView {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        let mut out = serializer.serialize_struct("BondView", 5)?;
        out.serialize_field("target_actor_id", &self.target_actor_id)?;
        out.serialize_field("target_actor_name", &self.target_actor_name)?;
        out.serialize_field("statement", &self.statement)?;
        out.serialize_field("strength", &self.strength)?;
        out.serialize_field("status", &self.status)?;
        out.end()
    }
}

#[derive(Debug, Serialize)]
pub(super) struct InspectorView {
    pub(super) location_id: u64,
    pub(super) practice: Option<ActorPracticeView>,
    pub(super) first_tale_question: Option<String>,
    pub(super) room: RoomInspectorView,
    pub(super) suggested_action: Option<ActionInspectorView>,
    pub(super) actions: Vec<ActionInspectorView>,
    pub(super) offer_decisions: Vec<ActionOfferDecisionView>,
    pub(super) jobs: Vec<JobInspectorView>,
    pub(super) fronts: Vec<FrontView>,
    pub(super) clocks: Vec<ClockInspectorView>,
    pub(super) hazards: Vec<ThresholdHazardDeveloperView>,
    pub(super) lifecycle_hooks: Vec<LifecycleHookInspectorView>,
}

#[derive(Debug, Serialize)]
pub(super) struct RoomInspectorView {
    pub(super) name: String,
    pub(super) zone: String,
    pub(super) safety: Option<String>,
    pub(super) aspects: Vec<String>,
    pub(super) boons: Vec<String>,
    pub(super) hooks: Vec<String>,
    pub(super) resources: BTreeMap<String, i16>,
    pub(super) eligible_building_archetypes: Vec<String>,
    pub(super) governance_decisions: Vec<GovernanceDecisionView>,
    pub(super) settlement_buildings: Vec<SettlementBuildingView>,
    pub(super) loot_allocations: Vec<LootAllocationView>,
    pub(super) building_slots: BuildingSlotView,
    pub(super) projects: Vec<String>,
    pub(super) features: Vec<String>,
    pub(super) listen_reason: Option<String>,
}

#[derive(Clone, Debug, Serialize)]
pub(super) struct ActionInspectorView {
    pub(super) offer_id: String,
    pub(super) kind: String,
    pub(super) rules_action: Option<String>,
    pub(super) operation: Option<String>,
    pub(super) rules_profile: String,
    pub(super) resolver: String,
    pub(super) source_collectible: Option<ActionSourceCollectibleView>,
    pub(super) pack_provenance: ActionPackProvenanceView,
    pub(super) composition_trace: ActionCompositionTraceView,
    pub(super) composition_id: String,
    pub(super) state_revision: u64,
    pub(super) route: Option<RouteOfferBinding>,
    pub(super) threshold_method: Option<ThresholdMethodOfferView>,
    pub(super) category: String,
    pub(super) label: String,
    pub(super) command: String,
    pub(super) rank: u16,
    pub(super) disabled: bool,
    pub(super) disabled_reason: Option<String>,
    pub(super) zone: String,
    pub(super) source: String,
    pub(super) provider: ActionProviderView,
    pub(super) target: Option<ActionTargetView>,
    pub(super) claim_key: Option<String>,
    pub(super) reason: String,
    pub(super) effect: Option<String>,
    pub(super) risk: Option<String>,
    pub(super) cost_orbs: Option<i32>,
}

#[derive(Debug, Serialize)]
pub(super) struct ActionOfferDecisionView {
    pub(super) offer_id: String,
    pub(super) kind: String,
    pub(super) available: bool,
    pub(super) in_hand: bool,
    pub(super) reason: String,
}

#[derive(Debug, Serialize)]
pub(super) struct JobInspectorView {
    pub(super) id: String,
    pub(super) status: String,
    pub(super) premise: String,
    pub(super) needs: Vec<String>,
    pub(super) blockers: Vec<String>,
    pub(super) participants: Vec<String>,
    pub(super) progress_clock_id: String,
    pub(super) danger_clock_id: String,
    pub(super) reward: String,
    pub(super) consequence: String,
    pub(super) contribution_schema_version: u8,
    pub(super) contribution_strategies: Vec<JobContributionInspectorView>,
}

#[derive(Debug, Serialize)]
pub(super) struct JobContributionInspectorView {
    pub(super) strategy: JobContributionStrategy,
    pub(super) resolved_target: Option<ResolvedContributionTarget>,
    pub(super) available: bool,
    pub(super) claim_key: Option<String>,
    pub(super) source_event_seqs: Vec<u64>,
}

#[derive(Debug, Serialize)]
pub(super) struct ClockInspectorView {
    pub(super) id: String,
    pub(super) kind: String,
    pub(super) label: String,
    pub(super) zone: String,
    pub(super) filled: u8,
    pub(super) segments: u8,
    pub(super) status: String,
    pub(super) visible_to_players: bool,
    pub(super) presentation: ClockPresentation,
    pub(super) recent_contributions: Vec<ClockContributionMemory>,
    pub(super) completion: Option<ClockCompletionMemory>,
    pub(super) updated_event_seq: Option<u64>,
    pub(super) last_delta: Option<i16>,
    pub(super) last_reason: Option<String>,
    pub(super) on_fill: Vec<EffectDescriptor>,
    pub(super) on_fill_effect: Option<String>,
}

#[derive(Debug, Serialize)]
pub(super) struct LifecycleHookInspectorView {
    pub(super) hook: String,
    pub(super) target_kind: String,
    pub(super) target_id: String,
    pub(super) claim_scope: String,
    pub(super) effects: Vec<EffectDescriptor>,
    pub(super) effect: Option<String>,
}

impl RuntimeWorld {
    #[allow(dead_code)]
    pub(super) fn room_feature_views(
        &self,
        location_id: u64,
        actor_id: Option<u64>,
    ) -> Vec<RoomFeatureView> {
        self.room_features(location_id)
            .into_iter()
            .map(|feature| {
                let hidden_exit_pending = self
                    .hidden_exit_candidate_for_search(location_id, &feature.key)
                    .is_some();
                let search_reveal_pending = !self
                    .search_reveal_candidates_for_feature(location_id, &feature.key)
                    .is_empty();
                let explicitly_searched = self
                    .room_feature_search_claimed(location_id, &feature.key)
                    || actor_id
                        .map(|id| self.feature_search_claimed(id, location_id, &feature.key))
                        .unwrap_or(false);
                let searched =
                    explicitly_searched || (!hidden_exit_pending && !search_reveal_pending);
                let uses = feature
                    .uses
                    .iter()
                    .map(|use_case| RoomFeatureUseView {
                        item_id: use_case.item_id,
                        feature_key: feature.key.clone(),
                        text: use_case.text.clone(),
                        used: actor_id
                            .map(|id| {
                                self.feature_use_claimed(
                                    id,
                                    location_id,
                                    &feature.key,
                                    use_case.item_id,
                                )
                            })
                            .unwrap_or(false),
                        effect: self.room_feature_use_effect(
                            actor_id,
                            location_id,
                            &feature.key,
                            use_case.item_id,
                        ),
                    })
                    .collect();
                RoomFeatureView {
                    key: feature.key.clone(),
                    name: feature.name.clone(),
                    aliases: feature.aliases.clone(),
                    look: feature.look.clone(),
                    search: feature.search.clone(),
                    searched,
                    uses,
                }
            })
            .collect()
    }
}
