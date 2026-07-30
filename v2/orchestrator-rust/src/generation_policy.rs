use super::*;

const GENERATION_EXTENSION: &str = "x-cosyworld-generation";
pub(super) const LEGACY_GENERATION_POLICY_ID: &str = "cosyworld.compatibility.host-generation/1";

#[derive(Clone, Debug, Default, Deserialize, Eq, PartialEq, Serialize)]
pub(super) struct GeneratedMediaBinding {
    pub(super) profile_id: String,
    pub(super) recipe_id: String,
    pub(super) provider: String,
    pub(super) model: String,
    pub(super) revision: String,
    pub(super) prompt_version: String,
    pub(super) prompt_prefix: String,
    pub(super) aspect_ratios: Vec<String>,
    pub(super) output_format: String,
}

#[derive(Clone, Debug, Default, Deserialize, Eq, PartialEq, Serialize)]
pub(super) struct GeneratedPolicyBinding {
    pub(super) schema_version: u8,
    pub(super) policy_id: String,
    pub(super) migration_version: u32,
    pub(super) collision_namespace: String,
    pub(super) owner_pack_id: String,
    pub(super) owner_pack_version: String,
    pub(super) composition_id: String,
    pub(super) composition_bundle_hash: String,
    pub(super) prose_profile_id: String,
    pub(super) prose_prompt_version: String,
    pub(super) ecology_transition: String,
    pub(super) topology_profile_id: String,
    pub(super) unmount_behavior: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(super) place_anchor: Option<GeneratedPlaceAnchorTerminology>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(super) media: Option<GeneratedMediaBinding>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub(super) struct GeneratedPlaceAnchorTerminology {
    pub(super) action_label: String,
    pub(super) target_label: String,
    pub(super) question: String,
    pub(super) description: String,
    pub(super) completion_memory: String,
    pub(super) visual_description: String,
}

impl GeneratedPolicyBinding {
    pub(super) fn is_empty(&self) -> bool {
        self.policy_id.is_empty()
    }
}

pub(super) fn validate_generated_policy_binding(
    binding: &GeneratedPolicyBinding,
) -> Result<(), String> {
    if binding.schema_version != 1
        || binding.policy_id.is_empty()
        || binding.owner_pack_id.is_empty()
        || binding.owner_pack_version.is_empty()
        || binding.composition_bundle_hash.is_empty()
    {
        return Err("generated policy binding is incomplete or unsupported".to_string());
    }
    if binding.policy_id == LEGACY_GENERATION_POLICY_ID {
        if binding.media.is_some() {
            return Err("legacy generation binding fabricates a media identity".to_string());
        }
        return Ok(());
    }
    if binding.collision_namespace.is_empty() || binding.composition_id.is_empty() {
        return Err("reviewed generation policy binding is incomplete".to_string());
    }
    if binding.media.as_ref().is_some_and(|media| {
        media.profile_id.is_empty()
            || media.recipe_id.is_empty()
            || media.provider.is_empty()
            || media.model.is_empty()
            || media.revision.is_empty()
            || media.prompt_version.is_empty()
            || media.aspect_ratios.is_empty()
            || media.output_format.is_empty()
    }) {
        return Err("generated media binding is incomplete".to_string());
    }
    if binding.place_anchor.as_ref().is_some_and(|anchor| {
        [
            &anchor.action_label,
            &anchor.target_label,
            &anchor.question,
            &anchor.description,
            &anchor.completion_memory,
            &anchor.visual_description,
        ]
        .into_iter()
        .any(|value| value.trim().is_empty())
    }) {
        return Err("generated place anchor terminology is incomplete".to_string());
    }
    Ok(())
}

#[derive(Clone, Deserialize)]
struct PolicyManifest {
    policy_id: String,
    migration_version: u32,
    collision_namespace: String,
    #[serde(default)]
    place_anchor: Option<GeneratedPlaceAnchorTerminology>,
    #[serde(default)]
    prose: Option<PolicyProse>,
    #[serde(default)]
    media: Option<PolicyMedia>,
    #[serde(default)]
    topology: Option<PolicyTopology>,
    #[serde(default)]
    migrations: Vec<PolicyMigration>,
    #[serde(default)]
    cross_pack_routes: Vec<PolicyCrossRoute>,
}

#[derive(Clone, Deserialize)]
struct PolicyProse {
    profile_id: String,
    prompt_versions: Vec<String>,
    ecology: PolicyEcology,
}

#[derive(Clone, Deserialize)]
struct PolicyEcology {
    interpolation: String,
}

#[derive(Clone, Deserialize)]
struct PolicyMedia {
    profile_id: String,
    recipe_id: String,
    #[serde(default)]
    provider_preference: Option<PolicyProvider>,
    prompt_version: String,
    prompt_prefix: String,
    output_formats: Vec<String>,
}

#[derive(Clone, Deserialize)]
struct PolicyProvider {
    provider: String,
    model: String,
    revision: String,
}

#[derive(Clone, Deserialize)]
struct PolicyTopology {
    profile_id: String,
}

#[derive(Clone, Deserialize)]
struct PolicyMigration {
    from_policy_id: String,
    from_migration_version: u32,
    from_pack_version: String,
    mode: String,
}

#[derive(Clone, Deserialize)]
struct PolicyCrossRoute {
    endpoints: Vec<PolicyEndpoint>,
    generated_descendant_owner: String,
    media_profile_id: String,
    ecology_transition: String,
    unmount: String,
}

#[derive(Clone, Deserialize)]
struct PolicyEndpoint {
    pack_id: String,
    location_id: u64,
}

#[derive(Deserialize)]
struct MediaRegistry {
    profiles: Vec<MediaProfile>,
    recipes: Vec<MediaRecipe>,
}

#[derive(Deserialize)]
struct MediaProfile {
    id: String,
    recipes: Vec<String>,
}

#[derive(Deserialize)]
struct MediaRecipe {
    id: String,
    profile: String,
    provider: String,
    model: MediaModel,
    state: String,
    aspect_ratios: Vec<String>,
    output_formats: Vec<String>,
    prompt_versions: Vec<String>,
    #[serde(default)]
    provider_defaults: serde_json::Map<String, serde_json::Value>,
    lora: bool,
}

#[derive(Deserialize)]
struct MediaModel {
    owner: String,
    name: String,
    revision: String,
}

fn policy_for_pack_in(
    packs: &[SeedWorldpackPack],
    pack_id: &str,
) -> Result<Option<PolicyManifest>, String> {
    let pack = packs
        .iter()
        .find(|pack| pack.id == pack_id)
        .ok_or_else(|| format!("generated descendant owner pack {pack_id} is not mounted"))?;
    let Some(value) = pack.extensions.get(GENERATION_EXTENSION) else {
        return Ok(None);
    };
    serde_json::from_value(value.clone())
        .map(Some)
        .map_err(|error| format!("pack {pack_id} has an invalid generation policy: {error}"))
}

fn policy_for_pack(pack_id: &str) -> Result<Option<PolicyManifest>, String> {
    policy_for_pack_in(&active_content().manifest.packs, pack_id)
}

fn media_registry() -> Result<MediaRegistry, String> {
    serde_json::from_value(active_content().manifest.generation_media_registry.clone())
        .map_err(|error| format!("generation media registry is unavailable: {error}"))
}

fn reviewed_media_binding(
    profile_id: &str,
    policy: Option<&PolicyMedia>,
) -> Result<GeneratedMediaBinding, String> {
    let registry = media_registry()?;
    let profile = registry
        .profiles
        .iter()
        .find(|candidate| candidate.id == profile_id)
        .ok_or_else(|| format!("generation media profile {profile_id} is not published"))?;
    let recipe_id = policy
        .map(|media| media.recipe_id.as_str())
        .or_else(|| (profile.recipes.len() == 1).then(|| profile.recipes[0].as_str()))
        .ok_or_else(|| format!("generation media profile {profile_id} is ambiguous"))?;
    let recipe = registry
        .recipes
        .iter()
        .find(|candidate| candidate.id == recipe_id)
        .ok_or_else(|| format!("generation media recipe {recipe_id} is not published"))?;
    if recipe.state != "enabled"
        || recipe.profile != profile.id
        || !profile.recipes.contains(&recipe.id)
    {
        return Err(format!(
            "generation media recipe {recipe_id} is not enabled"
        ));
    }
    if let Some(media) = policy {
        let model = format!("{}/{}", recipe.model.owner, recipe.model.name);
        if media.profile_id != profile.id
            || media
                .provider_preference
                .as_ref()
                .is_some_and(|preference| {
                    preference.provider != recipe.provider
                        || preference.model != model
                        || preference.revision != recipe.model.revision
                })
            || !recipe.prompt_versions.contains(&media.prompt_version)
            || !media
                .output_formats
                .first()
                .is_some_and(|format| recipe.output_formats.contains(format))
        {
            return Err(format!(
                "generation media policy does not match recipe {recipe_id}"
            ));
        }
    }
    Ok(GeneratedMediaBinding {
        profile_id: profile.id.clone(),
        recipe_id: recipe.id.clone(),
        provider: recipe.provider.clone(),
        model: format!("{}/{}", recipe.model.owner, recipe.model.name),
        revision: recipe.model.revision.clone(),
        prompt_version: policy
            .map(|media| media.prompt_version.clone())
            .unwrap_or_else(|| recipe.prompt_versions[0].clone()),
        prompt_prefix: policy
            .map(|media| media.prompt_prefix.clone())
            .unwrap_or_default(),
        aspect_ratios: recipe.aspect_ratios.clone(),
        output_format: policy
            .and_then(|media| media.output_formats.first().cloned())
            .unwrap_or_else(|| recipe.output_formats[0].clone()),
    })
}

fn endpoint_pack(location_id: u64) -> Option<&'static str> {
    active_content()
        .locations
        .iter()
        .find(|location| location.id == location_id)
        .map(|location| location.pack_id.as_str())
}

pub(super) fn generated_policy_binding(
    route: &RouteRecordState,
    origin_location_id: u64,
    destination_location_id: u64,
) -> Result<GeneratedPolicyBinding, String> {
    let pack = active_content()
        .manifest
        .packs
        .iter()
        .find(|pack| pack.id == route.owner_pack_id)
        .ok_or_else(|| "source route owner pack is not mounted".to_string())?;
    let Some(policy) = policy_for_pack(&pack.id)? else {
        return Ok(legacy_generated_policy_binding(
            &pack.id,
            &pack.version,
            &active_content().manifest.id,
            &active_content().manifest.bundle_hash,
        ));
    };
    let endpoints = [
        (endpoint_pack(origin_location_id), origin_location_id),
        (
            endpoint_pack(destination_location_id),
            destination_location_id,
        ),
    ];
    let cross_route = policy.cross_pack_routes.iter().find(|candidate| {
        candidate.endpoints.len() == 2
            && candidate.endpoints.iter().all(|endpoint| {
                endpoints.contains(&(Some(endpoint.pack_id.as_str()), endpoint.location_id))
            })
    });
    if endpoints[0].0 != endpoints[1].0 && cross_route.is_none() {
        return Err("cross-pack source route has no matching bridge policy".to_string());
    }
    let media = if let Some(cross_route) = cross_route {
        Some(reviewed_media_binding(&cross_route.media_profile_id, None)?)
    } else {
        policy
            .media
            .as_ref()
            .map(|media| reviewed_media_binding(&media.profile_id, Some(media)))
            .transpose()?
    };
    let owner_pack_id = cross_route
        .map(|route| route.generated_descendant_owner.clone())
        .unwrap_or_else(|| pack.id.clone());
    if owner_pack_id != route.owner_pack_id {
        return Err(
            "generation policy descendant owner differs from source route owner".to_string(),
        );
    }
    Ok(GeneratedPolicyBinding {
        schema_version: 1,
        policy_id: policy.policy_id,
        migration_version: policy.migration_version,
        collision_namespace: policy.collision_namespace,
        owner_pack_id,
        owner_pack_version: pack.version.clone(),
        composition_id: active_content().manifest.id.clone(),
        composition_bundle_hash: active_content().manifest.bundle_hash.clone(),
        prose_profile_id: policy
            .prose
            .as_ref()
            .map(|prose| prose.profile_id.clone())
            .unwrap_or_default(),
        prose_prompt_version: policy
            .prose
            .as_ref()
            .and_then(|prose| prose.prompt_versions.first().cloned())
            .unwrap_or_default(),
        ecology_transition: cross_route
            .map(|route| route.ecology_transition.clone())
            .or_else(|| {
                policy
                    .prose
                    .as_ref()
                    .map(|prose| prose.ecology.interpolation.clone())
            })
            .unwrap_or_default(),
        topology_profile_id: policy
            .topology
            .map(|topology| topology.profile_id)
            .unwrap_or_else(|| "bridge_authority".to_string()),
        unmount_behavior: cross_route
            .map(|route| route.unmount.clone())
            .unwrap_or_else(|| "freeze_with_owner".to_string()),
        place_anchor: policy.place_anchor,
        media,
    })
}

pub(super) fn legacy_generated_policy_binding(
    owner_pack_id: &str,
    owner_pack_version: &str,
    composition_id: &str,
    bundle_hash: &str,
) -> GeneratedPolicyBinding {
    GeneratedPolicyBinding {
        schema_version: 1,
        policy_id: LEGACY_GENERATION_POLICY_ID.to_string(),
        owner_pack_id: owner_pack_id.to_string(),
        owner_pack_version: owner_pack_version.to_string(),
        composition_id: composition_id.to_string(),
        composition_bundle_hash: bundle_hash.to_string(),
        unmount_behavior: "host_default".to_string(),
        ..GeneratedPolicyBinding::default()
    }
}

/// The legacy compatibility binding fabricates no media identity, so two
/// legacy bindings for the same owner pack and version are the same policy
/// even when their bookkeeping (historical bundle hash, composition id)
/// drifted. Pathways were backfilled with whatever historical hash was
/// current at that boot, and media bound at begin time keeps its own copy.
pub(super) fn generated_policy_drift_is_legacy_bookkeeping(
    record: &GeneratedPolicyBinding,
    pathway: &GeneratedPolicyBinding,
) -> bool {
    record.policy_id == LEGACY_GENERATION_POLICY_ID
        && pathway.policy_id == LEGACY_GENERATION_POLICY_ID
        && record.owner_pack_id == pathway.owner_pack_id
        && record.owner_pack_version == pathway.owner_pack_version
}

fn policy_declares_preserved_binding(
    policy: &PolicyManifest,
    binding: &GeneratedPolicyBinding,
) -> bool {
    policy.migrations.iter().any(|migration| {
        migration.from_policy_id == binding.policy_id
            && migration.from_migration_version == binding.migration_version
            && migration.from_pack_version == binding.owner_pack_version
            && migration.mode == "preserve_descendants"
    })
}

/// Generated media captures the pathway policy that existed when generation
/// began. A later, explicitly declared `preserve_descendants` upgrade can
/// therefore leave an older media record beside a newer pathway binding in the
/// same checkpoint. Reconcile only that monotonic, reviewed transition; every
/// tuple on both sides must be current or named exactly by the active policy.
pub(super) fn generated_policy_drift_is_declared_preserving_upgrade(
    record: &GeneratedPolicyBinding,
    pathway: &GeneratedPolicyBinding,
) -> Result<bool, String> {
    if record == pathway
        || record.schema_version != pathway.schema_version
        || record.owner_pack_id != pathway.owner_pack_id
        || record.composition_id != pathway.composition_id
    {
        return Ok(false);
    }

    let pack = active_content()
        .manifest
        .packs
        .iter()
        .find(|pack| pack.id == pathway.owner_pack_id)
        .ok_or_else(|| {
            format!(
                "generated descendant owner pack {} is not mounted",
                pathway.owner_pack_id
            )
        })?;
    let Some(policy) = policy_for_pack(&pathway.owner_pack_id)? else {
        return Ok(false);
    };
    let pathway_is_current = pathway.policy_id == policy.policy_id
        && pathway.migration_version == policy.migration_version
        && pathway.owner_pack_version == pack.version;
    // A pathway can itself still carry an explicitly preserved compatibility
    // policy. Requiring its policy id to equal the active policy id would
    // ignore the exact cross-policy tuple named by the migration manifest.
    let pathway_is_preserved_history = policy_declares_preserved_binding(&policy, pathway);
    let record_is_preserved_history = policy_declares_preserved_binding(&policy, record);
    let transition_is_monotonic = pathway_is_current
        || (pathway_is_preserved_history
            && (record.policy_id == LEGACY_GENERATION_POLICY_ID
                || (record.policy_id == pathway.policy_id
                    && record.migration_version < pathway.migration_version)));

    Ok(record_is_preserved_history
        && (pathway_is_current || pathway_is_preserved_history)
        && transition_is_monotonic)
}

pub(super) fn generation_policy_allows_upgrade(
    binding: &GeneratedPolicyBinding,
    active_pack_version: &str,
) -> Result<(), String> {
    if binding.owner_pack_version == active_pack_version {
        return Ok(());
    }
    let policy = policy_for_pack(&binding.owner_pack_id)?
        .ok_or_else(|| "generation policy disappeared during pack upgrade".to_string())?;
    policy_declares_preserved_binding(&policy, binding)
        .then_some(())
        .ok_or_else(|| {
            format!(
                "pack upgrade from {}@{} policy {} migration {} to {} has no exact generated-descendant migration",
                binding.owner_pack_id,
                binding.owner_pack_version,
                binding.policy_id,
                binding.migration_version,
                active_pack_version,
            )
        })
}

pub(super) fn resolve_generation_media_config(
    config: &ReplicateAvatarArtConfig,
    binding: Option<&GeneratedMediaBinding>,
    aspect_ratio: &str,
) -> Result<ReplicateAvatarArtConfig, String> {
    resolve_generation_media_config_from_registry(
        config,
        binding,
        aspect_ratio,
        active_content().manifest.generation_media_registry.clone(),
    )
}

fn resolve_generation_media_config_from_registry(
    config: &ReplicateAvatarArtConfig,
    binding: Option<&GeneratedMediaBinding>,
    aspect_ratio: &str,
    registry_value: serde_json::Value,
) -> Result<ReplicateAvatarArtConfig, String> {
    let Some(binding) = binding else {
        return Ok(config.clone());
    };
    let registry: MediaRegistry = serde_json::from_value(registry_value)
        .map_err(|error| format!("generation media registry is unavailable: {error}"))?;
    let profile = registry
        .profiles
        .iter()
        .find(|profile| profile.id == binding.profile_id)
        .ok_or_else(|| "generated media profile disappeared".to_string())?;
    let recipe = registry
        .recipes
        .iter()
        .find(|recipe| recipe.id == binding.recipe_id)
        .ok_or_else(|| "generated media recipe disappeared".to_string())?;
    let reviewed_model = format!("{}/{}", recipe.model.owner, recipe.model.name);
    if recipe.state != "enabled"
        || recipe.profile != binding.profile_id
        || !profile.recipes.contains(&binding.recipe_id)
        || recipe.provider != binding.provider
        || reviewed_model != binding.model
        || recipe.model.revision != binding.revision
        || !recipe.prompt_versions.contains(&binding.prompt_version)
        || !recipe.output_formats.contains(&binding.output_format)
        || recipe.aspect_ratios != binding.aspect_ratios
        || !binding
            .aspect_ratios
            .iter()
            .any(|ratio| ratio == aspect_ratio)
        || binding.provider != "replicate"
    {
        return Err("generated media binding is not an enabled reviewed recipe".to_string());
    }
    if recipe.lora && config.lora_url.is_none() {
        return Err("generated media recipe requires configured LoRA weights".to_string());
    }
    let mut resolved = config.clone();
    resolved.model = binding.model.clone();
    resolved.version = Some(binding.revision.clone());
    resolved.output_format = binding.output_format.clone();
    resolved.prompt_prefix = binding.prompt_prefix.clone();
    resolved.provider_defaults = recipe.provider_defaults.clone();
    if !recipe.lora {
        resolved.lora_url = None;
    }
    Ok(resolved)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::cell::Cell;

    fn holy_land_pathway(runtime: &RuntimeWorld) -> GeneratedPathwayState {
        runtime
            .generated_pathway(RATI_ACTOR_ID, 700, 712, 2)
            .expect("Holy Land authored route binds generation policy")
    }

    fn test_art_config() -> ReplicateAvatarArtConfig {
        ReplicateAvatarArtConfig {
            api_token: "test".to_string(),
            model: "host/default".to_string(),
            version: None,
            lora_url: Some("host/lora".to_string()),
            lora_input_key: "lora_weights".to_string(),
            lora_scale_input_key: "lora_scale".to_string(),
            lora_scale: 1.0,
            prompt_prefix: "host prompt".to_string(),
            output_format: "png".to_string(),
            provider_defaults: serde_json::Map::new(),
        }
    }

    #[test]
    fn pack_policy_lookup_is_mount_order_independent() {
        let forward = active_content().manifest.packs.clone();
        let mut reverse = forward.clone();
        reverse.reverse();
        let forward_policy = policy_for_pack_in(&forward, "cosyworld.the-holy-land")
            .unwrap()
            .unwrap();
        let reverse_policy = policy_for_pack_in(&reverse, "cosyworld.the-holy-land")
            .unwrap()
            .unwrap();
        assert_eq!(forward_policy.policy_id, reverse_policy.policy_id);
        assert_eq!(
            forward_policy.migration_version,
            reverse_policy.migration_version
        );
    }

    #[test]
    fn legacy_binding_records_history_without_inventing_media_identity() {
        let binding =
            legacy_generated_policy_binding("pack.old", "1.0.0", "composition.old", "sha256:old");
        assert_eq!(binding.policy_id, LEGACY_GENERATION_POLICY_ID);
        assert_eq!(binding.composition_bundle_hash, "sha256:old");
        assert!(binding.media.is_none());
    }

    #[test]
    fn source_route_binding_is_captured_once_and_inherited_by_every_descendant() {
        let mut runtime = RuntimeWorld::seeded();
        let pathway = holy_land_pathway(&runtime);
        let binding = pathway.generation_policy.clone();
        let waypoint = pathway.waypoints[0].clone();
        assert_eq!(binding.policy_id, "cosyworld.the-holy-land/generation/1");
        assert_eq!(
            binding.composition_bundle_hash,
            active_content().manifest.bundle_hash
        );
        assert_eq!(waypoint.generation_policy, binding);
        let anchor = binding
            .place_anchor
            .as_ref()
            .expect("Holy Land binds authored place-anchor terminology");
        assert_eq!(anchor.action_label, "Build a cairn");
        assert!(anchor.visual_description.contains("local fieldstones"));

        runtime
            .generated_pathways
            .insert(pathway.id.clone(), pathway.clone());
        runtime.ensure_generated_pathway_route_records(&pathway);
        runtime.ensure_generated_place_for_waypoint(
            &pathway,
            waypoint.id,
            pathway.origin_location_id,
        );
        assert!(runtime
            .routes
            .values()
            .filter(|route| route.provenance == format!("generated_pathway:{}", pathway.id))
            .all(|route| route.generation_policy.as_ref() == Some(&binding)));
        assert_eq!(
            runtime.generated_places[&waypoint.id].generation_policy,
            binding
        );
        let anchor_job = &runtime.jobs[&generated_place_anchor_job_id(waypoint.id)];
        assert_eq!(anchor_job.premise, "Build a cairn.");
        assert_eq!(
            anchor_job.action_copy.summary,
            "Stack local stones into a durable trail marker that future travelers can inspect."
        );
        assert_eq!(
            runtime
                .decorate_generated_location_card(
                    card_for_location(waypoint.id, &waypoint.name, Some(&waypoint.meta)),
                    waypoint.id,
                )
                .generation_policy,
            Some(binding)
        );
    }

    #[test]
    fn restart_and_journal_replay_preserve_the_stored_binding_byte_for_byte() {
        let mut runtime = RuntimeWorld::seeded();
        let pathway = holy_land_pathway(&runtime);
        let expected = serde_json::to_value(&pathway.generation_policy).unwrap();
        runtime
            .generated_pathways
            .insert(pathway.id.clone(), pathway.clone());
        runtime.ensure_generated_pathway_route_records(&pathway);
        let restored = RuntimeSnapshot::from_runtime(&runtime)
            .into_runtime()
            .expect("current snapshot restores");
        assert_eq!(
            serde_json::to_value(&restored.generated_pathways[&pathway.id].generation_policy)
                .unwrap(),
            expected
        );

        let mut replay = RuntimeWorld::seeded();
        let mut record = JournalRecord::new(
            CwAction {
                kind: CW_ACTION_NONE,
                actor_id: RATI_ACTOR_ID,
                ..CwAction::default()
            },
            337_001,
        );
        record
            .projection_mutations
            .push(ProjectionMutation::RefinePathway {
                pathway: pathway.clone(),
            });
        assert_eq!(replay.apply_journal_record(&record).0, CW_OK);
        assert_eq!(
            serde_json::to_value(&replay.generated_pathways[&pathway.id].generation_policy)
                .unwrap(),
            expected
        );
    }

    #[test]
    fn legacy_snapshot_binds_to_its_historical_bundle_and_current_omission_fails() {
        let mut runtime = RuntimeWorld::seeded();
        let pathway = holy_land_pathway(&runtime);
        runtime
            .generated_pathways
            .insert(pathway.id.clone(), pathway.clone());
        runtime.ensure_generated_pathway_route_records(&pathway);
        let historical_hash = active_content()
            .manifest
            .persistence_compatibility
            .replay_compatible_bundle_hashes[0]
            .clone();
        let mut snapshot = RuntimeSnapshot::from_runtime(&runtime);
        snapshot.version = 13;
        snapshot.worldpack_bundle_hash = historical_hash.clone();
        let persisted = snapshot
            .generated_pathways
            .get_mut(&pathway.id)
            .expect("pathway is persisted");
        persisted.generation_policy = GeneratedPolicyBinding::default();
        for waypoint in &mut persisted.waypoints {
            waypoint.generation_policy = GeneratedPolicyBinding::default();
        }
        for route in snapshot
            .routes
            .values_mut()
            .filter(|route| route.provenance == format!("generated_pathway:{}", pathway.id))
        {
            route.generation_policy = None;
        }
        let mut forged_current: RuntimeSnapshot =
            serde_json::from_slice(&serde_json::to_vec(&snapshot).unwrap()).unwrap();
        forged_current.version = 14;
        assert!(forged_current.into_runtime().is_err());

        let restored = snapshot.into_runtime().expect("legacy snapshot migrates");
        let binding = &restored.generated_pathways[&pathway.id].generation_policy;
        assert_eq!(binding.policy_id, LEGACY_GENERATION_POLICY_ID);
        assert_eq!(binding.composition_bundle_hash, historical_hash);
        assert!(binding.media.is_none());
        assert!(restored
            .routes
            .values()
            .filter(|route| route.provenance == format!("generated_pathway:{}", pathway.id))
            .all(|route| route.generation_policy.as_ref() == Some(binding)));
    }

    #[test]
    fn upgrade_requires_the_exact_declared_migration_tuple() {
        let legacy = legacy_generated_policy_binding(
            "cosyworld.the-holy-land",
            "1.1.3",
            "cosyworld.official",
            "sha256:historical",
        );
        assert!(generation_policy_allows_upgrade(&legacy, "1.1.5").is_ok());

        let mut production_legacy = legacy.clone();
        production_legacy.owner_pack_version = "1.1.6".to_string();
        assert!(generation_policy_allows_upgrade(&production_legacy, "1.2.0").is_ok());

        let mut declared = legacy;
        declared.policy_id = "cosyworld.the-holy-land/generation/1".to_string();
        declared.migration_version = 1;
        declared.owner_pack_version = "1.1.4".to_string();
        assert!(generation_policy_allows_upgrade(&declared, "1.1.5").is_ok());

        let mut wrong_version = declared.clone();
        wrong_version.owner_pack_version = "1.1.2".to_string();
        let error = generation_policy_allows_upgrade(&wrong_version, "1.1.5")
            .expect_err("an undeclared historical tuple must fail closed");
        assert_eq!(
            error,
            "pack upgrade from cosyworld.the-holy-land@1.1.2 policy cosyworld.the-holy-land/generation/1 migration 1 to 1.1.5 has no exact generated-descendant migration"
        );
        let mut wrong_policy = declared;
        wrong_policy.policy_id = "cosyworld.other/generation/1".to_string();
        assert!(generation_policy_allows_upgrade(&wrong_policy, "1.1.5").is_err());

        let production_bridge = legacy_generated_policy_binding(
            "cosyworld.composition.core-holy-land",
            "1.0.1",
            "cosyworld.official",
            "sha256:94464a2d997bfa589f39091a6644444f879b8f1a3a3e81c054951ba51b153170",
        );
        assert!(
            generation_policy_allows_upgrade(&production_bridge, "1.0.4").is_ok(),
            "the exact production bridge pathway tuple must migrate"
        );
        let mut undeclared_bridge = production_bridge;
        undeclared_bridge.owner_pack_version = "0.9.9".to_string();
        assert!(
            generation_policy_allows_upgrade(&undeclared_bridge, "1.0.4").is_err(),
            "undeclared bridge history must remain fail-closed"
        );

        let production_core = legacy_generated_policy_binding(
            "cosyworld.core",
            "1.3.10",
            "cosyworld.official",
            "sha256:531f773526919ce1da0b8713401ebf60e900f2a906f790ba9a443c6809fed0fa",
        );
        assert!(
            generation_policy_allows_upgrade(&production_core, "1.3.11").is_ok(),
            "the exact production Core pathway tuple must migrate"
        );
        let mut undeclared_core = production_core;
        undeclared_core.owner_pack_version = "1.3.9".to_string();
        assert!(
            generation_policy_allows_upgrade(&undeclared_core, "1.3.11").is_err(),
            "undeclared Core pathway history must remain fail-closed"
        );
    }

    #[test]
    fn production_legacy_116_pathway_checkpoint_restores_idempotently() {
        let mut runtime = RuntimeWorld::seeded();
        let historical_hash =
            "sha256:94464a2d997bfa589f39091a6644444f879b8f1a3a3e81c054951ba51b153170";
        let mut pathway = runtime
            .generated_pathway(RATI_ACTOR_ID, 701, 702, 4)
            .expect("production Holy Land route");
        pathway.id = "pathway:701:702".to_string();
        pathway.identity_version = 0;
        pathway.owner_pack_version = "1.1.6".to_string();
        let binding = legacy_generated_policy_binding(
            "cosyworld.the-holy-land",
            "1.1.6",
            "cosyworld.official",
            historical_hash,
        );
        pathway.generation_policy = binding.clone();
        for waypoint in &mut pathway.waypoints {
            waypoint.generation_policy = binding.clone();
        }
        let source_route_id = pathway.source_route_id.clone();
        runtime
            .generated_pathways
            .insert(pathway.id.clone(), pathway.clone());
        runtime.ensure_generated_pathway_route_records(&pathway);

        let mut snapshot = RuntimeSnapshot::from_runtime(&runtime);
        snapshot.worldpack_bundle_hash = historical_hash.to_string();
        snapshot
            .routes
            .get_mut(&source_route_id)
            .expect("historical source route")
            .owner_pack_version = "1.1.6".to_string();

        let restored = snapshot
            .into_runtime()
            .expect("the exact production legacy tuple must migrate");
        assert_eq!(
            restored.generated_pathways[&pathway.id].generation_policy,
            binding
        );
        assert_eq!(
            restored.routes[&source_route_id].owner_pack_version,
            "1.2.1"
        );

        let replayed = RuntimeSnapshot::from_runtime(&restored)
            .into_runtime()
            .expect("the migrated checkpoint must remain idempotent");
        assert_eq!(
            serde_json::to_value(&replayed.generated_pathways)
                .expect("serialize replayed generated pathways"),
            serde_json::to_value(&restored.generated_pathways)
                .expect("serialize restored generated pathways")
        );
        assert_eq!(replayed.routes, restored.routes);
    }

    #[test]
    fn production_legacy_bridge_pathway_checkpoint_restores_idempotently() {
        let mut runtime = RuntimeWorld::seeded();
        let historical_hash =
            "sha256:94464a2d997bfa589f39091a6644444f879b8f1a3a3e81c054951ba51b153170";
        let mut pathway = runtime
            .generated_pathway(RATI_ACTOR_ID, 1, 700, 2)
            .expect("production Core to Holy Land route");
        pathway.id = "pathway:1:700".to_string();
        pathway.identity_version = 0;
        pathway.owner_pack_version = "1.0.1".to_string();
        let binding = legacy_generated_policy_binding(
            "cosyworld.composition.core-holy-land",
            "1.0.1",
            "cosyworld.official",
            historical_hash,
        );
        pathway.generation_policy = binding.clone();
        for waypoint in &mut pathway.waypoints {
            waypoint.generation_policy = binding.clone();
        }
        let source_route_id = pathway.source_route_id.clone();
        runtime
            .generated_pathways
            .insert(pathway.id.clone(), pathway.clone());
        runtime.ensure_generated_pathway_route_records(&pathway);

        let mut snapshot = RuntimeSnapshot::from_runtime(&runtime);
        snapshot.worldpack_bundle_hash = historical_hash.to_string();
        snapshot
            .routes
            .get_mut(&source_route_id)
            .expect("historical bridge source route")
            .owner_pack_version = "1.0.1".to_string();

        let restored = snapshot
            .into_runtime()
            .expect("the exact production bridge tuple must migrate");
        assert_eq!(
            restored.generated_pathways[&pathway.id].generation_policy,
            binding
        );
        assert_eq!(
            restored.routes[&source_route_id].owner_pack_version,
            "1.0.4"
        );

        let replayed = RuntimeSnapshot::from_runtime(&restored)
            .into_runtime()
            .expect("the migrated bridge checkpoint must remain idempotent");
        assert_eq!(
            serde_json::to_value(&replayed.generated_pathways)
                .expect("serialize replayed generated pathways"),
            serde_json::to_value(&restored.generated_pathways)
                .expect("serialize restored generated pathways")
        );
        assert_eq!(replayed.routes, restored.routes);
    }

    #[test]
    fn production_legacy_core_pathway_checkpoint_restores_idempotently() {
        let mut runtime = RuntimeWorld::seeded();
        let historical_hash =
            "sha256:531f773526919ce1da0b8713401ebf60e900f2a906f790ba9a443c6809fed0fa";
        let mut pathway = runtime
            .generated_pathway(RATI_ACTOR_ID, 2, 3, 2)
            .expect("production Core route");
        pathway.id = "pathway:2:3".to_string();
        pathway.identity_version = 0;
        pathway.owner_pack_version = "1.3.10".to_string();
        let binding = legacy_generated_policy_binding(
            "cosyworld.core",
            "1.3.10",
            "cosyworld.official",
            historical_hash,
        );
        pathway.generation_policy = binding.clone();
        for waypoint in &mut pathway.waypoints {
            waypoint.generation_policy = binding.clone();
        }
        let source_route_id = pathway.source_route_id.clone();
        runtime
            .generated_pathways
            .insert(pathway.id.clone(), pathway.clone());
        runtime.ensure_generated_pathway_route_records(&pathway);

        let mut snapshot = RuntimeSnapshot::from_runtime(&runtime);
        snapshot.worldpack_bundle_hash = historical_hash.to_string();
        snapshot
            .routes
            .get_mut(&source_route_id)
            .expect("historical Core source route")
            .owner_pack_version = "1.3.10".to_string();

        let restored = snapshot
            .into_runtime()
            .expect("the exact production Core tuple must migrate");
        assert_eq!(
            restored.generated_pathways[&pathway.id].generation_policy,
            binding
        );
        assert_eq!(
            restored.routes[&source_route_id].owner_pack_version,
            "1.3.11"
        );

        let replayed = RuntimeSnapshot::from_runtime(&restored)
            .into_runtime()
            .expect("the migrated Core checkpoint must remain idempotent");
        assert_eq!(
            serde_json::to_value(&replayed.generated_pathways)
                .expect("serialize replayed generated pathways"),
            serde_json::to_value(&restored.generated_pathways)
                .expect("serialize restored generated pathways")
        );
        assert_eq!(replayed.routes, restored.routes);
    }

    #[test]
    fn bridge_unmount_ownership_leaves_no_generated_descendant_orphan() {
        let mut runtime = RuntimeWorld::seeded();
        let pathway = runtime
            .generated_pathway(RATI_ACTOR_ID, 1, 700, 2)
            .expect("bridge route binds bridge generation policy");
        let owner = "cosyworld.composition.core-holy-land";
        assert_eq!(pathway.owner_pack_id, owner);
        assert_eq!(pathway.generation_policy.owner_pack_id, owner);
        assert!(pathway
            .waypoints
            .iter()
            .all(|waypoint| waypoint.generation_policy.owner_pack_id == owner));
        runtime.ensure_generated_pathway_route_records(&pathway);
        let waypoint = &pathway.waypoints[0];
        runtime.ensure_generated_place_for_waypoint(
            &pathway,
            waypoint.id,
            pathway.origin_location_id,
        );
        assert_eq!(runtime.generated_places[&waypoint.id].pack_id, owner);
        assert_eq!(
            runtime.generated_places[&waypoint.id]
                .generation_policy
                .owner_pack_id,
            owner
        );
        assert!(runtime
            .routes
            .values()
            .filter(|route| route.provenance == format!("generated_pathway:{}", pathway.id))
            .all(|route| route.owner_pack_id == owner));
    }

    #[test]
    fn current_snapshot_rejects_generated_place_and_media_orphans() {
        let mut runtime = RuntimeWorld::seeded();
        let pathway = holy_land_pathway(&runtime);
        let waypoint = pathway.waypoints[0].clone();
        runtime
            .generated_pathways
            .insert(pathway.id.clone(), pathway.clone());
        runtime.ensure_generated_place_for_waypoint(
            &pathway,
            waypoint.id,
            pathway.origin_location_id,
        );
        runtime
            .generated_places
            .get_mut(&waypoint.id)
            .expect("generated place exists")
            .generation_policy = GeneratedPolicyBinding::default();
        runtime.generated_pathways.remove(&pathway.id);
        assert!(RuntimeSnapshot::from_runtime(&runtime)
            .into_runtime()
            .is_err());

        let mut runtime = RuntimeWorld::seeded();
        runtime
            .generated_pathways
            .insert(pathway.id.clone(), pathway.clone());
        let _ = runtime.apply_fund_community_art_projection(
            "location",
            waypoint.id,
            1,
            1,
            RATI_ACTOR_ID,
            "orphan-fixture",
            1,
            337_004,
            None,
        );
        runtime
            .community_art_generations
            .get_mut(&community_art_generation_key("location", waypoint.id, 1))
            .expect("generated media state exists")
            .generation_policy = pathway.generation_policy.clone();
        runtime.generated_pathways.remove(&pathway.id);
        assert!(RuntimeSnapshot::from_runtime(&runtime)
            .into_runtime()
            .is_err());
    }

    #[test]
    fn funded_unbound_location_media_adopts_its_pathway_binding_on_snapshot_load() {
        // Media is bound when generation begins; a snapshot taken while the
        // record is funded but unbegun carries an empty binding. That state is
        // legitimate live state, so loading adopts the pathway binding exactly
        // as begin would instead of rejecting the checkpoint.
        let mut runtime = RuntimeWorld::seeded();
        let pathway = holy_land_pathway(&runtime);
        let subject_id = pathway.waypoints[0].id;
        let binding = pathway.generation_policy.clone();
        runtime
            .generated_pathways
            .insert(pathway.id.clone(), pathway);
        let _ = runtime.apply_fund_community_art_projection(
            "location",
            subject_id,
            1,
            1,
            RATI_ACTOR_ID,
            "unbound-fixture",
            1,
            337_005,
            None,
        );
        let key = community_art_generation_key("location", subject_id, 1);
        assert!(runtime.community_art_generations[&key]
            .generation_policy
            .is_empty());

        let restored = RuntimeSnapshot::from_runtime(&runtime)
            .into_runtime()
            .expect("funded-but-unbound media must not reject the checkpoint");
        assert_eq!(
            restored.community_art_generations[&key].generation_policy,
            binding
        );
    }

    #[test]
    fn generated_media_whose_pathway_binding_changed_fails_closed() {
        // A non-empty binding that no longer matches its pathway is a real
        // divergence: reconciliation must fail closed rather than rewrite
        // history.
        let mut runtime = RuntimeWorld::seeded();
        let pathway = holy_land_pathway(&runtime);
        let subject_id = pathway.waypoints[0].id;
        let mut stale_binding = pathway.generation_policy.clone();
        stale_binding.composition_bundle_hash = "sha256:stale-bundle".to_string();
        runtime
            .generated_pathways
            .insert(pathway.id.clone(), pathway);
        let _ = runtime.apply_fund_community_art_projection(
            "location",
            subject_id,
            1,
            1,
            RATI_ACTOR_ID,
            "stale-fixture",
            1,
            337_006,
            None,
        );
        runtime
            .community_art_generations
            .get_mut(&community_art_generation_key("location", subject_id, 1))
            .expect("generated media state exists")
            .generation_policy = stale_binding;

        let error = RuntimeSnapshot::from_runtime(&runtime)
            .into_runtime()
            .expect_err("a diverging bound media record must fail closed");
        assert!(
            error
                .to_string()
                .contains("policy binding differs from its pathway"),
            "unexpected error: {error}"
        );
    }

    #[test]
    fn declared_preserving_upgrade_adopts_the_newer_pathway_binding() {
        // Production can contain media begun under migration v1 beside the
        // same pathway after it advanced to v2. Both historical tuples are
        // explicitly preserved by the current Holy Land policy, so loading
        // adopts the newer pathway binding without permitting arbitrary drift.
        let mut runtime = RuntimeWorld::seeded();
        let mut pathway = holy_land_pathway(&runtime);
        let subject_id = pathway.waypoints[0].id;
        let mut pathway_binding = pathway.generation_policy.clone();
        pathway_binding.migration_version = 2;
        pathway_binding.owner_pack_version = "1.1.6".to_string();
        pathway_binding.composition_bundle_hash = "sha256:pathway-v2".to_string();
        pathway.owner_pack_version = pathway_binding.owner_pack_version.clone();
        pathway.generation_policy = pathway_binding.clone();
        for waypoint in &mut pathway.waypoints {
            waypoint.generation_policy = pathway_binding.clone();
        }
        runtime
            .generated_pathways
            .insert(pathway.id.clone(), pathway);
        let _ = runtime.apply_fund_community_art_projection(
            "location",
            subject_id,
            1,
            1,
            RATI_ACTOR_ID,
            "preserved-upgrade-fixture",
            1,
            337_008,
            None,
        );
        let mut media_binding = pathway_binding.clone();
        media_binding.migration_version = 1;
        media_binding.owner_pack_version = "1.1.4".to_string();
        media_binding.composition_bundle_hash = "sha256:media-v1".to_string();
        let key = community_art_generation_key("location", subject_id, 1);
        runtime
            .community_art_generations
            .get_mut(&key)
            .expect("generated media state exists")
            .generation_policy = media_binding.clone();

        assert!(
            !generated_policy_drift_is_declared_preserving_upgrade(
                &pathway_binding,
                &media_binding,
            )
            .expect("reviewed policy lookup succeeds"),
            "the reverse transition must remain a rejected downgrade"
        );
        let mut snapshot = RuntimeSnapshot::from_runtime(&runtime);
        snapshot.worldpack_bundle_hash =
            "sha256:94464a2d997bfa589f39091a6644444f879b8f1a3a3e81c054951ba51b153170".to_string();
        let restored = snapshot
            .into_runtime()
            .expect("the production-shaped preserving upgrade checkpoint must load");
        assert_eq!(
            restored.community_art_generations[&key].generation_policy,
            pathway_binding
        );
    }

    #[test]
    fn production_legacy_media_owner_upgrade_adopts_the_pathway_binding() {
        // Production checkpoint subject 157216 was generated under Holy Land
        // 1.1.4's host compatibility policy. Its pathway was then migrated to
        // 1.1.6 with every other identity field unchanged. The active policy
        // declares this exact historical tuple as descendant-preserving.
        let mut runtime = RuntimeWorld::seeded();
        let mut pathway = holy_land_pathway(&runtime);
        // Use the fixture pathway's canonical waypoint id; subject 157216 is
        // the production instance carrying the same policy tuple.
        let subject_id = pathway.waypoints[0].id;
        let shared_bundle =
            "sha256:9e91a900766633f5f52b8fe58e8f409f020233553e3fe5bf24ff519553e972ac";
        let pathway_binding = legacy_generated_policy_binding(
            "cosyworld.the-holy-land",
            "1.1.6",
            "cosyworld.official",
            shared_bundle,
        );
        pathway.owner_pack_version = pathway_binding.owner_pack_version.clone();
        pathway.generation_policy = pathway_binding.clone();
        for waypoint in &mut pathway.waypoints {
            waypoint.generation_policy = pathway_binding.clone();
        }
        runtime
            .generated_pathways
            .insert(pathway.id.clone(), pathway);
        let _ = runtime.apply_fund_community_art_projection(
            "location",
            subject_id,
            1,
            1,
            RATI_ACTOR_ID,
            "production-media-157216",
            1,
            337_009,
            None,
        );
        let media_binding = legacy_generated_policy_binding(
            "cosyworld.the-holy-land",
            "1.1.4",
            "cosyworld.official",
            shared_bundle,
        );
        let policy = policy_for_pack("cosyworld.the-holy-land")
            .expect("active Holy Land policy resolves")
            .expect("Holy Land owns a generation policy");
        assert!(
            policy_declares_preserved_binding(&policy, &media_binding),
            "the active policy must name the exact legacy media tuple"
        );
        assert!(
            policy_declares_preserved_binding(&policy, &pathway_binding),
            "the active policy must name the exact legacy pathway tuple"
        );
        let key = community_art_generation_key("location", subject_id, 1);
        runtime
            .community_art_generations
            .get_mut(&key)
            .expect("production-shaped generated media exists")
            .generation_policy = media_binding.clone();

        assert!(
            generated_policy_drift_is_declared_preserving_upgrade(
                &media_binding,
                &pathway_binding,
            )
            .expect("reviewed policy lookup succeeds"),
            "the exact production owner upgrade must be declared"
        );
        let restored = RuntimeSnapshot::from_runtime(&runtime)
            .into_runtime()
            .expect("the production-shaped legacy media checkpoint must load");
        assert_eq!(
            restored.community_art_generations[&key].generation_policy,
            pathway_binding
        );

        let mut undeclared = media_binding;
        undeclared.owner_pack_version = "1.1.2".to_string();
        assert!(
            !generated_policy_drift_is_declared_preserving_upgrade(
                &undeclared,
                &restored.community_art_generations[&key].generation_policy,
            )
            .expect("reviewed policy lookup succeeds"),
            "nearby but undeclared legacy history must remain rejected"
        );
    }

    #[test]
    fn legacy_bookkeeping_drift_adopts_the_pathway_binding_on_snapshot_load() {
        // Production carried media bound to a legacy compatibility binding
        // with the historical bundle hash that was current at begin time,
        // while its pathway was backfilled with a different one. Same legacy
        // policy, same owner: bookkeeping drift, adopted on load.
        let mut runtime = RuntimeWorld::seeded();
        let pathway = holy_land_pathway(&runtime);
        let subject_id = pathway.waypoints[0].id;
        let owner_pack_id = pathway.owner_pack_id.clone();
        let owner_pack_version = pathway.owner_pack_version.clone();
        let mut legacy_pathway = pathway.clone();
        let pathway_binding = legacy_generated_policy_binding(
            &owner_pack_id,
            &owner_pack_version,
            "cosyworld.official",
            "sha256:pathway-historical",
        );
        legacy_pathway.generation_policy = pathway_binding.clone();
        for waypoint in &mut legacy_pathway.waypoints {
            waypoint.generation_policy = pathway_binding.clone();
        }
        runtime
            .generated_pathways
            .insert(legacy_pathway.id.clone(), legacy_pathway);
        let _ = runtime.apply_fund_community_art_projection(
            "location",
            subject_id,
            1,
            1,
            RATI_ACTOR_ID,
            "drift-fixture",
            1,
            337_007,
            None,
        );
        let stale_binding = legacy_generated_policy_binding(
            &owner_pack_id,
            &owner_pack_version,
            "cosyworld.official",
            "sha256:media-historical",
        );
        let key = community_art_generation_key("location", subject_id, 1);
        runtime
            .community_art_generations
            .get_mut(&key)
            .expect("generated media state exists")
            .generation_policy = stale_binding;

        let restored = RuntimeSnapshot::from_runtime(&runtime)
            .into_runtime()
            .expect("legacy bookkeeping drift must not reject the checkpoint");
        assert_eq!(
            restored.community_art_generations[&key].generation_policy,
            pathway_binding
        );
    }

    #[test]
    fn media_begin_record_persists_the_same_generated_binding_on_replay() {
        let mut runtime = RuntimeWorld::seeded();
        let pathway = holy_land_pathway(&runtime);
        let subject_id = pathway.waypoints[0].id;
        let binding = pathway.generation_policy.clone();
        runtime
            .generated_pathways
            .insert(pathway.id.clone(), pathway);
        let _ = runtime.apply_fund_community_art_projection(
            "location",
            subject_id,
            1,
            1,
            RATI_ACTOR_ID,
            "binding-fixture",
            1,
            337_002,
            None,
        );
        let record = JournalRecord {
            projection_mutations: vec![ProjectionMutation::BeginCommunityArtGeneration {
                subject_kind: "location".to_string(),
                subject_id,
                level: 1,
                provider_attempt: true,
                generation_profile_version: LOCATION_LANDSCAPE_GENERATION_PROFILE_VERSION,
                generation_policy: binding.clone(),
                frozen_plan: None,
            }],
            ..JournalRecord::new(
                CwAction {
                    kind: CW_ACTION_NONE,
                    actor_id: RATI_ACTOR_ID,
                    ..CwAction::default()
                },
                337_003,
            )
        };
        let replayed: JournalRecord =
            serde_json::from_slice(&serde_json::to_vec(&record).unwrap()).unwrap();
        assert_eq!(runtime.apply_journal_record(&replayed).0, CW_OK);
        assert_eq!(
            runtime.community_art_generations
                [&community_art_generation_key("location", subject_id, 1)]
                .generation_policy,
            binding
        );
    }

    #[test]
    fn absent_disabled_or_mismatched_recipe_fails_before_provider_submission() {
        let runtime = RuntimeWorld::seeded();
        let binding = holy_land_pathway(&runtime)
            .generation_policy
            .media
            .expect("Holy Land policy has reviewed media");
        let calls = Cell::new(0_u8);
        let submit = |result: Result<ReplicateAvatarArtConfig, String>| {
            result.map(|_| calls.set(calls.get() + 1))
        };

        let mut absent = binding.clone();
        absent.recipe_id = "recipe.absent".to_string();
        assert!(submit(resolve_generation_media_config(
            &test_art_config(),
            Some(&absent),
            "16:9"
        ))
        .is_err());

        let mut disabled_registry = active_content().manifest.generation_media_registry.clone();
        disabled_registry["recipes"]
            .as_array_mut()
            .unwrap()
            .iter_mut()
            .find(|recipe| recipe["id"] == binding.recipe_id)
            .unwrap()["state"] = serde_json::json!("disabled");
        assert!(submit(resolve_generation_media_config_from_registry(
            &test_art_config(),
            Some(&binding),
            "16:9",
            disabled_registry,
        ))
        .is_err());

        let mut mismatched = binding;
        mismatched.revision = "sha256:not-reviewed".to_string();
        assert!(submit(resolve_generation_media_config(
            &test_art_config(),
            Some(&mismatched),
            "16:9"
        ))
        .is_err());
        assert_eq!(calls.get(), 0, "provider submission must never be reached");
    }

    #[test]
    fn holy_land_generated_art_uses_reviewed_model_native_b43l_inputs() {
        let runtime = RuntimeWorld::seeded();
        let binding = holy_land_pathway(&runtime)
            .generation_policy
            .media
            .expect("Holy Land policy has reviewed media");
        let resolved = resolve_generation_media_config(&test_art_config(), Some(&binding), "16:9")
            .expect("Holy Land recipe resolves");

        assert_eq!(resolved.model, "ratimics/b43l");
        assert_eq!(resolved.lora_url, None);
        assert_eq!(
            resolved.provider_defaults.get("lora_scale"),
            Some(&serde_json::json!(1.25))
        );
        assert_eq!(
            resolved.provider_defaults.get("guidance_scale"),
            Some(&serde_json::json!(4.5))
        );
        assert_eq!(
            resolved.provider_defaults.get("num_inference_steps"),
            Some(&serde_json::json!(28))
        );
    }
}
