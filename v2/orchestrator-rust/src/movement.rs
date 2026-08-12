use super::*;

#[derive(Debug, Deserialize)]
pub(super) struct ScoutRequest {
    pub(super) actor_id: u64,
    pub(super) actor_session: Option<String>,
    pub(super) destination_location_id: u64,
    pub(super) wallet_session: Option<String>,
}

pub(super) async fn scout_access_context(
    state: &AppState,
    payload: &ScoutRequest,
) -> AccessContext {
    let ownership = state.ownership_snapshot().await;
    AccessContext::from_query(
        &StateQuery {
            actor_id: Some(payload.actor_id),
            actor_session: payload.actor_session.clone(),
            wallet_session: payload.wallet_session.clone(),
            openrouter_connected: None,
        },
        &ownership,
        state.trust_client_card_ids,
        &state.wallet_sessions,
        state.allow_unsigned_wallet_claims,
    )
}

impl RuntimeWorld {
    pub(super) fn resident_roaming_action(&self, actor: CwActor) -> Option<CwAction> {
        if !seed_actor_roams(actor.id) {
            return None;
        }
        let exits = self
            .accessible_movement_exits(actor.id, &AccessContext::default())
            .into_iter()
            .filter(|exit| exit.distance <= 1)
            .collect::<Vec<_>>();
        if exits.is_empty() {
            return None;
        }
        let start = actor
            .id
            .wrapping_add(self.world.tick)
            .wrapping_rem(exits.len() as u64) as usize;
        for offset in 0..exits.len() {
            let exit = &exits[(start + offset) % exits.len()];
            if let Some(action) = self.fresh_resident_autonomy_action(
                actor,
                CwAction {
                    kind: CW_ACTION_MOVE,
                    actor_id: actor.id,
                    destination_location_id: exit.destination_location_id,
                    ..CwAction::default()
                },
            ) {
                return Some(action);
            }
        }
        None
    }

    pub(crate) fn plan_scout_offer_with_access(
        &self,
        actor_id: u64,
        offer: &RankedActionOffer,
        access: &AccessContext,
    ) -> Result<(CwAction, ProjectionMutation, JourneyNarrationPlan), String> {
        if offer.kind != "explore_path" || !action_offer_is_reachable(offer) {
            return Err("Scout needs a current reachable route offer.".to_string());
        }
        let current_offer = self
            .current_reachable_offer_with_access(actor_id, offer, access)
            .ok_or_else(|| "That Scout offer is no longer current.".to_string())?;
        let destination_location_id = current_offer
            .target
            .as_ref()
            .filter(|target| target.kind == "location")
            .and_then(|target| target.id)
            .ok_or_else(|| "Scout has no route destination.".to_string())?;
        if let Some(journey) = self.journeys.get(&actor_id) {
            if journey.destination_location_id != destination_location_id {
                return Err("Scout target no longer matches the active journey.".to_string());
            }
            return self.plan_pathway_search(actor_id);
        }
        if let Some(mut plan) =
            self.plan_direct_authored_route_discovery(actor_id, destination_location_id)
        {
            if let Some(lead) = self.local_lead_for_offer(actor_id, &current_offer) {
                if let ProjectionMutation::DiscoverSeedExit { reason, .. } = &mut plan.1 {
                    *reason = format!("follow_local_lead:{}", lead.id);
                }
            }
            return Ok(plan);
        }
        self.plan_journey_move(actor_id, destination_location_id)?
            .ok_or_else(|| "Scout needs a route longer than one open step.".to_string())
    }

    pub(crate) fn plan_scout_offer(
        &self,
        actor_id: u64,
        offer: &RankedActionOffer,
    ) -> Result<(CwAction, ProjectionMutation, JourneyNarrationPlan), String> {
        self.plan_scout_offer_with_access(actor_id, offer, &AccessContext::default())
    }

    pub(super) fn plan_scout_choice_action_with_access(
        &self,
        actor_id: u64,
        destination_location_id: u64,
        access: &AccessContext,
    ) -> Result<(CwAction, ProjectionMutation, JourneyNarrationPlan), String> {
        let offer = self
            .legal_action_candidates(Some(actor_id), access)
            .1
            .into_iter()
            .filter(action_offer_is_reachable)
            .find(|offer| {
                offer.kind == "explore_path"
                    && offer.target.as_ref().is_some_and(|target| {
                        target.kind == "location" && target.id == Some(destination_location_id)
                    })
            })
            .ok_or_else(|| "That Scout offer is no longer current.".to_string())?;
        self.plan_scout_offer_with_access(actor_id, &offer, access)
    }

    #[cfg(test)]
    pub(super) fn plan_scout_choice_action(
        &self,
        actor_id: u64,
        destination_location_id: u64,
    ) -> Result<(CwAction, ProjectionMutation, JourneyNarrationPlan), String> {
        self.plan_scout_choice_action_with_access(
            actor_id,
            destination_location_id,
            &AccessContext::default(),
        )
    }
}

#[derive(Clone, Copy, Debug, Default, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub(super) enum PathwayWayClass {
    #[default]
    Route,
    Track,
    Path,
    Trail,
    Road,
    Avenue,
    Highway,
}

impl PathwayWayClass {
    pub(super) fn for_traffic(traffic_count: u64) -> Self {
        match traffic_count {
            0 => Self::Route,
            1..=3 => Self::Track,
            4..=7 => Self::Path,
            8..=15 => Self::Trail,
            16..=31 => Self::Road,
            32..=63 => Self::Avenue,
            _ => Self::Highway,
        }
    }

    fn label(self) -> &'static str {
        match self {
            Self::Route => "Route",
            Self::Track => "Track",
            Self::Path => "Path",
            Self::Trail => "Trail",
            Self::Road => "Road",
            Self::Avenue => "Avenue",
            Self::Highway => "Highway",
        }
    }
}

fn legacy_pathway_anchor_name_token(name: &str) -> String {
    name.split_whitespace()
        .find_map(|word| {
            let word = word
                .chars()
                .filter(|character| character.is_ascii_alphabetic() || *character == '-')
                .collect::<String>();
            (!word.is_empty() && !word.eq_ignore_ascii_case("the")).then_some(word)
        })
        .unwrap_or_else(|| "Known".to_string())
}

const PATHWAY_NAME_ADJECTIVES: &[&str] = &[
    "Amber",
    "Autumn",
    "Bright",
    "Dappled",
    "Dawnlit",
    "Dewy",
    "Fern-Green",
    "Golden",
    "Heathered",
    "Hushed",
    "Lantern-Lit",
    "Misty",
    "Moonlit",
    "Mossy",
    "Rain-Silver",
    "Reed-Green",
    "Russet",
    "Shaded",
    "Soft",
    "Starry",
    "Sunlit",
    "Twilight",
    "Warm",
    "Willow-Pale",
];

const PATHWAY_NAME_ECOLOGY: &[&str] = &[
    "Bluebell", "Bramble", "Cedar", "Clover", "Fern", "Foxglove", "Hawthorn", "Heather", "Juniper",
    "Lantern", "Lichen", "Meadow", "Moss", "Orchard", "Pine", "Primrose", "Reed", "Rosemary",
    "Rowan", "Sage", "Thistle", "Willow", "Woodbine", "Yarrow",
];

const PATHWAY_NAME_FEATURES: &[&str] = &[
    "Bend",
    "Brook",
    "Crossing",
    "Dell",
    "Fold",
    "Glade",
    "Grove",
    "Hollow",
    "Mile",
    "Reach",
    "Rise",
    "Run",
    "Steps",
    "Turn",
    "Vale",
    "Verge",
    "Walk",
    "Way",
    "Wold",
    "Meander",
    "Passage",
    "Promenade",
    "Terrace",
    "Trace",
];

const PATHWAY_PROSE_NAME_VARIANTS: u64 = (PATHWAY_NAME_ADJECTIVES.len()
    * PATHWAY_NAME_ECOLOGY.len()
    * PATHWAY_NAME_FEATURES.len()) as u64;

pub(super) fn deterministic_pathway_fallback_name(
    pathway_canonical_id: &str,
    waypoint_index: usize,
) -> String {
    deterministic_pathway_prose_name(pathway_canonical_id, waypoint_index, 0)
}

fn deterministic_pathway_prose_name(
    pathway_canonical_id: &str,
    waypoint_index: usize,
    variant: u64,
) -> String {
    assert!(
        variant < PATHWAY_PROSE_NAME_VARIANTS,
        "pathway prose-name namespace exhausted"
    );
    let seed = stable_pathway_hash(&format!("{pathway_canonical_id}:{waypoint_index}"));
    let slot = (seed % PATHWAY_PROSE_NAME_VARIANTS + variant) % PATHWAY_PROSE_NAME_VARIANTS;
    let slot = slot as usize;
    let ecology_and_feature_slots = PATHWAY_NAME_ECOLOGY.len() * PATHWAY_NAME_FEATURES.len();
    format!(
        "{} {} {}",
        PATHWAY_NAME_ADJECTIVES[slot / ecology_and_feature_slots],
        PATHWAY_NAME_ECOLOGY[(slot / PATHWAY_NAME_FEATURES.len()) % PATHWAY_NAME_ECOLOGY.len()],
        PATHWAY_NAME_FEATURES[slot % PATHWAY_NAME_FEATURES.len()],
    )
}

pub(super) fn deterministic_pathway_collision_name(
    pathway_canonical_id: &str,
    waypoint_index: usize,
    collision_attempt: u64,
) -> String {
    deterministic_pathway_prose_name(
        pathway_canonical_id,
        waypoint_index,
        collision_attempt.saturating_add(1),
    )
}

pub(super) fn reserve_unique_pathway_name(
    occupied_names: &mut BTreeSet<String>,
    proposed_name: &str,
    fallback_name: &str,
    pathway_canonical_id: &str,
    waypoint_index: usize,
) -> String {
    if occupied_names.insert(proposed_name.to_ascii_lowercase()) {
        return proposed_name.to_string();
    }
    if occupied_names.insert(fallback_name.to_ascii_lowercase()) {
        return fallback_name.to_string();
    }
    let mut collision_attempt = 0u64;
    loop {
        let candidate = deterministic_pathway_collision_name(
            pathway_canonical_id,
            waypoint_index,
            collision_attempt,
        );
        if occupied_names.insert(candidate.to_ascii_lowercase()) {
            return candidate;
        }
        collision_attempt = collision_attempt
            .checked_add(1)
            .expect("pathway collision namespace exhausted");
    }
}

pub(super) fn strip_legacy_pathway_endpoint_prefix(
    name: &str,
    origin_name: &str,
    destination_name: &str,
) -> Option<String> {
    let prefix = format!(
        "{}-{} ",
        legacy_pathway_anchor_name_token(origin_name),
        legacy_pathway_anchor_name_token(destination_name),
    );
    name.strip_prefix(&prefix)
        .map(str::trim)
        .filter(|name| !name.is_empty())
        .map(str::to_string)
}

fn generated_pathway_edge_direction(
    pathway: &GeneratedPathwayState,
    from_location_id: u64,
    to_location_id: u64,
) -> Option<bool> {
    let path = std::iter::once(pathway.origin_location_id)
        .chain(pathway.waypoints.iter().map(|waypoint| waypoint.id))
        .chain(std::iter::once(pathway.destination_location_id))
        .collect::<Vec<_>>();
    path.windows(2).find_map(|edge| {
        if edge == [from_location_id, to_location_id] {
            Some(true)
        } else if edge == [to_location_id, from_location_id] {
            Some(false)
        } else {
            None
        }
    })
}

pub(super) fn durable_pathway_traffic_evidence(
    pathway: &GeneratedPathwayState,
    committed_events: &[EventView],
) -> u64 {
    committed_events
        .iter()
        .filter(|event| event.success && event.type_name == "actor.moved")
        .filter_map(|event| Some((event.location_id?, event.destination_location_id?)))
        .filter(|(from_location_id, to_location_id)| {
            generated_pathway_edge_direction(pathway, *from_location_id, *to_location_id).is_some()
        })
        .count() as u64
}

#[derive(Clone, Debug)]
pub(super) enum MovementPlan {
    Adjacent(CwAction),
    Journey {
        action: CwAction,
        mutation: Box<ProjectionMutation>,
        narration: JourneyNarrationPlan,
    },
}

impl RuntimeWorld {
    pub(super) fn journey_at_actor_location(&self, actor_id: u64) -> Option<JourneyState> {
        let mut journey = self.journeys.get(&actor_id)?.clone();
        let actor_location_id = self.actor_by_id(actor_id)?.location_id;
        if journey.path.get(journey.current_step).copied() != Some(actor_location_id) {
            if let Some(actual_step) = journey
                .path
                .iter()
                .position(|location_id| *location_id == actor_location_id)
            {
                journey.current_step = actual_step;
            }
        }
        Some(journey)
    }

    fn generated_pathway_for_edge(
        &self,
        from_location_id: u64,
        to_location_id: u64,
    ) -> Option<(&GeneratedPathwayState, bool)> {
        self.generated_pathways.values().find_map(|pathway| {
            generated_pathway_edge_direction(pathway, from_location_id, to_location_id)
                .map(|forward| (pathway, forward))
        })
    }

    pub(super) fn route_label_for_edge(
        &self,
        from_location_id: u64,
        to_location_id: u64,
    ) -> String {
        let (way_class, origin_location_id, destination_location_id) =
            if let Some((pathway, forward)) =
                self.generated_pathway_for_edge(from_location_id, to_location_id)
            {
                if forward {
                    (
                        pathway.way_class,
                        pathway.origin_location_id,
                        pathway.destination_location_id,
                    )
                } else {
                    (
                        pathway.way_class,
                        pathway.destination_location_id,
                        pathway.origin_location_id,
                    )
                }
            } else {
                (PathwayWayClass::Route, from_location_id, to_location_id)
            };
        let origin_name = self
            .location_name(origin_location_id)
            .unwrap_or_else(|| format!("Location {origin_location_id}"));
        let destination_name = self
            .location_name(destination_location_id)
            .unwrap_or_else(|| format!("Location {destination_location_id}"));
        format!(
            "{} from {origin_name} to {destination_name}",
            way_class.label()
        )
    }

    pub(super) fn first_tale_destination_reached(&self, actor_id: u64) -> bool {
        let Some(first_tale) = active_first_tale() else {
            return false;
        };
        let destination_location_id = first_tale.destination_location_id;
        first_tale_destination_claim_key(actor_id)
            .is_some_and(|claim_key| self.rpg_claims.contains(&claim_key))
            || self
                .actor_by_id(actor_id)
                .is_some_and(|actor| actor.location_id == destination_location_id)
    }

    pub(super) fn record_first_tale_destination_arrivals(&mut self, events: &[EventView]) {
        let Some(first_tale) = active_first_tale() else {
            return;
        };
        let destination_location_id = first_tale.destination_location_id;
        let actor_ids = events
            .iter()
            .filter(|event| {
                event.success
                    && event.type_name == "actor.moved"
                    && (event.location_id == Some(destination_location_id)
                        || event.destination_location_id == Some(destination_location_id))
            })
            .filter_map(|event| event.actor_id)
            .collect::<BTreeSet<_>>();
        for actor_id in actor_ids {
            if let Some(claim_key) = first_tale_destination_claim_key(actor_id) {
                self.rpg_claims.insert(claim_key);
            }
        }
    }

    pub(super) fn backfill_first_tale_destination_arrivals(&mut self) {
        let Some(first_tale) = active_first_tale() else {
            return;
        };
        let destination_location_id = first_tale.destination_location_id;
        let mut actor_ids = self
            .event_log
            .iter()
            .filter(|event| {
                event.success
                    && event.type_name == "actor.moved"
                    && (event.location_id == Some(destination_location_id)
                        || event.destination_location_id == Some(destination_location_id))
            })
            .filter_map(|event| event.actor_id)
            .collect::<BTreeSet<_>>();
        actor_ids.extend(self.journeys.iter().filter_map(|(actor_id, journey)| {
            journey
                .path
                .get(..=journey.current_step)
                .is_some_and(|path| path.contains(&destination_location_id))
                .then_some(*actor_id)
        }));
        for actor_id in actor_ids {
            if let Some(claim_key) = first_tale_destination_claim_key(actor_id) {
                self.rpg_claims.insert(claim_key);
            }
        }
    }

    pub(super) fn current_reachable_offer(
        &self,
        actor_id: u64,
        offered: &RankedActionOffer,
    ) -> Option<RankedActionOffer> {
        self.current_reachable_offer_with_access(actor_id, offered, &AccessContext::default())
    }

    pub(super) fn current_reachable_offer_with_access(
        &self,
        actor_id: u64,
        offered: &RankedActionOffer,
        access: &AccessContext,
    ) -> Option<RankedActionOffer> {
        self.legal_action_candidates(Some(actor_id), access)
            .1
            .into_iter()
            .find(|candidate| {
                candidate.offer_id == offered.offer_id
                    && candidate.kind == offered.kind
                    && candidate.rules_action == offered.rules_action
                    && candidate.operation == offered.operation
                    && candidate.resolver == offered.resolver
                    && candidate.state_revision == offered.state_revision
                    && candidate.provider.id == offered.provider.id
                    && candidate.source_collectible == offered.source_collectible
                    && candidate.target == offered.target
                    && candidate.route == offered.route
                    && action_offer_is_reachable(candidate)
            })
    }

    fn current_movement_offer_for_choice(
        &self,
        actor_id: u64,
        destination_location_id: u64,
        access: &AccessContext,
    ) -> Result<RankedActionOffer, String> {
        self.legal_action_candidates(Some(actor_id), access)
            .1
            .into_iter()
            .filter(action_offer_is_reachable)
            .find(|offer| {
                offer.kind == "move"
                    && offer.target.as_ref().is_some_and(|target| {
                        target.kind == "location" && target.id == Some(destination_location_id)
                    })
            })
            .ok_or_else(|| "That Travel offer is no longer current.".to_string())
    }

    fn plan_move_offer_action(
        &self,
        actor_id: u64,
        offered: &RankedActionOffer,
        access: &AccessContext,
    ) -> Result<MovementPlan, String> {
        if offered.kind != "move" || !action_offer_is_reachable(offered) {
            return Err("Travel needs a current reachable route offer.".to_string());
        }
        let offer = self
            .current_reachable_offer_with_access(actor_id, offered, access)
            .ok_or_else(|| "That Travel offer is no longer current.".to_string())?;
        let destination_location_id = offer
            .target
            .as_ref()
            .filter(|target| target.kind == "location")
            .and_then(|target| target.id)
            .ok_or_else(|| "Travel has no exact destination.".to_string())?;
        if let Some((mut action, mutation, narration)) =
            self.plan_journey_move(actor_id, destination_location_id)?
        {
            if action.kind != CW_ACTION_MOVE {
                return Err(
                    "That route still needs scouting before it can be travelled.".to_string(),
                );
            }
            if let Some(threshold) = offer
                .route
                .as_ref()
                .and_then(|route| route.threshold.as_ref())
            {
                bind_threshold_action(&mut action, threshold)?;
            }
            return Ok(MovementPlan::Journey {
                action,
                mutation: Box::new(mutation),
                narration,
            });
        }
        let mut action = CwAction {
            kind: CW_ACTION_MOVE,
            actor_id,
            destination_location_id,
            ..CwAction::default()
        };
        if let Some(threshold) = offer
            .route
            .as_ref()
            .and_then(|route| route.threshold.as_ref())
        {
            bind_threshold_action(&mut action, threshold)?;
        }
        if !self.kernel_offer_allows_action(&action) {
            return Err("The kernel no longer offers that route.".to_string());
        }
        Ok(MovementPlan::Adjacent(action))
    }

    pub(super) fn plan_move_choice_action(
        &self,
        actor_id: u64,
        destination_location_id: u64,
        access: &AccessContext,
    ) -> Result<MovementPlan, String> {
        let offer =
            self.current_movement_offer_for_choice(actor_id, destination_location_id, access)?;
        self.plan_move_offer_action(actor_id, &offer, access)
    }

    fn accessible_movement_exits(&self, actor_id: u64, access: &AccessContext) -> Vec<ExitView> {
        let Some(actor) = self
            .actor_by_id(actor_id)
            .filter(|actor| Self::actor_can_act(*actor))
        else {
            return Vec::new();
        };
        let journey_next_location_id = self
            .journey_view(actor_id)
            .and_then(|journey| journey.next_location_id);
        let mut exits = self
            .exit_views(Some(actor_id), actor.location_id, access)
            .into_iter()
            .filter(|exit| exit.accessible && !exit.locked)
            .collect::<Vec<_>>();
        exits.sort_by_key(|exit| {
            (
                usize::from(journey_next_location_id != Some(exit.destination_location_id)),
                exit.destination_location_id,
            )
        });
        exits
    }

    fn movement_offer_exits(&self, actor_id: u64, access: &AccessContext) -> Vec<ExitView> {
        self.accessible_movement_exits(actor_id, access)
            .into_iter()
            .filter(|exit| exit.distance <= 1)
            .collect()
    }

    fn retarget_route_action_offer(
        &self,
        actor_id: u64,
        mut offer: RankedActionOffer,
        exit: ExitView,
    ) -> RankedActionOffer {
        let target = ActionTargetView {
            kind: "location".to_string(),
            id: Some(exit.destination_location_id),
            label: Some(exit.destination_location_name.clone()),
        };
        let verb = self.action_offer_verb(&offer.kind, actor_id);
        let fallback = if offer.kind == "flee" { "Flee" } else { "Move" };
        let label = self.action_offer_label(&offer.kind, &verb, fallback, Some(&target), None);
        let legacy_id = format!("{}:{}", offer.kind, exit.destination_location_id);
        offer.id = legacy_id.clone();
        offer.offer_id = format!(
            "{}:{}:{}",
            offer.rules_profile, offer.state_revision, legacy_id
        );
        offer.verb = verb.clone();
        offer.label = label.clone();
        offer.accessible_label = format!(
            "{} via {}",
            self.action_offer_accessible_label(&offer.kind, &verb, &label, Some(&target), None),
            exit.route_label,
        );
        offer.command = normalize_command_text(&format!(
            "{} {}",
            if offer.kind == "flee" {
                "flee to"
            } else {
                "go"
            },
            exit.destination_location_name
        ));
        let route = self.routes.get(&exit.route_id);
        offer.route = Some(RouteOfferBinding {
            route_id: exit.route_id,
            route_version: exit.route_version,
            directionality: route.map(|route| route.directionality).unwrap_or_default(),
            fallback_location_id: route.and_then(|route| route.fallback_location_id),
            threshold: exit.threshold.clone(),
        });
        if let Some(fallback_location_id) = offer
            .route
            .as_ref()
            .filter(|route| route.directionality == RouteDirectionality::OneWay)
            .and_then(|route| route.fallback_location_id)
        {
            let fallback_name = self
                .location_name(fallback_location_id)
                .unwrap_or_else(|| format!("Location {fallback_location_id}"));
            offer.effect = Some(format!("One-way entry; fallback to {fallback_name}."));
        }
        offer.target = Some(target.clone());
        offer.composition_trace.target = Some(target);
        if offer.kind == "move" {
            offer.risk =
                self.full_expedition_ring_travel_risk(actor_id, exit.destination_location_id);
        }
        offer
    }

    fn full_expedition_ring_travel_risk(
        &self,
        actor_id: u64,
        destination_location_id: u64,
    ) -> Option<String> {
        let ring_is_full = self.frontier_travel_since_rest_count(actor_id)
            >= self.frontier_travel_since_rest_required(actor_id);
        let destination_extends_risk = self
            .room_sheets
            .get(&destination_location_id)
            .is_some_and(|sheet| matches!(sheet.safety.trim(), "risky" | "dangerous"));
        (ring_is_full && destination_extends_risk)
            .then(|| "travelling farther at this depth may draw more trouble".to_string())
    }

    pub(super) fn expand_route_action_offers(
        &self,
        actor_id: u64,
        access: &AccessContext,
        offers: Vec<RankedActionOffer>,
    ) -> Vec<RankedActionOffer> {
        let mut expanded = Vec::new();
        for offer in offers {
            if !matches!(offer.kind.as_str(), "move" | "flee") {
                expanded.push(offer);
                continue;
            }
            let exits = if offer.kind == "flee" {
                self.accessible_movement_exits(actor_id, access)
            } else {
                self.movement_offer_exits(actor_id, access)
            };
            expanded.extend(
                exits
                    .into_iter()
                    .map(|exit| self.retarget_route_action_offer(actor_id, offer.clone(), exit)),
            );
        }
        expanded
    }

    pub(super) fn has_accessible_exit(&self, actor_id: u64, access: &AccessContext) -> bool {
        !self.accessible_movement_exits(actor_id, access).is_empty()
    }
}

fn seed_actor_roams(actor_id: u64) -> bool {
    active_content()
        .actors
        .iter()
        .find(|actor| actor.id == actor_id)
        .is_some_and(seed_actor_roaming_enabled)
}

pub(super) fn seed_actor_roaming_enabled(actor: &SeedActorContent) -> bool {
    actor.ambient_autonomy.unwrap_or(true) && actor.roaming.unwrap_or(false)
}

pub(super) fn bind_threshold_action(
    action: &mut CwAction,
    binding: &ThresholdOfferBinding,
) -> Result<(), String> {
    if binding.facts.len() > CW_MAX_GATE_FACTS {
        return Err("That threshold offer contains too much predicate evidence.".to_string());
    }
    action.threshold.gate_id = binding.gate_id;
    action.threshold.method_id = binding.method_id;
    action.threshold.expected_gate_version = binding.gate_version;
    action.threshold.expected_access_revision = binding.access_revision;
    action.threshold.expected_evidence_digest = binding.evidence_digest;
    action.threshold.fact_count = binding.facts.len();
    action.threshold.facts[..binding.facts.len()].copy_from_slice(&binding.facts);
    Ok(())
}

fn first_tale_destination_claim_key(actor_id: u64) -> Option<String> {
    let first_tale = active_first_tale()?;
    Some(format!(
        "first_tale:v{}:actor:{actor_id}:destination:{}",
        first_tale.schema_version, first_tale.destination_location_id
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn journey_cursor_recovers_from_the_actors_actual_path_location() {
        let actor_id = 5000;
        let mut runtime = RuntimeWorld::seeded();
        create_test_human(
            &mut runtime,
            actor_id,
            RAIN_SOFT_GARDEN_LOCATION_ID,
            "Escaping Traveller",
        );
        let mut pathway = runtime
            .generated_pathway(
                actor_id,
                RAIN_SOFT_GARDEN_LOCATION_ID,
                MOONLIT_TRAIL_LOCATION_ID,
                3,
            )
            .expect("generated journey");
        let path = runtime.pathway_path(
            &pathway,
            RAIN_SOFT_GARDEN_LOCATION_ID,
            MOONLIT_TRAIL_LOCATION_ID,
        );
        for edge in path.windows(2).take(2) {
            pathway
                .revealed_edges
                .insert(pathway_edge_key(edge[0], edge[1]));
            runtime.ensure_generated_pathway_edge(&pathway, edge[0], edge[1]);
        }
        let pathway_id = pathway.id.clone();
        runtime
            .generated_pathways
            .insert(pathway_id.clone(), pathway);
        runtime.journeys.insert(
            actor_id,
            JourneyState {
                actor_id,
                pathway_id,
                origin_location_id: RAIN_SOFT_GARDEN_LOCATION_ID,
                destination_location_id: MOONLIT_TRAIL_LOCATION_ID,
                destination_name: "Moonlit Trail".to_string(),
                path: path.clone(),
                current_step: 0,
                explorer: false,
            },
        );
        runtime
            .world
            .actors
            .iter_mut()
            .find(|actor| actor.id == actor_id)
            .expect("traveller exists")
            .location_id = path[1];

        let recovered = runtime
            .journey_view(actor_id)
            .expect("the active journey remains visible");
        assert_eq!(recovered.current_step, 1);
        assert_eq!(recovered.next_location_id, Some(path[2]));
        let MovementPlan::Journey { mutation, .. } = runtime
            .plan_move_choice_action(actor_id, path[2], &AccessContext::default())
            .expect("the next revealed segment remains a legal Travel choice")
        else {
            panic!("the recovered route should remain a journey");
        };
        let ProjectionMutation::JourneyTransition {
            journey: Some(next_journey),
            ..
        } = *mutation
        else {
            panic!("the recovered journey should advance");
        };
        assert_eq!(next_journey.current_step, 2);
    }

    #[test]
    fn route_grounding_labels_are_directional_and_traffic_preserves_identity() {
        let mut runtime = RuntimeWorld::seeded();
        let mut pathway = runtime
            .generated_pathway(RATI_ACTOR_ID, 700, 712, 2)
            .expect("Bethlehem-to-Jerusalem route");
        let pathway_id = pathway.id.clone();
        let waypoint_id = pathway.waypoints[0].id;
        runtime.ensure_generated_pathway_route_records(&pathway);
        runtime
            .generated_pathways
            .insert(pathway_id.clone(), pathway.clone());
        let route_before = runtime
            .routes
            .values()
            .find(|route| route.contains_edge(700, waypoint_id))
            .expect("generated segment route")
            .clone();
        let journey = JourneyState {
            actor_id: RATI_ACTOR_ID,
            pathway_id: pathway_id.clone(),
            origin_location_id: 700,
            destination_location_id: 712,
            destination_name: "Jerusalem".to_string(),
            path: vec![700, waypoint_id, 712],
            current_step: 0,
            explorer: true,
        };
        runtime.journeys.insert(RATI_ACTOR_ID, journey.clone());
        let identity_before = serde_json::to_vec(&(
            pathway.id.clone(),
            pathway.canonical_id.clone(),
            pathway.source_route_id.clone(),
            pathway.source_route_version,
            pathway.owner_pack_id.clone(),
            pathway.owner_pack_version.clone(),
            pathway
                .waypoints
                .iter()
                .map(|waypoint| (waypoint.id, waypoint.canonical_id.clone()))
                .collect::<Vec<_>>(),
        ))
        .expect("serialize route identity");
        let journey_before = serde_json::to_vec(&journey).expect("serialize journey");

        assert_eq!(
            runtime.route_label_for_edge(700, waypoint_id),
            "Route from Bethlehem to Jerusalem"
        );
        assert_eq!(
            runtime.route_label_for_edge(712, waypoint_id),
            "Route from Jerusalem to Bethlehem"
        );

        for (traffic_count, expected_class, expected_label) in [
            (1, PathwayWayClass::Track, "Track"),
            (4, PathwayWayClass::Path, "Path"),
            (8, PathwayWayClass::Trail, "Trail"),
            (16, PathwayWayClass::Road, "Road"),
            (32, PathwayWayClass::Avenue, "Avenue"),
            (64, PathwayWayClass::Highway, "Highway"),
        ] {
            pathway.traffic_count = traffic_count;
            pathway.way_class = PathwayWayClass::for_traffic(traffic_count);
            runtime
                .generated_pathways
                .insert(pathway_id.clone(), pathway.clone());
            assert_eq!(
                runtime.generated_pathways[&pathway_id].way_class,
                expected_class
            );
            assert_eq!(
                runtime.route_label_for_edge(700, waypoint_id),
                format!("{expected_label} from Bethlehem to Jerusalem")
            );
        }
        runtime
            .generated_pathways
            .get_mut(&pathway_id)
            .expect("pathway remains allocated")
            .waypoints[0]
            .name = "Rain-Silver Crossing".to_string();

        let evolved = &runtime.generated_pathways[&pathway_id];
        let identity_after = serde_json::to_vec(&(
            evolved.id.clone(),
            evolved.canonical_id.clone(),
            evolved.source_route_id.clone(),
            evolved.source_route_version,
            evolved.owner_pack_id.clone(),
            evolved.owner_pack_version.clone(),
            evolved
                .waypoints
                .iter()
                .map(|waypoint| (waypoint.id, waypoint.canonical_id.clone()))
                .collect::<Vec<_>>(),
        ))
        .expect("serialize evolved identity");
        assert_eq!(identity_after, identity_before);
        assert_eq!(
            serde_json::to_vec(&runtime.journeys[&RATI_ACTOR_ID]).expect("serialize journey"),
            journey_before
        );
        assert_eq!(
            runtime
                .routes
                .values()
                .find(|route| route.contains_edge(700, waypoint_id))
                .expect("segment remains allocated"),
            &route_before
        );
        assert_eq!(
            runtime.route_label_for_edge(712, waypoint_id),
            "Highway from Jerusalem to Bethlehem"
        );
    }

    #[test]
    fn route_grounding_collision_namespace_does_not_cycle_at_ten_thousand_names() {
        let canonical_id = "generated-pathway:route://test/example@1";
        let names = (0..10_000)
            .map(|attempt| deterministic_pathway_collision_name(canonical_id, 0, attempt))
            .collect::<BTreeSet<_>>();
        assert_eq!(names.len(), 10_000);
        assert!(names
            .iter()
            .all(|name| sanitize_generated_pathway_name(name).is_some()));
    }

    #[test]
    fn pathway_traffic_counts_only_committed_movement_on_its_exact_edges() {
        let mut runtime = RuntimeWorld::seeded();
        let pathway = runtime
            .generated_pathway(RATI_ACTOR_ID, 700, 712, 2)
            .expect("Bethlehem-to-Jerusalem route");
        let waypoint_id = pathway.waypoints[0].id;
        let forward = runtime.append_actor_moved_event(RATI_ACTOR_ID, 700, waypoint_id);
        let reverse = runtime.append_actor_moved_event(RATI_ACTOR_ID, waypoint_id, 700);
        let unrelated = runtime.append_actor_moved_event(RATI_ACTOR_ID, 1, 2);
        let mut rejected = forward.clone();
        rejected.success = false;

        assert_eq!(
            durable_pathway_traffic_evidence(&pathway, &[forward, reverse, unrelated, rejected],),
            2
        );
    }

    fn discover_seed_exit_for_test(
        runtime: &mut RuntimeWorld,
        from_location_id: u64,
        to_location_id: u64,
    ) {
        discover_seed_exit_for_actor_for_test(
            runtime,
            RATI_ACTOR_ID,
            from_location_id,
            to_location_id,
        );
    }

    fn discover_seed_exit_for_actor_for_test(
        runtime: &mut RuntimeWorld,
        actor_id: u64,
        from_location_id: u64,
        to_location_id: u64,
    ) {
        let destination = runtime
            .location_name(to_location_id)
            .unwrap_or_else(|| format!("Location {to_location_id}"));
        let id = seed_exit_discovered_tag_id(from_location_id, to_location_id);
        runtime.tags.insert(
            id.clone(),
            RpgTagState {
                id,
                scope: "room".to_string(),
                scope_id: from_location_id,
                label: format!("path to {destination}"),
                kind: "discovery".to_string(),
                active: true,
                source_event_seq: None,
                expires: None,
            },
        );
        runtime.remember_search_discovery(
            actor_id,
            from_location_id,
            BELIEF_KIND_SEED_EXIT,
            to_location_id,
            &seed_exit_belief_subject_key(from_location_id, to_location_id),
        );
    }

    fn discover_seed_exit_pair_for_test(
        runtime: &mut RuntimeWorld,
        from_location_id: u64,
        to_location_id: u64,
    ) {
        discover_seed_exit_for_test(runtime, from_location_id, to_location_id);
        discover_seed_exit_for_test(runtime, to_location_id, from_location_id);
    }

    #[test]
    fn movement_offers_bind_every_immediately_travelable_route_for_every_controller() {
        let mut runtime = RuntimeWorld::seeded();
        runtime
            .world
            .actors
            .iter_mut()
            .find(|actor| actor.id == RATI_ACTOR_ID)
            .expect("route actor exists")
            .location_id = RAIN_SOFT_GARDEN_LOCATION_ID;
        runtime
            .actor_autonomy
            .entry(RATI_ACTOR_ID)
            .or_default()
            .control_mode = ActorControlMode::DirectInput;
        discover_seed_exit_pair_for_test(
            &mut runtime,
            RAIN_SOFT_GARDEN_LOCATION_ID,
            COSY_COTTAGE_LOCATION_ID,
        );
        discover_seed_exit_pair_for_test(
            &mut runtime,
            RAIN_SOFT_GARDEN_LOCATION_ID,
            MOONLIT_TRAIL_LOCATION_ID,
        );
        let access = AccessContext::default();
        let exits = runtime.movement_offer_exits(RATI_ACTOR_ID, &access);
        assert!(
            !exits.is_empty(),
            "the route parity fixture needs an immediately travelable exit"
        );
        let expected_destination_ids = exits
            .iter()
            .map(|exit| exit.destination_location_id)
            .collect::<Vec<_>>();
        assert!(
            exits.iter().all(|exit| exit.distance <= 1),
            "Travel only binds routes whose next open step is immediately walkable"
        );

        let direct_offers = runtime
            .legal_action_candidates(Some(RATI_ACTOR_ID), &access)
            .1
            .into_iter()
            .filter(|offer| offer.kind == "move")
            .collect::<Vec<_>>();
        assert_eq!(direct_offers.len(), expected_destination_ids.len());
        assert_eq!(
            direct_offers
                .iter()
                .filter_map(|offer| offer.target.as_ref().and_then(|target| target.id))
                .collect::<Vec<_>>(),
            expected_destination_ids
        );
        assert_eq!(
            direct_offers
                .iter()
                .map(|offer| offer.offer_id.as_str())
                .collect::<BTreeSet<_>>()
                .len(),
            direct_offers.len(),
            "every destination has a unique offer identity"
        );
        assert!(direct_offers.iter().all(|offer| {
            offer.target.as_ref().is_some_and(|target| {
                target.kind == "location"
                    && target
                        .label
                        .as_deref()
                        .is_some_and(|label| offer.label.contains(label))
            }) && offer.route.is_some()
        }));
        assert!(direct_offers.iter().all(|offer| {
            let target = offer.target.as_ref().expect("route target");
            let exit = exits
                .iter()
                .find(|exit| Some(exit.destination_location_id) == target.id)
                .expect("matching exit");
            offer.accessible_label
                == format!(
                    "Travel to {} via {}",
                    target.label.as_deref().unwrap(),
                    exit.route_label
                )
        }));
        assert!(
            direct_offers.iter().all(|offer| {
                offer.target.as_ref().and_then(|target| target.id) != Some(OLD_OAK_TREE_LOCATION_ID)
            }),
            "an undiscovered route cannot enter the shared offer surface"
        );
        assert!(runtime
            .plan_move_choice_action(RATI_ACTOR_ID, OLD_OAK_TREE_LOCATION_ID, &access)
            .is_err());

        runtime
            .actor_autonomy
            .entry(RATI_ACTOR_ID)
            .or_default()
            .control_mode = ActorControlMode::LocalAi;
        let inference_offers = runtime
            .legal_action_candidates(Some(RATI_ACTOR_ID), &access)
            .1
            .into_iter()
            .filter(|offer| offer.kind == "move")
            .collect::<Vec<_>>();
        assert_eq!(
            serde_json::to_value(&inference_offers).expect("inference route offers serialize"),
            serde_json::to_value(&direct_offers).expect("direct route offers serialize"),
            "controller mode cannot change route enumeration or targets"
        );

        let destination_location_id = exits
            .iter()
            .find(|exit| exit.distance <= 1)
            .map(|exit| exit.destination_location_id)
            .expect("an adjacent route is available");
        runtime
            .draw_until_test_offer(RATI_ACTOR_ID, &access, |offer| {
                offer.kind == "move"
                    && offer.target.as_ref().and_then(|target| target.id)
                        == Some(destination_location_id)
            })
            .expect("the exact adjacent Move offer is dealt within one bounded rotation");
        let offer = runtime
            .legal_action_candidates(Some(RATI_ACTOR_ID), &access)
            .1
            .iter()
            .find(|offer| {
                offer.target.as_ref().and_then(|target| target.id) == Some(destination_location_id)
            })
            .expect("the adjacent destination has an exact offer")
            .clone();
        let action = match runtime
            .plan_move_offer_action(RATI_ACTOR_ID, &offer, &access)
            .expect("the exact route offer plans")
        {
            MovementPlan::Adjacent(action) => action,
            MovementPlan::Journey { .. } => panic!("adjacent route should not create a journey"),
        };
        assert_eq!(action.kind, CW_ACTION_MOVE);
        assert_eq!(action.destination_location_id, destination_location_id);
        let inference_action = runtime
            .fresh_resident_autonomy_action(
                runtime
                    .actor_by_id(RATI_ACTOR_ID)
                    .expect("route actor exists"),
                action,
            )
            .expect("inference accepts the same exact route");
        assert_eq!(inference_action.kind, action.kind);
        assert_eq!(
            inference_action.destination_location_id,
            action.destination_location_id
        );

        let trace = runtime.resident_decision_trace(&ResidentAutonomyCandidate {
            actor_id: RATI_ACTOR_ID,
            rank: 60,
            score: 0,
            record: JournalRecord::new(action, 97_200)
                .into_actor_consequence(runtime.world.tick, None),
        });
        assert_eq!(
            trace.choice.offer_id.as_deref(),
            Some(offer.offer_id.as_str())
        );
        assert!(trace.candidates.iter().any(|candidate| {
            candidate.selected
                && candidate.target.as_ref().is_some_and(|target| {
                    target.kind == "location" && target.id == Some(destination_location_id)
                })
        }));

        let mut forged_offer = offer.clone();
        forged_offer
            .target
            .as_mut()
            .expect("route target exists")
            .id = Some(999_999);
        assert!(runtime
            .plan_move_offer_action(RATI_ACTOR_ID, &forged_offer, &access)
            .is_err());

        assert_eq!(
            runtime
                .apply_journal_record(&JournalRecord::new(action, 97_201))
                .0,
            CW_OK
        );
        assert!(runtime
            .plan_move_offer_action(RATI_ACTOR_ID, &offer, &access)
            .is_err());

        let moved_actor = runtime
            .actor_by_id(RATI_ACTOR_ID)
            .expect("route actor moved");
        let reverse_offer = runtime
            .legal_action_candidates(Some(RATI_ACTOR_ID), &access)
            .1
            .into_iter()
            .find(|candidate| {
                candidate.kind == "move"
                    && candidate
                        .target
                        .as_ref()
                        .is_some_and(|target| target.id == Some(RAIN_SOFT_GARDEN_LOCATION_ID))
            })
            .expect("the reverse route is offered");
        let reverse_action = match runtime
            .plan_move_offer_action(RATI_ACTOR_ID, &reverse_offer, &access)
            .expect("the reverse route is mechanically legal")
        {
            MovementPlan::Adjacent(action) => action,
            MovementPlan::Journey { .. } => panic!("reverse route should remain adjacent"),
        };
        assert!(
            runtime
                .fresh_resident_autonomy_action(moved_actor, reverse_action)
                .is_none(),
            "the exact reverse offer cannot bypass immediate-return protection"
        );
    }

    #[test]
    fn each_scout_offer_binds_one_authoritative_route_across_restart_and_replay() {
        let actor_id = 5000;
        let mut runtime = RuntimeWorld::seeded();
        create_test_human(
            &mut runtime,
            actor_id,
            MOONLIT_TRAIL_LOCATION_ID,
            "Exact Scout",
        );
        discover_seed_exit_pair_for_test(
            &mut runtime,
            MOONLIT_TRAIL_LOCATION_ID,
            RAIN_SOFT_GARDEN_LOCATION_ID,
        );
        discover_seed_exit_pair_for_test(
            &mut runtime,
            MOONLIT_TRAIL_LOCATION_ID,
            GREAT_LIBRARY_LOCATION_ID,
        );
        let access = AccessContext::default();
        let initial = runtime.state_response(Some(actor_id), &access);
        let long_destinations = initial
            .exits
            .iter()
            .filter(|exit| exit.distance > 1 && exit.accessible && !exit.locked)
            .map(|exit| exit.destination_location_id)
            .collect::<Vec<_>>();
        assert!(
            long_destinations.len() >= 2,
            "the fixture must expose multiple long routes"
        );
        let travel_destinations = initial
            .action_offers
            .iter()
            .filter(|offer| offer.kind == "move")
            .filter_map(|offer| offer.target.as_ref().and_then(|target| target.id))
            .collect::<BTreeSet<_>>();
        assert!(
            long_destinations
                .iter()
                .all(|destination| !travel_destinations.contains(destination)),
            "a route that still requires discovery must say Scout, not Travel"
        );
        let scout_offers = initial
            .action_offers
            .iter()
            .filter(|offer| offer.kind == "explore_path")
            .cloned()
            .collect::<Vec<_>>();
        assert!(
            scout_offers.len() >= 2,
            "the server deals each scoutable branch as its own offer"
        );
        let offer = scout_offers
            .iter()
            .find(|offer| {
                offer
                    .target
                    .as_ref()
                    .and_then(|target| target.id)
                    .is_some_and(|destination| long_destinations.contains(&destination))
            })
            .expect("a long route has an exact Scout offer")
            .clone();
        let offered_destination = offer
            .target
            .as_ref()
            .filter(|target| target.kind == "location")
            .and_then(|target| target.id)
            .expect("Scout offer has an exact destination");
        assert_eq!(
            runtime
                .plan_move_choice_action(actor_id, offered_destination, &access)
                .expect_err("Scout-only routes cannot be submitted as Travel"),
            "That Travel offer is no longer current."
        );
        let forged_destination = long_destinations
            .iter()
            .copied()
            .find(|destination| *destination != offered_destination)
            .expect("a different long route exists");

        let before_rejection = serde_json::to_value(RuntimeSnapshot::from_runtime(&runtime))
            .expect("serialize pre-rejection state");
        let rejected = runtime.validate_action_offer_submission(
            actor_id,
            &access,
            &ActionOfferSubmissionRequest {
                path: "/actions/explore-path".to_string(),
                offer_id: offer.offer_id.clone(),
                composition_id: offer.composition_id.clone(),
                kind: offer.kind.clone(),
                rules_action: offer.rules_action.clone(),
                operation: offer.operation.clone(),
                rules_profile: offer.rules_profile.clone(),
                state_revision: offer.state_revision,
                route: offer.route.clone(),
                target: offer.target.clone(),
                cost: offer.cost.clone(),
                payload: serde_json::json!({
                    "actor_id": actor_id,
                    "destination_location_id": forged_destination,
                }),
            },
        );
        assert_eq!(
            rejected,
            Err("that offer is not in the current two-card hand")
        );
        assert!(
            runtime
                .plan_scout_choice_action(actor_id, forged_destination)
                .is_ok(),
            "the other route is legal through its own authoritative offer"
        );
        assert_eq!(
            serde_json::to_value(RuntimeSnapshot::from_runtime(&runtime))
                .expect("serialize post-rejection state"),
            before_rejection,
            "a forged Scout target cannot mutate the world"
        );

        let (action, mut mutation, narration_plan) = runtime
            .plan_scout_choice_action(actor_id, offered_destination)
            .expect("the exact Scout offer plans");
        assert_eq!(action.kind, CW_ACTION_NONE);
        assert_eq!(
            runtime
                .actor_by_id(actor_id)
                .expect("Scout actor remains present")
                .location_id,
            MOONLIT_TRAIL_LOCATION_ID,
            "planning Scout does not move the actor"
        );
        if let ProjectionMutation::JourneyTransition { narration, .. } = &mut mutation {
            *narration = travel_narration_fallback(&narration_plan);
        }
        let mut record = JournalRecord::new(action, 97_250);
        record.bind_offer_kind("explore_path");
        record.route_binding = offer.route.clone();
        record.projection_mutations.push(mutation);

        let pre_scout_bytes = serde_json::to_vec(&RuntimeSnapshot::from_runtime(&runtime))
            .expect("serialize pre-Scout restart fixture");
        let mut replayed = serde_json::from_slice::<RuntimeSnapshot>(&pre_scout_bytes)
            .expect("deserialize pre-Scout restart fixture")
            .into_runtime()
            .expect("restart restores the multi-route fixture");

        assert_eq!(runtime.apply_journal_record(&record).0, CW_OK);
        assert_eq!(replayed.apply_journal_record(&record).0, CW_OK);
        assert_eq!(
            serde_json::to_value(replayed.journeys.get(&actor_id))
                .expect("serialize replayed journey"),
            serde_json::to_value(runtime.journeys.get(&actor_id))
                .expect("serialize direct journey"),
            "replay reproduces the exact offered route"
        );
        assert_eq!(
            replayed
                .actor_by_id(actor_id)
                .expect("replayed Scout actor exists")
                .location_id,
            runtime
                .actor_by_id(actor_id)
                .expect("direct Scout actor exists")
                .location_id
        );

        let after = runtime.state_response(Some(actor_id), &access);
        assert_eq!(
            runtime
                .actor_by_id(actor_id)
                .expect("Scout actor remains present")
                .location_id,
            MOONLIT_TRAIL_LOCATION_ID,
            "Scout reveals the route without moving"
        );
        assert_eq!(
            after
                .journey
                .as_ref()
                .map(|journey| journey.destination_location_id),
            Some(offered_destination)
        );
        assert!(
            !after
                .action_offers
                .iter()
                .any(|candidate| candidate.kind == "explore_path"),
            "Travel, not another Scout, follows the revealed stretch"
        );
        let next_location_id = after
            .journey
            .as_ref()
            .and_then(|journey| journey.next_location_id)
            .expect("the revealed journey has a next Travel step");
        assert!(after.action_offers.iter().any(|candidate| {
            candidate.kind == "move"
                && candidate
                    .target
                    .as_ref()
                    .is_some_and(|target| target.id == Some(next_location_id))
        }));
        assert!(runtime
            .plan_scout_choice_action(actor_id, offered_destination)
            .is_err());

        let restarted = RuntimeSnapshot::from_runtime(&runtime)
            .into_runtime()
            .expect("post-Scout restart restores");
        assert_eq!(
            serde_json::to_value(restarted.state_response(Some(actor_id), &access))
                .expect("serialize restarted state"),
            serde_json::to_value(after).expect("serialize direct state"),
            "restart preserves the authoritative Travel-after-Scout state"
        );
    }

    #[test]
    fn scout_choice_does_not_require_wallet_access() {
        let actor_id = 5000;
        let mut runtime = RuntimeWorld::seeded();
        create_test_human(
            &mut runtime,
            actor_id,
            MOONLIT_TRAIL_LOCATION_ID,
            "Public Scout",
        );
        discover_seed_exit_pair_for_test(
            &mut runtime,
            MOONLIT_TRAIL_LOCATION_ID,
            GREAT_LIBRARY_LOCATION_ID,
        );
        let access = AccessContext::default();
        assert!(
            runtime
                .state_response(Some(actor_id), &access)
                .action_offers
                .iter()
                .any(|offer| {
                    offer.kind == "explore_path"
                        && offer
                            .target
                            .as_ref()
                            .is_some_and(|target| target.id == Some(GREAT_LIBRARY_LOCATION_ID))
                }),
            "the destination should produce a legal Scout offer without wallet ownership"
        );
        assert!(
            runtime
                .plan_scout_choice_action_with_access(actor_id, GREAT_LIBRARY_LOCATION_ID, &access,)
                .is_ok(),
            "the submitted Scout choice must remain wallet-free"
        );
    }

    #[test]
    fn stale_route_offer_fails_without_mutating_world_state() {
        let mut runtime = RuntimeWorld::seeded();
        runtime
            .world
            .actors
            .iter_mut()
            .find(|actor| actor.id == RATI_ACTOR_ID)
            .expect("route actor exists")
            .location_id = RAIN_SOFT_GARDEN_LOCATION_ID;
        discover_seed_exit_pair_for_test(
            &mut runtime,
            RAIN_SOFT_GARDEN_LOCATION_ID,
            COSY_COTTAGE_LOCATION_ID,
        );
        let offer = runtime
            .legal_action_candidates(Some(RATI_ACTOR_ID), &AccessContext::default())
            .1
            .into_iter()
            .find(|offer| {
                offer.kind == "move"
                    && offer.target.as_ref().and_then(|target| target.id)
                        == Some(COSY_COTTAGE_LOCATION_ID)
            })
            .expect("current route offer");
        let binding = offer.route.clone().expect("route offer is version-bound");
        assert!(runtime.transition_route(
            &binding.route_id,
            binding.route_version,
            RouteLifecycle::Blocked,
        ));
        runtime.rebuild_kernel_exits_from_routes();

        let before = serde_json::to_value(RuntimeSnapshot::from_runtime(&runtime))
            .expect("serialize route state");
        let rejected = runtime.validate_action_offer_submission(
            RATI_ACTOR_ID,
            &AccessContext::default(),
            &ActionOfferSubmissionRequest {
                path: "/actions/move".to_string(),
                offer_id: offer.offer_id,
                composition_id: offer.composition_id,
                kind: offer.kind,
                rules_action: offer.rules_action,
                operation: offer.operation,
                rules_profile: offer.rules_profile,
                state_revision: offer.state_revision,
                route: offer.route,
                target: offer.target,
                cost: offer.cost,
                payload: serde_json::json!({
                    "actor_id": RATI_ACTOR_ID,
                    "destination_location_id": COSY_COTTAGE_LOCATION_ID,
                }),
            },
        );
        assert!(rejected.is_err());
        let after = serde_json::to_value(RuntimeSnapshot::from_runtime(&runtime))
            .expect("serialize rejected route state");
        assert_eq!(after, before);
    }

    #[test]
    fn first_tale_destination_progress_survives_snapshot_and_legacy_backfill() {
        let actor_id = 5000;
        let mut runtime = RuntimeWorld::seeded();
        create_test_human(
            &mut runtime,
            actor_id,
            COSY_COTTAGE_LOCATION_ID,
            "Returning Pathfinder",
        );
        runtime
            .listen_attempt_claims
            .insert(listen_attempt_claim_key(actor_id, COSY_COTTAGE_LOCATION_ID));
        let arrival = runtime.append_actor_moved_event(
            actor_id,
            COSY_COTTAGE_LOCATION_ID,
            RAIN_SOFT_GARDEN_LOCATION_ID,
        );
        runtime.record_first_tale_destination_arrivals(&[arrival]);
        runtime
            .world
            .actors
            .iter_mut()
            .find(|actor| actor.id == actor_id)
            .expect("First Tale actor exists")
            .location_id = MOONLIT_TRAIL_LOCATION_ID;
        let return_view = runtime
            .first_tale_view(actor_id)
            .expect("return guidance persists");
        assert_eq!(return_view.phase, "return_to_destination");
        assert_eq!(
            return_view.required_location_id,
            Some(RAIN_SOFT_GARDEN_LOCATION_ID)
        );

        let restored = RuntimeSnapshot::from_runtime(&runtime)
            .into_runtime()
            .expect("First Tale progress survives snapshot restore");
        assert_eq!(
            restored
                .first_tale_view(actor_id)
                .expect("restored return guidance")
                .phase,
            "return_to_destination"
        );

        let mut legacy_snapshot = RuntimeSnapshot::from_runtime(&runtime);
        let destination_claim =
            first_tale_destination_claim_key(actor_id).expect("official first tale is mounted");
        legacy_snapshot.rpg_claims.remove(&destination_claim);
        let backfilled = legacy_snapshot
            .into_runtime()
            .expect("legacy arrival progress backfills from movement");
        assert_eq!(
            backfilled
                .first_tale_view(actor_id)
                .expect("backfilled return guidance")
                .required_location_id,
            Some(RAIN_SOFT_GARDEN_LOCATION_ID)
        );
        assert!(backfilled.first_tale_destination_reached(actor_id));
    }

    async fn submit_offer_for_test(
        state: &AppState,
        actor_session: &str,
        path: &str,
        offer: RankedActionOffer,
        payload: serde_json::Value,
    ) -> ActionResponse {
        let mut payload = payload.as_object().cloned().unwrap_or_default();
        payload.insert(
            "actor_session".to_string(),
            serde_json::Value::String(actor_session.to_string()),
        );
        payload.insert(
            "wallet_address".to_string(),
            serde_json::Value::String("dev-wallet".to_string()),
        );
        submit_action_offer(
            ConnectInfo("127.0.0.1:44030".parse().expect("client address")),
            State(state.clone()),
            Json(ActionOfferSubmissionRequest {
                path: path.to_string(),
                offer_id: offer.offer_id,
                composition_id: offer.composition_id,
                kind: offer.kind,
                rules_action: offer.rules_action,
                operation: offer.operation,
                rules_profile: offer.rules_profile,
                state_revision: offer.state_revision,
                route: offer.route,
                target: offer.target,
                cost: offer.cost,
                payload: serde_json::Value::Object(payload),
            }),
        )
        .await
        .0
    }

    #[tokio::test]
    async fn current_offers_traverse_a_generated_pathway_through_completion() {
        let actor_id = 5000;
        let mut runtime = RuntimeWorld::seeded();
        create_test_human(
            &mut runtime,
            actor_id,
            COSY_COTTAGE_LOCATION_ID,
            "Offer Pathfinder",
        );
        runtime
            .listen_attempt_claims
            .insert(listen_attempt_claim_key(actor_id, COSY_COTTAGE_LOCATION_ID));
        runtime.callings.insert(
            actor_id,
            CallingState {
                actor_id,
                statement: EXPLORER_CALLING_STATEMENT.to_string(),
                source_event_seq: None,
            },
        );
        discover_seed_exit_for_actor_for_test(
            &mut runtime,
            actor_id,
            COSY_COTTAGE_LOCATION_ID,
            RAIN_SOFT_GARDEN_LOCATION_ID,
        );
        discover_seed_exit_for_actor_for_test(
            &mut runtime,
            actor_id,
            RAIN_SOFT_GARDEN_LOCATION_ID,
            MOONLIT_TRAIL_LOCATION_ID,
        );
        let state = test_app_state(runtime, None);
        let (actor_session, _) = issue_actor_session(&state, actor_id);

        let current_offer = |runtime: &mut RuntimeWorld, kind: &str, target_id: u64| {
            runtime
                .draw_until_test_offer(actor_id, &AccessContext::default(), |offer| {
                    offer.kind == kind
                        && offer
                            .target
                            .as_ref()
                            .is_some_and(|target| target.id == Some(target_id))
                })
                .unwrap_or_else(|| panic!("{kind} offer for {target_id} should rotate into hand"))
        };

        {
            let runtime = state.inner.lock().await;
            assert_eq!(
                runtime
                    .first_tale_view(actor_id)
                    .expect("the discovered lead is visible")
                    .phase,
                "follow_lead"
            );
        }
        let garden_offer = {
            let mut runtime = state.inner.lock().await;
            current_offer(&mut runtime, "move", RAIN_SOFT_GARDEN_LOCATION_ID)
        };
        let garden_response = submit_offer_for_test(
            &state,
            &actor_session,
            "/actions/move",
            garden_offer,
            serde_json::json!({
                "actor_id": actor_id,
                "destination_location_id": RAIN_SOFT_GARDEN_LOCATION_ID,
            }),
        )
        .await;
        assert!(garden_response.ok, "{garden_response:?}");
        {
            let runtime = state.inner.lock().await;
            assert_eq!(
                runtime
                    .first_tale_view(actor_id)
                    .expect("arrival advances the First Tale")
                    .phase,
                "contribute"
            );
        }

        let mut final_travel_offer = None;
        let first_scout = {
            let mut runtime = state.inner.lock().await;
            current_offer(&mut runtime, "explore_path", MOONLIT_TRAIL_LOCATION_ID)
        };
        assert!(first_scout.route.is_some());
        let first_scout_response = submit_offer_for_test(
            &state,
            &actor_session,
            "/actions/explore-path",
            first_scout,
            serde_json::json!({
                "actor_id": actor_id,
                "destination_location_id": MOONLIT_TRAIL_LOCATION_ID,
            }),
        )
        .await;
        assert!(first_scout_response.ok, "{first_scout_response:?}");
        let pathway = {
            let runtime = state.inner.lock().await;
            runtime.journeys[&actor_id].path.clone()
        };

        for step in 1..=3 {
            let next_location_id = {
                let runtime = state.inner.lock().await;
                runtime.journeys[&actor_id].path[step]
            };
            if step == 3 {
                let mut runtime = state.inner.lock().await;
                runtime.append_async_job_event(
                    "pathway.refined",
                    RATI_ACTOR_ID,
                    None,
                    Some("unrelated background refinement".to_string()),
                );
                runtime.append_async_job_event(
                    "pathway.refined",
                    RATI_ACTOR_ID,
                    None,
                    Some("another unrelated background refinement".to_string()),
                );
            }
            let travel = {
                let mut runtime = state.inner.lock().await;
                current_offer(&mut runtime, "move", next_location_id)
            };
            if step == 3 {
                final_travel_offer = Some(travel.clone());
            }
            let travel_response = submit_offer_for_test(
                &state,
                &actor_session,
                "/actions/move",
                travel,
                serde_json::json!({
                    "actor_id": actor_id,
                    "destination_location_id": next_location_id,
                }),
            )
            .await;
            assert!(travel_response.ok, "step {step}: {travel_response:?}");
            {
                let runtime = state.inner.lock().await;
                let first_tale = runtime
                    .first_tale_view(actor_id)
                    .expect("the Garden return remains visible while wandering");
                assert_eq!(first_tale.phase, "return_to_destination");
                assert_eq!(
                    first_tale.required_location_id,
                    Some(RAIN_SOFT_GARDEN_LOCATION_ID)
                );
            }
            if step < 3 {
                let scout = {
                    let mut runtime = state.inner.lock().await;
                    current_offer(&mut runtime, "explore_path", MOONLIT_TRAIL_LOCATION_ID)
                };
                assert!(scout.route.is_some(), "step {step} Scout route binding");
                let scout_response = submit_offer_for_test(
                    &state,
                    &actor_session,
                    "/actions/explore-path",
                    scout,
                    serde_json::json!({
                        "actor_id": actor_id,
                        "destination_location_id": MOONLIT_TRAIL_LOCATION_ID,
                    }),
                )
                .await;
                assert!(scout_response.ok, "step {step}: {scout_response:?}");
            }
        }

        let runtime = state.inner.lock().await;
        assert_eq!(
            runtime.actor_by_id(actor_id).map(|actor| actor.location_id),
            Some(MOONLIT_TRAIL_LOCATION_ID)
        );
        assert!(!runtime.journeys.contains_key(&actor_id));
        assert!(runtime.event_log.iter().any(|event| {
            event.type_name == "journey.completed" && event.actor_id == Some(actor_id)
        }));
        drop(runtime);

        for destination_location_id in pathway[..pathway.len() - 1].iter().rev().copied() {
            let reverse_offer = {
                let mut runtime = state.inner.lock().await;
                current_offer(&mut runtime, "move", destination_location_id)
            };
            let reverse_response = submit_offer_for_test(
                &state,
                &actor_session,
                "/actions/move",
                reverse_offer,
                serde_json::json!({
                    "actor_id": actor_id,
                    "destination_location_id": destination_location_id,
                }),
            )
            .await;
            assert!(reverse_response.ok, "{reverse_response:?}");
        }
        {
            let runtime = state.inner.lock().await;
            assert_eq!(
                runtime
                    .first_tale_view(actor_id)
                    .expect("the Garden contribution returns on backtracking")
                    .phase,
                "contribute"
            );
        }

        let stale_retry = submit_offer_for_test(
            &state,
            &actor_session,
            "/actions/move",
            final_travel_offer.expect("final travel offer was captured"),
            serde_json::json!({
                "actor_id": actor_id,
                "destination_location_id": MOONLIT_TRAIL_LOCATION_ID,
            }),
        )
        .await;
        assert!(!stale_retry.ok);
        assert_eq!(stale_retry.status, 409);
    }
}
