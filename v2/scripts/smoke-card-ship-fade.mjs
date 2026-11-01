// The Greek ship docking where the player waits fades in: the ship painted
// over Black Pond and the berth at the Wine-Dark Harbor. Its card folds into
// the location stack. It fades out as it sails, and nothing is left holding a
// style or blocking a click.
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { chromium } from "playwright";
import { createServer } from "../card-game/serve.mjs";
import { decodeSave, encodeSave } from "../card-game/world.mjs";
import { profiles } from "../card-game/memory.mjs";
import { summonTransport } from "../card-game/pack-transport.mjs";
import { openDoorStart } from "../../test/helpers/open-door.mjs";
import { selectCard } from "./card-browser-helpers.mjs";

const output = new URL("../../output/ship-fade/", import.meta.url);
await mkdir(output, { recursive: true });
const server = createServer();
await new Promise((done) => server.listen(0, "127.0.0.1", done));
const origin = `http://127.0.0.1:${server.address().port}`;
let browser;
try {
  browser = await chromium.launch({ headless: true });
  for (const [place, away] of [
    ["pond", "greek-harbor"],
    ["greek-harbor", "pond"],
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
    const wait = async () => {
      await page.keyboard.press("Escape");
      await selectCard(page, "mara");
      const shown = await page
        .locator("#hand")
        .getAttribute("data-presented-revision");
      await watch();
      await page.locator('#card-actions [data-action="wait"]').first().click();
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
        .catch((error) => {
          throw new Error(
            `Wait after revision ${shown} never settled within 25 s: the hand did not present a new revision, or the ship overlay or berth crossfade kept fading. ${error.message}`,
          );
        });
      return page.evaluate(() => {
        window.__fade.stop = true;
        return window.__fade;
      });
    };
    await page.goto(`${origin}/?table=${table}`);
    await page.waitForSelector("#hand .card");
    await page.waitForTimeout(2000);
    let fade;
    for (let n = 0; n < 8 && (await ship()).dock !== place; n++)
      fade = await wait();
    assert.equal((await ship()).dock, place, "the ship comes to the waiter");
    const mid = (values) => values.some((v) => v > 0.05 && v < 0.95);
    // The docked ship folds face down into the place's location stack
    // (#1780), so its card shows no fade until the stack opens.
    assert.equal(
      await page
        .locator('#hand [data-card="greek-ship"]')
        .locator("xpath=..")
        .getAttribute("data-holder"),
      place,
      `the ship card stacks behind ${place}`,
    );
    assert.deepEqual(fade.card, [], "the folded ship card stays out of sight");
    if (place === "pond") assert.ok(mid(fade.overlay), "the ship fades in");
    else assert.ok(mid(fade.ghost), "the berth crossfades to the ship");
    await page.screenshot({
      path: new URL(`${place}-docked.png`, output).pathname,
    });
    // Settled: no animation or inline style left, and the card takes clicks
    // once the location stack is open.
    await page.locator(`#hand [data-card="${place}"]`).click();
    await page
      .locator(`#hand [data-card="${place}"][aria-expanded="true"]`)
      .waitFor();
    await page.waitForTimeout(600);
    const frame = page
      .locator('#hand [data-card="greek-ship"]')
      .locator("xpath=..");
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
    // Wait until the ship sails without the player; it fades out. Residents
    // never call it away from a human, so at the harbor it leaves only when
    // the Bard wanders aboard (about 19 rounds with the doused opening).
    for (let n = 0; n < 32 && (await ship()).dock === place; n++)
      fade = await wait();
    assert.notEqual((await ship()).dock, place, "the ship sails on");
    if (place === "pond") {
      assert.ok(mid(fade.overlay), "the ship fades out");
      assert.equal(await page.locator("#location-overlay").isHidden(), true);
    } else assert.ok(mid(fade.ghost), "the ship crossfades to the berth");
    assert.deepEqual(errors, []);
    console.log(`Ship fade: arrival and departure at ${place} passed.`);
    await page.close();
  }
} finally {
  await browser?.close();
  await new Promise((done) => server.close(done));
}
