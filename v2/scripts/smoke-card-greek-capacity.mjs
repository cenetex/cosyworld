import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { chromium } from "playwright";
import { encodeSave } from "../card-game/world.mjs";
import {
  agoraVisitors,
  agoraView,
  crowdedAgoraWorld,
} from "../../test/helpers/greek-capacity.mjs";

// This uses five separate passkeys, the HTTP service, C session guard,
// QuickJS rules, SQLite journal, and a fixture speech provider.
const dir = await mkdtemp(join(tmpdir(), "greek-capacity-"));
const output = resolve("output/greek-capacity");
await mkdir(output, { recursive: true });
const provider = createServer(async (req, res) => {
  let body = "";
  for await (const part of req) body += part;
  const input = JSON.parse(body);
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(
    JSON.stringify({
      model: input.model,
      choices: [
        {
          message: { content: "I will leave a little room for you." },
          finish_reason: "stop",
        },
      ],
    }),
  );
});
await new Promise((done) => provider.listen(0, "127.0.0.1", done));
const port = Number(process.env.COSYWORLD_GREEK_CAPACITY_PORT || 4197);
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
  processLog = "",
  worldId;
const evidence = { origin, checks: [] };
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
  child.stdout.on("data", (data) => {
    processLog += data;
  });
  child.stderr.on("data", (data) => {
    processLog += data;
  });
}
async function stop() {
  if (!child || child.exitCode !== null) return;
  const ended = new Promise((done) => child.once("exit", done));
  child.kill("SIGTERM");
  await ended;
}
async function until(check, label, interval = 250) {
  for (let n = 0; n < 120; n++) {
    try {
      if (await check()) return;
    } catch {}
    await delay(interval);
  }
  throw new Error(`${label}: ${processLog.slice(-2000)}`);
}
const ready = () =>
  until(
    async () => (await fetch(`${origin}/health`)).ok,
    "local server starts",
  );
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
async function view(page) {
  const result = await request(page);
  assert.equal(result.status, 200, JSON.stringify(result.body));
  return result.body;
}
async function command(page, body) {
  const result = await request(page, body);
  assert.equal(result.status, 200, JSON.stringify(result.body));
  return result.body;
}
try {
  start();
  await ready();
  browser = await chromium.launch({ headless: true });
  const pages = [];
  for (const avatar of agoraVisitors) {
    const context = await browser.newContext();
    const page = await context.newPage();
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
      const result = await request(
        page,
        { save: encodeSave(crowdedAgoraWorld()) },
        "/card-game/shared/worlds",
      );
      assert.equal(result.status, 200, JSON.stringify(result.body));
      worldId = result.body.id;
    } else await command(page, { op: "claim", avatar });
  }
  const [vale, , , , tavi] = pages;
  const blocked = await view(vale);
  assert.equal(blocked.world.presentActors.length, 5);
  assert.equal(blocked.world.actors.vale.place, "greek-eleusis");
  assert.ok(!blocked.exits.includes("greek-athens"));
  assert.ok(blocked.exits.includes("greek-piraeus"));
  const oldAction = agoraView(crowdedAgoraWorld(), ["vale"]).actions.find(
    (a) => a.kind === "move" && a.target === "greek-athens",
  );
  const denied = await request(vale, {
    op: "play",
    key: crypto.randomUUID(),
    action: oldAction,
  });
  assert.equal(denied.status, 409, JSON.stringify(denied.body));
  evidence.checks.push({
    name: "five authenticated members; full Agora preserves the coastal road",
    present: blocked.world.presentActors,
    exits: blocked.exits,
    denied,
  });
  await vale.reload();
  assert.ok(!(await view(vale)).exits.includes("greek-athens"));
  // Traverse every spoke with the four other people still in Agora.
  // Every return segment is one of the authored roads to the harbor.
  for (const destination of [
    "colonus",
    "marathon",
    "colonus",
    "eleusis",
    "piraeus",
    "harbor",
    "piraeus",
    "eleusis",
  ]) {
    for (const page of pages) await command(page, { op: "heartbeat" });
    const state = await view(vale);
    assert.ok(!state.exits.includes("greek-athens"));
    const action = state.actions.find(
      (a) => a.kind === "move" && a.target === `greek-${destination}`,
    );
    assert.ok(action, `the side road to ${destination} is offered`);
    await command(vale, { op: "play", key: crypto.randomUUID(), action });
    await until(
      async () => !(await view(vale)).queue.length,
      `side road to ${destination}`,
      2000,
    );
    const next = await view(vale);
    assert.equal(next.world.actors.vale.place, `greek-${destination}`);
    for (const id of agoraVisitors.slice(1))
      assert.equal(next.world.actors[id].place, "greek-athens");
  }
  evidence.checks.push({
    name: "four spokes connect to the harbor around four present people in Agora",
    passed: true,
  });
  await command(tavi, { op: "leave" });
  const open = await view(vale);
  assert.ok(open.exits.includes("greek-athens"));
  const action = open.actions.find(
    (a) => a.kind === "move" && a.target === "greek-athens",
  );
  await command(vale, { op: "play", key: crypto.randomUUID(), action });
  await until(async () => !(await view(vale)).queue.length, "move commits");
  const arrived = await view(vale);
  assert.equal(arrived.world.actors.vale.place, "greek-athens");
  await command(tavi, { op: "enter" });
  assert.equal((await view(tavi)).world.presentActors.includes("tavi"), false);
  const depart = arrived.actions.find(
    (a) => a.kind === "move" && a.target === "greek-eleusis",
  );
  await command(vale, { op: "play", key: crypto.randomUUID(), action: depart });
  await until(
    async () => !(await view(vale)).queue.length,
    "return to Eleusis commits",
    2000,
  );
  await command(tavi, { op: "enter" });
  assert.equal((await view(tavi)).world.presentActors.includes("tavi"), true);
  assert.ok(!(await view(vale)).exits.includes("greek-athens"));
  evidence.checks.push({
    name: "leave restores road; full room delays re-entry; freed place admits re-entry",
    passed: true,
  });
  const before = await view(vale);
  await stop();
  start();
  await ready();
  const replayed = await view(vale);
  assert.equal(
    replayed.world.actors.vale.place,
    before.world.actors.vale.place,
  );
  assert.equal(replayed.world.turn, before.world.turn);
  assert.deepEqual(replayed.world.packs, before.world.packs);
  evidence.checks.push({
    name: "journal survives server restart",
    passed: true,
    turn: replayed.world.turn,
  });
  console.log(
    "Agora capacity: five passkeys, four side routes, room limit, leave/rejoin, reload, and server replay passed.",
  );
} finally {
  await writeFile(
    join(output, "evidence.json"),
    JSON.stringify(evidence, null, 2),
  );
  await browser?.close();
  await stop();
  await new Promise((done) => provider.close(done));
}
