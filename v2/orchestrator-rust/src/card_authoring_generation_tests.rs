use super::*;
use axum::body::{to_bytes, Body};
use std::sync::Arc;
use tower::ServiceExt;

fn input() -> Value {
    json!({"sample":{"section":0,"start":0,"end":28,"text":"Vale carries a blue lantern."},"excluded":[]})
}
fn reply() -> Value {
    json!({"candidate":{"name":"Vale","specialAbility":"Lights the path","description":"A traveller with a blue lantern.","aliases":[],"evidence":"Vale carries a blue lantern."}})
}
async fn send(state: &AppState, cookie: &str, body: Value, origin: &str) -> (u16, Value) {
    let mut request = axum::http::Request::builder()
        .method("POST")
        .uri(ROUTE)
        .header("host", "localhost:3102")
        .header("origin", origin)
        .header("cookie", cookie)
        .header("content-type", "application/json")
        .body(Body::from(body.to_string()))
        .unwrap();
    request.extensions_mut().insert(axum::extract::ConnectInfo(
        "127.0.0.1:8845".parse::<std::net::SocketAddr>().unwrap(),
    ));
    let response = crate::routes::app_router(state.clone())
        .oneshot(request)
        .await
        .unwrap();
    assert_eq!(response.headers()[header::CACHE_CONTROL], "no-store");
    let status = response.status().as_u16();
    let bytes = to_bytes(response.into_body(), 100_000).await.unwrap();
    (
        status,
        serde_json::from_slice(&bytes).unwrap_or(Value::Null),
    )
}

#[tokio::test]
async fn authoring_auth_grounding_and_gateway_use_transient_source() {
    let path = std::env::temp_dir().join(format!(
        "authoring-generation-{}.sqlite",
        crate::random_hex(12)
    ));
    let mut state = crate::test_app_state(crate::RuntimeWorld::seeded(), Some(path.clone()));
    let owner = crate::random_hex(12);
    crate::open_event_store(&path).unwrap().execute(
        "INSERT INTO auth_users(id,username,display_name,status,created_at_unix,updated_at_unix) VALUES(?1,?1,?1,'active',0,0)", [&owner]).unwrap();
    let cookie = state.account_auth.test_session(&owner);
    let seen = Arc::new(Mutex::new(Vec::<Value>::new()));
    let outcome = Arc::new(Mutex::new((StatusCode::OK, reply(), "stop")));
    let (calls, result) = (seen.clone(), outcome.clone());
    let provider = Router::new().route("/chat/completions", post(move |Json(body): Json<Value>| {
        let (calls, result) = (calls.clone(), result.clone());
        async move {
            calls.lock().unwrap().push(body);
            let (status, result, finish) = result.lock().unwrap().clone();
            (status, Json(json!({"model":MODEL,"choices":[{"message":{"content":result.to_string()},"finish_reason":finish}],"usage":{"total_tokens":25}})))
        }
    }));
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = listener.local_addr().unwrap();
    let server = tokio::spawn(async move {
        axum::serve(listener, provider).await.unwrap();
    });
    state.ai_config = Arc::new(Some(ai_gateway::AiConfig {
        model: MODEL.into(),
        base_url: format!("http://{address}"),
        api_key: "fixture".into(),
        ..Default::default()
    }));
    for (cookie, origin, expected) in [
        ("", "http://localhost:3102", 401),
        (cookie.as_str(), "https://other.example", 403),
    ] {
        assert_eq!(send(&state, cookie, input(), origin).await.0, expected);
    }
    for change in [
        json!({"sample":{"section":6,"start":0,"end":1,"text":"a"},"excluded":[]}),
        json!({"sample":{"section":0,"start":0,"end":2,"text":"a"},"excluded":[]}),
        json!({"sample":{"section":0,"start":0,"end":1,"text":"a"},"excluded":vec!["alias";55]}),
    ] {
        assert_eq!(
            send(&state, &cookie, change, "http://localhost:3102")
                .await
                .0,
            400
        );
    }
    assert!(seen.lock().unwrap().is_empty());
    let (status, response) = send(&state, &cookie, input(), "http://localhost:3102").await;
    assert_eq!(status, 200);
    assert_eq!(response["candidate"], reply()["candidate"]);
    assert_eq!(response["model"], MODEL);
    assert_eq!(response["usage"]["total_tokens"], 25);
    let request = seen.lock().unwrap()[0].clone();
    assert_eq!(request["model"], MODEL);
    assert_eq!(request["response_format"]["type"], "json_object");
    assert!(request["messages"][1]["content"]
        .as_str()
        .unwrap()
        .contains("blue lantern"));
    for (value, finish, status, expected) in [
        (json!({"candidate":null}), "stop", StatusCode::OK, 200),
        (
            json!({"candidate":{"name":"Invented"}}),
            "stop",
            StatusCode::OK,
            502,
        ),
        (reply(), "length", StatusCode::OK, 502),
        (reply(), "stop", StatusCode::INTERNAL_SERVER_ERROR, 503),
    ] {
        *outcome.lock().unwrap() = (status, value, finish);
        assert_eq!(
            send(&state, &cookie, input(), "http://localhost:3102")
                .await
                .0,
            expected
        );
    }
    assert_eq!(seen.lock().unwrap().len(), 5); // Each paid action attempts once.
    let bytes = std::fs::read(&path).unwrap();
    assert!(!String::from_utf8_lossy(&bytes).contains("blue lantern"));
    server.abort();
}

#[test]
fn authoring_rejects_duplicate_ungrounded_and_unbounded_candidates() {
    let mut request: Input = serde_json::from_value(input()).unwrap();
    assert!(valid_input(&request));
    request.excluded.push("Vále".into());
    assert!(candidate(&reply().to_string(), &request).is_none());
    request.excluded.clear();
    for (field, value) in [
        ("evidence", json!("A different passage")),
        ("description", json!("x".repeat(1201))),
        ("aliases", json!([""])),
        ("seed", json!("private instructions")),
    ] {
        let mut output = reply();
        output["candidate"][field] = value;
        assert!(
            candidate(&output.to_string(), &request).is_none(),
            "{field}"
        );
    }
    let owner = crate::random_hex(12);
    let permit = admit(owner.clone()).unwrap();
    assert!(admit(owner.clone()).is_none());
    drop(permit);
    assert!(admit(owner).is_some());
}
