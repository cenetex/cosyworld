use super::*;

use rand::{rngs::OsRng, RngCore};

pub(crate) fn random_hex(byte_count: usize) -> String {
    let mut bytes = vec![0_u8; byte_count];
    OsRng.fill_bytes(&mut bytes);
    let mut out = String::with_capacity(byte_count * 2);
    for byte in bytes {
        out.push_str(&format!("{byte:02x}"));
    }
    out
}

pub(crate) fn sqlite_error(error: rusqlite::Error) -> io::Error {
    io::Error::other(error)
}

pub(crate) fn now_millis() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis() as u64)
        .unwrap_or(0)
}
pub(crate) fn now_unix_secs() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_secs())
        .unwrap_or(0)
}

pub(crate) fn env_flag(name: &str) -> bool {
    std::env::var(name)
        .map(|value| matches!(value.as_str(), "1" | "true" | "yes" | "on"))
        .unwrap_or(false)
}

pub(crate) fn generated_asset_dir_from_env() -> PathBuf {
    std::env::var("COSYWORLD_GENERATED_ASSET_DIR")
        .ok()
        .or_else(|| std::env::var("COSYWORLD_V2_GENERATED_ASSET_DIR").ok())
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from(".runtime/generated"))
}

pub(crate) fn required_health_urls_from_env() -> Vec<String> {
    std::env::var("COSYWORLD_REQUIRED_HEALTH_URLS")
        .unwrap_or_default()
        .split(',')
        .map(str::trim)
        .filter(|url| !url.is_empty())
        .map(str::to_string)
        .collect()
}

pub(crate) async fn required_processes_ready(urls: &[String]) -> Result<(), String> {
    if urls.is_empty() {
        return Ok(());
    }
    let client = reqwest::Client::builder()
        .no_proxy()
        .timeout(Duration::from_secs(2))
        .build()
        .map_err(|error| format!("readiness client unavailable: {error}"))?;
    let checks = urls.iter().map(|url| {
        let client = client.clone();
        let url = url.clone();
        async move {
            let response = client
                .get(&url)
                .send()
                .await
                .map_err(|error| format!("{url}: {error}"))?;
            if response.status().is_success() {
                Ok(())
            } else {
                Err(format!("{url}: HTTP {}", response.status()))
            }
        }
    });
    let mut tasks = checks.map(|check| tokio::spawn(check)).collect::<Vec<_>>();
    for task in tasks.drain(..) {
        match task.await {
            Ok(Ok(())) => {}
            Ok(Err(error)) => return Err(error),
            Err(error) => return Err(format!("tenant readiness check failed: {error}")),
        }
    }
    Ok(())
}
