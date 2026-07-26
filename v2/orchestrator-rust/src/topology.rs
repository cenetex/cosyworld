use super::*;

#[derive(Clone, Copy, Debug, Default, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub(super) enum RouteLifecycle {
    Latent,
    #[default]
    Open,
    Blocked,
    Frozen,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub(super) struct RouteEdgeState {
    pub(super) from_location_id: u64,
    pub(super) to_location_id: u64,
    pub(super) flags: u32,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub(super) struct RouteDiscoveryState {
    pub(super) actor_id: u64,
    pub(super) event_seq: u64,
    pub(super) reason: String,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub(super) struct RouteRecordState {
    pub(super) id: String,
    pub(super) edges: Vec<RouteEdgeState>,
    pub(super) owner: String,
    pub(super) provenance: String,
    pub(super) lifecycle: RouteLifecycle,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(super) discovery: Option<RouteDiscoveryState>,
    pub(super) entity_version: u64,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub(super) struct RouteOfferBinding {
    pub(super) route_id: String,
    pub(super) route_version: u64,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub(super) struct RouteLifecycleMutation {
    pub(super) route_id: String,
    pub(super) expected_version: u64,
    pub(super) lifecycle: RouteLifecycle,
    pub(super) reason: String,
}

fn ordered_route_endpoints(left: u64, right: u64) -> (u64, u64) {
    if left <= right {
        (left, right)
    } else {
        (right, left)
    }
}

fn authored_route_id(left: u64, right: u64) -> String {
    let (left, right) = ordered_route_endpoints(left, right);
    format!("route:authored:{left}:{right}")
}

fn hidden_route_id(hidden_exit_id: &str) -> String {
    format!("route:hidden:{hidden_exit_id}")
}

fn generated_route_id(pathway_id: &str, left: u64, right: u64) -> String {
    let (left, right) = ordered_route_endpoints(left, right);
    format!("route:generated:{pathway_id}:{left}:{right}")
}

impl RouteRecordState {
    fn contains_edge(&self, from_location_id: u64, to_location_id: u64) -> bool {
        self.edges.iter().any(|edge| {
            edge.from_location_id == from_location_id && edge.to_location_id == to_location_id
        })
    }
}

impl RuntimeWorld {
    fn reconcile_route_record(&mut self, mut proposed: RouteRecordState) {
        proposed
            .edges
            .sort_by_key(|edge| (edge.from_location_id, edge.to_location_id, edge.flags));
        proposed.edges.dedup();
        let Some(current) = self.routes.get_mut(&proposed.id) else {
            proposed.entity_version = proposed.entity_version.max(1);
            self.routes.insert(proposed.id.clone(), proposed);
            return;
        };
        let structure_changed = current.edges != proposed.edges
            || current.owner != proposed.owner
            || current.provenance != proposed.provenance;
        if structure_changed {
            current.edges = proposed.edges;
            current.owner = proposed.owner;
            current.provenance = proposed.provenance;
            current.entity_version = current.entity_version.saturating_add(1).max(1);
        }
    }

    pub(super) fn ensure_authored_route_records(&mut self) {
        let mut records = BTreeMap::<String, RouteRecordState>::new();
        for exit in &active_content().exits {
            let id = authored_route_id(exit.from_location_id, exit.to_location_id);
            records
                .entry(id.clone())
                .or_insert_with(|| RouteRecordState {
                    id,
                    edges: Vec::new(),
                    owner: format!("worldpack:{}", active_content().manifest.id),
                    provenance: "authored_exit".to_string(),
                    lifecycle: RouteLifecycle::Open,
                    discovery: None,
                    entity_version: 1,
                })
                .edges
                .push(RouteEdgeState {
                    from_location_id: exit.from_location_id,
                    to_location_id: exit.to_location_id,
                    flags: exit.flags,
                });
        }
        for record in records.into_values() {
            self.reconcile_route_record(record);
        }
    }

    pub(super) fn ensure_hidden_route_records(&mut self) {
        for hidden in &active_content().hidden_exits {
            self.reconcile_route_record(RouteRecordState {
                id: hidden_route_id(&hidden.id),
                edges: vec![
                    RouteEdgeState {
                        from_location_id: hidden.from_location_id,
                        to_location_id: hidden.to_location_id,
                        flags: 0,
                    },
                    RouteEdgeState {
                        from_location_id: hidden.to_location_id,
                        to_location_id: hidden.from_location_id,
                        flags: 0,
                    },
                ],
                owner: format!("worldpack:{}", active_content().manifest.id),
                provenance: hidden.source.clone(),
                lifecycle: RouteLifecycle::Latent,
                discovery: None,
                entity_version: 1,
            });
        }
    }

    pub(super) fn ensure_generated_pathway_route_records(
        &mut self,
        pathway: &GeneratedPathwayState,
    ) {
        let mut path = Vec::with_capacity(pathway.waypoints.len() + 2);
        path.push(pathway.origin_location_id);
        path.extend(pathway.waypoints.iter().map(|waypoint| waypoint.id));
        path.push(pathway.destination_location_id);
        for edge in path.windows(2) {
            let from_location_id = edge[0];
            let to_location_id = edge[1];
            let lifecycle = if pathway
                .revealed_edges
                .contains(&pathway_edge_key(from_location_id, to_location_id))
            {
                RouteLifecycle::Open
            } else {
                RouteLifecycle::Latent
            };
            let id = generated_route_id(&pathway.id, from_location_id, to_location_id);
            let owner = self
                .canonical_ref("actor", pathway.created_by_actor_id)
                .map(ToString::to_string)
                .unwrap_or_else(|| format!("actor:{}", pathway.created_by_actor_id));
            self.reconcile_route_record(RouteRecordState {
                id,
                edges: vec![
                    RouteEdgeState {
                        from_location_id,
                        to_location_id,
                        flags: 0,
                    },
                    RouteEdgeState {
                        from_location_id: to_location_id,
                        to_location_id: from_location_id,
                        flags: 0,
                    },
                ],
                owner,
                provenance: format!("generated_pathway:{}", pathway.id),
                lifecycle,
                discovery: None,
                entity_version: 1,
            });
        }
    }

    pub(super) fn route_discovered_for_edge(
        &self,
        from_location_id: u64,
        to_location_id: u64,
    ) -> bool {
        self.route_for_edge_in_any_lifecycle(from_location_id, to_location_id)
            .is_some_and(|route| route.discovery.is_some())
    }

    pub(super) fn mark_route_discovered_for_edge(
        &mut self,
        from_location_id: u64,
        to_location_id: u64,
        actor_id: u64,
        event_seq: u64,
        reason: &str,
    ) -> bool {
        let Some(route_id) = self
            .route_for_edge_in_any_lifecycle(from_location_id, to_location_id)
            .map(|route| route.id.clone())
        else {
            return false;
        };
        let route = self
            .routes
            .get_mut(&route_id)
            .expect("resolved route remains present");
        if route.discovery.is_some() {
            return false;
        }
        route.discovery = Some(RouteDiscoveryState {
            actor_id,
            event_seq,
            reason: reason.to_string(),
        });
        route.entity_version = route.entity_version.saturating_add(1).max(1);
        true
    }

    pub(super) fn plan_direct_authored_route_discovery(
        &self,
        actor_id: u64,
        destination_location_id: u64,
    ) -> Option<(CwAction, ProjectionMutation, JourneyNarrationPlan)> {
        let actor = self.actor_by_id(actor_id)?;
        let exit = self.seed_exit_by_locations(actor.location_id, destination_location_id)?;
        if exit.distance > 1
            || self.seed_exit_discovered(exit.from_location_id, exit.to_location_id)
        {
            return None;
        }
        let destination_name = self
            .location_name(destination_location_id)
            .unwrap_or_else(|| format!("Location {destination_location_id}"));
        Some((
            CwAction {
                kind: CW_ACTION_NONE,
                actor_id,
                ..CwAction::default()
            },
            ProjectionMutation::DiscoverSeedExit {
                from_location_id: actor.location_id,
                to_location_id: destination_location_id,
                reason: "scout_direct_route".to_string(),
            },
            JourneyNarrationPlan {
                actor_name: self
                    .actor_name(actor_id)
                    .unwrap_or_else(|| "The traveller".to_string()),
                from_name: self
                    .location_name(actor.location_id)
                    .unwrap_or_else(|| "the path's edge".to_string()),
                to_name: destination_name.clone(),
                destination_name,
                current_step: 1,
                total_steps: 1,
                discovery: true,
            },
        ))
    }

    pub(super) fn backfill_route_discovery_from_tags(&mut self) {
        let mut discoveries = BTreeMap::<String, RouteDiscoveryState>::new();
        for exit in &active_content().exits {
            let Some(tag) = self
                .tags
                .get(&seed_exit_discovered_tag_id(
                    exit.from_location_id,
                    exit.to_location_id,
                ))
                .filter(|tag| tag.active)
            else {
                continue;
            };
            let event_seq = tag.source_event_seq.unwrap_or(0);
            let actor_id = self
                .event_log
                .iter()
                .find(|event| event.seq == event_seq)
                .and_then(|event| event.actor_id)
                .unwrap_or(0);
            discoveries
                .entry(authored_route_id(
                    exit.from_location_id,
                    exit.to_location_id,
                ))
                .or_insert_with(|| RouteDiscoveryState {
                    actor_id,
                    event_seq,
                    reason: "legacy_discovery_tag".to_string(),
                });
        }
        for hidden_exit in &active_content().hidden_exits {
            let Some(tag) = self
                .tags
                .get(&hidden_exit_discovered_tag_id(&hidden_exit.id))
                .filter(|tag| tag.active)
            else {
                continue;
            };
            let event_seq = tag.source_event_seq.unwrap_or(0);
            let actor_id = self
                .event_log
                .iter()
                .find(|event| event.seq == event_seq)
                .and_then(|event| event.actor_id)
                .unwrap_or(0);
            discoveries
                .entry(hidden_route_id(&hidden_exit.id))
                .or_insert_with(|| RouteDiscoveryState {
                    actor_id,
                    event_seq,
                    reason: "legacy_discovery_tag".to_string(),
                });
        }
        for (route_id, route) in &self.routes {
            let Some(pathway_id) = route.provenance.strip_prefix("generated_pathway:") else {
                continue;
            };
            if route.lifecycle != RouteLifecycle::Open || route.discovery.is_some() {
                continue;
            }
            let actor_id = self
                .generated_pathways
                .get(pathway_id)
                .map(|pathway| pathway.created_by_actor_id)
                .unwrap_or(0);
            discoveries
                .entry(route_id.clone())
                .or_insert_with(|| RouteDiscoveryState {
                    actor_id,
                    event_seq: 0,
                    reason: "legacy_generated_pathway".to_string(),
                });
        }
        for (route_id, discovery) in discoveries {
            let Some(route) = self.routes.get_mut(&route_id) else {
                continue;
            };
            if route.discovery.is_none() {
                route.discovery = Some(discovery);
            }
        }
    }

    pub(super) fn route_for_edge(
        &self,
        from_location_id: u64,
        to_location_id: u64,
    ) -> Option<&RouteRecordState> {
        self.routes
            .values()
            .filter(|route| route.lifecycle == RouteLifecycle::Open)
            .find(|route| route.contains_edge(from_location_id, to_location_id))
    }

    fn route_for_edge_in_any_lifecycle(
        &self,
        from_location_id: u64,
        to_location_id: u64,
    ) -> Option<&RouteRecordState> {
        self.routes
            .values()
            .find(|route| route.contains_edge(from_location_id, to_location_id))
    }

    fn binding_for_route(route: &RouteRecordState) -> RouteOfferBinding {
        RouteOfferBinding {
            route_id: route.id.clone(),
            route_version: route.entity_version,
        }
    }

    pub(super) fn route_offer_binding(
        &self,
        from_location_id: u64,
        to_location_id: u64,
    ) -> Option<RouteOfferBinding> {
        self.route_for_edge(from_location_id, to_location_id)
            .map(Self::binding_for_route)
    }

    pub(super) fn scout_route_offer_binding(
        &self,
        actor_id: u64,
        destination_location_id: u64,
    ) -> Option<RouteOfferBinding> {
        if let Some(journey) = self.journeys.get(&actor_id) {
            let from_location_id = *journey.path.get(journey.current_step)?;
            let to_location_id = *journey.path.get(journey.current_step + 1)?;
            return self
                .route_for_edge_in_any_lifecycle(from_location_id, to_location_id)
                .map(Self::binding_for_route);
        }
        let from_location_id = self.actor_by_id(actor_id)?.location_id;
        self.route_for_edge_in_any_lifecycle(from_location_id, destination_location_id)
            .map(Self::binding_for_route)
    }

    pub(super) fn route_binding_is_current(&self, binding: &RouteOfferBinding) -> bool {
        self.routes
            .get(&binding.route_id)
            .is_some_and(|route| route.entity_version == binding.route_version)
    }

    pub(super) fn transition_route(
        &mut self,
        route_id: &str,
        expected_version: u64,
        lifecycle: RouteLifecycle,
    ) -> bool {
        let Some(route) = self.routes.get_mut(route_id) else {
            return false;
        };
        if route.lifecycle == lifecycle {
            return true;
        }
        if route.entity_version != expected_version {
            return false;
        }
        route.lifecycle = lifecycle;
        route.entity_version = route.entity_version.saturating_add(1).max(1);
        true
    }

    pub(super) fn apply_route_lifecycle_mutation(
        &mut self,
        actor_id: u64,
        route_id: &str,
        expected_version: u64,
        lifecycle: RouteLifecycle,
        reason: &str,
    ) -> Option<EventView> {
        let changed = self
            .routes
            .get(route_id)
            .is_some_and(|route| route.lifecycle != lifecycle);
        if !self.transition_route(route_id, expected_version, lifecycle) {
            return None;
        }
        self.rebuild_kernel_exits_from_routes();
        changed.then(|| {
            let state = match lifecycle {
                RouteLifecycle::Latent => "latent",
                RouteLifecycle::Open => "opened",
                RouteLifecycle::Blocked => "blocked",
                RouteLifecycle::Frozen => "frozen",
            };
            self.append_async_job_event(
                &format!("route.{state}"),
                actor_id,
                None,
                Some(format!("{route_id}:{reason}")),
            )
        })
    }

    pub(super) fn open_hidden_route(&mut self, hidden_exit_id: &str) {
        let route_id = hidden_route_id(hidden_exit_id);
        let Some(route) = self.routes.get(&route_id) else {
            return;
        };
        let version = route.entity_version;
        self.transition_route(&route_id, version, RouteLifecycle::Open);
    }

    pub(super) fn open_generated_pathway_route(
        &mut self,
        pathway: &GeneratedPathwayState,
        from_location_id: u64,
        to_location_id: u64,
    ) {
        self.ensure_generated_pathway_route_records(pathway);
        let route_id = generated_route_id(&pathway.id, from_location_id, to_location_id);
        let Some(route) = self.routes.get(&route_id) else {
            return;
        };
        let version = route.entity_version;
        self.transition_route(&route_id, version, RouteLifecycle::Open);
    }

    pub(super) fn rebuild_kernel_exits_from_routes(&mut self) {
        self.world.exit_count = 0;
        let known_locations = self.world.locations[..self.world.location_count]
            .iter()
            .map(|location| location.id)
            .collect::<BTreeSet<_>>();
        let mut edges = self
            .routes
            .values()
            .filter(|route| route.lifecycle == RouteLifecycle::Open)
            .flat_map(|route| route.edges.iter().cloned())
            .filter(|edge| {
                known_locations.contains(&edge.from_location_id)
                    && known_locations.contains(&edge.to_location_id)
            })
            .collect::<Vec<_>>();
        edges.sort_by_key(|edge| (edge.from_location_id, edge.to_location_id, edge.flags));
        edges.dedup();
        for edge in edges.into_iter().take(CW_MAX_EXITS) {
            self.world.exits[self.world.exit_count] = CwExit {
                from_location_id: edge.from_location_id,
                to_location_id: edge.to_location_id,
                flags: edge.flags,
            };
            self.world.exit_count += 1;
        }
    }

    pub(super) fn route_record_preconditions_hold(&self, record: &JournalRecord) -> bool {
        if record
            .route_binding
            .as_ref()
            .is_some_and(|binding| !self.route_binding_is_current(binding))
        {
            return false;
        }
        record.projection_mutations.iter().all(|mutation| {
            let ProjectionMutation::SetRouteLifecycle(transition) = mutation else {
                return true;
            };
            self.routes.get(&transition.route_id).is_some_and(|route| {
                route.lifecycle == transition.lifecycle
                    || route.entity_version == transition.expected_version
            })
        })
    }

    pub(super) fn bind_route_precondition(&self, record: &mut JournalRecord) {
        if record.route_binding.is_some() {
            return;
        }
        if let Some(binding) =
            record
                .projection_mutations
                .iter()
                .find_map(|mutation| match mutation {
                    ProjectionMutation::JourneyTransition {
                        pathway,
                        reveal_edges,
                        ..
                    } => reveal_edges
                        .first()
                        .and_then(|(from_location_id, to_location_id)| {
                            self.route_for_edge_in_any_lifecycle(*from_location_id, *to_location_id)
                                .map(Self::binding_for_route)
                                .or_else(|| {
                                    let from_location_id =
                                        self.actor_by_id(record.action.actor_id)?.location_id;
                                    self.route_for_edge_in_any_lifecycle(
                                        from_location_id,
                                        pathway.destination_location_id,
                                    )
                                    .map(Self::binding_for_route)
                                })
                        }),
                    ProjectionMutation::DiscoverSeedExit {
                        from_location_id,
                        to_location_id,
                        ..
                    } => self
                        .route_for_edge_in_any_lifecycle(*from_location_id, *to_location_id)
                        .map(Self::binding_for_route),
                    ProjectionMutation::DiscoverHiddenExit { hidden_exit_id, .. } => self
                        .routes
                        .get(&hidden_route_id(hidden_exit_id))
                        .map(Self::binding_for_route),
                    ProjectionMutation::RendezvousActor {
                        actor_id,
                        location_id,
                        ..
                    } => {
                        let from_location_id = self.actor_by_id(*actor_id)?.location_id;
                        self.route_for_edge(from_location_id, *location_id)
                            .map(Self::binding_for_route)
                    }
                    _ => None,
                })
        {
            record.route_binding = Some(binding);
            return;
        }
        if !matches!(
            record.action.kind,
            CW_ACTION_MOVE | CW_ACTION_FLEE | CW_ACTION_COMBAT_ESCAPE
        ) {
            return;
        }
        let Some(actor) = self.actor_by_id(record.action.actor_id) else {
            return;
        };
        record.route_binding =
            self.route_offer_binding(actor.location_id, record.action.destination_location_id);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn canonical_routes_compile_kernel_exits_and_survive_snapshot() {
        let runtime = RuntimeWorld::seeded();
        assert!(!runtime.routes.is_empty());
        for exit in &runtime.world.exits[..runtime.world.exit_count] {
            let route = runtime
                .route_for_edge(exit.from_location_id, exit.to_location_id)
                .expect("every kernel exit is compiled from an open route");
            assert!(route.entity_version > 0);
        }

        let restored = RuntimeSnapshot::from_runtime(&runtime)
            .into_runtime()
            .expect("route state restores");
        assert_eq!(restored.routes, runtime.routes);
        assert_eq!(
            &restored.world.exits[..restored.world.exit_count],
            &runtime.world.exits[..runtime.world.exit_count]
        );
    }

    #[test]
    fn route_lifecycle_transition_is_versioned_idempotent_and_atomic() {
        let mut runtime = RuntimeWorld::seeded();
        let route_id = runtime
            .routes
            .values()
            .find(|route| route.lifecycle == RouteLifecycle::Open)
            .expect("open seed route")
            .id
            .clone();
        let version = runtime.routes[&route_id].entity_version;
        let mut record = JournalRecord::new(CwAction::default(), 31_600);
        record
            .projection_mutations
            .push(ProjectionMutation::SetRouteLifecycle(
                RouteLifecycleMutation {
                    route_id: route_id.clone(),
                    expected_version: version,
                    lifecycle: RouteLifecycle::Blocked,
                    reason: "test".to_string(),
                },
            ));

        let (status, _) = runtime.apply_journal_record(&record);
        assert_eq!(status, CW_OK);
        assert_eq!(
            runtime.routes[&route_id].entity_version,
            version.saturating_add(1)
        );
        let blocked_exits = runtime.world.exit_count;

        let (status, _) = runtime.apply_journal_record(&record);
        assert_eq!(status, CW_OK);
        assert_eq!(
            runtime.routes[&route_id].entity_version,
            version.saturating_add(1)
        );
        assert_eq!(runtime.world.exit_count, blocked_exits);

        let stale = JournalRecord {
            projection_mutations: vec![ProjectionMutation::SetRouteLifecycle(
                RouteLifecycleMutation {
                    route_id: route_id.clone(),
                    expected_version: version,
                    lifecycle: RouteLifecycle::Frozen,
                    reason: "stale".to_string(),
                },
            )],
            ..JournalRecord::new(CwAction::default(), 31_601)
        };
        let before = runtime.clone();
        let (status, events) = runtime.apply_journal_record(&stale);
        assert_eq!(status, CW_ERR_RULE);
        assert!(events.is_empty());
        assert_eq!(runtime.routes, before.routes);
        assert_eq!(runtime.world.exit_count, before.world.exit_count);
    }

    #[test]
    fn memory_decay_never_changes_shared_topology() {
        let mut runtime = RuntimeWorld::seeded();
        runtime.search_memories.insert(
            "route-memory".to_string(),
            SearchMemoryState {
                id: "route-memory".to_string(),
                actor_id: RATI_ACTOR_ID,
                kind: "exit".to_string(),
                location_id: COSY_COTTAGE_LOCATION_ID,
                subject_id: RAIN_SOFT_GARDEN_LOCATION_ID,
                subject_key: "exit:1:2".to_string(),
                confidence: 1,
                salience: 1,
                found_tick: 0,
                last_used_tick: 0,
                use_count: 0,
            },
        );
        let routes = runtime.routes.clone();
        let exits = runtime.world.exits[..runtime.world.exit_count].to_vec();
        runtime.world.tick = SEARCH_MEMORY_TIME_DECAY_INTERVAL_TICKS * 64;
        runtime.decay_search_memories();
        assert_eq!(runtime.routes, routes);
        assert_eq!(&runtime.world.exits[..runtime.world.exit_count], exits);
    }

    #[test]
    fn discovered_routes_survive_memory_decay_for_later_actors_and_replay() {
        let mut runtime = RuntimeWorld::seeded();
        create_test_human(
            &mut runtime,
            5000,
            COSY_COTTAGE_LOCATION_ID,
            "Forgetful Finder",
        );
        let access = AccessContext::default();

        assert!(runtime
            .seed_exit_candidate_for_search(COSY_COTTAGE_LOCATION_ID)
            .is_some_and(|exit| exit.to_location_id == RAIN_SOFT_GARDEN_LOCATION_ID));

        let mut record = JournalRecord::new(
            CwAction {
                kind: CW_ACTION_NONE,
                actor_id: 5000,
                location_id: COSY_COTTAGE_LOCATION_ID,
                ..CwAction::default()
            },
            91_001,
        );
        record
            .projection_mutations
            .push(ProjectionMutation::DiscoverSeedExit {
                from_location_id: COSY_COTTAGE_LOCATION_ID,
                to_location_id: RAIN_SOFT_GARDEN_LOCATION_ID,
                reason: "search_feature".to_string(),
            });
        assert_eq!(runtime.apply_journal_record(&record).0, CW_OK);
        assert!(
            runtime.seed_exit_discovered(COSY_COTTAGE_LOCATION_ID, RAIN_SOFT_GARDEN_LOCATION_ID)
        );
        let discovery = runtime
            .route_for_edge(COSY_COTTAGE_LOCATION_ID, RAIN_SOFT_GARDEN_LOCATION_ID)
            .and_then(|route| route.discovery.clone())
            .expect("the shared route records discovery provenance");
        assert_eq!(discovery.actor_id, 5000);
        assert_eq!(discovery.reason, "search_feature");
        assert!(discovery.event_seq > 0);

        runtime.world.tick = runtime
            .world
            .tick
            .saturating_add(SEARCH_MEMORY_TIME_DECAY_INTERVAL_TICKS * 64);
        runtime.decay_search_memories();

        assert!(
            runtime.seed_exit_discovered(COSY_COTTAGE_LOCATION_ID, RAIN_SOFT_GARDEN_LOCATION_ID)
        );
        assert!(runtime
            .seed_exit_candidate_for_search(COSY_COTTAGE_LOCATION_ID)
            .is_none_or(|exit| exit.to_location_id != RAIN_SOFT_GARDEN_LOCATION_ID));

        create_test_human(
            &mut runtime,
            5001,
            COSY_COTTAGE_LOCATION_ID,
            "Later Traveller",
        );
        let later_state = runtime.state_response(Some(5001), &access);
        assert!(later_state
            .action_offers
            .iter()
            .any(|offer| offer.kind == "move"
                && offer
                    .target
                    .as_ref()
                    .is_some_and(|target| target.id == Some(RAIN_SOFT_GARDEN_LOCATION_ID))));
        assert!(!later_state
            .action_offers
            .iter()
            .any(|offer| offer.kind == "explore_path"
                && offer
                    .target
                    .as_ref()
                    .is_some_and(|target| target.id == Some(RAIN_SOFT_GARDEN_LOCATION_ID))));

        let restored = RuntimeSnapshot::from_runtime(&runtime)
            .into_runtime()
            .expect("durable route discovery replays");
        assert_eq!(
            restored
                .route_for_edge(COSY_COTTAGE_LOCATION_ID, RAIN_SOFT_GARDEN_LOCATION_ID)
                .and_then(|route| route.discovery.as_ref()),
            Some(&discovery)
        );
    }

    #[test]
    fn direct_authored_secret_scouts_once_without_a_generated_journey() {
        let mut runtime = RuntimeWorld::seeded();
        create_test_human(&mut runtime, 5000, COSY_COTTAGE_LOCATION_ID, "Direct Scout");
        let access = AccessContext::default();
        let initial = runtime.state_response(Some(5000), &access);
        let offer = initial
            .action_offers
            .iter()
            .find(|offer| {
                offer.kind == "explore_path"
                    && offer
                        .target
                        .as_ref()
                        .is_some_and(|target| target.id == Some(RAIN_SOFT_GARDEN_LOCATION_ID))
            })
            .cloned()
            .expect("the adjacent undiscovered route offers Scout");
        let (action, mutation, _) = runtime
            .plan_scout_offer(5000, &offer)
            .expect("the exact Scout offer plans");
        assert_eq!(action.kind, CW_ACTION_NONE);
        assert!(matches!(
            mutation,
            ProjectionMutation::DiscoverSeedExit {
                from_location_id: COSY_COTTAGE_LOCATION_ID,
                to_location_id: RAIN_SOFT_GARDEN_LOCATION_ID,
                ..
            }
        ));

        let mut record = JournalRecord::new(action, 91_003);
        record.bind_offer_kind("explore_path");
        record.projection_mutations.push(mutation);
        let (status, events) = runtime.apply_journal_record(&record);
        assert_eq!(status, CW_OK);
        assert_eq!(
            events
                .iter()
                .filter(|event| event.type_name == "exit.discovered")
                .count(),
            1
        );
        let route_version = runtime
            .route_for_edge(COSY_COTTAGE_LOCATION_ID, RAIN_SOFT_GARDEN_LOCATION_ID)
            .expect("discovered route remains canonical")
            .entity_version;
        let (repeat_status, repeat_events) = runtime.apply_journal_record(&record);
        assert_eq!(repeat_status, CW_OK);
        assert!(repeat_events.is_empty());
        assert_eq!(
            runtime
                .route_for_edge(COSY_COTTAGE_LOCATION_ID, RAIN_SOFT_GARDEN_LOCATION_ID)
                .expect("replayed discovery keeps the route")
                .entity_version,
            route_version
        );
        assert!(runtime.generated_pathways.is_empty());
        let settled = runtime.state_response(Some(5000), &access);
        assert!(settled.action_offers.iter().any(|offer| {
            offer.kind == "move"
                && offer
                    .target
                    .as_ref()
                    .is_some_and(|target| target.id == Some(RAIN_SOFT_GARDEN_LOCATION_ID))
        }));
        assert!(!settled.action_offers.iter().any(|offer| {
            offer.kind == "explore_path"
                && offer
                    .target
                    .as_ref()
                    .is_some_and(|target| target.id == Some(RAIN_SOFT_GARDEN_LOCATION_ID))
        }));
    }

    #[test]
    fn legacy_snapshot_backfills_route_discovery_from_durable_tags() {
        let mut runtime = RuntimeWorld::seeded();
        let mut record = JournalRecord::new(
            CwAction {
                kind: CW_ACTION_NONE,
                actor_id: RATI_ACTOR_ID,
                location_id: COSY_COTTAGE_LOCATION_ID,
                ..CwAction::default()
            },
            31_700,
        );
        record
            .projection_mutations
            .push(ProjectionMutation::DiscoverSeedExit {
                from_location_id: COSY_COTTAGE_LOCATION_ID,
                to_location_id: RAIN_SOFT_GARDEN_LOCATION_ID,
                reason: "legacy_fixture".to_string(),
            });
        assert_eq!(runtime.apply_journal_record(&record).0, CW_OK);

        let mut snapshot = RuntimeSnapshot::from_runtime(&runtime);
        snapshot.version = 11;
        let route = snapshot
            .routes
            .values_mut()
            .find(|route| {
                route.contains_edge(COSY_COTTAGE_LOCATION_ID, RAIN_SOFT_GARDEN_LOCATION_ID)
            })
            .expect("authored route persists");
        route.discovery = None;

        let restored = snapshot.into_runtime().expect("legacy discovery migrates");
        let discovery = restored
            .route_for_edge(COSY_COTTAGE_LOCATION_ID, RAIN_SOFT_GARDEN_LOCATION_ID)
            .and_then(|route| route.discovery.as_ref())
            .expect("legacy tag becomes canonical route discovery");
        assert_eq!(discovery.actor_id, RATI_ACTOR_ID);
        assert!(discovery.event_seq > 0);
        assert_eq!(discovery.reason, "legacy_discovery_tag");
    }
}
