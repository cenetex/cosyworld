//! Rust passes JSON to QuickJS with no filesystem, network, clock or entropy access.
use super::{content, store::Result};
use cosyworld_orchestrator::card_assets;
use rquickjs::{Context, Function, Runtime};
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::{
    collections::{HashMap, VecDeque},
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex, OnceLock,
    },
    time::{Duration, Instant},
};

/// The current rules' source, whose words an imported save may use.
pub(super) fn current_source() -> &'static str {
    source(version()).expect("the current rules bundle")
}
// A world saved by rules newer than this server's: a release swap briefly
// runs the older build (docs/release.md), so the world waits, unchanged.
pub(super) const UPDATING: &str = "This world is updating. Back in a moment.";
pub(super) fn newer(version: &str) -> bool {
    let number = |v: &str| v.strip_prefix("full-card-world/")?.parse::<u32>().ok();
    number(version)
        .zip(number(self::version()))
        .is_some_and(|(v, ours)| v > ours)
}
pub(super) fn historical(version: &str) -> bool {
    version != self::version() && versions().any(|v| v == version)
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
    reduce_pack(version(), Some(content::current()), request)
}
#[cfg(test)]
pub(super) fn reduce_version(version: &str, request: Value) -> Result<Value> {
    reduce_pack(version, Some(content::current()), request)
}
pub(super) fn reduce_pack(version: &str, pack: Option<&str>, request: Value) -> Result<Value> {
    let value = reduce_pack_envelope(version, pack, request)?;
    if let Some(message) = refusal(&value) {
        return Err(message.chars().take(240).collect());
    }
    Ok(value)
}
pub(super) fn reduce_pack_envelope(
    version: &str,
    pack: Option<&str>,
    request: Value,
) -> Result<Value> {
    let source = source(version).ok_or("This world needs a supported rules version.")?;
    let pack = pack.ok_or("This world's pack content needs recovery.")?;
    let content = content::text(pack)?;
    reduce_source(version, source, Some((&*content, pack)), request)
}
fn refusal(value: &Value) -> Option<&str> {
    value["error"]
        .as_str()
        .or_else(|| (value["ok"] == false).then_some("Choose from the current cards."))
}
struct Pins(Vec<(String, String)>);

fn pinned(store: &card_assets::Store) -> Result<Pins> {
    let text = store
        .read("card_shared/rules.json")
        .ok_or("rules.json is missing")?;
    let pins: std::collections::BTreeMap<u32, String> =
        serde_json::from_slice(&text).map_err(|e| format!("rules.json: {e}"))?;
    let newest = pins.keys().last().copied().unwrap_or_default();
    if let Some(gap) = (super::full_floor::FLOOR..=newest).find(|n| !pins.contains_key(n)) {
        return Err(format!("rules.json does not pin rules {gap}"));
    }
    let mut versions = Vec::new();
    for (number, sha256) in pins {
        if store.sha256(&format!("card_shared/engine-v{number}.js")) != Some(&sha256) {
            return Err(format!("engine-v{number}.js does not match rules.json"));
        }
        versions.push((format!("full-card-world/{number}"), sha256));
    }
    if versions.is_empty() {
        return Err("rules.json lists no versions".into());
    }
    Ok(Pins(versions))
}
fn pins() -> Result<&'static Pins> {
    static PINS: OnceLock<Result<Pins>> = OnceLock::new();
    let pins = PINS.get_or_init(|| pinned(card_assets::load()?));
    pins.as_ref().map_err(Clone::clone)
}
fn table() -> &'static [(String, String)] {
    &pins()
        .unwrap_or_else(|error| panic!("Shared rules: {error}"))
        .0
}
pub(super) fn version() -> &'static str {
    &table().last().expect("rules.json names a version").0
}
pub(super) fn versions() -> impl Iterator<Item = &'static str> {
    table().iter().map(|(version, _)| version.as_str())
}
pub(crate) fn check_rules() -> Result<()> {
    pins().map(|_| ())
}
fn source(version: &str) -> Option<&'static str> {
    static SOURCES: OnceLock<Mutex<HashMap<String, &'static str>>> = OnceLock::new();
    let mut sources = SOURCES.get_or_init(Default::default).lock().ok()?;
    if let Some(source) = sources.get(version) {
        return Some(source);
    }
    let pins = pins().ok()?;
    pins.0.iter().find(|(v, _)| v == version)?;
    let number = version.strip_prefix("full-card-world/")?;
    let bytes = card_assets::read(&format!("card_shared/engine-v{number}.js"))?;
    let source: &'static str = String::from_utf8(bytes.to_vec()).ok()?.leak();
    sources.insert(version.to_string(), source);
    Some(source)
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
    // Cache successful projections by their exact serialized inputs.
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
    // A deadline interrupt must surface as a timeout so callers can retry.
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
    if let Some(cache_key) = cache_key.filter(|_| refusal(&value).is_none()) {
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
    fn every_pinned_version_runs_exactly_its_pinned_bytes() {
        for (version, sha256) in &pins().unwrap().0 {
            let source = source(version).unwrap();
            assert_eq!(
                &format!("{:x}", Sha256::digest(source)),
                sha256,
                "{version}"
            );
        }
        assert_ne!(source("full-card-world/203"), source(version()));
        assert!(source("full-card-world/132").is_none());
    }

    #[test]
    fn a_bundle_that_differs_from_its_pin_is_refused() {
        let root = std::env::temp_dir().join(format!("rules-pins-{}", std::process::id()));
        let dir = root.join("card_shared");
        std::fs::create_dir_all(&dir).unwrap();
        let hex = |bytes: &[u8]| format!("{:x}", Sha256::digest(bytes));
        let bundle = b"globalThis.cardShared = () => '{}';";
        let number = "1";
        for (pinned_to, accepted) in [(&bundle[..], true), (b"older bytes", false)] {
            let rules = serde_json::json!({ number: hex(pinned_to) }).to_string();
            let mut files = serde_json::Map::new();
            for (name, bytes) in [("rules.json", rules.as_bytes()), ("engine-v0.js", bundle)] {
                let name = name.replace("v0", &format!("v{number}"));
                std::fs::write(dir.join(&name), bytes).unwrap();
                let entry = serde_json::json!({"sha256": hex(bytes), "size": bytes.len()});
                files.insert(format!("card_shared/{name}"), entry);
            }
            let dirs = serde_json::json!({"card_shared": "card_shared"});
            let manifest = serde_json::json!({"sha256": "", "dirs": dirs, "files": files});
            std::fs::write(root.join("manifest.json"), manifest.to_string()).unwrap();
            let store = card_assets::Store::open(&root).unwrap();
            assert_eq!(pinned(&store).is_ok(), accepted);
        }
        std::fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn a_version_missing_between_the_floor_and_the_newest_is_refused() {
        let root = std::env::temp_dir().join(format!("rules-gap-{}", std::process::id()));
        let dir = root.join("card_shared");
        std::fs::create_dir_all(&dir).unwrap();
        let entry = |bytes: &[u8]| serde_json::json!({"sha256": format!("{:x}", Sha256::digest(bytes)), "size": bytes.len()});
        let floor = super::super::full_floor::FLOOR;
        let (mut pins, mut files) = (serde_json::Map::new(), serde_json::Map::new());
        for number in [floor, floor + 2] {
            let bundle = format!("globalThis.cardShared = () => '{number}';");
            std::fs::write(dir.join(format!("engine-v{number}.js")), &bundle).unwrap();
            pins.insert(
                number.to_string(),
                entry(bundle.as_bytes())["sha256"].clone(),
            );
            files.insert(
                format!("card_shared/engine-v{number}.js"),
                entry(bundle.as_bytes()),
            );
        }
        let rules = serde_json::Value::Object(pins).to_string();
        std::fs::write(dir.join("rules.json"), &rules).unwrap();
        files.insert("card_shared/rules.json".into(), entry(rules.as_bytes()));
        let dirs = serde_json::json!({"card_shared": "card_shared"});
        let manifest = serde_json::json!({"sha256": "", "dirs": dirs, "files": files});
        std::fs::write(root.join("manifest.json"), manifest.to_string()).unwrap();
        let store = card_assets::Store::open(&root).unwrap();
        let refused = pinned(&store).err();
        assert_eq!(
            refused,
            Some(format!("rules.json does not pin rules {}", floor + 1))
        );
        std::fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn view_cache_keys_cover_the_exact_world_and_viewer() {
        let input = serde_json::json!({
            "op":"view", "world":{"revision":4}, "actor":"vale",
            "claimed":["vale"], "present":["vale"]
        });
        let original = view_cache_key(version(), &input.to_string());
        assert_eq!(original, view_cache_key(version(), &input.to_string()));
        assert_ne!(
            original,
            view_cache_key("full-card-world/133", &input.to_string())
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
                view_cache_key(version(), &changed.to_string()),
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
            let key = view_cache_key(version(), &input);
            assert!(key.len() < 128);
            original_bytes += version().len() + 1 + input.len() + output.len();
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
