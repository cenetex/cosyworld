use std::{fs, path::Path};

pub(crate) const GENERATED_ASSET_LIMIT_BYTES: u64 = 512 * 1024 * 1024;
pub(crate) const GENERATED_ASSET_ADMISSION_BYTES: u64 = 64 * 1024 * 1024;
pub(crate) const GENERATED_ASSET_LIMIT_CODE: &str = "generated_asset_storage_limit";
const MAX_SCAN_ENTRIES: usize = 50_000;

/// The file lock spans the scan and the caller's atomic write. Each process
/// opens the same per-root lock, so concurrent writers share one byte budget.
pub(crate) struct GeneratedAssetWriteGuard {
    _lock: fs::File,
}

impl GeneratedAssetWriteGuard {
    pub(crate) fn acquire(root: &Path, additional_bytes: u64) -> Result<Self, String> {
        Self::with_limit(root, additional_bytes, GENERATED_ASSET_LIMIT_BYTES)
    }

    fn with_limit(root: &Path, additional_bytes: u64, limit: u64) -> Result<Self, String> {
        fs::create_dir_all(root).map_err(|error| error.to_string())?;
        let metadata = fs::symlink_metadata(root).map_err(|error| error.to_string())?;
        if !metadata.is_dir() || metadata.file_type().is_symlink() {
            return Err("generated asset root must be a directory".to_string());
        }
        let lock_path = root.join(".asset-budget.lock");
        if fs::symlink_metadata(&lock_path)
            .is_ok_and(|meta| !meta.is_file() || meta.file_type().is_symlink())
        {
            return Err("generated asset lock must be a regular file".to_string());
        }
        let lock = fs::OpenOptions::new()
            .read(true)
            .write(true)
            .create(true)
            .truncate(false)
            .open(lock_path)
            .map_err(|error| error.to_string())?;
        lock.lock().map_err(|error| error.to_string())?;
        let used = complete_asset_usage(root)?;
        if used.saturating_add(additional_bytes) > limit {
            return Err(format!("{GENERATED_ASSET_LIMIT_CODE}: {used} bytes used; {additional_bytes} bytes required; {limit} byte limit"));
        }
        Ok(Self { _lock: lock })
    }
}

pub(crate) fn require_generated_asset_headroom(root: &Path) -> Result<(), String> {
    GeneratedAssetWriteGuard::acquire(root, GENERATED_ASSET_ADMISSION_BYTES).map(drop)
}

fn complete_asset_usage(root: &Path) -> Result<u64, String> {
    let mut pending = vec![root.to_path_buf()];
    let mut entries = 0_usize;
    let mut bytes = 0_u64;
    while let Some(directory) = pending.pop() {
        for entry in fs::read_dir(directory).map_err(|error| error.to_string())? {
            let entry = entry.map_err(|error| error.to_string())?;
            entries += 1;
            if entries > MAX_SCAN_ENTRIES {
                return Err("generated asset capacity scan exceeded its entry limit".to_string());
            }
            let metadata = fs::symlink_metadata(entry.path()).map_err(|error| error.to_string())?;
            if metadata.file_type().is_symlink() {
                return Err(
                    "generated asset capacity scan requires regular files and directories"
                        .to_string(),
                );
            }
            if metadata.is_dir() {
                pending.push(entry.path());
            } else if metadata.is_file() {
                bytes = bytes
                    .checked_add(metadata.len())
                    .ok_or_else(|| "generated asset byte count overflowed".to_string())?;
            } else {
                return Err("generated asset capacity scan found a special file".to_string());
            }
        }
    }
    Ok(bytes)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::{Arc, Barrier};

    fn root(label: &str) -> std::path::PathBuf {
        let root = std::env::temp_dir().join(format!(
            "cosyworld-asset-budget-{label}-{}",
            crate::random_hex(8)
        ));
        fs::create_dir_all(&root).unwrap();
        root
    }

    #[test]
    fn concurrent_writers_share_the_same_capacity() {
        let root = root("concurrent");
        let barrier = Arc::new(Barrier::new(2));
        let tasks = (0..2)
            .map(|index| {
                let root = root.clone();
                let barrier = barrier.clone();
                std::thread::spawn(move || {
                    barrier.wait();
                    let Ok(_guard) = GeneratedAssetWriteGuard::with_limit(&root, 4, 6) else {
                        return false;
                    };
                    fs::write(root.join(format!("{index}.image")), b"art!").unwrap();
                    true
                })
            })
            .collect::<Vec<_>>();
        let accepted = tasks
            .into_iter()
            .map(|task| usize::from(task.join().unwrap()))
            .sum::<usize>();
        assert_eq!(accepted, 1);
        assert_eq!(complete_asset_usage(&root).unwrap(), 4);
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn existing_assets_survive_a_full_budget() {
        let root = root("existing");
        fs::write(root.join("published.image"), b"published").unwrap();
        fs::write(root.join("journal-reference.json"), b"published.image").unwrap();
        assert!(GeneratedAssetWriteGuard::with_limit(&root, 1, 8).is_err());
        assert_eq!(
            fs::read(root.join("published.image")).unwrap(),
            b"published"
        );
        assert_eq!(
            fs::read(root.join("journal-reference.json")).unwrap(),
            b"published.image"
        );
        fs::remove_dir_all(root).unwrap();
    }

    #[cfg(unix)]
    #[test]
    fn a_scan_boundary_stops_admission() {
        let root = root("symlink");
        std::os::unix::fs::symlink("missing", root.join("outside")).unwrap();
        assert!(GeneratedAssetWriteGuard::with_limit(&root, 1, 100).is_err());
        fs::remove_dir_all(root).unwrap();
    }
}
