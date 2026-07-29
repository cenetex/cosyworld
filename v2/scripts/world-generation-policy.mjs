import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import Ajv from "ajv";

export const GENERATION_POLICY_EXTENSION = "x-cosyworld-generation";
export const LEGACY_GENERATION_POLICY_ID =
  "cosyworld.compatibility.host-generation/1";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const schema = JSON.parse(
  fs.readFileSync(
    path.resolve(
      scriptDir,
      "../schemas/world-generation-policy-v1.schema.json",
    ),
    "utf8",
  ),
);
const mediaRegistry = JSON.parse(
  fs.readFileSync(
    path.resolve(scriptDir, "../media/worldpack-recipes.json"),
    "utf8",
  ),
);
const validateSchema = new Ajv({ allErrors: true, strict: false }).compile(
  schema,
);
const mediaProfiles = new Map(
  mediaRegistry.profiles.map((profile) => [profile.id, profile]),
);
const mediaRecipes = new Map(
  mediaRegistry.recipes.map((recipe) => [recipe.id, recipe]),
);
const proseProfiles = new Set(["cosyworld.pathway-prose.ecology/1"]);
const ecologyContext = new Set([
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
]);

function fail(label, message) {
  throw new Error(`${label}: ${message}`);
}

function schemaErrors() {
  return (validateSchema.errors ?? [])
    .map((error) => `${error.instancePath || "/"} ${error.message}`)
    .join("; ");
}

function manifestDependencies(pack) {
  return new Set(
    (pack.dependency_requirements ?? pack.dependencies ?? []).map(
      (dependency) =>
        typeof dependency === "string" ? dependency : dependency.id,
    ),
  );
}

export function generationPolicyForPack(pack) {
  return pack.extensions?.[GENERATION_POLICY_EXTENSION];
}

export function mediaRecipeForPolicy(policy) {
  return policy?.media ? mediaRecipes.get(policy.media.recipe_id) : undefined;
}

export function validateGenerationPolicyManifest(
  pack,
  label = `${pack.id}/pack.json`,
) {
  const policy = generationPolicyForPack(pack);
  if (policy === undefined) return null;
  if (!validateSchema(policy)) fail(label, schemaErrors());
  if (!policy.policy_id.startsWith(`${pack.id}/`)) {
    fail(
      label,
      `generation policy ${policy.policy_id} must be namespaced to ${pack.id}`,
    );
  }
  if (!policy.collision_namespace.startsWith(`pack://${pack.id}/generated/`)) {
    fail(label, "collision_namespace must be owned by the declaring pack");
  }
  const bridge =
    pack.extensions?.["x-cosyworld-composition"]?.role === "bridge";
  if (policy.cross_pack_routes.length > 0 && !bridge) {
    fail(
      label,
      "cross_pack_routes may be declared only by a composition bridge",
    );
  }
  if (!bridge && !policy.generated_descendants) {
    fail(label, "a non-bridge policy must declare generated_descendants");
  }
  if (policy.prose) {
    if (!proseProfiles.has(policy.prose.profile_id)) {
      fail(label, `unknown prose profile ${policy.prose.profile_id}`);
    }
    const actual = new Set(policy.prose.ecology.required_context);
    if (
      actual.size !== ecologyContext.size ||
      [...ecologyContext].some((field) => !actual.has(field))
    ) {
      fail(
        label,
        `${policy.prose.profile_id} must declare its complete ecology context`,
      );
    }
  }
  if (policy.media) validateMediaPolicy(policy.media, label);
  for (const [name, bound] of Object.entries(policy.topology?.budgets ?? {})) {
    if (
      bound.min !== undefined &&
      bound.max !== undefined &&
      bound.min > bound.max
    ) {
      fail(label, `topology budget ${name} has min greater than max`);
    }
  }
  const migrations = new Set();
  for (const migration of policy.migrations) {
    const key = `${migration.from_policy_id}@${migration.from_migration_version}:${migration.from_pack_version}`;
    if (migrations.has(key))
      fail(label, `duplicate generation migration ${key}`);
    migrations.add(key);
  }
  return policy;
}

function validateMediaPolicy(media, label) {
  const profile = mediaProfiles.get(media.profile_id);
  const recipe = mediaRecipes.get(media.recipe_id);
  if (!profile) fail(label, `unknown media profile ${media.profile_id}`);
  if (
    !recipe ||
    !profile.recipes.includes(recipe.id) ||
    recipe.profile !== profile.id
  ) {
    fail(
      label,
      `media recipe ${media.recipe_id} is not allowlisted for ${media.profile_id}`,
    );
  }
  if (recipe.state !== "enabled")
    fail(label, `media recipe ${recipe.id} is ${recipe.state}`);
  const providerDefaults = recipe.provider_defaults ?? {};
  if (
    providerDefaults === null
    || typeof providerDefaults !== "object"
    || Array.isArray(providerDefaults)
  ) {
    fail(label, `media recipe ${recipe.id} provider_defaults must be an object`);
  }
  const controlledInputs = new Set([
    "prompt",
    "aspect_ratio",
    "output_format",
    "mask",
    "seed",
  ]);
  for (const field of Object.keys(providerDefaults)) {
    if (controlledInputs.has(field)) {
      fail(
        label,
        `media recipe ${recipe.id} provider_defaults cannot set controlled input ${field}`,
      );
    }
  }
  const hostOwnedUri = /\b[a-z][a-z0-9+.-]*:\/\/|\bdata:/i;
  for (const value of [
    media.prompt_prefix ?? "",
    ...(media.negative_constraints ?? []),
  ]) {
    if (hostOwnedUri.test(value)) {
      fail(label, "media prompt text cannot contain provider or asset URLs");
    }
  }
  if (media.provider_preference) {
    const preference = media.provider_preference;
    const model = `${recipe.model.owner}/${recipe.model.name}`;
    if (
      preference.provider !== recipe.provider ||
      preference.model !== model ||
      preference.revision !== recipe.model.revision
    ) {
      fail(label, `media preference does not match pinned recipe ${recipe.id}`);
    }
  }
  if (
    media.prompt_version !== undefined &&
    !recipe.prompt_versions.includes(media.prompt_version)
  ) {
    fail(
      label,
      `prompt version ${media.prompt_version} is not allowed by ${recipe.id}`,
    );
  }
  for (const aspect of media.aspect_ratios ?? []) {
    if (!recipe.aspect_ratios.includes(aspect)) {
      fail(label, `aspect ratio ${aspect} is not allowed by ${recipe.id}`);
    }
  }
  for (const format of media.output_formats ?? []) {
    if (!recipe.output_formats.includes(format)) {
      fail(label, `output format ${format} is not allowed by ${recipe.id}`);
    }
  }
  if (!recipe.intents.includes("location_card_art")) {
    fail(label, `media recipe ${recipe.id} cannot generate location cards`);
  }
}

function routeKey(left, right) {
  return [
    `${left.pack_id}:${left.location_id}`,
    `${right.pack_id}:${right.location_id}`,
  ]
    .sort()
    .join("|");
}

function analyzeGraph(locationIds, exits, roots, ingress, egress) {
  const adjacency = new Map([...locationIds].map((id) => [id, new Map()]));
  for (const exit of exits) {
    const left = Math.min(exit.from_location_id, exit.to_location_id);
    const right = Math.max(exit.from_location_id, exit.to_location_id);
    const weight = Number(exit.distance ?? 1);
    const current = adjacency.get(left)?.get(right);
    if (
      adjacency.has(left) &&
      adjacency.has(right) &&
      (current === undefined || weight < current)
    ) {
      adjacency.get(left).set(right, weight);
      adjacency.get(right).set(left, weight);
    }
  }
  const seen = new Set();
  let components = 0;
  for (const locationId of locationIds) {
    if (seen.has(locationId)) continue;
    components += 1;
    const pending = [locationId];
    seen.add(locationId);
    while (pending.length > 0) {
      for (const next of adjacency.get(pending.pop()).keys()) {
        if (!seen.has(next)) {
          seen.add(next);
          pending.push(next);
        }
      }
    }
  }
  const edges =
    [...adjacency.values()].reduce(
      (sum, neighbors) => sum + neighbors.size,
      0,
    ) / 2;
  const discovery = new Map();
  const low = new Map();
  const articulation = new Set();
  let time = 0;
  let bridges = 0;
  function visit(locationId, parent) {
    discovery.set(locationId, ++time);
    low.set(locationId, time);
    let children = 0;
    for (const next of adjacency.get(locationId).keys()) {
      if (next === parent) continue;
      if (!discovery.has(next)) {
        children += 1;
        visit(next, locationId);
        low.set(locationId, Math.min(low.get(locationId), low.get(next)));
        if (low.get(next) > discovery.get(locationId)) bridges += 1;
        if (parent !== null && low.get(next) >= discovery.get(locationId)) {
          articulation.add(locationId);
        }
      } else {
        low.set(locationId, Math.min(low.get(locationId), discovery.get(next)));
      }
    }
    if (parent === null && children > 1) articulation.add(locationId);
  }
  for (const locationId of locationIds) {
    if (!discovery.has(locationId)) visit(locationId, null);
  }
  let articulationImpact = 0;
  for (const removed of articulation) {
    const remaining = [...locationIds].filter((id) => id !== removed);
    const visited = new Set();
    const sizes = [];
    for (const locationId of remaining) {
      if (visited.has(locationId)) continue;
      let size = 0;
      const pending = [locationId];
      visited.add(locationId);
      while (pending.length > 0) {
        size += 1;
        for (const next of adjacency.get(pending.pop()).keys()) {
          if (next !== removed && !visited.has(next)) {
            visited.add(next);
            pending.push(next);
          }
        }
      }
      sizes.push(size);
    }
    articulationImpact = Math.max(
      articulationImpact,
      remaining.length - Math.max(0, ...sizes),
    );
  }
  let weightedDistance = 0;
  for (const source of locationIds) {
    const distances = new Map([...locationIds].map((id) => [id, Infinity]));
    distances.set(source, 0);
    const pending = [[0, source]];
    while (pending.length > 0) {
      pending.sort((left, right) => left[0] - right[0]);
      const [distance, locationId] = pending.shift();
      if (distance !== distances.get(locationId)) continue;
      for (const [next, weight] of adjacency.get(locationId)) {
        if (distance + weight < distances.get(next)) {
          distances.set(next, distance + weight);
          pending.push([distance + weight, next]);
        }
      }
    }
    for (const distance of distances.values()) {
      if (Number.isFinite(distance))
        weightedDistance = Math.max(weightedDistance, distance);
    }
  }
  return {
    components,
    roots,
    ingress,
    egress,
    weighted_distance: weightedDistance,
    degree: Math.max(
      0,
      ...[...adjacency.values()].map((neighbors) => neighbors.size),
    ),
    cycle_rank: edges - locationIds.size + components,
    bridges,
    articulation_impact: articulationImpact,
    terminal_spurs: [...adjacency.values()].filter(
      (neighbors) => neighbors.size === 1,
    ).length,
  };
}

function validateBound(packId, metric, value, bound) {
  if (bound.min !== undefined && value < bound.min) {
    fail(
      packId,
      `topology ${metric} ${value} is below reviewed minimum ${bound.min}`,
    );
  }
  if (bound.max !== undefined && value > bound.max) {
    fail(
      packId,
      `topology ${metric} ${value} exceeds reviewed maximum ${bound.max}`,
    );
  }
}

export function validateCompiledGenerationPolicies(
  packs,
  resources,
  packLifecycle,
  label = "compiled worldpack",
) {
  const locationPack = new Map(
    resources.locations.map((location) => [
      Number(location.id),
      location.pack_id,
    ]),
  );
  const crossRoutes = new Map();
  const ingress = new Map(packs.map((pack) => [pack.id, new Set()]));
  const egress = new Map(packs.map((pack) => [pack.id, new Set()]));
  for (const exit of [...resources.exits, ...(resources.hidden_exits ?? [])]) {
    const fromPack = locationPack.get(Number(exit.from_location_id));
    const toPack = locationPack.get(Number(exit.to_location_id));
    if (!fromPack || !toPack || fromPack === toPack) continue;
    const endpoints = [
      { pack_id: fromPack, location_id: Number(exit.from_location_id) },
      { pack_id: toPack, location_id: Number(exit.to_location_id) },
    ];
    const key = routeKey(...endpoints);
    const route = crossRoutes.get(key) ?? {
      key,
      endpoints,
      owners: new Set(),
    };
    route.owners.add(exit.pack_id);
    crossRoutes.set(key, route);
    egress.get(fromPack)?.add(key);
    ingress.get(toPack)?.add(key);
  }
  const declarations = new Map();
  for (const pack of packs) {
    const policy = generationPolicyForPack(pack);
    if (policy)
      validateGenerationPolicyManifest(pack, `${label} pack ${pack.id}`);
    for (const route of policy?.cross_pack_routes ?? []) {
      const key = routeKey(...route.endpoints);
      if (declarations.has(key))
        fail(label, `duplicate cross-pack declaration ${key}`);
      if (
        route.route_owner !== pack.id ||
        route.generated_descendant_owner !== pack.id ||
        route.topology_authority.pack_id !== pack.id ||
        route.topology_authority.migration_version !== policy.migration_version
      ) {
        fail(
          label,
          `cross-pack route ${key} must be owned and migrated by bridge ${pack.id}`,
        );
      }
      if (!mediaProfiles.has(route.media_profile_id)) {
        fail(
          label,
          `cross-pack route ${key} has unknown media profile ${route.media_profile_id}`,
        );
      }
      const dependencies = manifestDependencies(pack);
      for (const endpoint of route.endpoints) {
        if (
          locationPack.get(endpoint.location_id) !== endpoint.pack_id ||
          !dependencies.has(endpoint.pack_id)
        ) {
          fail(label, `cross-pack route ${key} has an invalid endpoint`);
        }
      }
      declarations.set(key, { pack, route });
    }
  }
  for (const route of crossRoutes.values()) {
    const owner = packs.find((pack) => route.owners.has(pack.id));
    const ownerPolicy = owner && generationPolicyForPack(owner);
    if (!ownerPolicy) continue;
    const declaration = declarations.get(route.key);
    if (!declaration)
      fail(label, `cross-pack route ${route.key} has no bridge declaration`);
    if (
      route.owners.size !== 1 ||
      !route.owners.has(declaration.pack.id) ||
      routeKey(...route.endpoints) !== routeKey(...declaration.route.endpoints)
    ) {
      fail(
        label,
        `cross-pack route ${route.key} declaration does not match its bridge owner`,
      );
    }
  }
  for (const key of declarations.keys()) {
    if (!crossRoutes.has(key))
      fail(label, `cross-pack declaration ${key} has no authored route`);
  }

  const evacuationPacks = new Set(
    (packLifecycle?.unmount ?? []).map((policy) => policy.pack_id),
  );
  const reports = new Map();
  for (const pack of packs) {
    const topology = generationPolicyForPack(pack)?.topology;
    if (!topology) continue;
    const locationIds = new Set(
      resources.locations
        .filter((location) => location.pack_id === pack.id)
        .map((location) => Number(location.id)),
    );
    const internalExits = [
      ...resources.exits,
      ...(resources.hidden_exits ?? []),
    ].filter(
      (exit) =>
        locationIds.has(Number(exit.from_location_id)) &&
        locationIds.has(Number(exit.to_location_id)),
    );
    const roots = (pack.entry_points ?? []).filter(
      (entry) =>
        entry.kind === "location" &&
        locationIds.has(
          Number(String(entry.id).match(/location\/(\d+)$/)?.[1] ?? 0),
        ),
    ).length;
    const report = analyzeGraph(
      locationIds,
      internalExits,
      roots,
      ingress.get(pack.id)?.size ?? 0,
      egress.get(pack.id)?.size ?? 0,
    );
    for (const [metric, bound] of Object.entries(topology.budgets)) {
      validateBound(pack.id, metric, report[metric], bound);
    }
    if (
      topology.evacuation === "world_lifecycle_required" &&
      !evacuationPacks.has(pack.id)
    ) {
      fail(pack.id, "topology requires a world lifecycle evacuation policy");
    }
    reports.set(pack.id, report);
  }
  return reports;
}

export function worldpackMediaRegistry() {
  return structuredClone(mediaRegistry);
}
