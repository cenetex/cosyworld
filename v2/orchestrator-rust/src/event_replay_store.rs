use super::*;

const EVENT_REPLAY_LOCATION_CHUNK_SIZE: usize = 400;

pub(super) fn insert_world_events(conn: &Connection, events: &[EventView]) -> io::Result<()> {
    let mut stmt = conn
        .prepare(
            "INSERT OR IGNORE INTO world_events
             (seq, world_id, world_epoch, event_type, location_id,
              destination_location_id, payload_json, created_at_ms)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
        )
        .map_err(sqlite_error)?;
    let now = now_millis();
    for event in events.iter().filter(|event| event.seq > 0) {
        validate_canonical_event(event)?;
        let payload = serialized_event(event)?;
        stmt.execute(params![
            event.seq as i64,
            event.world_id,
            event.world_epoch as i64,
            event.type_name,
            event.location_id.map(|id| id as i64),
            event.destination_location_id.map(|id| id as i64),
            payload,
            now as i64,
        ])
        .map_err(sqlite_error)?;
    }
    Ok(())
}

pub(super) fn insert_world_events_strict(
    conn: &Connection,
    events: &[EventView],
) -> io::Result<()> {
    let mut stmt = conn
        .prepare(
            "INSERT INTO world_events
             (seq, world_id, world_epoch, event_type, location_id,
              destination_location_id, payload_json, created_at_ms)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
        )
        .map_err(sqlite_error)?;
    let now = now_millis();
    for event in events.iter().filter(|event| event.seq > 0) {
        validate_canonical_event(event)?;
        let inserted = stmt
            .execute(params![
                event.seq as i64,
                event.world_id,
                event.world_epoch as i64,
                event.type_name,
                event.location_id.map(|id| id as i64),
                event.destination_location_id.map(|id| id as i64),
                serialized_event(event)?,
                now as i64,
            ])
            .map_err(sqlite_error)?;
        if inserted != 1 {
            return Err(io::Error::new(
                io::ErrorKind::AlreadyExists,
                format!("canonical world event {} already exists", event.seq),
            ));
        }
    }
    Ok(())
}

fn validate_canonical_event(event: &EventView) -> io::Result<()> {
    if event.world_id == OFFICIAL_WORLD_ID && event.world_epoch == OFFICIAL_WORLD_EPOCH {
        return Ok(());
    }
    Err(io::Error::new(
        io::ErrorKind::InvalidData,
        "world event does not belong to the active canonical epoch",
    ))
}

fn serialized_event(event: &EventView) -> io::Result<String> {
    let mut persisted = event.clone();
    persisted.refresh_content_context();
    serde_json::to_string(&persisted)
        .map_err(|error| io::Error::new(io::ErrorKind::InvalidData, error))
}

pub(super) fn read_event_store_tail_for_locations(
    path: &Path,
    visible_locations: &BTreeSet<u64>,
    through_seq: u64,
    limit: usize,
) -> io::Result<(Vec<EventView>, u64)> {
    if visible_locations.is_empty() || limit == 0 {
        return Ok((Vec::new(), 0));
    }
    init_event_store(path)?;
    let conn = open_event_store(path)?;
    let mut events = BTreeMap::new();
    let visible_locations = visible_locations.iter().copied().collect::<Vec<_>>();
    for location_chunk in visible_locations.chunks(EVENT_REPLAY_LOCATION_CHUNK_SIZE) {
        let location_parameters = (0..location_chunk.len())
            .map(|index| format!("?{}", index + 4))
            .collect::<Vec<_>>()
            .join(", ");
        let limit_parameter = location_chunk.len() + 4;
        let query = format!(
            "SELECT payload_json FROM world_events
             WHERE world_id = ?1 AND world_epoch = ?2
               AND seq <= ?3
               AND (
                 location_id IN ({location_parameters})
                 OR destination_location_id IN ({location_parameters})
               )
             ORDER BY seq DESC
             LIMIT ?{limit_parameter}"
        );
        let mut parameters = Vec::with_capacity(location_chunk.len() + 4);
        parameters.push(rusqlite::types::Value::Text(OFFICIAL_WORLD_ID.to_string()));
        parameters.push(rusqlite::types::Value::Integer(OFFICIAL_WORLD_EPOCH as i64));
        parameters.push(rusqlite::types::Value::Integer(through_seq as i64));
        parameters.extend(
            location_chunk
                .iter()
                .map(|location_id| rusqlite::types::Value::Integer(*location_id as i64)),
        );
        parameters.push(rusqlite::types::Value::Integer(
            limit.min(MAX_EVENT_REPLAY_LIMIT) as i64,
        ));
        let mut stmt = conn.prepare(&query).map_err(sqlite_error)?;
        let rows = stmt
            .query_map(rusqlite::params_from_iter(parameters.iter()), |row| {
                row.get::<_, String>(0)
            })
            .map_err(sqlite_error)?;
        for row in rows {
            let payload = row.map_err(sqlite_error)?;
            let mut event: EventView = serde_json::from_str(&payload)
                .map_err(|error| io::Error::new(io::ErrorKind::InvalidData, error))?;
            if content_reference_context_is_empty(&event.content_context) {
                event.refresh_content_context();
            }
            events.insert(event.seq, event);
        }
    }
    let stored_through_seq = conn
        .query_row(
            "SELECT COALESCE(MAX(seq), 0) FROM world_events
             WHERE world_id = ?1 AND world_epoch = ?2 AND seq <= ?3",
            params![
                OFFICIAL_WORLD_ID,
                OFFICIAL_WORLD_EPOCH as i64,
                through_seq as i64
            ],
            |row| row.get::<_, i64>(0),
        )
        .map_err(sqlite_error)?
        .max(0) as u64;
    Ok((
        tail_event_replay(events.into_values().collect(), limit),
        stored_through_seq,
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn quiet_room_tail_survives_more_than_a_global_scan_window() {
        let path = std::env::temp_dir().join(format!(
            "cosyworld-v2-room-replay-{}-{}.sqlite",
            std::process::id(),
            now_seed()
        ));
        let _ = fs::remove_file(&path);
        let events = (1..=MAX_EVENT_STORE_SCAN as u64 + 2)
            .map(|seq| EventView {
                seq,
                type_name: "message.created".to_string(),
                success: true,
                location_id: Some(if seq == 1 { 12 } else { 1 }),
                content: Some(format!("event {seq}")),
                ..EventView::default()
            })
            .collect::<Vec<_>>();
        append_event_store(&path, &events).expect("persist interleaved room events");

        let (replay, stored_through_seq) =
            read_event_store_tail_for_locations(&path, &BTreeSet::from([12]), 1002, 80)
                .expect("read quiet room tail");

        assert_eq!(
            replay.iter().map(|event| event.seq).collect::<Vec<_>>(),
            [1]
        );
        let response = event_replay_response(replay, None, 1002, 80, &BTreeSet::from([12]));
        assert_eq!(response.next_after, 1002);
        assert!(response.caught_up);
        assert_eq!(stored_through_seq, 1002);
        assert!(INDEX_HTML
            .contains("streamReplayFloorSeq = Math.max(streamReplayFloorSeq, replay.next_after)"));
        let _ = fs::remove_file(path);
    }

    #[test]
    fn legacy_event_locations_are_backfilled_for_room_replay() {
        let path = std::env::temp_dir().join(format!(
            "cosyworld-v2-room-replay-migration-{}-{}.sqlite",
            std::process::id(),
            now_seed()
        ));
        let event = EventView {
            seq: 42,
            type_name: "message.created".to_string(),
            success: true,
            location_id: Some(12),
            content: Some("remember me".to_string()),
            ..EventView::default()
        };
        let conn = Connection::open(&path).expect("create legacy event store");
        conn.execute_batch(
            "CREATE TABLE world_events (
                seq INTEGER PRIMARY KEY,
                event_type TEXT NOT NULL,
                payload_json TEXT NOT NULL,
                created_at_ms INTEGER NOT NULL
             );",
        )
        .unwrap();
        conn.execute(
            "INSERT INTO world_events (seq, event_type, payload_json, created_at_ms)
             VALUES (?1, ?2, ?3, 1)",
            params![
                event.seq as i64,
                event.type_name,
                serde_json::to_string(&event).unwrap()
            ],
        )
        .unwrap();
        drop(conn);

        let (replay, stored_through_seq) =
            read_event_store_tail_for_locations(&path, &BTreeSet::from([12]), 42, 80)
                .expect("migrate and read quiet room tail");

        assert_eq!(replay.len(), 1);
        assert_eq!(replay[0].content.as_deref(), Some("remember me"));
        assert_eq!(stored_through_seq, 42);
        let _ = fs::remove_file(path);
    }

    #[test]
    fn large_visible_location_sets_return_one_global_tail_across_query_chunks() {
        let path = std::env::temp_dir().join(format!(
            "cosyworld-v2-room-replay-many-locations-{}-{}.sqlite",
            std::process::id(),
            now_seed()
        ));
        let _ = fs::remove_file(&path);
        let visible_locations = (1..=605).collect::<BTreeSet<_>>();
        let mut events = (1..=25_000)
            .map(|seq| EventView {
                seq,
                type_name: "message.created".to_string(),
                success: true,
                location_id: Some(((seq - 1) % 605) + 1),
                content: Some(format!("event {seq}")),
                ..EventView::default()
            })
            .collect::<Vec<_>>();
        events.push(EventView {
            seq: 25_001,
            type_name: "actor.moved".to_string(),
            success: true,
            location_id: Some(1),
            destination_location_id: Some(605),
            content: Some("crosses the query chunk boundary".to_string()),
            ..EventView::default()
        });
        append_event_store(&path, &events).expect("persist events across many rooms");

        let started = std::time::Instant::now();
        let (replay, stored_through_seq) =
            read_event_store_tail_for_locations(&path, &visible_locations, 25_001, 80)
                .expect("read one bounded global tail");
        let elapsed = started.elapsed();

        assert_eq!(replay.len(), 80);
        assert_eq!(replay.first().map(|event| event.seq), Some(24_922));
        assert_eq!(replay.last().map(|event| event.seq), Some(25_001));
        assert_eq!(
            replay.iter().filter(|event| event.seq == 25_001).count(),
            1,
            "an event visible through both location columns remains unique"
        );
        assert_eq!(stored_through_seq, 25_001);
        assert!(
            elapsed < std::time::Duration::from_secs(2),
            "a 605-location replay tail took {elapsed:?}"
        );
        let _ = fs::remove_file(path);
    }
}
