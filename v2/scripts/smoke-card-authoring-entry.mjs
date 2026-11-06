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
            assets: await Promise.all(
              [...record.assets].map(async ([path, bytes]) => [
                path,
                bytes.byteLength,
                Array.from(
                  new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)),
                  (byte) => byte.toString(16).padStart(2, "0"),
                ).join(""),
              ]),
            ),
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
      await scene();
      assert.equal(
        await page.locator("#place-title").innerText(),
        "Lantern Shore",
      );
      assert.equal(new URL(page.url()).searchParams.has("draft"), false);
      await page
        .locator(".card img")
        .evaluateAll((images) =>
          Promise.all(images.map((image) => image.decode())),
        );
      await page.screenshot({ path: `${output}/${width}-sample.png` });
      await choose(["pack"], "root");
      await choose(["pack", "avatars"], "collection");
      await choose(["pack", "avatars", "sample-vale"], "entity");
      await choose(["pack", "avatars", "sample-vale", "text"], "field");
      await note.fill("Vale carries a lantern and follows the shore path.");
      await press(action);
      await press(page.locator("#history-button"));
      await page.getByRole("textbox", { name: "World source" }).waitFor();
      await note.fill("A quiet shore.\n雪");
      await press(action);
      await saved();
      const sample = await read();
      assert.equal(sample.draft.document, "A quiet shore.\n雪");
      assert.equal(
        sample.draft.pack.avatars["sample-vale"].text,
        "Vale carries a lantern and follows the shore path.",
      );
      assert.equal(sample.assets.length, 8);
      assert.deepEqual(sample.launch, {
        schemaVersion: 1,
        place: "sample-shore",
      });
      await page.reload();
      await scene();
      assert.deepEqual(await read(), sample);
      await press(page.locator("#history-button"));
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
      await choose(["pack"], "root");
      await choose(["pack", "places"], "collection");
      await choose(["pack", "places", "beach"], "entity");
      await scene();
      assert(
        (await page.locator("#backdrop").getAttribute("src")).startsWith(
          "blob:",
        ),
      );
      await press(page.locator("#history-button"));
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
      const savedUrl = page.url();
      await page.goto(
        new URL("/make?draft=missing-local-draft", savedUrl).href,
      );
      await action.getByText("Open sample world").waitFor();
      assert.match(await note.innerText(), /draft is unavailable/);
      await press(action);
      await scene();
      assert.equal(
        await page.locator("#place-title").innerText(),
        "Lantern Shore",
      );
      await press(page.locator("#history-button"));
      await note.fill("A separate sample draft");
      await press(action);
      await saved();
      assert.match(new URL(page.url()).searchParams.get("draft"), /^sample-/);
      assert.equal(new URL(page.url()).searchParams.has("sample"), false);
      await page.goto(savedUrl);
      await scene();
      assert.equal((await read()).draft.pack.entry, "beach");
      console.log(
        `Authoring entry ${width}: sample edit, eight assets, source, import, exact reload, missing-link recovery and play save passed`,
      );
    } finally {
      await page.close();
    }
  }
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
