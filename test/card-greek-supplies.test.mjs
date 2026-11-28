import { describe, expect, it } from "vitest";
import { cardPlay } from "../v2/card-game/cards.mjs";
import { dispatchShared } from "../v2/card-game/shared-world.mjs";
import { knowsLane } from "../v2/card-game/pack-transport.mjs";
import {
  itemCopies,
  packGiveChoice,
  packThings,
} from "../v2/card-game/pack-registry.mjs";
import {
  decodeSave,
  encodeSave,
  legalActions,
} from "../v2/card-game/world.mjs";
import { greekStart, traveler } from "./helpers/open-door.mjs";
import { openGreekGate } from "./helpers/greek-gate.mjs";
import "./helpers/still-cast.mjs";

const PACK = "greek-drama";
const BREAD = "greek-bread";
const MARKET = "greek-acharnae";
const STALL = "greek-acharnae-stall";
const PUBLIC_LOAF = "greek-acharnae-trader-loaf";
const PRIVATE_LOAF = "greek-acharnae-private-loaf";
const PUBLIC_SUPPLY = `${PUBLIC_LOAF}-supply`;
const PRIVATE_SUPPLY = `${PRIVATE_LOAF}-supply`;
const ACHARNAE = "greek-story-aristophanes-acharnians";
const KNIGHTS = "greek-story-aristophanes-knights";
const KITCHEN_LOAF = `${KNIGHTS}-kitchen-hands-bread`;
const KITCHEN_SUPPLY = `${KITCHEN_LOAF}-supply`;
const HOUSE = "greek-demos-house";
const GATE = "greek-gate";
const GUARD = "greek-guard";
const DECREE = "greek-decree";
const HARBOR = "greek-harbor";
const MYRTO = "greek-shipmaster";
const FIGS = "greek-figs";
const WINE = "greek-wine-skin";
const PROVISIONS = "greek-provisions";
const WATER = "greek-water-jar";
const AULIS_WATER = "greek-aulis-waiting-tent-water";
const COURTYARD = "greek-courtyard";
const DIONE = "greek-baker";

function at(t, place) {
  const vale = t.s.actors.vale;
  vale.place = place;
  if (!vale.visited.includes(place)) vale.visited.push(place);
  return t;
}

const settle = (t, stem, branch) =>
  t
    .talk(`${stem}-first`)
    .take(`${stem}-object`)
    .give(`${stem}-object`, `${stem}-${branch}`);

const available = (t, choiceId) =>
  legalActions(t.s).find((a) => a.kind === "choose" && a.choiceId === choiceId);

const stock = (t, choiceId) => t.act("choose", { choiceId }).take(BREAD);

const revision40 = (state) => {
  const old = structuredClone(state);
  old.packs[PACK].revision = 40;
  return old;
};

describe("Greek supplies", () => {
  it("locks a direct supply choice for everyone in a shared battle room", () => {
    const t = settle(at(traveler(greekStart()), MARKET), ACHARNAE, "first");
    const { world } = dispatchShared({
      op: "create",
      save: encodeSave(t.s),
      seed: 21,
    });
    const present = ["vale", "mara", "ash"];
    for (const actor of ["mara", "ash"]) {
      world.actors[actor].place = MARKET;
      world.actors[actor].visited.push(MARKET);
    }
    const request = (world, op, actor, action) =>
      dispatchShared({ world, op, actor, present, claimed: present, action });
    const threat = request(world, "view", "mara").actions.find(
      (a) => a.kind === "threaten" && a.target === "vale",
    );
    expect(threat).toBeDefined();
    const battle = request(world, "play", "mara", threat);
    expect(battle.ok).toBe(true);
    expect(battle.world.standoffs).toHaveLength(1);

    for (const actor of ["vale", "ash"]) {
      const choice = request(world, "view", actor).actions.find(
        (a) => a.choiceId === PRIVATE_SUPPLY,
      );
      expect(choice?.label).toBe("Set out Bread");
      expect(request(battle.world, "view", actor).actions).not.toContainEqual(
        expect.objectContaining({ choiceId: PRIVATE_SUPPLY }),
      );
      const denied = request(battle.world, "play", actor, choice);
      expect(denied.ok).toBe(false);
      expect(denied.world.usedUp).toContain(BREAD);
      expect(denied.world.packs[PACK].receipts[PRIVATE_SUPPLY]).toBeUndefined();
    }
  });

  it("lets the guard accept Acharnae Bread for his ordinary want and for the decree", () => {
    const t = stock(
      settle(at(traveler(greekStart()), MARKET), ACHARNAE, "second").move(
        STALL,
      ),
      PUBLIC_SUPPLY,
    );
    expect(packThings[BREAD].name).toBe("Bread");

    at(t, GATE);
    expect(t.s.actors[GUARD].want?.target).toBe(BREAD);
    expect(t.s.actors[GUARD].want?.step?.verb).toBe("eat");

    const gift = t.fork().give(BREAD, GUARD);
    expect(
      gift.s.log.findLast(
        ({ verb, itemId }) => verb === "give" && itemId === BREAD,
      ),
    ).toMatchObject({
      targetId: GUARD,
      accepted: true,
    });
    const ate = () =>
      gift.s.log.some(
        (event) =>
          event.verb === "eat" &&
          event.actorId === GUARD &&
          event.itemId === BREAD,
      );
    for (let i = 0; i < 6 && !ate(); i++) gift.act("wait");
    expect(ate()).toBe(true);
    expect(gift.s.usedUp).toContain(BREAD);
    expect(gift.s.items[BREAD].holder).toBe(COURTYARD);

    t.trade(BREAD, GUARD, DECREE);
    expect(t.s.items[DECREE].holder).toBe("vale");
    expect(t.s.log.findLast(({ verb }) => verb === "trade")).toMatchObject({
      itemId: BREAD,
      targetId: GUARD,
    });
  });

  it("packs Bread into Myrto’s provisions before a second supplier can restock it", () => {
    const t = stock(
      settle(at(traveler(greekStart()), HOUSE), KNIGHTS, "second"),
      KITCHEN_SUPPLY,
    );
    t.move(
      "assembly",
      "athens",
      "road-athens-eleusis",
      "eleusis",
      "attic-farm",
      MARKET,
    );
    settle(t, ACHARNAE, "first");
    expect(t.s.items[BREAD].holder).toBe("vale");
    expect(available(t, PRIVATE_SUPPLY)).toBeUndefined();
    const onGround = t.fork().drop(BREAD);
    expect(onGround.s.items[BREAD].holder).toBe(MARKET);
    expect(available(onGround, PRIVATE_SUPPLY)).toBeUndefined();

    at(t, HARBOR);
    t.s.items[FIGS].holder = MYRTO;
    t.s.items[WINE].holder = MYRTO;
    expect(t.s.usedUp).toContain(PROVISIONS);
    t.drop(BREAD);

    const craft = t.s.log.findLast(({ verb }) => verb === "craft");
    expect(craft).toMatchObject({
      actorId: MYRTO,
      itemId: PROVISIONS,
      consumedIds: [BREAD, FIGS, WINE],
    });
    expect(t.s.log.find(({ seq }) => seq === craft.sourceSeq)).toMatchObject({
      verb: "drop",
      itemId: BREAD,
    });
    expect(t.s.usedUp).not.toContain(PROVISIONS);
    expect(t.s.usedUp).toContain(BREAD);
    expect(t.s.items[BREAD].holder).toBe(COURTYARD);

    t.s = decodeSave(encodeSave(t.s));
    expect(t.s.packs[PACK].receipts[KITCHEN_SUPPLY]).toBeGreaterThan(0);
    at(t, MARKET);
    expect(available(t, PRIVATE_SUPPLY)).toBeDefined();
    t.act("choose", { choiceId: PRIVATE_SUPPLY });
    expect(t.s.packs[PACK].receipts[PRIVATE_SUPPLY]).toBe(t.s.turn);
    expect(t.s.items[BREAD].holder).toBe(MARKET);
    t.take(BREAD);
    expect(cardPlay(t.s, [BREAD]).action).toMatchObject({
      kind: "eat",
      item: BREAD,
    });
    t.act("eat", { item: BREAD, target: null });
    expect(t.s.usedUp).toContain(BREAD);
    expect(t.s.items[BREAD].holder).toBe(COURTYARD);
    expect(available(t, PRIVATE_SUPPLY)).toBeUndefined();
  });

  it("keeps a valid old loaf in the traveler’s selected hand when Bread was used up", () => {
    const t = settle(at(traveler(greekStart()), HOUSE), KNIGHTS, "second");
    settle(at(t, MARKET), ACHARNAE, "first");
    const old = revision40(t.s);
    expect(old.usedUp).toContain(BREAD);
    old.items[KITCHEN_LOAF] = { holder: GUARD, history: [] };
    const held = {
      holder: "vale",
      history: [`Turn ${old.turn}: Dicaeopolis handed Vale the loaf.`],
    };
    old.items[PRIVATE_LOAF] = held;
    old.actors.vale.heldItem = PRIVATE_LOAF;

    t.s = decodeSave(JSON.stringify(old));
    expect(t.s.packs[PACK].revision).toBeGreaterThan(40);
    expect(t.s.usedUp).not.toContain(BREAD);
    expect(t.s.items[BREAD]).toEqual(held);
    expect(t.s.items[KITCHEN_LOAF]).toBeUndefined();
    expect(t.s.items[PRIVATE_LOAF]).toBeUndefined();
    expect(t.s.actors.vale.heldItem).toBe(BREAD);
    expect(available(t, PRIVATE_SUPPLY)).toBeUndefined();
    expect(decodeSave(encodeSave(t.s)).items[BREAD]).toEqual(held);
  });

  it("keeps live Bread custody and leaves an old loaf on a shelf as a local supply", () => {
    const t = settle(at(traveler(greekStart()), MARKET), ACHARNAE, "second");
    const old = revision40(t.move(STALL).s);
    old.items[PUBLIC_LOAF] = { holder: STALL, history: [] };

    const shelf = traveler(decodeSave(JSON.stringify(old)));
    expect(shelf.s.usedUp).toContain(BREAD);
    expect(shelf.s.items[BREAD].holder).toBe(COURTYARD);
    expect(shelf.s.items[PUBLIC_LOAF]).toBeUndefined();
    expect(available(shelf, PUBLIC_SUPPLY)).toBeDefined();

    old.items[PUBLIC_LOAF].holder = "vale";
    old.actors.vale.heldItem = PUBLIC_LOAF;
    old.usedUp = old.usedUp.filter((id) => id !== BREAD);
    old.items[BREAD] = {
      holder: GUARD,
      history: [`Turn ${old.turn}: The guard took the baker’s Bread.`],
    };
    const live = traveler(decodeSave(JSON.stringify(old)));
    expect(live.s.items[BREAD]).toEqual(old.items[BREAD]);
    expect(live.s.items[PUBLIC_LOAF]).toBeUndefined();
    expect(live.s.actors.vale.heldItem).not.toBe(BREAD);
    expect(available(live, PUBLIC_SUPPLY)).toBeUndefined();
  });

  it("keeps a revision 40 recipe’s account when its loaf retires", () => {
    const t = settle(at(traveler(greekStart()), HOUSE), KNIGHTS, "second");
    at(t, HARBOR);
    t.s.usedUp = t.s.usedUp.filter((id) => id !== BREAD);
    t.s.items[BREAD].holder = "vale";
    t.s.items[FIGS].holder = MYRTO;
    t.s.items[WINE].holder = MYRTO;
    t.drop(BREAD);
    const old = revision40(t.s);
    old.items[KITCHEN_LOAF] = { holder: HOUSE, history: [] };
    old.usedUp.push(KITCHEN_LOAF);
    const craft = old.log.findLast(({ verb }) => verb === "craft");
    const drop = old.log.find(({ seq }) => seq === craft.sourceSeq);
    drop.itemId = KITCHEN_LOAF;
    craft.consumedIds[0] = KITCHEN_LOAF;

    const world = decodeSave(JSON.stringify(old));
    const account = world.log.find(({ seq }) => seq === craft.seq);
    expect(account).toMatchObject({ text: craft.text, itemId: PROVISIONS });
    expect(account.verb).toBeUndefined();
    expect(account.consumedIds).toBeUndefined();
    expect(world.items[KITCHEN_LOAF]).toBeUndefined();
    expect(world.items[PROVISIONS]).toEqual(old.items[PROVISIONS]);
  });

  it("returns the offered Water to Dione and bakes with that exact portion", () => {
    expect(new Set(itemCopies(WATER))).toEqual(
      new Set([WATER, AULIS_WATER, "greek-lemnos-neoptolemus-water"]),
    );
    const aulis = "greek-aulis", pagasae = "greek-pagasae";
    const t = traveler(openGreekGate(greekStart())).move(pagasae);
    expect(knowsLane(t.s, "vale", pagasae, aulis)).toBe(false);
    for (let i = 0; i < 3 && !knowsLane(t.s, "vale", pagasae, aulis); i++)
      t.talk("pagasae-pilot");
    expect(knowsLane(t.s, "vale", pagasae, aulis)).toBe(true);
    t.move("scylla", aulis);
    expect(legalActions(t.s).some((a) => a.kind === "move" && a.target === GATE)).toBe(false);
    settle(t, "greek-story-euripides-iphigenia-at-aulis", "first").take(AULIS_WATER);
    t.move("scylla", pagasae, COURTYARD, "well").take(WATER).move(COURTYARD);
    expect(packThings[AULIS_WATER].type).toBe(WATER);
    expect(t.s.items[WATER].holder).toBe("vale");
    expect(t.s.items[AULIS_WATER].holder).toBe("vale");

    const wellWater = structuredClone(t.s.items[WATER]);
    const { action } = cardPlay(t.s, [AULIS_WATER, DIONE]);
    expect(action).toMatchObject({
      kind: "give",
      item: AULIS_WATER,
      target: DIONE,
    });
    expect(packGiveChoice(t.s, action)?.choiceId).toBe(
      "greek-return-water-jar",
    );
    t.give(AULIS_WATER, DIONE);

    const world = decodeSave(encodeSave(t.s));
    expect(world.packs[PACK].flags["greek-water-returned"]).toBe(true);
    expect(world.packs[PACK].receipts["greek-return-water-jar"]).toBe(
      world.turn,
    );
    expect(world.log.findLast(({ verb }) => verb === "craft")).toMatchObject({
      itemId: BREAD,
      consumedIds: [AULIS_WATER, "greek-wheat"],
    });
    expect(world.items[AULIS_WATER].holder).toBe("greek-aulis");
    expect(world.items[WATER]).toEqual(wellWater);
  });
});
