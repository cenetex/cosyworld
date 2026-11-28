import { afterEach, describe, expect, it } from "vitest";
import data from "../v2/card-game/arcana.json" with { type: "json" };
import { DAYLIGHT_TURNS } from "../v2/card-game/pack-rules.mjs";
import {
  bindingOf,
  dealSpread,
  deck,
  holds,
  nextSpread,
  recordOf,
} from "../v2/card-game/world/arcana.mjs";
import { giveUpForGood } from "../v2/card-game/world/for-good.mjs";
import { homeOf } from "../v2/card-game/world/home.mjs";
import {
  createWorld,
  places,
} from "../v2/card-game/world.mjs";
import { act } from "./helpers/play.mjs";

const only = (id) => {
  deck.cards = data.cards.filter((card) => card.id === id);
  const s = createWorld({ seed: 7 });
  expect(dealSpread(s, "vale")).toBe(true);
  return s;
};
const wait = (s) => act(s, (a) => a.kind === "wait" && !a.sleep && !a.guards);
const walk = (to) => (a) => a.kind === "move" && a.target === to && !a.item;
const proved = (s) => recordOf(s, "vale").proved;
const untilNight = (s) => {
  while (Math.floor(s.turn / DAYLIGHT_TURNS) % 2 === 0) s = wait(s);
  return s;
};
const trustedCompany = (s, who) => {
  s.actors[who].place = s.actors.vale.place;
  s.actors[who].trust.vale = 2;
  return s;
};
const litNight = (s) => {
  s = act(s, (a) => a.kind === "take" && a.item === "lamp");
  s = untilNight(act(s, walk("pond")));
  expect(s.items.lamp).toMatchObject({ holder: "vale", lit: true });
  return s;
};
const holding = (s, slot) => {
  s.actors.vale.arcana = { proved: [], did: [], level: 1, spread: [slot] };
  return s;
};

afterEach(() => {
  deck.cards = data.cards;
});

describe("cards that say what they check", () => {
  it("VI: counts the accepted invitation even with other trusted residents nearby", () => {
    let s = only("arcanum-6");
    s = trustedCompany(s, "moth");
    s.actors.keeper.place = s.actors.vale.place;
    s.actors.keeper.want = {
      kind: "place",
      target: "pond",
      since: 0,
      refusals: 0,
    };
    s = act(
      s,
      (a) =>
        a.kind === "accompany" &&
        a.target === "keeper" &&
        a.destination === "pond",
    );
    expect(s.log.findLast((e) => e.verb === "accompany")).toMatchObject({ accepted: true, targetId: "keeper" });
    expect(recordOf(s, "vale").spread[0].face).toBe("reward");
  });

  it("IX: a solo night walk counts, but inviting someone along does not", () => {
    const start = trustedCompany(litNight(only("arcanum-9")), "keeper");
    const invited = act(start, (a) => a.kind === "accompany" && a.target === "keeper" && a.destination === "station");
    expect(invited.actors.keeper.place).toBe("station");
    expect(proved(invited)).toEqual([]);
    expect(recordOf(invited, "vale").spread[0].face).toBe("locked");
    const solo = act(start, walk("station"));
    expect(recordOf(solo, "vale").spread[0].face).toBe("reward");
  });

  it("IX and XVIII: a light counts only lit and carried", () => {
    const s = createWorld({ seed: 7 });
    const me = { traveler: "vale" };
    s.items.lamp.holder = "vale";
    expect(holds(s, { kind: "lit", item: "lamp" }, me)).toBe(true);
    expect(holds(s, { kind: "lit" }, me)).toBe(true);
    s.items.lamp.lit = false;
    expect(holds(s, { kind: "lit" }, me)).toBe(false);
    s.items.lamp.lit = true;
    s.items.lamp.holder = s.actors.vale.place;
    expect(holds(s, { kind: "lit", item: "lamp" }, me)).toBe(false);
  });

  it("XVIII: a night walk carrying the lit lamp is not dark", () => {
    let s = litNight(only("arcanum-18"));
    s = act(s, walk("station"));
    expect(proved(s)).toEqual([]);
    expect(recordOf(s, "vale").spread[0].face).toBe("locked");
  });
});

describe("a card stays done once met", () => {
  it("0: the Fool stays done after the walk home", () => {
    let s = createWorld({ seed: 7 });
    deck.cards = data.cards.filter((card) => card.number === 0);
    holding(s, { card: "arcanum-0", face: "up", base: { visited: 0 } });
    for (const item of Object.values(s.items))
      if (item.holder === "vale") item.holder = "pond";
    s.actors.vale.place = "pond";
    s.actors.vale.visited = Object.keys(places).slice(0, 8);
    s = wait(s);
    expect(recordOf(s, "vale").spread[0]).toMatchObject({
      face: "reward",
      done: true,
    });
    s.actors.vale.place = homeOf("vale");
    s = wait(s);
    expect(recordOf(s, "vale").spread[0]).toMatchObject({
      face: "reward",
      done: true,
    });
  });

  it("IX: the Hermit stays done after the lamp goes out", () => {
    let s = createWorld({ seed: 7 });
    deck.cards = data.cards.filter((card) => card.number === 9);
    holding(s, { card: "arcanum-9", face: "up", bind: { light: "lamp" } });
    s = act(litNight(s), walk("station"));
    expect(recordOf(s, "vale").spread[0]).toMatchObject({
      face: "reward",
      done: true,
    });
    s.items.lamp.lit = false;
    s = wait(s);
    expect(recordOf(s, "vale").spread[0]).toMatchObject({
      face: "reward",
      done: true,
    });
  });
});

describe("the dealer pairs cards that can both be done", () => {
  const spend = {
    id: "arcanum-3",
    number: 3,
    roles: [{ name: "light", kind: "item", is: "lamp" }],
    proof: [
      {
        kind: "did",
        key: "spend",
        match: { verb: "give", actorId: "$traveler", itemId: "$light" },
      },
    ],
  };
  const keep = {
    id: "arcanum-15",
    number: 15,
    roles: [{ name: "light", kind: "item", is: "lamp" }],
    proof: [
      {
        kind: "did",
        key: "keep",
        match: { verb: "move", actorId: "$traveler" },
        while: [{ kind: "held", item: "$light", actor: "$traveler" }],
      },
    ],
  };
  const walker = {
    id: "arcanum-14",
    number: 14,
    proof: [{ kind: "count", of: "visited", min: 1 }],
  };

  it("redraws a locked card that needs the thing the face-up card gives away", () => {
    const s = createWorld({ seed: 7 });
    deck.cards = [spend, keep, walker];
    s.actors.vale.arcana = {
      proved: ["arcanum-3"],
      did: [],
      level: 1,
      need: ["arcanum-14"],
    };
    s.actors.vale.upgrades = ["arcanum-3"];
    const spread = nextSpread(s, "vale");
    expect(spread.map((slot) => [slot.card, slot.face])).toEqual([
      ["arcanum-3", "up"],
      ["arcanum-14", "locked"],
    ]);
    deck.cards = [spend, keep];
    expect(nextSpread(s, "vale").map((slot) => slot.card)).toEqual([
      "arcanum-3",
    ]);
  });

  it("never pins a thing gone for good", () => {
    const card = {
      id: "arcanum-15",
      number: 15,
      roles: [{ name: "thing", kind: "item" }],
      proof: [{ kind: "count", of: "visited", min: 1 }],
    };
    let gone = 0;
    for (let seed = 0; seed < 24; seed++) {
      const s = createWorld({ seed });
      const first = bindingOf(s, card, "vale").thing;
      if (!giveUpForGood(s, first)) continue;
      gone += 1;
      expect(bindingOf(s, card, "vale").thing).not.toBe(first);
    }
    expect(gone).toBeGreaterThan(0);
  });
});
