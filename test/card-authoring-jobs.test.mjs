import { authoringSeedTools } from "../v2/card-game/authoring-seed-tools.mjs";
import { avatarBinding } from "../v2/card-game/authoring-avatar-design.mjs";
import { readFileSync } from "node:fs";
import { afterEach, expect, it, vi } from "vitest";
import { fakeJobs } from "./helpers/fake-jobs.mjs";
import {
  awaitJob,
  createCooldown,
  createJob,
  fetchJobImage,
  humanWait,
  isLive,
  listJobs,
  runJob,
} from "../v2/card-game/authoring-jobs.mjs";
import { memoryJobStore } from "../v2/card-game/authoring-job-store.mjs";
import { createJobSweep } from "../v2/card-game/authoring-job-sweep.mjs";
import { requestAuthoringImage } from "../v2/card-game/authoring-images.mjs";
import { createAuthoringVisualTools } from "../v2/card-game/authoring-visual-tools.mjs";
import { listGeneratedArt } from "../v2/card-game/authoring-art-library.mjs";
import { createAuthoringSession } from "../v2/card-game/authoring-session.mjs";
import { createSeedMaker } from "../v2/card-game/authoring-seed-maker.mjs";
import {
  emptySeedWorld,
  seedEdit,
} from "../v2/card-game/authoring-seed-world.mjs";
import {
  createCharacterDraw,
  generateCharacter,
} from "../v2/card-game/authoring-draw.mjs";
import { POSE_ROLES } from "../v2/card-game/authoring-images.mjs";

const png = new Uint8Array(
  readFileSync("v2/card-game/assets/authoring-guide/dino-design.png"),
);
const decode = () => ({ width: 1536, height: 864, close() {} });
const cards = [
  { kind: "place", name: "Quay", text: "The ferry waits." },
  {
    kind: "avatar",
    name: "Mara",
    text: 'The keeper asks, "Where is my lamp?"',
  },
  { kind: "item", name: "Lamp", text: "A blue glass lamp." },
];
const imageResult = (server, request) => ({
  image: server.put(png),
  basis: request.basis,
  model: "configured-image-model",
  usage: { images: 1 },
});
const cleanup = [];
afterEach(() => {
  while (cleanup.length) cleanup.pop()();
});

// Client -----------------------------------------------------------------

it("creates, polls with a rising delay and returns each kind's result", async () => {
  for (const [kind, request, result] of [
    ["seed", { seed: "x", kind: "world" }, { cards }],
    ["avatars", { sample: "x" }, { candidate: null, model: "m", usage: {} }],
    ["image", { role: "portrait" }, { image: { sha256: "a".repeat(64) } }],
  ]) {
    const server = fakeJobs({ auto: () => result, polls: 7 });
    expect(await runJob(kind, request, server)).toEqual(result);
    expect(server.posts).toHaveLength(1);
    expect(server.posts[0]).toMatchObject({ kind, request });
    expect(server.waits).toEqual([1000, 1500, 2250, 3375, 5000, 5000, 5000]);
  }
});

it("keeps polling through a network blip without losing the job", async () => {
  const server = fakeJobs({ auto: () => ({ cards }), polls: 3 });
  let reads = 0;
  const flaky = (url, init) =>
    /\/jobs\/job-1$/u.test(url) && ++reads === 2
      ? Promise.reject(new TypeError("blip"))
      : server.fetch(url, init);
  const result = await runJob("seed", {}, { ...server, fetch: flaky });
  expect(result).toEqual({ cards });
  expect(server.posts).toHaveLength(1);
});

it("stops at a definitive answer from the server", async () => {
  const server = fakeJobs();
  const job = await createJob("seed", {}, server);
  const gone = (url) =>
    Promise.resolve(
      Response.json({ error: "none", code: "job_not_found" }, { status: 404 }),
    );
  await expect(awaitJob(job, { ...server, fetch: gone })).rejects.toMatchObject(
    { status: 404 },
  );
  const signedOut = () =>
    Promise.resolve(Response.json({ error: "Sign in" }, { status: 401 }));
  await expect(
    awaitJob(job, { ...server, fetch: signedOut }),
  ).rejects.toMatchObject({ status: 401 });
});

it("reuses the idempotency key after a dropped reply and mints a new one after an answer", async () => {
  const server = fakeJobs({ auto: () => ({ cards }) });
  const keys = [];
  const spy = (url, init) => {
    if (init?.method === "POST") keys.push(init.headers["Idempotency-Key"]);
    return server.fetch(url, init);
  };
  server.dropNextReply();
  const first = await createJob("seed", { n: 1 }, { ...server, fetch: spy });
  expect(keys).toHaveLength(2);
  expect(keys[0]).toBe(keys[1]);
  expect(server.jobs.size).toBe(1);
  expect(first.id).toBe("job-1");
  // The same request, asked again after the server answered, is a new job.
  await createJob("seed", { n: 1 }, { ...server, fetch: spy });
  expect(keys[2]).not.toBe(keys[0]);
  expect(server.jobs.size).toBe(2);
  // Offline for good: no job is made and the key survives for the next try.
  server.offline(true);
  await expect(
    createJob("seed", { n: 2 }, { ...server, fetch: spy }),
  ).rejects.toMatchObject({ code: "network" });
  server.offline(false);
  await createJob("seed", { n: 2 }, { ...server, fetch: spy });
  expect(server.jobs.size).toBe(3);
});

it("pauses polling while the tab is hidden and resumes on return", async () => {
  const server = fakeJobs({ auto: () => ({ cards }), polls: 1 });
  server.hide();
  let reads = 0;
  const count = (url, init) => {
    if (/\/jobs\/job-1$/u.test(url)) reads++;
    return server.fetch(url, init);
  };
  const waiting = runJob("seed", {}, { ...server, fetch: count });
  await vi.waitFor(() => expect(server.posts).toHaveLength(1));
  await new Promise((resolve) => setTimeout(resolve, 20));
  expect(reads).toBe(0);
  server.show();
  expect(await waiting).toEqual({ cards });
  expect(reads).toBeGreaterThan(0);
});

it("gives up only at the server deadline plus a margin and keeps the job", async () => {
  const server = fakeJobs();
  const job = await createJob("image", {}, server);
  const waiting = awaitJob({ ...job, kind: "image" }, server);
  server.advance(200_000);
  await new Promise((resolve) => setTimeout(resolve, 10));
  server.advance(20_000);
  await expect(waiting).rejects.toMatchObject({ code: "generation_waiting" });
  expect(server.jobs.get(job.id).status).toBe("queued");
  expect((await listJobs(server)).map((j) => j.id)).toEqual([job.id]);
});

it.each([
  ["inference_timeout", "The model took too long.", 0],
  ["inference_provider_error", "The model refused this request.", 0],
  ["generation_timeout", "This took too long.", 0],
  ["generation_invalid_output", "The reply was unusable.", 0],
  ["image_layout_invalid", "The pose sheet did not split into six cells.", 0],
  ["image_model_unexpected", "The image came from another model.", 0],
  ["authoring_storage_full", "Your file storage is full.", 0],
  ["generation_interrupted", "The server restarted. Start this again.", 0],
])(
  "shows the server's message for a failed job (%s)",
  async (code, message) => {
    const server = fakeJobs({
      auto: () => ({ error: { message, code, retryAfterMs: 0 } }),
    });
    await expect(runJob("seed", {}, server)).rejects.toMatchObject({
      message,
      code,
    });
  },
);

it("says when to try again after a budget stop or a busy refusal", async () => {
  const budget = fakeJobs({
    auto: () => ({
      error: {
        message: "The daily budget is spent and resets at 00:00 UTC.",
        code: "inference_daily_spend_exhausted",
        retryAfterMs: 3 * 3600_000,
      },
    }),
  });
  await expect(runJob("image", {}, budget)).rejects.toMatchObject({
    message:
      "The daily budget is spent and resets at 00:00 UTC. Try again in 3 h.",
    retryAfterMs: 3 * 3600_000,
  });
  const busy = fakeJobs();
  busy.refuseNext(429, {
    error: "You already have an image running.",
    code: "generation_busy_owner",
    retryAfterMs: 12_000,
  });
  await expect(runJob("image", {}, busy)).rejects.toMatchObject({
    message: "You already have an image running. Try again in 12 s.",
    status: 429,
    code: "generation_busy_owner",
    retryAfterMs: 12_000,
  });
  expect(humanWait(200)).toBe("1 s");
  expect(humanWait(95_000)).toBe("2 min");
});

it("counts a refusal down and re-enables after retryAfterMs", () => {
  vi.useFakeTimers();
  cleanup.push(() => vi.useRealTimers());
  let now = 0;
  const changed = vi.fn();
  const cool = createCooldown({ changed, now: () => now });
  cleanup.push(() => cool.clear());
  cool.set("image", {
    status: 429,
    code: "generation_rate",
    retryAfterMs: 3000,
  });
  expect(cool.label("image")).toBe("Try again in 3 s");
  expect(cool.label("seed")).toBe("");
  now = 2000;
  vi.advanceTimersByTime(1000);
  expect(changed).toHaveBeenCalled();
  expect(cool.label("image")).toBe("Try again in 1 s");
  now = 3000;
  expect(cool.label("image")).toBe("");
});

it("reads a stored image only if its size and digest match", async () => {
  const server = fakeJobs();
  const stored = server.put(png);
  expect(await fetchJobImage(stored, server)).toEqual(png);
  await expect(
    fetchJobImage({ ...stored, size: stored.size - 1 }, server),
  ).rejects.toThrow(/digest/);
});

// Maker, reload and reattach ----------------------------------------------

function persistence() {
  const saved = new Map();
  return {
    saved,
    store: {
      async write(key, record, generation, files) {
        saved.set(key, {
          key,
          generation: generation + 1,
          draft: record.draft,
          launch: record.launch,
          assets: files ?? saved.get(key)?.assets ?? new Map(),
        });
        return generation + 1;
      },
    },
    read: (key) => structuredClone(saved.get(key)),
  };
}
// One browser tab: its own session and tools; the server and job store are
// shared, as the real server and the browser's database are across a reload.
function tab({
  server,
  disk,
  jobStore,
  record,
  cooldownAt = () => server.clock,
}) {
  let dead = false;
  const gone = () => Object.assign(new Error("closed"), { code: "network" });
  const env = {
    ...server.env,
    wait: async (ms, signal) => {
      if (dead) throw gone();
      await server.env.wait(ms, signal);
      if (dead) throw gone();
    },
  };
  const fetch = (url, init) =>
    dead ? Promise.reject(new TypeError("closed")) : server.fetch(url, init);
  let selected, visuals, maker;
  const adopters = {};
  const session = createAuthoringSession({
    store: disk.store,
    onChange: () => {
      visuals?.sync(session.state.source);
      maker?.sync(session.state.source, session.status);
    },
  });
  session.open({ key: "world", record });
  const sweep = createJobSweep({
    store: jobStore,
    adopters,
    run: (callback) => session.run(callback),
    env,
    fetch,
    retryMs: 5,
    throttleMs: 0,
  });
  const cooldown = createCooldown({ changed() {}, now: cooldownAt });
  cleanup.push(() => cooldown.clear());
  visuals = createAuthoringVisualTools({
    changed() {},
    choose: (id) => {
      selected = id;
    },
    accounts: { requireSignIn: () => "sign-in" },
    track: sweep.track,
    poke: sweep.poke,
    cooldown,
    fetch,
    env,
    visualOptions: {
      request: (input, options) =>
        requestAuthoringImage(input, { ...options, fetch, env, decode }),
      reference: async () => ({}),
      split: async (image) => ({
        sheet: { ...image, role: "sheet" },
        cells: POSE_ROLES.map((role) => ({ ...image, role })),
      }),
    },
  });
  maker = createSeedMaker({
    request: fetch,
    env,
    changed() {},
    choose: (id) => {
      selected = id;
    },
    accounts: { requireSignIn: () => "sign-in" },
    track: sweep.track,
    poke: sweep.poke,
    cooldown,
  });
  Object.assign(adopters, { image: visuals, seed: maker });
  visuals.sync(session.state.source);
  maker.sync(session.state.source, session.status);
  sweep.open({ key: "world" });
  const id = () => Object.keys(session.state.source.pack.avatars)[0];
  const tool = (role) =>
    visuals.tools().find((t) => t.id === `art-${id()}-${role}`);
  return {
    session,
    adopters,
    visuals,
    maker,
    sweep,
    cooldown,
    id,
    tool,
    // The page goes away: its waits fail and its holds on jobs end.
    kill: async () => {
      dead = true;
      await vi.waitFor(() => {
        for (const id of server.jobs.keys()) expect(isLive(id)).toBe(false);
      });
    },
    selected: () => selected,
    makerTool: (name) => maker.tools().find((t) => t.id === name),
    // Opens the description box, types it and starts the paid request.
    async start(
      role = "portrait",
      text = "A keeper in a green coat.",
      described = false,
    ) {
      if (!described) {
        await session.run((ctx) => tool(role).run({}, ctx));
        tool(role).describe().edit.onInput(text);
      }
      const run = session.run((ctx) => tool(role).run({}, ctx));
      run.catch(() => {});
      return { done: run };
    },
    portrait: () => session.state.source.pack.avatars[id()]?.portrait,
    library: async () =>
      listGeneratedArt(session.snapshot({ assets: true }), id()),
  };
}
async function madeWorld(server, jobStore = memoryJobStore()) {
  const disk = persistence();
  const first = tab({
    server,
    disk,
    jobStore,
    record: { ...emptySeedWorld(), generation: 0 },
  });
  await first.session.accept(
    seedEdit(first.session.snapshot(), { kind: "world", cards }),
  );
  await first.kill();
  const reopen = (extra = {}) =>
    tab({ server, disk, jobStore, record: disk.read("world"), ...extra });
  return { disk, jobStore, reopen, first };
}

it("applies the first portrait when its card is not selected meanwhile", async () => {
  const server = fakeJobs();
  const { reopen, jobStore } = await madeWorld(server);
  const t = reopen();
  await t.start();
  await vi.waitFor(() => expect(server.posts).toHaveLength(1));
  expect((await jobStore.readJobs("world"))[0]).toMatchObject({
    kind: "image",
    role: "portrait",
  });
  t.session.dispatch({ type: "cancel" });
  server.complete("job-1", imageResult(server, server.posts[0].request));
  await vi.waitFor(() => expect(t.portrait()).toMatch(/base.png$/));
  await vi.waitFor(async () =>
    expect(await jobStore.readJobs("world")).toEqual([]),
  );
  expect((await t.library()).map((set) => set.label.split(" ")[0])).toEqual([
    "Generated",
    "Saved",
  ]);
});

it("reattaches after a reload: a running job shows its label, then lands", async () => {
  const server = fakeJobs();
  const { reopen, jobStore } = await madeWorld(server);
  const before = reopen();
  await before.start();
  await vi.waitFor(() => expect(server.posts).toHaveLength(1));
  await before.kill(); // the tab closes with the job running
  await vi.waitFor(async () =>
    expect(await jobStore.readJobs("world")).toHaveLength(1),
  );
  server.status("job-1", "running");
  const after = reopen();
  expect(after.portrait()).toBeUndefined();
  after.sweep.open({ key: "world" });
  await vi.waitFor(() =>
    expect(after.tool("portrait").describe().actions[0]).toMatchObject({
      label: "Generating…",
      disabled: true,
    }),
  );
  server.complete("job-1", imageResult(server, server.posts[0].request));
  await vi.waitFor(() => expect(after.portrait()).toMatch(/base.png$/));
  expect(after.tool("portrait").describe().actions[0].label).toBe(
    "Generate avatar",
  );
  expect(await jobStore.readJobs("world")).toEqual([]);
  expect(await after.library()).toHaveLength(2);
});

it("shows the queued label for a job still waiting in line", async () => {
  const server = fakeJobs();
  const { reopen } = await madeWorld(server);
  const before = reopen();
  await before.start();
  await vi.waitFor(() => expect(server.posts).toHaveLength(1));
  expect(before.tool("portrait").describe().actions[0].label).toBe(
    "Waiting in line…",
  );
  await before.kill();
});

it("applies a replacement portrait as a preview that waits for Confirm artwork", async () => {
  const server = fakeJobs();
  const { reopen } = await madeWorld(server);
  const first = reopen();
  await first.start();
  await vi.waitFor(() => expect(server.posts).toHaveLength(1));
  server.complete("job-1", imageResult(server, server.posts[0].request));
  await vi.waitFor(() => expect(first.portrait()).toBeTruthy());
  await first.kill();
  const settled = first.portrait();
  const second = reopen();
  await second.start("portrait", undefined, true);
  await vi.waitFor(() => expect(server.posts).toHaveLength(2));
  await second.kill();
  server.complete("job-2", imageResult(server, server.posts[1].request));
  const third = reopen();
  third.sweep.open({ key: "world" });
  await vi.waitFor(() =>
    expect(third.tool("portrait").describe().actions[0].label).toBe(
      "Confirm artwork",
    ),
  );
  expect(third.portrait()).toBe(settled);
  expect(third.visuals.pendingArtwork()).toBe(true);
});

it("keeps a result that finished after the avatar changed in the library, with a note", async () => {
  const server = fakeJobs();
  const { reopen, jobStore } = await madeWorld(server);
  const before = reopen();
  await before.start();
  await vi.waitFor(() => expect(server.posts).toHaveLength(1));
  await before.kill();
  const after = reopen();
  await after.session.accept(
    seedEdit(after.session.snapshot(), {
      kind: "avatar",
      replacing: after.id(),
      cards: [{ kind: "avatar", name: "Mara", text: "She is a ferrywoman." }],
    }),
  );
  server.complete("job-1", imageResult(server, server.posts[0].request));
  after.sweep.open({ key: "world" });
  await vi.waitFor(async () => expect(await after.library()).toHaveLength(1));
  expect(after.portrait()).toBeUndefined();
  expect(after.tool("portrait").describe().note).toContain(
    "saved to Browse artwork, not applied",
  );
  await vi.waitFor(async () =>
    expect(await jobStore.readJobs("world")).toEqual([]),
  );
});

it("does not apply a result the tab stopped waiting for", async () => {
  const server = fakeJobs();
  const { reopen, jobStore } = await madeWorld(server);
  const before = reopen();
  await before.start();
  await vi.waitFor(() => expect(server.posts).toHaveLength(1));
  before.visuals.clear(); // the maker discarded the request
  await vi.waitFor(async () =>
    expect((await jobStore.readJobs("world"))[0]?.dropped).toBe(true),
  );
  server.complete("job-1", imageResult(server, server.posts[0].request));
  const after = reopen();
  after.sweep.open({ key: "world" });
  await vi.waitFor(async () => expect(await after.library()).toHaveLength(1));
  expect(after.portrait()).toBeUndefined();
});

it.each([
  [true, true],
  [true, false],
  [false, true],
  [false, false],
])(
  "retains an unarchived image across storage failure (dropped: %s, reload: %s)",
  async (dropped, reload) => {
    const server = fakeJobs();
    const { reopen, jobStore, disk } = await madeWorld(server);
    const before = reopen();
    await before.start();
    await vi.waitFor(() => expect(server.posts).toHaveLength(1));
    await before.kill();
    const [rec] = await jobStore.readJobs("world");
    await jobStore.putJob({ ...rec, dropped });
    server.complete("job-1", imageResult(server, server.posts[0].request));
    const write = disk.store.write;
    disk.store.write = async () => {
      throw new DOMException("Device full", "QuotaExceededError");
    };
    const after = reopen();
    const retry = () =>
      after.visuals.tools().find((t) => t.id === "retry-unsaved-artwork");
    await vi.waitFor(() => {
      expect(retry()?.describe().note).toContain(
        "could not be saved: Device full",
      );
      expect(after.session.status.busy).toBe(false);
    });
    expect(await after.library()).toEqual([]);
    expect(after.tool("portrait").describe().note).not.toContain(
      "saved to Browse artwork",
    );
    expect(await jobStore.readJobs("world")).toHaveLength(1);
    disk.store.write = write;
    let saved = after;
    if (reload) {
      await after.kill();
      saved = reopen();
    } else await after.session.run((context) => retry().run({}, context));
    await vi.waitFor(async () =>
      expect((await saved.library()).length).toBeGreaterThan(0),
    );
    await vi.waitFor(async () =>
      expect(await jobStore.readJobs("world")).toEqual([]),
    );
    expect(server.posts).toHaveLength(1);
  },
);

it("shows a failed job's message, including after a reload", async () => {
  const server = fakeJobs();
  const { reopen } = await madeWorld(server);
  const before = reopen();
  await before.start();
  await vi.waitFor(() => expect(server.posts).toHaveLength(1));
  await before.kill();
  server.fail("job-1", {
    message: "The pose sheet did not split into six equal cells.",
    code: "image_layout_invalid",
    retryAfterMs: 0,
  });
  const after = reopen();
  after.sweep.open({ key: "world" });
  await vi.waitFor(() =>
    expect(after.tool("portrait").describe().note).toBe(
      "The pose sheet did not split into six equal cells.",
    ),
  );
  expect(after.tool("portrait").describe().actions[0].disabled).toBe(false);
});

it("names a busy refusal in the note and the button, then re-enables it", async () => {
  const server = fakeJobs();
  const { reopen } = await madeWorld(server);
  const t = reopen();
  server.refuseNext(429, {
    error: "You already have an image running.",
    code: "generation_busy_owner",
    retryAfterMs: 12_000,
  });
  await (
    await t.start()
  ).done;
  const view = t.tool("portrait").describe();
  expect(view.note).toBe(
    "You already have an image running. Try again in 12 s.",
  );
  expect(view.actions[0]).toMatchObject({
    label: "Try again in 12 s",
    disabled: true,
  });
  server.advance(13_000);
  expect(t.tool("portrait").describe().actions[0]).toMatchObject({
    label: "Generate avatar",
    disabled: false,
  });
});

it("applies a seed draw found again after a reload, only to the world it was asked for", async () => {
  const server = fakeJobs();
  const jobStore = memoryJobStore();
  const disk = persistence();
  const open = (record) => tab({ server, disk, jobStore, record });
  const empty = { ...emptySeedWorld(), generation: 0 };
  const before = open(empty);
  before.maker.sync(before.session.state.source, before.session.status);
  const form = before
    .makerTool("maker-seed")
    .describe({ status: before.session.status });
  form.edit.onInput("A rainy harbour");
  const run = before.session.run((ctx) =>
    before.makerTool("maker-seed").run({}, ctx),
  );
  run.catch(() => {});
  await vi.waitFor(() => expect(server.posts).toHaveLength(1));
  expect((await jobStore.readJobs("world"))[0]).toMatchObject({
    kind: "seed",
    tool: "maker-seed",
  });
  await before.kill();
  server.complete("job-1", { cards });
  const after = open(empty);
  after.sweep.open({ key: "world" });
  await vi.waitFor(() =>
    expect(Object.keys(after.session.state.source.pack.avatars)).toHaveLength(
      1,
    ),
  );
  expect(after.selected()).toBe("world");
  expect(await jobStore.readJobs("world")).toEqual([]);
});

it("does not apply a seed draw over a world that changed, and says so", async () => {
  const server = fakeJobs();
  const jobStore = memoryJobStore();
  const disk = persistence();
  const empty = { ...emptySeedWorld(), generation: 0 };
  const before = tab({ server, disk, jobStore, record: empty });
  before
    .makerTool("maker-seed")
    .describe({ status: before.session.status })
    .edit.onInput("A rainy harbour");
  before.session
    .run((ctx) => before.makerTool("maker-seed").run({}, ctx))
    .catch(() => {});
  await vi.waitFor(() => expect(server.posts).toHaveLength(1));
  await before.kill();
  const after = tab({ server, disk, jobStore, record: empty });
  await after.session.accept(
    seedEdit(after.session.snapshot(), {
      kind: "world",
      cards: [
        { kind: "place", name: "Hill", text: "A windy hill." },
        { kind: "avatar", name: "Pip", text: "A shepherd." },
        { kind: "item", name: "Crook", text: "A bent staff." },
      ],
    }),
  );
  server.complete("job-1", { cards });
  after.sweep.open({ key: "world" });
  await vi.waitFor(() =>
    expect(
      after.makerTool("maker-seed").describe({ status: after.session.status })
        .note,
    ).toContain("not applied"),
  );
  expect(Object.values(after.session.state.source.pack.avatars)[0].name).toBe(
    "Pip",
  );
});

it("records each character reply as a job and adopts a reply after a reload", async () => {
  let n = 0;
  const server = fakeJobs({
    auto: () => ({
      candidate: {
        name: `Wanderer ${"abcdef"[n++]}`,
        specialAbility: "The Lightbearer",
        description: "A gentle traveller.",
        aliases: [],
        suggested: true,
      },
    }),
  });
  const tracked = [];
  const track = {
    accepted: async (job) => tracked.push(["accepted", job.kind, job.mode]),
    settled: async () => tracked.push(["settled"]),
    dropped() {},
  };
  const draw = createCharacterDraw({
    generate: generateCharacter,
    fetch: server.fetch,
    env: server.env,
    track,
    randomSeed: () => 1,
  });
  draw.setMode("idea");
  draw.setText("A rainy harbour town of lamplighters.");
  await draw.find();
  expect(draw.state.cards).toHaveLength(6);
  expect(tracked.filter(([event]) => event === "accepted")).toHaveLength(6);
  expect(tracked.filter(([event]) => event === "settled")).toHaveLength(6);
  expect(tracked[0]).toEqual(["accepted", "avatars", "idea"]);
  const fresh = createCharacterDraw({});
  fresh.setMode("idea");
  const candidate = {
    name: "Nia",
    specialAbility: "The Ferrywoman",
    description: "She rows at dusk.",
    aliases: [],
    suggested: true,
  };
  expect(fresh.adopt(candidate, "s", [])).toBe(true);
  expect(fresh.adopt(candidate, "s", [])).toBe(true);
  expect(fresh.adopt(candidate, "s", [{ name: "Nia", aliases: [] }])).toBe(
    false,
  );
  expect(fresh.state.cards.map((card) => card.name)).toEqual(["Nia"]);
});

// Draft boundaries during asynchronous recovery --------------------------

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
function boundaryFixture(fetch, extra = {}) {
  const server = { ...fakeJobs(), ...extra };
  if (fetch) server.fetch = fetch;
  const disk = persistence(),
    store = memoryJobStore(),
    writes = [];
  const write = disk.store.write;
  disk.store.write = (...args) => {
    writes.push(args[0]);
    return write(...args);
  };
  const t = tab({ server, disk, jobStore: store, record: empty() });
  t.session.open({ key: "A", record: empty() });
  return { ...t, store, writes };
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
    const f = boundaryFixture(fetch);
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
      const image = server.put(png);
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
  const f = boundaryFixture();
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
  const f = boundaryFixture(async () =>
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
  const f = boundaryFixture(fetch, { env: server.env });
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
  const f = boundaryFixture();
  f.sweep.open({ key: "B" });
  await f.sweep.track.accepted(seedRecord);
  await f.sweep.track.dropped(seedRecord);
  expect(await f.store.readJobs("A")).toEqual([
    { ...seedRecord, dropped: true },
  ]);
  expect(await f.store.readJobs("B")).toEqual([]);
});

it.each([false, true])(
  "keeps a cancelled character reply recoverable (aborted: %s)",
  async (abort) => {
    const f = boundaryFixture(),
      started = gate(),
      blocked = gate();
    const draw = createCharacterDraw({
      track: f.sweep.track,
      generate: async (_input, options) => {
        started.release();
        await blocked.promise;
        await options.onJob({ id: "characters-a" });
        if (abort) options.signal.throwIfAborted();
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
  },
);

it("clears a previous draft's waiting label before opening another draft", async () => {
  const server = fakeJobs();
  const job = await createJob("seed", {}, server);
  const f = boundaryFixture(server.fetch, { env: server.env });
  await f.store.putJob({ ...seedRecord, id: job.id });
  f.sweep.open({ key: "A" });
  const form = () =>
    f.adopters.seed
      .tools()
      .find((t) => t.id === "maker-seed")
      .describe({ status: f.session.status });
  await vi.waitFor(() =>
    expect(form().actions[0].label).toBe("Waiting in line…"),
  );
  f.session.open({ key: "B", record: empty() });
  f.sweep.open({ key: "B" });
  form().edit.onInput("World B");
  await vi.waitFor(() => expect(isLive(job.id)).toBe(false));
  expect(form().actions[0]).toMatchObject({ label: "Create", disabled: false });
  expect(await f.store.readJobs("A")).toHaveLength(1);
});

it.each([false, true])(
  "keeps unsaved artwork with A across import (during IO: %s)",
  async (during) => {
    const server = fakeJobs(),
      blocked = gate(),
      entered = gate();
    let job;
    const f = boundaryFixture((url) =>
      url.endsWith("/jobs")
        ? Response.json({ jobs: [job] })
        : server.fetch(url),
    );
    await f.session.accept(
      seedEdit(f.session.snapshot(), { kind: "world", cards }),
    );
    const before = f.session.snapshot({ assets: true }),
      id = f.id();
    const rec = {
      id: "archive-a",
      draftKey: "A",
      kind: "image",
      dropped: true,
      toolId: `art-${id}-portrait`,
      avatarId: id,
      role: "portrait",
      description: "Keeper",
      basis: JSON.stringify([id, 1, null, 1]),
      binding: avatarBinding(before, id),
    };
    job = {
      id: rec.id,
      kind: "image",
      status: "done",
      result: { image: server.put(png), basis: rec.basis },
    };
    await f.store.putJob(rec);
    const digest = crypto.subtle.digest.bind(crypto.subtle);
    let held = false;
    const spy = vi
      .spyOn(crypto.subtle, "digest")
      .mockImplementation(async (...args) => {
        if (!held && new Error().stack.includes("archiveGeneratedArt")) {
          held = true;
          entered.release();
          await blocked.promise;
          if (!during) throw new Error("Device full");
        }
        return digest(...args);
      });
    f.writes.length = 0;
    f.sweep.open({ key: "A" });
    await entered.promise;
    if (!during) {
      blocked.release();
      await vi.waitFor(() => expect(f.session.status.busy).toBe(false));
      expect(f.visuals.pendingArtwork()).toBe(true);
      expect(await f.store.readJobs("A")).toEqual([rec]);
    }
    f.session.open({ key: "B", record: before });
    if (!during) {
      // Even a stale saved action must refuse to write into the new draft.
      const retry = f.visuals
        .tools()
        .find((t) => t.id === "retry-unsaved-artwork");
      await expect(f.session.run((ctx) => retry.run({}, ctx))).rejects.toThrow(
        "editor changed",
      );
    }
    f.visuals.clear(true);
    f.sweep.open({ key: "B" });
    blocked.release();
    await vi.waitFor(() => expect(f.session.status.busy).toBe(false));
    spy.mockRestore();
    expect(f.visuals.pendingArtwork()).toBe(false);
    expect(f.writes).toEqual([]);
    expect(await f.store.readJobs("A")).toEqual([rec]);
    f.session.open({ key: "A", record: before });
    f.visuals.clear(true);
    f.sweep.open({ key: "A" });
    await vi.waitFor(async () =>
      expect(await f.store.readJobs("A")).toEqual([]),
    );
    expect(f.writes).toEqual(["A"]);
    expect(
      await listGeneratedArt(f.session.snapshot({ assets: true }), id),
    ).toHaveLength(1);
  },
);

it("retains a paid image and retry after a same-draft edit", async () => {
  const server = fakeJobs();
  const f = boundaryFixture(server.fetch, { env: server.env });
  await f.session.accept(
    seedEdit(f.session.snapshot(), { kind: "world", cards }),
  );
  f.sweep.open({ key: "A" });
  const { done } = await f.start();
  await vi.waitFor(() => expect(server.posts).toHaveLength(1));
  f.session.stage({ document: "Edited while drawing" });
  server.complete("job-1", {
    image: server.put(png),
    basis: server.posts[0].request.basis,
  });
  await done;
  expect(await f.store.readJobs("A")).toHaveLength(1);
  const retry = f.visuals.tools().find((t) => t.id === "retry-unsaved-artwork");
  expect(retry.describe().note).toContain("editor changed");
  await f.session.run((ctx) => retry.run({}, ctx));
  expect(await f.store.readJobs("A")).toEqual([]);
  expect(
    (await f.library()).filter((set) => set.label.startsWith("Generated")),
  ).toHaveLength(1);
});
