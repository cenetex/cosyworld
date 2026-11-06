import { describe, expect, it, vi } from "vitest";
import { authoringImportTools } from "../v2/card-game/authoring-import-tools.mjs";
import {
  assetMetadata,
  exportManifest,
  importPack,
} from "../v2/card-game/authoring-draft.mjs";

const pack = {
  schemaVersion: 1,
  id: "shore",
  name: "The Shore",
  entry: "beach",
  places: { beach: { name: "Beach", art: "assets/beach.svg", exits: [] } },
  avatars: {},
  items: {},
};
const origin = { kind: "github", repo: "owner/world", commit: "a".repeat(40) };
const bridge = { schemaVersion: 1, pack: "shore", entries: { beach: "pond" } };
const art = new TextEncoder().encode(
  '<svg xmlns="http://www.w3.org/2000/svg"/>',
);
const file = (path, bytes) => ({
  path,
  file: {
    size: bytes.length,
    arrayBuffer: vi.fn(async () => bytes.slice().buffer),
  },
});
const jsonFile = (path, value) =>
  file(path, new TextEncoder().encode(JSON.stringify(value)));
const sources = () => [
  jsonFile("project/v2/content/shore/card-world.json", pack),
  jsonFile("project/v2/worlds/shore/card-bridge.json", bridge),
  file("project/v2/card-game/assets/beach.svg", art),
  file("project/unrelated.txt", new Uint8Array([42])),
];
function fixture(files = sources()) {
  const store = { write: vi.fn(async () => 1) };
  const context = {
    snapshot: vi.fn(() => ({})),
    save: vi.fn(async () => ({})),
    open: vi.fn(async () => {}),
  };
  const chooseFiles = vi.fn(async () => files);
  const github = vi.fn(async () => ({ files, origin }));
  const read = authoringImportTools({ store, chooseFiles, github });
  return { store, context, chooseFiles, github, read };
}
const get = (f, id) => f.read().find((tool) => tool.id === id);
const candidate = (f) =>
  f.read().find((tool) => tool.id.startsWith("import-pack-"));

describe("authoring import tools", () => {
  it("keeps the folder picker in the gesture, then imports a chosen pack and bridge", async () => {
    const files = sources(),
      f = fixture(files);
    files[1].path = "project/v2/content/shore/card-bridge.json";
    const pending = get(f, "import-folder").run({}, f.context);
    expect(f.chooseFiles).toHaveBeenCalledWith({ directory: true });
    expect(f.context.save).not.toHaveBeenCalled();
    await pending;
    expect(candidate(f).describe().actions[0].opensDraft).toBe(true);
    for (const entry of files)
      expect(entry.file.arrayBuffer).not.toHaveBeenCalled();
    await candidate(f).run({}, f.context);
    const [key, value, generation, assets] = f.store.write.mock.calls[0];
    expect(generation).toBe(0);
    expect(value.draft).toMatchObject({ id: null, revision: 0, pack, bridge });
    expect(value.launch).toBeNull();
    expect(assets.get("assets/beach.svg")).toEqual(art);
    expect(f.context.open).toHaveBeenCalledWith({
      key,
      record: { ...value, generation: 1, assets },
    });
    expect(files.at(-1).file.arrayBuffer).not.toHaveBeenCalled();
    expect(candidate(f)).toBeUndefined();
  });
  it("lists pinned GitHub source before reading the chosen pack", async () => {
    const f = fixture(),
      tool = get(f, "import-github");
    tool.describe().edit.onInput("  https://github.com/owner/world  ");
    await tool.run({}, f.context);
    expect(f.github).toHaveBeenCalledWith("https://github.com/owner/world");
    expect(f.store.write).not.toHaveBeenCalled();
    await candidate(f).run({}, f.context);
    const draft = f.store.write.mock.calls[0][1].draft;
    expect(draft.sources).toEqual(
      [
        "project/v2/content/shore/card-world.json",
        "project/v2/worlds/shore/card-bridge.json",
      ].map((path) => ({ ...origin, path })),
    );
  });
  it.each(["import-files", "import-github"])(
    "opens a portable draft through %s",
    async (method) => {
      const metadata = await assetMetadata(
        "assets/beach.svg",
        "image/svg+xml",
        art,
      );
      const source = importPack({
        pack,
        bridge,
        document: "A quiet shore.",
        assets: [metadata],
      });
      source.id = "old-owner-id";
      source.revision = 9;
      const files = [
        file(
          "draft/card-world.json",
          new TextEncoder().encode(exportManifest(source)),
        ),
        file("draft/assets/beach.svg", art),
        jsonFile("draft/assets/nested.json", {}),
        ...sources(),
      ];
      const f = fixture(files);
      await get(f, method).run({}, f.context);
      expect(
        f.read().filter((tool) => tool.id.startsWith("import-pack-")),
      ).toHaveLength(2);
      await f
        .read()
        .find((tool) => tool.describe().note === "draft/card-world.json")
        .run({}, f.context);
      expect(f.store.write.mock.calls[0][1].draft).toMatchObject({
        id: null,
        revision: 0,
        document: source.document,
        pack,
        bridge,
      });
      if (method === "import-github")
        expect(f.store.write.mock.calls[0][1].draft.sources).toEqual([
          { ...origin, path: "draft/card-world.json" },
        ]);
    },
  );
  it("keeps the current draft when file selection is cancelled or reading fails", async () => {
    const cancelled = fixture(null);
    await get(cancelled, "import-folder").run({}, cancelled.context);
    expect(cancelled.context.save).not.toHaveBeenCalled();
    const f = fixture(
      sources().filter((entry) => !entry.path.endsWith(".svg")),
    );
    await get(f, "import-folder").run({}, f.context);
    await expect(candidate(f).run({}, f.context)).rejects.toThrow(
      "referenced file",
    );
    expect(f.store.write).not.toHaveBeenCalled();
    expect(f.context.open).not.toHaveBeenCalled();
    expect(candidate(f)).toBeDefined();
  });
  it("waits for the current draft save and new pack write before opening the import", async () => {
    const f = fixture();
    f.context.save.mockRejectedValueOnce(new Error("Save conflict"));
    await expect(get(f, "import-github").run({}, f.context)).rejects.toThrow(
      "Save conflict",
    );
    expect(f.github).not.toHaveBeenCalled();
    await get(f, "import-folder").run({}, f.context);
    f.store.write.mockRejectedValueOnce(new Error("Storage full"));
    await expect(candidate(f).run({}, f.context)).rejects.toThrow(
      "Storage full",
    );
    expect(f.context.open).not.toHaveBeenCalled();
    expect(candidate(f)).toBeDefined();
  });
  it("rejects a changed session's listing and callbacks from an older file list", async () => {
    const f = fixture();
    f.context.snapshot.mockImplementationOnce(() => {
      throw new Error("Selection changed");
    });
    await expect(get(f, "import-github").run({}, f.context)).rejects.toThrow(
      "Selection changed",
    );
    expect(candidate(f)).toBeUndefined();
    await get(f, "import-folder").run({}, f.context);
    const old = candidate(f);
    get(f, "import-github")
      .describe()
      .edit.onInput("https://github.com/other/world");
    await expect(old.run({}, f.context)).rejects.toThrow("current import list");
    expect(f.store.write).not.toHaveBeenCalled();
  });
});
