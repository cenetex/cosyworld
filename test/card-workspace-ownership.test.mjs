import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { installCardWorkspace } from "../v2/card-game/settings-screen.mjs";

const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
};

// This tests the real workspace's action callbacks, not browser layout.
// Empty cards keep the DOM seam limited to the shared screen and beat.
function element() {
  return {
    dataset: {},
    children: [],
    open: false,
    addEventListener() {},
    setAttribute() {},
    append(...children) {
      this.children.push(...children);
    },
    replaceChildren(...children) {
      this.children = children;
    },
    querySelector() {
      return null;
    },
    show() {
      this.open = true;
    },
    close() {
      this.open = false;
    },
  };
}
let workspaces;
beforeEach(() => {
  workspaces = [];
  const elements = new Map(
    ["settings-screen", "settings-hand", "stage"].map((id) => [id, element()]),
  );
  vi.stubGlobal("document", {
    getElementById: (id) => elements.get(id),
    querySelector: () => null,
    createElement: element,
    addEventListener() {},
    dispatchEvent() {},
  });
  vi.stubGlobal("Image", class {});
  vi.stubGlobal("matchMedia", () => ({ matches: true }));
});
afterEach(() => {
  for (const workspace of workspaces) workspace.close();
  vi.unstubAllGlobals();
});
function setup(action = { run: "request", label: "Run" }) {
  const requests = [];
  const actionBeat = { show: vi.fn(), clear: vi.fn() };
  const playHand = { leave: vi.fn(() => 0), back: vi.fn() };
  const run = vi.fn(() => {
    const request = deferred();
    requests.push(request);
    return request.promise;
  });
  const workspace = installCardWorkspace({
    cards: () => [],
    describe: () => ({
      name: "Settings",
      info: "Current settings",
      actions: [action],
    }),
    actionBeat,
    playHand,
    run,
  });
  workspaces.push(workspace);
  const beat = () => actionBeat.show.mock.lastCall[0];
  return {
    workspace,
    requests,
    actionBeat,
    playHand,
    run,
    beat,
    press: () => beat().buttons[0].run(),
  };
}

it.each(["success", "failure"])(
  "ignores old %s after repeated close and reopen",
  async (outcome) => {
    const h = setup();
    h.workspace.open();
    const old = h.press();
    h.workspace.close();
    h.workspace.close();
    h.workspace.open();
    h.workspace.close();
    h.workspace.open();
    const current = h.press();
    h.requests[1].resolve();
    await current;
    const draws = h.actionBeat.show.mock.calls.length;
    if (outcome === "success") h.requests[0].resolve();
    else h.requests[0].reject(new Error("Old sign-in failed"));
    await old;
    expect(h.beat().info).toBe("Current settings");
    expect(h.actionBeat.show).toHaveBeenCalledTimes(draws);
    expect(h.playHand.back).toHaveBeenCalledTimes(2);
  },
);

it("does not remember a rejection that arrived while closed", async () => {
  const h = setup();
  h.workspace.open();
  const pending = h.press();
  h.workspace.close();
  h.requests[0].reject(new Error("Closed request failed"));
  await pending;
  h.workspace.open();
  expect(h.beat().info).toBe("Current settings");
});

it("clears an already displayed error when the workspace is closed", async () => {
  const h = setup();
  h.workspace.open();
  const pending = h.press();
  h.requests[0].reject(new Error("Try again"));
  await pending;
  expect(h.beat().info).toBe("Try again");
  h.workspace.close();
  h.workspace.open();
  expect(h.beat().info).toBe("Current settings");
});

it("keeps current failures and successful retries, including repeated open", async () => {
  const h = setup();
  h.workspace.open();
  const failed = h.press();
  h.workspace.open();
  h.requests[0].reject(new Error("Try again"));
  await failed;
  expect(h.beat().info).toBe("Try again");
  const retry = h.press();
  h.requests[1].resolve();
  await retry;
  expect(h.beat().info).toBe("Current settings");
  expect(h.playHand.leave).toHaveBeenCalledTimes(1);
});

it("does not restore an old error when another workspace takes the screen", async () => {
  const first = setup(),
    second = setup();
  first.workspace.open();
  const pending = first.press();
  second.workspace.open();
  const draws = second.actionBeat.show.mock.calls.length;
  first.requests[0].reject(new Error("Old workspace failed"));
  await pending;
  expect(second.actionBeat.show).toHaveBeenCalledTimes(draws);
  expect(second.beat().info).toBe("Current settings");
  first.workspace.open();
  expect(first.beat().info).toBe("Current settings");
});

it("still runs closing actions but never presents their late failure on reopen", async () => {
  const h = setup({ run: "replace", label: "Replace", closes: true });
  h.workspace.open();
  const pending = h.press();
  expect(h.playHand.back).toHaveBeenCalledTimes(1);
  expect(h.run).toHaveBeenCalledTimes(1);
  h.workspace.open();
  h.requests[0].reject(new Error("Old action failed"));
  await pending;
  expect(h.beat().info).toBe("Current settings");
});
