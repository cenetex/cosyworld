import { profiles } from "./memory.mjs";
import {
  addLog,
  carried,
  itemPlace,
  rootHolder,
  covered,
  exits,
  nameOf,
  validateWorld,
} from "./world.mjs";
import { desireFor } from "./quests.mjs";

export function narrativeContext(world, action = null) {
  const location = world.actors.vale.place;
  const present = Object.keys(world.actors).filter(
    (id) => world.actors[id].place === location,
  );
  const localItems = Object.keys(world.items).filter(
    (id) => itemPlace(world, id) === location,
  );
  const ids = [location, ...localItems, ...present];
  const focus = localItems.includes(action?.item) ? action.item : null;
  const played = world.log.findLast(
    (entry) =>
      entry.turn === world.turn &&
      entry.kind === "action" &&
      entry.actorId === "vale",
  );
  const target = action?.target || played?.targetId;
  const partner =
    present.includes(target) && target !== "vale"
      ? target
      : present.find((id) => id !== "vale");
  const speakers = partner ? ["vale", partner] : ["vale"];
  return {
    revision: world.revision,
    turn: world.turn,
    location,
    focus,
    speakers,
    action: played?.text || null,
    entities: ids.map((id) => {
      const kind = profiles[id].kind;
      const facts = [];
      let desire = null;
      if (kind === "avatar") {
        facts.push(
          `Holding: ${carried(world, id).map(nameOf).join(", ") || "empty hands"}.`,
        );
        desire = desireFor(world, id);
        for (const item of desire.items)
          facts.push(
            carried(world, id).includes(item)
              ? `Already holds the wanted ${nameOf(item)}.`
              : `Wants ${nameOf(item)}, currently with ${nameOf(rootHolder(world, item))}.`,
          );
        if (desire.location)
          facts.push(
            `Wants to be at ${nameOf(desire.location)}; currently at ${nameOf(location)}.`,
          );
        if (desire.avatars.length)
          facts.push(
            `Wants the company of ${desire.avatars.map(nameOf).join(", ")}.`,
          );
      } else if (kind === "item") {
        const item = world.items[id];
        facts.push(`Held by or resting at: ${nameOf(rootHolder(world, id))}.`);
        if (id === "lamp")
          facts.push(
            `${item.fuel === 0 ? "Empty" : item.fuel <= 3 ? "Running low on oil" : "Has oil"}; ${item.lit ? "lit" : "unlit"}; ${covered(world, id) ? "covered" : "uncovered"}.`,
          );
        if (id === "oil")
          facts.push(
            item.doses === 0
              ? "The flask is empty."
              : item.doses === 1
                ? "A little oil remains."
                : "The flask holds oil.",
          );
        if (id === "bell")
          facts.push(
            `${item.ringing ? "Ringing" : "Silent"}; ${covered(world, id) ? "covered" : "uncovered"}.`,
          );
        if (id === "cloth") facts.push(`Touches: ${nameOf(item.holder)}.`);
      } else {
        facts.push(
          `Paths open to: ${exits(world, id).map(nameOf).join(", ")}.`,
        );
      }
      facts.push(
        `Here: ${present.map(nameOf).join(", ")}.`,
        `Items here: ${localItems.map(nameOf).join(", ") || "none"}.`,
      );
      return {
        id,
        facts,
        desire,
        memories: world.memories[id].events
          .slice(-8)
          .map(({ turn, kind, text }) => ({ turn, kind, text })),
        previous: world.memories[id].text,
      };
    }),
  };
}

export function applyGeneratedText(world, context, response) {
  if (
    world.revision !== context.revision ||
    world.turn !== context.turn ||
    response?.revision !== context.revision
  )
    return null;
  const ids = context.entities.map((entity) => entity.id);
  const entries = response.entries;
  if (
    !Array.isArray(entries) ||
    entries.length !== ids.length ||
    new Set(entries.map((entry) => entry?.id)).size !== ids.length ||
    entries.some(
      (entry) =>
        !ids.includes(entry?.id) ||
        typeof entry.text !== "string" ||
        !entry.text.trim() ||
        entry.text.length > 400 ||
        /[\u0000-\u001f\u007f]/u.test(entry.text),
    ) ||
    typeof response.model !== "string" ||
    response.model.length > 160
  )
    throw new Error("The story response was incomplete.");
  const next = structuredClone(world);
  for (const entry of entries) {
    Object.assign(next.memories[entry.id], {
      text: entry.text.trim(),
      turn: next.turn,
      model: response.model,
    });
  }
  // Descriptions stay on cards; the current place, played item and speakers also
  // become scene beats, with the same cast and item snapshot as other events.
  for (const id of [
    context.location,
    context.focus,
    ...context.speakers,
  ].filter(Boolean)) {
    const text = next.memories[id].text;
    const avatar = profiles[id].kind === "avatar";
    addLog(next, profiles[id].name, text, {
      kind: avatar ? "dialogue" : "narration",
      actorId: avatar ? id : null,
      entityId: id,
      generated: true,
      locationId: context.location,
    });
  }
  return validateWorld(next);
}

export async function requestNarrative(context, signal) {
  const response = await fetch("/card-game/text", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(context),
    signal,
  });
  if (!response.ok)
    throw new Error(`Story service returned ${response.status}.`);
  return response.json();
}

// Keep one request in flight and coalesce quick plays to the newest world.
export function createNarrator({
  getWorld,
  apply,
  status,
  request = requestNarrative,
}) {
  let ticket = 0,
    pending = null,
    running = false,
    controller;
  async function drain() {
    if (running) return;
    running = true;
    try {
      while (pending) {
        const { action, version } = pending;
        pending = null;
        const context = narrativeContext(getWorld(), action);
        controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 30_000);
        status("pending");
        try {
          const response = await request(context, controller.signal);
          if (version === ticket) {
            const next = applyGeneratedText(getWorld(), context, response);
            if (next) apply(next);
            status("ready");
          }
        } catch {
          if (version === ticket) status("retry");
        } finally {
          clearTimeout(timer);
        }
      }
    } finally {
      running = false;
    }
  }
  return {
    changed(action = null) {
      pending = { action, version: ++ticket };
      void drain();
    },
    invalidate() {
      ticket += 1;
      pending = null;
      controller?.abort();
      status("ready");
    },
  };
}
