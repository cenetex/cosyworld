import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const v2Root = path.resolve(scriptDir, "..");
const packRoot = path.join(v2Root, "content", "elysium");
const LOCATION_BASE = 652_000;
const ITEM_BASE = 6_520_000;
const rawArgs = process.argv.slice(2);
const args = new Set(rawArgs);

function option(name) {
  const index = rawArgs.indexOf(name);
  return index < 0 ? undefined : rawArgs[index + 1];
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function json(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function actorId(modelId) {
  const sample = crypto.createHash("sha256").update(modelId).digest().readBigUInt64BE(0);
  return Number(1_000_000n + (sample % 998_999_000_000n));
}

function numberOrNull(value) {
  return Number.isInteger(value) && value > 0 && value <= 0xffff_ffff ? value : null;
}

function costPerMillion(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed * 1_000_000 : null;
}

function normalizeStringArray(value) {
  return [...new Set(Array.isArray(value) ? value.filter((item) => typeof item === "string" && item) : [])]
    .sort((left, right) => left.localeCompare(right));
}

function bindingsFromCatalog(catalog, zdrCatalog, snapshotVersion) {
  assert(Array.isArray(catalog?.data), "OpenRouter catalog must contain a data array");
  const zdrIds = new Set((zdrCatalog?.data ?? []).map((model) => model.id));
  const ids = new Set();
  const actors = new Set();
  return catalog.data
    .map((model) => {
      assert(typeof model.id === "string" && model.id, "OpenRouter model is missing id");
      assert(!ids.has(model.id), `OpenRouter catalog repeats ${model.id}`);
      ids.add(model.id);
      const actor_id = actorId(model.id);
      assert(!actors.has(actor_id), `stable actor id collision at ${actor_id}`);
      actors.add(actor_id);
      const input_modalities = normalizeStringArray(model.architecture?.input_modalities);
      const output_modalities = normalizeStringArray(model.architecture?.output_modalities);
      const textChat = input_modalities.includes("text") && output_modalities.includes("text");
      return {
        id: model.id,
        actor_id,
        actor_ref: `pack://cosyworld.elysium/actor/${actor_id}`,
        provider: "openrouter",
        requested_model_id: model.id,
        canonical_slug: model.canonical_slug || model.id,
        display_name: String(model.name || model.id).trim(),
        catalog_snapshot_version: snapshotVersion,
        created: Number.isSafeInteger(model.created) && model.created >= 0 ? model.created : 0,
        input_modalities,
        output_modalities,
        context_length: numberOrNull(model.context_length ?? model.top_provider?.context_length),
        max_completion_tokens: numberOrNull(model.top_provider?.max_completion_tokens),
        supported_parameters: normalizeStringArray(model.supported_parameters),
        input_cost_per_million: costPerMillion(model.pricing?.prompt),
        output_cost_per_million: costPerMillion(model.pricing?.completion),
        zero_data_retention: zdrIds.has(model.id),
        speech_mode: textChat ? "raw" : "unavailable",
      };
    })
    .sort((left, right) => left.id.localeCompare(right.id));
}

function actorsFromBindings(bindings) {
  return bindings.map((binding, index) => ({
    id: binding.actor_id,
    name: binding.display_name,
    speech_mode: binding.speech_mode,
    title: binding.requested_model_id,
    description: "An avatar with an exact OpenRouter model binding.",
    ambient_autonomy: false,
    location_id: LOCATION_BASE + index,
    stats: {
      strength: 10,
      dexterity: 10,
      constitution: 10,
      intelligence: 10,
      wisdom: 10,
      charisma: 10,
      hp_base: 1,
      level: 1,
    },
  }));
}

function voidNumber(index) {
  return String(index + 1).padStart(3, "0");
}

function locationsFromBindings(bindings) {
  return bindings.map((_binding, index) => ({
    id: LOCATION_BASE + index,
    name: `Void ${voidNumber(index)}`,
    title: "A Private Model Void",
    description: "A featureless dark cell contains one model avatar and one inert marker.",
    persona: "Attention ends at this room's boundary. The next cell exists only after a successful Scout.",
    memory: [
      "This private cell contains one model avatar and one unique inert marker.",
    ],
    biome: "void",
    terrain: [
      "featureless dark plane",
    ],
    allow_combat: false,
  }));
}

function itemsFromBindings(bindings) {
  return bindings.map((_binding, index) => ({
    id: ITEM_BASE + index,
    name: `Void Token ${voidNumber(index)}`,
    description: "A small inert marker unique to the model avatar in this private cell.",
    kind: "keepsake",
    charges: 1,
    location_id: LOCATION_BASE + index,
    role: "relic",
    weight_tenths: 1,
    size: "tiny",
  }));
}

function exitsFromBindings(bindings) {
  const exits = [];
  for (let index = 0; index + 1 < bindings.length; index += 1) {
    exits.push({
      from_location_id: LOCATION_BASE + index,
      to_location_id: LOCATION_BASE + index + 1,
      flags: 0,
      distance: 1,
      direction: "east",
      discovery: "scout",
    });
    exits.push({
      from_location_id: LOCATION_BASE + index + 1,
      to_location_id: LOCATION_BASE + index,
      flags: 0,
      distance: 1,
      direction: "west",
      discovery: "scout",
    });
  }
  return exits;
}

function roomSheetsFromBindings(bindings) {
  return bindings.map((_binding, index) => ({
    id: `room:${LOCATION_BASE + index}`,
    location_id: LOCATION_BASE + index,
    name: `Void ${voidNumber(index)}`,
    safety: "safe",
    zone: "frontier",
    aspects: [
      "one model avatar in a private featureless cell",
    ],
    boons: [
      "direct conversation with one exactly bound model",
    ],
    hooks: [
      index + 1 < bindings.length
        ? "the next private cell waits for a successful Scout"
        : "future geography is intentionally undefined",
    ],
    resources: {
      void_items: 1,
    },
    projects: [],
  }));
}

function generatedResources(bindings) {
  return {
    actors: actorsFromBindings(bindings),
    locations: locationsFromBindings(bindings),
    items: itemsFromBindings(bindings),
    exits: exitsFromBindings(bindings),
    room_sheets: roomSheetsFromBindings(bindings),
  };
}

async function fetchCatalog(query = "") {
  const response = await fetch(`https://openrouter.ai/api/v1/models${query}`);
  assert(response.ok, `OpenRouter catalog returned HTTP ${response.status}`);
  return response.json();
}

async function main() {
  const pack = readJson(path.join(packRoot, "pack.json"));
  const configuredSnapshot =
    pack.extensions?.["x-cosyworld-ai-cast"]?.catalog_snapshot_version;
  const snapshotVersion = option("--snapshot-version") ?? configuredSnapshot;
  assert(/^openrouter-\d{4}-\d{2}-\d{2}\.\d+$/.test(snapshotVersion ?? ""), "invalid snapshot version");

  if (args.has("--write")) {
    const catalog = args.has("--fetch")
      ? await fetchCatalog("?output_modalities=all")
      : readJson(path.resolve(option("--catalog")));
    const zdrCatalog = args.has("--fetch")
      ? await fetchCatalog("?output_modalities=all&zdr=true")
      : readJson(path.resolve(option("--zdr-catalog")));
    const bindings = bindingsFromCatalog(catalog, zdrCatalog, snapshotVersion);
    const resources = generatedResources(bindings);
    fs.writeFileSync(path.join(packRoot, "actor_model_bindings.json"), json(bindings));
    for (const [resource, rows] of Object.entries(resources)) {
      fs.writeFileSync(path.join(packRoot, `${resource}.json`), json(rows));
    }
    console.log(
      `wrote Elysium cast: ${bindings.length} models, ${bindings.filter((row) => row.speech_mode === "raw").length} text-chat avatars`,
    );
    return;
  }

  const bindings = readJson(path.join(packRoot, "actor_model_bindings.json"));
  const resources = generatedResources(bindings);
  assert(bindings.length > 0, "Elysium model binding snapshot is empty");
  assert(
    bindings.every((binding) => binding.catalog_snapshot_version === snapshotVersion),
    "Elysium bindings use a stale catalog snapshot version",
  );
  for (const [resource, expected] of Object.entries(resources)) {
    const actual = readJson(path.join(packRoot, `${resource}.json`));
    assert(
      json(actual) === json(expected),
      `Elysium ${resource} are stale; regenerate with generate-elysium-cast.mjs --write`,
    );
  }
  const stableIds = new Set(bindings.map((binding) => actorId(binding.id)));
  assert(stableIds.size === bindings.length, "Elysium stable actor ids collide");
  assert(
    bindings.every((binding) => binding.actor_id === actorId(binding.id)),
    "Elysium actor ids do not match the stable model-id mapping",
  );
  assert(resources.locations.length <= 512, "Elysium exceeds the location capacity");
  assert(resources.exits.length <= 1024, "Elysium exceeds the exit capacity");
  assert(resources.items.length <= 1024, "Elysium exceeds the item capacity");
  assert(
    new Set(resources.actors.map((actor) => actor.location_id)).size === bindings.length,
    "Elysium avatars do not have unique void locations",
  );
  assert(
    new Set(resources.items.map((item) => item.location_id)).size === bindings.length,
    "Elysium avatars do not have unique void items",
  );
  console.log(
    `Elysium cast current: ${bindings.length} models (${snapshotVersion})`,
  );
}

await main();
