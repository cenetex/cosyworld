use super::*;

// --- moved from main.rs: projected world-event builder RuntimeWorld methods ---
impl crate::RuntimeWorld {
    pub(crate) fn append_world_reset_event(&mut self) -> EventView {
        let entry_location_id = content_registry().entry_location_id();
        let event = EventView {
            world_id: official_world_id(),
            world_epoch: official_world_epoch(),
            seq: self.world.next_event_seq,
            type_name: "world.reset".to_string(),
            success: true,
            reason: 0,
            actor_id: None,
            actor_name: None,
            target_actor_id: None,
            target_actor_name: None,
            location_id: entry_location_id,
            location_name: entry_location_id.and_then(|id| self.location_name(id)),
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
        };
        self.world.next_event_seq += 1;
        self.push_projected_event(event.clone());
        event
    }

    pub(crate) fn append_world_bootstrapped_event(&mut self) -> EventView {
        let entry_location_id = content_registry().entry_location_id();
        let event = EventView {
            world_id: official_world_id(),
            world_epoch: official_world_epoch(),
            seq: self.world.next_event_seq,
            type_name: "world.bootstrapped".to_string(),
            success: true,
            reason: 0,
            actor_id: None,
            actor_name: None,
            target_actor_id: None,
            target_actor_name: None,
            location_id: entry_location_id,
            location_name: entry_location_id.and_then(|id| self.location_name(id)),
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
        };
        self.world.next_event_seq += 1;
        self.push_projected_event(event.clone());
        event
    }

    pub(crate) fn append_actor_moved_event(
        &mut self,
        actor_id: u64,
        from_location_id: u64,
        to_location_id: u64,
    ) -> EventView {
        let event = EventView {
            world_id: official_world_id(),
            world_epoch: official_world_epoch(),
            seq: self.world.next_event_seq,
            type_name: "actor.moved".to_string(),
            success: true,
            reason: 0,
            actor_id: Some(actor_id),
            actor_name: self.actor_name(actor_id),
            target_actor_id: None,
            target_actor_name: None,
            location_id: Some(from_location_id),
            location_name: self.location_name(from_location_id),
            destination_location_id: Some(to_location_id),
            destination_location_name: self.location_name(to_location_id),
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
        };
        self.world.next_event_seq += 1;
        self.push_projected_event(event.clone());
        event
    }

    pub(crate) fn append_journey_event(
        &mut self,
        event_type: &str,
        actor_id: u64,
        narration: &str,
        destination_location_id: Option<u64>,
    ) -> EventView {
        let location_id = self
            .actor_by_id(actor_id)
            .map(|actor| actor.location_id)
            .unwrap_or(0);
        let event = EventView {
            world_id: official_world_id(),
            world_epoch: official_world_epoch(),
            seq: self.world.next_event_seq,
            type_name: event_type.to_string(),
            success: true,
            reason: 0,
            actor_id: Some(actor_id),
            actor_name: self.actor_name(actor_id),
            target_actor_id: None,
            target_actor_name: None,
            location_id: Some(location_id),
            location_name: self.location_name(location_id),
            destination_location_id,
            destination_location_name: destination_location_id
                .and_then(|id| self.location_name(id)),
            content_id: None,
            content: Some(narration.to_string()),
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
        };
        self.world.next_event_seq += 1;
        self.push_projected_event(event.clone());
        event
    }

    pub(crate) fn append_actor_presence_event(&mut self, actor_id: u64, active: bool) -> EventView {
        let location_id = self
            .actor_by_id(actor_id)
            .map(|actor| actor.location_id)
            .unwrap_or(1);
        let event = EventView {
            world_id: official_world_id(),
            world_epoch: official_world_epoch(),
            // Presence is regional fan-out, not canonical world history. Sequence
            // zero deliberately excludes it from durable cursors and resume.
            seq: 0,
            type_name: "actor.presence".to_string(),
            success: true,
            reason: if active { 1 } else { 0 },
            actor_id: Some(actor_id),
            actor_name: self.actor_name(actor_id),
            target_actor_id: None,
            target_actor_name: None,
            location_id: Some(location_id),
            location_name: self.location_name(location_id),
            destination_location_id: None,
            destination_location_name: None,
            content_id: None,
            content: Some(if active { "active" } else { "inactive" }.to_string()),
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
        };
        self.presence_states.insert(actor_id, active);
        event
    }

    pub(crate) fn append_async_job_event(
        &mut self,
        type_name: &str,
        actor_id: u64,
        target_actor_id: Option<u64>,
        content: Option<String>,
    ) -> EventView {
        let location_id = self
            .actor_by_id(actor_id)
            .map(|actor| actor.location_id)
            .or_else(|| content_registry().entry_location_id());
        let event = EventView {
            world_id: official_world_id(),
            world_epoch: official_world_epoch(),
            seq: self.world.next_event_seq,
            type_name: type_name.to_string(),
            success: !type_name.ends_with(".failed"),
            reason: 0,
            actor_id: Some(actor_id),
            actor_name: self.actor_name(actor_id),
            target_actor_id,
            target_actor_name: target_actor_id.and_then(|id| self.actor_name(id)),
            location_id,
            location_name: location_id.and_then(|id| self.location_name(id)),
            destination_location_id: None,
            destination_location_name: None,
            content_id: None,
            content,
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
        };
        self.world.next_event_seq += 1;
        self.push_projected_event(event.clone());
        event
    }

    pub(crate) fn append_feature_use_event(
        &mut self,
        actor_id: u64,
        location_id: u64,
        item_id: u64,
        content: &str,
        _reason: &str,
    ) -> EventView {
        let event = EventView {
            world_id: official_world_id(),
            world_epoch: official_world_epoch(),
            seq: self.world.next_event_seq,
            type_name: "item.used".to_string(),
            success: true,
            reason: 0,
            actor_id: Some(actor_id),
            actor_name: self.actor_name(actor_id),
            target_actor_id: None,
            target_actor_name: None,
            location_id: Some(location_id),
            location_name: self.location_name(location_id),
            destination_location_id: None,
            destination_location_name: None,
            content_id: None,
            content: Some(content.to_string()),
            item_id: Some(item_id),
            item_name: self.item_name(item_id),
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
        };
        self.world.next_event_seq += 1;
        self.push_projected_event(event.clone());
        event
    }

    pub(crate) fn append_feature_search_event(
        &mut self,
        actor_id: u64,
        location_id: u64,
        feature_name: &str,
        content: &str,
        reason: &str,
    ) -> EventView {
        let event = EventView {
            world_id: official_world_id(),
            world_epoch: official_world_epoch(),
            seq: self.world.next_event_seq,
            type_name: "feature.searched".to_string(),
            success: true,
            reason: 0,
            actor_id: Some(actor_id),
            actor_name: self.actor_name(actor_id),
            target_actor_id: None,
            target_actor_name: None,
            location_id: Some(location_id),
            location_name: self.location_name(location_id),
            destination_location_id: None,
            destination_location_name: None,
            content_id: None,
            content: Some(format!("{feature_name}:{content}:{reason}")),
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
        };
        self.world.next_event_seq += 1;
        self.push_projected_event(event.clone());
        event
    }

    pub(crate) fn append_location_search_event(
        &mut self,
        actor_id: u64,
        location_id: u64,
        content: &str,
        reason: &str,
    ) -> EventView {
        let event = EventView {
            world_id: official_world_id(),
            world_epoch: official_world_epoch(),
            seq: self.world.next_event_seq,
            type_name: "location.searched".to_string(),
            success: true,
            reason: 0,
            actor_id: Some(actor_id),
            actor_name: self.actor_name(actor_id),
            target_actor_id: None,
            target_actor_name: None,
            location_id: Some(location_id),
            location_name: self.location_name(location_id),
            destination_location_id: None,
            destination_location_name: None,
            content_id: None,
            content: Some(format!("location:{location_id}:{content}:{reason}")),
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
        };
        self.world.next_event_seq += 1;
        self.push_projected_event(event.clone());
        event
    }

    pub(crate) fn append_exit_discovered_event(
        &mut self,
        actor_id: u64,
        from_location_id: u64,
        to_location_id: u64,
        content: String,
    ) -> EventView {
        let event = EventView {
            world_id: official_world_id(),
            world_epoch: official_world_epoch(),
            seq: self.world.next_event_seq,
            type_name: "exit.discovered".to_string(),
            success: true,
            reason: 0,
            actor_id: Some(actor_id),
            actor_name: self.actor_name(actor_id),
            target_actor_id: None,
            target_actor_name: None,
            location_id: Some(from_location_id),
            location_name: self.location_name(from_location_id),
            destination_location_id: Some(to_location_id),
            destination_location_name: self.location_name(to_location_id),
            content_id: None,
            content: Some(content),
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
        };
        self.world.next_event_seq += 1;
        self.push_projected_event(event.clone());
        event
    }

    pub(crate) fn append_avatar_discovered_event(
        &mut self,
        actor_id: u64,
        target_actor_id: u64,
        location_id: u64,
        content: String,
    ) -> EventView {
        let event = EventView {
            world_id: official_world_id(),
            world_epoch: official_world_epoch(),
            seq: self.world.next_event_seq,
            type_name: "avatar.discovered".to_string(),
            success: true,
            reason: 0,
            actor_id: Some(actor_id),
            actor_name: self.actor_name(actor_id),
            target_actor_id: Some(target_actor_id),
            target_actor_name: self.actor_name(target_actor_id),
            location_id: Some(location_id),
            location_name: self.location_name(location_id),
            destination_location_id: None,
            destination_location_name: None,
            content_id: None,
            content: Some(content),
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
        };
        self.world.next_event_seq += 1;
        self.push_projected_event(event.clone());
        event
    }

    pub(crate) fn append_branch_lifecycle_event(
        &mut self,
        type_name: &str,
        branch: &DialogueBranch,
    ) -> EventView {
        let location_id = self
            .actor_by_id(branch.actor_id)
            .or_else(|| self.actor_by_id(branch.target_actor_id))
            .map(|actor| actor.location_id);
        let event = EventView {
            world_id: official_world_id(),
            world_epoch: official_world_epoch(),
            seq: self.world.next_event_seq,
            type_name: type_name.to_string(),
            success: true,
            reason: 0,
            actor_id: Some(branch.actor_id),
            actor_name: self.actor_name(branch.actor_id),
            target_actor_id: Some(branch.target_actor_id),
            target_actor_name: self.actor_name(branch.target_actor_id),
            location_id,
            location_name: location_id.and_then(|id| self.location_name(id)),
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
        };
        self.world.next_event_seq += 1;
        self.push_projected_event(event.clone());
        event
    }

    pub(crate) fn append_hand_shuffled_event(&mut self, actor_id: u64, reason: &str) -> EventView {
        let generation = self.hand_generations.entry(actor_id).or_default();
        *generation = generation.saturating_add(1);
        self.append_hand_projection_event(actor_id, "hand.shuffled", reason)
    }

    pub(crate) fn append_story_hand_thought_event(
        &mut self,
        actor_id: u64,
        thought: (u8, &str, &str, bool, &str),
    ) -> EventView {
        let (slot, scene_key, replaces_offer_id, free, reason) = thought;
        let legacy_generation = self
            .hand_generations
            .get(&actor_id)
            .copied()
            .unwrap_or_default();
        let state = self.story_hand_states.entry(actor_id).or_default();
        if state.scene_key != scene_key {
            let slot_generations = if state.scene_key.is_empty() {
                if state.slot_generations == [0; 3] && legacy_generation > 0 {
                    [legacy_generation; 3]
                } else {
                    state.slot_generations
                }
            } else {
                [0; 3]
            };
            *state = StoryHandActorState {
                scene_key: scene_key.to_string(),
                slot_generations,
                ..StoryHandActorState::default()
            };
        }
        let slot_index = usize::from(slot).min(state.slot_generations.len() - 1);
        if slot_index == 0 {
            state.location_rotation_after = None;
        }
        state.slot_generations[slot_index] = state.slot_generations[slot_index].saturating_add(1);
        state.free_think_used |= free;
        let generation = self.hand_generations.entry(actor_id).or_default();
        *generation = generation.saturating_add(1);
        self.append_hand_projection_event(
            actor_id,
            "hand.thought",
            &format!("{reason}:slot={slot}:free={free}:replaced={replaces_offer_id}"),
        )
    }

    pub(crate) fn append_hand_projection_event(
        &mut self,
        actor_id: u64,
        type_name: &str,
        content: &str,
    ) -> EventView {
        let location_id = self.actor_by_id(actor_id).map(|actor| actor.location_id);
        let event = EventView {
            world_id: official_world_id(),
            world_epoch: official_world_epoch(),
            seq: self.world.next_event_seq,
            type_name: type_name.to_string(),
            success: true,
            reason: 0,
            actor_id: opt_id(actor_id),
            actor_name: self.actor_name(actor_id),
            target_actor_id: None,
            target_actor_name: None,
            location_id,
            location_name: location_id.and_then(|id| self.location_name(id)),
            destination_location_id: None,
            destination_location_name: None,
            content_id: None,
            content: Some(content.to_string()),
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
        };
        self.world.next_event_seq += 1;
        self.push_projected_event(event.clone());
        event
    }

    pub(crate) fn append_world_history_event(
        &mut self,
        type_name: &str,
        location_id: u64,
        destination_location_id: Option<u64>,
        content: String,
        source_world_tick: u64,
        source_location_id: Option<u64>,
        caused_by_event_seq: Option<u64>,
    ) -> EventView {
        let event = EventView {
            world_id: official_world_id(),
            world_epoch: official_world_epoch(),
            seq: self.world.next_event_seq,
            type_name: type_name.to_string(),
            success: true,
            location_id: Some(location_id),
            location_name: self.location_name(location_id),
            destination_location_id,
            destination_location_name: destination_location_id
                .and_then(|id| self.location_name(id)),
            content: Some(content),
            caused_by_event_seq,
            source_world_tick: Some(source_world_tick),
            source_location_id,
            ..EventView::default()
        };
        self.world.next_event_seq = self.world.next_event_seq.saturating_add(1);
        self.push_projected_event(event.clone());
        event
    }

    pub(crate) fn append_clock_event(
        &mut self,
        type_name: &str,
        actor_id: u64,
        clock: &ClockState,
        delta: i16,
        reason: &str,
    ) -> EventView {
        let location_id = if clock.scope == "room" {
            Some(clock.scope_id)
        } else {
            self.actor_by_id(actor_id).map(|actor| actor.location_id)
        };
        let event = EventView {
            world_id: official_world_id(),
            world_epoch: official_world_epoch(),
            seq: self.world.next_event_seq,
            type_name: type_name.to_string(),
            success: true,
            reason: 0,
            actor_id: opt_id(actor_id),
            actor_name: self.actor_name(actor_id),
            target_actor_id: None,
            target_actor_name: None,
            location_id,
            location_name: location_id.and_then(|id| self.location_name(id)),
            destination_location_id: None,
            destination_location_name: None,
            content_id: None,
            content: Some(reason.to_string()),
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
            clock_id: Some(clock.id.clone()),
            clock_scope: Some(clock.scope.clone()),
            clock_scope_id: Some(clock.scope_id),
            clock_kind: Some(clock.kind.clone()),
            clock_label: Some(clock.label.clone()),
            clock_filled: Some(clock.filled),
            clock_segments: Some(clock.segments),
            clock_delta: Some(delta),
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
        };
        self.world.next_event_seq += 1;
        self.push_projected_event(event.clone());
        event
    }

    pub(crate) fn append_tag_event(
        &mut self,
        type_name: &str,
        actor_id: u64,
        tag: &RpgTagState,
        reason: &str,
    ) -> EventView {
        let location_id = if tag.scope == "room" {
            Some(tag.scope_id)
        } else {
            self.actor_by_id(actor_id).map(|actor| actor.location_id)
        };
        let event = EventView {
            world_id: official_world_id(),
            world_epoch: official_world_epoch(),
            seq: self.world.next_event_seq,
            type_name: type_name.to_string(),
            success: true,
            reason: 0,
            actor_id: opt_id(actor_id),
            actor_name: self.actor_name(actor_id),
            target_actor_id: None,
            target_actor_name: None,
            location_id,
            location_name: location_id.and_then(|id| self.location_name(id)),
            destination_location_id: None,
            destination_location_name: None,
            content_id: None,
            content: Some(reason.to_string()),
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
            tag_id: Some(tag.id.clone()),
            tag_scope: Some(tag.scope.clone()),
            tag_scope_id: Some(tag.scope_id),
            tag_kind: Some(tag.kind.clone()),
            tag_label: Some(tag.label.clone()),
            caused_by_event_seq: None,
            source_world_tick: None,
            observed_through_seq: None,
            source_location_id: None,
            content_context: ContentReferenceContext::default(),
        };
        self.world.next_event_seq += 1;
        self.push_projected_event(event.clone());
        event
    }

    pub(crate) fn append_job_event(
        &mut self,
        type_name: &str,
        actor_id: u64,
        job: &JobState,
        reason: &str,
    ) -> EventView {
        let location_id = job
            .location_ids
            .first()
            .copied()
            .or_else(|| self.actor_by_id(actor_id).map(|actor| actor.location_id));
        let event = EventView {
            world_id: official_world_id(),
            world_epoch: official_world_epoch(),
            seq: self.world.next_event_seq,
            type_name: type_name.to_string(),
            success: true,
            reason: 0,
            actor_id: opt_id(actor_id),
            actor_name: self.actor_name(actor_id),
            target_actor_id: None,
            target_actor_name: None,
            location_id,
            location_name: location_id.and_then(|id| self.location_name(id)),
            destination_location_id: None,
            destination_location_name: None,
            content_id: None,
            content: Some(format!("{}:{}:{reason}", job.id, self.job_status(job))),
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
        };
        self.world.next_event_seq += 1;
        self.push_projected_event(event.clone());
        event
    }

    pub(crate) fn append_calling_event(
        &mut self,
        type_name: &str,
        calling: &CallingState,
        reason: &str,
    ) -> EventView {
        let location_id = self
            .actor_by_id(calling.actor_id)
            .map(|actor| actor.location_id);
        let event = EventView {
            world_id: official_world_id(),
            world_epoch: official_world_epoch(),
            seq: self.world.next_event_seq,
            type_name: type_name.to_string(),
            success: true,
            reason: 0,
            actor_id: Some(calling.actor_id),
            actor_name: self.actor_name(calling.actor_id),
            target_actor_id: None,
            target_actor_name: None,
            location_id,
            location_name: location_id.and_then(|id| self.location_name(id)),
            destination_location_id: None,
            destination_location_name: None,
            content_id: None,
            content: Some(format!("{}:{reason}", calling.statement)),
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
        };
        self.world.next_event_seq += 1;
        self.push_projected_event(event.clone());
        event
    }

    pub(crate) fn append_skill_event(
        &mut self,
        type_name: &str,
        skill: &SkillState,
        reason: &str,
    ) -> EventView {
        let location_id = self
            .actor_by_id(skill.actor_id)
            .map(|actor| actor.location_id);
        let event = EventView {
            world_id: official_world_id(),
            world_epoch: official_world_epoch(),
            seq: self.world.next_event_seq,
            type_name: type_name.to_string(),
            success: true,
            reason: 0,
            actor_id: Some(skill.actor_id),
            actor_name: self.actor_name(skill.actor_id),
            target_actor_id: None,
            target_actor_name: None,
            location_id,
            location_name: location_id.and_then(|id| self.location_name(id)),
            destination_location_id: None,
            destination_location_name: None,
            content_id: None,
            content: Some(format!("{}:{}:{reason}", skill.skill_id, skill.rank)),
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
        };
        self.world.next_event_seq += 1;
        self.push_projected_event(event.clone());
        event
    }

    pub(crate) fn append_deck_event(
        &mut self,
        type_name: &str,
        actor_id: u64,
        item_id: Option<u64>,
        content: String,
    ) -> EventView {
        let location_id = self.actor_by_id(actor_id).map(|actor| actor.location_id);
        let event = EventView {
            world_id: official_world_id(),
            world_epoch: official_world_epoch(),
            seq: self.world.next_event_seq,
            type_name: type_name.to_string(),
            success: true,
            reason: 0,
            actor_id: Some(actor_id),
            actor_name: self.actor_name(actor_id),
            target_actor_id: None,
            target_actor_name: None,
            location_id,
            location_name: location_id.and_then(|id| self.location_name(id)),
            destination_location_id: None,
            destination_location_name: None,
            content_id: None,
            content: Some(content),
            item_id,
            item_name: item_id.and_then(|id| self.item_name(id)),
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
        };
        self.world.next_event_seq += 1;
        self.push_projected_event(event.clone());
        event
    }

    pub(crate) fn append_ledger_event(
        &mut self,
        type_name: &str,
        mark: &VisitLedgerMarkState,
        reason: &str,
    ) -> EventView {
        let location_id = self
            .actor_by_id(mark.actor_id)
            .map(|actor| actor.location_id);
        let event = EventView {
            world_id: official_world_id(),
            world_epoch: official_world_epoch(),
            seq: self.world.next_event_seq,
            type_name: type_name.to_string(),
            success: true,
            reason: 0,
            actor_id: Some(mark.actor_id),
            actor_name: self.actor_name(mark.actor_id),
            target_actor_id: None,
            target_actor_name: None,
            location_id,
            location_name: location_id.and_then(|id| self.location_name(id)),
            destination_location_id: None,
            destination_location_name: None,
            content_id: None,
            content: Some(format!("{}:{}:{reason}", mark.category, mark.label)),
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
        };
        self.world.next_event_seq += 1;
        self.push_projected_event(event.clone());
        event
    }

    pub(crate) fn append_ledger_bank_event(
        &mut self,
        actor_id: u64,
        count: usize,
        categories: &[String],
        reason: &str,
    ) -> EventView {
        let location_id = self.actor_by_id(actor_id).map(|actor| actor.location_id);
        let event = EventView {
            world_id: official_world_id(),
            world_epoch: official_world_epoch(),
            seq: self.world.next_event_seq,
            type_name: "ledger.banked".to_string(),
            success: true,
            reason: 0,
            actor_id: Some(actor_id),
            actor_name: self.actor_name(actor_id),
            target_actor_id: None,
            target_actor_name: None,
            location_id,
            location_name: location_id.and_then(|id| self.location_name(id)),
            destination_location_id: None,
            destination_location_name: None,
            content_id: None,
            content: Some(format!("{count}:{}:{reason}", categories.join(","))),
            item_id: None,
            item_name: None,
            target_item_id: None,
            target_item_name: None,
            raw_roll: None,
            modifier: None,
            total: Some(i16::try_from(count).unwrap_or(i16::MAX)),
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
        };
        self.world.next_event_seq += 1;
        self.push_projected_event(event.clone());
        event
    }

    pub(crate) fn append_advancement_event(
        &mut self,
        type_name: &str,
        spend: &AdvancementSpendState,
        reason: &str,
    ) -> EventView {
        let location_id = self
            .actor_by_id(spend.actor_id)
            .map(|actor| actor.location_id);
        let event = EventView {
            world_id: official_world_id(),
            world_epoch: official_world_epoch(),
            seq: self.world.next_event_seq,
            type_name: type_name.to_string(),
            success: true,
            reason: 0,
            actor_id: Some(spend.actor_id),
            actor_name: self.actor_name(spend.actor_id),
            target_actor_id: None,
            target_actor_name: None,
            location_id,
            location_name: location_id.and_then(|id| self.location_name(id)),
            destination_location_id: None,
            destination_location_name: None,
            content_id: None,
            content: Some(format!(
                "{}:{}:{}:{reason}",
                spend.kind, spend.cost, spend.label
            )),
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
        };
        self.world.next_event_seq += 1;
        self.push_projected_event(event.clone());
        event
    }

    pub(crate) fn append_bond_event(
        &mut self,
        type_name: &str,
        bond: &BondState,
        reason: &str,
    ) -> EventView {
        let location_id = self
            .actor_by_id(bond.actor_id)
            .or_else(|| self.actor_by_id(bond.target_actor_id))
            .map(|actor| actor.location_id);
        let event = EventView {
            world_id: official_world_id(),
            world_epoch: official_world_epoch(),
            seq: self.world.next_event_seq,
            type_name: type_name.to_string(),
            success: true,
            reason: 0,
            actor_id: Some(bond.actor_id),
            actor_name: self.actor_name(bond.actor_id),
            target_actor_id: Some(bond.target_actor_id),
            target_actor_name: self.actor_name(bond.target_actor_id),
            location_id,
            location_name: location_id.and_then(|id| self.location_name(id)),
            destination_location_id: None,
            destination_location_name: None,
            content_id: None,
            content: Some(format!(
                "{}:{}:{}:{reason}",
                bond.id, bond.strength, bond.status
            )),
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
        };
        self.world.next_event_seq += 1;
        self.push_projected_event(event.clone());
        event
    }
}
