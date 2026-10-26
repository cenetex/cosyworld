import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { chromium } from "playwright";

const dir = await mkdtemp(join(tmpdir(), "shared-cards-smoke-"));
const output = resolve("output/shared-cards");
await mkdir(output, { recursive: true });
const requests = [];
const provider = createServer(async (req, res) => {
  let body = "";
  for await (const chunk of req) body += chunk;
  const input = JSON.parse(body || "{}");
  requests.push(input);
  const content = JSON.stringify({
    lines: [
      { speaker: "actor", text: "There is room for a little company." },
      { speaker: "scene", text: "A ripple reaches the shore." },
    ],
  });
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(
    JSON.stringify({
      id: "local-fixture",
      model: input.model,
      choices: [{ message: { content }, finish_reason: "stop" }],
      usage: { prompt_tokens: 10, completion_tokens: 20 },
    }),
  );
});
await new Promise((r) => provider.listen(0, "127.0.0.1", r));
const port = Number(process.env.COSYWORLD_SHARED_SMOKE_PORT || 4183),
  origin = `http://localhost:${port}`;
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
let processLog = "";
const child = spawn(
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
child.stdout.on("data", (d) => (processLog += d));
child.stderr.on("data", (d) => (processLog += d));
let browser;
const delay = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(test, label) {
  for (let n = 0; n < 160; n++) {
    try {
      const value = await test();
      if (value) return value;
    } catch {}
    await delay(250);
  }
  throw new Error(`Timed out: ${label}\n${processLog.slice(-3000)}`);
}
try {
  await until(async () => {
    const r = await fetch(origin + "/health");
    return r.ok;
  }, "server starts");
  browser = await chromium.launch({ headless: true });
  const pages = [],
    errors = [];
  for (let i = 0; i < 8; i++) {
    const context = await browser.newContext({
      viewport:
        i === 1 ? { width: 390, height: 844 } : { width: 1440, height: 900 },
    });
    const page = await context.newPage();
    page.setDefaultTimeout(15000);
    page.on("pageerror", (e) => {
      errors.push(e.message);
      console.error(e.message);
    });
    page.on("console", (m) => {
      if (m.type() === "error") console.error(m.text());
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
    await page.goto(origin + "/?shared=1");
    await page
      .getByRole("button", { name: "Create a passkey", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Create a shared world", exact: true })
      .waitFor();
    pages.push(page);
  }
  const [vale, mara, ash, nell, tavi] = pages;
  await vale
    .getByRole("button", { name: "Create a shared world", exact: true })
    .click();
  await vale.getByRole("heading", { name: "Choose your avatar" }).waitFor();
  const artworkReady = (page) =>
    page.waitForFunction(() =>
      [...document.images].every(
        (image) => image.complete && image.naturalWidth > 0,
      ),
    );
  await artworkReady(vale);
  await vale.locator(".shared-picker").screenshot({
    path: join(output, "avatar-picker.png"),
  });
  const world = new URL(vale.url()).searchParams.get("world");
  assert(world);
  const api = async (page, body) =>
    page.evaluate(
      async ({ world, body }) => {
        const r = await fetch(
          `/card-game/shared/worlds/${world}${body ? "/command" : ""}`,
          body
            ? {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(body),
              }
            : {},
        );
        return { status: r.status, body: await r.json() };
      },
      { world, body },
    );
  for (let i = 0; i < 8; i++) {
    if (i) await pages[i].goto(origin + "/?world=" + world);
    await pages[i].locator(".shared-choice").nth(i).click();
    await pages[i].locator("#shared-scene").waitFor({ state: "visible" });
    assert.equal((await api(pages[i])).body.actor, i);
    await artworkReady(pages[i]);
    await pages[i].screenshot({
      path: join(output, `home-${i}.png`),
      fullPage: true,
    });
  }
  const play = (page, kind, item = -1, target = -1) =>
    api(page, { op: "play", kind, item, target, key: crypto.randomUUID() });
  const idle = (page) =>
    until(async () => {
      const { body } = await api(page);
      return !body.queue.some((q) => q.actor === body.actor);
    }, "play finishes");
  // Use the real UI for the first trip, then verify the same endpoint across clients.
  await vale
    .getByRole("button", { name: "Black pond, location", exact: true })
    .click();
  await vale.getByRole("button", { name: "Travel", exact: true }).click();
  await until(
    async () => (await api(vale)).body.world.places[0] === 0,
    "Vale arrives",
  );
  await idle(vale);
  for (const page of [mara, ash, nell]) {
    assert.equal((await play(page, 5, -1, 0)).status, 200);
    await until(
      async () =>
        (await api(page)).body.world.places[(await api(page)).body.actor] === 0,
      "arrival",
    );
    await idle(page);
  }
  assert.equal((await play(tavi, 5, -1, 0)).status, 409);
  assert(!(await api(tavi)).body.exits.includes(0));
  await until(
    async () =>
      !(await tavi
        .getByRole("button", { name: "Black pond, location", exact: true })
        .count()),
    "full room card disappears",
  );
  const before = (await api(vale)).body.history[0];
  assert.deepEqual((await api(mara)).body.history[0], before);
  assert.equal(before.lines.length, 2);
  await until(
    async () => (await vale.locator(".shared-person").count()) === 4,
    "all four people appear",
  );
  await artworkReady(vale);
  await artworkReady(mara);
  await vale
    .getByRole("button", { name: "Empty station, location", exact: true })
    .click();
  assert.match(
    await vale.locator("#shared-actions").innerText(),
    /lamp lights a stone arch/,
  );
  await vale
    .getByRole("button", { name: "Empty station, location", exact: true })
    .click();
  await vale.screenshot({
    path: join(output, "shared-desktop.png"),
    fullPage: true,
  });
  await mara.screenshot({
    path: join(output, "shared-phone.png"),
    fullPage: true,
  });
  for (const page of [vale, mara])
    assert(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    );
  assert.equal((await api(vale, { op: "nudge", target: 1 })).status, 200);
  await until(async () => (await api(mara)).body.nudge === 0, "nudge received");
  assert.equal((await api(vale, { op: "nudge", target: 1 })).status, 409);
  assert.equal((await play(vale, 7, 0)).status, 200);
  await idle(vale);
  assert.equal((await api(mara)).body.world.holders[0], 8);
  assert.equal((await play(mara, 6, 0)).status, 200);
  await idle(mara);
  assert.equal((await play(mara, 5, -1, 1)).status, 200);
  await idle(mara);
  assert(!(await api(vale)).body.exits.includes(1));
  assert.equal((await api(mara)).body.world.holders[0], 1);
  await vale.reload();
  await vale.locator("#shared-scene").waitFor({ state: "visible" });
  assert.equal((await api(vale)).body.actor, 0);
  // Signing out and in proves discoverable passkeys recover the same claim.
  await vale.getByRole("button", { name: "Menu", exact: true }).click();
  await vale.getByRole("button", { name: "Sign out", exact: true }).click();
  await vale
    .getByRole("button", { name: "Continue with a passkey", exact: true })
    .click();
  await vale.locator("#shared-scene").waitFor({ state: "visible" });
  assert.equal((await api(vale)).body.actor, 0);
  assert.equal(errors.length, 0, errors.join("\n"));
  assert(
    requests.some((r) =>
      r.messages?.some((m) => m.content?.includes("completed_play")),
    ),
  );
  console.log(
    "Shared cards: eight real passkey sessions, eight homes, claim restore, four-person capacity, hidden full-room cards, shared two-line speech, custody, named entrances, disappearing entrance, nudge, desktop and phone passed.",
  );
} catch (error) {
  if (browser)
    for (const c of browser.contexts())
      for (const p of c.pages()) {
        console.error(await p.locator("body").innerText());
        await p.screenshot({
          path: join(output, "failure.png"),
          fullPage: true,
        });
      }
  throw error;
} finally {
  await writeFile(join(output, "server.log"), processLog);
  await browser?.close();
  child.kill("SIGTERM");
  await new Promise((r) => provider.close(r));
}
