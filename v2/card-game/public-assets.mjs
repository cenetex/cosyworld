import musicStreams from "./music-streams.json" with { type: "json" };
import { roomTracks } from "./music.mjs";
import { packMediaFiles } from "./pack-registry.mjs";
import imageVariants from "./image-variants.json" with { type: "json" };
import voiceCast from "./voices.json" with { type: "json" };
import { daylightAssets } from "./daylight.mjs";

// The local server, release smoke, and Rust asset generator use this list.
const files = [
  "media.mjs",
  "images.mjs",
  "image-variants.json",
  "media-manifest.json",
  "music-streams.json",
  "shared.mjs",
  "shared-auth.mjs",
  "shared-sync.mjs",
  "shared-rules.mjs",
  "shared.css",
  "toolbar.mjs",
  "inner-life.mjs",
  "toolbar.css",
  "shared-cast.json",
  "human-cast.mjs",
  "boardyai.mjs",
  "introductions.mjs",
  "boardyai.json",
  "assets/greek-drama/harbor-day.webp",
  "assets/shared/places/pond.png",
  "assets/shared/characters/vale.png",
  "assets/shared/places/station.png",
  "assets/shared/items/lamp.png",
  "assets/shared/characters/mara.png",
  "assets/shared/places/theatre.png",
  "assets/shared/items/mask.png",
  "assets/shared/characters/ash.png",
  "assets/shared/places/belfry.png",
  "assets/shared/items/float.png",
  "assets/shared/characters/nell.png",
  "assets/shared/places/glasshouse.png",
  "assets/shared/items/can.png",
  "assets/shared/characters/tavi.png",
  "assets/shared/places/hill.png",
  "assets/shared/items/kite.png",
  "assets/shared/characters/rue.png",
  "assets/shared/places/train.png",
  "assets/shared/items/routes.png",
  "assets/shared/characters/orin.png",
  "assets/shared/places/pavilion.png",
  "assets/shared/items/board.png",
  "assets/shared/characters/ada.png",
  "assets/shared/places/loft.png",
  "assets/shared/items/shears.png",
  "index.html",
  "style.css",
  "entry.mjs",
  "openrouter.mjs",
  "openrouter-settings.mjs",
  "openrouter.css",
  "openrouter-connect.mjs",
  "openrouter-callback.html",
  "openrouter-callback.mjs",
  "openrouter-callback.css",
  "scene-video.mjs",
  "scene-video-context.mjs",
  "scene-video.css",
  "awakening.css",
  "app.mjs",
  "world.mjs",
  "scene.mjs",
  "weather.mjs",
  "daylight.mjs",
  ...daylightAssets,
  "weather-view.mjs",
  "weather-shader.mjs",
  "weather.css",
  "portrait-facing.mjs",
  "cards.mjs",
  "lessons.mjs",
  "motives.mjs",
  "life.mjs",
  "quests.mjs",
  "quest-offers.mjs",
  "quest-hands.mjs",
  "shared-quests.mjs",
  "story-quests.mjs",
  "open-door-quests.mjs",
  "homecoming-quests.mjs",
  "quest-completions.mjs",
  "roaming-quests.mjs",
  "roaming-routes.mjs",
  "quest-cards.mjs",
  "situations.mjs",
  "memory.mjs",
  "learning.mjs",
  "adaptive-learning.mjs",
  "narrative.mjs",
  "dialogue.mjs",
  "character-speech.mjs",
  "voices.json",
  ...Object.values(voiceCast.voices).map(({ file }) => file),
  "pack-schema.mjs",
  "pack-registry.mjs",
  "pack-sections.mjs",
  "pack-journeys.mjs",
  "pack-recital.mjs",
  "pack-rules.mjs",
  "pack-transport.mjs",
  "legacy-saves.mjs",
  "forest.json",
  "packs.json",
  "music.mjs",
  "entity-profiles.json",
  ...new Set(
    Object.values(roomTracks)
      .flat()
      .map(({ file }) => `assets/music/${file}`),
  ),
  ...["lamp", "oil", "bell", "cloth"].flatMap((id) => [
    `assets/${id}-card.png`,
    `assets/${id}-card.jpg`,
  ]),
  ...["station", "attic", "pond", "vale", "moth", "keeper", "keeper-right"].map(
    (id) => `assets/${id}.png`,
  ),
  // Keep the art URLs published by earlier Rust releases.
  ...[
    "antigone",
    "baker",
    "bread",
    "creon",
    "decree",
    "elder",
    "funeral-cloth",
    "guard",
    "guide",
    "household-token",
    "ismene",
    "oil-flask",
    "provisions",
    "shovel",
    "testimony",
    "water-jar",
  ].map((id) => `assets/greek-drama/${id}.svg`),
];
// A mounted pack can reuse an image already published by the card table.
for (const file of packMediaFiles) if (!files.includes(file)) files.push(file);
for (const { stage, card } of Object.values(imageVariants.images))
  for (const file of [stage, card]) if (!files.includes(file)) files.push(file);
const types = {
  html: "text/html; charset=utf-8",
  css: "text/css; charset=utf-8",
  mjs: "text/javascript; charset=utf-8",
  json: "application/json",
  png: "image/png",
  jpg: "image/jpeg",
  svg: "image/svg+xml",
  webp: "image/webp",
  mp3: "audio/mpeg",
};
const aliases = Object.entries(musicStreams).map(([source, value]) => {
  if (
    !files.includes(source) ||
    !Number.isSafeInteger(value.offset) ||
    value.offset < 0 ||
    !/^[a-f0-9]{64}$/.test(value.sourceHash)
  )
    throw new Error(`Invalid music stream source: ${source}`);
  return {
    file: value.file,
    source,
    offset: value.offset,
    sourceHash: value.sourceHash,
  };
});
const seen = new Set();
export const publicAssets = Object.freeze(
  [...files.map((file) => ({ file })), ...aliases].map((asset) => {
    const { file } = asset;
    const contentType = types[file.split(".").at(-1)];
    if (
      !/^[a-zA-Z0-9_-]+(?:\/[a-zA-Z0-9_-]+)*\.[a-z0-9]+$/.test(file) ||
      !contentType
    )
      throw new Error(`Invalid public card asset: ${file}`);
    if (seen.has(file)) throw new Error(`Duplicate public card asset: ${file}`);
    seen.add(file);
    return Object.freeze({ ...asset, contentType });
  }),
);
