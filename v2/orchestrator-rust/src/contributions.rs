use super::*;

const ROUTABLE_CONTRIBUTION_KINDS: [&str; 5] = ["work", "help", "check", "study", "use_item"];

impl RuntimeWorld {
    pub(super) fn job_contribution_intents(
        &self,
        actor_id: u64,
        action_kind: Option<&str>,
        requested_job_id: Option<&str>,
        requested_strategy_id: Option<&str>,
        target_hint: Option<(&str, &str)>,
    ) -> Vec<JobContributionIntent> {
        let Some(actor) = self.actor_by_id(actor_id) else {
            return Vec::new();
        };
        if !Self::actor_can_act(actor) || self.tired_tag_active(actor_id) {
            return Vec::new();
        }
        let mut intents = self
            .jobs
            .values()
            .filter(|job| job.delivery.is_none())
            .filter(|job| {
                requested_job_id.is_none_or(|requested| job.id == requested)
                    && job.location_ids.contains(&actor.location_id)
                    && self.job_status(job) == "active"
                    && job.contribution_schema_version == JOB_CONTRIBUTION_SCHEMA_VERSION
            })
            .flat_map(|job| {
                job.contribution_strategies
                    .iter()
                    .map(move |strategy| (job, strategy))
            })
            .filter(|(job, strategy)| {
                action_kind.is_none_or(|kind| strategy.action_kind == kind)
                    && requested_strategy_id.is_none_or(|requested| strategy.id == requested)
                    && focused_job_action_available(self, actor_id, &job.id, &strategy.action_kind)
                    && self.contribution_strategy_binding_is_active(strategy)
                    && strategy
                        .requirements
                        .iter()
                        .all(|requirement| self.contribution_requirement_met(actor_id, requirement))
                    && self
                        .clocks
                        .get(&strategy.clock_id)
                        .is_some_and(|clock| clock.filled < clock.segments)
            })
            .filter_map(|(job, strategy)| {
                let target =
                    self.resolve_contribution_target(actor_id, job, strategy, target_hint)?;
                let claim_key = Self::contribution_claim_key(actor_id, &job.id, strategy, &target);
                if claim_key
                    .as_ref()
                    .is_some_and(|claim_key| self.rpg_claims.contains(claim_key))
                {
                    return None;
                }
                Some(JobContributionIntent {
                    job_id: job.id.clone(),
                    strategy: strategy.clone(),
                    target,
                })
            })
            .collect::<Vec<_>>();
        intents.sort_by(|left, right| {
            let job_order = self
                .jobs
                .get(&left.job_id)
                .zip(self.jobs.get(&right.job_id))
                .map(|(left, right)| self.compare_job_presentation(left, right))
                .unwrap_or_else(|| left.job_id.cmp(&right.job_id));
            job_order
                .then_with(|| left.strategy.id.cmp(&right.strategy.id))
                .then_with(|| left.target.id.cmp(&right.target.id))
        });
        intents
    }

    pub(super) fn job_contribution_intent(
        &self,
        actor_id: u64,
        action_kind: &str,
        requested_job_id: Option<&str>,
        requested_strategy_id: Option<&str>,
        target_hint: Option<(&str, &str)>,
    ) -> Option<JobContributionIntent> {
        self.job_contribution_intents(
            actor_id,
            Some(action_kind),
            requested_job_id,
            requested_strategy_id,
            target_hint,
        )
        .into_iter()
        .next()
    }

    pub(super) fn exact_job_contribution_intent(
        &self,
        actor_id: u64,
        job_id: &str,
        strategy_id: &str,
    ) -> Option<JobContributionIntent> {
        self.job_contribution_intents(actor_id, None, Some(job_id), Some(strategy_id), None)
            .into_iter()
            .next()
    }

    pub(super) fn contribution_progress_amount(
        &self,
        actor_id: u64,
        intent: &JobContributionIntent,
    ) -> u8 {
        let prepared = self
            .actor_by_id(actor_id)
            .is_some_and(|actor| self.prepared_tag_active(actor_id, actor.location_id));
        intent
            .strategy
            .baseline_progress
            .saturating_add(intent.strategy.success_progress)
            .saturating_add(if prepared {
                intent.strategy.prepared_bonus_progress
            } else {
                0
            })
    }

    fn contribution_project_view(
        &self,
        actor_id: u64,
        intent: &JobContributionIntent,
    ) -> Option<ActionProjectView> {
        let job = self.jobs.get(&intent.job_id)?;
        Some(ActionProjectView {
            id: job.id.clone(),
            verb: self
                .action_vocabulary_for_actor(actor_id)
                .map(|vocabulary| vocabulary.contribute.clone())
                .unwrap_or_else(|| "Contribute".to_string()),
            label: self.job_action_label(job),
            summary: self.job_action_summary(job),
            progress_clock_id: intent.strategy.clock_id.clone(),
            strategy_id: Some(intent.strategy.id.clone()),
            strategy_label: Some(intent.strategy.strategy_label.clone()),
            resolution: Some(
                contribution_resolution_label(&intent.strategy.resolution).to_string(),
            ),
            claim_key: Self::contribution_claim_key(
                actor_id,
                &intent.job_id,
                &intent.strategy,
                &intent.target,
            ),
        })
    }

    fn retarget_job_contribution_offer(
        &self,
        actor_id: u64,
        mut offer: RankedActionOffer,
        intent: JobContributionIntent,
    ) -> RankedActionOffer {
        let preserves_legacy_project_copy =
            matches!(intent.strategy.action_kind.as_str(), "work" | "help");
        let target = ActionTargetView {
            kind: intent.target.kind.clone(),
            id: intent.target.id.parse::<u64>().ok(),
            label: Some(intent.target.label.clone()),
        };
        let project = self.contribution_project_view(actor_id, &intent);
        let legacy_id = format!(
            "contribution:{}:{}:{}",
            intent.strategy.action_kind, intent.job_id, intent.strategy.id
        );
        offer.id = legacy_id.clone();
        offer.offer_id = format!(
            "{}:{}:{}",
            offer.rules_profile, offer.state_revision, legacy_id
        );
        offer.command = format!("contribute {}", intent.strategy.id);
        if !preserves_legacy_project_copy {
            offer.label = intent.strategy.strategy_label.clone();
            offer.accessible_label = intent.strategy.strategy_label.clone();
        }
        offer.target = Some(target.clone());
        offer.project = project.clone();
        offer.progress = Some(self.contribution_progress_amount(actor_id, &intent));
        if !preserves_legacy_project_copy {
            offer.claim_key = Self::contribution_claim_key(
                actor_id,
                &intent.job_id,
                &intent.strategy,
                &intent.target,
            );
            offer.effect = Some(format!(
                "{} advances {}",
                intent.strategy.strategy_label,
                project
                    .as_ref()
                    .map(|project| project.label.as_str())
                    .unwrap_or("the shared work")
            ));
            offer.risk = match &intent.strategy.resolution {
                ContributionResolutionPolicy::SrdCheck { dc, .. } => {
                    Some(format!("the authored check is DC {dc}"))
                }
                _ => offer.risk,
            };
        }
        if intent.strategy.action_kind == "use_item" {
            if let Ok(item_id) = intent.target.id.parse::<u64>() {
                if let Some(source) = self.item_source_collectible(item_id) {
                    offer.source_collectible = Some(source.clone());
                    offer
                        .composition_trace
                        .source_card_instances
                        .retain(|existing| existing.kind != "item");
                    offer
                        .composition_trace
                        .source_card_instances
                        .insert(0, source);
                }
                let item_name = self
                    .item_name(item_id)
                    .unwrap_or_else(|| format!("Item {item_id}"));
                offer.provider = action_provider(
                    "held_item",
                    format!("item:{item_id}"),
                    item_name.clone(),
                    format!("From {item_name} in your hand"),
                    30,
                );
            }
        } else if let Some(project) = project {
            offer.provider = action_provider(
                "job",
                format!("job:{}", project.id),
                project.label.clone(),
                format!("From {}", project.label),
                50,
            );
        }
        offer.composition_trace.target = Some(target);
        offer
    }

    pub(super) fn expand_job_contribution_offers(
        &self,
        actor_id: u64,
        offers: Vec<RankedActionOffer>,
    ) -> Vec<RankedActionOffer> {
        let mut expanded = Vec::new();
        for offer in offers {
            if !ROUTABLE_CONTRIBUTION_KINDS.contains(&offer.kind.as_str())
                || offer.project.is_none()
            {
                expanded.push(offer);
                continue;
            }
            let intents =
                self.job_contribution_intents(actor_id, Some(&offer.kind), None, None, None);
            if intents.is_empty() {
                expanded.push(offer);
            } else {
                expanded.extend(intents.into_iter().map(|intent| {
                    self.retarget_job_contribution_offer(actor_id, offer.clone(), intent)
                }));
            }
        }
        expanded
    }

    pub(super) fn clear_job_resolved_tags_from_events(
        &mut self,
        events: &[EventView],
    ) -> Vec<EventView> {
        let mut resolved_jobs = Vec::new();
        for event in events {
            if event.type_name == "job.contribution.resolved" {
                let Some(trace) = event
                    .content
                    .as_deref()
                    .and_then(|content| serde_json::from_str::<JobContributionTrace>(content).ok())
                else {
                    continue;
                };
                let resolved = self.jobs.get(&trace.job_id).is_some_and(|job| {
                    matches!(self.job_status(job).as_str(), "completed" | "failed")
                });
                if resolved {
                    resolved_jobs.push((trace.job_id, event.actor_id.unwrap_or(0)));
                }
                continue;
            }
            if event.type_name != "job.updated" {
                continue;
            }
            let Some(content) = event.content.as_deref() else {
                continue;
            };
            let Some(status) = job_status_from_event_content(content) else {
                continue;
            };
            let Some(job_id) = job_id_from_event_content(content) else {
                continue;
            };
            if matches!(status, "completed" | "failed") {
                resolved_jobs.push((job_id, event.actor_id.unwrap_or(0)));
            }
        }
        let mut cleared = Vec::new();
        for (job_id, actor_id) in resolved_jobs {
            cleared.extend(self.clear_job_resolved_tags(&job_id, actor_id, "job_resolved"));
        }
        cleared
    }

    fn clear_job_resolved_tags(
        &mut self,
        job_id: &str,
        actor_id: u64,
        reason: &str,
    ) -> Vec<EventView> {
        let Some(job) = self.jobs.get(job_id).cloned() else {
            return Vec::new();
        };
        let tag_ids: Vec<String> = self
            .tags
            .values()
            .filter(|tag| tag.active && tag.expires.as_deref() == Some("when_job_resolves"))
            .filter(|tag| match tag.scope.as_str() {
                "room" => job.location_ids.contains(&tag.scope_id),
                "actor" => job.location_ids.iter().any(|location_id| {
                    tag.id
                        == project_preparation_spent_tag_id(
                            tag.scope_id,
                            *location_id,
                            &job.progress_clock_id,
                        )
                }),
                _ => false,
            })
            .map(|tag| tag.id.clone())
            .collect();
        tag_ids
            .into_iter()
            .filter_map(|tag_id| self.clear_rpg_tag(&tag_id, actor_id, reason))
            .collect()
    }
}

fn contribution_request_ids(
    payload: &JobContributionRequest,
) -> Result<(String, String), Json<ActionResponse>> {
    let job_id = payload
        .job_id
        .as_deref()
        .filter(|value| !value.trim().is_empty())
        .ok_or_else(|| action_offer_rejected("Contribution needs an exact job_id"))?;
    let strategy_id = payload
        .strategy_id
        .as_deref()
        .filter(|value| !value.trim().is_empty())
        .ok_or_else(|| action_offer_rejected("Contribution needs an exact strategy_id"))?;
    Ok((job_id.to_string(), strategy_id.to_string()))
}

pub(super) async fn contribute(
    ConnectInfo(client_addr): ConnectInfo<SocketAddr>,
    State(state): State<AppState>,
    Json(payload): Json<JobContributionRequest>,
) -> Json<ActionResponse> {
    let (job_id, strategy_id) = match contribution_request_ids(&payload) {
        Ok(ids) => ids,
        Err(response) => return response,
    };
    let action_kind = {
        let runtime = state.inner.lock().await;
        runtime
            .jobs
            .get(&job_id)
            .and_then(|job| {
                job.contribution_strategies
                    .iter()
                    .find(|strategy| strategy.id == strategy_id)
            })
            .map(|strategy| strategy.action_kind.clone())
    };
    let Some(action_kind) = action_kind else {
        return action_offer_rejected("That contribution strategy is no longer authored");
    };
    match action_kind.as_str() {
        "work" => {
            return work(ConnectInfo(client_addr), State(state), Json(payload)).await;
        }
        "help" => {
            return help_room(ConnectInfo(client_addr), State(state), Json(payload)).await;
        }
        _ => {}
    }
    if !allow_actor_mutation(
        &state,
        client_addr,
        payload.actor_id,
        "action-actor",
        GENERAL_ACTION_LIMIT,
    ) {
        return action_rate_limited_response();
    }
    let planned = {
        let runtime = state.inner.lock().await;
        let Some(intent) =
            runtime.exact_job_contribution_intent(payload.actor_id, &job_id, &strategy_id)
        else {
            return action_offer_rejected("That contribution strategy is no longer available");
        };
        let action = match (&*action_kind, &intent.strategy.resolution) {
            ("check", ContributionResolutionPolicy::SrdCheck { ability, dc }) => CwAction {
                kind: CW_ACTION_RULES_SEARCH,
                actor_id: payload.actor_id,
                ability: ability_from_string(ability),
                dc: *dc,
                ..CwAction::default()
            },
            ("study", ContributionResolutionPolicy::SrdCheck { ability, dc }) => CwAction {
                kind: CW_ACTION_RULES_STUDY,
                actor_id: payload.actor_id,
                ability: ability_from_string(ability),
                dc: *dc,
                ..CwAction::default()
            },
            ("use_item", ContributionResolutionPolicy::ExistingKernelOutcome { event_type })
                if event_type == "item.used" && intent.target.kind == "item" =>
            {
                let Ok(item_id) = intent.target.id.parse::<u64>() else {
                    return action_offer_rejected("That contribution item is invalid");
                };
                CwAction {
                    kind: CW_ACTION_RULES_UTILIZE_ITEM,
                    actor_id: payload.actor_id,
                    item_id,
                    ..CwAction::default()
                }
            }
            _ => {
                return action_offer_rejected(
                    "That contribution strategy has an incompatible resolution",
                );
            }
        };
        let mut mutations = vec![ProjectionMutation::ResolveJobContribution {
            intent: intent.clone(),
        }];
        if let Some(pathway_id) =
            runtime.generated_pathway_id_for_progress_clock(&intent.strategy.clock_id)
        {
            mutations.push(ProjectionMutation::UpgradePathwayIfReady {
                pathway_id,
                progress_clock_id: intent.strategy.clock_id.clone(),
            });
        }
        (action, mutations)
    };
    apply_and_broadcast_with_mutations(
        state,
        planned.0,
        payload.actor_session.as_deref(),
        planned.1,
    )
    .await
}

#[cfg(test)]
mod tests {
    use super::*;

    fn request(actor_session: &str, strategy_id: &str) -> JobContributionRequest {
        JobContributionRequest {
            actor_id: 5000,
            actor_session: Some(actor_session.to_string()),
            job_id: Some(FIRST_TALE_JOB_ID.to_string()),
            strategy_id: Some(strategy_id.to_string()),
        }
    }

    #[tokio::test]
    async fn solo_rain_garden_completes_through_check_and_work_strategies() {
        let mut runtime = RuntimeWorld::seeded();
        create_test_human(
            &mut runtime,
            5000,
            RAIN_SOFT_GARDEN_LOCATION_ID,
            "Solo Gardener",
        );
        runtime.world.actors[..runtime.world.actor_count]
            .iter_mut()
            .find(|actor| actor.id == 5000)
            .expect("test actor")
            .stats
            .wisdom = 30;
        let state = test_app_state(runtime, None);
        let (actor_session, _) = issue_actor_session(&state, 5000);
        let client_addr: SocketAddr = "127.0.0.1:43330".parse().expect("client address");

        let check = contribute(
            ConnectInfo(client_addr),
            State(state.clone()),
            Json(request(&actor_session, "inspect-washed-stones")),
        )
        .await
        .0;
        assert!(check.ok, "{:?}", check.events);
        assert!(check.events.iter().any(|event| {
            event.type_name == "job.contribution.resolved"
                && event.content.as_deref().is_some_and(|content| {
                    content.contains("\"strategy_id\":\"inspect-washed-stones\"")
                        && content.contains("\"action_kind\":\"check\"")
                })
        }));

        let prepared = prepare(
            ConnectInfo(client_addr),
            State(state.clone()),
            Json(ActorRequest {
                actor_id: 5000,
                actor_session: Some(actor_session.clone()),
            }),
        )
        .await
        .0;
        assert!(prepared.ok, "{:?}", prepared.events);

        let work = contribute(
            ConnectInfo(client_addr),
            State(state.clone()),
            Json(request(&actor_session, "clear-garden-drain")),
        )
        .await
        .0;
        assert!(work.ok, "{:?}", work.events);
        assert!(work.events.iter().any(|event| {
            event.type_name == "job.contribution.resolved"
                && event.content.as_deref().is_some_and(|content| {
                    content.contains("\"strategy_id\":\"clear-garden-drain\"")
                        && content.contains("\"action_kind\":\"work\"")
                })
        }));
        assert!(work.events.iter().any(|event| {
            event.type_name == "tag.cleared"
                && event.tag_label.as_deref() == Some("spent preparation")
        }));

        let runtime = state.inner.lock().await;
        let clock = runtime
            .clocks
            .get(FIRST_TALE_PROGRESS_CLOCK_ID)
            .expect("Rain Garden clock");
        assert_eq!(clock.filled, clock.segments);
        assert_eq!(
            runtime
                .jobs
                .get(FIRST_TALE_JOB_ID)
                .map(|job| runtime.job_status(job)),
            Some("completed".to_string())
        );
        assert!(!runtime.project_preparation_spent_for_actor(5000));
    }

    #[tokio::test]
    async fn study_strategy_derives_its_authored_ability_and_dc() {
        let mut runtime = RuntimeWorld::seeded();
        create_test_human(
            &mut runtime,
            5000,
            MOONLIT_TRAIL_LOCATION_ID,
            "Moonlit Reader",
        );
        runtime.world.actors[..runtime.world.actor_count]
            .iter_mut()
            .find(|actor| actor.id == 5000)
            .expect("test actor")
            .stats
            .intelligence = 30;
        let state = test_app_state(runtime, None);
        let (actor_session, _) = issue_actor_session(&state, 5000);

        let response = contribute(
            ConnectInfo("127.0.0.1:43332".parse().expect("client address")),
            State(state),
            Json(JobContributionRequest {
                actor_id: 5000,
                actor_session: Some(actor_session),
                job_id: Some(MOONLIT_JOB_ID.to_string()),
                strategy_id: Some("read-moonlit-signs".to_string()),
            }),
        )
        .await
        .0;

        assert!(response.ok, "{:?}", response.events);
        assert!(response.events.iter().any(|event| {
            event.type_name == "ability_check.rolled"
                && event.modifier == Some(10)
                && event.dc == Some(12)
        }));
        assert!(response
            .events
            .iter()
            .any(|event| event.type_name == "study.resolved"));
        assert!(response.events.iter().any(|event| {
            event.type_name == "job.contribution.resolved"
                && event.content.as_deref().is_some_and(|content| {
                    content.contains("\"strategy_id\":\"read-moonlit-signs\"")
                        && content.contains("\"action_kind\":\"study\"")
                })
        }));
    }

    #[tokio::test]
    async fn help_strategy_submits_through_its_exact_authored_identity() {
        let mut runtime = RuntimeWorld::seeded();
        create_test_human(
            &mut runtime,
            5000,
            MOONLIT_TRAIL_LOCATION_ID,
            "Trail Helper",
        );
        let state = test_app_state(runtime, None);
        let (actor_session, _) = issue_actor_session(&state, 5000);

        let response = contribute(
            ConnectInfo("127.0.0.1:43333".parse().expect("client address")),
            State(state),
            Json(JobContributionRequest {
                actor_id: 5000,
                actor_session: Some(actor_session),
                job_id: Some(MOONLIT_JOB_ID.to_string()),
                strategy_id: Some("steady-beside-traveler".to_string()),
            }),
        )
        .await
        .0;

        assert!(response.ok, "{:?}", response.events);
        assert!(response.events.iter().any(|event| {
            event.type_name == "job.contribution.resolved"
                && event.content.as_deref().is_some_and(|content| {
                    content.contains("\"strategy_id\":\"steady-beside-traveler\"")
                        && content.contains("\"action_kind\":\"help\"")
                })
        }));
    }

    #[tokio::test]
    async fn item_strategy_uses_its_authored_item_without_consuming_it() {
        let mut runtime = RuntimeWorld::seeded();
        create_test_human(
            &mut runtime,
            5000,
            MOONLIT_TRAIL_LOCATION_ID,
            "Marker Bearer",
        );
        let marker = runtime
            .world
            .items
            .iter_mut()
            .take(runtime.world.item_count)
            .find(|item| item.id == 2003)
            .expect("Wolfprint Charm");
        marker.location_id = 0;
        marker.holder_actor_id = 5000;
        marker.zone = CW_CARD_ZONE_CARRIED;
        let before = runtime.clocks[MOONLIT_PROGRESS_CLOCK_ID].filled;
        let state = test_app_state(runtime, None);
        let (actor_session, _) = issue_actor_session(&state, 5000);

        let response = contribute(
            ConnectInfo("127.0.0.1:43331".parse().expect("client address")),
            State(state.clone()),
            Json(JobContributionRequest {
                actor_id: 5000,
                actor_session: Some(actor_session),
                job_id: Some(MOONLIT_JOB_ID.to_string()),
                strategy_id: Some("set-wolfprint-marker".to_string()),
            }),
        )
        .await
        .0;

        assert!(response.ok, "{:?}", response.events);
        assert!(response.events.iter().any(|event| {
            event.type_name == "item.used"
                && event.actor_id == Some(5000)
                && event.item_id == Some(2003)
        }));
        assert!(response.events.iter().any(|event| {
            event.type_name == "job.contribution.resolved"
                && event.content.as_deref().is_some_and(|content| {
                    content.contains("\"strategy_id\":\"set-wolfprint-marker\"")
                        && content.contains("\"action_kind\":\"use_item\"")
                })
        }));
        let runtime = state.inner.lock().await;
        assert_eq!(runtime.clocks[MOONLIT_PROGRESS_CLOCK_ID].filled, before + 1);
        assert_eq!(runtime.item_by_id(2003).map(|item| item.charges), Some(1));
    }

    #[test]
    fn rain_garden_offers_exact_strategy_keyed_commands() {
        let mut runtime = RuntimeWorld::seeded();
        create_test_human(
            &mut runtime,
            5000,
            RAIN_SOFT_GARDEN_LOCATION_ID,
            "Offer Gardener",
        );

        let (_, offers) = runtime.legal_action_candidates(Some(5000), &AccessContext::default());
        for (kind, strategy_id) in [
            ("check", "inspect-washed-stones"),
            ("work", "clear-garden-drain"),
        ] {
            let offer = offers
                .iter()
                .find(|offer| {
                    offer.kind == kind
                        && offer.project.as_ref().is_some_and(|project| {
                            project.id == FIRST_TALE_JOB_ID
                                && project.strategy_id.as_deref() == Some(strategy_id)
                        })
                })
                .unwrap_or_else(|| panic!("missing {kind} offer for {strategy_id}"));
            assert_eq!(offer.command, format!("contribute {strategy_id}"));
            let command = runtime
                .resolve_command(
                    &CommandRequest {
                        actor_id: 5000,
                        actor_session: None,
                        command: offer.command.clone(),
                        wallet_address: None,
                        wallet: None,
                        wallet_session: None,
                        owned_card_ids: None,
                        cards: None,
                        envelope: None,
                    },
                    &AccessContext::default(),
                )
                .expect("advertised contribution command parses");
            assert!(matches!(
                command.dispatch,
                CommandDispatch::Contribute {
                    ref job_id,
                    ref strategy_id,
                    ref action_kind,
                } if job_id == FIRST_TALE_JOB_ID
                    && strategy_id == offer.project.as_ref().unwrap().strategy_id.as_ref().unwrap()
                    && action_kind == kind
            ));
        }
    }
}
