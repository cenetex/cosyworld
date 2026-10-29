import { describe, expect, it } from "vitest";
import { decodeSave, encodeSave } from "../v2/card-game/world.mjs";
import {
  packDefinition,
  packDefinitions,
  entityActive,
  crossings,
} from "../v2/card-game/pack-registry.mjs";
import { newMemories } from "../v2/card-game/memory.mjs";
import { recitalPoem } from "../v2/card-game/pack-recital.mjs";
import { emptyPoemReadings } from "../v2/card-game/poem-readings.mjs";
import { legacyGreekSeaPaths } from "../v2/card-game/legacy-greek-seaways.mjs";
import { dispatchShared } from "../v2/card-game/shared-world.mjs";
import { releasedCardEngine } from "./helpers/released-card-engine.mjs";

const released = releasedCardEngine(20);
const oldGreek = released.packs.find((pack) => pack.id === "greek-drama");
const currentGreek = packDefinition("greek-drama");
const newCatalogIds = (field) =>
  packDefinitions.flatMap((pack) => {
    const previous = released.packs.find((old) => old.id === pack.id);
    return Object.keys(pack[field] || {}).filter(
      (id) => !previous?.[field]?.[id],
    );
  });
const humans = ["vale", "mara"];
const actors = [
  "greek-danaid-melia",
  "greek-danaid-nera",
  "greek-alcestis-alcestis",
  "greek-alcestis-heracles",
  "greek-alcestis-chloris",
  "greek-heracles-megara",
  "greek-heracles-amphitryon",
  "greek-heracles-heracles",
  "greek-heracles-theseus",
  "greek-trachis-deianira",
  "greek-trachis-iole",
  "greek-trachis-hyllus",
  "greek-trachis-lichas",
  "greek-trachis-heracles",
];
const items = [
  "greek-danaid-branch",
  "greek-danaid-water-jug",
  "greek-danaid-host-pledge",
  "greek-danaid-provisions",
  "greek-alcestis-cup",
  "greek-alcestis-wine-jug",
  "greek-alcestis-loaf",
  "greek-alcestis-care-tablet",
  "greek-heracles-bread",
  "greek-heracles-water-cup",
  "greek-heracles-care-cloth",
  "greek-heracles-funeral-cloth",
  "greek-heracles-help-tablet",
  "greek-heracles-remembrance-tablet",
  "greek-trachis-meal",
  "greek-trachis-wool-remnant",
  "greek-trachis-treated-robe",
  "greek-trachis-plain-cloth",
  "greek-trachis-gift-casket",
  "greek-trachis-water-flask",
];
const places = [
  "greek-danaid-refuge-court",
  "greek-heracles-theban-house",
  "greek-heracles-athens-road",
  "greek-heracles-athens-guest-room",
  "greek-trachis-canae-approach",
];

function releasedDeeds(scope) {
  let world = released.dispatch({ op: "create" }).world;
  // The fixture begins after the two humans have reached the Greek shore.
  // All deeds, transfers and verses below use the frozen rules-20 interpreter.
  delete world.opening;
  world.packs["greek-drama"].scope = scope;
  world.actors.vale.place = "greek-courtyard";
  world.actors.mara.place = "greek-well";
  world.items.lamp.holder = "greek-courtyard";
  const initial = structuredClone(world),
    commands = [];
  function act(actor, kind, fields) {
    const request = { actor, world, claimed: humans, present: humans };
    const view = released.dispatch({ ...request, op: "view" });
    expect(view.ok, view.error).toBe(true);
    const action = view.actions.find(
      (candidate) =>
        candidate.kind === kind &&
        Object.entries(fields).every(
          ([key, value]) => candidate[key] === value,
        ),
    );
    expect(action, `${actor} ${kind} ${JSON.stringify(fields)}`).toBeDefined();
    const command = {
      op: "play",
      actor,
      claimed: humans,
      present: humans,
      action,
      revision: world.revision,
    };
    const result = released.dispatch({ ...command, world });
    expect(result.ok, result.error).toBe(true);
    world = result.world;
    commands.push(structuredClone(command));
  }
  act("mara", "take", { item: "greek-water-jar" });
  act("mara", "move", { target: "greek-courtyard" });
  act("mara", "choose", { choiceId: "greek-return-water-jar" });
  act("mara", "take", { item: "greek-bread" });
  act("vale", "move", { target: "greek-gate" });
  act("vale", "choose", { choiceId: "greek-hear-decree" });
  act("vale", "choose", { choiceId: "greek-decline-burial" });
  act("vale", "move", { target: "greek-courtyard" });
  act("vale", "choose", { choiceId: "greek-courtyard-refusal" });
  act("vale", "choose", { choiceId: "greek-open-door-invite-refusal" });
  act("vale", "take", { item: "lamp" });
  let replay = structuredClone(initial);
  for (const command of commands) {
    const result = released.dispatch({ ...command, world: replay });
    expect(result.ok, result.error).toBe(true);
    replay = result.world;
  }
  expect(replay).toEqual(world);
  return { world, commands, initial };
}

function expectNewRecords(world, before) {
  expect(actors).toHaveLength(14);
  expect(items).toHaveLength(20);
  expect(places).toHaveLength(5);
  expect(
    Object.keys(world.actors)
      .filter((id) => !before.actors[id])
      .sort(),
  ).toEqual(newCatalogIds("avatars").sort());
  expect(
    Object.keys(world.items)
      .filter((id) => !before.items[id])
      .sort(),
  ).toEqual(newCatalogIds("items").sort());
  expect(
    Object.keys(world.memories)
      .filter((id) => !before.memories[id])
      .sort(),
  ).toEqual(["avatars", "items", "places"].flatMap(newCatalogIds).sort());
  const fresh = newMemories();
  for (const id of actors) {
    expect(before.actors[id]).toBeUndefined();
    expect(world.actors[id]).toMatchObject({
      place: currentGreek.avatars[id].place,
      progress: { program: 0, step: 0, marks: [] },
      crossed: 0,
      lastTalk: -9,
    });
    expect(world.actors[id].trust).toEqual({});
    expect(world.peaceUntil[id]).toBe(0);
    expect(entityActive(world, id)).toBe(false);
  }
  for (const id of items)
    expect(world.items[id]).toEqual({
      holder: currentGreek.items[id].holder,
      history: [],
    });
  for (const id of [...actors, ...items, ...places])
    expect(world.memories[id]).toEqual(fresh[id]);
}

function expectRetainedRecords(world, before) {
  expect(world.packs["greek-drama"]).toEqual({
    ...before.packs["greek-drama"],
    revision: 8,
    poemReadings: emptyPoemReadings(),
  });
  for (const [id, actor] of Object.entries(before.actors))
    expect(world.actors[id]).toEqual(actor);
  for (const [id, item] of Object.entries(before.items))
    expect(world.items[id]).toEqual(item);
  for (const [id, memory] of Object.entries(before.memories))
    expect(world.memories[id]).toEqual(memory);
  for (const [id, peace] of Object.entries(before.peaceUntil))
    expect(world.peaceUntil[id]).toBe(peace);
  for (const [id, life] of Object.entries(before.life.actors))
    expect(world.life.actors[id]).toEqual(life);
  for (const [id, known] of Object.entries(before.knowledge.known))
    expect(world.knowledge.known[id]).toEqual(known);
  for (const [key, record] of Object.entries(before.quests.records))
    expect(world.quests.records[key]).toEqual(record);
  for (const key of [
    "schema",
    "turn",
    "eventSeq",
    "log",
    "transports",
    "invitedPlaces",
  ])
    expect(world[key]).toEqual(before[key]);
  expect(world.crossings).toEqual({
    ...before.crossings,
    ...Object.fromEntries(
      crossings
        .filter((crossing) => !before.crossings[crossing.id])
        .map((crossing) => [crossing.id, { discovered: false }]),
    ),
  });
  for (const [actor, routes] of Object.entries(before.routeKnowledge)) {
    const campRoutes = routes.flatMap(([from, to]) =>
      [from, to].includes("greek-susa") &&
      [from, to].includes("greek-scythian-crag")
        ? [
            [from, "greek-vii-crag-camp"],
            ["greek-vii-crag-camp", to],
          ]
        : [[from, to]],
    );
    const seaPaths = legacyGreekSeaPaths.flatMap((path) => [
      path,
      [...path].reverse(),
    ]);
    const expected = campRoutes.flatMap(([from, to]) => {
      const path = seaPaths.find(
        (path) => path[0] === from && path.at(-1) === to,
      );
      return path
        ? path.slice(1).map((place, index) => [path[index], place])
        : [[from, to]];
    });
    expect(world.routeKnowledge[actor]).toEqual([
      ...new Map(expected.map((edge) => [JSON.stringify(edge), edge])).values(),
    ]);
  }
  for (const [id, record] of Object.entries(before.packs)) {
    if (id === "greek-drama") continue;
    const pack = packDefinition(id);
    expect(world.packs[id]).toEqual(
      pack.personalQuests?.length
        ? {
            ...record,
            revision: pack.revision,
            personalQuests: Object.fromEntries(
              pack.personalQuests.map((quest) => [
                quest.id,
                { legacy: true, version: 1, records: {} },
              ]),
            ),
          }
        : record,
    );
  }
  expect(recitalPoem(world, currentGreek)).toEqual(
    released.poem(before, oldGreek),
  );
  expect(world.items.lamp.holder).toBe("vale");
  expect(world.items["greek-bread"].holder).toBe("mara");
  expect(world.items["greek-water-jar"].holder).toBe("greek-courtyard");
  expect(
    world.packs["greek-drama"].recitals["greek-return-water-jar"].actor,
  ).toBe("mara");
  expect(
    world.packs["greek-drama"].recitals["greek-decline-burial"].actor,
  ).toBe("vale");
}

describe("Book II keeps released rules-20 deeds", () => {
  it.each(["opening", "full"])(
    "adds revision-eight records to the %s save and keeps earlier custody and verse authors",
    (scope) => {
      const { world: before, initial, commands } = releasedDeeds(scope);
      expect(before.packs["greek-drama"].revision).toBe(7);
      expect(
        released.poem(before, oldGreek).stanzas.map((verse) => verse.id),
      ).toEqual([
        "greek-return-water-jar",
        "greek-decline-burial",
        "greek-courtyard-refusal",
      ]);
      const checkpoint = JSON.stringify(before);
      const after = decodeSave(checkpoint);
      expect(after.revision).toBe(before.revision);
      expectNewRecords(after, before);
      expectRetainedRecords(after, before);
      const persisted = encodeSave(after);
      const reopened = decodeSave(persisted);
      expect(reopened).toEqual(after);
      expect(encodeSave(reopened)).toBe(persisted);
      expect(decodeSave(encodeSave(reopened))).toEqual(after);

      // A recorded rules upgrade follows the same migration after replaying
      // the accepted old commands through their original interpreter.
      let replayed = structuredClone(initial);
      for (const command of commands) {
        const result = released.dispatch({ ...command, world: replayed });
        expect(result.ok, result.error).toBe(true);
        replayed = result.world;
      }
      const upgraded = dispatchShared({
        op: "upgrade",
        from: "full-card-world/20",
        to: "full-card-world/22",
        actor: "vale",
        world: replayed,
        claimed: humans,
        present: humans,
      });
      expect(upgraded.ok, upgraded.error).toBe(true);
      expect(upgraded.world.revision).toBe(before.revision + 1);
      expectNewRecords(upgraded.world, before);
      expectRetainedRecords(upgraded.world, before);
      expect(decodeSave(encodeSave(upgraded.world))).toEqual(upgraded.world);
      const mara = dispatchShared({
        op: "view",
        actor: "mara",
        world: upgraded.world,
        claimed: humans,
        present: humans,
      });
      expect(mara.actor).toBe("mara");
      expect(mara.room).toBe("greek-courtyard");
      expect(mara.world.items["greek-bread"].holder).toBe("mara");
    },
  );
});

describe("earlier visits to existing Book II places", () => {
  it.each([
    "greek-trachis",
    "greek-oeta",
    "greek-pherae",
    "greek-argos-sanctuary",
  ])("keeps a full-access rules-20 visitor at %s", (place) => {
    const old = released.dispatch({ op: "create" }).world;
    delete old.opening;
    old.packs["greek-drama"].scope = "full";
    old.actors.vale.place = place;
    expect(entityActive(decodeSave(JSON.stringify(old)), place)).toBe(true);
    const upgraded = decodeSave(JSON.stringify(old));
    expect(upgraded.actors.vale.place).toBe(place);
    expect(decodeSave(encodeSave(upgraded))).toEqual(upgraded);
  });
});
