import { describe, it, expect } from "vitest";
import {
  createWorld,
  exits,
  legalActions,
  play,
  standoffFor,
  encodeSave,
  decodeSave,
  validateWorld,
  plan,
} from "../v2/card-game/world.mjs";
import { avatarPlays, cardPlay } from "../v2/card-game/cards.mjs";
import { narrativeContext } from "../v2/card-game/narrative.mjs";
import { levelOf, newWant, travels } from "../v2/card-game/want.mjs";
import { tastes } from "../v2/card-game/motives.mjs";
import { humanAvatar, humanAvatarIds } from "../v2/card-game/human-cast.mjs";
import {
  entityActive,
  packDefinitions,
  staysPut,
} from "../v2/card-game/pack-registry.mjs";

const act = (s, kind, target, item) => {
  const action = legalActions(s).find(
    (a) =>
      a.kind === kind &&
      (!target || a.target === target) &&
      (!item || a.item === item),
  );
  expect(action, `${kind} ${target || ""}`).toBeTruthy();
  const result = play(s, action);
  expect(result.ok).toBe(true);
  return result.state;
};
const meeting = () => {
  const s = createWorld();
  s.actors.moth.place = "station";
  s.actors.keeper.place = "pond";
  s.items.lamp.holder = "moth";
  s.items.bell.holder = "keeper";
  // Neither resident is after anything, so only the standoff moves them.
  s.actors.moth.want = s.actors.keeper.want = null;
  s.actors.moth.metTurn = s.actors.keeper.metTurn = 0;
  return s;
};

describe("card standoffs", () => {
  it("opens combat with a threat and locks the room's travel and item plays", () => {
    let s = meeting();
    expect(avatarPlays(s, "moth").map((a) => a.kind)).toEqual([
      "talk",
      "threaten",
    ]);
    expect(legalActions(s).some((a) => a.kind === "attack")).toBe(false);
    expect(play(s, { key: "attack:vale::moth" }).ok).toBe(false);
    s = act(s, "threaten", "moth");
    expect(standoffFor(s, "vale")).toMatchObject({
      challenger: "vale",
      defender: "moth",
      item: "lamp",
      resolve: { vale: 4, moth: 4 },
      guarding: { moth: true },
    });
    expect(avatarPlays(s, "moth").map((a) => a.kind)).toEqual([
      "talk",
      "guard",
      "attack",
    ]);
    expect(cardPlay(s, ["moth"]).action.kind).toBe("talk");
    // Nobody in a standoff's room leaves or changes items until it ends.
    expect(cardPlay(s, ["lamp"]).action).toBeFalsy();
    expect(legalActions(s).some((a) => a.kind === "move")).toBe(false);
    expect(s.log.some((e) => e.verb === "attack")).toBe(false);
  });
  it("keeps a threat open until both sides stand down", () => {
    let s = meeting();
    // The more experienced keeper answers with words: one side stands down.
    s.actors.keeper.place = "station";
    s.turn = s.revision = 3;
    s.actors.keeper.xp = 3;
    s = act(s, "threaten", "keeper");
    expect(s.log.some((e) => e.verb === "talk" && e.actorId === "keeper")).toBe(
      true,
    );
    // One side's Talk alone leaves the threat and the room lock in force.
    expect(standoffFor(s, "vale").steppedBack).toEqual({
      vale: false,
      keeper: true,
    });
    expect(legalActions(s).some((a) => a.kind === "move")).toBe(false);
    // A Brace never counts as standing down.
    s = act(s, "guard", "keeper");
    expect(standoffFor(s, "vale")).toBeTruthy();
    expect(legalActions(s).some((a) => a.kind === "move")).toBe(false);
    // Once Vale stands down too, it ends.
    s = act(s, "talk", "keeper");
    expect(standoffFor(s, "vale")).toBeUndefined();
    expect(s.log.map((e) => e.text)).toContain(
      "Vale and The keeper both stand down. The standoff ends.",
    );
    expect(s.log.filter((e) => e.verb === "attack")).toHaveLength(0);
    expect(legalActions(s).some((a) => a.kind === "move")).toBe(true);
  });
  it("never counts a Strike or Brace towards ending a standoff", () => {
    const open = () => act(meeting(), "threaten", "moth");
    // Pip braces in answer; Vale's Brace against it is no stand-down.
    expect(standoffFor(open(), "vale").guarding.moth).toBe(true);
    let s = act(open(), "guard", "moth");
    expect(s.standoffs).toHaveLength(1);
    expect(s.log.some((e) => e.text.includes("stand down"))).toBe(false);
    s = act(open(), "attack", "moth");
    expect(s.standoffs).toHaveLength(1);
    // A fighter who stood down and then strikes is back in the fight.
    s = meeting();
    s.actors.keeper.place = "station";
    s.turn = s.revision = 3;
    s.actors.keeper.xp = 3;
    s = act(s, "threaten", "keeper");
    expect(standoffFor(s, "vale").steppedBack.keeper).toBe(true);
    s = act(s, "attack", "keeper");
    // The keeper strikes back, so neither side has stood down.
    expect(standoffFor(s, "vale").steppedBack).toEqual({
      vale: false,
      keeper: false,
    });
  });
  it("ends a standoff once both sides make any play but Strike or Brace", () => {
    // Pip braced in answer; Vale waits, and Pip, with nothing to fight
    // over, waits too.
    const s = act(act(meeting(), "threaten", "moth"), "wait");
    expect(s.standoffs).toEqual([]);
    expect(s.log.map((e) => e.text)).toContain(
      "Pip and Vale both stand down. The standoff ends.",
    );
  });
  it("ends a standoff when the demanded item is handed over", () => {
    const s = meeting();
    s.items.lamp.holder = "vale";
    s.items.cloth.holder = "moth";
    s.standoffs = [
      {
        challenger: "moth",
        defender: "vale",
        location: "station",
        item: "lamp",
        opened: s.turn,
        answered: true,
        resolve: { moth: 4, vale: 4 },
        guarding: { moth: false, vale: false },
        struck: { moth: false, vale: false },
        steppedBack: { moth: false, vale: false },
      },
    ];
    s.actors.vale.place = "station";
    const after = act(s, "give", "moth", "lamp");
    expect(after.items.lamp.holder).not.toBe("vale");
    expect(after.standoffs).toEqual([]);
  });
  it("applies guarded damage, retaliation, item release and retreat", () => {
    let s = act(meeting(), "threaten", "moth");
    s = act(s, "attack", "moth");
    expect(standoffFor(s, "vale").resolve).toEqual({ vale: 2, moth: 3 });
    // Guard reduces Pip's two damage to one and lasts for one reply.
    s = act(s, "guard", "moth");
    expect(standoffFor(s, "vale").resolve.vale).toBe(1);
    expect(exits(s, "station", "vale")).toEqual(["pond"]);
    s = act(s, "attack", "moth");
    expect(standoffFor(s, "vale")).toBeUndefined();
    expect(s.actors.vale.place).toBe("pond");
    expect(narrativeContext(s).outcome).toMatchObject({
      card: { kind: "attack", target: "moth" },
      avatars: expect.arrayContaining([
        expect.objectContaining({
          id: "vale",
          location: "pond",
          travel: { from: "station", to: "pond", companions: [] },
        }),
      ]),
    });
    expect(levelOf(s, "vale")).toBe(1);
    expect(s.peaceUntil.vale).toBe(s.turn + 3);
  });
  it("allows a threat but never an attack in a sanctuary", () => {
    const s = meeting();
    s.actors.vale.place = s.actors.moth.place = "attic";
    s.items.lamp.holder = "moth";
    s.peaceUntil.vale = s.peaceUntil.moth = 0;
    const threat = legalActions(s).find(
      (a) => a.kind === "threaten" && a.target === "moth",
    );
    expect(threat).toBeTruthy();
    const after = play(s, threat).state;
    expect(standoffFor(after, "vale")).toBeTruthy();
    expect(legalActions(after).map((a) => a.kind)).toContain("guard");
    expect(legalActions(after).map((a) => a.kind)).not.toContain("attack");
    expect(legalActions(after, "moth").map((a) => a.kind)).not.toContain(
      "attack",
    );
    validateWorld(after);
  });
  it("settles an item demand by handing it over, the one item play left", () => {
    let s = meeting();
    s.items.lamp.holder = "vale";
    s.items.cloth.holder = "moth";
    s.actors.vale.place = "station";
    s.standoffs = [
      {
        challenger: "moth",
        defender: "vale",
        location: "station",
        item: "lamp",
        opened: s.turn,
        answered: true,
        resolve: { moth: 4, vale: 4 },
        guarding: { moth: false, vale: false },
        struck: { moth: false, vale: false },
        steppedBack: { moth: false, vale: false },
      },
    ];
    // While the room is locked, handing over the demanded item is the one
    // item play left, and it ends the standoff.
    expect(
      legalActions(s).filter((a) =>
        ["give", "trade", "drop", "ask"].includes(a.kind),
      ),
    ).toEqual([expect.objectContaining({ kind: "give", item: "lamp" })]);
    s = act(s, "give", "moth", "lamp");
    expect(s.items.lamp.holder).not.toBe("vale");
    expect(s.standoffs).toEqual([]);
    expect(s.log.some((e) => e.verb === "attack")).toBe(false);
  });
  it("ends a standoff once the resident challenger sets the item aside", () => {
    let s = createWorld();
    s.turn = s.revision = 1;
    s.actors.moth.place = "station";
    s.actors.keeper.place = "station";
    s.items.oil.holder = "keeper";
    s.actors.moth.want = newWant("person", "keeper", s.turn);
    s.standoffs = [
      {
        challenger: "moth",
        defender: "keeper",
        location: "station",
        item: "oil",
        opened: s.turn,
        answered: true,
        resolve: { moth: 4, keeper: 4 },
        guarding: { moth: false, keeper: false },
        struck: { moth: false, keeper: false },
        steppedBack: { moth: false, keeper: false },
      },
    ];
    validateWorld(s);
    s = act(s, "wait");
    expect(s.standoffs).toEqual([]);
    expect(s.items.oil.holder).toBe("keeper");
    // Pip has no use for the flask, so neither side strikes and both stand
    // down within the round.
    expect(s.log.map((e) => e.text)).toContain(
      "The keeper and Pip both stand down. The standoff ends.",
    );
  });
  it("reopens travel once a Talk ends the standoff and keeps items with their owner", () => {
    let s = act(meeting(), "threaten", "moth");
    expect(legalActions(s).some((a) => a.kind === "move")).toBe(false);
    s = act(s, "talk", "moth");
    expect(s.standoffs).toEqual([]);
    s = act(s, "move", "pond");
    expect(s.items.lamp.holder).toBe("moth");
  });
  it("locks a bystander in the room until the fighters finish", () => {
    let s = meeting();
    s.actors.keeper.place = "station";
    s.items.lamp.holder = "keeper";
    s.standoffs = [
      {
        challenger: "moth",
        defender: "keeper",
        location: "station",
        item: "lamp",
        opened: s.turn,
        answered: true,
        resolve: { moth: 4, keeper: 4 },
        guarding: { moth: false, keeper: false },
        struck: { moth: true, keeper: true },
        steppedBack: { moth: false, keeper: false },
      },
    ];
    const kinds = legalActions(s).map((a) => a.kind);
    expect(kinds).toContain("talk");
    for (const kind of ["move", "take", "give", "trade", "ask", "attack"])
      expect(kinds).not.toContain(kind);
  });
  it("preserves a standoff through saves, rejects stale plays and validates combat fields", () => {
    const s = act(meeting(), "threaten", "moth");
    const restored = decodeSave(encodeSave(s));
    expect(act(restored, "attack", "moth")).toEqual(act(s, "attack", "moth"));
    const attack = legalActions(s).find((a) => a.kind === "attack");
    expect(play(s, attack, s.revision - 1).ok).toBe(false);
    const departed = act(s, "talk", "moth");
    expect(play(departed, attack).ok).toBe(false);
    for (const patch of [
      { resolve: { vale: 99, moth: 4 } },
      { guarding: { vale: false, moth: "yes" } },
      { defender: "vale" },
      { opened: 99 },
      { location: "pond" },
      { item: "oil" },
    ]) {
      const broken = structuredClone(s);
      Object.assign(broken.standoffs[0], patch);
      expect(() => validateWorld(broken)).toThrow();
    }
    // Saves from before standoffs (schema 4) start fresh during alpha.
    const old = meeting();
    old.schema = 4;
    expect(() => decodeSave(JSON.stringify(old))).toThrow();
  });
  it("breaks a repeated cast impasse through a threat, combat and a released item", () => {
    let s = meeting();
    s.turn = s.revision = 8;
    for (const id of ["vale", "moth", "keeper"]) s.actors[id].place = "station";
    s.items.oil.holder = "keeper";
    s.actors.moth.want = { kind: "item", target: "oil", since: 8, refusals: 0 };
    expect(plan(s, "moth").action.kind).toBe("ask");
    let seenThreat = false,
      seenAttack = false,
      released = false;
    for (let i = 0; i < 12; i++) {
      s = act(s, "wait");
      seenThreat ||= s.log.some(
        (e) => e.verb === "threaten" && ["moth", "keeper"].includes(e.actorId),
      );
      seenAttack ||= s.log.some((e) => e.verb === "attack");
      released ||= s.log.some(
        (e) => e.verb === "attack" && e.text.includes("drops the"),
      );
      expect(() => validateWorld(s)).not.toThrow();
    }
    expect(seenThreat).toBe(true);
    expect(seenAttack).toBe(true);
    // Pip strikes; the keeper may outlast him.
    expect(released || s.log.some((e) => e.verb === "retreat")).toBe(true);
  });
  it("lets the winning avatar collect the released item as a card play", () => {
    let s = meeting();
    s.turn = s.revision = 3;
    s.actors.vale.xp = 1;
    s = act(s, "threaten", "moth");
    s = act(s, "attack", "moth");
    s = act(s, "attack", "moth");
    expect(s.items.lamp.holder).toBe("station");
    expect(s.items.cloth.holder).toBe("moth");
    expect(s.actors.moth.place).toBe("pond");
    expect(s.standoffs).toEqual([]);
    expect(levelOf(s, "vale")).toBe(2);
    s = act(s, "take", null, "lamp");
    expect(s.items.lamp.holder).toBe("vale");
  });
  it("carries the threat, guard and combat facts into each witness's model context", () => {
    const start = meeting();
    start.items.bell.holder = "station";
    // The keeper, rested, comes from the pond for the bell at the station.
    delete start.actors.keeper.metTurn;
    start.actors.keeper.want = {
      kind: "item",
      target: "bell",
      since: 0,
      refusals: 0,
    };
    const s = act(start, "threaten", "moth");
    const context = narrativeContext(s, { target: "moth" });
    expect(context.speakers).toEqual(["vale", "moth", "keeper"]);
    expect(
      context.entities.find((e) => e.id === "keeper").facts.join(" "),
    ).toContain("Just arrived from Black pond");
    for (const id of ["vale", "moth", "lamp", "station"])
      expect(
        s.memories[id].events.some((e) => e.text.includes("threatens")),
      ).toBe(true);
    const moth = context.entities.find((e) => e.id === "moth");
    expect(moth.facts.join(" ")).toContain("braced");
    expect(
      context.entities.every(
        (e) => e.facts.length <= 16 && e.facts.every((f) => f.length <= 240),
      ),
    ).toBe(true);
  });
});

describe("standoff endings", () => {
  // A player who keeps Striking or Bracing keeps a threat open by choice, so
  // the long run mixes fighting with standing down. Residents follow their
  // own plans, and every standoff still ends within a few rounds.
  it("never leaves a standoff open in long runs", () => {
    for (let seed = 1; seed <= 6; seed++) {
      let rng = seed;
      const roll = (n) => (rng = (rng * 48271) % 2147483647) % n;
      let s = meeting();
      for (const id of ["moth", "keeper"]) s.actors[id].place = "station";
      s.items.oil.holder = "keeper";
      s.actors.moth.want = {
        kind: "item",
        target: "oil",
        since: 0,
        refusals: 0,
      };
      let longest = 0;
      for (let i = 0; i < 150; i++) {
        const acts = legalActions(s);
        const fight = acts.filter((a) => ["guard", "attack"].includes(a.kind));
        const threat = acts.filter((a) => a.kind === "threaten");
        const pool =
          fight.length && roll(2) === 0
            ? fight
            : threat.length && roll(3) === 0
              ? threat
              : acts;
        s = play(s, pool[roll(pool.length)]).state;
        for (const c of s.standoffs)
          longest = Math.max(longest, s.turn - c.opened);
      }
      expect(longest, `seed ${seed}`).toBeLessThanOrEqual(10);
    }
  });
  // A player who stands down at once still gets out: a resident either
  // stands down too or fights it to a finish.
  it("ends every standoff the player stands down from", () => {
    for (let seed = 1; seed <= 6; seed++) {
      let rng = seed;
      const roll = (n) => (rng = (rng * 48271) % 2147483647) % n;
      let s = meeting();
      for (const id of ["moth", "keeper"]) s.actors[id].place = "station";
      s.items.oil.holder = "keeper";
      s.actors.moth.want = {
        kind: "item",
        target: "oil",
        since: 0,
        refusals: 0,
      };
      let longest = 0;
      for (let i = 0; i < 150; i++) {
        const acts = legalActions(s);
        const calm = acts.filter((a) => ["talk", "wait"].includes(a.kind));
        const pool = standoffFor(s, "vale")
          ? calm
          : acts.filter((a) => a.kind === "threaten").length && roll(3) === 0
            ? acts.filter((a) => a.kind === "threaten")
            : acts;
        s = play(s, pool[roll(pool.length)]).state;
        for (const c of s.standoffs)
          longest = Math.max(longest, s.turn - c.opened);
      }
      expect(longest, `seed ${seed}`).toBeLessThanOrEqual(10);
    }
  });
});

// A standoff one hit from its end, as if earlier blows had already landed.
const lastBlow = (s, challenger, defender, item, loserResolve = 1) => {
  const here = s.actors[challenger].place;
  s.actors[defender].place = here;
  s.peaceUntil[challenger] = s.peaceUntil[defender] = 0;
  s.standoffs = [
    {
      challenger,
      defender,
      location: here,
      item,
      opened: Math.max(1, s.turn),
      answered: true,
      resolve: { [challenger]: 4, [defender]: loserResolve },
      guarding: { [challenger]: false, [defender]: false },
      struck: { [challenger]: true, [defender]: true },
      steppedBack: { [challenger]: false, [defender]: false },
    },
  ];
  s.turn = s.revision = Math.max(1, s.turn);
  return s;
};
// Moth strikes Vale's last resolve as Vale strikes at the station. Any
// other play from Vale would end the standoff first.
const valeFalls = (s) => {
  s.actors.vale.place = s.actors.moth.place = "station";
  s.items.lamp.holder = "vale";
  lastBlow(s, "moth", "vale", "lamp");
  return act(s, "attack", "moth");
};

describe("repeated defeats", () => {
  it("retreats twice, then sends the loser home with empty hands", () => {
    let s = meeting();
    s.items.cloth.holder = "vale";
    s = valeFalls(s);
    let attack = s.log.findLast((e) => e.verb === "attack");
    expect(attack).toMatchObject({
      kind: "action",
      actorId: "moth",
      targetId: "vale",
      locationId: "station",
      damage: 2,
      guarded: false,
      resolveBefore: 1,
      resolveAfter: 0,
      outcome: "yield",
      lossCount: 1,
      droppedItemIds: ["lamp"],
    });
    expect(attack.text).toContain("Vale drops the Lamp.");
    let move = s.log.findLast((e) => e.verb === "retreat");
    expect(move).toMatchObject({
      kind: "narration",
      actorId: "vale",
      targetId: "moth",
      fromLocationId: "station",
      locationId: "pond",
      droppedItemIds: ["lamp"],
      lossCount: 1,
    });
    expect(s.arrival).toEqual({
      seq: move.seq,
      fromLocationId: "station",
      locationId: "pond",
    });
    expect(s.defeats).toEqual({ vale: 1 });
    expect(s.items.cloth.holder).toBe("vale");
    s = valeFalls(s);
    expect(s.defeats).toEqual({ vale: 2 });
    expect(s.actors.vale.place).toBe("pond");
    const discovered = structuredClone(s.crossings);
    const anchored = s.locations.attic.anchored;
    s.items.bell.holder = "vale";
    s = valeFalls(s);
    attack = s.log.findLast((e) => e.verb === "attack");
    expect(attack).toMatchObject({ outcome: "sent-home", lossCount: 3 });
    expect(attack.droppedItemIds.slice().sort()).toEqual([
      "bell",
      "cloth",
      "lamp",
    ]);
    move = s.log.findLast((e) => e.verb === "sent-home");
    expect(move).toMatchObject({
      kind: "narration",
      actorId: "vale",
      fromLocationId: "station",
      locationId: "attic",
      lossCount: 3,
    });
    expect(s.arrival).toMatchObject({ seq: move.seq, locationId: "attic" });
    expect(s.actors.vale.place).toBe("attic");
    for (const id of ["bell", "cloth", "lamp"])
      expect(s.items[id].holder).toBe("station");
    expect(s.defeats).toEqual({});
    // Being sent home crosses nothing and anchors nothing.
    expect(s.crossings).toEqual(discovered);
    expect(s.locations.attic.anchored).toBe(anchored);
    // The attic still has a way out with the lamp left behind.
    expect(exits(s, "attic", "vale")).toContain("pond");
    validateWorld(s);
    expect(decodeSave(encodeSave(s))).toEqual(s);
  });
  it("clears the count on a win", () => {
    let s = valeFalls(meeting());
    expect(s.defeats).toEqual({ vale: 1 });
    s.actors.vale.place = "station";
    s.items.lamp.holder = "moth";
    lastBlow(s, "vale", "moth", "lamp");
    s = act(s, "attack", "moth");
    expect(s.log.findLast((e) => e.verb === "attack")).toMatchObject({
      actorId: "vale",
      outcome: "yield",
      lossCount: 1,
    });
    expect(s.defeats).toEqual({ moth: 1 });
  });
  it("reports hits and guarded hits before anyone yields", () => {
    let s = act(meeting(), "threaten", "moth");
    s = act(s, "attack", "moth");
    expect(
      s.log.findLast((e) => e.actorId === "vale" && e.verb === "attack"),
    ).toMatchObject({
      damage: 1,
      guarded: true,
      resolveBefore: 4,
      resolveAfter: 3,
      outcome: "guarded",
      lossCount: 0,
    });
    expect(
      s.log.findLast((e) => e.actorId === "moth" && e.verb === "attack"),
    ).toMatchObject({
      damage: 2,
      guarded: false,
      resolveBefore: 4,
      resolveAfter: 2,
      outcome: "hit",
      lossCount: 0,
    });
  });
  it("clears the count while the avatar rests at home", () => {
    let s = meeting();
    s.turn = s.revision = 5;
    s.defeats = { vale: 2 };
    s.actors.vale.place = "attic";
    s.actors.vale.want = null;
    s.actors.vale.metTurn = 5;
    validateWorld(s);
    s = act(s, "wait");
    expect(s.defeats).toEqual({});
  });
  it("falls back along the first exit when the loser has no home", () => {
    const home = tastes.moth.home;
    tastes.moth.home = undefined;
    try {
      let s = meeting();
      s.items.lamp.holder = "moth";
      s.items.bell.holder = "moth";
      s.defeats = { moth: 2 };
      lastBlow(s, "vale", "moth", "lamp");
      s = act(s, "attack", "moth");
      expect(s.log.findLast((e) => e.verb === "attack")).toMatchObject({
        outcome: "yield",
        lossCount: 3,
        droppedItemIds: ["lamp"],
      });
      expect(s.items.bell.holder).toBe("moth");
      expect(s.actors.moth.place).toBe("pond");
      expect(s.log.findLast((e) => e.verb === "retreat")).toMatchObject({
        actorId: "moth",
        locationId: "pond",
      });
      expect(s.defeats).toEqual({});
    } finally {
      tastes.moth.home = home;
    }
  });
  it("rejects malformed defeat counts", () => {
    for (const defeats of [{ vale: 3 }, { vale: 0 }, { nobody: 1 }, []]) {
      const s = meeting();
      s.defeats = defeats;
      expect(() => validateWorld(s)).toThrow();
    }
  });
  it("leaves every home open to its avatar with empty hands", () => {
    const scopes = Object.fromEntries(
      packDefinitions.filter((p) => p.release).map((p) => [p.id, "full"]),
    );
    for (const shared of [false, true]) {
      const base = createWorld({ packScopes: scopes });
      if (shared) {
        base.sharedVersion = 1;
        base.controlledActors = [...humanAvatarIds];
        base.presentActors = [...humanAvatarIds];
      }
      const stranded = [];
      for (const id of Object.keys(base.actors)) {
        if (!entityActive(base, id) || !travels(id) || staysPut(id)) continue;
        const home = tastes[id]?.home || humanAvatar(id)?.home?.id;
        const s = structuredClone(base);
        s.actors[id].place = home;
        for (const item of Object.values(s.items))
          if (item.holder === id) item.holder = "station";
        if (!exits(s, home, id).length) stranded.push(`${id}@${home}`);
      }
      expect(stranded, shared ? "shared" : "local").toEqual([]);
    }
  });
});
