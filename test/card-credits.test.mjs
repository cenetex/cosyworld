import { describe, expect, it, vi } from "vitest";
import {
  createCredits,
  creditsText,
  poolText,
} from "../v2/card-game/credits.mjs";

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

describe("passkey credits in the browser", () => {
  it("offers voices only to a signed-in passkey with a credit left", async () => {
    let balance = 1;
    const fetcher = vi.fn(async (path) =>
      path === "/card-game/credits"
        ? json({ signed_in: true, balance, prices: { tts: 1, video: 100 } })
        : new Response(new Uint8Array([255, 251]), {
            headers: { "Content-Type": "audio/mpeg" },
          }),
    );
    const credits = createCredits({ fetcher });
    expect(credits.voices.available()).toBe(false);
    await credits.refresh();
    expect(credits.voices.available()).toBe(true);
    expect(credits.affords("video")).toBe(false);
    balance = 0;
    const clip = await credits.voices.clip("vale", "Hello.", undefined);
    expect(clip.type).toBe("audio/mpeg");
    const [, request] = fetcher.mock.calls.find(([p]) => p.endsWith("speech"));
    expect(JSON.parse(request.body)).toEqual({
      speaker: "vale",
      text: "Hello.",
    });
    await vi.waitFor(() => expect(credits.voices.available()).toBe(false));
  });

  it("shows the server's reason when a voice is refused", async () => {
    const fetcher = async (path) =>
      path === "/card-game/speech"
        ? json({ error: "Out of credits for voices.", reason: "credits" }, 402)
        : json({ signed_in: true, balance: 0, prices: { tts: 1 } });
    const credits = createCredits({ fetcher });
    await expect(credits.voices.clip("vale", "Hi.")).rejects.toThrow(
      "Out of credits for voices.",
    );
  });

  it("reads the balance and prices for Settings", () => {
    expect(creditsText({ signed_in: false })).toMatch(/Sign in/u);
    expect(
      creditsText({
        signed_in: true,
        balance: 7,
        prices: { tts: 1, video: 100 },
      }),
    ).toBe("Credits: 7. A spoken line costs 1; a scene video costs 100.");
  });

  it("spends a shared world's pool and commits credits to it", async () => {
    let pool = 0;
    const calls = [];
    const fetcher = vi.fn(async (path, init = {}) => {
      calls.push([path, init.body && JSON.parse(init.body)]);
      if (path === "/card-game/credits")
        return json({
          signed_in: true,
          balance: 500,
          prices: { tts: 1, video: 100 },
        });
      if (path.startsWith("/card-game/credits/pool"))
        return json({
          world: "w1",
          pool,
          contributors: pool ? [{ name: "Moss", credits: pool }] : [],
        });
      if (path === "/card-game/credits/commit") {
        pool += JSON.parse(init.body).credits;
        return json({
          world: "w1",
          pool,
          contributors: [],
          balance: 500 - pool,
        });
      }
      return new Response(new Uint8Array([255, 251]), {
        headers: { "Content-Type": "audio/mpeg" },
      });
    });
    const credits = createCredits({ fetcher, world: "w1" });
    await credits.refresh();
    expect(calls.map(([path]) => path)).toContain(
      "/card-game/credits/pool?world=w1",
    );
    // A rich passkey still hears a shared world only from its pool.
    expect(credits.voices.available()).toBe(false);
    expect(poolText(credits.state.pool)).toBe(
      "This world's pool: 0 credits. Nobody has committed credits yet.",
    );
    expect((await credits.commit(100)).pool).toBe(100);
    const commit = calls.find(([path]) => path.endsWith("commit"))[1];
    expect(commit).toMatchObject({ world: "w1", credits: 100 });
    expect(commit.request_id).toMatch(/^commit-/u);
    expect(credits.affords("video")).toBe(true);
    expect(poolText(credits.state.pool)).toBe(
      "This world's pool: 100 credits. From Moss 100.",
    );
    await credits.voices.clip("vale", "Hello.");
    expect(calls.find(([path]) => path.endsWith("speech"))[1]).toEqual({
      speaker: "vale",
      text: "Hello.",
      world: "w1",
    });
  });
});
