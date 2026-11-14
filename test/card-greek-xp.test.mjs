import { describe, expect, it } from "vitest";
import "./helpers/still-cast.mjs";
import { createWorld, legalActions, play } from "../v2/card-game/world.mjs";
import { packDefinition, packPeople } from "../v2/card-game/pack-registry.mjs";
import { funeralJourney } from "./helpers/greek-funeral.mjs";

// Travelers earn no XP (rules 136): these pin the boxes the Greek and
// RatiRadio content credits to a traveler, and that none of it pays XP.
const act = (world, kind, fields = {}) => {
  const action = legalActions(world).find(
    (a) =>
      a.kind === kind &&
      Object.entries(fields).every(([key, value]) => a[key] === value),
  );
  if (!action) throw new Error(`Missing ${kind} ${JSON.stringify(fields)}`);
  const result = play(world, action, world.revision);
  if (!result.ok) throw new Error(result.error);
  return result.state;
};
const xp = (world) =>
  Object.values(world.opened || {}).filter((ids) => ids.includes("vale"))
    .length;
const paid = (world) => world.actors.vale.xp;

describe("boxes the Greek and RatiRadio content credits", () => {
  it("pays nothing for the burial and credits no box", () => {
    const j = funeralJourney();
    const gains = [
      ["anoint", j.beforeAnoint, j.anointed],
      ["veil", j.anointed, j.veiled],
      ["bury", j.veiled, j.buried],
    ].map(([name, a, b]) => [name, xp(b) - xp(a)]);
    expect(Object.fromEntries(gains)).toEqual({ anoint: 0, veil: 0, bury: 0 });
    expect(
      j.buried.log.some(
        (e) => e.verb === "want_met" && e.actorId === "vale" && e.seq > j.veiled.eventSeq,
      ),
    ).toBe(true);
    expect(paid(j.buried)).toBe(paid(j.beforeAnoint));
  });

  it("credits following one account", () => {
    let world = createWorld({ packScopes: { "greek-drama": "full" } });
    world.crossings["pond-greek-harbor"].discovered = true;
    world.actors.vale.place = "greek-harbor";
    world.actors.vale.visited.push("pond", "greek-harbor");
    world.items.lamp.lit = false;
    world = act(world, "take", { item: "greek-helen-accounts" });
    const before = xp(world);
    const xpBefore = paid(world);
    world = act(world, "give", {
      item: "greek-helen-accounts",
      target: "greek-shipmaster",
    });
    expect(world.packs["greek-drama"].choices["greek-helen-account"]).toBe(
      "egypt",
    );
    // The Egyptian road, Helen and Menelaus: three boxes opened by one gift.
    expect(Object.keys(world.opened).sort()).toEqual([
      "greek-egypt-tomb",
      "greek-helen-egypt",
      "greek-menelaus-egypt",
    ]);
    expect(xp(world) - before).toBe(3);
    expect(paid(world)).toBe(xpBefore);
  });

  const id = (name) => `ratiradio-${name}`;
  const home = id("listening-room");
  // The walk of card-boxes: key, beanie, thermos, figurine, glass home, Raven.
  const walk = () => {
    const s = createWorld({ seed: 17 });
    for (const [item, entry] of Object.entries(
      packDefinition("ratiradio").items,
    ))
      if (entry.scatterOutside) s.items[item].holder = entry.holder;
    s.items[id("thermos")].holder = id("staff-kitchen");
    s.actors.vale.place = "pond";
    for (const item of Object.values(s.items))
      if (item.holder === "vale") item.holder = "pond";
    const steps = [
      ["take", id("station-key")],
      ["move", "station"],
      ["move", id("staff-kitchen")],
      ["drop", id("station-key")],
      ["take", id("red-beanie")],
      ["take", id("thermos")],
      ["move", id("dispatch-window")],
      ["drop", id("thermos")],
      ["move", home],
      ["drop", id("red-beanie")],
      ["take", id("raven-figurine")],
      ["gather", id("rati")],
      ["talk", id("rati")],
      ["move", id("broadcast-booth")],
      ["take", id("glass")],
      ["move", home],
      ["drop", id("glass")],
      ["drop", id("raven-figurine")],
    ];
    let world = s;
    const gains = {};
    for (const [kind, target] of steps) {
      if (kind === "gather") {
        world.actors[target].place = world.actors.vale.place;
        continue;
      }
      const before = xp(world);
      world = act(
        world,
        kind,
        kind === "talk" || kind === "move" ? { target } : { item: target },
      );
      if (xp(world) !== before) gains[`${kind} ${target}`] = xp(world) - before;
    }
    return { gains, total: xp(world), paid: paid(world) - paid(s) };
  };

  it("credits the boxes on the walk, and the keepsakes add none", () => {
    const staged = packPeople[id("rati")].wants;
    const withKeepsakes = walk();
    delete packPeople[id("rati")].wants;
    let without;
    try {
      without = walk();
    } finally {
      packPeople[id("rati")].wants = staged;
    }
    expect(withKeepsakes).toEqual(without);
    expect(without).toEqual({
      total: 4,
      paid: 0,
      gains: {
        "take ratiradio-red-beanie": 1,
        "drop ratiradio-thermos": 1,
        "talk ratiradio-rati": 1,
        "drop ratiradio-raven-figurine": 1,
      },
    });
  });
});
