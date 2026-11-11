import { selectLamp } from "./fixtures/card-attic-opening.mjs";
import { needsVoyage, sailTo } from "./helpers/voyage.mjs";
import { describe, expect, it } from "vitest";
import { openGreekGate } from "./helpers/greek-gate.mjs";
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
import { learnLane, summonTransport } from "../v2/card-game/pack-transport.mjs";
import {
  backdrop,
  locationOverlay,
  travelCard,
} from "../v2/card-game/scene.mjs";
import { createServer } from "../v2/card-game/serve.mjs";
import { upgradedItems } from "./fixtures/card-upgraded-items.mjs";
import { stowProvisions } from "./helpers/provisions.mjs";
import { funeralJourney } from "./helpers/greek-funeral.mjs";
import { settleGate } from "./helpers/world-life.mjs";
import { greekErrands } from "./helpers/greek-opening.mjs";
import { worldLife } from "../v2/card-game/resident-home.mjs";
// The errands are played with the cast standing still (still-cast, imported by
// the journey); this file's walks run with the world alive, so build, then restore.
const errandsDone = greekErrands().opened;
worldLife.on = true;
const pack = packDefinition("greek-drama");
const openingPlaces = [
  "greek-harbor",
  "greek-courtyard",
  "greek-well",
  "greek-gate",
  "greek-battlefield",
  "greek-polynices-hollow",
  "greek-palace",
  "greek-sanctuary",
  "greek-road-thebes",
  "greek-ship",
];
// Marathon, Troy and the Far Shores are rumours in new worlds (rules 94).
const openDoorPlaces = [
  "greek-athens",
  "greek-piraeus",
  "greek-colonus",
  "greek-eleusis",
];
const sectionPlaces = pack.sections.flatMap((section) => section.places);
const ajaxPlaces = pack.sections.find(
  (section) => section.id === "greek-ajax",
).places;
// Retired roads keep their IDs in the release for saved history only.
const retired = (id) => pack.places[id]?.retired === true;
const rumours = ["greek-marathon", ...ajaxPlaces];
const openDoorReleasedPlaces = pack.release.places.filter(
  (id) => !retired(id) && id !== "greek-road-athens-harbor",
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
// These walks begin with explicit custody that opens the City Gate.
const reachable = (world) => {
  const s = structuredClone(world);
  openGreekGate(s);
  settleGate(s);
  const seen = new Set([pack.entry]);
  for (const id of seen)
    for (const to of exits(s, id, "vale"))
      if (to.startsWith("greek-")) seen.add(to);
  return [...seen].sort();
};
describe("the Theban release and its ship", () => {
  it("opens the shore roads and ship while the Hollow waits for its shade", () => {
    const s = createWorld();
    expect(s.packs[pack.id].scope).toBe("opening");
    expect(reachable(s)).toEqual(
      openingPlaces.filter((id) => !["greek-ship", "greek-polynices-hollow"].includes(id)).sort(),
    );
    s.crossings["pond-greek-harbor"].discovered = true;
    expect(reachable(s)).toEqual(openingPlaces.filter((id) => id !== "greek-polynices-hollow").sort());
    expect(reachable(s)).toHaveLength(9);
    expect(pack.release.places).toHaveLength(25);
    for (const id of rumours) expect(pack.release.places).not.toContain(id);
    expect(
      pack.release.places
        .filter((id) => !retired(id) && id !== "greek-road-athens-harbor")
        .sort(),
    ).toEqual(
      [
        ...openingPlaces,
        // Piraeus Quays is Thebes's sea exit, outside every section.
        "greek-piraeus",
        ...sectionPlaces.filter(
          (id) =>
            !retired(id) &&
            id !== "greek-road-athens-harbor" &&
            !rumours.includes(id),
        ),
      ].sort(),
    );
    expect(entityActive(s, "greek-athens")).toBe(false);
    expect(entityActive(s, "greek-rhapsode")).toBe(true);
    expect(s.actors["greek-rhapsode"].place).toBe("greek-harbor");
  });
  it("opens the next countryside after Bury and keeps it through reload", () => {
    const journey = funeralJourney();
    let s = journey.buried;
    expect(reachable(journey.veiled).filter((id) => id !== "greek-ship")).toEqual(
      openingPlaces.filter((id) => id !== "greek-ship").sort(),
    );
    // Bury opens the Cithaeron road. The mothers' petition opens the Sacred
    // Way; the herald's truce opens the Long Walls from Piraeus.
    expect(reachable(s)).toContain("greek-eleusis");
    expect(reachable(s)).not.toContain("greek-athens");
    expect(reachable(s)).not.toContain("greek-road-coast");
    stowProvisions(s, "greek-ship");
    summonTransport(s, "greek-ship", "greek-harbor");
    const city = [
      "greek-athens",
      "greek-road-athens-eleusis",
      "greek-road-athens-piraeus",
    ];
    const sailed = openDoorReleasedPlaces.filter((id) => !city.includes(id));
    expect(reachable(s)).toEqual(sailed.sort());
    expect(reachable(s)).toHaveLength(14);
    s = decodeSave(encodeSave(s));
    expect(reachable(s)).toEqual(sailed.sort());
    for (const start of openDoorPlaces) {
      const trip = structuredClone(s);
      trip.transports["greek-ship"].dock = "greek-piraeus";
      // Vale sailed in, so she knows the lane home from Piraeus.
      learnLane(trip, "vale", "greek-harbor", "greek-piraeus");
      // The land route home enters Thebes by the City Gate, open once the
      // guard has held the decree there.
      trip.openedRoutes = ["greek-gate>greek-battlefield"];
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
    expect(Object.keys(pack.places)).toHaveLength(70);
  });
  it("preserves opening scope through reloads", () => {
    let s = createWorld();
    s.crossings["pond-greek-harbor"].discovered = true;
    for (let i = 0; i < 3; i++) s = decodeSave(encodeSave(s));
    expect(reachable(s)).toEqual(openingPlaces.filter((id) => id !== "greek-polynices-hollow").sort());
  });
  it("keeps a route from every opening place back to the pond after the signal", () => {
    // The City Gate is open for the return journey: the errands opened it.
    const s = structuredClone(errandsDone);
    settleGate(s);
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
      after = decodeSave(JSON.stringify(before)),
      initial = createWorld();
    expect(after.schema).toBe(7);
    expect(after.packs[pack.id].scope).toBe("full");
    for (const key of ["choices", "flags", "receipts", "met"])
      expect(after.packs[pack.id][key]).toEqual(before.packs[pack.id][key]);
    expect(
      Object.fromEntries(
        Object.keys(before.items).map((id) => [id, after.items[id]]),
      ),
    ).toEqual(upgradedItems(before.items, after));
    expect(
      Object.keys(after.items)
        .filter((id) => !Object.hasOwn(before.items, id))
        .sort(),
    ).toEqual(
      [
        ...new Set([
          "board",
          "boardyai-calling-card",
          "can",
          "greek-olive-branch",
          "greek-burial-account",
          "greek-creon-writ",
          "greek-helen-accounts",
          "greek-atreid-record",
          "float",
          "kite",
          "mask",
          "routes",
          "shears",
          ...packDefinitions
            .filter((p) => !before.packs[p.id])
            .flatMap((p) => Object.keys(p.items || {})),
          ...openDoorItems,
          ...Object.keys(pack.items).filter((id) => id.startsWith("greek-ajax-")),
          "greek-figs",
          "greek-wine-skin",
          "greek-libation",
          // Revision 20: Dione's wheat, for the bread she makes.
          "greek-wheat",
          ...Object.keys(packDefinition("hoppycat-archive").items),
          ...Object.keys(packDefinition("willows").items),
          ...Object.keys(packDefinition("lonely-forest").items),
        ]),
      ].sort(),
    );
    for (const [id, item] of Object.entries(initial.items).filter(
      ([id]) => !before.items[id],
    )) expect(after.items[id]).toEqual(item);
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
    expect(after.items["greek-helen-accounts"].holder).toBe("greek-harbor");
    expect(after.items["greek-atreid-record"].holder).toBe("greek-argolid-road");
    expect(entityActive(after, "greek-athens")).toBe(true);
    expect(entityActive(after, "greek-helen-troy")).toBe(false);
    expect(decodeSave(encodeSave(after))).toEqual(after);
  });
  it("keeps a halfway signal locked until the new physical arrangement", () => {
    // A partial old signal must not accidentally count as a completed unlock.
    let s = decodeSave(JSON.stringify(legacy("halfway")));
    expect(s.crossings["pond-greek-harbor"]).toEqual({ discovered: false });
    expect(locationOverlay(s, "pond")).toBeNull();
    // Retired signal progress is not completion. Only a placed fueled lamp
    // and selected cloth unlock this previously undiscovered crossing.
    if (s.items.cloth.holder === "lamp") s = act(s, "take", { item: "cloth" });
    s = act(s, "drop", { item: "lamp" });
    s = selectLamp(s, "cloth");
    expect(locationOverlay(s, "pond")).toMatch(/pond-ship-overlay\.png$/);
    expect(travelCard(s, "greek-ship")).toMatchObject({
      name: "The Charybdis",
      art: expect.stringMatching(/\/ship-deck[^/]*\.webp$/),
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
  it("keeps eight opening paintings and adds four Attic paintings", () => {
    const openingImages = openingPlaces
      .filter((id) => id !== "greek-ship" && id !== "greek-road-thebes")
      .map(backdrop);
    const sectionImages = openDoorPlaces.map(backdrop);
    expect(new Set(openingImages).size).toBe(8);
    expect(new Set(sectionImages).size).toBe(4);
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
