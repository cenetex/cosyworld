use super::*;
use rusqlite::{Connection, TransactionBehavior};
use std::{sync::mpsc, time::Duration};
use tokio::sync::oneshot;

struct Database(Arc<PathBuf>);
impl Database {
    fn new() -> Self {
        let path =
            std::env::temp_dir().join(format!("shared-admission-{}.sqlite", crate::random_hex(12)));
        let c = Connection::open(&path).unwrap();
        c.execute_batch("PRAGMA journal_mode=WAL; CREATE TABLE commits(value INTEGER);")
            .unwrap();
        Self(Arc::new(path))
    }
    fn key(&self) -> Key {
        Some(self.0.clone())
    }
    fn values(&self) -> Vec<i64> {
        let c = Connection::open(self.0.as_ref()).unwrap();
        let mut statement = c
            .prepare("SELECT value FROM commits ORDER BY rowid")
            .unwrap();
        let values = statement
            .query_map([], |row| row.get(0))
            .unwrap()
            .collect::<rusqlite::Result<_>>()
            .unwrap();
        values
    }
}
impl Drop for Database {
    fn drop(&mut self) {
        let _ = std::fs::remove_file(self.0.as_ref());
        for suffix in ["-wal", "-shm"] {
            let _ = std::fs::remove_file(format!("{}{suffix}", self.0.display()));
        }
    }
}
fn write(
    path: Arc<PathBuf>,
    value: i64,
    entered: Option<oneshot::Sender<()>>,
    release: Option<mpsc::Receiver<()>>,
) -> Result<()> {
    let mut c = Connection::open(path.as_ref()).map_err(|e| e.to_string())?;
    c.busy_timeout(Duration::ZERO).map_err(|e| e.to_string())?;
    let tx = c
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(|e| e.to_string())?;
    tx.execute("INSERT INTO commits(value) VALUES(?)", [value])
        .map_err(|e| e.to_string())?;
    if let Some(entered) = entered {
        entered.send(()).unwrap();
    }
    if let Some(release) = release {
        release
            .recv_timeout(Duration::from_secs(5))
            .map_err(|e| e.to_string())?;
    }
    tx.commit().map_err(|e| e.to_string())
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn shared_database_waits_for_the_current_writer_before_opening_sqlite() {
    let db = Database::new();
    let (entered, ready) = oneshot::channel();
    let (release, held) = mpsc::channel();
    let path = db.0.clone();
    let first = tokio::spawn(blocking(db.key(), move || {
        write(path, 1, Some(entered), Some(held))
    }));
    ready.await.unwrap();
    let path = db.0.clone();
    let mut second = tokio::spawn(blocking(db.key(), move || write(path, 2, None, None)));
    let waiting = tokio::time::timeout(Duration::from_millis(100), &mut second).await;
    release.send(()).unwrap();
    first.await.unwrap().unwrap();
    assert!(waiting.is_err(), "The second writer waits outside SQLite.");
    second.await.unwrap().unwrap();
    assert_eq!(db.values(), [1, 2]);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn shared_database_keeps_a_running_transaction_guarded_after_request_cancellation() {
    let db = Database::new();
    let (entered, ready) = oneshot::channel();
    let (release, held) = mpsc::channel();
    let path = db.0.clone();
    let first = tokio::spawn(blocking(db.key(), move || {
        write(path, 1, Some(entered), Some(held))
    }));
    ready.await.unwrap();
    first.abort();
    assert!(first.await.unwrap_err().is_cancelled());
    let path = db.0.clone();
    let mut second = tokio::spawn(blocking(db.key(), move || write(path, 2, None, None)));
    let waiting = tokio::time::timeout(Duration::from_millis(100), &mut second).await;
    release.send(()).unwrap();
    assert!(waiting.is_err(), "The running transaction keeps its place.");
    second.await.unwrap().unwrap();
    assert_eq!(db.values(), [1, 2]);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn shared_database_admission_allows_another_database_to_progress() {
    let first_db = Database::new();
    let other_db = Database::new();
    let (entered, ready) = oneshot::channel();
    let (release, held) = mpsc::channel();
    let path = first_db.0.clone();
    let first = tokio::spawn(blocking(first_db.key(), move || {
        write(path, 1, Some(entered), Some(held))
    }));
    ready.await.unwrap();
    let path = other_db.0.clone();
    let other = tokio::time::timeout(
        Duration::from_secs(1),
        blocking(other_db.key(), move || write(path, 2, None, None)),
    )
    .await;
    release.send(()).unwrap();
    first.await.unwrap().unwrap();
    other.unwrap().unwrap();
    assert_eq!(first_db.values(), [1]);
    assert_eq!(other_db.values(), [2]);
}
