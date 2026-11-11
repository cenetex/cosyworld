// The Thebes provisions loop in the browser (rules 102): Dione bakes the
// bread when the water jar comes back to her with her wheat; the City Gate
// guard guards the card beyond his gate, whose context button names him;
// the bread, the sanctuary's figs and the gate's wine skin go to Myrto, who
// makes the Travel Provisions. Aboard the Charybdis, Piraeus lies locked
// until the provisions lie on deck; the voyage uses nothing and the way home
// is free. Each thing consumed goes straight home: the bread locked.
//
//   node v2/scripts/smoke-card-thebes-provisions.mjs [screenshot-dir]
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { chromium } from "playwright";
import { createServer } from "../card-game/serve.mjs";
import {
  createWorld,
  decodeSave,
  encodeSave,
  legalActions,
} from "../card-game/world.mjs";
import { enableMotives } from "../card-game/motives.mjs";
import { profiles } from "../card-game/memory.mjs";
import { greekTravelTargets } from "../../test/helpers/greek-travel.mjs";
import { revealCard, selectCard } from "./card-browser-helpers.mjs";

const SET = ["greek-bread", "greek-figs", "greek-wine-skin"];
const output = process.argv[2]
  ? new URL(`file://${process.argv[2].replace(/\/?$/u, "/")}`)
  : new URL("../../output/thebes-provisions/", import.meta.url);
await mkdir(output, { recursive: true });

const fixture = enableMotives(createWorld());
fixture.actors.vale.place = "greek-courtyard";
fixture.crossings["pond-greek-harbor"].discovered = true;
for (const id of ["lamp", "cloth"]) fixture.items[id].holder = "pond";
fixture.items["greek-water-jar"].holder = "vale";
const save = encodeSave(fixture);

const server = createServer();
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
let browser;
try {
  browser = await chromium.launch({ headless: true });
  for (const width of [1440, 390]) {
    const page = await browser.newPage({
      viewport: { width, height: width === 390 ? 844 : 900 },
      reducedMotion: "reduce",
    });
    page.setDefaultTimeout(15_000);
    const table = `thebes-provisions-${width}`;
    const key = `cosyworld.reflected-shore.v1.${table}`;
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
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
      { key, save, seen: Object.keys(profiles) },
    );
    await page.route("**/card-game/text", async (route) => {
      const input = route.request().postDataJSON();
      await route.fulfill({
        json: {
          revision: input.revision,
          model: "thebes-provisions-fixture",
          entries: input.entities.map(({ id }) => ({
            id,
            text: `${profiles[id]?.name || id} watches.`,
          })),
        },
      });
    });
    const state = () =>
      page.evaluate((key) => JSON.parse(localStorage.getItem(key)), key);
    const card = (id) => page.locator(`#hand [data-card="${id}"]`);
    const ready = async () => {
      for (let i = 0; i < 375; i++) {
        if (await page.locator("#dialogue-advance").isVisible())
          await page.locator("#dialogue-advance").click();
        if (
          (await page.locator("#hand").getAttribute("data-cooling")) === "false"
        )
          return;
        await page.waitForTimeout(40);
      }
      throw new Error(`The hand stayed busy: ${errors.join("; ")}`);
    };
    const shot = async (name) => {
      await page.waitForTimeout(900);
      await page.screenshot({
        path: new URL(`${name}-${width}.png`, output).pathname,
      });
    };
    const chosen = (ids) =>
      page
        .locator('#hand .card[aria-pressed="true"]')
        .evaluateAll(
          (cards, ids) =>
            ids.every((id) => cards.some((c) => c.dataset.card === id)),
          ids,
        );
    const primary = async (...ids) => {
      await ready();
      // A tap on a folded stack fans it before it chooses: choose again
      // until these cards are raised.
      for (let n = 0; n < 3 && (n === 0 || !(await chosen(ids))); n++) {
        await page.keyboard.press("Escape");
        for (const id of ids) await selectCard(page, id);
      }
      assert.ok(await chosen(ids), `chose ${ids}`);
      await page.locator("#card-actions .card-primary").click();
      await ready();
    };
    // Walk the shortest road there, a card play per place.
    const go = async (to) => {
      const from = (await state()).actors.vale.place;
      for (const place of greekTravelTargets(from, to)) await primary(place);
      assert.equal((await state()).actors.vale.place, to);
    };

    await page.goto(
      `http://127.0.0.1:${server.address().port}/?table=${table}`,
    );
    await card("greek-baker").waitFor({ state: "attached" });
    await ready();
    // The bread waits locked on Dione's table: she makes it from the jar and
    // the wheat she holds.
    const fresh = await state();
    assert.ok(fresh.usedUp.includes("greek-bread"));
    assert.equal(fresh.items["greek-wheat"].holder, "greek-baker");
    // The water jar back in her hands bakes it; the jar goes home to the
    // well and the wheat to Piraeus at once.
    await primary("greek-water-jar", "greek-baker");
    const baked = await state();
    assert.ok(!baked.usedUp.includes("greek-bread"));
    assert.equal(baked.items["greek-bread"].holder, "greek-courtyard");
    assert.equal(baked.items["greek-water-jar"].holder, "greek-well");
    assert.equal(baked.items["greek-wheat"].holder, "greek-piraeus");
    await card("greek-bread").waitFor({ state: "attached" });
    await shot("01-bread-on-dione-table");
    await primary("greek-bread");
    await go("greek-sanctuary");
    await primary("greek-figs");
    await shot("02-figs-at-the-sanctuary");
    await go("greek-gate");

    // The guard guards the battlefield's card: a locked wooden box, the
    // carved lid, no painting and no name.
    const sealed = card("greek-battlefield");
    await sealed.waitFor({ state: "attached" });
    assert.equal(await sealed.getAttribute("data-locked"), "true");
    await revealCard(page, "greek-battlefield");
    assert.equal(await sealed.locator(".name").textContent(), "");
    assert.equal(await sealed.locator(".card-back").isVisible(), true);
    assert.equal(await sealed.locator(".art img").first().isVisible(), false);
    await shot("03-guarded-gate-card");
    // Its context button names the guard and plays nothing; there is no
    // quest to seek on the card (Talk with him gives his).
    await page.keyboard.press("Escape");
    await selectCard(page, "greek-battlefield");
    const guarded = page.locator('#card-actions [data-blocked="gate"]');
    assert.equal(
      await guarded.getAttribute("title"),
      await page.locator(".action-beat-text").textContent(),
    );
    assert.equal(await guarded.isDisabled(), true);
    assert.equal(
      await page
        .locator("#card-actions button:not([disabled])", {
          hasText: "Seek the way",
        })
        .count(),
      0,
    );
    await shot("04-guarded-card-context");
    await page.keyboard.press("Escape");

    await primary("greek-wine-skin");
    const gathered = await state();
    for (const id of SET) assert.equal(gathered.items[id].holder, "vale");
    await go("greek-harbor");
    // The provisions wait locked on the quay; each of the three given to
    // Myrto stays with her, and the last makes them.
    const quay = await state();
    assert.ok(quay.usedUp.includes("greek-provisions"));
    for (const id of ["greek-figs", "greek-wine-skin", "greek-bread"])
      await primary(id, "greek-shipmaster");
    const packed = await state();
    assert.equal(packed.items["greek-provisions"].holder, "greek-harbor");
    assert.ok(!packed.usedUp.includes("greek-provisions"));
    // The bread goes home locked; the figs and the wine home, ready.
    assert.ok(packed.usedUp.includes("greek-bread"));
    assert.equal(packed.items["greek-bread"].holder, "greek-courtyard");
    assert.equal(packed.items["greek-figs"].holder, "greek-sanctuary");
    assert.equal(packed.items["greek-wine-skin"].holder, "greek-gate");
    await card("greek-provisions").waitFor({ state: "attached" });
    await shot("05-provisions-on-the-landing");

    // Carried aboard they are not enough: Piraeus lies locked, its context
    // button saying what opens the course.
    await primary("greek-provisions");
    await go("greek-ship");
    const port = card("greek-piraeus");
    await port.waitFor({ state: "attached" });
    assert.equal(await port.getAttribute("data-locked"), "true");
    await page.keyboard.press("Escape");
    await selectCard(page, "greek-piraeus");
    const shut = page.locator('#card-actions [data-blocked="gate"]');
    assert.equal(
      await shut.getAttribute("title"),
      await page.locator(".action-beat-text").textContent(),
    );
    assert.equal(await shut.isDisabled(), true);
    assert.equal(
      await page.locator("#card-actions .card-primary:not([disabled])").count(),
      0,
    );
    await shot("06-piraeus-locked-aboard");
    // Laid on deck, they open the course to Piraeus.
    await primary("greek-provisions", "greek-ship");
    assert.equal(
      (await state()).items["greek-provisions"].holder,
      "greek-ship",
    );
    assert.notEqual(await port.getAttribute("data-locked"), "true");
    await primary("greek-piraeus");
    for (
      let n = 0;
      n < 6 && (await state()).transports["greek-ship"].phase !== "arrived";
      n++
    )
      await primary("greek-ship");
    // The voyage uses nothing: the provisions still lie whole on deck.
    const docked = await state();
    assert.equal(docked.transports["greek-ship"].phase, "arrived");
    assert.equal(docked.transports["greek-ship"].dock, "greek-piraeus");
    assert.equal(docked.items["greek-provisions"].holder, "greek-ship");
    assert.ok(!docked.usedUp.includes("greek-provisions"));
    await shot("07-provisions-still-aboard");
    // The way home is free: the provisions still on deck, the harbour
    // course is offered and sailed. With them back in hand the dock
    // is left in one tap: a held thing never leaves the player without a button.
    await primary("greek-harbor");
    for (
      let n = 0;
      n < 6 &&
      !legalActions(decodeSave(JSON.stringify(await state()))).some(
        (a) => a.kind === "move" && a.target === "greek-harbor",
      );
      n++
    )
      await primary("greek-ship");
    await primary("greek-provisions");
    assert.equal((await state()).items["greek-provisions"].holder, "vale");
    await primary("greek-harbor");
    const home = await state();
    assert.equal(home.actors.vale.place, "greek-harbor");
    assert.equal(home.items["greek-provisions"].holder, "vale");
    assert.ok(!home.usedUp.includes("greek-provisions"));
    // Back at Dione's courtyard the eaten-in bread waits locked again;
    // nothing regrows: it waits for the jar and the wheat.
    await go("greek-courtyard");
    const bread = card("greek-bread");
    await bread.waitFor({ state: "attached" });
    assert.equal(await bread.getAttribute("data-locked"), "true");
    await shot("08-bread-locked-at-home");
    assert.deepEqual(errors, []);
    await page.close();
    console.log(`Thebes provisions loop: ${width}px passed.`);
  }
} finally {
  await browser?.close();
  server.close();
}
