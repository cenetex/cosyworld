//! Dialogue context for committed shared plays. Like the rules engine it runs
//! in QuickJS with no IO, clocks or randomness, but its output only feeds the
//! story service and is never a journal input. The bundle is rebuilt from
//! current sources, so it only describes worlds on the current rules; live
//! worlds always upgrade on load. See
//! docs/design/pack-content-outside-the-engine.md.
use super::store::Result;
use rquickjs::{Context, Function, Runtime};
use serde_json::Value;
use std::{
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc,
    },
    time::{Duration, Instant},
};

const SOURCE: &str = include_str!("narrator.js");
const MAX_BYTES: usize = 4 * 1024 * 1024;

/// The dialogue context for `request`: a `view`-shaped request for the world
/// after a committed play, plus that play's `action`.
pub(super) fn context(request: &Value) -> Result<Value> {
    Ok(describe(request)?["context"].take())
}
/// The drawn scene the browser shows for the same request.
#[cfg(test)]
pub(super) fn scene(request: &Value) -> Result<Value> {
    let mut request = request.clone();
    request["scene"] = Value::Bool(true);
    Ok(describe(&request)?["scene"].take())
}
fn describe(request: &Value) -> Result<Value> {
    let input = serde_json::to_string(request).map_err(|_| "Choose a saved world.".to_string())?;
    if input.len() > MAX_BYTES {
        return Err("This saved world is too large to share.".into());
    }
    let runtime = Runtime::new().map_err(host_error)?;
    runtime.set_memory_limit(96 * 1024 * 1024);
    runtime.set_max_stack_size(1024 * 1024);
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
    let context = Context::full(&runtime).map_err(host_error)?;
    let output = context.with(|ctx| -> Result<String> {
        ctx.eval::<(), _>("globalThis.structuredClone = value => JSON.parse(JSON.stringify(value)); globalThis.Date = undefined; Math.random = () => { throw new Error('Randomness must come from the saved world.'); };")
            .map_err(host_error)?;
        ctx.eval::<(), _>(SOURCE).map_err(|error| {
            tracing::error!(error=%error, exception=?ctx.catch(), "shared narrator failed to load");
            "The shared world is taking a moment. Try again.".to_string()
        })?;
        let entry: Function = ctx.globals().get("cardNarrator").map_err(host_error)?;
        entry.call((input.as_str(),)).map_err(|error| {
            if interrupted.load(Ordering::Relaxed) {
                tracing::warn!("shared narrator reached the interpreter deadline");
            } else {
                tracing::warn!(error=%error, exception=?ctx.catch(), "shared narrator failed");
            }
            "The shared world is taking a moment. Try again.".to_string()
        })
    })?;
    let value: Value = serde_json::from_str(&output)
        .map_err(|_| "The shared world is taking a moment. Try again.".to_string())?;
    if value["ok"] != true || !value["context"].is_object() {
        tracing::warn!(error=?value["error"], "shared narrator refused a scene");
        return Err("The shared world is taking a moment. Try again.".into());
    }
    Ok(value)
}
fn host_error(error: impl std::fmt::Display) -> String {
    tracing::warn!(error=%error, "shared narrator interpreter error");
    "The shared world is taking a moment. Try again.".into()
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn describes_a_committed_play() {
        let created = super::super::engine::reduce(json!({"op":"create"})).unwrap();
        let request =
            json!({"world":created["world"],"actor":"vale","claimed":["vale"],"present":["vale"]});
        let view = super::super::engine::reduce(json!({"op":"view","world":created["world"],"actor":"vale","claimed":["vale"],"present":["vale"]})).unwrap();
        let action = view["actions"][0].clone();
        let mut play = request.clone();
        play["op"] = json!("play");
        play["action"] = action.clone();
        let played = super::super::engine::reduce(play).unwrap();
        let mut scene = request.clone();
        scene["world"] = played["world"].clone();
        scene["action"] = action;
        let told = context(&scene).unwrap();
        assert_eq!(told["revision"], played["world"]["revision"]);
        assert_eq!(told["speakers"][0], "vale");
        assert!(super::scene(&scene).unwrap()["background"].is_string());
    }

    #[test]
    fn refuses_a_request_without_a_world() {
        assert!(context(&json!({"actor":"vale"})).is_err());
    }
}
