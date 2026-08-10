import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const v2Root = path.resolve(scriptDir, "..");
const packRoot = path.join(v2Root, "content", "elysium");
const LOCATION_BASE = 652_000;
const ITEM_BASE = 6_520_000;
const EXIT_CAPACITY = 4_096;
const VOID_PATH_MIN_DISTANCE = 3;
const VOID_PATH_MAX_DISTANCE = 5;
const PHI = (1 + Math.sqrt(5)) / 2;
const PHI_CONJUGATE = PHI - 1;
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

function exactRouteHasZeroDataRetention(modelId, zdrIds) {
  // OpenRouter's ZDR-filtered model catalog can advertise a base model's ZDR
  // availability on its `:free` variant even when the exact free endpoint has
  // none. Exact requests to both Nemotron 3 free variants returned "No
  // endpoints found matching your data policy (Zero data retention)" on
  // 2026-08-09. Elysium binds exact route ids, so keep the conservative exact
  // route interpretation until the endpoint inventory exposes that distinction.
  return zdrIds.has(modelId) && !modelId.endsWith(":free");
}

function normalizeExactRoutePolicies(bindings) {
  return bindings.map((binding) =>
    binding.requested_model_id.endsWith(":free") &&
    binding.zero_data_retention
      ? { ...binding, zero_data_retention: false }
      : binding,
  );
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
        zero_data_retention: exactRouteHasZeroDataRetention(model.id, zdrIds),
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
    ambient_autonomy: true,
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
    title: "A Private Node in the Void",
    description: "A dark node in a branching fractal web contains one model avatar and one inert marker.",
    persona: "Attention holds at this node. Scout reveals unmapped paths before anyone can travel them.",
    memory: [
      "This private cell contains one model avatar and one unique inert marker.",
      "Scout reveals the local paths of the Fibonacci-Wythoff rhizome one segment at a time.",
    ],
    biome: "void",
    terrain: [
      "dark plane crossed by latent golden-ratio filaments",
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

function wythoffParent(index) {
  assert(Number.isInteger(index) && index > 0, `invalid Wythoff node index ${index}`);
  return Math.floor((index - 1) / PHI);
}

function goldenPairScore(left, right) {
  return (
    ((left + 1) * PHI_CONJUGATE)
    + ((right + 1) * PHI_CONJUGATE * PHI_CONJUGATE)
  ) % 1;
}

function voidTopology(nodeCount) {
  if (nodeCount === 0) return { edges: [], depths: [] };

  const depths = [0];
  const childrenByParent = new Map();
  const branchEdges = [];
  for (let child = 1; child < nodeCount; child += 1) {
    const parent = wythoffParent(child);
    assert(parent >= 0 && parent < child, `Wythoff parent escaped the rooted web at ${child}`);
    depths[child] = depths[parent] + 1;
    const siblings = childrenByParent.get(parent) ?? [];
    siblings.push(child);
    childrenByParent.set(parent, siblings);
    branchEdges.push({ left: parent, right: child, kind: "branch" });
  }

  assert(
    [...childrenByParent.values()].every((children) => children.length <= 2),
    "the Wythoff tree must remain binary",
  );

  const nodesByDepth = new Map();
  for (let index = 0; index < depths.length; index += 1) {
    const peers = nodesByDepth.get(depths[index]) ?? [];
    peers.push(index);
    nodesByDepth.set(depths[index], peers);
  }

  const lateralCandidates = [];
  for (const peers of nodesByDepth.values()) {
    for (let leftIndex = 0; leftIndex < peers.length; leftIndex += 1) {
      for (let rightIndex = leftIndex + 1; rightIndex < peers.length; rightIndex += 1) {
        const left = peers[leftIndex];
        const right = peers[rightIndex];
        if (left > 0 && wythoffParent(left) === wythoffParent(right)) continue;
        lateralCandidates.push({
          left,
          right,
          kind: "rhizome",
          score: goldenPairScore(left, right),
        });
      }
    }
  }
  lateralCandidates.sort((left, right) =>
    left.score - right.score || left.left - right.left || left.right - right.right);

  const undirectedCapacity = Math.floor(EXIT_CAPACITY / 2);
  const lateralBudget = Math.min(32, Math.max(0, undirectedCapacity - branchEdges.length));
  const lateralNodes = new Set();
  const lateralEdges = [];
  for (const candidate of lateralCandidates) {
    if (lateralEdges.length >= lateralBudget) break;
    if (lateralNodes.has(candidate.left) || lateralNodes.has(candidate.right)) continue;
    lateralNodes.add(candidate.left);
    lateralNodes.add(candidate.right);
    lateralEdges.push({ left: candidate.left, right: candidate.right, kind: candidate.kind });
  }
  assert(
    lateralEdges.length === lateralBudget,
    `could only weave ${lateralEdges.length} of ${lateralBudget} lateral void filaments`,
  );

  const childOrdinal = new Map();
  for (const [parent, children] of childrenByParent) {
    children.forEach((child, ordinal) => childOrdinal.set(`${parent}:${child}`, ordinal));
  }
  const edges = [...branchEdges, ...lateralEdges].map((edge) => {
    if (edge.kind === "rhizome") {
      return { ...edge, leftDirection: "east", rightDirection: "west" };
    }
    const ordinal = childOrdinal.get(`${edge.left}:${edge.right}`);
    assert(ordinal === 0 || ordinal === 1, `missing branch ordinal for ${edge.left}:${edge.right}`);
    return ordinal === 0
      ? { ...edge, leftDirection: "northwest", rightDirection: "southeast" }
      : { ...edge, leftDirection: "northeast", rightDirection: "southwest" };
  });
  return { edges, depths };
}

function voidPathDistance(edge) {
  const distanceRange = VOID_PATH_MAX_DISTANCE - VOID_PATH_MIN_DISTANCE + 1;
  return VOID_PATH_MIN_DISTANCE + ((edge.left * 31 + edge.right * 17) % distanceRange);
}

function exitsFromTopology(topology) {
  const exits = topology.edges.flatMap((edge) => {
    const distance = voidPathDistance(edge);
    return [
      {
        from_location_id: LOCATION_BASE + edge.left,
        to_location_id: LOCATION_BASE + edge.right,
        flags: 0,
        distance,
        direction: edge.leftDirection,
        discovery: "scout",
      },
      {
        from_location_id: LOCATION_BASE + edge.right,
        to_location_id: LOCATION_BASE + edge.left,
        flags: 0,
        distance,
        direction: edge.rightDirection,
        discovery: "scout",
      },
    ];
  });
  return exits.sort((left, right) =>
    left.from_location_id - right.from_location_id
    || left.direction.localeCompare(right.direction)
    || left.to_location_id - right.to_location_id);
}

function roomSheetsFromBindings(bindings, topology) {
  const degreeByNode = new Map();
  for (const edge of topology.edges) {
    degreeByNode.set(edge.left, (degreeByNode.get(edge.left) ?? 0) + 1);
    degreeByNode.set(edge.right, (degreeByNode.get(edge.right) ?? 0) + 1);
  }
  return bindings.map((_binding, index) => ({
    id: `room:${LOCATION_BASE + index}`,
    location_id: LOCATION_BASE + index,
    name: `Void ${voidNumber(index)}`,
    safety: "safe",
    zone: "frontier",
    aspects: [
      "one model avatar at a private node in the dark rhizome",
    ],
    boons: [
      "direct conversation with one exactly bound model",
      "scoutable passage through a deterministic fractal web",
    ],
    hooks: [
      `${degreeByNode.get(index) ?? 0} local void paths can be revealed by Scout and then travelled segment by segment`,
    ],
    resources: {
      void_items: 1,
    },
    projects: [],
  }));
}

function generatedResources(bindings) {
  const topology = voidTopology(bindings.length);
  return {
    actors: actorsFromBindings(bindings),
    locations: locationsFromBindings(bindings),
    items: itemsFromBindings(bindings),
    exits: exitsFromTopology(topology),
    room_sheets: roomSheetsFromBindings(bindings, topology),
  };
}

function assertVoidTopology(bindings, resources) {
  const nodeCount = bindings.length;
  assert(
    resources.actors.every((actor) => actor.ambient_autonomy === true),
    "Elysium avatars must participate in ambient autonomy",
  );
  const adjacency = new Map(bindings.map((_binding, index) => [index, new Set()]));
  const directions = new Set();
  const pathDistances = new Set();
  const distanceByDirectedEdge = new Map();
  for (const exit of resources.exits) {
    const from = exit.from_location_id - LOCATION_BASE;
    const to = exit.to_location_id - LOCATION_BASE;
    adjacency.get(from)?.add(to);
    const directionKey = `${from}:${exit.direction}`;
    assert(!directions.has(directionKey), `void ${from} repeats direction ${exit.direction}`);
    directions.add(directionKey);
    assert(exit.discovery === "scout", `void filament ${from}->${to} bypasses Scout`);
    assert(exit.distance >= VOID_PATH_MIN_DISTANCE, `void path ${from}->${to} is too short`);
    assert(exit.distance <= VOID_PATH_MAX_DISTANCE, `void path ${from}->${to} is too long`);
    pathDistances.add(exit.distance);
    distanceByDirectedEdge.set(`${from}:${to}`, exit.distance);
  }
  for (const [edge, distance] of distanceByDirectedEdge) {
    const [from, to] = edge.split(":");
    assert(
      distanceByDirectedEdge.get(`${to}:${from}`) === distance,
      `void path ${from}<->${to} has asymmetric distance`,
    );
  }

  const visited = new Set(nodeCount > 0 ? [0] : []);
  const pending = nodeCount > 0 ? [0] : [];
  while (pending.length > 0) {
    for (const neighbor of adjacency.get(pending.shift()) ?? []) {
      if (visited.has(neighbor)) continue;
      visited.add(neighbor);
      pending.push(neighbor);
    }
  }

  const undirectedRoutes = resources.exits.length / 2;
  const cycleRank = undirectedRoutes - nodeCount + (nodeCount > 0 ? 1 : 0);
  assert(visited.size === nodeCount, `the void rhizome strands ${nodeCount - visited.size} nodes`);
  assert(resources.exits.length <= EXIT_CAPACITY, "Elysium exceeds the exit capacity");
  assert(nodeCount < 3 || adjacency.get(0)?.size === 2, "the entry void must begin with two Scout branches");
  assert(nodeCount < 4 || [...adjacency.values()].some((neighbors) => neighbors.size >= 3), "the void does not branch");
  assert(nodeCount < 4 || cycleRank > 0, "the void has no lateral rhizome loops");
  assert(nodeCount < 3 || pathDistances.size > 1, "the void paths do not vary in length");
  assert(
    [...adjacency.values()].every((neighbors) => neighbors.size <= 4),
    "a void node exceeds the four-filament exploration budget",
  );
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
    const refreshBindings = args.has("--fetch") || option("--catalog") !== undefined;
    const bindings = refreshBindings
      ? bindingsFromCatalog(
          args.has("--fetch")
            ? await fetchCatalog("?output_modalities=all")
            : readJson(path.resolve(option("--catalog"))),
          args.has("--fetch")
            ? await fetchCatalog("?output_modalities=all&zdr=true")
            : readJson(path.resolve(option("--zdr-catalog"))),
          snapshotVersion,
        )
      : normalizeExactRoutePolicies(
          readJson(path.join(packRoot, "actor_model_bindings.json")),
        );
    const resources = generatedResources(bindings);
    assertVoidTopology(bindings, resources);
    if (
      refreshBindings ||
      json(bindings) !==
        json(readJson(path.join(packRoot, "actor_model_bindings.json")))
    ) {
      fs.writeFileSync(path.join(packRoot, "actor_model_bindings.json"), json(bindings));
    }
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
  assertVoidTopology(bindings, resources);
  assert(bindings.length > 0, "Elysium model binding snapshot is empty");
  assert(
    bindings.every(
      (binding) =>
        !binding.requested_model_id.endsWith(":free") ||
        binding.zero_data_retention === false,
    ),
    "Elysium free variants must not inherit base-model ZDR availability",
  );
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
  assert(resources.locations.length <= 2048, "Elysium exceeds the location capacity");
  assert(resources.exits.length <= EXIT_CAPACITY, "Elysium exceeds the exit capacity");
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
