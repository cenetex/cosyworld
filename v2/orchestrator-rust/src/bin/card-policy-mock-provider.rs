#![deny(unsafe_code)]

use std::env;
use std::net::SocketAddr;
use std::sync::atomic::{AtomicU64, Ordering};

use axum::{
    routing::{get, post},
    Json, Router,
};
use serde_json::{json, Value};

static RESPONSE_SEQUENCE: AtomicU64 = AtomicU64::new(0);

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let address: SocketAddr = env::var("COSYWORLD_CARD_POLICY_MOCK_ADDR")
        .unwrap_or_else(|_| "127.0.0.1:3114".to_string())
        .parse()?;
    let app = Router::new()
        .route("/health", get(|| async { Json(json!({ "ok": true })) }))
        .route("/chat/completions", post(chat_completion));
    let listener = tokio::net::TcpListener::bind(address).await?;
    println!("card-policy mock provider listening on http://{address}");
    axum::serve(listener, app).await?;
    Ok(())
}

async fn chat_completion(Json(body): Json<Value>) -> Json<Value> {
    let prompt = body
        .get("messages")
        .and_then(Value::as_array)
        .and_then(|messages| messages.last())
        .and_then(|message| message.get("content"))
        .and_then(Value::as_str)
        .unwrap_or_default();
    let sequence = RESPONSE_SEQUENCE.fetch_add(1, Ordering::Relaxed);
    let content = if body
        .pointer("/response_format/type")
        .and_then(Value::as_str)
        == Some("json_object")
    {
        deterministic_planner_response(prompt)
    } else {
        deterministic_voice_response(prompt, sequence)
    };
    Json(json!({
        "id": format!("card-policy-mock-{sequence}"),
        "model": "cosyworld/card-policy-mock",
        "choices": [{
            "index": 0,
            "finish_reason": "stop",
            "message": { "role": "assistant", "content": content }
        }],
        "usage": { "prompt_tokens": 1, "completion_tokens": 1, "total_tokens": 2 }
    }))
}

fn deterministic_voice_response(prompt: &str, sequence: u64) -> String {
    let speaker = prompt
        .lines()
        .find_map(|line| line.strip_prefix("current speech owner: "))
        .or_else(|| {
            prompt
                .lines()
                .find_map(|line| line.strip_prefix("SELF · "))
                .and_then(|line| line.split(" — ").next())
        })
        .unwrap_or_default();
    if speaker == "Gust" {
        return "☕🌧️🔥".to_string();
    }
    if speaker == "Skull" {
        return "*hearth watch continues*".to_string();
    }
    let counterpart = prompt
        .lines()
        .find_map(|line| line.strip_prefix("OTHER · "))
        .and_then(|line| line.split(" — ").next())
        .filter(|line| !line.trim().is_empty());
    if let Some(counterpart) = counterpart {
        let observations = [
            "one detail here has my attention",
            "something nearby seems worth noticing",
            "the room has given me a practical thought",
            "I want to look at what changed here",
            "there is a small detail I do not want to miss",
            "I am weighing what this place offers",
            "one quiet change here seems important",
            "I have a preference about what happens next",
        ];
        return format!(
            "{counterpart}, {}.",
            observations[(sequence as usize) % observations.len()]
        );
    }
    let location = prompt
        .lines()
        .find_map(|line| line.strip_prefix("where i am: "))
        .and_then(|line| line.split(" — ").next())
        .or_else(|| {
            prompt
                .split("\"location\":\"")
                .nth(1)
                .and_then(|tail| tail.split('"').next())
        })
        .filter(|line| !line.trim().is_empty())
        .unwrap_or("this room");
    let lines = [
        format!("I keep my attention on {location}."),
        format!("There is more to notice around {location}."),
        format!("I am still considering what {location} offers."),
        format!("One detail in {location} deserves a closer look."),
        format!("For now, {location} gives me enough to consider."),
        format!("I have not finished looking around {location}."),
        format!("Something practical in {location} has my attention."),
        format!("Let us stay with what is here in {location}."),
    ];
    lines[(sequence as usize) % lines.len()].clone()
}

fn deterministic_planner_response(prompt: &str) -> String {
    let state_revision = prompt
        .split("\"state_revision\":")
        .nth(1)
        .and_then(|tail| {
            let digits = tail
                .trim_start()
                .chars()
                .take_while(char::is_ascii_digit)
                .collect::<String>();
            digits.parse::<u64>().ok()
        })
        .unwrap_or_default();
    let candidate_id = prompt
        .split("\"candidate_id\":\"")
        .nth(1)
        .and_then(|tail| tail.split('"').next())
        .unwrap_or_default();
    json!({
        "candidate_id": candidate_id,
        "state_revision": state_revision,
        "speech_act": "inform",
        "reason": "deterministic local collection provider"
    })
    .to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn voice_response_anchors_itself_to_the_room() {
        let response =
            deterministic_voice_response("where i am: Rain-Soft Garden — Silver Leaves", 0);
        assert!(response.contains("Rain-Soft Garden"));
    }

    #[test]
    fn planner_response_echoes_candidate_and_revision() {
        let response =
            deterministic_planner_response(r#"[{"candidate_id":"offer:1","state_revision":42}]"#);
        let value: Value = serde_json::from_str(&response).unwrap();
        assert_eq!(value["candidate_id"], "offer:1");
        assert_eq!(value["state_revision"], 42);
    }

    #[test]
    fn specialized_resident_modes_receive_valid_shapes() {
        assert_eq!(
            deterministic_voice_response("current speech owner: Gust", 0),
            "☕🌧️🔥"
        );
        assert_eq!(
            deterministic_voice_response("current speech owner: Skull", 0),
            "*hearth watch continues*"
        );
    }

    #[test]
    fn current_context_spine_voice_names_the_grounded_counterpart() {
        let response = deterministic_voice_response(
            "SELF · Policy Collector — Careful Listener\nOTHER · Rati — Landlady\nOBSERVATION_JSON · {\"location\":\"The Cosy Cottage\"}",
            0,
        );
        assert_eq!(response, "Rati, one detail here has my attention.");
    }
}
