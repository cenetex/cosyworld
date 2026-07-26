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
pub(super) struct RouteRecordState {
    pub(super) id: String,
    pub(super) edges: Vec<RouteEdgeState>,
    pub(super) owner: String,
    pub(super) provenance: String,
    pub(super) lifecycle: RouteLifecycle,
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
                entity_version: 1,
            });
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
}
