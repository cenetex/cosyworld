import { describe, expect, it } from "vitest";
import {
  assetMetadata,
  DRAFT_LIMITS,
  exportManifest,
  importPack,
} from "../v2/card-game/authoring-draft.mjs";
import {
  importLocalDraft,
  localPackCandidates,
} from "../v2/card-game/authoring-local-import.mjs";

const text = new TextEncoder();
const selected = (path, bytes) => ({
  path,
  file: new File([bytes], path.split("/").at(-1)),
});
async function fixture() {
  const assets = new Map([
    ["art/pose.webp", new Uint8Array([0, 255, 42])],
    ["assets/music/theme.mp3", new Uint8Array([1, 2, 3])],
    ["notes/lore.md", text.encode("# Lanterns\nA quiet marsh. 🌲")],
  ]);
  const mimes = ["image/webp", "audio/mpeg", "text/markdown"];
  const metadata = await Promise.all(
    [...assets].map(([path, bytes], i) => assetMetadata(path, mimes[i], bytes)),
  );
  const draft = importPack({
    title: "Lantern Marsh",
    document: "A world idea.",
    pack: {
      id: "lantern-marsh",
      avatars: {
        guide: { poses: [{ portrait: "art/pose.webp", requires: [] }] },
      },
      places: { deck: { music: [{ file: "theme.mp3", title: "Marsh" }] } },
      lore: "notes/lore.md",
      future: { keep: true },
    },
    bridge: {
      entries: [{ joins: "hub", at: "pond", arrive: "gate", via: "pond-gate" }],
    },
    assets: metadata,
    sources: [
      {
        kind: "github",
        repo: "writer/marsh",
        commit: "a".repeat(40),
        path: "card-world.json",
      },
    ],
  });
  draft.id = "previous-draft";
  draft.revision = 7;
  const manifest = text.encode(exportManifest(draft));
  return {
    draft,
    manifest,
    assets,
    files: [
      selected("world/draft.json", manifest),
      ...[...assets].map(([path, bytes]) => selected(`world/${path}`, bytes)),
    ],
  };
}
const load = (files) =>
  importLocalDraft({ files, manifestPath: "world/draft.json" });

describe("local authoring import", () => {
  it("preserves source, poses, music, lore and exact bytes in a fresh draft", async () => {
    const input = await fixture();
    const result = await load(input.files);
    expect(result.draft).toEqual({
      ...input.draft,
      id: null,
      revision: 0,
      sources: [
        ...input.draft.sources,
        { kind: "file", path: "world/draft.json" },
      ],
    });
    expect(result.assets).toEqual(input.assets);
    expect(result.sourceFiles).toEqual([
      {
        ...(await assetMetadata(
          "world/draft.json",
          "application/json",
          input.manifest,
        )),
        bytes: input.manifest,
      },
    ]);
    result.draft.pack.future.keep = false;
    expect(input.draft.pack.future.keep).toBe(true);
    expect(exportManifest(result.draft)).not.toContain('"bytes"');
  });
  it("accepts browser Files and directory-picker paths", async () => {
    const value = importPack({ pack: null, document: "An idea" });
    const file = new File([exportManifest(value)], "draft.json");
    expect(
      (await importLocalDraft({ files: [file], manifestPath: "draft.json" }))
        .draft.document,
    ).toBe("An idea");
    Object.defineProperty(file, "webkitRelativePath", {
      value: "folder/draft.json",
    });
    expect(
      (
        await importLocalDraft({
          files: [file],
          manifestPath: "folder/draft.json",
        })
      ).draft.sources,
    ).toEqual([{ kind: "file", path: "folder/draft.json" }]);
  });
  it("finds explicit pack candidates in stable order", () => {
    const files = [
      selected("b/card-world.json", "{}"),
      selected("a/card-world.json", "{}"),
      selected("a/card-bridge.json", "{}"),
    ];
    expect(localPackCandidates(files)).toEqual([
      "a/card-world.json",
      "b/card-world.json",
    ]);
  });
  it.each([
    "../draft.json",
    "/draft.json",
    "a//draft.json",
    "a/./draft.json",
    "a\\draft.json",
    "a/%2e/draft.json",
    "a/draft.json?x",
  ])("checks selected path %s", (path) => {
    expect(() => localPackCandidates([selected(path, "{}")])).toThrow(
      /relative/,
    );
  });
  it("checks duplicate paths and selected file counts before reading", () => {
    const file = selected("card-world.json", "{}");
    expect(() => localPackCandidates([file, file])).toThrow(/one file/);
    expect(() =>
      localPackCandidates(
        Array.from({ length: 514 }, (_, i) => selected(`${i}.json`, "{}")),
      ),
    ).toThrow(/512/);
  });
  it("requires every declared asset and checks its byte count and digest", async () => {
    const input = await fixture();
    await expect(load(input.files.slice(0, -1))).rejects.toThrow(/asset file/);
    input.files[1] = selected("world/art/pose.webp", new Uint8Array([0]));
    await expect(load(input.files)).rejects.toThrow(/byte count/);
    input.files[1] = selected(
      "world/art/pose.webp",
      new Uint8Array([0, 255, 43]),
    );
    await expect(load(input.files)).rejects.toThrow(/SHA-256/);
  });
  it("checks the complete selection before reading asset bytes", async () => {
    const input = await fixture();
    let reads = 0;
    const original = input.files[1].file;
    input.files[1].file = {
      size: original.size,
      arrayBuffer: async () => {
        reads++;
        return original.arrayBuffer();
      },
    };
    await expect(load(input.files.slice(0, -1))).rejects.toThrow(/asset file/);
    expect(reads).toBe(0);
    await expect(load(input.files.slice(1))).rejects.toThrow(/draft file/);
    expect(input.draft.id).toBe("previous-draft");
    expect(input.draft.revision).toBe(7);
  });
  it("checks actual buffers and manifest encoding", async () => {
    const input = await fixture();
    input.files[1].file = {
      size: 3,
      arrayBuffer: async () => new ArrayBuffer(2),
    };
    await expect(load(input.files)).rejects.toThrow(/bytes changed/);
    await expect(
      load([selected("world/draft.json", new Uint8Array([255]))]),
    ).rejects.toThrow();
    await expect(
      load([selected("world/draft.json", "{broken")]),
    ).rejects.toThrow();
  });
  it("checks recorded size again when an adapter changes its file metadata", async () => {
    const input = await fixture();
    const bytes = new Uint8Array([1, 2, 3, 4]);
    input.draft.assets[0].sha256 = (
      await assetMetadata("art/pose.webp", "image/webp", bytes)
    ).sha256;
    input.files[0] = selected("world/draft.json", exportManifest(input.draft));
    const file = {
      size: 3,
      arrayBuffer: async () => {
        file.size = 4;
        return bytes.buffer;
      },
    };
    input.files[1].file = file;
    await expect(load(input.files)).rejects.toThrow(/byte count/);
  });
  it("enforces metadata, document, asset and provenance bounds", async () => {
    let reads = 0;
    const big = {
      path: "world/draft.json",
      file: {
        size: DRAFT_LIMITS.metadata + 1,
        arrayBuffer: async () => {
          reads++;
          return new ArrayBuffer(0);
        },
      },
    };
    await expect(load([big])).rejects.toThrow(/size limit/);
    expect(reads).toBe(0);
    const { draft } = await fixture();
    for (const change of [
      (d) => {
        d.document = "x".repeat(DRAFT_LIMITS.document + 1);
      },
      (d) => {
        d.assets[0].size = DRAFT_LIMITS.assetBytes + 1;
      },
      (d) => {
        d.assets = Array.from({ length: 17 }, (_, i) => ({
          ...d.assets[0],
          path: `${i}.webp`,
          size: DRAFT_LIMITS.assetBytes,
        }));
      },
      (d) => {
        d.sources = Array(512).fill(d.sources[0]);
        d.assets = [];
      },
    ]) {
      const value = structuredClone(draft);
      change(value);
      await expect(
        load([selected("world/draft.json", JSON.stringify(value))]),
      ).rejects.toThrow();
    }
  });
});
