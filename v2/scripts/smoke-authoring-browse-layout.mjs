import { mockJobs } from "./authoring-jobs-mock.mjs";
import assert from "node:assert/strict";
import { chromium } from "playwright";
import { createServer } from "../card-game/serve.mjs";
import { authoringCardId } from "../card-game/authoring-tree.mjs";

// Browse in a made world: empty state, a damaged record, and a table that
// does not lurch. Also Show details then discard every card (World anchored two
// tools and stopped the editor). No Rust server: the authoring API is mocked.
const server = createServer();
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE });
try {
  for (const width of [1440, 390, 320]) {
    const page = await browser.newPage({
      viewport: { width, height: 844 },
      hasTouch: width < 700,
      reducedMotion: "reduce",
    });
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.route("**/auth/account", (route) =>
      route.fulfill({ json: { authenticated: true, display_name: "Maker" } }),
    );
    await mockJobs(page, {
      seed: () => ({
        cards: [
          {
            kind: "place",
            name: "Rainy quay",
            text: "The last ferry waits.",
          },
          { kind: "avatar", name: "Mara", text: "The keeper needs a lamp." },
          {
            kind: "item",
            name: "Blue lamp",
            text: "Blue glass shelters a flame.",
          },
        ],
      }),
    });
    const press = (locator) => (width < 700 ? locator.tap() : locator.click());
    const choose = async (id) => {
      const card = page.locator(`[data-setting="${id}"]`);
      await press(card);
      if ((await card.getAttribute("aria-expanded")) === "false")
        await press(card);
    };
    const action = () => press(page.locator("#card-actions button"));
    const label = () => page.locator("#card-actions button").innerText();
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
          return { generation: record.generation, pack: record.draft.pack };
        } finally {
          db.close();
        }
      });
    const saved = async (generation) => {
      for (let i = 0; i < 200; i++) {
        const draft = new URL(page.url()).searchParams.get("draft");
        if (draft && (await read()).generation >= generation) return;
        await page.waitForTimeout(100);
      }
      throw new Error("The draft did not save.");
    };
    const entity = async (group, id) => {
      await press(page.locator("#history-button"));
      const first = Object.keys((await read()).pack[group])[0];
      const card = page.locator(
        `[data-setting="${authoringCardId(["pack", group, first], "entity")}"]`,
      );
      if (!(await card.isVisible()))
        await choose(authoringCardId(["pack", group], "collection"));
      await choose(authoringCardId(["pack", group, first], "entity"));
      if (id) assert.equal(first, id);
    };
    const create = async () => {
      await page
        .getByRole("textbox", { name: "World seed" })
        .fill("A rainy harbour with clockwork birds");
      await action();
    };
    await page.goto(`http://127.0.0.1:${server.address().port}/make`);
    await page.locator(".action-beat-note").waitFor();
    await create();
    await saved(1);

    // Show details, then discard all three cards: the editor keeps working.
    await press(page.locator("#menu-button"));
    await choose("designer-tool-maker-details");
    await action();
    let generation = 1;
    for (const group of ["items", "avatars", "places"]) {
      const id = Object.keys((await read()).pack[group])[0];
      await entity(group);
      await choose(`designer-tool-discard-${id}`);
      await action();
      await saved(++generation);
    }
    await page.getByRole("textbox", { name: "World seed" }).waitFor();
    assert.equal(await label(), "Create");
    await create();
    await saved(++generation);
    assert.deepEqual(errors, []);

    // Two saved sets for the avatar; the second one is damaged.
    const avatar = Object.keys((await read()).pack.avatars)[0];
    const archive = (damage) =>
      page.evaluate(
        async ({ avatar, damage }) => {
          const { openAuthoringStore } = await import(
            "/card-game/authoring-local-store.mjs"
          );
          const { archiveGeneratedArt } = await import(
            "/card-game/authoring-art-library.mjs"
          );
          const { assetMetadata } = await import(
            "/card-game/authoring-draft.mjs"
          );
          const { adoptAcceptedAvatar } = await import(
            "/card-game/authoring-accepted.mjs"
          );
          const db = await openAuthoringStore();
          try {
            const key = new URL(location.href).searchParams.get("draft");
            const record = await db.read(key);
            const bytes = Uint8Array.from(
              atob(
                "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
              ),
              (c) => c.charCodeAt(0),
            );
            const image = {
              ...(await assetMetadata("x.png", "image/png", bytes)),
              bytes,
              role: "base",
            };
            const prepared = await archiveGeneratedArt(record, {
              avatarId: avatar,
              description: "A keeper.",
              role: "portrait",
              images: [image],
            });
            const next = adoptAcceptedAvatar(record, prepared);
            // Valid bytes and digest, but not a readable saved set.
            if (damage)
              for (const path of prepared.bytes.keys())
                if (path.endsWith("/output.json")) {
                  const junk = new TextEncoder().encode("not a saved set");
                  const meta = await assetMetadata(
                    path,
                    "application/json",
                    junk,
                  );
                  next.assets.set(path, junk);
                  next.draft.assets = next.draft.assets.map((a) =>
                    a.path === path ? meta : a,
                  );
                }
            await db.write(key, next, record.generation, next.assets);
          } finally {
            db.close();
          }
        },
        { avatar, damage },
      );
    const library = `designer-tool-art-library-${avatar}`;
    const open = async () => {
      await entity("avatars");
      await choose(library);
      await page.waitForTimeout(400);
    };
    const boxes = () =>
      page.evaluate(() => {
        const rect = (element) => {
          const r = element.getBoundingClientRect();
          return { x: r.x, y: r.y, right: r.right, bottom: r.bottom };
        };
        return {
          bar: rect(document.querySelector("#card-actions")),
          hand: rect(document.querySelector("#settings-hand")),
          frames: Object.fromEntries(
            [...document.querySelectorAll(".card-frame:not([hidden])")].map(
              (frame) => [
                frame.querySelector("[data-setting]").dataset.setting,
                { ...rect(frame), zone: frame.dataset.zone },
              ],
            ),
          ),
        };
      });

    // Empty state: nothing saved, nothing re-laid out.
    await open();
    assert.equal(await label(), "Browse saved artwork");
    const empty = await boxes();
    await action();
    await page.waitForTimeout(500);
    assert.equal(await label(), "No saved artwork yet");
    assert.equal(await page.locator("#card-actions button").isDisabled(), true);
    const after = await boxes();
    assert.deepEqual(Object.keys(after.frames), Object.keys(empty.frames));
    for (const [id, box] of Object.entries(after.frames))
      assert(
        Math.abs(box.x - empty.frames[id].x) <= 2 &&
          Math.abs(box.y - empty.frames[id].y) <= 2,
        `${id} moved on an empty Browse`,
      );
    assert.deepEqual(errors, []);

    // One good set and one damaged set.
    await archive(false);
    await archive(true);
    await page.reload();
    await page.locator("#history-button").waitFor();
    await open();
    assert.equal(await label(), "Browse saved artwork");
    const before = await boxes();
    await action();
    await page.waitForTimeout(500);
    const result = await boxes();
    const note = await page.locator(".action-beat-note").innerText();
    assert.match(note, /could not be read/u);
    const sets = Object.keys(result.frames).filter((id) =>
      id.startsWith(`${library}-`),
    );
    assert(sets.length >= 1, "a saved set is dealt");
    for (const [id, box] of Object.entries(result.frames))
      assert(box.y >= -0.5, `${id} is clipped above the viewport (${box.y})`);
    const first = result.frames[sets[0]];
    // On a phone the first saved set is dealt clear of the bar. A desktop
    // table is taller than the window; the top stack stays in view and the
    // set's top edge stays above the bar (its foot needs the hand scrolled).
    if (width < 700) {
      assert(
        first.bottom <= result.hand.bottom + 0.5 &&
          first.bottom <= result.bar.y,
        `the first saved set is cut off or under the bar ${JSON.stringify([first, result.bar, result.hand])}`,
      );
    } else
      assert(first.y < result.bar.y, "the first saved set is out of sight");
    for (const [id, box] of Object.entries(result.frames)) {
      const was = before.frames[id];
      // A card played from the hand moves to the table; that is the selection.
      if (!was || was.zone === "hand" || id === library) continue;
      if (was.right < 0 || was.x > width) continue;
      assert(Math.abs(box.x - was.x) <= 4, `${id} slid sideways`);
    }
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth,
      ),
      false,
    );
    assert.deepEqual(errors, []);
    console.log(
      `Browse layout ${width}: empty state, damaged set, no clipping or lurch, details then discard all passed`,
    );
    await page.close();
  }
} finally {
  await browser.close();
  server.close();
}
