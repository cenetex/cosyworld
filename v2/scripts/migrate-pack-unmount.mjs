#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

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

function deleteMapKeys(map, keys) {
  if (!map || Array.isArray(map) || typeof map !== "object") return 0;
  let removed = 0;
  for (const key of keys) {
    if (Object.hasOwn(map, String(key))) {
      delete map[String(key)];
      removed += 1;
    }
  }
  return removed;
}

function deleteMapValues(map, predicate) {
  if (!map || Array.isArray(map) || typeof map !== "object") return 0;
  let removed = 0;
  for (const [key, value] of Object.entries(map)) {
    if (predicate(value, key)) {
      delete map[key];
      removed += 1;
    }
  }
  return removed;
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

export function migratePackUnmount(snapshot, sourceRegistry, packId, targetRegistry = null) {
  if (!(sourceRegistry.manifest?.packs ?? []).some((pack) => pack.id === packId)) {
    throw new Error(`pack ${packId} is not mounted in the source registry`);
  }
  if ((targetRegistry?.manifest?.packs ?? []).some((pack) => pack.id === packId)) {
    throw new Error(`target registry still mounts pack ${packId}`);
  }
  const actorIds = packHandles(sourceRegistry, packId, "actor");
  const itemIds = packHandles(sourceRegistry, packId, "item");
  const locationIds = packHandles(sourceRegistry, packId, "location");
  const occupied = (snapshot.world_actors ?? []).filter((actor) => actor.kind === 1 && locationIds.has(actor.location_id));
  if (occupied.length > 0) {
    throw new Error(`cannot unmount ${packId}: human actors ${occupied.map((actor) => actor.id).join(", ")} still occupy pack locations`);
  }

  const before = {
    actors: snapshot.world_actors?.length ?? 0,
    items: snapshot.world_items?.length ?? 0,
    locations: snapshot.world_locations?.length ?? 0,
    exits: snapshot.world_exits?.length ?? 0,
  };
  snapshot.world_actors = (snapshot.world_actors ?? []).filter((actor) => !actorIds.has(actor.id));
  snapshot.world_items = (snapshot.world_items ?? []).filter((item) => !itemIds.has(item.id));
  snapshot.world_locations = (snapshot.world_locations ?? []).filter((location) => !locationIds.has(location.id));
  snapshot.world_exits = (snapshot.world_exits ?? []).filter((exit) => !locationIds.has(exit.from_location_id) && !locationIds.has(exit.to_location_id));
  snapshot.world_evolution_tracks = (snapshot.world_evolution_tracks ?? []).filter((track) => !actorIds.has(track.actor_id));
  snapshot.world_combat_encounters = (snapshot.world_combat_encounters ?? []).filter((encounter) =>
    !locationIds.has(encounter.location_id)
      && !(encounter.participants ?? []).some((participant) => actorIds.has(participant.actor_id)));

  for (const field of ["actor_meta", "actor_autonomy", "callings", "orb_balances"]) deleteMapKeys(snapshot[field], actorIds);
  for (const field of ["item_meta"]) deleteMapKeys(snapshot[field], itemIds);
  for (const field of ["location_names", "location_meta", "room_sheets"]) deleteMapKeys(snapshot[field], locationIds);
  deleteMapKeys(snapshot.clocks, packResourceIds(sourceRegistry, packId, "clocks"));
  deleteMapKeys(snapshot.jobs, packResourceIds(sourceRegistry, packId, "jobs"));
  deleteMapKeys(snapshot.world_simulation?.locations, locationIds);
  deleteMapKeys(snapshot.world_simulation?.factions, packResourceIds(sourceRegistry, packId, "factions"));

  deleteMapValues(snapshot.branches, (branch) => actorIds.has(branch.actor_id) || actorIds.has(branch.target_actor_id));
  deleteMapValues(snapshot.generated_pathways, (pathway) =>
    locationIds.has(pathway.origin_location_id) || locationIds.has(pathway.destination_location_id));
  deleteMapValues(snapshot.journeys, (journey) =>
    actorIds.has(journey.actor_id)
      || locationIds.has(journey.origin_location_id)
      || locationIds.has(journey.destination_location_id)
      || (journey.path ?? []).some((locationId) => locationIds.has(locationId)));
  for (const field of ["skills", "ledger_marks", "advancement_spends"]) {
    deleteMapValues(snapshot[field], (entry) => actorIds.has(entry.actor_id));
  }
  deleteMapValues(snapshot.bonds, (bond) => actorIds.has(bond.actor_id) || actorIds.has(bond.target_actor_id));
  deleteMapValues(snapshot.resident_continuities, (continuity) => actorIds.has(continuity.resident_id));
  deleteMapValues(snapshot.resident_memories, (memory) =>
    actorIds.has(memory.carrier_actor_id)
      || actorIds.has(memory.source_actor_id)
      || actorIds.has(memory.holder_actor_id)
      || locationIds.has(memory.location_id)
      || (memory.kind === "actor" && actorIds.has(memory.subject_id))
      || (memory.kind === "item" && itemIds.has(memory.subject_id)));
  deleteMapValues(snapshot.search_memories, (memory) =>
    actorIds.has(memory.actor_id)
      || locationIds.has(memory.location_id)
      || (memory.kind === "actor" && actorIds.has(memory.subject_id))
      || (memory.kind === "item" && itemIds.has(memory.subject_id))
      || (memory.kind === "location" && locationIds.has(memory.subject_id)));
  deleteMapValues(snapshot.tags, (tag) =>
    actorIds.has(tag.scope_id) || itemIds.has(tag.scope_id) || locationIds.has(tag.scope_id));

  if (snapshot.content_context) {
    snapshot.content_context.references = (snapshot.content_context.references ?? [])
      .filter((reference) => reference.pack_id !== packId);
    if (targetRegistry) {
      snapshot.content_context.mapping_version = targetRegistry.content_references.mapping_version;
      snapshot.content_context.active_rulesets = targetRulesets(targetRegistry);
    }
  }
  if (targetRegistry) snapshot.worldpack_bundle_hash = targetRegistry.manifest.bundle_hash;

  return {
    snapshot,
    removed: {
      actors: before.actors - snapshot.world_actors.length,
      items: before.items - snapshot.world_items.length,
      locations: before.locations - snapshot.world_locations.length,
      exits: before.exits - snapshot.world_exits.length,
    },
  };
}

function option(args, name) {
  const index = args.indexOf(name);
  return index < 0 ? undefined : args[index + 1];
}

const scriptPath = fileURLToPath(import.meta.url);
if (process.argv[1] && path.resolve(process.argv[1]) === scriptPath) {
  try {
    const args = process.argv.slice(2);
    const input = option(args, "--input");
    const output = option(args, "--output");
    const registryPath = option(args, "--registry");
    const targetPath = option(args, "--target-registry");
    const packId = option(args, "--pack");
    if (!input || !output || !registryPath || !packId) {
      throw new Error("usage: migrate-pack-unmount.mjs --input snapshot.json --output migrated.json --registry source-registry.json --pack PACK_ID [--target-registry registry.json]");
    }
    const snapshot = JSON.parse(fs.readFileSync(path.resolve(input), "utf8"));
    const registry = JSON.parse(fs.readFileSync(path.resolve(registryPath), "utf8"));
    const target = targetPath ? JSON.parse(fs.readFileSync(path.resolve(targetPath), "utf8")) : null;
    const result = migratePackUnmount(snapshot, registry, packId, target);
    fs.writeFileSync(path.resolve(output), `${JSON.stringify(result.snapshot, null, 2)}\n`);
    console.log(`unmounted ${packId}: ${JSON.stringify(result.removed)}`);
  } catch (error) {
    console.error(`pack unmount migration failed: ${error.message}`);
    process.exit(1);
  }
}
