import { needsVoyage, sailTo } from "./helpers/voyage.mjs";
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import {
  createWorld,
  decodeSave,
  encodeSave,
  exits,
  legalActions,
  play,
  senses,
} from "../v2/card-game/world.mjs";
import {
  packDefinition,
  packMediaFiles,
  entityActive,
  packChoices,
  hub,
  packDefinitions,
} from "../v2/card-game/pack-registry.mjs";
import { packProblems } from "../v2/card-game/pack-schema.mjs";
import { conditionMet } from "../v2/card-game/pack-rules.mjs";
import { learnLane } from "../v2/card-game/pack-transport.mjs";
import {
  backdrop,
  locationOverlay,
  travelCard,
} from "../v2/card-game/scene.mjs";
import { createServer } from "../v2/card-game/serve.mjs";
import { branchItems, upgradedItems } from "./fixtures/card-upgraded-items.mjs";
const pack = packDefinition("greek-drama");
const openingPlaces = [
  "greek-harbor",
  "greek-courtyard",
  "greek-well",
  "greek-gate",
  "greek-battlefield",
  "greek-palace",
  "greek-sanctuary",
  "greek-road-thebes",
  "greek-ship",
];
const openDoorPlaces = [
  "greek-athens",
  "greek-piraeus",
  "greek-colonus",
  "greek-eleusis",
  "greek-marathon",
];
const sectionPlaces = pack.sections.flatMap((section) => section.places);
const ajaxPlaces = pack.sections.find(
  (section) => section.id === "greek-ajax",
).places;
// Retired roads keep their IDs in the release for saved history only.
const retired = (id) => pack.places[id]?.retired === true;
const openDoorReleasedPlaces = pack.release.places.filter(
  (id) =>
    !retired(id) && !["greek-road-athens-harbor", ...ajaxPlaces].includes(id),
);
const openDoorItems = [
  "greek-burial-petition",
  "greek-return-cloths",
  "greek-provision-basket",
  "greek-ash-urn",
  "greek-return-list",
  "greek-grove-cup",
  "greek-grove-honey",
  "greek-shelter-blanket",
  "greek-refuge-tablet",
  "greek-pyre-account",
  "greek-marathon-record",
];
const legacy = (name) =>
  JSON.parse(
    readFileSync(
      new URL(
        `./fixtures/wine-dark-legacy/schema6-${name}.json`,
        import.meta.url,
      ),
      "utf8",
    ),
  );
const act = (s, kind, fields = {}) => {
  if (kind === "move" && needsVoyage(s, "vale", fields.target))
    return sailTo(s, fields.target);
  const a = legalActions(s).find(
    (a) =>
      a.kind === kind && Object.entries(fields).every(([k, v]) => a[k] === v),
  );
  expect(a).toBeTruthy();
  const r = play(s, a);
  expect(r.ok, r.error).toBe(true);
  return r.state;
};
// The battlefield road is open while the guard at the gate holds the decree.
const reachable = (world) => {
  const s = structuredClone(world);
  s.items["greek-decree"].holder = "greek-guard";
  const seen = new Set([pack.entry]);
  for (const id of seen)
    for (const to of exits(s, id, "vale"))
      if (to.startsWith("greek-")) seen.add(to);
  return [...seen].sort();
};
describe("the Theban release and its ship", () => {
  it("opens seven shore places and the harbor road, then the ship after its first signal", () => {
    const s = createWorld();
    expect(s.packs[pack.id].scope).toBe("opening");
    expect(reachable(s)).toEqual(
      openingPlaces.filter((id) => id !== "greek-ship").sort(),
    );
    s.crossings["pond-greek-harbor"].discovered = true;
    expect(reachable(s)).toEqual([...openingPlaces].sort());
    expect(reachable(s)).toHaveLength(9);
    expect(pack.release.places).toHaveLength(28);
    expect(
      pack.release.places
        .filter((id) => !retired(id) && id !== "greek-road-athens-harbor")
        .sort(),
    ).toEqual(
      [
        ...openingPlaces,
        // Piraeus Quays lies outside every section; a ship with the Travel
        // Provisions aboard reaches it.
        "greek-piraeus",
        ...sectionPlaces.filter(
          (id) => !retired(id) && id !== "greek-road-athens-harbor",
        ),
      ].sort(),
    );
    expect(entityActive(s, "greek-athens")).toBe(false);
    expect(entityActive(s, "greek-rhapsode")).toBe(true);
    expect(s.actors["greek-rhapsode"].place).toBe("greek-harbor");
  });
  it("opens five more places when Dione receives the guard's tablet and keeps them through reload", () => {
    let s = createWorld();
    s.crossings["pond-greek-harbor"].discovered = true;
    s.actors.vale.place = "greek-gate";
    // Meeting the guard tells the decree; the shovel handed to him reports it.
    s = act(s, "take", { item: "greek-shovel" });
    s = act(s, "give", { item: "greek-shovel", target: "greek-guard" });
    s = act(s, "take", { item: "greek-guard-tablet" });
    s.actors.vale.place = "greek-courtyard";
    expect(reachable(s)).toHaveLength(9);
    s = act(s, "give", { item: "greek-guard-tablet", target: "greek-baker" });
    // The tablet on Dione's table opens the Cithaeron road from the
    // battlefield to the countryside. The Sacred Way waits for the mothers'
    // petition; the ship with the Travel Provisions reaches the city.
    expect(reachable(s)).toContain("greek-eleusis");
    expect(reachable(s)).not.toContain("greek-athens");
    s.items["greek-provisions"].holder = "greek-ship";
    expect(reachable(s)).toEqual([...openDoorReleasedPlaces].sort());
    expect(reachable(s)).toHaveLength(17);
    s = decodeSave(encodeSave(s));
    expect(reachable(s)).toEqual([...openDoorReleasedPlaces].sort());
    for (const start of openDoorPlaces) {
      const trip = structuredClone(s);
      trip.transports["greek-ship"].dock = "greek-piraeus";
      // Vale sailed in, so she knows the lane home from Piraeus.
      learnLane(trip, "vale", "greek-harbor", "greek-piraeus");
      // The Long Walls lead home from the city once the plea's olive branch
      // is in the Agora; the mothers' petition there keeps the Sacred Way
      // open from Eleusis.
      Object.assign(trip.packs[pack.id].flags, {
        "greek-open-door-mothers-heard": true,
        "greek-open-door-plea-registered": true,
      });
      for (const id of ["greek-burial-petition", "greek-olive-branch"])
        trip.items[id].holder = "greek-athens";
      const seen = new Set([start]);
      for (const id of seen)
        for (const to of exits(trip, id, "vale"))
          if (pack.release.places.includes(to)) seen.add(to);
      expect(seen.has(pack.entry), start).toBe(true);
    }
  });
  it("withholds empty inquiries and later branch menus without deleting source works", () => {
    const s = createWorld();
    for (const place of pack.release.places) {
      s.actors.vale.place = place;
      const ids = packChoices(s).map((c) => c.choiceId);
      expect(
        ids.some(
          (id) =>
            id.startsWith("greek-inquire-") || id.startsWith("greek-helen-"),
        ),
      ).toBe(false);
    }
    expect(pack.works).toHaveLength(44);
    expect(Object.keys(pack.places)).toHaveLength(67);
  });
  it("preserves opening scope through reloads", () => {
    let s = createWorld();
    s.crossings["pond-greek-harbor"].discovered = true;
    for (let i = 0; i < 3; i++) s = decodeSave(encodeSave(s));
    expect(reachable(s)).toEqual([...openingPlaces].sort());
  });
  it("keeps a route from every opening place back to the pond after the signal", () => {
    const s = createWorld();
    s.crossings["pond-greek-harbor"].discovered = true;
    for (const start of openingPlaces.filter((id) => id !== "greek-ship")) {
      const seen = new Set([start]);
      for (const id of seen)
        for (const to of exits(s, id, "vale"))
          if (pack.release.places.includes(to)) seen.add(to);
      expect(seen.has(pack.entry)).toBe(true);
    }
    expect(exits(s, pack.entry, "vale")).toContain("greek-ship");
    s.actors.vale.place = pack.entry;
    const aboard = act(s, "move", { target: "greek-ship" });
    expect(exits(aboard, "greek-ship", "vale")).toEqual(["pond"]);
  });
  it("retains genuine schema-6 branches, evidence, memories and wider geography", () => {
    const before = legacy("egypt"),
      after = decodeSave(JSON.stringify(before));
    expect(after.schema).toBe(7);
    expect(after.packs[pack.id].scope).toBe("full");
    for (const key of ["choices", "flags", "receipts", "met"])
      expect(after.packs[pack.id][key]).toEqual(before.packs[pack.id][key]);
    expect(
      Object.fromEntries(
        Object.keys(before.items).map((id) => [id, after.items[id]]),
      ),
    ).toEqual(upgradedItems(before.items));
    expect(
      Object.keys(after.items)
        .filter((id) => !Object.hasOwn(before.items, id))
        .sort(),
    ).toEqual(
      [
        "board",
        "boardyai-calling-card",
        "can",
        "greek-olive-branch",
        "greek-burial-account",
        "greek-creon-writ",
        "greek-guard-tablet",
        "float",
        "kite",
        "mask",
        "routes",
        "shears",
        ...openDoorItems,
        ...Object.keys(pack.items).filter((id) => id.startsWith("greek-ajax-")),
        ...Object.keys(packDefinition("hoppycat-archive").items),
        ...Object.keys(packDefinition("willows").items),
        ...Object.keys(packDefinition("lonely-forest").items),
      ].sort(),
    );
    expect(after.memories).toMatchObject(before.memories);
    // Quest records leave the history; every other event stays as it was.
    expect(after.log).toEqual(
      before.log
        .filter(
          (e) => e.kind !== "quest" && !/-quest$|^pursue$/u.test(e.verb || ""),
        )
        .map(({ questPlan, consequence, questKey, ...e }) => e),
    );
    expect(after.quests).toBeUndefined();
    expect(Object.values(after.actors).every((a) => !("progress" in a))).toBe(
      true,
    );
    expect(after.actors.vale.place).toBe("greek-egypt-tomb");
    expect(after.items["greek-egypt-testimony"].holder).toBe("vale");
    expect(entityActive(after, "greek-athens")).toBe(true);
    expect(entityActive(after, "greek-helen-troy")).toBe(false);
    expect(decodeSave(encodeSave(after))).toEqual(after);
  });
  it("restarts a halfway signal without counting migration as a flash", () => {
    // Revision 10 needs one cover and uncover, so the old halfway mark of two
    // steps would read as complete. It starts again; one cycle calls the ship.
    let s = decodeSave(JSON.stringify(legacy("halfway")));
    expect(s.crossings["pond-greek-harbor"].phase).toBe(0);
    expect(locationOverlay(s, "pond")).toBeNull();
    s = act(s, "cover", { item: "cloth", target: "lamp" });
    expect(locationOverlay(s, "pond")).toBeNull();
    s = act(s, "take", { item: "cloth" });
    expect(locationOverlay(s, "pond")).toMatch(/pond-ship-overlay\.png$/);
    expect(travelCard(s, "greek-ship")).toMatchObject({
      name: "Greek ship",
      art: "./assets/greek-drama/ship-card.webp",
    });
    s = act(s, "move", { target: "greek-ship" });
    s = act(s, "move", { target: "greek-harbor" });
    expect(s.actors.vale.place).toBe("greek-harbor");
  });
  it("rejects false histories and conflicting migration state", () => {
    const s = legacy("egypt");
    s.packs[pack.id].choices["greek-helen-account"] = "troy";
    expect(() => decodeSave(JSON.stringify(s))).toThrow();
    const mixed = decodeSave(JSON.stringify(legacy("halfway")));
    mixed.schema = 6;
    mixed.locations.pond.shipSignal = 4;
    expect(() => decodeSave(JSON.stringify(mixed))).toThrow();
  });
  it("rejects unknown release modes and changes to withheld residents", () => {
    const s = createWorld();
    s.packs[pack.id].scope = "everything";
    expect(() => encodeSave(s)).toThrow();
    const changed = createWorld();
    changed.actors["greek-helen-egypt"].place = "greek-harbor";
    expect(() => encodeSave(changed)).toThrow();
  });
  it("keeps seven opening paintings and adds five section paintings", () => {
    const openingImages = openingPlaces
      .filter((id) => id !== "greek-ship" && id !== "greek-road-thebes")
      .map(backdrop);
    const sectionImages = openDoorPlaces.map(backdrop);
    expect(new Set(openingImages).size).toBe(7);
    expect(new Set(sectionImages).size).toBe(5);
    expect(
      sectionImages.every((image) =>
        /\/(open-door-|athens-grand-agora|piraeus-open-berth)/.test(image),
      ),
    ).toBe(true);
    const images = [...openingImages, ...sectionImages];
    expect(new Set(images).size).toBe(12);
    expect(images.every((p) => p.endsWith(".webp"))).toBe(true);
    for (const image of images) {
      const bytes = readFileSync(
        new URL(`../v2/card-game/${image}`, import.meta.url),
      );
      expect(bytes.toString("ascii", 0, 4)).toBe("RIFF");
      expect(bytes.toString("ascii", 8, 12)).toBe("WEBP");
    }
  });
  it("retains the empty pond and hides ship art until actual arrival", () => {
    const s = createWorld();
    s.actors.vale.place = "pond";
    expect(backdrop("pond")).toBe("./assets/pond.png");
    expect(locationOverlay(s, "pond")).toBeNull();
    expect(travelCard(s, pack.entry)).toBeNull();
  });
  it("checks every committed art checksum", () => {
    const assets = [
      "scenery-provenance.json",
      "open-door-art.json",
      "ports-roads-art.json",
      "harbor-road-night-provenance.json",
    ].flatMap(
      (file) =>
        JSON.parse(
          readFileSync(
            new URL(
              `../v2/card-game/assets/greek-drama/${file}`,
              import.meta.url,
            ),
            "utf8",
          ),
        ).assets,
    );
    for (const image of openDoorPlaces.map(backdrop)) {
      expect(packMediaFiles).toContain(image.replace(/^\.\//, ""));
      expect(assets.some((asset) => image.endsWith(`/${asset.file}`))).toBe(
        true,
      );
    }
    for (const image of assets) {
      const bytes = readFileSync(
        new URL(
          `../v2/card-game/assets/greek-drama/${image.file}`,
          import.meta.url,
        ),
      );
      expect(createHash("sha256").update(bytes).digest("hex"), image.file).toBe(
        image.sha256,
      );
    }
  });
  it("serves all mounted media formats correctly", async () => {
    const server = createServer();
    await new Promise((r) => server.listen(0, "127.0.0.1", r));
    try {
      for (const path of packMediaFiles) {
        const response = await fetch(
          `http://127.0.0.1:${server.address().port}/${path}`,
        );
        expect(response.status, path).toBe(200);
        const type = path.endsWith(".svg")
          ? "image/svg+xml"
          : path.endsWith(".webp")
            ? "image/webp"
            : "image/png";
        expect(response.headers.get("content-type")).toContain(type);
        await response.arrayBuffer();
      }
    } finally {
      await new Promise((r) => server.close(r));
    }
  });
  it("evaluates light with arbitrary referenced entities", () => {
    const s = {
      items: { candle: { lit: true, fuel: 2, holder: "wanderer" } },
      actors: { wanderer: { place: "shore" } },
      packs: {},
      turn: 0,
    };
    expect(
      conditionMet(s, { kind: "light", item: "candle", at: ["shore"] }, senses),
    ).toBe(true);
    expect(
      conditionMet(
        s,
        {
          kind: "not",
          condition: { kind: "light", item: "candle", at: ["cave"] },
        },
        senses,
      ),
    ).toBe(true);
    s.items.wrap = { holder: "candle" };
    expect(
      conditionMet(
        s,
        { kind: "light", item: "candle", at: ["shore"], uncovered: true },
        senses,
      ),
    ).toBe(false);
    expect(
      conditionMet(s, { kind: "light", item: "candle", at: ["shore"] }, senses),
    ).toBe(true);
  });
  it.each([
    (p) => (p.routes = {}),
    (p) => (p.choices[0].effects = null),
    (p) => (p.avatars["greek-antigone"] = null),
    (p) => (p.continuity.groups = [{ key: "bad", options: null }]),
    (p) => (p.release.places = null),
  ])("rejects malformed author data", (mutate) => {
    const bad = structuredClone(pack);
    mutate(bad);
    expect(
      packProblems(
        bad,
        hub,
        packDefinitions.flatMap((p) => Object.keys(p.places)),
      ).length,
    ).toBeGreaterThan(0);
  });
});
