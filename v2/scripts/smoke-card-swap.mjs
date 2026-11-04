import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { chromium } from "playwright";
import { createServer } from "../card-game/serve.mjs";
import { createWorld, encodeSave } from "../card-game/world.mjs";
import { SWAP_MS } from "../card-game/card-swap.mjs";
import { revealOpening, selectCard } from "./card-browser-helpers.mjs";

// A scene change swaps the hand in beats, not one cut (card-swap.mjs).
// Travel: the cards left behind fall as ghosts, nearest Vale first, as the
// veil comes down; the new place's cards rise after a beat. Put out: the
// lamp's and the attic's faces fade to their dark ones as the light goes
// down. Vale keeps his nodes, the hand drawn is the rules' hand, every
// ghost is released, and reduced motion only fades the hand. Node counts
// over many trips are smoke-card-exit.mjs's.
const output = new URL(
  process.env.CARD_SWAP_OUTPUT || "../../output/card-swap/",
  import.meta.url,
);
await mkdir(output, { recursive: true });
const server = createServer();
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const browser = await chromium.launch({ headless: true });
const meeting = () => {
  const s = createWorld();
  s.actors.keeper.place = "station";
  s.actors.moth.place = "pond";
  return s;
};
const slack = 250;
try {
  for (const [width, height, motion] of [
    [390, 844, "no-preference"],
    [1440, 900, "no-preference"],
    [390, 844, "reduce"],
  ]) {
    const reduced = motion === "reduce",
      tag = `${width}${reduced ? "-reduced" : ""}`,
      page = await browser.newPage({
        viewport: { width, height },
        reducedMotion: motion,
      });
    page.setDefaultTimeout(20000);
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    const key = `cosyworld.reflected-shore.v1.swap-${tag}`;
    await page.addInitScript(
      ({ key, save }) => {
        if (!localStorage.getItem(key)) localStorage.setItem(key, save);
        localStorage.setItem("cosyworld.dialogue.sound", "off");
        localStorage.setItem(
          "cosyworld.room-music",
          JSON.stringify({ enabled: false, volume: 0 }),
        );
        // Every motion the hand starts, from the tap.
        window.swapWatch = { motions: [], ghosts: [] };
        const animate = Element.prototype.animate;
        Element.prototype.animate = function (frames, options) {
          const motion = animate.call(this, frames, options);
          if (this.closest?.(".play-dock"))
            window.swapWatch.motions.push({
              at: performance.now() - (window.swapWatch.tap ?? 0),
              card:
                this.querySelector?.(".card")?.dataset.card ??
                this.dataset?.card,
              ghost: this.classList.contains("beat-ghost"),
              hand: this.id === "hand",
              rise:
                frames?.[0]?.opacity === 0 &&
                this.matches(".hand > .card-frame"),
              delay: options?.delay ?? 0,
              duration: options?.duration,
            });
          return motion;
        };
      },
      { key, save: encodeSave(meeting()) },
    );
    await page.route("**/card-game/text", (r) => r.fulfill({ status: 400 }));
    const ready = async () => {
      for (let i = 0; i < 200; i++) {
        if (
          (await page.locator("#hand").getAttribute("data-cooling")) ===
            "false" &&
          !(await page.locator(".travel.travelling").count())
        )
          return;
        if (await page.locator("#dialogue-advance").isVisible())
          await page.locator("#dialogue-advance").click();
        await page.waitForTimeout(40);
      }
      throw Error("Dialogue kept the hand busy");
    };
    const settled = () =>
      page.waitForFunction(
        () => !document.querySelector(".card-exits > *, .travel.travelling"),
      );
    // Marks Vale's frame and button, and starts the clock at the tap.
    const tap = (button) =>
      page.evaluate((selector) => {
        const vale = document.querySelector('#hand [data-card="vale"]');
        vale.swapMark = vale.parentElement.swapMark = "kept";
        const watch = new MutationObserver((records) => {
          for (const r of records)
            for (const g of r.addedNodes)
              if (g.classList?.contains("beat-ghost"))
                window.swapWatch.ghosts.push(g.querySelector(".card"));
        });
        watch.observe(document.querySelector(".play-dock"), {
          childList: true,
          subtree: true,
        });
        Object.assign(window.swapWatch, { motions: [], ghosts: [], watch });
        window.swapWatch.tap = performance.now();
        document.querySelector(selector).click();
      }, button);
    // A few frames of the swap, as fast as the page shoots them.
    const strip = async (name) => {
      for (const ms of [80, 300, 600, 1000, 1500]) {
        const since = await page.evaluate(
          () => performance.now() - window.swapWatch.tap,
        );
        if (since < ms) await page.waitForTimeout(ms - since);
        await page.screenshot({
          path: new URL(`${name}-${tag}-${ms}ms.png`, output).pathname,
        });
      }
    };
    // What the swap did; the watch lets go of the ghosts it saw.
    const watched = () =>
      page.evaluate(() => {
        const { motions, ghosts, watch } = window.swapWatch;
        watch.disconnect();
        Object.assign(window.swapWatch, { motions: [], ghosts: [] });
        const vale = document.querySelector('#hand [data-card="vale"]');
        return {
          motions,
          ghosts: ghosts.map((c) => c?.dataset.card),
          released: ghosts.every((c) => !c?.isConnected),
          vale: vale.swapMark,
          valeFrame: vale.parentElement.swapMark,
        };
      });
    // The hand drawn is the rules' hand: every card they make available.
    const rulesHand = () =>
      page.evaluate(async (key) => {
        const { decodeSave } = await import("/card-game/world.mjs");
        const { availableCards } = await import("/card-game/cards.mjs");
        const world = decodeSave(localStorage.getItem(key));
        const drawn = [...document.querySelectorAll("#hand .card[data-card]")];
        return [
          drawn.map((c) => c.dataset.card).sort(),
          [...availableCards(world)].sort(),
        ];
      }, key);
    await page.goto(
      `http://127.0.0.1:${server.address().port}/?table=swap-${tag}`,
    );
    await ready();
    // The page deals its hand: each card rises, 70 ms apart.
    const dealt = await page.evaluate(() =>
      window.swapWatch.motions.filter((m) => m.rise).map((m) => m.delay),
    );
    if (reduced) assert.deepEqual(dealt, [], "reduced motion just shows it");
    else
      assert(
        dealt.length >= 3 && dealt.every((d, i) => d === Math.min(i * 70, 350)),
        `the page deals its hand: ${dealt}`,
      );
    const go = async (place, name) => {
      await selectCard(page, place);
      await tap("#card-actions button");
      await strip(name);
      await settled();
      await ready();
      const trip = await watched();
      const [drawn, rules] = await rulesHand();
      assert.deepEqual(drawn, rules, "the hand is the rules' hand");
      assert.equal(trip.vale, "kept", "Vale's card keeps its node");
      assert.equal(trip.valeFrame, "kept", "Vale's frame keeps its node");
      assert(trip.released, "every ghost is released");
      if (reduced) {
        assert.deepEqual(trip.ghosts, [], "reduced motion shows no exits");
        assert(
          trip.motions.some((m) => m.hand && m.duration <= 250),
          "reduced motion fades the hand",
        );
      }
      return trip;
    };
    // Leaving the station: each card left behind falls, nearest Vale first,
    // 50 ms apart, from the tap; one folded under the new place falls as
    // the hand redraws.
    const away = await go("pond", "travel-away");
    if (!reduced) {
      for (const id of ["keeper", "lamp", "bell", "station"])
        assert(away.ghosts.includes(id), `${id} falls: ${away.ghosts}`);
      assert(!away.ghosts.includes("vale"), "Vale goes along");
      const atTap = away.motions.filter((m) => m.ghost && m.at < 100);
      assert.deepEqual(
        atTap.map((m) => m.card),
        ["keeper", "lamp", "bell"],
        "nearest first",
      );
      atTap.forEach((m, i) => assert.equal(m.delay, i * 50, "50 ms apart"));
    }
    // Coming back: the station's cards rise after the falls and a beat, and
    // the whole swap ends in time.
    const back = await go("station", "travel-back");
    if (!reduced) {
      const falls = back.motions.filter((m) => m.ghost),
        lastFall = Math.max(0, ...falls.map((m) => m.at + m.delay + 360)),
        rises = back.motions.filter((m) => m.rise);
      for (const id of ["moth", "keeper"])
        assert(
          rises.some((m) => m.card === id),
          `${id} rises: ${JSON.stringify(back.motions)}`,
        );
      for (const rise of rises) {
        const start = rise.at + rise.delay;
        assert(start >= Math.min(lastFall, SWAP_MS - 530) - slack, "after");
        assert(start + rise.duration <= SWAP_MS + slack, `in time: ${start}`);
      }
    }
    // Put out in a new world's attic: the lamp and the attic turn to their
    // dark faces as the light goes down, keeping their nodes, and the pond
    // is dealt face down behind the attic.
    await page.evaluate(() => document.querySelector("#confirm-reset").click());
    await ready();
    await revealOpening(page);
    await page.waitForTimeout(600);
    await page.evaluate(() => {
      document.querySelector('#hand [data-card="lamp"]').swapMark = "kept";
    });
    await tap("#card-actions .card-primary");
    await strip("put-out");
    await settled();
    const douse = await watched();
    const lamp = await page.evaluate(() => {
      const lamp = document.querySelector('#hand [data-card="lamp"]');
      return [lamp.swapMark, lamp.dataset.lit];
    });
    assert.deepEqual(lamp, ["kept", "false"], "the lamp turns in place");
    assert.equal(douse.vale, "kept");
    assert.equal(douse.valeFrame, "kept");
    const pond = await page.evaluate(() => {
      const card = document.querySelector('#hand [data-card="pond"]');
      return [card.parentElement.hidden, card.dataset.unrevealed];
    });
    assert.deepEqual(pond, [true, "true"], "the pond is dealt face down");
    if (reduced) assert.deepEqual(douse.ghosts, []);
    else {
      assert.deepEqual(douse.ghosts.sort(), ["attic", "lamp"]);
      assert(douse.released, "the old faces are released");
      for (const fade of douse.motions.filter((m) => m.ghost))
        assert(fade.at + fade.delay + fade.duration <= SWAP_MS + slack);
    }
    await ready();
    const [hand, offered] = await rulesHand();
    assert.deepEqual(hand, offered, "the hand is the rules' hand");
    assert.deepEqual(errors, []);
    console.log(
      `Travel and Put out swapped the hand ${reduced ? "with a quick fade" : "in beats (exits, a beat, entries)"} at ${tag}; Vale kept his nodes.`,
    );
    await page.close();
  }
} finally {
  await browser.close();
  server.close();
}
