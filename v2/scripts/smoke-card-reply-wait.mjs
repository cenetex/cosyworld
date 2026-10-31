import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { chromium } from "playwright";
import { createServer } from "../card-game/serve.mjs";
import {
  createWorld,
  encodeSave,
  legalActions,
  play,
  addLog,
  nameOf,
} from "../card-game/world.mjs";
import { availableCards } from "../card-game/cards.mjs";
import { selectCard } from "./card-browser-helpers.mjs";

const server = createServer();
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ headless: true });
const app = await readFile(
  new URL("../card-game/app.mjs", import.meta.url),
  "utf8",
);
// Pip must stay to answer here: a partner who walks away this turn speaks at
// the destination. On this turn Pip leaves the station when Rue asks.
const scenePlace = (actor) => (actor === "rue" ? "pond" : "station");
function fixture(actor) {
  const place = scenePlace(actor);
  const world = createWorld();
  world.playerActorId = actor;
  world.sharedVersion = 1;
  world.controlledActors = [actor];
  world.presentActors = [actor];
  for (const id of [actor, "moth", "keeper"]) world.actors[id].place = place;
  world.items.lamp.holder = "moth";
  addLog(world, "Vale", "An earlier line from Vale.", {
    generated: true,
    kind: "dialogue",
    actorId: "vale",
    locationId: place,
  });
  return play(
    world,
    legalActions(world).find((action) => action.kind === "wait"),
  ).state;
}
async function seed(page, key, world) {
  await page.addInitScript(
    ({ key, save, seen }) => {
      if (!localStorage.getItem(key)) localStorage.setItem(key, save);
      localStorage.setItem(`${key}.seen`, JSON.stringify(seen));
      localStorage.setItem("cosyworld.dialogue.sound", "off");
      localStorage.setItem(
        "cosyworld.room-music",
        JSON.stringify({ enabled: false }),
      );
    },
    {
      key,
      save: encodeSave(world),
      seen: availableCards(world),
    },
  );
}
async function waitingFor(page, id) {
  await page.waitForFunction(
    (id) =>
      document.querySelector("#speaker-portrait").dataset.entity === id &&
      document.querySelector("#speech-row").getAttribute("aria-busy") ===
        "true",
    id,
  );
  assert.equal(await page.locator("#speaker").innerText(), nameOf(id));
  assert.equal(await page.locator("#dialogue-text").innerText(), "");
}
// Stepping back from the wait reaches the last accepted line, past any
// later action beats; ● live returns to the wait.
async function reviewsEarlierLine(page, id) {
  for (
    let step = 0;
    step < 10 &&
    (await page.locator("#dialogue-text").innerText()) !==
      "An earlier line from Vale.";
    step++
  )
    await page.locator("#beat-behind").click();
  assert.equal(await page.locator("#speaker").innerText(), "Vale");
  assert.equal(
    await page.locator("#dialogue-text").innerText(),
    "An earlier line from Vale.",
  );
  await page.getByRole("button", { name: /^Return to live dialogue/ }).click();
  await waitingFor(page, id);
}
const reports = [];
// Stream the story by hand so each line arrives when the check says.
function storyStream() {
  const fetch = globalThis.fetch;
  globalThis.fetch = (url, options) => {
    if (!String(url).endsWith("/card-game/text")) return fetch(url, options);
    let controller;
    const body = new ReadableStream({ start: (value) => (controller = value) });
    const encoder = new TextEncoder();
    const send = (event) =>
      controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
    globalThis.story = {
      input: JSON.parse(options.body),
      line: (id, text) =>
        send({ type: "delta", text: `${JSON.stringify({ id, text })}\n` }),
      complete: (value) => send({ type: "complete", ...value }),
    };
    return Promise.resolve(
      new Response(body, { headers: { "Content-Type": "text/event-stream" } }),
    );
  };
}
// The desktop app streams each validated line as soon as it is ready.
async function desktopApp(page) {
  await page.route(
    (url) => url.pathname === "/",
    async (route) => {
      const response = await route.fetch();
      const body = (await response.text()).replace(
        "<head>",
        '<head><meta name="cosy-local-app" content="1">',
      );
      await route.fulfill({ response, body });
    },
  );
  await page.route("**/card-game/local", (route) =>
    route.fulfill({
      json: {
        schema: 1,
        dialogueModel: "reply-wait-fixture",
        voiceModel: "off",
        voiceTimeoutMs: 1000,
      },
    }),
  );
}
const words = (id) => `Accepted words for ${id}.`;
async function shows(page, id) {
  await page.waitForFunction(
    ({ id, text }) =>
      document.querySelector("#speaker-portrait").dataset.entity === id &&
      document.querySelector("#dialogue-text").textContent.includes(text),
    { id, text: words(id) },
  );
  assert.equal(await page.locator("#speaker").innerText(), nameOf(id));
}
async function localCheck(width, actor, kind, mode) {
  console.log(`Reply wait: ${actor} ${kind} ${mode} at ${width}px`);
  const page = await browser.newPage({
    viewport: { width, height: 900 },
    reducedMotion: "reduce",
  });
  const errors = [];
  page.setDefaultTimeout(10000);
  page.on("pageerror", (e) => errors.push(e.message));
  const world = fixture(actor),
    table = `reply-${actor}-${mode}-${width}`;
  const key = `cosyworld.reflected-shore.v1.${table}`;
  await seed(page, key, world);
  await page.addInitScript(storyStream);
  if (mode === "streamed") await desktopApp(page);
  await page.goto(`${origin}/?table=${table}`);
  await selectCard(page, "moth");
  if (kind === "ask") await selectCard(page, "lamp");
  await page.locator(`#card-actions [data-action="${kind}"]`).first().click();
  await page.waitForFunction(() => globalThis.story);
  const speakers = await page.evaluate(() => globalThis.story.input.speakers);
  assert.deepEqual(speakers.slice(0, 2), [actor, "moth"]);
  const finish = (from) =>
    page.evaluate(
      ({ speakers, from }) => {
        const entries = globalThis.story.input.entities.map(({ id }) => ({
          id,
          text: `Accepted words for ${id}.`,
        }));
        // Lines stream in speaking order; the completion carries every entity.
        for (const id of speakers.slice(from))
          globalThis.story.line(id, `Accepted words for ${id}.`);
        globalThis.story.complete({
          revision: globalThis.story.input.revision,
          model: "reply-wait-fixture",
          entries,
        });
      },
      { speakers, from },
    );
  // The player's avatar speaks first, so it thinks first.
  await waitingFor(page, actor);
  await reviewsEarlierLine(page, actor);
  if (mode === "streamed") {
    await page.evaluate(
      ([id, text]) => globalThis.story.line(id, text),
      [actor, words(actor)],
    );
    await shows(page, actor);
    // After that line's reading pause, the reply partner thinks.
    await waitingFor(page, "moth");
    await finish(1);
  } else {
    // A whole exchange plays in speaking order.
    await finish(speakers.length);
    await shows(page, actor);
  }
  await shows(page, "moth");
  assert.deepEqual(errors, []);
  reports.push({ width, actor, kind, [mode]: "passed" });
  await page.close();
}
try {
  for (const width of [1440, 390]) {
    for (const [actor, kind] of [
      ["vale", "talk"],
      ["rue", "ask"],
    ]) {
      for (const mode of ["hosted", "streamed"])
        await localCheck(width, actor, kind, mode);
      const world = fixture(actor);
      const shared = await browser.newPage({
        viewport: { width, height: 900 },
        reducedMotion: "reduce",
      });
      const sharedErrors = [];
      shared.on("pageerror", (e) => sharedErrors.push(e.message));
      const committed = play(
        world,
        legalActions(world).find((a) => a.kind === kind && a.target === "moth"),
      ).state;
      let snapshot = {
        actor,
        world: committed,
        now: Date.now(),
        actions: [],
        queue: [{ id: "reply", actor, status: "working" }],
        history: [],
        claimed: [true, true, true, true, true, true, true, true],
        present: [true, true, true, true, true, true, true, true],
      };
      await seed(
        shared,
        `cosyworld.reflected-shore.v1.shared.reply-wait.${actor}`,
        committed,
      );
      await shared.route("**/app.mjs", (route) =>
        route.fulfill({
          contentType: "text/javascript",
          body: app + "\nglobalThis.syncReply = () => sharedSession.sync();\n",
        }),
      );
      await shared.route("**/auth/account", (route) =>
        route.fulfill({ json: { authenticated: true } }),
      );
      await shared.route("**/card-game/shared/worlds/reply-wait**", (route) =>
        route.fulfill({ json: snapshot }),
      );
      await shared.goto(`${origin}/?world=reply-wait`);
      // A shared exchange arrives whole, so the acting avatar thinks first.
      await waitingFor(shared, actor);
      await reviewsEarlierLine(shared, actor);
      // The next play's wait replaces the old one, even with old Vale speech saved.
      snapshot = structuredClone(snapshot);
      const next = structuredClone(committed);
      next.actors.keeper.place = scenePlace(actor);
      const reply = legalActions(next).find(
        (a) => a.kind === "talk" && a.target === "keeper",
      );
      assert(reply, "The next reply partner is present");
      snapshot.world = play(next, reply).state;
      snapshot.now++;
      await shared.evaluate(async () => {
        await globalThis.syncReply();
      });
      await waitingFor(shared, actor);
      snapshot = structuredClone(snapshot);
      snapshot.queue = [];
      snapshot.now++;
      await shared.evaluate(async () => {
        await globalThis.syncReply();
      });
      await shared.waitForFunction(
        () =>
          document.querySelector("#speech-row").getAttribute("aria-busy") ===
          "false",
      );
      assert.deepEqual(sharedErrors, []);
      reports.push({ width, actor, kind, shared: "passed" });
      await shared.close();
    }
  }
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
console.log(JSON.stringify({ replyWait: reports }));
