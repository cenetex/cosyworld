// A layout fixture on the real hand; the draft controller owns source edits.
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { chromium } from "playwright";
import { createServer } from "../card-game/serve.mjs";

const output = process.env.TREE_SHOTS || "output/card-tree";
await mkdir(output, { recursive: true });
const server = createServer();
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const browser = await chromium.launch({ headless: true });
try {
  for (const [width, height] of [
    [1440, 900],
    [800, 900],
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
      `http://127.0.0.1:${server.address().port}/?table=tree-${width}`,
    );
    await page.locator("#hand .card").first().waitFor();
    await page.locator("#toolbar-menu-button").click();
    await page.locator("#menu-button").click();
    await page.locator("#settings-hand .card").first().waitFor();
    await page.evaluate(async () => {
      const { placeCardTree } = await import("/card-game/card-tree-layout.mjs");
      const { imageUrl } = await import("/card-game/images.mjs");
      const { setCardLabel } = await import("/card-game/card-label.mjs");
      const art = (name) => `./assets/greek-drama/${name}`;
      const box = "./assets/card-back.webp",
        lock = "./assets/card-back-locked.webp";
      // prettier-ignore
      const records = [
        ["thebes", "Thebes", null, art("courtyard-day.webp")],
        ["contents", "Contents", "thebes", box],
        ["quests", "Quests", "thebes", lock],
        ["antigone", "Antigone", "contents", art("chthonic-antigone.png")],
        ["oil", "Oil", "contents", art("oil-lekythos.png")],
        ["cloth", "Cloth", "contents", "./assets/cloth-card.png"],
        ["antigone-items", "Held items", "antigone", box],
        ["antigone-quests", "Quests", "antigone", lock],
        ["burial", "Bury Polynices", "antigone-quests", art("city-gate-day.webp")],
        ["colonus", "Colonus", null, art("open-door-colonus.webp")],
        ["ship", "Charybdis", null, art("ship-deck.webp")],
        ["crew", "Crew and cargo", "ship", box],
        ["docks", "Docks", "ship", box],
        ["voyages", "Voyage quests", "ship", lock],
        ["harbor", "Harbor", "docks", art("athens-harbor.webp")],
        ["colonus-link", "Colonus", "docks", art("open-door-colonus.webp")],
      ];
      let cards = records.map(([id, name, holder, art]) => ({
        id,
        name,
        holder,
        art,
      }));
      const screen = document.querySelector("#settings-screen");
      const hand = document.querySelector("#settings-hand");
      const template = hand.querySelector(".card-frame").cloneNode(true);
      const expanded = new Set(["thebes", "contents", "ship", "docks"]);
      let active = "contents";
      window.treeDraw = () => {
        placeCardTree(screen, cards, { expanded: [...expanded], active });
        for (const button of hand.querySelectorAll(".card"))
          button.dataset.selected = String(button.dataset.setting === active);
        const face = cards.find((c) => c.id === active);
        const owner = cards.find((c) => c.id === face.holder);
        document.querySelector(".action-beat-text").textContent =
          `World editor · ${[owner?.name, face.name].filter(Boolean).join(" · ")}`;
        document.querySelector(".action-beat-heading").hidden = false;
        const action = document.querySelector("#card-actions button");
        action.textContent = "Preview world";
        action.onclick = () => (window.treePreview = true);
      };
      window.treeRender = () =>
        hand.replaceChildren(
          ...cards.map((card) => {
            const frame = template.cloneNode(true),
              button = frame.querySelector(".card");
            delete frame.dataset.holder;
            if (card.holder) frame.dataset.holder = card.holder;
            frame.dataset.raised = "false";
            frame.dataset.expanded = "true";
            frame.querySelector(".held-preview")?.remove();
            button.dataset.setting = card.id;
            button.dataset.selected = "false";
            button.setAttribute("aria-label", card.name);
            button.setAttribute("aria-pressed", "false");
            setCardLabel(frame.querySelector(".quest-verb"), card.name);
            const picture = frame.querySelector(".quest-ground");
            picture.src = imageUrl(card.art, "card");
            picture.className = "";
            picture.parentElement.className = "art";
            button.onclick = () => {
              active = card.id;
              if (cards.some((c) => c.holder === card.id))
                expanded.add(card.id);
              window.treeDraw();
            };
            return frame;
          }),
        );
      window.treeRender();
      window.treeDraw();
      window.treeUseBadger = async () => {
        const data = await (await fetch("/card-game/packs.json")).json();
        const pack = data.packs.find((pack) => pack.id === "badger-forest");
        cards = [];
        for (const [id, place] of Object.entries(pack.places))
          cards.push({ id, name: place.name, art: place.backdrop });
        for (const [id, avatar] of Object.entries(pack.avatars))
          cards.push({
            id,
            name: avatar.name,
            holder: `${avatar.place}-contents`,
            art: avatar.variants.awake.portrait,
          });
        for (const card of [...cards])
          for (const [role, art] of [
            ["contents", box],
            ["quests", lock],
          ])
            cards.push({
              id: `${card.id}-${role}`,
              name: role === "contents" ? "Contents" : "Quests",
              holder: card.id,
              role,
              art,
            });
        expanded.clear();
        ["clearing", "clearing-contents"].forEach((id) => expanded.add(id));
        active = "clearing-contents";
        window.treeRender();
        window.treeDraw();
        hand.scrollTo(0, 0);
      };
    });
    await page.waitForFunction(() =>
      [...document.querySelectorAll("#settings-hand img")].every(
        (image) => image.complete && image.naturalWidth,
      ),
    );
    await page.waitForTimeout(1400);
    if (width === 800)
      assert(
        await page
          .locator("#settings-hand")
          .evaluate((hand) => hand.scrollWidth > hand.clientWidth),
        "wide branches keep horizontal scroll",
      );
    const card = (id) => page.locator(`[data-setting="${id}"]`);
    const oil = card("oil"),
      contents = card("contents");
    const before = await contents.boundingBox();
    assert(before && before.y >= 50 && before.width >= 44);
    if (width > 700) {
      const parent = await card("thebes").boundingBox(),
        child = await oil.boundingBox();
      assert(
        parent.y < before.y && before.y < child.y,
        "rows follow parentage",
      );
      assert(
        await card("colonus-link").isVisible(),
        "reference card remains distinct",
      );
    } else {
      assert.equal(await card("ship").isVisible(), false);
      assert(await oil.isVisible());
      const child = await oil.boundingBox();
      assert(child.x >= 0 && child.x + child.width <= width);
    }
    await page.screenshot({ path: `${output}/tree-${width}.png` });
    await contents.focus();
    await page.evaluate(() => {
      window.savedTreeNode = document.activeElement;
      window.treeDraw();
    });
    assert(
      await page.evaluate(
        () => window.savedTreeNode === document.activeElement,
      ),
    );
    await card("antigone").click();
    await card("antigone-quests").click();
    assert(await card("burial").isVisible());
    assert(await contents.isVisible(), "deep branch keeps ancestors");
    await page.screenshot({ path: `${output}/quest-${width}.png` });
    await page.locator("#card-actions button").click();
    assert(await page.evaluate(() => window.treePreview));
    await page.evaluate(() => window.treeUseBadger());
    await page.waitForFunction(() =>
      [...document.querySelectorAll("#settings-hand img")].every(
        (image) => image.complete && image.naturalWidth,
      ),
    );
    const root = await card("clearing").boundingBox();
    assert(root.y >= 64 && root.y + root.height <= height - 150);
    await page.screenshot({ path: `${output}/badger-${width}.png` });
    await card("badger").click();
    await card("badger-quests").click();
    assert(
      await card("badger-quests").isVisible(),
      "empty quest box stays selectable",
    );
    await page.screenshot({ path: `${output}/badger-selected-${width}.png` });
    assert(
      await page
        .locator("#settings-hand")
        .evaluate((hand) =>
          [...hand.querySelectorAll(".label-word")]
            .filter((word) => word.checkVisibility())
            .every(
              (word) =>
                word.getBoundingClientRect().right <=
                word.closest(".card").getBoundingClientRect().right - 1,
            ),
        ),
      "labels fit their cards",
    );
    const screen = page.locator("#settings-screen");
    await screen.evaluate((el) =>
      el.style.setProperty("--tree-descriptor-height", "250px"),
    );
    const bounds = await screen.boundingBox();
    assert(bounds.y + bounds.height <= height - 250);
    assert.deepEqual(errors, []);
    await page.close();
    console.log(`tree layout ${width}x${height}: ok`);
  }
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
