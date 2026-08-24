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
                | "story.card.played"
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
        "first_tale.public_trace" => {
            // The trace copy is authored per worldpack (project89 records a
            // covenant, not a garden stone). Render the authored content so
            // room memory never describes a tale the pack does not contain.
            let trace = event
                .content
                .as_deref()
                .map(str::trim)
                .filter(|content| !content.is_empty())
                .unwrap_or("left an authored public trace");
            format!("{actor_name} {trace}")
        }
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

// --- moved from main.rs: room-memory view/chapter/cache/atmosphere cluster ---
pub(super) fn room_memory_view_for_state(
    state: &AppState,
    location: &LocationView,
    events: &[EventView],
) -> RoomMemoryView {
    let mut view = fallback_room_memory_view(location, events);
    let day_index = current_room_memory_day_index();
    let prior_chapters = load_room_memory_prior_chapters_for_state(state, location.id, day_index);
    let current_chapter = load_current_room_memory_chapter_for_state(state, location.id, day_index);
    if let Some(chapter) = current_chapter.as_ref() {
        view.summary = chapter.summary.clone();
        view.source = chapter.source.clone();
    } else {
        view.summary = room_atmosphere_sentence(location);
        view.source = "fallback".to_string();
    }

    let Some(latest_listen_seq) = latest_room_memory_listen_seq(events, location.id) else {
        return view;
    };
    if current_chapter
        .as_ref()
        .is_some_and(|chapter| chapter.latest_seq > latest_listen_seq)
    {
        return view;
    }

    let (summary_after_seq, prompt_chapters) =
        room_memory_prompt_chapters(prior_chapters, current_chapter.as_ref(), latest_listen_seq);
    let summary_entries = room_memory_summary_entries_since(
        state,
        location.id,
        events,
        summary_after_seq,
        latest_listen_seq,
    );

    if let Some(chapter) = current_chapter.as_ref() {
        if chapter.latest_seq == latest_listen_seq {
            if chapter.source != "llm" {
                schedule_room_memory_summary(
                    state,
                    location.clone(),
                    day_index,
                    latest_listen_seq,
                    prompt_chapters,
                    summary_entries,
                );
            }
            return view;
        }
    }

    view.summary = fallback_room_memory_summary(location, &summary_entries, &prompt_chapters);
    view.source = "fallback".to_string();
    cache_room_memory_summary(
        state,
        location.id,
        day_index,
        latest_listen_seq,
        &view.summary,
        "fallback",
        prompt_chapters.clone(),
    );
    schedule_room_memory_summary(
        state,
        location.clone(),
        day_index,
        latest_listen_seq,
        prompt_chapters,
        summary_entries,
    );
    view
}

pub(super) fn load_current_room_memory_chapter_for_state(
    state: &AppState,
    location_id: u64,
    day_index: u64,
) -> Option<RoomMemoryChapter> {
    if let Ok(cache) = state.room_memory_cache.lock() {
        if let Some(cached) = cache.get(&location_id) {
            if cached.day_index == day_index {
                return Some(RoomMemoryChapter {
                    day_index,
                    latest_seq: cached.latest_seq,
                    summary: cached.summary.clone(),
                    source: cached.source.clone(),
                });
            }
        }
    }
    let path = state.event_store_path.as_deref()?;
    match load_room_memory_chapter(path, location_id, day_index) {
        Ok(chapter) => chapter,
        Err(error) => {
            warn!(
                "failed to load current room memory chapter for location {} day {}: {}",
                location_id, day_index, error
            );
            None
        }
    }
}

pub(super) fn room_memory_prompt_chapters(
    prior_chapters: Vec<RoomMemoryChapter>,
    current_chapter: Option<&RoomMemoryChapter>,
    latest_listen_seq: u64,
) -> (u64, Vec<RoomMemoryChapter>) {
    let mut chapters = prior_chapters;
    if let Some(chapter) = current_chapter {
        if chapter.latest_seq > 0 && chapter.latest_seq < latest_listen_seq {
            chapters.push(chapter.clone());
        }
    }
    let after_seq = chapters
        .last()
        .map(|chapter| chapter.latest_seq)
        .unwrap_or(0);
    (after_seq, chapters)
}

pub(super) fn room_memory_summary_entries_since(
    state: &AppState,
    location_id: u64,
    fallback_events: &[EventView],
    after_seq: u64,
    through_seq: u64,
) -> Vec<RoomMemoryEntryView> {
    if through_seq <= after_seq {
        return Vec::new();
    }
    let mut events = if let Some(path) = state.event_store_path.as_deref() {
        match read_event_store_between(path, after_seq, through_seq, MAX_EVENT_STORE_SCAN) {
            Ok(mut events) => {
                events.reverse();
                events
            }
            Err(error) => {
                warn!(
                    "failed to read room memory context for location {} through event {}: {}",
                    location_id, through_seq, error
                );
                fallback_events.to_vec()
            }
        }
    } else {
        fallback_events.to_vec()
    };
    events.retain(|event| {
        event.seq > after_seq
            && event.seq <= through_seq
            && event_visible_in_location(event, location_id)
    });
    room_memory_summary_entries(location_id, &events)
}

pub(super) fn latest_room_memory_listen_seq(events: &[EventView], location_id: u64) -> Option<u64> {
    events
        .iter()
        .filter(|event| {
            event_visible_in_location(event, location_id) && event_is_room_memory_listen(event)
        })
        .map(|event| event.seq)
        .max()
}

pub(super) fn event_is_room_memory_listen(event: &EventView) -> bool {
    event.type_name == "ability_check.rolled" && event.dc == Some(LISTEN_DC as i16)
}

pub(super) const ROOM_MEMORY_DAY_MS: u64 = 86_400_000;
pub(super) const ROOM_MEMORY_PRIOR_CHAPTER_LIMIT: usize = 6;

pub(super) fn current_room_memory_day_index() -> u64 {
    now_millis() / ROOM_MEMORY_DAY_MS
}

pub(super) fn load_room_memory_prior_chapters_for_state(
    state: &AppState,
    location_id: u64,
    day_index: u64,
) -> Vec<RoomMemoryChapter> {
    if let Ok(cache) = state.room_memory_cache.lock() {
        if let Some(cached) = cache.get(&location_id) {
            if cached.day_index == day_index && !cached.prior_chapters.is_empty() {
                return cached.prior_chapters.clone();
            }
        }
    }
    let Some(path) = state.event_store_path.as_deref() else {
        return Vec::new();
    };
    match load_room_memory_prior_chapters(
        path,
        location_id,
        day_index,
        ROOM_MEMORY_PRIOR_CHAPTER_LIMIT,
    ) {
        Ok(chapters) => chapters,
        Err(error) => {
            warn!(
                "failed to load room memory chapters for location {} before day {}: {}",
                location_id, day_index, error
            );
            Vec::new()
        }
    }
}

pub(super) fn cache_room_memory_summary(
    state: &AppState,
    location_id: u64,
    day_index: u64,
    latest_seq: u64,
    summary: &str,
    source: &str,
    prior_chapters: Vec<RoomMemoryChapter>,
) {
    if let Ok(mut cache) = state.room_memory_cache.lock() {
        cache.insert(
            location_id,
            RoomMemoryCacheEntry {
                day_index,
                latest_seq,
                summary: summary.to_string(),
                source: source.to_string(),
                prior_chapters: prior_chapters.clone(),
            },
        );
        if cache.len() > 256 {
            let stale_keys = cache
                .keys()
                .copied()
                .take(cache.len() - 256)
                .collect::<Vec<_>>();
            for key in stale_keys {
                cache.remove(&key);
            }
        }
    }
    if let Some(path) = state.event_store_path.as_deref() {
        if let Err(error) =
            upsert_room_memory_chapter(path, location_id, day_index, latest_seq, summary, source)
        {
            warn!(
                "failed to persist room memory chapter for location {} day {}: {}",
                location_id, day_index, error
            );
        }
    }
}

pub(super) fn fallback_room_memory_view(
    location: &LocationView,
    events: &[EventView],
) -> RoomMemoryView {
    let entries = room_memory_entries(location.id, events);
    let latest = entries.last().cloned();
    let latest_seq = latest.as_ref().map(|entry| entry.seq);
    let summary = fallback_room_memory_summary(location, &entries, &[]);
    RoomMemoryView {
        location_id: location.id,
        summary,
        latest,
        recent: entries,
        latest_seq,
        source: "fallback".to_string(),
    }
}

pub(super) fn fallback_room_memory_summary(
    location: &LocationView,
    entries: &[RoomMemoryEntryView],
    _prior_chapters: &[RoomMemoryChapter],
) -> String {
    let atmosphere = room_atmosphere_sentence(location);
    if entries.is_empty() {
        return atmosphere;
    }

    let mut seen = BTreeSet::new();
    let mut beats = entries
        .iter()
        .rev()
        .filter_map(atmospheric_room_memory_beat)
        .filter(|beat| seen.insert(beat.clone()))
        .take(3)
        .collect::<Vec<_>>();
    beats.reverse();
    if beats.is_empty() {
        return atmosphere;
    }

    trim_to_chars(&format!("{atmosphere} {}", beats.join(" ")), 420)
}

pub(super) fn room_atmosphere_sentence(location: &LocationView) -> String {
    let seed = [
        location.description.as_str(),
        location.persona.as_str(),
        location.title.as_str(),
        location.name.as_str(),
    ]
    .iter()
    .find(|value| !value.trim().is_empty())
    .copied()
    .unwrap_or("The room holds its breath.");
    let fragment = sentence_fragment(first_sentence(seed));
    complete_sentence(if fragment.is_empty() {
        format!("{} holds its breath", location.name)
    } else {
        fragment
    })
}

pub(super) fn first_sentence(value: &str) -> &str {
    let trimmed = value.trim();
    trimmed
        .find(&['.', '!', '?'][..])
        .map(|index| &trimmed[..=index])
        .unwrap_or(trimmed)
}

pub(super) fn atmospheric_room_memory_beat(entry: &RoomMemoryEntryView) -> Option<String> {
    let text = sentence_fragment(&entry.text);
    if text.is_empty() {
        return None;
    }
    let beat = match entry.kind.as_str() {
        "chat" => atmospheric_chat_beat(entry, &text),
        "item" => atmospheric_item_beat(&text),
        "bond" => atmospheric_bond_beat(&text),
        "calling" => text,
        "move" => atmospheric_move_beat(&text),
        "roll" => atmospheric_roll_beat(&text),
        "ledger" => atmospheric_ledger_beat(&text),
        "world" => atmospheric_world_beat(&text),
        _ if entry.label == "hand" => text,
        _ if entry.label == "search" => atmospheric_search_beat(&text),
        _ => text,
    };
    Some(complete_sentence(beat))
}

pub(super) fn atmospheric_chat_beat(entry: &RoomMemoryEntryView, text: &str) -> String {
    if text.chars().any(|ch| ch.is_alphabetic()) {
        format!("{} said: {}", entry.label, text)
    } else {
        format!("{} answered in bright signs", entry.label)
    }
}

pub(super) fn atmospheric_item_beat(text: &str) -> String {
    text.to_string()
}

pub(super) fn atmospheric_bond_beat(text: &str) -> String {
    text.to_string()
}

pub(super) fn atmospheric_move_beat(text: &str) -> String {
    if let Some((actor, destination)) = split_case_insensitive(text, " to ") {
        let actor = actor
            .trim()
            .split_once(" moved from ")
            .map(|(name, _)| name)
            .unwrap_or(actor.trim());
        return format!("{} arrived at {}", actor.trim(), destination.trim());
    }
    if let Some((actor, room)) = split_case_insensitive(text, " entered ") {
        return format!("{} arrived in {}", actor.trim(), room.trim());
    }
    if split_case_insensitive(text, " arrived in ").is_some() {
        return text.to_string();
    }
    text.to_string()
}

pub(super) fn atmospheric_search_beat(text: &str) -> String {
    if let Some((_prefix, destination)) = split_case_insensitive(text, " way to ") {
        let destination = destination.trim().trim_end_matches(" becomes clear").trim();
        return format!("A path to {destination} opened");
    }
    if text.to_lowercase().contains("looked closely around") {
        return text.to_string();
    }
    if let Some(rest) = text
        .to_lowercase()
        .strip_prefix("search ")
        .and_then(|_| text.get(7..))
    {
        return format!("Searched {}", rest.trim());
    }
    text.to_string()
}

pub(super) fn atmospheric_roll_beat(text: &str) -> String {
    text.to_string()
}

pub(super) fn atmospheric_ledger_beat(text: &str) -> String {
    text.to_string()
}

pub(super) fn atmospheric_world_beat(text: &str) -> String {
    text.to_string()
}

pub(super) fn split_case_insensitive<'a>(
    value: &'a str,
    needle: &str,
) -> Option<(&'a str, &'a str)> {
    let index = value
        .to_ascii_lowercase()
        .find(&needle.to_ascii_lowercase())?;
    Some((&value[..index], &value[index + needle.len()..]))
}

pub(super) fn complete_sentence(value: String) -> String {
    let trimmed = value.trim().trim_end_matches(&['.', '!', '?'][..]);
    if trimmed.is_empty() {
        String::new()
    } else {
        format!("{trimmed}.")
    }
}

pub(super) fn sentence_fragment(value: &str) -> String {
    value
        .trim()
        .trim_end_matches(&['.', '!', '?'][..])
        .to_string()
}

// --- moved from main.rs: room-memory chapter persistence ---
pub(super) fn upsert_room_memory_chapter(
    path: &Path,
    location_id: u64,
    day_index: u64,
    latest_seq: u64,
    summary: &str,
    source: &str,
) -> io::Result<()> {
    init_event_store(path)?;
    let conn = open_event_store(path)?;
    conn.execute(
        "INSERT INTO room_memory_chapters
            (location_id, day_index, latest_seq, summary, source, updated_at_ms)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6)
         ON CONFLICT(location_id, day_index) DO UPDATE SET
            latest_seq = excluded.latest_seq,
            summary = excluded.summary,
            source = excluded.source,
            updated_at_ms = excluded.updated_at_ms",
        params![
            location_id as i64,
            day_index as i64,
            latest_seq as i64,
            trim_to_chars(summary, 900),
            source,
            now_millis() as i64
        ],
    )
    .map_err(sqlite_error)?;
    Ok(())
}

pub(super) fn load_room_memory_chapter(
    path: &Path,
    location_id: u64,
    day_index: u64,
) -> io::Result<Option<RoomMemoryChapter>> {
    init_event_store(path)?;
    let conn = open_event_store(path)?;
    conn.query_row(
        "SELECT day_index, latest_seq, summary, source
         FROM room_memory_chapters
         WHERE location_id = ?1 AND day_index = ?2",
        params![location_id as i64, day_index as i64],
        |row| {
            Ok(RoomMemoryChapter {
                day_index: row.get::<_, i64>(0)?.max(0) as u64,
                latest_seq: row.get::<_, i64>(1)?.max(0) as u64,
                summary: row.get(2)?,
                source: row.get(3)?,
            })
        },
    )
    .optional()
    .map_err(sqlite_error)
}

pub(super) fn load_room_memory_prior_chapters(
    path: &Path,
    location_id: u64,
    before_day_index: u64,
    limit: usize,
) -> io::Result<Vec<RoomMemoryChapter>> {
    if limit == 0 || before_day_index == 0 {
        return Ok(Vec::new());
    }
    init_event_store(path)?;
    let conn = open_event_store(path)?;
    let mut stmt = conn
        .prepare(
            "SELECT day_index, latest_seq, summary, source
             FROM room_memory_chapters
             WHERE location_id = ?1 AND day_index < ?2
             ORDER BY day_index DESC
             LIMIT ?3",
        )
        .map_err(sqlite_error)?;
    let rows = stmt
        .query_map(
            params![
                location_id as i64,
                before_day_index as i64,
                limit.min(24) as i64
            ],
            |row| {
                Ok(RoomMemoryChapter {
                    day_index: row.get::<_, i64>(0)?.max(0) as u64,
                    latest_seq: row.get::<_, i64>(1)?.max(0) as u64,
                    summary: row.get(2)?,
                    source: row.get(3)?,
                })
            },
        )
        .map_err(sqlite_error)?;
    let mut chapters = Vec::new();
    for row in rows {
        chapters.push(row.map_err(sqlite_error)?);
    }
    chapters.reverse();
    Ok(chapters)
}

// --- moved from main.rs: recent_room_* RuntimeWorld methods ---
impl crate::RuntimeWorld {
    pub(crate) fn recent_room_lines(&self, location_id: u64, limit: usize) -> Vec<String> {
        let room_lines = self
            .recent_room_lines
            .get(&location_id)
            .map(Vec::as_slice)
            .unwrap_or_default();
        room_lines
            .iter()
            .rev()
            .take(limit)
            .map(|event| {
                format!(
                    "{}: {}",
                    event
                        .actor_name
                        .clone()
                        .unwrap_or_else(|| "Someone".to_string()),
                    event.content.clone().unwrap_or_default()
                )
            })
            .collect::<Vec<_>>()
            .into_iter()
            .rev()
            .collect()
    }

    pub(crate) fn recent_room_activity(&self, location_id: u64, limit: usize) -> Vec<String> {
        let mut activity = self
            .event_log
            .iter()
            .rev()
            .filter(|event| {
                event.success
                    && event.type_name != "message.created"
                    && event.type_name != "image.created"
                    && !event.type_name.starts_with("model_interaction.")
                    && event_visible_in_location(event, location_id)
            })
            .filter_map(|event| room_memory_entry_for_event_at_location(event, location_id))
            .take(limit)
            .map(|entry| format!("{}: {}", entry.label, entry.text))
            .collect::<Vec<_>>();
        activity.reverse();
        activity
    }

    pub(crate) fn recent_room_consequences(&self, location_id: u64, limit: usize) -> Vec<String> {
        let mut consequences = self
            .event_log
            .iter()
            .rev()
            .filter(|event| {
                event.success
                    && event_visible_in_location(event, location_id)
                    && matches!(
                        event.type_name.as_str(),
                        "pathway.discovered"
                            | "first_tale.public_trace"
                            | "natural_feature.revealed"
                            | "governance.selected"
                            | "building.completed"
                            | "quest.loot_allocated"
                            | "world.logistics.completed"
                            | "item.crafted"
                            | "item.transformed"
                    )
            })
            .filter_map(|event| room_memory_entry_for_event_at_location(event, location_id))
            .take(limit.min(3))
            .map(|entry| entry.text)
            .collect::<Vec<_>>();
        consequences.reverse();
        consequences
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Regression guard for the wrong-world-state class found beside the Void
    /// 004 pathway narration bug: the public-trace room-memory line hardcoded
    /// the core pack's washed-garden copy, so a worldpack that authors its own
    /// trace (project89 records a liberation covenant) would report a tale its
    /// world does not contain. The rendered line must be the authored copy.
    #[test]
    fn first_tale_public_trace_renders_the_authored_pack_copy() {
        let trace = |content: Option<&str>| EventView {
            seq: 9,
            type_name: "first_tale.public_trace".to_string(),
            success: true,
            actor_name: Some("Rati".to_string()),
            location_id: Some(COSY_COTTAGE_LOCATION_ID),
            content: content.map(str::to_string),
            ..EventView::default()
        };

        // A pack-authored trace renders that pack's words, not the core
        // pack's garden stone.
        let covenant = room_memory_log_text(&trace(Some(
            "recorded an attributed liberation covenant so the next independent actor can audit the changed convergence protocol",
        )))
        .expect("authored trace becomes room memory");
        assert!(covenant.contains("recorded an attributed liberation covenant"));
        assert!(!covenant.contains("washed path"));
        assert!(covenant.contains("Rati recorded"));

        // The core pack's own trace still reads as before.
        let garden = room_memory_log_text(&trace(Some(
            "marked the first uncovered stone so the next visitor can trust the washed path",
        )))
        .expect("core trace becomes room memory");
        assert!(garden.contains("marked the first uncovered stone"));

        // Missing authored copy falls back to a truthful generic line.
        let fallback =
            room_memory_log_text(&trace(None)).expect("empty trace still becomes room memory");
        assert!(fallback.contains("left an authored public trace"));
        assert!(!fallback.contains("washed path"));
    }

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
    #[test]
    fn fallback_room_memory_reads_as_atmospheric_room_story_with_prior_memory() {
        let runtime = RuntimeWorld::seeded();
        let location = runtime.location_view(COSY_COTTAGE_LOCATION_ID);
        let prior = vec![RoomMemoryChapter {
            day_index: 20_600,
            latest_seq: 42,
            summary: "Moss Lantern found the Dewbright Button and promised Rati a small kindness."
                .to_string(),
            source: "llm".to_string(),
        }];
        let entries = vec![
            RoomMemoryEntryView {
                seq: 43,
                actor_id: Some(5000),
                kind: "chat".to_string(),
                label: "Moss Lantern".to_string(),
                text: "I can look for Moonwool Thread if that would help.".to_string(),
            },
            RoomMemoryEntryView {
                seq: 44,
                actor_id: Some(5000),
                kind: "bond".to_string(),
                label: "friendship".to_string(),
                text: "Moss Lantern grew closer to Rati".to_string(),
            },
        ];

        let summary = fallback_room_memory_summary(&location, &entries, &prior);
        let lowered = summary.to_lowercase();

        assert!(summary.starts_with("A warm room of firelight"));
        assert!(summary.contains("Moss Lantern"));
        assert!(summary.contains("Moss Lantern said"));
        assert!(summary.contains("Moss Lantern grew closer to Rati"));
        assert!(!summary.contains("Today in"));
        assert!(!summary.contains("Log:"));
        assert!(!summary.contains("Chat:"));
        assert!(!summary.contains("Earlier chapter"));
        assert!(!summary.contains("Dewbright Button"));
        assert!(!lowered.contains("ledger"));
        assert!(!lowered.contains("roll"));
        assert!(!lowered.contains("advancement"));
        assert!(!lowered.contains("summary"));
    }

    #[test]
    fn room_memory_copy_only_removes_a_leading_you() {
        assert_eq!(
            room_memory_text(Some("You followed what draws you by listening closely.")).as_deref(),
            Some("followed what draws you by listening closely.")
        );
        assert_eq!(
            room_memory_text(Some("Rati noticed you listening closely.")).as_deref(),
            Some("Rati noticed you listening closely.")
        );
    }

    #[test]
    fn room_memory_log_entries_exclude_chat_messages() {
        let entries = room_memory_entries(
            COSY_COTTAGE_LOCATION_ID,
            &[
                EventView {
                    seq: 2,
                    type_name: "item.picked_up".to_string(),
                    success: true,
                    actor_name: Some("Moss Lantern".to_string()),
                    location_id: Some(COSY_COTTAGE_LOCATION_ID),
                    item_name: Some("Dewbright Button".to_string()),
                    ..EventView::default()
                },
                EventView {
                    seq: 1,
                    type_name: "message.created".to_string(),
                    success: true,
                    actor_name: Some("Moss Lantern".to_string()),
                    location_id: Some(COSY_COTTAGE_LOCATION_ID),
                    content: Some("I can look for Moonwool Thread.".to_string()),
                    ..EventView::default()
                },
            ],
        );

        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].kind, "item");
        assert!(entries[0].text.contains("Dewbright Button"));
    }

    #[test]
    fn room_memory_log_entries_exclude_unknown_system_events() {
        for type_name in [
            "avatar.refined",
            "pathway.refined",
            "community_art.funded",
            "community_art.ready",
            "story.card.played",
        ] {
            let event = EventView {
                type_name: type_name.to_string(),
                success: true,
                actor_name: Some("Moss Lantern".to_string()),
                location_id: Some(COSY_COTTAGE_LOCATION_ID),
                ..EventView::default()
            };
            assert!(
                room_memory_entry_for_event(&event).is_none(),
                "{type_name} must not become player-facing room memory"
            );
        }

        assert!(
            room_memory_entry_for_event(&EventView {
                type_name: "hand.shuffled".to_string(),
                success: true,
                actor_name: Some("Moss Lantern".to_string()),
                location_id: Some(COSY_COTTAGE_LOCATION_ID),
                ..EventView::default()
            })
            .is_some(),
            "known story-facing events remain available"
        );
    }

    #[test]
    fn room_memory_chance_and_clock_entries_use_story_language() {
        let listen = EventView {
            type_name: "ability_check.rolled".to_string(),
            success: true,
            actor_name: Some("Moss Lantern".to_string()),
            total: Some(16),
            dc: Some(12),
            ..EventView::default()
        };
        let clash = EventView {
            type_name: "combat.attack.attempt".to_string(),
            success: false,
            actor_name: Some("Moss Lantern".to_string()),
            target_actor_name: Some("Moonlit Echo".to_string()),
            total: Some(7),
            dc: Some(13),
            ..EventView::default()
        };
        let notice = EventView {
            type_name: "ability_check.rolled".to_string(),
            success: true,
            actor_name: Some("Moss Lantern".to_string()),
            target_actor_name: Some("Rati".to_string()),
            content: Some("notice".to_string()),
            total: Some(16),
            dc: Some(12),
            ..EventView::default()
        };
        let clock = EventView {
            type_name: "clock.updated".to_string(),
            success: true,
            clock_label: Some("Quiet the Moonlit Trail".to_string()),
            clock_filled: Some(2),
            clock_segments: Some(4),
            clock_delta: Some(1),
            ..EventView::default()
        };

        assert_eq!(
            room_memory_log_text(&listen).as_deref(),
            Some("Moss Lantern checked carefully, and the room answered")
        );
        assert_eq!(
            room_memory_log_text(&clash).as_deref(),
            Some("Moss Lantern met empty air, while Moonlit Echo slipped clear")
        );
        assert_eq!(
            room_memory_log_text(&notice).as_deref(),
            Some("Moss Lantern noticed what Rati carries and seeks")
        );
        assert_eq!(
            room_memory_log_text(&clock).as_deref(),
            Some("Quiet the Moonlit Trail draws closer")
        );
        for text in [&listen, &notice, &clash, &clock]
            .into_iter()
            .filter_map(room_memory_log_text)
        {
            assert!(!text.contains("roll"));
            assert!(!text.contains("/4"));
            assert!(!text.contains("DC"));
        }
    }
    #[test]
    fn room_memory_purpose_entries_hide_calling_model_language() {
        let entries = room_memory_entries(
            COSY_COTTAGE_LOCATION_ID,
            &[EventView {
                seq: 1,
                type_name: "calling.set".to_string(),
                success: true,
                actor_name: Some("Moss Lantern".to_string()),
                content: Some("I listen for odd jobs.:chosen_calling".to_string()),
                ..EventView::default()
            }],
        );

        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].kind, "calling");
        assert_eq!(entries[0].label, "purpose");
        assert_eq!(
            entries[0].text,
            "Moss Lantern chose a purpose: I listen for odd jobs"
        );
        assert!(!entries[0].text.contains("Calling"));
        assert_eq!(
            atmospheric_room_memory_beat(&entries[0]).as_deref(),
            Some("Moss Lantern chose a purpose: I listen for odd jobs.")
        );
    }

    #[test]
    fn room_memory_headlines_name_actor_action_and_outcome() {
        let cases = [
            (
                EventView {
                    type_name: "actor.moved".to_string(),
                    success: true,
                    actor_name: Some("Moss Lantern".to_string()),
                    location_name: Some("Rain-Soft Garden".to_string()),
                    destination_location_name: Some("The Cosy Cottage".to_string()),
                    ..EventView::default()
                },
                "Moss Lantern arrived at The Cosy Cottage.",
            ),
            (
                EventView {
                    type_name: "ledger.banked".to_string(),
                    success: true,
                    actor_name: Some("Moss Lantern".to_string()),
                    ..EventView::default()
                },
                "Moss Lantern grew from what happened.",
            ),
            (
                EventView {
                    type_name: "bond.deepened".to_string(),
                    success: true,
                    actor_name: Some("Moss Lantern".to_string()),
                    target_actor_name: Some("Rati".to_string()),
                    ..EventView::default()
                },
                "Moss Lantern grew closer to Rati.",
            ),
            (
                EventView {
                    type_name: "bond.created".to_string(),
                    success: true,
                    actor_name: Some("Moss Lantern".to_string()),
                    target_actor_name: Some("Gust".to_string()),
                    ..EventView::default()
                },
                "Moss Lantern became friends with Gust.",
            ),
            (
                EventView {
                    type_name: "item.given".to_string(),
                    success: true,
                    actor_name: Some("Moss Lantern".to_string()),
                    target_actor_name: Some("Skull".to_string()),
                    item_name: Some("Watch Bell".to_string()),
                    ..EventView::default()
                },
                "Moss Lantern gave Watch Bell to Skull.",
            ),
            (
                EventView {
                    type_name: "clock.updated".to_string(),
                    success: true,
                    clock_label: Some("Quiet the Moonlit Trail".to_string()),
                    clock_filled: Some(2),
                    clock_segments: Some(4),
                    clock_delta: Some(1),
                    ..EventView::default()
                },
                "Quiet the Moonlit Trail draws closer.",
            ),
            (
                EventView {
                    type_name: "item.crafted".to_string(),
                    success: true,
                    actor_name: Some("Moss Lantern".to_string()),
                    content: Some(
                        "Bank the Cottage Hearth: Hearth Tonic met Story Button.".to_string(),
                    ),
                    ..EventView::default()
                },
                "Moss Lantern completed Bank the Cottage Hearth: Hearth Tonic met Story Button.",
            ),
        ];

        for (event, expected) in cases {
            let entry = room_memory_entry_for_event(&event).expect("room memory entry");
            assert_eq!(
                atmospheric_room_memory_beat(&entry).as_deref(),
                Some(expected)
            );
        }
    }

    #[test]
    fn room_memory_describes_travel_from_the_room_being_viewed() {
        let science_class_location_id = 10;
        let event = EventView {
            seq: 7,
            type_name: "actor.moved".to_string(),
            success: true,
            actor_name: Some("Rati".to_string()),
            location_id: Some(COSY_COTTAGE_LOCATION_ID),
            location_name: Some("The Cosy Cottage".to_string()),
            destination_location_id: Some(science_class_location_id),
            destination_location_name: Some("Science Class".to_string()),
            ..EventView::default()
        };

        let cottage = room_memory_entry_for_event_at_location(&event, COSY_COTTAGE_LOCATION_ID)
            .expect("Cottage departure memory");
        let science = room_memory_entry_for_event_at_location(&event, science_class_location_id)
            .expect("Science Class arrival memory");

        assert_eq!(cottage.text, "Rati left for Science Class");
        assert_eq!(science.text, "Rati arrived at Science Class");
        assert_eq!(
            atmospheric_room_memory_beat(&cottage).as_deref(),
            Some("Rati left for Science Class.")
        );
        assert_eq!(
            atmospheric_room_memory_beat(&science).as_deref(),
            Some("Rati arrived at Science Class.")
        );
    }

    #[test]
    fn room_memory_search_entries_hide_projection_bookkeeping() {
        let entries = room_memory_entries(
            COSY_COTTAGE_LOCATION_ID,
            &[
                EventView {
                    seq: 3,
                    type_name: "tag.applied".to_string(),
                    success: true,
                    actor_name: Some("Moss Lantern".to_string()),
                    location_id: Some(COSY_COTTAGE_LOCATION_ID),
                    location_name: Some("The Cosy Cottage".to_string()),
                    tag_label: Some("found Story Button".to_string()),
                    content: Some("search_location".to_string()),
                    ..EventView::default()
                },
                EventView {
                    seq: 2,
                    type_name: "location.searched".to_string(),
                    success: true,
                    actor_id: Some(5000),
                    actor_name: Some("Moss Lantern".to_string()),
                    location_id: Some(COSY_COTTAGE_LOCATION_ID),
                    location_name: Some("The Cosy Cottage".to_string()),
                    content: Some(
                        "location:1:Search observes the The Cosy Cottage card.:search_location"
                            .to_string(),
                    ),
                    ..EventView::default()
                },
                EventView {
                    seq: 1,
                    type_name: "item.found".to_string(),
                    success: true,
                    actor_id: Some(5000),
                    actor_name: Some("Moss Lantern".to_string()),
                    location_id: Some(COSY_COTTAGE_LOCATION_ID),
                    location_name: Some("The Cosy Cottage".to_string()),
                    item_name: Some("Story Button".to_string()),
                    ..EventView::default()
                },
            ],
        );

        assert_eq!(entries.len(), 2);
        assert!(entries.iter().all(|entry| entry.actor_id == Some(5000)));
        assert_eq!(entries[0].kind, "item");
        assert_eq!(entries[0].text, "Moss Lantern found Story Button");
        assert_eq!(entries[1].kind, "search");
        assert_eq!(
            entries[1].text,
            "Moss Lantern looked closely around The Cosy Cottage"
        );
        assert!(entries.iter().all(|entry| !entry.text.contains("card")));
        assert!(entries
            .iter()
            .all(|entry| !entry.text.contains("search_location")));
        assert!(entries
            .iter()
            .all(|entry| !entry.text.contains("gained found")));
        assert_eq!(
            atmospheric_item_beat("Moss Lantern found Story Button"),
            "Moss Lantern found Story Button"
        );
        assert_eq!(
            atmospheric_search_beat("A way to Homeroom becomes clear"),
            "A path to Homeroom opened"
        );
    }

    #[test]
    fn room_memory_feature_search_names_the_feature_without_a_grammar_tag() {
        let entries = room_memory_entries(
            COSY_COTTAGE_LOCATION_ID,
            &[
                EventView {
                    seq: 2,
                    type_name: "tag.applied".to_string(),
                    success: true,
                    actor_id: Some(5000),
                    actor_name: Some("Pip Maple".to_string()),
                    location_id: Some(COSY_COTTAGE_LOCATION_ID),
                    tag_label: Some("searched Scarf Basket".to_string()),
                    content: Some("search_feature".to_string()),
                    ..EventView::default()
                },
                EventView {
                    seq: 1,
                    type_name: "feature.searched".to_string(),
                    success: true,
                    actor_id: Some(5000),
                    actor_name: Some("Pip Maple".to_string()),
                    location_id: Some(COSY_COTTAGE_LOCATION_ID),
                    location_name: Some("The Cosy Cottage".to_string()),
                    content: Some(
                        "Scarf Basket:Under the top skein is a round notch.:search_feature"
                            .to_string(),
                    ),
                    ..EventView::default()
                },
            ],
        );

        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].text, "Pip Maple looked closely at Scarf Basket");
        assert!(!entries[0].text.contains("became searched"));
    }

    #[test]
    fn room_memory_summary_advances_only_when_room_is_listened_to() {
        let runtime = RuntimeWorld::seeded();
        let location = runtime.location_view(COSY_COTTAGE_LOCATION_ID);
        let state = test_app_state(runtime, None);
        let item_before_listen = EventView {
            seq: 10,
            type_name: "item.picked_up".to_string(),
            success: true,
            actor_name: Some("Moss Lantern".to_string()),
            location_id: Some(COSY_COTTAGE_LOCATION_ID),
            item_name: Some("Dewbright Button".to_string()),
            ..EventView::default()
        };
        let listen = EventView {
            seq: 11,
            type_name: "ability_check.rolled".to_string(),
            success: true,
            actor_name: Some("Moss Lantern".to_string()),
            location_id: Some(COSY_COTTAGE_LOCATION_ID),
            total: Some(16),
            dc: Some(LISTEN_DC as i16),
            ..EventView::default()
        };
        let item_after_listen = EventView {
            seq: 12,
            type_name: "item.picked_up".to_string(),
            success: true,
            actor_name: Some("Moss Lantern".to_string()),
            location_id: Some(COSY_COTTAGE_LOCATION_ID),
            item_name: Some("Moonwool Thread".to_string()),
            ..EventView::default()
        };

        let quiet_view =
            room_memory_view_for_state(&state, &location, &[item_before_listen.clone()]);
        assert_eq!(quiet_view.summary, room_atmosphere_sentence(&location));

        let listened_view =
            room_memory_view_for_state(&state, &location, &[listen.clone(), item_before_listen]);
        assert!(listened_view
            .summary
            .contains("Moss Lantern checked carefully, and the room answered"));

        let after_item_view =
            room_memory_view_for_state(&state, &location, &[item_after_listen, listen]);
        assert_eq!(after_item_view.summary, listened_view.summary);
        assert!(after_item_view
            .latest
            .as_ref()
            .is_some_and(|entry| entry.text.contains("Moonwool Thread")));
    }

    #[test]
    fn room_memory_listen_uses_event_store_log_since_previous_summary() {
        let path = std::env::temp_dir().join(format!(
            "cosyworld-room-memory-since-summary-{}-{}.sqlite",
            std::process::id(),
            now_millis()
        ));
        let runtime = RuntimeWorld::seeded();
        let location = runtime.location_view(COSY_COTTAGE_LOCATION_ID);
        let state = test_app_state(runtime, Some(path.clone()));
        let day_index = current_room_memory_day_index();
        let old_item = EventView {
            seq: 1,
            type_name: "item.picked_up".to_string(),
            success: true,
            actor_name: Some("Moss Lantern".to_string()),
            location_id: Some(COSY_COTTAGE_LOCATION_ID),
            item_name: Some("Old Button".to_string()),
            ..EventView::default()
        };
        let previous_listen = EventView {
            seq: 2,
            type_name: "ability_check.rolled".to_string(),
            success: true,
            actor_name: Some("Moss Lantern".to_string()),
            location_id: Some(COSY_COTTAGE_LOCATION_ID),
            total: Some(14),
            dc: Some(LISTEN_DC as i16),
            ..EventView::default()
        };
        let new_item = EventView {
            seq: 3,
            type_name: "item.picked_up".to_string(),
            success: true,
            actor_name: Some("Moss Lantern".to_string()),
            location_id: Some(COSY_COTTAGE_LOCATION_ID),
            item_name: Some("New Charm".to_string()),
            ..EventView::default()
        };
        let latest_listen = EventView {
            seq: 4,
            type_name: "ability_check.rolled".to_string(),
            success: true,
            actor_name: Some("Moss Lantern".to_string()),
            location_id: Some(COSY_COTTAGE_LOCATION_ID),
            total: Some(18),
            dc: Some(LISTEN_DC as i16),
            ..EventView::default()
        };
        append_event_store(
            &path,
            &[old_item, previous_listen, new_item, latest_listen.clone()],
        )
        .expect("append room memory events");
        upsert_room_memory_chapter(
            &path,
            COSY_COTTAGE_LOCATION_ID,
            day_index,
            2,
            "Earlier firelight remembered the old button.",
            "llm",
        )
        .expect("persist previous room memory chapter");

        let view = room_memory_view_for_state(&state, &location, &[latest_listen]);
        assert!(view.summary.contains("New Charm"));
        assert!(!view.summary.contains("Old Button"));
        let _ = std::fs::remove_file(path);
    }

    #[test]
    fn room_memory_chapters_persist_prior_days_in_order() {
        let path = std::env::temp_dir().join(format!(
            "cosyworld-v2-room-memory-{}-{}.sqlite",
            std::process::id(),
            now_seed()
        ));
        let _ = fs::remove_file(&path);

        upsert_room_memory_chapter(
            &path,
            COSY_COTTAGE_LOCATION_ID,
            20_600,
            12,
            "The cottage learned that Moss Lantern carried rain on their sleeve.",
            "llm",
        )
        .expect("persist first chapter");
        upsert_room_memory_chapter(
            &path,
            COSY_COTTAGE_LOCATION_ID,
            20_601,
            18,
            "Rati listened as the room turned toward Moonwool Thread.",
            "fallback",
        )
        .expect("persist second chapter");
        upsert_room_memory_chapter(
            &path,
            RAIN_SOFT_GARDEN_LOCATION_ID,
            20_601,
            19,
            "The garden kept its own rain-bright discovery.",
            "llm",
        )
        .expect("persist other room chapter");

        let prior = load_room_memory_prior_chapters(&path, COSY_COTTAGE_LOCATION_ID, 20_602, 8)
            .expect("load prior chapters");
        assert_eq!(
            prior
                .iter()
                .map(|chapter| chapter.day_index)
                .collect::<Vec<_>>(),
            vec![20_600, 20_601]
        );
        assert_eq!(prior[0].source, "llm");
        assert!(prior[1].summary.contains("Moonwool Thread"));

        let before_second =
            load_room_memory_prior_chapters(&path, COSY_COTTAGE_LOCATION_ID, 20_601, 8)
                .expect("load before second day");
        assert_eq!(before_second.len(), 1);
        assert_eq!(before_second[0].day_index, 20_600);

        let _ = fs::remove_file(path);
    }

    #[test]
    fn recent_room_lines_survive_global_event_churn_and_snapshot_round_trip() {
        let mut runtime = RuntimeWorld::seeded();
        runtime.push_projected_event(EventView {
            seq: 10_000,
            type_name: "message.created".to_string(),
            success: true,
            actor_id: Some(5000),
            actor_name: Some("Library Guest".to_string()),
            location_id: Some(12),
            location_name: Some("Library".to_string()),
            content: Some("Keep the blue margin note.".to_string()),
            ..EventView::default()
        });
        for seq in 10_001..=10_600 {
            runtime.push_projected_event(EventView {
                seq,
                type_name: "message.created".to_string(),
                success: true,
                actor_id: Some(1001),
                actor_name: Some("Rati".to_string()),
                location_id: Some(1),
                location_name: Some("The Cosy Cottage".to_string()),
                content: Some(format!("busy cottage line {seq}")),
                ..EventView::default()
            });
        }

        assert_eq!(runtime.event_log.len(), 512);
        assert!(runtime
            .event_log
            .iter()
            .all(|event| event.location_id != Some(12)));
        assert_eq!(
            runtime.recent_room_lines(12, 8),
            vec!["Library Guest: Keep the blue margin note."]
        );
        assert_eq!(
            runtime
                .recent_room_lines(1, RECENT_ROOM_LINE_CAPACITY + 10)
                .len(),
            RECENT_ROOM_LINE_CAPACITY
        );

        let path = std::env::temp_dir().join(format!(
            "cosyworld-v2-room-lines-{}-{}.json",
            std::process::id(),
            now_seed()
        ));
        let _ = fs::remove_file(&path);
        runtime
            .save_snapshot(&path)
            .expect("save room-line snapshot");
        let restored = RuntimeWorld::load_snapshot(&path).expect("restore room-line snapshot");
        assert_eq!(
            restored.recent_room_lines(12, 8),
            vec!["Library Guest: Keep the blue margin note."]
        );
        assert_eq!(
            restored
                .recent_room_lines(1, RECENT_ROOM_LINE_CAPACITY + 10)
                .len(),
            RECENT_ROOM_LINE_CAPACITY
        );
        let _ = fs::remove_file(path);
    }
}
