use std::collections::VecDeque;
use std::error::Error;

use serde::Serialize;

use super::{
    adapt_ranking_to_hand, adapt_scored_ranking_to_hand, card_kind_code_q15, CardPolicyAction,
    CardPolicyCandidateSample, CardPolicyModel, CardPolicySample, CARD_POLICY_DEFAULT_TOP_K,
    CARD_POLICY_FEATURES, CARD_POLICY_MAX_TOP_K,
};

const MAX_NODES: usize = 16;
const NONE_NODE: u8 = u8::MAX;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
pub struct SyntheticDatasetConfig {
    pub worlds: u32,
    pub trajectories_per_world: u16,
    pub max_steps: u16,
    pub min_nodes: u8,
    pub max_nodes: u8,
    pub seed: u64,
    /// Percentage of behavior decisions that follow the oracle top-3 adapter.
    /// The remaining decisions uniformly explore A, B, and DRAW.
    pub oracle_behavior_percent: u8,
}

impl Default for SyntheticDatasetConfig {
    fn default() -> Self {
        Self {
            worlds: 1_000,
            trajectories_per_world: 4,
            max_steps: 48,
            min_nodes: 7,
            max_nodes: 12,
            seed: 1,
            oracle_behavior_percent: 70,
        }
    }
}

impl SyntheticDatasetConfig {
    fn validate(self) -> Result<Self, Box<dyn Error>> {
        if self.worlds == 0 || self.trajectories_per_world == 0 || self.max_steps == 0 {
            return Err("worlds, trajectories, and max-steps must be positive".into());
        }
        if self.min_nodes < 4
            || self.max_nodes < self.min_nodes
            || usize::from(self.max_nodes) > MAX_NODES
        {
            return Err("synthetic nodes must satisfy 4 <= min <= max <= 16".into());
        }
        if self.oracle_behavior_percent > 100 {
            return Err("oracle-behavior-percent must be at most 100".into());
        }
        Ok(self)
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum SyntheticCard {
    Move(u8),
    Search,
}

#[derive(Debug, Clone)]
struct SyntheticWorld {
    adjacency: Vec<Vec<u8>>,
    decks: Vec<Vec<SyntheticCard>>,
    treasure: u8,
}

impl SyntheticWorld {
    fn generate(seed: u64, min_nodes: u8, max_nodes: u8) -> Self {
        let mut random = SplitMix64::new(seed);
        let node_count =
            usize::from(min_nodes) + random.bounded(usize::from(max_nodes - min_nodes) + 1);
        let mut adjacency = vec![Vec::<u8>::new(); node_count];
        for node in 0..node_count {
            add_edge(&mut adjacency, node, (node + 1) % node_count);
        }
        for _ in 0..(node_count / 2 + 1) {
            let left = random.bounded(node_count);
            let mut right = random.bounded(node_count - 1);
            if right >= left {
                right += 1;
            }
            add_edge(&mut adjacency, left, right);
        }
        for neighbors in &mut adjacency {
            neighbors.sort_unstable();
        }
        let mut decks = Vec::with_capacity(node_count);
        for (node, neighbors) in adjacency.iter().enumerate() {
            let mut deck = Vec::with_capacity(neighbors.len() + 1);
            deck.push(SyntheticCard::Search);
            deck.extend(neighbors.iter().copied().map(SyntheticCard::Move));
            let mut deck_random =
                SplitMix64::new(seed ^ (node as u64).wrapping_mul(0xd6e8_feb8_6659_fd93));
            for index in (1..deck.len()).rev() {
                let swap_index = deck_random.bounded(index + 1);
                deck.swap(index, swap_index);
            }
            decks.push(deck);
        }
        let treasure = (1 + random.bounded(node_count - 1)) as u8;
        Self {
            adjacency,
            decks,
            treasure,
        }
    }

    fn deck(&self, location: u8) -> &[SyntheticCard] {
        &self.decks[usize::from(location)]
    }

    fn hand_indices(&self, location: u8, page: u8) -> [Option<usize>; 2] {
        let deck_len = self.deck(location).len();
        let first = usize::from(page) % deck_len;
        let second = (deck_len > 1).then_some((first + 1) % deck_len);
        [Some(first), second]
    }

    fn next_page(&self, location: u8, page: u8) -> u8 {
        ((usize::from(page) + 2) % self.deck(location).len()) as u8
    }

    fn shortest_hint(&self, from: u8) -> Option<u8> {
        if from == self.treasure {
            return None;
        }
        let mut queue = VecDeque::from([from]);
        let mut parent = [NONE_NODE; MAX_NODES];
        parent[usize::from(from)] = from;
        while let Some(node) = queue.pop_front() {
            for &neighbor in &self.adjacency[usize::from(node)] {
                if parent[usize::from(neighbor)] != NONE_NODE {
                    continue;
                }
                parent[usize::from(neighbor)] = node;
                if neighbor == self.treasure {
                    let mut cursor = neighbor;
                    while parent[usize::from(cursor)] != from {
                        cursor = parent[usize::from(cursor)];
                    }
                    return Some(cursor);
                }
                queue.push_back(neighbor);
            }
        }
        None
    }

    fn semantic_cost_to_treasure(&self, from: u8) -> u16 {
        let mut queue = VecDeque::from([(from, 0_u16)]);
        let mut seen = [false; MAX_NODES];
        seen[usize::from(from)] = true;
        while let Some((node, distance)) = queue.pop_front() {
            if node == self.treasure {
                return distance.saturating_add(1); // final SEARCH
            }
            for &neighbor in &self.adjacency[usize::from(node)] {
                if !seen[usize::from(neighbor)] {
                    seen[usize::from(neighbor)] = true;
                    queue.push_back((neighbor, distance.saturating_add(1)));
                }
            }
        }
        u16::MAX
    }

    fn card_loss(&self, location: u8, card: SyntheticCard) -> u16 {
        match card {
            SyntheticCard::Search if location == self.treasure => 1,
            SyntheticCard::Search => self.semantic_cost_to_treasure(location).saturating_add(1),
            SyntheticCard::Move(target) => self.semantic_cost_to_treasure(target).saturating_add(1),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct EpisodeState {
    location: u8,
    previous: u8,
    visited_mask: u16,
    searched_mask: u16,
    visit_counts: [u8; MAX_NODES],
    used_edges: [u16; MAX_NODES],
    hint_neighbor: u8,
    page: u8,
    draws_since_progress: u8,
    steps: u16,
    found: bool,
}

impl EpisodeState {
    fn initial(page: u8) -> Self {
        let mut visit_counts = [0; MAX_NODES];
        visit_counts[0] = 1;
        Self {
            location: 0,
            previous: NONE_NODE,
            visited_mask: 1,
            searched_mask: 0,
            visit_counts,
            used_edges: [0; MAX_NODES],
            hint_neighbor: NONE_NODE,
            page,
            draws_since_progress: 0,
            steps: 0,
            found: false,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct SyntheticRanking {
    ranked_candidate_indices: Vec<usize>,
    scores_q8: Vec<i32>,
}

pub fn generate_synthetic_dataset(
    config: SyntheticDatasetConfig,
) -> Result<Vec<CardPolicySample>, Box<dyn Error>> {
    let config = config.validate()?;
    let mut rows = Vec::new();
    for world_index in 0..config.worlds {
        let world_seed = split_seed(config.seed, u64::from(world_index));
        let world = SyntheticWorld::generate(world_seed, config.min_nodes, config.max_nodes);
        for trajectory_index in 0..config.trajectories_per_world {
            let initial_page = ((usize::from(trajectory_index) * 2) % world.deck(0).len()) as u8;
            let mut state = EpisodeState::initial(initial_page);
            let mut behavior_random = SplitMix64::new(split_seed(
                world_seed,
                u64::from(trajectory_index).wrapping_add(0xa5a5),
            ));
            for step in 0..config.max_steps {
                if state.found {
                    break;
                }
                let candidates = encoded_candidates(&world, &state, config.max_steps);
                let hand_candidate_indices = world.hand_indices(state.location, state.page);
                let row = CardPolicySample {
                    sample_id: format!("w{world_seed:016x}/t{trajectory_index}/s{step}"),
                    world_seed,
                    hand_candidate_indices,
                    candidates,
                };
                let action =
                    if behavior_random.bounded(100) < usize::from(config.oracle_behavior_percent) {
                        adapt_ranking_to_hand(
                            &row.oracle_ranking()?,
                            hand_candidate_indices,
                            CARD_POLICY_DEFAULT_TOP_K,
                        )?
                    } else {
                        random_valid_action(&mut behavior_random, hand_candidate_indices)
                    };
                rows.push(row);
                apply_adapter_action(&world, &mut state, action)?;
            }
        }
    }
    if rows.is_empty() {
        return Err("synthetic generator produced no rows".into());
    }
    Ok(rows)
}

fn encoded_candidates(
    world: &SyntheticWorld,
    state: &EpisodeState,
    max_steps: u16,
) -> Vec<CardPolicyCandidateSample> {
    world
        .deck(state.location)
        .iter()
        .copied()
        .map(|card| CardPolicyCandidateSample {
            features_q15: candidate_features(world, state, max_steps, card),
            child_loss: world.card_loss(state.location, card),
        })
        .collect()
}

fn candidate_features(
    world: &SyntheticWorld,
    state: &EpisodeState,
    max_steps: u16,
    card: SyntheticCard,
) -> [i16; CARD_POLICY_FEATURES] {
    let mut features = [0_i16; CARD_POLICY_FEATURES];
    let node_count = world.adjacency.len();
    features[0] = fraction_q15(node_count, MAX_NODES);
    features[1] = fraction_q15(world.adjacency[usize::from(state.location)].len(), 8);
    features[2] = fraction_q15(state.visited_mask.count_ones() as usize, node_count);
    features[3] = fraction_q15(state.searched_mask.count_ones() as usize, node_count);
    features[4] = fraction_q15(
        usize::from(max_steps.saturating_sub(state.steps)),
        usize::from(max_steps),
    );
    features[5] = bool_q15(state.visit_counts[usize::from(state.location)] > 1);
    features[6] = bool_q15(has_bit(state.searched_mask, state.location));
    features[7] = bool_q15(state.hint_neighbor != NONE_NODE);
    features[8] = fraction_q15(world.deck(state.location).len(), 8);
    features[9] = bool_q15(state.previous != NONE_NODE);
    features[10] = fraction_q15(usize::from(state.draws_since_progress.min(4)), 4);
    features[11] = i16::MAX;

    let (is_move, is_search, target) = match card {
        SyntheticCard::Move(target) => (true, false, target),
        SyntheticCard::Search => (false, true, state.location),
    };
    let target_visits = state.visit_counts[usize::from(target)];
    features[12] = bool_q15(is_move);
    features[13] = bool_q15(is_search);
    features[14] = card_kind_code_q15(if is_move { "move" } else { "search" });
    features[15] = bool_q15(target_visits > 0);
    features[16] = bool_q15(has_bit(state.searched_mask, target));
    features[17] = fraction_q15(world.adjacency[usize::from(target)].len(), 8);
    features[18] = bool_q15(is_move && state.hint_neighbor == target);
    features[19] = bool_q15(state.previous == target);
    features[20] = bool_q15(is_move && edge_was_used(&state.used_edges, state.location, target));
    features[21] = fraction_q15(usize::from(target_visits.min(4)), 4);
    features[22] = fraction_q15(if is_move { 60 } else { 65 }, 100);
    features[23] = i16::MAX;
    features
}

fn random_valid_action(
    random: &mut SplitMix64,
    hand_candidate_indices: [Option<usize>; 2],
) -> CardPolicyAction {
    let count = if hand_candidate_indices[1].is_some() {
        3
    } else {
        2
    };
    match random.bounded(count) {
        0 => CardPolicyAction::A,
        1 if count == 3 => CardPolicyAction::B,
        _ => CardPolicyAction::Draw,
    }
}

fn apply_adapter_action(
    world: &SyntheticWorld,
    state: &mut EpisodeState,
    action: CardPolicyAction,
) -> Result<(), Box<dyn Error>> {
    state.steps = state.steps.saturating_add(1);
    if action == CardPolicyAction::Draw {
        state.page = world.next_page(state.location, state.page);
        state.draws_since_progress = state.draws_since_progress.saturating_add(1);
        return Ok(());
    }
    let slot = action.index();
    let candidate_index = world.hand_indices(state.location, state.page)[slot]
        .ok_or("synthetic adapter selected an empty hand slot")?;
    match world.deck(state.location)[candidate_index] {
        SyntheticCard::Move(target) => {
            mark_edge_used(&mut state.used_edges, state.location, target);
            state.previous = state.location;
            state.location = target;
            state.visited_mask |= 1_u16 << target;
            state.visit_counts[usize::from(target)] =
                state.visit_counts[usize::from(target)].saturating_add(1);
            state.hint_neighbor = NONE_NODE;
            state.page = 0;
            state.draws_since_progress = 0;
        }
        SyntheticCard::Search => {
            state.searched_mask |= 1_u16 << state.location;
            state.found = state.location == world.treasure;
            state.hint_neighbor = world.shortest_hint(state.location).unwrap_or(NONE_NODE);
            state.draws_since_progress = 0;
        }
    }
    Ok(())
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize)]
pub struct SyntheticPolicyMetrics {
    pub top_k: usize,
    pub episodes: usize,
    pub treasures_found: usize,
    pub treasure_success_per_mille: usize,
    pub total_turns: usize,
    pub total_draws: usize,
    pub total_cards_played: usize,
    pub draw_rate_per_mille: usize,
    pub mean_turns_milli: usize,
    pub mean_turns_to_treasure_milli: usize,
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize)]
pub struct SyntheticTurnPercentiles {
    pub minimum: usize,
    pub p50: usize,
    pub p90: usize,
    pub p99: usize,
    pub maximum: usize,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize)]
pub struct SyntheticPopulationPolicyMetrics {
    #[serde(flatten)]
    pub policy: SyntheticPolicyMetrics,
    pub timed_out: usize,
    pub all_episode_turns: SyntheticTurnPercentiles,
    pub successful_episode_turns: SyntheticTurnPercentiles,
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize)]
pub struct SyntheticHistoryInfluenceMetrics {
    pub decisions_after_history: usize,
    pub full_ranking_changed: usize,
    pub full_ranking_changed_per_mille: usize,
    pub top_card_changed: usize,
    pub top_card_changed_per_mille: usize,
    pub adapter_action_changed: usize,
    pub adapter_action_changed_per_mille: usize,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct SyntheticPopulationReport {
    pub schema_version: u32,
    pub model_hash: u64,
    pub worlds: u32,
    pub avatars_per_world: u16,
    pub avatars: usize,
    pub top_k: usize,
    pub max_steps: u16,
    pub seed: u64,
    pub personalized: SyntheticPopulationPolicyMetrics,
    pub history_ablated: SyntheticPopulationPolicyMetrics,
    pub oracle: SyntheticPopulationPolicyMetrics,
    pub personalization_success_delta_per_mille: i64,
    pub personalization_mean_turns_delta_milli: i64,
    pub history_influence: SyntheticHistoryInfluenceMetrics,
}

pub fn evaluate_synthetic_policy(
    model: &CardPolicyModel,
    config: SyntheticDatasetConfig,
    top_k: usize,
) -> Result<SyntheticPolicyMetrics, Box<dyn Error>> {
    evaluate_synthetic(config, top_k, |world, state, max_steps| {
        model_ranking(model, world, state, max_steps)
    })
}

pub fn evaluate_synthetic_oracle(
    config: SyntheticDatasetConfig,
    top_k: usize,
) -> Result<SyntheticPolicyMetrics, Box<dyn Error>> {
    evaluate_synthetic(config, top_k, |world, state, _| {
        Ok(oracle_ranking(world, state))
    })
}

/// Runs a population of independent treasure-seeking avatars on shared worlds.
///
/// Every avatar owns its episode state. `history_ablated` is a paired control:
/// it sees the same world and initial hand but forgets visits, searches, clues,
/// used edges, and previous locations before every decision.
pub fn simulate_synthetic_population(
    model: &CardPolicyModel,
    config: SyntheticDatasetConfig,
    top_k: usize,
) -> Result<SyntheticPopulationReport, Box<dyn Error>> {
    let config = config.validate()?;
    if !(1..=CARD_POLICY_MAX_TOP_K).contains(&top_k) {
        return Err(format!(
            "synthetic population top-k must be between 1 and {CARD_POLICY_MAX_TOP_K}"
        )
        .into());
    }

    let (personalized, history_influence) = evaluate_population_policy(
        config,
        top_k,
        |world, state, max_steps| model_ranking(model, world, state, max_steps),
        Some(model),
    )?;
    let (history_ablated, _) = evaluate_population_policy(
        config,
        top_k,
        |world, state, max_steps| {
            let ablated = history_ablated_state(state);
            model_ranking(model, world, &ablated, max_steps)
        },
        None,
    )?;
    let (oracle, _) = evaluate_population_policy(
        config,
        top_k,
        |world, state, _| Ok(oracle_ranking(world, state)),
        None,
    )?;
    let avatars = usize::try_from(config.worlds)? * usize::from(config.trajectories_per_world);

    Ok(SyntheticPopulationReport {
        schema_version: 1,
        model_hash: model.model_hash(),
        worlds: config.worlds,
        avatars_per_world: config.trajectories_per_world,
        avatars,
        top_k,
        max_steps: config.max_steps,
        seed: config.seed,
        personalization_success_delta_per_mille: signed_delta(
            personalized.policy.treasure_success_per_mille,
            history_ablated.policy.treasure_success_per_mille,
        ),
        personalization_mean_turns_delta_milli: signed_delta(
            personalized.policy.mean_turns_milli,
            history_ablated.policy.mean_turns_milli,
        ),
        personalized,
        history_ablated,
        oracle,
        history_influence,
    })
}

fn model_ranking(
    model: &CardPolicyModel,
    world: &SyntheticWorld,
    state: &EpisodeState,
    max_steps: u16,
) -> Result<SyntheticRanking, Box<dyn Error>> {
    let features = encoded_candidates(world, state, max_steps)
        .into_iter()
        .map(|candidate| candidate.features_q15)
        .collect::<Vec<_>>();
    let decision = model.rank(&features)?;
    Ok(SyntheticRanking {
        ranked_candidate_indices: decision.ranked_candidate_indices,
        scores_q8: decision.scores_q8,
    })
}

fn oracle_ranking(world: &SyntheticWorld, state: &EpisodeState) -> SyntheticRanking {
    let losses = world
        .deck(state.location)
        .iter()
        .map(|card| world.card_loss(state.location, *card))
        .collect::<Vec<_>>();
    let mut ranked_candidate_indices = (0..losses.len()).collect::<Vec<_>>();
    ranked_candidate_indices.sort_by_key(|index| (losses[*index], *index));
    SyntheticRanking {
        ranked_candidate_indices,
        scores_q8: losses.into_iter().map(|loss| -i32::from(loss)).collect(),
    }
}

fn evaluate_population_policy(
    config: SyntheticDatasetConfig,
    top_k: usize,
    mut rank: impl FnMut(
        &SyntheticWorld,
        &EpisodeState,
        u16,
    ) -> Result<SyntheticRanking, Box<dyn Error>>,
    history_probe_model: Option<&CardPolicyModel>,
) -> Result<
    (
        SyntheticPopulationPolicyMetrics,
        SyntheticHistoryInfluenceMetrics,
    ),
    Box<dyn Error>,
> {
    let mut summary = SyntheticPolicyMetrics {
        top_k,
        ..SyntheticPolicyMetrics::default()
    };
    let mut history = SyntheticHistoryInfluenceMetrics::default();
    let mut episode_turns = Vec::new();
    let mut successful_turns = Vec::new();
    for world_index in 0..config.worlds {
        let world_seed = split_seed(config.seed, u64::from(world_index));
        let world = SyntheticWorld::generate(world_seed, config.min_nodes, config.max_nodes);
        for avatar_index in 0..config.trajectories_per_world {
            summary.episodes += 1;
            let initial_page = ((usize::from(avatar_index) * 2) % world.deck(0).len()) as u8;
            let mut state = EpisodeState::initial(initial_page);
            while !state.found && state.steps < config.max_steps {
                let decision = rank(&world, &state, config.max_steps)?;
                let hand = world.hand_indices(state.location, state.page);
                let action = adapt_scored_ranking_to_hand(
                    &decision.ranked_candidate_indices,
                    &decision.scores_q8,
                    hand,
                    top_k,
                )?;
                if let Some(model) = history_probe_model.filter(|_| state.steps > 0) {
                    let ablated = history_ablated_state(&state);
                    let ablated_decision =
                        model_ranking(model, &world, &ablated, config.max_steps)?;
                    let ablated_action = adapt_scored_ranking_to_hand(
                        &ablated_decision.ranked_candidate_indices,
                        &ablated_decision.scores_q8,
                        hand,
                        top_k,
                    )?;
                    history.decisions_after_history += 1;
                    history.full_ranking_changed += usize::from(
                        decision.ranked_candidate_indices
                            != ablated_decision.ranked_candidate_indices,
                    );
                    history.top_card_changed += usize::from(
                        decision.ranked_candidate_indices.first()
                            != ablated_decision.ranked_candidate_indices.first(),
                    );
                    history.adapter_action_changed += usize::from(action != ablated_action);
                }
                summary.total_draws += usize::from(action == CardPolicyAction::Draw);
                summary.total_cards_played += usize::from(action != CardPolicyAction::Draw);
                apply_adapter_action(&world, &mut state, action)?;
            }
            let turns = usize::from(state.steps);
            summary.total_turns += turns;
            episode_turns.push(turns);
            if state.found {
                summary.treasures_found += 1;
                successful_turns.push(turns);
            }
        }
    }
    summary.treasure_success_per_mille = summary.treasures_found * 1000 / summary.episodes;
    summary.draw_rate_per_mille = summary.total_draws * 1000 / summary.total_turns.max(1);
    summary.mean_turns_milli = summary.total_turns * 1000 / summary.episodes;
    summary.mean_turns_to_treasure_milli =
        successful_turns.iter().sum::<usize>() * 1000 / summary.treasures_found.max(1);
    history.full_ranking_changed_per_mille =
        history.full_ranking_changed * 1000 / history.decisions_after_history.max(1);
    history.top_card_changed_per_mille =
        history.top_card_changed * 1000 / history.decisions_after_history.max(1);
    history.adapter_action_changed_per_mille =
        history.adapter_action_changed * 1000 / history.decisions_after_history.max(1);

    Ok((
        SyntheticPopulationPolicyMetrics {
            timed_out: summary.episodes.saturating_sub(summary.treasures_found),
            all_episode_turns: turn_percentiles(&mut episode_turns),
            successful_episode_turns: turn_percentiles(&mut successful_turns),
            policy: summary,
        },
        history,
    ))
}

fn history_ablated_state(state: &EpisodeState) -> EpisodeState {
    let mut visit_counts = [0; MAX_NODES];
    visit_counts[usize::from(state.location)] = 1;
    EpisodeState {
        location: state.location,
        previous: NONE_NODE,
        visited_mask: 1_u16 << state.location,
        searched_mask: 0,
        visit_counts,
        used_edges: [0; MAX_NODES],
        hint_neighbor: NONE_NODE,
        page: state.page,
        draws_since_progress: 0,
        steps: state.steps,
        found: state.found,
    }
}

fn turn_percentiles(values: &mut [usize]) -> SyntheticTurnPercentiles {
    if values.is_empty() {
        return SyntheticTurnPercentiles::default();
    }
    values.sort_unstable();
    SyntheticTurnPercentiles {
        minimum: values[0],
        p50: nearest_rank(values, 50),
        p90: nearest_rank(values, 90),
        p99: nearest_rank(values, 99),
        maximum: values[values.len() - 1],
    }
}

fn nearest_rank(sorted: &[usize], percentile: usize) -> usize {
    let rank = (percentile * sorted.len()).div_ceil(100);
    sorted[rank.saturating_sub(1).min(sorted.len() - 1)]
}

fn signed_delta(left: usize, right: usize) -> i64 {
    i64::try_from(left).unwrap_or(i64::MAX) - i64::try_from(right).unwrap_or(i64::MAX)
}

fn evaluate_synthetic(
    config: SyntheticDatasetConfig,
    top_k: usize,
    mut rank: impl FnMut(
        &SyntheticWorld,
        &EpisodeState,
        u16,
    ) -> Result<SyntheticRanking, Box<dyn Error>>,
) -> Result<SyntheticPolicyMetrics, Box<dyn Error>> {
    let config = config.validate()?;
    if !(1..=CARD_POLICY_MAX_TOP_K).contains(&top_k) {
        return Err(format!(
            "synthetic policy top-k must be between 1 and {CARD_POLICY_MAX_TOP_K}"
        )
        .into());
    }
    let mut metrics = SyntheticPolicyMetrics {
        top_k,
        ..SyntheticPolicyMetrics::default()
    };
    let mut successful_turns = 0_usize;
    for world_index in 0..config.worlds {
        let world_seed = split_seed(config.seed, u64::from(world_index));
        let world = SyntheticWorld::generate(world_seed, config.min_nodes, config.max_nodes);
        for trajectory_index in 0..config.trajectories_per_world {
            metrics.episodes += 1;
            let initial_page = ((usize::from(trajectory_index) * 2) % world.deck(0).len()) as u8;
            let mut state = EpisodeState::initial(initial_page);
            while !state.found && state.steps < config.max_steps {
                let decision = rank(&world, &state, config.max_steps)?;
                let action = adapt_scored_ranking_to_hand(
                    &decision.ranked_candidate_indices,
                    &decision.scores_q8,
                    world.hand_indices(state.location, state.page),
                    top_k,
                )?;
                metrics.total_draws += usize::from(action == CardPolicyAction::Draw);
                metrics.total_cards_played += usize::from(action != CardPolicyAction::Draw);
                apply_adapter_action(&world, &mut state, action)?;
            }
            metrics.total_turns += usize::from(state.steps);
            if state.found {
                metrics.treasures_found += 1;
                successful_turns += usize::from(state.steps);
            }
        }
    }
    metrics.treasure_success_per_mille = metrics.treasures_found * 1000 / metrics.episodes;
    metrics.draw_rate_per_mille = metrics.total_draws * 1000 / metrics.total_turns.max(1);
    metrics.mean_turns_milli = metrics.total_turns * 1000 / metrics.episodes;
    metrics.mean_turns_to_treasure_milli = successful_turns * 1000 / metrics.treasures_found.max(1);
    Ok(metrics)
}

fn add_edge(adjacency: &mut [Vec<u8>], left: usize, right: usize) {
    if left == right || adjacency[left].contains(&(right as u8)) {
        return;
    }
    adjacency[left].push(right as u8);
    adjacency[right].push(left as u8);
}

fn has_bit(mask: u16, node: u8) -> bool {
    mask & (1_u16 << node) != 0
}

fn edge_was_used(used_edges: &[u16; MAX_NODES], left: u8, right: u8) -> bool {
    used_edges[usize::from(left)] & (1_u16 << right) != 0
}

fn mark_edge_used(used_edges: &mut [u16; MAX_NODES], left: u8, right: u8) {
    used_edges[usize::from(left)] |= 1_u16 << right;
    used_edges[usize::from(right)] |= 1_u16 << left;
}

fn bool_q15(value: bool) -> i16 {
    if value {
        i16::MAX
    } else {
        0
    }
}

fn fraction_q15(numerator: usize, denominator: usize) -> i16 {
    if denominator == 0 {
        return 0;
    }
    ((numerator.min(denominator) as u64 * i16::MAX as u64) / denominator as u64) as i16
}

fn split_seed(root: u64, stream: u64) -> u64 {
    let mut random = SplitMix64::new(root ^ stream.wrapping_mul(0x9e37_79b9_7f4a_7c15));
    random.next()
}

struct SplitMix64 {
    state: u64,
}

impl SplitMix64 {
    fn new(seed: u64) -> Self {
        Self { state: seed }
    }

    fn next(&mut self) -> u64 {
        self.state = self.state.wrapping_add(0x9e37_79b9_7f4a_7c15);
        let mut value = self.state;
        value = (value ^ (value >> 30)).wrapping_mul(0xbf58_476d_1ce4_e5b9);
        value = (value ^ (value >> 27)).wrapping_mul(0x94d0_49bb_1331_11eb);
        value ^ (value >> 31)
    }

    fn bounded(&mut self, upper: usize) -> usize {
        debug_assert!(upper > 0);
        (self.next() % upper as u64) as usize
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn generation_is_deterministic_and_rows_contain_the_complete_deck() {
        let config = SyntheticDatasetConfig {
            worlds: 8,
            trajectories_per_world: 2,
            max_steps: 20,
            ..SyntheticDatasetConfig::default()
        };
        let first = generate_synthetic_dataset(config).unwrap();
        let second = generate_synthetic_dataset(config).unwrap();
        assert_eq!(first, second);
        assert!(first.iter().all(|row| row.candidates.len() >= 3));
        assert!(first.iter().any(|row| {
            adapt_ranking_to_hand(
                &row.oracle_ranking().unwrap(),
                row.hand_candidate_indices,
                CARD_POLICY_DEFAULT_TOP_K,
            )
            .unwrap()
                == CardPolicyAction::Draw
        }));
    }

    #[test]
    fn hidden_treasure_does_not_leak_into_initial_features() {
        let mut first = SyntheticWorld::generate(9, 8, 8);
        let mut second = first.clone();
        first.treasure = 1;
        second.treasure = 2;
        let state = EpisodeState::initial(0);
        assert_eq!(
            candidate_features(&first, &state, 48, first.deck(0)[0]),
            candidate_features(&second, &state, 48, second.deck(0)[0])
        );
    }

    #[test]
    fn oracle_ranks_search_first_at_the_treasure() {
        let world = SyntheticWorld::generate(11, 8, 8);
        let search_index = world
            .deck(world.treasure)
            .iter()
            .position(|card| *card == SyntheticCard::Search)
            .unwrap();
        let mut state = EpisodeState::initial(0);
        state.location = world.treasure;
        let row = CardPolicySample {
            sample_id: "treasure".to_string(),
            world_seed: 11,
            hand_candidate_indices: world.hand_indices(state.location, state.page),
            candidates: encoded_candidates(&world, &state, 48),
        };
        assert_eq!(row.target_index().unwrap(), search_index);
        assert_eq!(row.candidates[search_index].child_loss, 1);
    }

    #[test]
    fn edge_encoding_covers_all_synthetic_nodes() {
        let mut used = [0_u16; MAX_NODES];
        mark_edge_used(&mut used, 0, (MAX_NODES - 1) as u8);
        assert!(edge_was_used(&used, 0, (MAX_NODES - 1) as u8));
        assert!(edge_was_used(&used, (MAX_NODES - 1) as u8, 0));
    }

    #[test]
    fn population_simulation_counts_independent_avatars() {
        let config = SyntheticDatasetConfig {
            worlds: 5,
            trajectories_per_world: 3,
            max_steps: 20,
            ..SyntheticDatasetConfig::default()
        };
        let report = simulate_synthetic_population(&CardPolicyModel::new(19), config, 1).unwrap();
        assert_eq!(report.avatars, 15);
        assert_eq!(report.personalized.policy.episodes, 15);
        assert_eq!(report.history_ablated.policy.episodes, 15);
        assert_eq!(report.oracle.policy.episodes, 15);
        assert_eq!(
            report.personalized.policy.treasures_found + report.personalized.timed_out,
            15
        );
        assert!(report.personalized.all_episode_turns.maximum <= 20);
    }

    #[test]
    fn history_ablation_preserves_current_scene_but_clears_memory() {
        let mut state = EpisodeState::initial(3);
        state.location = 4;
        state.previous = 2;
        state.visited_mask = 0b1_1111;
        state.searched_mask = 0b1010;
        state.visit_counts[4] = 3;
        state.used_edges[4] = 1 << 2;
        state.hint_neighbor = 5;
        state.draws_since_progress = 2;
        state.steps = 7;

        let ablated = history_ablated_state(&state);
        assert_eq!(ablated.location, 4);
        assert_eq!(ablated.page, 3);
        assert_eq!(ablated.steps, 7);
        assert_eq!(ablated.visited_mask, 1 << 4);
        assert_eq!(ablated.visit_counts[4], 1);
        assert_eq!(ablated.previous, NONE_NODE);
        assert_eq!(ablated.searched_mask, 0);
        assert_eq!(ablated.hint_neighbor, NONE_NODE);
        assert_eq!(ablated.draws_since_progress, 0);
    }

    #[test]
    fn nearest_rank_percentiles_are_stable_for_small_populations() {
        let mut turns = vec![9, 1, 5, 3, 7];
        assert_eq!(
            turn_percentiles(&mut turns),
            SyntheticTurnPercentiles {
                minimum: 1,
                p50: 5,
                p90: 9,
                p99: 9,
                maximum: 9,
            }
        );
    }

    #[test]
    fn score_tied_oracle_top_three_is_loop_free() {
        let config = SyntheticDatasetConfig {
            worlds: 100,
            trajectories_per_world: 4,
            max_steps: 48,
            seed: 0x5f37_59df,
            ..SyntheticDatasetConfig::default()
        };
        let top_one = evaluate_synthetic_oracle(config, 1).unwrap();
        let top_three = evaluate_synthetic_oracle(config, 3).unwrap();
        assert_eq!(top_three.treasures_found, top_three.episodes);
        assert!(top_three.total_turns <= top_one.total_turns);
    }
}
