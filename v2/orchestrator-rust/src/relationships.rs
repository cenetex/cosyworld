use super::*;

impl RuntimeWorld {
    pub(super) fn default_bond_command(&self, actor_id: u64) -> Option<String> {
        let target = self.default_bondable_resident(actor_id)?;
        let target_name = self.actor_name(target.id)?;
        let statement = self
            .relationship_contract(target.id)
            .map(|relationship| relationship.statement.clone())
            .unwrap_or_else(|| default_bond_statement(&target_name));
        Some(format!("bond {target_name}: {statement}"))
    }
}

pub(super) const RELATIONSHIP_DIALOGUE_PENDING: &str = "pending";
pub(super) const RELATIONSHIP_DIALOGUE_DELIVERED: &str = "delivered";
pub(super) const RELATIONSHIP_DIALOGUE_UNAVAILABLE: &str = "unavailable";

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub(super) struct SeedRelationshipContent {
    pub(super) intent: String,
    pub(super) statement: String,
    pub(super) first_beat: String,
    pub(super) reply_prompt: String,
    pub(super) active_on_gift_item_id: u64,
    pub(super) active_beat: String,
}

#[derive(Clone, Debug, Serialize)]
pub(super) struct RelationshipPreviewView {
    pub(super) intent: String,
    pub(super) statement: String,
    pub(super) initial_status: &'static str,
    pub(super) deterministic_consequence: String,
    pub(super) dialogue_contract: &'static str,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
pub(super) struct RelationshipReplyExpectation {
    pub(super) actor_id: u64,
    pub(super) target_actor_id: u64,
    pub(super) relationship_event_seq: u64,
    pub(super) user_text: String,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
pub(super) struct BondState {
    pub(super) id: String,
    pub(super) actor_id: u64,
    pub(super) target_actor_id: u64,
    pub(super) statement: String,
    pub(super) strength: u8,
    pub(super) status: String,
    #[serde(default)]
    pub(super) source_event_seq: Option<u64>,
    #[serde(default)]
    pub(super) updated_event_seq: Option<u64>,
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub(super) dialogue_status: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(super) dialogue_event_seq: Option<u64>,
}

impl RuntimeWorld {
    pub(super) fn relationship_contract(
        &self,
        target_actor_id: u64,
    ) -> Option<&SeedRelationshipContent> {
        active_content()
            .actors
            .iter()
            .find(|actor| actor.id == target_actor_id)
            .and_then(|actor| actor.relationship.as_ref())
    }

    pub(super) fn relationship_preview(
        &self,
        target_actor_id: u64,
    ) -> Option<RelationshipPreviewView> {
        self.relationship_contract(target_actor_id)
            .map(|relationship| RelationshipPreviewView {
                intent: relationship.intent.clone(),
                statement: relationship.statement.clone(),
                initial_status: "forming",
                deterministic_consequence: relationship.first_beat.clone(),
                dialogue_contract:
                    "one grounded reply if dialogue is available; otherwise one explicit unavailable result",
            })
    }

    pub(super) fn create_bond(
        &mut self,
        actor_id: u64,
        target_actor_id: u64,
        submitted_statement: &str,
        cost: u8,
        reason: &str,
    ) -> Vec<EventView> {
        let id = bond_id(actor_id, target_actor_id);
        if cost == 0
            || self.advancement_points_available(actor_id) < usize::from(cost)
            || self.active_bond(actor_id, target_actor_id).is_some()
        {
            return Vec::new();
        }

        let authored = self.relationship_contract(target_actor_id).cloned();
        let target_name = self
            .actor_name(target_actor_id)
            .unwrap_or_else(|| format!("Resident {target_actor_id}"));
        let spend_seq = self.world.next_event_seq;
        let spend = AdvancementSpendState {
            id: advancement_spend_id(actor_id, "bond_slot", spend_seq),
            actor_id,
            kind: "bond_slot".to_string(),
            label: if authored.is_some() {
                format!("A forming relationship with {target_name}")
            } else {
                format!("Friendship with {target_name}")
            },
            cost,
            source_event_seq: spend_seq,
        };
        if self.advancement_spends.contains_key(&spend.id) {
            return Vec::new();
        }
        self.advancement_spends
            .insert(spend.id.clone(), spend.clone());
        let mut events = vec![self.append_advancement_event("advancement.spent", &spend, reason)];

        let statement = authored
            .as_ref()
            .map(|relationship| relationship.statement.as_str())
            .unwrap_or(submitted_statement);
        let status = if authored.is_some() {
            "forming"
        } else {
            "active"
        };
        let bond = BondState {
            id: id.clone(),
            actor_id,
            target_actor_id,
            statement: statement.to_string(),
            strength: 1,
            status: status.to_string(),
            source_event_seq: Some(self.world.next_event_seq),
            updated_event_seq: Some(self.world.next_event_seq),
            dialogue_status: authored
                .as_ref()
                .map(|_| RELATIONSHIP_DIALOGUE_PENDING.to_string())
                .unwrap_or_default(),
            dialogue_event_seq: None,
        };
        self.bonds.insert(id, bond.clone());
        let bond_event = self.append_bond_event("bond.created", &bond, reason);
        let bond_event_seq = bond_event.seq;
        events.push(bond_event);

        if let Some(relationship) = authored {
            events.push(self.append_relationship_event(
                "relationship.beat",
                actor_id,
                target_actor_id,
                relationship.first_beat,
                true,
                Some(bond_event_seq),
            ));
        }
        events
    }

    pub(super) fn revise_bond(
        &mut self,
        actor_id: u64,
        target_actor_id: u64,
        statement: &str,
        cost: u8,
        reason: &str,
    ) -> Vec<EventView> {
        let id = bond_id(actor_id, target_actor_id);
        if cost == 0 || self.advancement_points_available(actor_id) < usize::from(cost) {
            return Vec::new();
        }
        let Some(existing) = self.bonds.get(&id) else {
            return Vec::new();
        };
        if existing.status == "resolved"
            || existing.strength == 0
            || existing.statement == statement
        {
            return Vec::new();
        }

        let spend_seq = self.world.next_event_seq;
        let spend = AdvancementSpendState {
            id: advancement_spend_id(actor_id, "bond_revision", spend_seq),
            actor_id,
            kind: "bond_revision".to_string(),
            label: "Friendship changed".to_string(),
            cost,
            source_event_seq: spend_seq,
        };
        if self.advancement_spends.contains_key(&spend.id) {
            return Vec::new();
        }
        self.advancement_spends
            .insert(spend.id.clone(), spend.clone());
        let mut events = vec![self.append_advancement_event("advancement.spent", &spend, reason)];

        let Some(bond) = self.bonds.get_mut(&id) else {
            return events;
        };
        bond.statement = statement.to_string();
        bond.status = "active".to_string();
        bond.updated_event_seq = Some(self.world.next_event_seq);
        let bond = bond.clone();
        events.push(self.append_bond_event("bond.revised", &bond, reason));
        events
    }

    fn append_relationship_event(
        &mut self,
        type_name: &str,
        actor_id: u64,
        target_actor_id: u64,
        content: String,
        success: bool,
        caused_by_event_seq: Option<u64>,
    ) -> EventView {
        let location_id = self
            .actor_by_id(actor_id)
            .or_else(|| self.actor_by_id(target_actor_id))
            .map(|actor| actor.location_id);
        let event = EventView {
            seq: self.world.next_event_seq,
            type_name: type_name.to_string(),
            success,
            actor_id: Some(actor_id),
            actor_name: self.actor_name(actor_id),
            target_actor_id: Some(target_actor_id),
            target_actor_name: self.actor_name(target_actor_id),
            location_id,
            location_name: location_id.and_then(|id| self.location_name(id)),
            content: Some(content),
            caused_by_event_seq,
            source_location_id: location_id,
            ..EventView::default()
        };
        self.world.next_event_seq += 1;
        self.push_projected_event(event.clone());
        event
    }

    pub(super) fn set_relationship_dialogue_status(
        &mut self,
        actor_id: u64,
        target_actor_id: u64,
        status: &str,
        reason: &str,
    ) -> Vec<EventView> {
        let id = bond_id(actor_id, target_actor_id);
        let Some(bond) = self.bonds.get_mut(&id) else {
            return Vec::new();
        };
        if bond.dialogue_status != RELATIONSHIP_DIALOGUE_PENDING {
            return Vec::new();
        }
        let event_seq = self.world.next_event_seq;
        bond.dialogue_status = status.to_string();
        bond.dialogue_event_seq = Some(event_seq);
        bond.updated_event_seq = Some(event_seq);
        let event_type = if status == RELATIONSHIP_DIALOGUE_DELIVERED {
            "dialogue.delivered"
        } else {
            "dialogue.unavailable"
        };
        vec![self.append_relationship_event(
            event_type,
            actor_id,
            target_actor_id,
            reason.to_string(),
            status == RELATIONSHIP_DIALOGUE_DELIVERED,
            None,
        )]
    }

    pub(super) fn relationship_reply_pending(
        &self,
        expectation: &RelationshipReplyExpectation,
    ) -> bool {
        self.active_bond(expectation.actor_id, expectation.target_actor_id)
            .is_some_and(|bond| bond.dialogue_status == RELATIONSHIP_DIALOGUE_PENDING)
    }

    pub(super) fn relationship_reply_plan(
        &self,
        observation: &PlayerTickObservation,
    ) -> Option<AvatarReplyPlan> {
        let expectation = observation.relationship_reply.as_ref()?;
        self.resident_reaction_plan_for_target(
            expectation.actor_id,
            expectation.target_actor_id,
            &expectation.user_text,
        )
        .map(|plan| plan.with_observation(observation))
    }

    pub(super) fn deepen_authored_relationship_from_gift(
        &mut self,
        actor_id: u64,
        target_actor_id: u64,
        item_id: u64,
        source_event_seq: u64,
    ) -> Option<Vec<EventView>> {
        let relationship = self.relationship_contract(target_actor_id)?.clone();
        if relationship.active_on_gift_item_id != item_id {
            return None;
        }
        let was_forming = self
            .active_bond(actor_id, target_actor_id)
            .is_some_and(|bond| bond.status == "forming");
        let mut events = self.deepen_bond_from_event(
            actor_id,
            target_actor_id,
            source_event_seq,
            gift_bond_claim_key(actor_id, target_actor_id, item_id),
            "authored_relationship_gift",
            &format!("gift:{actor_id}:{target_actor_id}:{item_id}:bond"),
        );
        if !events.is_empty() && was_forming {
            events.push(self.append_relationship_event(
                "relationship.advanced",
                actor_id,
                target_actor_id,
                relationship.active_beat,
                true,
                Some(source_event_seq),
            ));
        }
        Some(events)
    }
}

pub(super) fn relationship_reply_expectation(
    runtime: &RuntimeWorld,
    actor_id: u64,
    events: &[EventView],
) -> Option<RelationshipReplyExpectation> {
    let event = events.iter().find(|event| {
        event.success && event.actor_id == Some(actor_id) && event.type_name == "relationship.beat"
    })?;
    let target_actor_id = event.target_actor_id?;
    let reply_prompt = runtime
        .relationship_contract(target_actor_id)
        .map(|relationship| relationship.reply_prompt.as_str())
        .unwrap_or("Respond directly to the visible relationship beat.");
    Some(RelationshipReplyExpectation {
        actor_id,
        target_actor_id,
        relationship_event_seq: event.seq,
        user_text: format!(
            "This authored relationship beat just happened: {} Authored reply direction: {} Do not change the request or invent another reward.",
            event.content.as_deref().unwrap_or("a clear request was made"),
            reply_prompt,
        ),
    })
}

pub(super) async fn relationship_reply_evidence_exists(
    state: &AppState,
    expectation: &RelationshipReplyExpectation,
) -> bool {
    state.inner.lock().await.event_log.iter().any(|event| {
        event.success
            && event.type_name == "message.created"
            && event.actor_id == Some(expectation.target_actor_id)
            && event.caused_by_event_seq == Some(expectation.relationship_event_seq)
    })
}

pub(super) async fn commit_relationship_dialogue_outcome(
    state: &AppState,
    expectation: &RelationshipReplyExpectation,
    status: &str,
    reason: &str,
    source_world_tick: u64,
    observed_through_seq: u64,
    source_location_id: Option<u64>,
) -> Result<Vec<EventView>, String> {
    let mut runtime = state.inner.lock().await;
    if !runtime.relationship_reply_pending(expectation) {
        return Ok(Vec::new());
    }
    let mut record = JournalRecord::new(
        CwAction {
            kind: CW_ACTION_NONE,
            actor_id: expectation.actor_id,
            ..CwAction::default()
        },
        runtime.next_seed_value(),
    );
    record.caused_by_event_seq = Some(expectation.relationship_event_seq);
    record.source_world_tick = Some(source_world_tick);
    record.observed_through_seq = Some(observed_through_seq);
    record.source_location_id = source_location_id;
    record
        .projection_mutations
        .push(ProjectionMutation::SetRelationshipDialogueStatus {
            relationship_actor_id: expectation.actor_id,
            target_actor_id: expectation.target_actor_id,
            status: status.to_string(),
            reason: reason.to_string(),
        });
    let (commit_status, events) =
        commit_journal_record(state, &mut runtime, record).map_err(|error| error.to_string())?;
    drop(runtime);
    if commit_status != CW_OK {
        return Err("relationship dialogue outcome did not commit".to_string());
    }
    if !events.is_empty() {
        broadcast_events(state, &events);
    }
    Ok(events)
}

pub(super) async fn complete_player_tick_reply(
    state: &AppState,
    observation: &PlayerTickObservation,
    plan: Option<AvatarReplyPlan>,
    relationship_reply: Option<RelationshipReplyExpectation>,
) -> Result<(), String> {
    let Some(expectation) = relationship_reply else {
        if let Some(plan) = plan {
            complete_avatar_reply(state, plan, None).await?;
        }
        return Ok(());
    };

    if relationship_reply_evidence_exists(state, &expectation).await {
        commit_relationship_dialogue_outcome(
            state,
            &expectation,
            RELATIONSHIP_DIALOGUE_DELIVERED,
            "a previously committed grounded reply was recovered",
            observation.source_world_tick,
            observation.observed_through_seq,
            observation.source_location_id,
        )
        .await?;
        return Ok(());
    }

    let reason = match plan {
        Some(plan) => match complete_avatar_reply(state, plan, Some(&expectation)).await {
            Ok(true) => return Ok(()),
            Ok(false) => "resident dialogue was unavailable; no substitute line was created",
            Err(error) => {
                warn!(
                    "authored relationship dialogue unavailable after heartbeat: {}",
                    error
                );
                "resident dialogue was unavailable; no substitute line was created"
            }
        },
        None => "resident dialogue was unavailable; no substitute line was created",
    };
    commit_relationship_dialogue_outcome(
        state,
        &expectation,
        RELATIONSHIP_DIALOGUE_UNAVAILABLE,
        reason,
        observation.source_world_tick,
        observation.observed_through_seq,
        observation.source_location_id,
    )
    .await?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::{routing::post, Router};
    use std::sync::atomic::{AtomicUsize, Ordering};

    const TEST_ACTOR_ID: u64 = 5000;
    const MARA_ACTOR_ID: u64 = 8301;
    const MARA_LOCATION_ID: u64 = 800;
    const KEEPER_KEY_ITEM_ID: u64 = 8401;

    fn relationship_record(_runtime: &mut RuntimeWorld, seed: u64) -> JournalRecord {
        let mut record = JournalRecord::new(
            CwAction {
                kind: CW_ACTION_NONE,
                actor_id: TEST_ACTOR_ID,
                ..CwAction::default()
            },
            seed,
        )
        .into_player_card();
        record
            .projection_mutations
            .push(ProjectionMutation::CreateBond {
                target_actor_id: MARA_ACTOR_ID,
                statement: "a submitted generic friendship statement".to_string(),
                cost: BOND_SLOT_COST,
                reason: "advancement".to_string(),
            });
        record
    }

    fn relationship_runtime() -> RuntimeWorld {
        let mut runtime = RuntimeWorld::seeded();
        create_test_human(
            &mut runtime,
            TEST_ACTOR_ID,
            MARA_LOCATION_ID,
            "Road Listener",
        );
        let source_seq = runtime.world.next_event_seq;
        assert!(runtime
            .mark_visit_ledger(
                TEST_ACTOR_ID,
                "learned_truth",
                "The road lamps have failed.",
                source_seq,
                "test:mara-relationship",
            )
            .is_some());
        assert!(runtime
            .bank_visit_ledger(TEST_ACTOR_ID, "test:mara-relationship")
            .is_some());
        runtime
    }

    fn commit_relationship(runtime: &mut RuntimeWorld) -> (JournalRecord, Vec<EventView>) {
        let record = relationship_record(runtime, 362_001);
        let (status, events) = runtime.apply_journal_record(&record);
        assert_eq!(status, CW_OK);
        assert_eq!(
            events
                .iter()
                .filter(|event| event.type_name == "bond.created")
                .count(),
            1
        );
        assert_eq!(
            events
                .iter()
                .filter(|event| event.type_name == "relationship.beat")
                .count(),
            1
        );
        (record, events)
    }

    fn relationship_observation(
        runtime: &RuntimeWorld,
        events: &[EventView],
    ) -> PlayerTickObservation {
        player_tick_observation(
            runtime,
            Some(MARA_LOCATION_ID),
            TEST_ACTOR_ID,
            CW_OK,
            events,
        )
        .expect("authored relationship arms a heartbeat")
    }

    #[test]
    fn mara_chat_commits_one_forming_bond_and_one_deterministic_request() {
        let mut runtime = relationship_runtime();
        let (_record, events) = commit_relationship(&mut runtime);
        let bond = runtime
            .active_bond(TEST_ACTOR_ID, MARA_ACTOR_ID)
            .expect("Mara relationship exists");
        assert_eq!(bond.status, "forming");
        assert_eq!(bond.strength, 1);
        assert_eq!(bond.dialogue_status, RELATIONSHIP_DIALOGUE_PENDING);
        assert_eq!(
            bond.statement,
            "Mara is watching whether I follow the failed lamps and return Rowan's Keeper Brass Key."
        );
        let beat = events
            .iter()
            .find(|event| event.type_name == "relationship.beat")
            .expect("deterministic beat");
        assert!(beat
            .content
            .as_deref()
            .is_some_and(|text| text.contains("empty key hook") && text.contains("Brass Key")));
        assert!(events.iter().all(|event| {
            event.type_name != "ledger.marked"
                && !(event.type_name == "message.created" && event.actor_id == Some(MARA_ACTOR_ID))
        }));
        let reply = relationship_reply_expectation(&runtime, TEST_ACTOR_ID, &events)
            .expect("authored reply direction");
        assert!(reply.user_text.contains("empty key hook"));
        assert!(reply.user_text.contains("Do not change the request"));

        let retry = relationship_record(&mut runtime, 362_002);
        let (_status, retry_events) = runtime.apply_journal_record(&retry);
        assert!(!retry_events.iter().any(|event| matches!(
            event.type_name.as_str(),
            "bond.created" | "relationship.beat" | "advancement.spent"
        )));
        assert_eq!(
            runtime
                .bonds
                .values()
                .filter(|bond| {
                    bond.actor_id == TEST_ACTOR_ID && bond.target_actor_id == MARA_ACTOR_ID
                })
                .count(),
            1
        );
    }

    #[tokio::test]
    async fn unavailable_provider_emits_one_typed_result_and_no_substitute_line() {
        let mut runtime = relationship_runtime();
        let (_record, events) = commit_relationship(&mut runtime);
        let observation = relationship_observation(&runtime, &events);
        let beat_seq = observation
            .relationship_reply
            .as_ref()
            .expect("reply expectation")
            .relationship_event_seq;
        let state = test_app_state(runtime, None);

        let (plan, relationship_reply) =
            complete_player_tick_observation(&state, observation.clone())
                .await
                .expect("heartbeat planning succeeds");
        assert!(
            plan.is_some(),
            "the authored beat has a grounded reply plan"
        );
        complete_player_tick_reply(&state, &observation, plan, relationship_reply)
            .await
            .expect("unavailable outcome commits");

        let runtime = state.inner.lock().await;
        let unavailable: Vec<_> = runtime
            .event_log
            .iter()
            .filter(|event| event.type_name == "dialogue.unavailable")
            .collect();
        assert_eq!(unavailable.len(), 1);
        assert_eq!(unavailable[0].caused_by_event_seq, Some(beat_seq));
        assert!(!runtime.event_log.iter().any(|event| {
            event.seq > beat_seq
                && event.type_name == "message.created"
                && event.actor_id == Some(MARA_ACTOR_ID)
        }));
        let bond = runtime
            .active_bond(TEST_ACTOR_ID, MARA_ACTOR_ID)
            .expect("forming bond survives provider failure");
        assert_eq!(bond.status, "forming");
        assert_eq!(bond.dialogue_status, RELATIONSHIP_DIALOGUE_UNAVAILABLE);
        drop(runtime);

        complete_player_tick_reply(
            &state,
            &observation,
            None,
            observation.relationship_reply.clone(),
        )
        .await
        .expect("worker retry is idempotent");
        assert_eq!(
            state
                .inner
                .lock()
                .await
                .event_log
                .iter()
                .filter(|event| event.type_name == "dialogue.unavailable")
                .count(),
            1
        );
    }

    #[tokio::test]
    async fn fake_provider_delivers_one_grounded_mara_reply_without_fallback() {
        let requests = Arc::new(AtomicUsize::new(0));
        let app = Router::new().route(
            "/chat/completions",
            post({
                let requests = requests.clone();
                move || {
                    let requests = requests.clone();
                    async move {
                        requests.fetch_add(1, Ordering::SeqCst);
                        Json(serde_json::json!({
                            "choices": [{
                                "message": {
                                    "content": "Bring Rowan's Keeper Brass Key back to this empty hook, and I will know the road is still ours."
                                },
                                "finish_reason": "stop"
                            }]
                        }))
                    }
                }
            }),
        );
        let listener = TcpListener::bind("127.0.0.1:0")
            .await
            .expect("bind fake dialogue provider");
        let address = listener.local_addr().expect("fake provider address");
        let server = tokio::spawn(async move {
            let _ = axum::serve(listener, app).await;
        });

        let mut runtime = relationship_runtime();
        let (_record, events) = commit_relationship(&mut runtime);
        let observation = relationship_observation(&runtime, &events);
        let beat_seq = observation
            .relationship_reply
            .as_ref()
            .expect("reply expectation")
            .relationship_event_seq;
        let mut state = test_app_state(runtime, None);
        state.ai_config = Arc::new(Some(AiConfig {
            api_key: "test".to_string(),
            base_url: format!("http://{address}"),
            model: "test-dialogue".to_string(),
            vision_model: "test-vision".to_string(),
            ..AiConfig::default()
        }));

        let (plan, relationship_reply) =
            complete_player_tick_observation(&state, observation.clone())
                .await
                .expect("heartbeat planning succeeds");
        complete_player_tick_reply(&state, &observation, plan, relationship_reply)
            .await
            .expect("grounded reply commits");

        let runtime = state.inner.lock().await;
        let replies: Vec<_> = runtime
            .event_log
            .iter()
            .filter(|event| {
                event.seq > beat_seq
                    && event.type_name == "message.created"
                    && event.actor_id == Some(MARA_ACTOR_ID)
            })
            .collect();
        assert_eq!(replies.len(), 1);
        assert!(
            replies[0]
                .content
                .as_deref()
                .is_some_and(|text| text.contains("Brass Key") && text.contains("empty hook")),
            "grounded reply was {:?}",
            replies[0].content
        );
        assert_eq!(replies[0].caused_by_event_seq, Some(beat_seq));
        assert_eq!(
            runtime
                .event_log
                .iter()
                .filter(|event| event.type_name == "dialogue.delivered")
                .count(),
            1
        );
        assert!(!runtime
            .event_log
            .iter()
            .any(|event| event.type_name == "dialogue.unavailable"));
        assert_eq!(
            runtime
                .active_bond(TEST_ACTOR_ID, MARA_ACTOR_ID)
                .expect("bond")
                .dialogue_status,
            RELATIONSHIP_DIALOGUE_DELIVERED
        );
        assert_eq!(requests.load(Ordering::SeqCst), 1);
        drop(runtime);
        server.abort();
    }

    #[tokio::test]
    async fn reply_commit_gap_recovers_delivered_without_provider_or_duplicate_speech() {
        let requests = Arc::new(AtomicUsize::new(0));
        let app = Router::new().route(
            "/chat/completions",
            post({
                let requests = requests.clone();
                move || {
                    let requests = requests.clone();
                    async move {
                        requests.fetch_add(1, Ordering::SeqCst);
                        Json(serde_json::json!({
                            "choices": [{
                                "message": {
                                    "content": r#"{"speech":"This provider must not be called during recovery.","intent":null,"belief":null,"desire":null,"promise":null,"refusal":null,"proposed_action":null}"#
                                },
                                "finish_reason": "stop"
                            }]
                        }))
                    }
                }
            }),
        );
        let listener = TcpListener::bind("127.0.0.1:0")
            .await
            .expect("bind recovery provider");
        let address = listener.local_addr().expect("recovery provider address");
        let server = tokio::spawn(async move {
            let _ = axum::serve(listener, app).await;
        });

        let mut runtime = relationship_runtime();
        let (_record, events) = commit_relationship(&mut runtime);
        let observation = relationship_observation(&runtime, &events);
        let beat_seq = observation
            .relationship_reply
            .as_ref()
            .expect("reply expectation")
            .relationship_event_seq;
        let mut state = test_app_state(runtime, None);
        state.ai_config = Arc::new(Some(AiConfig {
            api_key: "test".to_string(),
            base_url: format!("http://{address}"),
            model: "test-dialogue".to_string(),
            vision_model: "test-vision".to_string(),
            ..AiConfig::default()
        }));
        let (plan, relationship_reply) =
            complete_player_tick_observation(&state, observation.clone())
                .await
                .expect("heartbeat planning succeeds");
        let plan = plan.expect("grounded reply plan");

        // Model the old crash window: speech reached the journal, but the
        // relationship status mutation did not. Recovery must trust the
        // causally linked durable message instead of asking the provider again.
        {
            let mut runtime = state.inner.lock().await;
            let events = commit_resident_reply_record(
                &state,
                &mut runtime,
                &plan,
                CertifiedAvatarIntent {
                    proposal: AvatarIntentProposal {
                        speech: "Bring Rowan's Keeper Brass Key back to this empty hook."
                            .to_string(),
                        intent: None,
                        belief: None,
                        desire: None,
                        promise: None,
                        refusal: None,
                        proposed_action: None,
                    },
                    speech: certified_test_speech(
                        "Bring Rowan's Keeper Brass Key back to this empty hook.",
                        plan.speaker_actor_id,
                        &plan.speaker_name,
                    ),
                    planning: ResidentPlanningTrace::absent(&plan),
                },
                None,
            )
            .expect("legacy reply commit");
            assert_eq!(
                events
                    .iter()
                    .filter(|event| event.type_name == "message.created")
                    .count(),
                1
            );
            assert_eq!(
                runtime
                    .active_bond(TEST_ACTOR_ID, MARA_ACTOR_ID)
                    .expect("forming bond")
                    .dialogue_status,
                RELATIONSHIP_DIALOGUE_PENDING
            );
        }

        complete_player_tick_reply(
            &state,
            &observation,
            Some(plan.clone()),
            relationship_reply.clone(),
        )
        .await
        .expect("legacy gap recovers");
        complete_player_tick_reply(&state, &observation, Some(plan), relationship_reply)
            .await
            .expect("recovery retry is idempotent");

        let runtime = state.inner.lock().await;
        assert_eq!(requests.load(Ordering::SeqCst), 0);
        assert_eq!(
            runtime
                .event_log
                .iter()
                .filter(|event| {
                    event.type_name == "message.created"
                        && event.actor_id == Some(MARA_ACTOR_ID)
                        && event.caused_by_event_seq == Some(beat_seq)
                })
                .count(),
            1
        );
        assert_eq!(
            runtime
                .event_log
                .iter()
                .filter(|event| event.type_name == "dialogue.delivered")
                .count(),
            1
        );
        assert!(!runtime
            .event_log
            .iter()
            .any(|event| event.type_name == "dialogue.unavailable"));
        assert_eq!(
            runtime
                .active_bond(TEST_ACTOR_ID, MARA_ACTOR_ID)
                .expect("recovered bond")
                .dialogue_status,
            RELATIONSHIP_DIALOGUE_DELIVERED
        );
        drop(runtime);
        server.abort();
    }

    #[test]
    fn returning_rowans_key_activates_the_relationship_once_and_explains_why() {
        let mut runtime = relationship_runtime();
        commit_relationship(&mut runtime);
        let key = runtime
            .world
            .items
            .iter_mut()
            .take(runtime.world.item_count)
            .find(|item| item.id == KEEPER_KEY_ITEM_ID)
            .expect("Keeper's Brass Key");
        key.holder_actor_id = TEST_ACTOR_ID;
        key.location_id = 0;
        let gift = JournalRecord::new(
            CwAction {
                kind: CW_ACTION_GIVE_ITEM,
                actor_id: TEST_ACTOR_ID,
                target_actor_id: MARA_ACTOR_ID,
                item_id: KEEPER_KEY_ITEM_ID,
                ..CwAction::default()
            },
            362_003,
        );
        let (status, events) = runtime.apply_journal_record(&gift);
        assert_eq!(status, CW_OK);
        let bond = runtime
            .active_bond(TEST_ACTOR_ID, MARA_ACTOR_ID)
            .expect("relationship remains active");
        assert_eq!(bond.status, "active");
        assert_eq!(bond.strength, 2);
        assert!(events.iter().any(|event| {
            event.type_name == "relationship.advanced"
                && event
                    .content
                    .as_deref()
                    .is_some_and(|text| text.contains("earned trust"))
        }));
        assert_eq!(
            events
                .iter()
                .filter(|event| event.type_name == "bond.deepened")
                .count(),
            1
        );

        let (_status, repeated) = runtime.apply_journal_record(&gift);
        assert!(!repeated.iter().any(|event| matches!(
            event.type_name.as_str(),
            "bond.deepened" | "relationship.advanced" | "ledger.marked"
        )));
    }

    #[test]
    fn replay_snapshot_and_reconnect_keep_relationship_causality_inspectable() {
        let mut original = relationship_runtime();
        let replay_base = RuntimeSnapshot::from_runtime(&original);
        let (record, events) = commit_relationship(&mut original);
        let expected = original
            .active_bond(TEST_ACTOR_ID, MARA_ACTOR_ID)
            .expect("original bond")
            .clone();

        let mut replayed = replay_base.into_runtime().expect("restore replay base");
        assert_eq!(replayed.apply_journal_record(&record).0, CW_OK);
        let actual = replayed
            .active_bond(TEST_ACTOR_ID, MARA_ACTOR_ID)
            .expect("replayed bond");
        assert_eq!(actual.statement, expected.statement);
        assert_eq!(actual.status, expected.status);
        assert_eq!(actual.source_event_seq, expected.source_event_seq);
        assert_eq!(actual.dialogue_status, expected.dialogue_status);

        let reconnect = original.state_response(Some(TEST_ACTOR_ID), &AccessContext::default());
        let bond = reconnect
            .bonds
            .iter()
            .find(|bond| bond.target_actor_id == MARA_ACTOR_ID)
            .expect("bond appears after reconnect");
        assert_eq!(bond.status, "forming");
        assert_eq!(
            bond.source_event_seq,
            events
                .iter()
                .find(|event| event.type_name == "bond.created")
                .map(|event| event.seq)
        );
        assert_eq!(bond.dialogue_status, RELATIONSHIP_DIALOGUE_PENDING);
        let mara = reconnect
            .actors
            .iter()
            .find(|actor| actor.id == MARA_ACTOR_ID)
            .expect("Mara appears after reconnect");
        assert!(mara.relationship.as_ref().is_some_and(|relationship| {
            relationship.initial_status == "forming"
                && relationship.statement.contains("failed lamps")
        }));
    }

    #[test]
    fn durable_relationship_heartbeat_is_not_lost_to_room_coalescing() {
        let path = std::env::temp_dir().join(format!(
            "cosyworld-relationship-heartbeat-{}-{}.sqlite",
            std::process::id(),
            now_seed()
        ));
        let _ = fs::remove_file(&path);
        init_event_store(&path).expect("initialize outbox");

        let ordinary = PlayerTickObservation {
            source_actor_id: TEST_ACTOR_ID,
            source_world_tick: 40,
            caused_by_event_seq: Some(400),
            observed_through_seq: 400,
            source_location_id: Some(MARA_LOCATION_ID),
            allow_ordinary_speech: true,
            source_events: Vec::new(),
            ripple_source: None,
            relationship_reply: None,
        };
        let relationship = PlayerTickObservation {
            source_actor_id: TEST_ACTOR_ID,
            source_world_tick: 41,
            caused_by_event_seq: Some(401),
            observed_through_seq: 401,
            source_location_id: Some(MARA_LOCATION_ID),
            allow_ordinary_speech: false,
            source_events: Vec::new(),
            ripple_source: None,
            relationship_reply: Some(RelationshipReplyExpectation {
                actor_id: TEST_ACTOR_ID,
                target_actor_id: MARA_ACTOR_ID,
                relationship_event_seq: 401,
                user_text: "Mara made the authored request.".to_string(),
            }),
        };
        assert!(append_actor_job(&path, &ordinary).expect("queue ordinary heartbeat"));
        assert!(
            append_actor_job(&path, &relationship).expect("queue promised relationship heartbeat"),
            "the promised reply must not be discarded by an already-armed room heartbeat"
        );
        assert!(
            !append_actor_job(&path, &relationship).expect("dedupe relationship retry"),
            "the same promised reply is queued once"
        );
        let _ = fs::remove_file(path);
    }
}
