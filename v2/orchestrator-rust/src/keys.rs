use super::*;

pub(super) fn ability_check_success_claim_key(
    actor_id: u64,
    location_id: u64,
    ability: u8,
    dc: i16,
) -> String {
    format!("ability_check_success:{actor_id}:{location_id}:{ability}:{dc}")
}

pub(super) fn economy_disclosure_claim_key(viewer_actor_id: u64, target_actor_id: u64) -> String {
    format!("economy_disclosed:{viewer_actor_id}:{target_actor_id}")
}

pub(super) fn notice_actor_fact_claim_key(
    viewer_actor_id: u64,
    target_actor_id: u64,
    item_id: u64,
    held_since_tick: u64,
) -> String {
    format!(
        "notice_actor:v1:{viewer_actor_id}:{target_actor_id}:carried_item:{item_id}:{held_since_tick}"
    )
}

pub(super) fn listen_attempt_claim_key(actor_id: u64, location_id: u64) -> String {
    format!("listen_attempt:{actor_id}:{location_id}")
}

pub(super) const CLOCK_FILL_CASCADE_MAX_DEPTH: usize = 4;

pub(super) fn clock_fill_claim_key(clock_id: &str, event_seq: u64) -> String {
    format!("clock_fill:{clock_id}:{event_seq}")
}

pub(super) fn lifecycle_hooks_for(
    hook_name: &str,
    target_kind: &str,
    target_id: &str,
) -> Vec<&'static SeedLifecycleHookContent> {
    active_content()
        .lifecycle_hooks
        .iter()
        .filter(|hook| {
            hook.hook == hook_name && hook.target_kind == target_kind && hook.target_id == target_id
        })
        .collect()
}

pub(super) fn lifecycle_effects_for(
    hook_name: &str,
    target_kind: &str,
    target_id: &str,
) -> Vec<EffectDescriptor> {
    lifecycle_hooks_for(hook_name, target_kind, target_id)
        .into_iter()
        .flat_map(|hook| hook.effects.clone())
        .collect()
}

pub(super) fn lifecycle_hook_claim_key(
    hook: &SeedLifecycleHookContent,
    actor_id: u64,
    target_kind: &str,
    target_id: &str,
    source_event_seq: u64,
) -> Option<String> {
    match hook.claim_scope.as_str() {
        "event_once" => Some(format!(
            "hook:{}:{target_kind}:{target_id}:event:{source_event_seq}",
            hook.hook
        )),
        "actor_target_once" => Some(format!(
            "hook:{}:{target_kind}:{target_id}:actor:{actor_id}",
            hook.hook
        )),
        "world_target_once" => Some(format!(
            "hook:{}:{target_kind}:{target_id}:world",
            hook.hook
        )),
        _ => None,
    }
}

pub(super) fn listen_progress_clock_id_for_location(location_id: u64) -> Option<&'static str> {
    match location_id {
        MOONLIT_TRAIL_LOCATION_ID => Some(MOONLIT_PROGRESS_CLOCK_ID),
        _ => None,
    }
}

pub(super) fn tired_tag_id(actor_id: u64) -> String {
    format!("actor:{actor_id}:tired")
}

pub(super) fn trained_since_rest_tag_id(actor_id: u64) -> String {
    format!("actor:{actor_id}:trained_since_rest")
}

pub(super) fn prepared_tag_id(actor_id: u64, location_id: u64) -> String {
    format!("actor:{actor_id}:prepared:{location_id}")
}

pub(super) fn project_preparation_spent_tag_id(
    actor_id: u64,
    location_id: u64,
    clock_id: &str,
) -> String {
    format!("actor:{actor_id}:prepared_spent:{location_id}:{clock_id}")
}

pub(super) fn helped_room_tag_id(location_id: u64) -> String {
    format!("room:{location_id}:helped")
}

pub(super) fn feature_use_tag_id(
    actor_id: u64,
    location_id: u64,
    feature_key: &str,
    item_id: u64,
) -> String {
    format!("actor:{actor_id}:feature_use:{location_id}:{feature_key}:{item_id}")
}

pub(super) fn feature_search_tag_id(actor_id: u64, location_id: u64, feature_key: &str) -> String {
    format!("actor:{actor_id}:feature_search:{location_id}:{feature_key}")
}

pub(super) fn room_feature_search_tag_id(location_id: u64, feature_key: &str) -> String {
    format!("room:{location_id}:feature_search:{feature_key}")
}

pub(super) fn location_search_tag_id(actor_id: u64, location_id: u64) -> String {
    format!("actor:{actor_id}:location_search:{location_id}")
}

pub(super) fn room_location_search_tag_id(location_id: u64) -> String {
    format!("room:{location_id}:location_search")
}

pub(super) fn seed_exit_discovered_tag_id(from_location_id: u64, to_location_id: u64) -> String {
    format!("seed_exit:{from_location_id}:{to_location_id}:discovered")
}

pub(super) fn seed_exit_belief_subject_key(from_location_id: u64, to_location_id: u64) -> String {
    format!("{from_location_id}:{to_location_id}")
}

pub(super) fn hidden_exit_discovered_tag_id(hidden_exit_id: &str) -> String {
    format!("hidden_exit:{hidden_exit_id}:discovered")
}

pub(super) fn avatar_discovered_tag_id(actor_id: u64) -> String {
    format!("avatar:{actor_id}:discovered")
}

pub(super) fn search_item_found_tag_id(item_id: u64) -> String {
    format!("item:{item_id}:search_found")
}

pub(super) fn frontier_travel_since_rest_tag_id(actor_id: u64, event_seq: u64) -> String {
    format!("actor:{actor_id}:frontier_travel_since_rest:{event_seq}")
}

pub(super) fn frontier_travel_since_rest_tag_prefix(actor_id: u64) -> String {
    format!("actor:{actor_id}:frontier_travel_since_rest:")
}

#[cfg(test)]
pub(super) fn quieted_moonlight_tag_id(location_id: u64) -> String {
    format!("room:{location_id}:quieted_moonlight")
}

#[cfg(test)]
pub(super) fn echo_fractured_tag_id(location_id: u64) -> String {
    format!("room:{location_id}:echo_fractured")
}

pub(super) fn visit_ledger_mark_id(actor_id: u64, category: &str, reason: &str) -> String {
    format!("ledger:{actor_id}:{category}:{reason}")
}

pub(super) fn visit_ledger_claim_key(mark_id: &str) -> String {
    format!("visit_ledger:{mark_id}")
}

pub(super) fn advancement_spend_id(actor_id: u64, kind: &str, source_event_seq: u64) -> String {
    format!("advancement:{actor_id}:{kind}:{source_event_seq}")
}

pub(super) fn skill_state_id(actor_id: u64, skill_id: &str) -> String {
    format!("skill:{actor_id}:{skill_id}")
}

pub(super) fn bond_id(actor_id: u64, target_actor_id: u64) -> String {
    format!("bond:{actor_id}:{target_actor_id}")
}

pub(super) fn gift_bond_claim_key(actor_id: u64, target_actor_id: u64, item_id: u64) -> String {
    format!("bond_gift:{actor_id}:{target_actor_id}:{item_id}")
}

pub(super) fn chat_bond_claim_key(actor_id: u64, target_actor_id: u64) -> String {
    format!("bond_chat:{actor_id}:{target_actor_id}")
}

pub(super) fn help_bond_claim_key(actor_id: u64, target_actor_id: u64) -> String {
    format!("bond_help:{actor_id}:{target_actor_id}")
}

pub(super) fn feature_bond_claim_key(actor_id: u64, target: &FeatureBondTarget) -> String {
    format!(
        "bond_feature:{actor_id}:{}:{}:{}:{}",
        target.target_actor_id, target.location_id, target.feature_key, target.item_id
    )
}

pub(super) fn default_bond_statement(target_name: &str) -> String {
    format!("I bring small kindnesses to {target_name}.")
}

pub(super) const AUTHORED_CALLING_STATEMENTS: [&str; 13] = [
    "I listen for odd jobs nobody else wants.",
    "I listen for clues and stick my nose into lost-property trouble.",
    "I listen at stuck doors before I shoulder them open.",
    "I listen for snack breaks before tempers boil.",
    "I listen for muddy footsteps going somewhere useful.",
    "I listen first, then help with whatever broke.",
    "I listen for small truths and help where I can.",
    "I listen for what lost things still need.",
    "I listen for what shy rooms are trying to say.",
    "I listen for the weather behind every warning.",
    "I listen for kindness hiding in strange errands.",
    "I listen for the safer road no one has named yet.",
    EXPLORER_CALLING_STATEMENT,
];

pub(crate) const CALLING_REASON_AVATAR_CREATED: &str = "avatar_created";

pub(super) fn default_calling_statement() -> &'static str {
    AUTHORED_CALLING_STATEMENTS[0]
}

pub(super) fn authored_calling_statement(statement: &str) -> Option<String> {
    let normalized = normalize_calling_statement(statement)?;
    if AUTHORED_CALLING_STATEMENTS.contains(&normalized.as_str())
        || calling_forge::is_calling_forge_statement(&normalized)
    {
        Some(normalized)
    } else {
        None
    }
}

pub(super) fn calling_statement_is_explorer(statement: &str) -> bool {
    statement
        .trim()
        .eq_ignore_ascii_case(EXPLORER_CALLING_STATEMENT)
}

pub(super) fn canonical_pathway_anchors(left: u64, right: u64) -> (u64, u64) {
    if left <= right {
        (left, right)
    } else {
        (right, left)
    }
}

pub(super) fn generated_pathway_canonical_id(source_route: &RouteRecordState) -> String {
    format!(
        "generated-pathway:{}@{}",
        source_route.canonical_id, source_route.entity_version
    )
}

pub(super) fn generated_waypoint_canonical_id(pathway_id: &str, index: usize) -> String {
    format!("{pathway_id}/waypoint/{index}")
}

pub(super) fn generated_pathway_progress_clock_id(pathway_id: &str) -> String {
    format!("{pathway_id}:familiarity")
}

pub(super) fn generated_pathway_danger_clock_id(pathway_id: &str) -> String {
    format!("{pathway_id}:wildness")
}

pub(super) fn generated_pathway_job_id(pathway_id: &str) -> String {
    format!("{pathway_id}:community-work")
}

pub(super) fn natural_resource_family_threshold(
    resource_kind: NaturalResourceKind,
) -> &'static str {
    match resource_kind {
        NaturalResourceKind::FishRichWater
        | NaturalResourceKind::FastRiver
        | NaturalResourceKind::HotSpring => {
            "The signs resolve into a water-borne natural resource family, though its exact affordance is not public yet."
        }
        NaturalResourceKind::OreSeam | NaturalResourceKind::ClayBank => {
            "The signs resolve into a geological natural resource family, though its exact affordance is not public yet."
        }
        NaturalResourceKind::AncientWoodland
        | NaturalResourceKind::RichSoil
        | NaturalResourceKind::RareHerbHabitat => {
            "The signs resolve into a living-land natural resource family, though its exact affordance is not public yet."
        }
        NaturalResourceKind::ReliableUplandWind => {
            "The signs resolve into a wind-and-height natural resource family, though its exact affordance is not public yet."
        }
        NaturalResourceKind::OldRuins => {
            "The signs resolve into a cultural-landscape resource family, though its exact affordance is not public yet."
        }
    }
}

pub(super) fn natural_investigation_contribution_strategies(
    state: &NaturalAffordanceState,
) -> Vec<JobContributionStrategy> {
    [
        ("check", "wisdom", "Read the visible signs"),
        ("study", "intelligence", "Compare the place's patterns"),
    ]
    .into_iter()
    .filter_map(|(action_kind, ability, strategy_label)| {
        let binding = resolved_action_binding(action_kind)?;
        Some(JobContributionStrategy {
            version: JOB_CONTRIBUTION_SCHEMA_VERSION,
            id: format!("natural-investigation-{action_kind}"),
            action_kind: action_kind.to_string(),
            rules_action: binding.rules_action,
            operation: binding.operation,
            target: ContributionTargetDescriptor {
                kind: "room".to_string(),
                id: Some(state.location_id.to_string()),
                predicate: None,
                label: "the visible landscape".to_string(),
            },
            requirements: vec![ContributionRequirement::AtLocation {
                location_id: state.location_id,
            }],
            resolution: ContributionResolutionPolicy::SrdCheck {
                ability: ability.to_string(),
                dc: LISTEN_DC as u16,
            },
            clock_id: state.investigation_clock_id.clone(),
            baseline_progress: 0,
            success_progress: 2,
            prepared_bonus_progress: 0,
            on_success: Vec::new(),
            on_failure: Vec::new(),
            claim_policy: ContributionClaimPolicy::OncePerActor,
            strategy_label: strategy_label.to_string(),
            narration_key: format!("natural.investigation.{action_kind}"),
            rules_profile: active_content().manifest.rules_profile.clone(),
            rules_pack_id: binding.pack_id,
            rules_pack_version: binding.pack_version,
            pack_id: state.generation.pack_id.clone(),
            pack_version: state.generation.pack_version.clone(),
        })
    })
    .collect()
}

pub(super) fn pathway_edge_key(left: u64, right: u64) -> String {
    let (origin, destination) = canonical_pathway_anchors(left, right);
    format!("{origin}:{destination}")
}

pub(super) fn parse_pathway_edge_key(value: &str) -> Option<(u64, u64)> {
    let (left, right) = value.split_once(':')?;
    Some((left.parse().ok()?, right.parse().ok()?))
}

pub(super) fn stable_pathway_hash(value: &str) -> u64 {
    value.bytes().fold(0xcbf2_9ce4_8422_2325, |hash, byte| {
        (hash ^ u64::from(byte)).wrapping_mul(0x1000_0000_01b3)
    })
}
