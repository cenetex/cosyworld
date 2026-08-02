//! Fast, deterministic ranking across every currently legal card.
//!
//! The deployed model scores each card independently with shared weights. The
//! runtime ranks the complete legal deck, then maps that ranking onto the
//! authoritative two-card hand. The top card is playable when shown; ranks two
//! and three are playable only when their integer score ties the top score.
//! Otherwise the adapter emits `DRAW` and reranks the next hand.

mod ranker;
mod synthetic;

pub use ranker::{
    adapt_ranking_to_hand, adapt_scored_ranking_to_hand, evaluate, read_dataset, train,
    train_from_model, write_dataset, CardPolicyAction, CardPolicyCandidateSample,
    CardPolicyDecision, CardPolicyMetrics, CardPolicyModel, CardPolicySample,
    CardPolicyTrainingConfig, CardPolicyTrainingReport, CARD_POLICY_DEFAULT_TOP_K,
    CARD_POLICY_FEATURES, CARD_POLICY_HIDDEN, CARD_POLICY_MAX_TOP_K,
};
pub use synthetic::{
    evaluate_synthetic_oracle, evaluate_synthetic_policy, generate_synthetic_dataset,
    simulate_synthetic_population, SyntheticDatasetConfig, SyntheticHistoryInfluenceMetrics,
    SyntheticPolicyMetrics, SyntheticPopulationPolicyMetrics, SyntheticPopulationReport,
    SyntheticTurnPercentiles,
};

/// Stable, human-readable per-card feature contract. Changing an entry changes
/// the feature-schema hash embedded in every model artifact.
pub const CARD_POLICY_FEATURE_SCHEMA: [&str; CARD_POLICY_FEATURES] = [
    "world_node_count",
    "current_degree",
    "visited_fraction",
    "searched_fraction",
    "remaining_step_fraction",
    "current_was_revisited",
    "current_was_searched",
    "hint_is_known",
    "legal_card_count",
    "previous_node_is_known",
    "draws_since_progress",
    "observation_bias",
    "card_kind_move",
    "card_kind_search",
    "card_kind_other",
    "card_target_visited",
    "card_target_searched",
    "card_target_degree",
    "card_matches_hint",
    "card_returns_to_previous",
    "card_edge_was_used",
    "card_target_visit_count",
    "card_targets_current_node",
    "card_bias",
];

pub(crate) fn feature_schema_hash() -> u64 {
    let mut hash = 0xcbf2_9ce4_8422_2325_u64;
    for name in CARD_POLICY_FEATURE_SCHEMA {
        for byte in name.bytes().chain(core::iter::once(0)) {
            hash ^= u64::from(byte);
            hash = hash.wrapping_mul(0x0000_0100_0000_01b3);
        }
    }
    hash
}
