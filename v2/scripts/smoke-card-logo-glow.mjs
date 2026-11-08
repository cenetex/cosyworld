import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { chromium } from "playwright";
import { createServer } from "../card-game/serve.mjs";
import { LOGOS, transparentLogo } from "../card-game/title-logo.mjs";
const server = createServer();
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({
  executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE,
});
const shots = process.env.LOGO_GLOW_SHOTS || "output/logo-glow";
if (shots) await mkdir(shots, { recursive: true });
try {
  for (const width of [1440, 390]) {
    const page = await browser.newPage({ viewport: { width, height: 900 } });
    await page.goto(`${origin}/?table=glow`);
    for (const [index, logo] of LOGOS.entries()) {
      await page.evaluate(
        async ({ source }) => {
          document.querySelector(".title-intro")?.remove();
          const layer = document.createElement("div");
          layer.className = "title-intro";
          const image = new Image();
          image.src = `/card-game/${source}`;
          image.style.opacity = "1";
          layer.append(image);
          document.body.append(layer);
          await image.decode();
          document.documentElement.dataset.worldTier = "rare";
          document.documentElement.style.setProperty("--world-tier", "#7bd6ed");
        },
        { source: transparentLogo(logo.src) },
      );
      const result = await page.$eval(".title-intro > img", (image) => {
        const style = getComputedStyle(image);
        const canvas = document.createElement("canvas");
        canvas.width = image.naturalWidth;
        canvas.height = image.naturalHeight;
        const ctx = canvas.getContext("2d");
        ctx.drawImage(image, 0, 0);
        return {
          shadow: style.boxShadow,
          filter: style.filter,
          corner: ctx.getImageData(0, 0, 1, 1).data[3],
        };
      });
      assert.equal(result.shadow, "none");
      assert.match(result.filter, /drop-shadow/);
      assert.equal(result.corner, 0);
      if (shots)
        await page.screenshot({ path: `${shots}/logo-${index}-${width}.png` });
      await page.evaluate(
        () => delete document.documentElement.dataset.worldTier,
      );
      assert.equal(
        await page.$eval(
          ".title-intro > img",
          (image) => getComputedStyle(image).filter,
        ),
        "none",
      );
    }
    await page.close();
  }
} finally {
  await browser.close();
  server.close();
}
console.log(
  "Logo glow: transparent masters, no rectangular shadow, desktop and phone passed.",
);
