import { expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import "./helpers/still-cast.mjs";
import {
  createSampleWorld,
  sampleSource,
} from "../v2/card-game/authoring-sample.mjs";
vi.mock("../v2/card-game/packs.json", async (original) => {
  const compiled = structuredClone((await original()).default);
  const { sampleSource } = await import("../v2/card-game/authoring-sample.mjs");
  const { pack, bridge } = sampleSource();
  compiled.packs.push({
    ...pack,
    bridge: { id: bridge.id, description: bridge.description },
    crossings: bridge.crossings,
  });
  return { default: compiled };
});
import {
  createWorld,
  legalActions,
  play,
  exits,
  encodeSave,
  decodeSave,
} from "../v2/card-game/world.mjs";
import { packDefinition, hub } from "../v2/card-game/pack-registry.mjs";
import { packProblems } from "../v2/card-game/pack-schema.mjs";
import {
  exportManifest,
  parseDraft,
} from "../v2/card-game/authoring-draft.mjs";
const readAsset = async (path) =>
  new Response(readFileSync(`v2/card-game/${path}`));

it("loads a complete editable sample with exact portable artwork", async () => {
  const record = await createSampleWorld({ fetch: readAsset });
  const { draft, assets, launch } = record;
  expect(parseDraft(exportManifest(draft))).toEqual(draft);
  expect([draft.id, draft.revision, draft.document]).toEqual([null, 0, ""]);
  expect(launch.place).toBe(draft.pack.entry);
  expect(Object.keys(draft.pack.places)).toHaveLength(3);
  expect(Object.keys(draft.pack.avatars)).toHaveLength(2);
  expect(Object.keys(draft.pack.items)).toHaveLength(3);
  expect(assets.size).toBe(8);
  for (const meta of draft.assets) {
    const bytes = assets.get(meta.path);
    expect(bytes.byteLength).toBe(meta.size);
    expect(createHash("sha256").update(bytes).digest("hex")).toBe(meta.sha256);
    expect(Buffer.from(bytes).toString("ascii", 8, 12)).toBe("WEBP");
  }
  draft.pack.avatars["sample-vale"].name = "Changed";
  expect(sampleSource().pack.avatars["sample-vale"].name).toBe("Vale");
  expect(packProblems(packDefinition("lantern-shore"), hub)).toEqual([]);
});

it("opens the garden after delivery to the keeper and keeps the return free", () => {
  let world = createWorld();
  const actor = "vale";
  world.actors.vale.place = "pond";
  const act = (kind, fields = {}) => {
    const action = legalActions(world, actor).find(
      (a) =>
        a.kind === kind && Object.entries(fields).every(([k, v]) => a[k] === v),
    );
    expect(action, JSON.stringify({ kind, ...fields })).toBeTruthy();
    const result = play(world, action, world.revision, actor);
    expect(result.ok, result.error).toBe(true);
    world = decodeSave(encodeSave(result.state));
  };
  const gardenOpen = () =>
    exits(world, "sample-station", actor).includes("sample-garden");
  expect(world.items["sample-lantern"].holder).toBe("sample-vale");
  expect(gardenOpen()).toBe(false);
  act("move", { target: "sample-shore" });
  act("take", { item: "sample-bell" });
  act("move", { target: "sample-station" });
  expect(gardenOpen()).toBe(false);
  act("drop", { item: "sample-bell" });
  expect(gardenOpen()).toBe(false);
  act("take", { item: "sample-bell" });
  act("give", { item: "sample-bell", target: "sample-keeper" });
  expect(gardenOpen()).toBe(true);
  expect(sampleSource().pack.routes[0].sealed.quest).toEqual({
    kind: "item",
    target: "sample-bell",
    to: "sample-keeper",
  });
  act("move", { target: "sample-garden" });
  expect(exits(world, "sample-garden", actor)).toContain("sample-station");
  act("move", { target: "sample-station" });
});

it("keeps an incomplete artwork load from producing a draft", async () => {
  await expect(
    createSampleWorld({
      fetch: async () => new Response(null, { status: 404 }),
    }),
  ).rejects.toThrow(/artwork/);
});
