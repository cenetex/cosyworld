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
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(super) presentation: Option<FirstTalePresentation>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(super) continuation: Option<SeedFirstTaleContinuation>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub(super) struct SeedFirstTaleContinuation {
    pub(super) destination_location_id: u64,
    pub(super) target_actor_id: u64,
    pub(super) job_id: String,
    pub(super) travel_instruction: String,
    pub(super) arrival_instruction: String,
    pub(super) accepted_instruction: String,
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

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub(super) struct FirstTalePresentation {
    pub(super) requester_actor_id: u64,
    pub(super) title: String,
    pub(super) premise: String,
    pub(super) recognition: String,
    pub(super) scene: String,
}

pub(super) fn active_first_tale() -> Option<&'static SeedFirstTaleContent> {
    first_tale_for_manifest(&active_content().manifest)
}

impl RuntimeWorld {}

fn first_tale_for_manifest(manifest: &SeedWorldpackManifest) -> Option<&SeedFirstTaleContent> {
    manifest.first_tale.as_ref()
}

pub(super) fn validate_first_tale(first_tale: &SeedFirstTaleContent) -> Result<(), String> {
    if first_tale.schema_version != FIRST_TALE_CONTENT_SCHEMA_VERSION
        || first_tale.lead_location_id == 0
        || first_tale.destination_location_id == 0
        || first_tale
            .presentation
            .as_ref()
            .is_some_and(|presentation| {
                presentation.requester_actor_id == 0
                    || presentation.scene != "garden_path"
                    || [
                        &presentation.title,
                        &presentation.premise,
                        &presentation.recognition,
                    ]
                    .iter()
                    .any(|text| text.trim().is_empty() || text.len() > 1000)
            })
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
        || first_tale
            .continuation
            .as_ref()
            .is_some_and(|continuation| {
                continuation.destination_location_id == 0
                    || continuation.target_actor_id == 0
                    || continuation.job_id.trim().is_empty()
                    || continuation.travel_instruction.trim().is_empty()
                    || continuation.arrival_instruction.trim().is_empty()
                    || continuation.accepted_instruction.trim().is_empty()
            })
    {
        return Err(format!(
            "invalid first-tale content schema v{}",
            first_tale.schema_version
        ));
    }
    Ok(())
}
