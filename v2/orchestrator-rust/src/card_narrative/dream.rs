//! Dreams run raw: no system voice, scene, persona or hope. Earlier dreams
//! lead into the next one, and sometimes a thought, a scrap of memory or a
//! face from the day drifts in. The dreamer, turn and memories seed every
//! choice, so the same saved scene always dreams from the same material.
use super::*;

/// A small, stable mix of the dreamer, the turn and a salt.
fn roll(id: &str, turn: u64, salt: u64) -> u64 {
    let mut h = 0xcbf2_9ce4_8422_2325_u64 ^ turn.wrapping_mul(0x9e37_79b9_7f4a_7c15) ^ salt;
    for byte in id.bytes() {
        h = (h ^ u64::from(byte)).wrapping_mul(0x0100_0000_01b3);
    }
    h ^ (h >> 29)
}

/// A few consecutive words from a memory, as a dream half-remembers them.
fn fragment(text: &str, seed: u64) -> Option<String> {
    let text = text.strip_prefix("World: ").unwrap_or(text);
    let words: Vec<_> = text.split_whitespace().collect();
    if words.len() < 3 {
        return None;
    }
    let len = (3 + seed % 4).min(words.len() as u64) as usize;
    let start = (seed >> 8) as usize % (words.len() - len + 1);
    Some(
        words[start..start + len]
            .join(" ")
            .trim_matches(|c: char| !c.is_alphanumeric())
            .to_string(),
    )
    .filter(|f| !f.is_empty())
}

/// Someone's seed sentence, as a dream half-remembers a face (#1673).
fn sketch(id: &str) -> String {
    seed_sentence(id).trim_end_matches('.').to_string()
}

pub(super) fn transcript(context: &Context, entity: &Entity) -> String {
    let id = entity.id.as_str();
    let own = name(id);
    let turn = context.turn;
    let life = entity.inner_life.as_ref();
    let mut lines = Vec::new();
    let known = known(context);
    // Every kept dream, oldest first, so each one can lead into the next.
    // One that names a thing the scene does not know stays out (#1850).
    for dream in life
        .into_iter()
        .flat_map(|l| &l.dreams)
        .filter(|d| grounded(&d.text, &known))
    {
        lines.push(format!("{own}, an earlier dream: {}", dream.text));
    }
    let mut drift = Vec::new();
    if let Some(thought) = life
        .and_then(|l| l.thoughts.last())
        .filter(|t| roll(id, turn, 1).is_multiple_of(2) && grounded(&t.text, &known))
    {
        drift.push(format!("{own}, to myself: {}", thought.text));
    }
    let memories: Vec<_> = entity.memories.iter().collect();
    for salt in 0..roll(id, turn, 2) % 3 {
        if memories.is_empty() {
            break;
        }
        let seed = roll(id, turn, 10 + salt);
        let memory = memories[seed as usize % memories.len()];
        if let Some(scrap) = fragment(&memory.text, seed >> 4) {
            if !drift.iter().any(|d: &String| d.contains(&scrap)) {
                drift.push(format!("… {scrap} …"));
            }
        }
    }
    let met: Vec<_> = context
        .entities
        .iter()
        .filter(|e| e.id != id && kind(&e.id, "avatar"))
        .filter(|e| !roll(&e.id, turn, 3).is_multiple_of(3))
        .map(|e| sketch(&e.id))
        .take(2)
        .collect();
    drift.extend(met);
    // Drifting material arrives in no particular order.
    drift.sort_by_key(|line| roll(line, turn, 4));
    lines.extend(drift);
    lines.push(cue(&own, Part::Dream));
    lines.join("\n")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn dreams_are_raw_and_lead_from_earlier_dreams() {
        let mut c = super::super::tests::context();
        let vale = c.entities.iter().position(|e| e.id == "vale").unwrap();
        c.turn = 40;
        c.entities[vale].memories.push(Memory {
            seq: Some(3),
            turn: 39,
            kind: "event".into(),
            text: "Pip carried the lamp across the black pond at dusk.".into(),
        });
        c.entities[vale].inner_life = Some(InnerLife {
            persona: Some("PERSONA SENTINEL".into()),
            thoughts: vec![InnerMoment {
                turn: 30,
                text: "The pond hums.".into(),
            }],
            dreams: vec![
                InnerMoment {
                    turn: 5,
                    text: "A staircase grew feathers.".into(),
                },
                InnerMoment {
                    turn: 20,
                    text: "The feathers became trains.".into(),
                },
                InnerMoment {
                    turn: 30,
                    text: "The storybook map's right here.".into(),
                },
            ],
        });
        c.entities[vale].hope = Some(Hope {
            wish: "HOPE SENTINEL".into(),
            next: "NEXT SENTINEL".into(),
        });
        let prompt = transcript(&c, &c.entities[vale]);
        assert_eq!(
            prompt,
            transcript(&c, &c.entities[vale]),
            "seeded, not random per call"
        );
        assert!(prompt.ends_with("Vale, last night's dream:"));
        let staircase = prompt.find("A staircase grew feathers.").unwrap();
        assert!(staircase < prompt.find("The feathers became trains.").unwrap());
        for absent in [
            "PERSONA SENTINEL",
            "HOPE SENTINEL",
            // A retired item in an old save does not return (#1850).
            "storybook map",
            "Current scene:",
            "voice samples",
        ] {
            assert!(!prompt.contains(absent), "{absent} leaked into {prompt}");
        }
        assert!(idiolect(&c.entities[vale], Part::Dream).is_empty());
        // Across turns the drifting material changes.
        let variants: BTreeSet<_> = (40..60)
            .map(|turn| {
                c.turn = turn;
                transcript(&c, &c.entities[vale])
            })
            .collect();
        assert!(variants.len() > 3);
        assert!(
            variants.iter().any(|p| p.contains("…")),
            "memory scraps sometimes surface"
        );
    }
}
