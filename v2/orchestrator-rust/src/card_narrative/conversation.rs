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
/// And at most about this many characters (about 150 tokens).
const CHAT_CHARS: usize = 600;
/// The disclosure, worded as background the speaker may weave in.
pub(super) const MENTION: &str = "If it fits the conversation, I mention:";
/// What a retry adds to the system message.
const FRESH: &str = "My next words are fresh.";

/// Avatars' spoken lines use this shape. Places, reflections and a player's
/// avatar still waking unnamed keep their own transcripts.
pub(super) fn applies(context: &Context, entity: &Entity, part: Part) -> bool {
    part == Part::Line && kind(&entity.id, "avatar") && !waking::applies(context, &entity.id, part)
}

/// The line this speaker answers: in a Talk, the actor's line for its
/// target; otherwise the latest line someone else said here that it heard.
fn heard<'a>(context: &'a Context, entity: &Entity) -> Option<&'a SpokenLine> {
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
/// by `repeat` as whole lines.
pub(super) fn others_lines(context: &Context, entity: &Entity) -> Vec<String> {
    context
        .conversation
        .iter()
        .filter(|line| line.actor_id != entity.id && witnessed(entity, line))
        .map(|line| line.text.clone())
        .collect()
}

/// Arrange the scene lines for the system message: here and now, then what I
/// know, then the talk here, then the fact I may mention.
pub(super) fn frame(
    context: &Context,
    entity: &Entity,
    scene: String,
    lines: Vec<(Section, String)>,
    mentions: Vec<String>,
) -> Vec<(Section, String)> {
    let mut out = vec![(Section::Now, format!("Here: {scene}"))];
    let (known, now): (Vec<_>, Vec<_>) = lines
        .into_iter()
        .partition(|(section, _)| matches!(section, Section::Facts | Section::Inner));
    out.extend(now);
    if !known.is_empty() {
        out.push((Section::Now, String::new()));
        out.push((Section::Facts, "What I know:".into()));
        out.extend(known);
    }
    let chat = chat(context, entity);
    if !chat.is_empty() {
        out.push((Section::Now, String::new()));
        out.push((Section::Conversation, "Recent talk here:".into()));
        out.extend(chat.into_iter().map(|line| (Section::Conversation, line)));
    }
    for fact in mentions {
        out.push((Section::Now, String::new()));
        out.push((Section::Directions, format!("{MENTION} {fact}")));
    }
    out
}

/// The system and user messages for one attempt.
pub(super) fn messages(context: &Context, entity: &Entity, attempt: u8) -> (String, String) {
    let mut system = idiolect(entity, Part::Line);
    system.push_str("\n\n");
    system.push_str(&super::transcript(context, entity, Part::Line));
    if attempt > 0 {
        system.push_str("\n\n");
        system.push_str(FRESH);
    }
    (system, user(context, entity))
}

/// The scaffold a reply must not read back: the voice direction and the
/// disclosure's own wording. Facts, the scene and the talk are background a
/// speaker may use in its own words.
pub(super) fn meta(entity: &Entity) -> Vec<String> {
    let profile = &super::profiles()[&entity.id];
    vec![
        super::expression::line_direction(super::expression::mode(profile), &name(&entity.id)),
        MENTION.into(),
        FRESH.into(),
    ]
}

/// The context with the actor's fresh line added to the table talk, so the
/// Talk target answers it. Everyone voiced this turn heard it.
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
    });
    Some(next)
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
