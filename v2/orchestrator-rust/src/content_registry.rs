use super::*;

const CONTENT_REGISTRY_SCHEMA_VERSION: u32 = 1;
const CONTENT_PACK_CONTRACT: &str = "cosyworld.content-pack/1";

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct CompiledContentRegistry {
    schema_version: u32,
    manifest: SeedWorldpackManifest,
    #[serde(default)]
    resources: BTreeMap<String, serde_json::Value>,
    #[serde(default)]
    external_cards: Vec<RubyHighCardSpec>,
    #[serde(default)]
    assets: Vec<SeedAssetMount>,
    #[serde(default)]
    rules: Vec<SeedRuleBundle>,
    #[serde(default)]
    attributions: Vec<SeedAttribution>,
    #[serde(default)]
    character_creation: Vec<SeedCharacterCreationBundle>,
}

#[derive(Debug)]
pub(super) struct ContentRegistry {
    content: SeedContent,
    packs_by_id: BTreeMap<String, usize>,
    capability_providers: BTreeMap<String, String>,
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
        let content = SeedContent {
            manifest: document.manifest,
            actors: take_resource(&mut resources, "actors")?,
            access_gates: take_resource(&mut resources, "access_gates")?,
            factions: take_resource(&mut resources, "factions")?,
            items: take_resource(&mut resources, "items")?,
            locations: take_resource(&mut resources, "locations")?,
            exits: take_resource(&mut resources, "exits")?,
            hidden_exits: take_resource(&mut resources, "hidden_exits")?,
            room_features: take_resource(&mut resources, "room_features")?,
            room_sheets: take_resource(&mut resources, "room_sheets")?,
            clocks: take_resource(&mut resources, "clocks")?,
            jobs: take_resource(&mut resources, "jobs")?,
            fronts: take_resource(&mut resources, "fronts")?,
            cards: take_resource(&mut resources, "cards")?,
            lifecycle_hooks: take_resource(&mut resources, "lifecycle_hooks")?,
            evolution_tracks: take_resource(&mut resources, "evolution_tracks")?,
            recipes: take_resource(&mut resources, "recipes")?,
            rules: document.rules,
            attributions: document.attributions,
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
        let registry = Self {
            content,
            packs_by_id,
            capability_providers,
            additional_resources: resources,
        };
        for pack in &registry.content.manifest.packs {
            let Some(default_ruleset) = pack.default_ruleset.as_deref() else {
                continue;
            };
            let provider_id = registry
                .capability_provider(default_ruleset)
                .ok_or_else(|| {
                    format!(
                        "pack {}@{} selects unavailable rules capability {}",
                        pack.id, pack.version, default_ruleset
                    )
                })?;
            let provider = registry
                .pack(provider_id)
                .expect("capability provider exists");
            if !provider
                .capabilities
                .iter()
                .any(|capability| capability.id == default_ruleset && capability.kind == "rules")
            {
                return Err(format!(
                    "pack {}@{} selects non-rules capability {} from {}@{}",
                    pack.id, pack.version, default_ruleset, provider.id, provider.version
                ));
            }
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

    pub(super) fn asset_mounts(&self) -> &[SeedAssetMount] {
        &self.content.asset_mounts
    }

    pub(super) fn external_cards(&self) -> &[RubyHighCardSpec] {
        &self.content.external_cards
    }

    #[cfg(test)]
    fn additional_resource(&self, kind: &str) -> Option<&serde_json::Value> {
        self.additional_resources.get(kind)
    }

    pub(super) fn location_ids_for_pack(&self, pack_id: &str) -> Vec<u64> {
        if self.pack(pack_id).is_none() {
            return Vec::new();
        }
        self.content
            .locations
            .iter()
            .filter(|location| location.pack_id == pack_id)
            .map(|location| location.id)
            .collect()
    }
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
    ContentRegistry::from_json(&value, env!("CARGO_PKG_VERSION"))
        .map_err(|error| format!("content registry {}: {error}", path.display()))
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
        if pack.capabilities.is_empty() || !pack.provenance.is_object() {
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

#[cfg(test)]
mod tests {
    use super::*;

    fn capability(id: &str) -> SeedPackCapability {
        SeedPackCapability {
            id: id.to_string(),
            kind: "world".to_string(),
            version: "1.0.0".to_string(),
        }
    }

    fn dependency(id: &str, optional: bool) -> SeedPackDependency {
        SeedPackDependency {
            id: id.to_string(),
            version: ">=1.0.0 <2.0.0".to_string(),
            capabilities: vec![format!("{id}.world")],
            optional,
        }
    }

    fn pack(id: &str, dependencies: Vec<SeedPackDependency>) -> SeedWorldpackPack {
        SeedWorldpackPack {
            id: id.to_string(),
            name: id.to_string(),
            description: String::new(),
            version: "1.0.0".to_string(),
            kind: "world".to_string(),
            license: "MIT".to_string(),
            integrity: format!("sha256:{}", "0".repeat(64)),
            engine: ">=0.1.0 <1.0.0".to_string(),
            capabilities: vec![capability(&format!("{id}.world"))],
            dependencies: dependencies
                .iter()
                .map(|dependency| dependency.id.clone())
                .collect(),
            dependency_requirements: dependencies,
            dependency_closure: Vec::new(),
            default_ruleset: None,
            entry_points: Vec::new(),
            provenance: serde_json::json!({"source":"test"}),
            resource_counts: BTreeMap::new(),
            distribution: None,
            entitlements: None,
            rules_adapter: None,
            rules_namespace: None,
        }
    }

    fn registry_json(packs: Vec<SeedWorldpackPack>) -> String {
        serde_json::json!({
            "schema_version": 1,
            "manifest": {
                "schema_version": 2,
                "pack_contract": CONTENT_PACK_CONTRACT,
                "canonical_id_mapping_version": 1,
                "id": "fixture.world",
                "name": "Fixture World",
                "version": 1,
                "description": "Registry fixture",
                "entry_location": "fixture-entry",
                "bundle_hash": format!("sha256:{}", "0".repeat(64)),
                "packs": packs,
                "registry": "registry.json"
            },
            "resources": {},
            "external_cards": [],
            "assets": [],
            "rules": [],
            "attributions": [],
            "character_creation": []
        })
        .to_string()
    }

    #[test]
    fn dependency_order_is_deterministic_for_one_two_and_many_packs() {
        let core = pack("core", Vec::new());
        let campaign = pack("campaign", vec![dependency("core", false)]);
        let assets = pack("assets", vec![dependency("core", false)]);
        let (one, _) = resolve_pack_graph(std::slice::from_ref(&core), "0.1.0").unwrap();
        assert_eq!(
            one.iter().map(|pack| pack.id.as_str()).collect::<Vec<_>>(),
            ["core"]
        );
        let (two, _) = resolve_pack_graph(&[campaign.clone(), core.clone()], "0.1.0").unwrap();
        assert_eq!(
            two.iter().map(|pack| pack.id.as_str()).collect::<Vec<_>>(),
            ["core", "campaign"]
        );
        let (many, _) = resolve_pack_graph(&[campaign, assets, core], "0.1.0").unwrap();
        assert_eq!(
            many.iter().map(|pack| pack.id.as_str()).collect::<Vec<_>>(),
            ["core", "assets", "campaign"]
        );

        let mounted = ContentRegistry::from_json(
            &registry_json(vec![
                pack("campaign", vec![dependency("core", false)]),
                pack("assets", vec![dependency("core", false)]),
                pack("core", Vec::new()),
            ]),
            "0.1.0",
        )
        .expect("one registry mounts any compatible pack count");
        assert_eq!(
            mounted
                .content()
                .manifest
                .packs
                .iter()
                .map(|pack| pack.id.as_str())
                .collect::<Vec<_>>(),
            ["core", "assets", "campaign"]
        );
    }

    #[test]
    fn missing_optional_dependency_does_not_block_unrelated_packs() {
        let standalone = pack("standalone", vec![dependency("optional", true)]);
        let unrelated = pack("unrelated", Vec::new());
        let (ordered, _) = resolve_pack_graph(&[standalone, unrelated], "0.1.0").unwrap();
        assert_eq!(ordered.len(), 2);
    }

    #[test]
    fn missing_required_dependency_has_pack_and_version_context() {
        let error = resolve_pack_graph(
            &[pack("campaign", vec![dependency("core", false)])],
            "0.1.0",
        )
        .unwrap_err();
        assert!(error.contains("campaign@1.0.0"));
        assert!(error.contains("missing dependency core"));
    }

    #[test]
    fn incompatible_dependency_version_has_both_pack_versions() {
        let mut campaign = pack("campaign", vec![dependency("core", false)]);
        campaign.dependency_requirements[0].version = ">=2.0.0 <3.0.0".to_string();
        let error = resolve_pack_graph(&[campaign, pack("core", Vec::new())], "0.1.0").unwrap_err();
        assert!(error.contains("campaign@1.0.0 requires core >=2.0.0 <3.0.0"));
        assert!(error.contains("mounted 1.0.0"));
    }

    #[test]
    fn duplicate_pack_versions_fail_before_mounting() {
        let mut replacement = pack("core", Vec::new());
        replacement.version = "1.1.0".to_string();
        let error =
            resolve_pack_graph(&[pack("core", Vec::new()), replacement], "0.1.0").unwrap_err();
        assert!(error.contains("duplicate pack core"));
        assert!(error.contains("1.0.0 and 1.1.0"));
    }

    #[test]
    fn incompatible_pack_and_duplicate_capability_fail_before_mounting() {
        let mut incompatible = pack("future", Vec::new());
        incompatible.engine = ">=2.0.0 <3.0.0".to_string();
        assert!(resolve_pack_graph(&[incompatible], "0.1.0")
            .unwrap_err()
            .contains("future@1.0.0 requires engine"));

        let first = pack("first", Vec::new());
        let mut second = pack("second", Vec::new());
        second.capabilities = first.capabilities.clone();
        let error = resolve_pack_graph(&[first, second], "0.1.0").unwrap_err();
        assert!(error.contains("duplicate capability first.world"));
        assert!(error.contains("first@1.0.0 and second@1.0.0"));
    }

    #[test]
    fn official_registry_exposes_pack_aware_indexes() {
        let package: serde_json::Value = serde_json::from_str(
            &fs::read_to_string(Path::new(env!("CARGO_MANIFEST_DIR")).join("../../package.json"))
                .expect("root package reads"),
        )
        .expect("root package parses");
        assert_eq!(
            package.get("version").and_then(serde_json::Value::as_str),
            Some(env!("CARGO_PKG_VERSION")),
            "the runtime and root release versions must remain aligned"
        );
        let path = configured_content_root().join("official/registry.json");
        let registry = ContentRegistry::from_json(
            &fs::read_to_string(path).expect("compiled registry reads"),
            env!("CARGO_PKG_VERSION"),
        )
        .expect("official registry loads");
        assert_eq!(registry.content().locations.len(), 33);
        assert_eq!(registry.pack("cosyworld.core").unwrap().version, "1.0.0");
        assert_eq!(
            registry.capability_provider("cosyworld.core/world"),
            Some("cosyworld.core")
        );
        assert_eq!(registry.external_cards().len(), 24);
        assert!(registry.asset_mounts().len() >= 3);
        assert!(registry.additional_resource("sentences").is_some());
    }
}
