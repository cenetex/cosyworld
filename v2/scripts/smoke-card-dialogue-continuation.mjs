// Real Chrome client regression; envelopes are fixtures, not server trust evidence.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { chromium } from "playwright";
import { createServer } from "../card-game/serve.mjs";
import { createWorld, encodeSave, addLog, legalActions, play } from "../card-game/world.mjs";
import { availableCards } from "../card-game/cards.mjs";
import { selectCard, smokeWidths } from "./card-browser-helpers.mjs";
const server = createServer();
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ headless: true, executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE });
const key = "cosyworld.reflected-shore.v1.continuation";
const actorWords = "Skull, what have you found beside the garden path?";
const reply = "Skull turns his ears toward the garden.";
try {
  for (const width of smokeWidths([1440, 390])) for (const early of [false, true]) {
    let world = createWorld();
    world.actors.vale.place = "attic";
    world.items.cloth.holder = "vale";
    Object.assign(world.items.lamp, { holder: "attic", lit: true, fuel: 12 });
    for (const [kind, target] of [["move", "forest-cottage"], ["talk", "rati"], ["move", "forest-garden"], ["wait"], ["move", "forest-trail"]]) {
      const action = legalActions(world).find((a) => a.kind === kind && (!target || a.target === target));
      assert.ok(action, `${kind} ${target}`);
      world = play(world, action).state;
    }
    world.items.lamp.holder = "vale";
    world.actors.vale.heldItem = "lamp";
    addLog(world, "Vale", "I have arrived.", { generated: true, kind: "dialogue", actorId: "vale", entityId: "vale", locationId: "forest-trail" });
    const page = await browser.newPage({ viewport: { width, height: 900 }, reducedMotion: "reduce" });
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    if (early) {
      const html = await readFile(new URL("../card-game/index.html", import.meta.url), "utf8");
      await page.route(`${origin}/?table=continuation`, (route) => route.fulfill({ contentType: "text/html", body: html.replace("<head>", '<head><meta name="cosy-local-app" content="1">') }));
      await page.route("**/card-game/local", (route) => route.fulfill({ json: { schema: 1 } }));
    }
    await page.route("**/card-game/reflections", (route) => route.fulfill({ json: { reflections: [] } }));
    await page.addInitScript(({ key, save, seen }) => {
      if (!localStorage.getItem(key)) localStorage.setItem(key, save);
      localStorage.setItem(`${key}.seen`, JSON.stringify(seen));
      localStorage.setItem("cosyworld.dialogue.sound", "off");
      localStorage.setItem("cosyworld.room-music", JSON.stringify({ enabled: false }));
      window.requests = [];
      const original = window.fetch.bind(window);
      window.fetch = (input, options) => {
        if (input !== "/card-game/text") return original(input, options);
        const context = JSON.parse(options.body);
        const request = { context };
        window.requests.push(request);
        const event = (value) => new TextEncoder().encode(`data: ${JSON.stringify(value)}\n\n`);
        // Ignore transport abort deliberately: stale completions must be harmless.
        return Promise.resolve(new Response(new ReadableStream({ start(controller) {
          request.emit = (value) => { try { controller.enqueue(event(value)); } catch {} };
        } }), { headers: { "Content-Type": "text/event-stream" } }));
      };
    }, { key, save: encodeSave(world), seen: availableCards(world) });
    const saved = () => page.evaluate((key) => JSON.parse(localStorage.getItem(key)), key);
    const contexts = () => page.evaluate(() => window.requests.map((r) => r.context));
    const waitRequests = async (count) => { await page.waitForFunction((count) => window.requests.length >= count, count, { timeout: 5000 }).catch(async (e) => { console.error("Expected", count, "requests", (await contexts()).map((c) => ({revision:c.revision,speakers:c.speakers}))); throw e; }); };
    const line = (id, text) => ({ id, text, signed: { claims: { kind: "line", id, text }, signature: "client-fixture-only" } });
    const emit = (index, event) => page.evaluate(({ index, event }) => window.requests[index].emit(event), { index, event });
    const finish = async (index, stale = false) => {
      const c = (await contexts())[index];
      await emit(index, { type: "complete", revision: c.revision, model: "continuation-fixture", entries: c.entities.filter(({ id }) => c.speakers.includes(id) || (c.scenery && id === c.location) || id === c.focus).map(({ id }) => line(id, stale ? "Stale words must not appear." : id === "vale" ? actorWords : reply)), omitted: c.entities.filter(({ id }) => !c.speakers.includes(id) && !(c.scenery && id === c.location) && id !== c.focus).map(({id}) => id) });
    };
    await page.goto(`${origin}/?table=continuation`);
    await page.waitForFunction(() => !document.body.inert && document.querySelector("#dialogue-text").textContent);
    await selectCard(page, "lamp");
    await selectCard(page, "skull");
    await page.locator('#card-actions [data-action="talk"]:not([data-revealing="true"])').click({timeout:5000}).catch(async (e) => { console.error(await page.locator("body").innerText(), await contexts()); throw e; });
    await waitRequests(1);
    const original = (await contexts())[0];
    assert.ok(original.speakers.includes("vale") && original.speakers.includes("skull"));
    if (early) {
      await emit(0, { type: "delta", text: JSON.stringify(line("vale", actorWords)) + "\n" });
      await page.waitForFunction(({ key, text }) => JSON.parse(localStorage.getItem(key)).log.some((e) => e.text === text), { key, text: actorWords });
    }
    const before = await saved();
    const published = before.log.filter((e) => e.text === actorWords);
    const memories = (w) => Object.fromEntries(Object.entries(w.memories).map(([id, m]) => [id, m.events.filter((e) => e.text?.includes(actorWords))]));
    if (early) assert.ok(Object.values(memories(before)).some((events) => events.length));
    for (let i = 1; i <= 3; i++) {
      const count = (await contexts()).length;
      await selectCard(page, "lamp");
      await waitRequests(count + 1);
      const current = await saved(), c = (await contexts()).at(-1);
      assert.equal(current.turn, before.turn);
      assert.deepEqual(current.log.filter((e) => e.text === actorWords), published);
      assert.deepEqual(memories(current), memories(before));
      assert.equal(c.outcome.avatars.find((a) => a.id === "vale").heldItem, current.actors.vale.heldItem);
      assert.equal(current.items.lamp.lit, current.actors.vale.heldItem === "lamp");
      assert.equal(current.items.lamp.fuelRooms, before.items.lamp.fuelRooms);
      assert.ok(c.entities.find((e) => e.id === "lamp").facts.some((fact) => fact.includes(`; ${current.items.lamp.lit ? "lit" : "unlit"};`)));
      if (early) {
        assert.deepEqual(c.speakers, original.speakers.filter((id) => id !== "vale"));
        assert.ok(c.speakers.includes("skull"));
        assert.ok(c.conversation.some((e) => e.actorId === "vale" && e.text === actorWords && e.signed));
      }
    }
    for (let i = 0; i < (await contexts()).length - 1; i++) await finish(i, true);
    await page.waitForTimeout(250);
    assert.ok(!(await saved()).log.some((e) => e.text === "Stale words must not appear."));
    if (early) {
      await page.reload();
      await waitRequests(1);
      const c = (await contexts())[0];
      assert.ok(!c.speakers.includes("vale") && c.speakers.includes("skull"));
      assert.ok(c.conversation.some((e) => e.text === actorWords && e.signed));
      assert.deepEqual((await saved()).log.filter((e) => e.text === actorWords), published);
      assert.deepEqual(memories(await saved()), memories(before));
    }
    await finish((await contexts()).length - 1);
    await page.waitForFunction(({ key, reply }) => JSON.parse(localStorage.getItem(key)).log.some((e) => e.text === reply), { key, reply });
    assert.equal((await saved()).log.filter((e) => e.text === actorWords).length, 1);
    await page.reload();
    await page.waitForSelector("#hand .card");
    await page.waitForTimeout(500);
    assert.equal((await contexts()).length, 0, "completed scenes do not restart");
    assert.equal((await saved()).log.filter((e) => e.text === actorWords).length, 1);
    assert.deepEqual(errors, []);
    console.log(`Dialogue continuation ${early ? "validated stream" : "pending ordinary"} passed at ${width}px.`);
    await page.close();
  }
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
