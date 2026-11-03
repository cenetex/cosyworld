import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { chromium } from "playwright";
import { createServer } from "../card-game/serve.mjs";
import { startNewGame } from "./card-browser-helpers.mjs";
import { TITLES } from "../card-game/title-intro.mjs";
import {
  cardShown,
  checkTitleMusicAlone,
  revealed,
  traveller,
} from "./title-music-alone.mjs";

// A new world opens with the silent land acknowledgement over the booting
// table. Its tap or key brings the logo and the title song; the logo lifts
// over a face-down card and Privacy; the card turns to Vale, the song fades
// and the table shows Vale's lit
// attic. Escape skips straight in. Room music never plays under the song.
// A reload or a later visit goes straight to the table; New game plays it again.
const server = createServer();
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
// Real browsers allow sound only after a gesture; so does this one.
const browser = await chromium.launch({
  headless: true,
  args: ["--autoplay-policy=user-gesture-required"],
});
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
    window.__overlaps = 0;
    const play = HTMLMediaElement.prototype.play;
    HTMLMediaElement.prototype.play = function () {
      window.__plays.push(this.id || this.src);
      const room = document.getElementById("room-music");
      const song = this === room ? window.__titleSong : room;
      if (song && !song.paused) window.__overlaps++;
      if (/title-attic-lamp/.test(this.src)) window.__titleSong = this;
      const started = play.call(this);
      if (/title-attic-lamp/.test(this.src))
        window.__titlePlay = started.then(
          () => "resolved",
          (error) => error.name,
        );
      return started;
    };
    // Every gain node gets a listener, so the smoke hears what plays.
    const Context = window.AudioContext;
    window.__listeners = [];
    window.AudioContext = function (...args) {
      const context = new Context(...args);
      const createGain = context.createGain.bind(context);
      context.createGain = () => {
        const gain = createGain();
        const analyser = context.createAnalyser();
        gain.connect(analyser);
        window.__listeners.push(analyser);
        return gain;
      };
      return context;
    };
    window.AudioContext.prototype = Context.prototype;
  }, music);
  return context;
}
const titlePlays = (page) =>
  page.evaluate(
    () => window.__plays.filter((p) => /title-attic-lamp/.test(p)).length,
  );
// The loudest gain node right now, in dBFS.
const loudness = (page) =>
  page.evaluate(() =>
    Math.max(
      -200,
      ...window.__listeners.map((analyser) => {
        const data = new Float32Array(analyser.fftSize);
        analyser.getFloatTimeDomainData(data);
        const power = data.reduce((sum, x) => sum + x * x, 0) / data.length;
        return 10 * Math.log10(power || 1e-20);
      }),
    ),
  );
// The song is heard within a second and a half of the gesture: its play
// resolved and it reaches -45 dBFS (the 2-second fade from silence did not).
async function heard(page) {
  assert.equal(await page.evaluate(() => window.__titlePlay), "resolved");
  let loudest = -200;
  for (let i = 0; i < 15 && loudest < -45; i++) {
    await page.waitForTimeout(100);
    loudest = Math.max(loudest, await loudness(page));
  }
  assert.ok(loudest >= -45, `title song too quiet: ${loudest.toFixed(1)} dBFS`);
}
const titlePhase = (page) =>
  page.waitForSelector('.title-intro[data-phase="ack"] .title-ack-text');
const gone = (page, timeout) =>
  page.waitForSelector(".title-intro", { state: "detached", timeout });
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
    // The acknowledgement is real text, readable, and scrolls in its panel.
    // Its lines fade in on a clock, then every one is fully shown.
    await page.waitForTimeout(3000);
    const ack = await page.$eval(".title-ack-text", (text) => ({
      words: text.innerText,
      size: parseFloat(getComputedStyle(text).fontSize),
      bottom: text.closest(".title-ack").getBoundingClientRect().bottom,
      faint: [...text.querySelectorAll("p:not(.title-credit)")].filter(
        (line) => getComputedStyle(line).opacity !== "1",
      ).length,
    }));
    assert.match(ack.words, /^Before this forest, there was land\./);
    assert.match(ack.words, /a wooden box, intricately carved/);
    assert.match(ack.words, /there is a path here for you\./);
    assert.match(ack.words, /All revenue goes to the Foundation/);
    assert.ok(ack.size >= 17 && ack.bottom <= height, JSON.stringify(ack));
    assert.equal(ack.faint, 0, "every line shown once loaded");
    // The way on is a quiet line of text, still a focused button.
    const cue = await page.$eval(".title-continue", (next) => ({
      focused: document.activeElement === next,
      ring: next.matches(":focus-visible"),
      tag: next.tagName,
      text: next.textContent,
      border: getComputedStyle(next).borderStyle,
      background: getComputedStyle(next).backgroundColor,
    }));
    assert.deepEqual(cue, {
      focused: true,
      ring: false,
      tag: "BUTTON",
      text: "click to continue",
      border: "none",
      background: "rgba(0, 0, 0, 0)",
    });
    await shot(page, `ack-${width}`);
    await page.waitForSelector("#hand .card");
    await page.waitForTimeout(1500);
    assert.equal(await titlePlays(page), 0, "silent before the first tap");

    // The first tap (desktop) or key (phone) brings the logo and the song.
    if (desktop) await page.mouse.click(width / 2, 10);
    else await page.keyboard.press("a");
    await page.waitForSelector('.title-intro[data-phase="title"]');
    assert.equal(await titlePlays(page), 1);
    await heard(page);
    await page.waitForTimeout(500);
    await shot(page, `logo-${width}`);
    const box = await page.locator(".title-intro > img").boundingBox();
    assert.ok(
      await page.$eval(
        ".title-intro > img",
        (img) => img.complete && img.naturalWidth > 0,
      ),
      "the title image loaded before fading in",
    );
    // About three quarters of a desktop, the full phone width less margins.
    if (desktop)
      assert.ok(box.width > width * 0.65 && box.width < width * 0.85);
    else assert.ok(Math.abs(box.width - (width - 32)) < 2, String(box.width));
    // Then the logo lifts over the face-down card.
    await cardShown(page);
    assert.equal(await titlePlays(page), 1);
    await page.waitForTimeout(1200);
    const lifted = await page.locator(".title-intro > img").boundingBox();
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
    await shot(page, `card-${width}`);

    // A click, or Enter on the focused card, turns it; then the song fades.
    if (desktop) await page.locator(traveller).click();
    else await page.keyboard.press("Enter");
    await revealed(page, "Vale");
    await page.waitForTimeout(desktop ? 300 : 100);
    await shot(page, `face-${width}`);
    await page.waitForSelector(".title-intro[data-phase=out]");
    await page.waitForTimeout(300);
    assert.equal(
      await page.evaluate(() => window.__titleSong.paused),
      false,
      "the song fades rather than cutting",
    );
    await gone(page, 1500);
    // It rings on over the table, fading for three seconds from the wake.
    assert.equal(await page.evaluate(() => window.__titleSong.paused), false);
    await page.waitForTimeout(2600);
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
    await later.keyboard.press("Enter");
    await later.waitForSelector('.title-intro[data-phase="title"]');
    assert.equal(await titlePlays(later), 1);
    await heard(later);
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
    for (const p of [page, later])
      assert.equal(await p.evaluate(() => window.__overlaps), 0);
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

  // Music off: the same title and card, no song.
  const off = await newContext(390, 844, { music: false });
  const muted = await open(off);
  await muted.goto(`${origin}/?intro=1`);
  await titlePhase(muted);
  await muted.waitForSelector("#hand .card");
  await muted.keyboard.press("Space");
  await cardShown(muted);
  await muted.keyboard.press("Tab");
  assert.equal(
    await muted.evaluate(() => document.activeElement.className),
    "title-privacy",
  );
  await muted.keyboard.press("Shift+Tab");
  await muted.keyboard.press("Space");
  await gone(muted, 4000);
  assert.equal(await titlePlays(muted), 0);
  assert.deepEqual(muted.errors, []);
  await off.close();

  // Reduced motion crossfades without scaling and moves the logo at once.
  const reduced = await newContext(390, 844, { reducedMotion: "reduce" });
  const quiet = await open(reduced);
  await quiet.goto(`${origin}/?intro=1`);
  await titlePhase(quiet);
  await quiet.mouse.click(195, 10);
  await quiet.waitForSelector('.title-intro[data-phase="title"]');
  await quiet.waitForTimeout(300);
  assert.equal(
    await quiet.$eval(
      ".title-intro > img",
      (img) => getComputedStyle(img).transform,
    ),
    "none",
  );
  await cardShown(quiet);
  await quiet.waitForTimeout(300);
  assert.notEqual(
    await quiet.$eval(
      ".title-intro > img",
      (img) => getComputedStyle(img).transform,
    ),
    "none",
  );
  assert.equal(
    await quiet.$eval(".title-reveal", (b) => getComputedStyle(b).opacity),
    "1",
  );
  // Reduced motion swaps the face in at once, with no flip.
  await quiet.locator(traveller).click();
  await revealed(quiet, "Vale");
  assert.equal(await quiet.locator(".reveal-lid").count(), 0);
  await gone(quiet, 3000);
  await quiet.waitForSelector("#hand .card");
  await reduced.close();
  await checkTitleMusicAlone(browser, origin, shot);
  console.log(`Title intro smoke passed. Screenshots: ${shots.join(", ")}`);
} finally {
  await browser.close();
  server.close();
}
