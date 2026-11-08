// Compile the card table's world packs and their bridges into one runtime file.
//
//   node v2/scripts/build-card-worldpacks.mjs          # write card-game/packs.json
//   node v2/scripts/build-card-worldpacks.mjs --check  # fail if it is stale or invalid
//
// Sources: v2/worlds/card-table.json lists the hub and the mounted packs.
// Each pack reads v2/content/<id>/card-world.json (the reusable world) and
// v2/worlds/<id>/card-bridge.json (how it joins the hub). The browser and the
// Rust text route both read the compiled file, so they cannot drift apart.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  packProblems,
  observationProblems,
  packCompositionProblems,
} from "../card-game/pack-schema.mjs";

const v2 = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const output = path.join(v2, "card-game/packs.json");
const owns = (o, key) => Object.hasOwn(o || {}, key);
const read = (file) => JSON.parse(fs.readFileSync(path.join(v2, file), "utf8"));
const check = process.argv.includes("--check");

const table = read("worlds/card-table.json");
const problems = [];
problems.push(...observationProblems(table.hub?.observations, table.hub));
if (
  table.schemaVersion !== 1 ||
  !Array.isArray(table.packs) ||
  new Set(table.packs).size !== table.packs.length
)
  problems.push("card-table.json needs schemaVersion 1 and distinct packs");

const bridgeEntries = {};
const packs = (table.packs || []).map((id) => {
  const source = read(`content/${id}/card-world.json`);
  const bridge = read(`worlds/${id}/card-bridge.json`);
  if (source.id !== id) problems.push(`${id}: source id must match its folder`);
  if (bridge.schemaVersion !== 1 || bridge.pack !== id)
    problems.push(`${id}: bridge needs schemaVersion 1 and pack "${id}"`);
  const {
    schemaVersion: _s,
    pack: _p,
    id: bridgeId,
    description,
    entries,
    ...joins
  } = bridge;
  bridgeEntries[id] = entries;
  const unknown = Object.keys(joins).filter(
    (key) => !["values", "crossings", "transports"].includes(key),
  );
  if (unknown.length)
    problems.push(`${id}: bridge has unknown fields ${unknown.join(", ")}`);
  return {
    ...source,
    bridge: { id: bridgeId, description },
    ...joins,
  };
});

// Store packs: third-party worldpacks admitted by build-card-store.mjs.
// The vendor manifest is bound to the verified store index by that gate (it
// is compared field-by-field in check mode); here admitted packs only join
// the compile, through the same destructure and checks as in-tree packs.
const vendorManifestPath = path.join(v2, "worldpacks/vendor-manifest.json");
if (fs.existsSync(vendorManifestPath)) {
  const vendors = JSON.parse(fs.readFileSync(vendorManifestPath, "utf8"));
  if (vendors?.schemaVersion !== 1 || !Array.isArray(vendors.packs))
    problems.push("vendor-manifest.json needs schemaVersion 1 and a packs list");
  const inTree = new Set(table.packs);
  for (const v of vendors?.packs || []) {
    if (inTree.has(v.id)) continue; // an in-tree pack with the same id wins
    if (v.mounted === false) continue; // verified but not selected
    const source = read(`worldpacks/${v.id}/card-world.json`);
    const bridge = read(`worldpacks/${v.id}/card-bridge.json`);
    if (source.id !== v.id) problems.push(`${v.id}: source id must match its store entry`);
    if (bridge.schemaVersion !== 1 || bridge.pack !== v.id)
      problems.push(`${v.id}: bridge needs schemaVersion 1 and pack "${v.id}"`);
    const {
      schemaVersion: _sv,
      pack: _pk,
      id: bridgeIdV,
      description: descriptionV,
      entries: entriesV,
      ...joinsV
    } = bridge;
    bridgeEntries[v.id] = entriesV;
    const unknownV = Object.keys(joinsV).filter(
      (key) => !["values", "crossings", "transports"].includes(key),
    );
    if (unknownV.length)
      problems.push(`${v.id}: bridge has unknown fields ${unknownV.join(", ")}`);
    packs.push({
      ...source,
      bridge: { id: bridgeIdV, description: descriptionV },
      ...joinsV,
    });
  }
}

const seen = new Map();
problems.push(...packCompositionProblems(packs));
const observationIds = new Set((table.hub.observations || []).map((d) => d.id));
for (const pack of packs) {
  for (const d of pack.observations || []) {
    if (observationIds.has(d.id))
      problems.push(`duplicate observation ${d.id}`);
    observationIds.add(d.id);
  }
  problems.push(
    ...packProblems(
      pack,
      table.hub,
      packs.flatMap((p) => Object.keys(p.places)),
      packs.flatMap((p) => Object.keys(p.items || {})),
    ),
  );
  for (const id of [
    ...Object.keys(pack.places || {}),
    ...Object.keys(pack.avatars || {}),
    ...Object.keys(pack.fixtures || {}),
    ...Object.keys(pack.items || {}),
    ...(pack.crossings || []).map((c) => `crossing:${c.id}`),
    ...Object.keys(pack.transports || {}).map((id) => `transport:${id}`),
    // One crossing per direction between two places, across every pack.
    ...(pack.crossings || []).map((c) => `route:${c.from}->${c.to}`),
  ]) {
    if (seen.has(id))
      problems.push(`${pack.id}: ${id} is also defined by ${seen.get(id)}`);
    seen.set(id, pack.id);
  }
  // Media must exist and match its extension, since the table serves it verbatim.
  const media = [
    ...Object.values(pack.places || {}).flatMap((p) => [p.backdrop, p.art]),
    ...Object.values(pack.places || {}).flatMap((p) =>
      (Array.isArray(p.music) ? p.music : []).map(
        (track) => `assets/music/${track?.file}`,
      ),
    ),
    ...Object.values(pack.items || {}).map((i) => i.art),
    ...(pack.crossings || []).flatMap((c) => [
      c.scenery?.overlay,
      c.scenery?.backdrop,
      c.scenery?.cardArt,
    ]),
    ...Object.values(pack.avatars || {}).flatMap((a) => [
      a.portrait,
      ...(Array.isArray(a.poses) ? a.poses : []).map((p) => p?.portrait),
      ...Object.values(a.variants || {}).map((v) => v.portrait),
    ]),
  ].filter(Boolean);
  for (const file of new Set(media)) {
    const full = path.join(v2, "card-game", file);
    const bytes = fs.existsSync(full) ? fs.readFileSync(full) : null;
    if (
      !bytes ||
      bytes.length < 24 ||
      !(file.endsWith(".png")
        ? bytes.subarray(0, 8).equals(Buffer.from("89504e470d0a1a0a", "hex"))
        : file.endsWith(".webp")
          ? bytes.toString("ascii", 0, 4) === "RIFF" &&
            bytes.toString("ascii", 8, 12) === "WEBP"
          : file.endsWith(".mp3")
            ? bytes.toString("ascii", 0, 3) === "ID3"
            : file.endsWith(".svg") && /<svg\s/.test(bytes.toString("utf8")))
    )
      problems.push(`${pack.id}: missing or invalid media ${file}`);
  }
}

// Entries: each pack's ways in, as `{joins, at, arrive, via}`. `joins` is
// the hub or another pack, `at` its place where this pack's travelers come
// out, `arrive` this pack's place where they enter, and `via` the existing
// crossing between the two, so passage keeps one source of truth. Every
// place is in the pack's release. The hub declares its `start` and the
// switchable groups. The rules read the entries from the hub
// (`packEntries`), so no pack schema changes (v2/docs/card-packs.md).
const hub = table.hub || {};
const sides = {
  hub: { places: Object.fromEntries((hub.places || []).map((id) => [id, {}])) },
};
for (const pack of packs) sides[pack.id] = pack;
const released = (side, place) =>
  owns(side?.places, place) &&
  (!side.release || side.release.places.includes(place));
const crossing = (e) =>
  packs.some((p) =>
    (p.crossings || []).some(
      (c) =>
        c.id === e.via &&
        !c.retired &&
        [c.from, c.to].sort().join() === [e.at, e.arrive].sort().join(),
    ),
  );
for (const pack of packs) {
  const list = bridgeEntries[pack.id];
  if (
    !Array.isArray(list) ||
    !list.length ||
    !list.every(
      (e) =>
        Object.keys(e).join() === "joins,at,arrive,via" &&
        e.joins !== pack.id &&
        released(sides[e.joins], e.at) &&
        released(pack, e.arrive) &&
        crossing(e),
    )
  )
    problems.push(
      `${pack.id}: entries must name released places and a live crossing`,
    );
}
const groups = Object.values(hub.switchable || {});
if (
  !released(sides.hub, hub.start) ||
  !groups.length ||
  !groups.every(
    (g) =>
      typeof g?.name === "string" &&
      (g.reachedBy === undefined ||
        (hub.switchable[g.reachedBy] && hub.switchable[g.reachedBy] !== g)) &&
      g.packs?.length &&
      g.packs.every((id) => sides[id]),
  ) ||
  new Set(groups.flatMap((g) => g.packs)).size !==
    groups.flatMap((g) => g.packs).length
)
  problems.push("the hub needs a start and switchable groups of known packs");

if (problems.length) {
  console.error(`Card world packs are invalid:\n- ${problems.join("\n- ")}`);
  process.exit(1);
}
const compiled = `${JSON.stringify(
  {
    schemaVersion: 1,
    hub: { ...table.hub, packEntries: bridgeEntries },
    packs,
  },
  null,
  2,
)}\n`;
if (check) {
  // Compare data rather than bytes, so reformatting the file is not staleness.
  let current = null;
  try {
    current = JSON.stringify(JSON.parse(fs.readFileSync(output, "utf8")));
  } catch {
    current = null;
  }
  if (current !== JSON.stringify(JSON.parse(compiled))) {
    console.error(
      "v2/card-game/packs.json is stale. Run node v2/scripts/build-card-worldpacks.mjs.",
    );
    process.exit(1);
  }
  console.log(`Card world packs are current: ${packs.map((pk) => pk.id).join(", ")}.`);
} else {
  fs.writeFileSync(output, compiled);
  console.log(`Wrote v2/card-game/packs.json: ${packs.map((pk) => pk.id).join(", ")}.`);
}
