export const ENVIRONMENT_PROFILE_VERSION = 1;

const climates = new Set([
  "temperate",
  "cool_temperate",
  "alpine",
  "tropical",
  "arid",
  "subterranean",
  "marine",
  "supernatural",
]);
const landforms = new Set([
  "garden",
  "riverbank",
  "woodland",
  "trail",
  "meadow",
  "upland",
  "mountain",
  "cave",
  "wetland",
  "coast",
  "ruins",
  "interior",
]);
const geologyTags = new Set([
  "alluvial",
  "clay_bearing",
  "sedimentary",
  "igneous",
  "metamorphic",
  "peat",
  "constructed",
]);
const hydrologyTags = new Set([
  "flowing_river",
  "seasonal_stream",
  "still_water",
  "spring",
  "wet_ground",
  "dry",
  "tidal",
]);
const anomalyTags = new Set([
  "moon_touched",
  "ancient",
  "geothermal",
  "arcane",
]);
const richnessValues = new Set(["modest", "rich", "exceptional"]);
const characterValues = new Set(["renewable", "finite", "seasonal", "enduring"]);
const policies = new Set(["guaranteed", "impossible", "weighted"]);
const approvedBuildings = new Map([
  ["fish_rich_water", new Set(["fishery", "smokehouse", "boathouse"])],
  ["ore_seam", new Set(["shallow_mine", "prospectors_lodge"])],
  ["clay_bank", new Set(["kiln", "pottery"])],
  ["ancient_woodland", new Set(["carpenters_lodge", "herbalist"])],
  ["fast_river", new Set(["watermill", "riverside_workshop"])],
  ["reliable_upland_wind", new Set(["windmill", "signal_tower"])],
  ["hot_spring", new Set(["bathhouse", "healing_house"])],
  ["rich_soil", new Set(["orchard", "market_garden"])],
  ["rare_herb_habitat", new Set(["apothecary", "conservatory"])],
  ["old_ruins", new Set(["archive", "museum", "expedition_lodge"])],
]);

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function unexpectedFields(value, allowed, label, errors) {
  if (!isObject(value)) return;
  for (const field of Object.keys(value)) {
    if (!allowed.has(field)) errors.push(`${label} contains unknown field ${field}`);
  }
}

function validateVocabularyList(value, vocabulary, label, errors) {
  if (
    !Array.isArray(value)
    || value.some((entry) => typeof entry !== "string" || !vocabulary.has(entry))
    || new Set(value).size !== value.length
  ) {
    errors.push(`${label} must contain unique known tags`);
  }
}

export function naturalAffordanceValidationErrors(location, label = "location") {
  const errors = [];
  const hasEnvironment = location?.environment !== undefined;
  const hasPotentials = location?.natural_potentials !== undefined;
  if (!hasEnvironment && !hasPotentials) return errors;
  if (!hasEnvironment) {
    errors.push(`${label} natural_potentials require an environment profile`);
    return errors;
  }

  const environment = location.environment;
  if (!isObject(environment)) {
    errors.push(`${label} environment must be an object`);
    return errors;
  }
  unexpectedFields(
    environment,
    new Set(["version", "climate", "landforms", "geology", "hydrology", "anomalies"]),
    `${label} environment`,
    errors,
  );
  if (environment.version !== ENVIRONMENT_PROFILE_VERSION) {
    errors.push(`${label} environment version must be ${ENVIRONMENT_PROFILE_VERSION}`);
  }
  if (!climates.has(environment.climate)) {
    errors.push(`${label} environment climate is unknown`);
  }
  validateVocabularyList(
    environment.landforms ?? [],
    landforms,
    `${label} environment landforms`,
    errors,
  );
  validateVocabularyList(
    environment.geology ?? [],
    geologyTags,
    `${label} environment geology`,
    errors,
  );
  validateVocabularyList(
    environment.hydrology ?? [],
    hydrologyTags,
    `${label} environment hydrology`,
    errors,
  );
  validateVocabularyList(
    environment.anomalies ?? [],
    anomalyTags,
    `${label} environment anomalies`,
    errors,
  );

  const potentials = location.natural_potentials ?? [];
  if (!Array.isArray(potentials)) {
    errors.push(`${label} natural_potentials must be an array`);
    return errors;
  }
  const seenPolicies = new Map();
  let guaranteedCount = 0;
  for (const [index, potential] of potentials.entries()) {
    const potentialLabel = `${label} natural_potentials[${index}]`;
    if (!isObject(potential)) {
      errors.push(`${potentialLabel} must be an object`);
      continue;
    }
    unexpectedFields(
      potential,
      new Set([
        "resource_kind",
        "policy",
        "weight",
        "richness",
        "character",
        "building_archetypes",
        "presentation_key",
      ]),
      potentialLabel,
      errors,
    );
    const buildings = approvedBuildings.get(potential.resource_kind);
    if (!buildings) errors.push(`${potentialLabel} resource_kind is unknown`);
    if (!policies.has(potential.policy)) errors.push(`${potentialLabel} policy is unknown`);
    if (potential.policy === "guaranteed") guaranteedCount += 1;

    const existingPolicies = seenPolicies.get(potential.resource_kind) ?? new Set();
    if (
      existingPolicies.has(potential.policy)
      || (potential.policy === "impossible" && existingPolicies.size > 0)
      || (potential.policy !== "impossible" && existingPolicies.has("impossible"))
    ) {
      errors.push(
        `${potentialLabel} contradicts or duplicates another rule for ${potential.resource_kind}`,
      );
    }
    existingPolicies.add(potential.policy);
    seenPolicies.set(potential.resource_kind, existingPolicies);

    if (potential.policy === "impossible") {
      if (
        (potential.weight ?? 0) !== 0
        || (potential.building_archetypes ?? []).length > 0
        || (potential.presentation_key ?? "") !== ""
      ) {
        errors.push(`${potentialLabel} impossible rules cannot declare outcomes`);
      }
      continue;
    }
    if (
      potential.policy === "weighted"
      && (!Number.isInteger(potential.weight) || potential.weight < 1 || potential.weight > 1000)
    ) {
      errors.push(`${potentialLabel} weighted policy requires weight 1..1000`);
    }
    if (potential.policy === "guaranteed" && (potential.weight ?? 0) !== 0) {
      errors.push(`${potentialLabel} guaranteed policy cannot declare weight`);
    }
    if (!richnessValues.has(potential.richness)) {
      errors.push(`${potentialLabel} richness is unknown`);
    }
    if (!characterValues.has(potential.character)) {
      errors.push(`${potentialLabel} character is unknown`);
    }
    if (
      !Array.isArray(potential.building_archetypes)
      || potential.building_archetypes.length === 0
      || potential.building_archetypes.some(
        (building) => typeof building !== "string" || !buildings?.has(building),
      )
      || new Set(potential.building_archetypes).size !== potential.building_archetypes.length
    ) {
      errors.push(
        `${potentialLabel} building_archetypes must be unique approved references`,
      );
    }
    if (
      typeof potential.presentation_key !== "string"
      || !/^natural\.[a-z0-9_]+\.[a-z0-9_.-]+$/.test(potential.presentation_key)
    ) {
      errors.push(`${potentialLabel} presentation_key is invalid`);
    }
  }
  if (guaranteedCount > 1) {
    errors.push(`${label} natural_potentials v1 permits at most one guaranteed result`);
  }
  return errors;
}

export function assertNaturalAffordanceConfig(location, label = "location") {
  const errors = naturalAffordanceValidationErrors(location, label);
  if (errors.length > 0) throw new Error(errors.join("\n"));
  return location;
}
