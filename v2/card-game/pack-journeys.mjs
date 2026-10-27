// An agreed journey uses the ordinary Accompany action, one road at a time.
// The resident's saved place is the current step; arrival keeps them there.
export function journeyNextPlace(world, pack, id) {
  const journey = pack?.avatars[id]?.journey;
  if (!journey || !world.packs?.[pack.id]?.receipts?.[journey.after])
    return null;
  const step = journey.path.indexOf(world.actors[id]?.place);
  return step < 0 ? null : journey.path[step + 1] || null;
}

export function validJourneyPlaces(world, pack) {
  return Object.entries(pack.avatars).every(([id, avatar]) => {
    const journey = avatar.journey;
    if (!journey) return true;
    const place = world.actors[id]?.place;
    return world.packs?.[pack.id]?.receipts?.[journey.after]
      ? journey.path.includes(place)
      : place === journey.path[0];
  });
}
