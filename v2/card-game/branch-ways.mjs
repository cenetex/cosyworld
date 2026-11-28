import { claimTruth, sawBranch } from "./claims.mjs";
import { conditionsMet, packEntity } from "./pack-registry.mjs";

function settled(s, id, packId, key) {
  const known = s.knowledge?.known?.[id];
  const told = Object.entries(known || {}).some(
    ([fact, m]) =>
      m.status &&
      claimTruth(packId, s.knowledge.facts[fact]?.source.about).some((c) => c.key === key),
  );
  return (
    told ||
    sawBranch(known ? s : { ...s, knowledge: { facts: {}, known: { [id]: {} } } }, id, packId, key)
  );
}

export function waySaid(s, id, to) {
  const packId = packEntity(to)?.packId,
    truth = packId ? claimTruth(packId, to) : [];
  if (!truth.length) return true;
  if (!conditionsMet(s, packId, truth)) return false;
  if (!s.actors[id])
    return truth.every((c) => claimTruth(packId, id).some((own) => own.key === c.key));
  return truth.every((c) => settled(s, id, packId, c.key));
}
