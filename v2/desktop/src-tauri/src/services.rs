use crate::memory;
use crate::models;
use rand::RngCore;
use reqwest::blocking::Client;
use serde::{Deserialize, Serialize};
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

const GAME: &str = "http://127.0.0.1:3110";

#[derive(Default)]
struct Processes {
    game: Option<Child>,
    voice: Option<Child>,
    download: Option<Child>,
    generation: u64,
    memory_pause: Option<MemoryPause>,
}

#[derive(Clone, Serialize)]
struct MemoryPause {
    generation: u64,
    over_budget: bool,
}

fn stop(child: &mut Option<Child>) {
    if let Some(mut child) = child.take() {
        let _ = child.kill();
        let _ = child.wait();
    }
}

impl Processes {
    fn stop_game(&mut self) {
        self.generation += 1;
        stop(&mut self.game);
        stop(&mut self.voice);
    }
}

fn pause_for_memory(processes: &mut Processes, over_budget: bool) {
    processes.stop_game();
    processes.memory_pause = Some(MemoryPause {
        generation: processes.generation,
        over_budget,
    });
}

#[derive(Clone, Default)]
pub struct Services(Arc<Mutex<Processes>>);

impl Services {
    pub fn stop(&self) {
        if let Ok(mut processes) = self.0.lock() {
            processes.stop_game();
            stop(&mut processes.download);
        }
    }

    fn watch_memory(&self, app: AppHandle, data: PathBuf, generation: u64) {
        let state = self.clone();
        thread::spawn(move || {
            let mut peak = 0;
            let mut failures = 0;
            loop {
                if state.0.lock().map_or(true, |p| p.generation != generation) {
                    return;
                }
                let pause = match memory::sample(std::process::id(), &mut peak) {
                    Ok(snapshot) => {
                        failures = 0;
                        memory::record(&data, &snapshot);
                        snapshot.over_budget.then_some(true)
                    }
                    Err(_) => {
                        failures += 1;
                        if failures >= 3 {
                            Some(false)
                        } else {
                            None
                        }
                    }
                };
                if let Some(over_budget) = pause {
                    if let Ok(mut processes) = state.0.lock() {
                        if processes.generation != generation {
                            return;
                        }
                        pause_for_memory(&mut processes, over_budget);
                    }
                    if let Some(window) = app.get_webview_window("game") {
                        let _ = window.hide();
                    }
                    if let Some(window) = app.get_webview_window("main") {
                        let _ = window.show();
                        let _ = window.set_focus();
                    }
                    return;
                }
                thread::sleep(Duration::from_secs(1));
            }
        });
    }
}

fn pause_message(pause: &MemoryPause) -> String {
    if pause.over_budget {
        "CosyWorld paused to free memory. Choose Light. Use Prepare models. Then choose Play."
            .into()
    } else {
        "CosyWorld paused while checking memory. Choose Play to try again.".into()
    }
}

fn wait_ready(
    state: &Services,
    generation: u64,
    url: &str,
    token: Option<&str>,
) -> Result<(), String> {
    for _ in 0..1200 {
        {
            let mut processes = state
                .0
                .lock()
                .map_err(|_| "The local services need a restart.")?;
            if let Some(pause) = &processes.memory_pause {
                return Err(pause_message(pause));
            }
            if processes.generation != generation {
                return Err("The local app has closed.".into());
            }
            let Processes { voice, game, .. } = &mut *processes;
            for child in [voice, game] {
                if child
                    .as_mut()
                    .is_some_and(|p| p.try_wait().ok().flatten().is_some())
                {
                    return Err(
                        "CosyWorld needs another try. Choose Light if memory is low.".into(),
                    );
                }
            }
        }
        let mut request = client(1)?.get(url);
        if let Some(token) = token {
            request = request.bearer_auth(token);
        }
        if request.send().is_ok_and(|r| r.status().is_success()) {
            return Ok(());
        }
        thread::sleep(Duration::from_millis(100));
    }
    Err("CosyWorld needs another try. Choose Light if memory is low.".into())
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
            voice: "nano".into(),
        }
    }
}

#[derive(Serialize)]
pub struct Status {
    settings: Settings,
    dialogue_ready: bool,
    voices_ready: bool,
    memory_pause: Option<MemoryPause>,
}

fn data_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let path = match std::env::var_os("COSYWORLD_LOCAL_DATA_DIR") {
        Some(path) => PathBuf::from(path),
        None => app.path().app_data_dir().map_err(|e| e.to_string())?,
    };
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
    models::model(model).is_ok()
}

fn valid_voice(voice: &str) -> Result<(), String> {
    if voice == "nano" {
        Ok(())
    } else {
        Err("Choose Nano for the character voices.".into())
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

#[tauri::command]
pub async fn status(
    app: AppHandle,
    window: tauri::WebviewWindow,
    state: State<'_, Services>,
) -> Result<Status, String> {
    setup_window(&window)?;
    let state = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let data = data_dir(&app)?;
        let mut settings = fs::read(data.join("settings.json"))
            .ok()
            .and_then(|bytes| serde_json::from_slice::<Settings>(&bytes).ok())
            .unwrap_or_default();
        if !valid_model(&settings.model) {
            settings.model = Settings::default().model;
        }
        settings.voice = "nano".into();
        let voices_ready = voice_ready(&data, &settings.voice);
        let dialogue_ready = models::ready(&data, &settings.model);
        Ok(Status {
            settings,
            voices_ready,
            dialogue_ready,
            memory_pause: state
                .0
                .lock()
                .map_err(|_| "The local services need a restart.")?
                .memory_pause
                .clone(),
        })
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn prepare_dialogue(
    app: AppHandle,
    window: tauri::WebviewWindow,
    model: String,
) -> Result<(), String> {
    setup_window(&window)?;
    if !valid_model(&model) {
        return Err("Choose Standard or Light for dialogue.".into());
    }
    tauri::async_runtime::spawn_blocking(move || models::prepare(&data_dir(&app)?, &model))
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
        return Err("Choose Standard or Light for dialogue.".into());
    }
    valid_voice(&voice)?;
    let state = state.inner().clone();
    let handle = app.clone();
    let worker = state.clone();
    tauri::async_runtime::spawn_blocking(move || start_services(&handle, &worker, &model, &voice))
        .await
        .map_err(|e| e.to_string())??;
    if let Some(pause) = &state
        .0
        .lock()
        .map_err(|_| "The local services need a restart.")?
        .memory_pause
    {
        return Err(pause_message(pause));
    }
    if let Some(window) = app.get_webview_window("game") {
        window
            .navigate(GAME.parse().map_err(|_| "Choose a local game URL.")?)
            .map_err(|e| e.to_string())?;
        window.show().map_err(|e| e.to_string())?;
        window.set_focus().map_err(|e| e.to_string())?;
    } else {
        let builder = WebviewWindowBuilder::new(
            &app,
            "game",
            WebviewUrl::External(GAME.parse().map_err(|_| "Choose a local game URL.")?),
        )
        .title("CosyWorld")
        .inner_size(1280.0, 800.0)
        .min_inner_size(390.0, 540.0)
        .data_directory(data_dir(&app)?.join("browser"));
        #[cfg(target_os = "macos")]
        let builder = if std::env::var_os("COSYWORLD_LOCAL_DATA_DIR").is_some() {
            use sha2::{Digest, Sha256};
            let digest = Sha256::digest(data_dir(&app)?.as_os_str().as_encoded_bytes());
            let mut identifier = [0; 16];
            identifier.copy_from_slice(&digest[..16]);
            builder.data_store_identifier(identifier)
        } else {
            builder
        };
        builder.build().map_err(|e| e.to_string())?;
    }
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
    if !models::ready(&data, model) {
        return Err("Prepare the dialogue model first.".into());
    }
    if !voice_ready(&data, voice) {
        return Err("Prepare the character voices first.".into());
    }
    let generation = {
        let mut processes = state
            .0
            .lock()
            .map_err(|_| "The local services need a restart.")?;
        processes.stop_game();
        processes.memory_pause = None;
        processes.generation
    };
    if TcpStream::connect("127.0.0.1:3110").is_ok() || TcpStream::connect("127.0.0.1:3111").is_ok()
    {
        return Err(
            "Another local game is using the app's ports. Close it, then try again.".into(),
        );
    }
    let mut bytes = [0u8; 32];
    rand::thread_rng().fill_bytes(&mut bytes);
    let token: String = bytes.iter().map(|b| format!("{b:02x}")).collect();
    let root = resources(app)?;
    let mut command = Command::new(voice_binary(app)?);
    clean_environment(&mut command);
    command
        .args([
            "--port",
            "3111",
            "--model",
            voice,
            "--device",
            "cpu",
            "--warm-model",
            "--voices",
        ])
        .arg(root.join("voices/voices.json"))
        .arg("--model-dir")
        .arg(voice_dir(&data, voice))
        .arg("--cache-dir")
        .arg(data.join("voices"))
        .env("COSYWORLD_CHATTERBOX_TOKEN", &token)
        .env("HF_HUB_OFFLINE", "1");
    state
        .0
        .lock()
        .map_err(|_| "The local services need a restart.")?
        .voice = Some(logged(&mut command, &data)?);
    state.watch_memory(app.clone(), data.clone(), generation);
    let result = (|| {
        wait_ready(
            state,
            generation,
            "http://127.0.0.1:3111/health",
            Some(&token),
        )?;
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
            .env("COSYWORLD_AI_BASE_URL", "embedded://llama")
            .env("COSYWORLD_LLAMA_MODEL", models::path(&data, model)?)
            .env("COSYWORLD_LLAMA_CONTEXT", "2048")
            .env("COSYWORLD_AI_MODEL", model)
            .env("COSYWORLD_CARD_TEXT_PROFILE", "local")
            .env("COSYWORLD_LOCAL_DATA_DIR", &data)
            .env("COSYWORLD_CHATTERBOX_URL", "http://127.0.0.1:3111")
            .env("COSYWORLD_CHATTERBOX_TOKEN", &token)
            .env("COSYWORLD_CHATTERBOX_MODEL", voice);
        {
            let mut processes = state
                .0
                .lock()
                .map_err(|_| "The local services need a restart.")?;
            if processes.generation != generation {
                return Err("The local app has closed.".into());
            }
            processes.game = Some(logged(&mut command, &data)?);
        }
        wait_ready(state, generation, &format!("{GAME}/card-game/local"), None)?;
        let settings = serde_json::to_vec(&Settings {
            model: model.into(),
            voice: voice.into(),
        })
        .map_err(|e| e.to_string())?;
        fs::write(data.join("settings.pending"), settings).map_err(|e| e.to_string())?;
        fs::rename(data.join("settings.pending"), data.join("settings.json"))
            .map_err(|e| e.to_string())?;
        Ok(())
    })();
    if result.is_err() {
        if let Ok(mut processes) = state.0.lock() {
            processes.stop_game();
        }
    }
    result
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
    fn game_shutdown_closes_owned_helpers() {
        let sleeper = || Command::new("sleep").arg("30").spawn().unwrap();
        let mut processes = Processes {
            game: Some(sleeper()),
            voice: Some(sleeper()),
            download: None,
            ..Processes::default()
        };
        processes.stop_game();
        assert!(processes.game.is_none());
        assert!(processes.voice.is_none());
        let services = Services(Arc::new(Mutex::new(processes)));
        services.stop();
        assert!(services.0.lock().unwrap().game.is_none());
    }

    #[cfg(unix)]
    #[test]
    fn memory_pause_stops_owned_models_and_keeps_an_unrelated_process() {
        let sleeper = || Command::new("sleep").arg("30").spawn().unwrap();
        let mut other = sleeper();
        let mut processes = Processes {
            game: Some(sleeper()),
            voice: Some(sleeper()),
            ..Processes::default()
        };
        pause_for_memory(&mut processes, true);
        assert!(processes.game.is_none() && processes.voice.is_none());
        assert!(processes.memory_pause.unwrap().over_budget);
        assert!(other.try_wait().unwrap().is_none());
        other.kill().unwrap();
        other.wait().unwrap();
    }
}
