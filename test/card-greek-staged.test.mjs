import { describe, expect, it } from "vitest";
import { createWorld } from "../v2/card-game/world.mjs";
import { packDefinition } from "../v2/card-game/pack-registry.mjs";
import { stagedNext } from "../v2/card-game/want.mjs";
import { stagedWants } from "../v2/card-game/want-talk.mjs";

// Rules 133 package 3: the burial and RatiRadio's keepsakes as unordered
// staged wants, at most three to a resident (docs/design/wants-and-arcs.md).
const greek = packDefinition("greek-drama");
const radio = packDefinition("ratiradio");
const world = () =>
  createWorld({
    opening: false,
    seed: 17,
    packScopes: { "greek-drama": "full" },
  });
const terms = (want) => `${want.kind}:${want.target}:${want.step?.items ?? ""}`;
const HOLLOW = "greek-polynices-hollow";
const LISTENING = "ratiradio-listening-room";

describe("Antigone's burial wants", () => {
  const antigone = greek.avatars["greek-antigone"];

  it("carries two staged wants instead of one", () => {
    expect(antigone.want).toBeUndefined();
    expect(antigone.wants).toHaveLength(2);
    expect(antigone.wants.length).toBeLessThanOrEqual(3);
    const [lay, there] = antigone.wants;
    expect(lay.want).toMatchObject({
      kind: "place",
      target: HOLLOW,
      step: {
        verb: "lay",
        items: ["greek-oil-flask", "greek-funeral-cloth", "greek-shovel"],
        finish: "greek-burial-performed",
      },
    });
    expect(lay.when).toBeUndefined();
    expect(there.want).toEqual({ kind: "place", target: HOLLOW });
  });

  it("starts with the rites she wants laid, as her single want did", () => {
    const s = world();
    expect(s.actors["greek-antigone"].want).toMatchObject({
      kind: "place",
      target: HOLLOW,
      step: { verb: "lay" },
    });
  });

  it("may say she wants to be at the Hollow once the guard holds the Writ, until the burial", () => {
    const s = world();
    const lay = antigone.wants[0].want;
    const flags = s.packs["greek-drama"].flags;
    // Without the writ in the guard's hands only the rites are open.
    expect(
      stagedWants(s, "greek-antigone").map((entry) => entry.open),
    ).toEqual([true, false]);
    s.items["greek-creon-writ"].holder = "greek-guard";
    expect(
      stagedWants(s, "greek-antigone").map((entry) => entry.open),
    ).toEqual([true, true]);
    // The rites set aside: she wants to be at the Hollow.
    expect(terms(stagedNext(s, "greek-antigone", lay))).toBe(
      terms(antigone.wants[1].want),
    );
    // Once she is there, nothing is left open of that want.
    s.actors["greek-antigone"].place = HOLLOW;
    expect(stagedNext(s, "greek-antigone", lay)).toBeNull();
    // After the burial her wants are drawn.
    s.actors["greek-antigone"].place = "greek-gate";
    flags["greek-burial-performed"] = true;
    expect(
      stagedWants(s, "greek-antigone").map((entry) => entry.open),
    ).toEqual([true, false]);
    expect(stagedNext(s, "greek-antigone", lay)).toBeNull();
  });
});

describe("RATi's keepsakes", () => {
  const rati = radio.avatars["ratiradio-rati"];
  const things = [
    "ratiradio-red-beanie",
    "ratiradio-raven-figurine",
    "ratiradio-glass",
  ];

  it("names the three keepsakes still to come home, one stage each", () => {
    expect(rati.want).toBeUndefined();
    expect(rati.wants).toHaveLength(3);
    expect(rati.wants.map((entry) => entry.want.step.items)).toEqual(
      things.map((id) => [id]),
    );
    for (const entry of rati.wants)
      expect(entry.want).toMatchObject({
        kind: "place",
        target: LISTENING,
        step: { verb: "lay" },
      });
  });

  it("starts wanting one of them and moves to another as each comes home", () => {
    const s = world();
    const held = () => s.actors["ratiradio-rati"].want;
    expect(things.map((id) => [id])).toContainEqual(held().step.items);
    // Set the first one down at home: the next pick is one of the others.
    let remaining = [...things];
    let previous = held();
    while (remaining.length) {
      const [id] = previous.step.items;
      s.items[id].holder = LISTENING;
      remaining = remaining.filter((thing) => thing !== id);
      const next = stagedNext(s, "ratiradio-rati", previous);
      if (!remaining.length) {
        expect(next).toBeNull();
        break;
      }
      expect(remaining.map((thing) => [thing])).toContainEqual(
        next.step.items,
      );
      previous = next;
    }
  });
});
