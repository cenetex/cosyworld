import { describe, expect, it } from "vitest";
import "./helpers/still-cast.mjs";
import { createWorld, legalActions, play } from "../v2/card-game/world.mjs";
import { boxesAt } from "../v2/card-game/world/boxes.mjs";
import {
  entityActive,
  latchRoutes,
  packDefinition,
} from "../v2/card-game/pack-registry.mjs";

const forest = "lonely-forest";
const CARDS = [
  ["forest-arcanum-0", forest, (s) => (s.packs[forest].met.skull = true)],
  ["forest-arcanum-1", forest, "forest-scarf-vale-sewn"],
  ["forest-arcanum-2", forest, "forest-walkers-heard"],
  ["forest-arcanum-3", forest, "forest-welcomed"],
  ["forest-arcanum-4", forest, "forest-watch-kept"],
  ["forest-arcanum-5", forest, "forest-oak-heard"],
];
const world = () => createWorld({ seed: 7 });
const prove = (s, pack, proof) => {
  if (typeof proof === "function") proof(s);
  else s.packs[pack].flags[proof] = true;
  latchRoutes(s);
};

describe.each(CARDS)("arcanum %s", (id, pack, proof) => {
  const place = packDefinition(pack).items[id].holder;
  const shut = (s) => boxesAt(s, place, "vale").find((box) => box.id === id);

  it("lies shut at its place until its act is done", () => {
    const s = world();
    expect(s.items[id].holder).toBe(place);
    expect(entityActive(s, id)).toBe(false);
    expect(shut(s)).toMatchObject({ kind: "item", open: false });
  });

  it("opens on the act and stays open when the act's facts change", () => {
    const s = world();
    prove(s, pack, proof);
    expect(s.openedRoutes).toContain(`item:${id}`);
    expect(entityActive(s, id)).toBe(true);
    if (typeof proof === "string") s.packs[pack].flags[proof] = false;
    else s.packs[pack].met = {};
    expect(entityActive(s, id)).toBe(true);
  });

  it("can be taken once open", () => {
    const proved = world();
    prove(proved, pack, proof);
    const s = world();
    s.openedRoutes = proved.openedRoutes;
    s.actors.vale.place = place;
    const take = legalActions(s).find(
      (a) => a.kind === "take" && a.item === id,
    );
    expect(take).toBeTruthy();
    const done = play(s, take, s.revision);
    expect(done.ok, done.error).toBe(true);
    expect(done.state.items[id].holder).toBe("vale");
  });
});
