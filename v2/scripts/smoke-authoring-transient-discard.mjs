import assert from "node:assert/strict";
import { chromium } from "playwright";
import { createServer } from "../card-game/serve.mjs";
import { smokeWidths } from "./card-browser-helpers.mjs";
const server = createServer();
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const browser = await chromium.launch({ headless: true });
try {
  for (const width of smokeWidths([1440, 390, 320])) {
    const page = await browser.newPage({
      viewport: { width, height: 844 },
      hasTouch: width < 700,
      reducedMotion: "reduce",
    });
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    const press = (locator) => (width < 700 ? locator.tap() : locator.click());
    await page.goto(
      `http://127.0.0.1:${server.address().port}/?table=discard-${width}`,
    );
    await page.locator("#hand .card").first().waitFor();
    await page.evaluate(async () => {
      const { installWorldDesigner } = await import(
        "/card-game/authoring-designer.mjs"
      );
      const { authoringImportTools } = await import(
        "/card-game/authoring-import-tools.mjs"
      );
      const { importPack } = await import("/card-game/authoring-draft.mjs");
      const { showActionBeat, clearActionBeat } = await import(
        "/card-game/app.mjs"
      );
      const pack = {
        id: "world",
        name: "World",
        places: {},
        avatars: {},
        items: {},
      };
      const draft = importPack({
        pack,
        title: "First",
        document: "Saved notes",
      });
      const records = new Map([
        ["local", { draft, generation: 1, launch: null, assets: new Map() }],
      ]);
      let pending = "",
        revision = 0,
        hold,
        readFailure = false,
        writeFailure = false;
      const store = {
        async read(key) {
          if (readFailure) {
            readFailure = false;
            throw Error("Read failed");
          }
          return structuredClone(records.get(key));
        },
        async write(key, value, generation, assets) {
          if (key !== "local") {
            if (writeFailure) {
              writeFailure = false;
              throw Error("Storage full");
            }
            if (hold) await hold.promise;
          }
          const next = {
            ...structuredClone(value),
            generation: generation + 1,
            assets: structuredClone(
              assets ?? records.get(key)?.assets ?? new Map(),
            ),
          };
          records.set(key, next);
          return next.generation;
        },
      };
      const imports = authoringImportTools({
        store,
        chooseFiles: async () => [
          new File(
            [JSON.stringify(importPack({ pack, title: "Imported" }))],
            "world.json",
          ),
        ],
      });
      const tool = {
        id: "design",
        name: "Design",
        describe: () => ({
          edit: {
            key: "design",
            label: "Description",
            value: pending,
            onInput(value) {
              pending = value;
              revision++;
              editor.refresh();
            },
          },
          actions: [],
        }),
      };
      const source = {
        id: "notes",
        name: "Notes",
        describe: (ctx) => ({
          edit: {
            key: "notes",
            label: "Notes",
            value: ctx.snapshot().draft.document,
            onInput: (document) => ctx.stage({ document }),
          },
          actions: [],
        }),
      };
      let opened = 0;
      const editor = installWorldDesigner({
        store,
        tools: () => [tool, source, ...imports()],
        transientState: () => (pending ? String(revision) : null),
        onOpen() {
          pending = "";
          revision++;
          opened++;
        },
        actionBeat: { show: showActionBeat, clear: clearActionBeat },
      });
      editor.open({ key: "local", record: records.get("local") });
      window.review = {
        editor,
        state: () => ({
          pending,
          opened,
          records: structuredClone([...records]),
        }),
        reply() {
          pending = "New preview";
          revision++;
          editor.refresh();
        },
        failRead() {
          readFailure = true;
        },
        failWrite() {
          writeFailure = true;
        },
        hold() {
          hold = Promise.withResolvers();
        },
        release() {
          hold.resolve();
          hold = null;
        },
        direct() {
          editor.open({ key: "local", record: records.get("local") });
        },
      };
    });
    const action = page.locator("#card-actions button"),
      note = page.locator(".action-beat-note");
    const state = () => page.evaluate(() => window.review.state());
    const tool = (id) =>
      page.evaluate((id) => window.review.editor.chooseTool(id), id);
    const reload = async () => {
      await page.evaluate(() => window.review.editor.chooseTools());
      await press(page.locator('[data-setting="designer-reload"]'));
    };
    const typeDesign = async (text) => {
      await tool("design");
      await page.getByRole("textbox", { name: "Description" }).fill(text);
    };
    await typeDesign("Keep this description");
    await assert.rejects(
      page.evaluate(() => window.review.direct()),
      /Review this design/,
    );
    await reload();
    await press(action);
    assert.equal((await state()).pending, "Keep this description");
    assert.equal(await action.innerText(), "Confirm reload and discard");
    await page.evaluate(() => window.review.reply());
    await page.waitForTimeout(450);
    await press(action);
    await page
      .locator(".action-beat-text")
      .filter({ hasText: "This design changed" })
      .waitFor();
    assert.equal((await state()).pending, "New preview");
    await page.evaluate(() => window.review.failRead());
    await press(action);
    await page.waitForTimeout(450);
    await press(action);
    await page
      .locator(".action-beat-text")
      .filter({ hasText: "Read failed" })
      .waitFor();
    assert.equal((await state()).pending, "New preview");
    await press(action);
    await page.waitForTimeout(450);
    await press(action);
    assert.equal((await state()).opened, 2);
    assert.equal((await state()).pending, "");
    await tool("notes");
    await page.getByRole("textbox", { name: "Notes" }).fill("Unsaved source");
    await reload();
    await press(action);
    assert.equal((await state()).opened, 2);
    await page.waitForTimeout(450);
    await press(action);
    assert.equal((await state()).opened, 3);
    await tool("notes");
    assert.equal(await note.innerText(), "Saved notes");
    await typeDesign("Pending import design");
    await tool("import-files");
    await press(action);
    await tool("import-pack-1-0");
    await press(action);
    assert.equal((await state()).records.length, 1);
    await page.evaluate(() => window.review.failWrite());
    await page.waitForTimeout(450);
    await press(action);
    await page
      .locator(".action-beat-text")
      .filter({ hasText: "Storage full" })
      .waitFor();
    assert.equal((await state()).pending, "Pending import design");
    assert.equal((await state()).opened, 3);
    await page.evaluate(() => window.review.hold());
    await press(action);
    await page.waitForTimeout(450);
    await press(action);
    await page.evaluate(() => {
      window.review.reply();
      window.review.release();
    });
    await page
      .locator(".action-beat-text")
      .filter({ hasText: "This design changed" })
      .waitFor();
    assert.equal((await state()).pending, "New preview");
    assert.equal((await state()).opened, 3);
    await press(action);
    await page.waitForTimeout(450);
    await press(action);
    await page.waitForFunction(() => window.review.state().opened === 4);
    assert.equal((await state()).pending, "");
    assert.equal((await state()).opened, 4);
    assert.deepEqual(errors, []);
    console.log(
      `Transient discard ${width}: source/preview consent, changed reply, read/save failure and actual import retry passed`,
    );
    await page.close();
  }
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
