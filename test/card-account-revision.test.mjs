import { describe, expect, it } from "vitest";
import { createAccountRevision } from "../v2/card-game/account-revision.mjs";

const signed = (user_id = "ann", account_revision = 0) => ({
  authenticated: true,
  user_id,
  account_revision,
});
describe("a page's captured account revision", () => {
  it("keeps static and signed-out requests compatible", () => {
    const page = createAccountRevision();
    expect(page.headers()).toEqual({});
    page.observe({ authenticated: false });
    expect(page.headers()).toEqual({});
  });
  it("sends stable identity and revision, including before the first reset", () => {
    const page = createAccountRevision();
    page.observe(signed());
    expect(page.headers()).toEqual({
      "X-Account-User": "ann",
      "X-Account-Revision": "0",
    });
    page.observe(signed());
    expect(page.headers()["X-Account-Revision"]).toBe("0");
  });
  it("never adopts a changed cookie/account/reset from a background read", () => {
    for (const next of [
      signed("bob"),
      signed("ann", 1),
      { authenticated: false },
    ]) {
      const page = createAccountRevision();
      page.observe(signed());
      expect(() => page.observe(next)).toThrow("Reload before continuing");
      expect(page.headers()).toEqual({
        "X-Account-User": "ann",
        "X-Account-Revision": "0",
      });
    }
  });
  it("allows a deliberate passkey sign-in and preserves the resulting revision", () => {
    const page = createAccountRevision();
    page.observe({ authenticated: false });
    expect(() => page.observe(signed())).toThrow();
    page.observe(signed("ann", 3), true);
    expect(page.headers()).toEqual({
      "X-Account-User": "ann",
      "X-Account-Revision": "3",
    });
  });
  it("rejects malformed identity without changing the captured account", () => {
    const page = createAccountRevision();
    page.observe(signed());
    for (const next of [signed("", 0), signed("ann", -1), signed("ann", 0.5)])
      expect(() => page.observe(next, true)).toThrow();
    expect(page.headers()["X-Account-User"]).toBe("ann");
  });
});
