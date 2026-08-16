use super::super::*;

#[derive(Clone, Debug, Deserialize, Serialize)]
pub(crate) struct BeliefState {
    pub(crate) id: String,
    pub(crate) holder_actor_id: u64,
    pub(crate) kind: String,
    pub(crate) subject_id: u64,
    pub(crate) location_id: u64,
    pub(crate) confidence: u8,
    pub(crate) salience: u8,
    pub(crate) observed_tick: u64,
    #[serde(default)]
    pub(crate) source_actor_id: Option<u64>,
    #[serde(default)]
    pub(crate) related_actor_id: Option<u64>,
    #[serde(default)]
    pub(crate) learned_tick: u64,
    #[serde(default)]
    pub(crate) hops: u8,
}

// Snapshot-only adapters for the two stores that preceded the unified belief
// model. They never enter RuntimeWorld and are removed when a snapshot is
// migrated.
#[derive(Clone, Debug, Deserialize, Serialize)]
pub(crate) struct LegacyResidentMemoryState {
    pub(crate) id: String,
    pub(crate) carrier_actor_id: u64,
    pub(crate) kind: String,
    pub(crate) subject_id: u64,
    pub(crate) location_id: u64,
    pub(crate) confidence: u8,
    pub(crate) salience: u8,
    pub(crate) observed_tick: u64,
    #[serde(default)]
    pub(crate) source_actor_id: Option<u64>,
    #[serde(default)]
    pub(crate) holder_actor_id: Option<u64>,
    #[serde(default)]
    pub(crate) learned_tick: u64,
    #[serde(default)]
    pub(crate) hops: u8,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
pub(crate) struct LegacySearchMemoryState {
    pub(crate) id: String,
    pub(crate) actor_id: u64,
    pub(crate) kind: String,
    pub(crate) location_id: u64,
    pub(crate) subject_id: u64,
    pub(crate) subject_key: String,
    pub(crate) confidence: u8,
    pub(crate) salience: u8,
    pub(crate) found_tick: u64,
    #[serde(default)]
    pub(crate) last_used_tick: u64,
    #[serde(default)]
    pub(crate) use_count: u32,
}

pub(crate) fn belief_id(
    holder_actor_id: u64,
    kind: &str,
    subject_id: u64,
    location_id: u64,
    related_actor_id: Option<u64>,
) -> String {
    match kind {
        BELIEF_KIND_SEED_EXIT | BELIEF_KIND_HIDDEN_EXIT => {
            format!("belief:{holder_actor_id}:{kind}:{location_id}:{subject_id}")
        }
        BELIEF_KIND_ACTOR_WANTS_ITEM => format!(
            "belief:{holder_actor_id}:{kind}:{}:{subject_id}",
            related_actor_id.unwrap_or_default()
        ),
        _ => format!("belief:{holder_actor_id}:{kind}:{subject_id}"),
    }
}

fn belief_is_preferred(candidate: &BeliefState, existing: &BeliefState) -> bool {
    candidate.observed_tick > existing.observed_tick
        || (candidate.observed_tick == existing.observed_tick
            && (candidate.confidence > existing.confidence
                || (candidate.confidence == existing.confidence
                    && candidate.learned_tick >= existing.learned_tick)))
}

pub(crate) fn merge_belief(beliefs: &mut BTreeMap<String, BeliefState>, mut belief: BeliefState) {
    belief.id = belief_id(
        belief.holder_actor_id,
        &belief.kind,
        belief.subject_id,
        belief.location_id,
        belief.related_actor_id,
    );
    match beliefs.get_mut(&belief.id) {
        Some(existing) if belief_is_preferred(&belief, existing) => *existing = belief,
        Some(existing) => existing.salience = existing.salience.max(belief.salience),
        None => {
            beliefs.insert(belief.id.clone(), belief);
        }
    }
}

fn belief_decay_at_tick(belief: &BeliefState, now: u64) -> (u64, u8, u8) {
    let baseline = belief.learned_tick.max(belief.observed_tick);
    let steps = if baseline == 0 {
        0
    } else {
        now.saturating_sub(baseline) / BELIEF_TUNING.decay_interval_ticks
    };
    let confidence_loss = steps
        .saturating_mul(BELIEF_TUNING.confidence_decay as u64)
        .min(u8::MAX as u64) as u8;
    let salience_loss = steps
        .saturating_mul(BELIEF_TUNING.salience_decay as u64)
        .min(u8::MAX as u64) as u8;
    (
        steps,
        belief.confidence.saturating_sub(confidence_loss),
        belief.salience.saturating_sub(salience_loss),
    )
}

pub(crate) fn migrate_legacy_beliefs(
    mut beliefs: BTreeMap<String, BeliefState>,
    resident_memories: BTreeMap<String, LegacyResidentMemoryState>,
    search_memories: BTreeMap<String, LegacySearchMemoryState>,
) -> BTreeMap<String, BeliefState> {
    for legacy in resident_memories.into_values() {
        merge_belief(
            &mut beliefs,
            BeliefState {
                id: String::new(),
                holder_actor_id: legacy.carrier_actor_id,
                kind: legacy.kind,
                subject_id: legacy.subject_id,
                location_id: legacy.location_id,
                confidence: legacy.confidence,
                salience: legacy.salience,
                observed_tick: legacy.observed_tick,
                source_actor_id: legacy.source_actor_id,
                related_actor_id: legacy.holder_actor_id,
                learned_tick: legacy.learned_tick,
                hops: legacy.hops,
            },
        );
    }
    for legacy in search_memories.into_values() {
        let kind = match legacy.kind.as_str() {
            "avatar" => BELIEF_KIND_ACTOR_LOCATION,
            "item" => BELIEF_KIND_ITEM_LOCATION,
            _ => legacy.kind.as_str(),
        };
        merge_belief(
            &mut beliefs,
            BeliefState {
                id: String::new(),
                holder_actor_id: legacy.actor_id,
                kind: kind.to_string(),
                subject_id: legacy.subject_id,
                location_id: legacy.location_id,
                confidence: legacy.confidence,
                salience: legacy.salience,
                observed_tick: legacy.found_tick,
                source_actor_id: Some(legacy.actor_id),
                related_actor_id: None,
                learned_tick: legacy.last_used_tick.max(legacy.found_tick),
                hops: 0,
            },
        );
    }
    beliefs
}

impl RuntimeWorld {
    pub(crate) fn belief_active(&self, belief: &BeliefState) -> bool {
        self.actor_by_id(belief.holder_actor_id)
            .is_some_and(Self::actor_is_present)
            && self
                .belief_effective_values(belief)
                .is_some_and(|(confidence, salience)| {
                    confidence >= BELIEF_TUNING.minimum_action_confidence && salience > 0
                })
    }

    fn belief_effective_values(&self, belief: &BeliefState) -> Option<(u8, u8)> {
        let (_, confidence, salience) = belief_decay_at_tick(belief, self.world.tick);
        (confidence > 0 && salience > 0).then_some((confidence, salience))
    }

    pub(crate) fn avatar_discovered(&self, actor_id: u64) -> bool {
        self.beliefs.values().any(|belief| {
            belief.kind == BELIEF_KIND_ACTOR_LOCATION
                && belief.subject_id == actor_id
                && self.belief_active(belief)
        })
    }

    pub(crate) fn search_item_remembered(&self, item_id: u64) -> bool {
        self.beliefs.values().any(|belief| {
            belief.kind == BELIEF_KIND_ITEM_LOCATION
                && belief.subject_id == item_id
                && self.belief_active(belief)
        })
    }

    fn search_item_found(&self, item_id: u64) -> bool {
        self.tags
            .get(&search_item_found_tag_id(item_id))
            .map(|tag| tag.active)
            .unwrap_or(false)
    }

    pub(crate) fn forgotten_search_item_at_location(&self, item: CwItem, location_id: u64) -> bool {
        item.holder_actor_id == 0
            && item.location_id == location_id
            && self.search_item_found(item.id)
            && !self.search_item_remembered(item.id)
    }

    pub(crate) fn search_witness_actor_ids(&self, location_id: u64) -> Vec<u64> {
        let mut actor_ids = self.world.actors[..self.world.actor_count]
            .iter()
            .copied()
            .filter(|actor| actor.location_id == location_id && Self::actor_is_present(*actor))
            .map(|actor| actor.id)
            .collect::<Vec<_>>();
        actor_ids.sort_unstable();
        actor_ids.dedup();
        actor_ids
    }

    pub(crate) fn remember_search_discovery_for_witnesses(
        &mut self,
        location_id: u64,
        kind: &str,
        subject_id: u64,
        subject_key: String,
    ) {
        let actor_ids = self.search_witness_actor_ids(location_id);
        self.remember_search_discovery_for_actor_ids(
            &actor_ids,
            location_id,
            kind,
            subject_id,
            &subject_key,
        );
    }

    pub(crate) fn remember_search_discovery_for_actor_ids(
        &mut self,
        actor_ids: &[u64],
        location_id: u64,
        kind: &str,
        subject_id: u64,
        subject_key: &str,
    ) {
        for actor_id in actor_ids.iter().copied() {
            self.remember_search_discovery(actor_id, location_id, kind, subject_id, &subject_key);
        }
    }

    pub(crate) fn remember_search_discovery(
        &mut self,
        actor_id: u64,
        location_id: u64,
        kind: &str,
        subject_id: u64,
        _subject_key: &str,
    ) {
        self.remember_belief(
            actor_id,
            kind,
            subject_id,
            location_id,
            BELIEF_TUNING.firsthand_confidence,
            BELIEF_TUNING.firsthand_salience,
            Some(actor_id),
        );
    }

    pub(crate) fn reinforce_beliefs_from_search_events(&mut self, events: &[EventView]) {
        for event in events.iter().filter(|event| event.success) {
            match event.type_name.as_str() {
                "actor.moved" => {
                    let (Some(actor_id), Some(from_location_id), Some(to_location_id)) = (
                        event.actor_id,
                        event.location_id,
                        event.destination_location_id,
                    ) else {
                        continue;
                    };
                    if self
                        .seed_exit_by_locations(from_location_id, to_location_id)
                        .is_some()
                    {
                        self.remember_search_discovery(
                            actor_id,
                            from_location_id,
                            BELIEF_KIND_SEED_EXIT,
                            to_location_id,
                            &seed_exit_belief_subject_key(from_location_id, to_location_id),
                        );
                        if self
                            .seed_exit_by_locations(to_location_id, from_location_id)
                            .is_some()
                        {
                            self.remember_search_discovery(
                                actor_id,
                                to_location_id,
                                BELIEF_KIND_SEED_EXIT,
                                from_location_id,
                                &seed_exit_belief_subject_key(to_location_id, from_location_id),
                            );
                        }
                    }
                    if let Some(hidden_exit) =
                        self.hidden_exit_between(from_location_id, to_location_id)
                    {
                        self.remember_search_discovery(
                            actor_id,
                            hidden_exit.from_location_id,
                            BELIEF_KIND_HIDDEN_EXIT,
                            hidden_exit.to_location_id,
                            &hidden_exit.id,
                        );
                    }
                }
                "item.found" | "item.revealed" | "item.picked_up" | "item.dropped"
                | "item.used" | "item.given" | "item.traded" => {
                    let Some(item_id) = event.item_id else {
                        continue;
                    };
                    if !self.search_item_found(item_id)
                        && !matches!(event.type_name.as_str(), "item.found" | "item.revealed")
                    {
                        continue;
                    }
                    let location_id = event
                        .location_id
                        .or_else(|| {
                            event
                                .actor_id
                                .and_then(|actor_id| self.actor_by_id(actor_id))
                                .map(|actor| actor.location_id)
                        })
                        .unwrap_or(0);
                    if location_id == 0 {
                        continue;
                    }
                    self.remember_search_discovery_for_witnesses(
                        location_id,
                        BELIEF_KIND_ITEM_LOCATION,
                        item_id,
                        item_id.to_string(),
                    );
                }
                _ => {}
            }
        }
    }

    fn return_forgotten_search_items_to_pool(&mut self) {
        let forgotten_item_ids = self.world.items[..self.world.item_count]
            .iter()
            .copied()
            .filter(|item| {
                item.holder_actor_id == 0
                    && item.location_id != 0
                    && self.search_item_found(item.id)
                    && !self.search_item_remembered(item.id)
            })
            .map(|item| item.id)
            .collect::<BTreeSet<_>>();
        if forgotten_item_ids.is_empty() {
            return;
        }
        for item in &mut self.world.items[..self.world.item_count] {
            if forgotten_item_ids.contains(&item.id) {
                item.location_id = 0;
                item.holder_actor_id = 0;
                item.held_since_tick = 0;
            }
        }
    }

    pub(crate) fn belief_seek_target(&self, resident: CwActor) -> Option<BeliefState> {
        let sought_item_ids: BTreeSet<u64> = self
            .resident_sought_item_ids(resident)
            .into_iter()
            .collect();
        if sought_item_ids.is_empty() {
            return None;
        }

        let mut memories: Vec<_> = self
            .beliefs
            .values()
            .filter(|memory| {
                memory.holder_actor_id == resident.id
                    && memory.kind == BELIEF_KIND_ITEM_LOCATION
                    && memory.confidence >= BELIEF_TUNING.minimum_action_confidence
                    && sought_item_ids.contains(&memory.subject_id)
            })
            .cloned()
            .map(|memory| self.resident_item_memory_resolved_by_actor_memory(memory))
            .collect();
        memories.sort_by_key(|memory| {
            let preference = self
                .resident_sought_item_ids(resident)
                .iter()
                .position(|item_id| *item_id == memory.subject_id)
                .unwrap_or(usize::MAX);
            (
                preference,
                std::cmp::Reverse(memory.salience),
                std::cmp::Reverse(memory.confidence),
                std::cmp::Reverse(memory.observed_tick),
                memory.location_id,
                memory.subject_id,
            )
        });
        memories.into_iter().next()
    }

    fn resident_item_memory_resolved_by_actor_memory(&self, memory: BeliefState) -> BeliefState {
        if memory.kind != BELIEF_KIND_ITEM_LOCATION {
            return memory;
        }
        let Some(holder_actor_id) = memory.related_actor_id else {
            return memory;
        };
        let actor_memory_id = Self::belief_id(
            memory.holder_actor_id,
            BELIEF_KIND_ACTOR_LOCATION,
            holder_actor_id,
        );
        let Some(actor_memory) = self.beliefs.get(&actor_memory_id) else {
            return memory;
        };
        if actor_memory.confidence < BELIEF_TUNING.minimum_action_confidence
            || actor_memory.observed_tick < memory.observed_tick
        {
            return memory;
        }

        let mut resolved = memory;
        resolved.location_id = actor_memory.location_id;
        resolved.confidence = resolved.confidence.min(actor_memory.confidence);
        resolved.salience = resolved.salience.min(actor_memory.salience);
        resolved.observed_tick = actor_memory.observed_tick;
        resolved.learned_tick = resolved.learned_tick.max(actor_memory.learned_tick);
        resolved.hops = resolved.hops.max(actor_memory.hops);
        resolved
    }

    pub(crate) fn resident_best_item_memory(
        &self,
        holder_actor_id: u64,
        item_id: u64,
    ) -> Option<BeliefState> {
        let mut memories: Vec<_> = self
            .beliefs
            .values()
            .filter(|memory| {
                memory.holder_actor_id == holder_actor_id
                    && memory.kind == BELIEF_KIND_ITEM_LOCATION
                    && memory.subject_id == item_id
                    && memory.confidence >= BELIEF_TUNING.minimum_action_confidence
            })
            .cloned()
            .map(|memory| self.resident_item_memory_resolved_by_actor_memory(memory))
            .collect();
        memories.sort_by_key(|memory| {
            (
                std::cmp::Reverse(memory.salience),
                std::cmp::Reverse(memory.confidence),
                std::cmp::Reverse(memory.observed_tick),
                memory.location_id,
            )
        });
        memories.into_iter().next()
    }

    pub(crate) fn resident_has_fresh_loose_item_observation(
        &self,
        holder_actor_id: u64,
        item_id: u64,
        location_id: u64,
    ) -> bool {
        let memory_id = Self::belief_id(holder_actor_id, BELIEF_KIND_ITEM_LOCATION, item_id);
        self.beliefs.get(&memory_id).is_some_and(|memory| {
            memory.location_id == location_id
                && memory.related_actor_id.is_none()
                && memory.confidence >= BELIEF_TUNING.minimum_action_confidence
                && memory.observed_tick == self.world.tick
                && memory.source_actor_id == Some(holder_actor_id)
        })
    }

    pub(crate) fn resident_actor_location_memory(
        &self,
        holder_actor_id: u64,
        subject_actor_id: u64,
    ) -> Option<BeliefState> {
        let memory_id = Self::belief_id(
            holder_actor_id,
            BELIEF_KIND_ACTOR_LOCATION,
            subject_actor_id,
        );
        self.beliefs
            .get(&memory_id)
            .filter(|memory| memory.confidence >= BELIEF_TUNING.minimum_action_confidence)
            .cloned()
    }

    pub(crate) fn resident_remembers_actor_at(
        &self,
        holder_actor_id: u64,
        subject_actor_id: u64,
        location_id: u64,
    ) -> bool {
        self.resident_actor_location_memory(holder_actor_id, subject_actor_id)
            .is_some_and(|memory| memory.location_id == location_id)
    }

    pub(crate) fn resident_actor_wants_item_memory(
        &self,
        holder_actor_id: u64,
        target_actor_id: u64,
        item_id: u64,
    ) -> Option<BeliefState> {
        let memory_id = Self::belief_key(
            holder_actor_id,
            BELIEF_KIND_ACTOR_WANTS_ITEM,
            item_id,
            0,
            Some(target_actor_id),
        );
        self.beliefs
            .get(&memory_id)
            .filter(|memory| memory.confidence >= BELIEF_TUNING.minimum_action_confidence)
            .cloned()
    }

    pub(crate) fn resident_remembers_actor_holding_item_at(
        &self,
        holder_actor_id: u64,
        related_actor_id: u64,
        item_id: u64,
        location_id: u64,
    ) -> bool {
        self.resident_remembers_actor_at(holder_actor_id, related_actor_id, location_id)
            && self
                .resident_best_item_memory(holder_actor_id, item_id)
                .is_some_and(|memory| {
                    memory.related_actor_id == Some(related_actor_id)
                        && memory.location_id == location_id
                })
    }

    #[cfg(test)]
    pub(crate) fn resident_remembers_actor_wants_item(
        &self,
        holder_actor_id: u64,
        target_actor_id: u64,
        item_id: u64,
    ) -> bool {
        self.resident_actor_wants_item_memory(holder_actor_id, target_actor_id, item_id)
            .is_some()
    }

    pub(crate) fn belief_prompt_notes(&self, resident_id: u64) -> Vec<String> {
        let mut memories: Vec<_> = self
            .beliefs
            .values()
            .filter(|memory| {
                memory.holder_actor_id == resident_id
                    && memory.confidence >= BELIEF_TUNING.minimum_action_confidence
            })
            .cloned()
            .collect();
        memories.sort_by_key(|memory| {
            (
                std::cmp::Reverse(memory.salience),
                std::cmp::Reverse(memory.confidence),
                std::cmp::Reverse(memory.observed_tick),
                memory.hops,
                memory.kind.clone(),
                memory.subject_id,
            )
        });

        let mut notes = Vec::new();
        let mut seen = BTreeSet::new();
        for memory in memories {
            let route = if memory.source_actor_id == Some(resident_id) && memory.hops == 0 {
                "saw"
            } else {
                "heard"
            };
            let location_name = self
                .location_name(memory.location_id)
                .unwrap_or_else(|| format!("Location {}", memory.location_id));
            let note = match memory.kind.as_str() {
                BELIEF_KIND_ACTOR_LOCATION => {
                    if memory.subject_id == resident_id {
                        continue;
                    }
                    let actor_name = self
                        .actor_name(memory.subject_id)
                        .unwrap_or_else(|| format!("Resident {}", memory.subject_id));
                    format!("{route} {actor_name} near {location_name}")
                }
                BELIEF_KIND_ITEM_LOCATION => {
                    let item_name = self
                        .item_name(memory.subject_id)
                        .unwrap_or_else(|| format!("Item {}", memory.subject_id));
                    if let Some(holder_name) = memory
                        .related_actor_id
                        .and_then(|holder_actor_id| self.actor_name(holder_actor_id))
                    {
                        format!("{route} {item_name} with {holder_name} near {location_name}")
                    } else {
                        format!("{route} {item_name} near {location_name}")
                    }
                }
                BELIEF_KIND_ACTOR_WANTS_ITEM => {
                    let Some(target_actor_id) = memory.related_actor_id else {
                        continue;
                    };
                    let target_name = self
                        .actor_name(target_actor_id)
                        .unwrap_or_else(|| format!("Resident {target_actor_id}"));
                    let item_name = self
                        .item_name(memory.subject_id)
                        .unwrap_or_else(|| format!("Item {}", memory.subject_id));
                    format!("{route} {target_name} wanted {item_name} near {location_name}")
                }
                _ => continue,
            };
            if seen.insert(note.clone()) {
                notes.push(note);
            }
            if notes.len() >= 4 {
                break;
            }
        }
        notes
    }

    pub(crate) fn belief_id(holder_actor_id: u64, kind: &str, subject_id: u64) -> String {
        belief_id(holder_actor_id, kind, subject_id, 0, None)
    }

    pub(crate) fn belief_key(
        holder_actor_id: u64,
        kind: &str,
        subject_id: u64,
        location_id: u64,
        related_actor_id: Option<u64>,
    ) -> String {
        belief_id(
            holder_actor_id,
            kind,
            subject_id,
            location_id,
            related_actor_id,
        )
    }

    pub(crate) fn remember_belief(
        &mut self,
        holder_actor_id: u64,
        kind: &str,
        subject_id: u64,
        location_id: u64,
        confidence: u8,
        salience: u8,
        source_actor_id: Option<u64>,
    ) {
        self.remember_belief_with_provenance(
            holder_actor_id,
            kind,
            subject_id,
            location_id,
            confidence,
            salience,
            source_actor_id,
            None,
            self.world.tick,
            self.world.tick,
            0,
        );
    }

    pub(crate) fn remember_belief_with_related_actor(
        &mut self,
        holder_actor_id: u64,
        kind: &str,
        subject_id: u64,
        location_id: u64,
        confidence: u8,
        salience: u8,
        source_actor_id: Option<u64>,
        related_actor_id: Option<u64>,
    ) {
        self.remember_belief_with_provenance(
            holder_actor_id,
            kind,
            subject_id,
            location_id,
            confidence,
            salience,
            source_actor_id,
            related_actor_id,
            self.world.tick,
            self.world.tick,
            0,
        );
    }

    pub(crate) fn remember_resident_wants_item_memory(
        &mut self,
        holder_actor_id: u64,
        wanting_actor_id: u64,
        item_id: u64,
        location_id: u64,
        confidence: u8,
        salience: u8,
        source_actor_id: Option<u64>,
    ) {
        if wanting_actor_id == 0 || item_id == 0 {
            return;
        }
        self.remember_belief_with_related_actor(
            holder_actor_id,
            BELIEF_KIND_ACTOR_WANTS_ITEM,
            item_id,
            location_id,
            confidence,
            salience,
            source_actor_id,
            Some(wanting_actor_id),
        );
    }

    pub(crate) fn remember_belief_with_provenance(
        &mut self,
        holder_actor_id: u64,
        kind: &str,
        subject_id: u64,
        location_id: u64,
        confidence: u8,
        salience: u8,
        source_actor_id: Option<u64>,
        related_actor_id: Option<u64>,
        observed_tick: u64,
        learned_tick: u64,
        hops: u8,
    ) {
        let Some(holder) = self.actor_by_id(holder_actor_id) else {
            return;
        };
        if !Self::actor_is_present(holder) || location_id == 0 {
            return;
        }

        let related_actor_id = (kind == BELIEF_KIND_ITEM_LOCATION
            || kind == BELIEF_KIND_ACTOR_WANTS_ITEM)
            .then_some(related_actor_id)
            .flatten()
            .filter(|related_id| *related_id != 0);
        let belief = BeliefState {
            id: Self::belief_key(
                holder_actor_id,
                kind,
                subject_id,
                location_id,
                related_actor_id,
            ),
            holder_actor_id,
            kind: kind.to_string(),
            subject_id,
            location_id,
            confidence,
            salience,
            observed_tick,
            source_actor_id,
            related_actor_id,
            learned_tick,
            hops,
        };
        merge_belief(&mut self.beliefs, belief);
        self.prune_beliefs(holder_actor_id);
    }

    fn prune_beliefs(&mut self, holder_actor_id: u64) {
        let mut owned: Vec<_> = self
            .beliefs
            .values()
            .filter(|memory| memory.holder_actor_id == holder_actor_id)
            .map(|memory| {
                (
                    memory.id.clone(),
                    memory.salience,
                    memory.confidence,
                    memory.observed_tick,
                )
            })
            .collect();
        if owned.len() <= BELIEF_TUNING.capacity {
            return;
        }
        owned.sort_by_key(|(_, salience, confidence, observed_tick)| {
            (*salience, *confidence, *observed_tick)
        });
        for (id, _, _, _) in owned
            .into_iter()
            .take(self.belief_overflow_count(holder_actor_id))
        {
            self.beliefs.remove(&id);
        }
    }

    fn belief_overflow_count(&self, holder_actor_id: u64) -> usize {
        self.beliefs
            .values()
            .filter(|memory| memory.holder_actor_id == holder_actor_id)
            .count()
            .saturating_sub(BELIEF_TUNING.capacity)
    }

    pub(crate) fn decay_beliefs(&mut self) {
        let now = self.world.tick;
        let mut expired = Vec::new();
        for memory in self.beliefs.values_mut() {
            let baseline = memory.learned_tick.max(memory.observed_tick);
            if baseline == 0 {
                memory.learned_tick = now;
                continue;
            }
            if now <= baseline {
                continue;
            }
            let (steps, confidence, salience) = belief_decay_at_tick(memory, now);
            if steps == 0 {
                continue;
            }
            memory.confidence = confidence;
            memory.salience = salience;
            memory.learned_tick = now;
            if memory.confidence == 0 || memory.salience == 0 {
                expired.push(memory.id.clone());
            }
        }
        let mut forgotten_local_leads = Vec::new();
        for memory_id in expired {
            if let Some(memory) = self.beliefs.get(&memory_id) {
                if memory.kind == LOCAL_LEAD_MEMORY_KIND {
                    forgotten_local_leads.push((memory.holder_actor_id, memory.subject_id));
                }
            }
            self.beliefs.remove(&memory_id);
        }
        for (actor_id, destination_location_id) in forgotten_local_leads {
            for lead in self.local_leads.values_mut().filter(|lead| {
                lead.actor_id == actor_id
                    && lead.destination_location_id == destination_location_id
                    && !lead.consumed
                    && !lead.settled
            }) {
                lead.forgotten = true;
            }
        }
        self.return_forgotten_search_items_to_pool();
    }

    #[cfg(test)]
    pub(crate) fn decay_search_memories(&mut self) {
        self.decay_beliefs();
    }

    pub(crate) fn refresh_beliefs_for_autonomy(&mut self) {
        self.decay_beliefs();
    }
}
