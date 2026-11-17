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
  expect(cardLevel(laid, STATION)).toBe(2);
  expect(cardLevel(laid, SHORE)).toBe(1);
  let again = act(laid, "take", { item: SCARF });
  again = act(again, "move", { target: SHORE });
  again = act(again, "drop", { item: SCARF });
  expect(placeOffer(act(again, "move", { target: STATION }))).toBeNull();
});

it("never asks for a thing a resident wants", () => {
  const s = scarfAway();
  s.actors["sample-keeper"].want = newWant("item", SCARF, s.turn);
  expect(placeOffer(s)).toBeNull();
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
