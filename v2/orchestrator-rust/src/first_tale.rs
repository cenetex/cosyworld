use super::*;

pub(super) const FIRST_TALE_CONTENT_SCHEMA_VERSION: u8 = 1;

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub(super) struct SeedFirstTaleContent {
    pub(super) schema_version: u8,
    pub(super) lead_location_id: u64,
    pub(super) destination_location_id: u64,
    pub(super) job_id: String,
    pub(super) progress_clock_id: String,
    pub(super) copy: SeedFirstTaleCopy,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub(super) struct SeedFirstTaleCopy {
    pub(super) question: String,
    pub(super) notice_instruction: String,
    pub(super) follow_lead_instruction: String,
    pub(super) contribute_instruction: String,
    pub(super) complete_instruction: String,
    pub(super) target_label: String,
    pub(super) consequence: String,
    pub(super) completion_memory: String,
    pub(super) next_invitation: String,
    pub(super) public_trace: String,
}

pub(super) fn active_first_tale() -> Option<&'static SeedFirstTaleContent> {
    first_tale_for_manifest(&active_content().manifest)
}

pub(super) fn first_tale_trace_claim_prefix(actor_id: u64) -> Option<String> {
    Some(format!(
        "first_tale:v{}:actor:{actor_id}:event:",
        active_first_tale()?.schema_version
    ))
}

pub(super) fn first_tale_trace_claim_key(actor_id: u64, event_seq: u64) -> Option<String> {
    Some(format!(
        "{}{event_seq}",
        first_tale_trace_claim_prefix(actor_id)?
    ))
}

impl RuntimeWorld {
    pub(super) fn first_tale_trace_event_seq(&self, actor_id: u64) -> Option<u64> {
        let prefix = first_tale_trace_claim_prefix(actor_id)?;
        self.rpg_claims
            .iter()
            .filter_map(|claim| claim.strip_prefix(&prefix)?.parse::<u64>().ok())
            .min()
    }

    pub(super) fn apply_first_tale_public_trace_projection(
        &mut self,
        action: &CwAction,
        events: &[EventView],
    ) -> Vec<EventView> {
        let Some(first_tale) = active_first_tale() else {
            return Vec::new();
        };
        let shared_question_complete = self
            .clocks
            .get(&first_tale.progress_clock_id)
            .is_some_and(|clock| clock.filled >= clock.segments);
        if !action_is_discovery_check(action)
            || self.first_tale_trace_event_seq(action.actor_id).is_some()
            || !self.listen_attempt_claimed_at(action.actor_id, first_tale.lead_location_id)
            || !shared_question_complete
        {
            return Vec::new();
        }
        let Some(check) = events.iter().find(|event| {
            event.type_name == "ability_check.rolled"
                && event.actor_id == Some(action.actor_id)
                && event.location_id == Some(first_tale.destination_location_id)
        }) else {
            return Vec::new();
        };
        if !check.success
            || check
                .total
                .zip(check.dc)
                .is_none_or(|(total, dc)| total < dc)
        {
            return Vec::new();
        }

        let mut trace = self.append_async_job_event(
            "first_tale.public_trace",
            action.actor_id,
            None,
            Some(first_tale.copy.public_trace.clone()),
        );
        trace.caused_by_event_seq = Some(check.seq);
        self.replace_projected_event(&trace);
        if let Some(claim_key) = first_tale_trace_claim_key(action.actor_id, trace.seq) {
            self.rpg_claims.insert(claim_key);
        }
        vec![trace]
    }
}

fn first_tale_for_manifest(manifest: &SeedWorldpackManifest) -> Option<&SeedFirstTaleContent> {
    manifest.first_tale.as_ref()
}

#[cfg(test)]
pub(super) fn official_first_tale() -> &'static SeedFirstTaleContent {
    static OFFICIAL_FIRST_TALE: OnceLock<SeedFirstTaleContent> = OnceLock::new();
    OFFICIAL_FIRST_TALE.get_or_init(|| {
        serde_json::from_str(include_str!("../../worlds/official/first-tale.json"))
            .expect("official first-tale source must be valid")
    })
}

pub(super) fn validate_first_tale(first_tale: &SeedFirstTaleContent) -> Result<(), String> {
    if first_tale.schema_version != FIRST_TALE_CONTENT_SCHEMA_VERSION
        || first_tale.lead_location_id == 0
        || first_tale.destination_location_id == 0
        || first_tale.job_id.trim().is_empty()
        || first_tale.progress_clock_id.trim().is_empty()
        || [
            &first_tale.copy.question,
            &first_tale.copy.notice_instruction,
            &first_tale.copy.follow_lead_instruction,
            &first_tale.copy.contribute_instruction,
            &first_tale.copy.complete_instruction,
            &first_tale.copy.target_label,
            &first_tale.copy.consequence,
            &first_tale.copy.completion_memory,
            &first_tale.copy.next_invitation,
            &first_tale.copy.public_trace,
        ]
        .into_iter()
        .any(|line| line.trim().is_empty())
    {
        return Err(format!(
            "invalid first-tale content schema v{}",
            first_tale.schema_version
        ));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn project89_first_tale() -> SeedFirstTaleContent {
        serde_json::from_str(include_str!("../../worlds/project89/first-tale.json"))
            .expect("Project 89 first-tale source")
    }

    #[test]
    fn compiled_manifest_accepts_an_optional_inline_first_tale() {
        let mut manifest = serde_json::from_str::<serde_json::Value>(include_str!(
            "../../content/official/worldpack.json"
        ))
        .expect("official compiled manifest");
        manifest["first_tale"] =
            serde_json::to_value(project89_first_tale()).expect("first tale serializes");

        let manifest = serde_json::from_value::<SeedWorldpackManifest>(manifest)
            .expect("inline first tale parses");
        let first_tale = manifest.first_tale.expect("first tale is retained");
        assert_eq!(first_tale.destination_location_id, 8905);
        assert_eq!(first_tale.job_id, "project89:operation-liberation");
    }

    #[test]
    fn absent_manifest_first_tale_stays_absent() {
        let manifest = serde_json::from_str::<SeedWorldpackManifest>(include_str!(
            "../../content/ruby-high-only/worldpack.json"
        ))
        .expect("Ruby-only compiled manifest");
        assert!(first_tale_for_manifest(&manifest).is_none());
    }

    #[test]
    fn official_source_explicitly_preserves_the_existing_first_tale() {
        let first_tale = official_first_tale();
        validate_first_tale(first_tale).expect("official first tale is valid");
        assert_eq!(first_tale.lead_location_id, COSY_COTTAGE_LOCATION_ID);
        assert_eq!(
            first_tale.destination_location_id,
            RAIN_SOFT_GARDEN_LOCATION_ID
        );
        assert_eq!(first_tale.job_id, FIRST_TALE_JOB_ID);
        assert_eq!(first_tale.progress_clock_id, FIRST_TALE_PROGRESS_CLOCK_ID);
        assert_eq!(
            first_tale.copy.question,
            "Can we make the washed garden path trustworthy before the next visitor?"
        );
    }

    #[test]
    fn project89_owns_its_first_tale_locations_job_and_copy() {
        let first_tale = project89_first_tale();
        validate_first_tale(&first_tale).expect("Project 89 first tale is valid");
        assert_eq!(first_tale.lead_location_id, 8900);
        assert_eq!(first_tale.destination_location_id, 8905);
        assert_eq!(first_tale.job_id, "project89:operation-liberation");
        assert_eq!(first_tale.progress_clock_id, "project89.liberation-signal");
        assert!(first_tale.copy.next_invitation.contains("relay apertures"));
        assert!(!first_tale.copy.question.contains("garden"));
    }

    #[test]
    fn only_source_compositions_that_mount_the_core_tale_declare_it() {
        let core_only: serde_json::Value =
            serde_json::from_str(include_str!("../../worlds/core-only/world.json"))
                .expect("core-only source world");
        let core_ruby: serde_json::Value =
            serde_json::from_str(include_str!("../../worlds/core-ruby/world.json"))
                .expect("core-ruby source world");
        let ruby_only: serde_json::Value =
            serde_json::from_str(include_str!("../../worlds/ruby-high-only/world.json"))
                .expect("Ruby-only source world");
        let services_only: serde_json::Value =
            serde_json::from_str(include_str!("../../worlds/services-only/world.json"))
                .expect("services-only source world");
        assert_eq!(
            core_only.get("first_tale").and_then(|value| value.as_str()),
            Some("../official/first-tale.json")
        );
        assert_eq!(
            core_ruby.get("first_tale").and_then(|value| value.as_str()),
            Some("../official/first-tale.json")
        );
        assert!(ruby_only.get("first_tale").is_none());
        assert!(services_only.get("first_tale").is_none());
    }
}
