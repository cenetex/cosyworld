import { createWorld } from "../../v2/card-game/world.mjs";

export const RESIDENTS = ["co-ann", "co-bo", "co-cy"];

export function bondedWorld({ seed = 5, trust = 2, turn = 60 } = {}) {
  const s = createWorld({ seed });
  s.turn = s.revision = turn;
  s.actors.vale.place = "co-a";
  for (const id of RESIDENTS) {
    const a = s.actors[id];
    a.place = "co-a";
    a.content = true;
    delete a.sleeping;
    for (const o of RESIDENTS) if (o !== id) a.trust[o] = trust;
  }
  for (const id of ["co-ann", "co-bo"])
    s.actors[id].want = { kind: "item", target: "co-key", since: turn, refusals: 0 };
  s.actors["co-cy"].want = null;
  for (const id of ["co-oak", "co-dee"]) s.actors[id].place = "co-b";
  for (const id of ["moth", "keeper"]) {
    Object.assign(s.actors[id], { place: "attic", want: null, content: true });
    s.actors[id].sleeping = { since: turn, place: "attic", until: turn + 47 };
  }
  for (const [pack, who] of [
    ["co-home", [...RESIDENTS, "co-oak"]],
    ["co-away", ["co-dee"]],
  ])
    for (const id of who) s.packs[pack].met[id] = 0;
  return s;
}
