import { beforeAll, describe, expect, it } from "vitest";
import {
  createWorld,
  decodeSave,
  encodeSave,
  legalActions,
  play,
} from "../v2/card-game/world.mjs";

const prefix = "greek-heracles-";
const megara = `${prefix}megara`;
let living, closed, later;

beforeAll(() => {
  let world = createWorld();
  world.actors.vale.place = "greek-courtyard";
  world.items.lamp.holder = "station";
  delete world.opening;
  const step = (kind, fields = {}) => {
    const action = legalActions(world).find(
      (entry) =>
        entry.kind === kind &&
        Object.entries(fields).every(([k, v]) => entry[k] === v),
    );
    expect(action).toBeDefined();
    const result = play(world, action, world.revision);
    expect(result.ok, result.error).toBe(true);
    world = decodeSave(encodeSave(result.state));
  };
  const choose = (id) => step("choose", { choiceId: `${prefix}${id}` });
  const take = (item) => step("take", { item: `${prefix}${item}` });
  const move = (id) => step("move", { target: `${prefix}${id}` });
  step("choose", { choiceId: "greek-inquire-euripides-heracles" });
  choose("enter");
  move("theban-house");
  choose("hear-megara");
  living = structuredClone(world);
  choose("hear-amphitryon");
  choose("hear-lycus");
  take("bread");
  take("water-cup");
  choose("set-altar-food");
  take("help-tablet");
  move("athens-road");
  move("athens-guest-room");
  choose("deliver-help");
  move("athens-road");
  move("theban-house");
  choose("hear-return");
  choose("hear-divine-voices");
  choose("hear-messenger");
  closed = structuredClone(world);
  for (let n = 0; n < 3; n++) step("wait");
  later = structuredClone(world);
});

const reject = (source, edit) => {
  const forged = structuredClone(source);
  edit(forged);
  expect(() => decodeSave(JSON.stringify(forged))).toThrow();
};

describe("recorded actor phases", () => {
  it("keeps the same actor history before and after the recorded closure", () => {
    for (const world of [living, closed, later])
      expect(decodeSave(encodeSave(world))).toEqual(world);
    expect(closed.packs["greek-drama"].met[megara]).toBe(
      living.packs["greek-drama"].met[megara],
    );
  });
  it("checks the meeting turn while the actor is still present", () => {
    reject(living, (world) => {
      world.packs["greek-drama"].met[megara] = 0;
    });
  });
  it("checks the meeting turn after the actor's scene has closed", () => {
    reject(closed, (world) => {
      world.packs["greek-drama"].met[megara] = 0;
    });
  });
  it("keeps a fixed closed actor at the authored home", () => {
    reject(closed, (world) => {
      world.actors[megara].place = "greek-harbor";
    });
  });
  it("keeps a closed actor's last conversation within the recorded phase", () => {
    reject(later, (world) => {
      world.actors[megara].lastTalk = world.turn;
    });
  });
  it("keeps a fixed closed actor's crossing count at zero", () => {
    reject(later, (world) => {
      world.actors[megara].crossed = 1;
    });
  });
  it("keeps a meeting before the event that closes its actor", () => {
    reject(closed, (world) => {
      world.packs["greek-drama"].met[megara] =
        world.packs["greek-drama"].receipts[`${prefix}hear-messenger`];
    });
  });
  it("requires the recorded closure that explains an absent actor", () => {
    reject(closed, (world) => {
      delete world.packs["greek-drama"].receipts[`${prefix}hear-messenger`];
    });
  });
});
