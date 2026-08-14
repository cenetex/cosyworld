use super::*;

pub(super) const FIRST_TALE_CONTENT_SCHEMA_VERSION: u8 = 1;

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub(super) struct SeedFirstTaleContent {
    pub(super) schema_version: u8,
    pub(super) lead_location_id: u64,
    pub(super) destination_location_id: u64,
    pub(super) job_id: String,
    pub(super) progress_clock_id: String,
    pub(super) copy: SeedFirstTaleCopy,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(super) continuation: Option<SeedFirstTaleContinuation>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub(super) struct SeedFirstTaleContinuation {
    pub(super) destination_location_id: u64,
    pub(super) target_actor_id: u64,
    pub(super) job_id: String,
    pub(super) travel_instruction: String,
    pub(super) arrival_instruction: String,
    pub(super) accepted_instruction: String,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub(super) struct SeedFirstTaleCopy {
    pub(super) question: String,
    pub(super) notice_instruction: String,
    pub(super) follow_lead_instruction: String,
    pub(super) contribute_instruction: String,
    pub(super) complete_instruction: String,
    pub(super) target_label: String,
    pub(super) consequence: String,
    pub(super) completion_memory: String,
    pub(super) next_invitation: String,
    pub(super) public_trace: String,
}

pub(super) fn active_first_tale() -> Option<&'static SeedFirstTaleContent> {
    first_tale_for_manifest(&active_content().manifest)
}

pub(super) fn first_tale_trace_claim_prefix(actor_id: u64) -> Option<String> {
    Some(format!(
        "first_tale:v{}:actor:{actor_id}:event:",
        active_first_tale()?.schema_version
    ))
}

pub(super) fn first_tale_trace_claim_key(actor_id: u64, event_seq: u64) -> Option<String> {
    Some(format!(
        "{}{event_seq}",
        first_tale_trace_claim_prefix(actor_id)?
    ))
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(super) enum FirstTaleStage {
    Notice,
    ReturnToLead,
    FollowLead,
    ReturnToDestination,
    Contribute,
    Complete,
    ContinuationTravel,
    ContinuationArrived,
    ContinuationAccepted,
}

impl FirstTaleStage {
    pub(super) fn phase(self) -> &'static str {
        match self {
            Self::Notice => "notice",
            Self::ReturnToLead => "return_to_lead",
            Self::FollowLead => "follow_lead",
            Self::ReturnToDestination => "return_to_destination",
            Self::Contribute => "contribute",
            Self::Complete
            | Self::ContinuationTravel
            | Self::ContinuationArrived
            | Self::ContinuationAccepted => "complete",
        }
    }

    pub(super) fn continuation_phase(self) -> Option<&'static str> {
        match self {
            Self::ContinuationTravel => Some("travel"),
            Self::ContinuationArrived => Some("arrived"),
            Self::ContinuationAccepted => Some("accepted"),
            _ => None,
        }
    }
}

impl RuntimeWorld {
    pub(super) fn first_tale_trace_event_seq(&self, actor_id: u64) -> Option<u64> {
        let prefix = first_tale_trace_claim_prefix(actor_id)?;
        self.rpg_claims
            .iter()
            .filter_map(|claim| claim.strip_prefix(&prefix)?.parse::<u64>().ok())
            .min()
    }

    pub(super) fn apply_first_tale_public_trace_projection(
        &mut self,
        action: &CwAction,
        events: &[EventView],
    ) -> Vec<EventView> {
        let Some(first_tale) = active_first_tale() else {
            return Vec::new();
        };
        if self.first_tale_trace_event_seq(action.actor_id).is_some() {
            return Vec::new();
        }
        let contribution = events.iter().find(|event| {
            event.type_name == "job.contribution.resolved"
                && event.actor_id == Some(action.actor_id)
                && event.clock_id.as_deref() == Some(first_tale.progress_clock_id.as_str())
                && event
                    .content
                    .as_deref()
                    .and_then(|content| serde_json::from_str::<JobContributionTrace>(content).ok())
                    .is_some_and(|trace| {
                        trace.job_id == first_tale.job_id
                            && trace.clock_id == first_tale.progress_clock_id
                            && trace.total_progress > 0
                    })
        });
        let latecomer_check = if contribution.is_none()
            && action_is_discovery_check(action)
            && self.listen_attempt_claimed_at(action.actor_id, first_tale.lead_location_id)
            && self
                .clocks
                .get(&first_tale.progress_clock_id)
                .is_some_and(|clock| clock.filled >= clock.segments)
        {
            events.iter().find(|event| {
                event.type_name == "ability_check.rolled"
                    && event.success
                    && event.actor_id == Some(action.actor_id)
                    && event.location_id == Some(first_tale.destination_location_id)
                    && event
                        .total
                        .zip(event.dc)
                        .is_some_and(|(total, dc)| total >= dc)
            })
        } else {
            None
        };
        let Some(cause_event_seq) = contribution
            .map(|event| event.seq)
            .or_else(|| latecomer_check.map(|event| event.seq))
        else {
            return Vec::new();
        };

        let mut trace = self.append_async_job_event(
            "first_tale.public_trace",
            action.actor_id,
            None,
            Some(first_tale.copy.public_trace.clone()),
        );
        trace.caused_by_event_seq = Some(cause_event_seq);
        self.replace_projected_event(&trace);
        if let Some(claim_key) = first_tale_trace_claim_key(action.actor_id, trace.seq) {
            self.rpg_claims.insert(claim_key);
        }
        let mut projected = vec![trace];
        // Truthful actor Notice does not touch growth; completing the tale is
        // the authored reward that funds its relationship continuation.
        if let Some(settlement) = self.bank_visit_ledger(action.actor_id, "first_tale") {
            projected.push(settlement);
        }
        projected
    }

    pub(super) fn first_tale_stage(&self, actor_id: u64) -> Option<FirstTaleStage> {
        let actor = self.actor_by_id(actor_id)?;
        if self.actor_control_mode(actor_id) != ActorControlMode::DirectInput {
            return None;
        }
        let first_tale = active_first_tale()?;
        if self.first_tale_trace_event_seq(actor_id).is_some() {
            let Some(continuation) = first_tale.continuation.as_ref() else {
                return Some(FirstTaleStage::Complete);
            };
            if self
                .active_bond(actor_id, continuation.target_actor_id)
                .is_some()
            {
                return Some(FirstTaleStage::ContinuationAccepted);
            }
            return Some(
                if actor.location_id == continuation.destination_location_id {
                    FirstTaleStage::ContinuationArrived
                } else {
                    FirstTaleStage::ContinuationTravel
                },
            );
        }
        let has_lead = self.listen_attempt_claimed_at(actor_id, first_tale.lead_location_id);
        if !has_lead {
            return Some(if actor.location_id == first_tale.lead_location_id {
                FirstTaleStage::Notice
            } else {
                FirstTaleStage::ReturnToLead
            });
        }
        let destination_reached = self.first_tale_destination_reached(actor_id)
            || actor.location_id == first_tale.destination_location_id;
        if !destination_reached {
            return Some(FirstTaleStage::FollowLead);
        }
        Some(if actor.location_id == first_tale.destination_location_id {
            FirstTaleStage::Contribute
        } else {
            FirstTaleStage::ReturnToDestination
        })
    }

    fn first_tale_offer_advances(
        &self,
        actor_id: u64,
        stage: FirstTaleStage,
        offer: &RankedActionOffer,
    ) -> bool {
        let Some(actor) = self.actor_by_id(actor_id) else {
            return false;
        };
        let Some(first_tale) = active_first_tale() else {
            return false;
        };
        let route_toward = |destination_location_id| {
            let next_location_id =
                self.next_unlocked_step_toward(actor.location_id, destination_location_id);
            (offer.kind == "move"
                && offer.target.as_ref().and_then(|target| target.id) == next_location_id)
                || (offer.kind == "explore_path"
                    && offer
                        .target
                        .as_ref()
                        .and_then(|target| target.id)
                        .is_some_and(|target_id| {
                            Some(target_id) == next_location_id
                                || target_id == destination_location_id
                        }))
        };
        match stage {
            FirstTaleStage::Notice => {
                offer.kind == NOTICE_ACTOR_OFFER_KIND
                    && offer.target.as_ref().is_some_and(|target| {
                        target.kind == "actor"
                            && target
                                .id
                                .and_then(|target_actor_id| self.actor_by_id(target_actor_id))
                                .is_some_and(|target| target.location_id == actor.location_id)
                    })
            }
            FirstTaleStage::ReturnToLead => route_toward(first_tale.lead_location_id),
            FirstTaleStage::FollowLead | FirstTaleStage::ReturnToDestination => {
                route_toward(first_tale.destination_location_id)
            }
            FirstTaleStage::Contribute => {
                let shared_question_complete = self
                    .clocks
                    .get(&first_tale.progress_clock_id)
                    .is_some_and(|clock| clock.filled >= clock.segments);
                (offer.kind != "prepare"
                    && offer.project.as_ref().is_some_and(|project| {
                        project.id == first_tale.job_id
                            && project.progress_clock_id == first_tale.progress_clock_id
                    }))
                    || (shared_question_complete
                        && offer.intention == "inspect"
                        && offer.target.as_ref().and_then(|target| target.id)
                            == Some(first_tale.destination_location_id))
            }
            FirstTaleStage::ContinuationTravel => first_tale
                .continuation
                .as_ref()
                .is_some_and(|continuation| route_toward(continuation.destination_location_id)),
            FirstTaleStage::ContinuationArrived => {
                first_tale
                    .continuation
                    .as_ref()
                    .is_some_and(|continuation| {
                        offer.kind == "create_bond"
                            && offer.target.as_ref().and_then(|target| target.id)
                                == Some(continuation.target_actor_id)
                    })
            }
            FirstTaleStage::Complete | FirstTaleStage::ContinuationAccepted => false,
        }
    }

    pub(super) fn first_tale_advancing_offer_selection(
        &self,
        actor_id: u64,
        offers: &[RankedActionOffer],
    ) -> (Option<String>, BTreeSet<String>) {
        let Some(stage) = self.first_tale_stage(actor_id) else {
            return (None, BTreeSet::new());
        };
        let mut candidates = offers
            .iter()
            .filter(|offer| {
                offer.ranked_hand_eligible
                    && action_offer_is_reachable(offer)
                    && self.first_tale_offer_advances(actor_id, stage, offer)
            })
            .collect::<Vec<_>>();
        candidates.sort_by(|left, right| {
            left.provider
                .priority
                .cmp(&right.provider.priority)
                .then_with(|| left.rank.cmp(&right.rank))
                .then_with(|| left.id.cmp(&right.id))
        });
        (
            candidates.first().map(|offer| offer.offer_id.clone()),
            candidates
                .into_iter()
                .map(|offer| offer.offer_id.clone())
                .collect(),
        )
    }
}

fn first_tale_for_manifest(manifest: &SeedWorldpackManifest) -> Option<&SeedFirstTaleContent> {
    manifest.first_tale.as_ref()
}

#[cfg(test)]
pub(super) fn official_first_tale() -> &'static SeedFirstTaleContent {
    static OFFICIAL_FIRST_TALE: OnceLock<SeedFirstTaleContent> = OnceLock::new();
    OFFICIAL_FIRST_TALE.get_or_init(|| {
        serde_json::from_str(include_str!("../../worlds/official/first-tale.json"))
            .expect("official first-tale source must be valid")
    })
}

pub(super) fn validate_first_tale(first_tale: &SeedFirstTaleContent) -> Result<(), String> {
    if first_tale.schema_version != FIRST_TALE_CONTENT_SCHEMA_VERSION
        || first_tale.lead_location_id == 0
        || first_tale.destination_location_id == 0
        || first_tale.job_id.trim().is_empty()
        || first_tale.progress_clock_id.trim().is_empty()
        || [
            &first_tale.copy.question,
            &first_tale.copy.notice_instruction,
            &first_tale.copy.follow_lead_instruction,
            &first_tale.copy.contribute_instruction,
            &first_tale.copy.complete_instruction,
            &first_tale.copy.target_label,
            &first_tale.copy.consequence,
            &first_tale.copy.completion_memory,
            &first_tale.copy.next_invitation,
            &first_tale.copy.public_trace,
        ]
        .into_iter()
        .any(|line| line.trim().is_empty())
        || first_tale
            .continuation
            .as_ref()
            .is_some_and(|continuation| {
                continuation.destination_location_id == 0
                    || continuation.target_actor_id == 0
                    || continuation.job_id.trim().is_empty()
                    || continuation.travel_instruction.trim().is_empty()
                    || continuation.arrival_instruction.trim().is_empty()
                    || continuation.accepted_instruction.trim().is_empty()
            })
    {
        return Err(format!(
            "invalid first-tale content schema v{}",
            first_tale.schema_version
        ));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn first_tale_action_state(
        runtime: &RuntimeWorld,
        actor_id: u64,
    ) -> (Vec<RankedActionOffer>, ActionHandView, FirstTaleView) {
        let (_, offers) =
            runtime.legal_action_candidates(Some(actor_id), &AccessContext::default());
        let hand = runtime.action_hand_for(Some(actor_id), &offers);
        let view = runtime
            .first_tale_view_with_actions(actor_id, &offers, Some(&hand))
            .expect("first tale projects with its current action authority");
        (offers, hand, view)
    }

    fn advancing_offer<'a>(
        offers: &'a [RankedActionOffer],
        hand: &ActionHandView,
        view: &FirstTaleView,
    ) -> &'a RankedActionOffer {
        let offer_id = view.advancing_offer_id.as_deref().unwrap_or_else(|| {
            panic!(
                "phase {} has no advancing offer among {:?}",
                view.phase,
                offers
                    .iter()
                    .map(|offer| (&offer.kind, &offer.intention, &offer.target, &offer.project))
                    .collect::<Vec<_>>()
            )
        });
        assert_eq!(
            hand.entries
                .iter()
                .filter(|entry| entry.offer_id == offer_id)
                .count(),
            1,
            "the two-card hand contains exactly one advancing offer"
        );
        offers
            .iter()
            .find(|offer| offer.offer_id == offer_id)
            .expect("advancing offer belongs to the authoritative candidate set")
    }

    fn project89_first_tale() -> SeedFirstTaleContent {
        serde_json::from_str(include_str!("../../worlds/project89/first-tale.json"))
            .expect("Project 89 first-tale source")
    }

    #[test]
    fn compiled_manifest_accepts_an_optional_inline_first_tale() {
        let mut manifest = serde_json::from_str::<serde_json::Value>(include_str!(
            "../../content/official/worldpack.json"
        ))
        .expect("official compiled manifest");
        manifest["first_tale"] =
            serde_json::to_value(project89_first_tale()).expect("first tale serializes");

        let manifest = serde_json::from_value::<SeedWorldpackManifest>(manifest)
            .expect("inline first tale parses");
        let first_tale = manifest.first_tale.expect("first tale is retained");
        assert_eq!(first_tale.destination_location_id, 8905);
        assert_eq!(first_tale.job_id, "project89:operation-liberation");
    }

    #[test]
    fn absent_manifest_first_tale_stays_absent() {
        let manifest = serde_json::from_str::<SeedWorldpackManifest>(include_str!(
            "../../content/ruby-high-only/worldpack.json"
        ))
        .expect("Ruby-only compiled manifest");
        assert!(first_tale_for_manifest(&manifest).is_none());
    }

    #[test]
    fn official_source_explicitly_preserves_the_existing_first_tale() {
        let first_tale = official_first_tale();
        validate_first_tale(first_tale).expect("official first tale is valid");
        assert_eq!(first_tale.lead_location_id, COSY_COTTAGE_LOCATION_ID);
        assert_eq!(
            first_tale.destination_location_id,
            RAIN_SOFT_GARDEN_LOCATION_ID
        );
        assert_eq!(first_tale.job_id, FIRST_TALE_JOB_ID);
        assert_eq!(first_tale.progress_clock_id, FIRST_TALE_PROGRESS_CLOCK_ID);
        let continuation = first_tale
            .continuation
            .as_ref()
            .expect("official tale has an authored continuation");
        assert_eq!(continuation.destination_location_id, 800);
        assert_eq!(continuation.target_actor_id, 8301);
        assert_eq!(continuation.job_id, "lantern-keeper:rekindle-the-beacon");
        assert_eq!(
            first_tale.copy.question,
            "Can we make the washed garden path trustworthy before the next visitor?"
        );
    }

    #[test]
    fn project89_owns_its_first_tale_locations_job_and_copy() {
        let first_tale = project89_first_tale();
        validate_first_tale(&first_tale).expect("Project 89 first tale is valid");
        assert_eq!(first_tale.lead_location_id, 8900);
        assert_eq!(first_tale.destination_location_id, 8905);
        assert_eq!(first_tale.job_id, "project89:operation-liberation");
        assert_eq!(first_tale.progress_clock_id, "project89.liberation-signal");
        assert!(first_tale.copy.next_invitation.contains("relay apertures"));
        assert!(!first_tale.copy.question.contains("garden"));
    }

    #[test]
    fn only_source_compositions_that_mount_the_core_tale_declare_it() {
        let core_only: serde_json::Value =
            serde_json::from_str(include_str!("../../worlds/core-only/world.json"))
                .expect("core-only source world");
        let core_ruby: serde_json::Value =
            serde_json::from_str(include_str!("../../worlds/core-ruby/world.json"))
                .expect("core-ruby source world");
        let ruby_only: serde_json::Value =
            serde_json::from_str(include_str!("../../worlds/ruby-high-only/world.json"))
                .expect("Ruby-only source world");
        let services_only: serde_json::Value =
            serde_json::from_str(include_str!("../../worlds/services-only/world.json"))
                .expect("services-only source world");
        let lantern: serde_json::Value =
            serde_json::from_str(include_str!("../../worlds/lantern-keeper/world.json"))
                .expect("Lantern source world");
        assert_eq!(
            core_only.get("first_tale").and_then(|value| value.as_str()),
            Some("../official/first-tale-core.json")
        );
        assert_eq!(
            core_ruby.get("first_tale").and_then(|value| value.as_str()),
            Some("../official/first-tale-core.json")
        );
        assert_eq!(
            lantern.get("first_tale").and_then(|value| value.as_str()),
            Some("../official/first-tale.json")
        );
        assert!(ruby_only.get("first_tale").is_none());
        assert!(services_only.get("first_tale").is_none());
    }

    #[test]
    fn official_tale_deals_each_exact_step_through_mara_acceptance() {
        let actor_id = 5000;
        let mut runtime = RuntimeWorld::seeded();
        create_test_human(
            &mut runtime,
            actor_id,
            COSY_COTTAGE_LOCATION_ID,
            "Lantern-Bound Listener",
        );
        assert!(
            active_first_tale().unwrap().continuation.is_some(),
            "the active official registry mounts its continuation"
        );

        let (offers, hand, view) = first_tale_action_state(&runtime, actor_id);
        assert_eq!(view.phase, "notice");
        assert_eq!(advancing_offer(&offers, &hand, &view).intention, "notice");

        runtime
            .listen_attempt_claims
            .insert(listen_attempt_claim_key(actor_id, COSY_COTTAGE_LOCATION_ID));
        let (offers, hand, view) = first_tale_action_state(&runtime, actor_id);
        assert_eq!(view.phase, "follow_lead");
        assert_eq!(
            advancing_offer(&offers, &hand, &view)
                .target
                .as_ref()
                .and_then(|target| target.id),
            Some(RAIN_SOFT_GARDEN_LOCATION_ID)
        );

        runtime
            .world
            .actors
            .iter_mut()
            .find(|actor| actor.id == actor_id)
            .expect("test actor")
            .location_id = RAIN_SOFT_GARDEN_LOCATION_ID;
        let (offers, hand, view) = first_tale_action_state(&runtime, actor_id);
        let contribution = advancing_offer(&offers, &hand, &view);
        assert_eq!(view.phase, "contribute");
        assert!(matches!(
            contribution.kind.as_str(),
            "check" | "work" | "help"
        ));
        assert_eq!(
            contribution
                .project
                .as_ref()
                .map(|project| project.id.as_str()),
            Some(FIRST_TALE_JOB_ID)
        );

        runtime.rpg_claims.insert(
            first_tale_trace_claim_key(actor_id, 90_001)
                .expect("official trace claim key is available"),
        );
        runtime
            .world
            .actors
            .iter_mut()
            .find(|actor| actor.id == actor_id)
            .expect("test actor")
            .location_id = COSY_COTTAGE_LOCATION_ID;
        let (offers, hand, view) = first_tale_action_state(&runtime, actor_id);
        assert_eq!(view.continuation.as_ref().unwrap().phase, "travel");
        assert_eq!(
            advancing_offer(&offers, &hand, &view)
                .target
                .as_ref()
                .and_then(|target| target.id),
            Some(4),
            "the continuation first routes through Mossbell"
        );

        runtime
            .world
            .actors
            .iter_mut()
            .find(|actor| actor.id == actor_id)
            .expect("test actor")
            .location_id = 4;
        let (offers, hand, view) = first_tale_action_state(&runtime, actor_id);
        let wayside = advancing_offer(&offers, &hand, &view);
        assert_eq!(wayside.kind, "move");
        assert_eq!(
            wayside.target.as_ref().and_then(|target| target.id),
            Some(800)
        );

        runtime
            .world
            .actors
            .iter_mut()
            .find(|actor| actor.id == actor_id)
            .expect("test actor")
            .location_id = 800;
        runtime.ledger_marks.insert(
            "first-tale-lantern-bond-slot".to_string(),
            VisitLedgerMarkState {
                id: "first-tale-lantern-bond-slot".to_string(),
                actor_id,
                category: "learned_truth".to_string(),
                label: "The lamp road reaches Mara's empty key hook.".to_string(),
                source_event_seq: 90_002,
                banked: true,
            },
        );
        let (offers, hand, view) = first_tale_action_state(&runtime, actor_id);
        let mara = advancing_offer(&offers, &hand, &view);
        assert_eq!(view.continuation.as_ref().unwrap().phase, "arrived");
        assert_eq!(mara.kind, "create_bond");
        assert_eq!(
            mara.target.as_ref().and_then(|target| target.id),
            Some(8301)
        );

        runtime.bonds.insert(
            bond_id(actor_id, 8301),
            BondState {
                id: bond_id(actor_id, 8301),
                actor_id,
                target_actor_id: 8301,
                statement: "Mara's request is accepted.".to_string(),
                strength: 1,
                status: "active".to_string(),
                source_event_seq: Some(90_003),
                updated_event_seq: Some(90_003),
                dialogue_status: RELATIONSHIP_DIALOGUE_DELIVERED.to_string(),
                dialogue_event_seq: Some(90_003),
            },
        );
        let accepted = runtime
            .first_tale_view(actor_id)
            .expect("accepted continuation");
        assert_eq!(accepted.continuation.as_ref().unwrap().phase, "accepted");
        assert!(accepted.advancing_offer_id.is_none());
    }

    #[test]
    fn guided_hand_rotates_every_non_advancing_offer() {
        let actor_id = 5000;
        let mut runtime = RuntimeWorld::seeded();
        create_test_human(
            &mut runtime,
            actor_id,
            COSY_COTTAGE_LOCATION_ID,
            "Guided Hand Witness",
        );
        let (_, offers) =
            runtime.legal_action_candidates(Some(actor_id), &AccessContext::default());
        let (advancing_offer_id, advancing_offer_ids) =
            runtime.first_tale_advancing_offer_selection(actor_id, &offers);
        let advancing_offer_id = advancing_offer_id.expect("notice is the pinned first-tale card");
        let expected = offers
            .iter()
            .filter(|offer| {
                offer.ranked_hand_eligible
                    && action_offer_is_reachable(offer)
                    && !advancing_offer_ids.contains(&offer.offer_id)
            })
            .map(|offer| offer.offer_id.clone())
            .collect::<BTreeSet<_>>();
        let mut seen = BTreeSet::new();
        for generation in 0..expected.len().max(1) {
            runtime
                .hand_generations
                .insert(actor_id, u64::try_from(generation).unwrap());
            let hand = runtime.action_hand_for(Some(actor_id), &offers);
            assert_eq!(
                hand.entries.first().map(|entry| entry.offer_id.as_str()),
                Some(advancing_offer_id.as_str())
            );
            seen.extend(
                hand.entries
                    .iter()
                    .skip(1)
                    .map(|entry| entry.offer_id.clone()),
            );
        }
        assert_eq!(seen, expected);
    }

    #[test]
    fn latecomer_can_complete_after_the_shared_first_tale_clock_is_full() {
        let actor_id = 5000;
        let mut runtime = RuntimeWorld::seeded();
        create_test_human(
            &mut runtime,
            actor_id,
            RAIN_SOFT_GARDEN_LOCATION_ID,
            "Late Path Listener",
        );
        runtime
            .listen_attempt_claims
            .insert(listen_attempt_claim_key(actor_id, COSY_COTTAGE_LOCATION_ID));
        let clock = runtime
            .clocks
            .get_mut(FIRST_TALE_PROGRESS_CLOCK_ID)
            .expect("official first-tale clock");
        clock.filled = clock.segments;

        let (offers, hand, view) = first_tale_action_state(&runtime, actor_id);
        assert_eq!(view.phase, "contribute");
        let fallback = advancing_offer(&offers, &hand, &view);
        assert_eq!(fallback.intention, "inspect");
        assert_eq!(
            fallback.target.as_ref().and_then(|target| target.id),
            Some(RAIN_SOFT_GARDEN_LOCATION_ID)
        );

        let action = CwAction {
            kind: CW_ACTION_ABILITY_CHECK,
            actor_id,
            ability: LISTEN_ABILITY,
            dc: LISTEN_DC,
            ..CwAction::default()
        };
        let check = EventView {
            seq: 90_004,
            type_name: "ability_check.rolled".to_string(),
            success: true,
            actor_id: Some(actor_id),
            actor_name: Some("Late Path Listener".to_string()),
            location_id: Some(RAIN_SOFT_GARDEN_LOCATION_ID),
            location_name: Some("Rain-Soft Garden".to_string()),
            total: Some(LISTEN_DC as i16),
            dc: Some(LISTEN_DC as i16),
            ..EventView::default()
        };
        let trace = runtime.apply_first_tale_public_trace_projection(&action, &[check]);
        assert_eq!(trace.len(), 1);
        assert_eq!(trace[0].type_name, "first_tale.public_trace");
        assert_eq!(trace[0].caused_by_event_seq, Some(90_004));
        assert_eq!(
            runtime.first_tale_trace_event_seq(actor_id),
            Some(trace[0].seq)
        );
        assert!(
            runtime
                .apply_first_tale_public_trace_projection(&action, &[])
                .is_empty(),
            "the latecomer trace remains exactly once"
        );
    }
}
