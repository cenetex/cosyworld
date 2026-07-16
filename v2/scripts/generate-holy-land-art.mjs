#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";

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
const DEFAULT_LORA_SCALE = 1;

const ASPECT_RATIOS = { tall: "2:3", square: "1:1", wide: "16:9" };
const TARGET_SIZES = {
  tall: { width: 768, height: 1152 },
  square: { width: 1024, height: 1024 },
  wide: { width: 1280, height: 720 },
};

function parseArgs(argv) {
  const options = { dryRun: false, force: false, syncPrompts: false, ids: null, limit: null, seedSalt: "" };
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
    else throw new Error(`Unknown option: ${arg}`);
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

const ACTOR_VISUAL_NOTES = new Map([
  [7002, "A sturdy middle-aged Galilean fisherman with a broad weathered face, short curly dark hair threaded with gray, full trimmed beard, strong working hands, undyed tunic and muted lake-blue mantle."],
  [7003, "A lean middle-aged Galilean fisherman with sun-weathered skin, short dark curls, close beard, observant gentle eyes, practical brown tunic and blue-green mantle."],
  [7004, "A strong young Galilean fisherman with cropped dark curls, short beard, intense expression, practical ochre tunic and rust-red shoulder wrap."],
  [7005, "A younger Galilean man with slim build, clean-shaven face, wavy dark hair to the jaw, contemplative eyes, pale linen tunic and muted blue mantle."],
  [7006, "A practical middle-aged man with narrow thoughtful face, short salt-and-pepper curls, neat beard, travel-worn sand tunic and olive mantle, carrying no religious object."],
  [7007, "A tall spare man with deeply observant eyes, close-cropped black hair, short angular beard, simple cream tunic and muted teal mantle."],
  [7008, "A compact scholarly man with carefully trimmed dark beard, receding curly hair, ink-stained fingers, plain brown tunic and moss-green mantle, a closed wax tablet at his belt."],
  [7009, "A serious middle-aged traveler with tired kind eyes, thick short dark hair, close beard, charcoal tunic and muted indigo mantle."],
  [7010, "An unassuming older man with gray-flecked short curls, modest beard, quiet posture, undyed linen tunic and soft brown mantle, empty hands."],
  [7011, "A thoughtful younger man with oval face, short black curls, light beard, warm brown eyes, pale tunic and subdued saffron mantle, empty hands."],
  [7012, "A lean wiry middle-aged man with close dark hair, short beard, disciplined stance, plain gray tunic and deep olive mantle, no weapon."],
  [7013, "A guarded middle-aged man with narrow face, short dark curls, carefully trimmed beard, burgundy-brown tunic and muted charcoal mantle, a simple coin pouch at his belt."],
  [7014, "A weathered older fisher with cropped gray-black hair, short beard, patched blue tunic, rope-callused hands, and a mended net over one shoulder."],
  [7015, "An unnamed adult Samaritan-region traveler with dark braided hair covered by a simple earth-toned head cloth, modest layered linen garments, and a clay water jar."],
  [7016, "An unnamed older pilgrim with sun-lined face, short gray beard, dusty tan garments, walking staff used only for travel, and a small woven satchel."],
  [7017, "An unnamed adult traveler with cropped dark curls, close beard, subdued blue-gray garments, worn sandals, and a tied travel bundle."],
]);

const LOCATION_VISUAL_NOTES = new Map([
  [700, "A modest Judean ridge settlement of flat-roofed pale limestone homes, rough lanes, olive terraces, and one humble lamplit courtyard; no monumental building."],
  [701, "A very small lower-Galilean agricultural village of simple flat-roofed limestone and mud-plaster houses, cisterns, workshops, grain plots, and terraced slopes; no civic monument."],
  [702, "A natural slow river crossing with brown-green water, dense reed beds, rounded stones, tamarisk, pale desert scrub, and open sky; no building."],
  [703, "A modest Galilean hill village of flat-roofed stone houses and a shaded wedding courtyard with large plain stone water jars, vine rows, figs, and rough lanes."],
  [704, "A compact first-century fishing village of dark basalt flat-roofed houses and unpaved lanes on the northwestern lakeshore, with a modest synagogue-like stone gathering house, nets, and small wooden boats; no skyline."],
  [705, "An open freshwater pebbled shore with drying nets on wooden racks, small plain fishing boats pulled onto stones, blue-green water, and hazy Galilean hills; no town skyline."],
  [706, "A broad treeless grassy slope above the blue Sea of Galilee, spring wildflowers, mustard plants, footpaths, distant low hills, and generous open listening ground; no building."],
  [707, "A humble reed-fringed fishing settlement near the lake's northern reaches, with low flat-roofed stone and mud-plaster houses, net yards, inlets, and plain wooden boats."],
  [708, "A dramatic limestone cliff and grotto above clear cold springs in lush northern country, with oak shade and rushing channels; only subtle traces of first-century stonework."],
  [709, "A deep circular well of heavily worn ancient stones on an open dry terrace beside a dusty Samaritan hill road, with a clay jar and sparse shade; no building."],
  [710, "A first-century oasis settlement of low flat-roofed mudbrick and stone homes among date palms, spring channels, dusty streets, and the barren Judean ascent beyond."],
  [711, "A small first-century village of flat-roofed limestone homes among olive groves on the eastern slope, with one welcoming courtyard and Jerusalem only faintly beyond the ridge."],
  [712, "First-century Jerusalem at Passover: limestone city walls and gates across Judean hills, dense flat-roofed homes, and the broad pale Second Temple platform as the distant architectural focus; historically pre-70 CE."],
  [713, "A moonlit olive grove on rocky ground with massive old gnarled trunks, silver leaves, deep blue shadows, and distant first-century Jerusalem lamps across the valley; no building in the garden."],
  [714, "An empty westward dirt road through rolling limestone hills, grain fields, scattered olives, and long amber evening light; three subtle sets of footprints but no visible people or building."],
]);

function actorPrompt(card, actor) {
  const isSupplicant = card.role === "supplicant";
  return [
    `${LORA_TRIGGER}, rough expressive watercolor illustration on paper.`,
    "Use case: historical-scene",
    `Asset type: CosyWorld collectible portrait art, ${ASPECT_RATIOS[card.aspect]} image`,
    `Primary request: Paint a respectful portrait of ${card.display_name}, ${card.title}.`,
    `Subject: ${sentence(actor.description)}`,
    `Visual identity: ${ACTOR_VISUAL_NOTES.get(actor.id) || "A distinct first-century traveler with humble regional clothing."}`,
    "Historical setting: first-century Galilee, Samaria, or Judea; Levantine Jewish or regional appearance as appropriate; sun-browned olive skin, dark hair, historically plausible simple woven linen and wool garments, leather sandals; no medieval, Renaissance, or modern costume.",
    isSupplicant
      ? "Identity: an unnamed composite traveler, visually distinct but not a recognizable named Gospel figure; humble everyday clothing and an open, human expression."
      : "Composition: single person, three-quarter or full-body portrait, visible face and hands, dignified natural posture, subtle location atmosphere, the person fills about 70 percent of the frame.",
    "Style/medium: unfinished, blotchy traditional watercolor sketchbook study, not polished digital art: broad broken washes, ragged dry-brush edges, large white paper gaps, edges dissolving into raw cold-pressed cotton paper, heavy pigment granulation, uneven pooling, backruns and cauliflower blooms, salt texture, loose searching pencil construction lines, sparse selective detail, imperfect handmade marks; muted lapis, olive green, ochre, umber, and pomegranate accents. Keep fabric and skin painterly and simplified, never smooth or airbrushed.",
    "Mood: compassionate, contemplative, historically grounded, intimate rather than monumental.",
    "Period constraint: depict the Gospel narrative's first-century setting before later Christian art traditions; no cross, crucifix, cross-shaped staff, cross pendant, church, icon, or later saint attribute.",
    "Constraints: one main person only; completely bare natural forehead with uninterrupted skin, no halo, no glowing aura, no crown, no forehead mark, no tilak, no bindi, no facial paint, no Europeanized pale complexion, no anachronistic architecture or clothing, no photorealism, no cinematic photograph, no 3D render, no glossy digital skin, no readable text, no letters, no numbers, no symbols used as labels, no watermark, no logo, no UI, no card border.",
  ].join("\n");
}

function locationPrompt(card, location) {
  return [
    `${LORA_TRIGGER}, rough expressive watercolor landscape on paper.`,
    "Use case: historical-scene",
    `Asset type: CosyWorld wide location card art, ${ASPECT_RATIOS[card.aspect]} image`,
    `Primary request: Paint an establishing landscape for ${card.display_name}, ${card.title}.`,
    `Scene: ${sentence(location.description)}`,
    `Terrain: ${sentence((location.terrain || []).join(", "))}. Biome: ${sentence(location.biome)}.`,
    `Visual identity: ${LOCATION_VISUAL_NOTES.get(location.id) || "A modest first-century regional landscape with no later monument."}`,
    `Mood/persona: ${sentence(location.persona)}`,
    "Historical setting: first-century Galilee, Samaria, or Judea as appropriate; modest stone, mud-plaster, timber, reed, cloth, pottery, fishing, farming, roads, and vegetation suited to the named place; avoid modern reconstructions and later monumental church architecture.",
    "Style/medium: unfinished, blotchy traditional watercolor travel-sketch, not polished digital art: broad broken washes, ragged dry-brush edges, large white paper gaps, edges dissolving into raw cold-pressed cotton paper, heavy pigment granulation, uneven pooling, backruns and cauliflower blooms, salt texture, loose searching pencil construction lines, sparse selective detail, imperfect handmade marks; muted lapis, olive green, ochre, umber, and pomegranate accents. Keep architecture and terrain painterly and simplified, never smooth or airbrushed.",
    "Composition: wide cinematic establishing view, one strong readable landmark, layered depth, generous atmosphere, environment only.",
    "Period constraint: strictly first-century setting; no church, basilica, chapel, mosque, minaret, dome, golden dome, bell tower, cross, crucifix, modern road, modern city, European village, red tiled roof, glass window, electric light, or later pilgrimage monument.",
    "Constraints: no people, no characters, no crowds, no visible human figure, no creatures as focal subjects, no photorealism, no cinematic photograph, no 3D render, no glossy digital surfaces, no readable text, no letters, no numbers, no watermark, no logo, no UI, no card border.",
  ].join("\n");
}

function buildPrompt(card, actors, locations) {
  if (card.subject_kind === "actor") return actorPrompt(card, actors.get(card.subject_id));
  if (card.subject_kind === "location") return locationPrompt(card, locations.get(card.subject_id));
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

function replicateInput(card, prompt, options) {
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
  const destination = path.join(OUTPUT_DIR, `${card.card_id}.webp`);
  const imageUrl = `${IMAGE_URL_PREFIX}/${card.card_id}.webp`;
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
  await fs.mkdir(OUTPUT_DIR, { recursive: true });
  console.log(`${options.dryRun ? "Preparing" : "Generating"} ${selected.length} Holy Land image(s) with ${model}.`);

  for (let index = 0; index < selected.length; index += 1) {
    const card = selected[index];
    const prompt = buildPrompt(card, actors, locations);
    console.log(`[${index + 1}/${selected.length}] ${card.card_id} (${card.aspect})`);
    const entry = await generateCard(replicate, model, card, prompt, options);
    if (!options.dryRun) await persistResult(cards, entry, model);
  }
  console.log(options.dryRun ? "Holy Land art dry run complete." : "Holy Land art generation complete.");
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
