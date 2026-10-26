//! The shipping card rules run in QuickJS, a C interpreter. Rust supplies JSON
//! and owns IO; the interpreter has no filesystem, network, clocks or randomness.
use super::store::Result;
use rquickjs::{Context, Function, Runtime};
use serde_json::Value;
use std::time::{Duration, Instant};

pub(super) const VERSION: &str = "full-card-world/2";
const SOURCE: &str = include_str!("engine-v2.js");
const MAX_BYTES: usize = 4 * 1024 * 1024;

pub(super) fn reduce(request: Value) -> Result<Value> {
    let input = serde_json::to_string(&request).map_err(|_| "Choose a saved world.".to_string())?;
    if input.len() > MAX_BYTES {
        return Err("This saved world is too large to share.".into());
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
        ctx.eval::<(), _>(SOURCE).map_err(|error| {
            tracing::error!(error=%error, exception=?ctx.catch(), "shared rules failed to load");
            "The shared-world rules need attention.".to_string()
        })?;
        let entry: Function = ctx.globals().get("cardShared").map_err(engine_error)?;
        entry.call((input,)).map_err(|error| {
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
    Ok(value)
}
fn engine_error(error: impl std::fmt::Display) -> String {
    tracing::warn!(error=%error, "shared C interpreter error");
    "The shared world is taking a moment. Try again.".into()
}
