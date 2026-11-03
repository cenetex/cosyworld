// Things that are used up and come back (rules 95). Every thing is still one
// record with one id: nothing is minted, so a world never holds two copies.
//
//   home + regrow   A used-up thing with a `home` place and `regrow` (dawn,
//                   dusk or rest) reappears at home on the next such event.
//   dawn safeguard  At dawn a homed thing held by an absent traveler, or lying
//                   unheld away from both its home and its starting place,
//                   goes home. A kit thing may lie anywhere.
//   spends          A lane marked `spends` uses up the cargo that opened it
//                   when the ship arrives. Its free return leaves loose homed
//                   things on the quay it sails from.
//   kits            When every thing of a pack kit is home, its event scatters
//                   them to listed places, seeded by the run, the kit's count
//                   and the turn.
import { humanAvatar, humanPresent } from "./human-cast.mjs";
import { bringBack, usedUp, useUp } from "./item-use.mjs";
import { DAYLIGHT_TURNS, conditionMet, runHash } from "./pack-rules.mjs";
import {
  conditionsMet,
  entityActive,
  entityEnabled,
  packDefinitions,
  packThings,
  transports,
} from "./pack-registry.mjs";
import { laneBetween } from "./pack-transport.mjs";

export const REGROW_EVENTS = ["dawn", "dusk", "rest"];
const homed = Object.keys(packThings)
  .filter((id) => packThings[id].home)
  .sort();
export const packKits = packDefinitions.flatMap((pack) =>
  (pack.kits || []).map((kit) => ({ ...kit, packId: pack.id })),
);
const kitThings = new Set(packKits.flatMap((kit) => kit.items));

function rootOf(s, id) {
  let holder = s.items[id].holder;
  for (let i = 0; i < 32 && s.items[holder]; i++)
    holder = s.items[holder].holder;
  return holder;
}
const the = (name) => (/^(the|a|an) /iu.test(name) ? name : `the ${name}`);
const capital = (text) => text[0].toUpperCase() + text.slice(1);
const note = (s, id, text) => {
  s.items[id].history = [
    ...s.items[id].history,
    `Turn ${s.turn}: ${text}`,
  ].slice(-12);
};

// A thing back in play only where its own conditions let it be seen;
// otherwise it stays used up.
function tryBack(s, id, holder) {
  bringBack(s, id, holder);
  if (entityEnabled(s, id)) return true;
  s.items[id].holder = packThings[id].holder;
  s.usedUp = [...s.usedUp, id].sort();
  return false;
}

// The light change and long rests this round brought.
export function itemEvents(s) {
  const events = [];
  if (s.turn > 0 && s.turn % DAYLIGHT_TURNS === 0)
    events.push(Math.floor(s.turn / DAYLIGHT_TURNS) % 2 ? "dusk" : "dawn");
  if ((s.log || []).some((e) => e.turn === s.turn && e.rest === "long"))
    events.push("rest");
  return events;
}

// The cargo that opened a lane, as it lies aboard: each named thing aboard,
// the first open alternative of an `any`, and one thing from a named pack.
function cargo(s, t, conditions) {
  const out = [];
  for (const c of conditions) {
    if (c.kind === "item_present" && c.place === t.place)
      if (packThings[c.item] && conditionMet(s, c, null, t.packId))
        out.push(c.item);
    if (c.kind === "pack_item_present" && c.place === t.place) {
      const id = Object.keys(packThings)
        .sort()
        .find(
          (id) =>
            packThings[id].packId === c.pack &&
            entityActive(s, id) &&
            conditionMet(s, { kind: "item_present", item: id, place: c.place }),
        );
      if (id) out.push(id);
    }
    if (c.kind === "any")
      for (const option of c.conditions) {
        const found = cargo(s, t, [option]);
        if (found.length) {
          out.push(...found);
          break;
        }
      }
  }
  return [...new Set(out)];
}
// A return voyage is a free lane back along one that spends.
const returnVoyage = (t, from, to) =>
  !laneBetween(t, from, to)?.opensWith &&
  (t.lanes || []).some(
    (lane) => lane.spends && lane.from === to && lane.to === from,
  );

export function settleVoyageCargo(s, voyages, nameOf, log) {
  for (const v of voyages) {
    const t = transports[v.id];
    if (v.kind === "arrive" && laneBetween(t, v.from, v.dock)?.spends)
      for (const id of cargo(s, t, laneBetween(t, v.from, v.dock).opensWith)) {
        // Only a thing with a home is ever spent, so it can come back.
        if (!packThings[id].home) continue;
        useUp(s, id, packThings[id].holder);
        log(`The voyage uses up ${the(nameOf(id))}.`, t.place);
      }
    if (v.kind === "sail" && returnVoyage(t, v.from, v.to))
      for (const id of homed)
        if (!usedUp(s, id) && s.items[id].holder === t.place) {
          const text = `${capital(the(nameOf(t.place)))} leaves ${the(nameOf(id))} at ${nameOf(v.from)}.`;
          s.items[id].holder = v.from;
          note(s, id, text);
          log(text, v.from);
        }
  }
}

// Away from home and from where it started, or held by an absent traveler.
function stray(s, id) {
  const thing = packThings[id],
    root = rootOf(s, id);
  if (root === thing.home) return false;
  if (humanAvatar(root)) return !humanPresent(s, root);
  return !s.actors[root] && root !== thing.holder && !kitThings.has(id);
}

// The end of a round: regrowth on its event, the dawn safeguard, then kits.
export function settleItemCycle(s, nameOf, log) {
  const events = itemEvents(s);
  if (!events.length) return;
  for (const id of homed) {
    const { home, regrow } = packThings[id];
    if (!usedUp(s, id) || !events.includes(regrow) || !entityActive(s, home))
      continue;
    if (tryBack(s, id, home))
      log(`${capital(the(nameOf(home)))} has ${the(nameOf(id))} again.`, home);
  }
  if (events.includes("dawn"))
    for (const id of homed) {
      const home = packThings[id].home;
      if (usedUp(s, id) || !entityActive(s, home) || !stray(s, id)) continue;
      const text = `${capital(the(nameOf(home)))} has ${the(nameOf(id))} back.`;
      s.items[id].holder = home;
      note(s, id, text);
      log(text, home);
    }
  for (const kit of packKits) scatterKit(s, kit, events, nameOf, log);
}

function scatterKit(s, kit, events, nameOf, log) {
  if (
    !events.includes(kit.on) ||
    !conditionsMet(s, kit.packId, kit.requires || []) ||
    !kit.items.every(
      (id) => !usedUp(s, id) && s.items[id].holder === packThings[id].home,
    )
  )
    return;
  const places = kit.places.filter((id) => entityActive(s, id)).sort();
  if (!places.length) return;
  const count = s.scatters?.[kit.id] ?? 0;
  // Each place takes one thing until every place has one.
  let left = places;
  for (const id of [...kit.items].sort()) {
    const home = packThings[id].home;
    if (!left.some((p) => p !== home)) left = places;
    const choices = left.filter((p) => p !== home);
    if (!choices.length) continue;
    const to =
      choices[
        runHash(s, `kit:${kit.id}:${count}:${s.turn}:${id}`) % choices.length
      ];
    left = left.filter((p) => p !== to);
    const text = `${capital(the(nameOf(home)))} no longer has ${the(nameOf(id))}.`;
    s.items[id].holder = to;
    note(s, id, text);
    log(text, home);
  }
  s.scatters = { ...(s.scatters || {}), [kit.id]: count + 1 };
}

// A world from before rules 95 takes the used-up list once: a thing that now
// starts used up and still lies untouched where it starts leaves play. A
// thing added to a later world starts as its content says.
export function installItemCycle(s, added = []) {
  const starts = (id) =>
    packThings[id]?.startsUsed === true &&
    s.items[id]?.holder === packThings[id].holder &&
    !s.items[id].history.length;
  const fresh = Array.isArray(s.usedUp) ? added : Object.keys(s.items);
  s.usedUp = [
    ...new Set([...(s.usedUp || []), ...fresh.filter(starts)]),
  ].sort();
}

const whole = (n) => Number.isSafeInteger(n) && n > 0;
export const validItemCycle = (s) =>
  Array.isArray(s.usedUp) &&
  s.usedUp.every(
    (id, i) =>
      Boolean(packThings[id]) &&
      (!i || s.usedUp[i - 1] < id) &&
      s.items[id]?.holder === packThings[id].holder &&
      s.items[id].history.length === 0,
  ) &&
  (s.scatters === undefined ||
    (Boolean(s.scatters) &&
      typeof s.scatters === "object" &&
      !Array.isArray(s.scatters) &&
      Object.entries(s.scatters).every(
        ([id, n]) => packKits.some((kit) => kit.id === id) && whole(n),
      )));
