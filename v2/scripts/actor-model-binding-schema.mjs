const MODEL_ID = /^[A-Za-z0-9/._:@+~-]{1,256}$/;
const SNAPSHOT_VERSION = /^openrouter-\d{4}-\d{2}-\d{2}\.\d+$/;
const MODALITY = /^[a-z][a-z0-9_-]{0,31}$/;

function rowLabel(packId, row) {
  return `pack ${packId} actor model binding ${String(row?.id ?? "unknown")}`;
}

export function actorModelBindingValidationErrors(manifest, actors, bindings) {
  const config = manifest.extensions?.["x-cosyworld-ai-cast"];
  if (config === undefined && bindings.length === 0) return [];
  const errors = [];
  const label = `pack ${manifest.id} x-cosyworld-ai-cast`;
  if (!config || typeof config !== "object" || Array.isArray(config)) {
    return [`${label} must be an object`];
  }
  const allowedConfigFields = new Set([
    "schema_version",
    "provider",
    "catalog_snapshot_version",
    "speech_mode",
    "binding_policy",
    "complete_actor_binding",
    "runtime_refresh",
  ]);
  for (const field of Object.keys(config)) {
    if (!allowedConfigFields.has(field)) errors.push(`${label} has unknown field ${field}`);
  }
  if (config.schema_version !== 1) errors.push(`${label} schema_version must be 1`);
  if (config.provider !== "openrouter") errors.push(`${label} provider must be openrouter`);
  if (!SNAPSHOT_VERSION.test(config.catalog_snapshot_version ?? "")) {
    errors.push(`${label} has an invalid catalog_snapshot_version`);
  }
  if (config.speech_mode !== "raw") errors.push(`${label} speech_mode must be raw`);
  const legacyComplete = config.complete_actor_binding;
  const bindingPolicy = config.binding_policy
    ?? (legacyComplete === true ? "complete" : undefined);
  if (!new Set(["complete", "explicit"]).has(bindingPolicy)) {
    errors.push(`${label} binding_policy must be complete or explicit`);
  }
  if (legacyComplete !== undefined && legacyComplete !== true) {
    errors.push(`${label} legacy complete_actor_binding must be true when present`);
  }
  if (legacyComplete === true && bindingPolicy !== "complete") {
    errors.push(`${label} complete_actor_binding conflicts with binding_policy`);
  }
  if (config.runtime_refresh !== false) errors.push(`${label} runtime_refresh must be false`);

  const packActors = actors.filter((actor) => actor.pack_id === manifest.id);
  const actorIds = new Set(packActors.map((actor) => actor.id));
  const boundActors = new Set();
  const bindingIds = new Set();
  const allowedFields = new Set([
    "pack_id",
    "id",
    "actor_id",
    "actor_ref",
    "provider",
    "requested_model_id",
    "canonical_slug",
    "display_name",
    "catalog_snapshot_version",
    "created",
    "input_modalities",
    "output_modalities",
    "context_length",
    "max_completion_tokens",
    "supported_parameters",
    "input_cost_per_million",
    "output_cost_per_million",
    "zero_data_retention",
    "speech_mode",
  ]);
  for (const row of bindings) {
    const owner = rowLabel(manifest.id, row);
    for (const field of Object.keys(row ?? {})) {
      if (!allowedFields.has(field)) errors.push(`${owner} has unknown field ${field}`);
    }
    if (row.pack_id !== manifest.id) errors.push(`${owner} has the wrong pack_id`);
    if (!MODEL_ID.test(row.id ?? "")) {
      errors.push(`${owner} has an invalid binding id`);
    } else if (bindingIds.has(row.id)) {
      errors.push(`${owner} repeats binding ${row.id}`);
    } else {
      bindingIds.add(row.id);
    }
    if (!MODEL_ID.test(row.requested_model_id ?? "")) {
      errors.push(`${owner} has an invalid requested model id`);
    }
    if (!Number.isSafeInteger(row.actor_id) || row.actor_id <= 0 || !actorIds.has(row.actor_id)) {
      errors.push(`${owner} references an unknown actor`);
    } else if (boundActors.has(row.actor_id)) {
      errors.push(`${owner} repeats actor ${row.actor_id}`);
    } else {
      boundActors.add(row.actor_id);
    }
    if (row.actor_ref !== `pack://${manifest.id}/actor/${row.actor_id}`) {
      errors.push(`${owner} has a non-canonical actor_ref`);
    }
    if (row.provider !== config.provider) errors.push(`${owner} has the wrong provider`);
    if (!MODEL_ID.test(row.canonical_slug ?? "")) errors.push(`${owner} has an invalid canonical_slug`);
    if (typeof row.display_name !== "string" || !row.display_name.trim() || row.display_name.length > 256) {
      errors.push(`${owner} has an invalid display_name`);
    }
    if (row.catalog_snapshot_version !== config.catalog_snapshot_version) {
      errors.push(`${owner} has the wrong catalog snapshot`);
    }
    if (!Number.isSafeInteger(row.created) || row.created < 0) {
      errors.push(`${owner} has an invalid created timestamp`);
    }
    for (const field of ["input_modalities", "output_modalities", "supported_parameters"]) {
      const values = row[field];
      if (
        !Array.isArray(values)
        || (field !== "supported_parameters" && values.length === 0)
        || new Set(values).size !== values.length
        || values.some((value) => typeof value !== "string" || !MODALITY.test(value))
      ) {
        errors.push(`${owner} has invalid ${field}`);
      }
    }
    for (const field of ["context_length", "max_completion_tokens"]) {
      if (row[field] !== null && (!Number.isInteger(row[field]) || row[field] <= 0)) {
        errors.push(`${owner} has invalid ${field}`);
      }
    }
    for (const field of ["input_cost_per_million", "output_cost_per_million"]) {
      if (row[field] !== null && (typeof row[field] !== "number" || !Number.isFinite(row[field]) || row[field] < 0)) {
        errors.push(`${owner} has invalid ${field}`);
      }
    }
    if (typeof row.zero_data_retention !== "boolean") {
      errors.push(`${owner} zero_data_retention must be boolean`);
    }
    const textChat = row.input_modalities?.includes("text") && row.output_modalities?.includes("text");
    if (row.speech_mode !== (textChat ? "raw" : "unavailable")) {
      errors.push(`${owner} speech_mode does not match its modalities`);
    }
    const actor = packActors.find((candidate) => candidate.id === row.actor_id);
    if (actor && actor.speech_mode !== row.speech_mode) {
      errors.push(`${owner} speech_mode does not match actor ${row.actor_id}`);
    }
  }
  if (bindingPolicy === "complete" && boundActors.size !== packActors.length) {
    errors.push(`${label} binds ${boundActors.size} of ${packActors.length} actors`);
  }
  if (bindingPolicy === "explicit" && bindings.length === 0) {
    errors.push(`${label} explicit binding policy must declare at least one binding`);
  }
  return errors;
}

const VOICE_POOL_TIERS = new Set(["common", "uncommon", "rare", "legendary"]);

// `x-cosyworld-voice-pool` lets a pack opt its unbound actors into a stable,
// hash-drawn model from the operator's reviewed voice pool. The pack shapes the
// draw only; it never names a model.
export function voicePoolValidationErrors(manifest) {
  const config = manifest.extensions?.["x-cosyworld-voice-pool"];
  if (config === undefined) return [];
  const label = `pack ${manifest.id} x-cosyworld-voice-pool`;
  if (!config || typeof config !== "object" || Array.isArray(config)) {
    return [`${label} must be an object`];
  }
  const errors = [];
  const allowed = new Set(["schema_version", "strategy", "salt", "tier_weights", "temperature"]);
  for (const field of Object.keys(config)) {
    if (!allowed.has(field)) errors.push(`${label} has unknown field ${field}`);
  }
  if (config.schema_version !== 1) errors.push(`${label} schema_version must be 1`);
  if (config.strategy !== "keyed") errors.push(`${label} strategy must be keyed`);
  if (typeof config.salt !== "string" || !/^[^\0]{1,64}$/.test(config.salt.trim())) {
    errors.push(`${label} salt must be 1-64 characters`);
  }
  if (config.tier_weights !== undefined) {
    const weights = config.tier_weights;
    if (!weights || typeof weights !== "object" || Array.isArray(weights)) {
      errors.push(`${label} tier_weights must be an object`);
    } else {
      for (const [tier, weight] of Object.entries(weights)) {
        if (!VOICE_POOL_TIERS.has(tier)) errors.push(`${label} has unknown tier ${tier}`);
        if (!Number.isInteger(weight) || weight < 0 || weight > 1000) {
          errors.push(`${label} tier ${tier} weight must be an integer from 0 to 1000`);
        }
      }
    }
  }
  if (
    config.temperature !== undefined
    && !(Number.isFinite(config.temperature) && config.temperature >= 0 && config.temperature <= 2)
  ) {
    errors.push(`${label} temperature must be between 0 and 2`);
  }
  return errors;
}

// `x-cosyworld-free-context` opts a pack's residents into a prompt that carries
// only a first-person summoning and plain-prose world context. Length, safety,
// and repetition stay with the deterministic publication gate.
export function freeContextValidationErrors(manifest) {
  const config = manifest.extensions?.["x-cosyworld-free-context"];
  if (config === undefined) return [];
  const label = `pack ${manifest.id} x-cosyworld-free-context`;
  if (!config || typeof config !== "object" || Array.isArray(config)) {
    return [`${label} must be an object`];
  }
  const errors = [];
  for (const field of Object.keys(config)) {
    if (field !== "schema_version" && field !== "mode" && field !== "traveler_personas") {
      errors.push(`${label} has unknown field ${field}`);
    }
  }
  if (config.schema_version !== 1) errors.push(`${label} schema_version must be 1`);
  if (config.mode !== "free_context") errors.push(`${label} mode must be free_context`);
  if (config.traveler_personas !== undefined) {
    const list = config.traveler_personas;
    if (!Array.isArray(list) || list.length > 16) {
      errors.push(`${label} traveler_personas must be an array of at most 16 lines`);
    } else {
      for (const line of list) {
        if (typeof line !== "string" || !line.trim() || [...line.trim()].length > 200) {
          errors.push(`${label} each traveler persona must be 1-200 characters`);
        }
      }
    }
  }
  return errors;
}

// `x-cosyworld-decisions` opts a world into decision-model judgments (the chat
// floor and the repeat judge). The operator names the model in the environment;
// the pack only chooses which judgments to use.
export function decisionsValidationErrors(manifest) {
  const config = manifest.extensions?.["x-cosyworld-decisions"];
  if (config === undefined) return [];
  const label = `pack ${manifest.id} x-cosyworld-decisions`;
  if (!config || typeof config !== "object" || Array.isArray(config)) {
    return [`${label} must be an object`];
  }
  const errors = [];
  const allowed = new Set(["schema_version", "chat_floor", "repeat_judge", "repeat_threshold"]);
  for (const field of Object.keys(config)) {
    if (!allowed.has(field)) errors.push(`${label} has unknown field ${field}`);
  }
  if (config.schema_version !== 1) errors.push(`${label} schema_version must be 1`);
  for (const flag of ["chat_floor", "repeat_judge"]) {
    if (config[flag] !== undefined && typeof config[flag] !== "boolean") {
      errors.push(`${label} ${flag} must be a boolean`);
    }
  }
  if (
    config.repeat_threshold !== undefined
    && !(Number.isFinite(config.repeat_threshold)
      && config.repeat_threshold >= 0.5
      && config.repeat_threshold <= 0.99)
  ) {
    errors.push(`${label} repeat_threshold must be between 0.5 and 0.99`);
  }
  return errors;
}
