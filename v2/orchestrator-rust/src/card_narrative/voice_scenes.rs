//! One text-free record per scene (#2016): how each needed speaker ended,
//! on which model and provider, in how long and after which rejections.
//! A failed streamed scene still answers HTTP 200, so this line, not the
//! access log, is where a "…" shows.
//!
//! Requests refused before any model call (429, 400, 403, 413, 422, 503)
//! and shared-world silence (failed words, lease expiry, rules refusals)
//! are counted here too. Labels are static or come from the registry and
//! the scene's own entity ids; no prompt, player or reply text is kept.
use super::voice_metrics::Outcome;
use super::Context;
use serde_json::{json, Value};
use std::{
    collections::BTreeMap,
    future::Future,
    sync::{Arc, Mutex},
    time::Instant,
};

/// How one voice call of a scene ended (`voice_metrics::Call`).
pub(super) struct Voice {
    pub(super) entity: String,
    pub(super) outcome: Outcome,
    pub(super) model: String,
    pub(super) provider: String,
    pub(super) attempts: u8,
    pub(super) ms: u64,
    /// Blocked reasons: replies that were not published.
    pub(super) reasons: Vec<&'static str>,
    /// Flagged reasons on the published line, which still counts as spoken.
    pub(super) flags: Vec<&'static str>,
}

type Voices = Arc<Mutex<Vec<Voice>>>;

tokio::task_local! {
    static SCENE: Voices;
}

/// Keep a finished line call for the scene it belongs to, if any.
pub(super) fn heard(voice: Voice) {
    let _ = SCENE.try_with(|voices| {
        if let Ok(mut voices) = voices.lock() {
            if voices.len() < 16 {
                voices.push(voice);
            }
        }
    });
}

#[derive(Debug, Default)]
struct Totals {
    scenes: BTreeMap<&'static str, BTreeMap<&'static str, u64>>,
    speakers: BTreeMap<&'static str, u64>,
    refused: BTreeMap<&'static str, u64>,
    shared: BTreeMap<&'static str, u64>,
}

static TOTALS: Mutex<Totals> = Mutex::new(Totals {
    scenes: BTreeMap::new(),
    speakers: BTreeMap::new(),
    refused: BTreeMap::new(),
    shared: BTreeMap::new(),
});

fn add(change: impl FnOnce(&mut Totals)) {
    if let Ok(mut totals) = TOTALS.lock() {
        change(&mut totals);
    }
}

/// The scene counters, for `/meta` under `card_voice.scenes`.
pub(super) fn snapshot() -> Value {
    TOTALS.lock().map_or_else(
        |_| json!({}),
        |t| {
            json!({
                "by_path": t.scenes,
                "speakers": t.speakers,
                "refused": t.refused,
                "shared_plays": t.shared,
            })
        },
    )
}

/// A request refused before any voice was called. `reason` is one of a
/// fixed set (busy, client_busy, rate_limited, invalid, envelope, unreadable,
/// too_large, forbidden, unavailable).
pub(super) fn refused(reason: &'static str) {
    add(|t| *t.refused.entry(reason).or_default() += 1);
    tracing::info!(
        feature = "card_voice",
        path = "table",
        outcome = "refused",
        reason,
        "card voice scene"
    );
}

/// How a shared play's words ended on the table: `spoken`, `partial`,
/// `failed` or `expired` (its lease ran out), with each "…" it shows.
/// `refused` (the rules refused the words) is also counted as `failed`.
pub(crate) fn shared(end: &'static str, silent: usize) {
    add(|t| {
        *t.shared.entry(end).or_default() += 1;
        *t.shared.entry("silent_voices").or_default() += silent as u64;
    });
}

struct Scene {
    path: &'static str,
    stream: bool,
    needed: Vec<String>,
    started: Instant,
    voices: Voices,
    ended: Option<bool>,
}

impl Drop for Scene {
    fn drop(&mut self) {
        let voices = std::mem::take(&mut *self.voices.lock().unwrap_or_else(|e| e.into_inner()));
        // A speaker the scene needed but never called (a Talk's target after
        // a silent actor, or past the deadline) shows "…" all the same.
        let ends: Vec<&'static str> = self
            .needed
            .iter()
            .map(|id| {
                voices
                    .iter()
                    .find(|voice| &voice.entity == id)
                    .map_or("unvoiced", |voice| voice.outcome.label())
            })
            .collect();
        let voiced = ends
            .iter()
            .filter(|end| matches!(**end, "spoken" | "untold"))
            .count();
        let outcome = match self.ended {
            None => "closed",
            Some(false) => "failed",
            Some(true) if voiced == ends.len() => "spoken",
            Some(true) => "partial",
        };
        add(|t| {
            *t.scenes
                .entry(self.path)
                .or_default()
                .entry(outcome)
                .or_default() += 1;
            for end in &ends {
                *t.speakers.entry(end).or_default() += 1;
            }
        });
        let detail = Value::from(
            voices
                .iter()
                .map(|v| {
                    json!({
                        "entity": v.entity,
                        "outcome": v.outcome.label(),
                        "model": v.model,
                        "provider": v.provider,
                        "attempts": v.attempts,
                        "ms": v.ms,
                        "reasons": v.reasons,
                    "flags": v.flags,
                    })
                })
                .collect::<Vec<_>>(),
        );
        tracing::info!(
            feature = "card_voice",
            path = self.path,
            stream = self.stream,
            outcome,
            needed = ends.len(),
            voiced,
            ms = self.started.elapsed().as_millis() as u64,
            voices = %detail,
            "card voice scene"
        );
    }
}

/// Run one scene, then log and count it once: also when its viewer leaves
/// and the scene is dropped unfinished (`closed`).
pub(super) async fn run<T, E>(
    path: &'static str,
    context: &Context,
    voiced: &[String],
    stream: bool,
    scene: impl Future<Output = Result<T, E>>,
) -> Result<T, E> {
    let needed = if context.speakers.is_empty() {
        voiced
    } else {
        &context.speakers
    };
    let mut record = Scene {
        path,
        stream,
        needed: needed.to_vec(),
        started: Instant::now(),
        voices: Voices::default(),
        ended: None,
    };
    let result = SCENE.scope(record.voices.clone(), scene).await;
    record.ended = Some(result.is_ok());
    result
}

#[cfg(test)]
mod tests {
    use super::*;

    fn voice(entity: &str, outcome: Outcome) -> Voice {
        Voice {
            entity: entity.into(),
            outcome,
            model: "openai/gpt-6-luna".into(),
            provider: "openrouter".into(),
            attempts: 2,
            ms: 1200,
            reasons: vec!["repeat"],
            flags: vec![],
        }
    }

    #[tokio::test]
    async fn each_needed_speaker_is_counted_and_a_lone_silence_is_partial() {
        let mut context = super::super::tests::context();
        context.speakers = vec!["vale".into(), "moth".into(), "pip".into()];
        let before = snapshot();
        let count = |value: &Value, path: &str| value[path].as_u64().unwrap_or(0);
        let result: Result<(), ()> = run("shared", &context, &[], false, async {
            heard(voice("vale", Outcome::Spoken));
            heard(voice("moth", Outcome::Silent));
            Ok(())
        })
        .await;
        assert!(result.is_ok());
        let after = snapshot();
        let gained = |path: &str, key: &str| count(&after[path], key) - count(&before[path], key);
        assert!(
            count(&after["by_path"]["shared"], "partial")
                > count(&before["by_path"]["shared"], "partial")
        );
        assert!(gained("speakers", "spoken") >= 1);
        assert!(gained("speakers", "silent") >= 1);
        assert!(gained("speakers", "unvoiced") >= 1);
        // Outside a scene a call is not kept anywhere.
        heard(voice("vale", Outcome::Spoken));
        refused("busy");
        shared("expired", 2);
        let last = snapshot();
        assert!(count(&last["refused"], "busy") >= 1);
        assert!(count(&last["shared_plays"], "silent_voices") >= 2);
        assert!(!last.to_string().contains("gpt-6"));
    }
}
