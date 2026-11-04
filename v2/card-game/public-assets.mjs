import musicStreams from "./music-streams.json" with { type: "json" };
import titleLogos from "./title-logos.json" with { type: "json" };
import { roomTracks } from "./music.mjs";
import { CUE_TRACKS } from "./music-cues.mjs";
import { packMediaFiles } from "./pack-registry.mjs";
import imageVariants from "./image-variants.json" with { type: "json" };
import voiceCast from "./voices.json" with { type: "json" };
import { daylightAssets } from "./daylight.mjs";
import { rarityPortraitAssets } from "./rarity-portraits.mjs";
import { castCombatAssets } from "./cast-combat-art.mjs";
import { sleepPortraitAssets } from "./sleep-portraits.mjs";
import { BENCH } from "./settings-cards.mjs";

// The local server, release smoke, and Rust asset generator use this list.
const files = [
  "build-info.mjs",
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
  "world-name.mjs",
  "avatar-world.mjs",
  "avatar-menu.mjs",
  "unlock-view.mjs",
  "world-names.json",
  "inner-life.mjs",
  "toolbar.css",
  "shared-cast.json",
  "human-cast.mjs",
  "scarves.mjs",
  "boardyai.mjs",
  "boardyai.json",
  "assets/card-back.webp",
  // The locked box (locked-box.mjs); a stand-in until its own painting.
  "assets/card-back-locked.webp",
  // The new-world title (title-intro.mjs); logos may share toolbar art.
  ...new Set(
    titleLogos.logos.flatMap(({ src, toolbar }) =>
      toolbar ? [src, toolbar.src] : [src],
    ),
  ),
  "assets/music/title-attic-lamp.mp3",
  // Settings cards cut from the owner's workbench (settings-cards.mjs).
  ...BENCH.map((name) => `assets/settings/workbench-${name}.png`),
  // Rest card paintings for issue #1849; the rest-card feature follows.
  "assets/rest/short-rest.webp",
  "assets/rest/long-rest.webp",
  "sleep-portraits.mjs",
  ...sleepPortraitAssets,
  ...["body", "reflection", "contact", "still"].map(
    (part) => `assets/greek-drama/ship-layers/pond-ship-${part}.webp`,
  ),
  "assets/greek-drama/ship-layers/recipe.json",
  // Standoff effect art for issue #1920; runtime overlays follow.
  ...[
    "hit-1",
    "hit-2",
    "hit-3",
    "brace-raise",
    "brace-absorb",
    "swipe-left",
    "swipe-right",
    "jab-left",
    "jab-right",
  ].map((id) => `assets/combat/effects/${id}.png`),
  // Combat pose art, chosen by combat-portraits.mjs.
  ...["vale", "mara", "ash", "nell", "tavi", "rue", "orin", "ada"].flatMap(
    (id) =>
      ["", "-scarf"].flatMap((wardrobe) =>
        ["attack", "hit"].map(
          (pose) => `assets/combat/${id}${wardrobe}-${pose}.webp`,
        ),
      ),
  ),
  ...["keeper", "moth"].flatMap((id) =>
    ["attack", "hit"].map((pose) => `assets/combat/${id}-${pose}.webp`),
  ),
  "cast-combat-art.mjs",
  "assets/combat/cast-roster.json",
  "assets/combat/pose-fit.json",
  ...castCombatAssets,
  "level-tiers.mjs",
  "rarity.mjs",
  "rarity-portraits.mjs",
  ...rarityPortraitAssets,
  "quest-card.mjs",
  "quest-screen.mjs",
  "card-tiers.css",
  "card-reveal.mjs",
  "card-entry.mjs",
  "locked-box.mjs",
  "card-level-up.mjs",
  // Willows sign alternates chosen by the willows pack.
  ...[
    "landing-otter",
    "landing-boatman",
    "landing-mended",
    "camp-closer",
    "camp-tent-pressure",
    "thicket-bronze",
    "thicket-hollows",
    "bank-humming",
    "bank-roots",
    "bank-drowned",
  ].map((name) => `assets/willows/${name}.webp`),
  // Notebook cards remain available before their items are wired.
  ...[
    "notebook-page-1",
    "notebook-page-2",
    "notebook-page-3",
    "notebook-chapter",
    "notebook-book",
  ].map((name) => `assets/willows/${name}.png`),
  // Argos commissioned art: start
  "assets/greek-drama/house-atreus-palace.webp",
  "assets/greek-drama/house-atreus-tomb.webp",
  "assets/greek-drama/house-atreus-mycenae.webp",
  "assets/greek-drama/house-atreus-farmhouse.webp",
  "assets/greek-drama/house-atreus-palace-night.webp",
  "assets/greek-drama/house-atreus-tomb-night.webp",
  "assets/greek-drama/house-atreus-mycenae-night.webp",
  "assets/greek-drama/house-atreus-farmhouse-night.webp",
  "assets/greek-drama/olive-branch.webp",
  // Argos commissioned art: end
  "assets/greek-drama/harbor-day.webp",
  "assets/greek-drama/ship-deck-twilight.webp",
  "assets/greek-drama/ship-deck-at-sea-day.webp",
  "assets/greek-drama/ship-deck-at-sea-night.webp",
  // Keep alternate scenery referenced by released shared rules available.
  "assets/greek-drama/book-three-lemnos-day.webp",
  "assets/greek-drama/book-three-thrace-day.webp",
  "assets/shared/places/pond.png",
  "assets/shared/places/attic-dark.webp",
  "assets/shared/places/attic-stairs.webp",
  "assets/attic/attic-lit.webp",
  "assets/attic/attic-lit-cottage.webp",
  "assets/shared/places/attic-lit-cottage.webp",
  "assets/attic/attic-doused.webp",
  ...["vale", "mara", "ash", "nell", "tavi", "rue", "orin", "ada"].map(
    (id) => `assets/shared/characters/${id}-scarf.png`,
  ),
  // Personal button art is ready for the authored items in issue #1441.
  ...["vale", "mara", "ash", "nell", "tavi", "rue", "orin", "ada"].map(
    (id) => `assets/lonely-forest/button-${id}.png`,
  ),
  // Brace pose art: start
  "assets/combat/vale-guard.webp",
  "assets/combat/vale-scarf-guard.webp",
  "assets/combat/mara-guard.webp",
  "assets/combat/mara-scarf-guard.webp",
  "assets/combat/ash-guard.webp",
  "assets/combat/ash-scarf-guard.webp",
  "assets/combat/nell-guard.webp",
  "assets/combat/nell-scarf-guard.webp",
  "assets/combat/tavi-guard.webp",
  "assets/combat/tavi-scarf-guard.webp",
  "assets/combat/rue-guard.webp",
  "assets/combat/rue-scarf-guard.webp",
  "assets/combat/orin-guard.webp",
  "assets/combat/orin-scarf-guard.webp",
  "assets/combat/ada-guard.webp",
  "assets/combat/ada-scarf-guard.webp",
  "assets/combat/moth-guard.webp",
  "assets/combat/keeper-guard.webp",
  // Brace pose art: end
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
  // The Privacy page (#2052), served at /privacy.
  "privacy.html",
  "privacy.css",
  "privacy.mjs",
  "metrics.mjs",
  "style.css",
  "entry.mjs",
  "title-intro.mjs",
  "title-logo.mjs",
  "title-logos.json",
  "acknowledgement.json",
  "title-song.mjs",
  "audio-wake.mjs",
  "local-service.mjs",
  "local-saves.mjs",
  "combat.css",
  "beats.mjs",
  "combat-beats.mjs",
  "combat-view.mjs",
  "defeat-view.mjs",
  "combat-portraits.mjs",
  "app.mjs",
  "pack-landing.mjs",
  "pack-landings.json",
  "world.mjs",
  "scene-cast.mjs",
  "settings-cards.mjs",
  "settings-screen.mjs",
  "scene.mjs",
  "weather.mjs",
  "weather.json",
  "daylight.mjs",
  ...daylightAssets,
  "weather-view.mjs",
  "stage-light.mjs",
  "stage-light.json",
  "stage-light-view.mjs",
  "transitions.mjs",
  "weather-shader.mjs",
  "weather.css",
  "portrait-facing.mjs",
  "presentation.mjs",
  "cards.mjs",
  "motives.mjs",
  "life.mjs",
  "knowledge.mjs",
  "roaming-routes.mjs",
  "want-talk.mjs",
  "want.mjs",
  "memory.mjs",
  "learning.mjs",
  "adaptive-learning.mjs",
  "reflections.mjs",
  "narrative.mjs",
  "between-us.mjs",
  "signed-words.mjs",
  "speech-knowledge.mjs",
  "speech-occasions.mjs",
  "expression.mjs",
  "emoji-symbols.json",
  "dialogue.mjs",
  "card-names.mjs",
  "character-speech.mjs",
  "credits.mjs",
  "voices.json",
  ...Object.values(voiceCast.voices).map(({ file }) => file),
  "pack-schema.mjs",
  "pack-registry.mjs",
  "pack-sections.mjs",
  "pack-specials.mjs",
  "hidden-avatar.mjs",
  "homecoming.mjs",
  "pack-journeys.mjs",
  "pack-recital.mjs",
  "pack-rules.mjs",
  "pack-toggle.mjs",
  "pack-transport.mjs",
  "item-use.mjs",
  "pack-items.mjs",
  "pack-items-schema.mjs",
  "legacy-saves.mjs",
  "forest.json",
  "speech.json",
  "packs.json",
  "music.mjs",
  "music-cues.mjs",
  ...Object.values(CUE_TRACKS).map(({ file }) => `assets/music/${file}`),
  "hum.mjs",
  "sfx.mjs",
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
for (const { stage, card, phone } of Object.values(imageVariants.images))
  for (const file of [stage, card, phone])
    if (file && !files.includes(file)) files.push(file);
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
  m4a: "audio/mp4",
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
