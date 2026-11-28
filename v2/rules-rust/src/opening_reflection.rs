use serde_json::{json, Value};

const SCENE: &str = "Use the saved scene's character reflections.";
const EVIDENCE: &str = "Use a reflection grounded in the saved scene.";
const MAX_SAFE_INTEGER: u64 = (1 << 53) - 1;
const THOUGHT_GAP: u64 = 6;

fn refused(error: &str) -> Option<Value> {
    Some(json!({"ok": false, "error": error}))
}

fn count(value: &Value) -> Option<u64> {
    value.as_u64().filter(|count| *count <= MAX_SAFE_INTEGER)
}

fn valid_text(text: &str, limit: usize) -> bool {
    !text
        .trim_matches(|c: char| c == '\u{feff}' || (c.is_whitespace() && c != '\u{85}'))
        .is_empty()
        && text.encode_utf16().count() <= limit
        && !text.bytes().any(|b| b < 32 || b == 127)
}

fn text(value: &Value, limit: usize) -> Option<&str> {
    value.as_str().filter(|text| valid_text(text, limit))
}

fn waited_at<'a>(log: &'a [Value], actor: &str, turn: u64, long: bool) -> Option<&'a Value> {
    let direct = log.iter().rev().find(|entry| {
        entry["actorId"] == actor
            && entry["verb"] == "wait"
            && entry["turn"] == turn
            && (!long || entry["rest"] == "long")
    });
    if direct.is_some() || !long {
        return direct;
    }
    let waking = log.iter().rev().find(|entry| {
        entry["actorId"] == actor
            && entry.get("woke").is_some()
            && count(&entry["turn"]).is_some_and(|at| at <= turn)
    })?;
    let woke = count(&waking["turn"])?;
    (waking["rest"] == "long"
        && !log.iter().any(|entry| {
            entry["actorId"] == actor
                && entry["kind"] == "action"
                && entry["generated"] != true
                && entry.get("woke").is_none()
                && count(&entry["turn"]).is_some_and(|at| (woke..turn).contains(&at))
        }))
    .then_some(waking)
}

fn append_last(value: &Value, entry: Value) -> Option<Vec<Value>> {
    let mut tail = if value.is_null() {
        Vec::new()
    } else {
        let previous = value.as_array()?;
        previous[previous.len().saturating_sub(3)..].to_vec()
    };
    tail.push(entry);
    Some(tail)
}

fn last_turn(value: &Value) -> Option<u64> {
    count(&value.as_array()?.last()?["turn"])
}

fn opening_world(request: &Value) -> Option<&Value> {
    let world = &request["world"];
    let actors = world["actors"].as_object()?;
    let lamp = &world["items"]["lamp"];
    let vale = actors.get("vale")?;
    let present = request["present"].as_array()?;
    let claimed = request["claimed"].as_array()?;
    let settled_lamp = super::lamp_state(lamp).ok()?;
    let is_lit = vale["heldItem"] == "lamp" && settled_lamp.fuel_rooms > 0;
    if request["actor"] != "vale"
        || world["schema"] != 8
        || world["sharedVersion"] != 1
        || world["opening"]["crossed"] != false
        || !world["stationExitOrder"]
            .as_array()
            .is_some_and(Vec::is_empty)
        || !matches!(
            world["items"]["elysium-wayfinder"]["holder"].as_str(),
            Some("behind-station" | "pond")
        )
        || claimed.len() != 1
        || claimed[0] != "vale"
        || (!present.is_empty() && present.as_slice() != claimed)
        || vale["place"] != "attic"
        || !vale
            .get("heldItem")
            .is_some_and(|held| held == "lamp" || held.is_null())
        || lamp["holder"] != "vale"
        || settled_lamp.fuel_place != "attic"
        || (is_lit && !settled_lamp.fuel_visit)
        || lamp["lit"] != is_lit
        || lamp["fuel"] != settled_lamp.fuel_rooms * 4
    {
        return None;
    }
    Some(world)
}

pub(super) fn reduce(request: &Value) -> Option<Value> {
    let world = opening_world(request)?;
    let world_turn = count(&world["turn"])?;
    let Some(turn) = count(&request["turn"]).filter(|turn| (1..=world_turn).contains(turn)) else {
        return refused(SCENE);
    };
    let rest = &request["rest"];
    let long = rest == "long";
    let resting = &request["resting"];
    if (!rest.is_null() && !long)
        || (long && resting.is_null())
        || (!resting.is_null() && resting != "vale")
    {
        return refused(SCENE);
    }
    let wait = waited_at(world["log"].as_array()?, "vale", turn, long);
    if !resting.is_null() && wait.is_none() {
        return refused(SCENE);
    }
    let Some(entries) = request["entries"]
        .as_array()
        .filter(|entries| (1..=2).contains(&entries.len()))
    else {
        return refused(SCENE);
    };
    if entries.len() == 2 && entries[0]["id"] == entries[1]["id"] {
        return refused(SCENE);
    }
    if resting.is_null() || entries.iter().any(|entry| entry["id"] != "vale") {
        return refused(EVIDENCE);
    }
    let wait = wait?;
    let entry = &entries[0];
    let reflection = &entry["reflection"];
    let Some(fields) = reflection.as_object() else {
        return refused(EVIDENCE);
    };
    let Some(evidence) = reflection["evidence"].as_array().filter(|v| !v.is_empty()) else {
        return refused(EVIDENCE);
    };
    if fields
        .keys()
        .any(|key| !["thought", "persona", "dream", "models", "evidence"].contains(&key.as_str()))
        || (fields.contains_key("dream") && !(long && wait["dream"] == "glimpse"))
    {
        return refused(EVIDENCE);
    }
    let Some(thought) = text(&reflection["thought"], 400) else {
        return refused(EVIDENCE);
    };
    let persona = match fields.get("persona") {
        Some(Value::Null) => return None,
        Some(value) => match text(value, 600) {
            Some(persona) => persona,
            None => return refused(EVIDENCE),
        },
        None => return refused(EVIDENCE),
    };
    let dream = match fields.get("dream") {
        Some(value) => match text(value, 400) {
            Some(dream) => Some(dream),
            None => return refused(EVIDENCE),
        },
        None => None,
    };

    let memory = &world["memories"]["vale"];
    let events = memory["events"].as_array()?;
    let landmarks = memory["landmarks"].as_array()?;
    let life = &memory["innerLife"];
    let previous = last_turn(&life["thoughts"]);
    let mut sources = Vec::new();
    for seq in evidence {
        let saved = events.iter().chain(landmarks).find(|event| {
            event["seq"] == *seq && count(&event["turn"]).is_some_and(|at| at <= turn)
        });
        let Some(saved) = saved else {
            return refused(EVIDENCE);
        };
        if saved["kind"] != "event" || text(&saved["text"], 650).is_none() {
            return None;
        }
        sources.push(json!({"seq": count(seq)?, "turn": saved["turn"], "text": saved["text"]}));
    }
    if sources.len() > 6 || evidence.windows(2).any(|p| p[0] == p[1]) {
        return None;
    }
    if evidence.windows(2).any(|p| p[0].as_u64() > p[1].as_u64())
        || (!long
            && previous.is_some_and(|last| {
                turn < last + THOUGHT_GAP
                    || !sources
                        .iter()
                        .any(|source| source["turn"].as_u64() > Some(last))
            }))
    {
        return refused(EVIDENCE);
    }
    if long
        && (previous.is_some_and(|last| turn <= last)
            || (dream.is_some() && last_turn(&life["dreams"]).is_some_and(|last| turn <= last)))
    {
        return None;
    }

    let models = match fields.get("models") {
        Some(models) => {
            let models = models.as_object()?;
            text(models.get("thought")?, 160)?;
            text(models.get("persona")?, 160)?;
            if models.iter().any(|(key, value)| {
                !["thought", "persona", "dream"].contains(&key.as_str())
                    || text(value, 160).is_none()
            }) {
                return None;
            }
            json!(models)
        }
        None => {
            if !entry["model"].is_null() && !entry["model"].is_string() {
                return None;
            }
            let model = entry["model"]
                .as_str()
                .filter(|model| !model.is_empty())
                .unwrap_or("card-voices-v1");
            if !valid_text(model, 160) {
                return None;
            }
            let mut models = json!({"thought":model, "persona":model});
            if dream.is_some() {
                models["dream"] = json!(model);
            }
            models
        }
    };
    let reflections = append_last(
        &memory["reflections"],
        json!({
            "turn": turn, "previousPersona": life["persona"], "persona": persona,
            "thought": thought, "dream": dream, "sources": sources, "models": models,
        }),
    )?;
    let thoughts = append_last(&life["thoughts"], json!({"turn": turn, "text": thought}))?;
    let dreams = match dream {
        Some(dream) => append_last(&life["dreams"], json!({"turn": turn, "text": dream}))?,
        None => life["dreams"].as_array().cloned().unwrap_or_default(),
    };
    let revision = count(&world["revision"]).filter(|revision| *revision < MAX_SAFE_INTEGER)? + 1;
    let mut world = world.clone();
    let memory = world.pointer_mut("/memories/vale")?.as_object_mut()?;
    memory.insert(
        "innerLife".into(),
        json!({"persona":persona,"thoughts":thoughts,"dreams":dreams}),
    );
    memory.insert("reflections".into(), json!(reflections));
    world["revision"] = json!(revision);
    let world = world.as_object_mut()?;
    for field in [
        "playerActorId",
        "heldActors",
        "controlledActors",
        "presentActors",
    ] {
        world.remove(field);
    }
    Some(json!({"ok": true, "world": world}))
}
