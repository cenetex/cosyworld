use super::*;

#[derive(Debug, Serialize)]
pub(super) struct ContentPacksResponse {
    worldpack_id: String,
    bundle_hash: String,
    packs: Vec<ContentPackView>,
}

#[derive(Debug, Serialize)]
pub(super) struct LicensesResponse {
    worldpack_id: String,
    bundle_hash: String,
    compatibility_notice: &'static str,
    packs: Vec<SeedLicenseRecord>,
}

pub(super) fn licenses_response() -> LicensesResponse {
    LicensesResponse {
        worldpack_id: active_content().manifest.id.clone(),
        bundle_hash: active_content().manifest.bundle_hash.clone(),
        compatibility_notice:
            "5E compatible. Not affiliated with or endorsed by Wizards of the Coast.",
        packs: active_content().licenses.clone(),
    }
}

pub(super) async fn licenses_view() -> Json<LicensesResponse> {
    Json(licenses_response())
}

#[derive(Clone, Debug, Serialize)]
struct ContentPackView {
    id: String,
    name: String,
    description: String,
    version: String,
    kind: String,
    license: String,
    dependencies: Vec<String>,
    distribution: Option<SeedPackDistribution>,
    asset_providers: Vec<AssetProviderView>,
    installed: bool,
    visible: bool,
    entry_location_id: Option<u64>,
    resource_counts: BTreeMap<String, usize>,
    locations: Vec<ContentPackLocationView>,
}

#[derive(Clone, Debug, Serialize)]
struct AssetProviderView {
    provider: String,
    mount: String,
    public_prefix: String,
    content_hash: String,
    cache_namespace: String,
    optional: bool,
}

#[derive(Clone, Debug, Serialize)]
struct ContentPackLocationView {
    id: u64,
    name: String,
    relationship: String,
}

fn location_name(location_id: u64) -> String {
    active_content()
        .locations
        .iter()
        .find(|location| location.id == location_id)
        .map(|location| location.name.clone())
        .unwrap_or_else(|| format!("Location {location_id}"))
}

fn location_view(location_id: u64, relationship: &str) -> ContentPackLocationView {
    ContentPackLocationView {
        id: location_id,
        name: location_name(location_id),
        relationship: relationship.to_string(),
    }
}

fn pack_entry_location(pack_id: &str, authored_location_ids: &[u64]) -> Option<u64> {
    active_content()
        .character_creation
        .iter()
        .find(|bundle| bundle.pack_id == pack_id)
        .and_then(|bundle| bundle.profiles.first())
        .map(|profile| profile.entry_location_id)
        .or_else(|| {
            content_registry()
                .pack(pack_id)?
                .entry_points
                .iter()
                .find_map(|entry| {
                    (entry.get("kind")?.as_str()? == "location").then_some(())?;
                    let location_id = entry
                        .get("id")?
                        .as_str()?
                        .rsplit('/')
                        .next()?
                        .parse::<u64>()
                        .ok()?;
                    authored_location_ids
                        .contains(&location_id)
                        .then_some(location_id)
                })
        })
        .or_else(|| authored_location_ids.first().copied())
}

fn content_pack_views() -> Vec<ContentPackView> {
    let content = active_content();
    content
        .manifest
        .packs
        .iter()
        .map(|pack| {
            let mut authored_location_ids = content_registry().location_ids_for_pack(&pack.id);
            authored_location_ids.sort_unstable();
            ContentPackView {
                id: pack.id.clone(),
                name: pack.name.clone(),
                description: pack.description.clone(),
                version: pack.version.clone(),
                kind: pack.kind.clone(),
                license: pack.license.clone(),
                dependencies: pack.dependencies.clone(),
                distribution: pack.distribution.clone(),
                asset_providers: content_registry()
                    .asset_mounts()
                    .iter()
                    .filter(|mount| mount.pack_id == pack.id)
                    .map(|mount| AssetProviderView {
                        provider: mount.provider.clone(),
                        mount: mount.mount.clone(),
                        public_prefix: mount.public_prefix.clone(),
                        content_hash: mount.content_hash.clone(),
                        cache_namespace: mount.cache_namespace(),
                        optional: mount.optional,
                    })
                    .collect(),
                installed: true,
                visible: true,
                entry_location_id: pack_entry_location(&pack.id, &authored_location_ids),
                resource_counts: pack.resource_counts.clone(),
                locations: authored_location_ids
                    .iter()
                    .map(|location_id| location_view(*location_id, "authored"))
                    .collect(),
            }
        })
        .collect()
}

pub(super) fn content_packs_response() -> ContentPacksResponse {
    ContentPacksResponse {
        worldpack_id: active_content().manifest.id.clone(),
        bundle_hash: active_content().manifest.bundle_hash.clone(),
        packs: content_pack_views(),
    }
}

pub(super) async fn content_packs_view() -> Json<ContentPacksResponse> {
    Json(content_packs_response())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn public_licenses_include_every_mounted_pack_and_exact_srd_notice() {
        let response = licenses_response();
        assert_eq!(response.packs.len(), active_content().manifest.packs.len());
        let lantern = response
            .packs
            .iter()
            .find(|pack| pack.pack_id == "cosyworld.campaign.the-lantern-keeper")
            .expect("Lantern Keeper license record");
        assert_eq!(lantern.license_identifier, "CC-BY-4.0");
        assert_eq!(
            lantern.license_url,
            "https://creativecommons.org/licenses/by/4.0/"
        );
        assert!(lantern.notices.iter().any(|notice| {
            notice.kind == "attribution"
                && notice.text.contains("System Reference Document 5.1")
                && notice
                    .text
                    .contains("creativecommons.org/licenses/by/4.0/legalcode")
        }));
    }

    #[test]
    fn catalog_projects_every_mounted_pack_as_public_content() {
        let public = content_packs_response();
        assert_eq!(public.packs.len(), 11);
        let core = public
            .packs
            .iter()
            .find(|pack| pack.id == "cosyworld.core")
            .expect("core pack");
        assert!(core.resource_counts["locations"] > 0);
        assert_eq!(core.asset_providers.len(), 2);
        assert!(core.asset_providers.iter().all(|provider| {
            provider.provider == "cosyworld.core/assets"
                && provider.cache_namespace.contains("cosyworld.core@1.3.11")
                && provider.content_hash.starts_with("sha256:")
        }));

        let ruby = public
            .packs
            .iter()
            .find(|pack| pack.id == "ruby-high.first-bell")
            .expect("Ruby High pack");
        assert_eq!(ruby.kind, "world");
        assert_eq!(ruby.entry_location_id, Some(11));
        assert_eq!(ruby.locations.len(), 6);
        assert_eq!(ruby.asset_providers.len(), 1);
        assert_eq!(
            ruby.asset_providers[0].provider,
            "ruby-high.first-bell/assets"
        );
        assert_eq!(
            ruby.distribution
                .as_ref()
                .map(|value| value.permanence.as_str()),
            Some("content-addressed")
        );
    }
}
