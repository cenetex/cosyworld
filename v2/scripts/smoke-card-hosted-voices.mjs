// A signed-in passkey hears hosted voices free: a shared world voices a
// saved scene line with no credits, and Settings deals no Credits or World
// pool card. The toolbar shows the plain wordmark.
import assert from "node:assert/strict";
import { mkdir, readFile } from "node:fs/promises";
import { chromium } from "playwright";
import { createServer } from "../card-game/serve.mjs";
import { dispatchShared } from "../card-game/shared-world.mjs";
import { createWorld, encodeSave } from "../card-game/world.mjs";
import { revealCard, openSettings } from "./card-browser-helpers.mjs";

const settingIds = (page) =>
  page
    .locator("#settings-hand [data-setting]")
    .evaluateAll((cards) => cards.map((c) => c.dataset.setting));

async function checkSharedVoice(width) {
  const page = await browser.newPage({
    viewport: { width, height: 900 },
    reducedMotion: "reduce",
  });
  const errors = [],
    voices = [];
  page.on("pageerror", (error) => errors.push(error.message));
  let shared = dispatchShared({
    op: "create",
    save: encodeSave(createWorld()),
  }).world;
  const room = shared.actors.vale.place;
  const spoken = dispatchShared({
    op: "speech",
    world: shared,
    actor: "vale",
    room,
    lines: [{ actorId: "vale", text: "The lamp is steady." }],
  });
  shared = spoken.world;
  const history = [
    {
      play: "saved-voice-play",
      room,
      lines: spoken.lines,
      starts_at: Date.now(),
      until_at: Date.now() + 9000,
    },
  ];
  const audio = await readFile(
    new URL("../card-game/assets/voices/vale.mp3", import.meta.url),
  );
  await page.route("**/card-game/speech", (route) => {
    voices.push(route.request().postDataJSON());
    return route.fulfill({ contentType: "audio/mpeg", body: audio });
  });
  await page.route("**/auth/account", (route) =>
    route.fulfill({ json: { authenticated: true } }),
  );
  await page.route(
    /\/card-game\/shared\/worlds\/voice-w(?:\/command)?$/u,
    (route) =>
      route.fulfill({
        json: {
          ...dispatchShared({
            op: "view",
            world: shared,
            actor: "vale",
            claimed: ["vale"],
            present: ["vale"],
          }),
          id: "voice-w",
          version: "full-card-world/9",
          claimed: [1, 0, 0, 0, 0, 0, 0, 0],
          present: [1, 0, 0, 0, 0, 0, 0, 0],
          now: Date.now(),
          queue: [],
          history,
        },
      }),
  );
  await page.goto(`${origin()}/?world=voice-w`);
  await page.waitForFunction(() => document.body.inert === false);
  await revealCard(page, "vale");
  await revealCard(page, room);
  await page.waitForFunction(
    () => document.querySelector("#speech-row").dataset.voice === "playing",
  );
  assert.deepEqual(voices, [
    { world: "voice-w", play: "saved-voice-play", line: 0 },
  ]);
  await page.screenshot({ path: `output/voices/shared-voice-${width}.png` });
  await openSettings(page);
  const ids = await settingIds(page);
  assert(ids.includes("account"), `settings: ${ids}`);
  assert(!ids.includes("credits") && !ids.includes("pool"), `${ids}`);
  assert.deepEqual(errors, []);
  console.log(`Voiced a saved shared scene line free at ${width}px.`);
  await page.close();
}

const server = createServer();
const origin = () => `http://127.0.0.1:${server.address().port}`;
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
let browser;
try {
  browser = await chromium.launch({ headless: true });
  await mkdir("output/voices", { recursive: true });
  for (const [width, signedIn] of [
    [1440, true],
    [390, false],
  ]) {
    const page = await browser.newPage({ viewport: { width, height: 900 } });
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.route("**/auth/account", (route) =>
      route.fulfill({ json: { authenticated: signedIn } }),
    );
    await page.goto(`${origin()}/?table=voices-${width}`);
    await page.waitForFunction(() => document.body.inert === false);
    // The toolbar shows the world's logo as a plain image, not a button.
    await page.locator(".brand strong img.brand-logo").waitFor();
    assert.ok(await page.getAttribute(".brand-logo", "alt"));
    assert.equal(await page.locator(".brand button").count(), 0);
    await openSettings(page);
    const ids = await settingIds(page);
    assert(ids.includes("account"), `settings: ${ids}`);
    assert(!ids.includes("credits") && !ids.includes("pool"), `${ids}`);
    assert.equal(await page.locator("#credits, #speech-pack").count(), 0);
    await page.screenshot({ path: `output/voices/settings-${width}.png` });
    assert.deepEqual(errors, []);
    console.log(`Settings showed no credits at ${width}px.`);
    await page.close();
  }
  for (const width of [1440, 390]) await checkSharedVoice(width);
} finally {
  await browser?.close();
  await new Promise((resolve) => server.close(resolve));
}
