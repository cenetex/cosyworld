// A world on rules newer than the server's (the release swap, docs/release.md)
// waits calmly and opens itself; no Try again (v1.2.122 tag deploy).
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  connectSharedWorld,
  UPDATING,
  updatingDelay,
} from "../v2/card-game/shared.mjs";

const fades = [];
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
    // Each fade-in a panel's words make, by the element that fades.
    animate: (frames) => {
      fades.push([e.tag, frames.opacity]);
      return { finished: Promise.resolve(), cancel() {} };
    },
    getAnimations: () => [],
    matches: () => true,
  };
  return e;
}
const all = (e) => [e, ...e.children.flatMap(all)];
const text = (e) =>
  all(e)
    .map((n) => n.textContent)
    .filter(Boolean);

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("a world updating during a release swap", () => {
  it("backs off gently, up to half a minute", () => {
    expect([0, 1, 2, 3, 4, 9].map(updatingDelay)).toEqual([
      2000, 4000, 8000, 16000, 30000, 30000,
    ]);
  });

  it("names the wait on its action and retries on its own", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout"] });
    const body = element("body");
    vi.stubGlobal("document", {
      body,
      head: element("head"),
      createElement: element,
      getElementById: (id) => all(body).find((n) => n.id === id) || null,
      dispatchEvent: () => {},
    });
    vi.stubGlobal("Event", class {});
    const updating = {
      ok: false,
      status: 503,
      json: async () => ({
        error: "This world is updating. Back in a moment.",
        code: "updating",
      }),
    };
    const refused = {
      ok: false,
      status: 409,
      json: async () => ({
        error: "This world's rules need a saved migration.",
      }),
    };
    const account = { ok: true, json: async () => ({ authenticated: true, user_id: "shared-fixture", account_revision: 0 }) };
    let opens = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url) => {
        if (String(url).includes("/auth/")) return account;
        return ++opens < 3 ? updating : refused;
      }),
    );
    connectSharedWorld("updating-world");
    const modal = () => body.children.find((n) => n.tag === "dialog");
    await vi.waitFor(() => expect(text(modal() || body)).toContain(UPDATING));
    const wait = all(modal()).find((n) => n.textContent === UPDATING);
    expect(wait.disabled).toBe(true);
    expect(text(modal())).not.toContain("Try again");
    // Only the action names the wait; the card's text stays as it was.
    expect(text(modal()).filter((t) => /updating/i.test(t))).toEqual([
      UPDATING,
    ]);
    expect(opens).toBe(1);
    await vi.advanceTimersByTimeAsync(2000);
    await vi.waitFor(() => expect(opens).toBe(2));
    expect(text(modal())).toContain(UPDATING);
    // The retry's words come in over the old ones rather than cutting.
    await vi.waitFor(() =>
      expect(fades.some(([, opacity]) => opacity?.[0] === 0)).toBe(true),
    );
    await vi.advanceTimersByTimeAsync(4000);
    // A genuine refusal after the swap keeps its own message and Try again.
    await vi.waitFor(() =>
      expect(text(modal())).toContain(
        "This world's rules need a saved migration.",
      ),
    );
    expect(text(modal())).toContain("Try again");
    expect(text(modal())).not.toContain(UPDATING);
  });
});
