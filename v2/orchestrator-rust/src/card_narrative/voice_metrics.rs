//! Text-free measurements of each voice call (#1537): approximate prompt
//! tokens by section, attempts, the outcome and each rejection reason.
//!
//! Nothing here stores or logs prompt or reply text. Reasons are the
//! validator's own static labels, so the counters stay bounded.
use super::{Context, Entity, Part};
use serde_json::{json, Map, Value};
use std::{collections::BTreeMap, sync::Mutex};

/// Where a prompt line comes from.
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord)]
pub(super) enum Section {
    /// Idiolect, grown persona and the speech direction.
    System,
    /// The scene line, this turn's events, travel, stance, listener and cue.
    Now,
    /// The entity's own facts and poem lines.
    Facts,
    /// Custody, observation and knowledge directions.
    Directions,
    /// Remembered events ("I remember:").
    Memories,
    /// The speaker's own past lines ("Earlier:").
    Earlier,
    /// Other avatars' recent lines at the table.
    Conversation,
    /// The latest thought, dream and hope.
    Inner,
}

impl Section {
    pub(super) const ALL: [Section; 8] = [
        Section::System,
        Section::Now,
        Section::Facts,
        Section::Directions,
        Section::Memories,
        Section::Earlier,
        Section::Conversation,
        Section::Inner,
    ];

    pub(super) fn label(self) -> &'static str {
        match self {
            Section::System => "system",
            Section::Now => "now",
            Section::Facts => "facts",
            Section::Directions => "directions",
            Section::Memories => "memories",
            Section::Earlier => "earlier",
            Section::Conversation => "conversation",
            Section::Inner => "inner",
        }
    }
}

/// Tag every line with one section.
pub(super) fn tagged(
    section: Section,
    lines: impl IntoIterator<Item = String>,
) -> impl Iterator<Item = (Section, String)> {
    lines.into_iter().map(move |line| (section, line))
}

/// About four characters per token, rounded up. It is a comparison measure,
/// not a provider's count.
pub(super) fn approx_tokens(chars: usize) -> u64 {
    (chars as u64).div_ceil(4)
}

/// Approximate prompt tokens for one call, by section.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub(super) struct Budget([u64; 9]);

impl Budget {
    /// Measure the first attempt's prompt: the system text and the tagged
    /// transcript lines, each line with its newline.
    pub(super) fn measure(system: &str, context: &Context, entity: &Entity, part: Part) -> Self {
        Self::of(system, &super::transcript_sections(context, entity, part))
    }

    pub(super) fn of(system: &str, lines: &[(Section, String)]) -> Self {
        let mut chars = [0usize; 9];
        chars[Section::System as usize] = system.chars().count();
        for (section, line) in lines {
            chars[*section as usize] += line.chars().count() + 1;
        }
        Self(chars.map(approx_tokens))
    }

    pub(super) fn get(&self, section: Section) -> u64 {
        self.0[section as usize]
    }

    pub(super) fn total(&self) -> u64 {
        self.0.iter().sum()
    }
}

/// How one call ended.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(super) enum Outcome {
    /// A reply passed every check.
    Spoken,
    /// A reply passed every check except telling its fact.
    Untold,
    /// No reply passed; the entity stays silent.
    Silent,
    /// The scene deadline or a closed client dropped the call.
    Cancelled,
}

impl Outcome {
    fn label(self) -> &'static str {
        match self {
            Outcome::Spoken => "spoken",
            Outcome::Untold => "untold",
            Outcome::Silent => "silent",
            Outcome::Cancelled => "cancelled",
        }
    }
}

/// The play kinds a scene can name; anything else counts as "other".
const PLAYS: [&str; 19] = [
    "arrive",
    "wait",
    "move",
    "course",
    "accompany",
    "talk",
    "ask",
    "take",
    "drop",
    "give",
    "trade",
    "light",
    "snuff",
    "ring",
    "cover",
    "threaten",
    "guard",
    "attack",
    "choose",
];

/// The narrator's fixed speech occasions (narrative.mjs `SPEECH_OCCASIONS`).
const OCCASIONS: [&str; 13] = [
    "talk",
    "refused",
    "want_met",
    "first_meeting",
    "threatened",
    "defeat",
    "companion",
    "battle_wait",
    "long_rest",
    "thought_due",
    "new_place",
    "signal_echo",
    "opening",
];

/// The static label for a known occasion name.
pub(super) fn occasion_label(name: &str) -> Option<&'static str> {
    OCCASIONS.iter().copied().find(|known| *known == name)
}

/// The play kind a scene answers: its outcome card, or the opening.
fn play_label(context: &Context) -> &'static str {
    match context.outcome.as_ref() {
        Some(outcome) => PLAYS
            .iter()
            .copied()
            .find(|kind| *kind == outcome.card.kind)
            .unwrap_or("other"),
        None if context.turn == 0 => "opening",
        None => "none",
    }
}

/// Calls and spoken replies under one label.
#[derive(Debug, Default, serde::Serialize)]
struct Tally {
    calls: u64,
    spoken: u64,
}

/// Aggregate counters since this process started.
#[derive(Debug, Default)]
pub(super) struct Totals {
    calls: u64,
    attempts: u64,
    outcomes: BTreeMap<&'static str, u64>,
    rejections: BTreeMap<&'static str, u64>,
    tokens: [u64; 9],
    max_tokens: u64,
    plays: BTreeMap<&'static str, Tally>,
    occasions: BTreeMap<&'static str, Tally>,
}

impl Totals {
    const fn new() -> Self {
        Self {
            calls: 0,
            attempts: 0,
            outcomes: BTreeMap::new(),
            rejections: BTreeMap::new(),
            tokens: [0; 9],
            max_tokens: 0,
            plays: BTreeMap::new(),
            occasions: BTreeMap::new(),
        }
    }

    pub(super) fn record(
        &mut self,
        labels: Labels,
        budget: &Budget,
        attempts: u8,
        outcome: Outcome,
        reasons: &[&'static str],
    ) {
        let spoken = u64::from(matches!(outcome, Outcome::Spoken | Outcome::Untold));
        for tally in [
            self.plays.entry(labels.play).or_default(),
            self.occasions.entry(labels.occasion).or_default(),
        ] {
            tally.calls += 1;
            tally.spoken += spoken;
        }
        self.calls += 1;
        self.attempts += u64::from(attempts);
        *self.outcomes.entry(outcome.label()).or_default() += 1;
        for reason in reasons {
            *self.rejections.entry(reason).or_default() += 1;
        }
        for (sum, value) in self.tokens.iter_mut().zip(budget.0) {
            *sum += value;
        }
        self.max_tokens = self.max_tokens.max(budget.total());
    }

    pub(super) fn snapshot(&self) -> Value {
        let calls = self.calls.max(1);
        let mut sections = Map::new();
        for section in Section::ALL {
            sections.insert(
                section.label().into(),
                json!(self.tokens[section as usize] / calls),
            );
        }
        let total: u64 = self.tokens.iter().sum();
        json!({
            "calls": self.calls,
            "attempts": self.attempts,
            "outcomes": self.outcomes,
            "rejections": self.rejections,
            "by_play": self.plays,
            "by_occasion": self.occasions,
            "prompt_tokens": {
                "approximate": true,
                "mean": total / calls,
                "max": self.max_tokens,
                "mean_by_section": sections,
            },
        })
    }
}

static TOTALS: Mutex<Totals> = Mutex::new(Totals::new());

/// The process's voice-call counters, for `/meta`.
pub(crate) fn snapshot() -> Value {
    TOTALS
        .lock()
        .map(|totals| totals.snapshot())
        .unwrap_or_else(|_| json!({"calls": 0}))
}

struct State {
    attempts: u8,
    reasons: Vec<&'static str>,
    outcome: Option<Outcome>,
}

/// The play kind and speech occasion a call answers.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(super) struct Labels {
    play: &'static str,
    occasion: &'static str,
}

impl Default for Labels {
    fn default() -> Self {
        Self {
            play: "none",
            occasion: "none",
        }
    }
}

impl Labels {
    pub(super) fn of(context: &Context) -> Self {
        Self {
            play: play_label(context),
            occasion: context
                .occasion
                .as_deref()
                .and_then(occasion_label)
                .unwrap_or("none"),
        }
    }
}

/// One voice call being measured. It is logged and counted once, when it
/// is dropped, so a call cancelled at the scene deadline still counts.
pub(super) struct Call<'a> {
    entity: &'a str,
    part: Part,
    budget: Budget,
    labels: Labels,
    state: Mutex<State>,
}

impl<'a> Call<'a> {
    pub(super) fn new(entity: &'a str, part: Part, budget: Budget) -> Self {
        Self {
            entity,
            part,
            budget,
            labels: Labels::default(),
            state: Mutex::new(State {
                attempts: 0,
                reasons: Vec::new(),
                outcome: None,
            }),
        }
    }

    /// Label the call with the scene's play kind and speech occasion.
    pub(super) fn labelled(mut self, context: &Context) -> Self {
        self.labels = Labels::of(context);
        self
    }

    fn with(&self, change: impl FnOnce(&mut State)) {
        if let Ok(mut state) = self.state.lock() {
            change(&mut state);
        }
    }

    pub(super) fn attempt(&self) {
        self.with(|state| state.attempts = state.attempts.saturating_add(1));
    }

    /// Keep each attempt's reason; attempts are few, so this stays small.
    pub(super) fn reject(&self, reason: &'static str) {
        self.with(|state| {
            if state.reasons.len() < 8 {
                state.reasons.push(reason);
            }
        });
    }

    pub(super) fn finish(&self, outcome: Outcome) {
        self.with(|state| state.outcome = Some(outcome));
    }
}

impl Drop for Call<'_> {
    fn drop(&mut self) {
        let Ok(state) = self.state.lock() else {
            return;
        };
        let outcome = state.outcome.unwrap_or(Outcome::Cancelled);
        // An attempt with no reason and no reply ran out of time.
        let mut reasons = state.reasons.clone();
        let explained = reasons.len() + usize::from(outcome == Outcome::Spoken);
        for _ in explained..usize::from(state.attempts) {
            if reasons.len() < 8 {
                reasons.push("timeout");
            }
        }
        let b = &self.budget;
        tracing::info!(
            feature = "card_voice",
            entity = self.entity,
            part = ?self.part,
            play = self.labels.play,
            occasion = self.labels.occasion,
            attempts = state.attempts,
            outcome = outcome.label(),
            reasons = %reasons.join(","),
            tokens = b.total(),
            system = b.get(Section::System),
            now = b.get(Section::Now),
            facts = b.get(Section::Facts),
            directions = b.get(Section::Directions),
            memories = b.get(Section::Memories),
            earlier = b.get(Section::Earlier),
            conversation = b.get(Section::Conversation),
            inner = b.get(Section::Inner),
            "card voice call"
        );
        if let Ok(mut totals) = TOTALS.lock() {
            totals.record(self.labels, &self.budget, state.attempts, outcome, &reasons);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn budgets_split_by_section_and_counters_hold_no_text() {
        let lines = vec![
            (Section::Facts, "Vale: I keep the lamp low.".to_string()),
            (Section::Now, "Just now: Vale rings the bell.".to_string()),
            (Section::Earlier, "Earlier: Vale: Hello.".to_string()),
        ];
        let budget = Budget::of("I am Vale.", &lines);
        assert_eq!(budget.get(Section::System), 3);
        assert_eq!(budget.get(Section::Facts), 7);
        assert_eq!(budget.get(Section::Earlier), 6);
        assert_eq!(budget.get(Section::Conversation), 0);
        assert_eq!(budget.total(), 3 + 7 + 8 + 6);
        let mut totals = Totals::new();
        let wait = Labels {
            play: "wait",
            occasion: "thought_due",
        };
        totals.record(wait, &budget, 2, Outcome::Spoken, &["repeat"]);
        totals.record(
            Labels::default(),
            &budget,
            3,
            Outcome::Silent,
            &["repeat", "custody", "shape"],
        );
        let value = totals.snapshot();
        assert_eq!(value["calls"], 2);
        assert_eq!(value["attempts"], 5);
        assert_eq!(value["outcomes"]["silent"], 1);
        assert_eq!(value["rejections"]["repeat"], 2);
        assert_eq!(value["prompt_tokens"]["mean_by_section"]["earlier"], 6);
        assert_eq!(value["prompt_tokens"]["max"], 24);
        assert_eq!(value["by_play"]["wait"], json!({"calls": 1, "spoken": 1}));
        assert_eq!(
            value["by_occasion"]["none"],
            json!({"calls": 1, "spoken": 0})
        );
        assert!(!value.to_string().contains("Vale"));
    }

    #[test]
    fn calls_are_labelled_with_the_play_and_a_known_occasion() {
        let mut context = super::super::tests::context();
        assert!(super::super::valid(&context));
        assert_eq!(Labels::of(&context), Labels::default());
        context.occasion = Some("thought_due".into());
        assert_eq!(Labels::of(&context).occasion, "thought_due");
        assert!(super::super::valid(&context));
        context.turn = 0;
        assert_eq!(Labels::of(&context).play, "opening");
        context.occasion = Some("chatter".into());
        assert_eq!(Labels::of(&context).occasion, "none");
        assert!(!super::super::valid(&context));
    }
}
