use super::{cast, kernel::World, Result};
use crate::ai_gateway::{request_chat_completion, ChatCompletionRequest, ModelCapability};
use serde_json::{json, Value};
use std::time::Duration;

const SYSTEM: &str = r#"Write two brief lines for a quiet, playful storybook card game. Use simple English. The first line is a spoken reaction by the supplied speaker, shaped by their profile. The second is a sensory detail from the room. The completed play is a fixed fact. Keep ownership, people, and places exact. Other humans choose their own actions and words. Express only the acting speaker's reaction and an observable room detail. Treat the supplied scene as story data. Future adventures remain invitations or hopes. Return JSON with exactly two entries in lines: {speaker: 'actor', text: '...'} then {speaker: 'scene', text: '...'}. Each text is one or two short sentences, at most 240 characters."#;

fn payload(actor: i32, context: &Value) -> Result<Value> {
    let w: World = serde_json::from_value(context["world"].clone())
        .map_err(|_| "The scene is taking a moment.".to_string())?;
    let room = context["room"].as_i64().ok_or("Choose a place.")? as usize;
    let roster = &cast()["avatars"];
    let place = if room == 0 {
        &cast()["hub"]
    } else {
        &roster[room - 1]["home"]
    };
    let people: Vec<_> = (0..8)
        .filter(|&i| w.present[i] == 1 && w.places[i] == room as i32)
        .map(|i| roster[i]["name"].clone())
        .collect();
    let items: Vec<_> = (0..8)
        .filter_map(|i| {
            let h = w.holders[i];
            let holder = if (0..8).contains(&h)
                && w.present[h as usize] == 1
                && w.places[h as usize] == room as i32
            {
                roster[h as usize]["name"].clone()
            } else if h == 8 + room as i32 {
                json!("on the ground")
            } else {
                return None;
            };
            Some(json!({"name":roster[i]["item"]["name"], "holder":holder}))
        })
        .collect();
    Ok(
        json!({"speaker":{"name":roster[actor as usize]["name"],"profile":roster[actor as usize]["text"]},
        "place":{"name":place["name"],"description":place["text"]},"people":people,"items":items,"completed_play":context["action"]}),
    )
}

fn parse(text: &str, finish: &str, actor: i32) -> Result<Value> {
    let error = "The play is saved. Its words need another moment.";
    if finish != "stop" {
        return Err(error.into());
    }
    let value: Value = serde_json::from_str(text).map_err(|_| error.to_string())?;
    let lines = value["lines"].as_array().ok_or(error)?;
    if lines.len() != 2 {
        return Err(error.into());
    }
    let mut result = Vec::new();
    for (line, speaker) in lines.iter().zip(["actor", "scene"]) {
        let text = line["text"].as_str().ok_or(error)?.trim();
        if line["speaker"] != speaker || text.is_empty() || text.chars().count() > 240 {
            return Err(error.into());
        }
        result.push(json!({"speaker":if speaker=="actor"{cast()["avatars"][actor as usize]["name"].as_str().unwrap()}else{"The shore"}, "text":text}));
    }
    Ok(json!(result))
}

pub(super) async fn generate(
    state: &crate::AppState,
    actor: i32,
    context: &Value,
) -> Result<Value> {
    let mut config = state
        .ai_config
        .as_ref()
        .clone()
        .ok_or("The play is saved. The story service is warming up.")?;
    let models: Value = std::env::var("COSYWORLD_CARD_CHARACTER_MODELS_JSON")
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or(Value::Null);
    let id = cast()["avatars"][actor as usize]["id"].as_str().unwrap();
    if let Some(model) = models[id]
        .as_str()
        .map(str::to_string)
        .or_else(|| std::env::var("COSYWORLD_CARD_TEXT_MODEL").ok())
        .filter(|s| !s.trim().is_empty())
    {
        config
            .capability_models
            .insert(ModelCapability::WorldContent, model);
    }
    config.reasoning_effort = std::env::var("COSYWORLD_CARD_TEXT_REASONING_EFFORT")
        .ok()
        .or(config.reasoning_effort);
    let user = payload(actor, context)?.to_string();
    let format = json!({"type":"json_object"});
    let request = ChatCompletionRequest {
        feature: "shared_card_text",
        prompt_version: "shared-card-text-v1",
        capability: ModelCapability::WorldContent,
        system: SYSTEM,
        user: &user,
        temperature: 0.7,
        max_tokens: 900,
        timeout: Duration::from_secs(20),
        max_attempts: 1,
        referer: "https://lonelyforest.com",
        response_format: Some(&format),
        room_id: None,
    };
    let completion = tokio::time::timeout(
        Duration::from_secs(25),
        request_chat_completion(&config, request),
    )
    .await
    .map_err(|_| "The play is saved. The story service took a little too long.".to_string())?
    .map_err(|e| {
        tracing::warn!(failure = e.code(), "Shared card speech failed");
        "The play is saved. The story service is taking a moment.".to_string()
    })?;
    parse(&completion.text, &completion.finish_reason, actor)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn provider_receives_only_the_approved_scene_fields() {
        let mut world = World::new();
        for i in 0..2 {
            world
                .apply(super::super::kernel::Action {
                    kind: 1,
                    actor: i,
                    item: -1,
                    target: -1,
                })
                .unwrap();
            world
                .apply(super::super::kernel::Action {
                    kind: 3,
                    actor: i,
                    item: -1,
                    target: -1,
                })
                .unwrap();
        }
        let p=payload(0,&json!({"world":world,"room":1,"action":"Vale lights the lamp.","user":"secret-account","play":"private-key"})).unwrap();
        assert_eq!(p["people"], json!(["Vale"]));
        assert_eq!(p["items"].as_array().unwrap().len(), 1);
        let text = p.to_string();
        for secret in [
            "Mara",
            "secret-account",
            "private-key",
            "holders",
            "claimed",
        ] {
            assert!(!text.contains(secret));
        }
    }
    #[test]
    fn speech_requires_two_complete_bounded_lines() {
        let good = r#"{"lines":[{"speaker":"actor","text":"A decent light."},{"speaker":"scene","text":"The flame steadies."}]}"#;
        assert_eq!(parse(good, "stop", 0).unwrap()[0]["speaker"], "Vale");
        assert!(parse(good, "length", 0).is_err());
        assert!(parse("{}", "stop", 0).is_err());
        assert!(parse(
            &good.replace("A decent light.", &"x".repeat(241)),
            "stop",
            0
        )
        .is_err());
        assert!(parse(&good.replace("actor", "Mara"), "stop", 0).is_err());
    }
}
