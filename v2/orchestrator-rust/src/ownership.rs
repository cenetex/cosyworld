use super::*;

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

impl OwnershipFeedConfig {}

impl OwnershipIndex {}

impl AppState {}
