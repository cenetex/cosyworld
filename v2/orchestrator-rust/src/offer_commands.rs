use super::*;

const MAX_OFFER_ID_CHARS: usize = 2_048;

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
struct ParsedOfferId<'a> {
    rules_profile: &'a str,
    state_revision: u64,
    local_id: &'a str,
}

fn parse_offer_id(value: &str) -> Option<ParsedOfferId<'_>> {
    let value = value.trim();
    if value.is_empty() || value.chars().count() > MAX_OFFER_ID_CHARS {
        return None;
    }
    let mut parts = value.splitn(3, ':');
    let rules_profile = parts.next()?.trim();
    let state_revision = parts.next()?.parse().ok()?;
    let local_id = parts.next()?.trim();
    if rules_profile.is_empty() || local_id.is_empty() {
        return None;
    }
    Some(ParsedOfferId {
        rules_profile,
        state_revision,
        local_id,
    })
}

fn offer_error(
    offer_id: &str,
    kind: CommandErrorKind,
    status: u32,
    output: impl Into<String>,
) -> CommandError {
    offer_command_error(offer_id, kind, status, output)
}

fn select_current_offer(
    runtime: &RuntimeWorld,
    actor_id: u64,
    access: &AccessContext,
    offer_id: &str,
) -> Result<RankedActionOffer, CommandError> {
    let Some(parsed) = parse_offer_id(offer_id) else {
        return Err(offer_error(
            offer_id,
            CommandErrorKind::InvalidOfferId,
            400,
            "That offer_id is malformed. Refresh the scene and submit an identifier from action_offers.",
        ));
    };
    let current_revision = runtime.current_state_revision();
    if parsed.state_revision != current_revision {
        return Err(offer_error(
            offer_id,
            CommandErrorKind::StaleOffer,
            409,
            format!(
                "That offer expired at state revision {}; the current revision is {current_revision}. Refresh the scene and choose again.",
                parsed.state_revision
            ),
        ));
    }
    let (_, offers) = runtime.legal_action_candidates(Some(actor_id), access);
    let exact = offers.into_iter().find(|offer| offer.offer_id == offer_id);
    if let Some(offer) = exact.as_ref().filter(|offer| offer.disabled) {
        return Err(offer_error(
            offer_id,
            CommandErrorKind::DisabledOffer,
            409,
            offer.disabled_reason.clone().unwrap_or_else(|| {
                "That projected action is currently disabled. Refresh the scene and choose an enabled offer."
                    .to_string()
            }),
        ));
    }
    if let Some(offer) = exact {
        return Ok(offer);
    }
    Err(offer_error(
        offer_id,
        CommandErrorKind::UnknownOffer,
        404,
        format!(
            "That offer_id is not in the current action_offers for rules profile {}. Refresh the scene and choose a published offer.",
            parsed.rules_profile
        ),
    ))
}

fn required_target_id(offer: &RankedActionOffer, kind: &str) -> Result<u64, CommandError> {
    offer
        .target
        .as_ref()
        .filter(|target| target.kind == kind)
        .and_then(|target| target.id)
        .ok_or_else(|| {
            offer_error(
                &offer.offer_id,
                CommandErrorKind::UnknownOffer,
                409,
                "That published offer no longer has its authoritative target. Refresh the scene.",
            )
        })
}

fn stable_parts<'a>(offer: &'a RankedActionOffer, prefix: &str) -> Option<Vec<&'a str>> {
    offer
        .id
        .strip_prefix(prefix)
        .map(|rest| rest.split(':').collect())
}

fn dispatch_for_offer(
    runtime: &RuntimeWorld,
    actor_id: u64,
    offer: &RankedActionOffer,
) -> Result<CommandDispatch, CommandError> {
    if let Some(project) = offer.project.as_ref() {
        if let Some(strategy_id) = project.strategy_id.as_ref() {
            return Ok(CommandDispatch::Contribute {
                job_id: project.id.clone(),
                strategy_id: strategy_id.clone(),
                action_kind: offer.kind.clone(),
            });
        }
    }
    let invalid = || {
        offer_error(
            &offer.offer_id,
            CommandErrorKind::UnknownOffer,
            409,
            "That published offer no longer has an actionable structured binding. Refresh the scene.",
        )
    };
    match offer.kind.as_str() {
        "move" => Ok(CommandDispatch::Move {
            destination_location_id: required_target_id(offer, "location")?,
        }),
        "explore_path" => Ok(CommandDispatch::Scout {
            destination_location_id: required_target_id(offer, "location")?,
        }),
        "flee" => Ok(CommandDispatch::Flee {
            destination_location_id: required_target_id(offer, "location")?,
        }),
        "check" => Ok(CommandDispatch::Check),
        "study" => Ok(CommandDispatch::Study),
        "influence" => Ok(CommandDispatch::Influence {
            target_actor_id: required_target_id(offer, "actor")?,
        }),
        "cast_spell" => {
            let item = runtime.default_spell_card(actor_id).ok_or_else(invalid)?;
            Ok(CommandDispatch::CastSpell {
                item_id: item.id,
                target_actor_id: actor_id,
            })
        }
        "pick_up" => Ok(CommandDispatch::PickUp {
            item_id: required_target_id(offer, "item")?,
        }),
        "drop_item" => Ok(CommandDispatch::Drop {
            item_id: required_target_id(offer, "item")?,
        }),
        "use_item" => {
            let parts = stable_parts(offer, "use_item:").ok_or_else(invalid)?;
            let [item_id, target_actor_id] = parts.as_slice() else {
                return Err(invalid());
            };
            Ok(CommandDispatch::UseItem {
                item_id: item_id.parse().map_err(|_| invalid())?,
                target_actor_id: target_actor_id.parse().map_err(|_| invalid())?,
            })
        }
        "search" => {
            let target = runtime
                .default_search_target(actor_id)
                .ok_or_else(invalid)?;
            if offer.target.as_ref().is_none_or(|published| {
                published.kind != "feature" || published.id != Some(target.location_id)
            }) {
                return Err(invalid());
            }
            Ok(CommandDispatch::SearchFeature {
                location_id: target.location_id,
                feature_key: target.key,
                feature_name: target.name,
                output: target.output,
            })
        }
        "use_feature" => {
            let rest = offer.id.strip_prefix("use_feature:").ok_or_else(invalid)?;
            let mut parts = rest.splitn(3, ':');
            let item_id = parts
                .next()
                .and_then(|part| part.parse().ok())
                .ok_or_else(invalid)?;
            let location_id = parts
                .next()
                .and_then(|part| part.parse().ok())
                .ok_or_else(invalid)?;
            let feature_key = parts
                .next()
                .filter(|part| !part.is_empty())
                .ok_or_else(invalid)?;
            let candidate = runtime
                .plan_feature_use_choice(actor_id, item_id, location_id, feature_key)
                .map_err(|_| invalid())?;
            Ok(CommandDispatch::UseFeature {
                item_id,
                location_id,
                feature_key: feature_key.to_string(),
                output: candidate.content,
            })
        }
        "give_item" => {
            let parts = stable_parts(offer, "give_item:").ok_or_else(invalid)?;
            let [item_id, target_actor_id] = parts.as_slice() else {
                return Err(invalid());
            };
            Ok(CommandDispatch::GiveItem {
                item_id: item_id.parse().map_err(|_| invalid())?,
                target_actor_id: target_actor_id.parse().map_err(|_| invalid())?,
            })
        }
        "trade_item" => {
            let parts = stable_parts(offer, "trade_item:").ok_or_else(invalid)?;
            let [item_id, target_actor_id, target_item_id] = parts.as_slice() else {
                return Err(invalid());
            };
            Ok(CommandDispatch::TradeItem {
                item_id: item_id.parse().map_err(|_| invalid())?,
                target_actor_id: target_actor_id.parse().map_err(|_| invalid())?,
                target_item_id: target_item_id.parse().map_err(|_| invalid())?,
            })
        }
        "theft" => {
            let (target, item) = runtime
                .default_theft_candidate(actor_id)
                .ok_or_else(invalid)?;
            if required_target_id(offer, "item")? != item.id {
                return Err(invalid());
            }
            Ok(CommandDispatch::Theft {
                item_id: item.id,
                target_actor_id: target.id,
            })
        }
        "craft" => Ok(CommandDispatch::Craft {
            recipe_id: required_target_id(offer, "recipe")?,
        }),
        "attack" => Ok(CommandDispatch::Attack {
            target_actor_id: required_target_id(offer, "actor")?,
        }),
        "defend" => Ok(CommandDispatch::Defend),
        "prepare" => Ok(CommandDispatch::Prepare),
        "work" => Ok(CommandDispatch::Work),
        "help" => Ok(CommandDispatch::Help),
        "rest" => Ok(CommandDispatch::Rest),
        "chat" | "create_bond" => {
            let target_actor_id = required_target_id(offer, "actor")?;
            let target_name = runtime
                .actor_name(target_actor_id)
                .unwrap_or_else(|| format!("Avatar {target_actor_id}"));
            Ok(CommandDispatch::CreateBond {
                target_actor_id,
                statement: default_bond_statement(&target_name),
            })
        }
        "resolve_bond" => Ok(CommandDispatch::ResolveBond {
            target_actor_id: required_target_id(offer, "actor")?,
        }),
        _ => Err(invalid()),
    }
}

impl RuntimeWorld {
    pub(crate) fn resolve_command_submission(
        &self,
        payload: &CommandRequest,
        access: &AccessContext,
        active_direct_actor_ids: Option<&BTreeSet<u64>>,
    ) -> Result<ResolvedCommand, CommandError> {
        let Some(offer_id) = payload.offer_id.as_deref() else {
            return self.resolve_command_with_presence(payload, access, active_direct_actor_ids);
        };
        let offer = select_current_offer(self, payload.actor_id, access, offer_id)?;
        let dispatch = dispatch_for_offer(self, payload.actor_id, &offer)?;
        Ok(ResolvedCommand {
            command: offer.command.clone(),
            verb: offer.kind.clone(),
            action: Some(command_action(&offer.kind, &offer.label, &offer.command)),
            dispatch,
        })
    }
}

pub(crate) async fn resolve_command_submission_at_boundary(
    state: &AppState,
    payload: &CommandRequest,
    access: &AccessContext,
    was_active: bool,
) -> Result<(ResolvedCommand, Vec<EventView>), Json<CommandResponse>> {
    let resolved = {
        let runtime = state.inner.lock().await;
        if !client_actor_authorized_for_state(
            &runtime,
            state,
            payload.actor_id,
            payload.actor_session.as_deref(),
        ) {
            return Err(Json(CommandResponse {
                ok: false,
                status: 403,
                command: normalize_command_text(&payload.command),
                verb: String::new(),
                output: Some(
                    "Your avatar slipped out of reach. Begin again or reconnect your account."
                        .to_string(),
                ),
                error_kind: None,
                action: None,
                receipt: None,
                events: Vec::new(),
            }));
        }
        let active_direct_actors = active_actor_ids_for_state(state);
        runtime.resolve_command_submission(payload, access, Some(&active_direct_actors))
    };

    match resolved {
        Ok(resolved) => {
            let presence_events = if was_active {
                Vec::new()
            } else {
                commit_presence_event(state, payload.actor_id, true).await
            };
            Ok((resolved, presence_events))
        }
        Err(error) => {
            let presence_events = if was_active || payload.offer_id.is_some() {
                Vec::new()
            } else {
                commit_presence_event(state, payload.actor_id, true).await
            };
            Err(Json(CommandResponse {
                ok: false,
                status: error.status,
                command: error.command,
                verb: error.verb,
                output: Some(error.output),
                error_kind: Some(error.kind),
                action: None,
                receipt: None,
                events: presence_events,
            }))
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn request(actor_id: u64, session: &str, offer_id: &str) -> CommandRequest {
        CommandRequest {
            actor_id,
            actor_session: Some(session.to_string()),
            command: "this prose must never be parsed".to_string(),
            offer_id: Some(offer_id.to_string()),
            wallet_address: None,
            wallet: None,
            wallet_session: None,
            owned_card_ids: None,
            cards: None,
            envelope: None,
        }
    }

    fn snapshot_bytes(runtime: &RuntimeWorld) -> Vec<u8> {
        serde_json::to_vec(&RuntimeSnapshot::from_runtime(runtime)).expect("runtime snapshot")
    }

    fn runtime_from_bytes(bytes: &[u8]) -> RuntimeWorld {
        serde_json::from_slice::<RuntimeSnapshot>(bytes)
            .expect("snapshot parses")
            .into_runtime()
            .expect("snapshot reconnects")
    }

    #[test]
    fn offer_id_parser_preserves_colons_and_spaces_in_the_local_identity() {
        assert_eq!(
            parse_offer_id("cosyworld.srd5/1:42:contribution:work:job id:strategy"),
            Some(ParsedOfferId {
                rules_profile: "cosyworld.srd5/1",
                state_revision: 42,
                local_id: "contribution:work:job id:strategy",
            })
        );
    }

    #[test]
    fn offer_id_wins_over_legacy_prose_and_hashing_is_deterministic() {
        let mut runtime = RuntimeWorld::seeded();
        create_test_human(&mut runtime, 5_000, COSY_COTTAGE_LOCATION_ID, "ID Winner");
        let offer = runtime
            .legal_action_candidates(Some(5_000), &AccessContext::default())
            .1
            .into_iter()
            .find(|offer| !offer.disabled)
            .expect("seeded actor has an enabled offer");
        let left = request(5_000, "session", &offer.offer_id);
        let mut right = left.clone();
        right.command = "different legacy prose".to_string();
        let resolved = runtime
            .resolve_command_submission(&left, &AccessContext::default(), None)
            .expect("offer identity resolves before prose");
        assert_eq!(
            resolved.action.as_ref().map(|action| action.kind.as_str()),
            Some(offer.kind.as_str())
        );
        assert_eq!(
            command_submission_identity(&left),
            command_submission_identity(&right)
        );
        assert_eq!(
            command_request_hash(
                "actor:test",
                &command_submission_identity(&left),
                &CanonicalObservedVersions::default(),
                runtime.current_state_revision(),
            ),
            command_request_hash(
                "actor:test",
                &command_submission_identity(&right),
                &CanonicalObservedVersions::default(),
                runtime.current_state_revision(),
            )
        );
    }

    #[tokio::test]
    async fn pre_change_prose_payload_remains_compatible_and_parse_failures_are_typed() {
        let mut runtime = RuntimeWorld::seeded();
        create_test_human(
            &mut runtime,
            5_000,
            COSY_COTTAGE_LOCATION_ID,
            "Legacy Speaker",
        );
        let legacy: CommandRequest = serde_json::from_value(serde_json::json!({
            "actor_id": 5_000,
            "command": "look"
        }))
        .expect("pre-offer_id command payload still deserializes");
        assert_eq!(legacy.offer_id, None);
        assert_eq!(command_submission_identity(&legacy), "look");
        assert!(matches!(
            runtime
                .resolve_command_submission(&legacy, &AccessContext::default(), None)
                .expect("legacy prose still resolves")
                .dispatch,
            CommandDispatch::Read { .. }
        ));

        let state = test_app_state(runtime, None);
        let (session, _) = issue_actor_session(&state, 5_000);
        let mut invalid = legacy;
        invalid.actor_session = Some(session);
        invalid.command = "verb-that-does-not-exist".to_string();
        let response = command_inner(
            ConnectInfo("127.0.0.1:44089".parse().expect("client address")),
            State(state),
            Json(invalid),
        )
        .await
        .0;
        assert!(!response.ok);
        assert_eq!(response.error_kind, Some(CommandErrorKind::ParseFailure));
        assert!(response.events.iter().any(|event| {
            event.type_name == "actor.presence" && event.content.as_deref() == Some("active")
        }));
    }

    #[tokio::test]
    async fn every_enabled_seeded_offer_crosses_the_real_command_boundary_by_id() {
        let mut runtime = RuntimeWorld::seeded();
        create_test_human(
            &mut runtime,
            5_000,
            COSY_COTTAGE_LOCATION_ID,
            "Offer Property",
        );
        let access = AccessContext::default();
        let offers = runtime
            .legal_action_candidates(Some(5_000), &access)
            .1
            .into_iter()
            .filter(|offer| !offer.disabled)
            .collect::<Vec<_>>();
        assert!(!offers.is_empty());
        let initial = snapshot_bytes(&runtime);

        for offer in offers {
            let state = test_app_state(runtime_from_bytes(&initial), None);
            let (session, _) = issue_actor_session(&state, 5_000);
            let response = command_inner(
                ConnectInfo("127.0.0.1:44090".parse().expect("client address")),
                State(state),
                Json(request(5_000, &session, &offer.offer_id)),
            )
            .await
            .0;
            assert!(
                response.error_kind.is_none(),
                "{} hit submission routing instead of action execution: {:?}",
                offer.offer_id,
                response
            );
            assert_eq!(
                response.action.as_ref().map(|action| action.kind.as_str()),
                Some(offer.kind.as_str()),
                "{} crossed the command boundary as its projected action",
                offer.offer_id
            );
            assert_ne!(response.status, 404, "{} was not routed", offer.offer_id);
        }
    }

    #[tokio::test]
    async fn valid_offer_reactivates_inactive_actor_and_still_executes() {
        let mut runtime = RuntimeWorld::seeded();
        create_test_human(
            &mut runtime,
            5_000,
            COSY_COTTAGE_LOCATION_ID,
            "Returning Offer",
        );
        let offer = runtime
            .legal_action_candidates(Some(5_000), &AccessContext::default())
            .1
            .into_iter()
            .find(|offer| !offer.disabled && offer.kind == "influence")
            .expect("seeded Cottage projects an executable influence offer");
        let state = test_app_state(runtime, None);
        let (session, _) = issue_actor_session(&state, 5_000);
        assert!(!active_actor_ids(&state.actor_sessions).contains(&5_000));

        let response = command(
            ConnectInfo("127.0.0.1:44096".parse().expect("client address")),
            State(state.clone()),
            Json(request(5_000, &session, &offer.offer_id)),
        )
        .await
        .0;

        assert!(response.error_kind.is_none());
        assert_eq!(
            response.action.as_ref().map(|action| action.kind.as_str()),
            Some("influence")
        );
        assert!(response.events.iter().any(|event| {
            event.type_name == "actor.presence" && event.content.as_deref() == Some("active")
        }));
        assert!(response
            .events
            .iter()
            .any(|event| event.type_name == "influence.committed"));
        assert!(active_actor_ids(&state.actor_sessions).contains(&5_000));
        assert_eq!(
            state.inner.lock().await.latest_actor_presence_state(5_000),
            Some(true)
        );
    }

    async fn assert_atomic_offer_rejection(
        state: &AppState,
        actor_id: u64,
        session: &str,
        offer_id: &str,
        expected: CommandErrorKind,
    ) {
        let before = {
            let runtime = state.inner.lock().await;
            snapshot_bytes(&runtime)
        };
        let response = command(
            ConnectInfo("127.0.0.1:44091".parse().expect("client address")),
            State(state.clone()),
            Json(request(actor_id, session, offer_id)),
        )
        .await
        .0;
        assert!(!response.ok);
        assert_eq!(response.error_kind, Some(expected));
        assert!(
            response.events.is_empty(),
            "offer rejection emits no presence event"
        );
        let runtime = state.inner.lock().await;
        assert_eq!(
            snapshot_bytes(&runtime),
            before,
            "offer rejection is byte-atomic"
        );
        let restored = runtime_from_bytes(&before);
        assert_eq!(
            serde_json::to_vec(&runtime.event_log).expect("current event log"),
            serde_json::to_vec(&restored.event_log).expect("restored event log")
        );
        assert_eq!(runtime.world.next_event_seq, restored.world.next_event_seq);
        assert_eq!(runtime.presence_states, restored.presence_states);
    }

    #[tokio::test]
    async fn malformed_stale_and_unknown_offer_ids_reject_without_any_mutation() {
        let mut runtime = RuntimeWorld::seeded();
        create_test_human(
            &mut runtime,
            5_000,
            COSY_COTTAGE_LOCATION_ID,
            "Atomic Rejector",
        );
        let current_revision = runtime.current_state_revision();
        let rules_profile = active_content().manifest.rules_profile.clone();
        let state = test_app_state(runtime, None);
        let (session, _) = issue_actor_session(&state, 5_000);

        assert_atomic_offer_rejection(
            &state,
            5_000,
            &session,
            "not-an-offer-id",
            CommandErrorKind::InvalidOfferId,
        )
        .await;
        assert_atomic_offer_rejection(
            &state,
            5_000,
            &session,
            &format!("{rules_profile}:{}:missing:offer", current_revision - 1),
            CommandErrorKind::StaleOffer,
        )
        .await;
        assert_atomic_offer_rejection(
            &state,
            5_000,
            &session,
            &format!("{rules_profile}:{current_revision}:missing:offer"),
            CommandErrorKind::UnknownOffer,
        )
        .await;
    }

    #[tokio::test]
    async fn disabled_offer_rejects_atomically_and_staleness_takes_precedence() {
        let mut runtime = RuntimeWorld::seeded();
        create_test_human(
            &mut runtime,
            5_000,
            MOONLIT_TRAIL_LOCATION_ID,
            "Current Fighter",
        );
        create_test_human(
            &mut runtime,
            5_001,
            MOONLIT_TRAIL_LOCATION_ID,
            "Waiting Fighter",
        );
        let encounter_id = combat_encounter_id(MOONLIT_JOB_ID);
        assert_eq!(
            runtime
                .apply_journal_record(&JournalRecord::new(
                    CwAction {
                        kind: CW_ACTION_COMBAT_START,
                        actor_id: 5_000,
                        target_actor_id: 1_004,
                        content_id: encounter_id,
                        ..CwAction::default()
                    },
                    88_001,
                ))
                .0,
            CW_OK
        );
        assert_eq!(
            runtime
                .apply_journal_record(&JournalRecord::new(
                    combat_join_action(5_001, encounter_id),
                    88_002,
                ))
                .0,
            CW_OK
        );
        let disabled = runtime
            .legal_action_candidates(Some(5_001), &AccessContext::default())
            .1
            .into_iter()
            .find(|offer| offer.disabled)
            .expect("off-turn fighter projects a disabled wait offer");
        let parsed = parse_offer_id(&disabled.offer_id).expect("disabled offer id parses");
        let stale_disabled = format!(
            "{}:{}:{}",
            parsed.rules_profile,
            parsed.state_revision - 1,
            parsed.local_id
        );
        let state = test_app_state(runtime, None);
        let (session, _) = issue_actor_session(&state, 5_001);
        assert_atomic_offer_rejection(
            &state,
            5_001,
            &session,
            &stale_disabled,
            CommandErrorKind::StaleOffer,
        )
        .await;
        assert_atomic_offer_rejection(
            &state,
            5_001,
            &session,
            &disabled.offer_id,
            CommandErrorKind::DisabledOffer,
        )
        .await;
    }

    #[tokio::test]
    async fn issue_306_contextual_influence_executes_by_id_through_commands_api() {
        let mut runtime = RuntimeWorld::seeded();
        create_test_human(
            &mut runtime,
            5_000,
            COSY_COTTAGE_LOCATION_ID,
            "Context Caller",
        );
        let offer = runtime
            .legal_action_candidates(Some(5_000), &AccessContext::default())
            .1
            .into_iter()
            .find(|offer| {
                offer.kind == "influence"
                    && offer
                        .composition_trace
                        .contextual_offers
                        .iter()
                        .any(|id| id == "cosyworld.core:cottage-ask-local-lead")
            })
            .expect("#306 contextual influence offer");
        let state = test_app_state(runtime, None);
        let (session, _) = issue_actor_session(&state, 5_000);
        let payload: CommandRequest = serde_json::from_value(serde_json::json!({
            "actor_id": 5_000,
            "actor_session": session,
            "offer_id": offer.offer_id,
            "command": "ask for a local lead"
        }))
        .expect("additive /commands offer_id JSON contract");
        let response = command(
            ConnectInfo("127.0.0.1:44092".parse().expect("client address")),
            State(state),
            Json(payload),
        )
        .await
        .0;
        assert!(response.ok, "{response:?}");
        assert_eq!(response.error_kind, None);
        assert_eq!(
            response.action.as_ref().map(|action| action.kind.as_str()),
            Some("influence")
        );
        assert!(
            !response.events.is_empty(),
            "#306 reaches a real action outcome"
        );
    }

    #[tokio::test]
    async fn issue_370_feature_use_executes_by_id_without_a_command_string() {
        let mut runtime = RuntimeWorld::seeded();
        create_test_human(
            &mut runtime,
            5_000,
            COSY_COTTAGE_LOCATION_ID,
            "Feature User",
        );
        for item in &mut runtime.world.items[..runtime.world.item_count] {
            if item.id == STORY_BUTTON_ITEM_ID {
                item.location_id = 0;
                item.holder_actor_id = 5_000;
                item.held_since_tick = runtime.world.tick;
            }
        }
        let offer = runtime
            .legal_action_candidates(Some(5_000), &AccessContext::default())
            .1
            .into_iter()
            .find(|offer| offer.kind == "use_feature")
            .expect("#370 structured feature-use offer");
        let state = test_app_state(runtime, None);
        let (session, _) = issue_actor_session(&state, 5_000);
        let payload: CommandRequest = serde_json::from_value(serde_json::json!({
            "actor_id": 5_000,
            "actor_session": session,
            "offer_id": offer.offer_id
        }))
        .expect("offer-only /commands request");
        let response = command(
            ConnectInfo("127.0.0.1:44093".parse().expect("client address")),
            State(state),
            Json(payload),
        )
        .await
        .0;
        assert!(response.ok, "{response:?}");
        assert_eq!(response.error_kind, None);
        assert_eq!(
            response.action.as_ref().map(|action| action.kind.as_str()),
            Some("use_feature")
        );
        assert!(response
            .events
            .iter()
            .any(|event| event.type_name == "item.used"));
    }
}
