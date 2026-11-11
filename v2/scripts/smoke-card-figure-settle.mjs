// A play made while figures are still entering (just after a travel), here
// another tab's, cancels that travel's motions (cancelTravel). The cast
// settles instead of cutting (figure-settle.mjs): no figure jumps in how
// seen it is from one frame to the next, and nothing is left behind once it
// settles. Motion is slowed fiftyfold so the play lands mid-entrance.
// Desktop and phone; reduced motion has no entrance to cancel.
import assert from "node:assert/strict";
import { chromium } from "playwright";
import { createServer } from "../card-game/serve.mjs";
import { createWorld, encodeSave } from "../card-game/world.mjs";
import { selectCard, readyActionButton } from "./card-browser-helpers.mjs";

const server = createServer();
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({
  executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE, headless: true });
try {
  for (const [width, height, motion] of [
    [1440, 900, "no-preference"],
    [390, 844, "no-preference"],
  ]) {
    const page = await browser.newPage({
      viewport: { width, height },
      reducedMotion: motion,
    });
    page.setDefaultTimeout(45000);
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    const table = `settle-${width}-${motion}`,
      world = createWorld();
    world.actors.moth.place = world.actors.keeper.place = "station";
    world.actors.vale.place = "pond";
    await page.addInitScript(
      ({ key, save, seen }) => {
        if (!localStorage.getItem(key)) localStorage.setItem(key, save);
        // Everyone already met, so they stand on stage face up.
        localStorage.setItem(`${key}.seen`, JSON.stringify(seen));
        localStorage.setItem("cosyworld.dialogue.sound", "off");
        localStorage.setItem(
          "cosyworld.room-music",
          JSON.stringify({ enabled: false }),
        );
      },
      {
        key: `cosyworld.reflected-shore.v1.${table}`,
        save: encodeSave(world),
        seen: ["vale", "moth", "keeper", "station", "pond", "lamp", "bell"],
      },
    );
    await page.route("**/card-game/text", (r) => r.fulfill({ status: 400 }));
    await page.goto(`${origin}/?table=${table}`);
    await page.locator("#hand .card").first().waitFor();
    const cdp = await page.context().newCDPSession(page);
    await cdp.send("Animation.enable");
    await cdp.send("Animation.setPlaybackRate", { playbackRate: 0.02 });
    // Walk to the station, where Pip and the keeper come on stage.
    await selectCard(page, "station");
    await readyActionButton(page, "move").click();
    await page.waitForFunction(
      () =>
        !document.querySelector("#travel.travelling") &&
        document.querySelectorAll("#cast > .portrait").length > 1,
    );
    // Vale is still walking on when another tab's play comes.
    await page.waitForFunction(() => {
      const body = document.querySelector(
        '#cast > [data-avatar="vale"] .portrait-body',
      );
      const shown = body && Number(getComputedStyle(body).opacity);
      return shown > 0.1 && shown < 0.6;
    });
    // How seen each figure is, every frame, from the play on.
    await page.evaluate(() => {
      window.seen = [];
      const look = () => {
        window.seen.push(
          Object.fromEntries(
            [...document.querySelectorAll("#cast > .portrait")].map((f) => {
              const body = f.querySelector(".portrait-body");
              const shown =
                getComputedStyle(f).visibility === "hidden"
                  ? 0
                  : getComputedStyle(f).opacity *
                    getComputedStyle(body).opacity;
              return [f.dataset.avatar, shown];
            }),
          ),
        );
        // Until the cast is still again.
        const moving = [...document.querySelectorAll("#cast *")].some(
          (el) => el.getAnimations().length,
        );
        if (window.seen.length < 30 || (moving && window.seen.length < 600))
          requestAnimationFrame(look);
        else window.seenDone = true;
      };
      requestAnimationFrame(look);
    });
    // Another tab waits a moment: plays here are held behind the entrance
    // (prepareStage), so another tab's play is how one lands mid-entrance.
    await page.evaluate(async (key) => {
      const rules = await import("/card-game/world.mjs");
      const now = rules.decodeSave(localStorage.getItem(key));
      const wait = rules.legalActions(now).find((a) => a.kind === "wait");
      const next = rules.encodeSave(rules.play(now, wait).state);
      localStorage.setItem(key, next);
      window.dispatchEvent(
        new StorageEvent("storage", { key, newValue: next }),
      );
    }, `cosyworld.reflected-shore.v1.${table}`);
    // The settle plays at a quarter speed, so every frame of it is seen.
    await cdp.send("Animation.setPlaybackRate", { playbackRate: 0.25 });
    await page.waitForFunction(() => window.seenDone);
    const jumps = await page.evaluate(() =>
      window.seen.slice(1).flatMap((now, i) =>
        Object.entries(now).flatMap(([id, shown]) => {
          const was = window.seen[i][id];
          return was !== undefined && Math.abs(shown - was) > 0.35
            ? [`${id} ${was.toFixed(2)}→${shown.toFixed(2)}`]
            : [];
        }),
      ),
    );
    assert.deepEqual(jumps, [], `figures settle at ${width} (${motion})`);
    await cdp.send("Animation.setPlaybackRate", { playbackRate: 1 });
    await page.waitForFunction(
      () =>
        !document.querySelector(
          "#cast [data-settling], #cast .entering, .beat-ghost",
        ),
    );
    assert.deepEqual(errors, []);
    await cdp.detach();
    await page.close();
    console.log(
      `A play mid-entrance settled the cast at ${width}px (${motion}).`,
    );
  }
} finally {
  await browser.close();
  server.close();
}
