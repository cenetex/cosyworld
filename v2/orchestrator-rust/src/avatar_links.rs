use super::*;

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
    if !state.allow_rate_limit(
        rate_limit_key("avatar-ip", client_ip_key(client_addr)),
        AVATAR_CREATE_LIMIT,
    ) {
        return avatar_rate_limited_response();
    }
    let _creation_guard = state.avatar_creation_lock.lock().await;
    let summon_from_actor_id = payload.summon_from_actor_id;
    let signed_wallet = payload
        .wallet_session
        .as_deref()
        .and_then(|token| wallet_for_session(&state.wallet_sessions, token));
    if summon_from_actor_id.is_some() && signed_wallet.is_none() {
        return Json(AvatarResponse {
            ok: false,
            status: 403,
            actor: None,
            actor_session: None,
            actor_session_expires_at_unix: None,
            events: Vec::new(),
        });
    }
    if let Some(wallet_address) = signed_wallet.as_deref() {
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
                if actor_id != downed_actor_id
                    || !runtime.can_summon_avatar_for_rescue(downed_actor_id)
                {
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
    // Avatar creation is a card action, so it commits with a deterministic
    // identity immediately. Unnamed avatars are refined by AI after the
    // response has returned and announced over the event stream.
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
    let action = CwAction {
        kind: CW_ACTION_CREATE_ACTOR,
        actor_id,
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
    if let Some(downed_actor_id) = summon_from_actor_id {
        let summon_is_still_valid = signed_wallet.as_deref().is_some_and(|wallet_address| {
            linked_actor_for_wallet(&state, wallet_address) == Some(downed_actor_id)
        }) && runtime.can_summon_avatar_for_rescue(downed_actor_id);
        if !summon_is_still_valid {
            return Json(AvatarResponse {
                ok: false,
                status: 409,
                actor: None,
                actor_session: None,
                actor_session_expires_at_unix: None,
                events: Vec::new(),
            });
        }
        record
            .projection_mutations
            .push(ProjectionMutation::StartAvatarRescueRun { downed_actor_id });
    }
    record.actor_meta_upserts.insert(actor_id, actor_meta);
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
