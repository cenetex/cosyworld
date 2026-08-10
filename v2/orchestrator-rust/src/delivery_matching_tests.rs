use super::*;

fn record_test_loot_provenance(runtime: &mut RuntimeWorld, item_id: u64, template_id: &str) {
    let mounted = mounted_loot_item_template(template_id).expect("mounted loot template");
    let allocation_id = format!("test-delivery:{item_id}:{template_id}");
    runtime.loot_allocations.insert(
        allocation_id.clone(),
        LootAllocationState {
            schema_version: QUEST_LOOT_SCHEMA_VERSION,
            id: allocation_id,
            job_id: "test-delivery".to_string(),
            quest_template_id: "test.delivery".to_string(),
            table_id: "cosyworld.core:loot/test-delivery".to_string(),
            table_version: 1,
            replay_version: WEIGHTED_FNV1A_V1.to_string(),
            pack_id: mounted.pack_id,
            pack_version: mounted.pack_version,
            rules_profile: active_content().manifest.rules_profile.clone(),
            completion_event_seq: 70,
            allocation_event_seq: 71,
            roll_seed: 72,
            roll_input: "test-delivery".to_string(),
            selected_template_ids: vec![template_id.to_string()],
            item_ids: vec![item_id],
            allocation_policy: "location_stockpile".to_string(),
            destination_kind: "location".to_string(),
            destination_id: MOONLIT_TRAIL_LOCATION_ID.to_string(),
            recipient_actor_id: None,
            location_id: MOONLIT_TRAIL_LOCATION_ID,
        },
    );
}

#[test]
fn aggregate_scarcity_creates_a_physical_delivery_job_without_claiming_completion() {
    let mut runtime = RuntimeWorld::seeded();
    let pulse = WorldPulse {
        pulse_index: 4,
        source_world_tick: 24,
        weather: WeatherShift {
            class: PulseEffectClass::Ambient,
            location_id: MOONLIT_TRAIL_LOCATION_ID,
            before: "settled".to_string(),
            after: "settled".to_string(),
            intensity: 0,
            changed: false,
            notable: false,
        },
        trade: TradeOutcome {
            class: PulseEffectClass::Opportunity,
            from_location_id: MOONLIT_TRAIL_LOCATION_ID,
            to_location_id: COSY_COTTAGE_LOCATION_ID,
            resource: "herbs".to_string(),
            moved: false,
            amount: 0,
            reason: "useful stores are running thin".to_string(),
            needs_delivery: true,
        },
        faction: None,
        conflict: ConflictOutcome {
            class: PulseEffectClass::Opportunity,
            location_id: MOONLIT_TRAIL_LOCATION_ID,
            before: 0,
            after: 0,
            escalated: false,
            front_ids: Vec::new(),
            faction_ids: Vec::new(),
            reason: "quiet".to_string(),
        },
        public_beat: Some(PulseBeatKind::DeliveryNeed),
    };
    let event = runtime
        .ensure_delivery_need_job(&pulse, Some(1), Some(77))
        .expect("a new need creates one public opportunity");
    assert_eq!(event.type_name, "world.delivery.needed");
    assert_eq!(event.location_id, Some(MOONLIT_TRAIL_LOCATION_ID));
    assert_eq!(
        event.destination_location_id,
        Some(COSY_COTTAGE_LOCATION_ID)
    );
    assert_eq!(event.caused_by_event_seq, Some(77));
    assert!(!runtime
        .event_log
        .iter()
        .any(|event| event.type_name == "world.logistics.completed"));
    let job = runtime
        .jobs
        .values()
        .find(|job| job.delivery.is_some())
        .expect("the opportunity has a concrete job");
    assert_eq!(runtime.job_status(job), "active");
    let progress_clock = &runtime.clocks[&job.progress_clock_id];
    assert_eq!(progress_clock.segments, 1);
    assert_eq!(progress_clock.presentation.rhythm, "immediate");
    assert!(job.premise.contains("physical"));
    assert!(job.action_copy.summary.contains("Pick up a physical item"));
    assert_eq!(
        job.delivery
            .as_ref()
            .and_then(|delivery| delivery.requirement.clone()),
        Some(DeliveryRequirement::ItemTag {
            tag: "herbs".to_string(),
        })
    );
    assert!(
        runtime
            .active_progress_clock_id_for_location(COSY_COTTAGE_LOCATION_ID)
            .is_none(),
        "generic Work cannot abstractly complete a physical delivery"
    );
    assert!(
        runtime
            .ensure_delivery_need_job(&pulse, Some(1), Some(78))
            .is_none(),
        "the same active need updates silently instead of duplicating public news"
    );
    let mut unsupported = pulse.clone();
    unsupported.pulse_index = 5;
    unsupported.trade.resource = "moonlight".to_string();
    assert!(runtime
        .ensure_delivery_need_job(&unsupported, Some(1), Some(79))
        .is_none());
    assert!(!runtime.jobs.values().any(|job| {
        job.delivery
            .as_ref()
            .is_some_and(|delivery| delivery.resource == "moonlight")
    }));
}

#[test]
fn causal_delivery_evidence_completes_the_matching_delivery_job() {
    let mut runtime = RuntimeWorld::seeded();
    let pulse = WorldPulse {
        pulse_index: 5,
        source_world_tick: 30,
        weather: WeatherShift {
            class: PulseEffectClass::Ambient,
            location_id: MOONLIT_TRAIL_LOCATION_ID,
            before: "settled".to_string(),
            after: "settled".to_string(),
            intensity: 0,
            changed: false,
            notable: false,
        },
        trade: TradeOutcome {
            class: PulseEffectClass::Opportunity,
            from_location_id: MOONLIT_TRAIL_LOCATION_ID,
            to_location_id: RAIN_SOFT_GARDEN_LOCATION_ID,
            resource: "herbs".to_string(),
            moved: false,
            amount: 0,
            reason: "useful stores are running thin".to_string(),
            needs_delivery: true,
        },
        faction: None,
        conflict: ConflictOutcome {
            class: PulseEffectClass::Opportunity,
            location_id: MOONLIT_TRAIL_LOCATION_ID,
            before: 0,
            after: 0,
            escalated: false,
            front_ids: Vec::new(),
            faction_ids: Vec::new(),
            reason: "quiet".to_string(),
        },
        public_beat: Some(PulseBeatKind::DeliveryNeed),
    };
    runtime
        .ensure_delivery_need_job(&pulse, Some(COSY_COTTAGE_LOCATION_ID), Some(77))
        .expect("delivery need");
    let mut ore_pulse = pulse.clone();
    ore_pulse.pulse_index = 6;
    ore_pulse.trade.resource = "ore".to_string();
    runtime
        .ensure_delivery_need_job(&ore_pulse, Some(COSY_COTTAGE_LOCATION_ID), Some(78))
        .expect("concurrent ore delivery need");
    let job_id = runtime
        .jobs
        .values()
        .find(|job| {
            job.delivery
                .as_ref()
                .is_some_and(|delivery| delivery.resource == "herbs")
        })
        .map(|job| job.id.clone())
        .expect("delivery job");
    let ore_job_id = runtime
        .jobs
        .values()
        .find(|job| {
            job.delivery
                .as_ref()
                .is_some_and(|delivery| delivery.resource == "ore")
        })
        .map(|job| job.id.clone())
        .expect("ore delivery job");

    let wrong_resource = runtime.apply_actor_causal_logistics(vec![DeliveryEvidence {
        actor_id: RATI_ACTOR_ID,
        item_id: DEWBRIGHT_BUTTON_ITEM_ID,
        origin_location_id: MOONLIT_TRAIL_LOCATION_ID,
        destination_location_id: RAIN_SOFT_GARDEN_LOCATION_ID,
        acquisition_event_seq: 79,
        movement_event_seqs: vec![80],
        delivery_event_seq: 81,
    }]);
    assert!(wrong_resource
        .iter()
        .all(|event| event.type_name != "job.updated"));
    assert_eq!(runtime.job_status(&runtime.jobs[&job_id]), "active");
    assert_eq!(runtime.job_status(&runtime.jobs[&ore_job_id]), "active");

    record_test_loot_provenance(&mut runtime, DEWBRIGHT_BUTTON_ITEM_ID, "hearth_tonic");
    let resolved_facts = runtime.physical_item_delivery_facts(DEWBRIGHT_BUTTON_ITEM_ID);
    assert_eq!(resolved_facts.template_id.as_deref(), Some("hearth_tonic"));
    assert!(resolved_facts.tags.contains("herbs"));

    let projected = runtime.apply_actor_causal_logistics(vec![DeliveryEvidence {
        actor_id: RATI_ACTOR_ID,
        item_id: DEWBRIGHT_BUTTON_ITEM_ID,
        origin_location_id: MOONLIT_TRAIL_LOCATION_ID,
        destination_location_id: RAIN_SOFT_GARDEN_LOCATION_ID,
        acquisition_event_seq: 80,
        movement_event_seqs: vec![81],
        delivery_event_seq: 82,
    }]);

    assert_eq!(runtime.job_status(&runtime.jobs[&job_id]), "completed");
    assert_eq!(runtime.job_status(&runtime.jobs[&ore_job_id]), "active");
    assert!(projected.iter().any(|event| {
        event.type_name == "clock.updated"
            && event.caused_by_event_seq == Some(82)
            && event.clock_delta == Some(1)
    }));
    assert!(projected
        .iter()
        .any(|event| event.type_name == "job.updated"));
    assert_eq!(
        projected
            .iter()
            .filter(|event| event.type_name == "world.logistics.completed")
            .count(),
        1
    );
    let receipt = command_response_output(None, &projected)
        .expect("physical delivery returns one causal receipt");
    assert!(receipt.contains("The need is answered (1/1)"));
    assert!(receipt.contains("contribution is remembered here"));
    assert!(!receipt.contains("The work is done."));
    let completed = runtime
        .shared_question_views(RAIN_SOFT_GARDEN_LOCATION_ID, Some(RATI_ACTOR_ID))
        .into_iter()
        .find(|question| question.id == job_id)
        .expect("the completed delivery remains legible at its destination");
    assert_eq!(completed.presentation_state, "completed_memory");
    assert!(completed.completion_memory.is_some());
    assert_eq!(completed.recent_contributions.len(), 1);
    assert_eq!(completed.recent_contributions[0].actor_id, RATI_ACTOR_ID);
    assert_eq!(completed.recent_contributions[0].event_seq, 82);
}
