import { expect, it, vi } from "vitest";
import { createAuthoringVisualTools } from "../v2/card-game/authoring-visual-tools.mjs";
import { createAuthoringSession } from "../v2/card-game/authoring-session.mjs";
import {
  emptySeedWorld,
  seedEdit,
} from "../v2/card-game/authoring-seed-world.mjs";
import { assetMetadata } from "../v2/card-game/authoring-draft.mjs";
import { POSE_ROLES } from "../v2/card-game/authoring-images.mjs";

async function fixture() {
  let tools,
    fail = false,
    selected;
  const session = createAuthoringSession({
    store: {
      write: async (_k, _r, n) => {
        if (fail) throw new Error("Storage full");
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
        { kind: "avatar", name: "Mara", text: "A keeper with a lamp." },
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
      split: async () => ({
        sheet: { ...image, role: "sheet" },
        cells: POSE_ROLES.map((role) => ({ ...image, role })),
      }),
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
    fail: (v) => {
      fail = v;
    },
    run: (role) => session.run((context) => tool(role).run({}, context)),
  };
}
it("reviews cutout before saving; failed save retries without another paid request", async () => {
  const f = await fixture();
  await f.run("portrait");
  expect(f.request).toHaveBeenCalledTimes(1);
  expect(f.session.state.source.pack.avatars[f.id].portrait).toBeUndefined();
  expect(f.tool("portrait").describe().actions[0].label).toBe(
    "Confirm artwork",
  );
  f.fail(true);
  await f.run("portrait");
  expect(f.tool("portrait").describe().note).toBe("Storage full");
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
  f.tools.clear();
  await f.run("portrait");
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
  f.session.stage({ document: "Another edit" });
  // Entity identity is checked before confirmation; session baseline guards all other edits.
  const discard = f.tools.tools().find((t) => t.name === "Discard artwork");
  discard.run();
  expect(f.tools.transient()).toBeNull();
  expect(f.session.state.source.pack.avatars[f.id].portrait).toBeUndefined();
});
