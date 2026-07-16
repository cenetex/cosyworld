#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));

function contextIsPresent(context) {
  return context && Number.isInteger(context.mapping_version) && context.mapping_version > 0;
}

function activeRulesets(manifest) {
  const packs = manifest?.packs ?? [];
  const providers = new Map();
  for (const pack of packs) {
    for (const capability of pack.capabilities ?? []) providers.set(capability.id, pack);
  }
  return packs.flatMap((pack) => {
    if (!pack.default_ruleset) return [];
    const provider = providers.get(pack.default_ruleset);
    if (!provider) return [];
    return [{
      selected_by_pack_id: pack.id,
      capability_id: pack.default_ruleset,
      provider_pack_id: provider.id,
      provider_pack_version: provider.version,
    }];
  });
}

function indexMapping(registry) {
  const mapping = registry.content_references ?? registry;
  if (mapping?.schema_version !== 1 || !Number.isInteger(mapping.mapping_version) || !Array.isArray(mapping.entries)) {
    throw new Error("registry has no schema-version-1 content reference mapping");
  }
  const byHandle = new Map();
  for (const entry of mapping.entries) {
    const key = `${entry.kind}:${entry.runtime_handle}`;
    if (byHandle.has(key)) throw new Error(`duplicate mapped handle ${key}`);
    byHandle.set(key, entry);
    if (entry.legacy_runtime_id !== undefined) byHandle.set(`${entry.kind}:${entry.legacy_runtime_id}`, entry);
  }
  return {
    mappingVersion: mapping.mapping_version,
    byHandle,
    rulesets: activeRulesets(registry.manifest),
  };
}

function referenceContext(index, handles) {
  const references = new Map();
  for (const [kind, handle] of handles) {
    if (!Number.isSafeInteger(handle) || handle <= 0) continue;
    const entry = index.byHandle.get(`${kind}:${handle}`);
    if (entry) references.set(entry.canonical_ref, entry);
  }
  return {
    mapping_version: index.mappingVersion,
    references: [...references.values()].sort((left, right) => left.canonical_ref.localeCompare(right.canonical_ref)),
    active_rulesets: index.rulesets,
  };
}

function actionHandles(action) {
  const handles = [
    ["actor", action.actor_id],
    ["actor", action.target_actor_id],
    ["location", action.location_id],
    ["location", action.destination_location_id],
    ["item", action.item_id],
    ["item", action.target_item_id],
    ["item", action.output_item_id],
  ];
  if (action.output_target_kind === 1) handles.push(["actor", action.output_target_id]);
  if (action.output_target_kind === 2) handles.push(["location", action.output_target_id]);
  return handles;
}

function eventHandles(event) {
  return [
    ["actor", event.actor_id],
    ["actor", event.target_actor_id],
    ["location", event.location_id],
    ["location", event.destination_location_id],
    ["location", event.source_location_id],
    ["item", event.item_id],
    ["item", event.target_item_id],
  ];
}

function snapshotHandles(snapshot) {
  return [
    ...(snapshot.world_actors ?? []).map((actor) => ["actor", actor.id]),
    ...(snapshot.world_items ?? []).map((item) => ["item", item.id]),
    ...(snapshot.world_locations ?? []).map((location) => ["location", location.id]),
  ];
}

export function migrateContentReferenceDocument(document, registry, { force = false } = {}) {
  const index = indexMapping(registry);
  let migrated = 0;
  const visit = (value) => {
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }
    if (!value || typeof value !== "object") return;
    let handles = null;
    if (value.action && typeof value.action === "object" && Number.isSafeInteger(value.seed)) {
      handles = actionHandles(value.action);
      if (Number.isSafeInteger(value.source_location_id)) handles.push(["location", value.source_location_id]);
      if (!Number.isInteger(value.version) || value.version < 4) value.version = 4;
    } else if (Array.isArray(value.world_actors) && Array.isArray(value.world_items) && Array.isArray(value.world_locations)) {
      handles = snapshotHandles(value);
      if (!Number.isInteger(value.version) || value.version < 2) value.version = 2;
    } else if (Number.isSafeInteger(value.seq) && typeof (value.type ?? value.type_name) === "string") {
      handles = eventHandles(value);
    }
    if (handles && (force || !contextIsPresent(value.content_context))) {
      value.content_context = referenceContext(index, handles);
      migrated += 1;
    }
    for (const [key, child] of Object.entries(value)) {
      if (key !== "content_context") visit(child);
    }
  };
  visit(document);
  return { document, migrated };
}

function parseArgs(args) {
  const option = (name) => {
    const index = args.indexOf(name);
    return index < 0 ? undefined : args[index + 1];
  };
  return {
    input: option("--input"),
    output: option("--output"),
    registry: option("--registry") ?? path.resolve(scriptDir, "../content/official/registry.json"),
    inPlace: args.includes("--in-place"),
    force: args.includes("--force"),
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const options = parseArgs(process.argv.slice(2));
    if (!options.input || (!options.output && !options.inPlace) || (options.output && options.inPlace)) {
      throw new Error("usage: migrate-content-references.mjs --input FILE (--output FILE | --in-place) [--registry registry.json] [--force]");
    }
    const inputPath = path.resolve(options.input);
    const outputPath = options.inPlace ? inputPath : path.resolve(options.output);
    const document = JSON.parse(fs.readFileSync(inputPath, "utf8"));
    const registry = JSON.parse(fs.readFileSync(path.resolve(options.registry), "utf8"));
    const result = migrateContentReferenceDocument(document, registry, { force: options.force });
    fs.writeFileSync(outputPath, `${JSON.stringify(result.document, null, 2)}\n`);
    console.log(`migrated ${result.migrated} record(s) to content reference mapping ${registry.content_references?.mapping_version ?? registry.mapping_version}`);
  } catch (error) {
    console.error(`content reference migration failed: ${error.message}`);
    process.exit(1);
  }
}
