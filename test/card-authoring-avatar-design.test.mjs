import { readFile } from "node:fs/promises";
import {
  createSampleWorld,
  sampleExample,
} from "../v2/card-game/authoring-sample.mjs";
import { expect, it } from "vitest";
import {
  readAvatarDesign,
  avatarBinding,
} from "../v2/card-game/authoring-avatar-design.mjs";
import { assetMetadata } from "../v2/card-game/authoring-draft.mjs";
const record = () => ({
  key: "world",
  generation: 1,
  draft: {
    pack: {
      id: "lantern-shore",
      avatars: {
        "sample-vale": {
          name: "Dino",
          text: "A green dinosaur.",
          portrait: "base.png",
        },
      },
    },
    assets: [],
  },
  assets: new Map(),
});
async function add(r, path, value, mime = "image/png") {
  const bytes = Uint8Array.of(value),
    meta = await assetMetadata(path, mime, bytes);
  r.draft.assets.push(meta);
  r.assets.set(path, bytes);
  return { ...meta, role: path };
}
const empty = {
  outputs: async () => [],
  example: {
    avatar: "sample-vale",
    specialAbility: "The Braveheart",
    sheet: "sheet.png",
  },
};
it("requires actual original portrait and sheet bytes for the Dino example", async () => {
  const r = record(),
    base = await add(r, "base.png", 1),
    sheet = await add(r, "sheet.png", 2);
  const options = {
    ...empty,
    example: {
      ...empty.example,
      portraitSha256: base.sha256,
      sheetSha256: sheet.sha256,
    },
  };
  expect(
    (await readAvatarDesign(r, "sample-vale", options)).example.sha256,
  ).toBe(sheet.sha256);
  r.draft.pack.id = "another-pack";
  expect(
    (await readAvatarDesign(r, "sample-vale", options)).example,
  ).toBeNull();
  r.draft.pack.id = "lantern-shore";
  r.assets.set("sheet.png", Uint8Array.of(3));
  await expect(readAvatarDesign(r, "sample-vale", options)).rejects.toThrow(
    /digest/,
  );
  r.draft.assets[1] = await assetMetadata(
    "sheet.png",
    "image/png",
    r.assets.get("sheet.png"),
  );
  expect(
    (await readAvatarDesign(r, "sample-vale", options)).example,
  ).toBeNull();
});
it("restores the exact base path before choosing newer poses with identical base bytes", async () => {
  const r = record(),
    base = await add(r, "base.png", 1),
    other = await add(r, "same.png", 1);
  const happy = await add(r, "happy.png", 2),
    sad = await add(r, "sad.png", 3);
  const visual = (revision, base, pose, role) => ({
    revision,
    images: [
      { ...base, role: "base" },
      { ...pose, role },
    ],
  });
  const history = [
    { visual: visual(2, other, sad, "sad") },
    { visual: visual(1, base, happy, "happy") },
  ].map((value) => ({
    ...value,
    accepted: { specialAbility: "Brave", aliases: [] },
  }));
  const one = await readAvatarDesign(r, "sample-vale", {
    ...empty,
    outputs: async () => history,
  });
  expect(one.value.poses.map((image) => image.role)).toEqual(["happy"]);
  expect(one.value.revision).toBe(1);
  r.draft.pack.avatars["sample-vale"].portrait = "same.png";
  const two = await readAvatarDesign(r, "sample-vale", {
    ...empty,
    outputs: async () => history,
  });
  expect(two.value.poses.map((image) => image.role)).toEqual(["sad"]);
});
it("binds the full avatar and its active variant while preserving authored quest data", async () => {
  const r = record();
  await add(r, "asleep.png", 1);
  const avatar = r.draft.pack.avatars["sample-vale"];
  delete avatar.portrait;
  avatar.temperament = { asleep: true };
  avatar.variants = { asleep: { portrait: "asleep.png" }, awake: {} };
  const design = await readAvatarDesign(r, "sample-vale", empty);
  expect(design.variant).toBe("asleep");
  expect(design.value.base).toBeTruthy();
  avatar.want = { kind: "item", target: "bell" };
  expect(avatarBinding(r, "sample-vale")).not.toBe(design.binding);
  avatar.portrait = "base.png";
  await expect(readAvatarDesign(r, "sample-vale", empty)).rejects.toThrow(
    /variants/,
  );
});

it("pins the original Dino PNG bytes and loads the bundled example", async () => {
  const value = await createSampleWorld({
    fetch: async (path) =>
      new Response(
        await readFile(new URL(`../v2/card-game/${path}`, import.meta.url)),
      ),
  });
  const design = await readAvatarDesign(
    { key: "sample", generation: 0, ...value },
    "sample-vale",
  );
  expect(design.value.base.sha256).toBe(sampleExample().portraitSha256);
  expect(design.example.sha256).toBe(sampleExample().sheetSha256);
  expect(design.accepted.specialAbility).toBe("The Braveheart");
});

it("opens an imported JPEG avatar for a fresh roll while keeping its authored portrait", async () => {
  const r = record();
  r.draft.pack.avatars["sample-vale"].portrait = "portrait.jpg";
  await add(r, "portrait.jpg", 1, "image/jpeg");
  const before = JSON.stringify(r.draft);
  const design = await readAvatarDesign(r, "sample-vale", empty);
  expect(design.value.base).toBeUndefined();
  expect(design.value.description).toBe("");
  expect(design.accepted.description).toBe("A green dinosaur.");
  expect(JSON.stringify(r.draft)).toBe(before);
});
