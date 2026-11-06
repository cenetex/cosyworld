import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { chromium, webkit } from "playwright";
import { createServer } from "../card-game/serve.mjs";
import { createWorld, encodeSave } from "../card-game/world.mjs";
import { knowsFact } from "../card-game/knowledge.mjs";
import {
  selectCard as selectDesktopCard,
  revealCard,
  tapCard,
} from "./card-browser-helpers.mjs";

const browserName = process.env.CARD_BROWSER || "chromium";
const browserType = { chromium, webkit }[browserName];
assert(browserType, `Unknown CARD_BROWSER: ${browserName}`);
const output = new URL(
  `../../output/card-actions${browserName === "chromium" ? "" : `-${browserName}`}/`,
  import.meta.url,
);
await mkdir(output, { recursive: true });
const server = createServer();
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const browser = await browserType.launch({ headless: true });
const meeting = () => {
  const s = createWorld();
  s.actors.moth.place = s.actors.keeper.place = "station";
  s.items.lamp.holder = "vale";
  return s;
};
async function measureHand(page, selector) {
  return page.evaluate(async (selector) => {
    const button = document.querySelector('#hand [data-card="vale"]'),
      start = button.closest(".card-frame").getBoundingClientRect().top,
      nameStart = button.querySelector(".name").getBoundingClientRect().top,
      hand = () => document.querySelector("#hand").getBoundingClientRect(),
      handStart = hand(),
      quiet = document.querySelector(".dialogue").hidden;
    document.querySelector(selector).click();
    const current = document.querySelector('#hand [data-card="vale"]'),
      frame = current.closest(".card-frame"),
      immediate = frame.getBoundingClientRect().top,
      nameImmediate = current
        .querySelector(".name")
        .getBoundingClientRect().top,
      same = button === current;
    const motions = document
        .querySelector(".play-dock")
        .getAnimations({ subtree: true }),
      clocks = motions
        .filter((motion) =>
          motion.effect.target.matches("#hand, .action-panel"),
        )
        .map((motion) => ({
          target: motion.effect.target.id || motion.effect.target.className,
          state: motion.playState,
          duration: motion.effect.getTiming().duration,
        }));
    // Seek the actual animations so a busy worker cannot miss their midpoint.
    for (const motion of motions) motion.pause();
    await Promise.all(motions.map((motion) => motion.ready));
    for (const motion of motions)
      motion.currentTime = Number(motion.effect.getTiming().duration) / 2;
    const during = frame.getBoundingClientRect().top;
    for (const motion of motions) motion.finish();
    await Promise.all(motions.map((motion) => motion.finished));
    return {
      start,
      immediate,
      during,
      end: frame.getBoundingClientRect().top,
      same,
      clocks,
      nameStart,
      nameImmediate,
      // The first beat's dialogue lies over the hand's foot and lifts it.
      handMoved: (quiet ? ["x", "width"] : ["x", "y", "width", "height"]).some(
        (side) => Math.abs(hand()[side] - handStart[side]) >= 1,
      ),
    };
  }, selector);
}

try {
  for (const [width, height] of [
    [1440, 900],
    [390, 844],
    [360, 740],
    [320, 568],
    [667, 375],
  ]) {
    const page = await browser.newPage({
      viewport: { width, height },
      reducedMotion: width === 320 ? "reduce" : "no-preference",
      hasTouch: width < 700,
    });
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    const key = `cosyworld.reflected-shore.v1.actions-${width}`;
    await page.addInitScript(
      ({ key, save }) => {
        if (!localStorage.getItem(key)) localStorage.setItem(key, save);
        localStorage.setItem("cosyworld.dialogue.sound", "off");
        localStorage.setItem(
          "cosyworld.room-music",
          JSON.stringify({ enabled: false, volume: 0 }),
        );
      },
      { key, save: encodeSave(meeting()) },
    );
    await page.route("**/card-game/text", async (route) => {
      const c = route.request().postDataJSON();
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          revision: c.revision,
          model: "actions-fixture",
          entries: c.entities.map(({ id }) => ({
            id,
            text:
              c.disclosures?.find((fact) => fact.speaker === id)?.text ||
              "Let us consider this.",
          })),
        }),
      });
    });
    const card = (id) => page.locator(`#hand [data-card="${id}"]`);
    // Phone play uses the exposed card top above the dialogue, including
    // after a new scene or a storage refresh changes the hand's layout.
    const selectCard = async (page, id, options) => {
      if (width >= 700) return selectDesktopCard(page, id, options);
      const frame = card(id).locator("..");
      const holder =
        (await frame.getAttribute("hidden")) !== null
          ? await frame.getAttribute("data-holder")
          : null;
      await tapCard(await revealCard(page, id));
      if (
        holder &&
        (await card(holder).getAttribute("aria-pressed")) === "true" &&
        !(await card(holder).evaluate((node) =>
          node.classList.contains("location"),
        ))
      )
        await tapCard(card(holder));
    };
    const state = () =>
      page.evaluate((key) => JSON.parse(localStorage.getItem(key)), key);
    const ready = async () => {
      for (let i = 0; i < 200; i++) {
        if (
          (await page.locator("#hand").getAttribute("data-cooling")) === "false"
        )
          return;
        if (
          (await page.locator("#dialogue-advance").isVisible()) &&
          !(await page.locator("#action-beat").isVisible())
        )
          await page.locator("#dialogue-advance").click();
        await page.waitForTimeout(40);
      }
      throw Error("Dialogue kept the hand busy");
    };
    const load = async (world) => {
      await page.evaluate(({ key, save }) => localStorage.setItem(key, save), {
        key,
        save: encodeSave(world),
      });
      await page.reload();
      await card("vale").waitFor();
      await ready();
    };
    const labels = () => page.locator("#card-actions button").allTextContents();
    // Chosen cards, not the current place raised to show its ways on.
    const chosen = () =>
      page
        .locator('#hand .card[data-selected="true"]')
        .evaluateAll((cards) => cards.map((c) => c.dataset.card).sort());
    const pressed = () =>
      page
        .locator('#hand .card[aria-pressed="true"]')
        .evaluateAll((cards) => cards.map((c) => c.dataset.card).sort());
    const shot = async (name) => {
      await page.waitForFunction(() =>
        [...document.images]
          .filter((image) => image.getClientRects().length > 0)
          .every((image) => image.complete && image.naturalWidth > 0),
      );
      await page.screenshot({
        path: new URL(`${name}-${width}.png`, output).pathname,
        fullPage: true,
      });
      assert.equal(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth + 1,
        ),
        true,
      );
      const styleChecks = await page.evaluate(() => {
        const cards = [...document.querySelectorAll("#hand .card")];
        const controls = [...document.querySelectorAll("#card-actions button")];
        const captions = [
          ...document.querySelectorAll(".action-beat-text, .action-beat-note"),
        ].filter(
          (node) => node.getClientRects().length && node.textContent.trim(),
        );
        return {
          tapClear: [...cards, ...controls].every(
            (node) =>
              getComputedStyle(node).webkitTapHighlightColor ===
              "rgba(0, 0, 0, 0)",
          ),
          captionsFit:
            innerWidth >= 700 ||
            captions.every((node) => {
              const range = document.createRange();
              range.selectNodeContents(node);
              return (
                range.getBoundingClientRect().height <=
                  node.getBoundingClientRect().height + 1 &&
                node.scrollWidth <= node.clientWidth + 1
              );
            }),
        };
      });
      assert(
        styleChecks.tapClear,
        "cards and context actions keep tap highlights clear",
      );
      assert(
        styleChecks.captionsFit,
        "phone action captions show their full words",
      );
      const sizes = await page
        .locator("#card-actions button")
        .evaluateAll((buttons) =>
          buttons.map((b) => ({
            width: b.getBoundingClientRect().width,
            height: b.getBoundingClientRect().height,
          })),
        );
      assert(sizes.every((b) => b.height >= 44 && b.width <= width));
    };
    await page.goto(
      `http://127.0.0.1:${server.address().port}/?table=actions-${width}`,
    );
    await card("vale").waitFor();
    await ready();
    // The page deals its hand; measure once it has landed.
    await page.waitForFunction(
      () =>
        !document.querySelector("#hand").getAnimations({ subtree: true })
          .length,
    );
    const before = await state();
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollHeight <= innerHeight + 1,
      ),
      true,
      "the hand fits the viewport, including short landscape screens",
    );
    const movement = await measureHand(page, '#hand [data-card="vale"]');
    assert.equal(
      movement.same,
      true,
      "selection keeps the card and its focus mounted",
    );
    if (width === 320) {
      assert(Math.abs(movement.immediate - movement.end) < 1);
      assert.deepEqual(
        movement.clocks,
        [],
        "reduced motion applies the final dock layout",
      );
    } else {
      assert.deepEqual(
        movement.clocks.sort((a, b) => a.target.localeCompare(b.target)),
        [{ target: "hand", state: "running", duration: 220 }],
        "the hand animates for 220 ms",
      );
      assert(
        Math.abs(movement.immediate - movement.start) < 1,
        "selection starts at the current position",
      );
      assert(
        movement.during < movement.start && movement.during > movement.end,
        "the card passes through an intermediate position",
      );
    }
    assert.equal(
      await page.locator("#card-actions [data-wait-sentence]").textContent(),
      "Vale waits one turn.",
    );
    const played = await measureHand(page, ".action-beat-cards");
    // Its handlers read the live world, so it is refreshed in place.
    assert.equal(
      played.same,
      true,
      "a committed play keeps a card still in the hand (card-keep.mjs)",
    );
    // A play leaves the raised hand where the player left it (#1922); only
    // the played card's own lift settles.
    assert.equal(
      played.handMoved,
      false,
      `a play keeps the hand up at ${width}`,
    );
    await ready();
    assert.equal((await state()).turn, 1);
    assert.equal(await page.locator(".action-panel").isVisible(), false);
    await load(meeting());
    await selectCard(page, "vale");
    await selectCard(page, "lamp");
    for (const dialog of ["menu", "history"]) {
      await page.locator("#toolbar-menu-button").click();
      await page.locator(`#${dialog}-button`).click();
      await page.keyboard.press("Escape");
      // A thing chosen from Vale's stack is the choice alone (#2256).
      assert.equal(
        await page.locator('#hand [aria-pressed="true"]').count(),
        1,
        `${dialog} preserves the chosen thing`,
      );
      assert.equal(await card("lamp").isVisible(), true);
    }
    await page.keyboard.press("Escape");
    await page.waitForTimeout(250);
    await page.evaluate(async () => {
      const button = document.querySelector('#hand [data-card="vale"]');
      for (let i = 0; i < 6; i++) {
        button.click();
        await new Promise((resolve) => setTimeout(resolve, 30));
      }
    });
    await page.waitForTimeout(250);
    assert.equal(await card("vale").getAttribute("aria-pressed"), "false");
    assert.equal(
      await page.locator(".action-panel").isVisible(),
      false,
      "quick reversals finish with the action row closed",
    );
    // Wait for the existing media-query listeners as well as the new CSS.
    // WebKit can deliver the change after emulateMedia has returned.
    await page.evaluate(() => {
      const query = matchMedia("(prefers-reduced-motion: reduce)");
      window.motionPreferenceReady = query.matches
        ? Promise.resolve()
        : new Promise((resolve) =>
            query.addEventListener("change", resolve, { once: true }),
          );
    });
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.evaluate(() => window.motionPreferenceReady);
    await page.keyboard.press("Escape");
    const remote = meeting();
    remote.items.lamp.holder = "keeper";
    await page.evaluate(
      ({ key, save }) => {
        localStorage.setItem(key, save);
        window.dispatchEvent(
          new StorageEvent("storage", { key, newValue: save }),
        );
      },
      { key, save: encodeSave(remote) },
    );
    await ready();
    // A phone's dialogue covers the hand's foot; tap the exposed card top.
    if (width < 700) await tapCard(await revealCard(page, "keeper"));
    else await selectCard(page, "keeper");
    assert.equal(
      await card("lamp").isVisible(),
      true,
      "a storage update refreshes the holder even at the same world revision",
    );
    await load(meeting());
    assert.equal(await card("lamp").isVisible(), false);
    assert.equal(await card("cloth").isVisible(), false);
    assert.equal(await card("bell").isVisible(), false);
    assert.equal(await page.locator(".card-more").count(), 0);
    await shot("stacks");
    // Only one place is chosen: a second replaces the first and keeps Pip.
    await selectCard(page, "moth");
    await selectCard(page, "station");
    await selectCard(page, "pond");
    assert.deepEqual(await chosen(), ["moth", "pond"]);
    assert.deepEqual(await labels(), ["Invite Pip along"]);
    await selectCard(page, "moth");
    assert.deepEqual(await chosen(), ["pond"]);
    assert.deepEqual(await labels(), ["Travel"]);
    // Tapping the chosen way on again only lowers it (#2247); a lone way on
    // stays in view at the row's right end (#2272).
    await selectCard(page, "pond");
    assert.deepEqual(await chosen(), []);
    assert.deepEqual(await labels(), []);
    assert.equal(await card("pond").isVisible(), true);
    await page.keyboard.press("Escape");
    const beforePersonScroll = await page
      .locator("#hand")
      .evaluate((hand) => hand.scrollLeft);
    if (width < 700) await card("moth").dispatchEvent("click");
    else await selectCard(page, "moth");
    assert.deepEqual(await labels(), ["Talk"]);
    assert.equal(await card("cloth").isVisible(), true);
    const order = await page
      .locator("#hand .card")
      .evaluateAll((cards) => cards.map((c) => c.dataset.card));
    // The current place leads the row (#2272).
    assert.equal(order[0], "station");
    assert(order.indexOf("vale") < order.indexOf("moth"));
    assert.deepEqual(order.slice(-1), ["pond"]);
    assert.equal(order[order.indexOf("moth") + 1], "cloth");
    if (width < 700) {
      await page.waitForTimeout(350);
      const scroll = await page.evaluate((beforeScroll) => {
        const hand = document.querySelector("#hand"),
          frame = hand
            .querySelector('[data-card="moth"]')
            .closest(".card-frame"),
          margin = Math.max(
            16,
            parseFloat(
              getComputedStyle(hand).getPropertyValue("--hand-fade"),
            ) || 0,
          ),
          right = frame.offsetLeft - hand.offsetLeft + frame.offsetWidth;
        return {
          actual: hand.scrollLeft,
          needed: Math.max(
            0,
            Math.min(
              frame.offsetLeft - hand.offsetLeft - margin,
              Math.max(beforeScroll, right - hand.clientWidth + margin),
            ),
          ),
        };
      }, beforePersonScroll);
      assert(
        Math.abs(scroll.actual - scroll.needed) <= 2,
        "opening Pip scrolls only far enough to show Pip",
      );
    }
    await shot("pip-items");
    await selectCard(page, "moth");
    await selectCard(page, "cloth");
    assert.deepEqual(await labels(), ["Ask Pip for Black cloth"]);
    await selectCard(page, "lamp");
    assert.deepEqual(await labels(), ["Trade Lamp for Black cloth"]);
    assert.equal(await page.locator('.card[aria-pressed="true"]').count(), 2);
    assert.deepEqual(await state(), before);
    await shot("trade");
    await page.locator("#card-actions button").click();
    assert.equal(await card("vale").isDisabled(), false);
    // The received cloth is raised in the hand, chosen from Vale's stacks;
    // tapping Vale folds them back to Vale alone (#2256).
    assert.deepEqual(await pressed(), ["cloth"]);
    await page.waitForFunction(() => {
      const hand = document.querySelector("#hand").getBoundingClientRect(),
        card = document
          .querySelector('#hand [data-card="cloth"]')
          .getBoundingClientRect();
      return card.left >= hand.left - 1 && card.right <= hand.right + 1;
    });
    await card("vale").dispatchEvent("click");
    assert.deepEqual(await pressed(), ["vale"]);
    await ready();
    assert.equal((await state()).turn, before.turn + 1);
    assert.equal((await state()).items.cloth.holder, "vale");
    assert.equal((await state()).items.lamp.holder, "moth");
    assert.equal(await card("cloth").isVisible(), true);
    assert.equal(await card("lamp").isVisible(), false);
    await load(meeting());
    if (width === 1440) {
      const transfer = await page.evaluateHandle(() => new DataTransfer());
      await card("vale").dispatchEvent("dragstart", { dataTransfer: transfer });
      assert.equal(
        await page.locator("body").getAttribute("data-hand-expanded"),
        "true",
      );
      await card("vale").dispatchEvent("dragend");
      assert.equal(
        await page.locator("body").getAttribute("data-hand-expanded"),
        "false",
      );
      // Open both stacks before the browser finds the two drag coordinates.
      await selectCard(page, "vale");
      await card("vale").dragTo(card("moth"));
      assert.equal(await card("lamp").isVisible(), true);
      assert.equal(await card("cloth").isVisible(), true);
      assert.equal((await state()).turn, 0);
      await page.keyboard.press("Escape");
    }
    await selectCard(page, "moth");
    await selectCard(page, "vale");
    assert.deepEqual(await labels(), ["Threaten Pip for Black cloth"]);
    assert.equal(
      await page.evaluate(() => document.activeElement.dataset.card),
      "vale",
      "a card tap leaves keyboard focus on that card",
    );
    await page.keyboard.press("Tab");
    assert.equal(
      await page.evaluate(() => document.activeElement.dataset.action),
      "threaten",
    );
    await shot("threat");
    await page.keyboard.press("Enter");
    await ready();
    assert.equal((await state()).standoffs.length, 1);
    await selectCard(page, "vale");
    await selectCard(page, "moth");
    // In battle the selection names the verb: yourself and Pip is Guard,
    // Pip alone is Strike, yourself alone is Brace.
    assert.deepEqual(await labels(), ["Cover"]);
    await page.keyboard.press("Escape");
    await selectCard(page, "moth");
    assert.deepEqual(await labels(), ["Strike"]);
    await page.keyboard.press("Escape");
    await selectCard(page, "vale");
    assert.deepEqual(await labels(), ["Brace"]);
    await shot("standoff");
    await page.getByRole("button", { name: "Brace", exact: true }).click();
    await ready();
    assert.equal((await state()).turn, 2);
    const story = createWorld();
    story.actors.vale.place = "greek-gate";
    story.crossings["pond-greek-harbor"].discovered = true;
    await load(story);
    await selectCard(page, "greek-guard");
    assert((await labels()).includes("Talk"));
    await shot("story");
    await page.getByRole("button", { name: "Talk", exact: true }).click();
    await ready();
    assert.equal((await state()).turn, 1);
    assert(
      knowsFact(await state(), "vale", "greek-hear-decree"),
      "Talk teaches the listener the guard's decree",
    );
    assert.deepEqual(errors, []);
    console.log(
      `Actions, item stacks, trade, standoff, story choices and keyboard passed in ${browserName} at ${width}px.`,
    );
    await page.close();
  }
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
