// One stage draws every place. At each place a player can stand in (the
// attic, pond, station, Steam Clock, Greek, Hoppycat, Willows and Lonely
// Forest places), the painted backdrop fills the stage and every figure stands
// whole on it: the floor cast, and a resident anchored to the painting itself.
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { chromium } from "playwright";
import { createServer } from "../card-game/serve.mjs";
import { encodeSave, places, validateWorld } from "../card-game/world.mjs";
import { openDoorStart } from "../../test/helpers/open-door.mjs";

const output = new URL("../../output/stage-fill/", import.meta.url);
await mkdir(output, { recursive: true });

// Every place an open-door save can stand Vale in, without a journey.
const seeds = Object.keys(places).flatMap((place) => {
  const world = openDoorStart();
  world.actors.vale.place = place;
  try {
    // encodeSave trusts a world the rules just validated, so check the moved
    // avatar in full before saving it.
    validateWorld(world);
    return [[place, encodeSave(world)]];
  } catch {
    return [];
  }
});
for (const required of [
  "attic",
  "pond",
  "station",
  "clearing",
  "greek-harbor",
  "willows-camp",
  "forest-cottage",
])
  assert(
    seeds.some(([place]) => place === required),
    `${required} is staged`,
  );

const server = createServer();
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ headless: true });
try {
  for (const [index, [place, save]] of seeds.entries()) {
    const page = await browser.newPage({
      viewport: { width: 1440, height: 900 },
      reducedMotion: "reduce",
    });
    page.setDefaultTimeout(15000);
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.route("**/card-game/text", async (route) => {
      const c = route.request().postDataJSON();
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          revision: c.revision,
          model: "stage-fill-fixture",
          entries: c.entities.map(({ id }) => ({ id, text: "Hm." })),
        }),
      });
    });
    // Table names are short, so each place takes a numbered table.
    const table = `stage-fill-${index}`;
    const key = `cosyworld.reflected-shore.v1.${table}`;
    await page.addInitScript(
      ({ key, save }) => {
        if (!localStorage.getItem(key)) localStorage.setItem(key, save);
        localStorage.setItem("cosyworld.dialogue.sound", "off");
      },
      { key, save },
    );
    await page.goto(`${origin}/?table=${table}`);
    await page.locator("#hand .card").first().waitFor({ state: "attached" });
    // Settle any arrival dialogue until the stage shows this place. The
    // layout does not wait on a hand that stays busy.
    const deadline = Date.now() + 20000;
    while (Date.now() < deadline) {
      if (await page.locator("#dialogue-advance").isVisible())
        await page.locator("#dialogue-advance").click();
      else if (
        (await page.evaluate(() => document.body.dataset.place)) === place &&
        (Date.now() > deadline - 12000 ||
          (await page.locator("#hand").getAttribute("data-cooling")) ===
            "false")
      )
        break;
      await page.waitForTimeout(30);
    }
    assert.equal(await page.evaluate(() => document.body.dataset.place), place);
    for (const [width, height] of [
      [1440, 900],
      [390, 844],
      [844, 390],
    ]) {
      await page.setViewportSize({ width, height });
      await page.waitForFunction(() =>
        [...document.querySelectorAll(".stage img")]
          .filter((image) => image.getClientRects().length > 0)
          .every((image) => image.complete && image.naturalWidth > 0),
      );
      await page.waitForTimeout(150);
      const m = await page.evaluate(() => {
        const box = (el) => {
          const r = el.getBoundingClientRect();
          return { left: r.left, top: r.top, right: r.right, bottom: r.bottom };
        };
        const backdrop = document.querySelector("#backdrop");
        const shown = (image) =>
          image.getClientRects().length > 0 &&
          getComputedStyle(image).visibility !== "hidden";
        // The painting covers its box and is shifted by its object position.
        const frame = box(backdrop);
        const scale = Math.max(
          (frame.right - frame.left) / backdrop.naturalWidth,
          (frame.bottom - frame.top) / backdrop.naturalHeight,
        );
        const [x, y] = getComputedStyle(backdrop)
          .objectPosition.split(" ")
          .map(parseFloat);
        return {
          stage: box(document.querySelector("#stage")),
          hidden: backdrop.hidden,
          painting: {
            left: frame.left + x,
            top: frame.top + y,
            right: frame.left + x + backdrop.naturalWidth * scale,
            bottom: frame.top + y + backdrop.naturalHeight * scale,
          },
          dock: box(document.querySelector(".play-dock")),
          cast: [...document.querySelectorAll("#cast .portrait img")]
            .filter(shown)
            .map(box),
          anchored: [...document.querySelectorAll(".stage-figure")]
            .filter(shown)
            .map((image) => ({
              ...box(image),
              resident: image.dataset.resident,
            })),
          vale: Boolean(
            document.querySelector('#cast .portrait[data-avatar="vale"]'),
          ),
        };
      });
      await page.screenshot({
        path: new URL(`${place}-${width}x${height}.png`, output).pathname,
      });
      const where = `${place} at ${width}x${height}`;
      const { stage, painting } = m;
      assert(!m.hidden, `${where}: the backdrop shows`);
      assert(painting.left <= stage.left + 1, `${where}: backdrop left`);
      assert(painting.right >= stage.right - 1, `${where}: backdrop right`);
      assert(painting.top <= stage.top + 1, `${where}: backdrop top`);
      assert(painting.bottom >= stage.bottom - 1, `${where}: backdrop bottom`);
      assert(
        m.cast.length + m.anchored.length > 0,
        `${where}: someone stands on the stage`,
      );
      for (const figure of m.cast) {
        assert(figure.bottom > stage.top, `${where}: figure on stage`);
        assert(figure.bottom <= stage.bottom + 1, `${where}: figure feet`);
      }
      // A resident painted into the backdrop stays whole and stands beside or
      // above the hand. Its square cutout's feet sit 8% above the image's edge;
      // a painting that cannot rise further may set them a little lower.
      for (const figure of m.anchored) {
        const feet = figure.bottom - (figure.bottom - figure.top) * 0.08;
        assert(figure.left >= stage.left - 1, `${where}: resident left`);
        assert(figure.right <= stage.right + 1, `${where}: resident right`);
        assert(figure.top >= stage.top - 1, `${where}: resident top`);
        const beside =
          figure.right <= m.dock.left + 1 || figure.left >= m.dock.right - 1;
        assert(
          beside || feet <= m.dock.top + (stage.bottom - stage.top) * 0.02,
          `${where}: resident feet at ${feet}, hand at ${m.dock.top}`,
        );
      }
      if (place === "clearing") {
        // The Steam Clock's data anchors Badger and leaves Vale off stage.
        assert.deepEqual(
          m.anchored.map(({ resident }) => resident),
          ["badger"],
          where,
        );
        assert(!m.vale, `${where}: Vale stays off the Steam Clock stage`);
      } else assert.equal(m.anchored.length, 0, where);
    }
    assert.deepEqual(errors, [], place);
    await page.close();
  }
  console.log(
    `Stage fill smoke passed: ${seeds.length} places fill one stage with whole figures at 1440x900, 390x844 and 844x390.`,
  );
} finally {
  await browser.close();
  server.close();
}
