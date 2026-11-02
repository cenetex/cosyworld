//! Private reflections (thought, persona, dream) after a spoken scene.
//!
//! The browser asks for them once its line is shown, so they never delay or
//! fail the line (#2016). They have their own capacity and one request per
//! client, and a client's next admitted scene drops its unfinished one.
use super::*;

pub(super) struct Queue {
    /// The client whose admitted scene replaces its queued reflections.
    pub cancel: tokio::sync::watch::Sender<Option<IpAddr>>,
    capacity: Arc<Semaphore>,
    in_flight: Arc<InFlight>,
}

impl Queue {
    pub(super) fn new(capacity: usize) -> Self {
        Self {
            cancel: tokio::sync::watch::channel(None).0,
            capacity: Arc::new(Semaphore::new(capacity.max(1))),
            in_flight: Arc::new(InFlight::default()),
        }
    }
}

/// Resolves when `client` starts a newer admitted scene.
async fn replaced(mut cancel: tokio::sync::watch::Receiver<Option<IpAddr>>, client: IpAddr) {
    loop {
        if cancel.changed().await.is_err() {
            return std::future::pending().await;
        }
        if *cancel.borrow_and_update() == Some(client) {
            return;
        }
    }
}

pub(super) async fn generate(
    State(state): State<TextState>,
    ConnectInfo(peer): ConnectInfo<SocketAddr>,
    headers: HeaderMap,
    Json(context): Json<Context>,
) -> Response {
    let Ok(settings) = state.settings.as_ref() else {
        return StatusCode::SERVICE_UNAVAILABLE.into_response();
    };
    let Some(context) = (same_origin(&headers) && valid(&context))
        .then(|| super::untrusted::trusted(context))
        .flatten()
    else {
        return StatusCode::BAD_REQUEST.into_response();
    };
    let (Some(config), Ok(models)) = (state.ai.as_ref(), state.character_models.as_ref()) else {
        return StatusCode::SERVICE_UNAVAILABLE.into_response();
    };
    // Most scenes have no one due: answer at once, without spending the
    // client's story budget.
    if !voiced(&context)
        .iter()
        .any(|id| reflection_due(&context, entity(&context, id)).0)
    {
        return Json(json!({"type":"complete","revision":context.revision,"reflections":[]}))
            .into_response();
    }
    let client = peer.ip();
    let Some(slot) = state.background.in_flight.try_enter(client, 1) else {
        return StatusCode::TOO_MANY_REQUESTS.into_response();
    };
    let Ok(mut limits) = state.limits.lock() else {
        return StatusCode::SERVICE_UNAVAILABLE.into_response();
    };
    if !admit(&mut limits, client, Instant::now()) {
        return StatusCode::TOO_MANY_REQUESTS.into_response();
    }
    drop(limits);
    let Ok(permit) = state.background.capacity.clone().try_acquire_owned() else {
        return StatusCode::TOO_MANY_REQUESTS.into_response();
    };
    let cancelled = replaced(state.background.cancel.subscribe(), client);
    let config = config.clone();
    let models = models.clone();
    let settings = settings.clone();
    let (sender, receiver) = mpsc::channel(1);
    tokio::spawn(async move {
        tokio::select! {
            _ = sender.closed() => {},
            _ = cancelled => {},
            mut value = complete(&config, &context, &models, &settings) => {
                super::untrusted::sign_reflections(&mut value, &context);
                let _ = sender.send(Event::default().data(value.to_string())).await;
            }
        }
        // Free the client's slot before its stream ends, so a reply in hand
        // never meets a busy slot on the next scene.
        drop((permit, slot));
        drop(sender);
    });
    Sse::new(
        tokio_stream::wrappers::ReceiverStream::new(receiver)
            .map(Ok::<_, std::convert::Infallible>),
    )
    .into_response()
}

async fn complete(
    config: &AiConfig,
    context: &Context,
    models: &BTreeMap<String, String>,
    settings: &VoiceSettings,
) -> Value {
    let deadline = tokio::time::Instant::now() + settings.scene_timeout;
    let mut entries = Vec::new();
    for id in voiced(context) {
        if let Some(reflection) =
            reflection::generate(config, context, models, settings, deadline, &id).await
        {
            entries.push(json!({"id":id,"reflection":reflection}));
        }
    }
    json!({"type":"complete","revision":context.revision,"reflections":entries})
}

/// A shared scene's reflections, generated after its line is journaled. Only
/// the voices that spoke and are due one are asked; the rest return nothing,
/// with no model call. The world journals them in a later `reflect` op.
pub(crate) async fn shared(
    config: &AiConfig,
    scene: &Value,
    actor: &str,
    spoke: &[String],
    models: &BTreeMap<String, String>,
) -> Vec<Value> {
    let Ok((context, settings)) = super::shared_scene(scene, actor, spoke) else {
        return Vec::new();
    };
    let deadline = tokio::time::Instant::now() + settings.scene_timeout;
    let mut entries = Vec::new();
    for id in spoke {
        if !reflection_due(&context, entity(&context, id)).0 {
            continue;
        }
        if let Some(reflection) =
            reflection::generate(config, &context, models, &settings, deadline, id).await
        {
            entries.push(json!({"id":id,"reflection":reflection}));
        }
    }
    entries
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::body::Body;
    use tower::ServiceExt;

    #[tokio::test]
    async fn private_route_serves_both_profiles_behind_the_scene_guard() {
        for settings in [VoiceSettings::hosted(), VoiceSettings::local()] {
            let mut c = super::super::tests::context();
            c.location = "unknown-room".into();
            let mut request = axum::http::Request::builder()
                .uri("/card-game/reflections")
                .method("POST")
                .header("Content-Type", "application/json")
                .body(Body::from(serde_json::to_vec(&c).unwrap()))
                .unwrap();
            request
                .extensions_mut()
                .insert(ConnectInfo("127.0.0.1:1234".parse::<SocketAddr>().unwrap()));
            let response = router_with_models(Arc::new(None), Ok(BTreeMap::new()), Ok(settings))
                .oneshot(request)
                .await
                .unwrap();
            assert_eq!(response.status(), StatusCode::BAD_REQUEST);
        }
    }

    #[tokio::test]
    async fn spoken_scenes_skip_thoughts_until_the_private_request() {
        let seen = Arc::new(Mutex::new(Vec::new()));
        let provider =
            super::super::tests::plain_provider(seen.clone(), |_, _| "I hear you.".into());
        let (address, server) = super::super::tests::serve(provider).await;
        let mut c = super::super::tests::context();
        c.entities[0].memories.push(Memory {
            signed: None,
            seq: Some(1),
            turn: 1,
            kind: "event".into(),
            text: "A friend visited.".into(),
        });
        super::super::tests::resting(&mut c);
        let config = super::super::tests::test_config(address);
        for settings in [VoiceSettings::hosted(), VoiceSettings::local()] {
            seen.lock().unwrap().clear();
            let spoken = super::super::complete(&config, &c, &BTreeMap::new(), &settings, None)
                .await
                .unwrap();
            assert!(spoken["entries"]
                .as_array()
                .unwrap()
                .iter()
                .all(|e| e.get("reflection").is_none()));
            let requests = seen.lock().unwrap().len();
            assert!(requests <= voiced(&c).len() * 2);
            let result = complete(&config, &c, &BTreeMap::new(), &settings).await;
            assert!(seen.lock().unwrap().len() > requests);
            assert!(result.get("reflections").is_some());
        }
        // Only the same client's newer scene drops its private future.
        let queue = Queue::new(2);
        let (mine, other): (IpAddr, IpAddr) =
            ("127.0.0.1".parse().unwrap(), "127.0.0.2".parse().unwrap());
        let waiting = tokio::spawn(replaced(queue.cancel.subscribe(), mine));
        queue.cancel.send_replace(Some(other));
        tokio::task::yield_now().await;
        assert!(!waiting.is_finished());
        queue.cancel.send_replace(Some(mine));
        tokio::time::timeout(Duration::from_secs(1), waiting)
            .await
            .unwrap()
            .unwrap();
        server.abort();
    }
}
