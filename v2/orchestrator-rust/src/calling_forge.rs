#[cfg(test)]
use super::*;

#[derive(Clone, Copy, Debug)]
pub(super) struct CallingVerb {
    pub(super) id: &'static str,
    pub(super) label: &'static str,
    pub(super) prefix: &'static str,
}

#[derive(Clone, Copy, Debug)]
pub(super) struct CallingObject {
    pub(super) id: &'static str,
    pub(super) label: &'static str,
    pub(super) phrase: &'static str,
}

#[derive(Clone, Copy, Debug)]
pub(super) struct CallingStake {
    pub(super) id: &'static str,
    pub(super) label: &'static str,
    pub(super) phrase: &'static str,
}

#[derive(Clone, Debug)]
pub(super) struct CallingCandidate {
    pub(super) verb: CallingVerb,
    pub(super) object: CallingObject,
    pub(super) stake: Option<CallingStake>,
    pub(super) statement: String,
}

const CALLING_VERBS: &[CallingVerb] = &[
    CallingVerb {
        id: "tend",
        label: "Tend",
        prefix: "I tend",
    },
    CallingVerb {
        id: "mend",
        label: "Mend",
        prefix: "I mend",
    },
    CallingVerb {
        id: "guard",
        label: "Guard",
        prefix: "I guard",
    },
    CallingVerb {
        id: "listen_for",
        label: "Listen for",
        prefix: "I listen for",
    },
    CallingVerb {
        id: "keep",
        label: "Keep",
        prefix: "I keep",
    },
    CallingVerb {
        id: "clear",
        label: "Clear",
        prefix: "I clear",
    },
    CallingVerb {
        id: "carry",
        label: "Carry",
        prefix: "I carry",
    },
    CallingVerb {
        id: "remember",
        label: "Remember",
        prefix: "I remember",
    },
    CallingVerb {
        id: "follow",
        label: "Follow",
        prefix: "I follow",
    },
    CallingVerb {
        id: "gather",
        label: "Gather",
        prefix: "I gather",
    },
    CallingVerb {
        id: "steady",
        label: "Steady",
        prefix: "I steady",
    },
    CallingVerb {
        id: "watch_over",
        label: "Watch over",
        prefix: "I watch over",
    },
];

const CALLING_OBJECTS: &[CallingObject] = &[
    CallingObject {
        id: "rain_changed",
        label: "what the rain changed",
        phrase: "what the rain has changed",
    },
    CallingObject {
        id: "breaking",
        label: "what is breaking",
        phrase: "what is breaking before it breaks",
    },
    CallingObject {
        id: "quiet_ones",
        label: "the quiet ones",
        phrase: "the quiet ones nobody remembers",
    },
    CallingObject {
        id: "odd_jobs",
        label: "odd jobs",
        phrase: "odd jobs nobody else wants",
    },
    CallingObject {
        id: "road_home",
        label: "the road home",
        phrase: "the road home",
    },
    CallingObject {
        id: "lost_things",
        label: "lost things",
        phrase: "lost things that still want finding",
    },
    CallingObject {
        id: "small_kindnesses",
        label: "small kindnesses",
        phrase: "small kindnesses that run low on time",
    },
    CallingObject {
        id: "lamplight",
        label: "the last lamplight",
        phrase: "the last honest lamplight",
    },
    CallingObject {
        id: "stories",
        label: "unwritten stories",
        phrase: "the stories no one else writes down",
    },
    CallingObject {
        id: "paths",
        label: "mistrusted paths",
        phrase: "the path other people stop trusting",
    },
    CallingObject {
        id: "kettle",
        label: "the kettle",
        phrase: "the kettle and whoever is waiting",
    },
    CallingObject {
        id: "weather",
        label: "the weather",
        phrase: "the weather behind every warning",
    },
    CallingObject {
        id: "promises",
        label: "frayed promises",
        phrase: "frayed promises that can still hold",
    },
    CallingObject {
        id: "garden",
        label: "the garden",
        phrase: "the garden between storms",
    },
    CallingObject {
        id: "fire",
        label: "what the fire keeps",
        phrase: "what the fire keeps when it runs low",
    },
    CallingObject {
        id: "errands",
        label: "strangers' errands",
        phrase: "strangers' errands when they look lost",
    },
];

const CALLING_STAKES: &[CallingStake] = &[
    CallingStake {
        id: "dark",
        label: "before the dark",
        phrase: "before someone is left in the dark",
    },
    CallingStake {
        id: "unwatched",
        label: "unwatched",
        phrase: "even when no one is watching",
    },
    CallingStake {
        id: "holds",
        label: "until it holds",
        phrase: "until it holds",
    },
    CallingStake {
        id: "unasked",
        label: "unasked",
        phrase: "without being asked",
    },
    CallingStake {
        id: "hurry",
        label: "while others hurry",
        phrase: "while others hurry past",
    },
    CallingStake {
        id: "own_hurry",
        label: "against hurry",
        phrase: "against my own hurry",
    },
    CallingStake {
        id: "traveler",
        label: "for the next traveler",
        phrase: "so the next traveler can trust it",
    },
    CallingStake {
        id: "rain",
        label: "before the rain",
        phrase: "before the next rain",
    },
];

fn render_calling(
    verb: &CallingVerb,
    object: &CallingObject,
    stake: Option<&CallingStake>,
) -> String {
    match stake {
        Some(stake) => format!("{} {} {}.", verb.prefix, object.phrase, stake.phrase),
        None => format!("{} {}.", verb.prefix, object.phrase),
    }
}

pub(super) fn is_calling_forge_statement(statement: &str) -> bool {
    CALLING_VERBS.iter().any(|verb| {
        CALLING_OBJECTS.iter().any(|object| {
            render_calling(verb, object, None) == statement
                || CALLING_STAKES
                    .iter()
                    .any(|stake| render_calling(verb, object, Some(stake)) == statement)
        })
    })
}

pub(super) fn calling_candidates(seed: u64, actor_id: u64) -> Vec<CallingCandidate> {
    let mut out = Vec::with_capacity(3);
    let mut seen = std::collections::HashSet::new();
    let base = seed ^ actor_id.wrapping_mul(0x9E37_79B9_7F4A_7C15);
    for slot in 0u64..64u64 {
        if out.len() >= 3 {
            break;
        }
        let salt = slot.wrapping_mul(0xD1B5_4A32_D192_ED03);
        let verb = &CALLING_VERBS[deterministic_index(base, salt ^ 0xA5, CALLING_VERBS.len())];
        let object =
            &CALLING_OBJECTS[deterministic_index(base, salt ^ 0xB3, CALLING_OBJECTS.len())];
        let stake_slot = deterministic_index(base, salt ^ 0xC1, CALLING_STAKES.len() + 1);
        let stake = if stake_slot == 0 {
            None
        } else {
            Some(&CALLING_STAKES[stake_slot - 1])
        };
        let statement = render_calling(verb, object, stake);
        if seen.insert(statement.clone()) {
            out.push(CallingCandidate {
                verb: *verb,
                object: *object,
                stake: stake.cloned(),
                statement,
            });
        }
    }
    out
}

fn deterministic_index(base: u64, salt: u64, len: usize) -> usize {
    (mix64(base ^ salt) as usize) % len
}

fn mix64(mut x: u64) -> u64 {
    x = x.wrapping_add(0x9E37_79B9_7F4A_7C15);
    x = (x ^ (x >> 30)).wrapping_mul(0xBF58_476D_1CE4_E5B9);
    x = (x ^ (x >> 27)).wrapping_mul(0x94D0_49BB_1331_11EB);
    x ^ (x >> 31)
}

#[derive(Clone, Copy, Debug)]
struct BondVerb {
    id: &'static str,
    _label: &'static str,
    i_to_them: &'static str,
    them_to_me: &'static str,
    mutual: &'static str,
}

const BOND_VERBS: &[BondVerb] = &[
    BondVerb {
        id: "keep_faith",
        _label: "keep faith",
        i_to_them: "keep faith with",
        them_to_me: "keeps faith with",
        mutual: "keep faith with each other",
    },
    BondVerb {
        id: "keep_an_eye",
        _label: "keep an eye out for",
        i_to_them: "keep an eye out for",
        them_to_me: "keeps an eye out for",
        mutual: "keep an eye out for each other",
    },
    BondVerb {
        id: "make_room",
        _label: "make room for",
        i_to_them: "make room for",
        them_to_me: "makes room for",
        mutual: "make room for each other",
    },
    BondVerb {
        id: "do_right",
        _label: "do right by",
        i_to_them: "do right by",
        them_to_me: "does right by",
        mutual: "do right by each other",
    },
    BondVerb {
        id: "watch_over",
        _label: "watch over",
        i_to_them: "watch over",
        them_to_me: "watches over",
        mutual: "watch over each other",
    },
    BondVerb {
        id: "remember",
        _label: "remember",
        i_to_them: "remember",
        them_to_me: "remembers",
        mutual: "remember each other",
    },
    BondVerb {
        id: "look_out",
        _label: "look out for",
        i_to_them: "look out for",
        them_to_me: "looks out for",
        mutual: "look out for each other",
    },
];

#[derive(Clone, Debug)]
pub(super) struct BondProposal {
    pub(super) shape: &'static str,
    pub(super) label: &'static str,
    pub(super) statement: String,
}

impl BondProposal {
    const SHAPES: [(&'static str, &'static str); 3] = [
        ("i_to_them", "How I feel about them"),
        ("them_to_me", "How they feel about me"),
        ("mutual", "What we share"),
    ];
}

pub(super) fn bond_proposals(me: &str, them: &str, fact: &str, seed: u64) -> [BondProposal; 3] {
    let verb = &BOND_VERBS[(mix64(seed ^ 0xB0_5D) as usize) % BOND_VERBS.len()];
    let (i_to_them_shape, i_to_them_label) = BondProposal::SHAPES[0];
    let (them_to_me_shape, them_to_me_label) = BondProposal::SHAPES[1];
    let (mutual_shape, mutual_label) = BondProposal::SHAPES[2];
    [
        BondProposal {
            shape: i_to_them_shape,
            label: i_to_them_label,
            statement: format!("I {} {} because {}.", verb.i_to_them, them, fact),
        },
        BondProposal {
            shape: them_to_me_shape,
            label: them_to_me_label,
            statement: format!("{} {} me because {}.", them, verb.them_to_me, fact),
        },
        BondProposal {
            shape: mutual_shape,
            label: mutual_label,
            statement: format!("{} and {} {} because {}.", me, them, verb.mutual, fact),
        },
    ]
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn composed_callings_stay_inside_the_statement_limit() {
        for verb in CALLING_VERBS {
            for object in CALLING_OBJECTS {
                assert!(
                    render_calling(verb, object, None).chars().count()
                        <= MAX_CALLING_STATEMENT_CHARS
                );
                for stake in CALLING_STAKES {
                    assert!(
                        render_calling(verb, object, Some(stake)).chars().count()
                            <= MAX_CALLING_STATEMENT_CHARS
                    );
                }
            }
        }
    }

    #[test]
    fn composed_space_is_rich_and_distinct() {
        let mut seen = std::collections::HashSet::new();
        let mut count = 0usize;
        for verb in CALLING_VERBS {
            for object in CALLING_OBJECTS {
                for stake in std::iter::once(None).chain(CALLING_STAKES.iter().map(Some)) {
                    let statement = render_calling(verb, object, stake);
                    assert!(
                        seen.insert(statement.clone()),
                        "duplicate forged statement: {statement}"
                    );
                    count += 1;
                }
            }
        }
        assert_eq!(
            count,
            CALLING_VERBS.len() * CALLING_OBJECTS.len() * (1 + CALLING_STAKES.len())
        );
        assert!(count > 1000);
    }

    #[test]
    fn candidates_are_deterministic_and_distinct() {
        let first = calling_candidates(42, 5000);
        let second = calling_candidates(42, 5000);
        assert_eq!(first.len(), 3);
        assert_eq!(second.len(), 3);
        assert!(
            first
                .iter()
                .zip(second.iter())
                .all(|(a, b)| a.statement == b.statement),
            "same seed must produce identical candidates"
        );
        let mut statements = std::collections::HashSet::new();
        for candidate in &first {
            assert!(
                statements.insert(candidate.statement.clone()),
                "candidates must be distinct"
            );
        }
    }

    #[test]
    fn every_candidate_is_a_member_of_the_forge_vocabulary() {
        for candidate in calling_candidates(7, 8000) {
            assert!(is_calling_forge_statement(&candidate.statement));
        }
    }

    #[test]
    fn legacy_calling_statements_remain_authoritatively_valid() {
        for statement in AUTHORED_CALLING_STATEMENTS {
            assert_eq!(
                authored_calling_statement(statement),
                Some((*statement).to_string()),
                "legacy calling must survive the forge superset: {statement}"
            );
        }
    }

    #[test]
    fn forge_composed_callings_are_authoritatively_valid() {
        let candidate = &calling_candidates(11, 9000)[0];
        assert_eq!(
            authored_calling_statement(&candidate.statement),
            Some(candidate.statement.clone())
        );
    }

    #[test]
    fn free_text_never_sneaks_into_the_forge_vocabulary() {
        assert!(!is_calling_forge_statement("I type whatever I feel like."));
        assert!(!is_calling_forge_statement(
            "I kept a dragon in my pocket, actually."
        ));
    }

    #[test]
    fn bond_proposals_render_all_three_directions() {
        let proposals = bond_proposals("Moss", "Mara Wick", "we traded the brass key", 3);
        assert_eq!(proposals.len(), 3);
        let shapes: Vec<_> = proposals.iter().map(|p| p.shape).collect();
        assert!(shapes.contains(&"i_to_them"));
        assert!(shapes.contains(&"them_to_me"));
        assert!(shapes.contains(&"mutual"));
        for proposal in &proposals {
            assert!(
                proposal.statement.contains("Mara Wick"),
                "statement must name the other actor"
            );
            assert!(
                proposal.statement.contains("brass key"),
                "statement must remember the shared fact"
            );
            assert!(proposal.statement.ends_with('.'));
            assert!(proposal.statement.chars().count() <= MAX_BOND_STATEMENT_CHARS);
        }
        assert!(proposals[0].statement.starts_with("I "));
        assert!(proposals[1].statement.starts_with("Mara Wick "));
        assert!(proposals[2].statement.starts_with("Moss and Mara Wick "));
    }

    #[test]
    fn bond_proposals_are_deterministic_per_fact_and_seed() {
        let a = bond_proposals("Moss", "Mara Wick", "we traded the brass key", 3);
        let b = bond_proposals("Moss", "Mara Wick", "we traded the brass key", 3);
        assert!(a
            .iter()
            .zip(b.iter())
            .all(|(x, y)| x.statement == y.statement));
    }
}
