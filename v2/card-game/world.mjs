import {
  questPrograms,
  newProgress,
  programFor,
  desireFor,
  levelOf,
} from "./quests.mjs";
// The playable slice uses one rule path for the guided avatar and the cast.
export const places = {
  station: {
    name: "Empty station",
    text: "The timetable lists years that have yet to happen. Stairs lead to the attic; a path leads to the pond.",
    exits: ["attic", "pond"],
  },
  attic: {
    name: "Mirror attic",
    text: "A tall mirror reflects a black shore. Light opens a path to the pond. The stairs lead to the station.",
    exits: ["station"],
  },
  pond: {
    name: "Black pond",
    text: "Something vast breathes beneath the reflection. Light opens a path to the attic. A path leads to the station.",
    exits: ["station"],
  },
};
export const people = {
  vale: {
    name: "Vale",
    text: "Your avatar. A traveller with a coat full of empty pockets.",
  },
  moth: {
    name: "Pip",
    text: "A moth in a borrowed waistcoat. Seeks a lamp and a witness at the pond.",
  },
  keeper: {
    name: "The keeper",
    text: "A tall figure with a clock for a face. Seeks a bell and a witness in the attic.",
  },
};
export const things = {
  lamp: {
    name: "Lamp",
    text: "Light reveals paths through reflections. Burns one fuel each turn, even under a cloth.",
  },
  oil: {
    name: "Oil flask",
    text: "Each dose adds four fuel to the lamp, up to twelve.",
  },
  bell: {
    name: "Bell",
    text: "Rings for three turns. The Black cloth stops its sound.",
  },
  cloth: {
    name: "Black cloth",
    text: "Cover the lamp to block its light, or the bell to stop its sound. Travels with the covered object.",
  },
};
const ids = Object.keys(things);
const actorIds = Object.keys(people);
export const nameOf = (id) =>
  places[id]?.name || people[id]?.name || things[id]?.name || "the world";
export function createWorld() {
  return {
    schema: 2,
    turn: 0,
    revision: 0,
    eventSeq: 1,
    actors: {
      vale: {
        place: "station",
        progress: newProgress(),
        crossed: 0,
        lastTalk: -9,
      },
      moth: {
        place: "pond",
        progress: newProgress(),
        crossed: 0,
        lastTalk: -9,
      },
      keeper: {
        place: "attic",
        progress: newProgress(),
        crossed: 0,
        lastTalk: -9,
      },
    },
    items: {
      lamp: { holder: "station", fuel: 8, lit: false, history: [] },
      oil: { holder: "keeper", doses: 3, history: [] },
      bell: { holder: "station", ringing: 0, history: [] },
      cloth: { holder: "moth", history: [] },
    },
    log: [
      {
        seq: 1,
        turn: 0,
        kind: "narration",
        actorId: null,
        locationId: "station",
        cast: ["vale"],
        items: [
          { id: "lamp", holder: "station", fuel: 8, lit: false },
          { id: "bell", holder: "station", ringing: 0 },
        ],
        light: false,
        speaker: "World",
        text: "Vale arrives at the empty station. Pip carries a black cloth. The keeper holds the oil. Each wants a different hand. Something under the pond is listening.",
      },
    ],
  };
}
export function rootHolder(s, id) {
  let holder = s.items[id].holder;
  const visited = new Set([id]);
  while (s.items[holder]) {
    if (visited.has(holder)) throw new Error("An item holds itself.");
    visited.add(holder);
    holder = s.items[holder].holder;
  }
  return holder;
}
export const itemPlace = (s, id) =>
  s.actors[rootHolder(s, id)]?.place || rootHolder(s, id);
export const carried = (s, actor) =>
  ids.filter((id) => rootHolder(s, id) === actor);
export const covered = (s, id) => s.items.cloth.holder === id;
export const shining = (s) =>
  s.items.lamp.lit && s.items.lamp.fuel > 0 && !covered(s, "lamp");
export const reflectionOpen = (s) =>
  shining(s) && ["attic", "pond"].includes(itemPlace(s, "lamp"));
export function exits(s, place) {
  return [
    ...places[place].exits,
    ...(reflectionOpen(s) && place === "attic"
      ? ["pond"]
      : reflectionOpen(s) && place === "pond"
        ? ["attic"]
        : []),
  ];
}
const canReach = (s, actor, item) =>
  (itemPlace(s, item) === s.actors[actor].place &&
    !actorIds.includes(rootHolder(s, item))) ||
  rootHolder(s, item) === actor;
const loadOf = (s, id) => 1 + (s.items.cloth.holder === id ? 1 : 0);
const hasSpace = (s, actor, id) =>
  carried(s, actor).length +
    (rootHolder(s, id) === actor ? 0 : loadOf(s, id)) <=
  3;
export function handStatus(s, actor, hand = desireFor(s, actor)) {
  const held = carried(s, actor),
    here = s.actors[actor].place;
  const items = hand.items.map((id) => ({ id, met: held.includes(id) }));
  const location = {
    id: hand.location,
    met: !hand.location || here === hand.location,
  };
  const avatars = hand.avatars.map((id) => ({
    id,
    met: s.actors[id].place === here,
  }));
  return {
    items,
    location,
    avatars,
    met:
      items.every((e) => e.met) && location.met && avatars.every((e) => e.met),
  };
}
export function handText(hand) {
  return [
    hand.items.length
      ? `hold ${hand.items.map(nameOf).join(" + ")}`
      : "hold any items",
    hand.location ? `at ${nameOf(hand.location)}` : "in any place",
    hand.avatars.length
      ? `with ${hand.avatars.map(nameOf).join(" + ")}`
      : "with any company",
  ].join(" · ");
}
const bundle = (s, item) => [
  item,
  ...(s.items.cloth.holder === item ? ["cloth"] : []),
];
const needed = (s, actor, item) =>
  bundle(s, item).some((id) => desireFor(s, actor).items.includes(id));
const accepts = (s, actor, item) =>
  actor === "vale" ||
  bundle(s, item).some(
    (id) =>
      desireFor(s, actor).items.includes(id) && rootHolder(s, id) !== actor,
  );
export function willingToGive(s, owner, item) {
  return (
    owner !== "vale" &&
    !needed(s, owner, item) &&
    handStatus(s, owner).items.every((e) => e.met)
  );
}
export function canTrade(s, actor, give, receive) {
  const other = s.items[receive]?.holder;
  if (
    s.items[give]?.holder !== actor ||
    !actorIds.includes(other) ||
    other === actor ||
    other === "vale" ||
    s.actors[actor].place !== s.actors[other].place
  )
    return false;
  if (!accepts(s, other, give) || needed(s, other, receive)) return false;
  const outgoing = loadOf(s, give),
    incoming = loadOf(s, receive);
  return (
    carried(s, actor).length - outgoing + incoming <= 3 &&
    carried(s, other).length - incoming + outgoing <= 3
  );
}
export function tradeOffers(s, actor) {
  return ids.filter(
    (id) => s.items[id].holder === actor && !needed(s, actor, id),
  );
}
// Capture each fulfilled hand before another actor can leave or move an item.
// Program changes happen after the round, so every actor pursues one step per turn.
function captureHands(s, met) {
  for (const actor of actorIds) {
    if (!met.has(actor) && programFor(s, actor) && handStatus(s, actor).met) {
      met.set(actor, {
        items: carried(s, actor),
        location: s.actors[actor].place,
        avatars: actorIds.filter(
          (id) => id !== actor && s.actors[id].place === s.actors[actor].place,
        ),
      });
    }
  }
}
function advancePrograms(s, met) {
  for (const [actor, fulfillment] of met) {
    const progress = s.actors[actor].progress,
      program = programFor(s, actor);
    const step = progress.step;
    progress.marks.push(s.turn);
    progress.step += 1;
    let text = `${nameOf(actor)} completes hand ${step + 1}/${program.steps.length} of ${program.name}.`;
    if (progress.step === program.steps.length) {
      progress.program += 1;
      progress.step = 0;
      text += ` Level ${levelOf(s, actor)}.`;
    }
    if (programFor(s, actor))
      text += ` Next: ${handText(desireFor(s, actor))}.`;
    else text += " Both quest programs are complete.";
    addLog(s, "World", text, {
      kind: "quest",
      actorId: actor,
      programId: program.id,
      fulfillment,
      step,
      level: levelOf(s, actor),
    });
  }
}
function addLog(s, speaker, text, detail = {}) {
  const actorId =
    detail.actorId ?? actorIds.find((id) => nameOf(id) === speaker) ?? null;
  const locationId = detail.locationId || s.actors[actorId || "vale"].place;
  if (s.eventSeq === undefined) {
    s.log.forEach((entry, index) => {
      entry.seq = index + 1;
    });
    s.eventSeq = s.log.length;
  }
  s.eventSeq += 1;
  s.log.push({
    seq: s.eventSeq,
    turn: s.turn,
    speaker,
    text,
    kind:
      detail.kind ||
      (speaker === "You" ? "input" : actorId ? "dialogue" : "narration"),
    actorId,
    locationId,
    cast: actorIds.filter((id) => s.actors[id].place === locationId),
    items: ids
      .filter((id) => itemPlace(s, id) === locationId)
      .map((id) => {
        const { history, ...item } = s.items[id];
        return { id, ...item };
      }),
    light: shining(s) && itemPlace(s, "lamp") === locationId,
    ...detail,
  });
  while (s.log.length > 100) {
    // Keep scene beats when commands fill the history. Retain the latest reply.
    const hint = s.log.findIndex(
      (entry, index) =>
        index < s.log.length - 1 && ["input", "hint"].includes(entry.kind),
    );
    s.log.splice(hint >= 0 ? hint : 0, 1);
  }
}
function remember(s, item, text) {
  s.items[item].history.push(`Turn ${s.turn}: ${text}`);
  s.items[item].history = s.items[item].history.slice(-12);
}
function transfer(s, item, holder, text) {
  s.items[item].holder = holder;
  remember(s, item, text);
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
export function legalActions(s, actor = "vale") {
  const here = s.actors[actor].place;
  const out = [
    offer("wait", actor, null, null, `${nameOf(actor)} waits one turn.`, []),
  ];
  for (const to of exits(s, here)) {
    const through = !places[here].exits.includes(to);
    out.push(
      offer(
        "move",
        actor,
        null,
        to,
        `${nameOf(actor)} goes to ${nameOf(to)}${through ? " through the reflection" : ""}.`,
        [to],
      ),
    );
    for (const id of ids.filter((id) => s.items[id].holder === actor)) {
      out.push(
        offer(
          "move",
          actor,
          id,
          to,
          `${nameOf(actor)} carries the ${nameOf(id)} to ${nameOf(to)}${through ? " through the reflection" : ""}.`,
          [id, to],
        ),
      );
    }
  }
  for (const other of actorIds.filter(
    (id) => id !== actor && s.actors[id].place === here,
  )) {
    out.push(
      offer(
        "talk",
        actor,
        null,
        other,
        `${nameOf(actor)} asks ${nameOf(other)} what they want.`,
        [other],
      ),
    );
  }
  for (const id of ids) {
    const item = s.items[id];
    if (itemPlace(s, id) !== here) continue;
    if (
      canReach(s, actor, id) &&
      item.holder !== actor &&
      hasSpace(s, actor, id)
    ) {
      out.push(
        offer(
          "take",
          actor,
          id,
          null,
          `${nameOf(actor)} ${things[item.holder] ? "uncovers and takes" : "takes"} the ${nameOf(id)}.`,
          [id],
        ),
      );
    }
    if (item.holder === actor) {
      out.push(
        offer(
          "drop",
          actor,
          id,
          here,
          `${nameOf(actor)} puts the ${nameOf(id)} in ${nameOf(here)}.`,
          [id],
        ),
      );
      for (const other of actorIds.filter(
        (p) =>
          p !== actor &&
          s.actors[p].place === here &&
          accepts(s, p, id) &&
          hasSpace(s, p, id),
      )) {
        out.push(
          offer(
            "give",
            actor,
            id,
            other,
            `${nameOf(actor)} gives the ${nameOf(id)} to ${nameOf(other)}.`,
            [id, other],
          ),
        );
      }
    } else if (
      actorIds.includes(item.holder) &&
      item.holder !== actor &&
      hasSpace(s, actor, id)
    ) {
      out.push(
        offer(
          "ask",
          actor,
          id,
          item.holder,
          `${nameOf(actor)} asks ${nameOf(item.holder)} for the ${nameOf(id)}.`,
          [id, item.holder],
        ),
      );
    }
    if (!canReach(s, actor, id)) continue;
    if (id === "lamp") {
      if (item.lit)
        out.push(
          offer(
            "snuff",
            actor,
            id,
            null,
            `${nameOf(actor)} puts out the Lamp.`,
            [id],
          ),
        );
      else if (item.fuel > 0)
        out.push(
          offer(
            "light",
            actor,
            id,
            null,
            `${nameOf(actor)} lights the Lamp${covered(s, id) ? " under its cloth" : ""}.`,
            [id],
          ),
        );
    }
    if (id === "bell" && !covered(s, id))
      out.push(
        offer(
          "ring",
          actor,
          id,
          null,
          `${nameOf(actor)} rings the Bell. The sound carries across the shore.`,
          [id],
        ),
      );
    if (
      id === "oil" &&
      item.doses > 0 &&
      s.items.lamp.fuel < 12 &&
      canReach(s, actor, "lamp") &&
      itemPlace(s, "lamp") === here
    ) {
      out.push(
        offer(
          "refill",
          actor,
          id,
          "lamp",
          `${nameOf(actor)} pours one dose of oil into the Lamp.`,
          [id, "lamp"],
        ),
      );
    }
    if (id === "cloth" && item.holder !== "lamp" && item.holder !== "bell") {
      for (const target of ["lamp", "bell"].filter(
        (t) =>
          itemPlace(s, t) === here &&
          canReach(s, actor, t) &&
          (rootHolder(s, t) !== actor || hasSpace(s, actor, id)),
      )) {
        out.push(
          offer(
            "cover",
            actor,
            id,
            target,
            `${nameOf(actor)} covers the ${nameOf(target)} with the Black cloth.`,
            [id, target],
          ),
        );
      }
    }
  }
  for (const give of ids)
    for (const receive of ids) {
      if (!canTrade(s, actor, give, receive)) continue;
      const other = s.items[receive].holder;
      const action = offer(
        "trade",
        actor,
        give,
        other,
        `${nameOf(actor)} trades the ${nameOf(give)} for ${nameOf(other)}’s ${nameOf(receive)}.`,
        [give, receive],
      );
      action.receive = receive;
      action.key += ":" + receive;
      out.push(action);
    }
  return out;
}
export function matchingActions(s, selected) {
  const set = [...new Set(selected)].filter((id) => id !== "vale");
  if (!set.length) return [];
  return legalActions(s).filter(
    (a) =>
      a.cards.length === set.length && set.every((id) => a.cards.includes(id)),
  );
}
function sayWant(s, actor) {
  const offers = tradeOffers(s, actor);
  return `I want to ${handText(desireFor(s, actor))}.${offers.length ? ` I can offer ${offers.map(nameOf).join(" or ")}.` : ""}`;
}
function perform(s, a) {
  const who = nameOf(a.actor);
  const here = s.actors[a.actor].place;
  if (a.kind === "wait") return;
  let text = a.text;
  switch (a.kind) {
    case "move":
      if (!places[here].exits.includes(a.target)) {
        s.actors[a.actor].crossed += 1;
        text += " Something on the far shore turns its head.";
      }
      s.actors[a.actor].place = a.target;
      for (const id of carried(s, a.actor))
        remember(s, id, `${who} carried it to ${nameOf(a.target)}.`);
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
    case "light":
      s.items.lamp.lit = true;
      remember(s, "lamp", a.text);
      break;
    case "snuff":
      s.items.lamp.lit = false;
      remember(s, "lamp", a.text);
      break;
    case "ring":
      s.items.bell.ringing = 3;
      remember(s, "bell", a.text);
      break;
    case "refill":
      s.items.oil.doses -= 1;
      s.items.lamp.fuel = Math.min(12, s.items.lamp.fuel + 4);
      remember(s, "oil", a.text);
      remember(s, "lamp", a.text);
      break;
    case "cover":
      transfer(s, "cloth", a.target, a.text);
      remember(s, a.target, a.text);
      if (a.target === "bell") s.items.bell.ringing = 0;
      break;
    case "talk":
      addLog(s, who, `What do you want, ${nameOf(a.target)}?`);
      addLog(s, nameOf(a.target), sayWant(s, a.target));
      s.actors[a.actor].lastTalk = s.turn;
      return;
    case "ask": {
      const willing = willingToGive(s, a.target, a.item);
      addLog(s, who, `May I have the ${nameOf(a.item)}?`);
      if (willing) {
        text = `${nameOf(a.target)} hands the ${nameOf(a.item)} to ${who}.`;
        transfer(s, a.item, a.actor, text);
      } else {
        addLog(s, nameOf(a.target), sayWant(s, a.target));
        s.actors[a.actor].lastTalk = s.turn;
        return;
      }
      break;
    }
    default:
      throw new Error("Unknown act.");
  }
  addLog(s, "World", text, {
    kind: "action",
    actorId: a.actor,
    verb: a.kind,
    itemId: a.item,
    targetId: a.target,
    ...(a.receive ? { receiveId: a.receive } : {}),
  });
}
function toward(s, actor, target) {
  const from = s.actors[actor].place;
  const queue = [[from]],
    visited = new Set([from]);
  while (queue.length) {
    const route = queue.shift();
    if (route.at(-1) === target)
      return legalActions(s, actor).find(
        (a) => a.kind === "move" && a.target === route[1],
      );
    for (const next of exits(s, route.at(-1)))
      if (!visited.has(next)) {
        visited.add(next);
        queue.push([...route, next]);
      }
  }
}
export function plan(s, actor = "vale") {
  const acts = legalActions(s, actor),
    hand = desireFor(s, actor);
  const here = s.actors[actor].place;
  const find = (kind, item, target) =>
    acts.find(
      (a) =>
        a.kind === kind &&
        (item === undefined || a.item === item) &&
        (target === undefined || a.target === target),
    );
  const idle = (reason) => ({ action: acts[0], reason });
  const choose = (action, reason) =>
    action ? { action, reason } : idle(reason);
  const missing = hand.items.filter((id) => rootHolder(s, id) !== actor);
  const reason = `Seek this hand: ${handText(hand)}.`;
  for (const item of missing) {
    if (itemPlace(s, item) !== here) continue;
    const take = find("take", item);
    if (take) return choose(take, reason);
    const trade = acts.find(
      (a) =>
        a.kind === "trade" &&
        bundle(s, a.receive).includes(item) &&
        !needed(s, actor, a.item),
    );
    if (trade) return choose(trade, reason);
    const owner = rootHolder(s, item);
    if (actorIds.includes(owner) && s.turn - s.actors[actor].lastTalk >= 3) {
      let heldItem = item;
      while (s.items[s.items[heldItem].holder])
        heldItem = s.items[heldItem].holder;
      const ask = find("ask", heldItem);
      if (ask)
        return choose(
          ask,
          `Ask ${nameOf(owner)} for ${nameOf(item)}. ${reason}`,
        );
    }
    if (!hasSpace(s, actor, item)) {
      const drop = acts.find(
        (a) => a.kind === "drop" && !needed(s, actor, a.item),
      );
      if (drop) return choose(drop, "Make room for the target hand.");
      if (rootHolder(s, "cloth") === actor && !hand.items.includes("cloth"))
        return choose(
          find("take", "cloth"),
          "Uncover the object to make room.",
        );
    }
  }
  const elsewhere = missing.find((id) => itemPlace(s, id) !== here);
  if (elsewhere)
    return choose(toward(s, actor, itemPlace(s, elsewhere)), reason);
  if (missing.length) return idle(reason);
  // Item affordances also apply when an avatar carries its target hand.
  if (hand.items.includes("lamp") && rootHolder(s, "lamp") === actor) {
    if (covered(s, "lamp") && !hand.items.includes("cloth"))
      return choose(find("take", "cloth"), "Uncover the light.");
    if (s.items.lamp.fuel <= 2 && find("refill", "oil"))
      return choose(find("refill", "oil"), "Feed oil to the lamp.");
    if (!s.items.lamp.lit && s.items.lamp.fuel > 0)
      return choose(find("light", "lamp"), "Light the lamp.");
  }
  if (
    hand.items.includes("cloth") &&
    rootHolder(s, "bell") === actor &&
    s.items.bell.ringing &&
    find("cover", "cloth", "bell")
  )
    return choose(find("cover", "cloth", "bell"), "Wrap the ringing bell.");
  if (hand.location && here !== hand.location)
    return choose(toward(s, actor, hand.location), reason);
  return idle(
    handStatus(s, actor).met
      ? "Hold the target hand."
      : `Wait for ${hand.avatars
          .filter((id) => s.actors[id].place !== here)
          .map(nameOf)
          .join(" and ")} at ${nameOf(here)}.`,
  );
}
export function play(s, action, expectedRevision = s.revision) {
  if (expectedRevision !== s.revision)
    return {
      ok: false,
      state: s,
      error: "The world changed. Choose a current play.",
    };
  const exact = legalActions(s).find((a) => a.key === action?.key);
  if (!exact)
    return {
      ok: false,
      state: s,
      error: "That play has changed. Check the cards and choose again.",
    };
  const next = structuredClone(s);
  next.turn += 1;
  next.revision += 1;
  const wasOpen = reflectionOpen(next);
  if (exact.kind === "wait")
    addLog(next, "World", "Vale waits. The cast takes a turn.");
  const met = new Map();
  captureHands(next, met);
  perform(next, exact);
  captureHands(next, met);
  for (const actor of ["moth", "keeper"]) {
    perform(next, plan(next, actor).action);
    captureHands(next, met);
  }
  if (next.items.lamp.lit) {
    next.items.lamp.fuel = Math.max(0, next.items.lamp.fuel - 1);
    if (next.items.lamp.fuel === 0) {
      next.items.lamp.lit = false;
      addLog(
        next,
        "World",
        "The Lamp runs dry. Its flame folds into a tiny black sun.",
        { locationId: itemPlace(next, "lamp") },
      );
    }
  }
  next.items.bell.ringing = Math.max(0, next.items.bell.ringing - 1);
  const isOpen = reflectionOpen(next);
  if (wasOpen !== isOpen)
    addLog(
      next,
      "World",
      isOpen
        ? "The attic mirror and the pond open onto each other. A dark shore waits between them."
        : "The reflected path closes. The paths through the station remain open.",
    );
  advancePrograms(next, met);
  validateWorld(next);
  return { ok: true, state: next };
}
export function validateWorld(s) {
  const fail = () => {
    throw new Error(
      "This save needs a fresh start. Your previous save is kept until you choose New game.",
    );
  };
  if (
    !s ||
    s.schema !== 2 ||
    !Number.isSafeInteger(s.turn) ||
    s.turn < 0 ||
    !Number.isSafeInteger(s.revision) ||
    s.revision < s.turn
  )
    fail();
  if (
    Object.keys(s.actors || {})
      .sort()
      .join() !== actorIds.slice().sort().join() ||
    Object.keys(s.items || {})
      .sort()
      .join() !== ids.slice().sort().join()
  )
    fail();
  for (const [id, a] of Object.entries(s.actors)) {
    if (
      !Object.hasOwn(places, a.place) ||
      !Number.isSafeInteger(a.crossed) ||
      a.crossed < 0 ||
      !Number.isSafeInteger(a.lastTalk) ||
      a.lastTalk > s.turn
    )
      fail();
    const progress = a.progress,
      programs = questPrograms[id];
    if (
      !progress ||
      !Number.isInteger(progress.program) ||
      progress.program < 0 ||
      progress.program > programs.length ||
      !Number.isInteger(progress.step) ||
      progress.step < 0 ||
      (progress.program === programs.length
        ? progress.step !== 0
        : progress.step >= programs[progress.program].steps.length)
    )
      fail();
    const count =
      programs
        .slice(0, progress.program)
        .reduce((n, p) => n + p.steps.length, 0) + progress.step;
    if (
      !Array.isArray(progress.marks) ||
      progress.marks.length !== count ||
      progress.marks.some(
        (turn, i) =>
          !Number.isSafeInteger(turn) ||
          turn < 1 ||
          turn > s.turn ||
          (i > 0 && turn <= progress.marks[i - 1]),
      )
    )
      fail();
  }
  for (const [id, item] of Object.entries(s.items)) {
    if (
      ![
        ...actorIds,
        ...Object.keys(places),
        ...(id === "cloth" ? ["lamp", "bell"] : []),
      ].includes(item.holder)
    )
      fail();
    if (
      !Array.isArray(item.history) ||
      item.history.length > 12 ||
      item.history.some((t) => typeof t !== "string" || t.length > 400)
    )
      fail();
  }
  for (const actor of actorIds) if (carried(s, actor).length > 3) fail();
  const lamp = s.items.lamp,
    oil = s.items.oil,
    bell = s.items.bell;
  if (
    !Number.isInteger(lamp.fuel) ||
    lamp.fuel < 0 ||
    lamp.fuel > 12 ||
    typeof lamp.lit !== "boolean" ||
    (lamp.lit && lamp.fuel === 0)
  )
    fail();
  if (
    !Number.isInteger(oil.doses) ||
    oil.doses < 0 ||
    oil.doses > 3 ||
    !Number.isInteger(bell.ringing) ||
    bell.ringing < 0 ||
    bell.ringing > 3 ||
    (covered(s, "bell") && bell.ringing > 0)
  )
    fail();
  if (
    !Array.isArray(s.log) ||
    s.log.length > 100 ||
    s.log.some(
      (e) =>
        !Number.isSafeInteger(e.turn) ||
        e.turn < 0 ||
        e.turn > s.turn ||
        typeof e.text !== "string" ||
        e.text.length > 600 ||
        typeof e.speaker !== "string" ||
        e.speaker.length > 40,
    )
  )
    fail();
  if (
    s.eventSeq !== undefined &&
    (!Number.isSafeInteger(s.eventSeq) || s.eventSeq < s.log.length)
  )
    fail();
  let seq = 0;
  const verbs = [
    "move",
    "take",
    "drop",
    "give",
    "ask",
    "light",
    "snuff",
    "ring",
    "refill",
    "cover",
    "talk",
    "wait",
    "trade",
  ];
  for (const e of s.log) {
    if (e.seq !== undefined) {
      if (!Number.isSafeInteger(e.seq) || e.seq <= seq || e.seq > s.eventSeq)
        fail();
      seq = e.seq;
    }
    if (
      e.kind !== undefined &&
      !["action", "dialogue", "narration", "input", "hint", "quest"].includes(
        e.kind,
      )
    )
      fail();
    if (e.actorId != null && !actorIds.includes(e.actorId)) fail();
    if (e.locationId != null && !Object.hasOwn(places, e.locationId)) fail();
    if (e.verb != null && !verbs.includes(e.verb)) fail();
    if (e.itemId != null && !ids.includes(e.itemId)) fail();
    if (e.receiveId != null && !ids.includes(e.receiveId)) fail();
    if (e.kind === "quest") {
      const program = questPrograms[e.actorId]?.find(
        (p) => p.id === e.programId,
      );
      if (
        !program ||
        !Number.isInteger(e.step) ||
        e.step < 0 ||
        e.step >= program.steps.length ||
        !Number.isInteger(e.level) ||
        e.level < 1 ||
        e.level > 3
      )
        fail();
    }
    if (e.kind === "quest" && e.fulfillment !== undefined) {
      const target = questPrograms[e.actorId].find((p) => p.id === e.programId)
          .steps[e.step],
        seen = e.fulfillment;
      if (
        !seen ||
        !Array.isArray(seen.items) ||
        seen.items.length > 3 ||
        new Set(seen.items).size !== seen.items.length ||
        seen.items.some((id) => !ids.includes(id)) ||
        !Object.hasOwn(places, seen.location) ||
        !Array.isArray(seen.avatars) ||
        seen.avatars.length > 2 ||
        new Set(seen.avatars).size !== seen.avatars.length ||
        seen.avatars.some((id) => !actorIds.includes(id) || id === e.actorId) ||
        target.items.some((id) => !seen.items.includes(id)) ||
        (target.location && target.location !== seen.location) ||
        target.avatars.some((id) => !seen.avatars.includes(id))
      )
        fail();
    }
    if (
      e.targetId != null &&
      ![...actorIds, ...ids, ...Object.keys(places)].includes(e.targetId)
    )
      fail();
    if (e.light !== undefined && typeof e.light !== "boolean") fail();
    if (
      e.cast !== undefined &&
      (!Array.isArray(e.cast) ||
        e.cast.length > 3 ||
        new Set(e.cast).size !== e.cast.length ||
        e.cast.some((id) => !actorIds.includes(id)))
    )
      fail();
    if (
      e.items !== undefined &&
      (!Array.isArray(e.items) ||
        e.items.length > 4 ||
        e.items.some(
          (item) =>
            !item ||
            !ids.includes(item.id) ||
            ![...actorIds, ...ids, ...Object.keys(places)].includes(
              item.holder,
            ),
        ))
    )
      fail();
  }
  return s;
}
export const encodeSave = (s) => JSON.stringify(validateWorld(s));
export function decodeSave(text) {
  const s = JSON.parse(text);
  if (s?.schema === 1 && s.actors && typeof s.actors === "object") {
    s.schema = 2;
    for (const actor of Object.values(s.actors)) {
      if (actor && typeof actor === "object") {
        actor.progress = newProgress();
        delete actor.aim;
      }
    }
  }
  return validateWorld(s);
}
