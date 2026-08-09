use super::*;

#[derive(Clone, Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub(super) struct FirstTalePresentationReceiptRequest {
    actor_id: u64,
    actor_session: String,
    exposure_id: String,
    interaction: String,
    phase: String,
    transport: String,
    state_revision: u64,
}

#[derive(Clone, Debug, Serialize)]
pub(super) struct FirstTalePresentationReceiptResponse {
    ok: bool,
    status: u32,
    exposure_id: String,
    recorded: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    error: Option<String>,
}

fn interaction_is_visible(interaction: &str, phase: &str, advancement_points: usize) -> bool {
    match interaction {
        "phase_seen" => true,
        "completion_memory_seen" => phase == "complete",
        "growth_feedback_seen" | "journal_opened_after_growth" => advancement_points > 0,
        _ => false,
    }
}

pub(super) async fn acknowledge_first_tale_presentation(
    State(state): State<AppState>,
    Json(receipt): Json<FirstTalePresentationReceiptRequest>,
) -> Json<FirstTalePresentationReceiptResponse> {
    let rejected = |status, error: &str| {
        Json(FirstTalePresentationReceiptResponse {
            ok: false,
            status,
            exposure_id: receipt.exposure_id.clone(),
            recorded: false,
            error: Some(error.to_string()),
        })
    };
    if !valid_world_beat_transport(&receipt.transport) {
        return rejected(422, "unsupported first-tale presentation transport");
    }

    converge_capacity_for_read(&state, Some(&receipt.actor_session)).await;
    let (authorized, current_revision, visible_tale, advancement_points) = {
        let runtime = state.inner.lock().await;
        let authorized = client_actor_authorized_for_state(
            &runtime,
            &state,
            receipt.actor_id,
            Some(&receipt.actor_session),
        );
        (
            authorized,
            runtime.world.next_event_seq.saturating_sub(1),
            runtime.first_tale_view(receipt.actor_id),
            runtime
                .visit_ledger_view(receipt.actor_id)
                .advancement_points,
        )
    };
    if !authorized {
        return rejected(403, "actor session is not authorized");
    }
    if receipt.state_revision > current_revision {
        return rejected(409, "state revision is ahead of the canonical world");
    }
    let Some(tale) = visible_tale else {
        return rejected(404, "first tale is not visible to this actor");
    };
    let presentation_phase = tale
        .continuation
        .as_ref()
        .map(|continuation| continuation.phase.as_str())
        .unwrap_or(tale.phase.as_str());
    if presentation_phase != receipt.phase || tale.phase_exposure_id != receipt.exposure_id {
        return rejected(409, "first-tale presentation is stale");
    }
    if !interaction_is_visible(&receipt.interaction, &tale.phase, advancement_points) {
        return rejected(422, "first-tale presentation interaction is not visible");
    }
    let Some(path) = state.event_store_path.as_deref() else {
        return rejected(503, "activation metrics store is not configured");
    };
    match record_first_tale_presentation_at(
        path,
        receipt.actor_id,
        &receipt.phase,
        &receipt.interaction,
        &receipt.exposure_id,
        &receipt.transport,
        receipt.state_revision,
        now_millis(),
    ) {
        Ok(recorded) => Json(FirstTalePresentationReceiptResponse {
            ok: true,
            status: 200,
            exposure_id: receipt.exposure_id,
            recorded,
            error: None,
        }),
        Err(error) => {
            warn!(
                "failed to record first-tale presentation {}: {}",
                receipt.exposure_id, error
            );
            rejected(503, "activation metrics store is temporarily unavailable")
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn presentation_interactions_require_their_visible_state() {
        assert!(interaction_is_visible("phase_seen", "notice", 0));
        assert!(interaction_is_visible(
            "completion_memory_seen",
            "complete",
            0
        ));
        assert!(!interaction_is_visible(
            "completion_memory_seen",
            "contribute",
            2
        ));
        assert!(interaction_is_visible(
            "growth_feedback_seen",
            "follow_lead",
            1
        ));
        assert!(!interaction_is_visible(
            "journal_opened_after_growth",
            "complete",
            0
        ));
        assert!(!interaction_is_visible("invented", "complete", 2));
    }
}
