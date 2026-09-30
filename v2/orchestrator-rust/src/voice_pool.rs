//! Pack opt-in for keyed voice model pools.
//!
//! A pack may declare `extensions["x-cosyworld-voice-pool"]` on its manifest
//! entry. Autonomous actors of that pack with no explicit `actor_model_bindings`
//! row then speak through one model drawn from the operator's reviewed voice
//! pool, chosen by a stable hash of (world, salt, actor). The pack chooses only
//! the draw shape (tier weights, salt, sampling temperature); it cannot name a
//! model, so eligibility and data policy stay with the operator registry.

use crate::ai_gateway::ModelRarity;
use crate::content_load::{SeedContent, SeedWorldpackPack};
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

pub(crate) fn routing_key(world_id: &str, salt: &str, actor_id: u64) -> String {
    format!("{world_id}\0{salt}\0{actor_id}")
}

/// The pool policy and routing key for an actor, or `None` when its pack has
/// not opted in or an explicit model binding already decides its model.
pub(crate) fn draw_for(
    has_explicit_binding: bool,
    pack: Option<&SeedWorldpackPack>,
    world_id: &str,
    actor_id: u64,
) -> Option<(VoicePoolPolicy, String)> {
    if has_explicit_binding {
        return None;
    }
    let policy = parse_voice_pool(pack?).ok().flatten()?;
    let key = routing_key(world_id, &policy.salt, actor_id);
    Some((policy, key))
}

fn policy_for_actor_in(content: &SeedContent, actor_id: u64) -> Option<(VoicePoolPolicy, String)> {
    let has_binding = content
        .actor_model_bindings
        .iter()
        .any(|binding| binding.actor_id == actor_id);
    let pack = match content.actors.iter().find(|actor| actor.id == actor_id) {
        Some(actor) => content
            .manifest
            .packs
            .iter()
            .find(|pack| pack.id == actor.pack_id),
        // Player avatars are not authored content. They take the world's own
        // pool so one avatar keeps one model, rather than a model per line.
        None => content
            .manifest
            .packs
            .iter()
            .find(|pack| pack.extensions.get(VOICE_POOL_EXTENSION).is_some()),
    };
    draw_for(has_binding, pack, &content.manifest.id, actor_id)
}

pub(crate) fn policy_for_actor(actor_id: u64) -> Option<(VoicePoolPolicy, String)> {
    policy_for_actor_in(crate::content_registry::active_content(), actor_id)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn pack_with(extension: serde_json::Value) -> SeedWorldpackPack {
        let mut pack: SeedWorldpackPack = serde_json::from_value(json!({
            "id": "test.pack", "name": "t", "version": "1.0.0", "kind": "content",
            "license": "MIT", "license_url": "https://example.test",
            "integrity": "sha256:0",
            "provenance": {"author": "t", "source_name": "t", "source_url": "https://example.test"}
        }))
        .expect("test pack parses");
        pack.extensions = json!({ VOICE_POOL_EXTENSION: extension });
        pack
    }

    #[test]
    fn parses_a_valid_policy() {
        let pack = pack_with(json!({
            "schema_version": 1, "strategy": "keyed", "salt": "s1",
            "tier_weights": {"common": 4, "rare": 1}, "temperature": 1.0
        }));
        let policy = parse_voice_pool(&pack).unwrap().unwrap();
        assert_eq!(policy.salt, "s1");
        assert_eq!(policy.tier_weights[&ModelRarity::Common], 4);
        assert_eq!(policy.temperature, Some(1.0));
    }

    #[test]
    fn absent_extension_means_no_pool() {
        let mut pack = pack_with(json!({}));
        pack.extensions = json!({});
        assert_eq!(parse_voice_pool(&pack).unwrap(), None);
    }

    #[test]
    fn rejects_malformed_policies() {
        for bad in [
            json!({"schema_version": 2, "strategy": "keyed", "salt": "s"}),
            json!({"schema_version": 1, "strategy": "random", "salt": "s"}),
            json!({"schema_version": 1, "strategy": "keyed"}),
            json!({"schema_version": 1, "strategy": "keyed", "salt": "s", "model": "x/y"}),
            json!({"schema_version": 1, "strategy": "keyed", "salt": "s", "tier_weights": {"mythic": 1}}),
            json!({"schema_version": 1, "strategy": "keyed", "salt": "s", "temperature": 3.0}),
        ] {
            assert!(parse_voice_pool(&pack_with(bad.clone())).is_err(), "{bad}");
        }
    }

    #[test]
    fn explicit_binding_wins_and_unopted_packs_are_untouched() {
        let pack = pack_with(json!({"schema_version": 1, "strategy": "keyed", "salt": "s"}));
        assert!(
            draw_for(true, Some(&pack), "w", 1).is_none(),
            "binding wins"
        );
        assert!(draw_for(false, Some(&pack), "w", 1).is_some());
        let mut plain = pack_with(json!({}));
        plain.extensions = json!({});
        assert!(draw_for(false, Some(&plain), "w", 1).is_none(), "no opt-in");
        assert!(draw_for(false, None, "w", 1).is_none());
        let (_, first) = draw_for(false, Some(&pack), "w", 1).unwrap();
        let (_, again) = draw_for(false, Some(&pack), "w", 1).unwrap();
        assert_eq!(first, again);
    }

    #[test]
    fn shipped_official_content_has_no_pool() {
        let content = crate::content_registry::active_content();
        for actor in &content.actors {
            assert!(
                policy_for_actor_in(content, actor.id).is_none(),
                "{}",
                actor.id
            );
        }
    }

    #[test]
    fn routing_key_is_stable_and_actor_specific() {
        assert_eq!(routing_key("w", "s", 7), routing_key("w", "s", 7));
        assert_ne!(routing_key("w", "s", 7), routing_key("w", "s", 8));
        assert_ne!(routing_key("w", "s", 7), routing_key("w", "t", 7));
    }
}
