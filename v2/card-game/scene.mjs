import {
  people,
  places,
  nameOf,
  carried,
  itemPlace,
  shining,
  senses,
} from "./world.mjs";
import { entityActive, crossings } from "./pack-registry.mjs";

import { desireFor, programFor, levelOf, knownActors } from "./quests.mjs";
import { packPlaces, packPeople } from "./pack-registry.mjs";
import { variantOf, crossingOpen } from "./pack-rules.mjs";

// Pack art lives in the pack's own asset folder and is named by its data.
export const backdrop = (id) =>
  packPlaces[id] ? `./${packPlaces[id].backdrop}` : `./assets/${id}.png`;
export function portrait(id, facing = null, world = null) {
  const resident = packPeople[id];
  if (resident)
    return `./${
      resident.portrait ||
      (world ? variantOf(world, id) : resident.variants.awake).portrait
    }`;
  return `./assets/${id === "keeper" && facing === "right" ? "keeper-right" : id}.png`;
}
const visibleCrossing = (world, place) =>
  crossings.find(
    (c) =>
      c.from === place && c.scenery?.overlay && crossingOpen(world, c, senses),
  );
export const locationVariant = (world, id) =>
  visibleCrossing(world, id)?.id || "base";
export const locationOverlay = (world, id) => {
  const f = visibleCrossing(world, id)?.scenery.overlay;
  return f ? `./${f}` : null;
};
export function travelCard(world, id) {
  const c = crossings.find(
    (c) =>
      c.from === world.actors.vale.place &&
      c.to === id &&
      crossingOpen(world, c, senses),
  );
  return c?.scenery
    ? {
        name: c.scenery.cardName || nameOf(id),
        art: c.scenery.cardArt ? `./${c.scenery.cardArt}` : null,
      }
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
export function sceneChanges(world) {
  const here = world.actors.vale.place;
  return world.log
    .filter(
      (entry) =>
        entry.turn === world.turn &&
        !entry.generated &&
        entry.actorId &&
        entry.actorId !== "vale" &&
        entityActive(world, entry.actorId) &&
        entry.fromLocationId &&
        entry.locationId !== entry.fromLocationId &&
        (entry.locationId === here || entry.fromLocationId === here) &&
        world.actors[entry.actorId].place === entry.locationId,
    )
    .map((entry) => ({
      actorId: entry.actorId,
      from: entry.fromLocationId,
      to: entry.locationId,
      leaving: entry.fromLocationId === here,
    }));
}

// Seats follow the cast, so a reply never pushes another character off stage.
export function sceneCast(
  world,
  through = world.log.length - 1,
  recordedCast = null,
) {
  const here = world.actors.vale.place;
  const present =
    recordedCast ||
    personIds.filter(
      (id) =>
        knownActors(world).includes(id) && world.actors[id].place === here,
    );
  const target = world.log
    .slice(0, through + 1)
    .findLast(
      (entry) =>
        entry.turn === world.turn &&
        entry.actorId === "vale" &&
        entry.kind === "action",
    )?.targetId;
  const priority = [...new Set(["vale", target, ...present])]
    .filter((id) => present.includes(id) && people[id])
    .slice(0, 3);
  const slots = personIds.filter((id) => priority.includes(id));
  while (slots.length < 2) slots.push(null);
  return slots;
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
export function sceneStaging(
  world,
  {
    through = world.log.length - 1,
    locationId = world.actors.vale.place,
    cast = sceneCast(world, through),
    line = world.log[through],
    activeSpeaker = line && entryKind(line) === "dialogue"
      ? speakerId(line)
      : null,
    review = false,
  } = {},
) {
  const selected = [...new Set(["vale", activeSpeaker, ...cast])]
    .filter((id) => cast.includes(id) && people[id])
    .slice(0, 3);
  const ids = cast.filter(
    (id, index) => selected.includes(id) && cast.indexOf(id) === index,
  );
  const history = world.log.slice(0, through + 1);
  // The latest arrival is also kept on the world after its log entry is trimmed.
  const kept = world.arrival;
  const entry =
    history.findLast(
      (e) =>
        e.actorId === "vale" &&
        e.fromLocationId &&
        e.fromLocationId !== e.locationId &&
        e.locationId === locationId &&
        (e.verb === "move" || (e.verb === "accompany" && e.accepted)),
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
  const focal = ids.includes("vale") ? "vale" : ids[0];
  const order = [focal, ...ids.filter((id) => id !== focal)].filter(Boolean);
  const positions =
    order.length === 3
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
  const at = new Map(
    order.map((id, i) => [
      id,
      mirror ? 100 - positions[i][0] : positions[i][0],
    ]),
  );
  const events = history.filter(
    (e) => e.turn === (line?.turn ?? world.turn) && !e.generated,
  );
  const played = events.findLast(
    (e) => e.kind === "action" && e.actorId === "vale",
  );
  const speakerAct = events.findLast(
    (e) => e.actorId === activeSpeaker && people[e.targetId],
  );
  const partner =
    activeSpeaker === "vale"
      ? played?.targetId
      : played?.targetId === activeSpeaker
        ? "vale"
        : speakerAct?.targetId;
  const listener =
    ids.includes(partner) && partner !== activeSpeaker
      ? partner
      : activeSpeaker === "vale"
        ? order.find((id) => id !== "vale")
        : ids.includes("vale")
          ? "vale"
          : order.find((id) => id !== activeSpeaker);
  const snapshots = history.flatMap((e) => e.items || []);
  const items = snapshots.length
    ? [...new Map(snapshots.map((item) => [item.id, item])).values()]
    : Object.entries(world.items).map(([id, item]) => ({ id, ...item }));
  return {
    layout: mirror ? "foreground-right" : "foreground-left",
    focalId: focal || null,
    actors: order.map((id, index) => {
      let gazeTargetId =
        activeSpeaker && ids.includes(activeSpeaker)
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
        presence: review
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
        depth: ["foreground", "middle", "back"][index],
        x: at.get(id),
        scale: positions[index][1],
        floor: positions[index][2],
        facing,
        gazeTargetId,
        cutout: portrait(id, facing, world),
        flip: id !== "keeper" && facing !== (id === "vale" ? "right" : "left"),
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
  const here = world.actors.vale.place;
  return world.log
    .map((entry, index) => ({ ...entry, index }))
    .filter(
      (e) => e.generated === true && (!e.locationId || e.locationId === here),
    );
}
function visitStart(world, through = world.log.length - 1) {
  const here = world.actors.vale.place;
  return Math.max(
    0,
    world.log.findLastIndex(
      (entry, index) =>
        index <= through &&
        !entry.generated &&
        entry.actorId === "vale" &&
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
    locationId: world.actors.vale.place,
    background: backdrop(world.actors.vale.place),
    variant: locationVariant(world, world.actors.vale.place),
    overlay: locationOverlay(world, world.actors.vale.place),
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
      background: backdrop(id),
      variant: locationVariant(world, id),
      overlay: locationOverlay(world, id),
    })),
    avatars: Object.entries(people).map(([id, p]) => ({
      id,
      name: p.name,
      cutout: portrait(id, null, world),
      facingCutouts: {
        left: portrait(id, "left"),
        right: portrait(id, "right"),
      },
      nativeFacing: id === "vale" ? "right" : "left",
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
      text: e.text,
      verb: e.verb || null,
      itemId: e.itemId || null,
      targetId: e.targetId || null,
      receiveId: e.receiveId || null,
      destinationId: e.destinationId || null,
      departureTo: e.departureTo || null,
      arrivalFrom: e.arrivalFrom || null,
      accepted: e.accepted ?? null,
      questPlan: e.questPlan ? structuredClone(e.questPlan) : null,
      quest:
        e.kind === "quest"
          ? {
              programId: e.programId,
              program: e.program ? structuredClone(e.program) : null,
              target: e.target ? structuredClone(e.target) : null,
              step: e.step,
              level: e.level,
              hand: e.fulfillment ? structuredClone(e.fulfillment) : null,
            }
          : null,
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
          e.verb === "move" || (e.verb === "accompany" && e.accepted)
            ? "walk"
            : e.verb
              ? "act"
              : "speak",
        suggestedDurationMs: Math.min(7000, Math.max(1600, e.text.length * 45)),
      },
    })),
    current: {
      locationId: world.actors.vale.place,
      staging: sceneStaging(world),
      avatars: personIds.map((id) => ({
        id,
        locationId: world.actors[id].place,
        items: carried(world, id),
        level: levelOf(world, id),
        desire: desireFor(world, id),
        programId: programFor(world, id)?.id || null,
        progress: structuredClone(world.actors[id].progress),
      })),
      items: Object.entries(world.items).map(([id, item]) => ({
        id,
        ...item,
        locationId: itemPlace(world, id),
      })),
      light:
        shining(world) && itemPlace(world, "lamp") === world.actors.vale.place,
    },
  };
}

// Pick the deterministic events Vale witnessed for History.
export function witnessed(entry) {
  if (entry.generated) return false;
  if (!["action", "narration", "quest"].includes(entry.kind)) return false;
  if (entry.actorId === "vale") return true;
  // An action is seen from where it started, so Vale sees a departure.
  if (entry.kind === "action")
    return Boolean(entry.witnesses?.includes("vale"));
  return Boolean(entry.cast?.includes("vale"));
}
