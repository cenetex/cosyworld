import { describe, expect, it } from "vitest";
import "./helpers/still-cast.mjs";
import {
  createWorld,
  decodeSave,
  encodeSave,
  homeOf,
  holdChoice,
  legalActions,
  LONG_SLEEP_TURNS,
  play,
  questOffers,
  validateWorld,
} from "../v2/card-game/world.mjs";
import { availableCards } from "../v2/card-game/cards.mjs";
import { restsAt } from "../v2/card-game/world/home.mjs";
import {
  OFFER_ODDS,
  offerUnlocked,
} from "../v2/card-game/offer-chance.mjs";
import { questXp, dropCost, heldOf, wantOf } from "../v2/card-game/want.mjs";
import { wantFact } from "../v2/card-game/want-talk.mjs";
import { nameOf } from "../v2/card-game/world/catalog.mjs";
import { greekErrands } from "./helpers/greek-opening.mjs";
import { journeyWorlds } from "./helpers/journey.mjs";
import { questCards } from "./journeys/quest-cards.mjs";

const find = (s, pick, actor) => legalActions(s, actor).find(pick);
const act = (s, pick, actor) => {
  const action = find(s, pick, actor);
  expect(action, "a legal play").toBeTruthy();
  const result = play(s, action, s.revision, actor);
  expect(result.ok, result.error).toBe(true);
  return result.state;
};
const talk = (s, target) => act(s, (a) => a.kind === "talk" && a.target === target);
const wait = (s) => act(s, (a) => a.kind === "wait" && !a.sleep);
// What the player holds, top first, by the offer each came from.
const sources = (s) => heldOf(s.actors.vale).map((w) => w.from);
const GUARD = "greek-guard";

describe("quest offers are held at once", () => {
  it("holds a shut box's quest where the box lies, and not once it is gone", () => {
    const s = greekErrands().decree;
    const box = heldOf(s.actors.vale).find((w) => w.from === "quest:box:greek-battlefield");
    expect(box).toMatchObject({
      kind: "item",
      target: "greek-creon-writ",
      story: true,
      step: { verb: "give", to: GUARD },
    });
    // It is held, so it no longer stands as an offer, and no play accepts it.
    expect(questOffers(s).some((o) => o.kind === "box")).toBe(false);
    expect(legalActions(s).some((a) => a.kind === "take" && a.offer)).toBe(false);
    // The offer is deterministic for the same world.
    expect(questOffers(decodeSave(encodeSave(s)))).toEqual(questOffers(s));
    // A world where the player has not been told it yet shows it standing.
    const fresh = structuredClone(s);
    fresh.actors.vale.want = null;
    delete fresh.actors.vale.under;
    delete fresh.actors.vale.closed;
    const standing = questOffers(fresh).find((o) => o.kind === "box");
    expect(standing).toMatchObject({
      id: "quest:box:greek-battlefield",
      source: "greek-battlefield",
      want: { target: "greek-creon-writ", story: true },
    });
    expect(standing).not.toHaveProperty("label");
    expect(standing).not.toHaveProperty("blocked");
  });

  it("holds a resident's quest as Talk ends, and not before", () => {
    let s = greekErrands().decree;
    expect(sources(s)).not.toContain(`quest:from:${GUARD}`);
    s.actors[GUARD].trust.vale = 1; // trusts: the offer is certain
    s = talk(s, GUARD);
    const held = heldOf(s.actors.vale).find((w) => w.from === `quest:from:${GUARD}`);
    expect(held).toMatchObject({
      kind: "item",
      target: "greek-bread",
      step: { verb: "give", to: GUARD },
    });
    // Newest on top.
    expect(sources(s)[0]).toBe(`quest:from:${GUARD}`);
    // Leaving the place leaves the quest held; it is not offered again.
    expect(questOffers(s).some((o) => o.kind === "resident")).toBe(false);
  });

  it("holds the quest in the play that made it stand, with no play and no log line of its own", () => {
    let s = greekErrands().decree;
    s.actors[GUARD].trust.vale = 1;
    const turn = s.turn;
    s = talk(s, GUARD);
    expect(s.turn).toBe(turn + 1);
    expect(sources(s)).toContain(`quest:from:${GUARD}`);
    expect(s.log.some((e) => e.verb === "quest")).toBe(false);
    expect(validateWorld(decodeSave(encodeSave(s)))).toBeTruthy();
  });

  it("stacks quests, discards only the top, and keeps a discarded one closed", () => {
    let s = greekErrands().decree;
    s.actors[GUARD].trust.vale = 1;
    s = talk(s, GUARD);
    const before = sources(s);
    expect(before.length).toBeGreaterThan(1);
    const drops = legalActions(s).filter((a) => a.kind === "drop" && !a.item);
    expect(drops).toHaveLength(1);
    expect(dropCost(s, "vale")).toBe(0);
    s = play(s, drops[0], s.revision).state;
    // The next quest shows, and the discarded one does not come back.
    expect(sources(s)).toEqual(before.slice(1));
    expect(questOffers(s).every((o) => o.id !== before[0])).toBe(true);
    expect(s.actors.vale.closed[before[0]]).toBeTruthy();
  });

  it("lays no quest card on the table", () => {
    const s = greekErrands().decree;
    expect(availableCards(s).some((id) => id.startsWith("quest:"))).toBe(false);
  });
});

describe("the chance on Talk", () => {
  // The roll is seeded by the run and the turn of the Talk, so the clock
  // moves on a little to give each "seed" its own roll.
  const seeded = (seed, trust = 0) => {
    const s = structuredClone(greekErrands().decree);
    s.turn += seed;
    s.revision += seed;
    s.actors[GUARD].trust.vale = trust;
    return s;
  };

  it("is rolled once a visit: repeated Talk keeps it", () => {
    for (let seed = 0; seed < 24; seed++) {
      let s = talk(seeded(seed), GUARD);
      const rec = structuredClone(s.actors.vale.offered[GUARD]);
      const unlocked = offerUnlocked(s, "vale", GUARD);
      for (let i = 0; i < 3; i++) {
        s = talk(s, GUARD);
        expect(s.actors.vale.offered[GUARD]).toEqual(rec);
        expect(offerUnlocked(s, "vale", GUARD)).toBe(unlocked);
      }
    }
  });

  it("is deterministic for a seed and comes out both ways", () => {
    const opens = [];
    for (let seed = 0; seed < 40; seed++) {
      const a = talk(seeded(seed), GUARD).actors.vale.offered[GUARD].open;
      const b = talk(seeded(seed), GUARD).actors.vale.offered[GUARD].open;
      expect(b).toBe(a);
      opens.push(a);
    }
    const yes = opens.filter(Boolean).length;
    expect(yes).toBeGreaterThan(0);
    expect(yes).toBeLessThan(opens.length);
    // About the stated odds (a hundredth each, forty seeds).
    expect(Math.abs(yes / opens.length - OFFER_ODDS / 100)).toBeLessThan(0.3);
  });

  it("is rolled again on a new visit", () => {
    let seen = 0;
    for (let seed = 0; seed < 30; seed++) {
      let s = talk(seeded(seed), GUARD);
      const first = s.actors.vale.offered[GUARD];
      // Leave and come back: the record lapses, and the next Talk rolls.
      s = act(s, (a) => a.kind === "move" && a.target === "greek-courtyard");
      expect(s.actors.vale.offered).toBeUndefined();
      s = act(s, (a) => a.kind === "move" && a.target === "greek-gate");
      s = talk(s, GUARD);
      const second = s.actors.vale.offered[GUARD];
      expect(second.at).toBe(first.at);
      if (second.open !== first.open) seen++;
    }
    expect(seen).toBeGreaterThan(0);
  });

  it("lapses when a day passes", () => {
    let s = talk(seeded(3), GUARD);
    expect(s.actors.vale.offered?.[GUARD]).toBeDefined();
    s = structuredClone(s);
    s.turn += 48;
    s.revision += 48;
    expect(offerUnlocked(s, "vale", GUARD)).toBe(false);
    s = act(s, (a) => a.kind === "wait" && !a.sleep);
    expect(s.actors.vale.offered).toBeUndefined();
  });

  it("is certain for someone who trusts the traveler", () => {
    for (let seed = 0; seed < 30; seed++) {
      const s = talk(seeded(seed, 1), GUARD);
      expect(offerUnlocked(s, "vale", GUARD)).toBe(true);
      expect(sources(s)).toContain(`quest:from:${GUARD}`);
    }
  });

  it("applies to residents alone: a shut box's quest is always held", () => {
    for (let seed = 0; seed < 10; seed++) {
      const s = seeded(seed);
      expect(sources(s)).toContain("quest:box:greek-battlefield");
    }
  });

  it("never gates a hub starter want, and says so in the Talk context", () => {
    const after = journeyWorlds(questCards).told;
    expect(offerUnlocked(after, "vale", "moth")).toBe(true);
    expect(wantFact(after, "moth", nameOf, "vale")).toBe(
      "I want the Lamp. I would be glad of your help.",
    );
    // A stranger whose roll came out shut says only what they want.
    const stranger = talk(seeded(0), GUARD);
    const sentence = wantFact(stranger, GUARD, nameOf, "vale");
    expect(sentence.endsWith("I would be glad of your help.")).toBe(
      offerUnlocked(stranger, "vale", GUARD),
    );
  });

  it("saves only a valid record", () => {
    const s = talk(seeded(5), GUARD);
    expect(validateWorld(decodeSave(encodeSave(s)))).toBeTruthy();
    const bad = JSON.parse(encodeSave(s));
    bad.actors.vale.offered[GUARD].open = "yes";
    expect(() => decodeSave(JSON.stringify(bad))).toThrow();
  });
});

describe("level up", () => {
  const atThreshold = (xp) => {
    const s = createWorld();
    // Experience is capped by the turns played, so the clock has run on.
    s.turn = s.revision = 8;
    s.actors.vale.place = "attic";
    s.actors.vale.level = 1;
    s.actors.vale.xp = xp;
    return s;
  };

  // The next play holds what stands (rules 134); a wait is the quietest.
  const held = (s) => wait(s);

  it("stands the level-up quest at the threshold and not under it", () => {
    expect(questXp(2)).toBe(3);
    expect(questOffers(atThreshold(2)).some((o) => o.kind === "level")).toBe(false);
    const offer = questOffers(atThreshold(3)).find((o) => o.kind === "level");
    expect(offer).toMatchObject({
      id: "quest:level",
      want: {
        kind: "place",
        target: "attic",
        quest: { level: 2, left: 1 },
        step: { verb: "rest" },
      },
    });
    // Level 2 needs the next threshold.
    const two = atThreshold(questXp(3) - 1);
    two.actors.vale.level = 2;
    expect(questOffers(two).some((o) => o.kind === "level")).toBe(false);
    two.actors.vale.xp = questXp(3);
    expect(questOffers(two).some((o) => o.kind === "level")).toBe(true);
  });

  it("holds Sleep at home at once, on top of any other quest", () => {
    const other = atThreshold(3);
    other.actors.vale.want = { kind: "place", target: "pond", since: 0, refusals: 0 };
    const s = held(other);
    expect(wantOf(s, "vale")).toMatchObject({ target: "attic", quest: { level: 2 } });
    expect(s.actors.vale.under).toHaveLength(1);
    expect(s.actors.vale.under[0].target).toBe("pond");
    // Held, it does not stand again.
    expect(questOffers(s).some((o) => o.kind === "level")).toBe(false);
    expect(legalActions(s).some((a) => a.kind === "take" && a.offer)).toBe(false);
  });

  it("rests an avatar at a sanctuary or its own home, a resident only at a sanctuary", () => {
    expect(homeOf("vale")).toBe("attic");
    expect(restsAt("vale", "attic")).toBe(true);
    expect(restsAt("vale", "forest-cottage")).toBe(true);
    expect(restsAt("mara", homeOf("mara"))).toBe(true);
    expect(restsAt("vale", homeOf("mara"))).toBe(false);
    expect(restsAt("moth", "pond")).toBe(false);
  });

  it("completes on a long rest at the avatar's home, paying no XP", () => {
    const journey = journeyWorlds(questCards);
    const card = journey.sleepQuest;
    expect(card.actors.vale.want).toMatchObject({ quest: { level: 2, left: 1 } });
    const done = journey.levelled;
    expect(done.actors.vale).toMatchObject({ level: 2, want: null, xp: 3 });
    expect(done.actors.vale.xp).toBe(card.actors.vale.xp);
    expect(questOffers(done).some((o) => o.kind === "level")).toBe(false);
    const woke = done.log.findLast((e) => e.actorId === "vale" && e.woke);
    expect(woke.rest).toBe("long");
    expect(done.turn - card.turn).toBeGreaterThanOrEqual(LONG_SLEEP_TURNS);
  });

  it("does not complete away from home, even in another sanctuary", () => {
    let s = held(atThreshold(3));
    s.actors.vale.place = "forest-cottage";
    s.items.lamp.holder = "attic";
    for (const id of ["moth", "keeper"])
      Object.assign(s.actors[id], { want: null, content: true, metTurn: s.turn });
    s = act(s, (a) => a.kind === "wait" && !a.sleep);
    for (let i = 0; i < 12 && s.actors.vale.sleeping !== undefined; i++)
      s = act(s, (a) => a.sleep);
    s = act(s, (a) => a.sleep);
    expect(s.actors.vale.level).toBe(1);
    expect(s.actors.vale.want).toMatchObject({ quest: { level: 2 } });
  });

  it("costs XP to discard, leaving the player just under the threshold", () => {
    for (const xp of [3, 4, 9]) {
      let s = held(atThreshold(xp));
      const drop = find(s, (a) => a.kind === "drop" && !a.item);
      expect(drop).toBeTruthy();
      expect(dropCost(s, "vale")).toBe(xp - (questXp(2) - 1));
      s = play(s, drop, s.revision).state;
      expect(s.actors.vale.xp).toBe(questXp(2) - 1);
      expect(s.actors.vale.want).toBeNull();
      expect(questOffers(s).some((o) => o.kind === "level")).toBe(false);
    }
    // Level 2 to 3: just under the threshold of level 3, never below level 2.
    let s = atThreshold(questXp(3) + 2);
    s.actors.vale.level = 2;
    s = held(s);
    s = play(s, find(s, (a) => a.kind === "drop" && !a.item), s.revision).state;
    expect(s.actors.vale.xp).toBe(questXp(3) - 1);
    expect(s.actors.vale.xp).toBeGreaterThanOrEqual(questXp(2));
    expect(s.actors.vale.level).toBe(2);
  });
});

describe("the mirror back to the attic", () => {
  it("pays Vale nothing for coming home", () => {
    let s = createWorld({ opening: true, seed: 17 });
    holdChoice(s, "vale", { item: null, revision: s.revision });
    s = act(s, (a) => a.kind === "move" && a.item === "lamp" && a.target === "pond");
    const xp = s.actors.vale.xp;
    expect(Object.keys(s.opened)).toEqual(["pond"]);
    // The lamp lit on the shore opens the way back: a box she has stood in.
    s = structuredClone(s);
    holdChoice(s, "vale", { item: "lamp", revision: s.revision });
    s = act(s, (a) => a.kind === "move" && a.target === "attic");
    expect(s.actors.vale.xp).toBe(xp);
    expect(Object.keys(s.opened)).toEqual(["pond"]);
  });
});

describe("a fresh world to the first level, quests held at once", () => {
  const w = journeyWorlds(questCards);
  it("opens the pond for 1 XP and holds nothing yet", () => {
    expect(w.opened.actors.vale.xp).toBe(1);
    expect(w.opened.opened).toEqual({ pond: ["vale"] });
    expect(questOffers(w.opened)).toEqual([]);
    expect(heldOf(w.opened.actors.vale)).toEqual([]);
  });
  it("holds Pip's quest as his Talk ends, always", () => {
    expect(wantOf(w.told, "vale")).toMatchObject({ target: "lamp", from: "quest:from:moth" });
    expect(questOffers(w.told)).toEqual([]);
    expect(legalActions(w.told).filter((a) => a.offer !== undefined)).toEqual([]);
  });
  it("meets the held quest and earns XP", () => {
    expect(wantOf(w.accepted, "vale")).toMatchObject({ target: "lamp" });
    expect(wantOf(w.met, "vale")).toMatchObject({ quest: { level: 2 } });
    // 1 for the pond, 1 for the quest and 1 for helping Pip.
    expect(w.met.actors.vale.xp).toBe(3);
    // The met quest is closed, so Pip's offer does not stand again.
    expect(w.met.actors.vale.closed["quest:from:moth"][1]).toContain("lamp");
  });
  it("holds the level-up quest at the threshold, and levels up at home", () => {
    expect(sources(w.met)).toEqual(["quest:level"]);
    expect(w.met.actors.vale.level ?? 1).toBe(1);
    expect(w.levelled.actors.vale.level).toBe(2);
    expect(w.levelled.actors.vale.xp).toBe(3);
    expect(w.levelled.actors.vale.place).toBe("attic");
  });
});
