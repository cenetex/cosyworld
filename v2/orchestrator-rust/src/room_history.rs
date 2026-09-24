use super::*;

// Public speech and story beats are the room's history. Worker progress, hand
// refreshes and other temporary activity keep the ordinary replay retention.
pub(super) const EVENT_TYPES: &str = "'message.created', 'image.created',
    'model_interaction.output', 'avatar.thought', 'avatar.dream',
    'actor.moved', 'journey.started', 'journey.progressed', 'journey.narrated',
    'journey.completed', 'journey.backtracked', 'journey.paused',
    'pathway.discovered', 'pathway.familiarized',
    'relationship.beat', 'relationship.advanced', 'ability_check.rolled',
    'study.resolved', 'feature.searched', 'location.searched', 'exit.discovered',
    'avatar.discovered', 'item.found', 'item.picked_up', 'item.dropped',
    'item.used', 'item.given', 'item.traded', 'job.contribution.resolved',
    'first_tale.public_trace', 'clock.updated', 'clock.threshold',
    'natural_feature.revealed', 'job.updated', 'story.receipt', 'ledger.banked',
    'calling.revised', 'skill.stepped', 'bond.created', 'bond.revised', 'bond.resolved',
    'combat.attack.attempt', 'combat.attack.hit', 'combat.attack.miss',
    'combat.defend', 'combat.dodge', 'combat.pass', 'combat.need_time',
    'combat.knockout', 'combat.flee.success', 'combat.encounter.started',
    'combat.encounter.resolved', 'magic.spell_cast', 'world.weather.shifted',
    'world.weather.held', 'world.trade.flowed', 'world.trade.disrupted',
    'world.delivery.needed', 'world.logistics.completed',
    'world.faction.influence_shifted', 'world.conflict.pressure_grew',
    'world.conflict.pressure_eased', 'world.conflict.escalated'";

pub(super) fn initialize_index(conn: &Connection) -> io::Result<()> {
    conn.execute_batch(&format!(
        "CREATE INDEX IF NOT EXISTS idx_room_history
         ON world_events(world_id, world_epoch, location_id, seq)
         WHERE event_type IN ({EVENT_TYPES});"
    ))
    .map_err(sqlite_error)
}

#[derive(Deserialize)]
pub(super) struct RoomHistoryQuery {
    location_id: u64,
    before: Option<u64>,
    limit: Option<usize>,
}

#[derive(Serialize)]
pub(super) struct RoomHistoryResponse {
    location_id: u64,
    events: Vec<EventView>,
    next_before: Option<u64>,
    has_more: bool,
}

pub(super) async fn room_history_view(
    State(state): State<AppState>,
    Query(query): Query<RoomHistoryQuery>,
) -> Result<Json<RoomHistoryResponse>, StatusCode> {
    // Room speech is shared world history, as on /events. Selecting a room
    // narrows the read; it grants no control over an avatar or a room.
    let (through_seq, fallback) = {
        let runtime = state.inner.lock().await;
        if !runtime.world.locations[..runtime.world.location_count]
            .iter()
            .any(|location| location.id == query.location_id)
        {
            return Err(StatusCode::NOT_FOUND);
        }
        (
            runtime.world.next_event_seq.saturating_sub(1),
            runtime.event_log.to_vec(),
        )
    };
    let limit = query.limit.unwrap_or(80).clamp(1, 200);
    let before = query.before.unwrap_or(u64::MAX);
    if let Some(path) = state.event_store_path.as_deref() {
        let result = read_room_history(path, query.location_id, before, through_seq, limit);
        match result {
            Ok(page) => {
                state.record_event_store_read_success();
                return Ok(Json(page));
            }
            Err(error) => {
                state.record_event_store_read_failure(&error);
                warn!("room history read failed: {error}");
                return Err(StatusCode::SERVICE_UNAVAILABLE);
            }
        }
    }
    let events = fallback.into_iter().rev().filter(|event| {
        event.location_id == Some(query.location_id)
            && event.seq < before
            && event.seq <= through_seq
            && history_event_type(&event.type_name)
    });
    Ok(Json(history_page(
        query.location_id,
        events.take(limit + 1).collect(),
        limit,
    )))
}

fn history_event_type(kind: &str) -> bool {
    EVENT_TYPES
        .split(',')
        .any(|entry| entry.trim().trim_matches('\'') == kind)
}

fn history_page(location_id: u64, mut events: Vec<EventView>, limit: usize) -> RoomHistoryResponse {
    let has_more = events.len() > limit;
    events.truncate(limit);
    events.reverse();
    RoomHistoryResponse {
        location_id,
        next_before: events.first().map(|event| event.seq),
        events,
        has_more,
    }
}

fn read_room_history(
    path: &Path,
    location_id: u64,
    before: u64,
    through_seq: u64,
    limit: usize,
) -> io::Result<RoomHistoryResponse> {
    init_event_store(path)?;
    let conn = open_event_store(path)?;
    let sql = format!(
        "SELECT payload_json FROM world_events
         WHERE world_id = ?1 AND world_epoch = ?2 AND location_id = ?3
           AND seq < ?4 AND seq <= ?5 AND event_type IN ({EVENT_TYPES})
         ORDER BY seq DESC LIMIT ?6"
    );
    let mut stmt = conn.prepare(&sql).map_err(sqlite_error)?;
    let rows = stmt
        .query_map(
            params![
                OFFICIAL_WORLD_ID,
                OFFICIAL_WORLD_EPOCH as i64,
                location_id as i64,
                before.min(i64::MAX as u64) as i64,
                through_seq.min(i64::MAX as u64) as i64,
                (limit + 1) as i64,
            ],
            |row| row.get::<_, String>(0),
        )
        .map_err(sqlite_error)?;
    let mut events = Vec::new();
    for row in rows {
        let mut event: EventView = serde_json::from_str(&row.map_err(sqlite_error)?)
            .map_err(|error| io::Error::new(io::ErrorKind::InvalidData, error))?;
        if content_reference_context_is_empty(&event.content_context) {
            event.refresh_content_context();
        }
        events.push(event);
    }
    Ok(history_page(location_id, events, limit))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn room_history_survives_churn_compaction_and_reopening() {
        let path =
            std::env::temp_dir().join(format!("cosyworld-room-history-{}.sqlite", random_hex(8)));
        let mut runtime = RuntimeWorld::seeded();
        let room = runtime.world.locations[0].id;
        let other_room = runtime.world.locations[1].id;
        let mut events = (1..=25_100)
            .map(|seq| EventView {
                seq,
                location_id: Some(if seq < 106 { room } else { other_room }),
                type_name: if seq <= 5 {
                    "message.created"
                } else {
                    "hand.shuffled"
                }
                .into(),
                content: Some(format!("line {seq}")),
                ..EventView::default()
            })
            .collect::<Vec<_>>();
        events[5].type_name = "image.created".into();
        events[6].type_name = "model_interaction.output".into();
        events[7].type_name = "story.receipt".into();
        append_event_store(&path, &events).unwrap();
        journal_checkpoint::compact_event_store_after_snapshot(&path, 0, 25_100, 1_000).unwrap();
        assert!(read_event_store_event(&path, 100).unwrap().is_none());
        assert!(read_event_store_event(&path, 1).unwrap().is_some());
        runtime.world.next_event_seq = 25_101;
        // A fresh runtime has no copy of these old messages in its hot buffer.
        let state = test_support::test_app_state(runtime, Some(path.clone()));
        let first = room_history_view(
            State(state.clone()),
            Query(RoomHistoryQuery {
                location_id: room,
                before: None,
                limit: Some(3),
            }),
        )
        .await
        .unwrap()
        .0;
        assert_eq!(
            first.events.iter().map(|e| e.seq).collect::<Vec<_>>(),
            [6, 7, 8]
        );
        assert!(first.has_more);
        let second = room_history_view(
            State(state.clone()),
            Query(RoomHistoryQuery {
                location_id: room,
                before: first.next_before,
                limit: Some(3),
            }),
        )
        .await
        .unwrap()
        .0;
        assert_eq!(
            second.events.iter().map(|e| e.seq).collect::<Vec<_>>(),
            [3, 4, 5]
        );
        let last = room_history_view(
            State(state.clone()),
            Query(RoomHistoryQuery {
                location_id: room,
                before: second.next_before,
                limit: Some(3),
            }),
        )
        .await
        .unwrap()
        .0;
        assert_eq!(
            last.events.iter().map(|e| e.seq).collect::<Vec<_>>(),
            [1, 2]
        );
        assert!(!last.has_more);
        assert!(last.events.iter().all(|e| e.location_id == Some(room)));
        drop(state);
        fs::remove_file(path).unwrap();
    }

    #[tokio::test]
    async fn room_history_reports_store_failure_and_unknown_room() {
        let runtime = RuntimeWorld::seeded();
        let room = runtime.world.locations[0].id;
        let state = test_support::test_app_state(runtime, None);
        let result = room_history_view(
            State(state.clone()),
            Query(RoomHistoryQuery {
                location_id: u64::MAX,
                before: None,
                limit: None,
            }),
        )
        .await;
        assert!(matches!(result, Err(StatusCode::NOT_FOUND)));
        let mut broken = state;
        broken.event_store_path = Some(std::env::temp_dir().into());
        let result = room_history_view(
            State(broken),
            Query(RoomHistoryQuery {
                location_id: room,
                before: None,
                limit: None,
            }),
        )
        .await;
        assert!(matches!(result, Err(StatusCode::SERVICE_UNAVAILABLE)));
    }
}
