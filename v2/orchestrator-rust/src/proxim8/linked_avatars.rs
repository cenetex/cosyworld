//! Worldpack-declared linked avatars.
//!
//! A world lists the NFTs that may join it as avatars: whole collections,
//! specific assets, or both, each with an arrival place:
//!
//! ```json
//! "linked_avatars": {
//!   "schema_version": 1,
//!   "sources": [
//!     { "id": "proxim8", "name": "Proxim8",
//!       "collections": ["5QBfYxnihn5De4UEV3U1To4sWuWoWwHYJsxpd3hPamaf"],
//!       "arrival_location": "cosyworld.core:location/1" }
//!   ]
//! }
//! ```
//!
//! When a wallet is linked, the server reads the wallet's assets on chain
//! (Solana DAS through `COSYWORLD_HELIUS_RPC_URL` or `HELIUS_API_KEY`), keeps
//! those a source admits, and gives each asset exactly one durable actor. No
//! other domain supplies ownership. The standard is whatever DAS reports;
//! admission checks only the verified collection or the asset id.
//!
//! An avatar is self-contained: its name and description come from the NFT's
//! own metadata unless the world authors a shared character for it.
//!
//! Records reuse the Proxim8 materialization mutation with receipts named
//! `linked-avatar:<asset>`. Their replay preconditions read only the record,
//! so later worldpack edits never break journal replay. An asset already
//! joined through the Project 89 pilot never joins twice.

use super::*;

const MAX_NAME_CHARS: usize = 40;

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
pub(crate) struct LinkedAvatarsConfig {
    pub(crate) schema_version: u32,
    pub(crate) sources: Vec<LinkedAvatarSource>,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
pub(crate) struct LinkedAvatarSource {
    pub(crate) id: String,
    pub(crate) name: String,
    #[serde(default)]
    pub(crate) collections: Vec<String>,
    #[serde(default)]
    pub(crate) assets: Vec<String>,
    /// Copies of one character: any listed asset recovers the same actor.
    #[serde(default)]
    pub(crate) characters: Vec<LinkedAvatarCharacter>,
    pub(crate) arrival_location: String,
    #[serde(default)]
    pub(crate) goal: Option<String>,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
pub(crate) struct LinkedAvatarCharacter {
    pub(crate) id: String,
    pub(crate) name: String,
    pub(crate) assets: Vec<String>,
    /// Lives in the world from boot, whether or not a holder has linked.
    #[serde(default)]
    pub(crate) permanent: bool,
    /// Where this character lives; defaults to the source's arrival.
    #[serde(default)]
    pub(crate) home_location: Option<String>,
    /// Authored bio; when present it takes priority over NFT metadata.
    #[serde(default)]
    pub(crate) description: Option<String>,
    #[serde(default)]
    pub(crate) personality: Option<String>,
    /// Reviewed artwork for this shared character.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) image_url: Option<String>,
}

const MAX_BIO_CHARS: usize = 400;

impl LinkedAvatarCharacter {
    fn home_location_id(&self, source: &LinkedAvatarSource) -> Option<u64> {
        match self.home_location.as_deref() {
            Some(reference) => reference.rsplit('/').next()?.parse().ok(),
            None => source.arrival_location_id(),
        }
    }
}

/// What an admitted asset joins as: its own actor, or a shared character.
#[derive(Clone, Debug, PartialEq)]
pub(crate) struct Admission {
    /// Exactly one actor exists per key: the asset id, or
    /// `character:<source>/<character>`.
    pub(crate) key: String,
    pub(crate) character: Option<LinkedAvatarCharacter>,
}

fn character_key(source: &LinkedAvatarSource, character: &LinkedAvatarCharacter) -> String {
    format!("character:{}/{}", source.id, character.id)
}

fn valid_slug(id: &str) -> bool {
    (1..=32).contains(&id.len())
        && id
            .bytes()
            .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-')
}

impl LinkedAvatarSource {
    fn admits(&self, asset: &helius::OwnedAsset) -> Option<Admission> {
        if let Some(character) = self
            .characters
            .iter()
            .find(|character| character.assets.iter().any(|id| id == &asset.id))
        {
            return Some(Admission {
                key: character_key(self, character),
                character: Some(character.clone()),
            });
        }
        let direct = self.assets.iter().any(|id| id == &asset.id)
            || asset
                .collection
                .as_deref()
                .is_some_and(|collection| self.collections.iter().any(|c| c == collection));
        direct.then(|| Admission {
            key: asset.id.clone(),
            character: None,
        })
    }

    pub(crate) fn arrival_location_id(&self) -> Option<u64> {
        self.arrival_location.rsplit('/').next()?.parse().ok()
    }
}

fn is_solana_address(text: &str) -> bool {
    bs58::decode(text)
        .into_vec()
        .is_ok_and(|bytes| bytes.len() == 32)
}

/// Check a world's `linked_avatars` block against its locations.
pub(crate) fn validate_linked_avatars(
    config: &LinkedAvatarsConfig,
    location_exists: impl Fn(u64) -> bool,
) -> Result<(), String> {
    if config.schema_version != 1 {
        return Err("linked_avatars schema_version must be 1".to_string());
    }
    if config.sources.is_empty() {
        return Err("linked_avatars must list at least one source".to_string());
    }
    let mut ids = BTreeSet::new();
    for source in &config.sources {
        if !valid_slug(&source.id) || !ids.insert(source.id.as_str()) {
            return Err(format!(
                "linked_avatars source id {:?} is invalid or repeated",
                source.id
            ));
        }
        if source.name.trim().is_empty() || source.name.chars().count() > MAX_NAME_CHARS {
            return Err(format!(
                "linked_avatars source {} needs a short name",
                source.id
            ));
        }
        if source.collections.is_empty() && source.assets.is_empty() && source.characters.is_empty()
        {
            return Err(format!(
                "linked_avatars source {} admits nothing",
                source.id
            ));
        }
        let mut character_ids = BTreeSet::new();
        let mut listed = BTreeSet::new();
        for character in &source.characters {
            if !valid_slug(&character.id)
                || !character_ids.insert(character.id.as_str())
                || character.name.trim().is_empty()
                || character.name.chars().count() > MAX_NAME_CHARS
                || character.assets.is_empty()
                || !character
                    .home_location_id(source)
                    .is_some_and(&location_exists)
                || character
                    .image_url
                    .as_deref()
                    .is_some_and(|url| !valid_character_image_url(url))
                || [&character.description, &character.personality]
                    .into_iter()
                    .flatten()
                    .any(|text| {
                        text.trim().is_empty()
                            || text.chars().count() > MAX_BIO_CHARS
                            || text.chars().any(char::is_control)
                    })
            {
                return Err(format!(
                    "linked_avatars source {} has an invalid character {:?}",
                    source.id, character.id
                ));
            }
        }
        for asset in source
            .assets
            .iter()
            .chain(source.characters.iter().flat_map(|c| &c.assets))
        {
            if !listed.insert(asset.as_str()) {
                return Err(format!(
                    "linked_avatars source {} lists asset {asset} twice",
                    source.id
                ));
            }
        }
        if let Some(bad) = source
            .collections
            .iter()
            .chain(&source.assets)
            .chain(source.characters.iter().flat_map(|c| &c.assets))
            .find(|address| !is_solana_address(address))
        {
            return Err(format!(
                "linked_avatars source {} has an invalid address {bad}",
                source.id
            ));
        }
        if !source.arrival_location_id().is_some_and(&location_exists) {
            return Err(format!(
                "linked_avatars source {} arrives at unknown location {}",
                source.id, source.arrival_location
            ));
        }
    }
    Ok(())
}

fn valid_character_image_url(value: &str) -> bool {
    value.len() <= 2048
        && value.trim() == value
        && !value.chars().any(char::is_control)
        && reqwest::Url::parse(value).is_ok_and(|url| {
            url.scheme() == "https"
                && url.host_str().is_some()
                && url.username().is_empty()
                && url.password().is_none()
                && url.fragment().is_none()
        })
}

impl RuntimeWorld {}

/// A display name from metadata, if it is plain enough to use.
fn cosmetic_name(name: Option<&str>) -> Option<String> {
    let name = name?.split_whitespace().collect::<Vec<_>>().join(" ");
    let ok = !name.is_empty()
        && name.chars().count() <= MAX_NAME_CHARS
        && name.chars().all(|c| !c.is_control());
    ok.then_some(name)
}

fn fallback_name(source: &LinkedAvatarSource, asset_id: &str) -> String {
    format!("{} {}", source.name, asset_id.get(..6).unwrap_or(asset_id))
}

/// Pair each held asset with the first source that admits it, once per
/// actor: several copies of one character in a wallet join once.
pub(crate) fn admitted_assets(
    config: &LinkedAvatarsConfig,
    assets: Vec<helius::OwnedAsset>,
) -> Vec<(helius::OwnedAsset, &LinkedAvatarSource, Admission)> {
    let mut seen = BTreeSet::new();
    assets
        .into_iter()
        .filter_map(|asset| {
            let (source, admission) = config
                .sources
                .iter()
                .find_map(|source| source.admits(&asset).map(|admission| (source, admission)))?;
            seen.insert(admission.key.clone())
                .then_some((asset, source, admission))
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    const PROXIM8: &str = "5QBfYxnihn5De4UEV3U1To4sWuWoWwHYJsxpd3hPamaf";
    const POOZ_A: &str = "EM3tciRcUa8VeupDDdKBfZVH484LDRhqRpCZ8YsAGVGA";
    const POOZ_B: &str = "EPzcJWBhPJJzwzEvNv5JXfhQ7cYaXDWFx9h16nHwzmpc";
    const LISTED: &str = "Bcw1nuJtSXQcXTs7jBc5iN5v51Zm2vAsY2QcHNJVgvgo";

    fn config(arrival: u64) -> LinkedAvatarsConfig {
        serde_json::from_value(serde_json::json!({
            "schema_version": 1,
            "sources": [
                {"id": "proxim8", "name": "Proxim8", "collections": [PROXIM8],
                 "arrival_location": format!("cosyworld.core:location/{arrival}")},
                {"id": "chosen", "name": "Chosen", "assets": ["8GwrpeSH4TpAGEJsmoF35J8DY6RNCdyjCBZsEnTySEKd"],
                 "arrival_location": format!("cosyworld.core:location/{arrival}")},
                {"id": "rati-avatars", "name": "RATi Avatar",
                 "characters": [{"id": "santa-pooz", "name": "Santa Pooz",
                                 "assets": [POOZ_A, POOZ_B]}],
                 "arrival_location": format!("cosyworld.core:location/{arrival}")}
            ]
        }))
        .unwrap()
    }

    fn asset(id: &str, collection: Option<&str>, name: Option<&str>) -> helius::OwnedAsset {
        helius::OwnedAsset {
            id: id.to_string(),
            collection: collection.map(str::to_string),
            interface: "MplCoreAsset".to_string(),
            name: name.map(str::to_string),
            description: None,
        }
    }

    #[test]
    fn sources_admit_by_collection_or_listed_asset() {
        let config = config(1);
        let admitted = admitted_assets(
            &config,
            vec![
                asset(
                    "CoreAsset11111111111111111111111111111111111",
                    Some(PROXIM8),
                    None,
                ),
                asset("8GwrpeSH4TpAGEJsmoF35J8DY6RNCdyjCBZsEnTySEKd", None, None),
                asset(
                    "Stranger111111111111111111111111111111111111",
                    Some(LISTED),
                    None,
                ),
            ],
        );
        let pairs: Vec<_> = admitted
            .iter()
            .map(|(a, s, _)| (a.id.as_str(), s.id.as_str()))
            .collect();
        assert_eq!(
            pairs,
            [
                ("CoreAsset11111111111111111111111111111111111", "proxim8"),
                ("8GwrpeSH4TpAGEJsmoF35J8DY6RNCdyjCBZsEnTySEKd", "chosen"),
            ]
        );
    }

    #[test]
    fn world_config_is_validated() {
        assert!(validate_linked_avatars(&config(1), |id| id == 1).is_ok());
        assert!(
            validate_linked_avatars(&config(9), |id| id == 1).is_err(),
            "unknown arrival"
        );
        let mut bad = config(1);
        bad.sources[0].collections = vec!["not-an-address".to_string()];
        assert!(validate_linked_avatars(&bad, |_| true).is_err());
        let mut empty = config(1);
        empty.sources[1].assets.clear();
        assert!(
            validate_linked_avatars(&empty, |_| true).is_err(),
            "a source must admit something"
        );
        let mut repeated = config(1);
        repeated.sources[1].id = "proxim8".to_string();
        assert!(validate_linked_avatars(&repeated, |_| true).is_err());
    }

    #[test]
    fn metadata_names_are_cosmetic_and_bounded() {
        assert_eq!(
            cosmetic_name(Some(" Proxim8   #12 ")).as_deref(),
            Some("Proxim8 #12")
        );
        assert_eq!(cosmetic_name(Some("")), None);
        assert_eq!(cosmetic_name(Some(&"x".repeat(41))), None);
        assert_eq!(cosmetic_name(Some("bad\u{7}bell")), None);
        let source = &config(1).sources[0];
        assert_eq!(fallback_name(source, "CoreAsset111"), "Proxim8 CoreAs");
    }

    #[test]
    fn character_lists_are_validated() {
        let mut twice = config(1);
        twice.sources[2].assets = vec![POOZ_A.to_string()];
        assert!(
            validate_linked_avatars(&twice, |_| true).is_err(),
            "an asset in two places"
        );
        let mut empty = config(1);
        empty.sources[2].characters[0].assets.clear();
        assert!(
            validate_linked_avatars(&empty, |_| true).is_err(),
            "a character with no assets"
        );
        let mut bad = config(1);
        bad.sources[2].characters[0].id = "Santa Pooz".to_string();
        assert!(
            validate_linked_avatars(&bad, |_| true).is_err(),
            "character ids are slugs"
        );
    }

    #[test]
    fn permanent_character_fields_are_validated() {
        let mut far = config(1);
        far.sources[2].characters[0].home_location = Some("cosyworld.core:location/77".to_string());
        assert!(
            validate_linked_avatars(&far, |id| id == 1).is_err(),
            "unknown home"
        );
        let mut long = config(1);
        long.sources[2].characters[0].description = Some("x".repeat(401));
        assert!(
            validate_linked_avatars(&long, |_| true).is_err(),
            "bio too long"
        );
        let mut blank = config(1);
        blank.sources[2].characters[0].personality = Some("  ".to_string());
        assert!(
            validate_linked_avatars(&blank, |_| true).is_err(),
            "blank bio"
        );
    }

    #[test]
    fn character_artwork_uses_a_plain_https_url() {
        let mut config = config(1);
        config.sources[2].characters[0].image_url =
            Some("https://arweave.net/portrait".to_string());
        assert!(validate_linked_avatars(&config, |_| true).is_ok());
        for url in [
            "http://arweave.net/portrait",
            "javascript:alert(1)",
            "https://user:secret@arweave.net/portrait",
            "https://arweave.net/portrait#fragment",
            " https://arweave.net/portrait",
            "https://arweave.net/por\ntrait",
        ] {
            config.sources[2].characters[0].image_url = Some(url.to_string());
            assert!(validate_linked_avatars(&config, |_| true).is_err(), "{url}");
        }
    }
}
