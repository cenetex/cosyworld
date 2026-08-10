use super::*;

const ROOM_MEMORY_RETRY_BASE: Duration = Duration::from_secs(60);
const ROOM_MEMORY_RETRY_MAX: Duration = Duration::from_secs(15 * 60);
pub(super) type RoomMemoryRetryKey = (u64, u64, u64);
pub(super) type RoomMemoryRetries = BTreeMap<RoomMemoryRetryKey, RoomMemoryRetryState>;

#[derive(Clone, Copy, Debug)]
pub(super) struct RoomMemoryRetryState {
    consecutive_failures: u32,
    retry_at: Instant,
}

pub(super) fn schedule_room_memory_summary(
    state: &AppState,
    location: LocationView,
    day_index: u64,
    latest_seq: u64,
    prior_chapters: Vec<RoomMemoryChapter>,
    recent: Vec<RoomMemoryEntryView>,
) {
    let Some(config) = state.ai_config.as_ref().clone() else {
        return;
    };
    let key = (location.id, day_index, latest_seq);
    if let Ok(mut retries) = state.room_memory_retries.lock() {
        retries.retain(|(location_id, retry_day, retry_seq), _| {
            *location_id != location.id || *retry_day != day_index || *retry_seq >= latest_seq
        });
        if room_memory_retry_is_blocked(&mut retries, key, Instant::now()) {
            return;
        }
    }
    if let Ok(mut jobs) = state.room_memory_jobs.lock() {
        if !jobs.insert(key) {
            return;
        }
    }
    let state = state.clone();
    tokio::spawn(async move {
        let started_at = Instant::now();
        match request_ai_room_memory_summary(&config, &location, &prior_chapters, &recent).await {
            Ok(summary) => {
                cache_room_memory_summary(
                    &state,
                    location.id,
                    day_index,
                    latest_seq,
                    &summary,
                    "llm",
                    prior_chapters,
                );
                record_ai_usage(
                    &state,
                    None,
                    "room_memory_summary",
                    "server",
                    Some(&config),
                    "ok",
                    Some(latest_seq),
                    0,
                    None,
                    started_at.elapsed(),
                );
                if let Ok(mut retries) = state.room_memory_retries.lock() {
                    retries.remove(&key);
                }
            }
            Err(error) => {
                let retry_after = if let Ok(mut retries) = state.room_memory_retries.lock() {
                    let consecutive_failures = retries
                        .get(&key)
                        .map_or(1, |prior| prior.consecutive_failures.saturating_add(1));
                    let retry_after = room_memory_retry_delay(consecutive_failures);
                    retries.insert(
                        key,
                        RoomMemoryRetryState {
                            consecutive_failures,
                            retry_at: Instant::now() + retry_after,
                        },
                    );
                    retry_after
                } else {
                    ROOM_MEMORY_RETRY_BASE
                };
                warn!(
                    location_id = location.id,
                    latest_seq,
                    retry_after_secs = retry_after.as_secs(),
                    error = %error,
                    "AI room memory summary failed; retry deferred"
                );
                record_ai_usage(
                    &state,
                    None,
                    "room_memory_summary",
                    "server",
                    Some(&config),
                    "failed",
                    Some(latest_seq),
                    0,
                    Some("summary_error"),
                    started_at.elapsed(),
                );
            }
        }
        if let Ok(mut jobs) = state.room_memory_jobs.lock() {
            jobs.remove(&key);
        }
    });
}

fn room_memory_retry_delay(consecutive_failures: u32) -> Duration {
    let multiplier = 1_u32 << consecutive_failures.saturating_sub(1).min(4);
    ROOM_MEMORY_RETRY_BASE
        .saturating_mul(multiplier)
        .min(ROOM_MEMORY_RETRY_MAX)
}

fn room_memory_retry_is_blocked(
    retries: &mut RoomMemoryRetries,
    key: RoomMemoryRetryKey,
    now: Instant,
) -> bool {
    match retries.get(&key) {
        Some(retry) if retry.retry_at > now => true,
        Some(_) => {
            retries.remove(&key);
            false
        }
        None => false,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn failures_back_off_and_expired_retries_reopen() {
        assert_eq!(room_memory_retry_delay(1), Duration::from_secs(60));
        assert_eq!(room_memory_retry_delay(2), Duration::from_secs(120));
        assert_eq!(room_memory_retry_delay(99), Duration::from_secs(15 * 60));

        let now = Instant::now();
        let key = (652042, 10, 99);
        let mut retries = BTreeMap::from([(
            key,
            RoomMemoryRetryState {
                consecutive_failures: 1,
                retry_at: now + Duration::from_secs(60),
            },
        )]);
        assert!(room_memory_retry_is_blocked(&mut retries, key, now));
        assert!(!room_memory_retry_is_blocked(
            &mut retries,
            key,
            now + Duration::from_secs(60)
        ));
        assert!(!retries.contains_key(&key));
    }
}
