import { privateView } from "./learning.mjs";
import { expressionKind, validExpression } from "./expression.mjs";
// One pure adapter for the browser model and the server's C-backed JS runtime.
// The host supplies authenticated claims and presence on every operation.
import {
  createWorld,
  decodeSave,
  validateWorld,
  legalActions,
  matchingActions,
  play,
  exits,
  addLog,
  nameOf,
  places,
  people,
  carried,
  publishKnowledgeSpeech,
  seedRun,
  fillSeatWants,
} from "./world.mjs";
import {
  humanAvatars,
  humanAvatar,
  humanAvatarIds,
  roomHumanCount,
  seatActors,
  residentAvatar,
} from "./human-cast.mjs";
import { profiles } from "./memory.mjs";
import { enableMotives } from "./motives.mjs";
import { applySharedReflections } from "./reflections.mjs";
import { resetAvatar } from "./avatar-reset.mjs";

function ids(value, fallback = []) {
  const result = value === undefined ? fallback : value;
  if (
    !Array.isArray(result) ||
    result.length > 8 ||
    new Set(result).size !== result.length ||
    result.some((id) => !humanAvatar(id))
  )
    throw new Error("Choose valid human avatars.");
  return [...result];
}
function contextual(world, request) {
  const actor = request.actor || "vale";
  if (!humanAvatar(actor)) throw new Error("Choose a human avatar.");
  const claimed = ids(request.claimed, world.controlledActors || ["vale"]);
  const present = ids(request.present, world.presentActors || claimed);
  if (present.some((id) => !claimed.includes(id)))
    throw new Error("A present avatar needs a claim.");
  world.playerActorId = actor;
  return seatActors(world, claimed, present);
}
function stored(world) {
  const result = structuredClone(world);
  // These fields describe the current request, not the saved simulation.
  delete result.playerActorId;
  delete result.controlledActors;
  delete result.presentActors;
  delete result.heldActors;
  return result;
}
// The saved world with this request's actor, claims and presence.
export function load(request) {
  if (!request.world || typeof request.world !== "object")
    throw new Error("Load a saved world first.");
  const world = contextual(structuredClone(request.world), request);
  const loaded = decodeSave(JSON.stringify(world));
  return loaded;
}
function response(world, extra = {}) {
  return { ok: true, world: stored(world), ...extra };
}
// An avatar's level travels with it between worlds (#1846): the host passes
// the level and experience it had where it was last seated.
function carryProgress(actor, progress) {
  if (progress == null) return;
  const { level, xp } = progress;
  const count = (n) => Number.isInteger(n) && n >= 0 && n <= 1_000_000;
  if (!count(xp) || !(level === undefined || (count(level) && level >= 1)))
    throw new Error("Choose the avatar's level.");
  actor.xp = xp;
  if (level === undefined) delete actor.level;
  else actor.level = level;
  // The least experience that level takes, so the rules' caps still hold.
  actor.carried = Math.max(xp, level ? (level * (level - 1)) / 2 : 0);
}
function enableShared(world) {
  world.sharedVersion = 1;
  return world;
}
function settleHomeItems(world, claimed = []) {
  for (const avatar of humanAvatars.filter((a) => a.id !== "vale")) {
    const item = world.items[avatar.item.id];
    if (
      !claimed.includes(avatar.id) &&
      world.actors[avatar.id].place === avatar.home.id &&
      item.holder === avatar.id &&
      item.history.length === 0
    )
      item.holder = avatar.home.id;
  }
}
function view(world, actor) {
  return {
    actor,
    room: world.actors[actor].place,
    actions: legalActions(world, actor),
    exits: exits(world, world.actors[actor].place, actor),
    profiles,
  };
}
function importClientSave(save) {
  const raw =
    typeof save === "string" ? JSON.parse(save) : structuredClone(save);
  if (!raw || typeof raw !== "object" || Array.isArray(raw))
    throw new Error("Choose a saved world.");
  // Server migration evidence and account presence are supplied by the host.
  for (const key of [
    "sharedMigration",
    "playerActorId",
    "controlledActors",
    "presentActors",
    "heldActors",
    "claimed",
    "present",
  ])
    delete raw[key];
  return decodeSave(JSON.stringify(raw));
}
export function dispatchShared(request) {
  if (!request || typeof request !== "object")
    throw new Error("Choose a world operation.");
  if (request.op === "create") {
    const world =
      request.save == null
        ? enableMotives(createWorld({ opening: true }))
        : importClientSave(request.save);
    // The host derives one seed from the world ID; an imported run keeps its own.
    seedRun(world, request.seed);
    if (!world.sharedVersion) settleHomeItems(world);
    enableShared(world);
    delete world.playerActorId;
    delete world.controlledActors;
    delete world.presentActors;
    delete world.heldActors;
    contextual(world, {
      ...request,
      actor: request.actor || "vale",
      claimed: ["vale"],
      present: ["vale"],
    });
    // A fresh world's resident avatars take a want at once; an imported or
    // upgraded one gives them wants at its next play.
    if (request.save == null) fillSeatWants(world);
    validateWorld(world);
    return response(world, view(world, request.actor || "vale"));
  }
  if (request.op === "migrate") return migrate(request);
  const world = load(request);
  const actor = request.actor || "vale";
  if (request.op === "upgrade") {
    // Loading already moved the save onto the current rules: quest records
    // are dropped and each avatar holds one want.
    if (request.from === "full-card-world/2")
      settleHomeItems(world, world.heldActors);
    seedRun(world, request.seed);
    world.revision += 1;
    validateWorld(world);
    return response(world);
  }
  if (request.op === "validate") return response(world);
  if (request.op === "join") {
    if (!world.controlledActors.includes(actor))
      world.controlledActors.push(actor);
    if (!world.heldActors.includes(actor)) world.heldActors.push(actor);
    carryProgress(world.actors[actor], request.progress);
    enableShared(world);
    validateWorld(world);
    return response(world, view(world, actor));
  }
  // The host checks that the world's owner asked; the avatar starts over.
  if (request.op === "reset") {
    resetAvatar(world, actor);
    validateWorld(world);
    return response(world);
  }
  if (request.op === "view")
    return {
      ...response(world, view(world, actor)),
      world: privateView(world, actor),
    };
  if (request.op === "play") {
    if (
      !world.controlledActors.includes(actor) ||
      !world.presentActors.includes(actor)
    )
      return {
        ok: false,
        world: stored(world),
        error: "Enter this world with your avatar first.",
      };
    const candidates = request.selectedIds
      ? matchingActions(world, request.selectedIds, actor)
      : [];
    const action =
      typeof request.action === "string"
        ? { key: request.action }
        : request.action || (candidates.length === 1 ? candidates[0] : null);
    const before = world.eventSeq;
    const result = play(
      world,
      action,
      request.revision ?? world.revision,
      actor,
    );
    if (!result.ok)
      return { ok: false, world: stored(world), error: result.error };
    return response(result.state, {
      events: result.state.log.filter((entry) => entry.seq > before),
      ...view(result.state, actor),
    });
  }
  if (request.op === "speech") {
    if (!Array.isArray(request.lines) || ![1, 2].includes(request.lines.length))
      throw new Error("An exchange needs one or two lines.");
    const room = request.room || world.actors[actor].place;
    if (!places[room]) throw new Error("Choose a real room.");
    if (
      (request.entries || []).some(
        (e) => !request.lines.some((l) => (l.actorId || l.entityId) === e.id),
      )
    )
      throw new Error("Keep each reflection with its saved speaker.");
    applySharedReflections(world, request.entries || []);
    const lines = [];
    for (const line of request.lines) {
      const scenic = line.actorId == null && line.entityId === room;
      const speaker = scenic
        ? null
        : line.actorId ||
          (people[line.entityId] ? line.entityId : null) ||
          Object.keys(people).find((id) => people[id].name === line.speaker) ||
          (people[line.speaker] ? line.speaker : null);
      if (
        (request.lines.length === 1 && speaker !== actor) ||
        (!scenic &&
          (!speaker ||
            world.actors[speaker].place !== room ||
            // Every avatar in a shared world is present or a resident.
            (humanAvatar(speaker) &&
              !world.presentActors.includes(speaker) &&
              !residentAvatar(world, speaker)))) ||
        typeof line.text !== "string" ||
        !line.text.trim() ||
        line.text.length > 600 ||
        /[\u0000-\u001f\u007f]/u.test(line.text) ||
        !validExpression(profiles[speaker], line.text)
      )
        throw new Error(
          "Each line needs a present speaker or the room, and clear text.",
        );
      addLog(world, scenic ? nameOf(room) : nameOf(speaker), line.text.trim(), {
        generated: true,
        kind: scenic ? "narration" : expressionKind(profiles[speaker]),
        actorId: speaker,
        entityId: scenic ? room : speaker,
        locationId: room,
      });
      lines.push(world.log.at(-1));
      publishKnowledgeSpeech(world, lines.at(-1), request.disclosures || []);
    }
    world.revision += 1;
    validateWorld(world);
    return response(world, { lines });
  }
  throw new Error("Choose a supported world operation.");
}
function migrate(request) {
  const legacy = request.legacy;
  if (
    !legacy ||
    legacy.version !== 1 ||
    !["claimed", "present", "places", "holders", "uses"].every(
      (key) => Array.isArray(legacy[key]) && legacy[key].length === 8,
    )
  )
    throw new Error("This older shared world has an invalid save.");
  const world = enableShared(
    enableMotives(seedRun(createWorld(), request.seed)),
  );
  const rooms = ["pond", ...humanAvatars.map((a) => a.home.id)];
  for (const [index, avatar] of humanAvatars.entries()) {
    const p = legacy.places[index],
      holder = legacy.holders[index];
    if (
      !Number.isInteger(p) ||
      p < 0 ||
      p >= rooms.length ||
      !Number.isInteger(holder) ||
      holder < -1 ||
      holder > 16
    )
      throw new Error("This older shared world has an invalid location.");
    world.actors[avatar.id].place = rooms[p];
    if (holder >= 0)
      world.items[avatar.item.id].holder =
        holder < 8 ? humanAvatars[holder].id : rooms[holder - 8];
  }
  // The old counter measured different rules. Keep it as migration evidence;
  // the full world's clock and quest receipts start on their normal rules.
  world.sharedMigration = {
    version: 1,
    legacyTurn: legacy.turn || 0,
    uses: [...legacy.uses],
  };
  world.sharedMigration.inventoryAllowances = Object.fromEntries(
    humanAvatarIds
      .map((id) => [id, carried(world, id).length])
      .filter(([, count]) => count > 3),
  );
  world.items.lamp.lit = legacy.uses[0] % 2 === 1;
  if (world.items.lamp.lit)
    world.items.lamp.fuel = Math.max(1, world.items.lamp.fuel);
  const claimed = humanAvatarIds.filter((id, i) => legacy.claimed[i]);
  const present = humanAvatarIds.filter(
    (id, i) => legacy.present[i] && legacy.claimed[i],
  );
  contextual(world, { ...request, claimed, present });
  const legacyScenes = migrateScenes(world, request.legacyScenes || [], rooms);
  validateWorld(world);
  return response(world, { legacyScenes });
}

function migrateScenes(world, scenes, rooms) {
  if (!Array.isArray(scenes) || scenes.length > 80)
    throw new Error("Choose up to eighty saved exchanges.");
  return scenes.map((scene) => {
    if (
      !scene ||
      typeof scene.play !== "string" ||
      !scene.play.length ||
      scene.play.length > 80 ||
      !Number.isInteger(scene.room) ||
      !rooms[scene.room] ||
      !Array.isArray(scene.lines) ||
      scene.lines.length > 2 ||
      ![scene.starts_at, scene.until_at].every(
        (n) => Number.isSafeInteger(n) && n >= 0,
      ) ||
      scene.until_at < scene.starts_at
    )
      throw new Error("A saved exchange needs its place, words and time.");
    const room = rooms[scene.room];
    const actor = Number.isInteger(scene.actor)
      ? humanAvatars[scene.actor]?.id
      : humanAvatar(scene.actor)?.id;
    const lines = scene.lines.map((line) => {
      if (
        typeof line.speaker !== "string" ||
        line.speaker.length > 40 ||
        typeof line.text !== "string" ||
        !line.text.length ||
        line.text.length > 600 ||
        /[\u0000-\u001f\u007f]/u.test(line.text)
      )
        throw new Error("A saved line needs a speaker and clear text.");
      const speaker =
        humanAvatars.find((a) => a.name === line.speaker)?.id ||
        (line.speaker === "actor" ? actor : null);
      addLog(world, line.speaker, line.text, {
        generated: true,
        kind: speaker ? "dialogue" : "narration",
        actorId: speaker || null,
        entityId: speaker || room,
        locationId: room,
        migration: {
          play: scene.play,
          turn: scene.turn ?? null,
          starts_at: scene.starts_at,
          until_at: scene.until_at,
        },
      });
      return world.log.at(-1);
    });
    return {
      play: scene.play,
      actor: actor || null,
      room,
      turn: scene.turn ?? null,
      lines,
      starts_at: scene.starts_at,
      until_at: scene.until_at,
      error: typeof scene.error === "string" ? scene.error.slice(0, 240) : null,
      migrated: true,
    };
  });
}
