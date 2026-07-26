use super::*;

#[derive(Clone, Debug)]
pub(super) enum MovementPlan {
    Adjacent(CwAction),
    Journey {
        action: CwAction,
        mutation: ProjectionMutation,
        narration: JourneyNarrationPlan,
    },
}

impl RuntimeWorld {
    pub(super) fn first_tale_destination_reached(&self, actor_id: u64) -> bool {
        self.rpg_claims
            .contains(&first_tale_destination_claim_key(actor_id))
            || self
                .actor_by_id(actor_id)
                .is_some_and(|actor| actor.location_id == RAIN_SOFT_GARDEN_LOCATION_ID)
    }

    pub(super) fn record_first_tale_destination_arrivals(&mut self, events: &[EventView]) {
        let actor_ids = events
            .iter()
            .filter(|event| {
                event.success
                    && event.type_name == "actor.moved"
                    && (event.location_id == Some(RAIN_SOFT_GARDEN_LOCATION_ID)
                        || event.destination_location_id == Some(RAIN_SOFT_GARDEN_LOCATION_ID))
            })
            .filter_map(|event| event.actor_id)
            .collect::<BTreeSet<_>>();
        for actor_id in actor_ids {
            self.rpg_claims
                .insert(first_tale_destination_claim_key(actor_id));
        }
    }

    pub(super) fn backfill_first_tale_destination_arrivals(&mut self) {
        let mut actor_ids = self
            .event_log
            .iter()
            .filter(|event| {
                event.success
                    && event.type_name == "actor.moved"
                    && (event.location_id == Some(RAIN_SOFT_GARDEN_LOCATION_ID)
                        || event.destination_location_id == Some(RAIN_SOFT_GARDEN_LOCATION_ID))
            })
            .filter_map(|event| event.actor_id)
            .collect::<BTreeSet<_>>();
        actor_ids.extend(self.journeys.iter().filter_map(|(actor_id, journey)| {
            journey
                .path
                .get(..=journey.current_step)
                .is_some_and(|path| path.contains(&RAIN_SOFT_GARDEN_LOCATION_ID))
                .then_some(*actor_id)
        }));
        for actor_id in actor_ids {
            self.rpg_claims
                .insert(first_tale_destination_claim_key(actor_id));
        }
    }

    pub(super) fn current_reachable_offer(
        &self,
        actor_id: u64,
        offered: &RankedActionOffer,
    ) -> Option<RankedActionOffer> {
        self.current_reachable_offer_with_access(actor_id, offered, &AccessContext::default())
    }

    pub(super) fn current_reachable_offer_with_access(
        &self,
        actor_id: u64,
        offered: &RankedActionOffer,
        access: &AccessContext,
    ) -> Option<RankedActionOffer> {
        self.legal_action_candidates(Some(actor_id), access)
            .1
            .into_iter()
            .find(|candidate| {
                candidate.offer_id == offered.offer_id
                    && candidate.kind == offered.kind
                    && candidate.rules_action == offered.rules_action
                    && candidate.operation == offered.operation
                    && candidate.resolver == offered.resolver
                    && candidate.state_revision == offered.state_revision
                    && candidate.provider.id == offered.provider.id
                    && candidate.target == offered.target
                    && action_offer_is_reachable(candidate)
            })
    }

    fn current_movement_offer_for_choice(
        &self,
        actor_id: u64,
        destination_location_id: u64,
        access: &AccessContext,
    ) -> Result<RankedActionOffer, String> {
        self.legal_action_candidates(Some(actor_id), access)
            .1
            .into_iter()
            .filter(action_offer_is_reachable)
            .find(|offer| {
                offer.kind == "move"
                    && offer.target.as_ref().is_some_and(|target| {
                        target.kind == "location" && target.id == Some(destination_location_id)
                    })
            })
            .ok_or_else(|| "That Travel offer is no longer current.".to_string())
    }

    fn plan_move_offer_action(
        &self,
        actor_id: u64,
        offered: &RankedActionOffer,
        access: &AccessContext,
    ) -> Result<MovementPlan, String> {
        if offered.kind != "move" || !action_offer_is_reachable(offered) {
            return Err("Travel needs a current reachable route offer.".to_string());
        }
        let offer = self
            .current_reachable_offer_with_access(actor_id, offered, access)
            .ok_or_else(|| "That Travel offer is no longer current.".to_string())?;
        let destination_location_id = offer
            .target
            .as_ref()
            .filter(|target| target.kind == "location")
            .and_then(|target| target.id)
            .ok_or_else(|| "Travel has no exact destination.".to_string())?;
        if let Some((action, mutation, narration)) =
            self.plan_journey_move(actor_id, destination_location_id)?
        {
            return Ok(MovementPlan::Journey {
                action,
                mutation,
                narration,
            });
        }
        let action = CwAction {
            kind: CW_ACTION_MOVE,
            actor_id,
            destination_location_id,
            ..CwAction::default()
        };
        if !self.kernel_offer_allows_action(&action) {
            return Err("The kernel no longer offers that route.".to_string());
        }
        Ok(MovementPlan::Adjacent(action))
    }

    pub(super) fn plan_move_choice_action(
        &self,
        actor_id: u64,
        destination_location_id: u64,
        access: &AccessContext,
    ) -> Result<MovementPlan, String> {
        let offer =
            self.current_movement_offer_for_choice(actor_id, destination_location_id, access)?;
        self.plan_move_offer_action(actor_id, &offer, access)
    }

    fn movement_offer_exits(&self, actor_id: u64, access: &AccessContext) -> Vec<ExitView> {
        let Some(actor) = self
            .actor_by_id(actor_id)
            .filter(|actor| Self::actor_can_act(*actor))
        else {
            return Vec::new();
        };
        let journey_next_location_id = self
            .journey_view(actor_id)
            .and_then(|journey| journey.next_location_id);
        let mut exits = self
            .exit_views(actor.location_id, access)
            .into_iter()
            .filter(|exit| exit.accessible && !exit.locked)
            .collect::<Vec<_>>();
        exits.sort_by_key(|exit| {
            (
                usize::from(journey_next_location_id != Some(exit.destination_location_id)),
                exit.destination_location_id,
            )
        });
        exits
    }

    fn retarget_route_action_offer(
        &self,
        actor_id: u64,
        mut offer: RankedActionOffer,
        exit: ExitView,
    ) -> RankedActionOffer {
        let target = ActionTargetView {
            kind: "location".to_string(),
            id: Some(exit.destination_location_id),
            label: Some(exit.destination_location_name.clone()),
        };
        let verb = self.action_offer_verb(&offer.kind, actor_id);
        let fallback = if offer.kind == "flee" { "Flee" } else { "Move" };
        let label = self.action_offer_label(&offer.kind, &verb, fallback, Some(&target), None);
        let legacy_id = format!("{}:{}", offer.kind, exit.destination_location_id);
        offer.id = legacy_id.clone();
        offer.offer_id = format!(
            "{}:{}:{}",
            offer.rules_profile, offer.state_revision, legacy_id
        );
        offer.verb = verb.clone();
        offer.label = label.clone();
        offer.accessible_label =
            self.action_offer_accessible_label(&offer.kind, &verb, &label, Some(&target), None);
        offer.command = normalize_command_text(&format!(
            "{} {}",
            if offer.kind == "flee" {
                "flee to"
            } else {
                "go"
            },
            exit.destination_location_name
        ));
        offer.target = Some(target.clone());
        offer.composition_trace.target = Some(target);
        offer
    }

    pub(super) fn expand_route_action_offers(
        &self,
        actor_id: u64,
        access: &AccessContext,
        offers: Vec<RankedActionOffer>,
    ) -> Vec<RankedActionOffer> {
        let mut expanded = Vec::new();
        for offer in offers {
            if !matches!(offer.kind.as_str(), "move" | "flee") {
                expanded.push(offer);
                continue;
            }
            expanded.extend(
                self.movement_offer_exits(actor_id, access)
                    .into_iter()
                    .map(|exit| self.retarget_route_action_offer(actor_id, offer.clone(), exit)),
            );
        }
        expanded
    }

    pub(super) fn has_accessible_exit(&self, actor_id: u64, access: &AccessContext) -> bool {
        let Some(actor) = self.actor_by_id(actor_id) else {
            return false;
        };
        self.exit_views(actor.location_id, access)
            .into_iter()
            .any(|exit| exit.accessible && !exit.locked)
    }
}

fn first_tale_destination_claim_key(actor_id: u64) -> String {
    format!(
        "first_tale:v{FIRST_TALE_TRACE_SCHEMA_VERSION}:actor:{actor_id}:destination:{RAIN_SOFT_GARDEN_LOCATION_ID}"
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    fn discover_seed_exit_for_test(
        runtime: &mut RuntimeWorld,
        from_location_id: u64,
        to_location_id: u64,
    ) {
        discover_seed_exit_for_actor_for_test(
            runtime,
            RATI_ACTOR_ID,
            from_location_id,
            to_location_id,
        );
    }

    fn discover_seed_exit_for_actor_for_test(
        runtime: &mut RuntimeWorld,
        actor_id: u64,
        from_location_id: u64,
        to_location_id: u64,
    ) {
        let destination = runtime
            .location_name(to_location_id)
            .unwrap_or_else(|| format!("Location {to_location_id}"));
        let id = seed_exit_discovered_tag_id(from_location_id, to_location_id);
        runtime.tags.insert(
            id.clone(),
            RpgTagState {
                id,
                scope: "room".to_string(),
                scope_id: from_location_id,
                label: format!("path to {destination}"),
                kind: "discovery".to_string(),
                active: true,
                source_event_seq: None,
                expires: None,
            },
        );
        runtime.remember_search_discovery(
            actor_id,
            from_location_id,
            SEARCH_MEMORY_KIND_SEED_EXIT,
            to_location_id,
            &seed_exit_search_memory_subject_key(from_location_id, to_location_id),
        );
    }

    fn discover_seed_exit_pair_for_test(
        runtime: &mut RuntimeWorld,
        from_location_id: u64,
        to_location_id: u64,
    ) {
        discover_seed_exit_for_test(runtime, from_location_id, to_location_id);
        discover_seed_exit_for_test(runtime, to_location_id, from_location_id);
    }

    #[test]
    fn movement_offers_bind_every_accessible_route_for_every_controller() {
        let mut runtime = RuntimeWorld::seeded();
        runtime
            .world
            .actors
            .iter_mut()
            .find(|actor| actor.id == RATI_ACTOR_ID)
            .expect("route actor exists")
            .location_id = RAIN_SOFT_GARDEN_LOCATION_ID;
        runtime
            .actor_autonomy
            .entry(RATI_ACTOR_ID)
            .or_default()
            .control_mode = ActorControlMode::DirectInput;
        discover_seed_exit_pair_for_test(
            &mut runtime,
            RAIN_SOFT_GARDEN_LOCATION_ID,
            COSY_COTTAGE_LOCATION_ID,
        );
        discover_seed_exit_pair_for_test(
            &mut runtime,
            RAIN_SOFT_GARDEN_LOCATION_ID,
            MOONLIT_TRAIL_LOCATION_ID,
        );
        let access = AccessContext::default();
        let exits = runtime.movement_offer_exits(RATI_ACTOR_ID, &access);
        assert!(
            exits.len() >= 2,
            "the route parity fixture needs at least two accessible exits"
        );
        let expected_destination_ids = exits
            .iter()
            .map(|exit| exit.destination_location_id)
            .collect::<Vec<_>>();

        let direct_offers = runtime
            .legal_action_candidates(Some(RATI_ACTOR_ID), &access)
            .1
            .into_iter()
            .filter(|offer| offer.kind == "move")
            .collect::<Vec<_>>();
        assert_eq!(direct_offers.len(), expected_destination_ids.len());
        assert_eq!(
            direct_offers
                .iter()
                .filter_map(|offer| offer.target.as_ref().and_then(|target| target.id))
                .collect::<Vec<_>>(),
            expected_destination_ids
        );
        assert_eq!(
            direct_offers
                .iter()
                .map(|offer| offer.offer_id.as_str())
                .collect::<BTreeSet<_>>()
                .len(),
            direct_offers.len(),
            "every destination has a unique offer identity"
        );
        assert!(direct_offers.iter().all(|offer| {
            offer.target.as_ref().is_some_and(|target| {
                target.kind == "location"
                    && target
                        .label
                        .as_deref()
                        .is_some_and(|label| offer.label.contains(label))
            })
        }));
        assert!(
            direct_offers.iter().all(|offer| {
                offer.target.as_ref().and_then(|target| target.id) != Some(OLD_OAK_TREE_LOCATION_ID)
            }),
            "an undiscovered route cannot enter the shared offer surface"
        );
        assert!(runtime
            .plan_move_choice_action(RATI_ACTOR_ID, OLD_OAK_TREE_LOCATION_ID, &access)
            .is_err());

        runtime
            .actor_autonomy
            .entry(RATI_ACTOR_ID)
            .or_default()
            .control_mode = ActorControlMode::LocalAi;
        let inference_offers = runtime
            .legal_action_candidates(Some(RATI_ACTOR_ID), &access)
            .1
            .into_iter()
            .filter(|offer| offer.kind == "move")
            .collect::<Vec<_>>();
        assert_eq!(
            serde_json::to_value(&inference_offers).expect("inference route offers serialize"),
            serde_json::to_value(&direct_offers).expect("direct route offers serialize"),
            "controller mode cannot change route enumeration or targets"
        );

        let destination_location_id = exits
            .iter()
            .find(|exit| exit.distance <= 1)
            .map(|exit| exit.destination_location_id)
            .expect("an adjacent route is available");
        let offer = direct_offers
            .iter()
            .find(|offer| {
                offer.target.as_ref().and_then(|target| target.id) == Some(destination_location_id)
            })
            .expect("the adjacent destination has an exact offer")
            .clone();
        let action = match runtime
            .plan_move_offer_action(RATI_ACTOR_ID, &offer, &access)
            .expect("the exact route offer plans")
        {
            MovementPlan::Adjacent(action) => action,
            MovementPlan::Journey { .. } => panic!("adjacent route should not create a journey"),
        };
        assert_eq!(action.kind, CW_ACTION_MOVE);
        assert_eq!(action.destination_location_id, destination_location_id);
        let inference_action = runtime
            .fresh_resident_autonomy_action(
                runtime
                    .actor_by_id(RATI_ACTOR_ID)
                    .expect("route actor exists"),
                action,
            )
            .expect("inference accepts the same exact route");
        assert_eq!(inference_action.kind, action.kind);
        assert_eq!(
            inference_action.destination_location_id,
            action.destination_location_id
        );

        let trace = runtime.resident_decision_trace(&ResidentAutonomyCandidate {
            actor_id: RATI_ACTOR_ID,
            rank: 60,
            score: 0,
            record: JournalRecord::new(action, 97_200)
                .into_actor_consequence(runtime.world.tick, None),
        });
        assert_eq!(
            trace.choice.offer_id.as_deref(),
            Some(offer.offer_id.as_str())
        );
        assert!(trace.candidates.iter().any(|candidate| {
            candidate.selected
                && candidate.target.as_ref().is_some_and(|target| {
                    target.kind == "location" && target.id == Some(destination_location_id)
                })
        }));

        let mut forged_offer = offer.clone();
        forged_offer
            .target
            .as_mut()
            .expect("route target exists")
            .id = Some(999_999);
        assert!(runtime
            .plan_move_offer_action(RATI_ACTOR_ID, &forged_offer, &access)
            .is_err());

        assert_eq!(
            runtime
                .apply_journal_record(&JournalRecord::new(action, 97_201))
                .0,
            CW_OK
        );
        assert!(runtime
            .plan_move_offer_action(RATI_ACTOR_ID, &offer, &access)
            .is_err());

        let moved_actor = runtime
            .actor_by_id(RATI_ACTOR_ID)
            .expect("route actor moved");
        let reverse_offer = runtime
            .legal_action_candidates(Some(RATI_ACTOR_ID), &access)
            .1
            .into_iter()
            .find(|candidate| {
                candidate.kind == "move"
                    && candidate
                        .target
                        .as_ref()
                        .is_some_and(|target| target.id == Some(RAIN_SOFT_GARDEN_LOCATION_ID))
            })
            .expect("the reverse route is offered");
        let reverse_action = match runtime
            .plan_move_offer_action(RATI_ACTOR_ID, &reverse_offer, &access)
            .expect("the reverse route is mechanically legal")
        {
            MovementPlan::Adjacent(action) => action,
            MovementPlan::Journey { .. } => panic!("reverse route should remain adjacent"),
        };
        assert!(
            runtime
                .fresh_resident_autonomy_action(moved_actor, reverse_action)
                .is_none(),
            "the exact reverse offer cannot bypass immediate-return protection"
        );
    }

    #[test]
    fn first_tale_destination_progress_survives_snapshot_and_legacy_backfill() {
        let actor_id = 5000;
        let mut runtime = RuntimeWorld::seeded();
        create_test_human(
            &mut runtime,
            actor_id,
            COSY_COTTAGE_LOCATION_ID,
            "Returning Pathfinder",
        );
        runtime
            .listen_attempt_claims
            .insert(listen_attempt_claim_key(actor_id, COSY_COTTAGE_LOCATION_ID));
        let arrival = runtime.append_actor_moved_event(
            actor_id,
            COSY_COTTAGE_LOCATION_ID,
            RAIN_SOFT_GARDEN_LOCATION_ID,
        );
        runtime.record_first_tale_destination_arrivals(&[arrival]);
        runtime
            .world
            .actors
            .iter_mut()
            .find(|actor| actor.id == actor_id)
            .expect("First Tale actor exists")
            .location_id = MOONLIT_TRAIL_LOCATION_ID;
        assert!(runtime.first_tale_view(actor_id).is_none());

        let restored = RuntimeSnapshot::from_runtime(&runtime)
            .into_runtime()
            .expect("First Tale progress survives snapshot restore");
        assert!(restored.first_tale_view(actor_id).is_none());

        let mut legacy_snapshot = RuntimeSnapshot::from_runtime(&runtime);
        legacy_snapshot
            .rpg_claims
            .remove(&first_tale_destination_claim_key(actor_id));
        let backfilled = legacy_snapshot
            .into_runtime()
            .expect("legacy arrival progress backfills from movement");
        assert!(backfilled.first_tale_view(actor_id).is_none());
        assert!(backfilled.first_tale_destination_reached(actor_id));
    }

    async fn submit_offer_for_test(
        state: &AppState,
        actor_session: &str,
        path: &str,
        offer: RankedActionOffer,
        payload: serde_json::Value,
    ) -> ActionResponse {
        let mut payload = payload.as_object().cloned().unwrap_or_default();
        payload.insert(
            "actor_session".to_string(),
            serde_json::Value::String(actor_session.to_string()),
        );
        payload.insert(
            "wallet_address".to_string(),
            serde_json::Value::String("dev-wallet".to_string()),
        );
        submit_action_offer(
            ConnectInfo("127.0.0.1:44030".parse().expect("client address")),
            State(state.clone()),
            Json(ActionOfferSubmissionRequest {
                path: path.to_string(),
                offer_id: offer.offer_id,
                composition_id: offer.composition_id,
                kind: offer.kind,
                rules_action: offer.rules_action,
                operation: offer.operation,
                rules_profile: offer.rules_profile,
                state_revision: offer.state_revision,
                target: offer.target,
                cost: offer.cost,
                payload: serde_json::Value::Object(payload),
            }),
        )
        .await
        .0
    }

    #[tokio::test]
    async fn current_offers_traverse_a_generated_pathway_through_completion() {
        let actor_id = 5000;
        let mut runtime = RuntimeWorld::seeded();
        create_test_human(
            &mut runtime,
            actor_id,
            COSY_COTTAGE_LOCATION_ID,
            "Offer Pathfinder",
        );
        runtime
            .listen_attempt_claims
            .insert(listen_attempt_claim_key(actor_id, COSY_COTTAGE_LOCATION_ID));
        runtime.callings.insert(
            actor_id,
            CallingState {
                actor_id,
                statement: EXPLORER_CALLING_STATEMENT.to_string(),
                source_event_seq: None,
            },
        );
        discover_seed_exit_for_actor_for_test(
            &mut runtime,
            actor_id,
            COSY_COTTAGE_LOCATION_ID,
            RAIN_SOFT_GARDEN_LOCATION_ID,
        );
        discover_seed_exit_for_actor_for_test(
            &mut runtime,
            actor_id,
            RAIN_SOFT_GARDEN_LOCATION_ID,
            MOONLIT_TRAIL_LOCATION_ID,
        );
        let state = test_app_state(runtime, None);
        let (actor_session, _) = issue_actor_session(&state, actor_id);

        let current_offer = |runtime: &RuntimeWorld, kind: &str, target_id: u64| {
            let view = runtime.state_response(Some(actor_id), &AccessContext::default());
            let offer = view
                .action_offers
                .into_iter()
                .find(|offer| {
                    offer.kind == kind
                        && offer
                            .target
                            .as_ref()
                            .is_some_and(|target| target.id == Some(target_id))
                })
                .unwrap_or_else(|| panic!("{kind} offer for {target_id} should be current"));
            assert!(
                view.action_hand
                    .entries
                    .iter()
                    .any(|entry| entry.offer_id == offer.offer_id),
                "{kind} offer for {target_id} should use the browser hand identity"
            );
            offer
        };

        {
            let runtime = state.inner.lock().await;
            assert_eq!(
                runtime
                    .first_tale_view(actor_id)
                    .expect("the discovered lead is visible")
                    .phase,
                "follow_lead"
            );
        }
        let garden_offer = {
            let runtime = state.inner.lock().await;
            current_offer(&runtime, "move", RAIN_SOFT_GARDEN_LOCATION_ID)
        };
        let garden_response = submit_offer_for_test(
            &state,
            &actor_session,
            "/actions/move",
            garden_offer,
            serde_json::json!({
                "actor_id": actor_id,
                "destination_location_id": RAIN_SOFT_GARDEN_LOCATION_ID,
            }),
        )
        .await;
        assert!(garden_response.ok, "{garden_response:?}");
        {
            let runtime = state.inner.lock().await;
            assert_eq!(
                runtime
                    .first_tale_view(actor_id)
                    .expect("arrival advances the First Tale")
                    .phase,
                "contribute"
            );
        }

        let mut final_travel_offer = None;
        let first_scout = {
            let runtime = state.inner.lock().await;
            current_offer(&runtime, "explore_path", MOONLIT_TRAIL_LOCATION_ID)
        };
        let first_scout_response = submit_offer_for_test(
            &state,
            &actor_session,
            "/actions/explore-path",
            first_scout,
            serde_json::json!({ "actor_id": actor_id }),
        )
        .await;
        assert!(first_scout_response.ok, "{first_scout_response:?}");
        let pathway = {
            let runtime = state.inner.lock().await;
            runtime.journeys[&actor_id].path.clone()
        };

        for step in 1..=3 {
            let next_location_id = {
                let runtime = state.inner.lock().await;
                runtime.journeys[&actor_id].path[step]
            };
            let travel = {
                let runtime = state.inner.lock().await;
                current_offer(&runtime, "move", next_location_id)
            };
            if step == 3 {
                final_travel_offer = Some(travel.clone());
                let mut runtime = state.inner.lock().await;
                runtime.append_async_job_event(
                    "pathway.refined",
                    RATI_ACTOR_ID,
                    None,
                    Some("unrelated background refinement".to_string()),
                );
                runtime.append_async_job_event(
                    "pathway.refined",
                    RATI_ACTOR_ID,
                    None,
                    Some("another unrelated background refinement".to_string()),
                );
            }
            let travel_response = submit_offer_for_test(
                &state,
                &actor_session,
                "/actions/move",
                travel,
                serde_json::json!({
                    "actor_id": actor_id,
                    "destination_location_id": next_location_id,
                }),
            )
            .await;
            assert!(travel_response.ok, "step {step}: {travel_response:?}");
            {
                let runtime = state.inner.lock().await;
                assert!(
                    runtime.first_tale_view(actor_id).is_none(),
                    "the Garden contribution is hidden when it is not locally actionable"
                );
            }
            if step < 3 {
                let scout = {
                    let runtime = state.inner.lock().await;
                    current_offer(&runtime, "explore_path", MOONLIT_TRAIL_LOCATION_ID)
                };
                let scout_response = submit_offer_for_test(
                    &state,
                    &actor_session,
                    "/actions/explore-path",
                    scout,
                    serde_json::json!({ "actor_id": actor_id }),
                )
                .await;
                assert!(scout_response.ok, "step {step}: {scout_response:?}");
            }
        }

        let runtime = state.inner.lock().await;
        assert_eq!(
            runtime.actor_by_id(actor_id).map(|actor| actor.location_id),
            Some(MOONLIT_TRAIL_LOCATION_ID)
        );
        assert!(!runtime.journeys.contains_key(&actor_id));
        assert!(runtime.event_log.iter().any(|event| {
            event.type_name == "journey.completed" && event.actor_id == Some(actor_id)
        }));
        drop(runtime);

        for destination_location_id in pathway[..pathway.len() - 1].iter().rev().copied() {
            let reverse_offer = {
                let runtime = state.inner.lock().await;
                current_offer(&runtime, "move", destination_location_id)
            };
            let reverse_response = submit_offer_for_test(
                &state,
                &actor_session,
                "/actions/move",
                reverse_offer,
                serde_json::json!({
                    "actor_id": actor_id,
                    "destination_location_id": destination_location_id,
                }),
            )
            .await;
            assert!(reverse_response.ok, "{reverse_response:?}");
        }
        {
            let runtime = state.inner.lock().await;
            assert_eq!(
                runtime
                    .first_tale_view(actor_id)
                    .expect("the Garden contribution returns on backtracking")
                    .phase,
                "contribute"
            );
        }

        let stale_retry = submit_offer_for_test(
            &state,
            &actor_session,
            "/actions/move",
            final_travel_offer.expect("final travel offer was captured"),
            serde_json::json!({
                "actor_id": actor_id,
                "destination_location_id": MOONLIT_TRAIL_LOCATION_ID,
            }),
        )
        .await;
        assert!(!stale_retry.ok);
        assert_eq!(stale_retry.status, 409);
    }
}
