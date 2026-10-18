// The general card core: one rule path for every avatar, item, and place. The
// world's registries live in its state, so seeds and later spawns can add
// entities without code changes. No rule names a specific entity.
import {
  avatarOrder,
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
  newProgress,
  programFor,
  sequence,
  targetsFor,
} from "./goals.mjs";
import { plan } from "./planner.mjs";
import { applySpawns, validSpawnRule, validTables } from "./spawn.mjs";

export const SCHEMA = 1;
export const DEFAULT_RULES = {
  carry: 3,
  actRadius: 2,
  questRadius: 3,
  stallTurns: 12,
  errandTurns: 24,
  maxSpawns: 64,
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
    tables: structuredClone(seed.tables || {}),
    claims: {},
    spawned: 0,
    log: [],
  };
  for (const p of seed.places)
    s.places[p.id] = {
      ...entity(p),
      exits: [...p.exits],
      visits: 0,
      spawn: structuredClone(p.spawn || []),
    };
  for (const a of seed.avatars)
    s.avatars[a.id] = {
      ...entity(a),
      role: a.role,
      place: a.place,
      progress: newProgress(),
      lastTalk: -9,
      peaceUntil: 0,
    };
  for (const i of seed.items)
    s.items[i.id] = { ...entity(i), holder: i.holder, history: [] };
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
  isPlayer(s, avatar) ||
  (needed(s, avatar, item) && holderOf(s, item) !== avatar);
export const stalled = (s, avatar) =>
  s.turn - (s.avatars[avatar].progress.marks.at(-1) || 0) >=
  s.rules.errandTurns;
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
function settleStandoffs(s) {
  for (const c of [...s.standoffs]) {
    const separated = [c.challenger, c.defender].some(
      (id) => placeOf(s, id) !== c.location,
    );
    const released = c.item && holderOf(s, c.item) !== c.defender;
    if (!separated && !released) continue;
    closeStandoff(s, c);
    addLog(
      s,
      separated
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
  for (const other of avatarOrder(s).filter(
    (id) => id !== actor && placeOf(s, id) === here,
  )) {
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
      for (const other of avatarOrder(s).filter(
        (p) =>
          p !== actor &&
          placeOf(s, p) === here &&
          accepts(s, p, id) &&
          hasSpace(s, p, id),
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
    } else if (s.avatars[holder] && hasSpace(s, actor, id)) {
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
  return out;
}

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
      s.places[a.target].visits += 1;
      round.touched.add(a.target);
      round.arrivals.push({
        avatar: a.actor,
        place: a.target,
        items: carried(s, a.actor),
      });
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
    if (met.has(avatar)) continue;
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
    if (!p.current) p.current = generateQuest(structuredClone(s), avatar);
  }
}
function advanceQuests(s, met, round = newRound()) {
  const receipts = [];
  for (const [avatar, target] of met) {
    const progress = s.avatars[avatar].progress,
      quest = programFor(s, avatar),
      step = progress.step;
    progress.marks = [...progress.marks, s.turn].slice(-32);
    progress.step += 1;
    const complete = progress.step === quest.steps.length;
    if (complete) {
      round.completed.push({ avatar, place: placeOf(s, avatar) });
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
    if (
      s.turn - Math.max(current.generated.turn, p.marks.at(-1) || 0) <
      s.rules.stallTurns
    )
      continue;
    const fresh = generateQuest(structuredClone(s), avatar, {
      independent: !isPlayer(s, avatar),
      solo: stalled(s, avatar),
    });
    const unfinished = fresh.steps.filter(
      (step) => !alternatives(step).some((h) => handStatus(s, avatar, h).met),
    );
    if (!unfinished.length) continue;
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

// One round's causes: arrivals, completed quests, and places where an act
// happened. Spawn rules read only these, so a quiet place never grows.
function newRound() {
  const round = { arrivals: [], completed: [], touched: new Set() };
  round.visits = (place) =>
    round.arrivals.filter((a) => a.place === place).length;
  return round;
}
function spawnText(s, { id, kind, place }) {
  const n = (e) => nameOf(s, e);
  if (kind === "open_place") return `A way opens from ${n(place)} to ${n(id)}.`;
  if (kind === "add_item") return `A ${n(id)} turns up in ${n(place)}.`;
  return `${n(id)} arrives at ${n(place)}.`;
}

// Residents near the acting player take one act each. Residents farther away
// stay still, so a quiet part of the world does not change.
export function activeResidents(s, player) {
  const near = distances(s, placeOf(s, player), s.rules.actRadius);
  return avatarOrder(s).filter(
    (id) => !isPlayer(s, id) && near.has(placeOf(s, id)),
  );
}

export function play(s, action, expectedRevision = s.revision) {
  if (expectedRevision !== s.revision)
    return {
      ok: false,
      state: s,
      error: "The world changed. Choose a current play.",
    };
  const actor = action?.actor;
  const exact =
    actor && isPlayer(s, actor)
      ? legalActions(s, actor).find((a) => a.key === action.key)
      : null;
  if (!exact)
    return {
      ok: false,
      state: s,
      error: "That play has changed. Check the cards and choose again.",
    };
  const next = structuredClone(s);
  next.turn += 1;
  next.revision += 1;
  const met = new Map();
  captureHands(next, met);
  const round = newRound();
  perform(next, exact, round);
  captureHands(next, met);
  const active = activeResidents(next, actor);
  for (const resident of active) {
    perform(next, plan(next, resident).action, round);
    captureHands(next, met);
  }
  advanceQuests(next, met, round);
  refreshStalledQuests(next, [actor, ...active]);
  for (const spawn of applySpawns(next, round))
    addLog(next, spawnText(next, spawn), {
      kind: "spawn",
      locationId: spawn.place,
      spawnId: spawn.id,
      claim: spawn.key,
    });
  ensureQuests(next);
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
    fail("spawn records are invalid");
  for (const [id, p] of Object.entries(s.places))
    if (
      !validEntity(p) ||
      !Number.isInteger(p.visits) ||
      !Array.isArray(p.spawn) ||
      !p.spawn.every((rule) => validSpawnRule(rule, s.tables)) ||
      !Array.isArray(p.exits) ||
      p.exits.some((to) => !s.places[to] || to === id) ||
      new Set(p.exits).size !== p.exits.length
    )
      fail(`place ${id} is invalid`);
  for (const [id, a] of Object.entries(s.avatars)) {
    if (
      !validEntity(a) ||
      !["player", "resident"].includes(a.role) ||
      !s.places[a.place] ||
      !Number.isInteger(a.lastTalk) ||
      !Number.isInteger(a.peaceUntil)
    )
      fail(`avatar ${id} is invalid`);
    const p = a.progress;
    if (
      !p ||
      ![p.program, p.step, p.completedHands].every(
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
      !(s.places[item.holder] || s.avatars[item.holder]) ||
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
