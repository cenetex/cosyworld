//! Shared narration consumes the original card scene facts. It can describe
//! committed actions and write resident replies, while game outcomes stay in C.
use super::{full_world::actor_id, store::Result};
use crate::ai_gateway::ModelCapability;
use serde_json::{json, Value};
use std::collections::{BTreeMap, BTreeSet};

pub(super) fn prepared(actor: usize, work: &Value) -> Result<(Value, Vec<String>)> {
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
    // The scene's speakers speak as given, except other players' avatars:
    // their own players speak for them. A due place caption follows.
    let mut ids: Vec<String> = speakers
        .iter()
        .filter(|id| **id == actor_id(actor) || !roster.contains(*id))
        .map(|id| id.to_string())
        .collect();
    if scene["scenery"].as_bool().unwrap_or(true) && !ids.iter().any(|id| id == room) {
        ids.push(room.to_string());
    }
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
pub(super) fn parse(
    text: &str,
    finish: &str,
    work: &Value,
    actor: usize,
    ids: &[String],
) -> Result<Value> {
    let error = "The play is saved. Its words need another moment.";
    if finish != "stop" {
        return Err(error.into());
    }
    let parsed: Value = serde_json::from_str(text).map_err(|_| error.to_string())?;
    let entries = parsed["entries"].as_array().ok_or(error)?;
    if entries.len() > ids.len()
        || entries
            .iter()
            .map(|e| e["id"].as_str())
            .collect::<BTreeSet<_>>()
            .len()
            != entries.len()
        || entries.iter().any(|e| !ids.iter().any(|id| e["id"] == *id))
    {
        return Err(error.into());
    }
    let mut seen = BTreeSet::new();
    let mut lines = Vec::new();
    for id in ids {
        let Some(entry) = entries.iter().find(|e| e["id"] == *id) else {
            // A voiced acting avatar must speak. A reply may stay silent.
            if id != actor_id(actor) && work["profiles"][id]["kind"] == "avatar" {
                continue;
            }
            if work["context"].get("scenery").is_some()
                && work["profiles"][id]["kind"] == "location"
            {
                continue;
            }
            return Err(error.into());
        };
        if !seen.insert(id) {
            return Err(error.into());
        }
        let text = entry["text"].as_str().ok_or(error)?.trim();
        if text.is_empty() || text.chars().count() > 240 || text.chars().any(char::is_control) {
            return Err(error.into());
        }
        let profile = &work["profiles"][id];
        let name = profile["name"].as_str().ok_or(error)?;
        lines.push(json!({"reflection":entry["reflection"],"model":entry["model"],"speaker":name,"text":text,"entityId":id,"actorId":if profile["kind"]=="avatar"{Some(id)}else{None}}));
    }
    Ok(json!(lines))
}
/// Requested avatars with no published line. The scene record keeps them so
/// the table can show "…"; the journal speech op stays as it was.
pub(super) fn silent(work: &Value, actor: usize, lines: &Value) -> Vec<String> {
    let Ok((_, ids)) = prepared(actor, work) else {
        return Vec::new();
    };
    ids.into_iter()
        .filter(|id| id != actor_id(actor) && work["profiles"][id]["kind"] == "avatar")
        .filter(|id| {
            !lines
                .as_array()
                .is_some_and(|lines| lines.iter().any(|l| l["entityId"] == *id))
        })
        .collect()
}
pub(super) async fn generate(state: &crate::AppState, actor: usize, work: &Value) -> Result<Value> {
    let (payload, ids) = prepared(actor, work)?;
    // A silent play voices no one: it finishes with no lines and no model call.
    if ids.is_empty() {
        return Ok(json!([]));
    }
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
    let models: BTreeMap<String, String> = serde_json::from_value(models).unwrap_or_default();
    let value = crate::routes::card_game::narrative::shared_lines(
        &config,
        &payload["scene"],
        actor_id(actor),
        &ids,
        &models,
    )
    .await?;
    parse(&value.to_string(), "stop", work, actor, &ids)
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn shared_bard_can_comment_on_the_earned_poem() {
        let verse = "I told her I would turn away. Her brother waited by the wall.";
        let work = json!({"room":"greek-harbor","context":{
            "location":"greek-harbor","speakers":["vale","greek-rhapsode"],"scenery":false,
            "outcome":{"card":{"kind":"talk","target":"greek-rhapsode"}},
            "entities":[{"id":"greek-rhapsode","facts":[format!("Verse 1, Vale: {verse}")]}]
        },"profiles":{"vale":{"name":"Vale","kind":"avatar"},"greek-rhapsode":{"name":"The Bard","kind":"avatar"}}});
        let (payload, ids) = prepared(0, &work).unwrap();
        assert_eq!(payload["scene"], work["context"]);
        let response = |text: &str| {
            json!({"entries":[{"id":"vale","text":"I hear you."},{"id":"greek-rhapsode","text":text}]}).to_string()
        };
        assert!(parse(&response(verse), "stop", &work, 0, &ids).is_ok());
        assert!(parse(
            &response("The dark keeps every name the waves release."),
            "stop",
            &work,
            0,
            &ids
        )
        .is_ok());
    }
    #[test]
    fn resident_dialogue_and_human_authority_share_one_scene() {
        let mut work = json!({"room":"station","context":{"location":"station","speakers":["vale","pip","mara"],"scenery":false,"outcome":{"card":{"target":"pip"}}},"profiles":{"vale":{"name":"Vale","kind":"avatar"},"pip":{"name":"Pip","kind":"avatar"},"mara":{"name":"Mara","kind":"avatar"},"station":{"name":"Empty station","kind":"location"}}});
        // Mara's own player speaks for her.
        let (_, ids) = prepared(0, &work).unwrap();
        assert_eq!(ids, vec!["vale", "pip"]);
        let result=parse(r#"{"entries":[{"id":"vale","text":"What caught your eye?"},{"id":"pip","text":"That shine belongs in my collection."}]}"#,"stop",&work,0,&ids).unwrap();
        assert_eq!(result[1]["actorId"], "pip");
        assert!(silent(&work, 0, &result).is_empty());
        // A reply that does not come stays silent; the actor's line is required.
        let quiet = parse(
            r#"{"entries":[{"id":"vale","text":"What caught your eye?"}]}"#,
            "stop",
            &work,
            0,
            &ids,
        )
        .unwrap();
        assert_eq!(quiet.as_array().unwrap().len(), 1);
        assert_eq!(silent(&work, 0, &quiet), vec!["pip"]);
        assert!(parse(
            r#"{"entries":[{"id":"pip","text":"Mine."}]}"#,
            "stop",
            &work,
            0,
            &ids
        )
        .is_err());
        work["context"]["scenery"] = json!(true);
        assert_eq!(
            prepared(0, &work).unwrap().1,
            vec!["vale", "pip", "station"]
        );
    }
    #[test]
    fn shared_scenes_voice_only_their_given_speakers() {
        let mut work = json!({"room":"station","context":{"location":"station","speakers":["pip"],"scenery":false,"outcome":{"card":{"kind":"give","target":"pip","accepted":false}}},"profiles":{"vale":{"name":"Vale","kind":"avatar"},"pip":{"name":"Pip","kind":"avatar"},"station":{"name":"Empty station","kind":"location"}}});
        // A refusal voices the refuser alone; the actor stays quiet.
        let (_, ids) = prepared(0, &work).unwrap();
        assert_eq!(ids, vec!["pip"]);
        let refused = parse(
            r#"{"entries":[{"id":"pip","text":"Not that one."}]}"#,
            "stop",
            &work,
            0,
            &ids,
        )
        .unwrap();
        assert_eq!(refused[0]["entityId"], "pip");
        // A refuser whose words do not come leaves the scene with no lines.
        let none = parse(r#"{"entries":[]}"#, "stop", &work, 0, &ids).unwrap();
        assert_eq!(none, json!([]));
        assert_eq!(silent(&work, 0, &none), vec!["pip"]);
        // A silent play voices nobody.
        work["context"]["speakers"] = json!([]);
        assert!(prepared(0, &work).unwrap().1.is_empty());
        // A first arrival's place caption needs no speaker.
        work["context"]["scenery"] = json!(true);
        let (_, place) = prepared(0, &work).unwrap();
        assert_eq!(place, vec!["station"]);
        assert!(parse(
            r#"{"entries":[{"id":"station","text":"Dust settles."}]}"#,
            "stop",
            &work,
            0,
            &place
        )
        .is_ok());
    }
    #[test]
    fn quiet_shared_turns_keep_the_actor_and_legacy_exchanges() {
        let mut work = json!({"room":"station","context":{"location":"station","speakers":["vale"],"scenery":false,"outcome":{"card":{"target":null}}},"profiles":{"vale":{"name":"Vale","kind":"avatar"},"station":{"name":"Empty station","kind":"location"}}});
        let (_, ids) = prepared(0, &work).unwrap();
        assert_eq!(ids, vec!["vale"]);
        let response = r#"{"entries":[{"id":"vale","text":"I can wait here."}]}"#;
        assert_eq!(
            parse(response, "stop", &work, 0, &ids)
                .unwrap()
                .as_array()
                .unwrap()
                .len(),
            1
        );
        work["context"]["scenery"] = json!(true);
        let (_, scenic) = prepared(0, &work).unwrap();
        assert_eq!(scenic, vec!["vale", "station"]);
        assert!(parse(response, "stop", &work, 0, &scenic).is_ok());
        assert!(parse(
            r#"{"entries":[{"id":"station","text":"Dust settles."}]}"#,
            "stop",
            &work,
            0,
            &scenic
        )
        .is_err());
        assert!(parse(r#"{"entries":[{"id":"vale","text":"I can wait."},{"id":"vale","text":"I can wait."}]}"#, "stop", &work, 0, &scenic).is_err());
        work["context"].as_object_mut().unwrap().remove("scenery");
        assert_eq!(prepared(0, &work).unwrap().1, scenic);
        assert!(parse(response, "stop", &work, 0, &scenic).is_err());
    }
}
