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

const PAGE_LIMIT: usize = 1000;

#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) struct OwnedAsset {
    pub(crate) id: String,
    /// The verified collection, if any.
    pub(crate) collection: Option<String>,
    /// DAS interface, e.g. `MplCoreAsset`, `V1_NFT`, `ProgrammableNFT`.
    pub(crate) interface: String,
    pub(crate) name: Option<String>,
    /// The NFT's own `content.metadata.description`, raw; the avatar's
    /// self-contained description when the world authors none.
    pub(crate) description: Option<String>,
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
            // Token Metadata 1-of-1s without a master edition (for example
            // some RATi Avatars) have the FungibleAsset standard.
            "options": { "showUnverifiedCollections": false, "showFungible": true }
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
        // Token-standard assets report the holder only through a balance.
        let balance = item
            .pointer("/token_info/balance")
            .and_then(serde_json::Value::as_u64);
        let held = match balance {
            Some(balance) => {
                balance >= 1 && matches!(owner, Some(o) if o == wallet || o.is_empty())
            }
            None => owner == Some(wallet),
        };
        if burnt || !held {
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
            description: item
                .pointer("/content/metadata/description")
                .and_then(serde_json::Value::as_str)
                .map(str::to_string),
        });
    }
    Ok((assets, items.len()))
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
                     "content": {"metadata": {"name": "Proxim8 #412", "description": "A courier who remembers tomorrow."}},
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
        assert_eq!(
            assets[0].description.as_deref(),
            Some("A courier who remembers tomorrow.")
        );
        assert_eq!(assets[1].description, None);
        assert_eq!(assets[1].interface, "V1_NFT");
        assert_eq!(
            assets[3].collection, None,
            "an unverified grouping is no collection"
        );
    }

    #[test]
    fn fungible_standard_one_of_ones_count_only_with_a_balance() {
        let page = serde_json::json!({"result": {"items": [
            {"id": "HeldFungible1111111111111111111111111111111", "interface": "FungibleAsset",
             "content": {"metadata": {"name": "Kael"}}, "grouping": [],
             "ownership": {"owner": WALLET}, "token_info": {"balance": 1, "supply": 1, "decimals": 0}},
            {"id": "SoldFungible1111111111111111111111111111111", "interface": "FungibleAsset",
             "grouping": [], "ownership": {"owner": WALLET}, "token_info": {"balance": 0, "supply": 1}},
            {"id": "OtherFungible111111111111111111111111111111", "interface": "FungibleAsset",
             "grouping": [], "ownership": {"owner": "Elsewhere"}, "token_info": {"balance": 1}}
        ]}});
        let (assets, count) = parse_assets_page(WALLET, &page).unwrap();
        assert_eq!(count, 3);
        let ids: Vec<_> = assets.iter().map(|asset| asset.id.as_str()).collect();
        assert_eq!(ids, ["HeldFungible1111111111111111111111111111111"]);
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
