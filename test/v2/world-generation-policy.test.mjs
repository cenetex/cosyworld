import {
  validateCompiledGenerationPolicies,
  validateGenerationPolicyManifest,
  worldpackMediaRegistry,
} from "../../v2/scripts/world-generation-policy.mjs";

const ecologyContext = [
  "route_id",
  "route_version",
  "origin",
  "destination",
  "travel_direction",
  "segment_index",
  "segment_count",
  "biome",
  "terrain",
  "climate",
  "landforms",
  "geology",
  "hydrology",
  "vegetation",
  "fauna",
  "resource_cues",
  "nearby_authored_descriptions",
];

function generationPolicy(packId = "fixture.world") {
  return {
    schema_version: 1,
    policy_id: `${packId}/generation/1`,
    migration_version: 1,
    collision_namespace: `pack://${packId}/generated/v1`,
    generated_descendants: {
      owner: "source_route",
      composition: "active_bundle",
      subject_kinds: ["route", "waypoint", "place", "location_card"],
      on_upgrade: "require_declared_migration",
      on_unmount: "freeze_with_owner",
    },
    prose: {
      profile_id: "cosyworld.pathway-prose.ecology/1",
      prompt_versions: ["pathway-content-v1"],
      ecology: {
        interpolation: "endpoint_blend/1",
        required_context: [...ecologyContext],
      },
    },
    media: {
      profile_id: "cosyworld.community-art.base/1",
      recipe_id: "replicate.flux1-dev-lora.base",
      provider_preference: {
        provider: "replicate",
        model: "black-forest-labs/flux-dev-lora",
        revision:
          "ae0d7d645446924cf1871e3ca8796e8318f72465d2b5af9323a835df93bf0917",
      },
      prompt_version: "community-art/3",
      prompt_prefix: "Cozy hand-painted fantasy landscape",
      aspect_ratios: ["16:9"],
      output_formats: ["webp"],
      negative_constraints: ["no text"],
      subject_kinds: ["location_card"],
      authored_art: "permanent",
      community_art: "eligible",
      unexplored_placeholder: "common_unexplored/1",
      fallback: "unexplored_placeholder",
    },
    topology: {
      profile_id: "linear_journey",
      directionality: "reciprocal_or_explicit_one_way",
      evacuation: "world_lifecycle_required",
      budgets: {
        components: { min: 1, max: 1 },
        roots: { min: 1, max: 2 },
        ingress: { min: 0, max: 1 },
        egress: { min: 0, max: 1 },
        weighted_distance: { min: 1, max: 4 },
        degree: { min: 1, max: 3 },
        cycle_rank: { min: 0, max: 1 },
        bridges: { min: 1, max: 3 },
        articulation_impact: { min: 0, max: 2 },
        terminal_spurs: { min: 1, max: 3 },
      },
    },
    migrations: [
      {
        from_policy_id: "cosyworld.compatibility.host-generation/1",
        from_migration_version: 0,
        from_pack_version: "0.9.0",
        mode: "preserve_descendants",
      },
    ],
    cross_pack_routes: [],
  };
}

function pack(id = "fixture.world", policy = generationPolicy(id)) {
  return {
    id,
    version: "1.0.0",
    entry_points: [{ kind: "location", id: "location/1" }],
    dependencies: [],
    extensions: { "x-cosyworld-generation": policy },
  };
}

describe("world-generation-policy/1", () => {
  it("accepts the current ecology pathway prompt contract", () => {
    const candidate = generationPolicy();
    candidate.prose.prompt_versions = ["pathway-content-v2"];
    expect(() =>
      validateGenerationPolicyManifest(pack("fixture.world", candidate)),
    ).not.toThrow();
  });

  it("accepts a closed policy and publishes only reviewed media coordinates", () => {
    expect(() => validateGenerationPolicyManifest(pack())).not.toThrow();
    const registry = worldpackMediaRegistry();
    expect(registry.schema_version).toBe(1);
    expect(
      registry.recipes.every(
        (recipe) =>
          recipe.state === "enabled" &&
          /^[a-f0-9]{64}$/.test(recipe.model.revision) &&
          recipe.intents.includes("location_card_art"),
      ),
    ).toBe(true);
    expect(
      registry.recipes.find(
        (recipe) => recipe.id === "replicate.holy-land-b43l.base",
      )?.model,
    ).toEqual({
      owner: "ratimics",
      name: "b43l",
      revision:
        "2846199bda89a44676dc5da00bd02faa3f5183b1c1d3e124c966d656874f141f",
    });
  });

  it("resolves a profile and recipe without a vendor preference", () => {
    const candidate = generationPolicy();
    delete candidate.media.provider_preference;
    expect(() =>
      validateGenerationPolicyManifest(pack("fixture.world", candidate)),
    ).not.toThrow();
  });

  it.each([
    "api_key",
    "credentials",
    "endpoint_url",
    "request_body",
    "surprise",
  ])("rejects provider wire field %s", (field) => {
    const candidate = generationPolicy();
    candidate.media.provider_preference[field] =
      field === "request_body" ? {} : "secret";
    expect(() =>
      validateGenerationPolicyManifest(pack("fixture.world", candidate)),
    ).toThrow(/additional properties/);
  });

  it.each([
    ["prompt_prefix", "Landscape from https://provider.example/model"],
    ["negative_constraints", "avoid ipfs://asset-reference"],
  ])("rejects a URL embedded in media %s", (field, value) => {
    const candidate = generationPolicy();
    if (field === "negative_constraints") candidate.media[field] = [value];
    else candidate.media[field] = value;
    expect(() =>
      validateGenerationPolicyManifest(pack("fixture.world", candidate)),
    ).toThrow(/cannot contain provider or asset URLs/);
  });

  it("rejects unreviewed profiles, recipes, models, revisions, and prompt versions", () => {
    for (const mutate of [
      (media) => {
        media.profile_id = "fixture.unreviewed/1";
      },
      (media) => {
        media.recipe_id = "replicate.unreviewed";
      },
      (media) => {
        media.provider_preference.model = "fixture/unreviewed";
      },
      (media) => {
        media.provider_preference.revision = "0".repeat(64);
      },
      (media) => {
        media.prompt_version = "community-art/999";
      },
    ]) {
      const candidate = generationPolicy();
      mutate(candidate.media);
      expect(() =>
        validateGenerationPolicyManifest(pack("fixture.world", candidate)),
      ).toThrow(
        /unknown media profile|not allowlisted|does not match|not allowed/,
      );
    }
  });

  it("rejects incomplete ecology, inverted budgets, and undeclared migrations", () => {
    const ecology = generationPolicy();
    ecology.prose.ecology.required_context.pop();
    expect(() =>
      validateGenerationPolicyManifest(pack("fixture.world", ecology)),
    ).toThrow(/complete ecology context/);

    const topology = generationPolicy();
    topology.topology.budgets.degree = { min: 4, max: 2 };
    expect(() =>
      validateGenerationPolicyManifest(pack("fixture.world", topology)),
    ).toThrow(/min greater than max/);

    const migration = generationPolicy();
    migration.migrations.push(structuredClone(migration.migrations[0]));
    expect(() =>
      validateGenerationPolicyManifest(pack("fixture.world", migration)),
    ).toThrow(/duplicate generation migration/);
  });

  it("preserves explicit legacy compatibility and activates bridge enforcement on opt-in", () => {
    const left = {
      id: "fixture.left",
      entry_points: [],
      dependencies: [],
      extensions: {},
    };
    const right = {
      id: "fixture.right",
      entry_points: [],
      dependencies: [],
      extensions: {},
    };
    const legacyBridge = {
      id: "fixture.bridge",
      entry_points: [],
      dependencies: ["fixture.left", "fixture.right"],
      extensions: {
        "x-cosyworld-composition": { schema_version: 1, role: "bridge" },
      },
    };
    const resources = {
      locations: [
        { id: 1, pack_id: "fixture.left" },
        { id: 2, pack_id: "fixture.right" },
      ],
      exits: [
        { from_location_id: 1, to_location_id: 2, pack_id: "fixture.bridge" },
        { from_location_id: 2, to_location_id: 1, pack_id: "fixture.bridge" },
      ],
      hidden_exits: [],
    };
    expect(() =>
      validateCompiledGenerationPolicies(
        [left, right, legacyBridge],
        resources,
      ),
    ).not.toThrow();

    const bridgePolicy = generationPolicy("fixture.bridge");
    delete bridgePolicy.generated_descendants;
    delete bridgePolicy.prose;
    delete bridgePolicy.media;
    delete bridgePolicy.topology;
    legacyBridge.extensions["x-cosyworld-generation"] = bridgePolicy;
    expect(() =>
      validateCompiledGenerationPolicies(
        [left, right, legacyBridge],
        resources,
      ),
    ).toThrow(/has no bridge declaration/);

    bridgePolicy.cross_pack_routes.push({
      endpoints: [
        { pack_id: "fixture.left", location_id: 1 },
        { pack_id: "fixture.right", location_id: 2 },
      ],
      route_owner: "fixture.bridge",
      generated_descendant_owner: "fixture.bridge",
      topology_authority: { pack_id: "fixture.bridge", migration_version: 1 },
      ecology_transition: "endpoint_blend/1",
      media_profile_id: "cosyworld.community-art.base/1",
      unmount: "remove_with_route_owner",
      evacuation: "world_pack_lifecycle",
    });
    expect(() =>
      validateCompiledGenerationPolicies(
        [left, right, legacyBridge],
        resources,
      ),
    ).not.toThrow();
  });

  it("measures reviewed topology bounds and requires declared evacuation", () => {
    const world = pack();
    const resources = {
      locations: [1, 2, 3].map((id) => ({ id, pack_id: "fixture.world" })),
      exits: [
        { from_location_id: 1, to_location_id: 2, pack_id: "fixture.world" },
        { from_location_id: 2, to_location_id: 3, pack_id: "fixture.world" },
      ],
      hidden_exits: [],
    };
    const reports = validateCompiledGenerationPolicies([world], resources, {
      unmount: [{ pack_id: "fixture.world" }],
    });
    expect(reports.get("fixture.world")).toEqual({
      components: 1,
      roots: 1,
      ingress: 0,
      egress: 0,
      weighted_distance: 2,
      degree: 2,
      cycle_rank: 0,
      bridges: 2,
      articulation_impact: 1,
      terminal_spurs: 2,
    });
    expect(() =>
      validateCompiledGenerationPolicies([world], resources),
    ).toThrow(/lifecycle evacuation/);
  });
});
