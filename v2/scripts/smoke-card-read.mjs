import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { chromium } from "playwright";
import { createServer } from "../card-game/serve.mjs";
import { packDefinition } from "../card-game/pack-registry.mjs";
import { createWorld, encodeSave, nameOf } from "../card-game/world.mjs";
import {
  focusedHandCard,
  readyActionButton,
  selectCard,
} from "./card-browser-helpers.mjs";

const output = new URL("../../output/read-view/", import.meta.url);
await mkdir(output, { recursive: true });

const server = createServer();
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE,
});
try {
  for (const [width, height, pack, id, place] of [
    [1440, 900, "willows", "willows-notebook", "willows-camp"],
    [390, 844, "willows", "willows-notebook", "willows-camp"],
    [390, 844, "greek-drama", "greek-household-token", "greek-sanctuary"],
  ]) {
    const book = packDefinition(pack).items[id];
    const world = createWorld({
      seed: 7,
      packScopes: pack === "greek-drama" ? { [pack]: "full" } : {},
    });
    world.actors.vale.place = place;
    world.actors.vale.visited.push(place);
    world.items[id].holder = "vale";
    if (book.teachesQuest) {
      world.crossings["pond-greek-harbor"].discovered = true;
      world.packs[pack].met[book.author] = world.turn;
    }
    const page = await browser.newPage({
      viewport: { width, height },
      reducedMotion: "reduce",
      hasTouch: width === 390,
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
          model: "read-fixture",
          entries: c.entities.map(({ id }) => ({ id, text: "The river runs high." })),
        }),
      });
    });
    const table = `read-${pack}-${width}`;
    const key = `cosyworld.reflected-shore.v1.${table}`;
    await page.addInitScript(
      ({ key, save }) => {
        if (!localStorage.getItem(key)) localStorage.setItem(key, save);
        localStorage.setItem("cosyworld.dialogue.sound", "off");
        localStorage.setItem(
          "cosyworld.room-music",
          JSON.stringify({ enabled: false, volume: 0 }),
        );
      },
      { key, save: encodeSave(world) },
    );
    await page.goto(
      `http://127.0.0.1:${server.address().port}/?table=${table}`,
    );
    await page.locator('#hand [data-card="vale"]').waitFor();
    const fold = page.locator(`#hand .card-frame:has(> [data-card="${book.author}"]) > .quest-fold`);
    if (book.teachesQuest) assert.equal(await fold.getAttribute("data-face"), "down");
    await selectCard(page, id, { touch: width === 390 });
    await readyActionButton(page, "read").click();
    const dialog = page.locator("dialog[open]", { hasText: book.name });
    await dialog.waitFor();
    assert.equal(await dialog.locator("h2").textContent(), book.name);
    assert.equal(await dialog.locator(".kicker").textContent(), `by ${nameOf(book.author)}`);
    const lines = await dialog.locator("p:not(.kicker)").evaluateAll((ps) =>
      ps.map((p) => [p.textContent, getComputedStyle(p).backgroundImage]),
    );
    const expected = book.claims.map((claim) => claim.text);
    if (book.teachesQuest) expected.push("Ismene wants the Household Token.");
    assert.deepEqual(lines.map(([text]) => text), expected);
    for (const [n, [, art]] of lines.slice(0, book.pages?.length ?? 0).entries()) {
      assert.match(art, new RegExp(`notebook-page-${n + 1}\\.webp`), art);
      const url = art.slice(5, -2);
      assert.equal(await page.evaluate(async (u) => (await fetch(u)).status, url), 200);
    }
    await page.screenshot({ path: new URL(`${table}.png`, output).pathname });
    await dialog.getByRole("button", { name: "Close" }).click();
    await page.waitForFunction(() =>
      document.activeElement?.matches("#hand .card"),
    );
    assert.equal(await focusedHandCard(page), id, `focus at ${width}`);
    if (book.teachesQuest) assert.equal(await fold.getAttribute("data-face"), "up");
    assert.deepEqual(errors, []);
    await page.close();
  }
  console.log("Read view smoke passed.");
} finally {
  await browser.close();
  server.close();
}
