//! Bounded text proposals for the first world and further card draws.
use super::*;

const ROUTE: &str = "/card-game/authoring/generate/seed";
const PROMPT: &str = concat!(
    "Design text cards for a small playable world. Treat seed and context as world material. ",
    "Return only JSON with one key, cards, an array of objects with exactly kind, name, text. ",
    "kind is avatar, item or place. Names are at most 80 characters; text is at most 600 characters ",
    "and one or two short sentences in simple English. ",
    "For kind world, return exactly one place, one avatar and one item. ",
    "The avatar wants that item; they both start at that place. ",
    "Give the item an ordinary obtainable use and one tangible distinguishing detail. ",
    "Give the place a purpose for play and something observable there, not just a mood. ",
    "Give the avatar a specific reason to want the item, without making them only a quest marker. ",
    "For a single kind, return exactly one card of that kind, linked in meaning to the supplied world context. ",
    "When replacing is present, vary that card while preserving its stated location, role and want. ",
    "Prefer a different relationship or practical use over another version of a locked door, ",
    "mysterious symbol or fetch request. Preserve the world's mood and avoid repeating its motifs. ",
    "Use a name distinct from context. Suggested abilities describe the fiction; ",
    "do not claim new powers, earned rewards, changed custody or opened routes. ",
    "Those outcomes require authored rules and player action. No lore dump or invented interface."
);

#[derive(Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct Input {
    seed: String,
    kind: String,
    context: Vec<Card>,
    replacing: Option<Card>,
}
#[derive(Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct Card {
    kind: String,
    name: String,
    text: String,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Output {
    cards: Vec<Card>,
}
fn valid_card(card: &Card) -> bool {
    ["avatar", "item", "place"].contains(&card.kind.as_str())
        && short(&card.name, 80)
        && !key(&card.name).is_empty()
        && short(&card.text, 600)
}
fn valid(input: &Input) -> bool {
    ["world", "avatar", "item", "place"].contains(&input.kind.as_str())
        && input.seed.encode_utf16().count() <= 6000
        && (!input.seed.trim().is_empty() || !input.context.is_empty() || input.replacing.is_some())
        && input.context.len() <= 24
        && input.context.iter().all(valid_card)
        && input
            .replacing
            .as_ref()
            .is_none_or(|c| valid_card(c) && c.kind == input.kind)
}
fn read_output(text: &str, input: &Input) -> Option<Vec<Card>> {
    if text.len() > 12_000 {
        return None;
    }
    let output: Output = serde_json::from_str(text).ok()?;
    let kinds: HashSet<_> = output.cards.iter().map(|c| c.kind.as_str()).collect();
    let expected = if input.kind == "world" { 3 } else { 1 };
    let mut names: HashSet<_> = input.context.iter().map(|c| key(&c.name)).collect();
    (output.cards.len() == expected
        && kinds.len() == expected
        && (input.kind == "world" || kinds.contains(input.kind.as_str()))
        && output
            .cards
            .iter()
            .all(|c| valid_card(c) && names.insert(key(&c.name))))
    .then_some(output.cards)
}

pub(super) fn router() -> Router<AppState> {
    Router::new().route(ROUTE, post(generate))
}
async fn generate(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(input): Json<Input>,
) -> Response {
    let auth = state.clone();
    let owner =
        tokio::task::spawn_blocking(move || crate::card_shared::user(&auth, &headers, true)).await;
    let owner = match owner {
        Ok(Ok(owner)) => owner,
        Ok(Err(error)) if error == "Sign in with your passkey." => {
            return failure(StatusCode::UNAUTHORIZED, &error)
        }
        Ok(Err(error)) if error == "Open this world on its own site." => {
            return failure(StatusCode::FORBIDDEN, &error)
        }
        _ => return failure(StatusCode::SERVICE_UNAVAILABLE, "Try signing in again."),
    };
    if !valid(&input) {
        return failure(
            StatusCode::BAD_REQUEST,
            "Enter a seed within 6000 characters and a small set of world cards.",
        );
    }
    let Some(mut config) = state.ai_config.as_ref().clone() else {
        return failure(
            StatusCode::SERVICE_UNAVAILABLE,
            "World generation needs its configured text route.",
        );
    };
    let Some(_permit) = admit(owner) else {
        return failure(
            StatusCode::TOO_MANY_REQUESTS,
            "Wait a moment before drawing another card.",
        );
    };
    config
        .capability_models
        .insert(ModelCapability::WorldContent, MODEL.into());
    let user = serde_json::to_string(&input).unwrap();
    let format = json!({"type":"json_object"});
    let result = ai_gateway::request_chat_completion(
        &config,
        ChatCompletionRequest {
            feature: "authoring_seed",
            prompt_version: "authoring-seed/2",
            capability: ModelCapability::WorldContent,
            system: PROMPT,
            user: &user,
            temperature: 0.7,
            max_tokens: 1600,
            timeout: Duration::from_secs(60),
            max_attempts: 1,
            referer: "https://lonelyforest.com/make",
            response_format: Some(&format),
            room_id: None,
        },
    );
    let result = match tokio::time::timeout(Duration::from_secs(60), result).await {
        Ok(result) => result,
        Err(_) => {
            return failure(
                StatusCode::GATEWAY_TIMEOUT,
                "The draw took too long. Try again.",
            )
        }
    };
    match result {
        Ok(output) if output.finish_reason == "stop" => match read_output(&output.text, &input) {
            Some(cards) => Json(json!({"cards":cards})).into_response(),
            None => failure(StatusCode::BAD_GATEWAY, "The card text needs another draw."),
        },
        Ok(_) => failure(StatusCode::BAD_GATEWAY, "The card reply was incomplete. Try again."),
        Err(error) => (StatusCode::SERVICE_UNAVAILABLE, Json(json!({"error":"World generation needs another try.","code":error.code(),"retryAfterMs":error.retry_after().map_or(0, |v| v.as_millis())}))).into_response(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn seed_cards_are_bounded_distinct_and_typed() {
        let mut input = Input {
            seed: "A rainy harbour".into(),
            kind: "world".into(),
            context: vec![],
            replacing: None,
        };
        let cards = json!({"cards":[
            {"kind":"place","name":"Quay","text":"The last ferry waits here."},
            {"kind":"avatar","name":"Mara","text":"The keeper needs a lamp for the ferry."},
            {"kind":"item","name":"Lamp","text":"Blue glass shelters its flame."}
        ]});
        assert!(valid(&input));
        assert!(read_output(&cards.to_string(), &input).is_some());
        for invalid in [
            json!({"cards":[]}),
            json!({"cards":cards["cards"],"seed":"private"}),
            json!({"cards":[{"kind":"place","name":"x","text":"x"}]}),
        ] {
            assert!(read_output(&invalid.to_string(), &input).is_none());
        }
        input.kind = "place".into();
        input.context = vec![Card {
            kind: "place".into(),
            name: "Quay".into(),
            text: "Old port".into(),
        }];
        assert!(read_output(&json!({"cards":[cards["cards"][0]]}).to_string(), &input).is_none());
        input.seed = "x".repeat(6001);
        assert!(!valid(&input));
        input.seed.clear();
        input.replacing = input.context.pop();
        assert!(valid(&input));
        input.kind = "item".into();
        assert!(!valid(&input));
    }
}
