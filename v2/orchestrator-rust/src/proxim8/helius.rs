//! Wallet NFT ownership from Helius DAS (`getAssetsByOwner`).
//!
//! The server asks Helius which assets a linked wallet holds. The browser
//! never supplies ownership, collection membership or metadata. Only
//! verified collection groupings count: DAS omits unverified ones unless
//! asked, and any grouping marked `verified: false` is ignored anyway. The
//! asset's standard (Metaplex Core, Token Metadata, programmable or
//! compressed) is whatever DAS reports as its interface; admission never
//! depends on it.

use super::*;

/// Most assets read for one wallet: ten pages of 1000.
const MAX_PAGES: usize = 10;
const PAGE_LIMIT: usize = 1000;
const TIMEOUT: Duration = Duration::from_secs(15);

#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) struct OwnedAsset {
    pub(crate) id: String,
    /// The verified collection, if any.
    pub(crate) collection: Option<String>,
    /// DAS interface, e.g. `MplCoreAsset`, `V1_NFT`, `ProgrammableNFT`.
    pub(crate) interface: String,
    pub(crate) name: Option<String>,
}

/// `COSYWORLD_HELIUS_RPC_URL`, or the Helius mainnet RPC for
/// `HELIUS_API_KEY`. None leaves discovery to the ownership feed.
pub(crate) fn helius_rpc_url() -> Option<String> {
    if let Ok(url) = std::env::var("COSYWORLD_HELIUS_RPC_URL") {
        let url = url.trim();
        if !url.is_empty() {
            return Some(url.to_string());
        }
    }
    let key = std::env::var("HELIUS_API_KEY").ok()?;
    let key = key.trim();
    (!key.is_empty()).then(|| format!("https://mainnet.helius-rpc.com/?api-key={key}"))
}

fn request_body(wallet: &str, page: usize) -> serde_json::Value {
    serde_json::json!({
        "jsonrpc": "2.0",
        "id": "cosyworld-linked-avatars",
        "method": "getAssetsByOwner",
        "params": {
            "ownerAddress": wallet,
            "page": page,
            "limit": PAGE_LIMIT,
            "options": { "showUnverifiedCollections": false }
        }
    })
}

/// Parse one `getAssetsByOwner` response. Returns the assets `wallet` holds
/// and the number of items on the page (for pagination). Burnt assets and
/// assets another wallet holds are dropped.
pub(crate) fn parse_assets_page(
    wallet: &str,
    response: &serde_json::Value,
) -> io::Result<(Vec<OwnedAsset>, usize)> {
    if let Some(error) = response.get("error") {
        return Err(io::Error::other(format!("helius error: {error}")));
    }
    let items = response
        .pointer("/result/items")
        .and_then(serde_json::Value::as_array)
        .ok_or_else(|| io::Error::other("helius response has no result.items"))?;
    let mut assets = Vec::new();
    for item in items {
        let Some(id) = item.get("id").and_then(serde_json::Value::as_str) else {
            continue;
        };
        let burnt = item.get("burnt").and_then(serde_json::Value::as_bool) == Some(true);
        let owner = item
            .pointer("/ownership/owner")
            .and_then(serde_json::Value::as_str);
        if burnt || owner != Some(wallet) {
            continue;
        }
        let collection = item
            .get("grouping")
            .and_then(serde_json::Value::as_array)
            .into_iter()
            .flatten()
            .find(|group| {
                group.get("group_key").and_then(serde_json::Value::as_str) == Some("collection")
                    && group.get("verified").and_then(serde_json::Value::as_bool) != Some(false)
            })
            .and_then(|group| group.get("group_value"))
            .and_then(serde_json::Value::as_str)
            .map(str::to_string);
        assets.push(OwnedAsset {
            id: id.to_string(),
            collection,
            interface: item
                .get("interface")
                .and_then(serde_json::Value::as_str)
                .unwrap_or("unknown")
                .to_string(),
            name: item
                .pointer("/content/metadata/name")
                .and_then(serde_json::Value::as_str)
                .map(str::to_string),
        });
    }
    Ok((assets, items.len()))
}

/// Every asset `wallet` holds, read page by page.
pub(crate) async fn fetch_owned_assets(rpc_url: &str, wallet: &str) -> io::Result<Vec<OwnedAsset>> {
    let client = reqwest::Client::builder()
        .timeout(TIMEOUT)
        .build()
        .map_err(io::Error::other)?;
    let mut assets = Vec::new();
    for page in 1..=MAX_PAGES {
        let response = client
            .post(rpc_url)
            .json(&request_body(wallet, page))
            .send()
            .await
            .map_err(|error| {
                io::Error::other(format!("helius request failed: {}", error.without_url()))
            })?;
        if !response.status().is_success() {
            return Err(io::Error::other(format!(
                "helius status {}",
                response.status()
            )));
        }
        let body: serde_json::Value = response
            .json()
            .await
            .map_err(|error| io::Error::other(format!("helius body: {}", error.without_url())))?;
        let (page_assets, count) = parse_assets_page(wallet, &body)?;
        assets.extend(page_assets);
        if count < PAGE_LIMIT {
            break;
        }
    }
    Ok(assets)
}

#[cfg(test)]
mod tests {
    use super::*;

    const WALLET: &str = "DcXxMstZHwnEMjLTF1Aa2kHB95NBif77nPUEZqD4ZTue";

    /// A trimmed recorded response: a Core asset, a Token Metadata NFT, a
    /// compressed NFT, an unverified grouping, a burnt asset and one held by
    /// another wallet.
    fn recorded_page() -> serde_json::Value {
        serde_json::json!({
            "jsonrpc": "2.0",
            "id": "cosyworld-linked-avatars",
            "result": {
                "total": 6, "limit": 1000, "page": 1,
                "items": [
                    {"id": "8GwrpeSH4TpAGEJsmoF35J8DY6RNCdyjCBZsEnTySEKd", "interface": "MplCoreAsset",
                     "content": {"metadata": {"name": "Proxim8 #412"}},
                     "grouping": [{"group_key": "collection", "group_value": "5QBfYxnihn5De4UEV3U1To4sWuWoWwHYJsxpd3hPamaf"}],
                     "ownership": {"owner": WALLET}, "burnt": false},
                    {"id": "AvatarTm1111111111111111111111111111111111", "interface": "V1_NFT",
                     "content": {"metadata": {"name": "RATi Avatar 7"}},
                     "grouping": [{"group_key": "collection", "group_value": "RatiCollection11111111111111111111111111111", "verified": true}],
                     "ownership": {"owner": WALLET}, "burnt": false},
                    {"id": "CompressedAvatar111111111111111111111111111", "interface": "V1_NFT",
                     "compression": {"compressed": true},
                     "grouping": [{"group_key": "collection", "group_value": "RatiCollection11111111111111111111111111111"}],
                     "ownership": {"owner": WALLET}, "burnt": false},
                    {"id": "Unverified111111111111111111111111111111111", "interface": "V1_NFT",
                     "grouping": [{"group_key": "collection", "group_value": "5QBfYxnihn5De4UEV3U1To4sWuWoWwHYJsxpd3hPamaf", "verified": false}],
                     "ownership": {"owner": WALLET}, "burnt": false},
                    {"id": "Burnt11111111111111111111111111111111111111", "interface": "MplCoreAsset",
                     "grouping": [{"group_key": "collection", "group_value": "5QBfYxnihn5De4UEV3U1To4sWuWoWwHYJsxpd3hPamaf"}],
                     "ownership": {"owner": WALLET}, "burnt": true},
                    {"id": "Elsewhere1111111111111111111111111111111111", "interface": "MplCoreAsset",
                     "grouping": [{"group_key": "collection", "group_value": "5QBfYxnihn5De4UEV3U1To4sWuWoWwHYJsxpd3hPamaf"}],
                     "ownership": {"owner": "SomeoneElse111111111111111111111111111111111"}, "burnt": false}
                ]
            }
        })
    }

    #[test]
    fn das_page_keeps_held_assets_and_only_verified_collections() {
        let (assets, count) = parse_assets_page(WALLET, &recorded_page()).unwrap();
        assert_eq!(count, 6);
        let ids: Vec<_> = assets.iter().map(|asset| asset.id.as_str()).collect();
        assert_eq!(
            ids,
            [
                "8GwrpeSH4TpAGEJsmoF35J8DY6RNCdyjCBZsEnTySEKd",
                "AvatarTm1111111111111111111111111111111111",
                "CompressedAvatar111111111111111111111111111",
                "Unverified111111111111111111111111111111111",
            ]
        );
        assert_eq!(assets[0].interface, "MplCoreAsset");
        assert_eq!(
            assets[0].collection.as_deref(),
            Some("5QBfYxnihn5De4UEV3U1To4sWuWoWwHYJsxpd3hPamaf")
        );
        assert_eq!(assets[0].name.as_deref(), Some("Proxim8 #412"));
        assert_eq!(assets[1].interface, "V1_NFT");
        assert_eq!(
            assets[3].collection, None,
            "an unverified grouping is no collection"
        );
    }

    #[test]
    fn das_errors_fail_closed() {
        let error =
            serde_json::json!({"jsonrpc": "2.0", "error": {"code": -32602, "message": "bad"}});
        assert!(parse_assets_page(WALLET, &error).is_err());
        assert!(parse_assets_page(WALLET, &serde_json::json!({"result": {}})).is_err());
    }

    #[test]
    fn request_hides_unverified_collections() {
        let body = request_body(WALLET, 2);
        assert_eq!(body["method"], "getAssetsByOwner");
        assert_eq!(body["params"]["page"], 2);
        assert_eq!(
            body["params"]["options"]["showUnverifiedCollections"],
            false
        );
    }
}
