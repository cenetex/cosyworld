use super::super::*;

impl RuntimeWorld {
    fn resident_evolution_item_ids(&self, actor_id: u64) -> Vec<u64> {
        evolution_track_item_ids(actor_id).unwrap_or_default()
    }

    fn resident_evolution_item_ids_for_target_kind(
        &self,
        actor_id: u64,
        target_kind: &str,
    ) -> Vec<u64> {
        active_content()
            .evolution_tracks
            .iter()
            .find(|track| track.actor_id == actor_id)
            .map(|track| {
                track
                    .requirements
                    .iter()
                    .filter(|requirement| requirement.target_kind == target_kind)
                    .map(|requirement| requirement.item_id)
                    .collect()
            })
            .unwrap_or_default()
    }

    fn resident_calling_desired_item_ids(&self, resident: CwActor) -> Vec<u64> {
        if !Self::actor_can_act(resident) || resident.stats.level >= 2 {
            return Vec::new();
        }
        self.resident_evolution_item_ids(resident.id)
    }

    pub(crate) fn resident_calling_sought_item_ids(&self, resident: CwActor) -> Vec<u64> {
        if !Self::actor_can_act(resident) || resident.stats.level >= 2 {
            return Vec::new();
        }
        self.resident_evolution_item_ids_for_target_kind(resident.id, "actor_hand")
    }

    pub(crate) fn resident_personal_desires(
        &self,
        resident_id: u64,
    ) -> Vec<SeedResidentDesireContent> {
        active_content()
            .actors
            .iter()
            .find(|actor| actor.id == resident_id)
            .map(|actor| actor.desires.clone())
            .unwrap_or_default()
    }

    pub(crate) fn resident_personal_desire_for_item(
        &self,
        resident_id: u64,
        item_id: u64,
    ) -> Option<SeedResidentDesireContent> {
        self.resident_personal_desires(resident_id)
            .into_iter()
            .find(|desire| desire.item_id == item_id)
    }

    fn resident_personal_attachments(
        &self,
        resident_id: u64,
    ) -> Vec<SeedResidentAttachmentContent> {
        active_content()
            .actors
            .iter()
            .find(|actor| actor.id == resident_id)
            .map(|actor| actor.attachments.clone())
            .unwrap_or_default()
    }

    pub(crate) fn resident_personal_attachment_for_item(
        &self,
        resident_id: u64,
        item_id: u64,
    ) -> Option<SeedResidentAttachmentContent> {
        self.resident_personal_attachments(resident_id)
            .into_iter()
            .find(|attachment| attachment.item_id == item_id)
    }

    pub(crate) fn resident_attachment_item_ids(&self, resident: CwActor) -> Vec<u64> {
        if !Self::actor_can_act(resident) {
            return Vec::new();
        }
        self.resident_personal_attachments(resident.id)
            .into_iter()
            .map(|attachment| attachment.item_id)
            .collect()
    }

    pub(crate) fn resident_desired_item_ids(&self, resident: CwActor) -> Vec<u64> {
        if !Self::actor_can_act(resident) {
            return Vec::new();
        }
        let mut item_ids = self.resident_calling_desired_item_ids(resident);
        for desire in self.resident_personal_desires(resident.id) {
            if !item_ids.contains(&desire.item_id) {
                item_ids.push(desire.item_id);
            }
        }
        item_ids
    }

    pub(crate) fn resident_healing_target(&self, resident: CwActor) -> Option<CwActor> {
        if !Self::actor_can_act(resident) {
            return None;
        }
        self.world.actors[..self.world.actor_count]
            .iter()
            .copied()
            .filter(|target| {
                self.healing_target_is_offerable(&resident, target)
                    && (target.id == resident.id
                        || self.resident_remembers_actor_at(
                            resident.id,
                            target.id,
                            resident.location_id,
                        ))
            })
            .min_by_key(|target| (target.id != resident.id, target.id))
    }

    pub(crate) fn resident_held_healing_item_for_target(
        &self,
        resident: CwActor,
    ) -> Option<(CwItem, CwActor)> {
        let target = self.resident_healing_target(resident)?;
        let item = self
            .actor_held_items(resident.id)
            .into_iter()
            .filter(|item| item.role == CW_ITEM_ROLE_CONSUMABLE && item.charges > 0)
            .min_by_key(|item| (item.held_since_tick, item.id))?;
        Some((item, target))
    }

    pub(crate) fn resident_needs_medicine(&self, resident: CwActor) -> bool {
        self.resident_healing_target(resident).is_some()
            && self
                .resident_held_healing_item_for_target(resident)
                .is_none()
    }

    pub(crate) fn resident_local_feature_item_ids(&self, resident: CwActor) -> Vec<u64> {
        if !Self::actor_can_act(resident) {
            return Vec::new();
        }
        let mut item_ids: Vec<u64> = self
            .room_features(resident.location_id)
            .into_iter()
            .flat_map(|feature| {
                feature.uses.iter().filter_map(|use_case| {
                    (!self.feature_use_claimed(
                        resident.id,
                        resident.location_id,
                        &feature.key,
                        use_case.item_id,
                    ))
                    .then_some(use_case.item_id)
                })
            })
            .collect();
        item_ids.sort_unstable();
        item_ids.dedup();
        item_ids
    }

    pub(crate) fn resident_item_is_sought(&self, resident: CwActor, item_id: u64) -> bool {
        let wants_item = self
            .resident_calling_sought_item_ids(resident)
            .into_iter()
            .any(|desired_item_id| desired_item_id == item_id)
            || self
                .resident_personal_desires(resident.id)
                .into_iter()
                .any(|desire| desire.item_id == item_id);
        let already_held = self
            .actor_held_items(resident.id)
            .into_iter()
            .any(|item| item.id == item_id);
        if wants_item && !already_held {
            return true;
        }
        if self
            .resident_attachment_item_ids(resident)
            .into_iter()
            .any(|attachment_item_id| attachment_item_id == item_id)
            && !self
                .actor_held_items(resident.id)
                .into_iter()
                .any(|item| item.id == item_id)
        {
            return true;
        }

        if self.resident_needs_medicine(resident) {
            return self
                .item_by_id(item_id)
                .is_some_and(|item| item.role == CW_ITEM_ROLE_CONSUMABLE && item.charges > 0);
        }
        if !self
            .actor_held_items(resident.id)
            .into_iter()
            .any(|item| item.id == item_id)
            && self
                .resident_feature_use_match_for_item(resident, item_id)
                .is_some()
        {
            return true;
        }
        false
    }

    pub(crate) fn resident_sought_item_ids(&self, resident: CwActor) -> Vec<u64> {
        let held_item_ids: BTreeSet<u64> = self
            .actor_held_items(resident.id)
            .into_iter()
            .map(|item| item.id)
            .collect();

        let mut sought = Vec::new();
        if self.resident_needs_medicine(resident) {
            let mut remembered_potions: Vec<_> = self
                .beliefs
                .values()
                .filter(|memory| {
                    memory.holder_actor_id == resident.id
                        && memory.kind == BELIEF_KIND_ITEM_LOCATION
                        && memory.confidence >= BELIEF_TUNING.minimum_action_confidence
                        && !held_item_ids.contains(&memory.subject_id)
                })
                .filter_map(|memory| {
                    self.item_by_id(memory.subject_id)
                        .filter(|item| item.role == CW_ITEM_ROLE_CONSUMABLE)
                        .map(|item| {
                            (
                                item.id,
                                std::cmp::Reverse(memory.salience),
                                std::cmp::Reverse(memory.confidence),
                                std::cmp::Reverse(memory.observed_tick),
                            )
                        })
                })
                .collect();
            remembered_potions.sort_by_key(|(_, salience, confidence, observed_tick)| {
                (*salience, *confidence, *observed_tick)
            });
            for (item_id, _, _, _) in remembered_potions {
                if !sought.contains(&item_id) {
                    sought.push(item_id);
                }
            }
        }

        let mut desired_seekable_item_ids = self.resident_calling_sought_item_ids(resident);
        for desire in self.resident_personal_desires(resident.id) {
            if !desired_seekable_item_ids.contains(&desire.item_id) {
                desired_seekable_item_ids.push(desire.item_id);
            }
        }
        for item_id in desired_seekable_item_ids
            .into_iter()
            .filter(|item_id| !held_item_ids.contains(item_id))
        {
            if !sought.contains(&item_id) {
                sought.push(item_id);
            }
        }
        for item_id in self.resident_local_feature_item_ids(resident) {
            if !sought.contains(&item_id) {
                sought.push(item_id);
            }
        }
        for item_id in self
            .resident_attachment_item_ids(resident)
            .into_iter()
            .filter(|item_id| !held_item_ids.contains(item_id))
        {
            if !sought.contains(&item_id) {
                sought.push(item_id);
            }
        }
        sought
    }

    pub(crate) fn resident_item_is_attached(&self, resident_id: u64, item: CwItem) -> bool {
        if self
            .resident_personal_attachment_for_item(resident_id, item.id)
            .is_some()
        {
            return true;
        }
        if evolution_item_matches_resident(item.id, resident_id) {
            return true;
        }
        if evolution_item_belongs_to_another_resident(item.id, resident_id) {
            return false;
        }
        if self.resident_item_has_feature_use_attachment(resident_id, item.id) {
            return true;
        }
        item.holder_actor_id == resident_id
            && item.held_since_tick > 0
            && self.world.tick.saturating_sub(item.held_since_tick) >= 12
    }

    pub(crate) fn resident_item_has_feature_use_attachment(
        &self,
        resident_id: u64,
        item_id: u64,
    ) -> bool {
        if evolution_item_belongs_to_another_resident(item_id, resident_id) {
            return false;
        }
        let prefix = format!("actor:{resident_id}:feature_use:");
        let suffix = format!(":{item_id}");
        self.tags.values().any(|tag| {
            tag.active
                && tag.scope == "actor"
                && tag.scope_id == resident_id
                && tag.id.starts_with(&prefix)
                && tag.id.ends_with(&suffix)
        })
    }

    pub(crate) fn resident_attached_item_ids(&self, resident_id: u64) -> Vec<u64> {
        self.actor_held_items(resident_id)
            .into_iter()
            .filter(|item| self.resident_item_is_attached(resident_id, *item))
            .map(|item| item.id)
            .collect()
    }

    pub(crate) fn resident_item_attachment_reason(
        &self,
        resident: CwActor,
        item_id: u64,
    ) -> String {
        let resident_name = self
            .actor_name(resident.id)
            .unwrap_or_else(|| format!("Resident {}", resident.id));
        let item_name = self
            .item_name(item_id)
            .unwrap_or_else(|| format!("Item {item_id}"));
        if evolution_item_matches_resident(item_id, resident.id) {
            format!("{resident_name} is attached to {item_name} because it belongs to their evolution track.")
        } else if self.resident_item_has_feature_use_attachment(resident.id, item_id) {
            format!(
                "{resident_name} is attached to {item_name} because it mattered in a room moment."
            )
        } else if let Some(attachment) =
            self.resident_personal_attachment_for_item(resident.id, item_id)
        {
            format!(
                "{resident_name} is attached to {item_name}: {}",
                attachment.reason.trim_end_matches('.')
            )
        } else {
            format!("{resident_name} is attached to {item_name}.")
        }
    }

    pub(crate) fn resident_item_recovery_reason(
        &self,
        resident: CwActor,
        item_id: u64,
    ) -> Option<String> {
        let attachment = self.resident_personal_attachment_for_item(resident.id, item_id)?;
        let resident_name = self
            .actor_name(resident.id)
            .unwrap_or_else(|| format!("Resident {}", resident.id));
        let item_name = self
            .item_name(item_id)
            .unwrap_or_else(|| format!("Item {item_id}"));
        Some(format!(
            "{resident_name} wants {item_name} back: {}",
            attachment.reason.trim_end_matches('.')
        ))
    }

    pub(crate) fn resident_sought_item_source(
        &self,
        resident: CwActor,
        item_id: u64,
    ) -> &'static str {
        if self.resident_needs_medicine(resident)
            && self
                .item_by_id(item_id)
                .is_some_and(|item| item.role == CW_ITEM_ROLE_CONSUMABLE)
        {
            return "medicine";
        }
        if self
            .resident_personal_desire_for_item(resident.id, item_id)
            .is_some()
        {
            return "personal";
        }
        if self
            .resident_calling_desired_item_ids(resident)
            .into_iter()
            .any(|desired_item_id| desired_item_id == item_id)
        {
            return "calling";
        }
        if self
            .resident_personal_attachment_for_item(resident.id, item_id)
            .is_some()
        {
            return "attachment";
        }
        if self
            .resident_feature_use_match_for_item(resident, item_id)
            .is_some()
        {
            return "room_feature";
        }
        "memory"
    }

    pub(crate) fn resident_item_request_reason(&self, resident: CwActor, item_id: u64) -> String {
        let resident_name = self
            .actor_name(resident.id)
            .unwrap_or_else(|| format!("Resident {}", resident.id));
        let item_name = self
            .item_name(item_id)
            .unwrap_or_else(|| format!("Item {item_id}"));
        let item = self.item_by_id(item_id);
        let healing_target = self.resident_healing_target(resident);
        if let Some(desire) = self.resident_personal_desire_for_item(resident.id, item_id) {
            format!(
                "{resident_name} wants {item_name}: {}.",
                desire.reason.trim_end_matches('.')
            )
        } else if self
            .resident_calling_desired_item_ids(resident)
            .into_iter()
            .any(|desired_item_id| desired_item_id == item_id)
        {
            format!("{resident_name} wants {item_name}.")
        } else if item.is_some_and(|item| item.role == CW_ITEM_ROLE_CONSUMABLE)
            && healing_target.is_some_and(|target| target.id == resident.id)
        {
            format!("{resident_name} needs {item_name}.")
        } else if item.is_some_and(|item| item.role == CW_ITEM_ROLE_CONSUMABLE)
            && healing_target.is_some()
        {
            let target = healing_target.expect("healing target checked");
            let target_name = self
                .actor_name(target.id)
                .unwrap_or_else(|| format!("Resident {}", target.id));
            format!("{resident_name} wants {item_name} for {target_name}.")
        } else if let Some(reason) = self.resident_item_recovery_reason(resident, item_id) {
            format!("{reason}.")
        } else if let Some(candidate) = self.resident_feature_use_match_for_item(resident, item_id)
        {
            format!(
                "{resident_name} could use {item_name} with {}.",
                candidate.feature_name
            )
        } else if item.is_some_and(|item| item.role == CW_ITEM_ROLE_CONSUMABLE) {
            format!("{resident_name} could use {item_name}.")
        } else {
            format!("{resident_name} values {item_name}.")
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn resident_refuses_to_trade_attached_items() {
        let mut runtime = RuntimeWorld::seeded();
        let create = CwAction {
            kind: CW_ACTION_CREATE_ACTOR,
            actor_id: 5000,
            location_id: COSY_COTTAGE_LOCATION_ID,
            ..CwAction::default()
        };
        assert_eq!(
            runtime
                .apply_journal_record(&JournalRecord::new(create, 7834))
                .0,
            CW_OK
        );

        for item in &mut runtime.world.items[..runtime.world.item_count] {
            match item.id {
                DEWBRIGHT_BUTTON_ITEM_ID => {
                    item.location_id = 0;
                    item.holder_actor_id = 5000;
                }
                STORY_BUTTON_ITEM_ID => {
                    item.location_id = 0;
                    item.holder_actor_id = RATI_ACTOR_ID;
                }
                _ => {}
            }
        }
        runtime
            .prepare_resident_local_memories(RATI_ACTOR_ID)
            .expect("Rati observes the offered player item");
        runtime.record_economy_disclosure(5000, RATI_ACTOR_ID);

        let refusal = runtime
            .resident_trade_is_willing(
                5000,
                RATI_ACTOR_ID,
                DEWBRIGHT_BUTTON_ITEM_ID,
                STORY_BUTTON_ITEM_ID,
            )
            .expect_err("Rati protects a desired item she already holds");
        assert!(refusal.contains("attached to Story Button"));
        let command = runtime
            .resolve_command(
                &command_request(5000, "trade dewbright with rati for story"),
                &AccessContext::default(),
            )
            .expect_err("refused trade should not dispatch");
        assert_eq!(command.status, 409);
        assert!(command.output.contains("attached to Story Button"));
        let state = runtime.state_response(Some(5000), &AccessContext::default());
        let economy = state
            .actors
            .iter()
            .find(|actor| actor.id == RATI_ACTOR_ID)
            .and_then(|actor| actor.resident_economy.as_ref())
            .expect("resident economy is exposed");
        let held_story = economy
            .held_items
            .iter()
            .find(|item| item.item_id == STORY_BUTTON_ITEM_ID)
            .expect("held item details include Story Button");
        assert_eq!(held_story.disposition, "identity");
        assert!(held_story.reason.contains("evolution track"));
        assert!(economy.attached_item_ids.contains(&STORY_BUTTON_ITEM_ID));
    }

    #[test]
    fn requested_attachment_can_be_given_back_even_when_not_evolution_item() {
        let mut runtime = RuntimeWorld::seeded();
        let create = CwAction {
            kind: CW_ACTION_CREATE_ACTOR,
            actor_id: 5000,
            location_id: COSY_COTTAGE_LOCATION_ID,
            ..CwAction::default()
        };
        let mut create_record = JournalRecord::new(create, 78343);
        create_record.actor_meta_upserts.insert(
            5000,
            ActorMeta {
                name: "Tonic Holder".to_string(),
                speech_mode: "prose".to_string(),
                title: "Borrowed Cup Tester".to_string(),
                description: "A test avatar carrying an attached resident item.".to_string(),
            },
        );
        assert_eq!(runtime.apply_journal_record(&create_record).0, CW_OK);
        runtime.world.tick = runtime.world.tick.saturating_add(1);
        for item in &mut runtime.world.items[..runtime.world.item_count] {
            if item.id == HEARTH_TONIC_ITEM_ID {
                item.location_id = 0;
                item.holder_actor_id = 5000;
                item.held_since_tick = runtime.world.tick;
                item.charges = 1;
            }
        }
        runtime
            .prepare_resident_local_memories(RATI_ACTOR_ID)
            .expect("Rati observes the player-held attached item");
        runtime.record_economy_disclosure(5000, RATI_ACTOR_ID);

        let request = runtime
            .resident_request_for_holder(
                runtime.actor_by_id(RATI_ACTOR_ID).expect("Rati exists"),
                5000,
            )
            .expect("Rati asks for the attached tonic back");
        assert_eq!(request.item_id, HEARTH_TONIC_ITEM_ID);
        assert!(request.reason.contains("wants Hearth Tonic back"));
        runtime
            .actor_gift_is_legal(5000, RATI_ACTOR_ID, HEARTH_TONIC_ITEM_ID)
            .expect("requested non-evolution attachment can be given back");

        let state = runtime.state_response(Some(5000), &AccessContext::default());
        assert!(state
            .action_offers
            .iter()
            .any(|offer| offer.kind == "give_item"
                && offer
                    .effect
                    .as_deref()
                    .is_some_and(|effect| effect.contains("first warm cup"))));

        let give = CwAction {
            kind: CW_ACTION_GIVE_ITEM,
            actor_id: 5000,
            target_actor_id: RATI_ACTOR_ID,
            item_id: HEARTH_TONIC_ITEM_ID,
            ..CwAction::default()
        };
        let reply_text = runtime
            .resident_reply_text_for_committed_action(&give)
            .expect("gift reply target")
            .1;
        assert!(reply_text.contains("I gave you Hearth Tonic."));
        assert!(reply_text.contains("wants Hearth Tonic back"));
        assert!(reply_text.contains("first warm cup"));
        let (status, events) = runtime.apply_journal_record(&JournalRecord::new(give, 78344));
        assert_eq!(status, CW_OK);
        let gift_event = events
            .iter()
            .find(|event| {
                event.type_name == "item.given"
                    && event.actor_id == Some(5000)
                    && event.target_actor_id == Some(RATI_ACTOR_ID)
                    && event.item_id == Some(HEARTH_TONIC_ITEM_ID)
            })
            .expect("non-evolution gift event");
        assert!(gift_event
            .content
            .as_deref()
            .is_some_and(|content| content.contains("first warm cup")));
        assert!(runtime.world.items[..runtime.world.item_count]
            .iter()
            .any(|item| item.id == HEARTH_TONIC_ITEM_ID && item.holder_actor_id == RATI_ACTOR_ID));
    }

    #[test]
    fn resident_economy_projects_desires_and_trade_willingness() {
        let mut runtime = RuntimeWorld::seeded();
        let create = CwAction {
            kind: CW_ACTION_CREATE_ACTOR,
            actor_id: 5000,
            location_id: COSY_COTTAGE_LOCATION_ID,
            ..CwAction::default()
        };
        let mut create_record = JournalRecord::new(create, 7833);
        create_record.actor_meta_upserts.insert(
            5000,
            ActorMeta {
                name: "Trader Guest".to_string(),
                speech_mode: "prose".to_string(),
                title: "Button Holder".to_string(),
                description: "A test avatar holding an item a resident wants.".to_string(),
            },
        );
        assert_eq!(runtime.apply_journal_record(&create_record).0, CW_OK);

        for item in &mut runtime.world.items[..runtime.world.item_count] {
            match item.id {
                STORY_BUTTON_ITEM_ID => {
                    item.location_id = 0;
                    item.holder_actor_id = 5000;
                }
                DEWBRIGHT_BUTTON_ITEM_ID => {
                    item.location_id = 0;
                    item.holder_actor_id = RATI_ACTOR_ID;
                }
                _ => {}
            }
        }
        runtime
            .prepare_resident_local_memories(RATI_ACTOR_ID)
            .expect("Rati observes the arranged trade inventory");
        runtime.record_economy_disclosure(5000, RATI_ACTOR_ID);

        let state = runtime.state_response(Some(5000), &AccessContext::default());
        let rati = state
            .actors
            .iter()
            .find(|actor| actor.id == RATI_ACTOR_ID)
            .expect("Rati is visible");
        let economy = rati
            .resident_economy
            .as_ref()
            .expect("resident economy is exposed");
        assert!(economy.desired_item_ids.contains(&STORY_BUTTON_ITEM_ID));
        assert!(economy.sought_item_ids.contains(&STORY_BUTTON_ITEM_ID));
        let sought_story = economy
            .sought_items
            .iter()
            .find(|item| item.item_id == STORY_BUTTON_ITEM_ID)
            .expect("sought item details include Story Button");
        assert_eq!(sought_story.source, "personal");
        assert!(sought_story.reason.contains("Rati wants Story Button"));
        assert!(sought_story.reason.contains("blue scarf"));
        assert_eq!(sought_story.world_status, "held");
        assert_eq!(sought_story.world_holder_actor_id, Some(5000));
        assert_eq!(
            sought_story.world_holder_actor_name.as_deref(),
            Some("Trader Guest")
        );
        assert_eq!(
            sought_story.world_location_id,
            Some(COSY_COTTAGE_LOCATION_ID)
        );
        assert_eq!(
            sought_story.world_location_name.as_deref(),
            Some("The Cosy Cottage")
        );
        assert_eq!(
            sought_story.memory_location_id,
            Some(COSY_COTTAGE_LOCATION_ID)
        );
        assert_eq!(sought_story.holder_actor_id, Some(5000));
        assert_eq!(
            sought_story.confidence,
            Some(BELIEF_TUNING.firsthand_confidence)
        );
        assert_eq!(economy.inventory_count, 1);
        assert_eq!(economy.inventory_capacity, 0);
        assert!(economy.carried_weight_tenths > 0);
        assert!(economy.carrying_capacity_tenths > economy.carried_weight_tenths);
        assert!(economy.held_item_ids.contains(&DEWBRIGHT_BUTTON_ITEM_ID));
        let held_dewbright = economy
            .held_items
            .iter()
            .find(|item| item.item_id == DEWBRIGHT_BUTTON_ITEM_ID)
            .expect("held item details include Dewbright");
        assert_eq!(held_dewbright.disposition, "tradeable");
        assert!(held_dewbright.reason.contains("may trade Dewbright Button"));
        assert_eq!(
            held_dewbright.keep_score,
            runtime.resident_item_keep_score(
                runtime.actor_by_id(RATI_ACTOR_ID).expect("Rati exists"),
                runtime
                    .item_by_id(DEWBRIGHT_BUTTON_ITEM_ID)
                    .expect("Dewbright exists")
            )
        );
        assert!(!economy
            .attached_item_ids
            .contains(&DEWBRIGHT_BUTTON_ITEM_ID));
        let request = economy
            .request
            .as_ref()
            .expect("Rati requests the held item");
        assert_eq!(request.item_id, STORY_BUTTON_ITEM_ID);
        assert_eq!(request.holder_actor_id, 5000);
        assert!(request.reason.contains("Rati wants Story Button"));
        assert!(request.reason.contains("blue scarf"));
        assert!(economy.motive.contains("Rati wants Story Button"));
        assert!(economy.motive.contains("blue scarf"));
        assert!(economy.motive.contains("from Trader Guest"));
        let offer = economy.trade_offer.as_ref().expect("Rati accepts a trade");
        assert_eq!(offer.offered_item_id, STORY_BUTTON_ITEM_ID);
        assert_eq!(offer.requested_item_id, DEWBRIGHT_BUTTON_ITEM_ID);
        assert_eq!(offer.willingness, "eager");
        assert!(offer.reason.contains("wants Story Button"));
        assert!(offer.reason.contains("blue scarf"));
        let stance = economy
            .trade_stance
            .as_ref()
            .expect("accepted trade also exposes a stance");
        assert!(stance.accepted);
        assert_eq!(stance.offered_item_id, STORY_BUTTON_ITEM_ID);
        assert_eq!(stance.requested_item_id, DEWBRIGHT_BUTTON_ITEM_ID);
        assert_eq!(stance.willingness, "eager");
        assert!(stance.reason.contains("blue scarf"));
        assert!(state
            .action_offers
            .iter()
            .find(|offer| offer.kind == "trade_item")
            .and_then(|offer| offer.effect.as_deref())
            .is_some_and(|effect| effect.contains("wants Story Button")));
    }

    #[test]
    fn sought_item_availability_tracks_the_single_world_object() {
        let mut runtime = RuntimeWorld::seeded();
        let rati = runtime.actor_by_id(RATI_ACTOR_ID).expect("Rati exists");

        {
            let story_button = runtime
                .world
                .items
                .iter_mut()
                .find(|item| item.id == STORY_BUTTON_ITEM_ID)
                .expect("Story Button exists");
            story_button.location_id = 0;
            story_button.holder_actor_id = 1002;
            story_button.charges = 1;
        }
        let held = runtime.resident_sought_item_view(rati, STORY_BUTTON_ITEM_ID);
        assert_eq!(held.world_status, "held");
        assert_eq!(held.world_holder_actor_id, Some(1002));
        assert_eq!(held.world_holder_actor_name.as_deref(), Some("Gust"));
        assert_eq!(held.world_location_id, Some(COSY_COTTAGE_LOCATION_ID));

        {
            let story_button = runtime
                .world
                .items
                .iter_mut()
                .find(|item| item.id == STORY_BUTTON_ITEM_ID)
                .expect("Story Button exists");
            story_button.location_id = RAIN_SOFT_GARDEN_LOCATION_ID;
            story_button.holder_actor_id = 0;
        }
        let available = runtime.resident_sought_item_view(rati, STORY_BUTTON_ITEM_ID);
        assert_eq!(available.world_status, "available");
        assert_eq!(
            available.world_location_name.as_deref(),
            Some("Rain-Soft Garden")
        );
        assert_eq!(available.world_holder_actor_id, None);

        {
            let story_button = runtime
                .world
                .items
                .iter_mut()
                .find(|item| item.id == STORY_BUTTON_ITEM_ID)
                .expect("Story Button exists");
            story_button.location_id = 0;
        }
        let hidden = runtime.resident_sought_item_view(rati, STORY_BUTTON_ITEM_ID);
        assert_eq!(hidden.world_status, "hidden");
        assert_eq!(hidden.world_location_id, Some(COSY_COTTAGE_LOCATION_ID));

        {
            let story_button = runtime
                .world
                .items
                .iter_mut()
                .find(|item| item.id == STORY_BUTTON_ITEM_ID)
                .expect("Story Button exists");
            story_button.charges = 0;
        }
        let spent = runtime.resident_sought_item_view(rati, STORY_BUTTON_ITEM_ID);
        assert_eq!(spent.world_status, "spent");
        assert_eq!(spent.world_location_id, None);
    }

    #[test]
    fn content_authored_personal_desires_drive_requests_and_reasons() {
        let mut runtime = RuntimeWorld::seeded();
        runtime.world.tick = 0;
        let create = CwAction {
            kind: CW_ACTION_CREATE_ACTOR,
            actor_id: 5000,
            location_id: 40,
            ..CwAction::default()
        };
        let mut create_record = JournalRecord::new(create, 78332);
        create_record.actor_meta_upserts.insert(
            5000,
            ActorMeta {
                name: "Button Courier".to_string(),
                speech_mode: "prose".to_string(),
                title: "Desire Tester".to_string(),
                description: "A test avatar carrying an item with authored local demand."
                    .to_string(),
            },
        );
        assert_eq!(runtime.apply_journal_record(&create_record).0, CW_OK);
        for item in &mut runtime.world.items[..runtime.world.item_count] {
            if item.id == DEWBRIGHT_BUTTON_ITEM_ID {
                item.location_id = 0;
                item.holder_actor_id = 5000;
                item.held_since_tick = runtime.world.tick;
            }
        }

        let mouse = runtime
            .actor_by_id(STEAMPUNK_MOUSE_ACTOR_ID)
            .expect("Doctor Cogwhisker exists");
        assert!(runtime
            .resident_desired_item_ids(mouse)
            .contains(&DEWBRIGHT_BUTTON_ITEM_ID));
        assert_eq!(
            runtime.resident_sought_item_source(mouse, DEWBRIGHT_BUTTON_ITEM_ID),
            "personal"
        );
        let request_reason = runtime.resident_item_request_reason(mouse, DEWBRIGHT_BUTTON_ITEM_ID);
        assert!(request_reason.contains("tiny rain engine"));
        let immediate_request = runtime
            .resident_request_for_holder(mouse, 5000)
            .expect("same-room player-held personal desire is requestable");
        assert_eq!(immediate_request.item_id, DEWBRIGHT_BUTTON_ITEM_ID);
        assert!(immediate_request.reason.contains("tiny rain engine"));
        runtime.record_economy_disclosure(5000, STEAMPUNK_MOUSE_ACTOR_ID);

        let mouse = runtime
            .prepare_resident_local_memories(STEAMPUNK_MOUSE_ACTOR_ID)
            .expect("Doctor Cogwhisker observes the courier");
        let economy = runtime
            .resident_economy_view(mouse, Some(5000))
            .expect("resident economy view");
        let sought = economy
            .sought_items
            .iter()
            .find(|item| item.item_id == DEWBRIGHT_BUTTON_ITEM_ID)
            .expect("personal desire appears in sought items");
        assert_eq!(sought.source, "personal");
        assert!(sought.reason.contains("tiny rain engine"));
        assert_eq!(sought.holder_actor_id, Some(5000));
        let request = economy
            .request
            .as_ref()
            .expect("resident asks for observed player-held personal desire");
        assert_eq!(request.item_id, DEWBRIGHT_BUTTON_ITEM_ID);
        assert!(request.reason.contains("tiny rain engine"));
        assert!(economy.motive.contains("tiny rain engine"));
        assert!(runtime
            .actor_gift_is_legal(5000, STEAMPUNK_MOUSE_ACTOR_ID, DEWBRIGHT_BUTTON_ITEM_ID)
            .is_ok());
    }

    #[test]
    fn resident_economy_requests_player_held_healing_item() {
        let mut runtime = RuntimeWorld::seeded();
        let create = CwAction {
            kind: CW_ACTION_CREATE_ACTOR,
            actor_id: 5000,
            location_id: COSY_COTTAGE_LOCATION_ID,
            ..CwAction::default()
        };
        let mut create_record = JournalRecord::new(create, 78335);
        create_record.actor_meta_upserts.insert(
            5000,
            ActorMeta {
                name: "Medic Guest".to_string(),
                speech_mode: "prose".to_string(),
                title: "Careful Visitor".to_string(),
                description: "A test avatar holding medicine.".to_string(),
            },
        );
        assert_eq!(runtime.apply_journal_record(&create_record).0, CW_OK);
        runtime
            .world
            .actors
            .iter_mut()
            .find(|actor| actor.id == RATI_ACTOR_ID)
            .expect("Rati exists")
            .damage = 4;
        for item in &mut runtime.world.items[..runtime.world.item_count] {
            if item.id == 2001 {
                item.location_id = 0;
                item.holder_actor_id = 5000;
                item.charges = 1;
            } else if item.holder_actor_id == RATI_ACTOR_ID && item.role == CW_ITEM_ROLE_CONSUMABLE
            {
                item.holder_actor_id = 0;
                item.location_id = RAIN_SOFT_GARDEN_LOCATION_ID;
            }
        }
        runtime
            .prepare_resident_local_memories(RATI_ACTOR_ID)
            .expect("Rati observes the player-held medicine");
        runtime.record_economy_disclosure(5000, RATI_ACTOR_ID);

        let state = runtime.state_response(Some(5000), &AccessContext::default());
        let rati = state
            .actors
            .iter()
            .find(|actor| actor.id == RATI_ACTOR_ID)
            .expect("Rati is visible");
        let economy = rati
            .resident_economy
            .as_ref()
            .expect("resident economy is exposed");
        let request = economy
            .request
            .as_ref()
            .expect("Rati asks for player-held medicine");
        assert_eq!(request.item_id, 2001);
        assert_eq!(request.holder_actor_id, 5000);
        assert_eq!(request.reason, "Rati needs Hearth Tonic.");
        assert_eq!(economy.motive, "Rati needs Hearth Tonic from Medic Guest.");
    }

    #[test]
    fn resident_economy_requests_medicine_for_hurt_companion() {
        let mut runtime = RuntimeWorld::seeded();
        let create = CwAction {
            kind: CW_ACTION_CREATE_ACTOR,
            actor_id: 5000,
            location_id: COSY_COTTAGE_LOCATION_ID,
            ..CwAction::default()
        };
        let mut create_record = JournalRecord::new(create, 78337);
        create_record.actor_meta_upserts.insert(
            5000,
            ActorMeta {
                name: "Care Guest".to_string(),
                speech_mode: "prose".to_string(),
                title: "Tonic Holder".to_string(),
                description: "A test avatar holding medicine for someone nearby.".to_string(),
            },
        );
        assert_eq!(runtime.apply_journal_record(&create_record).0, CW_OK);
        runtime
            .world
            .actors
            .iter_mut()
            .find(|actor| actor.id == WHISKERWIND_ACTOR_ID)
            .expect("Gust exists")
            .damage = 4;
        for item in &mut runtime.world.items[..runtime.world.item_count] {
            if item.id == 2001 {
                item.location_id = 0;
                item.holder_actor_id = 5000;
                item.charges = 1;
            }
        }
        runtime
            .prepare_resident_local_memories(RATI_ACTOR_ID)
            .expect("Rati observes the player-held medicine");
        runtime.record_economy_disclosure(5000, RATI_ACTOR_ID);

        let state = runtime.state_response(Some(5000), &AccessContext::default());
        let economy = state
            .actors
            .iter()
            .find(|actor| actor.id == RATI_ACTOR_ID)
            .and_then(|actor| actor.resident_economy.as_ref())
            .expect("resident economy is exposed");
        let request = economy
            .request
            .as_ref()
            .expect("Rati asks for player-held medicine for a companion");
        assert_eq!(request.item_id, 2001);
        assert_eq!(request.holder_actor_id, 5000);
        assert_eq!(request.reason, "Rati wants Hearth Tonic for Gust.");
        assert_eq!(
            economy.motive,
            "Rati wants Hearth Tonic for Gust from Care Guest."
        );
    }

    #[test]
    fn resident_economy_values_items_useful_to_the_current_room() {
        let mut runtime = RuntimeWorld::seeded();
        let create = CwAction {
            kind: CW_ACTION_CREATE_ACTOR,
            actor_id: 5000,
            location_id: COSY_COTTAGE_LOCATION_ID,
            ..CwAction::default()
        };
        let mut create_record = JournalRecord::new(create, 78336);
        create_record.actor_meta_upserts.insert(
            5000,
            ActorMeta {
                name: "Bell Guest".to_string(),
                speech_mode: "prose".to_string(),
                title: "Threshold Carrier".to_string(),
                description: "A test avatar holding an item useful to the room.".to_string(),
            },
        );
        assert_eq!(runtime.apply_journal_record(&create_record).0, CW_OK);

        for item in &mut runtime.world.items[..runtime.world.item_count] {
            match item.id {
                WATCH_BELL_ITEM_ID => {
                    item.location_id = 0;
                    item.holder_actor_id = 5000;
                }
                STORY_BUTTON_ITEM_ID | 2004 => {
                    item.location_id = MOONLIT_TRAIL_LOCATION_ID;
                    item.holder_actor_id = 0;
                }
                _ => {}
            }
        }

        let rati = runtime.actor_by_id(RATI_ACTOR_ID).expect("Rati exists");
        assert!(runtime.resident_item_is_sought(rati, WATCH_BELL_ITEM_ID));
        let request = runtime
            .resident_request_for_holder(rati, 5000)
            .expect("Rati notices the currently visible held room item");
        assert_eq!(request.item_id, WATCH_BELL_ITEM_ID);
        assert_eq!(
            request.reason,
            "Rati could use Watch Bell with Low Doorway."
        );
        runtime.record_economy_disclosure(5000, RATI_ACTOR_ID);

        let state = runtime.state_response(Some(5000), &AccessContext::default());
        let economy = state
            .actors
            .iter()
            .find(|actor| actor.id == RATI_ACTOR_ID)
            .and_then(|actor| actor.resident_economy.as_ref())
            .expect("resident economy is exposed");
        assert_eq!(
            economy.motive,
            "Rati could use Watch Bell with Low Doorway from Bell Guest."
        );
    }

    #[test]
    fn content_authored_attachments_explain_trade_refusals() {
        let mut runtime = RuntimeWorld::seeded();
        let create = CwAction {
            kind: CW_ACTION_CREATE_ACTOR,
            actor_id: 5000,
            location_id: COSY_COTTAGE_LOCATION_ID,
            ..CwAction::default()
        };
        let mut create_record = JournalRecord::new(create, 78341);
        create_record.actor_meta_upserts.insert(
            5000,
            ActorMeta {
                name: "Tonic Trader".to_string(),
                speech_mode: "prose".to_string(),
                title: "Warm-Cup Tester".to_string(),
                description: "A test avatar offering an item Rati wants.".to_string(),
            },
        );
        assert_eq!(runtime.apply_journal_record(&create_record).0, CW_OK);

        runtime.world.tick = runtime.world.tick.saturating_add(1);
        for item in &mut runtime.world.items[..runtime.world.item_count] {
            match item.id {
                STORY_BUTTON_ITEM_ID => {
                    item.location_id = 0;
                    item.holder_actor_id = 5000;
                    item.held_since_tick = runtime.world.tick;
                }
                HEARTH_TONIC_ITEM_ID => {
                    item.location_id = 0;
                    item.holder_actor_id = RATI_ACTOR_ID;
                    item.held_since_tick = runtime.world.tick;
                }
                _ => {}
            }
        }
        runtime
            .prepare_resident_local_memories(RATI_ACTOR_ID)
            .expect("Rati observes the offered player item");
        runtime.record_economy_disclosure(5000, RATI_ACTOR_ID);

        let rati = runtime.actor_by_id(RATI_ACTOR_ID).expect("Rati exists");
        let hearth_tonic = runtime
            .item_by_id(HEARTH_TONIC_ITEM_ID)
            .expect("Hearth Tonic exists");
        assert!(runtime.resident_item_is_attached(RATI_ACTOR_ID, hearth_tonic));
        let held_tonic = runtime.resident_held_item_view(rati, hearth_tonic, None);
        assert_eq!(held_tonic.disposition, "attached");
        assert!(held_tonic.reason.contains("first warm cup"));

        let refusal = runtime
            .resident_trade_is_willing(
                5000,
                RATI_ACTOR_ID,
                STORY_BUTTON_ITEM_ID,
                HEARTH_TONIC_ITEM_ID,
            )
            .expect_err("Rati protects a content-authored attachment");
        assert!(refusal.contains("attached to Hearth Tonic"), "{refusal}");
        assert!(refusal.contains("first warm cup"), "{refusal}");

        let state = runtime.state_response(Some(5000), &AccessContext::default());
        let economy = state
            .actors
            .iter()
            .find(|actor| actor.id == RATI_ACTOR_ID)
            .and_then(|actor| actor.resident_economy.as_ref())
            .expect("resident economy is exposed");
        assert!(economy.trade_offer.is_none());
        let stance = economy
            .trade_stance
            .as_ref()
            .expect("refused trade is still visible as a stance");
        assert!(!stance.accepted);
        assert_eq!(stance.offered_item_id, STORY_BUTTON_ITEM_ID);
        assert_eq!(stance.requested_item_id, HEARTH_TONIC_ITEM_ID);
        assert_eq!(stance.willingness, "refuses");
        assert!(stance.reason.contains("attached to Hearth Tonic"));
        assert!(stance.reason.contains("first warm cup"));
        assert!(economy
            .held_items
            .iter()
            .find(|item| item.item_id == HEARTH_TONIC_ITEM_ID)
            .is_some_and(|item| item.reason.contains("first warm cup")));
        assert!(state
            .action_offers
            .iter()
            .all(|offer| offer.kind != "trade_item"));
    }

    #[test]
    fn content_authored_attachments_drive_recovery_seeking() {
        let mut runtime = RuntimeWorld::seeded();
        runtime.world.tick = runtime.world.tick.saturating_add(1);
        runtime.beliefs.clear();
        for item in &mut runtime.world.items[..runtime.world.item_count] {
            match item.id {
                HEARTH_TONIC_ITEM_ID => {
                    item.location_id = COSY_COTTAGE_LOCATION_ID;
                    item.holder_actor_id = 0;
                    item.held_since_tick = 0;
                }
                STORY_BUTTON_ITEM_ID => {
                    item.location_id = MOONLIT_TRAIL_LOCATION_ID;
                    item.holder_actor_id = 0;
                    item.held_since_tick = 0;
                }
                _ => {}
            }
        }

        let rati = runtime
            .prepare_resident_local_memories(RATI_ACTOR_ID)
            .expect("Rati observes the loose attached item");
        assert!(!runtime
            .resident_desired_item_ids(rati)
            .contains(&HEARTH_TONIC_ITEM_ID));
        assert!(runtime
            .resident_sought_item_ids(rati)
            .contains(&HEARTH_TONIC_ITEM_ID));
        let sought = runtime.resident_sought_item_view(rati, HEARTH_TONIC_ITEM_ID);
        assert_eq!(sought.source, "attachment");
        assert!(sought.reason.contains("wants Hearth Tonic back"));
        assert!(sought.reason.contains("first warm cup"));

        let action = runtime
            .resident_economy_autonomy_action(rati)
            .expect("Rati recovers the attached item");
        assert_eq!(action.kind, CW_ACTION_PICK_UP_ITEM);
        assert_eq!(action.actor_id, RATI_ACTOR_ID);
        assert_eq!(action.item_id, HEARTH_TONIC_ITEM_ID);
        let (status, events) = runtime.apply_journal_record(&JournalRecord::new(action, 78342));
        assert_eq!(status, CW_OK);
        let pickup_event = events
            .iter()
            .find(|event| {
                event.type_name == "item.picked_up"
                    && event.actor_id == Some(RATI_ACTOR_ID)
                    && event.item_id == Some(HEARTH_TONIC_ITEM_ID)
            })
            .expect("attachment recovery pickup event");
        assert!(pickup_event
            .content
            .as_deref()
            .is_some_and(|content| content.contains("first warm cup")));
        assert!(runtime.world.items[..runtime.world.item_count]
            .iter()
            .any(|item| item.id == HEARTH_TONIC_ITEM_ID && item.holder_actor_id == RATI_ACTOR_ID));
    }
}
