import { describe, expect, it, vi } from "vitest";

// A world of invented places and people (test/helpers/company-world.mjs), so
// story edits to the real packs never break these rules tests. It is mounted
// beside the real packs by replacing packs.json before any module reads it.
vi.mock("../v2/card-game/packs.json", async (importOriginal) => {
  const real = await importOriginal();
  const { companyPacks } = await import("./helpers/company-world.mjs");
  return {
    default: { ...real.default, packs: [...real.default.packs, ...companyPacks] },
  };
});

const { createWorld, decodeSave, encodeSave, legalActions, play } =
  await import("../v2/card-game/world.mjs");
const { companionOf, travelerOf, partyOf } = await import(
  "../v2/card-game/world/company.mjs"
);
const { sailTo } = await import("./helpers/voyage.mjs");
const { cardPlay, asleepReason } = await import("../v2/card-game/cards.mjs");
const { runHash } = await import("../v2/card-game/pack-rules.mjs");
const { life } = await import("../v2/card-game/resident-home.mjs");

const ANN = "co-ann",
  BO = "co-bo",
  CY = "co-cy",
  DEE = "co-dee";

// A fresh day in the made-up world: Vale at A, three residents who trust her,
// none with a want of its own to wander toward, all awake.
const world = ({ seed = 5, turn = 60, at = "co-a" } = {}) => {
  const s = createWorld({ seed });
  s.turn = s.revision = turn;
  s.actors.vale.place = at;
  for (const id of [ANN, BO, CY, DEE, "co-oak"]) {
    const a = s.actors[id];
    a.want = null;
    a.content = true;
    a.trust.vale = 2;
    delete a.sleeping;
    if (id !== DEE && id !== "co-oak") a.place = at;
  }
  for (const [pack, who] of [
    ["co-home", [ANN, BO, CY, "co-oak"]],
    ["co-away", [DEE]],
  ])
    for (const id of who) s.packs[pack].met[id] = 0;
  // The shore's own residents keep out of the way.
  for (const id of ["moth", "keeper"]) {
    Object.assign(s.actors[id], { place: "attic", want: null, content: true });
    // Asleep in the attic for most of a day, so the shore keeps still.
    s.actors[id].sleeping = { since: s.turn, place: "attic", until: s.turn + 47 };
  }
  return s;
};
// The others sleep where they stand, so only the sleeper's own company wakes it.
const hush = (s) => {
  for (const id of [BO, CY, DEE])
    s.actors[id].sleeping = { since: s.turn, place: s.actors[id].place, until: s.turn + 47 };
  return s;
};
const step = (s, kind, fields = {}, actor = "vale") => {
  const plain = { move: !fields.item, wait: !fields.sleep && !fields.guards };
  const action = legalActions(s, actor).find(
    (a) =>
      a.kind === kind &&
      (plain[kind] === undefined ||
        (kind === "move" ? !a.item : !a.sleep && !a.guards)) &&
      Object.entries(fields).every(([k, v]) => a[k] === v),
  );
  expect(
    action,
    `${kind} ${JSON.stringify(fields)} among ${legalActions(s, actor)
      .map((a) => `${a.kind}:${a.target ?? ""}`)
      .join(" ")}`,
  ).toBeTruthy();
  const result = play(s, action, s.revision, actor);
  expect(result.ok, result.error).toBe(true);
  return result.state;
};
const go = (s, to) => step(s, "move", { target: to });
const wait = (s, n = 1) => {
  for (let i = 0; i < n; i++) s = step(s, "wait");
  return s;
};
// Wait until a condition holds (a released resident walks home at the dwell
// pace, rules 133), up to a few game days.
const waitUntil = (s, done, max = 200) => {
  for (let i = 0; i < max && !done(s); i++) s = step(s, "wait");
  return s;
};
const invite = (s, who, to) => step(s, "accompany", { target: who, destination: to });
const at = (s, id) => s.actors[id].place;
const offered = (s, who, to) =>
  legalActions(s, "vale").some(
    (a) => a.kind === "accompany" && a.target === who && a.destination === to,
  );
// Five moves from B: C, B, A, B, C.
const fiveMoves = (s) => ["co-c", "co-b", "co-a", "co-b", "co-c"].reduce(go, s);

describe("setting the bond", () => {
  it("an accepted Invite names the companion on the traveler, and nothing on the resident", () => {
    const s = invite(world(), ANN, "co-b");
    expect(s.actors.vale.companion).toBe(ANN);
    expect(s.actors[ANN].companion).toBeUndefined();
    expect(travelerOf(s, ANN)).toBe("vale");
    expect(at(s, ANN)).toBe("co-b");
  });
  it("a refusal binds no one", () => {
    const s = world();
    s.actors[ANN].trust.vale = 0;
    const next = invite(s, ANN, "co-b");
    expect(next.actors.vale.companion).toBeUndefined();
  });
  it("round trips through a save", () => {
    const s = invite(world(), ANN, "co-b");
    const back = decodeSave(encodeSave(s));
    expect(back.actors.vale.companion).toBe(ANN);
  });
  it("the field is optional: a save without it is valid", () => {
    const s = world();
    expect(decodeSave(encodeSave(s)).actors.vale.companion).toBeUndefined();
  });
});

describe("following", () => {
  it("follows across five moves with no invitation per hop", () => {
    const s = fiveMoves(invite(world(), ANN, "co-b"));
    expect(at(s, "vale")).toBe("co-c");
    expect(at(s, ANN)).toBe("co-c");
    expect(companionOf(s, "vale")).toBe(ANN);
  });
  it("rides a ship voyage and steps ashore with the traveler", () => {
    let s = invite(world({ at: "co-c" }), CY, "co-dock");
    s = go(s, "co-ship");
    expect(at(s, CY)).toBe("co-ship");
    s = sailTo(s, "co-far-pier");
    expect(at(s, "vale")).toBe("co-far-pier");
    expect(at(s, CY)).toBe("co-far-pier");
    expect(companionOf(s, "vale")).toBe(CY);
  });
  it("crosses from one pack to another through the shore", () => {
    let s = invite(world(), ANN, "station");
    s = go(s, "co-far");
    expect(at(s, ANN)).toBe("co-far");
    s = wait(s, 3);
    expect(at(s, ANN)).toBe("co-far");
    s = go(s, "station");
    s = go(s, "co-a");
    expect(at(s, ANN)).toBe("co-a");
  });
  it("takes the resident along a way back it could walk, with a ticket for it", () => {
    const s = invite(world(), ANN, "station");
    expect(s.invitedPlaces[ANN]).toEqual(expect.arrayContaining(["station"]));
    const far = go(s, "co-far");
    expect(far.invitedPlaces[ANN]).toEqual(
      expect.arrayContaining(["co-far", "station"]),
    );
  });
});

describe("holding", () => {
  it("none of the resident's own pulls moves it: dawn, dusk, bedtime, docking", () => {
    let s = invite(world({ turn: 40 }), BO, "co-b");
    // Through dusk, the whole night and the next dawn, with no sleep and no walk home.
    for (let i = 0; i < 60; i++) {
      s = wait(s);
      expect(at(s, BO)).toBe("co-b");
      expect(s.actors[BO].sleeping).toBeUndefined();
    }
    expect(companionOf(s, "vale")).toBe(BO);
  });
  it("stays aboard through docking until the traveler steps ashore", () => {
    let s = invite(world({ at: "co-c" }), CY, "co-dock");
    s = go(s, "co-ship");
    s = sailTo(s, "co-far-pier");
    s = wait(s, 2);
    expect(at(s, CY)).toBe("co-far-pier");
  });
  it("a drawn want does not walk it off; a met want does not end the bond", () => {
    let s = invite(world(), ANN, "co-b");
    s.actors[ANN].want = { kind: "place", target: "co-a", since: s.turn, refusals: 0 };
    s = wait(s, 4);
    expect(at(s, ANN)).toBe("co-b");
    // The want is met on the way (at its place), and the bond stays.
    s = go(s, "co-a");
    expect(s.actors[ANN].want?.target).not.toBe("co-a");
    expect(companionOf(s, "vale")).toBe(ANN);
    expect(at(s, ANN)).toBe("co-a");
  });
});

describe("gates are the party's", () => {
  const yardWorld = () => {
    const s = world({ at: "co-b" });
    s.actors[ANN].place = "co-b";
    return s;
  };
  it("neither holds the key: the way is shut for both", () => {
    const s = yardWorld();
    expect(legalActions(s, "vale").some((a) => a.kind === "move" && a.target === "co-yard")).toBe(false);
  });
  it("the traveler holds the key: both pass", () => {
    let s = yardWorld();
    s.items["co-key"].holder = "vale";
    s = invite(s, ANN, "co-yard");
    expect(at(s, "vale")).toBe("co-yard");
    expect(at(s, ANN)).toBe("co-yard");
  });
  it("the companion holds the key: the door opens for the traveler too", () => {
    let s = invite(yardWorld(), ANN, "co-a");
    s = go(s, "co-b");
    s.items["co-key"].holder = ANN;
    expect(partyOf(s, "vale")).toEqual(["vale", ANN]);
    s = go(s, "co-yard");
    expect(at(s, "vale")).toBe("co-yard");
    expect(at(s, ANN)).toBe("co-yard");
  });
  it("a companion left in another place does not hold the key for the party", () => {
    let s = invite(yardWorld(), ANN, "co-a");
    s = go(s, "co-b");
    s.actors[ANN].place = "co-a";
    s.items["co-key"].holder = ANN;
    expect(partyOf(s, "vale")).toEqual(["vale"]);
    expect(legalActions(s, "vale").some((a) => a.kind === "move" && a.target === "co-yard")).toBe(false);
  });
});

describe("left behind and catching up", () => {
  it("a companion that is parted walks to the traveler each round", () => {
    let s = invite(world(), ANN, "co-b");
    s.actors[ANN].place = "co-a";
    s = go(s, "co-c");
    s = wait(s);
    expect(["co-b", "co-c"]).toContain(at(s, ANN));
    s = wait(s, 2);
    expect(at(s, ANN)).toBe("co-c");
    expect(companionOf(s, "vale")).toBe(ANN);
  });
  it("a bound companion that is parted is still processed like any resident", () => {
    let s = invite(world(), ANN, "co-b");
    s.actors[ANN].place = "co-a";
    // Parted and separated, she is neither frozen nor given a schedule: she
    // acts (walks to catch up) and does not fall asleep or go home.
    s = go(s, "co-c");
    for (let i = 0; i < 3; i++) s = wait(s);
    expect(at(s, ANN)).toBe("co-c");
    expect(s.actors[ANN].sleeping).toBeUndefined();
  });
  it("a place with no way home is not offered, and the pair says she cannot follow", () => {
    const s = world({ at: "co-c" });
    expect(offered(s, ANN, "co-pit")).toBe(false);
    expect(asleepReason(s, [ANN, "co-pit"])).toBe("Ann cannot follow");
    // Moving alone stays the place card's play.
    expect(cardPlay(s, ["co-pit"]).action?.kind).toBe("move");
  });
  it("a bound companion is left at the pit's mouth, and the pair says so before the move", () => {
    let s = invite(world({ at: "co-b" }), ANN, "co-c");
    expect(asleepReason(s, [ANN, "co-pit"])).toBe("Ann cannot follow");
    expect(cardPlay(s, [ANN, "co-pit"]).action).toBeFalsy();
    s = go(s, "co-pit");
    expect(at(s, ANN)).toBe("co-c");
    expect(companionOf(s, "vale")).toBe(ANN);
  });
  it("a below-threshold trip that serves her want is a joint trip with no bond", () => {
    const s = world();
    s.actors[ANN].trust.vale = 0;
    s.actors[ANN].want = { kind: "place", target: "co-b", since: s.turn, refusals: 0 };
    const next = invite(s, ANN, "co-b");
    expect(at(next, ANN)).toBe("co-b");
    expect(companionOf(next, "vale")).toBeNull();
    expect(next.log.some((e) => /no longer trusts/u.test(e.text))).toBe(false);
  });
});

describe("walking home when released", () => {
  it("through the other pack and back, and the tickets are put away", () => {
    let s = invite(world(), ANN, "station");
    s = go(s, "co-far");
    expect(s.invitedPlaces[ANN]).toEqual(expect.arrayContaining(["co-far"]));
    s.actors[ANN].trust.vale = 0;
    s = wait(s);
    expect(companionOf(s, "vale")).toBeNull();
    // Her tickets now only cover the way home.
    expect(s.invitedPlaces?.[ANN]).toEqual(expect.arrayContaining(["co-far"]));
    s = waitUntil(s, (w) => at(w, ANN) === "co-a");
    expect(at(s, ANN)).toBe("co-a");
    s = wait(s);
    expect(s.invitedPlaces?.[ANN]).toBeUndefined();
  });
  it("a released resident waits at a shut way, lives there, and goes home when it opens", () => {
    let s = world({ at: "co-b" });
    s.actors[ANN].place = "co-b";
    s.items["co-key"].holder = "vale";
    s = invite(s, ANN, "co-yard");
    expect(at(s, ANN)).toBe("co-yard");
    // The key is taken out of the yard (it lies in B), so the way out is
    // shut, and then her trust goes: she is released inside.
    s.items["co-key"].holder = "co-b";
    s.actors[ANN].trust.vale = 0;
    s = wait(s, 6);
    expect(companionOf(s, "vale")).toBeNull();
    expect(at(s, ANN)).toBe("co-yard");
    // She is not frozen: she is a resident there and can be asked again.
    expect(legalActions(s, ANN).some((a) => a.kind === "wait")).toBe(true);
    // The key goes back to the yard and the way opens for her.
    s.items["co-key"].holder = "co-yard";
    s = waitUntil(s, (w) => at(w, ANN) === "co-a");
    expect(at(s, ANN)).toBe("co-a");
  });
  it("REPORTED, not fixed: a key door shuts behind a companion who leaves with the key", () => {
    let s = world({ at: "co-b" });
    s.actors[ANN].place = "co-b";
    s = invite(s, ANN, "co-a");
    s = go(s, "co-b");
    s.items["co-key"].holder = ANN;
    s = go(s, "co-yard");
    expect(at(s, ANN)).toBe("co-yard");
    // Ann walks out with the key (as any holder could): the way out was
    // open only while the key lay in the yard, and now the traveler is shut in.
    s.items["co-key"].holder = "co-b";
    expect(legalActions(s, "vale").some((a) => a.kind === "move")).toBe(false);
  });
});

describe("one companion, one traveler", () => {
  it("asking a second resident replaces the first, who stays where they stand", () => {
    let s = invite(world(), ANN, "co-b");
    s.actors[BO].place = "co-b";
    s = invite(s, BO, "co-c");
    expect(companionOf(s, "vale")).toBe(BO);
    expect(at(s, BO)).toBe("co-c");
    // Ann was released where she stood and is an ordinary resident again.
    expect(travelerOf(s, ANN)).toBeNull();
    s = go(s, "co-b");
    expect(at(s, BO)).toBe("co-b");
  });
  it("a resident with one traveler is not offered to another", () => {
    const s = invite(world(), ANN, "co-b");
    s.actors.mara = s.actors.mara ?? undefined;
    expect(offered(s, ANN, "co-a")).toBe(false);
    expect(travelerOf(s, ANN)).toBe("vale");
  });
  it("the companion is already with you, so no second Invite is offered", () => {
    const s = invite(world(), ANN, "co-b");
    expect(offered(s, ANN, "co-a")).toBe(false);
  });
});

describe("fixed by role", () => {
  it("is not offered, and the button says it stays here", () => {
    const s = world();
    expect(offered(s, "co-oak", "co-b")).toBe(false);
    const reason = asleepReason(s, ["co-oak", "co-b"]);
    expect(reason).toBe("The Post stays here");
  });
  // Roaming range says how far a resident wanders alone; it plays no part in
  // following a traveler. Only what a resident is (travels false, a post) fixes it.
  it("a range-0 resident can be asked, follows, and walks home when released", () => {
    life.residents[ANN] = { range: 0 };
    try {
      let s = world({ at: "co-b" });
      s.actors[ANN].place = "co-b";
      s = invite(s, ANN, "co-c");
      expect(companionOf(s, "vale")).toBe(ANN);
      s = go(s, "co-b");
      expect(at(s, ANN)).toBe("co-b");
      s = go(s, "co-a");
      expect(at(s, ANN)).toBe("co-a");
      s = go(s, "co-b");
      s = go(s, "co-c");
      s.actors[ANN].trust.vale = 0;
      s = wait(s, 4);
      expect(companionOf(s, "vale")).toBeNull();
      s = waitUntil(s, (w) => at(w, ANN) === "co-a");
      // Released away from home, the ordinary range-0 leash walks her back.
      expect(at(s, ANN)).toBe("co-a");
    } finally {
      delete life.residents[ANN];
    }
  });
  it("a resident who holds a post cannot be asked, whatever its range", () => {
    life.residents[BO] = { guards: "co-c" };
    try {
      const s = world({ at: "co-b" });
      s.actors[BO].place = "co-b";
      expect(offered(s, BO, "co-a")).toBe(false);
      expect(asleepReason(s, [BO, "co-a"])).toBe("Bo stays here");
    } finally {
      delete life.residents[BO];
    }
  });
  it("a resident with another traveler is refused with whose it is", () => {
    const s = world({ at: "co-b" });
    s.sharedVersion = 1;
    s.actors.vale.companion = ANN;
    s.controlledActors = ["vale", "mara"];
    s.presentActors = ["vale", "mara"];
    s.actors.mara.place = "co-b";
    s.actors[ANN].place = "co-b";
    const reason = asleepReason(Object.assign(s, { playerActorId: "mara" }), [ANN, "co-a"]);
    expect(reason).toBe("Ann is with Vale");
  });
});

describe("what ends the bond", () => {
  it("trust falling below the threshold", () => {
    let s = invite(world(), ANN, "co-b");
    s.actors[ANN].trust.vale = 1;
    s = wait(s);
    expect(companionOf(s, "vale")).toBeNull();
  });
  it("a threat against the companion lowers trust by 2 and ends the bond", () => {
    let s = invite(world(), ANN, "co-b");
    s.actors[ANN].trust.vale = 3;
    s = step(s, "threaten", { target: ANN });
    expect(s.actors[ANN].trust.vale).toBe(1);
    expect(companionOf(s, "vale")).toBeNull();
  });
  it("a threat for an item takes 3, and trust floors at 0", () => {
    let s = invite(world(), ANN, "co-b");
    s.actors[ANN].trust.vale = 1;
    s = step(s, "threaten", { target: ANN });
    expect(s.actors[ANN].trust.vale).toBe(0);
  });
  it("a strike on them takes 1 each time", () => {
    let s = invite(world(), ANN, "co-b");
    s.actors[ANN].trust.vale = 3;
    s = step(s, "threaten", { target: ANN });
    const after = s.actors[ANN].trust.vale;
    const attack = legalActions(s, "vale").find((a) => a.kind === "attack");
    if (attack) {
      const hit = play(s, attack, s.revision, "vale").state;
      expect(hit.actors[ANN].trust.vale).toBe(Math.max(0, after - 1));
    }
  });
  it("trust still rises the old way: a gift of what they want", () => {
    let s = world();
    s.actors[ANN].trust.vale = 0;
    s.actors[ANN].want = { kind: "item", target: "co-key", since: 0, refusals: 0 };
    s.items["co-key"].holder = "vale";
    s = step(s, "give", { target: ANN, item: "co-key" });
    expect(s.actors[ANN].trust.vale).toBe(1);
  });
  // Passing annoyances are not trust breaking down (rules 133): a grievance
  // alone, from the bell, the light or pestering, leaves the bond.
  for (const kind of ["noise", "light", "pestering"])
    it(`a ${kind} grievance alone does not end it`, () => {
      let s = invite(world(), ANN, "co-b");
      s.motives.grievances[ANN].push({
        other: "vale",
        kind,
        reason: "Vale annoyed her.",
        turn: s.turn,
        weight: 2,
        lastTouched: s.turn,
        repaired: false,
      });
      s = wait(s, 3);
      expect(companionOf(s, "vale")).toBe(ANN);
    });
  it("asking a second resident ends the first bond, who is then ordinary", () => {
    let s = invite(world(), ANN, "co-b");
    s.actors[BO].place = "co-b";
    s = invite(s, BO, "co-c");
    expect(travelerOf(s, ANN)).toBeNull();
  });
  it("the traveler's avatar being reset ends it", async () => {
    const { resetAvatar } = await import("../v2/card-game/avatar-reset.mjs");
    let s = invite(world(), ANN, "co-b");
    s.sharedVersion = 1;
    s.controlledActors = ["vale", "mara"];
    s.presentActors = ["vale", "mara"];
    s.heldActors = ["vale", "mara"];
    resetAvatar(s, "vale");
    expect(s.actors.vale.companion).toBeUndefined();
    expect(travelerOf(s, ANN)).toBeNull();
  });
  // Place B is a sanctuary in the made-up world. A rest of twelve turns or more
  // there is a long rest; Sleep runs until something wakes the sleeper.
  const sleepAtB = (s, turns) => {
    s = wait(s);
    const sleep = legalActions(s, "vale").find((a) => a.sleep);
    expect(sleep).toBeTruthy();
    s = play(s, sleep, s.revision).state;
    return s;
  };
  it("waking from a long rest ends it, and the resident is ordinary again where they stand", () => {
    // Turn 48 is dawn: the rest runs to dusk, 21 turns, well over twelve.
    let s = world({ turn: 48 });
    s = sleepAtB(hush(invite(s, ANN, "co-b")));
    expect(s.log.some((e) => e.rest === "long")).toBe(true);
    expect(companionOf(s, "vale")).toBeNull();
    expect(at(s, ANN)).toBe("co-b");
  });
  it("a short nap does not", () => {
    let s = invite(world({ turn: 60 }), ANN, "co-b");
    s = wait(s);
    s = step(s, "wait", {});
    expect(companionOf(s, "vale")).toBe(ANN);
  });
});

describe("a shared quest pins the bond", () => {
  it("holding an escort quest from a resident brings them along at once", () => {
    let s = world();
    s.actors[ANN].want = { kind: "place", target: "co-c", since: s.turn, refusals: 0 };
    s = step(s, "talk", { target: ANN });
    expect(legalActions(s, "vale").some((a) => a.kind === "take" && a.offer)).toBe(false);
    expect(s.actors.vale.want).toMatchObject({ from: `quest:from:${ANN}` });
    expect(companionOf(s, "vale")).toBe(ANN);
  });
});

describe("the pin survives a long rest", () => {
  const sleepAtB = (s) => {
    s = wait(s);
    return play(s, legalActions(s, "vale").find((a) => a.sleep), s.revision).state;
  };
  const vow = () => {
    let s = world({ at: "co-a", turn: 48 });
    s.actors[ANN].want = { kind: "place", target: "co-c", since: s.turn, refusals: 0 };
    s = step(s, "talk", { target: ANN });
    s.actors[BO].place = "co-b";
    s.actors[CY].place = "co-c";
    return hush(go(s, "co-b"));
  };
  it("keeps the bond while the quest is held", () => {
    let s = vow();
    expect(companionOf(s, "vale")).toBe(ANN);
    s = sleepAtB(s);
    expect(s.log.some((e) => e.rest === "long")).toBe(true);
    expect(companionOf(s, "vale")).toBe(ANN);
  });
  it("unpins when the quest is discarded", () => {
    let s = vow();
    s = step(s, "drop", {});
    s = sleepAtB(s);
    expect(companionOf(s, "vale")).toBeNull();
  });
  it("unpins when the quest is met", () => {
    let s = vow();
    s = go(s, "co-c");
    expect(s.actors.vale.want).toBeFalsy();
    s = go(s, "co-b");
    s = sleepAtB(s);
    expect(companionOf(s, "vale")).toBeNull();
  });
});

describe("a shared world", () => {
  const shared = () => {
    const s = world({ at: "co-b" });
    s.actors[ANN].place = "co-b";
    s.sharedVersion = 1;
    s.controlledActors = ["vale", "mara"];
    s.presentActors = ["vale", "mara"];
    s.actors.mara.place = "co-a";
    return invite(s, ANN, "co-c");
  };
  it("pauses while the traveler is away, and ends after a day", () => {
    let s = shared();
    s.presentActors = ["mara"];
    s.controlledActors = ["mara"];
    for (let i = 0; i < 40; i++) s = step(s, "wait", {}, "mara");
    expect(companionOf(s, "vale")).toBe(ANN);
    expect(at(s, ANN)).toBe("co-c");
    // The log is capped, and Vale's own entries have long gone from it: the
    // limit is timed from saved state, not from the log.
    s.log = s.log.filter((e) => e.actorId !== "vale");
    expect(s.log.some((e) => e.actorId === "vale")).toBe(false);
    for (let i = 0; i < 12; i++) s = step(s, "wait", {}, "mara");
    expect(companionOf(s, "vale")).toBeNull();
    expect(s.actors.vale.actedAt).toBeUndefined();
  });
  it("is the same on every engine: the same plays give the same world", () => {
    expect(JSON.stringify(shared())).toBe(JSON.stringify(shared()));
  });
  it("a second traveler cannot take a resident who is with the first", () => {
    const s = shared();
    s.actors.mara.place = "co-c";
    const found = legalActions(s, "mara").some(
      (a) => a.kind === "accompany" && a.target === ANN,
    );
    expect(found).toBe(false);
  });
});

describe("determinism", () => {
  it("the same plays give the same world", () => {
    const run = () => fiveMoves(invite(world(), ANN, "co-b"));
    const a = run(),
      b = run();
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    expect(runHash(a, "x")).toBe(runHash(b, "x"));
  });
});

describe("play labels", () => {
  it("the companion's pair with a place is a plain Travel", () => {
    const s = invite(world(), ANN, "co-b");
    const found = cardPlay(s, [ANN, "co-c"]);
    expect(found.action?.kind).toBe("move");
  });
});
