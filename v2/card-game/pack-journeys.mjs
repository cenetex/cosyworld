// An agreed journey uses ordinary movement, one edge at a time.
// The resident's saved place is the current step; arrival keeps them there.
export const journeyOptions = (journey) =>
  Array.isArray(journey) ? journey : journey ? [journey] : [];

const agreedJourneys = (world, pack, id) =>
  journeyOptions(pack?.avatars[id]?.journey).filter(
    (journey) => world.packs?.[pack.id]?.receipts?.[journey.after],
  );

export function journeyNextPlace(world, pack, id) {
  const agreed = agreedJourneys(world, pack, id);
  if (agreed.length !== 1) return null;
  const journey = agreed[0];
  const step = journey.path.indexOf(world.actors[id]?.place);
  return step < 0 ? null : journey.path[step + 1] || null;
}

export function independentJourneyNextPlace(world, pack, id) {
  const agreed = agreedJourneys(world, pack, id);
  return agreed.length === 1 && agreed[0].independent === true
    ? journeyNextPlace(world, pack, id)
    : null;
}

export function journeyReservation(world, pack, id) {
  const agreed = agreedJourneys(world, pack, id);
  if (agreed.length !== 1 || agreed[0].exclusive !== true) return null;
  const from = world.actors[id]?.place;
  const next = journeyNextPlace(world, pack, id);
  const vessel = Object.values(pack.transports || {}).find(
    (transport) => transport.place === from || transport.place === next,
  );
  return vessel
    ? { actor: id, place: vessel.place, from, aboard: from === vessel.place }
    : null;
}

export function journeyKeepsItem(world, pack, id, item) {
  const agreed = agreedJourneys(world, pack, id);
  return (
    agreed.length === 1 &&
    !!agreed[0].cargo?.includes(item) &&
    !world.packs[pack.id].receipts[agreed[0].until]
  );
}

export function validJourneyPlaces(world, pack) {
  return Object.entries(pack.avatars).every(([id, avatar]) => {
    if (!avatar.journey) return true;
    const agreed = agreedJourneys(world, pack, id);
    const place = world.actors[id]?.place;
    if (
      agreed.length === 1 &&
      agreed[0].cargo?.some(
        (item) =>
          journeyKeepsItem(world, pack, id, item) &&
          world.items[item]?.holder !== id,
      )
    )
      return false;
    const reservation = journeyReservation(world, pack, id);
    if (
      reservation?.aboard &&
      Object.entries(world.actors).some(
        ([other, actor]) => other !== id && actor.place === reservation.place,
      )
    )
      return false;
    return agreed.length
      ? agreed.length === 1 && agreed[0].path.includes(place)
      : place === avatar.place;
  });
}
