import assert from "node:assert/strict";
import { selectCard } from "./card-browser-helpers.mjs";
import { dispatchShared } from "../card-game/shared-world.mjs";
import { humanAvatars, humanAvatarIds } from "../card-game/human-cast.mjs";
import { places, things, people } from "../card-game/world.mjs";

// The real server tests cover the saved play journal. This fixture checks how
// the shipping browser uses its per-avatar music permission on each snapshot.
export async function checkSharedMusicOpenings(browser, origin) {
  let world = dispatchShared({ op: "create" }).world;
  const started = new Set();
  for (const [index, avatar] of humanAvatars.entries()) {
    const actor = avatar.id;
    const context = await browser.newContext({
      viewport: { width: index % 2 ? 390 : 1280, height: 844 },
      reducedMotion: "reduce",
    });
    const project = () =>
      dispatchShared({
        op: "view",
        world,
        actor,
        claimed: humanAvatarIds,
        present: humanAvatarIds,
      });
    const seen = [
      ...Object.keys(places),
      ...Object.keys(things),
      ...Object.keys(people),
    ];
    await context.addInitScript(
      ({ actor, seen }) => {
        const key = `cosyworld.reflected-shore.v1.shared.music-opening.${actor}`;
        localStorage.setItem(key + ".seen", JSON.stringify(seen));
        localStorage.setItem("cosyworld.dialogue.sound", "off");
        localStorage.setItem(
          "cosyworld.room-music",
          JSON.stringify({ enabled: true, volume: 0.18 }),
        );
      },
      { actor, seen },
    );
    await context.route("**/auth/account", (route) =>
      route.fulfill({ json: { authenticated: true } }),
    );
    await context.route(
      "**/card-game/shared/worlds/music-opening{,/command}",
      async (route) => {
        const command =
          route.request().method() === "POST"
            ? route.request().postDataJSON()
            : null;
        if (command?.op === "play") {
          const result = dispatchShared({
            op: "play",
            world,
            actor,
            action: command.action,
            claimed: humanAvatarIds,
            present: humanAvatarIds,
          });
          if (!result.ok) return route.fulfill({ status: 409, json: result });
          world = result.world;
          started.add(actor);
        }
        await route.fulfill({
          json: {
            ...project(),
            id: "music-opening",
            actor,
            music_started: started.has(actor),
            claimed: Array(8).fill(true),
            present: Array(8).fill(true),
            now: Date.now(),
            history: [],
            queue: [],
          },
        });
      },
    );
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    try {
      await page.goto(`${origin}/?world=music-opening`);
      await page
        .locator(`#hand [data-card="${avatar.item.id}"]`)
        .waitFor({ state: "attached" });
      await page.locator("#toolbar-menu-button").click();
      await page.locator("#menu-button").click();
      await page.locator("#music-toggle").click();
      await page.locator("#music-toggle").click();
      await page.evaluate(() => window.dispatchEvent(new Event("pageshow")));
      await page.waitForTimeout(1200);
      assert(
        await page
          .locator("#room-music")
          .evaluate((a) => a.paused && a.currentTime === 0),
        `${actor} begins silently at world turn ${world.turn}`,
      );
      assert.match(
        await page.locator("#music-status").textContent(),
        /first card/,
      );
      await page.locator('[data-close="menu-dialog"]').click();
      await selectCard(page, avatar.item.id);
      assert(
        await page.locator("#room-music").evaluate((a) => a.paused),
        "Selecting an item keeps the opening silent",
      );
      await page.locator("#card-actions .card-primary").click();
      await page.waitForFunction(() => {
        const a = document.querySelector("#room-music");
        return !a.paused && a.currentTime > 0;
      });
      assert(started.has(actor));
      await page.reload();
      await page.locator("#toolbar-menu-button").click();
      await page.locator("#menu-button").click();
      await page.waitForFunction(() => {
        const a = document.querySelector("#room-music");
        return !a.paused && a.currentTime > 0;
      });
      assert.deepEqual(errors, []);
      console.log(
        `${avatar.name}: silent arrival, first item play starts music, reload resumes`,
      );
    } catch (error) {
      console.error(
        actor,
        { turn: world.turn, started: [...started], errors },
        await page.evaluate(() => ({
          source: document.querySelector("#room-music")?.src,
          paused: document.querySelector("#room-music")?.paused,
          status: document.querySelector("#music-status")?.textContent,
          playStatus: document.querySelector("#play-status")?.textContent,
        })),
      );
      throw error;
    } finally {
      await context.close();
    }
  }
}
