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
