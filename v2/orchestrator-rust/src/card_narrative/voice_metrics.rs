//! Text-free measurements of each voice call (#1537): approximate prompt
//! tokens by section, attempts, the outcome and each rejection reason.
//!
//! Nothing here stores or logs prompt or reply text. Reasons are the
//! validator's own static labels, so the counters stay bounded.
use super::{Context, Entity, Part};
use crate::ai_gateway::AiGatewayError;
use serde_json::{json, Map, Value};
use std::{
    collections::{BTreeMap, VecDeque},
    sync::{
        atomic::{AtomicU64, Ordering},
        Mutex,
    },
    time::{Instant, SystemTime, UNIX_EPOCH},
};

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
    /// A conversation turn's frame is in its system message and the answered
    /// line is its user message; both count by section all the same.
    pub(super) fn measure(system: &str, context: &Context, entity: &Entity, part: Part) -> Self {
        let mut lines = super::transcript_sections(context, entity, part);
        if super::conversation::applies(context, entity, part) {
            lines.push((
                Section::Conversation,
                super::conversation::user(context, entity),
            ));
        }
        Self::of(system, &lines)
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
    /// No reply passed; the entity stays silent.
    Silent,
    /// The scene deadline or a closed client dropped the call.
    Cancelled,
}

impl Outcome {
    pub(super) fn label(self) -> &'static str {
        match self {
            Outcome::Spoken => "spoken",
            Outcome::Silent => "silent",
            Outcome::Cancelled => "cancelled",
        }
    }
}

/// The play kinds a scene can name; anything else counts as "other".
const PLAYS: [&str; 21] = [
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
    "eat",
    "light",
    "snuff",
    "ring",
    "cover",
    "threaten",
    "guard",
    "attack",
    "choose",
    "read",
];

/// The narrator's fixed speech occasions (narrative.mjs `SPEECH_OCCASIONS`).
const OCCASIONS: [&str; 15] = [
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
    "first_wait",
    "action",
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
        None if context.turn == 0 || context.waking => "opening",
        None => "none",
    }
}

/// Calls and spoken replies under one label.
#[derive(Debug, Default, serde::Serialize)]
struct Tally {
    calls: u64,
    spoken: u64,
}

/// Calls by outcome under one registry model or provider.
#[derive(Debug, Default, serde::Serialize)]
struct Mix {
    calls: u64,
    attempts: u64,
    spoken: u64,
    silent: u64,
    cancelled: u64,
    /// Calls that reached this model after an earlier one in the chain failed.
    fallbacks: u64,
    rejections: BTreeMap<&'static str, u64>,
}

#[derive(Clone, Copy, serde::Serialize)]
struct ProviderFailure {
    code: &'static str,
    #[serde(skip_serializing_if = "Option::is_none")]
    response_detail: Option<&'static str>,
}

const RECENT_OUTCOMES: usize = 64;
const MAX_ATTEMPTS: usize = 8;
static NEXT_CALL: AtomicU64 = AtomicU64::new(1);

#[derive(serde::Serialize)]
struct AttemptTrace {
    attempt: u8,
    model: String,
    provider: String,
    fallback: bool,
    ended_at_unix_ms: u64,
    elapsed_ms: u64,
    outcome: &'static str,
    #[serde(skip_serializing_if = "Option::is_none")]
    reason: Option<&'static str>,
    #[serde(skip_serializing_if = "Option::is_none")]
    finish: Option<&'static str>,
    #[serde(skip_serializing_if = "Option::is_none")]
    failure: Option<ProviderFailure>,
}

#[derive(serde::Serialize)]
struct CallTrace {
    call_id: u64,
    entity: String,
    part: &'static str,
    play: &'static str,
    occasion: &'static str,
    ended_at_unix_ms: u64,
    elapsed_ms: u64,
    outcome: &'static str,
    model: String,
    provider: String,
    reasons: Vec<&'static str>,
    flags: Vec<&'static str>,
    attempts: Vec<AttemptTrace>,
}

fn unix_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |duration| duration.as_millis() as u64)
}

fn finish_label(value: &str) -> &'static str {
    match value {
        "stop" => "stop",
        "end_turn" => "end_turn",
        "length" => "length",
        _ => "other",
    }
}

/// The tally for a registry label. The registry is small; past 24 labels the
/// rest share "other", so the map stays bounded whatever the config holds.
fn mix<'m>(map: &'m mut BTreeMap<String, Mix>, key: &str) -> &'m mut Mix {
    let key = if map.len() < 24 || map.contains_key(key) {
        key
    } else {
        "other"
    };
    map.entry(key.to_string()).or_default()
}

/// Aggregate counters since this process started.
#[derive(Default)]
pub(super) struct Totals {
    calls: u64,
    attempts: u64,
    outcomes: BTreeMap<&'static str, u64>,
    rejections: BTreeMap<&'static str, u64>,
    tokens: [u64; 9],
    max_tokens: u64,
    plays: BTreeMap<&'static str, Tally>,
    occasions: BTreeMap<&'static str, Tally>,
    models: BTreeMap<String, Mix>,
    providers: BTreeMap<String, Mix>,
    provider_failures: BTreeMap<&'static str, u64>,
    provider_response_details: BTreeMap<&'static str, u64>,
    flagged: BTreeMap<&'static str, u64>,
    recent_outcomes: VecDeque<CallTrace>,
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
            models: BTreeMap::new(),
            providers: BTreeMap::new(),
            provider_failures: BTreeMap::new(),
            provider_response_details: BTreeMap::new(),
            flagged: BTreeMap::new(),
            recent_outcomes: VecDeque::new(),
        }
    }

    fn record_recent(&mut self, trace: CallTrace) {
        if self.recent_outcomes.len() == RECENT_OUTCOMES {
            self.recent_outcomes.pop_front();
        }
        self.recent_outcomes.push_back(trace);
    }

    /// Count a call under the model and provider it last tried, and each
    /// gateway failure code and response category it met.
    fn record_route(
        &mut self,
        (model, provider): (&str, &str),
        attempts: u8,
        outcome: Outcome,
        failures: &[ProviderFailure],
        flags: &[&'static str],
        fell_back: bool,
    ) {
        for tally in [
            mix(&mut self.models, model),
            mix(&mut self.providers, provider),
        ] {
            tally.calls += 1;
            tally.attempts += u64::from(attempts);
            tally.fallbacks += u64::from(fell_back);
            *match outcome {
                Outcome::Spoken => &mut tally.spoken,
                Outcome::Silent => &mut tally.silent,
                Outcome::Cancelled => &mut tally.cancelled,
            } += 1;
        }
        for failure in failures {
            *self.provider_failures.entry(failure.code).or_default() += 1;
            if let Some(detail) = failure.response_detail {
                *self.provider_response_details.entry(detail).or_default() += 1;
            }
        }
        for reason in flags {
            *self.flagged.entry(reason).or_default() += 1;
        }
    }

    fn record_rejection(&mut self, model: &str, reason: &'static str) {
        *mix(&mut self.models, model)
            .rejections
            .entry(reason)
            .or_default() += 1;
    }

    pub(super) fn record(
        &mut self,
        labels: Labels,
        budget: &Budget,
        attempts: u8,
        outcome: Outcome,
        reasons: &[&'static str],
    ) {
        let spoken = u64::from(outcome == Outcome::Spoken);
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
            "by_model": self.models,
            "by_provider": self.providers,
            "provider_failures": self.provider_failures,
            "provider_response_details": self.provider_response_details,
            "recent_outcomes": self.recent_outcomes,
            "flagged": self.flagged,
            "benches": crate::ai_bench::bench_count(),
            "scenes": super::voice_scenes::snapshot(),
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
    rejected_on: Vec<String>,
    failures: Vec<ProviderFailure>,
    flags: Vec<&'static str>,
    outcome: Option<Outcome>,
    model: String,
    provider: String,
    fell_back: bool,
    pending: Option<(Instant, bool)>,
    traces: Vec<AttemptTrace>,
}

impl State {
    fn reject(&mut self, reason: &'static str) {
        if self.reasons.len() < MAX_ATTEMPTS {
            self.reasons.push(reason);
            self.rejected_on.push(self.model.clone());
        }
    }
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

/// Record each attempt when it ends and the call when it drops. A call
/// cancelled at the scene deadline still counts.
pub(super) struct Call<'a> {
    call_id: u64,
    log_span: tracing::Span,
    entity: &'a str,
    part: Part,
    budget: Budget,
    labels: Labels,
    started: Instant,
    state: Mutex<State>,
}

impl<'a> Call<'a> {
    pub(super) fn new(entity: &'a str, part: Part, budget: Budget) -> Self {
        Self {
            call_id: NEXT_CALL.fetch_add(1, Ordering::Relaxed),
            log_span: tracing::info_span!(parent: None, "card_voice"),
            entity,
            part,
            budget,
            labels: Labels::default(),
            started: Instant::now(),
            state: Mutex::new(State {
                attempts: 0,
                reasons: Vec::new(),
                rejected_on: Vec::new(),
                failures: Vec::new(),
                flags: Vec::new(),
                outcome: None,
                model: "none".into(),
                provider: "none".into(),
                fell_back: false,
                pending: None,
                traces: Vec::new(),
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

    /// One more attempt, on this registry model and provider, which is a
    /// fallback after the part's own model failed.
    pub(super) fn attempt(&self, model: &str, provider: &str, fallback: bool) {
        self.with(|state| {
            state.attempts = state.attempts.saturating_add(1);
            state.fell_back |= fallback;
            state.pending = Some((Instant::now(), fallback));
            if state.model != model || state.provider != provider {
                state.model = model.into();
                state.provider = provider.into();
            }
        });
    }

    fn part_label(&self) -> &'static str {
        match self.part {
            Part::Line => "line",
            Part::Thought => "thought",
            Part::Persona => "persona",
            Part::Dream => "dream",
        }
    }

    fn end_attempt(
        &self,
        state: &mut State,
        outcome: &'static str,
        reason: Option<&'static str>,
        finish: Option<&'static str>,
        failure: Option<ProviderFailure>,
    ) {
        let Some((started, fallback)) = state.pending.take() else {
            return;
        };
        let trace = AttemptTrace {
            attempt: state.attempts,
            model: state.model.clone(),
            provider: state.provider.clone(),
            fallback,
            ended_at_unix_ms: unix_ms(),
            elapsed_ms: started.elapsed().as_millis() as u64,
            outcome,
            reason,
            finish,
            failure,
        };
        let _log = self.log_span.enter();
        tracing::info!(
            feature = "card_voice",
            call_id = self.call_id,
            entity = self.entity,
            part = self.part_label(),
            attempt = trace.attempt,
            model = %trace.model,
            provider = %trace.provider,
            fallback = trace.fallback,
            outcome,
            reason,
            finish,
            failure = failure.map(|value| value.code),
            response_detail = failure.and_then(|value| value.response_detail),
            ended_at_unix_ms = trace.ended_at_unix_ms,
            elapsed_ms = trace.elapsed_ms,
            "card voice attempt"
        );
        if state.traces.len() < MAX_ATTEMPTS {
            state.traces.push(trace);
        }
    }

    /// A published line the validator flagged rather than blocked. The line
    /// still counts as spoken; `reason` is the validator's static label.
    /// `reject` records the blocked reasons.
    pub(super) fn flag(&self, reason: &'static str) {
        self.with(|state| {
            if state.flags.len() < MAX_ATTEMPTS {
                state.flags.push(reason);
            }
        });
    }

    /// Count only the gateway's static code and optional response category.
    pub(super) fn reject_provider(&self, error: &AiGatewayError) {
        self.with(|state| {
            state.reject("provider");
            let failure = ProviderFailure {
                code: error.code(),
                response_detail: error.response_detail(),
            };
            if state.failures.len() < MAX_ATTEMPTS {
                state.failures.push(failure);
            }
            let outcome = match (failure.code, failure.response_detail) {
                (_, Some("provider_declined")) => "rejected",
                ("inference_invalid_response", _) => "invalid_response",
                ("inference_timeout", _) => "timeout",
                _ => "provider_error",
            };
            self.end_attempt(state, outcome, Some("provider"), None, Some(failure));
        });
    }

    /// Keep each attempt's reason; attempts are few, so this stays small.
    pub(super) fn reject(&self, reason: &'static str, finish: Option<&str>) {
        self.with(|state| {
            state.reject(reason);
            let outcome = if reason == "timeout" {
                "timeout"
            } else {
                "rejected"
            };
            self.end_attempt(state, outcome, Some(reason), finish.map(finish_label), None);
        });
    }

    pub(super) fn spoken(&self, finish: &str) {
        self.with(|state| {
            self.end_attempt(state, "spoken", None, Some(finish_label(finish)), None);
            state.outcome = Some(Outcome::Spoken);
        });
    }

    pub(super) fn silent(&self) {
        self.with(|state| {
            if state.attempts == 0 && state.reasons.is_empty() {
                state.reject("deadline");
            }
            state.outcome = Some(Outcome::Silent);
        });
    }
}

/// Each attempt's reason. An attempt with no reason and no reply ran out of
/// its own time, except the one still running when the call was dropped: the
/// scene deadline or a closed viewer cancelled that one. A published line
/// explains its own attempt.
fn explained(mut reasons: Vec<&'static str>, attempts: u8, outcome: Outcome) -> Vec<&'static str> {
    let answered = usize::from(outcome == Outcome::Spoken);
    let unexplained = usize::from(attempts).saturating_sub(reasons.len() + answered);
    for n in 1..=unexplained {
        let last = n == unexplained && outcome == Outcome::Cancelled;
        if reasons.len() < MAX_ATTEMPTS {
            reasons.push(if last { "cancelled" } else { "timeout" });
        }
    }
    reasons
}

impl Drop for Call<'_> {
    fn drop(&mut self) {
        let Ok(mut state) = self.state.lock() else {
            return;
        };
        let outcome = state.outcome.unwrap_or(Outcome::Cancelled);
        let reasons = explained(state.reasons.clone(), state.attempts, outcome);
        let unfinished = if outcome == Outcome::Cancelled {
            "cancelled"
        } else {
            "timeout"
        };
        self.end_attempt(&mut state, unfinished, Some(unfinished), None, None);
        let ended_at_unix_ms = unix_ms();
        let ms = self.started.elapsed().as_millis() as u64;
        let b = &self.budget;
        let _log = self.log_span.enter();
        tracing::info!(
            feature = "card_voice",
            call_id = self.call_id,
            entity = self.entity,
            part = self.part_label(),
            play = self.labels.play,
            occasion = self.labels.occasion,
            attempts = state.attempts,
            outcome = outcome.label(),
            reasons = %reasons.join(","),
            model = %state.model,
            provider = %state.provider,
            fell_back = state.fell_back,
            failures = %state.failures.iter().map(|failure| failure.code).collect::<Vec<_>>().join(","),
            flags = %state.flags.join(","),
            ended_at_unix_ms,
            ms,
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
            totals.record_route(
                (&state.model, &state.provider),
                state.attempts,
                outcome,
                &state.failures,
                &state.flags,
                state.fell_back,
            );
            for (n, reason) in reasons.iter().enumerate() {
                let model = state.rejected_on.get(n).unwrap_or(&state.model);
                totals.record_rejection(model, reason);
            }
            totals.record_recent(CallTrace {
                call_id: self.call_id,
                entity: self.entity.to_string(),
                part: self.part_label(),
                play: self.labels.play,
                occasion: self.labels.occasion,
                ended_at_unix_ms,
                elapsed_ms: ms,
                outcome: outcome.label(),
                model: state.model.clone(),
                provider: state.provider.clone(),
                reasons: reasons.clone(),
                flags: state.flags.clone(),
                attempts: std::mem::take(&mut state.traces),
            });
        }
        if self.part == Part::Line {
            super::voice_scenes::heard(super::voice_scenes::Voice {
                entity: self.entity.to_string(),
                outcome,
                model: state.model.clone(),
                provider: state.provider.clone(),
                attempts: state.attempts,
                ms,
                reasons,
                flags: state.flags.clone(),
            });
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{io, sync::Arc};

    struct LogWriter(Arc<Mutex<Vec<u8>>>);

    impl io::Write for LogWriter {
        fn write(&mut self, bytes: &[u8]) -> io::Result<usize> {
            self.0.lock().unwrap().extend_from_slice(bytes);
            Ok(bytes.len())
        }

        fn flush(&mut self) -> io::Result<()> {
            Ok(())
        }
    }

    #[test]
    fn completion_traces_distinguish_rejection_timeout_and_cancellation() {
        let captured = Arc::new(Mutex::new(Vec::new()));
        let writer = captured.clone();
        let subscriber = tracing_subscriber::fmt()
            .json()
            .flatten_event(true)
            .with_current_span(true)
            .with_span_list(true)
            .with_writer(move || LogWriter(writer.clone()))
            .finish();
        let call_id = tracing::subscriber::with_default(subscriber, || {
            let _request = tracing::info_span!("request", session = "private session").entered();
            let call = Call::new("vale", Part::Line, Budget::default());
            call.attempt("test-model", "openrouter", false);
            call.reject("repeat", Some("stop"));
            call.attempt("fallback-model", "openrouter", true);
            call.reject("timeout", None);
            call.attempt("last-model", "openrouter", true);
            call.call_id
        });

        let logs = captured.lock().unwrap();
        let rows = std::str::from_utf8(&logs).unwrap();
        assert!(!rows.contains("private session"));
        let events: Vec<Value> = rows
            .lines()
            .map(|row| serde_json::from_str(row).unwrap())
            .collect();
        assert_eq!(events.len(), 4);
        assert!(events.iter().all(|event| event["call_id"] == call_id));
        assert_eq!(events[0]["outcome"], "rejected");
        assert_eq!(events[1]["outcome"], "timeout");
        assert_eq!(events[2]["outcome"], "cancelled");
        assert_eq!(events[3]["message"], "card voice call");

        let value = snapshot();
        let trace = value["recent_outcomes"]
            .as_array()
            .unwrap()
            .iter()
            .find(|trace| trace["call_id"] == call_id)
            .unwrap();
        assert_eq!(trace["outcome"], "cancelled");
        assert_eq!(trace["reasons"], json!(["repeat", "timeout", "cancelled"]));
        let attempts = trace["attempts"].as_array().unwrap();
        assert_eq!(attempts.len(), 3);
        assert_eq!(attempts[0]["outcome"], "rejected");
        assert_eq!(attempts[0]["finish"], "stop");
        assert_eq!(attempts[1]["outcome"], "timeout");
        assert_eq!(attempts[1]["model"], "fallback-model");
        assert_eq!(attempts[2]["outcome"], "cancelled");
        assert_eq!(attempts[2]["attempt"], 3);
    }

    #[test]
    fn recent_outcomes_evict_the_oldest_calls_without_changing_counters() {
        let mut totals = Totals::new();
        let end = RECENT_OUTCOMES as u64 + 3;
        for call_id in 1..=end {
            totals.record(
                Labels::default(),
                &Budget::default(),
                1,
                Outcome::Silent,
                &[],
            );
            totals.record_recent(CallTrace {
                call_id,
                entity: "vale".into(),
                part: "line",
                play: "talk",
                occasion: "talk",
                ended_at_unix_ms: call_id,
                elapsed_ms: 0,
                outcome: "silent",
                model: "none".into(),
                provider: "none".into(),
                reasons: vec![],
                flags: vec![],
                attempts: vec![],
            });
        }
        let value = totals.snapshot();
        assert_eq!(value["calls"], end);
        assert_eq!(value["outcomes"]["silent"], end);
        let recent = value["recent_outcomes"].as_array().unwrap();
        assert_eq!(recent.len(), RECENT_OUTCOMES);
        assert_eq!(recent[0]["call_id"], 4);
        assert_eq!(recent.last().unwrap()["call_id"], end);
    }

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
    fn spoken_lines_and_cancels_are_not_timeouts() {
        assert!(explained(vec![], 1, Outcome::Spoken).is_empty());
        assert_eq!(explained(vec!["repeat"], 2, Outcome::Spoken), ["repeat"]);
        assert_eq!(explained(vec![], 1, Outcome::Cancelled), ["cancelled"]);
        assert_eq!(
            explained(vec![], 2, Outcome::Cancelled),
            ["timeout", "cancelled"]
        );
        assert_eq!(
            explained(vec!["shape"], 2, Outcome::Silent),
            ["shape", "timeout"]
        );
        let mut totals = Totals::new();
        let route = ("openai/gpt-6-luna", "openrouter");
        totals.record_route(
            route,
            2,
            Outcome::Silent,
            &[
                ProviderFailure {
                    code: "inference_timeout",
                    response_detail: None,
                },
                ProviderFailure {
                    code: "inference_invalid_response",
                    response_detail: Some("reasoning_only"),
                },
            ],
            &[],
            false,
        );
        totals.record_route(route, 1, Outcome::Spoken, &[], &["echoed brief"], true);
        let value = totals.snapshot();
        assert_eq!(value["by_model"]["openai/gpt-6-luna"]["calls"], 2);
        assert_eq!(value["by_model"]["openai/gpt-6-luna"]["silent"], 1);
        assert_eq!(value["by_provider"]["openrouter"]["attempts"], 3);
        assert_eq!(value["provider_failures"]["inference_timeout"], 1);
        assert_eq!(value["provider_failures"]["inference_invalid_response"], 1);
        assert_eq!(
            value["provider_response_details"],
            json!({"reasoning_only": 1})
        );
        assert_eq!(value["by_model"]["openai/gpt-6-luna"]["fallbacks"], 1);
        // A flagged line is spoken, and its flag is counted apart.
        assert_eq!(value["by_model"]["openai/gpt-6-luna"]["spoken"], 1);
        assert_eq!(value["flagged"]["echoed brief"], 1);
        assert!(value["rejections"].as_object().unwrap().is_empty());
        let mut many = BTreeMap::new();
        for n in 0..30 {
            mix(&mut many, &format!("model-{n}")).calls += 1;
        }
        assert_eq!(many.len(), 25);
        assert_eq!(many["other"].calls, 6);
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
        let mut read = super::super::tests::solo_departure();
        read.card.kind = "read".into();
        context.outcome = Some(read);
        assert_eq!(Labels::of(&context).play, "read");
    }
}
