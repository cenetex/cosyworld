//! A spoken line is a moment in a conversation (owner, 2026-11-02). My own
//! first-person view is my assistant turn, with no instructions: who I am,
//! where I am, what I hold and know, and the talk I remember (2026-11-03: a
//! view in the system or user turn read as someone else's "I"). The user
//! turn is only the line I answer. No cue ("Vale:") and no scene scaffold
//! reach it, so a chat-tuned model answers a person, the view stays out of
//! the reply, and the words are stable across attempts.
use super::{
    answered, custody, kind, name, names, waking, witnessed, Context, Entity, Part, Section,
    SpokenLine,
};

/// The recent talk here: at most this many lines, oldest dropped first.
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

/// The line this speaker answers: in a Talk, the actor's line for its
/// target; otherwise the latest line someone else said here that it heard.
pub(super) fn heard<'a>(context: &'a Context, entity: &Entity) -> Option<&'a SpokenLine> {
    // Exchange contexts contain prior-turn speech only; fresh line chaining
    // belongs to Talk. Keep old promises in chat(), not as this play's result.
    if custody::exchange(context, &entity.id) {
        return None;
    }
    answered(context, entity).or_else(|| {
        context
            .conversation
            .iter()
            .rev()
            .find(|line| line.actor_id != entity.id && witnessed(entity, line))
    })
}

/// Who is with me, as I see it: "Pip is here with me." or "I'm alone here."
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
    match here.len() {
        0 => "I'm alone here.".into(),
        1 => format!("{} is here with me.", names(&here)),
        _ => format!("{} are here with me.", names(&here)),
    }
}

/// The user turn: what I just heard, verbatim, as `Pip says, "…"`. When
/// nobody has spoken (a Wait, or the first words of a Talk) it is the person
/// I'm talking with, there ("Pip is here."), and silence when I face nobody:
/// on gemma-3-4b, silence drew scene narration ("The rain is coming down
/// harder now…") where the listener's presence drew speech (P3 eval). My own
/// view is my assistant turn, so no "I" reaches the user turn. A bare line
/// or `Pip: …` drew `Vale: …` back.
pub(super) fn user(context: &Context, entity: &Entity) -> String {
    match heard(context, entity) {
        Some(line) => format!(
            "{} says, \u{201c}{}\u{201d}",
            name(&line.actor_id),
            line.text
        ),
        None => super::listener(context, &entity.id)
            .filter(|_| entity.perception.is_some() || custody::exchange(context, &entity.id))
            .map_or_else(
                || crate::ai_gateway::SILENCE.into(),
                |l| format!("{} is here.", name(&l)),
            ),
    }
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
    let skip = heard(context, entity).filter(|_| part == Part::Line);
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
        .map(|fact| (Section::Directions, fact))
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

/// My own view as my turn, then what I just heard.
pub(super) fn messages(context: &Context, entity: &Entity) -> super::Prompt {
    let assistant = [
        super::own_view(entity, Part::Line),
        super::transcript(context, entity, Part::Line),
    ]
    .join("\n\n");
    super::Prompt {
        system: system(entity),
        assistant,
        user: user(context, entity),
    }
}

/// The context with the actor's fresh line added to the table talk, so the
/// Talk target answers it. Everyone voiced this turn heard it. The line was
/// generated and validated on this server this turn, after the browser's
/// lines were verified (`untrusted::trusted`), so it needs no envelope.
pub(super) fn with_line(context: &Context, actor: &str, text: &str) -> Option<Context> {
    let mut next: Context = serde_json::from_value(serde_json::to_value(context).ok()?).ok()?;
    next.acting_avatar = context.acting_avatar.clone();
    let mut witnesses = context.speakers.clone();
    if !witnesses.iter().any(|id| id == actor) {
        witnesses.push(actor.to_string());
    }
    next.conversation.push(SpokenLine {
        witnesses: Some(witnesses),
        actor_id: actor.to_string(),
        text: text.to_string(),
        signed: None,
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
                assert_eq!(prompt.user, "Pip is here.");
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
    async fn no_actor_line_means_no_reply() {
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
        assert!(result.is_err());
        assert!(started.elapsed() < Duration::from_millis(900));
        assert!(pip_requests(&seen).is_empty());
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
            },
            SpokenLine {
                signed: None,
                witnesses: all,
                actor_id: "vale".into(),
                text: "Which boats for the far shore leave from the east quay, Pip?".into(),
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
