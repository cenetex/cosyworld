import { describe, expect, it } from "vitest";
import {
  createWorld,
  legalActions,
  matchingActions,
  play,
  plan,
  setAim,
  chat,
  reflectionOpen,
  exits,
  itemPlace,
  rootHolder,
  carried,
  covered,
  validateWorld,
  encodeSave,
  decodeSave,
} from "../v2/card-game/world.mjs";
import { createServer } from "../v2/card-game/serve.mjs";

function act(s, kind, item, target) {
  const action = legalActions(s).find(
    (a) =>
      a.kind === kind &&
      (!item || a.item === item) &&
      (!target || a.target === target),
  );
  expect(
    action,
    `${kind} ${item || ""} ${target || ""} at turn ${s.turn}`,
  ).toBeTruthy();
  const result = play(s, action);
  expect(result.ok).toBe(true);
  return result.state;
}

describe("the reflected shore card game", () => {
  it("keeps inspection and planning free and leaves the source world intact", () => {
    const s = createWorld(),
      before = encodeSave(s);
    legalActions(s);
    matchingActions(s, ["lamp"]);
    plan(s);
    exits(s, "station");
    expect(encodeSave(s)).toBe(before);
    const next = act(s, "take", "lamp");
    expect(next.turn).toBe(1);
    expect(encodeSave(s)).toBe(before);
  });

  it("lets the cast move and claim an object while Vale waits", () => {
    let s = act(createWorld(), "wait");
    expect(s.actors.moth.place).toBe("station");
    s = act(s, "wait");
    expect(s.items.lamp.holder).toBe("moth");
    s = act(s, "wait");
    expect(s.items.lamp.lit).toBe(true);
    s = act(s, "wait");
    expect(s.actors.moth.place).toBe("pond");
    s = act(s, "wait");
    expect(s.items.lamp.holder).toBe("pond");
    expect(s.actors.vale.place).toBe("station");
    expect(reflectionOpen(s)).toBe(true);
  });

  it("supports three chosen aims through the common action rules", () => {
    for (const aim of ["explore", "moth", "bell"]) {
      let s = setAim(createWorld(), aim);
      for (let i = 0; i < 6; i++) s = play(s, plan(s).action).state;
      if (aim === "explore") expect(s.actors.vale.crossed).toBeGreaterThan(0);
      if (aim === "moth") {
        expect(itemPlace(s, "lamp")).toBe("pond");
        expect(s.items.lamp.lit).toBe(true);
      }
      if (aim === "bell") expect(s.items.bell.holder).toBe("pond");
    }
  });

  it("opens a real route with light and closes it when covered", () => {
    let s = createWorld();
    for (let i = 0; i < 4; i++) s = play(s, plan(s).action).state;
    expect(s.actors.vale.place).toBe("pond");
    expect(s.actors.vale.crossed).toBe(1);
    expect(exits(s, "pond")).toContain("attic");
    s = act(s, "cover", "cloth", "lamp");
    expect(covered(s, "lamp")).toBe(true);
    expect(exits(s, "pond")).toEqual(["station"]);
    const fuel = s.items.lamp.fuel;
    s = act(s, "take", "cloth");
    expect(reflectionOpen(s)).toBe(true);
    expect(s.items.lamp.fuel).toBe(fuel - 1);
  });

  it("moves a cover with its object when a different avatar takes it", () => {
    let s = createWorld();
    s.actors.vale.place = "pond";
    s.actors.moth.place = "attic";
    s.items.lamp.holder = "vale";
    s = act(s, "cover", "cloth", "lamp");
    expect(carried(s, "vale")).toEqual(["lamp", "cloth"]);
    s = act(s, "move", null, "station");
    expect(itemPlace(s, "cloth")).toBe("station");
    s = act(s, "drop", "lamp");
    expect(s.items.lamp.holder).toBe("moth");
    expect(rootHolder(s, "cloth")).toBe("moth");
    expect(s.items.lamp.history.some((e) => e.includes("Pip takes"))).toBe(
      true,
    );
  });

  it("spends oil and caps fuel at twelve", () => {
    let s = createWorld();
    s.actors.vale.place = "attic";
    s.items.lamp.holder = "vale";
    s.items.lamp.fuel = 10;
    expect(matchingActions(s, ["oil", "lamp"]).map((a) => a.kind)).toEqual([
      "refill",
    ]);
    s = act(s, "refill", "oil");
    expect(s.items.lamp.fuel).toBe(12);
    expect(s.items.oil.doses).toBe(2);
    expect(legalActions(s).some((a) => a.kind === "refill")).toBe(false);
  });

  it("lets the keeper follow noise, take the bell, and carry it away", () => {
    let s = act(createWorld(), "ring", "bell");
    expect(s.actors.keeper.place).toBe("station");
    s = act(s, "wait");
    expect(s.items.bell.holder).toBe("keeper");
    s = act(s, "wait");
    expect(itemPlace(s, "bell")).toBe("attic");
    s = act(s, "wait");
    expect(s.items.bell.holder).toBe("attic");
    expect(s.items.bell.ringing).toBe(0);
  });

  it("uses the same cloth to stop sound and change the keeper’s plan", () => {
    let s = createWorld();
    s.actors.vale.place = "pond";
    s.actors.keeper.place = "station";
    s.items.bell.holder = "pond";
    s.items.bell.ringing = 2;
    s = act(s, "cover", "cloth", "bell");
    expect(s.items.bell.ringing).toBe(0);
    expect(s.actors.keeper.place).toBe("station");
    expect(legalActions(s).some((a) => a.kind === "ring")).toBe(false);
  });

  it("keeps possession with an unwilling owner and accepts a willing handover", () => {
    let s = createWorld();
    s.actors.moth.place = "station";
    s.items.lamp.holder = "moth";
    s = act(s, "ask", "lamp", "moth");
    expect(s.items.lamp.holder).toBe("moth");
    expect(
      legalActions(s).some((a) => a.kind === "take" && a.item === "lamp"),
    ).toBe(false);
    s = createWorld();
    s.actors.keeper.place = "station";
    s.items.bell.holder = "keeper";
    s = act(s, "ask", "bell", "keeper");
    expect(s.items.bell.holder).toBe("vale");
  });

  it("counts attached objects when enforcing carrying space", () => {
    const s = createWorld();
    s.items.lamp.holder = "vale";
    s.items.bell.holder = "vale";
    s.items.oil.holder = "vale";
    s.items.cloth.holder = "station";
    expect(
      legalActions(s).some((a) => a.kind === "take" && a.item === "cloth"),
    ).toBe(false);
    expect(legalActions(s).some((a) => a.kind === "cover")).toBe(false);
  });

  it("supports card pairs for giving, using, and carrying", () => {
    const s = createWorld();
    s.items.lamp.holder = "vale";
    s.actors.moth.place = "station";
    expect(matchingActions(s, ["lamp", "moth"]).map((a) => a.kind)).toEqual([
      "give",
    ]);
    expect(matchingActions(s, ["lamp", "pond"]).map((a) => a.kind)).toEqual([
      "move",
    ]);
    expect(matchingActions(s, ["lamp", "oil", "pond"])).toEqual([]);
  });

  it("rejects stale and forged plays without spending time or changing state", () => {
    const s = createWorld(),
      before = encodeSave(s),
      action = legalActions(s).find((a) => a.kind === "take");
    expect(play(s, action, s.revision + 1).ok).toBe(false);
    expect(play(s, { ...action, key: "take:vale:oil:" }).ok).toBe(false);
    expect(play(s, plan(s, "moth").action).ok).toBe(false);
    expect(encodeSave(s)).toBe(before);
  });

  it("prepares chat commands for confirmation and changes aims without a turn", () => {
    const s = createWorld();
    const result = chat(s, "take lamp");
    expect(result.action.kind).toBe("take");
    expect(result.state.items.lamp.holder).toBe("station");
    expect(result.state.turn).toBe(0);
    const goal = chat(result.state, "aim: help Pip");
    expect(goal.state.actors.vale.aim).toBe("moth");
    expect(goal.state.turn).toBe(0);
    expect(chat(s, "destroy the universe").action).toBeUndefined();
    const fixture = createWorld();
    fixture.actors.vale.place = "attic";
    fixture.items.lamp.holder = "vale";
    expect(chat(fixture, "use oil on lamp").action.kind).toBe("refill");
  });

  it("restores positions, cast aims, object memory, and the exact next turn", () => {
    let s = createWorld();
    for (let i = 0; i < 5; i++) s = play(s, plan(s).action).state;
    const restored = decodeSave(encodeSave(s));
    expect(restored).toEqual(s);
    expect(play(restored, plan(restored).action)).toEqual(
      play(s, plan(s).action),
    );
    expect(() => decodeSave("{")).toThrow();
    expect(() => decodeSave(JSON.stringify({ ...s, schema: 2 }))).toThrow();
    const broken = structuredClone(s);
    broken.items.cloth.holder = "cloth";
    expect(() => validateWorld(broken)).toThrow();
  });

  it("preserves unique objects and valid state across 4000 varied turns", () => {
    let seed = 109,
      s = createWorld();
    for (let i = 0; i < 4000; i++) {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      const actions = legalActions(s);
      const action =
        i % 5 === 0 ? plan(s).action : actions[seed % actions.length];
      const result = play(s, action);
      expect(result.ok).toBe(true);
      s = result.state;
      expect(() => validateWorld(s)).not.toThrow();
      expect(Object.keys(s.items)).toHaveLength(4);
      if (i % 97 === 0) {
        s = decodeSave(encodeSave(s));
        s = setAim(s, ["explore", "moth", "bell", "free"][seed % 4]);
      }
    }
    expect(s.turn).toBe(4000);
  });

  it("serves only the game assets and supports a clean browser reload", async () => {
    const server = createServer();
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const url = `http://127.0.0.1:${server.address().port}`;
    try {
      const page = await fetch(url);
      expect(page.status).toBe(200);
      expect(await page.text()).toContain("Card table");
      const script = await fetch(`${url}/world.mjs`);
      expect(script.headers.get("content-type")).toContain("text/javascript");
      expect((await fetch(`${url}/package.json`)).status).toBe(404);
      expect((await fetch(`${url}/`, { method: "POST" })).status).toBe(404);
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  });
});
