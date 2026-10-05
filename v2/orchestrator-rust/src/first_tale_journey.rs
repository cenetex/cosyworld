use super::*;

#[derive(Clone, Debug, Default, Deserialize, Serialize)]
struct JourneyRecord {
    #[serde(default)]
    contributions: BTreeMap<u64, String>,
    report_event_seq: Option<u64>,
    return_event_seq: Option<u64>,
    recognition: Option<String>,
    next_job_id: Option<String>,
    next_started_event_seq: Option<u64>,
}

#[derive(Clone, Debug, Serialize)]
pub(crate) struct FirstTaleJourneyView {
    pub(crate) title: String,
    pub(crate) premise: String,
    pub(crate) instruction: String,
    pub(crate) outcome: String,
    pub(crate) recognition: Option<String>,
    pub(crate) contributions: Vec<String>,
    pub(crate) shared_progress: u8,
    pub(crate) shared_goal: u8,
    pub(crate) next_request: Option<JourneyNextRequestView>,
}

#[derive(Clone, Debug, Serialize)]
pub(crate) struct JourneyNextRequestView {
    pub(crate) job_id: String,
    pub(crate) destination_location_id: u64,
    pub(crate) question: String,
}

fn remember_contribution(record: &mut JourneyRecord, seq: u64, label: String) {
    if !record.contributions.values().any(|saved| saved == &label) {
        record.contributions.entry(seq).or_insert(label);
    }
}

fn record_prefix(actor_id: u64) -> String {
    let job_id = active_first_tale()
        .and_then(|tale| tale.continuation.as_ref())
        .map(|continuation| continuation.job_id.as_str())
        .unwrap_or_default();
    format!("first_tale:journey:v1:{job_id}:{actor_id}:")
}

impl RuntimeWorld {
    #[cfg(test)]
    pub(crate) fn complete_return_journey_for_test(&mut self, actor_id: u64) {
        self.save_journey_record(
            actor_id,
            &JourneyRecord {
                return_event_seq: Some(90_000 + actor_id),
                next_started_event_seq: Some(90_001 + actor_id),
                ..JourneyRecord::default()
            },
        );
    }

    fn journey_job(&self) -> Option<&JobState> {
        let tale = active_first_tale()?;
        tale.presentation.as_ref()?;
        let continuation = tale.continuation.as_ref()?;
        continuation
            .return_to_requester
            .then(|| self.jobs.get(&continuation.job_id))
            .flatten()
    }

    fn journey_record(&self, actor_id: u64) -> JourneyRecord {
        let prefix = record_prefix(actor_id);
        let mut record = self
            .rpg_claims
            .range(prefix.clone()..)
            .take_while(|claim| claim.starts_with(&prefix))
            .find_map(|claim| {
                serde_json::from_str::<JourneyRecord>(claim.strip_prefix(&prefix)?).ok()
            })
            .unwrap_or_default();
        // Old saves can still carry the actor's own feature evidence. New
        // actions save the small record before the visible event log rotates.
        self.collect_journey_contributions(actor_id, &self.event_log, &mut record);
        record
    }

    fn save_journey_record(&mut self, actor_id: u64, record: &JourneyRecord) {
        let prefix = record_prefix(actor_id);
        if let Ok(json) = serde_json::to_string(record) {
            let saved = format!("{prefix}{json}");
            if self.rpg_claims.contains(&saved) {
                return;
            }
            let old = self
                .rpg_claims
                .range(prefix.clone()..)
                .take_while(|claim| claim.starts_with(&prefix))
                .cloned()
                .collect::<Vec<_>>();
            for claim in old {
                self.rpg_claims.remove(&claim);
            }
            self.rpg_claims.insert(saved);
        }
    }

    fn collect_journey_contributions(
        &self,
        actor_id: u64,
        events: &[EventView],
        record: &mut JourneyRecord,
    ) {
        let Some(job) = self.journey_job() else {
            return;
        };
        let closed_at = self.journey_closed_event_seq();
        let requirements = job
            .contribution_strategies
            .iter()
            .flat_map(|strategy| &strategy.requirements)
            .collect::<Vec<_>>();
        for requirement in &requirements {
            if let ContributionRequirement::FeatureUsed {
                location_id,
                feature_key,
                item_id,
            } = requirement
            {
                if let Some(seq) = self
                    .tags
                    .get(&feature_use_tag_id(
                        actor_id,
                        *location_id,
                        feature_key,
                        *item_id,
                    ))
                    .filter(|tag| tag.active)
                    .and_then(|tag| tag.source_event_seq)
                {
                    if closed_at.is_some_and(|closed| seq > closed) {
                        continue;
                    }
                    let feature = self.journey_feature_name(*location_id, feature_key);
                    let item = self
                        .item_name(*item_id)
                        .unwrap_or_else(|| "a road tool".to_string());
                    remember_contribution(record, seq, format!("used {item} at {feature}"));
                }
            }
        }
        for event in events.iter().filter(|event| {
            event.actor_id == Some(actor_id)
                && event.success
                && closed_at.is_none_or(|closed| event.seq <= closed)
        }) {
            let label = if event.type_name == "job.contribution.resolved" {
                event
                    .content
                    .as_deref()
                    .and_then(|content| serde_json::from_str::<JobContributionTrace>(content).ok())
                    .filter(|trace| trace.job_id == job.id && trace.total_progress > 0)
                    .map(|trace| format!("helped with {}", trace.target.label))
            } else if event.type_name == "feature.searched" {
                requirements
                    .iter()
                    .find_map(|requirement| match requirement {
                        ContributionRequirement::FeatureSearched {
                            location_id,
                            feature_key,
                        } if self.contribution_requirement_source_event_seq(requirement)
                            == Some(event.seq) =>
                        {
                            Some(format!(
                                "searched {}",
                                self.journey_feature_name(*location_id, feature_key)
                            ))
                        }
                        _ => None,
                    })
            } else if matches!(
                event.type_name.as_str(),
                "combat.attack.attempt" | "combat.defend" | "combat.dodge"
            ) && self
                .active_combat_encounter_for_actor(actor_id)
                .is_some_and(|encounter| encounter.id == combat_encounter_id(&job.id))
            {
                Some("faced the guard on the keeper's road".to_string())
            } else if event.type_name == "combat.encounter.resolved"
                && event.content_id == Some(combat_encounter_id(&job.id))
                && event.total == Some(1)
            {
                Some("helped open the guarded road".to_string())
            } else {
                None
            };
            if let Some(label) = label {
                remember_contribution(record, event.seq, label);
            }
        }
    }

    fn journey_closed_event_seq(&self) -> Option<u64> {
        let job = self.journey_job()?;
        let prefix = format!("first_tale:journey_closed:v1:{}:", job.id);
        self.rpg_claims
            .iter()
            .filter_map(|claim| claim.strip_prefix(&prefix)?.parse::<u64>().ok())
            .min()
            .or_else(|| {
                self.event_log
                    .iter()
                    .find(|event| {
                        event.type_name == "job.updated"
                            && event.content.as_deref().is_some_and(|content| {
                                content.starts_with(&format!("{}:completed:", job.id))
                                    || content.starts_with(&format!("{}:failed:", job.id))
                            })
                    })
                    .map(|event| event.seq)
            })
    }

    fn journey_feature_name(&self, location_id: u64, feature_key: &str) -> String {
        active_content()
            .room_features
            .iter()
            .find(|feature| feature.location_id == location_id && feature.key == feature_key)
            .map(|feature| feature.name.clone())
            .unwrap_or_else(|| feature_key.replace('_', " "))
    }

    pub(crate) fn first_tale_journey_stage(&self, actor_id: u64) -> Option<FirstTaleStage> {
        let job = self.journey_job()?;

        let actor = self.actor_by_id(actor_id)?;
        let tale = active_first_tale()?;
        let record = self.journey_record(actor_id);
        if record.return_event_seq.is_some() {
            return Some(
                if record.next_started_event_seq.is_none()
                    && self.journey_next_request(actor_id, &record).is_some()
                {
                    FirstTaleStage::NextRequest
                } else {
                    FirstTaleStage::JourneyComplete
                },
            );
        }
        if !matches!(self.job_status(job).as_str(), "completed" | "failed") {
            return None;
        }
        if !record.contributions.is_empty() && record.report_event_seq.is_none() {
            let mara = self.actor_by_id(tale.continuation.as_ref()?.target_actor_id)?;
            return Some(if actor.location_id == mara.location_id {
                FirstTaleStage::ContinuationReport
            } else {
                FirstTaleStage::ContinuationReportTravel
            });
        }
        let rati = self.actor_by_id(tale.presentation.as_ref()?.requester_actor_id)?;
        Some(if actor.location_id == rati.location_id {
            FirstTaleStage::ReturnArrived
        } else {
            FirstTaleStage::ReturnTravel
        })
    }

    pub(crate) fn first_tale_journey_notice_fact(
        &self,
        actor_id: u64,
        target_id: u64,
    ) -> Option<NoticeActorFact> {
        self.first_tale_trace_event_seq(actor_id)?;
        let stage = self.first_tale_journey_stage(actor_id)?;
        let tale = active_first_tale()?;
        let expected_id = match stage {
            FirstTaleStage::ContinuationReport => tale.continuation.as_ref()?.target_actor_id,
            FirstTaleStage::ReturnArrived => tale.presentation.as_ref()?.requester_actor_id,
            _ => return None,
        };
        let actor = self.actor_by_id(actor_id)?;
        let target = self.actor_by_id(target_id)?;
        if target_id != expected_id
            || target.location_id != actor.location_id
            || !Self::actor_can_act(target)
            || self.actors_blocked(actor_id, target_id)
            || !self.actor_visible_in_projection(target, Some(actor_id), None)
        {
            return None;
        }
        let name = self.actor_name(target_id)?;
        Some(NoticeActorFact {
            fact_id: format!(
                "first_tale:journey_notice:v1:{actor_id}:{target_id}:{}",
                stage.continuation_phase()?
            ),
            target_actor_id: target_id,
            target_name: name.clone(),
            item_id: 0,
            item_name: String::new(),
            held_since_tick: 0,
            content: format!(
                "{name} is ready to hear your road news. {}",
                self.journey_outcome()
            ),
        })
    }

    pub(crate) fn apply_first_tale_journey_projection(
        &mut self,
        action: &CwAction,
        events: &[EventView],
    ) -> Vec<EventView> {
        if self.journey_job().is_none() {
            return Vec::new();
        }
        let actor_id = action.actor_id;
        let job_id = self.journey_job().unwrap().id.clone();
        for event in events.iter().filter(|event| {
            event.type_name == "job.updated"
                && event.content.as_deref().is_some_and(|content| {
                    content.starts_with(&format!("{job_id}:completed:"))
                        || content.starts_with(&format!("{job_id}:failed:"))
                })
        }) {
            self.rpg_claims.insert(format!(
                "first_tale:journey_closed:v1:{job_id}:{}",
                event.seq
            ));
        }
        let mut record = self.journey_record(actor_id);
        self.collect_journey_contributions(actor_id, events, &mut record);
        if record.return_event_seq.is_some() && record.next_started_event_seq.is_none() {
            if let Some((event_seq, trace)) = events
                .iter()
                .filter(|event| {
                    event.actor_id == Some(actor_id)
                        && event.type_name == "job.contribution.resolved"
                })
                .find_map(|event| {
                    let trace =
                        serde_json::from_str::<JobContributionTrace>(event.content.as_deref()?)
                            .ok()?;
                    (trace.total_progress > 0
                        && trace.job_id != job_id
                        && trace.job_id != active_first_tale()?.job_id)
                        .then_some((event.seq, trace))
                })
            {
                record.next_job_id = Some(trace.job_id);
                record.next_started_event_seq = Some(event_seq);
            }
        }
        if self.first_tale_trace_event_seq(actor_id).is_none() {
            if !record.contributions.is_empty() || record.return_event_seq.is_some() {
                self.save_journey_record(actor_id, &record);
            }
            return Vec::new();
        }
        let Some(notice) = events.iter().find(|event| {
            event.type_name == "notice.actor_observed"
                && event.actor_id == Some(actor_id)
                && event.success
        }) else {
            if !record.contributions.is_empty() || record.return_event_seq.is_some() {
                self.save_journey_record(actor_id, &record);
            }
            return Vec::new();
        };
        let tale = active_first_tale().expect("journey has content");
        let stage = self.first_tale_journey_stage(actor_id);
        let (event_type, target_id) = match stage {
            Some(FirstTaleStage::ContinuationReport) => (
                "first_tale.journey_reported",
                tale.continuation.as_ref().unwrap().target_actor_id,
            ),
            Some(FirstTaleStage::ReturnArrived) => (
                "first_tale.journey_returned",
                tale.presentation.as_ref().unwrap().requester_actor_id,
            ),
            _ => {
                self.save_journey_record(actor_id, &record);
                return Vec::new();
            }
        };
        if notice.target_actor_id != Some(target_id) {
            self.save_journey_record(actor_id, &record);
            return Vec::new();
        }
        let recognition = self.journey_recognition(actor_id, target_id, &record);
        let mut returned = self.append_async_job_event(
            event_type,
            actor_id,
            Some(target_id),
            Some(recognition.clone()),
        );
        returned.caused_by_event_seq = Some(notice.seq);
        self.replace_projected_event(&returned);
        if event_type == "first_tale.journey_reported" {
            record.report_event_seq = Some(returned.seq);
        } else {
            record.return_event_seq = Some(returned.seq);
            record.recognition = Some(recognition);
            record.next_job_id = self
                .journey_next_request(actor_id, &record)
                .map(|request| request.job_id);
        }
        self.save_journey_record(actor_id, &record);
        vec![returned]
    }

    fn journey_outcome(&self) -> String {
        let Some(job) = self.journey_job() else {
            return String::new();
        };
        match self.job_status(job).as_str() {
            "completed" => format!("The shared work is complete. {}", job.memory_summary),
            "failed" => format!(
                "The road changed: {}.",
                job.consequence.trim_end_matches('.')
            ),
            _ => String::new(),
        }
    }

    fn journey_recognition(&self, actor_id: u64, target_id: u64, record: &JourneyRecord) -> String {
        let name = self
            .actor_name(target_id)
            .unwrap_or_else(|| "Your host".to_string());
        let traveler = self
            .actor_name(actor_id)
            .unwrap_or_else(|| "the traveler".to_string());
        if record.contributions.is_empty() {
            format!(
                "{name} welcomes {traveler}’s road news. {}",
                self.journey_outcome()
            )
        } else {
            let steps = record
                .contributions
                .values()
                .cloned()
                .collect::<BTreeSet<_>>()
                .into_iter()
                .collect::<Vec<_>>()
                .join("; ");
            format!(
                "{name} remembers {traveler}’s part: {steps}. {}",
                self.journey_outcome()
            )
        }
    }

    pub(crate) fn first_tale_journey_resident_memory(
        &self,
        resident_id: u64,
        actor_id: u64,
    ) -> Option<String> {
        let tale = active_first_tale()?;
        let record = self.journey_record(actor_id);
        let recognized = (resident_id == tale.presentation.as_ref()?.requester_actor_id
            && record.return_event_seq.is_some())
            || (resident_id == tale.continuation.as_ref()?.target_actor_id
                && record.report_event_seq.is_some());
        recognized.then(|| {
            format!(
                "{}: {}",
                self.actor_name(actor_id)
                    .unwrap_or_else(|| "The traveler".to_string()),
                if resident_id == tale.presentation.as_ref().unwrap().requester_actor_id {
                    record.recognition.clone().unwrap_or_default()
                } else {
                    self.journey_recognition(actor_id, resident_id, &record)
                }
            )
        })
    }

    fn journey_route_step(&self, from_location_id: u64, destination: u64) -> Option<u64> {
        let mut visited = BTreeSet::from([from_location_id]);
        let mut queue = VecDeque::from([(from_location_id, None)]);
        while let Some((location_id, first_step)) = queue.pop_front() {
            let mut next_locations = self.world.exits[..self.world.exit_count]
                .iter()
                .filter(|exit| {
                    exit.from_location_id == location_id && exit.flags & CW_EXIT_LOCKED == 0
                })
                .filter(|exit| {
                    !self.generated_pathways.values().any(|pathway| {
                        !pathway.waypoints.is_empty()
                            && ((pathway.origin_location_id == exit.from_location_id
                                && pathway.destination_location_id == exit.to_location_id)
                                || (pathway.destination_location_id == exit.from_location_id
                                    && pathway.origin_location_id == exit.to_location_id))
                    })
                })
                .map(|exit| exit.to_location_id)
                .collect::<Vec<_>>();
            // A discovered long road keeps its later landmarks in the plan.
            // Each unrevealed segment still needs its legal Scout card.
            for pathway in self.generated_pathways.values() {
                let path = std::iter::once(pathway.origin_location_id)
                    .chain(pathway.waypoints.iter().map(|waypoint| waypoint.id))
                    .chain(std::iter::once(pathway.destination_location_id))
                    .collect::<Vec<_>>();
                next_locations.extend(
                    path.windows(2)
                        .filter(|edge| edge[0] == location_id)
                        .map(|edge| edge[1]),
                );
            }
            for next_location in next_locations {
                if visited.insert(next_location) {
                    let next_step = first_step.unwrap_or(next_location);
                    if next_location == destination {
                        return Some(next_step);
                    }
                    queue.push_back((next_location, Some(next_step)));
                }
            }
        }
        None
    }

    fn journey_next_request(
        &self,
        actor_id: u64,
        record: &JourneyRecord,
    ) -> Option<JourneyNextRequestView> {
        let tale = active_first_tale()?;
        let actor = self.actor_by_id(actor_id)?;
        let continuation = tale.continuation.as_ref()?;
        let mut choices = Vec::new();
        for job in self.jobs.values().filter(|job| {
            job.id != tale.job_id
                && job.id != continuation.job_id
                && self.job_status(job) == "active"
                && job.delivery.is_none()
                && !job.contribution_strategies.is_empty()
        }) {
            // A follow-up starts with a current authored task whose first work
            // needs only presence. More elaborate campaigns keep their own leads.
            for location_id in &job.location_ids {
                if !job.contribution_strategies.iter().any(|strategy| self.contribution_strategy_binding_is_active(strategy)
                    && strategy.baseline_progress > 0
                        && strategy.action_kind == "work"
                        && strategy.claim_policy == ContributionClaimPolicy::Repeatable
                        && strategy.target.kind == "job"
                        && strategy.target.id.as_deref() == Some(job.id.as_str()) && strategy.requirements.iter().all(|requirement| matches!(requirement,
                        ContributionRequirement::AtLocation { location_id: id } if id == location_id))) { continue; }
                if *location_id != actor.location_id
                    && self
                        .journey_route_step(actor.location_id, *location_id)
                        .is_none()
                {
                    continue;
                }
                choices.push((
                    record.next_job_id.as_deref() != Some(job.id.as_str()),
                    job.id.clone(),
                    *location_id,
                    job,
                ));
            }
        }
        choices.sort_by(|a, b| (&a.0, &a.1, a.2).cmp(&(&b.0, &b.1, b.2)));
        let (_, _, destination_location_id, job) = choices.first()?;
        Some(JourneyNextRequestView {
            job_id: job.id.clone(),
            destination_location_id: *destination_location_id,
            question: job.premise.clone(),
        })
    }

    fn journey_work_requirement(&self, actor_id: u64) -> Option<&ContributionRequirement> {
        self.journey_job()?
            .contribution_strategies
            .iter()
            .find(|strategy| strategy.action_kind == "work")?
            .requirements
            .iter()
            .find(|requirement| {
                !matches!(requirement, ContributionRequirement::AtLocation { .. })
                    && !self.contribution_requirement_met(actor_id, requirement)
            })
    }

    fn journey_rest_destination(&self, actor_id: u64, stage: FirstTaleStage) -> Option<u64> {
        if !matches!(
            stage,
            FirstTaleStage::ContinuationAccepted | FirstTaleStage::NextRequest
        ) || !self.tired_tag_active(actor_id)
        {
            return None;
        }
        let location_id = self.actor_by_id(actor_id)?.location_id;
        let mut visited = BTreeSet::from([location_id]);
        let mut queue = VecDeque::from([location_id]);
        while let Some(location_id) = queue.pop_front() {
            if self.rest_entitlement_at(actor_id, location_id).grade != CW_REST_GRADE_NONE {
                return Some(location_id);
            }
            for exit in self.world.exits[..self.world.exit_count]
                .iter()
                .filter(|exit| {
                    exit.from_location_id == location_id && exit.flags & CW_EXIT_LOCKED == 0
                })
            {
                if visited.insert(exit.to_location_id) {
                    queue.push_back(exit.to_location_id);
                }
            }
        }
        None
    }

    pub(crate) fn first_tale_journey_destination(
        &self,
        actor_id: u64,
        stage: FirstTaleStage,
    ) -> Option<u64> {
        let tale = active_first_tale()?;
        if let Some(destination) = self.journey_rest_destination(actor_id, stage) {
            return Some(destination);
        }
        match stage {
            FirstTaleStage::ContinuationReportTravel | FirstTaleStage::ContinuationReport => self
                .actor_by_id(tale.continuation.as_ref()?.target_actor_id)
                .map(|actor| actor.location_id),
            FirstTaleStage::ReturnTravel | FirstTaleStage::ReturnArrived => self
                .actor_by_id(tale.presentation.as_ref()?.requester_actor_id)
                .map(|actor| actor.location_id),
            FirstTaleStage::NextRequest => self
                .journey_next_request(actor_id, &self.journey_record(actor_id))
                .map(|request| request.destination_location_id),
            FirstTaleStage::ContinuationAccepted => match self.journey_work_requirement(actor_id) {
                Some(
                    ContributionRequirement::FeatureSearched { location_id, .. }
                    | ContributionRequirement::FeatureUsed { location_id, .. }
                    | ContributionRequirement::RoomFeature { location_id, .. },
                ) => Some(*location_id),
                Some(ContributionRequirement::EncounterResolved { job_id, .. }) => self
                    .combat_encounter(combat_encounter_id(job_id))
                    .map(|encounter| encounter.location_id)
                    .or_else(|| {
                        let job = self.jobs.get(job_id)?;
                        job.location_ids.iter().copied().find(|location_id| {
                            active_content().locations.iter().any(|location| {
                                location.id == *location_id && location.allow_combat
                            }) && job.participant_ids.iter().any(|target_id| {
                                self.actor_by_id(*target_id)
                                    .is_some_and(|target| target.location_id == *location_id)
                            })
                        })
                    }),
                _ => self
                    .journey_job()?
                    .contribution_strategies
                    .iter()
                    .flat_map(|strategy| &strategy.requirements)
                    .find_map(|requirement| match requirement {
                        ContributionRequirement::AtLocation { location_id } => Some(*location_id),
                        _ => None,
                    }),
            },
            _ => None,
        }
    }

    pub(crate) fn first_tale_journey_offer_advances(
        &self,
        actor_id: u64,
        stage: FirstTaleStage,
        offer: &RankedActionOffer,
    ) -> bool {
        let Some(actor) = self.actor_by_id(actor_id) else {
            return false;
        };
        let Some(destination) = self.first_tale_journey_destination(actor_id, stage) else {
            return false;
        };
        let target_id = offer.target.as_ref().and_then(|target| target.id);
        if actor.location_id != destination {
            let next = self.journey_route_step(actor.location_id, destination);
            let scouts_next_segment = offer.kind == "explore_path"
                && self.generated_pathways.values().any(|pathway| {
                    if target_id != Some(pathway.destination_location_id) {
                        return false;
                    }
                    let path = std::iter::once(pathway.origin_location_id)
                        .chain(pathway.waypoints.iter().map(|waypoint| waypoint.id))
                        .chain(std::iter::once(pathway.destination_location_id))
                        .collect::<Vec<_>>();
                    path.windows(2)
                        .any(|edge| edge[0] == actor.location_id && Some(edge[1]) == next)
                });
            return ((offer.kind == "move" || offer.kind == "explore_path") && target_id == next)
                || scouts_next_segment;
        }
        if self.journey_rest_destination(actor_id, stage).is_some() {
            return offer.kind == "rest";
        }
        let tale = active_first_tale().unwrap();
        match stage {
            FirstTaleStage::ContinuationReport => {
                offer.kind == NOTICE_ACTOR_OFFER_KIND
                    && target_id == Some(tale.continuation.as_ref().unwrap().target_actor_id)
            }
            FirstTaleStage::ReturnArrived => {
                offer.kind == NOTICE_ACTOR_OFFER_KIND
                    && target_id == Some(tale.presentation.as_ref().unwrap().requester_actor_id)
            }
            FirstTaleStage::NextRequest => {
                offer.kind != "prepare"
                    && offer.project.as_ref().is_some_and(|project| {
                        self.journey_next_request(actor_id, &self.journey_record(actor_id))
                            .is_some_and(|request| request.job_id == project.id)
                    })
            }
            FirstTaleStage::ContinuationAccepted => {
                if offer
                    .project
                    .as_ref()
                    .is_some_and(|project| project.id == tale.continuation.as_ref().unwrap().job_id)
                    && offer.kind != "prepare"
                {
                    return true;
                }
                match self.journey_work_requirement(actor_id) {
                    Some(ContributionRequirement::FeatureSearched {
                        location_id,
                        feature_key,
                    }) => {
                        offer.kind == "search"
                            && offer
                                .target
                                .as_ref()
                                .and_then(|target| target.label.as_ref())
                                == Some(&self.journey_feature_name(*location_id, feature_key))
                    }
                    Some(ContributionRequirement::FeatureUsed {
                        location_id,
                        feature_key,
                        item_id,
                    }) => {
                        offer.id == format!("use_feature:{item_id}:{location_id}:{feature_key}")
                            || (offer.kind == "search"
                                && self
                                    .item_by_id(*item_id)
                                    .is_none_or(|item| item.holder_actor_id != actor_id))
                            || (offer.kind == "pick_up" && target_id == Some(*item_id))
                    }
                    Some(ContributionRequirement::EncounterResolved { .. }) => {
                        matches!(offer.kind.as_str(), "attack" | "defend" | "dodge")
                    }
                    _ => false,
                }
            }
            _ => false,
        }
    }

    pub(crate) fn first_tale_journey_view(
        &self,
        actor_id: u64,
        stage: FirstTaleStage,
        advancing: Option<&RankedActionOffer>,
    ) -> Option<FirstTaleJourneyView> {
        stage.continuation_phase()?;
        let job = self.journey_job()?;
        let tale = active_first_tale()?;
        if stage == FirstTaleStage::ContinuationTravel
            && self.actor_by_id(actor_id)?.location_id == tale.destination_location_id
        {
            return None;
        }
        let record = self.journey_record(actor_id);
        let next_request = (record.return_event_seq.is_some()
            && record.next_started_event_seq.is_none())
        .then(|| self.journey_next_request(actor_id, &record))
        .flatten();
        let target_name = |id| {
            self.actor_name(id)
                .unwrap_or_else(|| "your host".to_string())
        };
        let instruction = if let Some(location_id) = self.journey_rest_destination(actor_id, stage)
        {
            format!(
                "Rest at {}. Then resume your next step.",
                self.location_name(location_id)
                    .unwrap_or_else(|| "the nearest shelter".to_string())
            )
        } else {
            match stage {
                FirstTaleStage::ContinuationTravel => {
                    tale.continuation.as_ref()?.travel_instruction.clone()
                }
                FirstTaleStage::ContinuationArrived => {
                    tale.continuation.as_ref()?.arrival_instruction.clone()
                }
                FirstTaleStage::ContinuationReportTravel | FirstTaleStage::ContinuationReport => {
                    format!(
                        "Bring your road news to {}.",
                        target_name(tale.continuation.as_ref()?.target_actor_id)
                    )
                }
                FirstTaleStage::ReturnTravel | FirstTaleStage::ReturnArrived => format!(
                    "Return to {} with the road's news.",
                    target_name(tale.presentation.as_ref()?.requester_actor_id)
                ),
                FirstTaleStage::NextRequest => format!(
                    "Visit {}. {}",
                    self.location_name(next_request.as_ref()?.destination_location_id)
                        .unwrap_or_else(|| "the next place".to_string()),
                    next_request.as_ref()?.question
                ),
                FirstTaleStage::JourneyComplete if record.next_started_event_seq.is_some() => {
                    "Your next adventure has begun. Rati keeps your road story.".to_string()
                }
                FirstTaleStage::JourneyComplete => format!(
                    "Rest at the cottage. {} keeps your road story.",
                    target_name(tale.presentation.as_ref()?.requester_actor_id)
                ),
                _ => self
                    .first_tale_journey_destination(actor_id, stage)
                    .map(|location_id| {
                        format!(
                            "Follow the keeper's trail to {}.",
                            self.location_name(location_id)
                                .unwrap_or_else(|| "the next lamp".to_string())
                        )
                    })
                    .unwrap_or_else(|| {
                        tale.continuation
                            .as_ref()
                            .unwrap()
                            .accepted_instruction
                            .clone()
                    }),
            }
        };
        let instruction = advancing
            .map(|offer| format!("{instruction} Next: {}.", offer.label.trim_end_matches('.')))
            .unwrap_or(instruction);
        let clock = self.clocks.get(&job.progress_clock_id)?;
        Some(FirstTaleJourneyView {
            title: if let Some(next) = &next_request {
                self.jobs
                    .get(&next.job_id)
                    .map(|job| job.action_copy.label.clone())
                    .filter(|label| !label.is_empty())
                    .unwrap_or_else(|| next.question.clone())
            } else if matches!(
                stage,
                FirstTaleStage::ContinuationTravel
                    | FirstTaleStage::ContinuationArrived
                    | FirstTaleStage::ContinuationAccepted
            ) {
                job.action_copy.label.clone()
            } else {
                format!(
                    "The road back to {}",
                    target_name(tale.presentation.as_ref()?.requester_actor_id)
                )
            },
            premise: next_request
                .as_ref()
                .map(|request| request.question.clone())
                .unwrap_or_else(|| job.premise.clone()),
            instruction,
            outcome: self.journey_outcome(),
            recognition: record.recognition,
            contributions: record
                .contributions
                .values()
                .cloned()
                .collect::<BTreeSet<_>>()
                .into_iter()
                .collect(),
            shared_progress: clock.filled.min(clock.segments),
            shared_goal: clock.segments,
            next_request,
        })
    }

    pub(crate) fn first_tale_journey_source_event_seq(&self, actor_id: u64) -> u64 {
        let record = self.journey_record(actor_id);
        let source = record
            .next_started_event_seq
            .or(record.return_event_seq)
            .or(record.report_event_seq)
            .unwrap_or_default();
        let evidence = self
            .journey_job()
            .into_iter()
            .flat_map(|job| &job.contribution_strategies)
            .flat_map(|strategy| &strategy.requirements)
            .filter_map(|requirement| self.contribution_requirement_source_event_seq(requirement))
            .max()
            .unwrap_or_default();
        source
            .max(evidence)
            .max(self.journey_closed_event_seq().unwrap_or_default())
            .max(
                record
                    .contributions
                    .keys()
                    .next_back()
                    .copied()
                    .unwrap_or_default(),
            )
    }
}

#[cfg(test)]
#[path = "first_tale_journey_tests.rs"]
mod tests;
