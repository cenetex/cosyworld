import assert from "node:assert/strict";
import {
  clearSelection,
  revealCard,
  selectCard,
} from "./card-browser-helpers.mjs";
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
import { humanAvatars } from "../card-game/human-cast.mjs";
import { currentScene } from "../card-game/scene.mjs";

const dir = await mkdtemp(join(tmpdir(), "shared-full-world-smoke-"));
const output = resolve("output/shared-cards");
await mkdir(output, { recursive: true });
const requests = [];
const syncReplies = [];
const replies = new Map();
const providerTiming = new Map();
let holdReplies = false;
let failReplies = false;
const waitingReplies = [];
const provider = createServer(async (req, res) => {
  let body = "";
  for await (const chunk of req) body += chunk;
  const input = JSON.parse(body || "{}");
  requests.push(input);
  const timing = {
    speaker: input.messages.at(-1).content.trim().split("\n").at(-1),
    started: Date.now(),
    held: holdReplies,
  };
  providerTiming.set(input, timing);
  res.on("close", () => {
    timing.closed = Date.now();
    timing.finished = res.writableFinished;
  });
  if (holdReplies) await new Promise((resolve) => waitingReplies.push(resolve));
  if (failReplies) {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        model: input.model,
        choices: [{ message: { content: "" }, finish_reason: "stop" }],
      }),
    );
    return;
  }
  const transcript = input.messages.at(-1).content;
  assert.equal(typeof transcript, "string");
  assert.match(transcript, /Current scene:/u);
  assert.match(transcript.trim(), /:$/u);
  timing.replied = Date.now();
  // A recorded fact the speaker owes (for example, telling a resident what
  // it wants) must be voiced in its own words; the validator checks it.
  const fact = input.messages
    .map((message) => message.content)
    .join("\n")
    .match(/using these words: (.+?) I may add one short sentence/su)?.[1];
  const content = `${fact ? `${fact} ` : ""}I pause for ${requests.length} quiet breaths.`;
  replies.set(input, content);
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
  // Queue inspection deliberately holds the provider while both layouts are checked.
  // Keep that fixture budget below the shared worker's 60-second reservation.
  COSYWORLD_CARD_TEXT_CALL_TIMEOUT_SECS: "45",
  COSYWORLD_CARD_TEXT_SCENE_TIMEOUT_SECS: "50",
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
function serverDiagnostics() {
  const warnings = processLog
    .split("\n")
    .filter((line) =>
      /\b(?:WARN|ERROR)\b|Exception|shared card publication failed/u.test(line),
    )
    .slice(-20)
    .join("\n");
  return [warnings, processLog.slice(-3000)].filter(Boolean).join("\n");
}
async function until(test, label, rounds = 200, interval = 250) {
  for (let n = 0; n < rounds; n++) {
    try {
      if (await test()) return;
    } catch {}
    await delay(interval);
  }
  throw new Error(`Timed out: ${label}\n${serverDiagnostics()}`);
}
const ready = () =>
  until(async () => (await fetch(origin + "/health")).ok, "server starts");
async function expectStage(page, recent) {
  const state = await snapshot(page);
  const cast = currentScene({
    ...state.world,
    playerActorId: state.actor,
  }).slots.filter(Boolean);
  recent = [...recent, ...cast.filter((actor) => !recent.includes(actor))];
  assert.deepEqual(
    new Set(recent),
    new Set(cast),
    "the expected players share the stage with its current residents",
  );
  await page.waitForFunction((ids) => {
    const cast = document.getElementById("cast");
    const figures = [
      ...cast.querySelectorAll('.portrait[aria-hidden="false"]'),
    ];
    const height = cast.getBoundingClientRect().height;
    return (
      figures.length === ids.length &&
      ids.every((id) =>
        figures.some((figure) => figure.dataset.avatar === id),
      ) &&
      figures.every((figure) => {
        const rank = ids.indexOf(figure.dataset.avatar);
        let scale = Math.sqrt([13, 8, 5, 3, 2, 1][rank] / 13);
        // Phones shrink wide-framed figures (Moth, Keeper) to 74% of their
        // depth, capped at 93vw, so their arms stay inside the scene.
        if (figure.dataset.framing === "wide" && innerWidth <= 700)
          scale = Math.min(scale * 0.74, (innerWidth * 0.93) / height);
        return (
          Math.abs(figure.getBoundingClientRect().height / height - scale) <
          0.01
        );
      })
    );
  }, recent);
  if (page.viewportSize().width < 700) {
    const rows = await page
      .locator('#cast .portrait[aria-hidden="false"]')
      .evaluateAll((figures) =>
        figures.map((figure) => ({
          front: figure.dataset.depth === "foreground",
          top: figure.getBoundingClientRect().top,
        })),
      );
    assert(
      Math.min(...rows.filter((row) => row.front).map((row) => row.top)) >
        Math.max(...rows.filter((row) => !row.front).map((row) => row.top)),
      "the larger busts sit below the smaller figures on phones",
    );
  }
}
const names = ["vale", "mara", "ash", "nell", "tavi", "rue", "orin", "ada"];
let seed = enableMotives(createWorld({ opening: true }));
// The opening starts lit (#1653): douse the lamp to open the mirror, cross to
// the pond, then relight it there so the progressed save carries a lit lamp.
for (const kind of ["snuff", "move", "light"]) {
  const action = legalActions(seed).find(
    (a) => a.kind === kind && (kind !== "move" || a.target === "pond"),
  );
  assert(action, `the attic opening can ${kind} on its way to the pond`);
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
const snapshot = async (page) => {
  const response = await api(page);
  assert.equal(response.status, 200, JSON.stringify(response.body));
  return response.body;
};
const idle = (page) =>
  until(
    async () =>
      !(await snapshot(page)).queue.some(
        (q) => q.actor === names[pages.indexOf(page)],
      ),
    "player's queued play finishes",
    60,
    2000,
  );
const pages = [],
  sessions = [],
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
  const finished = await snapshot(page);
  const recent = finished.history.find(
    (entry) => entry.actor === finished.actor,
  );
  if (kind === "move")
    assert.equal(
      finished.world.actors[finished.actor].place,
      target,
      `${finished.actor} completes the queued move: ${JSON.stringify(recent)}`,
    );
  if (kind === "take")
    assert.equal(
      finished.world.items[item].holder,
      finished.actor,
      `${finished.actor} completes the queued pickup: ${JSON.stringify(recent)}`,
    );
  return finished;
}
async function dismissDiscoveries(page) {
  for (let n = 0; n < 50; n++) {
    const take = page.locator("#unveil-take");
    if (!(await take.isVisible())) break;
    await take.click();
    await delay(180);
  }
}
// A viewer hears the room only once they have uncovered their own avatar
// and the place it stands in (#1575), so a new visitor taps both first.
async function wake(page) {
  const { actor, world } = await snapshot(page);
  for (const id of [actor, world.actors[actor].place])
    await until(async () => {
      const card = page.locator(`#hand [data-card="${id}"]`);
      if (!(await card.count())) return true;
      if ((await card.getAttribute("data-unrevealed")) !== "true") return true;
      await revealCard(page, id);
      return false;
    }, `${actor} uncovers ${id}`);
  await clearSelection(page);
}
async function expectSharedReveal(page, requestStart, speaker = "Vale") {
  let expected;
  await until(() => {
    const human = requests
      .slice(requestStart)
      .find((request) =>
        request.messages.at(-1).content.trim().endsWith(`\n${speaker}:`),
      );
    expected = replies.get(human);
    return typeof expected === "string";
  }, "the selected human receives its plain fixture reply");
  // Observe the actual letter transitions in-page, even when the driver checks later.
  try {
    await page.waitForFunction(
      ({ expected, speaker }) => {
        const samples = window.sharedReveals.filter(
          (sample) =>
            sample.text === expected &&
            sample.speaker === speaker &&
            sample.shown > 0 &&
            sample.shown < sample.total,
        );
        return new Set(samples.map((sample) => sample.shown)).size >= 2;
      },
      { expected, speaker },
    );
  } catch (error) {
    console.error(
      "Shared reveal failure",
      JSON.stringify({
        expected,
        speaker,
        server: serverDiagnostics(),
        observed: await page.evaluate(() => window.sharedReveals),
        history: (await snapshot(page)).history.slice(0, 5),
        provider: requests.slice(requestStart).map((request) => ({
          ...providerTiming.get(request),
          reply: replies.get(request),
        })),
      }),
    );
    throw error;
  }
  return { text: expected, speaker };
}
// Step back through the beat stack, then tap the front card toward live.
async function catchUpWithStack(page) {
  await page.locator("#beat-behind").click({ position: { x: 80, y: 6 } });
  for (let step = 0; step < 200; step++) {
    if (!(await page.locator("#live-line").isVisible())) break;
    await page.locator("#dialogue-advance").click();
  }
  assert.equal(
    await page.locator("#live-line").isVisible(),
    false,
    "the front card steps forward to live",
  );
}
// ● live returns from an earlier beat with the newer count.
async function catchUpWithLive(page) {
  const latest = await page.locator("#dialogue-text").textContent();
  await page.locator("#beat-behind").click({ position: { x: 80, y: 6 } });
  const live = page.getByRole("button", { name: /^Return to live dialogue/ });
  assert(await live.isVisible());
  assert.match(await live.textContent(), /live\s*·\s*\d/u);
  await live.click();
  assert.equal(await live.isVisible(), false);
  assert.equal(await page.locator("#dialogue-text").textContent(), latest);
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
    await context.addInitScript(() => {
      window.sharedSpeechNotes = 0;
      window.sharedReveals = [];
      window.addEventListener("DOMContentLoaded", () => {
        const text = document.getElementById("dialogue-text");
        new MutationObserver(() => {
          const total = text.querySelectorAll(".speech-letter").length;
          const shown = text.querySelectorAll(".speech-letter.revealed").length;
          if (shown > 0 && shown < total) {
            const sample = {
              text: text.textContent,
              speaker: document.getElementById("speaker").textContent.trim(),
              shown,
              total,
            };
            const previous = window.sharedReveals.at(-1);
            if (
              previous?.text !== sample.text ||
              previous?.speaker !== sample.speaker ||
              previous?.shown !== shown
            ) {
              window.sharedReveals.push(sample);
              if (window.sharedReveals.length > 400)
                window.sharedReveals.shift();
            }
          }
        }).observe(text, {
          subtree: true,
          childList: true,
          attributes: true,
          attributeFilter: ["class"],
        });
      });
      const audio = window.AudioContext || window.webkitAudioContext;
      const original = audio.prototype.createOscillator;
      audio.prototype.createOscillator = function (...args) {
        window.sharedSpeechNotes++;
        return original.apply(this, args);
      };
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
    page.on("pageerror", (error) => errors.push(error.stack || error.message));
    page.on("response", async (response) => {
      if (
        !response.url().includes("/card-game/shared/worlds/") ||
        !response.ok()
      )
        return;
      try {
        const value = await response.json();
        if (value.sync) syncReplies.push({ player: i, value });
      } catch {}
    });
    const cdp = await context.newCDPSession(page);
    sessions.push(cdp);
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
  const [vale, mara, ash, nell, tavi, rue] = pages;
  await vale.reload();
  await dismissDiscoveries(vale);
  await vale.locator("#toolbar-menu-button").click();
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
  assert.deepEqual(shared.world.actors.vale.want, seed.actors.vale.want);
  assert.equal(shared.world.actors.vale.xp, seed.actors.vale.xp);
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
  for (const [id, pack] of Object.entries(seed.packs)) {
    // Sharing gives the world a run, so a pack with specials draws them (#1622).
    const sharedPack = { ...shared.world.packs[id] };
    if (!("specials" in pack)) delete sharedPack.specials;
    assert.deepEqual(sharedPack, pack);
  }
  await vale.locator("#stage").waitFor({ state: "visible" });
  const pondBackdrop = await vale.evaluate(async () =>
    (await import("/card-game/images.mjs")).imageUrl("./assets/pond.png"),
  );
  await until(
    async () =>
      (await vale.locator("#backdrop").getAttribute("src")) === pondBackdrop,
    "the original pond finishes rendering",
  );
  assert.equal(
    await vale.locator("#backdrop").getAttribute("src"),
    pondBackdrop,
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
  await wake(vale);
  const requestStart = requests.length;
  await selectCard(vale, "moth");
  await vale.getByRole("button", { name: "Talk", exact: true }).click();
  await expectSharedReveal(vale, requestStart);
  await vale.screenshot({
    path: join(output, "shared-dialogue-reveal.png"),
    fullPage: true,
  });
  // Tapping the front card finishes the line; the room clock owns what
  // comes next, so the reader never skips ahead of the table.
  await vale.locator("#dialogue-advance").click();
  const finishedText = await vale.locator("#dialogue-text").textContent();
  await delay(500);
  assert(
    (await vale.locator("#dialogue-text").textContent()).length >=
      finishedText.length,
    "a tap at live keeps the current beat",
  );
  await until(
    async () => (await snapshot(vale)).world.turn > seed.turn,
    "the original Talk button submits a shared play",
  );
  await idle(vale);
  assert(
    (await vale.evaluate(() => window.sharedSpeechNotes)) > 0,
    "shared speech plays voice syllables as its letters appear",
  );
  assert(
    requests.length > requestStart,
    "the shared NPC conversation reaches the provider",
  );
  assert.deepEqual(
    (await snapshot(vale)).history[0].lines.map((line) => line.actorId),
    ["vale", "moth"],
  );
  await perform(vale, "snuff", undefined, "lamp");
  for (let i = 1; i < 8; i++) {
    await pages[i].goto(`${origin}/?world=${worldId}`);
    await pages[i].locator(`.shared-choice[data-avatar="${names[i]}"]`).click();
    await until(
      async () => (await snapshot(pages[i])).actor === names[i],
      "avatar claim finishes",
    );
    await pages[i].locator("#shared-lobby").waitFor({ state: "hidden" });
    await pages[i].locator("#stage").waitFor({ state: "visible" });
    const home = await snapshot(pages[i]);
    const avatar = humanAvatars.find((a) => a.id === names[i]);
    assert.equal(home.actor, names[i]);
    assert.equal(home.world.items[avatar.item.id].holder, avatar.home.id);
    assert(
      !home.exits.includes(avatar.home.connection || "pond"),
      "new avatars start with a closed home path",
    );
  }
  assert.equal((await snapshot(vale)).claimed.filter(Boolean).length, 8);
  const ownAvatarFirst = async (page) => {
    const state = await snapshot(page);
    const ids = await page
      .locator("#hand .card")
      .evaluateAll((cards) => cards.map((card) => card.dataset.card));
    assert.equal(
      ids.find((id) => state.world.actors[id]),
      state.actor,
      "the player's own avatar leads the avatar groups",
    );
  };
  await perform(rue, "take", undefined, "routes");
  assert(await actionFor(rue, "move", "pond"));
  assert(!(await actionFor(rue, "move", "station")));
  const earlierCarriageExit = await actionFor(rue, "move", "pond");
  await perform(rue, "drop", "train", "routes");
  await rue.reload();
  await rue
    .locator('#hand [data-card="routes"]')
    .waitFor({ state: "attached" });
  await dismissDiscoveries(rue);
  assert(!(await actionFor(rue, "move", "pond")));
  assert.equal(
    (
      await api(rue, {
        op: "play",
        key: crypto.randomUUID(),
        action: earlierCarriageExit,
      })
    ).status,
    409,
  );
  await perform(rue, "take", undefined, "routes");
  await perform(rue, "move", "pond");
  assert.equal((await snapshot(rue)).world.actors.rue.place, "pond");
  await ownAvatarFirst(rue);
  await rue.reload();
  await rue.locator('#hand [data-card="rue"]').waitFor();
  await dismissDiscoveries(rue);
  assert(await actionFor(rue, "move", "train"));
  await perform(rue, "move", "train");

  await dismissDiscoveries(mara);
  await mara.locator('#hand [data-card="mask"]').waitFor({ state: "attached" });
  assert.equal(await mara.locator('#hand [data-card="pond"]').count(), 0);
  await until(
    () =>
      mara.locator("#cast > .portrait").evaluateAll(
        (figures) =>
          figures.length > 0 &&
          figures.every((figure) => {
            const image = figure.querySelector("img");
            return (
              image.complete &&
              image.naturalWidth > 0 &&
              Number(getComputedStyle(figure).opacity) >= 0.99
            );
          }),
      ),
    "Mara arrives beside the floor item",
  );
  await mara.screenshot({
    path: join(output, "item-floor-phone.png"),
    fullPage: true,
  });
  await selectCard(mara, "mask");
  await mara.getByRole("button", { name: "Take", exact: true }).click();
  await until(
    async () => (await snapshot(mara)).world.items.mask.holder === "mara",
    "pickup commits",
  );
  await idle(mara);
  // The pond joins the location stack face down (#1780).
  await mara.locator('#hand [data-card="pond"]').waitFor({ state: "attached" });
  const earlierTravel = await actionFor(mara, "move", "pond");
  await selectCard(mara, "mask");
  await selectCard(mara, "theatre");
  await mara.getByRole("button", { name: "Put down", exact: true }).click();
  await until(
    async () => (await snapshot(mara)).world.items.mask.holder === "theatre",
    "put down commits",
  );
  await idle(mara);
  await until(
    async () => !(await mara.locator('#hand [data-card="pond"]').count()),
    "put down closes pond card",
  );
  assert.equal(
    (
      await api(mara, {
        op: "play",
        key: crypto.randomUUID(),
        action: earlierTravel,
      })
    ).status,
    409,
  );
  await mara.reload();
  await mara.locator('#hand [data-card="mask"]').waitFor({ state: "attached" });
  await dismissDiscoveries(mara);
  assert.equal(await mara.locator('#hand [data-card="pond"]').count(), 0);
  await mara.setViewportSize({ width: 1440, height: 900 });
  await mara.screenshot({
    path: join(output, "item-floor-desktop.png"),
    fullPage: true,
  });
  await mara.setViewportSize({ width: 390, height: 844 });
  await perform(mara, "take", undefined, "mask");
  await perform(mara, "move", "pond");
  await ownAvatarFirst(mara);
  // Anyone at the pond may light the lamp Vale carries. On a slow run the
  // keeper can arrive and light it first, so light it only while it is dark.
  await until(async () => {
    const light = await actionFor(vale, "light", undefined, "lamp");
    if (light)
      await api(vale, { op: "play", key: crypto.randomUUID(), action: light });
    await idle(vale);
    return (await snapshot(vale)).world.items.lamp.lit;
  }, "the lamp is lit for the mirror route");
  await perform(mara, "move", "attic");
  assert.equal(
    (await snapshot(mara)).world.actors.mara.place,
    "attic",
    "a friend uses the existing mirror route",
  );
  await perform(mara, "move", "pond");
  for (const page of [ash, nell, tavi]) {
    const avatar = humanAvatars.find(
      (a) => a.id === names[pages.indexOf(page)],
    );
    await perform(page, "take", undefined, avatar.item.id);
    if (page !== tavi) await perform(page, "move", "pond");
  }
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
  for (const page of [vale, mara]) {
    await wake(page);
    await catchUpWithStack(page);
    await catchUpWithLive(page);
  }
  const notesBefore = await Promise.all(
    [vale, mara].map((page) => page.evaluate(() => window.sharedSpeechNotes)),
  );
  const slow = Number(process.env.COSYWORLD_SHARED_CPU_SLOWDOWN || 1);
  const latency = Number(process.env.COSYWORLD_SHARED_NETWORK_LATENCY || 0);
  for (const session of sessions.slice(0, 2)) {
    if (slow > 1)
      await session.send("Emulation.setCPUThrottlingRate", { rate: slow });
    if (latency > 0)
      await session.send("Network.emulateNetworkConditions", {
        offline: false,
        latency,
        downloadThroughput: 5000000,
        uploadThroughput: 5000000,
      });
  }
  const queueRequestStart = requests.length;
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
  // Vale's Wait is committed before its speech, so Vale holds the front of
  // the stage while the later Waits are still queued.
  for (const page of [vale, mara]) {
    await expectStage(page, ["vale", "nell", "ash", "mara"]);
    await page.locator("#shared-queue .shared-play-avatar").nth(3).waitFor();
    assert.equal(await page.locator("#live-line").isVisible(), false);
    assert.equal(
      await page
        .locator("#shared-queue .shared-play-avatar")
        .first()
        .getAttribute("data-actor"),
      "mara",
      "the live portrait is first in the queue",
    );
    await page.locator("#beat-behind").click({ position: { x: 80, y: 6 } });
    const returnLive = page.getByRole("button", {
      name: /^Return to live dialogue/,
    });
    assert.equal(await returnLive.count(), 1);
    await returnLive.click();
    assert.equal(await page.locator("#live-line").isVisible(), false);
    await page.waitForFunction(() =>
      [...document.querySelectorAll("#shared-queue img")].every(
        (image) => image.complete && image.naturalWidth > 0,
      ),
    );
    const layout = await page.evaluate(() => {
      const queue = document.getElementById("shared-queue");
      const text = document
        .getElementById("dialogue-text")
        .getBoundingClientRect();
      return {
        textRight: text.right,
        label: queue.innerText,
        column: document
          .querySelector(".shared-portraits")
          .getBoundingClientRect().left,
        faces: [...queue.querySelectorAll(".shared-play-avatar")].map(
          (face) => {
            const rect = face.getBoundingClientRect();
            return {
              left: rect.left,
              top: rect.top,
              width: rect.width,
              height: rect.height,
              radius: getComputedStyle(face).borderRadius,
            };
          },
        ),
      };
    });
    assert.equal(layout.label.trim(), "", "the queue uses profile pictures");
    assert.equal(layout.faces.length, 4);
    for (const [index, face] of layout.faces.entries()) {
      assert(
        face.left > layout.textRight,
        "queue faces sit to the right of the text",
      );
      assert(
        Math.abs(face.left - layout.column) < 1,
        "every portrait shares one column",
      );
      assert.equal(face.width, 28);
      assert.equal(face.height, 28);
      assert.equal(face.radius, "50%");
      if (index) assert(face.top > layout.faces[index - 1].top);
    }
    await page.screenshot({
      path: join(
        output,
        page === vale ? "shared-queue-desktop.png" : "shared-queue-phone.png",
      ),
      fullPage: true,
    });
    if (page === mara) {
      await page.setViewportSize({ width: 390, height: 640 });
      await expectStage(page, ["vale", "nell", "ash", "mara"]);
      await page.waitForFunction(() => {
        const dialogueTop = document
          .querySelector(".dialogue")
          .getBoundingClientRect().top;
        return [
          ...document.querySelectorAll(
            '#cast .portrait[data-depth="foreground"]',
          ),
        ].every((figure) => {
          const rect = figure.getBoundingClientRect();
          return rect.top + rect.height * 0.25 < dialogueTop;
        });
      });
      await page.screenshot({
        path: join(output, "shared-stage-short-phone.png"),
        fullPage: true,
      });
      await page.setViewportSize({ width: 390, height: 844 });
    }
  }
  assert.equal(
    (await api(vale, { ...queued[0], key: crypto.randomUUID() })).status,
    409,
  );
  assert.equal(
    (await api(vale, queued[0])).status,
    200,
    "repeated play key is idempotent",
  );
  // A portrait can first return a reader to the live exchange. Use its
  // labelled withdraw action once Ash has caught up with the room.
  const ashReturnLive = ash.getByRole("button", {
    name: /^Return to live dialogue/,
  });
  if (await ashReturnLive.count()) await ashReturnLive.click();
  const cancelled = ash.waitForResponse((response) => {
    const request = response.request();
    return (
      request.method() === "POST" &&
      request.url().endsWith("/command") &&
      request.postDataJSON()?.op === "cancel"
    );
  });
  await ash
    .getByRole("button", { name: /^Ash is thinking… · Withdraw your play$/ })
    .click();
  assert.equal((await cancelled).status(), 200);
  await until(
    async () => (await snapshot(vale)).queue.length === 3,
    "a waiting player withdraws through their profile circle",
  );
  await Promise.all(
    [vale, mara].map((page) =>
      page.evaluate(() => {
        window.sharedReveals = [];
      }),
    ),
  );
  await delay(Number(process.env.COSYWORLD_SHARED_PROVIDER_HOLD_MS || 0));
  for (const request of requests.slice(queueRequestStart)) {
    const timing = providerTiming.get(request);
    if (timing.held)
      assert.equal(
        timing.closed,
        undefined,
        `The held fixture reply stays connected: ${JSON.stringify(timing)}`,
      );
  }
  // Keep one reader in a menu while every queued scene reaches the browser.
  // Closing it must reveal Vale, Mara and Iris in order, with partial letters.
  await mara.locator("#toolbar-menu-button").click();
  await mara.locator("#menu-button").click();
  holdReplies = false;
  for (const resolve of waitingReplies.splice(0)) resolve();
  await Promise.all([vale, mara, nell].map(idle));
  await mara.locator('[data-close="menu-dialog"]').click();
  // Check after playback ends: a busy driver still proves each line animated in order.
  for (const page of [vale, mara]) {
    const expected = await Promise.all(
      ["Vale", "Mara", "Iris"].map((speaker) =>
        expectSharedReveal(page, queueRequestStart, speaker),
      ),
    );
    const order = await page.evaluate(
      (expected) => [
        ...new Set(
          window.sharedReveals
            .filter((sample) =>
              expected.some(
                (line) =>
                  line.speaker === sample.speaker && line.text === sample.text,
              ),
            )
            .map((sample) => sample.speaker),
        ),
      ],
      expected,
    );
    assert.deepEqual(
      order,
      ["Vale", "Mara", "Iris"],
      "shared readers see every queued speaker in order",
    );
  }
  for (const page of [vale, mara]) {
    await expectStage(page, ["nell", "mara", "vale", "ash"]);
    await page.screenshot({
      path: join(
        output,
        page === vale ? "shared-stage-desktop.png" : "shared-stage-phone.png",
      ),
      fullPage: true,
    });
  }
  for (const [index, page] of [vale, mara].entries())
    assert(
      (await page.evaluate(() => window.sharedSpeechNotes)) >
        notesBefore[index],
      "the next shared exchange animates and sounds after arrow-only catch-up",
    );
  const first = await snapshot(vale),
    other = await snapshot(mara);
  assert.deepEqual(
    first.history[0].lines.map((line) => line.actorId),
    [first.history[0].actor],
  );
  assert.deepEqual(
    first.history[0],
    other.history[0],
    "people in the room receive one shared exchange",
  );
  await until(
    async () =>
      (await vale.locator("#dialogue-text").textContent()).includes(
        "quiet breaths.",
      ),
    "the shared actor line stays visible",
  );
  assert.equal((await api(vale, { op: "nudge", target: "mara" })).status, 200);
  await until(
    async () => (await snapshot(mara)).nudge === "vale",
    "nudge reaches friend",
  );
  await perform(vale, "give", "mara", "lamp");
  assert.equal((await snapshot(vale)).world.items.lamp.holder, "mara");
  await perform(mara, "move", "station");
  assert.equal((await snapshot(mara)).world.actors.mara.place, "station");
  const stationBackdrop = await mara.evaluate(async () =>
    (await import("/card-game/images.mjs")).imageUrl("./assets/station.png"),
  );
  await until(
    async () =>
      (await mara.locator("#backdrop").getAttribute("src")) === stationBackdrop,
    "the original station finishes rendering",
  );
  assert.equal(
    await mara.locator("#backdrop").getAttribute("src"),
    stationBackdrop,
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
  for (const id of ["vale", "mara"]) {
    assert.deepEqual(
      restored.world.actors[id].want,
      saved.world.actors[id].want,
    );
    assert.equal(restored.world.actors[id].xp, saved.world.actors[id].xp);
  }
  assert.deepEqual(restored.history, saved.history);
  assert.equal(
    await vale.evaluate(() =>
      localStorage.getItem("cosyworld.reflected-shore.v1"),
    ),
    initialSave,
    "the source browser save remains available",
  );
  for (const [i, page] of [vale, mara].entries()) {
    await until(
      async () =>
        (await page.locator("#backdrop").getAttribute("src")) ===
        (i ? stationBackdrop : pondBackdrop),
      "reconnected game finishes rendering",
    );
    await page.locator("#toolbar-menu-button").waitFor({ state: "visible" });
    await until(
      async () =>
        await page
          .locator("#backdrop")
          .evaluate((img) => img.complete && img.naturalWidth > 0),
      "reconnected room art loads",
    );
    await until(
      async () =>
        !(await page.locator("#play-status").textContent()).includes(
          "Failed to fetch",
        ),
      "connection notice clears after recovery",
    );
    await dismissDiscoveries(page);
    await until(
      async () =>
        await page.locator("#cast > .portrait").evaluateAll(
          (figures) =>
            figures.length > 0 &&
            figures.every((figure) => {
              const image = figure.querySelector("img");
              const body = figure.querySelector(".portrait-body");
              return (
                image.complete &&
                image.naturalWidth > 0 &&
                getComputedStyle(figure).visibility === "visible" &&
                Number(getComputedStyle(figure).opacity) >= 0.99 &&
                Number(getComputedStyle(body).opacity) >= 0.99
              );
            }),
        ),
      "present cast finishes its arrival",
    );
    await page.screenshot({
      path: join(output, `same-world-${i ? "phone" : "desktop"}.png`),
      fullPage: true,
    });
  }
  for (const width of [1440, 390]) {
    await vale.setViewportSize({ width, height: 900 });
    failReplies = true;
    const command = {
      op: "play",
      key: crypto.randomUUID(),
      action: await actionFor(vale, "wait"),
    };
    assert.equal((await api(vale, command)).status, 200);
    await until(
      async () => (await snapshot(vale)).history[0]?.error,
      "shared speech failure is saved",
    );
    const retry = vale.getByRole("button", {
      name: "Retry dialogue",
      exact: true,
    });
    await retry.waitFor({ state: "visible" });
    assert.equal(await vale.locator("#story-status").isVisible(), false);
    assert.equal(await retry.innerText(), "↻");
    const bounds = await retry.boundingBox();
    assert(bounds.width <= 32 && bounds.height <= 32);
    assert.doesNotMatch(
      await vale.locator("#play-status").innerText(),
      /play is saved|503/i,
    );
    const before = (await snapshot(vale)).world;
    failReplies = false;
    await retry.click();
    await until(
      async () =>
        !(await snapshot(vale)).history[0]?.error &&
        !(await snapshot(vale)).queue.length,
      "shared retry finishes",
    );
    const after = (await snapshot(vale)).world;
    assert.equal(after.turn, before.turn);
    assert.equal(
      after.revision,
      before.revision + 1,
      "one shared speech commit",
    );
    assert.deepEqual(after.items, before.items);
    assert.deepEqual(after.actors, before.actors);
    await until(async () => !(await retry.isVisible()), "retry icon clears");
  }
  assert.deepEqual(errors, []);
  for (const player of [0, 1]) {
    const replies = syncReplies
      .filter((reply) => reply.player === player)
      .map((reply) => reply.value);
    assert(
      replies.some((value) => value.sync.kind === "snapshot"),
      "Each layout opens with a sync snapshot.",
    );
    assert(
      replies.some(
        (value) => value.sync.kind === "events" && value.events.length,
      ),
      "Each layout receives shared events.",
    );
    assert(
      replies.some(
        (value) => value.sync.kind === "events" && value.events.length === 0,
      ),
      "Quiet sync carries only the clock and cursor.",
    );
    assert(
      replies
        .filter((value) => value.sync.kind === "events")
        .every((value) => !value.state && !value.history),
      "Event replies carry changes to the view.",
    );
  }
  console.log(
    "Shared original world: progressed save, eight passkeys, original pond/station/attic, NPCs, packs, quests (wants), room capacity, shared speech, item handoff, nudge, restart, desktop and phone passed.",
  );
} catch (error) {
  console.error(
    "Held provider timing",
    JSON.stringify(
      [...providerTiming.values()].filter((timing) => timing.held),
    ),
  );
  console.error(
    "Latest shared history",
    JSON.stringify((await snapshot(pages[0])).history.slice(0, 5)),
  );
  for (const [index, page] of pages.entries()) {
    console.error(
      names[index],
      page.url(),
      await page.locator("body").innerText(),
    );
    if (index < 2)
      console.error(
        "Stage:",
        await page.locator("#cast .portrait").evaluateAll((figures) =>
          figures.map((figure) => ({
            actor: figure.dataset.avatar,
            size: figure.style.getPropertyValue("--stage-size"),
            depth: figure.dataset.depth,
          })),
        ),
      );
    await page.screenshot({
      path: join(output, `failure-${names[index]}.png`),
      fullPage: true,
    });
  }
  console.error("Browser errors:", errors, "Server:", serverDiagnostics());
  throw error;
} finally {
  holdReplies = false;
  for (const resolve of waitingReplies.splice(0)) resolve();
  if (browser) await browser.close();
  await stop();
  await new Promise((resolve) => provider.close(resolve));
}
