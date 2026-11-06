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
    send_to(state, cookie, body, origin, ROUTE).await
}
async fn send_to(
    state: &AppState,
    cookie: &str,
    body: Value,
    origin: &str,
    route: &str,
) -> (u16, Value) {
    let mut request = axum::http::Request::builder()
        .method("POST")
        .uri(route)
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
    let provider = Router::new().route("/{*path}", post(move |uri: axum::http::Uri, Json(body): Json<Value>| {
        let (calls, result) = (calls.clone(), result.clone());
        async move {
            calls.lock().unwrap().push(body);
            let (status, result, finish) = result.lock().unwrap().clone();
            let reply = if uri.path() == "/images" { result } else {
                json!({"model":MODEL,"choices":[{"message":{"content":result.to_string()},"finish_reason":finish}],"usage":{"total_tokens":25}})
            };
            (status, Json(reply))
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
        data_policy_mode: ai_gateway::DataPolicyMode::Production,
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
    let before_images = seen.lock().unwrap().len();
    use base64::{engine::general_purpose::STANDARD as BASE64, Engine as _};
    use sha2::{Digest, Sha256};
    let pixels = image::RgbaImage::from_pixel(6, 4, image::Rgba([10, 100, 40, 128]));
    let mut png = std::io::Cursor::new(Vec::new());
    image::DynamicImage::ImageRgba8(pixels)
        .write_to(&mut png, image::ImageFormat::Png)
        .unwrap();
    let clean = png.into_inner();
    let mut bytes = clean.clone();
    bytes.extend_from_slice(b"private blue lantern");
    bytes.resize(70_000, 0); // A valid reference larger than the text route's 64 KiB limit.
    let digest = format!("{:x}", Sha256::digest(&bytes));
    let mut picture = json!({"kind":"avatar","role":"pose-sheet","description":"private blue lantern",
        "basis":json!(["vale",1,digest,1]).to_string(),"instruction":"",
        "reference":{"base64":BASE64.encode(&bytes),"mime":"image/png","sha256":digest}});
    for (path, value) in [
        ("/description", json!("x".repeat(1201))),
        ("/instruction", json!("x".repeat(2001))),
        ("/kind", json!("ship")),
        ("/reference/mime", json!("image/jpeg")),
        ("/reference/sha256", json!("0".repeat(64))),
        ("/reference/base64", json!("%%%")),
        ("/basis", json!("[\"vale\",1,null,1]")),
        ("/reference", Value::Null),
    ] {
        let mut invalid = picture.clone();
        *invalid.pointer_mut(path).unwrap() = value;
        assert!(
            super::images::prepare(&serde_json::from_value(invalid).unwrap()).is_err(),
            "{path}"
        );
    }
    let model = "openai/gpt-image-2.6-flare";
    let own = "http://localhost:3102";
    let route = super::images::ROUTE;
    let image_request = |body| send_to(&state, &cookie, body, own, route);
    let output = json!({"model":model,"data":[{"b64_json":BASE64.encode(&bytes),"media_type":"image/png"}],"usage":{"total_tokens":7}});
    *outcome.lock().unwrap() = (StatusCode::OK, output.clone(), "stop");
    for (cookie, origin, expected) in [
        ("", "http://localhost:3102", 401),
        (cookie.as_str(), "https://other.example", 403),
    ] {
        assert_eq!(
            send_to(&state, cookie, picture.clone(), origin, route)
                .await
                .0,
            expected
        );
    }
    let mut unknown = picture.clone();
    unknown["apiKey"] = json!("caller-key");
    assert_eq!(image_request(unknown).await.0, 422);
    assert_eq!(seen.lock().unwrap().len(), before_images);
    let (status, result) = image_request(picture.clone()).await;
    assert_eq!((status, result["model"].as_str()), (200, Some(model)));
    assert_eq!(result["basis"], picture["basis"]);
    let decoded = BASE64
        .decode(result["image"]["base64"].as_str().unwrap())
        .unwrap();
    assert_eq!(decoded, clean); // Only pixels survive; the provider's extra bytes leave.
    assert_eq!(
        result["image"]["sha256"],
        format!("{:x}", Sha256::digest(&decoded))
    );
    assert_eq!(result["image"]["size"], decoded.len());
    assert_eq!(result["image"]["mime"], "image/png");
    let sent = seen.lock().unwrap().last().unwrap().clone();
    assert_eq!(sent["model"], model);
    assert_eq!(sent["background"], "transparent");
    assert_eq!(sent["aspect_ratio"], "3:2");
    let reference = format!("data:image/png;base64,{}", BASE64.encode(&bytes));
    assert_eq!(sent["input_references"][0]["image_url"]["url"], reference);
    picture["role"] = json!("portrait");
    picture["reference"] = Value::Null;
    picture["basis"] = json!("[\"vale\",2,null,2]");
    assert_eq!(image_request(picture.clone()).await.0, 200);
    for (status, output, expected) in [
        (
            StatusCode::OK,
            json!({"model":model,"data":[{"b64_json":BASE64.encode(&clean[..24])}]}),
            502,
        ),
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            json!({"error":{"message":"private blue lantern"}}),
            503,
        ),
    ] {
        *outcome.lock().unwrap() = (status, output, "stop");
        assert_eq!(image_request(picture.clone()).await.0, expected);
    }
    assert_eq!(seen.lock().unwrap().len(), before_images + 4); // Each image attempts once.
    for suffix in ["", "-wal"] {
        let bytes = std::fs::read(format!("{}{suffix}", path.display())).unwrap_or_default();
        assert!(!String::from_utf8_lossy(&bytes).contains("blue lantern"));
    }
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
