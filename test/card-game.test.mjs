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

  it("draws the moth's want from the oil, not the lamp flame", () => {
    const s = createWorld();
    expect(s.actors.moth.want).toMatchObject({ kind: "item", target: "oil" });
  });

  it("opens the mirror by the lamp's light and dark", () => {
    const s = createWorld();
    s.actors.vale.place = "pond";
    // A dark attic opens the mirror to the pond.
    s.items.lamp.holder = "attic";
    s.items.oil.holder = "station";
    expect(exits(s, "attic")).toContain("pond");
    // A lit lamp held at the pond opens the mirror to the attic.
    s.items.lamp.holder = "vale";
    s.items.oil.holder = "pond";
    expect(exits(s, "pond")).toContain("attic");
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
      picks = 0,
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
      if (action.kind === "focus") picks += 1;
      s = result.state;
      expect(() => validateWorld(s)).not.toThrow();
      expect(Object.keys(s.items).sort()).toEqual(itemIds);
      if (i % 97 === 0) {
        s = decodeSave(encodeSave(s));
      }
    }
    // Choosing a quest spends no turn; a long rest at the sanctuary sleeps on.
    expect(s.turn).toBeGreaterThanOrEqual(4000 - picks);
  }, 120_000);

  it("scopes import permissions to the authoring page aliases", async () => {
    const server = createServer();
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const url = `http://127.0.0.1:${server.address().port}`;
    try {
      const root = await fetch(url);
      const html = await root.text();
      const policy = root.headers.get("content-security-policy");
      expect(policy).toContain("img-src 'self' data:;");
      expect(policy).toContain("connect-src 'self';");
      for (const path of ["/make", "/make/", "/make?import=github"]) {
        for (const method of ["GET", "HEAD"]) {
          const page = await fetch(`${url}${path}`, { method });
          expect(page.status).toBe(200);
          expect(page.headers.get("cache-control")).toBe("no-store");
          expect(page.headers.get("referrer-policy")).toBe("no-referrer");
          expect(page.headers.get("etag")).toBeNull();
          const authoring = page.headers.get("content-security-policy");
          expect(authoring).toContain("img-src 'self' data: blob:;");
          expect(authoring).toContain(
            "connect-src 'self' https://api.github.com https://raw.githubusercontent.com;",
          );
          expect(
            authoring
              .replace("data: blob:", "data:")
              .replace(
                " https://api.github.com https://raw.githubusercontent.com",
                "",
              ),
          ).toBe(policy);
          expect(await page.text()).toBe(method === "GET" ? html : "");
        }
      }
      expect(html).toContain('<base href="/card-game/" />');
      for (const path of [
        "/?make=1",
        "/card-game/",
        "/card-game/index.html",
        "/privacy",
      ]) {
        expect(
          (await fetch(`${url}${path}`)).headers.get("content-security-policy"),
        ).toBe(policy);
      }
      for (const path of [
        "/make/entry.mjs",
        "/card-game/make",
        "/make-other",
      ]) {
        expect((await fetch(`${url}${path}`)).status).toBe(404);
      }
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  });

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
    expect(app).toContain(
      "scene.slots = revealedStage({ cast: sceneCast(world) }, cardIsCovered).cast;",
    );
    expect(app).toContain("currentState: true,");
  });
});
