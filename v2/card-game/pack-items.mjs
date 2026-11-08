// Things that are used up and come back (rules 95). Every thing is still one
// record with one id: nothing is minted, so a world never holds two copies.
//
//   home + regrow   A used-up thing with a `home` place and `regrow` (dawn,
//                   dusk or rest) reappears at home on the next such event.
//   dawn safeguard  At dawn a homed thing found lying unheld in the same place,
//                   away from both its home and its starting place, at two
//                   dawns in a row (`astray` keeps the first sighting), so a
//                   thing laid down for a rite is not swept away. A kit thing
//                   may lie anywhere. Only a thing marked `absentReturn`
//                   also goes home from an absent traveler's hands (held
//                   for the owner's decision on absence penalties).
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

// A thing consumed (rules 102), eaten or made into something: it leaves
// whoever held it and goes back to its home, as the one thing it always was.
// A crafted thing (`locked`) waits there locked, used up, until its maker
// makes it again; any other comes back at once, ready to fetch again.
export const restOf = (id) => packThings[id].home ?? packThings[id].holder;
export function consume(s, id) {
  const thing = packThings[id];
  useUp(s, id, restOf(id));
  if (!thing.locked && thing.home) tryBack(s, id, thing.home);
}
const lockedThings = Object.keys(packThings)
  .filter((id) => packThings[id].locked)
  .sort();
// A crafted thing still locked at its home, waiting for its maker.
export const lockedAt = (s, place) =>
  lockedThings.filter(
    (id) =>
      usedUp(s, id) &&
      packThings[id].home === place &&
      entityActive(s, packThings[id].locked.by),
  );
// Its maker, standing at its home, makes it on the play that gives her, or
// lays down there, the last thing it consumes, once every one is in her
// hands or lying loose there: those are consumed, and it unlocks. Unlocking
// is a play, as eating is a choice (owner, 2026-11-04; reversible).
export function settleCrafting(s, a, nameOf, log) {
  for (const id of lockedThings) {
    const { home, locked } = packThings[id],
      maker = s.actors[locked.by];
    if (!usedUp(s, id) || !maker || maker.place !== home) continue;
    const handed =
      locked.consumes.includes(a.item) &&
      ((["give", "trade"].includes(a.kind) && a.target === locked.by) ||
        (a.kind === "drop" && a.target === home));
    if (!handed) continue;
    const ready =
      entityActive(s, locked.by) &&
      locked.consumes.every(
        (c) => entityActive(s, c) && [locked.by, home].includes(rootOf(s, c)),
      );
    if (!ready || !tryBack(s, id, home)) continue;
    for (const c of locked.consumes) consume(s, c);
    const used = locked.consumes.map((c) => the(nameOf(c)));
    log(
      `${nameOf(locked.by)} uses ${used.slice(0, -1).join(", ")}${used.length > 1 ? " and " : ""}${used.at(-1)}. ${capital(the(nameOf(id)))} is ready.`,
      home,
      {
        actorId: locked.by,
        itemId: id,
        consumedIds: [...locked.consumes],
        holderId: s.items[id].holder,
      },
    );
  }
}

// A craft records the ingredients used in that occurrence. Later custody and
// recipe edits keep their own meaning; retained source actions still agree.
export function validCraftEvent(s, event) {
  if (event.verb !== "craft") return event.consumedIds === undefined;
  const { consumedIds, sourceSeq } = event;
  if (
    event.kind !== "narration" ||
    event.generated ||
    !Object.hasOwn(s.actors, event.actorId) ||
    !Object.hasOwn(s.items, event.itemId) ||
    !Number.isSafeInteger(event.seq) ||
    !Number.isSafeInteger(event.turn) ||
    event.turn < 0 || event.turn > s.turn ||
    !Number.isSafeInteger(sourceSeq) ||
    sourceSeq < 1 || sourceSeq >= event.seq ||
    !Array.isArray(consumedIds) ||
    consumedIds.length < 1 || consumedIds.length > 3 ||
    consumedIds.some((id, i) =>
      !Object.hasOwn(s.items, id) || id === event.itemId || consumedIds.indexOf(id) !== i) ||
    !Array.isArray(event.witnesses) ||
    !event.witnesses.includes(event.actorId)
  )
    return false;
  const source = s.log.find((entry) => entry.seq === sourceSeq);
  return (
    !source ||
    (source.kind === "action" && source.turn === event.turn &&
      ["give", "trade", "drop"].includes(source.verb) &&
      (source.verb === "drop" || source.accepted === true) && consumedIds.includes(source.itemId) &&
      source.targetId === (source.verb === "drop" ? event.locationId : event.actorId))
  );
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
    if (["item_present", "item_at"].includes(c.kind) && c.place === t.place)
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

// Held by an absent traveler ("absent"), or lying unheld away from home and
// from where it started ("astray"), or neither.
function stray(s, id) {
  const thing = packThings[id],
    root = rootOf(s, id);
  if (root === thing.home) return null;
  if (humanAvatar(root))
    return thing.absentReturn && !humanPresent(s, root) ? "absent" : null;
  return !s.actors[root] && root !== thing.holder && !kitThings.has(id)
    ? "astray"
    : null;
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
  if (events.includes("dawn")) {
    const seen = {};
    for (const id of homed) {
      const home = packThings[id].home,
        why = !usedUp(s, id) && entityActive(s, home) && stray(s, id);
      if (!why) continue;
      if (why === "astray" && s.astray?.[id] !== rootOf(s, id)) {
        seen[id] = rootOf(s, id);
        continue;
      }
      const text = `${capital(the(nameOf(home)))} has ${the(nameOf(id))} back.`;
      s.items[id].holder = home;
      note(s, id, text);
      log(text, home);
    }
    if (Object.keys(seen).length) s.astray = seen;
    else delete s.astray;
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
      [packThings[id].holder, restOf(id)].includes(s.items[id]?.holder) &&
      s.items[id].history.length === 0,
  ) &&
  (s.astray === undefined ||
    (Boolean(s.astray) &&
      typeof s.astray === "object" &&
      !Array.isArray(s.astray) &&
      Object.keys(s.astray).length > 0 &&
      Object.entries(s.astray).every(
        ([id, place]) => homed.includes(id) && typeof place === "string",
      ))) &&
  (s.scatters === undefined ||
    (Boolean(s.scatters) &&
      typeof s.scatters === "object" &&
      !Array.isArray(s.scatters) &&
      Object.entries(s.scatters).every(
        ([id, n]) => packKits.some((kit) => kit.id === id) && whole(n),
      )));
