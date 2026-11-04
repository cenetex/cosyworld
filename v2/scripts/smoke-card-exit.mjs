import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { chromium } from "playwright";
import { createServer } from "../card-game/serve.mjs";
import { createWorld, encodeSave } from "../card-game/world.mjs";
import { selectCard } from "./card-browser-helpers.mjs";

// Cards leaving the hand fall as inert ghosts from where they lay while the
// hand redraws at once (card-exit.mjs). A reload, another tab's world and a
// new game show none, reduced motion shows none, and every ghost is
// released: many plays leave the page holding no more nodes.
const output = new URL(
  process.env.CARD_EXIT_OUTPUT || "../../output/card-exit/",
  import.meta.url,
);
await mkdir(output, { recursive: true });
const server = createServer();
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const browser = await chromium.launch({ headless: true });
const meeting = () => {
  const s = createWorld();
  s.actors.moth.place = s.actors.keeper.place = "station";
  return s;
};
try {
  for (const [width, height] of [
    [390, 844],
    [1440, 900],
  ]) {
    const page = await browser.newPage({ viewport: { width, height } });
    page.setDefaultTimeout(20000);
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    const key = `cosyworld.reflected-shore.v1.exit-${width}`;
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
    await page.route("**/card-game/text", (route) =>
      route.fulfill({
        status: 400,
        contentType: "application/json",
        body: "{}",
      }),
    );
    const ready = async () => {
      for (let i = 0; i < 200; i++) {
        if (
          (await page.locator("#hand").getAttribute("data-cooling")) === "false"
        )
          return;
        if (await page.locator("#dialogue-advance").isVisible())
          await page.locator("#dialogue-advance").click();
        await page.waitForTimeout(40);
      }
      throw Error("Dialogue kept the hand busy");
    };
    // Every ghost added from now on, as it was when placed.
    const watch = () =>
      page.evaluate(() => {
        window.exitWatch?.observer.disconnect();
        const seen = [];
        const observer = new MutationObserver((records) => {
          for (const ghost of records.flatMap((r) => [...r.addedNodes]))
            if (ghost.classList?.contains("beat-ghost"))
              seen.push({
                card: ghost.querySelector(".card").dataset.card,
                box: ghost.getBoundingClientRect().toJSON(),
                looks: [ghost.inert, ghost.getAttribute("aria-hidden")],
              });
        });
        const hand = document.querySelector("#hand");
        observer.observe(hand.parentElement, {
          childList: true,
          subtree: true,
        });
        // Each card's box at the tap (a change of place lets cards fall
        // from there) and as the hand redraws.
        const boxes = () =>
          Object.fromEntries(
            [...hand.querySelectorAll(".card[data-card]")].map((c) => [
              c.dataset.card,
              c.parentElement.getBoundingClientRect(),
            ]),
          );
        window.exitWatch = { observer, seen, boxes, shown: {}, redrawn: {} };
        hand.replaceChildren = function (...frames) {
          window.exitWatch.redrawn = boxes();
          Element.prototype.replaceChildren.apply(hand, frames);
        };
      });
    const seen = () => page.evaluate(() => window.exitWatch.seen);
    const settled = () =>
      page.waitForFunction(
        () => !document.querySelector(".card-exits > *, .travel.travelling"),
      );
    const travel = async (place) => {
      await selectCard(page, place);
      await page.evaluate(() => {
        if (window.exitWatch) window.exitWatch.shown = window.exitWatch.boxes();
      });
      await page.locator("#card-actions button").click();
    };
    await page.goto(
      `http://127.0.0.1:${server.address().port}/?table=exit-${width}`,
    );
    await ready();
    assert.equal(await page.locator(".card-exits > *").count(), 0);
    // Walking away from the station leaves Pip, the keeper and the station
    // behind: each falls from where it lay, inert, a moment apart.
    await watch();
    // Vale goes along and keeps his node (card-keep.mjs).
    await page.evaluate(() => {
      document.querySelector('#hand [data-card="vale"]').exitMark = "kept";
    });
    await travel("pond");
    await page.waitForFunction(() => window.exitWatch.seen.length);
    const falling = await page.evaluate(() =>
      [...document.querySelectorAll(".card-exits > .beat-ghost")].map((g) => {
        const motion = g.getAnimations()[0];
        const { delay, duration } = motion.effect.getTiming();
        // Each held a little way down its fall for the frame.
        motion.pause();
        motion.currentTime = delay + 180;
        (window.exitMotions ||= []).push(motion);
        return [delay, duration, getComputedStyle(g).pointerEvents];
      }),
    );
    await page.screenshot({
      path: new URL(`falling-${width}.png`, output).pathname,
    });
    // The station folds under the pond as the hand redraws under the veil.
    await page.waitForFunction(() =>
      window.exitWatch.seen.some((g) => g.card === "station"),
    );
    const gone = (await seen()).map((g) => g.card);
    for (const card of ["moth", "keeper", "station"])
      assert(gone.includes(card), `${card} falls: ${gone}`);
    assert(!gone.includes("vale"), "Vale goes along");
    // A change of place lets them go 50 ms apart (card-swap.mjs).
    falling.forEach((looks, i) =>
      assert.deepEqual(looks, [i * 50, 360, "none"]),
    );
    const { shown, redrawn } = await page.evaluate(() => window.exitWatch);
    for (const ghost of await seen()) {
      assert.deepEqual(ghost.looks, [true, "true"]);
      const at = (box) =>
        Math.abs(ghost.box.left - box?.left) < 4 &&
        Math.abs(ghost.box.top - box?.top) < 4;
      assert(at(shown[ghost.card]) || at(redrawn[ghost.card]), ghost.card);
    }
    await page.evaluate(() => window.exitMotions.forEach((m) => m.play()));
    await settled();
    await ready();
    assert.equal(
      await page.evaluate(
        () => document.querySelector('#hand [data-card="vale"]').exitMark,
      ),
      "kept",
      "Vale keeps his node",
    );
    // Ghosts are released: many plays keep no more nodes than a few.
    const cdp = await page.context().newCDPSession(page);
    await cdp.send("Performance.enable");
    const nodes = async () => {
      await cdp.send("HeapProfiler.collectGarbage");
      const { metrics } = await cdp.send("Performance.getMetrics");
      return metrics.find((metric) => metric.name === "Nodes").value;
    };
    const trip = async () => {
      for (const place of ["pond", "station"]) {
        await travel(place);
        await settled();
        await ready();
      }
    };
    await trip();
    const start = await nodes();
    for (let i = 0; i < 5; i++) await trip();
    const grown = (await nodes()) - start;
    await cdp.detach();
    assert(grown < 60, `Falling ghosts are released: ${grown} nodes kept`);
    // Another tab's world in this one's place shows no exit.
    await watch();
    const away = meeting();
    away.actors.moth.place = away.actors.keeper.place = "pond";
    await page.evaluate(
      ({ key, save }) => {
        localStorage.setItem(key, save);
        window.dispatchEvent(
          new StorageEvent("storage", { key, newValue: save }),
        );
      },
      { key, save: encodeSave(away) },
    );
    await ready();
    assert.deepEqual(await seen(), [], "another tab's world shows no exit");
    // A reload deals the hand already there.
    await page.reload();
    await ready();
    assert.equal(await page.locator(".card-exits > *").count(), 0);
    // Reduced motion lets the leaving cards just go.
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.evaluate(() => window.motionPreferenceReady);
    await watch();
    await travel("pond");
    await ready();
    await travel("station");
    await ready();
    assert.deepEqual(await seen(), [], "reduced motion shows no exit");
    await page.emulateMedia({ reducedMotion: "no-preference" });
    // A new game opens on a hand already dealt.
    await watch();
    await page.evaluate(() => document.querySelector("#confirm-reset").click());
    assert.deepEqual(await seen(), [], "a new game shows no exit");
    assert.deepEqual(errors, []);
    console.log(
      `Card exits fell from their places, inert and staggered, and were released at ${width}px; reload, another tab, a new game and reduced motion showed none.`,
    );
    await page.close();
  }
} finally {
  await browser.close();
  server.close();
}
