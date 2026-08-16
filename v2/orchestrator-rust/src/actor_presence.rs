use super::*;

#[derive(Debug, Deserialize)]
pub(super) struct RenewAvatarSessionRequest {
    actor_id: u64,
    actor_session: Option<String>,
    wallet_session: Option<String>,
    #[serde(default)]
    rotate: bool,
}

#[derive(Debug, Serialize)]
pub(super) struct RenewAvatarSessionResponse {
    ok: bool,
    status: u32,
    actor: Option<ActorView>,
    actor_session: Option<String>,
    actor_session_expires_at_unix: Option<u64>,
    renewed: bool,
    handoff: bool,
    previous_actor_id: Option<u64>,
}

fn initialize_avatar_session_handoff_schema(path: &Path) -> io::Result<()> {
    let conn = open_event_store(path)?;
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS avatar_session_handoffs (
            from_actor_id INTEGER PRIMARY KEY,
            to_actor_id INTEGER NOT NULL,
            reason TEXT NOT NULL,
            created_at_ms INTEGER NOT NULL,
            updated_at_ms INTEGER NOT NULL,
            consumed_count INTEGER NOT NULL DEFAULT 0,
            last_consumed_at_ms INTEGER,
            retired_at_ms INTEGER
        );
        CREATE INDEX IF NOT EXISTS idx_avatar_session_handoffs_target
            ON avatar_session_handoffs(to_actor_id, retired_at_ms);",
    )
    .map_err(sqlite_error)
}

fn avatar_session_handoff_target(state: &AppState, from_actor_id: u64) -> io::Result<Option<u64>> {
    let Some(path) = state.event_store_path.as_deref() else {
        return Ok(None);
    };
    init_event_store(path)?;
    initialize_avatar_session_handoff_schema(path)?;
    let conn = open_event_store(path)?;
    let target = conn
        .query_row(
            "SELECT to_actor_id
             FROM avatar_session_handoffs
             WHERE from_actor_id = ?1 AND retired_at_ms IS NULL",
            params![from_actor_id as i64],
            |row| row.get::<_, i64>(0),
        )
        .optional()
        .map_err(sqlite_error)?;
    Ok(target
        .filter(|actor_id| *actor_id > 0)
        .map(|actor_id| actor_id as u64))
}

fn exchange_actor_session_for_handoff(
    state: &AppState,
    previous_token: &str,
    from_actor_id: u64,
    to_actor_id: u64,
) -> io::Result<(String, ActorSession)> {
    let token = previous_token.trim();
    if token.is_empty() || from_actor_id == to_actor_id {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            "avatar session handoff is invalid",
        ));
    }
    let Some(path) = state.event_store_path.as_deref() else {
        return Err(io::Error::new(
            io::ErrorKind::Unsupported,
            "avatar session handoff requires a durable event store",
        ));
    };
    init_event_store(path)?;
    initialize_avatar_session_handoff_schema(path)?;

    let mut sessions = state
        .actor_sessions
        .lock()
        .map_err(|_| io::Error::other("actor session lock was poisoned"))?;
    let new_token = random_hex(32);
    let ttl = Duration::from_secs(30 * 24 * 60 * 60);
    let now_unix = now_unix_secs();
    let expires_at_unix = now_unix + ttl.as_secs();
    let now = Instant::now();
    if !sessions
        .sessions
        .get(token)
        .is_some_and(|session| session.actor_id == from_actor_id && session.expires_at > now)
    {
        return Err(io::Error::new(
            io::ErrorKind::PermissionDenied,
            "source avatar session is no longer valid",
        ));
    }
    let new_session = ActorSession {
        actor_id: to_actor_id,
        expires_at: now + ttl,
        expires_at_unix,
        last_seen_at: inactive_presence_seen_at(now),
        explicitly_inactive: false,
    };
    let now_ms = now_millis() as i64;
    let mut conn = open_event_store(path)?;
    let tx = conn
        .transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)
        .map_err(sqlite_error)?;
    let approved_target = tx
        .query_row(
            "SELECT to_actor_id
             FROM avatar_session_handoffs
             WHERE from_actor_id = ?1 AND retired_at_ms IS NULL",
            params![from_actor_id as i64],
            |row| row.get::<_, i64>(0),
        )
        .optional()
        .map_err(sqlite_error)?;
    if approved_target != Some(to_actor_id as i64) {
        return Err(io::Error::new(
            io::ErrorKind::PermissionDenied,
            "avatar session handoff is not approved",
        ));
    }
    let retired = tx
        .execute(
            "DELETE FROM actor_sessions
             WHERE session_token = ?1 AND actor_id = ?2 AND expires_at_unix > ?3",
            params![token, from_actor_id as i64, now_unix as i64],
        )
        .map_err(sqlite_error)?;
    if retired != 1 {
        return Err(io::Error::new(
            io::ErrorKind::PermissionDenied,
            "source avatar session is no longer valid",
        ));
    }
    tx.execute(
        "INSERT INTO actor_sessions
            (session_token, actor_id, expires_at_unix, created_at_ms, updated_at_ms)
         VALUES (?1, ?2, ?3, ?4, ?4)",
        params![
            &new_token,
            to_actor_id as i64,
            expires_at_unix as i64,
            now_ms,
        ],
    )
    .map_err(sqlite_error)?;
    tx.execute(
        "UPDATE avatar_session_handoffs
         SET consumed_count = consumed_count + 1,
             last_consumed_at_ms = ?1,
             updated_at_ms = ?1
         WHERE from_actor_id = ?2 AND to_actor_id = ?3 AND retired_at_ms IS NULL",
        params![now_ms, from_actor_id as i64, to_actor_id as i64],
    )
    .map_err(sqlite_error)?;
    tx.commit().map_err(sqlite_error)?;

    sessions.sessions.remove(token);
    sessions
        .sessions
        .insert(new_token.clone(), new_session.clone());
    Ok((new_token, new_session))
}

fn actor_session_record(
    actor_sessions: &StdMutex<ActorSessions>,
    actor_id: u64,
    session_token: &str,
) -> Option<ActorSession> {
    let token = session_token.trim();
    if token.is_empty() {
        return None;
    }
    let now = Instant::now();
    let Ok(mut sessions) = actor_sessions.lock() else {
        return None;
    };
    sessions
        .sessions
        .retain(|_, session| session.expires_at > now);
    sessions
        .sessions
        .get(token)
        .filter(|session| session.actor_id == actor_id)
        .cloned()
}

fn retire_actor_session(state: &AppState, session_token: &str) -> io::Result<()> {
    let token = session_token.trim();
    if token.is_empty() {
        return Ok(());
    }
    if let Some(path) = state.event_store_path.as_deref() {
        init_event_store(path)?;
        let conn = open_event_store(path)?;
        conn.execute(
            "DELETE FROM actor_sessions WHERE session_token = ?1",
            params![token],
        )
        .map_err(sqlite_error)?;
    }
    if let Ok(mut sessions) = state.actor_sessions.lock() {
        sessions.sessions.remove(token);
    }
    Ok(())
}

pub(super) async fn renew_avatar_session(
    ConnectInfo(client_addr): ConnectInfo<SocketAddr>,
    State(state): State<AppState>,
    Json(payload): Json<RenewAvatarSessionRequest>,
) -> Json<RenewAvatarSessionResponse> {
    let rejected = |status| {
        Json(RenewAvatarSessionResponse {
            ok: false,
            status,
            actor: None,
            actor_session: None,
            actor_session_expires_at_unix: None,
            renewed: false,
            handoff: false,
            previous_actor_id: None,
        })
    };
    if !allow_actor_mutation(
        &state,
        client_addr,
        payload.actor_id,
        "avatar-session-actor",
        GENERAL_ACTION_LIMIT,
    ) {
        return rejected(RATE_LIMITED_STATUS);
    }
    if let Some(token) = payload.actor_session.as_deref() {
        if let Err(error) = refresh_actor_session_from_store(&state, token) {
            warn!(
                "failed to load CosyWorld actor session for renewal: {}",
                error
            );
        }
    }

    let existing_session = payload.actor_session.as_deref().and_then(|token| {
        (actor_for_session(&state.actor_sessions, token) == Some(payload.actor_id))
            .then(|| actor_session_record(&state.actor_sessions, payload.actor_id, token))
            .flatten()
            .map(|session| (token.to_string(), session))
    });
    let wallet_authorized = payload
        .wallet_session
        .as_deref()
        .and_then(|token| wallet_for_session(&state.wallet_sessions, token))
        .and_then(|wallet| linked_actor_for_wallet(&state, &wallet))
        == Some(payload.actor_id);
    if existing_session.is_none() && !wallet_authorized {
        return rejected(403);
    }
    let handoff_target = if existing_session.is_some() {
        match avatar_session_handoff_target(&state, payload.actor_id) {
            Ok(target) => target,
            Err(error) => {
                warn!(
                    "failed to load CosyWorld avatar session handoff for {}: {}",
                    payload.actor_id, error
                );
                return rejected(500);
            }
        }
    } else {
        None
    };
    let effective_actor_id = handoff_target.unwrap_or(payload.actor_id);
    if actor_is_suspended(&state, payload.actor_id)
        || actor_is_suspended(&state, effective_actor_id)
    {
        return rejected(403);
    }

    let actor = {
        let runtime = state.inner.lock().await;
        runtime
            .actor_by_id(effective_actor_id)
            .filter(|actor| runtime.client_actor_can_observe(actor.id))
            .map(|actor| runtime.actor_view(actor))
    };
    let Some(actor) = actor else {
        // A terminal or missing actor cannot be resurrected by credential
        // renewal. Character creation is a separate, authoritative choice.
        return rejected(409);
    };

    let replaced_session = if payload.rotate && handoff_target.is_none() {
        existing_session.as_ref().map(|(token, _)| token.clone())
    } else {
        None
    };
    let (actor_session, actor_session_record, renewed) =
        if let Some(target_actor_id) = handoff_target {
            let Some((source_token, _)) = existing_session.as_ref() else {
                return rejected(403);
            };
            match exchange_actor_session_for_handoff(
                &state,
                source_token,
                payload.actor_id,
                target_actor_id,
            ) {
                Ok(session) => (session.0, session.1, true),
                Err(error) => {
                    warn!(
                        "failed to exchange CosyWorld avatar session from {} to {}: {}",
                        payload.actor_id, target_actor_id, error
                    );
                    return rejected(if error.kind() == io::ErrorKind::PermissionDenied {
                        403
                    } else {
                        500
                    });
                }
            }
        } else if let Some((token, session)) = existing_session.filter(|_| !payload.rotate) {
            (token, session, false)
        } else {
            let (token, session) = issue_actor_session(&state, effective_actor_id);
            (token, session, true)
        };
    if let Some(replaced_session) = replaced_session {
        if let Err(error) = retire_actor_session(&state, &replaced_session) {
            warn!(
                "failed to retire rotated CosyWorld actor session for {}: {}",
                payload.actor_id, error
            );
            return rejected(500);
        }
    }
    record_daily_visit(&state, effective_actor_id);
    Json(RenewAvatarSessionResponse {
        ok: true,
        status: CW_OK,
        actor: Some(actor),
        actor_session: Some(actor_session),
        actor_session_expires_at_unix: Some(actor_session_record.expires_at_unix),
        renewed,
        handoff: handoff_target.is_some(),
        previous_actor_id: handoff_target.map(|_| payload.actor_id),
    })
}

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

    pub(super) fn can_summon_avatar_for_rescue(&self, actor_id: u64) -> bool {
        let downed_direct_avatar = self.actor_by_id(actor_id).is_some_and(|actor| {
            actor.kind == CW_ACTOR_HUMAN
                && actor.status == CW_ACTOR_KNOCKED_OUT
                && self.actor_control_mode(actor.id).is_direct_input()
        });
        if !downed_direct_avatar {
            return false;
        }
        if self
            .avatar_rescues
            .values()
            .any(|rescue| rescue.status == "active" && rescue.rescuer_actor_id == actor_id)
        {
            return true;
        }
        !self
            .avatar_rescues
            .values()
            .any(|rescue| rescue.status == "active" && rescue.downed_actor_id == actor_id)
    }

    pub(super) fn avatar_lifecycle_primary_action(&self, actor_id: u64) -> Option<PrimaryAction> {
        let Some(actor) = self.actor_by_id(actor_id) else {
            return Some(create_avatar_primary_action());
        };

        // Knockout keeps the body in the world but opens a linked-account
        // rescue run. The replacement is a rescuer, not a reconnect prompt.
        if Self::actor_is_present(actor) && !Self::actor_can_act(actor) {
            return Some(PrimaryAction {
                kind: "create_rescuer".to_string(),
                label: "Create Rescuer".to_string(),
                command: "create rescuer".to_string(),
                disabled: false,
                options: Vec::new(),
            });
        }
        (!Self::actor_can_act(actor)).then(create_avatar_primary_action)
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
                .map(|ids| ids.contains(&actor.id) || self.actor_holds_blocking_room_turn(actor))
                .unwrap_or(true);
        }
        if self.avatar_hidden_until_discovered(actor) {
            return self.avatar_discovered(actor.id);
        }
        true
    }

    pub(super) fn actor_target_visible_in_projection(
        &self,
        actor: CwActor,
        client_actor_id: Option<u64>,
        active_direct_actor_ids: Option<&BTreeSet<u64>>,
    ) -> bool {
        if !self.actor_visible_in_projection(actor, client_actor_id, active_direct_actor_ids) {
            return false;
        }
        if Self::actor_can_act(actor)
            && !self.actor_uses_inference(actor.id)
            && Some(actor.id) != client_actor_id
        {
            return active_direct_actor_ids
                .map(|ids| ids.contains(&actor.id))
                .unwrap_or(true);
        }
        true
    }

    fn actor_holds_blocking_room_turn(&self, actor: CwActor) -> bool {
        Self::actor_can_act(actor)
            && combat_turn_view(self, actor.id, actor.location_id)
                .is_some_and(|turn| turn.current_actor_id == Some(actor.id))
    }
}

fn create_avatar_primary_action() -> PrimaryAction {
    PrimaryAction {
        kind: "create_avatar".to_string(),
        label: "Create Avatar".to_string(),
        command: "create avatar".to_string(),
        disabled: false,
        options: Vec::new(),
    }
}

pub(super) fn summon_avatar_primary_action() -> PrimaryAction {
    PrimaryAction {
        kind: "summon_avatar".to_string(),
        label: "Summon a New Avatar".to_string(),
        command: "summon avatar".to_string(),
        disabled: false,
        options: Vec::new(),
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
        let eligible = |target: &&CwActor| {
            target.id != actor_id
                && Self::actor_can_act(**target)
                && target.location_id == actor.location_id
                && !self.actors_blocked(actor_id, target.id)
                && self.actor_target_visible_in_projection(
                    **target,
                    Some(actor_id),
                    active_direct_actor_ids,
                )
                && self.active_bond(actor_id, target.id).is_none()
        };
        let actors = &self.world.actors[..self.world.actor_count];
        actors
            .iter()
            .filter(eligible)
            .find(|target| self.relationship_contract(target.id).is_some())
            .or_else(|| actors.iter().find(eligible))
            .copied()
    }

    pub(super) fn validate_offer(
        &self,
        actor_id: u64,
        access: &AccessContext,
        submission: &ActionOfferSubmissionRequest,
        active_direct_actor_ids: &BTreeSet<u64>,
        model_config: Option<&AiConfig>,
    ) -> Result<(), &'static str> {
        self.validate_action_offer_submission_with_presence(
            actor_id,
            access,
            submission,
            Some(active_direct_actor_ids),
            model_config,
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
            && self.actor_target_visible_in_projection(
                target,
                Some(actor.id),
                Some(active_direct_actor_ids),
            )
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn browser_adopts_only_an_explicit_session_handoff() {
        for contract in [
            "let actorSessionHandoffChecked = false;",
            "Number(response?.previous_actor_id || 0)",
            "actorId = nextActorId;",
            "rememberActorSession(result, { allowHandoff: handoff })",
        ] {
            assert!(
                INDEX_HTML.contains(contract),
                "missing browser contract: {contract}"
            );
        }
    }

    fn insert_actor_presence_wallet_session(state: &AppState, token: &str, wallet_address: &str) {
        state
            .wallet_sessions
            .lock()
            .expect("wallet sessions")
            .sessions
            .insert(
                token.to_string(),
                WalletSession {
                    wallet_address: wallet_address.to_string(),
                    linked_wallet_addresses: Vec::new(),
                    expires_at: Instant::now() + Duration::from_secs(3600),
                },
            );
    }

    fn command_request(actor_id: u64, command: &str) -> CommandRequest {
        CommandRequest {
            actor_id,
            actor_session: None,
            command: command.to_string(),
            offer_id: None,
            wallet_session: None,
            envelope: None,
        }
    }

    #[test]
    fn authored_relationship_is_the_default_bond_target_ahead_of_seed_order() {
        const TEST_ACTOR_ID: u64 = 5000;
        const MARA_ACTOR_ID: u64 = 8301;
        const LANTERN_INN_LOCATION_ID: u64 = 800;

        let mut runtime = RuntimeWorld::seeded();
        create_test_human(
            &mut runtime,
            TEST_ACTOR_ID,
            LANTERN_INN_LOCATION_ID,
            "Road Listener",
        );
        for actor in &mut runtime.world.actors[..runtime.world.actor_count] {
            if actor.id == RATI_ACTOR_ID || actor.id == MARA_ACTOR_ID {
                actor.location_id = LANTERN_INN_LOCATION_ID;
            }
        }
        let source_seq = runtime.world.next_event_seq;
        assert!(runtime
            .mark_visit_ledger(
                TEST_ACTOR_ID,
                "learned_truth",
                "The road lamps have failed.",
                source_seq,
                "test:authored-default-bond",
            )
            .is_some());
        assert!(runtime
            .bank_visit_ledger(TEST_ACTOR_ID, "test:authored-default-bond")
            .is_some());

        let target = runtime
            .default_bondable_resident_with_presence(TEST_ACTOR_ID, None)
            .expect("one eligible co-present resident");

        assert_eq!(target.id, MARA_ACTOR_ID);
        assert!(runtime.relationship_contract(target.id).is_some());

        let state = runtime.state_response(Some(TEST_ACTOR_ID), &AccessContext::default());
        let offer = state
            .action_offers
            .iter()
            .find(|offer| offer.kind == "create_bond")
            .expect("authored relationship becomes a legal action offer");
        assert_eq!(
            offer.target.as_ref().and_then(|target| target.id),
            Some(MARA_ACTOR_ID)
        );
        assert!(offer.command.starts_with("bond Mara Wick: "));
        let resolved = runtime
            .resolve_command(
                &command_request(TEST_ACTOR_ID, &offer.command),
                &AccessContext::default(),
            )
            .expect("the published relationship command parses through the CLI boundary");
        assert!(matches!(
            resolved.dispatch,
            CommandDispatch::CreateBond {
                target_actor_id: MARA_ACTOR_ID,
                ..
            }
        ));
    }

    #[tokio::test]
    async fn a_dead_avatar_is_offered_a_new_beginning_rather_than_ordinary_actions() {
        let mut runtime = RuntimeWorld::seeded();
        create_test_human(&mut runtime, 5000, COSY_COTTAGE_LOCATION_ID, "Ended Tale");

        // Alive, the avatar receives ordinary play.
        let alive = runtime.state_response_with_presence(
            Some(5000),
            &AccessContext::default(),
            Some(&BTreeSet::from([5000])),
            false,
        );
        assert_ne!(alive.primary_action.kind, "create_avatar");

        let actor = runtime
            .world
            .actors
            .iter_mut()
            .take(runtime.world.actor_count)
            .find(|actor| actor.id == 5000)
            .expect("the avatar exists");
        actor.status = CW_ACTOR_DEAD;

        // Dead, the avatar still resolves through actor_by_id, so it used to
        // fall through to ordinary actions: the client showed "this tale has
        // ended" while the hand dealt Notice, and taking it failed as a stale
        // offer with no way forward.
        let ended = runtime.state_response_with_presence(
            Some(5000),
            &AccessContext::default(),
            Some(&BTreeSet::from([5000])),
            false,
        );
        assert_eq!(
            ended.primary_action.kind, "create_avatar",
            "a dead avatar must be offered a new beginning",
        );
        assert!(
            !ended.primary_action.disabled,
            "the new beginning must be reachable",
        );
    }

    #[tokio::test]
    async fn knocked_out_avatar_keeps_its_identity_and_receives_no_unplayable_hand() {
        let mut runtime = RuntimeWorld::seeded();
        create_test_human(
            &mut runtime,
            5000,
            COSY_COTTAGE_LOCATION_ID,
            "Downed Traveler",
        );
        let actor = runtime
            .world
            .actors
            .iter_mut()
            .take(runtime.world.actor_count)
            .find(|actor| actor.id == 5000)
            .expect("the avatar exists");
        actor.status = CW_ACTOR_KNOCKED_OUT;

        // The body and its canonical identity stay in the world, but the
        // player holding it has no legal mutation until rescue or recovery.
        let downed = runtime.state_response_with_presence(
            Some(5000),
            &AccessContext::default(),
            Some(&BTreeSet::from([5000])),
            false,
        );
        assert_eq!(
            downed.primary_action.kind, "create_rescuer",
            "a knocked-out avatar must expose the linked rescue run",
        );
        assert!(!downed.primary_action.disabled);
        assert!(
            downed.action_offers.is_empty(),
            "a knocked-out avatar must not be dealt offers it cannot submit: {:?}",
            downed
                .action_offers
                .iter()
                .map(|offer| offer.kind.clone())
                .collect::<Vec<_>>(),
        );
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
        runtime.observe_room_for_actor(RATI_ACTOR_ID, COSY_COTTAGE_LOCATION_ID);
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
        // Present and observable does not mean playable. The one available
        // lifecycle action starts a linked rescue run without removing it.
        assert_eq!(observer_view.primary_action.kind, "create_rescuer");
        assert!(!observer_view.primary_action.disabled);
        assert!(observer_view.action_offers.is_empty());

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
    async fn avatar_session_recovery_rotates_only_for_the_same_observable_actor() {
        let mut runtime = RuntimeWorld::seeded();
        create_test_human(
            &mut runtime,
            5000,
            MOONLIT_TRAIL_LOCATION_ID,
            "Fallen Door Walker",
        );
        runtime.world.actors[..runtime.world.actor_count]
            .iter_mut()
            .find(|actor| actor.id == 5000)
            .expect("linked avatar")
            .status = CW_ACTOR_KNOCKED_OUT;
        let actor_count = runtime.world.actor_count;
        let state = test_app_state(runtime, None);
        let wallet_address = "wallet-shared-by-every-door";
        let wallet_session = "wallet-session-shared-by-every-door";
        insert_actor_presence_wallet_session(&state, wallet_session, wallet_address);
        link_wallet_actor(&state, wallet_address, 5000);

        let recovered = renew_avatar_session(
            ConnectInfo("127.0.0.1:45115".parse().expect("client address")),
            State(state.clone()),
            Json(RenewAvatarSessionRequest {
                actor_id: 5000,
                actor_session: Some("expired-door-session".to_string()),
                wallet_session: Some(wallet_session.to_string()),
                rotate: false,
            }),
        )
        .await
        .0;
        assert!(recovered.ok, "{recovered:?}");
        assert!(recovered.renewed);
        assert_eq!(
            recovered
                .actor
                .as_ref()
                .map(|actor| (actor.id, actor.status.as_str())),
            Some((5000, "knocked_out"))
        );
        let recovered_token = recovered
            .actor_session
            .clone()
            .expect("recovery issues a replacement credential");

        let checked = renew_avatar_session(
            ConnectInfo("127.0.0.1:45115".parse().expect("client address")),
            State(state.clone()),
            Json(RenewAvatarSessionRequest {
                actor_id: 5000,
                actor_session: Some(recovered_token.clone()),
                wallet_session: None,
                rotate: false,
            }),
        )
        .await
        .0;
        assert!(checked.ok, "{checked:?}");
        assert!(!checked.renewed);
        assert_eq!(
            checked.actor_session.as_deref(),
            Some(recovered_token.as_str())
        );

        let (parallel_token, _) = issue_actor_session(&state, 5000);
        let rotated = renew_avatar_session(
            ConnectInfo("127.0.0.1:45115".parse().expect("client address")),
            State(state.clone()),
            Json(RenewAvatarSessionRequest {
                actor_id: 5000,
                actor_session: Some(recovered_token.clone()),
                wallet_session: None,
                rotate: true,
            }),
        )
        .await
        .0;
        assert!(rotated.ok, "{rotated:?}");
        assert!(rotated.renewed);
        let rotated_token = rotated
            .actor_session
            .clone()
            .expect("rotation issues a fresh credential");
        assert_ne!(rotated_token, recovered_token);
        assert_eq!(
            actor_for_session(&state.actor_sessions, &recovered_token),
            None,
            "the replaced credential must not keep presence alive",
        );
        assert_eq!(
            actor_for_session(&state.actor_sessions, &parallel_token),
            Some(5000),
            "rotation must preserve other legitimate door sessions",
        );

        let wrong_actor = renew_avatar_session(
            ConnectInfo("127.0.0.1:45115".parse().expect("client address")),
            State(state.clone()),
            Json(RenewAvatarSessionRequest {
                actor_id: 5001,
                actor_session: Some(rotated_token.clone()),
                wallet_session: None,
                rotate: true,
            }),
        )
        .await
        .0;
        assert!(!wrong_actor.ok, "{wrong_actor:?}");
        assert_eq!(wrong_actor.status, 403);

        state.inner.lock().await.world.actors[..actor_count]
            .iter_mut()
            .find(|actor| actor.id == 5000)
            .expect("linked avatar")
            .status = CW_ACTOR_DEAD;
        let terminal = renew_avatar_session(
            ConnectInfo("127.0.0.1:45115".parse().expect("client address")),
            State(state.clone()),
            Json(RenewAvatarSessionRequest {
                actor_id: 5000,
                actor_session: Some(rotated_token),
                wallet_session: None,
                rotate: true,
            }),
        )
        .await
        .0;
        assert!(!terminal.ok, "{terminal:?}");
        assert_eq!(terminal.status, 409);
        assert_eq!(state.inner.lock().await.world.actor_count, actor_count);
    }

    #[tokio::test]
    async fn approved_avatar_session_handoff_atomically_moves_the_browser_to_its_authored_actor() {
        let path = std::env::temp_dir().join(format!(
            "cosyworld-avatar-session-handoff-{}-{}.sqlite",
            std::process::id(),
            now_seed()
        ));
        let _ = fs::remove_file(&path);
        let mut runtime = RuntimeWorld::seeded();
        create_test_human(
            &mut runtime,
            5000,
            RAIN_SOFT_GARDEN_LOCATION_ID,
            "Temporary Browser Avatar",
        );
        runtime
            .actor_autonomy
            .entry(RATI_ACTOR_ID)
            .or_default()
            .control_mode = ActorControlMode::DirectInput;
        let state = test_app_state(runtime, Some(path.clone()));
        let (source_session, _) = issue_actor_session(&state, 5000);
        initialize_avatar_session_handoff_schema(&path).expect("initialize handoff schema");
        let conn = open_event_store(&path).expect("open handoff event store");
        let now_ms = now_millis() as i64;
        conn.execute(
            "INSERT INTO avatar_session_handoffs
                (from_actor_id, to_actor_id, reason, created_at_ms, updated_at_ms)
             VALUES (?1, ?2, ?3, ?4, ?4)",
            params![
                5000_i64,
                RATI_ACTOR_ID as i64,
                "confirmed human identity",
                now_ms,
            ],
        )
        .expect("stage approved avatar handoff");
        drop(conn);

        let response = renew_avatar_session(
            ConnectInfo("127.0.0.1:45115".parse().expect("client address")),
            State(state.clone()),
            Json(RenewAvatarSessionRequest {
                actor_id: 5000,
                actor_session: Some(source_session.clone()),
                wallet_session: None,
                rotate: false,
            }),
        )
        .await
        .0;

        assert!(response.ok, "{response:?}");
        assert!(response.renewed);
        assert!(response.handoff);
        assert_eq!(response.previous_actor_id, Some(5000));
        assert_eq!(
            response.actor.as_ref().map(|actor| actor.id),
            Some(RATI_ACTOR_ID)
        );
        let target_session = response
            .actor_session
            .as_deref()
            .expect("handoff returns a replacement credential");
        assert_ne!(target_session, source_session);
        assert_eq!(
            actor_for_session(&state.actor_sessions, &source_session),
            None,
            "the source credential must be retired",
        );
        assert_eq!(
            actor_for_session(&state.actor_sessions, target_session),
            Some(RATI_ACTOR_ID),
        );

        let conn = open_event_store(&path).expect("reopen handoff event store");
        let old_count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM actor_sessions WHERE session_token = ?1",
                params![source_session],
                |row| row.get(0),
            )
            .expect("query retired source session");
        let persisted_target: i64 = conn
            .query_row(
                "SELECT actor_id FROM actor_sessions WHERE session_token = ?1",
                params![target_session],
                |row| row.get(0),
            )
            .expect("query persisted target session");
        let consumed_count: i64 = conn
            .query_row(
                "SELECT consumed_count FROM avatar_session_handoffs WHERE from_actor_id = ?1",
                params![5000_i64],
                |row| row.get(0),
            )
            .expect("query handoff audit count");
        assert_eq!(old_count, 0);
        assert_eq!(persisted_target, RATI_ACTOR_ID as i64);
        assert_eq!(consumed_count, 1);
        drop(conn);
        drop(state);
        let _ = fs::remove_file(path);
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

    #[tokio::test]
    async fn blocked_player_sees_lapsed_turn_holder_on_every_room_roster() {
        let mut runtime = RuntimeWorld::seeded();
        create_test_human(
            &mut runtime,
            5000,
            RAIN_SOFT_GARDEN_LOCATION_ID,
            "First Worker",
        );
        create_test_human(
            &mut runtime,
            5001,
            RAIN_SOFT_GARDEN_LOCATION_ID,
            "Second Worker",
        );
        for actor_id in [5000, 5001] {
            runtime
                .actor_autonomy
                .entry(actor_id)
                .or_default()
                .control_mode = ActorControlMode::DirectInput;
        }
        let job = runtime
            .jobs
            .get_mut(FIRST_TALE_JOB_ID)
            .expect("focused fixture job");
        job.status = "active".to_string();
        job.focused_profile = Some(FOCUSED_WORK_PROFILE.to_string());
        job.focused_encounter = Some(FocusedJobEncounterState {
            version: 1,
            encounter_id: 90_416,
            profile_id: FOCUSED_WORK_PROFILE_ID.to_string(),
            profile_version: FOCUSED_WORK_PROFILE_VERSION,
            location_id: RAIN_SOFT_GARDEN_LOCATION_ID,
            phase: "work".to_string(),
            participant_order: vec![5000, 5001],
            current_index: 0,
            round: 1,
            setup_remaining: 1,
            status: "active".to_string(),
        });

        let state = test_app_state(runtime, None);
        let (holder_session, _) = issue_actor_session(&state, 5000);
        let (blocked_session, _) = issue_actor_session(&state, 5001);
        assert_eq!(
            ping_actor_session_for_actor(&state.actor_sessions, 5000, &holder_session),
            Some(false)
        );
        assert_eq!(
            ping_actor_session_for_actor(&state.actor_sessions, 5001, &blocked_session),
            Some(false)
        );
        assert!(mark_actor_session_inactive(
            &state.actor_sessions,
            5000,
            &holder_session,
        ));
        let active_direct_actor_ids = active_actor_ids_for_state(&state);
        assert!(!active_direct_actor_ids.contains(&5000));
        assert!(active_direct_actor_ids.contains(&5001));

        let runtime = state.inner.lock().await;
        let mut projected = runtime.state_response_with_presence(
            Some(5001),
            &AccessContext::default(),
            Some(&active_direct_actor_ids),
            false,
        );
        projected.turn = room_turn_view_for_runtime(
            &state,
            &runtime,
            RAIN_SOFT_GARDEN_LOCATION_ID,
            Some(5001),
            &active_direct_actor_ids,
        );
        assert_eq!(projected.turn.current_actor_id, Some(5000));
        assert_eq!(
            projected.turn.current_actor_name.as_deref(),
            Some("First Worker")
        );
        assert!(projected.actors.iter().any(|actor| actor.id == 5000));
        assert!(projected.actors.iter().any(|actor| actor.id == 5001));
        assert!(!projected.action_offers.iter().any(|offer| {
            offer
                .target
                .as_ref()
                .is_some_and(|target| target.kind == "actor" && target.id == Some(5000))
        }));

        let world = runtime.world_response_with_presence(
            Some(5001),
            &AccessContext::default(),
            Some(&active_direct_actor_ids),
        );
        let room = world
            .locations
            .iter()
            .find(|location| location.id == RAIN_SOFT_GARDEN_LOCATION_ID)
            .expect("blocked player's room is visible");
        assert!(room.actors.iter().any(|actor| actor.id == 5000));
        assert!(room.actors.iter().any(|actor| actor.id == 5001));

        let blocked_actor = runtime.actor_by_id(5001).expect("blocked actor");
        let look = runtime.room_command_output(
            blocked_actor,
            &AccessContext::default(),
            Some(&active_direct_actor_ids),
        );
        assert!(look.contains("First Worker"));
        assert!(look.contains("Second Worker"));

        let rejection = actor_turn_rejection(&state, &runtime, 5001)
            .expect("the second worker is blocked by the focused turn")
            .0;
        assert_eq!(rejection.status, 423);
        let blocker = rejection.events.first().expect("waiting event");
        assert_eq!(blocker.actor_id, Some(5000));
        assert_eq!(blocker.actor_name.as_deref(), Some("First Worker"));
        assert!(projected
            .actors
            .iter()
            .any(|actor| Some(actor.id) == blocker.actor_id));
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
        runtime.beliefs.clear();
        runtime.remember_belief(
            resident.id,
            BELIEF_KIND_ITEM_LOCATION,
            sought_item_id,
            resident.location_id,
            BELIEF_TUNING.firsthand_confidence,
            BELIEF_TUNING.firsthand_salience,
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
