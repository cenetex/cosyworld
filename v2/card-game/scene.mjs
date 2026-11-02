import {
  currentActor,
  people,
  places,
  nameOf,
  carried,
  rootHolder,
  itemPlace,
  shining,
  senses,
} from "./world.mjs";
import {
  entityActive,
  crossings,
  transports,
  conditionsMet,
} from "./pack-registry.mjs";

import { levelOf, knownActors } from "./want.mjs";
import { packPlaces, packPeople } from "./pack-registry.mjs";
import { variantOf, crossingOpen, conditionMet } from "./pack-rules.mjs";
import { locationWeather } from "./weather.mjs";
import { expressionOf } from "./expression.mjs";
import { daylightBackdrop, locationDaylight } from "./daylight.mjs";
import { avatarImage } from "./scarves.mjs";
import { rarityForm } from "./rarity-portraits.mjs";
import { flipStagePortrait, nativePortraitFacing } from "./portrait-facing.mjs";
import { sceneChanges } from "./scene-cast.mjs";
export { sceneChanges };

// The lamp lights a place only while it shines there: held by someone in that
// place or put down in it (#1422). This is display only; the mirror's path
// rule stays in reflectionOpen.
export const lampLitHere = (world, place) =>
  shining(world) && itemPlace(world, "lamp") === place;
// Pack art lives in the pack's own asset folder and is named by its data.
// A place's state backdrops name saved conditions; the first that holds wins
// (#1600, #1620). Pack places test them in their own pack, hub places such as
// the lit or doused attic in the forest rules.
function stateBackdrop(world, id) {
  const pack = packPlaces[id];
  const place = pack || places[id];
  if (!place?.backdrops || !(pack ? world?.packs : world?.actors)) return null;
  const match = place.backdrops.find((b) =>
    pack
      ? conditionsMet(world, pack.packId, b.requires)
      : b.requires.every((c) => conditionMet(world, c, null)),
  );
  return match?.backdrop || null;
}
// A hub place's own backdrop applies only to a live world.
const baseBackdrop = (world, id) =>
  packPlaces[id]?.backdrop || (world?.actors && places[id]?.backdrop) || null;
export function backdrop(id, world = null) {
  const variant = world?.actors && visibleCrossing(world, id)?.scenery.backdrop;
  const file = variant
    ? daylightBackdrop(world, id, variant)
    : placeBackdrop(world, id);
  return file ? `./${file}` : `./assets/${id}.png`;
}
// A matching state painting is final, including its authored lighting.
// Only the ordinary base painting falls through to the legacy night table.
export function placeBackdrop(world, id) {
  return (
    stateBackdrop(world, id) ||
    daylightBackdrop(world, id, baseBackdrop(world, id))
  );
}
export function portrait(id, facing = null, world = null) {
  const human = avatarImage(world, id);
  if (human) return `./${human}`;
  const resident = packPeople[id];
  if (resident)
    return `./${
      (world && rarityForm(id, levelOf(world, id))?.portrait) ||
      residentPose(world, id)?.portrait ||
      resident.portrait ||
      (world ? variantOf(world, id) : resident.variants.awake).portrait
    }`;
  return `./assets/${id === "keeper" && facing === "right" ? "keeper-right" : id}.png`;
}

// A resident's pose is the first authored pose whose place and saved
// conditions hold. It reads committed state only, so local and shared tables
// show the same sprite; portrait() returns that sprite's path.
export function residentPose(world, id) {
  const resident = packPeople[id];
  const place = world?.actors?.[id]?.place;
  if (!resident?.poses || !place) return null;
  return (
    resident.poses.find(
      (pose) =>
        (!pose.at || pose.at === place) &&
        conditionsMet(world, resident.packId, pose.requires),
    ) || null
  );
}

// Resolve selection against current custody, including items on a carried
// object, so a shared transfer clears the prop as soon as the world updates.
export function selectedHandItem(world, selection = []) {
  return (
    selection.findLast(
      (id) =>
        world.items[id] &&
        entityActive(world, id) &&
        rootHolder(world, id) === currentActor(world),
    ) || null
  );
}
const visibleCrossing = (world, place) =>
  crossings.find(
    (c) =>
      c.from === place &&
      (c.scenery?.overlay || c.scenery?.backdrop) &&
      crossingOpen(world, c, senses),
  );
export function locationVariant(world, id) {
  // A hub place with state backdrops names its variant after the painting.
  const hub =
    !packPlaces[id] && places[id]?.backdrops
      ? stateBackdrop(world, id) || baseBackdrop(world, id)
      : null;
  const crossing =
    visibleCrossing(world, id)?.id ||
    hub?.replace(/^.*\/|\.\w+$/g, "") ||
    "base";
  const weather = locationWeather(world, id);
  const variant = weather ? `${crossing}:${weather.variant}` : crossing;
  return locationDaylight(world, id)?.phase === "night"
    ? `${variant}:night`
    : variant;
}
// Every place uses the same stage. Its optional data (focus, mark, lamp,
// player, and a resident painted into the backdrop) is all that differs; an
// open crossing's backdrop brings its own focus.
export function stageOf(world, id) {
  const stage = places[id]?.stage || {};
  const scenery = world?.actors ? visibleCrossing(world, id)?.scenery : null;
  return {
    ...stage,
    focus: (scenery?.backdrop && scenery.focus) || stage.focus || null,
  };
}
export const locationOverlay = (world, id) => {
  const f = visibleCrossing(world, id)?.scenery.overlay;
  return f ? `./${f}` : null;
};
export function travelCard(world, id) {
  const from = world.actors[currentActor(world)].place;
  const road = packPlaces[id];
  if (road?.road?.includes(from)) {
    const other = road.road.find((end) => end !== from);
    return { name: `Road to ${nameOf(other)}`, art: backdrop(id, world) };
  }
  const c = crossings.find(
    (c) =>
      c.from === world.actors[currentActor(world)].place &&
      (c.transport ? transports[c.transport].place : c.to) === id &&
      crossingOpen(world, c, senses),
  );
  // A destination card shows where you are going, never where you stand:
  // the place's own current painting (the ship's deck, lit for the hour and
  // weather), the same art the action beat shows for that place.
  return c?.scenery
    ? { name: c.scenery.cardName || nameOf(id), art: backdrop(id, world) }
    : null;
}
const personIds = Object.keys(people);
const speakerId = (entry) =>
  entry.actorId || personIds.find((id) => nameOf(id) === entry.speaker) || null;
const entryKind = (entry) =>
  entry.kind ||
  (speakerId(entry)
    ? "dialogue"
    : entry.speaker === "You"
      ? "input"
      : "narration");

// Movement witnessed from Vale's current scene, including a forced retreat.

// Show physical movement as soon as the scene appears, while words are prepared.
export function movementCaption(world) {
  const here = world.actors[currentActor(world)].place;
  const arrival = world.log.findLast(
    (e) =>
      e.turn === world.turn &&
      !e.generated &&
      e.actorId === currentActor(world) &&
      e.fromLocationId &&
      e.fromLocationId !== e.locationId &&
      e.locationId === here,
  );
  const changes = sceneChanges(world);
  const ids = [
    ...new Set([
      ...changes.map((change) => change.actorId),
      ...(arrival
        ? knownActors(world).filter(
            (id) =>
              id !== currentActor(world) && world.actors[id].place === here,
          )
        : []),
    ]),
  ].filter((id) => entityActive(world, id));
  // Coming to after a lost standoff is named, never a silent cut.
  const cameTo =
    arrival &&
    (["retreat", "sent-home"].includes(arrival.verb) ||
      (!arrival.verb && /after yielding to/u.test(arrival.text || "")))
      ? [`You come to at ${nameOf(here)}.`]
      : [];
  return [
    ...cameTo,
    ...ids.map((id) => {
      const who = nameOf(id);
      const change = changes.find((change) => change.actorId === id);
      if (
        arrival?.verb === "accompany" &&
        arrival.accepted &&
        arrival.targetId === id
      )
        return `${who} travels with ${nameOf(currentActor(world))}.`;
      if (change?.leaving) return `${who} leaves for ${nameOf(change.to)}.`;
      if (change)
        return change.from === arrival?.fromLocationId
          ? `${who} follows from ${nameOf(change.from)}.`
          : `${who} arrives from ${nameOf(change.from)}.`;
      return `${who} is waiting here.`;
    }),
  ].join(" ");
}

// Seats follow the cast, so a reply never pushes another character off stage.
export function sceneCast(
  world,
  through = world.log.length - 1,
  recordedCast = null,
) {
  const here = world.actors[currentActor(world)].place;
  const known = recordedCast ? null : new Set(knownActors(world));
  const present =
    recordedCast ||
    personIds.filter(
      (id) =>
        known.has(id) &&
        world.actors[id].place === here &&
        (!world.controlledActors?.includes(id) ||
          world.presentActors?.includes(id)),
    );
  const target = world.log
    .slice(0, through + 1)
    .findLast(
      (entry) =>
        entry.turn === world.turn &&
        entry.actorId === currentActor(world) &&
        entry.kind === "action",
    )?.targetId;
  const priority = [...new Set([currentActor(world), target, ...present])]
    .filter((id) => present.includes(id) && people[id])
    .slice(0, world.controlledActors ? 6 : 3);
  const slots = personIds.filter((id) => priority.includes(id));
  while (slots.length < 2) slots.push(null);
  return slots;
}

// The waiting portrait names whoever speaks next, in display order: the first
// scene speaker without a shown line yet. Shared tables receive a whole
// exchange at once, so they wait on the acting avatar when it is on stage.
export function nextSpeaker(
  world,
  { speakers = null, shown = [], actor } = {},
) {
  if (speakers) return speakers.find((id) => !shown.includes(id)) || null;
  return actor && sceneCast(world).includes(actor) ? actor : null;
}

function exchangeCast(world, line) {
  return [
    ...new Set(
      world.log
        .filter(
          (e) =>
            e.generated &&
            e.turn === line.turn &&
            e.locationId === line.locationId,
        )
        .flatMap((e) => e.cast || []),
    ),
  ];
}

// Blocking comes from the completed play and its witnesses. The model writes
// dialogue; the same event record places the actors and their carried props.
// Floor spots as [x %, lift] on the stage. Wide stages keep things beside the
// dialogue; narrow stages stand fewer of them on the floor above it, and short
// ones set them beside the hand at the front of the floor.
const FLOOR_SPOTS = {
  wide: [
    [6, 2],
    [15, 0],
    [22, 4],
    [78, 3],
    [86, 0],
    [94, 2],
  ],
  narrow: [
    [8, 1],
    [93, 0],
    [24, 3],
  ],
  short: [
    [6, 0],
    [15, 2],
    [93, 1],
  ],
};

function floorHash(text) {
  let hash = 2166136261;
  for (const char of text)
    hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
  return hash >>> 0;
}

// Each thing keeps the same free spot in a place, with a small offset of its
// own, so props do not jump or stack when the scene renders again.
function floorSpots(ids, locationId, table) {
  const taken = new Set();
  const placed = {};
  for (const id of [...ids].sort()) {
    const hash = floorHash(`${locationId}:${id}`);
    let spot = hash % table.length;
    while (taken.has(spot)) spot = (spot + 1) % table.length;
    taken.add(spot);
    const [x, lift] = table[spot];
    placed[id] = {
      x: x + (((hash >>> 8) % 21) - 10) / 5,
      lift: lift + ((hash >>> 16) % 11) / 10,
    };
  }
  return placed;
}

export function sceneStaging(
  world,
  {
    through = world.log.length - 1,
    locationId = world.actors[currentActor(world)].place,
    cast = sceneCast(world, through),
    line = world.log[through],
    activeSpeaker = line && entryKind(line) === "dialogue"
      ? speakerId(line)
      : null,
    review = false,
    sharedPlays = [],
    currentState = false,
  } = {},
) {
  // Residents painted into the backdrop, and a player the place leaves off
  // stage, are not floor figures.
  const stage = stageOf(world, locationId);
  const selected = [...new Set([currentActor(world), activeSpeaker, ...cast])]
    .filter(
      (id) =>
        cast.includes(id) &&
        people[id] &&
        packPeople[id]?.presentation !== "backdrop" &&
        id !== stage.resident &&
        !(stage.player === false && id === currentActor(world)),
    )
    .slice(0, world.controlledActors ? 6 : 3);
  const ids = cast.filter(
    (id, index) => selected.includes(id) && cast.indexOf(id) === index,
  );
  const history = world.log.slice(0, through + 1);
  // The latest arrival is also kept on the world after its log entry is trimmed.
  const kept = world.arrival;
  const entry =
    history.findLast(
      (e) =>
        e.actorId === currentActor(world) &&
        e.fromLocationId &&
        e.fromLocationId !== e.locationId &&
        e.locationId === locationId &&
        (["move", "retreat", "sent-home"].includes(e.verb) ||
          (e.verb === "accompany" && e.accepted)),
    ) ||
    (kept?.locationId === locationId &&
    kept.seq < (world.log[0]?.seq ?? 1) &&
    kept.seq <= (history.at(-1)?.seq ?? world.eventSeq)
      ? kept
      : null);
  const locations = Object.keys(places);
  const mirror = Boolean(
    entry &&
      locations.indexOf(entry.fromLocationId) > locations.indexOf(locationId),
  );
  const focal = ids.includes(currentActor(world))
    ? currentActor(world)
    : ids[0];
  // In a battle the latest exchange (striker, any guard, the one aimed at)
  // keeps the front between plays; the other combatants stand behind.
  const fight = world.standoffs?.find((c) => c.location === locationId);
  const last = fight
    ? world.log.findLast(
        (e) =>
          ["threaten", "intercept", "attack"].includes(e.verb) &&
          (e.locationId ?? e.fromLocationId) === locationId,
      )
    : null;
  const exchange = [last?.actorId, last?.targetId, last?.coveredId].filter(
    (id) => ids.includes(id) && Object.hasOwn(fight.resolve, id),
  );
  if (exchange.length < 2) exchange.length = 0;
  const order = [
    ...exchange,
    ...[focal, ...ids.filter((id) => id !== focal)].filter(
      (id) => !exchange.includes(id),
    ),
  ].filter(Boolean);
  // Recent players take more space. Fibonacci areas make the change in height
  // gentle, and repeated plays by one person keep the others in order.
  const recent = world.controlledActors
    ? [
        ...new Set([
          ...[
            ...(review ? history : world.log)
              .toReversed()
              .filter((e) => e.kind === "action" && !e.generated),
            // The shared record also identifies quiet plays such as Wait.
            ...sharedPlays.map((play) => ({
              actorId: play.actor,
              locationId: play.room,
              turn: play.turn,
            })),
          ]
            .filter(
              (e) =>
                e.locationId === locationId &&
                ids.includes(e.actorId) &&
                world.controlledActors.includes(e.actorId) &&
                (!review || e.turn <= (history.at(-1)?.turn ?? world.turn)),
            )
            .toSorted((a, b) => b.turn - a.turn)
            .map((e) => e.actorId),
          ...ids.filter((id) => world.controlledActors.includes(id)),
          ...ids,
        ]),
      ]
    : [];
  const front = exchange.length
    ? exchange
    : ids.filter((id) => recent.slice(0, 2).includes(id));
  const back = ids.filter((id) => !front.includes(id));
  const size = (id) => Math.sqrt([13, 8, 5, 3, 2, 1][recent.indexOf(id)] / 13);
  const positions = world.controlledActors
    ? order.map((id) =>
        front.includes(id)
          ? [
              front.length === 1
                ? 50
                : 30 + (front.indexOf(id) * 40) / (front.length - 1),
              size(id),
              0,
            ]
          : [
              back.length === 1
                ? 15
                : 10 + (back.indexOf(id) * 80) / (back.length - 1),
              size(id),
              10,
            ],
      )
    : order.length > 3
      ? order.map((_, i) => [
          14 + (i * 72) / (order.length - 1),
          i === 0 ? 0.85 : 0.7,
          i === 0 ? 0 : 5,
        ])
      : order.length === 3
        ? [
            [22, 1, 0],
            [59, 0.84, 4],
            [81, 0.76, 8],
          ]
        : order.length === 2
          ? [
              [24, 1, 0],
              [76, 0.9, 0],
            ]
          : [[50, 1, 0]];
  // A lone figure stands on the place's mark, which belongs to the painting
  // and so is not mirrored by the direction of arrival.
  const at = new Map(
    order.map((id, i) => [
      id,
      order.length === 1 && stage.mark !== undefined
        ? stage.mark
        : mirror
          ? 100 - positions[i][0]
          : positions[i][0],
    ]),
  );
  const events = history.filter(
    (e) => e.turn === (line?.turn ?? world.turn) && !e.generated,
  );
  const played = events.findLast(
    (e) => e.kind === "action" && e.actorId === currentActor(world),
  );
  const speakerAct = events.findLast(
    (e) => e.actorId === activeSpeaker && people[e.targetId],
  );
  const partner =
    activeSpeaker === currentActor(world)
      ? played?.targetId
      : played?.targetId === activeSpeaker
        ? currentActor(world)
        : speakerAct?.targetId;
  const listener =
    ids.includes(partner) && partner !== activeSpeaker
      ? partner
      : activeSpeaker === currentActor(world)
        ? order.find((id) => id !== currentActor(world))
        : ids.includes(currentActor(world))
          ? currentActor(world)
          : order.find((id) => id !== activeSpeaker);
  const snapshots = currentState ? [] : history.flatMap((e) => e.items || []);
  const items = snapshots.length
    ? [...new Map(snapshots.map((item) => [item.id, item])).values()]
    : Object.entries(world.items).map(([id, item]) => ({ id, ...item }));
  // Things lying in this place rest on the floor behind the cast. The hand
  // keeps every one of them; the stage shows only the first few.
  const lying = items
    .filter(
      (item) => item.holder === locationId && entityActive(world, item.id),
    )
    .slice(0, FLOOR_SPOTS.wide.length);
  const spots = Object.fromEntries(
    Object.entries(FLOOR_SPOTS).map(([layout, table]) => [
      layout,
      floorSpots(
        lying.slice(0, table.length).map(({ id }) => id),
        locationId,
        table,
      ),
    ]),
  );
  const floorItems = lying.map(({ id, lit, ringing }) => {
    const cover = items.find((other) => other.holder === id)?.id || null;
    return {
      id,
      cover,
      spots: Object.fromEntries(
        Object.keys(FLOOR_SPOTS).map((layout) => [
          layout,
          spots[layout][id] || null,
        ]),
      ),
      ...(typeof lit === "boolean" ? { lit } : {}),
      ...(typeof ringing === "number"
        ? { ringing: ringing > 0 && !cover }
        : {}),
    };
  });
  return {
    layout: mirror ? "foreground-right" : "foreground-left",
    focalId: focal || null,
    floorItems,
    actors: order.map((id, index) => {
      // Combatants watch the latest exchange, whoever speaks.
      const foe = !Object.hasOwn(fight?.resolve || {}, id)
        ? null
        : id === exchange[0]
          ? exchange.at(-1)
          : exchange[0] ||
            (id === fight.challenger ? fight.defender : fight.challenger);
      let gazeTargetId = ids.includes(foe)
        ? foe
        : activeSpeaker && ids.includes(activeSpeaker)
          ? id === activeSpeaker
            ? listener
            : activeSpeaker
          : order.length === 3
            ? order[index === 1 ? 2 : 1]
            : order.find((other) => other !== id);
      gazeTargetId ||= null;
      const facing = gazeTargetId
        ? at.get(gazeTargetId) > at.get(id)
          ? "right"
          : "left"
        : mirror
          ? "left"
          : "right";
      const movement = events.findLast(
        (e) =>
          e.fromLocationId &&
          e.fromLocationId !== e.locationId &&
          (e.actorId === id ||
            (e.verb === "accompany" && e.accepted && e.targetId === id)),
      );
      const act = events.findLast((e) => e.actorId === id && e.verb);
      const props = items.filter((item) => {
        let holder = item.holder;
        const seen = new Set([item.id]);
        while (
          items.some((other) => other.id === holder) &&
          !seen.has(holder)
        ) {
          seen.add(holder);
          holder = items.find((other) => other.id === holder).holder;
        }
        return holder === id;
      });
      return {
        id,
        // A replayed line stages the current cast, so nobody there has left.
        presence:
          review || currentState
            ? "present"
            : history.some(
                  (e) =>
                    e.turn === line?.turn &&
                    e.locationId === locationId &&
                    e.generated &&
                    e.departureTo &&
                    e.actorId === id &&
                    e.seq !== line?.seq,
                )
              ? "departed"
              : line?.actorId === id && line.departureTo
                ? "departing"
                : "present",
        depth: world.controlledActors
          ? front.includes(id)
            ? "foreground"
            : "back"
          : ["foreground", "middle", "back"][Math.min(index, 2)],
        x: at.get(id),
        scale: positions[index][1] * (residentPose(world, id)?.scale ?? 1),
        floor: positions[index][2],
        facing,
        gazeTargetId,
        cutout: portrait(id, facing, world),
        flip: flipStagePortrait(portrait(id, facing, world), facing),
        pose: movement
          ? "walk"
          : ["threaten", "guard", "attack"].includes(act?.verb)
            ? act.verb
            : id === activeSpeaker
              ? "speak"
              : "listen",
        movement: movement
          ? {
              kind: movement.locationId === locationId ? "arrive" : "leave",
              from: movement.fromLocationId,
              to: movement.locationId,
              companions:
                movement.verb === "accompany" && movement.accepted
                  ? [movement.actorId, movement.targetId].filter(
                      (other) => other !== id,
                    )
                  : [],
            }
          : null,
        items: props.map(({ id, lit, fuel, ringing, holder }) => ({
          id,
          holder,
          covered: items.some((item) => item.holder === id),
          ...(lit !== undefined ? { lit, fuel } : {}),
          ...(ringing !== undefined ? { ringing } : {}),
        })),
      };
    }),
  };
}
export function sceneLines(world) {
  const here = world.actors[currentActor(world)].place;
  return world.log
    .map((entry, index) => ({ ...entry, index }))
    .filter(
      (e) => e.generated === true && (!e.locationId || e.locationId === here),
    );
}
function visitStart(world, through = world.log.length - 1) {
  const here = world.actors[currentActor(world)].place;
  return Math.max(
    0,
    world.log.findLastIndex(
      (entry, index) =>
        index <= through &&
        !entry.generated &&
        entry.actorId === currentActor(world) &&
        entry.fromLocationId &&
        entry.fromLocationId !== here &&
        entry.locationId === here,
    ),
  );
}

// A review replays an earlier line with the avatars present now. Departed
// speakers keep their words without returning to the stage.
export function currentScene(
  world,
  lineIndex = null,
  { hold = false, seq = null, review = false } = {},
) {
  const lines = sceneLines(world);
  const chosen = lines.find((e) =>
    seq === null ? e.index === lineIndex : e.seq === seq,
  );
  const start = visitStart(world, chosen?.index);
  const line =
    chosen || (!hold && lines.findLast((e) => e.index >= start)) || null;
  const previous = line
    ? lines.findLast((e) => e.index < line.index && e.index >= start) || null
    : null;
  return {
    locationId: world.actors[currentActor(world)].place,
    background: backdrop(world.actors[currentActor(world)].place, world),
    variant: locationVariant(world, world.actors[currentActor(world)].place),
    overlay: locationOverlay(world, world.actors[currentActor(world)].place),
    weather: locationWeather(world, world.actors[currentActor(world)].place),
    daylight: locationDaylight(world, world.actors[currentActor(world)].place),
    visitStart: start,
    slots: sceneCast(
      world,
      line?.index,
      review || (lineIndex === null && seq === null) || !line
        ? null
        : exchangeCast(world, line),
    ),
    activeSpeaker:
      line && entryKind(line) === "dialogue" ? speakerId(line) : null,
    line,
    previous,
    lines,
  };
}
export function sceneScript(world) {
  const firstSeq = world.log[0]?.seq || 1;
  return {
    schema: "cosyworld.scene-script.v1",
    title: "The reflected shore",
    source: {
      worldSchema: world.schema,
      turn: world.turn,
      revision: world.revision,
      firstEvent: firstSeq,
      lastEvent: world.eventSeq || world.log.length,
      truncated:
        firstSeq > 1 ||
        (world.eventSeq || world.log.length) - firstSeq + 1 > world.log.length,
    },
    locations: Object.entries(places).map(([id, p]) => ({
      id,
      name: p.name,
      background: backdrop(id, world),
      variant: locationVariant(world, id),
      overlay: locationOverlay(world, id),
      weather: locationWeather(world, id),
      daylight: locationDaylight(world, id),
    })),
    avatars: Object.entries(people).map(([id, p]) => ({
      id,
      name: p.name,
      cutout: portrait(id, null, world),
      facingCutouts: {
        left: portrait(id, "left", world),
        right: portrait(id, "right", world),
      },
      nativeFacing: nativePortraitFacing(portrait(id, null, world)),
      anchors: { feet: [0.5, 0.99], eyes: [0.5, 0.13] },
    })),
    memories: structuredClone(world.memories),
    beats: world.log.map((e, index) => ({
      id: e.seq || index + 1,
      turn: e.turn,
      kind: entryKind(e),
      actorId: speakerId(e),
      locationId: e.locationId || null,
      fromLocationId: e.fromLocationId || null,
      weather: locationWeather({ turn: e.turn }, e.locationId),
      daylight: locationDaylight({ turn: e.turn }, e.locationId),
      text: e.text,
      verb: e.verb || null,
      itemId: e.itemId || null,
      targetId: e.targetId || null,
      receiveId: e.receiveId || null,
      destinationId: e.destinationId || null,
      departureTo: e.departureTo || null,
      arrivalFrom: e.arrivalFrom || null,
      accepted: e.accepted ?? null,
      wantMet: e.wantMet ? structuredClone(e.wantMet) : null,
      cast: e.cast || [],
      items: e.items || [],
      light: e.light ?? null,
      performance: {
        staging: sceneStaging(world, {
          through: index,
          locationId: e.locationId,
          cast: e.generated ? exchangeCast(world, e) : e.cast || [],
          line: e,
        }),
        pose:
          ["move", "retreat", "sent-home"].includes(e.verb) ||
          (e.verb === "accompany" && e.accepted)
            ? "walk"
            : e.verb
              ? "act"
              : "speak",
        suggestedDurationMs: Math.min(7000, Math.max(1600, e.text.length * 45)),
      },
    })),
    current: {
      locationId: world.actors[currentActor(world)].place,
      weather: locationWeather(world, world.actors[currentActor(world)].place),
      daylight: locationDaylight(
        world,
        world.actors[currentActor(world)].place,
      ),
      staging: sceneStaging(world),
      avatars: personIds.map((id) => ({
        id,
        locationId: world.actors[id].place,
        items: carried(world, id),
        level: levelOf(world, id),
        xp: world.actors[id].xp,
      })),
      items: Object.entries(world.items).map(([id, item]) => ({
        id,
        ...item,
        locationId: itemPlace(world, id),
      })),
      light: lampLitHere(world, world.actors[currentActor(world)].place),
    },
  };
}

// Pick the deterministic events Vale witnessed for History.
export function witnessed(entry, actor = "vale") {
  if (entry.generated) return false;
  if (!["action", "narration"].includes(entry.kind)) return false;
  if (entry.actorId === actor) return true;
  // An action is seen from where it started, so Vale sees a departure.
  if (entry.kind === "action") return Boolean(entry.witnesses?.includes(actor));
  return Boolean(entry.cast?.includes(actor));
}

export function isSceneText(entry, shared = false) {
  return Boolean(
    entry &&
      (entry.kind === "dialogue" ||
        (entry.generated === true &&
          entry.kind === "narration" &&
          (shared || expressionOf(people[entry.actorId]) === "movement"))),
  );
}
