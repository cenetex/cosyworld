import { expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { createHash } from "node:crypto";
import {
  importSourcePack,
  sourcePackCandidates,
} from "../v2/card-game/authoring-source-import.mjs";
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const selectedFile = (path, size, arrayBuffer) => ({
  path,
  file: { size, arrayBuffer },
});
const file = (path, value) => ({
  path,
  file: new Blob([typeof value === "string" ? value : JSON.stringify(value)]),
});
const pack = () => ({
  schemaVersion: 1,
  id: "island",
  name: "Island",
  entry: "shore",
  places: {
    shore: {
      backdrop: "assets/island/shore.svg",
      music: [{ file: "song.mp3" }],
    },
  },
  avatars: { guide: { poses: [{ portrait: "assets/island/guide.webp" }] } },
  future: { lore: "Keep this story.", portrait: "assets/island/guide.webp" },
});
const files = () => [
  file("card-world.json", pack()),
  file("assets/island/shore.svg", "<svg />"),
  file("assets/music/song.mp3", "song"),
  file("assets/island/guide.webp", "pose"),
];
const options = () => ({ files: files(), packPath: "card-world.json" });

it("imports exact source, media, hashes and explicit lore with pinned provenance", async () => {
  const opts = options(),
    bridge = {
      schemaVersion: 1,
      pack: "island",
      id: "shore-island",
      crossings: [],
    };
  opts.files.push(
    file("bridge.json", bridge),
    file("lore/book.md", "A book. 雪"),
  );
  Object.assign(opts, {
    bridgePath: "bridge.json",
    extraPaths: ["lore/book.md"],
    origin: { kind: "github", repo: "owner/world", commit: "a".repeat(40) },
  });
  opts.cardRoot = "media";
  for (const entry of opts.files)
    if (!entry.path.endsWith(".json")) entry.path = `media/${entry.path}`;
  const result = await importSourcePack(opts);
  expect(result.draft.pack).toEqual(pack());
  expect(result.draft.bridge).toEqual(bridge);
  expect([result.draft.id, result.draft.revision]).toEqual([null, 0]);
  expect(result.draft.sources).toEqual(
    ["card-world.json", "bridge.json", "media/lore/book.md"].map((path) => ({
      ...opts.origin,
      path,
    })),
  );
  for (const meta of result.draft.assets) {
    expect(meta.sha256).toBe(hash(result.assets.get(meta.path)));
    expect(meta.size).toBe(result.assets.get(meta.path).byteLength);
    expect(result.assetSources.get(meta.path)).toEqual({
      ...opts.origin,
      path: `media/${meta.path}`,
    });
  }
  for (const original of result.sourceFiles) {
    expect(original.sha256).toBe(hash(original.bytes));
    expect(new TextDecoder().decode(original.bytes)).toBe(
      JSON.stringify(original.path === "bridge.json" ? bridge : pack()),
    );
  }
});

it("indexes large directory selections and resolves the actual Greek source", async () => {
  const paths = readdirSync("v2/card-game/assets", {
    recursive: true,
    withFileTypes: true,
  })
    .filter((e) => e.isFile())
    .map((e) => `${e.parentPath}/${e.name}`);
  paths.push(
    "v2/content/greek-drama/card-world.json",
    "v2/worlds/greek-drama/card-bridge.json",
  );
  const selected = paths.map((path) =>
    selectedFile(
      `repo/${path}`,
      statSync(path).size,
      async () => Uint8Array.from(readFileSync(path)).buffer,
    ),
  );
  for (const entry of selected) {
    entry.file.webkitRelativePath = entry.path;
    entry.file.name = entry.path.split("/").at(-1);
  }
  expect(selected.length).toBeGreaterThan(513);
  expect(sourcePackCandidates(selected)).toEqual([
    "repo/v2/content/greek-drama/card-world.json",
  ]);
  const result = await importSourcePack({
    files: selected.map((entry) => entry.file),
    packPath: "repo/v2/content/greek-drama/card-world.json",
    bridgePath: "repo/v2/worlds/greek-drama/card-bridge.json",
  });
  expect(result.draft.pack).toEqual(JSON.parse(readFileSync(paths.at(-2))));
  expect(result.draft.bridge).toEqual(JSON.parse(readFileSync(paths.at(-1))));
  expect(result.assets.has("assets/music/ship-1.mp3")).toBe(true);
  expect(
    result.assets.has("assets/greek-drama/ship-deck-at-sea-night.webp"),
  ).toBe(true);
  expect(result.assets.has("assets/greek-drama/polynices-shade.webp")).toBe(
    true,
  );
  expect(result.assetSources.get("assets/music/ship-1.mp3")).toEqual({
    kind: "file",
    path: "repo/v2/card-game/assets/music/ship-1.mp3",
  });
}, 20_000);

it.each([
  { packPath: "../card-world.json" },
  { cardRoot: "../media" },
  { origin: { kind: "github", repo: "owner/world", commit: "main" } },
  { extraPaths: ["../book.md"] },
])("rejects unsafe selection options before importing: %j", async (bad) => {
  await expect(importSourcePack({ ...options(), ...bad })).rejects.toThrow();
});

it("requires local files for remote art and keeps citation URLs in source", async () => {
  const value = pack();
  value.sources = [{ url: "https://example.test/book" }];
  let opts = options();
  opts.files[0] = file(opts.packPath, value);
  expect((await importSourcePack(opts)).draft.pack.sources).toEqual(
    value.sources,
  );
  value.avatars.guide.portrait = "https://example.test/portrait.webp";
  opts = options();
  opts.files[0] = file(opts.packPath, value);
  await expect(importSourcePack(opts)).rejects.toThrow(
    /explicit import policy/,
  );
});

it("preflights missing files and all media byte limits before reading media", async () => {
  for (const mode of ["missing", "large", "total"]) {
    const opts = options();
    let reads = 0;
    const value = pack();
    if (mode === "total")
      value.extra = Array.from({ length: 17 }, (_, i) => `assets/${i}.png`);
    opts.files[0] = file(opts.packPath, value);
    if (mode === "missing") opts.files.pop();
    if (mode === "total")
      for (const path of value.extra)
        opts.files.push(selectedFile(path, 16 * 1024 * 1024, () => {}));
    for (const entry of opts.files.slice(1)) {
      const original = entry.file;
      entry.file = {
        size: mode === "large" ? 16 * 1024 * 1024 + 1 : original.size,
        arrayBuffer() {
          reads++;
          return original.arrayBuffer();
        },
      };
    }
    await expect(importSourcePack(opts)).rejects.toThrow();
    expect(reads).toBe(0);
  }
});

it("rejects changed adapter bytes and a mismatched bridge atomically", async () => {
  const opts = options();
  opts.files[1] = selectedFile(
    opts.files[1].path,
    2,
    async () => new ArrayBuffer(3),
  );
  await expect(importSourcePack(opts)).rejects.toThrow(/bytes changed/);
  const other = options();
  other.files.push(file("bridge.json", { schemaVersion: 1, pack: "other" }));
  await expect(
    importSourcePack({ ...other, bridgePath: "bridge.json" }),
  ).rejects.toThrow(/matching bridge/);
});
