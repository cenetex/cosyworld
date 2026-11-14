import assert from "node:assert/strict";
import { verifyStore } from "./card-store.mjs";

export function admitStore(v2, table, options) {
  const admitted = verifyStore(v2, options);
  const groups = { ...table.hub.switchable };
  for (const { entry, world } of admitted) {
    assert(
      !Object.hasOwn(groups, entry.id),
      "Store group conflicts with the hub",
    );
    groups[entry.id] = { name: world.name, packs: [entry.id] };
  }
  table.hub.switchable = groups;
  return admitted.map(({ entry, world, bridge }) => [entry.id, world, bridge]);
}
