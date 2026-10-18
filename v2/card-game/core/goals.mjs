// Target hands and the quest generator for the general card core. Nothing here
// names an entity: every choice reads the world's own registries.

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

export const restingHand = () => ({ items: [], location: null, avatars: [] });
export const newProgress = () => ({
  program: 0,
  step: 0,
  marks: [],
  completedHands: 0,
  recent: [],
  current: null,
});

export const isPlayer = (s, id) => s.avatars[id]?.role === "player";
// Players act first in every ordering, so residents come to players.
export const avatarOrder = (s) => {
  const ids = Object.keys(s.avatars);
  return [
    ...ids.filter((id) => isPlayer(s, id)),
    ...ids.filter((id) => !isPlayer(s, id)),
  ];
};
export const holderOf = (s, item) => s.items[item].holder;
export const itemPlace = (s, item) =>
  s.avatars[holderOf(s, item)]?.place || holderOf(s, item);
export const carried = (s, avatar) =>
  Object.keys(s.items).filter((id) => holderOf(s, id) === avatar);
export const nameOf = (s, id) =>
  s.places[id]?.name || s.avatars[id]?.name || s.items[id]?.name || "the world";

export const programFor = (s, avatar) => s.avatars[avatar].progress.current;
export const targetsFor = (s, avatar) =>
  alternatives(programFor(s, avatar)?.steps[s.avatars[avatar].progress.step]);
export const levelOf = (s, avatar) => 1 + s.avatars[avatar].progress.program;

// Choices use current custody and meetings. Reading a card keeps the save unchanged.
export function desireFor(s, avatar) {
  const here = s.avatars[avatar].place;
  const score = (h) =>
    h.items.filter((id) => holderOf(s, id) !== avatar).length * 20 +
    (h.location && h.location !== here ? 3 : 0) +
    h.avatars.filter((id) => s.avatars[id].place !== (h.location || here))
      .length *
      5;
  return (
    targetsFor(s, avatar)
      .slice()
      .sort((a, b) => score(a) - score(b))[0] || restingHand()
  );
}
export const needed = (s, avatar, item) =>
  desireFor(s, avatar).items.includes(item);

// Breadth-first distances over the current exits, up to a radius.
export function distances(s, from, radius = Infinity) {
  const seen = new Map([[from, 0]]);
  const queue = [from];
  while (queue.length) {
    const place = queue.shift();
    const d = seen.get(place);
    if (d >= radius) continue;
    for (const next of s.places[place].exits)
      if (!seen.has(next)) {
        seen.set(next, d + 1);
        queue.push(next);
      }
  }
  return seen;
}

// FNV-1a over the world seed and the choice, so worlds differ by seed and
// every choice replays exactly.
export function choiceHash(...parts) {
  let h = 0x811c9dc5;
  for (const ch of parts.join(":")) {
    h ^= ch.codePointAt(0);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h;
}

// Build an avatar's next quest from nearby custody, wants, and paths. The
// result is plain saved data, so reloads keep the same bargain.
export function generateQuest(
  s,
  avatar,
  { independent = false, solo = false } = {},
) {
  const progress = s.avatars[avatar].progress;
  const order = avatarOrder(s);
  const here = s.avatars[avatar].place;
  const near = distances(s, here, s.rules.questRadius);
  const reachable = [...near.keys()];
  const pick = (list, salt) =>
    list[choiceHash(s.seed, avatar, progress.program, salt) % list.length];
  const meta = (extra) => ({
    turn: s.turn,
    level: levelOf(s, avatar),
    ...extra,
  });
  const id = `quest-${avatar}-${progress.program + 1}`;
  // A resident does not build a new goal around keeping something another
  // avatar wants now. It can then trade or give that item, so wants cannot
  // lock each other out. Players keep what they carry.
  const wantedElsewhere = (item) =>
    !isPlayer(s, avatar) &&
    order.some((other) => other !== avatar && needed(s, other, item));
  const held = carried(s, avatar).filter((item) => !wantedElsewhere(item));
  const away = reachable.filter((place) => place !== here);
  // A long stall ends with an errand the avatar can finish alone. It keeps
  // only items no one else wants, so its spares become free to give.
  const errand = () => ({
    id,
    name: "An errand alone",
    steps: [
      carryTo(held.slice(0, 2), away.length ? pick(away, "errand") : here),
    ],
    generated: meta({
      item: held[0] ?? null,
      owner: avatar,
      partner: null,
      solo: true,
    }),
  });
  if (solo) return errand();
  const available = (item) => {
    const owner = holderOf(s, item);
    return (
      (!independent || !isPlayer(s, owner)) &&
      near.has(itemPlace(s, item)) &&
      (!s.avatars[owner] || owner === avatar || !needed(s, owner, item))
    );
  };
  const nearby = Object.keys(s.items).filter((item) =>
    near.has(itemPlace(s, item)),
  );
  const start = nearby.length
    ? choiceHash(s.seed, avatar, progress.program, "rotate") % nearby.length
    : 0;
  const rotated = [...nearby.slice(start), ...nearby.slice(0, start)];
  let candidates = rotated.filter((item) => {
    const owner = holderOf(s, item);
    if (!available(item)) return false;
    if (owner === avatar && wantedElsewhere(item)) return false;
    if (!independent || !s.avatars[owner] || owner === avatar) return true;
    const payment = desireFor(s, owner).items.filter(
      (want) => holderOf(s, want) !== owner,
    );
    return !payment.length || payment.some(available);
  });
  if (!candidates.length)
    candidates = rotated.filter(
      (item) => !independent || !isPlayer(s, holderOf(s, item)),
    );
  if (!candidates.length) return errand();
  const recent = progress.recent;
  const score = (item) => {
    const owner = holderOf(s, item);
    let value = owner === avatar ? 0 : s.avatars[owner] ? 6 : 4;
    // Bring players into new bargains regularly. A stalled resident goal can
    // then choose items residents hold, leaving the player's answer voluntary.
    if (!isPlayer(s, avatar) && isPlayer(s, owner))
      value = progress.program % 3 === 0 ? 10 : -2;
    return value - (recent.includes(item) ? 3 : 0);
  };
  const item = candidates
    .map((id, index) => ({ id, index }))
    .sort((a, b) => score(b.id) - score(a.id) || a.index - b.index)[0].id;
  const owner = holderOf(s, item);
  // Players and residents seek each other. A goal favours company from the
  // other side, and a player with no one nearby is sent to the nearest
  // resident, wherever it is.
  const counterpart = (other) => isPlayer(s, other) !== isPlayer(s, avatar);
  const others = order.filter(
    (other) => other !== avatar && near.has(s.avatars[other].place),
  );
  const company = others.filter(counterpart).length
    ? others.filter(counterpart)
    : others;
  const everywhere = distances(s, here);
  const nearest = isPlayer(s, avatar)
    ? order
        .filter((other) => other !== avatar && counterpart(other))
        .sort(
          (a, b) =>
            (everywhere.get(s.avatars[a].place) ?? Infinity) -
            (everywhere.get(s.avatars[b].place) ?? Infinity),
        )[0]
    : undefined;
  const partner =
    s.avatars[owner] && owner !== avatar
      ? owner
      : company.length
        ? pick(company, "partner")
        : (nearest ?? null);
  const meetingPlaces =
    partner && !near.has(s.avatars[partner].place)
      ? [s.avatars[partner].place]
      : reachable;
  const payment =
    owner !== avatar && s.avatars[owner]
      ? desireFor(s, owner).items.find(
          (want) =>
            holderOf(s, want) !== owner && want !== item && available(want),
        )
      : null;
  const destinations = reachable.filter(
    (place) => place !== itemPlace(s, item),
  );
  const occupied = destinations.filter((place) =>
    order.some(
      (other) =>
        other !== avatar &&
        counterpart(other) &&
        s.avatars[other].place === place,
    ),
  );
  const destination = occupied.length
    ? pick(occupied, "destination")
    : destinations.length
      ? pick(destinations, "destination")
      : here;
  const extra =
    levelOf(s, avatar) >= 5
      ? held.find((id) => id !== item && id !== payment)
      : null;
  const finalItems = [item, ...(extra ? [extra] : [])];
  const gathering = hand(hold(payment || item));
  const journey = carryTo(finalItems, destination);
  const steps = partner
    ? progress.program % 2
      ? [gathering, journey, meet([item], partner, meetingPlaces)]
      : [gathering, meet([item], partner, meetingPlaces), journey]
    : [gathering, journey];
  return {
    id,
    name: payment
      ? `A trade with ${nameOf(s, partner)}`
      : `${nameOf(s, item)} journey`,
    steps: sequence(...steps),
    generated: meta({ item, owner, partner }),
  };
}
