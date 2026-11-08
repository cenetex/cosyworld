// Rules 102 and Greek revision 20 (#2284): one bread, two routes. Dione bakes
// it from the water jar and the wheat; the guard bars the gate while he holds
// the Gate Decree and trades it for the bread, which he eats; Myrto packs
// the Charybdis's provisions from bread, figs and wine. Eaten or used, a
// thing goes home: made things locked, the rest ready to fetch again.
import { describe, expect, it } from "vitest";
import {
  decodeSave,
  encodeSave,
  exits,
  legalActions,
  play,
} from "../v2/card-game/world.mjs";
import {
  availableCards,
  cardActions,
  cardPlay,
  sealedReason,
} from "../v2/card-game/cards.mjs";
import { packDefinition } from "../v2/card-game/pack-registry.mjs";
import { CONTENT_TURNS, pushQuest, questsOf } from "../v2/card-game/want.mjs";
import { upgradeGreekDecreeSave } from "../v2/card-game/legacy-saves.mjs";
import { greekTravelTargets } from "./helpers/greek-travel.mjs";
import { openingFixture } from "./helpers/greek-opening.mjs";
import { sailTo } from "./helpers/voyage.mjs";
import { courseOptions } from "../v2/card-game/pack-transport.mjs";

const pack = packDefinition("greek-drama");
const GATE = "greek-gate",
  FIELD = "greek-battlefield",
  GUARD = "greek-guard";
const reload = (s) => decodeSave(encodeSave(s));
function act(s, kind, fields = {}) {
  const action = legalActions(s).find(
    (a) =>
      a.kind === kind &&
      !a.guards &&
      (kind !== "wait" || !a.sleep) &&
      Object.entries(fields).every(([k, v]) => a[k] === v),
  );
  expect(action, `${kind} ${JSON.stringify(fields)}`).toBeTruthy();
  const done = play(s, action, s.revision);
  expect(done.ok, done.error).toBe(true);
  return done.state;
}
const walk = (s, ...ids) =>
  ids.reduce(
    (w, id) =>
      greekTravelTargets(w.actors.vale.place, `greek-${id}`).reduce(
        (x, target) => act(x, "move", { target }),
        w,
      ),
    s,
  );
const take = (s, item) => act(s, "take", { item });
const out = (s) => exits(s, GATE, "vale").includes(FIELD);
const locked = (s, id) => s.usedUp.includes(id);
const ids = (s) => Object.keys(s.items).sort();
// Hand a thing to Vale where it lies, as a long errand would have.
const fetched = (s, id) => {
  s = structuredClone(s);
  s.items[id].holder = "vale";
  return reload(s);
};

describe("Dione's bread", () => {
  it("bakes from the returned jar and her own wheat, then sends each home", () => {
    const states = openingFixture("burial");
    let s = states.waterOffer;
    // Locked at her courtyard, the box names who makes it from what.
    expect(locked(s, "greek-bread")).toBe(true);
    expect(availableCards(s)).toContain("greek-bread");
    expect(sealedReason(s, "greek-bread")).toBe(
      "Dione the Baker consumes the Water Jar and the Sack of Wheat",
    );
    // Dione starts with the wheat; its home is far away at Piraeus.
    expect(s.items["greek-wheat"].holder).toBe("greek-baker");
    expect(pack.items["greek-wheat"].home).toBe("greek-piraeus");
    s = states.water;
    expect(locked(s, "greek-bread")).toBe(false);
    expect(s.items["greek-bread"].holder).toBe("greek-courtyard");
    expect(sealedReason(s, "greek-bread")).toBe(null);
    // The jar is back at the well at once, and the wheat at Piraeus, not
    // with Dione.
    expect(s.items["greek-water-jar"].holder).toBe("greek-well");
    expect(s.items["greek-wheat"].holder).toBe("greek-piraeus");
    expect(ids(s)).toEqual(ids(states.waterOffer));
    expect(reload(s).items).toEqual(s.items);
  });

  it("is eaten by whoever holds it and goes home locked", () => {
    let s = take(
      walk(openingFixture("burial").water, "courtyard"),
      "greek-bread",
    );
    const eat = cardActions(s, ["greek-bread"]).actions[0];
    expect(eat).toMatchObject({ kind: "eat", item: "greek-bread" });
    s = act(s, "eat", { item: "greek-bread", target: null });
    expect(locked(s, "greek-bread")).toBe(true);
    expect(s.items["greek-bread"]).toEqual({
      holder: "greek-courtyard",
      history: [],
    });
    expect(s.log.at(-1)).toMatchObject({ verb: "eat", itemId: "greek-bread" });
  });
});

describe("the guard and the decree", () => {
  it("guards while holding the Gate Decree and returns when the order returns", () => {
    const states = openingFixture("concession");
    let s = states.decree;
    expect(s.items["greek-decree"].holder).toBe(GUARD);
    expect(s.items["greek-creon-writ"].holder).toBe("greek-creon");
    expect(out(s)).toBe(false);
    // The card beyond is locked; its reason names him and gives no quest.
    expect(availableCards(s)).toContain(FIELD);
    expect(sealedReason(s, FIELD)).toBe("The Gate Guard is guarding this card");
    expect(legalActions(s).some((a) => a.kind === "gate")).toBe(false);
    // Talk with him gives his quest: bring him the bread.
    const talked = act(s, "talk", { target: GUARD });
    expect(questsOf(talked, "vale")).toContainEqual(
      expect.objectContaining({
        kind: "item",
        target: "greek-bread",
        step: { verb: "give", to: GUARD },
      }),
    );
    // He trades the decree for the bread, eats it, and leaves duty.
    s = states.traded;
    expect(s.items["greek-decree"].holder).toBe("vale");
    expect(locked(s, "greek-bread")).toBe(true);
    expect(s.actors[GUARD].want).toBe(null);
    expect(out(s)).toBe(true);
    // The decree buys Creon's writ; the writ in his hands, he stands aside.
    s = states.opened;
    expect(s.items["greek-creon-writ"].holder).toBe(GUARD);
    expect(out(s)).toBe(true);
    expect(sealedReason(s, FIELD)).toBe(null);
    expect(s.openedRoutes ?? []).not.toContain(`${GATE}>${FIELD}`);
    // He keeps the writ when asked.
    expect(
      act(s, "ask", { item: "greek-creon-writ", target: GUARD }).items[
        "greek-creon-writ"
      ].holder,
    ).toBe(GUARD);
    // The returned Gate Decree puts him back on duty.
    const lost = structuredClone(s);
    lost.items["greek-creon-writ"].holder = "greek-gate";
    lost.items["greek-decree"].holder = GUARD;
    s = act(reload(lost), "wait");
    expect(out(s)).toBe(false);
    const field = structuredClone(s);
    field.actors.vale.place = FIELD;
    expect(exits(reload(field), FIELD, "vale")).not.toContain(GATE);
  });

  it("yields the gate to a fight when the bread is gone", () => {
    // Vale eats the bread; the wheat is at Piraeus. Beating the guard at
    // his post is the way out (rules 100), and the decree falls to the
    // winner's reach.
    let s = take(
      walk(openingFixture("burial").water, "courtyard"),
      "greek-bread",
    );
    s = walk(act(s, "eat", { item: "greek-bread", target: null }), "gate");
    expect(locked(s, "greek-bread")).toBe(true);
    expect(s.items["greek-wheat"].holder).toBe("greek-piraeus");
    expect(out(s)).toBe(false);
    s = act(s, "threaten", { target: GUARD });
    for (let i = 0; i < 24 && s.actors[GUARD].place === GATE; i++) {
      const strike = legalActions(s).find(
        (a) => a.kind === "attack" && a.target === GUARD,
      );
      const done = play(s, strike || legalActions(s)[0], s.revision);
      expect(done.ok, done.error).toBe(true);
      s = done.state;
    }
    for (let i = 0; i < 6 && s.standoffs.length; i++) s = act(s, "wait");
    expect(s.actors[GUARD].place).not.toBe(GATE);
    expect(out(s)).toBe(true);
    // With the wheat fetched home, the loop starts again.
    s = act(walk(s, "courtyard"), "drop", {
      item: "lamp",
      target: "greek-courtyard",
    });
    s = fetched(fetched(s, "greek-water-jar"), "greek-wheat");
    s = act(s, "give", { item: "greek-water-jar", target: "greek-baker" });
    s = act(s, "give", { item: "greek-wheat", target: "greek-baker" });
    expect(locked(s, "greek-bread")).toBe(false);
  });

  it("joins the regular want system once fed", () => {
    let s = openingFixture("burial").traded;
    for (let i = 0; i <= CONTENT_TURNS && !s.actors[GUARD].want; i++)
      s = act(s, "wait");
    const want = s.actors[GUARD].want;
    expect(want).toBeTruthy();
    expect(want.step?.verb).not.toBe("eat");
  });

  it("buys Creon's writ, and Creon's grant commits", () => {
    const s = openingFixture("concession").permission;
    expect(s.items["greek-decree"].holder).toBe("greek-creon");
    expect(s.items["greek-creon-writ"].holder).toBe("vale");
    expect(s.packs["greek-drama"].choices["greek-theban-response"]).toBe(
      "concession",
    );
    expect(s.packs["greek-drama"].receipts).toHaveProperty(
      "greek-petition-burial",
    );
  });

  it("bakes a second bread from wheat brought home", () => {
    let s = openingFixture("burial").traded;
    s = act(walk(s, "courtyard"), "drop", {
      item: "greek-decree",
      target: "greek-courtyard",
    });
    s = fetched(fetched(s, "greek-water-jar"), "greek-wheat");
    s = act(s, "give", { item: "greek-water-jar", target: "greek-baker" });
    expect(locked(s, "greek-bread")).toBe(true);
    s = act(s, "give", { item: "greek-wheat", target: "greek-baker" });
    expect(locked(s, "greek-bread")).toBe(false);
    expect(s.items["greek-bread"].holder).toBe("greek-courtyard");
    expect(s.items["greek-water-jar"].holder).toBe("greek-well");
    expect(s.items["greek-wheat"].holder).toBe("greek-piraeus");
  });
});

describe("eat and drink quests", () => {
  // The wine skin lies at the gate, its home; Antigone waits there too.
  const atGate = () => take(openingFixture("burial").decree, "greek-wine-skin");

  it("reads Drink for a drink and shares only with a willing companion", () => {
    let s = atGate();
    const alone = legalActions(s).find(
      (a) => a.kind === "eat" && a.item === "greek-wine-skin" && !a.target,
    );
    expect(cardActions(s, ["greek-wine-skin"]).actions[0].key).toBe(alone.key);
    const pair = ["greek-wine-skin", "greek-antigone"];
    expect(cardActions(s, pair).actions.map((a) => a.kind)).toEqual(["give"]);
    expect(
      cardActions(s, ["vale", ...pair]).actions.map((a) => a.kind),
    ).toEqual(["eat"]);
    // A stranger declines; nothing is drunk.
    s = act(s, "eat", { item: "greek-wine-skin", target: "greek-antigone" });
    expect(s.items["greek-wine-skin"].holder).toBe("vale");
    expect(s.log.at(-1)).toMatchObject({ accepted: false });
    // Trusted, she shares it, and it goes home to the gate.
    s = structuredClone(s);
    s.actors["greek-antigone"].trust.vale = 1;
    s = act(reload(s), "eat", {
      item: "greek-wine-skin",
      target: "greek-antigone",
    });
    expect(s.items["greek-wine-skin"].holder).toBe(GATE);
  });

  it("meets an eat quest only with the named companion at the named place", () => {
    const quest = (s, step) =>
      pushQuest(s, "vale", {
        kind: "item",
        target: "greek-wine-skin",
        since: s.turn,
        refusals: 0,
        story: true,
        step: { verb: "eat", ...step },
      });
    const met = (s) => !questsOf(s, "vale").some((w) => w.step?.verb === "eat");
    // With Antigone: drinking alone does not meet it.
    let s = structuredClone(atGate());
    s.actors["greek-antigone"].trust.vale = 1;
    quest(s, { with: "greek-antigone" });
    s = reload(s);
    expect(met(act(s, "eat", { item: "greek-wine-skin", target: null }))).toBe(
      false,
    );
    expect(
      met(act(s, "eat", { item: "greek-wine-skin", target: "greek-antigone" })),
    ).toBe(true);
    // At the courtyard: drinking at the gate does not meet it.
    s = structuredClone(atGate());
    quest(s, { at: "greek-courtyard" });
    s = reload(s);
    expect(met(act(s, "eat", { item: "greek-wine-skin", target: null }))).toBe(
      false,
    );
    s = act(walk(s, "courtyard"), "eat", {
      item: "greek-wine-skin",
      target: null,
    });
    expect(met(s)).toBe(true);
    // Absent, a companion is not offered.
    s = walk(atGate(), "courtyard");
    expect(
      legalActions(s).some(
        (a) => a.kind === "eat" && a.target === "greek-antigone",
      ),
    ).toBe(false);
    // The step shape the owner asked for: wine with Pip (the moth) aboard
    // the ship.
    s = structuredClone(atGate());
    quest(s, { with: "moth", at: "greek-ship" });
    expect(questsOf(reload(s), "vale").find((w) => w.step?.verb === "eat").step).toEqual({
      verb: "eat",
      with: "moth",
      at: "greek-ship",
    });
  });
});

describe("the Charybdis's provisions", () => {
  // Bread, figs and wine laid on the quay become the provisions.
  // A world from the fixture has its provisions stowed; lock them again.
  const relock = (s) => {
    s = structuredClone(s);
    s.items["greek-provisions"] = { holder: "greek-harbor", history: [] };
    s.usedUp = [...new Set([...s.usedUp, "greek-provisions"])].sort();
    return reload(s);
  };
  function pack3(s) {
    for (const id of ["greek-bread", "greek-figs", "greek-wine-skin"])
      s = act(fetched(s, id), "drop", { item: id, target: "greek-harbor" });
    return s;
  }
  it("are made at the harbour, sail, stay aboard and go home locked when eaten", () => {
    let s = walk(relock(openingFixture("exposure").water), "harbor");
    expect(locked(s, "greek-provisions")).toBe(true);
    expect(sealedReason(s, "greek-provisions")).toBe(
      "Myrto the Shipmaster consumes the Courtyard Bread, the Dried Figs and the Wine Skin",
    );
    s = pack3(s);
    expect(locked(s, "greek-provisions")).toBe(false);
    expect(s.items["greek-provisions"].holder).toBe("greek-harbor");
    expect(locked(s, "greek-bread")).toBe(true);
    expect(s.items["greek-figs"].holder).toBe("greek-sanctuary");
    expect(s.items["greek-wine-skin"].holder).toBe(GATE);
    // Carried aboard they are not enough; laid on deck they open the voyage
    // out, and sailing uses nothing.
    s = act(take(s, "greek-provisions"), "move", { target: "greek-ship" });
    expect(courseOptions(s, "greek-ship", "vale")).not.toContain(
      "greek-piraeus",
    );
    // Piraeus lies in the hand as a locked card; the context button says why.
    expect(availableCards(s)).toContain("greek-piraeus");
    expect(sealedReason(s, "greek-piraeus")).toBe(
      "Put the Travel Provisions down on deck",
    );
    expect(cardPlay(s, ["greek-piraeus"]).action).toBeFalsy();
    expect(cardPlay(s, ["greek-piraeus"]).hint).toBe(
      "Put the Travel Provisions down on deck",
    );
    s = act(s, "drop", { item: "greek-provisions", target: "greek-ship" });
    expect(courseOptions(s, "greek-ship", "vale")).toContain("greek-piraeus");
    expect(sealedReason(s, "greek-piraeus")).toBe(null);
    s = sailTo(s, "greek-piraeus");
    s = act(s, "move", { target: "greek-ship" });
    // Docked at Piraeus they still lie on deck; eaten there, they go home
    // locked, and the ship still sails home.
    expect(s.items["greek-provisions"].holder).toBe("greek-ship");
    s = take(s, "greek-provisions");
    s = act(s, "eat", { item: "greek-provisions", target: null });
    expect(locked(s, "greek-provisions")).toBe(true);
    expect(s.items["greek-provisions"].holder).toBe("greek-harbor");
    s = sailTo(s, "greek-harbor");
    expect(s.actors.vale.place).toBe("greek-harbor");
  });

  it("share the one bread with the guard: land first, then sea", () => {
    // Land: the first bread buys the decree, the decree the writ, and the
    // writ opens the gate.
    let s = openingFixture("concession", { reportFirst: false }).opened;
    expect(out(s)).toBe(true);
    // The wheat from Piraeus and the jar from the well bake the second.
    s = walk(s, "courtyard");
    s = fetched(fetched(s, "greek-water-jar"), "greek-wheat");
    s = act(s, "give", { item: "greek-water-jar", target: "greek-baker" });
    s = act(s, "give", { item: "greek-wheat", target: "greek-baker" });
    expect(locked(s, "greek-bread")).toBe(false);
    // Sea: the second bread goes into the provisions.
    s = pack3(walk(relock(s), "harbor"));
    expect(locked(s, "greek-provisions")).toBe(false);
    expect(locked(s, "greek-bread")).toBe(true);
    expect(out(s)).toBe(true);
  });

  it("share the one bread with the guard: sea first, then land", () => {
    let s = pack3(walk(relock(openingFixture("exposure").water), "harbor"));
    expect(locked(s, "greek-bread")).toBe(true);
    s = act(take(s, "greek-provisions"), "move", { target: "greek-ship" });
    s = act(s, "drop", { item: "greek-provisions", target: "greek-ship" });
    s = sailTo(s, "greek-piraeus");
    // The wheat is at Piraeus; Vale carries it home on the free return.
    s = act(take(s, "greek-wheat"), "move", { target: "greek-ship" });
    s = sailTo(s, "greek-harbor");
    // The provisions, never eaten, still lie whole on deck.
    expect(locked(s, "greek-provisions")).toBe(false);
    expect(s.items["greek-provisions"].holder).toBe("greek-ship");
    s = walk(s, "well");
    s = take(s, "greek-water-jar");
    s = walk(s, "courtyard");
    s = act(s, "give", { item: "greek-water-jar", target: "greek-baker" });
    s = act(s, "give", { item: "greek-wheat", target: "greek-baker" });
    expect(locked(s, "greek-bread")).toBe(false);
    // The second bread buys the decree, the decree the writ, and the writ
    // opens the gate.
    s = walk(take(s, "greek-bread"), "gate");
    expect(out(s)).toBe(false);
    s = act(s, "trade", { item: "greek-bread", receive: "greek-decree" });
    expect(locked(s, "greek-bread")).toBe(true);
    expect(out(s)).toBe(true);
    s = act(walk(s, "palace"), "trade", {
      item: "greek-decree",
      receive: "greek-creon-writ",
    });
    s = act(walk(s, "gate"), "give", {
      item: "greek-creon-writ",
      target: GUARD,
    });
    expect(out(s)).toBe(true);
  });
});

describe("the revision 20 upgrade", () => {
  it("forgets a shared world's latch on the gate", () => {
    const s = structuredClone(openingFixture("burial").waterOffer);
    s.packs["greek-drama"].revision = 19;
    s.openedRoutes = [`${GATE}>${FIELD}`];
    upgradeGreekDecreeSave(s);
    expect(s.openedRoutes).toBeUndefined();
    expect(s.packs["greek-drama"].revision).toBe(20);
  });
});
