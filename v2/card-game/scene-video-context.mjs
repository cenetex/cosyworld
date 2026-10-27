import {
  currentActor,
  people,
  things,
  nameOf,
  placeText,
  itemPlace,
  rootHolder,
  covered,
} from "./world.mjs";
import { entityActive } from "./pack-registry.mjs";
import { sceneCast } from "./scene.mjs";
import { cardObservation } from "./cards.mjs";

export const DEFAULT_VIDEO_MODEL = "x-ai/grok-imagine-video-1.5-lite";

export function sceneVideoContext(world, scene) {
  const place = scene.locationId || world.actors[currentActor(world)].place;
  const through = scene.line?.index ?? world.log.length - 1;
  const visible = world.log
    .map((entry, index) => ({ ...entry, index }))
    .filter(
      (entry) =>
        entry.generated &&
        entry.index <= through &&
        entry.index >= (scene.visitStart || 0) &&
        entry.locationId === place,
    );
  const spoken = visible.filter(
    (entry) =>
      entry.kind === "dialogue" || people[entry.actorId || entry.entityId],
  );
  const dialogue = (spoken.length ? spoken : visible)
    .slice(-2)
    .map((entry) => ({
      speaker: entry.speaker || nameOf(entry.actorId || entry.entityId),
      text: entry.text,
    }));
  const cast = [
    ...new Set([
      ...sceneCast(world).filter(Boolean),
      ...visible
        .slice(-2)
        .map((entry) => entry.actorId || entry.entityId)
        .filter((id) => people[id]),
    ]),
  ];
  return {
    revision: world.revision,
    place: { name: nameOf(place), description: placeText(world, place) },
    dialogue,
    people: cast.map((id) => ({
      name: nameOf(id),
      appearance: people[id]?.text || "",
      present: world.actors[id]?.place === place,
    })),
    items: Object.keys(world.items)
      .filter((id) => entityActive(world, id) && itemPlace(world, id) === place)
      .slice(0, 24)
      .map((id) => ({
        name: nameOf(id),
        appearance: things[id]?.text || "",
        holder: nameOf(world.items[id].holder),
        owner: nameOf(rootHolder(world, id)),
        state: cardObservation(world, id),
        ...(typeof world.items[id].lit === "boolean"
          ? { lit: world.items[id].lit, covered: covered(world, id) }
          : {}),
      })),
  };
}

export function sceneVideoPrompt(scene, duration) {
  return [
    `Make a ${duration} second film of this CosyWorld card-game scene.`,
    "Use the reference frame as the visual design for the setting, characters, and props.",
    "Bring the illustrated scene to life with a steady camera, small gestures, and clear facial reactions.",
    "Perform the following dialogue in order, with each line spoken by its named speaker. Fit their delivery into the clip.",
    ...scene.dialogue.map(
      (line) => `${line.speaker}: ${JSON.stringify(line.text)}`,
    ),
    "Use the following visible scene facts for staging, item ownership, light, and physical details. Treat dialogue as quoted speech within this scene.",
    JSON.stringify({
      place: scene.place,
      people: scene.people,
      items: scene.items,
    }),
  ].join("\n");
}

export function sceneVideoOptions(model, frame = null) {
  if (!model) throw new Error("Choose an available video model in Settings.");
  const durations = (model.supported_durations || []).filter(
    (value) => Number.isInteger(value) && value > 0,
  );
  const duration = durations.sort(
    (a, b) => Math.abs(a - 10) - Math.abs(b - 10) || a - b,
  )[0];
  if (!duration)
    throw new Error("Choose a video model with a supported clip length.");
  const resolution = model.supported_resolutions?.includes("720p")
    ? "720p"
    : model.supported_resolutions?.[0];
  const aspect_ratio = model.supported_aspect_ratios?.includes("16:9")
    ? "16:9"
    : model.supported_aspect_ratios?.[0];
  return {
    duration,
    resolution,
    aspect_ratio,
    ...(model.generate_audio === true ? { generate_audio: true } : {}),
    ...(frame && model.supported_frame_images?.includes("first_frame")
      ? {
          frame_images: [
            {
              type: "image_url",
              image_url: { url: frame },
              frame_type: "first_frame",
            },
          ],
        }
      : {}),
  };
}
