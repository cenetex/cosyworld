import { usedUp } from "./item-use.mjs";
import { neverBack } from "./pack-registry.mjs";
import { PLACE_FROM, heldOf, releaseQuest, sameQuest } from "./want.mjs";
import { places, things } from "./world/catalog.mjs";
import { looseThings, placeMet, placeWant } from "./world/offers.mjs";

const homeOf = (id) => things[id]?.holder;
function setCard(s, place, item) {
  const cards = { ...s.placeCard };
  if (item) cards[place] = item;
  else delete cards[place];
  if (Object.keys(cards).length) s.placeCard = cards;
  else delete s.placeCard;
}

export function settlePlaceCards(s, actor, api) {
  for (const [place, item] of Object.entries(s.placeCard || {})) {
    if (neverBack(s, item) || usedUp(s, item)) setCard(s, place, null);
    else if (s.items[item].holder === place) {
      const want = placeWant(s, place);
      setCard(s, place, null);
      if (placeMet(s, place).includes(item)) continue;
      s.placeMet = { ...s.placeMet, [place]: [...placeMet(s, place), item] };
      api.log(actor, want, place);
      for (const a of Object.values(s.actors))
        for (const held of heldOf(a))
          if (held.from === `${PLACE_FROM}${place}` && sameQuest(held, want)) releaseQuest(a, held);
    }
  }
  const loose = looseThings(s);
  for (const place of Object.keys(loose).sort())
    if (!s.placeCard?.[place]) setCard(s, place, loose[place][0]);
}

export function validPlaceCard(s) {
  if (s.placeCard === undefined) return true;
  const entries =
    s.placeCard && typeof s.placeCard === "object" && !Array.isArray(s.placeCard)
      ? Object.entries(s.placeCard)
      : null;
  return Boolean(
    entries?.length &&
      entries.every(
        ([place, item]) =>
          Object.hasOwn(places, place) &&
          Object.hasOwn(s.items, item) &&
          homeOf(item) === place &&
          !placeMet(s, place).includes(item),
      ),
  );
}
