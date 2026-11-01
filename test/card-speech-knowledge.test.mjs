import { describe, expect, it } from "vitest";
import { createWorld, nameOf } from "../v2/card-game/world.mjs";
import { enableMotives } from "../v2/card-game/motives.mjs";
import { narrativeContext } from "../v2/card-game/narrative.mjs";
import {
  forgetCovered,
  forgetUnfound,
  inventsItem,
  markWaking,
  UNKNOWN_PERSON,
} from "../v2/card-game/speech-knowledge.mjs";

const fresh = () => enableMotives(createWorld({ opening: true }));

describe("speech knows only uncovered cards (#1575)", () => {
  it("keeps a covered lamp out of Vale's opening request", () => {
    const s = fresh();
    const full = narrativeContext(s);
    expect(JSON.stringify(full)).toMatch(/lamp/i);
    const limited = forgetCovered(s, full, (id) => id === "lamp");
    expect(JSON.stringify(limited)).not.toMatch(/lamp/i);
    expect(limited.speakers).toEqual(["vale"]);
    expect(limited.entities.map(({ id }) => id)).toContain(limited.location);
    expect(limited.outcome.avatars[0].holding).toEqual([]);
    // Vale still knows the covered thing in his hand gives light.
    const vale = limited.entities.find(({ id }) => id === "vale");
    expect(vale.facts).toContain(
      "Holding: something shining I can't make out.",
    );
    expect(limited.events[0]).toMatch(/holding something shining I can't/);
  });

  it("blurs a cloth-covered lamp without calling it a light", () => {
    const s = fresh();
    s.items.cloth.holder = "lamp";
    const limited = forgetCovered(
      s,
      narrativeContext(s),
      (id) => id !== "vale",
    );
    const vale = limited.entities.find(({ id }) => id === "vale");
    expect(vale.facts[0]).toMatch(/^Holding: something I can't make out/);
    expect(JSON.stringify(limited)).not.toMatch(/shining|lamp|cloth/i);
  });

  it("leaves the request untouched once the lamp is uncovered", () => {
    const s = fresh();
    const full = narrativeContext(s);
    expect(forgetCovered(s, full, () => false)).toBe(full);
  });

  it("marks the first line waking and lists Vale and his place while covered (#1600)", () => {
    const s = fresh();
    const covered = new Set(["vale", "attic", "lamp"]);
    const isCovered = (id) => covered.has(id);
    const sent = markWaking(
      s,
      forgetCovered(s, narrativeContext(s), isCovered),
      isCovered,
    );
    expect(sent.waking).toBe(true);
    expect(sent.covered).toEqual(["vale", "attic"]);
    expect(sent.scenery).toBe(false);
    covered.clear();
    const known = markWaking(s, narrativeContext(s), isCovered);
    expect(known.waking).toBe(true);
    expect(known).not.toHaveProperty("covered");
    // Later turns keep the full scene frame.
    const later = { ...narrativeContext(s), turn: 1 };
    expect(markWaking(s, later, () => true)).toBe(later);
  });
});

describe("speech names only what its speaker has found (#1850)", () => {
  const host = "greek-shipmaster";
  const seeking = () => {
    const s = createWorld();
    s.turn = 5;
    s.actors.vale.talked = [];
    s.actors.vale.want = {
      kind: "person",
      target: host,
      since: 0,
      refusals: 0,
    };
    return s;
  };
  const vale = (context) => context.entities.find(({ id }) => id === "vale");

  it("keeps an unrevealed quest target's name out of the prompt", () => {
    const s = seeking();
    const context = narrativeContext(s);
    expect(JSON.stringify(context)).not.toContain(nameOf(host));
    expect(vale(context).facts).toContain(`I want to see ${UNKNOWN_PERSON}.`);
    s.actors.vale.talked.push(host);
    expect(JSON.stringify(narrativeContext(s))).toContain(nameOf(host));
    // In the browser, a card its player never uncovered stays unnamed too.
    const shown = forgetUnfound(s, narrativeContext(s), (id) => id === host);
    expect(JSON.stringify(shown)).not.toContain(nameOf(host));
  });

  it("does not retell the speaker's own earlier deed", () => {
    const s = seeking();
    const text = "Vale threatens The Keeper over the Bell.";
    s.knowledge.facts["event:9"] = {
      id: "event:9",
      text,
      source: {
        kind: "event",
        eventSeq: 9,
        turn: 1,
        actorId: "vale",
        locationId: "station",
        witnesses: ["vale"],
        topic: null,
      },
    };
    s.knowledge.known.vale = {
      "event:9": {
        kind: "witnessed",
        teller: null,
        eventSeq: 9,
        learnedTurn: 1,
      },
    };
    expect(JSON.stringify(narrativeContext(s))).not.toContain(text);
  });

  it("drops a persona naming the retired storybook map", () => {
    const s = seeking();
    s.memories.vale.innerLife = {
      persona: "I keep the storybook map close; the map's right here.",
      thoughts: [],
      dreams: [],
    };
    expect(inventsItem(s, "vale", "My compass is ready.")).toBe(true);
    expect(inventsItem(s, "vale", "I hold the Lamp.")).toBe(false);
    expect(vale(narrativeContext(s)).inner_life.persona).toBeNull();
  });
});
