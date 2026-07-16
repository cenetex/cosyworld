#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";

import dotenv from "dotenv";
import Replicate from "replicate";
import sharp from "sharp";

dotenv.config();

const CONTENT_ROOT = path.resolve("v2/content/core");
const CARDS_PATH = path.join(CONTENT_ROOT, "cards.json");
const ACTORS_PATH = path.join(CONTENT_ROOT, "actors.json");
const ITEMS_PATH = path.join(CONTENT_ROOT, "items.json");
const LOCATIONS_PATH = path.join(CONTENT_ROOT, "locations.json");
const OUTPUT_DIR = path.join(CONTENT_ROOT, "assets/generated/cards");
const PROMPTS_PATH = path.join(OUTPUT_DIR, "prompts.json");
const IMAGE_URL_PREFIX = "/assets/generated/cards";
const DEFAULT_MODEL = "black-forest-labs/flux-dev-lora";
const DEFAULT_LORA = "immanencer/mirquo";
const TEST_CARD_IDS = ["cosy-whiskerwind", "cosy-hearth-tonic", "cosy-rain-soft-garden"];

const ASPECT_RATIOS = {
  tall: "2:3",
  square: "1:1",
  wide: "16:9",
};

const TARGET_SIZES = {
  tall: { width: 768, height: 1152 },
  square: { width: 1024, height: 1024 },
  wide: { width: 1280, height: 720 },
};

function parseArgs(argv) {
  const options = {
    dryRun: false,
    force: false,
    syncPrompts: false,
    testSet: false,
    ids: null,
    limit: null,
    seedSalt: "",
  };
  for (const arg of argv) {
    if (arg === "--sync-prompts") {
      options.syncPrompts = true;
    } else if (arg === "--dry-run") {
      options.dryRun = true;
    } else if (arg === "--force") {
      options.force = true;
    } else if (arg === "--test-set") {
      options.testSet = true;
    } else if (arg.startsWith("--ids=")) {
      options.ids = new Set(
        arg
          .slice("--ids=".length)
          .split(",")
          .map((value) => value.trim())
          .filter(Boolean),
      );
    } else if (arg.startsWith("--limit=")) {
      const limit = Number.parseInt(arg.slice("--limit=".length), 10);
      if (!Number.isFinite(limit) || limit <= 0) {
        throw new Error(`Invalid --limit value in ${arg}`);
      }
      options.limit = limit;
    } else if (arg.startsWith("--seed-salt=")) {
      options.seedSalt = arg.slice("--seed-salt=".length).trim();
    } else {
      throw new Error(`Unknown option: ${arg}`);
    }
  }
  return options;
}

async function readJson(filePath) {
  return JSON.parse(await fs.readFile(filePath, "utf8"));
}

function byId(records) {
  return new Map(records.map((record) => [record.id, record]));
}

function isProtectedSeedAsset(card) {
  return Boolean(card.image_url && !card.image_url.startsWith(`${IMAGE_URL_PREFIX}/`));
}

function isMissingSeedArt(card) {
  if (card.source !== "cosyworld_seed") return false;
  return card.asset_status === "pending_art" && !card.image_url;
}

function isRegeneratableSeedArt(card) {
  if (card.source !== "cosyworld_seed") return false;
  if (card.asset_status === "source_art") return false;
  return !isProtectedSeedAsset(card);
}

function selectCards(cards, options) {
  if (options.testSet && options.force) {
    return TEST_CARD_IDS.map((cardId) => cards.find((card) => card.card_id === cardId))
      .filter(Boolean)
      .filter(isRegeneratableSeedArt);
  }

  let selected = cards.filter(options.force ? isRegeneratableSeedArt : isMissingSeedArt);
  if (options.testSet) {
    selected = ["actor", "item", "location"]
      .map((kind) => selected.find((card) => card.subject_kind === kind))
      .filter(Boolean);
  }
  if (options.ids) {
    selected = selected.filter((card) => options.ids.has(card.card_id));
  }
  if (options.limit) {
    selected = selected.slice(0, options.limit);
  }
  return selected;
}

function sentence(value) {
  return String(value || "")
    .trim()
    .replace(/\s+/g, " ");
}

function subjectFor(card, indexes) {
  if (card.subject_kind === "actor") {
    return indexes.actors.get(card.subject_id);
  }
  if (card.subject_kind === "item") {
    return indexes.items.get(card.subject_id);
  }
  if (card.subject_kind === "location") {
    return indexes.locations.get(card.subject_id);
  }
  return null;
}

function itemVisualSubject(name) {
  const lower = name.toLowerCase();
  if (lower.includes("button")) {
    return `a single ${name}, clearly a round sewing button with visible holes`;
  }
  if (lower.includes("thread")) {
    return `a single coiled strand or small spool of ${name}`;
  }
  if (lower.includes("charm")) {
    return `a single small pendant charm, ${name}`;
  }
  if (lower.includes("tag")) {
    return `a single smooth pendant tag, ${name}`;
  }
  if (lower.includes("bell")) {
    return `a single small hand bell, ${name}`;
  }
  if (lower.includes("map")) {
    return `one torn cloth map scrap, ${name}`;
  }
  if (lower.includes("bookmark")) {
    return `one pressed fern bookmark, ${name}`;
  }
  if (lower.includes("bead")) {
    return `one polished glass bead, ${name}`;
  }
  if (lower.includes("tonic") || lower.includes("potion")) {
    return `one small potion bottle, ${name}`;
  }
  return `one ${name}`;
}

function buildPrompt(card, indexes) {
  const subject = subjectFor(card, indexes);
  const aspect = ASPECT_RATIOS[card.aspect] || "1:1";
  const shared = [
    "Use case: illustration-story",
    `Asset type: Cosyworld collectible card art, ${aspect} ${card.aspect} image`,
    "Style: Mirquo FLUX LoRA, whimsical fantasy storybook illustration, painterly digital art, tactile materials, soft cinematic lighting, cozy but strange, polished game asset.",
    "Constraints: no readable text, no letters, no numbers, no watermark, no logo, no UI, no card border, no trading-card frame.",
  ];

  if (card.subject_kind === "actor") {
    const currentLocation = indexes.locations.get(subject?.location_id);
    const details = [
      sentence(subject?.description || card.blurb),
      currentLocation ? `Home location mood: ${currentLocation.name}, ${currentLocation.description}` : "",
      Array.isArray(subject?.desires) && subject.desires.length
        ? `Desire motif: ${subject.desires.map((entry) => sentence(entry.reason)).join("; ")}`
        : "",
      Array.isArray(subject?.attachments) && subject.attachments.length
        ? `Attachment motif: ${subject.attachments.map((entry) => sentence(entry.reason)).join("; ")}`
        : "",
    ].filter(Boolean);
    return [
      ...shared,
      `Primary request: Create a character portrait for ${card.display_name}, titled ${card.title}.`,
      `Subject: ${card.display_name}; ${details.join(" ")}`,
      "Composition: the character is large in the foreground and fills about 70 percent of the frame, centered full-body or three-quarter avatar portrait with a clear silhouette, expressive posture, visible face and body, atmospheric background, generous breathing room.",
      "Do not make the character tiny, distant, hidden, back-turned, or secondary to the room.",
      "Use a clean atmospheric backdrop; avoid posters, signs, framed portraits, labels, captions, symbols, and decorative written marks.",
      "Keep the character as the only main figure unless the description explicitly implies a reflection or apparition.",
    ].join("\n");
  }

  if (card.subject_kind === "item") {
    const visualSubject = itemVisualSubject(card.display_name);
    return [
      ...shared,
      `Primary request: Create an item portrait for ${card.display_name}.`,
      `Subject: ${visualSubject}. ${sentence(subject?.description || card.blurb)} Kind: ${subject?.kind || "keepsake"}.`,
      "Composition: object-only catalog icon, exactly one nonliving object centered as a magical still life, clear silhouette, plain uncluttered background, simple cloth/wood/stone surface, enough padding for a square crop.",
      "The object should fill about 75 percent of the frame while remaining fully visible.",
      "Do not add an environment scene, room, landscape, animals, mascots, faces, eyes, hands, characters, shelves, books, clocks, labels, packaging, duplicate copies, readable engravings, signatures, or extra main objects.",
    ].join("\n");
  }

  if (card.subject_kind === "location") {
    return [
      ...shared,
      `Primary request: Create an establishing environment illustration for ${card.display_name}.`,
      `Scene/backdrop: ${card.display_name}, ${card.title}. ${sentence(subject?.description || card.blurb)}`,
      subject?.persona ? `Mood/persona: ${sentence(subject.persona)}` : "",
      Array.isArray(subject?.memory) && subject.memory.length
        ? `Memory details: ${subject.memory.map(sentence).join(" ")}`
        : "",
      "Composition: wide cinematic establishing shot, strong readable landmark, layered depth, environment only.",
      "Do not include people, characters, creatures, humanoid figures, statues, readable signs, or readable writing.",
    ]
      .filter(Boolean)
      .join("\n");
  }

  throw new Error(`Unsupported subject kind: ${card.subject_kind}`);
}

function stableSeed(value) {
  let hash = 2166136261;
  for (const char of value) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function outputUrls(output) {
  if (!output) return [];
  if (typeof output === "string") return [output];
  if (Array.isArray(output)) return output.flatMap(outputUrls);
  if (typeof output.url === "function") {
    return [String(output.url())];
  }
  if (output.output) return outputUrls(output.output);
  if (output.image) return outputUrls(output.image);
  if (output.images) return outputUrls(output.images);
  return [];
}

function replicateInput(card, prompt, options) {
  const input = {
    prompt,
    lora_weights: process.env.REPLICATE_LORA_WEIGHTS || DEFAULT_LORA,
    aspect_ratio: ASPECT_RATIOS[card.aspect] || "1:1",
    num_outputs: 1,
    num_inference_steps: 28,
    guidance: 3,
    lora_scale: 1,
    go_fast: false,
    output_format: "webp",
    output_quality: 92,
    seed: stableSeed(options.seedSalt ? `${card.card_id}:${options.seedSalt}` : card.card_id),
  };
  if (process.env.REPLICATE_EXTRA_LORA) {
    input.extra_lora = process.env.REPLICATE_EXTRA_LORA;
  }
  return input;
}

async function generateCard({ replicate, model, card, prompt, dryRun, options }) {
  const destination = path.join(OUTPUT_DIR, `${card.card_id}.webp`);
  const imageUrl = `${IMAGE_URL_PREFIX}/${card.card_id}.webp`;
  const input = replicateInput(card, prompt, options);

  if (dryRun) {
    return { card, imageUrl, destination, prompt, input, skipped: true };
  }

  const output = await replicate.run(model, { input });
  const [url] = outputUrls(output);
  if (!url) {
    throw new Error(`No image URL returned for ${card.card_id}: ${JSON.stringify(output)}`);
  }

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to download ${card.card_id}: ${response.status} ${response.statusText}`);
  }
  const bytes = Buffer.from(await response.arrayBuffer());
  const target = TARGET_SIZES[card.aspect] || TARGET_SIZES.square;
  await fs.mkdir(OUTPUT_DIR, { recursive: true });
  await sharp(bytes)
    .resize({ ...target, fit: "cover" })
    .webp({ quality: 90 })
    .toFile(destination);

  return { card, imageUrl, destination, prompt, input };
}

function updateCards(cards, generated) {
  const generatedById = new Map(generated.map((entry) => [entry.card.card_id, entry]));
  return cards.map((card) => {
    const entry = generatedById.get(card.card_id);
    if (!entry || entry.skipped) return card;
    return {
      ...card,
      asset_status: "generated_art",
      image_url: entry.imageUrl,
    };
  });
}

async function writePromptManifest(generated) {
  let existing = {};
  try {
    existing = JSON.parse(await fs.readFile(PROMPTS_PATH, "utf8"));
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  for (const entry of generated) {
    existing[entry.card.card_id] = {
      subject_kind: entry.card.subject_kind,
      subject_id: entry.card.subject_id,
      display_name: entry.card.display_name,
      model: process.env.REPLICATE_BASE_MODEL || DEFAULT_MODEL,
      lora_weights: process.env.REPLICATE_LORA_WEIGHTS || DEFAULT_LORA,
      image_url: entry.imageUrl,
      prompt: entry.prompt,
      input: {
        ...entry.input,
        prompt: undefined,
      },
    };
  }
  await fs.mkdir(OUTPUT_DIR, { recursive: true });
  await fs.writeFile(PROMPTS_PATH, `${JSON.stringify(existing, null, 2)}\n`);
}

async function syncPrompts(cards, indexes) {
  let existing = {};
  try {
    existing = JSON.parse(await fs.readFile(PROMPTS_PATH, "utf8"));
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  let updated = 0;
  for (const card of cards) {
    const entry = existing[card.card_id];
    if (!entry) continue;
    const prompt = buildPrompt(card, indexes);
    if (entry.prompt !== prompt) {
      entry.prompt = prompt;
      updated++;
    }
  }
  await fs.mkdir(OUTPUT_DIR, { recursive: true });
  await fs.writeFile(PROMPTS_PATH, `${JSON.stringify(existing, null, 2)}\n`);
  console.log(`Synced ${updated} prompt(s) from current content.`);
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const [cards, actors, items, locations] = await Promise.all([
    readJson(CARDS_PATH),
    readJson(ACTORS_PATH),
    readJson(ITEMS_PATH),
    readJson(LOCATIONS_PATH),
  ]);
  const indexes = {
    actors: byId(actors),
    items: byId(items),
    locations: byId(locations),
  };

  if (options.syncPrompts) {
    await syncPrompts(cards, indexes);
    console.log("Prompt sync complete.");
    return;
  }

  const selected = selectCards(cards, options);
  if (!selected.length) {
    console.log("No matching missing Cosyworld seed cards found.");
    return;
  }

  const model = process.env.REPLICATE_BASE_MODEL || DEFAULT_MODEL;
  const token = process.env.REPLICATE_API_TOKEN;
  if (!options.dryRun && !token) {
    throw new Error("REPLICATE_API_TOKEN is required to generate card art.");
  }
  const replicate = options.dryRun ? null : new Replicate({ auth: token });
  const generated = [];

  console.log(`Generating ${selected.length} card image(s) with ${model}.`);
  for (const card of selected) {
    const prompt = buildPrompt(card, indexes);
    console.log(`- ${card.card_id} (${card.subject_kind}, ${card.aspect})`);
    generated.push(
      await generateCard({ replicate, model, card, prompt, dryRun: options.dryRun, options }),
    );
  }

  await writePromptManifest(generated);
  if (!options.dryRun) {
    const updatedCards = updateCards(cards, generated);
    await fs.writeFile(CARDS_PATH, `${JSON.stringify(updatedCards, null, 2)}\n`);
  }
  console.log(options.dryRun ? "Dry run complete." : "Card art generation complete.");
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
