use super::*;

#[derive(Clone, Debug, Serialize)]
pub(super) struct JourneyView {
    pub(super) destination_location_id: u64,
    pub(super) destination_name: String,
    pub(super) current_step: usize,
    pub(super) total_steps: usize,
    pub(super) steps_remaining: usize,
    pub(super) explorer: bool,
    pub(super) next_location_id: Option<u64>,
    pub(super) next_location_name: Option<String>,
}

#[derive(Debug, Serialize)]
pub(super) struct StateResponse {
    pub(super) location: LocationView,
    pub(super) exits: Vec<ExitView>,
    pub(super) actors: Vec<ActorView>,
    pub(super) items: Vec<ItemView>,
    pub(super) factions: Vec<FactionView>,
    pub(super) room_features: Vec<RoomFeatureView>,
    pub(super) search_available: bool,
    pub(super) clocks: Vec<ClockView>,
    pub(super) tags: Vec<TagView>,
    pub(super) jobs: Vec<JobView>,
    pub(super) fronts: Vec<FrontView>,
    pub(super) room_sheet: Option<RoomSheetView>,
    pub(super) journey: Option<JourneyView>,
    pub(super) calling: Option<CallingView>,
    pub(super) skills: Vec<SkillView>,
    pub(super) ledger: VisitLedgerView,
    pub(super) bonds: Vec<BondView>,
    pub(super) chat_bond_claimed_target_ids: Vec<u64>,
    pub(super) cards: CardRegistryView,
    pub(super) card_transactions: Vec<CardTransactionView>,
    pub(super) access: AccessView,
    pub(super) account: AccountView,
    pub(super) economy: EconomyView,
    pub(super) combat: Option<CombatView>,
    pub(super) turn: RoomTurnView,
    pub(super) branch: Option<BranchView>,
    pub(super) recent_events: Vec<EventView>,
    pub(super) room_memory: RoomMemoryView,
    pub(super) primary_action: PrimaryAction,
    pub(super) action_offers: Vec<RankedActionOffer>,
    pub(super) action_hand: ActionHandView,
    pub(super) inspector: InspectorView,
    pub(super) character_creation: Vec<CharacterCreationProfileView>,
}

#[derive(Clone, Debug, Serialize)]
pub(super) struct CombatView {
    pub(super) protocol: &'static str,
    pub(super) encounter_id: u64,
    pub(super) location_id: u64,
    pub(super) round: u16,
    pub(super) current_actor_id: u64,
    pub(super) current_actor_name: Option<String>,
    pub(super) is_current_actor: bool,
    pub(super) available_actions: Vec<&'static str>,
    pub(super) participants: Vec<CombatParticipantView>,
}

#[derive(Clone, Debug, Serialize)]
pub(super) struct CombatParticipantView {
    pub(super) actor_id: u64,
    pub(super) actor_name: Option<String>,
    pub(super) side: u8,
    pub(super) initiative: i16,
    pub(super) status: &'static str,
    pub(super) current_hp: i16,
    pub(super) max_hp: i16,
    pub(super) dodging: bool,
    pub(super) unconscious: bool,
    pub(super) escaped: bool,
}

#[derive(Debug, Serialize)]
pub(super) struct EconomyView {
    pub(super) orbs: i32,
    pub(super) chat_cost_orbs: i32,
    pub(super) can_chat_with_orbs: bool,
    pub(super) inventory_count: usize,
    pub(super) inventory_capacity: usize,
    pub(super) listen_cost_orbs: i32,
    pub(super) listen_reward_claimable: bool,
    pub(super) listen_attempted_here: bool,
    pub(super) openrouter_connected: bool,
    pub(super) chat_payer: String,
    pub(super) wooden_boxes: usize,
    pub(super) unopened_packs: usize,
}

#[derive(Debug, Serialize)]
pub(super) struct WorldResponse {
    pub(super) shared_world: bool,
    pub(super) current_actor_id: Option<u64>,
    pub(super) current_location_id: Option<u64>,
    pub(super) access: AccessView,
    pub(super) factions: Vec<FactionView>,
    pub(super) simulation: WorldSimulationView,
    pub(super) locations: Vec<WorldLocationView>,
}

#[derive(Debug, Serialize)]
pub(super) struct WorldSimulationView {
    pub(super) pulse_interval_ticks: u64,
    pub(super) pulse_index: u64,
    pub(super) last_advanced_tick: u64,
    pub(super) factions: Vec<FactionSimulationView>,
    pub(super) recent_history: Vec<EventView>,
}

#[derive(Clone, Debug, Serialize)]
pub(super) struct LocationSimulationView {
    pub(super) weather: String,
    pub(super) weather_intensity: u8,
    pub(super) trade_stock: i16,
    pub(super) trade_pressure: i8,
    pub(super) imports: BTreeMap<String, u8>,
    pub(super) conflict_pressure: u8,
    pub(super) faction_influence: Vec<FactionInfluenceView>,
    pub(super) last_pulse_tick: u64,
}

#[derive(Clone, Debug, Serialize)]
pub(super) struct FactionInfluenceView {
    pub(super) faction_id: String,
    pub(super) faction_name: String,
    pub(super) influence: u8,
}

#[derive(Debug, Serialize)]
pub(super) struct FactionSimulationView {
    pub(super) faction_id: String,
    pub(super) faction_name: String,
    pub(super) momentum: i16,
    pub(super) last_action_tick: u64,
    pub(super) influenced_location_ids: Vec<u64>,
}

#[derive(Debug, Serialize)]
pub(super) struct WorldLocationView {
    pub(super) id: u64,
    pub(super) pack_id: Option<String>,
    pub(super) name: String,
    pub(super) title: String,
    pub(super) description: String,
    pub(super) persona: String,
    pub(super) memory: Vec<String>,
    pub(super) factions: Vec<FactionRefView>,
    pub(super) simulation: LocationSimulationView,
    pub(super) public: bool,
    pub(super) accessible: bool,
    pub(super) required_grant_id: Option<String>,
    pub(super) required_card_id: Option<String>,
    pub(super) access_reason: Option<String>,
    pub(super) card: CardView,
    pub(super) actor_count: usize,
    pub(super) human_count: usize,
    pub(super) resident_count: usize,
    pub(super) item_count: usize,
    pub(super) actors: Vec<ActorView>,
    pub(super) items: Vec<ItemView>,
    pub(super) exits: Vec<ExitView>,
}

#[derive(Clone, Debug, Serialize)]
pub(super) struct LocationView {
    pub(super) id: u64,
    pub(super) pack_id: Option<String>,
    pub(super) name: String,
    pub(super) title: String,
    pub(super) description: String,
    pub(super) persona: String,
    pub(super) memory: Vec<String>,
    pub(super) factions: Vec<FactionRefView>,
    pub(super) simulation: LocationSimulationView,
}

#[derive(Clone, Debug, Serialize)]
pub(super) struct FactionRefView {
    pub(super) id: String,
    pub(super) name: String,
    pub(super) axis: String,
    pub(super) player_facing: bool,
}

#[derive(Clone, Debug, Serialize)]
pub(super) struct FactionView {
    pub(super) id: String,
    pub(super) name: String,
    pub(super) axis: String,
    pub(super) opposes: Vec<String>,
    pub(super) truth: String,
    pub(super) shadow: String,
    pub(super) doctrine: String,
    pub(super) verbs: Vec<String>,
    pub(super) motif: Vec<String>,
    pub(super) home_location_ids: Vec<u64>,
    pub(super) player_facing: bool,
    pub(super) member_actor_ids: Vec<u64>,
}

#[derive(Debug, Serialize)]
pub(super) struct ExitView {
    pub(super) destination_location_id: u64,
    pub(super) destination_location_name: String,
    pub(super) direction: Option<String>,
    pub(super) distance: u8,
    pub(super) locked: bool,
    pub(super) accessible: bool,
    pub(super) required_grant_id: Option<String>,
    pub(super) required_card_id: Option<String>,
    pub(super) access_reason: Option<String>,
}

#[derive(Debug, Serialize)]
pub(super) struct ActorView {
    pub(super) id: u64,
    pub(super) pack_id: Option<String>,
    pub(super) name: String,
    pub(super) title: String,
    pub(super) description: String,
    pub(super) kind: String,
    pub(super) status: String,
    pub(super) speech_mode: String,
    pub(super) location_id: u64,
    pub(super) factions: Vec<FactionRefView>,
    pub(super) resident_economy: Option<ResidentEconomyView>,
    pub(super) hp: i16,
    pub(super) bloodied: bool,
    pub(super) stats: StatView,
}

#[derive(Clone, Debug, Serialize)]
pub(super) struct ResidentEconomyView {
    pub(super) held_item_ids: Vec<u64>,
    pub(super) held_items: Vec<ResidentHeldItemView>,
    pub(super) inventory_count: usize,
    pub(super) inventory_capacity: usize,
    pub(super) desired_item_ids: Vec<u64>,
    pub(super) sought_item_ids: Vec<u64>,
    pub(super) sought_items: Vec<ResidentSoughtItemView>,
    pub(super) attached_item_ids: Vec<u64>,
    pub(super) seeking_item_id: Option<u64>,
    pub(super) seeking_location_id: Option<u64>,
    pub(super) seeking_location_name: Option<String>,
    pub(super) request: Option<ResidentRequestView>,
    pub(super) trade_offer: Option<ResidentTradeOfferView>,
    pub(super) trade_stance: Option<ResidentTradeStanceView>,
    pub(super) motive: String,
}

#[derive(Clone, Debug, Serialize)]
pub(super) struct ResidentHeldItemView {
    pub(super) item_id: u64,
    pub(super) disposition: String,
    pub(super) reason: String,
    pub(super) keep_score: i16,
}

#[derive(Clone, Debug, Serialize)]
pub(super) struct ResidentSoughtItemView {
    pub(super) item_id: u64,
    pub(super) source: String,
    pub(super) reason: String,
    pub(super) world_status: String,
    pub(super) world_location_id: Option<u64>,
    pub(super) world_location_name: Option<String>,
    pub(super) world_holder_actor_id: Option<u64>,
    pub(super) world_holder_actor_name: Option<String>,
    pub(super) memory_location_id: Option<u64>,
    pub(super) memory_location_name: Option<String>,
    pub(super) holder_actor_id: Option<u64>,
    pub(super) holder_actor_name: Option<String>,
    pub(super) confidence: Option<u8>,
    pub(super) salience: Option<u8>,
}

#[derive(Clone, Debug, Serialize)]
pub(super) struct ResidentRequestView {
    pub(super) item_id: u64,
    pub(super) holder_actor_id: u64,
    pub(super) reason: String,
}

#[derive(Clone, Debug, Serialize)]
pub(super) struct ResidentTradeOfferView {
    pub(super) offered_item_id: u64,
    pub(super) requested_item_id: u64,
    pub(super) willingness: String,
    pub(super) reason: String,
}

#[derive(Clone, Debug, Serialize)]
pub(super) struct ResidentTradeStanceView {
    pub(super) offered_item_id: u64,
    pub(super) requested_item_id: u64,
    pub(super) willingness: String,
    pub(super) reason: String,
    pub(super) accepted: bool,
}

#[derive(Debug, Serialize)]
pub(super) struct StatView {
    pub(super) strength: i8,
    pub(super) dexterity: i8,
    pub(super) constitution: i8,
    pub(super) intelligence: i8,
    pub(super) wisdom: i8,
    pub(super) charisma: i8,
    pub(super) hp_base: i16,
    pub(super) level: u8,
}

#[derive(Debug, Serialize)]
pub(super) struct ItemView {
    pub(super) id: u64,
    pub(super) pack_id: Option<String>,
    pub(super) name: String,
    pub(super) description: String,
    pub(super) kind: String,
    pub(super) location_id: Option<u64>,
    pub(super) holder_actor_id: Option<u64>,
    pub(super) charges: u8,
}

#[derive(Debug, Serialize)]
pub(super) struct RoomFeatureView {
    pub(super) key: String,
    pub(super) name: String,
    pub(super) aliases: Vec<String>,
    pub(super) look: String,
    pub(super) search: String,
    pub(super) searched: bool,
    pub(super) uses: Vec<RoomFeatureUseView>,
}

#[derive(Debug, Serialize)]
pub(super) struct RoomFeatureUseView {
    pub(super) item_id: u64,
    pub(super) feature_key: String,
    pub(super) text: String,
    pub(super) used: bool,
    pub(super) effect: Option<String>,
}

#[derive(Debug, Serialize)]
pub(super) struct ClockView {
    pub(super) id: String,
    pub(super) scope: String,
    pub(super) scope_id: u64,
    pub(super) kind: String,
    pub(super) zone: String,
    pub(super) label: String,
    pub(super) segments: u8,
    pub(super) filled: u8,
    pub(super) status: String,
}

#[derive(Debug, Serialize)]
pub(super) struct TagView {
    pub(super) id: String,
    pub(super) scope: String,
    pub(super) scope_id: u64,
    pub(super) label: String,
    pub(super) kind: String,
    pub(super) expires: Option<String>,
}

#[derive(Debug, Serialize)]
pub(super) struct JobView {
    pub(super) id: String,
    pub(super) premise: String,
    pub(super) stakes: String,
    pub(super) status: String,
    pub(super) progress_clock_id: String,
    pub(super) danger_clock_id: String,
    pub(super) reward: String,
    pub(super) consequence: String,
    pub(super) action_label: String,
    pub(super) action_summary: String,
}

#[derive(Debug, Serialize)]
pub(super) struct FrontView {
    pub(super) id: String,
    pub(super) premise: String,
    pub(super) zone: String,
    pub(super) status: String,
    pub(super) location_ids: Vec<u64>,
    pub(super) participant_ids: Vec<u64>,
    pub(super) participant_names: Vec<String>,
    pub(super) stakes_questions: Vec<String>,
    pub(super) portent_clock_id: String,
    pub(super) job_ids: Vec<String>,
    pub(super) impending_outcome: String,
}

#[derive(Debug, Serialize)]
pub(super) struct RoomSheetView {
    pub(super) id: String,
    pub(super) location_id: u64,
    pub(super) name: String,
    pub(super) safety: String,
    pub(super) zone: String,
    pub(super) aspects: Vec<String>,
    pub(super) boons: Vec<String>,
    pub(super) hooks: Vec<String>,
    pub(super) resources: BTreeMap<String, i16>,
    pub(super) projects: Vec<String>,
}

#[derive(Debug, Serialize)]
pub(super) struct CallingView {
    pub(super) actor_id: u64,
    pub(super) statement: String,
}

#[derive(Debug, Serialize)]
pub(super) struct SkillView {
    pub(super) skill_id: String,
    pub(super) label: String,
    pub(super) rank: u8,
    pub(super) tier: String,
    pub(super) bonus: i16,
}

#[derive(Debug, Serialize)]
pub(super) struct VisitLedgerView {
    pub(super) unbanked_count: usize,
    pub(super) banked_count: usize,
    pub(super) spent_count: usize,
    pub(super) advancement_points: usize,
    pub(super) learned_truth_count: usize,
    pub(super) unbanked_marks: Vec<VisitLedgerMarkView>,
}

#[derive(Debug, Serialize)]
pub(super) struct VisitLedgerMarkView {
    pub(super) id: String,
    pub(super) category: String,
    pub(super) label: String,
    pub(super) source_event_seq: u64,
}

#[derive(Debug, Serialize)]
pub(super) struct BondView {
    pub(super) id: String,
    pub(super) actor_id: u64,
    pub(super) target_actor_id: u64,
    pub(super) target_actor_name: Option<String>,
    pub(super) statement: String,
    pub(super) strength: u8,
    pub(super) status: String,
}

#[derive(Debug, Serialize)]
pub(super) struct InspectorView {
    pub(super) location_id: u64,
    pub(super) room: RoomInspectorView,
    pub(super) suggested_action: Option<ActionInspectorView>,
    pub(super) jobs: Vec<JobInspectorView>,
    pub(super) fronts: Vec<FrontView>,
    pub(super) clocks: Vec<ClockInspectorView>,
    pub(super) lifecycle_hooks: Vec<LifecycleHookInspectorView>,
}

#[derive(Debug, Serialize)]
pub(super) struct RoomInspectorView {
    pub(super) name: String,
    pub(super) zone: String,
    pub(super) safety: Option<String>,
    pub(super) aspects: Vec<String>,
    pub(super) boons: Vec<String>,
    pub(super) hooks: Vec<String>,
    pub(super) resources: BTreeMap<String, i16>,
    pub(super) projects: Vec<String>,
    pub(super) features: Vec<String>,
    pub(super) listen_reason: Option<String>,
}

#[derive(Debug, Serialize)]
pub(super) struct ActionInspectorView {
    pub(super) offer_id: String,
    pub(super) kind: String,
    pub(super) category: String,
    pub(super) label: String,
    pub(super) command: String,
    pub(super) rank: u16,
    pub(super) disabled: bool,
    pub(super) disabled_reason: Option<String>,
    pub(super) zone: String,
    pub(super) source: String,
    pub(super) target: Option<ActionTargetView>,
    pub(super) claim_key: Option<String>,
    pub(super) reason: String,
    pub(super) effect: Option<String>,
    pub(super) risk: Option<String>,
    pub(super) cost_orbs: Option<i32>,
}

#[derive(Debug, Serialize)]
pub(super) struct JobInspectorView {
    pub(super) id: String,
    pub(super) status: String,
    pub(super) premise: String,
    pub(super) needs: Vec<String>,
    pub(super) blockers: Vec<String>,
    pub(super) participants: Vec<String>,
    pub(super) progress_clock_id: String,
    pub(super) danger_clock_id: String,
    pub(super) reward: String,
    pub(super) consequence: String,
}

#[derive(Debug, Serialize)]
pub(super) struct ClockInspectorView {
    pub(super) id: String,
    pub(super) kind: String,
    pub(super) label: String,
    pub(super) zone: String,
    pub(super) filled: u8,
    pub(super) segments: u8,
    pub(super) status: String,
    pub(super) visible_to_players: bool,
    pub(super) updated_event_seq: Option<u64>,
    pub(super) last_delta: Option<i16>,
    pub(super) last_reason: Option<String>,
    pub(super) on_fill: Vec<EffectDescriptor>,
    pub(super) on_fill_effect: Option<String>,
}

#[derive(Debug, Serialize)]
pub(super) struct LifecycleHookInspectorView {
    pub(super) hook: String,
    pub(super) target_kind: String,
    pub(super) target_id: String,
    pub(super) claim_scope: String,
    pub(super) effects: Vec<EffectDescriptor>,
    pub(super) effect: Option<String>,
}

pub(super) fn faction_ref_from_seed(faction: &SeedFactionContent) -> FactionRefView {
    FactionRefView {
        id: faction.id.clone(),
        name: faction.name.clone(),
        axis: faction.axis.clone(),
        player_facing: faction.player_facing,
    }
}

pub(super) fn faction_view_from_seed(faction: &SeedFactionContent) -> FactionView {
    FactionView {
        id: faction.id.clone(),
        name: faction.name.clone(),
        axis: faction.axis.clone(),
        opposes: faction.opposes.clone(),
        truth: faction.truth.clone(),
        shadow: faction.shadow.clone(),
        doctrine: faction.doctrine.clone(),
        verbs: faction.verbs.clone(),
        motif: faction.motif.clone(),
        home_location_ids: faction.home_location_ids.clone(),
        player_facing: faction.player_facing,
        member_actor_ids: effective_faction_member_actor_ids(faction),
    }
}

pub(super) fn faction_views() -> Vec<FactionView> {
    active_content()
        .factions
        .iter()
        .map(faction_view_from_seed)
        .collect()
}

pub(super) fn faction_refs_for_actor(actor_id: u64) -> Vec<FactionRefView> {
    active_content()
        .factions
        .iter()
        .filter(|faction| effective_faction_member_actor_ids(faction).contains(&actor_id))
        .map(faction_ref_from_seed)
        .collect()
}

pub(super) fn faction_refs_for_location(location_id: u64) -> Vec<FactionRefView> {
    active_content()
        .factions
        .iter()
        .filter(|faction| faction.home_location_ids.contains(&location_id))
        .map(faction_ref_from_seed)
        .collect()
}

impl RuntimeWorld {
    pub(super) fn location_view(&self, location_id: u64) -> LocationView {
        let name = self
            .location_name(location_id)
            .unwrap_or_else(|| "Unknown Location".to_string());
        let meta = self.location_meta_for(location_id);
        LocationView {
            id: location_id,
            pack_id: seed_pack_id_for_location(location_id),
            name,
            title: meta.title,
            description: meta.description,
            persona: meta.persona,
            memory: meta.memory,
            factions: faction_refs_for_location(location_id),
            simulation: self.location_simulation_view(location_id),
        }
    }

    pub(super) fn location_simulation_view(&self, location_id: u64) -> LocationSimulationView {
        let state = self
            .world_simulation
            .locations
            .get(&location_id)
            .cloned()
            .unwrap_or_default();
        let mut faction_influence = state
            .faction_influence
            .iter()
            .filter(|(_, influence)| **influence > 0)
            .map(|(faction_id, influence)| FactionInfluenceView {
                faction_id: faction_id.clone(),
                faction_name: active_content()
                    .factions
                    .iter()
                    .find(|faction| faction.id == *faction_id)
                    .map(|faction| faction.name.clone())
                    .unwrap_or_else(|| faction_id.clone()),
                influence: *influence,
            })
            .collect::<Vec<_>>();
        faction_influence.sort_by(|left, right| {
            right
                .influence
                .cmp(&left.influence)
                .then_with(|| left.faction_id.cmp(&right.faction_id))
        });
        LocationSimulationView {
            weather: state.weather,
            weather_intensity: state.weather_intensity,
            trade_stock: state.trade_stock,
            trade_pressure: state.trade_pressure,
            imports: state.imports,
            conflict_pressure: state.conflict_pressure,
            faction_influence,
            last_pulse_tick: state.last_pulse_tick,
        }
    }

    pub(super) fn world_simulation_view(&self) -> WorldSimulationView {
        let mut factions = active_content()
            .factions
            .iter()
            .map(|seed_faction| {
                let state = self
                    .world_simulation
                    .factions
                    .get(&seed_faction.id)
                    .cloned()
                    .unwrap_or_default();
                let mut influenced_location_ids = self
                    .world_simulation
                    .locations
                    .iter()
                    .filter(|(_, location)| {
                        location
                            .faction_influence
                            .get(&seed_faction.id)
                            .is_some_and(|influence| *influence > 0)
                    })
                    .map(|(location_id, _)| *location_id)
                    .collect::<Vec<_>>();
                influenced_location_ids.sort_unstable();
                FactionSimulationView {
                    faction_id: seed_faction.id.clone(),
                    faction_name: seed_faction.name.clone(),
                    momentum: state.momentum,
                    last_action_tick: state.last_action_tick,
                    influenced_location_ids,
                }
            })
            .collect::<Vec<_>>();
        factions.sort_by(|left, right| left.faction_id.cmp(&right.faction_id));
        let mut recent_history = self
            .event_log
            .iter()
            .rev()
            .filter(|event| {
                matches!(
                    event.type_name.as_str(),
                    "world.weather.shifted"
                        | "world.trade.flowed"
                        | "world.trade.disrupted"
                        | "world.faction.influence_shifted"
                        | "world.conflict.pressure_grew"
                        | "world.conflict.pressure_eased"
                        | "world.conflict.escalated"
                )
            })
            .take(48)
            .cloned()
            .collect::<Vec<_>>();
        recent_history.sort_by(|left, right| {
            right
                .source_world_tick
                .cmp(&left.source_world_tick)
                .then_with(|| left.seq.cmp(&right.seq))
        });
        WorldSimulationView {
            pulse_interval_ticks: WORLD_PULSE_INTERVAL_TICKS,
            pulse_index: self.world_simulation.pulse_index,
            last_advanced_tick: self.world_simulation.last_advanced_tick,
            factions,
            recent_history,
        }
    }

    pub(super) fn journey_view(&self, actor_id: u64) -> Option<JourneyView> {
        let journey = self.journeys.get(&actor_id)?;
        let total_steps = journey.path.len().saturating_sub(1);
        let current_location_id = journey.path.get(journey.current_step).copied();
        let next_location_id = journey.path.get(journey.current_step + 1).copied();
        Some(JourneyView {
            destination_location_id: journey.destination_location_id,
            destination_name: journey.destination_name.clone(),
            current_step: journey.current_step,
            total_steps,
            steps_remaining: total_steps.saturating_sub(journey.current_step),
            explorer: journey.explorer,
            next_location_id,
            next_location_name: next_location_id.and_then(|id| {
                if id >= GENERATED_PATHWAY_LOCATION_ID_BASE {
                    let revealed = current_location_id.is_some_and(|current_id| {
                        self.generated_pathways
                            .get(&journey.pathway_id)
                            .is_some_and(|pathway| {
                                pathway
                                    .revealed_edges
                                    .contains(&pathway_edge_key(current_id, id))
                            })
                    });
                    if revealed {
                        self.location_name(id).or_else(|| {
                            self.generated_pathways
                                .get(&journey.pathway_id)
                                .and_then(|pathway| {
                                    pathway.waypoints.iter().find(|waypoint| waypoint.id == id)
                                })
                                .map(|waypoint| waypoint.name.clone())
                        })
                    } else {
                        Some(format!(
                            "Unexplored stretch {}/{} toward {}",
                            journey.current_step + 1,
                            total_steps,
                            journey.destination_name
                        ))
                    }
                } else {
                    self.location_name(id)
                }
            }),
        })
    }

    pub(super) fn actor_view(&self, actor: CwActor) -> ActorView {
        self.actor_view_for_client(actor, None)
    }

    pub(super) fn actor_view_for_client(
        &self,
        actor: CwActor,
        client_actor_id: Option<u64>,
    ) -> ActorView {
        let meta = self.actors.get(&actor.id);
        ActorView {
            id: actor.id,
            pack_id: seed_pack_id_for_actor(actor.id),
            name: meta
                .map(|m| m.name.clone())
                .unwrap_or_else(|| format!("Actor {}", actor.id)),
            title: meta.map(|m| m.title.clone()).unwrap_or_default(),
            description: meta.map(|m| m.description.clone()).unwrap_or_default(),
            kind: actor_kind(actor.kind).to_string(),
            status: actor_status(actor.status).to_string(),
            speech_mode: meta
                .map(|m| m.speech_mode.clone())
                .unwrap_or_else(|| "prose".to_string()),
            location_id: actor.location_id,
            factions: faction_refs_for_actor(actor.id),
            resident_economy: self.resident_economy_view(actor, client_actor_id),
            hp: unsafe { cw_actor_current_hp(&actor) },
            bloodied: unsafe { cw_actor_is_bloodied(&actor) != 0 },
            stats: StatView {
                strength: actor.stats.strength,
                dexterity: actor.stats.dexterity,
                constitution: actor.stats.constitution,
                intelligence: actor.stats.intelligence,
                wisdom: actor.stats.wisdom,
                charisma: actor.stats.charisma,
                hp_base: actor.stats.hp_base,
                level: actor.stats.level,
            },
        }
    }

    pub(super) fn item_view(&self, item: CwItem) -> ItemView {
        let meta = self.items.get(&item.id);
        ItemView {
            id: item.id,
            pack_id: seed_pack_id_for_item(item.id),
            name: meta
                .map(|m| m.name.clone())
                .unwrap_or_else(|| format!("Item {}", item.id)),
            description: meta.map(|m| m.description.clone()).unwrap_or_default(),
            kind: item_kind(item.kind).to_string(),
            location_id: opt_id(item.location_id),
            holder_actor_id: opt_id(item.holder_actor_id),
            charges: item.charges,
        }
    }

    pub(super) fn resident_held_item_view(
        &self,
        resident: CwActor,
        item: CwItem,
    ) -> ResidentHeldItemView {
        let resident_name = self
            .actor_name(resident.id)
            .unwrap_or_else(|| format!("Resident {}", resident.id));
        let item_name = self
            .item_name(item.id)
            .unwrap_or_else(|| format!("Item {}", item.id));
        let keep_score = self.resident_item_keep_score(resident, item);
        let (disposition, reason) = if evolution_item_matches_resident(item.id, resident.id) {
            (
                "identity",
                format!("{resident_name} protects {item_name} because it belongs to their evolution track."),
            )
        } else if self.resident_item_has_feature_use_attachment(resident.id, item.id) {
            (
                "keepsake",
                format!("{resident_name} keeps {item_name} because it mattered in a room moment."),
            )
        } else if let Some(attachment) =
            self.resident_personal_attachment_for_item(resident.id, item.id)
        {
            (
                "attached",
                format!(
                    "{resident_name} protects {item_name}: {}",
                    attachment.reason.trim_end_matches('.')
                ),
            )
        } else if !evolution_item_belongs_to_another_resident(item.id, resident.id)
            && item.holder_actor_id == resident.id
            && item.held_since_tick > 0
            && self.world.tick.saturating_sub(item.held_since_tick) >= 12
        {
            (
                "attached",
                format!("{resident_name} has carried {item_name} long enough to become attached."),
            )
        } else if item.kind == CW_ITEM_POTION && self.resident_healing_target(resident).is_some() {
            (
                "medicine",
                format!("{resident_name} keeps {item_name} as medicine for someone nearby."),
            )
        } else if self
            .resident_feature_use_match_for_item(resident, item.id)
            .is_some()
        {
            (
                "useful",
                format!("{resident_name} can use {item_name} with this room."),
            )
        } else {
            (
                "tradeable",
                format!("{resident_name} may trade {item_name} for something more useful."),
            )
        };
        ResidentHeldItemView {
            item_id: item.id,
            disposition: disposition.to_string(),
            reason,
            keep_score,
        }
    }

    pub(super) fn resident_sought_item_view(
        &self,
        resident: CwActor,
        item_id: u64,
    ) -> ResidentSoughtItemView {
        let memory = self.resident_best_item_memory(resident.id, item_id);
        let world_item = self.item_by_id(item_id);
        let world_status = world_item
            .map(|item| {
                if item.charges == 0 {
                    "spent"
                } else if item.holder_actor_id != 0 {
                    "held"
                } else if item.location_id != 0 {
                    "available"
                } else {
                    "hidden"
                }
            })
            .unwrap_or("missing")
            .to_string();
        let world_holder_actor_id = world_item.and_then(|item| opt_id(item.holder_actor_id));
        let world_location_id = world_item.and_then(|item| {
            world_holder_actor_id
                .and_then(|holder_actor_id| self.actor_by_id(holder_actor_id))
                .map(|holder| holder.location_id)
                .or_else(|| opt_id(item.location_id))
                .or_else(|| {
                    (item.charges > 0).then(|| {
                        active_content()
                            .items
                            .iter()
                            .find(|seed_item| seed_item.id == item_id)
                            .map(|seed_item| seed_item.location_id)
                    })?
                })
        });
        ResidentSoughtItemView {
            item_id,
            source: self
                .resident_sought_item_source(resident, item_id)
                .to_string(),
            reason: self.resident_item_request_reason(resident, item_id),
            world_status,
            world_location_id,
            world_location_name: world_location_id
                .and_then(|location_id| self.location_name(location_id)),
            world_holder_actor_id,
            world_holder_actor_name: world_holder_actor_id
                .and_then(|holder_actor_id| self.actor_name(holder_actor_id)),
            memory_location_id: memory.as_ref().map(|memory| memory.location_id),
            memory_location_name: memory
                .as_ref()
                .and_then(|memory| self.location_name(memory.location_id)),
            holder_actor_id: memory.as_ref().and_then(|memory| memory.holder_actor_id),
            holder_actor_name: memory
                .as_ref()
                .and_then(|memory| memory.holder_actor_id)
                .and_then(|holder_actor_id| self.actor_name(holder_actor_id)),
            confidence: memory.as_ref().map(|memory| memory.confidence),
            salience: memory.as_ref().map(|memory| memory.salience),
        }
    }

    pub(super) fn resident_request_for_holder(
        &self,
        resident: CwActor,
        holder_actor_id: u64,
    ) -> Option<ResidentRequestView> {
        let holder = self.actor_by_id(holder_actor_id)?;
        if holder.kind != CW_ACTOR_HUMAN
            || holder.status != CW_ACTOR_ACTIVE
            || holder.location_id != resident.location_id
        {
            return None;
        }

        let mut candidates: Vec<_> = self
            .actor_held_items(holder_actor_id)
            .into_iter()
            .filter(|item| self.resident_item_is_sought(resident, item.id))
            .map(|item| (self.resident_item_offer_score(resident, item), item.id))
            .collect();
        candidates.sort_by(|left, right| right.0.cmp(&left.0).then_with(|| left.1.cmp(&right.1)));
        let (_, item_id) = candidates.into_iter().next()?;
        Some(ResidentRequestView {
            item_id,
            holder_actor_id,
            reason: self.resident_item_request_reason(resident, item_id),
        })
    }

    pub(super) fn resident_economy_view(
        &self,
        resident: CwActor,
        client_actor_id: Option<u64>,
    ) -> Option<ResidentEconomyView> {
        if resident.kind != CW_ACTOR_NPC {
            return None;
        }
        let held_items_raw = self.actor_held_items(resident.id);
        let inventory_count = held_items_raw.len();
        let inventory_capacity = self.actor_inventory_capacity(resident.id).unwrap_or(0);
        let held_item_ids: Vec<_> = held_items_raw.iter().map(|item| item.id).collect();
        let held_items = held_items_raw
            .iter()
            .copied()
            .map(|item| self.resident_held_item_view(resident, item))
            .collect();
        let desired_item_ids = self.resident_desired_item_ids(resident);
        let sought_item_ids = self.resident_sought_item_ids(resident);
        let sought_items = sought_item_ids
            .iter()
            .copied()
            .map(|item_id| self.resident_sought_item_view(resident, item_id))
            .collect();
        let attached_item_ids = self.resident_attached_item_ids(resident.id);
        let seek_memory = self.resident_memory_seek_target(resident);
        let seeking_item_id = seek_memory.as_ref().map(|memory| memory.subject_id);
        let seeking_location_id = seek_memory.as_ref().map(|memory| memory.location_id);
        let seeking_location_name =
            seeking_location_id.and_then(|location_id| self.location_name(location_id));
        let delivery = self.resident_delivery_candidate(resident);
        let request = client_actor_id
            .and_then(|actor_id| self.resident_request_for_holder(resident, actor_id));
        let trade_stance_candidate = client_actor_id.and_then(|actor_id| {
            self.default_item_trade_stance_candidate_for_target(actor_id, resident.id)
        });
        let trade_offer = trade_stance_candidate
            .as_ref()
            .filter(|candidate| candidate.preference.accepted)
            .map(|candidate| ResidentTradeOfferView {
                offered_item_id: candidate.offered_item.id,
                requested_item_id: candidate.target_item.id,
                willingness: candidate.preference.willingness.to_string(),
                reason: candidate.preference.reason.clone(),
            });
        let trade_stance =
            trade_stance_candidate
                .as_ref()
                .map(|candidate| ResidentTradeStanceView {
                    offered_item_id: candidate.offered_item.id,
                    requested_item_id: candidate.target_item.id,
                    willingness: candidate.preference.willingness.to_string(),
                    reason: candidate.preference.reason.clone(),
                    accepted: candidate.preference.accepted,
                });
        let resident_name = self
            .actor_name(resident.id)
            .unwrap_or_else(|| format!("Resident {}", resident.id));
        let motive = if let Some(request) = request.as_ref() {
            if let Some(holder_name) = self.actor_name(request.holder_actor_id) {
                let reason = request.reason.trim_end_matches('.');
                format!("{reason} from {holder_name}.")
            } else {
                request.reason.clone()
            }
        } else if let Some(delivery) = delivery.as_ref() {
            let item_name = self
                .item_name(delivery.actor_item.id)
                .unwrap_or_else(|| format!("Item {}", delivery.actor_item.id));
            let target_name = self
                .actor_name(delivery.target.id)
                .unwrap_or_else(|| format!("Resident {}", delivery.target.id));
            let location_name = self
                .location_name(delivery.target_location_id)
                .unwrap_or_else(|| format!("Location {}", delivery.target_location_id));
            format!("{resident_name} is carrying {item_name} toward {target_name} near {location_name}.")
        } else if let (Some(item_id), Some(location_name)) =
            (seeking_item_id, seeking_location_name.as_deref())
        {
            let item_name = self
                .item_name(item_id)
                .unwrap_or_else(|| format!("Item {item_id}"));
            if let Some(holder_name) = seek_memory
                .as_ref()
                .and_then(|memory| memory.holder_actor_id)
                .and_then(|holder_actor_id| self.actor_name(holder_actor_id))
            {
                format!(
                    "{resident_name} remembers {item_name} with {holder_name} near {location_name}."
                )
            } else {
                format!("{resident_name} remembers {item_name} near {location_name}.")
            }
        } else if !sought_item_ids.is_empty() {
            format!(
                "{resident_name} seeks {}.",
                self.item_list_label(&sought_item_ids)
            )
        } else if !attached_item_ids.is_empty() {
            format!(
                "{resident_name} is attached to {}.",
                self.item_list_label(&attached_item_ids)
            )
        } else if !held_item_ids.is_empty() {
            format!(
                "{resident_name} carries {} and may trade for something more useful.",
                self.item_list_label(&held_item_ids)
            )
        } else {
            format!("{resident_name} is open to useful gifts and trades.")
        };
        Some(ResidentEconomyView {
            held_item_ids,
            held_items,
            inventory_count,
            inventory_capacity,
            desired_item_ids,
            sought_item_ids,
            sought_items,
            attached_item_ids,
            seeking_item_id,
            seeking_location_id,
            seeking_location_name,
            request,
            trade_offer,
            trade_stance,
            motive,
        })
    }

    pub(super) fn exit_views(&self, location_id: u64, access: &AccessContext) -> Vec<ExitView> {
        self.world.exits[..self.world.exit_count]
            .iter()
            .copied()
            .filter(|exit| exit.from_location_id == location_id)
            .filter(|exit| {
                self.exit_discovered_for_projection(exit.from_location_id, exit.to_location_id)
            })
            .filter(|exit| exit.flags & CW_EXIT_LOCKED == 0)
            .map(|exit| {
                let access_rule = location_access_rule(exit.to_location_id);
                let accessible = location_access_allowed(exit.to_location_id, access);
                ExitView {
                    destination_location_id: exit.to_location_id,
                    destination_location_name: self
                        .location_name(exit.to_location_id)
                        .unwrap_or_else(|| format!("Location {}", exit.to_location_id)),
                    direction: self.exit_direction(exit.from_location_id, exit.to_location_id),
                    distance: self.pathway_distance(exit.from_location_id, exit.to_location_id),
                    locked: false,
                    accessible,
                    required_grant_id: access_rule.required_grant_id.map(ToString::to_string),
                    required_card_id: access_rule.required_card_id.map(ToString::to_string),
                    access_reason: if accessible {
                        None
                    } else {
                        access_rule.reason.map(ToString::to_string)
                    },
                }
            })
            .collect()
    }

    #[cfg(test)]
    pub(super) fn state_response(
        &self,
        actor_id: Option<u64>,
        access: &AccessContext,
    ) -> StateResponse {
        self.state_response_with_presence(actor_id, access, None, false)
    }

    pub(super) fn state_response_with_presence(
        &self,
        actor_id: Option<u64>,
        access: &AccessContext,
        active_human_actor_ids: Option<&BTreeSet<u64>>,
        _openrouter_connected: bool,
    ) -> StateResponse {
        let client_actor_id = actor_id.filter(|id| self.client_actor_can_submit(*id));
        let actor = client_actor_id.and_then(|id| self.actor_by_id(id));
        let location_id = actor.map(|actor| actor.location_id).unwrap_or(1);
        let location = self.location_view(location_id);

        let actors: Vec<ActorView> = self.world.actors[..self.world.actor_count]
            .iter()
            .copied()
            .filter(|actor| actor.location_id == location_id)
            .filter(|actor| {
                self.actor_visible_in_projection(*actor, client_actor_id, active_human_actor_ids)
            })
            .map(|actor| self.actor_view_for_client(actor, client_actor_id))
            .collect();
        let visible_actor_ids = actors.iter().map(|actor| actor.id).collect::<BTreeSet<_>>();

        let items: Vec<ItemView> = self.world.items[..self.world.item_count]
            .iter()
            .copied()
            .filter(|item| {
                (item.location_id == location_id
                    && !self.forgotten_search_item_at_location(*item, location_id))
                    || (item.holder_actor_id != 0
                        && visible_actor_ids.contains(&item.holder_actor_id))
                    || client_actor_id
                        .map(|id| item.holder_actor_id == id)
                        .unwrap_or(false)
            })
            .map(|item| self.item_view(item))
            .collect();

        let exits = self.exit_views(location_id, access);
        let cards = self.card_registry_for(&location, &actors, &items, &exits, access);
        let card_transactions =
            self.card_transaction_views(location_id, &actors, &items, &exits, &cards);
        let access_view = access_view(access, &cards.locations);
        let orbs = client_actor_id.map(|id| self.orb_balance(id)).unwrap_or(0);
        let listen_reward_claimable = client_actor_id
            .map(|id| self.listen_reward_claimable(id))
            .unwrap_or(false);
        let listen_attempted_here = client_actor_id
            .map(|id| self.listen_attempted_here(id))
            .unwrap_or(false);
        let listen_cost_orbs = client_actor_id
            .map(|id| self.listen_cost_orbs(id))
            .unwrap_or(0);
        let chat_bond_claimed_target_ids = client_actor_id
            .map(|id| self.chat_bond_claimed_target_ids(id, location_id))
            .unwrap_or_default();
        let primary_action = self.primary_action(client_actor_id, access);
        let action_offers = self.ranked_action_offers(client_actor_id, access, &primary_action);
        let action_hand = compose_action_hand(&action_offers);
        let inspector = self.inspector_view(location_id, &primary_action, &action_offers);
        let recent_events = self
            .event_log
            .iter()
            .filter(|event| event_visible_in_location(event, location_id))
            .rev()
            .take(80)
            .cloned()
            .collect::<Vec<_>>();
        let room_memory = fallback_room_memory_view(&location, &recent_events);
        StateResponse {
            location,
            exits,
            actors,
            items,
            factions: faction_views(),
            room_features: Vec::new(),
            search_available: client_actor_id
                .map(|id| self.default_search_target(id).is_some())
                .unwrap_or(false),
            clocks: self.clock_views(location_id),
            tags: self.tag_views(client_actor_id, location_id),
            jobs: self.job_views(location_id),
            fronts: self.front_views(location_id),
            room_sheet: self.room_sheet_view(location_id),
            journey: client_actor_id.and_then(|id| self.journey_view(id)),
            calling: client_actor_id.and_then(|id| self.calling_view(id)),
            skills: client_actor_id
                .map(|id| self.skill_views(id))
                .unwrap_or_default(),
            ledger: client_actor_id
                .map(|id| self.visit_ledger_view(id))
                .unwrap_or_else(empty_visit_ledger_view),
            bonds: client_actor_id
                .map(|id| self.bond_views(id))
                .unwrap_or_default(),
            chat_bond_claimed_target_ids,
            cards,
            card_transactions,
            access: access_view,
            account: account_view(access),
            economy: EconomyView {
                orbs,
                chat_cost_orbs: CHAT_ORB_COST,
                can_chat_with_orbs: orbs >= CHAT_ORB_COST,
                inventory_count: client_actor_id
                    .map(|id| self.actor_inventory_count(id))
                    .unwrap_or_default(),
                inventory_capacity: client_actor_id
                    .and_then(|id| self.actor_inventory_capacity(id))
                    .unwrap_or_default(),
                listen_cost_orbs,
                listen_reward_claimable,
                listen_attempted_here,
                openrouter_connected: false,
                chat_payer: "cosyworld_orbs".to_string(),
                wooden_boxes: access.owned_box_ids.len(),
                unopened_packs: access.unopened_pack_ids.len(),
            },
            combat: client_actor_id.and_then(|id| self.combat_view(id, access)),
            turn: RoomTurnView::idle(location_id),
            branch: None,
            recent_events,
            room_memory,
            primary_action,
            action_offers,
            action_hand,
            inspector,
            character_creation: character_creation_views(),
        }
    }

    pub(super) fn combat_view(&self, actor_id: u64, access: &AccessContext) -> Option<CombatView> {
        let encounter = self.active_combat_encounter_for_actor(actor_id)?;
        let current_actor_id = encounter
            .participants
            .get(usize::from(encounter.current_index))?
            .actor_id;
        let is_current_actor = current_actor_id == actor_id;
        let mut available_actions = Vec::new();
        if is_current_actor {
            available_actions.extend(["attack", "dodge"]);
            if self.has_accessible_exit(actor_id, access) {
                available_actions.push("escape");
            }
        }
        let participants = encounter.participants[..encounter.participant_count]
            .iter()
            .filter_map(|participant| {
                let actor = self.actor_by_id(participant.actor_id)?;
                Some(CombatParticipantView {
                    actor_id: actor.id,
                    actor_name: self.actor_name(actor.id),
                    side: participant.side,
                    initiative: participant.initiative,
                    status: actor_status(actor.status),
                    current_hp: unsafe { cw_actor_current_hp(&actor) },
                    max_hp: actor.stats.hp_base,
                    dodging: actor.conditions & CW_CONDITION_DODGING != 0,
                    unconscious: actor.conditions & CW_CONDITION_UNCONSCIOUS != 0,
                    escaped: participant.flags & CW_COMBAT_PARTICIPANT_ESCAPED != 0,
                })
            })
            .collect();
        Some(CombatView {
            protocol: "cosyworld.combat/3",
            encounter_id: encounter.id,
            location_id: encounter.location_id,
            round: encounter.round,
            current_actor_id,
            current_actor_name: self.actor_name(current_actor_id),
            is_current_actor,
            available_actions,
            participants,
        })
    }

    #[allow(dead_code)]
    pub(super) fn room_feature_views(
        &self,
        location_id: u64,
        actor_id: Option<u64>,
    ) -> Vec<RoomFeatureView> {
        self.room_features(location_id)
            .into_iter()
            .map(|feature| {
                let hidden_exit_pending = self
                    .hidden_exit_candidate_for_search(location_id, &feature.key)
                    .is_some();
                let search_reveal_pending = !self
                    .search_reveal_candidates_for_feature(location_id, &feature.key)
                    .is_empty();
                let explicitly_searched = self
                    .room_feature_search_claimed(location_id, &feature.key)
                    || actor_id
                        .map(|id| self.feature_search_claimed(id, location_id, &feature.key))
                        .unwrap_or(false);
                let searched = explicitly_searched
                    || (!hidden_exit_pending
                        && !search_reveal_pending
                        && !self.room_floor_empty(location_id));
                let uses = feature
                    .uses
                    .iter()
                    .map(|use_case| RoomFeatureUseView {
                        item_id: use_case.item_id,
                        feature_key: feature.key.clone(),
                        text: use_case.text.clone(),
                        used: actor_id
                            .map(|id| {
                                self.feature_use_claimed(
                                    id,
                                    location_id,
                                    &feature.key,
                                    use_case.item_id,
                                )
                            })
                            .unwrap_or(false),
                        effect: self.room_feature_use_effect(
                            actor_id,
                            location_id,
                            &feature.key,
                            use_case.item_id,
                        ),
                    })
                    .collect();
                RoomFeatureView {
                    key: feature.key.clone(),
                    name: feature.name.clone(),
                    aliases: feature.aliases.clone(),
                    look: feature.look.clone(),
                    search: feature.search.clone(),
                    searched,
                    uses,
                }
            })
            .collect()
    }

    pub(super) fn clock_views(&self, location_id: u64) -> Vec<ClockView> {
        let mut clock_ids = Vec::new();
        let mut push_clock_id = |clock_id: &str| {
            if !clock_ids.iter().any(|existing| existing == clock_id) {
                clock_ids.push(clock_id.to_string());
            }
        };
        for job in self
            .jobs
            .values()
            .filter(|job| job.location_ids.contains(&location_id))
            .filter(|job| self.job_status(job) == "active")
        {
            push_clock_id(&job.progress_clock_id);
            push_clock_id(&job.danger_clock_id);
        }
        for clock in self.clocks.values().filter(|clock| {
            clock.visible_to_players && clock.scope == "room" && clock.scope_id == location_id
        }) {
            push_clock_id(&clock.id);
        }
        clock_ids
            .into_iter()
            .filter_map(|clock_id| self.clocks.get(&clock_id))
            .filter(|clock| clock.visible_to_players)
            .map(|clock| ClockView {
                id: clock.id.clone(),
                scope: clock.scope.clone(),
                scope_id: clock.scope_id,
                kind: clock.kind.clone(),
                zone: clock_zone(clock).to_string(),
                label: clock.label.clone(),
                segments: clock.segments,
                filled: clock.filled,
                status: clock_status(clock),
            })
            .collect()
    }

    pub(super) fn tag_views(&self, actor_id: Option<u64>, location_id: u64) -> Vec<TagView> {
        self.tags
            .values()
            .filter(|tag| tag.active)
            .filter(|tag| {
                (tag.scope == "room" && tag.scope_id == location_id)
                    || actor_id
                        .map(|id| tag.scope == "actor" && tag.scope_id == id)
                        .unwrap_or(false)
            })
            .map(|tag| TagView {
                id: tag.id.clone(),
                scope: tag.scope.clone(),
                scope_id: tag.scope_id,
                label: tag.label.clone(),
                kind: tag.kind.clone(),
                expires: tag.expires.clone(),
            })
            .collect()
    }

    pub(super) fn job_views(&self, location_id: u64) -> Vec<JobView> {
        self.jobs
            .values()
            .filter(|job| job.location_ids.contains(&location_id))
            .map(|job| JobView {
                id: job.id.clone(),
                premise: job.premise.clone(),
                stakes: job.stakes.clone(),
                status: self.job_status(job),
                progress_clock_id: job.progress_clock_id.clone(),
                danger_clock_id: job.danger_clock_id.clone(),
                reward: job.reward.label().to_string(),
                consequence: job.consequence.clone(),
                action_label: self.job_action_label(job),
                action_summary: self.job_action_summary(job),
            })
            .collect()
    }

    pub(super) fn front_views(&self, location_id: u64) -> Vec<FrontView> {
        active_content()
            .fronts
            .iter()
            .filter(|front| front.location_ids.contains(&location_id))
            .map(|front| FrontView {
                id: front.id.clone(),
                premise: front.premise.clone(),
                zone: front.zone.clone(),
                status: front.status.clone(),
                location_ids: front.location_ids.clone(),
                participant_ids: front.participant_ids.clone(),
                participant_names: front
                    .participant_ids
                    .iter()
                    .map(|actor_id| {
                        self.actor_name(*actor_id)
                            .unwrap_or_else(|| format!("Actor {actor_id}"))
                    })
                    .collect(),
                stakes_questions: front.stakes_questions.clone(),
                portent_clock_id: front.portent_clock_id.clone(),
                job_ids: front.job_ids.clone(),
                impending_outcome: front.impending_outcome.clone(),
            })
            .collect()
    }

    pub(super) fn room_sheet_view(&self, location_id: u64) -> Option<RoomSheetView> {
        self.room_sheets
            .get(&location_id)
            .map(|sheet| RoomSheetView {
                id: sheet.id.clone(),
                location_id: sheet.location_id,
                name: sheet.name.clone(),
                safety: sheet.safety.clone(),
                zone: room_sheet_zone(sheet).to_string(),
                aspects: sheet.aspects.clone(),
                boons: sheet.boons.clone(),
                hooks: sheet.hooks.clone(),
                resources: sheet.resources.clone(),
                projects: sheet.projects.clone(),
            })
            .or_else(|| {
                let pathway = self.generated_pathway_for_location(location_id)?;
                let familiar = pathway.familiar;
                let meta = self.location_meta_for(location_id);
                Some(RoomSheetView {
                    id: format!("generated-pathway-room:{location_id}"),
                    location_id,
                    name: self
                        .location_name(location_id)
                        .unwrap_or_else(|| "Newly Found Path".to_string()),
                    safety: if familiar { "safe" } else { "risky" }.to_string(),
                    zone: if familiar {
                        ZONE_SANCTUARY
                    } else {
                        ZONE_FRONTIER
                    }
                    .to_string(),
                    aspects: if meta.terrain.is_empty() {
                        vec!["unfinished ground".to_string()]
                    } else {
                        meta.terrain.clone()
                    },
                    boons: vec![if familiar {
                        "Travelers know how to find their footing here.".to_string()
                    } else {
                        "Every careful hand helps the route take shape.".to_string()
                    }],
                    hooks: vec![if familiar {
                        "The settled way remembers who helped make it familiar.".to_string()
                    } else {
                        "Work together until the wild way becomes familiar.".to_string()
                    }],
                    resources: BTreeMap::new(),
                    projects: vec![generated_pathway_job_id(&pathway.id)],
                })
            })
    }

    pub(super) fn inspector_view(
        &self,
        location_id: u64,
        primary_action: &PrimaryAction,
        action_offers: &[RankedActionOffer],
    ) -> InspectorView {
        let room_sheet = self.room_sheets.get(&location_id);
        let zone = room_sheet
            .map(|sheet| room_sheet_zone(sheet).to_string())
            .unwrap_or_else(|| default_zone_for_scope("room", location_id).to_string());
        let features = Vec::new();
        let listen_offer = action_offers.iter().find(|offer| offer.kind == "check");
        let listen_reason = listen_offer
            .map(|offer| {
                let effect = offer
                    .effect
                    .clone()
                    .unwrap_or_else(|| "lets the room share one useful clue".to_string());
                format!("Listen is suggested from the check offer; {effect}")
            })
            .or_else(|| {
                self.active_progress_clock_id_for_location(location_id)
                    .map(|clock_id| {
                        format!(
                            "Listen can feed {clock_id}, but it is not currently the top offer."
                        )
                    })
            });
        let suggested_action = action_offers
            .iter()
            .find(|offer| offer.kind == primary_action.kind)
            .or_else(|| action_offers.first())
            .map(|offer| ActionInspectorView {
                offer_id: offer.id.clone(),
                kind: offer.kind.clone(),
                category: offer.category.clone(),
                label: offer.label.clone(),
                command: offer.command.clone(),
                rank: offer.rank,
                disabled: offer.disabled,
                disabled_reason: offer.disabled_reason.clone(),
                zone: offer.zone.clone(),
                source: offer.source.clone(),
                target: offer.target.clone(),
                claim_key: offer.claim_key.clone(),
                reason: offer.reason.clone(),
                effect: offer.effect.clone(),
                risk: offer.risk.clone(),
                cost_orbs: offer.cost.as_ref().map(|cost| cost.orbs),
            });

        InspectorView {
            location_id,
            room: RoomInspectorView {
                name: self
                    .location_name(location_id)
                    .unwrap_or_else(|| format!("Location {location_id}")),
                zone,
                safety: room_sheet.map(|sheet| sheet.safety.clone()),
                aspects: room_sheet
                    .map(|sheet| sheet.aspects.clone())
                    .unwrap_or_default(),
                boons: room_sheet
                    .map(|sheet| sheet.boons.clone())
                    .unwrap_or_default(),
                hooks: room_sheet
                    .map(|sheet| sheet.hooks.clone())
                    .unwrap_or_default(),
                resources: room_sheet
                    .map(|sheet| sheet.resources.clone())
                    .unwrap_or_default(),
                projects: room_sheet
                    .map(|sheet| sheet.projects.clone())
                    .unwrap_or_default(),
                features,
                listen_reason,
            },
            suggested_action,
            jobs: self.job_inspector_views(location_id),
            fronts: self.front_views(location_id),
            clocks: self.clock_inspector_views(location_id),
            lifecycle_hooks: self.lifecycle_hook_inspector_views(location_id),
        }
    }

    pub(super) fn job_inspector_views(&self, location_id: u64) -> Vec<JobInspectorView> {
        self.jobs
            .values()
            .filter(|job| job.location_ids.contains(&location_id))
            .map(|job| {
                let progress = self.clocks.get(&job.progress_clock_id);
                let danger = self.clocks.get(&job.danger_clock_id);
                let mut needs = Vec::new();
                if let Some(clock) = progress {
                    let remaining = clock.segments.saturating_sub(clock.filled);
                    if remaining > 0 {
                        needs.push(format!("{remaining} progress segments"));
                    }
                }
                if needs.is_empty() {
                    needs.push("progress clock filled".to_string());
                }
                let mut blockers = Vec::new();
                if danger
                    .map(|clock| clock.filled >= clock.segments)
                    .unwrap_or(false)
                {
                    blockers.push("danger clock filled".to_string());
                }
                let participants = job
                    .participant_ids
                    .iter()
                    .map(|actor_id| {
                        self.actor_name(*actor_id)
                            .unwrap_or_else(|| format!("Actor {actor_id}"))
                    })
                    .collect();
                JobInspectorView {
                    id: job.id.clone(),
                    status: self.job_status(job),
                    premise: job.premise.clone(),
                    needs,
                    blockers,
                    participants,
                    progress_clock_id: job.progress_clock_id.clone(),
                    danger_clock_id: job.danger_clock_id.clone(),
                    reward: job.reward.label().to_string(),
                    consequence: job.consequence.clone(),
                }
            })
            .collect()
    }

    pub(super) fn clock_inspector_views(&self, location_id: u64) -> Vec<ClockInspectorView> {
        self.clocks
            .values()
            .filter(|clock| clock.scope == "room" && clock.scope_id == location_id)
            .map(|clock| {
                let last_event = self.event_log.iter().rev().find(|event| {
                    event.type_name == "clock.updated"
                        && event.clock_id.as_deref() == Some(clock.id.as_str())
                });
                ClockInspectorView {
                    id: clock.id.clone(),
                    kind: clock.kind.clone(),
                    label: clock.label.clone(),
                    zone: clock_zone(clock).to_string(),
                    filled: clock.filled,
                    segments: clock.segments,
                    status: clock_status(clock),
                    visible_to_players: clock.visible_to_players,
                    updated_event_seq: clock.updated_event_seq,
                    last_delta: last_event.and_then(|event| event.clock_delta),
                    last_reason: last_event.and_then(|event| event.content.clone()),
                    on_fill: clock.on_fill.clone(),
                    on_fill_effect: summarize_effects(&clock.on_fill),
                }
            })
            .collect()
    }

    pub(super) fn lifecycle_hook_inspector_views(
        &self,
        location_id: u64,
    ) -> Vec<LifecycleHookInspectorView> {
        let room_actor_ids: BTreeSet<String> = self.world.actors[..self.world.actor_count]
            .iter()
            .filter(|actor| actor.location_id == location_id)
            .map(|actor| actor.id.to_string())
            .collect();
        let room_item_ids: BTreeSet<String> = self.world.items[..self.world.item_count]
            .iter()
            .filter(|item| item.location_id == location_id)
            .map(|item| item.id.to_string())
            .collect();
        let room_clock_ids: BTreeSet<String> = self
            .clocks
            .values()
            .filter(|clock| clock.scope == "room" && clock.scope_id == location_id)
            .map(|clock| clock.id.clone())
            .collect();
        active_content()
            .lifecycle_hooks
            .iter()
            .filter(|hook| match hook.target_kind.as_str() {
                "room" => hook.target_id == location_id.to_string(),
                "actor" => room_actor_ids.contains(&hook.target_id),
                "item" => room_item_ids.contains(&hook.target_id),
                "clock" => room_clock_ids.contains(&hook.target_id),
                _ => false,
            })
            .map(|hook| LifecycleHookInspectorView {
                hook: hook.hook.clone(),
                target_kind: hook.target_kind.clone(),
                target_id: hook.target_id.clone(),
                claim_scope: hook.claim_scope.clone(),
                effects: hook.effects.clone(),
                effect: summarize_effects(&hook.effects),
            })
            .collect()
    }

    pub(super) fn calling_view(&self, actor_id: u64) -> Option<CallingView> {
        self.callings.get(&actor_id).map(|calling| CallingView {
            actor_id: calling.actor_id,
            statement: calling.statement.clone(),
        })
    }

    pub(super) fn skill_views(&self, actor_id: u64) -> Vec<SkillView> {
        let mut skills: Vec<_> = self
            .skills
            .values()
            .filter(|skill| skill.actor_id == actor_id && skill.rank > 0)
            .map(|skill| SkillView {
                skill_id: skill.skill_id.clone(),
                label: skill.label.clone(),
                rank: skill.rank,
                tier: skill_rank_label(skill.rank).to_string(),
                bonus: skill_bonus_for_rank(skill.rank),
            })
            .collect();
        skills.sort_by(|a, b| a.label.cmp(&b.label));
        skills
    }

    pub(super) fn visit_ledger_view(&self, actor_id: u64) -> VisitLedgerView {
        let mut marks: Vec<_> = self
            .ledger_marks
            .values()
            .filter(|mark| mark.actor_id == actor_id && !mark.banked)
            .map(|mark| VisitLedgerMarkView {
                id: mark.id.clone(),
                category: mark.category.clone(),
                label: mark.label.clone(),
                source_event_seq: mark.source_event_seq,
            })
            .collect();
        marks.sort_by_key(|mark| mark.source_event_seq);
        let banked_count = self
            .ledger_marks
            .values()
            .filter(|mark| mark.actor_id == actor_id && mark.banked)
            .count();
        let spent_count = self.advancement_spent_count(actor_id);
        let learned_truth_count = self
            .ledger_marks
            .values()
            .filter(|mark| mark.actor_id == actor_id && mark.category == "learned_truth")
            .count();
        VisitLedgerView {
            unbanked_count: marks.len(),
            banked_count,
            spent_count,
            advancement_points: banked_count.saturating_sub(spent_count),
            learned_truth_count,
            unbanked_marks: marks,
        }
    }

    pub(super) fn bond_views(&self, actor_id: u64) -> Vec<BondView> {
        let mut bonds: Vec<_> = self
            .bonds
            .values()
            .filter(|bond| bond.actor_id == actor_id && bond.status != "resolved")
            .map(|bond| BondView {
                id: bond.id.clone(),
                actor_id: bond.actor_id,
                target_actor_id: bond.target_actor_id,
                target_actor_name: self.actor_name(bond.target_actor_id),
                statement: bond.statement.clone(),
                strength: bond.strength,
                status: bond.status.clone(),
            })
            .collect();
        bonds.sort_by(|a, b| {
            a.target_actor_name
                .cmp(&b.target_actor_name)
                .then_with(|| a.id.cmp(&b.id))
        });
        bonds
    }

    pub(super) fn chat_bond_claimed_target_ids(&self, actor_id: u64, location_id: u64) -> Vec<u64> {
        let mut target_ids: Vec<_> = self.world.actors[..self.world.actor_count]
            .iter()
            .filter(|target| {
                target.id != actor_id
                    && target.kind == CW_ACTOR_NPC
                    && target.status == CW_ACTOR_ACTIVE
                    && target.location_id == location_id
                    && self
                        .rpg_claims
                        .contains(&chat_bond_claim_key(actor_id, target.id))
            })
            .map(|target| target.id)
            .collect();
        target_ids.sort_unstable();
        target_ids
    }

    #[cfg(test)]
    pub(super) fn world_response(
        &self,
        actor_id: Option<u64>,
        access: &AccessContext,
    ) -> WorldResponse {
        self.world_response_with_presence(actor_id, access, None)
    }

    pub(super) fn world_response_with_presence(
        &self,
        actor_id: Option<u64>,
        access: &AccessContext,
        active_human_actor_ids: Option<&BTreeSet<u64>>,
    ) -> WorldResponse {
        let client_actor_id = actor_id.filter(|id| self.client_actor_can_submit(*id));
        let current_location_id = client_actor_id
            .and_then(|id| self.actor_by_id(id))
            .map(|actor| actor.location_id);
        let visible_location_ids: BTreeSet<u64> = self.world.locations[..self.world.location_count]
            .iter()
            .filter_map(|location| {
                let is_current = current_location_id == Some(location.id);
                let default_start = current_location_id.is_none()
                    && content_registry().entry_location_id() == Some(location.id);
                let discovered = self.location_discovered_by_search(location.id);
                let generated = self.generated_location_is_revealed(location.id);
                (is_current || default_start || discovered || generated).then_some(location.id)
            })
            .collect();

        let mut location_cards = BTreeMap::new();
        for location in self.world.locations[..self.world.location_count]
            .iter()
            .filter(|location| visible_location_ids.contains(&location.id))
        {
            let name = self
                .location_name(location.id)
                .unwrap_or_else(|| format!("Location {}", location.id));
            let meta = self.location_meta_for(location.id);
            location_cards.insert(
                location.id,
                apply_location_access(
                    card_for_location(location.id, &name, Some(&meta)),
                    location.id,
                    access,
                ),
            );
        }
        let access_view = access_view(access, &location_cards);

        let locations = self.world.locations[..self.world.location_count]
            .iter()
            .filter(|location| visible_location_ids.contains(&location.id))
            .map(|location| {
                let name = self
                    .location_name(location.id)
                    .unwrap_or_else(|| format!("Location {}", location.id));
                let meta = self.location_meta_for(location.id);
                let access_rule = location_access_rule(location.id);
                let accessible = location_access_allowed(location.id, access);
                let actors_in_location: Vec<CwActor> = self.world.actors[..self.world.actor_count]
                    .iter()
                    .copied()
                    .filter(|actor| actor.location_id == location.id)
                    .collect();
                let visible_actors_in_location: Vec<CwActor> = actors_in_location
                    .iter()
                    .copied()
                    .filter(|actor| {
                        self.actor_visible_in_projection(
                            *actor,
                            client_actor_id,
                            active_human_actor_ids,
                        )
                    })
                    .collect();
                let items_in_location: Vec<CwItem> = self.world.items[..self.world.item_count]
                    .iter()
                    .copied()
                    .filter(|item| {
                        item.location_id == location.id
                            && !self.forgotten_search_item_at_location(*item, location.id)
                    })
                    .collect();
                let human_count = visible_actors_in_location
                    .iter()
                    .filter(|actor| actor.kind == CW_ACTOR_HUMAN)
                    .count();
                let resident_count = visible_actors_in_location
                    .iter()
                    .filter(|actor| actor.kind == CW_ACTOR_NPC)
                    .count();
                let actors = accessible
                    .then(|| {
                        visible_actors_in_location
                            .iter()
                            .copied()
                            .map(|actor| self.actor_view(actor))
                            .collect()
                    })
                    .unwrap_or_default();
                let items = accessible
                    .then(|| {
                        items_in_location
                            .iter()
                            .copied()
                            .map(|item| self.item_view(item))
                            .collect()
                    })
                    .unwrap_or_default();
                let exits = accessible
                    .then(|| self.exit_views(location.id, access))
                    .unwrap_or_default();
                let card = location_cards
                    .get(&location.id)
                    .cloned()
                    .unwrap_or_else(|| {
                        apply_location_access(
                            card_for_location(location.id, &name, Some(&meta)),
                            location.id,
                            access,
                        )
                    });

                WorldLocationView {
                    id: location.id,
                    pack_id: seed_pack_id_for_location(location.id),
                    name,
                    title: meta.title,
                    description: meta.description,
                    persona: meta.persona,
                    memory: meta.memory,
                    factions: faction_refs_for_location(location.id),
                    simulation: self.location_simulation_view(location.id),
                    public: access_rule.required_grant_id.is_none()
                        && access_rule.required_card_id.is_none(),
                    accessible,
                    required_grant_id: access_rule.required_grant_id.map(ToString::to_string),
                    required_card_id: access_rule.required_card_id.map(ToString::to_string),
                    access_reason: if accessible {
                        None
                    } else {
                        access_rule.reason.map(ToString::to_string)
                    },
                    card,
                    actor_count: visible_actors_in_location.len(),
                    human_count,
                    resident_count,
                    item_count: items_in_location.len(),
                    actors,
                    items,
                    exits,
                }
            })
            .collect();

        WorldResponse {
            shared_world: true,
            current_actor_id: client_actor_id,
            current_location_id,
            access: access_view,
            factions: faction_views(),
            simulation: self.world_simulation_view(),
            locations,
        }
    }
}
