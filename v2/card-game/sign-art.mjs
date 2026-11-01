import catalogue from "./sign-art.json" with { type: "json" };

// Presentation reads numeric receipt turns, never log text or insertion order.
// A base-only or unavailable newest sign still wins. No saved state or timer.
export function newestSignPainting(world, id, phase, published) {
  const definition = catalogue[id];
  const receipts = world?.packs?.[definition?.pack]?.receipts;
  if (!receipts) return null;
  let newest = null;
  for (const [choiceId, art] of Object.entries(definition.signs)) {
    const turn = receipts[choiceId];
    if (
      Number.isSafeInteger(turn) &&
      turn > 0 &&
      (!newest || turn > newest.turn)
    )
      newest = { choiceId, turn, art };
  }
  if (!newest) return null;
  const file = newest.art[phase];
  return {
    choiceId: newest.choiceId,
    turn: newest.turn,
    backdrop: file && published[file]?.stage ? file : null,
  };
}
