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
const report = [];
try {
  const page = await browser.newPage();
  page.setDefaultTimeout(15000);
  const errors = [],
    responses = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("response", (r) => {
    if (r.url().includes(".m4a"))
      responses.push({
        status: r.status(),
        type: r.headers()["content-type"],
        range: r.headers()["content-range"],
      });
  });
  await page.route(`${origin}/`, (route) =>
    route.fulfill({
      contentType: "text/html",
      body: '<!doctype html><audio preload="none"></audio>',
    }),
  );
  await page.goto(origin);
  await page.evaluate(async () => {
    const { createRoomMusic } = await import("/card-game/music.mjs");
    window.audio = document.querySelector("audio");
    window.pick = 0;
    window.ends = 0;
    window.status = null;
    audio.addEventListener("ended", () => window.ends++);
    window.music = createRoomMusic({
      audio,
      random: () => window.pick,
      changed: (status) => {
        window.musicStatus = status;
      },
    });
    music.setStarted(true);
    music.setRoom("willows-camp", "night");
    music.unlock();
  });
  assert.equal(await page.evaluate(() => audio.getAttribute("src")), null);
  for (const [index, file] of [
    "willows-keep-to-bank-1.m4a",
    "willows-keep-to-bank-2.m4a",
    "willows-dont-answer-trees.m4a",
    "willows-keep-to-bank-3.m4a",
  ].entries()) {
    await page.evaluate((index) => {
      window.pick = index / 4;
      music.setRoom("willows-camp", "day");
      music.unlock();
    }, index);
    await page.waitForFunction(
      (file) =>
        audio.src.includes(file) &&
        !audio.paused &&
        audio.readyState >= 2 &&
        audio.duration > 30,
      file,
    );
    const before = await page.evaluate(() => ({
      src: audio.src,
      duration: audio.duration,
      title: musicStatus.title,
    }));
    assert(before.src.includes(file));
    assert(before.duration > 100);
    await page.evaluate(() => {
      audio.currentTime = 20;
    });
    await page.waitForFunction(() => audio.currentTime > 20.1);
    await page.evaluate(() => {
      music.setRoom("greek-harbor");
      music.setRoom("willows-bank", "night");
    });
    const following = await page.evaluate(() => ({
      src: audio.src,
      position: audio.currentTime,
      paused: audio.paused,
      title: musicStatus.title,
    }));
    assert.equal(following.src, before.src);
    assert.equal(following.title, before.title);
    assert(following.position >= 20);
    assert.equal(following.paused, false);
    await page.evaluate((index) => {
      if (index === 3) music.setRoom("willows-camp", "night");
      audio.currentTime = audio.duration - 0.4;
    }, index);
    await page.waitForFunction(
      (count) => window.ends === count && audio.paused,
      index + 1,
    );
    assert.equal(await page.evaluate(() => audio.src), before.src);
    report.push({
      file,
      seconds: before.duration,
      title: before.title,
      followedPlayer: true,
      reachedEnd: true,
    });
  }
  assert.deepEqual(errors, []);
  assert(responses.length >= 4);
  for (const response of responses) {
    assert([200, 206].includes(response.status));
    assert.equal(response.type, "audio/mp4");
  }
  await page.close();
  console.log(
    JSON.stringify({ passed: true, songs: report, responses }, null, 2),
  );
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
