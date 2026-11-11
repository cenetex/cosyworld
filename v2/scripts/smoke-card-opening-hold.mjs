import assert from "node:assert/strict";
import { chromium } from "playwright";
import { createServer } from "../card-game/serve.mjs";
import { revealCard, selectCard } from "./card-browser-helpers.mjs";
const server = createServer();
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE,
});
try {
  for (const width of [1440, 390]) {
    const page = await browser.newPage({
      viewport: { width, height: 900 },
      reducedMotion: "reduce",
    });
    const requests = [],
      errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.route("**/card-game/text", (route) => {
      const context = route.request().postDataJSON();
      requests.push({ route, context });
    });
    const waitForRequests = async (count) => {
      for (let tries = 0; requests.length < count && tries < 100; tries++)
        await page.waitForTimeout(50);
      assert.equal(requests.length, count);
    };
    const saved = () =>
      page.evaluate(() =>
        JSON.parse(localStorage.getItem("cosyworld.reflected-shore.v1")),
      );
    const awake = (world) =>
      world.log.filter(
        (entry) =>
          entry.generated &&
          entry.kind === "dialogue" &&
          entry.text === "Awake.",
      );
    const fulfill = ({ route, context }) =>
      route.fulfill({
        json: {
          revision: context.revision,
          model: "opening-hold-fixture",
          entries: context.entities.map(({ id }) => ({ id, text: "Awake." })),
        },
      });
    await page.goto(`http://127.0.0.1:${server.address().port}/?intro=1`);
    await page.waitForSelector('.title-intro[data-phase="ack"]');
    await page.keyboard.press("Escape");
    await page.waitForFunction(
      () =>
        document.querySelector('#hand [data-card="vale"]')?.dataset
          .unrevealed === "false",
    );
    await revealCard(page, "lamp", { keepSelected: true });
    await page.waitForFunction(
      () => !document.querySelector("#hand [data-revealing]"),
    );
    await waitForRequests(1);
    const turn = (await saved()).turn;
    for (const held of [null, "lamp", null]) {
      const before = requests.length;
      await selectCard(page, "lamp");
      await page.waitForFunction(
        (held) =>
          JSON.parse(localStorage.getItem("cosyworld.reflected-shore.v1"))
            .actors.vale.heldItem === held,
        held,
      );
      await waitForRequests(before + 1);
      const world = await saved();
      assert.equal(world.turn, turn);
      assert.equal(world.items.lamp.fuelRooms, 3);
      assert.equal(world.items.lamp.lit, held === "lamp");
      assert.equal(awake(world).length, 0);
      assert.equal(requests.at(-1).context.revision, world.revision);
    }
    // Old transports may finish after abort; their old revision never becomes prose.
    for (const stale of requests.slice(0, -1)) await fulfill(stale);
    await page.waitForTimeout(3200);
    assert.equal(awake(await saved()).length, 0);
    await fulfill(requests.at(-1));
    await page.waitForFunction(() =>
      JSON.parse(localStorage.getItem("cosyworld.reflected-shore.v1")).log.some(
        (entry) =>
          entry.generated &&
          entry.kind === "dialogue" &&
          entry.text === "Awake.",
      ),
    );
    assert.equal(awake(await saved()).length, 1);
    const count = requests.length;
    await page.reload();
    await page.waitForSelector("#hand .card");
    await page.waitForTimeout(200);
    assert.equal(awake(await saved()).length, 1);
    assert.equal(
      requests.length,
      count,
      "a completed opening does not restart on reload",
    );
    assert.deepEqual(errors, []);
    console.log(
      `Pending opening survives held/stowed choices and reload exactly once at ${width}px.`,
    );
    await page.close();
  }
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
