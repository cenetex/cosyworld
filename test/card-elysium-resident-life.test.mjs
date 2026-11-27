import { expect, it } from "vitest";
import { elysiumModelToken } from "../v2/card-game/elysium-models.mjs";
import { DAYLIGHT_TURNS } from "../v2/card-game/pack-rules.mjs";
import { homeOf, life, rangeOf } from "../v2/card-game/resident-home.mjs";
import { dispatchShared, load } from "../v2/card-game/shared-world.mjs";
import { ACCOMPANY_TRUST } from "../v2/card-game/world/company.mjs";
import {
  createWorld,
  decodeSave,
  encodeSave,
  exits,
  holdChoice,
  legalActions,
  plan,
  play,
} from "../v2/card-game/world.mjs";

const player = "vale";
const resident = "elysium-claude";
const token = elysiumModelToken(resident);
const wayfinder = "elysium-wayfinder";
const study = "elysium-void-002";
const entry = "elysium-void-001";
const mirrors = "elysium-void-003";
const station = "station";
const seat = { actor: player, claimed: [player], present: [player] };

function table(shared) {
  const request = (world, op, extra) =>
    dispatchShared({ world, op, ...seat, ...extra });
  const actions = (world) =>
    shared ? request(world, "view").actions : legalActions(world);
  return {
    start(world) {
      return shared
        ? dispatchShared({ op: "create", save: encodeSave(world) }).world
        : world;
    },
    actions,
    view(world) {
      return shared ? load({ world, ...seat }) : world;
    },
    reload(world) {
      return shared
        ? request(JSON.parse(JSON.stringify(world)), "validate").world
        : decodeSave(encodeSave(world));
    },
    hold(world, item) {
      const choice = { item, revision: world.revision };
      if (shared) return request(world, "hold", { choice }).world;
      holdChoice(world, player, choice);
      return world;
    },
    act(world, fields, portraits) {
      const action = actions(world).find(
        (choice) =>
          !choice.sleep &&
          !choice.guards &&
          Object.entries(fields).every(([key, value]) => choice[key] === value),
      );
      expect(action, JSON.stringify(fields)).toBeDefined();
      const result = shared
        ? request(world, "play", {
            action: action.key,
            elysiumPortraits: portraits,
          })
        : play(world, action, world.revision, player, portraits);
      expect(result.ok, result.error).toBe(true);
      return result.state ?? result.world;
    },
  };
}

function returnToken(game) {
  const start = createWorld({ seed: 17 });
  start.turn = start.revision = DAYLIGHT_TURNS;
  start.actors[player].place = station;
  for (const item of Object.values(start.items))
    if (item.holder === player) item.holder = station;
  start.items[wayfinder].holder = station;
  let world = game.start(start);
  world = game.act(world, { kind: "take", item: wayfinder });
  world = game.act(world, { kind: "move", target: entry });
  world = game.act(world, { kind: "move", target: study });
  world = game.act(world, { kind: "talk", target: resident });
  world = game.act(world, { kind: "move", target: station });
  const target = world.items[token].holder;
  if (target !== station) world = game.act(world, { kind: "move", target });
  world = game.act(world, { kind: "take", item: token });
  world = game.hold(world, wayfinder);
  world = game.act(world, { kind: "move", target: entry });
  world = game.act(world, { kind: "move", target: study });
  return game.act(world, { kind: "give", target: resident, item: token });
}

const wait = { kind: "wait" };
const inviteToMirrors = {
  kind: "accompany",
  target: resident,
  destination: mirrors,
};
const hasInvite = (game, world) =>
  game
    .actions(world)
    .some((action) =>
      Object.entries(inviteToMirrors).every(
        ([key, value]) => action[key] === value,
      ),
    );

it.each([false, true])(
  "graduates a token resident through ordinary life (shared %s)",
  (shared) => {
    const game = table(shared);
    const returned = returnToken(game);
    const give = returned.log.findLast(
      ({ portraitModel }) => portraitModel === resident,
    );
    expect(give).toMatchObject({
      kind: "action",
      verb: "give",
      accepted: true,
      targetId: resident,
    });
    const receipt = { resident, returnedAt: give.seq };
    expect(returned.items[token].holder).toBe(resident);
    expect(returned.actors[resident].trust[player]).toBeGreaterThan(0);

    const pending = game.act(returned, wait, [
      { ...receipt, returnedAt: receipt.returnedAt - 1 },
      { ...receipt, resident: "elysium-gemini" },
    ]);
    expect(pending.elysiumEncounters[resident].portraitReady).toBeFalsy();
    expect(pending.actors[resident].want).toBeNull();
    expect(pending.actors[resident].place).toBe(study);
    expect(rangeOf(pending, resident)).toBe(0);
    expect(exits(game.view(pending), study, resident)).not.toContain(station);
    expect(hasInvite(game, pending)).toBe(false);

    const missingToken = structuredClone(pending);
    missingToken.items[token].holder = player;
    const keptWaiting = game.act(missingToken, wait, [receipt]);
    expect(keptWaiting.elysiumEncounters[resident].portraitReady).toBeFalsy();

    const released = game.act(pending, wait, [receipt]);
    const replayed = game.act(pending, wait, [receipt, receipt]);
    expect(replayed).toEqual(released);
    const saved = game.reload(released);
    expect(saved.elysiumEncounters[resident]).toMatchObject({
      returnedAt: receipt.returnedAt,
      returnedBy: player,
      portraitReady: true,
    });
    expect(saved.actors[resident].trust[player]).toBe(
      returned.actors[resident].trust[player],
    );
    expect(homeOf(resident, saved)).toBe(study);
    expect(rangeOf(saved, resident)).toBe(life.defaults.range);
    expect(exits(game.view(saved), study, resident)).toContain(mirrors);
    expect(exits(game.view(saved), study, resident)).not.toContain(station);
    expect(hasInvite(game, saved)).toBe(true);

    let normal = saved;
    for (let i = 0; i < DAYLIGHT_TURNS && !normal.actors[resident].want; i++)
      normal = game.act(normal, wait);
    const currentWant = normal.actors[resident].want;
    expect(["item", "place", "person"]).toContain(currentWant?.kind);
    expect(currentWant.target).not.toBe(token);

    const choosesMirrors = structuredClone(saved);
    choosesMirrors.actors[resident].want = {
      kind: "place",
      target: mirrors,
      since: choosesMirrors.turn,
      refusals: 0,
    };
    const noFollower = game.act(choosesMirrors, {
      kind: "move",
      target: entry,
    });
    expect(noFollower.actors[resident].place).not.toBe(entry);
    const invited = game.act(choosesMirrors, inviteToMirrors);
    expect(invited.actors[resident].place).toBe(mirrors);
    expect(
      invited.log.findLast(({ verb }) => verb === "accompany"),
    ).toMatchObject({
      accepted: true,
      targetId: resident,
      destinationId: mirrors,
    });

    const trustsTraveler = structuredClone(saved);
    trustsTraveler.actors[resident].trust[player] = ACCOMPANY_TRUST;
    const visiting = game.act(trustsTraveler, {
      ...inviteToMirrors,
      destination: station,
    });
    expect(visiting.actors[resident].place).toBe(station);
    expect(homeOf(resident, game.reload(visiting))).toBe(study);

    let walking = choosesMirrors;
    for (
      let i = 0;
      i < DAYLIGHT_TURNS * 2 && walking.actors[resident].place === study;
      i++
    ) {
      const next = plan(game.view(walking), resident).action;
      if (next?.kind === "move") expect(next.target).toBe(mirrors);
      walking = game.act(walking, wait);
    }
    expect(walking.actors[resident].place).toBe(mirrors);
    expect(walking.actors[player].place).toBe(study);
    expect(walking.actors[resident].xp).toBe(
      choosesMirrors.actors[resident].xp + 1,
    );
    const movement = walking.log.findLast(
      (entry) => entry.verb === "move" && entry.actorId === resident,
    );
    expect(movement).toMatchObject({
      fromLocationId: study,
      locationId: mirrors,
    });
    const migrated = game.reload(walking);
    expect(homeOf(resident, migrated)).toBe(study);
    expect(migrated.elysiumEncounters[resident].portraitReady).toBe(true);
    expect(migrated.items[token].holder).toBe(resident);
    expect(game.reload(migrated)).toEqual(migrated);

    const reunion = game.act(
      game.act(migrated, { kind: "move", target: mirrors }),
      { kind: "talk", target: resident },
    );
    expect(reunion.life.actors[resident].experiences).toContainEqual({
      kind: "talk",
      turn: reunion.turn,
      other: player,
      item: null,
      place: mirrors,
    });

    if (!shared) {
      const sharedTable = table(true);
      const imported = sharedTable.start(reunion);
      expect(imported.elysiumEncounters?.[resident]).toBeUndefined();
      expect(homeOf(resident, imported)).toBe(study);
      expect(imported.actors[resident]).toMatchObject({
        place: study,
        visited: reunion.actors[resident].visited,
        trust: reunion.actors[resident].trust,
        talked: reunion.actors[resident].talked,
        xp: reunion.actors[resident].xp,
      });
      expect(imported.life.actors[resident]).toEqual(
        reunion.life.actors[resident],
      );
      expect(imported.items[token].holder).toBe(resident);
      expect(imported.log.find((entry) => entry.seq === movement.seq)).toEqual(
        movement,
      );
      expect(sharedTable.reload(imported)).toEqual(imported);
    }
  },
);
