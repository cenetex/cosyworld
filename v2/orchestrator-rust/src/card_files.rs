use axum::body::Bytes;
use serde::Deserialize;
use sha2::{Digest, Sha256};
use std::{
    collections::HashMap,
    fs,
    path::{Component, Path, PathBuf},
    process::Command,
    sync::{Mutex, OnceLock},
};

#[derive(Deserialize)]
struct Manifest {
    sha256: String,
    dirs: HashMap<String, PathBuf>,
    files: HashMap<String, Entry>,
}

#[derive(Deserialize)]
struct Entry {
    #[serde(rename = "type")]
    content_type: Option<String>,
    sha256: String,
    size: usize,
    source: Option<String>,
    #[serde(default)]
    offset: usize,
}

struct File {
    entry: Entry,
    etag: String,
    path: PathBuf,
    bytes: Option<Bytes>,
}

pub struct Store {
    sha256: String,
    files: HashMap<String, File>,
}

pub fn is_media(content_type: &str) -> bool {
    !content_type.starts_with("image/svg+xml")
        && ["image/", "audio/", "video/"]
            .iter()
            .any(|prefix| content_type.starts_with(prefix))
}

impl Store {
    pub fn open(root: &Path) -> Result<Self, String> {
        let path = root.join("manifest.json");
        let text = fs::read_to_string(&path).map_err(|e| format!("{}: {e}", path.display()))?;
        Self::parse(root, &text, true)
    }

    fn parse(root: &Path, text: &str, verify: bool) -> Result<Self, String> {
        let manifest: Manifest =
            serde_json::from_str(text).map_err(|e| format!("manifest.json: {e}"))?;
        let locate = |key: &str| {
            let (dir, rest) = key.split_once('/').unwrap_or_default();
            let dir = manifest
                .dirs
                .get(dir)
                .ok_or(format!("{key}: unknown directory"));
            Ok::<_, String>(root.join(dir?).join(rest))
        };
        let mut files = HashMap::new();
        for (key, entry) in manifest.files {
            let path = locate(inside(entry.source.as_deref().unwrap_or(&key))?)?;
            let memory = entry.content_type.as_deref().is_some_and(|t| !is_media(t));
            let mut bytes = None;
            if entry.source.is_none() && (verify || memory) {
                let body = fs::read(&path).map_err(|e| format!("{key}: {e}"))?;
                if verify
                    && (body.len() != entry.size
                        || format!("{:x}", Sha256::digest(&body)) != entry.sha256)
                {
                    return Err(format!("{key} does not match manifest.json"));
                }
                bytes = memory.then(|| Bytes::from(body));
            }
            let etag = format!("\"{}\"", entry.sha256);
            files.insert(
                key,
                File {
                    entry,
                    etag,
                    path,
                    bytes,
                },
            );
        }
        Ok(Self {
            sha256: manifest.sha256,
            files,
        })
    }

    fn public(&self, path: &str) -> Option<&File> {
        let file = self.files.get(&format!("card-game/{path}"))?;
        file.entry.content_type.is_some().then_some(file)
    }

    pub fn get(&self, path: &str) -> Option<(&str, Bytes)> {
        let file = self.public(path)?;
        let bytes = match &file.bytes {
            Some(bytes) => bytes.clone(),
            None => {
                let body = Bytes::from(fs::read(&file.path).ok()?);
                let Entry { offset, size, .. } = file.entry;
                (body.len().checked_sub(offset) == Some(size)).then(|| body.slice(offset..))?
            }
        };
        Some((file.entry.content_type.as_deref()?, bytes))
    }

    pub fn read(&self, key: &str) -> Option<Bytes> {
        let file = self.files.get(key)?;
        let body = fs::read(&file.path).ok()?;
        (format!("{:x}", Sha256::digest(&body)) == file.entry.sha256).then(|| Bytes::from(body))
    }

    pub fn sha256(&self, key: &str) -> Option<&str> {
        Some(&self.files.get(key)?.entry.sha256)
    }
}

fn inside(key: &str) -> Result<&str, String> {
    Path::new(key)
        .components()
        .all(|part| matches!(part, Component::Normal(_)))
        .then_some(key)
        .ok_or(format!("{key} is not a path inside the assets directory"))
}

fn source_tree() -> Result<Store, String> {
    let root = Path::new(env!("CARGO_MANIFEST_DIR")).join("..");
    let output = Command::new("node")
        .arg(root.join("scripts/build-card-assets.mjs"))
        .args(["--manifest", "-"])
        .output()
        .map_err(|e| format!("Reading card assets from the source tree needs Node.js: {e}"))?;
    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).into_owned());
    }
    Store::parse(&root, &String::from_utf8_lossy(&output.stdout), false)
}

fn open() -> Result<Store, String> {
    if let Some(dir) = std::env::var_os("COSYWORLD_ASSETS_DIR") {
        return Store::open(Path::new(&dir));
    }
    let beside = std::env::current_exe()
        .ok()
        .and_then(|exe| Some(exe.parent()?.join("assets")))
        .filter(|dir| dir.join("manifest.json").is_file());
    match beside {
        Some(dir) => Store::open(&dir),
        None => source_tree(),
    }
}

fn store() -> &'static Store {
    load().unwrap_or_else(|error| panic!("Card assets: {error}"))
}

const SERVER: [&str; 6] = [
    "card-game/senses.json",
    "card-game/assets/discord-faces.json",
    "card-game/assets/music/radio-catalog.json",
    "card_narrative/authored-text.json",
    "card_shared/content.json",
    "card_shared/narrator.js",
];

fn checked(store: Store) -> Result<Store, String> {
    match SERVER.iter().find(|key| !store.files.contains_key(**key)) {
        Some(key) => Err(format!("manifest.json does not list {key}")),
        None => Ok(store),
    }
}

pub fn load() -> Result<&'static Store, String> {
    static STORE: OnceLock<Result<Store, String>> = OnceLock::new();
    STORE
        .get_or_init(|| open().and_then(checked))
        .as_ref()
        .map_err(Clone::clone)
}

pub fn manifest_sha256() -> &'static str {
    &store().sha256
}

pub fn get(path: &str) -> Option<(&'static str, Bytes)> {
    store().get(path)
}

pub fn etag(path: &str) -> Option<&'static str> {
    Some(&store().public(path)?.etag)
}

pub fn read(key: &str) -> Option<Bytes> {
    store().read(key)
}

pub fn sha256(key: &str) -> Option<&'static str> {
    store().sha256(key)
}

pub fn text(key: &str) -> &'static str {
    static TEXTS: OnceLock<Mutex<HashMap<String, &'static str>>> = OnceLock::new();
    let mut texts = TEXTS
        .get_or_init(Default::default)
        .lock()
        .unwrap_or_else(|e| e.into_inner());
    texts.entry(key.to_string()).or_insert_with(|| {
        let bytes = read(key).unwrap_or_else(|| panic!("Card assets: {key} is missing or changed"));
        String::from_utf8(bytes.to_vec())
            .expect("UTF-8 card asset")
            .leak()
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn release(files: &[(&str, &[u8], &str)]) -> PathBuf {
        static NEXT: std::sync::atomic::AtomicUsize = std::sync::atomic::AtomicUsize::new(0);
        let n = NEXT.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
        let root = std::env::temp_dir().join(format!("card-files-{}-{n}", std::process::id()));
        let mut listed = serde_json::Map::new();
        for (name, bytes, content_type) in files {
            let path = root.join("card-game").join(name);
            fs::create_dir_all(path.parent().unwrap()).unwrap();
            fs::write(&path, bytes).unwrap();
            let sha256 = format!("{:x}", Sha256::digest(bytes));
            let entry =
                serde_json::json!({"type": content_type, "sha256": sha256, "size": bytes.len()});
            listed.insert(format!("card-game/{name}"), entry);
        }
        let dirs = serde_json::json!({"card-game": "card-game"});
        let manifest = serde_json::json!({"sha256": "set", "dirs": dirs, "files": listed});
        fs::write(root.join("manifest.json"), manifest.to_string()).unwrap();
        root
    }

    #[test]
    fn a_release_directory_serves_its_files_with_their_hashes() {
        let root = release(&[
            ("app.mjs", b"export {};", "text/javascript; charset=utf-8"),
            ("assets/song.mp3", b"song", "audio/mpeg"),
        ]);
        let store = Store::open(&root).unwrap();
        let (content_type, bytes) = store.get("app.mjs").unwrap();
        assert_eq!(
            (content_type, &bytes[..]),
            ("text/javascript; charset=utf-8", &b"export {};"[..])
        );
        assert_eq!(&store.get("assets/song.mp3").unwrap().1[..], b"song");
        assert_eq!(
            store.public("assets/song.mp3").unwrap().etag,
            format!("\"{:x}\"", Sha256::digest(b"song"))
        );
        assert!(store.get("missing.mjs").is_none());
        fs::write(root.join("card-game/assets/song.mp3"), b"longer song").unwrap();
        assert!(store.get("assets/song.mp3").is_none());
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn a_file_that_differs_from_the_manifest_stops_startup() {
        let root = release(&[("assets/song.mp3", b"song", "audio/mpeg")]);
        fs::write(root.join("card-game/assets/song.mp3"), b"sung").unwrap();
        let error = Store::open(&root).err().unwrap();
        assert_eq!(
            error,
            "card-game/assets/song.mp3 does not match manifest.json"
        );
        fs::remove_dir_all(&root).unwrap();
        assert!(Store::open(&root).is_err());
    }

    #[test]
    fn a_manifest_without_a_file_the_server_reads_stops_startup() {
        let root = release(&[("app.mjs", b"export {};", "text/javascript; charset=utf-8")]);
        let error = checked(Store::open(&root).unwrap()).err();
        assert_eq!(
            error.as_deref(),
            Some("manifest.json does not list card-game/senses.json")
        );
        fs::remove_dir_all(&root).unwrap();
    }

    #[test]
    fn a_manifest_path_outside_the_assets_directory_stops_startup() {
        let root = release(&[("../outside.txt", b"outside", "text/plain")]);
        assert_eq!(
            Store::open(&root).err().unwrap(),
            "card-game/../outside.txt is not a path inside the assets directory"
        );
        fs::remove_dir_all(&root).unwrap();
    }
}
