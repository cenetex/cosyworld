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
}
