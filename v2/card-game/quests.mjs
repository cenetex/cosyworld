// Hand parts combine at one moment. Sequences join reusable steps;
// either offers several hands that can complete the same step.
export const hold = (...items) => ({ items });
export const at = (location) => ({ location });
export const withAvatars = (...avatars) => ({ avatars });
export function hand(...parts) {
  const locations = [
    ...new Set(parts.flatMap((p) => (p.location ? [p.location] : []))),
  ];
  if (locations.length > 1) throw new Error("A hand needs one location.");
  return {
    items: [...new Set(parts.flatMap((p) => p.items || []))],
    location: locations[0] || null,
    avatars: [...new Set(parts.flatMap((p) => p.avatars || []))],
  };
}
export const sequence = (...parts) =>
  structuredClone(
    parts.flatMap((p) =>
      Array.isArray(p) ? sequence(...p) : p.steps ? sequence(...p.steps) : [p],
    ),
  );
export const alternatives = (step) => step?.any || (step ? [step] : []);
export function either(...hands) {
  const any = hands.flatMap(alternatives);
  if (!any.length) throw new Error("Choose at least one target hand.");
  return { any: structuredClone(any) };
}
export const meet = (items, avatar, locations) =>
  either(
    ...locations.map((location) =>
      hand(hold(...items), at(location), withAvatars(avatar)),
    ),
  );
export const carryTo = (items, location) => hand(hold(...items), at(location));

export const questPrograms = {
  vale: [
    {
      id: "borrowed-light",
      name: "Borrowed light",
      steps: [
        { items: ["lamp"], location: "station", avatars: ["moth"] },
        { items: ["oil"], location: "attic", avatars: ["keeper"] },
        { items: ["cloth"], location: "pond", avatars: ["moth"] },
      ],
    },
    {
      id: "the-bell-below",
      name: "The bell below",
      steps: [
        { items: ["bell"], location: "pond", avatars: ["keeper"] },
        { items: ["lamp", "bell"], location: "station", avatars: ["moth"] },
      ],
    },
  ],
  moth: [
    {
      id: "a-light-and-a-witness",
      name: "A light and a witness",
      steps: [
        { items: ["lamp"], location: "pond", avatars: ["vale"] },
        { items: ["oil"], location: "attic", avatars: ["keeper"] },
      ],
    },
    {
      id: "a-veil-for-the-eye",
      name: "A veil for the eye",
      steps: [
        { items: ["cloth"], location: "pond", avatars: ["vale"] },
        { items: ["lamp"], location: "station", avatars: ["keeper"] },
      ],
    },
  ],
  keeper: [
    {
      id: "the-quiet-hour",
      name: "The quiet hour",
      steps: [
        { items: ["bell"], location: "attic", avatars: ["vale"] },
        { items: ["cloth"], location: "attic", avatars: ["moth"] },
      ],
    },
    {
      id: "the-hour-below",
      name: "The hour below",
      steps: [
        { items: ["bell"], location: "pond", avatars: ["vale"] },
        { items: ["oil"], location: "station", avatars: ["moth"] },
      ],
    },
  ],
};
export const restingHands = {
  vale: { items: [], location: null, avatars: [] },
  moth: { items: [], location: "pond", avatars: [] },
  keeper: { items: [], location: "attic", avatars: [] },
};
export const newProgress = () => ({ program: 0, step: 0, marks: [] });
export const programFor = (s, actor) =>
  questPrograms[actor][s.actors[actor].progress.program] ||
  s.actors[actor].progress.current ||
  null;
export const targetsFor = (s, actor) =>
  alternatives(programFor(s, actor)?.steps[s.actors[actor].progress.step]);
const ownerOf = (s, item) => {
  let owner = s.items[item].holder;
  const seen = new Set([item]);
  while (s.items[owner]) {
    if (seen.has(owner)) throw new Error("An item holds itself.");
    seen.add(owner);
    owner = s.items[owner].holder;
  }
  return owner;
};
// Choices use current custody and meetings. Reading a card keeps the save unchanged.
export const desireFor = (s, actor) => {
  const here = s.actors[actor].place;
  const score = (h) =>
    h.items.filter((id) => ownerOf(s, id) !== actor).length * 20 +
    (h.location && h.location !== here ? 3 : 0) +
    h.avatars.filter((id) => s.actors[id].place !== (h.location || here))
      .length *
      5;
  return (
    targetsFor(s, actor)
      .slice()
      .sort((a, b) => score(a) - score(b))[0] || restingHands[actor]
  );
};
export const levelOf = (s, actor) => 1 + s.actors[actor].progress.program;

// Resolve new programs once, at a level boundary, from real custody and paths.
// The resulting hands are plain saved data, so reloads keep the same bargain.
export function generateProgram(
  s,
  actor,
  places,
  things,
  { independent = false } = {},
) {
  const progress = s.actors[actor].progress;
  const actors = Object.keys(s.actors),
    ids = Object.keys(s.items);
  const here = s.actors[actor].place;
  const reachable = [here];
  for (let i = 0; i < reachable.length; i++)
    for (const next of places[reachable[i]].exits)
      if (!reachable.includes(next)) reachable.push(next);
  const placeOf = (item) =>
    s.actors[ownerOf(s, item)]?.place || ownerOf(s, item);
  const bundle = (item) =>
    ids.filter((id) => id === item || s.items[id].holder === item);
  const held = ids.filter((id) => ownerOf(s, id) === actor);
  const needed = (owner, item) =>
    bundle(item).some((id) => desireFor(s, owner).items.includes(id));
  const available = (item) => {
    const owner = ownerOf(s, item);
    return (
      (!independent || owner !== "vale") &&
      reachable.includes(placeOf(item)) &&
      (!s.actors[owner] || owner === actor || !needed(owner, item))
    );
  };
  const rotation = (progress.program + actors.indexOf(actor)) % ids.length;
  const rotated = [...ids.slice(rotation), ...ids.slice(0, rotation)];
  const candidates = rotated.filter((id) => {
    const owner = ownerOf(s, id);
    if (s.items[s.items[id].holder] || !available(id)) return false;
    if (!independent || !s.actors[owner] || owner === actor) return true;
    const payment = desireFor(s, owner).items.filter(
      (item) => ownerOf(s, item) !== owner,
    );
    return !payment.length || payment.some(available);
  });
  if (!candidates.length)
    candidates.push(
      ...rotated.filter(
        (id) =>
          !s.items[s.items[id].holder] &&
          (!independent || ownerOf(s, id) !== "vale") &&
          reachable.includes(placeOf(id)),
      ),
    );
  const recent = progress.recent || [];
  const score = (item) => {
    const owner = ownerOf(s, item);
    let value = owner === actor ? 0 : s.actors[owner] ? 6 : 4;
    // Bring Vale into new bargains regularly. A stalled cast goal can then
    // choose items held by the cast, leaving the player's response voluntary.
    if (actor !== "vale" && owner === "vale")
      value = progress.program % 3 === 0 ? 10 : -2;
    return value - (recent.includes(item) ? 3 : 0);
  };
  const item = candidates.sort((a, b) => score(b) - score(a))[0];
  if (!item)
    throw new Error("The world needs an available item for a new quest.");
  const owner = ownerOf(s, item);
  const others = actors.filter((id) => id !== actor);
  const partner =
    s.actors[owner] && owner !== actor
      ? owner
      : others[(progress.program + actors.indexOf(actor)) % others.length];
  const payment =
    owner !== actor && s.actors[owner]
      ? desireFor(s, owner).items.find(
          (id) => ownerOf(s, id) !== owner && id !== item && available(id),
        )
      : null;
  const destinations = reachable.filter((id) => id !== placeOf(item));
  const destination =
    destinations[
      (progress.program + actors.indexOf(actor)) % destinations.length
    ] || here;
  const extra =
    levelOf(s, actor) >= 5
      ? held.find(
          (id) => id !== item && id !== payment && !bundle(item).includes(id),
        )
      : null;
  const finalItems = [
    item,
    ...(extra && new Set([...bundle(item), extra]).size <= 3 ? [extra] : []),
  ];
  const gathering = hand(hold(payment || item));
  const meeting = meet([item], partner, reachable);
  const journey = carryTo(finalItems, destination);
  return {
    id: `generated-${actor}-${progress.program + 1}`,
    name: payment
      ? `A trade with ${partner === "moth" ? "Pip" : partner === "keeper" ? "the keeper" : "Vale"}`
      : `${things[item].name} journey`,
    steps: sequence(
      gathering,
      ...(progress.program % 2 ? [journey, meeting] : [meeting, journey]),
    ),
    generated: { turn: s.turn, level: levelOf(s, actor), item, owner, partner },
  };
}
