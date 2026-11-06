import { visitors } from "../../v2/card-game/human-cast.mjs";
import { canonicalPlace } from "../../v2/card-game/pack-registry.mjs";

// A synthetic save from before Greek revision 21 predates the shade.
export function beforeFuneral(world) {
  const id = "greek-polynices-shade";
  for (const records of [
    world.actors,
    world.memories,
    world.peaceUntil,
    world.motives?.grievances,
  ])
    if (records) delete records[id];
  for (const actor of Object.values(world.actors)) delete actor.trust?.[id];
  return world;
}

// Save upgrades drop the old flask's dose count; one flask now fills one lamp.
export function upgradedItems(items) {
  const next = structuredClone(items);
  if (next.oil) delete next.oil.doses;
  return next;
}

// The Theban outcomes wait unseen where their deeds will be done.
export const thebanItems = {
  "greek-burial-account": { holder: "greek-battlefield", history: [] },
  "greek-creon-writ": { holder: "greek-palace", history: [] },
  "greek-guard-tablet": { holder: "greek-gate", history: [] },
};

// The Athenian outcomes wait the same way (Greek revision 15).
export const athenianItems = {
  "greek-pyre-account": { holder: "greek-eleusis", history: [] },
  "greek-marathon-record": { holder: "greek-marathon", history: [] },
};

// Revision 9 of the Greek pack adds the olive branch that became the
// herald's truce; later content adds the outcomes and the two branch clues.
export const branchItems = {
  "greek-olive-branch": { holder: "greek-athens", history: [] },
  "greek-helen-accounts": { holder: "greek-harbor", history: [] },
  "greek-atreid-record": { holder: "greek-argolid-road", history: [] },
  ...thebanItems,
  ...athenianItems,
};

// Greek revision 12 retires places; a resident of one lives where it was
// taken in.
export function upgradedActor(actor) {
  const next = { ...actor };
  for (const field of ["place", "home"])
    if (next[field]) next[field] = canonicalPlace(next[field]);
  return next;
}

// Home doors moved off the pond in rules 87; each world places its own, so
// an upgrade replaces a save's home crossings rather than keeping them.
const homes = visitors.map((a) => a.home.id);
export const withoutHomeDoors = (crossings) =>
  Object.fromEntries(
    Object.entries(crossings).filter(
      ([id]) =>
        !homes.some((h) => id.startsWith(`${h}-`) || id.endsWith(`-${h}`)),
    ),
  );
