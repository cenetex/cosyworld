import { expect, it, vi } from "vitest";
import "./helpers/still-cast.mjs";
vi.mock("../v2/card-game/packs.json", async (original) => {
  const compiled = structuredClone((await original()).default);
  const { sampleSource } = await import("../v2/card-game/authoring-sample.mjs");
  const { pack, bridge } = sampleSource();
  compiled.packs.push({
    ...pack,
    bridge: { id: bridge.id, description: bridge.description },
    crossings: bridge.crossings,
  });
  return { default: compiled };
});
import {
  createWorld,
  decodeSave,
  encodeSave,
  legalActions,
  placeOffer,
  play,
  validateWorld,
} from "../v2/card-game/world.mjs";
import { heldOf, newWant } from "../v2/card-game/want.mjs";
import { offerCard } from "../v2/card-game/quest-card.mjs";
import { cardLevel } from "../v2/card-game/rarity.mjs";
import { transports } from "../v2/card-game/pack-registry.mjs";
import { useUp } from "../v2/card-game/item-use.mjs";
import { knowsFact, placeFactId, protectedFact } from "../v2/card-game/knowledge.mjs";

const STATION = "sample-station",
  SHORE = "sample-shore",
  SCARF = "sample-scarf",
  FROM = `quest:place:${STATION}`;
const act = (s, kind, fields = {}) => {
  const action = legalActions(s).find(
    (a) => a.kind === kind && Object.entries(fields).every(([k, v]) => a[k] === v),
  );
  expect(action, JSON.stringify({ kind, ...fields })).toBeTruthy();
  const done = play(s, action, s.revision);
  expect(done.ok, done.error).toBe(true);
  return decodeSave(encodeSave(done.state));
};
const sources = (s) => heldOf(s.actors.vale).map((w) => w.from);
const atStation = () => {
  let s = createWorld();
  s.actors.vale.place = "pond";
  s = act(s, "move", { target: SHORE });
  s = act(s, "take", { item: "sample-bell" });
  return act(s, "move", { target: STATION });
};
const scarfAway = () => {
  let s = act(atStation(), "take", { item: SCARF });
  s = act(s, "move", { target: SHORE });
  s = act(s, "drop", { item: SCARF });
  return act(s, "move", { target: STATION });
};

it("asks for nothing while what lay there at the start is still there or in hand", () => {
  const s = atStation();
  expect(placeOffer(s)).toBeNull();
  expect(placeOffer(act(s, "take", { item: SCARF }))).toBeNull();
  expect(legalActions(s).some((a) => a.kind === "accept" && a.place)).toBe(false);
});

it("asks for its own thing back once it lies elsewhere", () => {
  const s = scarfAway();
  expect(placeOffer(s)).toMatchObject({
    id: FROM,
    kind: "place",
    source: STATION,
    full: false,
    want: { kind: "place", target: STATION, story: true, step: { verb: "lay", items: [SCARF] } },
  });
  expect(offerCard(s, "vale", STATION)).toMatchObject({ offer: STATION, place: true, full: false });
  expect(sources(act(s, "wait"))).toEqual([]);
});

it("holds the place's quest on Accept and levels the place when the thing is laid there", () => {
  const s = scarfAway();
  expect(cardLevel(s, STATION)).toBe(1);
  const held = act(s, "accept", { place: STATION });
  expect(held.turn).toBe(s.turn);
  expect(sources(held)).toEqual([FROM]);
  expect(placeOffer(held)).toBeNull();
  let back = act(held, "move", { target: SHORE });
  back = act(back, "take", { item: SCARF });
  back = act(back, "move", { target: STATION });
  expect(sources(back)).toEqual([FROM]);
  const laid = act(back, "drop", { item: SCARF });
  expect(sources(laid)).toEqual([]);
  expect(laid.placeMet).toEqual({ [STATION]: [SCARF] });
  expect(laid.log.findLast((e) => e.verb === "want_met")).toMatchObject({ actorId: "vale", ownerId: STATION });
  expect(cardLevel(laid, STATION)).toBe(2);
  expect(cardLevel(laid, SHORE)).toBe(1);
  let again = act(laid, "take", { item: SCARF });
  again = act(again, "move", { target: SHORE });
  again = act(again, "drop", { item: SCARF });
  expect(placeOffer(act(again, "move", { target: STATION }))).toBeNull();
});

it("never names a thing a resident wants", () => {
  const s = scarfAway();
  delete s.placeCard;
  s.actors["sample-keeper"].want = newWant("item", SCARF, s.turn);
  expect(placeOffer(s)).toBeNull();
});

it("asks only for a thing that lies loose, not one held, boxed or aboard", () => {
  const ship = Object.values(transports)[0].place;
  for (const at of ["sample-keeper", "vale", "sample-bell", ship]) {
    const s = scarfAway();
    delete s.placeCard;
    s.actors["sample-keeper"].place = SHORE;
    s.items["sample-bell"].holder = SHORE;
    s.items[SCARF].holder = at;
    expect(placeOffer(s), at).toBeNull();
  }
});

const metNow = (s) => s.log.filter((e) => e.verb === "want_met" && e.turn === s.turn);
it("keeps its card through the pickup, and the one who lays the thing back levels the place", () => {
  let s = scarfAway();
  expect(s.placeCard).toEqual({ [STATION]: SCARF });
  s = act(act(s, "move", { target: SHORE }), "take", { item: SCARF });
  expect(s.placeCard).toEqual({ [STATION]: SCARF });
  s = act(s, "move", { target: STATION });
  expect(placeOffer(s).want.step.items).toEqual([SCARF]);
  const laid = act(s, "drop", { item: SCARF });
  expect(laid.placeCard).toBeUndefined();
  expect(laid.placeMet).toEqual({ [STATION]: [SCARF] });
  expect(metNow(laid)).toEqual([expect.objectContaining({ actorId: "vale", ownerId: STATION })]);
  expect(cardLevel(laid, STATION)).toBe(2);
});

it("completes a taken copy once, with the place's card", () => {
  let s = act(scarfAway(), "accept", { place: STATION });
  s = act(act(act(s, "move", { target: SHORE }), "take", { item: SCARF }), "move", { target: STATION });
  const laid = act(s, "drop", { item: SCARF });
  expect(sources(laid)).toEqual([]);
  expect(laid.placeCard).toBeUndefined();
  expect(metNow(laid).map((e) => [e.actorId, e.ownerId])).toEqual([["vale", STATION]]);
});

it("lets its card go with no level when the thing is used up", () => {
  const s = scarfAway();
  useUp(s, SCARF, STATION);
  const after = act(s, "wait");
  expect(after.placeCard).toBeUndefined();
  expect(after.placeMet).toBeUndefined();
  expect(metNow(after)).toEqual([]);
});

it("keeps only a place's own thing, not yet laid back, as its card", () => {
  const s = createWorld();
  s.placeCard = { [STATION]: SCARF };
  expect(() => validateWorld(s)).not.toThrow();
  for (const bad of [{}, { [SHORE]: SCARF }, { [STATION]: "sample-bell-nowhere" }]) {
    s.placeCard = bad;
    expect(() => validateWorld(s)).toThrow();
  }
  s.placeCard = { [STATION]: SCARF };
  s.placeMet = { [STATION]: [SCARF] };
  expect(() => validateWorld(s)).toThrow();
});

it("keeps only things that lay at that place in its record", () => {
  const s = createWorld();
  s.placeMet = { [STATION]: [SCARF] };
  expect(() => validateWorld(s)).not.toThrow();
  s.placeMet = { [SHORE]: [SCARF] };
  expect(() => validateWorld(s)).toThrow();
  s.placeMet = {};
  expect(() => validateWorld(s)).toThrow();
});

it("teaches its card to a player who plays while standing in it, not on arrival", () => {
  const id = placeFactId(STATION, SCARF);
  const s = scarfAway();
  expect(knowsFact(s, "vale", id)).toBe(false);
  const stood = act(s, "wait");
  expect(stood.knowledge.facts[id]).toMatchObject({
    text: "The Keeper's Station wants Blue scarf back.",
    source: { kind: "quest", actorId: STATION, locationId: STATION, witnesses: ["vale"] },
  });
  expect(stood.knowledge.known.vale[id]).toMatchObject({ kind: "witnessed", teller: null });
  expect(protectedFact(stood.knowledge.facts[id], stood)).toBe(true);
  let laid = act(act(act(stood, "move", { target: SHORE }), "take", { item: SCARF }), "move", { target: STATION });
  laid = act(laid, "drop", { item: SCARF });
  expect(protectedFact(laid.knowledge.facts[id], laid)).toBe(false);
  expect(cardLevel(laid, STATION)).toBe(2);
});
