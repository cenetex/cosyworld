import { newWant } from "../v2/card-game/want.mjs";
import { atticOpening } from "./fixtures/card-attic-opening.mjs";
import { describe, expect, it } from "vitest";
import {
  play,
  legalActions,
  exits,
  encodeSave,
  decodeSave,
} from "../v2/card-game/world.mjs";
import { enableMotives } from "../v2/card-game/motives.mjs";
import { availableCards, cardPlay, sealedReason } from "../v2/card-game/cards.mjs";
import { isLockedBox } from "../v2/card-game/locked-box.mjs";
import { heldItem } from "../v2/card-game/held-item.mjs";
import { allQuestsOf } from "../v2/card-game/want.mjs";

function act(s, kind, target) {
  const action = legalActions(s).find(
    (a) =>
      a.kind === kind &&
      (!target || a.target === target || a.item === target),
  );
  expect(action, `${kind} ${target || ""}`).toBeTruthy();
  const result = play(s, action);
  expect(result.ok).toBe(true);
  return result.state;
}
function pond() {
  let s = enableMotives(atticOpening());
  s = act(act(s, "snuff"), "move", "pond");
  s.actors.moth.place = "attic";
  s.items.lamp.holder = "moth";
  s.items.bell.holder = "vale";
  s.actors.vale.heldItem = "bell";
  return s;
}
const open = () => pond();
const visible = (s) => exits(s, "pond", "vale").includes("clearing");
// The bridge's saved state for the pond's crossing into the clearing.
const crossing = (s) => s.crossings["pond-clearing"];

describe("the held Bell at Black pond", () => {
  it("opens only while this traveler holds the Bell, and stays a locked box otherwise", () => {
    const held = open();
    expect(heldItem(held, "vale")).toBe("bell");
    expect(visible(held)).toBe(true);
    expect(isLockedBox(held, "clearing")).toBe(false);
    expect(crossing(held)).toEqual({ discovered: false });
    const ground = open();
    ground.items.bell.holder = "pond";
    ground.actors.vale.heldItem = null;
    expect(visible(ground)).toBe(false);
    expect(availableCards(ground)).toContain("clearing");
    expect(isLockedBox(ground, "clearing")).toBe(true);
    expect(sealedReason(ground, "clearing")).toBe("Hold the Bell.");
    const carried = open();
    carried.items.lamp.holder = "vale";
    carried.actors.vale.heldItem = "lamp";
    expect(carried.items.bell.holder).toBe("vale");
    expect(visible(carried)).toBe(false);
    const npc = open();
    npc.actors.moth.place = "pond";
    npc.items.bell.holder = "moth";
    npc.actors.moth.heldItem = "bell";
    npc.actors.vale.heldItem = null;
    expect(visible(npc)).toBe(false);
    expect(exits(npc, "pond", "moth")).not.toContain("clearing");
    const other = open();
    other.actors.mara.place = "pond";
    other.items.bell.holder = "mara";
    other.actors.mara.heldItem = "bell";
    other.actors.vale.heldItem = null;
    expect(visible(other)).toBe(false);
    other.playerActorId = "mara";
    expect(exits(other, "pond", "mara")).toContain("clearing");
    expect(isLockedBox(other, "clearing")).toBe(false);
  });

  it("follows a drop, a handoff and a move away, and a ring does not open it", () => {
    let s = open();
    s.actors.vale.place = "station";
    expect(availableCards(s)).not.toContain("clearing");
    s.actors.vale.place = "pond";
    s = act(s, "move", "clearing");
    expect(visible(s)).toBe(true);
    s = act(s, "drop", "bell");
    expect(visible(s)).toBe(false);
    expect(isLockedBox(s, "pond")).toBe(true);
    expect(availableCards(s)).toContain("pond");
    s.items.bell.holder = "vale";
    s.actors.vale.heldItem = "bell";
    s = act(s, "move", "pond");
    s.items.bell.holder = "moth";
    s.actors.moth.place = "pond";
    s.actors.moth.heldItem = "bell";
    s.actors.vale.heldItem = null;
    expect(visible(s)).toBe(false);
    const away = open();
    away.items.bell.holder = "pond";
    away.actors.vale.heldItem = null;
    away.items.bell.ringing = 3;
    expect(visible(away)).toBe(false);
    const covered = open();
    covered.items.cloth.holder = "bell";
    expect(visible(covered)).toBe(true);
  });

  it("gives the locked card's quest without traveling", () => {
    const s = open();
    s.items.bell.holder = "pond";
    s.actors.vale.heldItem = null;
    const gate = legalActions(s).find(
      (a) => a.kind === "gate" && a.target === "clearing",
    );
    expect(gate.text).toBe("Hold the Bell.");
    const taken = play(s, gate);
    expect(taken.ok).toBe(true);
    expect(taken.state.actors.vale.place).toBe("pond");
    expect(allQuestsOf(taken.state, "vale")).toContainEqual(
      expect.objectContaining({ kind: "item", target: "bell", story: true }),
    );
    expect(cardPlay(s, ["clearing"]).action.kind).toBe("gate");
  });

  it("keeps independent NPC crossing gated while a player can invite company", () => {
    let s = open();
    s.actors.moth.place = "pond";
    for (const actor of ["moth", "keeper", "badger"]) {
      expect(exits(s, "pond", actor)).not.toContain("clearing");
      expect(
        legalActions(s, actor).some(
          (a) => a.kind === "move" && a.target === "clearing",
        ),
      ).toBe(false);
    }
    const invitation = legalActions(s).find(
      (a) =>
        a.kind === "accompany" &&
        a.target === "moth" &&
        a.destination === "clearing",
    );
    expect(invitation).toBeDefined();
    s.items.bell.holder = "pond";
    s.actors.vale.heldItem = null;
    expect(play(s, invitation).ok).toBe(false);
    expect(s.invitedPlaces).toBeUndefined();
  });

  it("removes the route when an autonomous carrier leaves with the still-ringing bell", () => {
    let s = open();
    s.actors.moth.place = "pond";
    s.items.bell.holder = "moth";
    s.items.lamp.fuel = 1;
    s.items.lamp.lit = true;
    s.items.cloth.holder = "pond";
    // Pip wants the station and carries the ringing bell there.
    s.actors.moth.want = newWant("place", "station", s.turn);
    delete s.actors.moth.metTurn;
    const stale = cardPlay(open(), ["clearing"]).action;
    s = act(s, "wait");
    expect(s.actors.moth.place).toBe("station");
    expect(s.items.bell.holder).toBe("moth");
    expect(visible(s)).toBe(false);
    expect(availableCards(s)).toContain("clearing");
    expect(play(s, stale, s.revision).ok).toBe(false);
    expect(visible(decodeSave(encodeSave(s)))).toBe(false);
  });

  it("keeps legacy discovery and an inside avatar without granting permanent access", () => {
    // A schema 6 save kept the crossing in its own steamClock record.
    const legacy = (s, clock) => {
      const old = structuredClone(s);
      old.schema = 6;
      old.steamClock = clock;
      delete old.crossings["pond-clearing"];
      delete old.crossings["clearing-pond"];
      delete old.packs["badger-forest"];
      return JSON.stringify(old);
    };
    let s = act(open(), "move", "clearing");
    s = decodeSave(legacy(s, { rings: 0, discovered: true }));
    expect(crossing(s)).toEqual({ discovered: true });
    expect(s.actors.vale.place).toBe("clearing");
    expect(exits(s, "clearing", "vale")).toContain("pond");
    const back = act(s, "move", "pond");
    back.items.bell.holder = "pond";
    back.actors.vale.heldItem = null;
    expect(visible(back)).toBe(false);
    expect(isLockedBox(back, "clearing")).toBe(true);
  });
});
