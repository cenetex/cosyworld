import { afterEach, beforeEach, expect, it, vi } from "vitest";
// Request ordering owns this fixture; reset-storage tests cover the adapter.
vi.mock("../v2/card-game/account-reset-storage.mjs", () => ({
  accountStorage: { removeItem: (key) => globalThis.localStorage?.removeItem(key) },
  accountSessionStorage: {
    getItem: (key) => globalThis.sessionStorage.getItem(key),
    setItem: (key, value) => globalThis.sessionStorage.setItem(key, value),
    removeItem: (key) => globalThis.sessionStorage.removeItem(key),
  },
}));
import { installAvatarMenu } from "../v2/card-game/avatar-menu.mjs";
import { request } from "../v2/card-game/shared-auth.mjs";
vi.mock("../v2/card-game/shared-auth.mjs", () => ({ request: vi.fn() }));

function element() {
  const events = {};
  return {
    dataset: {},
    children: [],
    style: { setProperty() {}, removeProperty() {} },
    classList: { add() {} },
    textContent: "",
    open: false,
    setAttribute() {},
    addEventListener(type, fn) {
      (events[type] ||= []).push(fn);
    },
    fire(type) {
      for (const fn of events[type] || []) fn();
    },
    append(...children) {
      this.children.push(...children);
    },
    prepend(...children) {
      this.children.unshift(...children);
    },
    replaceChildren(...children) {
      this.children = children;
    },
    matches() {
      return this.open;
    },
    toggle(open) {
      this.fire("beforetoggle");
      this.open = open;
      this.fire("toggle");
    },
  };
}
let pending, menu, storage;
const settle = async () => {
  for (let i = 0; i < 8; i++) await Promise.resolve();
};
const slots = () =>
  menu.children[0].children
    .filter((n) => n.dataset.slot)
    .map((n) => n.dataset.slot);
const status = () => menu.children[1].textContent;
const finish = async (index, value, fail = false) => {
  pending[index][fail ? "reject" : "resolve"](value);
  await settle();
};
const list = (id) => ({
  worlds: [{ id, owner: true, held: [] }],
  unlocked: ["vale"],
});
beforeEach(() => {
  pending = [];
  menu = element();
  storage = new Map();
  vi.stubGlobal("sessionStorage", {
    getItem: (key) => storage.get(key) || null,
    setItem: (key, value) => storage.set(key, value),
    removeItem: (key) => storage.delete(key),
  });
  vi.stubGlobal("document", {
    createElement: element,
    getElementById: () => null,
  });
  request.mockImplementation(
    (path) =>
      new Promise((resolve, reject) => pending.push({ path, resolve, reject })),
  );
  installAvatarMenu({
    menu,
    session: null,
    getWorld: () => ({ actors: {}, seed: 1 }),
    allowShared: () => true,
  });
});
afterEach(() => vi.unstubAllGlobals());

it("does not let a stale account response sign out a reopened menu", async () => {
  menu.toggle(true);
  menu.toggle(false);
  menu.toggle(true);
  await finish(1, { authenticated: true });
  await finish(2, list("new"));
  await finish(0, { authenticated: false });
  expect(menu.children[0].hidden).toBe(false);
  expect(slots()).toEqual(["new"]);
});
it("keeps the newer world list when older responses arrive last", async () => {
  menu.toggle(true);
  await finish(0, { authenticated: true });
  menu.toggle(false);
  menu.toggle(true);
  await finish(2, { authenticated: true });
  await finish(3, list("new"));
  await finish(1, list("old"));
  expect(slots()).toEqual(["new"]);
});
it.each([false, true])(
  "ignores an old invitation response (failure=%s)",
  async (fail) => {
    storage.set("cosyworld.invite", "old-invite");
    menu.toggle(true);
    await finish(0, { authenticated: true });
    await finish(1, list("old"));
    menu.toggle(false);
    storage.set("cosyworld.invite", "new-invite");
    menu.toggle(true);
    await finish(3, { authenticated: true });
    await finish(4, list("new"));
    await finish(5, { claimed: [], bound: [] });
    await finish(
      2,
      fail ? new Error("This world has closed") : { claimed: [], bound: [] },
      fail,
    );
    expect(slots()).toEqual(["new", "new-invite"]);
    expect(status()).toBe("Tap + there to bring an avatar in.");
    expect(storage.get("cosyworld.invite")).toBe("new-invite");
  },
);
it("does not request worlds or redraw after dismissal", async () => {
  menu.toggle(true);
  menu.toggle(false);
  await finish(0, { authenticated: true });
  expect(pending).toHaveLength(1);
  expect(menu.children[0].hidden).toBe(true);
});
it("invalidates synchronously before a coalesced close/reopen toggle", async () => {
  menu.toggle(true);
  await finish(0, { authenticated: true });
  menu.fire("beforetoggle");
  menu.open = false;
  menu.fire("beforetoggle");
  menu.open = true;
  await finish(1, list("stale"));
  expect(slots()).toEqual([]);
  menu.fire("toggle");
  await finish(2, { authenticated: true });
  await finish(3, list("current"));
  expect(slots()).toEqual(["current"]);
});
