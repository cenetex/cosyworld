const EXTENSION = "x-cosyworld-discovery-slots";
const SCHEMA_VERSION = 1;
const RECEIPT_VERSION = "discovery-receipt-v1";
const ROLL_ALGORITHM = "weighted-fnv1a-v1";

const targetKinds = new Set([
  "item",
  "feature",
  "actor",
  "route",
  "location",
  "resource",
  "lore",
]);
const scopes = new Set(["actor", "expedition", "world"]);
const phases = new Set(["latent", "signed"]);
const senses = new Set(["sight", "sound", "smell", "touch", "taste", "other"]);
const revealMethods = new Set(["notice", "search", "study", "scout"]);
const eligibleInputs = new Set([
  "world_seed",
  "worldpack_bundle_hash",
  "slot_id",
  "slot_version",
  "origin_id",
  "region_id",
  "rules_profile",
  "claim_scope_id",
]);
const eventEffects = new Set([
  "advance_pressure",
  "alter_lead",
  "change_position",
  "consume_resource",
  "change_hazard",
  "change_method",
]);
const canonicalIdPattern = /^[a-z][a-z0-9.-]*:[a-z][a-z0-9-]*\/[a-z0-9._/-]+$/;
const rowIdPattern = /^[a-z][a-z0-9_]{1,63}$/;

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function nonEmpty(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function rejectUnknown(errors, value, allowed, label) {
  if (!isObject(value)) return;
  for (const field of Object.keys(value)) {
    if (!allowed.has(field)) errors.push(`${label} has unknown field ${field}`);
  }
}

function validCanonicalId(value, packId) {
  return canonicalIdPattern.test(value ?? "") && value.startsWith(`${packId}:`);
}

function uniqueStrings(value, allowed, minimum = 0, maximum = 64) {
  return Array.isArray(value)
    && value.length >= minimum
    && value.length <= maximum
    && value.every((entry) => nonEmpty(entry) && (!allowed || allowed.has(entry)))
    && new Set(value).size === value.length;
}

function validateEligibleInputs(errors, value, label) {
  if (!uniqueStrings(value, eligibleInputs, 1, 16)) {
    errors.push(`${label} eligible_inputs must be a bounded unique server-fact list`);
    return;
  }
  if (!value.includes("slot_id") || !value.includes("slot_version")) {
    errors.push(`${label} eligible_inputs must include slot_id and slot_version`);
  }
}

function validateStockingTables(errors, config, packId) {
  if (
    !Array.isArray(config.stocking_tables)
    || config.stocking_tables.length < 1
    || config.stocking_tables.length > 64
  ) {
    errors.push("discovery authority stocking_tables must contain 1-64 entries");
    return new Map();
  }
  const tables = new Map();
  const resultOccurrences = new Map();
  for (const table of config.stocking_tables) {
    const label = `discovery stocking table ${String(table?.id ?? "unknown")}`;
    if (!isObject(table)) {
      errors.push(`${label} must be an object`);
      continue;
    }
    rejectUnknown(
      errors,
      table,
      new Set([
        "id",
        "version",
        "target_kind",
        "eligible_inputs",
        "rows",
        "fallback_row_id",
      ]),
      label,
    );
    if (
      !validCanonicalId(table.id, packId)
      || !table.id.includes(":discovery-table/")
      || tables.has(table.id)
    ) {
      errors.push(`${label} id must be a unique pack-owned discovery-table id`);
    }
    if (!Number.isInteger(table.version) || table.version < 1 || table.version > 255) {
      errors.push(`${label} version must be an integer from 1-255`);
    }
    if (!targetKinds.has(table.target_kind)) errors.push(`${label} target_kind is invalid`);
    validateEligibleInputs(errors, table.eligible_inputs, label);
    if (!Array.isArray(table.rows) || table.rows.length < 1 || table.rows.length > 64) {
      errors.push(`${label} rows must contain 1-64 bounded entries`);
      continue;
    }
    const rows = new Map();
    for (const row of table.rows) {
      const rowLabel = `${label} row ${String(row?.id ?? "unknown")}`;
      if (!isObject(row)) {
        errors.push(`${rowLabel} must be an object`);
        continue;
      }
      rejectUnknown(
        errors,
        row,
        new Set(["id", "weight", "result_ids", "unique", "topology_entity_ids"]),
        rowLabel,
      );
      if (!rowIdPattern.test(row.id ?? "") || rows.has(row.id)) {
        errors.push(`${rowLabel} id must be unique stable snake_case`);
      }
      if (!Number.isInteger(row.weight) || row.weight < 1 || row.weight > 10000) {
        errors.push(`${rowLabel} weight must be an integer from 1-10000`);
      }
      if (!uniqueStrings(row.result_ids, null, 1, 8)) {
        errors.push(`${rowLabel} result_ids must contain 1-8 unique canonical ids`);
      } else if (!row.result_ids.every((id) => validCanonicalId(id, packId))) {
        errors.push(`${rowLabel} result_ids must be pack-owned canonical ids`);
      }
      if (row.unique !== undefined && typeof row.unique !== "boolean") {
        errors.push(`${rowLabel} unique must be boolean`);
      }
      if (row.topology_entity_ids !== undefined) {
        if (
          !["route", "location"].includes(table.target_kind)
          || !uniqueStrings(row.topology_entity_ids, null, 1, 8)
          || !row.topology_entity_ids.every((id) => row.result_ids?.includes(id))
        ) {
          errors.push(
            `${rowLabel} topology_entity_ids require route/location results and must be a result subset`,
          );
        }
      }
      for (const resultId of row.result_ids ?? []) {
        const occurrences = resultOccurrences.get(resultId) ?? [];
        occurrences.push({ unique: row.unique === true, label: rowLabel });
        resultOccurrences.set(resultId, occurrences);
      }
      rows.set(row.id, row);
    }
    if (!rows.has(table.fallback_row_id)) {
      errors.push(`${label} fallback_row_id must reference a row in the table`);
    } else if (rows.get(table.fallback_row_id).unique === true) {
      errors.push(`${label} fallback row cannot be unique`);
    }
    tables.set(table.id, { ...table, rowsById: rows });
  }
  for (const [resultId, occurrences] of resultOccurrences) {
    if (occurrences.length > 1 && occurrences.some((entry) => entry.unique)) {
      errors.push(`discovery unique result ${resultId} appears in more than one stocking row`);
    }
  }
  return tables;
}

function validateEventTables(errors, config, packId) {
  if (!Array.isArray(config.event_tables) || config.event_tables.length > 32) {
    errors.push("discovery authority event_tables must be a bounded array");
    return new Map();
  }
  const tables = new Map();
  for (const table of config.event_tables) {
    const label = `discovery event table ${String(table?.id ?? "unknown")}`;
    if (!isObject(table)) {
      errors.push(`${label} must be an object`);
      continue;
    }
    rejectUnknown(
      errors,
      table,
      new Set(["id", "version", "eligible_inputs", "rows"]),
      label,
    );
    if (
      !validCanonicalId(table.id, packId)
      || !table.id.includes(":event-table/")
      || tables.has(table.id)
    ) {
      errors.push(`${label} id must be a unique pack-owned event-table id`);
    }
    tables.set(table.id, table);
    if (!Number.isInteger(table.version) || table.version < 1 || table.version > 255) {
      errors.push(`${label} version must be an integer from 1-255`);
    }
    validateEligibleInputs(errors, table.eligible_inputs, label);
    if (!Array.isArray(table.rows) || table.rows.length < 1 || table.rows.length > 64) {
      errors.push(`${label} rows must contain 1-64 bounded entries`);
      continue;
    }
    const rowIds = new Set();
    for (const row of table.rows) {
      const rowLabel = `${label} row ${String(row?.id ?? "unknown")}`;
      if (!isObject(row)) {
        errors.push(`${rowLabel} must be an object`);
        continue;
      }
      rejectUnknown(
        errors,
        row,
        new Set(["id", "weight", "effect_kind", "target_id", "amount"]),
        rowLabel,
      );
      if (!rowIdPattern.test(row.id ?? "") || rowIds.has(row.id)) {
        errors.push(`${rowLabel} id must be unique stable snake_case`);
      }
      rowIds.add(row.id);
      if (!Number.isInteger(row.weight) || row.weight < 1 || row.weight > 10000) {
        errors.push(`${rowLabel} weight must be an integer from 1-10000`);
      }
      if (!eventEffects.has(row.effect_kind)) {
        errors.push(
          `${rowLabel} effect_kind cannot create topology, unique loot, or rewards`,
        );
      }
      if (!validCanonicalId(row.target_id, packId)) {
        errors.push(`${rowLabel} target_id must be a pack-owned canonical id`);
      }
      if (!Number.isInteger(row.amount) || row.amount < 1 || row.amount > 255) {
        errors.push(`${rowLabel} amount must be an integer from 1-255`);
      }
    }
  }
  return tables;
}

function validatePresentationTables(errors, config, packId) {
  if (!Array.isArray(config.presentation_tables) || config.presentation_tables.length > 32) {
    errors.push("discovery authority presentation_tables must be a bounded array");
    return new Map();
  }
  const tables = new Map();
  for (const table of config.presentation_tables) {
    const label = `discovery presentation table ${String(table?.id ?? "unknown")}`;
    if (!isObject(table)) {
      errors.push(`${label} must be an object`);
      continue;
    }
    rejectUnknown(errors, table, new Set(["id", "version", "rows"]), label);
    if (
      !validCanonicalId(table.id, packId)
      || !table.id.includes(":presentation-table/")
      || tables.has(table.id)
    ) {
      errors.push(`${label} id must be a unique pack-owned presentation-table id`);
    }
    tables.set(table.id, table);
    if (!Number.isInteger(table.version) || table.version < 1 || table.version > 255) {
      errors.push(`${label} version must be an integer from 1-255`);
    }
    if (!Array.isArray(table.rows) || table.rows.length < 1 || table.rows.length > 64) {
      errors.push(`${label} rows must contain 1-64 bounded entries`);
      continue;
    }
    const rowIds = new Set();
    for (const row of table.rows) {
      const rowLabel = `${label} row ${String(row?.id ?? "unknown")}`;
      rejectUnknown(errors, row, new Set(["id", "text"]), rowLabel);
      if (
        !isObject(row)
        || !rowIdPattern.test(row.id ?? "")
        || rowIds.has(row.id)
        || !nonEmpty(row.text)
      ) {
        errors.push(`${rowLabel} must have a unique id and authored text only`);
      }
      rowIds.add(row?.id);
    }
  }
  return tables;
}

function validateSlots(errors, config, packId, stockingTables, eventTables, presentationTables) {
  if (!Array.isArray(config.slots) || config.slots.length < 1 || config.slots.length > 256) {
    errors.push("discovery authority slots must contain 1-256 entries");
    return;
  }
  const slotIds = new Set();
  for (const slot of config.slots) {
    const label = `discovery slot ${String(slot?.id ?? "unknown")}`;
    if (!isObject(slot)) {
      errors.push(`${label} must be an object`);
      continue;
    }
    rejectUnknown(
      errors,
      slot,
      new Set([
        "id",
        "version",
        "target_kind",
        "origin_id",
        "scope",
        "initial_phase",
        "tells",
        "reveal_methods",
        "claim_policy",
        "stocking",
        "authorized_topology_ids",
        "gate_id",
        "hazard_id",
        "event_table_id",
        "event_table_version",
        "presentation_table_id",
        "presentation_table_version",
        "progression",
      ]),
      label,
    );
    if (
      !validCanonicalId(slot.id, packId)
      || !slot.id.includes(":discovery/")
      || slotIds.has(slot.id)
    ) {
      errors.push(`${label} id must be a unique pack-owned discovery id`);
    }
    slotIds.add(slot.id);
    if (!Number.isInteger(slot.version) || slot.version < 1 || slot.version > 255) {
      errors.push(`${label} version must be an integer from 1-255`);
    }
    if (!targetKinds.has(slot.target_kind)) errors.push(`${label} target_kind is invalid`);
    if (!validCanonicalId(slot.origin_id, packId)) {
      errors.push(`${label} origin_id must be a pack-owned canonical id`);
    }
    if (!scopes.has(slot.scope)) errors.push(`${label} scope is invalid`);
    if (!phases.has(slot.initial_phase)) {
      errors.push(`${label} initial_phase must be latent or signed`);
    }
    if (!uniqueStrings(slot.reveal_methods, revealMethods, 1, 4)) {
      errors.push(`${label} reveal_methods must be unique supported procedures`);
    }
    if (slot.claim_policy !== "once_per_scope") {
      errors.push(`${label} claim_policy must be once_per_scope`);
    }
    if (!Array.isArray(slot.tells) || slot.tells.length < 1 || slot.tells.length > 8) {
      errors.push(`${label} tells must contain 1-8 authored sensory tells`);
    } else {
      const tellIds = new Set();
      for (const tell of slot.tells) {
        rejectUnknown(errors, tell, new Set(["id", "sense", "text"]), `${label} tell`);
        if (
          !isObject(tell)
          || !rowIdPattern.test(tell.id ?? "")
          || tellIds.has(tell.id)
          || !senses.has(tell.sense)
          || !nonEmpty(tell.text)
        ) {
          errors.push(`${label} has an invalid or duplicate sensory tell`);
        }
        tellIds.add(tell?.id);
      }
    }
    const authorizedTopology = slot.authorized_topology_ids ?? [];
    if (!uniqueStrings(authorizedTopology, null, 0, 64)) {
      errors.push(`${label} authorized_topology_ids must be a bounded unique list`);
    } else if (!authorizedTopology.every((id) => validCanonicalId(id, packId))) {
      errors.push(`${label} authorized_topology_ids must be pack-owned canonical ids`);
    }
    if (
      authorizedTopology.length > 0
      && !["route", "location"].includes(slot.target_kind)
    ) {
      errors.push(`${label} only route/location slots may authorize topology`);
    }

    const stocking = slot.stocking;
    rejectUnknown(
      errors,
      stocking,
      new Set(["kind", "table_id", "table_version", "result_ids"]),
      `${label} stocking`,
    );
    let table;
    if (!isObject(stocking) || !["fixed", "table"].includes(stocking.kind)) {
      errors.push(`${label} stocking must select fixed truth or one table`);
    } else if (stocking.kind === "fixed") {
      if (!uniqueStrings(stocking.result_ids, null, 1, 8)) {
        errors.push(`${label} fixed stocking needs 1-8 result_ids`);
      } else {
        if (!stocking.result_ids.every((id) => validCanonicalId(id, packId))) {
          errors.push(`${label} fixed result_ids must be pack-owned canonical ids`);
        }
        if (
          ["route", "location"].includes(slot.target_kind)
          && stocking.result_ids.some((id) => !authorizedTopology.includes(id))
        ) {
          errors.push(`${label} fixed topology is outside its authorized topology`);
        }
      }
      if (stocking.table_id !== undefined || stocking.table_version !== undefined) {
        errors.push(`${label} fixed stocking cannot reference a table or table version`);
      }
    } else {
      table = stockingTables.get(stocking.table_id);
      if (
        !table
        || table.target_kind !== slot.target_kind
        || stocking.table_version !== table.version
      ) {
        errors.push(
          `${label} table must reference a known matching stocking table and exact version`,
        );
      }
      if (stocking.result_ids !== undefined) {
        errors.push(`${label} table stocking cannot declare fixed result_ids`);
      }
      for (const row of table?.rows ?? []) {
        for (const topologyId of row.topology_entity_ids ?? []) {
          if (!authorizedTopology.includes(topologyId)) {
            errors.push(
              `${label} table row ${row.id} creates topology outside the slot authorization`,
            );
          }
        }
      }
    }
    for (const binding of ["gate_id", "hazard_id"]) {
      if (slot[binding] !== undefined && !validCanonicalId(slot[binding], packId)) {
        errors.push(`${label} ${binding} must be a pack-owned canonical id`);
      }
    }
    const eventTable = eventTables.get(slot.event_table_id);
    if (
      (slot.event_table_id === undefined) !== (slot.event_table_version === undefined)
      || (
        slot.event_table_id !== undefined
        && (!eventTable || slot.event_table_version !== eventTable.version)
      )
    ) {
      errors.push(`${label} event table binding must reference an exact local version`);
    }
    const presentationTable = presentationTables.get(slot.presentation_table_id);
    if (
      (slot.presentation_table_id === undefined)
        !== (slot.presentation_table_version === undefined)
      || (
        slot.presentation_table_id !== undefined
        && (
          !presentationTable
          || slot.presentation_table_version !== presentationTable.version
        )
      )
    ) {
      errors.push(
        `${label} presentation table binding must reference an exact local version`,
      );
    }

    const progression = slot.progression;
    rejectUnknown(
      errors,
      progression,
      new Set(["kind", "sign_budget", "fallback_row_id"]),
      `${label} progression`,
    );
    if (!isObject(progression) || !["optional", "required"].includes(progression.kind)) {
      errors.push(`${label} progression must be optional or required`);
    } else if (progression.kind === "optional") {
      if (progression.sign_budget !== undefined || progression.fallback_row_id !== undefined) {
        errors.push(`${label} optional progression cannot claim a required fallback budget`);
      }
    } else {
      if (
        !Number.isInteger(progression.sign_budget)
        || progression.sign_budget < 1
        || progression.sign_budget > 255
      ) {
        errors.push(`${label} required progression needs a finite sign_budget from 1-255`);
      }
      if (stocking?.kind !== "table" || !table?.rowsById.has(progression.fallback_row_id)) {
        errors.push(`${label} required progression needs a valid deterministic fallback row`);
      } else if (progression.fallback_row_id !== table.fallback_row_id) {
        errors.push(`${label} required progression fallback must match the table fallback`);
      }
    }
  }
}

export function discoveryAuthorityValidationErrors(
  config,
  packId,
  label = "discovery authority",
) {
  const errors = [];
  if (!isObject(config)) return [`${label} must be an object`];
  rejectUnknown(
    errors,
    config,
    new Set([
      "schema_version",
      "receipt_version",
      "roll_algorithm",
      "stocking_tables",
      "event_tables",
      "presentation_tables",
      "slots",
    ]),
    label,
  );
  if (config.schema_version !== SCHEMA_VERSION) {
    errors.push(`${label} schema_version must be ${SCHEMA_VERSION}`);
  }
  if (config.receipt_version !== RECEIPT_VERSION) {
    errors.push(`${label} receipt_version must be ${RECEIPT_VERSION}`);
  }
  if (config.roll_algorithm !== ROLL_ALGORITHM) {
    errors.push(`${label} roll_algorithm must be ${ROLL_ALGORITHM}`);
  }
  if (!nonEmpty(packId)) errors.push(`${label} requires a pack id`);
  const stockingTables = validateStockingTables(errors, config, packId);
  const eventTables = validateEventTables(errors, config, packId);
  const presentationTables = validatePresentationTables(errors, config, packId);
  validateSlots(errors, config, packId, stockingTables, eventTables, presentationTables);
  return errors;
}

export function assertDiscoveryAuthority(config, packId, label = "discovery authority") {
  const errors = discoveryAuthorityValidationErrors(config, packId, label);
  if (errors.length) throw new Error(errors.join("; "));
  return config;
}

export function discoveryAuthorityExtensionValidationErrors(manifest, label = "pack.json") {
  const config = manifest?.extensions?.[EXTENSION];
  return config === undefined
    ? []
    : discoveryAuthorityValidationErrors(config, manifest.id, `${label}: ${EXTENSION}`);
}
