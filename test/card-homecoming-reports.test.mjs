import { beforeAll, describe, expect, it } from "vitest";
import {
  decodeSave,
  encodeSave,
  legalActions,
  play,
} from "../v2/card-game/world.mjs";
import { packDefinition } from "../v2/card-game/pack-registry.mjs";
import { recitalPoem } from "../v2/card-game/pack-recital.mjs";
import { dispatchShared } from "../v2/card-game/shared-world.mjs";
import {
  openDoorJourney,
  openDoorStart,
  openDoorWalk,
} from "./helpers/open-door.mjs";

const pack = packDefinition("greek-drama");
const reported = (world) =>
  legalActions(world).filter((a) =>
    a.choiceId?.startsWith("greek-homecoming-report-"),
  );
const cases = [
  ["agora-truce", "agora", 0, "hear-truce-report"],
  ["agora-force", "agora", 1, "hear-recovery-report"],
  ["eleusis-care", "eleusis", 0, "eleusis-care"],
  ["eleusis-pledge", "eleusis", 1, "eleusis-pledge"],
  ["piraeus-family", "piraeus", 0, "family-berth"],
  ["piraeus-open", "piraeus", 1, "open-berth"],
  ["colonus-custom", "colonus", 0, "colonus-custom"],
  ["colonus-family", "colonus", 1, "colonus-family"],
  ["marathon-hearing", "marathon", 0, "marathon-hearing"],
  ["marathon-alcmene", "marathon", 1, "marathon-alcmene"],
];
const homeward = {
  "greek-athens": ["harbor", "courtyard"],
  "greek-eleusis": ["piraeus", "harbor", "courtyard"],
  "greek-piraeus": ["harbor", "courtyard"],
  "greek-colonus": ["athens", "harbor", "courtyard"],
  "greek-marathon": ["colonus", "athens", "harbor", "courtyard"],
};
let journeys;
beforeAll(() => {
  journeys = [
    openDoorJourney(),
    openDoorJourney({
      recovery: "recovery",
      eleusis: "pledge",
      berth: "open",
      colonus: "family",
      marathon: "alcmene",
    }),
  ];
});

describe("early Open Door reports", () => {
  it.each(cases)(
    "earns one truthful return verse for %s",
    (ending, story, branch, completed) => {
      let world = journeys[branch].after[`greek-open-door-${completed}`];
      world = openDoorWalk(world, ...homeward[world.actors.vale.place]);
      const id = `greek-homecoming-report-${ending}`;
      const offers = reported(world).filter((a) =>
        a.choiceId.startsWith(`greek-homecoming-report-${story}-`),
      );
      expect(offers.map((a) => a.choiceId)).toEqual([id]);
      const prior = recitalPoem(world, pack);
      const result = play(world, offers[0]);
      expect(result.ok, result.error).toBe(true);
      world = decodeSave(encodeSave(result.state));
      expect(
        world.packs["greek-drama"].flags[`greek-homecoming-${story}-reported`],
      ).toBe(true);
      expect(
        world.packs["greek-drama"].flags["greek-open-door-returned"],
      ).toBeUndefined();
      const poem = recitalPoem(world, pack);
      expect(poem.stanzas).toHaveLength(prior.stanzas.length + 1);
      expect(poem.stanzas.at(-1).id).toBe(id);
      expect(poem.stanzas.slice(0, -1)).toEqual(prior.stanzas);
      expect(
        reported(world).some((a) =>
          a.choiceId.startsWith(`greek-homecoming-report-${story}-`),
        ),
      ).toBe(false);
      expect(play(world, offers[0]).ok).toBe(false);
    },
  );

  it("opens a local report only after a completed story", () => {
    expect(reported(openDoorStart())).toEqual([]);
  });

  it("lets the full account cover every local report", () => {
    for (const { world } of journeys) {
      expect(world.packs["greek-drama"].flags["greek-open-door-returned"]).toBe(
        true,
      );
      expect(reported(world)).toEqual([]);
      expect(
        recitalPoem(world, pack).stanzas.some(
          (v) => v.id === "greek-open-door-return-dione",
        ),
      ).toBe(true);
    }
  });
});

describe("Open Door roads home", () => {
  // Colonus and Marathon are places inside Athens, so a full Agora holds
  // them until someone leaves. Eleusis and Piraeus go home by the quays.
  it.each(["eleusis", "piraeus"])(
    "takes a traveler home from %s while the Agora is full",
    (start) => {
      const created = dispatchShared({
        op: "create",
        save: encodeSave(openDoorStart()),
      });
      expect(created.ok).toBe(true);
      let world = created.world;
      const company = ["vale", "mara", "ash", "nell", "tavi"];
      world.controlledActors = company;
      world.presentActors = company;
      for (const actor of company.slice(1))
        world.actors[actor].place = "greek-athens";
      world.actors.vale.place = `greek-${start}`;
      expect(
        legalActions(world).some(
          (a) => a.kind === "move" && a.target === "greek-athens",
        ),
      ).toBe(false);
      world = openDoorWalk(world, ...homeward[`greek-${start}`]);
      expect(world.actors.vale.place).toBe("greek-courtyard");
      for (const actor of company.slice(1))
        expect(world.actors[actor].place).toBe("greek-athens");
    },
  );

  it("connects the coast and local roads after Dione’s invitation", () => {
    let world = openDoorStart();
    world = openDoorWalk(
      world,
      "harbor",
      "piraeus",
      "eleusis",
      "colonus",
      "marathon",
    );
    world = openDoorWalk(
      world,
      "colonus",
      "eleusis",
      "piraeus",
      "harbor",
      "courtyard",
    );
    expect(world.actors.vale.place).toBe("greek-courtyard");
  });
});
