import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { chromium } from "playwright";
import { createServer } from "../card-game/serve.mjs";
import { mockJobs } from "./authoring-jobs-mock.mjs";
import { authoringCardId } from "../card-game/authoring-tree.mjs";
const server = createServer();
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const browser = await chromium.launch();
const output = new URL("../../output/make-seed/", import.meta.url).pathname;
await mkdir(output, { recursive: true });
try {
  for (const width of [1440, 390, 320]) {
    const page = await browser.newPage({
      viewport: { width, height: 900 },
      hasTouch: width < 700,
      reducedMotion: "reduce",
    });
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    let calls = 0;
    await page.route("**/auth/account", (route) =>
      route.fulfill({ json: { authenticated: true, display_name: "Maker" } }),
    );
    let png, bytes;
    let imageCalls = 0;
    const jobs = await mockJobs(page, {
      seed(input) {
        calls++;
        if (calls === 1)
          return {
            refuse: {
              status: 401,
              json: { error: "Sign in with your passkey.", code: "unauthorized" },
            },
          };
        const suffix = input.kind === "world" ? "" : ` ${calls}`;
        const all = [
          {
            kind: "place",
            name: `Rainy quay${suffix}`,
            text: "The last ferry waits here.",
          },
          {
            kind: "avatar",
            name: `Mara${suffix}`,
            text: "The keeper needs a lamp for the ferry.",
          },
          {
            kind: "item",
            name: `Blue lamp${suffix}`,
            text: "Blue glass shelters a steady flame.",
          },
        ];
        return {
          cards:
            input.kind === "world"
              ? all
              : all.filter((c) => c.kind === input.kind),
        };
      },
      image(input, api) {
        assert.equal(input.description, "A keeper in a green coat.");
        imageCalls++;
        assert.equal(input.kind, "avatar");
        if (input.role === "pose-sheet") assert(input.reference?.sha256);
        return {
          basis: input.basis,
          model: "openai/gpt-image-2.6-flare",
          image: api.store(bytes),
          usage: {},
        };
      },
    });
    const press = (locator) => (width < 700 ? locator.tap() : locator.click());
    const choose = async (id) => {
      const card = page.locator(`[data-setting="${id}"]`);
      await press(card);
      if ((await card.getAttribute("aria-expanded")) === "false")
        await press(card);
    };
    const tool = (id) => choose(`designer-tool-${id}`);
    const category = async (group) => {
      await press(page.locator("#history-button"));
      await entity(group, Object.keys((await read()).draft.pack[group])[0]);
    };
    const entity = (group, id) =>
      choose(authoringCardId(["pack", group, id], "entity"));
    const action = () => press(page.locator("#card-actions button"));
    // A paid action needs two taps; a second tap in the same gesture is ignored.
    const twice = async () => {
      await action();
      await page.waitForTimeout(450);
      await action();
    };
    const read = () =>
      page.evaluate(async () => {
        const { openAuthoringStore } = await import(
          "/card-game/authoring-local-store.mjs"
        );
        const db = await openAuthoringStore();
        try {
          const record = await db.read(
            new URL(location.href).searchParams.get("draft") || "first-world",
          );
          return {
            ...record,
            assets: await Promise.all(
              [...record.assets].map(async ([path, bytes]) => {
                const sha256 = Array.from(
                  new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)),
                  (b) => b.toString(16).padStart(2, "0"),
                ).join("");
                let dimensions = null;
                if (path.endsWith(".png")) {
                  const bitmap = await createImageBitmap(
                    new Blob([bytes], { type: "image/png" }),
                  );
                  dimensions = [bitmap.width, bitmap.height];
                  bitmap.close();
                }
                return { path, sha256, size: bytes.byteLength, dimensions };
              }),
            ),
          };
        } finally {
          db.close();
        }
      });
    // waitForFunction does not await a promise, so poll the store from here.
    const until = async (done) => {
      for (let i = 0; i < 200; i++) {
        const value = await page.evaluate(async () => {
          const draft = new URL(location.href).searchParams.get("draft");
          if (!draft) return null;
          const { openAuthoringStore } = await import(
            "/card-game/authoring-local-store.mjs"
          );
          const db = await openAuthoringStore();
          try {
            const record = await db.read(draft);
            return record
              ? {
                  generation: record.generation,
                  avatars: record.draft?.pack?.avatars,
                }
              : null;
          } finally {
            db.close();
          }
        });
        if (value && done(value)) return;
        await page.waitForTimeout(100);
      }
      throw new Error("The saved draft did not reach the expected state.");
    };
    const saved = (generation) => until((v) => v.generation >= generation);
    await page.goto(`http://127.0.0.1:${server.address().port}/make`);
    await page.locator(".action-beat-note").waitFor();
    await page
      .getByRole("textbox", { name: "World seed" })
      .fill("A rainy harbour with clockwork birds");
    await page.screenshot({
      path: `${output}/${width}-seed.png`,
      animations: "disabled",
    });
    await action();
    await tool("sign-in");
    await action();
    assert.equal(
      await page.getByRole("textbox", { name: "World seed" }).innerText(),
      "A rainy harbour with clockwork birds",
    );
    assert.equal(calls, 1);
    await action();
    await saved(1);
    const first = await read(),
      pack = first.draft.pack;
    const [avatar] = Object.keys(pack.avatars),
      [item] = Object.keys(pack.items),
      [place] = Object.keys(pack.places);
    assert.equal(pack.avatars[avatar].want.target, item);
    assert.equal(pack.items[item].holder, place);
    assert.equal(first.draft.document, "");
    await page.screenshot({
      path: `${output}/${width}-created.png`,
      animations: "disabled",
    });
    for (const [group, id] of [
      ["avatars", avatar],
      ["items", item],
      ["places", place],
    ])
      assert(
        await page
          .locator(
            `[data-setting="${authoringCardId(["pack", group, id], "entity")}"]`,
          )
          .isVisible(),
      );
    await press(page.locator("#menu-button"));
    await tool("maker-details");
    await action();
    await choose(authoringCardId(["pack", "avatars"], "collection"));
    await tool("seed");
    await page.getByRole("textbox", { name: "World idea" }).waitFor();
    await press(page.locator("#menu-button"));
    await tool("maker-details");
    await action();
    await category("items");
    await entity("items", item);
    await tool(`regenerate-${item}`);
    await action();
    await saved(2);
    assert.deepEqual((await read()).draft.pack.avatars, pack.avatars);
    await category("items");
    await entity("items", item);
    await tool(`discard-${item}`);
    await action();
    await saved(3);
    assert.equal((await read()).draft.pack.avatars[avatar].want, undefined);
    await press(page.locator("#menu-button"));
    await choose("designer-undo");
    await action();
    await choose("designer-save");
    await action();
    await saved(4);
    assert.equal((await read()).draft.pack.avatars[avatar].want.target, item);
    await press(page.locator("#history-button"));
    await category("places");
    await tool("uncover-place");
    await action();
    await saved(5);
    assert.equal(Object.keys((await read()).draft.pack.places).length, 2);
    await category("avatars");
    await entity("avatars", avatar);
    await tool(`quest-${avatar}`);
    await tool(`discard-quest-${avatar}`);
    await action();
    await saved(6);
    // Exercise real UI, image decoding/slicing and IndexedDB, with no provider charge.
    png = await page.evaluate(() => {
      const canvas = document.createElement("canvas");
      canvas.width = 300;
      canvas.height = 200;
      const ctx = canvas.getContext("2d");
      for (let i = 0; i < 6; i++) {
        ctx.fillStyle = ["red", "green", "blue", "yellow", "purple", "orange"][
          i
        ];
        ctx.fillRect((i % 3) * 100 + 20, Math.floor(i / 3) * 100 + 20, 60, 60);
      }
      return canvas.toDataURL("image/png").split(",")[1];
    });
    bytes = Buffer.from(png, "base64");
    const generate = async (role, first = false) => {
      await category("avatars");
      await entity("avatars", avatar);
      await tool(`art-${avatar}-${role}`);
      const button = page.locator("#card-actions button");
      await action();
      assert.equal(
        await button.innerText(),
        `Tap again to generate ${role === "portrait" ? "avatar" : "poses"}`,
      );
      await page.waitForTimeout(450);
      await action();
      const physical = page.getByRole("textbox", {
        name: "Physical description only",
      });
      // The first generation asks for the physical description before it paints.
      if (first) await physical.waitFor();
      if (await physical.isVisible()) {
        await physical.fill("A keeper in a green coat.");
        if (first) {
          // Hold the paid image back while the maker taps around the table.
          const held = jobs.hold("image");
          await twice();
          await held.seen;
          await button.filter({ hasText: "Generating…" }).waitFor();
          assert.equal(await button.isDisabled(), true);
          await category("items");
          await entity("items", item);
          await press(page.locator("#menu-button"));
          await press(page.locator("#history-button"));
          held.release();
        } else await twice();
      }
      if (first) {
        // The first portrait is archived, then saved: wait for the saved art.
        await until((v) => Boolean(v.avatars?.[avatar]?.portrait));
        const body = await page.locator("body").innerText();
        assert(!/editor changed|could not be saved/u.test(body), body);
        assert.equal(
          await page
            .locator('[data-setting="designer-tool-retry-unsaved-artwork"]')
            .count(),
          0,
        );
        return;
      }
      await page
        .getByRole("button", { name: "Confirm artwork", exact: true })
        .waitFor();
      const preview = page.locator(
        `[data-setting="designer-tool-art-${avatar}-${role}-preview-0"]`,
      );
      await preview.waitFor({ state: "visible" });
      const image = await preview
        .locator(".art img")
        .first()
        .evaluate(async (img) => {
          await img.decode();
          return [
            img.src.startsWith("blob:"),
            img.naturalWidth,
            img.naturalHeight,
          ];
        });
      assert.deepEqual(image, [true, 300, 200]);
    };
    await generate("portrait", true);
    const firstRead = await read();
    const firstPortrait = firstRead.draft.pack.avatars[avatar].portrait;
    assert(
      firstPortrait,
      JSON.stringify({
        generation: firstRead.generation,
        avatar: firstRead.draft.pack.avatars[avatar],
        assets: firstRead.draft.assets.map((a) => a.path),
        errors,
      }),
    );
    await generate("portrait");
    await tool(`art-${avatar}-portrait-discard`);
    await action();
    assert.equal(
      (await read()).draft.pack.avatars[avatar].portrait,
      firstPortrait,
    );
    await generate("portrait");
    // One failed local write must retain the paid result for a no-charge retry.
    await page.evaluate(() => {
      const put = IDBObjectStore.prototype.put;
      IDBObjectStore.prototype.put = function (...args) {
        if (this.name === "drafts") {
          IDBObjectStore.prototype.put = put;
          throw new Error("Storage full (smoke)");
        }
        return put.apply(this, args);
      };
    });
    await action();
    await page.getByText("Storage full (smoke)", { exact: true }).waitFor();
    await action();
    await saved(11);
    assert.equal(imageCalls, 3);
    await generate("pose-sheet");
    for (let i = 0; i < 7; i++) {
      const preview = page.locator(
        `[data-setting="designer-tool-art-${avatar}-pose-sheet-preview-${i}"]`,
      );
      await preview.waitFor({ state: "visible" });
      const image = await preview
        .locator(".art img")
        .first()
        .evaluate(async (img) => {
          await img.decode();
          return [
            img.src.startsWith("blob:"),
            img.naturalWidth,
            img.naturalHeight,
          ];
        });
      assert.deepEqual(image, i === 0 ? [true, 300, 200] : [true, 100, 100]);
    }
    await page.screenshot({
      path: `${output}/${width}-pose-review.png`,
      animations: "disabled",
    });
    await action();
    await saved(13);
    assert.equal(imageCalls, 4);
    for (const pose of ["happy", "sad", "hit", "strike", "brace", "sleep"])
      assert(
        (await read()).draft.assets.some((asset) =>
          asset.path.endsWith(`-${pose}.png`),
        ),
      );
    const final = await read();
    for (const pose of ["happy", "sad", "hit", "strike", "brace", "sleep"]) {
      const asset = final.assets.find((a) => a.path.endsWith(`-${pose}.png`));
      const meta = final.draft.assets.find((a) => a.path === asset.path);
      assert.deepEqual(asset.dimensions, [100, 100]);
      assert.equal(asset.sha256, meta.sha256);
      assert.equal(asset.size, meta.size);
    }
    await page.reload();
    await page.locator("#history-button").waitFor();
    assert.deepEqual(await read(), final);
    // A second avatar has no portrait yet. Its image job is still running when
    // the page reloads; the portrait lands from the server's result afterwards.
    await category("avatars");
    await tool("uncover-avatar");
    await action();
    await until((v) => Object.keys(v.avatars || {}).length === 2);
    const second = Object.keys((await read()).draft.pack.avatars).find(
      (id) => id !== avatar,
    );
    await category("avatars");
    await entity("avatars", second);
    await tool(`art-${second}-portrait`);
    const button = page.locator("#card-actions button");
    await action();
    await page.waitForTimeout(450);
    await action();
    await page
      .getByRole("textbox", { name: "Physical description only" })
      .fill("A keeper in a green coat.");
    const held = jobs.hold("image");
    await twice();
    await held.seen;
    // The job id is in the local store before the page goes away.
    const recorded = () =>
      page.evaluate(async () => {
        const { openAuthoringStore } = await import(
          "/card-game/authoring-local-store.mjs"
        );
        const db = await openAuthoringStore();
        try {
          return await db.readJobs(
            new URL(location.href).searchParams.get("draft"),
          );
        } finally {
          db.close();
        }
      });
    for (let i = 0; i < 50 && !(await recorded()).length; i++)
      await page.waitForTimeout(100);
    assert.deepEqual(
      (await recorded()).map(({ kind, role, avatarId }) => [
        kind,
        role,
        avatarId,
      ]),
      [["image", "portrait", second]],
    );
    await page.reload();
    await page.locator("#history-button").waitFor();
    await category("avatars");
    await entity("avatars", second);
    await tool(`art-${second}-portrait`);
    await button.filter({ hasText: "Generating…" }).waitFor();
    assert.equal(await button.isDisabled(), true);
    assert.equal((await read()).draft.pack.avatars[second].portrait, undefined);
    held.release();
    await until((v) => Boolean(v.avatars?.[second]?.portrait));
    assert.equal(imageCalls, 5);
    for (let i = 0; i < 50 && (await recorded()).length; i++)
      await page.waitForTimeout(100);
    assert.deepEqual(await recorded(), []);
    assert(
      !/could not be saved|editor changed/u.test(
        await page.locator("body").innerText(),
      ),
    );
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth,
      ),
      false,
    );
    assert.deepEqual(errors, []);
    console.log(
      `Seed maker ${width}: create, sign-in return, reroll, discard, Undo, uncover, quest discard and reload passed`,
    );
    await page.close();
  }
} finally {
  await browser.close();
  server.close();
}
