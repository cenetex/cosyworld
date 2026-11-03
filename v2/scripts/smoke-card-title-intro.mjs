import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { chromium } from "playwright";
import { createServer } from "../card-game/serve.mjs";
import { startNewGame } from "./card-browser-helpers.mjs";
import { REVEAL_HINT, TITLES, WAKE_FADE } from "../card-game/title-intro.mjs";
import acknowledgement from "../card-game/acknowledgement.json" with { type: "json" };
const held = acknowledgement.pauses.filter(({ tier }) => tier);
import {
  cardShown,
  checkTitleMusicAlone,
  revealed,
  traveller,
} from "./title-music-alone.mjs";

// A new world opens with the silent land acknowledgement over the booting
// table. Its tap or key brings the logo and the title song; the logo lifts
// over a face-down card and Privacy; the card turns to Vale, the song fades
// and the title goes to black and opens on Vale's lit
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
  page.wakings = 0;
  await page.route("**/card-game/text", (route) => {
    const input = route.request().postDataJSON();
    if (input.waking) page.wakings++;
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
// How much of the acknowledgement shows: letter spans still writing, those
// still dark, and whether the cue is at its resting opacity. Written whole,
// the spans fold back into plain text.
const streamState = (page) =>
  page.$eval(".title-ack", (panel) => {
    const letters = panel.querySelectorAll(".speech-letter");
    return {
      letters: letters.length,
      dark: panel.querySelectorAll(".speech-letter:not(.revealed)").length,
      cue: getComputedStyle(panel.querySelector(".title-continue")).opacity,
      words: panel.querySelector(".title-ack-text").textContent,
    };
  });
// The paused words' tiers, in order, and which of them glow now.
const glowState = (page) =>
  page.$$eval(".title-ack-glow", (glows) => ({
    tiers: glows.map((glow) => glow.dataset.tier),
    lit: glows
      .filter((glow) => "lit" in glow.dataset)
      .map((g) => g.textContent),
  }));
const whole = (state) =>
  state.dark === 0 && state.cue === "0.6" && state.words.length > 400;
// Letters whose ink is partway in, among the newest `last` written.
const softLetters = (last = 0) =>
  [...document.querySelectorAll(".title-ack .speech-letter.revealed")]
    .slice(-last)
    .filter((ch) => {
      const [, , , alpha = 1] = getComputedStyle(ch).color.match(/[\d.]+/g);
      return alpha > 0.02 && alpha < 0.98;
    }).length;
const gone = (page, timeout) =>
  page.waitForSelector(".title-intro", { state: "detached", timeout });
// The face-down card's idle cue: which step shows (none, glow, hint), the
// glow's opacity and animation, and the hint's opacity and words.
const idleState = (page) =>
  page.$eval(".title-reveal", (row) => {
    const glow = getComputedStyle(row.querySelector(".title-card"), "::before");
    const hint = row.querySelector(".title-hint");
    return {
      step: row.dataset.idle || "none",
      glow: Number(glow.opacity),
      breathing: glow.animationName !== "none",
      hint: Number(getComputedStyle(hint).opacity),
      words: hint.textContent,
      hidden: hint.getAttribute("aria-hidden"),
    };
  });
// Left alone from an interaction: nothing shows before idleGlowMs, the glow
// by then, the hint from hintMs. Steps are timed in the page from `since`.
async function idleCue(page, width, { reduced = false } = {}) {
  const since = await page.evaluate(() => {
    const row = document.querySelector(".title-reveal");
    window.__idleAt = {};
    window.__idleSince = performance.now();
    new MutationObserver(() => {
      const step = row.dataset.idle;
      if (step && !(step in window.__idleAt))
        window.__idleAt[step] = performance.now() - window.__idleSince;
    }).observe(row, { attributeFilter: ["data-idle"] });
    return Date.now();
  });
  const at = (ms) => page.waitForTimeout(Math.max(0, since + ms - Date.now()));
  const { idleGlowMs, hintMs } = REVEAL_HINT;
  const none = await idleState(page);
  assert.equal(none.step, "none");
  assert.equal(none.glow, 0);
  assert.equal(none.hint, 0);
  assert.equal(none.hidden, "true", "screen readers hear the card's name");
  assert.equal(none.words, "click to reveal");
  if (!reduced) await shot(page, `reveal-0s-${width}`);
  await at(idleGlowMs - 400);
  assert.equal((await idleState(page)).step, "none", "no glow before idle");
  await at(idleGlowMs + 1000);
  const glow = await idleState(page);
  assert.equal(glow.step, "glow");
  assert.ok(glow.glow > 0.1 && glow.glow <= 0.7, JSON.stringify(glow));
  assert.equal(glow.breathing, !reduced);
  if (reduced) assert.equal(glow.glow, 0.55, "a still glow");
  assert.equal(glow.hint, 0, "no hint before its time");
  if (!reduced) await shot(page, `reveal-4s-${width}`);
  await at(hintMs + (reduced ? 100 : 1300));
  const hint = await idleState(page);
  assert.equal(hint.step, "hint");
  assert.ok(hint.glow > 0.1, JSON.stringify(hint));
  assert.equal(hint.hint, 0.6, "the hint shows like the acknowledgement's cue");
  if (!reduced) await shot(page, `reveal-7s-${width}`);
  const times = await page.evaluate(() => window.__idleAt);
  assert.ok(
    Math.abs(times.glow - idleGlowMs) < 400 &&
      Math.abs(times.hint - hintMs) < 400,
    JSON.stringify(times),
  );
}
// Leaving: the face holds, the title goes to black with the song fading,
// then slowly opens on the scene. Frames of the black and the fade-in.
async function wakeFades(page, width, name) {
  await page.waitForSelector('.title-intro[data-phase="dark"] .title-dark');
  // Reveal-once: under the black the hand card is already face up.
  await valeShown(page, name);
  await page.waitForTimeout(WAKE_FADE.turn.blackMs + 50);
  assert.equal(
    await page.$eval(".title-dark", (d) => getComputedStyle(d).opacity),
    "1",
  );
  await shot(page, `black-${width}`);
  await page.waitForSelector('.title-intro[data-phase="out"]');
  await page.waitForTimeout(WAKE_FADE.turn.sceneMs / 3);
  const opacity = await page.$eval(".title-intro", (layer) =>
    Number(getComputedStyle(layer).opacity),
  );
  assert.ok(opacity > 0.05 && opacity < 0.85, `fading in: ${opacity}`);
  await shot(page, `fade-in-${width}`);
}
// The title's card is the avatar's: once the title leaves, by its turn or by
// Escape, Vale's hand card is face up with no second flip.
async function valeShown(page, id = "vale") {
  await page.waitForSelector(
    `#hand .card[data-card="${id}"][data-unrevealed="false"]`,
  );
  assert.equal(await page.locator("#hand .reveal-lid").count(), 0);
}
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
    // The acknowledgement writes in like dialogue, one letter at a time on
    // a steady beat. Over its first 80 letters: no rest is longer than a word's
    // breath, "land." and "peoples" hold one, and at most three letters are
    // soft at once. The full text is in the page throughout.
    await page.evaluate(`window.softLetters = ${softLetters}`);
    const cadence = await page.evaluate(
      () =>
        new Promise((resolve) => {
          const times = [],
            text = document.querySelector(".title-ack-text");
          // A stalled frame lets the clock catch up a few letters; the
          // soft count is the steady beat's, so it skips the catch-up.
          const start = performance.now();
          let softest = 0,
            last = start,
            calm = start;
          new MutationObserver((changes) => {
            for (const { target } of changes)
              if (target.matches(".revealed:not([data-at])")) {
                target.dataset.at = "";
                times.push([target.textContent, performance.now()]);
              }
          }).observe(text, { subtree: true, attributeFilter: ["class"] });
          const tick = (now = performance.now()) => {
            if (now - last > 34) calm = now + 150;
            if (now > calm) softest = Math.max(softest, window.softLetters(8));
            last = now;
            if (times.length >= 80 || performance.now() - start > 8000)
              resolve({ times, softest });
            else requestAnimationFrame(() => tick());
          };
          tick();
        }),
    );
    const gaps = cadence.times.slice(1).map(([, at], i) => ({
      after: cadence.times[i][0],
      ms: at - cadence.times[i][1],
    }));
    const rests = gaps.filter(({ ms }) => ms > 200);
    assert.ok(cadence.times.length >= 75, String(cadence.times.length));
    assert.ok(
      Math.max(...gaps.map(({ ms }) => ms)) < 700,
      JSON.stringify(rests),
    );
    assert.ok(rests.length >= 2 && rests.length <= 4, JSON.stringify(rests));
    assert.ok(cadence.softest <= 3, `${cadence.softest} letters soft at once`);
    const early = await streamState(page);
    assert.ok(
      early.dark > early.letters / 2,
      JSON.stringify({ ...early, words: "" }),
    );
    assert.equal(early.cue, "0");
    assert.match(early.words, /Open the box\. The path is yours\./);
    await page.waitForSelector("#hand .card");
    assert.equal(await titlePlays(page), 0, "silent before the first tap");
    // The first tap (desktop) or key (phone) shows it whole, the rest
    // fading in together rather than at once, and starts the song; the
    // acknowledgement stays.
    await page.evaluate(() => {
      window.__soft = 0;
      const until = () => performance.now() + 300;
      const watch = (end = until()) => {
        window.__soft = Math.max(window.__soft, window.softLetters());
        if (performance.now() < end) requestAnimationFrame(() => watch(end));
      };
      for (const type of ["click", "keydown"])
        window.addEventListener(type, () => watch(), {
          capture: true,
          once: true,
        });
    });
    if (desktop) await page.mouse.click(width / 2, 10);
    else await page.keyboard.press("a");
    assert.equal((await streamState(page)).dark, 0);
    await page.waitForTimeout(1000);
    const soft = await page.evaluate(() => window.__soft);
    assert.ok(soft > 50, `${soft} letters fading after the tap`);
    const tapped = await streamState(page);
    assert.ok(whole(tapped), JSON.stringify({ ...tapped, words: "" }));
    assert.equal(tapped.letters, 0, "the spans fold into plain text");
    assert.equal(
      await page.locator(".title-intro").getAttribute("data-phase"),
      "ack",
    );
    assert.equal(await titlePlays(page), 1);
    await heard(page);
    // The acknowledgement is real text, readable, and scrolls in its panel.
    // Its lines break as written, each one line wide on a desktop and
    // never wider than the panel on a phone.
    const ack = await page.$eval(".title-ack-text", (text) => ({
      words: text.innerText,
      plain: text.textContent.replaceAll("\u00a0", " "),
      lines: [...text.querySelectorAll(".title-ack-line")].map((line) =>
        Math.round(
          line.getBoundingClientRect().height /
            parseFloat(getComputedStyle(line).lineHeight),
        ),
      ),
      overflow: text.scrollWidth - text.clientWidth,
      size: parseFloat(getComputedStyle(text).fontSize),
      bottom: text.closest(".title-ack").getBoundingClientRect().bottom,
      faint: [...text.querySelectorAll("p")].filter(
        (line) => getComputedStyle(line).opacity !== "1",
      ).length,
    }));
    assert.match(
      ack.words,
      /^Before our forest, there was land\.\nBefore our story, there were peoples\nwho named the waters,\n/,
    );
    assert.match(
      ack.words,
      /with us\.\n\s*Before you sits a carved wooden box,\nits surface rippling with stories\nolder than either of us\.\n\s*Open the box/,
    );
    assert.match(ack.words, /Open the box\. The path is yours\.$/);
    assert.equal(ack.plain, acknowledgement.stanzas.flat().join(""));
    assert.equal(ack.lines.length, 17);
    assert.ok(
      ack.lines.every((rows) => rows >= 1 && rows <= (desktop ? 1 : 2)),
      JSON.stringify(ack.lines),
    );
    assert.ok(ack.overflow <= 0, `${ack.overflow}px wider than the panel`);
    // A tap that shows the rest goes straight to the end: only "yours"
    // keeps its glow, and every paused word carries its climbing tier.
    assert.deepEqual(await glowState(page), {
      tiers: held.map(({ tier }) => tier),
      lit: ["yours"],
    });
    assert.doesNotMatch(ack.words, /Cenetex|RATi|Foundation/u);
    assert.equal(await page.locator(".title-ack a").count(), 0);
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

    // The second brings the logo; the song plays on, once.
    if (desktop) await page.mouse.click(width / 2, 10);
    else await page.keyboard.press("a");
    await page.waitForSelector('.title-intro[data-phase="title"]');
    assert.equal(await titlePlays(page), 1);
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
    // After the tap above the card shows no focus ring (the keyboard shows
    // it, below). Privacy is a full tap target.
    const look = await page.$eval(traveller, (card) => ({
      ring: getComputedStyle(card).outlineColor,
      privacy: document.querySelector(".title-privacy").offsetHeight,
    }));
    assert.equal(look.ring, "rgba(0, 0, 0, 0)");
    assert.ok(look.privacy >= 24, String(look.privacy));
    // Left alone the card glows faintly, then says how to turn it. A tap
    // elsewhere hides both and starts the wait again.
    await page.mouse.click(width / 2, 20);
    await idleCue(page, width);
    await page.mouse.click(width / 2, 20);
    assert.equal((await idleState(page)).step, "none");
    await page.waitForTimeout(200);
    const reset = await idleState(page);
    assert.ok(reset.glow === 0 && reset.hint === 0, JSON.stringify(reset));

    // A click, or Enter on the focused card, turns it; then the song fades.
    if (desktop) {
      // Like a hand card, it lifts under the pointer.
      await page.locator(traveller).hover();
      await page.waitForTimeout(250);
      assert.equal(
        await page.$eval(traveller, (c) => getComputedStyle(c).translate),
        "0px -8px",
      );
      await page.locator(traveller).click();
    } else await page.keyboard.press("Enter");
    await revealed(page, "Vale");
    await page.waitForTimeout(desktop ? 300 : 100);
    await shot(page, `face-${width}`);
    // The name's shade is the figure's floor: it sits at the card's foot,
    // in its bottom 15%, not a quarter up where the hand clips its cards.
    const floor = await page.$eval(traveller, (card) => {
      const face = card.getBoundingClientRect();
      const name = card.querySelector(".name").getBoundingClientRect();
      return {
        shade: (face.bottom - (name.top + 0.65 * name.height)) / face.height,
        gap: face.bottom - name.bottom,
      };
    });
    assert.ok(floor.shade > 0 && floor.shade <= 0.15, JSON.stringify(floor));
    assert.ok(Math.abs(floor.gap) <= 2, JSON.stringify(floor));
    assert.equal((await idleState(page)).step, "none", "the turn ends the cue");
    await page.waitForSelector(".title-intro[data-phase=dark]");
    assert.equal(
      await page.evaluate(() => window.__titleSong.paused),
      false,
      "the song fades rather than cutting",
    );
    await wakeFades(page, width, "vale");
    // The song has faded out by the time the scene is up.
    await gone(page, WAKE_FADE.turn.sceneMs + 1000);
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
    // Vale is face up already; his first line waits only for the attic.
    await valeShown(page);
    assert.equal(
      await page.getAttribute(
        '#hand .card[data-card="attic"]',
        "data-unrevealed",
      ),
      "true",
    );
    assert.equal(page.wakings, 0);
    await page.locator('#hand .card[data-card="attic"]').click();
    await page.waitForFunction(() =>
      document.querySelector(
        '#hand .card[data-card="attic"][data-unrevealed="false"]',
      ),
    );
    for (let i = 0; i < 50 && page.wakings < 1; i++)
      await page.waitForTimeout(100);
    await page.waitForTimeout(500);
    assert.equal(page.wakings, 1, "Vale's first line is asked for once");

    // A reload, and a later visit, go straight to the table in silence.
    await page.reload();
    await page.waitForSelector("#hand .card");
    await page.waitForTimeout(600);
    assert.equal(await page.locator(".title-intro").count(), 0);
    // The reveal and the first line are not repeated.
    await valeShown(page);
    assert.equal(page.wakings, 1);
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
    assert.equal(await titlePlays(later), 1);
    await later.keyboard.press("Enter");
    await later.waitForSelector('.title-intro[data-phase="title"]');
    assert.equal(await titlePlays(later), 1);
    await heard(later);
    // Escape skips straight in and fades the song; skipping counts as the
    // reveal, so Vale is face up.
    await later.keyboard.press("Escape");
    await gone(later, 2500);
    await valeShown(later);
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
    await gone(skipper, 2500);
    await skipper.waitForSelector("#hand .card");
    assert.equal(await titlePlays(skipper), 0);
    await valeShown(skipper);
    await skipper.reload();
    await valeShown(skipper);
    await skipContext.close();
  }

  // Music off, on the narrowest phone: the same title and card, no song.
  const off = await newContext(375, 667, { music: false });
  const muted = await open(off);
  await muted.goto(`${origin}/?intro=1`);
  await titlePhase(muted);
  // Each paused word glows as it is written, in a soft tint of its tier's
  // colour, then fades as the reveal moves on, like a lamp passing: at
  // most two glow at once, and "yours" keeps it.
  await muted.evaluate(() => {
    window.__glows = [];
    window.__mostLit = 0;
    window.__litStyle = null;
    new MutationObserver((changes) => {
      for (const { target } of changes) {
        const lit = "lit" in target.dataset;
        window.__glows.push([target.textContent, lit, performance.now()]);
        if (lit && !window.__litStyle) {
          const style = getComputedStyle(target);
          window.__litStyle = style.transitionDuration;
        }
      }
      window.__mostLit = Math.max(
        window.__mostLit,
        document.querySelectorAll(".title-ack-glow[data-lit]").length,
      );
    }).observe(document.querySelector(".title-ack-text"), {
      subtree: true,
      attributeFilter: ["data-lit"],
    });
  });
  await muted.waitForSelector("#hand .card");
  // Left alone, it is written in about 18 seconds, then the cue shows,
  // and one key then goes on.
  const begun = Date.now();
  await muted.waitForFunction(
    () => !document.querySelector(".title-ack .speech-letter"),
    null,
    { timeout: 30000 },
  );
  assert.ok(Date.now() - begun > 15000, `written in ${Date.now() - begun} ms`);
  await muted.waitForTimeout(1500);
  assert.ok(whole(await streamState(muted)), "the stream ends on its own");
  const lamp = await muted.evaluate(() => ({
    rose: window.__glows.filter(([, lit]) => lit).map(([word]) => word),
    most: window.__mostLit,
    style: window.__litStyle,
  }));
  assert.deepEqual(
    lamp.rose,
    held.map(({ word }) => word),
  );
  assert.ok(lamp.most >= 1 && lamp.most <= 2, String(lamp.most));
  assert.equal(lamp.style, `${acknowledgement.glowInMs / 1000}s`);
  assert.deepEqual((await glowState(muted)).lit, ["yours"]);
  const yours = await muted.$eval(".title-ack-glow[data-lit]", (glow) => ({
    color: getComputedStyle(glow).color,
    base: getComputedStyle(glow.parentElement).color,
    shadow: getComputedStyle(glow).textShadow,
  }));
  assert.notEqual(yours.color, yours.base, "the last word keeps its tint");
  assert.match(yours.shadow, /^(rgba?|color)\(.+\) 0px 0px 6px$/);
  // The whole poem fits the short phone, with no scrolling.
  assert.ok(
    await muted.$eval(
      ".title-ack-text",
      (text) => text.scrollHeight <= text.clientHeight + 1,
    ),
    "the poem fits 375x667",
  );
  await shot(muted, "ack-375");
  await muted.keyboard.press("Space");
  await cardShown(muted);
  await muted.keyboard.press("Tab");
  assert.equal(
    await muted.evaluate(() => document.activeElement.className),
    "title-privacy",
  );
  await muted.keyboard.press("Shift+Tab");
  assert.notEqual(
    await muted.$eval(traveller, (c) => getComputedStyle(c).outlineColor),
    "rgba(0, 0, 0, 0)",
    "the keyboard shows the card's focus ring",
  );
  await muted.keyboard.press("Space");
  await gone(muted, 7000);
  assert.equal(await titlePlays(muted), 0);
  assert.deepEqual(muted.errors, []);
  await off.close();

  // Reduced motion crossfades without scaling and moves the logo at once.
  const reduced = await newContext(390, 844, { reducedMotion: "reduce" });
  const quiet = await open(reduced);
  await quiet.goto(`${origin}/?intro=1`);
  await titlePhase(quiet);
  // The acknowledgement shows whole at once, and one tap goes on.
  assert.ok(whole(await streamState(quiet)), "reduced motion shows it all");
  // Only the last word's tint shows, still: no glow, no fade.
  assert.deepEqual((await glowState(quiet)).lit, ["yours"]);
  assert.deepEqual(
    await quiet.$eval(".title-ack-glow[data-lit]", (glow) => [
      getComputedStyle(glow).transitionDuration,
      getComputedStyle(glow).textShadow,
    ]),
    ["0s", "none"],
  );
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
  // Left alone, a still glow, then the hint, both without a fade. A pointer
  // over the card starts the wait again.
  await quiet.waitForSelector('.title-reveal[data-idle="glow"]');
  const box = await quiet.locator(traveller).boundingBox();
  await quiet.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  assert.equal((await idleState(quiet)).step, "none", "a hover resets it");
  await quiet.mouse.move(195, 20);
  await idleCue(quiet, 390, { reduced: true });
  // Reduced motion swaps the face in at once, with no flip; the hint turns
  // the card too.
  await quiet.locator(".title-hint").click();
  await revealed(quiet, "Vale");
  assert.equal(await quiet.locator(".reveal-lid").count(), 0);
  // It cuts to black, holds, and crossfades quickly into the scene.
  await quiet.waitForSelector('.title-intro[data-phase="dark"]');
  assert.equal(
    await quiet.$eval(".title-dark", (d) => getComputedStyle(d).opacity),
    "1",
  );
  await gone(quiet, 3000);
  await quiet.waitForSelector("#hand .card");
  await reduced.close();
  await checkTitleMusicAlone(browser, origin, shot);
  console.log(`Title intro smoke passed. Screenshots: ${shots.join(", ")}`);
} finally {
  await browser.close();
  server.close();
}
