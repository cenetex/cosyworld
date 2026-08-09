use super::*;

pub(crate) const WORLD_ENTITY_CONTEXT_SPINE_VERSION: u8 = 1;
const WORLD_ENTITY_MEMORY_CAPACITY: usize = 32;
const WORLD_ENTITY_TOP_RECOLLECTIONS: usize = 3;
const ITEM_HISTORY_GOAL_LOCATIONS: u8 = 3;

#[derive(Clone, Copy, Debug, Default, Deserialize, Eq, Ord, PartialEq, PartialOrd, Serialize)]
#[serde(rename_all = "snake_case")]
pub(crate) enum WorldEntityKind {
    #[default]
    Avatar,
    Item,
    Location,
}

impl WorldEntityKind {
    pub(crate) fn as_str(self) -> &'static str {
        match self {
            Self::Avatar => "avatar",
            Self::Item => "item",
            Self::Location => "location",
        }
    }

    fn self_description_event(self) -> &'static str {
        match self {
            Self::Avatar => "avatar.self_description",
            Self::Item => "item.self_description",
            Self::Location => "location.self_description",
        }
    }
}

#[derive(Clone, Copy, Debug, Default, Deserialize, Eq, Ord, PartialEq, PartialOrd, Serialize)]
pub(crate) struct WorldEntityRef {
    pub(crate) kind: WorldEntityKind,
    pub(crate) id: u64,
}

impl WorldEntityRef {
    pub(crate) fn avatar(id: u64) -> Self {
        Self {
            kind: WorldEntityKind::Avatar,
            id,
        }
    }

    pub(crate) fn item(id: u64) -> Self {
        Self {
            kind: WorldEntityKind::Item,
            id,
        }
    }

    pub(crate) fn location(id: u64) -> Self {
        Self {
            kind: WorldEntityKind::Location,
            id,
        }
    }

    pub(crate) fn key(self) -> String {
        format!("{}:{}", self.kind.as_str(), self.id)
    }
}

#[derive(Clone, Debug, Default, Deserialize, Eq, PartialEq, Serialize)]
pub(crate) struct WorldEntityMemoryAtom {
    pub(crate) source_event_seq: u64,
    pub(crate) kind: String,
    pub(crate) text: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) location_id: Option<u64>,
    #[serde(default)]
    pub(crate) salience: u8,
}

#[derive(Clone, Debug, Default, Deserialize, Eq, PartialEq, Serialize)]
pub(crate) struct WorldEntityMemoryState {
    #[serde(default)]
    pub(crate) use_count: u32,
    #[serde(default)]
    pub(crate) meaningful_event_count: u32,
    #[serde(default)]
    pub(crate) visited_location_ids: BTreeSet<u64>,
    #[serde(default)]
    pub(crate) memories: Vec<WorldEntityMemoryAtom>,
    #[serde(default)]
    pub(crate) descriptions_by_level: BTreeMap<u8, String>,
}

#[derive(Clone, Copy, Debug, Default, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub(crate) enum EntityGoalKind {
    #[default]
    AvatarPossessesItem,
    LocationPossessesItem,
    ItemCollectsLocationHistory,
}

#[derive(Clone, Copy, Debug, Default, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub(crate) enum EntityGoalStatus {
    #[default]
    Active,
    Completed,
}

#[derive(Clone, Debug, Default, Deserialize, Eq, PartialEq, Serialize)]
pub(crate) struct EntityGoalState {
    pub(crate) id: String,
    pub(crate) owner: WorldEntityRef,
    pub(crate) kind: EntityGoalKind,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) avatar_id: Option<u64>,
    pub(crate) item_id: u64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) location_id: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) target_distinct_locations: Option<u8>,
    pub(crate) motivation: String,
    pub(crate) status: EntityGoalStatus,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) created_event_seq: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) resolved_event_seq: Option<u64>,
}

#[derive(Clone, Debug, Default, Deserialize, Serialize)]
pub(crate) struct WorldEntityContextSpine {
    #[serde(default)]
    pub(crate) schema_version: u8,
    #[serde(default)]
    pub(crate) world_tick: u64,
    #[serde(default)]
    pub(crate) observed_through_seq: u64,
    pub(crate) subject: WorldEntityRef,
    pub(crate) name: String,
    pub(crate) level: u8,
    pub(crate) canonical_description: String,
    pub(crate) persona: String,
    pub(crate) appearance: String,
    #[serde(default)]
    pub(crate) current_state: Vec<String>,
    #[serde(default)]
    pub(crate) goals: Vec<String>,
    #[serde(default)]
    pub(crate) recollection_candidates: Vec<AvatarContextRecollection>,
    #[serde(default)]
    pub(crate) selected_recollections: Vec<AvatarContextRecollection>,
    #[serde(default)]
    pub(crate) current_beat: String,
    #[serde(default)]
    pub(crate) self_description_due: bool,
}

impl WorldEntityContextSpine {
    pub(crate) fn is_current(&self) -> bool {
        self.schema_version == WORLD_ENTITY_CONTEXT_SPINE_VERSION
            && self.subject.id != 0
            && !self.name.trim().is_empty()
    }

    fn semantic_query(&self) -> String {
        let mut parts = vec![
            self.name.clone(),
            self.canonical_description.clone(),
            self.persona.clone(),
            self.current_beat.clone(),
        ];
        parts.extend(self.current_state.iter().take(4).cloned());
        parts.extend(self.goals.iter().take(3).cloned());
        parts.join(" ")
    }

    fn refresh_recollections(&mut self) {
        self.selected_recollections = semantic_top_recollections(
            &self.semantic_query(),
            &self.recollection_candidates,
            WORLD_ENTITY_TOP_RECOLLECTIONS,
        );
    }

    pub(crate) fn self_description_prompt(&self, max_words: usize) -> PromptEnvelope {
        let kind = self.subject.kind.as_str();
        let system = format!(
            "Write {name}'s first-person level-{level} self-description as an in-world {kind}. Give it an independent persona—attention, preferences, dislikes, desires, and relationships to its surroundings—and an observable appearance. Gentle animism is welcome, but do not claim unrecorded movement, ownership, use, visitors, locations, memories, or physical changes. Preserve canonical identity and distinguish interpretation from world fact. Use only the supplied context spine. Output one compact paragraph under {max_words} words.",
            name = self.name,
            level = self.level,
        );
        let mut prompt = PromptEnvelope::default()
            .system(system)
            .user(
                format!(
                    "ENTITY · {} {} · level {}",
                    kind.to_ascii_uppercase(),
                    self.name,
                    self.level
                ),
                PromptSegmentKind::UniqueEvidence,
                100,
                true,
            )
            .user(
                format!("CANONICAL · {}", self.canonical_description),
                PromptSegmentKind::UniqueEvidence,
                98,
                true,
            )
            .user(
                format!("ESTABLISHED PERSONA · {}", self.persona),
                PromptSegmentKind::UniqueEvidence,
                94,
                true,
            )
            .user(
                format!("ESTABLISHED APPEARANCE · {}", self.appearance),
                PromptSegmentKind::UniqueEvidence,
                94,
                true,
            );
        for state in self.current_state.iter().take(8) {
            prompt = prompt.user(
                format!("CURRENT STATE · {state}"),
                PromptSegmentKind::UniqueEvidence,
                82,
                false,
            );
        }
        for goal in self.goals.iter().take(4) {
            prompt = prompt.user(
                format!("OPEN GOAL · {goal}"),
                PromptSegmentKind::UniqueEvidence,
                86,
                false,
            );
        }
        for memory in self
            .selected_recollections
            .iter()
            .take(WORLD_ENTITY_TOP_RECOLLECTIONS)
        {
            prompt = prompt.user(
                format!("RETRIEVED {} · {}", memory.kind, memory.text),
                PromptSegmentKind::UniqueEvidence,
                88,
                true,
            );
        }
        prompt
            .user(
                format!("NOW · {}", self.current_beat),
                PromptSegmentKind::UniqueEvidence,
                100,
                true,
            )
            .user(
                "RESPONSE JOB · Reconsider persona and appearance at this level without inventing history.".to_string(),
                PromptSegmentKind::Envelope,
                100,
                true,
            )
    }

    pub(crate) fn anchors(&self) -> Vec<String> {
        let mut anchors = vec![
            self.name.clone(),
            self.canonical_description.clone(),
            self.persona.clone(),
            self.appearance.clone(),
            self.current_beat.clone(),
        ];
        anchors.extend(self.current_state.iter().take(5).cloned());
        anchors.extend(
            self.selected_recollections
                .iter()
                .map(|memory| memory.text.clone()),
        );
        anchors
    }
}

#[derive(Clone, Debug, Deserialize, Serialize)]
pub(super) struct EntitySelfDescriptionProjection {
    pub(super) subject: WorldEntityRef,
    pub(super) content_id: u64,
    pub(super) level: u8,
    pub(super) source_actor_id: u64,
    pub(super) source_location_id: u64,
    pub(super) caused_by_event_seq: Option<u64>,
    pub(super) source_world_tick: u64,
    pub(super) observed_through_seq: u64,
}

impl RuntimeWorld {
    pub(crate) fn backfill_world_entity_state_if_missing(&mut self) {
        if self.entity_memories.is_empty() {
            let projected_events = self.event_log.clone();
            self.record_world_entity_memories(&projected_events);
        }
        if self.goal_ledger.is_empty() {
            self.refresh_entity_goal_ledger();
        }
    }

    pub(crate) fn record_committed_world_entity_memories(&mut self, events: &[EventView]) {
        let committed_sequences = events
            .iter()
            .map(|event| event.seq)
            .collect::<BTreeSet<_>>();
        let committed_events = self
            .event_log
            .iter()
            .filter(|event| committed_sequences.contains(&event.seq))
            .cloned()
            .collect::<Vec<_>>();
        self.record_world_entity_memories(&committed_events);
    }

    pub(crate) fn world_entity_level(&self, subject: WorldEntityRef) -> Option<u8> {
        match subject.kind {
            WorldEntityKind::Avatar => self
                .actor_by_id(subject.id)
                .map(|actor| actor.stats.level.max(1)),
            WorldEntityKind::Item => self.item_by_id(subject.id).map(|_| {
                let uses = self
                    .entity_memories
                    .get(&subject.key())
                    .map(|state| state.use_count)
                    .unwrap_or_default();
                1u8.saturating_add((uses / 3).min(19) as u8)
            }),
            WorldEntityKind::Location => self.location_name(subject.id).map(|_| {
                let history = self
                    .entity_memories
                    .get(&subject.key())
                    .map(|state| state.meaningful_event_count)
                    .unwrap_or_default();
                1u8.saturating_add((history / 8).min(19) as u8)
            }),
        }
    }

    fn world_entity_name(&self, subject: WorldEntityRef) -> Option<String> {
        match subject.kind {
            WorldEntityKind::Avatar => self
                .actor_name(subject.id)
                .map(|name| grounded_avatar_name_for_prompt(subject.id, &name)),
            WorldEntityKind::Item => self.item_name(subject.id),
            WorldEntityKind::Location => self.location_name(subject.id),
        }
    }

    pub(crate) fn latest_world_entity_description(
        &self,
        subject: WorldEntityRef,
    ) -> Option<String> {
        self.entity_memories
            .get(&subject.key())
            .and_then(|state| state.descriptions_by_level.iter().next_back())
            .map(|(_, description)| description.clone())
            .filter(|description| !description.trim().is_empty())
    }

    pub(crate) fn world_entity_self_description_due(&self, subject: WorldEntityRef) -> bool {
        let Some(level) = self.world_entity_level(subject) else {
            return false;
        };
        !self
            .entity_memories
            .get(&subject.key())
            .is_some_and(|state| state.descriptions_by_level.contains_key(&level))
    }

    pub(crate) fn world_entity_context_spine(
        &self,
        subject: WorldEntityRef,
        current_beat: impl Into<String>,
    ) -> Option<WorldEntityContextSpine> {
        let name = self.world_entity_name(subject)?;
        let level = self.world_entity_level(subject)?;
        let memory = self.entity_memories.get(&subject.key());
        let recollection_candidates = memory
            .into_iter()
            .flat_map(|memory| memory.memories.iter().rev().take(24))
            .map(|memory| AvatarContextRecollection {
                kind: memory.kind.clone(),
                text: memory.text.clone(),
                source_event_seq: Some(memory.source_event_seq),
                salience: memory.salience,
            })
            .collect::<Vec<_>>();
        let (canonical_description, authored_persona, appearance, current_state) = match subject
            .kind
        {
            WorldEntityKind::Avatar => {
                let actor = self.actor_by_id(subject.id)?;
                let meta = self.actors.get(&subject.id)?;
                let appearance = self
                    .character_identities
                    .get(&subject.id)
                    .map(|identity| identity.physical_description.clone())
                    .filter(|description| !description.trim().is_empty())
                    .unwrap_or_else(|| meta.description.clone());
                let held = self
                    .actor_held_items(subject.id)
                    .into_iter()
                    .take(8)
                    .filter_map(|item| self.item_name(item.id))
                    .collect::<Vec<_>>();
                (
                    format!("{} — {}", meta.title, meta.description),
                    grounded_avatar_persona_for_prompt(subject.id, &meta.description),
                    appearance,
                    vec![
                        format!(
                            "currently at {}",
                            self.location_name(actor.location_id)
                                .unwrap_or_else(|| "an unnamed place".to_string())
                        ),
                        if held.is_empty() {
                            "currently carries no items".to_string()
                        } else {
                            format!("currently carries {}", held.join(", "))
                        },
                    ],
                )
            }
            WorldEntityKind::Item => {
                let item = self.item_by_id(subject.id)?;
                let meta = self.items.get(&subject.id)?;
                let mut state = vec![format!(
                    "{} with {} uses in its history",
                    item_kind(item.kind),
                    memory.map(|state| state.use_count).unwrap_or_default()
                )];
                if item.holder_actor_id != 0 {
                    state.push(format!(
                        "currently carried by {}",
                        self.actor_name(item.holder_actor_id)
                            .unwrap_or_else(|| "an unnamed avatar".to_string())
                    ));
                } else if item.location_id != 0 {
                    state.push(format!(
                        "currently rests at {}",
                        self.location_name(item.location_id)
                            .unwrap_or_else(|| "an unnamed place".to_string())
                    ));
                } else {
                    state.push("currently hidden and unclaimed".to_string());
                }
                if item.container_item_id != 0 {
                    state.push(format!(
                        "currently contained in {}",
                        self.item_name(item.container_item_id)
                            .unwrap_or_else(|| "an unnamed container".to_string())
                    ));
                }
                if let Some(memory) = memory {
                    let names = memory
                        .visited_location_ids
                        .iter()
                        .filter_map(|id| self.location_name(*id))
                        .take(8)
                        .collect::<Vec<_>>();
                    if !names.is_empty() {
                        state.push(format!("recorded places: {}", names.join(", ")));
                    }
                }
                (
                    meta.description.clone(),
                    format!(
                        "A {} with a history shaped only by recorded use and custody.",
                        meta.name
                    ),
                    meta.description.clone(),
                    state,
                )
            }
            WorldEntityKind::Location => {
                let meta = self.location_meta_for(subject.id);
                let floor_items = self.world.items[..self.world.item_count]
                    .iter()
                    .filter(|item| item.holder_actor_id == 0 && item.location_id == subject.id)
                    .filter_map(|item| self.item_name(item.id))
                    .take(10)
                    .collect::<Vec<_>>();
                let cast = self.world.actors[..self.world.actor_count]
                    .iter()
                    .filter(|actor| Self::actor_can_act(**actor) && actor.location_id == subject.id)
                    .filter_map(|actor| self.actor_name(actor.id))
                    .take(10)
                    .collect::<Vec<_>>();
                let mut state = vec![if floor_items.is_empty() {
                    "contains no visible loose items".to_string()
                } else {
                    format!("contains {}", floor_items.join(", "))
                }];
                if !cast.is_empty() {
                    state.push(format!("currently hosts {}", cast.join(", ")));
                }
                (
                    meta.description.clone(),
                    meta.persona.clone(),
                    [meta.description.clone(), meta.terrain.join(", ")]
                        .into_iter()
                        .filter(|part| !part.trim().is_empty())
                        .collect::<Vec<_>>()
                        .join("; "),
                    state,
                )
            }
        };
        let persona = self
            .latest_world_entity_description(subject)
            .unwrap_or(authored_persona);
        let mut spine = WorldEntityContextSpine {
            schema_version: WORLD_ENTITY_CONTEXT_SPINE_VERSION,
            world_tick: self.world.tick,
            observed_through_seq: self.world.next_event_seq.saturating_sub(1),
            subject,
            name,
            level,
            canonical_description,
            persona,
            appearance,
            current_state,
            goals: self.entity_goal_lines_for(subject, 6),
            recollection_candidates,
            selected_recollections: Vec::new(),
            current_beat: current_beat.into(),
            self_description_due: self.world_entity_self_description_due(subject),
        };
        spine.refresh_recollections();
        Some(spine)
    }

    pub(crate) fn entity_goal_lines_for(&self, owner: WorldEntityRef, limit: usize) -> Vec<String> {
        self.goal_ledger
            .values()
            .filter(|goal| goal.owner == owner && goal.status == EntityGoalStatus::Active)
            .take(limit)
            .map(|goal| self.entity_goal_line(goal))
            .collect()
    }

    fn entity_goal_line(&self, goal: &EntityGoalState) -> String {
        let item = self
            .item_name(goal.item_id)
            .unwrap_or_else(|| format!("Item {}", goal.item_id));
        match goal.kind {
            EntityGoalKind::AvatarPossessesItem => {
                format!("Possess {item}: {}", goal.motivation)
            }
            EntityGoalKind::LocationPossessesItem => {
                let location = goal
                    .location_id
                    .and_then(|id| self.location_name(id))
                    .unwrap_or_else(|| "an unnamed place".to_string());
                format!("Let {location} contain {item}: {}", goal.motivation)
            }
            EntityGoalKind::ItemCollectsLocationHistory => format!(
                "Let {item} collect history in {} distinct locations: {}",
                goal.target_distinct_locations
                    .unwrap_or(ITEM_HISTORY_GOAL_LOCATIONS),
                goal.motivation
            ),
        }
    }

    pub(crate) fn refresh_entity_goal_ledger(&mut self) {
        let prior = std::mem::take(&mut self.goal_ledger);
        let current_event_seq = self.world.next_event_seq.saturating_sub(1);
        let resolved_event_seq = |id: &str, completed: bool| {
            completed.then(|| {
                prior
                    .get(id)
                    .and_then(|goal| goal.resolved_event_seq)
                    .unwrap_or(current_event_seq)
            })
        };
        let mut goals = BTreeMap::new();
        let actors = self.world.actors[..self.world.actor_count].to_vec();
        for actor in actors
            .into_iter()
            .filter(|actor| Self::actor_can_act(*actor))
        {
            for item_id in self.resident_sought_item_ids(actor).into_iter().take(4) {
                let id = format!("avatar:{}:possesses:item:{}", actor.id, item_id);
                let completed = self
                    .item_by_id(item_id)
                    .is_some_and(|item| item.holder_actor_id == actor.id);
                let previous = prior.get(&id);
                goals.insert(
                    id.clone(),
                    EntityGoalState {
                        id: id.clone(),
                        owner: WorldEntityRef::avatar(actor.id),
                        kind: EntityGoalKind::AvatarPossessesItem,
                        avatar_id: Some(actor.id),
                        item_id,
                        location_id: Some(actor.location_id),
                        target_distinct_locations: None,
                        motivation: self.resident_item_request_reason(actor, item_id),
                        status: if completed {
                            EntityGoalStatus::Completed
                        } else {
                            EntityGoalStatus::Active
                        },
                        created_event_seq: previous
                            .and_then(|goal| goal.created_event_seq)
                            .or_else(|| self.world.next_event_seq.checked_sub(1)),
                        resolved_event_seq: resolved_event_seq(&id, completed),
                    },
                );
            }
        }

        for feature in &active_content().room_features {
            for use_case in &feature.uses {
                let location_id = feature.location_id;
                let item_id = use_case.item_id;
                let id = format!("location:{location_id}:possesses:item:{item_id}");
                let completed = self.item_by_id(item_id).is_some_and(|item| {
                    item.holder_actor_id == 0 && item.location_id == location_id
                });
                goals.insert(
                    id.clone(),
                    EntityGoalState {
                        id: id.clone(),
                        owner: WorldEntityRef::location(location_id),
                        kind: EntityGoalKind::LocationPossessesItem,
                        avatar_id: None,
                        item_id,
                        location_id: Some(location_id),
                        target_distinct_locations: None,
                        motivation: format!("{} can answer {}", feature.name, use_case.text),
                        status: if completed {
                            EntityGoalStatus::Completed
                        } else {
                            EntityGoalStatus::Active
                        },
                        created_event_seq: prior.get(&id).and_then(|goal| goal.created_event_seq),
                        resolved_event_seq: resolved_event_seq(&id, completed),
                    },
                );
                for actor in self.world.actors[..self.world.actor_count]
                    .iter()
                    .copied()
                    .filter(|actor| Self::actor_can_act(*actor) && actor.location_id == location_id)
                {
                    let id = format!(
                        "avatar:{}:location:{}:possesses:item:{}",
                        actor.id, location_id, item_id
                    );
                    goals.insert(
                        id.clone(),
                        EntityGoalState {
                            id: id.clone(),
                            owner: WorldEntityRef::avatar(actor.id),
                            kind: EntityGoalKind::LocationPossessesItem,
                            avatar_id: Some(actor.id),
                            item_id,
                            location_id: Some(location_id),
                            target_distinct_locations: None,
                            motivation: format!(
                                "help {} hold what {} needs",
                                self.location_name(location_id)
                                    .unwrap_or_else(|| "this place".to_string()),
                                feature.name
                            ),
                            status: if completed {
                                EntityGoalStatus::Completed
                            } else {
                                EntityGoalStatus::Active
                            },
                            created_event_seq: prior
                                .get(&id)
                                .and_then(|goal| goal.created_event_seq),
                            resolved_event_seq: resolved_event_seq(&id, completed),
                        },
                    );
                }
            }
        }

        for item in &active_content().items {
            if item.location_id == 0 || self.item_by_id(item.id).is_none() {
                continue;
            }
            let visited = self
                .entity_memories
                .get(&WorldEntityRef::item(item.id).key())
                .map(|state| state.visited_location_ids.len())
                .unwrap_or_default();
            let id = format!(
                "location:{}:item:{}:collects-location-history",
                item.location_id, item.id
            );
            let completed = visited >= usize::from(ITEM_HISTORY_GOAL_LOCATIONS);
            goals.insert(
                id.clone(),
                EntityGoalState {
                    id: id.clone(),
                    owner: WorldEntityRef::location(item.location_id),
                    kind: EntityGoalKind::ItemCollectsLocationHistory,
                    avatar_id: None,
                    item_id: item.id,
                    location_id: Some(item.location_id),
                    target_distinct_locations: Some(ITEM_HISTORY_GOAL_LOCATIONS),
                    motivation: "bring other places back as recorded history".to_string(),
                    status: if completed {
                        EntityGoalStatus::Completed
                    } else {
                        EntityGoalStatus::Active
                    },
                    created_event_seq: prior.get(&id).and_then(|goal| goal.created_event_seq),
                    resolved_event_seq: resolved_event_seq(&id, completed),
                },
            );
        }
        self.goal_ledger = goals;
    }

    pub(crate) fn visible_entity_goals(
        &self,
        client_actor_id: Option<u64>,
        location_id: u64,
    ) -> Vec<EntityGoalState> {
        self.goal_ledger
            .values()
            .filter(|goal| match goal.owner.kind {
                WorldEntityKind::Avatar => client_actor_id == Some(goal.owner.id),
                WorldEntityKind::Location => goal.owner.id == location_id,
                WorldEntityKind::Item => self.item_by_id(goal.owner.id).is_some_and(|item| {
                    item.location_id == location_id || client_actor_id == Some(item.holder_actor_id)
                }),
            })
            .cloned()
            .collect()
    }

    pub(crate) fn record_world_entity_memories(&mut self, events: &[EventView]) {
        for event in events.iter().filter(|event| event.success) {
            let private_character_event =
                matches!(event.type_name.as_str(), "avatar.thought" | "avatar.dream");
            let non_avatar_self_description = matches!(
                event.type_name.as_str(),
                "item.self_description" | "location.self_description"
            );
            let text = event
                .content
                .as_deref()
                .map(compact_whitespace)
                .filter(|text| !text.is_empty())
                .unwrap_or_else(|| event.type_name.replace(['.', '_'], " "));
            let location_id = event.location_id.or(event.destination_location_id);
            let mut subjects = Vec::new();
            if let Some(actor_id) = event.actor_id.filter(|_| !non_avatar_self_description) {
                subjects.push(WorldEntityRef::avatar(actor_id));
            }
            if !private_character_event {
                if let Some(item_id) = event.item_id {
                    subjects.push(WorldEntityRef::item(item_id));
                }
                if let Some(item_id) = event.target_item_id {
                    subjects.push(WorldEntityRef::item(item_id));
                }
                if let Some(location_id) = event.location_id {
                    subjects.push(WorldEntityRef::location(location_id));
                }
                if let Some(location_id) = event.destination_location_id {
                    subjects.push(WorldEntityRef::location(location_id));
                }
            }
            subjects.sort();
            subjects.dedup();
            for subject in subjects {
                let state = self.entity_memories.entry(subject.key()).or_default();
                if state.memories.iter().any(|memory| {
                    memory.source_event_seq == event.seq && memory.kind == event.type_name
                }) {
                    continue;
                }
                if subject.kind == WorldEntityKind::Item && event.type_name == "item.used" {
                    state.use_count = state.use_count.saturating_add(1);
                }
                if !event.type_name.ends_with("self_description")
                    && !event.type_name.starts_with("tag.")
                {
                    state.meaningful_event_count = state.meaningful_event_count.saturating_add(1);
                }
                if let Some(location_id) = location_id.filter(|id| *id != 0) {
                    state.visited_location_ids.insert(location_id);
                }
                if event.type_name == subject.kind.self_description_event() {
                    if let Some(level) = event.total.and_then(|level| u8::try_from(level).ok()) {
                        state.descriptions_by_level.insert(level, text.clone());
                    }
                }
                state.memories.push(WorldEntityMemoryAtom {
                    source_event_seq: event.seq,
                    kind: event.type_name.clone(),
                    text: text.clone(),
                    location_id,
                    salience: if event.type_name.ends_with("self_description") {
                        96
                    } else if event.type_name == "item.used" {
                        92
                    } else {
                        72
                    },
                });
                if state.memories.len() > WORLD_ENTITY_MEMORY_CAPACITY {
                    let overflow = state.memories.len() - WORLD_ENTITY_MEMORY_CAPACITY;
                    state.memories.drain(..overflow);
                }
            }
        }
    }

    pub(crate) fn bind_passive_item_perception(&self, record: &mut JournalRecord) {
        if !matches!(
            record.origin,
            JournalOrigin::PlayerCard | JournalOrigin::ActorConsequence
        ) || matches!(
            record.action.kind,
            CW_ACTION_NONE
                | CW_ACTION_SAY
                | CW_ACTION_SEARCH
                | CW_ACTION_SEARCH_V2
                | CW_ACTION_CREATE_ACTOR
        ) || record.projection_mutations.iter().any(|mutation| {
            matches!(
                mutation,
                ProjectionMutation::RememberSearchItem { .. }
                    | ProjectionMutation::PassivePerceiveItem { .. }
            )
        }) {
            return;
        }
        let Some(actor) = self
            .actor_by_id(record.action.actor_id)
            .filter(|actor| Self::actor_can_act(*actor))
        else {
            return;
        };
        let location_id = actor.location_id;
        let Some(item_id) = self.hidden_search_item_for_location(location_id) else {
            return;
        };
        let Some(chance) = self.passive_item_perception_chance_percent(actor.id, item_id) else {
            return;
        };
        let roll = (stable_hash_u64(&[
            "passive-item-perception",
            &record.action.actor_id.to_string(),
            &item_id.to_string(),
            &record.seed.to_string(),
            &self.world.tick.to_string(),
        ]) % 100) as u8;
        if roll >= chance {
            return;
        }
        record
            .projection_mutations
            .push(ProjectionMutation::PassivePerceiveItem {
                item_id,
                location_id,
                chance_percent: chance,
                roll,
            });
        record
            .projection_mutations
            .push(ProjectionMutation::RememberSearchItem {
                item_id,
                location_id,
                reason: "passive_perception".to_string(),
            });
    }

    fn passive_item_perception_chance_percent(&self, actor_id: u64, item_id: u64) -> Option<u8> {
        let actor = self.actor_by_id(actor_id)?;
        self.item_by_id(item_id)?;
        let use_count = self
            .entity_memories
            .get(&WorldEntityRef::item(item_id).key())
            .map(|state| state.use_count)
            .unwrap_or_default();
        let use_familiarity = use_count.saturating_mul(12).min(48) as u8;
        let wisdom_attention = actor.stats.wisdom.clamp(0, 8) as u8 * 2;
        let rarity_hint = search_reveal_chance_percent_for_subject("item", item_id) / 5;
        Some(
            8u8.saturating_add(use_familiarity)
                .saturating_add(wisdom_attention)
                .saturating_add(rarity_hint)
                .min(75),
        )
    }

    pub(crate) fn apply_passive_item_perception(
        &mut self,
        actor_id: u64,
        item_id: u64,
        location_id: u64,
        chance_percent: u8,
        roll: u8,
    ) -> Option<EventView> {
        if chance_percent > 75 || roll >= chance_percent {
            return None;
        }
        let item_index = self.world.items[..self.world.item_count]
            .iter()
            .position(|item| {
                item.id == item_id
                    && item.holder_actor_id == 0
                    && (item.location_id == 0
                        || self.forgotten_search_item_at_location(*item, location_id))
            })?;
        self.world.items[item_index].location_id = location_id;
        self.world.items[item_index].holder_actor_id = 0;
        self.world.items[item_index].container_item_id = 0;
        self.world.items[item_index].zone = CW_CARD_ZONE_WORLD;
        let item_name = self
            .item_name(item_id)
            .unwrap_or_else(|| format!("Item {item_id}"));
        let location_name = self
            .location_name(location_id)
            .unwrap_or_else(|| "this place".to_string());
        let actor_name = self
            .actor_name(actor_id)
            .unwrap_or_else(|| "Someone".to_string());
        let mut event = self.append_async_job_event(
            "item.revealed",
            actor_id,
            None,
            Some(format!(
                "{actor_name} passively noticed {item_name} at {location_name}."
            )),
        );
        event.item_id = Some(item_id);
        event.location_id = Some(location_id);
        event.location_name = Some(location_name);
        event.raw_roll = Some(i16::from(roll) + 1);
        event.dc = Some(i16::from(chance_percent));
        self.replace_projected_event(&event);
        Some(event)
    }

    pub(super) fn append_entity_self_description_projection(
        &mut self,
        projection: &EntitySelfDescriptionProjection,
    ) -> Option<EventView> {
        let expected_level = self.world_entity_level(projection.subject)?;
        if expected_level != projection.level
            || !self.world_entity_self_description_due(projection.subject)
        {
            return None;
        }
        let content = self.content.get(&projection.content_id)?.clone();
        let mut event = self.append_async_job_event(
            projection.subject.kind.self_description_event(),
            projection.source_actor_id,
            None,
            Some(content),
        );
        event.content_id = Some(projection.content_id);
        event.location_id = Some(projection.source_location_id);
        event.location_name = self.location_name(projection.source_location_id);
        event.total = Some(i16::from(projection.level));
        event.item_id =
            (projection.subject.kind == WorldEntityKind::Item).then_some(projection.subject.id);
        event.target_actor_id =
            (projection.subject.kind == WorldEntityKind::Avatar).then_some(projection.subject.id);
        event.caused_by_event_seq = projection.caused_by_event_seq;
        event.source_world_tick = Some(projection.source_world_tick);
        event.observed_through_seq = Some(projection.observed_through_seq);
        event.source_location_id = Some(projection.source_location_id);
        self.replace_projected_event(&event);
        Some(event)
    }

    pub(crate) fn next_due_item_description_subject(
        &self,
        actor_id: u64,
        location_id: u64,
    ) -> Option<WorldEntityRef> {
        let mut items = self.world.items[..self.world.item_count]
            .iter()
            .filter(|item| {
                item.holder_actor_id == actor_id
                    || (item.holder_actor_id == 0 && item.location_id == location_id)
            })
            .map(|item| WorldEntityRef::item(item.id))
            .filter(|subject| self.world_entity_self_description_due(*subject))
            .collect::<Vec<_>>();
        items.sort_by_key(|subject| {
            let use_count = self
                .entity_memories
                .get(&subject.key())
                .map(|state| state.use_count)
                .unwrap_or_default();
            (use_count, subject.id)
        });
        items.into_iter().next()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn less_used_items_are_harder_to_notice_passively() {
        let mut runtime = RuntimeWorld::seeded();
        let subject = WorldEntityRef::item(STORY_BUTTON_ITEM_ID);
        let base_chance = runtime
            .passive_item_perception_chance_percent(RATI_ACTOR_ID, subject.id)
            .expect("base perception chance");
        runtime
            .entity_memories
            .entry(subject.key())
            .or_default()
            .use_count = 4;
        let familiar_chance = runtime
            .passive_item_perception_chance_percent(RATI_ACTOR_ID, subject.id)
            .expect("familiar perception chance");
        assert!(familiar_chance > base_chance);
    }

    #[test]
    fn passive_perception_reveals_and_remembers_an_item_through_the_journal() {
        let mut runtime = RuntimeWorld::seeded();
        create_test_human(
            &mut runtime,
            5000,
            COSY_COTTAGE_LOCATION_ID,
            "Quiet Observer",
        );
        for item in &mut runtime.world.items[..runtime.world.item_count] {
            if item.id == STORY_BUTTON_ITEM_ID {
                item.location_id = 0;
                item.holder_actor_id = 0;
                item.charges = item.charges.max(1);
            } else if item.location_id == COSY_COTTAGE_LOCATION_ID {
                item.location_id = RAIN_SOFT_GARDEN_LOCATION_ID;
            }
        }
        runtime.beliefs.clear();

        let mut record = JournalRecord::new(
            CwAction {
                kind: CW_ACTION_NONE,
                actor_id: 5000,
                location_id: COSY_COTTAGE_LOCATION_ID,
                ..CwAction::default()
            },
            91_044,
        );
        record.origin = JournalOrigin::PlayerCard;
        record
            .projection_mutations
            .push(ProjectionMutation::PassivePerceiveItem {
                item_id: STORY_BUTTON_ITEM_ID,
                location_id: COSY_COTTAGE_LOCATION_ID,
                chance_percent: 75,
                roll: 0,
            });
        record
            .projection_mutations
            .push(ProjectionMutation::RememberSearchItem {
                item_id: STORY_BUTTON_ITEM_ID,
                location_id: COSY_COTTAGE_LOCATION_ID,
                reason: "passive_perception".to_string(),
            });

        let (status, events) = runtime.apply_journal_record(&record);
        assert_eq!(status, CW_OK);
        assert!(events.iter().any(|event| {
            event.type_name == "item.revealed" && event.item_id == Some(STORY_BUTTON_ITEM_ID)
        }));
        assert_eq!(
            runtime
                .item_by_id(STORY_BUTTON_ITEM_ID)
                .map(|item| item.location_id),
            Some(COSY_COTTAGE_LOCATION_ID)
        );
        assert!(runtime.search_item_remembered(STORY_BUTTON_ITEM_ID));
    }

    #[test]
    fn ordinary_card_actions_bind_a_bounded_passive_perception_roll() {
        let mut runtime = RuntimeWorld::seeded();
        create_test_human(
            &mut runtime,
            5000,
            COSY_COTTAGE_LOCATION_ID,
            "Passing Observer",
        );
        let hidden = runtime.world.items[..runtime.world.item_count]
            .iter_mut()
            .find(|item| item.id == STORY_BUTTON_ITEM_ID)
            .expect("story button");
        hidden.location_id = 0;
        hidden.holder_actor_id = 0;
        hidden.charges = hidden.charges.max(1);
        runtime.beliefs.clear();

        let bound = (1..10_000).find_map(|seed| {
            let mut record = JournalRecord::new(
                CwAction {
                    kind: CW_ACTION_REST,
                    actor_id: 5000,
                    location_id: COSY_COTTAGE_LOCATION_ID,
                    ..CwAction::default()
                },
                seed,
            );
            runtime.bind_passive_item_perception(&mut record);
            record
                .projection_mutations
                .iter()
                .find_map(|mutation| match mutation {
                    ProjectionMutation::PassivePerceiveItem {
                        chance_percent,
                        roll,
                        ..
                    } => Some((*chance_percent, *roll)),
                    _ => None,
                })
        });
        let (chance, roll) = bound.expect("a deterministic passive notice succeeds");
        assert!(chance <= 75);
        assert!(roll < chance);
    }

    #[test]
    fn entity_spines_share_memory_goals_and_per_level_description_state() {
        let mut runtime = RuntimeWorld::seeded();
        runtime.refresh_entity_goal_ledger();
        let location = WorldEntityRef::location(COSY_COTTAGE_LOCATION_ID);
        let spine = runtime
            .world_entity_context_spine(location, "The room listens to a new arrival.")
            .expect("location spine");
        assert!(spine.is_current());
        assert_eq!(spine.subject, location);
        assert!(spine.self_description_due);
        assert!(!spine.goals.is_empty());
    }

    #[test]
    fn goal_ledger_has_the_three_requested_relationship_shapes() {
        let mut runtime = RuntimeWorld::seeded();
        runtime.refresh_entity_goal_ledger();
        assert!(runtime
            .goal_ledger
            .values()
            .any(|goal| goal.kind == EntityGoalKind::AvatarPossessesItem));
        assert!(runtime
            .goal_ledger
            .values()
            .any(|goal| goal.kind == EntityGoalKind::LocationPossessesItem));
        assert!(runtime
            .goal_ledger
            .values()
            .any(|goal| goal.kind == EntityGoalKind::ItemCollectsLocationHistory));
    }

    #[test]
    fn item_location_history_goal_completes_from_persistent_memory() {
        let mut runtime = RuntimeWorld::seeded();
        runtime.refresh_entity_goal_ledger();
        let goal = runtime
            .goal_ledger
            .values()
            .find(|goal| goal.kind == EntityGoalKind::ItemCollectsLocationHistory)
            .cloned()
            .expect("item history goal");
        assert_eq!(goal.status, EntityGoalStatus::Active);
        runtime
            .entity_memories
            .entry(WorldEntityRef::item(goal.item_id).key())
            .or_default()
            .visited_location_ids
            .extend([1, 2, 3]);
        runtime.refresh_entity_goal_ledger();
        assert_eq!(
            runtime.goal_ledger[&goal.id].status,
            EntityGoalStatus::Completed
        );
    }

    #[test]
    fn item_and_location_self_descriptions_do_not_become_avatar_memories() {
        let mut runtime = RuntimeWorld::seeded();
        let subject = WorldEntityRef::item(STORY_BUTTON_ITEM_ID);
        let content_id = 991_201;
        runtime.content.insert(
            content_id,
            "I am a rain-dark button, patient with careful fingers.".to_string(),
        );
        let event = runtime
            .append_entity_self_description_projection(&EntitySelfDescriptionProjection {
                subject,
                content_id,
                level: runtime.world_entity_level(subject).expect("item level"),
                source_actor_id: RATI_ACTOR_ID,
                source_location_id: COSY_COTTAGE_LOCATION_ID,
                caused_by_event_seq: None,
                source_world_tick: runtime.world.tick,
                observed_through_seq: runtime.world.next_event_seq.saturating_sub(1),
            })
            .expect("self-description event");
        runtime.record_world_entity_memories(&[event]);

        assert!(!runtime.world_entity_self_description_due(subject));
        assert!(runtime
            .latest_world_entity_description(subject)
            .is_some_and(|text| text.contains("rain-dark button")));
        assert!(!runtime
            .entity_memories
            .get(&WorldEntityRef::avatar(RATI_ACTOR_ID).key())
            .into_iter()
            .flat_map(|state| &state.memories)
            .any(|memory| memory.kind == "item.self_description"));
    }
}
