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

#[derive(Clone, Debug, Eq, PartialEq)]
pub(super) struct SceneRulesetSelection {
    pub(super) context: ActiveRulesetContext,
    pub(super) selector_scope: String,
    pub(super) selector_id: String,
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

    pub(super) fn composition_revision(&self) -> u64 {
        self.0
            .get("history")
            .and_then(serde_json::Value::as_array)
            .and_then(|history| history.last())
            .and_then(|transaction| transaction.get("sequence"))
            .and_then(serde_json::Value::as_u64)
            .unwrap_or_default()
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(super) enum ContentReferenceStatus {
    Available,
    MissingPack,
    VersionMismatch,
    UnknownReference,
    Remapped,
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

    pub(super) fn active_ruleset_for_pack(&self, pack_id: &str) -> Option<&ActiveRulesetContext> {
        if let Some(selected) = self
            .active_rulesets
            .iter()
            .find(|context| context.selected_by_pack_id == pack_id)
        {
            return Some(selected);
        }

        let pack = self.pack(pack_id)?;
        let mut inherited = self.active_rulesets.iter().filter(|context| {
            pack.dependency_closure
                .iter()
                .any(|dependency| dependency == &context.selected_by_pack_id)
        });
        let selected = inherited.next()?;
        inherited.next().is_none().then_some(selected)
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

    fn active_ruleset_for_reference(
        &self,
        selected_by_pack_id: &str,
        capability_id: &str,
    ) -> Option<ActiveRulesetContext> {
        let provider_id = self.capability_provider(capability_id)?;
        let provider = self.pack(provider_id)?;
        Some(ActiveRulesetContext {
            selected_by_pack_id: selected_by_pack_id.to_string(),
            capability_id: capability_id.to_string(),
            provider_pack_id: provider.id.clone(),
            provider_pack_version: provider.version.clone(),
        })
    }

    pub(super) fn active_ruleset_for_scene(
        &self,
        pack_id: &str,
        zone: &str,
        location_id: u64,
        location_ruleset: Option<&str>,
    ) -> Option<SceneRulesetSelection> {
        if let Some(ruleset) = location_ruleset {
            return Some(SceneRulesetSelection {
                context: self.active_ruleset_for_reference(pack_id, ruleset)?,
                selector_scope: "location".to_string(),
                selector_id: format!("pack://{pack_id}/location/{location_id}"),
            });
        }
        if let Some(ruleset) = self
            .zone_rulesets
            .get(&(pack_id.to_string(), zone.to_string()))
        {
            return Some(SceneRulesetSelection {
                context: self.active_ruleset_for_reference(pack_id, ruleset)?,
                selector_scope: "zone".to_string(),
                selector_id: format!("pack://{pack_id}/zone/{zone}"),
            });
        }
        let context = self.active_ruleset_for_pack(pack_id)?.clone();
        Some(SceneRulesetSelection {
            selector_scope: "pack".to_string(),
            selector_id: context.selected_by_pack_id.clone(),
            context,
        })
    }

    pub(super) fn asset_mounts(&self) -> &[SeedAssetMount] {
        &self.content.asset_mounts
    }

    pub(super) fn public_asset_mount<'registry, 'path>(
        &'registry self,
        public_path: &'path str,
    ) -> Option<(&'registry SeedAssetMount, &'path str)> {
        self.content
            .asset_mounts
            .iter()
            .filter_map(|mount| {
                let relative = public_path
                    .strip_prefix(&mount.public_prefix)?
                    .strip_prefix('/')?;
                Some((mount, relative))
            })
            .max_by_key(|(mount, _)| mount.public_prefix.len())
    }

    pub(super) fn external_cards(&self) -> &[ExternalCardSpec] {
        &self.content.external_cards
    }

    pub(super) fn entry_location_id(&self) -> Option<u64> {
        self.runtime_entry_location_id
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

    pub(super) fn content_reference_mapping_version(&self) -> u32 {
        self.content_reference_mapping_version
    }

    pub(super) fn content_reference(
        &self,
        kind: &str,
        runtime_handle: u64,
    ) -> Option<&ContentReferenceEntry> {
        self.content_references_by_handle
            .get(&runtime_handle)
            .and_then(|canonical| self.content_references_by_canonical.get(canonical))
            .filter(|entry| entry.kind == kind)
            .or_else(|| {
                self.legacy_content_references
                    .get(&(kind.to_string(), runtime_handle))
                    .and_then(|canonical| self.content_references_by_canonical.get(canonical))
            })
    }

    pub(super) fn content_reference_context<'a>(
        &self,
        handles: impl IntoIterator<Item = (&'a str, u64)>,
    ) -> ContentReferenceContext {
        let mut references = BTreeMap::new();
        for (kind, handle) in handles {
            if handle == 0 {
                continue;
            }
            if let Some(entry) = self.content_reference(kind, handle) {
                references.insert(entry.canonical_ref.clone(), entry.clone());
            }
        }
        ContentReferenceContext {
            mapping_version: self.content_reference_mapping_version,
            references: references.into_values().collect(),
            active_rulesets: self.active_rulesets.clone(),
        }
    }

    pub(super) fn inspect_content_reference(
        &self,
        persisted: &ContentReferenceEntry,
    ) -> ContentReferenceStatus {
        let Some(pack) = self.pack(&persisted.pack_id) else {
            return ContentReferenceStatus::MissingPack;
        };
        if pack.version != persisted.pack_version {
            return ContentReferenceStatus::VersionMismatch;
        }
        let Some(current) = self
            .content_references_by_canonical
            .get(&persisted.canonical_ref)
        else {
            return ContentReferenceStatus::UnknownReference;
        };
        if current.runtime_handle != persisted.runtime_handle {
            ContentReferenceStatus::Remapped
        } else {
            ContentReferenceStatus::Available
        }
    }

    pub(super) fn inspect_content_reference_for_declared_migration(
        &self,
        persisted: &ContentReferenceEntry,
    ) -> ContentReferenceStatus {
        if self.pack(&persisted.pack_id).is_none() {
            return ContentReferenceStatus::MissingPack;
        }
        let Some(current) = self
            .content_references_by_canonical
            .get(&persisted.canonical_ref)
        else {
            return ContentReferenceStatus::UnknownReference;
        };
        if current.runtime_handle != persisted.runtime_handle {
            ContentReferenceStatus::Remapped
        } else {
            ContentReferenceStatus::Available
        }
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

pub(super) fn actor_goal_lines(actor_id: u64) -> Vec<String> {
    active_content()
        .actors
        .iter()
        .find(|actor| actor.id == actor_id)
        .into_iter()
        .flat_map(|actor| &actor.goals)
        .map(|goal| {
            format!(
                "Planner-only goal: {} Planner-only motivation: {}",
                goal.objective, goal.motivation
            )
        })
        .collect()
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn every_shipped_registry_passes_runtime_startup_validation() {
        let content_root = Path::new(env!("CARGO_MANIFEST_DIR")).join("../content");
        let mut registries = fs::read_dir(&content_root)
            .expect("shipped content directory")
            .filter_map(Result::ok)
            .map(|entry| entry.path().join("registry.json"))
            .filter(|path| path.is_file())
            .collect::<Vec<_>>();
        registries.sort();
        assert!(
            !registries.is_empty(),
            "no shipped content registries found"
        );

        for path in registries {
            let value = fs::read_to_string(&path)
                .unwrap_or_else(|error| panic!("could not read {}: {error}", path.display()));
            ContentRegistry::from_json(&value, content_engine_version()).unwrap_or_else(|error| {
                panic!(
                    "shipped registry {} failed runtime validation: {error}",
                    path.display()
                )
            });
        }
    }

    #[test]
    fn holy_land_disciples_have_distinct_planner_only_search_motivations() {
        let disciples = active_content()
            .actors
            .iter()
            .filter(|actor| (7002..=7013).contains(&actor.id))
            .collect::<Vec<_>>();
        assert_eq!(disciples.len(), 12);
        assert!(disciples.iter().all(|actor| actor.goals.len() == 1));
        assert!(disciples
            .iter()
            .all(|actor| actor.goals[0].objective == "Search for Christ."));
        assert_eq!(
            disciples
                .iter()
                .map(|actor| actor.goals[0].motivation.as_str())
                .collect::<BTreeSet<_>>()
                .len(),
            disciples.len()
        );
        let goals = actor_goal_lines(7002);
        assert!(goals.iter().any(|goal| {
            goal.contains("Planner-only goal: Search for Christ.")
                && goal.contains("Planner-only motivation:")
        }));
    }

    #[test]
    fn holy_land_search_is_playable_without_instantiating_christ() {
        let content = active_content();
        let holy_land_actor_ids = content
            .actors
            .iter()
            .filter(|actor| actor.pack_id == "cosyworld.the-holy-land")
            .map(|actor| actor.id)
            .collect::<BTreeSet<_>>();
        assert_eq!(holy_land_actor_ids.len(), 16);
        assert!(content.actors.iter().all(|actor| actor.name != "Jesus"
            && actor.name != "Jesus Christ"
            && actor.name != "Christ"));
        assert!(content.cards.iter().all(|card| {
            !(card.pack_id == "cosyworld.the-holy-land"
                && card.display_name.to_ascii_lowercase().contains("jesus"))
        }));

        let project = content
            .jobs
            .iter()
            .find(|job| job.id == "holy-land:follow-the-traces")
            .expect("Holy Land search project is mounted");
        assert_eq!(project.progress_clock_id, "holy-land.traces");
        assert_eq!(project.danger_clock_id, "holy-land.rumors");
        assert_eq!(project.contribution_strategies.len(), 7);
        assert!(project
            .participant_ids
            .iter()
            .all(|actor_id| holy_land_actor_ids.contains(actor_id)));

        let holy_land_items = content
            .items
            .iter()
            .filter(|item| item.pack_id == "cosyworld.the-holy-land")
            .collect::<Vec<_>>();
        assert_eq!(holy_land_items.len(), 10);
        assert!(holy_land_items
            .iter()
            .any(|item| item.name == "Pearl of Great Price" && item.role == "relic"));
        assert!(holy_land_items
            .iter()
            .any(|item| item.name == "Samaritan Oil and Linen" && item.role == "consumable"));
        assert!(content.fronts.iter().any(|front| {
            front.id == "holy-land:voices-on-the-road"
                && front.portent_clock_id == "holy-land.rumors"
                && front.impending_outcome.contains("false claimant")
        }));
        let completion = content
            .clocks
            .iter()
            .find(|clock| clock.id == "holy-land.traces")
            .map(|clock| &clock.presentation)
            .expect("search completion has a player-facing presentation");
        assert!(completion.outcome.contains("Christ has gone ahead"));
        assert!(!completion.outcome.contains("appears"));

        for location in content
            .locations
            .iter()
            .filter(|location| location.pack_id == "cosyworld.the-holy-land")
        {
            let memory = location.memory.join(" ").to_ascii_lowercase();
            for editorial_word in ["gospel", "tradition", "scholarly", "disputed"] {
                assert!(
                    !memory.contains(editorial_word),
                    "{} leaks editorial language into runtime memory",
                    location.name
                );
            }
        }
    }

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
            license_url: "https://opensource.org/license/mit".to_string(),
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
            provenance: SeedPackProvenance {
                author: "Fixture Author".to_string(),
                source_name: "Fixture Source".to_string(),
                source_url: "https://example.com/fixture".to_string(),
                modification_notice: None,
            },
            resource_counts: BTreeMap::new(),
            distribution: None,
            entitlements: None,
            rules_adapter: None,
            rules_namespace: None,
            rules_profile: None,
            rules_compatibility: None,
            extensions: serde_json::Value::Null,
        }
    }

    fn registry_json(packs: Vec<SeedWorldpackPack>) -> String {
        let has_world_pack = packs
            .iter()
            .any(|pack| matches!(pack.kind.as_str(), "world" | "campaign"));
        let licenses = packs
            .iter()
            .map(|pack| SeedLicenseRecord {
                pack_id: pack.id.clone(),
                name: pack.name.clone(),
                version: pack.version.clone(),
                license_identifier: pack.license.clone(),
                license_url: pack.license_url.clone(),
                provenance: pack.provenance.clone(),
                notices: Vec::new(),
            })
            .collect::<Vec<_>>();
        let mut value = serde_json::json!({
            "schema_version": 1,
            "manifest": {
                "schema_version": 2,
                "pack_contract": CONTENT_PACK_CONTRACT,
                "canonical_id_mapping_version": 1,
                "id": "fixture.world",
                "name": "Fixture World",
                "version": 1,
                "description": "Registry fixture",
                "bundle_hash": format!("sha256:{}", "0".repeat(64)),
                "packs": packs,
                "registry": "registry.json",
                "content_references": "content_refs.json",
                "licenses": "licenses.json"
            },
            "resources": {},
            "external_cards": [],
            "assets": [],
            "rules": [],
            "attributions": [],
            "licenses": licenses,
            "character_creation": [],
            "content_references": {
                "schema_version": 1,
                "mapping_version": 1,
                "entries": []
            }
        });
        if has_world_pack {
            value["manifest"]["entry_location"] = serde_json::json!("fixture-entry");
        }
        value.to_string()
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
            content_engine_version(),
        )
        .expect("official registry loads");
        assert_eq!(registry.content().locations.len(), 49);
        assert_eq!(registry.content().manifest.packs.len(), 11);
        assert_eq!(
            registry.content().manifest.rules_profile,
            "cosyworld.srd5/1"
        );
        assert_eq!(registry.pack("cosyworld.core").unwrap().version, "1.3.13");
        assert_eq!(
            registry.capability_provider("cosyworld.core/world"),
            Some("cosyworld.core")
        );
        assert_eq!(registry.external_cards().len(), 24);
        assert!(registry.asset_mounts().len() >= 4);
        assert!(registry.additional_resource("sentences").is_some());
        let actor = registry
            .content_reference("actor", 1001)
            .expect("legacy actor has a canonical reference");
        assert_eq!(actor.canonical_ref, "pack://cosyworld.core/actor/1001");
        assert_eq!(actor.legacy_runtime_id, Some(1001));
        assert_eq!(actor.runtime_handle, 1001);
        let context = registry
            .content_reference_context([("actor", 1001), ("location", COSY_COTTAGE_LOCATION_ID)]);
        assert_eq!(context.mapping_version, 1);
        assert_eq!(context.references.len(), 2);

        let mut unavailable = actor.clone();
        unavailable.pack_id = "missing.pack".to_string();
        unavailable.canonical_ref = "pack://missing.pack/actor/1001".to_string();
        assert_eq!(
            registry.inspect_content_reference(&unavailable),
            ContentReferenceStatus::MissingPack
        );
        unavailable = actor.clone();
        unavailable.pack_version = "99.0.0".to_string();
        assert_eq!(
            registry.inspect_content_reference(&unavailable),
            ContentReferenceStatus::VersionMismatch
        );
        unavailable = actor.clone();
        unavailable.canonical_ref = "pack://cosyworld.core/actor/not-present".to_string();
        assert_eq!(
            registry.inspect_content_reference(&unavailable),
            ContentReferenceStatus::UnknownReference
        );
        unavailable = actor.clone();
        unavailable.runtime_handle += 1;
        assert_eq!(
            registry.inspect_content_reference(&unavailable),
            ContentReferenceStatus::Remapped
        );
    }

    #[test]
    fn lantern_clock_contract_rejects_missing_tag_only_and_wrong_status_effects() {
        let path = configured_content_root().join("official/registry.json");
        let original: serde_json::Value =
            serde_json::from_str(&fs::read_to_string(path).expect("compiled registry reads"))
                .expect("compiled registry parses");

        for clock_id in ["lantern-keeper.light", "lantern-keeper.darkness"] {
            let mutate_clock =
                |value: &mut serde_json::Value, mutation: &dyn Fn(&mut serde_json::Value)| {
                    let clock = value["resources"]["clocks"]
                        .as_array_mut()
                        .expect("clock resources are an array")
                        .iter_mut()
                        .find(|clock| clock["id"] == clock_id)
                        .expect("Lantern clock is compiled");
                    mutation(clock);
                };

            let mut missing = original.clone();
            mutate_clock(&mut missing, &|clock| {
                clock
                    .as_object_mut()
                    .expect("clock is an object")
                    .remove("on_fill");
            });
            let error = ContentRegistry::from_json(&missing.to_string(), content_engine_version())
                .expect_err("missing direct fill consequence is rejected");
            assert!(error.contains("must directly declare"), "{error}");

            let mut tag_only = original.clone();
            mutate_clock(&mut tag_only, &|clock| {
                clock["on_fill"]
                    .as_array_mut()
                    .expect("on_fill is an array")
                    .retain(|effect| effect["op"] == "set_tag");
            });
            let error = ContentRegistry::from_json(&tag_only.to_string(), content_engine_version())
                .expect_err("tag-only fill consequence is rejected");
            assert!(error.contains("cannot be tag-only"), "{error}");

            let mut wrong_status = original.clone();
            mutate_clock(&mut wrong_status, &|clock| {
                let effect = clock["on_fill"]
                    .as_array_mut()
                    .expect("on_fill is an array")
                    .iter_mut()
                    .find(|effect| effect["op"] == "set_job_status")
                    .expect("authoritative status effect");
                effect["status"] = serde_json::json!(if clock_id == "lantern-keeper.light" {
                    "failed"
                } else {
                    "completed"
                });
            });
            let expected_status = if clock_id == "lantern-keeper.light" {
                "completed"
            } else {
                "failed"
            };
            let error =
                ContentRegistry::from_json(&wrong_status.to_string(), content_engine_version())
                    .expect_err("wrong status consequence is rejected");
            assert!(error.contains(&format!(":{expected_status}")), "{error}");
        }
    }

    #[test]
    fn lantern_clock_contract_rejects_unjustified_or_duplicate_sources() {
        let path = configured_content_root().join("official/registry.json");
        let original: serde_json::Value =
            serde_json::from_str(&fs::read_to_string(path).expect("compiled registry reads"))
                .expect("compiled registry parses");

        let mut unjustified = original.clone();
        let clock = unjustified["resources"]["clocks"]
            .as_array_mut()
            .expect("clock resources are an array")
            .iter_mut()
            .find(|clock| clock["id"] == "lantern-keeper.light")
            .expect("Lantern light clock is compiled");
        clock["on_fill"][0]
            .as_object_mut()
            .expect("effect is an object")
            .remove("reason");
        let error = ContentRegistry::from_json(&unjustified.to_string(), content_engine_version())
            .expect_err("unjustified effect is rejected");
        assert!(error.contains("effect without a reason"), "{error}");

        let mut duplicate = original;
        duplicate["resources"]["lifecycle_hooks"]
            .as_array_mut()
            .expect("lifecycle hooks are an array")
            .push(serde_json::json!({
                "hook": "on_clock_fill",
                "target_kind": "clock",
                "target_id": "lantern-keeper.light",
                "claim_scope": "event_once",
                "effects": [{
                    "op": "set_job_status",
                    "job_id": "lantern-keeper:rekindle-the-beacon",
                    "status": "completed",
                    "reason": "duplicate_source_test"
                }],
                "pack_id": "cosyworld.campaign.the-lantern-keeper"
            }));
        let error = ContentRegistry::from_json(&duplicate.to_string(), content_engine_version())
            .expect_err("duplicate fill source is rejected");
        assert!(
            error.contains("sole authoritative consequence source"),
            "{error}"
        );
    }

    #[test]
    fn runtime_rejects_wallet_identity_embedded_in_world_entity_state() {
        let path = configured_content_root().join("official/registry.json");
        let mut value: serde_json::Value =
            serde_json::from_str(&fs::read_to_string(path).expect("compiled registry reads"))
                .expect("compiled registry parses");
        value["resources"]["items"][0]["external_card_id"] =
            serde_json::json!("wallet-copy-of-world-item");

        let error = ContentRegistry::from_json(&value.to_string(), content_engine_version())
            .expect_err("world entities must reject wallet identity fields");

        assert!(
            error.contains("unknown field `external_card_id`"),
            "{error}"
        );
    }

    #[test]
    fn runtime_allows_one_external_card_to_describe_only_one_world_entity() {
        let path = configured_content_root().join("official/registry.json");
        let mut value: serde_json::Value =
            serde_json::from_str(&fs::read_to_string(path).expect("compiled registry reads"))
                .expect("compiled registry parses");
        let mut duplicate = value["resources"]["card_bindings"][0].clone();
        duplicate["id"] = serde_json::json!("rati-card-duplicate-subject");
        duplicate["entity_ref"] = serde_json::json!("pack://cosyworld.core/actor/1002");
        duplicate["subject_id"] = serde_json::json!(1002);
        duplicate["seed_card_id"] = serde_json::json!("cosy-whiskerwind");
        value["resources"]["card_bindings"]
            .as_array_mut()
            .expect("card bindings are an array")
            .push(duplicate);

        let error = ContentRegistry::from_json(&value.to_string(), content_engine_version())
            .expect_err("one wallet card cannot describe two entities");

        assert!(
            error.contains("external card rati binds more than one world entity"),
            "{error}"
        );
    }

    #[test]
    fn core_and_non_world_compositions_mount_without_implicit_packs() {
        let content_root = configured_content_root();
        let core = ContentRegistry::from_json(
            &fs::read_to_string(content_root.join("core-only/registry.json"))
                .expect("Core-only registry reads"),
            content_engine_version(),
        )
        .expect("Core-only registry mounts");
        assert_eq!(core.content().manifest.packs.len(), 3);
        assert!(core.pack("cosyworld.core").is_some());
        assert!(core.pack("cosyworld.rules-profile-srd5").is_some());
        assert_eq!(core.entry_location_id(), Some(COSY_COTTAGE_LOCATION_ID));
        assert_eq!(
            core.capability_provider("cosyworld.core/rules"),
            Some("cosyworld.core")
        );
        assert!(!core.content().locations.is_empty());

        let services = ContentRegistry::from_json(
            &fs::read_to_string(content_root.join("services-only/registry.json"))
                .expect("services-only registry reads"),
            content_engine_version(),
        )
        .expect("services-only registry mounts");
        assert_eq!(services.content().manifest.packs.len(), 3);
        assert!(services.pack("cosyworld.services-fixture").is_some());
        assert!(services.pack("cosyworld.rules-profile-srd5").is_some());
        assert!(services.pack("cosyworld.core").is_none());
        assert_eq!(services.entry_location_id(), None);
        assert!(services.content().locations.is_empty());
        assert!(services.content().actors.is_empty());
    }

    #[test]
    fn elysium_mounts_its_self_authored_avatar_level_track() {
        let registry = ContentRegistry::from_json(
            &fs::read_to_string(configured_content_root().join("elysium-only/registry.json"))
                .expect("Elysium registry reads"),
            content_engine_version(),
        )
        .expect("Elysium registry mounts");
        let track = registry
            .content()
            .avatar_level_tracks
            .first()
            .expect("Elysium avatar level track");
        assert_eq!(track.id, "elysium.embodiment");
        assert_eq!(track.identity.mode, "self_authored");
        assert_eq!(track.max_level, 3);
        assert_eq!(track.levels.last().map(|level| level.level), Some(3));
    }

    #[test]
    fn deployment_entry_override_must_resolve_inside_the_selected_worldpack() {
        let path = configured_content_root().join("official/registry.json");
        let registry = ContentRegistry::from_json(
            &fs::read_to_string(path).expect("official registry reads"),
            content_engine_version(),
        )
        .expect("official registry mounts");

        let bethlehem = registry
            .with_runtime_entry_location_id(700)
            .expect("Bethlehem is mounted");
        assert_eq!(bethlehem.entry_location_id(), Some(700));
        assert_eq!(
            bethlehem.content().manifest.entry_location,
            "cosyworld.core:location/1",
            "a deployment entry must not rewrite signed worldpack metadata"
        );

        let error = bethlehem
            .with_runtime_entry_location_id(u64::MAX)
            .expect_err("an unmounted entry is rejected");
        assert!(error.contains("missing location"), "{error}");
        assert!(error.contains("cosyworld.official"), "{error}");
    }

    #[test]
    fn runtime_handle_collisions_fail_before_mounting() {
        let mut value: serde_json::Value =
            serde_json::from_str(&registry_json(vec![pack("a-pack", Vec::new())])).unwrap();
        value["content_references"]["entries"] = serde_json::json!([
            {
                "canonical_ref": "pack://a-pack/creature/first",
                "pack_id": "a-pack",
                "pack_version": "1.0.0",
                "kind": "creature",
                "local_id": "first",
                "runtime_handle": 1000000000000_u64
            },
            {
                "canonical_ref": "pack://a-pack/creature/second",
                "pack_id": "a-pack",
                "pack_version": "1.0.0",
                "kind": "creature",
                "local_id": "second",
                "runtime_handle": 1000000000000_u64
            }
        ]);
        let error = ContentRegistry::from_json(&value.to_string(), "0.1.0").unwrap_err();
        assert!(error.contains("runtime handle 1000000000000 collides"));
        assert!(error.contains("first") && error.contains("second"));
    }

    #[test]
    fn active_ruleset_is_embedded_in_persistence_context() {
        let mut rules = pack("rules-pack", Vec::new());
        rules.kind = "rules".to_string();
        rules.capabilities[0].id = "rules-pack/core".to_string();
        rules.capabilities[0].kind = "rules".to_string();
        rules.default_ruleset = Some("rules-pack/core".to_string());
        rules.rules_adapter = Some("cosyworld.rules/1".to_string());
        rules.rules_namespace = Some("rules-pack".to_string());
        let mut value: serde_json::Value =
            serde_json::from_str(&registry_json(vec![rules])).unwrap();
        value["rules"] = serde_json::json!([{
            "pack_id": "rules-pack",
            "pack_version": "1.0.0",
            "adapter": "cosyworld.rules/1",
            "namespace": "rules-pack",
            "resources": {}
        }]);
        value["attributions"] = serde_json::json!([{
            "pack_id": "rules-pack",
            "license": "MIT",
            "source_name": "Fixture",
            "source_url": "https://example.com",
            "text": "Fixture attribution"
        }]);
        let registry =
            ContentRegistry::from_json(&value.to_string(), "0.1.0").expect("rules registry loads");
        let context = registry.content_reference_context([]);
        assert_eq!(context.active_rulesets.len(), 1);
        assert_eq!(context.active_rulesets[0].capability_id, "rules-pack/core");
        assert_eq!(context.active_rulesets[0].provider_pack_version, "1.0.0");
    }

    #[test]
    fn snapshot_round_trip_preserves_pack_mount_state() {
        let mut runtime = RuntimeWorld::seeded();
        runtime.pack_mount_state = PackMountState(serde_json::json!({
            "schema_version": 1,
            "next_transaction_seq": 2,
            "frozen": {
                "example.pack": {
                    "arrays": {
                        "world_items": [{
                            "index": 0,
                            "value": { "id": 42, "zone": 3 }
                        }]
                    }
                }
            },
            "history": [{ "sequence": 1, "operation": "soft_unmount" }]
        }));
        let expected = runtime.pack_mount_state.clone();

        let snapshot = RuntimeSnapshot::from_runtime(&runtime);
        assert_eq!(snapshot.pack_mount_state, expected);
        let restored = snapshot.into_runtime().expect("snapshot restores");
        assert_eq!(restored.pack_mount_state, expected);
    }
}
