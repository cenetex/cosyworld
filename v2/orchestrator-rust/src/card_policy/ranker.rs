use std::cmp::Reverse;
use std::error::Error;
use std::fs;
use std::io::{BufRead, BufReader, BufWriter, Write};
use std::path::Path;

use serde::{Deserialize, Serialize};

use super::feature_schema_hash;

pub const CARD_POLICY_FEATURES: usize = 24;
pub const CARD_POLICY_HIDDEN: usize = 16;
pub const CARD_POLICY_DEFAULT_TOP_K: usize = 1;
pub const CARD_POLICY_MAX_TOP_K: usize = 3;

const ARTIFACT_MAGIC: &[u8; 8] = b"CWRANK2\n";
const ARTIFACT_VERSION: u32 = 2;
const OUTPUT_LOGIT_SHIFT: u8 = 8;
const OUTPUT_WEIGHT_GRAD_SHIFT: u8 = 17;
const INPUT_WEIGHT_GRAD_SHIFT: u8 = 25;
const HIDDEN_BIAS_GRAD_SHIFT: u8 = 18;
const EARLY_STOPPING_PATIENCE: usize = 8;

#[derive(Debug, Clone, Copy, Deserialize, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum CardPolicyAction {
    A,
    B,
    Draw,
}

impl CardPolicyAction {
    pub const fn index(self) -> usize {
        match self {
            Self::A => 0,
            Self::B => 1,
            Self::Draw => 2,
        }
    }

    pub const fn from_index(index: usize) -> Option<Self> {
        match index {
            0 => Some(Self::A),
            1 => Some(Self::B),
            2 => Some(Self::Draw),
            _ => None,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CardPolicyCandidateSample {
    pub features_q15: [i16; CARD_POLICY_FEATURES],
    pub child_loss: u16,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CardPolicySample {
    pub sample_id: String,
    pub world_seed: u64,
    pub hand_candidate_indices: [Option<usize>; 2],
    pub candidates: Vec<CardPolicyCandidateSample>,
}

impl CardPolicySample {
    pub fn validate(&self) -> Result<(), Box<dyn Error>> {
        if self.candidates.is_empty() {
            return Err("card-policy sample has no candidates".into());
        }
        for index in self.hand_candidate_indices.iter().flatten() {
            if *index >= self.candidates.len() {
                return Err("card-policy hand index is outside the candidate deck".into());
            }
        }
        if self.hand_candidate_indices[0].is_none() {
            return Err("card-policy hand is missing card A".into());
        }
        if self.hand_candidate_indices[0].is_some()
            && self.hand_candidate_indices[0] == self.hand_candidate_indices[1]
        {
            return Err("card-policy hand contains a duplicate card".into());
        }
        Ok(())
    }

    pub fn target_index(&self) -> Result<usize, Box<dyn Error>> {
        self.validate()?;
        self.candidates
            .iter()
            .enumerate()
            .min_by_key(|(index, candidate)| (candidate.child_loss, *index))
            .map(|(index, _)| index)
            .ok_or_else(|| "card-policy sample has no target".into())
    }

    pub fn oracle_ranking(&self) -> Result<Vec<usize>, Box<dyn Error>> {
        self.validate()?;
        let mut ranking = (0..self.candidates.len()).collect::<Vec<_>>();
        ranking.sort_by_key(|index| (self.candidates[*index].child_loss, *index));
        Ok(ranking)
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CardPolicyModel {
    seed: u64,
    input_weights: [i8; CARD_POLICY_FEATURES * CARD_POLICY_HIDDEN],
    hidden_bias_q15: [i32; CARD_POLICY_HIDDEN],
    output_weights: [i8; CARD_POLICY_HIDDEN],
    output_bias_q8: i32,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct CardPolicyDecision {
    pub ranked_candidate_indices: Vec<usize>,
    pub scores_q8: Vec<i32>,
    pub model_hash: u64,
}

impl CardPolicyDecision {
    pub fn action_for_hand(
        &self,
        hand_candidate_indices: [Option<usize>; 2],
        top_k: usize,
    ) -> Result<CardPolicyAction, Box<dyn Error>> {
        adapt_scored_ranking_to_hand(
            &self.ranked_candidate_indices,
            &self.scores_q8,
            hand_candidate_indices,
            top_k,
        )
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
pub struct CardPolicyTrainingConfig {
    pub epochs: usize,
    pub seed: u64,
    pub regret_gradient_shift: u8,
}

impl Default for CardPolicyTrainingConfig {
    fn default() -> Self {
        Self {
            epochs: 64,
            seed: 1,
            regret_gradient_shift: 3,
        }
    }
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize)]
pub struct CardPolicyUpdateStats {
    pub pairwise_updates: usize,
    pub input_weight_updates: usize,
    pub output_weight_updates: usize,
    pub hidden_bias_updates: usize,
    pub saturation_count: usize,
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize)]
pub struct CardPolicyMetrics {
    pub rows: usize,
    pub exact_best: usize,
    pub exact_best_per_mille: usize,
    pub zero_regret: usize,
    pub zero_regret_per_mille: usize,
    pub hint_known_rows: usize,
    pub hint_known_zero_regret_per_mille: usize,
    pub hint_unknown_rows: usize,
    pub hint_unknown_zero_regret_per_mille: usize,
    pub top3_oracle_coverage_per_mille: usize,
    pub mean_regret_milli_steps: usize,
    pub adapter_agreement_per_mille: usize,
    pub oracle_action_counts: [usize; 3],
    pub predicted_action_counts: [usize; 3],
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct CardPolicyTrainingReport {
    pub artifact_version: u32,
    pub feature_schema_hash: u64,
    pub model_hash: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub warm_start_model_hash: Option<u64>,
    pub config: CardPolicyTrainingConfig,
    pub completed_epochs: usize,
    pub selected_epoch: usize,
    pub update_stats: CardPolicyUpdateStats,
    pub initial_train: CardPolicyMetrics,
    pub final_train: CardPolicyMetrics,
    pub initial_calibration: CardPolicyMetrics,
    pub final_calibration: CardPolicyMetrics,
}

#[derive(Debug, Clone, Copy)]
struct ForwardPass {
    hidden: [i16; CARD_POLICY_HIDDEN],
    score_q8: i32,
}

impl CardPolicyModel {
    pub fn new(seed: u64) -> Self {
        let mut state = seed ^ 0x9e37_79b9_7f4a_7c15;
        let mut next_weight = || {
            state = state
                .wrapping_mul(6_364_136_223_846_793_005)
                .wrapping_add(1_442_695_040_888_963_407);
            ((state >> 32) % 9) as i8 - 4
        };
        let mut input_weights = [0_i8; CARD_POLICY_FEATURES * CARD_POLICY_HIDDEN];
        for value in &mut input_weights {
            *value = next_weight();
        }
        let mut output_weights = [0_i8; CARD_POLICY_HIDDEN];
        for value in &mut output_weights {
            *value = next_weight();
        }
        Self {
            seed,
            input_weights,
            hidden_bias_q15: [0; CARD_POLICY_HIDDEN],
            output_weights,
            output_bias_q8: 0,
        }
    }

    pub fn rank(
        &self,
        candidate_features_q15: &[[i16; CARD_POLICY_FEATURES]],
    ) -> Result<CardPolicyDecision, Box<dyn Error>> {
        if candidate_features_q15.is_empty() {
            return Err("cannot rank an empty card deck".into());
        }
        let scores_q8 = candidate_features_q15
            .iter()
            .map(|features| self.forward(features).map(|forward| forward.score_q8))
            .collect::<Result<Vec<_>, _>>()?;
        let mut ranked_candidate_indices = (0..scores_q8.len()).collect::<Vec<_>>();
        ranked_candidate_indices.sort_by_key(|index| (Reverse(scores_q8[*index]), *index));
        Ok(CardPolicyDecision {
            ranked_candidate_indices,
            scores_q8,
            model_hash: self.model_hash(),
        })
    }

    fn forward(
        &self,
        features_q15: &[i16; CARD_POLICY_FEATURES],
    ) -> Result<ForwardPass, Box<dyn Error>> {
        let mut hidden = [0_i16; CARD_POLICY_HIDDEN];
        for (hidden_index, hidden_value) in hidden.iter_mut().enumerate() {
            let mut acc = i64::from(self.hidden_bias_q15[hidden_index]);
            for (feature_index, &feature) in features_q15.iter().enumerate() {
                let weight =
                    self.input_weights[hidden_index * CARD_POLICY_FEATURES + feature_index];
                acc = acc
                    .checked_add((i64::from(feature) * i64::from(weight)) >> 7)
                    .ok_or("card-ranker hidden accumulation overflow")?;
            }
            *hidden_value = acc.clamp(0, i64::from(i16::MAX)) as i16;
        }
        let mut score = i64::from(self.output_bias_q8);
        for (hidden_value, weight) in hidden.iter().zip(self.output_weights.iter()) {
            score = score
                .checked_add((i64::from(*hidden_value) * i64::from(*weight)) >> OUTPUT_LOGIT_SHIFT)
                .ok_or("card-ranker output accumulation overflow")?;
        }
        Ok(ForwardPass {
            hidden,
            score_q8: score.clamp(i64::from(i32::MIN), i64::from(i32::MAX)) as i32,
        })
    }

    pub fn to_bytes(&self) -> Vec<u8> {
        let mut out = Vec::with_capacity(512);
        out.extend_from_slice(ARTIFACT_MAGIC);
        out.extend_from_slice(&ARTIFACT_VERSION.to_le_bytes());
        out.extend_from_slice(&feature_schema_hash().to_le_bytes());
        out.extend_from_slice(&(CARD_POLICY_FEATURES as u32).to_le_bytes());
        out.extend_from_slice(&(CARD_POLICY_HIDDEN as u32).to_le_bytes());
        out.extend_from_slice(&1_u32.to_le_bytes());
        out.extend_from_slice(&self.seed.to_le_bytes());
        out.extend(
            self.input_weights
                .iter()
                .map(|value| value.to_le_bytes()[0]),
        );
        for value in self.hidden_bias_q15 {
            out.extend_from_slice(&value.to_le_bytes());
        }
        out.extend(
            self.output_weights
                .iter()
                .map(|value| value.to_le_bytes()[0]),
        );
        out.extend_from_slice(&self.output_bias_q8.to_le_bytes());
        let checksum = fnv64(&out);
        out.extend_from_slice(&checksum.to_le_bytes());
        out
    }

    pub fn from_bytes(bytes: &[u8]) -> Result<Self, Box<dyn Error>> {
        if bytes.len() < ARTIFACT_MAGIC.len() + 8 {
            return Err("card-policy artifact is truncated".into());
        }
        let payload_len = bytes.len() - 8;
        let expected_checksum = u64::from_le_bytes(bytes[payload_len..].try_into()?);
        if fnv64(&bytes[..payload_len]) != expected_checksum {
            return Err("card-policy artifact checksum mismatch".into());
        }
        let mut cursor = 0;
        if take(bytes, &mut cursor, ARTIFACT_MAGIC.len())? != ARTIFACT_MAGIC {
            return Err("invalid card-policy artifact magic".into());
        }
        if read_u32(bytes, &mut cursor)? != ARTIFACT_VERSION {
            return Err("unsupported card-policy artifact version".into());
        }
        if read_u64(bytes, &mut cursor)? != feature_schema_hash() {
            return Err("card-policy feature schema mismatch".into());
        }
        let shape = (
            read_u32(bytes, &mut cursor)? as usize,
            read_u32(bytes, &mut cursor)? as usize,
            read_u32(bytes, &mut cursor)? as usize,
        );
        if shape != (CARD_POLICY_FEATURES, CARD_POLICY_HIDDEN, 1) {
            return Err("invalid card-policy artifact shape".into());
        }
        let seed = read_u64(bytes, &mut cursor)?;
        let mut input_weights = [0_i8; CARD_POLICY_FEATURES * CARD_POLICY_HIDDEN];
        for value in &mut input_weights {
            *value = i8::from_le_bytes([take(bytes, &mut cursor, 1)?[0]]);
        }
        let mut hidden_bias_q15 = [0_i32; CARD_POLICY_HIDDEN];
        for value in &mut hidden_bias_q15 {
            *value = read_i32(bytes, &mut cursor)?;
        }
        let mut output_weights = [0_i8; CARD_POLICY_HIDDEN];
        for value in &mut output_weights {
            *value = i8::from_le_bytes([take(bytes, &mut cursor, 1)?[0]]);
        }
        let output_bias_q8 = read_i32(bytes, &mut cursor)?;
        if cursor != payload_len {
            return Err("card-policy artifact has trailing bytes".into());
        }
        Ok(Self {
            seed,
            input_weights,
            hidden_bias_q15,
            output_weights,
            output_bias_q8,
        })
    }

    pub fn model_hash(&self) -> u64 {
        fnv64(&self.to_bytes())
    }
}

pub fn adapt_ranking_to_hand(
    ranked_candidate_indices: &[usize],
    hand_candidate_indices: [Option<usize>; 2],
    top_k: usize,
) -> Result<CardPolicyAction, Box<dyn Error>> {
    if ranked_candidate_indices.is_empty() {
        return Err("cannot adapt an empty card ranking".into());
    }
    if !(1..=CARD_POLICY_MAX_TOP_K).contains(&top_k) {
        return Err(
            format!("card-policy top-k must be between 1 and {CARD_POLICY_MAX_TOP_K}").into(),
        );
    }
    for candidate_index in ranked_candidate_indices.iter().take(1) {
        if hand_candidate_indices[0] == Some(*candidate_index) {
            return Ok(CardPolicyAction::A);
        }
        if hand_candidate_indices[1] == Some(*candidate_index) {
            return Ok(CardPolicyAction::B);
        }
    }
    Ok(CardPolicyAction::Draw)
}

pub fn adapt_scored_ranking_to_hand(
    ranked_candidate_indices: &[usize],
    scores_q8: &[i32],
    hand_candidate_indices: [Option<usize>; 2],
    top_k: usize,
) -> Result<CardPolicyAction, Box<dyn Error>> {
    if ranked_candidate_indices.is_empty() {
        return Err("cannot adapt an empty card ranking".into());
    }
    if scores_q8.is_empty() {
        return Err("cannot adapt card ranking without scores".into());
    }
    if !(1..=CARD_POLICY_MAX_TOP_K).contains(&top_k) {
        return Err(
            format!("card-policy top-k must be between 1 and {CARD_POLICY_MAX_TOP_K}").into(),
        );
    }
    let best_index = ranked_candidate_indices[0];
    let best_score = *scores_q8
        .get(best_index)
        .ok_or("card-policy ranking index is outside the score vector")?;
    for candidate_index in ranked_candidate_indices.iter().take(top_k) {
        let candidate_score = *scores_q8
            .get(*candidate_index)
            .ok_or("card-policy ranking index is outside the score vector")?;
        if candidate_score != best_score {
            continue;
        }
        if hand_candidate_indices[0] == Some(*candidate_index) {
            return Ok(CardPolicyAction::A);
        }
        if hand_candidate_indices[1] == Some(*candidate_index) {
            return Ok(CardPolicyAction::B);
        }
    }
    Ok(CardPolicyAction::Draw)
}

pub fn train(
    train_rows: &[CardPolicySample],
    calibration_rows: &[CardPolicySample],
    config: CardPolicyTrainingConfig,
) -> Result<(CardPolicyModel, CardPolicyTrainingReport), Box<dyn Error>> {
    train_with_initial(
        CardPolicyModel::new(config.seed),
        None,
        train_rows,
        calibration_rows,
        config,
    )
}

pub fn train_from_model(
    initial_model: CardPolicyModel,
    train_rows: &[CardPolicySample],
    calibration_rows: &[CardPolicySample],
    config: CardPolicyTrainingConfig,
) -> Result<(CardPolicyModel, CardPolicyTrainingReport), Box<dyn Error>> {
    let warm_start_model_hash = initial_model.model_hash();
    train_with_initial(
        initial_model,
        Some(warm_start_model_hash),
        train_rows,
        calibration_rows,
        config,
    )
}

fn train_with_initial(
    mut model: CardPolicyModel,
    warm_start_model_hash: Option<u64>,
    train_rows: &[CardPolicySample],
    calibration_rows: &[CardPolicySample],
    config: CardPolicyTrainingConfig,
) -> Result<(CardPolicyModel, CardPolicyTrainingReport), Box<dyn Error>> {
    if train_rows.is_empty() || calibration_rows.is_empty() {
        return Err("training and calibration datasets must be non-empty".into());
    }
    if config.epochs == 0 || config.regret_gradient_shift > 15 {
        return Err("epochs must be positive and regret-gradient-shift at most 15".into());
    }
    for row in train_rows.iter().chain(calibration_rows) {
        row.validate()?;
    }
    let initial_train = evaluate(&model, train_rows)?;
    let initial_calibration = evaluate(&model, calibration_rows)?;
    let outcome = train_model(&mut model, train_rows, calibration_rows, config)?;
    let final_train = evaluate(&model, train_rows)?;
    let final_calibration = evaluate(&model, calibration_rows)?;
    let report = CardPolicyTrainingReport {
        artifact_version: ARTIFACT_VERSION,
        feature_schema_hash: feature_schema_hash(),
        model_hash: model.model_hash(),
        warm_start_model_hash,
        config,
        completed_epochs: outcome.completed_epochs,
        selected_epoch: outcome.selected_epoch,
        update_stats: outcome.stats,
        initial_train,
        final_train,
        initial_calibration,
        final_calibration,
    };
    Ok((model, report))
}

struct TrainingOutcome {
    stats: CardPolicyUpdateStats,
    completed_epochs: usize,
    selected_epoch: usize,
}

fn train_model(
    model: &mut CardPolicyModel,
    rows: &[CardPolicySample],
    calibration_rows: &[CardPolicySample],
    config: CardPolicyTrainingConfig,
) -> Result<TrainingOutcome, Box<dyn Error>> {
    let mut input_carry = [0_i64; CARD_POLICY_FEATURES * CARD_POLICY_HIDDEN];
    let mut output_carry = [0_i64; CARD_POLICY_HIDDEN];
    let mut hidden_bias_carry = [0_i64; CARD_POLICY_HIDDEN];
    let mut stats = CardPolicyUpdateStats::default();
    let mut best_model = model.clone();
    let mut best_metrics = evaluate(model, calibration_rows)?;
    let mut selected_epoch = 0;
    let mut completed_epochs = 0;
    let mut stale_epochs = 0;
    for epoch in 1..=config.epochs {
        for row in rows {
            update_one(
                model,
                row,
                config.regret_gradient_shift,
                &mut input_carry,
                &mut output_carry,
                &mut hidden_bias_carry,
                &mut stats,
            )?;
        }
        completed_epochs = epoch;
        let metrics = evaluate(model, calibration_rows)?;
        let improved = metrics.mean_regret_milli_steps < best_metrics.mean_regret_milli_steps
            || (metrics.mean_regret_milli_steps == best_metrics.mean_regret_milli_steps
                && metrics.zero_regret_per_mille > best_metrics.zero_regret_per_mille);
        if improved {
            best_model = model.clone();
            best_metrics = metrics;
            selected_epoch = epoch;
            stale_epochs = 0;
        } else {
            stale_epochs += 1;
            if stale_epochs >= EARLY_STOPPING_PATIENCE {
                break;
            }
        }
    }
    *model = best_model;
    Ok(TrainingOutcome {
        stats,
        completed_epochs,
        selected_epoch,
    })
}

#[allow(clippy::too_many_arguments)]
fn update_one(
    model: &mut CardPolicyModel,
    row: &CardPolicySample,
    regret_gradient_shift: u8,
    input_carry: &mut [i64; CARD_POLICY_FEATURES * CARD_POLICY_HIDDEN],
    output_carry: &mut [i64; CARD_POLICY_HIDDEN],
    hidden_bias_carry: &mut [i64; CARD_POLICY_HIDDEN],
    stats: &mut CardPolicyUpdateStats,
) -> Result<(), Box<dyn Error>> {
    let features = row
        .candidates
        .iter()
        .map(|candidate| candidate.features_q15)
        .collect::<Vec<_>>();
    let oracle_ranking = row.oracle_ranking()?;
    for better_rank in 0..oracle_ranking.len() {
        for worse_rank in (better_rank + 1)..oracle_ranking.len() {
            let better_index = oracle_ranking[better_rank];
            let worse_index = oracle_ranking[worse_rank];
            let better_loss = row.candidates[better_index].child_loss;
            let worse_loss = row.candidates[worse_index].child_loss;
            if better_loss >= worse_loss {
                continue;
            }
            let better_forward = model.forward(&features[better_index])?;
            let worse_forward = model.forward(&features[worse_index])?;
            let gap = i64::from(worse_loss.saturating_sub(better_loss));
            let margin = (gap << 3).clamp(8, 256);
            if i64::from(better_forward.score_q8)
                >= i64::from(worse_forward.score_q8).saturating_add(margin)
            {
                continue;
            }
            update_pair(
                model,
                &features[better_index],
                &features[worse_index],
                better_forward,
                worse_forward,
                gap,
                regret_gradient_shift,
                input_carry,
                output_carry,
                hidden_bias_carry,
                stats,
            );
        }
    }
    Ok(())
}

#[allow(clippy::too_many_arguments)]
fn update_pair(
    model: &mut CardPolicyModel,
    better_features: &[i16; CARD_POLICY_FEATURES],
    worse_features: &[i16; CARD_POLICY_FEATURES],
    better_forward: ForwardPass,
    worse_forward: ForwardPass,
    gap: i64,
    regret_gradient_shift: u8,
    input_carry: &mut [i64; CARD_POLICY_FEATURES * CARD_POLICY_HIDDEN],
    output_carry: &mut [i64; CARD_POLICY_HIDDEN],
    hidden_bias_carry: &mut [i64; CARD_POLICY_HIDDEN],
    stats: &mut CardPolicyUpdateStats,
) {
    stats.pairwise_updates += 1;
    let strength = ((gap << 8) >> regret_gradient_shift).clamp(1, 1 << 12);
    let output_weights_before = model.output_weights;

    for hidden_index in 0..CARD_POLICY_HIDDEN {
        output_carry[hidden_index] = output_carry[hidden_index].saturating_add(
            strength
                * (i64::from(better_forward.hidden[hidden_index])
                    - i64::from(worse_forward.hidden[hidden_index])),
        );
        apply_i8_gradient(
            &mut model.output_weights[hidden_index],
            &mut output_carry[hidden_index],
            OUTPUT_WEIGHT_GRAD_SHIFT,
            &mut stats.output_weight_updates,
            &mut stats.saturation_count,
        );

        let better_active = better_forward.hidden[hidden_index] > 0;
        let worse_active = worse_forward.hidden[hidden_index] > 0;
        let hidden_strength = strength * i64::from(output_weights_before[hidden_index]);
        for feature_index in 0..CARD_POLICY_FEATURES {
            let better_feature = if better_active {
                i64::from(better_features[feature_index])
            } else {
                0
            };
            let worse_feature = if worse_active {
                i64::from(worse_features[feature_index])
            } else {
                0
            };
            let index = hidden_index * CARD_POLICY_FEATURES + feature_index;
            input_carry[index] = input_carry[index]
                .saturating_add(hidden_strength.saturating_mul(better_feature - worse_feature));
            apply_i8_gradient(
                &mut model.input_weights[index],
                &mut input_carry[index],
                INPUT_WEIGHT_GRAD_SHIFT,
                &mut stats.input_weight_updates,
                &mut stats.saturation_count,
            );
        }
        hidden_bias_carry[hidden_index] = hidden_bias_carry[hidden_index].saturating_add(
            hidden_strength * (i64::from(better_active as u8) - i64::from(worse_active as u8)),
        );
        apply_i32_gradient(
            &mut model.hidden_bias_q15[hidden_index],
            &mut hidden_bias_carry[hidden_index],
            HIDDEN_BIAS_GRAD_SHIFT,
            &mut stats.hidden_bias_updates,
        );
    }
}

pub fn evaluate(
    model: &CardPolicyModel,
    rows: &[CardPolicySample],
) -> Result<CardPolicyMetrics, Box<dyn Error>> {
    if rows.is_empty() {
        return Err("cannot evaluate an empty dataset".into());
    }
    let mut metrics = CardPolicyMetrics {
        rows: rows.len(),
        ..CardPolicyMetrics::default()
    };
    let mut total_regret = 0_usize;
    let mut top3_coverage = 0_usize;
    let mut adapter_agreement = 0_usize;
    let mut hint_known_zero_regret = 0_usize;
    let mut hint_unknown_zero_regret = 0_usize;
    for row in rows {
        row.validate()?;
        let target = row.target_index()?;
        let features = row
            .candidates
            .iter()
            .map(|candidate| candidate.features_q15)
            .collect::<Vec<_>>();
        let decision = model.rank(&features)?;
        let predicted = decision.ranked_candidate_indices[0];
        let best_loss = row.candidates[target].child_loss;
        let predicted_loss = row.candidates[predicted].child_loss;
        metrics.exact_best += usize::from(predicted == target);
        metrics.zero_regret += usize::from(predicted_loss == best_loss);
        let hint_known = row.candidates[0].features_q15[7] > 0;
        if hint_known {
            metrics.hint_known_rows += 1;
            hint_known_zero_regret += usize::from(predicted_loss == best_loss);
        } else {
            metrics.hint_unknown_rows += 1;
            hint_unknown_zero_regret += usize::from(predicted_loss == best_loss);
        }
        top3_coverage += usize::from(
            decision
                .ranked_candidate_indices
                .iter()
                .take(CARD_POLICY_MAX_TOP_K)
                .any(|index| row.candidates[*index].child_loss == best_loss),
        );
        total_regret += usize::from(predicted_loss.saturating_sub(best_loss));

        let predicted_action =
            decision.action_for_hand(row.hand_candidate_indices, CARD_POLICY_DEFAULT_TOP_K)?;
        let oracle_action = adapt_ranking_to_hand(
            &row.oracle_ranking()?,
            row.hand_candidate_indices,
            CARD_POLICY_DEFAULT_TOP_K,
        )?;
        metrics.predicted_action_counts[predicted_action.index()] += 1;
        metrics.oracle_action_counts[oracle_action.index()] += 1;
        adapter_agreement += usize::from(predicted_action == oracle_action);
    }
    metrics.exact_best_per_mille = metrics.exact_best * 1000 / metrics.rows;
    metrics.zero_regret_per_mille = metrics.zero_regret * 1000 / metrics.rows;
    metrics.hint_known_zero_regret_per_mille =
        hint_known_zero_regret * 1000 / metrics.hint_known_rows.max(1);
    metrics.hint_unknown_zero_regret_per_mille =
        hint_unknown_zero_regret * 1000 / metrics.hint_unknown_rows.max(1);
    metrics.top3_oracle_coverage_per_mille = top3_coverage * 1000 / metrics.rows;
    metrics.mean_regret_milli_steps = total_regret * 1000 / metrics.rows;
    metrics.adapter_agreement_per_mille = adapter_agreement * 1000 / metrics.rows;
    Ok(metrics)
}

pub fn write_dataset(path: &Path, rows: &[CardPolicySample]) -> Result<(), Box<dyn Error>> {
    let mut output = BufWriter::new(fs::File::create(path)?);
    writeln!(output, "# cosyworld-card-ranker-v2")?;
    writeln!(
        output,
        "sample_id\tworld_seed\thand_a\thand_b\ttarget\tcandidate_features_q15\tchild_losses"
    )?;
    for row in rows {
        row.validate()?;
        let feature_groups = row
            .candidates
            .iter()
            .map(|candidate| {
                candidate
                    .features_q15
                    .iter()
                    .map(ToString::to_string)
                    .collect::<Vec<_>>()
                    .join(",")
            })
            .collect::<Vec<_>>()
            .join(";");
        let losses = row
            .candidates
            .iter()
            .map(|candidate| candidate.child_loss.to_string())
            .collect::<Vec<_>>()
            .join(",");
        writeln!(
            output,
            "{}\t{}\t{}\t{}\t{}\t{}\t{}",
            row.sample_id,
            row.world_seed,
            option_index(row.hand_candidate_indices[0]),
            option_index(row.hand_candidate_indices[1]),
            row.target_index()?,
            feature_groups,
            losses,
        )?;
    }
    Ok(())
}

pub fn read_dataset(path: &Path) -> Result<Vec<CardPolicySample>, Box<dyn Error>> {
    let input = BufReader::new(fs::File::open(path)?);
    let mut rows = Vec::new();
    for (line_index, line) in input.lines().enumerate() {
        let line = line?;
        if line.is_empty() || line.starts_with('#') || line.starts_with("sample_id\t") {
            continue;
        }
        let fields = line.split('\t').collect::<Vec<_>>();
        if fields.len() != 7 {
            return Err(format!("invalid dataset row at line {}", line_index + 1).into());
        }
        let feature_groups = fields[5]
            .split(';')
            .map(|group| {
                let values = group
                    .split(',')
                    .map(str::parse::<i16>)
                    .collect::<Result<Vec<_>, _>>()
                    .map_err(|error| {
                        format!("invalid feature at line {}: {error}", line_index + 1)
                    })?;
                values.try_into().map_err(|_| {
                    format!(
                        "line {} candidate must have {} features",
                        line_index + 1,
                        CARD_POLICY_FEATURES
                    )
                })
            })
            .collect::<Result<Vec<[i16; CARD_POLICY_FEATURES]>, _>>()?;
        let losses = fields[6]
            .split(',')
            .map(str::parse::<u16>)
            .collect::<Result<Vec<_>, _>>()?;
        if feature_groups.len() != losses.len() {
            return Err(format!("feature/loss count mismatch at line {}", line_index + 1).into());
        }
        let candidates = feature_groups
            .into_iter()
            .zip(losses)
            .map(|(features_q15, child_loss)| CardPolicyCandidateSample {
                features_q15,
                child_loss,
            })
            .collect();
        let row = CardPolicySample {
            sample_id: fields[0].to_owned(),
            world_seed: fields[1].parse()?,
            hand_candidate_indices: [
                parse_option_index(fields[2])?,
                parse_option_index(fields[3])?,
            ],
            candidates,
        };
        row.validate()?;
        if row.target_index()? != fields[4].parse::<usize>()? {
            return Err(format!("target/loss mismatch at line {}", line_index + 1).into());
        }
        rows.push(row);
    }
    if rows.is_empty() {
        return Err("dataset contains no rows".into());
    }
    Ok(rows)
}

fn option_index(value: Option<usize>) -> String {
    value.map_or_else(|| "-".to_string(), |index| index.to_string())
}

fn parse_option_index(value: &str) -> Result<Option<usize>, Box<dyn Error>> {
    if value == "-" {
        Ok(None)
    } else {
        Ok(Some(value.parse()?))
    }
}

fn apply_i8_gradient(
    value: &mut i8,
    carry: &mut i64,
    shift: u8,
    update_count: &mut usize,
    saturation_count: &mut usize,
) {
    let quantum = 1_i64 << shift;
    let steps = (*carry / quantum).clamp(-8, 8);
    if steps == 0 {
        return;
    }
    *carry -= steps * quantum;
    let proposed = i64::from(*value) + steps;
    let clamped = proposed.clamp(i64::from(i8::MIN), i64::from(i8::MAX));
    *saturation_count += usize::from(proposed != clamped);
    *value = clamped as i8;
    *update_count += 1;
}

fn apply_i32_gradient(value: &mut i32, carry: &mut i64, shift: u8, update_count: &mut usize) {
    let quantum = 1_i64 << shift;
    let steps = (*carry / quantum).clamp(-256, 256);
    if steps == 0 {
        return;
    }
    *carry -= steps * quantum;
    *value = i64::from(*value)
        .saturating_add(steps)
        .clamp(i64::from(i32::MIN), i64::from(i32::MAX)) as i32;
    *update_count += 1;
}

fn take<'a>(bytes: &'a [u8], cursor: &mut usize, count: usize) -> Result<&'a [u8], Box<dyn Error>> {
    let end = cursor
        .checked_add(count)
        .ok_or("card-policy artifact cursor overflow")?;
    let slice = bytes
        .get(*cursor..end)
        .ok_or("card-policy artifact is truncated")?;
    *cursor = end;
    Ok(slice)
}

fn read_u32(bytes: &[u8], cursor: &mut usize) -> Result<u32, Box<dyn Error>> {
    Ok(u32::from_le_bytes(take(bytes, cursor, 4)?.try_into()?))
}

fn read_i32(bytes: &[u8], cursor: &mut usize) -> Result<i32, Box<dyn Error>> {
    Ok(i32::from_le_bytes(take(bytes, cursor, 4)?.try_into()?))
}

fn read_u64(bytes: &[u8], cursor: &mut usize) -> Result<u64, Box<dyn Error>> {
    Ok(u64::from_le_bytes(take(bytes, cursor, 8)?.try_into()?))
}

fn fnv64(bytes: &[u8]) -> u64 {
    let mut hash = 0xcbf2_9ce4_8422_2325_u64;
    for byte in bytes {
        hash ^= u64::from(*byte);
        hash = hash.wrapping_mul(0x0000_0100_0000_01b3);
    }
    hash
}

#[cfg(test)]
mod tests {
    use super::*;

    fn candidate(signal: i16, loss: u16) -> CardPolicyCandidateSample {
        let mut features_q15 = [0; CARD_POLICY_FEATURES];
        features_q15[12] = signal;
        features_q15[23] = i16::MAX;
        CardPolicyCandidateSample {
            features_q15,
            child_loss: loss,
        }
    }

    #[test]
    fn artifact_round_trip_preserves_ranking() {
        let model = CardPolicyModel::new(17);
        let features = [[0; CARD_POLICY_FEATURES], [i16::MAX; CARD_POLICY_FEATURES]];
        let expected = model.rank(&features).unwrap();
        let restored = CardPolicyModel::from_bytes(&model.to_bytes()).unwrap();
        assert_eq!(restored.rank(&features).unwrap(), expected);
    }

    #[test]
    fn rank_only_adapter_does_not_execute_a_known_lower_rank() {
        let ranking = [4, 2, 7, 0, 1, 3, 5, 6];
        assert_eq!(
            adapt_ranking_to_hand(&ranking, [Some(7), Some(2)], 3).unwrap(),
            CardPolicyAction::Draw
        );
        assert_eq!(
            adapt_ranking_to_hand(&ranking, [Some(0), Some(1)], 3).unwrap(),
            CardPolicyAction::Draw
        );
    }

    #[test]
    fn scored_adapter_accepts_only_tied_shortlist_fallbacks() {
        let ranking = [4, 2, 7, 0, 1, 3, 5, 6];
        let mut scores = vec![0; 8];
        scores[4] = 100;
        scores[2] = 100;
        scores[7] = 99;
        assert_eq!(
            adapt_scored_ranking_to_hand(&ranking, &scores, [Some(7), Some(2)], 3).unwrap(),
            CardPolicyAction::B
        );
        assert_eq!(
            adapt_scored_ranking_to_hand(&ranking, &scores, [Some(7), Some(0)], 3).unwrap(),
            CardPolicyAction::Draw
        );
        assert_eq!(
            adapt_scored_ranking_to_hand(&ranking, &scores, [Some(4), Some(2)], 3).unwrap(),
            CardPolicyAction::A
        );
    }

    #[test]
    fn dataset_round_trip_keeps_variable_decks() {
        let rows = vec![CardPolicySample {
            sample_id: "sample".to_string(),
            world_seed: 9,
            hand_candidate_indices: [Some(2), Some(0)],
            candidates: vec![candidate(1, 4), candidate(2, 2), candidate(3, 3)],
        }];
        let path = std::env::temp_dir().join(format!(
            "cosyworld-card-ranker-{}-{}.tsv",
            std::process::id(),
            rows[0].world_seed
        ));
        write_dataset(&path, &rows).unwrap();
        assert_eq!(read_dataset(&path).unwrap(), rows);
        fs::remove_file(path).unwrap();
    }
}
