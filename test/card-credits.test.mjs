import { describe, expect, it, vi } from "vitest";
import { createCredits, creditsText } from "../v2/card-game/credits.mjs";

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
});
