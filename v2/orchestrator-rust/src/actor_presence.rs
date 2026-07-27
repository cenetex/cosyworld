use super::*;

impl RuntimeWorld {
    pub(super) fn actor_is_present(actor: CwActor) -> bool {
        matches!(actor.kind, CW_ACTOR_HUMAN | CW_ACTOR_NPC)
            && matches!(actor.status, CW_ACTOR_ACTIVE | CW_ACTOR_KNOCKED_OUT)
    }

    pub(super) fn actor_can_act(actor: CwActor) -> bool {
        Self::actor_is_present(actor) && actor.status == CW_ACTOR_ACTIVE
    }

    pub(super) fn client_actor_can_submit(&self, actor_id: u64) -> bool {
        self.actor_by_id(actor_id).is_some_and(Self::actor_can_act)
            && self.actor_control_mode(actor_id).is_direct_input()
    }

    pub(super) fn client_actor_can_observe(&self, actor_id: u64) -> bool {
        self.actor_by_id(actor_id)
            .is_some_and(Self::actor_is_present)
            && self.actor_control_mode(actor_id).is_direct_input()
    }

    pub(super) fn actor_visible_in_projection(
        &self,
        actor: CwActor,
        client_actor_id: Option<u64>,
        active_direct_actor_ids: Option<&BTreeSet<u64>>,
    ) -> bool {
        if !Self::actor_is_present(actor) {
            return false;
        }
        if !Self::actor_can_act(actor) {
            return true;
        }
        if !self.actor_uses_inference(actor.id) {
            if Some(actor.id) == client_actor_id {
                return true;
            }
            return active_direct_actor_ids
                .map(|ids| ids.contains(&actor.id))
                .unwrap_or(true);
        }
        if self.avatar_hidden_until_discovered(actor) {
            return self.avatar_discovered(actor.id);
        }
        true
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn command_request(actor_id: u64, command: &str) -> CommandRequest {
        CommandRequest {
            actor_id,
            actor_session: None,
            command: command.to_string(),
            offer_id: None,
            wallet_address: None,
            wallet: None,
            wallet_session: None,
            owned_card_ids: None,
            cards: None,
            envelope: None,
        }
    }

    #[tokio::test]
    async fn knocked_out_avatar_remains_present_targetable_and_observable() {
        let mut runtime = RuntimeWorld::seeded();
        create_test_human(
            &mut runtime,
            5000,
            COSY_COTTAGE_LOCATION_ID,
            "Standing Helper",
        );
        create_test_human(
            &mut runtime,
            5001,
            COSY_COTTAGE_LOCATION_ID,
            "Fallen Neighbor",
        );
        let fallen = runtime
            .world
            .actors
            .iter_mut()
            .take(runtime.world.actor_count)
            .find(|actor| actor.id == 5001)
            .expect("fallen neighbor exists");
        fallen.status = CW_ACTOR_KNOCKED_OUT;
        fallen.conditions |= CW_CONDITION_UNCONSCIOUS;
        fallen.damage = fallen.stats.hp_base;
        for item in &mut runtime.world.items[..runtime.world.item_count] {
            match item.id {
                HEARTH_TONIC_ITEM_ID => {
                    item.holder_actor_id = 5000;
                    item.location_id = 0;
                    item.charges = 1;
                }
                STORY_BUTTON_ITEM_ID => {
                    item.holder_actor_id = 5001;
                    item.location_id = 0;
                }
                _ => {}
            }
        }
        runtime.observe_room_for_resident(RATI_ACTOR_ID, COSY_COTTAGE_LOCATION_ID);
        let rati = runtime.actor_by_id(RATI_ACTOR_ID).expect("Rati exists");
        assert_eq!(
            runtime
                .resident_healing_target(rati)
                .map(|target| target.id),
            Some(5001)
        );

        let active_direct_actor_ids = BTreeSet::from([5000]);
        let helper_view = runtime.state_response_with_presence(
            Some(5000),
            &AccessContext::default(),
            Some(&active_direct_actor_ids),
            false,
        );
        assert!(helper_view
            .actors
            .iter()
            .any(|actor| actor.id == 5001 && actor.status == "knocked_out" && actor.hp == 0));

        let observer_view = runtime.state_response_with_presence(
            Some(5001),
            &AccessContext::default(),
            Some(&active_direct_actor_ids),
            false,
        );
        assert_eq!(observer_view.location.id, COSY_COTTAGE_LOCATION_ID);
        assert!(observer_view
            .actors
            .iter()
            .any(|actor| actor.id == 5001 && actor.status == "knocked_out"));
        assert!(observer_view
            .items
            .iter()
            .any(|item| item.id == STORY_BUTTON_ITEM_ID && item.holder_actor_id == Some(5001)));
        assert!(observer_view.primary_action.disabled);

        let who = runtime
            .resolve_command_with_presence(
                &command_request(5000, "who"),
                &AccessContext::default(),
                Some(&active_direct_actor_ids),
            )
            .expect("who includes a present but inert avatar");
        assert!(matches!(
            who.dispatch,
            CommandDispatch::Read { ref output } if output.contains("Fallen Neighbor")
        ));

        let use_tonic = runtime
            .resolve_command_with_presence(
                &command_request(5000, "use Hearth Tonic on Fallen Neighbor"),
                &AccessContext::default(),
                Some(&active_direct_actor_ids),
            )
            .expect("the downed avatar is a legal care target");
        assert!(matches!(
            use_tonic.dispatch,
            CommandDispatch::UseItem {
                item_id: HEARTH_TONIC_ITEM_ID,
                target_actor_id: 5001
            }
        ));

        let state = test_app_state(runtime, None);
        let (_helper_session, _) = issue_actor_session(&state, 5000);
        let (actor_session, _) = issue_actor_session(&state, 5001);
        let mut runtime = state.inner.lock().await;
        assert!(client_actor_read_authorized_for_state(
            &runtime,
            &state,
            5001,
            Some(&actor_session),
            &AccessContext::default(),
        ));
        assert!(!client_actor_authorized_for_state(
            &runtime,
            &state,
            5001,
            Some(&actor_session),
        ));
        let release_events = release_inactive_direct_inventory_locked(&state, &mut runtime);
        assert!(!release_events.iter().any(|event| {
            event.actor_id == Some(5001) && event.item_id == Some(STORY_BUTTON_ITEM_ID)
        }));
        assert!(runtime.world.items[..runtime.world.item_count]
            .iter()
            .any(|item| {
                item.id == STORY_BUTTON_ITEM_ID
                    && item.holder_actor_id == 5001
                    && item.location_id == 0
            }));
    }

    #[test]
    fn knocked_out_avatar_receives_local_witness_credit() {
        let mut runtime = RuntimeWorld::seeded();
        create_test_human(
            &mut runtime,
            5000,
            COSY_COTTAGE_LOCATION_ID,
            "Quiet Witness",
        );
        let resident = runtime
            .ambient_actor()
            .expect("active helper makes resident action available");
        let sought_item_id = runtime
            .resident_sought_item_ids(resident)
            .into_iter()
            .next()
            .expect("seed resident seeks an evolution item");
        for item in &mut runtime.world.items[..runtime.world.item_count] {
            if item.id == sought_item_id {
                item.location_id = resident.location_id;
                item.holder_actor_id = 0;
            }
        }
        runtime.resident_memories.clear();
        runtime.remember_resident_memory(
            resident.id,
            RESIDENT_MEMORY_KIND_ITEM_LOCATION,
            sought_item_id,
            resident.location_id,
            RESIDENT_OBSERVED_MEMORY_CONFIDENCE,
            RESIDENT_OBSERVED_MEMORY_SALIENCE,
            Some(resident.id),
        );
        let action = runtime
            .resident_economy_autonomy_action(resident)
            .expect("resident plans the witnessed pickup");
        let witness = runtime
            .world
            .actors
            .iter_mut()
            .take(runtime.world.actor_count)
            .find(|actor| actor.id == 5000)
            .expect("quiet witness exists");
        witness.status = CW_ACTOR_KNOCKED_OUT;
        witness.conditions |= CW_CONDITION_UNCONSCIOUS;

        let (status, events) = runtime.apply_journal_record(&JournalRecord::new(action, 70691));

        assert_eq!(status, CW_OK);
        assert!(events.iter().any(|event| {
            event.type_name == "ledger.marked"
                && event.actor_id == Some(5000)
                && event
                    .content
                    .as_deref()
                    .is_some_and(|content| content.contains("witness:noticed"))
        }));
    }
}
