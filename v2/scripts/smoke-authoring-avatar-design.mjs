import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { chromium } from "playwright";
import { createServer } from "../card-game/serve.mjs";
import { authoringCardId } from "../card-game/authoring-tree.mjs";
const output = new URL("../../output/authoring-avatar-design/", import.meta.url)
  .pathname;
await mkdir(output, { recursive: true });
const server = createServer();
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const browser = await chromium.launch({ headless: true });
try {
  for (const width of [1440, 390, 320]) {
    const page = await browser.newPage({
      viewport: { width, height: 844 },
      hasTouch: width < 700,
      reducedMotion: "reduce",
    });
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(`http://127.0.0.1:${server.address().port}/make?sample=1`);
    const result = await page.evaluate(async () => {
      const { createSampleWorld, sampleExample } = await import(
        "/card-game/authoring-sample.mjs"
      );
      const { readAvatarDesign, avatarBinding } = await import(
        "/card-game/authoring-avatar-design.mjs"
      );
      const record = {
        key: "sample",
        generation: 0,
        ...(await createSampleWorld()),
      };
      const before = JSON.stringify(record.draft),
        design = await readAvatarDesign(record, "sample-vale");
      const decode = (image) =>
        createImageBitmap(new Blob([image.bytes], { type: image.mime }));
      const base = await decode(design.value.base),
        sheet = await decode(design.example);
      const result = {
        unchanged: before === JSON.stringify(record.draft),
        bound: design.binding === avatarBinding(record, "sample-vale"),
        original:
          design.value.base.sha256 === sampleExample().portraitSha256 &&
          design.example.sha256 === sampleExample().sheetSha256,
        id: design.id,
        size: [base.width, base.height, sheet.width, sheet.height],
        poses: design.value.poses.length,
      };
      base.close();
      sheet.close();
      return result;
    });
    assert.deepEqual(
      [result.unchanged, result.bound, result.original],
      [true, true, true],
    );
    assert.equal(result.id, "sample-vale");
    assert.equal(result.poses, 0);
    assert(result.size.every((value) => value > 0));
    assert.equal(result.size[2] % 3, 0);
    assert.equal(result.size[3] % 2, 0);
    const press = (target) => (width < 700 ? target.tap() : target.click());
    await press(page.locator("#history-button"));
    for (const [path, role] of [
      [["pack", "avatars"], "collection"],
      [["pack", "avatars", "sample-vale"], "entity"],
    ]) {
      const card = page.locator(
        `[data-setting="${authoringCardId(path, role)}"]`,
      );
      await press(card);
      if ((await card.getAttribute("aria-expanded")) === "false")
        await press(card);
    }
    const art = page.locator(
      `[data-setting="${authoringCardId(["pack", "avatars", "sample-vale"], "entity")}"] .art img`,
    );
    await art.evaluate((image) => image.decode());
    await page.screenshot({ path: `${output}/${width}.png` });
    const libraryKey = await page.evaluate(async () => {
      const { createSampleWorld } = await import(
        "/card-game/authoring-sample.mjs"
      );
      const { readAvatarDesign } = await import(
        "/card-game/authoring-avatar-design.mjs"
      );
      const { archiveGeneratedArt } = await import(
        "/card-game/authoring-art-library.mjs"
      );
      const { adoptAcceptedAvatar } = await import(
        "/card-game/authoring-accepted.mjs"
      );
      const { openAuthoringStore } = await import(
        "/card-game/authoring-local-store.mjs"
      );
      const key = `library-${crypto.randomUUID()}`;
      const record = { key, generation: 0, ...(await createSampleWorld()) };
      const design = await readAvatarDesign(record, "sample-vale");
      const prepared = await archiveGeneratedArt(record, {
        avatarId: "sample-vale",
        description: "A small green dinosaur.",
        role: "portrait",
        images: [{ ...design.value.base, role: "base" }],
      });
      const saved = adoptAcceptedAvatar(record, prepared);
      const store = await openAuthoringStore();
      await store.write(key, saved, 0, saved.assets);
      return key;
    });
    await page.goto(
      `http://127.0.0.1:${server.address().port}/make?draft=${libraryKey}`,
    );
    await press(page.locator("#history-button"));
    for (const [path, role] of [
      [["pack", "avatars"], "collection"],
      [["pack", "avatars", "sample-vale"], "entity"],
    ])
      await press(
        page.locator(`[data-setting="${authoringCardId(path, role)}"]`),
      );
    await press(
      page.locator('[data-setting="designer-tool-art-library-sample-vale"]'),
    );
    await press(
      page
        .locator("#card-actions button")
        .filter({ hasText: "Browse saved artwork" }),
    );
    const savedArt = page.locator(
      '[data-setting="designer-tool-art-library-sample-vale-0"]',
    );
    await savedArt.locator("img").evaluate((img) => img.decode());
    await press(savedArt);
    const useArt = page
      .locator("#card-actions button")
      .filter({ hasText: "Use avatar" });
    await press(useArt);
    await press(useArt);
    await savedArt.waitFor({ state: "detached" });
    await page.reload();
    const retained = await page.evaluate(async (key) => {
      const { openAuthoringStore } = await import(
        "/card-game/authoring-local-store.mjs"
      );
      const { listGeneratedArt } = await import(
        "/card-game/authoring-art-library.mjs"
      );
      const store = await openAuthoringStore(),
        record = await store.read(key);
      return (await listGeneratedArt(record, "sample-vale")).length;
    }, libraryKey);
    assert(
      retained >= 2,
      "original archive survives selecting and reloading artwork",
    );
    assert.deepEqual(errors, []);
    console.log(
      `Avatar design ${width}: original PNG decode, immutable source, binding and Dino card passed`,
    );
    await page.close();
  }
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
