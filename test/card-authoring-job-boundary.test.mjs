import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { createJobSweep } from "../v2/card-game/authoring-job-sweep.mjs";
import { memoryJobStore } from "../v2/card-game/authoring-job-store.mjs";
import { createAuthoringSession } from "../v2/card-game/authoring-session.mjs";
import { createSeedMaker } from "../v2/card-game/authoring-seed-maker.mjs";
import { createAuthoringVisualTools } from "../v2/card-game/authoring-visual-tools.mjs";
import { authoringSeedTools } from "../v2/card-game/authoring-seed-tools.mjs";
import { createCharacterDraw } from "../v2/card-game/authoring-draw.mjs";
import {
  emptySeedWorld,
  seedEdit,
} from "../v2/card-game/authoring-seed-world.mjs";
import { avatarBinding } from "../v2/card-game/authoring-avatar-design.mjs";
import { fakeJobs } from "./helpers/fake-jobs.mjs";

const cards = [
  { kind: "place", name: "A quay", text: "From world A." },
  { kind: "avatar", name: "A keeper", text: "From world A." },
  { kind: "item", name: "A lamp", text: "From world A." },
];
const empty = () => ({ ...emptySeedWorld(), generation: 0 });
const gate = () => {
  let release;
  const promise = new Promise((resolve) => {
    release = resolve;
  });
  return { promise, release };
};
const seedRecord = {
  id: "job-a",
  draftKey: "A",
  kind: "seed",
  tool: "maker-seed",
  input: { kind: "world" },
  basis: "[[],null]",
};
function fixture(fetch, extra = {}) {
  const store = memoryJobStore(),
    writes = [],
    adopters = {};
  const session = createAuthoringSession({
    store: {
      async write(key, _record, generation) {
        writes.push(key);
        return generation + 1;
      },
    },
    onChange() {
      adopters.seed?.sync(session.state.source, session.status);
      adopters.image?.sync(session.state.source);
    },
  });
  session.open({ key: "A", record: empty() });
  const sweep = createJobSweep({
    store,
    adopters,
    fetch,
    run: (fn) => session.run(fn),
    throttleMs: 0,
    ...extra,
  });
  const options = {
    changed() {},
    choose() {},
    accounts: {},
    track: sweep.track,
  };
  adopters.seed = createSeedMaker({
    ...options,
    request: fetch,
    env: extra.env,
  });
  adopters.image = createAuthoringVisualTools({ ...options, fetch });
  adopters.seed.sync(session.state.source, session.status);
  return { store, session, sweep, writes, adopters };
}

for (const stage of [
  "records",
  "list",
  "read",
  "missing",
  "image",
  "image-bytes",
]) {
  it(`keeps A recovery intact after switching drafts during ${stage}`, async () => {
    const blocked = gate(),
      entered = gate(),
      finished = gate();
    let held = false;
    async function pause() {
      held = true;
      entered.release();
      await blocked.promise;
    }
    const server = fakeJobs();
    let job = {
      id: seedRecord.id,
      kind: "seed",
      status: "done",
      result: { cards },
    };
    const fetch = async (url) => {
      if (url.endsWith("/jobs")) {
        if (stage === "list") await pause();
        return Response.json({
          jobs: ["read", "missing"].includes(stage) ? [] : [job],
        });
      }
      if (url.includes("/jobs/")) {
        await pause();
        return Response.json(stage === "missing" ? {} : job, {
          status: stage === "missing" ? 404 : 200,
        });
      }
      if (stage === "image") await pause();
      const response = await server.fetch(url);
      if (stage === "image-bytes")
        return {
          ok: true,
          async arrayBuffer() {
            await pause();
            return response.arrayBuffer();
          },
        };
      return response;
    };
    const f = fixture(fetch);
    let rec = seedRecord;
    if (stage.startsWith("image")) {
      await f.session.accept(
        seedEdit(f.session.snapshot(), { kind: "world", cards }),
      );
      const before = f.session.snapshot({ assets: true });
      const id = Object.keys(before.draft.pack.avatars)[0];
      rec = {
        id: "image-a",
        draftKey: "A",
        kind: "image",
        toolId: `art-${id}-portrait`,
        avatarId: id,
        role: "portrait",
        description: "A keeper",
        basis: JSON.stringify([id, 1, null, 1]),
        binding: avatarBinding(before, id),
      };
      const image = server.put(
        new Uint8Array(
          readFileSync("v2/card-game/assets/authoring-guide/dino-design.png"),
        ),
      );
      job = {
        id: rec.id,
        kind: "image",
        status: "done",
        result: { image, basis: rec.basis },
      };
    }
    const before = f.session.snapshot({ assets: true });
    f.writes.length = 0;
    await f.store.putJob(rec);
    const read = f.store.readJobs;
    f.store.readJobs = async (key) => {
      if (key === "B") finished.release();
      if (stage === "records" && !held) await pause();
      return read(key);
    };
    f.sweep.open({ key: "A" });
    await entered.promise;
    f.session.open({ key: "B", record: before });
    f.sweep.open({ key: "B" });
    blocked.release();
    await finished.promise;
    expect(f.writes).toEqual([]);
    expect(f.session.snapshot().draft).toEqual(before.draft);
    expect(await read("A")).toEqual([rec]);
    expect(await read("B")).toEqual([]);
  });
}

it("rejects a seed result for a different draft even outside the sweep", async () => {
  const f = fixture();
  f.session.open({ key: "B", record: empty() });
  await expect(
    f.adopters.seed.adoptJob(
      { status: "done", result: { cards } },
      seedRecord,
      (fn) => f.session.run(fn),
    ),
  ).rejects.toThrow("editor changed");
  expect(f.writes).toEqual([]);
});

it("does not append recovered characters after metadata resolves in a new draft", async () => {
  const reading = gate(),
    blocked = gate(),
    finished = gate();
  const f = fixture(async () =>
    Response.json({
      jobs: [
        {
          id: "avatars-a",
          kind: "avatars",
          status: "done",
          result: {
            candidate: {
              name: "Keeper",
              specialAbility: "Light",
              description: "A keeper",
              aliases: [],
              suggested: true,
            },
          },
        },
      ],
    }),
  );
  const seed = authoringSeedTools({
    readNames: async () => {
      reading.release();
      await blocked.promise;
      return [];
    },
  });
  f.adopters.avatars = seed;
  seed.open({ key: "A" });
  const rec = { id: "avatars-a", draftKey: "A", kind: "avatars", mode: "idea" };
  await f.store.putJob(rec);
  const read = f.store.readJobs;
  f.store.readJobs = async (key) => {
    if (key === "B") finished.release();
    return read(key);
  };
  f.sweep.open({ key: "A" });
  await reading.promise;
  f.session.open({ key: "B", record: empty() });
  seed.open({ key: "B" });
  f.sweep.open({ key: "B" });
  blocked.release();
  await finished.promise;
  expect(seed.tools().filter((t) => t.kind === "avatar")).toEqual([]);
  expect(await read("A")).toEqual([rec]);
});

it("tracks a late seed POST under its initiating draft", async () => {
  const server = fakeJobs(),
    accepted = gate(),
    blocked = gate();
  const fetch = async (url, init) => {
    const response = await server.fetch(url, init);
    if (init?.method === "POST") {
      accepted.release();
      await blocked.promise;
    }
    return response;
  };
  const f = fixture(fetch, { env: server.env });
  f.sweep.open({ key: "A" });
  const tool = f.adopters.seed.tools().find((t) => t.id === "maker-seed");
  tool.describe({ status: f.session.status }).edit.onInput("A harbour");
  const run = f.session.run((context) => tool.run({}, context));
  const rejected = expect(run).rejects.toThrow("editor changed");
  await accepted.promise;
  f.session.open({ key: "B", record: empty() });
  f.sweep.open({ key: "B" });
  server.complete("job-1", { cards });
  blocked.release();
  await rejected;
  expect(await f.store.readJobs("A")).toMatchObject([
    { id: "job-1", draftKey: "A" },
  ]);
  expect(await f.store.readJobs("B")).toEqual([]);
  expect(f.writes).toEqual([]);
});

it("retains late accepted and dropped records under their original draft", async () => {
  const f = fixture();
  f.sweep.open({ key: "B" });
  await f.sweep.track.accepted(seedRecord);
  await f.sweep.track.dropped(seedRecord);
  expect(await f.store.readJobs("A")).toEqual([
    { ...seedRecord, dropped: true },
  ]);
  expect(await f.store.readJobs("B")).toEqual([]);
});

it("keeps a cancelled character reply recoverable in its initiating draft", async () => {
  const f = fixture(),
    started = gate(),
    blocked = gate();
  const draw = createCharacterDraw({
    track: f.sweep.track,
    generate: async (_input, options) => {
      started.release();
      await blocked.promise;
      await options.onJob({ id: "characters-a" });
      return null;
    },
  });
  f.sweep.open({ key: "A" });
  draw.setText("A keeper lives by the harbour.");
  const run = draw.find([], "A");
  await started.promise;
  draw.setMode("idea");
  f.sweep.open({ key: "B" });
  blocked.release();
  await run;
  expect(await f.store.readJobs("A")).toMatchObject([
    { id: "characters-a", draftKey: "A", mode: "extract" },
  ]);
  expect(await f.store.readJobs("B")).toEqual([]);
});
