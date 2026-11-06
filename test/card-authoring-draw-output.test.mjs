import { expect, it, vi } from "vitest";
import { prepareAcceptedAvatars } from "../v2/card-game/authoring-draw-output.mjs";
import { createAuthoringSession } from "../v2/card-game/authoring-session.mjs";
import { importPack } from "../v2/card-game/authoring-draft.mjs";
import { packDefinition } from "../v2/card-game/pack-registry.mjs";

const record = () => ({
  key: "world",
  generation: 0,
  draft: importPack({ pack: packDefinition("badger-forest") }),
  assets: new Map(),
  launch: null,
});
const request = (n) => ({
  candidateId: `12345678-1234-4234-8234-${String(n).padStart(12, "0")}`,
  revision: 1,
  accepted: {
    name: `Guide ${n}`,
    specialAbility: "Finds lost things",
    description: "A patient guide.",
    aliases: [],
    suggested: true,
  },
  images: [],
});

it("keeps six avatars in one write and one Undo, with an exact retry after failure", async () => {
  let disk = record();
  const write = vi.fn(async (key, value, generation, assets) => {
    expect(generation).toBe(disk.generation);
    disk = {
      ...structuredClone(value),
      key,
      generation: generation + 1,
      assets: structuredClone(assets ?? disk.assets),
    };
    return disk.generation;
  });
  const session = createAuthoringSession({ store: { write } });
  session.open({ key: disk.key, record: disk });
  const before = session.snapshot({ assets: true });
  const prepared = await prepareAcceptedAvatars(
    before,
    Array.from({ length: 6 }, (_, i) => request(i)),
  );
  expect(prepared.ids).toHaveLength(6);
  expect(prepared.assets).toHaveLength(6);
  expect(session.snapshot({ assets: true })).toEqual(before);
  write.mockRejectedValueOnce(new Error("Storage full"));
  await expect(session.run((ctx) => ctx.accept(prepared))).rejects.toThrow(
    "Storage full",
  );
  expect(session.snapshot({ assets: true })).toEqual(before);
  expect(session.state.undo).toHaveLength(0);
  await session.run((ctx) => ctx.accept(prepared));
  expect(disk.generation).toBe(1);
  expect(disk.assets).toEqual(prepared.bytes);
  expect(session.state.undo).toHaveLength(1);
  for (const id of prepared.ids)
    expect(disk.draft.pack.avatars[id]).toBeTruthy();
  session.dispatch({ type: "undo" });
  await session.save();
  expect(disk.draft.pack).toEqual(before.draft.pack);
  expect(disk.assets).toEqual(prepared.bytes);
});

it("checks selection identity and the combined asset limit before any write", async () => {
  const before = record();
  for (const requests of [
    [],
    Array(7).fill(request(1)),
    [request(1), request(1)],
  ])
    await expect(prepareAcceptedAvatars(before, requests)).rejects.toThrow();
  const bad = request(2);
  bad.accepted.name = "";
  await expect(
    prepareAcceptedAvatars(before, [request(1), bad]),
  ).rejects.toThrow();
  expect(before.assets.size).toBe(0);
  const sha256 =
    "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";
  for (let i = 0; i < 507; i++) {
    const path = `assets/badger-forest/note-${i}.txt`;
    before.draft.assets.push({ path, mime: "text/plain", sha256, size: 0 });
    before.assets.set(path, new Uint8Array());
  }
  await expect(
    prepareAcceptedAvatars(
      before,
      Array.from({ length: 6 }, (_, i) => request(i)),
    ),
  ).rejects.toThrow(/512 assets/);
  expect(before.draft.assets).toHaveLength(507);
});
