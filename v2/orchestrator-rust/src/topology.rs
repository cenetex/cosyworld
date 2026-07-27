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

#[derive(Clone, Copy, Debug, Default, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub(super) enum RouteDirectionality {
    #[default]
    Reciprocal,
    OneWay,
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
    #[serde(default)]
    pub(super) canonical_id: String,
    pub(super) edges: Vec<RouteEdgeState>,
    pub(super) owner: String,
    #[serde(default)]
    pub(super) owner_pack_id: String,
    #[serde(default)]
    pub(super) owner_pack_version: String,
    pub(super) provenance: String,
    #[serde(default)]
    pub(super) directionality: RouteDirectionality,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(super) fallback_location_id: Option<u64>,
    pub(super) lifecycle: RouteLifecycle,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(super) discovery: Option<RouteDiscoveryState>,
    pub(super) entity_version: u64,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub(super) struct RouteOfferBinding {
    pub(super) route_id: String,
    pub(super) route_version: u64,
    #[serde(default)]
    pub(super) directionality: RouteDirectionality,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(super) fallback_location_id: Option<u64>,
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

fn canonical_location_route_component(location_id: u64) -> String {
    content_registry()
        .content_reference("location", location_id)
        .map(|entry| entry.canonical_ref.clone())
        .unwrap_or_else(|| format!("location:{location_id}"))
}

fn canonical_authored_route_id(pack_id: &str, left: u64, right: u64) -> String {
    let (left, right) = ordered_route_endpoints(left, right);
    format!(
        "route://{pack_id}/authored/{}|{}",
        canonical_location_route_component(left),
        canonical_location_route_component(right)
    )
}

fn canonical_one_way_route_id(pack_id: &str, from: u64, to: u64) -> String {
    format!(
        "route://{pack_id}/one-way/{}>{}",
        canonical_location_route_component(from),
        canonical_location_route_component(to)
    )
}

fn canonical_hidden_route_id(pack_id: &str, hidden_exit_id: &str) -> String {
    format!("route://{pack_id}/hidden/{hidden_exit_id}")
}

fn generated_route_id(pathway: &GeneratedPathwayState, left: u64, right: u64) -> Option<String> {
    let mut path = Vec::with_capacity(pathway.waypoints.len() + 2);
    path.push(pathway.origin_location_id);
    path.extend(pathway.waypoints.iter().map(|waypoint| waypoint.id));
    path.push(pathway.destination_location_id);
    let segment = path.windows(2).position(|edge| {
        (edge[0] == left && edge[1] == right) || (edge[0] == right && edge[1] == left)
    })?;
    let pathway_id = if pathway.canonical_id.is_empty() {
        pathway.id.as_str()
    } else {
        pathway.canonical_id.as_str()
    };
    Some(format!("{pathway_id}/route/{segment}"))
}

impl RouteRecordState {
    pub(super) fn contains_edge(&self, from_location_id: u64, to_location_id: u64) -> bool {
        self.edges.iter().any(|edge| {
            edge.from_location_id == from_location_id && edge.to_location_id == to_location_id
        })
    }
}

impl RuntimeWorld {
    pub(super) fn restore_canonical_topology_for_snapshot(
        &mut self,
        snapshot_version: u32,
    ) -> Result<(), String> {
        self.migrate_canonical_topology_for_snapshot(snapshot_version)?;
        if snapshot_version >= 14 {
            self.validate_canonical_route_records()?;
        }
        self.ensure_authored_route_records();
        self.migrate_generated_pathways_for_snapshot(snapshot_version)?;
        self.validate_canonical_route_records()
    }

    pub(super) fn migrate_canonical_topology_for_snapshot(
        &mut self,
        snapshot_version: u32,
    ) -> Result<(), String> {
        let legacy_route_ids = self
            .routes
            .keys()
            .filter(|route_id| {
                route_id.starts_with("route:authored:") || route_id.starts_with("route:hidden:")
            })
            .cloned()
            .collect::<Vec<_>>();
        if snapshot_version >= 14 && !legacy_route_ids.is_empty() {
            return Err("current snapshot contains a legacy authored route identity".to_string());
        }
        for legacy_route_id in legacy_route_ids {
            let mut route = self
                .routes
                .remove(&legacy_route_id)
                .ok_or_else(|| format!("legacy route {legacy_route_id} disappeared"))?;
            let (
                canonical_route_id,
                owner_pack_id,
                provenance,
                directionality,
                fallback_location_id,
            ) = if let Some(hidden_exit_id) = legacy_route_id.strip_prefix("route:hidden:") {
                let hidden = active_content()
                    .hidden_exits
                    .iter()
                    .find(|hidden| hidden.id == hidden_exit_id)
                    .ok_or_else(|| {
                        format!("legacy hidden route {legacy_route_id} has no authored exit")
                    })?;
                let owner_pack_id = if hidden.pack_id.is_empty() {
                    active_content().manifest.id.clone()
                } else {
                    hidden.pack_id.clone()
                };
                (
                    canonical_hidden_route_id(&owner_pack_id, hidden_exit_id),
                    owner_pack_id,
                    hidden.source.clone(),
                    RouteDirectionality::Reciprocal,
                    None,
                )
            } else {
                let edge = route.edges.first().ok_or_else(|| {
                    format!("legacy authored route {legacy_route_id} has no edge")
                })?;
                let exit = active_content()
                    .exits
                    .iter()
                    .find(|exit| {
                        exit.from_location_id == edge.from_location_id
                            && exit.to_location_id == edge.to_location_id
                    })
                    .ok_or_else(|| {
                        format!("legacy authored route {legacy_route_id} has no authored exit")
                    })?;
                let owner_pack_id = if exit.pack_id.is_empty() {
                    active_content().manifest.id.clone()
                } else {
                    exit.pack_id.clone()
                };
                let canonical_route_id = match exit.directionality {
                    RouteDirectionality::Reciprocal => canonical_authored_route_id(
                        &owner_pack_id,
                        exit.from_location_id,
                        exit.to_location_id,
                    ),
                    RouteDirectionality::OneWay => canonical_one_way_route_id(
                        &owner_pack_id,
                        exit.from_location_id,
                        exit.to_location_id,
                    ),
                };
                (
                    canonical_route_id,
                    owner_pack_id,
                    "authored_exit".to_string(),
                    exit.directionality,
                    exit.fallback_location_id,
                )
            };
            if self.routes.contains_key(&canonical_route_id) {
                return Err(format!(
                    "legacy route {legacy_route_id} aliases canonical route {canonical_route_id}"
                ));
            }
            route.id = canonical_route_id.clone();
            route.canonical_id = canonical_route_id.clone();
            route.owner = format!("worldpack:{owner_pack_id}");
            route.owner_pack_version = self.active_pack_version(&owner_pack_id);
            route.owner_pack_id = owner_pack_id;
            route.provenance = provenance;
            route.directionality = directionality;
            route.fallback_location_id = fallback_location_id;
            self.routes.insert(canonical_route_id, route);
        }
        Ok(())
    }

    pub(super) fn migrate_generated_pathways_for_snapshot(
        &mut self,
        snapshot_version: u32,
    ) -> Result<(), String> {
        let pathway_ids = self.generated_pathways.keys().cloned().collect::<Vec<_>>();
        for pathway_id in pathway_ids {
            let mut pathway = self
                .generated_pathways
                .get(&pathway_id)
                .cloned()
                .ok_or_else(|| "generated pathway disappeared during load".to_string())?;
            self.normalize_generated_pathway_identity(&mut pathway, snapshot_version < 13)?;
            self.generated_pathways.insert(pathway_id, pathway);
        }
        self.validate_generated_pathway_identity_claims()?;
        self.validate_journey_topology()?;
        if snapshot_version < 13 {
            for pathway in self
                .generated_pathways
                .values()
                .cloned()
                .collect::<Vec<_>>()
            {
                self.migrate_legacy_generated_route_records(&pathway)?;
            }
            self.routes
                .retain(|route_id, _| !route_id.starts_with("route:generated:"));
        } else if self
            .routes
            .keys()
            .any(|route_id| route_id.starts_with("route:generated:"))
        {
            return Err("current snapshot contains a legacy generated route identity".to_string());
        }
        Ok(())
    }

    pub(super) fn validate_canonical_route_records(&self) -> Result<(), String> {
        let mut expected = BTreeMap::<String, RouteRecordState>::new();
        for exit in &active_content().exits {
            let owner_pack_id = if exit.pack_id.is_empty() {
                active_content().manifest.id.clone()
            } else {
                exit.pack_id.clone()
            };
            let id = match exit.directionality {
                RouteDirectionality::Reciprocal => canonical_authored_route_id(
                    &owner_pack_id,
                    exit.from_location_id,
                    exit.to_location_id,
                ),
                RouteDirectionality::OneWay => canonical_one_way_route_id(
                    &owner_pack_id,
                    exit.from_location_id,
                    exit.to_location_id,
                ),
            };
            let owner_pack_version = self.active_pack_version(&owner_pack_id);
            expected
                .entry(id.clone())
                .or_insert_with(|| RouteRecordState {
                    canonical_id: id.clone(),
                    id,
                    edges: Vec::new(),
                    owner: format!("worldpack:{owner_pack_id}"),
                    owner_pack_id,
                    owner_pack_version,
                    provenance: "authored_exit".to_string(),
                    directionality: exit.directionality,
                    fallback_location_id: exit.fallback_location_id,
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
        for hidden in &active_content().hidden_exits {
            let owner_pack_id = if hidden.pack_id.is_empty() {
                active_content().manifest.id.clone()
            } else {
                hidden.pack_id.clone()
            };
            let id = canonical_hidden_route_id(&owner_pack_id, &hidden.id);
            let record = RouteRecordState {
                canonical_id: id.clone(),
                id: id.clone(),
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
                owner: format!("worldpack:{owner_pack_id}"),
                owner_pack_version: self.active_pack_version(&owner_pack_id),
                owner_pack_id,
                provenance: hidden.source.clone(),
                directionality: RouteDirectionality::Reciprocal,
                fallback_location_id: None,
                lifecycle: RouteLifecycle::Latent,
                discovery: None,
                entity_version: 1,
            };
            if expected.insert(id.clone(), record).is_some() {
                return Err(format!("canonical hidden route {id} aliases another route"));
            }
        }
        for pathway in self.generated_pathways.values() {
            let mut path = Vec::with_capacity(pathway.waypoints.len() + 2);
            path.push(pathway.origin_location_id);
            path.extend(pathway.waypoints.iter().map(|waypoint| waypoint.id));
            path.push(pathway.destination_location_id);
            for edge in path.windows(2) {
                let id = generated_route_id(pathway, edge[0], edge[1]).ok_or_else(|| {
                    format!(
                        "generated pathway {} has an unknown route shape",
                        pathway.id
                    )
                })?;
                let record = RouteRecordState {
                    canonical_id: id.clone(),
                    id: id.clone(),
                    edges: vec![
                        RouteEdgeState {
                            from_location_id: edge[0],
                            to_location_id: edge[1],
                            flags: 0,
                        },
                        RouteEdgeState {
                            from_location_id: edge[1],
                            to_location_id: edge[0],
                            flags: 0,
                        },
                    ],
                    owner: format!("worldpack:{}", pathway.owner_pack_id),
                    owner_pack_id: pathway.owner_pack_id.clone(),
                    owner_pack_version: pathway.owner_pack_version.clone(),
                    provenance: format!("generated_pathway:{}", pathway.id),
                    directionality: RouteDirectionality::Reciprocal,
                    fallback_location_id: None,
                    lifecycle: RouteLifecycle::Latent,
                    discovery: None,
                    entity_version: 1,
                };
                if expected.insert(id.clone(), record).is_some() {
                    return Err(format!(
                        "canonical generated route {id} aliases another route"
                    ));
                }
            }
        }

        for (storage_key, route) in &self.routes {
            if storage_key != &route.id
                || route.canonical_id.is_empty()
                || route.id != route.canonical_id
            {
                return Err(format!(
                    "route {} is not stored under one canonical identity",
                    route.id
                ));
            }
            let Some(expected_route) = expected.get(&route.id) else {
                return Err(format!(
                    "route {} is not a canonical authored, hidden, or generated route",
                    route.id
                ));
            };
            let mut actual_edges = route.edges.clone();
            actual_edges
                .sort_by_key(|edge| (edge.from_location_id, edge.to_location_id, edge.flags));
            let mut expected_edges = expected_route.edges.clone();
            expected_edges
                .sort_by_key(|edge| (edge.from_location_id, edge.to_location_id, edge.flags));
            if actual_edges != expected_edges
                || route.owner != expected_route.owner
                || route.owner_pack_id != expected_route.owner_pack_id
                || route.owner_pack_version != expected_route.owner_pack_version
                || route.provenance != expected_route.provenance
                || route.directionality != expected_route.directionality
                || route.fallback_location_id != expected_route.fallback_location_id
            {
                return Err(format!(
                    "route {} does not match its canonical owner, provenance, endpoints, or directionality",
                    route.id
                ));
            }
        }
        Ok(())
    }

    pub(super) fn pathway_for_anchors(
        &self,
        from_location_id: u64,
        to_location_id: u64,
    ) -> Option<&GeneratedPathwayState> {
        let (origin_location_id, destination_location_id) =
            canonical_pathway_anchors(from_location_id, to_location_id);
        self.generated_pathways.values().find(|pathway| {
            pathway.origin_location_id == origin_location_id
                && pathway.destination_location_id == destination_location_id
        })
    }

    pub(super) fn generated_pathway_for_location(
        &self,
        location_id: u64,
    ) -> Option<&GeneratedPathwayState> {
        self.generated_pathways.values().find(|pathway| {
            pathway
                .waypoints
                .iter()
                .any(|waypoint| waypoint.id == location_id)
        })
    }

    pub(super) fn normalize_generated_pathway_identity(
        &self,
        pathway: &mut GeneratedPathwayState,
        allow_legacy_backfill: bool,
    ) -> Result<(), String> {
        if pathway.origin_location_id == pathway.destination_location_id
            || !(2..=8).contains(&pathway.distance)
            || pathway.waypoints.len() != usize::from(pathway.distance.saturating_sub(1))
        {
            return Err(format!(
                "generated pathway {} has invalid distance or waypoint bounds",
                pathway.id
            ));
        }
        let mut declared_path = Vec::with_capacity(pathway.waypoints.len() + 2);
        declared_path.push(pathway.origin_location_id);
        declared_path.extend(pathway.waypoints.iter().map(|waypoint| waypoint.id));
        declared_path.push(pathway.destination_location_id);
        if pathway.revealed_edges.iter().any(|edge| {
            parse_pathway_edge_key(edge).is_none_or(|(left, right)| {
                !declared_path.windows(2).any(|segment| {
                    (segment[0] == left && segment[1] == right)
                        || (segment[0] == right && segment[1] == left)
                })
            })
        }) {
            return Err(format!(
                "generated pathway {} reveals an edge outside its waypoint bounds",
                pathway.id
            ));
        }
        if pathway.identity_version > 1 {
            return Err(format!(
                "generated pathway {} has an unsupported identity version",
                pathway.id
            ));
        }
        let identity_is_incomplete = pathway.canonical_id.is_empty()
            || pathway.source_route_id.is_empty()
            || pathway.source_route_version == 0
            || pathway.owner_pack_id.is_empty()
            || pathway.owner_pack_version.is_empty()
            || pathway
                .waypoints
                .iter()
                .any(|waypoint| waypoint.canonical_id.is_empty());
        if pathway.identity_version == 0 {
            let is_unversioned_shape = pathway.canonical_id.is_empty()
                && pathway.source_route_id.is_empty()
                && pathway.source_route_version == 0
                && pathway.owner_pack_id.is_empty()
                && pathway.owner_pack_version.is_empty()
                && pathway
                    .waypoints
                    .iter()
                    .all(|waypoint| waypoint.canonical_id.is_empty());
            if identity_is_incomplete && (!allow_legacy_backfill || !is_unversioned_shape) {
                return Err(format!(
                    "generated pathway {} has incomplete current identity metadata",
                    pathway.id
                ));
            }
        } else if identity_is_incomplete {
            return Err(format!(
                "generated pathway {} has incomplete current identity metadata",
                pathway.id
            ));
        }

        let source_route = self
            .routes
            .values()
            .find(|route| {
                route.provenance == "authored_exit"
                    && route
                        .contains_edge(pathway.origin_location_id, pathway.destination_location_id)
            })
            .ok_or_else(|| {
                format!(
                    "generated pathway {} has no canonical authored source route",
                    pathway.id
                )
            })?;
        if source_route.canonical_id.is_empty()
            || source_route.owner_pack_id.is_empty()
            || source_route.owner_pack_version.is_empty()
        {
            return Err(format!(
                "generated pathway {} source route has incomplete ownership",
                pathway.id
            ));
        }
        if pathway.source_route_id.is_empty() {
            pathway.source_route_id = source_route.canonical_id.clone();
        } else if pathway.source_route_id != source_route.canonical_id {
            return Err(format!(
                "generated pathway {} source route identity changed",
                pathway.id
            ));
        }
        if pathway.source_route_version == 0 {
            pathway.source_route_version = source_route.entity_version;
        } else if pathway.source_route_version > source_route.entity_version {
            return Err(format!(
                "generated pathway {} references a future source route version",
                pathway.id
            ));
        }
        if pathway.owner_pack_id.is_empty() {
            pathway.owner_pack_id = source_route.owner_pack_id.clone();
        } else if pathway.owner_pack_id != source_route.owner_pack_id {
            return Err(format!(
                "generated pathway {} owner pack changed",
                pathway.id
            ));
        }
        if pathway.owner_pack_version.is_empty() {
            pathway.owner_pack_version = source_route.owner_pack_version.clone();
        } else if pathway.owner_pack_version != source_route.owner_pack_version {
            return Err(format!(
                "generated pathway {} owner pack version changed",
                pathway.id
            ));
        }
        let expected_pathway_id = format!(
            "generated-pathway:{}@{}",
            pathway.source_route_id, pathway.source_route_version
        );
        if pathway.canonical_id.is_empty() {
            pathway.canonical_id = expected_pathway_id.clone();
        } else if pathway.canonical_id != expected_pathway_id {
            return Err(format!(
                "generated pathway {} canonical identity changed",
                pathway.id
            ));
        }
        if pathway.identity_version == 1 && pathway.id != pathway.canonical_id {
            return Err(format!(
                "generated pathway {} does not use its canonical identity",
                pathway.id
            ));
        }

        let mut local_handles = BTreeSet::new();
        for (index, waypoint) in pathway.waypoints.iter_mut().enumerate() {
            let expected_canonical_id =
                generated_waypoint_canonical_id(&pathway.canonical_id, index);
            if waypoint.canonical_id.is_empty() {
                waypoint.canonical_id = expected_canonical_id.clone();
            } else if waypoint.canonical_id != expected_canonical_id {
                return Err(format!(
                    "generated waypoint {} canonical identity changed",
                    waypoint.id
                ));
            }
            if pathway.identity_version == 1
                && waypoint.id != generated_pathway_location_id(&waypoint.canonical_id)
            {
                return Err(format!(
                    "generated waypoint {} does not match its canonical identity",
                    waypoint.id
                ));
            }
            if !local_handles.insert(waypoint.id) {
                return Err(format!(
                    "generated pathway {} aliases waypoint handle {}",
                    pathway.id, waypoint.id
                ));
            }
            if self
                .canonical_identities
                .location_refs
                .get(&waypoint.id)
                .is_some_and(|canonical_id| canonical_id != &waypoint.canonical_id)
            {
                return Err(format!(
                    "generated waypoint {} collides with another canonical location",
                    waypoint.id
                ));
            }
            if active_content()
                .locations
                .iter()
                .any(|location| location.id == waypoint.id)
            {
                return Err(format!(
                    "generated waypoint {} collides with an authored location",
                    waypoint.id
                ));
            }
            let existing_claim = self.generated_pathways.values().find_map(|existing| {
                existing
                    .waypoints
                    .iter()
                    .find(|candidate| candidate.id == waypoint.id)
                    .map(|candidate| (existing.id.as_str(), candidate.canonical_id.as_str()))
            });
            if let Some((existing_pathway_id, existing_canonical_id)) = existing_claim {
                let same_pathway = existing_pathway_id == pathway.id;
                let same_identity = !existing_canonical_id.is_empty()
                    && existing_canonical_id == waypoint.canonical_id;
                if !same_pathway && !same_identity {
                    return Err(format!(
                        "generated waypoint {} collides with pathway {}",
                        waypoint.id, existing_pathway_id
                    ));
                }
            } else if self.world.locations[..self.world.location_count]
                .iter()
                .any(|location| location.id == waypoint.id)
            {
                return Err(format!(
                    "generated waypoint {} collides with an unowned runtime location",
                    waypoint.id
                ));
            }
        }
        Ok(())
    }

    fn validate_journey_topology(&self) -> Result<(), String> {
        for (actor_id, journey) in &self.journeys {
            if actor_id != &journey.actor_id || journey.current_step >= journey.path.len() {
                return Err(format!("journey for actor {actor_id} has invalid bounds"));
            }
            let pathway = self
                .generated_pathways
                .get(&journey.pathway_id)
                .ok_or_else(|| format!("journey for actor {actor_id} has no canonical pathway"))?;
            let mut expected = Vec::with_capacity(pathway.waypoints.len() + 2);
            expected.push(pathway.origin_location_id);
            expected.extend(pathway.waypoints.iter().map(|waypoint| waypoint.id));
            expected.push(pathway.destination_location_id);
            let reverse = expected.iter().copied().rev().collect::<Vec<_>>();
            if journey.path != expected && journey.path != reverse {
                return Err(format!(
                    "journey for actor {actor_id} escapes its canonical pathway"
                ));
            }
            if journey.path.first().copied() != Some(journey.origin_location_id)
                || journey.path.last().copied() != Some(journey.destination_location_id)
            {
                return Err(format!(
                    "journey for actor {actor_id} has inconsistent endpoints"
                ));
            }
        }
        Ok(())
    }

    pub(super) fn validate_generated_pathway_identity_claims(&self) -> Result<(), String> {
        let mut pathway_claims = BTreeSet::new();
        let mut waypoint_identity_claims = BTreeSet::new();
        let mut waypoint_handle_claims = BTreeSet::new();
        for (storage_key, pathway) in &self.generated_pathways {
            if storage_key != &pathway.id {
                return Err(format!(
                    "generated pathway storage key {} aliases {}",
                    storage_key, pathway.id
                ));
            }
            if !pathway_claims.insert(pathway.canonical_id.as_str()) {
                return Err(format!(
                    "generated pathway {} aliases canonical pathway {}",
                    pathway.id, pathway.canonical_id
                ));
            }
            for waypoint in &pathway.waypoints {
                if !waypoint_identity_claims.insert(waypoint.canonical_id.as_str()) {
                    return Err(format!(
                        "generated pathway {} aliases canonical waypoint {}",
                        pathway.id, waypoint.canonical_id
                    ));
                }
                if !waypoint_handle_claims.insert(waypoint.id) {
                    return Err(format!(
                        "generated pathway {} aliases waypoint handle {}",
                        pathway.id, waypoint.id
                    ));
                }
            }
        }
        Ok(())
    }

    pub(super) fn migrate_legacy_generated_route_records(
        &mut self,
        pathway: &GeneratedPathwayState,
    ) -> Result<(), String> {
        let provenance = format!("generated_pathway:{}", pathway.id);
        let legacy_route_ids = self
            .routes
            .iter()
            .filter(|(route_id, route)| {
                route_id.starts_with("route:generated:") && route.provenance == provenance
            })
            .map(|(route_id, _)| route_id.clone())
            .collect::<Vec<_>>();
        let mut path = Vec::with_capacity(pathway.waypoints.len() + 2);
        path.push(pathway.origin_location_id);
        path.extend(pathway.waypoints.iter().map(|waypoint| waypoint.id));
        path.push(pathway.destination_location_id);
        let mut migrations = Vec::new();
        let mut canonical_route_claims = BTreeSet::new();
        for legacy_route_id in legacy_route_ids {
            let route = self
                .routes
                .get(&legacy_route_id)
                .expect("collected legacy route remains present");
            let matching_segments = path
                .windows(2)
                .filter(|edge| {
                    route.contains_edge(edge[0], edge[1]) && route.contains_edge(edge[1], edge[0])
                })
                .collect::<Vec<_>>();
            if matching_segments.len() != 1 {
                return Err(format!(
                    "legacy generated route {} does not identify one pathway segment",
                    legacy_route_id
                ));
            }
            let edge = matching_segments[0];
            let canonical_route_id = generated_route_id(pathway, edge[0], edge[1])
                .ok_or_else(|| format!("cannot canonicalize route {legacy_route_id}"))?;
            if legacy_route_id != canonical_route_id
                && self.routes.contains_key(&canonical_route_id)
            {
                return Err(format!(
                    "legacy generated route {} aliases canonical route {}",
                    legacy_route_id, canonical_route_id
                ));
            }
            if !canonical_route_claims.insert(canonical_route_id.clone()) {
                return Err(format!(
                    "legacy generated route {} aliases canonical route {}",
                    legacy_route_id, canonical_route_id
                ));
            }
            migrations.push((legacy_route_id, canonical_route_id));
        }
        for (legacy_route_id, canonical_route_id) in migrations {
            let mut route = self
                .routes
                .remove(&legacy_route_id)
                .expect("validated legacy route remains present");
            route.id = canonical_route_id.clone();
            route.canonical_id = canonical_route_id.clone();
            route.owner = format!("worldpack:{}", pathway.owner_pack_id);
            route.owner_pack_id = pathway.owner_pack_id.clone();
            route.owner_pack_version = pathway.owner_pack_version.clone();
            self.routes.insert(canonical_route_id, route);
        }
        Ok(())
    }

    fn generated_pathway_identity_is_compatible(
        &self,
        pathway: &GeneratedPathwayState,
        allow_legacy_backfill: bool,
    ) -> bool {
        let mut normalized = pathway.clone();
        self.normalize_generated_pathway_identity(&mut normalized, allow_legacy_backfill)
            .is_ok()
    }

    pub(super) fn generated_pathway(
        &self,
        actor_id: u64,
        from_location_id: u64,
        to_location_id: u64,
        distance: u8,
    ) -> Result<GeneratedPathwayState, String> {
        let (origin_location_id, destination_location_id) =
            canonical_pathway_anchors(from_location_id, to_location_id);
        let source_route = self
            .routes
            .values()
            .find(|route| {
                route.provenance == "authored_exit"
                    && route.contains_edge(origin_location_id, destination_location_id)
            })
            .ok_or_else(|| {
                format!(
                    "no canonical authored route owns {origin_location_id}->{destination_location_id}"
                )
            })?;
        if source_route.canonical_id.is_empty()
            || source_route.owner_pack_id.is_empty()
            || source_route.owner_pack_version.is_empty()
        {
            return Err("the canonical route has incomplete ownership metadata".to_string());
        }
        let origin_name = self
            .location_name(origin_location_id)
            .unwrap_or_else(|| "one known place".to_string());
        let destination_name = self
            .location_name(destination_location_id)
            .unwrap_or_else(|| "another known place".to_string());
        let origin_meta = self.location_meta_for(origin_location_id);
        let destination_meta = self.location_meta_for(destination_location_id);
        let pathway_id = generated_pathway_canonical_id(source_route);
        let seed = stable_pathway_hash(&pathway_id);
        let waypoint_count = usize::from(distance.saturating_sub(1));
        let names = [
            "Lantern Bend",
            "Mossy Verge",
            "Rain-Silver Crossing",
            "Foxglove Turn",
            "Quiet Rise",
            "Bramble Mile",
        ];
        let waypoints = (0..waypoint_count)
            .map(|index| {
                let landmark_name = names[(seed as usize + index) % names.len()].to_string();
                let canonical_id = generated_waypoint_canonical_id(&pathway_id, index);
                let id = generated_pathway_location_id(&canonical_id);
                let art_prompt = format!(
                    "cozy storybook landscape, {landmark_name}, a hidden waypoint along a newly explored pathway between {origin_name} and {destination_name}, stretch {step} of {distance}, {origin_biome} terrain meeting {destination_biome} terrain, {origin} meeting {destination}, no people, no characters, no creatures, no text, no logo, no watermark",
                    step = index + 1,
                    origin_biome = origin_meta.biome,
                    destination_biome = destination_meta.biome,
                    origin = origin_meta.description,
                    destination = destination_meta.description,
                );
                let terrain = interpolated_pathway_terrain(
                    &origin_meta,
                    &destination_meta,
                    index,
                    waypoint_count,
                );
                let environment = interpolated_environment_profile(
                    &origin_meta.environment,
                    &destination_meta.environment,
                    index,
                    waypoint_count,
                );
                let natural_potentials = generated_potential_rules(&environment);
                let terrain_phrase = terrain
                    .iter()
                    .take(3)
                    .cloned()
                    .collect::<Vec<_>>()
                    .join(", ");
                let description = format!(
                    "At {landmark_name}, {terrain_phrase} mark a half-known stretch between {origin_name} and {destination_name}; weather and footprints are still deciding what belongs."
                );
                GeneratedWaypointState {
                    id,
                    canonical_id,
                    name: landmark_name.clone(),
                    meta: LocationMeta {
                        title: "Newly Found Path".to_string(),
                        description,
                        persona: format!(
                            "{landmark_name} is unfinished geography: alert, changeable, and eager to become familiar through footsteps."
                        ),
                        memory: vec![format!(
                            "An Explorer first drew this path between {origin_name} and {destination_name}."
                        )],
                        biome: format!("{} to {}", origin_meta.biome, destination_meta.biome),
                        terrain,
                        environment,
                        natural_potentials,
                        image_url: Some(format!("/assets/generated/pathways/{id}.svg")),
                        art_prompt: Some(art_prompt),
                    },
                }
            })
            .collect();
        let pathway = GeneratedPathwayState {
            id: pathway_id.clone(),
            identity_version: 1,
            canonical_id: pathway_id,
            source_route_id: source_route.canonical_id.clone(),
            source_route_version: source_route.entity_version,
            owner_pack_id: source_route.owner_pack_id.clone(),
            owner_pack_version: source_route.owner_pack_version.clone(),
            origin_location_id,
            destination_location_id,
            distance,
            created_by_actor_id: actor_id,
            waypoints,
            generation: GenerationProvenance {
                source: "deterministic_fallback".to_string(),
                feature: PATHWAY_CONTENT_FEATURE.to_string(),
                policy_mode: "fallback".to_string(),
                prompt_version: PATHWAY_CONTENT_PROMPT_VERSION.to_string(),
                provider: "none".to_string(),
                model: "none".to_string(),
                attempts: 0,
            },
            revealed_edges: BTreeSet::new(),
            art_eligible: distance >= 2,
            familiar: false,
        };
        if !self.generated_pathway_identity_is_compatible(&pathway, false) {
            return Err("generated pathway identity or numeric handle collides".to_string());
        }
        Ok(pathway)
    }

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
        let metadata_backfill = current.canonical_id.is_empty()
            && current.owner_pack_id.is_empty()
            && current.owner_pack_version.is_empty();
        let structure_changed = current.edges != proposed.edges
            || current.canonical_id != proposed.canonical_id
            || current.owner != proposed.owner
            || current.owner_pack_id != proposed.owner_pack_id
            || current.owner_pack_version != proposed.owner_pack_version
            || current.provenance != proposed.provenance
            || current.directionality != proposed.directionality
            || current.fallback_location_id != proposed.fallback_location_id;
        if structure_changed {
            current.edges = proposed.edges;
            current.canonical_id = proposed.canonical_id;
            current.owner = proposed.owner;
            current.owner_pack_id = proposed.owner_pack_id;
            current.owner_pack_version = proposed.owner_pack_version;
            current.provenance = proposed.provenance;
            current.directionality = proposed.directionality;
            current.fallback_location_id = proposed.fallback_location_id;
            if !metadata_backfill {
                current.entity_version = current.entity_version.saturating_add(1).max(1);
            }
        }
    }

    pub(super) fn ensure_authored_route_records(&mut self) {
        let mut records = BTreeMap::<String, RouteRecordState>::new();
        for exit in &active_content().exits {
            let owner_pack_id = if exit.pack_id.is_empty() {
                active_content().manifest.id.clone()
            } else {
                exit.pack_id.clone()
            };
            let id = match exit.directionality {
                RouteDirectionality::Reciprocal => canonical_authored_route_id(
                    &owner_pack_id,
                    exit.from_location_id,
                    exit.to_location_id,
                ),
                RouteDirectionality::OneWay => canonical_one_way_route_id(
                    &owner_pack_id,
                    exit.from_location_id,
                    exit.to_location_id,
                ),
            };
            let owner_pack_version = self.active_pack_version(&owner_pack_id);
            records
                .entry(id.clone())
                .or_insert_with(|| RouteRecordState {
                    canonical_id: id.clone(),
                    id,
                    edges: Vec::new(),
                    owner: format!("worldpack:{owner_pack_id}"),
                    owner_pack_id,
                    owner_pack_version,
                    provenance: "authored_exit".to_string(),
                    directionality: exit.directionality,
                    fallback_location_id: exit.fallback_location_id,
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
            let owner_pack_id = if hidden.pack_id.is_empty() {
                active_content().manifest.id.clone()
            } else {
                hidden.pack_id.clone()
            };
            let owner_pack_version = self.active_pack_version(&owner_pack_id);
            let id = canonical_hidden_route_id(&owner_pack_id, &hidden.id);
            self.reconcile_route_record(RouteRecordState {
                canonical_id: id.clone(),
                id,
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
                owner: format!("worldpack:{owner_pack_id}"),
                owner_pack_id,
                owner_pack_version,
                provenance: hidden.source.clone(),
                directionality: RouteDirectionality::Reciprocal,
                fallback_location_id: None,
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
            let Some(id) = generated_route_id(pathway, from_location_id, to_location_id) else {
                continue;
            };
            self.reconcile_route_record(RouteRecordState {
                canonical_id: id.clone(),
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
                owner: format!("worldpack:{}", pathway.owner_pack_id),
                owner_pack_id: pathway.owner_pack_id.clone(),
                owner_pack_version: pathway.owner_pack_version.clone(),
                provenance: format!("generated_pathway:{}", pathway.id),
                directionality: RouteDirectionality::Reciprocal,
                fallback_location_id: None,
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
            let owner_pack_id = if exit.pack_id.is_empty() {
                active_content().manifest.id.as_str()
            } else {
                exit.pack_id.as_str()
            };
            let route_id = match exit.directionality {
                RouteDirectionality::Reciprocal => canonical_authored_route_id(
                    owner_pack_id,
                    exit.from_location_id,
                    exit.to_location_id,
                ),
                RouteDirectionality::OneWay => canonical_one_way_route_id(
                    owner_pack_id,
                    exit.from_location_id,
                    exit.to_location_id,
                ),
            };
            discoveries
                .entry(route_id)
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
            let owner_pack_id = if hidden_exit.pack_id.is_empty() {
                active_content().manifest.id.as_str()
            } else {
                hidden_exit.pack_id.as_str()
            };
            discoveries
                .entry(canonical_hidden_route_id(owner_pack_id, &hidden_exit.id))
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

    fn route_for_hidden_exit(&self, hidden_exit_id: &str) -> Option<&RouteRecordState> {
        active_content()
            .hidden_exits
            .iter()
            .find(|hidden| hidden.id == hidden_exit_id)
            .and_then(|hidden| {
                let owner_pack_id = if hidden.pack_id.is_empty() {
                    active_content().manifest.id.as_str()
                } else {
                    hidden.pack_id.as_str()
                };
                self.routes
                    .get(&canonical_hidden_route_id(owner_pack_id, hidden_exit_id))
            })
    }

    fn route_for_persisted_id(&self, route_id: &str) -> Option<&RouteRecordState> {
        if let Some(route) = self.routes.get(route_id) {
            return Some(route);
        }
        if let Some(hidden_exit_id) = route_id.strip_prefix("route:hidden:") {
            return self.route_for_hidden_exit(hidden_exit_id);
        }
        if let Some(endpoints) = route_id.strip_prefix("route:authored:") {
            let mut parts = endpoints.split(':');
            let left = parts.next()?.parse::<u64>().ok()?;
            let right = parts.next()?.parse::<u64>().ok()?;
            if parts.next().is_some() {
                return None;
            }
            return self.routes.values().find(|route| {
                route.provenance == "authored_exit"
                    && (route.contains_edge(left, right) || route.contains_edge(right, left))
            });
        }
        if route_id.starts_with("route:generated:") {
            let mut parts = route_id.rsplit(':');
            let right = parts.next()?.parse::<u64>().ok()?;
            let left = parts.next()?.parse::<u64>().ok()?;
            return self.routes.values().find(|route| {
                route.provenance.starts_with("generated_pathway:")
                    && route.contains_edge(left, right)
                    && route.contains_edge(right, left)
            });
        }
        None
    }

    fn binding_for_route(route: &RouteRecordState) -> RouteOfferBinding {
        RouteOfferBinding {
            route_id: route.id.clone(),
            route_version: route.entity_version,
            directionality: route.directionality,
            fallback_location_id: route.fallback_location_id,
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
        self.route_for_persisted_id(&binding.route_id)
            .is_some_and(|route| route.entity_version == binding.route_version)
    }

    pub(super) fn transition_route(
        &mut self,
        route_id: &str,
        expected_version: u64,
        lifecycle: RouteLifecycle,
    ) -> bool {
        let Some(canonical_route_id) = self
            .route_for_persisted_id(route_id)
            .map(|route| route.id.clone())
        else {
            return false;
        };
        let Some(route) = self.routes.get_mut(&canonical_route_id) else {
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
            .route_for_persisted_id(route_id)
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
        let Some(hidden) = active_content()
            .hidden_exits
            .iter()
            .find(|hidden| hidden.id == hidden_exit_id)
        else {
            return;
        };
        let owner_pack_id = if hidden.pack_id.is_empty() {
            active_content().manifest.id.as_str()
        } else {
            hidden.pack_id.as_str()
        };
        let route_id = canonical_hidden_route_id(owner_pack_id, hidden_exit_id);
        let Some(route) = self.routes.get(&route_id) else {
            return;
        };
        if route.lifecycle != RouteLifecycle::Latent {
            return;
        }
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
        let Some(route_id) = generated_route_id(pathway, from_location_id, to_location_id) else {
            return;
        };
        let Some(route) = self.routes.get(&route_id) else {
            return;
        };
        if route.lifecycle != RouteLifecycle::Latent {
            return;
        }
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
        if !record
            .projection_mutations
            .iter()
            .all(|mutation| match mutation {
                ProjectionMutation::JourneyTransition { pathway, .. }
                | ProjectionMutation::RefinePathway { pathway } => self
                    .generated_pathway_identity_is_compatible(
                        pathway,
                        record.version < JOURNAL_RECORD_VERSION,
                    ),
                _ => true,
            })
        {
            return false;
        }
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
            self.route_for_persisted_id(&transition.route_id)
                .is_some_and(|route| {
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
                        .route_for_hidden_exit(hidden_exit_id)
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

    fn legacy_pathway(
        runtime: &RuntimeWorld,
        origin_location_id: u64,
        destination_location_id: u64,
        distance: u8,
        legacy_id: &str,
    ) -> GeneratedPathwayState {
        let mut pathway = runtime
            .generated_pathway(
                RATI_ACTOR_ID,
                origin_location_id,
                destination_location_id,
                distance,
            )
            .expect("canonical source route");
        pathway.id = legacy_id.to_string();
        pathway.identity_version = 0;
        pathway.canonical_id.clear();
        pathway.source_route_id.clear();
        pathway.source_route_version = 0;
        pathway.owner_pack_id.clear();
        pathway.owner_pack_version.clear();
        for (index, waypoint) in pathway.waypoints.iter_mut().enumerate() {
            waypoint.id = GENERATED_PATHWAY_LOCATION_ID_BASE
                + (stable_pathway_hash(legacy_id) % 10_000) * 16
                + index as u64;
            waypoint.canonical_id.clear();
        }
        pathway.revealed_edges.clear();
        pathway
    }

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

    #[test]
    fn generated_waypoint_allocation_is_mount_order_stable_and_collision_safe() {
        let mut first_order = RuntimeWorld::seeded();
        let core_pathway = first_order
            .generated_pathway(RATI_ACTOR_ID, 3, 50, 3)
            .expect("Core owns its long route");
        first_order
            .generated_pathways
            .insert(core_pathway.id.clone(), core_pathway.clone());
        let bridge_pathway = first_order
            .generated_pathway(RATI_ACTOR_ID, 12, 50, 3)
            .expect("the composition bridge owns its long route");

        let mut reverse_order = RuntimeWorld::seeded();
        let bridge_first = reverse_order
            .generated_pathway(RATI_ACTOR_ID, 12, 50, 3)
            .expect("the bridge route allocates first");
        reverse_order
            .generated_pathways
            .insert(bridge_first.id.clone(), bridge_first.clone());
        let core_second = reverse_order
            .generated_pathway(RATI_ACTOR_ID, 3, 50, 3)
            .expect("the Core route allocates second");

        assert_eq!(core_pathway.id, core_second.id);
        assert_eq!(core_pathway.canonical_id, core_second.canonical_id);
        assert_eq!(
            core_pathway
                .waypoints
                .iter()
                .map(|waypoint| (waypoint.id, waypoint.canonical_id.clone()))
                .collect::<Vec<_>>(),
            core_second
                .waypoints
                .iter()
                .map(|waypoint| (waypoint.id, waypoint.canonical_id.clone()))
                .collect::<Vec<_>>()
        );
        assert_eq!(bridge_pathway.id, bridge_first.id);
        assert_eq!(
            bridge_pathway
                .waypoints
                .iter()
                .map(|waypoint| (waypoint.id, waypoint.canonical_id.clone()))
                .collect::<Vec<_>>(),
            bridge_first
                .waypoints
                .iter()
                .map(|waypoint| (waypoint.id, waypoint.canonical_id.clone()))
                .collect::<Vec<_>>()
        );

        let mut collision_runtime = RuntimeWorld::seeded();
        let target = collision_runtime
            .generated_pathway(RATI_ACTOR_ID, 12, 50, 3)
            .expect("target pathway");
        let mut blocker = collision_runtime
            .generated_pathway(RATI_ACTOR_ID, 3, 50, 3)
            .expect("blocker pathway");
        blocker.waypoints[0].id = target.waypoints[0].id;
        collision_runtime
            .generated_pathways
            .insert(blocker.id.clone(), blocker);
        assert!(collision_runtime
            .generated_pathway(RATI_ACTOR_ID, 12, 50, 3)
            .is_err());
        assert!(!collision_runtime
            .generated_pathways
            .contains_key(&target.id));

        let mut canonical_collision = RuntimeWorld::seeded();
        canonical_collision
            .canonical_identities
            .location_refs
            .insert(
                target.waypoints[0].id,
                "opaque://another-location".to_string(),
            );
        assert!(canonical_collision
            .generated_pathway(RATI_ACTOR_ID, 12, 50, 3)
            .is_err());
    }

    #[test]
    fn cross_pack_generated_subgraph_keeps_composition_ownership() {
        let mut runtime = RuntimeWorld::seeded();
        let pathway = runtime
            .generated_pathway(RATI_ACTOR_ID, 12, 50, 3)
            .expect("cross-pack long route");
        assert_eq!(pathway.owner_pack_id, "cosyworld.composition.core-ruby");
        assert_eq!(pathway.owner_pack_version, "1.0.0");
        assert!(pathway
            .source_route_id
            .starts_with("route://cosyworld.composition.core-ruby/"));
        runtime.ensure_generated_pathway_route_records(&pathway);
        let generated_routes = runtime
            .routes
            .values()
            .filter(|route| route.provenance == format!("generated_pathway:{}", pathway.id))
            .collect::<Vec<_>>();
        assert_eq!(generated_routes.len(), 3);
        assert!(generated_routes.iter().all(|route| {
            route.owner_pack_id == "cosyworld.composition.core-ruby"
                && route.owner == "worldpack:cosyworld.composition.core-ruby"
        }));

        let waypoint_id = pathway.waypoints[0].id;
        runtime.ensure_generated_pathway_edge(&pathway, 12, waypoint_id);
        let place = runtime
            .generated_places
            .get(&waypoint_id)
            .expect("generated waypoint has a place projection");
        assert_eq!(place.canonical_id, pathway.waypoints[0].canonical_id);
        assert_eq!(place.pack_id, "cosyworld.composition.core-ruby");
        for job_id in [
            &place.anchor_job_id,
            &place.connection_job_id,
            &place.settlement_job_id,
        ] {
            assert_eq!(
                runtime.jobs[job_id].pack_id,
                "cosyworld.composition.core-ruby"
            );
        }
        if let Some(natural) = runtime.natural_affordances.get(&waypoint_id) {
            assert_eq!(
                natural.generation.pack_id,
                "cosyworld.composition.core-ruby"
            );
        }
    }

    #[test]
    fn generated_identity_and_ownership_replay_byte_stably() {
        let source = RuntimeWorld::seeded();
        let pathway = source
            .generated_pathway(RATI_ACTOR_ID, 12, 50, 3)
            .expect("cross-pack long route");
        let first_waypoint_id = pathway.waypoints[0].id;
        let record = JournalRecord {
            projection_mutations: vec![ProjectionMutation::JourneyTransition {
                pathway: pathway.clone(),
                journey: None,
                reveal_edges: vec![(12, first_waypoint_id)],
                narration: "A stable bridge path appears.".to_string(),
                event_type: "pathway.discovered".to_string(),
            }],
            ..JournalRecord::new(
                CwAction {
                    kind: CW_ACTION_NONE,
                    actor_id: RATI_ACTOR_ID,
                    ..CwAction::default()
                },
                318_001,
            )
        };
        let replay_record: JournalRecord = serde_json::from_slice(
            &serde_json::to_vec(&record).expect("serialize canonical pathway record"),
        )
        .expect("deserialize canonical pathway record");

        let mut committed = RuntimeWorld::seeded();
        let mut replayed = RuntimeWorld::seeded();
        assert_eq!(committed.apply_journal_record(&record).0, CW_OK);
        assert_eq!(replayed.apply_journal_record(&replay_record).0, CW_OK);
        let generated_subgraph_bytes = |runtime: &RuntimeWorld| {
            let routes = runtime
                .routes
                .iter()
                .filter(|(_, route)| route.provenance.starts_with("generated_pathway:"))
                .map(|(id, route)| (id.clone(), route.clone()))
                .collect::<BTreeMap<_, _>>();
            serde_json::to_vec(&(
                runtime.generated_pathways.clone(),
                runtime.generated_places.clone(),
                routes,
            ))
            .expect("serialize generated subgraph")
        };
        let committed_bytes = generated_subgraph_bytes(&committed);
        let replayed_bytes = generated_subgraph_bytes(&replayed);
        assert_eq!(replayed_bytes, committed_bytes);

        let restarted = RuntimeSnapshot::from_runtime(&committed)
            .into_runtime()
            .expect("restart generated subgraph");
        assert_eq!(generated_subgraph_bytes(&restarted), committed_bytes);
    }

    #[test]
    fn legacy_generated_routes_migrate_without_losing_lifecycle_or_discovery() {
        let seed = RuntimeWorld::seeded();
        let legacy_id = "pathway:12:50";
        let pathway = legacy_pathway(&seed, 12, 50, 3, legacy_id);
        let first_waypoint_id = pathway.waypoints[0].id;
        let mut legacy_record = JournalRecord {
            version: JOURNAL_RECORD_VERSION - 1,
            projection_mutations: vec![ProjectionMutation::JourneyTransition {
                pathway,
                journey: None,
                reveal_edges: vec![(12, first_waypoint_id)],
                narration: "A legacy bridge path appears.".to_string(),
                event_type: "pathway.discovered".to_string(),
            }],
            ..JournalRecord::new(
                CwAction {
                    kind: CW_ACTION_NONE,
                    actor_id: RATI_ACTOR_ID,
                    ..CwAction::default()
                },
                318_002,
            )
        };

        let mut current_replay = RuntimeWorld::seeded();
        legacy_record.version = JOURNAL_RECORD_VERSION;
        assert_eq!(
            current_replay.apply_journal_record(&legacy_record).0,
            CW_ERR_RULE
        );
        assert!(current_replay.generated_pathways.is_empty());

        legacy_record.version = JOURNAL_RECORD_VERSION - 1;
        let mut replayed = RuntimeWorld::seeded();
        assert_eq!(replayed.apply_journal_record(&legacy_record).0, CW_OK);
        let generated_route_id = replayed
            .routes
            .iter()
            .find(|(_, route)| route.provenance == format!("generated_pathway:{legacy_id}"))
            .map(|(route_id, _)| route_id.clone())
            .expect("legacy replay creates a canonical generated route");
        let preserved_discovery = RouteDiscoveryState {
            actor_id: RATI_ACTOR_ID,
            event_seq: 318,
            reason: "legacy_fixture".to_string(),
        };
        {
            let route = replayed
                .routes
                .get_mut(&generated_route_id)
                .expect("generated route remains present");
            route.lifecycle = RouteLifecycle::Blocked;
            route.discovery = Some(preserved_discovery.clone());
            route.entity_version = 7;
        }

        let expected_pathways = replayed.generated_pathways.clone();
        let expected_routes = replayed
            .routes
            .iter()
            .filter(|(_, route)| route.provenance == format!("generated_pathway:{legacy_id}"))
            .map(|(route_id, route)| (route_id.clone(), route.clone()))
            .collect::<BTreeMap<_, _>>();
        let mut snapshot = RuntimeSnapshot::from_runtime(&replayed);
        snapshot.version = 12;
        let snapshot_pathway = snapshot
            .generated_pathways
            .get_mut(legacy_id)
            .expect("legacy pathway is persisted");
        snapshot_pathway.canonical_id.clear();
        snapshot_pathway.source_route_id.clear();
        snapshot_pathway.source_route_version = 0;
        snapshot_pathway.owner_pack_id.clear();
        snapshot_pathway.owner_pack_version.clear();
        for waypoint in &mut snapshot_pathway.waypoints {
            waypoint.canonical_id.clear();
        }
        let canonical_route_ids = snapshot
            .routes
            .iter()
            .filter(|(_, route)| route.provenance == format!("generated_pathway:{legacy_id}"))
            .map(|(route_id, _)| route_id.clone())
            .collect::<Vec<_>>();
        for canonical_route_id in canonical_route_ids {
            let mut route = snapshot
                .routes
                .remove(&canonical_route_id)
                .expect("canonical generated route is persisted");
            let edge = route.edges.first().expect("generated route has an edge");
            let (left, right) = ordered_route_endpoints(edge.from_location_id, edge.to_location_id);
            let legacy_route_id = format!("route:generated:{legacy_id}:{left}:{right}");
            route.id = legacy_route_id.clone();
            route.canonical_id.clear();
            route.owner = format!("actor:{}", RATI_ACTOR_ID);
            route.owner_pack_id.clear();
            route.owner_pack_version.clear();
            snapshot.routes.insert(legacy_route_id, route);
        }
        snapshot.routes.insert(
            "route:generated:orphan:1:2".to_string(),
            RouteRecordState {
                id: "route:generated:orphan:1:2".to_string(),
                canonical_id: String::new(),
                edges: vec![],
                owner: "actor:1001".to_string(),
                owner_pack_id: String::new(),
                owner_pack_version: String::new(),
                provenance: "generated_pathway:orphan".to_string(),
                directionality: RouteDirectionality::Reciprocal,
                fallback_location_id: None,
                lifecycle: RouteLifecycle::Latent,
                discovery: None,
                entity_version: 1,
            },
        );

        let mut forged_current_snapshot: RuntimeSnapshot = serde_json::from_slice(
            &serde_json::to_vec(&snapshot).expect("serialize downgraded fixture"),
        )
        .expect("clone downgraded fixture");
        forged_current_snapshot.version = 13;
        assert!(forged_current_snapshot.into_runtime().is_err());

        let restored = snapshot
            .into_runtime()
            .expect("v12 generated identity and route aliases migrate");
        let restored_routes = restored
            .routes
            .iter()
            .filter(|(_, route)| route.provenance == format!("generated_pathway:{legacy_id}"))
            .map(|(route_id, route)| (route_id.clone(), route.clone()))
            .collect::<BTreeMap<_, _>>();
        assert_eq!(
            serde_json::to_vec(&restored.generated_pathways).expect("serialize restored pathways"),
            serde_json::to_vec(&expected_pathways).expect("serialize replayed pathways")
        );
        assert_eq!(restored_routes, expected_routes);
        assert!(restored
            .routes
            .keys()
            .all(|route_id| !route_id.starts_with("route:generated:")));
        let restored_route = restored
            .routes
            .get(&generated_route_id)
            .expect("canonical generated route replaces its alias");
        assert_eq!(restored_route.lifecycle, RouteLifecycle::Blocked);
        assert_eq!(restored_route.discovery, Some(preserved_discovery));
        assert_eq!(restored_route.entity_version, 7);
    }

    #[test]
    fn legacy_snapshot_rejects_pathway_and_waypoint_aliases() {
        let seed = RuntimeWorld::seeded();
        let mut canonical_alias = RuntimeSnapshot::from_runtime(&seed);
        canonical_alias.version = 12;
        let first = legacy_pathway(&seed, 12, 50, 3, "pathway:12:50");
        let second = legacy_pathway(&seed, 12, 50, 3, "pathway:alias:12:50");
        canonical_alias
            .generated_pathways
            .insert(first.id.clone(), first);
        canonical_alias
            .generated_pathways
            .insert(second.id.clone(), second);
        assert!(canonical_alias.into_runtime().is_err());

        let mut waypoint_alias = RuntimeSnapshot::from_runtime(&seed);
        waypoint_alias.version = 12;
        let first = legacy_pathway(&seed, 12, 50, 3, "pathway:12:50");
        let mut second = legacy_pathway(&seed, 3, 50, 3, "pathway:3:50");
        second.waypoints[0].id = first.waypoints[0].id;
        waypoint_alias
            .generated_pathways
            .insert(first.id.clone(), first);
        waypoint_alias
            .generated_pathways
            .insert(second.id.clone(), second);
        assert!(waypoint_alias.into_runtime().is_err());
    }

    #[test]
    fn one_way_route_binding_previews_fallback_without_mutation() {
        let mut runtime = RuntimeWorld::seeded();
        let route_id = runtime
            .route_for_edge(COSY_COTTAGE_LOCATION_ID, RAIN_SOFT_GARDEN_LOCATION_ID)
            .expect("authored route")
            .id
            .clone();
        let route = runtime.routes.get_mut(&route_id).expect("route remains");
        route.directionality = RouteDirectionality::OneWay;
        route.fallback_location_id = Some(COSY_COTTAGE_LOCATION_ID);
        route.discovery = Some(RouteDiscoveryState {
            actor_id: RATI_ACTOR_ID,
            event_seq: 319,
            reason: "one-way-preview".to_string(),
        });
        route.edges.retain(|edge| {
            edge.from_location_id == COSY_COTTAGE_LOCATION_ID
                && edge.to_location_id == RAIN_SOFT_GARDEN_LOCATION_ID
        });
        runtime.rebuild_kernel_exits_from_routes();
        let before = RuntimeSnapshot::from_runtime(&runtime);

        let binding = runtime
            .route_offer_binding(COSY_COTTAGE_LOCATION_ID, RAIN_SOFT_GARDEN_LOCATION_ID)
            .expect("one-way entry has a preview binding");

        assert_eq!(binding.directionality, RouteDirectionality::OneWay);
        assert_eq!(binding.fallback_location_id, Some(COSY_COTTAGE_LOCATION_ID));
        let offer = runtime
            .legal_action_candidates(Some(RATI_ACTOR_ID), &AccessContext::default())
            .1
            .into_iter()
            .find(|offer| {
                offer.kind == "move"
                    && offer
                        .target
                        .as_ref()
                        .is_some_and(|target| target.id == Some(RAIN_SOFT_GARDEN_LOCATION_ID))
            })
            .expect("one-way move offer is visible");
        assert_eq!(
            offer.effect.as_deref(),
            Some("One-way entry; fallback to The Cosy Cottage.")
        );
        assert_eq!(offer.route, Some(binding));
        assert_eq!(
            serde_json::to_value(RuntimeSnapshot::from_runtime(&runtime))
                .expect("serialize after preview"),
            serde_json::to_value(before).expect("serialize before preview")
        );
    }

    #[test]
    fn authored_and_hidden_route_history_migrates_idempotently_and_visibly() {
        let mut runtime = RuntimeWorld::seeded();
        let authored_canonical_id = runtime
            .route_for_edge(COSY_COTTAGE_LOCATION_ID, RAIN_SOFT_GARDEN_LOCATION_ID)
            .expect("authored route")
            .id
            .clone();
        let hidden = active_content()
            .hidden_exits
            .first()
            .expect("hidden fixture");
        let hidden_canonical_id = runtime
            .route_for_hidden_exit(&hidden.id)
            .expect("hidden route")
            .id
            .clone();
        let authored_discovery = RouteDiscoveryState {
            actor_id: RATI_ACTOR_ID,
            event_seq: 319,
            reason: "legacy-authored".to_string(),
        };
        {
            let authored = runtime
                .routes
                .get_mut(&authored_canonical_id)
                .expect("authored route remains");
            authored.discovery = Some(authored_discovery.clone());
            authored.entity_version = 9;
            let hidden_route = runtime
                .routes
                .get_mut(&hidden_canonical_id)
                .expect("hidden route remains");
            hidden_route.lifecycle = RouteLifecycle::Blocked;
            hidden_route.entity_version = 7;
        }
        runtime.rebuild_kernel_exits_from_routes();
        let visible_before = runtime.world.exits[..runtime.world.exit_count].to_vec();
        let mut snapshot = RuntimeSnapshot::from_runtime(&runtime);
        snapshot.version = 13;
        for (canonical_id, legacy_id) in [
            (
                authored_canonical_id.clone(),
                authored_route_id(COSY_COTTAGE_LOCATION_ID, RAIN_SOFT_GARDEN_LOCATION_ID),
            ),
            (hidden_canonical_id.clone(), hidden_route_id(&hidden.id)),
        ] {
            let mut route = snapshot
                .routes
                .remove(&canonical_id)
                .expect("canonical route in fixture");
            route.id = legacy_id.clone();
            route.canonical_id.clear();
            route.owner_pack_id.clear();
            route.owner_pack_version.clear();
            snapshot.routes.insert(legacy_id, route);
        }

        let restored = snapshot.into_runtime().expect("v13 route history migrates");

        assert!(restored.routes.keys().all(|route_id| {
            !route_id.starts_with("route:authored:") && !route_id.starts_with("route:hidden:")
        }));
        assert_eq!(
            restored.routes[&authored_canonical_id].discovery,
            Some(authored_discovery)
        );
        assert_eq!(restored.routes[&authored_canonical_id].entity_version, 9);
        assert_eq!(
            restored.routes[&hidden_canonical_id].lifecycle,
            RouteLifecycle::Blocked
        );
        assert_eq!(restored.routes[&hidden_canonical_id].entity_version, 7);
        assert_eq!(
            &restored.world.exits[..restored.world.exit_count],
            visible_before
        );

        let replayed = RuntimeSnapshot::from_runtime(&restored)
            .into_runtime()
            .expect("canonical migration is idempotent");
        assert_eq!(replayed.routes, restored.routes);
        assert_eq!(
            &replayed.world.exits[..replayed.world.exit_count],
            visible_before
        );

        let legacy_binding = RouteOfferBinding {
            route_id: authored_route_id(COSY_COTTAGE_LOCATION_ID, RAIN_SOFT_GARDEN_LOCATION_ID),
            route_version: 9,
            directionality: RouteDirectionality::Reciprocal,
            fallback_location_id: None,
        };
        assert!(replayed.route_binding_is_current(&legacy_binding));
    }

    #[test]
    fn current_snapshot_rejects_route_aliases_and_forged_identity_metadata() {
        let runtime = RuntimeWorld::seeded();
        let canonical_route_id = runtime
            .route_for_edge(COSY_COTTAGE_LOCATION_ID, RAIN_SOFT_GARDEN_LOCATION_ID)
            .expect("authored route")
            .id
            .clone();

        let mut arbitrary_alias = RuntimeSnapshot::from_runtime(&runtime);
        let mut aliased_route = arbitrary_alias.routes[&canonical_route_id].clone();
        aliased_route.id = "route://evil".to_string();
        aliased_route.canonical_id = "route://evil".to_string();
        arbitrary_alias
            .routes
            .insert("route://evil".to_string(), aliased_route);
        assert!(arbitrary_alias.into_runtime().is_err());

        let mut wrong_owner = RuntimeSnapshot::from_runtime(&runtime);
        wrong_owner
            .routes
            .get_mut(&canonical_route_id)
            .expect("canonical route fixture")
            .owner_pack_id = "evil.owner".to_string();
        assert!(wrong_owner.into_runtime().is_err());

        let mut wrong_endpoints = RuntimeSnapshot::from_runtime(&runtime);
        wrong_endpoints
            .routes
            .get_mut(&canonical_route_id)
            .expect("canonical route fixture")
            .edges[0]
            .to_location_id = 9_999_999;
        assert!(wrong_endpoints.into_runtime().is_err());
    }

    #[test]
    fn snapshot_rejects_invalid_waypoint_and_journey_bounds() {
        let mut runtime = RuntimeWorld::seeded();
        let pathway = runtime
            .generated_pathway(RATI_ACTOR_ID, 3, 50, 3)
            .expect("long authored route");
        runtime
            .generated_pathways
            .insert(pathway.id.clone(), pathway.clone());
        let mut invalid_waypoints = RuntimeSnapshot::from_runtime(&runtime);
        invalid_waypoints
            .generated_pathways
            .get_mut(&pathway.id)
            .expect("pathway fixture")
            .waypoints
            .pop();
        assert!(invalid_waypoints.into_runtime().is_err());

        let mut invalid_journey = RuntimeSnapshot::from_runtime(&runtime);
        invalid_journey.journeys.insert(
            RATI_ACTOR_ID,
            JourneyState {
                actor_id: RATI_ACTOR_ID,
                pathway_id: pathway.id.clone(),
                origin_location_id: pathway.origin_location_id,
                destination_location_id: pathway.destination_location_id,
                destination_name: "Invalid detour".to_string(),
                path: vec![pathway.origin_location_id, pathway.destination_location_id],
                current_step: 0,
                explorer: true,
            },
        );
        assert!(invalid_journey.into_runtime().is_err());
    }
}
