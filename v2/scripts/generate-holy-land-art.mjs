#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import dotenv from "dotenv";
import Replicate from "replicate";
import sharp from "sharp";

dotenv.config();

const CONTENT_ROOT = path.resolve("v2/content/the-holy-land");
const CARDS_PATH = path.join(CONTENT_ROOT, "cards.json");
const ACTORS_PATH = path.join(CONTENT_ROOT, "actors.json");
const LOCATIONS_PATH = path.join(CONTENT_ROOT, "locations.json");
const OUTPUT_DIR = path.join(CONTENT_ROOT, "assets/cards");
const PROMPTS_PATH = path.join(OUTPUT_DIR, "prompts.json");
const IMAGE_URL_PREFIX = "/assets/the-holy-land/cards";
const MODEL_VERSION = "2846199bda89a44676dc5da00bd02faa3f5183b1c1d3e124c966d656874f141f";
const DEFAULT_MODEL = `ratimics/b43l:${MODEL_VERSION}`;
const LORA_TRIGGER = process.env.HOLY_LAND_LORA_TRIGGER || "B43L";
export const DEFAULT_LORA_SCALE = 1.25;
export const DEFAULT_ART_STYLE =
  "Rough unfinished watercolor; heavy pigment, broken washes, blooms, searching pencil, raw paper.";
const ACTOR_HISTORICAL_CONSTRAINT =
  "One ordinary first-century Levantine traveler; no halo, cross, text, modern gear, or later religious costume.";
const LOCATION_HISTORICAL_CONSTRAINT =
  "First-century Levant only; no later religious monuments, readable text, modern objects, or anachronistic architecture.";

const ASPECT_RATIOS = { tall: "2:3", square: "1:1", wide: "16:9" };
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
    ids: null,
    limit: null,
    seedSalt: "",
    sampleDir: null,
    stylePrompt: null,
  };
  for (const arg of argv) {
    if (arg === "--sync-prompts") options.syncPrompts = true;
    else if (arg === "--dry-run") options.dryRun = true;
    else if (arg === "--force") options.force = true;
    else if (arg.startsWith("--ids=")) {
      options.ids = new Set(arg.slice(6).split(",").map((value) => value.trim()).filter(Boolean));
    } else if (arg.startsWith("--limit=")) {
      options.limit = Number.parseInt(arg.slice(8), 10);
      if (!Number.isInteger(options.limit) || options.limit <= 0) throw new Error(`Invalid limit: ${arg}`);
    } else if (arg.startsWith("--seed-salt=")) options.seedSalt = arg.slice(12).trim();
    else if (arg.startsWith("--sample-dir=")) {
      const sampleDir = arg.slice(13).trim();
      if (!sampleDir) throw new Error(`Invalid sample directory: ${arg}`);
      options.sampleDir = path.resolve(sampleDir);
    } else if (arg.startsWith("--style=")) {
      options.stylePrompt = arg.slice(8).trim();
      if (!options.stylePrompt) throw new Error(`Invalid style prompt: ${arg}`);
    } else throw new Error(`Unknown option: ${arg}`);
  }
  return options;
}

async function readJson(filePath) {
  return JSON.parse(await fs.readFile(filePath, "utf8"));
}

function sentence(value) {
  return String(value || "").trim().replace(/\s+/g, " ");
}

function stableSeed(value) {
  let hash = 2166136261;
  for (const char of value) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function selectCards(cards, options) {
  let selected = cards.filter((card) => options.force || (card.asset_status === "pending_art" && !card.image_url));
  if (options.ids) selected = selected.filter((card) => options.ids.has(card.card_id));
  if (options.limit) selected = selected.slice(0, options.limit);
  return selected;
}

export function actorPrompt(card, actor, stylePrompt = DEFAULT_ART_STYLE) {
  return [
    `${LORA_TRIGGER}. ${stylePrompt}`,
    `Meet ${card.display_name}, ${card.title}, already mid-journey in the first-century Holy Land. ${sentence(card.blurb || actor.description)} ${ACTOR_HISTORICAL_CONSTRAINT}`,
  ].join("\n");
}

export function locationPrompt(card, location, stylePrompt = DEFAULT_ART_STYLE) {
  return [
    `${LORA_TRIGGER}. ${stylePrompt}`,
    `Arrive mid-journey at ${card.display_name}, ${card.title}, in the first-century Holy Land. ${sentence(card.blurb || location.description)} ${LOCATION_HISTORICAL_CONSTRAINT}`,
  ].join("\n");
}

export function buildPrompt(card, actors, locations, stylePrompt = DEFAULT_ART_STYLE) {
  if (card.subject_kind === "actor") {
    return actorPrompt(card, actors.get(card.subject_id), stylePrompt);
  }
  if (card.subject_kind === "location") {
    return locationPrompt(card, locations.get(card.subject_id), stylePrompt);
  }
  throw new Error(`Unsupported subject kind: ${card.subject_kind}`);
}

function outputUrls(output) {
  if (!output) return [];
  if (typeof output === "string") return [output];
  if (Array.isArray(output)) return output.flatMap(outputUrls);
  if (typeof output.url === "function") return [String(output.url())];
  if (output.output) return outputUrls(output.output);
  return [];
}

export function replicateInput(card, prompt, options) {
  const configuredScale = Number.parseFloat(process.env.HOLY_LAND_LORA_SCALE || "");
  const loraScale = Number.isFinite(configuredScale) ? configuredScale : DEFAULT_LORA_SCALE;
  return {
    prompt,
    model: "dev",
    aspect_ratio: ASPECT_RATIOS[card.aspect] || "1:1",
    num_outputs: 1,
    num_inference_steps: 28,
    guidance_scale: 4.5,
    lora_scale: loraScale,
    go_fast: false,
    megapixels: "1",
    output_format: "webp",
    output_quality: 92,
    disable_safety_checker: false,
    seed: stableSeed(options.seedSalt ? `${card.card_id}:${options.seedSalt}` : card.card_id),
  };
}

async function generateCard(replicate, model, card, prompt, options) {
  const input = replicateInput(card, prompt, options);
  const destination = path.join(options.sampleDir || OUTPUT_DIR, `${card.card_id}.webp`);
  const imageUrl = options.sampleDir ? null : `${IMAGE_URL_PREFIX}/${card.card_id}.webp`;
  if (options.dryRun) return { card, input, prompt, destination, imageUrl, dryRun: true };

  const output = await replicate.run(model, { input });
  const [url] = outputUrls(output);
  if (!url) throw new Error(`No image URL returned for ${card.card_id}: ${JSON.stringify(output)}`);
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Download failed for ${card.card_id}: ${response.status} ${response.statusText}`);
  const target = TARGET_SIZES[card.aspect] || TARGET_SIZES.square;
  const overscan = {
    width: Math.ceil(target.width * 1.12),
    height: Math.ceil(target.height * 1.12),
  };
  let pipeline = sharp(Buffer.from(await response.arrayBuffer()))
    .resize({ ...overscan, fit: "cover" })
    .extract({
      left: Math.floor((overscan.width - target.width) / 2),
      top: Math.floor((overscan.height - target.height) / 2),
      ...target,
    });
  if (card.subject_kind === "actor") {
    const portraitCrop = {
      width: Math.ceil(target.width * 1.15),
      height: Math.ceil(target.height * 1.15),
    };
    pipeline = pipeline.resize(portraitCrop).extract({
      left: Math.floor((portraitCrop.width - target.width) / 2),
      top: 0,
      ...target,
    });
  }
  await pipeline.webp({ quality: 90 }).toFile(destination);
  return { card, input, prompt, destination, imageUrl };
}

async function persistResult(cards, entry, model) {
  const card = cards.find((candidate) => candidate.card_id === entry.card.card_id);
  card.asset_status = "generated_art";
  card.image_url = entry.imageUrl;
  await fs.writeFile(CARDS_PATH, `${JSON.stringify(cards, null, 2)}\n`);

  let prompts = {};
  try {
    prompts = await readJson(PROMPTS_PATH);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  prompts[card.card_id] = {
    subject_kind: card.subject_kind,
    subject_id: card.subject_id,
    display_name: card.display_name,
    model,
    model_owner: "ratimics",
    model_name: "b43l",
    model_version: MODEL_VERSION,
    lora_trigger: LORA_TRIGGER,
    image_url: entry.imageUrl,
    prompt: entry.prompt,
    input: { ...entry.input, prompt: undefined },
  };
  await fs.writeFile(PROMPTS_PATH, `${JSON.stringify(prompts, null, 2)}\n`);
}

async function syncPrompts(cards, actors, locations) {
  let prompts = {};
  try {
    prompts = await readJson(PROMPTS_PATH);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  let updated = 0;
  for (const card of cards) {
    const entry = prompts[card.card_id];
    if (!entry) continue;
    const prompt = buildPrompt(card, actors, locations);
    if (entry.prompt !== prompt) {
      entry.prompt = prompt;
      updated++;
    }
  }
  await fs.mkdir(OUTPUT_DIR, { recursive: true });
  await fs.writeFile(PROMPTS_PATH, `${JSON.stringify(prompts, null, 2)}\n`);
  console.log(`Synced ${updated} prompt(s) from current content.`);
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const [cards, actorRows, locationRows] = await Promise.all([
    readJson(CARDS_PATH),
    readJson(ACTORS_PATH),
    readJson(LOCATIONS_PATH),
  ]);
  const actors = new Map(actorRows.map((actor) => [actor.id, actor]));
  const locations = new Map(locationRows.map((location) => [location.id, location]));

  if (options.syncPrompts) {
    await syncPrompts(cards, actors, locations);
    console.log("Prompt sync complete.");
    return;
  }

  const selected = selectCards(cards, options);
  if (!selected.length) {
    console.log("No matching Holy Land cards need art.");
    return;
  }

  const model = process.env.HOLY_LAND_REPLICATE_MODEL || DEFAULT_MODEL;
  if (!options.dryRun && !process.env.REPLICATE_API_TOKEN) {
    throw new Error("REPLICATE_API_TOKEN is required to generate Holy Land art.");
  }
  const replicate = options.dryRun ? null : new Replicate({ auth: process.env.REPLICATE_API_TOKEN });
  await fs.mkdir(options.sampleDir || OUTPUT_DIR, { recursive: true });
  console.log(`${options.dryRun ? "Preparing" : "Generating"} ${selected.length} Holy Land image(s) with ${model}.`);

  for (let index = 0; index < selected.length; index += 1) {
    const card = selected[index];
    const prompt = buildPrompt(card, actors, locations, options.stylePrompt || DEFAULT_ART_STYLE);
    console.log(`[${index + 1}/${selected.length}] ${card.card_id} (${card.aspect})`);
    const entry = await generateCard(replicate, model, card, prompt, options);
    if (!options.dryRun && !options.sampleDir) await persistResult(cards, entry, model);
    if (!options.dryRun && options.sampleDir) console.log(`  sample: ${entry.destination}`);
  }
  console.log(options.dryRun ? "Holy Land art dry run complete." : "Holy Land art generation complete.");
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main().catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}
