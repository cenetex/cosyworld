import { expect, it } from "vitest";
import { gone, usedUp } from "../v2/card-game/item-use.mjs";
import { packThings } from "../v2/card-game/pack-registry.mjs";
import { takes } from "../v2/card-game/world/arcana.mjs";
import {
  decodeSave,
  encodeSave,
  legalActions,
  play,
} from "../v2/card-game/world.mjs";
import { greekStart, traveler } from "./helpers/open-door.mjs";
import "./helpers/still-cast.mjs";

const BREAD = "greek-bread";
const PIPE = "willows-pipe";
const MARKET = "greek-acharnae";
const SUPPLY = "greek-acharnae-private-loaf-supply";
const LISTENER = "listener";
const PACK = "greek-drama";
const ACHARNIANS = "greek-story-aristophanes-acharnians";
const payments = ({ s }) =>
  legalActions(s).filter((a) => a.kind === "give" && a.target === LISTENER);
const supply = ({ s }) => legalActions(s).find((a) => a.choiceId === SUPPLY);

function at(t, place) {
  const vale = t.s.actors.vale;
  vale.place = place;
  if (!vale.visited.includes(place)) vale.visited.push(place);
  return t;
}

function breadAndListener() {
  const t = traveler(greekStart())
    .move("well")
    .take("water-jar")
    .move("courtyard")
    .give("water-jar", "baker")
    .take(BREAD);
  at(t, MARKET)
    .talk(`${ACHARNIANS}-first`)
    .take(`${ACHARNIANS}-object`)
    .give(`${ACHARNIANS}-object`, `${ACHARNIANS}-first`);

  t.s.actors.vale.arcana = { proved: [], did: [], calls: 3 };
  const room = t.s.actors[LISTENER].place;
  at(t, room)
    .act("talk", { target: LISTENER })
    .act("accept", { label: "Accept card" });
  t.act("drop", { item: BREAD, target: room });
  t.act("accept", { tarot: 0, label: "Turn over" })
    .act("accept", { tarot: 0, label: "Collect" })
    .take(BREAD);
  expect(takes(t.s, "vale")).toBe(true);
  return t;
}

it("protects the sole Bread from the Listener and still allows ordinary payment", () => {
  const t = breadAndListener();
  t.s.items[PIPE].holder = "vale";
  expect(payments(t).map((a) => a.item)).toContain(PIPE);
  expect(payments(t).map((a) => a.item)).not.toContain(BREAD);
  const stale = play(t.s, { key: `give:vale:${BREAD}:${LISTENER}` });
  expect(stale.ok).toBe(false);
  expect(stale.state).toBe(t.s);

  t.act("give", { item: PIPE, target: LISTENER });
  expect(gone(t.s, PIPE)).toBe(true);
  expect(t.s.items[BREAD].holder).toBe("vale");
  expect(usedUp(t.s, BREAD)).toBe(false);
  expect(t.s.log.findLast((event) => event.verb === "give")).toMatchObject({
    accepted: true,
    itemId: PIPE,
    listenerEvent: { kind: "offer", offer: "spread" },
  });
});

it("restores the supply path for Bread already surrendered in a revision 41 save", () => {
  const t = breadAndListener();
  const { tags } = packThings[BREAD];
  // Make the saved payment with the play that revision 41 allowed.
  packThings[BREAD].tags = tags.filter((tag) => tag !== "staple");
  try {
    t.act("give", { item: BREAD, target: LISTENER });
  } finally {
    packThings[BREAD].tags = tags;
  }
  const paid = t.s.log.findLast((event) => event.verb === "give");
  expect(paid).toMatchObject({ accepted: true, itemId: BREAD, gone: [BREAD] });
  expect(gone(t.s, BREAD)).toBe(true);
  at(t, MARKET);
  expect(supply(t)).toBeUndefined();

  t.s.packs[PACK].revision = 41;
  t.s = decodeSave(JSON.stringify(t.s));
  expect(gone(t.s, BREAD)).toBe(false);
  expect(usedUp(t.s, BREAD)).toBe(true);
  expect(t.s.log.find((event) => event.seq === paid.seq)).toEqual(paid);
  expect(supply(t)?.kind).toBe("choose");
  t.act("choose", { choiceId: SUPPLY }).take(BREAD);
  expect(t.s.items[BREAD].holder).toBe("vale");
  expect(t.s.packs[PACK].receipts[SUPPLY]).toBe(t.s.turn - 1);
  expect(decodeSave(encodeSave(t.s))).toEqual(t.s);
});
