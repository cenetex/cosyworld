//! Pinned dialogue downloads are checked once during setup.
use serde::Deserialize;
use sha2::{Digest, Sha256};
use std::{
    collections::BTreeMap,
    fs,
    io::{Read, Write},
    path::{Path, PathBuf},
    time::UNIX_EPOCH,
};

#[derive(Deserialize)]
pub struct Model {
    file: String,
    bytes: u64,
    sha256: String,
    url: String,
}

pub fn model(name: &str) -> Result<Model, String> {
    serde_json::from_str::<BTreeMap<String, Model>>(include_str!("models.json"))
        .map_err(|e| e.to_string())?
        .remove(name)
        .ok_or_else(|| "Choose Standard or Light for dialogue.".into())
}

pub fn path(directory: &Path, name: &str) -> Result<PathBuf, String> {
    Ok(directory.join(model(name)?.file))
}

fn fingerprint(path: &Path) -> Result<serde_json::Value, String> {
    let metadata = fs::metadata(path).map_err(|e| e.to_string())?;
    let modified = metadata
        .modified()
        .map_err(|e| e.to_string())?
        .duration_since(UNIX_EPOCH)
        .map_err(|e| e.to_string())?;
    Ok(
        serde_json::json!({"bytes":metadata.len(),"modifiedSecs":modified.as_secs(),"modifiedNanos":modified.subsec_nanos()}),
    )
}

pub fn ready(directory: &Path, name: &str) -> bool {
    let Ok(spec) = model(name) else {
        return false;
    };
    let Ok(file) = path(directory, name) else {
        return false;
    };
    let Ok(mark) = fs::read(file.with_extension("verified.json")) else {
        return false;
    };
    let Ok(mark) = serde_json::from_slice::<serde_json::Value>(&mark) else {
        return false;
    };
    mark["sha256"] == spec.sha256
        && mark["fingerprint"]["bytes"] == spec.bytes
        && fingerprint(&file).is_ok_and(|current| current == mark["fingerprint"])
}

pub fn prepare(directory: &Path, name: &str) -> Result<(), String> {
    if ready(directory, name) {
        return Ok(());
    }
    let spec = model(name)?;
    let file = path(directory, name)?;
    fs::create_dir_all(directory).map_err(|e| e.to_string())?;
    if !file.is_file() || verify(&file, &spec).is_err() {
        let client = reqwest::blocking::Client::builder()
            .timeout(std::time::Duration::from_secs(1800))
            .build()
            .map_err(|e| e.to_string())?;
        let mut response = client
            .get(&spec.url)
            .send()
            .map_err(|e| e.to_string())?
            .error_for_status()
            .map_err(|e| e.to_string())?;
        let (temporary, mut output) =
            Temporary::create(&file, "download").map_err(|e| e.to_string())?;
        let mut buffer = [0u8; 64 * 1024];
        let mut received = 0u64;
        loop {
            let size = response.read(&mut buffer).map_err(|e| e.to_string())?;
            if size == 0 {
                break;
            }
            received += size as u64;
            if received > spec.bytes {
                return Err("The dialogue download needs another try.".into());
            }
            output
                .write_all(&buffer[..size])
                .map_err(|e| e.to_string())?;
        }
        output.sync_all().map_err(|e| e.to_string())?;
        drop(output);
        verify(&temporary.0, &spec)?;
        fs::rename(&temporary.0, &file).map_err(|e| e.to_string())?;
    }
    let mark = serde_json::json!({"sha256":spec.sha256,"fingerprint":fingerprint(&file)?});
    let (temporary, mut output) =
        Temporary::create(&file, "verified.pending").map_err(|e| e.to_string())?;
    serde_json::to_writer(&mut output, &mark).map_err(|e| e.to_string())?;
    output.sync_all().map_err(|e| e.to_string())?;
    drop(output);
    fs::rename(&temporary.0, file.with_extension("verified.json")).map_err(|e| e.to_string())?;
    Ok(())
}

struct Temporary(PathBuf);

impl Temporary {
    fn create(target: &Path, kind: &str) -> std::io::Result<(Self, fs::File)> {
        let path = target.with_extension(format!("{:032x}.{kind}", rand::random::<u128>()));
        let file = fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&path)?;
        Ok((Self(path), file))
    }
}

impl Drop for Temporary {
    fn drop(&mut self) {
        let _ = fs::remove_file(&self.0);
    }
}

fn verify(path: &Path, spec: &Model) -> Result<(), String> {
    if fs::metadata(path).map_err(|e| e.to_string())?.len() != spec.bytes {
        return Err("Refresh the dialogue download.".into());
    }
    let mut file = fs::File::open(path).map_err(|e| e.to_string())?;
    let mut hash = Sha256::new();
    let mut buffer = [0u8; 64 * 1024];
    loop {
        let size = file.read(&mut buffer).map_err(|e| e.to_string())?;
        if size == 0 {
            break;
        }
        hash.update(&buffer[..size]);
    }
    if format!("{:x}", hash.finalize()) != spec.sha256 {
        return Err("Refresh the dialogue download.".into());
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn model_choices_fit_the_local_budget_and_keep_their_pinned_hashes() {
        for name in ["gemma3:4b", "gemma3:1b"] {
            let spec = model(name).unwrap();
            assert!(spec.bytes < 3 * 1024 * 1024 * 1024);
            assert_eq!(spec.sha256.len(), 64);
            assert!(spec.url.ends_with(&spec.sha256));
        }
        assert!(model("model:cloud").is_err());
    }
}
