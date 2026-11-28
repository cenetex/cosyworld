use super::{
    local_paths::{self, Environment},
    models,
};
use rand::RngCore;
use reqwest::{Client, Url};
use serde_json::{json, Value};
use std::{
    env,
    ffi::OsStr,
    io,
    path::{Path, PathBuf},
    time::Duration,
};
use tokio::{
    process::{Child, Command},
    time::{self, Instant},
};

#[cfg(unix)]
#[path = "../../local/memory.rs"]
mod memory;

fn value<'a>(source: &'a Environment, key: &str, default: &'a str) -> &'a str {
    source
        .get(OsStr::new(key))
        .and_then(|value| value.to_str())
        .unwrap_or(default)
}

fn port(source: &Environment, key: &str, default: &str) -> io::Result<u16> {
    value(source, key, default)
        .parse()
        .ok()
        .filter(|port| *port > 0)
        .ok_or_else(|| io::Error::other(format!("Choose a valid port for {key}.")))
}

fn cleaned(source: &Environment) -> Environment {
    source
        .iter()
        .filter(|(key, _)| {
            let key = key.to_string_lossy().to_ascii_uppercase();
            !["COSYWORLD_", "OPENROUTER_", "OPENAI_"]
                .iter()
                .any(|prefix| key.starts_with(prefix))
                && !["HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY"].contains(&key.as_str())
        })
        .map(|(key, value)| (key.clone(), value.clone()))
        .collect()
}

async fn dialogue(source: &Environment, client: &Client, model: &str) -> io::Result<String> {
    match value(source, "COSYWORLD_LOCAL_BACKEND", "embedded") {
        "embedded" if cfg!(feature = "embedded-llama") => Ok("embedded://llama".into()),
        "embedded" => Err(io::Error::other(
            "Build with embedded-llama or select the Ollama backend.",
        )),
        "ollama" => {
            let url = Url::parse(value(source, "OLLAMA_URL", "http://127.0.0.1:11434"))
                .map_err(io::Error::other)?;
            if url.scheme() != "http"
                || !matches!(url.host_str(), Some("localhost" | "127.0.0.1" | "[::1]"))
                || !url.username().is_empty()
                || url.password().is_some()
                || url.query().is_some()
                || url.fragment().is_some()
            {
                return Err(io::Error::other("Choose a loopback URL for Ollama."));
            }
            let base = url.as_str().trim_end_matches('/');
            let details: Value = client
                .post(format!("{base}/api/show"))
                .timeout(Duration::from_secs(10))
                .json(&json!({"model":model}))
                .send()
                .await
                .map_err(|_| io::Error::other("Start Ollama with: ollama serve"))?
                .error_for_status()
                .map_err(|_| io::Error::other("Choose a downloaded local dialogue model."))?
                .json()
                .await
                .map_err(io::Error::other)?;
            if ["remote_model", "remote_host"].into_iter().any(|key| {
                !matches!(details.get(key), None | Some(Value::Null)) && details[key] != ""
            }) {
                return Err(io::Error::other(
                    "Choose a downloaded local dialogue model.",
                ));
            }
            Ok(format!("{base}/v1"))
        }
        _ => Err(io::Error::other(
            "Choose embedded or ollama for local dialogue.",
        )),
    }
}

pub(super) async fn run(with_voice: bool) -> io::Result<()> {
    let source = env::vars_os().collect::<Environment>();
    let game_port = port(&source, "COSYWORLD_CARD_LOCAL_PORT", "3110")?;
    let voice_port = port(&source, "COSYWORLD_CHATTERBOX_PORT", "3111")?;
    let game = format!("127.0.0.1:{game_port}");
    let speech = format!("http://127.0.0.1:{voice_port}");
    drop(std::net::TcpListener::bind(&game)?);
    if with_voice {
        drop(std::net::TcpListener::bind(("127.0.0.1", voice_port))?);
    }
    let data = local_paths::data_directory(&source)?;
    let model = local_paths::model_name(&source);
    if model.ends_with(":cloud") {
        return Err(io::Error::other(
            "Choose a downloaded local dialogue model.",
        ));
    }
    let client = Client::builder()
        .no_proxy()
        .redirect(reqwest::redirect::Policy::none())
        .timeout(Duration::from_secs(1))
        .build()
        .map_err(io::Error::other)?;
    let ai = dialogue(&source, &client, model).await?;
    let mut env = cleaned(&source);
    let mut token = [0u8; 32];
    rand::thread_rng().fill_bytes(&mut token);
    let token: String = token.iter().map(|byte| format!("{byte:02x}")).collect();
    for (key, value) in [
        ("COSYWORLD_LOCAL_APP", "1"),
        ("COSYWORLD_PRIMARY_GAME", "cards"),
        ("COSYWORLD_V2_ADDR", &game),
        ("COSYWORLD_AI_BASE_URL", &ai),
        ("COSYWORLD_AI_MODEL", model),
        ("COSYWORLD_CARD_TEXT_PROFILE", "local"),
        ("COSYWORLD_CHATTERBOX_URL", &speech),
        ("COSYWORLD_CHATTERBOX_TOKEN", &token),
        (
            "COSYWORLD_CHATTERBOX_MODEL",
            if with_voice { "nano" } else { "off" },
        ),
        ("HF_HUB_OFFLINE", "1"),
        ("OLLAMA_NO_CLOUD", "1"),
    ] {
        env.insert(key.into(), value.into());
    }
    env.insert("COSYWORLD_LOCAL_DATA_DIR".into(), data.clone().into());
    if ai == "embedded://llama" {
        let prepared = models::path(&local_paths::model_directory(&source)?, model)
            .map_err(io::Error::other)?;
        let legacy = models::path(Path::new(".runtime/models"), model).map_err(io::Error::other)?;
        let model_file = local_paths::launch_model_file(&source, prepared, legacy);
        if !model_file.is_file() {
            return Err(io::Error::other(
                "Prepare dialogue with: cosyworld-orchestrator local prepare",
            ));
        }
        env.insert("COSYWORLD_LLAMA_MODEL".into(), model_file.into());
        env.insert(
            "COSYWORLD_LLAMA_CONTEXT".into(),
            value(&source, "COSYWORLD_LLAMA_CONTEXT", "2048").into(),
        );
    }
    if let Some(assets) = source.get(OsStr::new("COSYWORLD_ASSETS_DIR")) {
        env.insert("COSYWORLD_ASSETS_DIR".into(), assets.clone());
    }
    std::fs::create_dir_all(&data)?;

    let mut voice = with_voice.then(|| {
        let mut command = match source.get(OsStr::new("COSYWORLD_CHATTERBOX_BINARY")) {
            Some(binary) => Command::new(binary),
            None => {
                let mut command =
                    Command::new(value(&source, "COSYWORLD_CHATTERBOX_PYTHON", "python3"));
                command.arg("v2/local/chatterbox_service.py");
                command
            }
        };
        command
            .args([
                "--port",
                &voice_port.to_string(),
                "--voices",
                value(
                    &source,
                    "COSYWORLD_CHATTERBOX_VOICES",
                    "v2/card-game/voices.json",
                ),
                "--model",
                "nano",
                "--device",
                "cpu",
                "--warm-model",
                "--cache-dir",
            ])
            .arg(data.join("voices"))
            .args([
                "--model-dir",
                value(
                    &source,
                    "COSYWORLD_CHATTERBOX_MODEL_DIR",
                    ".runtime/models/chatterbox-nano",
                ),
            ]);
        command
    });
    let binary = source
        .get(OsStr::new("COSYWORLD_LOCAL_BINARY"))
        .map(PathBuf::from)
        .map_or_else(env::current_exe, Ok)?;
    let mut server = Command::new(binary);
    let origin = format!("http://{game}");
    let mut children = Vec::new();
    let services = async {
        if let Some(command) = &mut voice {
            children.push(spawn(command, &env)?);
            wait_ready(
                &client,
                &format!("{speech}/health"),
                Some(&token),
                &mut children,
            )
            .await?;
        }
        children.push(spawn(&mut server, &env)?);
        wait_ready(&client, &format!("{origin}/health"), None, &mut children).await?;
        println!("CosyWorld: {origin}/");
        loop {
            check_children(&mut children)?;
            time::sleep(Duration::from_secs(1)).await;
        }
    };
    let result = tokio::select! {
        result = services => result,
        result = shutdown() => result,
        result = watch_memory(data) => result,
    };
    stop_children(&mut children).await;
    result
}

fn spawn(command: &mut Command, env: &Environment) -> io::Result<Child> {
    command.env_clear().envs(env).kill_on_drop(true).spawn()
}

async fn stop_children(children: &mut [Child]) {
    #[cfg(unix)]
    for child in children.iter_mut().rev() {
        if let Some(pid) = child.id() {
            let _ = Command::new("kill")
                .args(["-TERM", &pid.to_string()])
                .status()
                .await;
        }
    }
    for child in children.iter_mut().rev() {
        #[cfg(unix)]
        if time::timeout(Duration::from_secs(5), child.wait())
            .await
            .is_ok_and(|status| status.is_ok())
        {
            continue;
        }
        let _ = child.kill().await;
    }
}

fn check_children(children: &mut [Child]) -> io::Result<()> {
    for child in children {
        if let Some(status) = child.try_wait()? {
            return Err(io::Error::other(format!(
                "A local service stopped ({status})."
            )));
        }
    }
    Ok(())
}

async fn wait_ready(
    client: &Client,
    url: &str,
    token: Option<&str>,
    children: &mut [Child],
) -> io::Result<()> {
    let deadline = Instant::now() + Duration::from_secs(120);
    while Instant::now() < deadline {
        check_children(children)?;
        let mut request = client.get(url);
        if let Some(token) = token {
            request = request.bearer_auth(token);
        }
        if request
            .send()
            .await
            .is_ok_and(|response| response.status().is_success())
        {
            return check_children(children);
        }
        time::sleep(Duration::from_millis(200)).await;
    }
    Err(io::Error::other(
        "A local service did not become ready. Check the messages above.",
    ))
}

#[cfg(unix)]
async fn watch_memory(data: PathBuf) -> io::Result<()> {
    let mut peak = 0;
    let mut failures = 0;
    loop {
        match memory::sample(std::process::id(), &mut peak) {
            Ok(snapshot) => {
                failures = 0;
                memory::record(&data, &snapshot);
                if snapshot.over_budget {
                    return Err(io::Error::other(
                        "CosyWorld paused to free memory. Choose Light dialogue.",
                    ));
                }
            }
            Err(error) => {
                failures += 1;
                if failures == 3 {
                    return Err(io::Error::other(error));
                }
            }
        }
        time::sleep(Duration::from_secs(1)).await;
    }
}

#[cfg(not(unix))]
async fn watch_memory(_data: PathBuf) -> io::Result<()> {
    std::future::pending().await
}

async fn shutdown() -> io::Result<()> {
    #[cfg(unix)]
    {
        let mut term = tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate())?;
        tokio::select! {
            _ = term.recv() => Ok(()),
            result = tokio::signal::ctrl_c() => result,
        }
    }
    #[cfg(not(unix))]
    tokio::signal::ctrl_c().await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn child_services_do_not_inherit_hosted_settings_or_proxies() {
        let source = [
            ("PATH", "/bin"),
            ("OPENROUTER_API_KEY", "private"),
            ("COSYWORLD_AI_REGISTRY_JSON", "hosted"),
            ("COSYWORLD_CARD_CHARACTER_MODELS_JSON", "hosted"),
            ("https_proxy", "hosted"),
        ]
        .into_iter()
        .map(|(key, value)| (key.into(), value.into()))
        .collect();
        assert_eq!(
            cleaned(&source),
            Environment::from([("PATH".into(), "/bin".into())])
        );
    }
}
