use super::*;

pub(super) const PATHWAY_CONTENT_FEATURE: &str = "pathway_content";
pub(super) const PATHWAY_CONTENT_PROMPT_VERSION: &str = "pathway-content-v1";

#[derive(Clone, Debug, Default, Deserialize, Serialize)]
pub(super) struct GenerationProvenance {
    pub(super) source: String,
    pub(super) feature: String,
    pub(super) policy_mode: String,
    pub(super) prompt_version: String,
    pub(super) provider: String,
    pub(super) model: String,
    pub(super) attempts: u8,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
pub(super) struct GeneratedWaypointState {
    pub(super) id: u64,
    #[serde(default)]
    pub(super) canonical_id: String,
    pub(super) name: String,
    pub(super) meta: LocationMeta,
    #[serde(default)]
    pub(super) generation_policy: GeneratedPolicyBinding,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
pub(super) struct GeneratedPathwayState {
    pub(super) id: String,
    #[serde(default)]
    pub(super) identity_version: u8,
    #[serde(default)]
    pub(super) canonical_id: String,
    #[serde(default)]
    pub(super) source_route_id: String,
    #[serde(default)]
    pub(super) source_route_version: u64,
    #[serde(default)]
    pub(super) owner_pack_id: String,
    #[serde(default)]
    pub(super) owner_pack_version: String,
    #[serde(default)]
    pub(super) generation_policy: GeneratedPolicyBinding,
    pub(super) origin_location_id: u64,
    pub(super) destination_location_id: u64,
    pub(super) distance: u8,
    pub(super) created_by_actor_id: u64,
    pub(super) waypoints: Vec<GeneratedWaypointState>,
    #[serde(default)]
    pub(super) generation: GenerationProvenance,
    #[serde(default)]
    pub(super) revealed_edges: BTreeSet<String>,
    #[serde(default)]
    pub(super) art_eligible: bool,
    #[serde(default)]
    pub(super) familiar: bool,
}

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
    pub(super) media: Option<GeneratedMediaBinding>,
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
    Ok(())
}

#[derive(Clone, Deserialize)]
struct PolicyManifest {
    policy_id: String,
    migration_version: u32,
    collision_namespace: String,
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

pub(super) fn generation_policy_allows_upgrade(
    binding: &GeneratedPolicyBinding,
    active_pack_version: &str,
) -> Result<(), String> {
    if binding.owner_pack_version == active_pack_version {
        return Ok(());
    }
    let policy = policy_for_pack(&binding.owner_pack_id)?
        .ok_or_else(|| "generation policy disappeared during pack upgrade".to_string())?;
    policy
        .migrations
        .iter()
        .any(|migration| {
            migration.from_policy_id == binding.policy_id
                && migration.from_migration_version == binding.migration_version
                && migration.from_pack_version == binding.owner_pack_version
                && migration.mode == "preserve_descendants"
        })
        .then_some(())
        .ok_or_else(|| "pack upgrade has no exact generated-descendant migration".to_string())
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
        let declared = legacy_generated_policy_binding(
            "cosyworld.the-holy-land",
            "1.1.3",
            "cosyworld.official",
            "sha256:historical",
        );
        assert!(generation_policy_allows_upgrade(&declared, "1.1.4").is_ok());

        let mut wrong_version = declared.clone();
        wrong_version.owner_pack_version = "1.1.2".to_string();
        assert!(generation_policy_allows_upgrade(&wrong_version, "1.1.4").is_err());
        let mut wrong_policy = declared;
        wrong_policy.policy_id = "cosyworld.other/generation/1".to_string();
        assert!(generation_policy_allows_upgrade(&wrong_policy, "1.1.4").is_err());
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
        );
        let record = JournalRecord {
            projection_mutations: vec![ProjectionMutation::BeginCommunityArtGeneration {
                subject_kind: "location".to_string(),
                subject_id,
                level: 1,
                provider_attempt: true,
                generation_profile_version: LOCATION_LANDSCAPE_GENERATION_PROFILE_VERSION,
                generation_policy: binding.clone(),
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
}
