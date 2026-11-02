//! Signed envelopes: the server's Ed25519 signature over content it wrote.
//!
//! A client that holds server-written content (a dialogue line, a reflection)
//! sends it back with its envelope, and the server accepts the content only
//! when the envelope verifies. Anyone with the published public keys can check
//! the same bytes (docs/design/signed-envelopes.md).
//!
//! The signed bytes are `DOMAIN` followed by the claims as canonical JSON:
//! keys in ascending order, no whitespace, integers only, and string values
//! limited to printable ASCII so every JSON encoder writes them identically.
use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};
use ed25519_dalek::{Signature, Signer, SigningKey, Verifier, VerifyingKey};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::collections::BTreeMap;
use std::sync::OnceLock;

pub(crate) const DOMAIN: &[u8] = b"cosyworld.envelope.v1\n";

/// What an envelope vouches for. Fields are declared in key order, so serde
/// writes canonical JSON.
#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct Claims {
    /// SHA-256 of the content's UTF-8 bytes, lowercase hex.
    pub content: String,
    /// The entity the content belongs to (the speaker, the reflecting avatar).
    pub entity: String,
    /// Issued at, Unix seconds.
    pub iat: u64,
    /// What the content is: `line`, `thought`, `persona` or `dream`.
    pub kind: String,
    pub kid: String,
    /// The build that wrote it (rules bundle or server version).
    pub rules: String,
    /// The world revision (or journal sequence) the content was written at.
    pub seq: u64,
    pub turn: u64,
    /// The world or run: a shared world id, or `local` for browser saves.
    pub world: String,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct Envelope {
    pub claims: Claims,
    /// Base64url (no padding) Ed25519 signature over `DOMAIN` + claims.
    pub sig: String,
    pub v: u8,
}

#[derive(Debug, PartialEq)]
pub(crate) enum Verdict {
    Valid,
    /// Signed by a key this server does not list, such as another machine's
    /// development key. Not forged as far as we can tell, but not usable.
    UnknownKey,
    Invalid,
}

pub(crate) struct KeyRing {
    kid: String,
    signing: SigningKey,
    verifying: BTreeMap<String, VerifyingKey>,
}

pub(crate) fn content_hash(text: &str) -> String {
    Sha256::digest(text.as_bytes())
        .iter()
        .map(|b| format!("{b:02x}"))
        .collect()
}

fn printable(text: &str) -> bool {
    !text.is_empty() && text.len() <= 160 && text.bytes().all(|b| (0x20..0x7f).contains(&b))
}

fn canonical(claims: &Claims) -> Option<Vec<u8>> {
    [
        &claims.content,
        &claims.entity,
        &claims.kind,
        &claims.kid,
        &claims.rules,
        &claims.world,
    ]
    .iter()
    .all(|text| printable(text) && !text.contains(['"', '\\']))
    .then(|| {
        [
            DOMAIN,
            &serde_json::to_vec(claims).expect("claims serialize"),
        ]
        .concat()
    })
}

fn key_part(text: &str) -> Option<(String, Vec<u8>)> {
    let (kid, key) = text.trim().split_once(':')?;
    let bytes = URL_SAFE_NO_PAD.decode(key.trim()).ok()?;
    (printable(kid) && bytes.len() == 32).then(|| (kid.to_string(), bytes))
}

impl KeyRing {
    /// `signing` is `<kid>:<base64url 32-byte seed>`; `retired` lists earlier
    /// public keys as comma-separated `<kid>:<base64url public key>`.
    pub(crate) fn new(signing: Option<&str>, retired: Option<&str>) -> Result<Self, String> {
        let (kid, signing) = match signing.filter(|s| !s.trim().is_empty()) {
            Some(text) => {
                let (kid, seed) = key_part(text)
                    .ok_or("COSYWORLD_SIGNING_KEY must be <kid>:<base64url 32-byte seed>")?;
                (
                    kid,
                    SigningKey::from_bytes(&seed.try_into().expect("32 bytes")),
                )
            }
            None => {
                let key = SigningKey::from_bytes(&rand::random::<[u8; 32]>());
                let kid = format!(
                    "ephemeral-{}",
                    &content_hash(&URL_SAFE_NO_PAD.encode(key.verifying_key().as_bytes()))[..12]
                );
                (kid, key)
            }
        };
        let mut verifying = BTreeMap::from([(kid.clone(), signing.verifying_key())]);
        for part in retired
            .unwrap_or("")
            .split(',')
            .filter(|p| !p.trim().is_empty())
        {
            let (old, bytes) = key_part(part)
                .ok_or("COSYWORLD_SIGNING_PUBLIC_KEYS must list <kid>:<base64url public key>")?;
            let key = VerifyingKey::from_bytes(&bytes.try_into().expect("32 bytes"))
                .map_err(|_| "COSYWORLD_SIGNING_PUBLIC_KEYS holds an invalid public key")?;
            verifying.entry(old).or_insert(key);
        }
        Ok(Self {
            kid,
            signing,
            verifying,
        })
    }

    pub(crate) fn sign(&self, mut claims: Claims) -> Envelope {
        claims.kid = self.kid.clone();
        let bytes = canonical(&claims).expect("server claims are printable ASCII");
        Envelope {
            sig: URL_SAFE_NO_PAD.encode(self.signing.sign(&bytes).to_bytes()),
            claims,
            v: 1,
        }
    }

    pub(crate) fn verify(&self, envelope: &Envelope) -> Verdict {
        let Some(key) = self.verifying.get(&envelope.claims.kid) else {
            return Verdict::UnknownKey;
        };
        let signature = URL_SAFE_NO_PAD
            .decode(&envelope.sig)
            .ok()
            .and_then(|bytes| Signature::from_slice(&bytes).ok());
        match (envelope.v, canonical(&envelope.claims), signature) {
            (1, Some(bytes), Some(signature)) if key.verify(&bytes, &signature).is_ok() => {
                Verdict::Valid
            }
            _ => Verdict::Invalid,
        }
    }

    /// The published key list: the current key first, then retired ones.
    pub(crate) fn public_keys(&self) -> Value {
        let mut keys = vec![(self.kid.clone(), self.signing.verifying_key(), true)];
        keys.extend(
            self.verifying
                .iter()
                .filter(|(kid, _)| **kid != self.kid)
                .map(|(kid, key)| (kid.clone(), *key, false)),
        );
        json!({
            "domain": String::from_utf8_lossy(DOMAIN),
            "keys": keys.into_iter().map(|(kid, key, current)| json!({
                "kid": kid, "alg": "Ed25519", "current": current,
                "public": URL_SAFE_NO_PAD.encode(key.as_bytes()),
            })).collect::<Vec<_>>(),
        })
    }
}

/// Where a server keeps the signing keys it generates for itself.
#[derive(Clone, Debug, Default)]
pub(crate) enum KeyStore {
    /// A `signing_keys` table in the event database on the app's volume, so
    /// volume backups and restores carry the keys with the journal.
    Sqlite(std::path::PathBuf),
    /// A JSON file (mode 600), for a runtime without an event database such
    /// as the desktop app.
    File(std::path::PathBuf),
    /// Nowhere: tests and throwaway processes sign with a temporary key.
    #[default]
    Memory,
}

#[derive(Debug, Default)]
pub(crate) struct KeyPolicy {
    pub store: KeyStore,
    /// `COSYWORLD_SIGNING_KEY_ROTATE`: a new key id. When the store has no
    /// key by that id, startup makes one, makes it current and retires the
    /// old one, whose public key keeps verifying.
    pub rotate: Option<String>,
}

impl KeyPolicy {
    /// The store for this process: the desktop app's data folder, else the
    /// event database, else a file beside the snapshot.
    pub(crate) fn from_env() -> Self {
        let var = |name: &str| std::env::var_os(name).filter(|v| !v.is_empty());
        let local_app = std::env::var("COSYWORLD_LOCAL_APP").as_deref() == Ok("1");
        let store = match (
            var("COSYWORLD_LOCAL_DATA_DIR").filter(|_| local_app),
            var("COSYWORLD_V2_EVENT_DB_PATH"),
            var("COSYWORLD_V2_SNAPSHOT_PATH"),
        ) {
            (Some(dir), _, _) => {
                KeyStore::File(std::path::PathBuf::from(dir).join("signing-keys.json"))
            }
            (None, Some(db), _) => KeyStore::Sqlite(db.into()),
            (None, None, Some(snapshot)) => KeyStore::File(
                std::path::Path::new(&snapshot).with_file_name("cosyworld-signing-keys.json"),
            ),
            _ => KeyStore::Memory,
        };
        Self {
            store,
            rotate: std::env::var("COSYWORLD_SIGNING_KEY_ROTATE")
                .ok()
                .map(|kid| kid.trim().to_string())
                .filter(|kid| !kid.is_empty()),
        }
    }
}

/// A key the server made for itself.
#[derive(Clone, Debug, Deserialize, Serialize)]
struct StoredKey {
    kid: String,
    seed: String,
    created_at: u64,
    retired_at: Option<u64>,
}

fn unix_now() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_or(0, |d| d.as_secs())
}

fn new_key(kid: Option<&str>) -> StoredKey {
    let key = SigningKey::from_bytes(&rand::random::<[u8; 32]>());
    let kid = kid.map_or_else(
        || {
            format!(
                "k-{}",
                &content_hash(&URL_SAFE_NO_PAD.encode(key.verifying_key().as_bytes()))[..12]
            )
        },
        str::to_string,
    );
    StoredKey {
        kid,
        seed: URL_SAFE_NO_PAD.encode(key.to_bytes()),
        created_at: unix_now(),
        retired_at: None,
    }
}

/// The stored keys after first start and any rotation: exactly one current.
/// `Ok(Some(kid))` names a key made now.
fn settle(keys: &mut Vec<StoredKey>, rotate: Option<&str>) -> Result<Option<String>, String> {
    if let Some(kid) = rotate {
        if !printable(kid) || kid.contains(['"', '\\', ':', ',']) {
            return Err("COSYWORLD_SIGNING_KEY_ROTATE must be a short printable key id".into());
        }
        if !keys.iter().any(|k| k.kid == kid) {
            let now = unix_now();
            for key in keys.iter_mut().filter(|k| k.retired_at.is_none()) {
                key.retired_at = Some(now);
            }
            keys.push(new_key(Some(kid)));
            return Ok(Some(kid.to_string()));
        }
    }
    if keys.iter().any(|k| k.retired_at.is_none()) {
        return Ok(None);
    }
    let key = new_key(None);
    let kid = key.kid.clone();
    keys.push(key);
    Ok(Some(kid))
}

fn sqlite_keys(
    path: &std::path::Path,
    rotate: Option<&str>,
) -> Result<(Vec<StoredKey>, Option<String>), String> {
    let failed = |e: rusqlite::Error| format!("signing keys in {}: {e}", path.display());
    let mut conn = rusqlite::Connection::open(path).map_err(failed)?;
    conn.busy_timeout(std::time::Duration::from_secs(10))
        .map_err(failed)?;
    let tx = conn
        .transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)
        .map_err(failed)?;
    tx.execute_batch(
        "CREATE TABLE IF NOT EXISTS signing_keys (
            kid TEXT PRIMARY KEY,
            seed TEXT NOT NULL,
            created_at INTEGER NOT NULL,
            retired_at INTEGER
        )",
    )
    .map_err(failed)?;
    let mut keys: Vec<StoredKey> = tx
        .prepare(
            "SELECT kid, seed, created_at, retired_at FROM signing_keys ORDER BY created_at, kid",
        )
        .map_err(failed)?
        .query_map([], |row| {
            Ok(StoredKey {
                kid: row.get(0)?,
                seed: row.get(1)?,
                created_at: row.get::<_, i64>(2)?.max(0) as u64,
                retired_at: row.get::<_, Option<i64>>(3)?.map(|t| t.max(0) as u64),
            })
        })
        .map_err(failed)?
        .collect::<Result<_, _>>()
        .map_err(failed)?;
    let made = settle(&mut keys, rotate)?;
    for key in &keys {
        tx.execute(
            "INSERT INTO signing_keys (kid, seed, created_at, retired_at) VALUES (?1, ?2, ?3, ?4)
             ON CONFLICT(kid) DO UPDATE SET retired_at = excluded.retired_at",
            rusqlite::params![
                key.kid,
                key.seed,
                key.created_at as i64,
                key.retired_at.map(|t| t as i64)
            ],
        )
        .map_err(failed)?;
    }
    tx.commit().map_err(failed)?;
    Ok((keys, made))
}

fn file_keys(
    path: &std::path::Path,
    rotate: Option<&str>,
) -> Result<(Vec<StoredKey>, Option<String>), String> {
    let mut keys: Vec<StoredKey> = match std::fs::read_to_string(path) {
        Ok(text) => serde_json::from_str(&text)
            .map_err(|e| format!("signing keys in {}: {e}", path.display()))?,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Vec::new(),
        Err(e) => return Err(format!("signing keys in {}: {e}", path.display())),
    };
    let made = settle(&mut keys, rotate)?;
    if made.is_some() {
        let temp = path.with_extension("json.tmp");
        let mut options = std::fs::OpenOptions::new();
        options.write(true).create(true).truncate(true);
        #[cfg(unix)]
        std::os::unix::fs::OpenOptionsExt::mode(&mut options, 0o600);
        let text = serde_json::to_vec(&keys).expect("keys serialize");
        options
            .open(&temp)
            .and_then(|mut file| std::io::Write::write_all(&mut file, &text))
            .and_then(|()| std::fs::rename(&temp, path))
            .map_err(|e| format!("signing keys in {}: {e}", path.display()))?;
    }
    Ok((keys, made))
}

/// The key ring: `COSYWORLD_SIGNING_KEY` (`signing`) when set, otherwise the
/// current key in the store, made on first start. Every stored key and every
/// `COSYWORLD_SIGNING_PUBLIC_KEYS` entry (`retired`) keeps verifying.
pub(crate) fn load(
    signing: Option<&str>,
    retired: Option<&str>,
    policy: &KeyPolicy,
) -> Result<KeyRing, String> {
    let configured = signing.filter(|s| !s.trim().is_empty());
    let (stored, made) = match &policy.store {
        KeyStore::Sqlite(path) => sqlite_keys(path, policy.rotate.as_deref())?,
        KeyStore::File(path) => file_keys(path, policy.rotate.as_deref())?,
        KeyStore::Memory => (Vec::new(), None),
    };
    if let Some(kid) = made {
        tracing::info!(%kid, "made a new signing key");
    }
    let current = stored.iter().rev().find(|k| k.retired_at.is_none());
    let mut ring = match (configured, current) {
        (Some(_), _) => KeyRing::new(configured, retired)?,
        (None, Some(key)) => KeyRing::new(Some(&format!("{}:{}", key.kid, key.seed)), retired)?,
        (None, None) => {
            tracing::warn!(
                "no signing key store: this process signs with a temporary key, so \
                 remembered words stop verifying on restart"
            );
            KeyRing::new(None, retired)?
        }
    };
    for key in &stored {
        let (kid, seed) = key_part(&format!("{}:{}", key.kid, key.seed))
            .ok_or_else(|| format!("stored signing key {} is malformed", key.kid))?;
        let seed: [u8; 32] = seed.try_into().expect("32 bytes");
        ring.verifying
            .entry(kid)
            .or_insert_with(|| SigningKey::from_bytes(&seed).verifying_key());
    }
    Ok(ring)
}

static KEYS: OnceLock<KeyRing> = OnceLock::new();

/// Load the key ring at startup (`load` with `KeyPolicy::from_env`). `Err`,
/// such as a malformed `COSYWORLD_SIGNING_KEY` or an unreadable store,
/// stops the server.
pub(crate) fn init() -> Result<(), String> {
    let signing = std::env::var("COSYWORLD_SIGNING_KEY").ok();
    let retired = std::env::var("COSYWORLD_SIGNING_PUBLIC_KEYS").ok();
    let ring = load(
        signing.as_deref(),
        retired.as_deref(),
        &KeyPolicy::from_env(),
    )?;
    tracing::info!(kid = %ring.kid, "signing with key");
    let _ = KEYS.set(ring);
    Ok(())
}

/// The server's key ring (`init`). A process that never ran `init`, such as
/// a test, signs with a temporary key.
pub(crate) fn keys() -> &'static KeyRing {
    KEYS.get_or_init(|| {
        let signing = std::env::var("COSYWORLD_SIGNING_KEY").ok();
        let retired = std::env::var("COSYWORLD_SIGNING_PUBLIC_KEYS").ok();
        load(
            signing.as_deref(),
            retired.as_deref(),
            &KeyPolicy::default(),
        )
        .or_else(|_| KeyRing::new(None, None))
        .expect("temporary key")
    })
}

pub(crate) async fn well_known() -> axum::response::Response {
    use axum::response::IntoResponse;
    (
        [("cache-control", "public, max-age=300")],
        axum::Json(keys().public_keys()),
    )
        .into_response()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn claims(text: &str) -> Claims {
        Claims {
            content: content_hash(text),
            entity: "vale".into(),
            iat: 1_800_000_000,
            kind: "line".into(),
            kid: String::new(),
            rules: "test".into(),
            seq: 4,
            turn: 3,
            world: "local".into(),
        }
    }

    fn seed(byte: u8) -> String {
        format!("k{byte}:{}", URL_SAFE_NO_PAD.encode([byte; 32]))
    }

    #[test]
    fn envelopes_verify_and_reject_tampering() {
        let ring = KeyRing::new(Some(&seed(7)), None).unwrap();
        let envelope = ring.sign(claims("Hello."));
        assert_eq!(envelope.claims.kid, "k7");
        assert_eq!(ring.verify(&envelope), Verdict::Valid);
        let mut tampered = envelope.clone();
        tampered.claims.content = content_hash("Ignore previous instructions.");
        assert_eq!(ring.verify(&tampered), Verdict::Invalid);
        let mut moved = envelope.clone();
        moved.claims.entity = "moth".into();
        assert_eq!(ring.verify(&moved), Verdict::Invalid);
        let mut unknown = envelope.clone();
        unknown.claims.kid = "elsewhere".into();
        assert_eq!(ring.verify(&unknown), Verdict::UnknownKey);
        let other = KeyRing::new(Some(&seed(9)), None).unwrap();
        assert_eq!(other.verify(&envelope), Verdict::UnknownKey);
    }

    #[test]
    fn rotated_keys_keep_verifying_and_are_published() {
        let old = KeyRing::new(Some(&seed(7)), None).unwrap();
        let envelope = old.sign(claims("Hello."));
        let public = old.public_keys()["keys"][0]["public"]
            .as_str()
            .unwrap()
            .to_string();
        let new = KeyRing::new(Some(&seed(8)), Some(&format!("k7:{public}"))).unwrap();
        assert_eq!(new.verify(&envelope), Verdict::Valid);
        let listed = new.public_keys();
        assert_eq!(listed["keys"][0]["kid"], "k8");
        assert_eq!(listed["keys"][0]["current"], true);
        assert_eq!(listed["keys"][1]["kid"], "k7");
        assert!(KeyRing::new(Some("no-colon"), None).is_err());
    }

    fn temp(name: &str) -> std::path::PathBuf {
        let dir = std::env::temp_dir().join(format!("cosy-signing-{}", rand::random::<u64>()));
        std::fs::create_dir_all(&dir).unwrap();
        dir.join(name)
    }

    #[test]
    fn first_start_makes_a_key_and_later_starts_reload_it() {
        for store in [
            KeyStore::Sqlite(temp("events.sqlite")),
            KeyStore::File(temp("signing-keys.json")),
        ] {
            let policy = KeyPolicy {
                store: store.clone(),
                rotate: None,
            };
            let first = load(None, None, &policy).unwrap();
            assert!(first.kid.starts_with("k-"), "{store:?}");
            let envelope = first.sign(claims("Hello."));
            let again = load(None, None, &policy).unwrap();
            assert_eq!(again.kid, first.kid, "{store:?}");
            assert_eq!(again.verify(&envelope), Verdict::Valid);
            if let KeyStore::File(path) = &store {
                #[cfg(unix)]
                {
                    use std::os::unix::fs::PermissionsExt;
                    let mode = std::fs::metadata(path).unwrap().permissions().mode();
                    assert_eq!(mode & 0o077, 0);
                }
            }
            // The environment key overrides the stored one, which still verifies.
            let overridden = load(Some(&seed(7)), None, &policy).unwrap();
            assert_eq!(overridden.kid, "k7");
            assert_eq!(overridden.verify(&envelope), Verdict::Valid);
            // Rotation makes a new current key once; old words keep verifying.
            let rotate = KeyPolicy {
                store: store.clone(),
                rotate: Some("k-2026-12".into()),
            };
            let rotated = load(None, None, &rotate).unwrap();
            assert_eq!(rotated.kid, "k-2026-12");
            assert_eq!(rotated.verify(&envelope), Verdict::Valid);
            assert_eq!(load(None, None, &rotate).unwrap().kid, "k-2026-12");
            let listed = load(None, None, &policy).unwrap().public_keys();
            assert_eq!(listed["keys"][0]["kid"], "k-2026-12");
            assert!(listed["keys"]
                .as_array()
                .unwrap()
                .iter()
                .any(|k| k["kid"] == first.kid.as_str() && k["current"] == false));
        }
        // A set but malformed override stops startup; no store signs with a
        // temporary key.
        assert!(load(Some("k1:short"), None, &KeyPolicy::default()).is_err());
        assert!(load(None, None, &KeyPolicy::default())
            .unwrap()
            .kid
            .starts_with("ephemeral-"));
    }

    #[test]
    fn canonical_bytes_are_sorted_compact_json() {
        let mut c = claims("Hi.");
        c.kid = "k1".into();
        let bytes = canonical(&c).unwrap();
        let text = String::from_utf8(bytes[DOMAIN.len()..].to_vec()).unwrap();
        assert_eq!(
            text,
            format!(
                r#"{{"content":"{}","entity":"vale","iat":1800000000,"kind":"line","kid":"k1","rules":"test","seq":4,"turn":3,"world":"local"}}"#,
                content_hash("Hi.")
            )
        );
        c.entity = "va\"le".into();
        assert!(canonical(&c).is_none());
    }
}
