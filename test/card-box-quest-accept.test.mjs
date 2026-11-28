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
  boxOffer,
  createWorld,
  decodeSave,
  encodeSave,
  legalActions,
  play,
  residentOffer,
} from "../v2/card-game/world.mjs";
import { MAX_HELD, heldOf, holdQuest, newWant } from "../v2/card-game/want.mjs";
import { offerCard } from "../v2/card-game/quest-card.mjs";
import { lockedQuest } from "../v2/card-game/locked-box.mjs";

const BOX = "sample-garden",
  KEEPER = "sample-keeper",
  FROM = `quest:box:${BOX}`;
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
const arrive = () => {
  let s = createWorld();
  s.actors.vale.place = "pond";
  s = act(s, "move", { target: "sample-shore" });
  s = act(s, "take", { item: "sample-bell" });
  return act(s, "move", { target: "sample-station" });
};

it("holds nothing on arriving where a shut box lies", () => {
  const s = arrive();
  expect(sources(s)).toEqual([]);
  expect(sources(act(s, "wait"))).toEqual([]);
  expect(boxOffer(s, BOX)).toMatchObject({ id: FROM, full: false });
  expect(lockedQuest(s, BOX, () => true).text).toBeTruthy();
});

it("holds a box's quest on Accept, in no time, and drops it when the box opens", () => {
  const s = arrive();
  expect(offerCard(s, "vale", BOX)).toMatchObject({ offer: BOX, box: true, full: false });
  const held = act(s, "accept", { box: BOX });
  expect(held.turn).toBe(s.turn);
  expect(sources(held)).toEqual([FROM]);
  expect(boxOffer(held, BOX)).toBeNull();
  expect(legalActions(held).some((a) => a.kind === "accept")).toBe(false);
  const open = act(held, "give", { item: "sample-bell", target: KEEPER });
  expect(sources(open)).toEqual([]);
  expect(open.opened[BOX]).toEqual(["vale"]);
});

it("credits opening a box whose quest was never taken", () => {
  const open = act(arrive(), "give", { item: "sample-bell", target: KEEPER });
  expect(open.opened[BOX]).toEqual(["vale"]);
});

it("leaves the slots free for a resident's offer after Talk", () => {
  const told = act(arrive(), "talk", { target: KEEPER });
  expect(residentOffer(told, "vale", KEEPER)).toMatchObject({ source: KEEPER, full: false });
  expect(sources(act(told, "accept", { target: KEEPER }))).toEqual([`quest:from:${KEEPER}`]);
});

it("offers no Accept for a box when the slots are full, and keeps an old held one", () => {
  const s = arrive();
  for (const [i, place] of ["pond", "sample-shore", "sample-station"].entries())
    holdQuest(s, "vale", newWant("place", place, s.turn), i ? `quest:x:${i}` : FROM);
  expect(heldOf(s.actors.vale)).toHaveLength(MAX_HELD);
  expect(boxOffer(s, BOX)).toMatchObject({ full: true });
  expect(legalActions(s).some((a) => a.kind === "accept")).toBe(false);
  expect(sources(act(s, "wait"))).toContain(FROM);
});
