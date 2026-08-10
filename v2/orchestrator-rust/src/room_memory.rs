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

async fn request_ai_room_memory_summary(
    config: &AiConfig,
    location: &LocationView,
    prior_chapters: &[RoomMemoryChapter],
    entries: &[RoomMemoryEntryView],
) -> Result<String, String> {
    let (system, base_user) = room_memory_prompt(location, prior_chapters, entries);
    let mut last_shape_error = "empty";
    for shape_attempt in 1..=2 {
        let user = if shape_attempt == 1 {
            base_user.clone()
        } else {
            format!(
                "{base_user}\nRewrite as natural prose only: one or two complete unlabelled sentences, with no bullets, colons, semicolons, slashes, or dashes."
            )
        };
        let completion = request_chat_completion(
            config,
            ChatCompletionRequest {
                feature: "room_memory",
                prompt_version: "room-memory-v3",
                capability: ModelCapability::Voice,
                system: &system,
                user: &user,
                temperature: if shape_attempt == 1 { 0.45 } else { 0.2 },
                max_tokens: 110,
                timeout: Duration::from_secs(10),
                max_attempts: 2,
                referer: "https://cosyworld.fly.dev",
                response_format: None,
                room_id: Some(location.id),
            },
        )
        .await
        .map_err(|error| error.to_string())?;
        match sanitize_room_memory_summary(&completion.text) {
            Ok(summary) => return Ok(summary),
            Err(code) => last_shape_error = code,
        }
    }
    Err(format!(
        "AI room memory response was not usable after one shape retry: {last_shape_error}"
    ))
}

pub(super) fn sanitize_room_memory_summary(value: &str) -> Result<String, &'static str> {
    let text = value
        .trim()
        .trim_matches('"')
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ");
    if text.is_empty() {
        return Err("empty");
    }
    if room_memory_summary_looks_like_listicle(&text) {
        return Err("listicle_shape");
    }
    let lowered = format!(" {} ", text.to_lowercase());
    if [
        " ai ",
        " advancement ",
        " archive ",
        " chapter ",
        " event ",
        " ledger ",
        " log ",
        " policy ",
        " prompt ",
        " rag ",
        " roll ",
        " summary ",
        " system ",
        " ui ",
    ]
    .iter()
    .any(|needle| lowered.contains(needle))
        // Elysium's canonical resident type is a "model avatar", and every one
        // of its locations says so in its own authored memory (see location
        // 652052, "Void 053"). A bare " model " ban meant that location could
        // never pass this filter: the prompt hands the model its own memory
        // text verbatim, so summarizing it necessarily reuses that phrase. The
        // narrower phrase still catches an actual 4th-wall break.
        || lowered.contains("language model")
    {
        return Err("system_vocabulary");
    }
    Ok(trim_to_chars(&text, 420))
}

fn room_memory_summary_looks_like_listicle(value: &str) -> bool {
    let trimmed = value.trim();
    trimmed.contains('\u{2022}')
        || trimmed.contains(';')
        || trimmed.contains(" / ")
        || trimmed.contains(" | ")
        || trimmed.contains(" - ")
        || trimmed.contains(':')
        || trimmed
            .split('.')
            .filter(|sentence| !sentence.trim().is_empty())
            .count()
            > 2
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
