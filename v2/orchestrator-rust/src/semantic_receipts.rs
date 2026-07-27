use super::*;
use std::ops::RangeInclusive;

pub(crate) const STORY_RECEIPT_EVENT_TYPE: &str = "story.receipt";
const LANTERN_JOB_ID: &str = "lantern-keeper:rekindle-the-beacon";
const LANTERN_PROGRESS_CLOCK_ID: &str = "lantern-keeper.light";
const LANTERN_DANGER_CLOCK_ID: &str = "lantern-keeper.darkness";
const LANTERN_LOCATION_IDS: RangeInclusive<u64> = 800..=804;

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub(crate) struct SemanticStoryReceipt {
    pub(crate) schema_version: u8,
    pub(crate) narration_key: String,
    pub(crate) text: String,
    #[serde(default)]
    pub(crate) memory_text: String,
    pub(crate) event_seqs: Vec<u64>,
    pub(crate) next_response: String,
}

pub(crate) fn semantic_story_receipt(event: &EventView) -> Option<SemanticStoryReceipt> {
    (event.type_name == STORY_RECEIPT_EVENT_TYPE)
        .then_some(event.content.as_deref())
        .flatten()
        .and_then(|content| serde_json::from_str(content).ok())
}

pub(crate) fn semantic_story_memory_text(event: &EventView) -> Option<String> {
    let receipt = semantic_story_receipt(event)?;
    Some(if receipt.memory_text.is_empty() {
        receipt.text
    } else {
        receipt.memory_text
    })
}

pub(crate) fn semantic_receipt_covered_event_seqs(events: &[EventView]) -> BTreeSet<u64> {
    events
        .iter()
        .filter_map(semantic_story_receipt)
        .flat_map(|receipt| receipt.event_seqs)
        .collect()
}

pub(crate) fn semantic_story_events(events: &[EventView]) -> Vec<&EventView> {
    let covered = semantic_receipt_covered_event_seqs(events);
    events
        .iter()
        .filter(|event| !covered.contains(&event.seq))
        .collect()
}

fn sentence(value: &str) -> String {
    let text = value.trim();
    if text.is_empty() || text.ends_with(['.', '!', '?']) {
        text.to_string()
    } else {
        format!("{text}.")
    }
}

fn strip_use_reason(content: &str) -> &str {
    content.strip_suffix(":use_feature").unwrap_or(content)
}

fn search_truth(event: &EventView) -> String {
    let content = event.content.as_deref().unwrap_or_default().trim();
    content
        .split_once(": ")
        .map(|(_, truth)| truth)
        .unwrap_or(content)
        .trim()
        .to_string()
}

fn feature_name(event: &EventView) -> &str {
    event
        .content
        .as_deref()
        .and_then(|content| content.split_once(": ").map(|(feature, _)| feature.trim()))
        .filter(|feature| !feature.is_empty())
        .unwrap_or("the room")
}

fn next_at(location_id: u64) -> &'static str {
    match location_id {
        800 => "follow the road north to Mothwood Path.",
        801 => "carry the keeper's trail to Saint Orra's Ruin.",
        802 => "take Rowan's warning onward to the Flooded Barrow.",
        803 => "cross the dry causeway toward Lantern Tower.",
        804 => "kindle the great lens when every piece is in place.",
        _ => "answer the next sign on the road.",
    }
}

fn next_after_arrival(location_id: u64) -> &'static str {
    match location_id {
        800 => "search the Failing Lantern.",
        801 => "search the Cold Lamp Post.",
        802 => "examine the Stone Lantern.",
        803 => "test the Golden Oil Slick and face what guards the causeway.",
        804 => "fit the road's evidence into the Great Lantern Lens.",
        _ => "look for the road's next sign.",
    }
}

fn lantern_location_for(events: &[EventView], actor_id: u64) -> Option<u64> {
    events
        .iter()
        .rev()
        .filter(|event| event.actor_id == Some(actor_id))
        .find_map(|event| event.destination_location_id.or(event.location_id))
        .filter(|location_id| LANTERN_LOCATION_IDS.contains(location_id))
}

fn receipt_event_seqs(events: &[EventView], actor_id: u64) -> Vec<u64> {
    events
        .iter()
        .filter(|event| {
            event.seq > 0
                && event.type_name != STORY_RECEIPT_EVENT_TYPE
                && event.actor_id == Some(actor_id)
                && !event.type_name.starts_with("world.")
                && event.type_name != "message.created"
        })
        .map(|event| event.seq)
        .collect()
}

fn clock_progress(events: &[EventView], clock_id: &str) -> Option<(u8, u8)> {
    events
        .iter()
        .rev()
        .find(|event| {
            event.type_name == "clock.updated" && event.clock_id.as_deref() == Some(clock_id)
        })
        .and_then(|event| event.clock_filled.zip(event.clock_segments))
}

fn lantern_terminal_fill(events: &[EventView], actor_id: u64) -> Option<(&str, u8, u8)> {
    [
        (LANTERN_PROGRESS_CLOCK_ID, "completed"),
        (LANTERN_DANGER_CLOCK_ID, "failed"),
    ]
    .into_iter()
    .find_map(|(clock_id, status)| {
        let clock_event = events.iter().find(|event| {
            event.actor_id == Some(actor_id)
                && event.type_name == "clock.updated"
                && event.clock_id.as_deref() == Some(clock_id)
                && event
                    .clock_filled
                    .zip(event.clock_segments)
                    .is_some_and(|(filled, segments)| filled >= segments)
        })?;
        let (filled, segments) = clock_event.clock_filled.zip(clock_event.clock_segments)?;
        if !events.iter().any(|event| {
            event.actor_id == Some(actor_id)
                && event.type_name == "job.updated"
                && event.caused_by_event_seq == Some(clock_event.seq)
                && event.content.as_deref().is_some_and(|content| {
                    job_id_from_event_content(content)
                        .is_some_and(|job_id| job_id == LANTERN_JOB_ID)
                        && job_status_from_event_content(content) == Some(status)
                })
        }) {
            return None;
        }
        Some((clock_id, filled, segments))
    })
}

fn contribution_receipt(
    actor: &str,
    trace: &JobContributionTrace,
    events: &[EventView],
) -> (String, String) {
    let progress = clock_progress(events, LANTERN_PROGRESS_CLOCK_ID);
    let completed = progress.is_some_and(|(filled, segments)| filled >= segments)
        || events.iter().any(|event| {
            event.type_name == "job.updated"
                && event
                    .content
                    .as_deref()
                    .is_some_and(|content| content.contains(":completed:"))
        });
    let result = if trace.outcome == "failure" {
        "The attempt falls short, but the careful groundwork still counts."
    } else {
        "The careful attempt succeeds."
    };
    let progress_text = progress
        .map(|(filled, segments)| format!(" Progress: {filled}/{segments}."))
        .unwrap_or_default();
    let cost = if events.iter().any(|event| {
        event.type_name == "tag.cleared" && event.tag_label.as_deref() == Some("prepared")
    }) {
        " Their preparation pays off."
    } else if events.iter().any(|event| {
        event.type_name == "tag.applied" && event.tag_label.as_deref() == Some("tired")
    }) {
        " The effort leaves them tired."
    } else {
        ""
    };
    if completed {
        let next = "carry the relit road's news back to Mara Wick.".to_string();
        return (
            format!(
                "{actor} rekindles the dark Mothwood beacon. The beacon burns again and makes the Mothwood road trustworthy after dusk.{progress_text} The road remembers {actor}'s work.{cost} {actor} earns 2 Orbs. Next: {next}"
            ),
            next,
        );
    }
    let next = "prepare or continue tending the beacon.".to_string();
    (
        format!(
            "{actor} works to {} at {}. {result}{progress_text} The road remembers {actor}'s contribution.{cost} Next: {next}",
            trace.strategy_label.to_lowercase(),
            trace.target.label
        ),
        next,
    )
}

fn build_lantern_story_receipt(
    record: &JournalRecord,
    events: &[EventView],
) -> Option<SemanticStoryReceipt> {
    let actor_id = record.action.actor_id;
    let location_id = lantern_location_for(events, actor_id)?;
    let actor = events
        .iter()
        .find(|event| event.actor_id == Some(actor_id))
        .and_then(|event| event.actor_name.as_deref())
        .unwrap_or("A traveler");
    let kind = record.offer_kind.as_deref().unwrap_or_default();
    let (narration_key, text, next_response): (String, String, String) = if let Some(event) =
        events.iter().find(|event| {
            event.actor_id == Some(actor_id)
                && matches!(
                    event.type_name.as_str(),
                    "feature.searched" | "location.searched"
                )
        }) {
        let truth = sentence(&search_truth(event));
        let next = next_at(location_id).to_string();
        (
            "lantern-keeper.search".to_string(),
            format!(
                "{actor} searches {}. {truth} Next: {next}",
                feature_name(event)
            ),
            next,
        )
    } else if let Some(event) = events
        .iter()
        .find(|event| event.actor_id == Some(actor_id) && event.type_name == "actor.moved")
    {
        let destination_id = event.destination_location_id.unwrap_or(location_id);
        let next = next_after_arrival(destination_id).to_string();
        (
            "lantern-keeper.travel".to_string(),
            format!(
                "{actor} leaves {} and arrives at {}. Next: {next}",
                event.location_name.as_deref().unwrap_or("the last shelter"),
                event
                    .destination_location_name
                    .as_deref()
                    .unwrap_or("the next lamp")
            ),
            next,
        )
    } else if let Some(event) = events.iter().find(|event| {
        event.actor_id == Some(actor_id)
            && event.type_name == "job.contribution.resolved"
            && event
                .content
                .as_deref()
                .and_then(|content| serde_json::from_str::<JobContributionTrace>(content).ok())
                .is_some_and(|trace| trace.job_id == LANTERN_JOB_ID)
    }) {
        let trace = event
            .content
            .as_deref()
            .and_then(|content| serde_json::from_str::<JobContributionTrace>(content).ok())?;
        let (text, next) = contribution_receipt(actor, &trace, events);
        (trace.narration_key, text, next)
    } else if let Some((clock_id, filled, segments)) = lantern_terminal_fill(events, actor_id) {
        if clock_id == LANTERN_PROGRESS_CLOCK_ID {
            let next = "carry the relit road's news back to Mara Wick.".to_string();
            (
                "lantern-keeper.light-filled".to_string(),
                format!(
                    "{actor} rekindles the dark Mothwood beacon. The beacon burns again and makes the Mothwood road trustworthy after dusk. Progress reaches {filled}/{segments}, and the Lantern Keeper question is complete. Next: {next}"
                ),
                next,
            )
        } else {
            let next = "carry a warning about the dark road back to Mara Wick.".to_string();
            (
                "lantern-keeper.darkness-filled".to_string(),
                format!(
                    "{actor} sees the Mothwood road go fully dark. The borrowed shadows learn every traveler's shape. Danger reaches {filled}/{segments}, and the Lantern Keeper question fails. Next: {next}"
                ),
                next,
            )
        }
    } else if kind == "prepare"
        && events.iter().any(|event| {
            event.actor_id == Some(actor_id)
                && event.type_name == "tag.applied"
                && event.tag_label.as_deref() == Some("prepared")
        })
    {
        let next = "make the prepared contribution count.".to_string();
        (
            "lantern-keeper.prepare".to_string(),
            format!(
                "{actor} sets the road's tools and evidence within reach at {}. The next contribution can use that preparation. Next: {next}",
                events
                    .iter()
                    .find_map(|event| event.location_name.as_deref())
                    .unwrap_or("the tower")
            ),
            next,
        )
    } else if kind == "rest" {
        let danger = clock_progress(events, LANTERN_DANGER_CLOCK_ID)
            .map(|(filled, segments)| {
                format!(" The Road Goes Fully Dark advances to {filled}/{segments}.")
            })
            .unwrap_or_default();
        let next = "prepare or continue toward the beacon.".to_string();
        (
            "lantern-keeper.rest".to_string(),
            format!(
                "{actor} catches their breath at {} and clears their tiredness.{danger} Next: {next}",
                events
                    .iter()
                    .find_map(|event| event.location_name.as_deref())
                    .unwrap_or("shelter")
            ),
            next,
        )
    } else if let Some(event) = events.iter().find(|event| {
        event.actor_id == Some(actor_id) && event.type_name == "item.used" && event.success
    }) {
        let effect = sentence(
            event
                .content
                .as_deref()
                .map(strip_use_reason)
                .unwrap_or_default(),
        );
        let next = next_at(location_id).to_string();
        (
            "lantern-keeper.item-use".to_string(),
            format!(
                "{actor} uses {}. {effect} Next: {next}",
                event.item_name.as_deref().unwrap_or("the road's evidence")
            ),
            next,
        )
    } else if matches!(kind, "attack" | "defend" | "pass" | "need_time" | "flee")
        || events
            .iter()
            .any(|event| event.type_name.starts_with("combat."))
    {
        let event = events.iter().rev().find(|event| {
            event.actor_id == Some(actor_id)
                && matches!(
                    event.type_name.as_str(),
                    "combat.encounter.resolved" | "combat.attack.attempt" | "combat.defend"
                )
        })?;
        let target = event
            .target_actor_name
            .as_deref()
            .unwrap_or("the Moth-Eaten Knight");
        let check = event.total.zip(event.dc).map(|(total, dc)| {
            format!(
                "The check {} ({total} against {dc}).",
                if event.success {
                    "succeeds"
                } else {
                    "falls short"
                }
            )
        });
        let consequence = event
            .content
            .as_deref()
            .filter(|content| !content.trim().is_empty())
            .map(sentence)
            .unwrap_or_else(|| {
                if event.success {
                    format!("{target} gives ground.")
                } else {
                    format!("{target} holds the causeway.")
                }
            });
        let next = if event.type_name == "combat.encounter.resolved" && event.success {
            "climb to Lantern Tower."
        } else {
            "answer the knight's next move."
        }
        .to_string();
        (
            "lantern-keeper.confrontation".to_string(),
            format!(
                "{actor} confronts {target}. {}{consequence} Next: {next}",
                check.map(|check| format!("{check} ")).unwrap_or_default()
            ),
            next,
        )
    } else {
        return None;
    };
    let memory_text =
        if text.contains("The beacon burns again and makes the Mothwood road trustworthy") {
            format!("{actor} rekindled the Mothwood beacon; the road is trustworthy after dusk.")
        } else {
            text.split(" Next:").next().unwrap_or(&text).to_string()
        };
    Some(SemanticStoryReceipt {
        schema_version: 1,
        narration_key,
        text,
        memory_text,
        event_seqs: receipt_event_seqs(events, actor_id),
        next_response,
    })
}

impl RuntimeWorld {
    pub(crate) fn append_lantern_story_receipt(
        &mut self,
        record: &JournalRecord,
        events: &mut Vec<EventView>,
    ) {
        let Some(receipt) = build_lantern_story_receipt(record, events) else {
            return;
        };
        let cause = receipt.event_seqs.first().copied();
        let Ok(content) = serde_json::to_string(&receipt) else {
            return;
        };
        let mut event = self.append_async_job_event(
            STORY_RECEIPT_EVENT_TYPE,
            record.action.actor_id,
            None,
            Some(content),
        );
        if let Some(movement) = events.iter().find(|event| {
            event.actor_id == Some(record.action.actor_id) && event.type_name == "actor.moved"
        }) {
            event.location_id = movement.location_id;
            event.location_name.clone_from(&movement.location_name);
            event.destination_location_id = movement.destination_location_id;
            event
                .destination_location_name
                .clone_from(&movement.destination_location_name);
        }
        event.caused_by_event_seq = cause;
        self.replace_projected_event(&event);
        events.push(event);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn event(seq: u64, type_name: &str) -> EventView {
        EventView {
            seq,
            type_name: type_name.to_string(),
            success: true,
            actor_id: Some(42),
            actor_name: Some("Kit Featherstep".to_string()),
            location_id: Some(804),
            location_name: Some("Lantern Tower".to_string()),
            ..EventView::default()
        }
    }

    fn record(kind: &str) -> JournalRecord {
        let mut record = JournalRecord::new(
            CwAction {
                actor_id: 42,
                ..CwAction::default()
            },
            1,
        );
        record.bind_offer_kind(kind);
        record
    }

    fn receipt(kind: &str, events: &[EventView]) -> SemanticStoryReceipt {
        build_lantern_story_receipt(&record(kind), events).expect("Lantern action receipt")
    }

    #[test]
    fn lantern_terminal_receipt_requires_the_terminal_fills_causal_job_update() {
        let mut progress = event(1, "clock.updated");
        progress.clock_id = Some(LANTERN_PROGRESS_CLOCK_ID.to_string());
        progress.clock_filled = Some(5);
        progress.clock_segments = Some(6);

        let mut terminal = event(2, "clock.updated");
        terminal.clock_id = Some(LANTERN_PROGRESS_CLOCK_ID.to_string());
        terminal.clock_filled = Some(6);
        terminal.clock_segments = Some(6);
        let terminal_seq = terminal.seq;

        let mut consequence = event(3, "job.updated");
        consequence.content = Some(format!(
            "{LANTERN_JOB_ID}:completed:lantern_keeper_completed"
        ));
        consequence.caused_by_event_seq = Some(progress.seq);

        let mut events = vec![progress, terminal, consequence];
        assert_eq!(lantern_terminal_fill(&events, 42), None);
        assert!(build_lantern_story_receipt(&record("advance_clock"), &events).is_none());

        events[2].caused_by_event_seq = Some(terminal_seq);
        assert_eq!(
            lantern_terminal_fill(&events, 42),
            Some((LANTERN_PROGRESS_CLOCK_ID, 6, 6))
        );
        assert_eq!(
            build_lantern_story_receipt(&record("advance_clock"), &events)
                .expect("causal terminal fill produces a receipt")
                .narration_key,
            "lantern-keeper.light-filled"
        );
    }

    #[test]
    fn lantern_keeper_action_receipts_are_authored_golden_story_beats() {
        let mut search = event(1, "feature.searched");
        search.location_id = Some(800);
        search.location_name = Some("Wayside Lantern Inn".to_string());
        search.content = Some("Failing Lantern: Rowan's keeper badge hangs inside the cage beside a soot-written note: gone north; bring lens, key, and oil.".to_string());

        let mut travel = event(2, "actor.moved");
        travel.location_id = Some(800);
        travel.location_name = Some("Wayside Lantern Inn".to_string());
        travel.destination_location_id = Some(801);
        travel.destination_location_name = Some("Mothwood Path".to_string());

        let mut prepare = event(3, "tag.applied");
        prepare.tag_label = Some("prepared".to_string());

        let mut item_use = event(4, "item.used");
        item_use.location_id = Some(801);
        item_use.item_name = Some("Mothglass Lens".to_string());
        item_use.content = Some("Through the Mothglass Lens, one set of keeper's footprints shines toward Saint Orra's Ruin.".to_string());

        let mut rest_clear = event(5, "tag.cleared");
        rest_clear.tag_label = Some("tired".to_string());
        let mut danger = event(6, "clock.updated");
        danger.clock_id = Some(LANTERN_DANGER_CLOCK_ID.to_string());
        danger.clock_filled = Some(1);
        danger.clock_segments = Some(6);

        let mut confrontation = event(7, "combat.encounter.resolved");
        confrontation.location_id = Some(803);
        confrontation.target_actor_name = Some("Moth-Eaten Knight".to_string());
        confrontation.content = Some("The Moth-Eaten Knight yields the road.".to_string());

        let trace = JobContributionTrace {
            schema_version: 1,
            job_id: LANTERN_JOB_ID.to_string(),
            strategy_id: "rekindle-beacon".to_string(),
            strategy_label: "Rekindle the beacon".to_string(),
            narration_key: "lantern-keeper.work".to_string(),
            action_kind: "work".to_string(),
            rules_action: None,
            operation: None,
            target: ResolvedContributionTarget {
                kind: "job".to_string(),
                id: LANTERN_JOB_ID.to_string(),
                label: "the dark Mothwood beacon".to_string(),
            },
            resolution: "certain".to_string(),
            outcome: "success".to_string(),
            baseline_progress: 6,
            success_progress: 0,
            prepared_bonus_progress: 0,
            project_push_prepared: false,
            project_evidence_count: 0,
            project_location_count: 0,
            total_progress: 6,
            clock_id: LANTERN_PROGRESS_CLOCK_ID.to_string(),
            claim_key: None,
            requirement_source_event_seqs: Vec::new(),
            source_event_seqs: Vec::new(),
            rules_profile: "cosyworld.srd5/1".to_string(),
            rules_pack_id: "cosyworld.rules-profile-srd5".to_string(),
            rules_pack_version: "1.0.0".to_string(),
            pack_id: "cosyworld.campaign.the-lantern-keeper".to_string(),
            pack_version: "0.1.6".to_string(),
        };
        let mut contribution = event(8, "job.contribution.resolved");
        contribution.content = Some(serde_json::to_string(&trace).unwrap());
        let mut progress = event(9, "clock.updated");
        progress.clock_id = Some(LANTERN_PROGRESS_CLOCK_ID.to_string());
        progress.clock_filled = Some(6);
        progress.clock_segments = Some(6);
        let mut spent = event(10, "tag.cleared");
        spent.tag_label = Some("prepared".to_string());

        let receipts = [
            receipt("search", &[search]),
            receipt("move", &[travel]),
            receipt("prepare", &[prepare]),
            receipt("use_feature", &[item_use]),
            receipt("rest", &[rest_clear, danger]),
            receipt("attack", &[confrontation]),
            receipt("work", &[contribution, progress, spent]),
        ];
        let story = receipts
            .iter()
            .map(|receipt| receipt.text.as_str())
            .collect::<Vec<_>>()
            .join("\n");
        assert!(story.contains("Rowan's keeper badge hangs inside the cage"));
        assert!(story.contains("leaves Wayside Lantern Inn and arrives at Mothwood Path"));
        assert!(story.contains("The next contribution can use that preparation"));
        assert!(story.contains("Through the Mothglass Lens"));
        assert!(story.contains("The Road Goes Fully Dark advances to 1/6"));
        assert!(story.contains("The Moth-Eaten Knight yields the road"));
        assert_eq!(
            receipts[5].text,
            "Kit Featherstep confronts Moth-Eaten Knight. The Moth-Eaten Knight yields the road. Next: climb to Lantern Tower."
        );
        assert!(story.contains("The beacon burns again and makes the Mothwood road trustworthy"));
        assert!(story.contains("Progress: 6/6"));
        assert!(story.contains("earns 2 Orbs"));
        assert_eq!(receipts.len(), 7);
        for malformed in [
            "grew from what happened",
            "became frontier travel",
            "became spent preparation",
            "The Road Goes Fully Dark draws closer",
            "shook off spent preparation",
        ] {
            assert!(!story.contains(malformed), "{malformed}");
        }
    }
}
