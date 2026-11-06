//! Immutable bytes for private authoring packs; HTTP and manifest refs live above this store.
use crate::generated_asset_budget::{GeneratedAssetWriteGuard, GENERATED_ASSET_LIMIT_CODE};
use sha2::{Digest, Sha256};
use std::{
    fs,
    io::{Read, Write},
    path::{Path, PathBuf},
};

const MAX_FILE: u64 = 16 * 1024 * 1024;
const OWNER_BYTES: u64 = 256 * 1024 * 1024;
const OWNER_FILES: u64 = 1024;

#[derive(Debug, PartialEq, Eq)]
pub(super) enum Error {
    Invalid,
    Capacity,
    Unavailable,
}
impl From<std::io::Error> for Error {
    fn from(_: std::io::Error) -> Self {
        Self::Unavailable
    }
}
type Result<T> = std::result::Result<T, Error>;

#[derive(Debug, PartialEq, Eq)]
pub(super) struct Receipt {
    pub sha256: String,
    pub size: u64,
}
#[derive(Debug, Default, PartialEq, Eq)]
pub(super) struct Usage {
    pub bytes: u64,
    pub objects: u64,
}

pub(super) struct PrivateAssetStore {
    root: PathBuf,
    owner: PathBuf,
    limit: Usage,
}

fn sha(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}
fn valid_digest(value: &str) -> bool {
    value.len() == 64
        && value
            .bytes()
            .all(|v| v.is_ascii_digit() || (b'a'..=b'f').contains(&v))
}
fn directory(path: &Path) -> Result<()> {
    let meta = fs::symlink_metadata(path)?;
    if !meta.is_dir() || meta.file_type().is_symlink() {
        return Err(Error::Unavailable);
    }
    Ok(())
}
fn make_directory(path: &Path) -> Result<()> {
    match fs::create_dir(path) {
        Ok(()) => (),
        Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => (),
        Err(e) => return Err(e.into()),
    }
    directory(path)?;
    fs::File::open(path.parent().ok_or(Error::Unavailable)?)?.sync_all()?;
    Ok(())
}

impl PrivateAssetStore {
    /// The caller supplies the authenticated account ID and the configured generated root.
    pub fn new(root: &Path, owner: &str) -> Result<Self> {
        if owner.is_empty() || owner.len() > 128 {
            return Err(Error::Invalid);
        }
        directory(root)?;
        let private = root.join("authoring-private");
        make_directory(&private)?;
        let owner = private.join(sha(owner.as_bytes()));
        make_directory(&owner)?;
        Ok(Self {
            root: root.into(),
            owner,
            limit: Usage {
                bytes: OWNER_BYTES,
                objects: OWNER_FILES,
            },
        })
    }

    fn path(&self, digest: &str) -> Result<PathBuf> {
        if !valid_digest(digest) {
            return Err(Error::Invalid);
        }
        directory(&self.root)?;
        directory(self.owner.parent().ok_or(Error::Unavailable)?)?;
        directory(&self.owner)?;
        Ok(self.owner.join(digest))
    }

    /// Reads verify both the byte bound and digest, including on upload retries.
    pub fn read(&self, digest: &str) -> Result<Option<Vec<u8>>> {
        let path = self.path(digest)?;
        let meta = match fs::symlink_metadata(&path) {
            Ok(v) => v,
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(None),
            Err(e) => return Err(e.into()),
        };
        if !meta.is_file() || meta.file_type().is_symlink() || meta.len() > MAX_FILE {
            return Err(Error::Unavailable);
        }
        let mut bytes = Vec::new();
        fs::File::open(path)?
            .take(MAX_FILE + 1)
            .read_to_end(&mut bytes)?;
        if bytes.len() as u64 != meta.len() || sha(&bytes) != digest {
            return Err(Error::Unavailable);
        }
        Ok(Some(bytes))
    }

    /// Includes leftover temporary files so interrupted writes consume their real quota.
    pub fn usage(&self) -> Result<Usage> {
        self.path(&"0".repeat(64))?;
        let mut usage = Usage::default();
        for entry in fs::read_dir(&self.owner)? {
            let meta = fs::symlink_metadata(entry?.path())?;
            if !meta.is_file() || meta.file_type().is_symlink() {
                return Err(Error::Unavailable);
            }
            usage.objects += 1;
            usage.bytes = usage.bytes.checked_add(meta.len()).ok_or(Error::Capacity)?;
            if usage.objects > OWNER_FILES {
                return Err(Error::Capacity);
            }
        }
        Ok(usage)
    }

    pub fn put(&self, digest: &str, bytes: &[u8]) -> Result<Receipt> {
        self.put_with(digest, bytes, |_| Ok(()))
    }

    fn put_with(
        &self,
        digest: &str,
        bytes: &[u8],
        before_commit: impl FnOnce(&Path) -> std::io::Result<()>,
    ) -> Result<Receipt> {
        let path = self.path(digest)?;
        if bytes.len() as u64 > MAX_FILE || sha(bytes) != digest {
            return Err(Error::Invalid);
        }
        let receipt = || {
            fs::File::open(&self.owner)?.sync_all()?;
            Ok(Receipt {
                sha256: digest.into(),
                size: bytes.len() as u64,
            })
        };
        if self.read(digest)?.is_some() {
            return receipt();
        }
        let guard = GeneratedAssetWriteGuard::acquire(&self.root, bytes.len() as u64);
        let _guard = match guard {
            Ok(v) => v,
            Err(_) if self.read(digest)?.is_some() => return receipt(),
            Err(e) if e.starts_with(GENERATED_ASSET_LIMIT_CODE) => return Err(Error::Capacity),
            Err(_) => return Err(Error::Unavailable),
        };
        if self.read(digest)?.is_some() {
            return receipt();
        }
        let used = self.usage()?;
        if used.objects >= self.limit.objects
            || used.bytes.saturating_add(bytes.len() as u64) > self.limit.bytes
        {
            return Err(Error::Capacity);
        }
        let temporary = self
            .owner
            .join(format!(".upload-{}", crate::random_hex(16)));
        let result = (|| -> std::io::Result<()> {
            let mut file = fs::OpenOptions::new()
                .write(true)
                .create_new(true)
                .open(&temporary)?;
            file.write_all(bytes)?;
            file.sync_all()?;
            before_commit(&temporary)?;
            fs::rename(&temporary, &path)?;
            Ok(())
        })();
        if result.is_err() {
            let _ = fs::remove_file(&temporary);
        }
        result?;
        receipt()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    struct Fixture(PathBuf);
    impl Fixture {
        fn new() -> Self {
            let root =
                std::env::temp_dir().join(format!("private-authoring-{}", crate::random_hex(12)));
            fs::create_dir(&root).unwrap();
            Self(root)
        }
        fn store(&self, owner: &str) -> PrivateAssetStore {
            PrivateAssetStore::new(&self.0, owner).unwrap()
        }
    }
    impl Drop for Fixture {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    #[test]
    fn retries_and_reopen_keep_exact_bytes_owned_by_each_account() {
        let f = Fixture::new();
        let a = f.store("account-a");
        let b = f.store("account-b");
        let bytes = b"accepted image";
        let digest = sha(bytes);
        assert_eq!(
            a.put(&digest, bytes),
            Ok(Receipt {
                sha256: digest.clone(),
                size: 14
            })
        );
        assert_eq!(a.put(&digest, bytes).unwrap().size, 14);
        assert_eq!(b.read(&digest), Ok(None));
        assert_eq!(
            a.usage().unwrap(),
            Usage {
                bytes: 14,
                objects: 1
            }
        );
        b.put(&digest, bytes).unwrap();
        assert_eq!(f.store("account-a").read(&digest).unwrap().unwrap(), bytes);
        assert_eq!(b.read(&digest).unwrap().unwrap(), bytes);
        let empty = sha(b"");
        a.put(&empty, b"").unwrap();
        assert_eq!(a.read(&empty), Ok(Some(vec![])));
    }

    #[test]
    fn validates_digests_byte_bounds_and_existing_file_integrity() {
        let f = Fixture::new();
        let s = f.store("account");
        assert!(PrivateAssetStore::new(&f.0, "").is_err());
        assert!(PrivateAssetStore::new(&f.0, &"x".repeat(129)).is_err());
        for bad in ["../escape", "", &"A".repeat(64), &"g".repeat(64)] {
            assert_eq!(s.put(bad, b"x"), Err(Error::Invalid));
            assert_eq!(s.read(bad), Err(Error::Invalid));
        }
        assert_eq!(s.put(&sha(b"a"), b"b"), Err(Error::Invalid));
        let exact = vec![0; MAX_FILE as usize];
        s.put(&sha(&exact), &exact).unwrap();
        assert_eq!(s.read(&sha(&exact)).unwrap().unwrap(), exact);
        let large = vec![0; MAX_FILE as usize + 1];
        assert_eq!(s.put(&sha(&large), &large), Err(Error::Invalid));
        let digest = sha(b"original");
        s.put(&digest, b"original").unwrap();
        fs::write(s.owner.join(&digest), b"tampered").unwrap();
        assert_eq!(s.read(&digest), Err(Error::Unavailable));
        assert_eq!(s.put(&digest, b"original"), Err(Error::Unavailable));
        assert_eq!(fs::read(s.owner.join(digest)).unwrap(), b"tampered");
    }

    #[test]
    fn failed_writes_clean_up_and_leftovers_count_against_both_owner_bounds() {
        let f = Fixture::new();
        let mut s = f.store("account");
        let digest = sha(b"four");
        assert_eq!(
            s.put_with(&digest, b"four", |_| Err(std::io::Error::other(
                "disk failed"
            ))),
            Err(Error::Unavailable)
        );
        assert_eq!(s.read(&digest), Ok(None));
        assert_eq!(s.usage().unwrap(), Usage::default());
        let target = s.owner.join(&digest);
        assert!(s
            .put_with(&digest, b"four", |temporary| {
                fs::rename(temporary, target)?;
                Err(std::io::Error::other("directory sync failed"))
            })
            .is_err());
        assert!(s.put(&digest, b"four").is_ok());
        fs::remove_file(s.owner.join(&digest)).unwrap();
        fs::write(s.owner.join(".upload-interrupted"), b"left").unwrap();
        s.limit = Usage {
            bytes: 7,
            objects: 2,
        };
        assert_eq!(s.put(&digest, b"four"), Err(Error::Capacity));
        s.limit.bytes = 8;
        s.put(&digest, b"four").unwrap();
        assert_eq!(
            s.usage().unwrap(),
            Usage {
                bytes: 8,
                objects: 2
            }
        );
        assert_eq!(s.put(&sha(b""), b""), Err(Error::Capacity));
        assert!(s.put(&digest, b"four").is_ok());
    }

    #[test]
    fn shared_budget_counts_other_media_and_concurrent_owner_writers() {
        let f = Fixture::new();
        let full = fs::File::create(f.0.join("other-media")).unwrap();
        full.set_len(crate::generated_asset_budget::GENERATED_ASSET_LIMIT_BYTES)
            .unwrap();
        drop(full);
        assert_eq!(
            f.store("account").put(&sha(b"x"), b"x"),
            Err(Error::Capacity)
        );
        fs::remove_file(f.0.join("other-media")).unwrap();
        let barrier = std::sync::Arc::new(std::sync::Barrier::new(2));
        let tasks: Vec<_> = [b"a", b"b"]
            .into_iter()
            .map(|bytes| {
                let mut s = f.store("account");
                s.limit = Usage {
                    bytes: 1,
                    objects: 1,
                };
                let barrier = barrier.clone();
                std::thread::spawn(move || {
                    barrier.wait();
                    s.put(&sha(bytes), bytes)
                })
            })
            .collect();
        assert_eq!(
            tasks
                .into_iter()
                .map(|t| t.join().unwrap())
                .filter(Result::is_ok)
                .count(),
            1
        );
        assert_eq!(
            f.store("account").usage().unwrap(),
            Usage {
                bytes: 1,
                objects: 1
            }
        );
    }

    #[cfg(unix)]
    #[test]
    fn rejects_symlinked_owner_directories_and_files() {
        use std::os::unix::fs::symlink;
        let f = Fixture::new();
        let s = f.store("account");
        let outside = f.0.join("outside");
        fs::write(&outside, b"outside").unwrap();
        let digest = sha(b"outside");
        symlink(&outside, s.owner.join(&digest)).unwrap();
        assert_eq!(s.read(&digest), Err(Error::Unavailable));
        assert_eq!(s.put(&digest, b"outside"), Err(Error::Unavailable));
        fs::remove_dir_all(&s.owner).unwrap();
        symlink(&f.0, &s.owner).unwrap();
        assert_eq!(s.read(&digest), Err(Error::Unavailable));
        assert!(PrivateAssetStore::new(&f.0, "account").is_err());
        assert_eq!(fs::read(outside).unwrap(), b"outside");
    }
}
