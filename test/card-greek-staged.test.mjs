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

  it("carries one staged want, the rites", () => {
    expect(antigone.want).toBeUndefined();
    expect(antigone.wants).toHaveLength(1);
    const [lay] = antigone.wants;
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
  });

  it("starts with the rites she wants laid, as her single want did", () => {
    const s = world();
    expect(s.actors["greek-antigone"].want).toMatchObject({
      kind: "place",
      target: HOLLOW,
      step: { verb: "lay" },
    });
  });

  it("is left no second stage to set the rites aside for", () => {
    const s = world();
    const lay = antigone.wants[0].want;
    // Her home is the Hollow (rules 133), so being there is not a want.
    s.items["greek-creon-writ"].holder = "greek-guard";
    expect(stagedWants(s, "greek-antigone").map((entry) => entry.open)).toEqual([
      true,
    ]);
    expect(stagedNext(s, "greek-antigone", lay)).toBeNull();
    s.packs["greek-drama"].flags["greek-burial-performed"] = true;
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
