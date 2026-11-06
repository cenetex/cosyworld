import assert from "node:assert/strict";
import fixture from "../../test/fixtures/authoring-designer.json" with { type: "json" };
import badger from "../content/badger-forest/card-world.json" with { type: "json" };
import { mkdir } from "node:fs/promises";
import { chromium } from "playwright";
import { createServer } from "../card-game/serve.mjs";
import { authoringCardId } from "../card-game/authoring-tree.mjs";
import { smokeWidths } from "./card-browser-helpers.mjs";
const server = createServer();
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const browser = await chromium.launch({ headless: true });
await mkdir("output/authoring-collections", { recursive: true });
try {
  for (const width of smokeWidths([1440, 390, 320])) {
    const page = await browser.newPage({
      viewport: { width, height: width === 320 ? 568 : 900 },
      reducedMotion: "reduce",
      hasTouch: width < 700,
    });
    const press = (card) => (width < 700 ? card.tap() : card.click());
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
      const { authoringCardId: cardId } = await import(
        "/card-game/authoring-tree.mjs"
      );
      const { showActionBeat, clearActionBeat } = await import(
        "/card-game/app.mjs"
      );
      let record = {
        generation: 1,
        launch: null,
        draft: importPack(input),
      };
      const tools = [];
      let seed = "",
        editing = false,
        selected = false,
        opened = 0;
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
      tools.push({
        id: "seed",
        anchor: cardId(["pack"], "root"),
        describe: (ctx) => ({
          note: `Draft ${ctx.status.key}`,
          edit: editing
            ? {
                key: "temporary-seed",
                label: "World idea",
                value: seed,
                onInput: (value) => {
                  seed = value;
                },
              }
            : null,
          actions: [{ label: editing ? "Find avatars" : "Enter world seed" }],
        }),
        run() {
          if (!editing) {
            editing = true;
            return;
          }
          tools.push({
            id: "candidate",
            name: "Lumi // Lightkeeper",
            kind: "avatar",
            holder: cardId(["pack", "avatars"], "collection"),
            art: "assets/badger-forest/badger-sleeping.png",
            state: "Suggested",
            get selected() {
              return selected;
            },
            select() {
              selected = !selected;
            },
            describe: () => ({ actions: [{ label: "Review Lumi" }] }),
            run(_action, ctx) {
              window.test.notesAtReview = ctx.snapshot().draft.document;
            },
          });
        },
      });
      window.test.editor = installWorldDesigner({
        store,
        tools: () => tools,
        onOpen() {
          window.test.opened = ++opened;
        },
        resolveArt(path, { key, generation, title }) {
          window.test.art = [generation, title];
          if (key !== "local") throw Error("Resolve art for this draft.");
          return path?.startsWith("assets/badger-forest/") ? path : null;
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
    assert.equal(await page.locator("#settings-hand .card").count(), 1);
    const choose = async (path, role) => {
      if (role === "root")
        return page.evaluate(() => window.test.editor.chooseWorld());
      if (role === "entity") {
        await choose(["pack"], "root");
        await choose(["pack", path[1]], "collection");
      }
      const card = page.locator(
        `[data-setting="${authoringCardId(path, role)}"]`,
      );
      await press(card);
      if ((await card.getAttribute("aria-expanded")) === "false")
        await press(card);
    };
    const tool = async (id) =>
      page.evaluate((id) => window.test.editor.chooseTool(id), id);
    const action = page.locator("#card-actions button").first(),
      note = page.locator(".action-beat-note"),
      info = page.locator(".action-beat-text");
    const gate = async () => {
      await page.evaluate(() => window.test.editor.chooseTools());
      await choose(["pack"], "details");
      await choose(["pack"], "quests");
      await choose(["pack", "choices", 0], "field");
    };
    const save = async () => {
      await page.evaluate(() => window.test.editor.chooseTools());
      await press(page.locator('[data-setting="designer-save"]'));
      await press(action);
      await info.filter({ hasText: "Saved" }).waitFor();
    };
    await choose(["pack"], "root");
    assert.deepEqual(
      await page.locator("#settings-hand [data-setting]").allTextContents(),
      ["World", "Items", "Avatars", "Locations"],
    );
    await page.screenshot({
      path: `output/authoring-collections/${width}-world.png`,
    });
    assert.equal(await action.innerText(), "Enter world seed");
    await press(action);
    await page
      .getByRole("textbox", { name: "World idea" })
      .fill("Transient seed canary");
    await press(action);
    await tool("candidate");
    const candidate = page.locator('[data-setting="designer-tool-candidate"]');
    assert.equal(await candidate.getAttribute("aria-pressed"), "true");
    assert.match(await candidate.getAttribute("aria-label"), /Suggested/);
    await candidate.locator("img").evaluate((img) => img.decode());
    await press(action);
    assert.equal(
      await page.evaluate(() => window.test.notesAtReview),
      "First book",
    );
    await page.screenshot({
      path: `output/authoring-collections/${width}-candidate.png`,
    });
    await gate();
    await choose(["pack", "choices", 0, "cost"], "field");
    await note.fill("bad");
    await tool("source");
    assert.equal(await note.innerText(), "First book");
    await note.fill("Second book\n雪");
    await press(action);
    await info.filter({ hasText: "number" }).waitFor();
    await gate();
    await choose(["pack", "choices", 0, "cost"], "field");
    await note.fill("2");
    await press(action);
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
    assert.notEqual(await action.innerText(), "Enter world seed");
    await choose(["pack", "places", "a"], "entity");
    await choose(["pack", "places", "a"], "contents");
    await press(
      page.locator(
        `[data-setting="${authoringCardId(["pack", "items", "oil"], "entity")}-contents"]`,
      ),
    );
    assert.equal(await action.innerText(), "Move Oil from Yard to Port");
    await press(action);
    await save();
    saved = await page.evaluate(() => window.test.read());
    assert.equal(saved.draft.pack.items.oil.holder, "b");
    assert.equal(saved.launch.place, "b");
    await press(page.locator('[data-setting="designer-undo"]'));
    await press(action);
    await save();
    saved = await page.evaluate(() => window.test.read());
    assert.equal(saved.draft.pack.items.oil.holder, "a");
    assert.equal(saved.launch.place, "b");
    await choose(["pack", "places", "a"], "entity");
    await choose(["pack", "places", "a"], "contents");
    await choose(["pack", "avatars", "person"], "entity");
    await choose(["pack", "avatars", "person"], "quests");
    await choose(["pack", "items", "oil"], "entity");
    assert.equal(
      await action.innerText(),
      "Set Robin's starting quest: bring Oil",
    );
    await page.keyboard.press("Escape");
    assert.equal(await action.count(), 0);
    await choose(["pack", "avatars", "person"], "entity");
    await choose(["pack", "avatars", "person", "name"], "field");
    await note.fill("Wren");
    await press(action);
    await save();
    const renamed = await page.evaluate(() => window.test.read());
    assert.equal(renamed.draft.pack.avatars.person.name, "Wren");
    const current = [renamed.generation, "Edited"];
    assert.deepEqual(await page.evaluate(() => window.test.art), current);
    assert.deepEqual(await page.evaluate(() => window.test.scene), current);
    await choose(["pack", "avatars", "person"], "entity");
    await page.screenshot({
      path: `output/authoring-collections/${width}-avatar.png`,
    });
    await page.evaluate(() => {
      window.test.editor.close();
      window.test.editor.open();
    });
    assert.equal(await page.evaluate(() => window.test.opened), 1);
    assert.equal(
      await page.locator(".settings-scene").getAttribute("data-place"),
      "local:a",
    );
    assert.equal(
      requests.some((url) => url.includes("invalid.invalid")),
      false,
    );
    await page.evaluate(
      (pack) =>
        window.test.editor.open({
          key: "local",
          record: {
            ...window.test.read(),
            launch: null,
            draft: { ...window.test.read().draft, pack, bridge: null },
          },
        }),
      badger,
    );
    assert.equal(await page.evaluate(() => window.test.opened), 2);
    await choose(["pack", "avatars", "badger"], "entity");
    await page.waitForFunction(
      (id) =>
        [...document.querySelectorAll(`[data-setting="${id}"] img`)].some(
          (img) => img.naturalWidth > 0 && img.src.includes("badger-sleeping"),
        ),
      authoringCardId(["pack", "avatars", "badger"], "entity"),
    );
    await page.screenshot({
      path: `output/authoring-collections/${width}-badger.png`,
    });
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
