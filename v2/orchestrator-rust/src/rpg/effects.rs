use crate::*;

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(tag = "op", rename_all = "snake_case")]
pub(crate) enum EffectDescriptor {
    AdvanceClock {
        clock_id: String,
        amount: u8,
        #[serde(default)]
        reason: Option<String>,
    },
    SetTag {
        tag_id: String,
        scope: String,
        scope_id: u64,
        label: String,
        kind: String,
        #[serde(default)]
        expires: Option<String>,
        #[serde(default)]
        reason: Option<String>,
    },
    ClearTag {
        tag_id: String,
        #[serde(default)]
        reason: Option<String>,
    },
    SetJobStatus {
        job_id: String,
        status: String,
        #[serde(default)]
        reason: Option<String>,
    },
    UnlockExit {
        from_location_id: u64,
        to_location_id: u64,
        #[serde(default)]
        reason: Option<String>,
    },
    RevealItem {
        item_id: u64,
        location_id: u64,
        #[serde(default)]
        reason: Option<String>,
    },
    #[serde(other)]
    Unknown,
}

pub(crate) fn lifecycle_hook_requirements_met(
    hook: &SeedLifecycleHookContent,
    tags: &BTreeMap<String, RpgTagState>,
) -> bool {
    hook.requirements.iter().all(|requirement| {
        requirement.kind == "active_tag"
            && tags.get(&requirement.tag_id).is_some_and(|tag| tag.active)
    })
}

impl RuntimeWorld {}

pub(crate) fn effect_descriptor_reason(effect: &EffectDescriptor) -> Option<&str> {
    match effect {
        EffectDescriptor::AdvanceClock { reason, .. }
        | EffectDescriptor::SetTag { reason, .. }
        | EffectDescriptor::ClearTag { reason, .. }
        | EffectDescriptor::SetJobStatus { reason, .. }
        | EffectDescriptor::UnlockExit { reason, .. }
        | EffectDescriptor::RevealItem { reason, .. } => reason.as_deref(),
        EffectDescriptor::Unknown => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn lifecycle_hook_active_tag_requirement_tracks_durable_tag_state() {
        let hook = SeedLifecycleHookContent {
            hook: "on_use".to_string(),
            target_kind: "item".to_string(),
            target_id: "2005".to_string(),
            claim_scope: "world_target_once".to_string(),
            requirements: vec![SeedLifecycleRequirementContent {
                kind: "active_tag".to_string(),
                tag_id: "room:1:test_gate_open".to_string(),
            }],
            effects: Vec::new(),
        };
        let mut tags = BTreeMap::new();
        assert!(!lifecycle_hook_requirements_met(&hook, &tags));
        tags.insert(
            "room:1:test_gate_open".to_string(),
            RpgTagState {
                id: "room:1:test_gate_open".to_string(),
                scope: "room".to_string(),
                scope_id: COSY_COTTAGE_LOCATION_ID,
                label: "test gate open".to_string(),
                kind: "memory".to_string(),
                active: true,
                source_event_seq: None,
                expires: None,
            },
        );
        assert!(lifecycle_hook_requirements_met(&hook, &tags));
        tags.get_mut("room:1:test_gate_open")
            .expect("test tag remains present")
            .active = false;
        assert!(!lifecycle_hook_requirements_met(&hook, &tags));
    }
}
