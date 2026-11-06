import { describe, expect, it, vi } from "vitest";
import { createAuthoringAccountTools } from "../v2/card-game/authoring-account-tools.mjs";

const deferred = () => {
  let resolve;
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { promise, resolve };
};
function fixture() {
  const request = vi.fn(async () => ({ authenticated: false }));
  const passkey = vi.fn(async () => {});
  const onSignedIn = vi.fn(),
    onChange = vi.fn();
  const tools = createAuthoringAccountTools({
    request,
    passkey,
    onSignedIn,
    onChange,
  });
  return { tools, request, passkey, onSignedIn, onChange };
}
const get = (f, id = "sign-in") =>
  f.tools.tools().find((tool) => tool.id === id);

describe("authoring passkey tools", () => {
  it("checks registration policy and keeps only public account state", async () => {
    const f = fixture();
    expect(get(f, "create-passkey")).toBeUndefined();
    await f.tools.refresh();
    expect(f.request).toHaveBeenCalledWith("/auth/account");
    expect(get(f, "create-passkey")).toBeDefined();
    f.request.mockResolvedValue({ authenticated: false, members_only: true });
    await f.tools.refresh();
    expect(get(f, "create-passkey")).toBeUndefined();
    f.request.mockResolvedValue({
      authenticated: true,
      display_name: "Vale",
      wallet_session: "secret",
    });
    await f.tools.refresh();
    expect(get(f).describe().note).toBe("Signed in as Vale.");
    expect(f.tools.state()).not.toHaveProperty("wallet_session");
    const copy = f.tools.state();
    copy.authenticated = false;
    expect(f.tools.state().authenticated).toBe(true);
  });
  it.each([false, true])(
    "completes the existing passkey ceremony (register=%s)",
    async (register) => {
      const f = fixture();
      await f.tools.refresh();
      f.request.mockResolvedValue({
        authenticated: true,
        display_name: "Vale",
      });
      const context = { stage: vi.fn(), save: vi.fn(), open: vi.fn() };
      await get(f, register ? "create-passkey" : "sign-in").run({}, context);
      expect(f.passkey).toHaveBeenCalledExactlyOnceWith(register);
      expect(f.onSignedIn).toHaveBeenCalledExactlyOnceWith(f.tools.state());
      for (const method of Object.values(context))
        expect(method).not.toHaveBeenCalled();
      expect(get(f, "create-passkey")).toBeUndefined();
      expect(get(f).describe().actions[0].label).toBe("Refresh account");
    },
  );
  it("keeps one ceremony active and supports cancellation and retry", async () => {
    const f = fixture(),
      waiting = deferred();
    f.passkey.mockImplementationOnce(() => waiting.promise);
    const pending = get(f).run();
    await get(f).run();
    expect(f.passkey).toHaveBeenCalledTimes(1);
    expect(get(f).describe().actions[0].disabled).toBe(true);
    waiting.resolve();
    await pending;
    expect(f.onSignedIn).not.toHaveBeenCalled();
    f.passkey.mockRejectedValueOnce(
      Object.assign(new Error("closed"), { name: "NotAllowedError" }),
    );
    await get(f).run();
    expect(get(f).describe().note).toContain("You can try again");
    f.request.mockResolvedValue({ authenticated: true });
    await get(f).run();
    expect(f.tools.state()).toMatchObject({
      busy: false,
      error: "",
      authenticated: true,
    });
  });
  it("expires old account reads and ceremonies when a request needs sign-in", async () => {
    const f = fixture(),
      read = deferred();
    f.request.mockReturnValueOnce(read.promise);
    const pending = f.tools.refresh();
    expect(f.tools.requireSignIn()).toBe("sign-in");
    read.resolve({ authenticated: true });
    await pending;
    expect(f.tools.state().authenticated).toBe(false);
    const ceremony = deferred();
    f.passkey.mockReturnValueOnce(ceremony.promise);
    const signing = get(f).run();
    f.tools.requireSignIn();
    f.request.mockResolvedValue({ authenticated: true });
    ceremony.resolve();
    await signing;
    expect(f.tools.state()).toMatchObject({
      authenticated: false,
      busy: false,
    });
    expect(f.onSignedIn).not.toHaveBeenCalled();
  });
  it("keeps errors visible and accepts a later account refresh", async () => {
    const f = fixture();
    f.request.mockRejectedValueOnce(new Error("Service warming up"));
    await f.tools.refresh();
    expect(get(f).describe().note).toBe("Service warming up");
    expect(get(f, "create-passkey")).toBeUndefined();
    await f.tools.refresh();
    expect(get(f, "create-passkey")).toBeDefined();
    f.request.mockResolvedValue({});
    await f.tools.refresh();
    expect(get(f).describe().note).toBe("Check your account again.");
  });
});
