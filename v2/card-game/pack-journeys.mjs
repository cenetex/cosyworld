// A journey keeps its agreed waypoint while its traveller visits elsewhere.
const agreed = (world, pack, journey) =>
  Object.hasOwn(world.packs?.[pack.id]?.receipts || {}, journey.after);

export function installJourneyProgress(world, packs) {
  if (world.journeyProgress !== undefined) return;
  world.journeyProgress = {};
  for (const pack of packs)
    for (const [id, { journey }] of Object.entries(pack.avatars))
      if (journey && agreed(world, pack, journey))
        world.journeyProgress[id] = {
          agreement: journey.after,
          step: journey.path.indexOf(world.actors[id]?.place),
        };
}

export function agreeJourney(world, pack, choice) {
  for (const [id, { journey }] of Object.entries(pack.avatars))
    if (journey?.after === choice)
      (world.journeyProgress ??= {})[id] = { agreement: choice, step: 0 };
}

export function advanceJourney(world, pack, id, from, to) {
  const journey = pack?.avatars[id]?.journey;
  const progress = world.journeyProgress?.[id];
  if (
    journey &&
    progress &&
    agreed(world, pack, journey) &&
    journey.path[progress.step] === from &&
    journey.path[progress.step + 1] === to
  )
    progress.step += 1;
}

export function journeyNextPlace(world, pack, id) {
  const journey = pack?.avatars[id]?.journey;
  const progress = world.journeyProgress?.[id];
  if (!journey || !progress || !agreed(world, pack, journey)) return null;
  const waypoint = journey.path[progress.step];
  return world.actors[id]?.place === waypoint
    ? journey.path[progress.step + 1] || null
    : waypoint;
}

export function journeyChoiceReady(world, pack, choice) {
  const journey = pack.avatars[choice.subject]?.journey;
  return (
    !journey ||
    choice.at !== journey.path.at(-1) ||
    choice.id === journey.after ||
    world.journeyProgress?.[choice.subject]?.step === journey.path.length - 1
  );
}

export function validJourneyProgress(world, packs) {
  const records = world.journeyProgress;
  if (!records || typeof records !== "object" || Array.isArray(records))
    return false;
  if (
    Object.keys(records).some(
      (id) => !packs.some((p) => p.avatars[id]?.journey),
    )
  )
    return false;
  return packs.every((pack) =>
    Object.entries(pack.avatars).every(([id, avatar]) => {
      const journey = avatar.journey;
      if (!journey) return true;
      const progress = records[id];
      return agreed(world, pack, journey)
        ? progress &&
            Object.keys(progress).sort().join() === "agreement,step" &&
            progress.agreement === journey.after &&
            Number.isSafeInteger(progress.step) &&
            progress.step >= 0 &&
            progress.step < journey.path.length
        : progress === undefined;
    }),
  );
}
