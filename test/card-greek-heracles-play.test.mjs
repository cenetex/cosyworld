import { describe, expect, it } from "vitest";
import {
  createWorld,
  decodeSave,
  encodeSave,
  legalActions,
  play,
} from "../v2/card-game/world.mjs";
import {
  entityActive,
  packDefinition,
} from "../v2/card-game/pack-registry.mjs";
import { recitalPoem } from "../v2/card-game/pack-recital.mjs";
import { authoredStoryDefinitions } from "../v2/card-game/pack-story-quests.mjs";

const prefix = "greek-heracles-";
const house = `${prefix}theban-house`;
const road = `${prefix}athens-road`;
const guestRoom = `${prefix}athens-guest-room`;
const heracles = `${prefix}heracles`;
const theseus = `${prefix}theseus`;
const megara = `${prefix}megara`;

function journey(ending) {
  // Begin at the released courtyard. Every chapter step uses a legal action.
  let world = createWorld();
  world.actors.vale.place = "greek-courtyard";
  world.items.lamp.holder = "station";
  delete world.opening;
  let roundTrips = 0;
  let plays = 0;
  const offers = (kind, fields = {}) =>
    legalActions(world).filter(
      (action) =>
        action.kind === kind &&
        Object.entries(fields).every(([key, value]) => action[key] === value),
    );
  const offeredChoice = (id) =>
    offers("choose", { choiceId: `${prefix}${id}` });
  const step = (kind, fields = {}) => {
    const action = offers(kind, fields)[0];
    expect(
      action,
      `${kind} ${JSON.stringify(fields)} at ${world.actors.vale.place}`,
    ).toBeDefined();
    const beforeTurn = world.turn;
    const result = play(world, action, world.revision);
    expect(result.ok, result.error).toBe(true);
    world = result.state;
    plays++;
    expect(world.turn).toBe(beforeTurn + 1);
    if (kind === "move") expect(world.actors.vale.place).toBe(fields.target);
    if (kind === "take") expect(world.items[fields.item].holder).toBe("vale");
    if (kind === "accompany") {
      expect(world.actors.vale.place).toBe(fields.destination);
      expect(world.actors[fields.target].place).toBe(fields.destination);
      expect(
        world.log.some(
          (entry) =>
            entry.turn === world.turn &&
            entry.verb === "accompany" &&
            entry.actorId === "vale" &&
            entry.targetId === fields.target &&
            entry.accepted,
        ),
      ).toBe(true);
    }
    const loaded = decodeSave(encodeSave(world));
    expect(loaded).toEqual(world);
    world = loaded;
    roundTrips++;
  };
  const choose = (id) => step("choose", { choiceId: `${prefix}${id}` });
  const take = (id) => step("take", { item: `${prefix}${id}` });
  const move = (target) => step("move", { target });
  const accompany = (target, destination) =>
    step("accompany", { target, destination });

  expect(entityActive(world, megara)).toBe(false);
  step("choose", { choiceId: "greek-inquire-euripides-heracles" });
  choose("enter");
  move(house);
  choose("hear-megara");
  const firstMeeting = world.packs["greek-drama"].met[megara];
  expect(firstMeeting).toBeGreaterThan(0);
  choose("hear-amphitryon");
  choose("hear-lycus");
  take("bread");
  take("water-cup");
  choose("set-altar-food");
  expect(world.items[`${prefix}bread`].holder).toBe(house);
  expect(world.items[`${prefix}water-cup`].holder).toBe(house);
  take("help-tablet");
  move(road);
  move(guestRoom);
  choose("deliver-help");
  expect(world.items[`${prefix}help-tablet`].holder).toBe(guestRoom);
  move(road);
  move(house);
  choose("hear-return");
  choose("hear-divine-voices");
  choose("hear-messenger");
  expect(entityActive(world, megara)).toBe(false);
  expect(world.packs["greek-drama"].met[megara]).toBe(firstMeeting);
  choose("hear-theseus");
  choose("hear-heracles");
  take("water-cup");
  take("care-cloth");
  choose("prepare-care");
  expect(world.items[`${prefix}water-cup`].holder).toBe(house);
  expect(world.items[`${prefix}care-cloth`].holder).toBe(house);
  take("funeral-cloth");
  take("remembrance-tablet");
  choose("prepare-funeral");
  expect(world.items[`${prefix}funeral-cloth`].holder).toBe(house);
  expect(world.items[`${prefix}remembrance-tablet`].holder).toBe(house);
  choose("agree-heracles");
  choose("agree-theseus");
  expect(offeredChoice("receive-heracles")).toHaveLength(0);
  expect(offeredChoice("remain-with-heracles")).toHaveLength(0);

  accompany(heracles, road);
  move(house);
  expect(world.actors[heracles].place).toBe(road);
  accompany(theseus, road);
  accompany(heracles, guestRoom);
  choose("receive-heracles");
  expect(offeredChoice("remain-with-heracles")).toHaveLength(0);
  move(road);
  expect(world.actors[heracles].place).toBe(guestRoom);
  accompany(theseus, guestRoom);
  choose("receive-theseus");
  expect(world.actors[heracles].place).toBe(guestRoom);
  expect(world.actors[theseus].place).toBe(guestRoom);
  if (ending === "walk") choose("remain-with-heracles");
  move(road);
  move(house);
  if (ending === "vigil") {
    take("bread");
    take("water-cup");
    choose("return-to-amphitryon");
    expect(world.items[`${prefix}bread`].holder).toBe(house);
    expect(world.items[`${prefix}water-cup`].holder).toBe(house);
  }
  take("remembrance-tablet");
  move("greek-courtyard");
  choose(`report-${ending}`);
  expect(world.items[`${prefix}remembrance-tablet`].holder).toBe(
    "greek-courtyard",
  );
  expect(world.packs["greek-drama"].choices[`${prefix}care`]).toBe(ending);
  expect(offeredChoice(`report-${ending}`)).toHaveLength(0);
  expect(roundTrips).toBe(plays);

  const pack = packDefinition("greek-drama");
  const poem = recitalPoem(world, pack).stanzas.filter((verse) =>
    verse.id.startsWith(prefix),
  );
  expect(poem.map((verse) => verse.id)).toEqual([
    `${prefix}deliver-help`,
    `${prefix}prepare-care`,
    `${prefix}${ending === "walk" ? "remain-with-heracles" : "return-to-amphitryon"}`,
    `${prefix}report-${ending}`,
  ]);
  expect(
    poem.every((verse, index) => !index || verse.turn > poem[index - 1].turn),
  ).toBe(true);
  const stories = authoredStoryDefinitions(world, [pack], {
    history: true,
    group: "heracles",
  });
  expect(stories).toHaveLength(4);
  expect(stories.every((story) => story.resolved)).toBe(true);
  const escorts = world.log.filter(
    (entry) =>
      entry.verb === "accompany" &&
      entry.actorId === "vale" &&
      [heracles, theseus].includes(entry.targetId) &&
      entry.accepted,
  );
  expect(escorts).toHaveLength(4);
  expect(escorts.filter((entry) => entry.targetId === heracles)).toHaveLength(
    2,
  );
  expect(escorts.filter((entry) => entry.targetId === theseus)).toHaveLength(2);
}

describe("Heracles's earlier household and agreed road", () => {
  it.each(["walk", "vigil"])(
    "plays the %s ending with real custody, escorts and exact saved state",
    (ending) => journey(ending),
  );
});
