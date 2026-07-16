import crypto from "node:crypto";

export const CONTENT_REFERENCE_SCHEMA_VERSION = 1;
export const FIRST_GENERATED_RUNTIME_HANDLE = 1_000_000_000_000;
const LAST_RUNTIME_HANDLE = Number.MAX_SAFE_INTEGER;
const GENERATED_HANDLE_COUNT = BigInt(LAST_RUNTIME_HANDLE - FIRST_GENERATED_RUNTIME_HANDLE + 1);
const PACK_ID = /^[a-z0-9][a-z0-9.-]*$/;
const CONTENT_KIND = /^[a-z][a-z0-9-]*$/;

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function encodedLocalId(localId) {
  const value = String(localId);
  assert(value.length > 0, "content reference local id must not be empty");
  return encodeURIComponent(value);
}

export function canonicalContentReference(packId, kind, localId) {
  assert(PACK_ID.test(packId), `invalid content reference pack id ${packId}`);
  assert(CONTENT_KIND.test(kind), `invalid content reference kind ${kind}`);
  return `pack://${packId}/${kind}/${encodedLocalId(localId)}`;
}

export function parseCanonicalContentReference(reference) {
  assert(typeof reference === "string" && reference.startsWith("pack://"), `invalid canonical content reference ${reference}`);
  const match = /^pack:\/\/([^/]+)\/([^/]+)\/([^/]+)$/.exec(reference);
  assert(match && PACK_ID.test(match[1]) && CONTENT_KIND.test(match[2]), `invalid canonical content reference ${reference}`);
  let localId;
  try {
    localId = decodeURIComponent(match[3]);
  } catch {
    throw new Error(`invalid canonical content reference ${reference}`);
  }
  assert(localId.length > 0 && encodedLocalId(localId) === match[3], `non-canonical content reference ${reference}`);
  return { pack_id: match[1], kind: match[2], local_id: localId };
}

function generatedHandle(reference, attempt) {
  const digest = crypto.createHash("sha256").update(reference).update("\0").update(String(attempt)).digest();
  const sample = digest.readBigUInt64BE(0);
  return Number(BigInt(FIRST_GENERATED_RUNTIME_HANDLE) + (sample % GENERATED_HANDLE_COUNT));
}

export function buildContentReferenceMapping(candidates, mappingVersion, options = {}) {
  assert(Number.isInteger(mappingVersion) && mappingVersion > 0, "content reference mapping version must be positive");
  const entries = candidates.map((candidate) => {
    const canonicalRef = canonicalContentReference(candidate.pack_id, candidate.kind, candidate.local_id);
    assert(typeof candidate.pack_version === "string" && candidate.pack_version.length > 0, `${canonicalRef} has no pack version`);
    if (candidate.legacy_runtime_id !== undefined) {
      assert(Number.isSafeInteger(candidate.legacy_runtime_id) && candidate.legacy_runtime_id > 0, `${canonicalRef} has invalid legacy runtime id`);
    }
    return {
      canonical_ref: canonicalRef,
      pack_id: candidate.pack_id,
      pack_version: candidate.pack_version,
      kind: candidate.kind,
      local_id: String(candidate.local_id),
      ...(candidate.legacy_runtime_id === undefined ? {} : { legacy_runtime_id: candidate.legacy_runtime_id }),
    };
  }).sort((left, right) => left.canonical_ref.localeCompare(right.canonical_ref));

  const canonicalRefs = new Set();
  const claimedHandles = new Map();
  for (const entry of entries) {
    assert(!canonicalRefs.has(entry.canonical_ref), `duplicate canonical content reference ${entry.canonical_ref}`);
    canonicalRefs.add(entry.canonical_ref);
    if (entry.legacy_runtime_id === undefined) continue;
    const collision = claimedHandles.get(entry.legacy_runtime_id);
    assert(!collision, `runtime handle ${entry.legacy_runtime_id} collides between ${collision} and ${entry.canonical_ref}`);
    claimedHandles.set(entry.legacy_runtime_id, entry.canonical_ref);
    entry.runtime_handle = entry.legacy_runtime_id;
  }
  for (const entry of entries) {
    if (entry.runtime_handle !== undefined) continue;
    let runtimeHandle;
    let attempt = 0;
    do {
      runtimeHandle = (options.generatedHandle ?? generatedHandle)(entry.canonical_ref, attempt);
      assert(Number.isSafeInteger(runtimeHandle) && runtimeHandle >= FIRST_GENERATED_RUNTIME_HANDLE, `${entry.canonical_ref} generated invalid runtime handle ${runtimeHandle}`);
      attempt += 1;
    } while (claimedHandles.has(runtimeHandle));
    claimedHandles.set(runtimeHandle, entry.canonical_ref);
    entry.runtime_handle = runtimeHandle;
  }

  return {
    schema_version: CONTENT_REFERENCE_SCHEMA_VERSION,
    mapping_version: mappingVersion,
    entries,
  };
}

const resourceIdentities = new Map([
  ["actors", { kind: "actor", identity: "id", legacy: true }],
  ["actor_facets", { kind: "actor-facet", identity: "id" }],
  ["items", { kind: "item", identity: "id", legacy: true }],
  ["locations", { kind: "location", identity: "id", legacy: true }],
  ["factions", { kind: "faction", identity: "id" }],
  ["hidden_exits", { kind: "hidden-exit", identity: "id" }],
  ["room_sheets", { kind: "room-sheet", identity: "id" }],
  ["clocks", { kind: "clock", identity: "id" }],
  ["jobs", { kind: "job", identity: "id" }],
  ["fronts", { kind: "front", identity: "id" }],
  ["cards", { kind: "card", identity: "card_id" }],
  ["card_bindings", { kind: "card-binding", identity: "id" }],
  ["recipes", { kind: "recipe", identity: "id" }],
]);

export function collectContentReferenceCandidates({ resources, packs, externalCards = [], ruleBundles = [], characterCreationBundles = [] }) {
  const versions = new Map(packs.map((pack) => [pack.id, pack.version]));
  const candidates = [];
  const add = (packId, kind, localId, legacyRuntimeId) => {
    assert(versions.has(packId), `content reference belongs to unknown pack ${packId}`);
    candidates.push({
      pack_id: packId,
      pack_version: versions.get(packId),
      kind,
      local_id: localId,
      ...(legacyRuntimeId === undefined ? {} : { legacy_runtime_id: legacyRuntimeId }),
    });
  };

  for (const [resource, descriptor] of resourceIdentities) {
    for (const row of resources[resource] ?? []) {
      const localId = row[descriptor.identity];
      assert(localId !== undefined && localId !== null && String(localId).length > 0, `${resource} row has no ${descriptor.identity}`);
      add(row.pack_id, descriptor.kind, localId, descriptor.legacy ? localId : undefined);
    }
  }
  for (const card of externalCards) add(card.pack_id, "external-card", card.card_id);
  for (const bundle of ruleBundles) {
    for (const [resource, rows] of Object.entries(bundle.resources)) {
      const kind = resource === "monster_seeds" ? "creature" : resource.replaceAll("_", "-").replace(/s$/, "");
      for (const row of rows) {
        const localId = row.id ?? row.slug ?? row.name;
        assert(localId !== undefined && localId !== null && String(localId).length > 0, `rules resource ${resource} row has no id, slug, or name`);
        add(bundle.pack_id, kind, localId);
      }
    }
  }
  for (const bundle of characterCreationBundles) {
    for (const profile of bundle.profiles) add(bundle.pack_id, "character-profile", profile.id);
  }
  return candidates;
}
