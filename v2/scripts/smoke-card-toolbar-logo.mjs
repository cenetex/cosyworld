import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { chromium } from "playwright";
import { createServer } from "../card-game/serve.mjs";
import { LOGO_KEY, LOGOS, toolbarLogo } from "../card-game/title-logo.mjs";

// The toolbar shows the logo the title showed, for every logo: the
// wordmarks whole, the wide artworks by their lettering. A reload keeps it,
// and at phone widths it never overlaps the world name or the buttons.
// `TOOLBAR_LOGO_SHOTS=<dir>` saves a toolbar screenshot per logo and size.
const server = createServer();
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE,
});
const shots = process.env.TOOLBAR_LOGO_SHOTS;
if (shots) await mkdir(shots, { recursive: true });
const sizes = [
  [1440, 900],
  [390, 844],
  [375, 667],
];

async function toolbar(page) {
  await page.waitForFunction(() => {
    const image = document.querySelector(".brand strong img.brand-logo");
    return document.body.inert === false && image?.complete;
  });
  return page.evaluate(() => {
    const box = (node) => {
      if (!node || getComputedStyle(node).display === "none") return null;
      const { left, right, top, bottom, width } = node.getBoundingClientRect();
      return width ? { left, right, top, bottom } : null;
    };
    const mark = document.querySelector(".brand strong");
    const image = mark.querySelector("img");
    return {
      logo: mark.dataset.logo,
      alt: image.alt,
      src: image.currentSrc,
      loaded: image.naturalWidth > 0,
      image: box(image),
      name: box(document.querySelector(".brand span")),
      label: document.querySelector(".brand span").textContent,
      actions: [...document.querySelectorAll(".top-actions > *")]
        .map(box)
        .filter(Boolean),
      width: innerWidth,
      scroll: document.documentElement.scrollWidth,
    };
  });
}
const apart = (a, b) =>
  a.right <= b.left ||
  b.right <= a.left ||
  a.bottom <= b.top ||
  b.bottom <= a.top;

try {
  for (const [index, logo] of LOGOS.entries()) {
    const shown = toolbarLogo(logo);
    for (const [width, height] of sizes) {
      const context = await browser.newContext({
        viewport: { width, height },
        isMobile: width < 400,
        deviceScaleFactor: 2,
      });
      const page = await context.newPage();
      page.setDefaultTimeout(15000);
      const errors = [];
      page.on("pageerror", (error) => errors.push(error.message));
      const table = `logo-${index}-${width}`;
      await page.addInitScript(
        ({ key, memory }) => {
          if (!localStorage.getItem(key)) localStorage.setItem(key, memory);
        },
        {
          key: LOGO_KEY,
          memory: JSON.stringify({
            last: index,
            worlds: { [`table:${table}`]: index },
          }),
        },
      );
      await page.goto(`${origin}/?table=${table}`);
      const first = await toolbar(page);
      assert.equal(first.logo, logo.src, `${table} shows its world's logo`);
      assert.equal(first.alt, logo.name, table);
      assert.ok(first.loaded, `${table} loads ${first.src}`);
      assert.match(first.src, new RegExp(shown.src.split("/").at(-1)), table);
      // Lettering reads: the logo is at least 30 px tall on every width.
      assert.ok(first.image.bottom - first.image.top >= 30, table);
      assert.ok(first.image.left >= 0 && first.image.right <= width, table);
      // A covered world's "…" never stands beside the logo (Safari showed it).
      if (first.name) assert.notEqual(first.label, "…", `${table} shows "…"`);
      for (const other of [first.name, ...first.actions].filter(Boolean))
        assert.ok(apart(first.image, other), `${table} logo overlaps`);
      if (first.name)
        for (const action of first.actions)
          assert.ok(apart(first.name, action), `${table} name overlaps`);
      assert.ok(first.scroll <= width, `${table} scrolls sideways`);
      if (shots) {
        const top = await page.locator(".topbar").boundingBox();
        const name = shown.src
          .split("/")
          .at(-1)
          .replace(/\.webp$/, "");
        await page.screenshot({
          path: `${shots.replace(/\/$/, "")}/${index}-${name}-${width}x${height}.png`,
          clip: { x: 0, y: 0, width, height: Math.ceil(top.height) },
        });
      }
      await page.reload();
      const again = await toolbar(page);
      assert.equal(again.logo, logo.src, `${table} keeps its logo on reload`);
      assert.deepEqual(errors, [], table);
      await context.close();
    }
  }

  // The title and the toolbar show the same pick for a new world.
  for (const [width, height] of [sizes[0], sizes[2]]) {
    const context = await browser.newContext({ viewport: { width, height } });
    const page = await context.newPage();
    await page.goto(`${origin}/?intro=1`);
    const title = await page.locator(".title-intro").getAttribute("data-title");
    const mark = await page.locator(".brand strong").getAttribute("data-logo");
    assert.equal(mark, title, `toolbar shows the title's logo at ${width}`);
    await context.close();
  }
  console.log(
    `Toolbar logo smoke passed: ${LOGOS.length} logos at ${sizes.map(([w, h]) => `${w}x${h}`).join(", ")}.`,
  );
} finally {
  await browser.close();
  server.close();
}
