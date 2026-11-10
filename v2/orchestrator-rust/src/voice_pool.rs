//! Pack opt-in for keyed voice model pools.
//!
//! A pack may declare `extensions["x-cosyworld-voice-pool"]` on its manifest
//! entry. Autonomous actors of that pack with no explicit `actor_model_bindings`
//! row then speak through one model drawn from the operator's reviewed voice
//! pool, chosen by a stable hash of (world, salt, actor). The pack chooses only
//! the draw shape (tier weights, salt, sampling temperature); it cannot name a
//! model, so eligibility and data policy stay with the operator registry.

use crate::ai_gateway::ModelRarity;
use crate::content_load::SeedWorldpackPack;
use std::collections::BTreeMap;

pub(crate) const VOICE_POOL_EXTENSION: &str = "x-cosyworld-voice-pool";

#[derive(Clone, Debug, PartialEq)]
pub(crate) struct VoicePoolPolicy {
    pub(crate) salt: String,
    pub(crate) tier_weights: BTreeMap<ModelRarity, u32>,
    pub(crate) temperature: Option<f64>,
}

pub(crate) fn parse_voice_pool(
    pack: &SeedWorldpackPack,
) -> Result<Option<VoicePoolPolicy>, String> {
    let Some(config) = pack.extensions.get(VOICE_POOL_EXTENSION) else {
        return Ok(None);
    };
    let invalid = |detail: &str| format!("pack {} has an invalid voice pool: {detail}", pack.id);
    let config = config.as_object().ok_or_else(|| invalid("not an object"))?;
    for key in config.keys() {
        if !matches!(
            key.as_str(),
            "schema_version" | "strategy" | "salt" | "tier_weights" | "temperature"
        ) {
            return Err(invalid(&format!("unknown field {key}")));
        }
    }
    if config.get("schema_version").and_then(|v| v.as_u64()) != Some(1) {
        return Err(invalid("schema_version must be 1"));
    }
    if config.get("strategy").and_then(|v| v.as_str()) != Some("keyed") {
        return Err(invalid("strategy must be keyed"));
    }
    let salt = config
        .get("salt")
        .and_then(|v| v.as_str())
        .map(str::trim)
        .filter(|v| !v.is_empty() && v.len() <= 64 && !v.contains('\0'))
        .ok_or_else(|| invalid("salt must be 1-64 characters"))?
        .to_string();
    let mut tier_weights = BTreeMap::new();
    if let Some(weights) = config.get("tier_weights") {
        let weights = weights
            .as_object()
            .ok_or_else(|| invalid("tier_weights must be an object"))?;
        for (name, weight) in weights {
            let tier =
                ModelRarity::parse(name).ok_or_else(|| invalid(&format!("unknown tier {name}")))?;
            let weight = weight
                .as_u64()
                .filter(|weight| *weight <= 1_000)
                .ok_or_else(|| invalid("tier weights must be integers from 0 to 1000"))?;
            tier_weights.insert(tier, weight as u32);
        }
    }
    let temperature = match config.get("temperature") {
        None => None,
        Some(value) => Some(
            value
                .as_f64()
                .filter(|value| value.is_finite() && (0.0..=2.0).contains(value))
                .ok_or_else(|| invalid("temperature must be between 0 and 2"))?,
        ),
    };
    Ok(Some(VoicePoolPolicy {
        salt,
        tier_weights,
        temperature,
    }))
}
