import assert from "node:assert/strict";
import fixture from "../../test/fixtures/authoring-designer.json" with { type: "json" };
import { chromium } from "playwright";
import { createServer } from "../card-game/serve.mjs";
import { authoringCardId } from "../card-game/authoring-tree.mjs";
import { smokeWidths } from "./card-browser-helpers.mjs";
const server = createServer();
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const browser = await chromium.launch({ headless: true });
try {
  for (const width of smokeWidths([1440, 390, 320])) {
    const page = await browser.newPage({
      viewport: { width, height: width === 320 ? 568 : 900 },
      reducedMotion: "reduce",
    });
    const errors = [],
      requests = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("request", (request) => requests.push(request.url()));
    await page.goto(
      `http://127.0.0.1:${server.address().port}/?table=designer-${width}`,
    );
    await page.locator("#hand .card").first().waitFor();
    await page.evaluate(async (input) => {
      const { installWorldDesigner } = await import(
        "/card-game/authoring-designer.mjs"
      );
      const { importPack } = await import("/card-game/authoring-draft.mjs");
      const { showActionBeat, clearActionBeat } = await import(
        "/card-game/app.mjs"
      );
      let record = {
        generation: 1,
        launch: null,
        draft: importPack(input),
      };
      const tools = [];
      const store = {
        async write(_key, value, generation) {
          record = { ...structuredClone(value), generation: generation + 1 };
          return record.generation;
        },
      };
      tools.push({
        id: "source",
        name: "Source",
        describe: (ctx) => ({
          edit: {
            key: "source-book",
            label: "World source",
            value: ctx.snapshot().draft.document,
            onInput: (document) => ctx.stage({ document, title: "Edited" }),
          },
          actions: [{ label: "Save source" }],
        }),
        run: (_action, ctx) => ctx.save(),
      });
      window.test = { read: () => structuredClone(record) };
      window.test.editor = installWorldDesigner({
        store,
        tools: () => tools,
        resolveArt(_path, { key, generation, title }) {
          window.test.art = [generation, title];
          if (key !== "local") throw Error("Resolve art for this draft.");
        },
        actionBeat: { show: showActionBeat, clear: clearActionBeat },
        onScene(place, _source, { key, generation, title }) {
          window.test.scene = [generation, title];
          document
            .querySelector(".settings-scene")
            ?.setAttribute("data-place", `${key}:${place ?? "none"}`);
        },
      });
      window.test.editor.open({ key: "local", record });
    }, fixture);
    const choose = async (path, role) => {
      const card = page.locator(
        `[data-setting="${authoringCardId(path, role)}"]`,
      );
      await card.click();
      if ((await card.getAttribute("aria-expanded")) === "false")
        await card.click();
    };
    const tool = async (id) =>
      page.evaluate((id) => window.test.editor.chooseTool(id), id);
    const action = page.locator("#card-actions button").first(),
      note = page.locator(".action-beat-note"),
      info = page.locator(".action-beat-text");
    const gate = async () => {
      await choose(["pack"], "quests");
      await choose(["pack", "choices", 0], "field");
    };
    const save = async () => {
      await choose(["pack"], "root");
      await page.locator('[data-setting="designer-save"]').click();
      await action.click();
      await info.filter({ hasText: "Saved" }).waitFor();
    };
    await gate();
    await choose(["pack", "choices", 0, "cost"], "field");
    await note.fill("bad");
    await tool("source");
    assert.equal(await note.innerText(), "First book");
    await note.fill("Second book\n雪");
    await action.click();
    await info.filter({ hasText: "number" }).waitFor();
    await gate();
    await choose(["pack", "choices", 0, "cost"], "field");
    await note.fill("2");
    await action.click();
    await save();
    let saved = await page.evaluate(() => window.test.read());
    assert.equal(saved.draft.document, "Second book\n雪");
    const choice = saved.draft.pack.choices[0];
    assert.equal(choice.cost, 2);
    assert.equal(choice.generation.systemPrompt, "PRIVATE_TOKEN");
    assert.equal(saved.draft.pack.places.a.art, fixture.pack.places.a.art);
    await gate();
    const hidden = authoringCardId(
      ["pack", "choices", 0, "generation"],
      "field",
    );
    assert.equal(await page.locator(`[data-setting="${hidden}"]`).count(), 0);
    const markup = await page.locator("body").evaluate((el) => el.outerHTML);
    assert.equal(markup.includes("PRIVATE_TOKEN"), false);
    await choose(["pack"], "root");
    await choose(["pack", "places", "b"], "entity");
    await choose(["pack", "places", "b"], "contents");
    await choose(["pack"], "root");
    await choose(["pack", "places", "a"], "entity");
    await choose(["pack", "places", "a"], "contents");
    await choose(["pack", "items", "oil"], "entity");
    assert.equal(await action.innerText(), "Move Oil from Yard to Port");
    await action.click();
    await save();
    saved = await page.evaluate(() => window.test.read());
    assert.equal(saved.draft.pack.items.oil.holder, "b");
    assert.equal(saved.launch.place, "b");
    await page.locator('[data-setting="designer-undo"]').click();
    await action.click();
    await save();
    saved = await page.evaluate(() => window.test.read());
    assert.equal(saved.draft.pack.items.oil.holder, "a");
    assert.equal(saved.launch.place, "b");
    await choose(["pack", "places", "a"], "entity");
    await choose(["pack", "places", "a"], "contents");
    await choose(["pack", "avatars", "person"], "entity");
    await choose(["pack", "avatars", "person", "name"], "field");
    await note.fill("Wren");
    await action.click();
    await save();
    const renamed = await page.evaluate(() => window.test.read());
    assert.equal(renamed.draft.pack.avatars.person.name, "Wren");
    const current = [renamed.generation, "Edited"];
    assert.deepEqual(await page.evaluate(() => window.test.art), current);
    assert.deepEqual(await page.evaluate(() => window.test.scene), current);
    await page.evaluate(() => {
      window.test.editor.close();
      window.test.editor.open();
    });
    assert.equal(
      await page.locator(".settings-scene").getAttribute("data-place"),
      "local:a",
    );
    assert.equal(
      requests.some((url) => url.includes("invalid.invalid")),
      false,
    );
    assert.deepEqual(errors, []);
    console.log(
      `designer ${width}: source, field, move, Undo, private fields, safe art and scene reopen passed`,
    );
    await page.close();
  }
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
