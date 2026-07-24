use super::*;

pub(super) const GOVERNANCE_SCHEMA_VERSION: u8 = 1;
const MAX_GOVERNANCE_ALTERNATIVES: usize = 8;

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub(super) enum GovernanceDecisionStatus {
    Open,
    Selected,
    Closed,
    Invalidated,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub(super) enum GovernanceAlternativeStatus {
    Open,
    Selected,
    Closed,
    Invalidated,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub(super) enum GovernancePolicy {
    NamedChooser {
        #[serde(default, skip_serializing_if = "Option::is_none")]
        chooser_actor_id: Option<u64>,
        chooser_rule: String,
        allow_explicit_delegation: bool,
    },
    CovenantMembers {
        covenant_id: String,
        member_actor_ids: Vec<u64>,
        quorum: u16,
        allow_explicit_delegation: bool,
    },
    CompetingProjects {
        eligible_actor_ids: Vec<u64>,
        support_threshold: u16,
    },
    DelegatedDecision {
        delegator_actor_id: u64,
        delegate_actor_id: u64,
    },
    AuthoredAutomatic {
        alternative_id: String,
    },
}

impl GovernancePolicy {
    pub(super) fn kind(&self) -> &'static str {
        match self {
            Self::NamedChooser { .. } => "named_chooser",
            Self::CovenantMembers { .. } => "covenant_members",
            Self::CompetingProjects { .. } => "competing_projects",
            Self::DelegatedDecision { .. } => "delegated_decision",
            Self::AuthoredAutomatic { .. } => "authored_automatic",
        }
    }
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub(super) struct GovernanceAlternativeState {
    pub(super) id: String,
    pub(super) label: String,
    pub(super) expected_consequence: String,
    pub(super) incompatible_alternative_ids: Vec<String>,
    pub(super) status: GovernanceAlternativeStatus,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(super) closed_reason: Option<String>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub(super) struct GovernanceSupportRecord {
    pub(super) actor_id: u64,
    pub(super) alternative_id: String,
    pub(super) event_seq: u64,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub(super) struct GovernanceDelegationRecord {
    pub(super) delegated_by_actor_id: u64,
    pub(super) delegated_to_actor_id: u64,
    pub(super) event_seq: u64,
    pub(super) active: bool,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub(super) struct GovernanceSelectionRecord {
    pub(super) alternative_id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(super) selected_by_actor_id: Option<u64>,
    pub(super) event_seq: u64,
    pub(super) reason: String,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub(super) struct GovernanceClosurePolicy {
    pub(super) contribution_disposition: String,
    pub(super) refund_policy: String,
    pub(super) permanence: String,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub(super) struct GovernanceDecisionState {
    pub(super) schema_version: u8,
    pub(super) id: String,
    pub(super) location_id: u64,
    pub(super) subject_kind: String,
    pub(super) subject_id: String,
    pub(super) policy: GovernancePolicy,
    pub(super) alternatives: Vec<GovernanceAlternativeState>,
    #[serde(default)]
    pub(super) support: Vec<GovernanceSupportRecord>,
    #[serde(default)]
    pub(super) delegations: Vec<GovernanceDelegationRecord>,
    pub(super) closure: GovernanceClosurePolicy,
    pub(super) status: GovernanceDecisionStatus,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(super) selection: Option<GovernanceSelectionRecord>,
    pub(super) opened_event_seq: u64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(super) updated_event_seq: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(super) review_after_world_tick: Option<u64>,
    pub(super) timeout_behavior: String,
    pub(super) late_arrival_opportunity: String,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub(super) enum GovernanceAction {
    Support {
        decision_id: String,
        alternative_id: String,
    },
    Select {
        decision_id: String,
        alternative_id: String,
    },
    Delegate {
        decision_id: String,
        delegate_actor_id: u64,
    },
}

impl GovernanceAction {
    pub(super) fn decision_id(&self) -> &str {
        match self {
            Self::Support { decision_id, .. }
            | Self::Select { decision_id, .. }
            | Self::Delegate { decision_id, .. } => decision_id,
        }
    }
}

#[derive(Clone, Debug, Serialize)]
pub(super) struct GovernanceAlternativeView {
    pub(super) id: String,
    pub(super) label: String,
    pub(super) expected_consequence: String,
    pub(super) incompatible_alternative_ids: Vec<String>,
    pub(super) status: GovernanceAlternativeStatus,
    pub(super) closed_reason: Option<String>,
    pub(super) supporter_actor_ids: Vec<u64>,
    pub(super) supporter_names: Vec<String>,
}

#[derive(Clone, Debug, Serialize)]
pub(super) struct GovernanceDelegationView {
    pub(super) delegated_by_actor_id: u64,
    pub(super) delegated_by_name: String,
    pub(super) delegated_to_actor_id: u64,
    pub(super) delegated_to_name: String,
    pub(super) event_seq: u64,
}

#[derive(Clone, Debug, Serialize)]
pub(super) struct GovernanceDecisionView {
    pub(super) schema_version: u8,
    pub(super) id: String,
    pub(super) location_id: u64,
    pub(super) subject_kind: String,
    pub(super) subject_id: String,
    pub(super) status: GovernanceDecisionStatus,
    pub(super) policy_kind: String,
    pub(super) policy_summary: String,
    pub(super) authorized_actor_ids: Vec<u64>,
    pub(super) authorized_actor_names: Vec<String>,
    pub(super) quorum: Option<u16>,
    pub(super) support_threshold: Option<u16>,
    pub(super) alternatives: Vec<GovernanceAlternativeView>,
    pub(super) delegations: Vec<GovernanceDelegationView>,
    pub(super) selection: Option<GovernanceSelectionRecord>,
    pub(super) contribution_disposition: String,
    pub(super) refund_policy: String,
    pub(super) permanence: String,
    pub(super) timeout_behavior: String,
    pub(super) late_arrival_opportunity: String,
    pub(super) opened_event_seq: u64,
    pub(super) updated_event_seq: Option<u64>,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(super) enum GovernanceSyncOutcome {
    Unchanged,
    Opened,
    Updated,
}

pub(super) fn generated_building_governance_decision_id(location_id: u64) -> String {
    format!("generated-place:{location_id}:founding-building")
}

fn building_choice_label(archetype_id: &str) -> String {
    archetype_id
        .split('_')
        .filter(|part| !part.is_empty())
        .map(|part| {
            let mut chars = part.chars();
            chars
                .next()
                .map(|first| first.to_uppercase().collect::<String>() + chars.as_str())
                .unwrap_or_default()
        })
        .collect::<Vec<_>>()
        .join(" ")
}

fn building_choice_consequence(archetype_id: &str) -> String {
    match archetype_id {
        "dwelling" | "cosy_cottage" => {
            "Construction can establish a home and its explicitly authored hospitality."
        }
        "waystation" => {
            "Construction can open route support, deliveries, and traveler opportunities."
        }
        "workshop" => {
            "Construction can make declared transformations and repair work available here."
        }
        "fishery" => "Construction can open fishing quests and a named public catch cache.",
        "mine" => "Construction can open mineral quests without creating passive cargo.",
        "kiln" => "Construction can open declared pottery and building-component recipes.",
        "watermill" => "Construction can open water-powered work authored for this place.",
        "windmill" => "Construction can open wind-powered work authored for this place.",
        "archive" => "Construction can open lore investigations and durable public traces.",
        "garden" | "conservatory" => {
            "Construction can open cultivation and stewardship opportunities."
        }
        _ => "Construction can open only the capabilities declared by this building.",
    }
    .to_string()
}

fn governance_alternatives(
    eligible_archetype_ids: &[String],
    selected: Option<&str>,
) -> Vec<GovernanceAlternativeState> {
    let mut ids = eligible_archetype_ids.to_vec();
    ids.sort();
    ids.dedup();
    ids.truncate(MAX_GOVERNANCE_ALTERNATIVES);
    ids.iter()
        .map(|id| GovernanceAlternativeState {
            id: id.clone(),
            label: building_choice_label(id),
            expected_consequence: building_choice_consequence(id),
            incompatible_alternative_ids: ids
                .iter()
                .filter(|other| *other != id)
                .cloned()
                .collect(),
            status: if selected == Some(id.as_str()) {
                GovernanceAlternativeStatus::Selected
            } else if selected.is_some() {
                GovernanceAlternativeStatus::Closed
            } else {
                GovernanceAlternativeStatus::Open
            },
            closed_reason: selected
                .filter(|selected_id| *selected_id != id)
                .map(|selected_id| format!("{selected_id} claimed the founding footprint")),
        })
        .collect()
}

fn alternative_is_open(decision: &GovernanceDecisionState, alternative_id: &str) -> bool {
    decision.alternatives.iter().any(|alternative| {
        alternative.id == alternative_id && alternative.status == GovernanceAlternativeStatus::Open
    })
}

fn active_delegate_for(
    decision: &GovernanceDecisionState,
    delegator_actor_id: u64,
    actor_id: u64,
) -> bool {
    decision.delegations.iter().rev().any(|delegation| {
        delegation.active
            && delegation.delegated_by_actor_id == delegator_actor_id
            && delegation.delegated_to_actor_id == actor_id
    })
}

fn direct_policy_authority(decision: &GovernanceDecisionState, actor_id: u64) -> bool {
    match &decision.policy {
        GovernancePolicy::NamedChooser {
            chooser_actor_id, ..
        } => chooser_actor_id.is_some_and(|chooser| {
            chooser == actor_id || active_delegate_for(decision, chooser, actor_id)
        }),
        GovernancePolicy::CovenantMembers {
            member_actor_ids, ..
        } => {
            member_actor_ids.contains(&actor_id)
                || member_actor_ids
                    .iter()
                    .any(|member| active_delegate_for(decision, *member, actor_id))
        }
        GovernancePolicy::CompetingProjects {
            eligible_actor_ids, ..
        } => eligible_actor_ids.is_empty() || eligible_actor_ids.contains(&actor_id),
        GovernancePolicy::DelegatedDecision {
            delegate_actor_id, ..
        } => *delegate_actor_id == actor_id,
        GovernancePolicy::AuthoredAutomatic { .. } => false,
    }
}

fn inference_has_explicit_authority(decision: &GovernanceDecisionState, actor_id: u64) -> bool {
    match &decision.policy {
        GovernancePolicy::DelegatedDecision {
            delegate_actor_id, ..
        } => *delegate_actor_id == actor_id,
        GovernancePolicy::CompetingProjects {
            eligible_actor_ids, ..
        } => eligible_actor_ids.contains(&actor_id),
        GovernancePolicy::NamedChooser {
            chooser_actor_id, ..
        } => {
            chooser_actor_id.is_some_and(|chooser| active_delegate_for(decision, chooser, actor_id))
        }
        GovernancePolicy::CovenantMembers {
            member_actor_ids, ..
        } => member_actor_ids
            .iter()
            .any(|member| active_delegate_for(decision, *member, actor_id)),
        GovernancePolicy::AuthoredAutomatic { .. } => false,
    }
}

fn support_counts(decision: &GovernanceDecisionState, actor_id: u64) -> bool {
    direct_policy_authority(decision, actor_id)
}

fn threshold_event_seq(
    decision: &GovernanceDecisionState,
    alternative_id: &str,
    threshold: usize,
) -> Option<u64> {
    if threshold == 0 {
        return None;
    }
    let mut earliest_by_actor = BTreeMap::<u64, u64>::new();
    for record in decision.support.iter().filter(|record| {
        record.alternative_id == alternative_id && support_counts(decision, record.actor_id)
    }) {
        earliest_by_actor
            .entry(record.actor_id)
            .and_modify(|event_seq| *event_seq = (*event_seq).min(record.event_seq))
            .or_insert(record.event_seq);
    }
    let mut support = earliest_by_actor
        .into_iter()
        .map(|(actor_id, event_seq)| (event_seq, actor_id))
        .collect::<Vec<_>>();
    support.sort();
    support.get(threshold - 1).map(|(event_seq, _)| *event_seq)
}

fn select_alternative(
    decision: &mut GovernanceDecisionState,
    alternative_id: &str,
    selected_by_actor_id: Option<u64>,
    event_seq: u64,
    reason: &str,
) {
    decision.status = GovernanceDecisionStatus::Selected;
    decision.selection = Some(GovernanceSelectionRecord {
        alternative_id: alternative_id.to_string(),
        selected_by_actor_id,
        event_seq,
        reason: reason.to_string(),
    });
    decision.updated_event_seq = Some(event_seq);
    for alternative in &mut decision.alternatives {
        if alternative.id == alternative_id {
            alternative.status = GovernanceAlternativeStatus::Selected;
            alternative.closed_reason = None;
        } else if alternative.status != GovernanceAlternativeStatus::Invalidated {
            alternative.status = GovernanceAlternativeStatus::Closed;
            alternative.closed_reason =
                Some(format!("{alternative_id} claimed the founding footprint"));
        }
    }
}

fn resolve_supported_choice(
    decision: &mut GovernanceDecisionState,
    event_seq: u64,
) -> Option<String> {
    let threshold = match &decision.policy {
        GovernancePolicy::CovenantMembers { quorum, .. } => usize::from((*quorum).max(1)),
        GovernancePolicy::CompetingProjects {
            support_threshold, ..
        } => usize::from((*support_threshold).max(2)),
        _ => return None,
    };
    let mut candidates = decision
        .alternatives
        .iter()
        .filter(|alternative| alternative.status == GovernanceAlternativeStatus::Open)
        .filter_map(|alternative| {
            threshold_event_seq(decision, &alternative.id, threshold)
                .map(|threshold_seq| (threshold_seq, alternative.id.clone()))
        })
        .collect::<Vec<_>>();
    candidates.sort();
    let (_, alternative_id) = candidates.into_iter().next()?;
    select_alternative(
        decision,
        &alternative_id,
        None,
        event_seq,
        "declared support threshold reached",
    );
    Some(alternative_id)
}

impl RuntimeWorld {
    fn generated_place_named_chooser(&self, location_id: u64) -> Option<u64> {
        let place = self.generated_places.get(&location_id)?;
        let contribution_actors = self
            .clocks
            .get(&place.settlement_clock_id)
            .into_iter()
            .flat_map(|clock| clock.recent_contributions.iter())
            .map(|contribution| (contribution.contribution_event_seq, contribution.actor_id));
        let discoverer = std::iter::once((
            place.discovered_event_seq.unwrap_or(u64::MAX),
            place.discovered_by_actor_id,
        ));
        let present = self.world.actors[..self.world.actor_count]
            .iter()
            .filter(|actor| {
                Self::actor_is_active_avatar(**actor)
                    && actor.location_id == location_id
                    && self.actor_control_mode(actor.id).is_direct_input()
            })
            .map(|actor| (u64::MAX, actor.id));
        contribution_actors
            .chain(discoverer)
            .chain(present)
            .filter(|(_, actor_id)| self.actor_control_mode(*actor_id).is_direct_input())
            .min()
            .map(|(_, actor_id)| actor_id)
    }

    pub(super) fn sync_generated_place_governance(
        &mut self,
        location_id: u64,
        eligible_archetype_ids: &[String],
        opened_event_seq: u64,
    ) -> GovernanceSyncOutcome {
        let decision_id = generated_building_governance_decision_id(location_id);
        let chooser_actor_id = self.generated_place_named_chooser(location_id);
        let Some(existing) = self.governance_decisions.get(&decision_id).cloned() else {
            let decision = GovernanceDecisionState {
                schema_version: GOVERNANCE_SCHEMA_VERSION,
                id: decision_id.clone(),
                location_id,
                subject_kind: "founding_building".to_string(),
                subject_id: location_id.to_string(),
                policy: GovernancePolicy::NamedChooser {
                    chooser_actor_id,
                    chooser_rule: "The earliest directly controlled credited settler chooses; if none was present, the first directly controlled arrival may choose.".to_string(),
                    allow_explicit_delegation: true,
                },
                alternatives: governance_alternatives(eligible_archetype_ids, None),
                support: Vec::new(),
                delegations: Vec::new(),
                closure: GovernanceClosurePolicy {
                    contribution_disposition: "Every support record and later construction contribution keeps public credit.".to_string(),
                    refund_policy: "Founding support moves no item or currency, so closing an alternative has nothing to refund.".to_string(),
                    permanence: "The selected founding footprint stays claimed unless a later authored civic project changes it.".to_string(),
                },
                status: GovernanceDecisionStatus::Open,
                selection: None,
                opened_event_seq,
                updated_event_seq: None,
                review_after_world_tick: None,
                timeout_behavior: "A timeout leaves the decision open and changes no threshold.".to_string(),
                late_arrival_opportunity: "After selection, every avatar may contribute to construction and later stewardship through the same legal action surface.".to_string(),
            };
            self.governance_decisions.insert(decision_id, decision);
            return GovernanceSyncOutcome::Opened;
        };

        if existing.status == GovernanceDecisionStatus::Selected {
            return GovernanceSyncOutcome::Unchanged;
        }

        let mut updated = existing.clone();
        updated.schema_version = GOVERNANCE_SCHEMA_VERSION;
        if let GovernancePolicy::NamedChooser {
            chooser_actor_id: chooser,
            ..
        } = &mut updated.policy
        {
            if chooser.is_none() {
                *chooser = chooser_actor_id;
            }
        }
        let eligible = eligible_archetype_ids
            .iter()
            .cloned()
            .collect::<BTreeSet<_>>();
        for alternative in &mut updated.alternatives {
            if eligible.contains(&alternative.id) {
                if alternative.status == GovernanceAlternativeStatus::Invalidated {
                    alternative.status = GovernanceAlternativeStatus::Open;
                    alternative.closed_reason = None;
                }
            } else if alternative.status == GovernanceAlternativeStatus::Open {
                alternative.status = GovernanceAlternativeStatus::Invalidated;
                alternative.closed_reason =
                    Some("Its authoritative prerequisite is no longer satisfied.".to_string());
            }
        }
        let known = updated
            .alternatives
            .iter()
            .map(|alternative| alternative.id.clone())
            .collect::<BTreeSet<_>>();
        for alternative in governance_alternatives(eligible_archetype_ids, None) {
            if !known.contains(&alternative.id) {
                updated.alternatives.push(alternative);
            }
        }
        updated
            .alternatives
            .sort_by(|left, right| left.id.cmp(&right.id));
        updated.alternatives.truncate(MAX_GOVERNANCE_ALTERNATIVES);
        let active_ids = updated
            .alternatives
            .iter()
            .filter(|alternative| alternative.status == GovernanceAlternativeStatus::Open)
            .map(|alternative| alternative.id.clone())
            .collect::<Vec<_>>();
        for alternative in &mut updated.alternatives {
            alternative.incompatible_alternative_ids = active_ids
                .iter()
                .filter(|other| **other != alternative.id)
                .cloned()
                .collect();
        }
        if updated == existing {
            return GovernanceSyncOutcome::Unchanged;
        }
        self.governance_decisions.insert(decision_id, updated);
        GovernanceSyncOutcome::Updated
    }

    pub(super) fn backfill_generated_place_governance(&mut self) {
        let proposals = self
            .generated_places
            .iter()
            .filter_map(|(location_id, place)| {
                place.building_proposal.as_ref().map(|proposal| {
                    (
                        *location_id,
                        proposal.eligible_archetype_ids.clone(),
                        proposal.opened_event_seq,
                    )
                })
            })
            .collect::<Vec<_>>();
        for (location_id, choices, opened_event_seq) in proposals {
            self.sync_generated_place_governance(location_id, &choices, opened_event_seq);
            let decision_id = generated_building_governance_decision_id(location_id);
            let selected = self
                .governance_decisions
                .get(&decision_id)
                .and_then(|decision| decision.selection.as_ref())
                .map(|selection| selection.alternative_id.clone());
            if let Some(proposal) = self
                .generated_places
                .get_mut(&location_id)
                .and_then(|place| place.building_proposal.as_mut())
            {
                proposal.governance_decision_id = decision_id;
                proposal.selected_archetype_id = selected;
            }
        }
    }

    pub(super) fn current_governance_decision(
        &self,
        location_id: u64,
    ) -> Option<&GovernanceDecisionState> {
        self.governance_decisions
            .values()
            .filter(|decision| decision.location_id == location_id)
            .min_by_key(|decision| {
                (
                    decision.status != GovernanceDecisionStatus::Open,
                    decision.opened_event_seq,
                    decision.id.as_str(),
                )
            })
    }

    pub(super) fn resolve_governance_alternative_id(
        &self,
        decision: &GovernanceDecisionState,
        query: &str,
    ) -> Result<String, String> {
        let key = query.trim().to_ascii_lowercase().replace(['_', '-'], " ");
        if key.is_empty() {
            return Err("Name one of the visible alternatives.".to_string());
        }
        let mut candidates = decision
            .alternatives
            .iter()
            .filter(|alternative| alternative.status == GovernanceAlternativeStatus::Open)
            .filter(|alternative| {
                alternative.id.eq_ignore_ascii_case(query)
                    || alternative.label.eq_ignore_ascii_case(query)
                    || alternative.id.replace('_', " ").to_ascii_lowercase() == key
                    || alternative.label.to_ascii_lowercase().starts_with(&key)
            })
            .collect::<Vec<_>>();
        candidates.sort_by(|left, right| left.id.cmp(&right.id));
        match candidates.as_slice() {
            [alternative] => Ok(alternative.id.clone()),
            [] => Err("That alternative is not open here; try choice.".to_string()),
            _ => Err(
                "More than one alternative matches; use the full name shown by choice.".to_string(),
            ),
        }
    }

    fn governance_actor_is_present(&self, actor_id: u64, location_id: u64) -> bool {
        self.actor_by_id(actor_id).is_some_and(|actor| {
            Self::actor_is_active_avatar(actor) && actor.location_id == location_id
        })
    }

    fn validate_governance_support(
        &self,
        actor_id: u64,
        decision: &GovernanceDecisionState,
        alternative_id: &str,
    ) -> Result<(), String> {
        if !alternative_is_open(decision, alternative_id) {
            return Err("That alternative is not open.".to_string());
        }
        if decision
            .support
            .iter()
            .any(|record| record.actor_id == actor_id && record.alternative_id == alternative_id)
        {
            return Err("Your support for that alternative is already recorded.".to_string());
        }
        match &decision.policy {
            GovernancePolicy::CovenantMembers { .. }
            | GovernancePolicy::CompetingProjects { .. } => {
                if !direct_policy_authority(decision, actor_id) {
                    return Err("This policy does not count your support.".to_string());
                }
            }
            GovernancePolicy::AuthoredAutomatic { .. } => {
                return Err("This authored result has no support step.".to_string());
            }
            _ => {}
        }
        Ok(())
    }

    pub(super) fn validate_governance_action(
        &self,
        actor_id: u64,
        action: &GovernanceAction,
    ) -> Result<(), String> {
        let decision = self
            .governance_decisions
            .get(action.decision_id())
            .ok_or_else(|| "That shared choice is no longer available.".to_string())?;
        if decision.status != GovernanceDecisionStatus::Open {
            return Err("That shared choice is already settled.".to_string());
        }
        if !self.governance_actor_is_present(actor_id, decision.location_id) {
            return Err("Your avatar must be present for this shared choice.".to_string());
        }
        match action {
            GovernanceAction::Support { alternative_id, .. } => {
                self.validate_governance_support(actor_id, decision, alternative_id)
            }
            GovernanceAction::Select { alternative_id, .. } => {
                if !alternative_is_open(decision, alternative_id) {
                    return Err("That alternative is not open.".to_string());
                }
                if matches!(
                    &decision.policy,
                    GovernancePolicy::CovenantMembers { .. }
                        | GovernancePolicy::CompetingProjects { .. }
                ) {
                    return self.validate_governance_support(actor_id, decision, alternative_id);
                }
                if !direct_policy_authority(decision, actor_id) {
                    return Err("This decision names a different chooser.".to_string());
                }
                if self.actor_control_mode(actor_id).uses_inference()
                    && !inference_has_explicit_authority(decision, actor_id)
                {
                    return Err(
                        "An inference controller needs explicit delegation for this lasting choice."
                            .to_string(),
                    );
                }
                Ok(())
            }
            GovernanceAction::Delegate {
                delegate_actor_id, ..
            } => {
                let delegation_allowed = match &decision.policy {
                    GovernancePolicy::NamedChooser {
                        chooser_actor_id,
                        allow_explicit_delegation,
                        ..
                    } => *allow_explicit_delegation && *chooser_actor_id == Some(actor_id),
                    GovernancePolicy::CovenantMembers {
                        member_actor_ids,
                        allow_explicit_delegation,
                        ..
                    } => *allow_explicit_delegation && member_actor_ids.contains(&actor_id),
                    _ => false,
                };
                if !delegation_allowed || self.actor_control_mode(actor_id).uses_inference() {
                    return Err(
                        "This policy does not let your controller delegate the choice.".to_string(),
                    );
                }
                if *delegate_actor_id == actor_id {
                    return Err("Choose another avatar as delegate.".to_string());
                }
                if !self.governance_actor_is_present(*delegate_actor_id, decision.location_id) {
                    return Err("The delegate must be present for the shared choice.".to_string());
                }
                Ok(())
            }
        }
    }

    fn governance_event(
        &mut self,
        event_type: &str,
        actor_id: u64,
        _decision_id: &str,
        location_id: u64,
        content: String,
    ) -> EventView {
        let mut event = self.append_async_job_event(event_type, actor_id, None, Some(content));
        event.location_id = Some(location_id);
        event.location_name = self.location_name(location_id);
        event.content_id = None;
        self.replace_projected_event(&event);
        event
    }

    pub(super) fn apply_governance_action(
        &mut self,
        actor_id: u64,
        action: &GovernanceAction,
    ) -> Vec<EventView> {
        if self.validate_governance_action(actor_id, action).is_err() {
            return Vec::new();
        }
        let decision_id = action.decision_id().to_string();
        let Some(snapshot) = self.governance_decisions.get(&decision_id).cloned() else {
            return Vec::new();
        };
        let location_id = snapshot.location_id;
        let event_seq = self.world.next_event_seq;
        let actor_name = self
            .actor_name(actor_id)
            .unwrap_or_else(|| format!("Avatar {actor_id}"));

        match action {
            GovernanceAction::Support { alternative_id, .. }
            | GovernanceAction::Select { alternative_id, .. }
                if matches!(
                    &snapshot.policy,
                    GovernancePolicy::CovenantMembers { .. }
                        | GovernancePolicy::CompetingProjects { .. }
                ) =>
            {
                let label = snapshot
                    .alternatives
                    .iter()
                    .find(|alternative| alternative.id == *alternative_id)
                    .map(|alternative| alternative.label.clone())
                    .unwrap_or_else(|| building_choice_label(alternative_id));
                let selected = {
                    let decision = self
                        .governance_decisions
                        .get_mut(&decision_id)
                        .expect("validated decision remains available");
                    decision.support.push(GovernanceSupportRecord {
                        actor_id,
                        alternative_id: alternative_id.clone(),
                        event_seq,
                    });
                    decision.updated_event_seq = Some(event_seq);
                    resolve_supported_choice(decision, event_seq)
                };
                let (event_type, content) = if let Some(selected_id) = selected {
                    (
                        "governance.selected",
                        format!(
                            "{} reached the declared support threshold; the other founding alternatives closed with their credit intact.",
                            building_choice_label(&selected_id)
                        ),
                    )
                } else {
                    (
                        "governance.supported",
                        format!("{actor_name} supported {label}; the choice remains open."),
                    )
                };
                vec![self.governance_event(
                    event_type,
                    actor_id,
                    &decision_id,
                    location_id,
                    content,
                )]
            }
            GovernanceAction::Support { alternative_id, .. } => {
                let label = snapshot
                    .alternatives
                    .iter()
                    .find(|alternative| alternative.id == *alternative_id)
                    .map(|alternative| alternative.label.clone())
                    .unwrap_or_else(|| building_choice_label(alternative_id));
                let decision = self
                    .governance_decisions
                    .get_mut(&decision_id)
                    .expect("validated decision remains available");
                decision.support.push(GovernanceSupportRecord {
                    actor_id,
                    alternative_id: alternative_id.clone(),
                    event_seq,
                });
                decision.updated_event_seq = Some(event_seq);
                vec![self.governance_event(
                    "governance.supported",
                    actor_id,
                    &decision_id,
                    location_id,
                    format!("{actor_name} supported {label}; the named choice remains open."),
                )]
            }
            GovernanceAction::Select { alternative_id, .. } => {
                let label = snapshot
                    .alternatives
                    .iter()
                    .find(|alternative| alternative.id == *alternative_id)
                    .map(|alternative| alternative.label.clone())
                    .unwrap_or_else(|| building_choice_label(alternative_id));
                let decision = self
                    .governance_decisions
                    .get_mut(&decision_id)
                    .expect("validated decision remains available");
                select_alternative(
                    decision,
                    alternative_id,
                    Some(actor_id),
                    event_seq,
                    "authorized chooser selected an open alternative",
                );
                vec![self.governance_event(
                    "governance.selected",
                    actor_id,
                    &decision_id,
                    location_id,
                    format!(
                        "{actor_name} chose {label}; the other founding alternatives closed with their credit intact."
                    ),
                )]
            }
            GovernanceAction::Delegate {
                delegate_actor_id, ..
            } => {
                let delegate_name = self
                    .actor_name(*delegate_actor_id)
                    .unwrap_or_else(|| format!("Avatar {delegate_actor_id}"));
                let decision = self
                    .governance_decisions
                    .get_mut(&decision_id)
                    .expect("validated decision remains available");
                for delegation in &mut decision.delegations {
                    if delegation.delegated_by_actor_id == actor_id {
                        delegation.active = false;
                    }
                }
                decision.delegations.push(GovernanceDelegationRecord {
                    delegated_by_actor_id: actor_id,
                    delegated_to_actor_id: *delegate_actor_id,
                    event_seq,
                    active: true,
                });
                decision.updated_event_seq = Some(event_seq);
                vec![self.governance_event(
                    "governance.delegated",
                    actor_id,
                    &decision_id,
                    location_id,
                    format!("{actor_name} delegated this choice to {delegate_name}."),
                )]
            }
        }
    }

    fn governance_authorized_actor_ids(&self, decision: &GovernanceDecisionState) -> Vec<u64> {
        let mut ids = match &decision.policy {
            GovernancePolicy::NamedChooser {
                chooser_actor_id, ..
            } => chooser_actor_id.iter().copied().collect(),
            GovernancePolicy::CovenantMembers {
                member_actor_ids, ..
            }
            | GovernancePolicy::CompetingProjects {
                eligible_actor_ids: member_actor_ids,
                ..
            } => member_actor_ids.clone(),
            GovernancePolicy::DelegatedDecision {
                delegate_actor_id, ..
            } => vec![*delegate_actor_id],
            GovernancePolicy::AuthoredAutomatic { .. } => Vec::new(),
        };
        ids.extend(
            decision
                .delegations
                .iter()
                .filter(|delegation| delegation.active)
                .map(|delegation| delegation.delegated_to_actor_id),
        );
        ids.sort();
        ids.dedup();
        ids
    }

    fn governance_policy_summary(&self, decision: &GovernanceDecisionState) -> String {
        match &decision.policy {
            GovernancePolicy::NamedChooser {
                chooser_actor_id,
                chooser_rule,
                ..
            } => chooser_actor_id
                .and_then(|actor_id| self.actor_name(actor_id))
                .map(|name| format!("{name} is the named chooser; {chooser_rule}"))
                .unwrap_or_else(|| format!("No named chooser is present yet; {chooser_rule}")),
            GovernancePolicy::CovenantMembers {
                covenant_id,
                quorum,
                ..
            } => format!(
                "Members of {covenant_id} resolve the choice when {} distinct authorized support record(s) agree.",
                (*quorum).max(1)
            ),
            GovernancePolicy::CompetingProjects {
                support_threshold,
                ..
            } => format!(
                "The first project to {} distinct authorized support records claims the footprint; ties resolve by event sequence then stable id.",
                (*support_threshold).max(2)
            ),
            GovernancePolicy::DelegatedDecision {
                delegator_actor_id,
                delegate_actor_id,
            } => format!(
                "{} explicitly delegated this bounded choice to {}.",
                self.actor_name(*delegator_actor_id)
                    .unwrap_or_else(|| format!("Avatar {delegator_actor_id}")),
                self.actor_name(*delegate_actor_id)
                    .unwrap_or_else(|| format!("Avatar {delegate_actor_id}"))
            ),
            GovernancePolicy::AuthoredAutomatic { alternative_id } => format!(
                "{} is the single authored result disclosed before contribution.",
                building_choice_label(alternative_id)
            ),
        }
    }

    pub(super) fn governance_decision_view(
        &self,
        decision: &GovernanceDecisionState,
    ) -> GovernanceDecisionView {
        let authorized_actor_ids = self.governance_authorized_actor_ids(decision);
        let authorized_actor_names = authorized_actor_ids
            .iter()
            .map(|actor_id| {
                self.actor_name(*actor_id)
                    .unwrap_or_else(|| format!("Avatar {actor_id}"))
            })
            .collect();
        let alternatives = decision
            .alternatives
            .iter()
            .map(|alternative| {
                let mut supporter_actor_ids = decision
                    .support
                    .iter()
                    .filter(|record| record.alternative_id == alternative.id)
                    .map(|record| record.actor_id)
                    .collect::<Vec<_>>();
                supporter_actor_ids.sort();
                supporter_actor_ids.dedup();
                let supporter_names = supporter_actor_ids
                    .iter()
                    .map(|actor_id| {
                        self.actor_name(*actor_id)
                            .unwrap_or_else(|| format!("Avatar {actor_id}"))
                    })
                    .collect();
                GovernanceAlternativeView {
                    id: alternative.id.clone(),
                    label: alternative.label.clone(),
                    expected_consequence: alternative.expected_consequence.clone(),
                    incompatible_alternative_ids: alternative.incompatible_alternative_ids.clone(),
                    status: alternative.status,
                    closed_reason: alternative.closed_reason.clone(),
                    supporter_actor_ids,
                    supporter_names,
                }
            })
            .collect();
        let delegations = decision
            .delegations
            .iter()
            .filter(|delegation| delegation.active)
            .map(|delegation| GovernanceDelegationView {
                delegated_by_actor_id: delegation.delegated_by_actor_id,
                delegated_by_name: self
                    .actor_name(delegation.delegated_by_actor_id)
                    .unwrap_or_else(|| format!("Avatar {}", delegation.delegated_by_actor_id)),
                delegated_to_actor_id: delegation.delegated_to_actor_id,
                delegated_to_name: self
                    .actor_name(delegation.delegated_to_actor_id)
                    .unwrap_or_else(|| format!("Avatar {}", delegation.delegated_to_actor_id)),
                event_seq: delegation.event_seq,
            })
            .collect();
        let (quorum, support_threshold) = match &decision.policy {
            GovernancePolicy::CovenantMembers { quorum, .. } => (Some((*quorum).max(1)), None),
            GovernancePolicy::CompetingProjects {
                support_threshold, ..
            } => (None, Some((*support_threshold).max(2))),
            _ => (None, None),
        };
        GovernanceDecisionView {
            schema_version: decision.schema_version,
            id: decision.id.clone(),
            location_id: decision.location_id,
            subject_kind: decision.subject_kind.clone(),
            subject_id: decision.subject_id.clone(),
            status: decision.status,
            policy_kind: decision.policy.kind().to_string(),
            policy_summary: self.governance_policy_summary(decision),
            authorized_actor_ids,
            authorized_actor_names,
            quorum,
            support_threshold,
            alternatives,
            delegations,
            selection: decision.selection.clone(),
            contribution_disposition: decision.closure.contribution_disposition.clone(),
            refund_policy: decision.closure.refund_policy.clone(),
            permanence: decision.closure.permanence.clone(),
            timeout_behavior: decision.timeout_behavior.clone(),
            late_arrival_opportunity: decision.late_arrival_opportunity.clone(),
            opened_event_seq: decision.opened_event_seq,
            updated_event_seq: decision.updated_event_seq,
        }
    }

    pub(super) fn governance_decision_views(
        &self,
        location_id: u64,
    ) -> Vec<GovernanceDecisionView> {
        let mut decisions = self
            .governance_decisions
            .values()
            .filter(|decision| decision.location_id == location_id)
            .collect::<Vec<_>>();
        decisions.sort_by_key(|decision| (decision.opened_event_seq, decision.id.as_str()));
        decisions
            .into_iter()
            .map(|decision| self.governance_decision_view(decision))
            .collect()
    }

    pub(super) fn governance_command_output(&self, location_id: u64) -> String {
        let Some(decision) = self.current_governance_decision(location_id) else {
            return "No shared choice is open here.".to_string();
        };
        if let Some(selection) = decision.selection.as_ref() {
            let chooser = selection
                .selected_by_actor_id
                .and_then(|actor_id| self.actor_name(actor_id))
                .unwrap_or_else(|| "the declared policy".to_string());
            return format!(
                "Choice: {} was selected by {chooser}; closed alternatives keep their public support history and construction remains open to every avatar.",
                building_choice_label(&selection.alternative_id)
            );
        }
        let alternatives = decision
            .alternatives
            .iter()
            .filter(|alternative| alternative.status == GovernanceAlternativeStatus::Open)
            .map(|alternative| alternative.label.clone())
            .collect::<Vec<_>>()
            .join(", ");
        format!(
            "Choice: {}; {}; support is public, one selection closes incompatible alternatives, and all credit stays in the Journal.",
            alternatives,
            self.governance_policy_summary(decision).trim_end_matches('.')
        )
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn decision(id: &str, location_id: u64, policy: GovernancePolicy) -> GovernanceDecisionState {
        GovernanceDecisionState {
            schema_version: GOVERNANCE_SCHEMA_VERSION,
            id: id.to_string(),
            location_id,
            subject_kind: "fixture".to_string(),
            subject_id: id.to_string(),
            policy,
            alternatives: governance_alternatives(
                &["archive".to_string(), "fishery".to_string()],
                None,
            ),
            support: Vec::new(),
            delegations: Vec::new(),
            closure: GovernanceClosurePolicy {
                contribution_disposition: "Credit remains public.".to_string(),
                refund_policy: "No value moves.".to_string(),
                permanence: "The fixture choice is durable.".to_string(),
            },
            status: GovernanceDecisionStatus::Open,
            selection: None,
            opened_event_seq: 1,
            updated_event_seq: None,
            review_after_world_tick: None,
            timeout_behavior: "Timeout leaves it open.".to_string(),
            late_arrival_opportunity: "Construction remains open.".to_string(),
        }
    }

    fn place_test_actor(
        runtime: &mut RuntimeWorld,
        actor_id: u64,
        location_id: u64,
        mode: ActorControlMode,
    ) {
        runtime.world.actors[..runtime.world.actor_count]
            .iter_mut()
            .find(|actor| actor.id == actor_id)
            .expect("seed actor exists")
            .location_id = location_id;
        runtime
            .actor_autonomy
            .entry(actor_id)
            .or_default()
            .control_mode = mode;
    }

    #[test]
    fn named_choice_requires_authority_and_explicitly_delegates_inference() {
        let mut runtime = RuntimeWorld::seeded();
        place_test_actor(
            &mut runtime,
            RATI_ACTOR_ID,
            RAIN_SOFT_GARDEN_LOCATION_ID,
            ActorControlMode::DirectInput,
        );
        place_test_actor(
            &mut runtime,
            WHISKERWIND_ACTOR_ID,
            RAIN_SOFT_GARDEN_LOCATION_ID,
            ActorControlMode::LocalAi,
        );
        runtime.governance_decisions.insert(
            "named".to_string(),
            decision(
                "named",
                RAIN_SOFT_GARDEN_LOCATION_ID,
                GovernancePolicy::NamedChooser {
                    chooser_actor_id: Some(RATI_ACTOR_ID),
                    chooser_rule: "The named settler chooses.".to_string(),
                    allow_explicit_delegation: true,
                },
            ),
        );
        let inferred_choice = GovernanceAction::Select {
            decision_id: "named".to_string(),
            alternative_id: "fishery".to_string(),
        };
        assert!(runtime
            .validate_governance_action(WHISKERWIND_ACTOR_ID, &inferred_choice)
            .is_err());
        let delegation = GovernanceAction::Delegate {
            decision_id: "named".to_string(),
            delegate_actor_id: WHISKERWIND_ACTOR_ID,
        };
        assert_eq!(
            runtime
                .apply_governance_action(RATI_ACTOR_ID, &delegation)
                .len(),
            1
        );
        assert!(runtime
            .validate_governance_action(WHISKERWIND_ACTOR_ID, &inferred_choice)
            .is_ok());
        assert_eq!(
            runtime.apply_governance_action(WHISKERWIND_ACTOR_ID, &inferred_choice)[0].type_name,
            "governance.selected"
        );
        assert_eq!(
            runtime.governance_decisions["named"]
                .selection
                .as_ref()
                .map(|selection| selection.alternative_id.as_str()),
            Some("fishery")
        );
    }

    #[test]
    fn competing_projects_resolve_ties_by_event_then_stable_id() {
        let mut fixture = decision(
            "competing",
            RAIN_SOFT_GARDEN_LOCATION_ID,
            GovernancePolicy::CompetingProjects {
                eligible_actor_ids: vec![5000, 5001, 5002, 5003],
                support_threshold: 2,
            },
        );
        fixture.support = vec![
            GovernanceSupportRecord {
                actor_id: 5000,
                alternative_id: "fishery".to_string(),
                event_seq: 10,
            },
            GovernanceSupportRecord {
                actor_id: 5001,
                alternative_id: "fishery".to_string(),
                event_seq: 20,
            },
            GovernanceSupportRecord {
                actor_id: 5002,
                alternative_id: "archive".to_string(),
                event_seq: 11,
            },
            GovernanceSupportRecord {
                actor_id: 5003,
                alternative_id: "archive".to_string(),
                event_seq: 20,
            },
        ];
        assert_eq!(
            resolve_supported_choice(&mut fixture, 20).as_deref(),
            Some("archive")
        );
        assert_eq!(
            fixture
                .selection
                .as_ref()
                .map(|selection| selection.alternative_id.as_str()),
            Some("archive")
        );
        assert_eq!(
            fixture.support.len(),
            4,
            "closing alternatives preserves every support record"
        );
    }

    fn governance_command_request(actor_id: u64, command: &str) -> CommandRequest {
        CommandRequest {
            actor_id,
            actor_session: None,
            command: command.to_string(),
            wallet_address: None,
            wallet: None,
            wallet_session: None,
            owned_card_ids: None,
            cards: None,
            envelope: None,
        }
    }

    #[test]
    fn choice_commands_stay_in_chat_and_use_governed_concurrency() {
        let mut runtime = RuntimeWorld::seeded();
        place_test_actor(
            &mut runtime,
            RATI_ACTOR_ID,
            RAIN_SOFT_GARDEN_LOCATION_ID,
            ActorControlMode::DirectInput,
        );
        place_test_actor(
            &mut runtime,
            WHISKERWIND_ACTOR_ID,
            RAIN_SOFT_GARDEN_LOCATION_ID,
            ActorControlMode::LocalAi,
        );
        runtime.governance_decisions.insert(
            "command-choice".to_string(),
            decision(
                "command-choice",
                RAIN_SOFT_GARDEN_LOCATION_ID,
                GovernancePolicy::NamedChooser {
                    chooser_actor_id: Some(RATI_ACTOR_ID),
                    chooser_rule: "The named settler chooses.".to_string(),
                    allow_explicit_delegation: true,
                },
            ),
        );

        let choice = runtime
            .resolve_command(
                &governance_command_request(RATI_ACTOR_ID, "choice"),
                &AccessContext::default(),
            )
            .expect("choice is a readable chat command");
        let CommandDispatch::Read { output } = choice.dispatch else {
            panic!("choice stays a read command");
        };
        assert!(output.starts_with("Choice:"));
        assert_eq!(output.matches('.').count(), 1);

        let choose = runtime
            .resolve_command(
                &governance_command_request(RATI_ACTOR_ID, "choose fishery"),
                &AccessContext::default(),
            )
            .expect("named chooser receives the command");
        assert_eq!(
            command_concurrency_policy(&choose.dispatch),
            ConcurrencyPolicy::GovernedChoice
        );
        assert!(!command_dispatch_consumes_room_turn(&choose.dispatch));

        assert!(runtime
            .resolve_command(
                &governance_command_request(WHISKERWIND_ACTOR_ID, "choose fishery"),
                &AccessContext::default(),
            )
            .is_err());
        let delegate_name = runtime
            .actor_name(WHISKERWIND_ACTOR_ID)
            .expect("seed delegate has a name");
        let delegate = runtime
            .resolve_command(
                &governance_command_request(
                    RATI_ACTOR_ID,
                    &format!("delegate choice to {delegate_name}"),
                ),
                &AccessContext::default(),
            )
            .expect("named chooser can explicitly delegate in chat");
        let CommandDispatch::Governance { action } = delegate.dispatch else {
            panic!("delegation is a governed command");
        };
        assert_eq!(
            runtime
                .apply_governance_action(RATI_ACTOR_ID, &action)
                .len(),
            1
        );
        assert!(runtime
            .resolve_command(
                &governance_command_request(WHISKERWIND_ACTOR_ID, "choose fishery"),
                &AccessContext::default(),
            )
            .is_ok());
    }

    #[test]
    fn covenant_choice_is_idempotent_replayable_and_snapshot_safe() {
        fn apply(
            runtime: &mut RuntimeWorld,
            actor_id: u64,
            alternative_id: &str,
            seed: u64,
        ) -> Vec<EventView> {
            let mut record = JournalRecord::new(
                CwAction {
                    kind: CW_ACTION_NONE,
                    actor_id,
                    location_id: RAIN_SOFT_GARDEN_LOCATION_ID,
                    ..CwAction::default()
                },
                seed,
            );
            record
                .projection_mutations
                .push(ProjectionMutation::ApplyGovernance {
                    action: GovernanceAction::Support {
                        decision_id: "covenant".to_string(),
                        alternative_id: alternative_id.to_string(),
                    },
                });
            runtime.apply_journal_record(&record).1
        }

        let policy = GovernancePolicy::CovenantMembers {
            covenant_id: "river-friends".to_string(),
            member_actor_ids: vec![RATI_ACTOR_ID, WHISKERWIND_ACTOR_ID],
            quorum: 2,
            allow_explicit_delegation: true,
        };
        let mut runtime = RuntimeWorld::seeded();
        let mut replay = RuntimeWorld::seeded();
        for world in [&mut runtime, &mut replay] {
            place_test_actor(
                world,
                RATI_ACTOR_ID,
                RAIN_SOFT_GARDEN_LOCATION_ID,
                ActorControlMode::DirectInput,
            );
            place_test_actor(
                world,
                WHISKERWIND_ACTOR_ID,
                RAIN_SOFT_GARDEN_LOCATION_ID,
                ActorControlMode::DirectInput,
            );
            world.governance_decisions.insert(
                "covenant".to_string(),
                decision("covenant", RAIN_SOFT_GARDEN_LOCATION_ID, policy.clone()),
            );
        }

        for world in [&mut runtime, &mut replay] {
            let first = apply(world, RATI_ACTOR_ID, "fishery", 55_001);
            assert!(first
                .iter()
                .any(|event| event.type_name == "governance.supported"));
            let retry = apply(world, RATI_ACTOR_ID, "fishery", 55_002);
            assert!(!retry
                .iter()
                .any(|event| event.type_name.starts_with("governance.")));
            let second = apply(world, WHISKERWIND_ACTOR_ID, "fishery", 55_003);
            assert!(second
                .iter()
                .any(|event| event.type_name == "governance.selected"));
            world.presence_states.insert(RATI_ACTOR_ID, false);
            world.presence_states.insert(RATI_ACTOR_ID, true);
            world
                .actors
                .get_mut(&RATI_ACTOR_ID)
                .expect("seed actor metadata exists")
                .title = "A title with no voting weight".to_string();
        }

        assert_eq!(
            serde_json::to_value(runtime.governance_decision_views(RAIN_SOFT_GARDEN_LOCATION_ID))
                .expect("serialize live decision"),
            serde_json::to_value(replay.governance_decision_views(RAIN_SOFT_GARDEN_LOCATION_ID))
                .expect("serialize replayed decision")
        );
        assert_eq!(
            runtime.governance_decisions["covenant"].support.len(),
            2,
            "a retry does not duplicate support"
        );
        let restored = RuntimeSnapshot::from_runtime(&runtime)
            .into_runtime()
            .expect("governance snapshot restores");
        assert_eq!(
            serde_json::to_value(runtime.governance_decision_views(RAIN_SOFT_GARDEN_LOCATION_ID))
                .expect("serialize pre-snapshot decision"),
            serde_json::to_value(restored.governance_decision_views(RAIN_SOFT_GARDEN_LOCATION_ID))
                .expect("serialize restored decision")
        );
    }
}
