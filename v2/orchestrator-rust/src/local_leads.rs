use super::*;

pub(super) const LOCAL_LEAD_MEMORY_KIND: &str = "local_lead";

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
pub(super) struct LocalLeadState {
    pub(super) id: String,
    pub(super) actor_id: u64,
    pub(super) source_actor_id: u64,
    pub(super) source_offer_id: String,
    pub(super) source_reference: String,
    pub(super) source_event_seq: u64,
    pub(super) origin_location_id: u64,
    pub(super) destination_location_id: u64,
    pub(super) destination_hint: String,
    pub(super) received_tick: u64,
    #[serde(default)]
    pub(super) consumed: bool,
    #[serde(default)]
    pub(super) settled: bool,
    #[serde(default)]
    pub(super) forgotten: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(super) consumed_event_seq: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(super) settled_event_seq: Option<u64>,
}

#[derive(Clone, Copy)]
pub(super) struct AuthoredLocalLead<'a> {
    pub(super) offer: &'a SeedContextualActionOffer,
    pub(super) destination_location_id: u64,
    pub(super) destination_hint: &'a str,
}

impl RuntimeWorld {
    pub(super) fn contextual_cooperation_available(
        &self,
        actor_id: u64,
        offer: &SeedContextualActionOffer,
    ) -> bool {
        let Some(payload) = offer.cooperation.as_ref() else {
            return true;
        };
        match payload {
            SeedCooperationPayload::LocalLead {
                destination_location_id,
                ..
            } => {
                offer.subject.kind == "location"
                    && self.actor_by_id(actor_id).is_some_and(|actor| {
                        actor.location_id == offer.subject.id
                            && !self
                                .seed_exit_discovered(actor.location_id, *destination_location_id)
                    })
                    && !self.local_leads.values().any(|lead| {
                        lead.actor_id == actor_id
                            && lead.source_offer_id == offer.id
                            && !lead.consumed
                            && !lead.settled
                            && !lead.forgotten
                    })
            }
        }
    }

    pub(super) fn apply_influence_projection(
        &mut self,
        action: &CwAction,
        events: &[EventView],
    ) -> Vec<EventView> {
        if action.kind != CW_ACTION_RULES_INFLUENCE {
            return Vec::new();
        }
        let Some(target) = self.actor_by_id(action.target_actor_id) else {
            return Vec::new();
        };
        if !Self::actor_can_act(target) {
            return Vec::new();
        }
        let Some(check) = events.iter().find(|event| {
            event.type_name == "ability_check.rolled" && event.actor_id == Some(action.actor_id)
        }) else {
            return Vec::new();
        };
        let succeeded = check
            .total
            .zip(check.dc)
            .is_some_and(|(total, dc)| total >= dc);
        let outcome = if succeeded { "cooperates" } else { "declines" };
        let attitude = if succeeded { "cooperative" } else { "cautious" };
        let key = format!("{}:{}", action.actor_id, action.target_actor_id);
        let attempts = self
            .npc_cooperation
            .get(&key)
            .map(|state| state.attempts.saturating_add(1))
            .unwrap_or(1);
        self.npc_cooperation.insert(
            key,
            NpcCooperationState {
                actor_id: action.actor_id,
                target_actor_id: action.target_actor_id,
                desired_cooperation: "share one useful local lead".to_string(),
                attitude: attitude.to_string(),
                outcome: outcome.to_string(),
                attempts,
                source_event_seq: check.seq,
            },
        );
        let target_name = self
            .actor_name(action.target_actor_id)
            .unwrap_or_else(|| format!("Resident {}", action.target_actor_id));
        let committed = self.append_async_job_event(
            "influence.committed",
            action.actor_id,
            Some(action.target_actor_id),
            Some(format!(
                "{target_name} {outcome}: the authored request was to share one useful local lead."
            )),
        );
        let mut projected = vec![committed.clone()];
        if succeeded {
            if let Some(received) = self.receive_authored_local_lead(
                action.actor_id,
                action.target_actor_id,
                committed.seq,
            ) {
                projected.push(received);
            }
        }
        projected
    }

    pub(super) fn authored_local_lead_for_actor(
        &self,
        actor_id: u64,
    ) -> Option<AuthoredLocalLead<'static>> {
        let location_id = self.actor_by_id(actor_id)?.location_id;
        let mut authored = active_content()
            .contributions
            .iter()
            .flat_map(|bundle| bundle.offers.iter())
            .filter_map(|offer| {
                let SeedCooperationPayload::LocalLead {
                    destination_location_id,
                    destination_hint,
                } = offer.cooperation.as_ref()?;
                (offer.based_on == "srd5.2.1:influence"
                    && offer.subject.kind == "location"
                    && offer.subject.id == location_id)
                    .then_some(AuthoredLocalLead {
                        offer,
                        destination_location_id: *destination_location_id,
                        destination_hint,
                    })
            })
            .collect::<Vec<_>>();
        authored.sort_by(|left, right| left.offer.id.cmp(&right.offer.id));
        authored.into_iter().next()
    }

    pub(super) fn actionable_local_lead(&self, actor_id: u64) -> Option<&LocalLeadState> {
        let actor = self.actor_by_id(actor_id)?;
        self.local_leads
            .values()
            .filter(|lead| {
                lead.actor_id == actor_id
                    && lead.origin_location_id == actor.location_id
                    && !lead.consumed
                    && !lead.settled
                    && !lead.forgotten
                    && !self
                        .seed_exit_discovered(lead.origin_location_id, lead.destination_location_id)
            })
            .max_by_key(|lead| (lead.source_event_seq, lead.id.as_str()))
    }

    pub(super) fn local_lead_for_offer<'a>(
        &'a self,
        actor_id: u64,
        offer: &RankedActionOffer,
    ) -> Option<&'a LocalLeadState> {
        self.actionable_local_lead(actor_id)
            .filter(|lead| offer.id == local_lead_offer_id(&lead.id))
    }

    pub(super) fn receive_authored_local_lead(
        &mut self,
        actor_id: u64,
        source_actor_id: u64,
        source_event_seq: u64,
    ) -> Option<EventView> {
        let actor = self.actor_by_id(actor_id)?;
        let authored = self.authored_local_lead_for_actor(actor_id)?;
        if authored.destination_location_id == actor.location_id
            || self
                .seed_exit_by_locations(actor.location_id, authored.destination_location_id)
                .is_none()
            || !self.contextual_cooperation_available(actor_id, authored.offer)
        {
            return None;
        }
        let lead_id = local_lead_id(actor_id, &authored.offer.id, source_event_seq);
        if self.local_leads.contains_key(&lead_id) {
            return None;
        }
        let state = LocalLeadState {
            id: lead_id.clone(),
            actor_id,
            source_actor_id,
            source_offer_id: authored.offer.id.clone(),
            source_reference: authored.offer.source_reference.clone(),
            source_event_seq,
            origin_location_id: actor.location_id,
            destination_location_id: authored.destination_location_id,
            destination_hint: authored.destination_hint.to_string(),
            received_tick: self.world.tick,
            consumed: false,
            settled: false,
            forgotten: false,
            consumed_event_seq: None,
            settled_event_seq: None,
        };
        self.local_leads.insert(lead_id.clone(), state);
        self.remember_search_discovery(
            actor_id,
            actor.location_id,
            LOCAL_LEAD_MEMORY_KIND,
            authored.destination_location_id,
            &lead_id,
        );
        let destination_name = self
            .location_name(authored.destination_location_id)
            .unwrap_or_else(|| format!("Location {}", authored.destination_location_id));
        let mut event = self.append_async_job_event(
            "local_lead.received",
            actor_id,
            Some(source_actor_id),
            Some(format!(
                "{destination_name}: {} [{lead_id}]",
                authored.destination_hint
            )),
        );
        event.caused_by_event_seq = Some(source_event_seq);
        self.replace_projected_event(&event);
        Some(event)
    }

    pub(super) fn settle_local_leads_for_route(
        &mut self,
        discovering_actor_id: u64,
        from_location_id: u64,
        to_location_id: u64,
        reason: &str,
        event_seq: u64,
    ) {
        let followed_id = reason.strip_prefix("follow_local_lead:");
        for lead in self.local_leads.values_mut().filter(|lead| {
            lead.origin_location_id == from_location_id
                && lead.destination_location_id == to_location_id
                && !lead.settled
        }) {
            if followed_id == Some(lead.id.as_str()) && lead.actor_id == discovering_actor_id {
                lead.consumed = true;
                lead.consumed_event_seq = Some(event_seq);
            }
            lead.settled = true;
            lead.settled_event_seq = Some(event_seq);
        }
    }

    pub(super) fn forget_local_lead_memory(&mut self, lead_id: &str) {
        if let Some(lead) = self.local_leads.get_mut(lead_id) {
            if !lead.consumed && !lead.settled {
                lead.forgotten = true;
            }
        }
    }
}

pub(super) fn local_lead_id(actor_id: u64, offer_id: &str, source_event_seq: u64) -> String {
    format!("local-lead:{actor_id}:{offer_id}:{source_event_seq}")
}

pub(super) fn local_lead_offer_id(lead_id: &str) -> String {
    format!("local_lead:{lead_id}")
}

#[cfg(test)]
mod tests {
    use super::*;

    const TEST_ACTOR_ID: u64 = 5000;

    fn influence_ready_runtime() -> RuntimeWorld {
        let mut runtime = RuntimeWorld::seeded();
        create_test_human(
            &mut runtime,
            TEST_ACTOR_ID,
            COSY_COTTAGE_LOCATION_ID,
            "Lead Listener",
        );
        let mut greeting = JournalRecord::new(
            CwAction {
                kind: CW_ACTION_SAY,
                actor_id: TEST_ACTOR_ID,
                content_id: 91_320,
                ..CwAction::default()
            },
            320_001,
        );
        greeting
            .content_upserts
            .insert(91_320, "Hello, Rati.".to_string());
        assert_eq!(runtime.apply_journal_record(&greeting).0, CW_OK);
        runtime
    }

    fn successful_influence_seed(runtime: &RuntimeWorld) -> u64 {
        (1..=256)
            .find(|seed| {
                let mut candidate = runtime.clone();
                let record = JournalRecord::new(
                    candidate
                        .plan_influence_action(TEST_ACTOR_ID, RATI_ACTOR_ID)
                        .expect("authored Influence is legal"),
                    *seed,
                );
                candidate
                    .apply_journal_record(&record)
                    .1
                    .iter()
                    .any(|event| event.type_name == "local_lead.received")
            })
            .expect("the deterministic check range contains a success")
    }

    #[test]
    fn successful_influence_records_one_actionable_lead_without_topology_authority() {
        let mut runtime = influence_ready_runtime();
        let access = AccessContext::default();
        let before_offer = runtime
            .state_response(Some(TEST_ACTOR_ID), &access)
            .action_offers
            .into_iter()
            .find(|offer| {
                offer.kind == "explore_path"
                    && offer
                        .target
                        .as_ref()
                        .is_some_and(|target| target.id == Some(RAIN_SOFT_GARDEN_LOCATION_ID))
            })
            .expect("the ordinary authored route can be scouted");
        assert!(before_offer.id.starts_with("explore_path:"));
        let routes_before = runtime.routes.clone();
        let exits_before = runtime.world.exits[..runtime.world.exit_count].to_vec();
        let replay_base = RuntimeSnapshot::from_runtime(&runtime);
        let record = JournalRecord::new(
            runtime
                .plan_influence_action(TEST_ACTOR_ID, RATI_ACTOR_ID)
                .expect("Influence plans"),
            successful_influence_seed(&runtime),
        );

        let (status, events) = runtime.apply_journal_record(&record);

        assert_eq!(status, CW_OK);
        assert!(events
            .iter()
            .any(|event| event.type_name == "local_lead.received"));
        assert_eq!(runtime.routes, routes_before);
        assert_eq!(
            &runtime.world.exits[..runtime.world.exit_count],
            exits_before.as_slice()
        );
        assert_eq!(runtime.local_leads.len(), 1);
        let lead = runtime.local_leads.values().next().expect("one local lead");
        assert_eq!(lead.actor_id, TEST_ACTOR_ID);
        assert_eq!(lead.source_actor_id, RATI_ACTOR_ID);
        assert_eq!(
            lead.source_offer_id,
            "cosyworld.core:cottage-ask-local-lead"
        );
        assert_eq!(lead.origin_location_id, COSY_COTTAGE_LOCATION_ID);
        assert_eq!(lead.destination_location_id, RAIN_SOFT_GARDEN_LOCATION_ID);
        assert!(!lead.consumed && !lead.settled && !lead.forgotten);
        let lead_id = lead.id.clone();
        let after_offer = runtime
            .state_response(Some(TEST_ACTOR_ID), &access)
            .action_offers
            .into_iter()
            .find(|offer| offer.id == local_lead_offer_id(&lead_id))
            .expect("the next legal Scout choice carries the durable lead identity");
        assert_eq!(after_offer.command, "scout Rain-Soft Garden");
        assert_eq!(after_offer.source, "local_lead+exit_projection");
        assert!(after_offer
            .effect
            .as_deref()
            .is_some_and(|effect| effect.contains("Rati")));
        assert_ne!(after_offer.id, before_offer.id);
        assert!(!runtime
            .state_response(Some(TEST_ACTOR_ID), &access)
            .action_offers
            .iter()
            .any(|offer| offer.kind == "influence"));

        let expected_leads = runtime.local_leads.clone();
        let mut replayed = replay_base.into_runtime().expect("base snapshot restores");
        assert_eq!(replayed.apply_journal_record(&record).0, CW_OK);
        assert_eq!(replayed.local_leads.len(), 1);
        assert_eq!(replayed.local_leads, expected_leads);
        assert_eq!(
            replayed
                .event_log
                .iter()
                .filter(|event| event.type_name == "local_lead.received")
                .map(|event| (event.seq, event.content.clone(), event.caused_by_event_seq))
                .collect::<Vec<_>>(),
            runtime
                .event_log
                .iter()
                .filter(|event| event.type_name == "local_lead.received")
                .map(|event| (event.seq, event.content.clone(), event.caused_by_event_seq))
                .collect::<Vec<_>>()
        );

        runtime.world.tick = runtime
            .world
            .tick
            .saturating_add(BELIEF_TUNING.decay_interval_ticks * 64);
        runtime.decay_search_memories();
        assert!(runtime.local_leads[&lead_id].forgotten);
        assert_eq!(runtime.routes, routes_before);
        assert_eq!(
            &runtime.world.exits[..runtime.world.exit_count],
            exits_before.as_slice()
        );
    }

    #[test]
    fn following_the_lead_consumes_it_through_the_existing_route_resolver() {
        let mut runtime = influence_ready_runtime();
        let record = JournalRecord::new(
            runtime
                .plan_influence_action(TEST_ACTOR_ID, RATI_ACTOR_ID)
                .expect("Influence plans"),
            successful_influence_seed(&runtime),
        );
        assert_eq!(runtime.apply_journal_record(&record).0, CW_OK);
        let lead_id = runtime
            .local_leads
            .keys()
            .next()
            .expect("successful Influence yields a lead")
            .clone();
        let offer = runtime
            .state_response(Some(TEST_ACTOR_ID), &AccessContext::default())
            .action_offers
            .into_iter()
            .find(|offer| offer.id == local_lead_offer_id(&lead_id))
            .expect("lead exposes its Scout offer");
        let (action, mutation, _) = runtime
            .plan_scout_offer(TEST_ACTOR_ID, &offer)
            .expect("the ordinary Scout planner accepts the lead");
        assert!(matches!(
            &mutation,
            ProjectionMutation::DiscoverSeedExit { reason, .. }
                if reason == &format!("follow_local_lead:{lead_id}")
        ));
        let mut follow = JournalRecord::new(action, 320_002);
        follow.bind_offer_kind("explore_path");
        follow.projection_mutations.push(mutation);

        assert_eq!(runtime.apply_journal_record(&follow).0, CW_OK);

        let lead = &runtime.local_leads[&lead_id];
        assert!(lead.consumed && lead.settled && !lead.forgotten);
        assert_eq!(lead.consumed_event_seq, lead.settled_event_seq);
        assert!(
            runtime.seed_exit_discovered(COSY_COTTAGE_LOCATION_ID, RAIN_SOFT_GARDEN_LOCATION_ID)
        );
        let restored = RuntimeSnapshot::from_runtime(&runtime)
            .into_runtime()
            .expect("settled lead restores");
        assert_eq!(restored.local_leads[&lead_id], *lead);
    }

    #[tokio::test]
    async fn canonical_command_and_offer_submission_return_the_same_lead_identity() {
        let base = influence_ready_runtime();
        let mut command_result = None;
        for seed in 1..=256 {
            let mut candidate = base.clone();
            candidate.next_seed = seed;
            let state = test_app_state(candidate, None);
            let (session, _) = issue_actor_session(&state, TEST_ACTOR_ID);
            let response = command(
                ConnectInfo("127.0.0.1:43200".parse().expect("client address")),
                State(state.clone()),
                Json(CommandRequest {
                    actor_id: TEST_ACTOR_ID,
                    actor_session: Some(session),
                    command: "influence Rati".to_string(),
                    offer_id: None,
                    wallet_address: None,
                    wallet: None,
                    wallet_session: None,
                    owned_card_ids: None,
                    cards: None,
                    envelope: None,
                }),
            )
            .await
            .0;
            let leads = state.inner.lock().await.local_leads.clone();
            if !leads.is_empty() {
                command_result = Some((response, leads));
                break;
            }
        }
        let (command_response, command_leads) =
            command_result.expect("the command path eventually returns the authored lead");
        let mut offered_result = None;
        for seed in 1..=256 {
            let mut candidate = base.clone();
            candidate.next_seed = seed;
            let state = test_app_state(candidate, None);
            let (session, _) = issue_actor_session(&state, TEST_ACTOR_ID);
            let offer = {
                let runtime = state.inner.lock().await;
                runtime
                    .state_response(Some(TEST_ACTOR_ID), &AccessContext::default())
                    .action_offers
                    .into_iter()
                    .find(|offer| offer.kind == "influence")
                    .expect("the authored Influence offer is visible")
            };
            assert_eq!(offer.label, "Ask for a local lead");
            assert_eq!(offer.command, "influence Rati");
            let response = submit_action_offer(
                ConnectInfo("127.0.0.1:43201".parse().expect("client address")),
                State(state.clone()),
                Json(ActionOfferSubmissionRequest {
                    path: "/actions/influence".to_string(),
                    offer_id: offer.offer_id,
                    composition_id: offer.composition_id,
                    kind: offer.kind,
                    rules_action: offer.rules_action,
                    operation: offer.operation,
                    rules_profile: offer.rules_profile,
                    state_revision: offer.state_revision,
                    route: offer.route,
                    target: offer.target,
                    cost: offer.cost,
                    payload: serde_json::json!({
                        "actor_id": TEST_ACTOR_ID,
                        "actor_session": session,
                        "target_actor_id": RATI_ACTOR_ID
                    }),
                }),
            )
            .await
            .0;
            let leads = state.inner.lock().await.local_leads.clone();
            if !leads.is_empty() {
                offered_result = Some((response, leads));
                break;
            }
        }
        let (offered_response, offered_leads) =
            offered_result.expect("the offer path eventually returns the authored lead");

        assert!(command_response.ok, "{command_response:?}");
        assert!(offered_response.ok, "{offered_response:?}");
        assert_eq!(
            command_response
                .action
                .as_ref()
                .map(|action| action.command.as_str()),
            Some("influence Rati")
        );
        assert_eq!(command_leads.len(), 1);
        assert_eq!(offered_leads.len(), 1);
        let command_lead = command_leads.values().next().expect("command lead");
        let offered_lead = offered_leads.values().next().expect("offered lead");
        assert_eq!(command_lead.source_offer_id, offered_lead.source_offer_id);
        assert_eq!(
            command_lead.destination_location_id,
            offered_lead.destination_location_id
        );
        assert_eq!(command_lead.destination_hint, offered_lead.destination_hint);
        assert_eq!(command_lead.source_reference, offered_lead.source_reference);
    }
}
