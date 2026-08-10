use super::*;

pub(super) const CAMP_SHELTER_ITEM_CAPABILITY: &str = "camp_shelter";
const LODGING_FEATURE_KEY: &str = "lodging";
const MISSING_CAMP_SHELTER_REASON: &str = "Equip a shelter before resting out here.";

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
struct RestPlaceEligibility {
    sanctuary: bool,
    lodging: bool,
    frontier: bool,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub(super) struct RestEntitlement {
    pub(super) grade: u8,
    pub(super) unavailable_reason: Option<String>,
}

fn derive_rest_grade(place: RestPlaceEligibility, has_equipped_shelter: bool) -> u8 {
    if place.sanctuary {
        CW_REST_GRADE_HEARTH
    } else if place.lodging {
        CW_REST_GRADE_LODGED
    } else if place.frontier && has_equipped_shelter {
        CW_REST_GRADE_CAMP
    } else {
        CW_REST_GRADE_NONE
    }
}

impl RuntimeWorld {
    fn location_is_rest_sanctuary(&self, location_id: u64) -> bool {
        self.location_has_building_capability(location_id, "sanctuary")
            || self
                .room_sheets
                .get(&location_id)
                .map(|sheet| room_sheet_zone(sheet) == ZONE_SANCTUARY)
                .unwrap_or_else(|| {
                    self.generated_pathway_for_location(location_id).is_none()
                        && !self.generated_places.contains_key(&location_id)
                        && default_zone_for_scope("room", location_id) == ZONE_SANCTUARY
                })
    }

    fn location_has_lodging_feature(&self, location_id: u64) -> bool {
        self.room_features(location_id)
            .into_iter()
            .any(|feature| command_key(&feature.key) == LODGING_FEATURE_KEY)
    }

    fn actor_has_equipped_item_capability(&self, actor_id: u64, capability: &str) -> bool {
        self.actor_held_items(actor_id).into_iter().any(|item| {
            item.role == CW_ITEM_ROLE_TOOL
                && item.zone == CW_CARD_ZONE_EQUIPPED
                && item.container_item_id == 0
                && self
                    .seed_item_contract_for_instance(item.id)
                    .is_some_and(|contract| {
                        contract
                            .capabilities
                            .iter()
                            .any(|declared| declared == capability)
                    })
        })
    }

    pub(super) fn rest_entitlement(&self, actor_id: u64) -> RestEntitlement {
        let Some(actor) = self
            .actor_by_id(actor_id)
            .filter(|actor| Self::actor_can_act(*actor))
        else {
            return RestEntitlement {
                grade: CW_REST_GRADE_NONE,
                unavailable_reason: Some("Rest requires an active avatar.".to_string()),
            };
        };
        let place = RestPlaceEligibility {
            sanctuary: self.location_is_rest_sanctuary(actor.location_id),
            lodging: self.location_has_lodging_feature(actor.location_id),
            frontier: self.location_is_frontier(actor.location_id),
        };
        let grade = derive_rest_grade(
            place,
            self.actor_has_equipped_item_capability(actor_id, CAMP_SHELTER_ITEM_CAPABILITY),
        );
        RestEntitlement {
            grade,
            unavailable_reason: (grade == CW_REST_GRADE_NONE && place.frontier)
                .then(|| MISSING_CAMP_SHELTER_REASON.to_string()),
        }
    }

    pub(super) fn rest_available(&self, actor_id: u64) -> bool {
        self.rest_entitlement(actor_id).grade != CW_REST_GRADE_NONE
    }

    pub(super) fn rest_offer_unavailable_reason(&self, actor_id: u64) -> Option<String> {
        Some(self.rest_entitlement(actor_id))
            .filter(|entitlement| entitlement.grade == CW_REST_GRADE_NONE)
            .and_then(|entitlement| entitlement.unavailable_reason)
    }

    fn item_is_rest_refreshable(&self, item: CwItem, actor_id: u64, grade: u8) -> bool {
        if item.holder_actor_id != actor_id
            || item.zone != CW_CARD_ZONE_EXHAUSTED
            || item.charges != 0
            || item.max_charges == 0
            || item.recovery != CW_ITEM_RECOVERY_REST
        {
            return false;
        }
        if matches!(grade, CW_REST_GRADE_CAMP | CW_REST_GRADE_LODGED) {
            return item.role == CW_ITEM_ROLE_SPELL;
        }
        grade == CW_REST_GRADE_HEARTH
            && matches!(
                item.role,
                CW_ITEM_ROLE_SPELL | CW_ITEM_ROLE_SKILL_CHARM | CW_ITEM_ROLE_RELIC
            )
    }

    pub(super) fn rest_has_recovery_target(&self, actor_id: u64) -> bool {
        let grade = self.rest_entitlement(actor_id).grade;
        grade != CW_REST_GRADE_NONE
            && (self.tired_tag_active(actor_id)
                || (grade >= CW_REST_GRADE_LODGED && self.trained_since_rest_tag_active(actor_id))
                || (grade == CW_REST_GRADE_HEARTH
                    && self.frontier_travel_since_rest_count(actor_id) > 0)
                || self.world.items[..self.world.item_count]
                    .iter()
                    .copied()
                    .any(|item| self.item_is_rest_refreshable(item, actor_id, grade)))
    }

    pub(super) fn plan_rest_action(
        &self,
        actor_id: u64,
    ) -> Result<(CwAction, Vec<ProjectionMutation>), String> {
        let entitlement = self.rest_entitlement(actor_id);
        if entitlement.grade == CW_REST_GRADE_NONE {
            return Err(entitlement
                .unavailable_reason
                .unwrap_or_else(|| "Rest is not available here.".to_string()));
        }
        let action = rest_action_from_server_entitlement(
            actor_id,
            RestActionRequest {
                requested_grade: entitlement.grade,
            },
            entitlement.grade,
        )
        .ok_or_else(|| "Rest could not resolve its recovery grade.".to_string())?;
        let location_id = self
            .actor_by_id(actor_id)
            .map(|actor| actor.location_id)
            .ok_or_else(|| "Rest requires an active avatar.".to_string())?;
        let mut mutations = Vec::new();
        if self.tired_tag_active(actor_id) {
            mutations.push(ProjectionMutation::ClearTag {
                tag_id: tired_tag_id(actor_id),
                reason: "rest".to_string(),
            });
        }
        if entitlement.grade >= CW_REST_GRADE_LODGED && self.trained_since_rest_tag_active(actor_id)
        {
            mutations.push(ProjectionMutation::ClearTag {
                tag_id: trained_since_rest_tag_id(actor_id),
                reason: "rest".to_string(),
            });
        }
        if entitlement.grade == CW_REST_GRADE_HEARTH {
            mutations.extend(
                self.frontier_travel_since_rest_tag_ids(actor_id)
                    .into_iter()
                    .map(|tag_id| ProjectionMutation::ClearTag {
                        tag_id,
                        reason: "rest".to_string(),
                    }),
            );
        }
        if entitlement.grade == CW_REST_GRADE_CAMP {
            if let Some(clock_id) = self
                .active_danger_clock_id_for_location(location_id)
                .filter(|clock_id| self.clock_is_frontier(clock_id))
            {
                mutations.push(ProjectionMutation::AdvanceClock {
                    clock_id,
                    amount: 1,
                    reason: "rest".to_string(),
                });
            }
        }
        Ok((action, mutations))
    }
}

pub(super) fn declared_item_recovery_profile(
    initial_charges: u8,
    mechanics: Option<&SeedPlayableItemMechanics>,
) -> (u8, u8, u8) {
    let ready_zone = match mechanics.map(|value| value.equipment_profile.as_str()) {
        Some("spell_deck") => CW_CARD_ZONE_SPELL_DECK,
        Some("bracelet" | "weapon_hand" | "container_harness") => CW_CARD_ZONE_EQUIPPED,
        _ => CW_CARD_ZONE_CARRIED,
    };
    let Some(mechanics) = mechanics else {
        return (initial_charges.max(1), CW_ITEM_RECOVERY_NONE, ready_zone);
    };
    let bound_effect = mechanics.magic_effect.as_deref().and_then(|effect_id| {
        active_rules_bundle()
            .resources
            .magic_effects
            .iter()
            .find(|effect| effect.id == effect_id)
    });
    let max_charges = bound_effect
        .map(|effect| effect.uses)
        .unwrap_or(mechanics.uses)
        .max(initial_charges)
        .max(1);
    let recovery_name = bound_effect
        .map(|effect| effect.recovery.as_str())
        .unwrap_or(mechanics.recovery.as_str());
    let recovery = if mechanics.exhaustion == "consume_charge" && recovery_name == "rest" {
        CW_ITEM_RECOVERY_REST
    } else {
        CW_ITEM_RECOVERY_NONE
    };
    (max_charges, recovery, ready_zone)
}

pub(super) async fn rest(
    ConnectInfo(client_addr): ConnectInfo<SocketAddr>,
    State(state): State<AppState>,
    Json(payload): Json<ActorRequest>,
) -> Json<ActionResponse> {
    if !allow_actor_mutation(
        &state,
        client_addr,
        payload.actor_id,
        "action-actor",
        GENERAL_ACTION_LIMIT,
    ) {
        return action_rate_limited_response();
    }

    let mut runtime = state.inner.lock().await;
    if !client_actor_authorized_for_state(
        &runtime,
        &state,
        payload.actor_id,
        payload.actor_session.as_deref(),
    ) {
        return client_actor_rejected_response();
    }
    let turn_location_id = runtime
        .actor_by_id(payload.actor_id)
        .map(|actor| actor.location_id);
    if let Some(response) = actor_turn_rejection(&state, &runtime, payload.actor_id) {
        return response;
    }
    let dream_job = runtime
        .rest_has_recovery_target(payload.actor_id)
        .then(|| runtime.avatar_reflection_job(payload.actor_id, AvatarReflectionKind::Dream))
        .flatten();
    let Ok((action, mutations)) = runtime.plan_rest_action(payload.actor_id) else {
        return Json(ActionResponse {
            ok: false,
            status: 400,
            events: Vec::new(),
        });
    };
    let mut record = JournalRecord::new(action, runtime.next_seed_value()).into_player_card();
    record.bind_offer_kind("rest");
    record.projection_mutations.extend(mutations);
    if let Some(job) = dream_job.clone() {
        attach_avatar_reflection_check(&mut record, job);
    }

    let Ok((status, mut events)) = commit_journal_record(&state, &mut runtime, record) else {
        return Json(ActionResponse {
            ok: false,
            status: 500,
            events: Vec::new(),
        });
    };
    let ripple_reply_plan = advance_turn_and_capture_player_tick_observation(
        &state,
        &mut runtime,
        turn_location_id,
        payload.actor_id,
        status,
        &mut events,
    );
    drop(runtime);

    broadcast_events(&state, &events);
    if let Some(plan) = ripple_reply_plan {
        schedule_player_tick_observation(&state, plan);
    }
    if status == CW_OK {
        if let Some(job) = dream_job {
            schedule_avatar_reflection(&state, job, &events);
        }
    }
    Json(ActionResponse {
        ok: status == CW_OK,
        status,
        events,
    })
}

#[cfg(test)]
mod tests {
    use super::super::*;
    use super::{
        derive_rest_grade, RestPlaceEligibility, LODGING_FEATURE_KEY, MISSING_CAMP_SHELTER_REASON,
    };

    const CORE_LODGING_LOCATION_ID: u64 = 4;
    const OTHER_FRONTIER_LOCATION_ID: u64 = 34;
    const SECOND_FRONTIER_LOCATION_ID: u64 = 42;
    const OTHER_FRONTIER_DANGER_CLOCK_ID: &str = "goblin-cave.leverage";

    fn mark_actor_tired(runtime: &mut RuntimeWorld, actor_id: u64) {
        let tag_id = tired_tag_id(actor_id);
        runtime.tags.insert(
            tag_id.clone(),
            RpgTagState {
                id: tag_id,
                scope: "actor".to_string(),
                scope_id: actor_id,
                label: "tired".to_string(),
                kind: "condition".to_string(),
                active: true,
                source_event_seq: None,
                expires: Some("after_rest".to_string()),
            },
        );
    }

    #[test]
    fn grade_derivation_covers_hearth_lodged_camp_and_not_offered() {
        let sanctuary = RestPlaceEligibility {
            sanctuary: true,
            lodging: false,
            frontier: false,
        };
        let lodging = RestPlaceEligibility {
            sanctuary: false,
            lodging: true,
            frontier: true,
        };
        let frontier = RestPlaceEligibility {
            sanctuary: false,
            lodging: false,
            frontier: true,
        };
        assert_eq!(derive_rest_grade(sanctuary, false), CW_REST_GRADE_HEARTH);
        assert_eq!(derive_rest_grade(lodging, false), CW_REST_GRADE_LODGED);
        assert_eq!(derive_rest_grade(frontier, true), CW_REST_GRADE_CAMP);
        assert_eq!(derive_rest_grade(frontier, false), CW_REST_GRADE_NONE);
        assert_eq!(
            derive_rest_grade(
                RestPlaceEligibility {
                    sanctuary: true,
                    lodging: true,
                    frontier: true,
                },
                true,
            ),
            CW_REST_GRADE_HEARTH,
            "sanctuary precedence is stable"
        );
    }

    #[test]
    fn zero_orb_core_route_reaches_lodging_and_rests_at_lodged_grade() {
        let mut runtime = RuntimeWorld::seeded();
        create_test_human(
            &mut runtime,
            5000,
            COSY_COTTAGE_LOCATION_ID,
            "Lodging Tester",
        );
        runtime.orb_balances.insert(5000, 0);

        let access = AccessContext::default();
        assert!(location_access_allowed(CORE_LODGING_LOCATION_ID, &access));
        let access_rule = location_access_rule(CORE_LODGING_LOCATION_ID);
        assert_eq!(access_rule.required_grant_id, None);
        assert_eq!(access_rule.required_card_id, None);
        let mut discovery_record = JournalRecord::new(
            CwAction {
                kind: CW_ACTION_NONE,
                actor_id: 5000,
                location_id: COSY_COTTAGE_LOCATION_ID,
                ..CwAction::default()
            },
            18_599,
        );
        discovery_record
            .projection_mutations
            .push(ProjectionMutation::DiscoverSeedExit {
                from_location_id: COSY_COTTAGE_LOCATION_ID,
                to_location_id: CORE_LODGING_LOCATION_ID,
                reason: "search_feature".to_string(),
            });
        assert_eq!(runtime.apply_journal_record(&discovery_record).0, CW_OK);
        let cottage_state = runtime.state_response(Some(5000), &access);
        assert!(cottage_state.action_offers.iter().any(|offer| {
            offer.kind == "move"
                && offer.target.as_ref().and_then(|target| target.id)
                    == Some(CORE_LODGING_LOCATION_ID)
        }));

        let move_record = JournalRecord::new(
            CwAction {
                kind: CW_ACTION_MOVE,
                actor_id: 5000,
                destination_location_id: CORE_LODGING_LOCATION_ID,
                ..CwAction::default()
            },
            18_600,
        );
        let (status, move_events) = runtime.apply_journal_record(&move_record);
        assert_eq!(status, CW_OK);
        assert!(move_events.iter().any(|event| {
            event.type_name == "actor.moved"
                && event.destination_location_id == Some(CORE_LODGING_LOCATION_ID)
        }));
        assert_eq!(
            runtime
                .actor_by_id(5000)
                .expect("lodging traveler exists")
                .location_id,
            CORE_LODGING_LOCATION_ID
        );
        let lodging_feature = runtime
            .room_features(CORE_LODGING_LOCATION_ID)
            .into_iter()
            .find(|feature| command_key(&feature.key) == LODGING_FEATURE_KEY)
            .expect("Core inn declares lodging");
        assert_eq!(
            lodging_feature
                .lodging
                .as_ref()
                .map(|lodging| lodging.gate.kind.as_str()),
            Some("open")
        );

        mark_actor_tired(&mut runtime, 5000);
        let trained_id = trained_since_rest_tag_id(5000);
        runtime.tags.insert(
            trained_id.clone(),
            RpgTagState {
                id: trained_id,
                scope: "actor".to_string(),
                scope_id: 5000,
                label: "trained".to_string(),
                kind: "memory".to_string(),
                active: true,
                source_event_seq: None,
                expires: Some("after_rest".to_string()),
            },
        );
        assert_eq!(runtime.rest_entitlement(5000).grade, CW_REST_GRADE_LODGED);
        let lodging_state = runtime.state_response(Some(5000), &access);
        assert!(lodging_state
            .action_hand
            .entries
            .iter()
            .any(|entry| entry.kind == "rest"));
        let (action, mutations) = runtime
            .plan_rest_action(5000)
            .expect("Core lodging grants Rest");
        assert_eq!(action.rest.requested_grade, CW_REST_GRADE_LODGED);
        assert_eq!(action.rest.entitled_grade, CW_REST_GRADE_LODGED);
        assert!(mutations.iter().any(|mutation| matches!(
            mutation,
            ProjectionMutation::ClearTag { tag_id, .. }
                if tag_id == &trained_since_rest_tag_id(5000)
        )));
        assert!(!mutations
            .iter()
            .any(|mutation| matches!(mutation, ProjectionMutation::AdvanceClock { .. })));

        let mut rest_record = JournalRecord::new(action, 18_601);
        rest_record.projection_mutations.extend(mutations);
        let (status, _) = runtime.apply_journal_record(&rest_record);
        assert_eq!(status, CW_OK);
        assert!(!runtime.tired_tag_active(5000));
        assert_eq!(runtime.orb_balance(5000), 0);
    }

    #[test]
    fn equipped_declared_shelter_enables_camp_without_a_location_allowlist() {
        let mut runtime = RuntimeWorld::seeded();
        create_test_human(
            &mut runtime,
            5000,
            OTHER_FRONTIER_LOCATION_ID,
            "Shelter Tester",
        );
        mark_actor_tired(&mut runtime, 5000);
        let tonic = runtime
            .world
            .items
            .iter_mut()
            .take(runtime.world.item_count)
            .find(|item| item.id == HEARTH_TONIC_ITEM_ID)
            .expect("Hearth Tonic exists");
        tonic.location_id = 0;
        tonic.holder_actor_id = 5000;
        tonic.zone = CW_CARD_ZONE_CARRIED;
        tonic.container_item_id = 0;
        tonic.charges = 1;

        let contract = runtime
            .seed_item_contract_for_instance(HEARTH_TONIC_ITEM_ID)
            .expect("Hearth Tonic has an authored item contract");
        assert_eq!(contract.role, "tool");
        assert_eq!(
            contract.capabilities,
            vec![CAMP_SHELTER_ITEM_CAPABILITY.to_string()]
        );
        assert_eq!(
            runtime.rest_entitlement(5000).grade,
            CW_REST_GRADE_NONE,
            "carried shelter is not Camp"
        );
        let blocked_state = runtime.state_response(Some(5000), &AccessContext::default());
        let blocked_offer = blocked_state
            .action_offers
            .iter()
            .find(|offer| offer.kind == "rest")
            .expect("the authoritative offer surface explains blocked Rest");
        assert!(blocked_offer.disabled);
        assert_eq!(
            blocked_offer.disabled_reason.as_deref(),
            Some(MISSING_CAMP_SHELTER_REASON)
        );
        let blocked_decision = blocked_state
            .inspector
            .offer_decisions
            .iter()
            .find(|decision| decision.kind == "rest")
            .expect("the hand inspector explains blocked Rest");
        assert!(!blocked_decision.available);
        assert_eq!(blocked_decision.reason, MISSING_CAMP_SHELTER_REASON);
        assert!(!blocked_state
            .action_hand
            .entries
            .iter()
            .any(|entry| entry.kind == "rest"));

        let equip_events =
            runtime.set_item_equipped(5000, HEARTH_TONIC_ITEM_ID, true, "test_shelter");
        assert!(equip_events
            .iter()
            .any(|event| event.type_name == "item.equipped"));
        assert_eq!(runtime.rest_entitlement(5000).grade, CW_REST_GRADE_CAMP);
        let actor = runtime
            .world
            .actors
            .iter_mut()
            .take(runtime.world.actor_count)
            .find(|actor| actor.id == 5000)
            .expect("test actor exists");
        actor.location_id = SECOND_FRONTIER_LOCATION_ID;
        assert_eq!(
            runtime.rest_entitlement(5000).grade,
            CW_REST_GRADE_CAMP,
            "the capability works in a second frontier room"
        );
        let actor = runtime
            .world
            .actors
            .iter_mut()
            .take(runtime.world.actor_count)
            .find(|actor| actor.id == 5000)
            .expect("test actor exists");
        actor.location_id = OTHER_FRONTIER_LOCATION_ID;

        let offered_state = runtime.state_response(Some(5000), &AccessContext::default());
        let rest_offer = offered_state
            .action_offers
            .iter()
            .find(|offer| offer.kind == "rest")
            .expect("equipped shelter exposes Rest");
        assert!(!rest_offer.disabled);
        assert!(rest_offer
            .risk
            .as_deref()
            .is_some_and(|risk| risk.contains("trouble may draw nearer")));
        let (action, mutations) = runtime
            .plan_rest_action(5000)
            .expect("server derives Camp entitlement");
        assert_eq!(action.kind, CW_ACTION_REST);
        assert_eq!(action.rest.requested_grade, CW_REST_GRADE_CAMP);
        assert_eq!(action.rest.entitled_grade, CW_REST_GRADE_CAMP);
        assert!(mutations.iter().any(|mutation| matches!(
            mutation,
            ProjectionMutation::AdvanceClock { clock_id, amount: 1, .. }
                if clock_id == OTHER_FRONTIER_DANGER_CLOCK_ID
        )));
        assert!(!mutations.iter().any(|mutation| matches!(
            mutation,
            ProjectionMutation::ClearTag { tag_id, .. }
                if tag_id == &trained_since_rest_tag_id(5000)
                    || tag_id.starts_with(&frontier_travel_since_rest_tag_prefix(5000))
        )));

        let mut rest_record = JournalRecord::new(action, 18_500);
        rest_record.projection_mutations.extend(mutations);
        let (status, rest_events) = runtime.apply_journal_record(&rest_record);
        assert_eq!(status, CW_OK);
        assert!(rest_events.iter().any(|event| {
            event.type_name == "clock.updated"
                && event.clock_id.as_deref() == Some(OTHER_FRONTIER_DANGER_CLOCK_ID)
                && event.clock_filled == Some(1)
        }));

        let actor = runtime
            .world
            .actors
            .iter_mut()
            .take(runtime.world.actor_count)
            .find(|actor| actor.id == 5000)
            .expect("test actor exists");
        actor.damage = 4;
        let use_record = JournalRecord::new(
            CwAction {
                kind: CW_ACTION_USE_ITEM,
                actor_id: 5000,
                target_actor_id: 5000,
                item_id: HEARTH_TONIC_ITEM_ID,
                ..CwAction::default()
            },
            18_501,
        );
        let (status, use_events) = runtime.apply_journal_record(&use_record);
        assert_eq!(status, CW_OK);
        assert!(use_events.iter().any(|event| {
            event.type_name == "item.used" && event.item_id == Some(HEARTH_TONIC_ITEM_ID)
        }));
        let tonic = runtime
            .item_by_id(HEARTH_TONIC_ITEM_ID)
            .expect("used tonic remains recorded");
        assert_eq!(tonic.charges, 0);
        assert_eq!(tonic.zone, CW_CARD_ZONE_EXHAUSTED);
    }

    #[test]
    fn sanctuary_entitlement_is_hearth_and_does_not_tick_frontier_danger() {
        let mut runtime = RuntimeWorld::seeded();
        create_test_human(
            &mut runtime,
            5000,
            COSY_COTTAGE_LOCATION_ID,
            "Hearth Tester",
        );
        mark_actor_tired(&mut runtime, 5000);
        assert_eq!(runtime.rest_entitlement(5000).grade, CW_REST_GRADE_HEARTH);
        let (action, mutations) = runtime
            .plan_rest_action(5000)
            .expect("sanctuary Rest is entitled");
        assert_eq!(action.rest.entitled_grade, CW_REST_GRADE_HEARTH);
        assert!(!mutations
            .iter()
            .any(|mutation| matches!(mutation, ProjectionMutation::AdvanceClock { .. })));
    }

    #[test]
    fn never_left_sanctuary_rest_is_legal_but_noop_stays_out_of_ranked_hand() {
        let mut runtime = RuntimeWorld::seeded();
        create_test_human(
            &mut runtime,
            5000,
            COSY_COTTAGE_LOCATION_ID,
            "Home Rest Tester",
        );
        let access = AccessContext::default();

        assert!(runtime.rest_available(5000));
        assert!(!runtime.rest_has_recovery_target(5000));
        let state = runtime.state_response(Some(5000), &access);
        let rest_offer = state
            .action_offers
            .iter()
            .find(|offer| offer.kind == "rest")
            .expect("place entitlement keeps Rest legally reachable at home");
        assert!(!rest_offer.disabled);
        assert!(!rest_offer.ranked_hand_eligible);
        assert!(!state
            .action_hand
            .entries
            .iter()
            .any(|entry| entry.kind == "rest"));
        let decision = state
            .inspector
            .offer_decisions
            .iter()
            .find(|decision| decision.kind == "rest")
            .expect("inspector explains legal no-op Rest");
        assert!(decision.available);
        assert!(!decision.in_hand);
        assert!(decision.reason.contains("nothing currently needs recovery"));

        let (action, mutations) = runtime
            .plan_rest_action(5000)
            .expect("place-legal no-op Rest still plans");
        assert_eq!(action.kind, CW_ACTION_REST);
        assert_eq!(action.rest.requested_grade, CW_REST_GRADE_HEARTH);
        assert!(mutations.is_empty());
        let record = JournalRecord::new(action, 18_700);
        assert_eq!(
            record.operation.as_deref(),
            Some("cosyworld.operation/rest")
        );
        assert_eq!(record.resolver.as_deref(), Some("rest_v1"));
        let tick_before = runtime.world.tick;
        let (status, events) = runtime.apply_journal_record(&record);
        assert_eq!(
            status, CW_OK,
            "the kernel accepts empty-effect action32 Rest"
        );
        assert!(events.is_empty());
        assert_eq!(runtime.world.tick, tick_before + 1);
        assert!(!runtime.rest_has_recovery_target(5000));
    }

    #[test]
    fn full_expedition_ring_warns_only_on_frontier_bound_travel() {
        let mut runtime = RuntimeWorld::seeded();
        create_test_human(
            &mut runtime,
            5000,
            RAIN_SOFT_GARDEN_LOCATION_ID,
            "Weary Traveler",
        );
        mark_actor_tired(&mut runtime, 5000);
        let mut travel_depth = JournalRecord::new(
            CwAction {
                kind: CW_ACTION_NONE,
                actor_id: 5000,
                ..CwAction::default()
            },
            18_710,
        );
        travel_depth
            .projection_mutations
            .push(ProjectionMutation::SetTag {
                tag: RpgTagState {
                    id: frontier_travel_since_rest_tag_id(5000, 18_710),
                    scope: "actor".to_string(),
                    scope_id: 5000,
                    label: "frontier travel".to_string(),
                    kind: "memory".to_string(),
                    active: true,
                    source_event_seq: None,
                    expires: Some("after_rest".to_string()),
                },
                reason: "test_full_expedition_ring".to_string(),
            });
        travel_depth
            .projection_mutations
            .push(ProjectionMutation::DiscoverSeedExit {
                from_location_id: RAIN_SOFT_GARDEN_LOCATION_ID,
                to_location_id: COSY_COTTAGE_LOCATION_ID,
                reason: "test_safe_retreat".to_string(),
            });
        travel_depth
            .projection_mutations
            .push(ProjectionMutation::DiscoverSeedExit {
                from_location_id: RAIN_SOFT_GARDEN_LOCATION_ID,
                to_location_id: MOONLIT_TRAIL_LOCATION_ID,
                reason: "test_frontier_bound_travel".to_string(),
            });
        assert_eq!(runtime.apply_journal_record(&travel_depth).0, CW_OK);
        assert_eq!(
            runtime.frontier_travel_since_rest_count(5000),
            runtime.frontier_travel_since_rest_required(5000)
        );

        let (scout_action, scout_mutation, _) = runtime
            .plan_scout_choice_action(5000, MOONLIT_TRAIL_LOCATION_ID)
            .expect("the frontier route can be scouted");
        let mut scout_record = JournalRecord::new(scout_action, 18_711);
        scout_record.bind_offer_kind("explore_path");
        scout_record.projection_mutations.push(scout_mutation);
        assert_eq!(runtime.apply_journal_record(&scout_record).0, CW_OK);
        let frontier_step_id = runtime.journeys[&5000].path[1];
        let state = runtime.state_response(Some(5000), &AccessContext::default());
        let safe_offer = state
            .action_offers
            .iter()
            .find(|offer| {
                offer.kind == "move"
                    && offer.target.as_ref().and_then(|target| target.id)
                        == Some(COSY_COTTAGE_LOCATION_ID)
            })
            .expect("full-ring weary actor keeps a safe retreat offer");
        assert!(
            safe_offer.risk.is_none(),
            "safe retreat must not inherit the full-ring warning"
        );
        let frontier_offer = state
            .action_offers
            .iter()
            .find(|offer| {
                offer.kind == "move"
                    && offer.target.as_ref().and_then(|target| target.id) == Some(frontier_step_id)
            })
            .expect("full-ring weary actor can Travel the revealed frontier step");
        assert!(frontier_offer
            .risk
            .as_deref()
            .is_some_and(|risk| risk.contains("may draw more trouble")));

        let move_record = JournalRecord::new(
            CwAction {
                kind: CW_ACTION_MOVE,
                actor_id: 5000,
                destination_location_id: COSY_COTTAGE_LOCATION_ID,
                ..CwAction::default()
            },
            18_711,
        );
        let (status, events) = runtime.apply_journal_record(&move_record);
        assert_eq!(status, CW_OK);
        assert!(events.iter().any(|event| {
            event.type_name == "actor.moved"
                && event.destination_location_id == Some(COSY_COTTAGE_LOCATION_ID)
        }));
    }

    fn rest_replay_actor_record(seed: u64) -> JournalRecord {
        let mut record = JournalRecord::new(
            CwAction {
                kind: CW_ACTION_CREATE_ACTOR,
                actor_id: 5000,
                location_id: COSY_COTTAGE_LOCATION_ID,
                ..CwAction::default()
            },
            seed,
        );
        record.actor_meta_upserts.insert(
            5000,
            ActorMeta {
                name: "Rest Replay".to_string(),
                speech_mode: "prose".to_string(),
                title: "Rest Replay Traveler".to_string(),
                description: "A journal fixture for authoritative card refresh.".to_string(),
            },
        );
        record
    }

    fn steady_light_rest_records(seed: u64) -> Vec<JournalRecord> {
        let pickup = JournalRecord::new(
            CwAction {
                kind: CW_ACTION_PICK_UP_ITEM,
                actor_id: 5000,
                item_id: 2014,
                ..CwAction::default()
            },
            seed + 1,
        );
        let mut prepare = JournalRecord::new(
            CwAction {
                kind: CW_ACTION_NONE,
                actor_id: 5000,
                item_id: 2014,
                ..CwAction::default()
            },
            seed + 2,
        );
        prepare
            .projection_mutations
            .push(ProjectionMutation::SetSpellPrepared(
                projection_items::SetSpellPrepared {
                    item_id: 2014,
                    prepared: true,
                    reason: "rest_replay_fixture".to_string(),
                },
            ));
        let cast = JournalRecord::new(
            CwAction {
                kind: CW_ACTION_RULES_MAGIC,
                actor_id: 5000,
                target_actor_id: 5000,
                item_id: 2014,
                ..CwAction::default()
            },
            seed + 3,
        );
        let rest = JournalRecord::new(
            rest_action_from_server_entitlement(
                5000,
                RestActionRequest {
                    requested_grade: CW_REST_GRADE_HEARTH,
                },
                CW_REST_GRADE_HEARTH,
            )
            .expect("server-authorized Hearth rest"),
            seed + 4,
        );
        vec![rest_replay_actor_record(seed), pickup, prepare, cast, rest]
    }

    #[test]
    fn hearth_rest_refreshes_cast_spell_and_replays_with_its_captured_zone() {
        let records = steady_light_rest_records(18_000);
        let rest_record = records.last().expect("rest record");
        assert_eq!(
            rest_record.operation.as_deref(),
            Some("cosyworld.operation/rest")
        );
        assert_eq!(rest_record.resolver.as_deref(), Some("rest_v1"));

        let mut direct = RuntimeWorld::seeded();
        for (index, record) in records.iter().enumerate() {
            let (status, events) = direct.apply_journal_record(record);
            assert_eq!(status, CW_OK, "record {index} remains replayable");
            if index == 3 {
                assert!(events
                    .iter()
                    .any(|event| event.type_name == "magic.spell_cast"));
                let exhausted = direct.item_by_id(2014).expect("spell remains present");
                assert_eq!(exhausted.charges, 0);
                assert_eq!(exhausted.zone, CW_CARD_ZONE_EXHAUSTED);
                assert_eq!(exhausted.recovery_zone, CW_CARD_ZONE_SPELL_DECK);
            } else if index == 4 {
                assert_eq!(
                    events
                        .iter()
                        .filter(|event| event.type_name == "item.refreshed")
                        .count(),
                    1
                );
            }
        }

        let path = std::env::temp_dir().join(format!(
            "cosyworld-rest-replay-{}-{}.sqlite",
            std::process::id(),
            now_seed()
        ));
        let _ = fs::remove_file(&path);
        for record in &records {
            append_action_journal(&path, record).expect("append Rest replay record");
        }
        let mut replayed =
            RuntimeWorld::from_action_journal(&path).expect("replay authoritative Rest journal");
        let _ = fs::remove_file(path);

        let refreshed = replayed.item_by_id(2014).expect("refreshed spell exists");
        assert_eq!(refreshed.charges, 1);
        assert_eq!(refreshed.max_charges, 1);
        assert_eq!(refreshed.zone, CW_CARD_ZONE_SPELL_DECK);
        assert_eq!(refreshed.recovery_zone, CW_CARD_ZONE_SPELL_DECK);
        assert_eq!(
            replayed
                .event_log
                .iter()
                .filter(|event| event.type_name == "item.refreshed")
                .count(),
            1
        );

        let recast = JournalRecord::new(
            CwAction {
                kind: CW_ACTION_RULES_MAGIC,
                actor_id: 5000,
                target_actor_id: 5000,
                item_id: 2014,
                ..CwAction::default()
            },
            18_005,
        );
        let (status, events) = replayed.apply_journal_record(&recast);
        assert_eq!(status, CW_OK);
        assert!(events
            .iter()
            .any(|event| event.type_name == "magic.spell_cast"));
    }

    #[test]
    fn legacy_projection_rest_remains_tag_only_and_byte_compatible() {
        let mut records = steady_light_rest_records(18_100);
        records.pop();
        let tired_id = tired_tag_id(5000);
        let mut make_tired = JournalRecord::new(
            CwAction {
                kind: CW_ACTION_NONE,
                actor_id: 5000,
                ..CwAction::default()
            },
            18_104,
        );
        make_tired
            .projection_mutations
            .push(ProjectionMutation::SetTag {
                tag: RpgTagState {
                    id: tired_id.clone(),
                    scope: "actor".to_string(),
                    scope_id: 5000,
                    label: "tired".to_string(),
                    kind: "condition".to_string(),
                    active: true,
                    source_event_seq: None,
                    expires: Some("after_rest".to_string()),
                },
                reason: "legacy_rest_fixture".to_string(),
            });
        records.push(make_tired);

        let mut legacy_rest = JournalRecord::new(
            CwAction {
                kind: CW_ACTION_NONE,
                actor_id: 5000,
                ..CwAction::default()
            },
            18_105,
        )
        .into_player_card();
        legacy_rest.bind_offer_kind("rest");
        legacy_rest
            .projection_mutations
            .push(ProjectionMutation::ClearTag {
                tag_id: tired_id.clone(),
                reason: "rest".to_string(),
            });
        let serialized =
            serde_json::to_value(&legacy_rest).expect("serialize historical projection Rest");
        assert_eq!(
            serialized["action"]["kind"],
            serde_json::json!(CW_ACTION_NONE)
        );
        assert!(
            serialized["action"].get("rest").is_none(),
            "the appended action-32 payload must not change historical Rest bytes"
        );
        let legacy_rest: JournalRecord =
            serde_json::from_value(serialized).expect("deserialize historical projection Rest");
        assert_eq!(legacy_rest.action.rest, CwRestInput::default());
        records.push(legacy_rest);

        let path = std::env::temp_dir().join(format!(
            "cosyworld-legacy-rest-replay-{}-{}.sqlite",
            std::process::id(),
            now_seed()
        ));
        let _ = fs::remove_file(&path);
        for record in &records {
            append_action_journal(&path, record).expect("append legacy Rest replay record");
        }
        let replayed =
            RuntimeWorld::from_action_journal(&path).expect("replay historical projection Rest");
        let _ = fs::remove_file(path);

        assert!(!replayed.tags.get(&tired_id).is_some_and(|tag| tag.active));
        let spell = replayed.item_by_id(2014).expect("spell remains present");
        assert_eq!(spell.charges, 0);
        assert_eq!(spell.zone, CW_CARD_ZONE_EXHAUSTED);
        assert!(!replayed
            .event_log
            .iter()
            .any(|event| event.type_name == "item.refreshed"));
    }

    #[test]
    fn rest_replay_applies_the_documented_fallback_for_legacy_missing_zone() {
        let seed_runtime = RuntimeWorld::seeded();
        let spell_meta = seed_runtime
            .items
            .get(&2014)
            .cloned()
            .expect("Steady Light metadata exists");
        let legacy_item_id = 91_2014;
        let receipt = MaterializationReceiptState {
            id: "test:legacy-rest-zone".to_string(),
            actor_id: 5000,
            card_id: "item-steady-light".to_string(),
            item_id: legacy_item_id,
            status: "materialized".to_string(),
            source_wallet: Some("test-wallet".to_string()),
            source_event_seq: 1,
        };
        let mut materialize = JournalRecord::new(
            CwAction {
                kind: CW_ACTION_NONE,
                actor_id: 5000,
                item_id: legacy_item_id,
                ..CwAction::default()
            },
            18_201,
        );
        materialize
            .projection_mutations
            .push(ProjectionMutation::MaterializeItem {
                receipt,
                item: CwItem {
                    id: legacy_item_id,
                    kind: CW_ITEM_KEEPSAKE,
                    charges: 0,
                    max_charges: 1,
                    recovery: CW_ITEM_RECOVERY_REST,
                    recovery_zone: CW_CARD_ZONE_SPELL_DECK,
                    weight_tenths: 1,
                    size_class: CW_ITEM_SIZE_TINY,
                    role: CW_ITEM_ROLE_SPELL,
                    zone: CW_CARD_ZONE_EXHAUSTED,
                    holder_actor_id: 5000,
                    ..CwItem::default()
                },
                meta: spell_meta,
                reason: "legacy_missing_recovery_zone".to_string(),
            });
        let mut legacy_json =
            serde_json::to_value(materialize).expect("serialize transitional legacy item");
        let legacy_item = legacy_json["projection_mutations"][0]["item"]
            .as_object_mut()
            .expect("materialized legacy item");
        for field in ["max_charges", "recovery", "recovery_zone", "reserved2"] {
            legacy_item.remove(field);
            assert!(!legacy_item.contains_key(field));
        }
        let legacy_bytes =
            serde_json::to_vec(&legacy_json).expect("serialize historical materialization bytes");
        let materialize: JournalRecord = serde_json::from_slice(&legacy_bytes)
            .expect("read missing recovery profile as zero-valued legacy state");
        let round_trip_json =
            serde_json::to_value(&materialize).expect("reserialize historical materialization");
        assert_eq!(round_trip_json, legacy_json);
        assert_eq!(
            serde_json::to_vec(&round_trip_json).expect("serialize round-trip JSON"),
            legacy_bytes
        );
        let rest = JournalRecord::new(
            rest_action_from_server_entitlement(
                5000,
                RestActionRequest {
                    requested_grade: CW_REST_GRADE_HEARTH,
                },
                CW_REST_GRADE_HEARTH,
            )
            .expect("server-authorized Hearth rest"),
            18_202,
        );
        let records = [rest_replay_actor_record(18_200), materialize, rest];

        let path = std::env::temp_dir().join(format!(
            "cosyworld-legacy-rest-zone-{}-{}.sqlite",
            std::process::id(),
            now_seed()
        ));
        let _ = fs::remove_file(&path);
        for record in &records {
            append_action_journal(&path, record).expect("append legacy zone record");
        }
        let replayed =
            RuntimeWorld::from_action_journal(&path).expect("replay legacy recovery-zone fallback");
        let _ = fs::remove_file(path);

        let refreshed = replayed
            .item_by_id(legacy_item_id)
            .expect("legacy spell survives replay");
        assert_eq!(refreshed.charges, 1);
        assert_eq!(refreshed.max_charges, 1);
        assert_eq!(refreshed.recovery, CW_ITEM_RECOVERY_REST);
        assert_eq!(refreshed.zone, CW_CARD_ZONE_SPELL_DECK);
        assert_eq!(refreshed.recovery_zone, CW_CARD_ZONE_SPELL_DECK);
        assert_eq!(
            replayed
                .event_log
                .iter()
                .filter(|event| {
                    event.type_name == "item.refreshed" && event.item_id == Some(legacy_item_id)
                })
                .count(),
            1
        );
    }

    #[test]
    fn listen_and_rest_move_public_clocks_and_tags() {
        let mut runtime = RuntimeWorld::seeded();
        let create = CwAction {
            kind: CW_ACTION_CREATE_ACTOR,
            actor_id: 5000,
            location_id: MOONLIT_TRAIL_LOCATION_ID,
            ..CwAction::default()
        };
        let mut create_record = JournalRecord::new(create, 7084);
        create_record.actor_meta_upserts.insert(
            5000,
            ActorMeta {
                name: "Rest Tester".to_string(),
                speech_mode: "prose".to_string(),
                title: "Clock-Touched Listener".to_string(),
                description: "A test avatar checking Listen and Rest projection.".to_string(),
            },
        );
        assert_eq!(runtime.apply_journal_record(&create_record).0, CW_OK);
        let initial_state = runtime.state_response(Some(5000), &AccessContext::default());
        assert_eq!(
            initial_state
                .calling
                .as_ref()
                .map(|calling| calling.statement.as_str()),
            Some(default_calling_statement())
        );
        assert_eq!(initial_state.ledger.unbanked_count, 0);
        if let Some(actor) = runtime
            .world
            .actors
            .iter_mut()
            .take(runtime.world.actor_count)
            .find(|actor| actor.id == 5000)
        {
            actor.stats.wisdom = 32;
        }

        let listen = CwAction {
            kind: CW_ACTION_ABILITY_CHECK,
            actor_id: 5000,
            ability: LISTEN_ABILITY,
            dc: LISTEN_DC,
            ..CwAction::default()
        };
        let (status, events) = runtime.apply_journal_record(&JournalRecord::new(listen, 7085));
        assert_eq!(status, CW_OK);
        assert!(events.iter().any(|event| {
            event.type_name == "clock.updated"
                && event.clock_id.as_deref() == Some(MOONLIT_PROGRESS_CLOCK_ID)
                && event.clock_filled == Some(1)
        }));
        assert!(events
            .iter()
            .any(|event| event.type_name == "ledger.marked"));
        assert_eq!(
            runtime
                .clocks
                .get(MOONLIT_PROGRESS_CLOCK_ID)
                .map(|clock| clock.filled),
            Some(1)
        );
        let listened_state = runtime.state_response(Some(5000), &AccessContext::default());
        assert_eq!(listened_state.ledger.unbanked_count, 2);
        assert!(listened_state
            .ledger
            .unbanked_marks
            .iter()
            .any(|mark| mark.category == "learned_truth"));
        assert!(listened_state
            .ledger
            .unbanked_marks
            .iter()
            .any(|mark| mark.category == "calling"));

        let (status, events) = runtime.apply_journal_record(&JournalRecord::new(listen, 7086));
        assert_eq!(status, CW_OK);
        assert!(events.iter().any(|event| {
            event.type_name == "tag.applied" && event.tag_label.as_deref() == Some("tired")
        }));
        assert!(!events
            .iter()
            .any(|event| event.type_name == "ledger.marked"));
        assert_eq!(
            runtime
                .clocks
                .get(MOONLIT_PROGRESS_CLOCK_ID)
                .map(|clock| clock.filled),
            Some(1)
        );
        let tired_tag = tired_tag_id(5000);
        assert!(runtime
            .tags
            .get(&tired_tag)
            .map(|tag| tag.active)
            .unwrap_or(false));
        let tonic = runtime
            .world
            .items
            .iter_mut()
            .take(runtime.world.item_count)
            .find(|item| item.id == HEARTH_TONIC_ITEM_ID)
            .expect("Hearth Tonic exists");
        tonic.location_id = 0;
        tonic.holder_actor_id = 5000;
        tonic.zone = CW_CARD_ZONE_CARRIED;
        tonic.container_item_id = 0;
        assert!(runtime
            .set_item_equipped(5000, HEARTH_TONIC_ITEM_ID, true, "rest_test_shelter")
            .iter()
            .any(|event| event.type_name == "item.equipped"));
        let tired_state = runtime.state_response(Some(5000), &AccessContext::default());
        assert!(tired_state.tags.iter().any(|tag| tag.label == "tired"));
        assert_eq!(tired_state.ledger.unbanked_count, 0);
        assert_eq!(tired_state.ledger.banked_count, 2);
        assert!(runtime.rest_available(5000));
        assert!(tired_state
            .primary_action
            .options
            .iter()
            .any(|option| option.kind == "rest"));

        let rest_action = CwAction {
            kind: CW_ACTION_NONE,
            actor_id: 5000,
            ..CwAction::default()
        };
        let mut rest_record = JournalRecord::new(rest_action, 7087);
        rest_record
            .projection_mutations
            .push(ProjectionMutation::ClearTag {
                tag_id: tired_tag.clone(),
                reason: "rest".to_string(),
            });
        for tag_id in runtime.frontier_travel_since_rest_tag_ids(5000) {
            rest_record
                .projection_mutations
                .push(ProjectionMutation::ClearTag {
                    tag_id,
                    reason: "rest".to_string(),
                });
        }
        rest_record
            .projection_mutations
            .push(ProjectionMutation::AdvanceClock {
                clock_id: MOONLIT_DANGER_CLOCK_ID.to_string(),
                amount: 1,
                reason: "rest".to_string(),
            });
        let (status, events) = runtime.apply_journal_record(&rest_record);
        assert_eq!(status, CW_OK);
        assert!(events.iter().any(|event| {
            event.type_name == "tag.cleared" && event.tag_label.as_deref() == Some("tired")
        }));
        assert!(events.iter().any(|event| {
            event.type_name == "clock.updated"
                && event.clock_id.as_deref() == Some(MOONLIT_DANGER_CLOCK_ID)
                && event.clock_filled == Some(1)
        }));
        let rested_state = runtime.state_response(Some(5000), &AccessContext::default());
        assert!(!rested_state.tags.iter().any(|tag| tag.label == "tired"));
        assert!(rested_state
            .primary_action
            .options
            .iter()
            .any(|option| option.kind == "rest"));
        assert!(!rested_state
            .action_hand
            .entries
            .iter()
            .any(|entry| entry.kind == "rest"));
        assert_eq!(
            rested_state
                .clocks
                .iter()
                .find(|clock| clock.id == MOONLIT_DANGER_CLOCK_ID)
                .map(|clock| clock.filled),
            Some(1)
        );

        let restored = RuntimeSnapshot::from_runtime(&runtime)
            .into_runtime()
            .expect("snapshot restores RPG projection state");
        assert_eq!(
            restored
                .clocks
                .get(MOONLIT_PROGRESS_CLOCK_ID)
                .map(|clock| clock.filled),
            Some(1)
        );
        assert_eq!(
            restored
                .clocks
                .get(MOONLIT_DANGER_CLOCK_ID)
                .map(|clock| clock.filled),
            Some(1)
        );
        assert!(!restored
            .tags
            .get(&tired_tag)
            .map(|tag| tag.active)
            .unwrap_or(false));
        let restored_state = restored.state_response(Some(5000), &AccessContext::default());
        assert_eq!(
            restored_state
                .calling
                .as_ref()
                .map(|calling| calling.statement.as_str()),
            Some(default_calling_statement())
        );
        assert_eq!(restored_state.ledger.unbanked_count, 0);
        assert_eq!(restored_state.ledger.banked_count, 2);
    }

    #[test]
    fn expedition_ring_projection_survives_snapshot_and_move_replay() {
        let mut runtime = RuntimeWorld::seeded();
        runtime
            .world
            .actors
            .iter_mut()
            .take(runtime.world.actor_count)
            .find(|actor| actor.id == RATI_ACTOR_ID)
            .expect("Rati exists")
            .stats
            .level = 4;
        let replay_base = RuntimeSnapshot::from_runtime(&runtime);
        let records = [
            (RAIN_SOFT_GARDEN_LOCATION_ID, 18_801),
            (MOONLIT_TRAIL_LOCATION_ID, 18_802),
            (RAIN_SOFT_GARDEN_LOCATION_ID, 18_803),
            (MOONLIT_TRAIL_LOCATION_ID, 18_804),
        ]
        .map(|(destination_location_id, seed)| {
            JournalRecord::new(
                CwAction {
                    kind: CW_ACTION_MOVE,
                    actor_id: RATI_ACTOR_ID,
                    destination_location_id,
                    ..CwAction::default()
                },
                seed,
            )
        });
        for record in &records {
            assert_eq!(runtime.apply_journal_record(record).0, CW_OK);
        }

        let expected = runtime
            .actor_view(runtime.actor_by_id(RATI_ACTOR_ID).expect("moved Rati"))
            .expedition_ring;
        assert_eq!(
            expected,
            ExpeditionRingView {
                filled_count: 3,
                pip_total: 4,
                needs_rest: false,
            }
        );

        let restored = RuntimeSnapshot::from_runtime(&runtime)
            .into_runtime()
            .expect("expedition ring source state survives a snapshot round trip");
        assert_eq!(
            restored
                .actor_view(restored.actor_by_id(RATI_ACTOR_ID).expect("restored Rati"))
                .expedition_ring,
            expected
        );

        let mut replayed = replay_base
            .into_runtime()
            .expect("pre-travel snapshot restores");
        for record in &records {
            assert_eq!(replayed.apply_journal_record(record).0, CW_OK);
        }
        assert_eq!(
            replayed
                .actor_view(replayed.actor_by_id(RATI_ACTOR_ID).expect("replayed Rati"))
                .expedition_ring,
            expected
        );
    }
}
