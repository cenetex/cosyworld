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
            .filter(|actor| Self::actor_is_active_avatar(*actor))
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

#[cfg(test)]
mod tests {
    use super::*;

    fn discover_seed_exit_for_test(
        runtime: &mut RuntimeWorld,
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
            RATI_ACTOR_ID,
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
}
