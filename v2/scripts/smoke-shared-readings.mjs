import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawn } from "node:child_process";
import { chromium } from "playwright";
import { encodeSave } from "../card-game/world.mjs";
import { packDefinition } from "../card-game/pack-registry.mjs";
import { recitalPoem } from "../card-game/pack-recital.mjs";
import {
  courtJourney,
  readingPlay,
  readingWalk,
  COURT,
  FROGS,
} from "../../test/helpers/greek-readings.mjs";

const dir = await mkdtemp(join(tmpdir(), "shared-readings-"));
const output = resolve("output/shared-readings");
await mkdir(output, { recursive: true });
let initial = courtJourney();
initial.sharedVersion = 1;
initial.controlledActors = ["vale", "mara", "ash"];
initial.presentActors = ["vale", "mara", "ash"];
for (const [actor, item, destination] of [
  ["mara", "mask", COURT],
  ["ash", "float", "greek-underworld"],
]) {
  if (initial.items[item].holder !== actor)
    initial = readingPlay(initial, "take", { item }, actor);
  initial = readingWalk(initial, actor, destination);
}
const secretLines = recitalPoem(initial, packDefinition("greek-drama"))
  .stanzas[0].lines;
const quote = secretLines.join(" ");
const privateWordsAbsent = (text) =>
  secretLines.every((line) => !text.includes(line));
const provider = createServer(async (req, res) => {
  let body = "";
  for await (const part of req) body += part;
  const input = JSON.parse(body);
  const heard = input.messages.some((message) =>
    message.content.includes(quote),
  );
  const content = heard
    ? `I heard these words: ${quote}`
    : "I am listening to the account.";
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(
    JSON.stringify({
      model: input.model,
      choices: [{ message: { content }, finish_reason: "stop" }],
    }),
  );
});
await new Promise((done) => provider.listen(0, "127.0.0.1", done));
const port = Number(process.env.COSYWORLD_SHARED_READINGS_PORT || 4199);
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
let child,
  browser,
  worldId,
  processLog = "";
const pages = [],
  errors = [],
  outsiderReplies = [];
const evidence = { origin, checks: [], steps: [] };
const delay = (ms) => new Promise((done) => setTimeout(done, ms));
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
  for (const stream of [child.stdout, child.stderr])
    stream.on("data", (data) => {
      processLog = (processLog + data).slice(-20000);
    });
}
async function stop() {
  if (!child || child.exitCode !== null) return;
  const ended = new Promise((done) => child.once("exit", done));
  child.kill("SIGTERM");
  await ended;
}
async function until(check, label) {
  for (let attempt = 0; attempt < 90; attempt++) {
    if (await check()) return;
    await delay(1000);
  }
  throw Error(`${label}: ${processLog.slice(-3000)}`);
}
const ready = () =>
  until(async () => {
    try {
      return (await fetch(`${origin}/health`)).ok;
    } catch {
      return false;
    }
  }, "The shared service starts");
async function request(page, body, path) {
  return page.evaluate(
    async ({ body, path }) => {
      const response = await fetch(
        path,
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
    {
      body,
      path:
        path || `/card-game/shared/worlds/${worldId}${body ? "/command" : ""}`,
    },
  );
}
async function checked(page, body, path) {
  const result = await request(page, body, path);
  assert.equal(result.status, 200, JSON.stringify(result.body));
  return result.body;
}
const view = (page) => checked(page);
async function idle(page) {
  await until(
    async () => !(await view(page)).queue.length,
    "The saved reading scene finishes",
  );
}
async function act(page, fields) {
  for (const member of pages) await checked(member, { op: "heartbeat" });
  const state = await view(page);
  const action = state.actions.find((action) =>
    Object.entries(fields).every(([key, value]) => action[key] === value),
  );
  assert(action, JSON.stringify(fields));
  await checked(page, { op: "play", key: crypto.randomUUID(), action });
  await idle(page);
  const after = await view(page);
  evidence.steps.push({ ...fields, turn: after.world.turn });
  return after;
}
const reading = (state) =>
  state.world.readingView.packs["greek-drama"].readings.find(
    (entry) => entry.id === `site:${FROGS}-court:vale`,
  );
async function review(page) {
  for (let attempt = 0; attempt < 200; attempt++) {
    if (await page.locator("#unveil-dialog[open]").count())
      await page.keyboard.press("Escape");
    else if (await page.locator("#dialogue-advance").isVisible())
      await page.locator("#dialogue-advance").click();
    else if (!(await page.evaluate(() => document.body.inert))) break;
    assert.equal(
      await page.locator("#story-retry").isVisible(),
      false,
      await page
        .locator("#story-retry")
        .evaluate((node) => node.parentElement.textContent),
    );
    await delay(50);
  }
  await page.locator("#toolbar-menu-button").click();
  await page.locator("#reading-button").click();
  await page.locator("#reading-dialog[open]").waitFor();
}
try {
  start();
  await ready();
  browser = await chromium.launch({ headless: true });
  for (const [index, avatar] of ["vale", "mara", "ash"].entries()) {
    const context = await browser.newContext({
      viewport: { width: index === 1 ? 390 : 1440, height: 900 },
      reducedMotion: "reduce",
    });
    const page = await context.newPage();
    page.on("pageerror", (error) => errors.push(`${avatar}: ${error.message}`));
    await page.addInitScript(() => {
      localStorage.setItem("cosyworld.dialogue.sound", "off");
      localStorage.setItem(
        "cosyworld.room-music",
        JSON.stringify({ enabled: false }),
      );
    });
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
    pages.push(page);
    if (avatar === "vale") {
      worldId = (
        await checked(
          page,
          { save: encodeSave(initial) },
          "/card-game/shared/worlds",
        )
      ).id;
    } else await checked(page, { op: "claim", avatar });
  }
  const [vale, mara, ash] = pages;
  ash.on("response", async (response) => {
    if (
      response.url().includes(`/card-game/shared/worlds/${worldId}`) &&
      response.status() === 200
    )
      outsiderReplies.push(await response.text().catch(() => ""));
  });
  for (const page of pages) {
    await page.goto(`${origin}/?world=${worldId}`);
    await page.locator("#hand .card").first().waitFor();
  }
  await act(vale, { kind: "read", readingOp: "invite", invitee: "mara" });
  await act(vale, {
    kind: "read",
    readingOp: "start",
    siteId: FROGS + "-court",
  });
  await act(vale, { kind: "read", readingOp: "page" });
  const first = structuredClone(reading(await view(vale)));
  assert.equal(reading(await view(mara)).pages.length, 1);
  assert(JSON.stringify(await view(vale)).includes(quote));
  assert(privateWordsAbsent(JSON.stringify(await view(ash))));
  await act(mara, { kind: "move", target: "greek-underworld" });
  await act(mara, { kind: "move", target: COURT });
  await act(ash, { kind: "move", target: COURT });

  const before = await view(vale);
  const action = before.actions.find(
    (entry) => entry.kind === "read" && entry.readingOp === "page",
  );
  assert(action);
  const lostKey = crypto.randomUUID();
  let lost = false;
  await vale.route(
    `**/card-game/shared/worlds/${worldId}/command`,
    async (route) => {
      if (!lost && route.request().postDataJSON()?.key === lostKey) {
        lost = true;
        const response = await route.fetch();
        assert.equal(response.status(), 200);
        await route.abort("failed");
      } else await route.continue();
    },
  );
  await request(vale, { op: "play", key: lostKey, action }).catch(() => {});
  await checked(vale, { op: "play", key: lostKey, action });
  await idle(vale);
  const after = await view(vale);
  assert(lost);
  assert.equal(after.world.turn, before.world.turn + 1);
  assert.equal(
    reading(after).pages.filter((page) => page[1] !== null).length,
    2,
  );
  assert.equal(reading(await view(mara)).pages.length, 1);
  assert.deepEqual(
    (await view(ash)).world.readingView.packs["greek-drama"].readings,
    [],
  );
  await review(ash);
  assert(privateWordsAbsent(await ash.locator("#reading-dialog").innerText()));
  await ash
    .locator("#reading-dialog")
    .getByRole("button", { name: "Close", exact: true })
    .click();
  const replay = {
    key: `read:vale:greek-drama:replay:${encodeURIComponent(`site:${FROGS}-court:vale/1/mara`)}`,
  };
  await checked(vale, { op: "play", key: crypto.randomUUID(), action: replay });
  await idle(vale);
  await mara.reload();
  await mara.locator("#hand .card").first().waitFor();
  const heard = reading(await view(mara));
  assert.deepEqual(
    heard.pages.map((page) => page[0]),
    [0, 1],
  );
  assert.equal(heard.readingTurn, first.readingTurn);
  assert.equal(heard.through, first.through);
  assert.deepEqual(heard.pages[0], first.pages[0]);
  await review(mara);
  await mara.screenshot({ path: join(output, "listener-phone.png") });
  await stop();
  start();
  await ready();
  assert.deepEqual(reading(await view(mara)), heard);
  assert(privateWordsAbsent(JSON.stringify(await view(ash))));
  assert(outsiderReplies.length > 0);
  assert(outsiderReplies.every(privateWordsAbsent));
  assert.deepEqual(errors, []);
  evidence.checks.push({
    players: 3,
    passkeys: 3,
    pages: 2,
    stickyGuestDeparture: true,
    explicitReplay: true,
    originalTurns: true,
    lostResponseAcceptedOnce: true,
    rawOutsiderReplies: outsiderReplies.length,
    outsiderPrivacy: true,
    phoneReload: true,
    serverRestart: true,
    errors,
  });
  console.log(
    "Shared readings: three passkeys, private pages, guest return, explicit replay, one lost-response commit, phone reload and server restart passed.",
  );
} catch (error) {
  evidence.error = error.message;
  for (const [index, page] of pages.entries()) {
    await page
      .screenshot({ path: join(output, `failure-${index}.png`) })
      .catch(() => {});
    const state = await view(page).catch((failure) => ({
      error: failure.message,
    }));
    await writeFile(
      join(output, `failure-${index}.json`),
      JSON.stringify(state, null, 2),
    );
  }
  throw error;
} finally {
  await writeFile(
    join(output, "report.json"),
    JSON.stringify(evidence, null, 2),
  );
  await writeFile(join(output, "server.log"), processLog);
  await browser?.close();
  await stop();
  await new Promise((done) => provider.close(done));
}
