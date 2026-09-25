use super::*;

const DEFAULT_ACTION_LIMIT: u8 = 8;
const DEFAULT_SPEECH_LIMIT: u8 = 2;
const MAX_ACTION_LIMIT: u8 = 16;
const MAX_SPEECH_LIMIT: u8 = 4;
const ESTIMATED_VOICE_CEILING_MICRODOLLARS: u64 = 2_000;

#[derive(Clone, Copy, Debug, Default, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub(super) enum DelegationScope {
    Speech,
    #[default]
    SpeechAndActions,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
pub(super) struct OwnerDelegation {
    pub(super) generation: u64,
    pub(super) enabled: bool,
    pub(super) scope: DelegationScope,
    pub(super) action_limit: u8,
    pub(super) actions_used: u8,
    pub(super) speech_limit: u8,
    pub(super) speech_used: u8,
    pub(super) goal_item_id: Option<u64>,
    pub(super) goal_status: String,
}

#[derive(Debug, Deserialize)]
pub(super) struct SetAvatarAutonomyRequest {
    actor_id: u64,
    actor_session: String,
    enabled: bool,
    #[serde(default)]
    scope: DelegationScope,
    action_limit: Option<u8>,
    speech_limit: Option<u8>,
    goal_item_id: Option<u64>,
    expected_generation: u64,
}

#[derive(Clone, Debug, Serialize)]
pub(super) struct AvatarAutonomyView {
    pub(super) generation: u64,
    pub(super) enabled: bool,
    pub(super) scope: DelegationScope,
    pub(super) action_limit: u8,
    pub(super) remaining_actions: u8,
    pub(super) speech_limit: u8,
    pub(super) remaining_speech: u8,
    pub(super) estimated_spend_limit_microdollars: u64,
    pub(super) goal_item_id: Option<u64>,
    pub(super) goal_status: String,
}

#[derive(Serialize)]
pub(super) struct SetAvatarAutonomyResponse {
    ok: bool,
    status: u32,
    avatar_autonomy: Option<AvatarAutonomyView>,
    events: Vec<EventView>,
}

impl RuntimeWorld {
    pub(super) fn actor_is_delegated_owner(&self, actor_id: u64) -> bool {
        self.actor_autonomy
            .get(&actor_id)
            .and_then(|state| state.owner_delegation.as_ref())
            .is_some_and(|delegation| delegation.enabled)
    }

    pub(super) fn avatar_autonomy_view(&self, actor_id: u64) -> AvatarAutonomyView {
        let delegated = self
            .actor_autonomy
            .get(&actor_id)
            .and_then(|state| state.owner_delegation.as_ref());
        match delegated {
            Some(value) => AvatarAutonomyView {
                generation: value.generation,
                enabled: value.enabled,
                scope: value.scope,
                action_limit: value.action_limit,
                remaining_actions: value.action_limit.saturating_sub(value.actions_used),
                speech_limit: value.speech_limit,
                remaining_speech: value.speech_limit.saturating_sub(value.speech_used),
                estimated_spend_limit_microdollars: u64::from(value.speech_limit)
                    .saturating_mul(ESTIMATED_VOICE_CEILING_MICRODOLLARS),
                goal_item_id: value.goal_item_id,
                goal_status: value.goal_status.clone(),
            },
            None => AvatarAutonomyView {
                generation: 0,
                enabled: false,
                scope: DelegationScope::SpeechAndActions,
                action_limit: DEFAULT_ACTION_LIMIT,
                remaining_actions: DEFAULT_ACTION_LIMIT,
                speech_limit: DEFAULT_SPEECH_LIMIT,
                remaining_speech: DEFAULT_SPEECH_LIMIT,
                estimated_spend_limit_microdollars: u64::from(DEFAULT_SPEECH_LIMIT)
                    * ESTIMATED_VOICE_CEILING_MICRODOLLARS,
                goal_item_id: None,
                goal_status: "none".to_string(),
            },
        }
    }

    pub(super) fn delegated_action_available(&self, actor_id: u64) -> bool {
        self.actor_autonomy
            .get(&actor_id)
            .and_then(|state| state.owner_delegation.as_ref())
            .map(|value| {
                value.enabled
                    && value.scope == DelegationScope::SpeechAndActions
                    && value.actions_used < value.action_limit
            })
            .unwrap_or(true)
    }

    pub(super) fn delegated_goal_pickup_action(&self, actor_id: u64) -> Option<CwAction> {
        let delegation = self
            .actor_autonomy
            .get(&actor_id)?
            .owner_delegation
            .as_ref()?;
        if !delegation.enabled
            || delegation.goal_status == "acquired"
            || delegation.scope != DelegationScope::SpeechAndActions
            || delegation.actions_used >= delegation.action_limit
        {
            return None;
        }
        let item = self.item_by_id(delegation.goal_item_id?)?;
        let actor = self.actor_by_id(actor_id)?;
        (item.holder_actor_id == 0 && item.location_id == actor.location_id).then_some(CwAction {
            kind: CW_ACTION_PICK_UP_ITEM,
            actor_id,
            item_id: item.id,
            ..CwAction::default()
        })
    }

    pub(super) fn delegated_action_allowed(&self, actor_id: u64, action_kind: u8) -> bool {
        match action_kind {
            CW_ACTION_NONE | CW_ACTION_COMBAT_PASS => true,
            CW_ACTION_SAY => self.delegated_speech_available(actor_id),
            _ => self.delegated_action_available(actor_id),
        }
    }

    pub(super) fn delegated_speech_available(&self, actor_id: u64) -> bool {
        self.actor_autonomy
            .get(&actor_id)
            .and_then(|state| state.owner_delegation.as_ref())
            .map(|value| value.enabled && value.speech_used < value.speech_limit)
            .unwrap_or(true)
    }

    pub(super) fn owner_delegation_generation(&self, actor_id: u64) -> Option<u64> {
        self.actor_autonomy
            .get(&actor_id)
            .and_then(|state| state.owner_delegation.as_ref())
            .filter(|value| value.enabled)
            .map(|value| value.generation)
    }

    pub(super) fn apply_owner_delegation(
        &mut self,
        actor_id: u64,
        delegation: OwnerDelegation,
        events: &mut Vec<EventView>,
    ) {
        let state = self.actor_autonomy.entry(actor_id).or_default();
        state.control_mode = if delegation.enabled {
            ActorControlMode::DelegatedAi
        } else {
            ActorControlMode::DirectInput
        };
        state.owner_delegation = Some(delegation.clone());
        let mut event = self.append_async_job_event(
            "avatar.autonomy.changed",
            actor_id,
            None,
            Some(if delegation.enabled {
                "Avatar autonomy is on.".to_string()
            } else {
                "Avatar autonomy is off.".to_string()
            }),
        );
        event.success = true;
        events.push(event);
    }

    pub(super) fn apply_delegated_speech_reservation(&mut self, actor_id: u64, generation: u64) {
        if let Some(value) = self
            .actor_autonomy
            .get_mut(&actor_id)
            .and_then(|state| state.owner_delegation.as_mut())
            .filter(|value| value.enabled && value.generation == generation)
        {
            value.speech_used = value.speech_used.saturating_add(1).min(value.speech_limit);
        }
    }

    pub(super) fn record_delegated_action(&mut self, actor_id: u64, action_kind: u8) {
        if matches!(
            action_kind,
            CW_ACTION_SAY | CW_ACTION_NONE | CW_ACTION_COMBAT_PASS
        ) {
            return;
        }
        let goal_item = self
            .actor_autonomy
            .get(&actor_id)
            .and_then(|state| state.owner_delegation.as_ref())
            .and_then(|value| value.goal_item_id);
        let goal_acquired = goal_item
            .and_then(|id| self.item_by_id(id))
            .is_some_and(|item| item.holder_actor_id == actor_id);
        if let Some(value) = self
            .actor_autonomy
            .get_mut(&actor_id)
            .and_then(|state| state.owner_delegation.as_mut())
            .filter(|value| value.enabled)
        {
            value.actions_used = value.actions_used.saturating_add(1).min(value.action_limit);
            if goal_acquired {
                value.goal_status = "acquired".to_string();
            } else if goal_item.is_some() && value.goal_status == "pending" {
                value.goal_status = "seeking".to_string();
            }
        }
    }
}

pub(super) async fn reserve_delegated_speech(
    state: &AppState,
    actor_id: u64,
) -> Result<Option<u64>, String> {
    let mut runtime = state.inner.lock().await;
    let Some(generation) = runtime.owner_delegation_generation(actor_id) else {
        if runtime
            .actor_autonomy
            .get(&actor_id)
            .and_then(|state| state.owner_delegation.as_ref())
            .is_some()
        {
            return Err("avatar autonomy was paused".to_string());
        }
        return Ok(None);
    };
    if !runtime.delegated_speech_available(actor_id) {
        return Err("avatar speech allowance is spent".to_string());
    }
    let actor = runtime
        .actor_by_id(actor_id)
        .ok_or_else(|| "avatar is unavailable".to_string())?;
    let record_action = CwAction {
        kind: CW_ACTION_NONE,
        actor_id,
        location_id: actor.location_id,
        ..CwAction::default()
    };
    let mut record = JournalRecord::new(record_action, runtime.next_seed_value()).into_system();
    record
        .projection_mutations
        .push(ProjectionMutation::ReserveDelegatedSpeech {
            actor_id,
            generation,
        });
    let (status, _) =
        commit_journal_record(state, &mut runtime, record).map_err(|error| error.to_string())?;
    if status != CW_OK {
        return Err("avatar speech allowance could not be reserved".to_string());
    }
    Ok(Some(generation))
}

pub(super) async fn set_avatar_autonomy(
    State(state): State<AppState>,
    Json(request): Json<SetAvatarAutonomyRequest>,
) -> Json<SetAvatarAutonomyResponse> {
    let reject = |status| {
        Json(SetAvatarAutonomyResponse {
            ok: false,
            status,
            avatar_autonomy: None,
            events: Vec::new(),
        })
    };
    let action_limit = request.action_limit.unwrap_or(DEFAULT_ACTION_LIMIT);
    let speech_limit = request.speech_limit.unwrap_or(DEFAULT_SPEECH_LIMIT);
    if request.enabled && (action_limit > MAX_ACTION_LIMIT || speech_limit > MAX_SPEECH_LIMIT) {
        return reject(400);
    }
    let action_limit = if request.scope == DelegationScope::Speech {
        0
    } else {
        action_limit
    };
    if request.enabled
        && (action_limit == 0 && speech_limit == 0
            || request.scope == DelegationScope::Speech && request.goal_item_id.is_some())
    {
        return reject(400);
    }
    refresh_actor_session_from_store(&state, &request.actor_session).ok();
    let mut runtime = state.inner.lock().await;
    if (request.enabled && actor_is_suspended(&state, request.actor_id))
        || actor_for_session(&state.actor_sessions, &request.actor_session)
            != Some(request.actor_id)
        || !runtime.actor_by_id(request.actor_id).is_some_and(|actor| {
            actor.kind == CW_ACTOR_HUMAN && (!request.enabled || RuntimeWorld::actor_can_act(actor))
        })
        || !matches!(
            runtime.actor_control_mode(request.actor_id),
            ActorControlMode::DirectInput | ActorControlMode::DelegatedAi
        )
    {
        return reject(403);
    }
    let current = runtime
        .actor_autonomy
        .get(&request.actor_id)
        .and_then(|value| value.owner_delegation.as_ref());
    if current.map(|value| value.generation).unwrap_or(0) != request.expected_generation
        || (request.enabled && current.is_some_and(|value| value.enabled))
        || (!request.enabled && !current.is_some_and(|value| value.enabled))
    {
        return reject(409);
    }
    let actor = runtime
        .actor_by_id(request.actor_id)
        .expect("validated actor");
    if request.enabled
        && request.goal_item_id.is_some_and(|item_id| {
            let Some(item) = runtime.item_by_id(item_id) else {
                return true;
            };
            let known_here = item.holder_actor_id == request.actor_id
                || (item.holder_actor_id == 0
                    && item.location_id == actor.location_id
                    && !runtime.forgotten_search_item_at_location(item, actor.location_id))
                || runtime
                    .actor_by_id(item.holder_actor_id)
                    .is_some_and(|holder| {
                        holder.location_id == actor.location_id
                            && runtime.economy_known_by(request.actor_id, holder.id)
                    });
            !known_here
                && runtime
                    .resident_best_item_memory(request.actor_id, item_id)
                    .is_none()
        })
    {
        return reject(400);
    }
    let generation = request.expected_generation.saturating_add(1);
    let delegation = if request.enabled {
        OwnerDelegation {
            generation,
            enabled: true,
            scope: request.scope,
            action_limit,
            actions_used: 0,
            speech_limit,
            speech_used: 0,
            goal_item_id: request.goal_item_id,
            goal_status: match request.goal_item_id {
                Some(item_id)
                    if runtime
                        .item_by_id(item_id)
                        .is_some_and(|item| item.holder_actor_id == request.actor_id) =>
                {
                    "acquired"
                }
                Some(_) => "pending",
                None => "none",
            }
            .to_string(),
        }
    } else {
        let Some(mut previous) = current.cloned() else {
            return reject(409);
        };
        previous.generation = generation;
        previous.enabled = false;
        previous
    };
    let action = CwAction {
        kind: CW_ACTION_NONE,
        actor_id: request.actor_id,
        location_id: actor.location_id,
        ..CwAction::default()
    };
    let mut record = JournalRecord::new(action, runtime.next_seed_value()).into_system();
    record
        .projection_mutations
        .push(ProjectionMutation::SetOwnerDelegation {
            actor_id: request.actor_id,
            delegation,
        });
    let Ok((status, events)) = commit_journal_record(&state, &mut runtime, record) else {
        return reject(503);
    };
    let location_id = actor.location_id;
    let view = runtime.avatar_autonomy_view(request.actor_id);
    drop(runtime);
    if status != CW_OK {
        return reject(status);
    }
    if request.enabled {
        ping_actor_session_for_actor(
            &state.actor_sessions,
            request.actor_id,
            &request.actor_session,
        );
        if let Some(path) = state.event_store_path.as_deref() {
            if let Err(error) = cancel_owner_chat_jobs(path, request.actor_id) {
                warn!(
                    "could not retire owner chat jobs for avatar {}: {}",
                    request.actor_id, error
                );
            }
        }
        if let Err(error) =
            schedule_delegated_owner_start(&state, request.actor_id, location_id, &events).await
        {
            warn!(
                "could not start owner avatar activity for {}: {}",
                request.actor_id, error
            );
        }
    }
    broadcast_events(&state, &events);
    Json(SetAvatarAutonomyResponse {
        ok: true,
        status,
        avatar_autonomy: Some(view),
        events,
    })
}

fn cancel_owner_chat_jobs(path: &Path, actor_id: u64) -> io::Result<usize> {
    let conn = open_event_store(path)?;
    conn.execute(
        "UPDATE actor_jobs SET status = 'completed', lease_until_ms = NULL,
         last_error = 'owner control changed', updated_at_ms = ?3
         WHERE kind = ?1 AND actor_id = ?2 AND status IN ('pending', 'running')",
        params![
            ACTOR_JOB_KIND_ORB_CHAT,
            actor_id as i64,
            now_millis() as i64
        ],
    )
    .map_err(sqlite_error)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn owner_allowance_survives_replay_and_only_a_new_start_refills_it() {
        let path = std::env::temp_dir().join(format!(
            "cosyworld-owner-autonomy-{}-{}.sqlite",
            std::process::id(),
            now_seed()
        ));
        let _ = std::fs::remove_file(&path);
        let mut runtime = RuntimeWorld::seeded();
        create_test_human(&mut runtime, 5000, RAIN_SOFT_GARDEN_LOCATION_ID, "Owner");
        let state = test_app_state(runtime, Some(path.clone()));
        {
            let conn = open_event_store(&path).unwrap();
            conn.execute(
                "INSERT INTO actor_jobs
                 (kind, actor_id, source_tick, observed_through_seq, status,
                  context_json, dedupe_key, created_at_ms, updated_at_ms)
                 VALUES (?1, ?2, 0, 0, 'pending', '{}', 'owner-before-delegation', 0, 0)",
                params![ACTOR_JOB_KIND_ORB_CHAT, 5000_i64],
            )
            .unwrap();
        }
        let (actor_session, _) = issue_actor_session(&state, 5000);
        let (other_session, _) = issue_actor_session(&state, 5001);
        let call = |enabled, expected_generation| SetAvatarAutonomyRequest {
            actor_id: 5000,
            actor_session: actor_session.clone(),
            enabled,
            scope: DelegationScope::SpeechAndActions,
            action_limit: Some(2),
            speech_limit: Some(1),
            goal_item_id: None,
            expected_generation,
        };

        let mut wrong_owner = call(true, 0);
        wrong_owner.actor_session = other_session;
        assert_eq!(
            set_avatar_autonomy(State(state.clone()), Json(wrong_owner))
                .await
                .0
                .status,
            403
        );
        let started = set_avatar_autonomy(State(state.clone()), Json(call(true, 0)))
            .await
            .0;
        assert!(started.ok);
        let old_chat_status: String = open_event_store(&path)
            .unwrap()
            .query_row(
                "SELECT status FROM actor_jobs WHERE dedupe_key = 'owner-before-delegation'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(old_chat_status, "completed");
        assert!(active_actor_ids_for_state(&state).contains(&5000));
        assert_eq!(started.avatar_autonomy.as_ref().unwrap().generation, 1);
        assert_eq!(
            state.inner.lock().await.actor_control_mode(5000),
            ActorControlMode::DelegatedAi
        );
        assert_eq!(
            chat_continuation_rejection(
                &*state.inner.lock().await,
                5000,
                1001,
                RAIN_SOFT_GARDEN_LOCATION_ID
            ),
            Some(ChatContinuationRejection::InitiatorControlChanged)
        );
        let duplicate = set_avatar_autonomy(State(state.clone()), Json(call(true, 1)))
            .await
            .0;
        assert_eq!(duplicate.status, 409);

        assert_eq!(
            reserve_delegated_speech(&state, 5000).await.unwrap(),
            Some(1)
        );
        assert!(reserve_delegated_speech(&state, 5000).await.is_err());
        let spent = reserve_delegated_speech(&state, 5000).await.unwrap_err();
        assert!(actor_job_error_is_parked_autonomy(
            &GeneratedSpeechError::Allowance(spent).to_string()
        ));
        let paused = set_avatar_autonomy(State(state.clone()), Json(call(false, 1)))
            .await
            .0;
        assert!(paused.ok);
        assert_eq!(paused.avatar_autonomy.as_ref().unwrap().remaining_speech, 0);
        assert_eq!(
            state.inner.lock().await.actor_control_mode(5000),
            ActorControlMode::DirectInput
        );
        assert!(state.inner.lock().await.client_actor_can_observe(5000));
        let stale = set_avatar_autonomy(State(state.clone()), Json(call(true, 1)))
            .await
            .0;
        assert_eq!(stale.status, 409);

        let mut replay = RuntimeWorld::seeded();
        create_test_human(&mut replay, 5000, RAIN_SOFT_GARDEN_LOCATION_ID, "Owner");
        for record in read_action_journal(&path).expect("read owner journal") {
            let (status, _) = replay.apply_journal_record(&record);
            assert_eq!(status, CW_OK);
        }
        assert_eq!(
            replay.actor_control_mode(5000),
            ActorControlMode::DirectInput
        );
        let restored = replay.avatar_autonomy_view(5000);
        assert_eq!(restored.generation, 2);
        assert_eq!(restored.remaining_speech, 0);

        let restarted_state = test_app_state(replay, Some(path.clone()));
        refresh_actor_session_from_store(&restarted_state, &actor_session).unwrap();
        assert_eq!(
            actor_for_session(&restarted_state.actor_sessions, &actor_session),
            Some(5000)
        );
        assert!(client_actor_read_authorized_for_state(
            &*restarted_state.inner.lock().await,
            &restarted_state,
            5000,
            Some(&actor_session),
            &AccessContext::default(),
        ));
        let restarted = set_avatar_autonomy(State(state.clone()), Json(call(true, 2)))
            .await
            .0;
        assert!(restarted.ok);
        assert_eq!(restarted.avatar_autonomy.unwrap().remaining_speech, 1);
        let _ = std::fs::remove_file(path);
    }

    #[test]
    fn delegated_action_scope_and_limit_are_enforced() {
        let mut runtime = RuntimeWorld::seeded();
        create_test_human(&mut runtime, 5000, RAIN_SOFT_GARDEN_LOCATION_ID, "Owner");
        runtime.apply_owner_delegation(
            5000,
            OwnerDelegation {
                generation: 1,
                enabled: true,
                scope: DelegationScope::SpeechAndActions,
                action_limit: 1,
                actions_used: 0,
                speech_limit: 1,
                speech_used: 0,
                goal_item_id: None,
                goal_status: "none".to_string(),
            },
            &mut Vec::new(),
        );
        assert!(runtime.delegated_action_available(5000));
        runtime.record_delegated_action(5000, CW_ACTION_REST);
        assert!(!runtime.delegated_action_available(5000));
        assert!(runtime.delegated_action_allowed(5000, CW_ACTION_SAY));
        runtime.apply_delegated_speech_reservation(5000, 1);
        assert!(!runtime.delegated_action_allowed(5000, CW_ACTION_SAY));
        assert!(!runtime.delegated_action_allowed(5000, CW_ACTION_REST));
        assert!(runtime.delegated_action_allowed(5000, CW_ACTION_COMBAT_PASS));
    }

    #[tokio::test]
    async fn hidden_goal_is_rejected_and_knocked_out_owner_can_pause() {
        let mut runtime = RuntimeWorld::seeded();
        create_test_human(&mut runtime, 5000, RAIN_SOFT_GARDEN_LOCATION_ID, "Owner");
        runtime.ensure_item(900001, CW_ITEM_KEEPSAKE, 0, 0);
        let state = test_app_state(runtime, None);
        let (actor_session, _) = issue_actor_session(&state, 5000);
        let request = |enabled, goal_item_id, expected_generation| SetAvatarAutonomyRequest {
            actor_id: 5000,
            actor_session: actor_session.clone(),
            enabled,
            scope: DelegationScope::SpeechAndActions,
            action_limit: Some(1),
            speech_limit: Some(1),
            goal_item_id,
            expected_generation,
        };
        assert_eq!(
            set_avatar_autonomy(State(state.clone()), Json(request(true, Some(900001), 0)))
                .await
                .0
                .status,
            400
        );
        assert!(
            set_avatar_autonomy(State(state.clone()), Json(request(true, None, 0)))
                .await
                .0
                .ok
        );
        {
            let mut runtime = state.inner.lock().await;
            let actor_count = runtime.world.actor_count;
            let actor = runtime.world.actors[..actor_count]
                .iter_mut()
                .find(|actor| actor.id == 5000)
                .unwrap();
            actor.status = CW_ACTOR_KNOCKED_OUT;
        }
        assert!(
            set_avatar_autonomy(State(state.clone()), Json(request(false, None, 1)))
                .await
                .0
                .ok
        );
    }

    #[tokio::test]
    async fn disclosed_item_goal_tracks_canonical_pickup_and_snapshot() {
        let mut runtime = RuntimeWorld::seeded();
        create_test_human(&mut runtime, 5000, RAIN_SOFT_GARDEN_LOCATION_ID, "Owner");
        runtime.ensure_item(900002, CW_ITEM_KEEPSAKE, RAIN_SOFT_GARDEN_LOCATION_ID, 0);
        let state = test_app_state(runtime, None);
        let (actor_session, _) = issue_actor_session(&state, 5000);
        let started = set_avatar_autonomy(
            State(state.clone()),
            Json(SetAvatarAutonomyRequest {
                actor_id: 5000,
                actor_session,
                enabled: true,
                scope: DelegationScope::SpeechAndActions,
                action_limit: Some(2),
                speech_limit: Some(0),
                goal_item_id: Some(900002),
                expected_generation: 0,
            }),
        )
        .await
        .0;
        assert!(started.ok);
        assert_eq!(started.avatar_autonomy.unwrap().goal_status, "pending");
        let mut runtime = state.inner.lock().await;
        let mut pickup = JournalRecord::new(
            CwAction {
                kind: CW_ACTION_PICK_UP_ITEM,
                actor_id: 5000,
                item_id: 900002,
                ..CwAction::default()
            },
            runtime.next_seed_value(),
        );
        pickup.origin = JournalOrigin::ActorConsequence;
        pickup.source_world_tick = Some(runtime.world.tick);
        assert_eq!(runtime.apply_journal_record(&pickup).0, CW_OK);
        let view = runtime.avatar_autonomy_view(5000);
        assert_eq!(view.goal_status, "acquired");
        assert_eq!(view.remaining_actions, 1);
        let restored = RuntimeSnapshot::from_runtime(&runtime)
            .into_runtime()
            .unwrap();
        assert_eq!(restored.avatar_autonomy_view(5000).goal_status, "acquired");
        assert_eq!(restored.avatar_autonomy_view(5000).remaining_actions, 1);
    }

    #[tokio::test]
    async fn final_reserved_speech_slot_can_publish_and_pause_blocks_new_reservations() {
        let mut runtime = RuntimeWorld::seeded();
        create_test_human(&mut runtime, 5000, RAIN_SOFT_GARDEN_LOCATION_ID, "Owner");
        let state = test_app_state(runtime, None);
        let (actor_session, _) = issue_actor_session(&state, 5000);
        let request = |enabled, generation| SetAvatarAutonomyRequest {
            actor_id: 5000,
            actor_session: actor_session.clone(),
            enabled,
            scope: DelegationScope::Speech,
            action_limit: Some(0),
            speech_limit: Some(1),
            goal_item_id: None,
            expected_generation: generation,
        };
        assert!(
            set_avatar_autonomy(State(state.clone()), Json(request(true, 0)))
                .await
                .0
                .ok
        );
        assert_eq!(
            reserve_delegated_speech(&state, 5000).await.unwrap(),
            Some(1)
        );
        {
            let mut runtime = state.inner.lock().await;
            assert!(!runtime.delegated_speech_available(5000));
            let content_id = runtime.next_content_id_value();
            let mut speech = JournalRecord::new(
                CwAction {
                    kind: CW_ACTION_SAY,
                    actor_id: 5000,
                    content_id,
                    ..CwAction::default()
                },
                runtime.next_seed_value(),
            );
            speech
                .content_upserts
                .insert(content_id, "A bounded hello.".to_string());
            let (status, events) = runtime.apply_journal_record(&speech);
            assert_eq!(status, CW_OK);
            assert!(events
                .iter()
                .any(|event| event.type_name == "message.created"));
        }
        assert!(
            set_avatar_autonomy(State(state.clone()), Json(request(false, 1)))
                .await
                .0
                .ok
        );
        assert!(reserve_delegated_speech(&state, 5000).await.is_err());
        assert!(
            set_avatar_autonomy(State(state.clone()), Json(request(true, 2)))
                .await
                .0
                .ok
        );
        assert_eq!(
            state.inner.lock().await.owner_delegation_generation(5000),
            Some(3)
        );
    }

    #[tokio::test]
    async fn solo_owner_start_commits_a_goal_action_without_paid_inference() {
        let path = std::env::temp_dir().join(format!(
            "cosyworld-owner-first-action-{}-{}.sqlite",
            std::process::id(),
            now_seed()
        ));
        let _ = std::fs::remove_file(&path);
        let mut runtime = RuntimeWorld::seeded();
        create_test_human(&mut runtime, 5000, RAIN_SOFT_GARDEN_LOCATION_ID, "Owner");
        let state = test_app_state(runtime, Some(path.clone()));
        let (actor_session, _) = issue_actor_session(&state, 5000);
        let started = set_avatar_autonomy(
            State(state.clone()),
            Json(SetAvatarAutonomyRequest {
                actor_id: 5000,
                actor_session,
                enabled: true,
                scope: DelegationScope::SpeechAndActions,
                action_limit: Some(1),
                speech_limit: Some(0),
                goal_item_id: Some(DEWBRIGHT_BUTTON_ITEM_ID),
                expected_generation: 0,
            }),
        )
        .await
        .0;
        assert!(started.ok);
        release_pending_actor_jobs(&path, ACTOR_JOB_KIND_PLAYER_TICK).unwrap();
        let job = claim_next_actor_job_of_kind(&path, ACTOR_JOB_KIND_PLAYER_TICK)
            .unwrap()
            .expect("Start queues a bounded owner room response");
        let ActorJobPayload::PlayerTick(observation) = job.payload else {
            panic!("Start queues a room observation");
        };
        complete_player_tick_observation(&state, observation)
            .await
            .unwrap();
        let runtime = state.inner.lock().await;
        assert_eq!(
            runtime
                .item_by_id(DEWBRIGHT_BUTTON_ITEM_ID)
                .unwrap()
                .holder_actor_id,
            5000
        );
        assert_eq!(runtime.avatar_autonomy_view(5000).remaining_actions, 0);
        assert_eq!(runtime.avatar_autonomy_view(5000).goal_status, "acquired");
        let _ = std::fs::remove_file(path);
    }

    #[tokio::test]
    async fn owner_goal_outside_the_story_hand_waits_for_a_legal_offer() {
        let path = std::env::temp_dir().join(format!(
            "cosyworld-owner-outside-hand-{}-{}.sqlite",
            std::process::id(),
            now_seed()
        ));
        let _ = std::fs::remove_file(&path);
        let mut runtime = RuntimeWorld::seeded();
        create_test_human(&mut runtime, 5000, RAIN_SOFT_GARDEN_LOCATION_ID, "Owner");
        runtime.ensure_item(900003, CW_ITEM_KEEPSAKE, RAIN_SOFT_GARDEN_LOCATION_ID, 0);
        let (_, offers) = runtime.legal_action_candidates(Some(5000), &AccessContext::default());
        let hand = runtime.action_hand_for(Some(5000), &offers);
        assert!(offers
            .iter()
            .any(|offer| { offer.target.as_ref().and_then(|target| target.id) == Some(900003) }));
        assert!(!hand.entries.iter().any(|entry| {
            entry.offer_ids.iter().any(|offer_id| {
                offers.iter().any(|offer| {
                    offer.offer_id == *offer_id
                        && offer.target.as_ref().and_then(|target| target.id) == Some(900003)
                })
            })
        }));
        let state = test_app_state(runtime, Some(path.clone()));
        let (actor_session, _) = issue_actor_session(&state, 5000);
        let started = set_avatar_autonomy(
            State(state.clone()),
            Json(SetAvatarAutonomyRequest {
                actor_id: 5000,
                actor_session,
                enabled: true,
                scope: DelegationScope::SpeechAndActions,
                action_limit: Some(1),
                speech_limit: Some(0),
                goal_item_id: Some(900003),
                expected_generation: 0,
            }),
        )
        .await
        .0;
        assert!(started.ok);
        release_pending_actor_jobs(&path, ACTOR_JOB_KIND_PLAYER_TICK).unwrap();
        let job = claim_next_actor_job_of_kind(&path, ACTOR_JOB_KIND_PLAYER_TICK)
            .unwrap()
            .expect("Start queues a room response");
        let ActorJobPayload::PlayerTick(observation) = job.payload else {
            panic!("Start queues a room observation");
        };
        complete_player_tick_observation(&state, observation)
            .await
            .unwrap();
        let runtime = state.inner.lock().await;
        assert_eq!(runtime.item_by_id(900003).unwrap().holder_actor_id, 0);
        assert_eq!(runtime.avatar_autonomy_view(5000).goal_status, "seeking");
        let _ = std::fs::remove_file(path);
    }

    #[tokio::test]
    async fn solo_talk_start_plans_an_owner_reply_without_an_action() {
        let path = std::env::temp_dir().join(format!(
            "cosyworld-owner-first-reply-{}-{}.sqlite",
            std::process::id(),
            now_seed()
        ));
        let _ = std::fs::remove_file(&path);
        let mut runtime = RuntimeWorld::seeded();
        create_test_human(&mut runtime, 5000, RAIN_SOFT_GARDEN_LOCATION_ID, "Owner");
        let state = test_app_state(runtime, Some(path.clone()));
        let (actor_session, _) = issue_actor_session(&state, 5000);
        let started = set_avatar_autonomy(
            State(state.clone()),
            Json(SetAvatarAutonomyRequest {
                actor_id: 5000,
                actor_session: actor_session.clone(),
                enabled: true,
                scope: DelegationScope::Speech,
                action_limit: Some(0),
                speech_limit: Some(1),
                goal_item_id: None,
                expected_generation: 0,
            }),
        )
        .await
        .0;
        assert!(started.ok);
        release_pending_actor_jobs(&path, ACTOR_JOB_KIND_PLAYER_TICK).unwrap();
        let job = claim_next_actor_job_of_kind(&path, ACTOR_JOB_KIND_PLAYER_TICK)
            .unwrap()
            .expect("Start queues a room response");
        let ActorJobPayload::PlayerTick(observation) = job.payload else {
            panic!("Start queues a room observation");
        };
        let (reply, _, _) = complete_player_tick_observation(&state, observation)
            .await
            .unwrap();
        assert_eq!(
            reply.expect("Talk Start plans a reply").speaker_actor_id,
            5000
        );
        assert_eq!(
            reserve_delegated_speech(&state, 5000).await.unwrap(),
            Some(1)
        );
        {
            let runtime = state.inner.lock().await;
            assert_eq!(runtime.avatar_autonomy_view(5000).remaining_actions, 0);
            assert_eq!(runtime.avatar_autonomy_view(5000).remaining_speech, 0);
        }
        assert!(
            set_avatar_autonomy(
                State(state.clone()),
                Json(SetAvatarAutonomyRequest {
                    actor_id: 5000,
                    actor_session,
                    enabled: false,
                    scope: DelegationScope::Speech,
                    action_limit: Some(0),
                    speech_limit: Some(1),
                    goal_item_id: None,
                    expected_generation: 1,
                }),
            )
            .await
            .0
            .ok
        );
        assert_eq!(
            state.inner.lock().await.owner_delegation_generation(5000),
            None
        );
        assert!(reserve_delegated_speech(&state, 5000).await.is_err());
        let _ = std::fs::remove_file(path);
    }
}
