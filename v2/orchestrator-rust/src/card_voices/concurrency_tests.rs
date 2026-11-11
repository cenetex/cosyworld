use super::*;
use flights::Flights;
use std::{future::Future, path::PathBuf, sync::Arc};
use tokio::{
    sync::{mpsc, oneshot},
    task::JoinHandle,
};

async fn bounded<T>(future: impl Future<Output = T>) -> T {
    tokio::time::timeout(Duration::from_secs(5), future)
        .await
        .expect("voice test did not reach its barrier")
}

struct Harness {
    path: PathBuf,
    config: AiConfig,
    arrivals: mpsc::UnboundedReceiver<oneshot::Sender<Response>>,
    server: JoinHandle<()>,
}

impl Harness {
    async fn new() -> Self {
        let path = std::env::temp_dir().join(format!(
            "cosyworld-voice-race-{}.sqlite",
            crate::random_hex(8)
        ));
        let c = crate::canonical_journal::open_event_store(&path).unwrap();
        c.execute_batch(
            "CREATE TABLE card_members(world TEXT, actor INTEGER, user TEXT, seen INTEGER);
             CREATE TABLE card_bindings(world TEXT, actor INTEGER, user TEXT);
             INSERT INTO card_members VALUES ('w1', 0, 'u1', 0);
             INSERT INTO card_bindings VALUES ('w1', 1, 'u2');",
        )
        .unwrap();
        authority::seed(&c, "Again?");
        let (send, arrivals) = mpsc::unbounded_channel();
        let app = Router::new().route(
            "/audio/speech",
            // Consume the upload before releasing the response barrier. The
            // speech body includes audio references; an early response can reset
            // a client that is still writing it, rather than exercise our gate.
            post(move |Json(_body): Json<Value>| {
                let send = send.clone();
                async move {
                    let (reply, receive) = oneshot::channel();
                    send.send(reply).unwrap();
                    receive
                        .await
                        .unwrap_or_else(|_| StatusCode::SERVICE_UNAVAILABLE.into_response())
                }
            }),
        );
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let config = AiConfig {
            api_key: "test-secret".into(),
            base_url: format!("http://{}", listener.local_addr().unwrap()),
            ..AiConfig::default()
        };
        let server = tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
        Self {
            path,
            config,
            arrivals,
            server,
        }
    }

    fn start(
        &self,
        flights: &Arc<Flights>,
        user: &str,
        index: usize,
    ) -> JoinHandle<Result<Vec<u8>, Failure>> {
        let (path, config, flights, user) = (
            self.path.clone(),
            self.config.clone(),
            flights.clone(),
            user.to_owned(),
        );
        tokio::spawn(async move {
            let line = Line {
                world: Some("w1".into()),
                play: Some("play-1".into()),
                line: Some(index),
                ..Default::default()
            };
            speak_with_flights(&path, &config, &user, &line, &flights).await
        })
    }

    async fn next(&mut self) -> oneshot::Sender<Response> {
        bounded(self.arrivals.recv()).await.unwrap()
    }

    fn id(index: usize) -> String {
        clip_id(
            &serde_json::from_str(VOICES).unwrap(),
            "vale",
            if index == 0 { "Hello." } else { "Again?" },
        )
    }

    async fn waiter(&self, flights: &Flights, index: usize) {
        let gate = flights.gate(&self.path, "w1", &Self::id(index)).unwrap();
        // This probe, the provider owner, and the blocked request each hold
        // one reference. Wait for the follower to reach the actual keyed gate.
        bounded(async {
            while Arc::strong_count(&gate) < 3 {
                tokio::task::yield_now().await;
            }
        })
        .await;
    }

    fn kept(&self, index: usize) -> Option<Vec<u8>> {
        let c = crate::canonical_journal::open_event_store(&self.path).unwrap();
        clips::clip(&c, "w1", &Self::id(index)).unwrap()
    }
}

impl Drop for Harness {
    fn drop(&mut self) {
        self.server.abort();
        let _ = std::fs::remove_file(&self.path);
    }
}

fn audio(take: u8) -> Response {
    (
        [(header::CONTENT_TYPE, "audio/mpeg")],
        vec![255u8, 251, take],
    )
        .into_response()
}

#[tokio::test]
async fn concurrent_shared_misses_return_the_durable_winner() {
    let mut h = Harness::new().await;
    // Separate registries model two processes sharing the durable store.
    let first = h.start(&Arc::new(Flights::default()), "u1", 0);
    let second = h.start(&Arc::new(Flights::default()), "u2", 0);
    let a = h.next().await;
    let b = h.next().await;
    // Both providers must arrive before either can persist, just as in the
    // baseline reproduction. Return distinct audio to expose a losing response.
    a.send(audio(0)).unwrap();
    b.send(audio(1)).unwrap();
    let first = bounded(first).await.unwrap().unwrap();
    let second = bounded(second).await.unwrap().unwrap();
    assert_eq!(
        first, second,
        "concurrent listeners must hear the same committed clip"
    );
    assert_eq!(
        Some(first),
        h.kept(0),
        "responses must be the durable winner"
    );
}

#[tokio::test]
async fn one_process_coalesces_misses_without_blocking_other_lines() {
    let mut h = Harness::new().await;
    let flights = Arc::new(Flights::default());
    let first = h.start(&flights, "u1", 0);
    let a = h.next().await;
    let second = h.start(&flights, "u2", 0);
    h.waiter(&flights, 0).await;
    assert!(
        h.arrivals.try_recv().is_err(),
        "the follower must not synthesize"
    );
    let other = h.start(&flights, "u1", 1);
    h.next().await.send(audio(2)).unwrap();
    assert_eq!(bounded(other).await.unwrap().unwrap(), vec![255, 251, 2]);
    a.send(audio(0)).unwrap();
    let first = bounded(first).await.unwrap().unwrap();
    assert_eq!(bounded(second).await.unwrap().unwrap(), first);
    assert_eq!(Some(first), h.kept(0));
    assert!(h.arrivals.try_recv().is_err());
}

#[tokio::test]
async fn failures_and_cancellation_release_waiters_for_retry() {
    let mut h = Harness::new().await;
    let flights = Arc::new(Flights::default());
    for index in 0..2 {
        let first = h.start(&flights, "u1", index);
        let a = h.next().await;
        let second = h.start(&flights, "u2", index);
        h.waiter(&flights, index).await;
        if index == 0 {
            a.send(StatusCode::SERVICE_UNAVAILABLE.into_response())
                .unwrap();
            assert!(matches!(
                bounded(first).await.unwrap(),
                Err(Failure::Provider(_))
            ));
        } else {
            first.abort();
            assert!(bounded(first).await.unwrap_err().is_cancelled());
            drop(a);
        }
        let retry = h.next().await;
        assert!(
            h.kept(index).is_none(),
            "failed work cannot populate the cache"
        );
        retry.send(audio(3)).unwrap();
        assert_eq!(bounded(second).await.unwrap().unwrap(), vec![255, 251, 3]);
        assert_eq!(
            bounded(h.start(&flights, "u1", index))
                .await
                .unwrap()
                .unwrap(),
            vec![255, 251, 3]
        );
        assert!(
            h.arrivals.try_recv().is_err(),
            "retry success must be cached"
        );
    }
}

#[tokio::test]
async fn a_store_failure_does_not_publish_or_poison_the_flight() {
    let mut h = Harness::new().await;
    let flights = Arc::new(Flights::default());
    let c = crate::canonical_journal::open_event_store(&h.path).unwrap();
    assert!(h.kept(0).is_none());
    c.execute_batch(
        "CREATE TRIGGER fail_clip AFTER INSERT ON card_voice_clips
        BEGIN SELECT RAISE(ABORT, 'injected voice write failure'); END;",
    )
    .unwrap();
    let first = h.start(&flights, "u1", 0);
    h.next().await.send(audio(4)).unwrap();
    assert!(matches!(
        bounded(first).await.unwrap(),
        Err(Failure::Store(_))
    ));
    assert!(h.kept(0).is_none());
    c.execute_batch("DROP TRIGGER fail_clip;").unwrap();
    let retry = h.start(&flights, "u2", 0);
    h.next().await.send(audio(5)).unwrap();
    assert_eq!(bounded(retry).await.unwrap().unwrap(), vec![255, 251, 5]);
    assert_eq!(h.kept(0), Some(vec![255, 251, 5]));
}
