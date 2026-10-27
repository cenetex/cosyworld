import { describe, it, expect, vi } from "vitest";
import { webcrypto, createHash } from "node:crypto";
import { createOpenRouter } from "../v2/card-game/openrouter.mjs";

function fixture() {
  const values = new Map();
  const storage = {
    getItem: (key) => values.get(key) || null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
  };
  const fetcher = vi.fn(async () =>
    Response.json({ key: "sk-or-test-player-browser-credential" }),
  );
  const client = createOpenRouter({
    storage,
    crypto: webcrypto,
    fetcher,
    now: () => 1000,
  });
  const start = async () =>
    new URL(
      await client.begin("https://game.example/?table=mine&world=forest"),
    );
  const callback = async () => {
    const auth = await start();
    const url = new URL(auth.searchParams.get("callback_url"));
    url.searchParams.set("code", "valid-code");
    url.searchParams.set("state", auth.searchParams.get("state"));
    return { auth, url };
  };
  return { values, storage, fetcher, client, start, callback };
}
describe("player OpenRouter connection", () => {
  it("uses a fresh S256 verifier and state and keeps the table link", async () => {
    const f = fixture();
    const auth = await f.start();
    const pending = JSON.parse(f.values.get("cosy.openrouter.pkce.v1"));
    expect(pending.verifier).toMatch(/^[A-Za-z0-9_-]{43}$/u);
    expect(auth.searchParams.get("code_challenge")).toBe(
      createHash("sha256").update(pending.verifier).digest("base64url"),
    );
    expect(auth.searchParams.get("code_challenge_method")).toBe("S256");
    expect(auth.href).not.toContain(pending.verifier);
    expect(
      new URL(auth.searchParams.get("callback_url")).searchParams.get("table"),
    ).toBe("mine");
    expect((await f.start()).searchParams.get("state")).not.toBe(
      auth.searchParams.get("state"),
    );
  });
  it("cleans the callback before exchange and keeps the key in session storage", async () => {
    const f = fixture();
    const { url } = await f.callback();
    const clean = vi.fn();
    await expect(f.client.finish(url.href, clean)).resolves.toBe(true);
    expect(clean).toHaveBeenCalledWith(
      "https://game.example/?table=mine&world=forest",
    );
    expect(clean.mock.invocationCallOrder[0]).toBeLessThan(
      f.fetcher.mock.invocationCallOrder[0],
    );
    const [target, options] = f.fetcher.mock.calls[0];
    expect(target.href).toBe("https://openrouter.ai/api/v1/auth/keys");
    expect(options.credentials).toBe("omit");
    expect(options.headers.Authorization).toBeUndefined();
    expect(JSON.parse(options.body).code_challenge_method).toBe("S256");
    expect(f.client.connection().key).toBe(
      "sk-or-test-player-browser-credential",
    );
    expect(f.client.headers()).toEqual({ "X-Cosy-Browser-Chat": "1" });
    f.client.setChat(false);
    expect(f.client.headers()).toEqual({});
    f.client.disconnect();
    expect(f.client.connection()).toBeNull();
  });
  it("accepts OpenRouter appending only the code to a callback with embedded state", async () => {
    const f = fixture();
    const auth = await f.start();
    const callback = new URL(auth.searchParams.get("callback_url"));
    expect(callback.searchParams.get("state")).toBe(
      auth.searchParams.get("state"),
    );
    callback.searchParams.set("code", "provider-only-appends-this-code");
    await expect(f.client.finish(callback.href, vi.fn())).resolves.toBe(true);
  });
  it("returns through a small window and respects a cancelled exchange", async () => {
    const f = fixture();
    const auth = new URL(
      await f.client.begin("https://game.example/?world=forest", {
        popup: true,
      }),
    );
    const callback = new URL(auth.searchParams.get("callback_url"));
    expect(callback.pathname).toBe("/card-game/openrouter-callback.html");
    expect(callback.searchParams.get("state")).toBe(
      auth.searchParams.get("state"),
    );
    callback.searchParams.set("code", "provider-code");
    await expect(
      f.client.finish(callback.href, vi.fn(), { accept: () => false }),
    ).resolves.toBe(false);
    expect(f.client.connection()).toBeNull();
  });
  it("keeps a cancelled sign-in attempt clear while its challenge is being made", async () => {
    const f = fixture();
    let active = true;
    const started = f.client.begin("https://game.example/", {
      accept: () => active,
    });
    active = false;
    await expect(started).resolves.toBeNull();
    expect(f.values.size).toBe(0);
  });
  it.each(["state", "expiry", "table", "denied"])(
    "checks %s before contacting OpenRouter",
    async (kind) => {
      const f = fixture();
      const { url } = await f.callback();
      if (kind === "state") url.searchParams.set("state", "other");
      if (kind === "table") url.searchParams.set("table", "other");
      if (kind === "denied") url.searchParams.set("error", "access_denied");
      if (kind === "expiry") {
        const value = JSON.parse(f.values.get("cosy.openrouter.pkce.v1"));
        value.at = -600_000;
        f.values.set("cosy.openrouter.pkce.v1", JSON.stringify(value));
      }
      await expect(f.client.finish(url.href, vi.fn())).rejects.toThrow();
      expect(f.fetcher).not.toHaveBeenCalled();
      expect(f.values.has("cosy.openrouter.pkce.v1")).toBe(false);
    },
  );
  it("makes a callback single use and rejects an invalid key", async () => {
    const f = fixture();
    const { url } = await f.callback();
    f.fetcher.mockResolvedValueOnce(Response.json({ key: "invalid" }));
    await expect(f.client.finish(url.href, vi.fn())).rejects.toThrow();
    await expect(f.client.finish(url.href, vi.fn())).rejects.toThrow();
    expect(f.fetcher).toHaveBeenCalledTimes(1);
    expect(f.client.connection()).toBeNull();
  });
  it("uses the player key only at OpenRouter and fetches video from a fixed content path", async () => {
    const f = fixture();
    const { url } = await f.callback();
    await f.client.finish(url.href, vi.fn());
    f.fetcher.mockResolvedValueOnce(
      new Response("audio", { headers: { "Content-Type": "audio/mpeg" } }),
    );
    expect(
      await (await f.client.speech("audio-model", "alloy", "Hello.")).text(),
    ).toBe("audio");
    f.fetcher.mockResolvedValueOnce(
      Response.json({
        id: "video-123",
        status: "completed",
        unsigned_urls: ["https://other.example/steal"],
      }),
    );
    f.fetcher.mockResolvedValueOnce(new Response("video"));
    expect(await (await f.client.video("video-model", "A shore.")).text()).toBe(
      "video",
    );
    expect(f.fetcher.mock.calls.at(-1)[0].href).toBe(
      "https://openrouter.ai/api/v1/videos/video-123/content?index=0",
    );
    for (const [target, options] of f.fetcher.mock.calls.slice(1)) {
      expect(target.origin).toBe("https://openrouter.ai");
      expect(options.headers.Authorization).toBe(
        "Bearer sk-or-test-player-browser-credential",
      );
    }
  });
  it("reports spending errors and stops polling on cancellation", async () => {
    const f = fixture();
    f.fetcher.mockResolvedValueOnce(new Response("", { status: 402 }));
    await expect(f.client.speech("tts", "alloy", "Hello.")).rejects.toThrow(
      "Add credits",
    );
    f.fetcher.mockResolvedValueOnce(
      Response.json({ id: "pending", status: "pending" }),
    );
    const controller = new AbortController();
    controller.abort();
    await expect(
      f.client.video("video", "A shore.", controller.signal),
    ).rejects.toThrow();
    expect(f.fetcher).toHaveBeenCalledTimes(2);
  });
});
