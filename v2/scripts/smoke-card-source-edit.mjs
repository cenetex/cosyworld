import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { chromium } from "playwright";
import { createServer } from "../card-game/serve.mjs";

const output =
  process.env.SOURCE_EDIT_SHOTS ||
  new URL("../../output/source-edit/", import.meta.url).pathname;
await mkdir(output, { recursive: true });
const server = createServer();
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const browser = await chromium.launch({ headless: true });
try {
  for (const [width, height] of [
    [1440, 900],
    [390, 844],
    [320, 568],
  ]) {
    const page = await browser.newPage({
      viewport: { width, height },
      reducedMotion: "reduce",
      hasTouch: width < 700,
    });
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(
      `http://127.0.0.1:${server.address().port}/?table=source-${width}`,
    );
    await page.locator("#hand .card").first().waitFor();
    await page.evaluate(async () => {
      const { showActionBeat, clearActionBeat } = await import(
        "/card-game/app.mjs"
      );
      window.sourceText = "Fox lives in the woods.\nOwl keeps the tower.";
      window.sourceEdits = [];
      window.drawSource = (value = window.sourceText, key = "draft:document") =>
        showActionBeat({
          name: "World idea",
          info: "Write or paste your source text.",
          cards: [],
          edit: {
            key,
            label: "World source text",
            value,
            onInput(text) {
              window.sourceText = text;
              window.sourceEdits.push(text);
              window.drawSource(text, key);
            },
          },
          buttons: [
            {
              label: "Create",
              id: "setting-create",
              run() {
                window.createdSource = window.sourceText;
              },
            },
          ],
        });
      window.closeSource = clearActionBeat;
      window.drawSource();
    });
    const field = page.getByRole("textbox", { name: "World source text" });
    const text = () => field.innerText();
    await field.waitFor({ state: "visible" });
    assert.equal(await field.getAttribute("contenteditable"), "plaintext-only");
    assert.equal(await field.getAttribute("aria-multiline"), "true");
    assert.equal(await text(), "Fox lives in the woods.\nOwl keeps the tower.");
    await field.evaluate((note) => {
      note.focus();
      window.editNode = note.firstChild;
      const range = document.createRange();
      range.setStart(note.firstChild, 3);
      range.collapse(true);
      getSelection().removeAllRanges();
      getSelection().addRange(range);
    });
    await page.keyboard.insertText(" clever");
    await page.evaluate(() => {
      for (let i = 0; i < 12; i++) window.drawSource("An older server value.");
    });
    assert.equal(
      await field.evaluate((note) => note.firstChild === window.editNode),
      true,
      "Background renders keep the text node",
    );
    assert.equal(
      await text(),
      "Fox clever lives in the woods.\nOwl keeps the tower.",
    );
    await page.keyboard.press(
      process.platform === "darwin" ? "Meta+z" : "Control+z",
    );
    assert.equal(
      await text(),
      "Fox lives in the woods.\nOwl keeps the tower.",
      "Undo survives background renders",
    );
    await field.evaluate((note) => {
      const range = document.createRange();
      range.selectNodeContents(note);
      range.collapse(false);
      getSelection().removeAllRanges();
      getSelection().addRange(range);
    });
    await page.keyboard.press("Enter");
    await page.keyboard.type("Bear guards the bridge.");
    await page.locator("#setting-create").click();
    assert.equal(
      await page.evaluate(() => window.createdSource),
      "Fox lives in the woods.\nOwl keeps the tower.\nBear guards the bridge.",
      "Blur flushes the source before Create",
    );
    await field.focus();
    const cdp = await page.context().newCDPSession(page);
    const count = await page.evaluate(() => window.sourceEdits.length);
    await cdp.send("Input.imeSetComposition", {
      text: "海",
      selectionStart: 1,
      selectionEnd: 1,
    });
    await page.evaluate(() => window.drawSource("An older composition value."));
    await page.waitForTimeout(180);
    assert.equal(
      await page.evaluate(() => window.sourceEdits.length),
      count,
      "Composition stays in the editor",
    );
    assert.ok((await text()).includes("海"));
    await cdp.send("Input.insertText", { text: "海" });
    await page.waitForFunction(() => window.sourceText.includes("海"));
    if (width < 700) {
      await page.setViewportSize({
        width,
        height: Math.max(300, height - 300),
      });
      await field.focus();
      await page.keyboard.type(" stories");
    }
    await page.keyboard.press("Escape");
    assert.equal(
      await field.evaluate((note) => note === document.activeElement),
      false,
    );
    assert.ok(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1,
      ),
    );
    await page.screenshot({
      path: `${output}/source-${width}.png`,
      fullPage: true,
    });
    await page.evaluate(() =>
      window.drawSource(
        "The fox crossed the old bridge.\n".repeat(200),
        "draft:book",
      ),
    );
    assert.equal(
      await field.evaluate((note) => note.scrollHeight > note.clientHeight),
      true,
    );
    const bounds = await page.locator("#setting-create").boundingBox();
    assert.ok(
      bounds.y >= 0 &&
        bounds.y + bounds.height <= (await page.viewportSize()).height,
      "Long source keeps Create visible above the keyboard",
    );
    await page.screenshot({ path: `${output}/long-source-${width}.png` });
    if (width === 1440) {
      await field.focus();
      await page.keyboard.press(
        process.platform === "darwin" ? "Meta+a" : "Control+a",
      );
      const started = Date.now();
      await page.keyboard.insertText("A".repeat(8 * 1024 * 1024));
      console.log(`8 MiB insert: ${Date.now() - started} ms`);
      await page.locator("#setting-create").click();
      console.log(`8 MiB insert and Create: ${Date.now() - started} ms`);
      assert.equal(
        await page.evaluate(
          () => window.createdSource === "A".repeat(8 * 1024 * 1024),
        ),
        true,
        "A whole 8 MiB paste reaches Create",
      );
      await field.focus();
      await page.keyboard.press(
        process.platform === "darwin" ? "Meta+z" : "Control+z",
      );
      assert.equal(
        await text(),
        "The fox crossed the old bridge.\n".repeat(200),
      );
    }
    await page.evaluate(() => window.closeSource());
    assert.equal(
      await page.locator('[contenteditable="plaintext-only"]').count(),
      0,
    );
    assert.deepEqual(errors, []);
    await page.close();
    console.log(
      `Source text, caret, undo, composition and keyboard passed at ${width}px.`,
    );
  }
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
