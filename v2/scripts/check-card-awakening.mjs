import {
  endStandoff,
  clearSelection,
  putOutOpening,
  selectCard,
  openSettings,
  closeSettings,
} from "./card-browser-helpers.mjs";
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { chromium } from "playwright";
import { createServer } from "../card-game/serve.mjs";
import { profiles } from "../card-game/memory.mjs";

const server = createServer();
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
let browser;
try {
  browser = await chromium.launch({
    headless: true,
    executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE,
  });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
    reducedMotion: "reduce",
  });
  const page = await context.newPage();
  page.setDefaultTimeout(20000);
  const errors = [];
  const requests = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("**/card-game/text", async (route) => {
    const input = route.request().postDataJSON();
    requests.push(input);
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        revision: input.revision,
        model: "browser-fixture",
        entries: input.entities.map(({ id, facts }) => ({
          id,
          text:
            id === "badger"
              ? facts.some((fact) => fact.startsWith("Asleep"))
                ? "Badger snores softly on the moss."
                : "I had almost finished that nap. Almost."
              : id === "clearing"
                ? "The old clock ticks above the warm moss."
                : `${profiles[id].name} notices the echo by the water.`,
        })),
      }),
    });
  });
  const ready = async () => {
    for (let i = 0; i < 250; i++) {
      if (
        (await page.locator("#hand").getAttribute("data-cooling")) === "false"
      )
        return;
      if (await page.locator("#dialogue-advance").isVisible())
        await page.locator("#dialogue-advance").click();
      await page.waitForTimeout(40);
    }
    throw new Error("The hand stayed busy after the scene response.");
  };
  const state = () =>
    page.evaluate(() =>
      JSON.parse(
        localStorage.getItem("cosyworld.reflected-shore.v1.badger-check"),
      ),
    );
  const play = async (id, expectedAction) => {
    await ready();
    // A held item stays raised after its play; start each play fresh.
    await clearSelection(page);
    await selectCard(page, id);
    if (expectedAction)
      assert.equal(await page.locator("#card-actions .card-primary").getAttribute("data-action"), expectedAction);
    await page.locator("#card-actions .card-primary").click();
    await ready();
  };
  const decode = () =>
    page.evaluate(() =>
      Promise.all(
        [...document.images]
          .filter((image) => image.getClientRects().length > 0)
          .map((image) => image.decode()),
      ),
    );
  await mkdir("output/badger-check", { recursive: true });
  await page.goto(`${origin}/?table=badger-check`);
  await page.locator('[data-card="lamp"]').waitFor({ state: "attached" });
  assert.equal((await state()).actors.vale.place, "attic");
  // Reveal the opening and stow the lamp quietly to open the mirror.
  await ready();
  // The pond already lies in the hand as a locked box; the lamp opens it.
  assert.equal(await page.locator('[data-card="pond"]').count(), 1);
  assert.equal((await state()).opened, undefined);
  await putOutOpening(page);
  await ready();
  assert.deepEqual((await state()).opened, { pond: ["vale"] });
  assert.equal((await state()).items.lamp.lit, false);
  assert.equal((await state()).turn, 0);
  assert.equal((await state()).actors.vale.heldItem, null);
  assert.equal((await state()).items.lamp.fuelRooms, 3);
  assert.equal((await state()).actors.vale.place, "attic");
  assert.ok(await page.locator('[data-card="pond"]').count());
  await play("pond");
  await play("station");
  await play("bell", "take");
  assert.equal((await state()).items.bell.holder, "vale");
  await play("pond");
  await play("bell");
  assert.equal((await state()).crossings["pond-clearing"].phase, 1);
  assert.equal((await state()).actors.vale.place, "pond");
  assert.equal(await page.locator("#speaker").textContent(), "echo");
  assert.equal(await page.locator("#dialogue-text").textContent(), "bong");
  const echoTurn = (await state()).turn;
  const echoRequests = requests.length;
  assert.equal(await page.locator('[data-card="bell"] .state').count(), 0);
  assert.doesNotMatch(await page.locator("#hand").innerText(), /Ring again/);
  await page.reload();
  await page.locator('[data-card="bell"]').waitFor({ state: "attached" });
  await ready();
  assert.equal(requests.length, echoRequests);
  assert.equal(
    (await state()).log.filter(
      (entry) => entry.generated && entry.turn === echoTurn,
    ).length,
    1,
  );
  assert.equal(await page.locator("#speaker").textContent(), "echo");
  assert.equal(await page.locator("#dialogue-text").textContent(), "bong");
  await play("bell");
  // The second ring reveals the clearing; its card takes Vale there.
  assert.equal((await state()).actors.vale.place, "pond");
  assert.equal((await state()).crossings["pond-clearing"].discovered, true);
  await play("clearing");
  assert.equal((await state()).actors.vale.place, "clearing");
  assert.equal((await state()).items.bell.holder, "vale");
  const sprite = page.locator(".stage-figure");
  assert.equal(requests.at(-1).location, "clearing");
  assert.ok(!requests.at(-1).speakers.includes("badger"));
  // Face down, the badger is not on stage yet (stage-reveal.mjs).
  assert.equal(await sprite.count(), 0);
  const before = (await state()).turn;
  await page.locator('[data-card="badger"]').focus();
  // The first press selects the closed box; its context button opens it.
  await page.keyboard.press("Enter");
  assert.equal(await page.locator('[data-card="badger"]').getAttribute("data-unrevealed"), "true");
  assert.equal((await state()).turn, before);
  await page.locator("#card-actions [data-open-box]").focus();
  await page.keyboard.press("Enter");
  await page.waitForFunction(
    () =>
      document.querySelector('[data-card="badger"]')?.dataset.unrevealed ===
        "false" &&
      !document.querySelector('[data-card="badger"]')?.dataset.revealing,
  );
  // Revealed, the sleeping badger is on stage.
  assert.equal(await sprite.getAttribute("data-resident"), "badger");
  assert.equal(await sprite.getAttribute("data-state"), "asleep");
  await decode();
  await page.screenshot({ path: "output/badger-check/desktop-asleep.png" });
  await page.locator('[data-card="badger"]').focus();
  assert.equal(
    await page.locator('[data-card="badger"]').getAttribute("aria-pressed"),
    "true",
  );
  assert.equal((await state()).turn, before);
  await page.keyboard.press("Escape");
  assert.equal(
    await page.locator('[data-card="badger"]').getAttribute("aria-pressed"),
    "false",
  );
  await page.keyboard.press("Enter");
  await page.keyboard.press("Tab");
  assert.equal(
    await page.evaluate(() => document.activeElement.className),
    "card-primary",
  );
  await page.keyboard.press("Enter");
  await ready();
  assert.equal((await state()).actors.badger.awake, true);
  assert.ok(requests.at(-1).speakers.includes("badger"));
  await decode();
  await page.screenshot({ path: "output/badger-check/desktop-awake.png" });
  await openSettings(page);
  await closeSettings(page);
  // Vale's level waits for her level quest (#1583), so Pip, a level up, would
  // pick a fight over the lamp as soon as she reaches the pond. Level her with
  // her experience so the walk there stays peaceful.
  await page.evaluate(() => {
    const key = "cosyworld.reflected-shore.v1.badger-check";
    const saved = JSON.parse(localStorage.getItem(key));
    saved.actors.vale.level = 2;
    localStorage.setItem(key, JSON.stringify(saved));
  });
  await page.reload();
  await page.locator('[data-card="bell"]').waitFor({ state: "attached" });
  await play("pond");
  assert.equal((await state()).actors.vale.place, "pond");
  await play("bell");
  // Pip, twice refused, still threatens over the lamp after the first ring,
  // and the standoff locks the room. Talking it out is a real play and breaks
  // the two-ring sequence; the truce keeps Pip quiet for the rings below.
  await ready();
  assert.ok(await endStandoff(page, await state()), "Pip threatens Vale");
  await ready();
  assert.equal((await state()).standoffs.length, 0);
  assert.equal((await state()).crossings["pond-clearing"].phase, 0);
  await play("bell");
  assert.equal((await state()).actors.vale.place, "pond");
  await play("bell");
  assert.equal((await state()).actors.vale.place, "pond");
  await play("clearing");
  assert.equal((await state()).actors.vale.place, "clearing");
  await page.reload();
  await page.locator('[data-card="badger"]').waitFor({ state: "attached" });
  await ready();
  assert.equal(await sprite.getAttribute("data-state"), "awake");
  await page.setViewportSize({ width: 390, height: 844 });
  await decode();
  await page.screenshot({ path: "output/badger-check/mobile-awake.png" });
  assert.equal(await page.evaluate(() => document.body.scrollWidth), 390);
  const compact = await page.evaluate(() => {
    const dialog = document.querySelector(".dialogue").getBoundingClientRect();
    const card = document
      .querySelector('#hand [data-card="vale"]')
      .getBoundingClientRect();
    // The name's letters, not its padded backing band, must stay in view.
    const name = document.createRange();
    name.selectNodeContents(
      document.querySelector('#hand [data-card="vale"] .name'),
    );
    const label = name.getBoundingClientRect();
    return {
      dialogHeight: dialog.height,
      footGap: innerHeight - dialog.bottom,
      topsShown: dialog.top - card.top,
      labelBottom: label.bottom,
      dialogTop: dialog.top,
      height: innerHeight,
      actionsHidden: document.querySelector(".action-panel").hidden,
    };
  });
  // On phones the dialogue is one fixed, compact box at the foot of the
  // screen, over the resting hand's feet (#1897): the cards' tops and names
  // show above it.
  assert(compact.dialogHeight <= 100, "A short reply keeps the compact box");
  assert(compact.footGap <= 40, "The speech box sits at the foot");
  assert(compact.topsShown >= 60, "Resting cards show their tops above it");
  assert(
    compact.labelBottom <= compact.dialogTop + 1,
    "Resting card names sit above the speech box",
  );
  assert(compact.actionsHidden, "The idle hand uses only the cards");
  console.log("Phone space:", compact);

  // Badger stays whole on the one stage and stands above the speech box. On
  // a phone the resting cards' tops show above that box (#1897), so like
  // every figure there they may pass in front of his feet; at rest, with no
  // beat, smoke-card-stage-fill keeps his feet above the hand.
  const bounds = await sprite.boundingBox();
  assert.ok(
    bounds.x >= -1 && bounds.x + bounds.width <= 391,
    "Badger is whole",
  );
  assert.ok(
    bounds.y + bounds.height * 0.92 <= compact.dialogTop,
    "Badger stands above the speech box",
  );
  const dockTop = (await page.locator(".play-dock").boundingBox()).y;
  assert.ok(
    (dockTop - bounds.y) / bounds.height >= 0.75,
    "Most of Badger shows above the hand",
  );
  await page.setViewportSize({ width: 320, height: 568 });
  await page.screenshot({
    path: "output/badger-check/small-phone.png",
    fullPage: true,
  });
  assert.equal(await page.evaluate(() => document.body.scrollWidth), 320);
  assert.deepEqual(errors, []);
  console.log(
    "Steam Clock browser check passed: attic start, revealed paths, bell pickup, two rings, reload, wake, keyboard, return, revisit, shared inventory, speech, and phone layouts.",
  );
} finally {
  await browser?.close();
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
}
