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
  questFromData,
} from "../card-game/pack-schema.mjs";

const v2 = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const output = path.join(v2, "card-game/packs.json");
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
    ...joins
  } = bridge;
  const unknown = Object.keys(joins).filter(
    (key) => !["values", "crossings", "transports"].includes(key),
  );
  if (unknown.length)
    problems.push(`${id}: bridge has unknown fields ${unknown.join(", ")}`);
  // Starter quests compile to the composed shape: a verb and its targets.
  for (const avatar of Object.values(source.avatars || {}))
    if (avatar.want?.kind !== undefined)
      avatar.want = questFromData(avatar.want);
  return {
    ...source,
    bridge: { id: bridgeId, description },
    ...joins,
  };
});

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

if (problems.length) {
  console.error(`Card world packs are invalid:\n- ${problems.join("\n- ")}`);
  process.exit(1);
}
const compiled = `${JSON.stringify(
  { schemaVersion: 1, hub: table.hub, packs },
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
  console.log(`Card world packs are current: ${table.packs.join(", ")}.`);
} else {
  fs.writeFileSync(output, compiled);
  console.log(`Wrote v2/card-game/packs.json: ${table.packs.join(", ")}.`);
}
