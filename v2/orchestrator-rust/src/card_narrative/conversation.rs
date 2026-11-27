//! A spoken line is a moment in a conversation (owner, 2026-11-02). My own
//! first-person view is my assistant turn, with no instructions: who I am,
//! where I am, what I hold and know, and the talk I remember (2026-11-03: a
//! view in the system or user turn read as someone else's "I"). The user
//! turn is only the line I answer. No cue ("Vale:") and no scene scaffold
//! reach it, so a chat-tuned model answers a person, the view stays out of
//! the reply, and the words are stable across attempts.
use super::{
    answered, custody, kind, name, names, waking, witnessed, Context, Entity, Envelope, Part,
    Reflection, Section,
};

use super::{elysium, knowledge, speak, AiConfig, Introduction, SceneClosed, VoiceSettings};
use serde::{Deserialize, Deserializer, Serialize};
use std::collections::BTreeMap;

#[derive(Debug, Default, Deserialize, Serialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub(super) struct SpokenLine {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(super) witnesses: Option<Vec<String>>,
    pub(super) actor_id: String,
    pub(super) text: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(super) signed: Option<Envelope>,
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "present_name"
    )]
    pub(super) elysium_name: Option<Option<String>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(super) elysium_name_signed: Option<Envelope>,
}

fn present_name<'de, D: Deserializer<'de>>(
    deserializer: D,
) -> Result<Option<Option<String>>, D::Error> {
    Option::deserialize(deserializer).map(Some)
}

#[derive(Serialize)]
pub(super) struct Entry {
    pub(super) id: String,
    pub(super) text: String,
    pub(super) model: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(super) disclosed: Option<super::knowledge::Receipt>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(super) reflection: Option<Reflection>,
    #[serde(rename = "elysiumName", skip_serializing_if = "Option::is_none")]
    pub(super) elysium_name: Option<Option<String>>,
}

impl Entry {
    pub(super) fn spoken(id: &str, text: String, model: String) -> Self {
        Self {
            id: id.to_owned(),
            text,
            model,
            disclosed: None,
            reflection: None,
            elysium_name: crate::card_shared::elysium_model(id).map(|_| None),
        }
    }
}

pub(super) async fn prepare_resident<'a>(
    context: &Context,
    introduction: Option<&'a Introduction>,
    deadline: tokio::time::Instant,
) -> Option<(&'a str, Option<String>)> {
    let (state, target) = introduction?;
    let name = tokio::time::timeout_at(deadline, elysium::prepare_name(state, context, target))
        .await
        .ok()
        .flatten();
    Some((target, name))
}

#[allow(clippy::too_many_arguments)]
pub(super) async fn exchange(
    config: &AiConfig,
    context: &Context,
    character_models: &BTreeMap<String, String>,
    settings: &VoiceSettings,
    deadline: tokio::time::Instant,
    (actor, target): (&str, &str),
    on_delta: Option<&(dyn Fn(&str) -> bool + Send + Sync)>,
    lines: &mut BTreeMap<String, Entry>,
    introduction: Option<&Introduction>,
) -> Result<(), SceneClosed> {
    let reserve = reply_reserve(settings.scene_timeout);
    let opener_deadline = deadline - reserve;
    let opener_ids = [actor.to_string()];
    let opener = voice_lines(
        config,
        context,
        character_models,
        settings,
        opener_deadline,
        &opener_ids,
        on_delta,
        lines,
        None,
    );
    let (said, resident) = tokio::join!(
        opener,
        prepare_resident(
            context,
            introduction.filter(|(_, id)| id == target),
            opener_deadline
        )
    );
    said?;
    let Some(heard) = lines
        .get(actor)
        .and_then(|line| with_line(context, actor, &line.text))
        .or_else(|| {
            copy_context(context).map(|mut next| {
                next.no_fresh_opener = true;
                next
            })
        })
    else {
        return Ok(());
    };
    voice_lines(
        config,
        &heard,
        character_models,
        settings,
        deadline,
        &[target.to_string()],
        on_delta,
        lines,
        resident,
    )
    .await
}

/// Keep validated lines up to the scene deadline. Dropping the stream cancels
/// the pending requests.
#[allow(clippy::too_many_arguments)]
pub(super) async fn voice_lines(
    config: &AiConfig,
    context: &Context,
    character_models: &BTreeMap<String, String>,
    settings: &VoiceSettings,
    deadline: tokio::time::Instant,
    ids: &[String],
    on_delta: Option<&(dyn Fn(&str) -> bool + Send + Sync)>,
    lines: &mut BTreeMap<String, Entry>,
    resident: Option<(&str, Option<String>)>,
) -> Result<(), SceneClosed> {
    let prepared = resident.as_ref().and_then(|(target, name)| {
        let mut next = copy_context(context)?;
        elysium::add_talk_facts(&mut next, target, name.as_deref());
        Some(next)
    });
    let context = prepared.as_ref().unwrap_or(context);
    // Each job owns its id: a borrowed one makes the scene future too
    // general for `tokio::spawn`.
    #[allow(clippy::unnecessary_to_owned)]
    let jobs = ids.to_vec().into_iter().map(|id| async move {
        let voice = speak(
            config,
            context,
            character_models,
            settings,
            deadline,
            &id,
            Part::Line,
        );
        let (text, model) = tokio::time::timeout_at(deadline, voice).await.ok()?.ok()?;
        let mut entry = Entry::spoken(&id, text, model);
        // Once accepted, a line still publishes if its optional evidence check times out.
        knowledge::confirm(config, context, &mut entry, deadline).await;
        Some(entry)
    });
    let mut results = futures_util::StreamExt::buffer_unordered(
        futures_util::stream::iter(jobs),
        settings.parallel.max(1),
    );
    while let Some(result) = futures_util::StreamExt::next(&mut results).await {
        let Some(mut entry) = result else {
            continue;
        };
        if let Some((_, name)) = resident.as_ref().filter(|(target, _)| {
            *target == entry.id && elysium::needs_introduction(context, target)
        }) {
            entry.elysium_name = Some(name.clone());
        }
        publish_line(context, on_delta, lines, entry)?;
    }
    Ok(())
}

fn publish_line(
    context: &Context,
    on_delta: Option<&(dyn Fn(&str) -> bool + Send + Sync)>,
    lines: &mut BTreeMap<String, Entry>,
    line: Entry,
) -> Result<(), SceneClosed> {
    if context.speakers.contains(&line.id)
        && on_delta.is_some_and(|emit| !emit(&serde_json::json!(line).to_string()))
    {
        return Err(SceneClosed);
    }
    lines.insert(line.id.clone(), line);
    Ok(())
}

pub(super) const CHAT_LINES: usize = 6;
/// And at most about this many characters (about 100 tokens), so a
/// conversation prompt stays near #1537's 350 tokens.
const CHAT_CHARS: usize = 400;

/// Characters' and things' spoken lines use this shape. Places,
/// reflections and a player's avatar still waking unnamed keep their own.
pub(super) fn applies(context: &Context, entity: &Entity, part: Part) -> bool {
    part == Part::Line
        && !kind(&entity.id, "location")
        && !waking::applies(context, &entity.id, part)
}

/// The line this speaker answers: in a Talk, the actor's; otherwise the latest heard here, if not mine.
pub(super) fn heard<'a>(context: &'a Context, entity: &Entity) -> Option<&'a SpokenLine> {
    // Exchange contexts contain prior-turn speech only; fresh line chaining
    // belongs to Talk. Keep old promises in chat(), not as this play's result.
    if context.no_fresh_opener || custody::exchange(context, &entity.id) {
        return None;
    }
    answered(context, entity).or_else(|| {
        context
            .conversation
            .iter()
            .rev()
            .find(|line| witnessed(entity, line))
            .filter(|line| line.actor_id != entity.id)
    })
}

pub(super) fn presence(context: &Context, id: &str) -> String {
    let mut here: Vec<String> = context
        .outcome
        .iter()
        .flat_map(|o| &o.avatars)
        .filter(|a| a.id != id && a.location == context.location)
        .map(|a| a.id.clone())
        .collect();
    if context.outcome.is_none() {
        here.extend(super::listener(context, id));
    }
    for other in &context.present {
        if other != id && !here.contains(other) {
            here.push(other.clone());
        }
    }
    match here.len() {
        0 => "I'm alone here.".into(),
        1 => format!("{} is here with me.", names(&here)),
        _ => format!("{} are here with me.", names(&here)),
    }
}

pub(super) const THINK: &str = "What do you think to yourself? One short sentence.";
pub(super) const FACE: &str = "What do you say?";
pub(super) const NOTICE: &str = "In one short sentence, what do you notice here?";

fn facing(context: &Context, entity: &Entity) -> Option<String> {
    match super::listener(context, &entity.id) {
        Some(listener) => (entity.perception.is_some() || custody::exchange(context, &entity.id))
            .then_some(listener),
        None => actor_here(context, entity),
    }
}

fn actor_here(context: &Context, entity: &Entity) -> Option<String> {
    let actor = context.acting_avatar.as_deref().unwrap_or("vale");
    let hidden = context
        .concealed
        .iter()
        .chain(&context.covered)
        .any(|id| id == actor);
    let here = context
        .outcome
        .iter()
        .flat_map(|o| &o.avatars)
        .any(|a| a.id == actor && a.location == context.location);
    (entity.id != actor && !hidden && here).then(|| actor.to_string())
}

/// A speaking voice after a play, with no line to answer and nobody to face.
fn lone(context: &Context, entity: &Entity) -> bool {
    context.outcome.is_some()
        && heard(context, entity).is_none()
        && facing(context, entity).is_none()
        && super::system_voice(entity, Part::Line).starts_with("You are ")
}

pub(super) fn place(context: &Context, seen: &str) -> String {
    let sense = super::perception::anchor(&context.location).filter(|sense| {
        !context.concealed.contains(&context.location) && !seen.contains(sense.as_str())
    });
    let here = format!("You are standing in {}.", name(&context.location));
    [here]
        .into_iter()
        .chain(sense)
        .collect::<Vec<_>>()
        .join(" ")
}

fn alone(context: &Context, entity: &Entity) -> String {
    let mine = context.outcome.iter().flat_map(|o| &o.avatars);
    let came = mine
        .filter(|a| a.id == entity.id)
        .filter_map(|a| a.travel.as_ref())
        .find(|t| t.to == context.location && t.from != context.location);
    match came {
        Some(t) => format!("You arrive from {}. {NOTICE}", name(&t.from)),
        None => format!("You wait a moment. {THINK}"),
    }
}

/// The user turn: what I just heard, as `Pip says, "…"`; else who I face, and a
/// speaking voice is asked what it says ("Pip is here." drew "He is.", 2026-11-25);
/// a lone voice's question; or silence for a gesture or emoji voice alone.
pub(super) fn user(context: &Context, entity: &Entity) -> String {
    if adding(context, entity) {
        return FOLLOW_UP.into();
    }
    match heard(context, entity) {
        Some(line) => format!(
            "{} says, \u{201c}{}\u{201d}",
            name(&line.actor_id),
            line.text
        ),
        None if lone(context, entity) => alone(context, entity),
        None => facing(context, entity).map_or_else(
            || crate::ai_gateway::SILENCE.into(),
            |l| match super::system_voice(entity, Part::Line) {
                shaped if shaped.starts_with(crate::ai_gateway::SHAPE) => {
                    format!("You face {}.", name(&l))
                }
                _ => format!("You face {}. {FACE}", name(&l)),
            },
        ),
    }
}

/// On Discord, when the speaker's own line is the newest, it adds to it.
fn adding(context: &Context, entity: &Entity) -> bool {
    let last = context.conversation.last();
    context.channel && last.is_some_and(|l| l.actor_id == entity.id)
}

/// A remembered line, "Name: words", as "Pip said: "words"" or, for my
/// own, "I said: "words"".
pub(super) fn said(text: &str, own: &str) -> String {
    match text.split_once(": ") {
        Some((who, words)) if who == own => format!("I said: \"{words}\""),
        Some((who, words)) => format!("{who} said: \"{words}\""),
        None => text.to_string(),
    }
}

/// The talk at this place that the speaker heard, oldest first, as
/// remembered lines. A line keeps the last few, bounded by lines and
/// characters; the answered line is the user message, so it is not
/// repeated here. Reflection remembers the whole talk.
pub(super) fn chat(context: &Context, entity: &Entity, part: Part) -> Vec<String> {
    let answer = part == Part::Line && !adding(context, entity);
    let skip = heard(context, entity).filter(|_| answer);
    let own = name(&entity.id);
    let mut lines: Vec<String> = context
        .conversation
        .iter()
        .filter(|line| witnessed(entity, line))
        .filter(|line| !skip.is_some_and(|heard| std::ptr::eq(*line, heard)))
        .map(|line| said(&format!("{}: {}", name(&line.actor_id), line.text), &own))
        .collect();
    if part != Part::Line {
        return lines;
    }
    let start = lines.len().saturating_sub(CHAT_LINES);
    lines.drain(..start);
    while lines.len() > 1 && lines.iter().map(|l| l.chars().count() + 1).sum::<usize>() > CHAT_CHARS
    {
        lines.remove(0);
    }
    lines
}

/// Other speakers' lines the reply must not parrot. Its own lines are checked
/// by `repeat` as whole lines. The line answered is left out: an answer
/// may echo its question ("Ships for Signal Jetty leave from the east
/// quay."); only a whole-line copy of it is a repeat.
pub(super) fn others_lines(context: &Context, entity: &Entity) -> Vec<String> {
    let skip = heard(context, entity);
    context
        .conversation
        .iter()
        .filter(|line| line.actor_id != entity.id && witnessed(entity, line))
        .filter(|line| !skip.is_some_and(|heard| std::ptr::eq(*line, heard)))
        .map(|line| line.text.clone())
        .collect()
}

/// Arrange the view for the system message: here and now, then what I know
/// and want, what is between me and the person I face, and the talk I
/// remember, each as its own paragraph. No labels.
pub(super) fn frame(
    context: &Context,
    entity: &Entity,
    part: Part,
    lines: Vec<(Section, String)>,
    mentions: Vec<String>,
) -> Vec<(Section, String)> {
    let between = if part == Part::Line {
        super::between::lines(context, entity)
    } else {
        Vec::new()
    };
    // A fact shown in our history is not said twice.
    let once = |(section, text): (Section, String)| {
        let text = between
            .iter()
            .fold(text, |t, line| t.replace(line.as_str(), ""));
        let text = text.split_whitespace().collect::<Vec<_>>().join(" ");
        (!text.is_empty()).then_some((section, text))
    };
    let (known, mut out): (Vec<_>, Vec<_>) = lines
        .into_iter()
        .partition(|(section, _)| matches!(section, Section::Facts | Section::Inner));
    let known: Vec<_> = known.into_iter().filter_map(once).collect();
    // A reserved fact I already witnessed ("I witnessed this just now at
    // ...: Ships for ... leave ...") is not said twice.
    let fresh: Vec<_> = mentions
        .into_iter()
        .filter(|fact| !known.iter().any(|(_, text)| text.contains(fact.as_str())))
        .map(|fact| {
            (
                Section::Facts,
                format!("Something I know and can bring up if it fits the conversation: {fact}"),
            )
        })
        .collect();
    let known: Vec<_> = known.into_iter().chain(fresh).collect();
    let between = between.iter().map(|l| (Section::Conversation, l.clone()));
    let chat = chat(context, entity, part)
        .into_iter()
        .map(|l| (Section::Conversation, l));
    for block in [known, between.collect(), chat.collect()] {
        if !block.is_empty() {
            out.push((Section::Now, String::new()));
            out.extend(block);
        }
    }
    out
}

/// Words no prompt holds any more, or mechanics a learning fact holds,
/// lowercased: a reply holding one reads a scaffold back, whatever its case.
pub(super) const SCAFFOLD: &[&str] = &[
    "if it fits the conversation",
    "what i know:",
    "recent talk here",
    "between us:",
    "my next words are fresh",
    "helped reach my goal",
    "measured attempt",
    "introduce yourself to the traveler in your own words",
];

/// Whether a lowercased reply reads back a prompt label, in any case.
pub(super) fn reads_label(lower: &str, label: &str) -> bool {
    lower.contains(&label.to_lowercase())
}

/// Whether a fact is what the speaker learned about its own approaches
/// (`learningFacts` in learning.mjs): planning, not something to say.
pub(super) fn strategy(fact: &str) -> bool {
    fact.contains(" measured attempt")
        || fact.contains("This approach helped reach my goal")
        || fact.contains("This was my first measured try")
        || (fact.starts_with("I tried ") && fact.contains(" while seeking "))
        || (fact.starts_with("I expected ")
            && (fact.contains(" to agree. ") || fact.contains(" to decline. ")))
}

/// The one command a spoken line's system turn carries (owner, 2026-11-04).
/// Without it a chat model continues my first-person view as narration
/// ("I tilt the Lamp…"); with it Luna's clean speech rose from 5 to 14 of
/// 20 lines, with no assistant voice or echo. It must stay a command: "What
/// you write is what you say aloud." did not work.
pub(super) const SAY_ALOUD: &str = "Reply with only what you say aloud.";
pub(super) const FOLLOW_UP: &str =
    "You wait a moment. What do you add to what you just said? One short sentence.";

/// Who I am, then the one command, for a speaking voice. A body-language or
/// emoji voice keeps its own reply shape.
fn system(entity: &Entity) -> String {
    let voice = super::system_voice(entity, Part::Line);
    if voice.starts_with("You are ") {
        format!("{voice} {SAY_ALOUD}")
    } else {
        voice
    }
}

pub(super) fn messages(context: &Context, entity: &Entity) -> super::Prompt {
    let assistant = [
        super::own_view(entity, Part::Line),
        super::transcript(context, entity, Part::Line),
    ]
    .join("\n\n");
    let lone = lone(context, entity);
    let mut system = if lone {
        super::system_voice(entity, Part::Line)
    } else {
        system(entity)
    };
    if context.elysium_introducer.as_deref() == Some(entity.id.as_str()) {
        system.push(' ');
        system.push_str(elysium::SELF_INTRODUCTION);
    }
    super::Prompt {
        system,
        lead: match lone {
            true => place(context, &assistant),
            false => String::new(),
        },
        assistant,
        user: user(context, entity),
    }
}

/// The context with the actor's fresh line added to the table talk, so the
/// Talk target answers it. Everyone voiced this turn heard it. The line was
/// generated and validated on this server this turn, after the browser's
/// lines were verified (`untrusted::trusted`), so it needs no envelope.
pub(super) fn copy_context(context: &Context) -> Option<Context> {
    let mut next: Context = serde_json::from_value(serde_json::to_value(context).ok()?).ok()?;
    next.acting_avatar = context.acting_avatar.clone();
    next.present.clone_from(&context.present);
    next.images.clone_from(&context.images);
    next.channel = context.channel;
    next.no_fresh_opener = context.no_fresh_opener;
    next.elysium_introducer
        .clone_from(&context.elysium_introducer);
    Some(next)
}

pub(super) fn with_line(context: &Context, actor: &str, text: &str) -> Option<Context> {
    let mut next = copy_context(context)?;
    let mut witnesses = context.speakers.clone();
    if !witnesses.iter().any(|id| id == actor) {
        witnesses.push(actor.to_string());
    }
    next.conversation.push(SpokenLine {
        witnesses: Some(witnesses),
        actor_id: actor.to_string(),
        text: text.to_string(),
        signed: None,
        ..Default::default()
    });
    Some(next)
}

/// The part of the scene kept for the Talk target's reply: the actor
/// finishes within the first 55%, so at the hosted 22 s the reply always
/// has about 10 s.
pub(super) fn reply_reserve(scene: std::time::Duration) -> std::time::Duration {
    scene * 45 / 100
}

/// The Talk target who answers the actor's line this turn, when both speak.
pub(super) fn reply_target(context: &Context, voiced: &[String]) -> Option<(String, String)> {
    let actor = context.acting_avatar.as_deref().unwrap_or("vale");
    reply_target_for(context, voiced, actor)
}

pub(super) fn reply_target_for(
    context: &Context,
    voiced: &[String],
    actor: &str,
) -> Option<(String, String)> {
    let card = &context.outcome.as_ref()?.card;
    let target = card.target.as_deref()?;
    (card.kind == "talk"
        && target != actor
        && voiced.iter().any(|id| id == actor)
        && voiced.iter().any(|id| id == target))
    .then(|| (actor.to_string(), target.to_string()))
}

#[cfg(test)]
mod tests {
    use super::super::tests::{context, serve, solo_departure, stem_of, stem_reply, test_config};
    use super::super::{complete_selected, transcript, valid, Check, VoiceSettings};
    use super::*;
    use axum::{routing::post, Json, Router};
    use serde_json::{json, Value};
    use std::{
        collections::BTreeMap,
        sync::{Arc, Mutex},
        time::Duration,
    };

    /// Vale talks with Pip at the station, both present.
    fn talk() -> Context {
        let mut c = context();
        c.scenery = false;
        c.focus = None;
        c.outcome = Some(solo_departure());
        let outcome = c.outcome.as_mut().unwrap();
        outcome.avatars[1].travel = None;
        outcome.avatars[1].location = "station".into();
        for item in &mut outcome.items {
            if item.holder == "moth" {
                item.location = "station".into();
            }
        }
        outcome.card.kind = "talk".into();
        outcome.card.target = Some("moth".into());
        assert!(valid(&c));
        c
    }

    #[test]
    fn exchange_results_keep_earlier_promises_as_memory_not_the_reply_cue() {
        let mut c = talk();
        c.conversation = vec![SpokenLine {
            signed: None,
            witnesses: Some(vec!["vale".into(), "moth".into()]),
            actor_id: "moth".into(),
            text: "You can borrow my lamp.".into(),
            ..Default::default()
        }];
        for verb in ["ask", "give", "trade"] {
            let card = &mut c.outcome.as_mut().unwrap().card;
            card.kind = verb.into();
            card.item = Some("lamp".into());
            card.receive = (verb == "trade").then(|| "bell".into());
            for accepted in [false, true] {
                c.outcome.as_mut().unwrap().card.accepted = Some(accepted);
                assert!(valid(&c));
                let prompt = messages(&c, super::super::entity(&c, "vale"));
                assert_eq!(prompt.user, "You face Pip. What do you say?");
                assert!(prompt
                    .assistant
                    .contains("Pip said: \"You can borrow my lamp.\""));
                assert!(heard(&c, super::super::entity(&c, "moth")).is_none());
            }
        }
        c.outcome.as_mut().unwrap().card.kind = "talk".into();
        assert_eq!(
            heard(&c, super::super::entity(&c, "vale")).unwrap().text,
            "You can borrow my lamp."
        );
    }

    #[test]
    fn a_resident_speaking_alone_after_a_play_faces_the_actor() {
        let mut c = talk();
        c.speakers = vec!["moth".into()];
        for (verb, accepted) in [("give", false), ("trade", false), ("give", true)] {
            let card = &mut c.outcome.as_mut().unwrap().card;
            card.kind = verb.into();
            card.item = Some("lamp".into());
            card.receive = (verb == "trade").then(|| "bell".into());
            card.accepted = Some(accepted);
            let prompt = messages(&c, super::super::entity(&c, "moth"));
            assert_eq!(
                prompt.user, "You face Vale. What do you say?",
                "{verb} {accepted}"
            );
            assert_eq!(prompt.lead, "");
            assert!(prompt.system.ends_with(SAY_ALOUD), "{}", prompt.system);
        }
        for (id, shape) in [("skull", "body language"), ("whiskerwind", "symbols only")] {
            let text = serde_json::to_string(&c)
                .unwrap()
                .replace("\"moth\"", &format!("{id:?}"));
            let gesture: Context = serde_json::from_str(&text).unwrap();
            let prompt = messages(&gesture, super::super::entity(&gesture, id));
            assert!(prompt.system.contains(shape), "{}", prompt.system);
            assert_eq!(prompt.user, "You face Vale.", "{id}");
        }
        c.speakers = vec!["vale".into()];
        c.outcome.as_mut().unwrap().card.kind = "wait".into();
        let prompt = messages(&c, super::super::entity(&c, "vale"));
        assert_eq!(prompt.user, format!("You wait a moment. {THINK}"));
        assert!(prompt
            .lead
            .starts_with("You are standing in Empty station."));
        assert!(!prompt.system.contains(SAY_ALOUD));
    }

    /// A provider whose replies take `delay(stem)` before they come back.
    fn slow_provider(seen: Arc<Mutex<Vec<Value>>>, delay: fn(&str) -> u64) -> Router {
        Router::new().route(
            "/chat/completions",
            post(move |Json(body): Json<Value>| {
                let seen = seen.clone();
                async move {
                    seen.lock().unwrap().push(body.clone());
                    let stem = stem_of(&body);
                    tokio::time::sleep(Duration::from_millis(delay(&stem))).await;
                    let text = match stem.as_str() {
                        "Vale:" => "The clock stopped again, Pip.".into(),
                        _ => stem_reply(&stem),
                    };
                    Json(json!({"model":body["model"],"choices":[{"message":{"content":text},"finish_reason":"stop"}]}))
                }
            }),
        )
    }

    fn quick() -> VoiceSettings {
        VoiceSettings {
            call_timeout: Duration::from_millis(1000),
            scene_timeout: Duration::from_millis(1000),
            parallel: 4,
            ..VoiceSettings::hosted()
        }
    }

    fn pip_requests(seen: &Mutex<Vec<Value>>) -> Vec<Value> {
        let seen = seen.lock().unwrap();
        seen.iter()
            .filter(|r| stem_of(r) == "Pip:")
            .cloned()
            .collect()
    }

    /// A slow actor beside a bystander that never answers still leaves the
    /// Talk target time to reply: it starts once the actor's line is in.
    #[tokio::test]
    async fn a_slow_actor_still_leaves_the_target_time_to_reply() {
        let seen = Arc::new(Mutex::new(Vec::new()));
        let (address, server) = serve(slow_provider(seen.clone(), |stem| match stem {
            "Vale:" => 400,
            "Pip:" => 300,
            _ => 5_000,
        }))
        .await;
        let ids = vec!["vale".to_string(), "moth".into(), "lamp".into()];
        let result = complete_selected(
            &test_config(address),
            &talk(),
            &BTreeMap::new(),
            &quick(),
            &ids,
            false,
            None,
        )
        .await
        .unwrap();
        let spoke: Vec<_> = result["entries"]
            .as_array()
            .unwrap()
            .iter()
            .map(|e| e["id"].as_str().unwrap().to_string())
            .collect();
        assert_eq!(spoke, ["vale", "moth"]);
        let pip = pip_requests(&seen);
        assert_eq!(pip.len(), 1);
        let heard = super::super::tests::turn_of(&pip[0], "user");
        assert_eq!(
            heard,
            "Vale says, \u{201c}The clock stopped again, Pip.\u{201d}"
        );
        server.abort();
    }

    /// With no line from the actor this turn, the target does not answer
    /// one from an earlier turn.
    #[tokio::test]
    async fn a_resident_responds_without_an_opener_from_this_turn() {
        let seen = Arc::new(Mutex::new(Vec::new()));
        let (address, server) = serve(slow_provider(seen.clone(), |stem| match stem {
            "Vale:" => 5_000,
            _ => 0,
        }))
        .await;
        let mut c = talk();
        c.conversation = vec![SpokenLine {
            signed: None,
            witnesses: Some(vec!["vale".into(), "moth".into()]),
            actor_id: "vale".into(),
            text: "An old question from yesterday.".into(),
            ..Default::default()
        }];
        let ids = vec!["vale".to_string(), "moth".into()];
        let started = tokio::time::Instant::now();
        let result = complete_selected(
            &test_config(address),
            &c,
            &BTreeMap::new(),
            &quick(),
            &ids,
            false,
            None,
        )
        .await;
        let result = result.unwrap();
        assert_eq!(result["entries"].as_array().unwrap().len(), 1);
        assert_eq!(result["entries"][0]["id"], "moth");
        assert!(started.elapsed() < Duration::from_millis(900));
        let pip = pip_requests(&seen);
        assert_eq!(pip.len(), 1);
        assert!(!super::super::tests::turn_of(&pip[0], "user").contains("yesterday"));
        server.abort();
    }

    /// Strategy lines are planning, not speech: a line's prompt leaves them
    /// out, and a reply that says them anyway reads the mechanics back.
    #[test]
    fn strategy_lines_stay_out_of_speech() {
        let mut c = talk();
        let lines = [
            "I tried waiting while seeking Lamp. My goal is still open. I had 1 earlier attempt at waiting to compare.",
            "Asking Vale for Lamp: 1 measured attempt. This approach helped reach my goal 0 times.",
            "I expected Vale to agree. Vale declined. I will give them time and talk first.",
        ];
        c.entities[3]
            .facts
            .extend(lines.iter().map(|l| l.to_string()));
        let pip = &c.entities[3];
        let prompt = transcript(&c, pip, Part::Line);
        for line in lines {
            assert!(strategy(line));
            assert!(!prompt.contains(line), "{line}");
        }
        assert!(!strategy("Holding the black cloth."));
        let check = Check::new(&c, pip, Part::Line);
        assert_eq!(
            check.clean(
                "My goal is still open. This approach helped reach my goal 0 times.",
                true
            ),
            Err("echoed brief")
        );
    }

    /// A scaffold's words, in any case, are a read-back; "here" in speech
    /// is not.
    #[test]
    fn scaffold_words_in_any_case_are_read_back() {
        let c = talk();
        let check = Check::new(&c, &c.entities[0], Part::Line);
        for leak in [
            "what i know: the clock stopped.",
            "If it fits the conversation, I'd say the clock stopped.",
            "Recent talk here was all about the clock.",
        ] {
            assert_eq!(check.clean(leak, true), Err("echoed brief"), "{leak}");
        }
        let fine = "Come over here: the clock stopped.";
        assert_eq!(check.clean(fine, true), Ok(fine.into()));
    }

    /// An answer may echo its question; parroting someone else, or the
    /// whole question, is still a repeat.
    #[test]
    fn an_answer_may_echo_the_question() {
        let mut c = talk();
        let all = Some(vec!["vale".to_string(), "moth".into(), "keeper".into()]);
        c.conversation = vec![
            SpokenLine {
                signed: None,
                witnesses: all.clone(),
                actor_id: "keeper".into(),
                text: "The night boats for the far shore are late again.".into(),
                ..Default::default()
            },
            SpokenLine {
                signed: None,
                witnesses: all,
                actor_id: "vale".into(),
                text: "Which boats for the far shore leave from the east quay, Pip?".into(),
                ..Default::default()
            },
        ];
        let pip = &c.entities[3];
        let check = Check::new(&c, pip, Part::Line);
        let answer = "Boats for the far shore leave from the east quay.";
        assert_eq!(check.clean(answer, true), Ok(answer.into()));
        assert_eq!(
            check.clean("The night boats for the far shore are late.", true),
            Err("repeat")
        );
        assert_eq!(
            check.clean(
                "Which boats for the far shore leave from the east quay, Pip?",
                true
            ),
            Err("repeat")
        );
    }
}
