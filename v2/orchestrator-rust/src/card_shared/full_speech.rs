//! Shared narration consumes the original card scene facts. It can describe
//! committed actions and write resident replies, while game outcomes stay in C.
use super::{full_world::actor_id, store::Result};
use crate::ai_gateway::ModelCapability;
use serde_json::{json, Value};
use std::collections::{BTreeMap, BTreeSet};

fn prepared(actor: usize, work: &Value) -> Result<(Value, Vec<String>)> {
    let scene = &work["context"];
    if !scene.is_object() {
        return Err("The play is saved. Its scene needs another moment.".into());
    }
    let roster: BTreeSet<&str> = (0..8).map(actor_id).collect();
    let room = scene["location"]
        .as_str()
        .or_else(|| work["room"].as_str())
        .ok_or("The scene needs a place.")?;
    let speakers: Vec<&str> = scene["speakers"]
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(Value::as_str)
        .collect();
    let target = scene["outcome"]["card"]["target"].as_str();
    let reply = target
        .filter(|id| speakers.contains(id) && !roster.contains(id))
        .unwrap_or(room);
    let ids = vec![actor_id(actor).to_string(), reply.to_string()];
    let profiles = work["profiles"]
        .as_object()
        .ok_or("The scene needs its character profiles.")?;
    let selected: serde_json::Map<String, Value> = profiles
        .iter()
        .filter(|(id, _)| ids.contains(id))
        .map(|(k, v)| (k.clone(), v.clone()))
        .collect();
    if ids.iter().any(|id| !selected.contains_key(id)) {
        return Err("The scene needs its character profiles.".into());
    }
    Ok((
        json!({"requested_ids":ids,"acting_avatar":actor_id(actor),"profiles":selected,"scene":scene}),
        ids,
    ))
}
fn parse(text: &str, finish: &str, work: &Value, ids: &[String]) -> Result<Value> {
    let error = "The play is saved. Its words need another moment.";
    if finish != "stop" {
        return Err(error.into());
    }
    let parsed: Value = serde_json::from_str(text).map_err(|_| error.to_string())?;
    let entries = parsed["entries"].as_array().ok_or(error)?;
    if entries.len() != ids.len() {
        return Err(error.into());
    }
    let mut seen = BTreeSet::new();
    let mut lines = Vec::new();
    for id in ids {
        let entry = entries.iter().find(|e| e["id"] == *id).ok_or(error)?;
        if !seen.insert(id) {
            return Err(error.into());
        }
        let text = entry["text"].as_str().ok_or(error)?.trim();
        if text.is_empty() || text.chars().count() > 240 || text.chars().any(char::is_control) {
            return Err(error.into());
        }
        let profile = &work["profiles"][id];
        let name = profile["name"].as_str().ok_or(error)?;
        lines.push(json!({"speaker":name,"text":text,"entityId":id,"actorId":if profile["kind"]=="avatar"{Some(id)}else{None}}));
    }
    Ok(json!(lines))
}
pub(super) async fn generate(state: &crate::AppState, actor: usize, work: &Value) -> Result<Value> {
    let mut config = state
        .ai_config
        .as_ref()
        .clone()
        .ok_or("The play is saved. The story service is warming up.")?;
    let models: Value = std::env::var("COSYWORLD_CARD_CHARACTER_MODELS_JSON")
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or(Value::Null);
    if let Some(model) = std::env::var("COSYWORLD_CARD_TEXT_MODEL")
        .ok()
        .filter(|m| !m.trim().is_empty())
    {
        config
            .capability_models
            .insert(ModelCapability::WorldContent, model);
    }
    config.reasoning_effort = std::env::var("COSYWORLD_CARD_TEXT_REASONING_EFFORT")
        .ok()
        .or(config.reasoning_effort);
    let (payload, ids) = prepared(actor, work)?;
    let models: BTreeMap<String, String> = serde_json::from_value(models).unwrap_or_default();
    let value = crate::routes::card_game::narrative::shared_lines(
        &config,
        &payload["scene"],
        &ids,
        &models,
    )
    .await?;
    parse(&value.to_string(), "stop", work, &ids)
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn resident_dialogue_and_human_authority_share_one_scene() {
        let mut work = json!({"room":"station","context":{"location":"station","speakers":["vale","pip","mara"],"outcome":{"card":{"target":"pip"}}},"profiles":{"vale":{"name":"Vale","kind":"avatar"},"pip":{"name":"Pip","kind":"avatar"},"mara":{"name":"Mara","kind":"avatar"},"station":{"name":"Empty station","kind":"location"}}});
        let (_, ids) = prepared(0, &work).unwrap();
        assert_eq!(ids, vec!["vale", "pip"]);
        let result=parse(r#"{"entries":[{"id":"vale","text":"What caught your eye?"},{"id":"pip","text":"That shine belongs in my collection."}]}"#,"stop",&work,&ids).unwrap();
        assert_eq!(result[1]["actorId"], "pip");
        work["context"]["outcome"]["card"]["target"] = Value::Null;
        assert_eq!(prepared(0, &work).unwrap().1, vec!["vale", "station"]);
    }
}
