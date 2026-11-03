import assert from "node:assert/strict";
import { dispatchShared } from "../card-game/shared-world.mjs";
import { humanAvatarIds } from "../card-game/human-cast.mjs";

// Room music never plays under the new-world title song. Rue joins a world
// she has played in, so her music has started: it waits for Wake and the
// song's fade. Vale's lamplit attic stays silent after Wake (#2061).
export async function checkTitleMusicAlone(browser, origin) {
  const world = dispatchShared({ op: "create" }).world;
  for (const [actor, started] of [
    ["rue", true],
    ["vale", false],
  ]) {
    const context = await browser.newContext({
      viewport: { width: 390, height: 844 },
    });
    await context.addInitScript(() => {
      if (!sessionStorage.getItem("seeded")) {
        sessionStorage.setItem("seeded", "1");
        localStorage.setItem("cosyworld.title-intro", "alone");
        localStorage.setItem("cosyworld.dialogue.sound", "off");
      }
      // Each play notes whether the other track was sounding at the time.
      window.__overlaps = [];
      const play = HTMLMediaElement.prototype.play;
      HTMLMediaElement.prototype.play = function () {
        const room = document.getElementById("room-music");
        if (/title-attic-lamp/.test(this.src)) window.__titleSong = this;
        const other = this === room ? window.__titleSong : room;
        if (other && !other.paused) window.__overlaps.push(this.id || "title");
        return play.call(this);
      };
    });
    await context.route("**/auth/account", (route) =>
      route.fulfill({ json: { authenticated: true } }),
    );
    await context.route("**/card-game/text", (route) => {
      const input = route.request().postDataJSON();
      return route.fulfill({
        json: {
          revision: input.revision,
          model: "title-fixture",
          entries: input.entities.map(({ id }) => ({ id, text: "Awake." })),
        },
      });
    });
    await context.route(
      "**/card-game/shared/worlds/alone{,/command}",
      (route) =>
        route.fulfill({
          json: {
            ...dispatchShared({
              op: "view",
              world,
              actor,
              claimed: humanAvatarIds,
              present: humanAvatarIds,
            }),
            id: "alone",
            actor,
            music_started: started,
            claimed: Array(8).fill(true),
            present: Array(8).fill(true),
            now: Date.now(),
            history: [],
            queue: [],
          },
        }),
    );
    const page = await context.newPage();
    page.setDefaultTimeout(15000);
    const roomPaused = () => page.$eval("#room-music", (a) => a.paused);
    await page.goto(`${origin}/?world=alone&intro=1`);
    await page.waitForSelector('.title-intro[data-phase="title"]');
    await page.waitForSelector("#hand .card", { state: "attached" });
    await page.mouse.click(195, 10);
    await page.waitForSelector(".title-wake");
    await page.waitForTimeout(500);
    assert.ok(await page.evaluate(() => !window.__titleSong.paused), actor);
    assert.ok(await roomPaused(), `${actor}: no room music under the title`);
    await page.locator(".title-wake").click();
    await page.waitForSelector(".title-intro", { state: "detached" });
    if (started)
      await page.waitForFunction(
        () => !document.getElementById("room-music").paused,
      );
    else {
      await page.waitForTimeout(1500);
      assert.ok(await roomPaused(), "the attic stays silent after Wake");
    }
    assert.deepEqual(await page.evaluate(() => window.__overlaps), [], actor);
    console.log(`${actor}: one track at a time through the title`);
    await context.close();
  }
}
