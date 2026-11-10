//! Decision-model client (OpenRouter Decisions API) and its pack opt-in.
//!
//! A decision model answers typed questions with probabilities instead of
//! prose. It fits the places where the engine only needs a judgment: whether a
//! resident speaks now, and whether a candidate line repeats an idea the room
//! already heard. Probabilities steer a seeded draw, so a world stays lively
//! without a language model deciding every beat.
//!
//! With an operator model set, every world uses decisions unless one of its
//! packs declares a policy that turns them off.
//!
//! Authority is unchanged. A decision proposes; the publication gate, the
//! kernel, and the journal still decide what happens. Every call fails open to
//! the existing path: a missing model, a transport error, or an unreadable
//! answer returns `None` and the caller keeps its previous behaviour.

use crate::content_load::SeedWorldpackPack;
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::{collections::BTreeMap, time::Duration};

pub(crate) const DECISIONS_EXTENSION: &str = "x-cosyworld-decisions";
const DEFAULT_REPEAT_THRESHOLD: f64 = 0.8;

#[derive(Clone, Copy, Debug, PartialEq)]
pub(crate) struct DecisionPolicy {
    /// Decide whether a resident speaks with a decision model.
    pub(crate) chat_floor: bool,
    /// Probability above which a candidate line counts as a repeat, when the
    /// repeat judge is on.
    pub(crate) repeat_threshold: Option<f64>,
}

impl DecisionPolicy {}

pub(crate) fn parse_decision_policy(
    pack: &SeedWorldpackPack,
) -> Result<Option<DecisionPolicy>, String> {
    let Some(config) = pack.extensions.get(DECISIONS_EXTENSION) else {
        return Ok(None);
    };
    let invalid =
        |detail: &str| format!("pack {} has an invalid decisions policy: {detail}", pack.id);
    let config = config.as_object().ok_or_else(|| invalid("not an object"))?;
    for key in config.keys() {
        if !matches!(
            key.as_str(),
            "schema_version" | "chat_floor" | "repeat_judge" | "repeat_threshold"
        ) {
            return Err(invalid(&format!("unknown field {key}")));
        }
    }
    if config.get("schema_version").and_then(Value::as_u64) != Some(1) {
        return Err(invalid("schema_version must be 1"));
    }
    let flag = |name: &str| -> Result<bool, String> {
        match config.get(name) {
            None => Ok(false),
            Some(value) => value
                .as_bool()
                .ok_or_else(|| invalid(&format!("{name} must be a boolean"))),
        }
    };
    let chat_floor = flag("chat_floor")?;
    let repeat_judge = flag("repeat_judge")?;
    let threshold = match config.get("repeat_threshold") {
        None => DEFAULT_REPEAT_THRESHOLD,
        Some(value) => value
            .as_f64()
            .filter(|value| value.is_finite() && (0.5..=0.99).contains(value))
            .ok_or_else(|| invalid("repeat_threshold must be between 0.5 and 0.99"))?,
    };
    Ok(Some(DecisionPolicy {
        chat_floor,
        repeat_threshold: repeat_judge.then_some(threshold),
    }))
}

#[allow(dead_code)] // Choice backs resident intent next; Noul serves the chat floor and repeat judge
#[derive(Clone, Debug, PartialEq)]
pub(crate) enum DecisionQuestion {
    /// A yes/no question; the answer is the probability of yes.
    Noul {
        instructions: String,
        yes: String,
        no: String,
    },
    /// A closed choice; the answer carries a probability per option.
    Choice {
        instructions: String,
        options: Vec<(String, String)>,
    },
}

impl DecisionQuestion {}

#[allow(dead_code)]
#[derive(Clone, Debug, PartialEq)]
pub(crate) enum DecisionAnswer {
    Noul(f64),
    Choice {
        choice: String,
        probabilities: BTreeMap<String, f64>,
    },
}

#[allow(dead_code)]
#[derive(Clone, Debug)]
pub(crate) struct DecisionResult {
    pub(crate) answers: BTreeMap<String, DecisionAnswer>,
    pub(crate) resolved_model: String,
    pub(crate) input_tokens: u64,
    pub(crate) cost_usd: Option<f64>,
    pub(crate) latency: Duration,
}

/// A stable draw in `[0, 1)` from a seed, so the same beat always draws the
/// same number. The probabilities may vary from call to call; the draw does not.
pub(crate) fn unit_draw(seed: &str) -> f64 {
    let digest = Sha256::digest(seed.as_bytes());
    let value = u64::from_be_bytes(digest[..8].try_into().expect("eight bytes"));
    (value >> 11) as f64 / (1u64 << 53) as f64
}

/// Sample one option by its probabilities. The provider's own choice is the
/// fallback when it sent no usable probabilities.
#[allow(dead_code)] // used by the resident-intent decision, which builds on this client
pub(crate) fn sample_choice(
    choice: &str,
    probabilities: &BTreeMap<String, f64>,
    seed: &str,
) -> String {
    let total: f64 = probabilities.values().sum();
    if total <= 0.0 {
        return choice.to_string();
    }
    let mut point = unit_draw(seed) * total;
    for (key, probability) in probabilities {
        if point < *probability {
            return key.clone();
        }
        point -= probability;
    }
    choice.to_string()
}
