import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { chromium } from "playwright";
import { createServer } from "../card-game/serve.mjs";
import { LOGOS, transparentLogo } from "../card-game/title-logo.mjs";
import { openSettings, closeSettings } from "./card-browser-helpers.mjs";
import { finishAcknowledgement } from "./title-music-alone.mjs";
const server = createServer();
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({
  executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE,
});
const shots = process.env.LOGO_GLOW_SHOTS || "output/logo-glow";
if (shots) await mkdir(shots, { recursive: true });
async function checkImage(page, selector, source, width) {
  const result = await page.$eval(selector, async (image) => {
    await image.decode();
    const { tintByTier } = await import("/card-game/world-level.mjs");
    const { tiers } = await import("/card-game/level-tiers.mjs");
    // Boot owns the world tier. Exercise its painter only after boot, rather
    // than racing app.mjs with a manually injected title and tier attribute.
    tintByTier(document.documentElement, tiers[2]);
    const style = getComputedStyle(image);
    const shadow = style.boxShadow,
      filter = style.filter;
    const canvas = document.createElement("canvas");
    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;
    const ctx = canvas.getContext("2d");
    ctx.drawImage(image, 0, 0);
    const corner = ctx.getImageData(0, 0, 1, 1).data[3];
    tintByTier(document.documentElement, tiers[0]);
    const common = getComputedStyle(image).filter;
    tintByTier(document.documentElement, tiers[2]);
    return { shadow, filter, corner, common, src: image.src };
  });
  assert.equal(result.shadow, "none");
  assert.match(result.filter, /drop-shadow/);
  assert.equal(result.corner, 0);
  assert.equal(result.common, "none");
  assert.ok(
    result.src.includes(
      `/optimized/${width <= 640 ? "phone" : "stage"}/png/title/transparent/`,
    ),
  );
  assert.ok(
    result.src.includes(source.split("/").at(-1).replace(".png", ".webp")),
  );
}
try {
  for (const width of [1440, 390]) {
    for (const [index, logo] of LOGOS.entries()) {
      const page = await browser.newPage({
        viewport: { width, height: 900 },
        reducedMotion: "reduce",
      });
      await page.addInitScript((index) => {
        localStorage.setItem(
          "cosyworld.title-logo",
          JSON.stringify({ worlds: { "table:glow": index } }),
        );
        localStorage.setItem("cosyworld.dialogue.sound", "off");
      }, index);
      await page.goto(`${origin}/?table=glow`);
      await page.locator("#hand .card").first().waitFor({ state: "attached" });
      await page.evaluate(async (index) => {
        const { playTitleIntro } = await import("/card-game/title-intro.mjs");
        const { LOGOS } = await import("/card-game/title-logo.mjs");
        void playTitleIntro({ logo: LOGOS[index] });
      }, index);
      await page.locator(".title-ack").waitFor();
      await finishAcknowledgement(page);
      await page.keyboard.press("Enter");
      await page.locator('.title-intro[data-phase="card"] > img').waitFor();
      await checkImage(
        page,
        ".title-intro > img",
        transparentLogo(logo.src),
        width,
      );
      if (shots)
        await page.screenshot({ path: `${shots}/logo-${index}-${width}.png` });
      // Interrupt the intro, then repeatedly open and dismiss real Settings.
      await page.keyboard.press("Escape");
      await page.locator(".title-intro").waitFor({ state: "detached" });
      for (let repeat = 0; repeat < 2; repeat++) {
        await openSettings(page);
        await checkImage(
          page,
          ".settings-logo",
          transparentLogo(logo.src),
          width,
        );
        assert.equal(
          await page.locator(".brand strong").getAttribute("data-logo"),
          logo.src,
        );
        await closeSettings(page);
      }
      await page.close();
    }
  }
} finally {
  await browser.close();
  server.close();
}
console.log(
  "Logo glow: actual intro/settings, responsive alpha variants, common reset and repeated dismissal passed at desktop and phone widths.",
);
