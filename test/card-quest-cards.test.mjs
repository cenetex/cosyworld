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
import {
  availableCards,
  asleepReason,
  cardActions,
  cardPlay,
  cardType,
  playLabel,
} from "../v2/card-game/cards.mjs";
import { BLOCKED } from "../v2/card-game/world/offers.mjs";
import { restsAt } from "../v2/card-game/world/home.mjs";
import {
  OFFER_ODDS,
  offerUnlocked,
} from "../v2/card-game/offer-chance.mjs";
import { questXp, dropCost, wantOf } from "../v2/card-game/want.mjs";
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
const take = (s, offer) =>
  act(s, (a) => a.kind === "take" && a.offer === offer);
const talk = (s, target) => act(s, (a) => a.kind === "talk" && a.target === target);
const takes = (s) => legalActions(s).filter((a) => a.offer !== undefined);
const GUARD = "greek-guard";

describe("quest offers", () => {
  it("offers a shut box's quest as a card, until the box opens", () => {
    const s = greekErrands().decree;
    const box = questOffers(s).find((o) => o.kind === "box");
    expect(box).toMatchObject({
      id: "quest:box:greek-battlefield",
      source: "greek-battlefield",
      label: "Accept quest",
      blocked: null,
      want: {
        kind: "item",
        target: "greek-creon-writ",
        story: true,
        step: { verb: "give", to: GUARD },
      },
    });
    expect(takes(s).map((a) => a.offer)).toContain(box.id);
    // The offer is deterministic for the same world.
    expect(questOffers(decodeSave(encodeSave(s)))).toEqual(questOffers(s));
    // The box opens with the writ in the guard's hands: the card goes.
    const open = greekErrands().opened;
    expect(questOffers(open).some((o) => o.id === box.id)).toBe(false);
  });

  it("offers a resident's quest after Talk, and not before", () => {
    let s = greekErrands().decree;
    expect(questOffers(s).some((o) => o.kind === "resident")).toBe(false);
    s.actors[GUARD].trust.vale = 1; // trusts: the offer is certain
    s = talk(s, GUARD);
    const offer = questOffers(s).find((o) => o.kind === "resident");
    expect(offer).toMatchObject({
      id: `quest:from:${GUARD}`,
      source: GUARD,
      label: "Accept quest",
      blocked: null,
      want: { kind: "item", target: "greek-bread", step: { verb: "give", to: GUARD } },
    });
    // Leaving the place ends the offer; the want told does not come back
    // until the next Talk.
    const away = structuredClone(s);
    away.actors.vale.place = "greek-courtyard";
    expect(questOffers(away).some((o) => o.kind === "resident")).toBe(false);
    // Taking it holds the quest and the card goes (it is the quest in hand).
    s = take(s, offer.id);
    expect(wantOf(s, "vale")).toMatchObject({ target: "greek-bread" });
    expect(questOffers(s).some((o) => o.kind === "resident")).toBe(false);
  });

  it("takes by a play that spends no turn and logs it", () => {
    let s = greekErrands().decree;
    const turn = s.turn;
    s = take(s, "quest:box:greek-battlefield");
    expect(s.turn).toBe(turn);
    expect(wantOf(s, "vale")).toMatchObject({ target: "greek-creon-writ" });
    const entry = s.log.at(-1);
    expect(entry).toMatchObject({
      verb: "quest",
      actorId: "vale",
      targetId: "greek-battlefield",
    });
    expect(entry.text).toMatch(/takes up a quest/u);
    expect(validateWorld(decodeSave(encodeSave(s)))).toBeTruthy();
  });

  it("carries the reason while a quest is held, and offers no play", () => {
    let s = greekErrands().decree;
    s = take(s, "quest:box:greek-battlefield");
    s = talk(s, GUARD);
    s.actors[GUARD].trust.vale = 1;
    s = talk(s, GUARD);
    const offers = questOffers(s);
    expect(offers.length).toBeGreaterThan(0);
    for (const o of offers) expect(o.blocked).toBe(BLOCKED);
    expect(takes(s)).toEqual([]);
    // The client reads the reason through the one existing blocked button.
    const id = offers[0].id;
    expect(availableCards(s)).toContain(id);
    expect(cardType(id)).toBe("quest");
    expect(cardPlay(s, [id]).action).toBeFalsy();
    expect(cardActions(s, [id]).actions).toEqual([]);
    expect(asleepReason(s, [id])).toBe(BLOCKED);
    // Discarding is free for an ordinary quest, and the card is live again.
    const drop = find(s, (a) => a.kind === "drop" && !a.item);
    expect(dropCost(s, "vale")).toBe(0);
    s = play(s, drop, s.revision).state;
    expect(questOffers(s).every((o) => o.blocked === null)).toBe(true);
    expect(takes(s).length).toBeGreaterThan(0);
  });

  it("gives an offer card its one play and its label", () => {
    const s = greekErrands().decree;
    const id = "quest:box:greek-battlefield";
    expect(availableCards(s)).toContain(id);
    const { actions } = cardActions(s, [id]);
    expect(actions).toHaveLength(1);
    expect(actions[0]).toMatchObject({ kind: "take", offer: id });
    expect(playLabel(actions[0], s)).toBe("Accept quest");
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
      expect(questOffers(s).some((o) => o.id === `quest:from:${GUARD}`)).toBe(true);
    }
  });

  it("applies to residents alone: a shut box always shows its card", () => {
    for (let seed = 0; seed < 10; seed++) {
      const s = seeded(seed);
      expect(
        questOffers(s).some((o) => o.id === "quest:box:greek-battlefield"),
      ).toBe(true);
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

  it("shows the level-up card at the threshold and not under it", () => {
    expect(questXp(2)).toBe(3);
    expect(questOffers(atThreshold(2)).some((o) => o.kind === "level")).toBe(false);
    const offer = questOffers(atThreshold(3)).find((o) => o.kind === "level");
    expect(offer).toMatchObject({
      id: "quest:level",
      label: "Accept quest",
      blocked: null,
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

  it("takes Sleep at home by a tap, blocked by any other quest", () => {
    const held = atThreshold(3);
    held.actors.vale.want = { kind: "place", target: "pond", since: 0, refusals: 0 };
    const offer = questOffers(held).find((o) => o.kind === "level");
    expect(offer.blocked).toBe(BLOCKED);
    expect(takes(held)).toEqual([]);
    const s = take(atThreshold(3), "quest:level");
    expect(wantOf(s, "vale")).toMatchObject({ target: "attic", quest: { level: 2 } });
    // Held, it is not offered again.
    expect(questOffers(s).some((o) => o.kind === "level")).toBe(false);
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

  it("leaves an offered level quest unmet by a long rest at home while it is not held (rules 133)", () => {
    const rested = (s) =>
      s.log.some((e) => e.actorId === "vale" && e.rest === "long");
    const longRest = (s) => {
      for (let i = 0; i < 40 && !rested(s); i++)
        s = act(s, (a, _, all) => a.sleep || (a.kind === "wait" && !all.some((b) => b.sleep)));
      expect(rested(s)).toBe(true);
      expect(s.actors.vale.place).toBe(homeOf("vale"));
      return s;
    };
    const offered = longRest(atThreshold(questXp(2)));
    expect(offered.actors.vale).toMatchObject({ level: 1, want: null, xp: questXp(2) });
    expect(questOffers(offered).map((o) => o.kind)).toContain("level");
    const held = longRest(take(atThreshold(questXp(2)), "quest:level"));
    expect(held.actors.vale).toMatchObject({ level: 2, want: null });
  });

  it("does not complete away from home, even in another sanctuary", () => {
    let s = take(atThreshold(3), "quest:level");
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
      let s = take(atThreshold(xp), "quest:level");
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
    s = take(s, "quest:level");
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

describe("a fresh world to the first level, by taps", () => {
  const w = journeyWorlds(questCards);
  it("opens the pond for 1 XP and offers nothing yet", () => {
    expect(w.opened.actors.vale.xp).toBe(1);
    expect(w.opened.opened).toEqual({ pond: ["vale"] });
    expect(questOffers(w.opened)).toEqual([]);
  });
  it("shows Pip's Accept quest card after Talk, always", () => {
    expect(wantOf(w.told, "vale")).toBeNull();
    const offers = questOffers(w.told);
    expect(offers.map((o) => o.id)).toEqual(["quest:from:moth"]);
    expect(offers[0].label).toBe("Accept quest");
    expect(takes(w.told).map((a) => a.label)).toEqual(["Accept quest"]);
  });
  it("holds the quest after the tap, meets it, and earns XP", () => {
    expect(wantOf(w.accepted, "vale")).toMatchObject({ target: "lamp" });
    expect(wantOf(w.met, "vale")).toBeNull();
    // 1 for the pond, 1 for the quest and 1 for helping Pip.
    expect(w.met.actors.vale.xp).toBe(3);
  });
  it("offers the level-up card at the threshold, and levels up at home", () => {
    expect(questOffers(w.met).map((o) => o.id)).toEqual(["quest:level"]);
    expect(w.met.actors.vale.level ?? 1).toBe(1);
    expect(w.levelled.actors.vale.level).toBe(2);
    expect(w.levelled.actors.vale.xp).toBe(3);
    expect(w.levelled.actors.vale.place).toBe("attic");
  });
});
