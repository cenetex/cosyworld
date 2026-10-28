import { openDoorSteps, openDoorStart, playOpenDoor } from "./open-door.mjs";
import { greekMoveSteps } from "./greek-travel.mjs";

export const homecomingChoose = (id) => ({
  kind: "choose",
  choiceId: `greek-homecoming-${id}`,
});
export const homecomingMove = (...ids) =>
  ids.map((id) => ({ kind: "move", target: `greek-${id}` }));

export function homecomingSteps({ berth = "family", reading = "basket" } = {}) {
  const fromPiraeus = greekMoveSteps("greek-piraeus");
  const fromCourtyard = greekMoveSteps("greek-courtyard");
  const returnHome = greekMoveSteps("greek-piraeus");
  const opening = openDoorSteps({ berth });
  const berthIndex = opening.findIndex(
    (a) => a.choiceId === `greek-open-door-${berth}-berth`,
  );
  return [
    ...opening.slice(0, berthIndex + 1),
    ...fromPiraeus("athens", "harbor", "courtyard"),
    homecomingChoose(`report-piraeus-${berth}`),
    ...fromCourtyard("harbor", "athens", "eleusis"),
    homecomingChoose("agree-journey"),
    {
      kind: "accompany",
      target: "greek-household-witness",
      destination: "greek-road-piraeus-eleusis",
    },
    {
      kind: "accompany",
      target: "greek-household-witness",
      destination: "greek-piraeus",
    },
    ...(berth === "family"
      ? [
          { kind: "take", item: "greek-provision-basket" },
          {
            kind: "give",
            item: "greek-provision-basket",
            target: "greek-household-witness",
          },
        ]
      : []),
    homecomingChoose(`receive-${berth}`),
    { kind: "take", item: "greek-return-list" },
    ...returnHome("athens", "harbor", "courtyard"),
    homecomingChoose(`read-${reading}-${berth}`),
  ];
}

export function homecomingJourney(options) {
  let world = openDoorStart();
  const before = {},
    after = {};
  for (const { kind, ...fields } of homecomingSteps(options)) {
    if (fields.choiceId) before[fields.choiceId] = world;
    world = playOpenDoor(world, kind, fields);
    if (fields.choiceId) after[fields.choiceId] = world;
  }
  return { world, before, after };
}
