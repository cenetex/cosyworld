//! Pack opt-in for free-context voice prompts.
//!
//! A pack may declare `extensions["x-cosyworld-free-context"]` on its manifest
//! entry. Autonomous actors of that pack are then summoned with a first-person
//! surfacing monologue and a plain-prose block of world knowledge and memory.
//! The prompt carries no rules, word budgets, output cues, or safety text.
//! Length, safety, repetition, and grounding stay with the deterministic
//! publication gate, which judges these actors as raw speech.

use crate::content_load::{SeedContent, SeedWorldpackPack};

pub(crate) const FREE_CONTEXT_EXTENSION: &str = "x-cosyworld-free-context";

/// Words a free-context line may run to before the publication gate rejects it.
pub(crate) const FREE_CONTEXT_MAX_WORDS: usize = 120;
/// Completion ceiling for a free-context line. The gate, not the prompt, bounds length.
pub(crate) const FREE_CONTEXT_MAX_TOKENS: u32 = 320;
/// Sampling temperature when neither the pool nor the model's registry entry sets one.
pub(crate) const FREE_CONTEXT_DEFAULT_TEMPERATURE: f64 = 1.0;
/// How many remembered moments a free-context prompt carries.
pub(crate) const FREE_CONTEXT_RECOLLECTIONS: usize = 8;

pub(crate) fn parse_free_context(pack: &SeedWorldpackPack) -> Result<bool, String> {
    let Some(config) = pack.extensions.get(FREE_CONTEXT_EXTENSION) else {
        return Ok(false);
    };
    let invalid = |detail: &str| {
        format!(
            "pack {} has an invalid free-context declaration: {detail}",
            pack.id
        )
    };
    let config = config.as_object().ok_or_else(|| invalid("not an object"))?;
    for key in config.keys() {
        if !matches!(key.as_str(), "schema_version" | "mode") {
            return Err(invalid(&format!("unknown field {key}")));
        }
    }
    if config.get("schema_version").and_then(|v| v.as_u64()) != Some(1) {
        return Err(invalid("schema_version must be 1"));
    }
    if config.get("mode").and_then(|v| v.as_str()) != Some("free_context") {
        return Err(invalid("mode must be free_context"));
    }
    Ok(true)
}

fn enabled_for_actor_in(content: &SeedContent, actor_id: u64) -> bool {
    content
        .actors
        .iter()
        .find(|actor| actor.id == actor_id)
        .and_then(|actor| {
            content
                .manifest
                .packs
                .iter()
                .find(|pack| pack.id == actor.pack_id)
        })
        .is_some_and(|pack| parse_free_context(pack).ok().unwrap_or(false))
}

/// Whether the actor's pack summons its residents with a free-context prompt.
pub(crate) fn enabled_for_actor(actor_id: u64) -> bool {
    enabled_for_actor_in(crate::content_registry::active_content(), actor_id)
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
        pack.extensions = json!({ FREE_CONTEXT_EXTENSION: extension });
        pack
    }

    #[test]
    fn a_valid_declaration_opts_in() {
        let pack = pack_with(json!({"schema_version": 1, "mode": "free_context"}));
        assert_eq!(parse_free_context(&pack), Ok(true));
    }

    #[test]
    fn absent_extension_keeps_the_task_prompt() {
        let mut pack = pack_with(json!({}));
        pack.extensions = json!({});
        assert_eq!(parse_free_context(&pack), Ok(false));
    }

    #[test]
    fn malformed_declarations_fail_content_load() {
        for bad in [
            json!({"schema_version": 2, "mode": "free_context"}),
            json!({"schema_version": 1, "mode": "task"}),
            json!({"schema_version": 1}),
            json!({"schema_version": 1, "mode": "free_context", "budget": 10}),
            json!("free_context"),
        ] {
            assert!(
                parse_free_context(&pack_with(bad.clone())).is_err(),
                "{bad}"
            );
        }
    }
}
