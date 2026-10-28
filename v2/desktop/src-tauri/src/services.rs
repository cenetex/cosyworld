use rand::RngCore;
use reqwest::blocking::Client;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
    fs,
    net::TcpStream,
    path::{Path, PathBuf},
    process::{Child, Command, Stdio},
    sync::{Arc, Mutex},
    thread,
    time::Duration,
};
use tauri::{AppHandle, Manager, State, WebviewUrl, WebviewWindowBuilder};

const OLLAMA: &str = "http://127.0.0.1:11434";
const GAME: &str = "http://127.0.0.1:3110";

#[derive(Default)]
struct Processes {
    ollama: Option<Child>,
    game: Option<Child>,
    voice: Option<Child>,
    download: Option<Child>,
}

fn stop(child: &mut Option<Child>) {
    if let Some(mut child) = child.take() {
        let _ = child.kill();
        let _ = child.wait();
    }
}

impl Processes {
    fn stop_game(&mut self) {
        stop(&mut self.game);
        stop(&mut self.voice);
    }
}

#[derive(Clone, Default)]
pub struct Services(Arc<Mutex<Processes>>);

impl Services {
    pub fn stop(&self) {
        if let Ok(mut processes) = self.0.lock() {
            processes.stop_game();
            stop(&mut processes.download);
            stop(&mut processes.ollama);
        }
    }
}

#[derive(Serialize, Deserialize)]
pub struct Settings {
    model: String,
    voice: String,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            model: "gemma3:4b".into(),
            voice: "turbo".into(),
        }
    }
}

#[derive(Serialize)]
pub struct Status {
    settings: Settings,
    ollama_ready: bool,
    voices_ready: bool,
}

fn data_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let path = app.path().app_data_dir().map_err(|e| e.to_string())?;
    fs::create_dir_all(&path).map_err(|e| e.to_string())?;
    Ok(path)
}

fn resources(app: &AppHandle) -> Result<PathBuf, String> {
    app.path().resource_dir().map_err(|e| e.to_string())
}

fn setup_window(window: &tauri::WebviewWindow) -> Result<(), String> {
    let url = window.url().map_err(|e| e.to_string())?;
    if window.label() == "main"
        && ((url.scheme() == "tauri" && url.host_str() == Some("localhost"))
            || (url.scheme() == "http" && url.host_str() == Some("tauri.localhost")))
    {
        Ok(())
    } else {
        Err("Open the app's setup window to manage local services.".into())
    }
}

fn client(timeout: u64) -> Result<Client, String> {
    Client::builder()
        .timeout(Duration::from_secs(timeout))
        .build()
        .map_err(|e| e.to_string())
}

fn valid_model(model: &str) -> bool {
    !model.is_empty()
        && model.len() <= 160
        && !model.ends_with(":cloud")
        && model
            .bytes()
            .all(|c| c.is_ascii_alphanumeric() || b"._:/-".contains(&c))
}

fn valid_voice(voice: &str) -> Result<(), String> {
    if matches!(voice, "turbo" | "nano") {
        Ok(())
    } else {
        Err("Choose Turbo or Nano for the voices.".into())
    }
}

fn voice_dir(data: &Path, voice: &str) -> PathBuf {
    data.join("models").join(format!("chatterbox-{voice}"))
}

fn voice_ready(data: &Path, voice: &str) -> bool {
    let root = voice_dir(data, voice);
    [
        "ve.safetensors",
        "s3gen_meanflow.safetensors",
        "tokenizer_config.json",
        if voice == "nano" {
            "t3_nano_v1.safetensors"
        } else {
            "t3_turbo_v1.safetensors"
        },
    ]
    .iter()
    .all(|file| root.join(file).is_file())
}

fn voice_binary(app: &AppHandle) -> Result<PathBuf, String> {
    let name = if cfg!(windows) {
        "cosyworld-voices.exe"
    } else {
        "cosyworld-voices"
    };
    Ok(resources(app)?
        .join("voice")
        .join("cosyworld-voices")
        .join(name))
}

fn logged(command: &mut Command, data: &Path) -> Result<Child, String> {
    let log = fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(data.join("local-services.log"))
        .map_err(|e| e.to_string())?;
    command
        .stdin(Stdio::null())
        .stdout(Stdio::from(log.try_clone().map_err(|e| e.to_string())?))
        .stderr(Stdio::from(log))
        .spawn()
        .map_err(|e| e.to_string())
}

fn clean_environment(command: &mut Command) {
    for (key, _) in std::env::vars_os() {
        let name = key.to_string_lossy();
        if name.starts_with("COSYWORLD_")
            || name.starts_with("OPENROUTER_")
            || name.starts_with("OPENAI_")
        {
            command.env_remove(key);
        }
    }
}

fn ensure_ollama(state: &Services, data: &Path) -> Result<(), String> {
    if client(2)?
        .get(format!("{OLLAMA}/api/tags"))
        .send()
        .is_ok_and(|r| r.status().is_success())
    {
        return Ok(());
    }
    let mut processes = state
        .0
        .lock()
        .map_err(|_| "The local services need a restart.")?;
    if processes.ollama.is_none() {
        let candidates = [
            PathBuf::from("ollama"),
            PathBuf::from("/opt/homebrew/bin/ollama"),
            PathBuf::from("/usr/local/bin/ollama"),
            PathBuf::from("/Applications/Ollama.app/Contents/Resources/ollama"),
        ];
        for path in candidates {
            let mut command = Command::new(path);
            command
                .arg("serve")
                .env("OLLAMA_HOST", "127.0.0.1:11434")
                .env("OLLAMA_NO_CLOUD", "1");
            if let Ok(child) = logged(&mut command, data) {
                processes.ollama = Some(child);
                break;
            }
        }
    }
    drop(processes);
    for _ in 0..50 {
        if client(1)?
            .get(format!("{OLLAMA}/api/tags"))
            .send()
            .is_ok_and(|r| r.status().is_success())
        {
            return Ok(());
        }
        thread::sleep(Duration::from_millis(200));
    }
    Err("Install Ollama, then open CosyWorld again. The download link is below.".into())
}

#[tauri::command]
pub async fn status(app: AppHandle, window: tauri::WebviewWindow) -> Result<Status, String> {
    setup_window(&window)?;
    tauri::async_runtime::spawn_blocking(move || {
        let data = data_dir(&app)?;
        let settings = fs::read(data.join("settings.json"))
            .ok()
            .and_then(|bytes| serde_json::from_slice::<Settings>(&bytes).ok())
            .unwrap_or_default();
        let voices_ready = voice_ready(&data, &settings.voice);
        let ollama_ready = client(2)?
            .get(format!("{OLLAMA}/api/tags"))
            .send()
            .is_ok_and(|r| r.status().is_success());
        Ok(Status {
            settings,
            voices_ready,
            ollama_ready,
        })
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn prepare_dialogue(
    app: AppHandle,
    window: tauri::WebviewWindow,
    state: State<'_, Services>,
    model: String,
) -> Result<(), String> {
    setup_window(&window)?;
    if !valid_model(&model) {
        return Err("Choose a local Ollama model name.".into());
    }
    let state = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        ensure_ollama(&state, &data_dir(&app)?)?;
        let result: Value = client(1800)?
            .post(format!("{OLLAMA}/api/pull"))
            .json(&json!({"model":model,"stream":false}))
            .send()
            .map_err(|e| e.to_string())?
            .error_for_status()
            .map_err(|e| e.to_string())?
            .json()
            .map_err(|e| e.to_string())?;
        if let Some(error) = result["error"].as_str() {
            return Err(error.to_string());
        }
        Ok(())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn prepare_voices(
    app: AppHandle,
    window: tauri::WebviewWindow,
    state: State<'_, Services>,
    voice: String,
) -> Result<(), String> {
    setup_window(&window)?;
    valid_voice(&voice)?;
    let state = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let data = data_dir(&app)?;
        let mut command = Command::new(voice_binary(&app)?);
        command
            .args(["--model", &voice, "--download-model"])
            .arg(voice_dir(&data, &voice))
            .env("HF_HOME", data.join("downloads"));
        command.env_remove("HF_HUB_OFFLINE");
        {
            let mut processes = state
                .0
                .lock()
                .map_err(|_| "The local services need a restart.")?;
            if processes.download.is_some() {
                return Err("The voices are already being prepared.".into());
            }
            processes.download = Some(logged(&mut command, &data)?);
        }
        let status = loop {
            let mut processes = state
                .0
                .lock()
                .map_err(|_| "The local services need a restart.")?;
            let child = processes
                .download
                .as_mut()
                .ok_or("The voice setup has closed.")?;
            if let Some(status) = child.try_wait().map_err(|e| e.to_string())? {
                processes.download.take();
                break status;
            }
            drop(processes);
            thread::sleep(Duration::from_millis(250));
        };
        if status.success() {
            Ok(())
        } else {
            Err("The voice download needs another try. Details are in local-services.log.".into())
        }
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn start_game(
    app: AppHandle,
    window: tauri::WebviewWindow,
    state: State<'_, Services>,
    model: String,
    voice: String,
) -> Result<(), String> {
    setup_window(&window)?;
    if !valid_model(&model) {
        return Err("Choose a local Ollama model name.".into());
    }
    valid_voice(&voice)?;
    let state = state.inner().clone();
    let handle = app.clone();
    tauri::async_runtime::spawn_blocking(move || start_services(&handle, &state, &model, &voice))
        .await
        .map_err(|e| e.to_string())??;
    WebviewWindowBuilder::new(
        &app,
        "game",
        WebviewUrl::External(GAME.parse().map_err(|_| "Choose a local game URL.")?),
    )
    .title("CosyWorld")
    .inner_size(1280.0, 800.0)
    .min_inner_size(390.0, 540.0)
    .data_directory(data_dir(&app)?.join("browser"))
    .build()
    .map_err(|e| e.to_string())?;
    if let Some(window) = app.get_webview_window("main") {
        window.hide().map_err(|e| e.to_string())?;
    }
    Ok(())
}

fn start_services(
    app: &AppHandle,
    state: &Services,
    model: &str,
    voice: &str,
) -> Result<(), String> {
    let data = data_dir(app)?;
    ensure_ollama(state, &data)?;
    if !voice_ready(&data, voice) {
        return Err("Prepare the character voices first.".into());
    }
    let shown: Value = client(10)?
        .post(format!("{OLLAMA}/api/show"))
        .json(&json!({"model":model}))
        .send()
        .map_err(|e| e.to_string())?
        .error_for_status()
        .map_err(|_| "Prepare this dialogue model first.")?
        .json()
        .map_err(|e| e.to_string())?;
    if shown.get("remote_model").is_some() || shown.get("remote_host").is_some() {
        return Err("Choose a downloaded local dialogue model.".into());
    }
    if TcpStream::connect("127.0.0.1:3110").is_ok() || TcpStream::connect("127.0.0.1:3111").is_ok()
    {
        return Err(
            "Another local game is using the app's ports. Close it, then try again.".into(),
        );
    }
    let mut bytes = [0u8; 32];
    rand::thread_rng().fill_bytes(&mut bytes);
    let token: String = bytes.iter().map(|b| format!("{b:02x}")).collect();
    let mut processes = state
        .0
        .lock()
        .map_err(|_| "The local services need a restart.")?;
    processes.stop_game();
    let root = resources(app)?;
    let mut command = Command::new(voice_binary(app)?);
    command
        .args(["--port", "3111", "--model", voice, "--voices"])
        .arg(root.join("voices/voices.json"))
        .arg("--model-dir")
        .arg(voice_dir(&data, voice))
        .arg("--cache-dir")
        .arg(data.join("voices"))
        .env("COSYWORLD_CHATTERBOX_TOKEN", &token)
        .env("HF_HUB_OFFLINE", "1");
    processes.voice = Some(logged(&mut command, &data)?);
    let name = if cfg!(windows) {
        "cosyworld-orchestrator.exe"
    } else {
        "cosyworld-orchestrator"
    };
    let mut command = Command::new(root.join("game").join(name));
    clean_environment(&mut command);
    command
        .env("COSYWORLD_LOCAL_APP", "1")
        .env("COSYWORLD_PRIMARY_GAME", "cards")
        .env("COSYWORLD_V2_ADDR", "127.0.0.1:3110")
        .env("COSYWORLD_AI_BASE_URL", format!("{OLLAMA}/v1"))
        .env("COSYWORLD_AI_MODEL", model)
        .env("COSYWORLD_CARD_TEXT_PROFILE", "local")
        .env("COSYWORLD_LOCAL_DATA_DIR", &data)
        .env("COSYWORLD_CHATTERBOX_URL", "http://127.0.0.1:3111")
        .env("COSYWORLD_CHATTERBOX_TOKEN", &token)
        .env("COSYWORLD_CHATTERBOX_MODEL", voice);
    match logged(&mut command, &data) {
        Ok(child) => processes.game = Some(child),
        Err(error) => {
            processes.stop_game();
            return Err(error);
        }
    }
    let mut ready = false;
    for _ in 0..100 {
        if client(1)?
            .get(format!("{GAME}/card-game/local"))
            .send()
            .is_ok_and(|r| r.status().is_success())
        {
            ready = true;
            break;
        }
        thread::sleep(Duration::from_millis(100));
    }
    if !ready {
        processes.stop_game();
        return Err("The local services need a restart. Details are in local-services.log.".into());
    }
    let settings = serde_json::to_vec(&Settings {
        model: model.into(),
        voice: voice.into(),
    })
    .map_err(|e| e.to_string())?;
    fs::write(data.join("settings.json"), settings).map_err(|e| e.to_string())?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn model_names_stay_local_and_voice_names_are_closed() {
        assert!(valid_model("gemma3:4b"));
        assert!(!valid_model("model:cloud"));
        assert!(!valid_model("$(command)"));
        assert!(valid_voice("nano").is_ok());
        assert!(valid_voice("../other").is_err());
    }

    #[cfg(unix)]
    #[test]
    fn game_shutdown_preserves_the_owned_ollama_until_app_exit() {
        let sleeper = || Command::new("sleep").arg("30").spawn().unwrap();
        let mut processes = Processes {
            ollama: Some(sleeper()),
            game: Some(sleeper()),
            voice: Some(sleeper()),
            download: None,
        };
        processes.stop_game();
        assert!(processes.game.is_none());
        assert!(processes.voice.is_none());
        assert!(processes
            .ollama
            .as_mut()
            .unwrap()
            .try_wait()
            .unwrap()
            .is_none());
        let services = Services(Arc::new(Mutex::new(processes)));
        services.stop();
        assert!(services.0.lock().unwrap().ollama.is_none());
    }
}
