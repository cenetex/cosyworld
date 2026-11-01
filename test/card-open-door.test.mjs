import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  createWorld,
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
import { dispatchShared } from "../v2/card-game/shared-world.mjs";
import { recitalPoem, recitalContext } from "../v2/card-game/pack-recital.mjs";
import { openingFixture } from "./helpers/greek-opening.mjs";
import {
  OPEN_DOOR_PLACES,
  openDoorJourney,
  openDoorStart,
  openDoorSteps,
  openDoorWalk,
  playOpenDoor,
} from "./helpers/open-door.mjs";
import { upgradedItems } from "./fixtures/card-upgraded-items.mjs";

const state = (world) => world.packs["greek-drama"];
const accessible = (world) =>
  OPEN_DOOR_PLACES.filter((id) => entityActive(world, id));
const reload = (world) => decodeSave(encodeSave(world));
const pack = packDefinition("greek-drama");

const story = (id) => /^greek-(open-door|homecoming)-/.test(id);
const OUTCOMES = [
  "greek-olive-branch",
  "greek-pyre-account",
  "greek-return-list",
  "greek-refuge-tablet",
  "greek-marathon-record",
];

describe("the Open Door", () => {
  it("carries the five stories home with ordinary plays", () => {
    const { world, before } = openDoorJourney();
    expect(world.actors.vale.place).toBe("greek-courtyard");
    for (const id of ["eleusis", "piraeus", "colonus", "marathon"])
      expect(state(world).flags[`greek-open-door-${id}-done`]).toBe(true);
    expect(state(world).flags["greek-open-door-returned"]).toBe(true);
    expect(state(world).choices).toMatchObject({
      "greek-open-door-recovery": "truce",
      "greek-open-door-berth": "family",
      "greek-homecoming-care": "family",
    });
    // No story button is ever offered; every receipt came from a fixed verb.
    for (const prior of Object.values(before))
      expect(
        legalActions(prior).filter(
          (a) => a.kind === "choose" && story(a.choiceId),
        ),
      ).toEqual([]);
    expect(pack.choices.filter((c) => story(c.id)).every((c) => c.on)).toBe(
      true,
    );
    expect(world.quests).toBeUndefined();
    // The five outcomes rest on Dione's table; the offerings stay where
    // their deeds were done.
    for (const item of OUTCOMES)
      expect(world.items[item].holder).toBe("greek-courtyard");
    for (const [item, place] of Object.entries({
      "greek-burial-petition": "greek-athens",
      "greek-return-cloths": "greek-eleusis",
      "greek-ash-urn": "greek-eleusis",
      "greek-grove-cup": "greek-colonus",
      "greek-grove-honey": "greek-colonus",
      "greek-shelter-blanket": "greek-marathon",
    }))
      expect(world.items[item].holder).toBe(place);
    const poem = recitalPoem(world, pack);
    expect(
      poem.stanzas.some((verse) => verse.id === "greek-open-door-return-dione"),
    ).toBe(true);
    const restored = reload(reload(world));
    expect(restored.packs).toEqual(world.packs);
    expect(recitalPoem(restored, pack)).toEqual(poem);
  });

  it("requires the actual things at each deed", () => {
    const { before } = openDoorJourney();
    // Waiting does a deed only beside its things.
    for (const [id, item] of [
      ["set-provisions", "greek-provision-basket"],
      ["lay-cloths", "greek-return-cloths"],
      ["colonus-water", "greek-grove-honey"],
      ["colonus-custom", "greek-refuge-tablet"],
      ["marathon-blanket", "greek-shelter-blanket"],
    ]) {
      const choiceId = `greek-open-door-${id}`;
      const world = structuredClone(before[choiceId]);
      world.items[item].holder = "mara";
      const waited = playOpenDoor(world, "wait");
      expect(state(waited).receipts[choiceId], id).toBeUndefined();
    }
    // A gift needs the thing in the giver's hands.
    for (const [id, item] of [
      ["register-plea", "greek-burial-petition"],
      ["lay-ashes", "greek-ash-urn"],
      ["family-berth", "greek-return-list"],
    ]) {
      const world = structuredClone(before[`greek-open-door-${id}`]);
      world.items[item].holder = "mara";
      expect(
        legalActions(world).some((a) => a.kind === "give" && a.item === item),
      ).toBe(false);
    }
  });

  it("keeps remembered generations in their named tales", () => {
    const { world } = openDoorJourney();
    // Meetings commit their tale; its words are the choice's own caption.
    const line = (id) =>
      state(world).receipts[`greek-open-door-${id}`] &&
      pack.choices.find((c) => c.id === `greek-open-door-${id}`).text;
    expect(line("colonus-enter")).toMatch(
      /earlier time.*before the deaths of the Theban brothers/,
    );
    expect(line("colonus-daughters")).toMatch(/earlier tale/);
    expect(line("marathon-enter")).toMatch(
      /separate tale.*Demophon, son of Theseus/,
    );
    expect(line("marathon-daughter")).toMatch(/In the tale/);
    expect(pack.avatars["greek-colonus-keeper"].seed).toBe(
      "The Grove Keeper at Colonus.",
    );
    expect(world.actors["greek-antigone"].place).toBe("greek-gate");
    expect(world.actors["greek-creon"].place).toBe("greek-palace");
  });

  it("credits a second player's final deed through save and poem context", () => {
    const id = "greek-open-door-lay-ashes";
    const prior = openDoorJourney().before[id];
    const created = dispatchShared({ op: "create", save: encodeSave(prior) });
    expect(created.ok).toBe(true);
    let world = created.world;
    world.actors.mara.place = "greek-eleusis";
    world.items["greek-ash-urn"].holder = "mara";
    const request = (op, extra = {}) =>
      dispatchShared({
        world,
        op,
        actor: "mara",
        claimed: ["vale", "mara"],
        present: ["vale", "mara"],
        ...extra,
      });
    const view = request("view");
    expect(view.ok).toBe(true);
    const gift = view.actions.find(
      (a) =>
        a.kind === "give" &&
        a.item === "greek-ash-urn" &&
        a.target === "greek-argive-mother",
    );
    expect(gift).toBeTruthy();
    const completed = request("play", { action: gift });
    expect(completed.ok).toBe(true);
    world = reload(completed.world);
    expect(state(world).receipts[id]).toBe(world.turn);
    expect(state(world).recitals[id].actor).toBe("mara");
    expect(
      recitalContext(world, [pack], "greek-rhapsode").stanzas.find(
        (stanza) => stanza.id === id,
      ).authorId,
    ).toBe("mara");
  });
  it.each(["burial", "concession", "exposure"])(
    "opens five places when Dione receives the %s outcome",
    (branch) => {
      const fixture = openingFixture(branch);
      const before =
        branch === "concession"
          ? fixture.permission
          : fixture.choice || fixture.buried;
      // Piraeus Quays lies outside the Open Door: a ship with provisions
      // aboard reaches it. Its stories still wait for Dione's road.
      expect(accessible(before)).toEqual(["greek-piraeus"]);
      let world = fixture.closed;
      expect(accessible(world)).toEqual(OPEN_DOOR_PLACES);
      expect(state(world).choices["greek-theban-response"]).toBe(branch);
      expect(legalActions(world).some((a) => a.kind === "choose")).toBe(false);
      world = openDoorWalk(reload(world), "harbor", "athens");
      // The Long Walls stay shut until the herald's truce is in the Agora;
      // the Sacred Way leads out to the countryside.
      expect(exits(world, "greek-athens", "vale")).toEqual([
        "greek-road-athens-eleusis",
      ]);
      expect(entityActive(world, "greek-thinkery")).toBe(false);
      expect(entityActive(world, "greek-argolid-road")).toBe(false);
      for (let count = 0; count < 3; count++) world = reload(world);
      expect(accessible(world)).toEqual(OPEN_DOOR_PLACES);
      expect(world.items["greek-water-jar"].holder).toBe(
        fixture.closed.items["greek-water-jar"].holder,
      );
    },
  );

  it("keeps the five roads open through a return to the Theban table", () => {
    // Through the plea: the petition rests in the Agora, which keeps the
    // Sacred Way open, and so does the herald's truce for the Long Walls.
    let world = openDoorStart();
    const steps = openDoorSteps();
    for (const { kind, ...fields } of steps.slice(
      0,
      steps.findIndex((step) => step.target === "greek-theseus") + 1,
    ))
      world = playOpenDoor(world, kind, fields);
    world = openDoorWalk(
      world,
      "colonus",
      "marathon",
      "eleusis",
      "athens",
      "piraeus",
      "harbor",
      "courtyard",
    );
    expect(world.actors.vale.place).toBe("greek-courtyard");
    expect(accessible(reload(world))).toEqual(OPEN_DOOR_PLACES);
  });

  it("opens the next journey after a public concession while its burial stays available", () => {
    let world = openingFixture("concession").permissionShared;
    expect(state(world).flags["greek-burial-performed"]).toBeUndefined();
    expect(accessible(world)).toEqual(OPEN_DOOR_PLACES);
    world = openDoorWalk(
      world,
      "harbor",
      "piraeus",
      "harbor",
      "courtyard",
      "gate",
    );
    world = playOpenDoor(world, "give", {
      item: "greek-decree",
      target: "greek-guard",
    });
    world = playOpenDoor(world, "take", { item: "greek-shovel" });
    world = playOpenDoor(openDoorWalk(world, "battlefield"), "wait");
    expect(state(world).receipts["greek-prepare-burial-ground"]).toBeTruthy();
    expect(accessible(reload(world))).toEqual(OPEN_DOOR_PLACES);
  });

  it("keeps Dione's closing report open while the other welcomes are pending", () => {
    let world = openDoorJourney().after["greek-open-door-lay-ashes"];
    world = playOpenDoor(world, "take", { item: "greek-pyre-account" });
    world = openDoorWalk(world, "athens", "harbor", "courtyard");
    world = playOpenDoor(world, "give", {
      item: "greek-pyre-account",
      target: "greek-baker",
    });
    world = playOpenDoor(world, "talk", { target: "greek-baker" });
    expect(
      state(world).receipts["greek-open-door-return-dione"],
    ).toBeUndefined();
    expect(
      state(reload(world)).flags["greek-homecoming-eleusis-reported"],
    ).toBe(true);
  });

  it("preserves an earlier full world and its Egyptian account", () => {
    const earlier = JSON.parse(
      readFileSync(
        new URL(
          "./fixtures/wine-dark-legacy/schema6-egypt.json",
          import.meta.url,
        ),
        "utf8",
      ),
    );
    const world = decodeSave(JSON.stringify(earlier));
    expect(state(world).scope).toBe("full");
    expect(accessible(world)).toEqual(OPEN_DOOR_PLACES);
    expect(entityActive(world, "greek-thinkery")).toBe(true);
    expect(entityActive(world, "greek-helen-troy")).toBe(false);
    expect(world.actors.vale.place).toBe(earlier.actors.vale.place);
    expect(world.log).toEqual(
      earlier.log
        .filter(
          (e) => e.kind !== "quest" && !/-quest$|^pursue$/u.test(e.verb || ""),
        )
        .map(({ questPlan, consequence, questKey, ...e }) => e),
    );
    for (const key of ["choices", "flags", "receipts", "met"])
      expect(state(world)[key]).toEqual(earlier.packs["greek-drama"][key]);
    for (const [id, item] of Object.entries(upgradedItems(earlier.items)))
      expect(world.items[id]).toEqual(item);
    expect(world.quests).toBeUndefined();
    expect(reload(world)).toEqual(world);
  });

  it("shares the open roads with a second player", () => {
    const hosted = dispatchShared({
      op: "create",
      save: encodeSave(openDoorStart()),
    });
    expect(hosted.ok).toBe(true);
    const viewed = dispatchShared({
      op: "view",
      world: hosted.world,
      actor: "mara",
      claimed: ["vale", "mara"],
      present: ["vale", "mara"],
    });
    expect(viewed.ok).toBe(true);
    expect(accessible(viewed.world)).toEqual(OPEN_DOOR_PLACES);
    expect(viewed.world.actors.mara.place).not.toMatch(/^greek-/);
  });

  it("keeps later places and choices behind the first invitation", () => {
    const world = createWorld();
    expect(accessible(world)).toEqual(["greek-piraeus"]);
    for (const place of OPEN_DOOR_PLACES) {
      world.actors.vale.place = place;
      expect(
        legalActions(world).filter(
          (action) =>
            action.kind === "choose" &&
            pack.choices.find(
              (choice) =>
                choice.id === action.choiceId &&
                OPEN_DOOR_PLACES.includes(choice.at),
            ),
        ),
      ).toEqual([]);
    }
  });
});
