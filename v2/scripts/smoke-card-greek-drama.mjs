import { greekTravelTargets } from "../../test/helpers/greek-travel.mjs";
import {
  endStandoff,
  selectCard,
  topicForChoice,
} from "./card-browser-helpers.mjs";
import { checkOpeningPoem } from "./smoke-card-opening-poem.mjs";
// Exercise the public card UI and its one saved history, at desktop and phone
// widths. Text is a bounded fixture; the deterministic model owns every result.
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { chromium } from "playwright";
import { createServer } from "../card-game/serve.mjs";
import {
  addLog,
  createWorld,
  encodeSave,
  legalActions,
  places,
  play,
  rootHolder,
} from "../card-game/world.mjs";
import { enableMotives } from "../card-game/motives.mjs";
import { profiles } from "../card-game/memory.mjs";

function commit(world, kind, target) {
  const action = legalActions(world).find(
    (a) => a.kind === kind && (!target || a.target === target),
  );
  assert.ok(action, `${kind} ${target || ""} is available`);
  const result = play(world, action);
  assert.ok(result.ok, result.error);
  return result.state;
}

let fixture = enableMotives(
  createWorld({ opening: true, packScopes: { "greek-drama": "full" } }),
);
// Keep the first ship signal part of this story fixture's legal journey.
fixture.actors["greek-rhapsode"].place = "attic";
// The opening starts lit; douse it to open the mirror (#1653).
fixture = commit(fixture, "snuff");
fixture = commit(fixture, "move", "pond");
fixture.items.cloth.holder = "vale";
fixture.items.lamp.fuel = 12;
fixture.items.oil.holder = "greek-harbor";
fixture.actors.vale.trust.moth = 2;
addLog(
  fixture,
  "Pip",
  "Pip gives Vale the cloth to keep safe on the journey.",
  {
    kind: "action",
    verb: "give",
    actorId: "moth",
    targetId: "vale",
    itemId: "cloth",
    locationId: "pond",
    witnesses: ["vale"],
  },
);
const remembered = structuredClone(fixture.memories.vale.landmarks.at(-1));
const save = encodeSave(fixture);
const server = createServer();
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
let browser;
try {
  browser = await chromium.launch({ headless: true });
  const output = new URL("../../output/greek-drama-check/", import.meta.url);
  await mkdir(output, { recursive: true });
  for (const width of [1440, 390]) {
    const page = await browser.newPage({
      viewport: { width, height: 900 },
      reducedMotion: "reduce",
    });
    page.setDefaultTimeout(15_000);
    const table = `greek-drama-check-${width}`;
    const key = `cosyworld.reflected-shore.v1.${table}`;
    const errors = [];
    const failedAssets = [];
    const requests = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("response", (response) => {
      if (
        response.status() >= 400 &&
        new URL(response.url()).pathname.includes("/assets/")
      )
        failedAssets.push(`${response.status()} ${response.url()}`);
    });
    await page.addInitScript(
      ({ key, save, seen }) => {
        if (!localStorage.getItem(key)) localStorage.setItem(key, save);
        localStorage.setItem(`${key}.seen`, JSON.stringify(seen));
        localStorage.setItem("cosyworld.dialogue.sound", "off");
      },
      { key, save, seen: Object.keys(profiles) },
    );
    await page.route("**/card-game/text", async (route) => {
      const input = route.request().postDataJSON();
      requests.push(input);
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          revision: input.revision,
          model: "greek-browser-fixture",
          entries: input.entities.map(({ id }) => ({
            id,
            text:
              input.disclosures?.find((fact) => fact.speaker === id)?.text ||
              `${profiles[id]?.name || id} considers the witnessed result.`,
          })),
        }),
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
      throw new Error(
        `The Greek hand stayed busy at ${width}px: ${errors.join("; ")}`,
      );
    };
    const playCard = async (id) => {
      await ready();
      if (await endStandoff(page, await state())) await ready();
      // A held item stays raised after its play; start each play fresh.
      await page.keyboard.press("Escape");
      await selectCard(page, id);
      await page.locator("#card-actions .card-primary").click();
      await ready();
    };
    const pair = async (one, two) => {
      await ready();
      if (await endStandoff(page, await state())) await ready();
      await page.keyboard.press("Escape");
      await selectCard(page, one);

      await selectCard(page, two);
      await page.locator("#card-actions .card-primary").click();
      await ready();
    };
    const signalShip = async () => {
      const s = await state();
      assert.ok(
        s.items.lamp.fuel >= 4,
        "the lamp has enough oil for the signal",
      );
      if (!(await state()).items.lamp.lit) await playCard("lamp");
      // Cover the lit lamp, then uncover it: the whole ship signal.
      await pair("cloth", "lamp");
      await playCard("cloth");
      assert.equal((await state()).crossings["pond-greek-harbor"].phase, 2);
    };
    const travel = async (id) => {
      const before = await state();
      const steps = greekTravelTargets(before.actors.vale.place, id);
      if (steps.length > 1) {
        for (const step of steps) await travel(step);
        return;
      }
      if (id === "greek-ship")
        for (
          let n = 0;
          n < 32 &&
          !legalActions(await state()).some(
            (a) => a.kind === "move" && a.target === id,
          );
          n++
        )
          await playCard("vale");
      const boarding =
        before.actors.vale.place === "pond" && id === "greek-harbor";
      if (boarding && before.transports["greek-ship"].dock !== "pond")
        await signalShip();
      if (
        boarding ||
        (before.actors.vale.place === "greek-harbor" && id === "pond")
      ) {
        // The bard can be on the current trip. Let the ship return through
        // ordinary turns before boarding from this shore.
        // A ship at sea has left its dock; wait until it lies at this shore.
        for (
          let turn = 0;
          turn < 12 &&
          !legalActions(await state()).some(
            (a) => a.kind === "move" && a.target === "greek-ship",
          );
          turn++
        )
          await playCard("vale");
        assert.equal(
          (await state()).transports["greek-ship"].dock,
          before.actors.vale.place,
          "the ship reaches the departure shore",
        );
        await playCard("greek-ship");
        // The destination card sets the course; the voyage takes a round.
        await playCard(id);
        assert.equal((await state()).transports["greek-ship"].phase, "sea");
        for (
          let turn = 0;
          turn < 4 &&
          !legalActions(await state()).some(
            (a) => a.kind === "move" && a.target === id,
          );
          turn++
        )
          await playCard("vale");
      }
      await playCard(id);
      assert.equal((await state()).actors.vale.place, id, `travel to ${id}`);
      assert.equal(await page.textContent("#place-title"), places[id].name);
      if (boarding && (await state()).items.lamp.lit) await playCard("lamp");
    };
    const choose = async (choiceId) => {
      await ready();
      const action = legalActions(await state()).find(
        (a) => a.choiceId === choiceId,
      );
      assert.ok(action, `legal choice ${choiceId}`);
      const topic = topicForChoice(choiceId);
      const option = page.locator(
        topic
          ? `#card-actions [data-action="talk"]`
          : `[data-choice="${choiceId}"][data-pack="greek-drama"]`,
      );
      if (!(await option.isVisible())) {
        await selectCard(page, topic?.speaker || action.cards[0]);
      }
      if (["greek-helen-egypt", "greek-helen-troy"].includes(choiceId)) {
        const bounds = await page.locator("#card-actions").boundingBox();
        assert.ok(bounds && bounds.x >= 0 && bounds.x + bounds.width <= width);
        await page.screenshot({
          path: new URL(`history-choice-${width}.png`, output).pathname,
          fullPage: true,
        });
      }
      await option.click();
      await ready();
    };
    const artReady = async () => {
      await page.waitForFunction(() =>
        [...document.querySelectorAll("#backdrop, #cast img")].every(
          (img) => img.complete && img.naturalWidth > 0,
        ),
      );
      assert.ok(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth + 1,
        ),
        "the page fits the viewport while the hand scrolls internally",
      );
      assert.ok(
        await page.evaluate(() =>
          [...document.querySelectorAll("#card-actions button")].every(
            (button) => {
              const bounds = button.getBoundingClientRect();
              return bounds.width <= innerWidth && bounds.height >= 44;
            },
          ),
        ),
        "action buttons fit the viewport and have touch targets",
      );
    };

    await page.goto(
      `http://127.0.0.1:${server.address().port}/?table=${table}`,
    );
    await card("lamp").waitFor({ state: "attached" });
    assert.equal(await card("greek-harbor").count(), 0);
    await ready();
    await travel("greek-harbor");
    await travel("greek-courtyard");
    assert.equal(await card("greek-baker").count(), 1);
    await travel("greek-gate");
    assert.equal(await card("greek-antigone").count(), 1);
    assert.equal(await card("greek-guard").count(), 1);
    // Meeting the guard tells the decree. Handing him the shovel reports the
    // plan; Thebes has no story buttons.
    let current = await state();
    assert.ok(current.packs["greek-drama"].receipts["greek-hear-decree"]);
    assert.ok(!legalActions(current).some((a) => a.kind === "choose"));
    await playCard("greek-shovel");
    await pair("greek-shovel", "greek-guard");
    current = await state();
    assert.equal(
      current.packs["greek-drama"].choices["greek-theban-response"],
      "exposure",
    );
    assert.equal(current.items.cloth.holder, "vale");
    assert.equal(rootHolder(current, "lamp"), "vale");
    assert.equal(rootHolder(current, "cloth"), "vale");
    const reportTurn =
      current.packs["greek-drama"].receipts["greek-report-plan"];
    await artReady();
    await page.screenshot({
      path: new URL(`thebes-${width}.png`, output).pathname,
      fullPage: true,
    });

    await page.reload();
    await card("greek-antigone").waitFor({ state: "attached" });
    await ready();
    current = await state();
    assert.equal(current.actors.vale.place, "greek-gate");
    assert.equal(
      current.packs["greek-drama"].choices["greek-theban-response"],
      "exposure",
    );
    assert.equal(
      current.packs["greek-drama"].receipts["greek-report-plan"],
      reportTurn,
    );
    for (const destination of ["greek-courtyard", "greek-harbor", "pond"])
      await travel(destination);
    current = await state();
    assert.equal(current.actors.vale.trust.moth, 2);
    assert.ok(
      current.memories.vale.landmarks.some(
        (e) => e.seq === remembered.seq && e.text === remembered.text,
      ),
    );
    assert.equal(await card("greek-antigone").count(), 0);

    // Each viewport follows a different incompatible history from its own save.
    const branch = width === 1440 ? "egypt" : "troy";
    const destination =
      branch === "egypt" ? "greek-egypt-tomb" : "greek-troy-beach";
    const opposite =
      branch === "egypt" ? "greek-troy-beach" : "greek-egypt-tomb";
    const evidence = `greek-${branch}-testimony`;
    await travel("greek-harbor");
    await choose(`greek-helen-${branch}`);
    assert.equal(await card(opposite).count(), 0);
    await travel(destination);
    await playCard(evidence);
    assert.equal(rootHolder(await state(), evidence), "vale");
    await page.reload();
    await card(evidence).waitFor({ state: "attached" });
    await ready();
    await artReady();
    await page.screenshot({
      path: new URL(`helen-${branch}-${width}.png`, output).pathname,
      fullPage: true,
    });
    await travel("greek-harbor");
    assert.equal(await card(opposite).count(), 0);
    await travel("pond");
    current = await state();
    assert.equal(
      current.packs["greek-drama"].choices["greek-helen-account"],
      branch,
    );
    assert.equal(
      current.packs["greek-drama"].choices["greek-theban-response"],
      "exposure",
    );
    assert.equal(rootHolder(current, evidence), "vale");

    // A second tab's committed journey uses the same migration and UI rebuild.
    // The returned ship is already waiting for another trip.
    current = await state();
    const updated = commit(
      commit(
        commit(commit(current, "move", "greek-ship"), "course", "greek-harbor"),
        "wait",
      ),
      "move",
      "greek-harbor",
    );
    await page.evaluate(
      ({ key, value }) => {
        localStorage.setItem(key, value);
        window.dispatchEvent(
          new StorageEvent("storage", { key, newValue: value }),
        );
      },
      { key, value: encodeSave(updated) },
    );
    await page.waitForFunction(
      (name) => document.querySelector("#place-title")?.textContent === name,
      places["greek-harbor"].name,
    );
    await ready();
    assert.equal(await card(opposite).count(), 0);
    await travel("pond");
    assert.equal(rootHolder(await state(), evidence), "vale");
    assert.ok(requests.some((r) => r.location === "greek-gate"));
    assert.ok(requests.every((r) => r.speakers.length <= 3));
    assert.deepEqual(failedAssets, []);
    assert.deepEqual(errors, []);
    console.log(
      `Greek crossing, Theban report, ${branch} branch, custody, reload and return passed at ${width}px.`,
    );
    await page.close();
  }
  await checkOpeningPoem(browser, `http://127.0.0.1:${server.address().port}`);
} finally {
  await browser?.close();
  await new Promise((resolve) => server.close(resolve));
}
