import { describe, it, expect, vi } from "vitest";
import { createArtLibraryTools } from "../v2/card-game/authoring-art-library-tools.mjs";
const image = {
  role: "base",
  mime: "image/png",
  bytes: new Uint8Array([1]),
  sha256: "digest",
};
function setup(
  found = [{ id: "a", label: "Saved 1", images: [image], rawOnly: false }],
) {
  const record = {
    key: "test",
    generation: 1,
    draft: {
      pack: {
        id: "test",
        avatars: { person: { name: "Person", text: "Story" } },
      },
      assets: [],
    },
    assets: new Map(),
  };
  const context = { snapshot: () => structuredClone(record), accept: vi.fn() };
  const list = vi.fn(async () => found),
    prepare = vi.fn(async (_record, value) => value);
  let blocked = false;
  const tools = createArtLibraryTools({
    list,
    prepare,
    blocked: () => blocked,
    read: async () => ({
      accepted: {
        name: "Person",
        description: "Story",
        specialAbility: "Storytelling",
        aliases: [],
      },
    }),
  });
  tools.sync({ pack: record.draft.pack });
  const browse = () => tools.tools()[0].run({}, context);
  return {
    tools,
    record,
    context,
    list,
    prepare,
    browse,
    block: (why = true) => {
      blocked = why;
    },
  };
}
describe("saved artwork selection", () => {
  it("browses stored previews and applies only after the explicit action", async () => {
    const t = setup();
    await t.browse();
    expect(t.context.accept).not.toHaveBeenCalled();
    const set = t.tools.tools().find((x) => x.id === "art-library-person-0");
    expect(set.art).toMatch(/^blob:/);
    expect(set.describe().actions[0]).toMatchObject({
      label: "Use avatar",
      confirm: true,
    });
    await set.run({}, t.context);
    expect(t.context.accept).toHaveBeenCalledOnce();
    expect(t.prepare.mock.calls[0][1]).toMatchObject({
      targetId: "person",
      images: [{ role: image.role, mime: image.mime, bytes: image.bytes }],
      accepted: { description: "Story" },
    });
    expect(t.tools.tools()).toHaveLength(1);
  });
  it("retains raw sheets for viewing without offering them as valid pose sets", async () => {
    const t = setup([
      {
        id: "raw",
        label: "Raw",
        rawOnly: true,
        images: [{ ...image, role: "sheet" }],
      },
    ]);
    await t.browse();
    const set = t.tools.tools()[1];
    expect(set.describe().actions).toEqual([]);
    expect(t.context.accept).not.toHaveBeenCalled();
  });
  it("does not replace a different variant or an avatar edited after browse", async () => {
    const t = setup();
    await t.browse();
    t.record.draft.pack.avatars.person.name = "Renamed";
    await expect(t.tools.tools()[1].run({}, t.context)).rejects.toThrow(
      "changed",
    );
    const other = setup([
      { id: "v", label: "Asleep", variant: "asleep", images: [image] },
    ]);
    await other.browse();
    expect(other.tools.tools()[1].describe().actions[0].disabled).toBe(true);
    await expect(other.tools.tools()[1].run({}, other.context)).rejects.toThrow(
      "variant",
    );
  });
  it("blocks reselecting while generated artwork is pending", async () => {
    const t = setup();
    await t.browse();
    t.block();
    expect(t.tools.tools()[1].describe().actions[0].disabled).toBe(true);
    await expect(t.tools.tools()[1].run({}, t.context)).rejects.toThrow(
      "Finish",
    );
  });
  it("names why Browse and Use are disabled", async () => {
    const t = setup();
    let finish;
    t.list.mockImplementationOnce(
      () => new Promise((resolve) => (finish = resolve)),
    );
    const browsing = t.browse();
    expect(t.tools.tools()[0].describe().actions[0]).toMatchObject({
      label: "Looking through saved artwork…",
      disabled: true,
    });
    finish([{ id: "a", label: "Saved 1", images: [image] }]);
    await browsing;
    t.block("Save the artwork first");
    for (const tool of t.tools.tools().slice(0, 2))
      expect(tool.describe().actions[0]).toMatchObject({
        label: "Save the artwork first",
        disabled: true,
      });
  });
  it("deduplicates previews without deleting assets and clears removed owners", async () => {
    const set = { id: "a", label: "Saved", images: [image] };
    const t = setup([set, { ...set, id: "b" }]);
    const before = structuredClone(t.record);
    await t.browse();
    expect(t.tools.tools()).toHaveLength(3);
    expect(t.record).toEqual(before);
    t.tools.sync({ pack: { avatars: {} } });
    expect(t.tools.tools()).toHaveLength(0);
  });
});
