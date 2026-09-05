use serde::Serialize;
use std::{
    collections::BTreeMap,
    sync::{Arc, RwLock, RwLockWriteGuard},
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};
use tracing::{info, warn};

const DEFAULT_ROUTE_COOLDOWN: Duration = Duration::from_secs(30);
const MIN_ROUTE_COOLDOWN: Duration = Duration::from_secs(1);
const MAX_ROUTE_COOLDOWN: Duration = Duration::from_secs(5 * 60);
const HEALTHY_PROBE_INTERVAL: Duration = Duration::from_secs(5 * 60);
const DEGRADED_PROBE_INTERVAL: Duration = Duration::from_secs(60);
pub(crate) const DEFAULT_LOW_CREDIT_THRESHOLD: f64 = 5.0;

pub(crate) const AI_READINESS_PROBING: &str = "ai_readiness_probing";
pub(crate) const AI_ACCOUNT_UNAUTHORIZED: &str = "ai_account_unauthorized";
pub(crate) const AI_CREDITS_EXHAUSTED: &str = "ai_credits_exhausted";
pub(crate) const AI_CREDITS_LOW: &str = "ai_credits_low";
pub(crate) const AI_RATE_LIMITED: &str = "ai_rate_limited";
pub(crate) const AI_PROVIDER_UNAVAILABLE: &str = "ai_provider_unavailable";
pub(crate) const AI_ROUTE_INCOMPATIBLE: &str = "ai_route_incompatible";

#[derive(Clone, Debug, Eq, Ord, PartialEq, PartialOrd)]
struct AiExactRoute {
    endpoint: String,
    requested_model_id: String,
}

impl AiExactRoute {
    fn new(endpoint: &str, requested_model_id: &str) -> Self {
        Self {
            endpoint: endpoint.trim_matches('/').to_string(),
            requested_model_id: requested_model_id.trim().to_string(),
        }
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum AccountReadiness {
    Probing,
    Ready,
    Unauthorized,
    CreditsExhausted,
}

impl AccountReadiness {
    fn reason_code(self) -> Option<&'static str> {
        match self {
            Self::Probing => Some(AI_READINESS_PROBING),
            Self::Ready => None,
            Self::Unauthorized => Some(AI_ACCOUNT_UNAUTHORIZED),
            Self::CreditsExhausted => Some(AI_CREDITS_EXHAUSTED),
        }
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum RouteFailureKind {
    RateLimited,
    ProviderUnavailable,
    Incompatible,
}

impl RouteFailureKind {
    fn reason_code(self) -> &'static str {
        match self {
            Self::RateLimited => AI_RATE_LIMITED,
            Self::ProviderUnavailable => AI_PROVIDER_UNAVAILABLE,
            Self::Incompatible => AI_ROUTE_INCOMPATIBLE,
        }
    }
}

#[derive(Clone, Debug)]
struct RouteFailure {
    kind: RouteFailureKind,
    retry_at: Option<Instant>,
    retry_at_unix: Option<u64>,
}

#[derive(Debug)]
struct AiReadinessState {
    account: AccountReadiness,
    credits_low: bool,
    low_credit_threshold: f64,
    checked_at_unix: Option<u64>,
    routes: BTreeMap<AiExactRoute, RouteFailure>,
}

impl AiReadinessState {
    fn ready(low_credit_threshold: f64) -> Self {
        Self {
            account: AccountReadiness::Ready,
            credits_low: false,
            low_credit_threshold,
            checked_at_unix: None,
            routes: BTreeMap::new(),
        }
    }

    fn probing(low_credit_threshold: f64) -> Self {
        Self {
            account: AccountReadiness::Probing,
            credits_low: false,
            low_credit_threshold,
            checked_at_unix: None,
            routes: BTreeMap::new(),
        }
    }
}

#[derive(Clone, Debug)]
pub(crate) struct AiReadiness {
    state: Arc<RwLock<AiReadinessState>>,
}

impl Default for AiReadiness {
    fn default() -> Self {
        Self::ready_with_low_credit_threshold(DEFAULT_LOW_CREDIT_THRESHOLD)
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) struct AiReadinessGate {
    reason_code: Option<&'static str>,
    retry_at_unix: Option<u64>,
    terminal: bool,
}

impl AiReadinessGate {
    pub(crate) const fn ready() -> Self {
        Self {
            reason_code: None,
            retry_at_unix: None,
            terminal: false,
        }
    }

    const fn blocked(
        reason_code: &'static str,
        retry_at_unix: Option<u64>,
        terminal: bool,
    ) -> Self {
        Self {
            reason_code: Some(reason_code),
            retry_at_unix,
            terminal,
        }
    }

    pub(crate) const fn is_ready(self) -> bool {
        self.reason_code.is_none()
    }

    pub(crate) const fn reason_code(self) -> Option<&'static str> {
        self.reason_code
    }

    pub(crate) const fn retry_at_unix(self) -> Option<u64> {
        self.retry_at_unix
    }

    pub(crate) const fn is_terminal_block(self) -> bool {
        self.reason_code.is_some() && self.terminal
    }

    pub(crate) const fn is_retryable_block(self) -> bool {
        self.reason_code.is_some() && !self.terminal
    }
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
pub(crate) struct AiReadinessSnapshot {
    pub(crate) status: &'static str,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) reason_code: Option<&'static str>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) checked_at_unix: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) retry_at_unix: Option<u64>,
    pub(crate) blocked_route_count: usize,
    pub(crate) next_probe_after_secs: u64,
}

#[derive(Debug, Serialize)]
pub(crate) struct MetaAi {
    pub(crate) configured: bool,
    pub(crate) provider: &'static str,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) readiness: Option<AiReadinessSnapshot>,
}

impl AiReadiness {
    pub(crate) fn probing_with_low_credit_threshold(low_credit_threshold: f64) -> Self {
        Self {
            state: Arc::new(RwLock::new(AiReadinessState::probing(low_credit_threshold))),
        }
    }

    pub(crate) fn ready_with_low_credit_threshold(low_credit_threshold: f64) -> Self {
        Self {
            state: Arc::new(RwLock::new(AiReadinessState::ready(low_credit_threshold))),
        }
    }

    pub(crate) fn gate(&self, endpoint: &str, requested_model_id: &str) -> AiReadinessGate {
        self.gate_at(endpoint, requested_model_id, Instant::now(), now_unix())
    }

    fn gate_at(
        &self,
        endpoint: &str,
        requested_model_id: &str,
        now: Instant,
        now_unix: u64,
    ) -> AiReadinessGate {
        let route = AiExactRoute::new(endpoint, requested_model_id);
        let mut state = self.write_state();
        if let Some(reason_code) = state.account.reason_code() {
            return AiReadinessGate::blocked(
                reason_code,
                None,
                state.account != AccountReadiness::Probing,
            );
        }
        let Some(failure) = state.routes.get(&route).cloned() else {
            return AiReadinessGate::ready();
        };
        if failure.retry_at.is_some_and(|retry_at| retry_at <= now) {
            state.routes.remove(&route);
            info!(
                event = "ai_readiness_transition",
                endpoint = route.endpoint,
                requested_model_id = route.requested_model_id,
                old_state = failure.kind.reason_code(),
                new_state = "ready",
                "AI exact route cooldown expired"
            );
            return AiReadinessGate::ready();
        }
        let retry_at_unix = failure
            .retry_at_unix
            .filter(|retry_at| *retry_at > now_unix);
        AiReadinessGate::blocked(
            failure.kind.reason_code(),
            retry_at_unix,
            failure.kind == RouteFailureKind::Incompatible && failure.retry_at.is_none(),
        )
    }

    pub(crate) fn record_success(&self, endpoint: &str, requested_model_id: &str) {
        let route = AiExactRoute::new(endpoint, requested_model_id);
        let mut state = self.write_state();
        let prior_route = state.routes.remove(&route);
        state.checked_at_unix = Some(now_unix());
        if prior_route.is_some() {
            info!(
                event = "ai_readiness_transition",
                endpoint = route.endpoint,
                requested_model_id = route.requested_model_id,
                old_route_state = ?prior_route.as_ref().map(|failure| failure.kind),
                new_state = "ready",
                "AI exact route recovered"
            );
        }
    }

    pub(crate) fn record_http_failure(
        &self,
        endpoint: &str,
        requested_model_id: &str,
        status: u16,
        retry_after: Option<Duration>,
    ) {
        self.record_http_failure_at(
            endpoint,
            requested_model_id,
            status,
            retry_after,
            Instant::now(),
            now_unix(),
        );
    }

    fn record_http_failure_at(
        &self,
        endpoint: &str,
        requested_model_id: &str,
        status: u16,
        retry_after: Option<Duration>,
        now: Instant,
        now_unix: u64,
    ) {
        match status {
            401 => self.record_route_failure(
                endpoint,
                requested_model_id,
                RouteFailureKind::Incompatible,
                Some(bounded_cooldown(retry_after)),
                status,
                now,
                now_unix,
            ),
            402 => {
                self.record_account_failure(AccountReadiness::CreditsExhausted, status, now_unix)
            }
            400 => {
                self.write_state().checked_at_unix = Some(now_unix);
            }
            404 => self.record_route_failure(
                endpoint,
                requested_model_id,
                RouteFailureKind::Incompatible,
                Some(bounded_cooldown(retry_after)),
                status,
                now,
                now_unix,
            ),
            429 => self.record_route_failure(
                endpoint,
                requested_model_id,
                RouteFailureKind::RateLimited,
                Some(bounded_cooldown(retry_after)),
                status,
                now,
                now_unix,
            ),
            500..=599 => self.record_route_failure(
                endpoint,
                requested_model_id,
                RouteFailureKind::ProviderUnavailable,
                Some(DEFAULT_ROUTE_COOLDOWN),
                status,
                now,
                now_unix,
            ),
            _ => {}
        }
    }

    pub(crate) fn record_transport_failure(&self, endpoint: &str, requested_model_id: &str) {
        self.record_route_failure(
            endpoint,
            requested_model_id,
            RouteFailureKind::ProviderUnavailable,
            Some(DEFAULT_ROUTE_COOLDOWN),
            0,
            Instant::now(),
            now_unix(),
        );
    }

    #[cfg(test)]
    pub(crate) fn record_probe_success(&self) {
        self.record_probe_result(None);
    }

    pub(crate) fn record_probe_result(&self, limit_remaining: Option<f64>) {
        let mut state = self.write_state();
        let prior = state.account;
        let prior_credits_low = state.credits_low;
        state.account = AccountReadiness::Ready;
        state.credits_low = limit_remaining.is_some_and(|remaining| {
            remaining > 0.0
                && state.low_credit_threshold > 0.0
                && remaining < state.low_credit_threshold
        });
        state.checked_at_unix = Some(now_unix());
        if prior != AccountReadiness::Ready || prior_credits_low != state.credits_low {
            info!(
                event = "ai_readiness_transition",
                old_account_state = ?prior,
                new_state = if state.credits_low { AI_CREDITS_LOW } else { "ready" },
                "AI provider account probe state changed"
            );
        }
    }

    pub(crate) fn record_probe_http_failure(&self, status: u16) {
        match status {
            401 => self.record_account_failure(AccountReadiness::Unauthorized, status, now_unix()),
            402 => {
                self.record_account_failure(AccountReadiness::CreditsExhausted, status, now_unix())
            }
            _ => {
                let mut state = self.write_state();
                state.checked_at_unix = Some(now_unix());
            }
        }
    }

    pub(crate) fn record_probe_credits_exhausted(&self) {
        self.record_account_failure(AccountReadiness::CreditsExhausted, 200, now_unix());
    }

    pub(crate) fn snapshot(&self) -> AiReadinessSnapshot {
        let now = Instant::now();
        let mut state = self.write_state();
        state
            .routes
            .retain(|_, failure| failure.retry_at.is_none_or(|retry_at| retry_at > now));
        let account_reason = state.account.reason_code();
        let route_failure = state.routes.values().next();
        let reason_code = account_reason
            .or(state.credits_low.then_some(AI_CREDITS_LOW))
            .or_else(|| route_failure.map(|failure| failure.kind.reason_code()));
        let retry_at_unix = route_failure.and_then(|failure| failure.retry_at_unix);
        let status = match state.account {
            AccountReadiness::Probing => "probing",
            AccountReadiness::Ready if state.routes.is_empty() && !state.credits_low => "ready",
            AccountReadiness::Ready
            | AccountReadiness::Unauthorized
            | AccountReadiness::CreditsExhausted => "degraded",
        };
        AiReadinessSnapshot {
            status,
            reason_code,
            checked_at_unix: state.checked_at_unix,
            retry_at_unix,
            blocked_route_count: state.routes.len(),
            next_probe_after_secs: if status == "ready" {
                HEALTHY_PROBE_INTERVAL.as_secs()
            } else {
                DEGRADED_PROBE_INTERVAL.as_secs()
            },
        }
    }

    pub(crate) fn recommended_probe_delay(&self) -> Duration {
        let snapshot = self.snapshot();
        Duration::from_secs(snapshot.next_probe_after_secs)
    }

    fn record_account_failure(
        &self,
        next: AccountReadiness,
        http_status: u16,
        checked_at_unix: u64,
    ) {
        let mut state = self.write_state();
        let prior = state.account;
        state.account = next;
        state.credits_low = false;
        state.checked_at_unix = Some(checked_at_unix);
        if prior != next {
            warn!(
                event = "ai_readiness_transition",
                old_account_state = ?prior,
                new_state = next.reason_code().unwrap_or("ready"),
                http_status,
                "AI provider account circuit opened"
            );
        }
    }

    #[allow(clippy::too_many_arguments)]
    fn record_route_failure(
        &self,
        endpoint: &str,
        requested_model_id: &str,
        kind: RouteFailureKind,
        cooldown: Option<Duration>,
        http_status: u16,
        now: Instant,
        now_unix: u64,
    ) {
        let route = AiExactRoute::new(endpoint, requested_model_id);
        let retry_at = cooldown.map(|duration| now + duration);
        let retry_at_unix = cooldown.map(|duration| now_unix.saturating_add(duration.as_secs()));
        let failure = RouteFailure {
            kind,
            retry_at,
            retry_at_unix,
        };
        let mut state = self.write_state();
        state.checked_at_unix = Some(now_unix);
        let prior = state.routes.insert(route.clone(), failure);
        if prior.as_ref().map(|failure| failure.kind) != Some(kind) {
            warn!(
                event = "ai_readiness_transition",
                endpoint = route.endpoint,
                requested_model_id = route.requested_model_id,
                old_state = ?prior.as_ref().map(|failure| failure.kind),
                new_state = kind.reason_code(),
                http_status,
                retry_at_unix,
                "AI exact route circuit opened"
            );
        }
    }

    fn write_state(&self) -> RwLockWriteGuard<'_, AiReadinessState> {
        self.state
            .write()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }
}

fn bounded_cooldown(requested: Option<Duration>) -> Duration {
    requested
        .unwrap_or(DEFAULT_ROUTE_COOLDOWN)
        .max(MIN_ROUTE_COOLDOWN)
        .min(MAX_ROUTE_COOLDOWN)
}

fn now_unix() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn account_probe_auth_and_credit_failures_block_every_exact_route_until_probe_recovers() {
        for (status, reason) in [(401, AI_ACCOUNT_UNAUTHORIZED), (402, AI_CREDITS_EXHAUSTED)] {
            let readiness = AiReadiness::default();
            readiness.record_probe_http_failure(status);
            assert_eq!(
                readiness.gate("images", "provider/model-b").reason_code(),
                Some(reason)
            );
            readiness.record_success("images", "provider/model-b");
            assert_eq!(
                readiness.gate("rerank", "provider/model-c").reason_code(),
                Some(reason),
                "a late in-flight route success must not close an account-wide circuit"
            );
            readiness.record_probe_success();
            assert!(readiness.gate("images", "provider/model-b").is_ready());
        }
    }

    #[test]
    fn exact_route_unauthorized_does_not_poison_other_models_or_endpoints() {
        let readiness = AiReadiness::default();
        readiness.record_http_failure_at(
            "images",
            "openai/gpt-image-1",
            401,
            None,
            Instant::now(),
            100,
        );

        let failed = readiness.gate("images", "openai/gpt-image-1");
        assert_eq!(failed.reason_code(), Some(AI_ROUTE_INCOMPATIBLE));
        assert!(failed.is_retryable_block());
        assert!(readiness
            .gate("images", "openai/gpt-image-1-mini")
            .is_ready());
        assert!(readiness
            .gate("chat/completions", "openai/gpt-chat-latest")
            .is_ready());

        readiness.record_probe_http_failure(401);
        assert_eq!(
            readiness
                .gate("chat/completions", "openai/gpt-chat-latest")
                .reason_code(),
            Some(AI_ACCOUNT_UNAUTHORIZED),
            "only the account probe may open the account-wide unauthorized circuit"
        );
    }

    #[test]
    fn route_success_does_not_end_startup_probing() {
        let readiness = AiReadiness::probing_with_low_credit_threshold(5.0);
        readiness.record_success("chat/completions", "provider/model-a");
        let gate = readiness.gate("chat/completions", "provider/model-a");
        assert_eq!(gate.reason_code(), Some(AI_READINESS_PROBING));
        assert!(gate.is_retryable_block());

        readiness.record_probe_success();
        assert!(readiness
            .gate("chat/completions", "provider/model-a")
            .is_ready());
    }

    #[test]
    fn rate_limit_is_bounded_to_the_exact_route_and_expires() {
        let readiness = AiReadiness::default();
        let started = Instant::now();
        readiness.record_http_failure_at(
            "embeddings",
            "provider/model-a",
            429,
            Some(Duration::from_secs(10)),
            started,
            100,
        );
        assert_eq!(
            readiness
                .gate_at(
                    "embeddings",
                    "provider/model-a",
                    started + Duration::from_secs(5),
                    105,
                )
                .reason_code(),
            Some(AI_RATE_LIMITED)
        );
        assert!(readiness
            .gate_at(
                "embeddings",
                "provider/model-b",
                started + Duration::from_secs(5),
                105,
            )
            .is_ready());
        assert!(readiness
            .gate_at(
                "embeddings",
                "provider/model-a",
                started + Duration::from_secs(10),
                110,
            )
            .is_ready());
    }

    #[test]
    fn server_and_incompatible_route_failures_recover_after_cooldown() {
        let readiness = AiReadiness::default();
        let started = Instant::now();
        readiness.record_http_failure_at("rerank", "provider/transient", 503, None, started, 100);
        readiness.record_http_failure_at(
            "rerank",
            "provider/incompatible",
            404,
            None,
            started,
            100,
        );
        assert!(readiness
            .gate_at(
                "rerank",
                "provider/transient",
                started + DEFAULT_ROUTE_COOLDOWN,
                130,
            )
            .is_ready());
        assert!(readiness
            .gate_at(
                "rerank",
                "provider/incompatible",
                started + DEFAULT_ROUTE_COOLDOWN,
                130,
            )
            .is_ready());
    }

    #[test]
    fn request_specific_bad_request_does_not_open_a_shared_route_circuit() {
        let readiness = AiReadiness::default();
        readiness.record_http_failure_at(
            "chat/completions",
            "provider/model",
            400,
            None,
            Instant::now(),
            100,
        );
        assert!(readiness
            .gate("chat/completions", "provider/model")
            .is_ready());
    }

    #[test]
    fn retry_after_is_clamped_to_the_operational_window() {
        assert_eq!(bounded_cooldown(Some(Duration::ZERO)), MIN_ROUTE_COOLDOWN);
        assert_eq!(
            bounded_cooldown(Some(Duration::from_secs(3_600))),
            MAX_ROUTE_COOLDOWN
        );
    }

    #[test]
    fn low_credit_is_sanitized_warning_only_and_recovers_on_the_next_probe() {
        let readiness = AiReadiness::ready_with_low_credit_threshold(5.0);
        readiness.record_probe_result(Some(2.5));
        let warning = readiness.snapshot();
        assert_eq!(warning.status, "degraded");
        assert_eq!(warning.reason_code, Some(AI_CREDITS_LOW));
        assert_eq!(warning.next_probe_after_secs, 60);
        assert!(readiness.gate("embeddings", "provider/model").is_ready());

        readiness.record_probe_result(Some(8.0));
        let recovered = readiness.snapshot();
        assert_eq!(recovered.status, "ready");
        assert_eq!(recovered.reason_code, None);
        assert_eq!(recovered.next_probe_after_secs, 300);
    }
}
