use super::*;

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(untagged)]
pub(super) enum JobReward {
    Label(String),
    Details {
        #[serde(default)]
        label: String,
        #[serde(default)]
        orbs: i32,
    },
}

impl JobReward {
    pub(super) fn label(&self) -> &str {
        match self {
            JobReward::Label(label) => label,
            JobReward::Details { label, .. } => label,
        }
    }

    pub(super) fn orbs(&self) -> i32 {
        match self {
            JobReward::Label(_) => 0,
            JobReward::Details { orbs, .. } => *orbs,
        }
    }
}

#[derive(Clone, Debug, Deserialize, Serialize)]
pub(super) struct JobState {
    #[serde(default)]
    pub(super) pack_id: String,
    pub(super) id: String,
    pub(super) premise: String,
    pub(super) stakes: String,
    pub(super) location_ids: Vec<u64>,
    pub(super) participant_ids: Vec<u64>,
    pub(super) progress_clock_id: String,
    pub(super) danger_clock_id: String,
    #[serde(default)]
    pub(super) status: String,
    pub(super) reward: JobReward,
    pub(super) consequence: String,
    #[serde(default)]
    pub(super) memory_summary: String,
    #[serde(default)]
    pub(super) action_copy: JobActionCopy,
    #[serde(default)]
    pub(super) contribution_schema_version: u8,
    #[serde(default)]
    pub(super) contribution_strategies: Vec<JobContributionStrategy>,
    #[serde(default)]
    pub(super) narrated_thresholds: Vec<JobNarratedThreshold>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(super) delivery: Option<DeliveryJobSpec>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(super) loot: Option<JobLootSpec>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(super) focused_profile: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(super) focused_encounter: Option<FocusedJobEncounterState>,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub(super) enum DeliveryRequirement {
    ExactItem { item_id: u64 },
}

impl DeliveryRequirement {
    pub(super) fn accepts(&self, evidence: &DeliveryEvidence) -> bool {
        match self {
            Self::ExactItem { item_id } => evidence.item_id == *item_id,
        }
    }
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
pub(super) struct DeliveryJobSpec {
    pub(super) resource: String,
    pub(super) origin_location_id: u64,
    pub(super) destination_location_id: u64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(super) requirement: Option<DeliveryRequirement>,
    pub(super) created_world_tick: u64,
    pub(super) updated_world_tick: u64,
}

impl DeliveryJobSpec {
    pub(super) fn aggregate_resource(
        resource: String,
        origin_location_id: u64,
        destination_location_id: u64,
        world_tick: u64,
    ) -> Self {
        // World-simulation resources are aggregate pressure rather than
        // represented item identities. They retain the historical
        // any-physical-item contract until content supplies a typed binding.
        Self {
            resource,
            origin_location_id,
            destination_location_id,
            requirement: None,
            created_world_tick: world_tick,
            updated_world_tick: world_tick,
        }
    }

    pub(super) fn accepts(&self, evidence: &DeliveryEvidence) -> bool {
        self.origin_location_id == evidence.origin_location_id
            && self.destination_location_id == evidence.destination_location_id
            && self
                .requirement
                .as_ref()
                .is_none_or(|requirement| requirement.accepts(evidence))
    }
}

#[derive(Clone, Debug, Default, Deserialize, Serialize)]
pub(super) struct JobActionCopy {
    #[serde(default)]
    pub(super) label: String,
    #[serde(default)]
    pub(super) summary: String,
}

#[cfg(test)]
mod tests {
    use super::*;

    fn evidence(item_id: u64) -> DeliveryEvidence {
        DeliveryEvidence {
            actor_id: 7,
            item_id,
            origin_location_id: 10,
            destination_location_id: 11,
            acquisition_event_seq: 100,
            movement_event_seqs: vec![101],
            delivery_event_seq: 102,
        }
    }

    #[test]
    fn exact_item_requirement_rejects_another_item_on_the_same_route() {
        let delivery = DeliveryJobSpec {
            resource: "Blue Token".to_string(),
            origin_location_id: 10,
            destination_location_id: 11,
            requirement: Some(DeliveryRequirement::ExactItem { item_id: 4 }),
            created_world_tick: 1,
            updated_world_tick: 1,
        };

        assert!(delivery.accepts(&evidence(4)));
        assert!(!delivery.accepts(&evidence(5)));
    }

    #[test]
    fn historical_delivery_without_a_requirement_keeps_its_recorded_contract() {
        let delivery: DeliveryJobSpec = serde_json::from_value(serde_json::json!({
            "resource": "legacy represented item",
            "origin_location_id": 10,
            "destination_location_id": 11,
            "created_world_tick": 1,
            "updated_world_tick": 1
        }))
        .expect("legacy delivery decodes");

        assert!(delivery.requirement.is_none());
        assert!(delivery.accepts(&evidence(4)));
    }

    #[test]
    fn generated_place_connection_freezes_enforces_and_restores_one_exact_item() {
        let mut runtime = RuntimeWorld::seeded();
        let mut pathway = runtime
            .generated_pathway(
                RATI_ACTOR_ID,
                RAIN_SOFT_GARDEN_LOCATION_ID,
                MOONLIT_TRAIL_LOCATION_ID,
                2,
            )
            .expect("generated pathway");
        let waypoint = pathway.waypoints[0].clone();
        pathway
            .revealed_edges
            .insert(pathway_edge_key(RAIN_SOFT_GARDEN_LOCATION_ID, waypoint.id));
        runtime
            .generated_pathways
            .insert(pathway.id.clone(), pathway.clone());
        runtime.ensure_generated_pathway_edge(&pathway, RAIN_SOFT_GARDEN_LOCATION_ID, waypoint.id);
        runtime.ensure_generated_place_for_waypoint(
            &pathway,
            waypoint.id,
            RAIN_SOFT_GARDEN_LOCATION_ID,
        );

        let job_id = generated_place_connection_job_id(waypoint.id);
        let job = runtime.jobs.get(&job_id).expect("exact connection job");
        let delivery = job.delivery.as_ref().expect("physical delivery");
        assert_eq!(
            delivery.requirement,
            Some(DeliveryRequirement::ExactItem {
                item_id: DEWBRIGHT_BUTTON_ITEM_ID,
            })
        );
        assert!(job.premise.contains("Dewbright Button"));
        assert!(job.premise.contains("Rain-Soft Garden"));

        let wrong_item_events = runtime.apply_actor_causal_logistics(vec![DeliveryEvidence {
            actor_id: RATI_ACTOR_ID,
            item_id: WATCH_BELL_ITEM_ID,
            origin_location_id: RAIN_SOFT_GARDEN_LOCATION_ID,
            destination_location_id: waypoint.id,
            acquisition_event_seq: 80,
            movement_event_seqs: vec![81],
            delivery_event_seq: 82,
        }]);
        assert_eq!(runtime.job_status(&runtime.jobs[&job_id]), "active");
        assert_eq!(
            runtime.clocks[&generated_place_connection_clock_id(waypoint.id)].filled,
            0
        );
        assert!(!wrong_item_events
            .iter()
            .any(|event| event.type_name == "job.updated"));

        runtime.apply_actor_causal_logistics(vec![DeliveryEvidence {
            actor_id: RATI_ACTOR_ID,
            item_id: DEWBRIGHT_BUTTON_ITEM_ID,
            origin_location_id: RAIN_SOFT_GARDEN_LOCATION_ID,
            destination_location_id: waypoint.id,
            acquisition_event_seq: 83,
            movement_event_seqs: vec![84],
            delivery_event_seq: 85,
        }]);
        assert_eq!(runtime.job_status(&runtime.jobs[&job_id]), "completed");
        assert!(runtime
            .generated_place_milestones(waypoint.id)
            .contains(&"Connection".to_string()));

        let restored = RuntimeSnapshot::from_runtime(&runtime)
            .into_runtime()
            .expect("exact connection snapshot restores");
        assert_eq!(restored.job_status(&restored.jobs[&job_id]), "completed");
        assert_eq!(
            restored.jobs[&job_id]
                .delivery
                .as_ref()
                .and_then(|delivery| delivery.requirement.as_ref())
                .map(|requirement| match requirement {
                    DeliveryRequirement::ExactItem { item_id } => *item_id,
                }),
            Some(DEWBRIGHT_BUTTON_ITEM_ID)
        );
    }
}
