// Each visible reply waits for a tap, including a movement reply and a late
// shared scene. The shared fixture uses the actual view adapter over HTTP.
import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { chromium } from "playwright";
import { createServer } from "../card-game/serve.mjs";
import { dispatchShared } from "../card-game/shared-world.mjs";
import { createWorld, encodeSave, addLog, legalActions, play } from "../card-game/world.mjs";
import { availableCards } from "../card-game/cards.mjs";
import { selectCard } from "./card-browser-helpers.mjs";

const output = new URL("../../output/speech-queue/", import.meta.url);
await mkdir(output, { recursive: true });
const server = createServer();
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ headless: true });
const reports = [];
const front = (page) => page.locator("#dialogue-text").textContent();
async function read(page) {
  const button = page.locator("#dialogue-advance");
  if (await button.getAttribute("data-revealing") === "true") await button.click();
  await button.click();
}
const text = { vale: "Skull, what is on the path?", skull: "Skull turns his ears toward the garden." };
async function open(page, url) {
  await page.goto(url);
  await page.waitForFunction(() => !document.body.inert && document.querySelector("#dialogue-text").textContent);
}
async function seed(page, key, world, stream = false) {
  await page.addInitScript(({ key, save, seen, stream, text }) => {
    if (save && !localStorage.getItem(key)) localStorage.setItem(key, save);
    localStorage.setItem(`${key}.seen`, JSON.stringify(seen));
    localStorage.setItem("cosyworld.dialogue.sound", "off");
    localStorage.setItem("cosyworld.room-music", JSON.stringify({ enabled: false }));
    if (!stream) return;
    const original = window.fetch.bind(window);
    window.fetch = (input, options) => {
      if (input !== "/card-game/text") return original(input, options);
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
  for (const width of [1440, 390]) {
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
      id: "speech-queue", version: "full-card-world/117", claimed: [1, 0, 0, 0, 0, 0, 0, 0],
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

    for (const stream of [false, true]) {
      world = createWorld();
      world.actors.vale.place = "attic";
      world.items.cloth.holder = "vale";
      Object.assign(world.items.lamp, { holder: "attic", lit: true, fuel: 12 });
      for (const [kind, target] of [["move", "forest-cottage"], ["talk", "rati"], ["move", "forest-garden"], ["wait"], ["move", "forest-trail"]])
        world = play(world, legalActions(world).find((a) => a.kind === kind && (!target || a.target === target))).state;
      addLog(world, "Vale", "I have arrived.", { generated: true, kind: "dialogue", actorId: "vale", entityId: "vale", locationId: "forest-trail" });
      const local = await browser.newPage(options), errors = [];
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
      await local.screenshot({ path: new URL(`local-waiting-${stream}-${width}.png`, output).pathname });
      await read(local);
      assert.equal(await front(local), text.skull);
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
