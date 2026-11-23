//! The shipping card rules run in QuickJS, a C interpreter. Rust supplies JSON
//! and owns IO; the interpreter has no filesystem, network, clocks or randomness.
use super::{content, store::Result};
use rquickjs::{Context, Function, Runtime};
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::{
    collections::VecDeque,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex, OnceLock,
    },
    time::{Duration, Instant},
};

pub(super) const VERSION: &str = "full-card-world/191";
pub(super) const HUNDRED_NINETIETH_VERSION: &str = "full-card-world/190";
pub(super) const HUNDRED_EIGHTY_NINTH_VERSION: &str = "full-card-world/189";
pub(super) const HUNDRED_EIGHTY_EIGHTH_VERSION: &str = "full-card-world/188";
pub(super) const HUNDRED_EIGHTY_SEVENTH_VERSION: &str = "full-card-world/187";
pub(super) const HUNDRED_EIGHTY_SIXTH_VERSION: &str = "full-card-world/186";
pub(super) const HUNDRED_EIGHTY_FIFTH_VERSION: &str = "full-card-world/185";
pub(super) const HUNDRED_EIGHTY_FOURTH_VERSION: &str = "full-card-world/184";
pub(super) const HUNDRED_EIGHTY_THIRD_VERSION: &str = "full-card-world/183";
pub(super) const HUNDRED_EIGHTY_SECOND_VERSION: &str = "full-card-world/182";
pub(super) const HUNDRED_EIGHTY_FIRST_VERSION: &str = "full-card-world/181";
pub(super) const HUNDRED_EIGHTIETH_VERSION: &str = "full-card-world/180";
pub(super) const HUNDRED_SEVENTY_NINTH_VERSION: &str = "full-card-world/179";
pub(super) const HUNDRED_SEVENTY_EIGHTH_VERSION: &str = "full-card-world/178";
pub(super) const HUNDRED_SEVENTY_SEVENTH_VERSION: &str = "full-card-world/177";
pub(super) const HUNDRED_SEVENTY_SIXTH_VERSION: &str = "full-card-world/176";
pub(super) const HUNDRED_SEVENTY_FIFTH_VERSION: &str = "full-card-world/175";
pub(super) const HUNDRED_SEVENTY_FOURTH_VERSION: &str = "full-card-world/174";
pub(super) const HUNDRED_SEVENTY_THIRD_VERSION: &str = "full-card-world/173";
pub(super) const HUNDRED_SEVENTY_SECOND_VERSION: &str = "full-card-world/172";
pub(super) const HUNDRED_SEVENTY_FIRST_VERSION: &str = "full-card-world/171";
pub(super) const HUNDRED_SEVENTIETH_VERSION: &str = "full-card-world/170";
pub(super) const HUNDRED_SIXTY_NINTH_VERSION: &str = "full-card-world/169";
pub(super) const HUNDRED_SIXTY_EIGHTH_VERSION: &str = "full-card-world/168";
pub(super) const HUNDRED_SIXTY_SEVENTH_VERSION: &str = "full-card-world/167";
pub(super) const HUNDRED_SIXTY_SIXTH_VERSION: &str = "full-card-world/166";
pub(super) const HUNDRED_SIXTY_FIFTH_VERSION: &str = "full-card-world/165";
pub(super) const HUNDRED_SIXTY_FOURTH_VERSION: &str = "full-card-world/164";
pub(super) const HUNDRED_SIXTY_THIRD_VERSION: &str = "full-card-world/163";
pub(super) const HUNDRED_SIXTY_SECOND_VERSION: &str = "full-card-world/162";
pub(super) const HUNDRED_SIXTY_FIRST_VERSION: &str = "full-card-world/161";
pub(super) const HUNDRED_SIXTIETH_VERSION: &str = "full-card-world/160";
pub(super) const HUNDRED_FIFTY_NINTH_VERSION: &str = "full-card-world/159";
pub(super) const HUNDRED_FIFTY_EIGHTH_VERSION: &str = "full-card-world/158";
pub(super) const HUNDRED_FIFTY_SEVENTH_VERSION: &str = "full-card-world/157";
pub(super) const HUNDRED_FIFTY_SIXTH_VERSION: &str = "full-card-world/156";
pub(super) const HUNDRED_FIFTY_FIFTH_VERSION: &str = "full-card-world/155";
pub(super) const HUNDRED_FIFTY_FOURTH_VERSION: &str = "full-card-world/154";
pub(super) const HUNDRED_FIFTY_THIRD_VERSION: &str = "full-card-world/153";
pub(super) const HUNDRED_FIFTY_SECOND_VERSION: &str = "full-card-world/152";
pub(super) const HUNDRED_FIFTY_FIRST_VERSION: &str = "full-card-world/151";
pub(super) const HUNDRED_FIFTIETH_VERSION: &str = "full-card-world/150";
pub(super) const HUNDRED_FORTY_NINTH_VERSION: &str = "full-card-world/149";
pub(super) const HUNDRED_FORTY_EIGHTH_VERSION: &str = "full-card-world/148";
pub(super) const HUNDRED_FORTY_SEVENTH_VERSION: &str = "full-card-world/147";
pub(super) const HUNDRED_FORTY_SIXTH_VERSION: &str = "full-card-world/146";
pub(super) const HUNDRED_FORTY_FIFTH_VERSION: &str = "full-card-world/145";
pub(super) const HUNDRED_FORTY_FOURTH_VERSION: &str = "full-card-world/144";
pub(super) const HUNDRED_FORTY_THIRD_VERSION: &str = "full-card-world/143";
pub(super) const HUNDRED_FORTY_SECOND_VERSION: &str = "full-card-world/142";
pub(super) const HUNDRED_FORTY_FIRST_VERSION: &str = "full-card-world/141";
pub(super) const HUNDRED_FORTIETH_VERSION: &str = "full-card-world/140";
pub(super) const HUNDRED_THIRTY_NINTH_VERSION: &str = "full-card-world/139";
pub(super) const HUNDRED_THIRTY_EIGHTH_VERSION: &str = "full-card-world/138";
pub(super) const HUNDRED_THIRTY_SEVENTH_VERSION: &str = "full-card-world/137";
pub(super) const HUNDRED_THIRTY_SIXTH_VERSION: &str = "full-card-world/136";
pub(super) const HUNDRED_THIRTY_FIFTH_VERSION: &str = "full-card-world/135";
pub(super) const HUNDRED_THIRTY_FOURTH_VERSION: &str = "full-card-world/134";
pub(super) const HUNDRED_THIRTY_THIRD_VERSION: &str = "full-card-world/133";
const SOURCE: &str = include_str!("engine-v191.js");
const HUNDRED_NINETIETH_SOURCE: &str = include_str!("engine-v190.js");
const HUNDRED_EIGHTY_NINTH_SOURCE: &str = include_str!("engine-v189.js");
const HUNDRED_EIGHTY_EIGHTH_SOURCE: &str = include_str!("engine-v188.js");
const HUNDRED_EIGHTY_SEVENTH_SOURCE: &str = include_str!("engine-v187.js");
const HUNDRED_EIGHTY_SIXTH_SOURCE: &str = include_str!("engine-v186.js");
const HUNDRED_EIGHTY_FIFTH_SOURCE: &str = include_str!("engine-v185.js");
const HUNDRED_EIGHTY_FOURTH_SOURCE: &str = include_str!("engine-v184.js");
const HUNDRED_EIGHTY_THIRD_SOURCE: &str = include_str!("engine-v183.js");
const HUNDRED_EIGHTY_SECOND_SOURCE: &str = include_str!("engine-v182.js");
const HUNDRED_EIGHTY_FIRST_SOURCE: &str = include_str!("engine-v181.js");
const HUNDRED_EIGHTIETH_SOURCE: &str = include_str!("engine-v180.js");
const HUNDRED_SEVENTY_NINTH_SOURCE: &str = include_str!("engine-v179.js");
const HUNDRED_SEVENTY_EIGHTH_SOURCE: &str = include_str!("engine-v178.js");
const HUNDRED_SEVENTY_SEVENTH_SOURCE: &str = include_str!("engine-v177.js");
const HUNDRED_SEVENTY_SIXTH_SOURCE: &str = include_str!("engine-v176.js");
const HUNDRED_SEVENTY_FIFTH_SOURCE: &str = include_str!("engine-v175.js");
const HUNDRED_SEVENTY_FOURTH_SOURCE: &str = include_str!("engine-v174.js");
const HUNDRED_SEVENTY_THIRD_SOURCE: &str = include_str!("engine-v173.js");
const HUNDRED_SEVENTY_SECOND_SOURCE: &str = include_str!("engine-v172.js");
const HUNDRED_SEVENTY_FIRST_SOURCE: &str = include_str!("engine-v171.js");
const HUNDRED_SEVENTIETH_SOURCE: &str = include_str!("engine-v170.js");
const HUNDRED_SIXTY_NINTH_SOURCE: &str = include_str!("engine-v169.js");
const HUNDRED_SIXTY_EIGHTH_SOURCE: &str = include_str!("engine-v168.js");
const HUNDRED_SIXTY_SEVENTH_SOURCE: &str = include_str!("engine-v167.js");
const HUNDRED_SIXTY_SIXTH_SOURCE: &str = include_str!("engine-v166.js");
const HUNDRED_SIXTY_FIFTH_SOURCE: &str = include_str!("engine-v165.js");
const HUNDRED_SIXTY_FOURTH_SOURCE: &str = include_str!("engine-v164.js");
const HUNDRED_SIXTY_THIRD_SOURCE: &str = include_str!("engine-v163.js");
const HUNDRED_SIXTY_SECOND_SOURCE: &str = include_str!("engine-v162.js");
const HUNDRED_SIXTY_FIRST_SOURCE: &str = include_str!("engine-v161.js");
const HUNDRED_SIXTIETH_SOURCE: &str = include_str!("engine-v160.js");
const HUNDRED_FIFTY_NINTH_SOURCE: &str = include_str!("engine-v159.js");
const HUNDRED_FIFTY_EIGHTH_SOURCE: &str = include_str!("engine-v158.js");
const HUNDRED_FIFTY_SEVENTH_SOURCE: &str = include_str!("engine-v157.js");
const HUNDRED_FIFTY_SIXTH_SOURCE: &str = include_str!("engine-v156.js");
const HUNDRED_FIFTY_FIFTH_SOURCE: &str = include_str!("engine-v155.js");
const HUNDRED_FIFTY_FOURTH_SOURCE: &str = include_str!("engine-v154.js");
const HUNDRED_FIFTY_THIRD_SOURCE: &str = include_str!("engine-v153.js");
const HUNDRED_FIFTY_SECOND_SOURCE: &str = include_str!("engine-v152.js");
const HUNDRED_FIFTY_FIRST_SOURCE: &str = include_str!("engine-v151.js");
const HUNDRED_FIFTIETH_SOURCE: &str = include_str!("engine-v150.js");
const HUNDRED_FORTY_NINTH_SOURCE: &str = include_str!("engine-v149.js");
const HUNDRED_FORTY_EIGHTH_SOURCE: &str = include_str!("engine-v148.js");
const HUNDRED_FORTY_SEVENTH_SOURCE: &str = include_str!("engine-v147.js");
const HUNDRED_FORTY_SIXTH_SOURCE: &str = include_str!("engine-v146.js");
const HUNDRED_FORTY_FIFTH_SOURCE: &str = include_str!("engine-v145.js");
const HUNDRED_FORTY_FOURTH_SOURCE: &str = include_str!("engine-v144.js");
const HUNDRED_FORTY_THIRD_SOURCE: &str = include_str!("engine-v143.js");
const HUNDRED_FORTY_SECOND_SOURCE: &str = include_str!("engine-v142.js");
const HUNDRED_FORTY_FIRST_SOURCE: &str = include_str!("engine-v141.js");
const HUNDRED_FORTIETH_SOURCE: &str = include_str!("engine-v140.js");
const HUNDRED_THIRTY_NINTH_SOURCE: &str = include_str!("engine-v139.js");
const HUNDRED_THIRTY_EIGHTH_SOURCE: &str = include_str!("engine-v138.js");
const HUNDRED_THIRTY_SEVENTH_SOURCE: &str = include_str!("engine-v137.js");
const HUNDRED_THIRTY_SIXTH_SOURCE: &str = include_str!("engine-v136.js");
const HUNDRED_THIRTY_FIFTH_SOURCE: &str = include_str!("engine-v135.js");
const HUNDRED_THIRTY_FOURTH_SOURCE: &str = include_str!("engine-v134.js");
const HUNDRED_THIRTY_THIRD_SOURCE: &str = include_str!("engine-v133.js");
/// The current rules' source, whose words an imported save may use.
pub(super) fn current_source() -> &'static str {
    SOURCE
}
// A world saved by rules newer than this server's: a release swap briefly
// runs the older build (docs/release.md), so the world waits, unchanged.
pub(super) const UPDATING: &str = "This world is updating. Back in a moment.";
pub(super) fn newer(version: &str) -> bool {
    let number = |v: &str| v.strip_prefix("full-card-world/")?.parse::<u32>().ok();
    number(version)
        .zip(number(VERSION))
        .is_some_and(|(v, ours)| v > ours)
}
pub(super) fn historical(version: &str) -> bool {
    matches!(
        version,
        HUNDRED_THIRTY_THIRD_VERSION
            | HUNDRED_THIRTY_FOURTH_VERSION
            | HUNDRED_THIRTY_FIFTH_VERSION
            | HUNDRED_THIRTY_SIXTH_VERSION
            | HUNDRED_THIRTY_SEVENTH_VERSION
            | HUNDRED_THIRTY_EIGHTH_VERSION
            | HUNDRED_THIRTY_NINTH_VERSION
            | HUNDRED_FORTIETH_VERSION
            | HUNDRED_FORTY_FIRST_VERSION
            | HUNDRED_FORTY_SECOND_VERSION
            | HUNDRED_FORTY_THIRD_VERSION
            | HUNDRED_FORTY_FOURTH_VERSION
            | HUNDRED_FORTY_FIFTH_VERSION
            | HUNDRED_FORTY_SIXTH_VERSION
            | HUNDRED_FORTY_SEVENTH_VERSION
            | HUNDRED_FORTY_EIGHTH_VERSION
            | HUNDRED_FORTY_NINTH_VERSION
            | HUNDRED_FIFTIETH_VERSION
            | HUNDRED_FIFTY_FIRST_VERSION
            | HUNDRED_FIFTY_SECOND_VERSION
            | HUNDRED_FIFTY_THIRD_VERSION
            | HUNDRED_FIFTY_FOURTH_VERSION
            | HUNDRED_FIFTY_FIFTH_VERSION
            | HUNDRED_FIFTY_SIXTH_VERSION
            | HUNDRED_FIFTY_SEVENTH_VERSION
            | HUNDRED_FIFTY_EIGHTH_VERSION
            | HUNDRED_FIFTY_NINTH_VERSION
            | HUNDRED_SIXTIETH_VERSION
            | HUNDRED_SIXTY_FIRST_VERSION
            | HUNDRED_SIXTY_SECOND_VERSION
            | HUNDRED_SIXTY_THIRD_VERSION
            | HUNDRED_SIXTY_FOURTH_VERSION
            | HUNDRED_SIXTY_FIFTH_VERSION
            | HUNDRED_SIXTY_SIXTH_VERSION
            | HUNDRED_SIXTY_SEVENTH_VERSION
            | HUNDRED_SIXTY_EIGHTH_VERSION
            | HUNDRED_SIXTY_NINTH_VERSION
            | HUNDRED_SEVENTIETH_VERSION
            | HUNDRED_SEVENTY_FIRST_VERSION
            | HUNDRED_SEVENTY_SECOND_VERSION
            | HUNDRED_SEVENTY_THIRD_VERSION
            | HUNDRED_SEVENTY_FOURTH_VERSION
            | HUNDRED_SEVENTY_FIFTH_VERSION
            | HUNDRED_SEVENTY_SIXTH_VERSION
            | HUNDRED_SEVENTY_SEVENTH_VERSION
            | HUNDRED_SEVENTY_EIGHTH_VERSION
            | HUNDRED_SEVENTY_NINTH_VERSION
            | HUNDRED_EIGHTIETH_VERSION
            | HUNDRED_EIGHTY_FIRST_VERSION
            | HUNDRED_EIGHTY_SECOND_VERSION
            | HUNDRED_EIGHTY_THIRD_VERSION
            | HUNDRED_EIGHTY_FOURTH_VERSION
            | HUNDRED_EIGHTY_FIFTH_VERSION
            | HUNDRED_EIGHTY_SIXTH_VERSION
            | HUNDRED_EIGHTY_SEVENTH_VERSION
            | HUNDRED_EIGHTY_EIGHTH_VERSION
            | HUNDRED_EIGHTY_NINTH_VERSION
            | HUNDRED_NINETIETH_VERSION
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

fn view_cache_key(version: &str, input: &str) -> String {
    let mut hash = Sha256::new();
    hash.update(version.as_bytes());
    hash.update([0]);
    hash.update(input.as_bytes());
    format!("{version}:{:x}", hash.finalize())
}

pub(super) fn reduce(request: Value) -> Result<Value> {
    reduce_pack(VERSION, Some(content::current()), request)
}
// Tests reduce released rules directly; content-taking rules get this binary's.
#[cfg(test)]
pub(super) fn reduce_version(version: &str, request: Value) -> Result<Value> {
    reduce_pack(version, Some(content::current()), request)
}
pub(super) fn reduce_pack(version: &str, pack: Option<&str>, request: Value) -> Result<Value> {
    let source = source(version).ok_or("This world needs a supported rules version.")?;
    let pack = pack.ok_or("This world's pack content needs recovery.")?;
    let content = content::text(pack)?;
    reduce_source(version, source, Some((&*content, pack)), request)
}
fn source(version: &str) -> Option<&'static str> {
    Some(match version {
        VERSION => SOURCE,
        HUNDRED_NINETIETH_VERSION => HUNDRED_NINETIETH_SOURCE,
        HUNDRED_EIGHTY_NINTH_VERSION => HUNDRED_EIGHTY_NINTH_SOURCE,
        HUNDRED_EIGHTY_EIGHTH_VERSION => HUNDRED_EIGHTY_EIGHTH_SOURCE,
        HUNDRED_EIGHTY_SEVENTH_VERSION => HUNDRED_EIGHTY_SEVENTH_SOURCE,
        HUNDRED_EIGHTY_SIXTH_VERSION => HUNDRED_EIGHTY_SIXTH_SOURCE,
        HUNDRED_EIGHTY_FIFTH_VERSION => HUNDRED_EIGHTY_FIFTH_SOURCE,
        HUNDRED_EIGHTY_FOURTH_VERSION => HUNDRED_EIGHTY_FOURTH_SOURCE,
        HUNDRED_EIGHTY_THIRD_VERSION => HUNDRED_EIGHTY_THIRD_SOURCE,
        HUNDRED_EIGHTY_SECOND_VERSION => HUNDRED_EIGHTY_SECOND_SOURCE,
        HUNDRED_EIGHTY_FIRST_VERSION => HUNDRED_EIGHTY_FIRST_SOURCE,
        HUNDRED_EIGHTIETH_VERSION => HUNDRED_EIGHTIETH_SOURCE,
        HUNDRED_SEVENTY_NINTH_VERSION => HUNDRED_SEVENTY_NINTH_SOURCE,
        HUNDRED_SEVENTY_EIGHTH_VERSION => HUNDRED_SEVENTY_EIGHTH_SOURCE,
        HUNDRED_SEVENTY_SEVENTH_VERSION => HUNDRED_SEVENTY_SEVENTH_SOURCE,
        HUNDRED_SEVENTY_SIXTH_VERSION => HUNDRED_SEVENTY_SIXTH_SOURCE,
        HUNDRED_SEVENTY_FIFTH_VERSION => HUNDRED_SEVENTY_FIFTH_SOURCE,
        HUNDRED_SEVENTY_FOURTH_VERSION => HUNDRED_SEVENTY_FOURTH_SOURCE,
        HUNDRED_SEVENTY_THIRD_VERSION => HUNDRED_SEVENTY_THIRD_SOURCE,
        HUNDRED_SEVENTY_SECOND_VERSION => HUNDRED_SEVENTY_SECOND_SOURCE,
        HUNDRED_SEVENTY_FIRST_VERSION => HUNDRED_SEVENTY_FIRST_SOURCE,
        HUNDRED_SEVENTIETH_VERSION => HUNDRED_SEVENTIETH_SOURCE,
        HUNDRED_SIXTY_NINTH_VERSION => HUNDRED_SIXTY_NINTH_SOURCE,
        HUNDRED_SIXTY_EIGHTH_VERSION => HUNDRED_SIXTY_EIGHTH_SOURCE,
        HUNDRED_SIXTY_SEVENTH_VERSION => HUNDRED_SIXTY_SEVENTH_SOURCE,
        HUNDRED_SIXTY_SIXTH_VERSION => HUNDRED_SIXTY_SIXTH_SOURCE,
        HUNDRED_SIXTY_FIFTH_VERSION => HUNDRED_SIXTY_FIFTH_SOURCE,
        HUNDRED_SIXTY_FOURTH_VERSION => HUNDRED_SIXTY_FOURTH_SOURCE,
        HUNDRED_SIXTY_THIRD_VERSION => HUNDRED_SIXTY_THIRD_SOURCE,
        HUNDRED_SIXTY_SECOND_VERSION => HUNDRED_SIXTY_SECOND_SOURCE,
        HUNDRED_SIXTY_FIRST_VERSION => HUNDRED_SIXTY_FIRST_SOURCE,
        HUNDRED_SIXTIETH_VERSION => HUNDRED_SIXTIETH_SOURCE,
        HUNDRED_FIFTY_NINTH_VERSION => HUNDRED_FIFTY_NINTH_SOURCE,
        HUNDRED_FIFTY_EIGHTH_VERSION => HUNDRED_FIFTY_EIGHTH_SOURCE,
        HUNDRED_FIFTY_SEVENTH_VERSION => HUNDRED_FIFTY_SEVENTH_SOURCE,
        HUNDRED_FIFTY_SIXTH_VERSION => HUNDRED_FIFTY_SIXTH_SOURCE,
        HUNDRED_FIFTY_FIFTH_VERSION => HUNDRED_FIFTY_FIFTH_SOURCE,
        HUNDRED_FIFTY_FOURTH_VERSION => HUNDRED_FIFTY_FOURTH_SOURCE,
        HUNDRED_FIFTY_THIRD_VERSION => HUNDRED_FIFTY_THIRD_SOURCE,
        HUNDRED_FIFTY_SECOND_VERSION => HUNDRED_FIFTY_SECOND_SOURCE,
        HUNDRED_FIFTY_FIRST_VERSION => HUNDRED_FIFTY_FIRST_SOURCE,
        HUNDRED_FIFTIETH_VERSION => HUNDRED_FIFTIETH_SOURCE,
        HUNDRED_FORTY_NINTH_VERSION => HUNDRED_FORTY_NINTH_SOURCE,
        HUNDRED_FORTY_EIGHTH_VERSION => HUNDRED_FORTY_EIGHTH_SOURCE,
        HUNDRED_FORTY_SEVENTH_VERSION => HUNDRED_FORTY_SEVENTH_SOURCE,
        HUNDRED_FORTY_SIXTH_VERSION => HUNDRED_FORTY_SIXTH_SOURCE,
        HUNDRED_FORTY_FIFTH_VERSION => HUNDRED_FORTY_FIFTH_SOURCE,
        HUNDRED_FORTY_FOURTH_VERSION => HUNDRED_FORTY_FOURTH_SOURCE,
        HUNDRED_FORTY_THIRD_VERSION => HUNDRED_FORTY_THIRD_SOURCE,
        HUNDRED_FORTY_SECOND_VERSION => HUNDRED_FORTY_SECOND_SOURCE,
        HUNDRED_FORTY_FIRST_VERSION => HUNDRED_FORTY_FIRST_SOURCE,
        HUNDRED_FORTIETH_VERSION => HUNDRED_FORTIETH_SOURCE,
        HUNDRED_THIRTY_NINTH_VERSION => HUNDRED_THIRTY_NINTH_SOURCE,
        HUNDRED_THIRTY_EIGHTH_VERSION => HUNDRED_THIRTY_EIGHTH_SOURCE,
        HUNDRED_THIRTY_SEVENTH_VERSION => HUNDRED_THIRTY_SEVENTH_SOURCE,
        HUNDRED_THIRTY_SIXTH_VERSION => HUNDRED_THIRTY_SIXTH_SOURCE,
        HUNDRED_THIRTY_FIFTH_VERSION => HUNDRED_THIRTY_FIFTH_SOURCE,
        HUNDRED_THIRTY_FOURTH_VERSION => HUNDRED_THIRTY_FOURTH_SOURCE,
        HUNDRED_THIRTY_THIRD_VERSION => HUNDRED_THIRTY_THIRD_SOURCE,
        _ => return None,
    })
}
fn reduce_source(
    version: &str,
    source: &str,
    content: Option<(&str, &str)>,
    request: Value,
) -> Result<Value> {
    let view = request["op"] == "view";
    let input = serde_json::to_string(&request).map_err(|_| "Choose a saved world.".to_string())?;
    if input.len() > MAX_BYTES {
        return Err("This saved world is too large to share.".into());
    }
    // Two content revisions under one engine never share a cached view.
    let cache_key = view.then(|| match content {
        Some((_, pack)) => view_cache_key(&format!("{version}+{pack}"), &input),
        None => view_cache_key(version, &input),
    });
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
    // The deadline bounds one request. When it fires, QuickJS throws an
    // uncatchable interrupt; record it so a slow host is reported as a
    // timeout rather than as the rules rejecting a stale play.
    let deadline = Instant::now() + Duration::from_secs(2);
    let interrupted = Arc::new(AtomicBool::new(false));
    let flag = interrupted.clone();
    runtime.set_interrupt_handler(Some(Box::new(move || {
        let expired = Instant::now() > deadline;
        if expired {
            flag.store(true, Ordering::Relaxed);
        }
        expired
    })));
    let context = Context::full(&runtime).map_err(engine_error)?;
    let output = context.with(|ctx| -> Result<String> {
        ctx.eval::<(), _>("globalThis.structuredClone = value => JSON.parse(JSON.stringify(value)); globalThis.Date = undefined; Math.random = () => { throw new Error('Randomness must come from the saved world.'); };")
            .map_err(engine_error)?;
        if let Some((content, _)) = content {
            let content = ctx.json_parse(content).map_err(engine_error)?;
            ctx.globals().set("cardContent", content).map_err(engine_error)?;
        }
        ctx.eval::<(), _>(source).map_err(|error| {
            if interrupted.load(Ordering::Relaxed) {
                return deadline_error(version);
            }
            tracing::error!(error=%error, exception=?ctx.catch(), "shared rules failed to load");
            "The shared-world rules need attention.".to_string()
        })?;
        let entry: Function = ctx.globals().get("cardShared").map_err(engine_error)?;
        entry.call((input.as_str(),)).map_err(|error| {
            if interrupted.load(Ordering::Relaxed) {
                return deadline_error(version);
            }
            tracing::error!(error=%error, exception=?ctx.catch(), "shared rules crashed on a request");
            RULES_FAULT.to_string()
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
const DEADLINE_ERROR: &str = "The shared world is taking a moment. Try again.";
const RULES_FAULT: &str = "The shared-world rules hit an error. Nothing changed.";
fn deadline_error(version: &str) -> String {
    tracing::warn!(version, "shared rules reached the interpreter deadline");
    DEADLINE_ERROR.into()
}
fn engine_error(error: impl std::fmt::Display) -> String {
    tracing::warn!(error=%error, "shared C interpreter error");
    "The shared world is taking a moment. Try again.".into()
}

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
            view_cache_key(HUNDRED_THIRTY_THIRD_VERSION, &input.to_string())
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
    fn compact_keys_keep_eight_large_views_within_the_existing_budget() {
        let mut cache = Views::default();
        let world = "saved world ".repeat(48 * 1024);
        let output = "view".repeat(96 * 1024);
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
