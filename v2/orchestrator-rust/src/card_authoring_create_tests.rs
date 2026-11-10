use super::*;
use sha2::{Digest, Sha256};

async fn upload(state: &AppState, cookie: &str, owner: &str, sha: &str, bytes: &[u8]) -> u16 {
    let mut request = axum::http::Request::builder()
        .method("PUT")
        .uri(format!("/card-game/authoring/assets/{sha}"))
        .header("host", "localhost:3102")
        .header("cookie", cookie)
        .header("x-authoring-owner", owner)
        .header("content-type", "application/octet-stream")
        .body(Body::from(bytes.to_vec()))
        .unwrap();
    request
        .extensions_mut()
        .insert(ConnectInfo("127.0.0.1:8845".parse::<SocketAddr>().unwrap()));
    let response = crate::routes::card_app_router(
        state.clone(),
        crate::shutdown::ShutdownSubscription::idle(),
    )
    .oneshot(request)
    .await
    .unwrap();
    assert_eq!(response.headers()[header::CACHE_CONTROL], "no-store");
    response.status().as_u16()
}

#[tokio::test]
async fn create_receipts_preserve_owner_content_files_and_retry_identity() {
    let _transfer = crate::card_authoring::ASSET_TEST_LOCK.lock().await;
    let (mut state, path) = fixture();
    let root = path.with_extension("generated");
    std::fs::create_dir(&root).unwrap();
    state.generated_asset_dir = std::sync::Arc::new(root.clone());
    let (owner, other) = (cookie(&state, "owner"), cookie(&state, "other"));
    let key = Some(("idempotency-key", "dcba9876-1234-4321-abcd-123456789abc"));
    let second = Some(("idempotency-key", "abcd1234-1234-4321-abcd-123456789abc"));
    let bytes = b"accepted output";
    let sha = format!("{:x}", Sha256::digest(bytes));
    let mut input = launch_draft();
    input["assets"] = json!([{"path":"assets/marsh/output.txt","mime":"text/plain","sha256":sha,"size":bytes.len()}]);
    assert_eq!(
        send(&state, "POST", BASE, "", input.clone(), key).await.0,
        401
    );
    for invalid in ["", "reuse", "DCBA9876-1234-4321-ABCD-123456789ABC"] {
        assert_eq!(
            send(
                &state,
                "POST",
                BASE,
                &owner,
                input.clone(),
                Some(("idempotency-key", invalid))
            )
            .await
            .0,
            400
        );
    }
    assert_eq!(
        send(&state, "POST", BASE, &owner, input.clone(), key)
            .await
            .0,
        409
    );
    assert_eq!(upload(&state, &other, "owner", &sha, bytes).await, 409);
    assert_eq!(upload(&state, &owner, "owner", &sha, bytes).await, 200);
    let mut bound = input.clone();
    bound["assets"] = json!([]);
    assert_eq!(
        send(
            &state,
            "POST",
            BASE,
            &other,
            bound,
            Some(("x-authoring-owner", "owner"))
        )
        .await
        .0,
        409
    );
    assert_eq!(
        send(&state, "POST", BASE, &other, input.clone(), key)
            .await
            .0,
        409
    );
    let (first, retry) = tokio::join!(
        send(&state, "POST", BASE, &owner, input.clone(), key),
        send(&state, "POST", BASE, &owner, input.clone(), key)
    );
    assert_eq!(first.0, 200);
    assert_eq!(retry, first);
    let created = first.1;
    let route = format!("{BASE}/{}", created["id"].as_str().unwrap());
    assert_eq!(created["assets"], input["assets"]);
    let (_, list) = send(&state, "GET", BASE, &owner, Value::Null, None).await;
    assert_eq!(list["packs"].as_array().unwrap().len(), 1);
    for (field, value) in [
        ("title", json!("Changed")),
        ("launch", json!({"schemaVersion":1,"place":"shore"})),
    ] {
        let mut changed = input.clone();
        changed[field] = value;
        assert_eq!(
            send(&state, "POST", BASE, &owner, changed, key).await.0,
            409
        );
    }
    let mut save = save_body(created.clone(), 1);
    save["title"] = json!("Later title");
    save["launch"] = json!({"schemaVersion":1,"place":"shore"});
    let (status, saved) = send(&state, "PUT", &route, &owner, save, None).await;
    assert_eq!(status, 200);
    assert_eq!(saved["revision"], 2);
    let mut reopened = test_app_state(RuntimeWorld::empty(), Some(path.clone()));
    reopened.generated_asset_dir = state.generated_asset_dir.clone();
    assert_eq!(
        send(&reopened, "POST", BASE, &owner, input.clone(), key).await,
        (200, created.clone())
    );
    assert_eq!(
        send(&state, "GET", &route, &owner, Value::Null, None).await,
        (200, saved.clone())
    );
    assert_eq!(
        send(
            &state,
            "GET",
            &format!("{route}/launch"),
            &owner,
            Value::Null,
            None
        )
        .await
        .1,
        json!({"revision":2,"launch":{"schemaVersion":1,"place":"shore"}})
    );

    let mut bad = save_body(saved.clone(), 2);
    bad["assets"][0]["size"] = json!(1);
    assert_eq!(send(&state, "PUT", &route, &owner, bad, None).await.0, 409);
    assert_eq!(
        send(&state, "GET", &route, &owner, Value::Null, None)
            .await
            .1,
        saved
    );
    assert_eq!(upload(&state, &other, "other", &sha, bytes).await, 200);
    let (status, other_created) = send(&state, "POST", BASE, &other, input.clone(), key).await;
    assert_eq!(status, 200);
    assert_ne!(other_created["id"], created["id"]);

    let sql = open_event_store(&path).unwrap();
    sql.execute_batch("CREATE TRIGGER fail_receipt BEFORE INSERT ON authoring_creates BEGIN SELECT RAISE(ABORT,'fixture'); END;").unwrap();
    assert_eq!(
        send(&state, "POST", BASE, &owner, input.clone(), second)
            .await
            .0,
        503
    );
    let count = || {
        sql.query_row(
            "SELECT count(*) FROM authoring_packs WHERE owner='owner'",
            [],
            |r| r.get::<_, u64>(0),
        )
        .unwrap()
    };
    assert_eq!(count(), 1);
    sql.execute_batch("DROP TRIGGER fail_receipt;").unwrap();
    assert_eq!(
        send(&state, "POST", BASE, &owner, input.clone(), second)
            .await
            .0,
        200
    );
    assert_eq!(count(), 2);
    sql.execute_batch(
        "WITH RECURSIVE n(i) AS (VALUES(1) UNION ALL SELECT i+1 FROM n WHERE i<126)
        INSERT INTO authoring_packs(id,owner,content) SELECT 'limit-'||i,'owner','{}' FROM n;",
    )
    .unwrap();
    assert_eq!(count(), 128);
    assert_eq!(
        send(&state, "POST", BASE, &owner, input.clone(), key).await,
        (200, created)
    );
    assert_eq!(send(&state, "POST", BASE, &owner, input, None).await.0, 409);
    drop((sql, reopened, state));
    std::fs::remove_dir_all(root).unwrap();
}
