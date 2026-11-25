import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { chromium } from "playwright";
import { createServer } from "../card-game/serve.mjs";
import { createWorld, encodeSave } from "../card-game/world.mjs";
import { profiles } from "../card-game/memory.mjs";
import { readyActionButton, selectCard, tapCard } from "./card-browser-helpers.mjs";

const FIELD = "greek-battlefield",
  SHADE = "greek-polynices-shade";
const fixture = createWorld({ opening: true });
Object.assign(fixture.opening, { crossed: true });
fixture.opening.met.moth ??= 0;
fixture.locations.attic.anchored = true;
fixture.crossings["pond-greek-harbor"].discovered = true;
fixture.actors.vale.place = FIELD;
fixture.actors.vale.visited.push("pond", "greek-harbor", "greek-gate", FIELD);
fixture.items.lamp.holder = "attic";
fixture.turn = fixture.revision = 33;

const output = new URL("../../output/shade-wake/", import.meta.url).pathname;
await mkdir(output, { recursive: true });
const server = createServer();
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({
  viewport: { width: 390, height: 844 },
  reducedMotion: "no-preference",
  hasTouch: true,
});
const key = "cosyworld.reflected-shore.v1.shade-wake",
  errors = [];
page.on("pageerror", (error) => errors.push(error.message));
await page.route("**/card-game/reflections", (route) =>
  route.fulfill({ status: 503, json: { error: "fixture" } }),
);
await page.route("**/card-game/text", (route) => {
  const input = route.request().postDataJSON();
  return route.fulfill({
    json: {
      revision: input.revision,
      model: "shade-wake-fixture",
      entries: input.entities.map(({ id }) => ({
        id,
        text: "The field is cold.",
      })),
    },
  });
});
await page.addInitScript(
  ({ key, save, seen }) => {
    if (!localStorage.getItem(key)) localStorage.setItem(key, save);
    localStorage.setItem(`${key}.seen`, JSON.stringify(seen));
    localStorage.setItem("cosyworld.dialogue.sound", "off");
  },
  { key, save: encodeSave(fixture), seen: Object.keys(profiles) },
);
const state = () =>
  page.evaluate((key) => JSON.parse(localStorage.getItem(key)), key);
const settle = async () => {
  await page.locator("#hand .card").first().waitFor();
  for (let i = 0; i < 400; i++) {
    if (await page.locator("#dialogue-advance").isVisible())
      await page
        .locator("#dialogue-advance")
        .click()
        .catch(() => {});
    if (
      !(await page.evaluate(() => document.body.dataset.sleep)) &&
      (await page.locator("#hand").getAttribute("data-cooling")) === "false"
    )
      return;
    await page.waitForTimeout(40);
  }
  throw new Error("The hand stayed busy.");
};
const shade = page.locator(`#hand [data-card="${SHADE}"]`);
try {
  await page.goto(
    `http://127.0.0.1:${server.address().port}/?table=shade-wake`,
  );
  await settle();
  for (const label of ["Wait", "Sleep"]) {
    await page.keyboard.press("Escape");
    await selectCard(page, "vale", { touch: true });
    const button = readyActionButton(page, "wait");
    await button.waitFor();
    assert.equal(await button.getAttribute("aria-label"), label);
    await button.click();
    if (label === "Wait") await settle();
  }
  await page.waitForFunction(() => document.body.dataset.sleep, null, {
    timeout: 30_000,
  });
  const during = await page.evaluate(() => ({
    beat: document.body.dataset.sleep,
    card: document.querySelector('#hand [data-card="vale"] img')?.src,
    stage: document.querySelector('#cast [data-avatar="vale"] img')?.src,
    catcher: document.querySelector(".sleep-catcher").hidden,
  }));
  assert.match(during.beat, /^(dim|lift)$/);
  assert.doesNotMatch(`${during.card} ${during.stage}`, /-sleeping/);
  assert.equal(during.catcher, true, "the wake leaves the hand to the player");
  const woke = await state();
  assert.equal(woke.log.findLast((e) => e.woke)?.woke, "arrival");
  assert.equal(woke.opening.met[SHADE], woke.turn);
  await page.waitForSelector(
    `#hand [data-card="${SHADE}"][data-unrevealed="true"]`,
  );
  await shade.scrollIntoViewIfNeeded();
  await page.waitForTimeout(500);
  await tapCard(shade, { touch: true });
  await page.waitForSelector(
    `#hand [data-card="${SHADE}"][data-unrevealed="false"][aria-pressed="true"]`,
  );
  const talk = readyActionButton(page, "talk");
  await talk.waitFor();
  assert.deepEqual(
    await page
      .locator("#card-actions button[data-action]")
      .evaluateAll((buttons) => buttons.map((b) => b.dataset.action)),
    ["talk"],
  );
  await talk.click();
  await settle();
  const plays = (await state()).log.filter(
    (e) => e.actorId === "vale" && e.kind === "action" && e.turn > woke.turn,
  );
  assert.deepEqual(
    plays.map((e) => [e.verb, e.turn]),
    [["talk", woke.turn + 1]],
  );
  assert.deepEqual(errors, []);
  console.log("Shade wake smoke passed.");
} catch (error) {
  await page.screenshot({ path: `${output}/failed-390.png` }).catch(() => {});
  throw error;
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
