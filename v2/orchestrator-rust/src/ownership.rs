use super::*;

#[derive(Clone, Debug, Default)]
pub(super) struct AccessContext {
    pub(super) owner_wallet_address: Option<String>,
    pub(super) owned_card_ids: BTreeSet<String>,
    pub(super) granted_entitlement_ids: BTreeSet<String>,
    pub(super) owned_box_ids: BTreeSet<String>,
    pub(super) unopened_pack_ids: BTreeSet<String>,
    pub(super) signed_wallet_session: bool,
    pub(super) unsigned_wallet_claim: bool,
}

#[derive(Clone, Debug, Default, Eq, PartialEq)]
pub(super) struct OwnershipIndex {
    pub(super) wallets: Vec<WalletCardSet>,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub(super) struct WalletCardSet {
    pub(super) wallet_address: String,
    pub(super) card_ids: BTreeSet<String>,
    pub(super) grant_ids: BTreeSet<String>,
    pub(super) box_ids: BTreeSet<String>,
    pub(super) pack_ids: BTreeSet<String>,
}

#[derive(Clone, Debug, Default)]
pub(super) struct OwnershipFeedConfig {
    pub(super) inline_feed: Option<String>,
    pub(super) path_feed: Option<PathBuf>,
    pub(super) remote_url: Option<String>,
    pub(super) remote_bearer: Option<String>,
    pub(super) refresh_every: Option<Duration>,
}

#[derive(Clone, Debug, Default)]
pub(super) struct OwnershipFeedHealth {
    pub(super) last_attempt_at_unix: Option<u64>,
    pub(super) last_success_at_unix: Option<u64>,
    pub(super) consecutive_failures: u32,
    pub(super) last_error_code: Option<String>,
}

impl OwnershipFeedHealth {
    pub(super) fn record_success(&mut self) {
        let now = now_unix_secs();
        self.last_attempt_at_unix = Some(now);
        self.last_success_at_unix = Some(now);
        self.consecutive_failures = 0;
        self.last_error_code = None;
    }

    pub(super) fn record_failure(&mut self, error: &io::Error) {
        self.last_attempt_at_unix = Some(now_unix_secs());
        self.consecutive_failures = self.consecutive_failures.saturating_add(1);
        self.last_error_code = Some(ownership_feed_error_code(error));
    }
}

impl OwnershipFeedConfig {
    pub(super) fn from_env() -> Self {
        let inline_feed = std::env::var("COSYWORLD_ENTITLEMENT_FEED")
            .ok()
            .or_else(|| std::env::var("COSYWORLD_RUBY_HIGH_WALLET_CARDS").ok())
            .filter(|value| !value.trim().is_empty());
        let path_feed = std::env::var("COSYWORLD_ENTITLEMENT_FEED_PATH")
            .ok()
            .or_else(|| std::env::var("COSYWORLD_RUBY_HIGH_WALLET_CARDS_PATH").ok())
            .map(PathBuf::from);
        let remote_url = std::env::var("COSYWORLD_ENTITLEMENT_FEED_URL")
            .ok()
            .or_else(|| std::env::var("COSYWORLD_RUBY_HIGH_WALLET_CARDS_URL").ok())
            .filter(|value| !value.trim().is_empty());
        let remote_bearer = std::env::var("COSYWORLD_ENTITLEMENT_FEED_BEARER")
            .ok()
            .or_else(|| std::env::var("COSYWORLD_RUBY_HIGH_WALLET_CARDS_BEARER").ok())
            .filter(|value| !value.trim().is_empty());
        let refresh_every = ownership_refresh_interval(remote_url.is_some(), path_feed.is_some());
        Self {
            inline_feed,
            path_feed,
            remote_url,
            remote_bearer,
            refresh_every,
        }
    }

    pub(super) async fn load_best_effort_with_health(
        &self,
    ) -> (OwnershipIndex, OwnershipFeedHealth) {
        let mut index = OwnershipIndex::default();
        let mut health = OwnershipFeedHealth::default();
        if let Some(value) = self.inline_feed.as_deref() {
            index.merge(OwnershipIndex::parse(value));
        }
        if let Some(path) = self.path_feed.as_deref() {
            match fs::read_to_string(path) {
                Ok(value) => index.merge(OwnershipIndex::parse(&value)),
                Err(error) => warn!(
                    "failed to read entitlement provider feed {}: {}",
                    path.display(),
                    error
                ),
            }
        }
        if let Some(url) = self.remote_url.as_deref() {
            match OwnershipIndex::fetch_remote(url, self.remote_bearer.as_deref()).await {
                Ok(remote) => {
                    index.merge(remote);
                    health.record_success();
                }
                Err(error) => {
                    health.record_failure(&error);
                    warn!("failed to fetch entitlement provider feed {url}: {error}");
                }
            }
        }
        (index, health)
    }

    pub(super) async fn load_best_effort(&self) -> OwnershipIndex {
        self.load_best_effort_with_health().await.0
    }

    pub(super) async fn load_strict(&self) -> io::Result<OwnershipIndex> {
        let mut index = OwnershipIndex::default();
        if let Some(value) = self.inline_feed.as_deref() {
            index.merge(OwnershipIndex::parse(value));
        }
        if let Some(path) = self.path_feed.as_deref() {
            index.merge(OwnershipIndex::parse(&fs::read_to_string(path)?));
        }
        if let Some(url) = self.remote_url.as_deref() {
            index.merge(OwnershipIndex::fetch_remote(url, self.remote_bearer.as_deref()).await?);
        }
        Ok(index)
    }
}

pub(super) fn ownership_feed_error_code(error: &io::Error) -> String {
    let message = error.to_string().to_ascii_lowercase();
    for status in [401, 403, 404, 408, 429, 500, 502, 503, 504] {
        if message.contains(&format!("http {status}")) {
            return format!("http_{status}");
        }
    }
    if message.contains("timed out") || message.contains("timeout") {
        "timeout".to_string()
    } else if message.contains("json") || message.contains("decode") {
        "invalid_response".to_string()
    } else {
        "request_failed".to_string()
    }
}

pub(super) async fn load_base_ownership_index(state: &AppState) -> io::Result<OwnershipIndex> {
    if state.deployment.profile.is_production() {
        state.ownership_feed.load_strict().await
    } else {
        Ok(state.ownership_feed.load_best_effort().await)
    }
}

pub(super) async fn load_effective_ownership_index_strict(
    state: &AppState,
) -> io::Result<OwnershipIndex> {
    let mut ownership = state.ownership_feed.load_strict().await?;
    if let Some(path) = state.event_store_path.as_deref() {
        let reconciliation = record_economy_reconciliation(path, &ownership, "refresh")?;
        if reconciliation.anomaly_count > 0 {
            warn!(
                "economy reconciliation found {} anomal{} during ownership refresh",
                reconciliation.anomaly_count,
                if reconciliation.anomaly_count == 1 {
                    "y"
                } else {
                    "ies"
                }
            );
        }
        ownership.merge(load_receipt_ownership_index(path)?);
    }
    Ok(ownership)
}

impl OwnershipIndex {
    pub(super) async fn fetch_remote(url: &str, bearer: Option<&str>) -> io::Result<Self> {
        let mut request = reqwest::Client::builder()
            .timeout(Duration::from_secs(5))
            .build()
            .map_err(io::Error::other)?
            .get(url);
        if let Some(token) = bearer.map(str::trim).filter(|value| !value.is_empty()) {
            request = request.bearer_auth(token);
        }

        let response = request.send().await.map_err(io::Error::other)?;
        let status = response.status();
        if !status.is_success() {
            return Err(io::Error::other(format!(
                "ownership feed returned HTTP {status}"
            )));
        }
        let body = response.text().await.map_err(io::Error::other)?;
        Ok(Self::parse(&body))
    }

    pub(super) fn parse(value: &str) -> Self {
        let trimmed = value.trim();
        if matches!(trimmed.as_bytes().first(), Some(b'[' | b'{')) {
            if let Some(index) = Self::parse_json(trimmed) {
                return index;
            }
        }

        let wallets = value
            .split(['\n', '|', ';'])
            .filter_map(|entry| {
                let (wallet, cards) = entry.split_once(':')?;
                let wallet_address = wallet.trim();
                if wallet_address.is_empty() {
                    return None;
                }
                Some(WalletCardSet {
                    wallet_address: wallet_address.to_ascii_lowercase(),
                    card_ids: parse_card_ids(cards).into_iter().collect(),
                    grant_ids: BTreeSet::new(),
                    box_ids: BTreeSet::new(),
                    pack_ids: BTreeSet::new(),
                })
            })
            .filter(|wallet| !wallet.card_ids.is_empty())
            .collect();
        Self { wallets }
    }

    pub(super) fn parse_json(value: &str) -> Option<Self> {
        let root: serde_json::Value = serde_json::from_str(value).ok()?;
        let mut index = Self::default();
        match root {
            serde_json::Value::Array(entries) => {
                for entry in entries {
                    let serde_json::Value::Object(map) = entry else {
                        continue;
                    };
                    let wallet = first_json_string(
                        &map,
                        &[
                            "walletAddress",
                            "wallet_address",
                            "wallet",
                            "ownerWalletAddress",
                        ],
                    );
                    let cards = first_json_cards(
                        &map,
                        &[
                            "cardIds",
                            "card_ids",
                            "cards",
                            "ownedCardIds",
                            "hallPassCards",
                        ],
                    );
                    let cards = if cards.is_empty() {
                        json_card_ids(&serde_json::Value::Object(map.clone()))
                    } else {
                        cards
                    };
                    let boxes = first_json_assets(
                        &map,
                        &["boxes", "woodenBoxes", "wooden_boxes", "boxIds", "box_ids"],
                        &[
                            "boxAssetAddress",
                            "box_asset_address",
                            "assetAddress",
                            "asset_address",
                            "assetId",
                            "asset_id",
                            "mint",
                            "address",
                            "id",
                        ],
                    );
                    let packs = first_json_assets(
                        &map,
                        &[
                            "packs",
                            "avatarPacks",
                            "avatar_packs",
                            "packIds",
                            "pack_ids",
                        ],
                        &[
                            "packAssetAddress",
                            "pack_asset_address",
                            "assetAddress",
                            "asset_address",
                            "assetId",
                            "asset_id",
                            "mint",
                            "address",
                            "id",
                        ],
                    );
                    let grants = first_json_assets(
                        &map,
                        &["grantIds", "grant_ids", "entitlements", "grants"],
                        &["grantId", "grant_id", "id"],
                    );
                    index.add_wallet_assets(wallet.as_deref(), cards, grants, boxes, packs);
                }
            }
            serde_json::Value::Object(map) => {
                if let Some(wallets) = map.get("wallets").and_then(|value| value.as_array()) {
                    for entry in wallets {
                        let serde_json::Value::Object(map) = entry else {
                            continue;
                        };
                        let wallet = first_json_string(
                            map,
                            &[
                                "walletAddress",
                                "wallet_address",
                                "wallet",
                                "ownerWalletAddress",
                            ],
                        );
                        let cards = first_json_cards(
                            map,
                            &[
                                "cardIds",
                                "card_ids",
                                "cards",
                                "ownedCardIds",
                                "hallPassCards",
                            ],
                        );
                        let boxes = first_json_assets(
                            map,
                            &["boxes", "woodenBoxes", "wooden_boxes", "boxIds", "box_ids"],
                            &[
                                "boxAssetAddress",
                                "box_asset_address",
                                "assetAddress",
                                "asset_address",
                                "assetId",
                                "asset_id",
                                "mint",
                                "address",
                                "id",
                            ],
                        );
                        let packs = first_json_assets(
                            map,
                            &[
                                "packs",
                                "avatarPacks",
                                "avatar_packs",
                                "packIds",
                                "pack_ids",
                            ],
                            &[
                                "packAssetAddress",
                                "pack_asset_address",
                                "assetAddress",
                                "asset_address",
                                "assetId",
                                "asset_id",
                                "mint",
                                "address",
                                "id",
                            ],
                        );
                        let grants = first_json_assets(
                            map,
                            &["grantIds", "grant_ids", "entitlements", "grants"],
                            &["grantId", "grant_id", "id"],
                        );
                        index.add_wallet_assets(wallet.as_deref(), cards, grants, boxes, packs);
                    }
                } else {
                    for (wallet, value) in map {
                        let (cards, grants, boxes, packs) = match value {
                            serde_json::Value::Object(map) => (
                                first_json_cards(
                                    &map,
                                    &[
                                        "cardIds",
                                        "card_ids",
                                        "cards",
                                        "ownedCardIds",
                                        "hallPassCards",
                                    ],
                                ),
                                first_json_assets(
                                    &map,
                                    &["grantIds", "grant_ids", "entitlements", "grants"],
                                    &["grantId", "grant_id", "id"],
                                ),
                                first_json_assets(
                                    &map,
                                    &["boxes", "woodenBoxes", "wooden_boxes", "boxIds", "box_ids"],
                                    &[
                                        "boxAssetAddress",
                                        "box_asset_address",
                                        "assetAddress",
                                        "asset_address",
                                        "assetId",
                                        "asset_id",
                                        "mint",
                                        "address",
                                        "id",
                                    ],
                                ),
                                first_json_assets(
                                    &map,
                                    &[
                                        "packs",
                                        "avatarPacks",
                                        "avatar_packs",
                                        "packIds",
                                        "pack_ids",
                                    ],
                                    &[
                                        "packAssetAddress",
                                        "pack_asset_address",
                                        "assetAddress",
                                        "asset_address",
                                        "assetId",
                                        "asset_id",
                                        "mint",
                                        "address",
                                        "id",
                                    ],
                                ),
                            ),
                            other => (
                                json_card_ids(&other),
                                BTreeSet::new(),
                                BTreeSet::new(),
                                BTreeSet::new(),
                            ),
                        };
                        index.add_wallet_assets(Some(wallet.as_str()), cards, grants, boxes, packs);
                    }
                }
            }
            _ => return None,
        }
        Some(index)
    }

    pub(super) fn merge(&mut self, other: OwnershipIndex) {
        for wallet in other.wallets {
            let Some(existing) = self
                .wallets
                .iter_mut()
                .find(|item| item.wallet_address == wallet.wallet_address)
            else {
                self.wallets.push(wallet);
                continue;
            };
            existing.card_ids.extend(wallet.card_ids);
            existing.grant_ids.extend(wallet.grant_ids);
            existing.box_ids.extend(wallet.box_ids);
            existing.pack_ids.extend(wallet.pack_ids);
        }
    }

    pub(super) fn add_wallet_assets(
        &mut self,
        wallet_address: Option<&str>,
        card_ids: BTreeSet<String>,
        grant_ids: BTreeSet<String>,
        box_ids: BTreeSet<String>,
        pack_ids: BTreeSet<String>,
    ) {
        let Some(wallet_address) = wallet_address
            .map(str::trim)
            .filter(|value| !value.is_empty())
        else {
            return;
        };
        if card_ids.is_empty() && grant_ids.is_empty() && box_ids.is_empty() && pack_ids.is_empty()
        {
            return;
        }
        let normalized = wallet_address.to_ascii_lowercase();
        let Some(existing) = self
            .wallets
            .iter_mut()
            .find(|item| item.wallet_address == normalized)
        else {
            self.wallets.push(WalletCardSet {
                wallet_address: normalized,
                card_ids,
                grant_ids,
                box_ids,
                pack_ids,
            });
            return;
        };
        existing.card_ids.extend(card_ids);
        existing.grant_ids.extend(grant_ids);
        existing.box_ids.extend(box_ids);
        existing.pack_ids.extend(pack_ids);
    }

    pub(super) fn cards_for_wallet(&self, wallet_address: &str) -> BTreeSet<String> {
        let normalized = wallet_address.trim().to_ascii_lowercase();
        if normalized.is_empty() {
            return BTreeSet::new();
        }

        self.wallets
            .iter()
            .filter(|wallet| wallet.wallet_address == normalized)
            .flat_map(|wallet| wallet.card_ids.iter().cloned())
            .collect()
    }

    pub(super) fn boxes_for_wallet(&self, wallet_address: &str) -> BTreeSet<String> {
        let normalized = wallet_address.trim().to_ascii_lowercase();
        if normalized.is_empty() {
            return BTreeSet::new();
        }

        self.wallets
            .iter()
            .filter(|wallet| wallet.wallet_address == normalized)
            .flat_map(|wallet| wallet.box_ids.iter().cloned())
            .collect()
    }

    pub(super) fn grants_for_wallet(&self, wallet_address: &str) -> BTreeSet<String> {
        let normalized = wallet_address.trim().to_ascii_lowercase();
        if normalized.is_empty() {
            return BTreeSet::new();
        }

        self.wallets
            .iter()
            .filter(|wallet| wallet.wallet_address == normalized)
            .flat_map(|wallet| wallet.grant_ids.iter().cloned())
            .collect()
    }

    pub(super) fn packs_for_wallet(&self, wallet_address: &str) -> BTreeSet<String> {
        let normalized = wallet_address.trim().to_ascii_lowercase();
        if normalized.is_empty() {
            return BTreeSet::new();
        }

        self.wallets
            .iter()
            .filter(|wallet| wallet.wallet_address == normalized)
            .flat_map(|wallet| wallet.pack_ids.iter().cloned())
            .collect()
    }

    pub(super) fn apply_box_burn_receipt(
        &mut self,
        wallet_address: &str,
        box_asset_address: &str,
        pack_id: &str,
    ) {
        let normalized = wallet_address.trim().to_ascii_lowercase();
        if normalized.is_empty() || box_asset_address.trim().is_empty() || pack_id.trim().is_empty()
        {
            return;
        }
        let Some(wallet) = self
            .wallets
            .iter_mut()
            .find(|wallet| wallet.wallet_address == normalized)
        else {
            self.wallets.push(WalletCardSet {
                wallet_address: normalized,
                card_ids: BTreeSet::new(),
                grant_ids: BTreeSet::new(),
                box_ids: BTreeSet::new(),
                pack_ids: [pack_id.to_string()].into_iter().collect(),
            });
            return;
        };
        wallet.box_ids.remove(box_asset_address);
        wallet.pack_ids.insert(pack_id.to_string());
    }

    pub(super) fn apply_pack_opening(
        &mut self,
        wallet_address: &str,
        pack_id: &str,
        card_ids: &[String],
    ) {
        let normalized = wallet_address.trim().to_ascii_lowercase();
        if normalized.is_empty() || pack_id.trim().is_empty() {
            return;
        }
        let Some(wallet) = self
            .wallets
            .iter_mut()
            .find(|wallet| wallet.wallet_address == normalized)
        else {
            self.wallets.push(WalletCardSet {
                wallet_address: normalized,
                card_ids: card_ids.iter().cloned().collect(),
                grant_ids: BTreeSet::new(),
                box_ids: BTreeSet::new(),
                pack_ids: BTreeSet::new(),
            });
            return;
        };
        wallet.pack_ids.remove(pack_id);
        wallet.card_ids.extend(card_ids.iter().cloned());
    }

    pub(super) fn wallet_count(&self) -> usize {
        self.wallets.len()
    }
}

impl AccessContext {
    pub(super) fn for_linked_actor_receipt(state: &AppState, actor_id: u64) -> Self {
        let linked_wallets = state
            .wallet_actor_links
            .lock()
            .map(|links| {
                links
                    .iter()
                    .filter(|(_, linked_actor_id)| **linked_actor_id == actor_id)
                    .map(|(wallet, _)| wallet.clone())
                    .collect::<Vec<_>>()
            })
            .unwrap_or_default();
        let Ok(ownership) = state.ownership_index.try_read() else {
            return Self::default();
        };
        let mut access = Self {
            owner_wallet_address: linked_wallets.first().cloned(),
            signed_wallet_session: !linked_wallets.is_empty(),
            ..Self::default()
        };
        for wallet in linked_wallets {
            access
                .owned_card_ids
                .extend(ownership.cards_for_wallet(&wallet));
            access
                .granted_entitlement_ids
                .extend(ownership.grants_for_wallet(&wallet));
            access
                .owned_box_ids
                .extend(ownership.boxes_for_wallet(&wallet));
            access
                .unopened_pack_ids
                .extend(ownership.packs_for_wallet(&wallet));
        }
        access
            .granted_entitlement_ids
            .retain(|grant_id| seed_entitlement_grant(grant_id).is_some());
        access
            .granted_entitlement_ids
            .extend(entitlement_grants_for_assets(&access.owned_card_ids));
        access
    }

    pub(super) fn from_query(
        query: &StateQuery,
        ownership: &OwnershipIndex,
        trust_client_card_ids: bool,
        wallet_sessions: &StdMutex<WalletSessions>,
        allow_unsigned_wallet_claims: bool,
    ) -> Self {
        Self::from_request_parts(
            query.wallet_session.as_deref(),
            query.wallet_address.as_deref().or(query.wallet.as_deref()),
            [
                trust_client_card_ids
                    .then_some(query.owned_card_ids.as_deref())
                    .flatten(),
                trust_client_card_ids
                    .then_some(query.cards.as_deref())
                    .flatten(),
            ],
            ownership,
            wallet_sessions,
            allow_unsigned_wallet_claims,
        )
    }

    pub(super) fn from_move_request(
        payload: &MoveRequest,
        ownership: &OwnershipIndex,
        trust_client_card_ids: bool,
        wallet_sessions: &StdMutex<WalletSessions>,
        allow_unsigned_wallet_claims: bool,
    ) -> Self {
        Self::from_request_parts(
            payload.wallet_session.as_deref(),
            payload
                .wallet_address
                .as_deref()
                .or(payload.wallet.as_deref()),
            [
                trust_client_card_ids
                    .then_some(payload.owned_card_ids.as_deref())
                    .flatten(),
                trust_client_card_ids
                    .then_some(payload.cards.as_deref())
                    .flatten(),
            ],
            ownership,
            wallet_sessions,
            allow_unsigned_wallet_claims,
        )
    }

    pub(super) fn from_command_request(
        payload: &CommandRequest,
        ownership: &OwnershipIndex,
        trust_client_card_ids: bool,
        wallet_sessions: &StdMutex<WalletSessions>,
        allow_unsigned_wallet_claims: bool,
    ) -> Self {
        Self::from_request_parts(
            payload.wallet_session.as_deref(),
            payload
                .wallet_address
                .as_deref()
                .or(payload.wallet.as_deref()),
            [
                trust_client_card_ids
                    .then_some(payload.owned_card_ids.as_deref())
                    .flatten(),
                trust_client_card_ids
                    .then_some(payload.cards.as_deref())
                    .flatten(),
            ],
            ownership,
            wallet_sessions,
            allow_unsigned_wallet_claims,
        )
    }

    pub(super) fn from_events_query(
        query: &EventsQuery,
        ownership: &OwnershipIndex,
        trust_client_card_ids: bool,
        wallet_sessions: &StdMutex<WalletSessions>,
        allow_unsigned_wallet_claims: bool,
    ) -> Self {
        Self::from_request_parts(
            query.wallet_session.as_deref(),
            query.wallet_address.as_deref().or(query.wallet.as_deref()),
            [
                trust_client_card_ids
                    .then_some(query.owned_card_ids.as_deref())
                    .flatten(),
                trust_client_card_ids
                    .then_some(query.cards.as_deref())
                    .flatten(),
            ],
            ownership,
            wallet_sessions,
            allow_unsigned_wallet_claims,
        )
    }

    pub(super) fn from_request_parts<'a>(
        wallet_session: Option<&'a str>,
        wallet_claim: Option<&'a str>,
        owned_sources: impl IntoIterator<Item = Option<&'a str>>,
        ownership: &OwnershipIndex,
        wallet_sessions: &StdMutex<WalletSessions>,
        allow_unsigned_wallet_claims: bool,
    ) -> Self {
        let signed_wallets = wallet_session
            .and_then(|token| wallets_for_session(wallet_sessions, token))
            .unwrap_or_default();
        let signed_wallet = signed_wallets.first().cloned();
        let unsigned_wallet = signed_wallet
            .is_none()
            .then(|| {
                wallet_claim
                    .map(str::trim)
                    .filter(|value| !value.is_empty())
                    .map(ToString::to_string)
            })
            .flatten();
        let owner_wallet_address = signed_wallet.clone().or_else(|| {
            allow_unsigned_wallet_claims
                .then_some(unsigned_wallet.clone())
                .flatten()
        });
        let mut owned_card_ids = BTreeSet::new();

        for wallet in &signed_wallets {
            owned_card_ids.extend(ownership.cards_for_wallet(wallet));
        }
        if signed_wallets.is_empty() {
            if let Some(wallet) = owner_wallet_address.as_deref() {
                owned_card_ids.extend(ownership.cards_for_wallet(wallet));
            }
        }
        let mut owned_box_ids = BTreeSet::new();
        let mut unopened_pack_ids = BTreeSet::new();
        let mut granted_entitlement_ids = BTreeSet::new();
        for wallet in &signed_wallets {
            owned_box_ids.extend(ownership.boxes_for_wallet(wallet));
            unopened_pack_ids.extend(ownership.packs_for_wallet(wallet));
            granted_entitlement_ids.extend(ownership.grants_for_wallet(wallet));
        }
        if signed_wallets.is_empty() {
            if let Some(wallet) = owner_wallet_address.as_deref() {
                owned_box_ids.extend(ownership.boxes_for_wallet(wallet));
                unopened_pack_ids.extend(ownership.packs_for_wallet(wallet));
                granted_entitlement_ids.extend(ownership.grants_for_wallet(wallet));
            }
        }

        for source in owned_sources.into_iter().flatten() {
            for card_id in parse_card_ids(source) {
                owned_card_ids.insert(card_id);
            }
        }
        granted_entitlement_ids.retain(|grant_id| seed_entitlement_grant(grant_id).is_some());
        granted_entitlement_ids.extend(entitlement_grants_for_assets(&owned_card_ids));

        Self {
            owner_wallet_address,
            owned_card_ids,
            granted_entitlement_ids,
            owned_box_ids,
            unopened_pack_ids,
            signed_wallet_session: signed_wallet.is_some(),
            unsigned_wallet_claim: signed_wallet.is_none()
                && allow_unsigned_wallet_claims
                && unsigned_wallet.is_some(),
        }
    }

    #[cfg(test)]
    pub(super) fn from_parts<'a>(
        wallet: Option<&'a str>,
        owned_sources: impl IntoIterator<Item = Option<&'a str>>,
        ownership: &OwnershipIndex,
    ) -> Self {
        let owner_wallet_address = wallet
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(ToString::to_string);
        let mut owned_card_ids = BTreeSet::new();

        if let Some(wallet) = owner_wallet_address.as_deref() {
            owned_card_ids.extend(ownership.cards_for_wallet(wallet));
        }
        let mut owned_box_ids = BTreeSet::new();
        let mut unopened_pack_ids = BTreeSet::new();
        let mut granted_entitlement_ids = BTreeSet::new();
        if let Some(wallet) = owner_wallet_address.as_deref() {
            owned_box_ids.extend(ownership.boxes_for_wallet(wallet));
            unopened_pack_ids.extend(ownership.packs_for_wallet(wallet));
            granted_entitlement_ids.extend(ownership.grants_for_wallet(wallet));
        }

        for source in owned_sources.into_iter().flatten() {
            for card_id in parse_card_ids(source) {
                owned_card_ids.insert(card_id);
            }
        }
        granted_entitlement_ids.retain(|grant_id| seed_entitlement_grant(grant_id).is_some());
        granted_entitlement_ids.extend(entitlement_grants_for_assets(&owned_card_ids));

        Self {
            owner_wallet_address,
            owned_card_ids,
            granted_entitlement_ids,
            owned_box_ids,
            unopened_pack_ids,
            signed_wallet_session: false,
            unsigned_wallet_claim: false,
        }
    }

    pub(super) fn owns_card(&self, card_id: &str) -> bool {
        self.owned_card_ids.contains(card_id)
    }

    pub(super) fn has_grant(&self, grant_id: &str) -> bool {
        self.granted_entitlement_ids.contains(grant_id)
    }
}

impl AppState {
    pub(super) async fn ownership_snapshot(&self) -> OwnershipIndex {
        self.ownership_index.read().await.clone()
    }
}

impl RuntimeWorld {
    pub(super) fn apply_wallet_overlap_placements(
        &mut self,
        ownership: &OwnershipIndex,
        day_index: u64,
    ) {
        let _ = self.apply_wallet_overlap_placements_inner(ownership, day_index, false);
    }

    pub(super) fn apply_wallet_overlap_placements_with_events(
        &mut self,
        ownership: &OwnershipIndex,
        day_index: u64,
    ) -> Vec<EventView> {
        self.apply_wallet_overlap_placements_inner(ownership, day_index, true)
    }

    pub(super) fn apply_wallet_overlap_placements_inner(
        &mut self,
        ownership: &OwnershipIndex,
        day_index: u64,
        emit_events: bool,
    ) -> Vec<EventView> {
        let mut events = Vec::new();
        for (actor_id, actor_card_id) in [
            (1001, "rati"),
            (1002, "cosy-whiskerwind"),
            (1003, "cosy-skull"),
        ] {
            let location_id =
                actor_location_from_overlap(actor_card_id, ownership, day_index).unwrap_or(1);
            if let Some(event) = self.place_actor_location(actor_id, location_id, emit_events) {
                events.push(event);
            }
        }
        events
    }
}

pub(super) fn actor_location_from_overlap(
    actor_card_id: &str,
    ownership: &OwnershipIndex,
    day_index: u64,
) -> Option<u64> {
    let mut scores: BTreeMap<u64, u32> = BTreeMap::new();

    for wallet in &ownership.wallets {
        if !wallet.card_ids.contains(actor_card_id) {
            continue;
        }

        let mut contributed_locations = BTreeSet::new();
        for card_id in &wallet.card_ids {
            if let Some(location_id) = location_id_for_card_id(card_id) {
                contributed_locations.insert(location_id);
            }
        }

        // Each wallet contributes its unique location set once; duplicate card copies do not
        // weight resident placement unless we choose that economy explicitly later.
        for location_id in contributed_locations {
            *scores.entry(location_id).or_insert(0) += 1;
        }
    }

    let max_score = scores.values().copied().max()?;
    let candidates: Vec<u64> = scores
        .into_iter()
        .filter_map(|(location_id, score)| (score == max_score).then_some(location_id))
        .collect();
    if candidates.is_empty() {
        return None;
    }
    Some(candidates[(day_index as usize) % candidates.len()])
}

pub(super) fn ownership_refresh_interval(
    has_remote_feed: bool,
    _has_path_feed: bool,
) -> Option<Duration> {
    if let Ok(value) = std::env::var("COSYWORLD_ENTITLEMENT_FEED_REFRESH_SECS")
        .or_else(|_| std::env::var("COSYWORLD_RUBY_HIGH_WALLET_CARDS_REFRESH_SECS"))
    {
        let secs = value.trim().parse::<u64>().unwrap_or(0);
        return (secs > 0).then(|| Duration::from_secs(secs.max(5)));
    }
    has_remote_feed.then_some(Duration::from_secs(60))
}

pub(super) fn start_ownership_refresh_scheduler(state: AppState) {
    let Some(refresh_every) = state.ownership_feed.refresh_every else {
        return;
    };
    tokio::spawn(async move {
        let mut next_refresh = refresh_every;
        loop {
            tokio::time::sleep(next_refresh).await;
            let failures = match refresh_ownership_index_once(&state).await {
                Ok(_) => 0,
                Err(error) => {
                    warn!(
                        "entitlement provider refresh failed; keeping last good feed: {}",
                        error
                    );
                    state
                        .ownership_feed_health
                        .lock()
                        .map(|health| health.consecutive_failures)
                        .unwrap_or(1)
                }
            };
            next_refresh = ownership_refresh_delay(refresh_every, failures);
        }
    });
}

pub(super) async fn refresh_ownership_index_once(state: &AppState) -> io::Result<bool> {
    let refreshed = match load_effective_ownership_index_strict(state).await {
        Ok(refreshed) => {
            if state.ownership_feed.remote_url.is_some() {
                if let Ok(mut health) = state.ownership_feed_health.lock() {
                    health.record_success();
                }
            }
            refreshed
        }
        Err(error) => {
            if state.ownership_feed.remote_url.is_some() {
                if let Ok(mut health) = state.ownership_feed_health.lock() {
                    health.record_failure(&error);
                }
            }
            return Err(error);
        }
    };
    let changed = {
        let mut ownership = state.ownership_index.write().await;
        if *ownership == refreshed {
            false
        } else {
            *ownership = refreshed.clone();
            true
        }
    };

    let mut runtime = state.inner.lock().await;
    let placement_rotation = placement_rotation_index_for_runtime(&runtime);
    let placement_events =
        runtime.apply_wallet_overlap_placements_with_events(&refreshed, placement_rotation);
    persist_runtime(state, &runtime);
    persist_events(state, &placement_events);
    if !placement_events.is_empty() {
        state.mark_activity();
    }
    drop(runtime);

    if !placement_events.is_empty() {
        broadcast_events(state, &placement_events);
    }

    if changed {
        info!(
            "refreshed entitlement provider feed: {} wallet(s)",
            refreshed.wallet_count()
        );
    }
    Ok(changed || !placement_events.is_empty())
}

pub(super) fn ownership_refresh_delay(base: Duration, consecutive_failures: u32) -> Duration {
    const MAX_BACKOFF: Duration = Duration::from_secs(15 * 60);
    if consecutive_failures == 0 {
        return base;
    }
    let multiplier = 1_u32 << consecutive_failures.min(4);
    base.saturating_mul(multiplier).min(MAX_BACKOFF)
}

pub(super) fn load_receipt_ownership_index(path: &Path) -> io::Result<OwnershipIndex> {
    init_event_store(path)?;
    let conn = open_event_store(path)?;
    let mut index = OwnershipIndex::default();

    {
        let mut stmt = conn
            .prepare(
                "SELECT owner_wallet_address, box_asset_address, pack_id
                 FROM wooden_box_receipts
                 WHERE status = 'burned'",
            )
            .map_err(sqlite_error)?;
        let rows = stmt
            .query_map([], |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                ))
            })
            .map_err(sqlite_error)?;
        for row in rows {
            let (wallet, box_id, pack_id) = row.map_err(sqlite_error)?;
            index.add_wallet_assets(
                Some(wallet.as_str()),
                BTreeSet::new(),
                BTreeSet::new(),
                BTreeSet::new(),
                [pack_id.clone()].into_iter().collect(),
            );
            index.apply_box_burn_receipt(&wallet, &box_id, &pack_id);
        }
    }

    {
        let mut stmt = conn
            .prepare(
                "SELECT owner_wallet_address, pack_id, card_ids_json FROM avatar_pack_openings",
            )
            .map_err(sqlite_error)?;
        let rows = stmt
            .query_map([], |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                ))
            })
            .map_err(sqlite_error)?;
        for row in rows {
            let (wallet, pack_id, card_ids_json) = row.map_err(sqlite_error)?;
            let card_ids: Vec<String> = serde_json::from_str(&card_ids_json).unwrap_or_default();
            index.apply_pack_opening(&wallet, &pack_id, &card_ids);
        }
    }

    Ok(index)
}
