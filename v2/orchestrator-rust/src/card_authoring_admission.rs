//! Who may start a paid maker generation now. Text and image have separate pools,
//! so a card draw never waits for an image and an image never waits for a draw.
use std::{
    collections::{HashMap, VecDeque},
    path::{Path, PathBuf},
    sync::{Arc, Mutex, OnceLock},
    time::{Duration, Instant},
};

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(super) enum Pool {
    Text,
    Image,
}

impl Pool {
    fn index(self) -> usize {
        self as usize
    }
    /// Starts per owner per minute.
    fn per_minute(self) -> usize {
        match self {
            Self::Text => 18,
            Self::Image => 6,
        }
    }
    /// The longest a run may hold its slot; the run itself is cut off at this point.
    pub(super) fn deadline(self) -> Duration {
        match self {
            Self::Text => Duration::from_secs(90),
            Self::Image => Duration::from_secs(180),
        }
    }
    fn noun(self) -> &'static str {
        match self {
            Self::Text => "card draw",
            Self::Image => "image",
        }
    }
}

const ACTIVE_PER_OWNER: usize = 1;
const ACTIVE_PER_POOL: usize = 2;
const WINDOW: Duration = Duration::from_secs(60);

/// Which limit refused, in words a person can act on, and when to try again.
#[derive(Debug, Eq, PartialEq)]
pub(super) struct Refusal {
    pub code: &'static str,
    pub message: String,
    pub retry_after_ms: u64,
}

#[derive(Default)]
struct PoolState {
    next: u64,
    active: Vec<(u64, String, Instant)>,
    starts: HashMap<String, VecDeque<Instant>>,
}
#[derive(Default)]
struct Gate {
    pools: [PoolState; 2],
}
type Shared = Arc<Mutex<Gate>>;

/// One gate per event store, so the server has exactly one and tests stay apart.
fn gate(scope: Option<&Path>) -> Shared {
    static GATES: OnceLock<Mutex<HashMap<PathBuf, Shared>>> = OnceLock::new();
    let mut gates = GATES
        .get_or_init(Default::default)
        .lock()
        .unwrap_or_else(|e| e.into_inner());
    gates
        .entry(scope.map(Into::into).unwrap_or_default())
        .or_default()
        .clone()
}

/// The slot is held until the run ends, even when the browser has gone.
pub(super) struct Permit {
    gate: Shared,
    pool: Pool,
    id: u64,
}
impl Drop for Permit {
    fn drop(&mut self) {
        self.gate.lock().unwrap_or_else(|e| e.into_inner()).pools[self.pool.index()]
            .active
            .retain(|(id, ..)| *id != self.id);
    }
}

fn wait(until: Instant, now: Instant) -> u64 {
    (until.saturating_duration_since(now).as_millis() as u64).max(1000)
}

pub(super) fn admit(
    scope: Option<&Path>,
    pool: Pool,
    owner: &str,
    now: Instant,
) -> Result<Permit, Refusal> {
    let shared = gate(scope);
    let mut guard = shared.lock().unwrap_or_else(|e| e.into_inner());
    let state = &mut guard.pools[pool.index()];
    let noun = pool.noun();
    let refuse = |code, message: String, retry_after_ms| Refusal {
        code,
        message,
        retry_after_ms,
    };
    let own = state.active.iter().filter(|(_, o, _)| o == owner);
    if own.clone().count() >= ACTIVE_PER_OWNER {
        let until = own.map(|(.., until)| *until).min().unwrap_or(now);
        return Err(refuse(
            "generation_busy_owner",
            format!("You already have a {noun} being made. Wait for it to finish."),
            wait(until, now),
        ));
    }
    if state.active.len() >= ACTIVE_PER_POOL {
        let until = state.active.iter().map(|(.., until)| *until).min();
        return Err(refuse(
            "generation_busy_global",
            format!("Other makers are using every {noun} slot. Try again shortly."),
            wait(until.unwrap_or(now), now),
        ));
    }
    let starts = state.starts.entry(owner.into()).or_default();
    while starts
        .front()
        .is_some_and(|start| now.saturating_duration_since(*start) >= WINDOW)
    {
        starts.pop_front();
    }
    if starts.len() >= pool.per_minute() {
        let oldest = starts.front().copied().unwrap_or(now);
        return Err(refuse(
            "generation_rate",
            format!(
                "You have started {} {noun}s in the last minute. Wait a little before the next.",
                starts.len()
            ),
            wait(oldest + WINDOW, now),
        ));
    }
    starts.push_back(now);
    state.next += 1;
    let id = state.next;
    state.active.push((id, owner.into(), now + pool.deadline()));
    drop(guard);
    Ok(Permit {
        gate: shared,
        pool,
        id,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn pools_are_separate_and_refusals_say_which_limit_and_when() {
        let scope = PathBuf::from(format!("admission-{}", crate::random_hex(8)));
        let scope = Some(scope.as_path());
        let now = Instant::now();
        let held = admit(scope, Pool::Image, "a", now).unwrap();
        let text = admit(scope, Pool::Text, "a", now).unwrap(); // no wait on images
        let own = admit(scope, Pool::Image, "a", now).err().unwrap();
        assert_eq!(own.code, "generation_busy_owner");
        assert_eq!(own.retry_after_ms, 180_000);
        let other = admit(scope, Pool::Image, "b", now + Duration::from_secs(30)).unwrap();
        let full = admit(scope, Pool::Image, "c", now + Duration::from_secs(60))
            .err()
            .unwrap();
        assert_eq!(full.code, "generation_busy_global");
        assert_eq!(full.retry_after_ms, 120_000); // the earlier run's deadline
        drop((held, other));
        let again = admit(scope, Pool::Image, "a", now + Duration::from_secs(1));
        assert!(again.is_ok());
        drop((text, again));
        for second in 0..6 {
            let at = now + Duration::from_secs(10 + second);
            drop(admit(scope, Pool::Image, "z", at).unwrap());
        }
        let limited = admit(scope, Pool::Image, "z", now + Duration::from_secs(20))
            .err()
            .unwrap();
        assert_eq!(limited.code, "generation_rate");
        assert_eq!(limited.retry_after_ms, 50_000);
        assert!(admit(scope, Pool::Image, "z", now + Duration::from_secs(71)).is_ok());
    }
}
