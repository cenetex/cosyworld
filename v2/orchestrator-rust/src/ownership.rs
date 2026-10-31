use super::*;

#[derive(Clone, Debug, Default)]
pub(super) struct AccessContext {
    pub(super) owner_wallet_address: Option<String>,
    pub(super) owned_card_ids: BTreeSet<String>,
    pub(super) granted_entitlement_ids: BTreeSet<String>,
    pub(super) owned_box_ids: BTreeSet<String>,
    pub(super) unopened_pack_ids: BTreeSet<String>,
    pub(super) signed_wallet_session: bool,
    #[allow(dead_code)]
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

/// Local fixture ownership for development and tests. Production discovers
/// wallet-linked avatars on chain (see `proxim8::helius`); no remote feed
/// or other domain supplies ownership.
#[derive(Clone, Debug, Default)]
pub(super) struct OwnershipFeedConfig {
    pub(super) inline_feed: Option<String>,
    pub(super) path_feed: Option<PathBuf>,
    pub(super) refresh_every: Option<Duration>,
}

/// Retired remote-feed settings. They are ignored; boot warns once so a
/// stale deployment setting is visible.
const RETIRED_REMOTE_FEED_ENV: [&str; 6] = [
    "COSYWORLD_AVATAR_OWNERSHIP_FEED_URL",
    "COSYWORLD_AVATAR_OWNERSHIP_FEED_BEARER",
    "COSYWORLD_ENTITLEMENT_FEED_URL",
    "COSYWORLD_ENTITLEMENT_FEED_BEARER",
    "COSYWORLD_RUBY_HIGH_WALLET_CARDS_URL",
    "COSYWORLD_RUBY_HIGH_WALLET_CARDS_BEARER",
];

impl OwnershipFeedConfig {
    pub(super) fn from_env() -> Self {
        let inline_feed = std::env::var("COSYWORLD_AVATAR_OWNERSHIP_FEED")
            .ok()
            .or_else(|| std::env::var("COSYWORLD_ENTITLEMENT_FEED").ok())
            .filter(|value| !value.trim().is_empty());
        let path_feed = std::env::var("COSYWORLD_AVATAR_OWNERSHIP_FEED_PATH")
            .ok()
            .or_else(|| std::env::var("COSYWORLD_ENTITLEMENT_FEED_PATH").ok())
            .filter(|value| !value.trim().is_empty())
            .map(PathBuf::from);
        for name in RETIRED_REMOTE_FEED_ENV {
            if std::env::var(name).is_ok_and(|value| !value.trim().is_empty()) {
                warn!("{name} is retired and ignored; linked avatars are discovered on chain");
            }
        }
        Self {
            inline_feed,
            path_feed,
            refresh_every: ownership_refresh_interval(),
        }
    }

    pub(super) fn load_best_effort(&self) -> OwnershipIndex {
        let mut index = OwnershipIndex::default();
        if let Some(value) = self.inline_feed.as_deref() {
            index.merge(OwnershipIndex::parse(value));
        }
        if let Some(path) = self.path_feed.as_deref() {
            match fs::read_to_string(path) {
                Ok(value) => index.merge(OwnershipIndex::parse(&value)),
                Err(error) => warn!(
                    "failed to read ownership fixture {}: {}",
                    path.display(),
                    error
                ),
            }
        }
        index
    }

    pub(super) fn load_strict(&self) -> io::Result<OwnershipIndex> {
        let mut index = OwnershipIndex::default();
        if let Some(value) = self.inline_feed.as_deref() {
            index.merge(OwnershipIndex::parse(value));
        }
        if let Some(path) = self.path_feed.as_deref() {
            index.merge(OwnershipIndex::parse(&fs::read_to_string(path)?));
        }
        Ok(index)
    }

    pub(super) fn is_configured(&self) -> bool {
        self.inline_feed.is_some() || self.path_feed.is_some()
    }
}

pub(super) fn verified_collection_asset_key(collection_address: &str, asset_id: &str) -> String {
    format!(
        "collection:{}:{}",
        collection_address.trim(),
        asset_id.trim()
    )
}

fn verified_collection_asset_card_ids(
    map: &serde_json::Map<String, serde_json::Value>,
) -> BTreeSet<String> {
    ["collectionAssets", "collection_assets", "nfts"]
        .iter()
        .filter_map(|key| map.get(*key).and_then(serde_json::Value::as_array))
        .flatten()
        .filter_map(|entry| {
            let entry = entry.as_object()?;
            let verified = ["collectionVerified", "collection_verified", "verified"]
                .iter()
                .filter_map(|key| entry.get(*key).and_then(serde_json::Value::as_bool))
                .next()
                .unwrap_or(false);
            if !verified {
                return None;
            }
            let collection_address = first_json_string(
                entry,
                &["collectionAddress", "collection_address", "collection"],
            )?;
            let asset_id = first_json_string(
                entry,
                &[
                    "assetId",
                    "asset_id",
                    "assetAddress",
                    "mint",
                    "address",
                    "id",
                ],
            )?;
            let valid_solana_address = |value: &str| {
                bs58::decode(value.trim())
                    .into_vec()
                    .is_ok_and(|bytes| bytes.len() == 32)
            };
            (valid_solana_address(&collection_address) && valid_solana_address(&asset_id))
                .then(|| verified_collection_asset_key(&collection_address, &asset_id))
        })
        .collect()
}

pub(super) async fn load_base_ownership_index(state: &AppState) -> io::Result<OwnershipIndex> {
    if state.deployment.profile.is_production() {
        state.ownership_feed.load_strict()
    } else {
        Ok(state.ownership_feed.load_best_effort())
    }
}

pub(super) async fn load_effective_ownership_index_strict(
    state: &AppState,
) -> io::Result<OwnershipIndex> {
    let ownership = state.ownership_feed.load_strict()?;
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
        // Historical Box and pack receipts remain readable by moderation and
        // reconciliation, but they are not live ownership grants.
        let _ = load_receipt_ownership_index(path)?;
    }
    Ok(ownership)
}

impl OwnershipIndex {
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
                    let mut cards = first_json_cards(
                        &map,
                        &[
                            "cardIds",
                            "card_ids",
                            "cards",
                            "ownedCardIds",
                            "hallPassCards",
                        ],
                    );
                    cards = if cards.is_empty() {
                        json_card_ids(&serde_json::Value::Object(map.clone()))
                    } else {
                        cards
                    };
                    cards.extend(verified_collection_asset_card_ids(&map));
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
                        let mut cards = first_json_cards(
                            map,
                            &[
                                "cardIds",
                                "card_ids",
                                "cards",
                                "ownedCardIds",
                                "hallPassCards",
                            ],
                        );
                        cards.extend(verified_collection_asset_card_ids(map));
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
                            serde_json::Value::Object(map) => {
                                let mut cards = first_json_cards(
                                    &map,
                                    &[
                                        "cardIds",
                                        "card_ids",
                                        "cards",
                                        "ownedCardIds",
                                        "hallPassCards",
                                    ],
                                );
                                cards.extend(verified_collection_asset_card_ids(&map));
                                (
                                    cards,
                                    first_json_assets(
                                        &map,
                                        &["grantIds", "grant_ids", "entitlements", "grants"],
                                        &["grantId", "grant_id", "id"],
                                    ),
                                    first_json_assets(
                                        &map,
                                        &[
                                            "boxes",
                                            "woodenBoxes",
                                            "wooden_boxes",
                                            "boxIds",
                                            "box_ids",
                                        ],
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
                                )
                            }
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
        let Ok(ownership) = state.ownership_index.try_read() else {
            return Self::default();
        };
        Self::for_linked_actor_with_ownership(state, actor_id, &ownership)
    }

    pub(super) fn for_linked_actor_with_ownership(
        state: &AppState,
        actor_id: u64,
        ownership: &OwnershipIndex,
    ) -> Self {
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
        _trust_client_card_ids: bool,
        wallet_sessions: &StdMutex<WalletSessions>,
        allow_unsigned_wallet_claims: bool,
    ) -> Self {
        Self::from_request_parts(
            query.wallet_session.as_deref(),
            None,
            [None, None],
            ownership,
            wallet_sessions,
            allow_unsigned_wallet_claims,
        )
    }

    pub(super) fn from_move_request(
        payload: &MoveRequest,
        ownership: &OwnershipIndex,
        _trust_client_card_ids: bool,
        wallet_sessions: &StdMutex<WalletSessions>,
        allow_unsigned_wallet_claims: bool,
    ) -> Self {
        Self::from_request_parts(
            payload.wallet_session.as_deref(),
            None,
            [None, None],
            ownership,
            wallet_sessions,
            allow_unsigned_wallet_claims,
        )
    }

    pub(super) fn from_command_request(
        payload: &CommandRequest,
        ownership: &OwnershipIndex,
        _trust_client_card_ids: bool,
        wallet_sessions: &StdMutex<WalletSessions>,
        allow_unsigned_wallet_claims: bool,
    ) -> Self {
        Self::from_request_parts(
            payload.wallet_session.as_deref(),
            None,
            [None, None],
            ownership,
            wallet_sessions,
            allow_unsigned_wallet_claims,
        )
    }

    pub(super) fn from_events_query(
        query: &EventsQuery,
        ownership: &OwnershipIndex,
        _trust_client_card_ids: bool,
        wallet_sessions: &StdMutex<WalletSessions>,
        allow_unsigned_wallet_claims: bool,
    ) -> Self {
        Self::from_request_parts(
            query.wallet_session.as_deref(),
            None,
            [None, None],
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
}

pub(super) async fn wallet_session(
    ConnectInfo(client_addr): ConnectInfo<SocketAddr>,
    State(state): State<AppState>,
    Json(payload): Json<WalletSessionRequest>,
) -> Json<WalletSessionResponse> {
    if !state.allow_rate_limit(
        rate_limit_key("wallet-auth-ip", client_ip_key(client_addr)),
        WALLET_AUTH_LIMIT,
    ) {
        return Json(WalletSessionResponse {
            ok: false,
            status: RATE_LIMITED_STATUS as u16,
            wallet_address: None,
            wallet_session: None,
            expires_at_unix: None,
            error: Some("wallet authorization rate limited".to_string()),
        });
    }
    let Some(wallet_address) = normalize_wallet_address(&payload.wallet_address) else {
        return Json(WalletSessionResponse {
            ok: false,
            status: 400,
            wallet_address: None,
            wallet_session: None,
            expires_at_unix: None,
            error: Some("invalid wallet address".to_string()),
        });
    };
    if let Some(login_id) = payload.qr_login_id.as_deref() {
        if !qr_wallet_login_is_pending(&state, login_id) {
            return Json(WalletSessionResponse {
                ok: false,
                status: 410,
                wallet_address: None,
                wallet_session: None,
                expires_at_unix: None,
                error: Some("QR login expired".to_string()),
            });
        }
    }
    let nonce = payload.nonce.trim().to_string();
    let now = Instant::now();
    let Some(challenge) = state.wallet_sessions.lock().ok().and_then(|mut sessions| {
        sessions
            .challenges
            .retain(|_, challenge| challenge.expires_at > now);
        sessions.challenges.remove(&nonce)
    }) else {
        return Json(WalletSessionResponse {
            ok: false,
            status: 401,
            wallet_address: None,
            wallet_session: None,
            expires_at_unix: None,
            error: Some("wallet challenge expired".to_string()),
        });
    };
    if challenge.wallet_address != wallet_address
        || !verify_solana_wallet_signature(&wallet_address, &challenge.message, &payload.signature)
    {
        return Json(WalletSessionResponse {
            ok: false,
            status: 401,
            wallet_address: None,
            wallet_session: None,
            expires_at_unix: None,
            error: Some("wallet signature rejected".to_string()),
        });
    }

    let session_token = random_hex(32);
    let expires_at_unix = now_unix_secs() + 12 * 60 * 60;
    if let Ok(mut sessions) = state.wallet_sessions.lock() {
        sessions
            .sessions
            .retain(|_, session| session.expires_at > now);
        sessions.sessions.insert(
            session_token.clone(),
            WalletSession {
                wallet_address: wallet_address.clone(),
                linked_wallet_addresses: Vec::new(),
                expires_at: now + Duration::from_secs(12 * 60 * 60),
            },
        );
    }
    if let Some(login_id) = payload.qr_login_id.as_deref() {
        if let Err(error) =
            complete_qr_wallet_login(&state, login_id, &wallet_address, &session_token)
        {
            return Json(WalletSessionResponse {
                ok: false,
                status: 410,
                wallet_address: None,
                wallet_session: None,
                expires_at_unix: None,
                error: Some(error.to_string()),
            });
        }
    }
    let _ = materialize_wallet_proxim8s(&state, &wallet_address).await;
    let _ =
        crate::proxim8::linked_avatars::materialize_wallet_linked_avatars(&state, &wallet_address)
            .await;

    Json(WalletSessionResponse {
        ok: true,
        status: 200,
        wallet_address: Some(wallet_address),
        wallet_session: Some(session_token),
        expires_at_unix: Some(expires_at_unix),
        error: None,
    })
}

impl AppState {
    pub(super) async fn ownership_snapshot(&self) -> OwnershipIndex {
        self.ownership_index.read().await.clone()
    }
}

/// Re-read a fixture file every `COSYWORLD_AVATAR_OWNERSHIP_FEED_REFRESH_SECS`
/// seconds (minimum 5). Unset or 0 leaves the fixture as loaded at boot.
pub(super) fn ownership_refresh_interval() -> Option<Duration> {
    let value = std::env::var("COSYWORLD_AVATAR_OWNERSHIP_FEED_REFRESH_SECS")
        .or_else(|_| std::env::var("COSYWORLD_ENTITLEMENT_FEED_REFRESH_SECS"))
        .ok()?;
    let secs = value.trim().parse::<u64>().unwrap_or(0);
    (secs > 0).then(|| Duration::from_secs(secs.max(5)))
}

pub(super) fn start_ownership_refresh_scheduler(state: AppState) {
    let Some(refresh_every) = state.ownership_feed.refresh_every else {
        return;
    };
    tokio::spawn(async move {
        let mut failures = 0_u32;
        loop {
            let next_refresh =
                ownership_refresh_delay_with_jitter(refresh_every, failures, rand::random::<u64>());
            tokio::time::sleep(next_refresh).await;
            failures = match refresh_ownership_index_once(&state).await {
                Ok(_) => 0,
                Err(error) => {
                    warn!(
                        "linked-avatar ownership refresh failed; keeping last good fixture: {}",
                        error
                    );
                    failures.saturating_add(1)
                }
            };
        }
    });
}

pub(super) async fn refresh_ownership_index_once(state: &AppState) -> io::Result<bool> {
    let refreshed = load_effective_ownership_index_strict(state).await?;
    let changed = {
        let mut ownership = state.ownership_index.write().await;
        if *ownership == refreshed {
            false
        } else {
            *ownership = refreshed.clone();
            true
        }
    };

    if changed {
        info!(
            "refreshed linked-avatar ownership fixture: {} wallet(s)",
            refreshed.wallet_count()
        );
    }
    Ok(changed)
}

pub(super) fn ownership_refresh_delay(base: Duration, consecutive_failures: u32) -> Duration {
    const MAX_BACKOFF: Duration = Duration::from_secs(15 * 60);
    if consecutive_failures == 0 {
        return base;
    }
    let multiplier = 1_u32 << consecutive_failures.min(4);
    base.saturating_mul(multiplier).min(MAX_BACKOFF)
}

pub(super) fn ownership_refresh_delay_with_jitter(
    base: Duration,
    consecutive_failures: u32,
    sample: u64,
) -> Duration {
    let delay = ownership_refresh_delay(base, consecutive_failures);
    let delay_ms = u64::try_from(delay.as_millis()).unwrap_or(u64::MAX);
    let jitter_radius_ms = (delay_ms / 10).max(1);
    let jitter_span_ms = jitter_radius_ms.saturating_mul(2).saturating_add(1);
    Duration::from_millis(
        delay_ms
            .saturating_sub(jitter_radius_ms)
            .saturating_add(sample % jitter_span_ms),
    )
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
