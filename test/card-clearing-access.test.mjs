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
import { availableCards, cardPlay } from "../v2/card-game/cards.mjs";
import { narrativeContext } from "../v2/card-game/narrative.mjs";

function act(s, kind, target) {
  const action = legalActions(s).find(
    (a) => a.kind === kind && (!target || a.target === target),
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
  return s;
}
const ring = (s) => act(s, "ring");
const open = () => ring(ring(pond()));
const visible = (s) => exits(s, "pond", "vale").includes("clearing");
// The bridge's saved state for the pond's crossing into the clearing.
const crossing = (s) => s.crossings["pond-clearing"];

describe("the temporary ringing path to Forest Clearing", () => {
  it("offers three following turns, then expires and rejects stale choices", () => {
    let s = open();
    const stale = cardPlay(s, ["clearing"]).action;
    expect(s.items.bell.ringing).toBe(3);
    expect(crossing(s).until).toBe(s.turn + 3);
    for (let remaining = 3; remaining > 0; remaining--) {
      expect(visible(s)).toBe(true);
      expect(s.items.bell.ringing).toBe(remaining);
      const before = encodeSave(s);
      availableCards(s);
      cardPlay(s, ["clearing"]);
      expect(encodeSave(s)).toBe(before);
      expect(play(s, { key: "invented" }).state).toBe(s);
      s = act(s, "wait");
    }
    expect(crossing(s).discovered).toBe(true);
    expect(visible(s)).toBe(false);
    expect(availableCards(s)).not.toContain("clearing");
    expect(cardPlay(s, ["clearing"]).action).toBeNull();
    expect(play(s, stale, s.revision)).toMatchObject({ ok: false, state: s });
    expect(play(s, stale, s.revision - 1).ok).toBe(false);
    const facts = narrativeContext(s).entities.find(
      (e) => e.id === "pond",
    ).facts;
    expect(facts.find((f) => f.startsWith("Paths visible now:"))).not.toContain(
      "Forest Clearing",
    );
  });

  it("allows the final entry turn but needs a sounding bell to return", () => {
    let s = act(act(open(), "wait"), "wait");
    expect(s.items.bell.ringing).toBe(1);
    s = act(s, "move", "clearing");
    expect(s.items.bell.ringing).toBe(0);
    s = act(act(s, "wait"), "wait");
    expect(exits(s, "clearing", "vale")).not.toContain("pond");
    expect(availableCards(s)).not.toContain("pond");
    s = act(decodeSave(encodeSave(s)), "ring", "clearing");
    expect(exits(s, "clearing", "vale")).toContain("pond");
    s = act(s, "move", "pond");
    expect(visible(s)).toBe(false);
    expect(visible(ring(s))).toBe(false);
    expect(visible(ring(ring(s)))).toBe(true);
  });

  it("refreshes an active window with one local ring and preserves its exact remainder on reload", () => {
    let s = act(act(open(), "wait"), "wait");
    s = ring(decodeSave(encodeSave(s)));
    expect(crossing(s).phase).toBe(0);
    expect(crossing(s).until).toBe(s.turn + 3);
    expect(s.items.bell.ringing).toBe(3);
    s = decodeSave(encodeSave(act(s, "wait")));
    expect(crossing(s).until - s.turn).toBe(2);
    s = act(act(s, "wait"), "wait");
    expect(visible(decodeSave(encodeSave(s)))).toBe(false);
  });

  it("does not let a distant ring refresh or reopen the pond path", () => {
    let s = open();
    const expiry = crossing(s).until;
    s = act(s, "move", "station");
    expect(visible(s)).toBe(false);
    s = ring(s);
    expect(crossing(s).until).toBe(expiry);
    s = act(s, "move", "pond");
    expect(s.items.bell.ringing).toBeGreaterThan(0);
    expect(visible(s)).toBe(false);
    expect(visible(ring(s))).toBe(false);
  });

  it("uses current ground or carrier location and closes if the bell leaves or is covered", () => {
    const s = open();
    for (const holder of ["pond", "vale", "moth"]) {
      s.items.bell.holder = holder;
      s.actors.moth.place = "pond";
      expect(visible(s)).toBe(true);
    }
    const stale = cardPlay(s, ["clearing"]).action;
    s.actors.moth.place = "station";
    expect(visible(s)).toBe(false);
    expect(play(s, stale, s.revision).ok).toBe(false);
    s.actors.moth.place = "pond";
    s.items.cloth.holder = "bell";
    expect(visible(s)).toBe(false);
    expect(availableCards(s)).not.toContain("clearing");
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
    for (let i = 0; i < 3; i++) s = act(s, "wait");
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
    const stale = cardPlay(s, ["clearing"]).action;
    s = act(s, "wait");
    expect(s.actors.moth.place).toBe("station");
    expect(s.items.bell).toMatchObject({ holder: "moth", ringing: 2 });
    expect(crossing(s).until).toBeGreaterThan(s.turn);
    expect(availableCards(s)).not.toContain("clearing");
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
    expect(crossing(s)).toEqual({ discovered: true, phase: 0, until: 0 });
    expect(s.actors.vale.place).toBe("clearing");
    expect(exits(s, "clearing", "vale")).toContain("pond");
    expect(visible(act(s, "move", "pond"))).toBe(false);
    for (const invalid of [-1, 1.5, s.turn + 4])
      expect(() =>
        decodeSave(
          legacy(s, { rings: 0, discovered: true, openUntil: invalid }),
        ),
      ).toThrow();
  });
});
