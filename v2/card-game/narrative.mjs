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

// Read complete JSON string units while the model is still writing an entry.
export function partialEntries(source) {
  const entries = [];
  const pattern = /\{\s*"id"\s*:\s*("(?:[^"\\]|\\.)*")\s*,\s*"text"\s*:\s*"/gu;
  for (const match of source.matchAll(pattern)) {
    let raw = "";
    for (let i = match.index + match[0].length; i < source.length; i++) {
      const char = source[i];
      if (char === '"') break;
      if (char === "\\") {
        const length = source[i + 1] === "u" ? 6 : 2;
        if (i + length > source.length) break;
        raw += source.slice(i, i + length);
        i += length - 1;
      } else raw += char;
    }
    try {
      const id = JSON.parse(match[1]);
      const text = JSON.parse('"' + raw + '"').replace(/[\uD800-\uDBFF]$/u, "");
      if (
        profiles[id] &&
        text &&
        text.length <= 400 &&
        !/[\u0000-\u001f\u007f]/u.test(text)
      )
        entries.push({ id, text });
    } catch {
      /* A partial escape will be complete in a later chunk. */
    }
  }
  return entries;
}

export async function requestNarrative(context, signal, progress = () => {}) {
  const response = await fetch("/card-game/text", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "text/event-stream",
    },
    body: JSON.stringify(context),
    signal,
  });
  if (!response.ok)
    throw new Error(`Story service returned ${response.status}.`);
  if (!response.headers.get("content-type")?.includes("text/event-stream"))
    return response.json();
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "",
    text = "",
    bytes = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) throw new Error("Story stream ended early.");
      bytes += value.length;
      if (bytes > 256 * 1024)
        throw new Error("Story stream exceeded its limit.");
      buffer = (buffer + decoder.decode(value, { stream: true })).replace(
        /\r\n/g,
        "\n",
      );
      let end;
      while ((end = buffer.indexOf("\n\n")) >= 0) {
        const frame = buffer.slice(0, end);
        buffer = buffer.slice(end + 2);
        const data = frame
          .split("\n")
          .filter((line) => line.startsWith("data:"))
          .map((line) => line.slice(5).trimStart())
          .join("\n");
        if (!data) continue;
        const event = JSON.parse(data);
        if (event.type === "error")
          throw new Error("Story generation was interrupted.");
        if (event.type === "complete") return event;
        if (event.type === "delta" && typeof event.text === "string") {
          text += event.text;
          if (text.length > 16 * 1024)
            throw new Error("Story text exceeded its limit.");
          progress(
            partialEntries(text).filter((entry) =>
              context.speakers.includes(entry.id),
            ),
          );
        }
      }
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
}

// Keep one request in flight and coalesce quick plays to the newest world.
export function createNarrator({
  getWorld,
  apply,
  status,
  request = requestNarrative,
  preview = () => {},
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
          const response = await request(
            context,
            controller.signal,
            (entries) => {
              if (
                version === ticket &&
                getWorld().revision === context.revision
              )
                preview({ context, entries });
            },
          );
          if (version === ticket) {
            preview(null);
            const next = applyGeneratedText(getWorld(), context, response);
            if (next) apply(next);
            status("ready");
          }
        } catch {
          if (version === ticket) {
            preview(null);
            status("retry");
          }
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
      preview(null);
      controller?.abort();
      void drain();
    },
    invalidate() {
      ticket += 1;
      pending = null;
      controller?.abort();
      preview(null);
      status("ready");
    },
  };
}
