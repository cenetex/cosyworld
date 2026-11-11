import { expect, it } from "vitest";
import { createSeedMaker } from "../v2/card-game/authoring-seed-maker.mjs";
import { emptySeedWorld } from "../v2/card-game/authoring-seed-world.mjs";
import { authoringSeedTools } from "../v2/card-game/authoring-seed-tools.mjs";
import { authoringTools } from "../v2/card-game/authoring-tools.mjs";
import { buildAuthoringTree } from "../v2/card-game/authoring-tree.mjs";
import { authoringCollections } from "../v2/card-game/authoring-collections.mjs";
import { createAuthoringSession } from "../v2/card-game/authoring-session.mjs";
const cards = [
  { kind: "place", name: "Quay", text: "The last ferry waits here." },
  { kind: "avatar", name: "Mara", text: "The keeper needs a lamp." },
  { kind: "item", name: "Lamp", text: "Blue glass shelters the flame." },
];
function fixture(request) {
  let maker,
    failed = false,
    selected,
    writes = 0;
  const session = createAuthoringSession({
    store: {
      async write(_key, _record, generation) {
        if (failed) throw new Error("Storage full");
        writes++;
        return generation + 1;
      },
    },
    onChange: () => maker?.sync(session.state.source, session.status),
  });
  session.open({
    key: "seed-world",
    record: { ...emptySeedWorld(), generation: 0 },
  });
  maker = createSeedMaker({
    request,
    changed() {},
    choose: (id) => {
      selected = id;
    },
    accounts: { requireSignIn: () => "sign-in" },
  });
  maker.sync(session.state.source, session.status);
  const tool = (id) => maker.tools().find((t) => t.id === id);
  const describe = () =>
    tool("maker-seed").describe({ status: session.status });
  describe().edit.onInput("A rainy harbour");
  return {
    maker,
    session,
    tool,
    describe,
    selected: () => selected,
    writes: () => writes,
    fail: (value) => {
      failed = value;
    },
    run: (id = "maker-seed") => session.run((ctx) => tool(id).run({}, ctx)),
  };
}
it("returns to the seed after sign-in and draws on the next action", async () => {
  let calls = 0;
  const f = fixture(async () =>
    ++calls === 1
      ? new Response("{}", { status: 401 })
      : Response.json({ cards }),
  );
  await f.run();
  expect(f.selected()).toBe("sign-in");
  expect(f.maker.signedIn()).toBe(true);
  expect(f.selected()).toBe("maker-seed");
  expect(f.describe().edit.value).toBe("A rainy harbour");
  expect(calls).toBe(1);
  expect(f.maker.signedIn()).toBe(false);
  await f.run();
  expect(calls).toBe(2);
  expect(f.writes()).toBe(1);
  expect(f.session.snapshot().draft.document).toBe("");
});
it("retries the prepared draw after a failed save without another request", async () => {
  let calls = 0;
  const f = fixture(async () => {
    calls++;
    return Response.json({ cards });
  });
  f.fail(true);
  await expect(f.run()).rejects.toThrow("Storage full");
  expect(f.describe().actions[0].label).toBe("Retry save");
  expect(f.session.snapshot().draft.pack.places).toEqual({});
  f.fail(false);
  await f.run();
  expect(calls).toBe(1);
  expect(f.writes()).toBe(1);
  const pack = f.session.snapshot().draft.pack;
  expect(pack.avatars[Object.keys(pack.avatars)[0]].want.target).toBe(
    Object.keys(pack.items)[0],
  );
});
it("keeps a changed draft safe from a late draw and lets the player draw again", async () => {
  let finish;
  const f = fixture(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const draw = f.run();
  f.session.touch();
  finish(Response.json({ cards }));
  await expect(draw).rejects.toThrow("editor changed");
  expect(f.writes()).toBe(0);
  expect(f.describe().actions[0].label).toBe("Create");
  const next = f.run();
  finish(Response.json({ cards }));
  await next;
  expect(f.writes()).toBe(1);
});
it("keeps a paid draw when another card is selected meanwhile", async () => {
  let finish;
  const f = fixture(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const draw = f.run();
  f.session.dispatch({ type: "cancel" });
  expect(f.describe()).toMatchObject({
    info: "Drawing…",
    actions: [{ label: "Drawing…", disabled: true }],
  });
  finish(Response.json({ cards }));
  await draw;
  expect(f.writes()).toBe(1);
  expect(f.selected()).toBe("world");
});
it("names why Create is disabled", () => {
  const f = fixture(async () => Response.json({ cards }));
  const label = () => f.describe().actions[0];
  expect(label()).toMatchObject({ label: "Create", disabled: false });
  f.describe().edit.onInput(" ");
  expect(label()).toMatchObject({ label: "Type a seed first", disabled: true });
  f.describe().edit.onInput("x".repeat(6001));
  expect(label()).toMatchObject({ label: "Seed is too long", disabled: true });
});
it("keeps the editor working after Show details and discarding every card", async () => {
  const f = fixture(async () => Response.json({ cards }));
  await f.run();
  await f.tool("maker-details").run({});
  expect(f.maker.detailed()).toBe(true);
  const seed = authoringSeedTools({});
  const project = () => {
    const source = f.session.state.source;
    const base = authoringCollections(buildAuthoringTree(source).cards, source);
    return authoringTools(f.maker.project(base), [
      ...(f.maker.detailed() ? seed.tools() : []),
      ...f.maker.tools(),
    ]);
  };
  expect(project).not.toThrow();
  const pack = f.session.state.source.pack;
  for (const id of [
    ...Object.keys(pack.items),
    ...Object.keys(pack.avatars),
    ...Object.keys(pack.places),
  ]) {
    await f.run(`discard-${id}`);
    expect(project).not.toThrow();
  }
  expect(f.maker.detailed()).toBe(false);
  expect(
    f.tool("maker-seed").describe({ status: f.session.status }),
  ).toBeTruthy();
});
