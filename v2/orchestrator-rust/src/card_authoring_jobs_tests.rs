use super::*;
use axum::{body::to_bytes, body::Body, http::header};
use base64::{engine::general_purpose::STANDARD as BASE64, Engine as _};
use std::{
    fs,
    path::PathBuf,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex,
    },
};
use tower::ServiceExt;

const OWN: &str = "http://localhost:3102";
type Chat = (StatusCode, Value, &'static str);

struct Harness {
    state: AppState,
    db: PathBuf,
    generated: PathBuf,
    seen: Arc<Mutex<Vec<Value>>>,
    chat: Arc<Mutex<Chat>>,
    image: Arc<Mutex<(StatusCode, Value)>>,
    hold_images: Arc<AtomicBool>,
    server: tokio::task::JoinHandle<()>,
}
impl Drop for Harness {
    fn drop(&mut self) {
        self.server.abort();
    }
}

fn png(width: u32, height: u32) -> Vec<u8> {
    let pixels = image::RgbaImage::from_pixel(width, height, image::Rgba([10, 100, 40, 128]));
    let mut out = std::io::Cursor::new(Vec::new());
    image::DynamicImage::ImageRgba8(pixels)
        .write_to(&mut out, image::ImageFormat::Png)
        .unwrap();
    out.into_inner()
}
fn sha(bytes: &[u8]) -> String {
    use sha2::{Digest, Sha256};
    format!("{:x}", Sha256::digest(bytes))
}
fn sheet(reference: &[u8]) -> Value {
    let digest = sha(reference);
    json!({"kind":"avatar","role":"pose-sheet","description":"A traveller with a blue lantern.",
        "basis":json!(["vale", 1, digest, 1]).to_string(),
        "reference":{"base64":BASE64.encode(reference),"mime":"image/png","sha256":digest}})
}
fn portrait() -> Value {
    json!({"kind":"avatar","role":"portrait","description":"A traveller with a blue lantern.",
        "basis":json!(["vale", 1, Value::Null, 1]).to_string()})
}
fn seed() -> Value {
    json!({"seed":"a rainy harbour","kind":"world","context":[]})
}
fn world() -> Value {
    json!({"cards":[
        {"kind":"place","name":"Quay","text":"A sheltered landing."},
        {"kind":"avatar","name":"Mara","text":"The keeper needs the blue lamp."},
        {"kind":"item","name":"Lamp","text":"Blue glass holds a steady flame."}]})
}
fn avatars() -> Value {
    json!({"sample":{"section":0,"start":0,"end":28,"text":"Vale carries a blue lantern."},"excluded":[]})
}
fn candidate() -> Value {
    json!({"candidate":{"name":"Vale","specialAbility":"Lights the path","description":"A traveller with a blue lantern.","aliases":[],"evidence":"Vale carries a blue lantern."}})
}
fn drawn(bytes: &[u8]) -> (StatusCode, Value) {
    let output = json!({"model":images::MODEL,"data":[{"b64_json":BASE64.encode(bytes),"media_type":"image/png"}],"usage":{"total_tokens":7}});
    (StatusCode::OK, output)
}

impl Harness {
    async fn new() -> Self {
        let root = std::env::temp_dir().join(format!("authoring-jobs-{}", crate::random_hex(8)));
        let generated = root.join("generated");
        fs::create_dir_all(&generated).unwrap();
        let db = root.join("events.sqlite");
        let mut state = crate::test_app_state(Some(db.clone()));
        state.generated_asset_dir = Arc::new(generated.clone());
        let seen = Arc::new(Mutex::new(Vec::<Value>::new()));
        let chat = Arc::new(Mutex::new((StatusCode::OK, candidate(), "stop")));
        let image = Arc::new(Mutex::new(drawn(&png(6, 4))));
        let hold_images = Arc::new(AtomicBool::new(false));
        let (calls, chat_reply, image_reply, hold) = (
            seen.clone(),
            chat.clone(),
            image.clone(),
            hold_images.clone(),
        );
        let provider = Router::new().route(
            "/{*path}",
            post(move |uri: axum::http::Uri, Json(body): Json<Value>| {
                let (calls, chat, image, hold) =
                    (calls.clone(), chat_reply.clone(), image_reply.clone(), hold.clone());
                async move {
                    calls.lock().unwrap().push(body);
                    if uri.path() == "/images" {
                        while hold.load(Ordering::SeqCst) {
                            tokio::time::sleep(Duration::from_millis(10)).await;
                        }
                        let (status, reply) = image.lock().unwrap().clone();
                        return (status, Json(reply));
                    }
                    let (status, reply, finish) = chat.lock().unwrap().clone();
                    let content = reply.to_string();
                    let reply = json!({"model":MODEL,"choices":[{"message":{"content":content},"finish_reason":finish}],"usage":{"total_tokens":25}});
                    (status, Json(reply))
                }
            }),
        );
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
        Self {
            state,
            db,
            generated,
            seen,
            chat,
            image,
            hold_images,
            server,
        }
    }
    fn cookie(&self, id: &str) -> String {
        crate::open_event_store(&self.db).unwrap().execute(
            "INSERT OR IGNORE INTO auth_users(id,username,display_name,status,created_at_unix,updated_at_unix) VALUES(?1,?1,?1,'active',0,0)", [id]).unwrap();
        self.state.account_auth.test_session(id)
    }
    async fn raw(
        &self,
        cookie: &str,
        method: &str,
        uri: &str,
        body: Option<Value>,
        extra: &[(&str, &str)],
    ) -> (u16, Vec<u8>) {
        let mut request = axum::http::Request::builder()
            .method(method)
            .uri(uri)
            .header("host", "localhost:3102")
            .header("origin", OWN)
            .header("cookie", cookie);
        for (name, value) in extra {
            request = request.header(*name, *value);
        }
        let body = match body {
            Some(body) => {
                request = request.header("content-type", "application/json");
                Body::from(body.to_string())
            }
            None => Body::empty(),
        };
        let mut request = request.body(body).unwrap();
        request.extensions_mut().insert(axum::extract::ConnectInfo(
            "127.0.0.1:8845".parse::<std::net::SocketAddr>().unwrap(),
        ));
        let response = crate::routes::card_app_router(
            self.state.clone(),
            crate::shutdown::ShutdownSubscription::idle(),
        )
        .oneshot(request)
        .await
        .unwrap();
        assert_eq!(response.headers()[header::CACHE_CONTROL], "no-store");
        let status = response.status().as_u16();
        (
            status,
            to_bytes(response.into_body(), 32 << 20)
                .await
                .unwrap()
                .to_vec(),
        )
    }
    async fn call(
        &self,
        cookie: &str,
        method: &str,
        uri: &str,
        body: Option<Value>,
        extra: &[(&str, &str)],
    ) -> (u16, Value) {
        let (status, bytes) = self.raw(cookie, method, uri, body, extra).await;
        (
            status,
            serde_json::from_slice(&bytes).unwrap_or(Value::Null),
        )
    }
    async fn create(&self, cookie: &str, kind: &str, request: Value) -> (u16, Value) {
        let body = json!({"kind":kind,"request":request});
        self.call(cookie, "POST", ROUTE, Some(body), &[]).await
    }
    async fn get(&self, cookie: &str, id: &str) -> (u16, Value) {
        self.call(cookie, "GET", &format!("{ROUTE}/{id}"), None, &[])
            .await
    }
    /// Poll until the job is finished.
    async fn finished(&self, cookie: &str, id: &str) -> Value {
        for _ in 0..500 {
            let (status, job) = self.get(cookie, id).await;
            assert_eq!(status, 200, "{job}");
            if job["status"] == "done" || job["status"] == "failed" {
                return job;
            }
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
        panic!("job {id} never finished");
    }
    async fn made(&self, cookie: &str, kind: &str, request: Value) -> Value {
        let (status, job) = self.create(cookie, kind, request).await;
        assert_eq!(status, 202, "{job}");
        self.finished(cookie, job["id"].as_str().unwrap()).await
    }
    /// The same database, files and provider seen by a new process.
    fn restarted(&self) -> Harness {
        let mut state = crate::test_app_state(Some(self.db.clone()));
        state.generated_asset_dir = Arc::new(self.generated.clone());
        state.ai_config = self.state.ai_config.clone();
        Harness {
            state,
            db: self.db.clone(),
            generated: self.generated.clone(),
            seen: self.seen.clone(),
            chat: self.chat.clone(),
            image: self.image.clone(),
            hold_images: self.hold_images.clone(),
            server: tokio::spawn(async {}),
        }
    }
    fn provider_calls(&self) -> usize {
        self.seen.lock().unwrap().len()
    }
}

#[tokio::test]
async fn each_kind_runs_to_a_stored_result_that_matches_the_synchronous_route() {
    let _files = crate::card_authoring::ASSET_TEST_LOCK.lock().await;
    let h = Harness::new().await;
    let cookie = h.cookie("maker");
    let sync = "/card-game/authoring/generate";

    let (status, job) = h.create(&cookie, "avatars", avatars()).await;
    assert_eq!(status, 202);
    assert_eq!(job["status"], "queued");
    assert_eq!(job["kind"], "avatars");
    assert!(job["createdAt"].as_i64().unwrap() > 0);
    let done = h.finished(&cookie, job["id"].as_str().unwrap()).await;
    let (_, direct) = h
        .call(
            &cookie,
            "POST",
            &format!("{sync}/avatars"),
            Some(avatars()),
            &[],
        )
        .await;
    assert_eq!(
        (done["status"].as_str(), &done["result"]),
        (Some("done"), &direct)
    );
    assert_eq!(done["result"]["candidate"], candidate()["candidate"]);
    assert!(done.get("error").is_none());

    *h.chat.lock().unwrap() = (StatusCode::OK, world(), "stop");
    let done = h.made(&cookie, "seed", seed()).await;
    let (_, direct) = h
        .call(&cookie, "POST", &format!("{sync}/seed"), Some(seed()), &[])
        .await;
    assert_eq!(
        (done["status"].as_str(), &done["result"]),
        (Some("done"), &direct)
    );

    let done = h.made(&cookie, "image", portrait()).await;
    let (_, direct) = h
        .call(
            &cookie,
            "POST",
            &format!("{sync}/image"),
            Some(portrait()),
            &[],
        )
        .await;
    let image = &done["result"]["image"];
    assert_eq!(done["status"], "done");
    assert_eq!(image["sha256"], direct["image"]["sha256"]);
    assert_eq!(image["size"], direct["image"]["size"]);
    assert_eq!(image["mime"], "image/png");
    assert!(image.get("base64").is_none());
    assert_eq!(done["result"]["basis"], portrait()["basis"]);
    assert_eq!(done["result"]["model"], images::MODEL);
    let expected = BASE64
        .decode(direct["image"]["base64"].as_str().unwrap())
        .unwrap();
    let asset = format!(
        "/card-game/authoring/assets/{}",
        image["sha256"].as_str().unwrap()
    );
    let (status, bytes) = h.raw(&cookie, "GET", &asset, None, &[]).await;
    assert_eq!((status, bytes), (200, expected));

    // The result is on disk: a new process reads the same job and file.
    let after = h.restarted();
    let cookie_after = after.cookie("maker");
    let (status, job) = after.get(&cookie_after, done["id"].as_str().unwrap()).await;
    assert_eq!((status, &job), (200, &done));
    assert_eq!(
        after.raw(&cookie_after, "GET", &asset, None, &[]).await.0,
        200
    );

    let (status, listed) = h.call(&cookie, "GET", ROUTE, None, &[]).await;
    assert_eq!(status, 200);
    let kinds: Vec<_> = listed["jobs"]
        .as_array()
        .unwrap()
        .iter()
        .map(|j| j["kind"].as_str().unwrap())
        .collect();
    assert_eq!(kinds, ["image", "seed", "avatars"]); // newest first
}

#[tokio::test]
async fn a_job_survives_the_creating_connection_and_is_owner_private() {
    let h = Harness::new().await;
    let (a, b) = (h.cookie("a"), h.cookie("b"));
    h.hold_images.store(true, Ordering::SeqCst);
    let (status, job) = h.create(&a, "image", portrait()).await;
    assert_eq!(status, 202);
    let id = job["id"].as_str().unwrap().to_string();
    // The creating request is long gone; the job runs on.
    tokio::time::sleep(Duration::from_millis(50)).await;
    assert_eq!(h.get(&a, &id).await.1["status"], "running");
    assert_eq!(h.get(&b, &id).await.0, 404);
    assert_eq!(h.get(&b, &id).await.1["code"], "job_not_found");
    assert_eq!(
        h.call(&b, "GET", ROUTE, None, &[]).await.1["jobs"],
        json!([])
    );
    assert_eq!(h.call("", "GET", ROUTE, None, &[]).await.0, 401);
    assert_eq!(h.create("", "image", portrait()).await.0, 401);
    h.hold_images.store(false, Ordering::SeqCst);
    assert_eq!(h.finished(&a, &id).await["status"], "done");
}

#[tokio::test]
async fn bad_requests_are_refused_at_once_with_the_synchronous_messages() {
    let h = Harness::new().await;
    let cookie = h.cookie("maker");
    let mut long_seed = seed();
    long_seed["seed"] = json!("x".repeat(6001));
    let mut bad_image = portrait();
    bad_image["description"] = json!("");
    let mut unknown = portrait();
    unknown["apiKey"] = json!("caller-key");
    let mut bad_passage = avatars();
    bad_passage["sample"]["section"] = json!(9);
    for (kind, route, request) in [
        ("seed", "seed", long_seed),
        ("image", "image", bad_image),
        ("image", "image", unknown),
        ("avatars", "avatars", bad_passage),
    ] {
        let (direct, wanted) = h
            .call(
                &cookie,
                "POST",
                &format!("/card-game/authoring/generate/{route}"),
                Some(request.clone()),
                &[],
            )
            .await;
        let (status, got) = h.create(&cookie, kind, request).await;
        assert_eq!(
            (status, &got["error"], &got["code"]),
            (direct, &wanted["error"], &wanted["code"]),
            "{route}"
        );
        assert_eq!(got["ok"], false);
    }
    for (body, wanted) in [
        (json!({"kind":"video","request":{}}), 400),
        (json!({"kind":"seed"}), 422),
        (json!({"kind":"seed","request":{},"extra":1}), 422),
    ] {
        let (status, got) = h.call(&cookie, "POST", ROUTE, Some(body), &[]).await;
        assert_eq!(status, wanted);
        assert_eq!(got["ok"], false);
    }
    let bad_key = [("idempotency-key", "not-a-uuid")];
    let (status, _) = h
        .call(
            &cookie,
            "POST",
            ROUTE,
            Some(json!({"kind":"seed","request":seed()})),
            &bad_key,
        )
        .await;
    assert_eq!(status, 400);
    // Plain-text axum rejections now use the JSON contract on every authoring route.
    for (route, content, body, wanted) in [
        (ROUTE, "application/json", "{not json", 400),
        (ROUTE, "text/plain", "{}", 415),
        (
            "/card-game/authoring/generate/seed",
            "application/json",
            &"x".repeat(70_000),
            413,
        ),
    ] {
        let request = axum::http::Request::builder()
            .method("POST")
            .uri(route)
            .header("host", "localhost:3102")
            .header("origin", OWN)
            .header("cookie", &cookie)
            .header("content-type", content)
            .body(Body::from(body.to_string()))
            .unwrap();
        let mut request = request;
        request.extensions_mut().insert(axum::extract::ConnectInfo(
            "127.0.0.1:8845".parse::<std::net::SocketAddr>().unwrap(),
        ));
        let response = crate::routes::card_app_router(
            h.state.clone(),
            crate::shutdown::ShutdownSubscription::idle(),
        )
        .oneshot(request)
        .await
        .unwrap();
        assert_eq!(response.status().as_u16(), wanted, "{route}");
        let json: Value =
            serde_json::from_slice(&to_bytes(response.into_body(), 1 << 20).await.unwrap())
                .unwrap();
        assert_eq!(
            (json["ok"].clone(), json["code"].clone()),
            (json!(false), json!("request_invalid"))
        );
    }
    assert_eq!(h.provider_calls(), 0);
    assert_eq!(
        h.call(&cookie, "GET", ROUTE, None, &[]).await.1["jobs"],
        json!([])
    );
}

#[tokio::test]
async fn an_idempotency_key_returns_the_same_job_and_one_paid_call() {
    let h = Harness::new().await;
    let cookie = h.cookie("maker");
    let key = "0b0e3e3a-6d0c-4c0e-9d6f-4c5f2b0a9b11";
    let send = |request: Value| {
        let body = json!({"kind":"avatars","request":request});
        let (h, cookie) = (&h, cookie.clone());
        async move {
            h.call(
                &cookie,
                "POST",
                ROUTE,
                Some(body),
                &[("idempotency-key", key)],
            )
            .await
        }
    };
    let (status, first) = send(avatars()).await;
    assert_eq!(status, 202);
    let id = first["id"].as_str().unwrap().to_string();
    h.finished(&cookie, &id).await;
    let (status, second) = send(avatars()).await;
    assert_eq!(
        (status, second["id"].as_str(), second["status"].as_str()),
        (200, Some(id.as_str()), Some("done"))
    );
    let mut other = avatars();
    other["excluded"] = json!(["Mara"]);
    let (status, conflict) = send(other).await;
    assert_eq!(
        (status, conflict["code"].as_str()),
        (409, Some("idempotency_conflict"))
    );
    assert_eq!(h.provider_calls(), 1);
    assert_eq!(
        h.call(&cookie, "GET", ROUTE, None, &[]).await.1["jobs"]
            .as_array()
            .unwrap()
            .len(),
        1
    );
}

#[tokio::test]
async fn admission_refusals_name_their_limit_and_pools_do_not_block_each_other() {
    let h = Harness::new().await;
    let (a, b, c) = (h.cookie("a"), h.cookie("b"), h.cookie("c"));
    h.hold_images.store(true, Ordering::SeqCst);
    let (status, first) = h.create(&a, "image", portrait()).await;
    assert_eq!(status, 202);
    let (status, busy) = h.create(&a, "image", portrait()).await;
    assert_eq!(
        (status, busy["code"].as_str()),
        (429, Some("generation_busy_owner"))
    );
    assert!((1000..=180_000).contains(&busy["retryAfterMs"].as_u64().unwrap()));
    assert!(busy["error"].as_str().unwrap().contains("image"));
    // The same owner's card draw is a different pool, and finishes during the image.
    let done = h.made(&a, "avatars", avatars()).await;
    assert_eq!(done["status"], "done");
    assert_eq!(
        h.get(&a, first["id"].as_str().unwrap()).await.1["status"],
        "running"
    );
    assert_eq!(h.create(&b, "image", portrait()).await.0, 202);
    let (status, full) = h.create(&c, "image", portrait()).await;
    assert_eq!(
        (status, full["code"].as_str()),
        (429, Some("generation_busy_global"))
    );
    assert_eq!(h.create(&c, "avatars", avatars()).await.0, 202); // text is still open
    assert_eq!(
        h.call(&c, "GET", ROUTE, None, &[]).await.1["jobs"]
            .as_array()
            .unwrap()
            .len(),
        1
    );
    let second = h.call(&b, "GET", ROUTE, None, &[]).await.1["jobs"][0]["id"].clone();
    h.hold_images.store(false, Ordering::SeqCst);
    h.finished(&a, first["id"].as_str().unwrap()).await;
    h.finished(&b, second.as_str().unwrap()).await;
    // Starting too many in a minute is its own refusal, with a real wait.
    let d = h.cookie("d");
    for _ in 0..6 {
        assert_eq!(h.made(&d, "image", portrait()).await["status"], "done");
    }
    let (status, rate) = h.create(&d, "image", portrait()).await;
    assert_eq!(
        (status, rate["code"].as_str()),
        (429, Some("generation_rate"))
    );
    assert!((1000..=60_000).contains(&rate["retryAfterMs"].as_u64().unwrap()));
}

#[tokio::test]
async fn failures_are_recorded_once_with_a_distinct_honest_message() {
    let h = Harness::new().await;
    let cookie = h.cookie("maker");
    let failure = |job: &Value| {
        (
            job["status"].clone(),
            job["error"]["code"].clone(),
            job["error"]["message"].as_str().unwrap().to_string(),
        )
    };
    let mut calls = 0;
    // Each case: image provider reply, request, expected code, words the message must hold.
    let layout = png(5, 3);
    let cases = [
        (
            drawn(&png(6, 4)[..24]),
            "image",
            portrait(),
            "image_layout_invalid",
            "could not use",
        ),
        (
            drawn(&layout),
            "image",
            sheet(&png(6, 4)),
            "image_layout_invalid",
            "pose sheet",
        ),
        (
            (
                StatusCode::OK,
                json!({"model":"other/model","data":[{"b64_json":BASE64.encode(png(6, 4)),"media_type":"image/png"}]}),
            ),
            "image",
            portrait(),
            "image_model_unexpected",
            "different model",
        ),
        (
            (
                StatusCode::BAD_REQUEST,
                json!({"error":{"message":"private"}}),
            ),
            "image",
            portrait(),
            "inference_provider_error",
            "refused",
        ),
        (
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                json!({"error":{"message":"private"}}),
            ),
            "image",
            portrait(),
            "inference_provider_error",
            "unavailable",
        ),
    ];
    for (reply, kind, request, code, words) in cases {
        *h.image.lock().unwrap() = reply;
        calls += 1;
        let job = h.made(&cookie, kind, request).await;
        let (status, got, message) = failure(&job);
        assert_eq!((status, got), (json!("failed"), json!(code)), "{message}");
        assert!(message.contains(words), "{message}");
        assert!(!message.contains("private"));
        assert!(job["error"]["retryAfterMs"].is_u64());
        assert!(job.get("result").is_none());
        assert_eq!(h.provider_calls(), calls); // never retried
    }
    *h.chat.lock().unwrap() = (StatusCode::OK, json!({"cards":[]}), "stop");
    let job = h.made(&cookie, "seed", seed()).await;
    assert_eq!(job["error"]["code"], "generation_invalid_output");
    *h.chat.lock().unwrap() = (StatusCode::INTERNAL_SERVER_ERROR, json!({}), "stop");
    let job = h.made(&cookie, "seed", seed()).await;
    assert!(job["error"]["message"]
        .as_str()
        .unwrap()
        .contains("text service is unavailable"));
}

#[test]
fn provider_failure_kinds_have_their_own_words() {
    use admission::Pool::{Image, Text};
    let timed_out = describe(Image, "inference_timeout", None, 0);
    assert!(timed_out.message.contains("image model took too long"));
    let spent = describe(Text, "inference_daily_spend_exhausted", None, 0);
    assert!(spent.message.contains("budget for generation is spent"));
    assert!(spent.message.contains("00:00 UTC"));
    assert!((1..=86_400_000).contains(&spent.retry_after_ms.unwrap()));
    assert!(describe(Image, "inference_provider_error", Some(422), 0)
        .message
        .contains("refused"));
    for status in [Some(429), Some(503), None] {
        let down = describe(Image, "inference_provider_error", status, 7000);
        assert!(down.message.contains("unavailable"));
        assert_eq!(down.retry_after_ms, Some(7000));
    }
    assert_eq!(timed_out.code, "inference_timeout");
}

#[tokio::test]
async fn a_restart_stops_unfinished_jobs_without_running_them_again() {
    let h = Harness::new().await;
    let cookie = h.cookie("maker");
    let done = h.made(&cookie, "avatars", avatars()).await;
    let calls = h.provider_calls();
    let c = open(&h.state).unwrap();
    let owner: String = c
        .query_row("SELECT owner FROM authoring_jobs LIMIT 1", [], |r| r.get(0))
        .unwrap();
    for (id, status) in [("queued1", "queued"), ("running1", "running")] {
        c.execute(
            "INSERT INTO authoring_jobs(id,owner,kind,digest,status,created_at,updated_at) VALUES(?,?,'image','',?,?,?)",
            params![id, owner, status, now_ms(), now_ms()],
        )
        .unwrap();
    }
    start(&h.state);
    for id in ["queued1", "running1"] {
        let (status, job) = h.get(&cookie, id).await;
        assert_eq!(status, 200);
        assert_eq!(job["status"], "failed");
        assert_eq!(job["error"]["code"], "generation_interrupted");
        assert!(job["error"]["message"]
            .as_str()
            .unwrap()
            .contains("restarted"));
    }
    assert_eq!(h.get(&cookie, done["id"].as_str().unwrap()).await.1, done);
    tokio::time::sleep(Duration::from_millis(100)).await;
    assert_eq!(h.provider_calls(), calls);
}

#[tokio::test]
async fn old_jobs_are_pruned_and_each_owner_keeps_a_bounded_number() {
    let h = Harness::new().await;
    let cookie = h.cookie("maker");
    let c = open(&h.state).unwrap();
    let now = now_ms();
    let week = RETAIN.as_millis() as i64;
    for (id, status, age) in [
        ("old-done", "done", week + 1000),
        ("old-failed", "failed", week + 1000),
        ("new-done", "done", 1000),
        ("old-running", "running", week + 1000),
    ] {
        c.execute(
            "INSERT INTO authoring_jobs(id,owner,kind,digest,status,created_at,updated_at) VALUES(?,?,'seed','',?,?,?)",
            params![id, "maker", status, now - age, now - age],
        ).unwrap();
    }
    assert_eq!(prune(&c, now).unwrap(), 2);
    let left: Vec<String> = c
        .prepare("SELECT id FROM authoring_jobs ORDER BY id")
        .unwrap()
        .query_map([], |r| r.get(0))
        .unwrap()
        .map(Result::unwrap)
        .collect();
    assert_eq!(left, ["new-done", "old-running"]);
    for n in 0..(KEPT + 5) {
        c.execute(
            "INSERT INTO authoring_jobs(id,owner,kind,digest,status,created_at,updated_at) VALUES(?,?,'seed','','done',?,?)",
            params![format!("bulk{n}"), "maker", now - 50_000 + n as i64, now],
        ).unwrap();
    }
    h.made(&cookie, "avatars", avatars()).await;
    let kept: i64 = c
        .query_row(
            "SELECT count(*) FROM authoring_jobs WHERE owner='maker' AND status='done'",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(kept, KEPT as i64); // the newest KEPT rows, the new job among them
    assert_eq!(
        h.call(&cookie, "GET", ROUTE, None, &[]).await.1["jobs"]
            .as_array()
            .unwrap()
            .len(),
        LISTED
    );
}

#[tokio::test]
async fn a_full_file_store_fails_the_job_and_leaves_no_orphan_file() {
    let _files = crate::card_authoring::ASSET_TEST_LOCK.lock().await;
    let h = Harness::new().await;
    let cookie = h.cookie("maker");
    let first = h.made(&cookie, "image", portrait()).await;
    assert_eq!(first["status"], "done");
    let private = h.generated.join("authoring-private");
    let owner_dir = fs::read_dir(&private)
        .unwrap()
        .next()
        .unwrap()
        .unwrap()
        .path();
    let files = |dir: &PathBuf| fs::read_dir(dir).unwrap().count();
    for n in files(&owner_dir)..1024 {
        fs::write(owner_dir.join(format!("{n:064x}")), b"x").unwrap();
    }
    // A different picture, so it needs a new file the owner has no room for.
    *h.image.lock().unwrap() = drawn(&png(8, 6));
    let job = h.made(&cookie, "image", portrait()).await;
    assert_eq!(
        (job["status"].as_str(), job["error"]["code"].as_str()),
        (Some("failed"), Some("authoring_storage_full"))
    );
    assert!(job["error"]["message"]
        .as_str()
        .unwrap()
        .contains("storage is full"));
    assert_eq!(files(&owner_dir), 1024);
    assert!(fs::read_dir(&owner_dir).unwrap().all(|f| !f
        .unwrap()
        .file_name()
        .to_string_lossy()
        .starts_with(".upload-")));
    // The first job's file is still readable.
    let asset = format!(
        "/card-game/authoring/assets/{}",
        first["result"]["image"]["sha256"].as_str().unwrap()
    );
    assert_eq!(h.raw(&cookie, "GET", &asset, None, &[]).await.0, 200);
}
