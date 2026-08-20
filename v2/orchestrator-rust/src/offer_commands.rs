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
    offers: &[RankedActionOffer],
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
    let hand = runtime.action_hand_for(Some(actor_id), offers);
    let exact = offers
        .iter()
        .find(|offer| offer.offer_id == offer_id)
        .cloned();
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
    if let Some(offer) = exact.filter(|offer| {
        hand.entries
            .iter()
            .any(|entry| entry.offer_id == offer.offer_id)
    }) {
        return Ok(offer);
    }
    Err(offer_error(
        offer_id,
        CommandErrorKind::UnknownOffer,
        404,
        format!(
            "That offer_id is not in the current Story Hand for rules profile {}. Think or refresh the scene and choose a published offer.",
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
        "open" => runtime
            .plan_threshold_method_offer_action(actor_id, offer)
            .map(|action| CommandDispatch::OpenThreshold {
                action: Box::new(action),
            })
            .map_err(|_| invalid()),
        NOTICE_ACTOR_OFFER_KIND => Ok(CommandDispatch::NoticeActor {
            target_actor_id: required_target_id(offer, "actor")?,
        }),
        "check" => Ok(CommandDispatch::Check),
        "study" => Ok(CommandDispatch::Study),
        FOCUSED_NOTICE_OFFER_KIND
        | DISCOVERY_SEARCH_OFFER_KIND
        | DISCOVERY_STUDY_OFFER_KIND
        | DISCOVERY_SCOUT_OFFER_KIND => {
            let binding = offer.discovery.as_ref().ok_or_else(invalid)?;
            Ok(CommandDispatch::Discover {
                procedure: binding.procedure.clone(),
                slot_id: binding.slot_id.clone(),
                receipt_id: binding.receipt_id.clone(),
            })
        }
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
        "pick_up" => {
            let item_id = required_target_id(offer, "item")?;
            let exchange_item_id = runtime
                .deterministic_pickup_exchange_item(actor_id, item_id)
                .map_err(|_| invalid())?;
            Ok(CommandDispatch::PickUp {
                item_id,
                exchange_item_id,
            })
        }
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
        "chat" => Ok(CommandDispatch::Chat {
            target_actor_id: required_target_id(offer, "actor")?,
        }),
        "model_interaction" => Ok(CommandDispatch::ModelInteraction {
            target_actor_id: required_target_id(offer, "actor")?,
        }),
        "create_bond" => {
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
        model_config: Option<&AiConfig>,
    ) -> Result<ResolvedCommand, CommandError> {
        let Some(offer_id) = payload.offer_id.as_deref().map(str::trim) else {
            return Err(offer_command_error(
                "",
                CommandErrorKind::ProseRetired,
                400,
                "Typed commands are retired. Play a card from your Story Hand, or Think to replace one.",
            ));
        };
        let (mut primary_action, mut offers) = self.legal_action_candidates_with_presence(
            Some(payload.actor_id),
            access,
            active_direct_actor_ids,
        );
        retain_configured_model_interaction_offers(&mut primary_action, &mut offers, model_config);
        let hand = self.action_hand_for(Some(payload.actor_id), &offers);
        if let Some(think) = hand
            .entries
            .iter()
            .map(|entry| &entry.think)
            .find(|think| think.offer_id == offer_id)
            .cloned()
        {
            return Ok(ResolvedCommand {
                command: "think".to_string(),
                verb: "think".to_string(),
                action: Some(command_action("think", &think.label, "think")),
                dispatch: CommandDispatch::Pass { think },
            });
        }
        let offer = select_current_offer(self, payload.actor_id, &offers, offer_id)?;
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
                    "Reconnect your account to restore this same avatar; the world will not replace it."
                        .to_string(),
                ),
                error_kind: None,
                action: None,
                receipt: None,
                events: Vec::new(),
            }));
        }
        let active_direct_actors = active_actor_ids_for_state(state);
        runtime.resolve_command_submission(
            payload,
            access,
            Some(&active_direct_actors),
            state.ai_config.as_ref().as_ref(),
        )
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
            // A normal stale Think is refused before `pass_action` is
            // reached, because the certificate no longer names the current
            // hand. Record that canonical-boundary rejection exactly once;
            // direct/internal `pass_action` calls retain their own hook.
            if error.status == 409 {
                if let Some(pass_offer_id) = payload.offer_id.as_deref().filter(|offer_id| {
                    offer_id.starts_with("pass:") || offer_id.starts_with("think:")
                }) {
                    if let Some(path) = state.event_store_path.as_deref() {
                        if let Err(metric_error) =
                            record_stale_pass_rejection(path, payload.actor_id, pass_offer_id)
                        {
                            warn!(
                                "failed to record stale command pass certificate metric for actor {}: {}",
                                payload.actor_id, metric_error
                            );
                        }
                    }
                }
            }
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
            wallet_session: None,
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
        let (_, offers) = runtime.legal_action_candidates(Some(5_000), &AccessContext::default());
        let hand = runtime.action_hand_for(Some(5_000), &offers);
        let offer = offers
            .into_iter()
            .find(|offer| {
                !offer.disabled
                    && hand
                        .entries
                        .iter()
                        .any(|entry| entry.offer_id == offer.offer_id)
            })
            .expect("seeded actor has an enabled dealt offer");
        let left = request(5_000, "session", &offer.offer_id);
        let mut right = left.clone();
        right.command = "different legacy prose".to_string();
        let resolved = runtime
            .resolve_command_submission(&left, &AccessContext::default(), None, None)
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
                .resolve_command_submission(&legacy, &AccessContext::default(), None, None)
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
    async fn every_current_hand_offer_crosses_the_real_command_boundary_by_id() {
        let mut runtime = RuntimeWorld::seeded();
        create_test_human(
            &mut runtime,
            5_000,
            COSY_COTTAGE_LOCATION_ID,
            "Offer Property",
        );
        let access = AccessContext::default();
        let initial = snapshot_bytes(&runtime);
        let slot_count = runtime
            .state_response(Some(5_000), &access)
            .action_hand
            .entries
            .len();
        assert!(slot_count > 0);

        for slot_index in 0..slot_count {
            let state = test_app_state(runtime_from_bytes(&initial), None);
            let (session, _) = issue_actor_session(&state, 5_000);
            let mut activate = request(5_000, &session, "");
            activate.offer_id = None;
            activate.command = "look".to_string();
            let activation = command_inner(
                ConnectInfo("127.0.0.1:44090".parse().expect("client address")),
                State(state.clone()),
                Json(activate),
            )
            .await
            .0;
            assert!(
                activation.ok,
                "read-only activation makes the session present"
            );
            let active_direct_actors = active_actor_ids_for_state(&state);
            let offer = {
                let runtime = state.inner.lock().await;
                let (mut primary_action, mut offers) = runtime
                    .legal_action_candidates_with_presence(
                        Some(5_000),
                        &access,
                        Some(&active_direct_actors),
                    );
                retain_configured_model_interaction_offers(
                    &mut primary_action,
                    &mut offers,
                    state.ai_config.as_ref().as_ref(),
                );
                let hand = runtime.action_hand_for(Some(5_000), &offers);
                let offer_id = hand
                    .entries
                    .get(slot_index)
                    .map(|entry| entry.offer_id.clone())
                    .expect("the refreshed hand keeps its bounded slot");
                offers
                    .into_iter()
                    .find(|offer| offer.offer_id == offer_id)
                    .expect("each refreshed hand entry binds one exact offer")
            };
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
    async fn exact_full_capacity_pickup_command_exchanges_the_deterministic_legal_item() {
        let actor_id = 5_000;
        let mut runtime = RuntimeWorld::seeded();
        create_test_human(
            &mut runtime,
            actor_id,
            COSY_COTTAGE_LOCATION_ID,
            "Certified Exchange",
        );
        runtime
            .world
            .actors
            .iter_mut()
            .take(runtime.world.actor_count)
            .find(|actor| actor.id == actor_id)
            .expect("test actor exists")
            .stats
            .strength = 1;
        for item in &mut runtime.world.items[..runtime.world.item_count] {
            item.location_id = 0;
            item.holder_actor_id = 0;
            item.zone = CW_CARD_ZONE_WORLD;
            item.container_item_id = 0;
            match item.id {
                2001 => {
                    item.holder_actor_id = actor_id;
                    item.zone = CW_CARD_ZONE_CARRIED;
                    item.weight_tenths = 150;
                }
                STORY_BUTTON_ITEM_ID => {
                    item.location_id = COSY_COTTAGE_LOCATION_ID;
                    item.weight_tenths = 1;
                }
                _ => {}
            }
        }
        complete_guided_story_for_test(&mut runtime, actor_id);
        assert!(runtime.actor_inventory_full(actor_id));
        let pickup_offer = runtime
            .draw_until_test_offer(actor_id, &AccessContext::default(), |offer| {
                offer.kind == "pick_up"
                    && offer.target.as_ref().and_then(|target| target.id)
                        == Some(STORY_BUTTON_ITEM_ID)
            })
            .expect("the exact Story Button offer is dealt");
        assert!(matches!(
            dispatch_for_offer(&runtime, actor_id, &pickup_offer),
            Ok(CommandDispatch::PickUp {
                item_id: STORY_BUTTON_ITEM_ID,
                exchange_item_id: Some(2001),
            })
        ));

        let (_, offers) =
            runtime.legal_action_candidates(Some(actor_id), &AccessContext::default());
        let hand = runtime.action_hand_for(Some(actor_id), &offers);
        let undealt_offer_id = offers
            .iter()
            .find(|offer| {
                !hand
                    .entries
                    .iter()
                    .any(|entry| entry.offer_id == offer.offer_id)
            })
            .map(|offer| offer.offer_id.clone())
            .expect("fixture has an offer outside the Story Hand");

        let state = test_app_state(runtime, None);
        let (session, _) = issue_actor_session(&state, actor_id);
        assert_atomic_offer_rejection(
            &state,
            actor_id,
            &session,
            &undealt_offer_id,
            CommandErrorKind::UnknownOffer,
        )
        .await;

        let response = command(
            ConnectInfo("127.0.0.1:44094".parse().expect("client address")),
            State(state.clone()),
            Json(request(actor_id, &session, &pickup_offer.offer_id)),
        )
        .await
        .0;
        assert!(response.ok, "exact pickup command succeeds: {response:?}");
        assert!(response.events.iter().any(|event| {
            event.type_name == "item.picked_up" && event.item_id == Some(STORY_BUTTON_ITEM_ID)
        }));
        {
            let runtime = state.inner.lock().await;
            assert!(runtime
                .item_by_id(STORY_BUTTON_ITEM_ID)
                .is_some_and(|item| item.holder_actor_id == actor_id));
            assert!(runtime.item_by_id(2001).is_some_and(|item| {
                item.location_id == COSY_COTTAGE_LOCATION_ID && item.holder_actor_id == 0
            }));
        }
        assert_atomic_offer_rejection(
            &state,
            actor_id,
            &session,
            &pickup_offer.offer_id,
            CommandErrorKind::StaleOffer,
        )
        .await;
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
            .draw_until_test_offer(5_000, &AccessContext::default(), |offer| {
                !offer.disabled && offer.kind == "influence"
            })
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
        let after = snapshot_bytes(&runtime);
        if after != before {
            let before_value: serde_json::Value =
                serde_json::from_slice(&before).expect("before snapshot is JSON");
            let after_value: serde_json::Value =
                serde_json::from_slice(&after).expect("after snapshot is JSON");
            let changed_keys = before_value
                .as_object()
                .expect("before snapshot is an object")
                .keys()
                .filter(|key| before_value.get(*key) != after_value.get(*key))
                .cloned()
                .collect::<Vec<_>>();
            panic!("offer rejection changed snapshot fields: {changed_keys:?}");
        }
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
            .draw_until_test_offer(5_000, &AccessContext::default(), |offer| {
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
            .draw_until_test_offer(5_000, &AccessContext::default(), |offer| {
                offer.kind == "use_feature"
            })
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
