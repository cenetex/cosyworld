import { expect, it } from "vitest";
import {
  createWorld,
  decodeSave,
  encodeSave,
  legalActions,
  play,
} from "../v2/card-game/world.mjs";
import {
  cardPlay,
  cardObservation,
  playLabel,
} from "../v2/card-game/cards.mjs";
import {
  RADIO_ITEM as radio,
  radioAudible,
} from "../v2/card-game/radio-item.mjs";
const booth = "ratiradio-broadcast-booth";
const fixture = () => {
  const world = createWorld({ seed: 17 });
  // Synthetic custody fixture, not a claim about a live player's possessions.
  for (const item of Object.values(world.items))
    if (item.holder === "vale") item.holder = "attic";
  world.items[radio].holder = "vale";
  return world;
};
const switchAction = (world, actor = "vale") =>
  legalActions(world, actor).find((a) => a.kind === "radio");
it("starts off in the booth and installs off in older saves", () => {
  const world = createWorld({ seed: 17 });
  expect(world.items[radio].holder).toBe(booth);
  expect(radioAudible(world, "vale")).toBe(false);
  delete world.items[radio];
  world.packs.ratiradio.revision = 2;
  const restored = decodeSave(JSON.stringify(world));
  expect(restored.items[radio].holder).toBe(booth);
  expect(restored.items[radio].radioOn).not.toBe(true);
});
it("uses the single item context action and persists accepted on/off state", () => {
  const world = fixture(),
    action = switchAction(world);
  expect(action.radioOn).toBe(true);
  expect(cardPlay(world, [radio]).action).toEqual(action);
  expect(playLabel(action)).toBe("Turn on");
  const result = play(world, action);
  expect(result.ok, result.error).toBe(true);
  expect(radioAudible(result.state, "vale")).toBe(true);
  expect(decodeSave(encodeSave(result.state))).toEqual(result.state);
  expect(play(decodeSave(encodeSave(world)), action)).toEqual(result);
  expect(cardObservation(result.state, radio)).toContain("Radio on");
  expect(play(result.state, action).ok).toBe(false);
  const off = play(result.state, switchAction(result.state));
  expect(off.ok, off.error).toBe(true);
  expect(radioAudible(off.state, "vale")).toBe(false);
});
it("hears a co-located carrier without allowing another person's switch", () => {
  const world = fixture();
  world.items[radio].radioOn = true;
  world.items[radio].holder = "mara";
  world.sharedVersion = 1;
  world.controlledActors = ["vale", "mara"];
  world.presentActors = ["vale", "mara"];
  world.actors.mara.place = world.actors.vale.place;
  expect(radioAudible(world, "vale")).toBe(true);
  expect(switchAction(world)).toBeUndefined();
  expect(switchAction(world, "mara")).toBeDefined();
  world.actors.mara.place = "pond";
  expect(radioAudible(world, "vale")).toBe(false);
  world.actors.mara.place = world.actors.vale.place;
  world.presentActors = ["vale"];
  expect(radioAudible(world, "vale")).toBe(false);
});
it("hears a ground radio only here, honors disabled packs and rejects forged state", () => {
  const world = fixture();
  world.items[radio].radioOn = true;
  world.items[radio].holder = world.actors.vale.place;
  expect(radioAudible(world, "vale")).toBe(true);
  expect(cardPlay(world, [radio, world.actors.vale.place]).action).toEqual(
    switchAction(world),
  );
  world.actors.vale.place = "pond";
  expect(radioAudible(world, "vale")).toBe(false);
  world.items[radio].holder = "pond";
  world.disabledPacks = ["radio"];
  expect(radioAudible(world, "vale")).toBe(false);
  expect(switchAction(world)).toBeUndefined();
  delete world.disabledPacks;
  world.items[radio].radioOn = "true";
  expect(() => decodeSave(JSON.stringify(world))).toThrow();
});

it("replays accepted shared switches from the same synthetic save and rejects stale revisions", async () => {
  const { dispatchShared } = await import("../v2/card-game/shared-world.mjs");
  const created = dispatchShared({ op: "create", save: encodeSave(fixture()) });
  expect(created.ok, created.error).toBe(true);
  const context = {
    actor: "vale",
    claimed: ["vale", "mara"],
    present: ["vale", "mara"],
  };
  let world = created.world;
  const journal = [];
  for (const on of [true, false, true]) {
    const view = dispatchShared({ op: "view", world, ...context });
    const action = view.actions.find((a) => a.kind === "radio");
    const command = {
      op: "play",
      action,
      revision: world.revision,
      ...context,
    };
    const result = dispatchShared({ ...command, world });
    expect(result.ok, result.error).toBe(true);
    expect(result.world.items[radio].radioOn).toBe(on);
    expect(dispatchShared({ ...command, world: result.world }).ok).toBe(false);
    journal.push(command);
    world = result.world;
  }
  let replay = created.world;
  for (const command of journal) {
    const result = dispatchShared({
      ...command,
      world: decodeSave(encodeSave(replay)),
    });
    expect(result.ok, result.error).toBe(true);
    replay = result.world;
  }
  expect(replay).toEqual(world);
  const denied = dispatchShared({
    op: "play",
    world,
    ...context,
    actor: "mara",
    action: journal[0].action,
  });
  expect(denied.ok).toBe(false);
});
