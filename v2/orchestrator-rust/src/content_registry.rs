use super::*;

const CONTENT_REGISTRY_SCHEMA_VERSION: u32 = 1;
const CONTENT_PACK_CONTRACT: &str = "cosyworld.content-pack/1";
const CONTENT_REFERENCE_SCHEMA_VERSION: u32 = 1;

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
pub(super) struct ContentReferenceEntry {
    pub(super) canonical_ref: String,
    pub(super) pack_id: String,
    pub(super) pack_version: String,
    pub(super) kind: String,
    pub(super) local_id: String,
    pub(super) runtime_handle: u64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(super) legacy_runtime_id: Option<u64>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
struct ContentReferenceDocument {
    schema_version: u32,
    mapping_version: u32,
    entries: Vec<ContentReferenceEntry>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub(super) struct ActiveRulesetContext {
    pub(super) selected_by_pack_id: String,
    pub(super) capability_id: String,
    pub(super) provider_pack_id: String,
    pub(super) provider_pack_version: String,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct PackRulesContextExtension {
    schema_version: u8,
    zones: Vec<ZoneRulesetSelector>,
    #[serde(default, rename = "vocabulary")]
    _vocabulary: serde_json::Value,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct ZoneRulesetSelector {
    zone: String,
    ruleset: String,
}

#[derive(Clone, Debug, Default, Deserialize, Eq, PartialEq, Serialize)]
pub(super) struct ContentReferenceContext {
    pub(super) mapping_version: u32,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub(super) references: Vec<ContentReferenceEntry>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub(super) active_rulesets: Vec<ActiveRulesetContext>,
}

#[derive(Clone, Debug, Default, Deserialize, PartialEq, Serialize)]
#[serde(transparent)]
pub(super) struct PackMountState(pub(super) serde_json::Value);

impl PackMountState {
    pub(super) fn is_empty(&self) -> bool {
        self.0.is_null()
    }
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct CompiledContentRegistry {
    schema_version: u32,
    manifest: SeedWorldpackManifest,
    #[serde(default)]
    resources: BTreeMap<String, serde_json::Value>,
    #[serde(default)]
    external_cards: Vec<ExternalCardSpec>,
    #[serde(default)]
    assets: Vec<SeedAssetMount>,
    #[serde(default)]
    rules: Vec<SeedRuleBundle>,
    #[serde(default)]
    contributions: Vec<SeedContributionBundle>,
    #[serde(default)]
    attributions: Vec<SeedAttribution>,
    #[serde(default)]
    licenses: Vec<SeedLicenseRecord>,
    #[serde(default)]
    modified_material: Vec<SeedModifiedMaterial>,
    #[serde(default)]
    character_creation: Vec<SeedCharacterCreationBundle>,
    content_references: ContentReferenceDocument,
}

#[derive(Debug)]
pub(super) struct ContentRegistry {
    content: SeedContent,
    runtime_entry_location_id: Option<u64>,
    packs_by_id: BTreeMap<String, usize>,
    capability_providers: BTreeMap<String, String>,
    content_reference_mapping_version: u32,
    content_references_by_canonical: BTreeMap<String, ContentReferenceEntry>,
    content_references_by_handle: BTreeMap<u64, String>,
    legacy_content_references: BTreeMap<(String, u64), String>,
    active_rulesets: Vec<ActiveRulesetContext>,
    zone_rulesets: BTreeMap<(String, String), String>,
    // Kept mounted for pack-aware consumers added by later engine versions.
    #[allow(dead_code)]
    additional_resources: BTreeMap<String, serde_json::Value>,
}

impl ContentRegistry {
    pub(super) fn from_json(value: &str, engine_version: &str) -> Result<Self, String> {
        let document: CompiledContentRegistry = parse_seed_json("content registry", value)?;
        Self::from_document(document, engine_version)
    }

    fn from_document(
        mut document: CompiledContentRegistry,
        engine_version: &str,
    ) -> Result<Self, String> {
        if document.schema_version != CONTENT_REGISTRY_SCHEMA_VERSION {
            return Err(format!(
                "content registry schema version {} is unsupported; expected {}",
                document.schema_version, CONTENT_REGISTRY_SCHEMA_VERSION
            ));
        }
        if document.manifest.pack_contract != CONTENT_PACK_CONTRACT {
            return Err(format!(
                "content registry uses pack contract {:?}; expected {CONTENT_PACK_CONTRACT}",
                document.manifest.pack_contract
            ));
        }
        validate_worldpack_manifest(&document.manifest)?;
        let (ordered_packs, capability_providers) =
            resolve_pack_graph(&document.manifest.packs, engine_version)?;
        document.manifest.packs = ordered_packs;

        let mut resources = document.resources;
        let content_references = document.content_references;
        let content = SeedContent {
            manifest: document.manifest,
            actors: take_resource(&mut resources, "actors")?,
            actor_model_bindings: take_resource(&mut resources, "actor_model_bindings")?,
            actor_facets: take_resource(&mut resources, "actor_facets")?,
            access_gates: take_resource(&mut resources, "access_gates")?,
            factions: take_resource(&mut resources, "factions")?,
            items: take_resource(&mut resources, "items")?,
            locations: take_resource(&mut resources, "locations")?,
            exits: take_resource(&mut resources, "exits")?,
            hidden_exits: take_resource(&mut resources, "hidden_exits")?,
            room_features: take_resource(&mut resources, "room_features")?,
            spatial_scenes: take_resource(&mut resources, "spatial_scenes")?,
            room_sheets: take_resource(&mut resources, "room_sheets")?,
            clocks: take_resource(&mut resources, "clocks")?,
            jobs: take_resource(&mut resources, "jobs")?,
            action_vocabulary: take_resource(&mut resources, "action_vocabulary")?,
            fronts: take_resource(&mut resources, "fronts")?,
            cards: take_resource(&mut resources, "cards")?,
            card_bindings: take_resource(&mut resources, "card_bindings")?,
            lifecycle_hooks: take_resource(&mut resources, "lifecycle_hooks")?,
            evolution_tracks: take_resource(&mut resources, "evolution_tracks")?,
            avatar_level_tracks: take_resource(&mut resources, "avatar_level_tracks")?,
            recipes: take_resource(&mut resources, "recipes")?,
            rules: document.rules,
            contributions: document.contributions,
            attributions: document.attributions,
            licenses: document.licenses,
            modified_material: document.modified_material,
            character_creation: document.character_creation,
            external_cards: document.external_cards,
            asset_mounts: document.assets,
        };
        validate_seed_content(&content)?;
        let packs_by_id = content
            .manifest
            .packs
            .iter()
            .enumerate()
            .map(|(index, pack)| (pack.id.clone(), index))
            .collect();
        let (
            content_reference_mapping_version,
            content_references_by_canonical,
            content_references_by_handle,
            legacy_content_references,
        ) = validate_content_references(&content, content_references)?;
        let active_rulesets = content
            .manifest
            .packs
            .iter()
            .filter_map(|pack| {
                let capability_id = pack.default_ruleset.as_ref()?;
                let provider_id = capability_providers.get(capability_id)?;
                let provider = content
                    .manifest
                    .packs
                    .iter()
                    .find(|candidate| &candidate.id == provider_id)?;
                Some(ActiveRulesetContext {
                    selected_by_pack_id: pack.id.clone(),
                    capability_id: capability_id.clone(),
                    provider_pack_id: provider.id.clone(),
                    provider_pack_version: provider.version.clone(),
                })
            })
            .collect();
        let mut zone_rulesets = BTreeMap::new();
        for pack in &content.manifest.packs {
            let Some(value) = pack.extensions.get("x-cosyworld-rules-context") else {
                continue;
            };
            let config: PackRulesContextExtension =
                serde_json::from_value(value.clone()).map_err(|error| {
                    format!(
                        "pack {} has invalid x-cosyworld-rules-context: {error}",
                        pack.id
                    )
                })?;
            if config.schema_version != 1 {
                return Err(format!(
                    "pack {} has unsupported rules context schema {}",
                    pack.id, config.schema_version
                ));
            }
            for selector in config.zones {
                if selector.zone.trim().is_empty()
                    || selector.ruleset.trim().is_empty()
                    || zone_rulesets
                        .insert((pack.id.clone(), selector.zone.clone()), selector.ruleset)
                        .is_some()
                {
                    return Err(format!(
                        "pack {} has invalid or conflicting rules selector for zone {}",
                        pack.id, selector.zone
                    ));
                }
            }
        }
        let registry = Self {
            runtime_entry_location_id: manifest_entry_location_id(&content),
            content,
            packs_by_id,
            capability_providers,
            content_reference_mapping_version,
            content_references_by_canonical,
            content_references_by_handle,
            legacy_content_references,
            active_rulesets,
            zone_rulesets,
            additional_resources: resources,
        };
        for pack in &registry.content.manifest.packs {
            let Some(default_ruleset) = pack.default_ruleset.as_deref() else {
                continue;
            };
            registry.validate_pack_ruleset_reference(pack, default_ruleset)?;
        }
        for ((pack_id, _), ruleset) in &registry.zone_rulesets {
            let pack = registry
                .pack(pack_id)
                .expect("zone rules selector pack exists");
            registry.validate_pack_ruleset_reference(pack, ruleset)?;
        }
        for location in &registry.content.locations {
            let Some(ruleset) = location.ruleset.as_deref() else {
                continue;
            };
            let pack = registry.pack(&location.pack_id).ok_or_else(|| {
                format!(
                    "location {} references missing pack {}",
                    location.id, location.pack_id
                )
            })?;
            registry.validate_pack_ruleset_reference(pack, ruleset)?;
        }
        Ok(registry)
    }

    pub(super) fn content(&self) -> &SeedContent {
        &self.content
    }

    pub(super) fn pack(&self, pack_id: &str) -> Option<&SeedWorldpackPack> {
        self.packs_by_id
            .get(pack_id)
            .and_then(|index| self.content.manifest.packs.get(*index))
    }

    pub(super) fn capability_provider(&self, capability_id: &str) -> Option<&str> {
        self.capability_providers
            .get(capability_id)
            .map(String::as_str)
    }

    fn validate_pack_ruleset_reference(
        &self,
        pack: &SeedWorldpackPack,
        ruleset: &str,
    ) -> Result<(), String> {
        let declared = pack
            .capabilities
            .iter()
            .any(|capability| capability.id == ruleset && capability.kind == "rules")
            || pack
                .dependency_requirements
                .iter()
                .any(|dependency| dependency.capabilities.iter().any(|id| id == ruleset));
        if !declared {
            return Err(format!(
                "pack {}@{} selects undeclared rules capability {}",
                pack.id, pack.version, ruleset
            ));
        }
        let provider_id = self.capability_provider(ruleset).ok_or_else(|| {
            format!(
                "pack {}@{} selects unavailable rules capability {}",
                pack.id, pack.version, ruleset
            )
        })?;
        let provider = self.pack(provider_id).expect("capability provider exists");
        if !provider
            .capabilities
            .iter()
            .any(|capability| capability.id == ruleset && capability.kind == "rules")
        {
            return Err(format!(
                "pack {}@{} selects non-rules capability {} from {}@{}",
                pack.id, pack.version, ruleset, provider.id, provider.version
            ));
        }
        Ok(())
    }

    fn with_runtime_entry_location_id(mut self, location_id: u64) -> Result<Self, String> {
        let Some(location) = self
            .content
            .locations
            .iter()
            .find(|location| location.id == location_id)
        else {
            return Err(format!(
                "COSYWORLD_ENTRY_LOCATION_ID references missing location {location_id} in worldpack {}",
                self.content.manifest.id
            ));
        };
        self.runtime_entry_location_id = Some(location.id);
        Ok(self)
    }
}

fn valid_pack_id(value: &str) -> bool {
    !value.is_empty()
        && value.bytes().enumerate().all(|(index, byte)| {
            byte.is_ascii_lowercase()
                || byte.is_ascii_digit()
                || (index > 0 && matches!(byte, b'.' | b'-'))
        })
}

fn manifest_entry_location_id(content: &SeedContent) -> Option<u64> {
    let location_id = content
        .manifest
        .entry_location
        .rsplit('/')
        .next()?
        .parse::<u64>()
        .ok()?;
    content
        .locations
        .iter()
        .any(|location| location.id == location_id)
        .then_some(location_id)
}

fn valid_content_kind(value: &str) -> bool {
    !value.is_empty()
        && value.bytes().enumerate().all(|(index, byte)| {
            byte.is_ascii_lowercase() || (index > 0 && (byte.is_ascii_digit() || byte == b'-'))
        })
}

fn encode_content_local_id(value: &str) -> String {
    let mut encoded = String::new();
    for byte in value.bytes() {
        if byte.is_ascii_alphanumeric()
            || matches!(
                byte,
                b'-' | b'_' | b'.' | b'!' | b'~' | b'*' | b'\'' | b'(' | b')'
            )
        {
            encoded.push(char::from(byte));
        } else {
            encoded.push_str(&format!("%{byte:02X}"));
        }
    }
    encoded
}

fn canonical_content_reference(
    pack_id: &str,
    kind: &str,
    local_id: &str,
) -> Result<String, String> {
    if !valid_pack_id(pack_id) || !valid_content_kind(kind) || local_id.is_empty() {
        return Err(format!(
            "invalid content reference identity {pack_id}/{kind}/{local_id}"
        ));
    }
    Ok(format!(
        "pack://{pack_id}/{kind}/{}",
        encode_content_local_id(local_id)
    ))
}

fn validate_content_references(
    content: &SeedContent,
    document: ContentReferenceDocument,
) -> Result<
    (
        u32,
        BTreeMap<String, ContentReferenceEntry>,
        BTreeMap<u64, String>,
        BTreeMap<(String, u64), String>,
    ),
    String,
> {
    if document.schema_version != CONTENT_REFERENCE_SCHEMA_VERSION
        || document.mapping_version != content.manifest.canonical_id_mapping_version
    {
        return Err(format!(
            "content reference schema/mapping version {}/{} does not match supported {}/{}",
            document.schema_version,
            document.mapping_version,
            CONTENT_REFERENCE_SCHEMA_VERSION,
            content.manifest.canonical_id_mapping_version
        ));
    }
    let packs = content
        .manifest
        .packs
        .iter()
        .map(|pack| (pack.id.as_str(), pack.version.as_str()))
        .collect::<BTreeMap<_, _>>();
    let mut by_canonical = BTreeMap::new();
    let mut by_handle = BTreeMap::new();
    let mut by_legacy = BTreeMap::new();
    let mut previous = None::<String>;
    for entry in document.entries {
        let expected = canonical_content_reference(&entry.pack_id, &entry.kind, &entry.local_id)?;
        if entry.canonical_ref != expected {
            return Err(format!(
                "content reference {} is not canonical; expected {}",
                entry.canonical_ref, expected
            ));
        }
        if previous
            .as_deref()
            .is_some_and(|value| value >= entry.canonical_ref.as_str())
        {
            return Err("content references are not in deterministic canonical order".to_string());
        }
        previous = Some(entry.canonical_ref.clone());
        if packs.get(entry.pack_id.as_str()).copied() != Some(entry.pack_version.as_str()) {
            return Err(format!(
                "content reference {} names unavailable pack version {}@{}",
                entry.canonical_ref, entry.pack_id, entry.pack_version
            ));
        }
        if entry.runtime_handle == 0 {
            return Err(format!(
                "content reference {} has zero runtime handle",
                entry.canonical_ref
            ));
        }
        if let Some(legacy) = entry.legacy_runtime_id {
            if legacy != entry.runtime_handle {
                return Err(format!(
                    "legacy content reference {} remaps {} to {}",
                    entry.canonical_ref, legacy, entry.runtime_handle
                ));
            }
            if by_legacy
                .insert((entry.kind.clone(), legacy), entry.canonical_ref.clone())
                .is_some()
            {
                return Err(format!("duplicate legacy {} handle {}", entry.kind, legacy));
            }
        }
        if let Some(existing) = by_handle.insert(entry.runtime_handle, entry.canonical_ref.clone())
        {
            return Err(format!(
                "runtime handle {} collides between {} and {}",
                entry.runtime_handle, existing, entry.canonical_ref
            ));
        }
        let canonical = entry.canonical_ref.clone();
        if by_canonical.insert(canonical.clone(), entry).is_some() {
            return Err(format!("duplicate canonical content reference {canonical}"));
        }
    }
    for (kind, pack_id, runtime_handle) in content
        .actors
        .iter()
        .map(|row| ("actor", row.pack_id.as_str(), row.id))
        .chain(
            content
                .items
                .iter()
                .map(|row| ("item", row.pack_id.as_str(), row.id)),
        )
        .chain(
            content
                .locations
                .iter()
                .map(|row| ("location", row.pack_id.as_str(), row.id)),
        )
    {
        let Some(canonical) = by_legacy.get(&(kind.to_string(), runtime_handle)) else {
            return Err(format!(
                "compiled {kind} {runtime_handle} has no legacy content reference"
            ));
        };
        if by_canonical
            .get(canonical)
            .map(|entry| entry.pack_id.as_str())
            != Some(pack_id)
        {
            return Err(format!(
                "compiled {kind} {runtime_handle} content reference has the wrong pack"
            ));
        }
    }
    Ok((document.mapping_version, by_canonical, by_handle, by_legacy))
}

fn take_resource<T: DeserializeOwned>(
    resources: &mut BTreeMap<String, serde_json::Value>,
    kind: &str,
) -> Result<Vec<T>, String> {
    let Some(value) = resources.remove(kind) else {
        return Ok(Vec::new());
    };
    serde_json::from_value(value).map_err(|error| format!("registry resource {kind}: {error}"))
}

pub(super) fn configured_content_registry() -> Result<&'static ContentRegistry, String> {
    static REGISTRY: OnceLock<Result<ContentRegistry, String>> = OnceLock::new();
    REGISTRY
        .get_or_init(load_configured_registry)
        .as_ref()
        .map_err(Clone::clone)
}

pub(super) fn content_engine_version() -> &'static str {
    include_str!("../../content-engine-version.txt").trim()
}

pub(super) fn content_registry() -> &'static ContentRegistry {
    configured_content_registry().expect("configured CosyWorld content registry must load")
}

pub(super) fn active_content() -> &'static SeedContent {
    content_registry().content()
}

fn load_configured_registry() -> Result<ContentRegistry, String> {
    let path = std::env::var("COSYWORLD_CONTENT_REGISTRY_PATH")
        .map(PathBuf::from)
        .unwrap_or_else(|_| configured_content_root().join("official/registry.json"));
    let value = fs::read_to_string(&path)
        .map_err(|error| format!("content registry {}: {error}", path.display()))?;
    let registry = ContentRegistry::from_json(&value, content_engine_version())
        .map_err(|error| format!("content registry {}: {error}", path.display()))?;
    let Some(configured_entry) = std::env::var("COSYWORLD_ENTRY_LOCATION_ID")
        .ok()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
    else {
        return Ok(registry);
    };
    let location_id = configured_entry.parse::<u64>().map_err(|_| {
        format!("COSYWORLD_ENTRY_LOCATION_ID must be a positive integer; got {configured_entry:?}")
    })?;
    if location_id == 0 {
        return Err("COSYWORLD_ENTRY_LOCATION_ID must be greater than zero".to_string());
    }
    registry.with_runtime_entry_location_id(location_id)
}

#[derive(Clone, Debug, Eq, PartialEq)]
struct ParsedSemver {
    major: u64,
    minor: u64,
    patch: u64,
    prerelease: Option<String>,
}

impl Ord for ParsedSemver {
    fn cmp(&self, other: &Self) -> std::cmp::Ordering {
        self.major
            .cmp(&other.major)
            .then_with(|| self.minor.cmp(&other.minor))
            .then_with(|| self.patch.cmp(&other.patch))
            .then_with(|| match (&self.prerelease, &other.prerelease) {
                (None, None) => std::cmp::Ordering::Equal,
                (None, Some(_)) => std::cmp::Ordering::Greater,
                (Some(_), None) => std::cmp::Ordering::Less,
                (Some(left), Some(right)) => left.cmp(right),
            })
    }
}

impl PartialOrd for ParsedSemver {
    fn partial_cmp(&self, other: &Self) -> Option<std::cmp::Ordering> {
        Some(self.cmp(other))
    }
}

fn parse_semver(value: &str, label: &str) -> Result<ParsedSemver, String> {
    let (without_build, build) = value
        .split_once('+')
        .map_or((value, None), |(version, suffix)| (version, Some(suffix)));
    let (core, prerelease) = without_build
        .split_once('-')
        .map_or((without_build, None), |(version, suffix)| {
            (version, Some(suffix.to_string()))
        });
    let parts = core.split('.').collect::<Vec<_>>();
    if parts.len() != 3
        || parts.iter().any(|part| {
            part.is_empty()
                || (part.len() > 1 && part.starts_with('0'))
                || !part.chars().all(|character| character.is_ascii_digit())
        })
        || prerelease.as_deref().is_some_and(str::is_empty)
        || prerelease.as_deref().is_some_and(|suffix| {
            !suffix.chars().all(|character| {
                character.is_ascii_alphanumeric() || matches!(character, '.' | '-')
            })
        })
        || build.is_some_and(|suffix| {
            suffix.is_empty()
                || !suffix.chars().all(|character| {
                    character.is_ascii_alphanumeric() || matches!(character, '.' | '-')
                })
        })
    {
        return Err(format!("{label} {value:?} is not semantic versioning"));
    }
    Ok(ParsedSemver {
        major: parts[0]
            .parse()
            .map_err(|_| format!("{label} {value:?} is invalid"))?,
        minor: parts[1]
            .parse()
            .map_err(|_| format!("{label} {value:?} is invalid"))?,
        patch: parts[2]
            .parse()
            .map_err(|_| format!("{label} {value:?} is invalid"))?,
        prerelease,
    })
}

fn version_satisfies(version: &str, range: &str, label: &str) -> Result<bool, String> {
    let candidate = parse_semver(version, label)?;
    let comparators = range.split_whitespace().collect::<Vec<_>>();
    if comparators.is_empty() {
        return Err(format!("{label} is empty"));
    }
    comparators
        .into_iter()
        .try_fold(true, |matches, comparator| {
            let (operator, expected) = if let Some(value) = comparator.strip_prefix(">=") {
                (">=", value)
            } else if let Some(value) = comparator.strip_prefix("<=") {
                ("<=", value)
            } else if let Some(value) = comparator.strip_prefix('>') {
                (">", value)
            } else if let Some(value) = comparator.strip_prefix('<') {
                ("<", value)
            } else if let Some(value) = comparator.strip_prefix('=') {
                ("=", value)
            } else {
                ("=", comparator)
            };
            let expected = parse_semver(expected, label)?;
            let comparison = candidate.cmp(&expected);
            let comparator_matches = match operator {
                ">=" => comparison.is_ge(),
                "<=" => comparison.is_le(),
                ">" => comparison.is_gt(),
                "<" => comparison.is_lt(),
                _ => comparison.is_eq(),
            };
            Ok(matches && comparator_matches)
        })
}

fn resolve_pack_graph(
    packs: &[SeedWorldpackPack],
    engine_version: &str,
) -> Result<(Vec<SeedWorldpackPack>, BTreeMap<String, String>), String> {
    parse_semver(engine_version, "engine version")?;
    let mut by_id = BTreeMap::new();
    let mut capability_providers = BTreeMap::new();
    for (index, pack) in packs.iter().enumerate() {
        if let Some(existing_index) = by_id.insert(pack.id.clone(), index) {
            let existing = &packs[existing_index];
            return Err(format!(
                "duplicate pack {} mounted as {} and {}",
                pack.id, existing.version, pack.version
            ));
        }
        parse_semver(&pack.version, &format!("pack {} version", pack.id))?;
        if !version_satisfies(
            engine_version,
            &pack.engine,
            &format!("pack {} engine range", pack.id),
        )? {
            return Err(format!(
                "pack {}@{} requires engine {}, current engine is {}",
                pack.id, pack.version, pack.engine, engine_version
            ));
        }
        if pack.capabilities.is_empty()
            || pack.provenance.author.trim().is_empty()
            || pack.provenance.source_name.trim().is_empty()
            || pack.provenance.source_url.trim().is_empty()
        {
            return Err(format!(
                "pack {}@{} is missing capabilities or provenance",
                pack.id, pack.version
            ));
        }
        let declared_dependencies = pack
            .dependency_requirements
            .iter()
            .map(|dependency| dependency.id.as_str())
            .collect::<Vec<_>>();
        if pack
            .dependencies
            .iter()
            .map(String::as_str)
            .collect::<Vec<_>>()
            != declared_dependencies
        {
            return Err(format!(
                "pack {}@{} has inconsistent dependency metadata",
                pack.id, pack.version
            ));
        }
        for capability in &pack.capabilities {
            if capability.id.trim().is_empty()
                || !matches!(
                    capability.kind.as_str(),
                    "world" | "rules" | "cards" | "assets" | "entitlements" | "reference"
                )
            {
                return Err(format!(
                    "pack {}@{} capability {} has unsupported kind {}",
                    pack.id, pack.version, capability.id, capability.kind
                ));
            }
            parse_semver(
                &capability.version,
                &format!("pack {} capability {}", pack.id, capability.id),
            )?;
            if let Some(existing_id) =
                capability_providers.insert(capability.id.clone(), pack.id.clone())
            {
                let existing = &packs[*by_id.get(&existing_id).expect("provider pack exists")];
                return Err(format!(
                    "duplicate capability {} provided by {}@{} and {}@{}",
                    capability.id, existing.id, existing.version, pack.id, pack.version
                ));
            }
        }
    }

    for pack in packs {
        let mut dependency_ids = BTreeSet::new();
        for dependency in &pack.dependency_requirements {
            if !dependency_ids.insert(dependency.id.as_str()) {
                return Err(format!(
                    "pack {}@{} declares dependency {} more than once",
                    pack.id, pack.version, dependency.id
                ));
            }
            if dependency.id == pack.id || dependency.capabilities.is_empty() {
                return Err(format!(
                    "pack {}@{} has invalid dependency {}",
                    pack.id, pack.version, dependency.id
                ));
            }
            version_satisfies(
                "0.0.0",
                &dependency.version,
                &format!("dependency {} range", dependency.id),
            )?;
            let Some(target_index) = by_id.get(&dependency.id) else {
                if dependency.optional {
                    continue;
                }
                return Err(format!(
                    "pack {}@{} is missing dependency {} ({})",
                    pack.id, pack.version, dependency.id, dependency.version
                ));
            };
            let target = &packs[*target_index];
            if !version_satisfies(
                &target.version,
                &dependency.version,
                &format!("dependency {} range", dependency.id),
            )? {
                return Err(format!(
                    "pack {}@{} requires {} {}, mounted {}",
                    pack.id, pack.version, dependency.id, dependency.version, target.version
                ));
            }
            let available = target
                .capabilities
                .iter()
                .map(|capability| capability.id.as_str())
                .collect::<BTreeSet<_>>();
            for capability in &dependency.capabilities {
                if !available.contains(capability.as_str()) {
                    return Err(format!(
                        "pack {}@{} requires missing capability {} from {}@{}",
                        pack.id, pack.version, capability, target.id, target.version
                    ));
                }
            }
        }
    }

    fn visit(
        pack_id: &str,
        packs: &[SeedWorldpackPack],
        by_id: &BTreeMap<String, usize>,
        visiting: &mut Vec<String>,
        visited: &mut BTreeSet<String>,
        ordered: &mut Vec<SeedWorldpackPack>,
    ) -> Result<(), String> {
        if visited.contains(pack_id) {
            return Ok(());
        }
        if let Some(cycle_start) = visiting.iter().position(|candidate| candidate == pack_id) {
            let mut cycle = visiting[cycle_start..].to_vec();
            cycle.push(pack_id.to_string());
            return Err(format!("dependency cycle {}", cycle.join(" -> ")));
        }
        visiting.push(pack_id.to_string());
        let pack = &packs[*by_id.get(pack_id).expect("pack graph node exists")];
        let mut dependencies = pack
            .dependency_requirements
            .iter()
            .filter(|dependency| by_id.contains_key(&dependency.id))
            .map(|dependency| dependency.id.as_str())
            .collect::<Vec<_>>();
        dependencies.sort_unstable();
        for dependency in dependencies {
            visit(dependency, packs, by_id, visiting, visited, ordered)?;
        }
        visiting.pop();
        visited.insert(pack_id.to_string());
        ordered.push(pack.clone());
        Ok(())
    }

    let mut ordered = Vec::with_capacity(packs.len());
    let mut visiting = Vec::new();
    let mut visited = BTreeSet::new();
    for pack_id in by_id.keys() {
        visit(
            pack_id,
            packs,
            &by_id,
            &mut visiting,
            &mut visited,
            &mut ordered,
        )?;
    }
    Ok((ordered, capability_providers))
}
