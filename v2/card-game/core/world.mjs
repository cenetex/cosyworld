// The general card core: one rule path for every avatar, item, and place. The
// world's registries live in its state, so seeds and quest rewards can add
// entities without code changes. No rule names a specific entity.
import {
  asleep,
  avatarOrder,
  awake,
  carried,
  desireFor,
  distances,
  generateQuest,
  alternatives,
  holderOf,
  isPlayer,
  itemPlace,
  levelOf,
  nameOf,
  needed,
  newAvatar,
  programFor,
  sequence,
  targetsFor,
} from "./goals.mjs";
import { plan } from "./planner.mjs";
import {
  growPlaces,
  latentItem,
  latentPlace,
  madeText,
  newPlace,
  openPlace,
  placeQuest,
  validPlaceQuest,
  validTables,
} from "./growth.mjs";

export const SCHEMA = 1;
export const DEFAULT_RULES = {
  carry: 3,
  actRadius: 2,
  questRadius: 3,
  stallActs: 12,
  errandActs: 24,
  maxSpawns: 128,
  abandonTurns: 96,
  growthStart: 4,
  levelsPerGrowth: 10,
  offerTurns: 16,
  answerTurns: 12,
};
const ID = /^[a-z0-9][a-z0-9-]{0,63}$/;
const VERBS = [
  "wait",
  "move",
  "take",
  "drop",
  "give",
  "ask",
  "trade",
  "talk",
  "threaten",
  "guard",
  "attack",
  "offer",
  "accept",
];

const entity = ({ name, text = "", tags = [] }) => ({
  name,
  text,
  tags: [...tags],
});
// Build a world from seed data: places with exits, avatars with a role and a
// place, and items with a holder. Every avatar starts with a generated quest.
export function createWorld(seed) {
  const s = {
    schema: SCHEMA,
    seed: seed.id,
    rules: { ...DEFAULT_RULES, ...seed.rules },
    turn: 0,
    revision: 0,
    eventSeq: 0,
    places: {},
    avatars: {},
    items: {},
    standoffs: [],
    offers: [],
    offerSeq: 0,
    tables: structuredClone(seed.tables || {}),
    claims: {},
    spawned: 0,
    log: [],
  };
  for (const p of seed.places)
    s.places[p.id] = newPlace(entity(p), {
      exits: [...p.exits],
      makes: p.makes ?? null,
      beyond: p.beyond ?? null,
    });
  for (const a of seed.avatars)
    s.avatars[a.id] = newAvatar(entity(a), a.role, a.place);
  for (const i of seed.items)
    s.items[i.id] = { ...entity(i), holder: i.holder, history: [] };
  for (const id of Object.keys(s.places))
    s.places[id].quest = placeQuest(s, id);
  ensureQuests(s);
  const players = avatarOrder(s).filter((id) => isPlayer(s, id));
  addLog(
    s,
    seed.opening ||
      `${players.map((id) => nameOf(s, id)).join(" and ")} ${players.length === 1 ? "arrives" : "arrive"}.`,
    { kind: "narration", locationId: s.avatars[players[0]]?.place },
  );
  return validateWorld(s);
}

export const exits = (s, place) => s.places[place].exits;
const placeOf = (s, avatar) => s.avatars[avatar].place;
const canReach = (s, avatar, item) =>
  holderOf(s, item) === avatar || holderOf(s, item) === placeOf(s, avatar);
export const hasSpace = (s, avatar, item) =>
  carried(s, avatar).length + (holderOf(s, item) === avatar ? 0 : 1) <=
  s.rules.carry;
export function handStatus(s, avatar, h = desireFor(s, avatar)) {
  const held = carried(s, avatar),
    here = placeOf(s, avatar);
  const items = h.items.map((id) => ({ id, met: held.includes(id) }));
  const location = { id: h.location, met: !h.location || here === h.location };
  const avatars = h.avatars.map((id) => ({
    id,
    met: placeOf(s, id) === here,
  }));
  return {
    items,
    location,
    avatars,
    met:
      items.every((e) => e.met) && location.met && avatars.every((e) => e.met),
  };
}
export function handText(s, h) {
  const names = (ids) => ids.map((id) => nameOf(s, id)).join(" + ");
  return [
    h.items.length ? `hold ${names(h.items)}` : "hold any items",
    h.location ? `at ${nameOf(s, h.location)}` : "in any place",
    h.avatars.length ? `with ${names(h.avatars)}` : "with any company",
  ].join(" · ");
}

// Consent comes from goals. A player accepts any gift and answers asks and
// trades with its own plays. A resident accepts what its hand still needs.
export const accepts = (s, avatar, item) =>
  (isPlayer(s, avatar) && awake(s, avatar)) ||
  (needed(s, avatar, item) && holderOf(s, item) !== avatar);
export const stalled = (s, avatar) =>
  s.avatars[avatar].progress.drift >= s.rules.errandActs;
// A resident gives a spare once its own items are in hand. After a player has
// gone a long while without completing a hand, residents give that player
// spares sooner, so every player keeps a way forward.
export function willingToGive(s, owner, item, recipient = null) {
  return (
    !isPlayer(s, owner) &&
    !needed(s, owner, item) &&
    (handStatus(s, owner).items.every((e) => e.met) ||
      (recipient !== null && isPlayer(s, recipient) && stalled(s, recipient)))
  );
}
export function canTrade(s, avatar, give, receive) {
  const other = holderOf(s, receive);
  if (
    holderOf(s, give) !== avatar ||
    !s.avatars[other] ||
    other === avatar ||
    isPlayer(s, other) ||
    asleep(s, other) ||
    placeOf(s, avatar) !== placeOf(s, other)
  )
    return false;
  return accepts(s, other, give) && !needed(s, other, receive);
}
export const tradeOffers = (s, avatar) =>
  carried(s, avatar).filter((id) => !needed(s, avatar, id));

export function standoffFor(s, avatar) {
  return s.standoffs.find((c) => [c.challenger, c.defender].includes(avatar));
}
export const opponentOf = (c, avatar) =>
  c.challenger === avatar ? c.defender : c.challenger;
export const strikePower = (s, avatar, target) =>
  2 + Math.sign(levelOf(s, avatar) - levelOf(s, target));
function closeStandoff(s, c) {
  s.standoffs = s.standoffs.filter((entry) => entry !== c);
  for (const id of [c.challenger, c.defender])
    s.avatars[id].peaceUntil = s.turn + 3;
}
// A threatened player must answer before anyone can strike it. A player who
// leaves the table, or does not answer in time, ends the standoff and keeps
// everything, so no player loses an item while away.
const unanswered = (s, c) => isPlayer(s, c.defender) && !c.answered;
function settleStandoffs(s) {
  for (const c of [...s.standoffs]) {
    const separated = [c.challenger, c.defender].some(
      (id) => placeOf(s, id) !== c.location,
    );
    const released = c.item && holderOf(s, c.item) !== c.defender;
    const away =
      [c.challenger, c.defender].some((id) => asleep(s, id)) ||
      (unanswered(s, c) && s.turn - c.opened >= s.rules.answerTurns);
    if (!separated && !released && !away) continue;
    closeStandoff(s, c);
    addLog(
      s,
      away
        ? `${nameOf(s, c.defender)} does not answer ${nameOf(s, c.challenger)}. The standoff ends.`
        : separated
          ? `${nameOf(s, c.challenger)} and ${nameOf(s, c.defender)} part. The standoff ends.`
          : `The ${nameOf(s, c.item)} changes hands. The standoff ends.`,
      {
        actorId: c.challenger,
        targetId: c.defender,
        itemId: c.item,
        locationId: c.location,
      },
    );
  }
}

function offer(kind, actor, item, target, text, cards) {
  return {
    kind,
    actor,
    item,
    target,
    text,
    cards,
    key: [kind, actor, item || "", target || ""].join(":"),
  };
}
export function legalActions(s, actor) {
  const n = (id) => nameOf(s, id);
  const here = placeOf(s, actor);
  const out = [offer("wait", actor, null, null, `${n(actor)} waits.`, [])];
  for (const to of exits(s, here)) {
    out.push(
      offer("move", actor, null, to, `${n(actor)} goes to ${n(to)}.`, [to]),
    );
    for (const id of carried(s, actor))
      out.push(
        offer(
          "move",
          actor,
          id,
          to,
          `${n(actor)} carries the ${n(id)} to ${n(to)}.`,
          [id, to],
        ),
      );
  }
  const conflict = standoffFor(s, actor);
  const company = avatarOrder(s).filter(
    (id) => id !== actor && awake(s, id) && placeOf(s, id) === here,
  );
  for (const other of company) {
    if (conflict && opponentOf(conflict, actor) === other) {
      out.push(
        offer(
          "guard",
          actor,
          null,
          other,
          `${n(actor)} guards against ${n(other)}.`,
          [other],
        ),
      );
      if (!unanswered(s, conflict))
        out.push(
          offer(
            "attack",
            actor,
            null,
            other,
            `${n(actor)} attacks ${n(other)}.`,
            [other],
          ),
        );
    } else if (
      !conflict &&
      !standoffFor(s, other) &&
      s.avatars[actor].peaceUntil <= s.turn &&
      s.avatars[other].peaceUntil <= s.turn
    ) {
      const theirs = carried(s, other);
      const stake =
        theirs.find((id) => needed(s, actor, id)) || theirs[0] || null;
      out.push(
        offer(
          "threaten",
          actor,
          stake,
          other,
          `${n(actor)} threatens ${n(other)}${stake ? ` over the ${n(stake)}` : ""}.`,
          [other],
        ),
      );
    }
    out.push(
      offer(
        "talk",
        actor,
        null,
        other,
        `${n(actor)} asks ${n(other)} what they want.`,
        [other],
      ),
    );
  }
  for (const id of Object.keys(s.items)) {
    if (itemPlace(s, id) !== here) continue;
    const holder = holderOf(s, id);
    if (holder === here && hasSpace(s, actor, id))
      out.push(
        offer("take", actor, id, null, `${n(actor)} takes the ${n(id)}.`, [id]),
      );
    if (holder === actor) {
      out.push(
        offer(
          "drop",
          actor,
          id,
          here,
          `${n(actor)} puts the ${n(id)} in ${n(here)}.`,
          [id],
        ),
      );
      for (const other of company.filter(
        (p) => accepts(s, p, id) && hasSpace(s, p, id),
      ))
        out.push(
          offer(
            "give",
            actor,
            id,
            other,
            `${n(actor)} gives the ${n(id)} to ${n(other)}.`,
            [id, other],
          ),
        );
    } else if (awake(s, holder) && hasSpace(s, actor, id)) {
      out.push(
        offer(
          "ask",
          actor,
          id,
          holder,
          `${n(actor)} asks ${n(holder)} for the ${n(id)}.`,
          [id, holder],
        ),
      );
    }
  }
  for (const give of carried(s, actor))
    for (const receive of Object.keys(s.items)) {
      if (!canTrade(s, actor, give, receive)) continue;
      const other = holderOf(s, receive);
      const action = offer(
        "trade",
        actor,
        give,
        other,
        `${n(actor)} trades the ${n(give)} for ${n(other)}’s ${n(receive)}.`,
        [give, receive],
      );
      action.receive = receive;
      action.key += ":" + receive;
      out.push(action);
    }
  // Players exchange by consent in two plays: one offers a swap, the other
  // accepts it. Nothing moves until the second play.
  if (isPlayer(s, actor)) {
    for (const other of company.filter((id) => isPlayer(s, id)))
      for (const give of carried(s, actor))
        for (const receive of carried(s, other)) {
          if (
            s.offers.some(
              (o) =>
                o.from === actor && o.give === give && o.receive === receive,
            )
          )
            continue;
          const action = offer(
            "offer",
            actor,
            give,
            other,
            `${n(actor)} offers ${n(other)} the ${n(give)} for the ${n(receive)}.`,
            [give, receive],
          );
          action.receive = receive;
          action.key += ":" + receive;
          out.push(action);
        }
    for (const o of s.offers.filter((o) => o.to === actor)) {
      const action = offer(
        "accept",
        actor,
        o.receive,
        o.from,
        `${n(actor)} accepts ${n(o.from)}’s offer: the ${n(o.give)} for the ${n(o.receive)}.`,
        [o.give, o.receive],
      );
      action.receive = o.give;
      action.offer = o.id;
      action.key += ":" + o.id;
      out.push(action);
    }
  }
  return out;
}

// An offer stands while both players are here and awake, both items are
// still theirs, and it is recent. Offer ids are never reused, so an accepted
// or lapsed offer cannot be accepted again.
const offerStands = (s, o) =>
  awake(s, o.from) &&
  awake(s, o.to) &&
  placeOf(s, o.from) === o.place &&
  placeOf(s, o.to) === o.place &&
  holderOf(s, o.give) === o.from &&
  holderOf(s, o.receive) === o.to &&
  s.turn - o.turn <= s.rules.offerTurns;

function remember(s, item, text) {
  s.items[item].history = [
    ...s.items[item].history,
    `Turn ${s.turn}: ${text}`,
  ].slice(-12);
}
function transfer(s, item, holder, text) {
  s.items[item].holder = holder;
  remember(s, item, text);
}
export function addLog(s, text, detail = {}) {
  const actorId = detail.actorId ?? null;
  const locationId =
    detail.locationId || (actorId ? placeOf(s, actorId) : null);
  s.eventSeq += 1;
  s.log.push({
    seq: s.eventSeq,
    turn: s.turn,
    kind: detail.kind || (actorId ? "action" : "narration"),
    text,
    actorId,
    locationId,
    cast: locationId
      ? avatarOrder(s).filter((id) => placeOf(s, id) === locationId)
      : [],
    items: locationId
      ? Object.keys(s.items).filter((id) => itemPlace(s, id) === locationId)
      : [],
    ...detail,
  });
  if (s.log.length > 100) s.log = s.log.slice(-100);
}

function perform(s, a, round = newRound()) {
  const n = (id) => nameOf(s, id);
  const who = n(a.actor);
  const here = placeOf(s, a.actor);
  const witnesses = avatarOrder(s).filter((id) => placeOf(s, id) === here);
  round.touched.add(here);
  const progress = s.avatars[a.actor].progress;
  progress.idle += 1;
  progress.drift += 1;
  const conflict = standoffFor(s, a.actor);
  if (conflict) {
    conflict.guarding[a.actor] = false;
    if (a.actor === conflict.defender) conflict.answered = true;
  }
  if (a.kind === "wait") return;
  let text = a.text;
  let arrival = null;
  switch (a.kind) {
    case "threaten":
      s.standoffs.push({
        challenger: a.actor,
        defender: a.target,
        location: here,
        item: a.item,
        opened: s.turn,
        answered: false,
        resolve: { [a.actor]: 4, [a.target]: 4 },
        guarding: { [a.actor]: false, [a.target]: false },
        struck: { [a.actor]: false, [a.target]: false },
      });
      break;
    case "guard":
      conflict.guarding[a.actor] = true;
      break;
    case "attack": {
      const guarded = conflict.guarding[a.target];
      const damage = Math.max(
        1,
        strikePower(s, a.actor, a.target) - Number(guarded),
      );
      conflict.guarding[a.target] = false;
      conflict.struck[a.actor] = true;
      conflict.resolve[a.target] = Math.max(
        0,
        conflict.resolve[a.target] - damage,
      );
      text += ` ${guarded ? "The guard softens the blow. " : ""}${n(a.target)} loses ${damage} resolve.`;
      if (conflict.resolve[a.target] > 0) break;
      const dropped =
        conflict.item && holderOf(s, conflict.item) === a.target
          ? conflict.item
          : carried(s, a.target).find((id) => needed(s, a.actor, id));
      if (dropped) {
        transfer(s, dropped, here, `${n(a.target)} yields the ${n(dropped)}.`);
        text += ` ${n(a.target)} drops the ${n(dropped)}.`;
      }
      const retreat = exits(s, here)[0];
      if (retreat) {
        s.avatars[a.target].place = retreat;
        for (const id of carried(s, a.target))
          remember(s, id, `${n(a.target)} retreated to ${n(retreat)} with it.`);
        text += ` ${n(a.target)} retreats to ${n(retreat)}.`;
        arrival = {
          text: `${n(a.target)} arrives at ${n(retreat)} after yielding to ${who}.`,
          actorId: a.target,
          locationId: retreat,
          fromLocationId: here,
        };
      }
      text += " The standoff ends.";
      closeStandoff(s, conflict);
      break;
    }
    case "move":
      s.avatars[a.actor].place = a.target;
      round.touched.add(a.target);
      for (const id of carried(s, a.actor))
        remember(s, id, `${who} carried it to ${n(a.target)}.`);
      break;
    case "take":
      transfer(s, a.item, a.actor, a.text);
      break;
    case "drop":
      transfer(s, a.item, here, a.text);
      break;
    case "give":
      transfer(s, a.item, a.target, a.text);
      break;
    case "trade":
      transfer(s, a.item, a.target, a.text);
      transfer(s, a.receive, a.actor, a.text);
      break;
    case "talk":
      s.avatars[a.actor].lastTalk = s.turn;
      break;
    case "offer":
      s.offerSeq += 1;
      s.offers.push({
        id: `offer-${s.offerSeq}`,
        from: a.actor,
        to: a.target,
        give: a.item,
        receive: a.receive,
        place: here,
        turn: s.turn,
      });
      break;
    case "accept":
      s.offers = s.offers.filter((o) => o.id !== a.offer);
      transfer(s, a.item, a.target, a.text);
      transfer(s, a.receive, a.actor, a.text);
      break;
    case "ask":
      if (willingToGive(s, a.target, a.item, a.actor)) {
        text = `${n(a.target)} hands the ${n(a.item)} to ${who}.`;
        transfer(s, a.item, a.actor, text);
      } else text += ` ${n(a.target)} keeps it for now.`;
      s.avatars[a.actor].lastTalk = s.turn;
      break;
    default:
      throw new Error("Unknown act.");
  }
  addLog(s, text, {
    kind: "action",
    actorId: a.actor,
    verb: a.kind,
    locationId: here,
    witnesses,
    itemId: a.item,
    targetId: a.target,
    ...(a.receive ? { receiveId: a.receive } : {}),
  });
  if (arrival) {
    const { text: arrivalText, ...details } = arrival;
    addLog(s, arrivalText, details);
  }
  settleStandoffs(s);
}

// Capture each fulfilled hand before another avatar can leave or move an item.
// Quest changes happen after the round, so every avatar pursues one step per play.
function captureHands(s, met) {
  for (const avatar of avatarOrder(s)) {
    if (met.has(avatar) || asleep(s, avatar)) continue;
    const target = targetsFor(s, avatar).find(
      (h) => handStatus(s, avatar, h).met,
    );
    if (target) met.set(avatar, structuredClone(target));
  }
}
// Each new quest reads the quests chosen before it in the same round, so two
// avatars never pick goals against each other's stale wants.
function ensureQuests(s) {
  for (const avatar of avatarOrder(s)) {
    const p = s.avatars[avatar].progress;
    if (p.current) continue;
    p.current = draftQuest(s, avatar).adopt();
    p.idle = 0;
  }
}
// The generator reads a copy of the world. A goal it promises a doorway in
// adds that latent place to the world only once the goal is kept.
function draftQuest(s, avatar, options) {
  const scratch = copyWorld(s);
  const quest = generateQuest(scratch, avatar, options);
  return {
    quest,
    adopt() {
      for (const [id, place] of Object.entries(scratch.places))
        s.places[id] ??= place;
      s.spawned = scratch.spawned;
      return quest;
    },
  };
}
function advanceQuests(s, met, round = newRound()) {
  const receipts = [];
  for (const [avatar, target] of met) {
    const progress = s.avatars[avatar].progress,
      quest = programFor(s, avatar),
      step = progress.step;
    progress.marks = [...progress.marks, s.turn].slice(-32);
    progress.idle = 0;
    progress.drift = 0;
    progress.step += 1;
    const door = quest.steps[step].opens;
    if (door) round.opened.push(openPlace(s, door, avatar));
    const complete = progress.step === quest.steps.length;
    if (complete) {
      progress.completedHands += quest.steps.length;
      if (quest.generated.item)
        progress.recent = [...progress.recent, quest.generated.item].slice(-4);
      progress.current = null;
      progress.program += 1;
      progress.step = 0;
    }
    receipts.push({ avatar, quest, step, complete, target });
  }
  ensureQuests(s);
  for (const { avatar, quest, step, complete, target } of receipts) {
    let text = `${nameOf(s, avatar)} completes hand ${step + 1}/${quest.steps.length} of ${quest.name}.`;
    if (complete) text += ` Level ${levelOf(s, avatar)}.`;
    text += ` Next: ${handText(s, desireFor(s, avatar))}.`;
    addLog(s, text, {
      kind: "quest",
      actorId: avatar,
      questId: quest.id,
      step,
      complete,
      target,
      level: levelOf(s, avatar),
    });
  }
}
// An avatar reconsiders an unfinished bargain after a stall. Keep the completed
// prefix; every remaining hand still needs a real world match. A resident's
// new goal leaves player-held items alone, so it never waits on a player.
function refreshStalledQuests(s, active) {
  for (const avatar of active) {
    const p = s.avatars[avatar].progress,
      current = programFor(s, avatar);
    if (p.idle < s.rules.stallActs) continue;
    const draft = draftQuest(s, avatar, {
      independent: !isPlayer(s, avatar),
      solo: stalled(s, avatar),
    });
    const fresh = draft.quest;
    const unfinished = fresh.steps.filter(
      (step) => !alternatives(step).some((h) => handStatus(s, avatar, h).met),
    );
    if (!unfinished.length) continue;
    draft.adopt();
    p.idle = 0;
    p.current = {
      ...fresh,
      steps: sequence(
        current.steps.slice(0, p.step),
        unfinished.slice(0, Math.max(1, current.steps.length - p.step)),
      ),
    };
    addLog(
      s,
      `${nameOf(s, avatar)} finds a new purpose: ${handText(s, desireFor(s, avatar))}.`,
      { kind: "quest", actorId: avatar },
    );
  }
}

// Log entries never change once written, so copies of the world share them.
function copyWorld(s) {
  const next = structuredClone({ ...s, log: [] });
  next.log = [...s.log];
  return next;
}

// One round's causes: places where an act happened and doorways opened.
// Places grow only from these, so a quiet place never changes.
function newRound() {
  return { touched: new Set(), opened: [] };
}
// A player asleep for a long time goes on alone as a resident. This is the
// only way new avatars enter the world. Its holdings stay its own.
function abandonSleepers(s) {
  for (const id of avatarOrder(s)) {
    const a = s.avatars[id];
    if (!a.asleep || s.turn - a.restedAt < s.rules.abandonTurns) continue;
    Object.assign(a, { role: "resident", asleep: false, restedAt: null });
    a.former = true;
    a.progress.idle = s.rules.stallActs;
    addLog(s, `${a.name} has been away a long time and goes on alone.`, {
      actorId: id,
      kind: "arrival",
    });
  }
}

// Residents near the acting player hear the play. Residents farther away
// stay still, so a quiet part of the world does not change.
export function activeResidents(s, player) {
  const near = distances(s, placeOf(s, player), s.rules.actRadius);
  return avatarOrder(s).filter(
    (id) => !isPlayer(s, id) && near.has(placeOf(s, id)),
  );
}
// Awake players within reach of a resident.
export function playersNear(s, resident) {
  const near = distances(s, placeOf(s, resident), s.rules.actRadius);
  return avatarOrder(s).filter(
    (id) => isPlayer(s, id) && awake(s, id) && near.has(placeOf(s, id)),
  ).length;
}
// A resident acts once for every play by each player near it, so it keeps one
// player's pace however many players share its part of the world.
function residentsToAct(s, player) {
  return activeResidents(s, player).filter((id) => {
    const a = s.avatars[id];
    a.heard += 1;
    if (a.heard < Math.max(1, playersNear(s, id))) return false;
    a.heard = 0;
    return true;
  });
}

// A play is checked against the world as it is when it arrives, not as the
// player last saw it. Another player's move can make a card stale; it is
// refused only if it is no longer legal. `stale` tells the client to redraw.
export function play(s, action, expectedRevision = s.revision) {
  const actor = action?.actor;
  if (!actor || !isPlayer(s, actor))
    return {
      ok: false,
      state: s,
      error: "That play has changed. Check the cards and choose again.",
    };
  const next = copyWorld(s);
  // A sleeping player wakes by playing.
  if (asleep(next, actor)) {
    next.avatars[actor].asleep = false;
    next.avatars[actor].restedAt = null;
    addLog(next, `${nameOf(next, actor)} wakes.`, { actorId: actor });
  }
  const exact = legalActions(next, actor).find((a) => a.key === action.key);
  if (!exact)
    return {
      ok: false,
      state: s,
      error: "That play has changed. Check the cards and choose again.",
    };
  next.turn += 1;
  next.revision += 1;
  const met = new Map();
  captureHands(next, met);
  const round = newRound();
  perform(next, exact, round);
  captureHands(next, met);
  const acting = residentsToAct(next, actor);
  for (const resident of acting) {
    perform(next, plan(next, resident).action, round);
    captureHands(next, met);
  }
  advanceQuests(next, met, round);
  refreshStalledQuests(next, [actor, ...acting]);
  next.offers = next.offers.filter((o) => offerStands(next, o));
  settleStandoffs(next);
  for (const door of round.opened.filter(Boolean)) {
    round.touched.add(door.place);
    addLog(
      next,
      `${nameOf(next, door.by)} opens a way from ${nameOf(next, door.from)} to ${nameOf(next, door.place)}.`,
      {
        kind: "growth",
        actorId: door.by,
        locationId: door.from,
        placeId: door.place,
      },
    );
  }
  for (const made of growPlaces(next, round.touched))
    addLog(next, madeText(next, made), {
      kind: "growth",
      locationId: made.place,
      itemId: made.item,
      cast: made.makers,
    });
  abandonSleepers(next);
  ensureQuests(next);
  validateWorld(next);
  return { ok: true, state: next, stale: expectedRevision !== s.revision };
}

// A player joins the shared world. The runtime journals this like a play.
export function join(s, { id, name, text = "", place }) {
  if (!ID.test(id || "") || s.places[id] || s.avatars[id] || s.items[id])
    return { ok: false, state: s, error: "Choose an unused avatar id." };
  if (!s.places[place])
    return { ok: false, state: s, error: "Choose a place in this world." };
  const next = copyWorld(s);
  next.avatars[id] = newAvatar(entity({ name, text }), "player", place);
  next.revision += 1;
  ensureQuests(next);
  addLog(next, `${nameOf(next, id)} arrives at ${nameOf(next, place)}.`, {
    actorId: id,
  });
  validateWorld(next);
  return { ok: true, state: next };
}

// A player leaves the table. The runtime journals this when a session ends.
// The avatar stays where it is with everything it holds until it plays again.
export function rest(s, player) {
  if (!isPlayer(s, player) || asleep(s, player))
    return { ok: false, state: s, error: "Only an awake player can rest." };
  const next = copyWorld(s);
  next.avatars[player].asleep = true;
  next.avatars[player].restedAt = next.turn;
  next.revision += 1;
  addLog(next, `${nameOf(next, player)} falls asleep.`, { actorId: player });
  next.offers = next.offers.filter((o) => offerStands(next, o));
  settleStandoffs(next);
  validateWorld(next);
  return { ok: true, state: next };
}

// The runtime returns an avatar that went on alone to the player who left it.
export function reclaim(s, id) {
  if (!s.avatars[id]?.former || isPlayer(s, id))
    return {
      ok: false,
      state: s,
      error: "Only an avatar that went on alone can be reclaimed.",
    };
  const next = copyWorld(s);
  Object.assign(next.avatars[id], { role: "player", former: false });
  next.revision += 1;
  addLog(next, `${nameOf(next, id)} is back.`, { actorId: id });
  validateWorld(next);
  return { ok: true, state: next };
}

function fail(why) {
  throw new Error(`This world cannot be loaded: ${why}.`);
}
function validHand(s, h, avatar) {
  return (
    h &&
    Array.isArray(h.items) &&
    h.items.length <= s.rules.carry &&
    new Set(h.items).size === h.items.length &&
    h.items.every((id) => s.items[id]) &&
    (h.location === null || Boolean(s.places[h.location])) &&
    Array.isArray(h.avatars) &&
    new Set(h.avatars).size === h.avatars.length &&
    h.avatars.every((id) => s.avatars[id] && id !== avatar)
  );
}
function validQuest(s, q, avatar) {
  return (
    q &&
    typeof q.id === "string" &&
    q.id.length <= 80 &&
    typeof q.name === "string" &&
    q.name.length <= 120 &&
    Array.isArray(q.steps) &&
    q.steps.length >= 1 &&
    q.steps.length <= 8 &&
    q.steps.every((step) => {
      const any = alternatives(step);
      return any.length >= 1 && any.every((h) => validHand(s, h, avatar));
    }) &&
    q.generated &&
    Number.isInteger(q.generated.turn) &&
    (q.generated.item === null || Boolean(s.items[q.generated.item])) &&
    (q.generated.partner === null || Boolean(s.avatars[q.generated.partner]))
  );
}
const validEntity = (e) =>
  e &&
  typeof e.name === "string" &&
  e.name.length >= 1 &&
  e.name.length <= 80 &&
  typeof e.text === "string" &&
  e.text.length <= 400 &&
  Array.isArray(e.tags) &&
  e.tags.every((t) => typeof t === "string" && ID.test(t));
export function validateWorld(s) {
  if (!s || s.schema !== SCHEMA) fail("unknown save format");
  for (const key of Object.keys(DEFAULT_RULES))
    if (!Number.isInteger(s.rules?.[key]) || s.rules[key] < 1)
      fail(`rule ${key} is invalid`);
  if (![s.turn, s.revision, s.eventSeq].every(Number.isInteger))
    fail("counters are invalid");
  const all = [
    ...Object.keys(s.places),
    ...Object.keys(s.avatars),
    ...Object.keys(s.items),
  ];
  if (new Set(all).size !== all.length) fail("two entities share an id");
  if (!all.every((id) => ID.test(id))) fail("an id is malformed");
  if (
    !validTables(s.tables) ||
    !Number.isInteger(s.spawned) ||
    s.spawned > s.rules.maxSpawns ||
    !s.claims ||
    Object.values(s.claims).some(
      (c) => !Number.isInteger(c.turn) || !all.includes(c.created),
    )
  )
    fail("growth records are invalid");
  for (const [id, p] of Object.entries(s.places))
    if (
      !validEntity(p) ||
      !Array.isArray(p.exits) ||
      p.exits.some((to) => !s.places[to] || to === id) ||
      new Set(p.exits).size !== p.exits.length ||
      [p.makes, p.beyond].some((t) => t !== null && !s.tables[t]) ||
      !Number.isInteger(p.made) ||
      typeof p.latent !== "boolean" ||
      (p.latent && (p.exits.length || !s.places[p.opener])) ||
      !validPlaceQuest(s, id, p.quest)
    )
      fail(`place ${id} is invalid`);
  for (const [id, a] of Object.entries(s.avatars)) {
    if (
      !validEntity(a) ||
      !["player", "resident"].includes(a.role) ||
      !s.places[a.place] ||
      !Number.isInteger(a.lastTalk) ||
      !Number.isInteger(a.peaceUntil) ||
      !Number.isInteger(a.heard) ||
      a.heard < 0 ||
      typeof a.asleep !== "boolean" ||
      (a.asleep && a.role !== "player") ||
      a.asleep !== Number.isInteger(a.restedAt) ||
      typeof a.former !== "boolean" ||
      latentPlace(s, a.place)
    )
      fail(`avatar ${id} is invalid`);
    const p = a.progress;
    if (
      !p ||
      ![p.program, p.step, p.completedHands, p.idle, p.drift].every(
        (v) => Number.isInteger(v) && v >= 0,
      ) ||
      !Array.isArray(p.marks) ||
      !Array.isArray(p.recent) ||
      !validQuest(s, p.current, id) ||
      p.step >= p.current.steps.length
    )
      fail(`avatar ${id} has an invalid quest`);
    if (carried(s, id).length > s.rules.carry)
      fail(`avatar ${id} carries too much`);
  }
  for (const [id, item] of Object.entries(s.items))
    if (
      !validEntity(item) ||
      (latentItem(s, id)
        ? !s.places[item.maker]
        : !(s.places[item.holder] || s.avatars[item.holder])) ||
      !Array.isArray(item.history) ||
      item.history.length > 12
    )
      fail(`item ${id} is invalid`);
  for (const c of s.standoffs)
    if (
      !s.avatars[c.challenger] ||
      !s.avatars[c.defender] ||
      c.challenger === c.defender ||
      !s.places[c.location] ||
      (c.item !== null && !s.items[c.item])
    )
      fail("a standoff is invalid");
  if (
    !Array.isArray(s.offers) ||
    !Number.isInteger(s.offerSeq) ||
    s.offers.some(
      (o) =>
        !isPlayer(s, o.from) ||
        !isPlayer(s, o.to) ||
        o.from === o.to ||
        !s.items[o.give] ||
        !s.items[o.receive] ||
        !s.places[o.place] ||
        !Number.isInteger(o.turn),
    )
  )
    fail("an offer is invalid");
  if (
    !Array.isArray(s.log) ||
    s.log.length > 100 ||
    s.log.some(
      (e) =>
        !Number.isInteger(e.seq) ||
        typeof e.text !== "string" ||
        (e.verb !== undefined && !VERBS.includes(e.verb)),
    )
  )
    fail("the log is invalid");
  return s;
}
export const encodeSave = (s) => JSON.stringify(validateWorld(s));
export const decodeSave = (text) => validateWorld(JSON.parse(text));
