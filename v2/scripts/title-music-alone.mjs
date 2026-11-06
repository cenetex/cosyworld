import assert from "node:assert/strict";
import { dispatchShared } from "../card-game/shared-world.mjs";
import { humanAvatarIds } from "../card-game/human-cast.mjs";

export const traveller = ".title-card .card";
export async function finishAcknowledgement(page) {
  for (
    let i = 0;
    i < 6 && (await page.locator(".title-ack[data-stream]").count());
    i++
  )
    await page.keyboard.press("Enter");
  await page.waitForSelector(".title-ack[data-written]");
}
export const cardShown = async (page) => {
  await page.waitForSelector(traveller);
  assert.equal(await page.getAttribute(".title-privacy", "href"), "/privacy");
  await page.waitForFunction(
    (selector) =>
      document.activeElement === document.querySelector(selector) &&
      document.activeElement.ariaLabel === "Take the box" &&
      document.activeElement.dataset.unrevealed === "true",
    traveller,
  );
};
// The card turns to the avatar's face, named for screen readers too.
export const revealed = (page, name) =>
  page.waitForFunction(
    ([selector, name]) => {
      const card = document.querySelector(selector);
      return (
        card?.dataset.unrevealed === "false" &&
        card.ariaLabel === name &&
        card.querySelector(".name")?.textContent === name &&
        card.querySelector(".art img")?.complete
      );
    },
    [traveller, name],
  );

// Room music never plays under the new-world title song. Rue joins a world
// she has played in, so her music has started: it waits for her card's
// reveal and the song's fade. Vale's lamplit attic stays silent (#2061).
export async function checkTitleMusicAlone(browser, origin, shot) {
  const world = dispatchShared({ op: "create" }).world;
  for (const [actor, started, width, height] of [
    ["rue", true, 1440, 900],
    ["vale", false, 1440, 900],
    ["rue", true, 390, 844],
    ["vale", false, 390, 844],
  ]) {
    const context = await browser.newContext({
      viewport: { width, height },
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
    await page.waitForSelector('.title-intro[data-phase="ack"] .title-ack');
    await page.waitForSelector("#hand .card", { state: "attached" });
    await finishAcknowledgement(page);
    await page.mouse.click(width / 2, 10);
    await cardShown(page);
    await page.waitForTimeout(1000);
    assert.ok(await page.evaluate(() => !window.__titleSong.paused), actor);
    assert.ok(await roomPaused(), `${actor}: no room music under the title`);
    await shot(page, `${actor}-card-${width}`);
    await page.keyboard.press("Space");
    const name = actor === "rue" ? "Rue" : "Vale";
    await revealed(page, name);
    await page.waitForTimeout(width > 640 ? 300 : 100);
    await shot(page, `${actor}-face-${width}`);
    assert.ok(await roomPaused(), `${actor}: none while the card turns`);
    await page.waitForSelector(".title-intro", { state: "detached" });
    // The title's turn was the joining avatar's reveal: no second flip.
    await page.waitForSelector(
      `#hand .card[data-card="${actor}"][data-unrevealed="false"]`,
    );
    assert.equal(await page.locator("#hand .reveal-lid").count(), 0);
    if (started)
      await page.waitForFunction(
        () => !document.getElementById("room-music").paused,
      );
    else {
      await page.waitForTimeout(1500);
      assert.ok(await roomPaused(), "the attic stays silent after the title");
    }
    await shot(page, `${actor}-game-${width}`);
    assert.deepEqual(await page.evaluate(() => window.__overlaps), [], actor);
    console.log(`${actor}: one track at a time through the title`);
    await context.close();
  }
}
