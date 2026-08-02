use super::*;

pub(super) fn event_current_hp(event: &CwEvent) -> Option<i16> {
    match event.type_ {
        CW_EVENT_ACTOR_CREATED
        | CW_EVENT_ITEM_USED
        | CW_EVENT_COMBAT_ATTACK_HIT
        | CW_EVENT_COMBAT_KNOCKOUT
        | CW_EVENT_AVATAR_EVOLVED => Some(event.current_hp),
        _ => opt_i16(event.current_hp),
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

impl EventView {
    pub(crate) fn apply_async_causality(&mut self, record: &JournalRecord) {
        self.caused_by_event_seq = record.caused_by_event_seq;
        self.source_world_tick = record.source_world_tick;
        self.observed_through_seq = record.observed_through_seq;
        self.source_location_id = record.source_location_id;
    }

    pub(crate) fn refresh_content_context(&mut self) {
        let mut handles = Vec::new();
        for (kind, handle) in [
            ("actor", self.actor_id),
            ("actor", self.target_actor_id),
            ("location", self.location_id),
            ("location", self.destination_location_id),
            ("location", self.source_location_id),
            ("item", self.item_id),
            ("item", self.target_item_id),
        ] {
            if let Some(handle) = handle {
                handles.push((kind, handle));
            }
        }
        let mut refreshed = content_registry().content_reference_context(handles);
        if self.content_context.mapping_version != 0
            && self.content_context.mapping_version != refreshed.mapping_version
        {
            return;
        }
        let mut references = self
            .content_context
            .references
            .iter()
            .cloned()
            .map(|reference| (reference.canonical_ref.clone(), reference))
            .collect::<BTreeMap<_, _>>();
        references.extend(
            refreshed
                .references
                .drain(..)
                .map(|reference| (reference.canonical_ref.clone(), reference)),
        );
        refreshed.references = references.into_values().collect();
        if !self.content_context.active_rulesets.is_empty() {
            refreshed.active_rulesets = self.content_context.active_rulesets.clone();
        }
        self.content_context = refreshed;
    }
}

#[derive(Clone, Debug, Serialize)]
pub(super) struct JourneyView {
    pub(super) destination_location_id: u64,
    pub(super) destination_name: String,
    pub(super) current_step: usize,
    pub(super) total_steps: usize,
    pub(super) steps_remaining: usize,
    pub(super) explorer: bool,
    pub(super) next_location_id: Option<u64>,
    pub(super) next_location_name: Option<String>,
}

#[derive(Clone, Debug, Serialize)]
pub(super) struct FirstTaleView {
    pub(super) schema_version: u8,
    pub(super) phase: String,
    pub(super) question: String,
    pub(super) instruction: String,
    pub(super) target_label: String,
    pub(super) consequence: String,
    pub(super) completion_memory: String,
    pub(super) next_invitation: String,
    pub(super) public_trace_created: bool,
    pub(super) trace_event_seq: Option<u64>,
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

const JOURNAL_BEAT_POLICIES: &[(&str, JournalBeatCategory)] = &[
    ("actor.created", JournalBeatCategory::Story),
    ("actor.entered_location", JournalBeatCategory::Story),
    ("first_tale.public_trace", JournalBeatCategory::Story),
    ("governance.selected", JournalBeatCategory::Story),
    ("actor.moved", JournalBeatCategory::Travel),
    ("combat.flee.success", JournalBeatCategory::Travel),
    ("journey.started", JournalBeatCategory::Travel),
    ("journey.progressed", JournalBeatCategory::Travel),
    ("journey.narrated", JournalBeatCategory::Travel),
    ("journey.completed", JournalBeatCategory::Travel),
    ("journey.backtracked", JournalBeatCategory::Travel),
    ("journey.paused", JournalBeatCategory::Travel),
    ("exit.discovered", JournalBeatCategory::Discovery),
    ("avatar.discovered", JournalBeatCategory::Discovery),
    ("exit.unlocked", JournalBeatCategory::Discovery),
    ("pathway.discovered", JournalBeatCategory::Discovery),
    ("pathway.familiarized", JournalBeatCategory::Discovery),
    ("natural_feature.revealed", JournalBeatCategory::Discovery),
    ("feature.searched", JournalBeatCategory::Search),
    ("location.searched", JournalBeatCategory::Search),
    ("ability_check.rolled", JournalBeatCategory::Search),
    ("bond.deepened", JournalBeatCategory::Relationship),
    ("bond.created", JournalBeatCategory::Relationship),
    ("bond.revised", JournalBeatCategory::Relationship),
    ("bond.resolved", JournalBeatCategory::Relationship),
    ("ledger.marked", JournalBeatCategory::Growth),
    ("ledger.banked", JournalBeatCategory::Growth),
    ("advancement.spent", JournalBeatCategory::Growth),
    ("skill.stepped", JournalBeatCategory::Growth),
    ("calling.set", JournalBeatCategory::Growth),
    ("calling.revised", JournalBeatCategory::Growth),
    ("avatar.evolved", JournalBeatCategory::Growth),
    ("job.contribution.resolved", JournalBeatCategory::Work),
    ("job.updated", JournalBeatCategory::Work),
    ("building.construction_opened", JournalBeatCategory::Work),
    ("building.completed", JournalBeatCategory::Work),
    ("building.upgraded", JournalBeatCategory::Work),
    ("world.trade.flowed", JournalBeatCategory::Work),
    ("world.trade.disrupted", JournalBeatCategory::Work),
    ("world.delivery.needed", JournalBeatCategory::Work),
    ("world.logistics.completed", JournalBeatCategory::Work),
    ("quest.loot_allocated", JournalBeatCategory::Item),
    ("item.picked_up", JournalBeatCategory::Item),
    ("item.dropped", JournalBeatCategory::Item),
    ("item.used", JournalBeatCategory::Item),
    ("item.given", JournalBeatCategory::Item),
    ("item.traded", JournalBeatCategory::Item),
    ("item.found", JournalBeatCategory::Item),
    ("item.revealed", JournalBeatCategory::Item),
    ("item.crafted", JournalBeatCategory::Item),
    ("item.created", JournalBeatCategory::Item),
    ("item.transformed", JournalBeatCategory::Item),
    ("move.blocked", JournalBeatCategory::Consequence),
    ("clock.updated", JournalBeatCategory::Consequence),
    ("combat.attack.attempt", JournalBeatCategory::Consequence),
    ("combat.encounter.started", JournalBeatCategory::Consequence),
    ("combat.dodge", JournalBeatCategory::Consequence),
    (
        "combat.encounter.resolved",
        JournalBeatCategory::Consequence,
    ),
    ("world.weather.shifted", JournalBeatCategory::Consequence),
    ("world.weather.held", JournalBeatCategory::Consequence),
    (
        "world.faction.influence_shifted",
        JournalBeatCategory::Consequence,
    ),
    (
        "world.conflict.pressure_grew",
        JournalBeatCategory::Consequence,
    ),
    (
        "world.conflict.pressure_eased",
        JournalBeatCategory::Consequence,
    ),
    ("world.conflict.escalated", JournalBeatCategory::Consequence),
    ("magic.spell_cast", JournalBeatCategory::Consequence),
];

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
pub(super) struct JournalBeatView {
    pub(super) id: String,
    pub(super) source_event_seqs: Vec<u64>,
    pub(super) category: JournalBeatCategory,
    pub(super) headline: String,
    pub(super) location_id: u64,
    pub(super) ordering_seq: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(super) world_beat_exposure_id: Option<String>,
}

#[derive(Debug, Serialize)]
pub(super) struct StateResponse {
    pub(super) world_id: String,
    pub(super) world_epoch: u64,
    pub(super) world_seq: u64,
    pub(super) state_revision: u64,
    pub(super) rules_context: Option<SceneRulesContextView>,
    pub(super) location: LocationView,
    pub(super) exits: Vec<ExitView>,
    pub(super) actors: Vec<ActorView>,
    pub(super) items: Vec<ItemView>,
    // These internal projections remain available to Rust-side invariant tests;
    // clients receive the explicitly named visible projection below.
    #[allow(dead_code)]
    #[serde(skip_serializing)]
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
    pub(super) bonds: Vec<BondView>,
    pub(super) chat_bond_claimed_target_ids: Vec<u64>,
    pub(super) cards: CardRegistryView,
    #[allow(dead_code)]
    #[serde(skip_serializing)]
    pub(super) card_transactions: Vec<CardTransactionView>,
    pub(super) access: AccessView,
    pub(super) account: AccountView,
    pub(super) economy: EconomyView,
    pub(super) deck: DeckView,
    pub(super) combat: Option<CombatView>,
    pub(super) turn: RoomTurnView,
    pub(super) branch: Option<BranchView>,
    pub(super) safety: ActorSafetyView,
    pub(super) recent_events: Vec<EventView>,
    pub(super) journal_beats: Vec<JournalBeatView>,
    pub(super) room_memory: RoomMemoryView,
    #[allow(dead_code)]
    #[serde(skip_serializing)]
    pub(super) primary_action: PrimaryAction,
    #[serde(rename = "primary_action")]
    pub(super) visible_primary_action: PrimaryAction,
    #[allow(dead_code)]
    #[serde(skip_serializing)]
    pub(super) action_offers: Vec<RankedActionOffer>,
    #[serde(rename = "action_offers")]
    pub(super) visible_action_offers: Vec<RankedActionOffer>,
    pub(super) action_hand: ActionHandView,
    #[serde(skip_serializing)]
    pub(super) inspector: InspectorView,
    pub(super) character_creation: Vec<CharacterCreationProfileView>,
    pub(super) character_identity: Option<CharacterIdentityView>,
}

fn semantic_receipt_journal_category(narration_key: &str) -> JournalBeatCategory {
    let key = narration_key.to_ascii_lowercase();
    if key.contains("work") || key.contains("build") || key.contains("job") {
        JournalBeatCategory::Work
    } else if key.contains("journey")
        || key.contains("travel")
        || key.contains("arrival")
        || key.contains("move")
    {
        JournalBeatCategory::Travel
    } else if key.contains("search") || key.contains("check") || key.contains("study") {
        JournalBeatCategory::Search
    } else if key.contains("discover")
        || key.contains("reveal")
        || key.contains("pathway")
        || key.contains("scout")
    {
        JournalBeatCategory::Discovery
    } else if key.contains("bond") || key.contains("friend") || key.contains("relationship") {
        JournalBeatCategory::Relationship
    } else if key.contains("growth")
        || key.contains("skill")
        || key.contains("calling")
        || key.contains("ledger")
        || key.contains("evolve")
    {
        JournalBeatCategory::Growth
    } else if key.contains("item")
        || key.contains("loot")
        || key.contains("craft")
        || key.contains("gift")
        || key.contains("trade")
    {
        JournalBeatCategory::Item
    } else if key.contains("combat")
        || key.contains("danger")
        || key.contains("consequence")
        || key.contains("failure")
    {
        JournalBeatCategory::Consequence
    } else {
        JournalBeatCategory::Story
    }
}

fn journal_beat_category(event: &EventView) -> Option<JournalBeatCategory> {
    if event.type_name == semantic_receipts::STORY_RECEIPT_EVENT_TYPE {
        return semantic_receipts::semantic_story_receipt(event)
            .map(|receipt| semantic_receipt_journal_category(&receipt.narration_key));
    }
    JOURNAL_BEAT_POLICIES
        .iter()
        .find_map(|(type_name, category)| {
            (*type_name == event.type_name.as_str()).then_some(*category)
        })
}

fn complete_journal_headline(value: &str) -> Option<String> {
    let compact = value.split_whitespace().collect::<Vec<_>>().join(" ");
    if compact.is_empty() {
        return None;
    }
    if compact.ends_with(['.', '!', '?', '…']) {
        Some(compact)
    } else {
        Some(format!("{compact}."))
    }
}

fn journal_world_beat_exposure_id(event: &EventView) -> Option<String> {
    matches!(
        event.type_name.as_str(),
        "world.weather.shifted"
            | "world.weather.held"
            | "world.trade.flowed"
            | "world.trade.disrupted"
            | "world.delivery.needed"
            | "world.logistics.completed"
            | "world.faction.influence_shifted"
            | "world.conflict.pressure_grew"
            | "world.conflict.pressure_eased"
            | "world.conflict.escalated"
    )
    .then(|| format!("world-beat:v1:{}", event.seq))
}

const JOURNAL_ACTION_EVENT_SPAN: u64 = 24;

fn journal_search_event(event: &EventView) -> bool {
    matches!(
        event.type_name.as_str(),
        "feature.searched" | "location.searched"
    )
}

fn journal_discovery_outcome(event: &EventView) -> bool {
    matches!(
        event.type_name.as_str(),
        "exit.discovered"
            | "avatar.discovered"
            | "item.found"
            | "item.revealed"
            | "natural_feature.revealed"
            | "pathway.discovered"
    )
}

fn journal_search_evidence(event: &EventView) -> bool {
    matches!(event.type_name.as_str(), "tag.applied" | "tag.cleared")
        && matches!(
            event.content.as_deref(),
            Some("search_location") | Some("search_feature")
        )
        || event.type_name == "ledger.marked"
            && event
                .content
                .as_deref()
                .is_some_and(|content| content.contains("search"))
}

fn journal_same_actor_and_location(left: &EventView, right: &EventView) -> bool {
    left.actor_id.is_some()
        && left.actor_id == right.actor_id
        && left.location_id.is_some()
        && left.location_id == right.location_id
}

fn journal_explicitly_related(left: &EventView, right: &EventView) -> bool {
    left.caused_by_event_seq == Some(right.seq) || right.caused_by_event_seq == Some(left.seq)
}

fn journal_nearest_search<'a>(
    searches: &[&'a EventView],
    event: &EventView,
) -> Option<&'a EventView> {
    searches
        .iter()
        .copied()
        .filter(|search| journal_same_actor_and_location(search, event))
        .filter(|search| {
            journal_explicitly_related(search, event)
                || search.seq.abs_diff(event.seq) <= JOURNAL_ACTION_EVENT_SPAN
        })
        .min_by_key(|search| {
            (
                u8::from(!journal_explicitly_related(search, event)),
                search.seq.abs_diff(event.seq),
                search.seq,
            )
        })
}

fn journal_discovery_outcome_priority(event: &EventView) -> u8 {
    match event.type_name.as_str() {
        "exit.discovered" | "pathway.discovered" => 4,
        "avatar.discovered" => 3,
        "natural_feature.revealed" => 2,
        "item.found" | "item.revealed" => 1,
        _ => 0,
    }
}

fn journal_search_target(search: &EventView) -> Option<&str> {
    (search.type_name == "feature.searched")
        .then(|| {
            search
                .content
                .as_deref()?
                .split(':')
                .next()
                .map(str::trim)
                .filter(|target| !target.is_empty())
        })
        .flatten()
}

fn journal_natural_feature_name(event: &EventView) -> Option<String> {
    event
        .content
        .as_deref()
        .and_then(|content| serde_json::from_str::<serde_json::Value>(content).ok())
        .and_then(|content| {
            content
                .get("feature")
                .and_then(|feature| feature.get("resource_kind"))
                .and_then(serde_json::Value::as_str)
                .map(|resource| resource.replace('_', " "))
        })
}

fn journal_search_headline(search: &EventView, outcomes: &[&EventView]) -> Option<String> {
    let actor = search.actor_name.as_deref().unwrap_or("Someone");
    let location = search.location_name.as_deref().unwrap_or("the area");
    let outcome = outcomes
        .iter()
        .copied()
        .max_by_key(|event| (journal_discovery_outcome_priority(event), event.seq));
    let headline = match outcome.map(|event| event.type_name.as_str()) {
        Some("exit.discovered" | "pathway.discovered") => {
            let destination = outcome?
                .destination_location_name
                .as_deref()
                .unwrap_or("somewhere new");
            format!(
                "{actor} discovered a path to {destination} while searching {location}; the route is now available for travel"
            )
        }
        Some("avatar.discovered") => format!(
            "{actor} discovered {} while searching {location}",
            outcome?
                .target_actor_name
                .as_deref()
                .unwrap_or("someone nearby")
        ),
        Some("item.found" | "item.revealed") => format!(
            "{actor} found {} while searching {location}",
            outcome?.item_name.as_deref().unwrap_or("something useful")
        ),
        Some("natural_feature.revealed") => format!(
            "{actor} discovered {} while searching {location}",
            journal_natural_feature_name(outcome?)
                .as_deref()
                .unwrap_or("a useful feature")
        ),
        _ if search.type_name == "feature.searched" => format!(
            "{actor} searched {} in {location}, but found nothing new",
            journal_search_target(search).unwrap_or("a tucked-away detail")
        ),
        _ => format!("{actor} searched {location}, but found nothing new"),
    };
    complete_journal_headline(&headline)
}

fn journal_journey_event(event: &EventView) -> bool {
    matches!(
        event.type_name.as_str(),
        "journey.started"
            | "journey.progressed"
            | "journey.narrated"
            | "journey.completed"
            | "journey.backtracked"
            | "journey.paused"
    )
}

fn journal_nearest_movement<'a>(
    movements: &[&'a EventView],
    journey: &EventView,
    assigned_movements: &BTreeSet<u64>,
) -> Option<&'a EventView> {
    movements
        .iter()
        .copied()
        .filter(|movement| !assigned_movements.contains(&movement.seq))
        .filter(|movement| movement.actor_id.is_some() && movement.actor_id == journey.actor_id)
        .filter(|movement| movement.destination_location_id == journey.location_id)
        .filter(|movement| {
            movement.seq <= journey.seq
                && (journal_explicitly_related(movement, journey)
                    || journey.seq - movement.seq <= JOURNAL_ACTION_EVENT_SPAN)
        })
        .min_by_key(|movement| {
            (
                u8::from(!journal_explicitly_related(movement, journey)),
                journey.seq - movement.seq,
                Reverse(movement.seq),
            )
        })
}

fn journal_journey_destination<'a>(
    journey: &'a EventView,
    events: &'a [&EventView],
) -> Option<&'a str> {
    journey.destination_location_name.as_deref().or_else(|| {
        events
            .iter()
            .copied()
            .filter(|event| event.actor_id == journey.actor_id && event.seq < journey.seq)
            .filter(|event| journal_journey_event(event) || event.type_name == "pathway.discovered")
            .filter_map(|event| {
                event
                    .destination_location_name
                    .as_deref()
                    .map(|destination| (event.seq, destination))
            })
            .max_by_key(|(seq, _)| *seq)
            .map(|(_, destination)| destination)
    })
}

fn journal_travel_headline(
    movement: &EventView,
    journey: &EventView,
    events: &[&EventView],
) -> Option<String> {
    let actor = movement.actor_name.as_deref().unwrap_or("Someone");
    let origin = movement
        .location_name
        .as_deref()
        .unwrap_or("the last place");
    let step = movement
        .destination_location_name
        .as_deref()
        .unwrap_or("the next place");
    let destination = journal_journey_destination(journey, events).unwrap_or(step);
    let headline = match journey.type_name.as_str() {
        "journey.paused" => format!(
            "{actor} left {origin} for {step}; the journey to {destination} is paused and can be resumed later"
        ),
        "journey.completed" => format!(
            "{actor} traveled from {origin} to {step} and completed the journey to {destination}"
        ),
        "journey.backtracked" => format!(
            "{actor} traveled from {origin} back to {step}; the journey to {destination} remains open"
        ),
        _ => format!(
            "{actor} traveled from {origin} to {step}; the journey to {destination} continues"
        ),
    };
    complete_journal_headline(&headline)
}

fn journal_grouped_beat(
    location_id: u64,
    identity_seq: u64,
    category: JournalBeatCategory,
    headline: String,
    members: &[&EventView],
) -> JournalBeatView {
    let mut source_event_seqs = members.iter().map(|event| event.seq).collect::<Vec<_>>();
    source_event_seqs.sort_unstable();
    source_event_seqs.dedup();
    JournalBeatView {
        id: format!("journal-beat:v1:{location_id}:{identity_seq}"),
        ordering_seq: source_event_seqs.last().copied().unwrap_or(identity_seq),
        source_event_seqs,
        category,
        headline,
        location_id,
        world_beat_exposure_id: None,
    }
}

fn journal_beat_views(events: &[EventView], location_id: u64) -> Vec<JournalBeatView> {
    let covered_event_seqs = semantic_receipts::semantic_receipt_covered_event_seqs(events);
    let mut chronological = events
        .iter()
        .filter(|event| !covered_event_seqs.contains(&event.seq))
        .collect::<Vec<_>>();
    chronological.sort_by_key(|event| event.seq);

    let searches = chronological
        .iter()
        .copied()
        .filter(|event| journal_search_event(event))
        .collect::<Vec<_>>();
    let mut search_outcomes = BTreeMap::<u64, Vec<&EventView>>::new();
    let mut search_evidence = BTreeMap::<u64, Vec<&EventView>>::new();
    for event in chronological.iter().copied() {
        if journal_discovery_outcome(event) {
            if let Some(search) = journal_nearest_search(&searches, event) {
                search_outcomes.entry(search.seq).or_default().push(event);
            }
        } else if journal_search_evidence(event) {
            if let Some(search) = journal_nearest_search(&searches, event) {
                search_evidence.entry(search.seq).or_default().push(event);
            }
        }
    }

    let movements = chronological
        .iter()
        .copied()
        .filter(|event| event.type_name == "actor.moved")
        .collect::<Vec<_>>();
    let mut travel_pairs = BTreeMap::<u64, &EventView>::new();
    let mut assigned_movements = BTreeSet::new();
    for journey in chronological
        .iter()
        .copied()
        .filter(|event| journal_journey_event(event))
    {
        if let Some(movement) = journal_nearest_movement(&movements, journey, &assigned_movements) {
            assigned_movements.insert(movement.seq);
            travel_pairs.insert(movement.seq, journey);
        }
    }

    let mut consumed = BTreeSet::new();
    let mut beats = Vec::new();
    for search in searches {
        let outcomes = search_outcomes.remove(&search.seq).unwrap_or_default();
        let mut members = vec![search];
        members.extend(outcomes.iter().copied());
        members.extend(search_evidence.remove(&search.seq).unwrap_or_default());
        consumed.extend(members.iter().map(|event| event.seq));
        if let Some(headline) = journal_search_headline(search, &outcomes) {
            beats.push(journal_grouped_beat(
                location_id,
                search.seq,
                if outcomes.is_empty() {
                    JournalBeatCategory::Search
                } else {
                    JournalBeatCategory::Discovery
                },
                headline,
                &members,
            ));
        }
    }

    for movement in movements {
        let Some(journey) = travel_pairs.remove(&movement.seq) else {
            continue;
        };
        let members = [movement, journey];
        consumed.extend(members.iter().map(|event| event.seq));
        if let Some(headline) = journal_travel_headline(movement, journey, &chronological) {
            beats.push(journal_grouped_beat(
                location_id,
                movement.seq,
                JournalBeatCategory::Travel,
                headline,
                &members,
            ));
        }
    }

    beats.extend(
        chronological
            .into_iter()
            .filter(|event| !consumed.contains(&event.seq))
            .filter_map(|event| {
                let category = journal_beat_category(event)?;
                let (headline, mut source_event_seqs) =
                    if let Some(receipt) = semantic_receipts::semantic_story_receipt(event) {
                        (
                            complete_journal_headline(&receipt.text)?,
                            receipt.event_seqs,
                        )
                    } else if journal_world_beat_exposure_id(event).is_some() {
                        (
                            complete_journal_headline(event.content.as_deref()?)?,
                            vec![event.seq],
                        )
                    } else {
                        (
                            complete_journal_headline(&room_memory_log_text_at_location(
                                event,
                                location_id,
                            )?)?,
                            vec![event.seq],
                        )
                    };
                source_event_seqs.push(event.seq);
                source_event_seqs.sort_unstable();
                source_event_seqs.dedup();
                Some(JournalBeatView {
                    id: format!("journal-beat:v1:{location_id}:{}", event.seq),
                    source_event_seqs,
                    category,
                    headline,
                    location_id,
                    ordering_seq: event.seq,
                    world_beat_exposure_id: journal_world_beat_exposure_id(event),
                })
            }),
    );
    beats.sort_by(|left, right| {
        left.ordering_seq
            .cmp(&right.ordering_seq)
            .then_with(|| left.id.cmp(&right.id))
    });
    if beats.len() > 60 {
        beats.drain(0..beats.len() - 60);
    }
    beats
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

#[derive(Debug, Serialize)]
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
    pub(super) wooden_boxes: usize,
    pub(super) unopened_packs: usize,
}

#[derive(Debug, Serialize)]
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

#[derive(Debug, Serialize)]
pub(super) struct CharmSlotExpansionView {
    pub(super) charm: ItemView,
    pub(super) label: String,
    pub(super) explanation: String,
    pub(super) advancement_cost: u8,
}

#[derive(Debug, Serialize)]
pub(super) struct ContainerDeckView {
    pub(super) container: ItemView,
    pub(super) contents: Vec<ItemView>,
    pub(super) opening_size: String,
    pub(super) allowed_contents: Vec<String>,
    pub(super) equipped: bool,
    pub(super) active_capacity_tenths: u16,
}

#[derive(Debug, Serialize)]
pub(super) struct WorldResponse {
    pub(super) world_id: String,
    pub(super) world_epoch: u64,
    pub(super) world_seq: u64,
    pub(super) shared_world: bool,
    pub(super) current_actor_id: Option<u64>,
    pub(super) current_location_id: Option<u64>,
    pub(super) access: AccessView,
    pub(super) factions: Vec<FactionView>,
    pub(super) simulation: WorldSimulationView,
    pub(super) locations: Vec<WorldLocationView>,
}

#[derive(Debug, Serialize)]
pub(super) struct WorldSimulationView {
    pub(super) pulse_interval_ticks: u64,
    pub(super) pulse_index: u64,
    pub(super) last_advanced_tick: u64,
    pub(super) factions: Vec<FactionSimulationView>,
    pub(super) recent_history: Vec<EventView>,
}

#[derive(Clone, Debug, Serialize)]
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

#[derive(Clone, Debug, Serialize)]
pub(super) struct FactionInfluenceView {
    pub(super) faction_id: String,
    pub(super) faction_name: String,
    pub(super) influence: u8,
}

#[derive(Debug, Serialize)]
pub(super) struct FactionSimulationView {
    pub(super) faction_id: String,
    pub(super) faction_name: String,
    pub(super) momentum: i16,
    pub(super) last_action_tick: u64,
    pub(super) influenced_location_ids: Vec<u64>,
}

#[derive(Debug, Serialize)]
pub(super) struct WorldLocationView {
    pub(super) id: u64,
    pub(super) canonical_ref: String,
    pub(super) entity_version: u64,
    pub(super) pack_id: Option<String>,
    pub(super) name: String,
    pub(super) title: String,
    pub(super) description: String,
    pub(super) persona: String,
    pub(super) memory: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(super) interior_view: Option<InteriorViewMode>,
    pub(super) factions: Vec<FactionRefView>,
    pub(super) simulation: LocationSimulationView,
    pub(super) public: bool,
    pub(super) accessible: bool,
    pub(super) required_grant_id: Option<String>,
    pub(super) required_card_id: Option<String>,
    pub(super) access_reason: Option<String>,
    pub(super) card: CardView,
    pub(super) actor_count: usize,
    pub(super) direct_input_actor_count: usize,
    pub(super) inference_actor_count: usize,
    #[serde(rename = "human_count")]
    pub(super) legacy_direct_input_actor_count: usize,
    #[serde(rename = "resident_count")]
    pub(super) legacy_inference_actor_count: usize,
    pub(super) item_count: usize,
    pub(super) actors: Vec<ActorView>,
    pub(super) items: Vec<ItemView>,
    pub(super) exits: Vec<ExitView>,
}

#[derive(Clone, Debug, Serialize)]
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
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(super) interior_view: Option<InteriorViewMode>,
    pub(super) factions: Vec<FactionRefView>,
    pub(super) simulation: LocationSimulationView,
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

#[derive(Debug, Serialize)]
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
    pub(super) required_grant_id: Option<String>,
    pub(super) required_card_id: Option<String>,
    pub(super) access_reason: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(super) threshold: Option<ThresholdOfferBinding>,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize)]
pub(super) struct ExpeditionRingView {
    pub(super) filled_count: u8,
    pub(super) pip_total: u8,
    pub(super) needs_rest: bool,
}

#[derive(Debug, Serialize)]
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
    pub(super) muted_by_you: bool,
    pub(super) blocked_by_you: bool,
    pub(super) location_id: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(super) relationship: Option<RelationshipPreviewView>,
    pub(super) factions: Vec<FactionRefView>,
    #[serde(rename = "economy")]
    pub(super) resident_economy: Option<ResidentEconomyView>,
    pub(super) expedition_ring: ExpeditionRingView,
    pub(super) hp: i16,
    pub(super) bloodied: bool,
    pub(super) stats: StatView,
}

#[derive(Clone, Debug, Default, Serialize)]
pub(super) struct ActorSafetyView {
    pub(super) muted_actor_ids: Vec<u64>,
    pub(super) blocked_actor_ids: Vec<u64>,
    pub(super) incoming_offers: Vec<TransferOfferView>,
    pub(super) outgoing_offers: Vec<TransferOfferView>,
    pub(super) gift_auto_accepts: Vec<GiftAutoAcceptView>,
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

#[derive(Clone, Debug, Serialize)]
pub(super) struct GiftAutoAcceptView {
    pub(super) id: String,
    pub(super) offered_by_actor_id: u64,
    pub(super) offered_by_actor_name: String,
    pub(super) item_id: u64,
    pub(super) item_name: String,
    pub(super) expires_tick: u64,
}

#[derive(Clone, Debug, Serialize)]
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

#[derive(Clone, Debug, Serialize)]
pub(super) struct ResidentHeldItemView {
    pub(super) item_id: u64,
    pub(super) disposition: String,
    pub(super) reason: String,
    pub(super) keep_score: i16,
    pub(super) available_actions: Vec<String>,
}

#[derive(Clone, Debug, Serialize)]
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

#[derive(Clone, Debug, Serialize)]
pub(super) struct ResidentRequestView {
    pub(super) item_id: u64,
    pub(super) holder_actor_id: u64,
    pub(super) reason: String,
}

#[derive(Clone, Debug, Serialize)]
pub(super) struct ResidentTradeOfferView {
    pub(super) offered_item_id: u64,
    pub(super) requested_item_id: u64,
    pub(super) willingness: String,
    pub(super) reason: String,
}

#[derive(Clone, Debug, Serialize)]
pub(super) struct ResidentTradeStanceView {
    pub(super) offered_item_id: u64,
    pub(super) requested_item_id: u64,
    pub(super) willingness: String,
    pub(super) reason: String,
    pub(super) accepted: bool,
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

#[derive(Debug, Serialize)]
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

#[derive(Debug, Serialize)]
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

#[derive(Debug, Serialize)]
pub(super) struct SharedQuestionContributionView {
    pub(super) actor_id: u64,
    pub(super) actor_name: String,
    pub(super) strategy_label: String,
    pub(super) target_label: String,
    pub(super) progress: u8,
    pub(super) event_seq: u64,
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

#[derive(Debug, Serialize)]
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

fn shared_question_attention_rank(attention: &str) -> u8 {
    match attention {
        "immediate" => 4,
        "local" => 3,
        "communal" => 2,
        "background" => 1,
        _ => 0,
    }
}

fn shared_question_state_rank(state: &str) -> u8 {
    match state {
        "active" => 0,
        "completed_memory" => 1,
        "quiet" => 2,
        "unavailable" => 3,
        _ => 4,
    }
}

#[derive(Debug, Serialize)]
pub(super) struct TagView {
    pub(super) id: String,
    pub(super) scope: String,
    pub(super) scope_id: u64,
    pub(super) label: String,
    pub(super) kind: String,
    pub(super) expires: Option<String>,
}

#[derive(Debug, Serialize)]
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

#[derive(Debug, Serialize)]
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

fn front_presentation(
    authored_status: &str,
    has_completed_job: bool,
    has_failed_job: bool,
    impending_outcome: &str,
) -> (&'static str, String) {
    let presentation_state = match authored_status {
        "completed" => "resolved",
        "failed" => "escalated",
        "dormant" => "dormant",
        _ if has_failed_job => "escalated",
        _ if has_completed_job => "persisted",
        _ => "active",
    };
    let outcome_statement = match presentation_state {
        "resolved" => "The larger trouble is resolved.".to_string(),
        "persisted" => {
            "The immediate work is done, but the larger trouble remains unresolved.".to_string()
        }
        "escalated" => format!("The larger trouble has escalated. {impending_outcome}"),
        _ => String::new(),
    };
    (presentation_state, outcome_statement)
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
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(super) generated_place: Option<GeneratedPlaceView>,
    pub(super) eligible_building_archetypes: Vec<String>,
    pub(super) governance_decisions: Vec<GovernanceDecisionView>,
    pub(super) settlement_buildings: Vec<SettlementBuildingView>,
    pub(super) loot_allocations: Vec<LootAllocationView>,
    pub(super) building_slots: BuildingSlotView,
    pub(super) projects: Vec<String>,
}

#[derive(Debug, Serialize)]
pub(super) struct CallingView {
    pub(super) actor_id: u64,
    pub(super) statement: String,
}

#[derive(Debug, Serialize)]
pub(super) struct SkillView {
    pub(super) skill_id: String,
    pub(super) label: String,
    pub(super) rank: u8,
    pub(super) tier: String,
    pub(super) bonus: i16,
}

#[derive(Debug, Serialize)]
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

#[derive(Debug, Serialize)]
pub(super) struct VisitLedgerMarkView {
    pub(super) id: String,
    pub(super) category: String,
    pub(super) label: String,
    pub(super) source_event_seq: u64,
}

#[derive(Debug, Serialize)]
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

#[derive(Debug, Serialize)]
pub(super) struct InspectorView {
    pub(super) location_id: u64,
    pub(super) practice: Option<ActorPracticeView>,
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

#[cfg(test)]
pub(super) fn assert_complete_offer_inspector(state: &StateResponse) {
    assert!(state
        .action_offers
        .windows(2)
        .all(|pair| pair[0].rank <= pair[1].rank));
    assert_eq!(state.inspector.actions.len(), state.action_offers.len());
    assert_eq!(
        state.inspector.offer_decisions.len(),
        state.action_offers.len()
    );
    let hand_offer_ids = state
        .action_hand
        .entries
        .iter()
        .map(|entry| entry.offer_id.as_str())
        .collect::<BTreeSet<_>>();
    for (offer, action) in state.action_offers.iter().zip(&state.inspector.actions) {
        assert_eq!(action.offer_id, offer.offer_id);
        assert_eq!(action.provider.id, offer.provider.id);
        assert_eq!(action.provider.reason, offer.provider.reason);
        assert!(!action.reason.is_empty());
        assert!(!action.composition_id.is_empty());
    }
    assert!(state.inspector.offer_decisions.iter().all(|decision| {
        decision.in_hand == hand_offer_ids.contains(decision.offer_id.as_str())
            && !decision.reason.is_empty()
            && (!decision.in_hand || decision.available)
    }));
    assert!(state.inspector.offer_decisions.iter().all(|decision| {
        !decision.reason.contains("same choice group")
            && !decision.reason.contains("non-browser transports")
    }));
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

pub(super) fn faction_ref_from_seed(faction: &SeedFactionContent) -> FactionRefView {
    FactionRefView {
        id: faction.id.clone(),
        name: faction.name.clone(),
        axis: faction.axis.clone(),
        player_facing: faction.player_facing,
    }
}

pub(super) fn faction_view_from_seed(faction: &SeedFactionContent) -> FactionView {
    FactionView {
        id: faction.id.clone(),
        name: faction.name.clone(),
        axis: faction.axis.clone(),
        opposes: faction.opposes.clone(),
        truth: faction.truth.clone(),
        shadow: faction.shadow.clone(),
        doctrine: faction.doctrine.clone(),
        verbs: faction.verbs.clone(),
        motif: faction.motif.clone(),
        home_location_ids: faction.home_location_ids.clone(),
        player_facing: faction.player_facing,
        member_actor_ids: effective_faction_member_actor_ids(faction),
    }
}

pub(super) fn faction_views() -> Vec<FactionView> {
    active_content()
        .factions
        .iter()
        .map(faction_view_from_seed)
        .collect()
}

pub(super) fn faction_refs_for_actor(actor_id: u64) -> Vec<FactionRefView> {
    active_content()
        .factions
        .iter()
        .filter(|faction| effective_faction_member_actor_ids(faction).contains(&actor_id))
        .map(faction_ref_from_seed)
        .collect()
}

pub(super) fn faction_refs_for_location(location_id: u64) -> Vec<FactionRefView> {
    active_content()
        .factions
        .iter()
        .filter(|faction| faction.home_location_ids.contains(&location_id))
        .map(faction_ref_from_seed)
        .collect()
}

impl RuntimeWorld {
    pub(super) fn first_tale_view(&self, actor_id: u64) -> Option<FirstTaleView> {
        let actor = self.actor_by_id(actor_id)?;
        if !Self::actor_can_act(actor) {
            return None;
        }
        let first_tale = active_first_tale()?;
        let trace_event_seq = self.first_tale_trace_event_seq(actor_id);
        let has_lead = self.listen_attempt_claimed_at(actor_id, first_tale.lead_location_id);
        let destination_reached = self.first_tale_destination_reached(actor_id);
        if trace_event_seq.is_none()
            && has_lead
            && destination_reached
            && actor.location_id != first_tale.destination_location_id
        {
            return None;
        }
        let phase = if trace_event_seq.is_some() {
            "complete"
        } else if !has_lead {
            "notice"
        } else if !destination_reached {
            "follow_lead"
        } else {
            "contribute"
        };
        let instruction = match phase {
            "notice" => &first_tale.copy.notice_instruction,
            "follow_lead" => &first_tale.copy.follow_lead_instruction,
            "contribute" => &first_tale.copy.contribute_instruction,
            _ => &first_tale.copy.complete_instruction,
        };
        Some(FirstTaleView {
            schema_version: first_tale.schema_version,
            phase: phase.to_string(),
            question: first_tale.copy.question.clone(),
            instruction: instruction.to_string(),
            target_label: first_tale.copy.target_label.clone(),
            consequence: first_tale.copy.consequence.clone(),
            completion_memory: first_tale.copy.completion_memory.clone(),
            next_invitation: first_tale.copy.next_invitation.clone(),
            public_trace_created: trace_event_seq.is_some(),
            trace_event_seq,
        })
    }

    pub(super) fn location_view(&self, location_id: u64) -> LocationView {
        let name = self
            .location_name(location_id)
            .unwrap_or_else(|| "Unknown Location".to_string());
        let meta = self.location_meta_for(location_id);
        LocationView {
            id: location_id,
            canonical_ref: self
                .canonical_ref("location", location_id)
                .unwrap_or_default()
                .to_string(),
            entity_version: self
                .canonical_ref("location", location_id)
                .map(|canonical_ref| self.entity_version(canonical_ref))
                .unwrap_or_default(),
            pack_id: seed_pack_id_for_location(location_id),
            name,
            title: meta.title,
            description: meta.description,
            persona: meta.persona,
            memory: meta.memory,
            interior_view: meta.interior_view,
            factions: faction_refs_for_location(location_id),
            simulation: self.location_simulation_view(location_id),
        }
    }

    pub(super) fn location_simulation_view(&self, location_id: u64) -> LocationSimulationView {
        let state = self
            .world_simulation
            .locations
            .get(&location_id)
            .cloned()
            .unwrap_or_default();
        let mut faction_influence = state
            .faction_influence
            .iter()
            .filter(|(_, influence)| **influence > 0)
            .map(|(faction_id, influence)| FactionInfluenceView {
                faction_id: faction_id.clone(),
                faction_name: active_content()
                    .factions
                    .iter()
                    .find(|faction| faction.id == *faction_id)
                    .map(|faction| faction.name.clone())
                    .unwrap_or_else(|| faction_id.clone()),
                influence: *influence,
            })
            .collect::<Vec<_>>();
        faction_influence.sort_by(|left, right| {
            right
                .influence
                .cmp(&left.influence)
                .then_with(|| left.faction_id.cmp(&right.faction_id))
        });
        LocationSimulationView {
            weather: state.weather,
            weather_intensity: state.weather_intensity,
            trade_stock: state.trade_stock,
            trade_pressure: state.trade_pressure,
            imports: state.imports,
            conflict_pressure: state.conflict_pressure,
            faction_influence,
            last_pulse_tick: state.last_pulse_tick,
        }
    }

    pub(super) fn world_simulation_view(&self) -> WorldSimulationView {
        let mut factions = active_content()
            .factions
            .iter()
            .map(|seed_faction| {
                let state = self
                    .world_simulation
                    .factions
                    .get(&seed_faction.id)
                    .cloned()
                    .unwrap_or_default();
                let mut influenced_location_ids = self
                    .world_simulation
                    .locations
                    .iter()
                    .filter(|(_, location)| {
                        location
                            .faction_influence
                            .get(&seed_faction.id)
                            .is_some_and(|influence| *influence > 0)
                    })
                    .map(|(location_id, _)| *location_id)
                    .collect::<Vec<_>>();
                influenced_location_ids.sort_unstable();
                FactionSimulationView {
                    faction_id: seed_faction.id.clone(),
                    faction_name: seed_faction.name.clone(),
                    momentum: state.momentum,
                    last_action_tick: state.last_action_tick,
                    influenced_location_ids,
                }
            })
            .collect::<Vec<_>>();
        factions.sort_by(|left, right| left.faction_id.cmp(&right.faction_id));
        let mut recent_history = self
            .event_log
            .iter()
            .rev()
            .filter(|event| {
                matches!(
                    event.type_name.as_str(),
                    "world.weather.shifted"
                        | "world.trade.flowed"
                        | "world.trade.disrupted"
                        | "world.faction.influence_shifted"
                        | "world.conflict.pressure_grew"
                        | "world.conflict.pressure_eased"
                        | "world.conflict.escalated"
                )
            })
            .take(48)
            .cloned()
            .collect::<Vec<_>>();
        recent_history.sort_by(|left, right| {
            right
                .source_world_tick
                .cmp(&left.source_world_tick)
                .then_with(|| left.seq.cmp(&right.seq))
        });
        WorldSimulationView {
            pulse_interval_ticks: WORLD_PULSE_INTERVAL_TICKS,
            pulse_index: self.world_simulation.pulse_index,
            last_advanced_tick: self.world_simulation.last_advanced_tick,
            factions,
            recent_history,
        }
    }

    pub(super) fn journey_view(&self, actor_id: u64) -> Option<JourneyView> {
        let journey = self.journey_at_actor_location(actor_id)?;
        let total_steps = journey.path.len().saturating_sub(1);
        let current_location_id = journey.path.get(journey.current_step).copied();
        let next_location_id = journey.path.get(journey.current_step + 1).copied();
        Some(JourneyView {
            destination_location_id: journey.destination_location_id,
            destination_name: journey.destination_name.clone(),
            current_step: journey.current_step,
            total_steps,
            steps_remaining: total_steps.saturating_sub(journey.current_step),
            explorer: journey.explorer,
            next_location_id,
            next_location_name: next_location_id.and_then(|id| {
                if id >= GENERATED_PATHWAY_LOCATION_ID_BASE {
                    let revealed = current_location_id.is_some_and(|current_id| {
                        self.generated_pathways
                            .get(&journey.pathway_id)
                            .is_some_and(|pathway| {
                                pathway
                                    .revealed_edges
                                    .contains(&pathway_edge_key(current_id, id))
                            })
                    });
                    if revealed {
                        self.location_name(id).or_else(|| {
                            self.generated_pathways
                                .get(&journey.pathway_id)
                                .and_then(|pathway| {
                                    pathway.waypoints.iter().find(|waypoint| waypoint.id == id)
                                })
                                .map(|waypoint| waypoint.name.clone())
                        })
                    } else {
                        Some(format!(
                            "Unexplored stretch {}/{} toward {}",
                            journey.current_step + 1,
                            total_steps,
                            journey.destination_name
                        ))
                    }
                } else {
                    self.location_name(id)
                }
            }),
        })
    }

    pub(super) fn actor_view(&self, actor: CwActor) -> ActorView {
        self.actor_view_for_client(actor, None)
    }

    fn expedition_ring_view(&self, actor_id: u64) -> ExpeditionRingView {
        let pip_total = self.frontier_travel_since_rest_required(actor_id) as u8;
        let filled_count = self.frontier_travel_since_rest_count(actor_id) as u8;
        ExpeditionRingView {
            filled_count,
            pip_total,
            needs_rest: filled_count >= pip_total,
        }
    }

    pub(super) fn actor_view_for_client(
        &self,
        actor: CwActor,
        client_actor_id: Option<u64>,
    ) -> ActorView {
        let meta = self.actors.get(&actor.id);
        ActorView {
            id: actor.id,
            canonical_ref: self
                .canonical_ref("actor", actor.id)
                .unwrap_or_default()
                .to_string(),
            entity_version: self
                .canonical_ref("actor", actor.id)
                .map(|canonical_ref| self.entity_version(canonical_ref))
                .unwrap_or_default(),
            pack_id: seed_pack_id_for_actor(actor.id),
            name: meta
                .map(|m| m.name.clone())
                .unwrap_or_else(|| format!("Actor {}", actor.id)),
            title: meta.map(|m| m.title.clone()).unwrap_or_default(),
            description: meta.map(|m| m.description.clone()).unwrap_or_default(),
            practice: self.actor_practice_view(actor.id),
            control_mode: self.actor_control_mode(actor.id),
            kind: actor_kind(actor.kind).to_string(),
            status: actor_status(actor.status).to_string(),
            speech_mode: meta
                .map(|m| m.speech_mode.clone())
                .unwrap_or_else(|| "prose".to_string()),
            muted_by_you: client_actor_id
                .is_some_and(|client_id| self.actor_muted(client_id, actor.id)),
            blocked_by_you: client_actor_id.is_some_and(|client_id| {
                self.actor_safety
                    .get(&client_id)
                    .is_some_and(|safety| safety.blocked_actor_ids.contains(&actor.id))
            }),
            location_id: actor.location_id,
            relationship: self.relationship_preview(actor.id),
            factions: faction_refs_for_actor(actor.id),
            resident_economy: self.resident_economy_view(actor, client_actor_id),
            expedition_ring: self.expedition_ring_view(actor.id),
            hp: unsafe { cw_actor_current_hp(&actor) },
            bloodied: unsafe { cw_actor_is_bloodied(&actor) != 0 },
            stats: StatView {
                strength: actor.stats.strength,
                dexterity: actor.stats.dexterity,
                constitution: actor.stats.constitution,
                intelligence: actor.stats.intelligence,
                wisdom: actor.stats.wisdom,
                charisma: actor.stats.charisma,
                hp_base: actor.stats.hp_base,
                level: actor.stats.level,
            },
        }
    }

    fn actor_safety_view(&self, client_actor_id: Option<u64>) -> ActorSafetyView {
        let Some(client_actor_id) = client_actor_id else {
            return ActorSafetyView::default();
        };
        let safety = self
            .actor_safety
            .get(&client_actor_id)
            .cloned()
            .unwrap_or_default();
        let transfer_view = |offer: &TransferOfferState| TransferOfferView {
            id: offer.id.clone(),
            kind: offer.kind,
            offered_by_actor_id: offer.offered_by_actor_id,
            offered_by_actor_name: self
                .actor_name(offer.offered_by_actor_id)
                .unwrap_or_else(|| format!("Avatar {}", offer.offered_by_actor_id)),
            offered_to_actor_id: offer.offered_to_actor_id,
            offered_to_actor_name: self
                .actor_name(offer.offered_to_actor_id)
                .unwrap_or_else(|| format!("Avatar {}", offer.offered_to_actor_id)),
            offered_item_id: offer.offered_item_id,
            offered_item_name: self
                .item_name(offer.offered_item_id)
                .unwrap_or_else(|| format!("Item {}", offer.offered_item_id)),
            requested_item_id: offer.requested_item_id,
            requested_item_name: offer
                .requested_item_id
                .and_then(|item_id| self.item_name(item_id)),
            expires_tick: offer.expires_tick,
            can_accept: offer.offered_to_actor_id == client_actor_id,
            can_decline: offer.offered_to_actor_id == client_actor_id,
            can_withdraw: offer.offered_by_actor_id == client_actor_id,
        };
        let mut incoming_offers = self
            .transfer_offers
            .values()
            .filter(|offer| {
                offer.offered_to_actor_id == client_actor_id
                    && self.transfer_offer_status(offer) == TransferOfferStatus::Pending
            })
            .map(transfer_view)
            .collect::<Vec<_>>();
        let mut outgoing_offers = self
            .transfer_offers
            .values()
            .filter(|offer| {
                offer.offered_by_actor_id == client_actor_id
                    && self.transfer_offer_status(offer) == TransferOfferStatus::Pending
            })
            .map(transfer_view)
            .collect::<Vec<_>>();
        let mut gift_auto_accepts = self
            .gift_auto_accepts
            .values()
            .filter(|policy| {
                policy.recipient_actor_id == client_actor_id
                    && !policy.consumed
                    && self.world.tick < policy.expires_tick
            })
            .map(|policy| GiftAutoAcceptView {
                id: policy.id.clone(),
                offered_by_actor_id: policy.offered_by_actor_id,
                offered_by_actor_name: self
                    .actor_name(policy.offered_by_actor_id)
                    .unwrap_or_else(|| format!("Avatar {}", policy.offered_by_actor_id)),
                item_id: policy.item_id,
                item_name: self
                    .item_name(policy.item_id)
                    .unwrap_or_else(|| format!("Item {}", policy.item_id)),
                expires_tick: policy.expires_tick,
            })
            .collect::<Vec<_>>();
        incoming_offers.sort_by(|left, right| left.id.cmp(&right.id));
        outgoing_offers.sort_by(|left, right| left.id.cmp(&right.id));
        gift_auto_accepts.sort_by(|left, right| left.id.cmp(&right.id));
        ActorSafetyView {
            muted_actor_ids: safety.muted_actor_ids.into_iter().collect(),
            blocked_actor_ids: safety.blocked_actor_ids.into_iter().collect(),
            incoming_offers,
            outgoing_offers,
            gift_auto_accepts,
        }
    }

    pub(super) fn item_view(&self, item: CwItem) -> ItemView {
        let meta = self.items.get(&item.id);
        ItemView {
            id: item.id,
            canonical_ref: self
                .canonical_ref("item", item.id)
                .unwrap_or_default()
                .to_string(),
            entity_version: self
                .canonical_ref("item", item.id)
                .map(|canonical_ref| self.entity_version(canonical_ref))
                .unwrap_or_default(),
            pack_id: seed_pack_id_for_item(item.id),
            name: meta
                .map(|m| m.name.clone())
                .unwrap_or_else(|| format!("Item {}", item.id)),
            description: meta.map(|m| m.description.clone()).unwrap_or_default(),
            kind: item_kind(item.kind).to_string(),
            role: item_role(item.role).to_string(),
            weight_tenths: effective_item_weight_tenths(item),
            size: item_size(item.size_class).to_string(),
            container_capacity_tenths: if item.role == CW_ITEM_ROLE_CONTAINER {
                item.container_capacity_tenths
            } else {
                0
            },
            skill_id: meta.and_then(|meta| meta.skill_id.clone()),
            skill_bonus: meta.map(|meta| meta.skill_bonus).unwrap_or_default(),
            mechanics: meta.and_then(|meta| meta.mechanics.clone()),
            zone: card_zone(item.zone, item.holder_actor_id, item.location_id).to_string(),
            container_item_id: opt_id(item.container_item_id),
            provenance: self.item_provenance.get(&item.id).cloned(),
            location_id: opt_id(item.location_id),
            holder_actor_id: opt_id(item.holder_actor_id),
            charges: item.charges,
        }
    }

    pub(super) fn resident_held_item_view(
        &self,
        resident: CwActor,
        item: CwItem,
        client_actor_id: Option<u64>,
    ) -> ResidentHeldItemView {
        let resident_name = self
            .actor_name(resident.id)
            .unwrap_or_else(|| format!("Avatar {}", resident.id));
        let item_name = self
            .item_name(item.id)
            .unwrap_or_else(|| format!("Item {}", item.id));
        let keep_score = self.resident_item_keep_score(resident, item);
        let (disposition, reason) = if evolution_item_matches_resident(item.id, resident.id) {
            (
                "identity",
                format!("{resident_name} protects {item_name} because it belongs to their evolution track."),
            )
        } else if self.resident_item_has_feature_use_attachment(resident.id, item.id) {
            (
                "keepsake",
                format!("{resident_name} keeps {item_name} because it mattered in a room moment."),
            )
        } else if let Some(attachment) =
            self.resident_personal_attachment_for_item(resident.id, item.id)
        {
            (
                "attached",
                format!(
                    "{resident_name} protects {item_name}: {}",
                    attachment.reason.trim_end_matches('.')
                ),
            )
        } else if !evolution_item_belongs_to_another_resident(item.id, resident.id)
            && item.holder_actor_id == resident.id
            && item.held_since_tick > 0
            && self.world.tick.saturating_sub(item.held_since_tick) >= 12
        {
            (
                "attached",
                format!("{resident_name} has carried {item_name} long enough to become attached."),
            )
        } else if item.kind == CW_ITEM_POTION && self.resident_healing_target(resident).is_some() {
            (
                "medicine",
                format!("{resident_name} keeps {item_name} as medicine for someone nearby."),
            )
        } else if self
            .resident_feature_use_match_for_item(resident, item.id)
            .is_some()
        {
            (
                "useful",
                format!("{resident_name} can use {item_name} with this room."),
            )
        } else {
            (
                "tradeable",
                format!("{resident_name} may trade {item_name} for something more useful."),
            )
        };
        let mut available_actions = Vec::new();
        if let Some(viewer_actor_id) = client_actor_id {
            if self.gift_request_is_valid(viewer_actor_id, resident.id, item.id) {
                available_actions.push("request".to_string());
            }
            if self
                .accepted_item_trade_candidates(viewer_actor_id)
                .into_iter()
                .any(|candidate| {
                    candidate.target.id == resident.id && candidate.target_item.id == item.id
                })
            {
                available_actions.push("trade".to_string());
            }
            if self
                .default_theft_candidate(viewer_actor_id)
                .is_some_and(|(target, candidate)| {
                    target.id == resident.id && candidate.id == item.id
                })
            {
                available_actions.push("steal".to_string());
            }
        }
        ResidentHeldItemView {
            item_id: item.id,
            disposition: disposition.to_string(),
            reason,
            keep_score,
            available_actions,
        }
    }

    pub(super) fn resident_sought_item_view(
        &self,
        resident: CwActor,
        item_id: u64,
    ) -> ResidentSoughtItemView {
        let memory = self.resident_best_item_memory(resident.id, item_id);
        let world_item = self.item_by_id(item_id);
        let world_status = world_item
            .map(|item| {
                if item.charges == 0 {
                    "spent"
                } else if item.holder_actor_id != 0 {
                    "held"
                } else if item.location_id != 0 {
                    "available"
                } else {
                    "hidden"
                }
            })
            .unwrap_or("missing")
            .to_string();
        let world_holder_actor_id = world_item.and_then(|item| opt_id(item.holder_actor_id));
        let world_location_id = world_item.and_then(|item| {
            world_holder_actor_id
                .and_then(|holder_actor_id| self.actor_by_id(holder_actor_id))
                .map(|holder| holder.location_id)
                .or_else(|| opt_id(item.location_id))
                .or_else(|| {
                    (item.charges > 0).then(|| {
                        active_content()
                            .items
                            .iter()
                            .find(|seed_item| seed_item.id == item_id)
                            .map(|seed_item| seed_item.location_id)
                    })?
                })
        });
        ResidentSoughtItemView {
            item_id,
            source: self
                .resident_sought_item_source(resident, item_id)
                .to_string(),
            reason: self.resident_item_request_reason(resident, item_id),
            world_status,
            world_location_id,
            world_location_name: world_location_id
                .and_then(|location_id| self.location_name(location_id)),
            world_holder_actor_id,
            world_holder_actor_name: world_holder_actor_id
                .and_then(|holder_actor_id| self.actor_name(holder_actor_id)),
            memory_location_id: memory.as_ref().map(|memory| memory.location_id),
            memory_location_name: memory
                .as_ref()
                .and_then(|memory| self.location_name(memory.location_id)),
            holder_actor_id: memory.as_ref().and_then(|memory| memory.related_actor_id),
            holder_actor_name: memory
                .as_ref()
                .and_then(|memory| memory.related_actor_id)
                .and_then(|holder_actor_id| self.actor_name(holder_actor_id)),
            confidence: memory.as_ref().map(|memory| memory.confidence),
            salience: memory.as_ref().map(|memory| memory.salience),
        }
    }

    pub(super) fn resident_request_for_holder(
        &self,
        resident: CwActor,
        holder_actor_id: u64,
    ) -> Option<ResidentRequestView> {
        let holder = self.actor_by_id(holder_actor_id)?;
        if !Self::actor_can_act(holder) || holder.location_id != resident.location_id {
            return None;
        }

        let mut candidates: Vec<_> = self
            .actor_held_items(holder_actor_id)
            .into_iter()
            .filter(|item| self.resident_item_is_sought(resident, item.id))
            .map(|item| (self.resident_item_offer_score(resident, item), item.id))
            .collect();
        candidates.sort_by(|left, right| right.0.cmp(&left.0).then_with(|| left.1.cmp(&right.1)));
        let (_, item_id) = candidates.into_iter().next()?;
        Some(ResidentRequestView {
            item_id,
            holder_actor_id,
            reason: self.resident_item_request_reason(resident, item_id),
        })
    }

    pub(super) fn resident_economy_view(
        &self,
        resident: CwActor,
        client_actor_id: Option<u64>,
    ) -> Option<ResidentEconomyView> {
        if !Self::actor_can_act(resident) {
            return None;
        }
        if let Some(viewer_actor_id) = client_actor_id {
            if !self.economy_known_by(viewer_actor_id, resident.id) {
                return None;
            }
        }
        let held_items_raw = self.actor_held_items(resident.id);
        let inventory_count = held_items_raw.len();
        let held_item_ids: Vec<_> = held_items_raw.iter().map(|item| item.id).collect();
        let held_items = held_items_raw
            .iter()
            .copied()
            .map(|item| self.resident_held_item_view(resident, item, client_actor_id))
            .collect();
        let desired_item_ids = self.resident_desired_item_ids(resident);
        let sought_item_ids = self.resident_sought_item_ids(resident);
        let sought_items = sought_item_ids
            .iter()
            .copied()
            .map(|item_id| self.resident_sought_item_view(resident, item_id))
            .collect();
        let attached_item_ids = self.resident_attached_item_ids(resident.id);
        let seek_memory = self.belief_seek_target(resident);
        let seeking_item_id = seek_memory.as_ref().map(|memory| memory.subject_id);
        let seeking_location_id = seek_memory.as_ref().map(|memory| memory.location_id);
        let seeking_location_name =
            seeking_location_id.and_then(|location_id| self.location_name(location_id));
        let delivery = self.resident_delivery_candidate(resident);
        let request = client_actor_id
            .and_then(|actor_id| self.resident_request_for_holder(resident, actor_id));
        let trade_stance_candidate = client_actor_id.and_then(|actor_id| {
            self.default_item_trade_stance_candidate_for_target(actor_id, resident.id)
        });
        let direct_consent = self.actor_control_mode(resident.id).is_direct_input();
        let trade_offer = trade_stance_candidate
            .as_ref()
            .filter(|candidate| direct_consent || candidate.preference.accepted)
            .map(|candidate| ResidentTradeOfferView {
                offered_item_id: candidate.offered_item.id,
                requested_item_id: candidate.target_item.id,
                willingness: if direct_consent {
                    "awaits consent".to_string()
                } else {
                    candidate.preference.willingness.to_string()
                },
                reason: if direct_consent {
                    format!(
                        "Only {} can accept this exchange.",
                        self.actor_name(resident.id)
                            .unwrap_or_else(|| format!("Avatar {}", resident.id))
                    )
                } else {
                    candidate.preference.reason.clone()
                },
            });
        let trade_stance = (!direct_consent)
            .then(|| {
                trade_stance_candidate
                    .as_ref()
                    .map(|candidate| ResidentTradeStanceView {
                        offered_item_id: candidate.offered_item.id,
                        requested_item_id: candidate.target_item.id,
                        willingness: candidate.preference.willingness.to_string(),
                        reason: candidate.preference.reason.clone(),
                        accepted: candidate.preference.accepted,
                    })
            })
            .flatten();
        let resident_name = self
            .actor_name(resident.id)
            .unwrap_or_else(|| format!("Avatar {}", resident.id));
        let healing_supply_motive = self
            .resident_needs_medicine(resident)
            .then(|| {
                let target_name = self
                    .resident_healing_target(resident)
                    .and_then(|target| self.actor_name(target.id))
                    .unwrap_or_else(|| "someone here".to_string());
                if self
                    .versioned_craft_plan(resident.id, HEARTH_TONIC_RECIPE_ID, None)
                    .is_some()
                {
                    format!(
                        "{resident_name} can draw a Hearth Tonic from the Cottage hearth to help {target_name}."
                    )
                } else {
                    format!(
                        "{resident_name} cannot help {target_name} yet: no usable potion is available here. A Hearth Tonic can be drawn from the Cottage hearth."
                    )
                }
            });
        let motive = if let Some(request) = request.as_ref() {
            if let Some(holder_name) = self.actor_name(request.holder_actor_id) {
                let reason = request.reason.trim_end_matches('.');
                format!("{reason} from {holder_name}.")
            } else {
                request.reason.clone()
            }
        } else if let Some(delivery) = delivery.as_ref() {
            let item_name = self
                .item_name(delivery.actor_item.id)
                .unwrap_or_else(|| format!("Item {}", delivery.actor_item.id));
            let target_name = self
                .actor_name(delivery.target.id)
                .unwrap_or_else(|| format!("Avatar {}", delivery.target.id));
            let location_name = self
                .location_name(delivery.target_location_id)
                .unwrap_or_else(|| format!("Location {}", delivery.target_location_id));
            format!("{resident_name} is carrying {item_name} toward {target_name} near {location_name}.")
        } else if let (Some(item_id), Some(location_name)) =
            (seeking_item_id, seeking_location_name.as_deref())
        {
            let item_name = self
                .item_name(item_id)
                .unwrap_or_else(|| format!("Item {item_id}"));
            if let Some(holder_name) = seek_memory
                .as_ref()
                .and_then(|memory| memory.related_actor_id)
                .and_then(|holder_actor_id| self.actor_name(holder_actor_id))
            {
                format!(
                    "{resident_name} remembers {item_name} with {holder_name} near {location_name}."
                )
            } else {
                format!("{resident_name} remembers {item_name} near {location_name}.")
            }
        } else if let Some(motive) = healing_supply_motive {
            motive
        } else if !sought_item_ids.is_empty() {
            format!(
                "{resident_name} seeks {}.",
                self.item_list_label(&sought_item_ids)
            )
        } else if !attached_item_ids.is_empty() {
            format!(
                "{resident_name} is attached to {}.",
                self.item_list_label(&attached_item_ids)
            )
        } else if !held_item_ids.is_empty() {
            format!(
                "{resident_name} carries {} and may trade for something more useful.",
                self.item_list_label(&held_item_ids)
            )
        } else {
            format!("{resident_name} is open to useful gifts and trades.")
        };
        Some(ResidentEconomyView {
            held_item_ids,
            held_items,
            inventory_count,
            inventory_capacity: 0,
            carried_weight_tenths: self.actor_carried_weight_tenths(resident.id),
            carrying_capacity_tenths: self
                .actor_carrying_capacity_tenths(resident.id)
                .unwrap_or_default(),
            desired_item_ids,
            sought_item_ids,
            sought_items,
            attached_item_ids,
            seeking_item_id,
            seeking_location_id,
            seeking_location_name,
            request,
            trade_offer,
            trade_stance,
            motive,
        })
    }

    pub(super) fn exit_views(
        &self,
        actor_id: Option<u64>,
        location_id: u64,
        access: &AccessContext,
    ) -> Vec<ExitView> {
        self.world.exits[..self.world.exit_count]
            .iter()
            .copied()
            .filter(|exit| exit.from_location_id == location_id)
            .filter(|exit| {
                self.exit_discovered_for_projection(exit.from_location_id, exit.to_location_id)
            })
            .filter_map(|exit| {
                let route = self.route_for_edge(exit.from_location_id, exit.to_location_id)?;
                let threshold = actor_id.and_then(|actor_id| {
                    self.threshold_offer_binding_for_exit_with_access(
                        actor_id,
                        exit.from_location_id,
                        exit.to_location_id,
                        access,
                    )
                });
                let locked = threshold
                    .as_ref()
                    .map(|(_, allowed)| !allowed)
                    .unwrap_or(exit.flags & CW_EXIT_LOCKED != 0);
                let access_rule = location_access_rule(exit.to_location_id);
                let accessible = location_access_allowed(exit.to_location_id, access);
                Some(ExitView {
                    route_id: route.id.clone(),
                    route_version: route.entity_version,
                    destination_location_id: exit.to_location_id,
                    destination_location_name: self
                        .location_name(exit.to_location_id)
                        .unwrap_or_else(|| format!("Location {}", exit.to_location_id)),
                    route_label: self
                        .route_label_for_edge(exit.from_location_id, exit.to_location_id),
                    direction: self.exit_direction(exit.from_location_id, exit.to_location_id),
                    distance: self.pathway_distance(exit.from_location_id, exit.to_location_id),
                    locked,
                    accessible,
                    required_grant_id: access_rule.required_grant_id.map(ToString::to_string),
                    required_card_id: access_rule.required_card_id.map(ToString::to_string),
                    access_reason: if accessible {
                        None
                    } else {
                        access_rule.reason.map(ToString::to_string)
                    },
                    threshold: threshold.map(|(binding, _)| binding),
                })
            })
            .collect()
    }

    #[cfg(test)]
    pub(super) fn state_response(
        &self,
        actor_id: Option<u64>,
        access: &AccessContext,
    ) -> StateResponse {
        self.state_response_with_presence(actor_id, access, None, false)
    }

    pub(super) fn state_response_with_presence(
        &self,
        actor_id: Option<u64>,
        access: &AccessContext,
        active_direct_actor_ids: Option<&BTreeSet<u64>>,
        _openrouter_connected: bool,
    ) -> StateResponse {
        let client_actor_id = actor_id.filter(|id| self.client_actor_can_observe(*id));
        let actor = client_actor_id.and_then(|id| self.actor_by_id(id));
        let location_id = actor.map(|actor| actor.location_id).unwrap_or(1);
        let location = self.location_view(location_id);

        let projection_viewer_id = Some(client_actor_id.unwrap_or_default());
        let actors: Vec<ActorView> = self.world.actors[..self.world.actor_count]
            .iter()
            .copied()
            .filter(|actor| actor.location_id == location_id)
            .filter(|actor| {
                self.actor_visible_in_projection(*actor, client_actor_id, active_direct_actor_ids)
            })
            .map(|actor| self.actor_view_for_client(actor, projection_viewer_id))
            .collect();
        let visible_actor_ids = actors.iter().map(|actor| actor.id).collect::<BTreeSet<_>>();

        let items: Vec<ItemView> = self.world.items[..self.world.item_count]
            .iter()
            .copied()
            .filter(|item| {
                (item.location_id == location_id
                    && !self.forgotten_search_item_at_location(*item, location_id))
                    || client_actor_id.is_some_and(|id| {
                        item.holder_actor_id == id
                            || (visible_actor_ids.contains(&item.holder_actor_id)
                                && self.economy_known_by(id, item.holder_actor_id))
                    })
            })
            .map(|item| self.item_view(item))
            .collect();

        let exits = self.exit_views(client_actor_id, location_id, access);
        let cards =
            self.card_registry_for(&location, &actors, &items, &exits, access, client_actor_id);
        let card_transactions =
            self.card_transaction_views(location_id, &actors, &items, &exits, &cards);
        let access_view = access_view(access, &cards.locations);
        let orbs = client_actor_id.map(|id| self.orb_balance(id)).unwrap_or(0);
        let listen_reward_claimable = client_actor_id
            .map(|id| self.listen_reward_claimable(id))
            .unwrap_or(false);
        let listen_attempted_here = client_actor_id
            .map(|id| self.listen_attempted_here(id))
            .unwrap_or(false);
        let listen_cost_orbs = client_actor_id
            .map(|id| self.listen_cost_orbs(id))
            .unwrap_or(0);
        let chat_bond_claimed_target_ids = client_actor_id
            .map(|id| self.chat_bond_claimed_target_ids(id, location_id))
            .unwrap_or_default();
        let (primary_action, action_offers) = self.legal_action_candidates_with_presence(
            client_actor_id,
            access,
            active_direct_actor_ids,
        );
        let action_hand = self.action_hand_for(client_actor_id, &action_offers);
        let visible_action_offers = action_hand
            .entries
            .iter()
            .filter_map(|entry| {
                action_offers
                    .iter()
                    .find(|offer| offer.offer_id == entry.offer_id)
                    .cloned()
            })
            .collect::<Vec<_>>();
        let mut visible_primary_action = primary_action.clone();
        let hand_kinds = visible_action_offers
            .iter()
            .map(|offer| offer.kind.as_str())
            .collect::<BTreeSet<_>>();
        visible_primary_action
            .options
            .retain(|option| hand_kinds.contains(option.kind.as_str()));
        if let Some(offer) = visible_action_offers.first() {
            visible_primary_action.kind = if offer.kind == "move" {
                "travel".to_string()
            } else {
                offer.kind.clone()
            };
            visible_primary_action.label = offer.verb.clone();
            visible_primary_action.command = offer.command.clone();
            visible_primary_action.disabled = offer.disabled;
        }
        let shared_questions = self.shared_question_views_with_actions(
            location_id,
            client_actor_id,
            &action_offers,
            &action_hand,
        );
        let inspector = self.inspector_view(
            location_id,
            client_actor_id,
            &primary_action,
            &action_offers,
            &action_hand,
        );
        let recent_events = self
            .event_log
            .iter()
            .filter(|event| {
                event_visible_in_location(event, location_id)
                    && !client_actor_id.is_some_and(|actor_id| {
                        event
                            .actor_id
                            .is_some_and(|source_id| self.actor_muted(actor_id, source_id))
                    })
            })
            .rev()
            .take(80)
            .cloned()
            .collect::<Vec<_>>();
        let journal_beats = journal_beat_views(&recent_events, location_id);
        let room_memory = fallback_room_memory_view(&location, &recent_events);
        StateResponse {
            world_id: OFFICIAL_WORLD_ID.to_string(),
            world_epoch: OFFICIAL_WORLD_EPOCH,
            world_seq: self.world.next_event_seq.saturating_sub(1),
            state_revision: self.current_state_revision(),
            rules_context: self
                .scene_rules_context(location_id, self.world.next_event_seq.saturating_sub(1)),
            location,
            exits,
            actors,
            items,
            factions: faction_views(),
            room_features: Vec::new(),
            scene_notices: client_actor_id
                .map(|id| self.discovery_scene_notices(id))
                .unwrap_or_default(),
            search_available: client_actor_id
                .map(|id| self.default_search_target(id).is_some())
                .unwrap_or(false),
            clocks: self.clock_views(location_id),
            shared_questions,
            tags: self.tag_views(client_actor_id, location_id),
            jobs: self.job_views(location_id),
            fronts: self.front_views(location_id),
            room_sheet: self.room_sheet_view(location_id),
            journey: client_actor_id.and_then(|id| self.journey_view(id)),
            first_tale: client_actor_id.and_then(|id| self.first_tale_view(id)),
            calling: client_actor_id.and_then(|id| self.calling_view(id)),
            skills: client_actor_id
                .map(|id| self.skill_views(id))
                .unwrap_or_default(),
            ledger: client_actor_id
                .map(|id| self.visit_ledger_view(id))
                .unwrap_or_else(empty_visit_ledger_view),
            bonds: client_actor_id
                .map(|id| self.bond_views(id))
                .unwrap_or_default(),
            chat_bond_claimed_target_ids,
            cards,
            card_transactions,
            access: access_view,
            account: account_view(access),
            economy: EconomyView {
                orbs,
                chat_cost_orbs: 0,
                can_chat_with_orbs: false,
                inventory_count: client_actor_id
                    .map(|id| self.actor_inventory_count(id))
                    .unwrap_or_default(),
                inventory_capacity: 0,
                carried_weight_tenths: client_actor_id
                    .map(|id| self.actor_carried_weight_tenths(id))
                    .unwrap_or_default(),
                base_carrying_capacity_tenths: client_actor_id
                    .and_then(|id| self.actor_base_carrying_capacity_tenths(id))
                    .unwrap_or_default(),
                container_capacity_tenths: client_actor_id
                    .map(|id| self.actor_container_capacity_tenths(id))
                    .unwrap_or_default(),
                carrying_capacity_tenths: client_actor_id
                    .and_then(|id| self.actor_carrying_capacity_tenths(id))
                    .unwrap_or_default(),
                encumbered: client_actor_id.is_some_and(|id| {
                    self.actor_carried_weight_tenths(id)
                        > self.actor_carrying_capacity_tenths(id).unwrap_or_default()
                }),
                listen_cost_orbs,
                listen_reward_claimable,
                listen_attempted_here,
                openrouter_connected: false,
                chat_payer: "cosyworld_system".to_string(),
                wooden_boxes: access.owned_box_ids.len(),
                unopened_packs: access.unopened_pack_ids.len(),
            },
            deck: self.deck_view(client_actor_id),
            combat: client_actor_id.and_then(|id| self.combat_view(id, access)),
            turn: RoomTurnView::idle(location_id),
            branch: None,
            safety: self.actor_safety_view(client_actor_id),
            recent_events,
            journal_beats,
            room_memory,
            primary_action,
            visible_primary_action,
            action_offers,
            visible_action_offers,
            action_hand,
            inspector,
            character_creation: character_creation_views(),
            character_identity: client_actor_id
                .and_then(|actor_id| self.character_identity_view(actor_id)),
        }
    }

    pub(super) fn character_identity_view(&self, actor_id: u64) -> Option<CharacterIdentityView> {
        let identity = self.character_identities.get(&actor_id)?;
        let profile = character_creation_profile(Some(&identity.profile_id))?;
        let species_label = profile
            .species
            .iter()
            .find(|card| card.id == identity.species_id)
            .map(|card| card.label.clone())
            .unwrap_or_else(|| identity.species_id.clone());
        let origin_label = profile
            .origins
            .iter()
            .find(|card| card.id == identity.origin_id)
            .map(|card| card.label.clone())
            .unwrap_or_else(|| identity.origin_id.clone());
        let class_label = identity.class_id.as_ref().map(|class_id| {
            profile
                .choices
                .iter()
                .find(|choice| choice.id == *class_id)
                .map(|choice| choice.label.clone())
                .unwrap_or_else(|| class_id.clone())
        });
        let class_recommendation = identity
            .class_readiness_evidence
            .as_ref()
            .and_then(|evidence| {
                profile
                    .class_recommendations
                    .iter()
                    .find(|recommendation| recommendation.offer_kind == evidence.offer_kind)
            })
            .and_then(|recommendation| {
                profile
                    .choices
                    .iter()
                    .find(|choice| choice.id == recommendation.class_id)
                    .map(|choice| CharacterClassRecommendationView {
                        class_id: recommendation.class_id.clone(),
                        class_label: choice.label.clone(),
                        explanation: recommendation.explanation.clone(),
                    })
            });
        Some(CharacterIdentityView {
            profile_id: identity.profile_id.clone(),
            species_id: identity.species_id.clone(),
            species_label,
            origin_id: identity.origin_id.clone(),
            origin_label,
            class_id: identity.class_id.clone(),
            class_label,
            class_selection_ready: identity.class_selection_ready,
            qualifying_world_actions: identity.qualifying_world_actions,
            class_readiness_evidence: identity.class_readiness_evidence.clone(),
            class_recommendation,
            level: self
                .actor_by_id(actor_id)
                .map(|actor| actor.stats.level)
                .unwrap_or_default(),
        })
    }

    pub(super) fn combat_view(&self, actor_id: u64, access: &AccessContext) -> Option<CombatView> {
        let encounter = self.active_combat_encounter_for_actor(actor_id)?;
        let current_actor_id = encounter
            .participants
            .get(usize::from(encounter.current_index))?
            .actor_id;
        let is_current_actor = current_actor_id == actor_id;
        let need_time_used = combat_need_time_used(self, encounter.id, current_actor_id);
        let mut available_actions = Vec::new();
        if is_current_actor {
            available_actions.extend(["attack", "dodge", "pass", "need_time"]);
            if self.has_accessible_exit(actor_id, access) {
                available_actions.push("escape");
            }
        }
        let participants = encounter.participants[..encounter.participant_count]
            .iter()
            .filter_map(|participant| {
                let actor = self.actor_by_id(participant.actor_id)?;
                Some(CombatParticipantView {
                    actor_id: actor.id,
                    actor_name: self.actor_name(actor.id),
                    side: participant.side,
                    initiative: participant.initiative,
                    status: actor_status(actor.status),
                    current_hp: unsafe { cw_actor_current_hp(&actor) },
                    max_hp: actor.stats.hp_base,
                    dodging: actor.conditions & CW_CONDITION_DODGING != 0,
                    unconscious: actor.conditions & CW_CONDITION_UNCONSCIOUS != 0,
                    escaped: participant.flags & CW_COMBAT_PARTICIPANT_ESCAPED != 0,
                })
            })
            .collect();
        Some(CombatView {
            protocol: "cosyworld.combat/4",
            concurrency_policy: ConcurrencyPolicy::SceneTurn.as_str(),
            turn_rule:
                "Combat is ordered. The named participant acts; chat and inspection stay available.",
            encounter_id: encounter.id,
            location_id: encounter.location_id,
            round: encounter.round,
            current_actor_id,
            current_actor_name: self.actor_name(current_actor_id),
            is_current_actor,
            available_actions,
            grace_period_ms: ORDERED_SCENE_BASE_GRACE_MS.saturating_add(
                need_time_used
                    .then_some(ORDERED_SCENE_NEED_TIME_MS)
                    .unwrap_or_default(),
            ),
            need_time_extension_ms: ORDERED_SCENE_NEED_TIME_MS,
            can_pass: is_current_actor,
            can_need_time: is_current_actor && !need_time_used,
            participants,
        })
    }

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
                let searched = explicitly_searched
                    || (!hidden_exit_pending
                        && !search_reveal_pending
                        && !self.room_floor_empty(location_id));
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

    pub(super) fn clock_views(&self, location_id: u64) -> Vec<ClockView> {
        let mut clock_ids = Vec::new();
        let mut push_clock_id = |clock_id: &str| {
            if !clock_ids.iter().any(|existing| existing == clock_id) {
                clock_ids.push(clock_id.to_string());
            }
        };
        for job in self
            .jobs
            .values()
            .filter(|job| job.location_ids.contains(&location_id))
            .filter(|job| self.job_status(job) == "active")
        {
            push_clock_id(&job.progress_clock_id);
            push_clock_id(&job.danger_clock_id);
        }
        for clock in self.clocks.values().filter(|clock| {
            clock.visible_to_players && clock.scope == "room" && clock.scope_id == location_id
        }) {
            push_clock_id(&clock.id);
        }
        clock_ids
            .into_iter()
            .filter_map(|clock_id| self.clocks.get(&clock_id))
            .filter(|clock| clock.visible_to_players)
            .map(|clock| ClockView {
                id: clock.id.clone(),
                scope: clock.scope.clone(),
                scope_id: clock.scope_id,
                kind: clock.kind.clone(),
                zone: clock_zone(clock).to_string(),
                label: clock.label.clone(),
                segments: clock.segments,
                filled: clock.filled,
                status: clock_status(clock),
            })
            .collect()
    }

    fn shared_question_strategy_views(
        &self,
        job: &JobState,
        actor_id: Option<u64>,
    ) -> Vec<SharedQuestionStrategyView> {
        if let Some(delivery) = job.delivery.as_ref() {
            let destination = self
                .location_name(delivery.destination_location_id)
                .unwrap_or_else(|| format!("Location {}", delivery.destination_location_id));
            let route = actor_id
                .and_then(|actor_id| self.actor_by_id(actor_id))
                .and_then(|actor| {
                    self.route_offer_binding(actor.location_id, delivery.destination_location_id)
                });
            return vec![SharedQuestionStrategyView {
                id: format!("{}:physical-delivery", job.id),
                action_kind: "carry".to_string(),
                route,
                label: job.action_copy.label.clone(),
                target_kind: "location".to_string(),
                target_id: Some(delivery.destination_location_id.to_string()),
                target_label: destination,
                available: actor_id.is_some() && self.job_status(job) == "active",
                availability_reason: job.action_copy.summary.clone(),
            }];
        }

        job.contribution_strategies
            .iter()
            .map(|strategy| {
                let mut available = self.job_status(job) == "active";
                let mut availability_reason = "This approach is available here.".to_string();
                let resolved_target = actor_id.and_then(|actor_id| {
                    if !self.contribution_strategy_binding_is_active(strategy) {
                        available = false;
                        availability_reason =
                            "Its authored rules binding is not active.".to_string();
                        return None;
                    }
                    if self.tired_tag_active(actor_id) {
                        available = false;
                        availability_reason = "Rest before making another effort.".to_string();
                        return None;
                    }
                    if let Some(requirement) = strategy.requirements.iter().find(|requirement| {
                        !self.contribution_requirement_met(actor_id, requirement)
                    }) {
                        available = false;
                        availability_reason = match requirement {
                            ContributionRequirement::AtLocation { .. } => {
                                "Reach the required place first.".to_string()
                            }
                            ContributionRequirement::HeldItem { item_id } => self
                                .item_name(*item_id)
                                .map(|name| format!("Carry {name} first."))
                                .unwrap_or_else(|| "Carry the required item first.".to_string()),
                            ContributionRequirement::ActiveTag { .. } => {
                                "A required world change has not happened yet.".to_string()
                            }
                            ContributionRequirement::RoomFeature { .. } => {
                                "Inspect the required room feature first.".to_string()
                            }
                            ContributionRequirement::FeatureSearched { .. } => {
                                "Search the earlier clue first.".to_string()
                            }
                            ContributionRequirement::FeatureUsed { item_id, .. } => self
                                .item_name(*item_id)
                                .map(|name| format!("Use {name} where the journey requires it."))
                                .unwrap_or_else(|| {
                                    "Use the required item where the journey requires it."
                                        .to_string()
                                }),
                            ContributionRequirement::EncounterResolved { .. } => {
                                "Resolve the journey's confrontation first.".to_string()
                            }
                        };
                        return None;
                    }
                    let Some(target) =
                        self.resolve_contribution_target(actor_id, job, strategy, None)
                    else {
                        available = false;
                        availability_reason =
                            "Its target is not reachable from here yet.".to_string();
                        return None;
                    };
                    let claim_key =
                        Self::contribution_claim_key(actor_id, &job.id, strategy, &target);
                    if claim_key
                        .as_ref()
                        .is_some_and(|claim_key| self.rpg_claims.contains(claim_key))
                    {
                        available = false;
                        availability_reason =
                            "This once-scoped contribution is already part of the story."
                                .to_string();
                    } else {
                        availability_reason = format!("{} is a reachable target.", target.label);
                    }
                    Some(target)
                });
                if actor_id.is_none() {
                    available = false;
                    availability_reason =
                        "Choose an avatar to see whether this approach is available.".to_string();
                }
                if self
                    .clocks
                    .get(&strategy.clock_id)
                    .is_none_or(|clock| clock.filled >= clock.segments)
                {
                    available = false;
                    availability_reason =
                        "This part of the shared question is settled.".to_string();
                }
                SharedQuestionStrategyView {
                    id: strategy.id.clone(),
                    action_kind: strategy.action_kind.clone(),
                    route: None,
                    label: strategy.strategy_label.clone(),
                    target_kind: resolved_target
                        .as_ref()
                        .map(|target| target.kind.clone())
                        .unwrap_or_else(|| strategy.target.kind.clone()),
                    target_id: resolved_target
                        .as_ref()
                        .map(|target| target.id.clone())
                        .or_else(|| strategy.target.id.clone()),
                    target_label: resolved_target
                        .as_ref()
                        .map(|target| target.label.clone())
                        .unwrap_or_else(|| strategy.target.label.clone()),
                    available,
                    availability_reason,
                }
            })
            .collect()
    }

    pub(super) fn shared_question_views(
        &self,
        location_id: u64,
        actor_id: Option<u64>,
    ) -> Vec<SharedQuestionView> {
        let mut questions = self
            .jobs
            .values()
            .filter(|job| job.location_ids.contains(&location_id))
            .filter_map(|job| {
                let progress = self.clocks.get(&job.progress_clock_id)?;
                let danger = if job.danger_clock_id.trim().is_empty() {
                    None
                } else {
                    Some(self.clocks.get(&job.danger_clock_id)?)
                };
                let job_status = self.job_status(job);
                let terminal = matches!(job_status.as_str(), "completed" | "failed");
                let settled_clock = danger
                    .filter(|clock| clock.filled >= clock.segments)
                    .unwrap_or(progress);
                let natural_completion_memory = self
                    .natural_affordances
                    .values()
                    .find(|state| state.investigation_job_id == job.id)
                    .and_then(|state| state.revealed_feature.as_ref())
                    .map(|feature| {
                        let buildings = feature
                            .building_archetypes
                            .iter()
                            .map(|building| building_choice_label(building.key()))
                            .collect::<Vec<_>>();
                        let supported = match buildings.as_slice() {
                            [] => String::new(),
                            [only] => only.clone(),
                            [left, right] => format!("{left} and {right}"),
                            _ => format!(
                                "{}, and {}",
                                buildings[..buildings.len() - 1].join(", "),
                                buildings.last().cloned().unwrap_or_default()
                            ),
                        };
                        if supported.is_empty() {
                            format!("Travelers found {} here.", feature.resource_kind.label())
                        } else {
                            format!(
                                "Travelers found {} here; it can support {}.",
                                feature.resource_kind.label(),
                                supported
                            )
                        }
                    });
                let completion_memory = terminal.then(|| {
                    natural_completion_memory.unwrap_or_else(|| {
                        settled_clock
                            .completion
                            .as_ref()
                            .map(|memory| memory.text.clone())
                            .unwrap_or_else(|| settled_clock.presentation.completion_memory.clone())
                    })
                });

                let reached_situation = job
                    .narrated_thresholds
                    .iter()
                    .filter_map(|threshold| {
                        let clock = self.clocks.get(&threshold.clock_id)?;
                        (threshold.filled <= clock.filled).then_some((
                            clock.updated_event_seq.unwrap_or_default(),
                            threshold.filled,
                            threshold.text.clone(),
                        ))
                    })
                    .max_by_key(|(event_seq, filled, _)| (*event_seq, *filled))
                    .map(|(_, _, text)| text);
                let situation = completion_memory
                    .clone()
                    .or(reached_situation)
                    .unwrap_or_else(|| progress.presentation.situation.clone());
                let danger_situation = danger
                    .and_then(|danger| {
                        job.narrated_thresholds
                            .iter()
                            .filter(|threshold| {
                                threshold.clock_id == danger.id && threshold.filled <= danger.filled
                            })
                            .max_by_key(|threshold| threshold.filled)
                            .map(|threshold| threshold.text.clone())
                    })
                    .or_else(|| danger.map(|clock| clock.presentation.situation.clone()))
                    .unwrap_or_default();
                let danger_consequence = danger
                    .map(|clock| clock.presentation.outcome.clone())
                    .unwrap_or_default();

                let natural_investigation = self
                    .natural_affordances
                    .values()
                    .any(|state| state.investigation_job_id == job.id);
                let next_revelation = job
                    .narrated_thresholds
                    .iter()
                    .filter_map(|threshold| {
                        let clock = self.clocks.get(&threshold.clock_id)?;
                        (threshold.filled > clock.filled)
                            .then_some((threshold.filled.saturating_sub(clock.filled), threshold))
                    })
                    .min_by_key(|(distance, threshold)| {
                        (
                            *distance,
                            threshold.clock_id != progress.id,
                            threshold.filled,
                        )
                    })
                    .map(|(_, threshold)| SharedQuestionMilestoneView {
                        filled: threshold.filled,
                        text: if natural_investigation {
                            match threshold.filled {
                                1 => "The next survey milestone will distinguish useful signs."
                                    .to_string(),
                                2 => "The next survey milestone will identify a resource family."
                                    .to_string(),
                                _ => "The next survey milestone will narrow the exact site."
                                    .to_string(),
                            }
                        } else {
                            threshold.text.clone()
                        },
                    });

                let strategies = self.shared_question_strategy_views(job, actor_id);
                let mut recent = progress.recent_contributions.to_vec();
                if let Some(danger) = danger {
                    recent.extend(danger.recent_contributions.iter().cloned());
                }
                recent.sort_by_key(|entry| std::cmp::Reverse(entry.contribution_event_seq));
                recent.truncate(MAX_RECENT_CLOCK_CONTRIBUTIONS);
                let recent_contributions = recent
                    .into_iter()
                    .map(|entry| SharedQuestionContributionView {
                        actor_id: entry.actor_id,
                        actor_name: self
                            .actor_name(entry.actor_id)
                            .unwrap_or_else(|| "Earlier travelers".to_string()),
                        strategy_label: entry.strategy_label,
                        target_label: entry.target_label,
                        progress: entry.progress,
                        event_seq: entry.contribution_event_seq,
                    })
                    .collect();
                Some(SharedQuestionView {
                    id: job.id.clone(),
                    provenance: if job.pack_id.is_empty() {
                        "runtime-generated".to_string()
                    } else {
                        job.pack_id.clone()
                    },
                    participant_ids: job.participant_ids.clone(),
                    participant_names: job
                        .participant_ids
                        .iter()
                        .map(|actor_id| {
                            self.actor_name(*actor_id)
                                .unwrap_or_else(|| format!("Actor {actor_id}"))
                        })
                        .collect(),
                    presentation_version: progress.presentation.version,
                    question: progress.presentation.question.clone(),
                    rhythm: progress.presentation.rhythm.clone(),
                    attention: progress.presentation.attention.clone(),
                    priority: progress.presentation.priority,
                    presentation_state: if terminal {
                        "completed_memory"
                    } else if job_status == "active" {
                        "active"
                    } else {
                        "unavailable"
                    }
                    .to_string(),
                    promoted: false,
                    promotion_rank: None,
                    resolution: job_status,
                    situation,
                    stakes: progress.presentation.stakes.clone(),
                    outcome: progress.presentation.outcome.clone(),
                    progress_clock_id: progress.id.clone(),
                    filled: progress.filled,
                    segments: progress.segments,
                    danger_clock_id: danger.map(|clock| clock.id.clone()).unwrap_or_default(),
                    danger_filled: danger.map(|clock| clock.filled).unwrap_or_default(),
                    danger_segments: danger.map(|clock| clock.segments).unwrap_or_default(),
                    danger_situation,
                    danger_consequence,
                    next_revelation,
                    strategies,
                    suggested_actions: Vec::new(),
                    recent_contributions,
                    completion_memory,
                    updated_event_seq: danger
                        .map(|clock| progress.updated_event_seq.max(clock.updated_event_seq))
                        .unwrap_or(progress.updated_event_seq),
                })
            })
            .collect::<Vec<_>>();

        questions.sort_by(|left, right| {
            right
                .priority
                .cmp(&left.priority)
                .then_with(|| {
                    shared_question_attention_rank(&right.attention)
                        .cmp(&shared_question_attention_rank(&left.attention))
                })
                .then_with(|| right.updated_event_seq.cmp(&left.updated_event_seq))
                .then_with(|| left.id.cmp(&right.id))
        });
        let mut promoted = 0usize;
        let mut immediate = 0usize;
        let mut communal = 0usize;
        for question in &mut questions {
            if question.presentation_state != "active"
                || question.attention == "background"
                || promoted >= MAX_PROMOTED_SHARED_QUESTIONS
                || (question.attention == "immediate" && immediate >= 1)
                || (question.attention == "communal" && communal >= 1)
            {
                if question.presentation_state == "active" {
                    question.presentation_state = "quiet".to_string();
                }
                continue;
            }
            promoted += 1;
            immediate += usize::from(question.attention == "immediate");
            communal += usize::from(question.attention == "communal");
            question.promoted = true;
            question.promotion_rank = Some(promoted);
        }
        questions.sort_by(|left, right| {
            left.promotion_rank
                .unwrap_or(usize::MAX)
                .cmp(&right.promotion_rank.unwrap_or(usize::MAX))
                .then_with(|| {
                    shared_question_state_rank(&left.presentation_state)
                        .cmp(&shared_question_state_rank(&right.presentation_state))
                })
                .then_with(|| right.updated_event_seq.cmp(&left.updated_event_seq))
                .then_with(|| left.id.cmp(&right.id))
        });
        questions
    }

    pub(super) fn shared_question_views_with_actions(
        &self,
        location_id: u64,
        actor_id: Option<u64>,
        action_offers: &[RankedActionOffer],
        action_hand: &ActionHandView,
    ) -> Vec<SharedQuestionView> {
        let mut questions = self.shared_question_views(location_id, actor_id);
        let suggestions = action_hand
            .entries
            .iter()
            .filter_map(|entry| {
                let offer = action_offers
                    .iter()
                    .find(|offer| offer.offer_id == entry.offer_id)?;
                let target_label = offer
                    .target
                    .as_ref()
                    .and_then(|target| target.label.clone())
                    .or_else(|| offer.project.as_ref().map(|project| project.label.clone()))
                    .unwrap_or_else(|| {
                        self.location_name(location_id)
                            .unwrap_or_else(|| "this place".to_string())
                    });
                Some(SharedQuestionSuggestionView {
                    offer_id: offer.offer_id.clone(),
                    state_revision: offer.state_revision,
                    kind: offer.kind.clone(),
                    label: offer.accessible_label.clone(),
                    target_label,
                    source: offer.provider.reason.clone(),
                    likely_effect: offer
                        .effect
                        .clone()
                        .unwrap_or_else(|| "keeps the next choice open".to_string()),
                    likely_progress: offer.progress,
                    risk: offer.risk.clone(),
                })
            })
            .collect::<Vec<_>>();
        for question in &mut questions {
            if question.promoted && question.presentation_state == "active" {
                question.suggested_actions = suggestions
                    .iter()
                    .cloned()
                    .map(|mut suggestion| {
                        suggestion.likely_effect = format!(
                            "{}; current progress is {}/{} and danger is {}/{}",
                            suggestion.likely_effect,
                            question.filled,
                            question.segments,
                            question.danger_filled,
                            question.danger_segments,
                        );
                        suggestion
                    })
                    .collect();
            }
        }
        questions
    }

    pub(super) fn tag_views(&self, actor_id: Option<u64>, location_id: u64) -> Vec<TagView> {
        self.tags
            .values()
            .filter(|tag| tag.active)
            .filter(|tag| {
                (tag.scope == "room" && tag.scope_id == location_id)
                    || actor_id
                        .map(|id| tag.scope == "actor" && tag.scope_id == id)
                        .unwrap_or(false)
            })
            .map(|tag| TagView {
                id: tag.id.clone(),
                scope: tag.scope.clone(),
                scope_id: tag.scope_id,
                label: tag.label.clone(),
                kind: tag.kind.clone(),
                expires: tag.expires.clone(),
            })
            .collect()
    }

    pub(super) fn job_views(&self, location_id: u64) -> Vec<JobView> {
        self.jobs
            .values()
            .filter(|job| job.location_ids.contains(&location_id))
            .map(|job| JobView {
                id: job.id.clone(),
                premise: job.premise.clone(),
                stakes: job.stakes.clone(),
                status: self.job_status(job),
                progress_clock_id: job.progress_clock_id.clone(),
                danger_clock_id: job.danger_clock_id.clone(),
                reward: job.reward.label().to_string(),
                consequence: job.consequence.clone(),
                action_label: self.job_action_label(job),
                action_summary: self.job_action_summary(job),
                contribution_schema_version: job.contribution_schema_version,
                contribution_strategies: job.contribution_strategies.clone(),
                narrated_thresholds: job.narrated_thresholds.clone(),
            })
            .collect()
    }

    pub(super) fn front_views(&self, location_id: u64) -> Vec<FrontView> {
        active_content()
            .fronts
            .iter()
            .filter(|front| front.location_ids.contains(&location_id))
            .map(|front| {
                let job_statuses = front
                    .job_ids
                    .iter()
                    .filter_map(|job_id| self.jobs.get(job_id))
                    .map(|job| self.job_status(job))
                    .collect::<Vec<_>>();
                let (presentation_state, outcome_statement) = front_presentation(
                    &front.status,
                    job_statuses.iter().any(|status| status == "completed"),
                    job_statuses.iter().any(|status| status == "failed"),
                    &front.impending_outcome,
                );
                FrontView {
                    id: front.id.clone(),
                    premise: front.premise.clone(),
                    zone: front.zone.clone(),
                    status: front.status.clone(),
                    presentation_state: presentation_state.to_string(),
                    outcome_statement,
                    location_ids: front.location_ids.clone(),
                    participant_ids: front.participant_ids.clone(),
                    participant_names: front
                        .participant_ids
                        .iter()
                        .map(|actor_id| {
                            self.actor_name(*actor_id)
                                .unwrap_or_else(|| format!("Actor {actor_id}"))
                        })
                        .collect(),
                    stakes_questions: front.stakes_questions.clone(),
                    portent_clock_id: front.portent_clock_id.clone(),
                    job_ids: front.job_ids.clone(),
                    impending_outcome: front.impending_outcome.clone(),
                }
            })
            .collect()
    }

    pub(super) fn room_sheet_view(&self, location_id: u64) -> Option<RoomSheetView> {
        self.room_sheets
            .get(&location_id)
            .map(|sheet| RoomSheetView {
                id: sheet.id.clone(),
                location_id: sheet.location_id,
                name: sheet.name.clone(),
                safety: sheet.safety.clone(),
                zone: room_sheet_zone(sheet).to_string(),
                aspects: sheet.aspects.clone(),
                boons: sheet.boons.clone(),
                hooks: sheet.hooks.clone(),
                resources: sheet.resources.clone(),
                natural_features: self.revealed_natural_features(location_id),
                generated_place: self.generated_place_view(location_id),
                eligible_building_archetypes: if self.generated_places.contains_key(&location_id) {
                    self.generated_place_building_choices(location_id)
                } else {
                    self.eligible_natural_building_archetypes(location_id)
                },
                governance_decisions: self.governance_decision_views(location_id),
                settlement_buildings: self.settlement_building_views(location_id),
                loot_allocations: self.loot_allocation_views(location_id),
                building_slots: self.settlement_building_slot_view(location_id),
                projects: sheet.projects.clone(),
            })
            .or_else(|| {
                self.generated_pathway_for_location(location_id)?;
                let meta = self.location_meta_for(location_id);
                let mut projects = vec![
                    generated_place_anchor_job_id(location_id),
                    generated_place_connection_job_id(location_id),
                    generated_place_settlement_job_id(location_id),
                ];
                if self.natural_affordances.contains_key(&location_id) {
                    projects.push(natural_investigation_job_id(location_id));
                }
                Some(RoomSheetView {
                    id: format!("generated-pathway-room:{location_id}"),
                    location_id,
                    name: self
                        .location_name(location_id)
                        .unwrap_or_else(|| "Newly Found Path".to_string()),
                    safety: "risky".to_string(),
                    zone: ZONE_FRONTIER.to_string(),
                    aspects: if meta.terrain.is_empty() {
                        vec!["unfinished ground".to_string()]
                    } else {
                        meta.terrain.clone()
                    },
                    boons: vec!["Careful deeds leave lasting marks here.".to_string()],
                    hooks: vec!["Anchor, connect, then settle this place.".to_string()],
                    resources: BTreeMap::new(),
                    natural_features: self.revealed_natural_features(location_id),
                    generated_place: self.generated_place_view(location_id),
                    eligible_building_archetypes: self
                        .generated_place_building_choices(location_id),
                    governance_decisions: self.governance_decision_views(location_id),
                    settlement_buildings: self.settlement_building_views(location_id),
                    loot_allocations: self.loot_allocation_views(location_id),
                    building_slots: self.settlement_building_slot_view(location_id),
                    projects,
                })
            })
    }

    fn action_inspector_view(offer: &RankedActionOffer) -> ActionInspectorView {
        ActionInspectorView {
            offer_id: offer.offer_id.clone(),
            kind: offer.kind.clone(),
            rules_action: offer.rules_action.clone(),
            operation: offer.operation.clone(),
            rules_profile: offer.rules_profile.clone(),
            resolver: offer.resolver.clone(),
            source_collectible: offer.source_collectible.clone(),
            pack_provenance: offer.pack_provenance.clone(),
            composition_trace: offer.composition_trace.clone(),
            composition_id: offer.composition_id.clone(),
            state_revision: offer.state_revision,
            route: offer.route.clone(),
            threshold_method: offer.threshold_method.clone(),
            category: offer.category.clone(),
            label: offer.label.clone(),
            command: offer.command.clone(),
            rank: offer.rank,
            disabled: offer.disabled,
            disabled_reason: offer.disabled_reason.clone(),
            zone: offer.zone.clone(),
            source: offer.source.clone(),
            provider: offer.provider.clone(),
            target: offer.target.clone(),
            claim_key: offer.claim_key.clone(),
            reason: offer.reason.clone(),
            effect: offer.effect.clone(),
            risk: offer.risk.clone(),
            cost_orbs: offer.cost.as_ref().map(|cost| cost.orbs),
        }
    }

    fn action_offer_decision_view(
        offer: &RankedActionOffer,
        hand_offer_ids: &BTreeSet<String>,
    ) -> ActionOfferDecisionView {
        let in_hand = hand_offer_ids.contains(&offer.offer_id);
        let available = action_offer_is_reachable(offer);
        let reason = if in_hand {
            format!(
                "Selected by provider priority and action rank; {}.",
                offer.provider.reason.trim_end_matches(['.', '!', '?'])
            )
        } else if offer.disabled {
            offer
                .disabled_reason
                .clone()
                .unwrap_or_else(|| "The action is disabled in the current scene.".to_string())
        } else if action_offer_requires_target(&offer.kind) && offer.target.is_none() {
            "The action has no legal target in the current scene.".to_string()
        } else if matches!(offer.kind.as_str(), "prepare" | "work" | "help" | "study")
            && offer.project.is_none()
        {
            "The action has no active project in the current scene.".to_string()
        } else if !offer.ranked_hand_eligible {
            "Rest is legal here, but nothing currently needs recovery, so it stays outside the two-card browser hand.".to_string()
        } else {
            "This legal action ranks outside the current two-card hand.".to_string()
        };
        ActionOfferDecisionView {
            offer_id: offer.offer_id.clone(),
            kind: offer.kind.clone(),
            available,
            in_hand,
            reason,
        }
    }

    pub(super) fn inspector_view(
        &self,
        location_id: u64,
        actor_id: Option<u64>,
        primary_action: &PrimaryAction,
        action_offers: &[RankedActionOffer],
        action_hand: &ActionHandView,
    ) -> InspectorView {
        let room_sheet = self.room_sheets.get(&location_id);
        let zone = room_sheet
            .map(|sheet| room_sheet_zone(sheet).to_string())
            .unwrap_or_else(|| default_zone_for_scope("room", location_id).to_string());
        let features = self
            .revealed_natural_features(location_id)
            .into_iter()
            .map(|feature| feature.resource_kind.label().to_string())
            .collect();
        let listen_offer = action_offers.iter().find(|offer| offer.kind == "check");
        let listen_reason = listen_offer
            .map(|offer| {
                let effect = offer
                    .effect
                    .clone()
                    .unwrap_or_else(|| "lets the room share one useful clue".to_string());
                format!("Listen is suggested from the check offer; {effect}")
            })
            .or_else(|| {
                self.active_progress_clock_id_for_location(location_id)
                    .map(|clock_id| {
                        format!(
                            "Listen can feed {clock_id}, but it is not currently the top offer."
                        )
                    })
            });
        let suggested_action = action_offers
            .iter()
            .find(|offer| offer.kind == primary_action.kind)
            .or_else(|| action_offers.first())
            .map(Self::action_inspector_view);
        let actions = action_offers
            .iter()
            .map(Self::action_inspector_view)
            .collect();
        let hand_offer_ids = action_hand
            .entries
            .iter()
            .map(|entry| entry.offer_id.clone())
            .collect::<BTreeSet<_>>();
        let offer_decisions = action_offers
            .iter()
            .map(|offer| Self::action_offer_decision_view(offer, &hand_offer_ids))
            .collect();

        InspectorView {
            location_id,
            practice: actor_id.and_then(|id| self.actor_practice_view(id)),
            room: RoomInspectorView {
                name: self
                    .location_name(location_id)
                    .unwrap_or_else(|| format!("Location {location_id}")),
                zone,
                safety: room_sheet.map(|sheet| sheet.safety.clone()),
                aspects: room_sheet
                    .map(|sheet| sheet.aspects.clone())
                    .unwrap_or_default(),
                boons: room_sheet
                    .map(|sheet| sheet.boons.clone())
                    .unwrap_or_default(),
                hooks: room_sheet
                    .map(|sheet| sheet.hooks.clone())
                    .unwrap_or_default(),
                resources: room_sheet
                    .map(|sheet| sheet.resources.clone())
                    .unwrap_or_default(),
                eligible_building_archetypes: if self.generated_places.contains_key(&location_id) {
                    self.generated_place_building_choices(location_id)
                } else {
                    self.eligible_natural_building_archetypes(location_id)
                },
                governance_decisions: self.governance_decision_views(location_id),
                settlement_buildings: self.settlement_building_views(location_id),
                loot_allocations: self.loot_allocation_views(location_id),
                building_slots: self.settlement_building_slot_view(location_id),
                projects: room_sheet
                    .map(|sheet| sheet.projects.clone())
                    .unwrap_or_default(),
                features,
                listen_reason,
            },
            suggested_action,
            actions,
            offer_decisions,
            jobs: self.job_inspector_views(location_id, actor_id),
            fronts: self.front_views(location_id),
            clocks: self.clock_inspector_views(location_id),
            hazards: actor_id
                .map(|id| self.threshold_hazard_developer_views(id))
                .unwrap_or_default(),
            lifecycle_hooks: self.lifecycle_hook_inspector_views(location_id),
        }
    }

    pub(super) fn job_inspector_views(
        &self,
        location_id: u64,
        actor_id: Option<u64>,
    ) -> Vec<JobInspectorView> {
        self.jobs
            .values()
            .filter(|job| job.location_ids.contains(&location_id))
            .map(|job| {
                let progress = self.clocks.get(&job.progress_clock_id);
                let danger = self.clocks.get(&job.danger_clock_id);
                let mut needs = Vec::new();
                if let Some(clock) = progress {
                    let remaining = clock.segments.saturating_sub(clock.filled);
                    if remaining > 0 {
                        needs.push(format!("{remaining} progress segments"));
                    }
                }
                if needs.is_empty() {
                    needs.push("progress clock filled".to_string());
                }
                let mut blockers = Vec::new();
                if danger
                    .map(|clock| clock.filled >= clock.segments)
                    .unwrap_or(false)
                {
                    blockers.push("danger clock filled".to_string());
                }
                let participants = job
                    .participant_ids
                    .iter()
                    .map(|actor_id| {
                        self.actor_name(*actor_id)
                            .unwrap_or_else(|| format!("Actor {actor_id}"))
                    })
                    .collect();
                let contribution_strategies = job
                    .contribution_strategies
                    .iter()
                    .map(|strategy| {
                        let resolved_target = actor_id.and_then(|actor_id| {
                            self.resolve_contribution_target(actor_id, job, strategy, None)
                        });
                        let claim_key = actor_id.zip(resolved_target.as_ref()).and_then(
                            |(actor_id, target)| {
                                Self::contribution_claim_key(actor_id, &job.id, strategy, target)
                            },
                        );
                        let available =
                            actor_id
                                .zip(resolved_target.as_ref())
                                .is_some_and(|(actor_id, _)| {
                                    self.job_status(job) == "active"
                                        && self
                                            .clocks
                                            .get(&strategy.clock_id)
                                            .is_some_and(|clock| clock.filled < clock.segments)
                                        && self.contribution_strategy_binding_is_active(strategy)
                                        && strategy.requirements.iter().all(|requirement| {
                                            self.contribution_requirement_met(actor_id, requirement)
                                        })
                                        && claim_key.as_ref().is_none_or(|claim_key| {
                                            !self.rpg_claims.contains(claim_key)
                                        })
                                });
                        let mut source_event_seqs = self
                            .event_log
                            .iter()
                            .filter(|event| event.type_name == "job.contribution.resolved")
                            .filter_map(|event| {
                                let trace = serde_json::from_str::<JobContributionTrace>(
                                    event.content.as_deref()?,
                                )
                                .ok()?;
                                (trace.job_id == job.id && trace.strategy_id == strategy.id)
                                    .then_some((event.seq, trace.source_event_seqs))
                            })
                            .flat_map(|(event_seq, source_event_seqs)| {
                                std::iter::once(event_seq).chain(source_event_seqs)
                            })
                            .collect::<Vec<_>>();
                        source_event_seqs.sort_unstable();
                        source_event_seqs.dedup();
                        JobContributionInspectorView {
                            strategy: strategy.clone(),
                            resolved_target,
                            available,
                            claim_key,
                            source_event_seqs,
                        }
                    })
                    .collect();
                JobInspectorView {
                    id: job.id.clone(),
                    status: self.job_status(job),
                    premise: job.premise.clone(),
                    needs,
                    blockers,
                    participants,
                    progress_clock_id: job.progress_clock_id.clone(),
                    danger_clock_id: job.danger_clock_id.clone(),
                    reward: job.reward.label().to_string(),
                    consequence: job.consequence.clone(),
                    contribution_schema_version: job.contribution_schema_version,
                    contribution_strategies,
                }
            })
            .collect()
    }

    pub(super) fn clock_inspector_views(&self, location_id: u64) -> Vec<ClockInspectorView> {
        self.clocks
            .values()
            .filter(|clock| clock.scope == "room" && clock.scope_id == location_id)
            .map(|clock| {
                let last_event = self.event_log.iter().rev().find(|event| {
                    event.type_name == "clock.updated"
                        && event.clock_id.as_deref() == Some(clock.id.as_str())
                });
                ClockInspectorView {
                    id: clock.id.clone(),
                    kind: clock.kind.clone(),
                    label: clock.label.clone(),
                    zone: clock_zone(clock).to_string(),
                    filled: clock.filled,
                    segments: clock.segments,
                    status: clock_status(clock),
                    visible_to_players: clock.visible_to_players,
                    presentation: clock.presentation.clone(),
                    recent_contributions: clock.recent_contributions.clone(),
                    completion: clock.completion.clone(),
                    updated_event_seq: clock.updated_event_seq,
                    last_delta: last_event.and_then(|event| event.clock_delta),
                    last_reason: last_event.and_then(|event| event.content.clone()),
                    on_fill: clock.on_fill.clone(),
                    on_fill_effect: summarize_effects(&clock.on_fill),
                }
            })
            .collect()
    }

    pub(super) fn lifecycle_hook_inspector_views(
        &self,
        location_id: u64,
    ) -> Vec<LifecycleHookInspectorView> {
        let room_actor_ids: BTreeSet<String> = self.world.actors[..self.world.actor_count]
            .iter()
            .filter(|actor| actor.location_id == location_id)
            .map(|actor| actor.id.to_string())
            .collect();
        let room_item_ids: BTreeSet<String> = self.world.items[..self.world.item_count]
            .iter()
            .filter(|item| item.location_id == location_id)
            .map(|item| item.id.to_string())
            .collect();
        let room_clock_ids: BTreeSet<String> = self
            .clocks
            .values()
            .filter(|clock| clock.scope == "room" && clock.scope_id == location_id)
            .map(|clock| clock.id.clone())
            .collect();
        active_content()
            .lifecycle_hooks
            .iter()
            .filter(|hook| match hook.target_kind.as_str() {
                "room" => hook.target_id == location_id.to_string(),
                "actor" => room_actor_ids.contains(&hook.target_id),
                "item" => room_item_ids.contains(&hook.target_id),
                "clock" => room_clock_ids.contains(&hook.target_id),
                _ => false,
            })
            .map(|hook| LifecycleHookInspectorView {
                hook: hook.hook.clone(),
                target_kind: hook.target_kind.clone(),
                target_id: hook.target_id.clone(),
                claim_scope: hook.claim_scope.clone(),
                effects: hook.effects.clone(),
                effect: summarize_effects(&hook.effects),
            })
            .collect()
    }

    pub(super) fn calling_view(&self, actor_id: u64) -> Option<CallingView> {
        self.callings.get(&actor_id).map(|calling| CallingView {
            actor_id: calling.actor_id,
            statement: calling.statement.clone(),
        })
    }

    pub(super) fn skill_views(&self, actor_id: u64) -> Vec<SkillView> {
        let mut skills: Vec<_> = self
            .skills
            .values()
            .filter(|skill| skill.actor_id == actor_id && skill.rank > 0)
            .map(|skill| SkillView {
                skill_id: skill.skill_id.clone(),
                label: skill.label.clone(),
                rank: skill.rank,
                tier: skill_rank_label(skill.rank).to_string(),
                bonus: skill_bonus_for_rank(skill.rank),
            })
            .collect();
        skills.sort_by(|a, b| a.label.cmp(&b.label));
        skills
    }

    pub(super) fn visit_ledger_view(&self, actor_id: u64) -> VisitLedgerView {
        let mut marks: Vec<_> = self
            .ledger_marks
            .values()
            .filter(|mark| mark.actor_id == actor_id && !mark.banked)
            .map(|mark| VisitLedgerMarkView {
                id: mark.id.clone(),
                category: mark.category.clone(),
                label: mark.label.clone(),
                source_event_seq: mark.source_event_seq,
            })
            .collect();
        marks.sort_by_key(|mark| mark.source_event_seq);
        let banked_count = self
            .ledger_marks
            .values()
            .filter(|mark| mark.actor_id == actor_id && mark.banked)
            .count();
        let spent_count = self.advancement_spent_count(actor_id);
        let learned_truth_count = self
            .ledger_marks
            .values()
            .filter(|mark| mark.actor_id == actor_id && mark.category == "learned_truth")
            .count();
        VisitLedgerView {
            journal_ref: self
                .canonical_ref("journal", actor_id)
                .map(ToString::to_string),
            entity_version: self
                .canonical_ref("journal", actor_id)
                .map(|canonical_ref| self.entity_version(canonical_ref))
                .unwrap_or_default(),
            unbanked_count: marks.len(),
            banked_count,
            spent_count,
            advancement_points: banked_count.saturating_sub(spent_count),
            learned_truth_count,
            unbanked_marks: marks,
        }
    }

    pub(super) fn bond_views(&self, actor_id: u64) -> Vec<BondView> {
        let mut bonds: Vec<_> = self
            .bonds
            .values()
            .filter(|bond| bond.actor_id == actor_id && bond.status != "resolved")
            .map(|bond| BondView {
                id: bond.id.clone(),
                canonical_ref: self
                    .canonical_pact_ref(&bond.id)
                    .unwrap_or_default()
                    .to_string(),
                entity_version: self
                    .canonical_pact_ref(&bond.id)
                    .map(|canonical_ref| self.entity_version(canonical_ref))
                    .unwrap_or_default(),
                actor_id: bond.actor_id,
                target_actor_id: bond.target_actor_id,
                target_actor_name: self.actor_name(bond.target_actor_id),
                statement: bond.statement.clone(),
                strength: bond.strength,
                status: bond.status.clone(),
                source_event_seq: bond.source_event_seq,
                updated_event_seq: bond.updated_event_seq,
                dialogue_status: bond.dialogue_status.clone(),
                dialogue_event_seq: bond.dialogue_event_seq,
            })
            .collect();
        bonds.sort_by(|a, b| {
            a.target_actor_name
                .cmp(&b.target_actor_name)
                .then_with(|| a.id.cmp(&b.id))
        });
        bonds
    }

    pub(super) fn chat_bond_claimed_target_ids(&self, actor_id: u64, location_id: u64) -> Vec<u64> {
        let mut target_ids: Vec<_> = self.world.actors[..self.world.actor_count]
            .iter()
            .filter(|target| {
                target.id != actor_id
                    && Self::actor_can_act(**target)
                    && target.location_id == location_id
                    && self
                        .rpg_claims
                        .contains(&chat_bond_claim_key(actor_id, target.id))
            })
            .map(|target| target.id)
            .collect();
        target_ids.sort_unstable();
        target_ids
    }

    #[cfg(test)]
    pub(super) fn world_response(
        &self,
        actor_id: Option<u64>,
        access: &AccessContext,
    ) -> WorldResponse {
        self.world_response_with_presence(actor_id, access, None)
    }

    pub(super) fn world_response_with_presence(
        &self,
        actor_id: Option<u64>,
        access: &AccessContext,
        active_direct_actor_ids: Option<&BTreeSet<u64>>,
    ) -> WorldResponse {
        let client_actor_id = actor_id.filter(|id| self.client_actor_can_observe(*id));
        let current_location_id = client_actor_id
            .and_then(|id| self.actor_by_id(id))
            .map(|actor| actor.location_id);
        let visible_location_ids: BTreeSet<u64> = self.world.locations[..self.world.location_count]
            .iter()
            .filter_map(|location| {
                let is_current = current_location_id == Some(location.id);
                let default_start = current_location_id.is_none()
                    && content_registry().entry_location_id() == Some(location.id);
                let discovered = self.location_discovered_by_search(location.id);
                let generated = self.generated_location_is_revealed(location.id);
                (is_current || default_start || discovered || generated).then_some(location.id)
            })
            .collect();

        let mut location_cards = BTreeMap::new();
        for location in self.world.locations[..self.world.location_count]
            .iter()
            .filter(|location| visible_location_ids.contains(&location.id))
        {
            let name = self
                .location_name(location.id)
                .unwrap_or_else(|| format!("Location {}", location.id));
            let meta = self.location_meta_for(location.id);
            location_cards.insert(
                location.id,
                apply_location_access(
                    self.decorate_generated_location_card(
                        card_for_location(location.id, &name, Some(&meta)),
                        location.id,
                    ),
                    location.id,
                    access,
                ),
            );
        }
        let access_view = access_view(access, &location_cards);

        let locations = self.world.locations[..self.world.location_count]
            .iter()
            .filter(|location| visible_location_ids.contains(&location.id))
            .map(|location| {
                let name = self
                    .location_name(location.id)
                    .unwrap_or_else(|| format!("Location {}", location.id));
                let meta = self.location_meta_for(location.id);
                let access_rule = location_access_rule(location.id);
                let accessible = location_access_allowed(location.id, access);
                let actors_in_location: Vec<CwActor> = self.world.actors[..self.world.actor_count]
                    .iter()
                    .copied()
                    .filter(|actor| actor.location_id == location.id)
                    .collect();
                let visible_actors_in_location: Vec<CwActor> = actors_in_location
                    .iter()
                    .copied()
                    .filter(|actor| {
                        self.actor_visible_in_projection(
                            *actor,
                            client_actor_id,
                            active_direct_actor_ids,
                        )
                    })
                    .collect();
                let items_in_location: Vec<CwItem> = self.world.items[..self.world.item_count]
                    .iter()
                    .copied()
                    .filter(|item| {
                        item.location_id == location.id
                            && !self.forgotten_search_item_at_location(*item, location.id)
                    })
                    .collect();
                let actor_count = visible_actors_in_location.len();
                let direct_input_actor_count = visible_actors_in_location
                    .iter()
                    .filter(|actor| self.actor_control_mode(actor.id).is_direct_input())
                    .count();
                let inference_actor_count = actor_count.saturating_sub(direct_input_actor_count);
                let actors = accessible
                    .then(|| {
                        visible_actors_in_location
                            .iter()
                            .copied()
                            .map(|actor| {
                                self.actor_view_for_client(
                                    actor,
                                    Some(client_actor_id.unwrap_or_default()),
                                )
                            })
                            .collect()
                    })
                    .unwrap_or_default();
                let items = accessible
                    .then(|| {
                        items_in_location
                            .iter()
                            .copied()
                            .map(|item| self.item_view(item))
                            .collect()
                    })
                    .unwrap_or_default();
                let exits = accessible
                    .then(|| self.exit_views(client_actor_id, location.id, access))
                    .unwrap_or_default();
                let card = location_cards
                    .get(&location.id)
                    .cloned()
                    .unwrap_or_else(|| {
                        apply_location_access(
                            self.decorate_generated_location_card(
                                card_for_location(location.id, &name, Some(&meta)),
                                location.id,
                            ),
                            location.id,
                            access,
                        )
                    });

                WorldLocationView {
                    id: location.id,
                    canonical_ref: self
                        .canonical_ref("location", location.id)
                        .unwrap_or_default()
                        .to_string(),
                    entity_version: self
                        .canonical_ref("location", location.id)
                        .map(|canonical_ref| self.entity_version(canonical_ref))
                        .unwrap_or_default(),
                    pack_id: seed_pack_id_for_location(location.id),
                    name,
                    title: meta.title,
                    description: meta.description,
                    persona: meta.persona,
                    memory: meta.memory,
                    interior_view: meta.interior_view,
                    factions: faction_refs_for_location(location.id),
                    simulation: self.location_simulation_view(location.id),
                    public: access_rule.required_grant_id.is_none()
                        && access_rule.required_card_id.is_none(),
                    accessible,
                    required_grant_id: access_rule.required_grant_id.map(ToString::to_string),
                    required_card_id: access_rule.required_card_id.map(ToString::to_string),
                    access_reason: if accessible {
                        None
                    } else {
                        access_rule.reason.map(ToString::to_string)
                    },
                    card,
                    actor_count,
                    direct_input_actor_count,
                    inference_actor_count,
                    legacy_direct_input_actor_count: direct_input_actor_count,
                    legacy_inference_actor_count: inference_actor_count,
                    item_count: items_in_location.len(),
                    actors,
                    items,
                    exits,
                }
            })
            .collect();

        WorldResponse {
            world_id: OFFICIAL_WORLD_ID.to_string(),
            world_epoch: OFFICIAL_WORLD_EPOCH,
            world_seq: self.world.next_event_seq.saturating_sub(1),
            shared_world: true,
            current_actor_id: client_actor_id,
            current_location_id,
            access: access_view,
            factions: faction_views(),
            simulation: self.world_simulation_view(),
            locations,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn journal_admission_uses_unique_explicit_projection_policies() {
        let mut admitted = BTreeSet::new();
        for (type_name, category) in JOURNAL_BEAT_POLICIES {
            assert!(
                admitted.insert(*type_name),
                "duplicate Journal projection policy for {type_name}"
            );
            let event = EventView {
                type_name: (*type_name).to_string(),
                ..EventView::default()
            };
            assert_eq!(
                journal_beat_category(&event),
                Some(*category),
                "admitted Journal source {type_name} must keep an explicit policy"
            );
        }

        for internal_type in [
            "combat.action.required",
            "combat.initiative.rolled",
            "combat.participant.joined",
            "combat.turn.started",
            "combat.turn.ended",
            "tag.applied",
            "tag.cleared",
            "future.internal.telemetry",
        ] {
            let event = EventView {
                type_name: internal_type.to_string(),
                ..EventView::default()
            };
            assert_eq!(
                journal_beat_category(&event),
                None,
                "internal source {internal_type} must not enter the player Journal through a wildcard"
            );
        }
    }

    #[test]
    fn front_presentation_names_active_persisted_resolved_and_escalated_truths() {
        let impending = "Every road lamp accepts the shadow as keeper.";
        assert_eq!(
            front_presentation("active", false, false, impending),
            ("active", String::new())
        );
        assert_eq!(
            front_presentation("active", true, false, impending),
            (
                "persisted",
                "The immediate work is done, but the larger trouble remains unresolved."
                    .to_string()
            )
        );
        assert_eq!(
            front_presentation("completed", false, false, impending),
            ("resolved", "The larger trouble is resolved.".to_string())
        );
        assert_eq!(
            front_presentation("active", false, true, impending),
            (
                "escalated",
                format!("The larger trouble has escalated. {impending}")
            )
        );
    }

    #[test]
    fn journal_beats_group_semantic_receipts_with_their_source_evidence() {
        let raw = EventView {
            seq: 41,
            type_name: "job.contribution.resolved".to_string(),
            actor_name: Some("Pip Marrow".to_string()),
            location_id: Some(804),
            content: Some(
                serde_json::json!({
                    "job_id": "lantern-keeper:rekindle-the-beacon",
                    "strategy_id": "rekindle",
                    "strategy_label": "Rekindle the beacon",
                    "narration_key": "lantern-keeper.work",
                    "action_kind": "work",
                    "target": {"kind": "feature", "id": "beacon", "label": "the beacon"},
                    "resolution": "ability_check",
                    "outcome": "success",
                    "baseline_progress": 1,
                    "success_progress": 1,
                    "prepared_bonus_progress": 0,
                    "total_progress": 2,
                    "clock_id": "lantern-keeper.light",
                    "source_event_seqs": [41],
                    "rules_profile": "cosy",
                    "rules_pack_id": "cosy",
                    "rules_pack_version": "1",
                    "pack_id": "official",
                    "pack_version": "1"
                })
                .to_string(),
            ),
            ..EventView::default()
        };
        let receipt = EventView {
            seq: 43,
            type_name: semantic_receipts::STORY_RECEIPT_EVENT_TYPE.to_string(),
            actor_name: Some("Pip Marrow".to_string()),
            location_id: Some(804),
            content: Some(
                serde_json::json!({
                    "schema_version": 1,
                    "narration_key": "lantern-keeper.work",
                    "text": "Pip Marrow rekindles the beacon",
                    "event_seqs": [41, 42],
                    "next_response": "carry the news home"
                })
                .to_string(),
            ),
            ..EventView::default()
        };

        let beats = journal_beat_views(&[receipt, raw], 804);

        assert_eq!(
            beats,
            vec![JournalBeatView {
                id: "journal-beat:v1:804:43".to_string(),
                source_event_seqs: vec![41, 42, 43],
                category: JournalBeatCategory::Work,
                headline: "Pip Marrow rekindles the beacon.".to_string(),
                location_id: 804,
                ordering_seq: 43,
                world_beat_exposure_id: None,
            }]
        );
    }

    #[test]
    fn journal_beats_are_typed_ordered_and_omit_unknown_events() {
        let movement = EventView {
            seq: 9,
            type_name: "actor.moved".to_string(),
            actor_name: Some("Pip Marrow".to_string()),
            location_id: Some(2),
            destination_location_id: Some(3),
            destination_location_name: Some("Moonlit Trail".to_string()),
            ..EventView::default()
        };
        let unknown = EventView {
            seq: 10,
            type_name: "future.internal.telemetry".to_string(),
            location_id: Some(2),
            content: Some("this must never become Journal prose".to_string()),
            ..EventView::default()
        };

        let beats = journal_beat_views(&[unknown, movement], 2);

        assert_eq!(beats.len(), 1);
        assert_eq!(beats[0].category, JournalBeatCategory::Travel);
        assert_eq!(beats[0].headline, "Pip Marrow left for Moonlit Trail.");
        assert_eq!(beats[0].source_event_seqs, vec![9]);
    }

    #[test]
    fn journal_beats_group_search_discovery_by_semantics_not_input_adjacency() {
        let search = EventView {
            seq: 100,
            type_name: "location.searched".to_string(),
            actor_id: Some(5000),
            actor_name: Some("Elsie".to_string()),
            location_id: Some(7),
            location_name: Some("Rain-Soft Garden".to_string()),
            ..EventView::default()
        };
        let search_tag = EventView {
            seq: 101,
            type_name: "tag.applied".to_string(),
            actor_id: Some(5000),
            actor_name: Some("Elsie".to_string()),
            location_id: Some(7),
            location_name: Some("Rain-Soft Garden".to_string()),
            content: Some("search_location".to_string()),
            tag_label: Some("path to the Old Oak Tree".to_string()),
            ..EventView::default()
        };
        let search_memory = EventView {
            seq: 103,
            type_name: "ledger.marked".to_string(),
            actor_id: Some(5000),
            actor_name: Some("Elsie".to_string()),
            location_id: Some(7),
            location_name: Some("Rain-Soft Garden".to_string()),
            content: Some(
                "location:You noticed what this place keeps.:location_search:7".to_string(),
            ),
            ..EventView::default()
        };
        let discovery = EventView {
            seq: 105,
            type_name: "exit.discovered".to_string(),
            actor_id: Some(5000),
            actor_name: Some("Elsie".to_string()),
            location_id: Some(7),
            location_name: Some("Rain-Soft Garden".to_string()),
            destination_location_id: Some(9),
            destination_location_name: Some("the Old Oak Tree".to_string()),
            caused_by_event_seq: Some(100),
            ..EventView::default()
        };

        let chronological = journal_beat_views(
            &[
                search.clone(),
                search_tag.clone(),
                search_memory.clone(),
                discovery.clone(),
            ],
            7,
        );
        let reordered = journal_beat_views(&[search_memory, discovery, search_tag, search], 7);

        assert_eq!(chronological, reordered);
        assert_eq!(
            chronological,
            vec![JournalBeatView {
                id: "journal-beat:v1:7:100".to_string(),
                source_event_seqs: vec![100, 101, 103, 105],
                category: JournalBeatCategory::Discovery,
                headline: "Elsie discovered a path to the Old Oak Tree while searching Rain-Soft Garden; the route is now available for travel.".to_string(),
                location_id: 7,
                ordering_seq: 105,
                world_beat_exposure_id: None,
            }]
        );
    }

    #[test]
    fn journal_beats_keep_empty_search_as_one_clear_beat() {
        let search = EventView {
            seq: 200,
            type_name: "feature.searched".to_string(),
            actor_id: Some(5000),
            actor_name: Some("Elsie".to_string()),
            location_id: Some(7),
            location_name: Some("Rain-Soft Garden".to_string()),
            content: Some("mossy bench:nothing stirred:search_feature".to_string()),
            ..EventView::default()
        };
        let search_tag = EventView {
            seq: 202,
            type_name: "tag.applied".to_string(),
            actor_id: Some(5000),
            actor_name: Some("Elsie".to_string()),
            location_id: Some(7),
            location_name: Some("Rain-Soft Garden".to_string()),
            content: Some("search_feature".to_string()),
            ..EventView::default()
        };
        let search_memory = EventView {
            seq: 203,
            type_name: "ledger.marked".to_string(),
            actor_id: Some(5000),
            actor_name: Some("Elsie".to_string()),
            location_id: Some(7),
            location_name: Some("Rain-Soft Garden".to_string()),
            content: Some(
                "feature:You recorded a room detail.:feature_search:7:mossy-bench".to_string(),
            ),
            ..EventView::default()
        };

        let beats = journal_beat_views(&[search_memory, search, search_tag], 7);

        assert_eq!(beats.len(), 1);
        assert_eq!(beats[0].category, JournalBeatCategory::Search);
        assert_eq!(
            beats[0].headline,
            "Elsie searched mossy bench in Rain-Soft Garden, but found nothing new."
        );
        assert_eq!(beats[0].source_event_seqs, vec![200, 202, 203]);
    }

    #[test]
    fn journal_beats_group_movement_and_paused_journey_with_resumable_destination() {
        let journey_origin = EventView {
            seq: 90,
            type_name: "pathway.discovered".to_string(),
            actor_id: Some(5000),
            actor_name: Some("Elsie".to_string()),
            location_id: Some(7),
            location_name: Some("Rain-Soft Garden".to_string()),
            destination_location_id: Some(9),
            destination_location_name: Some("the Old Oak Tree".to_string()),
            content: Some("Elsie found the first usable stretch of the path.".to_string()),
            ..EventView::default()
        };
        let movement = EventView {
            seq: 110,
            type_name: "actor.moved".to_string(),
            actor_id: Some(5000),
            actor_name: Some("Elsie".to_string()),
            location_id: Some(7),
            location_name: Some("Rain-Soft Garden".to_string()),
            destination_location_id: Some(8),
            destination_location_name: Some("the Cosy Cottage".to_string()),
            ..EventView::default()
        };
        let intermediate = EventView {
            seq: 112,
            type_name: "tag.applied".to_string(),
            actor_id: Some(5000),
            actor_name: Some("Elsie".to_string()),
            location_id: Some(8),
            location_name: Some("the Cosy Cottage".to_string()),
            content: Some("frontier_travel".to_string()),
            tag_label: Some("frontier travel".to_string()),
            ..EventView::default()
        };
        let paused = EventView {
            seq: 114,
            type_name: "journey.paused".to_string(),
            actor_id: Some(5000),
            actor_name: Some("Elsie".to_string()),
            location_id: Some(8),
            location_name: Some("the Cosy Cottage".to_string()),
            content: Some("journey.paused -> raw transition".to_string()),
            ..EventView::default()
        };

        let chronological = journal_beat_views(
            &[
                journey_origin.clone(),
                movement.clone(),
                intermediate.clone(),
                paused.clone(),
            ],
            7,
        );
        let reordered = journal_beat_views(&[paused, intermediate, journey_origin, movement], 7);
        let travel = chronological
            .iter()
            .find(|beat| beat.category == JournalBeatCategory::Travel)
            .expect("movement and pause form one travel beat");

        assert_eq!(chronological, reordered);
        assert_eq!(
            travel.headline,
            "Elsie left Rain-Soft Garden for the Cosy Cottage; the journey to the Old Oak Tree is paused and can be resumed later."
        );
        assert_eq!(travel.source_event_seqs, vec![110, 114]);
        assert!(!serde_json::to_string(&chronological)
            .unwrap()
            .contains("journey.paused"));
        assert!(
            !chronological.iter().any(|beat| beat.headline.contains("->")
                || beat.headline.split_whitespace().any(|word| {
                    matches!(
                        word.trim_matches(|character: char| !character.is_ascii_alphabetic()),
                        "tag" | "event"
                    )
                }))
        );
    }

    #[test]
    fn journal_projection_golden_fixtures_cover_travel_relationship_and_clock_progress() {
        let ordinary_travel = EventView {
            seq: 300,
            type_name: "actor.moved".to_string(),
            actor_id: Some(5000),
            actor_name: Some("Elsie".to_string()),
            location_id: Some(7),
            location_name: Some("Rain-Soft Garden".to_string()),
            destination_location_id: Some(8),
            destination_location_name: Some("the Cosy Cottage".to_string()),
            ..EventView::default()
        };
        let completed_step = EventView {
            seq: 310,
            type_name: "actor.moved".to_string(),
            actor_id: Some(5000),
            actor_name: Some("Elsie".to_string()),
            location_id: Some(7),
            location_name: Some("Rain-Soft Garden".to_string()),
            destination_location_id: Some(8),
            destination_location_name: Some("the Cosy Cottage".to_string()),
            ..EventView::default()
        };
        let completed_journey = EventView {
            seq: 314,
            type_name: "journey.completed".to_string(),
            actor_id: Some(5000),
            actor_name: Some("Elsie".to_string()),
            location_id: Some(8),
            location_name: Some("the Cosy Cottage".to_string()),
            destination_location_id: Some(9),
            destination_location_name: Some("the Old Oak Tree".to_string()),
            caused_by_event_seq: Some(310),
            ..EventView::default()
        };
        let relationship = EventView {
            seq: 320,
            type_name: "bond.deepened".to_string(),
            actor_id: Some(5000),
            actor_name: Some("Elsie".to_string()),
            target_actor_id: Some(5001),
            target_actor_name: Some("Pip Marrow".to_string()),
            location_id: Some(7),
            location_name: Some("Rain-Soft Garden".to_string()),
            ..EventView::default()
        };
        let clock = EventView {
            seq: 330,
            type_name: "clock.updated".to_string(),
            actor_id: Some(5000),
            actor_name: Some("Elsie".to_string()),
            location_id: Some(7),
            location_name: Some("Rain-Soft Garden".to_string()),
            clock_label: Some("The washed path".to_string()),
            clock_filled: Some(2),
            clock_segments: Some(4),
            clock_delta: Some(1),
            ..EventView::default()
        };

        let ordinary = journal_beat_views(&[ordinary_travel], 7);
        assert_eq!(ordinary.len(), 1);
        assert_eq!(ordinary[0].category, JournalBeatCategory::Travel);
        assert_eq!(ordinary[0].headline, "Elsie left for the Cosy Cottage.");
        assert_eq!(ordinary[0].source_event_seqs, vec![300]);

        let completed = journal_beat_views(&[completed_journey, completed_step], 7);
        assert_eq!(completed.len(), 1);
        assert_eq!(completed[0].category, JournalBeatCategory::Travel);
        assert_eq!(
            completed[0].headline,
            "Elsie traveled from Rain-Soft Garden to the Cosy Cottage and completed the journey to the Old Oak Tree."
        );
        assert_eq!(completed[0].source_event_seqs, vec![310, 314]);

        let semantic = journal_beat_views(&[clock, relationship], 7);
        assert_eq!(semantic.len(), 2);
        assert_eq!(semantic[0].category, JournalBeatCategory::Relationship);
        assert_eq!(semantic[0].headline, "Elsie grew closer to Pip Marrow.");
        assert_eq!(semantic[0].source_event_seqs, vec![320]);
        assert_eq!(semantic[1].category, JournalBeatCategory::Consequence);
        assert_eq!(semantic[1].headline, "The washed path draws closer.");
        assert_eq!(semantic[1].source_event_seqs, vec![330]);

        for beat in ordinary.iter().chain(&completed).chain(&semantic) {
            let copy = beat.headline.as_str();
            assert!(copy.ends_with(['.', '!', '?', '…']));
            assert!(!copy.contains("->"));
            assert!(!copy.contains("Something changed"));
            assert!(!copy.contains("journey."));
            assert!(!copy.starts_with("is now "));
            assert!(!copy.starts_with("shakes off "));
        }
    }

    #[test]
    fn journal_beats_serialize_identically_across_replay_order() {
        let earlier = EventView {
            seq: 20,
            type_name: "item.found".to_string(),
            actor_name: Some("Pip Marrow".to_string()),
            location_id: Some(7),
            item_name: Some("Story Button".to_string()),
            ..EventView::default()
        };
        let later = EventView {
            seq: 21,
            type_name: "bond.deepened".to_string(),
            actor_name: Some("Pip Marrow".to_string()),
            target_actor_name: Some("Moss Stitch".to_string()),
            location_id: Some(7),
            ..EventView::default()
        };

        let chronological =
            serde_json::to_vec(&journal_beat_views(&[earlier.clone(), later.clone()], 7)).unwrap();
        let replayed = serde_json::to_vec(&journal_beat_views(&[later, earlier], 7)).unwrap();

        assert_eq!(chronological, replayed);
    }

    #[test]
    fn journal_world_beats_keep_authored_prose_and_receipt_identity() {
        let event = EventView {
            seq: 31,
            type_name: "world.weather.shifted".to_string(),
            location_id: Some(7),
            content: Some("Rain thins into pearl-grey mist".to_string()),
            ..EventView::default()
        };

        let beats = journal_beat_views(&[event], 7);

        assert_eq!(beats.len(), 1);
        assert_eq!(beats[0].category, JournalBeatCategory::Consequence);
        assert_eq!(beats[0].headline, "Rain thins into pearl-grey mist.");
        assert_eq!(
            beats[0].world_beat_exposure_id.as_deref(),
            Some("world-beat:v1:31")
        );
    }
}
