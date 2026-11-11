import { afterEach, describe, expect, it, vi } from "vitest";
import { fakeJobs } from "./helpers/fake-jobs.mjs";
import {
  acceptedOutput,
  createCharacterDraw,
  generateCharacter,
} from "../v2/card-game/authoring-draw.mjs";
const proposal = (name) => ({
  name,
  specialAbility: "The Lightbearer",
  description: "A gentle traveller.",
  aliases: [],
  evidence: name,
});
const seed = "Vale, Mara and Pip wait at the shore.";
describe("temporary character draws", () => {
  afterEach(() => vi.unstubAllGlobals());
  it("keeps retry details and reports invalid seeds through the same state", async () => {
    const server = fakeJobs();
    server.refuseNext(429, {
      error: "Wait before another draw.",
      code: "generation_rate",
      retryAfterMs: 30000,
    });
    const changed = vi.fn();
    const draw = createCharacterDraw({
      generate: generateCharacter,
      changed,
      fetch: server.fetch,
      env: server.env,
    });
    draw.setText(seed);
    await draw.find();
    expect(draw.state).toMatchObject({
      status: 429,
      code: "generation_rate",
      retryAfterMs: 30000,
      busy: false,
    });
    draw.setText("");
    expect(draw.state).toMatchObject({ status: 0, code: "", retryAfterMs: 0 });
    await draw.find();
    expect(draw.state.error).toMatch(/Add source text/);
    expect(draw.state.busy).toBe(false);
    expect(changed.mock.lastCall[0]).toEqual(draw.state);
  });
  it("keeps selected cards, deduplicates world aliases and saves only output", async () => {
    let values = [proposal("Vale"), proposal("Mara"), null];
    const requests = [];
    const draw = createCharacterDraw({
      randomSeed: () => 1,
      generate: async (request) => {
        requests.push(request);
        return values.shift();
      },
    });
    draw.setText(seed);
    await draw.find([{ name: "The keeper", aliases: ["Vale"] }]);
    expect(draw.state.cards.map((c) => c.name)).toEqual(["Mara"]);
    draw.select(draw.state.cards[0].id);
    const saved = draw.chosen();
    expect(Object.keys(saved[0])).toEqual([
      "name",
      "specialAbility",
      "description",
      "aliases",
    ]);
    expect(JSON.stringify(saved)).not.toContain(seed);
    expect(requests[1].excluded).toContain("Vale");
    values = [proposal("Pip"), null];
    await draw.find();
    expect(draw.state.cards.map((c) => c.name)).toEqual(["Mara", "Pip"]);
    expect(draw.chosen()).toEqual(saved);
    const accepted = draw.state.selected;
    draw.remove(accepted);
    draw.remove(accepted);
    expect(draw.state.cards.map((c) => c.name)).toEqual(["Pip"]);
    expect(draw.text).toBe(seed);
    draw.clear();
    expect(draw.text).toBe("");
    expect(draw.state.cards).toEqual([]);
  });
  it("ignores late responses after editing the seed or cancelling", async () => {
    let resolve;
    const draw = createCharacterDraw({
      randomSeed: () => 1,
      generate: () =>
        new Promise((done) => {
          resolve = done;
        }),
    });
    draw.setText(seed);
    const pending = draw.find();
    draw.setText("A new seed for Mara.");
    resolve(proposal("Vale"));
    await pending;
    expect(draw.state.cards).toEqual([]);
    expect(draw.state.busy).toBe(false);
    const cancelled = draw.find();
    draw.cancel();
    resolve(proposal("Mara"));
    await cancelled;
    expect(draw.state.cards).toEqual([]);
  });
  it("keeps partial success and requires another explicit draw after failure", async () => {
    let calls = 0;
    const draw = createCharacterDraw({
      randomSeed: () => 1,
      generate: async () => {
        if (++calls === 1) return proposal("Vale");
        throw Object.assign(new Error("Sign in with your passkey."), {
          status: 401,
        });
      },
    });
    draw.setText(seed);
    await draw.find();
    expect(calls).toBe(2);
    expect(draw.state.cards).toHaveLength(1);
    expect(draw.state.status).toBe(401);
    expect(draw.state.busy).toBe(false);
  });
  it("rejects unsupported names and bounds a draw at six requests", async () => {
    let calls = 0;
    const draw = createCharacterDraw({
      randomSeed: () => 1,
      generate: async () => {
        calls++;
        return proposal("Vale");
      },
    });
    draw.setText(seed);
    await draw.find();
    expect(calls).toBe(6);
    expect(draw.state.cards).toHaveLength(1);
    expect(
      acceptedOutput({ ...proposal("Vale"), source: seed }),
    ).not.toHaveProperty("evidence");
    draw.clear();
    draw.setText("A source without the supplied name.");
    await draw.find();
    expect(draw.state.cards).toHaveLength(0);
    expect(draw.state.error).toMatch(/supported by the source/);
  });
});
