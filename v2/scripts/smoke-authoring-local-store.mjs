import assert from "node:assert/strict";
import { chromium } from "playwright";
import { createServer } from "../card-game/serve.mjs";

const server = createServer();
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const browser = await chromium.launch({
  executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE, headless: true });
try {
  for (const width of [1440, 390]) {
    const page = await browser.newPage({ viewport: { width, height: 900 } });
    await page.goto(`http://127.0.0.1:${server.address().port}/privacy`);
    const result = await page.evaluate(async () => {
      const { openAuthoringStore } = await import(
        "/card-game/authoring-local-store.mjs"
      );
      const { importPack, assetMetadata } = await import(
        "/card-game/authoring-draft.mjs"
      );
      const bytes = new TextEncoder().encode("The ship carries a lantern. 雪");
      const meta = await assetMetadata("lore.md", "text/markdown", bytes);
      const draft = importPack({
        pack: {
          name: "The crossing",
          entry: "port",
          places: { port: {}, ship: {} },
        },
        bridge: { transports: { boat: { place: "ship", at: "port" } } },
        document: "A".repeat(8 * 1024 * 1024),
        assets: [meta],
      });
      const source = { draft, launch: { schemaVersion: 1, place: "ship" } };
      const a = await openAuthoringStore(),
        b = await openAuthoringStore();
      localStorage.setItem("cosyworld.playing", "play-save-marker");
      const first = await a.write(
        "draft",
        source,
        0,
        new Map([[meta.path, bytes]]),
      );
      bytes.fill(0);
      const wins = await Promise.allSettled([
        a.write(
          "draft",
          { ...source, draft: { ...draft, title: "First tab" } },
          1,
        ),
        b.write(
          "draft",
          { ...source, draft: { ...draft, title: "Second tab" } },
          1,
        ),
      ]);
      const before = await a.read("draft");
      const rejected = [];
      for (const [value, generation, assets] of [
        [{ ...source, launch: { schemaVersion: 1, place: "absent" } }, 2],
        [{ ...source, draft: { ...draft, document: draft.document + "A" } }, 2],
        [source, 2, new Map([[meta.path, bytes]])],
        [{ ...source, draft: { ...draft, assets: [] } }, 2],
        [source, 1],
      ]) {
        try {
          await a.write("draft", value, generation, assets);
        } catch (error) {
          rejected.push(error.message);
        }
      }
      const after = await a.read("draft");
      a.close();
      b.close();
      const reopened = await openAuthoringStore();
      const saved = await reopened.read("draft");
      reopened.close();
      return {
        first,
        wins: wins.map((w) => w.status).sort(),
        rejected: rejected.length,
        unchanged:
          before.generation === after.generation &&
          before.draft.title === after.draft.title,
        generation: saved.generation,
        launch: saved.launch,
        entry: saved.draft.pack.entry,
        home: saved.draft.bridge.transports.boat.at,
        size: saved.draft.document.length,
        lore: new TextDecoder().decode(saved.assets.get("lore.md")),
        play: localStorage.getItem("cosyworld.playing"),
      };
    });
    assert.deepEqual(result, {
      first: 1,
      wins: ["fulfilled", "rejected"],
      rejected: 5,
      unchanged: true,
      generation: 2,
      launch: { schemaVersion: 1, place: "ship" },
      entry: "port",
      home: "port",
      size: 8 * 1024 * 1024,
      lore: "The ship carries a lantern. 雪",
      play: "play-save-marker",
    });
    await page.reload();
    assert.equal(
      await page.evaluate(async () => {
        const { openAuthoringStore } = await import(
          "/card-game/authoring-local-store.mjs"
        );
        const store = await openAuthoringStore();
        const saved = await store.read("draft");
        store.close();
        return saved.generation;
      }),
      2,
    );
    await page.close();
    console.log(`authoring local store: ${width}px passed`);
  }
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
