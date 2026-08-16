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

// --- moved from main.rs: room-memory entry/label/log-text cluster ---
pub(super) fn room_memory_entries(
    location_id: u64,
    events: &[EventView],
) -> Vec<RoomMemoryEntryView> {
    let entries = room_memory_entries_chronological(location_id, events);
    if entries.len() <= 8 {
        return entries;
    }
    let mut selected_seqs = BTreeSet::new();
    for entry in entries
        .iter()
        .rev()
        .filter(|entry| entry.kind == "chat")
        .take(3)
    {
        selected_seqs.insert(entry.seq);
    }
    for entry in entries
        .iter()
        .rev()
        .filter(|entry| entry.kind != "chat")
        .take(5)
    {
        selected_seqs.insert(entry.seq);
    }
    let mut mixed = entries
        .into_iter()
        .filter(|entry| selected_seqs.contains(&entry.seq))
        .collect::<Vec<_>>();
    if mixed.len() > 8 {
        let excess = mixed.len() - 8;
        mixed.drain(0..excess);
    }
    mixed
}

pub(super) fn room_memory_summary_entries(
    location_id: u64,
    events: &[EventView],
) -> Vec<RoomMemoryEntryView> {
    let mut entries = room_memory_entries_chronological(location_id, events);
    if entries.len() > 24 {
        let excess = entries.len() - 24;
        entries.drain(0..excess);
    }
    entries
}

pub(super) fn room_memory_entries_chronological(
    location_id: u64,
    events: &[EventView],
) -> Vec<RoomMemoryEntryView> {
    semantic_receipts::semantic_story_events(events)
        .into_iter()
        .rev()
        .filter_map(|event| room_memory_entry_for_event_at_location(event, location_id))
        .collect::<Vec<_>>()
}

#[cfg(test)]
pub(super) fn room_memory_entry_for_event(event: &EventView) -> Option<RoomMemoryEntryView> {
    let location_id = event
        .destination_location_id
        .or(event.location_id)
        .unwrap_or_default();
    room_memory_entry_for_event_at_location(event, location_id)
}

pub(super) fn room_memory_entry_for_event_at_location(
    event: &EventView,
    location_id: u64,
) -> Option<RoomMemoryEntryView> {
    if event.type_name.starts_with("model_interaction.")
        || matches!(
            event.type_name.as_str(),
            "world.reset"
                | "world.bootstrapped"
                | "actor.presence"
                | "message.created"
                | "image.created"
                | "combat.participant.joined"
                | "combat.initiative.rolled"
                | "combat.turn.started"
                | "combat.turn.ended"
        )
        || (event.type_name == "tag.applied"
            && matches!(
                event.content.as_deref(),
                Some("search_location") | Some("search_feature")
            ))
    {
        return None;
    }
    let label = room_memory_label(event);
    let text = room_memory_log_text_at_location(event, location_id)?;
    Some(RoomMemoryEntryView {
        seq: event.seq,
        actor_id: event.actor_id,
        kind: room_memory_kind(event),
        label,
        text,
    })
}

pub(super) fn room_memory_label(event: &EventView) -> String {
    match event.type_name.as_str() {
        semantic_receipts::STORY_RECEIPT_EVENT_TYPE => "story",
        "actor.moved" | "combat.flee.success" => "move",
        "actor.created" | "actor.entered_location" => "join",
        "move.blocked" => "locked",
        "hand.shuffled" | "hand.thought" => "hand",
        "feature.searched"
        | "location.searched"
        | "exit.discovered"
        | "natural_feature.revealed"
        | "exit.unlocked" => "search",
        "ability_check.rolled" | "combat.attack.attempt" => "roll",
        "ledger.marked" => "ledger",
        "ledger.banked" => "bank",
        "advancement.spent" => "growth",
        "skill.stepped" => "skill",
        "calling.set" | "calling.revised" => "purpose",
        "first_tale.public_trace" => "trace",
        "bond.deepened" | "bond.created" | "bond.revised" | "bond.resolved" => "friendship",
        "clock.updated" => "clock",
        "tag.applied" | "tag.cleared" => "tag",
        "job.contribution.resolved" | "job.updated" => "work",
        "governance.selected" => "choice",
        "building.construction_opened" | "building.completed" | "building.upgraded" => "place",
        "quest.loot_allocated" => "reward",
        "world.logistics.completed" => "delivery",
        "avatar.evolved" => "change",
        "item.picked_up" | "item.dropped" | "item.used" | "item.given" | "item.traded"
        | "item.found" | "item.revealed" | "item.crafted" | "item.created" | "item.transformed" => {
            "item"
        }
        type_name if type_name.starts_with("combat.") => "combat",
        _ => "event",
    }
    .to_string()
}

pub(super) fn room_memory_kind(event: &EventView) -> String {
    match event.type_name.as_str() {
        semantic_receipts::STORY_RECEIPT_EVENT_TYPE => "story",
        "message.created" => "chat",
        "ability_check.rolled" | "combat.attack.attempt" => "roll",
        type_name if type_name.starts_with("item.") => "item",
        type_name if type_name.starts_with("combat.") => "combat",
        "actor.moved" | "actor.created" | "actor.entered_location" | "move.blocked" => "move",
        "clock.updated"
        | "tag.applied"
        | "tag.cleared"
        | "job.contribution.resolved"
        | "job.updated"
        | "natural_feature.revealed"
        | "governance.selected"
        | "building.construction_opened"
        | "building.completed"
        | "building.upgraded"
        | "quest.loot_allocated"
        | "world.logistics.completed"
        | "avatar.evolved" => "world",
        "first_tale.public_trace" => "world",
        "feature.searched" | "location.searched" | "exit.discovered" => "search",
        "bond.deepened" | "bond.created" | "bond.revised" | "bond.resolved" => "bond",
        "calling.set" | "calling.revised" => "calling",
        "ledger.marked" | "ledger.banked" | "advancement.spent" | "skill.stepped" => "ledger",
        _ => "event",
    }
    .to_string()
}

#[cfg(test)]
pub(super) fn room_memory_log_text(event: &EventView) -> Option<String> {
    let location_id = event
        .destination_location_id
        .or(event.location_id)
        .unwrap_or_default();
    room_memory_log_text_at_location(event, location_id)
}

pub(super) fn room_memory_log_text_at_location(
    event: &EventView,
    location_id: u64,
) -> Option<String> {
    let actor_name = event.actor_name.as_deref().unwrap_or("someone");
    let text = match event.type_name.as_str() {
        semantic_receipts::STORY_RECEIPT_EVENT_TYPE => {
            semantic_receipts::semantic_story_memory_text(event)?
        }
        "actor.created" => format!(
            "{} entered {}",
            event.actor_name.as_deref().unwrap_or("someone"),
            event.location_name.as_deref().unwrap_or("the room")
        ),
        "actor.entered_location" => format!(
            "{} arrived in {}",
            event.actor_name.as_deref().unwrap_or("someone"),
            event.location_name.as_deref().unwrap_or("the room")
        ),
        "actor.moved" | "combat.flee.success" => {
            let destination = event
                .destination_location_name
                .as_deref()
                .unwrap_or("somewhere");
            if event.location_id == Some(location_id)
                && event.destination_location_id != Some(location_id)
            {
                format!("{actor_name} left for {destination}")
            } else {
                format!("{actor_name} arrived at {destination}")
            }
        }
        "feature.searched" => {
            let feature = event
                .content
                .as_deref()
                .and_then(|content| content.split(':').next())
                .map(str::trim)
                .filter(|feature| !feature.is_empty())
                .unwrap_or("something tucked away");
            format!(
                "{} looked closely at {feature}",
                event.actor_name.as_deref().unwrap_or("someone")
            )
        }
        "location.searched" => format!(
            "{} looked closely around {}",
            event.actor_name.as_deref().unwrap_or("someone"),
            event.location_name.as_deref().unwrap_or("the room")
        ),
        "exit.discovered" => command_event_output(event).unwrap_or_else(|| {
            format!(
                "{} discovered a way to {}",
                event.actor_name.as_deref().unwrap_or("someone"),
                event
                    .destination_location_name
                    .as_deref()
                    .unwrap_or("somewhere new")
            )
        }),
        "journey.started"
        | "journey.progressed"
        | "journey.narrated"
        | "journey.completed"
        | "journey.backtracked"
        | "journey.paused"
        | "pathway.discovered"
        | "pathway.familiarized" => event.content.clone().unwrap_or_else(|| {
            format!("{actor_name} carries the path a little farther into the world")
        }),
        "first_tale.public_trace" => format!(
            "{actor_name} marked the first uncovered stone so the next visitor can trust the washed path"
        ),
        "natural_feature.revealed" => {
            let feature = event
                .content
                .as_deref()
                .and_then(|content| serde_json::from_str::<serde_json::Value>(content).ok())
                .and_then(|content| {
                    content
                        .get("feature")
                        .and_then(|feature| feature.get("resource_kind"))
                        .and_then(serde_json::Value::as_str)
                        .map(|resource| resource.replace('_', " "))
                })
                .unwrap_or_else(|| "a useful natural feature".to_string());
            format!("{actor_name} revealed {feature} here")
        }
        "ability_check.rolled" if event.content.as_deref() == Some("notice") => {
            let target_name = event
                .target_actor_name
                .as_deref()
                .unwrap_or("the other avatar");
            if event.success {
                format!("{actor_name} noticed what {target_name} carries and seeks")
            } else {
                format!("{target_name} stayed hard for {actor_name} to read")
            }
        }
        "ability_check.rolled" if event.content.as_deref() == Some("study") => {
            format!(
                "{} studied the signs and {}",
                event.actor_name.as_deref().unwrap_or("someone"),
                if event.success {
                    "understood their meaning"
                } else {
                    "found their meaning still unclear"
                }
            )
        }
        "ability_check.rolled" => {
            format!(
                "{} checked carefully, and the room {}",
                event.actor_name.as_deref().unwrap_or("someone"),
                if event.success {
                    "answered"
                } else {
                    "kept its secret"
                }
            )
        }
        "combat.attack.attempt" => {
            format!(
                "{} {}, while {} {}",
                event.actor_name.as_deref().unwrap_or("someone"),
                if event.success {
                    "found an opening"
                } else {
                    "met empty air"
                },
                event
                    .target_actor_name
                    .as_deref()
                    .unwrap_or("the other light"),
                if event.success {
                    "gave ground"
                } else {
                    "slipped clear"
                }
            )
        }
        "combat.encounter.started" => format!(
            "{actor_name} faced {} as the scuffle began",
            event.target_actor_name.as_deref().unwrap_or("the danger")
        ),
        "combat.dodge" => format!("{actor_name} focused on staying clear"),
        "combat.encounter.resolved" => {
            if event.total == Some(1) {
                format!("{actor_name} brought the scuffle safely to an end")
            } else {
                "the scuffle ended for now".to_string()
            }
        }
        "ledger.marked" => {
            let memory = event
                .content
                .as_deref()
                .and_then(|content| content.split(':').nth(1))
                .filter(|label| !label.trim().is_empty())
                .unwrap_or("a moment from this visit");
            format!("{actor_name} kept a memory: {}", memory.trim())
        }
        "ledger.banked" => format!("{actor_name} grew from what happened"),
        "advancement.spent" => {
            format!("{actor_name} put what they learned into practice")
        }
        "skill.stepped" => {
            let mut parts = event.content.as_deref().unwrap_or_default().split(':');
            let skill_id = parts.next().unwrap_or("a knack");
            let skill = skill_label(skill_id).unwrap_or(skill_id);
            let rank = parts
                .next()
                .and_then(|value| value.parse::<u8>().ok())
                .unwrap_or(1);
            if rank >= 3 {
                format!("{skill} became second nature to {actor_name}")
            } else {
                format!("{actor_name} got better at {skill}")
            }
        }
        "calling.set" | "calling.revised" => {
            let content = event.content.as_deref().unwrap_or_default().trim();
            let (statement, reason) = content
                .rsplit_once(':')
                .map(|(statement, reason)| (statement, reason.trim()))
                .unwrap_or((content, ""));
            let statement = statement.trim().trim_end_matches('.');
            // An arriving avatar is given a starting statement it never picked.
            // Calling that a choice was the lie #360 reports: the journal
            // claimed a purpose was chosen, then Class selection replaced it.
            if reason == CALLING_REASON_AVATAR_CREATED {
                format!("{actor_name} arrives with a purpose still to choose")
            } else if statement.is_empty() {
                format!("{actor_name} chose what matters to them")
            } else {
                format!("{actor_name} chose a purpose: {statement}")
            }
        }
        "bond.deepened" => format!(
            "{actor_name} grew closer to {}",
            event.target_actor_name.as_deref().unwrap_or("someone")
        ),
        "bond.created" => format!(
            "{actor_name} became friends with {}",
            event.target_actor_name.as_deref().unwrap_or("someone")
        ),
        "bond.revised" => format!(
            "{actor_name} saw {} a little differently",
            event.target_actor_name.as_deref().unwrap_or("someone")
        ),
        "bond.resolved" => format!(
            "{actor_name} kept what mattered with {}",
            event.target_actor_name.as_deref().unwrap_or("someone")
        ),
        "avatar.evolved" => format!(
            "{} found a new shape",
            event.target_actor_name.as_deref().unwrap_or("someone")
        ),
        "job.contribution.resolved" => event
            .content
            .as_deref()
            .and_then(|content| serde_json::from_str::<JobContributionTrace>(content).ok())
            .map(|trace| {
                let progress = if trace.total_progress == 1 {
                    "one step".to_string()
                } else {
                    format!("{} steps", trace.total_progress)
                };
                format!(
                    "{actor_name} tried to {} at {}; the shared work gained {progress}",
                    trace.strategy_label.to_lowercase(),
                    trace.target.label
                )
            })
            .unwrap_or_else(|| format!("{actor_name} changed the shared work")),
        "governance.selected" => event
            .content
            .as_deref()
            .map(str::trim)
            .filter(|content| !content.is_empty())
            .map(|content| content.trim_end_matches('.').to_string())
            .unwrap_or_else(|| format!("{actor_name} left a lasting change here")),
        "building.construction_opened" | "building.completed" | "building.upgraded" => {
            let change = event
                .content
                .as_deref()
                .map(str::trim)
                .filter(|content| !content.is_empty())
                .map(|content| content.trim_end_matches('.'))
                .unwrap_or("the place gained new work");
            format!("{actor_name} changed the place; {change}")
        }
        "quest.loot_allocated" => {
            let reward = event
                .content
                .as_deref()
                .map(str::trim)
                .filter(|content| !content.is_empty())
                .map(|content| content.trim_end_matches('.'))
                .unwrap_or("a physical reward entered the world");
            format!("{actor_name} completed the quest; {reward}")
        }
        "world.logistics.completed" => event
            .content
            .as_deref()
            .and_then(|content| serde_json::from_str::<serde_json::Value>(content).ok())
            .and_then(|content| {
                content
                    .get("summary")
                    .and_then(serde_json::Value::as_str)
                    .map(|summary| summary.trim_end_matches('.').to_string())
            })
            .unwrap_or_else(|| format!("{actor_name} completed a physical delivery here")),
        "clock.updated" => {
            let filled = event.clock_filled.unwrap_or(0);
            let segments = event.clock_segments.unwrap_or(0);
            let change = if segments > 0 && filled >= segments {
                "comes due"
            } else if event.clock_delta.unwrap_or(0) < 0 {
                "eases back"
            } else {
                "draws closer"
            };
            format!(
                "{} {change}",
                event
                    .clock_label
                    .as_deref()
                    .unwrap_or("something in the room")
            )
        }
        "tag.applied" => format!(
            "{actor_name} became {}",
            event.tag_label.as_deref().unwrap_or("changed")
        ),
        "tag.cleared" => format!(
            "{actor_name} shook off {}",
            event.tag_label.as_deref().unwrap_or("what was lingering")
        ),
        "item.found" => format!(
            "{} found {}",
            actor_name,
            event.item_name.as_deref().unwrap_or("something small")
        ),
        "item.revealed" => format!(
            "{} revealed {}",
            actor_name,
            event.item_name.as_deref().unwrap_or("something small")
        ),
        "item.picked_up" => format!(
            "{actor_name} picked up {}",
            event.item_name.as_deref().unwrap_or("a keepsake")
        ),
        "item.dropped" => format!(
            "{actor_name} set down {}",
            event.item_name.as_deref().unwrap_or("a keepsake")
        ),
        "item.used" => {
            let target = event
                .target_actor_name
                .as_deref()
                .filter(|target| *target != actor_name)
                .map(|target| format!(" for {target}"))
                .unwrap_or_default();
            format!(
                "{actor_name} used {}{target}",
                event.item_name.as_deref().unwrap_or("a keepsake")
            )
        }
        "item.given" => format!(
            "{actor_name} gave {} to {}",
            event.item_name.as_deref().unwrap_or("a keepsake"),
            event.target_actor_name.as_deref().unwrap_or("someone")
        ),
        "item.traded" => format!(
            "{actor_name} traded {} with {} for {}",
            event.item_name.as_deref().unwrap_or("a keepsake"),
            event.target_actor_name.as_deref().unwrap_or("someone"),
            event
                .target_item_name
                .as_deref()
                .unwrap_or("another keepsake")
        ),
        "item.crafted" => {
            let contribution = event
                .content
                .as_deref()
                .map(str::trim)
                .filter(|content| !content.is_empty())
                .unwrap_or("a shared care task");
            format!("{actor_name} completed {contribution}")
        }
        "item.transformed" => {
            let change = event
                .content
                .as_deref()
                .map(str::trim)
                .filter(|content| !content.is_empty())
                .map(|content| content.trim_end_matches('.'))
                .unwrap_or("a represented item changed form");
            format!("{actor_name} completed the change: {change}")
        }
        _ => command_event_output(event)?,
    };
    room_memory_text(Some(&text))
}

pub(super) fn room_memory_text(value: Option<&str>) -> Option<String> {
    let compact = value?
        .trim()
        .trim_matches('"')
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ");
    let text = compact
        .strip_prefix("You ")
        .or_else(|| compact.strip_prefix("you "))
        .unwrap_or(compact.as_str());
    if text.is_empty() {
        None
    } else {
        Some(trim_to_chars(text, 220))
    }
}
