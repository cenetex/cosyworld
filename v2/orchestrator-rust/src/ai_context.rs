use serde::{Deserialize, Serialize};
use std::collections::BTreeSet;

const DEFAULT_CONTEXT_LIMIT: u32 = 32_768;
const MIN_PROVIDER_RESERVE: u32 = 256;

#[derive(Clone, Copy, Debug, Default, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub(crate) enum EvidenceScope {
    #[serde(rename = "self")]
    SelfActor,
    Relationship,
    Room,
    #[default]
    Location,
    World,
}

#[derive(Clone, Copy, Debug, Default, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub(crate) enum EvidenceVisibility {
    Private,
    Shared,
    #[default]
    Public,
    RevealedAfterEvent,
}

#[derive(Clone, Copy, Debug, Default, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub(crate) enum EvidenceSayability {
    InfluenceOnly,
    #[default]
    Disclosable,
    Sealed,
}

#[derive(Clone, Copy, Debug, Default, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub(crate) enum EvidenceVisuality {
    #[default]
    Visible,
    SubtextOnly,
    NeverRender,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) enum EvidenceModality {
    Conversation,
    Media,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct ScopedKnowledge {
    pub(crate) text: String,
    #[serde(default)]
    pub(crate) scope: EvidenceScope,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) owner_actor_id: Option<u64>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub(crate) shared_actor_ids: Vec<u64>,
    #[serde(default)]
    pub(crate) visibility: EvidenceVisibility,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) reveal_event: Option<String>,
    #[serde(default)]
    pub(crate) sayability: EvidenceSayability,
    #[serde(default)]
    pub(crate) visuality: EvidenceVisuality,
    #[serde(default = "default_salience")]
    pub(crate) salience: u8,
}

fn default_salience() -> u8 {
    50
}

impl ScopedKnowledge {
    pub(crate) fn validate(&self, label: &str) -> Result<(), String> {
        if self.text.trim().is_empty() || self.text.chars().count() > 500 {
            return Err(format!("{label} text must contain 1-500 characters"));
        }
        if self.salience > 100 {
            return Err(format!("{label} salience must be from 0 to 100"));
        }
        match self.visibility {
            EvidenceVisibility::Private if self.owner_actor_id.is_none() => {
                Err(format!("{label} private knowledge needs owner_actor_id"))
            }
            EvidenceVisibility::Shared if self.shared_actor_ids.is_empty() => {
                Err(format!("{label} shared knowledge needs shared_actor_ids"))
            }
            EvidenceVisibility::RevealedAfterEvent
                if self
                    .reveal_event
                    .as_deref()
                    .is_none_or(|event| event.trim().is_empty()) =>
            {
                Err(format!(
                    "{label} revealed_after_event knowledge needs reveal_event"
                ))
            }
            _ => Ok(()),
        }
    }
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub(crate) struct PromptEvidence {
    pub(crate) text: String,
    pub(crate) scope: EvidenceScope,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) owner_actor_id: Option<u64>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub(crate) shared_actor_ids: Vec<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) location_id: Option<u64>,
    pub(crate) visibility: EvidenceVisibility,
    pub(crate) sayability: EvidenceSayability,
    pub(crate) visuality: EvidenceVisuality,
    pub(crate) salience: u8,
    #[serde(default)]
    pub(crate) revealed: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) source_event_seq: Option<u64>,
}

impl PromptEvidence {
    pub(crate) fn public_location(text: impl Into<String>, location_id: u64, salience: u8) -> Self {
        Self {
            text: text.into(),
            scope: EvidenceScope::Location,
            owner_actor_id: None,
            shared_actor_ids: Vec::new(),
            location_id: Some(location_id),
            visibility: EvidenceVisibility::Public,
            sayability: EvidenceSayability::Disclosable,
            visuality: EvidenceVisuality::Visible,
            salience,
            revealed: true,
            source_event_seq: None,
        }
    }

    fn from_scoped_knowledge(
        knowledge: &ScopedKnowledge,
        location_id: u64,
        revealed: bool,
    ) -> Self {
        Self {
            text: crate::compact_whitespace(&knowledge.text),
            scope: knowledge.scope,
            owner_actor_id: knowledge.owner_actor_id,
            shared_actor_ids: knowledge.shared_actor_ids.clone(),
            location_id: Some(location_id),
            visibility: knowledge.visibility,
            sayability: knowledge.sayability,
            visuality: knowledge.visuality,
            salience: knowledge.salience,
            revealed,
            source_event_seq: None,
        }
    }

    pub(crate) fn authorized_for(
        &self,
        audience: &EvidenceAudience,
        modality: EvidenceModality,
    ) -> bool {
        if self.text.trim().is_empty() || self.sayability == EvidenceSayability::Sealed {
            return false;
        }
        if modality == EvidenceModality::Media && self.visuality == EvidenceVisuality::NeverRender {
            return false;
        }
        if self
            .location_id
            .is_some_and(|location_id| audience.location_id != Some(location_id))
        {
            return false;
        }
        let actor_id = audience.actor_id;
        let visible = match self.visibility {
            EvidenceVisibility::Private => actor_id.is_some() && actor_id == self.owner_actor_id,
            EvidenceVisibility::Shared => {
                actor_id.is_some_and(|actor_id| self.shared_actor_ids.contains(&actor_id))
            }
            EvidenceVisibility::Public => true,
            EvidenceVisibility::RevealedAfterEvent => self.revealed,
        };
        if !visible {
            return false;
        }
        match self.scope {
            EvidenceScope::SelfActor => {
                self.owner_actor_id.is_none() || actor_id == self.owner_actor_id
            }
            EvidenceScope::Relationship => actor_id.is_some_and(|actor_id| {
                self.shared_actor_ids.contains(&actor_id)
                    && audience.relationship_actor_id.is_some_and(|other| {
                        self.shared_actor_ids.contains(&other) && other != actor_id
                    })
            }),
            EvidenceScope::Room | EvidenceScope::Location => audience.location_id.is_some(),
            EvidenceScope::World => true,
        }
    }
}

#[derive(Clone, Copy, Debug, Default)]
pub(crate) struct EvidenceAudience {
    pub(crate) actor_id: Option<u64>,
    pub(crate) relationship_actor_id: Option<u64>,
    pub(crate) location_id: Option<u64>,
}

impl EvidenceAudience {
    pub(crate) fn conversation(
        actor_id: u64,
        relationship_actor_id: Option<u64>,
        location_id: u64,
    ) -> Self {
        Self {
            actor_id: Some(actor_id),
            relationship_actor_id,
            location_id: Some(location_id),
        }
    }

    pub(crate) fn media(actor_id: Option<u64>, location_id: u64) -> Self {
        Self {
            actor_id,
            relationship_actor_id: None,
            location_id: Some(location_id),
        }
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) enum PromptSegmentKind {
    SharedPolicy,
    UniqueEvidence,
    Envelope,
}

#[derive(Clone, Debug)]
struct PromptSegment {
    text: String,
    kind: PromptSegmentKind,
    priority: u8,
    pinned: bool,
}

#[derive(Clone, Debug, Default)]
pub(crate) struct PromptEnvelope {
    system: Vec<PromptSegment>,
    user: Vec<PromptSegment>,
}

#[derive(Clone, Debug, Default, Deserialize, Eq, PartialEq, Serialize)]
pub(crate) struct PromptBudgetTelemetry {
    pub(crate) context_limit: u32,
    pub(crate) input_budget_tokens: u32,
    pub(crate) estimated_prompt_tokens: u32,
    pub(crate) unique_evidence_tokens: u32,
    pub(crate) shared_policy_tokens: u32,
    pub(crate) envelope_tokens: u32,
    pub(crate) duplicate_tokens: u32,
    pub(crate) dropped_segments: u32,
    pub(crate) overflowed: bool,
}

#[derive(Clone, Debug)]
pub(crate) struct RenderedPrompt {
    pub(crate) system: String,
    pub(crate) user: String,
    pub(crate) telemetry: PromptBudgetTelemetry,
}

impl PromptEnvelope {
    pub(crate) fn system(mut self, text: impl Into<String>) -> Self {
        self.system.push(PromptSegment {
            text: text.into(),
            kind: PromptSegmentKind::SharedPolicy,
            priority: u8::MAX,
            pinned: true,
        });
        self
    }

    pub(crate) fn system_context(mut self, text: impl Into<String>) -> Self {
        self.system.push(PromptSegment {
            text: text.into(),
            kind: PromptSegmentKind::UniqueEvidence,
            priority: u8::MAX,
            pinned: true,
        });
        self
    }

    pub(crate) fn user(
        mut self,
        text: impl Into<String>,
        kind: PromptSegmentKind,
        priority: u8,
        pinned: bool,
    ) -> Self {
        let text = text.into();
        if !text.trim().is_empty() {
            self.user.push(PromptSegment {
                text,
                kind,
                priority,
                pinned,
            });
        }
        self
    }

    pub(crate) fn evidence(
        mut self,
        prefix: &str,
        evidence: impl IntoIterator<Item = PromptEvidence>,
        audience: &EvidenceAudience,
        modality: EvidenceModality,
        pinned: bool,
    ) -> Self {
        for item in evidence {
            if item.authorized_for(audience, modality) {
                self.user.push(PromptSegment {
                    text: format!("{prefix}{}", item.text),
                    kind: PromptSegmentKind::UniqueEvidence,
                    priority: item.salience,
                    pinned,
                });
            }
        }
        self
    }

    pub(crate) fn render_for(
        &self,
        context_limit: Option<u32>,
        max_output_tokens: u32,
    ) -> RenderedPrompt {
        let context_limit = context_limit.unwrap_or(DEFAULT_CONTEXT_LIMIT);
        let provider_reserve = (context_limit / 20).max(MIN_PROVIDER_RESERVE);
        let input_budget_tokens = context_limit
            .saturating_sub(max_output_tokens)
            .saturating_sub(provider_reserve)
            .max(1);
        let mut seen = BTreeSet::new();
        let mut duplicate_tokens = 0;
        let mut system = Vec::new();
        for segment in &self.system {
            let text = segment.text.trim();
            if text.is_empty() {
                continue;
            }
            if seen.insert(text.to_string()) {
                system.push(segment.clone());
            } else {
                duplicate_tokens += approximate_tokens(text);
            }
        }
        let mut candidates = Vec::new();
        for (index, segment) in self.user.iter().enumerate() {
            let text = segment.text.trim();
            if text.is_empty() {
                continue;
            }
            if seen.insert(text.to_string()) {
                candidates.push((index, segment.clone()));
            } else {
                duplicate_tokens += approximate_tokens(text);
            }
        }
        let system_tokens = system
            .iter()
            .map(|segment| approximate_tokens(&segment.text))
            .sum::<u32>();
        let mut selected = candidates
            .iter()
            .filter(|(_, segment)| segment.pinned)
            .cloned()
            .collect::<Vec<_>>();
        let mut used = system_tokens
            + selected
                .iter()
                .map(|(_, segment)| approximate_tokens(&segment.text))
                .sum::<u32>();
        let mut optional = candidates
            .iter()
            .filter(|(_, segment)| !segment.pinned)
            .cloned()
            .collect::<Vec<_>>();
        optional.sort_by_key(|(index, segment)| (std::cmp::Reverse(segment.priority), *index));
        let mut dropped_segments = 0;
        for candidate in optional {
            let tokens = approximate_tokens(&candidate.1.text);
            if used.saturating_add(tokens) <= input_budget_tokens {
                used = used.saturating_add(tokens);
                selected.push(candidate);
            } else {
                dropped_segments += 1;
            }
        }
        selected.sort_by_key(|(index, _)| *index);
        let selected_segments = selected
            .iter()
            .map(|(_, segment)| segment)
            .collect::<Vec<_>>();
        let tokens_for = |kind| {
            system
                .iter()
                .chain(selected_segments.iter().copied())
                .filter(|segment| segment.kind == kind)
                .map(|segment| approximate_tokens(&segment.text))
                .sum::<u32>()
        };
        RenderedPrompt {
            system: system
                .iter()
                .map(|segment| segment.text.trim())
                .collect::<Vec<_>>()
                .join("\n"),
            user: selected_segments
                .iter()
                .map(|segment| segment.text.trim())
                .collect::<Vec<_>>()
                .join("\n"),
            telemetry: PromptBudgetTelemetry {
                context_limit,
                input_budget_tokens,
                estimated_prompt_tokens: used,
                unique_evidence_tokens: tokens_for(PromptSegmentKind::UniqueEvidence),
                shared_policy_tokens: tokens_for(PromptSegmentKind::SharedPolicy),
                envelope_tokens: tokens_for(PromptSegmentKind::Envelope),
                duplicate_tokens,
                dropped_segments,
                overflowed: used > input_budget_tokens,
            },
        }
    }

    #[cfg(test)]
    pub(crate) fn render_for_test(&self) -> RenderedPrompt {
        self.render_for(Some(1_000_000), 0)
    }
}

pub(crate) fn approximate_tokens(value: &str) -> u32 {
    ((value.chars().count() as u32).saturating_add(3) / 4).max(1)
}

impl crate::RuntimeWorld {
    pub(crate) fn authored_actor_voice(&self, actor_id: u64) -> String {
        let authored = crate::active_content()
            .actors
            .iter()
            .find(|actor| actor.id == actor_id)
            .map(|actor| actor.voice.trim().to_string())
            .unwrap_or_default();
        if !authored.is_empty() {
            return authored;
        }
        fallback_actor_voice(actor_id)
    }

    pub(crate) fn recent_public_room_evidence(
        &self,
        location_id: u64,
        limit: usize,
    ) -> Vec<PromptEvidence> {
        self.recent_room_consequences(location_id, limit)
            .into_iter()
            .map(|text| PromptEvidence::public_location(text, location_id, 78))
            .collect()
    }

    fn location_knowledge_revealed(&self, location_id: u64, reveal_event: Option<&str>) -> bool {
        let Some(reveal_event) = reveal_event else {
            return false;
        };
        self.event_log.iter().any(|event| {
            event.success
                && event.type_name == reveal_event
                && (event.location_id == Some(location_id)
                    || event.destination_location_id == Some(location_id))
        })
    }

    fn authored_location_evidence(&self, location_id: u64) -> Vec<PromptEvidence> {
        let meta = self.location_meta_for(location_id);
        let mut evidence = meta
            .memory
            .into_iter()
            .filter(|text| !text.trim().is_empty())
            .map(|text| PromptEvidence::public_location(text, location_id, 65))
            .collect::<Vec<_>>();
        if let Some(location) = crate::active_content()
            .locations
            .iter()
            .find(|location| location.id == location_id)
        {
            evidence.extend(location.knowledge.iter().map(|knowledge| {
                PromptEvidence::from_scoped_knowledge(
                    knowledge,
                    location_id,
                    self.location_knowledge_revealed(
                        location_id,
                        knowledge.reveal_event.as_deref(),
                    ),
                )
            }));
        }
        evidence
    }

    pub(crate) fn conversation_location_evidence(
        &self,
        location_id: u64,
        actor_id: u64,
        relationship_actor_id: Option<u64>,
    ) -> Vec<PromptEvidence> {
        let audience = EvidenceAudience::conversation(actor_id, relationship_actor_id, location_id);
        self.authored_location_evidence(location_id)
            .into_iter()
            .filter(|evidence| evidence.authorized_for(&audience, EvidenceModality::Conversation))
            .collect()
    }

    pub(crate) fn media_location_evidence(&self, location_id: u64) -> Vec<PromptEvidence> {
        let audience = EvidenceAudience::media(None, location_id);
        self.authored_location_evidence(location_id)
            .into_iter()
            .filter(|evidence| evidence.authorized_for(&audience, EvidenceModality::Media))
            .collect()
    }
}

pub(crate) fn fallback_actor_voice(actor_id: u64) -> String {
    const FALLBACK_IDIOLECTS: &[&str] = &[
        "my thoughts come in short steps. solid things catch my eye before moods do, and i trust a plain ending more than a maxim.",
        "people arrive as gestures before explanations. i take a little time with a sentence, use metaphor sparingly, and leave disagreement plain.",
        "sound reaches me first. my thoughts stay brief and practical, and a question matters only when its answer will change something.",
        "one exact detail steadies me before any feeling does. verbs carry more weight than adjectives; objects remain objects in my eyes.",
    ];
    FALLBACK_IDIOLECTS[actor_id as usize % FALLBACK_IDIOLECTS.len()].to_string()
}

pub(crate) fn public_room_memory_for_state(
    state: &crate::AppState,
    location_id: u64,
) -> Vec<PromptEvidence> {
    let day_index = crate::current_room_memory_day_index();
    let mut chapters =
        crate::load_room_memory_prior_chapters_for_state(state, location_id, day_index);
    if let Some(current) =
        crate::load_current_room_memory_chapter_for_state(state, location_id, day_index)
    {
        chapters.push(current);
    }
    chapters.sort_by_key(|chapter| (chapter.day_index, chapter.latest_seq));
    let keep_from = chapters.len().saturating_sub(3);
    chapters
        .into_iter()
        .skip(keep_from)
        .filter(|chapter| !chapter.summary.trim().is_empty())
        .map(|chapter| {
            let mut evidence = PromptEvidence::public_location(
                crate::compact_whitespace(&chapter.summary),
                location_id,
                if chapter.day_index == day_index {
                    84
                } else {
                    58
                },
            );
            evidence.source_event_seq = Some(chapter.latest_seq);
            evidence
        })
        .collect()
}

pub(crate) fn room_memory_prompt(
    location: &crate::LocationView,
    prior_chapters: &[crate::RoomMemoryChapter],
    entries: &[crate::RoomMemoryEntryView],
) -> (String, String) {
    let current = if entries.is_empty() {
        "the room has been quiet".to_string()
    } else {
        entries
            .iter()
            .map(|entry| format!("{}: {}", entry.label, entry.text.replace('\n', " ")))
            .collect::<Vec<_>>()
            .join("\n")
    };
    let before = if prior_chapters.is_empty() {
        "nothing older is pressing forward".to_string()
    } else {
        prior_chapters
            .iter()
            .map(|chapter| chapter.summary.clone())
            .collect::<Vec<_>>()
            .join("\n")
    };
    let fixed = if location.memory.is_empty() {
        "nothing fixed".to_string()
    } else {
        location.memory.join(" ")
    };
    (
        "one or two plain sentences of shared room memory · under 65 words · natural prose only · no headings, labels, bullets, colons, semicolons, slashes, dashes, or system vocabulary".to_string(),
        format!(
            "{name} — {title}. {description} {persona}\nthis place keeps: {fixed}\nbefore:\n{before}\ntoday:\n{current}\ntoday—",
            name = location.name,
            title = location.title,
            description = location.description,
            persona = location.persona,
        ),
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    fn evidence(visibility: EvidenceVisibility) -> PromptEvidence {
        PromptEvidence {
            text: "the test fact".to_string(),
            scope: EvidenceScope::SelfActor,
            owner_actor_id: Some(7),
            shared_actor_ids: vec![7, 9],
            location_id: Some(3),
            visibility,
            sayability: EvidenceSayability::Disclosable,
            visuality: EvidenceVisuality::Visible,
            salience: 50,
            revealed: false,
            source_event_seq: None,
        }
    }

    #[test]
    fn authorization_precedes_relevance() {
        let owner = EvidenceAudience::conversation(7, Some(9), 3);
        let stranger = EvidenceAudience::conversation(8, Some(9), 3);
        assert!(evidence(EvidenceVisibility::Private)
            .authorized_for(&owner, EvidenceModality::Conversation));
        assert!(!evidence(EvidenceVisibility::Private)
            .authorized_for(&stranger, EvidenceModality::Conversation));
        let mut sealed = evidence(EvidenceVisibility::Private);
        sealed.sayability = EvidenceSayability::Sealed;
        sealed.salience = 100;
        assert!(!sealed.authorized_for(&owner, EvidenceModality::Conversation));
    }

    #[test]
    fn unrevealed_and_never_render_evidence_stays_out_of_media() {
        let audience = EvidenceAudience::media(None, 3);
        let mut hidden = evidence(EvidenceVisibility::RevealedAfterEvent);
        hidden.scope = EvidenceScope::Location;
        hidden.owner_actor_id = None;
        assert!(!hidden.authorized_for(&audience, EvidenceModality::Media));
        hidden.revealed = true;
        assert!(hidden.authorized_for(&audience, EvidenceModality::Media));
        hidden.visuality = EvidenceVisuality::NeverRender;
        assert!(!hidden.authorized_for(&audience, EvidenceModality::Media));
    }

    #[test]
    fn prompt_budget_pins_fresh_context_and_drops_low_salience_first() {
        let prompt = PromptEnvelope::default()
            .system("only Pip's next line")
            .user(
                "i am Pip, still muddy from the crossing",
                PromptSegmentKind::UniqueEvidence,
                100,
                true,
            )
            .user(
                "old low-value chronology ".repeat(300),
                PromptSegmentKind::UniqueEvidence,
                1,
                false,
            )
            .user(
                "freshest exchange: the lantern just went out",
                PromptSegmentKind::UniqueEvidence,
                100,
                true,
            )
            .user("so—", PromptSegmentKind::Envelope, 100, true);
        let rendered = prompt.render_for(Some(1_024), 64);
        assert!(rendered.user.contains("i am Pip"));
        assert!(rendered.user.contains("the lantern just went out"));
        assert!(!rendered.user.contains("old low-value chronology"));
        assert_eq!(rendered.telemetry.dropped_segments, 1);
        assert!(!rendered.telemetry.overflowed);
    }

    #[test]
    fn unrevealed_location_secret_never_enters_conversation_or_media_context() {
        let mut runtime = crate::RuntimeWorld::seeded();
        let secret = "A brass key was hidden where noon never reaches.";
        let before_conversation =
            runtime.conversation_location_evidence(802, crate::RATI_ACTOR_ID, None);
        let before_media = runtime.media_location_evidence(802);
        assert!(before_conversation
            .iter()
            .any(|evidence| evidence.text.contains("Keepers once swore")));
        assert!(before_conversation
            .iter()
            .all(|evidence| evidence.text != secret));
        assert!(before_media.iter().all(|evidence| evidence.text != secret));

        runtime.event_log.push(crate::EventView {
            seq: 98_001,
            type_name: "lantern_keeper.brass_key_revealed".to_string(),
            success: true,
            location_id: Some(802),
            ..crate::EventView::default()
        });
        assert!(runtime
            .conversation_location_evidence(802, crate::RATI_ACTOR_ID, None)
            .iter()
            .any(|evidence| evidence.text == secret));
        assert!(runtime
            .media_location_evidence(802)
            .iter()
            .any(|evidence| evidence.text == secret));
    }
}
