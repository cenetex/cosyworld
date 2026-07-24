use super::*;

pub(super) const GENERATED_PLACE_SCHEMA_VERSION: u8 = 1;
const GENERATED_PLACE_ANCHOR_SEGMENTS: u8 = 1;
const GENERATED_PLACE_CONNECTION_SEGMENTS: u8 = 1;
const GENERATED_PLACE_SETTLEMENT_SEGMENTS: u8 = 3;
const MAX_GENERATED_BUILDING_CHOICES: usize = 6;

#[derive(Clone, Debug, Deserialize, Serialize)]
pub(super) struct GeneratedBuildingProposalState {
    pub(super) schema_version: u8,
    pub(super) location_id: u64,
    pub(super) eligible_archetype_ids: Vec<String>,
    pub(super) opened_event_seq: u64,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
pub(super) struct GeneratedPlaceState {
    pub(super) schema_version: u8,
    pub(super) location_id: u64,
    pub(super) pathway_id: String,
    pub(super) connected_from_location_id: u64,
    pub(super) discovered_by_actor_id: u64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(super) discovered_event_seq: Option<u64>,
    #[serde(default)]
    pub(super) source_generation: GenerationProvenance,
    pub(super) pack_id: String,
    pub(super) pack_version: String,
    pub(super) anchor_clock_id: String,
    pub(super) connection_clock_id: String,
    pub(super) settlement_clock_id: String,
    pub(super) anchor_job_id: String,
    pub(super) connection_job_id: String,
    pub(super) settlement_job_id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(super) building_proposal: Option<GeneratedBuildingProposalState>,
}

#[derive(Clone, Debug, Serialize)]
pub(super) struct GeneratedPlaceView {
    pub(super) schema_version: u8,
    pub(super) pathway_id: String,
    pub(super) connected_from_location_id: u64,
    pub(super) discovered_by_actor_id: u64,
    pub(super) discovered_event_seq: Option<u64>,
    pub(super) source_generation: GenerationProvenance,
    pub(super) pack_id: String,
    pub(super) pack_version: String,
    pub(super) milestones: Vec<String>,
    pub(super) anchor_clock_id: String,
    pub(super) connection_clock_id: String,
    pub(super) settlement_clock_id: String,
    pub(super) building_proposal: Option<GeneratedBuildingProposalState>,
}

pub(super) fn generated_place_anchor_clock_id(location_id: u64) -> String {
    format!("generated-place:{location_id}:anchor")
}

pub(super) fn generated_place_connection_clock_id(location_id: u64) -> String {
    format!("generated-place:{location_id}:connection")
}

pub(super) fn generated_place_settlement_clock_id(location_id: u64) -> String {
    format!("generated-place:{location_id}:settlement")
}

pub(super) fn generated_place_anchor_job_id(location_id: u64) -> String {
    format!("generated-place:{location_id}:anchor-fixture")
}

pub(super) fn generated_place_connection_job_id(location_id: u64) -> String {
    format!("generated-place:{location_id}:physical-connection")
}

pub(super) fn generated_place_settlement_job_id(location_id: u64) -> String {
    format!("generated-place:{location_id}:settlement")
}

fn generated_place_anchor_fixture_tag_id(location_id: u64) -> String {
    format!("generated-place:{location_id}:anchor-fixture")
}

fn generated_place_clock(
    id: String,
    location_id: u64,
    label: &str,
    segments: u8,
    question: &str,
    completion_memory: &str,
) -> ClockState {
    ClockState {
        id,
        scope: "room".to_string(),
        scope_id: location_id,
        kind: "progress".to_string(),
        zone: ZONE_FRONTIER.to_string(),
        label: label.to_string(),
        segments,
        filled: 0,
        visible_to_players: true,
        status: "active".to_string(),
        presentation: ClockPresentation {
            version: CLOCK_PRESENTATION_SCHEMA_VERSION,
            question: question.to_string(),
            rhythm: "construction".to_string(),
            attention: "local".to_string(),
            priority: 70,
            situation: question.trim_end_matches('?').to_string(),
            stakes: "Only a matching deed changes this place.".to_string(),
            outcome: completion_memory.to_string(),
            completion_memory: completion_memory.to_string(),
        },
        on_fill: Vec::new(),
        recent_contributions: Vec::new(),
        completion: None,
        created_event_seq: None,
        updated_event_seq: None,
    }
}

fn generated_place_strategy(
    id: &str,
    action_kind: &str,
    clock_id: &str,
    target: ContributionTargetDescriptor,
    requirements: Vec<ContributionRequirement>,
    claim_policy: ContributionClaimPolicy,
    strategy_label: &str,
    pack_id: &str,
    pack_version: &str,
    on_success: Vec<EffectDescriptor>,
) -> Option<JobContributionStrategy> {
    let binding = resolved_action_binding(action_kind)?;
    Some(JobContributionStrategy {
        version: JOB_CONTRIBUTION_SCHEMA_VERSION,
        id: id.to_string(),
        action_kind: action_kind.to_string(),
        rules_action: binding.rules_action,
        operation: binding.operation,
        target,
        requirements,
        resolution: ContributionResolutionPolicy::Certain,
        clock_id: clock_id.to_string(),
        baseline_progress: 1,
        success_progress: 0,
        prepared_bonus_progress: 0,
        on_success,
        on_failure: Vec::new(),
        claim_policy,
        strategy_label: strategy_label.to_string(),
        narration_key: format!("generated_place.{id}"),
        rules_profile: active_content().manifest.rules_profile.clone(),
        rules_pack_id: binding.pack_id,
        rules_pack_version: binding.pack_version,
        pack_id: pack_id.to_string(),
        pack_version: pack_version.to_string(),
    })
}

impl RuntimeWorld {
    fn generated_place_connection_source(
        &self,
        pathway: &GeneratedPathwayState,
        location_id: u64,
    ) -> u64 {
        let waypoint_ids = pathway
            .waypoints
            .iter()
            .map(|waypoint| waypoint.id)
            .collect::<BTreeSet<_>>();
        let mut candidates = pathway
            .revealed_edges
            .iter()
            .filter_map(|edge| parse_pathway_edge_key(edge))
            .filter_map(|(left, right)| {
                if left == location_id {
                    Some(right)
                } else if right == location_id {
                    Some(left)
                } else {
                    None
                }
            })
            .collect::<Vec<_>>();
        candidates.sort_by_key(|candidate| (waypoint_ids.contains(candidate), *candidate));
        candidates
            .into_iter()
            .next()
            .unwrap_or(pathway.origin_location_id)
    }

    pub(super) fn ensure_generated_place_for_waypoint(
        &mut self,
        pathway: &GeneratedPathwayState,
        location_id: u64,
        connected_from_location_id: u64,
    ) {
        let Some(waypoint) = pathway
            .waypoints
            .iter()
            .find(|waypoint| waypoint.id == location_id)
            .cloned()
        else {
            return;
        };
        let pack_id = "cosyworld.core".to_string();
        let pack_version = self.active_pack_version(&pack_id);
        let state =
            self.generated_places
                .entry(location_id)
                .or_insert_with(|| GeneratedPlaceState {
                    schema_version: GENERATED_PLACE_SCHEMA_VERSION,
                    location_id,
                    pathway_id: pathway.id.clone(),
                    connected_from_location_id,
                    discovered_by_actor_id: pathway.created_by_actor_id,
                    discovered_event_seq: None,
                    source_generation: pathway.generation.clone(),
                    pack_id: pack_id.clone(),
                    pack_version: pack_version.clone(),
                    anchor_clock_id: generated_place_anchor_clock_id(location_id),
                    connection_clock_id: generated_place_connection_clock_id(location_id),
                    settlement_clock_id: generated_place_settlement_clock_id(location_id),
                    anchor_job_id: generated_place_anchor_job_id(location_id),
                    connection_job_id: generated_place_connection_job_id(location_id),
                    settlement_job_id: generated_place_settlement_job_id(location_id),
                    building_proposal: None,
                });
        state.schema_version = GENERATED_PLACE_SCHEMA_VERSION;
        if state.pack_id.is_empty() {
            state.pack_id = pack_id;
        }
        if state.pack_version.is_empty() {
            state.pack_version = pack_version;
        }
        let state = state.clone();
        self.ensure_generated_place_projection(&state, &waypoint);
    }

    fn ensure_generated_place_projection(
        &mut self,
        state: &GeneratedPlaceState,
        waypoint: &GeneratedWaypointState,
    ) {
        self.clocks
            .entry(state.anchor_clock_id.clone())
            .or_insert_with(|| {
                generated_place_clock(
                    state.anchor_clock_id.clone(),
                    state.location_id,
                    "Anchor",
                    GENERATED_PLACE_ANCHOR_SEGMENTS,
                    "Can someone place one lasting fixture here?",
                    "A lasting fixture anchors the place.",
                )
            });
        self.clocks
            .entry(state.connection_clock_id.clone())
            .or_insert_with(|| {
                generated_place_clock(
                    state.connection_clock_id.clone(),
                    state.location_id,
                    "Connection",
                    GENERATED_PLACE_CONNECTION_SEGMENTS,
                    "Can someone carry a useful item here from the connected place?",
                    "A physical delivery connects the place.",
                )
            });
        self.clocks
            .entry(state.settlement_clock_id.clone())
            .or_insert_with(|| {
                generated_place_clock(
                    state.settlement_clock_id.clone(),
                    state.location_id,
                    "Settlement",
                    GENERATED_PLACE_SETTLEMENT_SEGMENTS,
                    "Will two travelers make three distinct contributions here?",
                    "Distinct hands make a building proposal possible.",
                )
            });

        let anchor_strategy = generated_place_strategy(
            "place-anchor-fixture",
            "work",
            &state.anchor_clock_id,
            ContributionTargetDescriptor {
                kind: "room".to_string(),
                id: Some(state.location_id.to_string()),
                predicate: None,
                label: "a lasting fixture".to_string(),
            },
            vec![ContributionRequirement::AtLocation {
                location_id: state.location_id,
            }],
            ContributionClaimPolicy::OncePerTarget,
            "Place a lasting fixture",
            &state.pack_id,
            &state.pack_version,
            vec![EffectDescriptor::SetTag {
                tag_id: generated_place_anchor_fixture_tag_id(state.location_id),
                scope: "room".to_string(),
                scope_id: state.location_id,
                label: "lasting anchor fixture".to_string(),
                kind: "boon".to_string(),
                expires: None,
                reason: Some("generated_place_anchor".to_string()),
            }],
        )
        .into_iter()
        .collect::<Vec<_>>();
        self.jobs
            .entry(state.anchor_job_id.clone())
            .or_insert_with(|| JobState {
                pack_id: state.pack_id.clone(),
                id: state.anchor_job_id.clone(),
                premise: "Place one lasting fixture.".to_string(),
                stakes: "Prose and passing visits do not anchor a place.".to_string(),
                location_ids: vec![state.location_id],
                participant_ids: Vec::new(),
                progress_clock_id: state.anchor_clock_id.clone(),
                danger_clock_id: String::new(),
                status: "active".to_string(),
                reward: JobReward::Label("The place gains an Anchor.".to_string()),
                consequence: "The place remains unanchored.".to_string(),
                memory_summary: "A lasting fixture anchored the place.".to_string(),
                action_copy: JobActionCopy {
                    label: "Place a fixture".to_string(),
                    summary: "Make one durable, inspectable change.".to_string(),
                },
                contribution_schema_version: JOB_CONTRIBUTION_SCHEMA_VERSION,
                contribution_strategies: anchor_strategy,
                narrated_thresholds: Vec::new(),
                delivery: None,
            });
        self.jobs
            .entry(state.connection_job_id.clone())
            .or_insert_with(|| JobState {
                pack_id: state.pack_id.clone(),
                id: state.connection_job_id.clone(),
                premise: "Carry something here from the connected place.".to_string(),
                stakes: "Only an actor-causal physical delivery counts.".to_string(),
                location_ids: vec![state.location_id],
                participant_ids: Vec::new(),
                progress_clock_id: state.connection_clock_id.clone(),
                danger_clock_id: String::new(),
                status: "active".to_string(),
                reward: JobReward::Label("The place gains a Connection.".to_string()),
                consequence: "The place remains disconnected.".to_string(),
                memory_summary: "A traveler carried a useful item into the place.".to_string(),
                action_copy: JobActionCopy {
                    label: "Carry something here".to_string(),
                    summary: "Bring and put down an item from the connected place.".to_string(),
                },
                contribution_schema_version: JOB_CONTRIBUTION_SCHEMA_VERSION,
                contribution_strategies: Vec::new(),
                narrated_thresholds: Vec::new(),
                delivery: Some(DeliveryJobSpec {
                    resource: "useful carried item".to_string(),
                    origin_location_id: state.connected_from_location_id,
                    destination_location_id: state.location_id,
                    created_world_tick: self.world.tick,
                    updated_world_tick: self.world.tick,
                }),
            });

        let settlement_strategies = self
            .generated_place_settlement_ready(state)
            .then(|| self.generated_place_settlement_strategies(state));
        self.jobs
            .entry(state.settlement_job_id.clone())
            .or_insert_with(|| JobState {
                pack_id: state.pack_id.clone(),
                id: state.settlement_job_id.clone(),
                premise: "Make three distinct contributions with at least two travelers."
                    .to_string(),
                stakes: "Repeated clicks by one traveler do not settle a place.".to_string(),
                location_ids: vec![state.location_id],
                participant_ids: Vec::new(),
                progress_clock_id: state.settlement_clock_id.clone(),
                danger_clock_id: String::new(),
                status: if settlement_strategies.is_some() {
                    "active"
                } else {
                    "waiting"
                }
                .to_string(),
                reward: JobReward::Label("A bounded building proposal opens.".to_string()),
                consequence: "No building choice opens yet.".to_string(),
                memory_summary: "Distinct travelers made a building choice possible.".to_string(),
                action_copy: JobActionCopy {
                    label: "Help the place settle".to_string(),
                    summary: "Contribute once in a way another traveler can witness.".to_string(),
                },
                contribution_schema_version: JOB_CONTRIBUTION_SCHEMA_VERSION,
                contribution_strategies: settlement_strategies.unwrap_or_default(),
                narrated_thresholds: Vec::new(),
                delivery: None,
            });

        let mut projects = vec![
            state.anchor_job_id.clone(),
            state.connection_job_id.clone(),
            state.settlement_job_id.clone(),
        ];
        if self.natural_affordances.contains_key(&state.location_id) {
            projects.push(natural_investigation_job_id(state.location_id));
        }
        projects.sort();
        projects.dedup();
        let aspects = if waypoint.meta.terrain.is_empty() {
            vec!["unfinished ground".to_string()]
        } else {
            waypoint.meta.terrain.clone()
        };
        let sheet = self
            .room_sheets
            .entry(state.location_id)
            .or_insert_with(|| RoomSheetState {
                id: format!("generated-place-room:{}", state.location_id),
                location_id: state.location_id,
                name: waypoint.name.clone(),
                safety: "risky".to_string(),
                zone: ZONE_FRONTIER.to_string(),
                aspects: aspects.clone(),
                boons: vec!["Careful deeds leave lasting marks here.".to_string()],
                hooks: vec!["Anchor, connect, then settle this place.".to_string()],
                resources: BTreeMap::new(),
                projects: projects.clone(),
                season_clock_id: None,
            });
        sheet.safety = "risky".to_string();
        sheet.zone = ZONE_FRONTIER.to_string();
        sheet
            .projects
            .retain(|job_id| job_id != &generated_pathway_job_id(&state.pathway_id));
        sheet.projects.extend(projects);
        sheet.projects.sort();
        sheet.projects.dedup();
    }

    fn generated_place_settlement_strategies(
        &self,
        state: &GeneratedPlaceState,
    ) -> Vec<JobContributionStrategy> {
        let at_place = vec![ContributionRequirement::AtLocation {
            location_id: state.location_id,
        }];
        [
            generated_place_strategy(
                "settlement-work",
                "work",
                &state.settlement_clock_id,
                ContributionTargetDescriptor {
                    kind: "room".to_string(),
                    id: Some(state.location_id.to_string()),
                    predicate: None,
                    label: "the shared place".to_string(),
                },
                at_place.clone(),
                ContributionClaimPolicy::OncePerActor,
                "Make one lasting contribution",
                &state.pack_id,
                &state.pack_version,
                Vec::new(),
            ),
            generated_place_strategy(
                "settlement-help",
                "help",
                &state.settlement_clock_id,
                ContributionTargetDescriptor {
                    kind: "actor".to_string(),
                    id: None,
                    predicate: Some("co_present_avatar".to_string()),
                    label: "a nearby traveler".to_string(),
                },
                at_place,
                ContributionClaimPolicy::OncePerActor,
                "Work beside another traveler",
                &state.pack_id,
                &state.pack_version,
                Vec::new(),
            ),
        ]
        .into_iter()
        .flatten()
        .collect()
    }

    fn generated_place_anchor_complete(&self, state: &GeneratedPlaceState) -> bool {
        self.clocks
            .get(&state.anchor_clock_id)
            .is_some_and(|clock| clock.filled >= clock.segments)
            && self
                .tags
                .get(&generated_place_anchor_fixture_tag_id(state.location_id))
                .is_some_and(|tag| {
                    tag.active
                        && tag.scope == "room"
                        && tag.scope_id == state.location_id
                        && tag.kind == "boon"
                })
    }

    fn generated_place_connection_complete(&self, state: &GeneratedPlaceState) -> bool {
        self.clocks
            .get(&state.connection_clock_id)
            .is_some_and(|clock| {
                clock.filled >= clock.segments
                    && clock.recent_contributions.iter().any(|contribution| {
                        contribution.strategy_id
                            == format!("{}:physical-delivery", state.connection_job_id)
                    })
            })
    }

    fn generated_place_settlement_ready(&self, state: &GeneratedPlaceState) -> bool {
        self.generated_place_anchor_complete(state)
            && self.generated_place_connection_complete(state)
    }

    fn generated_place_settlement_complete(&self, state: &GeneratedPlaceState) -> bool {
        let Some(clock) = self.clocks.get(&state.settlement_clock_id) else {
            return false;
        };
        clock.filled >= clock.segments
            && clock
                .recent_contributions
                .iter()
                .map(|contribution| contribution.actor_id)
                .collect::<BTreeSet<_>>()
                .len()
                >= 2
    }

    pub(super) fn generated_place_milestones(&self, location_id: u64) -> Vec<String> {
        let Some(state) = self.generated_places.get(&location_id) else {
            return Vec::new();
        };
        let mut milestones = vec!["Discovered".to_string()];
        if self.generated_place_anchor_complete(state) {
            milestones.push("Anchor".to_string());
        }
        if self.generated_place_connection_complete(state) {
            milestones.push("Connection".to_string());
        }
        if self.generated_place_settlement_complete(state) {
            milestones.push("Settlement".to_string());
        }
        milestones
    }

    fn generated_building_choices(&self, location_id: u64) -> Vec<String> {
        let mut choices = vec![
            "dwelling".to_string(),
            "waystation".to_string(),
            "workshop".to_string(),
        ];
        choices.extend(self.eligible_natural_building_archetypes(location_id));
        choices.sort();
        choices.dedup();
        choices.truncate(MAX_GENERATED_BUILDING_CHOICES);
        choices
    }

    pub(super) fn generated_place_building_choices(&self, location_id: u64) -> Vec<String> {
        self.generated_places
            .get(&location_id)
            .and_then(|state| state.building_proposal.as_ref())
            .map(|proposal| proposal.eligible_archetype_ids.clone())
            .unwrap_or_default()
    }

    pub(super) fn generated_place_view(&self, location_id: u64) -> Option<GeneratedPlaceView> {
        let state = self.generated_places.get(&location_id)?;
        Some(GeneratedPlaceView {
            schema_version: state.schema_version,
            pathway_id: state.pathway_id.clone(),
            connected_from_location_id: state.connected_from_location_id,
            discovered_by_actor_id: state.discovered_by_actor_id,
            discovered_event_seq: state.discovered_event_seq,
            source_generation: state.source_generation.clone(),
            pack_id: state.pack_id.clone(),
            pack_version: state.pack_version.clone(),
            milestones: self.generated_place_milestones(location_id),
            anchor_clock_id: state.anchor_clock_id.clone(),
            connection_clock_id: state.connection_clock_id.clone(),
            settlement_clock_id: state.settlement_clock_id.clone(),
            building_proposal: state.building_proposal.clone(),
        })
    }

    pub(super) fn record_generated_place_discovery(
        &mut self,
        pathway: &GeneratedPathwayState,
        reveal_edges: &[(u64, u64)],
        actor_id: u64,
        event_seq: u64,
    ) {
        for (from_location_id, to_location_id) in reveal_edges {
            for (location_id, connected_from_location_id) in [
                (*from_location_id, *to_location_id),
                (*to_location_id, *from_location_id),
            ] {
                if !pathway
                    .waypoints
                    .iter()
                    .any(|waypoint| waypoint.id == location_id)
                {
                    continue;
                }
                self.ensure_generated_place_for_waypoint(
                    pathway,
                    location_id,
                    connected_from_location_id,
                );
                if let Some(state) = self.generated_places.get_mut(&location_id) {
                    state.discovered_by_actor_id = actor_id;
                    state.discovered_event_seq.get_or_insert(event_seq);
                }
                let clock_ids = [
                    generated_place_anchor_clock_id(location_id),
                    generated_place_connection_clock_id(location_id),
                    generated_place_settlement_clock_id(location_id),
                ];
                for clock_id in clock_ids {
                    if let Some(clock) = self.clocks.get_mut(&clock_id) {
                        clock.created_event_seq.get_or_insert(event_seq);
                    }
                }
            }
        }
    }

    pub(super) fn migrate_generated_pathway_projection(&mut self, pathway: &GeneratedPathwayState) {
        self.jobs.remove(&generated_pathway_job_id(&pathway.id));
        self.clocks
            .remove(&generated_pathway_progress_clock_id(&pathway.id));
        self.clocks
            .remove(&generated_pathway_danger_clock_id(&pathway.id));
        for sheet in self.room_sheets.values_mut() {
            sheet
                .projects
                .retain(|job_id| job_id != &generated_pathway_job_id(&pathway.id));
        }

        for waypoint in &pathway.waypoints {
            if !self.generated_location_is_revealed(waypoint.id) {
                continue;
            }
            let connected_from_location_id =
                self.generated_place_connection_source(pathway, waypoint.id);
            self.ensure_generated_place_for_waypoint(
                pathway,
                waypoint.id,
                connected_from_location_id,
            );
        }
    }

    pub(super) fn reconcile_generated_places(
        &mut self,
        actor_id: u64,
        caused_by_event_seq: Option<u64>,
    ) -> Vec<EventView> {
        let location_ids = self.generated_places.keys().copied().collect::<Vec<_>>();
        let mut events = Vec::new();
        for location_id in location_ids {
            let Some(state) = self.generated_places.get(&location_id).cloned() else {
                continue;
            };
            if let Some(pathway) = self.generated_pathways.get(&state.pathway_id).cloned() {
                if let Some(waypoint) = pathway
                    .waypoints
                    .iter()
                    .find(|waypoint| waypoint.id == location_id)
                    .cloned()
                {
                    self.ensure_generated_place_projection(&state, &waypoint);
                }
            }

            let settlement_ready = self.generated_place_settlement_ready(&state);
            let settlement_strategies =
                settlement_ready.then(|| self.generated_place_settlement_strategies(&state));
            if let Some(job) = self.jobs.get_mut(&state.settlement_job_id) {
                if settlement_ready && job.status == "waiting" {
                    job.status = "active".to_string();
                    job.contribution_strategies = settlement_strategies.unwrap_or_default();
                }
            }

            if !self.generated_place_settlement_complete(&state) {
                continue;
            }
            let choices = self.generated_building_choices(location_id);
            let existing_choices = state
                .building_proposal
                .as_ref()
                .map(|proposal| proposal.eligible_archetype_ids.clone());
            if existing_choices.as_ref() == Some(&choices) {
                continue;
            }
            let opened_event_seq = state
                .building_proposal
                .as_ref()
                .map(|proposal| proposal.opened_event_seq)
                .unwrap_or(self.world.next_event_seq);
            if let Some(place) = self.generated_places.get_mut(&location_id) {
                place.building_proposal = Some(GeneratedBuildingProposalState {
                    schema_version: GENERATED_PLACE_SCHEMA_VERSION,
                    location_id,
                    eligible_archetype_ids: choices.clone(),
                    opened_event_seq,
                });
            }
            let event_type = if existing_choices.is_some() {
                "generated_place.building_proposal_updated"
            } else {
                "generated_place.building_proposal_opened"
            };
            let name = self
                .location_name(location_id)
                .unwrap_or_else(|| format!("Location {location_id}"));
            let mut event = self.append_async_job_event(
                event_type,
                actor_id,
                None,
                Some(format!(
                    "{name} can now consider {}.",
                    choices
                        .iter()
                        .map(|choice| choice.replace('_', " "))
                        .collect::<Vec<_>>()
                        .join(", ")
                )),
            );
            event.location_id = Some(location_id);
            event.location_name = Some(name);
            event.caused_by_event_seq = caused_by_event_seq;
            self.replace_projected_event(&event);
            events.push(event);
        }
        events
    }
}
