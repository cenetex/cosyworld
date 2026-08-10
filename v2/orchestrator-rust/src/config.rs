use super::*;

pub(crate) const CANONICAL_WORLD_PARTITION: &str = "world";
pub(crate) const DEFAULT_CANONICAL_LEASE_TTL: Duration = Duration::from_secs(30);
pub(crate) const DEFAULT_CANONICAL_CONVERGENCE_POLL: Duration = Duration::from_millis(100);
pub(crate) const DEFAULT_CANONICAL_REGION_ID: &str = "local";
pub(crate) const CANONICAL_ROUTE_HEARTBEAT_MULTIPLIER: u32 = 3;
pub(crate) const CANONICAL_INVITE_TTL: Duration = Duration::from_secs(7 * 24 * 60 * 60);

#[derive(Clone, Debug, Default)]
pub(crate) struct CanonicalRoutingConfig {
    pub(crate) base_url: Option<String>,
    pub(crate) token: Option<String>,
}
#[derive(Clone, Debug)]
pub(crate) struct CanonicalRecoveryConfig {
    pub(crate) replica_path: PathBuf,
    pub(crate) region_id: String,
}
impl CanonicalRoutingConfig {
    pub(crate) fn enabled(&self) -> bool {
        self.base_url.is_some() && self.token.is_some()
    }
}
#[derive(Clone, Debug)]
pub(crate) struct RegionalPresence {
    pub(crate) active: bool,
    pub(crate) last_seen_at: Instant,
}
#[derive(Clone, Debug, Deserialize, Serialize)]
pub(crate) struct CanonicalPresenceRelay {
    pub(crate) source_owner_id: String,
    pub(crate) events: Vec<EventView>,
}
#[derive(Clone, Debug, Deserialize, Serialize)]
pub(crate) struct ForwardedCanonicalCommand {
    pub(crate) source_process_id: String,
    pub(crate) client_addr: String,
    pub(crate) payload: CommandRequest,
}
#[derive(Clone, Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct CanonicalHandoffRequest {
    pub(crate) partition_keys: Vec<String>,
    pub(crate) target_owner_id: String,
    pub(crate) expected_world_seq: u64,
    pub(crate) reason: String,
}
#[derive(Clone, Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct CanonicalRecoveryPromotionRequest {
    pub(crate) source_region_id: String,
    pub(crate) expected_promotion_epoch: u64,
    pub(crate) expected_prefix_hash: String,
}

pub(crate) struct CanonicalCommandCommitContext {
    pub(crate) envelope: CanonicalCommandEnvelope,
    pub(crate) request_hash: String,
    pub(crate) normalized_command: String,
    pub(crate) compatibility_envelope: bool,
    pub(crate) leases: BTreeMap<String, AuthorityLease>,
    pub(crate) phase: AtomicU8,
}

impl CanonicalCommandCommitContext {
    pub(crate) fn try_begin_commit(&self) -> bool {
        self.phase
            .compare_exchange(0, 1, AtomicOrdering::AcqRel, AtomicOrdering::Acquire)
            .is_ok()
    }

    pub(crate) fn abort_commit(&self) {
        self.phase.store(0, AtomicOrdering::Release);
    }

    pub(crate) fn finish_commit(&self) {
        self.phase.store(2, AtomicOrdering::Release);
    }

    pub(crate) fn committed(&self) -> bool {
        self.phase.load(AtomicOrdering::Acquire) == 2
    }

    pub(crate) fn owner_fencing_epoch(&self) -> Option<u64> {
        self.leases.values().map(|lease| lease.fencing_epoch).max()
    }
}

impl DeploymentProfile {
    pub(crate) fn parse(value: &str) -> io::Result<Self> {
        match value.trim().to_ascii_lowercase().as_str() {
            "" | "local" | "dev" | "development" => Ok(Self::Local),
            "prod" | "production" => Ok(Self::Production),
            other => Err(deployment_config_error(format!(
                "unsupported COSYWORLD_DEPLOY_PROFILE={other}; expected local or production"
            ))),
        }
    }

    pub(crate) fn as_str(self) -> &'static str {
        match self {
            Self::Local => "local",
            Self::Production => "production",
        }
    }

    pub(crate) fn is_production(self) -> bool {
        matches!(self, Self::Production)
    }
}

impl DeploymentConfig {
    #[cfg(test)]
    pub(crate) fn local() -> Self {
        Self {
            profile: DeploymentProfile::Local,
            world_id: OFFICIAL_WORLD_ID.to_string(),
            process_id: "local".to_string(),
        }
    }

    pub(crate) fn from_env() -> io::Result<Self> {
        let profile = std::env::var("COSYWORLD_DEPLOY_PROFILE")
            .ok()
            .as_deref()
            .map(DeploymentProfile::parse)
            .transpose()?
            .unwrap_or(DeploymentProfile::Local);
        let default_process_id = if profile.is_production() {
            "public-1"
        } else {
            "local"
        };
        let configured_process_id = std::env::var("COSYWORLD_PROCESS_ID").ok();
        let legacy_shard_id = std::env::var("COSYWORLD_V2_SHARD_ID").ok();
        let process_id = resolve_process_id(
            configured_process_id.as_deref(),
            legacy_shard_id.as_deref(),
            default_process_id,
        )?;
        Ok(Self {
            profile,
            world_id: OFFICIAL_WORLD_ID.to_string(),
            process_id,
        })
    }

    pub(crate) fn validate_runtime_options(
        &self,
        ownership_feed: &OwnershipFeedConfig,
        trust_client_card_ids: bool,
        dev_reset_enabled: bool,
        allow_unsigned_wallet_claims: bool,
        avatar_chat_delay: Duration,
        event_store_enabled: bool,
        moderation_enabled: bool,
    ) -> io::Result<()> {
        if !self.profile.is_production() {
            return Ok(());
        }

        if ownership_feed.remote_url.is_some() && ownership_feed.remote_bearer.is_none() {
            return Err(deployment_config_error(
                "production profile requires COSYWORLD_AVATAR_OWNERSHIP_FEED_BEARER when the linked-avatar adapter URL is configured",
            ));
        }
        if trust_client_card_ids {
            return Err(deployment_config_error(
                "production profile cannot enable COSYWORLD_DEV_TRUST_CLIENT_CARD_IDS",
            ));
        }
        if dev_reset_enabled {
            return Err(deployment_config_error(
                "production profile cannot enable COSYWORLD_ENABLE_DEV_RESET",
            ));
        }
        if allow_unsigned_wallet_claims {
            return Err(deployment_config_error(
                "production profile cannot enable COSYWORLD_DEV_ALLOW_UNSIGNED_WALLET",
            ));
        }
        if avatar_chat_delay > Duration::ZERO {
            return Err(deployment_config_error(
                "production profile cannot enable COSYWORLD_DEV_AVATAR_CHAT_DELAY_MS",
            ));
        }
        if !event_store_enabled {
            return Err(deployment_config_error(
                "production profile requires the SQLite event store; unset COSYWORLD_V2_EVENT_DB_PATH=off",
            ));
        }
        if !moderation_enabled {
            return Err(deployment_config_error(
                "production profile requires COSYWORLD_MODERATION_TOKEN",
            ));
        }
        Ok(())
    }
}

pub(crate) fn resolve_process_id(
    configured_process_id: Option<&str>,
    legacy_shard_id: Option<&str>,
    default_process_id: &str,
) -> io::Result<String> {
    match (configured_process_id, legacy_shard_id) {
        (Some(process_id), Some(shard_id)) => {
            let process_id = normalize_process_id(process_id, "COSYWORLD_PROCESS_ID")?;
            let shard_id = normalize_process_id(shard_id, "COSYWORLD_V2_SHARD_ID")?;
            if process_id != shard_id {
                return Err(deployment_config_error(
                    "COSYWORLD_PROCESS_ID and compatibility alias COSYWORLD_V2_SHARD_ID must match when both are set",
                ));
            }
            Ok(process_id)
        }
        (Some(process_id), None) => normalize_process_id(process_id, "COSYWORLD_PROCESS_ID"),
        (None, Some(shard_id)) => normalize_process_id(shard_id, "COSYWORLD_V2_SHARD_ID"),
        (None, None) => normalize_process_id(default_process_id, "default process id"),
    }
}

pub(crate) fn deployment_config_error(message: impl Into<String>) -> io::Error {
    io::Error::new(io::ErrorKind::InvalidInput, message.into())
}

pub(crate) fn canonical_routing_config_from_env() -> io::Result<CanonicalRoutingConfig> {
    let base_url = std::env::var("COSYWORLD_CANONICAL_ROUTE_URL")
        .ok()
        .map(|value| value.trim().trim_end_matches('/').to_string())
        .filter(|value| !value.is_empty());
    let token = std::env::var("COSYWORLD_CANONICAL_ROUTER_TOKEN")
        .ok()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty());
    canonical_routing_config(base_url, token)
}

pub(crate) fn canonical_recovery_config_from_env(
    event_store_path: Option<&Path>,
) -> io::Result<Option<CanonicalRecoveryConfig>> {
    let replica_path = std::env::var("COSYWORLD_CANONICAL_RECOVERY_DB_PATH")
        .ok()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .map(PathBuf::from);
    let region_id = std::env::var("COSYWORLD_CANONICAL_RECOVERY_REGION_ID")
        .ok()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty());
    if replica_path.is_some() != region_id.is_some() {
        return Err(deployment_config_error(
            "COSYWORLD_CANONICAL_RECOVERY_DB_PATH and COSYWORLD_CANONICAL_RECOVERY_REGION_ID must be configured together",
        ));
    }
    let (Some(replica_path), Some(region_id)) = (replica_path, region_id) else {
        return Ok(None);
    };
    let region_id = normalize_process_id(&region_id, "COSYWORLD_CANONICAL_RECOVERY_REGION_ID")?;
    if event_store_path.is_some_and(|primary| primary == replica_path.as_path()) {
        return Err(deployment_config_error(
            "COSYWORLD_CANONICAL_RECOVERY_DB_PATH must differ from COSYWORLD_V2_EVENT_DB_PATH",
        ));
    }
    Ok(Some(CanonicalRecoveryConfig {
        replica_path,
        region_id,
    }))
}

pub(crate) fn canonical_routing_config(
    base_url: Option<String>,
    token: Option<String>,
) -> io::Result<CanonicalRoutingConfig> {
    if base_url.is_some() != token.is_some() {
        return Err(deployment_config_error(
            "COSYWORLD_CANONICAL_ROUTE_URL and COSYWORLD_CANONICAL_ROUTER_TOKEN must be configured together",
        ));
    }
    if let Some(base_url) = base_url.as_deref() {
        let parsed = reqwest::Url::parse(base_url).map_err(|error| {
            deployment_config_error(format!("COSYWORLD_CANONICAL_ROUTE_URL is invalid: {error}"))
        })?;
        if !matches!(parsed.scheme(), "http" | "https")
            || parsed.host_str().is_none()
            || !parsed.username().is_empty()
            || parsed.password().is_some()
            || parsed.query().is_some()
            || parsed.fragment().is_some()
            || parsed.path() != "/"
        {
            return Err(deployment_config_error(
                "COSYWORLD_CANONICAL_ROUTE_URL must be an http(s) origin without credentials, path, query, or fragment",
            ));
        }
    }
    if token.as_deref().is_some_and(|token| token.len() < 16) {
        return Err(deployment_config_error(
            "COSYWORLD_CANONICAL_ROUTER_TOKEN must contain at least 16 characters",
        ));
    }
    Ok(CanonicalRoutingConfig { base_url, token })
}

pub(crate) fn canonical_route_heartbeat_expiry(now_ms: u64, lease_ttl: Duration) -> u64 {
    let ttl_ms = u64::try_from(lease_ttl.as_millis()).unwrap_or(u64::MAX);
    now_ms.saturating_add(ttl_ms.saturating_mul(u64::from(CANONICAL_ROUTE_HEARTBEAT_MULTIPLIER)))
}

pub(crate) fn canonical_region_id_from_env() -> io::Result<String> {
    std::env::var("COSYWORLD_CANONICAL_REGION_ID")
        .ok()
        .as_deref()
        .map(|value| normalize_process_id(value, "COSYWORLD_CANONICAL_REGION_ID"))
        .transpose()
        .map(|region| region.unwrap_or_else(|| DEFAULT_CANONICAL_REGION_ID.to_string()))
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) enum DeploymentProfile {
    Local,
    Production,
}

#[derive(Clone, Debug)]
pub(crate) struct DeploymentConfig {
    pub(crate) profile: DeploymentProfile,
    pub(crate) world_id: String,
    pub(crate) process_id: String,
}
