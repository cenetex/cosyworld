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
    entitlement_authorities: Vec<SeedEntitlementAuthority>,
    installed: bool,
    visible: bool,
    entitled: bool,
    access_state: String,
    access_summary: String,
    entry_location_id: Option<u64>,
    resource_counts: BTreeMap<String, usize>,
    required_grant_ids: Vec<String>,
    granted_entitlement_ids: Vec<String>,
    required_card_ids: Vec<String>,
    owned_required_card_ids: Vec<String>,
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
    public: bool,
    accessible: bool,
    required_grant_id: Option<String>,
    required_card_id: Option<String>,
    access_reason: Option<String>,
}

fn entitlement_pack_id_for_gate(gate: &SeedAccessGateContent) -> Option<String> {
    active_content()
        .manifest
        .packs
        .iter()
        .find(|pack| {
            pack.entitlements.as_ref().is_some_and(|entitlements| {
                entitlements
                    .grants
                    .iter()
                    .any(|grant| grant.id == gate.required_grant_id)
            })
        })
        .map(|pack| pack.id.clone())
        .or_else(|| seed_pack_id_for_location(gate.location_id))
}

fn location_name(location_id: u64) -> String {
    active_content()
        .locations
        .iter()
        .find(|location| location.id == location_id)
        .map(|location| location.name.clone())
        .unwrap_or_else(|| format!("Location {location_id}"))
}

fn location_view(
    location_id: u64,
    relationship: &str,
    access: &AccessContext,
) -> ContentPackLocationView {
    let rule = location_access_rule(location_id);
    let accessible = location_access_allowed(location_id, access);
    ContentPackLocationView {
        id: location_id,
        name: location_name(location_id),
        relationship: relationship.to_string(),
        public: rule.required_grant_id.is_none() && rule.required_card_id.is_none(),
        accessible,
        required_grant_id: rule.required_grant_id.map(ToString::to_string),
        required_card_id: rule.required_card_id.map(ToString::to_string),
        access_reason: (!accessible)
            .then(|| rule.reason.map(ToString::to_string))
            .flatten(),
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

fn content_pack_views(access: &AccessContext) -> Vec<ContentPackView> {
    let content = active_content();
    content
        .manifest
        .packs
        .iter()
        .map(|pack| {
            let mut authored_location_ids = content_registry().location_ids_for_pack(&pack.id);
            authored_location_ids.sort_unstable();

            let controlled_gates = content
                .access_gates
                .iter()
                .filter(|gate| entitlement_pack_id_for_gate(gate).as_deref() == Some(&pack.id))
                .collect::<Vec<_>>();
            let controlled_location_ids = controlled_gates
                .iter()
                .map(|gate| gate.location_id)
                .collect::<BTreeSet<_>>();
            let delegated_location_ids = content
                .access_gates
                .iter()
                .filter(|gate| {
                    seed_pack_id_for_location(gate.location_id).as_deref() == Some(pack.id.as_str())
                        && entitlement_pack_id_for_gate(gate).as_deref() != Some(pack.id.as_str())
                })
                .map(|gate| gate.location_id)
                .collect::<BTreeSet<_>>();
            let required_grant_ids = controlled_gates
                .iter()
                .map(|gate| gate.required_grant_id.clone())
                .collect::<Vec<_>>();
            let granted_entitlement_ids = required_grant_ids
                .iter()
                .filter(|grant_id| access.has_grant(grant_id))
                .cloned()
                .collect::<Vec<_>>();
            let required_card_ids = required_grant_ids
                .iter()
                .filter_map(|grant_id| {
                    entitlement_grant_asset_id(grant_id).map(ToString::to_string)
                })
                .collect::<Vec<_>>();
            let owned_required_card_ids = required_card_ids
                .iter()
                .filter(|card_id| access.owns_card(card_id))
                .cloned()
                .collect::<Vec<_>>();

            let (access_state, access_summary, entitled) = if required_grant_ids.is_empty() {
                if matches!(pack.kind.as_str(), "rules" | "assets" | "catalog") {
                    ("included", "Included with this world.", true)
                } else {
                    ("public", "Open to every traveler.", true)
                }
            } else if granted_entitlement_ids.len() == required_grant_ids.len() {
                (
                    "entitled",
                    "Every access-gated place in this pack is open.",
                    true,
                )
            } else if granted_entitlement_ids.is_empty() {
                (
                    "locked",
                    "Location cards open this expansion one place at a time.",
                    false,
                )
            } else {
                (
                    "partial",
                    "Some places are open; more location cards remain to be found.",
                    false,
                )
            };

            let locations = if controlled_location_ids.is_empty() {
                authored_location_ids
                    .iter()
                    .filter(|location_id| !delegated_location_ids.contains(location_id))
                    .map(|location_id| location_view(*location_id, "authored", access))
                    .collect()
            } else {
                controlled_location_ids
                    .iter()
                    .map(|location_id| location_view(*location_id, "access", access))
                    .collect()
            };

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
                entitlement_authorities: pack
                    .entitlements
                    .as_ref()
                    .map(|entitlements| entitlements.authorities.clone())
                    .unwrap_or_default(),
                installed: true,
                visible: true,
                entitled,
                access_state: access_state.to_string(),
                access_summary: access_summary.to_string(),
                entry_location_id: pack_entry_location(&pack.id, &authored_location_ids),
                resource_counts: pack.resource_counts.clone(),
                required_grant_ids,
                granted_entitlement_ids,
                required_card_ids,
                owned_required_card_ids,
                locations,
            }
        })
        .collect()
}

pub(super) fn content_packs_response(access: &AccessContext) -> ContentPacksResponse {
    ContentPacksResponse {
        worldpack_id: active_content().manifest.id.clone(),
        bundle_hash: active_content().manifest.bundle_hash.clone(),
        packs: content_pack_views(access),
    }
}

pub(super) async fn content_packs_view(
    State(state): State<AppState>,
    Query(query): Query<StateQuery>,
) -> Json<ContentPacksResponse> {
    let ownership = state.ownership_snapshot().await;
    let access = AccessContext::from_query(
        &query,
        &ownership,
        state.trust_client_card_ids,
        &state.wallet_sessions,
        state.allow_unsigned_wallet_claims,
    );
    Json(content_packs_response(&access))
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
    fn catalog_projects_public_locked_partial_and_entitled_access() {
        let public = content_packs_response(&AccessContext::default());
        assert_eq!(public.packs.len(), 8);
        let core = public
            .packs
            .iter()
            .find(|pack| pack.id == "cosyworld.core")
            .expect("core pack");
        assert_eq!(core.access_state, "public");
        assert!(core.entitled);
        assert!(core.resource_counts["locations"] > 0);
        assert_eq!(core.asset_providers.len(), 2);
        assert!(core.asset_providers.iter().all(|provider| {
            provider.provider == "cosyworld.core/assets"
                && provider.cache_namespace.contains("cosyworld.core@1.3.5")
                && provider.content_hash.starts_with("sha256:")
        }));

        let ruby = public
            .packs
            .iter()
            .find(|pack| pack.id == "ruby-high.first-bell")
            .expect("Ruby High pack");
        assert_eq!(ruby.kind, "world");
        assert_eq!(ruby.entry_location_id, Some(11));
        assert_eq!(ruby.access_state, "locked");
        assert!(!ruby.entitled);
        assert_eq!(ruby.locations.len(), 6);
        assert_eq!(ruby.required_grant_ids.len(), 6);
        assert_eq!(ruby.entitlement_authorities.len(), 1);
        assert_eq!(ruby.entitlement_authorities[0].kind, "asset_feed");
        assert_eq!(
            ruby.entitlement_authorities[0].provider,
            "ruby-high.first-bell/entitlements"
        );
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

        let partial = AccessContext::from_parts(
            Some("wallet"),
            [Some("location-library")],
            &OwnershipIndex::default(),
        );
        let partial = content_packs_response(&partial);
        let ruby = partial
            .packs
            .iter()
            .find(|pack| pack.id == "ruby-high.first-bell")
            .expect("Ruby High pack");
        assert_eq!(ruby.access_state, "partial");

        let all_cards = active_content()
            .access_gates
            .iter()
            .filter_map(|gate| gate.required_card_id.as_deref())
            .collect::<Vec<_>>()
            .join(",");
        let entitled = AccessContext::from_parts(
            Some("wallet"),
            [Some(all_cards.as_str())],
            &OwnershipIndex::default(),
        );
        let entitled = content_packs_response(&entitled);
        let ruby = entitled
            .packs
            .iter()
            .find(|pack| pack.id == "ruby-high.first-bell")
            .expect("Ruby High pack");
        assert_eq!(ruby.access_state, "entitled");
        assert!(ruby.entitled);
    }

    #[test]
    fn protected_feed_can_supply_declared_private_grants_without_asset_details() {
        let ownership = OwnershipIndex::parse(
            r#"{
              "wallets": [{
                "walletAddress": "private-wallet",
                "grantIds": [
                  "ruby-high.first-bell:location-library",
                  "unknown.pack:forged-grant"
                ]
              }]
            }"#,
        );
        let access = AccessContext::from_parts(Some("private-wallet"), [None], &ownership);
        assert!(access.has_grant("ruby-high.first-bell:location-library"));
        assert!(!access.has_grant("unknown.pack:forged-grant"));
        assert!(location_access_allowed(12, &access));

        let response = content_packs_response(&access);
        let ruby = response
            .packs
            .iter()
            .find(|pack| pack.id == "ruby-high.first-bell")
            .expect("Ruby High pack");
        assert_eq!(ruby.access_state, "partial");
        assert!(ruby
            .granted_entitlement_ids
            .contains(&"ruby-high.first-bell:location-library".to_string()));
    }
}
