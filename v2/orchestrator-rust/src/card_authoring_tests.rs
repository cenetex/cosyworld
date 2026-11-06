use super::*;
use axum::body::{to_bytes, Body};
use serde_json::{json, Value};
use tower::ServiceExt;

const BASE: &str = "/card-game/authoring/packs";

fn cookie(state: &AppState, id: &str) -> String {
    open_event_store(state.account_auth.path().unwrap()).unwrap().execute(
        "INSERT INTO auth_users(id,username,display_name,status,created_at_unix,updated_at_unix)
        VALUES(?1,?1,?1,'active',0,0)", [id],
    ).unwrap();
    state
        .account_auth
        .issue_session(id)
        .unwrap()
        .1
        .split(';')
        .next()
        .unwrap()
        .to_string()
}

fn fixture() -> (AppState, PathBuf) {
    let path = std::env::temp_dir().join(format!("authoring-{}.sqlite", random_hex(12)));
    (
        test_app_state(RuntimeWorld::seeded(), Some(path.clone())),
        path,
    )
}

fn draft() -> Value {
    json!({"schemaVersion":1,"title":"Lantern Marsh","document":"A quiet marsh.\nAn old lantern.",
        "pack":{"id":"lantern-marsh"},"bridge":null,
        "assets":[{"path":"assets/lantern-marsh/guide.png","mime":"image/png","sha256":"a".repeat(64),"size":4096}],
        "sources":[{"kind":"github","repo":"writer/marsh","commit":"b".repeat(40),"path":"card-world.json"}]})
}

async fn send(
    state: &AppState,
    method: &str,
    path: &str,
    cookie: &str,
    body: Value,
    extra: Option<(&str, &str)>,
) -> (u16, Value) {
    let mut request = axum::http::Request::builder()
        .method(method)
        .uri(path)
        .header("host", "localhost:3102")
        .header("content-type", "application/json")
        .header("cookie", cookie);
    if let Some((key, value)) = extra {
        request = request.header(key, value);
    }
    let mut request = request.body(Body::from(body.to_string())).unwrap();
    request
        .extensions_mut()
        .insert(ConnectInfo("127.0.0.1:8845".parse::<SocketAddr>().unwrap()));
    let response = crate::routes::app_router(state.clone())
        .oneshot(request)
        .await
        .unwrap();
    assert_eq!(response.headers()[header::CACHE_CONTROL], "no-store");
    let status = response.status().as_u16();
    let bytes = to_bytes(response.into_body(), 10 * 1024 * 1024)
        .await
        .unwrap();
    (
        status,
        serde_json::from_slice(&bytes).unwrap_or(Value::Null),
    )
}

#[tokio::test]
async fn private_packs_follow_the_passkey_account_and_survive_reopen() {
    let (state, path) = fixture();
    let owner = cookie(&state, "owner");
    let other = cookie(&state, "other");
    for method in ["GET", "POST"] {
        assert_eq!(send(&state, method, BASE, "", draft(), None).await.0, 401);
    }
    let (status, created) = send(&state, "POST", BASE, &owner, draft(), None).await;
    assert_eq!(status, 200);
    assert_eq!(created["revision"], 1);
    assert!(crate::authoring_draft::valid(&created));
    assert_eq!(created["document"], draft()["document"]);
    assert_eq!(created["assets"], draft()["assets"]);
    assert_eq!(created["sources"], draft()["sources"]);
    let id = created["id"].as_str().unwrap();
    assert_eq!(id.len(), 48);
    let route = format!("{BASE}/{id}");
    assert_eq!(
        send(&state, "GET", &route, &other, Value::Null, None)
            .await
            .0,
        404
    );
    assert_eq!(
        send(&state, "GET", &route, "", Value::Null, None).await.0,
        401
    );
    assert_eq!(
        send(&state, "GET", BASE, &other, Value::Null, None).await.1,
        json!({"packs":[]})
    );
    let (_, list) = send(&state, "GET", BASE, &owner, Value::Null, None).await;
    assert_eq!(
        list,
        json!({"packs":[{"id":id,"title":"Lantern Marsh","revision":1}]})
    );
    let reopened = test_app_state(RuntimeWorld::seeded(), Some(path));
    assert_eq!(
        send(&reopened, "GET", &route, &owner, Value::Null, None).await,
        (200, created)
    );
}

#[tokio::test]
async fn create_checks_origin_size_schema_and_server_owned_fields() {
    let (state, _) = fixture();
    let owner = cookie(&state, "owner");
    for extra in [
        ("origin", "https://other.example"),
        ("sec-fetch-site", "cross-site"),
    ] {
        assert_eq!(
            send(&state, "POST", BASE, &owner, draft(), Some(extra))
                .await
                .0,
            403
        );
    }
    for (key, value, status) in [
        ("schemaVersion", json!(2), 400),
        ("title", json!("x".repeat(81)), 400),
        ("title", json!(" "), 400),
        ("title", json!("🌲".repeat(41)), 400),
        (
            "sources",
            json!([{ "kind":"github", "repo":"writer/marsh", "commit":"b".repeat(40) }]),
            400,
        ),
        ("document", json!("x".repeat(8 * 1024 * 1024 + 1)), 400),
        ("document", json!("x".repeat(10 * 1024 * 1024)), 413),
        ("owner", json!("other"), 400),
        ("id", json!("chosen-by-client"), 400),
        ("revision", json!(99), 400),
        ("pack", json!([]), 400),
        (
            "assets",
            json!([{"path":"assets/../private","mime":"image/png","sha256":"a".repeat(64),"size":1}]),
            400,
        ),
    ] {
        let mut input = draft();
        input[key] = value;
        assert_eq!(
            send(&state, "POST", BASE, &owner, input, None).await.0,
            status,
            "{key}"
        );
    }
    assert_eq!(
        send(&state, "GET", BASE, &owner, Value::Null, None).await.1,
        json!({"packs":[]})
    );
    let mut book = draft();
    book["document"] = json!("x".repeat(8 * 1024 * 1024));
    let (status, created) = send(&state, "POST", BASE, &owner, book.clone(), None).await;
    assert_eq!(status, 200);
    assert_eq!(created["document"], book["document"]);
    assert!(crate::authoring_draft::valid(&created));
    let route = format!("{BASE}/{}", created["id"].as_str().unwrap());
    assert_eq!(
        send(&state, "GET", &route, &owner, Value::Null, None).await,
        (200, created)
    );
}
