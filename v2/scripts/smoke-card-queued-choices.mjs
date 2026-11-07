import assert from "node:assert/strict";
import { chromium } from "playwright";
import { createServer } from "../card-game/serve.mjs";
import {
  createWorld,
  encodeSave,
  legalActions,
  play,
} from "../card-game/world.mjs";
import { newWant, setQuests } from "../card-game/want.mjs";
import {
  selectCard,
  readyActionButton,
  tapCard,
} from "./card-browser-helpers.mjs";

const server = createServer();
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ headless: true });
const words = {
  vale: "May I read the decree? I want to understand what the city has ordered.",
  "greek-guard":
    "A body lies exposed beyond the gate. Creon's decree forbids burial. Read the seal before you go.",
};
function fixture() {
  let s = createWorld({ packScopes: { "greek-drama": "full" } });
  s.turn = s.revision = 3;
  s.actors.vale.place = "greek-gate";
  s.actors.vale.visited.push("pond");
  s.items.cloth.holder = "greek-gate";
  s = play(
    s,
    legalActions(s).find((a) => a.kind === "wait"),
  ).state;
  setQuests(s.actors.vale, [
    newWant("item", "oil", 0),
    newWant("person", "keeper", 0),
  ]);
  return s;
}
function streamFixture() {
  const original = fetch.bind(window);
  window.fetch = (url, options) => {
    if (!String(url).endsWith("/card-game/text")) return original(url, options);
    let controller;
    const body = new ReadableStream({
      start: (value) => {
        controller = value;
      },
    });
    const send = (value) =>
      controller.enqueue(
        new TextEncoder().encode(`data: ${JSON.stringify(value)}\n\n`),
      );
    window.story = {
      input: JSON.parse(options.body),
      line: (id, text) =>
        send({ type: "delta", text: `${JSON.stringify({ id, text })}\n` }),
      finish: (entries) => {
        send({
          type: "complete",
          revision: window.story.input.revision,
          model: "queue-fixture",
          entries,
          omitted: window.story.input.entities
            .map((e) => e.id)
            .filter((id) => !entries.some((e) => e.id === id)),
        });
        controller.close();
      },
    };
    return Promise.resolve(
      new Response(body, { headers: { "Content-Type": "text/event-stream" } }),
    );
  };
}
try {
  for (const width of [1440, 390])
    for (const choice of ["take", "quest"]) {
      const page = await browser.newPage({
        viewport: { width, height: 900 },
        reducedMotion: "no-preference",
      });
      page.setDefaultTimeout(15000);
      const errors = [];
      page.on("pageerror", (error) => errors.push(error.message));
      const table = `queued-${width}-${choice}`,
        key = `cosyworld.reflected-shore.v1.${table}`,
        world = fixture();
      await page.addInitScript(
        ({ key, save, seen }) => {
          localStorage.setItem(key, save);
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
          seen: [
            ...Object.keys(world.actors),
            ...Object.keys(world.items),
            ...Object.keys(world.locations),
          ],
        },
      );
      await page.addInitScript(streamFixture);
      await page.route(
        (url) => url.pathname === "/",
        async (route) => {
          const response = await route.fetch();
          await route.fulfill({
            response,
            body: (await response.text()).replace(
              "<head>",
              '<head><meta name="cosy-local-app" content="1">',
            ),
          });
        },
      );
      await page.route("**/card-game/local", (route) =>
        route.fulfill({
          json: {
            schema: 1,
            dialogueModel: "queue-fixture",
            voiceModel: "off",
            voiceTimeoutMs: 1000,
          },
        }),
      );
      await page.goto(`${origin}/?table=${table}`);
      await selectCard(page, "greek-guard");
      await selectCard(page, "greek-decree");
      await readyActionButton(page, "ask").click();
      await page.waitForFunction(() => window.story?.input);
      await page.evaluate(
        (text) => window.story.line("vale", text),
        words.vale,
      );
      await page.waitForFunction(
        () =>
          document.querySelector("#speaker-portrait").dataset.entity ===
            "vale" &&
          document.querySelector("#dialogue-text").textContent.length > 0,
      );
      if (choice === "take") await selectCard(page, "cloth");
      else {
        await selectCard(page, "vale");
        const fold = page.locator("#hand .quest-fold");
        if (await fold.isVisible()) await fold.click();
        const lower = page.locator('#hand [data-quest-id="quest:1"].want-card');
        if (!(await lower.isVisible()))
          await tapCard(
            page.locator('#hand [data-quest-id="quest:0"].want-card'),
          );
        await lower.click();
      }
      assert.equal(
        await page.locator("#action-beat").isVisible(),
        false,
        "Speech keeps the front while a choice waits",
      );
      await page.evaluate((words) => {
        window.story.line("greek-guard", words["greek-guard"]);
        window.story.finish(
          Object.entries(words).map(([id, text]) => ({ id, text })),
        );
      }, words);
      await page.waitForFunction(
        () =>
          document.querySelector("#dialogue-advance").dataset.revealing ===
          "false",
      );
      assert.equal(
        await page.locator("#speaker-portrait").getAttribute("data-entity"),
        "vale",
      );
      await page.locator("#speech-row").click();
      await page.waitForFunction(
        () =>
          document.querySelector("#speaker-portrait").dataset.entity ===
          "greek-guard",
      );
      assert.equal(await page.locator("#action-beat").isVisible(), false);
      await page.waitForFunction(
        () =>
          document.querySelector("#dialogue-advance").dataset.revealing ===
          "false",
      );
      assert.equal(
        await page.locator("#action-beat").isVisible(),
        false,
        "The last reply waits for Continue",
      );
      const before = await page.evaluate(
        (key) => JSON.parse(localStorage.getItem(key)),
        key,
      );
      await page.locator("#speech-row").click();
      if (choice === "take") {
        await readyActionButton(page, "take").click();
        await page.waitForFunction(
          (key) =>
            JSON.parse(localStorage.getItem(key)).items.cloth.holder === "vale",
          key,
        );
      } else {
        await page.locator('#card-actions [data-drop-quest="0"]').waitFor();
        assert.doesNotMatch(
          await page.locator(".dialogue").innerText(),
          /turns to another quest/,
        );
      }
      const after = await page.evaluate(
        (key) => JSON.parse(localStorage.getItem(key)),
        key,
      );
      assert.equal(after.revision, before.revision + 1);
      assert.equal(after.turn, before.turn + Number(choice === "take"));
      assert(
        after.log.some((e) => e.verb === "ask" && e.itemId === "greek-decree"),
      );
      assert.deepEqual(errors, []);
      console.log(JSON.stringify({ width, choice, revision: after.revision }));
      await page.close();
    }
} finally {
  await browser.close();
  server.close();
}
