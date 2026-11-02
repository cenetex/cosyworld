use super::*;
use std::path::PathBuf;
use tokio::sync::{mpsc, oneshot};

type Replies = mpsc::UnboundedReceiver<oneshot::Sender<bool>>;

async fn controlled() -> (AiConfig, Replies) {
    let (send, replies) = mpsc::unbounded_channel();
    let app = Router::new().route(
        "/audio/speech",
        post(move || {
            let send = send.clone();
            async move {
                let (reply, wait) = oneshot::channel();
                send.send(reply).unwrap();
                if wait.await.unwrap() {
                    vec![255u8, 251, 144].into_response()
                } else {
                    StatusCode::SERVICE_UNAVAILABLE.into_response()
                }
            }
        }),
    );
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let base_url = format!("http://{}", listener.local_addr().unwrap());
    tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
    let config = AiConfig {
        base_url,
        ..AiConfig::default()
    };
    (config, replies)
}

async fn next(replies: &mut Replies) -> oneshot::Sender<bool> {
    tokio::time::timeout(Duration::from_secs(3), replies.recv())
        .await
        .unwrap()
        .unwrap()
}

fn fixture(shared: bool) -> PathBuf {
    let path =
        std::env::temp_dir().join(format!("voice-accounting-{}.sqlite", crate::random_hex(8)));
    let mut c = credits::open(&path).unwrap();
    credits::grant(&mut c, "u1", 4, "pack", "test").unwrap();
    if shared {
        c.execute_batch(
            "CREATE TABLE card_members(world TEXT, actor INTEGER, user TEXT);
            CREATE TABLE card_bindings(world TEXT, actor INTEGER, user TEXT);
            INSERT INTO card_members VALUES ('w1',0,'u1'),('w1',1,'u2');",
        )
        .unwrap();
        credits::pool::commit(&mut c, "u1", "w1", 4, "pool").unwrap();
        authority::seed(&c, "New line.");
    }
    path
}

fn call(
    path: &Path,
    config: &AiConfig,
    shared: bool,
    user: &str,
    text: &str,
) -> tokio::task::JoinHandle<Result<Vec<u8>, Failure>> {
    let (path, config, user) = (path.to_owned(), config.clone(), user.to_owned());
    let mut line = Line {
        speaker: "vale".into(),
        text: text.into(),
        ..Line::default()
    };
    line.world = shared.then(|| "w1".into());
    line.play = shared.then(|| "play-1".into());
    line.line = shared.then(|| usize::from(text == "New line."));
    tokio::spawn(async move { speak(&path, &config, &user, &line).await })
}

fn ledger(path: &Path, shared: bool) -> (i64, i64, i64, i64) {
    let c = credits::open(path).unwrap();
    let balance = credits::balance(&c, Payer::of(if shared { "w1" } else { "" }, "u1")).unwrap();
    if shared {
        assert_eq!(credits::balance(&c, "u1").unwrap(), 0);
        assert_eq!(credits::balance(&c, "u2").unwrap(), 0);
    }
    let (spent, refunded, completed) = c
        .query_row(
            "SELECT SUM(kind='spend'),SUM(kind='refund'),
            (SELECT SUM(completed) FROM credit_speech_attempts)
        FROM credit_events WHERE spend_kind='tts'",
            [],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
        )
        .unwrap();
    (balance, spent, refunded, completed)
}

#[tokio::test]
async fn failed_replays_keep_completed_purchases_and_new_failures_refund_once() {
    for shared in [false, true] {
        let path = fixture(shared);
        let (config, mut replies) = controlled().await;
        let first = call(&path, &config, shared, "u1", "Hello.");
        next(&mut replies).await.send(true).unwrap();
        assert!(first.await.unwrap().is_ok());
        if shared {
            // Force the same cache miss that eviction or a lost derived cache produces.
            credits::open(&path)
                .unwrap()
                .execute("DELETE FROM credit_world_clips", [])
                .unwrap();
        }
        let user = if shared { "u2" } else { "u1" };
        let replay = call(&path, &config, shared, user, "Hello.");
        next(&mut replies).await.send(false).unwrap();
        assert!(matches!(replay.await.unwrap(), Err(Failure::Provider(_))));
        assert_eq!(ledger(&path, shared), (3, 1, 0, 1));
        // Purchases from before attempt receipts remain paid too.
        let c = credits::open(&path).unwrap();
        c.execute("DELETE FROM credit_speech_attempts", []).unwrap();
        let legacy = call(&path, &config, shared, user, "Hello.");
        next(&mut replies).await.send(false).unwrap();
        assert!(matches!(legacy.await.unwrap(), Err(Failure::Provider(_))));
        assert_eq!(ledger(&path, shared), (3, 1, 0, 0));
        for n in 1..=2 {
            let failed = call(&path, &config, shared, user, "New line.");
            next(&mut replies).await.send(false).unwrap();
            assert!(matches!(failed.await.unwrap(), Err(Failure::Provider(_))));
            assert_eq!(ledger(&path, shared), (3, n + 1, n, 0));
        }
    }
}

#[tokio::test]
async fn an_original_failure_cannot_refund_the_waiters_success() {
    for shared in [false, true] {
        let path = fixture(shared);
        let (config, mut replies) = controlled().await;
        let first = call(&path, &config, shared, "u1", "Hello.");
        let original = next(&mut replies).await;
        let user = if shared { "u2" } else { "u1" };
        let second = call(&path, &config, shared, user, "Hello.");
        assert!(
            tokio::time::timeout(Duration::from_millis(100), replies.recv())
                .await
                .is_err()
        );
        original.send(false).unwrap();
        assert!(matches!(first.await.unwrap(), Err(Failure::Provider(_))));
        next(&mut replies).await.send(true).unwrap();
        assert!(second.await.unwrap().is_ok());
        assert_eq!(ledger(&path, shared), (3, 2, 1, 1));
    }
}

#[tokio::test]
async fn expired_owners_cannot_publish_audio_or_refund_the_replacements_purchase() {
    for shared in [false, true] {
        for old_succeeds in [false, true] {
            let path = fixture(shared);
            let (config, mut replies) = controlled().await;
            let first = call(&path, &config, shared, "u1", "Hello.");
            let original = next(&mut replies).await;
            // A separate connection recovers the expired owner, as after a restart.
            credits::open(&path)
                .unwrap()
                .execute("UPDATE credit_speech_attempts SET until_at=0", [])
                .unwrap();
            let user = if shared { "u2" } else { "u1" };
            let second = call(&path, &config, shared, user, "Hello.");
            next(&mut replies).await.send(!old_succeeds).unwrap();
            assert_eq!(second.await.unwrap().is_ok(), !old_succeeds);
            original.send(old_succeeds).unwrap();
            assert!(matches!(first.await.unwrap(), Err(Failure::Store(_))));
            let expected = if old_succeeds {
                (4, 2, 2, 0)
            } else {
                (3, 2, 1, 1)
            };
            assert_eq!(ledger(&path, shared), expected);
        }
    }
}
