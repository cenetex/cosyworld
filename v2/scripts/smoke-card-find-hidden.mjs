import assert from "node:assert/strict";
import { chromium } from "playwright";
import { createServer } from "../card-game/serve.mjs";
import { dispatchShared } from "../card-game/shared-world.mjs";

// One hidden avatar per world (#1936): ☰ names the avatar hidden in the
// world being played as "+ Find Mara", which asks for the quest to talk to
// them, and shows the avatars this passkey has not found as card backs.
const server = createServer();
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ headless: true });
const locked = ["rue", "ash", "nell", "orin", "ada"];
const world = dispatchShared({
  op: "create",
  seed: 7,
  hidden: "mara",
  absent: locked,
}).world;
// Seat order: vale, mara, ash, nell, tavi, rue, orin, ada.
const seats = (...held) => held.concat(Array(8 - held.length).fill(0));
const snapshot = () => ({
  ...dispatchShared({
    op: "view",
    world,
    actor: "vale",
    claimed: ["vale"],
    present: ["vale"],
  }),
  id: "here",
  version: "full-card-world/86",
  claimed: seats(1),
  present: seats(1),
  bound: seats(1),
  holders: seats(null),
  owner: true,
  now: Date.now(),
  queue: [],
  history: [],
});
try {
  for (const [width, height] of [
    [390, 844],
    [1440, 900],
  ]) {
    const page = await browser.newPage({
      viewport: { width, height },
      isMobile: width <= 390,
      hasTouch: width <= 390,
      reducedMotion: "reduce",
    });
    page.setDefaultTimeout(10000);
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    const commands = [];
    await page.route("**/auth/account", (route) =>
      route.fulfill({ json: { authenticated: true } }),
    );
    await page.route(/\/card-game\/shared\/worlds$/, (route) =>
      route.fulfill({
        json: {
          worlds: [
            { id: "here", owner: true, actor: "vale", held: seats(1), seed: 1 },
          ],
          unlocked: ["vale", "tavi"],
        },
      }),
    );
    await page.route(/\/card-game\/shared\/worlds\/here\/command$/, (route) => {
      const body = route.request().postDataJSON();
      if (!["enter", "heartbeat"].includes(body.op)) commands.push(body);
      route.fulfill({ json: snapshot() });
    });
    await page.route(/\/card-game\/shared\/worlds\/here$/, (route) =>
      route.fulfill({ json: snapshot() }),
    );
    await page.goto(`${origin}/?world=here`);
    await page.waitForFunction(() => document.body.inert === false);
    const menu = page.locator("#world-menu");
    await page.locator("#toolbar-menu-button").click();
    const find = menu.locator("#avatar-find");
    await find.waitFor();
    assert.equal(await find.innerText(), "+ Find Mara");
    assert.equal(await menu.locator("#avatar-new-world").count(), 0);
    // Not yet found: six card backs, Mara among them, and no names.
    const backs = menu.locator(".slot-locked img");
    assert.equal(await backs.count(), 6);
    assert.equal(
      await menu.locator(".slot-locked").getAttribute("aria-label"),
      "6 still to find",
    );
    await page.waitForFunction(() =>
      [...document.querySelectorAll("#world-menu img")].every(
        (i) => i.complete,
      ),
    );
    await page.screenshot({ path: `output/card-find-hidden-${width}.png` });
    await find.click();
    assert.deepEqual(commands.splice(0), [{ op: "seek" }]);
    assert.deepEqual(errors, []);
    await page.close();
  }
  console.log(
    "Find hidden: + Find Mara asks for the quest, and unfound avatars are card backs, at 390 and 1440.",
  );
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
