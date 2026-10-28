import { readFileSync } from "node:fs";
import vm from "node:vm";
import { describe, expect, it } from "vitest";
import {
  decodeSave,
  encodeSave,
  exits,
  legalActions,
  play,
} from "../v2/card-game/world.mjs";
import {
  entityActive,
  packDefinition,
} from "../v2/card-game/pack-registry.mjs";
import { knowsFact } from "../v2/card-game/knowledge.mjs";
import { recitalPoem } from "../v2/card-game/pack-recital.mjs";
import { questRecord } from "../v2/card-game/shared-quests.mjs";
import { frozenVerseProblems } from "../v2/scripts/frozen-card-verses.mjs";
import { ajaxStart } from "./helpers/greek-ajax.mjs";
import {
  aulisStart,
  aulisWitness,
  aulisPrepared,
  aulisAccount,
  aulisJourney,
  aulisChoice,
  aulisState,
  bookMove,
  bookPlay,
} from "./helpers/greek-book-three.mjs";

const pack = packDefinition("greek-drama");
const reload = (world) => decodeSave(encodeSave(world));
const offered = (world, id) =>
  legalActions(world).some((a) => a.choiceId === `greek-aulis-${id}`);
const stanzas = (world) =>
  recitalPoem(world, pack).stanzas.filter((v) =>
    v.id.startsWith("greek-aulis-"),
  );

describe("The Wind’s Price", () => {
  it("opens a named departure after Ajax’s actual return", () => {
    const before = bookMove(ajaxStart(), "greek-harbor");
    expect(offered(before, "invitation")).toBe(false);
    expect(entityActive(before, "greek-aulis")).toBe(false);
    const world = aulisStart();
    expect(aulisState(world).choices["greek-aulis-frame"]).toBe(
      "remembered-departure",
    );
    expect(world.transports["greek-ship"].dock).toBe("greek-aulis");
    expect(exits(world, "greek-aulis")).toEqual(
      expect.arrayContaining(["greek-aulis-household", "greek-aulis-altar"]),
    );
    expect(exits(world, "greek-aulis")).not.toContain("greek-gate");
    expect(reload(world)).toEqual(world);
  });

  it.each(["escape", "sacrifice", "rescue"])(
    "brings the %s account home through three physical beats and recorded Talk",
    (route) => {
      const world = aulisJourney(route);
      expect(world.actors.vale.place).toBe("greek-courtyard");
      expect(aulisState(world).choices).toMatchObject({
        "greek-aulis-route": route,
        "greek-aulis-ending": route,
        "greek-aulis-return": route,
      });
      expect(world.items["greek-aulis-recall-letter"].holder).toBe(
        "greek-aulis-household",
      );
      expect(world.items["greek-aulis-wedding-veil"].holder).toBe(
        "greek-aulis-household",
      );
      expect(world.items["greek-aulis-offering-cloth"].holder).toBe(
        route === "escape" ? "greek-aulis" : "greek-aulis-altar",
      );
      expect(world.items["greek-aulis-departure-record"].holder).toBe(
        "greek-courtyard",
      );
      expect(knowsFact(world, "vale", `greek-aulis-account-${route}`)).toBe(
        true,
      );
      for (const beat of ["letter", "witness", "altar", "return"])
        expect(
          questRecord(world, `greek-drama:story-quest-greek-aulis-${beat}`)
            .completion.actorId,
        ).toBe("vale");
      expect(stanzas(world).map((v) => v.id)).toEqual([
        "greek-aulis-deliver-recall",
        "greek-aulis-secure-witness",
        `greek-aulis-complete-${route}`,
        `greek-aulis-return-${route}`,
      ]);
      expect(reload(world)).toEqual(world);
    },
  );

  it("keeps the living escape behind agreement and actual joint arrival", () => {
    let world = bookMove(aulisWitness(), "greek-aulis-household");
    expect(
      legalActions(world).find(
        (a) => a.kind === "accompany" && a.target === "greek-aulis-iphigenia",
      ),
    ).toBeUndefined();
    world = aulisChoice(world, "choose-escape");
    world = bookPlay(world, "take", { item: "greek-aulis-offering-cloth" });
    world = bookMove(world, "greek-aulis");
    expect(offered(world, "complete-escape")).toBe(false);
    world = bookMove(world, "greek-aulis-household");
    world = bookPlay(world, "accompany", {
      target: "greek-aulis-iphigenia",
      destination: "greek-aulis",
    });
    expect(world.actors["greek-aulis-iphigenia"].place).toBe("greek-aulis");
    expect(offered(world, "complete-escape")).toBe(true);
    expect(reload(world)).toEqual(world);
  });

  it("keeps the chosen rescue truth beside the mother’s doubt", () => {
    const world = aulisAccount("rescue");
    expect(aulisState(world).choices).toMatchObject({
      "greek-aulis-chosen-truth": "alive-with-artemis",
      "greek-aulis-fleet-account": "hind-reported",
      "greek-aulis-mother-belief": "questions-the-report",
    });
    expect(knowsFact(world, "vale", "greek-aulis-rescue-report")).toBe(true);
    expect(pack.continuity.groups).toHaveLength(2);
    expect(offered(world, "choose-sacrifice")).toBe(false);
    expect(offered(world, "choose-escape")).toBe(false);
  });

  it("rejects a prepared sacrifice after its actual cloth changes custody", () => {
    let world = aulisPrepared("sacrifice");
    const action = legalActions(world).find(
      (a) => a.choiceId === "greek-aulis-complete-sacrifice",
    );
    expect(action).toBeTruthy();
    world = bookPlay(world, "take", { item: "greek-aulis-offering-cloth" });
    expect(offered(world, "complete-sacrifice")).toBe(false);
    expect(play(world, action, world.revision).ok).toBe(false);
    expect(stanzas(world)).toHaveLength(2);
    expect(reload(world)).toEqual(world);
  });

  it("keeps every frozen stanza definition intact", () => {
    const frozen = JSON.parse(
      readFileSync(
        new URL(
          "../v2/content/greek-drama/recital-rules20.json",
          import.meta.url,
        ),
        "utf8",
      ),
    );
    expect(frozen.verses).toHaveLength(56);
    expect(frozenVerseProblems(pack, frozen)).toEqual([]);
  });

  it("loads the chosen rescue through the compiled rules-21 boundary", () => {
    const context = vm.createContext({});
    vm.runInContext(
      readFileSync(
        new URL(
          "../v2/orchestrator-rust/src/card_shared/engine-v21.js",
          import.meta.url,
        ),
        "utf8",
      ),
      context,
    );
    const world = aulisJourney("rescue");
    const result = JSON.parse(
      context.cardShared(
        JSON.stringify({ op: "create", save: encodeSave(world) }),
      ),
    );
    expect(result.ok, result.error).toBe(true);
    expect(result.world.packs["greek-drama"]).toEqual(aulisState(world));
    expect(result.world.items["greek-aulis-departure-record"]).toEqual(
      world.items["greek-aulis-departure-record"],
    );
    expect(result.world.knowledge).toEqual(world.knowledge);
  });
});

describe("Book III save continuity", () => {
  it("keeps a rules-20 full-access Aulis visitor and their route home", () => {
    const context = vm.createContext({});
    vm.runInContext(
      readFileSync(
        new URL(
          "../v2/orchestrator-rust/src/card_shared/engine-v20.js",
          import.meta.url,
        ),
        "utf8",
      ),
      context,
    );
    const before = JSON.parse(
      context.cardShared(JSON.stringify({ op: "create" })),
    ).world;
    delete before.opening;
    before.packs["greek-drama"].scope = "full";
    before.actors.vale.place = "greek-aulis";
    const world = decodeSave(JSON.stringify(before));
    expect(aulisState(world).revision).toBe(8);
    expect(world.actors.vale).toMatchObject(before.actors.vale);
    expect(world.items.lamp).toEqual(before.items.lamp);
    expect(world.log).toEqual(before.log);
    expect(aulisState(world).receipts).toEqual(
      before.packs["greek-drama"].receipts,
    );
    expect(entityActive(world, "greek-aulis-iphigenia")).toBe(false);
    expect(exits(world, "greek-aulis")).toContain("greek-gate");
    // Rules 20 has 33 Greek residents and 26 Greek objects. Each new source
    // identity adds one saved record beside every preserved earlier record.
    expect(Object.keys(world.actors)).toHaveLength(
      Object.keys(before.actors).length + Object.keys(pack.avatars).length - 33,
    );
    expect(Object.keys(world.items)).toHaveLength(
      Object.keys(before.items).length + Object.keys(pack.items).length - 26,
    );
    expect(reload(world)).toEqual(world);
    expect(bookMove(world, "greek-gate").actors.vale.place).toBe("greek-gate");
  });
});
