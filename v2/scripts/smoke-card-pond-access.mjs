import { selectCard } from "./card-browser-helpers.mjs";
import assert from "node:assert/strict";
import { chromium } from "playwright";
import { createServer } from "../card-game/serve.mjs";
import {
  createWorld,
  encodeSave,
  legalActions,
  play,
} from "../card-game/world.mjs";
import { enableMotives } from "../card-game/motives.mjs";

const act = (s, kind, target) => {
  const action = legalActions(s).find(
    (a) => a.kind === kind && (!target || a.target === target),
  );
  const result = play(s, action);
  assert.ok(result.ok);
  return result.state;
};
// The opening starts lit; dousing the lamp opens the attic mirror (#1600).
let fixture = enableMotives(createWorld({ opening: true }));
assert.equal(fixture.items.lamp.lit, true);
fixture = act(fixture, "snuff");
fixture = act(fixture, "move", "pond");
fixture.items.lamp.holder = "moth";
fixture.items.lamp.lit = true;
fixture.items.lamp.fuel = 8;
fixture = act(fixture, "wait");
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
    await card("attic").waitFor({ state: "attached" });
    await ready();
    assert.equal(
      await card("attic").locator(".name").innerText(),
      "Mirror attic",
    );
    // Pip wants the lamp and keeps it at home on the pond. A lit lamp on the
    // shore keeps the pond side of the mirror open.
    const waitHere = async () => {
      await selectCard(page, "pond");
      await page.locator("#card-actions .card-primary").click();
      await ready();
    };
    await waitHere();
    const kept = await state();
    assert.equal(kept.actors.moth.place, "pond");
    assert.equal(kept.items.lamp.holder, "moth");
    assert.equal(kept.items.lamp.lit, true);
    assert.equal(
      await card("attic").locator(".name").innerText(),
      "Mirror attic",
    );
    assert.equal(await card("pond").locator(".name").innerText(), "Black pond");
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
      await card("attic").locator(".name").innerText(),
      "Mirror attic",
    );
    // The lamp burns down in Pip's hands; once it goes out the mirror closes.
    // Pip rests at home just after a want is met, so he stays on the shore
    // while its last fuel burns.
    const low = await state();
    low.items.lamp.fuel = 1;
    low.actors.moth.metTurn = low.actors.moth.want.since = low.turn;
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
      (key) => JSON.parse(localStorage.getItem(key)).items.lamp.fuel === 1,
      key,
    );
    await ready();
    await waitHere();
    const spent = await state();
    assert.equal(spent.items.lamp.lit, false);
    assert.equal(spent.items.lamp.holder, "moth");
    assert.equal(spent.actors.moth.place, "pond");
    assert.equal(await card("attic").count(), 0);
    await page.reload();
    await ready();
    assert.equal(await card("attic").count(), 0);
    // A lit lamp carried away from both shores leaves the mirror closed.
    const away = structuredClone(spent);
    away.items.lamp.lit = true;
    away.items.lamp.fuel = 8;
    away.actors.moth.place = "station";
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
    assert.equal(await card("attic").count(), 0);
    const departed = away;
    // A save arriving from another tab also rebuilds availability and selection.
    departed.items.lamp.holder = "vale";
    await page.evaluate(
      ({ key, value }) => {
        localStorage.setItem(key, value);
        window.dispatchEvent(
          new StorageEvent("storage", { key, newValue: value }),
        );
      },
      { key, value: encodeSave(departed) },
    );
    await card("attic").waitFor({ state: "attached" });
    await ready();
    await selectCard(page, "attic");
    await page.locator("#card-actions .card-primary").click();
    await ready();
    // Held lit at the pond, the lamp brought Vale back into its light.
    assert.equal((await state()).actors.vale.place, "attic");
    assert.equal(
      await card("attic").locator(".name").innerText(),
      "Mirror attic",
    );
    assert.equal(await card("pond").count(), 0);
    await painted("attic-lit");
    // Its own paintings carry the light; the stage dims them only at night.
    assert.equal(await page.locator("body").getAttribute("data-dim"), "false");
    // Dousing it shows the Black Pond in the glass and the way out.
    await selectCard(page, "lamp");
    await page.locator("#card-actions .card-primary").click();
    await ready();
    assert.equal((await state()).items.lamp.lit, false);
    await card("pond").waitFor({ state: "attached" });
    await painted("attic-doused");
    await page.reload();
    await ready();
    assert.equal(await card("pond").count(), 1);
    await painted("attic-doused");
    assert.equal((await state()).actors.vale.place, "attic");
    // Relighting shuts the mirror again; dousing reopens it.
    await selectCard(page, "lamp");
    await page.locator("#card-actions .card-primary").click();
    await ready();
    assert.equal(await card("pond").count(), 0);
    await painted("attic-lit");
    // Lit with the cloth here, the stack holds only the cottage stairs and
    // the mirror still shows only the room.
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
    assert.equal(await card("pond").count(), 0);
    assert.equal(
      await page
        .locator("#hand .card-frame[data-places]")
        .getAttribute("data-places"),
      "1",
    );
    await painted("attic-lit-cottage");
    await page.reload();
    await ready();
    await painted("attic-lit-cottage");
    assert.equal(await card("pond").count(), 0);
    await page.reload();
    await ready();
    await selectCard(page, "lamp");
    await page.locator("#card-actions .card-primary").click();
    await ready();
    await selectCard(page, "pond");
    await page.locator("#card-actions .card-primary").click();
    await ready();
    assert.equal((await state()).actors.vale.place, "pond");
    assert.deepEqual(errors, []);
    console.log(
      `Douse to leave, lit at the pond to return, lit and doused paintings undimmed by day, Pip keeping the lamp at the pond, burn-out and carried-away closing, reload and relighting passed at ${width}px.`,
    );
    await page.close();
  }
} finally {
  await browser?.close();
  await new Promise((resolve) => server.close(resolve));
}
