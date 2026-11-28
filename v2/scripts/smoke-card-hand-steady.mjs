import assert from "node:assert/strict";
import { chromium } from "playwright";
import { createServer } from "../card-game/serve.mjs";
import { createWorld, encodeSave } from "../card-game/world.mjs";
import { newWant } from "../card-game/want.mjs";
import { holdItem, selectCard, setLampFuel, tapCard, readyActionButton } from "./card-browser-helpers.mjs";

const shots = process.env.COSYWORLD_HAND_SHOTS;
const server = createServer();
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ headless: true });
function fixture() {
  const s = createWorld({ packScopes: { "greek-drama": "full" } });
  s.turn = s.revision = 3;
  s.actors.vale.place = "greek-harbor";
  s.actors.vale.visited.push("pond");
  s.items.lamp.holder = "vale";
  setLampFuel(s, 12, "greek-harbor");
  s.actors.vale.want = newWant("place", "greek-courtyard", 0);
  return holdItem(s, "lamp");
}
function streamFixture() {
  const original = fetch.bind(window);
  window.fetch = (url, options) => {
    if (!String(url).endsWith("/card-game/text")) return original(url, options);
    let controller;
    const body = new ReadableStream({ start: (value) => (controller = value) });
    const send = (value) =>
      controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(value)}\n\n`));
    window.story = {
      input: JSON.parse(options.body),
      line: (id, text) => send({ type: "delta", text: `${JSON.stringify({ id, text })}\n` }),
      finish: (entries) => {
        send({
          type: "complete",
          revision: window.story.input.revision,
          model: "steady-fixture",
          entries,
          omitted: window.story.input.entities
            .map((e) => e.id)
            .filter((id) => !entries.some((e) => e.id === id)),
        });
        controller.close();
      },
    };
    return Promise.resolve(new Response(body, { headers: { "Content-Type": "text/event-stream" } }));
  };
}
const hand = (page) =>
  page.evaluate(() => ({
    chosen: [...document.querySelectorAll('#hand .card[aria-pressed="true"]')].map(
      (el) => el.dataset.card || el.dataset.questId,
    ),
    order: [...document.querySelectorAll("#hand .card[data-card]")].map((el) => el.dataset.card),
    collapsed: document.querySelector(".play-dock").dataset.selected,
    buttons: [...document.querySelectorAll("#card-actions button")]
      .filter((el) => el.offsetParent && !el.hidden)
      .map((el) => el.dataset.action || el.textContent.trim()),
    beat: !document.querySelector("#action-beat").hidden &&
      getComputedStyle(document.querySelector("#action-beat")).visibility !== "hidden",
  }));
try {
  for (const width of [390, 1440]) {
    const page = await browser.newPage({ viewport: { width, height: 844 }, reducedMotion: "no-preference" });
    page.setDefaultTimeout(15000);
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    const table = `steady-${width}`,
      key = `cosyworld.reflected-shore.v1.${table}`,
      world = fixture();
    await page.addInitScript(
      ({ key, save, seen }) => {
        if (localStorage.getItem(key)) return;
        localStorage.setItem(key, save);
        localStorage.setItem(`${key}.seen`, JSON.stringify(seen));
        localStorage.setItem("cosyworld.dialogue.sound", "off");
        localStorage.setItem("cosyworld.room-music", JSON.stringify({ enabled: false }));
      },
      {
        key,
        save: encodeSave(world),
        seen: [...Object.keys(world.actors), ...Object.keys(world.items), ...Object.keys(world.locations)],
      },
    );
    await page.addInitScript(streamFixture);
    await page.route(
      (url) => url.pathname === "/",
      async (route) => {
        const response = await route.fetch();
        await route.fulfill({
          response,
          body: (await response.text()).replace("<head>", '<head><meta name="cosy-local-app" content="1">'),
        });
      },
    );
    await page.route("**/card-game/local", (route) =>
      route.fulfill({ json: { schema: 1, dialogueModel: "steady-fixture", voiceModel: "off", voiceTimeoutMs: 1000 } }),
    );
    await page.goto(`${origin}/?table=${table}`);
    await page.locator('#hand [data-card="lamp"]').waitFor();
    await page.evaluate(() => {
      window.questTurns = 0;
      new MutationObserver((changes) => {
        for (const change of changes)
          if (change.target.matches(".want-card") && change.target.dataset.revealing) window.questTurns++;
      }).observe(document.querySelector("#hand"), { subtree: true, attributeFilter: ["data-revealing"] });
    });
    const fold = page.locator("#hand .quest-fold:not([data-owner])");
    if (await fold.isVisible()) await fold.dispatchEvent("click");
    else await tapCard(page.locator('#hand [data-quest-id="quest:0"].want-card'));
    await page.waitForFunction(() =>
      document.querySelector('#hand [data-quest-id="quest:0"].want-card')?.dataset.unrevealed === "false" &&
      !document.querySelector("#hand [data-revealing]"));
    await page.keyboard.press("Escape");
    const turnsSeen = await page.evaluate(() => window.questTurns);
    assert(turnsSeen <= 1, "Opening the quest turns it at most once");
    const playAndHear = async (kind, line, shot) => {
      const chosen = (await hand(page)).chosen;
      await readyActionButton(page, kind).click();
      await page.waitForFunction(() => window.story?.input);
      await page.evaluate((text) => {
        window.story.line("vale", text);
        window.story.finish([{ id: "vale", text }]);
      }, line);
      await page.waitForFunction(
        () =>
          document.querySelector("#dialogue-advance").dataset.revealing === "false" &&
          !document.querySelector("#hand [data-revealing]"),
      );
      await page.waitForTimeout(1200);
      assert.equal(
        await page.evaluate(() => [...document.querySelectorAll("#card-actions button")].some((b) => b.checkVisibility())),
        false,
        "The play's button waits for a tap on the reply",
      );
      await page.waitForFunction(() => document.querySelector("#speech-hint").textContent === "Tap to continue", null, { timeout: 5000 });
      await page.locator("#dialogue-advance").click();
      await page.waitForFunction(() =>
        document.querySelector("#card-actions button:not([hidden]):not([data-revealing=\"true\"])"),
      );
      const after = await hand(page);
      if (shots) await page.screenshot({ path: `${shots}/${shot}-${width}.png` });
      assert.deepEqual(after.chosen.sort(), chosen.sort(), "The chosen cards stay chosen after the turn");
      assert.equal(after.beat, true, "The chosen cards show their button again");
      assert(after.buttons.length === 1, JSON.stringify(after));
      return after;
    };
    await selectCard(page, "greek-harbor");
    await tapCard(page.locator('#hand [data-card="lamp"]'));
    assert.deepEqual((await hand(page)).chosen, ["greek-harbor"]);
    assert.deepEqual((await playAndHear("wait", "I wonder if the light will find its way.", "wait")).buttons, ["wait"]);
    await selectCard(page, "lamp");
    await selectCard(page, "greek-road-thebes");
    assert.deepEqual((await hand(page)).chosen.sort(), ["greek-road-thebes", "lamp"]);
    await playAndHear("move", "The road is warm under the lamp.", "move");
    await page.keyboard.press("Escape");
    await page.locator("#hand .quest-fold:not([data-owner])").dispatchEvent("click");
    await page.waitForTimeout(800);
    assert.equal(
      await page.locator('#hand [data-quest-id="quest:0"].want-card').getAttribute("data-unrevealed"),
      "false",
    );
    assert.equal(await page.evaluate(() => window.questTurns), turnsSeen, "A quest never turns again as turns pass");
    assert.deepEqual(errors, []);
    await page.close();
  }
} finally {
  await browser.close();
  server.close();
}
