import { readFileSync } from "node:fs";
import { setImmediate as yieldToRunner } from "node:timers/promises";
import { questing } from "./helpers/first-quest.mjs";
import { describe, expect, it } from "vitest";
import {
  createWorld as baseCreateWorld,
  legalActions,
  matchingActions,
  play,
  plan,
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
// Play here starts past the pond, where the first quest begins.
const createWorld = (...args) => questing(baseCreateWorld(...args));
import { createServer } from "../v2/card-game/serve.mjs";
import { roomTracks } from "../v2/card-game/music.mjs";
import { endStandoff } from "./helpers/standoff.mjs";

function act(s, kind, item, target) {
  s = endStandoff(s);
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

  it("lets the cast move and claim its wanted object while Vale waits", () => {
    let s = act(createWorld(), "wait");
    expect(s.actors.moth.place).toBe("station");
    s = act(s, "wait");
    expect(s.items.lamp.holder).toBe("moth");
    // A moth wants the flame: Pip lights the lamp he took.
    s = act(s, "wait");
    expect(s.items.lamp.lit).toBe(true);
    expect(
      s.log.findLast((e) => e.verb === "want_met" && e.actorId === "moth"),
    ).toMatchObject({
      wantMet: { kind: "item", target: "lamp" },
    });
    expect(s.actors.moth.xp).toBe(1);
    // Met away from home, Pip rests right there with his next want.
    expect(s.actors.moth.want).not.toMatchObject({ target: "pond" });
    s = act(s, "wait");
    expect(s.actors.moth.place).toBe("station");
    expect(s.items.lamp.holder).toBe("moth");
  });

  it("opens a real route with light and closes it when covered", () => {
    let s = createWorld();
    s.items.cloth.holder = "pond";
    s = act(s, "take", "lamp");
    s = act(s, "light", "lamp");
    s = act(s, "move", null, "pond");
    s = act(s, "move", null, "attic");
    // The lit attic mirror holds only the room; dousing opens it (#1600).
    expect(exits(s, "attic")).toEqual([]);
    s = act(s, "snuff", "lamp");
    s = act(s, "move", null, "pond");
    expect(s.actors.vale.place).toBe("pond");
    expect(s.actors.vale.crossed).toBe(2);
    expect(exits(s, "pond")).toEqual(["station"]);
    s = act(s, "light", "lamp");
    expect(exits(s, "pond")).toContain("attic");
    s = act(s, "cover", "cloth", "lamp");
    expect(covered(s, "lamp")).toBe(true);
    expect(exits(s, "pond")).toEqual(["station"]);
    s = endStandoff(s);
    const fuel = s.items.lamp.fuel;
    s = act(s, "take", "cloth");
    expect(reflectionOpen(s)).toBe(true);
    expect(s.items.lamp.fuel).toBe(fuel - 1);
  });

  it("moves a cover with its object when a different avatar takes it", () => {
    let s = createWorld();
    s.actors.vale.place = "pond";
    s.items.cloth.holder = "pond";
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

  it("offers no pour play while the lamp still burns", () => {
    const s = createWorld();
    s.actors.vale.place = "attic";
    s.items.lamp.holder = "vale";
    s.items.lamp.fuel = 10;
    s.items.oil.holder = "vale";
    expect(matchingActions(s, ["oil", "lamp"])).toEqual([]);
    const next = act(s, "wait");
    expect(next.items.oil.holder).toBe("vale");
    expect(next.items.lamp.fuel).toBe(10);
    expect(next.log.some((e) => e.verb === "refuel")).toBe(false);
  });

  it("refuels a lamp that runs dry in a hand holding the flask, then returns the flask to the station", () => {
    let s = createWorld();
    s.actors.vale.place = "pond";
    s.items.lamp.holder = "vale";
    s.items.lamp.fuel = 1;
    s.items.lamp.lit = true;
    s.items.oil.holder = "vale";
    s = act(s, "wait");
    expect(s.items.lamp).toMatchObject({ fuel: 12, lit: false, holder: "vale" });
    expect(s.items.oil.holder).toBe("station");
    expect(s.items.oil).not.toHaveProperty("doses");
    const dry = s.log.findIndex((e) => e.text.includes("runs dry"));
    const refuel = s.log.findIndex((e) => e.verb === "refuel");
    expect(dry).toBeGreaterThanOrEqual(0);
    expect(refuel).toBeGreaterThan(dry);
    expect(s.log[refuel]).toMatchObject({
      kind: "narration",
      verb: "refuel",
      actorId: "vale",
      itemId: "oil",
      targetId: "lamp",
      itemIds: ["oil", "lamp"],
      locationId: "pond",
      returnLocationId: "station",
      turn: s.turn,
    });
    expect(decodeSave(encodeSave(s))).toEqual(s);
  });

  it("refuels during the play that puts the flask and the empty lamp in one hand", () => {
    let s = createWorld();
    s.actors.vale.place = "station";
    s.items.lamp.holder = "vale";
    s.items.lamp.fuel = 0;
    s.items.oil.holder = "station";
    s = act(s, "take", "oil");
    expect(s.items.lamp.fuel).toBe(12);
    expect(s.items.oil.holder).toBe("station");
    const take = s.log.findIndex((e) => e.verb === "take" && e.itemId === "oil");
    const refuel = s.log.findIndex((e) => e.verb === "refuel");
    expect(refuel).toBeGreaterThan(take);
    expect(s.log[refuel]).toMatchObject({ turn: s.turn, actorId: "vale", locationId: "station" });
  });

  it("refuels a resident's lamp by the same rule", () => {
    let s = createWorld();
    s.actors.keeper.place = "station";
    s.items.lamp.holder = "keeper";
    s.items.lamp.fuel = 1;
    s.items.lamp.lit = true;
    s.items.oil.holder = "keeper";
    s = act(s, "wait");
    expect(s.items.lamp.fuel).toBe(12);
    expect(s.items.oil.holder).toBe("station");
    expect(s.log.find((e) => e.verb === "refuel")).toMatchObject({
      actorId: "keeper",
      locationId: "station",
    });
  });

  it("lets the keeper go for its wanted bell and carry it", () => {
    const start = createWorld();
    start.actors.keeper.place = "pond";
    start.items.bell.holder = "station";
    let s = act(start, "wait");
    expect(s.actors.keeper.place).toBe("station");
    s = act(s, "wait");
    expect(s.items.bell.holder).toBe("keeper");
    expect(s.actors.keeper.xp).toBe(1);
  });

  it("uses the same cloth to stop sound", () => {
    let s = createWorld();
    s.actors.vale.place = "pond";
    s.actors.keeper.place = "station";
    s.items.bell.holder = "pond";
    s.items.cloth.holder = "pond";
    s.items.bell.ringing = 2;
    s = act(s, "cover", "cloth", "bell");
    expect(s.items.bell.ringing).toBe(0);
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
    // The keeper values the lamp little and hands it over.
    s = createWorld();
    s.actors.keeper.place = "station";
    s.items.lamp.holder = "keeper";
    s = act(s, "ask", "lamp", "keeper");
    expect(s.items.lamp.holder).toBe("vale");
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

  it("restores positions, quest progress, object memory, and the exact next turn", () => {
    let s = createWorld();
    for (let i = 0; i < 5; i++) s = play(s, plan(s).action).state;
    const restored = decodeSave(encodeSave(s));
    expect(restored).toEqual(s);
    expect(play(restored, plan(restored).action)).toEqual(
      play(s, plan(s).action),
    );
    expect(() => decodeSave("{")).toThrow();
    expect(() => decodeSave(JSON.stringify({ ...s, schema: 8 }))).toThrow();
    const broken = structuredClone(s);
    broken.items.cloth.holder = "cloth";
    expect(() => validateWorld(broken)).toThrow();
  });

  it("preserves unique objects and valid state across 4000 varied turns", async () => {
    let seed = 109,
      s = createWorld();
    const itemIds = Object.keys(s.items).sort();
    for (let i = 0; i < 4000; i++) {
      // Keep progress messages flowing during the bounded simulation.
      if (i % 100 === 0) await yieldToRunner();
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      const actions = legalActions(s);
      const action =
        i % 5 === 0 ? plan(s).action : actions[seed % actions.length];
      const result = play(s, action);
      expect(result.ok).toBe(true);
      s = result.state;
      expect(() => validateWorld(s)).not.toThrow();
      expect(Object.keys(s.items).sort()).toEqual(itemIds);
      if (i % 97 === 0) {
        s = decodeSave(encodeSave(s));
      }
    }
    expect(s.turn).toBe(4000);
  }, 120_000);

  it("serves only the game assets and supports a clean browser reload", async () => {
    const server = createServer();
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const url = `http://127.0.0.1:${server.address().port}`;
    try {
      const page = await fetch(url);
      expect(page.status).toBe(200);
      const html = await page.text();
      expect(html).toContain("Current scene");
      expect(html).toContain('<base href="/card-game/" />');
      for (const file of [
        "",
        "style.css",
        "entry.mjs",
        "app.mjs",
        "world.mjs",
        "want.mjs",
        "life.mjs",
        "scene.mjs",
        "dialogue.mjs",
        "music.mjs",
        "cards.mjs",
        "lessons.mjs",
        "assets/station.png",
        "assets/badger-forest/steam-clock-background.png",
        "assets/badger-forest/badger-sleeping.png",
        "assets/badger-forest/badger-grumpy.png",
        "pack-schema.mjs",
        "pack-registry.mjs",
        "pack-rules.mjs",
        "pack-transport.mjs",
        "legacy-saves.mjs",
        "forest.json",
        "packs.json",
      ]) {
        expect((await fetch(`${url}/card-game/${file}`)).status).toBe(200);
      }
      expect((await fetch(`${url}/scene.mjs`)).status).toBe(200);
      expect((await fetch(`${url}/cards.mjs`)).status).toBe(200);
      expect((await fetch(`${url}/want.mjs`)).status).toBe(200);
      for (const id of ["station", "attic", "pond", "vale", "moth", "keeper"]) {
        const image = await fetch(`${url}/assets/${id}.png`);
        expect(image.status).toBe(200);
        expect(image.headers.get("content-type")).toContain("image/png");
        const bytes = new Uint8Array(await image.arrayBuffer());
        expect(Array.from(bytes.slice(0, 8))).toEqual([
          137, 80, 78, 71, 13, 10, 26, 10,
        ]);
      }
      const script = await fetch(`${url}/world.mjs`);
      for (const { file } of Object.values(roomTracks).flat()) {
        const path = `${url}/card-game/assets/music/${file}`;
        const song = await fetch(path);
        const m4a = file.endsWith(".m4a");
        expect(song.headers.get("content-type")).toBe(
          m4a ? "audio/mp4" : "audio/mpeg",
        );
        const bytes = Buffer.from(await song.arrayBuffer());
        if (m4a) expect(bytes.subarray(4, 8).toString()).toBe("ftyp");
        else expect(bytes.subarray(0, 3).toString()).toBe("ID3");
        const range = await fetch(path, { headers: { Range: "bytes=0-2" } });
        expect(range.status).toBe(206);
        expect(range.headers.get("content-range")).toBe(
          `bytes 0-2/${bytes.length}`,
        );
        expect(Buffer.from(await range.arrayBuffer())).toEqual(
          bytes.subarray(0, 3),
        );
        const tail = await fetch(path, { headers: { Range: "bytes=-32" } });
        expect(Buffer.from(await tail.arrayBuffer())).toEqual(
          bytes.subarray(-32),
        );
        expect(
          (await fetch(path, { headers: { Range: "bytes=999999999-" } }))
            .status,
        ).toBe(416);
        const head = await fetch(path, { method: "HEAD" });
        expect(head.headers.get("content-length")).toBe(String(bytes.length));
        expect(await head.text()).toBe("");
      }
      expect(script.headers.get("content-type")).toContain("text/javascript");
      expect((await fetch(`${url}/package.json`)).status).toBe(404);
      expect((await fetch(`${url}/`, { method: "POST" })).status).toBe(404);
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  });
  it("ends a review of earlier lines when a new play commits", () => {
    // A failed words request re-renders the scene; it must show the new cast.
    const app = readFileSync(
      new URL("../v2/card-game/app.mjs", import.meta.url),
      "utf8",
    );
    const commit = app.slice(
      app.indexOf("function performAction("),
      app.indexOf("\nfunction ", app.indexOf("function performAction(") + 1),
    );
    const accepted = commit.indexOf("world = result.state;");
    expect(accepted).toBeGreaterThan(0);
    expect(commit.indexOf("reviewing = false;")).toBeGreaterThan(accepted);
    // Read again and Previous line stage the cast present now.
    expect(app).toContain("review: reviewing || Boolean(sharedSession),");
    expect(app).toContain("scene.slots = sceneCast(world);");
    expect(app).toContain("currentState: true,");
  });
});
