use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};

use crate::types::{Action, KernelStatus, ProjectionMutation, WorldEvent};

pub const JOURNAL_RECORD_VERSION: u32 = 1;

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct JournalRecord {
    pub version: u32,
    pub seq: u64,
    pub action: Action,
    pub seed: u64,
    pub advance_tick: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub turn_room: Option<u64>,
    #[serde(default)]
    pub mutations: Vec<ProjectionMutation>,
    pub status: KernelStatus,
    #[serde(default)]
    pub events: Vec<WorldEvent>,
}

#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct JournalHealth {
    pub consecutive_failures: u32,
    pub last_error: Option<String>,
}

impl JournalHealth {
    pub fn status(&self) -> &'static str {
        if self.consecutive_failures > 0 {
            "degraded"
        } else if self.last_error.is_some() {
            "recovering"
        } else {
            "healthy"
        }
    }

    fn record_success(&mut self) {
        self.consecutive_failures = 0;
    }

    fn record_failure(&mut self, error: &str) {
        self.consecutive_failures = self.consecutive_failures.saturating_add(1);
        self.last_error = Some(error.to_string());
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum JournalError {
    Io(String),
    Corrupt(String),
}

impl std::fmt::Display for JournalError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            JournalError::Io(e) => write!(f, "journal io: {e}"),
            JournalError::Corrupt(e) => write!(f, "journal corrupt: {e}"),
        }
    }
}

impl std::error::Error for JournalError {}

pub trait Journal: Send {
    fn append(&mut self, record: &JournalRecord) -> Result<u64, JournalError>;
    fn read_from(&self, after_seq: u64, limit: usize) -> Result<Vec<JournalRecord>, JournalError>;
    fn latest_seq(&self) -> Result<u64, JournalError>;
    fn health(&self) -> JournalHealth;
}

pub struct SqliteJournal {
    conn: Connection,
    health: JournalHealth,
}

impl SqliteJournal {
    pub fn open(path: &std::path::Path) -> Result<Self, JournalError> {
        let conn = Connection::open(path).map_err(|e| JournalError::Io(e.to_string()))?;
        Self::init(conn)
    }

    pub fn in_memory() -> Result<Self, JournalError> {
        let conn = Connection::open_in_memory().map_err(|e| JournalError::Io(e.to_string()))?;
        Self::init(conn)
    }

    fn init(conn: Connection) -> Result<Self, JournalError> {
        conn.execute_batch(
            "PRAGMA journal_mode = WAL;
             CREATE TABLE IF NOT EXISTS spine_journal (
               seq INTEGER PRIMARY KEY,
               version INTEGER NOT NULL,
               record TEXT NOT NULL
             );",
        )
        .map_err(|e| JournalError::Io(e.to_string()))?;
        Ok(Self {
            conn,
            health: JournalHealth::default(),
        })
    }
}

impl Journal for SqliteJournal {
    fn append(&mut self, record: &JournalRecord) -> Result<u64, JournalError> {
        let body =
            serde_json::to_string(record).map_err(|e| JournalError::Corrupt(e.to_string()))?;
        let result = self.conn.execute(
            "INSERT INTO spine_journal (seq, version, record) VALUES (?1, ?2, ?3)",
            params![record.seq, record.version, body],
        );
        match result {
            Ok(_) => {
                self.health.record_success();
                Ok(record.seq)
            }
            Err(e) => {
                self.health.record_failure(&e.to_string());
                Err(JournalError::Io(e.to_string()))
            }
        }
    }

    fn read_from(&self, after_seq: u64, limit: usize) -> Result<Vec<JournalRecord>, JournalError> {
        let mut stmt = self
            .conn
            .prepare("SELECT record FROM spine_journal WHERE seq > ?1 ORDER BY seq ASC LIMIT ?2")
            .map_err(|e| JournalError::Io(e.to_string()))?;
        let rows = stmt
            .query_map(params![after_seq, limit as i64], |row| {
                row.get::<_, String>(0)
            })
            .map_err(|e| JournalError::Io(e.to_string()))?;
        let mut records = Vec::new();
        for row in rows {
            let body = row.map_err(|e| JournalError::Io(e.to_string()))?;
            let record: JournalRecord =
                serde_json::from_str(&body).map_err(|e| JournalError::Corrupt(e.to_string()))?;
            if record.version != JOURNAL_RECORD_VERSION {
                return Err(JournalError::Corrupt(format!(
                    "record {} has version {}, expected {}",
                    record.seq, record.version, JOURNAL_RECORD_VERSION
                )));
            }
            records.push(record);
        }
        Ok(records)
    }

    fn latest_seq(&self) -> Result<u64, JournalError> {
        self.conn
            .query_row("SELECT MAX(seq) FROM spine_journal", [], |row| {
                row.get::<_, Option<u64>>(0)
            })
            .optional()
            .map(|opt| opt.flatten().unwrap_or(0))
            .map_err(|e| JournalError::Io(e.to_string()))
    }

    fn health(&self) -> JournalHealth {
        self.health.clone()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::types::ActionKind;

    fn record(seq: u64) -> JournalRecord {
        JournalRecord {
            version: JOURNAL_RECORD_VERSION,
            seq,
            action: Action {
                actor_id: 7,
                kind: ActionKind::Pass,
            },
            seed: 42,
            advance_tick: true,
            turn_room: None,
            mutations: Vec::new(),
            status: KernelStatus::Ok,
            events: Vec::new(),
        }
    }

    #[test]
    fn append_and_read_in_order() {
        let mut journal = SqliteJournal::in_memory().unwrap();
        journal.append(&record(1)).unwrap();
        journal.append(&record(2)).unwrap();
        assert_eq!(journal.latest_seq().unwrap(), 2);
        let all = journal.read_from(0, 100).unwrap();
        assert_eq!(all.len(), 2);
        assert_eq!(all[0].seed, 42);
        let tail = journal.read_from(1, 100).unwrap();
        assert_eq!(tail.len(), 1);
        assert_eq!(tail[0].seq, 2);
        assert_eq!(journal.health().status(), "healthy");
    }

    #[test]
    fn duplicate_seq_is_an_append_failure() {
        let mut journal = SqliteJournal::in_memory().unwrap();
        journal.append(&record(1)).unwrap();
        let err = journal.append(&record(1)).unwrap_err();
        assert!(matches!(err, JournalError::Io(_)));
        assert_eq!(journal.health().status(), "degraded");
        assert_eq!(journal.read_from(0, 10).unwrap().len(), 1);
    }
}
