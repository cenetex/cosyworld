import { describe, it, expect } from "vitest";
import {
  availableCards,
  cardActions,
  playLabel,
} from "../v2/card-game/cards.mjs";
import {
  createWorld,
  encodeSave,
  legalActions,
  play,
} from "../v2/card-game/world.mjs";

function meeting() {
  const world = createWorld();
  world.actors.moth.place = "station";
  world.items.lamp.holder = "vale";
  return world;
}
const kinds = (world, cards) =>
  cardActions(world, cards).actions.map((a) => a.kind);
function primary(world, cards) {
  const offer = cardActions(world, cards).actions[0];
  expect(offer).toBeTruthy();
  expect(legalActions(world)).toContainEqual(offer);
  expect(cardActions(world, [...cards].reverse()).actions).toEqual(
    cardActions(world, cards).actions,
  );
  return offer;
}
describe("named card actions", () => {
  it("routes talk to a person and a threat to Vale plus that person", () => {
    let world = meeting();
    const before = encodeSave(world);
    expect(kinds(world, ["moth"])).toEqual(["talk"]);
    const threat = primary(world, ["vale", "moth"]);
    expect(threat.kind).toBe("threaten");
    expect(playLabel(threat)).toBe("Threaten Pip for Black cloth");
    expect(encodeSave(world)).toBe(before);
    const result = play(world, threat);
    expect(result.ok).toBe(true);
    world = result.state;
    expect(kinds(world, ["moth"])).toEqual(["talk"]);
    expect(kinds(world, ["vale", "moth"])).toEqual(["guard", "attack"]);
    expect(kinds(world, ["vale"])).toEqual(["wait", "guard"]);
  });
  it("names the recipient, owner, trade items and invited person", () => {
    const world = meeting();
    expect(playLabel(primary(world, ["lamp", "moth"]))).toBe("Give to Pip");
    expect(playLabel(primary(world, ["cloth"]))).toBe(
      "Ask Pip for Black cloth",
    );
    expect(primary(world, ["cloth", "moth"]).kind).toBe("ask");
    expect(playLabel(primary(world, ["lamp", "cloth"]))).toBe(
      "Trade Lamp for Black cloth",
    );
    expect(playLabel(primary(world, ["moth", "pond"]))).toBe(
      "Invite Pip along",
    );
    expect(playLabel(primary(world, ["lamp", "attic"]))).toBe(
      "Carry to Mirror attic",
    );
    expect(primary(world, ["vale", "attic"]).kind).toBe("move");
    expect(primary(world, ["lamp", "station"]).kind).toBe("drop");
  });
  it("supports use, refill, cover and uncover in either order", () => {
    const world = meeting();
    world.items.oil.holder = "vale";
    world.items.cloth.holder = "vale";
    expect(primary(world, ["vale", "lamp"]).kind).toBe("light");
    expect(primary(world, ["oil", "lamp"]).kind).toBe("refill");
    expect(primary(world, ["cloth", "lamp"]).kind).toBe("cover");
    world.items.cloth.holder = "lamp";
    expect(playLabel(primary(world, ["cloth", "lamp"]))).toBe("Uncover");
    world.items.lamp.holder = "station";
    world.items.cloth.holder = "vale";
    expect(primary(world, ["lamp", "station"]).kind).toBe("light");
    world.items.lamp.lit = true;
    expect(primary(world, ["lamp", "station"]).kind).toBe("snuff");
    expect(primary(world, ["bell", "station"]).kind).toBe("ring");
  });
  it("lists local fixtures and story choices alongside the basic play", () => {
    const world = createWorld();
    world.actors.vale.place = "clearing";
    const local = cardActions(world, ["clearing"]).actions;
    expect(local.map(playLabel)).toEqual(["Wait", "Ring the Steam Clock"]);
    world.actors.vale.place = "greek-gate";
    world.crossings["pond-greek-harbor"].discovered = true;
    const story = cardActions(world, ["greek-guard"]).actions;
    expect(story[0].kind).toBe("talk");
    expect(story.some((a) => a.kind === "choose")).toBe(true);
    for (const action of story)
      expect(legalActions(world)).toContainEqual(action);
  });
  it("keeps selections with no play free and provides a pairing hint", () => {
    const world = meeting(),
      before = encodeSave(world);
    for (const cards of [
      [],
      ["missing"],
      ["lamp", "bell"],
      ["vale", "lamp", "bell"],
    ]) {
      const result = cardActions(world, cards);
      expect(result.actions).toEqual([]);
      expect(result.hint).toBeTruthy();
    }
    expect(encodeSave(world)).toBe(before);
  });
  it("places carried and nested items directly after their holders", () => {
    const world = meeting();
    world.items.oil.holder = "vale";
    world.items.cloth.holder = "lamp";
    const cards = availableCards(world);
    expect(cards.slice(0, 5)).toEqual(["vale", "lamp", "cloth", "oil", "moth"]);
    expect(cards.indexOf("bell")).toBeGreaterThan(cards.indexOf("moth"));
    world.items.lamp.holder = "moth";
    const moved = availableCards(world);
    expect(
      moved.slice(moved.indexOf("moth"), moved.indexOf("moth") + 3),
    ).toEqual(["moth", "lamp", "cloth"]);
  });
});
