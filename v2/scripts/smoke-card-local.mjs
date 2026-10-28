import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { chromium } from "playwright";
import { createWorld } from "../card-game/world.mjs";
import {
  narrativeContext,
  applyGeneratedText,
} from "../card-game/narrative.mjs";

const origin =
  process.env.COSYWORLD_LOCAL_SMOKE_ORIGIN || "http://127.0.0.1:3110";
const output = new URL("../../output/local-app/", import.meta.url);
await mkdir(output, { recursive: true });
let ready = false;
// First launch can compile Metal shaders before the HTTP service opens.
for (let attempt = 0; attempt < 900; attempt++) {
  try {
    ready = (await fetch(`${origin}/health`)).ok;
  } catch {}
  if (ready) break;
  await new Promise((resolve) => setTimeout(resolve, 200));
}
assert(ready, "The local game became ready.");
const metadata = await (await fetch(`${origin}/meta`)).json();
assert.equal(metadata.primary_game, "card-table");
assert.equal(
  (
    await fetch(`${origin}/card-game/local`, {
      headers: { Origin: "https://example.com" },
    })
  ).status,
  403,
);

if (process.argv.includes("--real-models")) {
  const world = createWorld({ opening: true });
  const context = narrativeContext(world);
  const started = performance.now();
  const response = await fetch(`${origin}/card-game/text`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(context),
    signal: AbortSignal.timeout(250000),
  });
  assert.equal(response.status, 200);
  const words = await response.json();
  assert(words.entries.length > 0);
  applyGeneratedText(world, context, words);
  console.log(
    `Real local dialogue: ${words.entries.length} entries in ${((performance.now() - started) / 1000).toFixed(1)}s.`,
  );
  const voice = await fetch(`${origin}/card-game/local/speech`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      speaker: "vale",
      text: "The lamp is warm. Come sit beside me.",
    }),
    signal: AbortSignal.timeout(120000),
  });
  assert.equal(voice.status, 200);
  assert.equal(voice.headers.get("content-type"), "audio/wav");
  const audio = new Uint8Array(await voice.arrayBuffer());
  assert.equal(new TextDecoder().decode(audio.slice(0, 4)), "RIFF");
}

const browser = await chromium.launch({ headless: true });
try {
  for (const width of [1440, 390]) {
    const context = await browser.newContext({
      viewport: { width, height: 900 },
      acceptDownloads: true,
    });
    const page = await context.newPage();
    const errors = [],
      external = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("request", (request) => {
      if (
        /^https?:/.test(request.url()) &&
        !request.url().startsWith(origin + "/")
      )
        external.push(request.url());
    });
    await page.addInitScript(() => {
      localStorage.setItem("cosyworld.dialogue.sound", "off");
      localStorage.setItem(
        "cosyworld.room-music",
        JSON.stringify({ enabled: false }),
      );
    });
    await page.route("**/card-game/text", (route) => {
      const input = route.request().postDataJSON();
      return route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          revision: input.revision,
          model: "local-ui-fixture",
          entries: input.entities.map(({ id }) => ({
            id,
            text: "There is a warm place beside the lamp.",
          })),
        }),
      });
    });
    const table = `local-${width}-${Date.now()}`;
    const slot = `cosyworld.reflected-shore.v1.${table}`;
    await page.goto(`${origin}/?table=${table}`);
    await page.waitForFunction(() => !document.body.inert);
    await page.waitForFunction(
      (slot) => Boolean(localStorage.getItem(slot)),
      slot,
    );
    await page.keyboard.press("Escape");
    await page.locator("#toolbar-menu-button").click();
    await page.locator("#menu-button").click();
    await page.locator("#local-settings").waitFor({ state: "visible" });
    assert.equal(await page.locator(".openrouter-settings").isVisible(), false);
    assert.equal(await page.locator("#owned-worlds-button").isVisible(), false);
    const download = page.waitForEvent("download");
    await page.locator("#local-export").click();
    const backup = await download;
    assert(backup.suggestedFilename().endsWith(".json"));
    const saved = await page.evaluate(
      (slot) => localStorage.getItem(slot),
      slot,
    );
    await page.waitForFunction(
      async ({ origin, slot, saved }) => {
        const file = await (
          await fetch(`${origin}/card-game/local/saves/${slot}`)
        ).json();
        return file.save === saved;
      },
      { origin, slot, saved },
    );
    await page.screenshot({
      path: new URL(`settings-${width}.png`, output).pathname,
    });
    await page.locator("#local-import").setInputFiles({
      name: "invalid.json",
      mimeType: "application/json",
      buffer: Buffer.from("{}"),
    });
    await page.waitForFunction(
      () => document.getElementById("local-save-status").textContent.length > 0,
    );
    assert.equal(
      await page.evaluate((slot) => localStorage.getItem(slot), slot),
      saved,
    );
    await Promise.all([
      page.waitForEvent("load"),
      page
        .locator("#local-import")
        .setInputFiles({
          name: "backup.json",
          mimeType: "application/json",
          buffer: Buffer.from(
            JSON.stringify({ format: "cosyworld.local-save.v1", save: saved }),
          ),
        }),
    ]);
    await page.waitForFunction(() => !document.body.inert);
    assert.equal(
      await page.evaluate((slot) => localStorage.getItem(slot), slot),
      saved,
    );
    await context.close();
    const fresh = await browser.newContext({
      viewport: { width, height: 900 },
    });
    const restored = await fresh.newPage();
    await restored.route("**/card-game/text", (route) => route.abort());
    await restored.goto(`${origin}/?table=${table}`);
    await restored.waitForFunction(() => !document.body.inert);
    assert.equal(
      await restored.evaluate((slot) => localStorage.getItem(slot), slot),
      saved,
    );
    await fresh.close();
    assert.deepEqual(errors, []);
    assert.deepEqual(external, []);
    console.log(`Local app UI and file restore passed at ${width}px.`);
  }
} finally {
  await browser.close();
}
