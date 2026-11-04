//! The model bench, a tier above the exact-route breaker. A model whose
//! route keeps opening (5xx or transport only), or whose card voices keep
//! ending with no usable line, is benched for hours: every call on it fails
//! at once with no provider call, like an open route, and a voice's
//! fallback chain skips it. Benches are process-wide per exact model and live
//! in memory; they end on their own, by `POST /moderation/ai/unbench`, or on
//! restart.
use serde::Serialize;
use std::{
    collections::{BTreeMap, VecDeque},
    sync::{atomic::AtomicU64, atomic::Ordering::Relaxed, Arc, Mutex, MutexGuard},
    time::{Duration, Instant},
};
use tracing::{info, warn};

pub(crate) const AI_MODEL_BENCHED: &str = "ai_model_benched";
const REASONS: [&str; 2] = ["route_opens", "silent_voices"];
static BENCHES: AtomicU64 = AtomicU64::new(0);

/// Benches since this process started, for the card voice metrics.
pub(crate) fn bench_count() -> u64 {
    BENCHES.load(Relaxed)
}

/// Strikes that bench a model by reason (0 turns a trigger off), the window
/// they count in, and the bench's length (zero turns the bench off).
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) struct BenchConfig {
    thresholds: [usize; 2],
    window: Duration,
    duration: Duration,
}

impl BenchConfig {
    pub(crate) fn from_env() -> Self {
        Self::from_lookup(|name| std::env::var(name).ok())
    }

    /// An unreadable value keeps its default, with a warning.
    fn from_lookup(get: impl Fn(&str) -> Option<String>) -> Self {
        let read = |name: &str, default: u64, max: u64| {
            let raw = get(&format!("COSYWORLD_AI_BENCH_{name}"));
            match raw.map(|raw| raw.trim().parse::<u64>()) {
                None => default,
                Some(Ok(value)) if value <= max => value,
                Some(_) => {
                    warn!(event = "ai_bench_config", name, max, "using the default");
                    default
                }
            }
        };
        Self {
            thresholds: [
                read("ROUTE_OPENS", 3, 100) as usize,
                read("SILENT_VOICES", 6, 1_000) as usize,
            ],
            window: Duration::from_secs(read("WINDOW_MINUTES", 30, 1_440).max(1) * 60),
            duration: Duration::from_secs(read("HOURS", 6, 168) * 3_600),
        }
    }
}

/// One benched model, as `/meta.ai.benched` reports it (unix seconds).
#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
pub(crate) struct BenchedModel {
    pub(crate) model: String,
    pub(crate) since: u64,
    pub(crate) until: u64,
    pub(crate) reason: &'static str,
    pub(crate) trips: usize,
}

#[derive(Debug, Default)]
struct Strikes {
    recent: [VecDeque<Instant>; 2],
    bench: Option<(Instant, BenchedModel)>,
}

impl Strikes {
    /// End a bench whose period has passed; the model starts afresh.
    fn expire(&mut self, now: Instant) -> bool {
        let Some((_, shown)) = self.bench.take_if(|(until, _)| now >= *until) else {
            return false;
        };
        info!(
            event = "ai_model_unbenched",
            model = shown.model,
            cause = "expired"
        );
        *self = Self::default();
        true
    }
}

#[derive(Clone, Debug)]
pub(crate) struct AiBench {
    config: BenchConfig,
    models: Arc<Mutex<BTreeMap<String, Strikes>>>,
}

impl AiBench {
    pub(crate) fn new(config: BenchConfig) -> Self {
        let models = Arc::default();
        Self { config, models }
    }

    /// The bench's end in unix seconds while the model is benched.
    pub(crate) fn benched_until(&self, model: &str, now: Instant) -> Option<u64> {
        let mut models = self.lock();
        let strikes = models.get_mut(model.trim())?;
        let until = strikes.bench.as_ref()?.1.until;
        (!strikes.expire(now)).then_some(until)
    }

    /// Count a strike: 0 a route opening (half-open reopens included), 1 a
    /// card voice that ended with no usable line.
    pub(crate) fn strike(&self, model: &str, reason: usize, now: Instant, now_unix: u64) {
        let (model, threshold) = (model.trim(), self.config.thresholds[reason]);
        if model.is_empty() || threshold == 0 || self.config.duration.is_zero() {
            return;
        }
        let mut models = self.lock();
        let strikes = models.entry(model.to_string()).or_default();
        if strikes.bench.is_some() && !strikes.expire(now) {
            return;
        }
        let recent = &mut strikes.recent[reason];
        recent.retain(|at| now.saturating_duration_since(*at) < self.config.window);
        recent.push_back(now);
        if recent.len() < threshold {
            return;
        }
        let shown = BenchedModel {
            model: model.to_string(),
            since: now_unix,
            until: now_unix.saturating_add(self.config.duration.as_secs()),
            reason: REASONS[reason],
            trips: recent.len(),
        };
        warn!(
            event = "ai_model_benched",
            model,
            reason = shown.reason,
            trips = shown.trips,
            since = shown.since,
            until = shown.until
        );
        BENCHES.fetch_add(1, Relaxed);
        *strikes = Strikes {
            bench: Some((now + self.config.duration, shown)),
            ..Strikes::default()
        };
    }

    /// A usable line clears the model's silent strikes, so a busy model is
    /// benched for failing repeatedly, not for being busy.
    pub(crate) fn spoke(&self, model: &str) {
        if let Some(strikes) = self.lock().get_mut(model.trim()) {
            strikes.recent[1].clear();
        }
    }

    /// End a bench now. Returns whether the model was benched.
    pub(crate) fn clear(&self, model: &str) -> bool {
        let model = model.trim();
        let cleared = self.lock().remove(model).is_some_and(|s| s.bench.is_some());
        if cleared {
            info!(event = "ai_model_unbenched", model, cause = "operator");
        }
        cleared
    }

    pub(crate) fn snapshot(&self, now: Instant) -> Vec<BenchedModel> {
        let mut models = self.lock();
        models.retain(|_, strikes| {
            strikes.expire(now);
            strikes.bench.is_some() || strikes.recent.iter().any(|recent| !recent.is_empty())
        });
        models
            .values()
            .filter_map(|s| s.bench.as_ref())
            .map(|b| b.1.clone())
            .collect()
    }

    fn lock(&self) -> MutexGuard<'_, BTreeMap<String, Strikes>> {
        self.models
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }
}

#[derive(serde::Deserialize)]
pub(crate) struct UnbenchRequest {
    model: String,
}

/// `POST /moderation/ai/unbench {"model": "..."}`, behind the moderation
/// bearer token.
pub(crate) async fn moderation_unbench(
    headers: axum::http::HeaderMap,
    axum::extract::State(state): axum::extract::State<crate::AppState>,
    axum::Json(payload): axum::Json<UnbenchRequest>,
) -> (axum::http::StatusCode, axum::Json<serde_json::Value>) {
    use axum::http::StatusCode;
    use serde_json::json;
    if !crate::moderation::moderation_authorized(&state, &headers) {
        let error = json!({"ok": false, "error": "moderation bearer token required"});
        return (StatusCode::FORBIDDEN, axum::Json(error));
    }
    let Some(config) = state.ai_config.as_ref().as_ref() else {
        let error = json!({"ok": false, "error": "AI is not configured"});
        return (StatusCode::NOT_FOUND, axum::Json(error));
    };
    let cleared = config.readiness.unbench(&payload.model);
    let benched = config.readiness.benched();
    (
        StatusCode::OK,
        axum::Json(json!({"ok": true, "cleared": cleared, "benched": benched})),
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn strikes_in_the_window_bench_until_expiry_or_an_operator_clears() {
        let bench = AiBench::new(BenchConfig::from_lookup(|_| None));
        let t0 = Instant::now();
        let at = |minutes: u64| t0 + Duration::from_secs(minutes * 60);
        // Opens 20 minutes apart never hold three inside 30 minutes.
        for minutes in [0, 20, 40, 60, 71] {
            bench.strike("provider/slow", 0, at(minutes), minutes * 60);
        }
        assert_eq!(bench.benched_until("provider/slow", at(71)), None);
        bench.strike("provider/slow", 0, at(72), 72 * 60);
        let until = 72 * 60 + 6 * 3_600;
        assert_eq!(bench.benched_until("provider/slow", at(72)), Some(until));
        assert_eq!(bench.benched_until("provider/other", at(72)), None);
        let shown = &bench.snapshot(at(72))[0];
        let fields = (
            shown.model.as_str(),
            shown.since,
            shown.until,
            shown.reason,
            shown.trips,
        );
        assert_eq!(fields, ("provider/slow", 72 * 60, until, "route_opens", 3));
        // Strikes while benched are ignored; the bench expires on its own and
        // the model starts with no strikes.
        bench.strike("provider/slow", 0, at(73), 0);
        assert!(bench.benched_until("provider/slow", at(72 + 359)).is_some());
        assert_eq!(bench.benched_until("provider/slow", at(72 + 360)), None);
        assert!(bench.snapshot(at(72 + 360)).is_empty());
        bench.strike("provider/slow", 0, at(72 + 361), 0);
        assert_eq!(bench.benched_until("provider/slow", at(72 + 361)), None);
        // Silent voices count apart, and a usable line clears them.
        for minutes in 0..5 {
            bench.strike("provider/odd", 1, at(minutes), 0);
        }
        bench.spoke("provider/odd");
        for minutes in 5..10 {
            bench.strike("provider/odd", 1, at(minutes), 0);
        }
        assert_eq!(bench.benched_until("provider/odd", at(10)), None);
        bench.strike("provider/odd", 1, at(10), 0);
        assert_eq!(bench.snapshot(at(10))[0].reason, "silent_voices");
        assert!(!bench.clear("provider/fine"));
        assert!(bench.clear(" provider/odd "));
        assert_eq!(bench.benched_until("provider/odd", at(10)), None);
    }

    #[test]
    fn zero_settings_turn_triggers_off_and_bad_values_keep_defaults() {
        let config = |pairs: &'static [(&str, &str)]| {
            BenchConfig::from_lookup(move |name| {
                let found = pairs.iter().find(|(key, _)| name.ends_with(key));
                found.map(|(_, value)| value.to_string())
            })
        };
        let defaults = config(&[]);
        assert_eq!(defaults.thresholds, [3, 6]);
        assert_eq!(defaults.window, Duration::from_secs(1_800));
        assert_eq!(defaults.duration, Duration::from_secs(21_600));
        assert_eq!(config(&[("_OPENS", "many"), ("HOURS", "999")]), defaults);
        let t0 = Instant::now();
        let bench = AiBench::new(config(&[("_OPENS", "0"), ("VOICES", "1")]));
        bench.strike("provider/model", 0, t0, 0);
        assert_eq!(bench.benched_until("provider/model", t0), None);
        bench.strike("provider/model", 1, t0, 0);
        assert!(bench.benched_until("provider/model", t0).is_some());
        let off = AiBench::new(config(&[("VOICES", "1"), ("HOURS", "0")]));
        off.strike("provider/model", 1, t0, 0);
        assert_eq!(off.benched_until("provider/model", t0), None);
    }
}
