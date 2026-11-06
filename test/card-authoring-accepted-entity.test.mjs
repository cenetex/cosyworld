import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { importPack } from "../v2/card-game/authoring-draft.mjs";
import { applySourceEdit } from "../v2/card-game/authoring-edits.mjs";
import { mediaPathOk } from "../v2/card-game/pack-schema.mjs";
import {
  acceptedEntityImageTarget as target,
  prepareAcceptedEntity as prepare,
  nextAcceptedEntityRevision as revision,
} from "../v2/card-game/authoring-accepted-entity.mjs";
const read = (path) => JSON.parse(readFileSync(new URL(path, import.meta.url)));
const record = () => ({
  key: "world",
  generation: 0,
  draft: importPack({
    pack: read("../v2/content/greek-drama/card-world.json"),
    bridge: read("../v2/worlds/greek-drama/card-bridge.json"),
  }),
  launch: { schemaVersion: 1, place: "greek-ship" },
  assets: new Map(),
});
const request = (kind, targetId) => ({
  kind,
  targetId,
  candidateId: "12345678-1234-4234-8234-123456789abc",
  revision: 1,
  accepted: { name: "Design", description: "Reviewed.", aliases: [] },
  image: null,
});
const source = (r) => ({
  pack: r.draft.pack,
  bridge: r.draft.bridge,
  launch: r.launch,
});
const image = { mime: "image/png", bytes: new Uint8Array([1, 2, 3]) };
const rejects = (promise, message) => expect(promise).rejects.toThrow(message);
const picture = async (r, kind, id, field, index) => ({
  ...request(kind, id),
  image,
  imageTarget: await target(r, kind, id, field, index),
});
function adopt(r, p) {
  const next = structuredClone(r);
  const { pack, bridge, launch } = applySourceEdit(source(r), p.edit).source;
  Object.assign(next.draft, { pack, bridge });
  next.launch = launch;
  next.draft.assets.push(...p.assets);
  for (const [path, bytes] of p.bytes) next.assets.set(path, bytes);
  return next;
}

it("changes one Charybdis conditional picture and preserves its full source and Undo", async () => {
  const r = record(),
    id = "greek-ship",
    old = structuredClone(source(r));
  const q = await picture(r, "location", id, "backdrops", 0);
  const p = await prepare(r, q),
    next = adopt(r, p),
    ship = structuredClone(old.pack.places[id]);
  ship.name = q.accepted.name;
  ship.text = q.accepted.description;
  ship.backdrops[0].backdrop = next.draft.pack.places[id].backdrops[0].backdrop;
  expect(next.draft.pack.places[id]).toEqual(ship);
  expect({ ...next.draft.pack, places: old.pack.places }).toEqual(old.pack);
  expect(next.draft.bridge).toEqual(old.bridge);
  expect(next.launch).toEqual(old.launch);
  const applied = applySourceEdit(old, p.edit);
  expect(applySourceEdit(applied.source, applied.undo).source).toEqual(old);
  expect(source(r)).toEqual(old);
});

it("checks the exact entity and conditional entry before accepting an image", async () => {
  const r = record(),
    id = "greek-ship",
    q = await picture(r, "location", id, "backdrops", 0);
  for (const edit of [
    (p) => p.backdrops.reverse(),
    (p) => p.backdrops[0].requires.pop(),
    (p) => {
      p.future = { kept: true };
    },
  ]) {
    const changed = structuredClone(r);
    edit(changed.draft.pack.places[id]);
    await rejects(prepare(changed, q), /target changed/);
  }
  await rejects(target(r, "location", id, "backdrops", 9), /conditional/);
  const wrong = target(r, "item", "greek-creon-writ", "backdrop");
  await rejects(wrong, /image field/);
  q.accepted.prompt = "private";
  await rejects(prepare(r, q), /approved/);
});

it("keeps item custody, future fields and image paths through text edits and retained Undo", async () => {
  const r = record(),
    id = "greek-creon-writ",
    old = r.draft.pack.items[id];
  old.future = { rules: ["keep exact"] };
  const q = await picture(r, "item", id, "art");
  const one = adopt(r, await prepare(r, q));
  expect(one.draft.pack.items[id]).toEqual({
    ...old,
    name: q.accepted.name,
    text: q.accepted.description,
    art: one.draft.pack.items[id].art,
  });
  const otherRequest = await picture(one, "item", "greek-bread", "art");
  const other = await prepare(one, otherRequest);
  expect(other.assets[0].path).not.toBe(one.draft.pack.items[id].art);
  one.draft.pack.items[id].future.rules.push("manual edit");
  const two = adopt(
    one,
    await prepare(one, { ...request("item", id), revision: 2 }),
  );
  expect(two.draft.pack.items[id]).toEqual(one.draft.pack.items[id]);
  expect(two.assets.size).toBe(3);
  two.draft.pack.items[id] = structuredClone(old);
  expect(revision(two, "item", id)).toBe(3);
  await rejects(prepare(two, { ...q, revision: 2 }), /revision/);
  const moved = { ...request("item", id), holder: "greek-ship" };
  await rejects(prepare(r, moved), /open box/);
});

it.each(["location", "item"])(
  "creates an unfinished %s with stable identity and approved output only",
  async (kind) => {
    const r = record(),
      q = request(kind);
    q.image = image;
    q.imageTarget = { field: kind === "item" ? "art" : "backdrop" };
    if (kind === "item") q.holder = "greek-shipmaster";
    const p = await prepare(r, q),
      next = adopt(r, p),
      group = kind === "item" ? "items" : "places";
    expect(next.draft.pack[group][p.id]).toEqual({
      persona: q.accepted.description,
      ...(kind === "item" ? { holder: q.holder } : { exits: [] }),
      name: q.accepted.name,
      text: q.accepted.description,
      [q.imageTarget.field]: p.assets[0].path,
    });
    expect(mediaPathOk(r.draft.pack.id, p.assets[0].path)).toBe(true);
    expect(next.launch).toEqual(r.launch);
    expect(next.draft.pack.entry).toBe(r.draft.pack.entry);
    expect(next.draft.bridge).toEqual(r.draft.bridge);
    const output = JSON.parse(
      new TextDecoder().decode(p.bytes.get(p.assets[1].path)),
    );
    expect(output.accepted).toEqual(q.accepted);
    expect(output.visual.target).toEqual(q.imageTarget);
    expect(r.draft.pack[group][p.id]).toBeUndefined();
  },
);
