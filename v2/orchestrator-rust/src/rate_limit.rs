use std::{
    collections::{BTreeMap, BTreeSet, VecDeque},
    sync::{Arc, Mutex},
    time::{Duration, Instant},
};

pub(super) struct ActorChatGuard {
    pub(super) locks: Arc<Mutex<BTreeSet<u64>>>,
    pub(super) actor_id: u64,
}

impl Drop for ActorChatGuard {
    fn drop(&mut self) {
        if let Ok(mut locks) = self.locks.lock() {
            locks.remove(&self.actor_id);
        }
    }
}

#[derive(Clone, Copy, Debug)]
pub(super) struct RateLimit {
    pub(super) max_hits: usize,
    pub(super) window: Duration,
}

#[derive(Debug, Default)]
pub(super) struct RateLimiter {
    hits: BTreeMap<String, VecDeque<Instant>>,
}

impl RateLimiter {
    pub(super) fn allow(&mut self, key: String, limit: RateLimit, now: Instant) -> bool {
        let cutoff = now.checked_sub(limit.window).unwrap_or(now);
        let hits = self.hits.entry(key).or_default();
        while hits.front().is_some_and(|hit| *hit <= cutoff) {
            hits.pop_front();
        }
        if hits.len() >= limit.max_hits {
            return false;
        }
        hits.push_back(now);

        if self.hits.len() > 4096 {
            self.hits.retain(|_, hits| {
                while hits.front().is_some_and(|hit| *hit <= cutoff) {
                    hits.pop_front();
                }
                !hits.is_empty()
            });
        }

        true
    }
}

pub(super) const AVATAR_CREATE_LIMIT: RateLimit = RateLimit {
    max_hits: 12,
    window: Duration::from_secs(10 * 60),
};
pub(super) const CHAT_ACTION_LIMIT: RateLimit = RateLimit {
    max_hits: 45,
    window: Duration::from_secs(60),
};
pub(super) const REPORT_ACTION_LIMIT: RateLimit = RateLimit {
    max_hits: 12,
    window: Duration::from_secs(10 * 60),
};
pub(super) const GENERAL_ACTION_LIMIT: RateLimit = RateLimit {
    max_hits: 180,
    window: Duration::from_secs(60),
};
pub(super) const PUBLIC_MUTATION_LIMIT: RateLimit = RateLimit {
    max_hits: 240,
    window: Duration::from_secs(60),
};
pub(super) const WALLET_AUTH_LIMIT: RateLimit = RateLimit {
    max_hits: 30,
    window: Duration::from_secs(60),
};

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn blocks_until_the_window_expires() {
        let mut limiter = RateLimiter::default();
        let limit = RateLimit {
            max_hits: 2,
            window: Duration::from_secs(10),
        };
        let now = Instant::now();

        assert!(limiter.allow("actor:5000".to_string(), limit, now));
        assert!(limiter.allow(
            "actor:5000".to_string(),
            limit,
            now + Duration::from_secs(1)
        ));
        assert!(!limiter.allow(
            "actor:5000".to_string(),
            limit,
            now + Duration::from_secs(2)
        ));
        assert!(limiter.allow(
            "actor:5000".to_string(),
            limit,
            now + Duration::from_secs(11)
        ));
        assert!(limiter.allow(
            "actor:5001".to_string(),
            limit,
            now + Duration::from_secs(2)
        ));
    }
}
