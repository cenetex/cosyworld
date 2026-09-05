use std::{
    collections::{BTreeMap, BTreeSet},
    fs,
    path::Path,
    time::Duration,
};

use axum::{
    extract::{Path as AxumPath, State},
    http::{header, HeaderValue, StatusCode},
    response::{IntoResponse, Response},
};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

use super::*;

const DAILY_JOURNAL_PROTOCOL: &str = "cosyworld.daily-journal.v1";
const DAILY_JOURNAL_FEATURE: &str = "avatar_daily_journal";
const DAILY_JOURNAL_PROMPT_VERSION: &str = "avatar-daily-journal-awakening-v1";
const DAILY_JOURNAL_AWAKENING: &str = "I wake where the day touches sleep. Faces and unfinished feelings come nearer than places. Hopes tug at one another; small moments keep their warmth. What truly happened stays with the evidence, while memory decides only what it means to me.";
const DAILY_JOURNAL_IMAGE_FEATURE: &str = "avatar_daily_journal_image";
const DAILY_JOURNAL_IMAGE_PROMPT_VERSION: &str = "avatar-daily-journal-image-v1";
const DAILY_JOURNAL_STYLE_REVISION: &str = "cosyworld-hand-painted-page/2";
const DAILY_JOURNAL_MAX_UPDATES: usize = 36;
const DAILY_JOURNAL_MAX_CHAT_EXCERPTS: usize = 16;
const DAILY_JOURNAL_MAX_PAGES: usize = 32;

fn default_daily_journal_update_kind() -> String {
    "moment".to_string()
}

#[derive(Clone, Debug, Default, Deserialize, Eq, PartialEq, Serialize)]
pub(super) struct AvatarDailyJournalState {
    #[serde(default)]
    pub(super) observed_through_seq: u64,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub(super) hidden_updates: Vec<DailyJournalHiddenUpdate>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub(super) pending_chat_excerpts: Vec<DailyJournalChatExcerpt>,
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub(super) pages: BTreeMap<u64, DailyJournalPageState>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub(super) struct DailyJournalHiddenUpdate {
    pub(super) source_event_seqs: Vec<u64>,
    #[serde(default = "default_daily_journal_update_kind")]
    pub(super) kind: String,
    pub(super) text: String,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub(super) struct DailyJournalChatExcerpt {
    pub(super) source_event_seq: u64,
    pub(super) speaker_actor_id: u64,
    pub(super) speaker_name: String,
    pub(super) location_id: u64,
    pub(super) location_name: String,
    pub(super) text: String,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub(super) struct DailyJournalPageState {
    pub(super) day_index: u64,
    pub(super) artifact_id: String,
    pub(super) actor_id: u64,
    pub(super) avatar_name: String,
    pub(super) location_id: u64,
    pub(super) location_name: String,
    pub(super) requested_event_seq: u64,
    pub(super) source_event_seqs: Vec<u64>,
    pub(super) hidden_updates: Vec<DailyJournalHiddenUpdate>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub(super) chat_excerpts: Vec<DailyJournalChatExcerpt>,
    pub(super) status: String,
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub(super) entry: String,
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub(super) image_content_type: String,
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub(super) image_digest: String,
    pub(super) style_revision: String,
    pub(super) prompt_version: String,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub(super) struct DailyJournalRestUpdate {
    pub(super) day_index: u64,
    pub(super) rest_kind: String,
    pub(super) observed_through_seq: u64,
    pub(super) actor_id: u64,
    pub(super) avatar_name: String,
    pub(super) location_id: u64,
    pub(super) location_name: String,
    pub(super) updates: Vec<DailyJournalHiddenUpdate>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub(super) chat_excerpts: Vec<DailyJournalChatExcerpt>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub(super) struct DailyJournalPagePublication {
    pub(super) day_index: u64,
    pub(super) artifact_id: String,
    pub(super) entry: String,
    #[serde(default)]
    pub(super) image_content_type: String,
    #[serde(default)]
    pub(super) image_digest: String,
}

#[derive(Clone, Debug, Serialize)]
pub(super) struct DailyJournalView {
    protocol: &'static str,
    pages: Vec<DailyJournalPageView>,
}

#[derive(Clone, Debug, Serialize)]
struct DailyJournalPageView {
    actor_id: u64,
    day_index: u64,
    page_index: usize,
    artifact_id: String,
    rest_kind: &'static str,
    status: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    image_url: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    image_alt: Option<String>,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    chat_excerpts: Vec<DailyJournalChatExcerpt>,
    style_revision: String,
}

impl RuntimeWorld {
    pub(super) fn plan_daily_journal_rest_update(
        &self,
        actor_id: u64,
        day_index: u64,
        long_rest: bool,
    ) -> Option<DailyJournalRestUpdate> {
        let actor = self.actor_by_id(actor_id)?;
        let location_name = self.location_name(actor.location_id)?;
        let avatar_name = self.actor_name(actor_id)?;
        let observed_after = self
            .daily_journals
            .get(&actor_id)
            .map(|journal| journal.observed_through_seq)
            .unwrap_or_default();
        let observed_through_seq = self.world.next_event_seq.saturating_sub(1);
        let recent = daily_journal_observed_events(
            &self.event_log,
            actor_id,
            actor.location_id,
            observed_after,
            observed_through_seq,
        );
        let chat_excerpts = daily_journal_chat_excerpts(self, &recent);
        let mut updates = daily_journal_context_updates(self, actor_id, &recent, &chat_excerpts);
        if updates.is_empty() {
            updates.push(DailyJournalHiddenUpdate {
                source_event_seqs: Vec::new(),
                kind: "moment".to_string(),
                text: format!("A quiet pause at {}.", compact_whitespace(&location_name)),
            });
        }
        Some(DailyJournalRestUpdate {
            day_index,
            rest_kind: if long_rest { "long" } else { "short" }.to_string(),
            observed_through_seq,
            actor_id,
            avatar_name: grounded_avatar_name_for_prompt(actor_id, &avatar_name),
            location_id: actor.location_id,
            location_name: compact_whitespace(&location_name),
            updates,
            chat_excerpts,
        })
    }

    pub(super) fn apply_daily_journal_rest_update(&mut self, update: &DailyJournalRestUpdate) {
        let journal = self.daily_journals.entry(update.actor_id).or_default();
        journal.observed_through_seq = journal
            .observed_through_seq
            .max(update.observed_through_seq);
        for candidate in &update.updates {
            if journal.hidden_updates.iter().any(|existing| {
                existing.source_event_seqs == candidate.source_event_seqs
                    && existing.kind == candidate.kind
                    && existing.text == candidate.text
            }) {
                continue;
            }
            journal.hidden_updates.push(candidate.clone());
        }
        if journal.hidden_updates.len() > DAILY_JOURNAL_MAX_UPDATES {
            let excess = journal.hidden_updates.len() - DAILY_JOURNAL_MAX_UPDATES;
            journal.hidden_updates.drain(0..excess);
        }
        for excerpt in &update.chat_excerpts {
            if journal
                .pending_chat_excerpts
                .iter()
                .any(|existing| existing.source_event_seq == excerpt.source_event_seq)
            {
                continue;
            }
            journal.pending_chat_excerpts.push(excerpt.clone());
        }
        journal.pending_chat_excerpts =
            bound_daily_journal_chat_excerpts(std::mem::take(&mut journal.pending_chat_excerpts));
        if update.rest_kind != "long" || journal.pages.contains_key(&update.day_index) {
            return;
        }
        let artifact_id = daily_journal_artifact_id(update.actor_id, update.day_index);
        let hidden_updates = std::mem::take(&mut journal.hidden_updates);
        let chat_excerpts = std::mem::take(&mut journal.pending_chat_excerpts);
        let mut source_event_seqs = hidden_updates
            .iter()
            .flat_map(|item| item.source_event_seqs.iter().copied())
            .collect::<Vec<_>>();
        source_event_seqs.extend(chat_excerpts.iter().map(|excerpt| excerpt.source_event_seq));
        source_event_seqs.sort_unstable();
        source_event_seqs.dedup();
        journal.pages.insert(
            update.day_index,
            DailyJournalPageState {
                day_index: update.day_index,
                artifact_id,
                actor_id: update.actor_id,
                avatar_name: update.avatar_name.clone(),
                location_id: update.location_id,
                location_name: update.location_name.clone(),
                requested_event_seq: update.observed_through_seq,
                source_event_seqs,
                hidden_updates,
                chat_excerpts,
                status: "pending".to_string(),
                entry: String::new(),
                image_content_type: String::new(),
                image_digest: String::new(),
                style_revision: DAILY_JOURNAL_STYLE_REVISION.to_string(),
                prompt_version: DAILY_JOURNAL_PROMPT_VERSION.to_string(),
            },
        );
        while journal.pages.len() > DAILY_JOURNAL_MAX_PAGES {
            let Some(oldest) = journal.pages.keys().next().copied() else {
                break;
            };
            journal.pages.remove(&oldest);
        }
    }

    pub(super) fn apply_daily_journal_publication(
        &mut self,
        actor_id: u64,
        publication: &DailyJournalPagePublication,
    ) -> Option<EventView> {
        let page = self
            .daily_journals
            .get_mut(&actor_id)?
            .pages
            .get_mut(&publication.day_index)?;
        if page.artifact_id != publication.artifact_id || page.status == "ready" {
            return None;
        }
        let entry = sanitize_daily_journal_entry(&publication.entry)?;
        let has_generated_image =
            !publication.image_content_type.is_empty() || !publication.image_digest.is_empty();
        if has_generated_image
            && (!matches!(
                publication.image_content_type.as_str(),
                "image/png" | "image/jpeg" | "image/webp" | "image/gif"
            ) || publication.image_digest.len() != 64
                || !publication
                    .image_digest
                    .bytes()
                    .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte)))
        {
            return None;
        }
        page.entry = entry;
        page.image_content_type = publication.image_content_type.clone();
        page.image_digest = publication.image_digest.clone();
        page.status = "ready".to_string();
        Some(self.append_async_job_event("journal.page.written", actor_id, None, None))
    }

    pub(super) fn daily_journal_view(&self, actor_id: u64) -> DailyJournalView {
        let pages = self
            .daily_journals
            .get(&actor_id)
            .map(|journal| {
                journal
                    .pages
                    .values()
                    .enumerate()
                    .map(|(page_index, page)| {
                        let ready = page.status == "ready" && !page.entry.is_empty();
                        DailyJournalPageView {
                            actor_id,
                            day_index: page.day_index,
                            page_index,
                            artifact_id: page.artifact_id.clone(),
                            rest_kind: "long",
                            status: page.status.clone(),
                            image_url: ready.then(|| daily_journal_image_url(page)),
                            image_alt: ready.then(|| {
                                format!(
                                    "{}'s daily Journal, in their own words: {}",
                                    page.avatar_name, page.entry
                                )
                            }),
                            chat_excerpts: page.chat_excerpts.clone(),
                            style_revision: page.style_revision.clone(),
                        }
                    })
                    .collect::<Vec<_>>()
            })
            .unwrap_or_default();
        DailyJournalView {
            protocol: DAILY_JOURNAL_PROTOCOL,
            pages,
        }
    }
}

fn daily_journal_observed_events(
    event_log: &[EventView],
    actor_id: u64,
    current_location_id: u64,
    observed_after: u64,
    observed_through: u64,
) -> Vec<EventView> {
    let mut room_cursor = current_location_id;
    let mut observed = Vec::new();
    for event in event_log.iter().rev().filter(|event| {
        event.success && event.seq > observed_after && event.seq <= observed_through
    }) {
        let event_location_id = event.location_id.or(event.source_location_id);
        if event.actor_id == Some(actor_id) || event_location_id == Some(room_cursor) {
            observed.push(event.clone());
        }
        if event.actor_id == Some(actor_id) && event.type_name == "actor.moved" {
            if let Some(origin_location_id) = event.location_id {
                room_cursor = origin_location_id;
            }
        }
    }
    observed.reverse();
    observed
}

fn daily_journal_chat_excerpts(
    runtime: &RuntimeWorld,
    events: &[EventView],
) -> Vec<DailyJournalChatExcerpt> {
    let excerpts = events
        .iter()
        .filter(|event| event.type_name == "message.created")
        .filter_map(|event| {
            let text = compact_whitespace(event.content.as_deref()?);
            if text.is_empty() {
                return None;
            }
            let location_id = event.location_id.or(event.source_location_id)?;
            let speaker_actor_id = event.actor_id.unwrap_or_default();
            Some(DailyJournalChatExcerpt {
                source_event_seq: event.seq,
                speaker_actor_id,
                speaker_name: event
                    .actor_name
                    .clone()
                    .or_else(|| runtime.actor_name(speaker_actor_id))
                    .unwrap_or_else(|| "Someone".to_string()),
                location_id,
                location_name: event
                    .location_name
                    .clone()
                    .or_else(|| runtime.location_name(location_id))
                    .unwrap_or_else(|| "Somewhere along the way".to_string()),
                text,
            })
        })
        .collect::<Vec<_>>();
    bound_daily_journal_chat_excerpts(excerpts)
}

fn bound_daily_journal_chat_excerpts(
    mut excerpts: Vec<DailyJournalChatExcerpt>,
) -> Vec<DailyJournalChatExcerpt> {
    excerpts.sort_by_key(|excerpt| excerpt.source_event_seq);
    excerpts.dedup_by_key(|excerpt| excerpt.source_event_seq);
    if excerpts.len() <= DAILY_JOURNAL_MAX_CHAT_EXCERPTS {
        return excerpts;
    }

    let mut selected_seqs = BTreeSet::new();
    for excerpt in excerpts.iter().rev() {
        if selected_seqs.len() >= DAILY_JOURNAL_MAX_CHAT_EXCERPTS {
            break;
        }
        let room_already_kept = excerpts.iter().rev().any(|candidate| {
            candidate.source_event_seq > excerpt.source_event_seq
                && candidate.location_id == excerpt.location_id
                && selected_seqs.contains(&candidate.source_event_seq)
        });
        if !room_already_kept {
            selected_seqs.insert(excerpt.source_event_seq);
        }
    }
    for excerpt in excerpts.iter().rev() {
        if selected_seqs.len() >= DAILY_JOURNAL_MAX_CHAT_EXCERPTS {
            break;
        }
        selected_seqs.insert(excerpt.source_event_seq);
    }
    excerpts
        .into_iter()
        .filter(|excerpt| selected_seqs.contains(&excerpt.source_event_seq))
        .collect()
}

fn daily_journal_context_updates(
    runtime: &RuntimeWorld,
    actor_id: u64,
    events: &[EventView],
    chat_excerpts: &[DailyJournalChatExcerpt],
) -> Vec<DailyJournalHiddenUpdate> {
    let mut updates = Vec::new();
    let mut latest_conversation_by_speaker = BTreeMap::new();
    for excerpt in chat_excerpts {
        if excerpt.speaker_actor_id != actor_id {
            latest_conversation_by_speaker.insert(excerpt.speaker_actor_id, excerpt);
        }
    }
    let mut conversations = latest_conversation_by_speaker
        .into_values()
        .collect::<Vec<_>>();
    conversations.sort_by_key(|excerpt| std::cmp::Reverse(excerpt.source_event_seq));
    updates.extend(
        conversations
            .into_iter()
            .take(4)
            .map(|excerpt| DailyJournalHiddenUpdate {
                source_event_seqs: vec![excerpt.source_event_seq],
                kind: "conversation".to_string(),
                text: format!(
                    "I spoke with {} at {}.",
                    excerpt.speaker_name, excerpt.location_name
                ),
            }),
    );

    let mut bonds = runtime.bond_views(actor_id);
    bonds.sort_by_key(|bond| {
        std::cmp::Reverse(
            bond.updated_event_seq
                .or(bond.source_event_seq)
                .unwrap_or_default(),
        )
    });
    updates.extend(bonds.into_iter().take(3).map(|bond| {
        let name = bond
            .target_actor_name
            .unwrap_or_else(|| "someone important".to_string());
        DailyJournalHiddenUpdate {
            source_event_seqs: bond
                .updated_event_seq
                .or(bond.source_event_seq)
                .into_iter()
                .collect(),
            kind: "relationship".to_string(),
            text: format!(
                "My bond with {name}: {}",
                compact_whitespace(&bond.statement)
            ),
        }
    }));

    if let Some(calling) = runtime.calling_view(actor_id) {
        let statement = compact_whitespace(&calling.statement);
        if !statement.is_empty() {
            updates.push(DailyJournalHiddenUpdate {
                source_event_seqs: Vec::new(),
                kind: "calling".to_string(),
                text: format!("My calling: {statement}"),
            });
        }
    }
    if let Some(journey) = runtime.journey_view(actor_id) {
        let next = journey
            .next_location_name
            .map(|name| format!("; next comes {name}"))
            .unwrap_or_default();
        updates.push(DailyJournalHiddenUpdate {
            source_event_seqs: Vec::new(),
            kind: "journey".to_string(),
            text: format!("My journey is toward {}{next}", journey.destination_name),
        });
    }

    updates.extend(
        events
            .iter()
            .rev()
            .filter(|event| event.actor_id == Some(actor_id) && event.type_name == "avatar.dream")
            .filter_map(|event| {
                let text = compact_whitespace(event.content.as_deref()?);
                (!text.is_empty()).then(|| DailyJournalHiddenUpdate {
                    source_event_seqs: vec![event.seq],
                    kind: "dream".to_string(),
                    text,
                })
            })
            .take(2),
    );

    let mut beats = journal_beat_views(
        events,
        runtime
            .actor_by_id(actor_id)
            .map_or(0, |actor| actor.location_id),
    );
    beats.sort_by_key(|beat| {
        (
            daily_journal_beat_priority(beat.category),
            std::cmp::Reverse(beat.ordering_seq),
        )
    });
    updates.extend(beats.into_iter().take(10).filter_map(|beat| {
        let text = compact_whitespace(&beat.headline);
        (!text.is_empty()).then(|| DailyJournalHiddenUpdate {
            source_event_seqs: beat.source_event_seqs,
            kind: daily_journal_beat_kind(beat.category).to_string(),
            text,
        })
    }));
    updates.truncate(DAILY_JOURNAL_MAX_UPDATES);
    updates
}

fn daily_journal_beat_priority(category: JournalBeatCategory) -> u8 {
    match category {
        JournalBeatCategory::Relationship => 0,
        JournalBeatCategory::Growth => 1,
        JournalBeatCategory::Story => 2,
        JournalBeatCategory::Travel => 3,
        JournalBeatCategory::Consequence => 4,
        JournalBeatCategory::Discovery | JournalBeatCategory::Work => 5,
        JournalBeatCategory::Item | JournalBeatCategory::Search => 6,
    }
}

fn daily_journal_beat_kind(category: JournalBeatCategory) -> &'static str {
    match category {
        JournalBeatCategory::Relationship => "relationship",
        JournalBeatCategory::Growth => "growth",
        JournalBeatCategory::Story => "story",
        JournalBeatCategory::Travel => "journey",
        JournalBeatCategory::Consequence => "consequence",
        JournalBeatCategory::Discovery => "discovery",
        JournalBeatCategory::Work => "work",
        JournalBeatCategory::Item => "item",
        JournalBeatCategory::Search => "search",
    }
}

pub(super) fn current_daily_journal_day_index() -> u64 {
    current_room_memory_day_index()
}

pub(super) fn schedule_daily_journal_page(state: &AppState, actor_id: u64, day_index: u64) {
    let state = state.clone();
    tokio::spawn(async move {
        if let Err(error) = complete_daily_journal_page(&state, actor_id, day_index).await {
            tracing::warn!(
                "daily Journal page generation failed for actor {} day {}: {}",
                actor_id,
                day_index,
                error
            );
        }
    });
}

async fn complete_daily_journal_page(
    state: &AppState,
    actor_id: u64,
    day_index: u64,
) -> Result<(), String> {
    let page = {
        let runtime = state.inner.lock().await;
        let Some(page) = runtime
            .daily_journals
            .get(&actor_id)
            .and_then(|journal| journal.pages.get(&day_index))
            .cloned()
        else {
            return Ok(());
        };
        if page.status == "ready" {
            return Ok(());
        }
        page
    };
    let fallback = fallback_daily_journal_entry(&page);
    let entry = if let Some(config) = state.ai_config.as_ref().as_ref() {
        let evidence = daily_journal_ai_evidence(&page);
        let (system, user) = daily_journal_messages(
            &page.avatar_name,
            &page.location_name,
            if evidence.is_empty() {
                "- A quiet day settled without one large event."
            } else {
                &evidence
            },
        );
        request_chat_completion_for_key(
            config,
            ChatCompletionRequest {
                feature: DAILY_JOURNAL_FEATURE,
                prompt_version: DAILY_JOURNAL_PROMPT_VERSION,
                capability: ModelCapability::WorldContent,
                system,
                user: &user,
                temperature: 0.45,
                max_tokens: 260,
                timeout: Duration::from_secs(18),
                max_attempts: 1,
                referer: "https://cosy.world/",
                response_format: None,
                room_id: Some(page.location_id),
            },
            &format!("daily-journal:{}:{}", actor_id, day_index),
        )
        .await
        .ok()
        .and_then(|completion| sanitize_daily_journal_entry(&completion.text))
        .unwrap_or(fallback)
    } else {
        fallback
    };
    let generated_image = if let Some(config) = state.ai_config.as_ref().as_ref() {
        let image_prompt = daily_journal_image_prompt(&page, &entry);
        request_image_generation_for_key(
            config,
            ImageGenerationRequest {
                feature: DAILY_JOURNAL_IMAGE_FEATURE,
                prompt_version: DAILY_JOURNAL_IMAGE_PROMPT_VERSION,
                prompt: &image_prompt,
                reference: None,
                timeout: Duration::from_secs(90),
                max_attempts: 1,
                referer: "https://cosy.world/",
            },
            &format!("daily-journal-image:{}:{}", actor_id, day_index),
        )
        .await
        .ok()
        .and_then(|generated| {
            store_daily_journal_image(
                &state.generated_asset_dir,
                &page.artifact_id,
                &generated.bytes,
                &generated.content_type,
            )
            .map_err(|error| {
                tracing::warn!(
                    "daily Journal image storage failed for actor {} day {}: {}",
                    actor_id,
                    day_index,
                    error
                );
            })
            .ok()
        })
    } else {
        None
    };
    let (image_content_type, image_digest) = generated_image.unwrap_or_default();
    let publication = DailyJournalPagePublication {
        day_index,
        artifact_id: page.artifact_id.clone(),
        entry,
        image_content_type,
        image_digest,
    };
    let events = {
        let mut runtime = state.inner.lock().await;
        if runtime
            .daily_journals
            .get(&actor_id)
            .and_then(|journal| journal.pages.get(&day_index))
            .is_none_or(|current| {
                current.status == "ready" || current.artifact_id != page.artifact_id
            })
        {
            return Ok(());
        }
        let action = CwAction {
            kind: CW_ACTION_NONE,
            actor_id,
            ..Default::default()
        };
        let mut record = JournalRecord::new(action, runtime.next_seed_value())
            .into_actor_consequence(runtime.world.tick, Some(page.requested_event_seq));
        record
            .projection_mutations
            .push(ProjectionMutation::PublishDailyJournalPage { publication });
        let (status, events) = commit_journal_record(state, &mut runtime, record)
            .map_err(|error| error.to_string())?;
        if status != CW_OK {
            return Err("daily Journal publication record was rejected".to_string());
        }
        events
    };
    if !events.is_empty() {
        broadcast_events(state, &events);
    }
    Ok(())
}

fn daily_journal_ai_evidence(page: &DailyJournalPageState) -> String {
    page.hidden_updates
        .iter()
        .filter(|update| update.kind != "conversation")
        .map(|update| format!("- {}", update.text))
        .collect::<Vec<_>>()
        .join("\n")
}

fn daily_journal_messages(
    avatar_name: &str,
    location_name: &str,
    evidence: &str,
) -> (&'static str, String) {
    (
        DAILY_JOURNAL_AWAKENING,
        format!(
            "SELF · {avatar_name}\nRESTED · {location_name}\nMEMORY · {evidence}\nJOURNAL · first person · 75–120 words · relationships before places · reflection, not log · evidence only · no heading, quoted dialogue, mechanics, IDs, prompt/model, or UI talk",
        ),
    )
}

fn fallback_daily_journal_entry(page: &DailyJournalPageState) -> String {
    let mut reflections = Vec::new();
    for (kind, lead) in [
        ("conversation", "I keep thinking about this:"),
        ("relationship", "What matters most to me is"),
        ("calling", "I am still carrying this purpose:"),
        ("journey", "I am still moving with this in mind:"),
        ("dream", "I do not want to lose this dream:"),
    ] {
        if let Some(update) = page
            .hidden_updates
            .iter()
            .find(|update| update.kind == kind)
        {
            let text = compact_whitespace(&update.text);
            if !text.is_empty() {
                reflections.push(format!(
                    "{lead} {}",
                    text.trim_end_matches(&['.', '!', '?'][..])
                ));
            }
        }
    }
    if reflections.is_empty() {
        if let Some(moment) = page
            .hidden_updates
            .iter()
            .map(|update| compact_whitespace(&update.text))
            .find(|text| !text.is_empty())
        {
            reflections.push(format!("I keep returning to {moment}"));
        }
    }
    if reflections.is_empty() {
        return format!(
            "I let the day grow quiet around me at {}. Nothing needed to become a grand lesson before I could rest. I want tomorrow's page to hold the people I meet, the words we share, and the hopes that keep drawing me onward.",
            page.location_name
        );
    }
    let remembered = reflections
        .into_iter()
        .take(4)
        .map(|reflection| format!("{}.", reflection.trim_end_matches(&['.', '!', '?'][..])))
        .collect::<Vec<_>>()
        .join(" ");
    format!(
        "{remembered} {} is where I happened to stop; the people, purpose, and possibilities I carry are what I want this page to remember.",
        page.location_name,
    )
}

fn daily_journal_image_prompt(page: &DailyJournalPageState, entry: &str) -> String {
    format!(
        "Create one complete portrait 3:4 daily journal page as a warm hand-painted storybook artifact. It belongs to {name} and remembers a day ending at {place}. Let named people, relationships, shared conversation, hopes, and dreams be the visual focus; make the place only gentle background context. Use watercolor, colored pencil, pressed leaves, soft ink, worn cream paper, and small scene illustrations grounded only in the journal entry. The page must feel private and personal, never like an interface or travel log. No spreadsheet, table, chart, status meter, event log, badges, controls, metadata, IDs, or technical text. Include the supplied first-person entry as the only substantial writing, in neat dark handwritten lettering:\n\n{entry}",
        name = page.avatar_name,
        place = page.location_name,
    )
}

fn sanitize_daily_journal_entry(value: &str) -> Option<String> {
    let text = compact_whitespace(
        value
            .trim()
            .trim_start_matches("```")
            .trim_end_matches("```")
            .trim(),
    );
    let lowered = text.to_ascii_lowercase();
    if text.is_empty()
        || text.chars().any(char::is_control)
        || ![" i ", " i'm ", " i've ", " my ", " me "]
            .iter()
            .any(|marker| format!(" {lowered} ").contains(marker))
        || [
            "system prompt",
            "language model",
            "journal://",
            "event_seq",
            "source_event",
            "projection",
            "ledger.",
            "world.",
        ]
        .iter()
        .any(|marker| lowered.contains(marker))
    {
        return None;
    }
    let words = text.split_whitespace().take(130).collect::<Vec<_>>();
    if words.len() < 12 {
        return None;
    }
    let mut bounded = words.join(" ");
    if !bounded.ends_with(&['.', '!', '?'][..]) {
        bounded.push('.');
    }
    Some(bounded)
}

fn daily_journal_artifact_id(actor_id: u64, day_index: u64) -> String {
    format!(
        "{:x}",
        Sha256::digest(
            format!(
                "{DAILY_JOURNAL_PROTOCOL}\0{}\0{}\0{actor_id}\0{day_index}",
                official_world_id(),
                official_world_epoch()
            )
            .as_bytes()
        )
    )
}

fn daily_journal_image_url(page: &DailyJournalPageState) -> String {
    let extension = if page.image_content_type.is_empty() {
        "svg"
    } else {
        "image"
    };
    format!(
        "/assets/generated/journal-pages/{}.{}",
        page.artifact_id, extension
    )
}

fn daily_journal_image_dir(root: &Path) -> std::path::PathBuf {
    root.join("daily-journal-pages")
}

fn daily_journal_generated_image_path(root: &Path, artifact_id: &str) -> std::path::PathBuf {
    daily_journal_image_dir(root).join(format!("{artifact_id}.image"))
}

fn store_daily_journal_image(
    root: &Path,
    artifact_id: &str,
    bytes: &[u8],
    content_type: &str,
) -> Result<(String, String), String> {
    let inferred = match image::guess_format(bytes).map_err(|error| error.to_string())? {
        image::ImageFormat::Png => "image/png",
        image::ImageFormat::Jpeg => "image/jpeg",
        image::ImageFormat::WebP => "image/webp",
        image::ImageFormat::Gif => "image/gif",
        _ => return Err("daily Journal image format is unsupported".to_string()),
    };
    if content_type != inferred {
        return Err("daily Journal image MIME type did not match its bytes".to_string());
    }
    let directory = daily_journal_image_dir(root);
    fs::create_dir_all(&directory).map_err(|error| error.to_string())?;
    let path = daily_journal_generated_image_path(root, artifact_id);
    let temporary = directory.join(format!("{artifact_id}.tmp-{}", now_seed()));
    fs::write(&temporary, bytes).map_err(|error| error.to_string())?;
    fs::rename(&temporary, &path).map_err(|error| error.to_string())?;
    Ok((
        content_type.to_string(),
        format!("{:x}", Sha256::digest(bytes)),
    ))
}

pub(super) async fn generated_daily_journal_page_asset(
    State(state): State<AppState>,
    AxumPath(asset_file): AxumPath<String>,
) -> Response {
    let (artifact_id, generated_requested) = if let Some(value) = asset_file.strip_suffix(".image")
    {
        (value, true)
    } else if let Some(value) = asset_file.strip_suffix(".svg") {
        (value, false)
    } else {
        return StatusCode::NOT_FOUND.into_response();
    };
    if artifact_id.len() != 64 || !artifact_id.bytes().all(|byte| byte.is_ascii_hexdigit()) {
        return StatusCode::NOT_FOUND.into_response();
    }
    let page = {
        let runtime = state.inner.lock().await;
        runtime
            .daily_journals
            .values()
            .flat_map(|journal| journal.pages.values())
            .find(|page| page.artifact_id == artifact_id && page.status == "ready")
            .cloned()
    };
    let Some(page) = page else {
        return StatusCode::NOT_FOUND.into_response();
    };
    if generated_requested && !page.image_content_type.is_empty() {
        let path = daily_journal_generated_image_path(&state.generated_asset_dir, artifact_id);
        if let Ok(bytes) = fs::read(path) {
            let digest = format!("{:x}", Sha256::digest(&bytes));
            if digest == page.image_digest {
                let mut response = bytes.into_response();
                if let Ok(value) = HeaderValue::from_str(&page.image_content_type) {
                    response.headers_mut().insert(header::CONTENT_TYPE, value);
                }
                response.headers_mut().insert(
                    header::CACHE_CONTROL,
                    HeaderValue::from_static("private, max-age=31536000, immutable"),
                );
                return response;
            }
        }
    }
    let svg = daily_journal_svg(&page);
    let mut response = svg.into_response();
    response.headers_mut().insert(
        header::CONTENT_TYPE,
        HeaderValue::from_static("image/svg+xml; charset=utf-8"),
    );
    response.headers_mut().insert(
        header::CACHE_CONTROL,
        HeaderValue::from_static("private, max-age=31536000, immutable"),
    );
    response
}

fn daily_journal_svg(page: &DailyJournalPageState) -> String {
    let lines = wrap_journal_entry(&page.entry, 50, 14);
    let text = lines
        .iter()
        .enumerate()
        .map(|(index, line)| {
            format!(
                "<tspan x=\"150\" dy=\"{}\">{}</tspan>",
                if index == 0 { 0 } else { 66 },
                xml_escape(line)
            )
        })
        .collect::<String>();
    format!(
        r##"<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="1600" viewBox="0 0 1200 1600" role="img" aria-label="{alt}">
<defs>
  <filter id="paper"><feTurbulence type="fractalNoise" baseFrequency=".018" numOctaves="3" seed="{seed}"/><feColorMatrix values=".16 0 0 0 .72  0 .13 0 0 .66  0 0 .09 0 .48  0 0 0 .12 0"/><feBlend in="SourceGraphic" mode="multiply"/></filter>
  <filter id="wash"><feGaussianBlur stdDeviation="18"/></filter>
  <linearGradient id="page" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#eadfbe"/><stop offset="1" stop-color="#cbb98d"/></linearGradient>
</defs>
<rect width="1200" height="1600" rx="18" fill="url(#page)"/>
<g opacity=".42" filter="url(#wash)"><ellipse cx="925" cy="270" rx="220" ry="160" fill="#728b62"/><ellipse cx="250" cy="1320" rx="250" ry="150" fill="#879b73"/><circle cx="1040" cy="1310" r="130" fill="#c58f68"/></g>
<path d="M78 60 C118 350 56 690 92 1020 S66 1390 105 1540" fill="none" stroke="#506248" stroke-width="7" opacity=".28"/>
<g filter="url(#paper)"><rect x="42" y="42" width="1116" height="1516" rx="12" fill="none" stroke="#665d43" stroke-width="2" opacity=".34"/></g>
<text x="150" y="175" fill="#526049" font-family="Georgia,serif" font-size="27" font-style="italic">{name}'s journal</text>
<text x="150" y="250" fill="#28352b" font-family="Georgia,serif" font-size="58" font-style="italic">What I remember</text>
<path d="M150 284 C360 270 520 300 735 282" fill="none" stroke="#66745b" stroke-width="4" opacity=".5"/>
<text x="150" y="390" fill="#2b352c" font-family="Georgia,serif" font-size="35" font-style="italic">{text}</text>
<path d="M910 1370 c70 -95 126 -75 138 -18 c-76 -7 -101 40 -116 104 c-22 -25 -32 -52 -22 -86z" fill="#657b59" opacity=".42"/>
<path d="M940 1450 q60 -120 112 -176" fill="none" stroke="#53664c" stroke-width="6" opacity=".45"/>
</svg>"##,
        alt = xml_escape(&format!("{}'s daily Journal page", page.avatar_name)),
        seed = page.day_index % 997,
        name = xml_escape(&page.avatar_name),
    )
}

fn wrap_journal_entry(value: &str, width: usize, max_lines: usize) -> Vec<String> {
    let mut lines = Vec::new();
    let mut line = String::new();
    for word in value.split_whitespace() {
        if !line.is_empty() && line.chars().count() + 1 + word.chars().count() > width {
            lines.push(std::mem::take(&mut line));
            if lines.len() == max_lines {
                break;
            }
        }
        if !line.is_empty() {
            line.push(' ');
        }
        line.push_str(word);
    }
    if lines.len() < max_lines && !line.is_empty() {
        lines.push(line);
    }
    let reached_limit = lines.len() == max_lines;
    if let Some(last) = lines.last_mut() {
        if reached_limit && !last.ends_with(&['.', '!', '?', '…'][..]) {
            last.push('…');
        }
    }
    lines
}

fn xml_escape(value: &str) -> String {
    value
        .replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
        .replace('\'', "&apos;")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn player_journal_fields_never_enter_the_system_awakening() {
        let (system, user) = daily_journal_messages(
            "Player Name Sentinel",
            "Player Place Sentinel",
            "Player Memory Sentinel",
        );
        assert!(system.starts_with("I wake"));
        for sentinel in [
            "Player Name Sentinel",
            "Player Place Sentinel",
            "Player Memory Sentinel",
        ] {
            assert!(!system.contains(sentinel));
            assert!(user.contains(sentinel));
        }
    }

    fn journal_test_event(
        seq: u64,
        actor_id: u64,
        actor_name: &str,
        location_id: u64,
        location_name: &str,
        destination_location_id: Option<u64>,
        content: Option<&str>,
    ) -> EventView {
        let type_name = if destination_location_id.is_some() {
            "actor.moved"
        } else {
            "message.created"
        };
        serde_json::from_value(serde_json::json!({
            "seq": seq,
            "type": type_name,
            "success": true,
            "reason": 0,
            "actor_id": actor_id,
            "actor_name": actor_name,
            "location_id": location_id,
            "location_name": location_name,
            "destination_location_id": destination_location_id,
            "content": content,
        }))
        .expect("journal test event")
    }

    #[test]
    fn browser_journal_keeps_the_illustrated_page_and_shows_recent_chats() {
        assert!(INDEX_HTML.contains("id=\"journal-view\" aria-label=\"Journal\" hidden"));
        assert!(INDEX_HTML.contains("aria-expanded=\"false\" aria-controls=\"journal-view\""));
        assert!(INDEX_HTML.contains("function setJournalOpen"));
        assert!(INDEX_HTML.contains("terminal?.classList.toggle(\"journal-open\", open)"));
        assert!(INDEX_HTML.contains("function journalProseRowHtml"));
        assert!(INDEX_HTML.contains("function localWorldConditionBeat"));
        assert!(INDEX_HTML.contains("data-export-journal"));
        assert!(
            INDEX_HTML.contains("class=\"journal-internal-context\" hidden aria-hidden=\"true\"")
        );
        assert!(INDEX_HTML.contains("function renderSharedQuestions"));
        assert!(INDEX_HTML.contains("id=\"journal-story-history\""));
        assert!(INDEX_HTML.contains("aria-label=\"Daily illustrated Journal pages\""));
        assert!(!INDEX_HTML.contains("aria-label=\"Chronological story history\""));
        assert!(!INDEX_HTML.contains("What the place felt like"));
        assert!(!INDEX_HTML.contains("Still on my mind"));
        assert!(INDEX_HTML.contains("explanation_opened"));
        assert!(INDEX_HTML.contains("return_change_seen"));
        assert!(INDEX_HTML.contains("id=\"journal-open-threads\""));
        assert!(INDEX_HTML.contains("function syncJournalRegions"));
        assert!(INDEX_HTML.contains("function naturalFeatureEventText"));
        assert!(INDEX_HTML.contains("id=\"journal-notification-count\""));
        assert!(INDEX_HTML.contains("atmosphericMemoryBeat"));
        assert!(INDEX_HTML.contains("function firstThreadModel"));
        assert!(INDEX_HTML.contains("function nextStoryThreadModel"));
        assert!(INDEX_HTML.contains("function firstTaleIsComplete"));
        assert!(!INDEX_HTML.contains("class=\"update-pill story-thread\""));
        assert!(!INDEX_HTML.contains("data-story-action-key"));
        assert!(!INDEX_HTML.contains("function storyThreadHtml"));
        assert!(INDEX_HTML.contains("A path to ${destination} is waiting"));
        assert!(INDEX_HTML.contains("is still waiting to be found"));
        assert!(INDEX_HTML.contains("room thread"));
        assert!(INDEX_HTML.contains("Your first tale continues when you"));
        assert!(!INDEX_HTML.contains("chapter ${firstThread.stage} of ${firstThread.total}"));
        assert!(INDEX_HTML.contains("const tale = view.first_tale;"));
        assert!(INDEX_HTML.contains("tale.progress_clock_id"));
        assert!(INDEX_HTML.contains("view?.first_tale?.next_invitation"));
        assert!(INDEX_HTML.contains("view?.first_tale?.completion_memory"));
        assert!(INDEX_HTML.contains("function renderJournalLog"));
        assert!(INDEX_HTML.contains("function dailyJournalPagesForPresentation"));
        assert!(INDEX_HTML.contains("String(page.rest_kind || \"\").toLowerCase() !== \"long\""));
        assert!(INDEX_HTML.contains("const daily = new Map()"));
        assert!(INDEX_HTML.contains("class=\"journal-page-illustration generated\""));
        assert!(INDEX_HTML.contains("class=\"journal-chat-log\" aria-label=\"Recent chats\""));
        assert!(INDEX_HTML.contains("page?.chat_excerpts"));
        assert!(!INDEX_HTML.contains("painted after a long rest"));
        assert!(!INDEX_HTML.contains("function journalEventHtml"));
    }

    #[test]
    fn one_daily_artifact_identity_is_stable_per_actor_and_day() {
        assert_eq!(
            daily_journal_artifact_id(5000, 20_600),
            daily_journal_artifact_id(5000, 20_600)
        );
        assert_ne!(
            daily_journal_artifact_id(5000, 20_600),
            daily_journal_artifact_id(5000, 20_601)
        );
    }

    #[test]
    fn recent_chat_follows_the_avatar_through_every_visited_room() {
        let events = vec![
            journal_test_event(
                1,
                2001,
                "Fern",
                1,
                "Cottage",
                None,
                Some("Will you walk with me?"),
            ),
            journal_test_event(2, RATI_ACTOR_ID, "Rati", 1, "Cottage", Some(2), None),
            journal_test_event(
                3,
                2002,
                "Mara",
                2,
                "Rain Path",
                None,
                Some("The long way has the better view."),
            ),
            journal_test_event(4, RATI_ACTOR_ID, "Rati", 2, "Rain Path", Some(3), None),
            journal_test_event(
                5,
                2003,
                "Pip",
                2,
                "Rain Path",
                None,
                Some("This happened after Rati had already left."),
            ),
            journal_test_event(
                6,
                2004,
                "Sol",
                3,
                "Lantern Hill",
                None,
                Some("I hoped you would make it before dark."),
            ),
        ];
        let observed = daily_journal_observed_events(&events, RATI_ACTOR_ID, 3, 0, u64::MAX);
        assert_eq!(
            observed.iter().map(|event| event.seq).collect::<Vec<_>>(),
            vec![1, 2, 3, 4, 6]
        );

        let runtime = RuntimeWorld::seeded();
        let chats = daily_journal_chat_excerpts(&runtime, &observed);
        assert_eq!(
            chats
                .iter()
                .map(|chat| (chat.location_id, chat.text.as_str()))
                .collect::<Vec<_>>(),
            vec![
                (1, "Will you walk with me?"),
                (2, "The long way has the better view."),
                (3, "I hoped you would make it before dark."),
            ]
        );
    }

    #[test]
    fn exact_chat_stays_out_of_external_journal_prompt_evidence() {
        let page = DailyJournalPageState {
            day_index: 20_600,
            artifact_id: daily_journal_artifact_id(5000, 20_600),
            actor_id: 5000,
            avatar_name: "Moss".to_string(),
            location_id: 4,
            location_name: "The Cosy Cottage".to_string(),
            requested_event_seq: 20,
            source_event_seqs: vec![10, 12],
            hidden_updates: vec![
                DailyJournalHiddenUpdate {
                    source_event_seqs: vec![10],
                    kind: "conversation".to_string(),
                    text: "Fern said a private sentence.".to_string(),
                },
                DailyJournalHiddenUpdate {
                    source_event_seqs: vec![12],
                    kind: "relationship".to_string(),
                    text: "My bond with Fern is becoming steadier.".to_string(),
                },
            ],
            chat_excerpts: vec![DailyJournalChatExcerpt {
                source_event_seq: 10,
                speaker_actor_id: 6000,
                speaker_name: "Fern".to_string(),
                location_id: 4,
                location_name: "The Cosy Cottage".to_string(),
                text: "a private sentence".to_string(),
            }],
            status: "pending".to_string(),
            entry: String::new(),
            image_content_type: String::new(),
            image_digest: String::new(),
            style_revision: DAILY_JOURNAL_STYLE_REVISION.to_string(),
            prompt_version: DAILY_JOURNAL_PROMPT_VERSION.to_string(),
        };
        let evidence = daily_journal_ai_evidence(&page);
        assert!(!evidence.contains("private sentence"));
        assert!(evidence.contains("bond with Fern"));
    }

    #[test]
    fn fallback_page_is_one_svg_with_first_person_words() {
        let page = DailyJournalPageState {
            day_index: 20_600,
            artifact_id: daily_journal_artifact_id(5000, 20_600),
            actor_id: 5000,
            avatar_name: "Moss".to_string(),
            location_id: 4,
            location_name: "The Cosy Cottage".to_string(),
            requested_event_seq: 20,
            source_event_seqs: vec![10, 12],
            hidden_updates: Vec::new(),
            chat_excerpts: Vec::new(),
            status: "ready".to_string(),
            entry: "I followed the warm path home, and I kept the sound of rain with me."
                .to_string(),
            image_content_type: String::new(),
            image_digest: String::new(),
            style_revision: DAILY_JOURNAL_STYLE_REVISION.to_string(),
            prompt_version: DAILY_JOURNAL_PROMPT_VERSION.to_string(),
        };
        let svg = daily_journal_svg(&page);
        assert!(svg.starts_with("<svg"));
        assert!(svg.contains("Moss's journal"));
        assert!(svg.contains("I followed the warm path home"));
        assert!(!svg.contains("source_event"));
    }

    #[test]
    fn fallback_journal_remembers_people_and_purpose_before_place() {
        let page = DailyJournalPageState {
            day_index: 20_600,
            artifact_id: daily_journal_artifact_id(5000, 20_600),
            actor_id: 5000,
            avatar_name: "Moss".to_string(),
            location_id: 4,
            location_name: "The Cosy Cottage".to_string(),
            requested_event_seq: 20,
            source_event_seqs: vec![10, 12],
            hidden_updates: vec![
                DailyJournalHiddenUpdate {
                    source_event_seqs: vec![10],
                    kind: "conversation".to_string(),
                    text: "I spoke with Fern at Lantern Hill.".to_string(),
                },
                DailyJournalHiddenUpdate {
                    source_event_seqs: Vec::new(),
                    kind: "calling".to_string(),
                    text: "My calling: help strangers find a welcome.".to_string(),
                },
                DailyJournalHiddenUpdate {
                    source_event_seqs: vec![12],
                    kind: "dream".to_string(),
                    text: "A table with one chair left open for a new friend.".to_string(),
                },
            ],
            chat_excerpts: Vec::new(),
            status: "pending".to_string(),
            entry: String::new(),
            image_content_type: String::new(),
            image_digest: String::new(),
            style_revision: DAILY_JOURNAL_STYLE_REVISION.to_string(),
            prompt_version: DAILY_JOURNAL_PROMPT_VERSION.to_string(),
        };
        let entry = fallback_daily_journal_entry(&page);
        assert!(entry.find("Fern").unwrap() < entry.find("The Cosy Cottage").unwrap());
        assert!(entry.contains("calling"));
        assert!(entry.contains("dream"));
        assert!(!entry.contains("Then I remembered"));
    }

    #[test]
    fn short_rests_stay_hidden_and_long_rests_create_at_most_one_page_per_day() {
        let mut runtime = RuntimeWorld::seeded();
        let update = |day_index, rest_kind: &str, seq, text: &str| DailyJournalRestUpdate {
            day_index,
            rest_kind: rest_kind.to_string(),
            observed_through_seq: seq,
            actor_id: 5000,
            avatar_name: "Moss".to_string(),
            location_id: 4,
            location_name: "The Cosy Cottage".to_string(),
            updates: vec![DailyJournalHiddenUpdate {
                source_event_seqs: vec![seq],
                kind: "moment".to_string(),
                text: text.to_string(),
            }],
            chat_excerpts: vec![DailyJournalChatExcerpt {
                source_event_seq: seq,
                speaker_actor_id: 6000,
                speaker_name: "Fern".to_string(),
                location_id: 4,
                location_name: "The Cosy Cottage".to_string(),
                text: text.to_string(),
            }],
        };

        runtime.apply_daily_journal_rest_update(&update(20_600, "short", 10, "Found rain."));
        let journal = &runtime.daily_journals[&5000];
        assert_eq!(journal.hidden_updates.len(), 1);
        assert!(journal.pages.is_empty());

        runtime.apply_daily_journal_rest_update(&update(20_600, "long", 12, "Came home."));
        assert_eq!(runtime.daily_journals[&5000].pages.len(), 1);
        assert!(runtime.daily_journals[&5000].hidden_updates.is_empty());
        assert_eq!(
            runtime.daily_journals[&5000].pages[&20_600]
                .chat_excerpts
                .iter()
                .map(|excerpt| excerpt.source_event_seq)
                .collect::<Vec<_>>(),
            vec![10, 12]
        );

        runtime.apply_daily_journal_rest_update(&update(20_600, "short", 14, "Listened."));
        runtime.apply_daily_journal_rest_update(&update(20_600, "long", 16, "Rested again."));
        assert_eq!(runtime.daily_journals[&5000].pages.len(), 1);
        assert_eq!(runtime.daily_journals[&5000].hidden_updates.len(), 2);

        runtime.apply_daily_journal_rest_update(&update(20_601, "long", 18, "Morning came."));
        assert_eq!(runtime.daily_journals[&5000].pages.len(), 2);
        assert!(runtime.daily_journals[&5000].hidden_updates.is_empty());
    }

    #[test]
    fn daily_pages_and_hidden_updates_survive_snapshot_round_trip() {
        let mut runtime = RuntimeWorld::seeded();
        runtime.apply_daily_journal_rest_update(&DailyJournalRestUpdate {
            day_index: 20_600,
            rest_kind: "long".to_string(),
            observed_through_seq: 44,
            actor_id: 5000,
            avatar_name: "Moss".to_string(),
            location_id: 4,
            location_name: "The Cosy Cottage".to_string(),
            updates: vec![DailyJournalHiddenUpdate {
                source_event_seqs: vec![41, 43],
                kind: "journey".to_string(),
                text: "Moss followed the rain-bright path home.".to_string(),
            }],
            chat_excerpts: vec![DailyJournalChatExcerpt {
                source_event_seq: 42,
                speaker_actor_id: 6000,
                speaker_name: "Fern".to_string(),
                location_id: 4,
                location_name: "The Cosy Cottage".to_string(),
                text: "Come in before the rain gets heavier.".to_string(),
            }],
        });
        let artifact_id = runtime.daily_journals[&5000].pages[&20_600]
            .artifact_id
            .clone();
        runtime.apply_daily_journal_publication(
            5000,
            &DailyJournalPagePublication {
                day_index: 20_600,
                artifact_id,
                entry: "I followed the rain-bright path home, and I listened until the cottage sounded quiet enough for sleep. I want to remember how small the road felt beneath the weather."
                    .to_string(),
                image_content_type: String::new(),
                image_digest: String::new(),
            },
        );
        runtime.apply_daily_journal_rest_update(&DailyJournalRestUpdate {
            day_index: 20_600,
            rest_kind: "short".to_string(),
            observed_through_seq: 49,
            actor_id: 5000,
            avatar_name: "Moss".to_string(),
            location_id: 4,
            location_name: "The Cosy Cottage".to_string(),
            updates: vec![DailyJournalHiddenUpdate {
                source_event_seqs: vec![48],
                kind: "moment".to_string(),
                text: "Moss heard rain on the roof.".to_string(),
            }],
            chat_excerpts: vec![DailyJournalChatExcerpt {
                source_event_seq: 48,
                speaker_actor_id: 6000,
                speaker_name: "Fern".to_string(),
                location_id: 4,
                location_name: "The Cosy Cottage".to_string(),
                text: "It sounds gentler from in here.".to_string(),
            }],
        });
        let expected = runtime.daily_journals.clone();
        let restored = RuntimeSnapshot::from_runtime(&runtime)
            .into_runtime()
            .expect("restore daily Journal snapshot");
        assert_eq!(restored.daily_journals, expected);
    }
}
