use super::*;

#[derive(Clone, Copy, Debug, Default, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
enum EntityLevelPhase {
    #[default]
    Legacy,
    Fresh,
    Authoritative,
}

#[derive(Clone, Debug, Default, Deserialize, Serialize)]
pub(super) struct EntityLevelLedger {
    phase: EntityLevelPhase,
    #[serde(default)]
    entities: BTreeMap<String, EntityLevelState>,
}

#[derive(Clone, Debug, Default, Deserialize, Serialize)]
struct EntityLevelState {
    level: u8,
    #[serde(default)]
    grandfathered: bool,
    #[serde(default)]
    receipts: BTreeMap<String, EntityLevelReceipt>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
struct EntityLevelReceipt {
    source_event_seq: Option<u64>,
    kind: String,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
pub(super) struct ItemLevelPolicy {
    pub(super) schema_version: u8,
    pub(super) criteria: Vec<ItemLevelCriterion>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
pub(super) struct ItemLevelCriterion {
    pub(super) id: String,
    pub(super) location_id: u64,
    pub(super) feature_key: String,
}

impl EntityLevelLedger {
    pub(super) fn fresh() -> Self {
        Self {
            phase: EntityLevelPhase::Fresh,
            entities: BTreeMap::new(),
        }
    }
}

pub(super) fn validate_item_level_policy(
    item: &SeedItemContent,
    features: &[SeedRoomFeatureContent],
) -> Result<(), String> {
    let Some(policy) = item.level_policy.as_ref() else {
        return Ok(());
    };
    let invalid = || format!("item {} has an invalid authored level-use policy", item.id);
    if policy.schema_version != 1 || !(1..=19).contains(&policy.criteria.len()) {
        return Err(invalid());
    }
    let mut ids = BTreeSet::new();
    let mut targets = BTreeSet::new();
    for criterion in &policy.criteria {
        if criterion.id.is_empty()
            || criterion.id.len() > 64
            || !criterion.id.as_bytes()[0].is_ascii_lowercase()
            || !criterion
                .id
                .bytes()
                .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == b'-')
            || !ids.insert(&criterion.id)
            || !targets.insert((criterion.location_id, &criterion.feature_key))
            || !features.iter().any(|feature| {
                feature.location_id == criterion.location_id
                    && feature.key == criterion.feature_key
                    && feature.uses.iter().any(|use_| use_.item_id == item.id)
            })
        {
            return Err(invalid());
        }
    }
    Ok(())
}

impl RuntimeWorld {}
