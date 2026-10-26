//! The shipping card rules run in QuickJS, a C interpreter. Rust supplies JSON
//! and owns IO; the interpreter has no filesystem, network, clocks or randomness.
use super::store::Result;
use rquickjs::{Context, Function, Runtime};
use serde_json::Value;
use std::{
    collections::VecDeque,
    sync::{Mutex, OnceLock},
    time::{Duration, Instant},
};

pub(super) const VERSION: &str = "full-card-world/6";
pub(super) const FIFTH_VERSION: &str = "full-card-world/5";
pub(super) const PREVIOUS_VERSION: &str = "full-card-world/3";
pub(super) const LEGACY_VERSION: &str = "full-card-world/2";
pub(super) const FOURTH_VERSION: &str = "full-card-world/4";
const SOURCE: &str = include_str!("engine-v6.js");
const FIFTH_SOURCE: &str = include_str!("engine-v5.js");
const FOURTH_SOURCE: &str = include_str!("engine-v4.js");
// Released rule bundles retain the exact semantics of their journal entries.
const PREVIOUS_SOURCE: &str = include_str!("engine-v3.js");
const LEGACY_SOURCE: &str = include_str!("engine-v2.js");
pub(super) fn historical(version: &str) -> bool {
    matches!(
        version,
        LEGACY_VERSION | PREVIOUS_VERSION | FOURTH_VERSION | FIFTH_VERSION
    )
}
const MAX_BYTES: usize = 4 * 1024 * 1024;
const CACHE_ENTRIES: usize = 32;
const CACHE_BYTES: usize = 4 * 1024 * 1024;

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

pub(super) fn reduce(request: Value) -> Result<Value> {
    reduce_version(VERSION, request)
}
pub(super) fn reduce_version(version: &str, request: Value) -> Result<Value> {
    let source = match version {
        VERSION => SOURCE,
        PREVIOUS_VERSION => PREVIOUS_SOURCE,
        FOURTH_VERSION => FOURTH_SOURCE,
        FIFTH_VERSION => FIFTH_SOURCE,
        LEGACY_VERSION => LEGACY_SOURCE,
        _ => return Err("This world needs a supported rules version.".into()),
    };
    let view = request["op"] == "view";
    let input = serde_json::to_string(&request).map_err(|_| "Choose a saved world.".to_string())?;
    if input.len() > MAX_BYTES {
        return Err("This saved world is too large to share.".into());
    }
    let cache_key = format!("{version}:{input}");
    // A projection is pure for its exact world, actor, claims and presence.
    // Keep only successful serialized projections. Commands always run in C.
    if view {
        let cached = views()
            .lock()
            .ok()
            .and_then(|mut cache| cache.get(&cache_key));
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
    if view {
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
mod tests {
    use super::*;
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
