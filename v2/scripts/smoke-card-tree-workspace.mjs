import assert from "node:assert/strict";
import { chromium } from "playwright";
import { createServer } from "../card-game/serve.mjs";

const server = createServer();
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const browser = await chromium.launch({ headless: true });
try {
  for (const width of [1440, 390, 320]) {
    const page = await browser.newPage({
      viewport: { width, height: 900 },
      reducedMotion: "reduce",
      hasTouch: width < 700,
    });
    const requests = [],
      errors = [];
    page.on("request", (request) => requests.push(request.url()));
    page.on("pageerror", (error) => errors.push(error.message));
    await page.route("**/app.mjs", async (route) => {
      const response = await route.fetch();
      await route.fulfill({
        response,
        body: `${await response.text()}
globalThis.workspaceSmokeBeat = {show: showActionBeat, clear: clearActionBeat};`,
      });
    });
    await page.goto(
      `http://127.0.0.1:${server.address().port}/?table=tree-workspace-${width}`,
    );
    await page.locator("#hand .card").first().waitFor();
    await page.evaluate(async () => {
      const { installCardWorkspace } = await import(
        "/card-game/settings-screen.mjs"
      );
      const { buildAuthoringTree } = await import(
        "/card-game/authoring-tree.mjs"
      );
      const data = await (await fetch("/card-game/packs.json")).json();
      const pack = data.packs.find((pack) => pack.id === "greek-drama");
      const tree = buildAuthoringTree({ pack, bridge: pack.bridge });
      const cards = tree.cards,
        byId = new Map(cards.map((c) => [c.id, c]));
      const place = cards.find(
        (c) => c.canonicalId === "greek-courtyard" && c.kind === "place",
      );
      const box = cards.find(
        (c) => c.holder === place.id && c.role === "contents",
      );
      const avatar = cards.find(
        (c) => c.holder === box.id && c.kind === "avatar",
      );
      const item = cards.find((c) => c.kind === "item");
      const quests = cards.find(
        (c) => c.role === "quests" && c.holder === tree.roots[0],
      );
      cards.find((c) => c.holder === quests.id).art =
        "/card-game/closed-tree-art.png";
      window.treeIds = {
        place: place.id,
        box: box.id,
        avatar: avatar.id,
        item: item.id,
      };
      window.treeCount = cards.length;
      window.treeChoices = [];
      window.treeEdit = {
        key: "world:document",
        label: "World source",
        value: "A book",
        onInput() {},
      };
      let selected = [];
      window.treeWorkspace = installCardWorkspace({
        label: "Authoring",
        initialGroup: tree.roots[0],
        cards: () => cards,
        layout(cards, { expanded, active }) {
          const open = new Set(expanded),
            nodes = [],
            seen = new Set();
          function visit(id) {
            if (seen.has(id)) return;
            seen.add(id);
            nodes.push({ id });
            if (open.has(id))
              for (const child of tree.children[id] || []) visit(child);
          }
          tree.roots.forEach(visit);
          if (innerWidth > 700 || !active) return { nodes };
          const parent = open.has(active) ? active : byId.get(active)?.holder;
          const path = new Set();
          for (let id = parent; id && !path.has(id); id = byId.get(id)?.holder)
            path.add(id);
          return {
            nodes: nodes.filter(
              (n) => path.has(n.id) || byId.get(n.id)?.holder === parent,
            ),
          };
        },
        onSelect(id) {
          window.treeChoices.push(id);
          const card = byId.get(id);
          if (card.role === "contents") selected = [id];
          else if (card.role === "entity")
            selected = selected.length ? [selected[0], id] : [id];
        },
        selected: () => selected,
        onCancel() {
          if (window.treeCancelHandles === false) return false;
          const had = selected.length > 0;
          selected = [];
          return had;
        },
        describe: (_cards, chosen, armed) => ({
          name: "World",
          edit: window.treeConfirm ? undefined : window.treeEdit,
          actions:
            window.treeConfirm && chosen === item.id
              ? [
                  {
                    label:
                      armed === `${chosen}:0`
                        ? "Discard changes and reload"
                        : "Reload",
                    confirm: true,
                    stays: true,
                  },
                ]
              : [],
        }),
        actionBeat: {
          show(beat) {
            window.treeBeat = beat;
            if (window.treeConfirm) window.workspaceSmokeBeat.show(beat);
          },
          clear() {},
        },
        run() {
          window.treeRuns = (window.treeRuns || 0) + 1;
        },
      });
      window.renameTreeAvatar = () => {
        avatar.name = "Renamed resident";
        window.treeWorkspace.refresh();
      };
      window.treeWorkspace.open();
    });
    const ids = await page.evaluate(() => window.treeIds);
    const card = (id) => page.locator(`[data-setting="${id}"]`);
    const count = () => page.locator("#settings-hand > .card-frame").count();
    const initialCount = await count();
    assert(await page.evaluate(() => window.treeCount > 3000));
    assert((await count()) < 150, "closed Greek details have no frames");
    assert(await page.evaluate(() => window.treeBeat.edit === window.treeEdit));
    await page.evaluate((id) => window.treeWorkspace.focus(id), ids.place);
    const bounds = await card(ids.place).boundingBox();
    await card(ids.place).evaluate((button) => {
      window.heldTreeButton = button;
    });
    await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + 16);
    await page.mouse.down();
    await page.evaluate(() => window.treeWorkspace.refresh());
    await page.mouse.up();
    assert.equal(
      await page.evaluate(() => window.treeChoices.at(-1)),
      ids.place,
    );
    assert(
      await card(ids.place).evaluate(
        (button) => button === window.heldTreeButton,
      ),
    );
    await page.evaluate((id) => window.treeWorkspace.choose(id), ids.box);
    await page.evaluate((id) => window.treeWorkspace.choose(id), ids.avatar);
    if (width < 700)
      assert((await count()) < 20, "phone keeps its active branch");
    await card(ids.avatar).evaluate((button) => {
      window.heldTreeButton = button;
      window.heldTreeFrame = button.parentElement;
      window.heldTreeImage = button.querySelector("img");
    });
    await page.evaluate(() => {
      for (let i = 0; i < 12; i++) window.treeWorkspace.refresh();
      window.renameTreeAvatar();
    });
    assert(
      await card(ids.avatar).evaluate(
        (button) =>
          button === window.heldTreeButton &&
          button.parentElement === window.heldTreeFrame &&
          button.querySelector("img") === window.heldTreeImage,
      ),
    );
    assert.match(
      await card(ids.avatar).getAttribute("aria-label"),
      /^Renamed resident/,
    );
    assert.equal(await card(ids.box).getAttribute("aria-pressed"), "true");
    assert.equal(await card(ids.avatar).getAttribute("aria-pressed"), "true");
    await page.evaluate((id) => window.treeWorkspace.focus(id), ids.avatar);
    const selectedCount = await page.evaluate(() => window.treeChoices.length);
    await page.keyboard.press("ArrowDown");
    assert.equal(
      await page.evaluate(() => window.treeChoices.length),
      selectedCount,
    );
    await page.keyboard.press("Escape");
    assert.equal(
      await card(ids.avatar).getAttribute("aria-pressed"),
      "true",
      "open ancestor stays raised",
    );
    await page.evaluate((id) => window.treeWorkspace.choose(id), ids.item);
    assert(
      await card(ids.item).evaluate(
        (button) =>
          button.classList.contains("item") && button.querySelector(".art img"),
      ),
    );
    assert.equal(
      requests.some((url) => url.endsWith("/closed-tree-art.png")),
      false,
    );
    await page.evaluate(() => window.treeWorkspace.close());
    assert.equal(await page.locator("#settings-screen").isVisible(), false);
    assert.equal(await page.locator("#settings-hand > *").count(), 0);
    await page.evaluate(() => window.treeWorkspace.open());
    assert.equal(await count(), initialCount);
    assert(await card(ids.place).isVisible());
    await page.evaluate((id) => {
      window.treeConfirm = true;
      window.treeRuns = 0;
      window.treeWorkspace.choose(id);
    }, ids.item);
    const action = page.locator("#card-actions button");
    const press = () => (width < 700 ? action.tap() : action.click());
    const label = () => action.textContent();
    assert.equal(await label(), "Reload");
    await press();
    assert.equal(await label(), "Discard changes and reload");
    await page.evaluate((id) => window.treeWorkspace.choose(id), ids.avatar);
    await page.evaluate((id) => window.treeWorkspace.choose(id), ids.item);
    assert.equal(await label(), "Reload", "selection resets confirmation");
    for (const handled of [true, false]) {
      await page.evaluate((value) => {
        window.treeCancelHandles = value;
      }, handled);
      await press();
      assert.equal(await label(), "Discard changes and reload");
      await page.keyboard.press("Escape");
      await page.evaluate((id) => window.treeWorkspace.choose(id), ids.item);
      assert.equal(await label(), "Reload", "Escape resets confirmation");
    }
    assert.equal(await page.evaluate(() => window.treeRuns), 0);
    await press();
    assert.equal(await page.evaluate(() => window.treeRuns), 0);
    await press();
    assert.equal(await page.evaluate(() => window.treeRuns), 1);
    await page.evaluate(() => window.treeWorkspace.close());
    assert.deepEqual(errors, []);
    await page.close();
    console.log(
      `Greek tree workspace ${width}px: visible nodes, stable cards, input and keyboard passed`,
    );
  }
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
