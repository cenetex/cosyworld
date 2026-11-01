// A world that cannot open shows its reason once, also after Try again
// (2026-11-01: the reason appeared twice on the Open this world card).
import { afterEach, describe, expect, it, vi } from "vitest";
import { connectSharedWorld } from "../v2/card-game/shared.mjs";

function element(tag) {
  const e = {
    tag,
    children: [],
    textContent: "",
    attributes: {},
    append: (...nodes) => e.children.push(...nodes),
    replaceChildren: (...nodes) => (e.children = nodes),
    setAttribute: (k, v) => (e.attributes[k] = v),
    addEventListener: () => {},
    showModal: () => (e.open = true),
    close: () => (e.open = false),
  };
  return e;
}
const all = (e) => [e, ...e.children.flatMap(all)];
const text = (e) =>
  all(e)
    .map((n) => n.textContent)
    .filter(Boolean);

afterEach(() => vi.unstubAllGlobals());

describe("the Open this world card", () => {
  it("names a refused world once, before and after Try again", async () => {
    const body = element("body");
    vi.stubGlobal("document", {
      body,
      head: element("head"),
      createElement: element,
      getElementById: (id) => all(body).find((n) => n.id === id) || null,
      dispatchEvent: () => {},
    });
    vi.stubGlobal("Event", class {});
    const refused = {
      ok: false,
      status: 409,
      json: async () => ({ error: "This save needs a fresh start." }),
    };
    const account = { ok: true, json: async () => ({ authenticated: true }) };
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url) =>
        String(url).includes("/auth/") ? account : refused,
      ),
    );
    connectSharedWorld("waiting-world");
    const modal = () => body.children.find((n) => n.tag === "dialog");
    const count = () =>
      text(modal()).filter((t) => /waiting for an update/.test(t)).length;
    await vi.waitFor(() => expect(modal()?.open).toBe(true));
    await vi.waitFor(() => expect(count()).toBe(1));
    const retry = all(modal()).find((n) => n.textContent === "Try again");
    await retry.onclick();
    await vi.waitFor(() => expect(count()).toBe(1));
    expect(text(modal())).not.toContain("This save needs a fresh start.");
  });
});
