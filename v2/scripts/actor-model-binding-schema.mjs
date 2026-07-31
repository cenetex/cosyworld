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
  if (config.complete_actor_binding !== true) {
    errors.push(`${label} complete_actor_binding must be true`);
  }
  if (config.runtime_refresh !== false) errors.push(`${label} runtime_refresh must be false`);

  const packActors = actors.filter((actor) => actor.pack_id === manifest.id);
  const actorIds = new Set(packActors.map((actor) => actor.id));
  const boundActors = new Set();
  const modelIds = new Set();
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
    if (!MODEL_ID.test(row.id ?? "") || row.requested_model_id !== row.id) {
      errors.push(`${owner} has an invalid or mismatched requested model id`);
    } else if (modelIds.has(row.id)) {
      errors.push(`${owner} repeats model ${row.id}`);
    } else {
      modelIds.add(row.id);
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
  if (config.complete_actor_binding && boundActors.size !== packActors.length) {
    errors.push(`${label} binds ${boundActors.size} of ${packActors.length} actors`);
  }
  return errors;
}
