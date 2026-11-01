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
  playOpenDoor,
} from "./helpers/open-door.mjs";

const pack = packDefinition("greek-drama");
const flags = (world) => world.packs["greek-drama"].flags;
// Each Athenian outcome, the step that brings it, and the way home.
const cases = [
  ["agora-truce", "greek-olive-branch", "hear-truce-report"],
  ["eleusis-pledge", "greek-pyre-account", "lay-ashes"],
  ["piraeus-family", "greek-return-list", "homecoming-receive-family"],
  ["colonus-custom", "greek-refuge-tablet", "colonus-custom"],
  ["marathon-alcmene", "greek-marathon-record", "marathon-captive"],
];
const homeward = {
  "greek-athens": ["harbor", "courtyard"],
  "greek-eleusis": ["athens", "harbor", "courtyard"],
  "greek-piraeus": ["harbor", "courtyard"],
  "greek-colonus": ["athens", "harbor", "courtyard"],
  "greek-marathon": ["athens", "harbor", "courtyard"],
};
const giveDione = (world, item) =>
  legalActions(world).find(
    (a) => a.kind === "give" && a.item === item && a.target === "greek-baker",
  );
let journey;
beforeAll(() => {
  journey = openDoorJourney();
});

describe("early Open Door reports", () => {
  it.each(cases)(
    "earns one truthful return verse for %s",
    (ending, item, completed) => {
      const step = completed.startsWith("homecoming-")
        ? `greek-${completed}`
        : `greek-open-door-${completed}`;
      let world = structuredClone(journey.after[step]);
      if (world.items[item].holder !== "vale")
        world = playOpenDoor(world, "take", { item });
      world = openDoorWalk(world, ...homeward[world.actors.vale.place]);
      const id = `greek-homecoming-report-${ending}`;
      const story = ending.split("-")[0];
      const prior = recitalPoem(world, pack);
      const result = play(world, giveDione(world, item));
      expect(result.ok, result.error).toBe(true);
      world = decodeSave(encodeSave(result.state));
      expect(world.packs["greek-drama"].receipts[id]).toBe(world.turn);
      expect(flags(world)[`greek-homecoming-${story}-reported`]).toBe(true);
      expect(flags(world)["greek-open-door-returned"]).toBeUndefined();
      expect(world.items[item].holder).toBe("greek-courtyard");
      const poem = recitalPoem(world, pack);
      expect(poem.stanzas).toHaveLength(prior.stanzas.length + 1);
      expect(poem.stanzas.at(-1).id).toBe(id);
      expect(poem.stanzas.slice(0, -1)).toEqual(prior.stanzas);
      // The account stays on her table: there is nothing to give again.
      expect(giveDione(world, item)).toBeUndefined();
    },
  );

  it("opens a local report only after a completed story", () => {
    const world = openDoorStart();
    world.items["greek-pyre-account"].holder = "vale";
    world.actors.vale.place = "greek-courtyard";
    const result = play(world, giveDione(world, "greek-pyre-account"));
    expect(
      result.ok &&
        result.state.packs["greek-drama"].receipts[
          "greek-homecoming-report-eleusis-pledge"
        ],
    ).toBeFalsy();
  });

  it("lets the full account cover every local report", () => {
    const { world } = journey;
    expect(flags(world)["greek-open-door-returned"]).toBe(true);
    for (const [ending] of cases)
      expect(
        world.packs["greek-drama"].receipts[
          `greek-homecoming-report-${ending}`
        ],
      ).toBeTruthy();
    expect(
      recitalPoem(world, pack).stanzas.some(
        (v) => v.id === "greek-open-door-return-dione",
      ),
    ).toBe(true);
  });
});

describe("Open Door roads home", () => {
  // The countryside reaches the harbour through the city, so a full Agora
  // holds it until someone leaves. Piraeus goes home by the quays.
  it.each(["piraeus"])(
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

  it("connects the countryside places after Dione’s invitation", () => {
    let world = openDoorStart();
    world = openDoorWalk(
      world,
      "harbor",
      "athens",
      "eleusis",
      "colonus",
      "marathon",
      "eleusis",
    );
    expect(world.actors.vale.place).toBe("greek-eleusis");
  });
});
