import { describe, expect, it } from "vitest";
import {
  createWorld,
  play,
  legalActions,
  encodeSave,
  decodeSave,
  exits,
  rootHolder,
} from "../v2/card-game/world.mjs";
import { enableMotives } from "../v2/card-game/motives.mjs";
import { availableCards, cardPlay } from "../v2/card-game/cards.mjs";
import {
  narrativeContext,
  turnOutcome,
  applyGeneratedText,
} from "../v2/card-game/narrative.mjs";
import { knownActors } from "../v2/card-game/want.mjs";
import { endStandoff } from "./helpers/standoff.mjs";

function pond() {
  const s = enableMotives(createWorld());
  s.actors.vale.place = "pond";
  s.actors.moth.place = "attic";
  s.actors.keeper.place = "station";
  s.items.bell.holder = "vale";
  s.items.lamp.holder = "vale";
  return s;
}
function act(s, kind, item, target) {
  s = endStandoff(s);
  const action = legalActions(s).find(
    (a) =>
      a.kind === kind &&
      (!item || a.item === item) &&
      (!target || a.target === target),
  );
  expect(action, `${kind} ${item || target || ""}`).toBeTruthy();
  const result = play(s, action);
  expect(result.ok).toBe(true);
  return result.state;
}
const ring = (s) => act(s, "ring", "bell");
// The bridge's signal state for the pond's crossing into the clearing.
const signal = (s) => s.crossings["pond-clearing"];
// The second ring reveals the clearing; playing its card takes Vale there.
const reach = (s) => act(s, "move", null, "clearing");

describe("the bell crossing to the Steam Clock", () => {
  it("gives the first ring one reply from echo and preserves it through reload and retries", () => {
    let s = ring(pond());
    const context = narrativeContext(s);
    const response = {
      revision: context.revision,
      model: "fixture",
      entries: context.entities.map(({ id }) => ({
        id,
        text: "The sound fades.",
      })),
    };
    s = applyGeneratedText(s, context, response);
    const replies = (world) =>
      world.log.filter((entry) => entry.generated && entry.turn === world.turn);
    expect(replies(s)).toHaveLength(1);
    expect(replies(s)[0]).toMatchObject({
      speaker: "echo",
      text: "bong",
      kind: "dialogue",
    });
    s = decodeSave(encodeSave(s));
    s = applyGeneratedText(s, context, response);
    expect(replies(s)).toHaveLength(1);
    s = ring(s);
    expect(s.actors.vale.place).toBe("pond");
    expect(availableCards(s)).toContain("clearing");
    s = reach(s);
    expect(s.actors.vale.place).toBe("clearing");
    expect(replies(s)).toHaveLength(0);
  });

  it("reveals the way on the second consecutive ring, then crosses with carried items", () => {
    const start = pond();
    const first = ring(start);
    expect(first.actors.vale.place).toBe("pond");
    expect(signal(first).phase).toBe(1);
    expect(knownActors(first)).not.toContain("badger");
    const before = encodeSave(first);
    availableCards(first);
    cardPlay(first, ["bell"]);
    expect(encodeSave(first)).toBe(before);
    const heard = ring(decodeSave(before));
    expect(heard.actors.vale.place).toBe("pond");
    expect(signal(heard)).toEqual({
      phase: 0,
      discovered: true,
      until: heard.turn + 3,
    });
    expect(turnOutcome(heard).card.kind).toBe("ring");
    expect(
      heard.memories.pond.events.some((e) =>
        e.text.includes("forest clearing"),
      ),
    ).toBe(true);
    // Vale sees the crossing, and companion offers follow the local cast.
    expect(exits(heard, "pond", "vale")).toContain("clearing");
    expect(exits(heard, "pond")).not.toContain("clearing");
    expect(
      legalActions(heard).some(
        (a) => a.kind === "move" && a.target === "clearing",
      ),
    ).toBe(true);
    expect(decodeSave(encodeSave(heard))).toEqual(heard);
    const next = reach(heard);
    expect(next.actors.vale.place).toBe("clearing");
    expect(rootHolder(next, "bell")).toBe("vale");
    expect(rootHolder(next, "lamp")).toBe("vale");
    expect(next.actors.badger.awake).toBe(false);
    expect(availableCards(next)).toContain("badger");
    // The carried bell is still sounding, so the way back is open to Vale.
    expect(exits(next, "clearing", "vale")).toEqual(["pond"]);
    expect(exits(next, "clearing")).toEqual([]);
    expect(
      turnOutcome(next).avatars.find((a) => a.id === "vale").travel,
    ).toEqual({ from: "pond", to: "clearing", companions: [] });
    expect(decodeSave(encodeSave(next))).toEqual(next);
  });

  it("breaks the sequence on another committed play and keeps failed plays free", () => {
    let s = ring(pond());
    const rejected = play(s, { key: "invented" });
    expect(rejected.ok).toBe(false);
    expect(rejected.state).toBe(s);
    s = act(s, "wait");
    expect(signal(s).phase).toBe(0);
    s = ring(s);
    expect(s.actors.vale.place).toBe("pond");
    s = act(s, "move", null, "station");
    s = act(s, "move", null, "pond");
    s = ring(s);
    expect(s.actors.vale.place).toBe("pond");
  });

  it("uses clear player rings at Black pond", () => {
    const s = pond();
    s.actors.vale.place = "station";
    expect(ring(ring(s)).actors.vale.place).toBe("station");
    s.actors.vale.place = "pond";
    s.items.cloth.holder = "bell";
    expect(legalActions(s).some((a) => a.kind === "ring")).toBe(false);
    expect(signal(s).phase).toBe(0);
  });

  it("keeps Badger asleep on arrival, then remembers waking him across return trips", () => {
    let s = reach(ring(ring(pond())));
    expect(narrativeContext(s).speakers).not.toContain("badger");
    expect(
      narrativeContext(s)
        .entities.find((e) => e.id === "badger")
        .facts.join(" "),
    ).toContain("Asleep");
    s = act(s, "talk", null, "badger");
    expect(s.actors.badger.awake).toBe(true);
    expect(s.actors.badger.wakeCause).toBe("voice");
    expect(narrativeContext(s).speakers).toContain("badger");
    s = act(s, "move", null, "pond");
    expect(availableCards(s)).not.toContain("clearing");
    s = reach(ring(ring(decodeSave(encodeSave(s)))));
    expect(s.actors.badger.awake).toBe(true);
    // Badger keeps to the clearing, so he never sets out on a want.
    expect(s.actors.badger.place).toBe("clearing");
    expect(narrativeContext(s).outcome.avatars.map((a) => a.id)).toEqual([
      "vale",
      "badger",
    ]);
  });

  it("allows a return after leaving the bell behind and reacts to local ringing", () => {
    let s = reach(ring(ring(pond())));
    s = ring(s);
    expect(s.actors.badger).toMatchObject({
      awake: true,
      wakeCause: "sound",
      irritation: 2,
    });
    s = act(s, "wait");
    expect(s.actors.badger.irritation).toBe(1);
    s = act(s, "drop", "bell");
    s = act(s, "move", null, "pond");
    expect(s.actors.vale.place).toBe("pond");
    expect(s.items.bell.holder).toBe("clearing");
  });

  it("keeps Badger grumpy after quiet and sharpens his voice with recorded irritation", () => {
    let s = reach(ring(ring(pond())));
    s = act(s, "talk", null, "badger");
    const facts = (world) =>
      narrativeContext(world)
        .entities.find((e) => e.id === "badger")
        .facts.join(" ");
    s = act(s, "wait");
    expect(s.actors.badger.irritation).toBe(0);
    expect(facts(s)).toContain("Still grumpy");
    expect(facts(s)).toContain("answer grudgingly");
    s = ring(s);
    expect(s.actors.badger.irritation).toBeGreaterThan(1);
    expect(facts(s)).toContain("Furious at the noise");
    expect(facts(decodeSave(encodeSave(s)))).toContain(
      "blunt demand for quiet",
    );
  });

  it("adds the clearing to an older shore save while keeping existing belongings and memories", () => {
    // A schema 6 shore save from before the clearing existed.
    const old = pond();
    delete old.crossings["pond-clearing"];
    delete old.crossings["clearing-pond"];
    delete old.packs["badger-forest"];
    delete old.actors.badger;
    delete old.peaceUntil.badger;
    delete old.memories.badger;
    delete old.memories.clearing;
    delete old.motives.grievances.badger;
    for (const actor of Object.values(old.actors)) delete actor.trust.badger;
    const restored = decodeSave(JSON.stringify(old));
    expect(restored.items).toEqual(old.items);
    expect(restored.log).toEqual(old.log);
    expect(restored.actors.vale.place).toBe("pond");
    expect(restored.actors.badger.awake).toBe(false);
    expect(reach(ring(ring(restored))).actors.vale.place).toBe("clearing");
    restored.crossings["pond-clearing"].phase = 2;
    expect(() => decodeSave(JSON.stringify(restored))).toThrow();
  });
});
