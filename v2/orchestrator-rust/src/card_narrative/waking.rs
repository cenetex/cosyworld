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

/// Whether the speaker's player has uncovered the speaker's own card.
pub(super) fn knows_self(context: &Context, id: &str) -> bool {
    !context.covered.iter().any(|c| c == id)
}

/// The system voice: none while waking, even once the speaker's own card is
/// uncovered, so the persona's wants and bargains never shape the first line.
pub(super) fn system(context: &Context, entity: &Entity, part: Part) -> String {
    if applies(context, &entity.id, part) {
        return String::new();
    }
    idiolect(entity, part)
}

/// The transcript tag: the speaker's name once known, else "Me".
pub(super) fn own(context: &Context, id: &str) -> String {
    if knows_self(context, id) {
        name(id)
    } else {
        "Me".into()
    }
}

/// The waking frame: one line of waking, then each uncovered thing.
pub(super) fn transcript(context: &Context, entity: &Entity) -> String {
    let mut lines = vec!["I'm waking up.".to_string()];
    if !context.covered.contains(&context.location) {
        lines.push(format!("Here: {}.", name(&context.location)));
    }
    let held: Vec<_> = context
        .outcome
        .iter()
        .flat_map(|o| o.avatars.iter())
        .filter(|a| a.id == entity.id)
        .flat_map(|a| a.holding.iter())
        .filter(|item| !context.covered.contains(item))
        .map(|item| name(item))
        .collect();
    if !held.is_empty() {
        lines.push(format!("In my hands: {}.", held.join(", ")));
    }
    lines.push(String::new());
    lines.push(format!("{}:", own(context, &entity.id)));
    lines.join("\n")
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
        assert_eq!(prompt, "I'm waking up.\n\nMe:");
        for word in ["Vale", "Empty station", "Lamp", "lamp", "oil"] {
            assert!(!prompt.contains(word), "{word} in {prompt}");
        }
        // A retry keeps the same raw frame rather than adding a direction.
        assert_eq!(attempt_transcript(&c, vale, Part::Line, 1), prompt);
    }

    #[test]
    fn the_frame_grows_as_cards_are_uncovered() {
        let c = waking(&["vale"]);
        let vale = entity(&c, "vale");
        assert_eq!(
            transcript(&c, vale),
            "I'm waking up.\nHere: Empty station.\n\nMe:"
        );
        assert_eq!(system(&c, vale, Part::Line), "");
        let c = waking(&[]);
        let vale = entity(&c, "vale");
        assert!(transcript(&c, vale).ends_with("Here: Empty station.\n\nVale:"));
        // His name joins the cue, but his persona waits past waking (#1665).
        assert_eq!(system(&c, vale, Part::Line), "");
        assert!(!system(&c, vale, Part::Thought).is_empty());
        // Outside the opening, the full scene frame is unchanged.
        let mut c = waking(&["station"]);
        c.waking = false;
        let full = super::super::transcript(&c, entity(&c, "vale"), Part::Line);
        assert!(full.contains("Current scene:"));
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
