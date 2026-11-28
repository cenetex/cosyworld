use serde_json::Value;

const MODELS: [&str; 6] = [
    "elysium-claude",
    "elysium-gemini",
    "elysium-chatgpt",
    "elysium-grok",
    "elysium-deepseek",
    "elysium-qwen",
];

pub(super) fn model_waiting(world: &Value, id: &str) -> bool {
    MODELS.contains(&id) && world["elysiumEncounters"][id]["portraitReady"] != true
}

pub(super) fn import_preserves_state(world: &Value) -> Option<bool> {
    let history = world["log"].as_array()?;
    Some(
        world.get("elysiumEncounters").is_none()
            && history.iter().all(|event| {
                ["elysiumArrival", "elysiumModel", "portraitModel"]
                    .into_iter()
                    .all(|field| event.get(field).is_none())
                    && event.get("elysiumName").is_none_or(Value::is_null)
            })
            && MODELS.into_iter().all(|model| {
                let token = format!("{model}-token");
                world["items"].get(&token).is_none_or(|item| {
                    item["holder"] == model && world["actors"][model]["want"]["target"] != token
                })
            }),
    )
}
