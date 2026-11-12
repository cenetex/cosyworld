import { expect, it } from "vitest";
import { prepareJobIntent } from "../v2/card-game/authoring-job-intent.mjs";
import {
  authoringJobStore,
  memoryJobStore,
} from "../v2/card-game/authoring-job-store.mjs";

const account = { authenticated: true, user_id: "maker", account_revision: 0 };
const metadata = {
  draftKey: "draft",
  toolId: "portrait",
  avatarId: "vale",
  role: "portrait",
  binding: "original",
};
const image = (epoch = 1) => ({
  kind: "avatar",
  role: "portrait",
  description: "a blue lamp",
  basis: JSON.stringify(["vale", 1, null, epoch]),
});
const prepare = (
  store,
  request = image(),
  meta = metadata,
  identity = account,
) =>
  prepareJobIntent(
    store,
    identity,
    { ...meta, basis: request.basis },
    "image",
    request,
  );

it("durably reuses the exact wire request across presses, reloads and simultaneous tabs", async () => {
  const store = memoryJobStore();
  const first = await prepare(store);
  const reloadedRequest = image(17);
  const again = await prepare(store, reloadedRequest);
  expect(again.requestKey).toBe(first.requestKey);
  expect(reloadedRequest.basis).toBe(image().basis);
  const [a, b] = await Promise.all([
    prepare(store, image(2)),
    prepare(store, image(3)),
  ]);
  expect(a.requestKey).toBe(b.requestKey);
  expect(await store.readJobs("draft")).toHaveLength(1);
});

it("keeps changed payloads, drafts, tools, accounts and reset revisions separate", async () => {
  const store = memoryJobStore();
  const rows = [await prepare(store)];
  rows.push(await prepare(store, { ...image(), description: "a green lamp" }));
  rows.push(await prepare(store, { ...image(), instruction: "make it round" }));
  rows.push(await prepare(store, image(), { ...metadata, draftKey: "other" }));
  rows.push(await prepare(store, image(), { ...metadata, toolId: "other" }));
  rows.push(await prepare(store, image(), { ...metadata, binding: "edited" }));
  rows.push(
    await prepare(store, image(), metadata, { ...account, user_id: "other" }),
  );
  rows.push(
    await prepare(store, image(), metadata, {
      ...account,
      account_revision: 1,
    }),
  );
  expect(new Set(rows.map((row) => row.requestKey)).size).toBe(rows.length);
});

it("keeps only recovery metadata, UUID, account and digests, not provider bodies or image bytes", async () => {
  const store = memoryJobStore();
  const request = {
    ...image(),
    reference: { base64: "PRIVATE_REFERENCE", mime: "image/png" },
    instruction: "PRIVATE_EDIT",
  };
  const saved = await prepare(store, request, {
    ...metadata,
    request,
    systemPrompt: "PRIVATE_SYSTEM",
  });
  const text = JSON.stringify(saved);
  for (const secret of [
    "PRIVATE_REFERENCE",
    "PRIVATE_EDIT",
    "PRIVATE_SYSTEM",
    "a blue lamp",
  ])
    expect(text).not.toContain(secret);
  expect(saved.requestDigest).toMatch(/^[a-f0-9]{64}$/u);
  expect(saved.owner).toBe("maker");
  expect(saved.revision).toBe(0);
});

it("fails closed on failed writes, unavailable identity, or altered saved wire digest", async () => {
  await expect(
    prepare({
      claimJob: async () => {
        throw new Error("quota");
      },
    }),
  ).rejects.toThrow("quota");
  await expect(
    prepare(memoryJobStore(), image(), metadata, {}),
  ).rejects.toThrow("Sign in");
  const store = memoryJobStore(),
    saved = await prepare(store);
  await store.putJob({ ...saved, requestDigest: "bad" });
  await expect(prepare(store)).rejects.toThrow("request changed");
});

it("does not silently discard or reuse uncertain intents beyond server retention", async () => {
  const store = memoryJobStore(),
    saved = await prepare(store);
  await store.putJob({ ...saved, createdAt: Date.now() - 8 * 24 * 3600_000 });
  await expect(prepare(store)).rejects.toThrow("older draw needs review");
  expect((await store.readJobs("draft"))[0].requestKey).toBe(saved.requestKey);
});

it("does not report an IndexedDB intent durable until its transaction commits", async () => {
  let transaction, read, inserted;
  const db = {
    transaction: () =>
      (transaction = {
        objectStore: () => ({
          getAll: () => (read = {}),
          put: (value) => {
            inserted = value;
          },
        }),
      }),
  };
  const record = {
    id: "intent_a",
    draftKey: "draft",
    kind: "seed",
    requestKey: "uuid",
  };
  let completed = false;
  const claim = authoringJobStore(db)
    .claimJob(record)
    .then((value) => {
      completed = true;
      return value;
    });
  read.onsuccess();
  await Promise.resolve();
  expect(inserted).toEqual(record);
  expect(completed).toBe(false);
  transaction.oncomplete();
  expect(await claim).toEqual(record);
  const aborted = authoringJobStore(db).claimJob(record);
  read.onsuccess();
  transaction.error = new Error("transaction aborted");
  transaction.onabort();
  await expect(aborted).rejects.toThrow("transaction aborted");
});

// Integration uses only in-process HTTP mocks, with the production run/sweep path.
import { createJobSweep } from "../v2/card-game/authoring-job-sweep.mjs";
import { runJob } from "../v2/card-game/authoring-jobs.mjs";
import { fakeJobs } from "./helpers/fake-jobs.mjs";
import { vi } from "vitest";
function recovery(server, store, adopt = () => {}) {
  const sweep = createJobSweep({
    store,
    ...server,
    adopters: { seed: { adoptJob: adopt } },
    run: (callback) => callback({ snapshot: () => ({ key: "draft" }) }),
  });
  sweep.open({ key: "draft" });
  return sweep;
}
const options = (server, sweep) => ({
  ...server,
  beginJob: sweep.track.begin,
  refusedJob: sweep.track.refused,
  prepareJob: sweep.track.prepare({
    draftKey: "draft",
    kind: "seed",
    tool: "seed",
  }),
  onJob: (job) =>
    sweep.track.accepted({
      ...job.intent,
      id: job.id,
      intentId: job.intent.id,
    }),
});
it("recovers an accepted lost response after reload using reads only", async () => {
  const server = fakeJobs(),
    store = memoryJobStore();
  const sweep = recovery(server, store);
  server.dropNextReply();
  await expect(
    runJob("seed", { seed: "private story" }, options(server, sweep)),
  ).rejects.toMatchObject({ code: "network" });
  expect(server.posts).toHaveLength(1);
  expect(JSON.stringify(await store.readJobs("draft"))).not.toContain(
    "private story",
  );
  sweep.open({ key: "closed" });
  server.complete("job-1", { cards: [] });
  const adopted = vi.fn();
  const reloaded = recovery(server, store, adopted);
  await vi.waitFor(() => expect(adopted).toHaveBeenCalledTimes(1));
  await vi.waitFor(async () =>
    expect(await store.readJobs("draft")).toEqual([]),
  );
  expect(server.posts).toHaveLength(1);
  reloaded.open({ key: "closed" });
});
it("does not submit after an aborted press or a durable transaction failure", async () => {
  const server = fakeJobs(),
    store = memoryJobStore(),
    controller = new AbortController();
  const sweep = recovery(server, store);
  controller.abort();
  await expect(
    runJob(
      "seed",
      {},
      { ...options(server, sweep), signal: controller.signal },
    ),
  ).rejects.toThrow();
  expect(server.posts).toHaveLength(0);
  expect(await store.readJobs("draft")).toHaveLength(1);
  store.claimJob = async () => {
    throw new Error("IDB unavailable");
  };
  await expect(
    runJob("seed", { changed: true }, options(server, sweep)),
  ).rejects.toThrow("IDB unavailable");
  expect(server.posts).toHaveLength(0);
  sweep.open({ key: "closed" });
});
it("keeps absent or pruned submitted intents and refuses even an explicit retry", async () => {
  const server = fakeJobs({ auto: () => ({ cards: [] }) }),
    store = memoryJobStore();
  const sweep = recovery(server, store);
  server.offline(true);
  await expect(
    runJob(
      "seed",
      {},
      {
        ...options(server, sweep),
        prepareJob: async (kind, request) =>
          prepareJobIntent(
            store,
            account,
            { draftKey: "draft", tool: "seed" },
            kind,
            request,
          ),
      },
    ),
  ).rejects.toMatchObject({ code: "network" });
  const [intent] = await store.readJobs("draft");
  server.offline(false);
  sweep.poke({ force: true });
  await new Promise((resolve) => setTimeout(resolve, 10));
  expect(server.posts).toHaveLength(0);
  await expect(
    runJob(
      "seed",
      {},
      {
        ...options(server, sweep),
        prepareJob: (kind, request) =>
          prepareJobIntent(
            store,
            account,
            { draftKey: "draft", tool: "seed" },
            kind,
            request,
          ),
      },
    ),
  ).rejects.toMatchObject({ code: "generation_waiting" });
  expect((await store.readJobs("draft"))[0].requestKey).toBe(intent.requestKey);
  expect(server.jobs.size).toBe(0);
  sweep.open({ key: "closed" });
});
it("rechecks the intent hold when a sweep was already awaiting its job list", async () => {
  const server = fakeJobs(),
    store = memoryJobStore();
  const intent = await prepareJobIntent(
    store,
    account,
    { draftKey: "draft", kind: "seed", tool: "seed" },
    "seed",
    {},
  );
  let listReached, releaseList, postReached, releasePost;
  const listing = new Promise((resolve) => {
    listReached = resolve;
  });
  const listGate = new Promise((resolve) => {
    releaseList = resolve;
  });
  const posting = new Promise((resolve) => {
    postReached = resolve;
  });
  const postGate = new Promise((resolve) => {
    releasePost = resolve;
  });
  const fetch = async (url, init) => {
    const response = await server.fetch(url, init);
    if (url.endsWith("/jobs") && init.method === "GET") {
      listReached();
      await listGate;
    }
    if (init.method === "POST") {
      postReached();
      await postGate;
    }
    return response;
  };
  const transport = { ...server, fetch },
    adopted = vi.fn();
  const sweep = recovery(transport, store, adopted);
  await listing; // The sweep selected the record before the original request held it.
  const running = runJob("seed", {}, options(transport, sweep));
  await posting;
  server.complete("job-1", { cards: [] });
  releaseList();
  await new Promise((resolve) => setTimeout(resolve, 25));
  expect(adopted).not.toHaveBeenCalled();
  expect((await store.readJobs("draft"))[0].id).toBe(intent.id);
  releasePost();
  await expect(running).resolves.toEqual({ cards: [] });
  await sweep.track.settled("job-1");
  expect(await store.readJobs("draft")).toEqual([]);
  expect(server.posts).toHaveLength(1);
  sweep.open({ key: "closed" });
});
