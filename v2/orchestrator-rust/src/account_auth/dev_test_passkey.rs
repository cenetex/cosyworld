//! The `.dev` agent test passkey (`COSYWORLD_DEV_TEST_PASSKEY`).
//!
//! A members-only server takes no sign-ups, so startup seeds one ordinary
//! `agent-test` account with the single passkey whose public half (credential
//! id, P-256 x/y) this variable holds. Agents keep the private key and sign in
//! through a browser virtual authenticator. Off by default and fail-closed: an
//! open server refuses to start with it set, a malformed value stops startup,
//! a taken username skips seeding, and unsetting or rotating it removes the
//! old passkey and revokes its sessions on the next boot. Changes are logged.

use super::*;

pub(super) const TEST_PASSKEY_ENV: &str = "COSYWORLD_DEV_TEST_PASSKEY";
/// Fixed so the passkey's user handle and the seeded row always agree.
pub(super) const TEST_USER_ID: &str = "0a9e17e5-7e57-4a11-8a6e-000000000001";
pub(super) const TEST_USERNAME: &str = "agent-test";
const TEST_PASSKEY_LABEL: &str = "agent-test virtual authenticator";

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct TestPasskeyConfig {
    /// Base64url credential id.
    credential_id: String,
    /// Base64url P-256 public key coordinates (a JWK's `x` and `y`).
    x: String,
    y: String,
}

/// Seed or remove the test passkey from the environment at startup.
pub(super) fn apply_from_env(path: &Path, members_only: bool) -> io::Result<()> {
    let raw = std::env::var(TEST_PASSKEY_ENV).ok();
    apply(path, members_only, raw.as_deref())
}

pub(super) fn apply(path: &Path, members_only: bool, raw: Option<&str>) -> io::Result<()> {
    let raw = raw.map(str::trim).filter(|value| !value.is_empty());
    let Some(raw) = raw else {
        return remove(path).map_err(|error| io::Error::other(error.to_string()));
    };
    if !members_only {
        return Err(io::Error::other(format!(
            "{TEST_PASSKEY_ENV} is only allowed when COSYWORLD_PASSKEYS=members"
        )));
    }
    let (credential_id, passkey) = parse(raw)?;
    seed(path, &credential_id, &passkey).map_err(|error| io::Error::other(error.to_string()))
}

fn parse(raw: &str) -> io::Result<(String, Passkey)> {
    let invalid = |why: &str| io::Error::other(format!("{TEST_PASSKEY_ENV} is invalid: {why}"));
    let config: TestPasskeyConfig =
        serde_json::from_str(raw).map_err(|_| invalid("expected {credential_id, x, y} JSON"))?;
    let decode = |value: &str| URL_SAFE_NO_PAD.decode(value.trim().trim_end_matches('='));
    let credential = decode(&config.credential_id).map_err(|_| invalid("credential_id"))?;
    let x = decode(&config.x).map_err(|_| invalid("x"))?;
    let y = decode(&config.y).map_err(|_| invalid("y"))?;
    if !(16..=255).contains(&credential.len()) {
        return Err(invalid("credential_id must be 16 to 255 bytes"));
    }
    if x.len() != 32 || y.len() != 32 {
        return Err(invalid("x and y must be 32-byte P-256 coordinates"));
    }
    let credential_id = URL_SAFE_NO_PAD.encode(&credential);
    // The stored form of a webauthn-rs passkey: a user-verified, device-bound
    // ES256 credential with no attestation.
    let passkey = serde_json::from_value(serde_json::json!({
        "cred": {
            "cred_id": credential_id,
            "cred": {
                "type_": "ES256",
                "key": {"EC_EC2": {
                    "curve": "SECP256R1",
                    "x": URL_SAFE_NO_PAD.encode(&x),
                    "y": URL_SAFE_NO_PAD.encode(&y),
                }},
            },
            "counter": 0,
            "transports": null,
            "user_verified": true,
            "backup_eligible": false,
            "backup_state": false,
            "registration_policy": "required",
            "extensions": {},
            "attestation": {"data": "None", "metadata": "None"},
            "attestation_format": "none",
        }
    }))
    .map_err(|error| invalid(&error.to_string()))?;
    Ok((credential_id, passkey))
}

fn seed(path: &Path, credential_id: &str, passkey: &Passkey) -> AccountResult<()> {
    let mut conn = open_event_store(path)?;
    let transaction = conn.transaction()?;
    let now = now_unix_secs() as i64;
    let owner: Option<String> = transaction
        .query_row(
            "SELECT id FROM auth_users WHERE username = ?1",
            params![TEST_USERNAME],
            |row| row.get(0),
        )
        .optional()?;
    match owner.as_deref() {
        Some(TEST_USER_ID) => {}
        Some(_) => {
            error!(
                "{TEST_PASSKEY_ENV} skipped: username {TEST_USERNAME} belongs to another account"
            );
            return Ok(());
        }
        None => {
            transaction.execute(
                "INSERT INTO auth_users
                 (id, username, display_name, status, created_at_unix, updated_at_unix)
                 VALUES (?1, ?2, ?2, 'active', ?3, ?3)",
                params![TEST_USER_ID, TEST_USERNAME, now],
            )?;
            info!("{TEST_PASSKEY_ENV}: created the {TEST_USERNAME} account");
        }
    }
    let replaced = transaction.execute(
        "DELETE FROM auth_passkeys WHERE user_id = ?1 AND credential_id != ?2",
        params![TEST_USER_ID, credential_id],
    )?;
    if replaced > 0 {
        revoke_sessions(&transaction, now)?;
    }
    let passkey_json = serde_json::to_string(passkey)
        .map_err(|error| account_error(format!("failed to serialize passkey: {error}")))?;
    // Keep an existing row so its signature counter survives restarts.
    let inserted = transaction.execute(
        "INSERT OR IGNORE INTO auth_passkeys
         (credential_id, user_id, label, passkey_json, created_at_unix, last_used_at_unix)
         VALUES (?1, ?2, ?3, ?4, ?5, NULL)",
        params![
            credential_id,
            TEST_USER_ID,
            TEST_PASSKEY_LABEL,
            passkey_json,
            now
        ],
    )?;
    let holder: String = transaction.query_row(
        "SELECT user_id FROM auth_passkeys WHERE credential_id = ?1",
        params![credential_id],
        |row| row.get(0),
    )?;
    if holder != TEST_USER_ID {
        return Err(account_error(format!(
            "{TEST_PASSKEY_ENV} credential is registered to another account"
        )));
    }
    transaction.commit()?;
    info!(
        "{TEST_PASSKEY_ENV}: {TEST_USERNAME} passkey {} {} ({} replaced)",
        compact_credential_id(credential_id),
        if inserted > 0 { "installed" } else { "kept" },
        replaced
    );
    Ok(())
}

fn remove(path: &Path) -> AccountResult<()> {
    let mut conn = open_event_store(path)?;
    let transaction = conn.transaction()?;
    let removed = transaction.execute(
        "DELETE FROM auth_passkeys WHERE user_id = ?1",
        params![TEST_USER_ID],
    )?;
    if removed > 0 {
        revoke_sessions(&transaction, now_unix_secs() as i64)?;
        info!("{TEST_PASSKEY_ENV} unset: removed the {TEST_USERNAME} passkey and its sessions");
    }
    transaction.commit()?;
    Ok(())
}

fn revoke_sessions(transaction: &rusqlite::Transaction<'_>, now: i64) -> AccountResult<()> {
    transaction.execute(
        "UPDATE auth_sessions SET revoked_at_unix = ?2
         WHERE user_id = ?1 AND revoked_at_unix IS NULL",
        params![TEST_USER_ID, now],
    )?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::super::passkey_access_tests::{members_state, send_json as send};
    use super::*;
    use openssl::{
        bn::BigNumContext,
        ec::{EcGroup, EcKey},
        ecdsa::EcdsaSig,
        nid::Nid,
    };
    use serde_json::json;

    struct TestKey {
        key: EcKey<openssl::pkey::Private>,
        credential_id: Vec<u8>,
    }

    impl TestKey {
        fn new() -> Self {
            let group = EcGroup::from_curve_name(Nid::X9_62_PRIME256V1).unwrap();
            let mut credential_id = vec![0u8; 32];
            openssl::rand::rand_bytes(&mut credential_id).unwrap();
            Self {
                key: EcKey::generate(&group).unwrap(),
                credential_id,
            }
        }

        fn config(&self) -> String {
            let group = EcGroup::from_curve_name(Nid::X9_62_PRIME256V1).unwrap();
            let mut ctx = BigNumContext::new().unwrap();
            let mut x = openssl::bn::BigNum::new().unwrap();
            let mut y = openssl::bn::BigNum::new().unwrap();
            self.key
                .public_key()
                .affine_coordinates(&group, &mut x, &mut y, &mut ctx)
                .unwrap();
            json!({
                "credential_id": URL_SAFE_NO_PAD.encode(&self.credential_id),
                "x": URL_SAFE_NO_PAD.encode(x.to_vec_padded(32).unwrap()),
                "y": URL_SAFE_NO_PAD.encode(y.to_vec_padded(32).unwrap()),
            })
            .to_string()
        }

        /// What a browser's virtual authenticator returns for this ceremony.
        fn assert(&self, start: &serde_json::Value, sign_count: u32) -> serde_json::Value {
            let options = &start["public_key"]["publicKey"];
            let client_data = json!({
                "type": "webauthn.get",
                "challenge": options["challenge"],
                "origin": "http://localhost:3102",
                "crossOrigin": false,
            })
            .to_string();
            let mut auth_data = Sha256::digest(b"localhost").to_vec();
            auth_data.push(0x05); // user present + user verified
            auth_data.extend_from_slice(&sign_count.to_be_bytes());
            let mut signed = auth_data.clone();
            signed.extend_from_slice(&Sha256::digest(client_data.as_bytes()));
            let signature = EcdsaSig::sign(&Sha256::digest(&signed), &self.key)
                .unwrap()
                .to_der()
                .unwrap();
            let id = URL_SAFE_NO_PAD.encode(&self.credential_id);
            json!({
                "ceremony_id": start["ceremony_id"],
                "credential": {
                    "id": id,
                    "rawId": id,
                    "type": "public-key",
                    "clientExtensionResults": {},
                    "response": {
                        "authenticatorData": URL_SAFE_NO_PAD.encode(&auth_data),
                        "clientDataJSON": URL_SAFE_NO_PAD.encode(client_data.as_bytes()),
                        "signature": URL_SAFE_NO_PAD.encode(signature),
                        "userHandle": URL_SAFE_NO_PAD.encode(
                            Uuid::parse_str(TEST_USER_ID).unwrap().as_bytes()
                        ),
                    },
                },
            })
        }
    }

    async fn sign_in(state: &AppState, key: &TestKey, sign_count: u32) -> (u16, Option<String>) {
        let (_, start, _) = send(state, "POST", "/auth/passkey/login/start", json!({}), None).await;
        let finish = key.assert(&start, sign_count);
        let (status, body, cookie) =
            send(state, "POST", "/auth/passkey/login/finish", finish, None).await;
        if status == 200 {
            assert_eq!(body["username"], TEST_USERNAME);
        }
        (status, cookie)
    }

    async fn worlds_status(state: &AppState, cookie: &str) -> u16 {
        let path = "/card-game/shared/worlds";
        send(state, "GET", path, json!(null), Some(cookie)).await.0
    }

    #[test]
    fn config_fails_closed() {
        let (_, path) = members_state();
        let key = TestKey::new();
        // An open server (production) never takes a test passkey.
        assert!(apply(&path, false, Some(&key.config())).is_err());
        for bad in [
            "not json",
            r#"{"credential_id":"AAAA","x":"","y":""}"#,
            r#"{"credential_id":"AAAAAAAAAAAAAAAAAAAAAA","x":"AA","y":"AA"}"#,
        ] {
            assert!(apply(&path, true, Some(bad)).is_err(), "{bad}");
        }
        // Unset and blank both mean off and change nothing.
        apply(&path, true, None).unwrap();
        apply(&path, false, Some("  ")).unwrap();
        assert!(find_user_by_username(&path, TEST_USERNAME)
            .unwrap()
            .is_none());
        // A real account that already holds the name is left alone.
        open_event_store(&path)
            .unwrap()
            .execute(
                "INSERT INTO auth_users
                 (id, username, display_name, status, created_at_unix, updated_at_unix)
                 VALUES ('7d3f4b9e-2c1a-4e8b-9f60-1a2b3c4d5e6f', ?1, 'Someone', 'active', 1, 1)",
                params![TEST_USERNAME],
            )
            .unwrap();
        apply(&path, true, Some(&key.config())).unwrap();
        assert!(load_passkeys(&path, TEST_USER_ID).unwrap().is_empty());
        let _ = std::fs::remove_file(path);
    }

    #[tokio::test]
    async fn agent_test_signs_in_on_members_server_and_unsetting_revokes_it() {
        let (state, path) = members_state();
        let key = TestKey::new();
        apply(&path, true, Some(&key.config())).unwrap();
        // A restart keeps the row, and its counter, as is.
        apply(&path, true, Some(&key.config())).unwrap();

        let (status, cookie) = sign_in(&state, &key, 100).await;
        assert_eq!(status, 200);
        let cookie = cookie.expect("session cookie");
        assert_ne!(worlds_status(&state, &cookie).await, 401);
        // A replayed or rewound counter is refused.
        assert_eq!(sign_in(&state, &key, 100).await.0, 401);
        assert_eq!(sign_in(&state, &key, 101).await.0, 200);

        // Rotating the key retires the old credential and its sessions.
        let rotated = TestKey::new();
        apply(&path, true, Some(&rotated.config())).unwrap();
        assert_eq!(sign_in(&state, &key, 200).await.0, 401);
        assert_eq!(worlds_status(&state, &cookie).await, 401);
        assert_eq!(sign_in(&state, &rotated, 1).await.0, 200);

        // Unsetting the variable removes the passkey on the next boot.
        apply(&path, true, None).unwrap();
        assert_eq!(sign_in(&state, &rotated, 2).await.0, 401);
        assert!(load_passkeys(&path, TEST_USER_ID).unwrap().is_empty());
        let _ = std::fs::remove_file(path);
    }
}
