use super::*;

pub(crate) const OFFICIAL_WORLD_ID: &str = "world://cosyworld/official";
pub(crate) fn normalize_process_id(value: &str, variable: &str) -> io::Result<String> {
    let process_id = value.trim();
    if process_id.is_empty()
        || process_id.len() > 64
        || !process_id
            .chars()
            .all(|ch| ch.is_ascii_alphanumeric() || matches!(ch, '-' | '_'))
    {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            format!("{variable} must be 1-64 ASCII letters, numbers, '-' or '_'"),
        ));
    }
    Ok(process_id.to_string())
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

/// Compare fixed-length digests byte by byte so the time taken says nothing
/// about how much of a secret token, or its length, a caller guessed.
pub(crate) fn token_matches(provided: &str, expected: &str) -> bool {
    use sha2::{Digest, Sha256};
    let provided = Sha256::digest(provided.as_bytes());
    let expected = Sha256::digest(expected.as_bytes());
    provided
        .iter()
        .zip(expected.iter())
        .fold(0, |d, (a, b)| d | (a ^ b))
        == 0
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

#[cfg(test)]
mod tests {
    use super::token_matches;

    #[test]
    fn token_matches_only_the_exact_token() {
        let token = "router-token-0123456789";
        assert!(token_matches(token, token));
        assert!(!token_matches("router-token-0123456788", token));
        assert!(!token_matches("router-token", token));
        assert!(!token_matches("router-token-0123456789x", token));
        assert!(!token_matches("", token));
    }
}
