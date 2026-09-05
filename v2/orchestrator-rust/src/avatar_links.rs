use super::*;

#[derive(Debug, Serialize)]
pub(super) struct AvatarResponse {
    pub(super) ok: bool,
    pub(super) status: u32,
    pub(super) actor: Option<ActorView>,
    pub(super) actor_session: Option<String>,
    pub(super) actor_session_expires_at_unix: Option<u64>,
    pub(super) events: Vec<EventView>,
}

#[derive(Debug, Deserialize)]
pub(super) struct CreateAvatarRequest {
    #[serde(default)]
    pub(super) actor_id: Option<u64>,
    pub(super) name: Option<String>,
    pub(super) calling: Option<String>,
    pub(super) wallet_session: Option<String>,
    #[serde(default)]
    pub(super) summon_from_actor_id: Option<u64>,
    pub(super) character_creation_id: Option<String>,
    pub(super) character_choice_id: Option<String>,
    pub(super) species_id: Option<String>,
    pub(super) origin_id: Option<String>,
}

pub(super) fn linked_actor_for_wallet(state: &AppState, wallet_address: &str) -> Option<u64> {
    let wallet = wallet_address.trim();
    if wallet.is_empty() {
        return None;
    }
    state
        .wallet_actor_links
        .lock()
        .ok()
        .and_then(|links| links.get(wallet).copied())
        .filter(|id| account_avatars::wallet_avatar_is_unclaimed(state, *id))
}

pub(super) fn link_wallet_actor(state: &AppState, wallet_address: &str, actor_id: u64) {
    let wallet = wallet_address.trim();
    if wallet.is_empty() || actor_id == 0 {
        return;
    }
    if let Ok(mut links) = state.wallet_actor_links.lock() {
        links.insert(wallet.to_string(), actor_id);
    }
    if let Some(path) = state.event_store_path.as_deref() {
        if let Err(error) = persist_wallet_actor_link(path, wallet, actor_id) {
            warn!(
                "failed to persist CosyWorld wallet avatar link for {} -> {}: {}",
                wallet, actor_id, error
            );
        }
    }
}

pub(super) fn signed_wallet_can_summon_avatar(
    state: &AppState,
    runtime: &RuntimeWorld,
    actor_id: u64,
    access: &AccessContext,
) -> bool {
    access.signed_wallet_session
        && access
            .owner_wallet_address
            .as_deref()
            .and_then(|wallet| linked_actor_for_wallet(state, wallet))
            == Some(actor_id)
        && !actor_is_suspended(state, actor_id)
        && runtime.can_summon_avatar_for_rescue(actor_id)
}

fn avatar_rate_limited_response() -> Json<AvatarResponse> {
    Json(AvatarResponse {
        ok: false,
        status: RATE_LIMITED_STATUS,
        actor: None,
        actor_session: None,
        actor_session_expires_at_unix: None,
        events: Vec::new(),
    })
}

pub(super) async fn create_avatar(
    ConnectInfo(client_addr): ConnectInfo<SocketAddr>,
    State(state): State<AppState>,
    Json(payload): Json<CreateAvatarRequest>,
) -> Json<AvatarResponse> {
    create_avatar_with_account(client_addr, state, payload, None).await
}

pub(super) async fn create_avatar_with_account(
    client_addr: SocketAddr,
    state: AppState,
    payload: CreateAvatarRequest,
    account: Option<String>,
) -> Json<AvatarResponse> {
    if !state.allow_rate_limit(
        rate_limit_key("avatar-ip", client_ip_key(client_addr)),
        AVATAR_CREATE_LIMIT,
    ) {
        return avatar_rate_limited_response();
    }
    let _creation_guard = state.avatar_creation_lock.lock().await;
    let summon_from_actor_id = payload.summon_from_actor_id.or(payload.actor_id);
    let signed_wallet = payload
        .wallet_session
        .as_deref()
        .and_then(|token| wallet_for_session(&state.wallet_sessions, token));
    if summon_from_actor_id.is_some() && signed_wallet.is_none() && account.is_none() {
        return Json(AvatarResponse {
            ok: false,
            status: 403,
            actor: None,
            actor_session: None,
            actor_session_expires_at_unix: None,
            events: Vec::new(),
        });
    }
    let mut rescue_creation_context = None;
    if let Some(account) = account.as_deref() {
        let rejected = |status| {
            Json(AvatarResponse {
                ok: false,
                status,
                actor: None,
                actor_session: None,
                actor_session_expires_at_unix: None,
                events: Vec::new(),
            })
        };
        let owned = match account_avatars::account_avatar_store(&state)
            .and_then(|conn| account_avatars::owned_account_avatars(&conn, account))
        {
            Ok(owned) => owned,
            Err(_) => return rejected(503),
        };
        let runtime = state.inner.lock().await;
        if let Some(downed_id) = summon_from_actor_id {
            if !owned.contains(&downed_id) || actor_is_suspended(&state, downed_id) {
                return rejected(403);
            }
            rescue_creation_context = runtime.avatar_rescue_creation_context(
                downed_id,
                avatar_rescue_account_key(&format!("account:{account}")),
            );
            if rescue_creation_context.is_none() {
                return rejected(409);
            }
        } else if let Some(actor) = owned
            .into_iter()
            .filter_map(|id| runtime.actor_by_id(id))
            .find(|actor| runtime.client_actor_can_observe(actor.id))
        {
            if actor_is_suspended(&state, actor.id) {
                return rejected(403);
            }
            let view = runtime.actor_view(actor);
            drop(runtime);
            let (token, session) = issue_actor_session(&state, actor.id);
            return Json(AvatarResponse {
                ok: true,
                status: CW_OK,
                actor: Some(view),
                actor_session: Some(token),
                actor_session_expires_at_unix: Some(session.expires_at_unix),
                events: Vec::new(),
            });
        }
    }
    if let Some(wallet_address) = signed_wallet
        .as_deref()
        .filter(|_| rescue_creation_context.is_none())
    {
        if let Some(actor_id) = linked_actor_for_wallet(&state, wallet_address) {
            if actor_is_suspended(&state, actor_id) {
                return Json(AvatarResponse {
                    ok: false,
                    status: 403,
                    actor: None,
                    actor_session: None,
                    actor_session_expires_at_unix: None,
                    events: Vec::new(),
                });
            }
            let runtime = state.inner.lock().await;
            if let Some(downed_actor_id) = summon_from_actor_id {
                if actor_id != downed_actor_id {
                    return Json(AvatarResponse {
                        ok: false,
                        status: 409,
                        actor: None,
                        actor_session: None,
                        actor_session_expires_at_unix: None,
                        events: Vec::new(),
                    });
                }
                rescue_creation_context = runtime.avatar_rescue_creation_context(
                    actor_id,
                    avatar_rescue_account_key(wallet_address),
                );
                if rescue_creation_context.is_none() {
                    return Json(AvatarResponse {
                        ok: false,
                        status: 409,
                        actor: None,
                        actor_session: None,
                        actor_session_expires_at_unix: None,
                        events: Vec::new(),
                    });
                }
            } else if let Some(actor) = runtime
                .actor_by_id(actor_id)
                .filter(|actor| runtime.client_actor_can_observe(actor.id))
                .map(|actor| runtime.actor_view(actor))
            {
                drop(runtime);
                let (actor_session, actor_session_record) = issue_actor_session(&state, actor_id);
                record_daily_visit(&state, actor_id);
                return Json(AvatarResponse {
                    ok: true,
                    status: CW_OK,
                    actor: Some(actor),
                    actor_session: Some(actor_session),
                    actor_session_expires_at_unix: Some(actor_session_record.expires_at_unix),
                    events: Vec::new(),
                });
            }
        } else if summon_from_actor_id.is_some() {
            return Json(AvatarResponse {
                ok: false,
                status: 409,
                actor: None,
                actor_session: None,
                actor_session_expires_at_unix: None,
                events: Vec::new(),
            });
        }
    }

    let selection_requested = payload.character_creation_id.is_some()
        || payload.character_choice_id.is_some()
        || payload.species_id.is_some()
        || payload.origin_id.is_some();
    let character_selection = if selection_requested {
        let Some(selection) = character_creation_selection(
            payload.character_creation_id.as_deref(),
            payload.character_choice_id.as_deref(),
            payload.species_id.as_deref(),
            payload.origin_id.as_deref(),
        ) else {
            return Json(AvatarResponse {
                ok: false,
                status: 400,
                actor: None,
                actor_session: None,
                actor_session_expires_at_unix: None,
                events: Vec::new(),
            });
        };
        Some(selection)
    } else {
        None
    };
    let actor_id = {
        let mut runtime = state.inner.lock().await;
        let actor_id = runtime.next_actor_id;
        runtime.next_actor_id = runtime.next_actor_id.saturating_add(1);
        actor_id
    };
    let initial_calling = character_selection
        .as_ref()
        .and_then(|selection| selection.class.as_ref())
        .map(|class| class.calling.clone())
        .or_else(|| {
            payload
                .calling
                .as_deref()
                .and_then(authored_calling_statement)
        })
        .unwrap_or_else(|| default_calling_statement().to_string());
    let entry_location_id = character_selection
        .as_ref()
        .map(|selection| selection.profile.entry_location_id)
        .or_else(|| content_registry().entry_location_id());
    let Some(entry_location_id) = entry_location_id else {
        return Json(AvatarResponse {
            ok: false,
            status: 503,
            actor: None,
            actor_session: None,
            actor_session_expires_at_unix: None,
            events: Vec::new(),
        });
    };
    let naming_context = avatar_naming_context(character_selection.as_ref());
    let base_identity = cosyworld_ai_model::generate_avatar_identity_with_naming(
        actor_id,
        payload.name.as_deref(),
        active_content().manifest.avatar_naming.as_ref(),
        naming_context.as_ref(),
    )
    .into();
    let identity = apply_avatar_creation_flavor(
        base_identity,
        character_selection.as_ref(),
        &initial_calling,
    );
    let actor_meta = ActorMeta {
        name: identity.name.clone(),
        speech_mode: "prose".to_string(),
        title: identity.title.clone(),
        description: identity.description.clone(),
    };
    let mut runtime = state.inner.lock().await;
    let (action_kind, target_actor_id, content_id, item_id) = match rescue_creation_context.as_ref()
    {
        Some(AvatarRescueCreationContext::Cascade { previous, .. }) => (
            CW_ACTION_REPLACE_AVATAR_RESCUER,
            previous.downed_actor_id,
            previous.rescuer_actor_id,
            previous.draught_item_id,
        ),
        _ => (CW_ACTION_CREATE_ACTOR, 0, 0, 0),
    };
    let action = CwAction {
        kind: action_kind,
        actor_id,
        target_actor_id,
        content_id,
        item_id,
        location_id: entry_location_id,
        modifier: character_selection
            .as_ref()
            .is_some_and(|selection| selection.profile.schema_version == 2)
            .then_some(-1)
            .unwrap_or_default(),
        ..CwAction::default()
    };
    let mut record = JournalRecord::new(action, runtime.next_seed_value());
    record.initial_calling = Some(initial_calling.clone());
    record.initial_skill = character_selection
        .as_ref()
        .and_then(|selection| selection.class.as_ref())
        .map(|class| class.starting_skill_id.clone());
    if let Some(selection) = character_selection
        .as_ref()
        .filter(|selection| selection.profile.schema_version == 2)
    {
        record.initial_character_profile_id = Some(selection.profile.id.clone());
        record.initial_species_id = selection.species.as_ref().map(|card| card.id.clone());
        record.initial_origin_id = selection.origin.as_ref().map(|card| card.id.clone());
        record.initial_physical_description = Some(identity.visual_prompt.clone());
    }
    record.actor_meta_upserts.insert(actor_id, actor_meta);
    if let Some(context) = rescue_creation_context.as_ref() {
        let (account_key, downed_actor_id) = match context {
            AvatarRescueCreationContext::Begin {
                account_key,
                downed_actor_id,
            }
            | AvatarRescueCreationContext::Cascade {
                account_key,
                downed_actor_id,
                ..
            } => (account_key.clone(), *downed_actor_id),
        };
        let rescue = runtime.new_avatar_rescue_state(account_key, downed_actor_id, actor_id);
        record
            .projection_mutations
            .push(runtime.rescue_draught_materialization(&rescue));
        record.projection_mutations.push(match context {
            AvatarRescueCreationContext::Begin { .. } => {
                ProjectionMutation::BeginAvatarRescue { rescue }
            }
            AvatarRescueCreationContext::Cascade { previous, .. } => {
                ProjectionMutation::CascadeAvatarRescue {
                    previous_rescue_id: previous.id.clone(),
                    rescue,
                }
            }
        });
    }
    if let Some(host) = runtime.welcome_host_for(entry_location_id) {
        record
            .projection_mutations
            .push(ProjectionMutation::PlaceResident {
                actor_id: host.id,
                location_id: entry_location_id,
                reason: "welcome_new_avatar".to_string(),
            });
    }
    let Ok((status, events)) = commit_journal_record(&state, &mut runtime, record) else {
        return Json(AvatarResponse {
            ok: false,
            status: 500,
            actor: None,
            actor_session: None,
            actor_session_expires_at_unix: None,
            events: Vec::new(),
        });
    };
    let actor = runtime
        .actor_by_id(actor_id)
        .map(|actor| runtime.actor_view(actor));
    let actor_observation =
        player_tick_observation(&runtime, Some(entry_location_id), actor_id, status, &events);
    drop(runtime);
    let (actor_session, actor_session_record) = issue_actor_session(&state, actor_id);
    if status == CW_OK {
        if let Some(account) = account.as_deref() {
            if !account_avatars::account_avatar_store(&state)
                .and_then(|conn| account_avatars::claim_account_avatar(&conn, account, actor_id))
                .unwrap_or(false)
            {
                warn!(
                    actor_id,
                    "avatar account save needs a retry with its issued actor session"
                );
            }
        }
        if let Some(wallet_address) = signed_wallet.as_deref() {
            link_wallet_actor(&state, wallet_address, actor_id);
        }
        record_avatar_created(&state, actor_id);
        record_daily_visit(&state, actor_id);
        if payload.name.is_none() {
            schedule_avatar_identity_refinement(
                &state,
                actor_id,
                character_selection.clone(),
                initial_calling.clone(),
                identity.clone(),
            );
        }
    }

    broadcast_events(&state, &events);
    if let Some(observation) = actor_observation {
        schedule_player_tick_observation(&state, observation);
    }
    Json(AvatarResponse {
        ok: status == CW_OK,
        status,
        actor,
        actor_session: (status == CW_OK).then_some(actor_session),
        actor_session_expires_at_unix: (status == CW_OK)
            .then_some(actor_session_record.expires_at_unix),
        events,
    })
}
