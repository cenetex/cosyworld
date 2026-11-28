//! A browser-held scene is untrusted input. Ids and enums are checked
//! against the mounted packs (`valid`). Words the server wrote earlier
//! (dialogue lines, thoughts, personas, dreams) come back with the signed
//! envelope the server issued for them, and are accepted only when it
//! verifies (`routes::signed_envelope`) for this speaker, kind and scene
//! (`Scene`). Rules-built sentences (the action, events, facts, event
//! memories and disclosures) reach a prompt only when they are made of their
//! field's authored text (`authored`); any other sentence is left out, and a
//! request that quotes more text or needs more matching work than an honest
//! scene is refused. Shared scenes are built on the server from its own
//! journal and skip this.
use super::authored::{authored, Budget, Field, REQUEST_CHARS};
use super::*;
use crate::routes::signed_envelope::{content_hash, keys, Claims, Verdict};

pub(super) const SCENE_ERROR: &str = "Use the current scene and its saved memories.";

#[derive(Debug, PartialEq, Eq)]
pub(super) enum ScreeningFailure {
    TextSize,
    MatchingLimit,
    SavedWords,
    SceneMetadata,
    Worker,
}

impl ScreeningFailure {
    fn label(&self) -> &'static str {
        match self {
            Self::TextSize => "scene_text_size",
            Self::MatchingLimit => "scene_matching_limit",
            Self::SavedWords => "scene_saved_words",
            Self::SceneMetadata => "scene_metadata",
            Self::Worker => "scene_worker",
        }
    }

    pub(super) fn response(self) -> Response {
        voice_scenes::refused(self.label());
        if self == Self::Worker {
            return error(
                StatusCode::SERVICE_UNAVAILABLE,
                "The story service is restarting.",
            );
        }
        (
            StatusCode::BAD_REQUEST,
            [("cache-control", "no-store")],
            Json(json!({"error": SCENE_ERROR, "code": "scene_context_rejected"})),
        )
            .into_response()
    }
}

pub(super) async fn screened(context: Context) -> Result<Context, ScreeningFailure> {
    tokio::task::spawn_blocking(move || trusted(context))
        .await
        .map_err(|_| ScreeningFailure::Worker)?
}

/// Local play has no server-side world id; shared journal rows would carry it.
const LOCAL_WORLD: &str = "local";
/// The build family that signs local words.
pub(super) const ISSUER: &str = "cosyworld-orchestrator/";
pub(super) const ELYSIUM_LINE_RULES_SUFFIX: &str = "/elysium-v1";
/// Clock skew allowed between machines that share a key.
const SKEW_SECS: u64 = 300;

enum Check {
    Keep,
    Drop,
    Reject,
}

/// What a remembered word must fit: it was written no later than this
/// scene's turn and revision, and not in the future.
struct Scene {
    turn: u64,
    revision: u64,
    now: u64,
}

impl Scene {
    fn of(context: &Context) -> Self {
        Self {
            turn: context.turn,
            revision: context.revision,
            now: unix_now(),
        }
    }
}

fn unix_now() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_or(0, |d| d.as_secs())
}

/// Verify a remembered word. A forged, altered or moved envelope rejects the
/// request. A genuine one from a later turn or revision than this scene (an
/// envelope kept from another save, or replayed into an earlier one), or
/// signed by an unlisted key, is dropped: the word stays out of the prompt.
fn check(
    envelope: Option<&Envelope>,
    scene: &Scene,
    kind: &str,
    entity: &str,
    text: &str,
) -> Check {
    let Some(envelope) = envelope else {
        return Check::Reject;
    };
    match keys().verify(envelope) {
        // Another machine's or a retired key: the words stay out of the prompt.
        Verdict::UnknownKey => Check::Drop,
        Verdict::Invalid => Check::Reject,
        Verdict::Valid => {
            let c = &envelope.claims;
            if !(c.kind == kind
                && c.entity == entity
                && c.world == LOCAL_WORLD
                && c.rules.starts_with(ISSUER)
                && c.content == content_hash(text))
            {
                Check::Reject
            } else if c.turn > scene.turn || c.seq > scene.revision || c.iat > scene.now + SKEW_SECS
            {
                Check::Drop
            } else {
                Check::Keep
            }
        }
    }
}

/// An expression memory is `Name: line`, the speaker's pack name and a
/// signed line, remembered no earlier than it was spoken.
fn check_expression(memory: &Memory, scene: &Scene) -> Check {
    let Some(envelope) = memory.signed.as_ref() else {
        return Check::Reject;
    };
    let entity = &envelope.claims.entity;
    let prefix = format!("{}: ", name(entity));
    match memory.text.strip_prefix(&prefix) {
        Some(line) if profiles().get(entity).is_some() => {
            match check(Some(envelope), scene, "line", entity, line) {
                Check::Keep if envelope.claims.turn > memory.turn => Check::Drop,
                verdict => verdict,
            }
        }
        _ => Check::Reject,
    }
}

fn keep<T>(value: T, check: Check) -> Result<Option<T>, ScreeningFailure> {
    match check {
        Check::Keep => Ok(Some(value)),
        Check::Drop => Ok(None),
        Check::Reject => Err(ScreeningFailure::SavedWords),
    }
}

/// The scene's rules-built sentences.
fn rules_text(context: &Context) -> impl Iterator<Item = &str> {
    let entities = context.entities.iter();
    context
        .action
        .iter()
        .chain(&context.events)
        .map(String::as_str)
        .chain(context.disclosures.iter().map(|d| d.text.as_str()))
        .chain(entities.flat_map(|e| {
            e.facts
                .iter()
                .chain(e.between.iter().flat_map(|b| &b.facts))
                .map(String::as_str)
                .chain(
                    e.memories
                        .iter()
                        .filter(|m| m.kind == "event")
                        .map(|m| m.text.as_str()),
                )
        }))
}

fn keep_authored(mut context: Context) -> Result<Context, ScreeningFailure> {
    if rules_text(&context).map(str::len).sum::<usize>() > REQUEST_CHARS {
        return Err(ScreeningFailure::TextSize);
    }
    let mut budget = Budget::new();
    let mut dropped = 0;
    let mut exceeded = false;
    let mut keep =
        |text: &String, limit: usize, field: Field| match authored(text, limit, field, &mut budget)
        {
            Ok(true) => true,
            Ok(false) => {
                dropped += 1;
                false
            }
            Err(_) => {
                exceeded = true;
                false
            }
        };
    context.action = context.action.filter(|text| keep(text, 650, Field::Action));
    let kept: Vec<bool> = context
        .events
        .iter()
        .map(|text| keep(text, 650, Field::Events))
        .collect();
    let mut flags = kept.iter();
    context.events.retain(|_| *flags.next().unwrap_or(&false));
    for entity in &mut context.entities {
        if let Some(p) = &mut entity.perception {
            super::perception::reindex(p, &kept);
        }
    }
    context
        .disclosures
        .retain(|fact| keep(&fact.text, 180, Field::Disclosures));
    for entity in &mut context.entities {
        entity.facts.retain(|text| keep(text, 240, Field::Facts));
        // "Between us" quotes the same fact templates (between-us.mjs).
        for between in &mut entity.between {
            between.facts.retain(|text| keep(text, 240, Field::Facts));
        }
        entity
            .memories
            .retain(|m| m.kind != "event" || keep(&m.text, 650, Field::Memories));
    }
    if exceeded {
        tracing::warn!(
            feature = "card_text",
            "refused a scene that needs more text matching than an honest one"
        );
        return Err(ScreeningFailure::MatchingLimit);
    }
    if dropped > 0 {
        tracing::warn!(
            feature = "card_text",
            dropped,
            "left unauthored scene text out of the prompt"
        );
    }
    Ok(context)
}

pub(super) fn trusted(context: Context) -> Result<Context, ScreeningFailure> {
    for entity in &context.entities {
        if entity
            .poem
            .as_ref()
            .is_some_and(|poem| !recital::known_authors(poem))
        {
            return Err(ScreeningFailure::SceneMetadata);
        }
    }
    let mut context = keep_authored(context)?;
    let scene = Scene::of(&context);
    let mut conversation = Vec::new();
    for line in std::mem::take(&mut context.conversation) {
        let verdict = check(
            line.signed.as_ref(),
            &scene,
            "line",
            &line.actor_id,
            &line.text,
        );
        if let Some(mut line) = keep(line, verdict)? {
            verify_elysium_name(&mut line, &scene, &context).ok_or(ScreeningFailure::SavedWords)?;
            conversation.push(line);
        }
    }
    context.conversation = conversation;
    for entity in &mut context.entities {
        let id = entity.id.clone();
        if let Some(previous) = entity.previous.take() {
            let verdict = check(
                entity.previous_signed.as_ref(),
                &scene,
                "line",
                &id,
                &previous,
            );
            entity.previous = keep(previous, verdict)?;
        }
        entity.previous_signed = None;
        let mut memories = Vec::new();
        for memory in std::mem::take(&mut entity.memories) {
            if memory.kind == "expression" {
                let verdict = check_expression(&memory, &scene);
                memories.extend(keep(memory, verdict)?);
            } else if memory.signed.is_none() {
                memories.push(memory);
            } else {
                return Err(ScreeningFailure::SavedWords);
            }
        }
        entity.memories = memories;
        // "Between us" words are signed lines; the envelope names who said
        // them and when, so neither can be moved.
        for between in &mut entity.between {
            let mut said = Vec::new();
            for line in std::mem::take(&mut between.said) {
                let verdict = match check(
                    line.signed.as_ref(),
                    &scene,
                    "line",
                    &line.actor_id,
                    &line.text,
                ) {
                    Check::Keep
                        if line
                            .signed
                            .as_ref()
                            .is_some_and(|e| e.claims.turn != line.turn) =>
                    {
                        Check::Drop
                    }
                    verdict => verdict,
                };
                said.extend(keep(line, verdict)?);
            }
            between.said = said;
        }
        // The browser never sends a hope; shared scenes build theirs.
        if entity.hope.is_some() {
            return Err(ScreeningFailure::SceneMetadata);
        }
        if let Some(life) = entity.inner_life.as_mut() {
            if let Some(persona) = life.persona.take() {
                let verdict = check(
                    life.persona_signed.as_ref(),
                    &scene,
                    "persona",
                    &id,
                    &persona,
                );
                life.persona = keep(persona, verdict)?;
            }
            life.persona_signed = None;
            for (kind, moments) in [("thought", &mut life.thoughts), ("dream", &mut life.dreams)] {
                let mut kept = Vec::new();
                for moment in std::mem::take(moments) {
                    let verdict =
                        match check(moment.signed.as_ref(), &scene, kind, &id, &moment.text) {
                            // The envelope names the turn the moment was had.
                            Check::Keep
                                if moment
                                    .signed
                                    .as_ref()
                                    .is_some_and(|e| e.claims.turn != moment.turn) =>
                            {
                                Check::Drop
                            }
                            verdict => verdict,
                        };
                    kept.extend(keep(moment, verdict)?);
                }
                *moments = kept;
            }
        }
    }
    Ok(context)
}

fn verify_elysium_name(line: &mut SpokenLine, scene: &Scene, context: &Context) -> Option<()> {
    let Some(Some(name)) = &line.elysium_name else {
        return line.elysium_name_signed.is_none().then_some(());
    };
    let proof = line.elysium_name_signed.as_ref()?;
    let words = line.signed.as_ref()?;
    if !super::elysium::is_resident(&line.actor_id)
        || !crate::card_shared::valid_elysium_name(name)
        || !words.claims.rules.ends_with(ELYSIUM_LINE_RULES_SUFFIX)
        || proof.claims.rules != words.claims.rules
        || proof.claims.seq != words.claims.seq
        || proof.claims.turn != words.claims.turn
    {
        return None;
    }
    let scope_is_current = !crate::card_shared::elysium_coordinate::is_resident(&line.actor_id)
        || super::elysium::coordinate_proof(context, &line.actor_id).is_some_and(|scope| {
            words
                .claims
                .rules
                .ends_with(&format!("{scope}{ELYSIUM_LINE_RULES_SUFFIX}"))
        });
    match check(Some(proof), scene, "elysium-name", &line.actor_id, name) {
        Check::Keep if scope_is_current => {}
        Check::Keep | Check::Drop => {
            line.elysium_name = Some(None);
            line.elysium_name_signed = None;
        }
        Check::Reject => return None,
    }
    Some(())
}

fn claims(context: &Context, kind: &str, entity: &str, text: &str) -> Claims {
    Claims {
        content: content_hash(text),
        entity: entity.into(),
        iat: unix_now(),
        kind: kind.into(),
        kid: String::new(),
        rules: format!("{ISSUER}{}", env!("CARGO_PKG_VERSION")),
        seq: context.revision,
        turn: context.turn,
        world: LOCAL_WORLD.into(),
    }
}

/// Sign each line of a local scene's reply (`entries[].signed`).
pub(super) fn sign_lines(value: &mut Value, context: &Context) {
    for entry in value["entries"].as_array_mut().into_iter().flatten() {
        if let (Some(id), Some(text)) = (entry["id"].as_str(), entry["text"].as_str()) {
            let mut words = claims(context, "line", id, text);
            let mut identity = None;
            if super::elysium::is_resident(id) {
                if let Some(scope) = super::elysium::coordinate_proof(context, id) {
                    words.rules.push_str(&scope);
                }
                words.rules.push_str(ELYSIUM_LINE_RULES_SUFFIX);
                if let Some(name) = entry["elysiumName"].as_str() {
                    let mut proof = claims(context, "elysium-name", id, name);
                    proof.rules.clone_from(&words.rules);
                    identity = Some(keys().sign(proof));
                }
            }
            entry["signed"] = json!(keys().sign(words));
            if let Some(identity) = identity {
                entry["elysiumNameSigned"] = json!(identity);
            }
        }
    }
}

/// A delivered line can be quoted even if the stream closes before completion.
pub(super) fn send_signed_delta(
    sender: &mpsc::UnboundedSender<Event>,
    context: &Context,
    text: &str,
) -> bool {
    let Ok(entry) = serde_json::from_str::<Value>(text) else {
        return false;
    };
    let mut value = json!({"entries": [entry]});
    sign_lines(&mut value, context);
    let text = format!("{}\n", value["entries"][0]);
    sender
        .send(Event::default().data(json!({"type":"delta","text":text}).to_string()))
        .is_ok()
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
        e.between
            .iter()
            .flat_map(|b| &b.facts)
            .for_each(|t| allow(t));
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
        for s in e.between.iter_mut().flat_map(|b| &mut b.said) {
            s.signed = sign("line", &s.actor_id, &s.text, s.turn);
        }
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
