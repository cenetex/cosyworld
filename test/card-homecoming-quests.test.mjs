import { describe, expect, it } from "vitest";
import {
  decodeSave,
  encodeSave,
  legalActions,
} from "../v2/card-game/world.mjs";
import { homecomingDefinitions } from "../v2/card-game/homecoming-quests.mjs";
import {
  questCards,
  questHistoryCards,
  questCardId,
  questForCard,
} from "../v2/card-game/quest-cards.mjs";
import { dispatchShared } from "../v2/card-game/shared-world.mjs";
import {
  openDoorJourney,
  openDoorStart,
  openDoorSteps,
  openDoorWalk,
  playOpenDoor,
} from "./helpers/open-door.mjs";
const key = (place) =>
  `greek-drama:story-quest-greek-homecoming-return:${place}`;
const report = (world, id) =>
  playOpenDoor(world, "choose", { choiceId: `greek-homecoming-report-${id}` });

describe("homecoming story cards", () => {
  it("selects each report in a two-card hand after reload", () => {
    let world = openDoorJourney().after["greek-open-door-eleusis-care"];
    world.quests.hands.vale = [key("agora"), key("eleusis")];
    world = decodeSave(encodeSave(world));
    const cards = questCards(world);
    expect(cards.map(({ key }) => key)).toEqual([key("agora"), key("eleusis")]);
    const ids = cards.map((card) => questCardId(world, card));
    expect(new Set(ids).size).toBe(2);
    for (let i = 0; i < cards.length; i++) {
      expect(questForCard(world, ids[i]).key).toBe(cards[i].key);
      expect(questForCard(world, ids[i]).purpose).toBe(cards[i].purpose);
    }
  });
  it("keeps each early report complete while later journeys add their own cards", () => {
    let world = openDoorStart();
    let firstReceipt;
    for (const { kind, ...fields } of openDoorSteps()) {
      world = playOpenDoor(world, kind, fields);
      if (fields.choiceId === "greek-open-door-hear-truce-report") {
        expect(homecomingDefinitions(world).map(({ key }) => key)).toEqual([
          key("agora"),
        ]);
        world = openDoorWalk(world, "harbor", "courtyard");
        world = report(world, "agora-truce");
        firstReceipt = structuredClone(
          world.quests.records[key("agora")].completion,
        );
        expect(firstReceipt).toMatchObject({
          actorId: "vale",
          locationId: "greek-courtyard",
          outcome: "shared",
        });
        world = decodeSave(encodeSave(world));
        world = openDoorWalk(world, "harbor", "athens");
      }
      if (fields.choiceId === "greek-open-door-eleusis-care") {
        expect(world.quests.records[key("agora")].completion).toEqual(
          firstReceipt,
        );
        expect(world.quests.records[key("eleusis")].completedTurn).toBe(null);
        world = openDoorWalk(world, "piraeus", "harbor", "courtyard");
        world = report(world, "eleusis-care");
        expect(
          world.quests.records[key("eleusis")].completion.turn,
        ).toBeGreaterThan(firstReceipt.turn);
        world = openDoorWalk(world, "harbor", "piraeus", "eleusis");
      }
      expect(questCards(world).length).toBeLessThanOrEqual(2);
    }
    expect(world.quests.records[key("agora")].completion).toEqual(firstReceipt);
    const reports = homecomingDefinitions(world);
    expect(reports).toHaveLength(5);
    expect(reports.every(({ resolved }) => resolved)).toBe(true);
    expect(reports.find(({ key: k }) => k === key("agora")).choiceId).toBe(
      "greek-homecoming-report-agora-truce",
    );
    expect(reports.find(({ key: k }) => k === key("marathon")).choiceId).toBe(
      "greek-open-door-return-dione",
    );
    expect(
      legalActions(world).some(({ choiceId }) =>
        choiceId?.startsWith("greek-homecoming-report-"),
      ),
    ).toBe(false);
    const restored = decodeSave(encodeSave(world));
    expect(restored.quests).toEqual(world.quests);
    expect(restored.questCompletions).toEqual(world.questCompletions);
    expect(
      questHistoryCards(restored).filter(
        ({ id }) => id === "story-quest-greek-homecoming-return",
      ),
    ).toHaveLength(5);
    const shared = dispatchShared({
      op: "create",
      save: encodeSave(restored),
    }).world;
    const view = dispatchShared({
      op: "view",
      world: shared,
      actor: "mara",
      claimed: ["vale", "mara"],
      present: ["vale", "mara"],
    });
    expect(view.ok).toBe(true);
    expect(
      questHistoryCards(view.world, "mara").filter(
        ({ id }) => id === "story-quest-greek-homecoming-return",
      ),
    ).toEqual([]);
    expect(view.world.quests.records[key("agora")].completion).toEqual(
      firstReceipt,
    );
  });
});
