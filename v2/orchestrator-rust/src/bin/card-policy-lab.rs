#![deny(unsafe_code)]

use std::collections::{BTreeMap, BTreeSet};
use std::env;
use std::error::Error;
use std::fs::{self, OpenOptions};
use std::io::{BufWriter, Write};
use std::path::{Path, PathBuf};
use std::time::Instant;

use cosyworld_orchestrator::card_policy::{
    evaluate, evaluate_synthetic_oracle, evaluate_synthetic_policy, generate_synthetic_dataset,
    read_dataset, simulate_synthetic_population, train, train_from_model, write_dataset,
    CardPolicyCandidateSample, CardPolicyModel, CardPolicySample, CardPolicyTrainingConfig,
    SyntheticDatasetConfig, SyntheticPolicyMetrics, SyntheticPopulationReport,
    CARD_POLICY_DEFAULT_TOP_K, CARD_POLICY_FEATURES, CARD_POLICY_MAX_TOP_K,
};
use rusqlite::{Connection, OpenFlags};
use serde::Serialize;
use serde_json::{json, Value};

fn main() {
    if let Err(error) = run() {
        eprintln!("card-policy-lab: {error}");
        std::process::exit(1);
    }
}

fn run() -> Result<(), Box<dyn Error>> {
    let mut args = env::args().skip(1);
    match args.next().as_deref() {
        Some("generate") => generate_command(args),
        Some("train") => train_command(args),
        Some("eval") => eval_command(args),
        Some("simulate") => simulate_command(args),
        Some("gate") => gate_command(args),
        Some("export-shadow") => export_shadow_command(args),
        Some("prepare-real") => prepare_real_command(args),
        Some("pipeline") => pipeline_command(args),
        Some("--help" | "-h") | None => {
            print_help();
            Ok(())
        }
        Some(other) => Err(format!("unknown command: {other}").into()),
    }
}

fn print_help() {
    println!(
        "\
Cosyworld all-card integer ranker lab

Usage:
  card-policy-lab generate --out DATA.tsv [synthetic options]
  card-policy-lab train --train TRAIN.tsv --calibration CAL.tsv \\
      --model-out MODEL.cwrank --trace TRAIN.json [--model-in MODEL.cwrank] [training options]
  card-policy-lab eval --data EVAL.tsv --model MODEL.cwrank --trace EVAL.json \\
      [--predictions-out PREDICTIONS.tsv]
  card-policy-lab simulate --model MODEL.cwrank [--trace POPULATION.json] \\
      [--top-k 1] [simulation options]
  card-policy-lab gate --data EVAL.tsv --incumbent MODEL.cwrank --challenger MODEL.cwrank \
      --trace GATE.json
  card-policy-lab export-shadow --journal EVENTS.sqlite --out SHADOW.ndjson \
      [--dataset-out LABELED.tsv] [--after-seq N] [--append]
  card-policy-lab prepare-real --out-dir DIR [--seed N] SHARD.tsv [SHARD.tsv ...]
  card-policy-lab pipeline --out-dir DIR [pipeline options]

The model ranks every legal card. At runtime the best card, or a shortlisted
card whose integer score exactly ties it, becomes A or B when shown. Otherwise
the adapter emits DRAW and ranks the complete deck again on the next turn.

Synthetic options:
  --worlds N                    default 1000
  --trajectories N              default 4
  --max-steps N                 default 48
  --min-nodes N                 default 7
  --max-nodes N                 default 12
  --seed N                      default 1
  --oracle-behavior-percent N   default 70

Simulation options:
  --worlds N                    default 2500
  --avatars-per-world N         default 4 (10,000 independent avatars total)
  --max-steps N                 default 48
  --min-nodes N                 default 7
  --max-nodes N                 default 12
  --seed N                      default 1
  --top-k N                     default 1, maximum 3

Training options:
  --epochs N                    default 64
  --seed N                      default 1
  --regret-gradient-shift N     default 3
  --model-in PATH               warm-start a challenger for gated online learning

Pipeline options:
  --train-worlds N              default 1000
  --calibration-worlds N        default 200
  --eval-worlds N               default 200
  plus synthetic/training options above"
    );
}

fn generate_command(mut args: impl Iterator<Item = String>) -> Result<(), Box<dyn Error>> {
    let mut output = None;
    let mut config = SyntheticDatasetConfig::default();
    while let Some(argument) = args.next() {
        match argument.as_str() {
            "--out" => output = Some(PathBuf::from(required(&mut args, "--out")?)),
            _ => parse_synthetic_option(&argument, &mut args, &mut config)?,
        }
    }
    let output = output.ok_or("--out is required")?;
    ensure_parent(&output)?;
    let rows = generate_synthetic_dataset(config)?;
    write_dataset(&output, &rows)?;
    print_json(&GenerationSummary {
        output: output.display().to_string(),
        rows: rows.len(),
        candidate_cards: candidate_cards(&rows),
        worlds: distinct_worlds(&rows),
        config,
    })
}

fn train_command(mut args: impl Iterator<Item = String>) -> Result<(), Box<dyn Error>> {
    let mut train_path = None;
    let mut calibration_path = None;
    let mut model_in = None;
    let mut model_out = None;
    let mut trace_out = None;
    let mut config = CardPolicyTrainingConfig::default();
    while let Some(argument) = args.next() {
        match argument.as_str() {
            "--train" => train_path = Some(PathBuf::from(required(&mut args, "--train")?)),
            "--calibration" => {
                calibration_path = Some(PathBuf::from(required(&mut args, "--calibration")?))
            }
            "--model-in" => model_in = Some(PathBuf::from(required(&mut args, "--model-in")?)),
            "--model-out" => model_out = Some(PathBuf::from(required(&mut args, "--model-out")?)),
            "--trace" => trace_out = Some(PathBuf::from(required(&mut args, "--trace")?)),
            "--epochs" => config.epochs = required(&mut args, "--epochs")?.parse()?,
            "--seed" => config.seed = required(&mut args, "--seed")?.parse()?,
            "--regret-gradient-shift" => {
                config.regret_gradient_shift =
                    required(&mut args, "--regret-gradient-shift")?.parse()?
            }
            other => return Err(format!("unknown train argument: {other}").into()),
        }
    }
    let train_path = train_path.ok_or("--train is required")?;
    let calibration_path = calibration_path.ok_or("--calibration is required")?;
    let model_out = model_out.ok_or("--model-out is required")?;
    let trace_out = trace_out.ok_or("--trace is required")?;
    ensure_parent(&model_out)?;
    ensure_parent(&trace_out)?;
    let train_rows = read_dataset(&train_path)?;
    let calibration_rows = read_dataset(&calibration_path)?;
    reject_overlapping_worlds(&train_rows, &calibration_rows)?;
    let (model, report) = if let Some(path) = model_in {
        let initial = CardPolicyModel::from_bytes(&fs::read(path)?)?;
        train_from_model(initial, &train_rows, &calibration_rows, config)?
    } else {
        train(&train_rows, &calibration_rows, config)?
    };
    fs::write(&model_out, model.to_bytes())?;
    fs::write(&trace_out, serde_json::to_vec_pretty(&report)?)?;
    print_json(&report)
}

fn eval_command(mut args: impl Iterator<Item = String>) -> Result<(), Box<dyn Error>> {
    let mut data_path = None;
    let mut model_path = None;
    let mut trace_out = None;
    let mut predictions_out = None;
    while let Some(argument) = args.next() {
        match argument.as_str() {
            "--data" => data_path = Some(PathBuf::from(required(&mut args, "--data")?)),
            "--model" => model_path = Some(PathBuf::from(required(&mut args, "--model")?)),
            "--trace" => trace_out = Some(PathBuf::from(required(&mut args, "--trace")?)),
            "--predictions-out" => {
                predictions_out = Some(PathBuf::from(required(&mut args, "--predictions-out")?))
            }
            other => return Err(format!("unknown eval argument: {other}").into()),
        }
    }
    let data_path = data_path.ok_or("--data is required")?;
    let model_path = model_path.ok_or("--model is required")?;
    let trace_out = trace_out.ok_or("--trace is required")?;
    ensure_parent(&trace_out)?;
    let model = CardPolicyModel::from_bytes(&fs::read(model_path)?)?;
    let rows = read_dataset(&data_path)?;
    let data_profile = profile_dataset(&rows)?;
    let report = EvaluationReport {
        model_hash: model.model_hash(),
        metrics: evaluate(&model, &rows)?,
        worlds: distinct_worlds(&rows),
        data_profile,
    };
    fs::write(&trace_out, serde_json::to_vec_pretty(&report)?)?;
    if let Some(path) = predictions_out {
        ensure_parent(&path)?;
        write_predictions(&path, &model, &rows)?;
    }
    print_json(&report)
}

fn simulate_command(mut args: impl Iterator<Item = String>) -> Result<(), Box<dyn Error>> {
    let mut model_path = None;
    let mut trace_out = None;
    let mut top_k = CARD_POLICY_DEFAULT_TOP_K;
    let mut config = SyntheticDatasetConfig {
        worlds: 2_500,
        trajectories_per_world: 4,
        ..SyntheticDatasetConfig::default()
    };
    while let Some(argument) = args.next() {
        match argument.as_str() {
            "--model" => model_path = Some(PathBuf::from(required(&mut args, "--model")?)),
            "--trace" => trace_out = Some(PathBuf::from(required(&mut args, "--trace")?)),
            "--top-k" => top_k = required(&mut args, "--top-k")?.parse()?,
            "--avatars-per-world" => {
                config.trajectories_per_world =
                    required(&mut args, "--avatars-per-world")?.parse()?
            }
            _ => parse_synthetic_option(&argument, &mut args, &mut config)?,
        }
    }
    if !(1..=CARD_POLICY_MAX_TOP_K).contains(&top_k) {
        return Err(format!("--top-k must be between 1 and {CARD_POLICY_MAX_TOP_K}").into());
    }
    let model_path = model_path.ok_or("--model is required")?;
    let model = CardPolicyModel::from_bytes(&fs::read(&model_path)?)?;
    let started = Instant::now();
    let population = simulate_synthetic_population(&model, config, top_k)?;
    let elapsed_milliseconds = started.elapsed().as_millis();
    let avatars_per_second = population.avatars as u128 * 1_000 / elapsed_milliseconds.max(1);
    let report = PopulationSimulationRun {
        model_path: model_path.display().to_string(),
        model_hash_hex: format!("{:016x}", model.model_hash()),
        elapsed_milliseconds,
        avatars_per_second,
        population,
    };
    if let Some(path) = trace_out {
        ensure_parent(&path)?;
        fs::write(path, serde_json::to_vec_pretty(&report)?)?;
    }
    print_json(&report)
}

fn gate_command(mut args: impl Iterator<Item = String>) -> Result<(), Box<dyn Error>> {
    let mut data_path = None;
    let mut incumbent_path = None;
    let mut challenger_path = None;
    let mut trace_out = None;
    while let Some(argument) = args.next() {
        match argument.as_str() {
            "--data" => data_path = Some(PathBuf::from(required(&mut args, "--data")?)),
            "--incumbent" => {
                incumbent_path = Some(PathBuf::from(required(&mut args, "--incumbent")?))
            }
            "--challenger" => {
                challenger_path = Some(PathBuf::from(required(&mut args, "--challenger")?))
            }
            "--trace" => trace_out = Some(PathBuf::from(required(&mut args, "--trace")?)),
            other => return Err(format!("unknown gate argument: {other}").into()),
        }
    }
    let data_path = data_path.ok_or("--data is required")?;
    let incumbent_path = incumbent_path.ok_or("--incumbent is required")?;
    let challenger_path = challenger_path.ok_or("--challenger is required")?;
    let trace_out = trace_out.ok_or("--trace is required")?;
    ensure_parent(&trace_out)?;
    let rows = read_dataset(&data_path)?;
    let data_profile = profile_dataset(&rows)?;
    let incumbent = CardPolicyModel::from_bytes(&fs::read(incumbent_path)?)?;
    let challenger = CardPolicyModel::from_bytes(&fs::read(challenger_path)?)?;
    let incumbent_metrics = evaluate(&incumbent, &rows)?;
    let challenger_metrics = evaluate(&challenger, &rows)?;
    let checks = PromotionGateChecks {
        distinct_artifact: incumbent.model_hash() != challenger.model_hash(),
        learnable_signal_present: data_profile.learnable_strict_rows > 0,
        mean_regret_non_regressing: challenger_metrics.mean_regret_milli_steps
            <= incumbent_metrics.mean_regret_milli_steps,
        zero_regret_non_regressing: challenger_metrics.zero_regret_per_mille
            >= incumbent_metrics.zero_regret_per_mille,
        clue_policy_non_regressing: challenger_metrics.hint_known_zero_regret_per_mille
            >= incumbent_metrics.hint_known_zero_regret_per_mille,
        adapter_non_regressing: challenger_metrics.adapter_agreement_per_mille
            >= incumbent_metrics.adapter_agreement_per_mille,
    };
    let eligible_for_promotion = checks.distinct_artifact
        && checks.learnable_signal_present
        && checks.mean_regret_non_regressing
        && checks.zero_regret_non_regressing
        && checks.clue_policy_non_regressing
        && checks.adapter_non_regressing;
    let report = PromotionGateReport {
        schema_version: 1,
        rows: rows.len(),
        worlds: distinct_worlds(&rows),
        incumbent_model_hash: incumbent.model_hash(),
        challenger_model_hash: challenger.model_hash(),
        checks,
        data_profile,
        eligible_for_promotion,
        incumbent: incumbent_metrics,
        challenger: challenger_metrics,
    };
    fs::write(&trace_out, serde_json::to_vec_pretty(&report)?)?;
    print_json(&report)
}

fn export_shadow_command(mut args: impl Iterator<Item = String>) -> Result<(), Box<dyn Error>> {
    let mut journal_path = None;
    let mut output_path = None;
    let mut dataset_path = None;
    let mut after_seq = 0_u64;
    let mut append = false;
    while let Some(argument) = args.next() {
        match argument.as_str() {
            "--journal" => journal_path = Some(PathBuf::from(required(&mut args, "--journal")?)),
            "--out" => output_path = Some(PathBuf::from(required(&mut args, "--out")?)),
            "--dataset-out" => {
                dataset_path = Some(PathBuf::from(required(&mut args, "--dataset-out")?))
            }
            "--after-seq" => after_seq = required(&mut args, "--after-seq")?.parse()?,
            "--append" => append = true,
            other => return Err(format!("unknown export-shadow argument: {other}").into()),
        }
    }
    let journal_path = journal_path.ok_or("--journal is required")?;
    let output_path = output_path.ok_or("--out is required")?;
    ensure_parent(&output_path)?;
    let connection = Connection::open_with_flags(&journal_path, OpenFlags::SQLITE_OPEN_READ_ONLY)?;
    let mut statement = connection.prepare(
        "SELECT journal_seq, created_at_ms, record_json
         FROM action_journal
         WHERE journal_seq > ?1
         ORDER BY journal_seq ASC",
    )?;
    let records = statement.query_map([after_seq], |row| {
        Ok((
            row.get::<_, u64>(0)?,
            row.get::<_, u64>(1)?,
            row.get::<_, String>(2)?,
        ))
    })?;
    let output_file = if append {
        OpenOptions::new()
            .create(true)
            .append(true)
            .open(&output_path)?
    } else {
        fs::File::create(&output_path)?
    };
    let mut output = BufWriter::new(output_file);
    let mut exported = 0_usize;
    let mut labeled_rows = Vec::new();
    let mut first_seq = None;
    let mut last_seq = None;
    for record in records {
        let (journal_seq, created_at_ms, record_json) = record?;
        let record: Value = serde_json::from_str(&record_json)?;
        let Some(planning) = record.get("resident_planning") else {
            continue;
        };
        let Some(policy) = planning.get("card_policy") else {
            continue;
        };
        let rollout_mode = policy
            .get("rollout_mode")
            .and_then(Value::as_str)
            .unwrap_or_default();
        if !matches!(rollout_mode, "shadow" | "live") {
            continue;
        }
        let labeled = shadow_training_row(journal_seq, planning, policy)?;
        let label = policy.get("branch_label");
        let observation = json!({
            "schema_version": 2,
            "journal_seq": journal_seq,
            "created_at_ms": created_at_ms,
            "actor_id": planning.get("actor_id"),
            "state_revision": planning.get("state_revision"),
            "rollout_mode": rollout_mode,
            "model_hash": policy.get("model_hash"),
            "top_k": policy.get("top_k"),
            "action": policy.get("action"),
            "deck_candidate_ids": policy.get("deck_candidate_ids"),
            "hand_candidate_ids": policy.get("hand_candidate_ids"),
            "candidate_features_q15": policy.get("candidate_features_q15"),
            "scores_q8": policy.get("scores_q8"),
            "ranked_candidate_ids": policy.get("ranked_candidate_ids"),
            "top_candidate_id": policy.get("top_candidate_id"),
            "selected_offer_id": policy.get("selected_offer_id"),
            "llm_offer_id": policy.get("llm_offer_id"),
            "agrees_with_llm": policy.get("agrees_with_llm"),
            "objective_id": label.and_then(|value| value.get("objective_id")),
            "objective_turn": label.and_then(|value| value.get("objective_turn")),
            "branch_evaluator": label.and_then(|value| value.get("evaluator")),
            "child_losses": label.and_then(|value| value.get("child_losses")),
            "label_status": if labeled.is_some() { "counterfactual" } else { "unlabeled" },
            "training_eligible": labeled.is_some(),
        });
        serde_json::to_writer(&mut output, &observation)?;
        writeln!(output)?;
        exported += 1;
        first_seq.get_or_insert(journal_seq);
        last_seq = Some(journal_seq);
        if let Some(row) = labeled {
            labeled_rows.push(row);
        }
    }
    output.flush()?;
    if let Some(path) = dataset_path.as_ref() {
        ensure_parent(path)?;
        if append && path.exists() && path.metadata()?.len() > 0 {
            append_dataset(path, &labeled_rows)?;
        } else {
            write_dataset(path, &labeled_rows)?;
        }
    }
    let label_status = if labeled_rows.is_empty() {
        "unlabeled"
    } else if labeled_rows.len() == exported {
        "counterfactual"
    } else {
        "mixed"
    };
    print_json(&ShadowExportSummary {
        schema_version: 2,
        journal: journal_path.display().to_string(),
        output: output_path.display().to_string(),
        after_seq,
        exported,
        labeled: labeled_rows.len(),
        dataset: dataset_path.map(|path| path.display().to_string()),
        first_seq,
        last_seq,
        label_status: label_status.to_string(),
        training_eligible: !labeled_rows.is_empty(),
    })
}

fn append_dataset(path: &Path, rows: &[CardPolicySample]) -> Result<(), Box<dyn Error>> {
    let mut output = BufWriter::new(OpenOptions::new().append(true).open(path)?);
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
        let hand =
            |index: Option<usize>| index.map_or_else(|| "-".to_string(), |index| index.to_string());
        writeln!(
            output,
            "{}\t{}\t{}\t{}\t{}\t{}\t{}",
            row.sample_id,
            row.world_seed,
            hand(row.hand_candidate_indices[0]),
            hand(row.hand_candidate_indices[1]),
            row.target_index()?,
            feature_groups,
            losses,
        )?;
    }
    output.flush()?;
    Ok(())
}

fn prepare_real_command(mut args: impl Iterator<Item = String>) -> Result<(), Box<dyn Error>> {
    let mut output_dir = None;
    let mut seed = 1_u64;
    let mut input_paths = Vec::new();
    while let Some(argument) = args.next() {
        match argument.as_str() {
            "--out-dir" => output_dir = Some(PathBuf::from(required(&mut args, "--out-dir")?)),
            "--seed" => seed = required(&mut args, "--seed")?.parse()?,
            option if option.starts_with('-') => {
                return Err(format!("unknown prepare-real argument: {option}").into())
            }
            path => input_paths.push(PathBuf::from(path)),
        }
    }
    let output_dir = output_dir.ok_or("--out-dir is required")?;
    if input_paths.is_empty() {
        return Err("prepare-real requires at least one shard dataset".into());
    }

    let mut rows = Vec::new();
    for path in &input_paths {
        rows.extend(read_dataset(path)?);
    }
    let mut sample_ids = BTreeSet::new();
    for row in &rows {
        if !sample_ids.insert(row.sample_id.as_str()) {
            return Err(format!("duplicate sample id across shards: {}", row.sample_id).into());
        }
    }
    let (train_rows, calibration_rows, eval_rows) = split_rows_by_world(&rows, seed)?;
    reject_overlapping_worlds(&train_rows, &calibration_rows)?;
    reject_overlapping_worlds(&train_rows, &eval_rows)?;
    reject_overlapping_worlds(&calibration_rows, &eval_rows)?;

    fs::create_dir_all(&output_dir)?;
    write_dataset(&output_dir.join("all.tsv"), &rows)?;
    write_dataset(&output_dir.join("train.tsv"), &train_rows)?;
    write_dataset(&output_dir.join("calibration.tsv"), &calibration_rows)?;
    write_dataset(&output_dir.join("eval.tsv"), &eval_rows)?;
    print_json(&RealDatasetPreparationSummary {
        schema_version: 1,
        input_shards: input_paths.len(),
        rows: rows.len(),
        worlds: distinct_worlds(&rows),
        train_rows: train_rows.len(),
        train_worlds: distinct_worlds(&train_rows),
        calibration_rows: calibration_rows.len(),
        calibration_worlds: distinct_worlds(&calibration_rows),
        eval_rows: eval_rows.len(),
        eval_worlds: distinct_worlds(&eval_rows),
        profile: profile_dataset(&rows)?,
        seed,
        output_dir: output_dir.display().to_string(),
    })
}

fn split_rows_by_world(
    rows: &[CardPolicySample],
    seed: u64,
) -> Result<
    (
        Vec<CardPolicySample>,
        Vec<CardPolicySample>,
        Vec<CardPolicySample>,
    ),
    Box<dyn Error>,
> {
    let mut worlds = rows.iter().map(|row| row.world_seed).collect::<Vec<_>>();
    worlds.sort_unstable();
    worlds.dedup();
    if worlds.len() < 3 {
        return Err("prepare-real requires at least three distinct worlds".into());
    }
    worlds.sort_by_key(|world| (splitmix64(*world ^ seed), *world));
    let calibration_worlds = (worlds.len() * 15 / 100).max(1);
    let eval_worlds = (worlds.len() * 15 / 100).max(1);
    let train_worlds = worlds.len() - calibration_worlds - eval_worlds;
    if train_worlds == 0 {
        return Err("prepare-real split left no training worlds".into());
    }
    let calibration_start = train_worlds;
    let eval_start = calibration_start + calibration_worlds;
    let train = worlds[..calibration_start]
        .iter()
        .copied()
        .collect::<BTreeSet<_>>();
    let calibration = worlds[calibration_start..eval_start]
        .iter()
        .copied()
        .collect::<BTreeSet<_>>();

    let mut train_rows = Vec::new();
    let mut calibration_rows = Vec::new();
    let mut eval_rows = Vec::new();
    for row in rows {
        if train.contains(&row.world_seed) {
            train_rows.push(row.clone());
        } else if calibration.contains(&row.world_seed) {
            calibration_rows.push(row.clone());
        } else {
            eval_rows.push(row.clone());
        }
    }
    Ok((train_rows, calibration_rows, eval_rows))
}

fn splitmix64(mut value: u64) -> u64 {
    value = value.wrapping_add(0x9e37_79b9_7f4a_7c15);
    value = (value ^ (value >> 30)).wrapping_mul(0xbf58_476d_1ce4_e5b9);
    value = (value ^ (value >> 27)).wrapping_mul(0x94d0_49bb_1331_11eb);
    value ^ (value >> 31)
}

fn profile_dataset(rows: &[CardPolicySample]) -> Result<CardPolicyDatasetProfile, Box<dyn Error>> {
    let mut strict_preference_rows = 0_usize;
    let mut all_candidate_features_identical_rows = 0_usize;
    let mut learnable_strict_rows = 0_usize;
    let mut targets_by_features = BTreeMap::<String, BTreeSet<usize>>::new();
    for row in rows {
        let target = row.target_index()?;
        let minimum_loss = row
            .candidates
            .iter()
            .map(|candidate| candidate.child_loss)
            .min()
            .ok_or("card-policy sample has no candidates")?;
        let strict = row
            .candidates
            .iter()
            .filter(|candidate| candidate.child_loss == minimum_loss)
            .count()
            == 1;
        let identical = row
            .candidates
            .windows(2)
            .all(|pair| pair[0].features_q15 == pair[1].features_q15);
        strict_preference_rows += usize::from(strict);
        all_candidate_features_identical_rows += usize::from(identical);
        learnable_strict_rows += usize::from(strict && !identical);
        let feature_key = format!(
            "{:?}:{:?}",
            row.hand_candidate_indices,
            row.candidates
                .iter()
                .map(|candidate| candidate.features_q15)
                .collect::<Vec<_>>()
        );
        targets_by_features
            .entry(feature_key)
            .or_default()
            .insert(target);
    }
    Ok(CardPolicyDatasetProfile {
        strict_preference_rows,
        all_candidate_features_identical_rows,
        learnable_strict_rows,
        conflicting_feature_groups: targets_by_features
            .values()
            .filter(|targets| targets.len() > 1)
            .count(),
    })
}

fn shadow_training_row(
    journal_seq: u64,
    planning: &Value,
    policy: &Value,
) -> Result<Option<CardPolicySample>, Box<dyn Error>> {
    let Some(label) = policy.get("branch_label") else {
        return Ok(None);
    };
    let Some(objective_id) = label.get("objective_id").and_then(Value::as_str) else {
        return Ok(None);
    };
    let Some(loss_values) = label.get("child_losses").and_then(Value::as_array) else {
        return Ok(None);
    };
    let Some(feature_groups) = policy
        .get("candidate_features_q15")
        .and_then(Value::as_array)
    else {
        return Ok(None);
    };
    let Some(deck_ids) = policy.get("deck_candidate_ids").and_then(Value::as_array) else {
        return Ok(None);
    };
    let Some(hand_ids) = policy.get("hand_candidate_ids").and_then(Value::as_array) else {
        return Ok(None);
    };
    if feature_groups.is_empty()
        || feature_groups.len() != loss_values.len()
        || feature_groups.len() != deck_ids.len()
        || hand_ids.len() != 2
    {
        return Ok(None);
    }

    let candidates = feature_groups
        .iter()
        .zip(loss_values)
        .map(|(features, loss)| {
            let features = features
                .as_array()
                .ok_or("shadow label feature group is not an array")?
                .iter()
                .map(|value| {
                    let value = value
                        .as_i64()
                        .ok_or("shadow label feature is not an integer")?;
                    i16::try_from(value).map_err(|_| "shadow label feature is outside i16")
                })
                .collect::<Result<Vec<_>, _>>()?;
            let features_q15: [i16; CARD_POLICY_FEATURES] = features
                .try_into()
                .map_err(|_| "shadow label feature count does not match model schema")?;
            let child_loss = loss
                .as_u64()
                .and_then(|value| u16::try_from(value).ok())
                .ok_or("shadow child loss is outside u16")?;
            Ok::<CardPolicyCandidateSample, Box<dyn Error>>(CardPolicyCandidateSample {
                features_q15,
                child_loss,
            })
        })
        .collect::<Result<Vec<_>, _>>()?;
    let deck_ids = deck_ids
        .iter()
        .map(|value| value.as_str())
        .collect::<Option<Vec<_>>>();
    let Some(deck_ids) = deck_ids else {
        return Ok(None);
    };
    let hand_candidate_indices = [0, 1].map(|slot| {
        hand_ids[slot]
            .as_str()
            .and_then(|hand_id| deck_ids.iter().position(|deck_id| *deck_id == hand_id))
    });
    let actor_id = planning
        .get("actor_id")
        .and_then(Value::as_u64)
        .unwrap_or(0);
    let row = CardPolicySample {
        sample_id: format!("real:{objective_id}:{actor_id}:{journal_seq}"),
        world_seed: stable_episode_seed(objective_id),
        hand_candidate_indices,
        candidates,
    };
    row.validate()?;
    Ok(Some(row))
}

fn stable_episode_seed(value: &str) -> u64 {
    value.bytes().fold(0xcbf2_9ce4_8422_2325_u64, |hash, byte| {
        (hash ^ u64::from(byte)).wrapping_mul(0x0000_0100_0000_01b3)
    })
}

fn pipeline_command(mut args: impl Iterator<Item = String>) -> Result<(), Box<dyn Error>> {
    let mut output_dir = None;
    let mut model_in = None;
    let mut train_worlds = 1_000_u32;
    let mut calibration_worlds = 200_u32;
    let mut eval_worlds = 200_u32;
    let mut synthetic = SyntheticDatasetConfig::default();
    let mut training = CardPolicyTrainingConfig::default();
    while let Some(argument) = args.next() {
        match argument.as_str() {
            "--out-dir" => output_dir = Some(PathBuf::from(required(&mut args, "--out-dir")?)),
            "--model-in" => model_in = Some(PathBuf::from(required(&mut args, "--model-in")?)),
            "--train-worlds" => train_worlds = required(&mut args, "--train-worlds")?.parse()?,
            "--calibration-worlds" => {
                calibration_worlds = required(&mut args, "--calibration-worlds")?.parse()?
            }
            "--eval-worlds" => eval_worlds = required(&mut args, "--eval-worlds")?.parse()?,
            "--epochs" => training.epochs = required(&mut args, "--epochs")?.parse()?,
            "--regret-gradient-shift" => {
                training.regret_gradient_shift =
                    required(&mut args, "--regret-gradient-shift")?.parse()?
            }
            "--seed" => {
                let seed = required(&mut args, "--seed")?.parse()?;
                synthetic.seed = seed;
                training.seed = seed;
            }
            _ => parse_synthetic_option(&argument, &mut args, &mut synthetic)?,
        }
    }
    let output_dir = output_dir.ok_or("--out-dir is required")?;
    fs::create_dir_all(&output_dir)?;

    let mut train_config = synthetic;
    train_config.worlds = train_worlds;
    let mut calibration_config = synthetic;
    calibration_config.worlds = calibration_worlds;
    calibration_config.seed ^= 0x4341_4c49_4252_4154;
    let mut eval_config = synthetic;
    eval_config.worlds = eval_worlds;
    eval_config.seed ^= 0x4556_414c_5541_5445;

    let train_rows = generate_synthetic_dataset(train_config)?;
    let calibration_rows = generate_synthetic_dataset(calibration_config)?;
    let eval_rows = generate_synthetic_dataset(eval_config)?;
    reject_overlapping_worlds(&train_rows, &calibration_rows)?;
    reject_overlapping_worlds(&train_rows, &eval_rows)?;
    reject_overlapping_worlds(&calibration_rows, &eval_rows)?;

    let train_path = output_dir.join("train.tsv");
    let calibration_path = output_dir.join("calibration.tsv");
    let eval_path = output_dir.join("eval.tsv");
    let model_path = output_dir.join("card-policy.cwrank");
    let training_trace_path = output_dir.join("training.json");
    let evaluation_trace_path = output_dir.join("evaluation.json");
    let predictions_path = output_dir.join("predictions.tsv");
    write_dataset(&train_path, &train_rows)?;
    write_dataset(&calibration_path, &calibration_rows)?;
    write_dataset(&eval_path, &eval_rows)?;

    let (model, training_report) = if let Some(path) = model_in {
        let initial = CardPolicyModel::from_bytes(&fs::read(path)?)?;
        train_from_model(initial, &train_rows, &calibration_rows, training)?
    } else {
        train(&train_rows, &calibration_rows, training)?
    };
    fs::write(&model_path, model.to_bytes())?;
    fs::write(
        &training_trace_path,
        serde_json::to_vec_pretty(&training_report)?,
    )?;
    let evaluation_report = EvaluationReport {
        model_hash: model.model_hash(),
        metrics: evaluate(&model, &eval_rows)?,
        worlds: distinct_worlds(&eval_rows),
        data_profile: profile_dataset(&eval_rows)?,
    };
    let learned_policy = [
        evaluate_synthetic_policy(&model, eval_config, 1)?,
        evaluate_synthetic_policy(&model, eval_config, 2)?,
        evaluate_synthetic_policy(&model, eval_config, 3)?,
    ];
    let oracle_policy = [
        evaluate_synthetic_oracle(eval_config, 1)?,
        evaluate_synthetic_oracle(eval_config, 2)?,
        evaluate_synthetic_oracle(eval_config, 3)?,
    ];
    let pipeline_evaluation = PipelineEvaluation {
        ranking: evaluation_report,
        learned_policy,
        oracle_policy,
    };
    fs::write(
        &evaluation_trace_path,
        serde_json::to_vec_pretty(&pipeline_evaluation)?,
    )?;
    write_predictions(&predictions_path, &model, &eval_rows)?;

    print_json(&PipelineSummary {
        output_dir: output_dir.display().to_string(),
        train_rows: train_rows.len(),
        train_candidate_cards: candidate_cards(&train_rows),
        calibration_rows: calibration_rows.len(),
        eval_rows: eval_rows.len(),
        training: training_report,
        evaluation: pipeline_evaluation,
    })
}

fn parse_synthetic_option(
    argument: &str,
    args: &mut impl Iterator<Item = String>,
    config: &mut SyntheticDatasetConfig,
) -> Result<(), Box<dyn Error>> {
    match argument {
        "--worlds" => config.worlds = required(args, "--worlds")?.parse()?,
        "--trajectories" => {
            config.trajectories_per_world = required(args, "--trajectories")?.parse()?
        }
        "--max-steps" => config.max_steps = required(args, "--max-steps")?.parse()?,
        "--min-nodes" => config.min_nodes = required(args, "--min-nodes")?.parse()?,
        "--max-nodes" => config.max_nodes = required(args, "--max-nodes")?.parse()?,
        "--seed" => config.seed = required(args, "--seed")?.parse()?,
        "--oracle-behavior-percent" => {
            config.oracle_behavior_percent = required(args, "--oracle-behavior-percent")?.parse()?
        }
        other => return Err(format!("unknown synthetic argument: {other}").into()),
    }
    Ok(())
}

fn required(
    args: &mut impl Iterator<Item = String>,
    option: &str,
) -> Result<String, Box<dyn Error>> {
    args.next()
        .ok_or_else(|| format!("{option} requires a value").into())
}

fn ensure_parent(path: &Path) -> Result<(), Box<dyn Error>> {
    if let Some(parent) = path
        .parent()
        .filter(|parent| !parent.as_os_str().is_empty())
    {
        fs::create_dir_all(parent)?;
    }
    Ok(())
}

fn distinct_worlds(rows: &[CardPolicySample]) -> usize {
    let mut seeds = rows.iter().map(|row| row.world_seed).collect::<Vec<_>>();
    seeds.sort_unstable();
    seeds.dedup();
    seeds.len()
}

fn candidate_cards(rows: &[CardPolicySample]) -> usize {
    rows.iter().map(|row| row.candidates.len()).sum()
}

fn reject_overlapping_worlds(
    left: &[CardPolicySample],
    right: &[CardPolicySample],
) -> Result<(), Box<dyn Error>> {
    let mut left_seeds = left.iter().map(|row| row.world_seed).collect::<Vec<_>>();
    let mut right_seeds = right.iter().map(|row| row.world_seed).collect::<Vec<_>>();
    left_seeds.sort_unstable();
    left_seeds.dedup();
    right_seeds.sort_unstable();
    right_seeds.dedup();
    if left_seeds
        .iter()
        .any(|seed| right_seeds.binary_search(seed).is_ok())
    {
        return Err("datasets overlap by world seed; split worlds, not rows".into());
    }
    Ok(())
}

fn write_predictions(
    path: &Path,
    model: &CardPolicyModel,
    rows: &[CardPolicySample],
) -> Result<(), Box<dyn Error>> {
    let mut output = BufWriter::new(fs::File::create(path)?);
    writeln!(
        output,
        "sample_id\tworld_seed\ttarget\tpredicted\ttop3\tadapter_action\tranking\tscores_q8\tchild_losses"
    )?;
    for row in rows {
        let features = row
            .candidates
            .iter()
            .map(|candidate| candidate.features_q15)
            .collect::<Vec<_>>();
        let decision = model.rank(&features)?;
        let action = decision.action_for_hand(row.hand_candidate_indices, 3)?;
        let ranking = decision
            .ranked_candidate_indices
            .iter()
            .map(ToString::to_string)
            .collect::<Vec<_>>()
            .join(",");
        let top3 = decision
            .ranked_candidate_indices
            .iter()
            .take(3)
            .map(ToString::to_string)
            .collect::<Vec<_>>()
            .join(",");
        let scores = decision
            .scores_q8
            .iter()
            .map(ToString::to_string)
            .collect::<Vec<_>>()
            .join(",");
        let losses = row
            .candidates
            .iter()
            .map(|candidate| candidate.child_loss.to_string())
            .collect::<Vec<_>>()
            .join(",");
        writeln!(
            output,
            "{}\t{}\t{}\t{}\t{}\t{:?}\t{}\t{}\t{}",
            row.sample_id,
            row.world_seed,
            row.target_index()?,
            decision.ranked_candidate_indices[0],
            top3,
            action,
            ranking,
            scores,
            losses,
        )?;
    }
    Ok(())
}

fn print_json(value: &impl Serialize) -> Result<(), Box<dyn Error>> {
    println!("{}", serde_json::to_string_pretty(value)?);
    Ok(())
}

#[derive(Serialize)]
struct GenerationSummary {
    output: String,
    rows: usize,
    candidate_cards: usize,
    worlds: usize,
    config: SyntheticDatasetConfig,
}

#[derive(Serialize)]
struct EvaluationReport {
    model_hash: u64,
    metrics: cosyworld_orchestrator::card_policy::CardPolicyMetrics,
    worlds: usize,
    data_profile: CardPolicyDatasetProfile,
}

#[derive(Serialize)]
struct PipelineEvaluation {
    ranking: EvaluationReport,
    learned_policy: [SyntheticPolicyMetrics; 3],
    oracle_policy: [SyntheticPolicyMetrics; 3],
}

#[derive(Serialize)]
struct PipelineSummary {
    output_dir: String,
    train_rows: usize,
    train_candidate_cards: usize,
    calibration_rows: usize,
    eval_rows: usize,
    training: cosyworld_orchestrator::card_policy::CardPolicyTrainingReport,
    evaluation: PipelineEvaluation,
}

#[derive(Serialize)]
struct PopulationSimulationRun {
    model_path: String,
    model_hash_hex: String,
    elapsed_milliseconds: u128,
    avatars_per_second: u128,
    #[serde(flatten)]
    population: SyntheticPopulationReport,
}

#[derive(Serialize)]
struct PromotionGateChecks {
    distinct_artifact: bool,
    learnable_signal_present: bool,
    mean_regret_non_regressing: bool,
    zero_regret_non_regressing: bool,
    clue_policy_non_regressing: bool,
    adapter_non_regressing: bool,
}

#[derive(Serialize)]
struct PromotionGateReport {
    schema_version: u32,
    rows: usize,
    worlds: usize,
    incumbent_model_hash: u64,
    challenger_model_hash: u64,
    checks: PromotionGateChecks,
    data_profile: CardPolicyDatasetProfile,
    eligible_for_promotion: bool,
    incumbent: cosyworld_orchestrator::card_policy::CardPolicyMetrics,
    challenger: cosyworld_orchestrator::card_policy::CardPolicyMetrics,
}

#[derive(Serialize)]
struct ShadowExportSummary {
    schema_version: u32,
    journal: String,
    output: String,
    dataset: Option<String>,
    after_seq: u64,
    exported: usize,
    labeled: usize,
    first_seq: Option<u64>,
    last_seq: Option<u64>,
    label_status: String,
    training_eligible: bool,
}

#[derive(Serialize)]
struct RealDatasetPreparationSummary {
    schema_version: u32,
    input_shards: usize,
    rows: usize,
    worlds: usize,
    train_rows: usize,
    train_worlds: usize,
    calibration_rows: usize,
    calibration_worlds: usize,
    eval_rows: usize,
    eval_worlds: usize,
    profile: CardPolicyDatasetProfile,
    seed: u64,
    output_dir: String,
}

#[derive(Serialize)]
struct CardPolicyDatasetProfile {
    strict_preference_rows: usize,
    all_candidate_features_identical_rows: usize,
    learnable_strict_rows: usize,
    conflicting_feature_groups: usize,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn counterfactual_shadow_label_becomes_a_training_row() {
        let features = vec![vec![0_i16; CARD_POLICY_FEATURES]; 2];
        let planning = json!({"actor_id": 1003});
        let policy = json!({
            "deck_candidate_ids": ["offer:a", "offer:b"],
            "hand_candidate_ids": ["offer:b", "offer:a"],
            "candidate_features_q15": features,
            "branch_label": {
                "schema_version": 1,
                "objective_id": "objective:export",
                "objective_turn": 7,
                "evaluator": "treasure_branch_distance_v1",
                "child_losses": [5, 2]
            }
        });
        let row = shadow_training_row(91, &planning, &policy)
            .unwrap()
            .expect("valid label is eligible");
        assert_eq!(row.sample_id, "real:objective:export:1003:91");
        assert_eq!(row.hand_candidate_indices, [Some(1), Some(0)]);
        assert_eq!(row.candidates[0].child_loss, 5);
        assert_eq!(row.target_index().unwrap(), 1);
        assert_eq!(row.world_seed, stable_episode_seed("objective:export"));
    }

    #[test]
    fn malformed_shadow_label_fails_closed() {
        let planning = json!({"actor_id": 1003});
        let policy = json!({
            "deck_candidate_ids": ["offer:a"],
            "hand_candidate_ids": ["offer:a", null],
            "candidate_features_q15": [[0, 1]],
            "branch_label": {
                "objective_id": "objective:bad",
                "child_losses": [1, 2]
            }
        });
        assert!(shadow_training_row(1, &planning, &policy)
            .unwrap()
            .is_none());
    }

    #[test]
    fn real_dataset_split_keeps_worlds_disjoint() {
        let rows = (0..20_u64)
            .flat_map(|world_seed| {
                (0..2).map(move |sample| CardPolicySample {
                    sample_id: format!("real:{world_seed}:{sample}"),
                    world_seed,
                    hand_candidate_indices: [Some(0), Some(1)],
                    candidates: vec![
                        CardPolicyCandidateSample {
                            features_q15: [0; CARD_POLICY_FEATURES],
                            child_loss: 0,
                        },
                        CardPolicyCandidateSample {
                            features_q15: [0; CARD_POLICY_FEATURES],
                            child_loss: 1,
                        },
                    ],
                })
            })
            .collect::<Vec<_>>();
        let (train, calibration, eval) = split_rows_by_world(&rows, 17).unwrap();
        assert_eq!(train.len(), 28);
        assert_eq!(calibration.len(), 6);
        assert_eq!(eval.len(), 6);
        reject_overlapping_worlds(&train, &calibration).unwrap();
        reject_overlapping_worlds(&train, &eval).unwrap();
        reject_overlapping_worlds(&calibration, &eval).unwrap();
    }

    #[test]
    fn dataset_profile_rejects_opposing_labels_with_identical_features() {
        let rows = (0..2_u16)
            .map(|target| CardPolicySample {
                sample_id: format!("real:conflict:{target}"),
                world_seed: u64::from(target),
                hand_candidate_indices: [Some(0), Some(1)],
                candidates: vec![
                    CardPolicyCandidateSample {
                        features_q15: [0; CARD_POLICY_FEATURES],
                        child_loss: if target == 0 { 1 } else { 2 },
                    },
                    CardPolicyCandidateSample {
                        features_q15: [0; CARD_POLICY_FEATURES],
                        child_loss: if target == 1 { 1 } else { 2 },
                    },
                ],
            })
            .collect::<Vec<_>>();
        let profile = profile_dataset(&rows).unwrap();
        assert_eq!(profile.strict_preference_rows, 2);
        assert_eq!(profile.all_candidate_features_identical_rows, 2);
        assert_eq!(profile.learnable_strict_rows, 0);
        assert_eq!(profile.conflicting_feature_groups, 1);
    }
}
