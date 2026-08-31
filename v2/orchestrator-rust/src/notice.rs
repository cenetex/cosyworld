use super::*;

#[derive(Clone, Debug, Eq, PartialEq)]
pub(super) struct NoticeActorFact {
    pub(super) fact_id: String,
    pub(super) target_actor_id: u64,
    pub(super) target_name: String,
    pub(super) item_id: u64,
    pub(super) item_name: String,
    pub(super) held_since_tick: u64,
    pub(super) content: String,
}

#[derive(Debug, Deserialize)]
pub(super) struct NoticeActorRequest {
    pub(super) actor_id: u64,
    pub(super) actor_session: Option<String>,
    pub(super) target_actor_id: u64,
}

impl RuntimeWorld {
    pub(super) fn notice_actor_fact_for_target(
        &self,
        viewer_actor_id: u64,
        target_actor_id: u64,
    ) -> Option<NoticeActorFact> {
        if !self.economy_notice_target_is_valid(viewer_actor_id, target_actor_id)
            || self.economy_known_by(viewer_actor_id, target_actor_id)
        {
            return None;
        }
        let target_name = self.actor_name(target_actor_id)?;
        let mut visible_items = self
            .actor_held_items(target_actor_id)
            .into_iter()
            .filter(|item| {
                item.container_item_id == 0
                    && matches!(item.zone, CW_CARD_ZONE_CARRIED | CW_CARD_ZONE_EQUIPPED)
            })
            .collect::<Vec<_>>();
        visible_items.sort_by_key(|item| item.id);
        let has_visible_items = !visible_items.is_empty();
        if let Some(fact) = visible_items.into_iter().find_map(|item| {
            let fact_id = notice_actor_fact_claim_key(
                viewer_actor_id,
                target_actor_id,
                item.id,
                item.held_since_tick,
            );
            (!self.rpg_claims.contains(&fact_id)).then(|| NoticeActorFact {
                fact_id,
                target_actor_id,
                target_name: target_name.clone(),
                item_id: item.id,
                item_name: self
                    .item_name(item.id)
                    .unwrap_or_else(|| format!("Item {}", item.id)),
                held_since_tick: item.held_since_tick,
                content: String::new(),
            })
        }) {
            let mut fact = fact;
            fact.content = format!(
                "You notice that {} is visibly carrying {}.",
                fact.target_name, fact.item_name
            );
            return Some(fact);
        }
        if has_visible_items {
            return None;
        }

        let target = self.actor_by_id(target_actor_id)?;
        let title = self.actor_view(target).title.trim().to_string();
        if title.is_empty() {
            return None;
        }
        let title_signature = stable_hash_u64(&[
            "notice-actor-public-title",
            &target_actor_id.to_string(),
            &title,
        ]);
        let fact_id = format!(
            "notice_actor:v1:{viewer_actor_id}:{target_actor_id}:public_title:{title_signature}"
        );
        (!self.rpg_claims.contains(&fact_id)).then(|| NoticeActorFact {
            fact_id,
            target_actor_id,
            target_name: target_name.clone(),
            item_id: 0,
            item_name: String::new(),
            held_since_tick: 0,
            content: format!("You notice that {target_name} is {title}."),
        })
    }

    pub(super) fn notice_actor_facts(&self, viewer_actor_id: u64) -> Vec<NoticeActorFact> {
        let Some(viewer) = self
            .actor_by_id(viewer_actor_id)
            .filter(|actor| Self::actor_can_act(*actor))
        else {
            return Vec::new();
        };
        let mut target_ids = self.world.actors[..self.world.actor_count]
            .iter()
            .copied()
            .filter(|target| {
                target.id != viewer_actor_id
                    && target.location_id == viewer.location_id
                    && Self::actor_can_act(*target)
                    && self.actor_visible_in_projection(*target, Some(viewer_actor_id), None)
            })
            .map(|target| target.id)
            .collect::<Vec<_>>();
        target_ids.sort_unstable();
        target_ids
            .into_iter()
            .filter_map(|target_actor_id| {
                self.notice_actor_fact_for_target(viewer_actor_id, target_actor_id)
            })
            .collect()
    }

    pub(super) fn noticed_actor_items(
        &self,
        viewer_actor_id: u64,
        target_actor_id: u64,
    ) -> Vec<CwItem> {
        let mut items = self
            .actor_held_items(target_actor_id)
            .into_iter()
            .filter(|item| {
                item.container_item_id == 0
                    && matches!(item.zone, CW_CARD_ZONE_CARRIED | CW_CARD_ZONE_EQUIPPED)
                    && self.rpg_claims.contains(&notice_actor_fact_claim_key(
                        viewer_actor_id,
                        target_actor_id,
                        item.id,
                        item.held_since_tick,
                    ))
            })
            .collect::<Vec<_>>();
        items.sort_by_key(|item| item.id);
        items
    }

    pub(super) fn plan_notice_actor_action(
        &self,
        actor_id: u64,
        target_actor_id: u64,
    ) -> Result<(CwAction, ProjectionMutation, NoticeActorFact), String> {
        let actor = self
            .actor_by_id(actor_id)
            .filter(|actor| Self::actor_can_act(*actor))
            .ok_or_else(|| "Notice requires an active avatar.".to_string())?;
        let fact = self
            .notice_actor_fact_for_target(actor_id, target_actor_id)
            .ok_or_else(|| "That actor has no unresolved observable fact.".to_string())?;
        let action = CwAction {
            kind: CW_ACTION_NONE,
            actor_id,
            target_actor_id,
            item_id: fact.item_id,
            location_id: actor.location_id,
            ..CwAction::default()
        };
        let mutation = ProjectionMutation::RecordNoticeActorFact {
            fact_id: fact.fact_id.clone(),
            target_actor_id,
            item_id: fact.item_id,
            held_since_tick: fact.held_since_tick,
        };
        Ok((action, mutation, fact))
    }
}

pub(super) async fn notice_actor(
    ConnectInfo(client_addr): ConnectInfo<SocketAddr>,
    State(state): State<AppState>,
    Json(payload): Json<NoticeActorRequest>,
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
    let was_active = payload
        .actor_session
        .as_deref()
        .and_then(|token| {
            actor_session_active_for_actor(&state.actor_sessions, payload.actor_id, token)
        })
        .unwrap_or(false);
    let mut runtime = state.inner.lock().await;
    if !client_actor_authorized_for_state(
        &runtime,
        &state,
        payload.actor_id,
        payload.actor_session.as_deref(),
    ) {
        return client_actor_rejected_response();
    }
    let released_events = release_inactive_direct_inventory_locked(&state, &mut runtime);
    let (action, mutation, fact) =
        match runtime.plan_notice_actor_action(payload.actor_id, payload.target_actor_id) {
            Ok(plan) => plan,
            Err(reason) => {
                drop(runtime);
                if !released_events.is_empty() {
                    broadcast_events(&state, &released_events);
                }
                return action_offer_rejected(reason);
            }
        };
    if let Some(response) =
        actor_offer_turn_rejection(&state, &runtime, payload.actor_id, NOTICE_ACTOR_OFFER_KIND)
    {
        drop(runtime);
        if !released_events.is_empty() {
            broadcast_events(&state, &released_events);
        }
        return response;
    }
    let turn_location_id = Some(action.location_id);
    let mut record = JournalRecord::new(action, runtime.next_seed_value()).into_player_card();
    record.bind_offer_kind(NOTICE_ACTOR_OFFER_KIND);
    record.projection_mutations.push(mutation);
    let Ok((status, mut events)) = commit_journal_record(&state, &mut runtime, record) else {
        drop(runtime);
        if !released_events.is_empty() {
            broadcast_events(&state, &released_events);
        }
        return Json(ActionResponse {
            ok: false,
            status: 500,
            events: Vec::new(),
        });
    };
    let observation = advance_turn_and_capture_player_tick_observation(
        &state,
        &mut runtime,
        turn_location_id,
        payload.actor_id,
        status,
        &mut events,
    );
    let actor_name = runtime.actor_name(payload.actor_id);
    drop(runtime);
    if !released_events.is_empty() {
        broadcast_events(&state, &released_events);
    }
    broadcast_events(&state, &events);
    if let Some(observation) = observation {
        schedule_player_tick_observation(&state, observation);
    }
    let mut response_events = events;
    if status == CW_OK {
        let mut private_fact = private_actor_event(
            "notice.fact_revealed",
            payload.actor_id,
            Some(fact.target_actor_id),
            fact.content,
        );
        private_fact.actor_name = actor_name;
        private_fact.target_actor_name = Some(fact.target_name);
        if fact.item_id != 0 {
            private_fact.item_id = Some(fact.item_id);
            private_fact.item_name = Some(fact.item_name);
        }
        response_events.push(private_fact);
    }
    if !was_active {
        response_events.extend(commit_presence_event(&state, payload.actor_id, true).await);
    }
    Json(ActionResponse {
        ok: status == CW_OK,
        status,
        events: response_events,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn arrange_visible_story_button(runtime: &mut RuntimeWorld, held_since_tick: u64) {
        let item = runtime
            .world
            .items
            .iter_mut()
            .take(runtime.world.item_count)
            .find(|item| item.id == STORY_BUTTON_ITEM_ID)
            .expect("story button exists");
        item.location_id = 0;
        item.holder_actor_id = RATI_ACTOR_ID;
        item.container_item_id = 0;
        item.zone = CW_CARD_ZONE_CARRIED;
        item.held_since_tick = held_since_tick;
    }

    #[tokio::test]
    async fn actor_notice_endpoint_reveals_exactly_one_private_fact_without_a_roll() {
        let mut runtime = RuntimeWorld::seeded();
        create_test_human(
            &mut runtime,
            5000,
            COSY_COTTAGE_LOCATION_ID,
            "Endpoint Observer",
        );
        let held_since_tick = runtime.world.tick;
        arrange_visible_story_button(&mut runtime, held_since_tick);
        let offer = runtime
            .legal_action_candidates(Some(5000), &AccessContext::default())
            .1
            .into_iter()
            .find(|offer| {
                offer.kind == NOTICE_ACTOR_OFFER_KIND
                    && offer.target.as_ref().and_then(|target| target.id) == Some(RATI_ACTOR_ID)
            })
            .expect("one actor Notice offer is published");
        assert!(offer.id.starts_with("notice_actor_v1:"));
        assert!(offer.claim_key.is_some());
        let state = test_app_state(runtime, None);
        let (actor_session, _) = issue_actor_session(&state, 5000);
        let mut broadcasts = state.tx.subscribe();

        let response = notice_actor(
            ConnectInfo("127.0.0.1:43110".parse().expect("client address")),
            State(state.clone()),
            Json(NoticeActorRequest {
                actor_id: 5000,
                actor_session: Some(actor_session),
                target_actor_id: RATI_ACTOR_ID,
            }),
        )
        .await
        .0;

        assert!(response.ok);
        assert!(!response
            .events
            .iter()
            .any(|event| event.type_name == "ability_check.rolled"));
        let notice = response
            .events
            .iter()
            .find(|event| event.type_name == "notice.fact_revealed")
            .expect("private exact fact response");
        assert_eq!(notice.target_actor_id, Some(RATI_ACTOR_ID));
        assert_eq!(notice.item_id, Some(STORY_BUTTON_ITEM_ID));
        assert!(notice
            .content
            .as_deref()
            .is_some_and(|content| content.contains("visibly carrying Story Button")));
        assert!(!response
            .events
            .iter()
            .any(|event| event.type_name == "job.contribution.resolved"));
        let emitted = std::iter::from_fn(|| broadcasts.try_recv().ok()).collect::<Vec<_>>();
        assert!(emitted
            .iter()
            .any(|event| event.type_name == "notice.actor_observed"));
        assert!(!emitted
            .iter()
            .any(|event| event.type_name == "notice.fact_revealed"));
        let runtime = state.inner.lock().await;
        assert!(!runtime.economy_known_by(5000, RATI_ACTOR_ID));
        let state_view = runtime.state_response(Some(5000), &AccessContext::default());
        let projected = state_view
            .actors
            .iter()
            .find(|actor| actor.id == RATI_ACTOR_ID)
            .and_then(|actor| actor.resident_economy.as_ref())
            .expect("the viewer receives the noticed fact projection");
        assert_eq!(projected.held_item_ids, vec![STORY_BUTTON_ITEM_ID]);
        assert!(projected.sought_item_ids.is_empty());
        assert!(runtime
            .notice_actor_fact_for_target(5000, RATI_ACTOR_ID)
            .is_none());
        assert!(!runtime
            .legal_action_candidates(Some(5000), &AccessContext::default())
            .1
            .iter()
            .any(|candidate| {
                candidate.kind == NOTICE_ACTOR_OFFER_KIND
                    && candidate.target.as_ref().and_then(|target| target.id) == Some(RATI_ACTOR_ID)
            }));
    }

    #[test]
    fn actor_notice_fact_is_stable_replayable_and_does_not_touch_growth_or_currency() {
        let mut runtime = RuntimeWorld::seeded();
        create_test_human(
            &mut runtime,
            5000,
            COSY_COTTAGE_LOCATION_ID,
            "Replay Observer",
        );
        arrange_visible_story_button(&mut runtime, 77);

        let before_orbs = runtime.orb_balance(5000);
        let before_marks = runtime.ledger_marks.len();
        let (action, mutation, fact) = runtime
            .plan_notice_actor_action(5000, RATI_ACTOR_ID)
            .expect("one exact fact can be planned");
        let mut record = JournalRecord::new(action, 86_003).into_player_card();
        record.bind_offer_kind(NOTICE_ACTOR_OFFER_KIND);
        record.projection_mutations.push(mutation);
        let replay_base = RuntimeSnapshot::from_runtime(&runtime);

        let (status, events) = runtime.apply_journal_record(&record);
        assert_eq!(status, CW_OK);
        assert!(events
            .iter()
            .any(|event| event.type_name == "notice.actor_observed"));
        assert!(runtime.rpg_claims.contains(&fact.fact_id));
        assert_eq!(runtime.orb_balance(5000), before_orbs);
        assert_eq!(runtime.ledger_marks.len(), before_marks);
        assert!(runtime
            .notice_actor_fact_for_target(5000, RATI_ACTOR_ID)
            .is_none());

        let restored = RuntimeSnapshot::from_runtime(&runtime)
            .into_runtime()
            .expect("noticed fact snapshot restores");
        assert!(restored.rpg_claims.contains(&fact.fact_id));
        assert_eq!(restored.noticed_actor_items(5000, RATI_ACTOR_ID).len(), 1);

        let mut replayed = replay_base
            .into_runtime()
            .expect("pre-Notice snapshot restores");
        assert_eq!(replayed.apply_journal_record(&record).0, CW_OK);
        assert!(replayed.rpg_claims.contains(&fact.fact_id));
        assert_eq!(
            replayed.noticed_actor_items(5000, RATI_ACTOR_ID),
            runtime.noticed_actor_items(5000, RATI_ACTOR_ID)
        );
        assert!(replayed.event_log.iter().any(|event| {
            event.type_name == "notice.actor_observed"
                && event.actor_id == Some(5000)
                && event.target_actor_id == Some(RATI_ACTOR_ID)
        }));
    }

    #[test]
    fn stale_actor_notice_certificate_rejects_without_world_mutation() {
        let mut runtime = RuntimeWorld::seeded();
        create_test_human(
            &mut runtime,
            5000,
            COSY_COTTAGE_LOCATION_ID,
            "Stale Notice Observer",
        );
        arrange_visible_story_button(&mut runtime, 91);
        let offer = runtime
            .legal_action_candidates(Some(5000), &AccessContext::default())
            .1
            .into_iter()
            .find(|offer| {
                offer.kind == NOTICE_ACTOR_OFFER_KIND
                    && offer.target.as_ref().and_then(|target| target.id) == Some(RATI_ACTOR_ID)
            })
            .expect("the exact item fact is certified");

        let item = runtime
            .world
            .items
            .iter_mut()
            .take(runtime.world.item_count)
            .find(|item| item.id == STORY_BUTTON_ITEM_ID)
            .expect("story button remains present");
        item.holder_actor_id = 0;
        item.location_id = COSY_COTTAGE_LOCATION_ID;
        item.held_since_tick = 0;
        let before = serde_json::to_value(RuntimeSnapshot::from_runtime(&runtime))
            .expect("serialize pre-submission state");

        let rejected = runtime.validate_action_offer_submission(
            5000,
            &AccessContext::default(),
            &ActionOfferSubmissionRequest {
                path: "/actions/notice".to_string(),
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
                selected_card_ids: Vec::new(),
                payload: serde_json::json!({
                    "actor_id": 5000,
                    "target_actor_id": RATI_ACTOR_ID,
                }),
            },
        );
        assert!(rejected.is_err());
        assert_eq!(
            serde_json::to_value(RuntimeSnapshot::from_runtime(&runtime))
                .expect("serialize post-rejection state"),
            before
        );
    }

    #[test]
    fn legacy_targeted_notice_disclosure_still_replays_unchanged() {
        std::thread::Builder::new()
            .name("economy-disclosure-replay".to_string())
            .stack_size(16 * 1024 * 1024)
            .spawn(|| {
                let mut runtime = RuntimeWorld::seeded();
                create_test_human(
                    &mut runtime,
                    5000,
                    COSY_COTTAGE_LOCATION_ID,
                    "Careful Observer",
                );
                let target_actor_id = RATI_ACTOR_ID;
                assert!(runtime
                    .resident_economy_view(
                        runtime.actor_by_id(target_actor_id).expect("Rati exists"),
                        Some(5000),
                    )
                    .is_none());

                let failed_record = JournalRecord::new(
                    CwAction {
                        kind: CW_ACTION_RULES_SEARCH,
                        actor_id: 5000,
                        target_actor_id,
                        ability: LISTEN_ABILITY,
                        dc: LISTEN_DC,
                        modifier: -100,
                        ..CwAction::default()
                    },
                    86_001,
                );
                let (status, failed_events) = runtime.apply_journal_record(&failed_record);
                assert_eq!(status, CW_OK);
                let failed = failed_events
                    .iter()
                    .find(|event| event.type_name == "ability_check.rolled")
                    .expect("notice check event");
                assert_eq!(failed.content.as_deref(), Some("notice"));
                assert_eq!(failed.target_actor_id, Some(target_actor_id));
                assert!(!runtime.economy_known_by(5000, target_actor_id));

                let replay_base = RuntimeSnapshot::from_runtime(&runtime);
                let successful_record = JournalRecord::new(
                    CwAction {
                        kind: CW_ACTION_RULES_SEARCH,
                        actor_id: 5000,
                        target_actor_id,
                        ability: LISTEN_ABILITY,
                        dc: LISTEN_DC,
                        modifier: 100,
                        ..CwAction::default()
                    },
                    86_002,
                );
                let (status, successful_events) = runtime.apply_journal_record(&successful_record);
                assert_eq!(status, CW_OK);
                let successful = successful_events
                    .iter()
                    .find(|event| event.type_name == "ability_check.rolled")
                    .expect("successful notice event");
                assert!(successful.success);
                assert_eq!(successful.content.as_deref(), Some("notice"));
                assert!(runtime.economy_known_by(5000, target_actor_id));
                assert!(runtime
                    .resident_economy_view(
                        runtime.actor_by_id(target_actor_id).expect("Rati exists"),
                        Some(5000),
                    )
                    .is_some());

                let persisted = RuntimeSnapshot::from_runtime(&runtime);
                let restored = persisted
                    .into_runtime()
                    .expect("economy disclosure snapshot restores");
                assert!(restored.economy_known_by(5000, target_actor_id));

                let mut replayed = replay_base
                    .into_runtime()
                    .expect("pre-disclosure snapshot restores");
                assert_eq!(replayed.apply_journal_record(&successful_record).0, CW_OK);
                assert!(replayed.economy_known_by(5000, target_actor_id));
            })
            .expect("spawn economy disclosure replay test")
            .join()
            .expect("economy disclosure replay test completes");
    }
}
