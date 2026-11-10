//! Pack opt-in for free-context voice prompts.
//!
//! A pack may declare `extensions["x-cosyworld-free-context"]` on its manifest
//! entry. Autonomous actors of that pack are then summoned with a first-person
//! surfacing monologue and a plain-prose block of world knowledge and memory.
//! The prompt carries no rules, word budgets, output cues, or safety text.
//! Length, safety, repetition, and grounding stay with the deterministic
//! publication gate, which judges these actors as raw speech.

use crate::content_load::SeedWorldpackPack;

pub(crate) const FREE_CONTEXT_EXTENSION: &str = "x-cosyworld-free-context";

pub(crate) fn parse_free_context(pack: &SeedWorldpackPack) -> Result<bool, String> {
    parse_free_context_config(pack).map(|config| config.is_some())
}

/// The short first-person lines a pack offers to player-controlled avatars.
/// They are system-owned, so player text never reaches the system role.
fn parse_free_context_config(pack: &SeedWorldpackPack) -> Result<Option<Vec<String>>, String> {
    let Some(config) = pack.extensions.get(FREE_CONTEXT_EXTENSION) else {
        return Ok(None);
    };
    let invalid = |detail: &str| {
        format!(
            "pack {} has an invalid free-context declaration: {detail}",
            pack.id
        )
    };
    let config = config.as_object().ok_or_else(|| invalid("not an object"))?;
    for key in config.keys() {
        if !matches!(
            key.as_str(),
            "schema_version" | "mode" | "traveler_personas"
        ) {
            return Err(invalid(&format!("unknown field {key}")));
        }
    }
    if config.get("schema_version").and_then(|v| v.as_u64()) != Some(1) {
        return Err(invalid("schema_version must be 1"));
    }
    if config.get("mode").and_then(|v| v.as_str()) != Some("free_context") {
        return Err(invalid("mode must be free_context"));
    }
    let mut personas = Vec::new();
    if let Some(list) = config.get("traveler_personas") {
        let list = list
            .as_array()
            .filter(|list| list.len() <= 16)
            .ok_or_else(|| invalid("traveler_personas must be an array of at most 16 lines"))?;
        for line in list {
            let line = line
                .as_str()
                .map(str::trim)
                .filter(|line| !line.is_empty() && line.chars().count() <= 200)
                .ok_or_else(|| invalid("each traveler persona must be 1-200 characters"))?;
            personas.push(line.to_string());
        }
    }
    Ok(Some(personas))
}
