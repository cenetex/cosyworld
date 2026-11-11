import assert from "node:assert/strict";
import { chromium } from "playwright";
import { createServer } from "../card-game/serve.mjs";
import { createWorld, encodeSave } from "../card-game/world.mjs";
import { availableCards } from "../card-game/cards.mjs";
import { clearSelection, revealCard, tapCard, readyActionButton, openSettings, pressSetting, closeSettings } from "./card-browser-helpers.mjs";
const radio = "ratiradio-portable-radio", booth = "ratiradio-broadcast-booth", home = "ratiradio-listening-room";
// Synthetic booth arrival: no claim to have earned the station's story gates.
const start = createWorld({ seed: 17 });
start.actors.vale.place = booth;
start.actors.vale.visited.push(booth);
for (const item of Object.values(start.items)) if (item.holder === "vale") item.holder = "attic";
const server = createServer();
await new Promise(done => server.listen(0, "127.0.0.1", done));
const browser = await chromium.launch({ headless: true, executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE });
try {
  for (const width of [1440, 390]) {
    const page = await browser.newPage({ viewport: { width, height: 900 }, hasTouch: width < 700 });
    page.setDefaultTimeout(30000);
    const key = `cosyworld.reflected-shore.v1.receiver-${width}`, errors = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.addInitScript(({ key, save, seen }) => {
      if (!localStorage.getItem(key)) {
        localStorage.setItem(key, save);
        localStorage.setItem(`${key}.seen`, JSON.stringify(seen));
        localStorage.setItem("cosyworld.room-music", JSON.stringify({ enabled: true, volume: 0.2 }));
      }
      // The existing booth cue has already been heard; isolate the receiver.
      localStorage.setItem(`cosyworld.performance:local:${key}:17:vale:ratiradio`, "1");
      localStorage.setItem("cosyworld.dialogue.sound", "off");
      window.receivers = []; window.stationRequests = 0;
      const fetch = window.fetch.bind(window);
      window.fetch = async (...args) => {
        const began = performance.now();
        if (String(args[0]).endsWith("/card-game/radio")) window.stationRequests++;
        const response = await fetch(...args), received = performance.now();
        if (String(args[0]).endsWith("/card-game/radio")) {
          const station = await response.clone().json(), original = `assets/music/${station.track.file}`;
          const { default: streams } = await import("/card-game/music-streams.json", { with: { type: "json" } });
          const { mediaUrl } = await import("/card-game/media.mjs");
          window.stationAt = (began + received) / 2;
          window.station = station; window.radioUrl = mediaUrl(streams[original]?.file || original);
        }
        return response;
      };
      const Context = window.AudioContext;
      window.AudioContext = function (...args) {
        const context = new Context(...args), entry = { context };
        const gain = context.createGain.bind(context), source = context.createMediaElementSource.bind(context);
        context.createGain = () => { const node = gain(); entry.analyser = context.createAnalyser(); node.connect(entry.analyser); return node; };
        context.createMediaElementSource = audio => { entry.audio = audio; window.receivers.push(entry); return source(audio); };
        return context;
      };
      window.AudioContext.prototype = Context.prototype;
    }, { key, save: encodeSave(start), seen: availableCards(start) });
    await page.route("**/card-game/text", route => {
      const input = route.request().postDataJSON();
      return route.fulfill({ json: { revision: input.revision, model: "synthetic-radio-qa", entries: input.entities.map(({ id }) => ({ id, text: "The receiver rests here." })) } });
    });
    const state = () => page.evaluate(key => JSON.parse(localStorage.getItem(key)), key);
    const ready = async () => {
      for (let i = 0; i < 400; i++) {
        if (await page.locator("#hand").getAttribute("data-cooling") === "false") return;
        if (await page.locator("#dialogue-advance").isVisible() && !await page.locator("#action-beat").isVisible()) await page.locator("#dialogue-advance").click();
        await page.waitForTimeout(50);
      }
      throw new Error("Dialogue did not finish");
    };
    const act = async (kind, ids) => {
      await ready(); await clearSelection(page);
      for (const id of ids) {
        const card = await revealCard(page, id);
        if (await card.getAttribute("aria-pressed") !== "true") await tapCard(card);
      }
      const revision = (await state()).revision;
      await readyActionButton(page, kind).click();
      await page.waitForFunction(({ key, revision }) => JSON.parse(localStorage.getItem(key)).revision > revision, { key, revision });
    };
    const sounding = () => page.waitForFunction(() => {
      const matches = receivers.filter(entry => entry.audio.id !== "room-music" && entry.audio.src === window.radioUrl);
      if (matches.length !== 1) return false;
      const entry = matches[0];
      if (!entry || entry.audio.paused || !entry.analyser) return false;
      window.receiver = entry;
      const { audio, analyser } = entry;
      // 750ms controller seek threshold plus browser scheduling/headroom.
      const expected = (station.serverTimeMs - station.startedAtMs + performance.now() - stationAt) / 1000;
      if (Math.abs(audio.currentTime - expected) > 1.5) return false;
      const values = new Float32Array(analyser.fftSize); analyser.getFloatTimeDomainData(values);
      return values.some(value => Math.abs(value) > 0.001);
    });
    await page.goto(`http://127.0.0.1:${server.address().port}/?table=receiver-${width}`);
    await page.locator("#hand").waitFor();
    assert.equal((await state()).items[radio].radioOn, undefined);
    await act("take", [radio]); await ready();
    assert.equal(await page.evaluate(() => receivers.some(entry => entry.audio.id !== "room-music" && !entry.audio.paused)), false, "Booth cue is suppressed before receiver activation");
    await act("radio", [radio]);
    assert.equal((await state()).items[radio].radioOn, true);
    await sounding();
    const source = await page.evaluate(() => receiver.audio.src);
    assert.equal(source, await page.evaluate(() => radioUrl));
    await act("radio", [radio]);
    assert.equal((await state()).items[radio].radioOn, false);
    await page.waitForFunction(() => receiver.audio.paused);
    await act("radio", [radio]); await sounding();
    await page.reload();
    await page.waitForFunction(key => document.querySelector("#hand")?.dataset.presentedRevision === String(JSON.parse(localStorage.getItem(key)).revision), key);
    await page.waitForTimeout(1000);
    assert.equal(await page.evaluate(() => stationRequests), 0, "No station request before a gesture");
    assert.equal(await page.evaluate(() => receivers.some(entry => entry.audio.id !== "room-music" && !entry.audio.paused)), false);
    assert.equal((await state()).items[radio].radioOn, true);
    assert.equal(await page.evaluate(() => receivers.some(entry => entry.audio.src === window.radioUrl && !entry.audio.paused)), false);
    await page.keyboard.press("Shift"); await sounding();
    await ready(); await openSettings(page);
    await pressSetting(page, "music");
    await page.waitForFunction(() => (!window.receiver || receiver.audio.paused));
    await pressSetting(page, "music"); await closeSettings(page); await sounding();
    await act("drop", [radio, booth]);
    await act("move", [home]);
    await page.waitForFunction(() => (!window.receiver || receiver.audio.paused));
    await page.reload(); await page.locator("#hand").waitFor();
    assert.equal((await state()).items[radio].radioOn, true);
    assert.equal((await state()).items[radio].holder, booth);
    assert.equal(await page.evaluate(() => receivers.some(entry => entry.audio.src === window.radioUrl && !entry.audio.paused)), false);
    assert.deepEqual(errors, []);
    console.log(JSON.stringify({ width, source, pickup: true, signal: true, mute: true, dropped: true, distantReloadSilent: true }));
    await page.close();
  }
} finally { await browser.close(); await new Promise(done => server.close(done)); }
