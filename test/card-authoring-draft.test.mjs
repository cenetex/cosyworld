import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  assetMetadata,
  DRAFT_LIMITS,
  exportManifest,
  importPack,
  parseDraft,
} from "../v2/card-game/authoring-draft.mjs";
const read = (path) =>
  JSON.parse(readFileSync(new URL(path, import.meta.url), "utf8"));
const pack = read("../v2/content/badger-forest/card-world.json");
const bridge = read("../v2/worlds/badger-forest/card-bridge.json");
const asset = {
  path: "assets/badger-forest/clock.png",
  mime: "image/png",
  sha256: "a".repeat(64),
  size: 123,
};
const source = {
  kind: "github",
  repo: "cenetex/cosyworld",
  commit: "b".repeat(40),
  path: "v2/content/badger-forest/card-world.json",
};
const draft = () =>
  importPack({ pack, bridge, assets: [asset], sources: [source] });
const rejects = (change) => {
  const value = draft();
  change(value);
  expect(() => exportManifest(value)).toThrow();
  expect(() => parseDraft(JSON.stringify(value))).toThrow();
};
describe("authoring draft files", () => {
  it("keeps a real pack, bridge, sources and document through an export", () => {
    const value = draft();
    value.id = "draft-123";
    value.revision = 4;
    value.document = "# The clock\n\nA quiet place. 🌲";
    value.pack.futureAuthorField = { cards: ["new-card"], done: false };
    const restored = parseDraft(exportManifest(value));
    expect(restored).toEqual(value);
    expect(restored.pack.id).toBe(pack.id);
    expect(restored.bridge.entries).toEqual(bridge.entries);
    expect(value.title).toBe(pack.name);
    expect(draft()).toMatchObject({ id: null, revision: 0 });
  });
  it("copies imported data and keeps incomplete ideas editable", () => {
    const value = draft();
    value.pack.places.clearing.name = "Changed";
    value.bridge.entries[0].arrive = "future-place";
    value.assets[0].size = 1;
    value.sources[0].repo = "owner/copy";
    expect(pack.places.clearing.name).toBe("Forest Clearing");
    expect(bridge.entries[0].arrive).toBe("clearing");
    expect(asset.size).toBe(123);
    expect(source.repo).toBe("cenetex/cosyworld");
    expect(importPack({ pack: null, document: "A world idea" })).toMatchObject({
      pack: null,
      bridge: null,
      document: "A world idea",
    });
    expect(
      importPack({ pack: { places: { unfinished: {} } } }).pack.places
        .unfinished,
    ).toEqual({});
  });
  it.each([
    "../art.png",
    "/art.png",
    "a//art.png",
    "a/./art.png",
    "a\\art.png",
    "https://host/art.png",
    "a/%2e%2e/art.png",
    "a/art.png?x",
    "a/\u0000.png",
  ])("checks asset path %s", (path) =>
    rejects((d) => {
      d.assets[0].path = path;
    }),
  );
  it.each([
    (d) => {
      d.schemaVersion = 2;
    },
    (d) => {
      d.owner = "someone";
    },
    (d) => {
      delete d.bridge;
    },
    (d) => {
      d.revision = 0.5;
    },
    (d) => {
      d.assets[0].mime = "text/html";
    },
    (d) => {
      d.assets[0].sha256 = "A".repeat(64);
    },
    (d) => {
      d.assets[0].size = -1;
    },
    (d) => {
      d.assets[0].bytes = "inline bytes";
    },
    (d) => {
      d.assets.push({ ...d.assets[0] });
    },
    (d) => {
      d.sources[0].commit = "main";
    },
    (d) => {
      d.sources[0].repo = "https://github.com/owner/repo";
    },
    (d) => {
      d.sources = [{ kind: "file", path: "/Users/name/world.json" }];
    },
  ])("checks malformed metadata %#", (change) => rejects(change));
  it("checks byte and count limits at the import boundary", () => {
    const value = importPack({
      pack: null,
      document: "é".repeat(DRAFT_LIMITS.document / 2),
      sources: [{ kind: "file", path: "world/card-world.json" }],
    });
    expect(parseDraft(exportManifest(value))).toEqual(value);
    rejects((d) => {
      d.document = value.document + "é";
    });
    rejects((d) => {
      d.pack.note = "x".repeat(DRAFT_LIMITS.metadata);
    });
    rejects((d) => {
      d.assets[0].size = DRAFT_LIMITS.assetBytes + 1;
    });
    rejects((d) => {
      d.assets = Array.from({ length: 513 }, (_, i) => ({
        ...asset,
        path: `art/${i}.png`,
      }));
    });
    rejects((d) => {
      d.assets = Array.from({ length: 17 }, (_, i) => ({
        ...asset,
        path: `art/${i}.png`,
        size: DRAFT_LIMITS.assetBytes,
      }));
    });
    expect(() => parseDraft(" ".repeat(DRAFT_LIMITS.metadata + 1))).toThrow();
  });
  it("checks values that JSON would change and deeply nested data", () => {
    for (const value of [undefined, NaN, Infinity, new Date(), () => {}])
      expect(() => importPack({ pack: { value } })).toThrow();
    const nested = {};
    nested.self = nested;
    expect(() => importPack({ pack: nested })).toThrow();
    expect(() => parseDraft('{"pack":1e400}')).toThrow();
  });
  it("hashes just the supplied file bytes for a separate upload", async () => {
    const bytes = new TextEncoder().encode("xabcx").subarray(1, 4);
    const result = await assetMetadata("notes/source.txt", "text/plain", bytes);
    expect(result).toEqual({
      path: "notes/source.md",
      mime: "text/markdown",
      size: 3,
      sha256:
        "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    });
    await expect(
      assetMetadata("../file.txt", "text/plain", bytes),
    ).rejects.toThrow();
    await expect(
      assetMetadata(
        "file.txt",
        "text/plain",
        new Uint8Array(DRAFT_LIMITS.assetBytes + 1),
      ),
    ).rejects.toThrow();
  });
});
