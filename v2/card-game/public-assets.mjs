import { roomTracks } from "./music.mjs";
import { packMediaFiles } from "./pack-registry.mjs";

// The local server, release smoke, and Rust asset generator use this list.
const files = [
  "index.html",
  "style.css",
  "entry.mjs",
  "awakening.css",
  "app.mjs",
  "world.mjs",
  "scene.mjs",
  "cards.mjs",
  "lessons.mjs",
  "motives.mjs",
  "life.mjs",
  "quests.mjs",
  "quest-cards.mjs",
  "situations.mjs",
  "memory.mjs",
  "narrative.mjs",
  "dialogue.mjs",
  "pack-schema.mjs",
  "pack-registry.mjs",
  "pack-rules.mjs",
  "legacy-saves.mjs",
  "forest.json",
  "packs.json",
  "music.mjs",
  "entity-profiles.json",
  ...Object.values(roomTracks)
    .flat()
    .map(({ file }) => `assets/music/${file}`),
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
  ...packMediaFiles,
];
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
const seen = new Set();
export const publicAssets = Object.freeze(
  files.map((file) => {
    const contentType = types[file.split(".").at(-1)];
    if (
      !/^[a-zA-Z0-9_-]+(?:\/[a-zA-Z0-9_-]+)*\.[a-z0-9]+$/.test(file) ||
      !contentType
    )
      throw new Error(`Invalid public card asset: ${file}`);
    if (seen.has(file)) throw new Error(`Duplicate public card asset: ${file}`);
    seen.add(file);
    return Object.freeze({ file, contentType });
  }),
);
