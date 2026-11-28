import { selectCard } from "./card-browser-helpers.mjs";
import assert from "node:assert/strict";
import { chromium } from "playwright";
import { createServer } from "../card-game/serve.mjs";
import {
  createWorld,
  encodeSave,
  holdChoice,
  legalActions,
  play,
  reflectionOpen,
} from "../card-game/world.mjs";
import { fillLampFuel, settleLamp } from "../card-game/lamp-state.mjs";
import { enableMotives } from "../card-game/motives.mjs";

const act = (s, kind, target) => {
  const action = legalActions(s).find(
    (a) => a.kind === kind && (!target || a.target === target),
  );
  assert.ok(action, `Missing ${kind} ${target || ""}`);
  const result = play(s, action);
  assert.ok(result.ok, result.error);
  return result.state;
};
let fixture = enableMotives(createWorld({ opening: true }));
assert.equal(fixture.items.lamp.lit, true);
holdChoice(fixture, "vale", { item: null, revision: fixture.revision });
fixture = act(fixture, "move", "pond");
fixture.items.lamp.holder = "moth";
holdChoice(fixture, "moth", { item: "lamp", revision: fixture.revision });
fixture = act(fixture, "wait");
// Start a fresh visit after Pip settles with the lamp. The browser's Wait
// then tests this visit's first reply, using the same real travel rules.
fixture = act(fixture, "move", "station");
fixture = act(fixture, "move", "pond");
const save = encodeSave(fixture);
const key = "cosyworld.reflected-shore.v1.pond-access-check";
const server = createServer();
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
let browser;
try {
  browser = await chromium.launch({ headless: true });
  for (const width of [1440, 390]) {
    const page = await browser.newPage({
      viewport: { width, height: 900 },
      reducedMotion: "reduce",
    });
    const errors = [],
      requests = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.addInitScript(
      ({ key, save }) => {
        if (!localStorage.getItem(key)) localStorage.setItem(key, save);
        localStorage.setItem(
          `${key}.seen`,
          JSON.stringify([
            "vale",
            "moth",
            "keeper",
            "badger",
            "lamp",
            "oil",
            "cloth",
            "bell",
            "attic",
            "pond",
            "station",
            "clearing",
          ]),
        );
      },
      { key, save },
    );
    await page.route("**/card-game/text", async (route) => {
      const input = route.request().postDataJSON();
      requests.push(input);
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          revision: input.revision,
          model: "browser-fixture",
          entries: input.entities.map(({ id }) => ({
            id,
            text: `${id} fixture text.`,
          })),
        }),
      });
    });
    const ready = async () => {
      for (let i = 0; i < 250; i++) {
        if (
          (await page.locator("#hand").getAttribute("data-cooling")) === "false"
        )
          return;
        if (await page.locator("#dialogue-advance").isVisible())
          await page.locator("#dialogue-advance").click();
        await page.waitForTimeout(40);
      }
      throw new Error("The hand stayed busy.");
    };
    const state = () =>
      page.evaluate((key) => JSON.parse(localStorage.getItem(key)), key);
    const card = (id) => page.locator(`#hand [data-card="${id}"]`);
    const painted = async (name) =>
      page.waitForFunction(
        (name) => document.querySelector("#backdrop")?.src.includes(name),
        name,
      );
    await page.goto(
      `http://127.0.0.1:${server.address().port}/?table=pond-access-check`,
    );
    // A way that is shut lies in the hand as a locked box, never as a card to
    // enter (rules 133).
    const opened = async (id) => {
      await page.waitForFunction(
        (id) =>
          document.querySelector(`#hand [data-card="${id}"]`)?.dataset
            .locked === "false" &&
          !document.querySelector("#hand [data-revealing]"),
        id,
      );
      await ready();
    };
    const assertShut = async (id) => {
      assert.equal(await card(id).count(), 1);
      assert.equal(await card(id).getAttribute("data-locked"), "true");
    };
    const assertLitShut = async () => {
      const s = await state();
      assert.equal(s.items.lamp.lit, true);
      assert.equal(reflectionOpen(s, "attic"), false);
      assert.deepEqual(
        legalActions(s).filter((a) => a.kind === "move" && a.target === "pond"),
        [],
      );
      await assertShut("pond");
      assert.match(
        await card("pond").locator("img").first().getAttribute("src"),
        /card-back-locked/,
      );
      await selectCard(page, "pond");
      assert.match(
        await page
          .locator("#card-actions button", { hasText: "Locked" })
          .getAttribute("aria-label"),
        /^Locked\. /,
      );
      await selectCard(page, "pond");
    };
    await card("attic").waitFor({ state: "attached" });
    await ready();
    assert.equal(
      await card("attic").locator(".name").textContent(),
      "Mirror attic",
    );
    // Pip wants the lamp and keeps it at home on the pond. A lit lamp on the
    // shore keeps the pond side of the mirror open.
    const waitHere = async () => {
      await selectCard(page, "pond");
      await page.locator("#card-actions .card-primary").click();
      await ready();
      await page.keyboard.press("Escape");
    };
    const beforeWait = await state();
    await waitHere();
    const kept = await state();
    assert.equal(kept.items.lamp.fuelRooms, beforeWait.items.lamp.fuelRooms);
    assert.equal(kept.actors.moth.place, "pond");
    assert.equal(kept.items.lamp.holder, "moth");
    assert.equal(kept.items.lamp.lit, true);
    assert.equal(
      await card("attic").locator(".name").textContent(),
      "Mirror attic",
    );
    assert.equal(
      (await card("pond").locator(".name").textContent()).trim(),
      "Black pond",
    );
    assert.equal(requests.length, 1);
    assert.deepEqual(
      kept.log
        .filter(
          (e) => e.turn === kept.turn && e.generated && e.kind === "dialogue",
        )
        .map((e) => e.actorId),
      requests[0].speakers,
    );
    await page.reload();
    await ready();
    assert.equal(
      await card("attic").locator(".name").textContent(),
      "Mirror attic",
    );
    // Same-room waiting no longer spends fuel. Exercise an exhausted tank
    // arriving from another tab; room-consumption itself has authority tests.
    const low = await state();
    assert.equal(low.items.lamp.fuelRooms, kept.items.lamp.fuelRooms);
    low.items.lamp.fuelRooms = 0;
    settleLamp(low);
    low.actors.moth.metTurn = low.turn;
    if (low.actors.moth.want) low.actors.moth.want.since = low.turn;
    await page.evaluate(
      ({ key, value }) => {
        localStorage.setItem(key, value);
        window.dispatchEvent(
          new StorageEvent("storage", { key, newValue: value }),
        );
      },
      { key, value: encodeSave(low) },
    );
    await page.waitForFunction(
      (key) => JSON.parse(localStorage.getItem(key)).items.lamp.fuelRooms === 0,
      key,
    );
    await ready();
    await waitHere();
    const spent = await state();
    assert.equal(spent.items.lamp.lit, false);
    assert.equal(spent.items.lamp.holder, "moth");
    assert.equal(spent.actors.moth.place, "pond");
    await assertShut("attic");
    await page.reload();
    await ready();
    await assertShut("attic");
    const away = structuredClone(spent);
    away.actors.moth.place = "station";
    fillLampFuel(away);
    settleLamp(away);
    await page.evaluate(
      ({ key, value }) => {
        localStorage.setItem(key, value);
        window.dispatchEvent(
          new StorageEvent("storage", { key, newValue: value }),
        );
      },
      { key, value: encodeSave(away) },
    );
    await page.waitForFunction(
      (key) =>
        JSON.parse(localStorage.getItem(key)).actors.moth.place === "station",
      key,
    );
    await ready();
    await assertShut("attic");
    const departed = away;
    // A save arriving from another tab also rebuilds availability and selection.
    departed.items.lamp.holder = "vale";
    departed.actors.moth.heldItem = null;
    holdChoice(departed, "vale", { item: "lamp", revision: departed.revision });
    await page.evaluate(
      ({ key, value }) => {
        localStorage.setItem(key, value);
        window.dispatchEvent(
          new StorageEvent("storage", { key, newValue: value }),
        );
      },
      { key, value: encodeSave(departed) },
    );
    await page.waitForFunction(
      () =>
        document.querySelector('#hand [data-card="attic"]')?.dataset.locked ===
        "false",
    );
    await page.waitForFunction(
      () => !document.querySelector("#hand [data-revealing]"),
    );
    await ready();
    await selectCard(page, "attic");
    await page.locator("#card-actions .card-primary").click();
    await ready();
    await page.keyboard.press("Escape");
    assert.equal((await state()).actors.vale.place, "attic");
    assert.equal(
      await card("attic").locator(".name").textContent(),
      "Mirror attic",
    );
    await assertLitShut();
    await painted("attic-lit");
    assert.equal(await page.locator("body").getAttribute("data-dim"), "false");
    await selectCard(page, "lamp");
    await ready();
    assert.equal((await state()).items.lamp.lit, false);
    await opened("pond");
    await painted("attic-doused");
    assert.equal(await page.locator("body").getAttribute("data-dim"), "false");
    assert.equal(
      await page
        .locator("#stage")
        .evaluate((stage) => stage.style.getPropertyValue("--light-on")),
      "0",
    );
    await page.reload();
    await ready();
    assert.equal(await card("pond").count(), 1);
    await painted("attic-doused");
    assert.equal((await state()).actors.vale.place, "attic");
    await selectCard(page, "lamp");
    await ready();
    await assertLitShut();
    await painted("attic-lit");
    const clothed = await state();
    clothed.items.cloth.holder = "attic";
    await page.evaluate(
      ({ key, value }) => {
        localStorage.setItem(key, value);
        window.dispatchEvent(
          new StorageEvent("storage", { key, newValue: value }),
        );
      },
      { key, value: encodeSave(clothed) },
    );
    await card("forest-cottage").waitFor({ state: "attached" });
    await ready();
    await assertLitShut();
    // The one way on waits at the row's right end (#2272).
    assert.equal(
      await page
        .locator("#hand > .card-frame:not([hidden]) > .card")
        .last()
        .getAttribute("data-card"),
      "forest-cottage",
    );
    await painted("attic-lit-cottage");
    await page.reload();
    await ready();
    await painted("attic-lit-cottage");
    await assertLitShut();
    await page.reload();
    await ready();
    await selectCard(page, "lamp");
    await ready();
    await opened("pond");
    await selectCard(page, "pond");
    await page.locator("#card-actions .card-primary").click();
    await ready();
    assert.equal((await state()).actors.vale.place, "pond");
    assert.deepEqual(errors, []);
    console.log(
      `Stow to leave, lit at the pond to return, lit and stowed paintings undimmed by day, Pip keeping room fuel at the pond, exhaustion and carried-away closing, reload and holding passed at ${width}px.`,
    );
    await page.close();
  }
} finally {
  await browser?.close();
  await new Promise((resolve) => server.close(resolve));
}
