//! Local thoughts yield to the next spoken scene.
use super::*;

pub(super) struct Queue {
    pub cancel: tokio::sync::watch::Sender<u64>,
    capacity: Arc<Semaphore>,
}

impl Default for Queue {
    fn default() -> Self {
        Self {
            cancel: tokio::sync::watch::channel(0).0,
            capacity: Arc::new(Semaphore::new(1)),
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
    if !settings.defer_reflections {
        return StatusCode::NOT_FOUND.into_response();
    }
    if !same_origin(&headers) || !valid(&context) {
        return StatusCode::BAD_REQUEST.into_response();
    }
    let (Some(config), Ok(models)) = (state.ai.as_ref(), state.character_models.as_ref()) else {
        return StatusCode::SERVICE_UNAVAILABLE.into_response();
    };
    let Ok(mut limits) = state.limits.lock() else {
        return StatusCode::SERVICE_UNAVAILABLE.into_response();
    };
    if !admit(&mut limits, peer.ip(), Instant::now()) {
        return StatusCode::TOO_MANY_REQUESTS.into_response();
    }
    drop(limits);
    let Ok(permit) = state.background.capacity.clone().try_acquire_owned() else {
        return StatusCode::TOO_MANY_REQUESTS.into_response();
    };
    let mut cancelled = state.background.cancel.subscribe();
    let config = config.clone();
    let models = models.clone();
    let settings = settings.clone();
    let (sender, receiver) = mpsc::channel(1);
    tokio::spawn(async move {
        let _permit = permit;
        tokio::select! {
            _ = sender.closed() => {},
            _ = cancelled.changed() => {},
            value = complete(&config, &context, &models, &settings) => {
                let _ = sender.send(Event::default().data(value.to_string())).await;
            }
        }
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

#[cfg(test)]
mod tests {
    use super::*;
    use axum::body::Body;
    use tower::ServiceExt;

    #[tokio::test]
    async fn private_route_uses_the_local_profile_and_scene_guard() {
        for (settings, expected) in [
            (VoiceSettings::hosted(), StatusCode::NOT_FOUND),
            (VoiceSettings::local(), StatusCode::BAD_REQUEST),
        ] {
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
            assert_eq!(response.status(), expected);
        }
    }

    #[tokio::test]
    async fn local_spoken_scene_skips_thoughts_until_the_private_request() {
        let seen = Arc::new(Mutex::new(Vec::new()));
        let provider =
            super::super::tests::plain_provider(seen.clone(), |_, _| "I hear you.".into());
        let (address, server) = super::super::tests::serve(provider).await;
        let mut c = super::super::tests::context();
        c.entities[0].memories.push(Memory {
            seq: Some(1),
            turn: 1,
            kind: "event".into(),
            text: "A friend visited.".into(),
        });
        super::super::tests::resting(&mut c);
        let config = super::super::tests::test_config(address);
        super::super::complete(&config, &c, &BTreeMap::new(), &VoiceSettings::local(), None)
            .await
            .unwrap();
        let requests = seen.lock().unwrap().len();
        assert!(requests <= voiced(&c).len() * 2);
        let result = complete(&config, &c, &BTreeMap::new(), &VoiceSettings::local()).await;
        assert!(seen.lock().unwrap().len() > requests);
        assert!(result.get("reflections").is_some());
        // A newer scene changes this watched value and drops the private future.
        let queue = Queue::default();
        let mut cancelled = queue.cancel.subscribe();
        queue.cancel.send_modify(|generation| *generation += 1);
        cancelled.changed().await.unwrap();
        server.abort();
    }
}
