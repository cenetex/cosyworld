use super::*;

pub(super) const ITEM_IDENTITY_SCHEMA_VERSION: u8 = 1;

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub(super) struct ItemIdentityRevealState {
    pub(super) schema_version: u8,
    pub(super) item_id: u64,
    pub(super) table_id: String,
    pub(super) table_version: u8,
    pub(super) replay_version: String,
    pub(super) pack_id: String,
    pub(super) pack_version: String,
    pub(super) roll_seed: u64,
    pub(super) roll_input: String,
    pub(super) revealed_by_actor_id: u64,
    pub(super) revealed_at_location_id: u64,
    #[serde(default)]
    pub(super) unresolved_name: String,
    #[serde(default)]
    pub(super) revealed_event_seq: u64,
    pub(super) template: LootItemTemplateDefinition,
}

impl RuntimeWorld {
    pub(super) fn unresolved_item_identity_table(&self, item_id: u64) -> Option<&'static str> {
        if self.item_identity_reveals.contains_key(&item_id) {
            return None;
        }
        active_content()
            .items
            .iter()
            .find(|item| item.id == item_id)
            .and_then(|item| item.identity_table_id.as_deref())
    }

    pub(super) fn prepare_item_identity_reveal(
        &self,
        actor_id: u64,
        item_id: u64,
        location_id: u64,
    ) -> Result<ItemIdentityRevealState, String> {
        let actor = self
            .actor_by_id(actor_id)
            .filter(|actor| Self::actor_can_act(*actor))
            .ok_or_else(|| "The actor cannot reveal this marker now.".to_string())?;
        if actor.location_id != location_id {
            return Err("The marker is no longer here.".to_string());
        }
        let item = self
            .item_by_id(item_id)
            .filter(|item| {
                item.holder_actor_id == actor_id
                    && matches!(item.zone, CW_CARD_ZONE_CARRIED | CW_CARD_ZONE_EQUIPPED)
            })
            .ok_or_else(|| "Carry the unresolved marker before revealing it.".to_string())?;
        let table_id = self
            .unresolved_item_identity_table(item_id)
            .ok_or_else(|| "This item has no unresolved identity.".to_string())?;
        let selection = resolve_loot_identity(table_id, item_id)
            .ok_or_else(|| "The marker's identity table cannot resolve one item.".to_string())?;
        let kind = seed_item_kind_from_str(&selection.template.kind)
            .ok_or_else(|| "The marker resolved to an invalid item kind.".to_string())?;
        let role = loot_item_role(&selection.template.role)
            .ok_or_else(|| "The marker resolved to an invalid item role.".to_string())?;
        let size_class = item_size_from_str(&selection.template.size)
            .ok_or_else(|| "The marker resolved to an invalid item size.".to_string())?;
        let mut resolved = item;
        resolved.kind = kind;
        resolved.charges = selection.template.charges;
        resolved.weight_tenths = selection.template.weight_tenths.max(1);
        resolved.size_class = size_class;
        resolved.role = role;
        resolved.container_capacity_tenths = selection.template.container_capacity_tenths;
        if !self.actor_can_accept_identity_reveal(actor, item, resolved) {
            return Err("The revealed item would make this pack too heavy.".to_string());
        }
        Ok(ItemIdentityRevealState {
            schema_version: ITEM_IDENTITY_SCHEMA_VERSION,
            item_id,
            table_id: selection.table_id,
            table_version: selection.table_version,
            replay_version: selection.replay_version,
            pack_id: selection.pack_id,
            pack_version: selection.pack_version,
            roll_seed: selection.roll_seed,
            roll_input: selection.roll_input,
            revealed_by_actor_id: actor_id,
            revealed_at_location_id: location_id,
            unresolved_name: self
                .item_name(item_id)
                .unwrap_or_else(|| format!("Item {item_id}")),
            revealed_event_seq: 0,
            template: selection.template,
        })
    }

    fn actor_can_accept_identity_reveal(
        &self,
        actor: CwActor,
        unresolved: CwItem,
        resolved: CwItem,
    ) -> bool {
        let mut weight = 0u32;
        let mut capacity = actor_base_carrying_capacity_tenths(actor);
        for held in self.actor_held_items(actor.id) {
            let item = if held.id == unresolved.id {
                resolved
            } else {
                held
            };
            weight = weight.saturating_add(u32::from(effective_item_weight_tenths(item)));
            if item.role == CW_ITEM_ROLE_CONTAINER
                && item.zone == CW_CARD_ZONE_EQUIPPED
                && item.container_item_id == 0
            {
                capacity = capacity.saturating_add(u32::from(item.container_capacity_tenths));
            }
        }
        weight <= capacity
    }

    pub(super) fn apply_item_identity_reveal(
        &mut self,
        action_actor_id: u64,
        reveal: &ItemIdentityRevealState,
    ) -> Option<EventView> {
        if reveal.schema_version != ITEM_IDENTITY_SCHEMA_VERSION
            || reveal.revealed_by_actor_id != action_actor_id
            || reveal.item_id == 0
            || self.item_identity_reveals.contains_key(&reveal.item_id)
        {
            return None;
        }
        let actor = self.actor_by_id(action_actor_id)?;
        if !Self::actor_can_act(actor) || actor.location_id != reveal.revealed_at_location_id {
            return None;
        }
        let item = self.item_by_id(reveal.item_id)?;
        if item.holder_actor_id != action_actor_id
            || !matches!(item.zone, CW_CARD_ZONE_CARRIED | CW_CARD_ZONE_EQUIPPED)
        {
            return None;
        }
        let kind = seed_item_kind_from_str(&reveal.template.kind)?;
        let role = loot_item_role(&reveal.template.role)?;
        let size_class = item_size_from_str(&reveal.template.size)?;
        let mut resolved = item;
        resolved.kind = kind;
        resolved.charges = reveal.template.charges;
        resolved.weight_tenths = reveal.template.weight_tenths.max(1);
        resolved.size_class = size_class;
        resolved.role = role;
        resolved.container_capacity_tenths = reveal.template.container_capacity_tenths;
        resolved.reserved = 0;
        if !self.actor_can_accept_identity_reveal(actor, item, resolved) {
            return None;
        }

        let (max_charges, recovery, ready_zone) = declared_item_recovery_profile(
            reveal.template.charges,
            reveal.template.mechanics.as_ref(),
        );
        resolved.max_charges = max_charges;
        resolved.recovery = recovery;
        resolved.recovery_zone = ready_zone;
        resolved.policy_flags = declared_item_policy_flags(reveal.template.mechanics.as_ref());
        let world_item = self.world.items[..self.world.item_count]
            .iter_mut()
            .find(|candidate| candidate.id == reveal.item_id)?;
        *world_item = resolved;
        self.items.insert(
            reveal.item_id,
            ItemMeta {
                name: reveal.template.name.clone(),
                description: reveal.template.description.clone(),
                skill_id: None,
                skill_bonus: 0,
                mechanics: reveal.template.mechanics.clone(),
            },
        );

        let summary = format!(
            "{} settled into {}. Its identity is now permanent.",
            reveal.unresolved_name, reveal.template.name
        );
        let mut event = self.append_async_job_event(
            "item.identity_revealed",
            action_actor_id,
            None,
            Some(summary),
        );
        event.location_id = Some(reveal.revealed_at_location_id);
        event.location_name = self.location_name(reveal.revealed_at_location_id);
        event.item_id = Some(reveal.item_id);
        event.item_name = Some(reveal.template.name.clone());
        self.replace_projected_event(&event);
        let mut frozen = reveal.clone();
        frozen.revealed_event_seq = event.seq;
        self.item_identity_reveals.insert(reveal.item_id, frozen);
        Some(event)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const FIRST_VOID_MARKER_ID: u64 = 6_520_000;

    #[test]
    fn void_marker_reveal_is_permanent_and_survives_snapshot_restore() {
        if !active_content()
            .manifest
            .packs
            .iter()
            .any(|pack| pack.id == "cosyworld.elysium")
        {
            return;
        }

        let actor_id = active_content()
            .actors
            .iter()
            .find(|actor| actor.location_id == Some(652_000))
            .expect("first Void actor")
            .id;
        let mut runtime = RuntimeWorld::seeded();
        let pickup = JournalRecord::new(
            CwAction {
                kind: CW_ACTION_PICK_UP_ITEM,
                actor_id,
                item_id: FIRST_VOID_MARKER_ID,
                ..CwAction::default()
            },
            41,
        );
        assert_eq!(runtime.apply_journal_record(&pickup).0, CW_OK);
        let canonical_ref = runtime
            .canonical_ref("item", FIRST_VOID_MARKER_ID)
            .expect("marker canonical identity")
            .to_string();
        runtime.entity_memories.insert(
            canonical_ref.clone(),
            WorldEntityMemoryState {
                use_count: 7,
                ..WorldEntityMemoryState::default()
            },
        );

        let candidate = runtime
            .default_player_feature_use_candidate(actor_id)
            .expect("held marker reveal candidate");
        assert!(candidate.reveals_item_identity);
        let reveal = runtime
            .prepare_item_identity_reveal(actor_id, FIRST_VOID_MARKER_ID, candidate.location_id)
            .expect("valid identity reveal");
        let frozen_template = reveal.template.clone();
        let mut record = JournalRecord::new(
            CwAction {
                kind: CW_ACTION_NONE,
                actor_id,
                ..CwAction::default()
            },
            42,
        );
        record.projection_mutations = runtime
            .feature_use_projection_mutations(&candidate, "test")
            .expect("reveal mutations");
        let (status, events) = runtime.apply_journal_record(&record);
        assert_eq!(status, CW_OK);
        assert!(events
            .iter()
            .any(|event| event.type_name == "item.identity_revealed"));
        assert_eq!(
            runtime.item_name(FIRST_VOID_MARKER_ID).as_deref(),
            Some(frozen_template.name.as_str())
        );
        assert!(runtime
            .default_player_feature_use_candidate(actor_id)
            .is_none());
        assert_eq!(
            runtime.canonical_ref("item", FIRST_VOID_MARKER_ID),
            Some(canonical_ref.as_str())
        );
        assert!(runtime
            .entity_memories
            .get(&canonical_ref)
            .is_some_and(|memory| memory.use_count >= 7));

        let restored = RuntimeSnapshot::from_runtime(&runtime)
            .into_runtime()
            .expect("snapshot restores");
        assert_eq!(
            restored.item_name(FIRST_VOID_MARKER_ID).as_deref(),
            Some(frozen_template.name.as_str())
        );
        assert_eq!(
            restored
                .item_identity_reveals
                .get(&FIRST_VOID_MARKER_ID)
                .map(|state| &state.template),
            Some(&frozen_template)
        );
        assert_eq!(
            restored.canonical_ref("item", FIRST_VOID_MARKER_ID),
            Some(canonical_ref.as_str())
        );
        assert!(restored
            .entity_memories
            .get(&canonical_ref)
            .is_some_and(|memory| memory.use_count >= 7));
    }
}
