use super::*;

mod dev_test_passkey;

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
    cookie_name: String,
    secure_cookie: bool,
    /// `COSYWORLD_PASSKEYS=members`: no sign-ups, no signed-out play.
    members_only: bool,
    /// Pending Discord OAuth attempts, keyed by the state nonce.
    discord_states: StdMutex<BTreeMap<String, DiscordOauthAttempt>>,
}

struct DiscordOauthAttempt {
    expires_at: Instant,
    redirect: String,
}

enum AccountCeremony {
    Registration {
        expires_at: Instant,
        user_id: Uuid,
        username: String,
        display_name: String,
        label: String,
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

#[derive(Debug, Serialize)]
struct CeremonyResponse {
    ok: bool,
    ceremony_id: String,
    public_key: serde_json::Value,
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
    account_revision: Option<u64>,
    username: Option<String>,
    display_name: Option<String>,
    passkeys: Vec<PasskeyView>,
    wallets: Vec<WalletView>,
    active_wallet: Option<String>,
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
            account_revision: None,
            username: None,
            display_name: None,
            passkeys: Vec::new(),
            wallets: Vec::new(),
            active_wallet: None,
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
        let members_only = passkey_access::members_only_from_env()?;
        if let Some(path) = db_path.as_deref() {
            init_account_schema(path).map_err(|error| io::Error::other(error.to_string()))?;
            dev_test_passkey::apply_from_env(path, members_only)?;
        }
        let secure_cookie = rp_origin.starts_with("https://");
        Ok(Self {
            webauthn,
            db_path,
            ceremonies: StdMutex::new(BTreeMap::new()),
            discord_states: StdMutex::new(BTreeMap::new()),
            cookie_name: if secure_cookie {
                "__Host-cosyworld_session".to_string()
            } else {
                "cosyworld_session".to_string()
            },
            secure_cookie,
            members_only,
        })
    }

    #[cfg(test)]
    pub(super) fn for_test(db_path: Option<Arc<PathBuf>>) -> Arc<Self> {
        Self::for_test_with_access(db_path, false)
    }

    #[cfg(test)]
    pub(super) fn for_test_with_access(
        db_path: Option<Arc<PathBuf>>,
        members_only: bool,
    ) -> Arc<Self> {
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
            discord_states: StdMutex::new(BTreeMap::new()),
            cookie_name: "cosyworld_session".to_string(),
            secure_cookie: false,
            members_only,
        })
    }

    pub(super) fn members_only(&self) -> bool {
        self.members_only
    }

    fn path(&self) -> AccountResult<&Path> {
        self.db_path
            .as_deref()
            .map(PathBuf::as_path)
            .ok_or_else(|| account_error("account persistence is unavailable"))
    }

    pub(super) fn authenticated_user_id(&self, headers: &HeaderMap) -> io::Result<Option<String>> {
        self.session_from_headers(headers)
            .map(|session| session.map(|session| session.user_id))
            .map_err(|error| io::Error::other(error.to_string()))
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

    #[cfg(test)]
    pub(super) fn test_session(&self, user_id: &str) -> String {
        self.issue_session(user_id).expect("test account session").1
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

    fn store_discord_state(&self, redirect: String) -> String {
        let state = random_hex(32);
        self.cleanup_discord_states();
        if let Ok(mut states) = self.discord_states.lock() {
            states.insert(
                state.clone(),
                DiscordOauthAttempt {
                    expires_at: Instant::now() + CEREMONY_TTL,
                    redirect,
                },
            );
        }
        state
    }

    fn cleanup_discord_states(&self) {
        let now = Instant::now();
        if let Ok(mut states) = self.discord_states.lock() {
            states.retain(|_, attempt| attempt.expires_at > now);
        }
    }

    fn take_discord_state(&self, state: &str) -> AccountResult<String> {
        self.cleanup_discord_states();
        let removed = self
            .discord_states
            .lock()
            .map_err(|_| account_error("discord state lock poisoned"))?
            .remove(state);
        removed
            .filter(|attempt| attempt.expires_at > Instant::now())
            .map(|attempt| attempt.redirect)
            .ok_or_else(|| account_error("discord authorization attempt is missing or expired"))
    }

    fn account_id_for_discord(&self, discord_user_id: &str) -> AccountResult<Option<String>> {
        let conn = open_event_store(self.path()?)?;
        let account_id = conn
            .query_row(
                "SELECT account_id FROM discord_links WHERE discord_user_id = ?1",
                params![discord_user_id],
                |row| row.get::<_, String>(0),
            )
            .optional()?;
        Ok(account_id)
    }

    fn create_discord_account(
        &self,
        discord_user_id: &str,
        discord_username: &str,
        global_name: Option<&str>,
        avatar: Option<&str>,
    ) -> AccountResult<String> {
        let path = self.path()?.to_path_buf();
        let user_id = Uuid::new_v4();
        let account_username = normalize_account_username(discord_username)
            .filter(|name| find_user_by_username(path.as_path(), name).ok().flatten().is_none())
            .unwrap_or_else(|| generated_account_username(user_id));
        let display_name = global_name
            .map(str::trim)
            .filter(|name| !name.is_empty())
            .map(str::to_string)
            .unwrap_or_else(|| account_username.clone());
        let avatar_url = avatar
            .map(|hash| format!("https://cdn.discordapp.com/avatars/{discord_user_id}/{hash}.png"));
        let mut conn = open_event_store(path.as_path())?;
        let transaction = conn.transaction()?;
        let now = now_unix_secs() as i64;
        transaction.execute(
            "INSERT INTO auth_users (id, username, display_name, status, created_at_unix, updated_at_unix)
             VALUES (?1, ?2, ?3, 'active', ?4, ?4)",
            params![user_id.to_string(), account_username, display_name, now],
        )?;
        transaction.execute(
            "INSERT INTO discord_links (discord_user_id, account_id, username, avatar_url, created_at_unix)
             VALUES (?1, ?2, ?3, ?4, ?5)",
            params![
                discord_user_id,
                user_id.to_string(),
                discord_username,
                avatar_url,
                now
            ],
        )?;
        transaction.commit()?;
        Ok(user_id.to_string())
    }

    fn unlink_discord(&self, account_id: &str) -> AccountResult<()> {
        let conn = open_event_store(self.path()?)?;
        conn.execute(
            "DELETE FROM discord_links WHERE account_id = ?1",
            params![account_id],
        )?;
        Ok(())
    }

    /// A bot service token may act on a linked Discord user's behalf. The
    /// token is held by the gateway only; nothing here issues one. Resolves
    /// `Authorization: Bearer <token>` + `X-CosyWorld-Discord-User` to the
    /// linked account, so a server-side client can play without a browser
    /// session cookie.
    pub(super) fn account_for_bot_request(&self, headers: &HeaderMap) -> Option<String> {
        let expected = std::env::var("COSYWORLD_BOT_TOKEN").ok()?;
        let discord_user = headers
            .get("x-cosyworld-discord-user")
            .and_then(|value| value.to_str().ok())?;
        if !bot_rate_limit_allow(discord_user) {
            tracing::warn!(discord_user, "discord bot token rate limited");
            return None;
        }
        let account = self.account_for_bot_request_with(headers, expected.as_str())?;
        tracing::info!(discord_user, "discord bot token authorized shared play");
        Some(account)
    }

    fn account_for_bot_request_with(&self, headers: &HeaderMap, expected: &str) -> Option<String> {
        if expected.is_empty() {
            return None;
        }
        let token = headers
            .get("authorization")
            .and_then(|value| value.to_str().ok())?
            .strip_prefix("Bearer ")?;
        if !crate::config::token_matches(token, expected) {
            return None;
        }
        let discord_user = headers
            .get("x-cosyworld-discord-user")
            .and_then(|value| value.to_str().ok())?;
        self.account_id_for_discord(discord_user).ok().flatten()
    }
}

#[derive(Debug, Deserialize)]
pub(super) struct DiscordStartRequest {
    #[serde(default)]
    redirect: String,
}

#[derive(Debug, Deserialize)]
pub(super) struct DiscordCallbackParams {
    code: String,
    state: String,
}

#[derive(Debug, Deserialize)]
struct DiscordUser {
    id: String,
    username: String,
    #[serde(default)]
    global_name: Option<String>,
    #[serde(default)]
    avatar: Option<String>,
}

#[derive(Debug, Serialize)]
struct DiscordStartResponse {
    ok: bool,
    authorize_url: String,
}

fn bot_rate_limit_allow(discord_user: &str) -> bool {
    use crate::rate_limit::{RateLimit, RateLimiter};
    use std::sync::{Mutex, OnceLock};
    use std::time::{Duration, Instant};
    static LIMITS: OnceLock<Mutex<RateLimiter>> = OnceLock::new();
    LIMITS
        .get_or_init(|| Mutex::new(RateLimiter::default()))
        .lock()
        .map(|mut limits| {
            limits.allow(
                discord_user.to_string(),
                RateLimit {
                    max_hits: 120,
                    window: Duration::from_secs(60),
                },
                Instant::now(),
            )
        })
        .unwrap_or(false)
}

fn discord_credentials() -> AccountResult<(String, String)> {
    let client_id = std::env::var("DISCORD_CLIENT_ID")
        .map_err(|_| account_error("DISCORD_CLIENT_ID is not configured"))?;
    let client_secret = std::env::var("DISCORD_CLIENT_SECRET")
        .map_err(|_| account_error("DISCORD_CLIENT_SECRET is not configured"))?;
    Ok((client_id, client_secret))
}

fn discord_redirect_uri() -> AccountResult<String> {
    std::env::var("DISCORD_REDIRECT_URI")
        .map_err(|_| account_error("DISCORD_REDIRECT_URI is not configured"))
}

fn valid_redirect(redirect: &str) -> bool {
    // A same-origin relative path only: a single leading slash, no backslash
    // (browsers normalize "/\" to "//"), no control characters, and no
    // percent-encoded backslash that would change the path shape after decode.
    if !redirect.starts_with('/') || redirect.starts_with("//") {
        return false;
    }
    if redirect.chars().any(|c| c == '\\' || c.is_control()) {
        return false;
    }
    !redirect.to_ascii_lowercase().contains("%5c")
}

fn redirect_with_cookie(location: &str, cookie: String) -> Response {
    // Never redirect off-site: the OAuth state carries a client-chosen target.
    let location = if valid_redirect(location) { location } else { "/" };
    let mut response = Response::new(axum::body::Body::empty());
    *response.status_mut() = StatusCode::SEE_OTHER;
    response
        .headers_mut()
        .insert(CACHE_CONTROL, HeaderValue::from_static("no-store"));
    if let Ok(value) = HeaderValue::from_str(location) {
        response
            .headers_mut()
            .insert(axum::http::header::LOCATION, value);
    }
    if let Ok(value) = HeaderValue::from_str(&cookie) {
        response
            .headers_mut()
            .insert(axum::http::header::SET_COOKIE, value);
    }
    response
}

pub(super) async fn discord_login_start(
    State(state): State<AppState>,
    Json(payload): Json<DiscordStartRequest>,
) -> Response {
    let auth = &state.account_auth;
    if !valid_redirect(&payload.redirect) {
        return auth_message(StatusCode::BAD_REQUEST, "redirect must be a local path");
    }
    let client_id = match discord_credentials() {
        Ok((id, _)) => id,
        Err(error) => return auth_error(StatusCode::SERVICE_UNAVAILABLE, error),
    };
    let redirect_uri = match discord_redirect_uri() {
        Ok(uri) => uri,
        Err(error) => return auth_error(StatusCode::SERVICE_UNAVAILABLE, error),
    };
    let state = auth.store_discord_state(payload.redirect);
    let authorize_url = match reqwest::Url::parse("https://discord.com/oauth2/authorize") {
        Ok(mut url) => {
            url.query_pairs_mut()
                .append_pair("client_id", &client_id)
                .append_pair("response_type", "code")
                .append_pair("redirect_uri", &redirect_uri)
                .append_pair("scope", "identify")
                .append_pair("state", &state);
            url.to_string()
        }
        Err(error) => return auth_error(StatusCode::SERVICE_UNAVAILABLE, error),
    };
    no_store_json(
        StatusCode::OK,
        &DiscordStartResponse {
            ok: true,
            authorize_url,
        },
        None,
    )
}

pub(super) async fn discord_login_callback(
    State(state): State<AppState>,
    axum::extract::Query(params): axum::extract::Query<DiscordCallbackParams>,
) -> Response {
    let auth = &state.account_auth;
    let redirect = match auth.take_discord_state(&params.state) {
        Ok(redirect) => redirect,
        Err(error) => return auth_message(StatusCode::BAD_REQUEST, error.to_string()),
    };
    let (client_id, client_secret) = match discord_credentials() {
        Ok(value) => value,
        Err(error) => return auth_error(StatusCode::SERVICE_UNAVAILABLE, error),
    };
    let redirect_uri = match discord_redirect_uri() {
        Ok(uri) => uri,
        Err(error) => return auth_error(StatusCode::SERVICE_UNAVAILABLE, error),
    };
    let client = reqwest::Client::new();
    let token_body: serde_json::Value = match client
        .post("https://discord.com/api/oauth2/token")
        .form(&[
            ("client_id", client_id.as_str()),
            ("client_secret", client_secret.as_str()),
            ("grant_type", "authorization_code"),
            ("code", params.code.as_str()),
            ("redirect_uri", redirect_uri.as_str()),
        ])
        .send()
        .await
    {
        Ok(response) => match response.json().await {
            Ok(body) => body,
            Err(error) => {
                return auth_error(StatusCode::BAD_GATEWAY, format!("discord token response: {error}"))
            }
        },
        Err(error) => {
            return auth_error(StatusCode::BAD_GATEWAY, format!("discord token exchange: {error}"))
        }
    };
    let Some(access_token) = token_body
        .get("access_token")
        .and_then(|value| value.as_str())
    else {
        return auth_message(StatusCode::BAD_REQUEST, "discord authorization failed");
    };
    let user: DiscordUser = match client
        .get("https://discord.com/api/v10/users/@me")
        .bearer_auth(access_token)
        .send()
        .await
    {
        Ok(response) => match response.json().await {
            Ok(user) => user,
            Err(error) => {
                return auth_error(StatusCode::BAD_GATEWAY, format!("discord identity: {error}"))
            }
        },
        Err(error) => {
            return auth_error(StatusCode::BAD_GATEWAY, format!("discord identity request: {error}"))
        }
    };
    let account_id = match auth.account_id_for_discord(&user.id) {
        Ok(Some(id)) => id,
        Ok(None) => match auth.create_discord_account(
            &user.id,
            &user.username,
            user.global_name.as_deref(),
            user.avatar.as_deref(),
        ) {
            Ok(id) => id,
            Err(error) => return auth_error(StatusCode::CONFLICT, error),
        },
        Err(error) => return auth_error(StatusCode::SERVICE_UNAVAILABLE, error),
    };
    let (_, cookie) = match auth.issue_session(&account_id) {
        Ok(value) => value,
        Err(error) => return auth_error(StatusCode::SERVICE_UNAVAILABLE, error),
    };
    redirect_with_cookie(&redirect, cookie)
}

pub(super) async fn discord_unlink(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Response {
    let auth = &state.account_auth;
    let Some(user_id) = auth.authenticated_user_id(&headers).ok().flatten() else {
        return auth_message(StatusCode::UNAUTHORIZED, "sign in to unlink Discord");
    };
    match auth.unlink_discord(&user_id) {
        Ok(()) => no_store_json(StatusCode::OK, &serde_json::json!({ "ok": true }), None),
        Err(error) => auth_error(StatusCode::SERVICE_UNAVAILABLE, error),
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
    // A members-only server lets a signed-in passkey add another, never a
    // new account.
    if auth.members_only && current.is_none() {
        return auth_message(StatusCode::FORBIDDEN, passkey_access::SIGNUPS_CLOSED);
    }

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
        resolve_registration_identity(auth, &payload)
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
    // Sign-in uses discoverable authentication. Request a resident credential
    // so a fresh device can find the account without a username or local state.
    let mut public_key = serde_json::to_value(public_key).unwrap_or(serde_json::Value::Null);
    public_key["publicKey"]["authenticatorSelection"]["residentKey"] = "required".into();
    public_key["publicKey"]["authenticatorSelection"]["requireResidentKey"] = true.into();
    let label = normalize_passkey_label(&payload.label)
        .unwrap_or_else(|| format!("Passkey {}", passkeys.len() + 1));
    let ceremony_id = match auth.store_ceremony(AccountCeremony::Registration {
        expires_at: Instant::now() + CEREMONY_TTL,
        user_id,
        username,
        display_name,
        label,
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
            public_key,
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
            new_user,
        },
    ) {
        return auth_error(StatusCode::CONFLICT, error);
    }
    let (_, cookie) = match auth.issue_session(&user_id.to_string()) {
        Ok(session) => session,
        Err(error) => return auth_error(StatusCode::SERVICE_UNAVAILABLE, error),
    };
    identity_response(&state, &user_id.to_string(), Some(cookie))
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
    if user_id.to_string() == dev_test_passkey::TEST_USER_ID {
        info!(
            "{}: {} signed in",
            dev_test_passkey::TEST_PASSKEY_ENV,
            dev_test_passkey::TEST_USERNAME
        );
    }
    let (_, cookie) = match auth.issue_session(&user_id.to_string()) {
        Ok(session) => session,
        Err(error) => return auth_error(StatusCode::SERVICE_UNAVAILABLE, error),
    };
    identity_response(&state, &user_id.to_string(), Some(cookie))
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
        Some(current) => identity_response(&state, &current.user_id, None),
        None if state.account_auth.members_only => {
            let mut body = serde_json::to_value(IdentityResponse::signed_out())
                .unwrap_or(serde_json::Value::Null);
            body["members_only"] = true.into();
            no_store_json(StatusCode::OK, &body, None)
        }
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

fn resolve_registration_identity(
    auth: &AccountAuth,
    payload: &PasskeyRegistrationStartRequest,
) -> AccountResult<(Uuid, String, String, bool)> {
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

fn identity_response(state: &AppState, user_id: &str, cookie: Option<String>) -> Response {
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
    let revision = match auth.path().and_then(|path| {
        let c = open_event_store(path)?;
        Ok(crate::account_revision::current(&c, user_id)?)
    }) {
        Ok(revision) => revision,
        Err(error) => return auth_error(StatusCode::SERVICE_UNAVAILABLE, error),
    };
    let active_wallet = wallets.first().map(|wallet| wallet.wallet_address.clone());
    no_store_json(
        StatusCode::OK,
        &IdentityResponse {
            ok: true,
            authenticated: true,
            user_id: Some(user_id.to_string()),
            account_revision: Some(revision),
            username: Some(username),
            display_name: Some(display_name),
            passkeys,
            wallets,
            active_wallet,
            step_up_required: false,
            error: None,
        },
        cookie,
    )
}

fn init_account_schema(path: &Path) -> AccountResult<()> {
    let conn = open_event_store(path)?;
    crate::account_revision::schema(&conn)?;
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
        CREATE INDEX IF NOT EXISTS idx_user_wallets_user ON user_wallets(user_id, created_at_unix);
        CREATE TABLE IF NOT EXISTS discord_links (
            discord_user_id TEXT PRIMARY KEY,
            account_id TEXT NOT NULL UNIQUE REFERENCES auth_users(id) ON DELETE CASCADE,
            username TEXT NOT NULL,
            avatar_url TEXT,
            created_at_unix INTEGER NOT NULL
        );",
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
            account_revision: None,
            username: None,
            display_name: None,
            passkeys: Vec::new(),
            wallets: Vec::new(),
            active_wallet: None,
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

#[path = "passkey_access.rs"]
pub(crate) mod passkey_access;

#[cfg(test)]
#[path = "card_authoring_tests.rs"]
mod card_authoring_tests;

#[cfg(test)]
#[path = "passkey_access_tests.rs"]
mod passkey_access_tests;

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
        };
        let (_, username, display_name, new_user) =
            resolve_registration_identity(&auth, &payload).expect("generated account identity");
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
}

#[cfg(test)]
mod discord_auth_tests {
    use super::*;

    fn test_auth() -> Arc<AccountAuth> {
        let path = std::env::temp_dir().join(format!(
            "cosyworld-discord-{}.sqlite",
            random_hex(8)
        ));
        AccountAuth::for_test(Some(Arc::new(path)))
    }

    #[test]
    fn discord_link_round_trip() {
        let auth = test_auth();
        let discord_id = format!("du-{}", random_hex(8));
        assert_eq!(auth.account_id_for_discord(&discord_id).unwrap(), None);
        let account_id = auth
            .create_discord_account(&discord_id, "atimics", Some("Atimics"), None)
            .unwrap();
        assert_eq!(
            auth.account_id_for_discord(&discord_id).unwrap().as_deref(),
            Some(account_id.as_str())
        );
        auth.unlink_discord(&account_id).unwrap();
        assert_eq!(auth.account_id_for_discord(&discord_id).unwrap(), None);
    }

    #[test]
    fn discord_username_conflict_falls_back_to_generated() {
        let auth = test_auth();
        let first = auth
            .create_discord_account("du-1", "atimics", Some("Atimics"), None)
            .unwrap();
        let second = auth
            .create_discord_account("du-2", "atimics", Some("Second"), None)
            .unwrap();
        assert_ne!(first, second);
        assert_eq!(
            auth.account_id_for_discord("du-1").unwrap().as_deref(),
            Some(first.as_str())
        );
        assert_eq!(
            auth.account_id_for_discord("du-2").unwrap().as_deref(),
            Some(second.as_str())
        );
    }

    #[test]
    fn discord_state_round_trip_and_expiry() {
        let auth = test_auth();
        let state = auth.store_discord_state("/cards".to_string());
        assert_eq!(auth.take_discord_state(&state).unwrap(), "/cards");
        assert!(auth.take_discord_state(&state).is_err());
    }

    #[test]
    fn bot_token_resolves_a_linked_account() {
        let auth = test_auth();
        let account_id = auth
            .create_discord_account("du-bot", "botuser", Some("Bot"), None)
            .unwrap();
        let mut headers = HeaderMap::new();
        headers.insert("authorization", HeaderValue::from_static("Bearer secret"));
        headers.insert(
            "x-cosyworld-discord-user",
            HeaderValue::from_static("du-bot"),
        );
        assert_eq!(
            auth.account_for_bot_request_with(&headers, "secret").as_deref(),
            Some(account_id.as_str())
        );
        assert_eq!(auth.account_for_bot_request_with(&headers, "wrong"), None);
        headers.remove("x-cosyworld-discord-user");
        assert_eq!(auth.account_for_bot_request_with(&headers, "secret"), None);
    }

    #[test]
    fn discord_redirect_accepts_only_local_paths() {
        assert!(valid_redirect("/"));
        assert!(valid_redirect("/cards"));
        assert!(valid_redirect("/ok"));
        assert!(!valid_redirect("/\\x"));
        assert!(!valid_redirect("/%5Cx"));
        assert!(!valid_redirect("/%5cx"));
        assert!(!valid_redirect("//evil.example"));
        assert!(!valid_redirect("https://evil.example"));
        assert!(!valid_redirect("javascript:alert(1)"));
        assert!(!valid_redirect(""));
        assert!(!valid_redirect("/bad\u{7f}path"));
    }
}
