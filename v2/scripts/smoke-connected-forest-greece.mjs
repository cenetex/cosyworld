import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { readFile, writeFile, mkdir, mkdtemp } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { spawn, execFileSync } from "node:child_process";
import { chromium } from "playwright";
import { decodeSave, encodeSave } from "../card-game/world.mjs";
import { dispatchShared } from "../card-game/shared-world.mjs";
import { cardActions } from "../card-game/cards.mjs";
import { selectCard } from "./card-browser-helpers.mjs";
import {
  connectedJourney,
  forestContract,
  assertForestContract,
  PLAYERS,
} from "./connected-forest-greece-route.mjs";

const { values } = parseArgs({
  options: {
    save: { type: "string" },
    binary: { type: "string" },
    port: { type: "string", default: "4214" },
    output: { type: "string", default: "output/connected-forest-greece" },
    "model-only": { type: "boolean", default: false },
    "first-play-only": { type: "boolean", default: false },
  },
});
assert.ok(values.save, "Pass the successful forest UI save with --save");
const root = fileURLToPath(new URL("../../", import.meta.url));
const source = execFileSync("git", ["rev-parse", "HEAD"], {
  cwd: root,
  encoding: "utf8",
}).trim();
const savePath = resolve(values.save),
  output = resolve(values.output);
const bytes = await readFile(savePath),
  raw = bytes.toString("utf8"),
  seed = JSON.parse(raw);
const hash = (value) => createHash("sha256").update(value).digest("hex");
const originalHash = hash(bytes),
  fixed = forestContract(seed);
await mkdir(output, { recursive: true });
const report = {
  ok: false,
  mode: values["model-only"]
    ? "local-model"
    : values["first-play-only"]
      ? "shared-first-play"
      : "shared-server-and-browser",
  source,
  input: { path: savePath, sha256: originalHash, bytes: bytes.length },
  dialogueProvider: "local text fixture",
  steps: [],
  checkpoints: [],
  screenshots: [],
  pageErrors: [],
  failedAssets: [],
};
const commands = [];
let browser,
  child,
  provider,
  processLog = "",
  childError,
  worldId,
  database,
  model;
const players = new Map();
const delay = (ms) => new Promise((done) => setTimeout(done, ms));
async function until(check, label, rounds = 90) {
  for (let turn = 0; turn < rounds; turn++) {
    if (childError) throw childError;
    if (await check()) return;
    await delay(1000);
  }
  throw Error(`${label}: ${processLog.slice(-3000)}`);
}
function contextWorld(snapshot) {
  return {
    ...snapshot.world,
    playerActorId: snapshot.actor,
    controlledActors: PLAYERS,
    presentActors: PLAYERS,
  };
}
function cardsForAction(actor, action, before) {
  const cards = action.cards?.length ? [...action.cards] : [actor];
  if (
    action.kind === "drop" ||
    (["light", "snuff", "ring"].includes(action.kind) &&
      before.world.items[action.item].holder !== actor)
  )
    cards.push(before.world.actors[actor].place);
  assert.ok(
    cardActions(before.world, cards).actions.some(
      (offer) => offer.key === action.key,
    ),
    `${actor}'s ${action.kind} is offered for ${cards.join(" + ")}`,
  );
  return cards;
}
async function modelDriver() {
  let world = dispatchShared({ op: "create", save: raw }).world;
  const read = async (actor) => {
    const view = dispatchShared({
      op: "view",
      world,
      actor,
      claimed: PLAYERS,
      present: PLAYERS,
    });
    assert.equal(view.ok, true, view.error);
    return { ...view, actor, world: contextWorld({ ...view, actor }) };
  };
  return {
    read,
    snapshot: () => world,
    play: async (actor, action, before) => {
      cardsForAction(actor, action, before);
      const result = dispatchShared({
        op: "play",
        world,
        actor,
        action,
        claimed: PLAYERS,
        present: PLAYERS,
      });
      assert.equal(result.ok, true, result.error);
      world = result.world;
      report.steps.push({
        actor,
        action,
        turn: world.turn,
        place: world.actors[actor].place,
      });
      return read(actor);
    },
    reload: async (actor) => {
      world = decodeSave(encodeSave(world));
      return read(actor);
    },
    checkpoint: async (label) =>
      report.checkpoints.push({ label, turn: world.turn }),
  };
}

async function request(page, body, path) {
  return page.evaluate(
    async ({ body, path }) => {
      const response = await fetch(
        path,
        body === undefined
          ? { cache: "no-store" }
          : {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(body),
            },
      );
      return { status: response.status, body: await response.json() };
    },
    {
      body,
      path:
        path ||
        `/card-game/shared/worlds/${worldId}${body === undefined ? "" : "/command"}`,
    },
  );
}
async function checked(page, body, path) {
  const result = await request(page, body, path);
  assert.equal(result.status, 200, JSON.stringify(result.body));
  return result.body;
}
async function read(actor) {
  const value = await checked(players.get(actor).page);
  assert.equal(value.actor, actor);
  return { ...value, world: contextWorld(value) };
}
async function settle(actor) {
  const page = players.get(actor).page;
  for (let turn = 0; turn < 240; turn++) {
    if (await page.locator("#unveil-take").isVisible())
      await page.locator("#unveil-take").click();
    else if (await page.locator("#dialogue-advance").isVisible())
      await page.locator("#dialogue-advance").click();
    else if (await page.locator("#unveil-dialog[open]").count())
      await page.keyboard.press("Escape");
    assert.equal(
      await page.locator("#story-retry").isVisible(),
      false,
      "The shared dialogue finishes",
    );
    if (
      (await page.locator("#hand").getAttribute("data-cooling")) === "false" &&
      (await page.locator("#hand .card").count())
    ) {
      await page.keyboard.press("Escape");
      return;
    }
    await delay(100);
  }
  throw Error(`${actor}'s scene needs attention`);
}
async function capture(actor, label) {
  await settle(actor);
  const { page, phone } = players.get(actor);
  await page.waitForFunction(() =>
    [...document.querySelectorAll("#backdrop, #cast img, #hand img")]
      .filter((img) => {
        const r = img.getBoundingClientRect();
        return (
          r.width &&
          r.height &&
          r.right > 0 &&
          r.left < innerWidth &&
          r.bottom > 0 &&
          r.top < innerHeight
        );
      })
      .every((img) => img.complete && img.naturalWidth > 0),
  );
  assert.ok(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth + 1,
    ),
  );
  const path = join(
    output,
    `${label}-${actor}-${phone ? "phone" : "desktop"}.png`,
  );
  await page.screenshot({ path, fullPage: true });
  report.screenshots.push(path);
}
async function reload(actor) {
  const before = await read(actor),
    { page } = players.get(actor);
  await page.reload();
  await page.locator("#hand .card").first().waitFor();
  await settle(actor);
  const after = await read(actor);
  assert.equal(after.world.revision, before.world.revision);
  for (const field of ["items", "transports", "quests"])
    assert.deepEqual(after.world[field], before.world[field]);
  assert.equal(
    after.world.actors[actor].place,
    before.world.actors[actor].place,
  );
  assertForestContract(after.world, fixed);
  return after;
}
async function playUI(actor, action, before) {
  const { page, phone } = players.get(actor);
  for (const member of players.values())
    await checked(member.page, { op: "heartbeat" });
  await settle(actor);
  const cards = cardsForAction(actor, action, before);
  for (const card of cards) await selectCard(page, card, { touch: phone });
  const selector = action.choiceId
    ? `#card-actions [data-choice="${action.choiceId}"]`
    : `#card-actions [data-action="${action.kind}"]`;
  const button = page.locator(selector).filter({ visible: true }).first();
  await button.waitFor();
  const response = page.waitForResponse((value) => {
    if (!value.url().endsWith(`/card-game/shared/worlds/${worldId}/command`))
      return false;
    const body = value.request().postDataJSON();
    return body?.op === "play" && body.action?.key === action.key;
  });
  if (phone) await button.tap();
  else await button.click();
  const accepted = await response,
    body = accepted.request().postDataJSON();
  if (accepted.status() !== 200) {
    (report.rejectedPlays ??= []).push({
      actor,
      action,
      turn: before.world.turn,
      status: accepted.status(),
      error: (await accepted.text()).slice(0, 1000),
    });
  }
  assert.equal(accepted.status(), 200, (await accepted.text()).slice(0, 1000));
  commands.push({ actor, ...body });
  let after;
  await until(async () => {
    after = await read(actor);
    return after.world.turn > before.world.turn && after.queue.length === 0;
  }, `${actor}'s accepted ${action.kind} completes`);
  const step = {
    actor,
    key: body.key,
    action: body.action,
    turn: after.world.turn,
    from: before.world.actors[actor].place,
    place: after.world.actors[actor].place,
  };
  report.steps.push(step);
  console.log(JSON.stringify(step));
  await settle(actor);
  return after;
}
async function shaFile(path) {
  const digest = createHash("sha256");
  for await (const chunk of createReadStream(path)) digest.update(chunk);
  return digest.digest("hex");
}
function start(binary, env) {
  childError = null;
  child = spawn(binary, [], {
    cwd: join(root, "v2/orchestrator-rust"),
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.on("error", (error) => {
    childError = error;
  });
  for (const stream of [child.stdout, child.stderr])
    stream.on("data", (data) => {
      processLog += data;
    });
}
async function stop() {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  const ended = new Promise((done) => child.once("exit", done));
  child.kill("SIGTERM");
  const timeout = setTimeout(() => child.kill("SIGKILL"), 10000);
  await ended;
  clearTimeout(timeout);
}
async function storedWorld() {
  const { DatabaseSync } = await import("node:sqlite");
  const db = new DatabaseSync(database, { readOnly: true });
  try {
    const checkpoint = db
      .prepare("SELECT seq,state FROM card_full_checkpoints WHERE world=?")
      .get(worldId);
    assert.ok(checkpoint, "The real shared checkpoint exists");
    const rows = db
      .prepare(
        "SELECT seq,command FROM card_full_log WHERE world=? ORDER BY seq",
      )
      .all(worldId);
    return {
      checkpoint: { seq: checkpoint.seq, ...JSON.parse(checkpoint.state) },
      rows,
    };
  } finally {
    db.close();
  }
}
async function sharedRun() {
  assert.ok(values.binary, "Pass the exact supplied server with --binary");
  assert.equal(
    execFileSync("git", ["status", "--porcelain", "--untracked-files=no"], {
      cwd: root,
      encoding: "utf8",
    }).trim(),
    "",
    "The tested source is committed",
  );
  const binary = resolve(values.binary),
    port = Number(values.port);
  assert.ok(Number.isInteger(port) && port > 1024 && port < 65536);
  const origin = `http://localhost:${port}`;
  const runtime = await mkdtemp(join(tmpdir(), "connected-forest-greece-"));
  database = join(runtime, "events.sqlite");
  report.binary = { path: binary, sha256: await shaFile(binary) };
  report.runtime = runtime;
  const engine = await readFile(
    join(root, "v2/orchestrator-rust/src/card_shared/engine.rs"),
    "utf8",
  );
  const rules = engine.match(/const VERSION: &str = "([^"]+)"/)[1];
  const assets = (
    await readFile(
      join(root, "v2/orchestrator-rust/src/card_assets.rs"),
      "utf8",
    )
  ).match(/pub fn manifest_sha256\(\)[\s\S]*?"([a-f0-9]{64})"/)[1];
  const version = JSON.parse(
    await readFile(join(root, "package.json"), "utf8"),
  ).version;
  let providerRequests = 0;
  provider = createServer(async (req, res) => {
    let text = "";
    for await (const chunk of req) text += chunk;
    const input = JSON.parse(text);
    providerRequests++;
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        model: input.model,
        choices: [
          {
            message: {
              content: `I pause for ${providerRequests} quiet breaths.`,
            },
            finish_reason: "stop",
          },
        ],
      }),
    );
  });
  await new Promise((done) => provider.listen(0, "127.0.0.1", done));
  const env = {
    ...process.env,
    COSYWORLD_PRIMARY_GAME: "cards",
    COSYWORLD_DEPLOY_PROFILE: "development",
    COSYWORLD_V2_ADDR: `127.0.0.1:${port}`,
    COSYWORLD_V2_EVENT_DB_PATH: database,
    COSYWORLD_V2_SNAPSHOT_PATH: "off",
    COSYWORLD_V2_RESIDENT_CONTINUITY_PATH: join(runtime, "residents.json"),
    COSYWORLD_WEBAUTHN_ORIGIN: origin,
    COSYWORLD_WEBAUTHN_RP_ID: "localhost",
    COSYWORLD_AI_BASE_URL: `http://127.0.0.1:${provider.address().port}/v1`,
    COSYWORLD_AI_API_KEY: "connected-local-text-fixture",
    COSYWORLD_AI_MODEL: "openai/gpt-4.1-mini",
    COSYWORLD_CARD_TEXT_MODEL: "openai/gpt-4.1-mini",
  };
  for (const name of [
    "OPENAI_API_KEY",
    "OPENROUTER_API_KEY",
    "COSYWORLD_AI_REGISTRY_JSON",
    "COSYWORLD_CARD_CHARACTER_MODELS_JSON",
  ])
    delete env[name];
  const ready = () =>
    until(async () => {
      try {
        return (await fetch(`${origin}/health`)).ok;
      } catch {
        return false;
      }
    }, "The supplied shared service starts");
  const metadata = async () => {
    const response = await fetch(`${origin}/meta`);
    assert.equal(response.status, 200);
    const meta = await response.json();
    assert.equal(meta.version, version);
    assert.equal(meta.primary_game, "card-table");
    assert.equal(meta.card_game.shared_rules_version, rules);
    assert.equal(meta.card_game.assets_sha256, assets);
    assert.equal(meta.persistence.checkpoint_rejections, 0);
    return meta;
  };
  start(binary, env);
  await ready();
  report.meta = await metadata();
  const served = await fetch(`${origin}/card-game/world.mjs`);
  assert.equal(served.status, 200);
  assert.equal(
    hash(Buffer.from(await served.arrayBuffer())),
    hash(await readFile(join(root, "v2/card-game/world.mjs"))),
  );
  browser = await chromium.launch({ headless: true });
  for (const actor of PLAYERS) {
    const phone = actor === "mara";
    const context = await browser.newContext({
      viewport: { width: phone ? 390 : 1440, height: phone ? 844 : 900 },
      hasTouch: phone,
      reducedMotion: "reduce",
    });
    await context.addInitScript(() => {
      localStorage.setItem("cosyworld.dialogue.sound", "off");
      localStorage.setItem(
        "cosyworld.room-music",
        JSON.stringify({ enabled: false }),
      );
    });
    const page = await context.newPage();
    page.setDefaultTimeout(30000);
    page.on("pageerror", (error) =>
      report.pageErrors.push({ actor, message: error.message }),
    );
    page.on("response", (response) => {
      if (response.status() >= 400 && response.url().includes("/assets/"))
        report.failedAssets.push({
          actor,
          status: response.status(),
          url: response.url(),
        });
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
    const account = await checked(page, undefined, "/auth/account");
    assert.equal(account.authenticated, true);
    players.set(actor, { context, page, phone });
    if (actor === "vale") {
      const created = await checked(
        page,
        { save: raw },
        "/card-game/shared/worlds",
      );
      worldId = created.id;
      commands.push({
        actor,
        op: "create",
        originalSaveSha256: originalHash,
        originalSaveBytes: bytes.length,
      });
      const stored = await storedWorld();
      const expected = dispatchShared({ op: "create", save: raw });
      assert.equal(expected.ok, true, expected.error);
      assert.deepEqual(stored.checkpoint.game, expected.world);
      report.import = {
        rawSaveSentUnchanged: true,
        storedSeedMatchesCurrentRules: true,
        worldIdSha256: hash(worldId),
      };
    } else await checked(page, { op: "claim", avatar: actor });
  }
  for (const { page } of players.values()) {
    await page.goto(`${origin}/?world=${worldId}`);
    await page.locator("#hand .card").first().waitFor();
  }
  const driver = {
    read,
    play: playUI,
    reload,
    checkpoint: async (label, world) => {
      report.checkpoints.push({
        label,
        turn: world.turn,
        places: Object.fromEntries(
          PLAYERS.map((actor) => [actor, world.actors[actor].place]),
        ),
      });
      for (const actor of PLAYERS) await capture(actor, label);
    },
  };
  if (values["first-play-only"]) {
    const before = await read("mara");
    const take = before.actions.find(
      (action) => action.kind === "take" && action.item === "mask",
    );
    assert.ok(take, "Mara can take her mask at home");
    const after = await playUI("mara", take, before);
    assert.equal(after.world.turn, before.world.turn + 1);
    assert.equal(after.world.items.mask.holder, "mara");
    assertForestContract(after.world, fixed);
    report.finalSave = join(output, "final-save.json");
    await writeFile(
      report.finalSave,
      encodeSave((await storedWorld()).checkpoint.game) + "\n",
    );
    report.providerRequests = providerRequests;
    await capture("mara", "first-shared-play");
    return;
  }
  const journey = await connectedJourney(driver, seed);
  report.waterReturn = journey.waterReturn;
  const before = await storedWorld();
  assertForestContract(before.checkpoint.game, fixed);
  await stop();
  start(binary, env);
  await ready();
  report.metaAfterRestart = await metadata();
  for (const actor of PLAYERS) await reload(actor);
  const restored = await storedWorld();
  assert.deepEqual(restored.checkpoint.game, before.checkpoint.game);
  assert.deepEqual(restored.rows.slice(0, before.rows.length), before.rows);
  const plays = (rows) =>
    rows.filter((row) => JSON.parse(row.command).op === "play");
  assert.equal(plays(restored.rows).length, report.steps.length);
  assert.ok(providerRequests > 0);
  report.restart = {
    exactGameRestored: true,
    originalJournalPrefixRetained: true,
    acceptedPlays: report.steps.length,
    journalRows: restored.rows.length,
    rules,
  };
  report.providerRequests = providerRequests;
  await writeFile(
    join(output, "journal.jsonl"),
    restored.rows
      .map(({ seq, command }) => {
        const value = JSON.parse(command);
        return JSON.stringify(
          value.op === "seed"
            ? {
                seq,
                op: "seed",
                gameSha256: hash(JSON.stringify(value.state.game)),
              }
            : { seq, ...value },
        );
      })
      .join("\n") + "\n",
  );
  report.finalSave = join(output, "final-save.json");
  await writeFile(
    report.finalSave,
    encodeSave(restored.checkpoint.game) + "\n",
  );
  for (const actor of PLAYERS) await capture(actor, "after-server-restart");
  assert.deepEqual(report.pageErrors, []);
  assert.deepEqual(report.failedAssets, []);
}

try {
  if (values["model-only"]) {
    const driver = await modelDriver();
    model = driver;
    const result = await connectedJourney(driver, seed);
    report.waterReturn = result.waterReturn;
    report.finalSave = join(output, "final-save.json");
    await writeFile(report.finalSave, encodeSave(driver.snapshot()) + "\n");
  } else await sharedRun();
  assert.equal(
    hash(await readFile(savePath)),
    originalHash,
    "The input forest save stays exact",
  );
  report.ok = true;
} catch (error) {
  report.error = error.stack;
  const failed =
    model?.snapshot() ||
    (database && worldId
      ? (await storedWorld().catch(() => null))?.checkpoint.game
      : null);
  if (failed) {
    report.failedSave = join(output, "failed-save.json");
    await writeFile(report.failedSave, encodeSave(failed) + "\n");
  }
  for (const actor of players.keys())
    await capture(actor, "failure").catch(() => {});
  process.exitCode = 1;
} finally {
  await browser?.close();
  await stop();
  if (provider) await new Promise((done) => provider.close(done));
  await writeFile(
    join(output, "commands.jsonl"),
    commands.map((command) => JSON.stringify(command)).join("\n") + "\n",
  );
  await writeFile(join(output, "server.log"), processLog);
  await writeFile(
    join(output, "report.json"),
    JSON.stringify(report, null, 2) + "\n",
  );
  console.log(
    JSON.stringify({
      ok: report.ok,
      mode: report.mode,
      source,
      inputSha256: originalHash,
      acceptedPlays: report.steps.length,
      output,
      error: report.error,
    }),
  );
}
