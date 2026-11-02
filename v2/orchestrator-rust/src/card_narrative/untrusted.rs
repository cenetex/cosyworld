//! A browser-held scene is untrusted input. Ids and enums are checked
//! against the mounted packs (`valid`). Words the server wrote earlier
//! (dialogue lines, thoughts, personas, dreams) come back with the signed
//! envelope the server issued for them, and are accepted only when it
//! verifies (`routes::signed_envelope`). Rules-built sentences (the action,
//! events, facts and event memories) reach a prompt only when they are made
//! of authored text (`authored`); any other sentence is left out. Shared
//! scenes are built on the server from its own journal and skip this.
use super::*;
use crate::routes::signed_envelope::{content_hash, keys, Claims, Verdict};

/// Local play has no server-side world id; shared journal rows would carry it.
const LOCAL_WORLD: &str = "local";

enum Check {
    Keep,
    Drop,
    Reject,
}

fn check(envelope: Option<&Envelope>, kind: &str, entity: &str, text: &str) -> Check {
    let Some(envelope) = envelope else {
        return Check::Reject;
    };
    match keys().verify(envelope) {
        // Another machine's or a retired key: the words stay out of the prompt.
        Verdict::UnknownKey => Check::Drop,
        Verdict::Invalid => Check::Reject,
        Verdict::Valid => {
            let c = &envelope.claims;
            if c.kind == kind
                && c.entity == entity
                && c.world == LOCAL_WORLD
                && c.content == content_hash(text)
            {
                Check::Keep
            } else {
                Check::Reject
            }
        }
    }
}

/// An expression memory is `Name: line`, the speaker's pack name and a
/// signed line.
fn check_expression(memory: &Memory) -> Check {
    let Some(envelope) = memory.signed.as_ref() else {
        return Check::Reject;
    };
    let entity = &envelope.claims.entity;
    let prefix = format!("{}: ", name(entity));
    match memory.text.strip_prefix(&prefix) {
        Some(line) if profiles().get(entity).is_some() => {
            check(Some(envelope), "line", entity, line)
        }
        _ => Check::Reject,
    }
}

/// Keep `value` when `check` keeps it; `None` rejects the whole request.
fn keep<T>(value: T, check: Check) -> Option<Option<T>> {
    match check {
        Check::Keep => Some(Some(value)),
        Check::Drop => Some(None),
        Check::Reject => None,
    }
}

/// The scene with every server-written string verified, unverifiable ones
/// (unknown key) dropped, or `None` when any is unsigned or tampered.
pub(super) fn trusted(mut context: Context) -> Option<Context> {
    let mut dropped = 0;
    let mut keep_authored = |text: &String, limit: usize| {
        let ok = super::authored::authored(text, limit);
        dropped += usize::from(!ok);
        ok
    };
    context.action = context.action.filter(|text| keep_authored(text, 650));
    context.events.retain(|text| keep_authored(text, 650));
    context
        .disclosures
        .retain(|fact| keep_authored(&fact.text, 180));
    for entity in &mut context.entities {
        entity.facts.retain(|text| keep_authored(text, 240));
        entity
            .memories
            .retain(|m| m.kind != "event" || keep_authored(&m.text, 650));
        if let Some(poem) = &entity.poem {
            if !poem
                .stanzas
                .iter()
                .all(|s| super::authored::name(&s.author_name))
            {
                return None;
            }
        }
    }
    if dropped > 0 {
        tracing::warn!(
            feature = "card_text",
            dropped,
            "left unauthored scene text out of the prompt"
        );
    }
    let mut conversation = Vec::new();
    for line in std::mem::take(&mut context.conversation) {
        let verdict = check(line.signed.as_ref(), "line", &line.actor_id, &line.text);
        conversation.extend(keep(line, verdict)?);
    }
    context.conversation = conversation;
    for entity in &mut context.entities {
        let id = entity.id.clone();
        if let Some(previous) = entity.previous.take() {
            let verdict = check(entity.previous_signed.as_ref(), "line", &id, &previous);
            entity.previous = keep(previous, verdict)?;
        }
        entity.previous_signed = None;
        let mut memories = Vec::new();
        for memory in std::mem::take(&mut entity.memories) {
            if memory.kind == "expression" {
                let verdict = check_expression(&memory);
                memories.extend(keep(memory, verdict)?);
            } else if memory.signed.is_none() {
                memories.push(memory);
            } else {
                return None;
            }
        }
        entity.memories = memories;
        // The browser never sends a hope; shared scenes build theirs.
        if entity.hope.is_some() {
            return None;
        }
        if let Some(life) = entity.inner_life.as_mut() {
            if let Some(persona) = life.persona.take() {
                let verdict = check(life.persona_signed.as_ref(), "persona", &id, &persona);
                life.persona = keep(persona, verdict)?;
            }
            life.persona_signed = None;
            for (kind, moments) in [("thought", &mut life.thoughts), ("dream", &mut life.dreams)] {
                let mut kept = Vec::new();
                for moment in std::mem::take(moments) {
                    let turn_matches = moment
                        .signed
                        .as_ref()
                        .is_none_or(|e| e.claims.turn == moment.turn);
                    let verdict = check(moment.signed.as_ref(), kind, &id, &moment.text);
                    if !turn_matches {
                        return None;
                    }
                    kept.extend(keep(moment, verdict)?);
                }
                *moments = kept;
            }
        }
    }
    Some(context)
}

fn claims(context: &Context, kind: &str, entity: &str, text: &str) -> Claims {
    Claims {
        content: content_hash(text),
        entity: entity.into(),
        iat: std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map_or(0, |d| d.as_secs()),
        kind: kind.into(),
        kid: String::new(),
        rules: concat!("cosyworld-orchestrator/", env!("CARGO_PKG_VERSION")).into(),
        seq: context.revision,
        turn: context.turn,
        world: LOCAL_WORLD.into(),
    }
}

/// Sign each line of a local scene's reply (`entries[].signed`).
pub(super) fn sign_lines(value: &mut Value, context: &Context) {
    for entry in value["entries"].as_array_mut().into_iter().flatten() {
        if let (Some(id), Some(text)) = (entry["id"].as_str(), entry["text"].as_str()) {
            let envelope = keys().sign(claims(context, "line", id, text));
            entry["signed"] = json!(envelope);
        }
    }
}

/// Sign each private reflection part (`reflections[].signed.{thought,…}`).
pub(super) fn sign_reflections(value: &mut Value, context: &Context) {
    for entry in value["reflections"].as_array_mut().into_iter().flatten() {
        let Some(id) = entry["id"].as_str().map(str::to_string) else {
            continue;
        };
        let mut signed = serde_json::Map::new();
        for kind in ["thought", "persona", "dream"] {
            if let Some(text) = entry["reflection"][kind].as_str() {
                let envelope = keys().sign(claims(context, kind, &id, text));
                signed.insert(kind.into(), json!(envelope));
            }
        }
        entry["signed"] = Value::Object(signed);
    }
}

/// A copy of `context` with every server-written string signed, as the
/// browser sends it back. The fixture's hand-written sentences count as
/// authored.
#[cfg(test)]
pub(super) fn signed(context: &Context) -> Context {
    let mut c: Context = serde_json::from_value(json!(context)).expect("context");
    let allow = super::authored::allow_fixture;
    c.action.iter().chain(&c.events).for_each(|t| allow(t));
    for e in &c.entities {
        e.facts.iter().for_each(|t| allow(t));
        e.memories
            .iter()
            .filter(|m| m.kind == "event")
            .for_each(|m| allow(&m.text));
    }
    c.disclosures.iter().for_each(|d| allow(&d.text));
    let sign = |kind: &str, id: &str, text: &str, turn: u64| {
        let mut claims = claims(context, kind, id, text);
        claims.turn = turn;
        Some(keys().sign(claims))
    };
    for line in &mut c.conversation {
        line.signed = sign("line", &line.actor_id, &line.text, c.turn);
    }
    for e in &mut c.entities {
        if let Some(previous) = &e.previous {
            e.previous_signed = sign("line", &e.id, previous, c.turn);
        }
        for m in e.memories.iter_mut().filter(|m| m.kind == "expression") {
            let (id, line) = profiles()
                .as_object()
                .expect("profiles")
                .iter()
                .find_map(|(id, p)| {
                    let name = p["name"].as_str()?;
                    Some((
                        id.clone(),
                        m.text.strip_prefix(&format!("{name}: "))?.to_string(),
                    ))
                })
                .expect("expression speaker");
            m.signed = sign("line", &id, &line, m.turn);
        }
        if let Some(life) = e.inner_life.as_mut() {
            if let Some(persona) = &life.persona {
                life.persona_signed = sign("persona", &e.id, persona, c.turn);
            }
            for (kind, moments) in [("thought", &mut life.thoughts), ("dream", &mut life.dreams)] {
                for m in moments.iter_mut() {
                    m.signed = sign(kind, &e.id, &m.text, m.turn);
                }
            }
        }
    }
    c
}

#[cfg(test)]
#[path = "untrusted_tests.rs"]
mod tests;
