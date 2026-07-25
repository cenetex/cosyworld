#!/usr/bin/env node
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";

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

function invalidateMapValues(map, predicate, invalidate) {
  const invalidated = [];
  if (!map || Array.isArray(map) || typeof map !== "object") return invalidated;
  for (const [key, value] of Object.entries(map)) {
    if (!predicate(value, key)) continue;
    invalidate(value);
    invalidated.push(key);
  }
  return invalidated;
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

function registryRuleBinding(registry) {
  return {
    rules_profile: registry.manifest?.rules_profile ?? "",
    active_rules_variants: structuredClone(
      registry.manifest?.active_rules_variants ?? [],
    ),
    active_rules_extensions: structuredClone(
      registry.manifest?.active_rules_extensions ?? [],
    ),
  };
}

function applyRegistryBinding(snapshot, registry) {
  const binding = registryRuleBinding(registry);
  snapshot.worldpack_bundle_hash = registry.manifest.bundle_hash;
  snapshot.rules_profile = binding.rules_profile;
  snapshot.active_rules_variants = binding.active_rules_variants;
  snapshot.active_rules_extensions = binding.active_rules_extensions;
  return binding;
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

function evacuateOccupiedActors(
  snapshot,
  sourceRegistry,
  targetRegistry,
  packId,
  locationIds,
  occupied,
) {
  if (occupied.length === 0) return null;
  const policies = sourceRegistry.manifest?.pack_lifecycle?.unmount ?? [];
  const matches = policies.filter((policy) => policy.pack_id === packId);
  if (matches.length !== 1) {
    throw new Error(
      `cannot unmount ${packId}: actors ${occupied.map((actor) => actor.id).join(", ")} still occupy pack locations and no unique evacuation policy is available`,
    );
  }
  const policy = matches[0];
  const evacuation = policy.evacuation;
  if (
    sourceRegistry.manifest.pack_lifecycle.schema_version !== 1
      || evacuation?.mode !== "move_occupants"
      || !Number.isInteger(evacuation.destination_location_id)
  ) {
    throw new Error(`cannot unmount ${packId}: evacuation policy is malformed`);
  }
  const destinationId = evacuation.destination_location_id;
  const targetLocation = (targetRegistry.resources?.locations ?? [])
    .find((location) =>
      Number(location.id) === destinationId
        && location.pack_id === evacuation.destination_pack_id);
  if (
    !targetLocation
      || hasId(locationIds, destinationId)
      || evacuation.destination_location
        !== `${evacuation.destination_pack_id}:location/${destinationId}`
  ) {
    throw new Error(
      `cannot unmount ${packId}: evacuation destination ${evacuation.destination_location ?? destinationId} is not mounted in the target composition`,
    );
  }
  if (!(snapshot.world_locations ?? []).some((location) => Number(location.id) === destinationId)) {
    throw new Error(
      `cannot unmount ${packId}: evacuation destination location ${destinationId} is not active in the snapshot`,
    );
  }
  const occupiedActorIds = new Set(occupied.map((actor) => Number(actor.id)));
  const blockingEncounter = (snapshot.world_combat_encounters ?? []).find((encounter) =>
    hasId(locationIds, encounter.location_id)
      && (encounter.participants ?? [])
        .some((participant) => occupiedActorIds.has(Number(participant.actor_id))));
  if (blockingEncounter) {
    throw new Error(
      `cannot unmount ${packId}: evacuation cannot interrupt active encounter ${blockingEncounter.id ?? "unknown"}`,
    );
  }

  const movedItemIds = new Set();
  for (const item of snapshot.world_items ?? []) {
    if (occupiedActorIds.has(Number(item.holder_actor_id))) {
      movedItemIds.add(Number(item.id));
    }
  }
  let foundNestedItem = true;
  while (foundNestedItem) {
    foundNestedItem = false;
    for (const item of snapshot.world_items ?? []) {
      if (
        !movedItemIds.has(Number(item.id))
          && movedItemIds.has(Number(item.container_item_id))
      ) {
        movedItemIds.add(Number(item.id));
        foundNestedItem = true;
      }
    }
  }

  const actors = [...occupied]
    .sort((left, right) => Number(left.id) - Number(right.id))
    .map((actor) => ({
      actor_id: Number(actor.id),
      from_location_id: Number(actor.location_id),
      to_location_id: destinationId,
    }));
  for (const actor of occupied) actor.location_id = destinationId;
  for (const item of snapshot.world_items ?? []) {
    if (movedItemIds.has(Number(item.id))) item.location_id = destinationId;
  }
  return {
    mode: evacuation.mode,
    destination_location: evacuation.destination_location,
    destination_pack_id: evacuation.destination_pack_id,
    destination_location_id: destinationId,
    actors,
    moved_item_ids: [...movedItemIds].sort((left, right) => left - right),
  };
}

function frozenItemIds(snapshot, authoredItemIds, actorIds, locationIds) {
  const itemIds = new Set(authoredItemIds);
  let foundDependency = true;
  while (foundDependency) {
    foundDependency = false;
    for (const item of snapshot.world_items ?? []) {
      const itemId = Number(item.id);
      if (
        itemIds.has(itemId)
          || (!hasId(actorIds, item.holder_actor_id)
            && !hasId(locationIds, item.location_id)
            && !itemIds.has(Number(item.container_item_id)))
      ) {
        continue;
      }
      itemIds.add(itemId);
      foundDependency = true;
    }
  }
  return itemIds;
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
  if (snapshot.worldpack_bundle_hash !== sourceRegistry.manifest.bundle_hash) {
    throw new Error(
      `cannot unmount ${packId}: snapshot bundle does not match the source registry`,
    );
  }

  const migrated = structuredClone(snapshot);
  const sourceRules = registryRuleBinding(sourceRegistry);
  const mountState = packMountState(migrated, true);
  if (mountState.frozen[packId]) {
    throw new Error(`pack ${packId} is already soft-unmounted`);
  }

  const actorIds = packHandles(sourceRegistry, packId, "actor");
  const authoredItemIds = packHandles(sourceRegistry, packId, "item");
  const locationIds = packHandles(sourceRegistry, packId, "location");
  const occupied = (migrated.world_actors ?? [])
    .filter((actor) =>
      !hasId(actorIds, actor.id) && hasId(locationIds, actor.location_id));
  const evacuation = evacuateOccupiedActors(
    migrated,
    sourceRegistry,
    targetRegistry,
    packId,
    locationIds,
    occupied,
  );
  const itemIds = frozenItemIds(
    migrated,
    authoredItemIds,
    actorIds,
    locationIds,
  );

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
  const invalidatedOfferIds = invalidateMapValues(
    migrated.transfer_offers,
    (offer) =>
      (offer.status === undefined || offer.status === "pending")
        && (hasId(actorIds, offer.offered_by_actor_id)
          || hasId(actorIds, offer.offered_to_actor_id)
          || hasId(itemIds, offer.offered_item_id)
          || hasId(itemIds, offer.requested_item_id)),
    (offer) => {
      offer.status = "invalidated";
      delete offer.resolved_by_actor_id;
    },
  );
  const consumedGiftAutoAcceptIds = invalidateMapValues(
    migrated.gift_auto_accepts,
    (policy) =>
      !policy.consumed
        && (hasId(actorIds, policy.recipient_actor_id)
          || hasId(actorIds, policy.offered_by_actor_id)
          || hasId(itemIds, policy.item_id)),
    (policy) => {
      policy.consumed = true;
    },
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
    invalidated: {
      transfer_offer_ids: invalidatedOfferIds,
      gift_auto_accept_ids: consumedGiftAutoAcceptIds,
    },
    ...(evacuation ? { evacuation } : {}),
  };
  const stateHash = frozenStateHash(frozen);
  mountState.frozen[packId] = frozen;
  migrated.content_context = targetContentContext(
    migrated.content_context,
    targetRegistry,
    packId,
  );
  const targetRules = applyRegistryBinding(migrated, targetRegistry);
  const transaction = appendTransaction(mountState, {
    operation: "soft_unmount",
    pack_id: packId,
    pack_version: frozen.pack_version,
    source_bundle_hash: frozen.source_bundle_hash,
    target_bundle_hash: frozen.target_bundle_hash,
    source_rules: sourceRules,
    target_rules: targetRules,
    state_hash: stateHash,
    counts: removed,
    invalidated: {
      transfer_offers: invalidatedOfferIds.length,
      gift_auto_accepts: consumedGiftAutoAcceptIds.length,
    },
    ...(evacuation ? { evacuation } : {}),
  });

  return {
    snapshot: migrated,
    removed,
    evacuated: evacuation?.actors ?? [],
    transaction,
  };
}

export function migratePackRemount(snapshot, sourceRegistry, packId, targetRegistry) {
  if (registryHasPack(sourceRegistry, packId)) {
    throw new Error(`source registry already mounts pack ${packId}`);
  }
  if (!targetRegistry || !registryHasPack(targetRegistry, packId)) {
    throw new Error(`target registry does not mount pack ${packId}`);
  }
  if (snapshot.worldpack_bundle_hash !== sourceRegistry.manifest.bundle_hash) {
    throw new Error(
      `cannot remount ${packId}: snapshot bundle does not match the source registry`,
    );
  }
  const migrated = structuredClone(snapshot);
  const sourceRules = registryRuleBinding(sourceRegistry);
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
  const targetRules = applyRegistryBinding(migrated, targetRegistry);
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
    source_rules: sourceRules,
    target_rules: targetRules,
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

function writeWithJournalCheckpoint(eventDbPath, snapshot, output, value) {
  const checkpoint = snapshot.action_journal_seq ?? 0;
  if (!eventDbPath) {
    if (checkpoint !== 0) {
      throw new Error(
        "--event-db is required when the snapshot has an action-journal checkpoint",
      );
    }
    writeJsonAtomically(output, value);
    return null;
  }
  if (!Number.isSafeInteger(checkpoint) || checkpoint <= 0) {
    throw new Error(
      "snapshot action_journal_seq must be a positive safe integer when --event-db is supplied",
    );
  }

  const database = new Database(path.resolve(eventDbPath), {
    fileMustExist: true,
  });
  try {
    database.pragma("busy_timeout = 5000");
    return database.transaction(() => {
      const journalHead = Number(database
        .prepare("SELECT COALESCE(MAX(journal_seq), 0) FROM action_journal")
        .pluck()
        .get());
      if (checkpoint !== journalHead) {
        throw new Error(
          `snapshot action-journal checkpoint ${checkpoint} does not match journal head ${journalHead}`,
        );
      }
      const activeJobs = Number(database
        .prepare("SELECT COUNT(*) FROM actor_jobs WHERE status IN ('pending', 'running')")
        .pluck()
        .get());
      if (activeJobs !== 0) {
        throw new Error(
          `cannot migrate while ${activeJobs} actor job(s) are pending or running`,
        );
      }
      writeJsonAtomically(output, value);
      return checkpoint;
    }).immediate();
  } finally {
    database.close();
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
    const eventDbPath = option(args, "--event-db");
    const packId = option(args, "--pack");
    if (!input || !output || !registryPath || !targetPath || !packId
        || !["unmount", "remount"].includes(operation)) {
      throw new Error("usage: migrate-pack-unmount.mjs --operation unmount|remount --input snapshot.json --output migrated.json --registry source-registry.json --target-registry target-registry.json --pack PACK_ID [--event-db events.sqlite]");
    }
    const snapshot = JSON.parse(fs.readFileSync(path.resolve(input), "utf8"));
    const registry = JSON.parse(fs.readFileSync(path.resolve(registryPath), "utf8"));
    const target = JSON.parse(fs.readFileSync(path.resolve(targetPath), "utf8"));
    const result = operation === "unmount"
      ? migratePackUnmount(snapshot, registry, packId, target)
      : migratePackRemount(snapshot, registry, packId, target);
    const checkpoint = writeWithJournalCheckpoint(
      eventDbPath,
      snapshot,
      output,
      result.snapshot,
    );
    console.log(`${operation}ed ${packId}: ${JSON.stringify({
      counts: result.removed ?? result.restored,
      transaction: {
        sequence: result.transaction.sequence,
        status: result.transaction.status,
        state_hash: result.transaction.state_hash,
      },
      ...(result.evacuated?.length
        ? { evacuated_actor_ids: result.evacuated.map((entry) => entry.actor_id) }
        : {}),
      ...(checkpoint === null ? {} : { action_journal_seq: checkpoint }),
    })}`);
  } catch (error) {
    console.error(`pack mount migration failed: ${error.message}`);
    process.exit(1);
  }
}
