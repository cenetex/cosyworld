import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { chromium } from "playwright";
import { orchestratorBinary } from "./cargo-target.mjs";
import { clearSelection, holdItem, revealCard, selectCard, readyActionButton, settleHand } from "./card-browser-helpers.mjs";
import { createWorld, encodeSave, legalActions, play, seedRun } from "../card-game/world.mjs";
import { enableMotives } from "../card-game/motives.mjs";
import { actionCaption } from "../card-game/beats.mjs";

const key = process.env.OPENROUTER_API_KEY;
const model = process.env.COSYWORLD_PORTFOLIO_MODEL;
assert(key && model, "Set OPENROUTER_API_KEY and COSYWORLD_PORTFOLIO_MODEL explicitly");
const output = resolve(process.env.COSYWORLD_PORTFOLIO_OUTPUT || join("output/portfolio-demo", new Date().toISOString().replace(/[:.]/g, "-")));
await mkdir(resolve(output, ".."), { recursive: true });
await mkdir(output);
const dir = await mkdtemp(join(tmpdir(), "cosyworld-portfolio-"));
const port = Number(process.env.COSYWORLD_PORTFOLIO_PORT || 4188);
const origin = "http://localhost:" + port;
const dbPath = join(dir, "events.sqlite");
const binary = resolve(process.env.COSYWORLD_SHARED_BINARY || orchestratorBinary());
const evidence = { commit: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(), status: "incomplete", source: "live OpenRouter; seeded starting position only", model, viewport: [1440, 900], files: [], checks: {} };
const replies = [];
const errors = [];
let child, browser, log = "", relay;
const delay = ms => new Promise(r => setTimeout(r, ms));
async function until(fn, label, timeout = 90000) {
  const end = Date.now() + timeout;
  let last;
  while (Date.now() < end) {
    try { if (await fn()) return; } catch (e) { last = e.message; }
    await delay(350);
  }
  throw new Error("Timed out: " + label + (last ? " (" + last + ")" : ""));
}
// A transparent, loopback-only relay. No fixture responses, prompt logging or
// provider credentials in browser artifacts. Refuse any other upstream route.
function liveRelay() {
  return createServer(async (req, res) => {
    try {
      if (req.method !== "POST" || req.url !== "/v1/chat/completions") {
        res.writeHead(404).end();
        return;
      }
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      const body = Buffer.concat(chunks);
      const input = JSON.parse(body);
      assert(!input.stream, "Expected non-streaming dialogue");
      const started = Date.now();
      const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        headers: { Authorization: "Bearer " + key, "Content-Type": "application/json", "HTTP-Referer": "https://lonelyforest.com", "X-Title": "CosyWorld portfolio capture" },
        body,
        signal: AbortSignal.timeout(50000),
        redirect: "error",
      });
      const bytes = Buffer.from(await response.arrayBuffer());
      if (response.ok) {
        const result = JSON.parse(bytes);
        for (const choice of result.choices || []) {
          const text = choice.message?.content;
          if (typeof text === "string" && result.id && result.model)
            replies.push({ started, id: result.id, model: result.model, requestedModel: input.model, text });
        }
      }
      res.writeHead(response.status, { "Content-Type": response.headers.get("content-type") || "application/json" });
      res.end(bytes);
    } catch {
      res.writeHead(502, { "Content-Type": "application/json" }).end('{"error":"live provider unavailable"}');
    }
  });
}
function start() {
  const env = Object.fromEntries(Object.entries(process.env).filter(([name]) => !/^(COSYWORLD_|OPENROUTER_|OPENAI_)/u.test(name)));
  Object.assign(env, {
    COSYWORLD_PRIMARY_GAME: "cards",
    COSYWORLD_V2_ADDR: "127.0.0.1:" + port,
    COSYWORLD_V2_EVENT_DB_PATH: dbPath,
    COSYWORLD_V2_SNAPSHOT_PATH: "off",
    COSYWORLD_V2_RESIDENT_CONTINUITY_PATH: join(dir, "residents.json"),
    COSYWORLD_WEBAUTHN_ORIGIN: origin,
    COSYWORLD_WEBAUTHN_RP_ID: "localhost",
    COSYWORLD_DEPLOY_PROFILE: "development",
    COSYWORLD_AI_BASE_URL: "http://127.0.0.1:" + relay.address().port + "/v1",
    COSYWORLD_AI_API_KEY: "portfolio-relay",
    COSYWORLD_AI_MODEL: model,
    COSYWORLD_CARD_TEXT_MODEL: model,
    COSYWORLD_CARD_TEXT_CALL_TIMEOUT_SECS: "35",
    COSYWORLD_CARD_TEXT_SCENE_TIMEOUT_SECS: "50",
  });
  child = spawn(binary, [], { cwd: resolve("v2/orchestrator-rust"), env, stdio: ["ignore", "pipe", "pipe"] });
  child.on("error", e => { log += e.message; });
  child.stdout.on("data", b => { log += b; });
  child.stderr.on("data", b => { log += b; });
}
async function stop() {
  if (!child || child.exitCode !== null || child.signalCode || !child.pid) return;
  const ended = new Promise(r => child.once("exit", r));
  child.kill("SIGTERM");
  const killed = setTimeout(() => child.kill("SIGKILL"), 5000);
  try { await ended; } finally { clearTimeout(killed); }
}
async function ready() {
  await until(async () => {
    assert(child.pid && child.exitCode === null && !child.signalCode, "orchestrator is not running");
    return (await fetch(origin + "/health", { signal: AbortSignal.timeout(2000) })).ok;
  }, "orchestrator health", 30000);
}
let worldId, lastSnapshot = 0;
async function snapshot(page) {
  await delay(Math.max(0, lastSnapshot + 1500 - Date.now()));
  lastSnapshot = Date.now();
  const response = await page.request.get(origin + "/card-game/shared/worlds/" + worldId);
  assert.equal(response.status(), 200);
  return response.json();
}
function journal() {
  const db = new DatabaseSync(dbPath, { readOnly: true });
  try {
    return db.prepare("SELECT seq, command FROM card_full_log ORDER BY seq").all()
      .map(row => ({ seq: row.seq, command: JSON.parse(row.command) }));
  } finally { db.close(); }
}
const viewport = { width: 1440, height: 900 };
async function context(options = {}) {
  const ctx = await browser.newContext({ viewport, ...options });
  await ctx.addInitScript(() => {
    localStorage.setItem("cosyworld.room-music", JSON.stringify({ enabled: false }));
    localStorage.setItem("cosyworld.dialogue.sound", "off");
  });
  return ctx;
}
async function newPage(ctx) {
  const page = await ctx.newPage();
  page.setDefaultTimeout(20000);
  page.on("pageerror", error => errors.push(error.message));
  return page;
}
async function render(page) {
  await page.locator("#stage").waitFor();
  await page.locator("#hand .card").first().waitFor({ state: "attached" });
  await page.waitForFunction(() => {
    const image = document.querySelector("#backdrop");
    return image?.complete && image.naturalWidth > 0;
  });
  await page.evaluate(() => document.fonts.ready);
  await page.waitForFunction(() => [...document.querySelectorAll('#cast .portrait[aria-hidden="false"] img, #hand img')].filter(img => img.getBoundingClientRect().width > 0).every(img => img.complete && img.naturalWidth > 0));
}
async function shot(page, file) {
  await page.screenshot({ path: join(output, file) });
  evidence.files.push(file);
}
async function wake(page) {
  for (const id of ["vale", "pond", "bell"]) {
    const card = page.locator('#hand [data-card="' + id + '"]');
    if (await card.count() && await card.getAttribute("data-unrevealed") === "true")
      await revealCard(page, id);
  }
  await clearSelection(page);
  await settleHand(page);
}
async function front(page, predicate, backwards = false) {
  await until(async () => {
    const state = await page.evaluate(() => ({
      kind: document.querySelector("#speech-row").dataset.beat,
      text: document.querySelector("#dialogue-text").textContent.trim(),
      caption: document.querySelector("#beat-captions").textContent.trim(),
      revealing: document.querySelector("#dialogue-advance").dataset.revealing === "true" || Boolean(document.querySelector("#beat-captions .inscribe")),
    }));
    if (predicate(state) && !state.revealing) return true;
    const next = page.locator(backwards ? "#beat-behind" : "#dialogue-advance");
    if (await next.isVisible()) await next.click(backwards ? { position: { x: 80, y: 6 } } : {});
    return false;
  }, "requested beat on screen");
}
const normalized = text => text.replace(/\s+/gu, " ").trim();

try {
  // Check that our chosen port is unused before starting a fresh server.
  const probe = createServer();
  await new Promise((r, reject) => { probe.once("error", reject); probe.listen(port, "127.0.0.1", r); });
  await new Promise(r => probe.close(r));
  relay = liveRelay();
  await new Promise(r => relay.listen(0, "127.0.0.1", r));
  start();
  await ready();
  browser = await chromium.launch({ headless: true });

  let seed = enableMotives(createWorld({ opening: true }));
  seed = holdItem(seed, null);
  const crossing = legalActions(seed).find(a => a.kind === "move" && a.target === "pond");
  assert(crossing);
  const crossed = play(seed, crossing);
  assert(crossed.ok);
  seed = holdItem(crossed.state, "lamp");
  seed.items.bell.holder = "vale";
  seedRun(seed, 3160098175);
  const save = encodeSave(seed);
  const setup = await context();
  await setup.addInitScript(({ save, seen }) => {
    const key = "cosyworld.reflected-shore.v1";
    if (!localStorage.getItem(key)) {
      localStorage.setItem(key, save);
      localStorage.setItem(key + ".seen", JSON.stringify(seen));
    }
  }, { save, seen: [...Object.keys(seed.actors), ...Object.keys(seed.items), "attic", "pond", "station"] });
  const initial = await newPage(setup);
  const cdp = await setup.newCDPSession(initial);
  await cdp.send("WebAuthn.enable");
  await cdp.send("WebAuthn.addVirtualAuthenticator", { options: { protocol: "ctap2", transport: "internal", hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true } });
  await initial.goto(origin);
  assert((await initial.evaluate(async () => (await import("/card-game/shared-auth.mjs")).passkey(true))).authenticated);
  await initial.reload();
  await initial.locator("#toolbar-menu-button").click();
  await initial.locator("#shared-worlds-button").click();
  await initial.getByRole("button", { name: "Share this world", exact: true }).click();
  await until(() => Boolean(new URL(initial.url()).searchParams.get("world")), "share world");
  worldId = new URL(initial.url()).searchParams.get("world");
  const sharedUrl = initial.url();
  const auth = await setup.storageState();
  await setup.close();

  const recording = await context({ storageState: auth, recordVideo: { dir, size: viewport } });
  const page = await newPage(recording);
  const video = page.video();
  await page.goto(sharedUrl);
  await render(page);
  await wake(page);
  const before = await snapshot(page);
  assert.equal(before.actor, "vale");
  assert.equal(before.world.actors.vale.place, "pond");
  assert.equal(before.world.items.bell.holder, "vale");
  evidence.world = worldId;
  evidence.before = { turn: before.world.turn, revision: before.world.revision, bellHolder: "vale" };
  await shot(page, "01-table.png");
  const startSeq = journal().at(-1).seq;
  await selectCard(page, "bell");
  await selectCard(page, "pond");
  const button = readyActionButton(page, "drop");
  await button.waitFor();
  await shot(page, "02-card-selected.png");
  const started = Date.now();
  const submitted = page.waitForRequest(req => req.url().endsWith("/command") && req.method() === "POST" && req.postDataJSON()?.op === "play");
  await button.click();
  const command = (await submitted).postDataJSON();
  assert(command.key);
  assert.equal(command.action.kind, "drop");
  assert.equal(command.action.item, "bell");
  let after, scene, event;
  await until(async () => {
    after = await snapshot(page);
    event = after.world.log.find(e => e.seq > before.world.eventSeq && e.kind === "action" && !e.generated && e.actorId === "vale" && e.verb === "drop" && e.itemId === "bell");
    return event && after.world.items.bell.holder === "pond";
  }, "the authoritative bell drop");
  assert(after.world.turn > before.world.turn);
  const caption = actionCaption(event, { viewer: "vale", here: "pond" });
  assert(caption?.text);
  const isAction = state => state.kind === "action" && state.caption.includes(caption.text);
  try {
    await page.waitForFunction(text => {
      const row = document.querySelector("#speech-row");
      const captions = document.querySelector("#beat-captions");
      return row.dataset.beat === "action" && captions.textContent.includes(text) && !captions.querySelector(".inscribe");
    }, caption.text, { timeout: 12000 });
  } catch {
    // If the client has already advanced to speech, use its real beat stack.
    await front(page, isAction, true);
  }
  await shot(page, "03-world-message.png");
  await until(async () => {
    after = await snapshot(page);
    scene = after.history.find(entry => entry.play === command.key);
    return scene && !after.queue.some(q => q.id === command.key);
  }, "the server completes the selected play");
  assert.equal(after.world.items.bell.holder, "pond");
  const rows = journal().filter(row => row.seq > startSeq);
  const played = rows.find(row => row.command.op === "play");
  const spoken = rows.find(row => row.command.op === "speech" && row.seq > played?.seq);
  assert(played && spoken, "journal must commit play before speech");
  const line = scene.lines.find(l => l.generated === true && l.kind === "dialogue" && l.actorId === "vale" && l.turn === event.turn && l.seq > event.seq && normalized(l.text).length > 3);
  assert(line, "No real character line for this play; do not publish");
  const upstream = replies.find(r => r.started >= started && normalized(r.text).includes(normalized(line.text)));
  assert(upstream, "published line must match an actual upstream completion");
  evidence.checks = { cardPlayed: true, worldMessage: true, journalPlayBeforeSpeech: true, liveProviderMatch: true };
  evidence.play = { key: command.key, rules: after.version, event, caption: caption.text, line, journalPlaySeq: played.seq, journalSpeechSeq: spoken.seq, provider: { id: upstream.id, model: upstream.model, requestedModel: upstream.requestedModel } };

  await front(page, s => s.kind === "speech" && s.text === line.text);
  await shot(page, "04-generated-speech.png");
  await delay(1000);
  await recording.close();
  await video.saveAs(join(output, "play.webm"));
  evidence.files.push("play.webm");

  // The SQLite journal is the only world store across the process restart.
  await stop();
  start();
  await ready();
  const fresh = await context({ storageState: { cookies: auth.cookies, origins: [] } });
  const restoredPage = await newPage(fresh);
  await restoredPage.goto(sharedUrl);
  const restored = await snapshot(restoredPage);
  assert.equal(restored.world.items.bell.holder, "pond");
  assert.equal(restored.world.turn, after.world.turn);
  assert(restored.world.log.some(e => e.seq === event.seq && e.text === event.text));
  assert.deepEqual(restored.history.find(e => e.play === command.key)?.lines, scene.lines);
  evidence.checks.restartWithFreshBrowser = true;
  evidence.restored = { turn: restored.world.turn, revision: restored.world.revision, bellHolder: restored.world.items.bell.holder };
  await render(restoredPage);
  await wake(restoredPage);
  await shot(restoredPage, "05-shared-world.png");
  await fresh.close();
  assert.deepEqual(errors, []);
  evidence.status = "passed";
} catch (error) {
  evidence.status = "failed";
  evidence.error = error.message;
  console.error("Capture failed:", error.message);
  process.exitCode = 1;
} finally {
  if (browser) await browser.close();
  await stop();
  if (relay) await new Promise(r => relay.close(r));
  await writeFile(join(output, "evidence.json"), JSON.stringify(evidence, null, 2) + "\n");
  console.log("Capture:", evidence.status, output, "SQLite:", dbPath);
  if (evidence.status !== "passed") console.error("Isolated server output bytes:", log.length);
}
