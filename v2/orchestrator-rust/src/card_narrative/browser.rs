//! Prompts and checks for player-funded calls made directly by the browser.
use super::*;

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct Answer {
    id: String,
    part: String,
    text: String,
    finish: String,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub(super) struct Completed {
    context: Context,
    answers: Vec<Answer>,
}
fn parts(context: &Context, id: &str, shared: bool) -> Vec<(&'static str, Part)> {
    let mut parts = vec![("line", Part::Line)];
    let (reflect, dream) = reflection_due(context, entity(context, id));
    if reflect && !shared {
        parts.extend([("thought", Part::Thought), ("persona", Part::Persona)]);
        if dream {
            parts.push(("dream", Part::Dream));
        }
    }
    parts
}
fn context(scene: &Value, ids: Option<&[String]>) -> Result<(Context, Vec<String>), String> {
    let mut context: Context = serde_json::from_value(scene.clone())
        .map_err(|_| "Use the current scene and its saved memories.")?;
    let selected = if let Some(ids) = ids {
        if ids.is_empty()
            || ids.len() > 8
            || !observations::valid(&context)
            || ids
                .iter()
                .any(|id| !context.entities.iter().any(|e| &e.id == id))
            || context
                .entities
                .iter()
                .any(|e| !recital::valid(&e.id, e.poem.as_ref(), context.turn))
        {
            return Err("The saved scene needs its requested voices.".into());
        }
        context.acting_avatar = ids.first().cloned();
        for entity in &mut context.entities {
            if Some(&entity.id) != ids.first() {
                entity.inner_life = None;
                entity.facts.retain(|f| !f.starts_with("I expected "));
            }
        }
        context.speakers = ids
            .iter()
            .filter(|id| kind(id, "avatar"))
            .cloned()
            .collect();
        ids.to_vec()
    } else {
        if !valid(&context) {
            return Err("Use the current scene and its saved memories.".into());
        }
        voiced(&context)
    };
    Ok((context, selected))
}
fn models() -> Result<BTreeMap<String, String>, String> {
    std::env::var("COSYWORLD_CARD_CHARACTER_MODELS_JSON")
        .ok()
        .map(|text| parse_character_models(&text))
        .unwrap_or_else(|| Ok(BTreeMap::new()))
}
fn model(models: &BTreeMap<String, String>, id: &str) -> String {
    models.get(id).cloned().unwrap_or_else(|| {
        std::env::var("COSYWORLD_CARD_TEXT_MODEL").unwrap_or_else(|_| "openrouter/free".into())
    })
}
pub(crate) fn prepare(
    scene: &Value,
    ids: Option<&[String]>,
    base: Option<&AiConfig>,
) -> Result<Value, String> {
    let (context, selected) = context(scene, ids)?;
    let models = models()?;
    let mut calls = Vec::new();
    for id in selected {
        for (label, part) in parts(&context, &id, ids.is_some()) {
            let model = model(&models, &id);
            let selection = base
                .map(|base| {
                    tier_config(base, Some(&model)).pin_model(ModelCapability::WorldContent)
                })
                .transpose()
                .map_err(|_| "The character needs its model settings.")?;
            let raw = selection
                .as_ref()
                .is_some_and(|s| s.uses_raw_prompt_adapter());
            let reasoning = selection
                .as_ref()
                .is_some_and(|s| s.candidate().supported_parameters().reasoning);
            let mut request = json!({
                "model":model,
                "messages":[{"role":"system","content":idiolect(entity(&context, &id), part)},
                    {"role":"user","content":attempt_transcript(&context, entity(&context, &id), part, 0)}],
                "temperature":1.0,"max_tokens":if part==Part::Persona{160}else{96},
                "stream":false
            });
            if raw {
                request.as_object_mut().unwrap().remove("temperature");
                if reasoning {
                    request.as_object_mut().unwrap().remove("max_tokens");
                    request["reasoning"] = json!({"enabled":true});
                }
            } else if reasoning {
                request["reasoning"] = json!({"effort":"none"});
            }
            calls.push(json!({"id":id,"part":label,"request":request}));
        }
    }
    Ok(json!({"calls":calls}))
}
pub(crate) fn complete(
    scene: &Value,
    ids: Option<&[String]>,
    answers: Vec<Answer>,
) -> Result<Value, String> {
    let (context, selected) = context(scene, ids)?;
    if answers.len() > 32
        || answers
            .iter()
            .any(|a| a.text.len() > 8192 || a.finish.len() > 32)
    {
        return Err("Your character's words need another try.".into());
    }
    let models = models()?;
    let settings = voice_settings()
        .as_ref()
        .map_err(|_| "The story service needs its voice settings.")?;
    let mut entries = Vec::new();
    for id in &selected {
        let entity = entity(&context, id);
        let mut cleaned = BTreeMap::new();
        for (label, part) in parts(&context, id, ids.is_some()) {
            let mut matched = answers.iter().filter(|a| &a.id == id && a.part == label);
            let Some(answer) = matched.next() else {
                continue;
            };
            if matched.next().is_some() {
                return Err("Use one reply for each voice.".into());
            }
            let mut check = Check::new(&context, entity, part);
            if part == Part::Line {
                check.limit = if ids.is_some() {
                    240
                } else {
                    settings.line_limit
                };
                if kind(id, "location") {
                    check.limit = check.limit.min(180);
                    check.sentences = 1;
                }
            }
            if let Ok(text) = check.clean(
                &answer.text,
                matches!(answer.finish.as_str(), "stop" | "end_turn"),
            ) {
                cleaned.insert(part, text);
            }
        }
        if let Some(text) = cleaned.remove(&Part::Line) {
            let reflection = match (
                cleaned.remove(&Part::Thought),
                cleaned.remove(&Part::Persona),
            ) {
                (Some(thought), Some(persona)) => Some(Reflection {
                    thought,
                    persona,
                    dream: cleaned.remove(&Part::Dream),
                    models: [
                        ("thought".into(), model(&models, id)),
                        ("persona".into(), model(&models, id)),
                    ]
                    .into(),
                    evidence: entity
                        .memories
                        .iter()
                        .filter(|m| m.kind == "event")
                        .filter_map(|m| m.seq)
                        .collect(),
                }),
                _ => None,
            };
            entries.push(Entry {
                id: id.clone(),
                text,
                model: Some(model(&models, id)),
                reflection,
            });
        }
    }
    let needed = if context.speakers.is_empty() {
        &selected
    } else {
        &context.speakers
    };
    if (ids.is_some() && needed.iter().any(|id| !entries.iter().any(|e| &e.id == id)))
        || !entries.iter().any(|e| needed.contains(&e.id))
    {
        return Err("Your character's words need another try.".into());
    }
    let omitted: Vec<_> = context
        .entities
        .iter()
        .filter(|e| !entries.iter().any(|v| v.id == e.id))
        .map(|e| &e.id)
        .collect();
    Ok(
        json!({"revision":context.revision,"entries":entries,"omitted":omitted,"model":"card-voices-v1"}),
    )
}
pub(super) async fn prepare_route(
    State(state): State<TextState>,
    ConnectInfo(peer): ConnectInfo<SocketAddr>,
    headers: HeaderMap,
    Json(context): Json<Context>,
) -> Response {
    if !same_origin(&headers) {
        return error(StatusCode::FORBIDDEN, "Open the card game on this site.");
    }
    if !state
        .limits
        .lock()
        .is_ok_and(|mut limits| admit(&mut limits, peer.ip(), Instant::now()))
    {
        return error(
            StatusCode::TOO_MANY_REQUESTS,
            "The story service is taking a short break.",
        );
    }
    match prepare(
        &serde_json::to_value(context).unwrap_or(Value::Null),
        None,
        state.ai.as_ref().as_ref(),
    ) {
        Ok(value) => ([("cache-control", "no-store")], Json(value)).into_response(),
        Err(message) => error(StatusCode::BAD_REQUEST, &message),
    }
}
pub(super) async fn complete_route(headers: HeaderMap, Json(body): Json<Completed>) -> Response {
    if !same_origin(&headers) {
        return error(StatusCode::FORBIDDEN, "Open the card game on this site.");
    }
    match complete(
        &serde_json::to_value(body.context).unwrap_or(Value::Null),
        None,
        body.answers,
    ) {
        Ok(value) => ([("cache-control", "no-store")], Json(value)).into_response(),
        Err(message) => error(StatusCode::BAD_GATEWAY, &message),
    }
}
