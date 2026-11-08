import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { chromium, webkit } from "playwright";
import { createServer } from "../card-game/serve.mjs";
import { startNewGame } from "./card-browser-helpers.mjs";
import {
  BOX_WHISPERS,
  OPENING_DEAL,
  REVEAL_HINT,
  TITLES,
  WAKE_FADE,
} from "../card-game/title-intro.mjs";
import { tiers } from "../card-game/level-tiers.mjs";
import acknowledgement from "../card-game/acknowledgement.json" with { type: "json" };
import * as intro from "../card-game/title-intro.mjs";
const held = intro.acknowledgementHighlights(acknowledgement);
const phrases = held.map(({ word }) => word);
import {
  cardShown,
  checkTitleMusicAlone,
  finishAcknowledgement,
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
const browserName = process.env.CARD_BROWSER || "chromium";
const browserType = { chromium, webkit }[browserName];
assert(browserType, `Unknown CARD_BROWSER: ${browserName}`);
const browser = await browserType.launch({
  headless: true,
  args:
    browserName === "chromium"
      ? ["--autoplay-policy=user-gesture-required"]
      : [],
});
// WebKit on macOS uses Option-Tab to include links in keyboard navigation.
const tab =
  browserName === "webkit" && process.platform === "darwin" ? "Alt+Tab" : "Tab";
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
async function newContext(
  width,
  height,
  { reducedMotion, music = true, sound = false, hasTouch = false } = {},
) {
  const context = await browser.newContext({
    viewport: { width, height },
    reducedMotion: reducedMotion || "no-preference",
    hasTouch,
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
    // The dialogue's letter blips: a 70 ms triangle (createSpeechSounds).
    window.__blips = 0;
    const { start, stop } = OscillatorNode.prototype;
    OscillatorNode.prototype.start = function (when = 0) {
      this.__at = when;
      return start.call(this, when);
    };
    OscillatorNode.prototype.stop = function (when = 0) {
      if (this.type === "triangle" && Math.abs(when - this.__at - 0.07) < 1e-3)
        window.__blips++;
      return stop.call(this, when);
    };
  }, music);
  // The letters' blips need the table's Voices on.
  if (sound)
    await context.addInitScript(() => {
      if (sessionStorage.getItem("voiced")) return;
      sessionStorage.setItem("voiced", "1");
      localStorage.setItem("cosyworld.dialogue.sound", "on");
    });
  return context;
}
const blips = (page) => page.evaluate(() => window.__blips);
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
async function nextWhisper(page, draw, word = 0.25) {
  await page.$eval(
    ".title-hint",
    async (hint, { draw, word }) => {
      const random = Math.random;
      let calls = 0;
      Math.random = () => (calls++ === 0 ? draw : word);
      try {
        hint.getAnimations()[0].finish();
        await new Promise(requestAnimationFrame);
      } finally {
        Math.random = random;
      }
    },
    { draw, word },
  );
  // Let the first frame paint before a check seeks or pauses this fade.
  await page.waitForTimeout(50);
}
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
  assert.ok(BOX_WHISPERS.flat().includes(none.words));
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
  assert.ok(hint.hint > 0.1 && hint.hint <= 0.6, JSON.stringify(hint));
  if (!reduced) {
    const positions = [];
    const lines = new Set();
    const draws = [0.32, 0.76, 0.92, 0.975, 0.994, 0.999];
    for (const [index, time] of [
      1500,
      4750,
      ...Array(12).fill(1500),
    ].entries()) {
      if (index > 1) {
        await nextWhisper(page, draws[Math.floor((index - 2) / 2)]);
      }
      await page.$eval(
        ".title-hint",
        (hint, time) => {
          const motion = hint.getAnimations()[0];
          motion.pause();
          motion.currentTime = time;
        },
        time,
      );
      await page.waitForTimeout(50);
      const pose = await page.$eval(".title-hint", (hint) => {
        const rect = hint.getBoundingClientRect();
        const privacy = document
          .querySelector(".title-privacy")
          .getBoundingClientRect();
        const card = document
          .querySelector(".title-card .card")
          .getBoundingClientRect();
        const logo = document
          .querySelector(".title-intro > img")
          .getBoundingClientRect();
        return {
          x: rect.x,
          y: rect.y,
          opacity: +getComputedStyle(hint).opacity,
          transform: getComputedStyle(hint).transform,
          tier: hint.dataset.tier,
          color: hint.style.color,
          words: hint.textContent,
          fits:
            rect.left >= 0 &&
            rect.right <= innerWidth &&
            rect.top >= 0 &&
            rect.bottom < privacy.top,
          clear: [card, logo].every(
            (part) =>
              rect.right < part.left ||
              rect.left > part.right ||
              rect.bottom < part.top ||
              rect.top > part.bottom,
          ),
          whole: hint.scrollWidth <= hint.clientWidth,
        };
      });
      assert.ok(pose.fits, JSON.stringify(pose));
      assert.ok(pose.clear && pose.whole, JSON.stringify(pose));
      assert.equal(pose.transform, "none");
      if (index > 1) {
        const rank = Math.floor((index - 2) / 2);
        assert.equal(pose.tier, tiers[rank].id);
        assert.ok(BOX_WHISPERS[rank].includes(pose.words));
        lines.add(pose.words);
      }
      assert.ok(
        pose.color &&
          [
            "common",
            "uncommon",
            "rare",
            "epic",
            "legendary",
            "mythic",
          ].includes(pose.tier),
      );
      assert.ok(
        time === 4750 ? pose.opacity < 0.01 : pose.opacity === 0.5,
        JSON.stringify(pose),
      );
      if (time !== 4750) positions.push([pose.x, pose.y]);
      await shot(page, `whisper-${width}-${index}`);
    }
    assert.ok(new Set(positions.map(JSON.stringify)).size >= 3);
    assert.equal(lines.size, 12, "every whisper fits around the box");
    await page.$eval(".title-hint", (hint) => hint.getAnimations()[0].play());
  }
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
  await page.waitForSelector('.title-intro[data-phase="logo-out"]');
  const before = await page.evaluate(() => ({
    box: document.querySelector(".title-card .card").dataset.unrevealed,
    boxVisible: getComputedStyle(document.querySelector(".title-reveal"))
      .visibility,
    hand: getComputedStyle(document.getElementById("hand")).visibility,
  }));
  assert.deepEqual(before, {
    box: "true",
    boxVisible: "visible",
    hand: "hidden",
  });
  await page.$eval(".title-intro > img", (logo) => {
    const fade = logo.getAnimations().at(-1);
    fade.pause();
    fade.currentTime = 175;
  });
  const fading = await page.$eval(".title-intro > img", (logo) => Number(getComputedStyle(logo).opacity));
  assert.ok(fading > 0 && fading < 1);
  assert.equal(await page.$eval(".title-reveal", (row) => getComputedStyle(row).opacity), "1");
  await shot(page, `logo-out-${width}`);
  await page.$eval(".title-intro > img", (logo) =>
    logo.getAnimations().at(-1).play(),
  );
  await page.waitForSelector('.title-intro[data-phase="dealing"]');
  const sample = (time) =>
    page.$eval(
      ".title-intro",
      (layer, time) => {
        for (const node of [
          layer,
          ...layer.querySelectorAll(":scope > .card-frame"),
        ])
          for (const animation of node.getAnimations()) {
            animation.pause();
            animation.currentTime = time;
          }
      },
      time,
    );
  await sample(300);
  const dealt = await page.$$eval(".title-intro > .card-frame", (cards) =>
    cards.map((card) => ({
      inert: card.inert && card.getAttribute("aria-hidden") === "true" && !card.querySelector("[id]"),
      covered: card.querySelector(".card").dataset.unrevealed,
      ready: [...card.querySelectorAll("img")].every(
        (image) => image.complete && image.naturalWidth > 0,
      ),
    })),
  );
  assert.ok(dealt.length > 1);
  for (const card of dealt)
    assert.deepEqual(card, { inert: true, covered: "true", ready: true });
  assert.equal(
    await page.$eval("#hand", (hand) => getComputedStyle(hand).visibility),
    "hidden",
  );
  assert.equal(
    await page.getAttribute(
      `#hand .card[data-card="${name}"]`,
      "data-unrevealed",
    ),
    "true",
  );
  assert.equal(
    await page.$eval(
      ".title-intro",
      (layer) => getComputedStyle(layer).opacity,
    ),
    "1",
  );
  await shot(page, `fan-out-${width}`);
  await sample(900);
  await shot(page, `fan-moving-${width}`);
  await sample(
    OPENING_DEAL.flightMs + (dealt.length - 1) * OPENING_DEAL.staggerMs - 1,
  );
  const deltas = await page.$$eval(".title-intro > .card-frame", (cards) =>
    cards.flatMap((copy) => {
      const id = copy.querySelector(".card[data-card]")?.dataset.card;
      const original =
        id &&
        document
          .querySelector(`#hand .card[data-card="${CSS.escape(id)}"]`)
          ?.closest(".card-frame");
      if (!original) return [];
      const rotation = getComputedStyle(original).rotate;
      const endpoint = copy.getAnimations()[0].effect.getKeyframes().at(-1).transform;
      if (copy.offsetWidth !== original.offsetWidth || copy.offsetHeight !== original.offsetHeight || endpoint !== `rotate(${rotation === "none" ? "0deg" : rotation})`) return [Infinity];
      const a = copy.getBoundingClientRect(),
        b = original.getBoundingClientRect();
      return [
        Math.max(
          ...["left", "top", "width", "height"].map((key) =>
            Math.abs(a[key] - b[key]),
          ),
        ),
      ];
    }),
  );
  assert.ok(deltas.length && deltas.every((delta) => delta < 2));
  await shot(page, `fan-arrived-${width}`);
  await page.$eval(".title-intro", (layer) => {
    for (const node of [
      layer,
      ...layer.querySelectorAll(":scope > .card-frame"),
    ])
      for (const animation of node.getAnimations()) animation.play();
  });
  await page.waitForSelector(".title-intro", { state: "detached" });
  await valeShown(page, name);
  assert.equal(
    await page.$eval("#hand", (hand) => getComputedStyle(hand).visibility),
    "visible",
  );
  assert.equal(await page.locator(".title-intro .beat-ghost").count(), 0);
  assert.ok(
    await page.$eval(`#hand .card[data-card="${name}"]`, (card) =>
      card
        .getAnimations()
        .some((animation) =>
          animation.effect
            .getKeyframes()
            .some((frame) => /^0(?:px)? -14px$/.test(frame.translate)),
        ),
    ),
    "avatar bounces only after landing",
  );
  await shot(page, `avatar-landed-${width}`);
}
// The title's card is the avatar's: once the title leaves, by its turn or by
// Escape, Vale's hand card is face up with no second flip.
async function valeShown(page, id = "vale") {
  await page.waitForSelector(
    `#hand .card[data-card="${id}"][data-unrevealed="false"]`,
  );
  assert.equal(await page.locator("#hand .reveal-lid").count(), 0);
}
// The letters blip in the dialogue's voice once audio is unlocked. A first
// gesture quickens a stanza and its next stanza follows with the voice.
// A new world from the menu hears it from the first letters.
async function checkBlips() {
  for (const width of [1440, 390]) {
    const context = await newContext(width, 900, {
      sound: true,
      hasTouch: width === 390,
    });
    const page = await open(context);
    await page.goto(`${origin}/?intro=1`);
    await titlePhase(page);
    await page.waitForSelector("#hand .card");
    await page.waitForTimeout(1500);
    assert.equal(await blips(page), 0, "silent before a gesture");
    await shot(page, `hand-cue-${width}`);
    if (width === 390) await page.touchscreen.tap(width / 2, 10);
    else await page.mouse.click(width / 2, 10);
    const end = acknowledgement.stanzas[0].join("").length;
    const stanza = await streamState(page);
    assert.ok(stanza.letters - stanza.dark < end, "the section keeps writing");
    assert.equal(await titlePlays(page), 0);
    await page.waitForFunction(() => window.__blips >= 5);
    assert.equal(await titlePlays(page), 0, "the second stanza has the voice");
    await page.keyboard.press("Escape");
    await gone(page, 2500);
    await startNewGame(page);
    await titlePhase(page);
    await page.waitForTimeout(1500);
    const heard = await blips(page);
    assert.ok(heard >= 10, `${heard} blips in the first 1.5 s`);
    const songs = await titlePlays(page);
    await page.keyboard.press("Enter");
    const beforeQuick = await blips(page);
    await page.waitForTimeout(600);
    const quickBlips = (await blips(page)) - beforeQuick;
    assert.ok(quickBlips > 3 && quickBlips <= 15, `${quickBlips} paced blips`);
    assert.equal(await titlePlays(page), songs);
    await finishAcknowledgement(page);
    assert.equal(await titlePlays(page), songs);
    await page.keyboard.down("Enter");
    assert.equal(await titlePlays(page), songs + 1, "Continue starts the song");
    await page.waitForFunction(() =>
      document
        .querySelector(".title-intro > img")
        .getAnimations()
        .some((animation) => animation.playState === "running"),
    );
    await page.keyboard.down("Enter");
    assert.ok(
      await page.$eval(".title-intro > img", (image) =>
        image
          .getAnimations()
          .every((animation) => animation.playbackRate === 1),
      ),
      "holding Enter keeps the current pace",
    );
    await page.keyboard.up("Enter");
    if (width === 390)
      await page.$eval(".title-intro > img", async (image) => {
        await Promise.all(
          image.getAnimations().map((animation) => animation.finished),
        );
      });
    const hurriedAt = Date.now();
    await page.keyboard.press("Enter");
    assert.equal(
      await page.locator(".title-intro").getAttribute("data-phase"),
      "title",
    );
    await page.waitForSelector(traveller, { timeout: 2500 });
    assert.ok(Date.now() - hurriedAt < (width === 390 ? 500 : 2500));
    await page.keyboard.press("Escape");
    await gone(page, 2500);
    assert.deepEqual(page.errors, []);
    await context.close();
  }
}

// Large text: 320x568 at 200% browser zoom, and 390x844 with the root font
// at 200% under reduced motion. The poem wraps in its panel with no sideways
// scroll; while it writes, the panel follows the pen; keys complete each
// stanza, then continue. The card gives up height so its hint and Privacy
// stay on screen.
async function checkLargeText() {
  const inView = (page, selector) =>
    page.$eval(selector, (node) => {
      const box = node.getBoundingClientRect();
      return (
        box.left >= -1 &&
        box.top >= -1 &&
        box.right <= innerWidth + 1 &&
        box.bottom <= innerHeight + 1
      );
    });
  for (const { width, height, zoom, reducedMotion } of [
    { width: 160, height: 284, zoom: true, reducedMotion: "no-preference" },
    { width: 390, height: 844, zoom: false, reducedMotion: "reduce" },
  ]) {
    const context = await browser.newContext({
      viewport: { width, height },
      deviceScaleFactor: zoom ? 2 : 1,
      reducedMotion,
    });
    if (!zoom)
      await context.route("**/style.css", async (route) => {
        const response = await route.fetch();
        const body = `${await response.text()}\nhtml { font-size: 200%; }\n`;
        await route.fulfill({ response, body });
      });
    const page = await open(context);
    await page.goto(`${origin}/?intro=1`);
    await titlePhase(page);
    const name = `large-${zoom ? "zoom" : "font"}-${width}`;
    if (reducedMotion === "reduce")
      assert.ok(whole(await streamState(page)), "reduced motion shows it all");
    else {
      await page.waitForFunction(
        () => document.querySelector(".title-ack-text").scrollTop > 0,
        null,
        { timeout: 15000 },
      );
      await page.waitForTimeout(400);
      // The newest letter is on screen, though a line may be scrolling up.
      const pen = await page.$eval(".title-ack-text", (text) => {
        const written = text.querySelectorAll(".speech-letter.revealed");
        const box = text.getBoundingClientRect();
        const last = written[written.length - 1].getBoundingClientRect();
        return { top: last.top - box.bottom, bottom: last.bottom - box.top };
      });
      assert.ok(pen.top < 0 && pen.bottom > 0, JSON.stringify(pen));
      await shot(page, `${name}-writing`);
      // Scrolled on past the first stanza, its set lights all at once.
      await page.hover(".title-ack-text");
      await page.mouse.wheel(0, 4000);
      const set = '.title-ack-glow[data-tier="uncommon"][data-lit]';
      await page.waitForSelector(set, { timeout: 15000 });
      await page.waitForTimeout(100);
      assert.equal(await page.locator(set).count(), 4, "lit at once");
      await finishAcknowledgement(page);
      assert.equal((await streamState(page)).dark, 0, "the stanzas are whole");
      await page.waitForTimeout(1000);
      assert.ok(whole(await streamState(page)));
    }
    const ack = await page.$eval(".title-ack-text", (text) => ({
      sideways: text.scrollWidth - text.clientWidth,
      page: document.documentElement.scrollWidth - innerWidth,
      size: parseFloat(getComputedStyle(text).fontSize),
    }));
    assert.ok(ack.sideways <= 0 && ack.page <= 0, JSON.stringify(ack));
    if (!zoom) assert.ok(ack.size >= 32, JSON.stringify(ack));
    for (const part of [".title-ack", ".title-continue"])
      assert.ok(await inView(page, part), `${name}: ${part} on screen`);
    await shot(page, `${name}-ack`);
    await page.keyboard.press("a");
    await cardShown(page);
    await page.waitForSelector('.title-reveal[data-idle="hint"]', {
      timeout: REVEAL_HINT.hintMs + 3000,
    });
    await page.waitForTimeout(reducedMotion === "reduce" ? 100 : 1300);
    if (zoom) {
      // Give wrapped lines the taller metrics of a different system serif.
      await page.$eval(".title-hint", (hint) => {
        hint.style.lineHeight = "1.5";
      });
      await nextWhisper(page, 0.32);
      await nextWhisper(page, 0.999, 0.75);
      await page.waitForTimeout(1300);
      assert.equal(
        await page.textContent(".title-hint"),
        "you are already inside",
      );
    }
    for (const part of [traveller, ".title-hint", ".title-privacy"])
      assert.ok(await inView(page, part), `${name}: ${part} on screen`);
    assert.ok(
      await page.$eval(".title-hint", (hint) => {
        const text = hint.getBoundingClientRect();
        const box = document
          .querySelector(".title-card .card")
          .getBoundingClientRect();
        const privacy = document
          .querySelector(".title-privacy")
          .getBoundingClientRect();
        const logo = document
          .querySelector(".title-intro > img")
          .getBoundingClientRect();
        return (
          text.bottom <= privacy.top - 8 &&
          hint.scrollWidth <= hint.clientWidth &&
          [box, logo].every(
            (part) =>
              text.bottom <= part.top - 6 ||
              text.top >= part.bottom + 6 ||
              text.right <= part.left - 6 ||
              text.left >= part.right + 6,
          )
        );
      }),
      `${name}: the words clear the logo, box and Privacy`,
    );
    const card = await page.locator(traveller).boundingBox();
    assert.ok(card.height > 40, JSON.stringify(card));
    assert.ok(
      BOX_WHISPERS.flat().includes(await page.textContent(".title-hint")),
    );
    await shot(page, `${name}-card`);
    await page.keyboard.press("Enter");
    await revealed(page, "Vale");
    await gone(page, 7000);
    assert.deepEqual(page.errors, []);
    await context.close();
  }
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
    assert.ok(
      Number(early.cue) >= 0.5,
      "the click cue is visible while writing",
    );
    const cueHint = await page.$eval(".title-continue", (button) => ({
      hand: getComputedStyle(button, "::before").content,
      height: button.getBoundingClientRect().height,
    }));
    assert.match(cueHint.hand, /☞/u);
    assert.ok(cueHint.height >= 44);
    assert.match(early.words, /either of us\.Will you take it\?$/);
    // Every letter is laid out from the start: lighting moves no glyph.
    const layout = () =>
      page.$$eval(".title-ack-glow", (glows) =>
        glows.flatMap((glow) =>
          Object.values(glow.getBoundingClientRect().toJSON()),
        ),
      );
    const unlit = await layout();
    await page.waitForSelector("#hand .card");
    assert.equal(await titlePlays(page), 0, "silent before the first tap");
    // A tap speeds visible letters, then the next section starts in the same breath.
    const sectionEnd = acknowledgement.stanzas[0].join("").length;
    await page.evaluate((end) => {
      window.__quickFrames = [];
      const watch = (start = performance.now()) => {
        const shown = document.querySelectorAll(
          ".title-ack .speech-letter.revealed",
        ).length;
        const at = performance.now() - start;
        window.__quickFrames.push({ shown, at });
        if ((shown <= end || at < 100) && at < 3000)
          requestAnimationFrame(() => watch(start));
        else window.__quickDone = true;
      };
      for (const type of ["click", "keydown"])
        window.addEventListener(type, () => watch(), {
          capture: true,
          once: true,
        });
    }, sectionEnd);
    if (desktop) await page.mouse.click(width / 2, 10);
    else await page.keyboard.press("a");
    const first = await streamState(page);
    assert.ok(
      first.letters - first.dark < sectionEnd,
      "the tap preserves the reveal",
    );
    await shot(page, `quicken-start-${width}`);
    await page.waitForFunction(() => window.__quickDone);
    const frames = await page.evaluate(() => window.__quickFrames);
    const ended = frames.find(({ shown }) => shown >= sectionEnd);
    const nextSection = frames.find(({ shown }) => shown > sectionEnd);
    assert.ok(ended.at > 100 && ended.at < 2200, JSON.stringify(ended));
    assert.ok(
      nextSection.at - ended.at < 100,
      "the next section starts immediately",
    );
    assert.ok(
      frames.length > 8,
      "the section has several visible writing frames",
    );
    await shot(page, `quicken-handoff-${width}`);
    await page.waitForTimeout(1000);
    const moved = (await layout()).map((v, i) => Math.abs(v - unlit[i]));
    assert.ok(Math.max(...moved) < 1, `words moved ${Math.max(...moved)} px`);
    await finishAcknowledgement(page);
    await page.waitForFunction(
      (count) =>
        document.querySelectorAll(".title-ack-glow[data-lit]").length === count,
      phrases.length,
    );
    const tapped = await streamState(page);
    assert.ok(whole(tapped), JSON.stringify({ ...tapped, words: "" }));
    assert.equal(tapped.letters, 0, "the spans fold into plain text");
    assert.equal(
      await page.locator(".title-intro").getAttribute("data-phase"),
      "ack",
    );
    assert.equal(await titlePlays(page), 0);
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
      /with us\.\n\s*Before you sits an intricately carved wooden box,\nits surface rippling with stories\nolder than either of us\.\n\s*Will you take it\?$/,
    );
    // The question is plain cream, with nothing lit.
    assert.deepEqual(
      await page.$eval(".title-ack p:last-child", (p) => [
        p.querySelectorAll(".title-ack-glow").length,
        getComputedStyle(p).color,
      ]),
      [0, "rgb(255, 244, 220)"],
    );
    assert.equal(ack.plain, acknowledgement.stanzas.flat().join(""));
    assert.equal(ack.lines.length, 17);
    assert.ok(
      ack.lines.every((rows) => rows >= 1 && rows <= (desktop ? 1 : 2)),
      JSON.stringify(ack.lines),
    );
    assert.ok(ack.overflow <= 0, `${ack.overflow}px wider than the panel`);
    // Completing all stanzas lights every held phrase in its climbing tier.
    assert.deepEqual(await glowState(page), {
      tiers: held.map(({ tier }) => tier),
      lit: phrases,
    });
    assert.doesNotMatch(ack.words, /Cenetex|RATi|Foundation/u);
    assert.equal(await page.locator(".title-ack a").count(), 0);
    assert.ok(ack.size >= 17 && ack.bottom <= height, JSON.stringify(ack));
    assert.equal(ack.faint, 0, "every line shown once loaded");
    // The way on is a quiet line of text, still a focused button.
    const cue = await page.$eval(".title-continue", (next) => ({
      focused: document.activeElement === next,
      tag: next.tagName,
      text: next.textContent,
      border: getComputedStyle(next).borderStyle,
      background: getComputedStyle(next).backgroundColor,
    }));
    assert.deepEqual(cue, {
      focused: true,
      tag: "BUTTON",
      text: "click to continue",
      border: "none",
      background: "rgba(0, 0, 0, 0)",
    });
    await shot(page, `ack-${width}`);

    // Continue brings the logo, fades the words, and starts the song.
    if (desktop) await page.mouse.click(width / 2, 10);
    else await page.keyboard.press("a");
    await page.waitForSelector('.title-intro[data-phase="title"]');
    assert.equal(await titlePlays(page), 1);
    await page.waitForFunction(
      () =>
        document.querySelector(".title-ack-line > span")?.getAnimations()
          .length,
    );
    const fades = await page.$$eval(".title-ack-line > span", (words) =>
      words.map((word) => ({
        text: word.textContent,
        tier: word.parentElement.getAnimations().length
          ? "legendary"
          : ["care", "still.", "living"].includes(word.textContent)
            ? "epic"
            : word.querySelector(".title-ack-glow")?.dataset.tier || "common",
        delay: (
          word.getAnimations()[0] || word.parentElement.getAnimations()[0]
        ).effect.getTiming().delay,
      })),
    );
    assert.equal(fades[0].text, "Before");
    assert.equal(fades.findLast(({ tier }) => tier === "mythic").text, "box,");
    for (const tier of ["common", ...new Set(held.map(({ tier }) => tier))]) {
      let last = -1;
      for (const { delay } of fades.filter((word) => word.tier === tier)) {
        assert.ok(delay >= last, `${tier} words fade in reading order`);
        last = delay;
      }
    }
    assert.equal(
      new Set(
        fades
          .filter(({ tier }) => tier === "legendary")
          .map(({ delay }) => delay),
      ).size,
      1,
    );
    await page.waitForFunction(() => {
      const plain = [
        ...document.querySelectorAll(".title-ack-line > span"),
      ].filter(
        (word) =>
          !word.querySelector(".title-ack-glow") &&
          !["care", "still.", "living"].includes(word.textContent) &&
          !word.parentElement.getAnimations().length,
      );
      const box = [
        ...document.querySelectorAll('[data-tier="mythic"].title-ack-glow'),
      ].at(-1);
      const logo = document.querySelector(".title-intro > img");
      return (
        plain.length > 0 &&
        plain.every((word) => getComputedStyle(word).opacity === "0") &&
        box &&
        getComputedStyle(box.parentElement).opacity === "1" &&
        Number(getComputedStyle(logo).opacity) > 0 &&
        Number(getComputedStyle(logo).opacity) <= 0.1
      );
    });
    await shot(page, `logo-${width}`);
    await heard(page);
    const logoWidth = await page.$eval(
      ".title-intro > img",
      (img) => img.offsetWidth,
    );
    assert.ok(
      await page.$eval(
        ".title-intro > img",
        (img) => img.complete && img.naturalWidth > 0,
      ),
      "the title image loaded before fading in",
    );
    // About three quarters of a desktop, the full phone width less margins.
    if (desktop)
      assert.ok(logoWidth > width * 0.65 && logoWidth < width * 0.85);
    else assert.equal(logoWidth, width - 32);
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
    await wakeFades(page, width, "vale");
    // The audio fade finishes on its own clock after the scene appears.
    await gone(page, WAKE_FADE.turn.sceneMs + 1000);
    await page.waitForFunction(() => window.__titleSong.paused, null, {
      timeout: WAKE_FADE.turn.songSeconds * 1000 + 1000,
    });
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
    // Vale's own reveal starts his first line while the attic stays covered.
    await valeShown(page);
    assert.equal(
      await page.getAttribute(
        '#hand .card[data-card="attic"]',
        "data-unrevealed",
      ),
      "true",
    );
    for (let i = 0; i < 50 && page.wakings < 1; i++)
      await page.waitForTimeout(100);
    assert.equal(page.wakings, 1);
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
    await finishAcknowledgement(later);
    assert.equal(await titlePlays(later), 0);
    await later.keyboard.press("Enter");
    await later.waitForSelector('.title-intro[data-phase="title"]');
    assert.equal(await titlePlays(later), 1);
    await heard(later);
    // Escape skips straight in and fades the song; skipping counts as the
    // reveal, so Vale is face up.
    await later.keyboard.press("Escape");
    await gone(later, 2500);
    await valeShown(later);
    await later.waitForFunction(() => window.__titleSong.paused, null, {
      timeout: WAKE_FADE.skip.songSeconds * 1000 + 1000,
    });
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
    // Escape during flight restores the real hand without a second reveal.
    await startNewGame(skipper);
    await titlePhase(skipper);
    await finishAcknowledgement(skipper);
    await skipper.keyboard.press("Enter");
    await cardShown(skipper);
    await skipper.locator(traveller).click();
    await skipper.waitForSelector('.title-intro[data-phase="dealing"]');
    await skipper.keyboard.press("Escape");
    await gone(skipper, 1500);
    await valeShown(skipper);
    assert.equal(
      await skipper.$eval("#hand", (hand) => getComputedStyle(hand).visibility),
      "visible",
    );
    assert.equal(await skipper.locator(".title-intro .beat-ghost").count(), 0);
    await skipContext.close();
  }

  // Music off, on the narrowest phone: the same title and card, no song.
  const off = await newContext(375, 667, { music: false });
  const muted = await open(off);
  await muted.goto(`${origin}/?intro=1`);
  await titlePhase(muted);
  // Each held phrase lights as its last letter is written, in a soft tint
  // of its tier's colour, and stays lit.
  await muted.evaluate(() => {
    window.__glows = [];
    window.__litStyle = null;
    new MutationObserver((changes) => {
      for (const { target } of changes) {
        const lit = "lit" in target.dataset;
        const written = document.querySelectorAll(".title-ack .revealed");
        window.__glows.push([target.textContent, lit, written.length]);
        if (lit && !window.__litStyle) {
          const style = getComputedStyle(target);
          window.__litStyle = style.transitionDuration;
        }
      }
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
    { timeout: 40000 },
  );
  assert.ok(Date.now() - begun > 20000, `written in ${Date.now() - begun} ms`);
  await muted.waitForTimeout(1500);
  assert.ok(whole(await streamState(muted)), "the stream ends on its own");
  const lamp = await muted.evaluate(() => ({
    changes: window.__glows.map(([phrase, lit]) => [phrase, lit]),
    written: window.__glows.map(([, , written]) => written),
    style: window.__litStyle,
  }));
  assert.deepEqual(
    lamp.changes,
    phrases.map((phrase) => [phrase, true]),
    "each word lights once and never goes out",
  );
  // Each lights while the pen holds at its own stanza's end.
  assert.deepEqual(
    lamp.written,
    held.map(({ written }) => written),
  );
  assert.deepEqual(
    [...new Set(lamp.style.split(", "))],
    [`${acknowledgement.glowInMs / 1000}s`],
    "it rises over glowInMs",
  );
  assert.deepEqual((await glowState(muted)).lit, phrases);
  const tints = await muted.$$eval(".title-ack-glow[data-lit]", (glows) =>
    glows.map((glow) => ({
      color: getComputedStyle(glow).color,
      base: getComputedStyle(glow.parentElement).color,
      shadow: getComputedStyle(glow).textShadow,
      stroke: getComputedStyle(glow).webkitTextStroke,
    })),
  );
  // Weight as well as colour, and every tint (srgb 0-1) above AA on black.
  const luminance = (color) =>
    color
      .match(/[\d.]+/g)
      .slice(0, 3)
      .map((v) => (v <= 0.04045 ? v / 12.92 : ((+v + 0.055) / 1.055) ** 2.4))
      .reduce((sum, v, i) => sum + v * [0.2126, 0.7152, 0.0722][i], 0);
  for (const tint of tints) {
    assert.notEqual(tint.color, tint.base, "every word keeps its tint");
    assert.match(tint.shadow, /^(rgba?|color)\(.+\) 0px 0px 5px$/);
    assert.match(tint.stroke, /^0\.\d+px color\(/, tint.stroke);
    const contrast = (luminance(tint.color) + 0.05) / 0.05;
    assert.ok(contrast >= 7, `${tint.color}: ${contrast.toFixed(1)}:1`);
  }
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
  await muted.keyboard.press(tab);
  assert.equal(
    await muted.evaluate(() => document.activeElement.className),
    "title-privacy",
  );
  await muted.keyboard.press(`Shift+${tab}`);
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
  const reduced = await newContext(390, 844, {
    reducedMotion: "reduce",
    sound: true,
  });
  const quiet = await open(reduced);
  await quiet.goto(`${origin}/?intro=1`);
  await titlePhase(quiet);
  // The acknowledgement shows whole at once, and one tap goes on.
  assert.ok(whole(await streamState(quiet)), "reduced motion shows it all");
  // Every phrase's tint shows, still: no glow, no rise. No letter blips.
  assert.deepEqual((await glowState(quiet)).lit, phrases);
  assert.deepEqual(
    await quiet.$$eval(".title-ack-glow[data-lit]", (glows) => [
      ...new Set(
        glows.map(
          (glow) =>
            `${getComputedStyle(glow).transitionDuration} ${getComputedStyle(glow).textShadow}`,
        ),
      ),
    ]),
    ["0s none"],
  );
  await quiet.mouse.click(195, 10);
  await quiet.waitForSelector('.title-intro[data-phase="title"]');
  await quiet.waitForSelector(".title-ack", { state: "detached" });
  const stillLogo = await quiet.$eval(
    ".title-intro > img",
    (img) => getComputedStyle(img).transform,
  );
  assert.notEqual(stillLogo, "none");
  await cardShown(quiet);
  await quiet.waitForTimeout(300);
  assert.equal(
    await quiet.$eval(
      ".title-intro > img",
      (img) => getComputedStyle(img).transform,
    ),
    stillLogo,
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
  // Reduced motion settles without a flight or a travelling portrait.
  assert.equal(await quiet.locator(".title-intro .beat-ghost").count(), 0);
  await gone(quiet, 3000);
  await quiet.waitForSelector("#hand .card");
  assert.equal(await blips(quiet), 0, "reduced motion writes without blips");
  await reduced.close();
  await checkBlips();
  await checkLargeText();
  await checkTitleMusicAlone(browser, origin, shot);
  console.log(`Title intro smoke passed. Screenshots: ${shots.join(", ")}`);
} finally {
  await browser.close();
  server.close();
}
