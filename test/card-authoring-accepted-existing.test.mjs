import { expect, it, vi } from "vitest";
import { packDefinition, hub } from "../v2/card-game/pack-registry.mjs";
import { packProblems, mediaPathOk } from "../v2/card-game/pack-schema.mjs";
import { sampleSource } from "../v2/card-game/authoring-sample.mjs";
import { importPack, assetMetadata } from "../v2/card-game/authoring-draft.mjs";
import { applySourceEdit } from "../v2/card-game/authoring-edits.mjs";
import {
  prepareAcceptedAvatar,
  adoptAcceptedAvatar,
  acceptedAvatarOutput,
  acceptedAvatarOutputs,
  nextAcceptedAvatarRevision,
} from "../v2/card-game/authoring-accepted.mjs";
const id = "sample-vale";
const record = (pack = sampleSource().pack) => ({
  key: "local",
  generation: 0,
  draft: importPack({
    pack,
    bridge: pack.id === "lantern-shore" ? sampleSource().bridge : null,
  }),
  launch: { schemaVersion: 1, place: pack.entry },
  assets: new Map(),
});
const image = (role = "base", n = 1) => ({
  role,
  mime: "image/png",
  bytes: new Uint8Array([n]),
});
const request = (targetId = id, revision = 1) => ({
  candidateId: "12345678-1234-4234-8234-123456789abc",
  targetId,
  revision,
  accepted: {
    name: "Dino",
    specialAbility: "Finds lost bells",
    aliases: ["Shore Dino"],
    description: "A small green dinosaur.",
  },
  images: [image()],
});
const source = (r) => ({
  pack: r.draft.pack,
  bridge: r.draft.bridge,
  launch: r.launch,
});
const accept = async (r, q) =>
  adoptAcceptedAvatar(r, await prepareAcceptedAvatar(r, q));

it("edits the sample avatar in place and keeps every gameplay link and Undo", async () => {
  const before = record();
  before.draft.pack.avatars[id].want = { kind: "item", target: "sample-bell" };
  const unchanged = structuredClone(source(before));
  const prepared = await prepareAcceptedAvatar(before, request());
  const next = adoptAcceptedAvatar(before, prepared);
  expect(prepared.id).toBe(id);
  expect(Object.keys(next.draft.pack.avatars)).toEqual(
    Object.keys(before.draft.pack.avatars),
  );
  expect(next.draft.pack.avatars[id]).toEqual({
    ...before.draft.pack.avatars[id],
    name: "Dino",
    text: request().accepted.description,
    portrait: `assets/lantern-shore/${id}-r1-base.png`,
  });
  const applied = applySourceEdit(unchanged, prepared.edit);
  expect(applySourceEdit(applied.source, applied.undo).source).toEqual(
    unchanged,
  );
  expect({ ...next.draft.pack, avatars: before.draft.pack.avatars }).toEqual(
    before.draft.pack,
  );
  expect(next.draft.pack.items["sample-lantern"].holder).toBe(id);
  expect(next.launch).toEqual(before.launch);
  expect(
    packProblems(
      {
        ...next.draft.pack,
        bridge: {
          id: next.draft.bridge.id,
          description: next.draft.bridge.description,
        },
        crossings: next.draft.bridge.crossings,
      },
      hub,
    ),
  ).toEqual([]);
  expect(source(before)).toEqual(unchanged);
});

it("updates an explicit imported portrait variant and retains its behavior", async () => {
  const before = record(packDefinition("badger-forest"));
  const q = request("badger");
  await expect(prepareAcceptedAvatar(before, q)).rejects.toThrow(/variant/);
  for (const targetVariant of ["irritated", "missing"])
    await expect(
      prepareAcceptedAvatar(before, { ...q, targetVariant }),
    ).rejects.toThrow(/variant/);
  const next = await accept(before, { ...q, targetVariant: "awake" });
  const old = before.draft.pack.avatars.badger;
  const avatar = next.draft.pack.avatars.badger;
  expect(avatar).toEqual({
    ...old,
    name: q.accepted.name,
    text: q.accepted.description,
    variants: {
      ...old.variants,
      awake: {
        ...old.variants.awake,
        portrait: "assets/badger-forest/badger-r1-base.png",
      },
    },
  });
  expect(avatar.temperament.asleep).toBe(true);
  expect(packProblems(next.draft.pack, hub)).toEqual([]);
  expect(
    (await acceptedAvatarOutput(next, "badger")).visual.targetVariant,
  ).toBe("awake");
  avatar.text = "A manual description edit.";
  const two = await accept(next, { ...q, revision: 2, images: [] });
  expect((await acceptedAvatarOutput(two, "badger")).visual).toMatchObject({
    revision: 1,
    targetVariant: "awake",
  });
});

it("uses safe authored IDs and accepts the pack schema's 80-character limit", async () => {
  const before = record(),
    long = "a".repeat(80);
  before.draft.pack.id = long;
  before.draft.pack.avatars[long] = before.draft.pack.avatars[id];
  const next = await accept(before, request(long));
  expect(mediaPathOk(long, next.draft.pack.avatars[long].portrait)).toBe(true);
  for (const targetId of [
    "missing",
    "../sample-vale",
    "Sample-vale",
    "a".repeat(81),
  ])
    await expect(
      prepareAcceptedAvatar(record(), request(targetId)),
    ).rejects.toThrow(/existing avatar/);
  await expect(
    prepareAcceptedAvatar(record(), { ...request(), targetVariant: "awake" }),
  ).rejects.toThrow(/variant/);
});

it("keeps the confirmed sheet and six poses through manual source edits", async () => {
  const q = request();
  q.images = "base sheet happy sad strike brace hit sleep"
    .split(" ")
    .map((role, i) => image(role, i + 1));
  const one = await accept(record(), q),
    original = await acceptedAvatarOutput(one, id);
  Object.assign(one.draft.pack.avatars[id], {
    name: "Edited Dino",
    text: "A new description.",
    want: { kind: "item", target: "sample-bell" },
    poses: [
      {
        portrait: one.draft.pack.avatars[id].portrait,
        at: one.draft.pack.entry,
      },
    ],
  });
  expect(await acceptedAvatarOutput(one, id)).toBeNull();
  expect((await acceptedAvatarOutputs(one, id))[0].accepted).toEqual(
    q.accepted,
  );
  const copy = vi.spyOn(one.assets.values().next().value, "slice");
  const prepared = await prepareAcceptedAvatar(one, {
    ...request(id, 2),
    images: [],
  });
  expect(copy).not.toHaveBeenCalled();
  copy.mockRestore();
  const two = adoptAcceptedAvatar(one, prepared);
  expect((await acceptedAvatarOutput(two, id)).visual).toEqual(original.visual);
  expect(two.draft.pack.avatars[id].poses).toEqual(
    one.draft.pack.avatars[id].poses,
  );
  for (const [path, bytes] of one.assets)
    expect(two.assets.get(path)).toEqual(bytes);
  const portrait = one.draft.pack.avatars[id].portrait;
  one.assets.set(portrait, new Uint8Array([99]));
  await expect(
    prepareAcceptedAvatar(one, { ...request(id, 2), images: [] }),
  ).rejects.toThrow(/portrait digest/);
});

it("keeps a manually changed portrait and retires its previous visual links", async () => {
  const one = await accept(record(), request());
  const bytes = new Uint8Array([42]);
  const meta = await assetMetadata(
    "assets/lantern-shore/changed.png",
    "image/png",
    bytes,
  );
  one.draft.assets.push(meta);
  one.assets.set(meta.path, bytes);
  one.draft.pack.avatars[id].portrait = meta.path;
  const two = await accept(one, { ...request(id, 2), images: [] });
  expect(two.draft.pack.avatars[id].portrait).toBe(meta.path);
  expect((await acceptedAvatarOutput(two, id)).visual).toBeNull();
});

it("uses a fresh revision after Undo and finds visuals for the restored base", async () => {
  const one = await accept(record(), request());
  const q = { ...request(id, 2), images: [image("base", 2)] };
  const prepared = await prepareAcceptedAvatar(one, q);
  const two = adoptAcceptedAvatar(one, prepared);
  const { undo } = applySourceEdit(source(one), prepared.edit);
  const restored = applySourceEdit(source(two), undo).source;
  const undone = {
    ...two,
    draft: { ...two.draft, pack: restored.pack },
    launch: restored.launch,
  };
  expect((await acceptedAvatarOutput(undone, id)).revision).toBe(1);
  expect(nextAcceptedAvatarRevision(undone, id)).toBe(3);
  expect(
    (await acceptedAvatarOutputs(undone, id)).map((o) => o.revision),
  ).toEqual([2, 1]);
  await expect(prepareAcceptedAvatar(undone, q)).rejects.toThrow(
    /fresh output revision/,
  );
  const three = await accept(undone, { ...request(id, 3), images: [] });
  expect((await acceptedAvatarOutput(three, id)).visual.revision).toBe(1);
  expect(three.assets.size).toBe(5);
  delete three.draft.pack.avatars[id];
  expect(await acceptedAvatarOutputs(three, id)).toEqual([]);
});
