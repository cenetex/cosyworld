import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { chromium } from "playwright";
import { createServer } from "../card-game/serve.mjs";
import { startNewGame } from "./card-browser-helpers.mjs";
import { TITLES } from "../card-game/title-intro.mjs";
import { checkTitleMusicAlone } from "./title-music-alone.mjs";

// A new world opens with a silent Lonely Forest title over the booting table.
// The first tap or key starts the title song, lifts the logo and shows Wake;
// Wake fades the song and enters Vale's lit attic. Escape skips straight in.
// A reload or a later visit goes straight to the table; New game plays it again.
const server = createServer();
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ headless: true });
const output = new URL(
  process.env.TITLE_INTRO_SHOTS
    ? `file://${process.env.TITLE_INTRO_SHOTS.replace(/\/?$/, "/")}`
    : "../../output/title-intro/",
  import.meta.url,
);
await mkdir(output, { recursive: true });
const shots = [];
const shot = async (page, name) => {
  const path = new URL(`${name}.png`, output).pathname;
  await page.screenshot({ path });
  shots.push(path);
};

async function open(context) {
  const page = await context.newPage();
  page.setDefaultTimeout(15000);
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("**/card-game/text", (route) => {
    const input = route.request().postDataJSON();
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        revision: input.revision,
        model: "title-fixture",
        entries: input.entities.map(({ id }) => ({ id, text: "Awake." })),
      }),
    });
  });
  page.errors = errors;
  return page;
}
// Every media play is recorded; the title song's element is kept.
async function newContext(width, height, { reducedMotion, music = true } = {}) {
  const context = await browser.newContext({
    viewport: { width, height },
    reducedMotion: reducedMotion || "no-preference",
  });
  await context.addInitScript((music) => {
    if (!sessionStorage.getItem("seeded")) {
      sessionStorage.setItem("seeded", "1");
      localStorage.setItem("cosyworld.dialogue.sound", "off");
      localStorage.setItem(
        "cosyworld.room-music",
        JSON.stringify({ enabled: music, volume: 0.3 }),
      );
    }
    window.__plays = [];
    const play = HTMLMediaElement.prototype.play;
    HTMLMediaElement.prototype.play = function () {
      window.__plays.push(this.id || this.src);
      if (/title-attic-lamp/.test(this.src)) window.__titleSong = this;
      return play.call(this);
    };
  }, music);
  return context;
}
const titlePlays = (page) =>
  page.evaluate(
    () => window.__plays.filter((p) => /title-attic-lamp/.test(p)).length,
  );
const titlePhase = (page) =>
  page.waitForSelector('.title-intro[data-phase="title"]');
const gone = (page, timeout) =>
  page.waitForSelector(".title-intro", { state: "detached", timeout });
const wakeShown = async (page) => {
  await page.waitForSelector(".title-wake");
  await page.waitForFunction(
    () =>
      document.activeElement?.classList.contains("title-wake") &&
      document.activeElement.textContent === "Wake Vale",
  );
};

try {
  for (const [width, height] of [
    [1440, 900],
    [390, 844],
  ]) {
    const desktop = width > 640;
    const context = await newContext(width, height);
    // Automated browsers skip the title on the bare address.
    const bare = await open(context);
    await bare.goto(`${origin}/`);
    await bare.waitForSelector("#hand .card");
    assert.equal(await bare.locator(".title-intro").count(), 0);
    await bare.close();
    await context.close();

    const fresh = await newContext(width, height);
    const page = await open(fresh);
    await page.goto(`${origin}/?intro=1`);
    await titlePhase(page);
    const title = await page.locator(".title-intro").getAttribute("data-title");
    assert.ok(TITLES.includes(title), title);
    await page.waitForTimeout(1100);
    const box = await page.locator(".title-intro img").boundingBox();
    assert.ok(
      await page.$eval(
        ".title-intro img",
        (img) => img.complete && img.naturalWidth > 0,
      ),
      "the title image loaded before fading in",
    );
    // About three quarters of a desktop, the full phone width less margins.
    if (desktop)
      assert.ok(box.width > width * 0.65 && box.width < width * 0.85);
    else assert.ok(Math.abs(box.width - (width - 32)) < 2, String(box.width));
    // The table boots under the title, which holds silently for a gesture.
    await page.waitForSelector("#hand .card");
    await page.waitForTimeout(1500);
    assert.equal(await page.locator(".title-intro").count(), 1);
    assert.equal(await titlePlays(page), 0, "silent before the first tap");
    await shot(page, `before-${width}`);

    // The first tap (desktop) or key (phone) starts the song and shows Wake.
    if (desktop) await page.mouse.click(width / 2, height / 2);
    else await page.keyboard.press("a");
    await wakeShown(page);
    assert.equal(await titlePlays(page), 1);
    await page.waitForTimeout(1200);
    const lifted = await page.locator(".title-intro img").boundingBox();
    assert.ok(lifted.y + lifted.height / 2 < height * 0.45, "the logo lifts");
    assert.ok(
      await page.evaluate(
        () => window.__titleSong && !window.__titleSong.paused,
      ),
    );
    // More taps on the title do nothing more.
    await page.mouse.click(width / 2, 20);
    assert.equal(await page.locator(".title-intro").count(), 1);
    assert.equal(await titlePlays(page), 1);
    await shot(page, `wake-${width}`);

    // Wake (click, or Enter on the focused button) fades the song and enters.
    if (desktop) await page.locator(".title-wake").click();
    else await page.keyboard.press("Enter");
    await page.waitForTimeout(300);
    assert.equal(
      await page.evaluate(() => window.__titleSong.paused),
      false,
      "the song fades rather than cutting",
    );
    await gone(page, 1500);
    await page.waitForTimeout(1000);
    assert.equal(await page.evaluate(() => window.__titleSong.paused), true);
    // #2061: the lamplit attic plays no room music.
    assert.equal(await page.$eval("#room-music", (a) => a.paused), true);
    const save = await page.evaluate(() =>
      JSON.parse(localStorage.getItem("cosyworld.reflected-shore.v1")),
    );
    assert.equal(save.actors.vale.place, "attic");
    assert.equal(save.items.lamp.lit, true);
    assert.match(
      await page.locator("#backdrop").getAttribute("src"),
      /attic-lit/,
    );
    await shot(page, `game-${width}`);

    // A reload, and a later visit, go straight to the table in silence.
    await page.reload();
    await page.waitForSelector("#hand .card");
    await page.waitForTimeout(600);
    assert.equal(await page.locator(".title-intro").count(), 0);
    await page.mouse.click(width / 2, 10);
    assert.equal(await titlePlays(page), 0);
    const later = await open(fresh);
    await later.goto(`${origin}/?intro=1`);
    await later.waitForSelector("#hand .card");
    await later.waitForTimeout(600);
    assert.equal(await later.locator(".title-intro").count(), 0);
    // New game is a new world: the title and its song play again, once.
    await startNewGame(later);
    await titlePhase(later);
    await later.waitForTimeout(400);
    assert.equal(await titlePlays(later), 0);
    await later.mouse.click(width / 2, height / 2);
    await wakeShown(later);
    assert.equal(await titlePlays(later), 1);
    // Escape skips straight in and fades the song.
    await later.keyboard.press("Escape");
    await gone(later, 1500);
    await later.waitForTimeout(1200);
    assert.equal(await later.evaluate(() => window.__titleSong.paused), true);
    await later.reload();
    await later.waitForSelector("#hand .card");
    await later.waitForTimeout(600);
    assert.equal(await later.locator(".title-intro").count(), 0);
    assert.deepEqual([...page.errors, ...later.errors], []);
    await fresh.close();

    // Escape before the first tap goes straight in, silent.
    const skipContext = await newContext(width, height);
    const skipper = await open(skipContext);
    await skipper.goto(`${origin}/?intro=1`);
    await titlePhase(skipper);
    await skipper.keyboard.press("Escape");
    await gone(skipper, 1500);
    await skipper.waitForSelector("#hand .card");
    assert.equal(await titlePlays(skipper), 0);
    await skipContext.close();
  }

  // Music off: the same title and Wake, no song.
  const off = await newContext(390, 844, { music: false });
  const muted = await open(off);
  await muted.goto(`${origin}/?intro=1`);
  await titlePhase(muted);
  await muted.waitForSelector("#hand .card");
  await muted.mouse.click(195, 422);
  await wakeShown(muted);
  await muted.keyboard.press("Space");
  await gone(muted, 1500);
  assert.equal(await titlePlays(muted), 0);
  assert.deepEqual(muted.errors, []);
  await off.close();

  // Reduced motion crossfades without scaling and moves the logo at once.
  const reduced = await newContext(390, 844, { reducedMotion: "reduce" });
  const quiet = await open(reduced);
  await quiet.goto(`${origin}/?intro=1`);
  await titlePhase(quiet);
  await quiet.waitForTimeout(400);
  assert.equal(
    await quiet.$eval(
      ".title-intro img",
      (img) => getComputedStyle(img).transform,
    ),
    "none",
  );
  await quiet.waitForSelector("#hand .card");
  await quiet.mouse.click(195, 422);
  await wakeShown(quiet);
  await quiet.waitForTimeout(300);
  assert.notEqual(
    await quiet.$eval(
      ".title-intro img",
      (img) => getComputedStyle(img).transform,
    ),
    "none",
  );
  assert.equal(
    await quiet.$eval(".title-wake", (b) => getComputedStyle(b).opacity),
    "1",
  );
  await quiet.locator(".title-wake").click();
  await gone(quiet, 1000);
  await quiet.waitForSelector("#hand .card");
  await reduced.close();
  await checkTitleMusicAlone(browser, origin);
  console.log(`Title intro smoke passed. Screenshots: ${shots.join(", ")}`);
} finally {
  await browser.close();
  server.close();
}
