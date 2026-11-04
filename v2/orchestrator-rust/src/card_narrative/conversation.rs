//! A spoken line is a turn in a conversation (owner, 2026-11-02). The system
//! message holds who I am, my voice, where I am and who is here, what I know,
//! the recent talk at this place and an optional fact to mention. The user
//! message is only the line I answer. No cue ("Vale:") and no scene scaffold
//! reach the user turn, so a chat-tuned model answers a person, the scaffold
//! stays out of the reply, and the system text is stable across attempts.
use super::{
    answered, idiolect, kind, name, waking, witnessed, Context, Entity, Part, Section, SpokenLine,
};

/// The recent talk here: at most this many lines, oldest dropped first.
pub(super) const CHAT_LINES: usize = 6;
/// And at most about this many characters (about 100 tokens), so a
/// conversation prompt stays near #1537's 350 tokens.
const CHAT_CHARS: usize = 400;

/// Avatars' spoken lines use this shape. Places, reflections and a player's
/// avatar still waking unnamed keep their own transcripts.
pub(super) fn applies(context: &Context, entity: &Entity, part: Part) -> bool {
    part == Part::Line && kind(&entity.id, "avatar") && !waking::applies(context, &entity.id, part)
}

/// The line this speaker answers: in a Talk, the actor's line for its
/// target; otherwise the latest line someone else said here that it heard.
pub(super) fn heard<'a>(context: &'a Context, entity: &Entity) -> Option<&'a SpokenLine> {
    answered(context, entity).or_else(|| {
        context
            .conversation
            .iter()
            .rev()
            .find(|line| line.actor_id != entity.id && witnessed(entity, line))
    })
}

/// The user message: the answered line's words, or a neutral cue naming who
/// is here. Never the play's caption.
pub(super) fn user(context: &Context, entity: &Entity) -> String {
    if let Some(line) = heard(context, entity) {
        return line.text.clone();
    }
    match super::listener(context, &entity.id) {
        Some(other) => format!("{} is here.", name(&other)),
        None => format!("{}.", name(&context.location)),
    }
}

/// The recent talk at this place that the speaker heard, oldest first, as
/// "Name: words", bounded by lines and characters. The answered line is the
/// user message, so it is not repeated here.
pub(super) fn chat(context: &Context, entity: &Entity) -> Vec<String> {
    let skip = heard(context, entity);
    let mut lines: Vec<String> = context
        .conversation
        .iter()
        .filter(|line| witnessed(entity, line))
        .filter(|line| !skip.is_some_and(|heard| std::ptr::eq(*line, heard)))
        .map(|line| format!("{}: {}", name(&line.actor_id), line.text))
        .collect();
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

/// Arrange the scene lines for the system message: here and now, then what I
/// know, what is between me and the person I face, the talk here, and the
/// fact I may mention.
pub(super) fn frame(
    context: &Context,
    entity: &Entity,
    scene: String,
    lines: Vec<(Section, String)>,
    mentions: Vec<String>,
) -> Vec<(Section, String)> {
    let mut out = vec![(Section::Now, format!("Here: {scene}"))];
    let between = super::between::lines(context, entity);
    // A fact shown under "Between us" is not said twice.
    let once = |(section, text): (Section, String)| {
        let text = between
            .iter()
            .fold(text, |t, line| t.replace(line.as_str(), ""));
        let text = text.split_whitespace().collect::<Vec<_>>().join(" ");
        (!text.is_empty()).then_some((section, text))
    };
    let (known, now): (Vec<_>, Vec<_>) = lines
        .into_iter()
        .partition(|(section, _)| matches!(section, Section::Facts | Section::Inner));
    // A fact the rules reserved for this Talk is one more thing I know.
    let known: Vec<_> = known
        .into_iter()
        .filter_map(once)
        .chain(mentions.into_iter().map(|fact| (Section::Directions, fact)))
        .collect();
    out.extend(now);
    if !known.is_empty() {
        out.push((Section::Now, String::new()));
        out.push((Section::Facts, "What I know:".into()));
        out.extend(known);
    }
    if !between.is_empty() {
        out.push((Section::Now, String::new()));
        out.push((Section::Facts, super::between::LABEL.into()));
        out.extend(between.into_iter().map(|line| (Section::Facts, line)));
    }
    let chat = chat(context, entity);
    if !chat.is_empty() {
        out.push((Section::Now, String::new()));
        out.push((Section::Conversation, "Recent talk here:".into()));
        out.extend(chat.into_iter().map(|line| (Section::Conversation, line)));
    }
    out
}

/// The prompt's own wording, lowercased: a reply holding one reads the
/// scaffold back, whatever its case.
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
/// "Here:" is a label only at the start; "come here: now" is speech.
pub(super) fn reads_label(lower: &str, label: &str) -> bool {
    let label = label.to_lowercase();
    if label == "here:" {
        lower.trim_start().starts_with(&label)
    } else {
        lower.contains(&label)
    }
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

/// The system and user messages. Every attempt sends the same words.
pub(super) fn messages(context: &Context, entity: &Entity) -> (String, String) {
    let mut system = idiolect(entity, Part::Line);
    system.push_str("\n\n");
    system.push_str(&super::transcript(context, entity, Part::Line));
    (system, user(context, entity))
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
        assert_eq!(
            pip[0]["messages"][1]["content"],
            "The clock stopped again, Pip."
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

    /// The scaffold's own words, in any case, are a read-back; "here" in
    /// speech is not.
    #[test]
    fn scaffold_words_in_any_case_are_read_back() {
        let c = talk();
        let check = Check::new(&c, &c.entities[0], Part::Line);
        for leak in [
            "what i know: the clock stopped.",
            "If it fits the conversation, I'd say the clock stopped.",
            "Recent talk here was all about the clock.",
            "here: the clock stopped.",
            "PRESENT: the clock and me.",
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
