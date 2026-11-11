import { listGeneratedArt } from "../v2/card-game/authoring-art-library.mjs";
import { expect, it, vi } from "vitest";
import { createAuthoringVisualTools } from "../v2/card-game/authoring-visual-tools.mjs";
import { createAuthoringSession } from "../v2/card-game/authoring-session.mjs";
import {
  emptySeedWorld,
  seedEdit,
} from "../v2/card-game/authoring-seed-world.mjs";
import { authoringTools } from "../v2/card-game/authoring-tools.mjs";
import { TOOLS } from "../v2/card-game/authoring-collections.mjs";
import { assetMetadata } from "../v2/card-game/authoring-draft.mjs";
import { POSE_ROLES } from "../v2/card-game/authoring-images.mjs";

async function fixture(enterAppearance = true, options = {}) {
  let tools,
    fail = false,
    writes = 0,
    selected;
  const session = createAuthoringSession({
    store: {
      write: async (_k, _r, n) => {
        writes++;
        if (fail === true || fail === writes) throw new Error("Storage full");
        return n + 1;
      },
    },
    onChange: () => tools?.sync(session.state.source),
  });
  session.open({
    key: "world",
    record: { ...emptySeedWorld(), generation: 0 },
  });
  await session.accept(
    seedEdit(session.snapshot(), {
      kind: "world",
      cards: [
        { kind: "place", name: "Quay", text: "The ferry waits." },
        {
          kind: "avatar",
          name: "Mara",
          text: 'The keeper asks, "Where is my lamp?"',
        },
        { kind: "item", name: "Lamp", text: "A blue glass lamp." },
      ],
    }),
  );
  const bytes = Uint8Array.of(1, 2, 3),
    image = {
      ...(await assetMetadata("base.png", "image/png", bytes)),
      bytes,
    };
  const request = vi.fn(async () => ({ image }));
  tools = createAuthoringVisualTools({
    changed() {},
    choose: (id) => {
      selected = id;
    },
    accounts: { requireSignIn: () => "sign-in" },
    visualOptions: {
      request,
      reference: async () => ({}),
      split:
        options.split ||
        (async () => ({
          sheet: { ...image, role: "sheet" },
          cells: POSE_ROLES.map((role) => ({ ...image, role })),
        })),
    },
  });
  tools.sync(session.state.source);
  const id = Object.keys(session.state.source.pack.avatars)[0];
  const tool = (role) =>
    tools.tools().find((t) => t.id === `art-${id}-${role}`);
  return {
    tools,
    session,
    id,
    tool,
    request,
    selected: () => selected,
    writes: () => writes,
    fail: (v) => {
      fail = v;
    },
    run: async (role) => {
      await session.run((context) => tool(role).run({}, context));
      if (enterAppearance && tool(role).describe().edit) {
        tool(role).describe().edit.onInput("A keeper in a green coat.");
        await session.run((context) => tool(role).run({}, context));
      }
    },
  };
}
it("auto-saves first cutout and retries failed activation without another paid request", async () => {
  const f = await fixture();
  f.fail(f.writes() + 2); // archive succeeds, activation fails
  await f.run("portrait");
  expect(f.request).toHaveBeenCalledTimes(1);
  expect(f.session.state.source.pack.avatars[f.id].portrait).toBeUndefined();
  expect(f.tool("portrait").describe().actions[0].label).toBe(
    "Confirm artwork",
  );
  f.fail(false);
  await f.run("portrait");
  expect(f.request).toHaveBeenCalledTimes(1);
  expect(f.session.state.source.pack.avatars[f.id].portrait).toMatch(
    /base.png$/,
  );
  expect(f.tools.transient()).toBeNull();
});
it("makes one referenced pose request and exposes all six review cards", async () => {
  const f = await fixture();
  await expect(f.run("pose-sheet")).rejects.toThrow(
    /Confirm an avatar portrait/,
  );
  expect(f.tools.transient()).toBeNull();
  await f.run("portrait");
  await f.run("pose-sheet");
  expect(f.request).toHaveBeenCalledTimes(2);
  expect(f.request.mock.calls[1][0]).toMatchObject({
    role: "pose-sheet",
    kind: "avatar",
    reference: {},
  });
  expect(
    f.tools
      .tools()
      .filter((t) => t.id.includes("preview"))
      .map((t) => t.name),
  ).toEqual(["Avatar cutout", ...POSE_ROLES]);
  await f.run("pose-sheet");
  const saved = f.session.snapshot({ assets: true });
  for (const role of POSE_ROLES)
    expect(
      saved.draft.assets.some((a) => a.path.endsWith(`-${role}.png`)),
    ).toBe(true);
});
it("discards the preview without replacing saved artwork", async () => {
  const f = await fixture();
  await f.run("portrait");
  const old = f.session.state.source.pack.avatars[f.id].portrait;
  await f.run("portrait");
  f.session.stage({ document: "Another edit" });
  // Entity identity is checked before confirmation; session baseline guards all other edits.
  const discard = f.tools.tools().find((t) => t.name === "Discard artwork");
  discard.run();
  expect(f.tools.transient()).toBeNull();
  expect(f.session.state.source.pack.avatars[f.id].portrait).toBe(old);
  expect(
    (await listGeneratedArt(f.session.snapshot({ assets: true }), f.id)).length,
  ).toBe(3);
});
it("reprepares a failed save after unrelated edits without regenerating", async () => {
  const f = await fixture();
  f.fail(f.writes() + 2);
  await f.run("portrait");
  f.fail(false);
  f.session.stage({ document: "Updated world notes" });
  await f.session.save();
  await f.run("portrait");
  expect(f.request).toHaveBeenCalledTimes(1);
  expect(f.tools.transient()).toBeNull();
  expect(f.session.snapshot().draft.document).toBe("Updated world notes");
});
it("removing the preview owner releases all generation tools", async () => {
  const f = await fixture();
  await f.run("portrait");
  await f.session.accept(
    seedEdit(f.session.snapshot(), { kind: "avatar", discard: f.id }),
  );
  expect(f.tools.transient()).toBeNull();
});
it("reviews only the new cutout when replacing an avatar with saved poses", async () => {
  const f = await fixture();
  await f.run("portrait");
  await f.run("pose-sheet");
  await f.run("pose-sheet");
  await f.run("portrait");
  expect(
    f.tools
      .tools()
      .filter((t) => t.id.includes("preview"))
      .map((t) => t.name),
  ).toEqual(["Avatar cutout"]);
  expect(f.selected()).toBe(`art-${f.id}-portrait`);
});

it("never sends narrative as appearance and keeps it unchanged when art is saved", async () => {
  const f = await fixture(false);
  const narrative = f.session.state.source.pack.avatars[f.id].text;
  await f.run("portrait");
  expect(f.request).not.toHaveBeenCalled();
  expect(f.tool("portrait").describe().edit.value).toBe("");
  f.tool("portrait").describe().edit.onInput("A keeper in a green coat.");
  await f.run("portrait");
  expect(f.request.mock.calls[0][0].description).toBe(
    "A keeper in a green coat.",
  );
  expect(JSON.stringify(f.request.mock.calls[0][0])).not.toContain(narrative);
  expect(f.session.state.source.pack.avatars[f.id].text).toBe(narrative);
  f.tools.clear();
  await f.run("pose-sheet");
  expect(f.request.mock.calls[1][0].description).toBe(
    "A keeper in a green coat.",
  );
});

it("retries archiving the original after storage failure without generating again", async () => {
  const f = await fixture();
  f.fail(true);
  await f.run("portrait");
  expect(f.request).toHaveBeenCalledTimes(1);
  expect(f.tool("portrait").describe().actions[0].disabled).toBe(true);
  f.tools.clear(); // cannot silently discard unsaved paid bytes
  expect(f.tools.tools().some((t) => t.id === "retry-unsaved-artwork")).toBe(
    true,
  );
  // The designer projects tools into the Tools stack, never the world root.
  expect(() =>
    authoringTools(
      { world: [], tools: [{ id: TOOLS, name: "Tools" }] },
      f.tools.tools().filter((t) => t.id === "retry-unsaved-artwork"),
    ),
  ).not.toThrow();
  f.fail(false);
  await f.session.run((context) =>
    f.tools
      .tools()
      .find((t) => t.id === "retry-unsaved-artwork")
      .run({}, context),
  );
  const sets = await listGeneratedArt(
    f.session.snapshot({ assets: true }),
    f.id,
  );
  expect(sets).toHaveLength(1);
  expect(sets[0].images[0].bytes).toEqual(Uint8Array.of(1, 2, 3));
  expect(f.request).toHaveBeenCalledTimes(1);
});

it("retains the provider sheet when pose splitting fails", async () => {
  const f = await fixture(true, {
    split: async () => {
      throw new Error("Malformed sheet");
    },
  });
  await f.run("portrait");
  await f.run("pose-sheet");
  const sets = await listGeneratedArt(
    f.session.snapshot({ assets: true }),
    f.id,
  );
  const raw = sets.find((set) => set.rawOnly);
  expect(raw.images[0].role).toBe("sheet");
  expect(raw.images[0].bytes).toEqual(Uint8Array.of(1, 2, 3));
  expect(f.tool("pose-sheet").describe().note).toBe("Malformed sheet");
});
it("retains archived image bytes after removing the avatar and reloading", async () => {
  const f = await fixture();
  await f.run("portrait");
  const before = f.session.snapshot({ assets: true });
  await f.session.accept(
    seedEdit(f.session.snapshot(), { kind: "avatar", discard: f.id }),
  );
  const saved = f.session.snapshot({ assets: true });
  f.session.open({ key: "world", record: saved });
  expect(f.session.snapshot({ assets: true }).assets).toEqual(before.assets);
  expect(await listGeneratedArt(saved, f.id)).toHaveLength(1);
});
it("keeps the physical description when generation resumes after sign-in", async () => {
  const f = await fixture(false);
  await f.run("portrait");
  f.tool("portrait").describe().edit.onInput("A keeper in a green coat.");
  f.request.mockRejectedValueOnce(
    Object.assign(new Error("Sign in"), { status: 401 }),
  );
  await f.run("portrait");
  f.tools.signedIn();
  await f.run("portrait");
  expect(f.request).toHaveBeenCalledTimes(2);
  expect(f.request.mock.calls[1][0].description).toBe(
    "A keeper in a green coat.",
  );
  expect(f.session.state.source.pack.avatars[f.id].portrait).toBeTruthy();
});
it("archives a late paid response after its preview was closed", async () => {
  const f = await fixture(false);
  await f.run("portrait");
  f.tool("portrait").describe().edit.onInput("A keeper in a green coat.");
  let finish, begun;
  const started = new Promise((resolve) => {
    begun = resolve;
  });
  const bytes = Uint8Array.of(8, 9);
  const image = {
    ...(await assetMetadata("late.png", "image/png", bytes)),
    bytes,
  };
  f.request.mockImplementationOnce(() => {
    begun();
    return new Promise((resolve) => {
      finish = resolve;
    });
  });
  const running = f.run("portrait");
  await started;
  f.tools.clear();
  finish({ image });
  await running;
  const sets = await listGeneratedArt(
    f.session.snapshot({ assets: true }),
    f.id,
  );
  expect(sets).toHaveLength(1);
  expect(sets[0].images[0].bytes).toEqual(bytes);
  expect(f.session.state.source.pack.avatars[f.id].portrait).toBeUndefined();
});

it("does not lock other tools after a provider error or empty appearance entry", async () => {
  const f = await fixture(false);
  await f.run("portrait");
  expect(f.tools.pendingArtwork()).toBe(false);
  expect(f.tool("pose-sheet").describe().actions[0].disabled).toBe(false);
  f.tool("portrait").describe().edit.onInput("A keeper in a green coat.");
  f.request.mockRejectedValueOnce(new Error("Provider unavailable"));
  await f.run("portrait");
  expect(f.tool("portrait").describe().note).toBe("Provider unavailable");
  expect(f.tools.pendingArtwork()).toBe(false);
  expect(f.tool("pose-sheet").describe().actions[0].disabled).toBe(false);
  expect(f.tools.tools().some((t) => t.name === "Discard artwork")).toBe(false);
});
