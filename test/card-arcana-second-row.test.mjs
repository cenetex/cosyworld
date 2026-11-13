import { afterEach, describe, expect, it } from "vitest";
import data from "../v2/card-game/arcana.json" with { type: "json" };
import { packDefinition } from "../v2/card-game/pack-registry.mjs";
import { DAYLIGHT_TURNS } from "../v2/card-game/pack-rules.mjs";
import { sleepQuest } from "../v2/card-game/want.mjs";
import {
  arcanaLevel,
  bindingOf,
  candidates,
  dealable,
  deck,
  holds,
  nextCard,
  recordOf,
  settleArcana,
} from "../v2/card-game/world/arcana.mjs";
import { boxDefs } from "../v2/card-game/world/boxes.mjs";
import { homeOf } from "../v2/card-game/world/home.mjs";
import { createWorld, legalActions, play } from "../v2/card-game/world.mjs";

const only = (id, seed = 7) => {
  deck.cards = data.cards.filter((card) => card.id === id);
  const s = createWorld({ seed });
  settleArcana(s, "vale");
  expect(recordOf(s, "vale").dealt).toBe(id);
  return s;
};
const act = (s, test) => {
  const action = legalActions(s, "vale").find(test);
  expect(action).toBeDefined();
  const result = play(s, action, s.revision, "vale");
  expect(result.ok, result.error).toBe(true);
  return result.state;
};
const walk = (to) => (a) => a.kind === "move" && a.target === to && !a.item;
const kind =
  (k, fields = {}) =>
  (a) =>
    a.kind === k && Object.entries(fields).every(([key, v]) => a[key] === v);
const proved = (s) => recordOf(s, "vale").proved;
const night = (s) => Math.floor(s.turn / DAYLIGHT_TURNS) % 2 === 1;
const untilNight = (s) => {
  while (!night(s)) s = act(s, (a) => a.kind === "wait" && !a.sleep);
  return s;
};
const meet = (s, who) => {
  for (let i = 0; i < 6 && s.actors[who].place !== s.actors.vale.place; i++)
    s = act(s, (a) => a.kind === "wait" && !a.sleep);
  expect(s.actors[who].place).toBe(s.actors.vale.place);
  return s;
};
const greek = (s) => {
  s.crossings["pond-greek-harbor"].discovered = true;
  return s;
};

afterEach(() => {
  deck.cards = data.cards;
});

describe("the second row, played in a created world", () => {
  it("VI: travels with a companion who agreed", () => {
    let s = only("arcanum-6");
    s = meet(s, "keeper");
    s.actors.keeper.trust.vale = 2;
    s = act(s, kind("accompany", { target: "keeper" }));
    expect(s.actors.vale.companion).toBe("keeper");
    expect(proved(s)).toEqual(["arcanum-6"]);
  });

  it("VI: a trip with nobody bound is not enough", () => {
    let s = only("arcanum-6");
    s = meet(s, "keeper");
    s.actors.keeper.want = {
      kind: "place",
      target: "pond",
      since: 0,
      refusals: 0,
    };
    s = act(s, kind("accompany", { target: "keeper", destination: "pond" }));
    expect(s.log.findLast((e) => e.verb === "accompany").accepted).toBe(true);
    expect(s.actors.vale.companion).toBeUndefined();
    expect(proved(s)).toEqual([]);
  });

  it("VII: sets the course of a ship once aboard", () => {
    let s = greek(only("arcanum-7"));
    s.actors.vale.place = "greek-harbor";
    s = act(s, walk(bindingOf(s, deck.cards[0], "vale").vessel));
    expect(proved(s)).toEqual([]);
    s = act(s, kind("course"));
    expect(proved(s)).toEqual(["arcanum-7"]);
  });

  it("VIII: trades one thing for another", () => {
    let s = only("arcanum-8");
    s = act(s, kind("take", { item: "bell" }));
    s = meet(s, "keeper");
    expect(proved(s)).toEqual([]);
    s = act(s, kind("trade", { item: "bell", receive: "oil" }));
    expect(s.items.oil.holder).toBe("vale");
    expect(proved(s)).toEqual(["arcanum-8"]);
  });

  it("IX: walks at night holding the lit lamp, not by day", () => {
    let s = only("arcanum-9");
    expect(bindingOf(s, deck.cards[0], "vale").light).toBe("lamp");
    s = act(s, kind("take", { item: "lamp" }));
    s = act(s, walk("pond"));
    expect(proved(s)).toEqual([]);
    s = untilNight(s);
    expect(s.items.lamp).toMatchObject({ holder: "vale", lit: true });
    s = act(s, walk("station"));
    expect(proved(s)).toEqual(["arcanum-9"]);
  });

  it("X: eats a thing and finds it again at its home", () => {
    let s = greek(only("arcanum-10"));
    const thing = bindingOf(s, deck.cards[0], "vale").thing;
    expect(thing).toBe("greek-figs");
    s.actors.vale.place = s.items[thing].holder;
    s = act(s, kind("take", { item: thing }));
    s = act(s, (a) => a.kind === "eat" && a.item === thing && !a.target);
    expect(recordOf(s, "vale").did).toEqual(["spent"]);
    expect(s.items[thing].holder).toBe(s.actors.vale.place);
    expect(proved(s)).toEqual([]);
    s = act(s, kind("take", { item: thing }));
    expect(proved(s)).toEqual(["arcanum-10"]);
  });

  it("XI: ends a threat with a brace and no blow", () => {
    let s = only("arcanum-11");
    s = meet(s, "keeper");
    s = act(s, kind("threaten", { target: "keeper" }));
    expect(proved(s)).toEqual([]);
    s = act(s, kind("guard"));
    expect(s.standoffs).toEqual([]);
    expect(proved(s)).toEqual(["arcanum-11"]);
  });

  it("XII: lets go of a quest, not of a thing", () => {
    let s = only("arcanum-12");
    s = act(s, kind("take", { item: "bell" }));
    s = act(s, kind("drop", { item: "bell" }));
    expect(proved(s)).toEqual([]);
    sleepQuest(s, "vale", { home: homeOf });
    s = act(s, (a) => a.kind === "drop" && !a.item);
    expect(s.actors.vale.want).toBeNull();
    expect(proved(s)).toEqual(["arcanum-12"]);
  });

  it("XIV: drinks with someone who trusts them", () => {
    let s = only("arcanum-14");
    const drink = bindingOf(s, deck.cards[0], "vale").thing;
    s = act(s, kind("take", { item: "bell" }));
    s = meet(s, "keeper");
    s.items[drink].holder = "vale";
    s = act(s, kind("eat", { item: drink, target: "keeper" }));
    expect(proved(s)).toEqual([]);
    s = act(s, kind("give", { item: "bell", target: "keeper" }));
    s.items[drink].holder = "vale";
    s = act(s, kind("eat", { item: drink, target: "keeper" }));
    expect(s.log.findLast((e) => e.verb === "eat").accepted).toBe(true);
    expect(proved(s)).toEqual(["arcanum-14"]);
  });

  it("XV: carries off a thing that someone else wants", () => {
    let s = only("arcanum-15");
    expect(bindingOf(s, deck.cards[0], "vale").thing).toBe("lamp");
    expect(s.actors.moth.want).toMatchObject({ kind: "item", target: "lamp" });
    s = act(s, kind("take", { item: "lamp" }));
    expect(proved(s)).toEqual([]);
    s = act(s, walk("pond"));
    expect(proved(s)).toEqual(["arcanum-15"]);
    let t = only("arcanum-15");
    t = act(t, kind("take", { item: "ratiradio-request-slip" }));
    t = act(t, walk("pond"));
    expect(proved(t)).toEqual([]);
  });

  it("XVI: frees someone shut away, not just a door", () => {
    deck.cards = data.cards.filter((card) => card.id === "arcanum-16");
    let s = createWorld({ seed: 17 });
    const id = (name) => `ratiradio-${name}`;
    for (const [thing, item] of Object.entries(
      packDefinition("ratiradio").items,
    ))
      if (item.scatterOutside) s.items[thing].holder = item.holder;
    s.items[id("thermos")].holder = id("staff-kitchen");
    s.actors.vale.place = "pond";
    for (const item of Object.values(s.items))
      if (item.holder === "vale") item.holder = "pond";
    settleArcana(s, "vale");
    expect(recordOf(s, "vale")).toMatchObject({
      dealt: "arcanum-16",
      base: { opened: 0 },
    });
    const route = [
      ["take", id("station-key")],
      ["move", "station"],
      ["move", id("staff-kitchen")],
      ["drop", id("station-key")],
      ["take", id("red-beanie")],
      ["take", id("thermos")],
      ["move", id("dispatch-window")],
      ["drop", id("thermos")],
      ["move", id("listening-room")],
      ["drop", id("red-beanie")],
      ["take", id("raven-figurine")],
      ["talk", id("rati")],
      ["move", id("broadcast-booth")],
      ["take", id("glass")],
      ["move", id("listening-room")],
      ["drop", id("glass")],
    ];
    for (const [verb, target] of route) {
      if (verb === "talk") s.actors[target].place = s.actors.vale.place;
      s = act(
        s,
        (a) => a.kind === verb && (a.item === target || a.target === target),
      );
    }
    expect(Object.keys(s.opened).length).toBe(3);
    expect(proved(s)).toEqual([]);
    s = act(s, kind("drop", { item: id("raven-figurine") }));
    expect(s.opened[id("raven")]).toEqual(["vale"]);
    expect(proved(s)).toEqual(["arcanum-16"]);
  });

  it("XVII: gives something to someone who takes it", () => {
    let s = only("arcanum-17");
    s = act(s, kind("take", { item: "bell" }));
    s = meet(s, "keeper");
    expect(proved(s)).toEqual([]);
    s = act(s, kind("give", { item: "bell", target: "keeper" }));
    expect(s.items.bell.holder).toBe("keeper");
    expect(proved(s)).toEqual(["arcanum-17"]);
  });

  it("XVIII: walks at night with no light, not by day", () => {
    let s = only("arcanum-18");
    s = act(s, walk("pond"));
    s = act(s, walk("station"));
    expect(proved(s)).toEqual([]);
    s = untilNight(s);
    s = act(s, walk("pond"));
    expect(s.log.findLast((e) => e.actorId === "vale").light).toBe(false);
    expect(proved(s)).toEqual(["arcanum-18"]);
  });

  it("XIX: brings a companion home, and coming home alone is not it", () => {
    let s = only("arcanum-19");
    s.actors.vale.place = "forest-garden";
    s = act(s, walk("forest-cottage"));
    s.actors.rati.trust.vale = 2;
    s = act(
      s,
      kind("accompany", { target: "rati", destination: "forest-garden" }),
    );
    expect(s.actors.vale.companion).toBe("rati");
    expect(proved(s)).toEqual([]);
    s = act(s, walk("forest-cottage"));
    s = act(s, walk(homeOf("vale")));
    expect(s.actors.rati.place).toBe(homeOf("vale"));
    expect(proved(s)).toEqual(["arcanum-19"]);
    let t = only("arcanum-19");
    t.actors.vale.place = "forest-garden";
    t = act(t, walk("forest-cottage"));
    t = act(t, walk(homeOf("vale")));
    expect(proved(t)).toEqual([]);
  });

  it("XX: is trusted by five more than at the deal", () => {
    let s = only("arcanum-20");
    for (const id of ["badger", "oak", "rati", "skull"])
      s.actors[id].trust.vale = 1;
    s = act(s, kind("take", { item: "bell" }));
    s = meet(s, "keeper");
    expect(proved(s)).toEqual([]);
    s = act(s, kind("give", { item: "bell", target: "keeper" }));
    expect(s.actors.keeper.trust.vale).toBeGreaterThan(0);
    expect(proved(s)).toEqual(["arcanum-20"]);
  });
});

describe("the whole deck", () => {
  it("holds twenty-one cards, no XIII, and reaches level twenty-one", () => {
    const numbers = data.cards.map((card) => card.number);
    expect(numbers).toHaveLength(21);
    expect(numbers).not.toContain(13);
    const s = createWorld({ seed: 7 });
    s.actors.vale.arcana = {
      proved: data.cards.map((card) => card.id).sort(),
      did: [],
    };
    expect(arcanaLevel(s, "vale")).toBe(21);
    expect(nextCard(s, "vale")).toBeNull();
  });

  it("deals the World only when no other card can be dealt", () => {
    const s = createWorld({ seed: 7 });
    const ids = (list) => list.map((card) => card.id).sort();
    const rest = data.cards.filter((card) => card.number !== 21);
    s.actors.vale.arcana = {
      proved: ids(rest.filter((c) => c.number !== 16)),
      did: [],
    };
    expect(nextCard(s, "vale")).toBe("arcanum-16");
    s.opened = Object.fromEntries(
      boxDefs()
        .filter((def) => def.kind === "resident")
        .map((def) => [def.id, ["vale"]]),
    );
    expect(nextCard(s, "vale")).toBe("arcanum-21");
    s.actors.vale.arcana.proved = ids(rest);
    delete s.opened;
    expect(nextCard(s, "vale")).toBe("arcanum-21");
  });
});

describe("the words added for these cards", () => {
  const binding = { traveler: "vale" };
  it("latches a deed only while its other conditions hold", () => {
    const s = createWorld({ seed: 7 });
    deck.cards = [
      {
        id: "arcanum-0",
        number: 0,
        proof: [
          {
            kind: "did",
            key: "w",
            match: { verb: "wait", actorId: "$traveler" },
            while: [{ kind: "daylight", phase: "night" }],
          },
        ],
      },
    ];
    settleArcana(s, "vale");
    let t = act(s, (a) => a.kind === "wait" && !a.sleep);
    expect(recordOf(t, "vale").did).toEqual([]);
    t = untilNight(t);
    t = act(t, (a) => a.kind === "wait" && !a.sleep);
    expect(proved(t)).toEqual(["arcanum-0"]);
  });

  it("reads a companion only where the traveler stands, and a fight", () => {
    const s = createWorld({ seed: 7 });
    expect(holds(s, { kind: "company" }, binding)).toBe(false);
    s.actors.vale.companion = "keeper";
    s.actors.vale.actedAt = 0;
    expect(holds(s, { kind: "company" }, binding)).toBe(false);
    s.actors.keeper.place = s.actors.vale.place;
    expect(holds(s, { kind: "company" }, binding)).toBe(true);
    expect(holds(s, { kind: "fighting" }, binding)).toBe(false);
    s.standoffs.push({ resolve: { vale: 4, keeper: 4 } });
    expect(holds(s, { kind: "fighting" }, binding)).toBe(true);
  });

  it("counts and leaves room for one kind of box", () => {
    const s = createWorld({ seed: 7 });
    const freed = { kind: "count", of: "opened", box: "resident", min: 1 };
    const card = { id: "arcanum-16", number: 16, proof: [freed] };
    const residents = boxDefs().filter((def) => def.kind === "resident");
    const ways = boxDefs().filter((def) => def.kind === "way");
    s.opened = Object.fromEntries(ways.map((def) => [def.id, ["vale"]]));
    expect(holds(s, freed, binding)).toBe(false);
    expect(dealable(s, card, "vale")).toBe(true);
    s.opened[residents[0].id] = ["vale"];
    expect(holds(s, freed, binding)).toBe(true);
    for (const def of residents) s.opened[def.id] = ["vale"];
    expect(dealable(s, card, "vale")).toBe(false);
  });

  it("binds a ship, a drink, a lamp and a wanted thing only while live", () => {
    const s = createWorld({ seed: 7 });
    expect(candidates(s, "transport")).toEqual(["greek-ship"]);
    expect(candidates(s, "item", "lamp")).toEqual(["lamp"]);
    expect(candidates(s, "item", "drink")).toEqual(["greek-wine-skin"]);
    expect(candidates(s, "item", "wanted")).toContain("lamp");
    s.actors.moth.want = null;
    expect(candidates(s, "item", "wanted")).not.toContain("lamp");
    s.disabledPacks = ["sea"];
    expect(candidates(s, "transport")).toEqual([]);
    expect(
      dealable(
        s,
        data.cards.find((c) => c.number === 7),
        "vale",
      ),
    ).toBe(false);
  });
});
