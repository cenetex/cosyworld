import { afterEach, expect, it, vi } from "vitest";
import { requestNarrative } from "../v2/card-game/narrative.mjs";
import { request } from "../v2/card-game/shared-auth.mjs";

afterEach(() => vi.unstubAllGlobals());

it("uses server dialogue with an earlier connected chat preference", async () => {
  vi.stubGlobal("sessionStorage", {
    getItem: () =>
      JSON.stringify({ key: "sk-or-player-media-key", chat: true }),
  });
  const fetch = vi.fn(async () => Response.json({ entries: [] }));
  vi.stubGlobal("fetch", fetch);
  await expect(requestNarrative({ entities: [] })).resolves.toEqual({
    entries: [],
  });
  expect(fetch).toHaveBeenCalledExactlyOnceWith(
    "/card-game/text",
    expect.objectContaining({
      headers: {
        "Content-Type": "application/json",
        Accept: "text/event-stream",
      },
    }),
  );
});

it.each(["play", "retry"])(
  "sends shared %s to the server with a media account connected",
  async (op) => {
    vi.stubGlobal("sessionStorage", {
      getItem: () =>
        JSON.stringify({ key: "sk-or-player-media-key", chat: true }),
    });
    const fetch = vi.fn(async () => Response.json({ ok: true }));
    vi.stubGlobal("fetch", fetch);
    await request("/card-game/shared/worlds/test/command", {
      op,
      key: "saved-play",
    });
    expect(fetch).toHaveBeenCalledExactlyOnceWith(
      "/card-game/shared/worlds/test/command",
      expect.objectContaining({
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ op, key: "saved-play" }),
      }),
    );
  },
);
