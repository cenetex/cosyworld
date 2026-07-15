use super::*;

use axum::http::{header::CACHE_CONTROL, HeaderValue};
use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};
use sha2::{Digest, Sha256};
use webauthn_rs::prelude::{
    DiscoverableAuthentication, DiscoverableKey, Passkey, PasskeyAuthentication,
    PasskeyRegistration, PublicKeyCredential, RegisterPublicKeyCredential, Url, Uuid, Webauthn,
    WebauthnBuilder,
};

const ACCOUNT_SESSION_TTL: Duration = Duration::from_secs(30 * 24 * 60 * 60);
const ACCOUNT_STEP_UP_TTL: Duration = Duration::from_secs(10 * 60);
const CEREMONY_TTL: Duration = Duration::from_secs(5 * 60);
const WALLET_LINK_TTL: Duration = Duration::from_secs(5 * 60);
const WALLET_CLAIM_TTL: Duration = Duration::from_secs(5 * 60);
const WALLET_CLAIM_COMPLETE_GRACE: Duration = Duration::from_secs(2 * 60);
const ACCOUNT_WALLET_CAPABILITY_TTL: Duration = Duration::from_secs(30 * 60);

type AccountResult<T> = Result<T, AccountError>;

#[derive(Debug)]
enum AccountError {
    Io(io::Error),
    Sqlite(rusqlite::Error),
    Message(String),
}

impl std::fmt::Display for AccountError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Io(error) => error.fmt(formatter),
            Self::Sqlite(error) => error.fmt(formatter),
            Self::Message(message) => formatter.write_str(message),
        }
    }
}

impl std::error::Error for AccountError {}

impl From<io::Error> for AccountError {
    fn from(error: io::Error) -> Self {
        Self::Io(error)
    }
}

impl From<rusqlite::Error> for AccountError {
    fn from(error: rusqlite::Error) -> Self {
        Self::Sqlite(error)
    }
}

fn account_error(message: impl Into<String>) -> AccountError {
    AccountError::Message(message.into())
}

pub(super) struct AccountAuth {
    webauthn: Webauthn,
    db_path: Option<Arc<PathBuf>>,
    ceremonies: StdMutex<BTreeMap<String, AccountCeremony>>,
    wallet_link_challenges: StdMutex<BTreeMap<String, WalletLinkChallenge>>,
    wallet_claims: StdMutex<BTreeMap<String, WalletClaimIntent>>,
    wallet_claim_challenges: StdMutex<BTreeMap<String, WalletClaimChallenge>>,
    rp_origin: String,
    cookie_name: String,
    secure_cookie: bool,
}

enum AccountCeremony {
    Registration {
        expires_at: Instant,
        user_id: Uuid,
        username: String,
        display_name: String,
        label: String,
        bootstrap_wallet: Option<String>,
        new_user: bool,
        state: PasskeyRegistration,
    },
    Authentication {
        expires_at: Instant,
        user_id: Uuid,
        state: PasskeyAuthentication,
    },
    DiscoverableAuthentication {
        expires_at: Instant,
        state: DiscoverableAuthentication,
    },
}

impl AccountCeremony {
    fn expires_at(&self) -> Instant {
        match self {
            Self::Registration { expires_at, .. }
            | Self::Authentication { expires_at, .. }
            | Self::DiscoverableAuthentication { expires_at, .. } => *expires_at,
        }
    }
}

#[derive(Clone, Debug)]
struct WalletLinkChallenge {
    user_id: String,
    wallet_address: String,
    message: String,
    expires_at: Instant,
}

#[derive(Clone, Debug)]
struct WalletClaimIntent {
    user_id: String,
    poll_token: String,
    expires_at: Instant,
    expires_at_unix: u64,
    wallet_address: Option<String>,
    moved: bool,
    completed_at: Option<Instant>,
}

#[derive(Clone, Debug)]
struct WalletClaimChallenge {
    claim_id: String,
    user_id: String,
    wallet_address: String,
    message: String,
    claimed_elsewhere: bool,
    expires_at: Instant,
}

#[derive(Clone, Debug)]
struct AccountSessionRecord {
    user_id: String,
    username: String,
    display_name: String,
    verified_at_unix: u64,
}

#[derive(Debug)]
struct StoredPasskey {
    credential_id: String,
    passkey: Passkey,
}

struct RegisteredPasskey<'a> {
    user_id: &'a str,
    username: &'a str,
    display_name: &'a str,
    credential_id: &'a str,
    label: &'a str,
    passkey: &'a Passkey,
    bootstrap_wallet: Option<&'a str>,
    new_user: bool,
}

#[derive(Debug, Deserialize)]
pub(super) struct PasskeyRegistrationStartRequest {
    #[serde(default)]
    username: String,
    #[serde(default)]
    display_name: String,
    #[serde(default)]
    label: String,
    wallet_session: Option<String>,
}

#[derive(Debug, Deserialize)]
pub(super) struct PasskeyRegistrationFinishRequest {
    ceremony_id: String,
    credential: serde_json::Value,
}

#[derive(Debug, Deserialize)]
pub(super) struct PasskeyLoginStartRequest {
    #[serde(default)]
    username: String,
}

#[derive(Debug, Deserialize)]
pub(super) struct PasskeyLoginFinishRequest {
    ceremony_id: String,
    credential: serde_json::Value,
}

#[derive(Debug, Deserialize)]
pub(super) struct WalletLinkStartRequest {
    wallet_address: String,
}

#[derive(Debug, Deserialize)]
pub(super) struct WalletLinkFinishRequest {
    wallet_address: String,
    nonce: String,
    signature: Vec<u8>,
}

#[derive(Debug, Deserialize)]
pub(super) struct WalletSelectionRequest {
    wallet_address: String,
}

#[derive(Debug, Deserialize)]
pub(super) struct WalletClaimStatusQuery {
    claim_id: String,
    poll_token: String,
}

#[derive(Debug, Deserialize)]
pub(super) struct WalletClaimChallengeRequest {
    wallet_address: String,
}

#[derive(Debug, Deserialize)]
pub(super) struct WalletClaimFinishRequest {
    wallet_address: String,
    nonce: String,
    signature: Vec<u8>,
}

#[derive(Debug, Serialize)]
struct CeremonyResponse {
    ok: bool,
    ceremony_id: String,
    public_key: serde_json::Value,
}

#[derive(Debug, Serialize)]
struct WalletChallengeResponse {
    ok: bool,
    wallet_address: String,
    nonce: String,
    message: String,
    expires_at_unix: u64,
}

#[derive(Debug, Serialize)]
struct WalletClaimStartResponse {
    ok: bool,
    claim_id: String,
    poll_token: String,
    mobile_path: String,
    qr_svg_path: String,
    expires_at_unix: u64,
}

#[derive(Debug, Serialize)]
struct WalletClaimStatusResponse {
    ok: bool,
    state: String,
    wallet_address: Option<String>,
    moved: bool,
    expires_at_unix: Option<u64>,
    error: Option<String>,
}

#[derive(Debug, Serialize)]
struct WalletClaimChallengeResponse {
    ok: bool,
    wallet_address: String,
    nonce: String,
    message: String,
    claimed_elsewhere: bool,
    expires_at_unix: u64,
    error: Option<String>,
}

#[derive(Debug, Serialize)]
struct WalletClaimFinishResponse {
    ok: bool,
    state: String,
    wallet_address: Option<String>,
    moved: bool,
    error: Option<String>,
}

#[derive(Debug, Serialize)]
struct PasskeyView {
    credential_id: String,
    label: String,
    created_at_unix: u64,
    last_used_at_unix: Option<u64>,
}

#[derive(Debug, Serialize)]
struct WalletView {
    wallet_address: String,
    role: String,
    verified_at_unix: u64,
}

#[derive(Debug, Serialize)]
struct IdentityResponse {
    ok: bool,
    authenticated: bool,
    user_id: Option<String>,
    username: Option<String>,
    display_name: Option<String>,
    passkeys: Vec<PasskeyView>,
    wallets: Vec<WalletView>,
    active_wallet: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    wallet_session: Option<String>,
    step_up_required: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    error: Option<String>,
}

impl IdentityResponse {
    fn signed_out() -> Self {
        Self {
            ok: true,
            authenticated: false,
            user_id: None,
            username: None,
            display_name: None,
            passkeys: Vec::new(),
            wallets: Vec::new(),
            active_wallet: None,
            wallet_session: None,
            step_up_required: false,
            error: None,
        }
    }
}

impl AccountAuth {
    pub(super) fn from_env(db_path: Option<Arc<PathBuf>>, production: bool) -> io::Result<Self> {
        let rp_id = std::env::var("COSYWORLD_WEBAUTHN_RP_ID")
            .ok()
            .map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty())
            .or_else(|| (!production).then(|| "localhost".to_string()))
            .ok_or_else(|| io::Error::other("production requires COSYWORLD_WEBAUTHN_RP_ID"))?;
        let rp_origin = std::env::var("COSYWORLD_WEBAUTHN_ORIGIN")
            .ok()
            .map(|value| value.trim().trim_end_matches('/').to_string())
            .filter(|value| !value.is_empty())
            .or_else(|| (!production).then(|| "http://localhost:3102".to_string()))
            .ok_or_else(|| io::Error::other("production requires COSYWORLD_WEBAUTHN_ORIGIN"))?;
        let origin = Url::parse(&rp_origin)
            .map_err(|error| io::Error::other(format!("invalid WebAuthn origin: {error}")))?;
        let mut builder = WebauthnBuilder::new(&rp_id, &origin)
            .map_err(|error| io::Error::other(format!("invalid WebAuthn RP: {error}")))?
            .rp_name("CosyWorld");
        if let Ok(extra_origins) = std::env::var("COSYWORLD_WEBAUTHN_EXTRA_ORIGINS") {
            for extra in extra_origins
                .split(',')
                .map(str::trim)
                .filter(|v| !v.is_empty())
            {
                let extra = Url::parse(extra).map_err(|error| {
                    io::Error::other(format!("invalid WebAuthn extra origin {extra}: {error}"))
                })?;
                builder = builder.append_allowed_origin(&extra);
            }
        }
        let webauthn = builder
            .build()
            .map_err(|error| io::Error::other(format!("failed to configure WebAuthn: {error}")))?;
        if let Some(path) = db_path.as_deref() {
            init_account_schema(path).map_err(|error| io::Error::other(error.to_string()))?;
        }
        let secure_cookie = rp_origin.starts_with("https://");
        Ok(Self {
            webauthn,
            db_path,
            ceremonies: StdMutex::new(BTreeMap::new()),
            wallet_link_challenges: StdMutex::new(BTreeMap::new()),
            wallet_claims: StdMutex::new(BTreeMap::new()),
            wallet_claim_challenges: StdMutex::new(BTreeMap::new()),
            rp_origin,
            cookie_name: if secure_cookie {
                "__Host-cosyworld_session".to_string()
            } else {
                "cosyworld_session".to_string()
            },
            secure_cookie,
        })
    }

    #[cfg(test)]
    pub(super) fn for_test(db_path: Option<Arc<PathBuf>>) -> Arc<Self> {
        let origin = Url::parse("http://localhost:3102").expect("test WebAuthn origin");
        let webauthn = WebauthnBuilder::new("localhost", &origin)
            .expect("test WebAuthn RP")
            .rp_name("CosyWorld Test")
            .build()
            .expect("test WebAuthn config");
        if let Some(path) = db_path.as_deref() {
            init_account_schema(path).expect("test account schema");
        }
        Arc::new(Self {
            webauthn,
            db_path,
            ceremonies: StdMutex::new(BTreeMap::new()),
            wallet_link_challenges: StdMutex::new(BTreeMap::new()),
            wallet_claims: StdMutex::new(BTreeMap::new()),
            wallet_claim_challenges: StdMutex::new(BTreeMap::new()),
            rp_origin: "http://localhost:3102".to_string(),
            cookie_name: "cosyworld_session".to_string(),
            secure_cookie: false,
        })
    }

    fn path(&self) -> AccountResult<&Path> {
        self.db_path
            .as_deref()
            .map(PathBuf::as_path)
            .ok_or_else(|| account_error("account persistence is unavailable"))
    }

    fn cleanup_ceremonies(&self) {
        let now = Instant::now();
        if let Ok(mut ceremonies) = self.ceremonies.lock() {
            ceremonies.retain(|_, ceremony| ceremony.expires_at() > now);
        }
    }

    fn store_ceremony(&self, ceremony: AccountCeremony) -> AccountResult<String> {
        self.cleanup_ceremonies();
        let ceremony_id = random_hex(24);
        self.ceremonies
            .lock()
            .map_err(|_| account_error("authentication ceremony lock poisoned"))?
            .insert(ceremony_id.clone(), ceremony);
        Ok(ceremony_id)
    }

    fn take_ceremony(&self, ceremony_id: &str) -> AccountResult<AccountCeremony> {
        let ceremony_id = clean_auth_token(ceremony_id, 48)
            .ok_or_else(|| account_error("authentication ceremony is invalid"))?;
        self.cleanup_ceremonies();
        self.ceremonies
            .lock()
            .map_err(|_| account_error("authentication ceremony lock poisoned"))?
            .remove(&ceremony_id)
            .ok_or_else(|| account_error("authentication ceremony expired"))
    }

    fn session_from_headers(
        &self,
        headers: &HeaderMap,
    ) -> AccountResult<Option<AccountSessionRecord>> {
        let Some(token) = cookie_value(headers, &self.cookie_name) else {
            return Ok(None);
        };
        let token_hash = hash_session_token(&token);
        let conn = open_event_store(self.path()?)?;
        let now = now_unix_secs() as i64;
        conn.execute(
            "DELETE FROM auth_sessions WHERE expires_at_unix <= ?1 OR revoked_at_unix IS NOT NULL",
            params![now],
        )?;
        let session = conn
            .query_row(
                "SELECT users.id, users.username, users.display_name, auth_sessions.verified_at_unix
                 FROM auth_sessions
                 JOIN auth_users AS users ON users.id = auth_sessions.user_id
                 WHERE auth_sessions.token_hash = ?1
                   AND auth_sessions.expires_at_unix > ?2
                   AND auth_sessions.revoked_at_unix IS NULL
                   AND users.status = 'active'",
                params![token_hash, now],
                |row| {
                    Ok(AccountSessionRecord {
                        user_id: row.get(0)?,
                        username: row.get(1)?,
                        display_name: row.get(2)?,
                        verified_at_unix: row.get::<_, i64>(3)?.max(0) as u64,
                    })
                },
            )
            .optional()?;
        if session.is_some() {
            conn.execute(
                "UPDATE auth_sessions SET last_seen_at_unix = ?2 WHERE token_hash = ?1",
                params![token_hash, now],
            )?;
        }
        Ok(session)
    }

    fn issue_session(&self, user_id: &str) -> AccountResult<(String, String)> {
        let token = random_hex(32);
        let token_hash = hash_session_token(&token);
        let now = now_unix_secs();
        let conn = open_event_store(self.path()?)?;
        conn.execute(
            "INSERT INTO auth_sessions
             (token_hash, user_id, created_at_unix, verified_at_unix, last_seen_at_unix,
              expires_at_unix, revoked_at_unix)
             VALUES (?1, ?2, ?3, ?3, ?3, ?4, NULL)",
            params![
                token_hash,
                user_id,
                now as i64,
                now.saturating_add(ACCOUNT_SESSION_TTL.as_secs()) as i64
            ],
        )?;
        Ok((token.clone(), self.session_cookie(&token)))
    }

    fn session_cookie(&self, token: &str) -> String {
        format!(
            "{}={}; Path=/; Max-Age={}; HttpOnly; SameSite=Strict{}",
            self.cookie_name,
            token,
            ACCOUNT_SESSION_TTL.as_secs(),
            if self.secure_cookie { "; Secure" } else { "" }
        )
    }

    fn clear_cookie(&self) -> String {
        format!(
            "{}=; Path=/; Max-Age=0; HttpOnly; SameSite=Strict{}",
            self.cookie_name,
            if self.secure_cookie { "; Secure" } else { "" }
        )
    }

    fn revoke_header_session(&self, headers: &HeaderMap) -> AccountResult<()> {
        let Some(token) = cookie_value(headers, &self.cookie_name) else {
            return Ok(());
        };
        let conn = open_event_store(self.path()?)?;
        conn.execute(
            "UPDATE auth_sessions SET revoked_at_unix = ?2 WHERE token_hash = ?1",
            params![hash_session_token(&token), now_unix_secs() as i64],
        )?;
        Ok(())
    }
}

pub(super) async fn passkey_registration_start(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(payload): Json<PasskeyRegistrationStartRequest>,
) -> Response {
    let auth = &state.account_auth;
    let current = match auth.session_from_headers(&headers) {
        Ok(current) => current,
        Err(error) => return auth_error(StatusCode::SERVICE_UNAVAILABLE, error),
    };

    let bootstrap_wallet = payload
        .wallet_session
        .as_deref()
        .and_then(|token| wallet_for_session(&state.wallet_sessions, token));
    let resolved = if let Some(current) = current.as_ref() {
        if now_unix_secs().saturating_sub(current.verified_at_unix) > ACCOUNT_STEP_UP_TTL.as_secs()
        {
            return auth_message(
                StatusCode::UNAUTHORIZED,
                "sign in again before adding a passkey",
            );
        }
        let user_id = match Uuid::parse_str(&current.user_id) {
            Ok(user_id) => user_id,
            Err(error) => return auth_error(StatusCode::INTERNAL_SERVER_ERROR, error),
        };
        Ok((
            user_id,
            current.username.clone(),
            current.display_name.clone(),
            false,
        ))
    } else {
        resolve_registration_identity(auth, &payload, bootstrap_wallet.as_deref())
    };
    let (user_id, username, display_name, new_user) = match resolved {
        Ok(value) => value,
        Err(error) => return auth_error(StatusCode::CONFLICT, error),
    };
    let passkeys = if new_user {
        Vec::new()
    } else {
        match load_passkeys(
            auth.path().unwrap_or_else(|_| Path::new("")),
            &user_id.to_string(),
        ) {
            Ok(passkeys) => passkeys,
            Err(error) => return auth_error(StatusCode::SERVICE_UNAVAILABLE, error),
        }
    };
    let excluded = (!passkeys.is_empty()).then(|| {
        passkeys
            .iter()
            .map(|stored| stored.passkey.cred_id().clone())
            .collect()
    });
    let (public_key, registration) =
        match auth
            .webauthn
            .start_passkey_registration(user_id, &username, &display_name, excluded)
        {
            Ok(value) => value,
            Err(error) => return auth_error(StatusCode::BAD_REQUEST, error),
        };
    let label = normalize_passkey_label(&payload.label)
        .unwrap_or_else(|| format!("Passkey {}", passkeys.len() + 1));
    let ceremony_id = match auth.store_ceremony(AccountCeremony::Registration {
        expires_at: Instant::now() + CEREMONY_TTL,
        user_id,
        username,
        display_name,
        label,
        bootstrap_wallet,
        new_user,
        state: registration,
    }) {
        Ok(id) => id,
        Err(error) => return auth_error(StatusCode::SERVICE_UNAVAILABLE, error),
    };
    no_store_json(
        StatusCode::OK,
        &CeremonyResponse {
            ok: true,
            ceremony_id,
            public_key: serde_json::to_value(public_key).unwrap_or(serde_json::Value::Null),
        },
        None,
    )
}

pub(super) async fn passkey_registration_finish(
    State(state): State<AppState>,
    Json(payload): Json<PasskeyRegistrationFinishRequest>,
) -> Response {
    let auth = &state.account_auth;
    let ceremony = match auth.take_ceremony(&payload.ceremony_id) {
        Ok(ceremony) => ceremony,
        Err(error) => return auth_error(StatusCode::GONE, error),
    };
    let AccountCeremony::Registration {
        user_id,
        username,
        display_name,
        label,
        bootstrap_wallet,
        new_user,
        state: registration,
        ..
    } = ceremony
    else {
        return auth_message(
            StatusCode::BAD_REQUEST,
            "authentication ceremony type mismatch",
        );
    };
    let credential: RegisterPublicKeyCredential = match serde_json::from_value(payload.credential) {
        Ok(credential) => credential,
        Err(error) => return auth_error(StatusCode::BAD_REQUEST, error),
    };
    let passkey = match auth
        .webauthn
        .finish_passkey_registration(&credential, &registration)
    {
        Ok(passkey) => passkey,
        Err(error) => return auth_error(StatusCode::UNAUTHORIZED, error),
    };
    let credential_id = URL_SAFE_NO_PAD.encode(passkey.cred_id().as_ref());
    if let Err(error) = persist_registered_passkey(
        auth.path().unwrap_or_else(|_| Path::new("")),
        RegisteredPasskey {
            user_id: &user_id.to_string(),
            username: &username,
            display_name: &display_name,
            credential_id: &credential_id,
            label: &label,
            passkey: &passkey,
            bootstrap_wallet: bootstrap_wallet.as_deref(),
            new_user,
        },
    ) {
        return auth_error(StatusCode::CONFLICT, error);
    }
    let (_, cookie) = match auth.issue_session(&user_id.to_string()) {
        Ok(session) => session,
        Err(error) => return auth_error(StatusCode::SERVICE_UNAVAILABLE, error),
    };
    identity_response(&state, &user_id.to_string(), Some(cookie), None)
}

pub(super) async fn passkey_login_start(
    State(state): State<AppState>,
    Json(payload): Json<PasskeyLoginStartRequest>,
) -> Response {
    let auth = &state.account_auth;
    let username = payload.username.trim().to_ascii_lowercase();
    if username.is_empty() {
        let (public_key, authentication) = match auth.webauthn.start_discoverable_authentication() {
            Ok(value) => value,
            Err(error) => return auth_error(StatusCode::BAD_REQUEST, error),
        };
        let ceremony_id = match auth.store_ceremony(AccountCeremony::DiscoverableAuthentication {
            expires_at: Instant::now() + CEREMONY_TTL,
            state: authentication,
        }) {
            Ok(id) => id,
            Err(error) => return auth_error(StatusCode::SERVICE_UNAVAILABLE, error),
        };
        return no_store_json(
            StatusCode::OK,
            &CeremonyResponse {
                ok: true,
                ceremony_id,
                public_key: serde_json::to_value(public_key).unwrap_or(serde_json::Value::Null),
            },
            None,
        );
    }
    let Some((user_id, _display_name)) =
        (match find_user_by_username(auth.path().unwrap_or_else(|_| Path::new("")), &username) {
            Ok(user) => user,
            Err(error) => return auth_error(StatusCode::SERVICE_UNAVAILABLE, error),
        })
    else {
        return auth_message(StatusCode::UNAUTHORIZED, "passkey sign-in was not accepted");
    };
    let passkeys = match load_passkeys(auth.path().unwrap_or_else(|_| Path::new("")), &user_id) {
        Ok(passkeys) if !passkeys.is_empty() => passkeys,
        Ok(_) => return auth_message(StatusCode::UNAUTHORIZED, "passkey sign-in was not accepted"),
        Err(error) => return auth_error(StatusCode::SERVICE_UNAVAILABLE, error),
    };
    let keys = passkeys
        .iter()
        .map(|stored| stored.passkey.clone())
        .collect::<Vec<_>>();
    let (public_key, authentication) = match auth.webauthn.start_passkey_authentication(&keys) {
        Ok(value) => value,
        Err(error) => return auth_error(StatusCode::BAD_REQUEST, error),
    };
    let user_uuid = match Uuid::parse_str(&user_id) {
        Ok(value) => value,
        Err(error) => return auth_error(StatusCode::INTERNAL_SERVER_ERROR, error),
    };
    let ceremony_id = match auth.store_ceremony(AccountCeremony::Authentication {
        expires_at: Instant::now() + CEREMONY_TTL,
        user_id: user_uuid,
        state: authentication,
    }) {
        Ok(id) => id,
        Err(error) => return auth_error(StatusCode::SERVICE_UNAVAILABLE, error),
    };
    no_store_json(
        StatusCode::OK,
        &CeremonyResponse {
            ok: true,
            ceremony_id,
            public_key: serde_json::to_value(public_key).unwrap_or(serde_json::Value::Null),
        },
        None,
    )
}

pub(super) async fn passkey_login_finish(
    State(state): State<AppState>,
    Json(payload): Json<PasskeyLoginFinishRequest>,
) -> Response {
    let auth = &state.account_auth;
    let ceremony = match auth.take_ceremony(&payload.ceremony_id) {
        Ok(ceremony) => ceremony,
        Err(error) => return auth_error(StatusCode::GONE, error),
    };
    let credential: PublicKeyCredential = match serde_json::from_value(payload.credential) {
        Ok(credential) => credential,
        Err(error) => return auth_error(StatusCode::BAD_REQUEST, error),
    };
    let (user_id, result) = match ceremony {
        AccountCeremony::Authentication {
            user_id,
            state: authentication,
            ..
        } => {
            let keys = match load_passkeys(
                auth.path().unwrap_or_else(|_| Path::new("")),
                &user_id.to_string(),
            ) {
                Ok(keys) => keys,
                Err(error) => return auth_error(StatusCode::SERVICE_UNAVAILABLE, error),
            };
            match auth
                .webauthn
                .finish_passkey_authentication(&credential, &authentication)
            {
                Ok(result) => (user_id, (result, keys)),
                Err(error) => return auth_error(StatusCode::UNAUTHORIZED, error),
            }
        }
        AccountCeremony::DiscoverableAuthentication {
            state: authentication,
            ..
        } => {
            let (user_id, credential_id) = match auth
                .webauthn
                .identify_discoverable_authentication(&credential)
            {
                Ok(value) => value,
                Err(error) => return auth_error(StatusCode::UNAUTHORIZED, error),
            };
            let keys = match load_passkeys(
                auth.path().unwrap_or_else(|_| Path::new("")),
                &user_id.to_string(),
            ) {
                Ok(keys) => keys,
                Err(error) => return auth_error(StatusCode::SERVICE_UNAVAILABLE, error),
            };
            let discoverable = keys
                .iter()
                .filter(|stored| stored.passkey.cred_id().as_ref() == credential_id)
                .map(|stored| DiscoverableKey::from(stored.passkey.clone()))
                .collect::<Vec<_>>();
            if discoverable.is_empty() {
                return auth_message(StatusCode::UNAUTHORIZED, "passkey sign-in was not accepted");
            }
            match auth.webauthn.finish_discoverable_authentication(
                &credential,
                authentication,
                &discoverable,
            ) {
                Ok(result) => (user_id, (result, keys)),
                Err(error) => return auth_error(StatusCode::UNAUTHORIZED, error),
            }
        }
        AccountCeremony::Registration { .. } => {
            return auth_message(
                StatusCode::BAD_REQUEST,
                "authentication ceremony type mismatch",
            );
        }
    };
    let (result, mut keys) = result;
    if !result.user_verified() {
        return auth_message(
            StatusCode::UNAUTHORIZED,
            "passkey user verification is required",
        );
    }
    let credential_id = URL_SAFE_NO_PAD.encode(result.cred_id().as_ref());
    if let Some(stored) = keys
        .iter_mut()
        .find(|stored| stored.credential_id == credential_id)
    {
        stored.passkey.update_credential(&result);
        if let Err(error) = persist_used_passkey(
            auth.path().unwrap_or_else(|_| Path::new("")),
            &stored.credential_id,
            &stored.passkey,
        ) {
            return auth_error(StatusCode::SERVICE_UNAVAILABLE, error);
        }
    } else {
        return auth_message(StatusCode::UNAUTHORIZED, "passkey sign-in was not accepted");
    }
    let (_, cookie) = match auth.issue_session(&user_id.to_string()) {
        Ok(session) => session,
        Err(error) => return auth_error(StatusCode::SERVICE_UNAVAILABLE, error),
    };
    identity_response(&state, &user_id.to_string(), Some(cookie), None)
}

pub(super) async fn account_identity(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Response {
    let current = match state.account_auth.session_from_headers(&headers) {
        Ok(current) => current,
        Err(error) => return auth_error(StatusCode::SERVICE_UNAVAILABLE, error),
    };
    match current {
        Some(current) => identity_response(&state, &current.user_id, None, None),
        None => no_store_json(StatusCode::OK, &IdentityResponse::signed_out(), None),
    }
}

pub(super) async fn account_logout(State(state): State<AppState>, headers: HeaderMap) -> Response {
    if let Err(error) = state.account_auth.revoke_header_session(&headers) {
        return auth_error(StatusCode::SERVICE_UNAVAILABLE, error);
    }
    no_store_json(
        StatusCode::OK,
        &IdentityResponse::signed_out(),
        Some(state.account_auth.clear_cookie()),
    )
}

pub(super) async fn wallet_link_start(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(payload): Json<WalletLinkStartRequest>,
) -> Response {
    let current = match require_recent_account(&state.account_auth, &headers) {
        Ok(current) => current,
        Err(error) => return auth_error(StatusCode::UNAUTHORIZED, error),
    };
    let Some(wallet_address) = normalize_wallet_address(&payload.wallet_address) else {
        return auth_message(StatusCode::BAD_REQUEST, "wallet address is invalid");
    };
    let nonce = random_hex(24);
    let message = format!(
        "CosyWorld wallet link\nOrigin: {}\nAccount: {}\nWallet: {}\nNonce: {}\nThis proves wallet ownership. It does not authorize a transaction.",
        state.account_auth.rp_origin, current.user_id, wallet_address, nonce
    );
    let expires_at_unix = now_unix_secs() + WALLET_LINK_TTL.as_secs();
    let challenge = WalletLinkChallenge {
        user_id: current.user_id,
        wallet_address: wallet_address.clone(),
        message: message.clone(),
        expires_at: Instant::now() + WALLET_LINK_TTL,
    };
    let Ok(mut challenges) = state.account_auth.wallet_link_challenges.lock() else {
        return auth_message(
            StatusCode::SERVICE_UNAVAILABLE,
            "wallet linking is unavailable",
        );
    };
    let now = Instant::now();
    challenges.retain(|_, challenge| challenge.expires_at > now);
    challenges.insert(nonce.clone(), challenge);
    no_store_json(
        StatusCode::OK,
        &WalletChallengeResponse {
            ok: true,
            wallet_address,
            nonce,
            message,
            expires_at_unix,
        },
        None,
    )
}

pub(super) async fn wallet_link_finish(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(payload): Json<WalletLinkFinishRequest>,
) -> Response {
    let current = match require_recent_account(&state.account_auth, &headers) {
        Ok(current) => current,
        Err(error) => return auth_error(StatusCode::UNAUTHORIZED, error),
    };
    let Some(wallet_address) = normalize_wallet_address(&payload.wallet_address) else {
        return auth_message(StatusCode::BAD_REQUEST, "wallet address is invalid");
    };
    let challenge = {
        let Ok(mut challenges) = state.account_auth.wallet_link_challenges.lock() else {
            return auth_message(
                StatusCode::SERVICE_UNAVAILABLE,
                "wallet linking is unavailable",
            );
        };
        challenges.retain(|_, challenge| challenge.expires_at > Instant::now());
        challenges.remove(payload.nonce.trim())
    };
    let Some(challenge) = challenge else {
        return auth_message(StatusCode::GONE, "wallet link challenge expired");
    };
    if challenge.user_id != current.user_id
        || challenge.wallet_address != wallet_address
        || !verify_solana_wallet_signature(&wallet_address, &challenge.message, &payload.signature)
    {
        return auth_message(StatusCode::UNAUTHORIZED, "wallet signature rejected");
    }
    if let Err(error) = link_account_wallet(
        state.account_auth.path().unwrap_or_else(|_| Path::new("")),
        &current.user_id,
        &wallet_address,
    ) {
        return auth_error(StatusCode::CONFLICT, error);
    }
    identity_response(&state, &current.user_id, None, Some(&wallet_address))
}

fn cleanup_wallet_claims(auth: &AccountAuth) {
    let now = Instant::now();
    if let Ok(mut claims) = auth.wallet_claims.lock() {
        claims.retain(|_, claim| {
            claim.expires_at > now
                || claim.completed_at.is_some_and(|completed_at| {
                    now.duration_since(completed_at) <= WALLET_CLAIM_COMPLETE_GRACE
                })
        });
    }
    if let Ok(mut challenges) = auth.wallet_claim_challenges.lock() {
        challenges.retain(|_, challenge| challenge.expires_at > now);
    }
}

fn wallet_claim_is_pending(auth: &AccountAuth, claim_id: &str) -> bool {
    let Some(claim_id) = clean_auth_token(claim_id, 32) else {
        return false;
    };
    cleanup_wallet_claims(auth);
    auth.wallet_claims
        .lock()
        .ok()
        .and_then(|claims| claims.get(&claim_id).cloned())
        .is_some_and(|claim| claim.expires_at > Instant::now() && claim.completed_at.is_none())
}

pub(super) async fn wallet_claim_start(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Response {
    let current = match require_recent_account(&state.account_auth, &headers) {
        Ok(current) => current,
        Err(error) => return auth_error(StatusCode::UNAUTHORIZED, error),
    };
    cleanup_wallet_claims(&state.account_auth);
    let claim_id = random_hex(16);
    let poll_token = random_hex(32);
    let expires_at_unix = now_unix_secs() + WALLET_CLAIM_TTL.as_secs();
    let claim = WalletClaimIntent {
        user_id: current.user_id,
        poll_token: poll_token.clone(),
        expires_at: Instant::now() + WALLET_CLAIM_TTL,
        expires_at_unix,
        wallet_address: None,
        moved: false,
        completed_at: None,
    };
    let Ok(mut claims) = state.account_auth.wallet_claims.lock() else {
        return auth_message(
            StatusCode::SERVICE_UNAVAILABLE,
            "wallet claims are unavailable",
        );
    };
    claims.insert(claim_id.clone(), claim);
    no_store_json(
        StatusCode::OK,
        &WalletClaimStartResponse {
            ok: true,
            claim_id: claim_id.clone(),
            poll_token,
            mobile_path: format!("/wallet/claim/{claim_id}"),
            qr_svg_path: format!("/wallet/claim/{claim_id}/code.svg"),
            expires_at_unix,
        },
        None,
    )
}

pub(super) async fn wallet_claim_status(
    State(state): State<AppState>,
    headers: HeaderMap,
    Query(query): Query<WalletClaimStatusQuery>,
) -> Response {
    let current = match state.account_auth.session_from_headers(&headers) {
        Ok(Some(current)) => current,
        Ok(None) => return auth_message(StatusCode::UNAUTHORIZED, "passkey sign-in required"),
        Err(error) => return auth_error(StatusCode::SERVICE_UNAVAILABLE, error),
    };
    let Some(claim_id) = clean_auth_token(&query.claim_id, 32) else {
        return no_store_json(
            StatusCode::BAD_REQUEST,
            &WalletClaimStatusResponse {
                ok: false,
                state: "invalid".to_string(),
                wallet_address: None,
                moved: false,
                expires_at_unix: None,
                error: Some("wallet claim id is invalid".to_string()),
            },
            None,
        );
    };
    let Some(poll_token) = clean_auth_token(&query.poll_token, 64) else {
        return no_store_json(
            StatusCode::BAD_REQUEST,
            &WalletClaimStatusResponse {
                ok: false,
                state: "invalid".to_string(),
                wallet_address: None,
                moved: false,
                expires_at_unix: None,
                error: Some("wallet claim poll token is invalid".to_string()),
            },
            None,
        );
    };
    cleanup_wallet_claims(&state.account_auth);
    let Ok(claims) = state.account_auth.wallet_claims.lock() else {
        return auth_message(
            StatusCode::SERVICE_UNAVAILABLE,
            "wallet claims are unavailable",
        );
    };
    let Some(claim) = claims.get(&claim_id) else {
        return no_store_json(
            StatusCode::GONE,
            &WalletClaimStatusResponse {
                ok: false,
                state: "expired".to_string(),
                wallet_address: None,
                moved: false,
                expires_at_unix: None,
                error: Some("wallet claim expired".to_string()),
            },
            None,
        );
    };
    if claim.user_id != current.user_id || claim.poll_token != poll_token {
        return no_store_json(
            StatusCode::FORBIDDEN,
            &WalletClaimStatusResponse {
                ok: false,
                state: "forbidden".to_string(),
                wallet_address: None,
                moved: false,
                expires_at_unix: Some(claim.expires_at_unix),
                error: Some("wallet claim poll token rejected".to_string()),
            },
            None,
        );
    }
    let complete = claim.completed_at.is_some();
    no_store_json(
        StatusCode::OK,
        &WalletClaimStatusResponse {
            ok: true,
            state: if complete { "complete" } else { "pending" }.to_string(),
            wallet_address: claim.wallet_address.clone(),
            moved: claim.moved,
            expires_at_unix: Some(claim.expires_at_unix),
            error: None,
        },
        None,
    )
}

pub(super) async fn wallet_claim_challenge(
    ConnectInfo(client_addr): ConnectInfo<SocketAddr>,
    State(state): State<AppState>,
    AxumPath(claim_id): AxumPath<String>,
    Json(payload): Json<WalletClaimChallengeRequest>,
) -> Response {
    if !state.allow_rate_limit(
        rate_limit_key("wallet-claim-ip", client_ip_key(client_addr)),
        WALLET_AUTH_LIMIT,
    ) {
        return no_store_json(
            StatusCode::TOO_MANY_REQUESTS,
            &WalletClaimChallengeResponse {
                ok: false,
                wallet_address: String::new(),
                nonce: String::new(),
                message: String::new(),
                claimed_elsewhere: false,
                expires_at_unix: 0,
                error: Some("wallet claim rate limited".to_string()),
            },
            None,
        );
    }
    let Some(claim_id) = clean_auth_token(&claim_id, 32) else {
        return no_store_json(
            StatusCode::BAD_REQUEST,
            &WalletClaimChallengeResponse {
                ok: false,
                wallet_address: String::new(),
                nonce: String::new(),
                message: String::new(),
                claimed_elsewhere: false,
                expires_at_unix: 0,
                error: Some("wallet claim is invalid".to_string()),
            },
            None,
        );
    };
    let Some(wallet_address) = normalize_wallet_address(&payload.wallet_address) else {
        return no_store_json(
            StatusCode::BAD_REQUEST,
            &WalletClaimChallengeResponse {
                ok: false,
                wallet_address: String::new(),
                nonce: String::new(),
                message: String::new(),
                claimed_elsewhere: false,
                expires_at_unix: 0,
                error: Some("wallet address is invalid".to_string()),
            },
            None,
        );
    };
    cleanup_wallet_claims(&state.account_auth);
    let claim = state
        .account_auth
        .wallet_claims
        .lock()
        .ok()
        .and_then(|claims| claims.get(&claim_id).cloned());
    let Some(claim) =
        claim.filter(|claim| claim.expires_at > Instant::now() && claim.completed_at.is_none())
    else {
        return no_store_json(
            StatusCode::GONE,
            &WalletClaimChallengeResponse {
                ok: false,
                wallet_address: String::new(),
                nonce: String::new(),
                message: String::new(),
                claimed_elsewhere: false,
                expires_at_unix: 0,
                error: Some("wallet claim expired".to_string()),
            },
            None,
        );
    };
    let claimed_elsewhere = match wallet_owner_user_id(
        state.account_auth.path().unwrap_or_else(|_| Path::new("")),
        &wallet_address,
    ) {
        Ok(Some(owner)) => owner != claim.user_id,
        Ok(None) => false,
        Err(error) => return auth_error(StatusCode::SERVICE_UNAVAILABLE, error),
    };
    let nonce = random_hex(24);
    let expires_at_unix = now_unix_secs() + WALLET_LINK_TTL.as_secs();
    let action = if claimed_elsewhere {
        "Move this wallet's NFT claim to the waiting CosyWorld account."
    } else {
        "Claim this wallet's NFTs for the waiting CosyWorld account."
    };
    let message = format!(
        "CosyWorld NFT wallet claim\nOrigin: {}\nClaim: {}\nWallet: {}\nNonce: {}\n{}\nThis proves wallet ownership. It does not authorize a transaction.",
        state.account_auth.rp_origin, claim_id, wallet_address, nonce, action
    );
    let challenge = WalletClaimChallenge {
        claim_id,
        user_id: claim.user_id,
        wallet_address: wallet_address.clone(),
        message: message.clone(),
        claimed_elsewhere,
        expires_at: Instant::now() + WALLET_LINK_TTL,
    };
    let Ok(mut challenges) = state.account_auth.wallet_claim_challenges.lock() else {
        return auth_message(
            StatusCode::SERVICE_UNAVAILABLE,
            "wallet claim signing is unavailable",
        );
    };
    challenges.insert(nonce.clone(), challenge);
    no_store_json(
        StatusCode::OK,
        &WalletClaimChallengeResponse {
            ok: true,
            wallet_address,
            nonce,
            message,
            claimed_elsewhere,
            expires_at_unix,
            error: None,
        },
        None,
    )
}

pub(super) async fn wallet_claim_finish(
    ConnectInfo(client_addr): ConnectInfo<SocketAddr>,
    State(state): State<AppState>,
    AxumPath(claim_id): AxumPath<String>,
    Json(payload): Json<WalletClaimFinishRequest>,
) -> Response {
    if !state.allow_rate_limit(
        rate_limit_key("wallet-claim-ip", client_ip_key(client_addr)),
        WALLET_AUTH_LIMIT,
    ) {
        return no_store_json(
            StatusCode::TOO_MANY_REQUESTS,
            &WalletClaimFinishResponse {
                ok: false,
                state: "rate_limited".to_string(),
                wallet_address: None,
                moved: false,
                error: Some("wallet claim rate limited".to_string()),
            },
            None,
        );
    }
    let Some(claim_id) = clean_auth_token(&claim_id, 32) else {
        return no_store_json(
            StatusCode::BAD_REQUEST,
            &WalletClaimFinishResponse {
                ok: false,
                state: "invalid".to_string(),
                wallet_address: None,
                moved: false,
                error: Some("wallet claim is invalid".to_string()),
            },
            None,
        );
    };
    let Some(wallet_address) = normalize_wallet_address(&payload.wallet_address) else {
        return no_store_json(
            StatusCode::BAD_REQUEST,
            &WalletClaimFinishResponse {
                ok: false,
                state: "invalid".to_string(),
                wallet_address: None,
                moved: false,
                error: Some("wallet address is invalid".to_string()),
            },
            None,
        );
    };
    cleanup_wallet_claims(&state.account_auth);
    let challenge = state
        .account_auth
        .wallet_claim_challenges
        .lock()
        .ok()
        .and_then(|mut challenges| challenges.remove(payload.nonce.trim()));
    let Some(challenge) = challenge else {
        return no_store_json(
            StatusCode::GONE,
            &WalletClaimFinishResponse {
                ok: false,
                state: "expired".to_string(),
                wallet_address: None,
                moved: false,
                error: Some("wallet claim signature expired".to_string()),
            },
            None,
        );
    };
    if challenge.claim_id != claim_id
        || challenge.wallet_address != wallet_address
        || !verify_solana_wallet_signature(&wallet_address, &challenge.message, &payload.signature)
    {
        return no_store_json(
            StatusCode::UNAUTHORIZED,
            &WalletClaimFinishResponse {
                ok: false,
                state: "rejected".to_string(),
                wallet_address: None,
                moved: false,
                error: Some("wallet signature rejected".to_string()),
            },
            None,
        );
    }
    let valid_intent = state
        .account_auth
        .wallet_claims
        .lock()
        .ok()
        .and_then(|claims| claims.get(&claim_id).cloned())
        .is_some_and(|claim| {
            claim.user_id == challenge.user_id
                && claim.expires_at > Instant::now()
                && claim.completed_at.is_none()
        });
    if !valid_intent {
        return no_store_json(
            StatusCode::GONE,
            &WalletClaimFinishResponse {
                ok: false,
                state: "expired".to_string(),
                wallet_address: None,
                moved: false,
                error: Some("wallet claim expired".to_string()),
            },
            None,
        );
    }
    let moved = match claim_account_wallet(
        state.account_auth.path().unwrap_or_else(|_| Path::new("")),
        &challenge.user_id,
        &wallet_address,
        challenge.claimed_elsewhere,
    ) {
        Ok(moved) => moved,
        Err(AccountError::Message(error)) => {
            return no_store_json(
                StatusCode::CONFLICT,
                &WalletClaimFinishResponse {
                    ok: false,
                    state: "confirmation_required".to_string(),
                    wallet_address: None,
                    moved: false,
                    error: Some(error),
                },
                None,
            )
        }
        Err(error) => return auth_error(StatusCode::SERVICE_UNAVAILABLE, error),
    };
    let Ok(mut claims) = state.account_auth.wallet_claims.lock() else {
        return auth_message(
            StatusCode::SERVICE_UNAVAILABLE,
            "wallet claims are unavailable",
        );
    };
    let Some(claim) = claims.get_mut(&claim_id) else {
        return auth_message(StatusCode::GONE, "wallet claim expired");
    };
    claim.wallet_address = Some(wallet_address.clone());
    claim.moved = moved || challenge.claimed_elsewhere;
    claim.completed_at = Some(Instant::now());
    no_store_json(
        StatusCode::OK,
        &WalletClaimFinishResponse {
            ok: true,
            state: "complete".to_string(),
            wallet_address: Some(wallet_address),
            moved: claim.moved,
            error: None,
        },
        None,
    )
}

pub(super) async fn wallet_claim_code(
    headers: HeaderMap,
    State(state): State<AppState>,
    AxumPath(claim_id): AxumPath<String>,
) -> impl IntoResponse {
    let Some(claim_id) = clean_auth_token(&claim_id, 32) else {
        return (StatusCode::BAD_REQUEST, "invalid wallet claim").into_response();
    };
    if !wallet_claim_is_pending(&state.account_auth, &claim_id) {
        return (StatusCode::NOT_FOUND, "wallet claim expired").into_response();
    }
    let mobile_url = format!("{}/wallet/claim/{claim_id}", request_origin(&headers));
    let Ok(code) = QrCode::new(mobile_url.as_bytes()) else {
        return (StatusCode::INTERNAL_SERVER_ERROR, "QR generation failed").into_response();
    };
    let image = code
        .render::<svg::Color<'_>>()
        .min_dimensions(320, 320)
        .dark_color(svg::Color("#0d140f"))
        .light_color(svg::Color("#f5f8ef"))
        .build();
    (
        StatusCode::OK,
        [(header::CONTENT_TYPE, "image/svg+xml; charset=utf-8")],
        image,
    )
        .into_response()
}

pub(super) async fn wallet_claim_page(
    State(state): State<AppState>,
    AxumPath(claim_id): AxumPath<String>,
) -> impl IntoResponse {
    let Some(claim_id) = clean_auth_token(&claim_id, 32) else {
        return (
            StatusCode::BAD_REQUEST,
            no_store_headers(),
            Html("invalid wallet claim".to_string()),
        )
            .into_response();
    };
    if !wallet_claim_is_pending(&state.account_auth, &claim_id) {
        return (
            StatusCode::NOT_FOUND,
            no_store_headers(),
            Html("wallet claim expired".to_string()),
        )
            .into_response();
    }
    let claim_json = serde_json::to_string(&claim_id).unwrap_or_else(|_| "\"\"".to_string());
    let page = format!(
        r##"<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, viewport-fit=cover" />
  <meta name="theme-color" content="#080b09" />
  <title>Claim NFT wallet · CosyWorld</title>
  <style>
    * {{ box-sizing: border-box; }}
    html, body {{ margin: 0; min-height: 100%; background: #080b09; color: #d8f7dc; font: 16px/1.5 ui-monospace, SFMono-Regular, Menlo, monospace; }}
    body {{ display: grid; place-items: center; padding: 18px; }}
    main {{ width: min(440px, 100%); border: 1px solid rgba(239,201,107,.36); background: #0d140f; padding: 20px; box-shadow: 0 20px 70px rgba(0,0,0,.55); }}
    h1 {{ margin: 0 0 8px; color: #efc96b; font-size: 20px; }}
    p {{ margin: 0 0 14px; color: #85a58a; }}
    button {{ width: 100%; min-height: 54px; border: 1px solid rgba(239,201,107,.55); background: rgba(101,230,138,.12); color: #65e68a; font: inherit; font-weight: 900; border-radius: 5px; }}
    button[disabled] {{ opacity: .55; }}
    .wallet-links {{ display: grid; gap: 8px; margin-top: 12px; }}
    .wallet-links a {{ display: grid; place-items: center; min-height: 46px; border: 1px solid rgba(139,183,255,.38); color: #8bb7ff; text-decoration: none; border-radius: 5px; font-weight: 850; }}
    .status {{ min-height: 24px; margin-top: 14px; color: #8bb7ff; overflow-wrap: anywhere; }}
    .error {{ color: #ff8d8d; }}
  </style>
</head>
<body>
  <main>
    <h1>claim NFT wallet</h1>
    <p id="copy">Sign one message to let your passkey account use this wallet's NFTs. No transaction, no fee.</p>
    <button id="claim">claim this wallet</button>
    <div class="wallet-links" id="wallet-links" hidden>
      <a id="phantom-link" href="#" rel="noreferrer">open in Phantom</a>
      <a id="solflare-link" href="#" rel="noreferrer">open in Solflare</a>
    </div>
    <div class="status" id="status"></div>
  </main>
  <script>
    const claimId = {claim_json};
    const button = document.getElementById("claim");
    const copy = document.getElementById("copy");
    const statusNode = document.getElementById("status");
    const walletLinks = document.getElementById("wallet-links");
    let prepared = null;
    let wallet = null;
    function provider() {{ return window.solana || window.phantom?.solana || window.solflare?.solana || window.solflare || null; }}
    function status(text, error = false) {{
      statusNode.textContent = text;
      statusNode.classList.toggle("error", error);
    }}
    function configureWalletLinks() {{
      const pageUrl = window.location.href;
      const ref = window.location.origin;
      document.getElementById("phantom-link").href = `https://phantom.app/ul/browse/${{encodeURIComponent(pageUrl)}}?ref=${{encodeURIComponent(ref)}}`;
      document.getElementById("solflare-link").href = `https://solflare.com/ul/v1/browse/${{encodeURIComponent(pageUrl)}}?ref=${{encodeURIComponent(ref)}}`;
      walletLinks.hidden = false;
    }}
    function walletErrorMessage(error) {{
      const message = String(error?.message || error || "").trim();
      if (/reject|denied|cancel/i.test(message)) return "Wallet request cancelled.";
      return message || "Wallet claim failed.";
    }}
    async function api(path, options = {{}}) {{
      const response = await fetch(path, options);
      return response.json();
    }}
    configureWalletLinks();
    button.addEventListener("click", async () => {{
      wallet = wallet || provider();
      if (!wallet?.connect || !wallet?.signMessage) {{
        status("Open this page in Phantom or Solflare, then tap claim this wallet.", true);
        return;
      }}
      button.disabled = true;
      try {{
        if (!prepared) {{
          status("Connect the wallet.");
          const connected = await wallet.connect();
          const publicKey = connected?.publicKey || wallet.publicKey;
          const walletAddress = publicKey?.toString?.() || "";
          if (!walletAddress) throw new Error("Wallet did not return an address.");
          prepared = await api(`/wallet/claim/${{claimId}}/challenge`, {{
            method: "POST",
            headers: {{ "content-type": "application/json" }},
            body: JSON.stringify({{ wallet_address: walletAddress }}),
          }});
          if (!prepared.ok) throw new Error(prepared.error || "Wallet claim could not start.");
          if (prepared.claimed_elsewhere) {{
            copy.textContent = "This wallet is claimed by another CosyWorld account. A fresh signature will move its NFT access here; it cannot belong to both accounts.";
            button.textContent = "move wallet claim here";
            status("Review the move, then confirm once more.");
            button.disabled = false;
            return;
          }}
        }}
        status("Sign the NFT wallet claim message.");
        const signed = await wallet.signMessage(new TextEncoder().encode(prepared.message), "utf8");
        const finished = await api(`/wallet/claim/${{claimId}}/finish`, {{
          method: "POST",
          headers: {{ "content-type": "application/json" }},
          body: JSON.stringify({{
            wallet_address: prepared.wallet_address,
            nonce: prepared.nonce,
            signature: Array.from(signed?.signature || signed || []),
          }}),
        }});
        if (!finished.ok) throw new Error(finished.error || "Wallet signature rejected.");
        copy.textContent = finished.moved
          ? "This wallet's NFT claim now belongs to your waiting passkey account."
          : "This wallet's NFTs are now available to your waiting passkey account.";
        button.textContent = "wallet claimed";
        status("Done. Return to the original CosyWorld browser.");
      }} catch (error) {{
        status(walletErrorMessage(error), true);
        prepared = null;
        button.textContent = "claim this wallet";
        button.disabled = false;
      }}
    }});
  </script>
</body>
</html>"##
    );
    (StatusCode::OK, no_store_headers(), Html(page)).into_response()
}

pub(super) async fn wallet_select(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(payload): Json<WalletSelectionRequest>,
) -> Response {
    let current = match state.account_auth.session_from_headers(&headers) {
        Ok(Some(current)) => current,
        Ok(None) => return auth_message(StatusCode::UNAUTHORIZED, "passkey sign-in required"),
        Err(error) => return auth_error(StatusCode::SERVICE_UNAVAILABLE, error),
    };
    let Some(wallet_address) = normalize_wallet_address(&payload.wallet_address) else {
        return auth_message(StatusCode::BAD_REQUEST, "wallet address is invalid");
    };
    match wallet_belongs_to_user(
        state.account_auth.path().unwrap_or_else(|_| Path::new("")),
        &current.user_id,
        &wallet_address,
    ) {
        Ok(true) => identity_response(&state, &current.user_id, None, Some(&wallet_address)),
        Ok(false) => auth_message(
            StatusCode::FORBIDDEN,
            "wallet is not linked to this account",
        ),
        Err(error) => auth_error(StatusCode::SERVICE_UNAVAILABLE, error),
    }
}

pub(super) async fn wallet_unlink(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(payload): Json<WalletSelectionRequest>,
) -> Response {
    let current = match require_recent_account(&state.account_auth, &headers) {
        Ok(current) => current,
        Err(error) => return auth_error(StatusCode::UNAUTHORIZED, error),
    };
    let Some(wallet_address) = normalize_wallet_address(&payload.wallet_address) else {
        return auth_message(StatusCode::BAD_REQUEST, "wallet address is invalid");
    };
    let conn = match open_event_store(state.account_auth.path().unwrap_or_else(|_| Path::new(""))) {
        Ok(conn) => conn,
        Err(error) => return auth_error(StatusCode::SERVICE_UNAVAILABLE, error),
    };
    match conn.execute(
        "DELETE FROM user_wallets WHERE user_id = ?1 AND wallet_address = ?2",
        params![current.user_id, wallet_address],
    ) {
        Ok(0) => auth_message(StatusCode::NOT_FOUND, "wallet link was not found"),
        Ok(_) => identity_response(&state, &current.user_id, None, None),
        Err(error) => auth_error(StatusCode::SERVICE_UNAVAILABLE, error),
    }
}

fn resolve_registration_identity(
    auth: &AccountAuth,
    payload: &PasskeyRegistrationStartRequest,
    bootstrap_wallet: Option<&str>,
) -> AccountResult<(Uuid, String, String, bool)> {
    if let Some(wallet) = bootstrap_wallet {
        if let Some((user_id, username, display_name, passkey_count)) =
            find_user_by_wallet(auth.path()?, wallet)?
        {
            if passkey_count > 0 {
                return Err(account_error(
                    "this account already has a passkey; sign in before adding another",
                ));
            }
            return Ok((
                Uuid::parse_str(&user_id)
                    .map_err(|_| account_error("account identity is invalid"))?,
                username,
                display_name,
                false,
            ));
        }
    }
    let user_id = Uuid::new_v4();
    let generated = payload.username.trim().is_empty();
    let username = if generated {
        generated_account_username(user_id)
    } else {
        normalize_account_username(&payload.username).ok_or_else(|| {
            account_error("username must be 3-32 letters, numbers, dots, dashes, or underscores")
        })?
    };
    let display_name = if generated {
        "CosyWorld player".to_string()
    } else {
        normalize_display_name(&payload.display_name).unwrap_or_else(|| username.clone())
    };
    if find_user_by_username(auth.path()?, &username)?.is_some() {
        return Err(account_error("username is already in use"));
    }
    Ok((user_id, username, display_name, true))
}

fn identity_response(
    state: &AppState,
    user_id: &str,
    cookie: Option<String>,
    preferred_wallet: Option<&str>,
) -> Response {
    let auth = &state.account_auth;
    let (username, display_name) =
        match find_user_by_id(auth.path().unwrap_or_else(|_| Path::new("")), user_id) {
            Ok(Some(user)) => user,
            Ok(None) => return auth_message(StatusCode::UNAUTHORIZED, "account is unavailable"),
            Err(error) => return auth_error(StatusCode::SERVICE_UNAVAILABLE, error),
        };
    let passkeys = match load_passkey_views(auth.path().unwrap_or_else(|_| Path::new("")), user_id)
    {
        Ok(passkeys) => passkeys,
        Err(error) => return auth_error(StatusCode::SERVICE_UNAVAILABLE, error),
    };
    let wallets = match load_wallet_views(auth.path().unwrap_or_else(|_| Path::new("")), user_id) {
        Ok(wallets) => wallets,
        Err(error) => return auth_error(StatusCode::SERVICE_UNAVAILABLE, error),
    };
    let active_wallet = preferred_wallet
        .filter(|wallet| wallets.iter().any(|entry| entry.wallet_address == *wallet))
        .map(ToString::to_string)
        .or_else(|| wallets.first().map(|wallet| wallet.wallet_address.clone()));
    let wallet_session = active_wallet
        .as_deref()
        .map(|wallet| mint_account_wallet_capability(state, wallet, &wallets));
    no_store_json(
        StatusCode::OK,
        &IdentityResponse {
            ok: true,
            authenticated: true,
            user_id: Some(user_id.to_string()),
            username: Some(username),
            display_name: Some(display_name),
            passkeys,
            wallets,
            active_wallet,
            wallet_session,
            step_up_required: false,
            error: None,
        },
        cookie,
    )
}

fn mint_account_wallet_capability(
    state: &AppState,
    wallet_address: &str,
    wallets: &[WalletView],
) -> String {
    let token = random_hex(32);
    let now = Instant::now();
    if let Ok(mut sessions) = state.wallet_sessions.lock() {
        sessions
            .sessions
            .retain(|_, session| session.expires_at > now);
        sessions.sessions.insert(
            token.clone(),
            WalletSession {
                wallet_address: wallet_address.to_string(),
                linked_wallet_addresses: wallets
                    .iter()
                    .map(|wallet| wallet.wallet_address.clone())
                    .collect(),
                expires_at: now + ACCOUNT_WALLET_CAPABILITY_TTL,
            },
        );
    }
    token
}

fn require_recent_account(
    auth: &AccountAuth,
    headers: &HeaderMap,
) -> AccountResult<AccountSessionRecord> {
    let session = auth
        .session_from_headers(headers)?
        .ok_or_else(|| account_error("passkey sign-in required"))?;
    if now_unix_secs().saturating_sub(session.verified_at_unix) > ACCOUNT_STEP_UP_TTL.as_secs() {
        return Err(account_error("sign in again before changing wallet links"));
    }
    Ok(session)
}

fn init_account_schema(path: &Path) -> AccountResult<()> {
    let conn = open_event_store(path)?;
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS auth_users (
            id TEXT PRIMARY KEY,
            username TEXT NOT NULL UNIQUE,
            display_name TEXT NOT NULL,
            status TEXT NOT NULL DEFAULT 'active',
            created_at_unix INTEGER NOT NULL,
            updated_at_unix INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS auth_passkeys (
            credential_id TEXT PRIMARY KEY,
            user_id TEXT NOT NULL REFERENCES auth_users(id) ON DELETE CASCADE,
            label TEXT NOT NULL,
            passkey_json TEXT NOT NULL,
            created_at_unix INTEGER NOT NULL,
            last_used_at_unix INTEGER
        );
        CREATE INDEX IF NOT EXISTS idx_auth_passkeys_user ON auth_passkeys(user_id);
        CREATE TABLE IF NOT EXISTS auth_sessions (
            token_hash TEXT PRIMARY KEY,
            user_id TEXT NOT NULL REFERENCES auth_users(id) ON DELETE CASCADE,
            created_at_unix INTEGER NOT NULL,
            verified_at_unix INTEGER NOT NULL,
            last_seen_at_unix INTEGER NOT NULL,
            expires_at_unix INTEGER NOT NULL,
            revoked_at_unix INTEGER
        );
        CREATE INDEX IF NOT EXISTS idx_auth_sessions_user ON auth_sessions(user_id, expires_at_unix);
        CREATE TABLE IF NOT EXISTS user_wallets (
            user_id TEXT NOT NULL REFERENCES auth_users(id) ON DELETE CASCADE,
            wallet_address TEXT NOT NULL UNIQUE,
            role TEXT NOT NULL DEFAULT 'ownership',
            verified_at_unix INTEGER NOT NULL,
            created_at_unix INTEGER NOT NULL,
            PRIMARY KEY (user_id, wallet_address)
        );
        CREATE INDEX IF NOT EXISTS idx_user_wallets_user ON user_wallets(user_id, created_at_unix);",
    )?;
    Ok(())
}

fn persist_registered_passkey(
    path: &Path,
    registration: RegisteredPasskey<'_>,
) -> AccountResult<()> {
    let mut conn = open_event_store(path)?;
    let transaction = conn.transaction()?;
    let now = now_unix_secs() as i64;
    if registration.new_user {
        transaction.execute(
            "INSERT INTO auth_users (id, username, display_name, status, created_at_unix, updated_at_unix)
             VALUES (?1, ?2, ?3, 'active', ?4, ?4)",
            params![
                registration.user_id,
                registration.username,
                registration.display_name,
                now
            ],
        )?;
    } else if transaction
        .query_row(
            "SELECT 1 FROM auth_users WHERE id = ?1 AND status = 'active'",
            params![registration.user_id],
            |_| Ok(()),
        )
        .optional()?
        .is_none()
    {
        return Err(account_error("account is unavailable"));
    }
    if let Some(wallet) = registration.bootstrap_wallet {
        let existing_user = transaction
            .query_row(
                "SELECT user_id FROM user_wallets WHERE wallet_address = ?1",
                params![wallet],
                |row| row.get::<_, String>(0),
            )
            .optional()?;
        if existing_user
            .as_deref()
            .is_some_and(|existing| existing != registration.user_id)
        {
            return Err(account_error("wallet is already linked to another account"));
        }
        transaction.execute(
            "INSERT OR IGNORE INTO user_wallets
             (user_id, wallet_address, role, verified_at_unix, created_at_unix)
             VALUES (?1, ?2, 'ownership', ?3, ?3)",
            params![registration.user_id, wallet, now],
        )?;
    }
    let passkey_json = serde_json::to_string(registration.passkey)
        .map_err(|error| account_error(format!("failed to serialize passkey: {error}")))?;
    transaction.execute(
        "INSERT INTO auth_passkeys
         (credential_id, user_id, label, passkey_json, created_at_unix, last_used_at_unix)
         VALUES (?1, ?2, ?3, ?4, ?5, NULL)",
        params![
            registration.credential_id,
            registration.user_id,
            registration.label,
            passkey_json,
            now
        ],
    )?;
    transaction.commit()?;
    Ok(())
}

fn persist_used_passkey(path: &Path, credential_id: &str, passkey: &Passkey) -> AccountResult<()> {
    let passkey_json = serde_json::to_string(passkey)
        .map_err(|error| account_error(format!("failed to serialize passkey: {error}")))?;
    let conn = open_event_store(path)?;
    conn.execute(
        "UPDATE auth_passkeys
         SET passkey_json = ?2, last_used_at_unix = ?3
         WHERE credential_id = ?1",
        params![credential_id, passkey_json, now_unix_secs() as i64],
    )?;
    Ok(())
}

fn load_passkeys(path: &Path, user_id: &str) -> AccountResult<Vec<StoredPasskey>> {
    let conn = open_event_store(path)?;
    let mut statement = conn.prepare(
        "SELECT credential_id, passkey_json FROM auth_passkeys
         WHERE user_id = ?1 ORDER BY created_at_unix",
    )?;
    let rows = statement.query_map(params![user_id], |row| {
        Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
    })?;
    let mut passkeys = Vec::new();
    for row in rows {
        let (credential_id, passkey_json) = row?;
        let passkey = serde_json::from_str(&passkey_json).map_err(|error| {
            io::Error::other(format!(
                "stored passkey {credential_id} is invalid: {error}"
            ))
        })?;
        passkeys.push(StoredPasskey {
            credential_id,
            passkey,
        });
    }
    Ok(passkeys)
}

fn load_passkey_views(path: &Path, user_id: &str) -> AccountResult<Vec<PasskeyView>> {
    let conn = open_event_store(path)?;
    let mut statement = conn.prepare(
        "SELECT credential_id, label, created_at_unix, last_used_at_unix
         FROM auth_passkeys WHERE user_id = ?1 ORDER BY created_at_unix",
    )?;
    let rows = statement.query_map(params![user_id], |row| {
        let credential_id: String = row.get(0)?;
        Ok(PasskeyView {
            credential_id: compact_credential_id(&credential_id),
            label: row.get(1)?,
            created_at_unix: row.get::<_, i64>(2)?.max(0) as u64,
            last_used_at_unix: row
                .get::<_, Option<i64>>(3)?
                .map(|value| value.max(0) as u64),
        })
    })?;
    rows.collect::<Result<Vec<_>, _>>().map_err(Into::into)
}

fn load_wallet_views(path: &Path, user_id: &str) -> AccountResult<Vec<WalletView>> {
    let conn = open_event_store(path)?;
    let mut statement = conn.prepare(
        "SELECT wallet_address, role, verified_at_unix FROM user_wallets
         WHERE user_id = ?1 ORDER BY created_at_unix, wallet_address",
    )?;
    let rows = statement.query_map(params![user_id], |row| {
        Ok(WalletView {
            wallet_address: row.get(0)?,
            role: row.get(1)?,
            verified_at_unix: row.get::<_, i64>(2)?.max(0) as u64,
        })
    })?;
    rows.collect::<Result<Vec<_>, _>>().map_err(Into::into)
}

fn find_user_by_username(path: &Path, username: &str) -> AccountResult<Option<(String, String)>> {
    let conn = open_event_store(path)?;
    conn.query_row(
        "SELECT id, display_name FROM auth_users WHERE username = ?1 AND status = 'active'",
        params![username],
        |row| Ok((row.get(0)?, row.get(1)?)),
    )
    .optional()
    .map_err(Into::into)
}

fn find_user_by_id(path: &Path, user_id: &str) -> AccountResult<Option<(String, String)>> {
    let conn = open_event_store(path)?;
    conn.query_row(
        "SELECT username, display_name FROM auth_users WHERE id = ?1 AND status = 'active'",
        params![user_id],
        |row| Ok((row.get(0)?, row.get(1)?)),
    )
    .optional()
    .map_err(Into::into)
}

fn find_user_by_wallet(
    path: &Path,
    wallet_address: &str,
) -> AccountResult<Option<(String, String, String, usize)>> {
    let conn = open_event_store(path)?;
    conn.query_row(
        "SELECT users.id, users.username, users.display_name,
                (SELECT COUNT(*) FROM auth_passkeys WHERE user_id = users.id)
         FROM user_wallets
         JOIN auth_users AS users ON users.id = user_wallets.user_id
         WHERE user_wallets.wallet_address = ?1 AND users.status = 'active'",
        params![wallet_address],
        |row| {
            Ok((
                row.get(0)?,
                row.get(1)?,
                row.get(2)?,
                row.get::<_, i64>(3)?.max(0) as usize,
            ))
        },
    )
    .optional()
    .map_err(Into::into)
}

fn link_account_wallet(path: &Path, user_id: &str, wallet_address: &str) -> AccountResult<()> {
    let conn = open_event_store(path)?;
    let existing = conn
        .query_row(
            "SELECT user_id FROM user_wallets WHERE wallet_address = ?1",
            params![wallet_address],
            |row| row.get::<_, String>(0),
        )
        .optional()?;
    if existing
        .as_deref()
        .is_some_and(|existing| existing != user_id)
    {
        return Err(account_error("wallet is already linked to another account"));
    }
    let now = now_unix_secs() as i64;
    conn.execute(
        "INSERT OR IGNORE INTO user_wallets
         (user_id, wallet_address, role, verified_at_unix, created_at_unix)
         VALUES (?1, ?2, 'ownership', ?3, ?3)",
        params![user_id, wallet_address, now],
    )?;
    Ok(())
}

fn wallet_owner_user_id(path: &Path, wallet_address: &str) -> AccountResult<Option<String>> {
    let conn = open_event_store(path)?;
    conn.query_row(
        "SELECT user_id FROM user_wallets WHERE wallet_address = ?1",
        params![wallet_address],
        |row| row.get::<_, String>(0),
    )
    .optional()
    .map_err(Into::into)
}

fn claim_account_wallet(
    path: &Path,
    user_id: &str,
    wallet_address: &str,
    allow_move: bool,
) -> AccountResult<bool> {
    let mut conn = open_event_store(path)?;
    let transaction = conn.transaction()?;
    let existing = transaction
        .query_row(
            "SELECT user_id FROM user_wallets WHERE wallet_address = ?1",
            params![wallet_address],
            |row| row.get::<_, String>(0),
        )
        .optional()?;
    let moved = existing
        .as_deref()
        .is_some_and(|existing_user_id| existing_user_id != user_id);
    if moved && !allow_move {
        return Err(account_error(
            "This wallet was claimed by another account. Review and sign a fresh move request.",
        ));
    }
    if moved {
        transaction.execute(
            "DELETE FROM user_wallets WHERE wallet_address = ?1",
            params![wallet_address],
        )?;
    }
    let now = now_unix_secs() as i64;
    transaction.execute(
        "INSERT INTO user_wallets
         (user_id, wallet_address, role, verified_at_unix, created_at_unix)
         VALUES (?1, ?2, 'ownership', ?3, ?3)
         ON CONFLICT(wallet_address) DO UPDATE SET
           user_id = excluded.user_id,
           role = 'ownership',
           verified_at_unix = excluded.verified_at_unix",
        params![user_id, wallet_address, now],
    )?;
    transaction.commit()?;
    Ok(moved)
}

fn wallet_belongs_to_user(path: &Path, user_id: &str, wallet_address: &str) -> AccountResult<bool> {
    let conn = open_event_store(path)?;
    Ok(conn
        .query_row(
            "SELECT 1 FROM user_wallets WHERE user_id = ?1 AND wallet_address = ?2",
            params![user_id, wallet_address],
            |_| Ok(()),
        )
        .optional()?
        .is_some())
}

fn normalize_account_username(value: &str) -> Option<String> {
    let username = value.trim().to_ascii_lowercase();
    (username.len() >= 3
        && username.len() <= 32
        && username.chars().all(|character| {
            character.is_ascii_alphanumeric() || matches!(character, '.' | '-' | '_')
        }))
    .then_some(username)
}

fn generated_account_username(user_id: Uuid) -> String {
    let compact = user_id.simple().to_string();
    format!("player-{}", &compact[..20])
}

fn normalize_display_name(value: &str) -> Option<String> {
    let display_name = compact_whitespace(value);
    (!display_name.is_empty()
        && display_name.chars().count() <= 64
        && !has_disallowed_control_character(&display_name)
        && human_message_is_cozy_safe(&display_name))
    .then_some(display_name)
}

fn normalize_passkey_label(value: &str) -> Option<String> {
    let label = compact_whitespace(value);
    (!label.is_empty() && label.chars().count() <= 48 && !has_disallowed_control_character(&label))
        .then_some(label)
}

fn clean_auth_token(value: &str, expected_len: usize) -> Option<String> {
    let value = value.trim();
    (value.len() == expected_len && value.chars().all(|character| character.is_ascii_hexdigit()))
        .then(|| value.to_ascii_lowercase())
}

fn hash_session_token(token: &str) -> String {
    URL_SAFE_NO_PAD.encode(Sha256::digest(token.as_bytes()))
}

fn cookie_value(headers: &HeaderMap, name: &str) -> Option<String> {
    headers
        .get_all(header::COOKIE)
        .iter()
        .filter_map(|value| value.to_str().ok())
        .flat_map(|value| value.split(';'))
        .filter_map(|cookie| cookie.trim().split_once('='))
        .find_map(|(cookie_name, value)| (cookie_name == name).then(|| value.to_string()))
}

fn compact_credential_id(value: &str) -> String {
    if value.chars().count() <= 20 {
        value.to_string()
    } else {
        format!("{}…{}", &value[..10], &value[value.len() - 8..])
    }
}

fn auth_message(status: StatusCode, message: impl Into<String>) -> Response {
    let message = message.into();
    no_store_json(
        status,
        &IdentityResponse {
            ok: false,
            authenticated: false,
            user_id: None,
            username: None,
            display_name: None,
            passkeys: Vec::new(),
            wallets: Vec::new(),
            active_wallet: None,
            wallet_session: None,
            step_up_required: status == StatusCode::UNAUTHORIZED,
            error: Some(message),
        },
        None,
    )
}

fn auth_error(status: StatusCode, error: impl std::fmt::Display) -> Response {
    auth_message(status, error.to_string())
}

fn no_store_json<T: Serialize>(
    status: StatusCode,
    value: &T,
    set_cookie: Option<String>,
) -> Response {
    let mut response = (status, Json(value)).into_response();
    response
        .headers_mut()
        .insert(CACHE_CONTROL, HeaderValue::from_static("no-store"));
    if let Some(cookie) = set_cookie.and_then(|cookie| HeaderValue::from_str(&cookie).ok()) {
        response.headers_mut().append(header::SET_COOKIE, cookie);
    }
    response
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn usernames_are_stable_and_conservative() {
        assert_eq!(
            normalize_account_username("  Maple.Rook_7  ").as_deref(),
            Some("maple.rook_7")
        );
        assert!(normalize_account_username("ab").is_none());
        assert!(normalize_account_username("maple rook").is_none());
        assert!(normalize_account_username("maple@rook").is_none());
    }

    #[test]
    fn generated_account_usernames_are_valid_internal_identifiers() {
        let first = generated_account_username(Uuid::nil());
        let second = generated_account_username(Uuid::from_u128(u128::MAX));
        assert_eq!(first, "player-00000000000000000000");
        assert_ne!(first, second);
        assert_eq!(
            normalize_account_username(&first).as_deref(),
            Some(first.as_str())
        );
    }

    #[test]
    fn blank_registration_identity_generates_private_account_fields() {
        let path = std::env::temp_dir().join(format!("cosyworld-account-{}.sqlite", random_hex(8)));
        let auth = AccountAuth::for_test(Some(Arc::new(path.clone())));
        let payload = PasskeyRegistrationStartRequest {
            username: String::new(),
            display_name: String::new(),
            label: String::new(),
            wallet_session: None,
        };
        let (_, username, display_name, new_user) =
            resolve_registration_identity(&auth, &payload, None)
                .expect("generated account identity");
        assert!(new_user);
        assert!(username.starts_with("player-"));
        assert_eq!(display_name, "CosyWorld player");
        drop(auth);
        let _ = fs::remove_file(path);
    }

    #[test]
    fn session_tokens_are_hashed_before_storage() {
        let token = "a".repeat(64);
        let hashed = hash_session_token(&token);
        assert_ne!(hashed, token);
        assert_eq!(hashed, hash_session_token(&token));
    }

    #[test]
    fn account_schema_allows_many_wallets_but_one_owner_per_wallet() {
        let path = std::env::temp_dir().join(format!("cosyworld-account-{}.sqlite", random_hex(8)));
        init_account_schema(&path).expect("account schema");
        let conn = open_event_store(&path).expect("account database");
        let now = now_unix_secs() as i64;
        for (id, username) in [("u1", "one"), ("u2", "two")] {
            conn.execute(
                "INSERT INTO auth_users (id, username, display_name, status, created_at_unix, updated_at_unix)
                 VALUES (?1, ?2, ?2, 'active', ?3, ?3)",
                params![id, username, now],
            )
            .expect("insert user");
        }
        link_account_wallet(&path, "u1", "wallet-a").expect("first wallet");
        link_account_wallet(&path, "u1", "wallet-b").expect("second wallet");
        assert!(link_account_wallet(&path, "u2", "wallet-a").is_err());
        assert!(wallet_belongs_to_user(&path, "u1", "wallet-a").unwrap());
        assert!(wallet_belongs_to_user(&path, "u1", "wallet-b").unwrap());
        let _ = fs::remove_file(path);
    }

    #[test]
    fn wallet_claim_moves_exclusive_nft_access_between_accounts() {
        let path = std::env::temp_dir().join(format!("cosyworld-account-{}.sqlite", random_hex(8)));
        init_account_schema(&path).expect("account schema");
        let conn = open_event_store(&path).expect("account database");
        let now = now_unix_secs() as i64;
        for (id, username) in [("u1", "one"), ("u2", "two")] {
            conn.execute(
                "INSERT INTO auth_users (id, username, display_name, status, created_at_unix, updated_at_unix)
                 VALUES (?1, ?2, ?2, 'active', ?3, ?3)",
                params![id, username, now],
            )
            .expect("insert user");
        }
        link_account_wallet(&path, "u1", "wallet-a").expect("initial wallet claim");

        assert!(claim_account_wallet(&path, "u2", "wallet-a", false).is_err());
        assert!(wallet_belongs_to_user(&path, "u1", "wallet-a").unwrap());
        assert!(claim_account_wallet(&path, "u2", "wallet-a", true).expect("move wallet claim"));
        assert!(!wallet_belongs_to_user(&path, "u1", "wallet-a").unwrap());
        assert!(wallet_belongs_to_user(&path, "u2", "wallet-a").unwrap());
        assert_eq!(
            wallet_owner_user_id(&path, "wallet-a").unwrap().as_deref(),
            Some("u2")
        );
        assert!(!claim_account_wallet(&path, "u2", "wallet-a", false).expect("reclaim same wallet"));
        let _ = fs::remove_file(path);
    }
}
