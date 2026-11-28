// Talk can ask for help until the traveler's next play. Its unlocked quest persists.
export function askOffer(s, actor, them) {
  s.actors[actor].offered = { from: them, turn: s.turn };
}
export const offerFrom = (s, actor) => s.actors[actor]?.offered?.from ?? null;
export function lapseOffer(s, actor) {
  if (s.actors[actor]) delete s.actors[actor].offered;
}
export function pruneOffers(s) {
  for (const a of Object.values(s.actors))
    if (a.offered && s.actors[a.offered.from]?.place !== a.place)
      delete a.offered;
}

export function validOffered(s, id) {
  const offered = s.actors[id].offered;
  if (offered === undefined) return true;
  return Boolean(
    offered &&
      typeof offered === "object" &&
      Object.keys(offered).sort().join() === "from,turn" &&
      offered.from !== id &&
      Object.hasOwn(s.actors, offered.from) &&
      Number.isSafeInteger(offered.turn) &&
      offered.turn >= 0 &&
      offered.turn <= s.turn,
  );
}
