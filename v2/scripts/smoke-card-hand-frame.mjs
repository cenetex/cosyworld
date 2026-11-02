import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { chromium } from "playwright";
import { createServer } from "../card-game/serve.mjs";
import { createWorld, encodeSave } from "../card-game/world.mjs";
import { enableMotives } from "../card-game/motives.mjs";
import { availableCards } from "../card-game/cards.mjs";

// Hand cards wear no count badges, a chosen card has one white edge, the
// first card and its folded quest stay inside the hand, the folded quest is
// a full-size face-down card with a glowing tier line, and no name, long
// two-line ones included, hides under a card on either side in the fan.
const output = new URL("../../output/card-hand-frame/", import.meta.url);
await mkdir(output, { recursive: true });
const server = createServer();
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const browser = await chromium.launch({ headless: true });
const world = enableMotives(createWorld());
world.actors.moth.place = world.actors.keeper.place = "station";
for (const item of ["cloth", "lamp", "oil"]) world.items[item].holder = "vale";
world.actors.vale.visited.push("pond");
// A near quest folds behind Vale as a glowing face-down card.
world.actors.vale.want = {
  kind: "item",
  target: "bell",
  since: 0,
  refusals: 0,
};

const inspect = (longName) => {
  const hand = document.querySelector("#hand"),
    box = hand.getBoundingClientRect(),
    frames = [...hand.querySelectorAll(".card-frame:not([hidden])")],
    renamed = [],
    problems = [];
  frames.forEach((frame) => {
    const card = frame.querySelector(".card"),
      id = card.dataset.card || "quest";
    // A long two-line name, like "Road to Theban Courtyard", on every card.
    const name = card.querySelector(".name");
    if (longName && name) {
      renamed.push([name, name.textContent]);
      name.textContent = longName;
    }
    for (const el of frame.querySelectorAll("*"))
      if (
        !el.closest(".sr-only, .name, .quest-head") &&
        !el.children.length &&
        /^\s*\d+\s*$/.test(el.textContent)
      )
        problems.push(`${id} count ${el.className}`);
    if (frame.querySelectorAll(".held-preview").length > 1)
      problems.push(`${id} previews`);
    for (const pseudo of ["::before", "::after"])
      if (getComputedStyle(card, pseudo).content !== "none")
        problems.push(`${id} ${pseudo}`);
    const levels = card.querySelectorAll(".card-level");
    if (levels.length > (card.classList.contains("location") ? 0 : 1))
      problems.push(`${id} levels`);
    const style = getComputedStyle(card);
    if (card.dataset.selected === "true") {
      if (style.outlineColor !== "rgb(255, 250, 240)")
        problems.push(`${id} edge`);
      if (/242, 219, 166/.test(style.boxShadow)) problems.push(`${id} gold`);
      if (
        levels[0] &&
        style.borderTopColor !== getComputedStyle(levels[0]).color
      )
        problems.push(`${id} numeral colour`);
    }
    // Every line of a name is in view at both ends: no card on either side,
    // a raised or chosen one included, covers it. The hand's edges may hide
    // cards scrolled past them.
    if (name?.textContent && name.checkVisibility()) {
      const range = document.createRange();
      range.selectNodeContents(name);
      for (const line of range.getClientRects())
        for (const x of [line.left + 1, line.right - 1]) {
          const hit = document.elementFromPoint(x, line.top + line.height / 2);
          if (x < box.left || x > box.right) continue;
          const over = hit?.closest(".card-frame");
          if (over !== frame)
            problems.push(
              `${id} name under ${over?.querySelector(".card")?.dataset.card ?? hit?.className}`,
            );
        }
    }
  });
  // The first card and its folded quest, rotated, inside the hand's clip box.
  for (const el of frames[0].querySelectorAll(":scope > .card, .quest-fold")) {
    const rect = el.getBoundingClientRect();
    if (el.checkVisibility() && (rect.left < box.left || rect.top < box.top))
      problems.push(`${el.className} clipped`);
  }
  for (const [name, text] of renamed) name.textContent = text;
  return problems;
};

try {
  const sizes = { 390: 844, 765: 760, 1280: 720, 1440: 900, 1900: 960 };
  for (const [size, height] of Object.entries(sizes)) {
    const width = Number(size);
    const key = `cosyworld.reflected-shore.v1.hand-frame-${width}`;
    const page = await browser.newPage({
      viewport: { width, height },
      reducedMotion: "reduce",
    });
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.route("**/card-game/text", (route) =>
      route.fulfill({ status: 503, json: { error: "fixture" } }),
    );
    await page.addInitScript(
      ({ key, save, seen }) => {
        localStorage.setItem(key, save);
        localStorage.setItem(`${key}.seen`, JSON.stringify(seen));
        localStorage.setItem("cosyworld.dialogue.sound", "off");
      },
      { key, save: encodeSave(world), seen: availableCards(world) },
    );
    const origin = `http://127.0.0.1:${server.address().port}`;
    await page.goto(`${origin}/?table=hand-frame-${width}`);
    const card = (id) => page.locator(`#hand [data-card="${id}"]`);
    await card("vale").waitFor();
    const check = async (state) => {
      await page.evaluate(async () => {
        document.querySelector("#hand").scrollLeft = 0;
        await new Promise(requestAnimationFrame);
      });
      await page.mouse.move(0, 0);
      assert.deepEqual(await page.evaluate(inspect), [], `${width} ${state}`);
      const path = new URL(`${width}-${state}.png`, output).pathname;
      await page.screenshot({ path });
      const long = await page.evaluate(inspect, "Road to Theban Courtyard");
      assert.deepEqual(long, [], `${width} ${state} long names`);
    };
    await check("rest");
    // The folded quest is a card in Vale's stack: Vale's size, the carved
    // back and a glowing line in its tier colour. There is no tab.
    const fold = await page.evaluate(() => {
      const frame = document.querySelector(
          '#hand [data-card="vale"]',
        ).parentElement,
        fold = frame.querySelector(":scope > .quest-fold"),
        card = frame.querySelector(":scope > .card"),
        style = fold && getComputedStyle(fold);
      // outline-color resolves the tier colour the same way the line does.
      if (fold) fold.style.outlineColor = "var(--tier-color)";
      return {
        tabs: document.querySelectorAll(".quest-tab").length,
        visible: fold?.checkVisibility() ?? false,
        size: fold && [
          fold.offsetWidth - card.offsetWidth,
          fold.offsetHeight - card.offsetHeight,
        ],
        back: style?.backgroundImage ?? "",
        line: style?.borderTopColor === style?.outlineColor,
        lineWidth: style?.borderTopWidth,
        glow: style?.boxShadow ?? "none",
      };
    });
    assert.equal(fold.tabs, 0, `${width} no quest tab`);
    assert.equal(fold.visible, true, `${width} folded quest shows`);
    assert.ok(
      fold.size.every((d) => Math.abs(d) <= 1),
      `${width} fold size ${fold.size}`,
    );
    assert.match(fold.back, /card-back/, `${width} fold shows the card back`);
    assert.equal(fold.lineWidth, "2px", `${width} fold line`);
    assert.equal(fold.line, true, `${width} fold line in its tier colour`);
    assert.notEqual(fold.glow, "none", `${width} fold glows`);
    await card("vale").click();
    await check("vale");
    assert.equal(await card("vale").locator(".card-level").count(), 1);
    await card("vale").click();
    await card("station").scrollIntoViewIfNeeded();
    await card("station").click();
    await check("station");
    assert.deepEqual(errors, []);
    await page.close();
  }
  console.log(
    "Hand frames: no counts, one chosen edge, a card-sized folded quest, nothing clipped.",
  );
} finally {
  await browser.close();
  server.close();
}
