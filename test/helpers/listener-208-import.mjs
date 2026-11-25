import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import vm from "node:vm";

export function listener208Import(done = false) {
  const content = execFileSync("git", ["show",
    "e953dd2aedaaf82ebebe030c13fcdbb7009c284b:v2/orchestrator-rust/src/card_shared/content.json",
  ], { encoding: "utf8", maxBuffer: 64 << 20 });
  const catalog = JSON.parse(content);
  const runtime = vm.createContext({ structuredClone, cardContent: catalog });
  vm.runInContext(readFileSync(new URL(
    "../../v2/orchestrator-rust/src/card_shared/engine-v208.js", import.meta.url,
  ), "utf8"), runtime);
  const dispatch = (request) => JSON.parse(runtime.cardShared(JSON.stringify(request)));
  let world = dispatch({ op: "create", seed: 23 }).world;
  const context = { actor: "vale", claimed: ["vale"], present: ["vale"] };
  const act = (kind, target) => {
    const action = dispatch({ ...context, op: "view", world }).actions.find(
      (a) => a.kind === kind && !a.sleep && !a.guards &&
        (target === undefined || a.target === target),
    );
    assert(action, `${kind}:${target}`);
    const result = dispatch({ ...context, op: "play", world, action });
    assert(result.ok, result.error);
    world = result.world;
  };
  world = dispatch({ ...context, op: "hold", world,
    choice: { item: null, revision: world.revision },
  }).world;
  act("move", "pond");
  world.actors.vale.arcana = { proved: [], did: [], calls: 3 };
  act("wait");
  act("talk", "listener");
  if (done) {
    for (const item of Object.values(world.items))
      if (item.holder === "vale") item.holder = "pond";
    world.actors.vale.heldItem = null;
    const visited = world.actors.vale.visited;
    const places = catalog.files["v2/card-game/packs.json"].packs
      .flatMap((pack) => Object.keys(pack.places));
    visited.push(...places.filter((id) => !visited.includes(id)).slice(0, 6));
    world = dispatch({ ...context, op: "hold", world,
      choice: { item: null, revision: world.revision },
    }).world;
    assert.equal(world.actors.vale.arcana.spread[0].done, true);
  }
  world.actors.vale.arcana.calls = 3;
  act("wait");
  act("talk", "listener");
  const opening = `The Listener turns over The Fool${done ? ":" : ", still to do:"}`;
  assert(world.log.some((entry) => entry.text.startsWith(opening)));
  assert(world.memories.vale.events.some((entry) => entry.text.startsWith(`World: ${opening}`)));
  return world;
}
