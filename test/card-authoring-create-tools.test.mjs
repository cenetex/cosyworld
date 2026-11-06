import { expect, it, vi } from "vitest";
import { authoringCreateTools } from "../v2/card-game/authoring-create-tools.mjs";
import { createAuthoringSession } from "../v2/card-game/authoring-session.mjs";
import { emptySeedWorld } from "../v2/card-game/authoring-seed-world.mjs";
function fixture() {
  let saved, operation, account = { authenticated: true, user_id: "first" }, finish;
  const store = {
    write: vi.fn(async (_key, record, generation) => { saved = structuredClone(record); return generation + 1; }),
    readCreate: vi.fn(async () => structuredClone(operation ?? null)),
    beginCreate: vi.fn(async (draftKey, owner, generation) => {
      operation = { ...structuredClone(saved), draftKey, owner, generation,
        requestKey: "12345678-1234-4234-8234-123456789abc", receipt: null };
      return structuredClone(operation);
    }),
  };
  const session = createAuthoringSession({ store });
  session.open({ key: "world", record: { ...emptySeedWorld(), generation: 0 } });
  const transfer = vi.fn((_store, pending, { signal }) => new Promise((resolve, reject) => {
    finish = failure => failure ? reject(failure) : resolve({ ...pending.draft, id: "private", revision: 1 });
    signal.addEventListener("abort", () => reject(new DOMException("Paused", "AbortError")), { once: true });
  }));
  const chooseTool = vi.fn(), requireSignIn = vi.fn(() => "sign-in");
  const tools = authoringCreateTools({ store, transfer, changed() {}, chooseTool,
    accounts: { state: () => ({ ...account }), requireSignIn } });
  tools.open(session.status);
  const tool = () => tools.tools()[0];
  return { tools, session, store, transfer, chooseTool, requireSignIn, tool,
    setAccount: value => { account = value; }, finish: failure => finish(failure),
    run: () => session.run(context => tool().run({}, context)) };
}
it("retries one saved Create while later local edits remain separate", async () => {
  const f = fixture();
  f.session.stage({ document: "First accepted notes" });
  await f.run();
  const first = structuredClone(f.transfer.mock.calls[0][1]);
  f.session.stage({ document: "Later local notes" });
  await f.session.save();
  f.finish(new Error("Lost reply"));
  await vi.waitFor(() => expect(f.tool().describe().actions[0].label).toBe("Retry Create"));
  await f.run();
  expect(f.transfer.mock.calls[1][1]).toEqual(first);
  expect(f.store.beginCreate).toHaveBeenCalledTimes(1);
  expect(f.session.snapshot().draft.document).toBe("Later local notes");
  f.finish();
  await vi.waitFor(() => expect(f.tool().describe().actions[0]).toMatchObject({ label: "Created privately", disabled: true }));
});
it("keeps a paused operation bound to its first account during sign-in recovery", async () => {
  const f = fixture();
  await f.run();
  await f.run();
  await vi.waitFor(() => expect(f.tool().describe().note).toMatch(/paused/));
  f.setAccount({ authenticated: true, user_id: "second" });
  await f.run();
  expect(f.requireSignIn).toHaveBeenCalledOnce();
  expect(f.transfer).toHaveBeenCalledTimes(1);
  expect(f.store.beginCreate).toHaveBeenCalledTimes(1);
  f.setAccount({ authenticated: true, user_id: "first" });
  f.tools.signedIn();
  expect(f.chooseTool).toHaveBeenLastCalledWith("create-private");
  await f.run();
  expect(f.transfer.mock.calls[1][1].owner).toBe("first");
  f.finish();
});
it("opens the saved operation after reload before saving another local version", async () => {
  const f = fixture();
  await f.run();
  f.tools.open(f.session.status);
  f.tool().select();
  await vi.waitFor(() => expect(f.tool().describe().actions[0].label).toBe("Retry Create"));
  await f.run();
  expect(f.store.write).toHaveBeenCalledTimes(1);
  expect(f.store.beginCreate).toHaveBeenCalledTimes(1);
  expect(f.transfer.mock.calls[1][1]).toEqual(f.transfer.mock.calls[0][1]);
  f.finish();
});
it("routes a signed-out Create to the existing account tool", async () => {
  const f = fixture();
  f.setAccount({ authenticated: false, user_id: "" });
  await f.run();
  expect(f.chooseTool).toHaveBeenLastCalledWith("sign-in");
  expect(f.store.write).not.toHaveBeenCalled();
  expect(f.transfer).not.toHaveBeenCalled();
});
