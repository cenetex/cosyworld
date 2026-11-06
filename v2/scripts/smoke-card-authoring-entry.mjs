import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { chromium } from "playwright";
import { createServer } from "../card-game/serve.mjs";
import { authoringCardId } from "../card-game/authoring-tree.mjs";
const output = new URL("../../output/authoring-entry/", import.meta.url)
  .pathname;
await mkdir(output, { recursive: true });
const server = createServer();
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const browser = await chromium.launch({ headless: true });
try {
  for (const width of [1440, 390, 320]) {
    const page = await browser.newPage({
      viewport: { width, height: width === 320 ? 568 : 844 },
      hasTouch: width < 700,
      reducedMotion: "reduce",
    });
    const errors = [],
      requests = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("request", (request) => requests.push(request.url()));
    await page.addInitScript(() => {
      localStorage.setItem("cosyworld.playing", "existing-world");
      document.addEventListener("securitypolicyviolation", (event) => {
        window.cspErrors = (window.cspErrors || []).concat(event.blockedURI);
      });
    });
    const press = (target) => (width < 700 ? target.tap() : target.click());
    const action = page.locator("#card-actions button"),
      note = page.locator(".action-beat-note");
    const choose = async (path, role) => {
      const card = page.locator(
        `[data-setting="${authoringCardId(path, role)}"]`,
      );
      await press(card);
      if ((await card.getAttribute("aria-expanded")) === "false")
        await press(card);
    };
    const saved = () =>
      page.waitForFunction(() =>
        document
          .querySelector(".action-beat-text")
          .textContent.endsWith("Saved"),
      );
    const scene = () =>
      page.waitForFunction(
        () => document.querySelector("#backdrop").naturalWidth > 0,
      );
    const read = () =>
      page.evaluate(async () => {
        const { openAuthoringStore } = await import(
          "/card-game/authoring-local-store.mjs"
        );
        const db = await openAuthoringStore();
        try {
          const record = await db.read(
            new URL(location.href).searchParams.get("draft"),
          );
          return {
            ...record,
            assets: [...record.assets].map(([path, bytes]) => [
              path,
              [...bytes],
            ]),
          };
        } finally {
          db.close();
        }
      });
    try {
      const response = await page.goto(
        `http://127.0.0.1:${server.address().port}/make`,
      );
      assert.equal(response.status(), 200);
      assert.match(
        response.headers()["content-security-policy"],
        /img-src[^;]*blob:/u,
      );
      await page.getByRole("textbox", { name: "World source" }).waitFor();
      await note.fill("A quiet shore.\n雪");
      await press(action);
      await saved();
      assert.equal((await read()).draft.document, "A quiet shore.\n雪");
      await page.reload();
      await page.getByRole("textbox", { name: "World source" }).waitFor();
      assert.equal(await note.innerText(), "A quiet shore.\n雪");
      await press(page.locator("#menu-button"));
      await press(page.locator('[data-setting="designer-tool-import-folder"]'));
      const picker = page.waitForEvent("filechooser");
      await press(action);
      await (
        await picker
      ).setFiles(
        new URL("../../test/fixtures/authoring-entry", import.meta.url)
          .pathname,
      );
      const candidate = page.locator(
        '[data-setting^="designer-tool-import-pack-"]',
      );
      await candidate.first().waitFor();
      assert.equal(await candidate.count(), 1);
      await press(candidate.first());
      await press(action);
      await page.waitForFunction(
        () =>
          new URL(location.href).searchParams.get("draft") !== "first-world",
      );
      await choose(["pack", "places", "beach"], "entity");
      await scene();
      assert(
        (await page.locator("#backdrop").getAttribute("src")).startsWith(
          "blob:",
        ),
      );
      await choose(["pack"], "root");
      await press(page.locator('[data-setting="designer-save"]'));
      await press(action);
      await saved();
      const record = await read();
      assert.deepEqual(record.launch, { schemaVersion: 1, place: "beach" });
      assert.equal(record.assets.length, 1);
      assert.equal(record.draft.pack.entry, "beach");
      await page.reload();
      await scene();
      assert.deepEqual(await read(), record);
      await press(page.locator("#history-button"));
      await note.fill("Updated imported book");
      await press(action);
      await saved();
      assert.equal((await read()).draft.document, "Updated imported book");
      if (width < 700) await page.setViewportSize({ width, height: 320 });
      await page.screenshot({ path: `${output}/${width}-source.png` });
      const button = await action.boundingBox(),
        tree = await page.locator("#settings-screen").boundingBox(),
        panel = await page.locator("#action-beat").boundingBox();
      assert(
        button.y >= 0 && button.y + button.height <= page.viewportSize().height,
      );
      assert(tree.y + tree.height <= panel.y);
      assert.equal(
        await page.evaluate(() => localStorage.getItem("cosyworld.playing")),
        "existing-world",
      );
      assert(!requests.some((url) => /\/app\.mjs(?:\?|$)/u.test(url)));
      assert.deepEqual(await page.evaluate(() => window.cspErrors || []), []);
      assert.deepEqual(errors, []);
      console.log(
        `Authoring entry ${width}: source, import, scene, exact reload and play save passed`,
      );
    } finally {
      await page.close();
    }
  }
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
