// Browser oracle for card_table.c protocol 1. The server commits every play.
export const command = Object.freeze({
  claim: 1,
  release: 2,
  enter: 3,
  leave: 4,
  travel: 5,
  take: 6,
  drop: 7,
  give: 8,
  use: 9,
  talk: 10,
  wait: 11,
});
export function newTable() {
  return {
    version: 1,
    claimed: Array(8).fill(0),
    present: Array(8).fill(0),
    places: Array.from({ length: 8 }, (_, i) => i + 1),
    holders: Array(8).fill(-1),
    uses: Array(8).fill(0),
    homes: Array.from({ length: 8 }, (_, i) => i + 1),
    gates: [-1, 0, 1, 2, 3, 4, 5, 6, 7],
    turn: 0,
  };
}
const avatar = (n) => Number.isInteger(n) && n >= 0 && n < 8;
const place = (n) => Number.isInteger(n) && n >= 0 && n < 9;
export const roomCount = (w, p) =>
  w.present.reduce((n, v, i) => n + Number(Boolean(v) && w.places[i] === p), 0);
export function itemPlace(w, i) {
  if (!avatar(i)) return -1;
  const h = w.holders[i];
  return avatar(h)
    ? w.present[h]
      ? w.places[h]
      : -1
    : place(h - 8)
      ? h - 8
      : -1;
}
export function canVisit(w, a, p) {
  return Boolean(
    avatar(a) &&
      place(p) &&
      w.present[a] &&
      w.places[a] !== p &&
      roomCount(w, p) < 4 &&
      (p === 0 || (w.places[a] === 0 && itemPlace(w, w.gates[p]) === 0)),
  );
}
export function applyTable(w, c) {
  const { actor: a, item: i, target: t, kind: k } = c;
  if (w.version !== 1 || !avatar(a)) return 1;
  if (k === 1) {
    if (w.claimed[a]) return 2;
    w.claimed[a] = 1;
    if (w.holders[a] === -1) w.holders[a] = a;
    return 0;
  }
  if (!w.claimed[a]) return 3;
  if (k === 4) {
    w.present[a] = 0;
    return 0;
  }
  if (k === 2) {
    w.holders = w.holders.map((h) => (h === a ? 8 + w.places[a] : h));
    w.claimed[a] = 0;
    w.present[a] = 0;
    return 0;
  }
  if (k === 3) {
    if (w.present[a]) return 0;
    if (roomCount(w, w.places[a]) >= 4) return 4;
    w.present[a] = 1;
    return 0;
  }
  if (!w.present[a]) return 3;
  switch (k) {
    case 5:
      if (!place(t)) return 1;
      if (roomCount(w, t) >= 4) return 4;
      if (!canVisit(w, a, t)) return 5;
      w.places[a] = t;
      break;
    case 6:
      if (!avatar(i) || w.holders[i] !== 8 + w.places[a]) return 6;
      w.holders[i] = a;
      break;
    case 7:
      if (!avatar(i) || w.holders[i] !== a) return 6;
      w.holders[i] = 8 + w.places[a];
      break;
    case 8:
      if (!avatar(i) || w.holders[i] !== a) return 6;
      if (!avatar(t) || t === a || !w.present[t] || w.places[t] !== w.places[a])
        return 7;
      w.holders[i] = t;
      break;
    case 9:
      if (
        !avatar(i) ||
        (w.holders[i] !== a && w.holders[i] !== 8 + w.places[a])
      )
        return 6;
      w.uses[i] = Math.min(2147483647, w.uses[i] + 1);
      break;
    case 10:
      if (!avatar(t) || t === a || !w.present[t] || w.places[t] !== w.places[a])
        return 7;
      break;
    case 11:
      break;
    default:
      return 1;
  }
  w.turn = (w.turn + 1) >>> 0;
  return 0;
}
