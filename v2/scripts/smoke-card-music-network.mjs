import assert from "node:assert/strict";
import { chromium } from "playwright";
import { createServer } from "../card-game/serve.mjs";

const server = createServer();
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({
  headless: true,
  args: ["--autoplay-policy=no-user-gesture-required"],
});
const requests = [];
const responses = [];
const received = [];
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
try {
  const page = await browser.newPage({
    viewport: { width: 390, height: 844 },
  });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (url.pathname.endsWith(".mp3"))
      requests.push({
        file: url.pathname.split("/").at(-1),
        version: url.searchParams.get("v"),
        range: request.headers().range,
      });
  });
  page.on("response", (response) => {
    if (new URL(response.url()).pathname.endsWith(".mp3"))
      responses.push({
        status: response.status(),
        cache: response.headers()["cache-control"],
      });
  });
  await page.route(`${origin}/`, (route) =>
    route.fulfill({
      contentType: "text/html",
      body: '<!doctype html><audio id="room-music" preload="none"></audio>',
    }),
  );
  await page.goto(origin);
  await page.evaluate(async () => {
    const { createRoomMusic } = await import("/card-game/music.mjs");
    window.audio = document.querySelector("audio");
    window.playingAt = [];
    window.loads = 0;
    const load = audio.load.bind(audio);
    audio.load = () => {
      window.loads++;
      return load();
    };
    audio.addEventListener("playing", () => playingAt.push(performance.now()));
    window.music = createRoomMusic({ audio, random: () => 0.3 });
  });
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Network.enable");
  const mediaRequests = new Set();
  cdp.on("Network.requestWillBeSent", (event) => {
    if (new URL(event.request.url).pathname.endsWith(".mp3"))
      mediaRequests.add(event.requestId);
  });
  cdp.on("Network.dataReceived", (event) => {
    if (mediaRequests.has(event.requestId)) received.push(event.dataLength);
  });
  await cdp.send("Network.emulateNetworkConditions", {
    offline: false,
    latency: 120,
    downloadThroughput: 128 * 1024,
    uploadThroughput: 128 * 1024,
  });

  // Opening cards can unlock audio before the first play is accepted.
  await page.evaluate(() => {
    music.setRoom("attic");
    music.unlock();
  });
  await delay(2000);
  assert.equal(
    requests.length,
    0,
    "The first play controls the music request.",
  );
  assert.equal(received.length, 0);

  await page.evaluate(() => {
    music.setEnabled(false);
    music.setStarted(true);
    music.setRoom("pond");
    music.unlock();
  });
  await delay(2000);
  assert.equal(requests.length, 0, "Muted travel keeps media requests quiet.");

  const start = await page.evaluate(() => {
    const time = performance.now();
    music.setEnabled(true);
    return time;
  });
  await page.waitForFunction(() => playingAt.length === 1, null, {
    timeout: 60000,
  });
  const firstPlayReadyMs = await page.evaluate(
    (start) => Math.round(playingAt[0] - start),
    start,
  );
  assert.equal(requests[0].file, "pond-1.mp3");
  assert.match(requests[0].version, /^[a-f0-9]{64}$/);
  assert.match(requests[0].range, /^bytes=/);

  await page.evaluate(() => music.setHidden(true));
  await delay(1200);
  const beforeHiddenTravel = requests.length;
  await page.evaluate(() => music.setRoom("greek-ship"));
  await delay(2000);
  assert.equal(
    requests.length,
    beforeHiddenTravel,
    "A hidden destination waits for the reader to return.",
  );
  await page.evaluate(() => music.setHidden(false));
  await page.waitForFunction(() => playingAt.length === 2, null, {
    timeout: 60000,
  });
  assert.equal(requests.at(-1).file, "ship-2.mp3");
  await delay(1200);
  const source = await page.evaluate(() => audio.src);
  const beforeReplay = requests.length;
  const loads = await page.evaluate(() => window.loads);
  await page.evaluate(() => music.setRoom("greek-harbor"));
  await delay(200);
  await page.evaluate(() => music.setRoom("greek-ship"));
  await page.waitForFunction(() => playingAt.length === 3, null, {
    timeout: 60000,
  });
  await delay(1200);
  assert.equal(await page.evaluate(() => audio.src), source);
  assert.equal(await page.evaluate(() => window.loads), loads);
  assert.equal(requests.length, beforeReplay);
  assert.deepEqual(errors, []);
  console.log(
    JSON.stringify({
      firstPlayReadyMs,
      beforeFirstPlayRequests: 0,
      mutedDestinationRequests: 0,
      hiddenDestinationRequests: 0,
      bufferedReplayRequests: requests.length - beforeReplay,
      bufferedReplayLoads: (await page.evaluate(() => window.loads)) - loads,
      requests,
      responses,
      receivedBytes: received.reduce((sum, bytes) => sum + bytes, 0),
      browserErrors: errors.length,
    }),
  );
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
