import { expect, it } from "vitest";
import pack from "../v2/content/badger-forest/card-world.json" with { type: "json" };
import { importPack } from "../v2/card-game/authoring-draft.mjs";
import { applySourceEdit } from "../v2/card-game/authoring-edits.mjs";
import {
  prepareAcceptedAvatar,
  adoptAcceptedAvatar,
  acceptedAvatarOutput,
} from "../v2/card-game/authoring-accepted.mjs";
const candidateId = "12345678-1234-4234-8234-123456789abc";
const request = () => ({
  candidateId,
  revision: 1,
  accepted: {
    name: "Lumi",
    specialAbility: "Hears quiet bells",
    aliases: ["Lightkeeper"],
    description: "A patient lightkeeper in a blue coat.",
    suggested: true,
  },
  images: [],
});
const record = () => ({
  key: "world",
  generation: 0,
  draft: importPack({ pack }),
  launch: { schemaVersion: 1, place: pack.entry },
  assets: new Map(),
});

it("accepts a stable avatar and restores its exact source with Undo", async () => {
  const before = record(),
    proposal = await prepareAcceptedAvatar(before, request());
  const next = adoptAcceptedAvatar(before, proposal),
    id = proposal.id;
  expect(next.draft.pack.avatars[id]).toMatchObject({
    name: "Lumi",
    place: pack.entry,
    seed: "Hears quiet bells",
  });
  expect(next.assets.size).toBe(1);
  expect(await acceptedAvatarOutput(next, id)).toMatchObject({
    revision: 1,
    accepted: request().accepted,
    visual: null,
  });
  const source = {
    pack: before.draft.pack,
    bridge: before.draft.bridge,
    launch: before.launch,
  };
  const applied = applySourceEdit(source, proposal.edit);
  expect(applySourceEdit(applied.source, applied.undo).source).toEqual(source);
  expect(before.draft.pack.avatars[id]).toBeUndefined();
  expect(before.assets.size).toBe(0);
});

it("keeps gameplay fields and earlier image bytes across accepted revisions", async () => {
  const original = record(),
    first = request();
  first.images = [
    { role: "base", mime: "image/png", bytes: new Uint8Array([1, 2, 3]) },
  ];
  const prepared = await prepareAcceptedAvatar(original, first),
    id = prepared.id;
  const one = adoptAcceptedAvatar(original, prepared);
  one.draft.pack.avatars[id].want = { kind: "place", target: pack.entry };
  const nextRequest = request();
  nextRequest.revision = 2;
  nextRequest.accepted.name = "Lumi II";
  const second = await prepareAcceptedAvatar(one, nextRequest),
    two = adoptAcceptedAvatar(one, second);
  expect(two.draft.pack.avatars[id].want).toEqual(
    one.draft.pack.avatars[id].want,
  );
  expect(two.draft.pack.avatars[id].portrait).toBe(
    one.draft.pack.avatars[id].portrait,
  );
  expect(two.assets.size).toBe(3);
  expect(await acceptedAvatarOutput(two, id)).toMatchObject({ revision: 2 });
  await expect(prepareAcceptedAvatar(two, nextRequest)).rejects.toThrow(
    /revision/,
  );
  first.images[0].bytes[0] = 9;
  expect([...one.assets.get(one.draft.pack.avatars[id].portrait)]).toEqual([
    1, 2, 3,
  ]);
});

it("guards stale source and keeps a prepared result reusable after write failure", async () => {
  const value = record(),
    prepared = await prepareAcceptedAvatar(value, request());
  const candidate = adoptAcceptedAvatar(value, prepared);
  const failingStore = {
    write: async () => {
      throw new Error("quota");
    },
  };
  await expect(
    failingStore.write(
      value.key,
      candidate,
      value.generation,
      candidate.assets,
    ),
  ).rejects.toThrow("quota");
  expect(adoptAcceptedAvatar(value, prepared)).toEqual(candidate);
  value.draft.title = "Changed";
  expect(() => adoptAcceptedAvatar(value, prepared)).toThrow(/changed/);
});

it("keeps temporary generation inputs outside accepted output", async () => {
  for (const field of ["seed", "prompt", "evidence", "source"]) {
    const value = request();
    value.accepted[field] = "temporary canary";
    await expect(prepareAcceptedAvatar(record(), value)).rejects.toThrow(
      /accepted/,
    );
  }
  const value = request();
  value.images = [
    { role: "sleep", mime: "image/png", bytes: new Uint8Array([1]) },
  ];
  await expect(prepareAcceptedAvatar(record(), value)).rejects.toThrow(
    /base image/,
  );
});
