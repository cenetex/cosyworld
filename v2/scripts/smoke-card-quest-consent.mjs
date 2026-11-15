import assert from "node:assert/strict";
import { readFile, mkdir } from "node:fs/promises";
import { chromium } from "playwright";
import { createServer } from "../card-game/serve.mjs";
import { createWorld, decodeSave, encodeSave, questPreviews } from "../card-game/world.mjs";
import { dispatchShared } from "../card-game/shared-world.mjs";
import { DREAM_FROM, newWant } from "../card-game/want.mjs";
import { settleArcana } from "../card-game/world/arcana.mjs";
import { profiles } from "../card-game/memory.mjs";
import { clearSelection, selectCard, readyActionButton, smokeWidths } from "./card-browser-helpers.mjs";

const server = createServer();
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const app = await readFile(new URL("../card-game/app.mjs", import.meta.url), "utf8");
const probe = `\nglobalThis.consentProbe = { state: () => world, previews: () => questPreviews(world), sync: () => sharedSession?.sync() };`;
const output = new URL("../../output/quest-consent/", import.meta.url);
await mkdir(output, { recursive: true });
let browser;
try {
  browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_PATH });
  for (const width of smokeWidths([1440, 390])) for (const shared of [false, true]) {
    const page = await browser.newPage({ viewport: { width, height: width === 390 ? 844 : 900 }, reducedMotion: "reduce" });
    page.setDefaultTimeout(15000);
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    const legacy = settleArcana(createWorld({ seed: 17 }), "vale");
    legacy.actors.vale.place = "greek-gate";
    legacy.actors.vale.heldItem = null;
    legacy.actors.vale.want = { ...newWant("item", "oil", 0), from: "quest:box:greek-piraeus" };
    legacy.actors.vale.under = [{ ...newWant("item", "cloth", 0), from: "quest:box:greek-harbor" },
      { ...newWant("place", "attic", 0), from: DREAM_FROM, step: { verb: "rest" } }];
    legacy.actors.vale.arcana.proved = ["arcanum-5"];
    delete legacy.actors.vale.pendingQuests;
    const loaded = decodeSave(JSON.stringify(legacy));
    const worldId = `consent-${width}`, table = `${worldId}-${shared}`;
    const key = `cosyworld.reflected-shore.v1.${shared ? `shared.${worldId}.vale` : table}`;
    let snapshot = { actor: "vale", world: loaded, now: Date.now(), queue: [], history: [], actions: [],
      claimed: [true, false, false, false, false, false, false, false],
      present: [true, false, false, false, false, false, false, false] };
    let calls = 0, accepted = 0;
    await page.addInitScript(({ key, save, seen, shared }) => {
      if (!shared && !localStorage.getItem(key)) localStorage.setItem(key, save);
      localStorage.setItem(`${key}.seen`, JSON.stringify(seen));
      localStorage.setItem("cosyworld.dialogue.sound", "off");
    }, { key, save: encodeSave(legacy), seen: Object.keys(profiles), shared });
    await page.route("**/app.mjs", (r) => r.fulfill({ contentType: "text/javascript", body: app + probe }));
    await page.route("**/card-game/text", (r) => {
      calls++;
      const context = r.request().postDataJSON();
      return r.fulfill({ json: { revision: context.revision, model: "consent-fixture",
        entries: context.entities.map(({ id }) => ({ id, text: `I remember this quiet moment ${calls}.` })) } });
    });
    if (shared) {
      await page.route("**/auth/account", (r) => r.fulfill({ json: { authenticated: true, user_id: "consent-user", account_revision: 0 } }));
      await page.route(`**/card-game/shared/worlds/${worldId}**`, async (r) => {
        if (r.request().method() === "POST") {
          const command = r.request().postDataJSON();
          if (command.op === "play") {
            const next = dispatchShared({ ...command, world: snapshot.world, actor: "vale", claimed: ["vale"], present: ["vale"] });
            assert.equal(next.ok, true, next.error);
            snapshot.world = next.world;
            accepted += Number(command.action.offer !== undefined);
          } else assert(["heartbeat", "enter"].includes(command.op), command.op);
          snapshot.now = Math.max(Date.now(), snapshot.now + 1);
        }
        return r.fulfill({ json: snapshot });
      });
    }
    const url = `${origin}/?${shared ? `world=${worldId}` : `table=${table}`}`;
    const state = () => page.evaluate(() => window.consentProbe.state());
    const ready = (selector = null) => page.waitForFunction((selector) => {
      const next = document.getElementById("dialogue-advance");
      if (next?.checkVisibility() && next.dataset.revealing === "false") next.click();
      return document.getElementById("hand")?.dataset.cooling === "false" &&
        (!selector || document.querySelector(selector)?.checkVisibility());
    }, selector);
    await page.goto(url);
    await page.waitForFunction(() => Boolean(window.consentProbe));
    await ready();
    assert.equal((await state()).actors.vale.want, null);
    assert.equal((await state()).actors.vale.pendingQuests.length, 3);
    assert.equal(await page.locator("#hand .want-card").count(), 0);
    const source = questPreviews(loaded).find((q) => q.kind === "box");
    assert(source?.action);
    await clearSelection(page);
    await selectCard(page, source.source);
    assert.equal(await page.locator("[data-accept-quest]").isVisible(), true);
    const before = await state(), beforeCalls = calls;
    await page.locator("[data-accept-quest]").click();
    await page.waitForFunction((revision) => window.consentProbe.state().revision > revision, before.revision);
    await ready();
    assert.equal((await state()).turn, before.turn);
    assert.equal(calls, beforeCalls, "Accept requests no new narration");
    assert((await state()).actors.vale.want.accepted);
    assert.equal(await page.locator(`[data-card="${source.source}"]`).getAttribute("data-locked"), "true");
    assert.equal(await page.locator("#hand .want-card").count(), 1);
    await page.reload(); await ready();
    assert.equal((await state()).actors.vale.pendingQuests.length, 3);
    await clearSelection(page);
    if (!shared) {
      await selectCard(page, "vale");
      const turn = (await state()).turn;
      await readyActionButton(page, "wait").click();
      await page.waitForFunction((turn) => window.consentProbe.state().turn > turn, turn);
      await ready(); await clearSelection(page);
    }
    await selectCard(page, "vale");
    await ready("[data-review-quests]");
    await page.locator("[data-review-quests]").click();
    const captions = new Set();
    for (let i = 0; i < 6; i++) {
      captions.add(await page.locator(".action-beat-text").textContent());
      await page.locator("[data-next-quest]").click();
    }
    assert([...captions].some((text) => /Level II/u.test(text)), "level tracking stays available for review");
    assert([...captions].some((text) => /Rest at Mirror attic/u.test(text)), "old Sleep stays available for review");
    const first = await page.locator(".action-beat-text").textContent();
    await page.locator("[data-next-quest]").click();
    assert.notEqual(await page.locator(".action-beat-text").textContent(), first);
    assert.equal(await page.locator("[data-accept-quest]").isVisible(), true);
    for (let i = 0; i < 20; i++) {
      const text = await page.locator(".action-beat-text").textContent();
      if (/Oil/iu.test(text)) break;
      await page.locator("[data-next-quest]").click();
    }
    assert.match(await page.locator(".action-beat-text").textContent(), /Oil/iu);
    assert.match(await page.locator("#play-readout").textContent(), /Oil/iu);
    const pendingBefore = (await state()).actors.vale.pendingQuests;
    const line = await page.locator("#dialogue-text").textContent(), callsBefore = calls;
    await page.locator("[data-accept-quest]").click();
    await page.waitForFunction(() => window.consentProbe.state().actors.vale.pendingQuests.length === 2);
    assert.equal((await state()).actors.vale.want.target, "oil");
    assert.equal((await state()).actors.vale.want.since, pendingBefore.find((q) => q.target === "oil").since);
    assert.equal(calls, callsBefore);
    if (!shared) assert.equal(await page.locator("#dialogue-text").textContent(), line);
    if (shared) assert.equal(accepted, 2);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    await page.screenshot({ path: new URL(`${width}-${shared ? "shared" : "local"}.png`, output).pathname });
    assert.deepEqual(errors, []);
    await page.close();
    console.log(`Quest consent: ${width}px, shared=${shared}, passed.`);
  }
} finally {
  await browser?.close();
  server.close();
}
