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

/// The server's key ring, read once from `COSYWORLD_SIGNING_KEY` and
/// `COSYWORLD_SIGNING_PUBLIC_KEYS`. Without a key, each process makes an
/// ephemeral one: content it signed stops verifying after a restart.
pub(crate) fn keys() -> &'static KeyRing {
    static KEYS: OnceLock<KeyRing> = OnceLock::new();
    KEYS.get_or_init(|| {
        let signing = std::env::var("COSYWORLD_SIGNING_KEY").ok();
        let retired = std::env::var("COSYWORLD_SIGNING_PUBLIC_KEYS").ok();
        KeyRing::new(signing.as_deref(), retired.as_deref()).unwrap_or_else(|failure| {
            tracing::error!(%failure, "signing keys are invalid; using an ephemeral key");
            KeyRing::new(None, None).expect("ephemeral key")
        })
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
