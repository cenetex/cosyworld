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
import { questCards, questHistoryCards } from "../v2/card-game/quest-cards.mjs";
import { storyGroupDefinitions } from "./helpers/story-groups.mjs";
import { dispatchShared } from "../v2/card-game/shared-world.mjs";
import { recitalPoem, recitalContext } from "../v2/card-game/pack-recital.mjs";
import { questRecord } from "../v2/card-game/shared-quests.mjs";
import { openingFixture } from "./helpers/greek-opening.mjs";
import {
  OPEN_DOOR_PLACES,
  openDoorInvitation,
  openDoorJourney,
  openDoorStart,
  openDoorWalk,
  playOpenDoor,
} from "./helpers/open-door.mjs";

const state = (world) => world.packs["greek-drama"];
const accessible = (world) =>
  OPEN_DOOR_PLACES.filter((id) => entityActive(world, id));
const reload = (world) => decodeSave(encodeSave(world));
const pack = packDefinition("greek-drama");
const storyKey = (id) => `greek-drama:story-quest-greek-open-door-${id}`;

describe("the Open Door", () => {
  it.each([
    {
      recovery: "truce",
      eleusis: "care",
      berth: "family",
      colonus: "custom",
      marathon: "hearing",
    },
    {
      recovery: "recovery",
      eleusis: "pledge",
      berth: "open",
      colonus: "family",
      marathon: "alcmene",
    },
  ])(
    "carries the five stories home through the $recovery branch",
    (options) => {
      const { world, before } = openDoorJourney(options);
      expect(world.actors.vale.place).toBe("greek-courtyard");
      for (const id of ["eleusis", "piraeus", "colonus", "marathon"])
        expect(state(world).flags[`greek-open-door-${id}-done`]).toBe(true);
      expect(state(world).flags["greek-open-door-returned"]).toBe(true);
      expect(state(world).choices).toMatchObject({
        "greek-open-door-recovery":
          options.recovery === "truce" ? "truce" : "force",
        "greek-open-door-eleusis": options.eleusis,
        "greek-open-door-berth": options.berth,
        "greek-open-door-colonus": options.colonus,
        "greek-open-door-marathon": options.marathon,
      });
      const cards = questHistoryCards(world).filter((card) =>
        card.id?.startsWith("story-quest-greek-open-door-"),
      );
      expect(cards).toHaveLength(6);
      expect(cards.every((card) => card.resolved && card.singleLine)).toBe(
        true,
      );
      expect(questCards(world).length).toBeLessThanOrEqual(2);
      for (const id of [
        "eleusis",
        "agora",
        "piraeus",
        "colonus",
        "marathon",
        "return",
      ])
        expect(questRecord(world, storyKey(id)).completion).toMatchObject({
          actorId: "vale",
          participants: ["vale"],
        });
      expect(questRecord(world, storyKey("return")).completion).toMatchObject({
        outcome: "shared",
        locationId: "greek-courtyard",
      });
      for (const [item, place] of Object.entries({
        "greek-burial-petition": "greek-athens",
        "greek-return-cloths": "greek-eleusis",
        "greek-ash-urn": "greek-eleusis",
        "greek-return-list": "greek-piraeus",
        "greek-grove-cup": "greek-colonus",
        "greek-grove-honey": "greek-colonus",
        "greek-refuge-tablet": "greek-colonus",
        "greek-shelter-blanket": "greek-marathon",
      }))
        expect(world.items[item].holder).toBe(place);
      const poem = recitalPoem(world, pack);
      expect(
        poem.stanzas.some(
          (verse) => verse.id === "greek-open-door-return-dione",
        ),
      ).toBe(true);
      expect(
        poem.stanzas.some(
          (verse) =>
            verse.id === `greek-open-door-marathon-${options.marathon}`,
        ),
      ).toBe(true);
      const restored = reload(reload(world));
      expect(restored.quests).toEqual(world.quests);
      expect(restored.questCompletions).toEqual(world.questCompletions);
      expect(recitalPoem(restored, pack)).toEqual(poem);
      for (const [id, prior] of Object.entries(before)) {
        expect(questCards(prior).length).toBeLessThanOrEqual(2);
        const stale = legalActions(prior).find(
          (action) => action.choiceId === id,
        );
        expect(play(restored, stale).ok, id).toBe(false);
      }
    },
  );

  it("requires the acting traveler to carry the petition and each offering", () => {
    const { before } = openDoorJourney();
    for (const [id, item] of [
      ["register-plea", "greek-burial-petition"],
      ["lay-cloths", "greek-return-cloths"],
      ["lay-ashes", "greek-ash-urn"],
      ["family-berth", "greek-return-list"],
      ["colonus-water", "greek-grove-honey"],
      ["colonus-custom", "greek-refuge-tablet"],
      ["marathon-blanket", "greek-shelter-blanket"],
    ]) {
      const choiceId = `greek-open-door-${id}`;
      const world = structuredClone(before[choiceId]);
      const offered = legalActions(world).find(
        (action) => action.choiceId === choiceId,
      );
      expect(offered).toBeTruthy();
      world.items[item].holder = "mara";
      expect(
        legalActions(world).some((action) => action.choiceId === choiceId),
      ).toBe(false);
      const denied = play(world, offered);
      expect(denied.ok).toBe(false);
      expect(state(world).receipts[choiceId]).toBeUndefined();
      expect(world.items[item].holder).toBe("mara");
    }
  });

  it("keeps remembered generations in their named tales", () => {
    const { world } = openDoorJourney();
    const line = (id) =>
      world.log.find((event) => event.choiceId === `greek-open-door-${id}`)
        ?.text;
    expect(line("colonus-enter")).toMatch(
      /earlier time.*before the deaths of the Theban brothers/,
    );
    expect(line("colonus-daughters")).toMatch(/earlier tale/);
    expect(line("marathon-enter")).toMatch(
      /separate tale.*Demophon, son of Theseus/,
    );
    expect(line("marathon-daughter")).toMatch(/In the tale/);
    expect(pack.avatars["greek-colonus-keeper"].persona).toContain(
      "remembered people",
    );
    expect(pack.avatars["greek-marathon-keeper"].persona).toContain(
      "Demophon’s generation",
    );
    expect(world.actors["greek-antigone"].place).toBe("greek-gate");
    expect(world.actors["greek-creon"].place).toBe("greek-palace");
  });

  it("credits a joined player's final deed through save and poem context", () => {
    const prior = openDoorJourney().before["greek-open-door-eleusis-care"];
    const created = dispatchShared({ op: "create", save: encodeSave(prior) });
    expect(created.ok).toBe(true);
    let world = created.world;
    world.actors.mara.place = "greek-eleusis";
    const request = (op, extra = {}) =>
      dispatchShared({
        world,
        op,
        actor: "mara",
        claimed: ["vale", "mara"],
        present: ["vale", "mara"],
        ...extra,
      });
    let view = request("view");
    expect(view.ok).toBe(true);
    expect(
      questHistoryCards(view.world, "mara").filter((card) => card.story),
    ).toEqual([]);
    const join = view.actions.find(
      (action) =>
        action.kind === "join-quest" && action.questKey === storyKey("eleusis"),
    );
    expect(join).toBeTruthy();
    const joined = request("play", { action: join });
    expect(joined.ok).toBe(true);
    world = joined.world;
    view = request("view");
    const choice = view.actions.find(
      (action) => action.choiceId === "greek-open-door-eleusis-care",
    );
    expect(choice).toBeTruthy();
    const completed = request("play", { action: choice });
    expect(completed.ok).toBe(true);
    world = reload(completed.world);
    expect(questRecord(world, storyKey("eleusis")).completion).toMatchObject({
      actorId: "mara",
      participants: ["mara", "vale"],
      locationId: "greek-eleusis",
    });
    expect(state(world).recitals["greek-open-door-eleusis-care"].actor).toBe(
      "mara",
    );
    expect(
      recitalContext(world, [pack], "greek-rhapsode").stanzas.find(
        (stanza) => stanza.id === "greek-open-door-eleusis-care",
      ).authorId,
    ).toBe("mara");
    expect(questCards(world, "mara").length).toBeLessThanOrEqual(2);
  });
  it.each(["burial", "concession", "refusal", "exposure"])(
    "opens five places after Dione hears the %s account",
    (branch) => {
      const fixture = openingFixture(branch);
      const before =
        branch === "concession"
          ? fixture.permission
          : fixture.choice || fixture.buried;
      expect(openDoorInvitation(before)).toBeUndefined();
      expect(accessible(fixture.closed)).toEqual([]);
      const invitation = openDoorInvitation(fixture.closed);
      expect(invitation).toBeTruthy();
      let world = playOpenDoor(fixture.closed, "choose", {
        choiceId: invitation.choiceId,
      });
      expect(accessible(world)).toEqual(OPEN_DOOR_PLACES);
      expect(state(world).choices["greek-theban-response"]).toBe(branch);
      expect(storyGroupDefinitions(world, "open-door")).toEqual([]);
      expect(play(world, invitation).ok).toBe(false);
      world = openDoorWalk(reload(world), "harbor", "athens");
      expect(exits(world, "greek-athens", "vale")).toEqual(
        expect.arrayContaining([
          "greek-athens-harbor",
          "greek-road-athens-piraeus",
          "greek-colonus",
        ]),
      );
      expect(entityActive(world, "greek-thinkery")).toBe(false);
      expect(entityActive(world, "greek-argolid-road")).toBe(false);
      expect(state(world).receipts[invitation.choiceId]).toBe(
        state(fixture.closed).receipts[invitation.choiceId] ||
          fixture.closed.turn + 1,
      );
      for (let count = 0; count < 3; count++) world = reload(world);
      expect(accessible(world)).toEqual(OPEN_DOOR_PLACES);
      expect(world.items["greek-water-jar"].holder).toBe(
        fixture.closed.items["greek-water-jar"].holder,
      );
    },
  );

  it("keeps the five roads open through a return to the Theban table", () => {
    let world = openDoorStart();
    world = openDoorWalk(
      world,
      "harbor",
      "athens",
      "piraeus",
      "athens",
      "colonus",
      "athens",
      "eleusis",
      "athens",
      "marathon",
      "athens",
      "harbor",
      "courtyard",
    );
    expect(world.actors.vale.place).toBe("greek-courtyard");
    expect(accessible(reload(world))).toEqual(OPEN_DOOR_PLACES);
    expect(questCards(world).length).toBeLessThanOrEqual(2);
  });

  it("opens the next journey after a public concession while its burial stays available", () => {
    let world = openingFixture("concession").permissionShared;
    expect(state(world).flags["greek-burial-performed"]).toBeUndefined();
    const invitation = openDoorInvitation(world);
    expect(invitation).toBeTruthy();
    world = playOpenDoor(world, "choose", { choiceId: invitation.choiceId });
    world = openDoorWalk(
      world,
      "harbor",
      "athens",
      "harbor",
      "courtyard",
      "gate",
    );
    world = playOpenDoor(world, "take", { item: "greek-shovel" });
    world = openDoorWalk(world, "battlefield");
    expect(
      legalActions(world).some(
        (action) => action.choiceId === "greek-prepare-permitted-burial",
      ),
    ).toBe(true);
    expect(accessible(reload(world))).toEqual(OPEN_DOOR_PLACES);
  });

  it("keeps Dione's closing report open while the other welcomes are pending", () => {
    let world = openDoorJourney().after["greek-open-door-eleusis-care"];
    world = openDoorWalk(world, "athens", "harbor", "courtyard");
    expect(
      storyGroupDefinitions(world, "open-door").find(
        (card) => card.key === storyKey("return"),
      ),
    ).toMatchObject({ resolved: false, completion: "Shared" });
    expect(
      legalActions(world).some(
        (action) => action.choiceId === "greek-open-door-return-dione",
      ),
    ).toBe(false);
    expect(state(reload(world)).flags["greek-open-door-eleusis-done"]).toBe(
      true,
    );
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
    expect(world.log).toEqual(earlier.log);
    for (const key of ["choices", "flags", "receipts", "met"])
      expect(state(world)[key]).toEqual(earlier.packs["greek-drama"][key]);
    for (const [id, item] of Object.entries(earlier.items))
      expect(world.items[id]).toEqual(item);
    expect(
      questHistoryCards(world, "mara").filter((card) => card.story),
    ).toEqual([]);
    expect(reload(world)).toEqual(world);
  });

  it("shares the open roads while each player keeps their own deeds", () => {
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
    expect(
      questHistoryCards(viewed.world, "mara").filter((card) => card.story),
    ).toEqual([]);
    expect(
      questHistoryCards(viewed.world, "vale").filter((card) => card.story),
    ).toHaveLength(3);
  });

  it("keeps later places and choices behind the first invitation", () => {
    const world = createWorld();
    expect(accessible(world)).toEqual([]);
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
