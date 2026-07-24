use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, BTreeSet};

pub(crate) const DEED_SCHEMA_VERSION: u32 = 1;
pub(crate) const PRACTICE_SCHEMA_VERSION: u32 = 1;
pub(crate) const PRACTICE_WINDOW: usize = 16;
const PRACTICE_MIN_DEEDS: usize = 5;
const PRACTICE_MIN_TARGETS: usize = 3;
const PRACTICE_SWITCH_LEAD: usize = 3;
const COMPOUND_MIN_DEEDS: usize = 3;
const COMPOUND_MAX_GAP: usize = 1;

#[derive(Clone, Copy, Debug, Deserialize, Eq, Ord, PartialEq, PartialOrd, Serialize)]
#[serde(rename_all = "snake_case")]
pub(crate) enum DeedCategory {
    Exploration,
    Craft,
    Delivery,
    Stewardship,
    Care,
    Mediation,
    Lore,
}

impl DeedCategory {
    pub(crate) fn as_str(self) -> &'static str {
        match self {
            Self::Exploration => "exploration",
            Self::Craft => "craft",
            Self::Delivery => "delivery",
            Self::Stewardship => "stewardship",
            Self::Care => "care",
            Self::Mediation => "mediation",
            Self::Lore => "lore",
        }
    }

    fn epithet(self) -> &'static str {
        match self {
            Self::Exploration => "Explorer",
            Self::Craft => "Crafter",
            Self::Delivery => "Courier",
            Self::Stewardship => "Steward",
            Self::Care => "Caregiver",
            Self::Mediation => "Mediator",
            Self::Lore => "Lorekeeper",
        }
    }

    fn known_for(self) -> &'static str {
        match self {
            Self::Exploration => "finding and opening hidden ways",
            Self::Craft => "making durable things",
            Self::Delivery => "carrying real things where they are needed",
            Self::Stewardship => "helping shared places and projects endure",
            Self::Care => "protecting and restoring others",
            Self::Mediation => "helping strained relationships find a way through",
            Self::Lore => "recovering knowledge and leaving it for others",
        }
    }
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub(crate) struct DeedRecord {
    pub schema_version: u32,
    pub id: String,
    pub actor_id: u64,
    #[serde(alias = "actor_kind")]
    pub controller_mode: String,
    pub category: DeedCategory,
    pub source_action: String,
    pub operation: String,
    pub rules_profile: String,
    pub contributing_pack_id: String,
    pub source_event_seqs: Vec<u64>,
    pub target_kind: String,
    pub target_id: String,
    pub location_id: Option<u64>,
    pub durable_public_trace: bool,
    pub claim_key: String,
}

impl DeedRecord {
    pub(crate) fn latest_source_seq(&self) -> u64 {
        self.source_event_seqs.iter().copied().max().unwrap_or(0)
    }

    fn target_key(&self) -> String {
        format!("{}:{}", self.target_kind, self.target_id)
    }
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub(crate) struct ActorPracticeState {
    #[serde(default = "practice_schema_version")]
    pub schema_version: u32,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub primary: Option<DeedCategory>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub secondary: Option<DeedCategory>,
    #[serde(default)]
    pub updated_event_seq: u64,
}

fn practice_schema_version() -> u32 {
    PRACTICE_SCHEMA_VERSION
}

impl Default for ActorPracticeState {
    fn default() -> Self {
        Self {
            schema_version: PRACTICE_SCHEMA_VERSION,
            primary: None,
            secondary: None,
            updated_event_seq: 0,
        }
    }
}

#[derive(Clone, Debug, Serialize)]
pub(crate) struct ActorPracticeView {
    pub schema_version: u32,
    pub actor_id: u64,
    pub epithet: String,
    pub known_for: String,
    pub primary: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub secondary: Option<String>,
    pub evidence: Vec<PracticeEvidenceView>,
}

#[derive(Clone, Debug, Serialize)]
pub(crate) struct PracticeEvidenceView {
    pub category: String,
    pub description: String,
    pub source_event_seqs: Vec<u64>,
    pub target_kind: String,
    pub target_id: String,
    pub location_id: Option<u64>,
}

pub(crate) fn project_practice(
    current: &ActorPracticeState,
    deeds: &[&DeedRecord],
) -> ActorPracticeState {
    let mut recent = deeds
        .iter()
        .copied()
        .filter(|deed| deed.durable_public_trace)
        .collect::<Vec<_>>();
    recent.sort_by_key(|deed| (deed.latest_source_seq(), deed.id.as_str()));
    if recent.len() > PRACTICE_WINDOW {
        recent.drain(0..recent.len() - PRACTICE_WINDOW);
    }
    let distinct_targets = recent
        .iter()
        .map(|deed| deed.target_key())
        .collect::<BTreeSet<_>>();
    if recent.len() < PRACTICE_MIN_DEEDS || distinct_targets.len() < PRACTICE_MIN_TARGETS {
        return current.clone();
    }

    let mut counts = BTreeMap::<DeedCategory, usize>::new();
    for deed in &recent {
        *counts.entry(deed.category).or_default() += 1;
    }
    let mut leaders = counts
        .iter()
        .map(|(category, count)| (*category, *count))
        .collect::<Vec<_>>();
    leaders.sort_by(|left, right| right.1.cmp(&left.1).then_with(|| left.0.cmp(&right.0)));
    let Some((leader, leader_count)) = leaders.first().copied() else {
        return current.clone();
    };

    let primary = match current.primary {
        None => leader,
        Some(primary) if primary == leader => primary,
        Some(primary) => {
            let current_count = counts.get(&primary).copied().unwrap_or_default();
            if leader_count >= current_count.saturating_add(PRACTICE_SWITCH_LEAD) {
                leader
            } else {
                primary
            }
        }
    };
    let primary_count = counts.get(&primary).copied().unwrap_or_default();
    let secondary = leaders
        .iter()
        .filter(|(category, _)| *category != primary)
        .find(|(_, count)| {
            primary_count >= COMPOUND_MIN_DEEDS
                && *count >= COMPOUND_MIN_DEEDS
                && primary_count.abs_diff(*count) <= COMPOUND_MAX_GAP
        })
        .map(|(category, _)| *category);
    let changed = current.primary != Some(primary) || current.secondary != secondary;
    ActorPracticeState {
        schema_version: PRACTICE_SCHEMA_VERSION,
        primary: Some(primary),
        secondary,
        updated_event_seq: if changed {
            recent
                .last()
                .map(|deed| deed.latest_source_seq())
                .unwrap_or(current.updated_event_seq)
        } else {
            current.updated_event_seq
        },
    }
}

pub(crate) fn practice_view(
    actor_id: u64,
    state: &ActorPracticeState,
    deeds: &[&DeedRecord],
) -> Option<ActorPracticeView> {
    let primary = state.primary?;
    let mut categories = BTreeSet::from([primary]);
    if let Some(secondary) = state.secondary {
        categories.insert(secondary);
    }
    let mut evidence = deeds
        .iter()
        .copied()
        .filter(|deed| categories.contains(&deed.category))
        .collect::<Vec<_>>();
    evidence.sort_by_key(|deed| (deed.latest_source_seq(), deed.id.as_str()));
    let evidence = evidence
        .into_iter()
        .rev()
        .take(8)
        .map(|deed| PracticeEvidenceView {
            category: deed.category.as_str().to_string(),
            description: evidence_description(deed),
            source_event_seqs: deed.source_event_seqs.clone(),
            target_kind: deed.target_kind.clone(),
            target_id: deed.target_id.clone(),
            location_id: deed.location_id,
        })
        .collect();
    let secondary = state.secondary;
    Some(ActorPracticeView {
        schema_version: PRACTICE_SCHEMA_VERSION,
        actor_id,
        epithet: secondary
            .map(|other| format!("{} and {}", primary.epithet(), other.epithet()))
            .unwrap_or_else(|| primary.epithet().to_string()),
        known_for: secondary
            .map(|other| format!("{} and {}", primary.known_for(), other.known_for()))
            .unwrap_or_else(|| primary.known_for().to_string()),
        primary: primary.as_str().to_string(),
        secondary: secondary.map(|category| category.as_str().to_string()),
        evidence,
    })
}

fn evidence_description(deed: &DeedRecord) -> String {
    let target = format!("{} {}", deed.target_kind.replace('_', " "), deed.target_id);
    match deed.category {
        DeedCategory::Exploration => {
            format!("Made the discovery at {target} part of the shared world.")
        }
        DeedCategory::Craft => format!("Made or transformed the durable {target}."),
        DeedCategory::Delivery => {
            format!("Carried a physical item across locations and delivered it at {target}.")
        }
        DeedCategory::Stewardship => format!("Completed meaningful work for {target}."),
        DeedCategory::Care => format!("Materially protected or restored {target}."),
        DeedCategory::Mediation => format!("Helped resolve a strain involving {target}."),
        DeedCategory::Lore => format!("Recovered knowledge and left it for {target}."),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn deed(seq: u64, category: DeedCategory, target: &str) -> DeedRecord {
        DeedRecord {
            schema_version: DEED_SCHEMA_VERSION,
            id: format!("deed:{seq}"),
            actor_id: 1,
            controller_mode: "direct_input".to_string(),
            category,
            source_action: "test".to_string(),
            operation: "test".to_string(),
            rules_profile: "test".to_string(),
            contributing_pack_id: "test".to_string(),
            source_event_seqs: vec![seq],
            target_kind: "location".to_string(),
            target_id: target.to_string(),
            location_id: target.parse().ok(),
            durable_public_trace: true,
            claim_key: format!("claim:{seq}"),
        }
    }

    fn refs(deeds: &[DeedRecord]) -> Vec<&DeedRecord> {
        deeds.iter().collect()
    }

    #[test]
    fn five_deeds_across_three_targets_establish_practice() {
        let deeds = vec![
            deed(1, DeedCategory::Exploration, "1"),
            deed(2, DeedCategory::Exploration, "2"),
            deed(3, DeedCategory::Exploration, "3"),
            deed(4, DeedCategory::Exploration, "4"),
            deed(5, DeedCategory::Exploration, "5"),
        ];
        let deed_refs = refs(&deeds);
        let projected = project_practice(&ActorPracticeState::default(), &deed_refs);
        assert_eq!(projected.primary, Some(DeedCategory::Exploration));
        assert_eq!(
            practice_view(1, &projected, &deed_refs)
                .expect("practice view")
                .epithet,
            "Explorer"
        );
    }

    #[test]
    fn challenger_needs_a_three_deed_lead_to_switch() {
        let exploration = (1..=5)
            .map(|seq| deed(seq, DeedCategory::Exploration, &seq.to_string()))
            .collect::<Vec<_>>();
        let established = project_practice(&ActorPracticeState::default(), &refs(&exploration));
        let close = (10..=15)
            .map(|seq| deed(seq, DeedCategory::Craft, &seq.to_string()))
            .collect::<Vec<_>>();
        let mut mixed = exploration.clone();
        mixed.extend(close);
        assert_eq!(
            project_practice(&established, &refs(&mixed)).primary,
            Some(DeedCategory::Exploration)
        );
        mixed.push(deed(16, DeedCategory::Craft, "16"));
        mixed.push(deed(17, DeedCategory::Craft, "17"));
        assert_eq!(
            project_practice(&established, &refs(&mixed)).primary,
            Some(DeedCategory::Craft)
        );
    }
}
