use super::*;

// ---------------------------------------------------------------------------
// Claim key generators
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Listen / progress clock
// ---------------------------------------------------------------------------

pub(super) fn listen_progress_clock_id_for_location(location_id: u64) -> Option<&'static str> {
    match location_id {
        MOONLIT_TRAIL_LOCATION_ID => Some(MOONLIT_PROGRESS_CLOCK_ID),
        _ => None,
    }
}

// ---------------------------------------------------------------------------
// Tag ID generators
// ---------------------------------------------------------------------------

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

pub(super) fn seed_exit_discovered_tag_id(from_location_id: u64, to_location_id: u64) -> String {
    format!("seed_exit:{from_location_id}:{to_location_id}:discovered")
}

pub(super) fn hidden_exit_discovered_tag_id(hidden_exit_id: &str) -> String {
    format!("hidden_exit:{hidden_exit_id}:discovered")
}

pub(super) fn search_item_found_tag_id(item_id: u64) -> String {
    format!("item:{item_id}:search_found")
}

// ---------------------------------------------------------------------------
// Visit ledger / advancement / bond key generators
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Calling statements
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Pathway / location ID generators
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Natural resource helpers
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Pathway edge key helpers
// ---------------------------------------------------------------------------
