import assert from "node:assert/strict";
import { chromium } from "playwright";
import { createServer } from "../card-game/serve.mjs";
const server = createServer();
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
const browser = await chromium.launch({ headless: true });
try {
  for (const width of [1280, 390]) {
    const page = await browser.newPage({ viewport: { width, height: 844 } });
    await page.route("**/radio-test", route => route.fulfill({ contentType: "text/html", body: "<!doctype html><body></body>" }));
    await page.goto(`http://127.0.0.1:${server.address().port}/radio-test`);
    await page.evaluate(async () => {
      // A synthetic harness only: no owner save, dialogue service or world writes.
      document.body.replaceChildren();
      const { createRadioPlayer } = await import("/card-game/radio-player.mjs");
      const audio = new Audio(), context = new AudioContext(), analyser = context.createAnalyser();
      const createGain = context.createGain.bind(context);
      context.createGain = () => { const gain = createGain(); gain.connect(analyser); return gain; };
      window.radioTest = { audio, context, analyser, player: createRadioPlayer({ audio, makeContext: () => context }) };
      const button = document.createElement("button"); button.textContent = "Listen";
      button.onclick = () => { radioTest.player.setStarted(true); radioTest.player.setActive(true); radioTest.player.unlock(); };
      document.body.append(button);
    });
    await page.getByText("Listen", { exact: true }).click();
    await page.waitForFunction(() => !radioTest.audio.paused && radioTest.audio.currentTime > 0);
    await page.waitForFunction(() => { const values = new Float32Array(2048); radioTest.analyser.getFloatTimeDomainData(values); return values.some(v => Math.abs(v) > 0.001); });
    await page.evaluate(() => radioTest.context.suspend());
    await page.waitForFunction(() => radioTest.context.state === "running");
    const evidence = await page.evaluate(async () => {
      const { audio, player } = radioTest;
      const station = await fetch("/card-game/radio").then(r => r.json());
      const before = { file: audio.src, position: audio.currentTime, expected: (station.serverTimeMs - station.startedAtMs) / 1000, context: radioTest.context.state };
      player.setEnabled(false); before.muted = audio.paused;
      player.setEnabled(true); return before;
    });
    assert(evidence.file.includes("/assets/")); assert(evidence.muted);
    assert(Math.abs(evidence.position - evidence.expected) < 1.5, JSON.stringify(evidence));
    await page.waitForFunction(() => !radioTest.audio.paused);
    await page.evaluate(() => radioTest.player.setHidden(true));
    assert(await page.evaluate(() => radioTest.audio.paused));
    await page.evaluate(() => radioTest.player.setHidden(false));
    await page.waitForFunction(() => !radioTest.audio.paused);
    await page.evaluate(() => radioTest.player.setActive(false));
    assert(await page.evaluate(() => radioTest.audio.paused));
    console.log(JSON.stringify({ width, ...evidence, decodedSignal: true }));
    await page.close();
  }
} finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
