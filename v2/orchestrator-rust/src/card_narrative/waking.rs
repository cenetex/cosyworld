//! The player's avatar wakes knowing nothing (#1600). The opening frame holds
//! only what its player has uncovered: no name, place or holdings at first,
//! and no idiolect at all: the persona's wants and trades wait for the next
//! turn (#1665). The model finds its own first words; the usual checks still
//! keep it in character.
use super::*;

/// Whether this call is the avatar's raw waking frame.
pub(super) fn applies(context: &Context, id: &str, part: Part) -> bool {
    context.waking && part == Part::Line && kind(id, "avatar")
}

fn uncovered(context: &Context, id: &str) -> bool {
    !context
        .covered
        .iter()
        .chain(&context.concealed)
        .any(|card| card == id)
}

/// The system voice: none while waking, even once the speaker's own card is
/// uncovered, so the persona's wants and bargains never shape the first line.
pub(super) fn system(context: &Context, entity: &Entity, part: Part) -> String {
    if applies(context, &entity.id, part) {
        return String::new();
    }
    idiolect(entity, part)
}

pub(super) fn lead(context: &Context) -> String {
    if uncovered(context, &context.location) {
        conversation::place(context, "")
    } else {
        String::new()
    }
}

pub(super) fn asked() -> String {
    "What is your first waking thought? One short first-person sentence in your own words, using only the details you know.".into()
}

pub(super) fn transcript(context: &Context, entity: &Entity) -> String {
    let mut facts = vec!["State: waking".to_string()];
    if uncovered(context, &entity.id) {
        facts.push(format!("Known name: {}", name(&entity.id)));
    }
    if uncovered(context, &context.location) {
        facts.push(format!("Known place: {}", name(&context.location)));
    }
    let held: Vec<_> = context
        .outcome
        .iter()
        .flat_map(|o| o.avatars.iter())
        .filter(|a| a.id == entity.id)
        .flat_map(|a| a.holding.iter())
        .filter(|item| uncovered(context, item))
        .map(|item| name(item))
        .collect();
    if !held.is_empty() {
        facts.push(format!("Known holdings: {}", held.join(", ")));
    }
    if let Some(item) = custody::hand_item(context, &entity.id) {
        facts.push(format!("In hand: {}", name(item)));
    }
    facts.join("\n\n")
}

#[cfg(test)]
mod tests {
    use super::super::tests::context;
    use super::*;

    fn waking(covered: &[&str]) -> Context {
        let mut c = context();
        c.waking = true;
        c.speakers = vec!["vale".into()];
        c.covered = covered.iter().map(|id| id.to_string()).collect();
        c
    }

    #[test]
    fn an_uncovered_avatar_wakes_to_an_empty_frame() {
        let c = waking(&["vale", "station", "lamp"]);
        let vale = entity(&c, "vale");
        assert!(applies(&c, "vale", Part::Line));
        assert!(!applies(&c, "vale", Part::Thought));
        assert_eq!(system(&c, vale, Part::Line), "");
        let prompt = transcript_sections(&c, vale, Part::Line)
            .into_iter()
            .map(|(_, line)| line)
            .collect::<Vec<_>>()
            .join("\n");
        assert_eq!(prompt, "State: waking");
        let sent = messages(&c, vale, Part::Line);
        assert_eq!(sent.system, "");
        assert_eq!(sent.lead, "");
        assert_eq!(sent.assistant, "State: waking");
        assert_eq!(sent.user, asked());
        assert_eq!(
            messages(&c, vale, Part::Thought).user,
            crate::ai_gateway::SILENCE
        );
        for word in ["Vale", "Empty station", "Lamp", "lamp", "oil"] {
            assert!(!prompt.contains(word), "{word} in {prompt}");
        }
    }

    #[test]
    fn the_frame_grows_as_cards_are_uncovered() {
        let c = waking(&["vale"]);
        let vale = entity(&c, "vale");
        assert_eq!(
            transcript(&c, vale),
            "State: waking\n\nKnown place: Empty station"
        );
        assert_eq!(system(&c, vale, Part::Line), "");
        let c = waking(&[]);
        let vale = entity(&c, "vale");
        assert_eq!(
            transcript(&c, vale),
            "State: waking\n\nKnown name: Vale\n\nKnown place: Empty station"
        );
        // He knows his name, but his persona waits past waking (#1665).
        assert_eq!(system(&c, vale, Part::Line), "");
        let sent = messages(&c, vale, Part::Line);
        assert!(
            sent.lead.starts_with("You are standing in Empty station."),
            "{}",
            sent.lead
        );
        assert!(sent
            .assistant
            .starts_with("State: waking\n\nKnown name: Vale"));
        assert_eq!(sent.user, asked());
        assert!(!system(&c, vale, Part::Thought).is_empty());
        // Outside the opening, the full conversation frame.
        let mut c = waking(&["station"]);
        c.waking = false;
        let full = super::super::transcript(&c, entity(&c, "vale"), Part::Line);
        assert!(
            full.starts_with("I'm alone here.\nI ask Pip what they want."),
            "{full}"
        );
    }

    #[test]
    fn waking_holdings_describe_only_revealed_items() {
        let mut c = waking(&["lamp"]);
        c.concealed.push("cloth".into());
        c.outcome = serde_json::from_value(json!({
            "card":{"kind":"arrive"},
            "avatars":[{"id":"vale","location":"station","holding":["lamp","cloth"],"heldItem":"lamp"}],
            "items":[
                {"id":"lamp","holder":"vale","location":"station"},
                {"id":"cloth","holder":"vale","location":"station"}
            ]
        })).unwrap();
        let vale = entity(&c, "vale");
        let unseen = messages(&c, vale, Part::Line);
        assert!(!unseen.assistant.contains("Lamp"));
        assert!(!unseen.assistant.contains("cloth"));
        assert!(!unseen.assistant.contains("holdings"));
        c.covered.clear();
        let vale = entity(&c, "vale");
        let seen = messages(&c, vale, Part::Line);
        assert!(seen
            .assistant
            .ends_with("Known holdings: Lamp\n\nIn hand: Lamp"));
        assert!(!seen.assistant.contains("cloth"));
        let reply = "I can feel a little more of the world now.";
        assert_eq!(
            Check::new(&c, vale, Part::Line)
                .verdict(reply, true)
                .unwrap()
                .0,
            reply
        );
    }

    /// Client/server agreement: a new local world, which only Vale plays
    /// since #1895, sends an opening request the route accepts, built by the
    /// browser's real New game rules.
    #[test]
    fn vale_opens_a_valid_local_world() {
        let root = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .parent()
            .unwrap()
            .parent()
            .unwrap();
        let output = std::process::Command::new("node")
            .current_dir(root)
            .args([
                "--input-type=module",
                "-e",
                "import { createLandingWorld } from './v2/card-game/pack-landing.mjs'; \
                 import { narrativeContext } from './v2/card-game/narrative.mjs'; \
                 console.log(JSON.stringify(narrativeContext(createLandingWorld(null, 1))));",
            ])
            .output()
            .expect("Node builds Vale's opening request");
        assert!(
            output.status.success(),
            "{}",
            String::from_utf8_lossy(&output.stderr)
        );
        let context: Context = serde_json::from_slice(&output.stdout).unwrap();
        assert!(valid(&context), "Vale's opening request rejected");
        assert_eq!(context.speakers, ["vale"]);
    }
}
