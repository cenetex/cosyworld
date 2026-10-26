import assert from "node:assert/strict";
import { mkdtemp, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { chromium } from "playwright";
import {
  createWorld,
  encodeSave,
  legalActions,
  play,
} from "../card-game/world.mjs";
import { enableMotives } from "../card-game/motives.mjs";

const dir = await mkdtemp(join(tmpdir(), "shared-full-world-smoke-"));
const output = resolve("output/shared-cards");
await mkdir(output, { recursive: true });
const requests = [];
let holdReplies = false;
const waitingReplies = [];
const provider = createServer(async (req, res) => {
  let body = "";
  for await (const chunk of req) body += chunk;
  const input = JSON.parse(body || "{}");
  requests.push(input);
  if (holdReplies) await new Promise((resolve) => waitingReplies.push(resolve));
  const scene = JSON.parse(input.messages.at(-1).content);
  const content = JSON.stringify({
    entries: scene.requested_ids.map((id, index) => ({
      id,
      text: index
        ? "A ripple reaches the shore."
        : "There is room for a little company.",
    })),
  });
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(
    JSON.stringify({
      model: input.model,
      choices: [{ message: { content }, finish_reason: "stop" }],
      usage: { prompt_tokens: 10, completion_tokens: 20 },
    }),
  );
});
await new Promise((resolve) => provider.listen(0, "127.0.0.1", resolve));
const port = Number(process.env.COSYWORLD_SHARED_SMOKE_PORT || 4183);
const origin = `http://localhost:${port}`;
const env = {
  ...process.env,
  COSYWORLD_PRIMARY_GAME: "cards",
  COSYWORLD_V2_ADDR: `127.0.0.1:${port}`,
  COSYWORLD_V2_EVENT_DB_PATH: join(dir, "events.sqlite"),
  COSYWORLD_V2_SNAPSHOT_PATH: "off",
  COSYWORLD_V2_RESIDENT_CONTINUITY_PATH: join(dir, "residents.json"),
  COSYWORLD_WEBAUTHN_ORIGIN: origin,
  COSYWORLD_WEBAUTHN_RP_ID: "localhost",
  COSYWORLD_DEPLOY_PROFILE: "development",
  COSYWORLD_AI_BASE_URL: `http://127.0.0.1:${provider.address().port}/v1`,
  COSYWORLD_AI_API_KEY: "local-fixture",
  COSYWORLD_AI_MODEL: "openai/gpt-4.1-mini",
  COSYWORLD_CARD_TEXT_MODEL: "openai/gpt-4.1-mini",
};
for (const key of [
  "OPENROUTER_API_KEY",
  "OPENAI_API_KEY",
  "COSYWORLD_AI_REGISTRY_JSON",
  "COSYWORLD_CARD_CHARACTER_MODELS_JSON",
])
  delete env[key];
let processLog = "",
  child,
  browser;
function start() {
  child = spawn(
    process.env.COSYWORLD_SHARED_BINARY ||
      process.env.COSYWORLD_SMOKE_BINARY ||
      resolve("v2/orchestrator-rust/target/debug/cosyworld-orchestrator"),
    [],
    {
      cwd: resolve("v2/orchestrator-rust"),
      env,
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  child.stdout.on("data", (data) => {
    processLog += data;
  });
  child.stderr.on("data", (data) => {
    processLog += data;
  });
}
async function stop() {
  if (!child || child.exitCode !== null) return;
  const ended = new Promise((resolve) => child.once("exit", resolve));
  child.kill("SIGTERM");
  await ended;
}
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function until(test, label, rounds = 200) {
  for (let n = 0; n < rounds; n++) {
    try {
      if (await test()) return;
    } catch {}
    await delay(250);
  }
  throw new Error(`Timed out: ${label}\n${processLog.slice(-3000)}`);
}
const ready = () =>
  until(async () => (await fetch(origin + "/health")).ok, "server starts");
const names = ["vale", "mara", "ash", "nell", "tavi", "rue", "orin", "ada"];
let seed = enableMotives(createWorld({ opening: true }), {
  questPrograms: true,
  personalQuests: true,
});
for (const kind of ["light", "move"]) {
  const action = legalActions(seed).find(
    (a) => a.kind === kind && (kind !== "move" || a.target === "pond"),
  );
  assert(action, "the existing opening reaches its original pond");
  const result = play(seed, action);
  assert(result.ok);
  seed = result.state;
}
const initialSave = encodeSave(seed);
const seen = [
  ...Object.keys(seed.actors),
  ...Object.keys(seed.items),
  "attic",
  "pond",
  "station",
];
let worldId;
const api = (page, body) =>
  page.evaluate(
    async ({ worldId, body }) => {
      const response = await fetch(
        `/card-game/shared/worlds/${worldId}${body ? "/command" : ""}`,
        body
          ? {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(body),
            }
          : {},
      );
      return { status: response.status, body: await response.json() };
    },
    { worldId, body },
  );
const snapshot = async (page) => (await api(page)).body;
const idle = (page) =>
  until(
    async () =>
      !(await snapshot(page)).queue.some(
        (q) => q.actor === names[pages.indexOf(page)],
      ),
    "player's queued play finishes",
  );
const pages = [],
  errors = [];
async function actionFor(page, kind, target = undefined, item = undefined) {
  const state = await snapshot(page);
  const actions = legalActions({ ...state.world, playerActorId: state.actor });
  return actions.find(
    (a) =>
      a.kind === kind &&
      (target === undefined || a.target === target) &&
      (item === undefined || a.item === item),
  );
}
async function perform(page, kind, target = undefined, item = undefined) {
  const action = await actionFor(page, kind, target, item);
  assert(action, `available ${kind} ${target || ""} ${item || ""}`);
  const result = await api(page, {
    op: "play",
    key: crypto.randomUUID(),
    action,
  });
  assert.equal(result.status, 200, JSON.stringify(result.body));
  await idle(page);
  return snapshot(page);
}
async function dismissDiscoveries(page) {
  for (let n = 0; n < 50; n++) {
    const take = page.locator("#unveil-take");
    if (!(await take.isVisible())) break;
    await take.click();
    await delay(180);
  }
}
try {
  start();
  await ready();
  browser = await chromium.launch({ headless: true });
  for (let i = 0; i < 8; i++) {
    const context = await browser.newContext({
      viewport:
        i === 1 ? { width: 390, height: 844 } : { width: 1440, height: 900 },
    });
    if (i === 0)
      await context.addInitScript(
        ({ initialSave, seen }) => {
          const key = "cosyworld.reflected-shore.v1";
          if (!localStorage.getItem(key)) {
            localStorage.setItem(key, initialSave);
            localStorage.setItem(key + ".seen", JSON.stringify(seen));
          }
        },
        { initialSave, seen },
      );
    const page = await context.newPage();
    page.setDefaultTimeout(20000);
    pages.push(page);
    page.on("pageerror", (error) => errors.push(error.message));
    const cdp = await context.newCDPSession(page);
    await cdp.send("WebAuthn.enable");
    await cdp.send("WebAuthn.addVirtualAuthenticator", {
      options: {
        protocol: "ctap2",
        transport: "internal",
        hasResidentKey: true,
        hasUserVerification: true,
        isUserVerified: true,
        automaticPresenceSimulation: true,
      },
    });
    await page.goto(origin);
    await page.evaluate(async () =>
      (await import("/card-game/shared-auth.mjs")).passkey(true),
    );
  }
  const [vale, mara, ash, nell, tavi] = pages;
  await vale.reload();
  await dismissDiscoveries(vale);
  await vale.locator("#shared-worlds-button").click();
  await vale
    .getByRole("button", { name: "Share this world", exact: true })
    .click();
  await until(
    async () => Boolean(new URL(vale.url()).searchParams.get("world")),
    "share keeps the current game",
  );
  worldId = new URL(vale.url()).searchParams.get("world");
  const shared = await snapshot(vale);
  assert.equal(shared.actor, "vale");
  assert.equal(shared.world.turn, seed.turn);
  assert.equal(shared.world.actors.vale.place, "pond");
  assert.deepEqual(shared.world.items.lamp, seed.items.lamp);
  assert.deepEqual(
    shared.world.actors.vale.progress,
    seed.actors.vale.progress,
  );
  assert.deepEqual(shared.world.life.actors.vale, seed.life.actors.vale);
  assert.deepEqual(shared.world.memories.vale, seed.memories.vale);
  assert.deepEqual(shared.world.opening, seed.opening);
  assert.deepEqual(shared.world.log.slice(0, seed.log.length), seed.log);
  assert(
    shared.world.actors.moth &&
      shared.world.actors.keeper &&
      shared.world.actors.badger,
  );
  assert(
    shared.world.actors["greek-antigone"] &&
      shared.world.items["greek-water-jar"],
  );
  for (const [id, pack] of Object.entries(seed.packs))
    assert.deepEqual(shared.world.packs[id], pack);
  await vale.locator("#stage").waitFor({ state: "visible" });
  assert.match(
    await vale.locator("#backdrop").getAttribute("src"),
    /(?:^|\/)assets\/pond\.png$/,
  );
  assert(
    await vale.locator('#hand [data-card="moth"]').count(),
    "Pip stays in the existing pond hand",
  );
  assert(
    await vale.locator('#hand [data-card="station"]').count(),
    "the original station remains connected",
  );
  await dismissDiscoveries(vale);
  const requestStart = requests.length;
  await vale.locator('#hand [data-card="moth"]').click();
  await vale.getByRole("button", { name: "Talk", exact: true }).click();
  await until(async () => (await snapshot(vale)).world.turn > seed.turn, "the original Talk button submits a shared play");
  await idle(vale);
  assert(requests.length > requestStart, "the shared NPC conversation reaches the provider");
  assert.deepEqual((await snapshot(vale)).history[0].lines.map((line) => line.actorId), ["vale", "moth"]);
  for (let i = 1; i < 8; i++) {
    await pages[i].goto(`${origin}/?world=${worldId}`);
    await pages[i].locator(`.shared-choice[data-avatar="${names[i]}"]`).click();
    await pages[i].locator("#stage").waitFor({ state: "visible" });
    assert.equal((await snapshot(pages[i])).actor, names[i]);
  }
  assert.equal((await snapshot(vale)).claimed.filter(Boolean).length, 8);
  await perform(mara, "move", "pond");
  await perform(mara, "move", "attic");
  assert.equal(
    (await snapshot(mara)).world.actors.mara.place,
    "attic",
    "a friend uses the existing mirror route",
  );
  await perform(mara, "move", "pond");
  for (const page of [ash, nell]) await perform(page, "move", "pond");
  assert(
    !(await actionFor(tavi, "move", "pond")),
    "full room hides the route while NPCs still fit",
  );
  await until(
    async () => !(await tavi.locator('#hand [data-card="pond"]').count()),
    "full pond card disappears",
  );
  assert(
    (await snapshot(vale)).world.actors.moth,
    "original NPC remains part of shared world",
  );
  const beforeForgery = (await snapshot(vale)).world.revision;
  const forged = { ...(await actionFor(vale, "wait")), actor: "mara" };
  assert.equal(
    (await api(vale, { op: "play", key: crypto.randomUUID(), action: forged }))
      .status,
    409,
  );
  assert.equal((await snapshot(vale)).world.revision, beforeForgery);
  holdReplies = true;
  const queued = [];
  for (const page of [vale, mara, ash, nell]) {
    const command = {
      op: "play",
      key: crypto.randomUUID(),
      action: await actionFor(page, "wait"),
    };
    assert.equal((await api(page, command)).status, 200);
    queued.push(command);
  }
  await until(() => waitingReplies.length > 0, "first queued speech starts");
  assert.equal((await snapshot(vale)).queue.length, 4);
  assert.equal(
    (await api(vale, { ...queued[0], key: crypto.randomUUID() })).status,
    409,
  );
  assert.equal(
    (await api(vale, queued[0])).status,
    200,
    "repeated play key is idempotent",
  );
  assert.equal(
    (await api(ash, { op: "cancel", key: queued[2].key })).status,
    200,
  );
  assert.equal((await snapshot(vale)).queue.length, 3);
  holdReplies = false;
  for (const resolve of waitingReplies.splice(0)) resolve();
  await Promise.all([vale, mara, nell].map(idle));
  const first = await snapshot(vale),
    other = await snapshot(mara);
  assert.equal(first.history[0].lines.length, 2);
  assert.deepEqual(
    first.history[0],
    other.history[0],
    "people in the room receive one shared exchange",
  );
  await until(async () => (await vale.locator("#dialogue-text").textContent()).includes("A ripple reaches the shore."), "the shared room detail stays visible");
  assert.equal((await api(vale, { op: "nudge", target: "mara" })).status, 200);
  await until(
    async () => (await snapshot(mara)).nudge === "vale",
    "nudge reaches friend",
  );
  await perform(vale, "drop", "pond", "lamp");
  await perform(mara, "take", undefined, "lamp");
  assert.equal((await snapshot(vale)).world.items.lamp.holder, "mara");
  await perform(mara, "move", "station");
  assert.equal((await snapshot(mara)).world.actors.mara.place, "station");
  assert.match(
    await mara.locator("#backdrop").getAttribute("src"),
    /(?:^|\/)assets\/station\.png$/,
  );
  await perform(tavi, "move", "pond");
  const saved = await snapshot(vale);
  await stop();
  start();
  await ready();
  await vale.reload();
  await until(
    async () => (await snapshot(vale)).world.revision === saved.world.revision,
    "restart restores shared world",
  );
  const restored = await snapshot(vale);
  assert.equal(restored.actor, "vale");
  assert.deepEqual(restored.world.items, saved.world.items);
  assert.deepEqual(
    restored.world.actors.vale.progress,
    saved.world.actors.vale.progress,
  );
  assert.deepEqual(
    restored.world.actors.mara.progress,
    saved.world.actors.mara.progress,
  );
  assert.deepEqual(restored.history, saved.history);
  assert.equal(
    await vale.evaluate(() =>
      localStorage.getItem("cosyworld.reflected-shore.v1"),
    ),
    initialSave,
    "the source browser save remains available",
  );
  for (const [i, page] of [vale, mara].entries()) {
    await dismissDiscoveries(page);
    await page.screenshot({
      path: join(output, `same-world-${i ? "phone" : "desktop"}.png`),
      fullPage: true,
    });
  }
  assert.deepEqual(errors, []);
  console.log(
    "Shared original world: progressed save, eight passkeys, original pond/station/attic, NPCs, packs, quests, room capacity, shared speech, item handoff, nudge, restart, desktop and phone passed.",
  );
} finally {
  holdReplies = false;
  for (const resolve of waitingReplies.splice(0)) resolve();
  if (browser) await browser.close();
  await stop();
  await new Promise((resolve) => provider.close(resolve));
}
