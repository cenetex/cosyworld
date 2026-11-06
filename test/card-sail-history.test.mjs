import { describe, expect, it } from "vitest";
import {
  createWorld,
  decodeSave,
  encodeSave,
  legalActions,
  play,
} from "../v2/card-game/world.mjs";
import { cardActions, playLabel, restPlays } from "../v2/card-game/cards.mjs";
import { memoryVisits, sceneBeats } from "../v2/card-game/beats.mjs";
import {
  IDLE_ROUNDS,
  summonTransport,
} from "../v2/card-game/pack-transport.mjs";

const ship = "greek-ship";
const act = (world, kind, target) => {
  const action = legalActions(world).find(
    (a) => a.kind === kind && (!target || a.target === target),
  );
  expect(action, `${kind} ${target || ""}`).toBeTruthy();
  const result = play(world, action);
  expect(result.ok, result.error).toBe(true);
  return result.state;
};
function aboard(dock = "greek-harbor") {
  const world = createWorld();
  world.crossings["pond-greek-harbor"].discovered = true;
  world.actors.vale.place = dock;
  summonTransport(world, ship, dock);
  return act(world, "move", ship);
}
const chosen = (world, cards) =>
  restPlays(world, cardActions(world, cards).actions, false, cards)[0];
const lastWait = (world) =>
  world.log.findLast((e) => e.actorId === "vale" && e.verb === "wait");
const caption = (world, seq = lastWait(world).seq) =>
  sceneBeats(world)
    .flatMap((b) => b.actions)
    .find((a) => a.seq === seq)?.text;

describe("sailing action history", () => {
  it("keeps a dockside wait as a wait", () => {
    const world = act(aboard(), "wait");
    expect(world.transports[ship].phase).toBe("docked");
    expect(caption(world)).toBe("Vale waited a turn.");
    expect(caption(decodeSave(encodeSave(world)))).toBe("Vale waited a turn.");
  });

  it("records the voyage when an idle ship carries its waiting passenger on", () => {
    let world = aboard("pond");
    for (let i = 0; i < IDLE_ROUNDS; i++) world = act(world, "wait");
    expect(world.transports[ship].phase).toBe("sea");
    expect(world.log.some((e) => e.text.includes("sails on its own"))).toBe(
      true,
    );
    expect(caption(decodeSave(encodeSave(world)))).toBe("Vale sailed on.");
  });

  it("gives ship and avatar selections the same saved sailing outcome", () => {
    const world = act(aboard(), "course", "pond");
    const sail = chosen(world, [ship]),
      wait = chosen(world, ["vale"]);
    expect([playLabel(sail), playLabel(wait)]).toEqual(["Sail", "Wait"]);
    expect(sail.key).toBe(wait.key);
    const sailed = play(world, sail).state,
      waited = play(world, wait).state;
    expect(encodeSave(sailed)).toBe(encodeSave(waited));
    expect(lastWait(sailed).text).toBe("Vale waits one turn.");
    expect(sailed.transports[ship].phase).toBe("arrived");
    const restored = decodeSave(encodeSave(sailed));
    expect(caption(restored)).toBe("Vale sailed on.");
    expect(
      memoryVisits(restored)
        .flatMap((v) => v.beats)
        .flatMap((b) => b.actions)
        .find((a) => a.seq === lastWait(restored).seq)?.text,
    ).toBe("Vale sailed on.");
    // The action and its later voyage event are enough after earlier history expires.
    restored.log = restored.log.filter((e) => e.seq >= lastWait(restored).seq);
    expect(caption(restored)).toBe("Vale sailed on.");
    // A partial old log keeps its recorded Wait when the voyage evidence is missing.
    restored.log = restored.log.filter((e) => e.actorId);
    expect(caption(restored)).toBe("Vale waited a turn.");
  });

  it("uses each turn's voyage while later waits remain at the dock", () => {
    let world = act(aboard(), "course", "pond");
    world = act(world, "wait");
    const sailedSeq = lastWait(world).seq;
    world = act(world, "wait");
    expect(world.transports[ship].phase).toBe("arrived");
    expect(caption(world)).toBe("Vale waited a turn.");
    expect(caption(world, sailedSeq)).toBe("Vale sailed on.");
    world = act(world, "move", "pond");
    const remembered = memoryVisits(decodeSave(encodeSave(world))).find(
      (v) => v.placeId === ship,
    );
    expect(
      remembered.beats
        .flatMap((b) => b.actions)
        .find((a) => a.seq === sailedSeq)?.text,
    ).toBe("Vale sailed on.");
  });
});
