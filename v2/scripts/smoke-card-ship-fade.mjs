// The Greek ship docking where the player waits fades in: the ship painted
// over Black Pond and the berth at the Wine-Dark Harbor. Its card folds into
// the ways stack. It fades out as it sails, and nothing is left holding a
// style or blocking a click.
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { chromium } from "playwright";
import { createServer } from "../card-game/serve.mjs";
import { decodeSave, encodeSave } from "../card-game/world.mjs";
import { profiles } from "../card-game/memory.mjs";
import { summonTransport } from "../card-game/pack-transport.mjs";
import { openDoorStart } from "../../test/helpers/open-door.mjs";
import {
  readyActionButton,
  revealCard,
  selectCard,
} from "./card-browser-helpers.mjs";

const output = new URL("../../output/ship-fade/", import.meta.url);
await mkdir(output, { recursive: true });
const server = createServer();
await new Promise((done) => server.listen(0, "127.0.0.1", done));
const origin = `http://127.0.0.1:${server.address().port}`;
let browser;
try {
  browser = await chromium.launch({ headless: true });
  for (const [place, away, topWay] of [
    ["pond", "greek-harbor", "station"],
    ["greek-harbor", "pond", "greek-road-thebes"],
  ]) {
    const table = `ship-fade-${place}`;
    const key = `cosyworld.reflected-shore.v1.${table}`;
    const fixture = openDoorStart();
    fixture.playerActorId = "mara";
    fixture.sharedVersion = 1;
    fixture.controlledActors = ["vale", "mara"];
    fixture.presentActors = ["mara"];
    fixture.actors.mara.place = place;
    // The Open Door fixture can catch the ship at sea with the Bard aboard,
    // bound for the harbor. Land its riders there and dock the empty ship at
    // the far port through the rules: setting only `dock` leaves a ship at
    // sea already at its destination, which the save check rejects, and the
    // page then plays a fresh world instead.
    for (const a of Object.values(fixture.actors))
      if (a.place === "greek-ship") a.place = "greek-harbor";
    // Residents never call the ship away from a human at its dock, so it
    // leaves the harbor only when a resident boards. Seed the Bard there,
    // bound for the shore.
    if (place === "greek-harbor")
      Object.assign(fixture.actors["greek-rhapsode"], {
        place,
        want: {
          kind: "place",
          target: "pond",
          since: fixture.turn,
          refusals: 0,
        },
      });
    summonTransport(fixture, "greek-ship", away);
    assert.equal(fixture.transports["greek-ship"].dock, away);
    decodeSave(encodeSave(fixture));
    const page = await browser.newPage({
      viewport: { width: 1280, height: 800 },
    });
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.addInitScript(
      ({ key, save, seen }) => {
        if (!localStorage.getItem(key)) localStorage.setItem(key, save);
        localStorage.setItem(`${key}.seen`, JSON.stringify(seen));
        localStorage.setItem("cosyworld.dialogue.sound", "off");
        localStorage.setItem(
          "cosyworld.room-music",
          JSON.stringify({ enabled: false }),
        );
      },
      { key, save: encodeSave(fixture), seen: Object.keys(profiles) },
    );
    await page.route("**/card-game/text", (route) => {
      const input = route.request().postDataJSON();
      route.fulfill({
        json: {
          revision: input.revision,
          model: "ship-fade-fixture",
          entries: input.entities.map(({ id }) => ({ id, text: "Hm." })),
        },
      });
    });
    const ship = () =>
      page.evaluate((key) => {
        const t = JSON.parse(localStorage.getItem(key)).transports[
          "greek-ship"
        ];
        return { dock: t.phase === "sea" ? null : t.dock };
      }, key);
    // Samples every frame after a play, until the play has rendered and its
    // fades have settled: the opacity each layer showed. Slow CI renderers
    // draw few frames, so check for a mid-fade sample, not a count.
    const watch = () =>
      page.evaluate(() => {
        const seen = (window.__fade = {
          overlay: [],
          card: [],
          ghost: [],
          stop: false,
        });
        const tick = () => {
          const overlay = document.querySelector("#location-overlay");
          if (overlay && !overlay.hidden)
            seen.overlay.push(+getComputedStyle(overlay).opacity);
          const card = document
            .querySelector('#hand [data-card="greek-ship"]')
            ?.closest(".card-frame");
          if (card && !card.hidden)
            seen.card.push(+getComputedStyle(card).opacity);
          const ghost = document.querySelector(".backdrop-fading");
          if (ghost) seen.ghost.push(+getComputedStyle(ghost).opacity);
          if (!seen.stop) requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      });
    const snapshot = () => page.evaluate((key) => {
      const image = document.querySelector("#backdrop");
      return {
        saved: JSON.parse(localStorage.getItem(key))?.revision,
        shown: document.querySelector("#hand")?.dataset.presentedRevision,
        src: image?.getAttribute("src"), complete: image?.complete,
        naturalWidth: image?.naturalWidth,
        bodySleep: document.body.dataset.sleep ?? null,
        stageSleep: document.querySelector("#stage")?.dataset.sleep ?? null,
      };
    }, key);
    const wait = async () => {
      await page.keyboard.press("Escape");
      await selectCard(page, "mara");
      const shown = await page
        .locator("#hand")
        .getAttribute("data-presented-revision");
      const before = await snapshot();
      await watch();
      // Selecting Mara starts her action sentence. Its first tap while
      // revealing finishes the words; only a ready button plays Wait.
      await readyActionButton(page, "wait").first().click();
      // Settled: the hand shows the play's revision, the overlay has no fade
      // running or waiting on its image (fadeLayer holds opacity 0 inline
      // while it decodes), and no berth crossfade ghost remains.
      // Bounded, so a play that never renders or a fade that never ends
      // fails here with its reason instead of holding the CI shard.
      await page
        .waitForFunction(
          (shown) => {
            if (
              document.querySelector("#hand")?.dataset.presentedRevision ===
              shown
            )
              return false;
            const overlay = document.querySelector("#location-overlay");
            if (
              overlay &&
              (overlay.getAnimations().length || overlay.style.opacity)
            )
              return false;
            return !document.querySelector(".backdrop-fading");
          },
          shown,
          { timeout: 25_000 },
        )
        .catch(async (error) => {
          const diagnostic = await page
            .evaluate((key) => {
              const overlay = document.querySelector("#location-overlay");
              return {
                savedRevision: JSON.parse(localStorage.getItem(key))?.revision,
                shownRevision:
                  document.querySelector("#hand")?.dataset.presentedRevision,
                overlayHidden: overlay?.hidden,
                overlayStyle: overlay?.style.opacity,
                animations: overlay?.getAnimations().map((a) => a.playState),
                ghosts: document.querySelectorAll(".backdrop-fading").length,
                action: document.querySelector("#card-actions")?.textContent,
                status: document.querySelector("#play-status")?.textContent,
              };
            }, key)
            .catch(() => null);
          await page
            .screenshot({
              path: new URL(`${place}-failed.png`, output).pathname,
            })
            .catch(() => {});
          throw new Error(
            `Wait after revision ${shown} never settled within 25 s: the hand did not present a new revision, or the ship overlay or berth crossfade kept fading. ${JSON.stringify(diagnostic)}. ${error.message}`,
          );
        });
      const samples = await page.evaluate(() => {
        window.__fade.stop = true;
        return window.__fade;
      });
      console.log(JSON.stringify({
        place, before, after: await snapshot(),
        ghost: {
          count: samples.ghost.length,
          min: samples.ghost.length ? Math.min(...samples.ghost) : null,
          max: samples.ghost.length ? Math.max(...samples.ghost) : null,
        },
      }));
      return samples;
    };
    await page.goto(`${origin}/?table=${table}`);
    await page.waitForSelector("#hand .card");
    await page.waitForTimeout(2000);
    let fade;
    for (let n = 0; n < 8 && (await ship()).dock !== place; n++)
      fade = await wait();
    assert.equal((await ship()).dock, place, "the ship comes to the waiter");
    const mid = (values) => values.some((v) => v > 0.05 && v < 0.95);
    // Ways on stack at the right (#2272), separate from the current place.
    // In both fixtures the ship joins beneath the existing first way.
    const shipCard = page.locator('#hand [data-card="greek-ship"]');
    const frame = shipCard.locator("xpath=..");
    const top = page.locator(`#hand [data-card="${topWay}"]`);
    assert.deepEqual(
      await page.locator("#hand .card.location").evaluateAll(
        (cards, here) =>
          cards.map((card) => card.dataset.card).filter((id) => id !== here),
        place,
      ),
      [topWay, "greek-ship"],
      "the ship joins the ways stack behind its first destination",
    );
    assert.equal(await top.getAttribute("aria-expanded"), "false");
    assert.equal(await frame.evaluate((el) => el.hidden), true);
    assert.deepEqual(fade.card, [], "the folded ship card stays out of sight");
    if (place === "pond") assert.ok(mid(fade.overlay), "the ship fades in");
    else assert.ok(mid(fade.ghost), "the berth crossfades to the ship");
    await page.screenshot({
      path: new URL(`${place}-docked.png`, output).pathname,
    });
    // Settled: no animation or inline style left, and the card takes clicks
    // once the ways stack is open.
    await revealCard(page, "greek-ship");
    assert.equal(await top.getAttribute("aria-expanded"), "true");
    assert.equal(await frame.evaluate((el) => el.hidden), false);
    assert.equal(await shipCard.isVisible(), true);
    await page.waitForTimeout(600);
    const settled = await page.evaluate(() => {
      const card = document.querySelector('#hand [data-card="greek-ship"]');
      card.scrollIntoView({ block: "nearest", inline: "center" });
      const frame = card.closest(".card-frame");
      const overlay = document.querySelector("#location-overlay");
      const box = card.getBoundingClientRect();
      const hit = document.elementFromPoint(
        box.left + box.width / 2,
        box.top + box.height / 2,
      );
      return {
        animations: [frame, overlay]
          .filter(Boolean)
          .flatMap((el) => el.getAnimations()).length,
        opacity: +getComputedStyle(frame).opacity,
        overlayStyle: overlay?.style.opacity || "",
        hit: card.contains(hit),
      };
    });
    assert.deepEqual(settled, {
      animations: 0,
      opacity: 1,
      overlayStyle: "",
      hit: true,
    });
    assert.equal(await frame.count(), 1);
    // Wait until the ship sails without the player; it fades out. At the
    // harbor it leaves once the seeded Bard boards.
    for (let n = 0; n < 32 && (await ship()).dock === place; n++)
      fade = await wait();
    assert.notEqual((await ship()).dock, place, "the ship sails on");
    if (place === "pond") {
      assert.ok(mid(fade.overlay), "the ship fades out");
      assert.equal(await page.locator("#location-overlay").isHidden(), true);
    } else assert.ok(mid(fade.ghost),
      `the ship crossfades to the berth: ${JSON.stringify(fade.ghost)}`);
    assert.deepEqual(errors, []);
    console.log(`Ship fade: arrival and departure at ${place} passed.`);
    await page.close();
  }
} finally {
  await browser?.close();
  await new Promise((done) => server.close(done));
}
