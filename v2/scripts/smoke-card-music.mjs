import { checkSharedMusicOpenings } from "./shared-music-openings.mjs";
import { clearSelection, selectCard } from "./card-browser-helpers.mjs";
import assert from "node:assert/strict";
import { chromium } from "playwright";
import { createServer } from "../card-game/serve.mjs";
import { roomTracks } from "../card-game/music.mjs";
import streams from "../card-game/music-streams.json" with { type: "json" };
import { createWorld, encodeSave, play } from "../card-game/world.mjs";
import { cardPlay } from "../card-game/cards.mjs";

const server = createServer();
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({
    viewport: { width: 1280, height: 800 },
  });
  page.setDefaultTimeout(15_000);
  await page.addInitScript(() => {
    window.musicStops = [];
    const connect = MediaElementAudioSourceNode.prototype.connect;
    MediaElementAudioSourceNode.prototype.connect = function (node, ...args) {
      if (this.mediaElement.id === "room-music") window.musicGain = node;
      return connect.call(this, node, ...args);
    };
    for (const method of ["pause", "load"]) {
      const original = HTMLMediaElement.prototype[method];
      HTMLMediaElement.prototype[method] = function (...args) {
        if (this.id === "room-music")
          window.musicStops.push({
            method,
            level: window.musicGain?.gain.value || 0,
            source: this.src,
            position: this.currentTime,
            ended: this.ended,
          });
        return original.apply(this, args);
      };
    }
  });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  // Exercise the toolbar while the chosen game module is still loading.
  await page.route("**/card-game/app.mjs", async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 1000));
    await route.continue();
  });
  await page.route("**/card-game/text", (route) =>
    route.fulfill({
      status: 503,
      contentType: "application/json",
      body: '{"error":"Story service paused for local check."}',
    }),
  );
  await page.goto(
    `http://127.0.0.1:${server.address().port}/?table=music-smoke`,
  );
  console.log("Loaded card table");
  async function playCard(card) {
    await page.waitForFunction(
      () => document.querySelector("#hand").dataset.cooling === "false",
    );
    await selectCard(page, card);
    await page.locator("#card-actions .card-primary").click();
  }
  // A new game stays quiet, menu included, until its first accepted card play.
  await page.locator("#toolbar-menu-button").click();
  await page.locator("#menu-button").click();
  await page.waitForTimeout(500);
  assert(await page.locator("#room-music").evaluate((audio) => audio.paused));
  await page.locator('[data-close="menu-dialog"]').click();
  // Dousing the lit lamp starts the attic music and reveals the pond path.
  await playCard("lamp");
  await page.waitForFunction(() =>
    document.querySelector('#hand [data-card="pond"]'),
  );
  await page.waitForFunction((file) => {
    const audio = document.querySelector("#room-music");
    return new URL(audio.src).pathname.endsWith(file) && audio.currentTime > 0;
  }, roomTracks.attic[0].file);
  await playCard("pond");
  // The attic song follows the player to the pond until it ends.
  await page.waitForFunction(() => document.body.dataset.place === "pond");
  assert(
    new URL(
      await page.locator("#room-music").evaluate((audio) => audio.src),
    ).pathname.endsWith(roomTracks.attic[0].file),
  );
  await page.locator("#room-music").evaluate((audio) => {
    audio.currentTime = audio.duration - 1.25;
  });
  await page.waitForFunction((file) => {
    const audio = document.querySelector("#room-music");
    return new URL(audio.src).pathname.endsWith(file) && audio.currentTime > 0;
  }, roomTracks.pond[0].file);
  await page.locator("#toolbar-menu-button").click();
  await page.locator("#menu-button").click();
  let volume = 0.3;
  const fullVolume = () =>
    page.waitForFunction(
      (volume) => Math.abs(window.musicGain.gain.value - volume) < 0.002,
      volume,
    );
  await fullVolume();
  // An ended song is silent while the audio clock settles its final frame.
  const unexpectedStops = () =>
    page.evaluate(() =>
      window.musicStops.filter(
        (stop, index, stops) =>
          stop.level >= 0.003 &&
          !stop.ended &&
          !(stop.method === "load" && stops[index - 1]?.ended),
      ),
    );

  async function checkPlaylist(room) {
    await page.waitForFunction(
      (tracks) =>
        tracks.some(({ file }) =>
          document.querySelector("#room-music").src.includes(file),
        ),
      roomTracks[room],
    );
    const source = await page.locator("#room-music").getAttribute("src");
    const start = roomTracks[room].findIndex(({ file }) =>
      source.includes(file),
    );
    const ordered = [
      ...roomTracks[room].slice(start),
      ...roomTracks[room].slice(0, start),
    ];
    for (const [index, track] of ordered.entries()) {
      await page.waitForFunction((file) => {
        const audio = document.querySelector("#room-music");
        return (
          new URL(audio.src).pathname.endsWith(file) &&
          audio.currentTime > 0 &&
          !audio.paused &&
          Number.isFinite(audio.duration)
        );
      }, track.file);
      await fullVolume();
      const duration = await page.locator("#room-music").evaluate((audio) => {
        const duration = audio.duration;
        audio.currentTime = duration - 1.25;
        return duration;
      });
      assert(
        duration > 30,
        `${room} track ${index + 1} has a decoded duration`,
      );
      await page.waitForFunction((volume) => {
        const level = window.musicGain.gain.value;
        return level > 0.01 && level < volume - 0.02;
      }, volume);
    }
    await page.waitForFunction(
      (file) =>
        new URL(document.querySelector("#room-music").src).pathname.endsWith(
          file,
        ),
      ordered[0].file,
    );
  }
  await checkPlaylist("pond");
  console.log("Pond opening tracks played");
  await page.locator("#music-volume").evaluate((input) => {
    input.value = "18";
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  volume = 0.18;
  await fullVolume();
  await page.locator('[data-close="menu-dialog"]').click();

  async function travel(room, card = room, check = () => checkPlaylist(room)) {
    await fullVolume();
    const oldSource = await page.locator("#room-music").getAttribute("src");
    await playCard(card);
    assert.equal(
      await page.locator("#room-music").getAttribute("src"),
      oldSource,
    );
    assert(await page.evaluate(() => window.musicGain.gain.value > 0));
    await page.waitForFunction(
      (room) => document.body.dataset.place === room,
      room,
    );
    await fullVolume();
    assert.equal(
      await page.locator("#room-music").getAttribute("src"),
      oldSource,
    );
    await page.locator("#room-music").evaluate((audio) => {
      audio.currentTime = audio.duration - 1.25;
    });
    await page.waitForFunction((volume) => {
      const level = window.musicGain.gain.value;
      return level > 0.01 && level < volume - 0.02;
    }, volume);
    await page.waitForFunction(
      (tracks) =>
        tracks.some(({ file }) =>
          new URL(document.querySelector("#room-music").src).pathname.endsWith(
            file,
          ),
        ),
      roomTracks[room],
    );
    await check();
  }
  // The mirror trip checks the attic playlist and the way back: the lamp
  // lit at the pond opens the way up, and dousing it opens the way down.
  // The doused lamp stays raised after its play; lower it before each step.
  await clearSelection(page);
  await playCard("lamp");
  await clearSelection(page);
  await travel("attic");
  console.log("Attic tracks played");
  await clearSelection(page);
  await playCard("lamp");
  await clearSelection(page);
  await travel("pond");
  console.log("Pond tracks played");
  await travel("station");
  console.log("Station tracks played");
  await playCard("moth");
  await fullVolume();
  await page.evaluate(() => window.dispatchEvent(new Event("pagehide")));
  assert(await page.locator("#room-music").evaluate((audio) => !audio.paused));
  await page.waitForFunction(
    () => document.querySelector("#room-music").paused,
  );
  await page.evaluate(() => window.dispatchEvent(new Event("pageshow")));
  await page.waitForFunction(
    () => !document.querySelector("#room-music").paused,
  );
  await page.locator("#toolbar-menu-button").click();
  await page.locator("#menu-button").click();
  await fullVolume();
  await page.locator("#music-toggle").click();
  assert(await page.locator("#room-music").evaluate((audio) => !audio.paused));
  await page.waitForFunction(
    () => document.querySelector("#room-music").paused,
  );
  assert.deepEqual(
    await unexpectedStops(),
    [],
    "Active songs fade before a pause",
  );
  await page.reload();
  await page.locator("#toolbar-menu-button").click();
  await page.locator("#menu-button").click();
  assert.equal(
    await page.locator("#music-toggle").getAttribute("aria-pressed"),
    "false",
  );
  assert.equal(await page.locator("#music-volume").inputValue(), "18");
  assert(await page.locator("#room-music").evaluate((audio) => audio.paused));
  await page.locator("#music-toggle").click();
  await page.waitForFunction(
    () => !document.querySelector("#room-music").paused,
  );
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator("#music-volume").scrollIntoViewIfNeeded();
  assert(await page.locator("#music-volume").isVisible());
  assert(await page.locator("#music-toggle").isVisible());
  await fullVolume();
  await page.locator("#music-toggle").click();
  assert(await page.locator("#room-music").evaluate((audio) => !audio.paused));
  await page.waitForFunction(
    () => document.querySelector("#room-music").paused,
  );
  await page.locator("#music-toggle").click();
  await fullVolume();
  await page.screenshot({ path: "output/music/shore-room-mobile.png" });

  // Complete the authored signal, then use the real Board and Disembark cards.
  let ship = createWorld({ opening: true });
  // Keep the music fixture's ship trip separate from the bard's first voyage.
  ship.actors["greek-rhapsode"].place = "attic";
  ship.opening.crossed = true;
  ship.opening.met.moth = 0;
  ship.locations.attic.anchored = true;
  ship.actors.vale.place = "pond";
  ship.actors.moth.place = ship.actors.keeper.place = "station";
  ship.items.lamp.holder = ship.items.cloth.holder = "vale";
  ship.items.lamp.lit = true;
  ship.items.lamp.fuel = 12;
  // Cover, then uncover, the lit lamp: the whole ship signal.
  for (const cards of [["cloth", "lamp"], ["cloth"]]) {
    const result = play(ship, cardPlay(ship, cards).action);
    assert(result.ok, result.error);
    ship = result.state;
  }
  await page.evaluate((save) => {
    localStorage.setItem("cosyworld.reflected-shore.v1.music-smoke", save);
  }, encodeSave(ship));
  await page.reload();
  await page.locator("#toolbar-menu-button").click();
  await page.locator("#menu-button").click();
  await fullVolume();
  assert.equal(await page.locator("#music-volume").inputValue(), "18");
  await page.locator('[data-close="menu-dialog"]').click();

  async function checkCrossingSong() {
    await page.waitForFunction((tracks) => {
      const audio = document.querySelector("#room-music");
      return (
        tracks.some(({ file }) => new URL(audio.src).pathname.endsWith(file)) &&
        audio.currentTime > 0 &&
        !audio.paused &&
        Number.isFinite(audio.duration)
      );
    }, roomTracks["greek-ship"]);
    await fullVolume();
    await page.locator("#room-music").evaluate((audio) => {
      audio.currentTime = audio.duration - 1.25;
    });
    await page.waitForFunction((volume) => {
      const level = window.musicGain.gain.value;
      return level > 0.01 && level < volume - 0.02;
    }, volume);
    await page.waitForFunction((tracks) => {
      const audio = document.querySelector("#room-music");
      return (
        tracks.some(({ file }) => audio.src.includes(file)) &&
        audio.currentTime < 2 &&
        !audio.paused
      );
    }, roomTracks["greek-ship"]);
    await fullVolume();
    const activeSource = await page.locator("#room-music").getAttribute("src");
    await playCard("greek-ship");
    await fullVolume();
    assert.equal(
      await page.locator("#room-music").getAttribute("src"),
      activeSource,
    );
  }
  // Aboard, the port card sets the course and the ship card waits out the
  // round at sea; the deck song keeps playing until Disembark.
  const voyage = async (port) => {
    const source = await page.locator("#room-music").getAttribute("src");
    await playCard(port);
    await playCard("greek-ship");
    assert.equal(await page.locator("#room-music").getAttribute("src"), source);
  };
  await travel("greek-ship", "greek-ship", checkCrossingSong);
  await voyage("greek-harbor");
  await travel("greek-harbor");
  await travel("greek-ship", "greek-ship", checkCrossingSong);
  await voyage("pond");
  await travel("pond");
  // Check decoding for every candidate, including songs chance did not select.
  const tracks = Object.values(roomTracks)
    .flat()
    .map((track) => ({
      ...track,
      url: `/card-game/${streams[`assets/music/${track.file}`]?.file || `assets/music/${track.file}`}`,
    }));
  const decoded = await page.evaluate(async (tracks) => {
    const results = [];
    for (const { file, url } of tracks) {
      const probe = new Audio(url);
      probe.muted = true;
      try {
        await probe.play();
        results.push({ file, duration: probe.duration });
      } finally {
        probe.pause();
        probe.removeAttribute("src");
        probe.load();
      }
    }
    return results;
  }, tracks);
  assert.equal(decoded.length, tracks.length);
  assert(
    decoded.every(({ duration }) => Number.isFinite(duration) && duration > 30),
  );
  const loudStops = await unexpectedStops();
  assert.deepEqual(
    loudStops,
    [],
    "Songs finish their fade before the next room starts music",
  );
  await page.locator("#toolbar-menu-button").click();
  await page.locator("#avatar-move").click();
  await page.locator("#avatar-new-world").click();
  await page.locator("#confirm-reset").click();
  assert(await page.locator("#room-music").evaluate((audio) => audio.paused));
  await page.reload();
  await page.locator("#toolbar-menu-button").click();
  await page.locator("#menu-button").click();
  await page.locator("#music-toggle").click();
  await page.locator("#music-toggle").click();
  await page.waitForTimeout(1200);
  assert(await page.locator("#room-music").evaluate((audio) => audio.paused));
  assert.deepEqual(errors, []);
  await checkSharedMusicOpenings(
    browser,
    `http://127.0.0.1:${server.address().port}`,
  );
  console.log(
    `Room music: all ${tracks.length} tracks decoded. Songs followed travel until their end. Room playlists, saved controls and the mobile menu passed.`,
  );
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
