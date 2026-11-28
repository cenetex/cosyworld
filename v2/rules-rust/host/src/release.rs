use super::{Rules, MAX_MODULE_BYTES};
use serde::Deserialize;
use serde_json::json;
use sha2::{Digest, Sha256};
use std::{fs::File, io::Read, path::Path};

const ABI: u32 = 1;
const TARGET: &str = "wasm32-unknown-unknown";
const MAX_METADATA_BYTES: usize = 4096;

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Artifact {
    abi: u32,
    version: String,
    target: String,
    file: String,
    sha256: String,
    size: usize,
}

impl Rules {
    pub fn load_release(
        candidates_dir: &Path,
        expected_version: &str,
        expected_sha256: &str,
    ) -> Result<Self, String> {
        semver::Version::parse(expected_version)
            .map_err(|err| format!("Invalid nominated Rules Wasm version: {err}"))?;
        if expected_sha256.len() != 64
            || !expected_sha256
                .bytes()
                .all(|byte| matches!(byte, b'0'..=b'9' | b'a'..=b'f'))
        {
            return Err("The nominated Rules Wasm SHA-256 must be lowercase hexadecimal.".into());
        }

        let release = candidates_dir.join(expected_version);
        let metadata = read_at_most(
            &release.join(format!("{expected_sha256}.json")),
            "metadata",
            MAX_METADATA_BYTES,
        )?;
        let artifact: Artifact = serde_json::from_slice(&metadata)
            .map_err(|err| format!("Invalid Rules Wasm metadata: {err}"))?;
        let filename = format!("{expected_sha256}.wasm");
        if artifact.abi != ABI
            || artifact.version != expected_version
            || artifact.target != TARGET
            || artifact.file != filename
            || artifact.sha256 != expected_sha256
        {
            return Err("Rules Wasm metadata does not match the nominated release.".into());
        }
        if !(1..=MAX_MODULE_BYTES).contains(&artifact.size) {
            return Err("Invalid Rules Wasm metadata size.".into());
        }

        let bytes = read_at_most(&release.join(filename), "artifact", artifact.size)?;
        if bytes.len() != artifact.size {
            return Err("Rules Wasm artifact length does not match metadata.".into());
        }
        if format!("{:x}", Sha256::digest(&bytes)) != expected_sha256 {
            return Err("Rules Wasm artifact SHA-256 does not match the nominated release.".into());
        }

        let guest = Self::new(&bytes)?;
        let outcome = guest
            .reduce(&json!({"op": "__abi_probe"}))
            .map_err(|err| format!("Rules Wasm ABI probe failed: {err}"))?;
        if outcome.is_some() {
            return Err("Rules Wasm ABI probe must report an unsupported operation.".into());
        }
        Ok(guest)
    }
}

fn read_at_most(path: &Path, label: &str, max: usize) -> Result<Vec<u8>, String> {
    let mut bytes = Vec::new();
    File::open(path)
        .and_then(|file| file.take(max as u64 + 1).read_to_end(&mut bytes))
        .map_err(|err| format!("Could not read Rules Wasm {label}: {err}"))?;
    if bytes.len() > max {
        return Err(format!("Rules Wasm {label} exceeds its size bound."));
    }
    Ok(bytes)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::tests::guest_bytes;
    use serde_json::Value;
    use std::{
        fs,
        path::PathBuf,
        sync::atomic::{AtomicUsize, Ordering},
    };

    const VERSION: &str = "0.1.0";

    struct Release {
        root: PathBuf,
        digest: String,
        metadata: Value,
    }

    impl Release {
        fn new(bytes: &[u8]) -> Self {
            static NEXT: AtomicUsize = AtomicUsize::new(0);
            let root = std::env::temp_dir().join(format!(
                "cosyworld-rules-release-{}-{}",
                std::process::id(),
                NEXT.fetch_add(1, Ordering::Relaxed),
            ));
            fs::create_dir(&root).unwrap();
            fs::create_dir(root.join(VERSION)).unwrap();
            let digest = format!("{:x}", Sha256::digest(bytes));
            let metadata = json!({
                "abi": ABI,
                "version": VERSION,
                "target": TARGET,
                "file": format!("{digest}.wasm"),
                "sha256": digest,
                "size": bytes.len(),
            });
            let release = Self {
                root,
                digest,
                metadata,
            };
            release.write_metadata(&release.metadata);
            fs::write(release.path("wasm"), bytes).unwrap();
            release
        }

        fn path(&self, extension: &str) -> PathBuf {
            self.root
                .join(VERSION)
                .join(format!("{}.{extension}", self.digest))
        }

        fn write_metadata(&self, metadata: &Value) {
            fs::write(self.path("json"), serde_json::to_vec(metadata).unwrap()).unwrap();
        }

        fn load(&self) -> Result<Rules, String> {
            Rules::load_release(&self.root, VERSION, &self.digest)
        }
    }

    impl Drop for Release {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.root);
        }
    }

    fn assert_rejected(result: Result<Rules, String>, reason: &str) {
        let Err(error) = result else {
            panic!("release was accepted despite {reason}");
        };
        assert!(error.contains(reason), "{error}");
    }

    #[test]
    fn loads_the_nominated_release() {
        let release = Release::new(&guest_bytes(1, "i32.const 4", ""));
        let rules = release.load().unwrap();
        assert_eq!(rules.reduce(&json!({"op": "__abi_probe"})).unwrap(), None);
        assert_rejected(
            Rules::load_release(&release.root, "../0.1.0", &release.digest),
            "Invalid nominated Rules Wasm version",
        );
        assert_rejected(
            Rules::load_release(&release.root, VERSION, &release.digest.to_uppercase()),
            "lowercase hexadecimal",
        );
        assert_rejected(
            Rules::load_release(&release.root, VERSION, &"f".repeat(64)),
            "Could not read Rules Wasm metadata",
        );
    }

    #[test]
    fn rejects_metadata_that_does_not_identify_the_nominated_release() {
        let release = Release::new(&guest_bytes(1, "i32.const 4", ""));
        for (field, value) in [
            ("abi", json!(2)),
            ("version", json!("0.1.1")),
            ("target", json!("wasm32-wasip1")),
            ("file", json!(format!("../{}.wasm", release.digest))),
            ("sha256", json!("a".repeat(64))),
        ] {
            let mut metadata = release.metadata.clone();
            metadata[field] = value;
            release.write_metadata(&metadata);
            assert_rejected(release.load(), "does not match the nominated release");
        }
        for size in [0, MAX_MODULE_BYTES + 1] {
            let mut metadata = release.metadata.clone();
            metadata["size"] = json!(size);
            release.write_metadata(&metadata);
            assert_rejected(release.load(), "Invalid Rules Wasm metadata size");
        }
        let mut metadata = release.metadata.clone();
        metadata["alternate"] = json!(true);
        release.write_metadata(&metadata);
        assert_rejected(release.load(), "Invalid Rules Wasm metadata");
        let mut padded = serde_json::to_vec(&release.metadata).unwrap();
        padded.resize(MAX_METADATA_BYTES + 1, b' ');
        fs::write(release.path("json"), padded).unwrap();
        assert_rejected(release.load(), "metadata exceeds its size bound");
    }

    #[test]
    fn rejects_changed_bytes_before_opening_the_guest() {
        let bytes = guest_bytes(1, "i32.const 4", "");
        let release = Release::new(&bytes);

        fs::write(release.path("wasm"), &bytes[..bytes.len() - 1]).unwrap();
        assert_rejected(release.load(), "length does not match metadata");

        let mut changed = bytes;
        changed[0] ^= 1;
        fs::write(release.path("wasm"), &changed).unwrap();
        assert_rejected(release.load(), "artifact SHA-256 does not match");

        changed.push(0);
        fs::write(release.path("wasm"), changed).unwrap();
        assert_rejected(release.load(), "artifact exceeds its size bound");
    }

    #[test]
    fn rejects_a_nominated_guest_outside_the_bounded_abi() {
        let release = Release::new(&wat::parse_str("(module)").unwrap());
        assert_rejected(release.load(), "ABI probe failed");

        let release = Release::new(&guest_bytes(1537, "i32.const 4", ""));
        assert_rejected(release.load(), "ABI probe failed");

        let marker = r#"(data (i32.const 64) "{\22ok\22:true}")"#;
        let release = Release::new(&guest_bytes(1, "i32.const 11", marker));
        assert_rejected(release.load(), "must report an unsupported operation");
    }
}
