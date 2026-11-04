// Under reduced motion nothing moves, but things may fade (style.css): no
// keyframe motion runs, and every transition left is a fade of opacity of
// at most 300 ms. Scans every element of the table, Settings and the loss
// screen's veil at desktop and phone widths.
import assert from "node:assert/strict";
import { chromium } from "playwright";
import { createServer } from "../card-game/serve.mjs";
import { createWorld, encodeSave } from "../card-game/world.mjs";

const server = createServer();
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ headless: true });
// Every element whose transition moves something or fades for longer.
const scan = () =>
  [...document.querySelectorAll("*")].flatMap((el) => {
    const look = getComputedStyle(el),
      names = look.transitionProperty.split(", "),
      times = look.transitionDuration.split(", ").map(parseFloat);
    const wrong = names.flatMap((name, i) => {
      const s = times[i % times.length];
      return s > 0 && (name !== "opacity" || s > 0.3) ? [`${name} ${s}s`] : [];
    });
    if (look.animationName !== "none") wrong.push(look.animationName);
    const id = el.id || el.className?.baseVal || el.className;
    return wrong.length ? [`${el.tagName}#${id}: ${wrong}`] : [];
  });
try {
  for (const [width, height] of [
    [1440, 900],
    [390, 844],
  ]) {
    const page = await browser.newPage({
      viewport: { width, height },
      reducedMotion: "reduce",
    });
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    const save = createWorld();
    save.actors.moth.place = save.actors.keeper.place = "station";
    await page.addInitScript(
      (save) => localStorage.setItem("cosyworld.reflected-shore.v1.rf", save),
      encodeSave(save),
    );
    await page.goto(`${origin}/?table=rf`);
    await page.locator("#hand .card").first().waitFor();
    assert.deepEqual(await page.evaluate(scan), [], `table at ${width}`);
    await page.locator("#toolbar-menu-button").click();
    await page.locator("#menu-button").click();
    await page.locator("#settings-hand .card").first().waitFor();
    assert.deepEqual(await page.evaluate(scan), [], `settings at ${width}`);
    // The loss screen's black dips in 300 ms rather than cutting.
    const faint = await page.evaluate(async () => {
      const { lossTimes } = await import("/card-game/combat-beats.mjs");
      return lossTimes({ reduced: true }).faint;
    });
    assert.equal(faint, 300);
    assert.deepEqual(errors, []);
    await page.close();
    console.log(`Reduced motion only fades, within 300 ms, at ${width}px.`);
  }
} finally {
  await browser.close();
  server.close();
}
