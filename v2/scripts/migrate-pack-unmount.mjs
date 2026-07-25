#!/usr/bin/env node
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const PACK_MOUNT_STATE_SCHEMA_VERSION = 1;

function packHandles(registry, packId, kind) {
  return new Set((registry.content_references?.entries ?? [])
    .filter((entry) => entry.pack_id === packId && entry.kind === kind)
    .map((entry) => entry.runtime_handle));
}

function packResourceIds(registry, packId, resource, identity = "id") {
  return new Set((registry.resources?.[resource] ?? [])
    .filter((row) => row.pack_id === packId)
    .map((row) => String(row[identity])));
}

function hasId(ids, value) {
  return ids.has(Number(value));
}

function takeArrayEntries(snapshot, field, predicate) {
  const frozen = [];
  const retained = [];
  for (const [index, value] of (snapshot[field] ?? []).entries()) {
    if (predicate(value)) {
      frozen.push({ index, value });
    } else {
      retained.push(value);
    }
  }
  snapshot[field] = retained;
  return frozen;
}

function takeMapKeys(map, keys) {
  const frozen = {};
  if (!map || Array.isArray(map) || typeof map !== "object") return frozen;
  for (const key of keys) {
    if (Object.hasOwn(map, String(key))) {
      frozen[String(key)] = map[String(key)];
      delete map[String(key)];
    }
  }
  return frozen;
}

function takeMapValues(map, predicate) {
  const frozen = {};
  if (!map || Array.isArray(map) || typeof map !== "object") return frozen;
  for (const [key, value] of Object.entries(map)) {
    if (predicate(value, key)) {
      frozen[key] = value;
      delete map[key];
    }
  }
  return frozen;
}

function restoreArrayEntries(snapshot, field, frozen, identity) {
  const restored = [...(snapshot[field] ?? [])];
  const identities = new Set(restored.map(identity));
  for (const { value } of frozen) {
    const key = identity(value);
    if (identities.has(key)) {
      throw new Error(`cannot remount: ${field} identity ${key} is already active`);
    }
    identities.add(key);
  }
  for (const { index, value } of [...frozen].sort((left, right) => left.index - right.index)) {
    restored.splice(Math.min(index, restored.length), 0, value);
  }
  snapshot[field] = restored;
}

function restoreMapEntries(snapshot, field, frozen) {
  const restored = { ...(snapshot[field] ?? {}) };
  for (const [key, value] of Object.entries(frozen ?? {})) {
    if (Object.hasOwn(restored, key)) {
      throw new Error(`cannot remount: ${field} identity ${key} is already active`);
    }
    restored[key] = value;
  }
  snapshot[field] = restored;
}

function restoreNestedMapEntries(parent, field, frozen) {
  const restored = { ...(parent[field] ?? {}) };
  for (const [key, value] of Object.entries(frozen ?? {})) {
    if (Object.hasOwn(restored, key)) {
      throw new Error(`cannot remount: world_simulation.${field} identity ${key} is already active`);
    }
    restored[key] = value;
  }
  parent[field] = restored;
}

function packVersion(registry, packId) {
  return (registry.manifest?.packs ?? []).find((pack) => pack.id === packId)?.version;
}

function registryHasPack(registry, packId) {
  return packVersion(registry, packId) !== undefined;
}

function targetRulesets(registry) {
  if (!registry) return [];
  const providers = new Map();
  for (const pack of registry.manifest?.packs ?? []) {
    for (const capability of pack.capabilities ?? []) providers.set(capability.id, pack);
  }
  return (registry.manifest?.packs ?? []).flatMap((pack) => {
    const provider = providers.get(pack.default_ruleset);
    return provider ? [{
      selected_by_pack_id: pack.id,
      capability_id: pack.default_ruleset,
      provider_pack_id: provider.id,
      provider_pack_version: provider.version,
    }] : [];
  });
}

function targetContentContext(current, targetRegistry, unmountedPackId) {
  const targetReferences = new Map((targetRegistry.content_references?.entries ?? [])
    .map((entry) => [entry.canonical_ref, entry]));
  return {
    mapping_version: targetRegistry.content_references?.mapping_version ?? 0,
    references: (current?.references ?? [])
      .filter((reference) => reference.pack_id !== unmountedPackId)
      .filter((reference) => targetReferences.has(reference.canonical_ref))
      .map((reference) => structuredClone(targetReferences.get(reference.canonical_ref))),
    active_rulesets: targetRulesets(targetRegistry),
  };
}

function packMountState(snapshot, create = false) {
  if (snapshot.pack_mount_state === undefined && create) {
    snapshot.pack_mount_state = {
      schema_version: PACK_MOUNT_STATE_SCHEMA_VERSION,
      next_transaction_seq: 1,
      frozen: {},
      history: [],
    };
  }
  const state = snapshot.pack_mount_state;
  if (!state) return null;
  if (state.schema_version !== PACK_MOUNT_STATE_SCHEMA_VERSION
      || !state.frozen
      || !Array.isArray(state.history)) {
    throw new Error("unsupported or malformed pack_mount_state");
  }
  return state;
}

function frozenStateHash(frozen) {
  const digest = crypto.createHash("sha256").update(JSON.stringify(frozen)).digest("hex");
  return `sha256:${digest}`;
}

function appendTransaction(state, transaction) {
  const sequence = state.next_transaction_seq ?? 1;
  const committed = { sequence, status: "committed", ...transaction };
  state.history.push(committed);
  state.next_transaction_seq = sequence + 1;
  return committed;
}

export function migratePackUnmount(snapshot, sourceRegistry, packId, targetRegistry) {
  if (!registryHasPack(sourceRegistry, packId)) {
    throw new Error(`pack ${packId} is not mounted in the source registry`);
  }
  if (!targetRegistry) {
    throw new Error("soft unmount requires a target registry");
  }
  if (registryHasPack(targetRegistry, packId)) {
    throw new Error(`target registry still mounts pack ${packId}`);
  }

  const migrated = structuredClone(snapshot);
  const mountState = packMountState(migrated, true);
  if (mountState.frozen[packId]) {
    throw new Error(`pack ${packId} is already soft-unmounted`);
  }

  const actorIds = packHandles(sourceRegistry, packId, "actor");
  const itemIds = packHandles(sourceRegistry, packId, "item");
  const locationIds = packHandles(sourceRegistry, packId, "location");
  const occupied = (migrated.world_actors ?? [])
    .filter((actor) => actor.kind === 1 && hasId(locationIds, actor.location_id));
  if (occupied.length > 0) {
    throw new Error(`cannot unmount ${packId}: human actors ${occupied.map((actor) => actor.id).join(", ")} still occupy pack locations`);
  }

  const before = {
    actors: migrated.world_actors?.length ?? 0,
    items: migrated.world_items?.length ?? 0,
    locations: migrated.world_locations?.length ?? 0,
    exits: migrated.world_exits?.length ?? 0,
  };
  const arrays = {
    world_actors: takeArrayEntries(
      migrated,
      "world_actors",
      (actor) => hasId(actorIds, actor.id),
    ),
    world_items: takeArrayEntries(
      migrated,
      "world_items",
      (item) => hasId(itemIds, item.id),
    ),
    world_locations: takeArrayEntries(
      migrated,
      "world_locations",
      (location) => hasId(locationIds, location.id),
    ),
    world_exits: takeArrayEntries(
      migrated,
      "world_exits",
      (exit) =>
        hasId(locationIds, exit.from_location_id)
          || hasId(locationIds, exit.to_location_id),
    ),
    world_evolution_tracks: takeArrayEntries(
      migrated,
      "world_evolution_tracks",
      (track) => hasId(actorIds, track.actor_id),
    ),
    world_combat_encounters: takeArrayEntries(
      migrated,
      "world_combat_encounters",
      (encounter) =>
        hasId(locationIds, encounter.location_id)
          || (encounter.participants ?? [])
            .some((participant) => hasId(actorIds, participant.actor_id)),
    ),
  };

  const maps = {};
  for (const field of [
    "actor_meta",
    "actor_autonomy",
    "actor_rules_facets",
    "callings",
    "character_identities",
    "charm_slots",
    "deed_ids_by_actor",
    "equipped_charms",
    "orb_balances",
    "prepared_spells",
  ]) maps[field] = takeMapKeys(migrated[field], actorIds);
  for (const field of ["item_meta", "item_provenance"]) {
    maps[field] = takeMapKeys(migrated[field], itemIds);
  }
  for (const field of [
    "generated_places",
    "location_names",
    "location_meta",
    "natural_affordances",
    "recent_room_lines",
    "room_sheets",
  ]) maps[field] = takeMapKeys(migrated[field], locationIds);

  maps.clocks = takeMapKeys(
    migrated.clocks,
    packResourceIds(sourceRegistry, packId, "clocks"),
  );
  Object.assign(
    maps.clocks,
    takeMapValues(migrated.clocks, (clock) => hasId(locationIds, clock.scope_id)),
  );
  maps.jobs = takeMapKeys(
    migrated.jobs,
    packResourceIds(sourceRegistry, packId, "jobs"),
  );
  Object.assign(
    maps.jobs,
    takeMapValues(
      migrated.jobs,
      (job) => (job.location_ids ?? []).some((locationId) => hasId(locationIds, locationId)),
    ),
  );
  maps.branches = takeMapValues(
    migrated.branches,
    (branch) =>
      hasId(actorIds, branch.actor_id) || hasId(actorIds, branch.target_actor_id),
  );
  maps.generated_pathways = takeMapValues(
    migrated.generated_pathways,
    (pathway) =>
      hasId(locationIds, pathway.origin_location_id)
        || hasId(locationIds, pathway.destination_location_id),
  );
  maps.journeys = takeMapValues(
    migrated.journeys,
    (journey) =>
      hasId(actorIds, journey.actor_id)
        || hasId(locationIds, journey.origin_location_id)
        || hasId(locationIds, journey.destination_location_id)
        || (journey.path ?? []).some((locationId) => hasId(locationIds, locationId)),
  );
  for (const field of ["skills", "ledger_marks", "advancement_spends"]) {
    maps[field] = takeMapValues(
      migrated[field],
      (entry) => hasId(actorIds, entry.actor_id),
    );
  }
  maps.bonds = takeMapValues(
    migrated.bonds,
    (bond) => hasId(actorIds, bond.actor_id) || hasId(actorIds, bond.target_actor_id),
  );
  maps.resident_continuities = takeMapValues(
    migrated.resident_continuities,
    (continuity) => hasId(actorIds, continuity.resident_id),
  );
  maps.resident_memories = takeMapValues(
    migrated.resident_memories,
    (memory) =>
      hasId(actorIds, memory.carrier_actor_id)
        || hasId(actorIds, memory.source_actor_id)
        || hasId(actorIds, memory.holder_actor_id)
        || hasId(locationIds, memory.location_id)
        || (memory.kind === "actor" && hasId(actorIds, memory.subject_id))
        || (memory.kind === "item" && hasId(itemIds, memory.subject_id)),
  );
  maps.search_memories = takeMapValues(
    migrated.search_memories,
    (memory) =>
      hasId(actorIds, memory.actor_id)
        || hasId(locationIds, memory.location_id)
        || (memory.kind === "actor" && hasId(actorIds, memory.subject_id))
        || (memory.kind === "item" && hasId(itemIds, memory.subject_id))
        || (memory.kind === "location" && hasId(locationIds, memory.subject_id)),
  );
  maps.tags = takeMapValues(
    migrated.tags,
    (tag) =>
      hasId(actorIds, tag.scope_id)
        || hasId(itemIds, tag.scope_id)
        || hasId(locationIds, tag.scope_id),
  );
  maps.transfer_offers = takeMapValues(
    migrated.transfer_offers,
    (offer) =>
      hasId(actorIds, offer.offered_by_actor_id)
        || hasId(actorIds, offer.offered_to_actor_id)
        || hasId(itemIds, offer.offered_item_id)
        || hasId(itemIds, offer.requested_item_id),
  );
  maps.gift_auto_accepts = takeMapValues(
    migrated.gift_auto_accepts,
    (policy) =>
      hasId(actorIds, policy.recipient_actor_id)
        || hasId(actorIds, policy.offered_by_actor_id)
        || hasId(itemIds, policy.item_id),
  );

  migrated.world_simulation ??= {};
  const worldSimulation = {
    locations: takeMapKeys(migrated.world_simulation.locations, locationIds),
    factions: takeMapKeys(
      migrated.world_simulation.factions,
      packResourceIds(sourceRegistry, packId, "factions"),
    ),
  };
  const removed = {
    actors: before.actors - migrated.world_actors.length,
    items: before.items - migrated.world_items.length,
    locations: before.locations - migrated.world_locations.length,
    exits: before.exits - migrated.world_exits.length,
  };
  const frozen = {
    pack_id: packId,
    pack_version: packVersion(sourceRegistry, packId),
    source_bundle_hash: sourceRegistry.manifest.bundle_hash,
    target_bundle_hash: targetRegistry.manifest.bundle_hash,
    content_context: structuredClone(migrated.content_context ?? {}),
    arrays,
    maps,
    world_simulation: worldSimulation,
  };
  const stateHash = frozenStateHash(frozen);
  mountState.frozen[packId] = frozen;
  migrated.content_context = targetContentContext(
    migrated.content_context,
    targetRegistry,
    packId,
  );
  migrated.worldpack_bundle_hash = targetRegistry.manifest.bundle_hash;
  const transaction = appendTransaction(mountState, {
    operation: "soft_unmount",
    pack_id: packId,
    pack_version: frozen.pack_version,
    source_bundle_hash: frozen.source_bundle_hash,
    target_bundle_hash: frozen.target_bundle_hash,
    state_hash: stateHash,
    counts: removed,
  });

  return { snapshot: migrated, removed, transaction };
}

export function migratePackRemount(snapshot, sourceRegistry, packId, targetRegistry) {
  if (registryHasPack(sourceRegistry, packId)) {
    throw new Error(`source registry already mounts pack ${packId}`);
  }
  if (!targetRegistry || !registryHasPack(targetRegistry, packId)) {
    throw new Error(`target registry does not mount pack ${packId}`);
  }
  const migrated = structuredClone(snapshot);
  const mountState = packMountState(migrated);
  const frozen = mountState?.frozen?.[packId];
  if (!frozen) {
    throw new Error(`pack ${packId} has no frozen soft-unmount state`);
  }
  if (frozen.target_bundle_hash !== sourceRegistry.manifest.bundle_hash) {
    throw new Error(`cannot remount ${packId}: current registry does not match the unmount target`);
  }
  if (frozen.source_bundle_hash !== targetRegistry.manifest.bundle_hash
      || frozen.pack_version !== packVersion(targetRegistry, packId)) {
    throw new Error(`cannot remount ${packId}: target registry does not match the frozen source`);
  }

  const arrayIdentities = {
    world_actors: (actor) => actor.id,
    world_items: (item) => item.id,
    world_locations: (location) => location.id,
    world_exits: (exit) =>
      `${exit.from_location_id}:${exit.to_location_id}:${exit.flags ?? 0}`,
    world_evolution_tracks: (track) => track.actor_id,
    world_combat_encounters: (encounter) => encounter.id,
  };
  for (const [field, entries] of Object.entries(frozen.arrays ?? {})) {
    restoreArrayEntries(migrated, field, entries, arrayIdentities[field]);
  }
  for (const [field, entries] of Object.entries(frozen.maps ?? {})) {
    restoreMapEntries(migrated, field, entries);
  }
  migrated.world_simulation ??= {};
  for (const [field, entries] of Object.entries(frozen.world_simulation ?? {})) {
    restoreNestedMapEntries(migrated.world_simulation, field, entries);
  }
  migrated.content_context = structuredClone(frozen.content_context);
  migrated.worldpack_bundle_hash = targetRegistry.manifest.bundle_hash;
  delete mountState.frozen[packId];
  const restored = {
    actors: frozen.arrays?.world_actors?.length ?? 0,
    items: frozen.arrays?.world_items?.length ?? 0,
    locations: frozen.arrays?.world_locations?.length ?? 0,
    exits: frozen.arrays?.world_exits?.length ?? 0,
  };
  const transaction = appendTransaction(mountState, {
    operation: "remount",
    pack_id: packId,
    pack_version: frozen.pack_version,
    source_bundle_hash: sourceRegistry.manifest.bundle_hash,
    target_bundle_hash: targetRegistry.manifest.bundle_hash,
    state_hash: frozenStateHash(frozen),
    counts: restored,
  });
  return { snapshot: migrated, restored, transaction };
}

function option(args, name) {
  const index = args.indexOf(name);
  return index < 0 ? undefined : args[index + 1];
}

function writeJsonAtomically(output, value) {
  const destination = path.resolve(output);
  const temporary = `${destination}.tmp-${process.pid}`;
  fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { flag: "wx" });
  try {
    fs.renameSync(temporary, destination);
  } catch (error) {
    fs.rmSync(temporary, { force: true });
    throw error;
  }
}

const scriptPath = fileURLToPath(import.meta.url);
if (process.argv[1] && path.resolve(process.argv[1]) === scriptPath) {
  try {
    const args = process.argv.slice(2);
    const operation = option(args, "--operation") ?? "unmount";
    const input = option(args, "--input");
    const output = option(args, "--output");
    const registryPath = option(args, "--registry");
    const targetPath = option(args, "--target-registry");
    const packId = option(args, "--pack");
    if (!input || !output || !registryPath || !targetPath || !packId
        || !["unmount", "remount"].includes(operation)) {
      throw new Error("usage: migrate-pack-unmount.mjs --operation unmount|remount --input snapshot.json --output migrated.json --registry source-registry.json --target-registry target-registry.json --pack PACK_ID");
    }
    const snapshot = JSON.parse(fs.readFileSync(path.resolve(input), "utf8"));
    const registry = JSON.parse(fs.readFileSync(path.resolve(registryPath), "utf8"));
    const target = JSON.parse(fs.readFileSync(path.resolve(targetPath), "utf8"));
    const result = operation === "unmount"
      ? migratePackUnmount(snapshot, registry, packId, target)
      : migratePackRemount(snapshot, registry, packId, target);
    writeJsonAtomically(output, result.snapshot);
    console.log(`${operation}ed ${packId}: ${JSON.stringify(result.removed ?? result.restored)}`);
  } catch (error) {
    console.error(`pack mount migration failed: ${error.message}`);
    process.exit(1);
  }
}
