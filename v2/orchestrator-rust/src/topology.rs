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
pub(super) struct RouteUnlockState {
    pub(super) from_location_id: u64,
    pub(super) to_location_id: u64,
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
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(super) generation_policy: Option<GeneratedPolicyBinding>,
    pub(super) provenance: String,
    #[serde(default)]
    pub(super) directionality: RouteDirectionality,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(super) fallback_location_id: Option<u64>,
    pub(super) lifecycle: RouteLifecycle,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(super) discovery: Option<RouteDiscoveryState>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub(super) unlocks: Vec<RouteUnlockState>,
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
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(super) threshold: Option<ThresholdOfferBinding>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub(super) struct ThresholdOfferBinding {
    pub(super) actor_id: u64,
    pub(super) gate_id: u64,
    pub(super) method_id: u64,
    pub(super) gate_version: u64,
    pub(super) access_revision: u64,
    pub(super) evidence_digest: u64,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub(super) facts: Vec<CwGateFact>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub(super) struct RouteLifecycleMutation {
    pub(super) route_id: String,
    pub(super) expected_version: u64,
    pub(super) lifecycle: RouteLifecycle,
    pub(super) reason: String,
}

impl RouteRecordState {
    pub(super) fn contains_edge(&self, from_location_id: u64, to_location_id: u64) -> bool {
        self.edges.iter().any(|edge| {
            edge.from_location_id == from_location_id && edge.to_location_id == to_location_id
        })
    }
}

impl RuntimeWorld {
    pub(super) fn route_discovered_for_edge(
        &self,
        from_location_id: u64,
        to_location_id: u64,
    ) -> bool {
        self.route_for_edge_in_any_lifecycle(from_location_id, to_location_id)
            .is_some_and(|route| route.discovery.is_some())
    }

    pub(crate) fn route_for_edge_in_any_lifecycle(
        &self,
        from_location_id: u64,
        to_location_id: u64,
    ) -> Option<&RouteRecordState> {
        self.routes
            .values()
            .find(|route| route.contains_edge(from_location_id, to_location_id))
    }
}
