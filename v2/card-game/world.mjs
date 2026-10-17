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
    text: "A moth in a borrowed waistcoat. Wants to bring a lamp to the pond.",
  },
  keeper: {
    name: "The keeper",
    text: "A tall figure with a clock for a face. Carries noisy bells to the attic.",
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
    text: "Rings for three turns. The keeper hears it across all three places.",
  },
  cloth: {
    name: "Black cloth",
    text: "Cover the lamp to block its light, or the bell to stop its sound. Travels with the covered object.",
  },
};
export const aims = {
  explore: "Cross a reflection",
  moth: "Help Pip bring light to the pond",
  bell: "Bring the bell to the pond",
  free: "Choose each step myself",
};
const ids = Object.keys(things);
const actorIds = Object.keys(people);
export const nameOf = (id) =>
  places[id]?.name || people[id]?.name || things[id]?.name || "the world";
export function createWorld() {
  return {
    schema: 1,
    turn: 0,
    revision: 0,
    eventSeq: 1,
    actors: {
      vale: { place: "station", aim: "explore", crossed: 0, lastTalk: -9 },
      moth: { place: "pond", aim: "moth", crossed: 0, lastTalk: -9 },
      keeper: { place: "attic", aim: "quiet", crossed: 0, lastTalk: -9 },
    },
    items: {
      lamp: { holder: "station", fuel: 8, lit: false, history: [] },
      oil: { holder: "attic", doses: 3, history: [] },
      bell: { holder: "station", ringing: 0, history: [] },
      cloth: { holder: "pond", history: [] },
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
        text: "Vale arrives at the empty station. Pip is looking for a lamp. The keeper wants quiet. Choose a card, or let Vale take a step toward an aim.",
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
const accepts = (actor, item) =>
  actor === "vale" ||
  (actor === "moth"
    ? ["lamp", "oil"].includes(item)
    : ["bell", "cloth"].includes(item));
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
          accepts(p, id) &&
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
          `${nameOf(actor)} rings the Bell. The keeper will hear it.`,
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
  if (actor === "keeper")
    return s.items.bell.ringing > 0
      ? "That bell will wake the thing below the pond. Hand it here, or wrap it in the cloth."
      : "I keep the bell in the attic. The cloth stops its sound. Quiet bells may travel.";
  if (actor === "moth")
    return itemPlace(s, "lamp") === "pond" && shining(s)
      ? "The light is here. Look: the thing below us has opened an eye."
      : "I want a lamp beside the pond. If you give me one, I can carry it there. Oil keeps it alive.";
  return `I want to ${aims[s.actors.vale.aim].toLowerCase()}.`;
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
      const willing =
        a.target === "keeper"
          ? s.items.bell.ringing === 0
          : a.target === "moth"
            ? a.item === "lamp" && s.items.lamp.fuel === 0
            : false;
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
  const acts = legalActions(s, actor);
  const find = (kind, item, target) =>
    acts.find(
      (a) =>
        a.kind === kind &&
        (!item || a.item === item) &&
        (!target || a.target === target),
    );
  const here = s.actors[actor].place;
  const idle = (reason) => ({ action: acts[0], reason });
  const choose = (action, reason) =>
    action ? { action, reason } : idle(reason);
  const seek = (id, reason) => {
    const at = itemPlace(s, id);
    return choose(
      here !== at ? toward(s, actor, at) : find("take", id) || find("ask", id),
      reason,
    );
  };
  if (actor === "keeper") {
    if (s.items.bell.holder === actor)
      return choose(
        here === "attic" ? find("drop", "bell") : toward(s, actor, "attic"),
        "Put the bell in the attic.",
      );
    if (s.items.bell.ringing > 0 && !covered(s, "bell")) {
      const at = itemPlace(s, "bell");
      if (at !== here)
        return choose(toward(s, actor, at), "Follow the ringing bell.");
      if (s.items.bell.holder === here)
        return choose(find("take", "bell"), "Carry the noise away.");
      if (s.turn - s.actors[actor].lastTalk >= 3)
        return choose(find("ask", "bell"), "Ask for the noisy bell.");
    }
    return idle("Enjoy the quiet.");
  }
  if (actor === "moth") {
    if (s.items.lamp.holder === actor) {
      if (covered(s, "lamp"))
        return choose(find("take", "cloth"), "Uncover the light.");
      if (!s.items.lamp.lit && s.items.lamp.fuel > 0)
        return choose(find("light", "lamp"), "Light the lamp.");
      if (s.items.lamp.fuel === 0) {
        if (s.items.oil.doses === 0)
          return idle("Wait by the empty lamp. The oil is spent.");
        const refill = find("refill", "oil");
        if (refill) return choose(refill, "Feed oil to the lamp.");
        if (
          here === itemPlace(s, "oil") &&
          s.turn - s.actors[actor].lastTalk < 3
        )
          return idle("Wait for an answer about the oil.");
        return seek("oil", "Find oil for the lamp.");
      }
      return choose(
        here === "pond" ? find("drop", "lamp") : toward(s, actor, "pond"),
        "Bring light to the pond.",
      );
    }
    if (itemPlace(s, "lamp") === "pond" && shining(s))
      return choose(
        here === "pond" ? acts[0] : toward(s, actor, "pond"),
        "Watch the light on the pond.",
      );
    if (itemPlace(s, "lamp") !== here)
      return choose(
        toward(s, actor, itemPlace(s, "lamp")),
        "Find the lamp for the pond.",
      );
    if (find("take", "lamp"))
      return choose(find("take", "lamp"), "Carry the lamp to the pond.");
    if (s.turn - s.actors[actor].lastTalk >= 3)
      return choose(find("ask", "lamp"), "Ask for the lamp.");
    return idle("Wait for a chance to carry the lamp.");
  }
  switch (s.actors.vale.aim) {
    case "explore":
      if (s.actors.vale.crossed > 0)
        return idle(
          "You crossed a reflection. Choose another aim or play freely.",
        );
      if (reflectionOpen(s))
        return choose(
          here === "station"
            ? toward(s, actor, "attic")
            : find("move", null, here === "attic" ? "pond" : "attic"),
          "Cross the lit reflection.",
        );
      if (covered(s, "lamp") && canReach(s, actor, "cloth"))
        return choose(find("take", "cloth"), "Uncover the lamp.");
      if (s.items.lamp.holder !== actor)
        return seek("lamp", "Find a lamp to open a reflection.");
      if (!s.items.lamp.fuel)
        return find("refill", "oil")
          ? choose(find("refill", "oil"), "Refill the lamp.")
          : seek("oil", "Find oil for the lamp.");
      if (here === "station")
        return choose(
          toward(s, actor, "attic"),
          "Bring the lamp to a reflection.",
        );
      return choose(find("light", "lamp"), "Light the reflection.");
    case "moth":
      if (itemPlace(s, "lamp") === "pond" && shining(s))
        return idle(
          "Pip has light at the pond. Choose another aim or play freely.",
        );
      if (s.items.lamp.holder === "moth")
        return idle("Give Pip time to carry the lamp.");
      if (s.items.lamp.holder !== actor)
        return seek("lamp", "Find a lamp for Pip.");
      if (here !== s.actors.moth.place)
        return choose(
          toward(s, actor, s.actors.moth.place),
          "Bring the lamp to Pip.",
        );
      return choose(find("give", "lamp", "moth"), "Let Pip carry the lamp.");
    case "bell":
      if (s.items.bell.holder === "pond")
        return idle(
          "The bell is at the pond. Choose another aim or play freely.",
        );
      if (s.items.bell.holder !== actor) return seek("bell", "Find the bell.");
      return choose(
        here === "pond" ? find("drop", "bell") : toward(s, actor, "pond"),
        "Bring the bell to the pond.",
      );
    default:
      return idle("Watch the cast for one turn.");
  }
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
  perform(next, exact);
  for (const actor of ["moth", "keeper"])
    perform(next, plan(next, actor).action);
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
  validateWorld(next);
  return { ok: true, state: next };
}
export function setAim(s, aim) {
  if (!Object.hasOwn(aims, aim)) throw new Error("Choose one of Vale’s aims.");
  const next = structuredClone(s);
  next.actors.vale.aim = aim;
  next.revision += 1;
  addLog(next, "Vale", `My aim: ${aims[aim].toLowerCase()}.`);
  return next;
}
export function chat(s, raw) {
  const text = String(raw).trim().slice(0, 240);
  const lower = text.toLowerCase();
  if (!text) return { state: s };
  const next = structuredClone(s);
  next.revision += 1;
  addLog(next, "You", text);
  const goal = /^(?:aim|goal)\s*:\s*(.*)$/i.exec(text)?.[1].toLowerCase();
  if (goal) {
    const id = /pip|moth|help/.test(goal)
      ? "moth"
      : /bell/.test(goal)
        ? "bell"
        : /reflect|explore|cross/.test(goal)
          ? "explore"
          : /free|myself|own/.test(goal)
            ? "free"
            : null;
    if (id) return { state: setAim(next, id) };
  }
  const aliases = {
    lamp: /lamp|lantern/,
    oil: /oil|flask/,
    bell: /bell/,
    cloth: /cloth|blanket/,
    moth: /pip|moth/,
    keeper: /keeper/,
    station: /station/,
    attic: /attic/,
    pond: /pond/,
  };
  let named = Object.keys(aliases).filter((id) => aliases[id].test(lower));
  if (/uncover/.test(lower) && named.includes(s.items.cloth.holder))
    named = ["cloth"];
  const kinds = [
    ["refill", /refill|pour|fuel/],
    ["snuff", /snuff|put out|extinguish/],
    ["take", /uncover|take|pick up|grab/],
    ["cover", /cover|wrap|muffle/],
    ["give", /give|hand .* to/],
    ["ask", /ask .* for|request/],
    ["ring", /\bring\b/],
    ["light", /light|ignite/],
    ["drop", /drop|put down|leave/],
    ["move", /go|move|travel|walk|cross/],
    ["talk", /talk|speak|ask/],
    ["wait", /^wait/],
  ];
  const kind =
    /^use\b/.test(lower) && named.includes("oil")
      ? "refill"
      : /^use\b/.test(lower) && named.includes("cloth")
        ? "cover"
        : kinds.find(([, pattern]) => pattern.test(lower))?.[0];
  const matches = legalActions(s).filter(
    (a) =>
      a.kind === kind &&
      !(kind === "move" && a.item && !named.some((id) => ids.includes(id))) &&
      (named.length
        ? named.every((id) => a.cards.includes(id))
        : ["wait"].includes(kind)),
  );
  if (matches.length === 1) {
    addLog(next, "Vale", "That play is ready below the scene.", {
      kind: "hint",
    });
    return { state: next, action: matches[0] };
  }
  const listener = named.find(
    (id) =>
      ["moth", "keeper"].includes(id) &&
      s.actors[id].place === s.actors.vale.place,
  );
  if (!kind && listener) addLog(next, nameOf(listener), sayWant(s, listener));
  else
    addLog(
      next,
      "Vale",
      "Select cards to choose an act. You can also say “take lamp”, “ring bell”, or “aim: help Pip”. I will show the exact play first.",
      { kind: "hint" },
    );
  return { state: next };
}
export function validateWorld(s) {
  const fail = () => {
    throw new Error(
      "This save needs a fresh start. Your previous save is kept until you choose New game.",
    );
  };
  if (
    !s ||
    s.schema !== 1 ||
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
    if (
      id === "vale"
        ? !Object.hasOwn(aims, a.aim)
        : a.aim !== (id === "moth" ? "moth" : "quiet")
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
  ];
  for (const e of s.log) {
    if (e.seq !== undefined) {
      if (!Number.isSafeInteger(e.seq) || e.seq <= seq || e.seq > s.eventSeq)
        fail();
      seq = e.seq;
    }
    if (
      e.kind !== undefined &&
      !["action", "dialogue", "narration", "input", "hint"].includes(e.kind)
    )
      fail();
    if (e.actorId != null && !actorIds.includes(e.actorId)) fail();
    if (e.locationId != null && !Object.hasOwn(places, e.locationId)) fail();
    if (e.verb != null && !verbs.includes(e.verb)) fail();
    if (e.itemId != null && !ids.includes(e.itemId)) fail();
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
export const decodeSave = (text) => validateWorld(JSON.parse(text));
