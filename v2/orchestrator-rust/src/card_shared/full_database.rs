//! Fair admission keeps shared polls and publication from competing for SQLite's writer.
use super::super::store::Result;
use std::{
    collections::HashMap,
    path::PathBuf,
    sync::{Arc, Mutex, OnceLock, Weak},
};
use tokio::sync::Mutex as Queue;

type Key = Option<Arc<PathBuf>>;
type Gates = HashMap<Key, Weak<Queue<()>>>;

fn admission(path: Key) -> Result<Arc<Queue<()>>> {
    static GATES: OnceLock<Mutex<Gates>> = OnceLock::new();
    let mut gates = GATES
        .get_or_init(|| Mutex::new(HashMap::new()))
        .lock()
        .map_err(|_| "The shared world is taking a moment.".to_string())?;
    gates.retain(|_, gate| gate.strong_count() > 0);
    if let Some(gate) = gates.get(&path).and_then(Weak::upgrade) {
        return Ok(gate);
    }
    let gate = Arc::new(Queue::new(()));
    gates.insert(path, Arc::downgrade(&gate));
    Ok(gate)
}

pub(super) async fn blocking<T: Send + 'static>(
    path: Key,
    f: impl FnOnce() -> Result<T> + Send + 'static,
) -> Result<T> {
    let guard = admission(path)?.lock_owned().await;
    tokio::task::spawn_blocking(move || {
        // A cancelled HTTP waiter leaves its running transaction guarded.
        let _guard = guard;
        f()
    })
    .await
    .map_err(|_| "The shared world is taking a moment.".to_string())?
}

#[cfg(test)]
#[path = "full_database_tests.rs"]
mod tests;
