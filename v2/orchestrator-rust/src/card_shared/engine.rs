//! The shipping card rules run in QuickJS, a C interpreter. Rust supplies JSON
//! and owns IO; the interpreter has no filesystem, network, clocks or randomness.
use super::store::Result;
use rquickjs::{Context, Function, Runtime};
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::{
    collections::VecDeque,
    sync::{Mutex, OnceLock},
    time::{Duration, Instant},
};

pub(super) const VERSION: &str = "full-card-world/22";
pub(super) const TWENTY_FIRST_VERSION: &str = "full-card-world/21";
pub(super) const TWENTIETH_VERSION: &str = "full-card-world/20";
pub(super) const NINETEENTH_VERSION: &str = "full-card-world/19";
pub(super) const EIGHTEENTH_VERSION: &str = "full-card-world/18";
pub(super) const SEVENTEENTH_VERSION: &str = "full-card-world/17";
pub(super) const SIXTEENTH_VERSION: &str = "full-card-world/16";
pub(super) const FIFTEENTH_VERSION: &str = "full-card-world/15";
pub(super) const FOURTEENTH_VERSION: &str = "full-card-world/14";
pub(super) const THIRTEENTH_VERSION: &str = "full-card-world/13";
pub(super) const TWELFTH_VERSION: &str = "full-card-world/12";
pub(super) const ELEVENTH_VERSION: &str = "full-card-world/11";
pub(super) const TENTH_VERSION: &str = "full-card-world/10";
pub(super) const NINTH_VERSION: &str = "full-card-world/9";
pub(super) const EIGHTH_VERSION: &str = "full-card-world/8";
pub(super) const SEVENTH_VERSION: &str = "full-card-world/7";
pub(super) const SIXTH_VERSION: &str = "full-card-world/6";
pub(super) const FIFTH_VERSION: &str = "full-card-world/5";
pub(super) const PREVIOUS_VERSION: &str = "full-card-world/3";
pub(super) const LEGACY_VERSION: &str = "full-card-world/2";
pub(super) const FOURTH_VERSION: &str = "full-card-world/4";
const SOURCE: &str = include_str!("engine-v22.js");
const TWENTY_FIRST_SOURCE: &str = include_str!("engine-v21.js");
const TWENTIETH_SOURCE: &str = include_str!("engine-v20.js");
const NINETEENTH_SOURCE: &str = include_str!("engine-v19.js");
const EIGHTEENTH_SOURCE: &str = include_str!("engine-v18.js");
const SEVENTEENTH_SOURCE: &str = include_str!("engine-v17.js");
const SIXTEENTH_SOURCE: &str = include_str!("engine-v16.js");
const FIFTEENTH_SOURCE: &str = include_str!("engine-v15.js");
const FOURTEENTH_SOURCE: &str = include_str!("engine-v14.js");
const THIRTEENTH_SOURCE: &str = include_str!("engine-v13.js");
const TWELFTH_SOURCE: &str = include_str!("engine-v12.js");
const ELEVENTH_SOURCE: &str = include_str!("engine-v11.js");
const TENTH_SOURCE: &str = include_str!("engine-v10.js");
const NINTH_SOURCE: &str = include_str!("engine-v9.js");
const EIGHTH_SOURCE: &str = include_str!("engine-v8.js");
const SEVENTH_SOURCE: &str = include_str!("engine-v7.js");
const SIXTH_SOURCE: &str = include_str!("engine-v6.js");
const FIFTH_SOURCE: &str = include_str!("engine-v5.js");
const FOURTH_SOURCE: &str = include_str!("engine-v4.js");
// Released rule bundles retain the exact semantics of their journal entries.
const PREVIOUS_SOURCE: &str = include_str!("engine-v3.js");
const LEGACY_SOURCE: &str = include_str!("engine-v2.js");
pub(super) fn historical(version: &str) -> bool {
    matches!(
        version,
        LEGACY_VERSION
            | PREVIOUS_VERSION
            | FOURTH_VERSION
            | FIFTH_VERSION
            | SIXTH_VERSION
            | SEVENTH_VERSION
            | EIGHTH_VERSION
            | NINTH_VERSION
            | TENTH_VERSION
            | ELEVENTH_VERSION
            | TWELFTH_VERSION
            | THIRTEENTH_VERSION
            | FOURTEENTH_VERSION
            | FIFTEENTH_VERSION
            | SIXTEENTH_VERSION
            | SEVENTEENTH_VERSION
            | EIGHTEENTH_VERSION
            | NINETEENTH_VERSION
            | TWENTIETH_VERSION
            | TWENTY_FIRST_VERSION
    )
}
const MAX_BYTES: usize = 4 * 1024 * 1024;
const CACHE_ENTRIES: usize = 32;
// Keep all eight legal viewer replies, including replies near the 4 MiB IO
// bound. Entries still use exact-input SHA keys and the separate count bound.
const CACHE_BYTES: usize = 40 * 1024 * 1024;

#[derive(Default)]
struct Views {
    entries: VecDeque<(String, String)>,
    bytes: usize,
}
impl Views {
    fn get(&mut self, input: &str) -> Option<String> {
        let index = self.entries.iter().position(|(key, _)| key == input)?;
        let entry = self.entries.remove(index)?;
        let output = entry.1.clone();
        self.entries.push_back(entry);
        Some(output)
    }
    fn put(&mut self, input: String, output: String) {
        let bytes = input.len() + output.len();
        if bytes > CACHE_BYTES || self.entries.iter().any(|(key, _)| *key == input) {
            return;
        }
        while self.entries.len() >= CACHE_ENTRIES || self.bytes + bytes > CACHE_BYTES {
            if let Some((key, value)) = self.entries.pop_front() {
                self.bytes -= key.len() + value.len();
            }
        }
        self.bytes += bytes;
        self.entries.push_back((input, output));
    }
}
fn views() -> &'static Mutex<Views> {
    static VIEWS: OnceLock<Mutex<Views>> = OnceLock::new();
    VIEWS.get_or_init(|| Mutex::new(Views::default()))
}

fn view_cache_key(version: &str, input: &str) -> String {
    let mut hash = Sha256::new();
    hash.update(version.as_bytes());
    hash.update([0]);
    hash.update(input.as_bytes());
    format!("{version}:{:x}", hash.finalize())
}

pub(super) fn reduce(request: Value) -> Result<Value> {
    reduce_version(VERSION, request)
}
pub(super) fn reduce_version(version: &str, request: Value) -> Result<Value> {
    let source = match version {
        VERSION => SOURCE,
        TWENTY_FIRST_VERSION => TWENTY_FIRST_SOURCE,
        TWENTIETH_VERSION => TWENTIETH_SOURCE,
        NINETEENTH_VERSION => NINETEENTH_SOURCE,
        EIGHTEENTH_VERSION => EIGHTEENTH_SOURCE,
        PREVIOUS_VERSION => PREVIOUS_SOURCE,
        FOURTH_VERSION => FOURTH_SOURCE,
        FIFTH_VERSION => FIFTH_SOURCE,
        SIXTH_VERSION => SIXTH_SOURCE,
        SEVENTH_VERSION => SEVENTH_SOURCE,
        EIGHTH_VERSION => EIGHTH_SOURCE,
        NINTH_VERSION => NINTH_SOURCE,
        TENTH_VERSION => TENTH_SOURCE,
        ELEVENTH_VERSION => ELEVENTH_SOURCE,
        TWELFTH_VERSION => TWELFTH_SOURCE,
        THIRTEENTH_VERSION => THIRTEENTH_SOURCE,
        FOURTEENTH_VERSION => FOURTEENTH_SOURCE,
        FIFTEENTH_VERSION => FIFTEENTH_SOURCE,
        SIXTEENTH_VERSION => SIXTEENTH_SOURCE,
        SEVENTEENTH_VERSION => SEVENTEENTH_SOURCE,
        LEGACY_VERSION => LEGACY_SOURCE,
        _ => return Err("This world needs a supported rules version.".into()),
    };
    let view = request["op"] == "view";
    let input = serde_json::to_string(&request).map_err(|_| "Choose a saved world.".to_string())?;
    if input.len() > MAX_BYTES {
        return Err("This saved world is too large to share.".into());
    }
    let cache_key = view.then(|| view_cache_key(version, &input));
    // A projection is pure for its exact world, actor, claims and presence.
    // Keep only successful serialized projections. Commands always run in C.
    if let Some(cache_key) = cache_key.as_deref() {
        let cached = views()
            .lock()
            .ok()
            .and_then(|mut cache| cache.get(cache_key));
        if let Some(output) = cached {
            return serde_json::from_str(&output)
                .map_err(|_| "The shared-world rules need attention.".to_string());
        }
    }
    let runtime = Runtime::new().map_err(engine_error)?;
    runtime.set_memory_limit(96 * 1024 * 1024);
    runtime.set_max_stack_size(1024 * 1024);
    let deadline = Instant::now() + Duration::from_secs(2);
    runtime.set_interrupt_handler(Some(Box::new(move || Instant::now() > deadline)));
    let context = Context::full(&runtime).map_err(engine_error)?;
    let output = context.with(|ctx| -> Result<String> {
        ctx.eval::<(), _>("globalThis.structuredClone = value => JSON.parse(JSON.stringify(value)); globalThis.Date = undefined; Math.random = () => { throw new Error('Randomness must come from the saved world.'); };")
            .map_err(engine_error)?;
        ctx.eval::<(), _>(source).map_err(|error| {
            tracing::error!(error=%error, exception=?ctx.catch(), "shared rules failed to load");
            "The shared-world rules need attention.".to_string()
        })?;
        let entry: Function = ctx.globals().get("cardShared").map_err(engine_error)?;
        entry.call((input.as_str(),)).map_err(|error| {
            tracing::warn!(error=%error, exception=?ctx.catch(), "shared rules rejected a request");
            "The scene changed. Choose from the current cards.".to_string()
        })
    })?;
    if output.len() > MAX_BYTES {
        return Err("This saved world is too large to share.".into());
    }
    let value: Value = serde_json::from_str(&output)
        .map_err(|_| "The shared-world rules need attention.".to_string())?;
    if value["ok"] == false || value["error"].is_string() {
        return Err(value["error"]
            .as_str()
            .unwrap_or("Choose from the current cards.")
            .chars()
            .take(240)
            .collect());
    }
    if let Some(cache_key) = cache_key {
        if let Ok(mut cache) = views().lock() {
            cache.put(cache_key, output);
        }
    }
    Ok(value)
}
fn engine_error(error: impl std::fmt::Display) -> String {
    tracing::warn!(error=%error, "shared C interpreter error");
    "The shared world is taking a moment. Try again.".into()
}

#[cfg(test)]
#[path = "engine_audit_tests.rs"]
mod audit_tests;

#[cfg(test)]
#[path = "engine_interruption_tests.rs"]
mod interruption_tests;

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn view_cache_keys_cover_the_exact_world_and_viewer() {
        let input = serde_json::json!({
            "op":"view", "world":{"revision":4}, "actor":"vale",
            "claimed":["vale"], "present":["vale"]
        });
        let original = view_cache_key(VERSION, &input.to_string());
        assert_eq!(original, view_cache_key(VERSION, &input.to_string()));
        assert_ne!(
            original,
            view_cache_key(EIGHTEENTH_VERSION, &input.to_string())
        );
        for (field, value) in [
            ("world", serde_json::json!({"revision":5})),
            ("actor", serde_json::json!("mara")),
            ("claimed", serde_json::json!(["vale", "mara"])),
            ("present", serde_json::json!([])),
        ] {
            let mut changed = input.clone();
            changed[field] = value;
            assert_ne!(
                original,
                view_cache_key(VERSION, &changed.to_string()),
                "{field}"
            );
        }
        assert_ne!(view_cache_key("a", "bc"), view_cache_key("ab", "c"));
    }

    #[test]
    fn compact_keys_keep_eight_maximum_size_views_within_the_cache_budget() {
        let mut cache = Views::default();
        let world = "w".repeat(1024 * 1024);
        let output = "v".repeat(MAX_BYTES);
        let mut keys = Vec::new();
        let mut original_bytes = 0;
        for actor in 0..8 {
            let input = serde_json::json!({"actor":actor,"world":world}).to_string();
            let key = view_cache_key(VERSION, &input);
            assert!(key.len() < 128);
            original_bytes += VERSION.len() + 1 + input.len() + output.len();
            cache.put(key.clone(), output.clone());
            keys.push(key);
        }
        assert!(original_bytes > CACHE_BYTES);
        assert_eq!(cache.entries.len(), 8);
        assert!(cache.bytes <= CACHE_BYTES);
        for key in keys {
            assert_eq!(cache.get(&key).as_deref(), Some(output.as_str()));
        }
    }

    #[test]
    fn view_cache_bounds_entries_and_combined_payload() {
        let mut cache = Views::default();
        for n in 0..40 {
            cache.put(n.to_string(), "view".into());
        }
        assert_eq!(cache.entries.len(), CACHE_ENTRIES);
        assert!(cache.get("0").is_none());
        assert_eq!(cache.get("39").as_deref(), Some("view"));
        cache.put("oversize".into(), "x".repeat(CACHE_BYTES));
        assert!(cache.get("oversize").is_none());
        for n in 40..50 {
            cache.put(n.to_string(), "x".repeat(CACHE_BYTES / 3));
        }
        assert!(cache.entries.len() <= CACHE_ENTRIES);
        assert!(cache.bytes <= CACHE_BYTES);
        assert_eq!(
            cache.bytes,
            cache
                .entries
                .iter()
                .map(|(key, value)| key.len() + value.len())
                .sum::<usize>()
        );
    }
}
