//! Per-process miss ownership. SQLite, not this gate, chooses the durable clip.
use super::Failure;
use std::{
    collections::HashMap,
    path::{Path, PathBuf},
    sync::{Arc, Mutex, Weak},
};
use tokio::sync::Mutex as AsyncMutex;

const MAX_FLIGHTS: usize = 64;
type Key = (PathBuf, String, String);

#[derive(Default)]
pub(super) struct Flights(Mutex<HashMap<Key, Weak<AsyncMutex<()>>>>);

impl Flights {
    pub(super) fn gate(
        &self,
        path: &Path,
        world: &str,
        id: &str,
    ) -> Result<Arc<AsyncMutex<()>>, Failure> {
        let mut gates = self.0.lock().map_err(|e| Failure::Store(e.to_string()))?;
        // Owners and waiters keep a gate alive; success, error and cancellation
        // drop it. Dead keys never accumulate and unrelated keys never queue.
        gates.retain(|_, gate| gate.strong_count() > 0);
        let key = (path.to_owned(), world.to_owned(), id.to_owned());
        if let Some(gate) = gates.get(&key).and_then(Weak::upgrade) {
            return Ok(gate);
        }
        if gates.len() >= MAX_FLIGHTS {
            return Err(Failure::Store("The voice cache is busy. Try again.".into()));
        }
        let gate = Arc::new(AsyncMutex::new(()));
        gates.insert(key, Arc::downgrade(&gate));
        Ok(gate)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn gates_are_keyed_bounded_and_reclaimed() {
        let flights = Flights::default();
        let path = Path::new("one.sqlite");
        let held: Vec<_> = (0..MAX_FLIGHTS)
            .map(|i| flights.gate(path, "w1", &i.to_string()).unwrap())
            .collect();
        assert!(Arc::ptr_eq(
            &held[0],
            &flights.gate(path, "w1", "0").unwrap()
        ));
        assert!(flights.gate(path, "w2", "0").is_err());
        assert!(flights.gate(Path::new("two.sqlite"), "w1", "0").is_err());
        drop(held);
        assert!(flights.gate(path, "w2", "0").is_ok());
        assert!(flights.0.lock().unwrap().len() <= MAX_FLIGHTS);
    }
}
