import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { chromium } from "playwright";
import { createServer } from "../card-game/serve.mjs";
import { createWorld, encodeSave } from "../card-game/world.mjs";
import { enableMotives } from "../card-game/motives.mjs";
import { availableCards } from "../card-game/cards.mjs";

// Hand cards wear no count badges, a chosen card has one white edge, the
// first card and its quest tab stay inside the hand, and no name hides
// under the next card in the fan.
const output = new URL("../../output/card-hand-frame/", import.meta.url);
await mkdir(output, { recursive: true });
const server = createServer();
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const browser = await chromium.launch({ headless: true });
const world = enableMotives(createWorld());
world.actors.moth.place = world.actors.keeper.place = "station";
for (const item of ["cloth", "lamp", "oil"]) world.items[item].holder = "vale";
world.actors.vale.visited.push("pond");
// A near quest folds behind Vale with its tab glowing.
world.actors.vale.want = { kind: "item", target: "bell", since: 0, refusals: 0 };

const inspect = () => {
  const hand = document.querySelector("#hand"),
    box = hand.getBoundingClientRect(),
    frames = [...hand.querySelectorAll(".card-frame:not([hidden])")],
    z = (el) => parseInt(getComputedStyle(el).zIndex) || 0,
    problems = [];
  frames.forEach((frame, i) => {
    const card = frame.querySelector(".card"),
      id = card.dataset.card || "quest";
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
      if (levels[0] && style.borderTopColor !== getComputedStyle(levels[0]).color)
        problems.push(`${id} numeral colour`);
    }
    // A name ends before the next card begins, unless this card is in front.
    const name = card.querySelector(".name"),
      next = frames[i + 1];
    if (name?.textContent && next && z(frame) <= z(next)) {
      const range = document.createRange();
      range.selectNodeContents(name);
      const over =
        range.getBoundingClientRect().right -
        next.querySelector(".card").getBoundingClientRect().left;
      if (over > 1) problems.push(`${id} name under next ${over.toFixed(1)}`);
    }
  });
  // The first card and its quest tab, rotated, inside the hand's clip box.
  for (const el of frames[0].querySelectorAll(":scope > .card, .quest-tab")) {
    const rect = el.getBoundingClientRect();
    if (el.checkVisibility() && (rect.left < box.left || rect.top < box.top))
      problems.push(`${el.className} clipped`);
  }
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
      assert.deepEqual(await page.evaluate(inspect), [], `${width} ${state}`);
      const path = new URL(`${width}-${state}.png`, output).pathname;
      await page.screenshot({ path });
    };
    await check("rest");
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
  console.log("Hand frames: no counts, one chosen edge, nothing clipped.");
} finally {
  await browser.close();
  server.close();
}
