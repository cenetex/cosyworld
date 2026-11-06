import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { chromium } from "playwright";
import { createServer } from "../card-game/serve.mjs";
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
    await page.route("**/authoring/generate/seed", (route) => {
      const input = route.request().postDataJSON();
      calls++;
      if (calls === 1)
        return route.fulfill({
          status: 401,
          json: { error: "Sign in with your passkey." },
        });
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
      return route.fulfill({
        json: {
          cards:
            input.kind === "world"
              ? all
              : all.filter((c) => c.kind === input.kind),
        },
      });
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
    const read = () =>
      page.evaluate(async () => {
        const { openAuthoringStore } = await import(
          "/card-game/authoring-local-store.mjs"
        );
        const db = await openAuthoringStore();
        try {
          return await db.read(
            new URL(location.href).searchParams.get("draft") || "first-world",
          );
        } finally {
          db.close();
        }
      });
    const saved = (generation) =>
      page.waitForFunction(async (generation) => {
        if (!new URL(location.href).searchParams.get("draft")) return false;
        const { openAuthoringStore } = await import(
          "/card-game/authoring-local-store.mjs"
        );
        const db = await openAuthoringStore();
        try {
          return (
            (await db.read(new URL(location.href).searchParams.get("draft")))
              ?.generation === generation
          );
        } finally {
          db.close();
        }
      }, generation);
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
    const final = await read();
    await page.reload();
    await page.locator("#history-button").waitFor();
    assert.deepEqual(await read(), final);
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
