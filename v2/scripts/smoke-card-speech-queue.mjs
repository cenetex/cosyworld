// Each visible reply waits for a tap, including a movement reply and a late
// shared scene. The shared fixture uses the actual view adapter over HTTP.
import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { chromium } from "playwright";
import { createServer } from "../card-game/serve.mjs";
import { dispatchShared } from "../card-game/shared-world.mjs";
import { createWorld, encodeSave, addLog, legalActions, play } from "../card-game/world.mjs";
import { availableCards } from "../card-game/cards.mjs";
import { selectCard, smokeWidths } from "./card-browser-helpers.mjs";

const output = new URL("../../output/speech-queue/", import.meta.url);
const wiring = await readFile(new URL("../orchestrator-rust/src/card_shared/engine.rs", import.meta.url), "utf8");
const version = /const VERSION: &str = "([^"]+)"/u.exec(wiring)[1];
await mkdir(output, { recursive: true });
const server = createServer();
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({
  executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE, headless: true });
const reports = [];
const front = (page) => page.locator("#dialogue-text").textContent();
async function read(page) {
  const button = page.locator("#dialogue-advance");
  if (await button.getAttribute("data-revealing") === "true") await button.click();
  await button.click();
}
const text = { vale: "Skull, what is on the path? I can see your ears turning toward the garden, and I would like to hear what you have found.", skull: "Skull turns his ears toward the garden." };
async function open(page, url) {
  await page.goto(url);
  try {
    await page.waitForFunction(() => !document.body.inert && document.querySelector("#dialogue-text").textContent);
  } catch (error) {
    console.error(await page.evaluate(() => ({ inert: document.body.inert, text: document.body.innerText.slice(-2000) })));
    throw error;
  }
}
async function seed(page, key, world, stream = false) {
  await page.addInitScript(({ key, save, seen, stream, text }) => {
    if (save && !localStorage.getItem(key)) localStorage.setItem(key, save);
    localStorage.setItem(`${key}.seen`, JSON.stringify(seen));
    localStorage.setItem("cosyworld.dialogue.sound", "off");
    localStorage.setItem("cosyworld.room-music", JSON.stringify({ enabled: false }));
    window.speechQueueRequests = 0;
    const original = window.fetch.bind(window);
    window.fetch = (input, options) => {
      if (input !== "/card-game/text") return original(input, options);
      window.speechQueueRequests++;
      if (!stream) return original(input, options);
      const c = JSON.parse(options.body);
      const entries = Object.entries(text).map(([id, text]) => ({ id, text }));
      const event = (value) => new TextEncoder().encode(`data: ${JSON.stringify(value)}\n\n`);
      return Promise.resolve(new Response(new ReadableStream({ start(controller) {
        controller.enqueue(event({ type: "delta", text: JSON.stringify(entries[0]) + "\n" }));
        window.finishReply = () => {
          controller.enqueue(event({ type: "delta", text: JSON.stringify(entries[1]) + "\n" }));
          controller.enqueue(event({ type: "complete", revision: c.revision, model: "fixture", entries,
            omitted: c.entities.filter((e) => !entries.some((line) => line.id === e.id)).map((e) => e.id) }));
          controller.close();
        };
      } }), { headers: { "Content-Type": "text/event-stream" } }));
    };
  }, { key, save: encodeSave(world), seen: availableCards(world), stream, text });
}
try {
  for (const width of smokeWidths([1440, 390])) {
    const options = { viewport: { width, height: width === 390 ? 844 : 900 }, reducedMotion: "reduce" };
    let world = dispatchShared({ op: "create", save: encodeSave(createWorld({ seed: 7 })) }).world;
    const add = (id, text) => {
      addLog(world, id === "station" ? "Empty station" : "Vale", text, {
        generated: true, kind: id === "station" ? "narration" : "dialogue",
        actorId: id === "station" ? null : id, entityId: id, locationId: "station",
      });
      return world.log.at(-1);
    };
    const older = add("station", "An empty station watches the black shore.");
    const first = add("vale", "The timetable is strange. I will wait here.");
    const second = add("station", "The bell waits beside a timetable of unborn years.");
    const history = [
      { play: "older", room: "station", starts_at: Date.now() - 120000, lines: [older] },
      { play: "current", room: "station", starts_at: Date.now() - 60000, lines: [first, second] },
    ];
    const page = await browser.newPage({ ...options, reducedMotion: "no-preference" }), errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    const view = () => ({ ...dispatchShared({ op: "view", world, actor: "vale", claimed: ["vale"], present: ["vale"] }),
      id: "speech-queue", version, claimed: [1, 0, 0, 0, 0, 0, 0, 0],
      present: [1, 0, 0, 0, 0, 0, 0, 0], now: Date.now(), queue: [], history });
    await page.route("**/auth/account", (route) => route.fulfill({ json: { authenticated: true } }));
    await page.route(/\/card-game\/shared\/worlds\/speech-queue(?:\/command)?$/, (route) => route.fulfill({ json: view() }));
    await seed(page, "cosyworld.reflected-shore.v1.shared.speech-queue.vale", world);
    const url = `${origin}/?world=speech-queue`;
    await open(page, url);
    assert.equal(await front(page), first.text, "A fresh reader starts with the character.");
    const late = add("vale", "A later reply waits for your tap.");
    world.revision++;
    history.push({ play: "late", room: "station", starts_at: Date.now(), lines: [late], silent: ["keeper"] });
    await page.waitForTimeout(1800);
    assert.equal(await front(page), first.text, "Late speech stays queued.");
    await open(page, url);
    assert.equal(await front(page), first.text, "Reload keeps the first line.");
    await page.waitForTimeout(1000);
    assert.equal(await front(page), first.text, "The settled front keeps the same line.");
    await page.screenshot({ path: new URL(`shared-waiting-${width}.png`, output).pathname });
    await read(page);
    assert.equal(await front(page), second.text);
    await open(page, url);
    assert.equal(await front(page), second.text, "Reload keeps the second line.");
    await page.locator("#beat-behind").click({ position: { x: 100, y: 4 } });
    assert.equal(await front(page), first.text, "Older history stays readable.");
    await read(page);
    await read(page);
    assert.equal(await front(page), late.text);
    assert.equal(await page.locator("#dialogue-advance").getAttribute("data-revealing"), "true");
    await open(page, url);
    assert.equal(await front(page), late.text, "A partly read line resumes whole.");
    await read(page);
    assert.equal(await front(page), "…", "A silent reply has its own tap.");
    await open(page, url);
    assert.equal(await front(page), "…", "Reload preserves the silent reply.");
    assert.deepEqual(errors, []);
    reports.push({ width, mode: "shared", first: first.seq, second: second.seq, late: late.seq, errors });
    await page.screenshot({ path: new URL(`shared-${width}.png`, output).pathname });
    await page.close();

    // A shared waking scene can finish while the room is still facedown.
    // Later room speech must not keep the selected resident behind Continue.
    const intro = await browser.newPage({ ...options, reducedMotion: "reduce" });
    const introErrors = [];
    intro.on("pageerror", (error) => introErrors.push(error.message));
    world.actors.moth.place = "station";
    history[1].opening = true;
    history[1].actor = "vale";
    await intro.route("**/auth/account", (route) => route.fulfill({ json: { authenticated: true } }));
    await intro.route(/\/card-game\/shared\/worlds\/speech-queue(?:\/command)?$/, (route) => route.fulfill({ json: view() }));
    await seed(intro, "cosyworld.reflected-shore.v1.shared.speech-queue.vale", world);
    await intro.addInitScript(() => {
      localStorage.setItem("cosyworld.reflected-shore.v1.shared.speech-queue.vale.seen.covered", JSON.stringify(["station"]));
    });
    await open(intro, url);
    assert.equal(await front(intro), first.text, "The covered room starts at this avatar's opening.");
    await selectCard(intro, "moth");
    await read(intro);
    await intro.waitForFunction((text) => document.querySelector("#dialogue-text").textContent === text, second.text);
    await read(intro);
    await intro.locator('#card-actions [data-action="talk"]').waitFor({ state: "visible" });
    assert.notEqual(await front(intro), late.text, "Unrevealed room speech does not leak into the intro.");
    assert.deepEqual(introErrors, []);
    await intro.screenshot({ path: new URL(`shared-covered-intro-${width}.png`, output).pathname });
    reports.push({ width, mode: "shared-covered-intro", talkAvailable: true, errors: introErrors });
    await intro.close();

    for (const stream of [false, true]) {
      world = createWorld();
      world.actors.vale.place = "attic";
      world.items.cloth.holder = "vale";
      Object.assign(world.items.lamp, { holder: "attic", lit: true, fuel: 12 });
      for (const [kind, target] of [["move", "forest-cottage"], ["talk", "rati"], ["move", "forest-garden"], ["wait"], ["move", "forest-trail"]])
        world = play(world, legalActions(world).find((a) => a.kind === kind && (!target || a.target === target))).state;
      addLog(world, "Vale", "I have arrived.", { generated: true, kind: "dialogue", actorId: "vale", entityId: "vale", locationId: "forest-trail" });
      const local = await browser.newPage({ ...options, reducedMotion: "no-preference" }), errors = [];
      local.on("pageerror", (error) => errors.push(error.message));
      if (stream) {
        const html = await readFile(new URL("../card-game/index.html", import.meta.url), "utf8");
        await local.route(`${origin}/?table=local-queue`, (route) => route.fulfill({ contentType: "text/html", body: html.replace("<head>", '<head><meta name="cosy-local-app" content="1">') }));
        await local.route("**/card-game/local", (route) => route.fulfill({ json: { schema: 1 } }));
      }
      await local.route("**/card-game/reflections", (route) => route.fulfill({ json: { reflections: [] } }));
      await local.route("**/card-game/text", (route) => {
        const c = route.request().postDataJSON();
        const entries = Object.entries(text).map(([id, text]) => ({ id, text }));
        return route.fulfill({ json: { revision: c.revision, model: "fixture", entries,
          omitted: c.entities.filter((e) => !text[e.id]).map((e) => e.id) } });
      });
      await seed(local, "cosyworld.reflected-shore.v1.local-queue", world, stream);
      await open(local, `${origin}/?table=local-queue`);
      await selectCard(local, "skull");
      await local.locator('#card-actions [data-action="talk"]:not([data-revealing="true"])').click();
      await local.waitForFunction((text) => document.querySelector("#dialogue-text").textContent === text, text.vale);
      if (stream) await local.evaluate(() => window.finishReply());
      await local.waitForTimeout(500);
      assert.equal(await front(local), text.vale, "The movement reply waits for a tap.");
      assert.equal(await local.locator("#dialogue-advance").getAttribute("data-revealing"), "true");
      await open(local, `${origin}/?table=local-queue`);
      assert.equal(await front(local), text.vale, "Local reload keeps the partly read line.");
      assert.equal(await local.locator("#dialogue-advance").getAttribute("data-revealing"), "false");
      await local.waitForTimeout(600);
      await local.screenshot({ path: new URL(`local-waiting-${stream}-${width}.png`, output).pathname });
      const position = await local.evaluate(() => JSON.parse(localStorage.getItem("cosyworld.reflected-shore.v1.local-queue.reading")));
      await read(local);
      assert.equal(await front(local), text.skull);
      await open(local, `${origin}/?table=local-queue`);
      assert.equal(await front(local), text.skull, "A movement reply also resumes whole.");
      await local.evaluate((position) => {
        const key = "cosyworld.reflected-shore.v1.local-queue";
        const save = JSON.parse(localStorage.getItem(key));
        save.log = save.log.filter((entry) => !entry.generated || entry.seq > position.seq);
        localStorage.setItem(key, JSON.stringify(save));
        localStorage.setItem(`${key}.reading`, JSON.stringify(position));
      }, position);
      await open(local, `${origin}/?table=local-queue`);
      assert.equal(await front(local), text.skull, "A trimmed cursor resumes the next retained reply.");
      const legacy = JSON.parse(await local.evaluate(() => localStorage.getItem("cosyworld.reflected-shore.v1.local-queue")));
      addLog(legacy, "Moonlit trail", "Moonlight falls across the pawprints.", {
        generated: true, kind: "narration", entityId: "forest-trail", locationId: "forest-trail",
      });
      await local.evaluate((save) => {
        localStorage.setItem("cosyworld.reflected-shore.v1.local-queue", save);
        localStorage.removeItem("cosyworld.reflected-shore.v1.local-queue.reading");
      }, encodeSave(legacy));
      await open(local, `${origin}/?table=local-queue`);
      assert.equal(await front(local), text.skull, "An older save resumes the latest visible reply.");
      await local.waitForFunction(() => document.querySelector("#hand").dataset.cooling === "false");
      assert.equal(await local.evaluate(() => window.speechQueueRequests), 0, "Completed movement-only words are reused on reload.");
      await local.screenshot({ path: new URL(`local-${stream}-${width}.png`, output).pathname });
      assert.deepEqual(errors, []);
      reports.push({ width, mode: stream ? "local-stream" : "local-json", errors });
      await local.close();
    }
  }
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
await writeFile(new URL("evidence.json", output), JSON.stringify(reports, null, 2));
console.log(JSON.stringify(reports));
