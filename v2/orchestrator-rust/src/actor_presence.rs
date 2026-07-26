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

impl RuntimeWorld {
    pub(super) fn default_bondable_resident_with_presence(
        &self,
        actor_id: u64,
        active_direct_actor_ids: Option<&BTreeSet<u64>>,
    ) -> Option<CwActor> {
        let actor = self.actor_by_id(actor_id)?;
        if self.advancement_points_available(actor_id) < usize::from(BOND_SLOT_COST) {
            return None;
        }
        self.world.actors[..self.world.actor_count]
            .iter()
            .copied()
            .find(|target| {
                target.id != actor_id
                    && Self::actor_can_act(*target)
                    && target.location_id == actor.location_id
                    && !self.actors_blocked(actor_id, target.id)
                    && self.actor_visible_in_projection(
                        *target,
                        Some(actor_id),
                        active_direct_actor_ids,
                    )
                    && self.active_bond(actor_id, target.id).is_none()
            })
    }

    pub(super) fn validate_offer(
        &self,
        actor_id: u64,
        access: &AccessContext,
        submission: &ActionOfferSubmissionRequest,
        active_direct_actor_ids: &BTreeSet<u64>,
    ) -> Result<(), &'static str> {
        self.validate_action_offer_submission_with_presence(
            actor_id,
            access,
            submission,
            Some(active_direct_actor_ids),
        )
    }

    pub(super) fn actor_offer_target_visible(
        &self,
        actor: CwActor,
        target: CwActor,
        active_direct_actor_ids: &BTreeSet<u64>,
    ) -> bool {
        RuntimeWorld::actor_can_act(target)
            && target.location_id == actor.location_id
            && self.actor_visible_in_projection(
                target,
                Some(actor.id),
                Some(active_direct_actor_ids),
            )
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

    #[tokio::test]
    async fn lapsed_direct_avatar_offer_cannot_spend_advancement() {
        let mut runtime = RuntimeWorld::seeded();
        create_test_human(
            &mut runtime,
            5000,
            RAIN_SOFT_GARDEN_LOCATION_ID,
            "Bond Seeker",
        );
        create_test_human(
            &mut runtime,
            5001,
            RAIN_SOFT_GARDEN_LOCATION_ID,
            "Visible Neighbor",
        );
        create_test_human(
            &mut runtime,
            5002,
            RAIN_SOFT_GARDEN_LOCATION_ID,
            "Remaining Neighbor",
        );
        runtime.ledger_marks.insert(
            "test:lapsed-offer-advancement".to_string(),
            VisitLedgerMarkState {
                id: "test:lapsed-offer-advancement".to_string(),
                actor_id: 5000,
                category: "witness".to_string(),
                label: "Found a reason to grow".to_string(),
                source_event_seq: runtime.world.next_event_seq,
                banked: true,
            },
        );

        let state = test_app_state(runtime, None);
        let (seeker_session, _) = issue_actor_session(&state, 5000);
        let (neighbor_session, _) = issue_actor_session(&state, 5001);
        let (remaining_session, _) = issue_actor_session(&state, 5002);
        assert_eq!(
            ping_actor_session_for_actor(&state.actor_sessions, 5000, &seeker_session),
            Some(false)
        );
        assert_eq!(
            ping_actor_session_for_actor(&state.actor_sessions, 5001, &neighbor_session),
            Some(false)
        );
        assert_eq!(
            ping_actor_session_for_actor(&state.actor_sessions, 5002, &remaining_session),
            Some(false)
        );

        let issued_offer = {
            let active_direct_actor_ids = active_actor_ids_for_state(&state);
            let runtime = state.inner.lock().await;
            let projected = runtime.state_response_with_presence(
                Some(5000),
                &AccessContext::default(),
                Some(&active_direct_actor_ids),
                false,
            );
            assert!(projected.actors.iter().any(|actor| actor.id == 5001));
            projected
                .action_offers
                .into_iter()
                .find(|offer| {
                    offer.kind == "create_bond"
                        && offer
                            .target
                            .as_ref()
                            .is_some_and(|target| target.id == Some(5001))
                })
                .expect("visible co-located direct avatar is a legal bond target")
        };

        assert!(mark_actor_session_inactive(
            &state.actor_sessions,
            5001,
            &neighbor_session,
        ));
        {
            let active_direct_actor_ids = active_actor_ids_for_state(&state);
            let runtime = state.inner.lock().await;
            let projected = runtime.state_response_with_presence(
                Some(5000),
                &AccessContext::default(),
                Some(&active_direct_actor_ids),
                false,
            );
            assert!(!projected.actors.iter().any(|actor| actor.id == 5001));
            assert!(projected.actors.iter().any(|actor| actor.id == 5002));
            assert!(!projected.action_offers.iter().any(|offer| {
                offer
                    .target
                    .as_ref()
                    .is_some_and(|target| target.kind == "actor" && target.id == Some(5001))
            }));
            let replacement_offer = projected
                .action_offers
                .iter()
                .find(|offer| offer.kind == "create_bond")
                .expect("same-kind bond offer survives for the remaining visible neighbor");
            assert_eq!(
                replacement_offer
                    .target
                    .as_ref()
                    .and_then(|target| target.id),
                Some(5002)
            );
            let replacement_option = projected
                .primary_action
                .options
                .iter()
                .find(|option| option.kind == "create_bond")
                .expect("primary options retain the visible same-kind bond action");
            assert_eq!(replacement_option.command, replacement_offer.command);
            assert!(!replacement_option
                .command
                .to_ascii_lowercase()
                .contains("visible neighbor"));
            assert!(!projected
                .primary_action
                .command
                .to_ascii_lowercase()
                .contains("visible neighbor"));
            assert!(!serde_json::to_string(&projected.primary_action)
                .expect("primary action serializes")
                .to_ascii_lowercase()
                .contains("visible neighbor"));
        }

        let rejected_offer = submit_action_offer(
            ConnectInfo("127.0.0.1:44136".parse().expect("client address")),
            State(state.clone()),
            Json(ActionOfferSubmissionRequest {
                path: "/actions/create-bond".to_string(),
                offer_id: issued_offer.offer_id,
                composition_id: issued_offer.composition_id,
                kind: issued_offer.kind,
                rules_action: issued_offer.rules_action,
                operation: issued_offer.operation,
                rules_profile: issued_offer.rules_profile,
                state_revision: issued_offer.state_revision,
                route: issued_offer.route,
                target: issued_offer.target,
                cost: issued_offer.cost,
                payload: serde_json::json!({
                    "actor_id": 5000,
                    "actor_session": seeker_session.clone(),
                    "target_actor_id": 5001,
                    "statement": "We always make room for each other."
                }),
            }),
        )
        .await
        .0;
        assert!(!rejected_offer.ok);
        assert_eq!(rejected_offer.status, 409);
        assert!(rejected_offer.events.iter().any(|event| {
            event.type_name == "action.offer_rejected"
                && event
                    .content
                    .as_deref()
                    .is_some_and(|content| content.contains("offer expired"))
        }));

        let rejected_direct = create_bond(
            ConnectInfo("127.0.0.1:44137".parse().expect("client address")),
            State(state.clone()),
            Json(ReviseBondRequest {
                actor_id: 5000,
                actor_session: Some(seeker_session),
                target_actor_id: 5001,
                statement: "We always make room for each other.".to_string(),
            }),
        )
        .await
        .0;
        assert!(!rejected_direct.ok);
        assert_eq!(rejected_direct.status, 409);
        assert!(rejected_direct.events.is_empty());

        let runtime = state.inner.lock().await;
        assert_eq!(runtime.advancement_points_available(5000), 1);
        assert!(runtime.active_bond(5000, 5001).is_none());
        assert!(!runtime.event_log.iter().any(|event| {
            event.type_name == "advancement.spent" && event.actor_id == Some(5000)
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
