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

let fixture = enableMotives(createWorld({ opening: true }), {
  questPrograms: true,
  personalQuests: true,
});
fixture = commit(commit(fixture, "light"), "move", "pond");
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
            text: `${profiles[id]?.name || id} considers the witnessed result.`,
          })),
        }),
      });
    });

    const state = () =>
      page.evaluate((key) => JSON.parse(localStorage.getItem(key)), key);
    const card = (id) => page.locator(`#hand [data-card="${id}"]`);
    const ready = async () => {
      for (let i = 0; i < 375; i++) {
        if (await page.locator("#unveil-dialog").evaluate((d) => d.open))
          await page.locator("#unveil-take").click();
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
      await card(id).scrollIntoViewIfNeeded();
      await card(id).click();
      await card(id).click();
      await ready();
    };
    const pair = async (one, two) => {
      await ready();
      await card(one).scrollIntoViewIfNeeded();
      await card(one).click();
      await card(two).scrollIntoViewIfNeeded();
      await card(two).click();
      await card(two).click();
      await ready();
    };
    const signalShip = async () => {
      const s = await state();
      assert.ok(
        s.items.lamp.fuel >= 6,
        "the return was provisioned at the harbor",
      );
      if (!(await state()).items.lamp.lit) await playCard("lamp");
      for (let i = 0; i < 2; i++) {
        await pair("cloth", "lamp");
        await playCard("cloth");
      }
      assert.equal((await state()).locations.pond.shipSignal, 4);
    };
    const travel = async (id) => {
      const before = await state();
      const boarding =
        before.actors.vale.place === "pond" && id === "greek-harbor";
      if (before.actors.vale.place === "greek-harbor" && id === "pond") {
        if (before.items.lamp.lit) await playCard("lamp");
        while ((await state()).items.lamp.fuel < 7) await pair("oil", "lamp");
      }
      if (boarding) await signalShip();
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
      const option = page.locator(
        `[data-choice="${choiceId}"][data-pack="greek-drama"]`,
      );
      if (!(await option.isVisible())) {
        const opener = page.locator(`[data-choices-for="${action.cards[0]}"]`);
        await opener.scrollIntoViewIfNeeded();
        await opener.click();
      }
      if (["greek-helen-egypt", "greek-helen-troy"].includes(choiceId)) {
        const bounds = await page.locator("dialog.card-choices").boundingBox();
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
          [...document.querySelectorAll("#hand .card-frame")].every((frame) => {
            const bounds = frame.getBoundingClientRect();
            return [...frame.querySelectorAll(".card-options button")].every(
              (button) => {
                const option = button.getBoundingClientRect();
                return (
                  option.left >= bounds.left - 1 &&
                  option.right <= bounds.right + 1
                );
              },
            );
          }),
        ),
        "choice and conversation buttons fit their own card",
      );
    };

    await page.goto(
      `http://127.0.0.1:${server.address().port}/?table=${table}`,
    );
    await card("lamp").waitFor();
    assert.equal(await card("greek-harbor").count(), 0);
    await ready();
    await travel("greek-harbor");
    await travel("greek-courtyard");
    assert.equal(await card("greek-baker").count(), 1);
    await travel("greek-gate");
    assert.equal(await card("greek-antigone").count(), 1);
    assert.equal(await card("greek-guard").count(), 1);
    await choose("greek-hear-decree");
    await choose("greek-decline-burial");
    let current = await state();
    assert.equal(
      current.packs["greek-drama"].choices["greek-theban-response"],
      "refusal",
    );
    assert.equal(current.items.cloth.holder, "vale");
    assert.equal(rootHolder(current, "lamp"), "vale");
    assert.equal(rootHolder(current, "cloth"), "vale");
    const refusalTurn =
      current.packs["greek-drama"].receipts["greek-decline-burial"];
    await artReady();
    await page.screenshot({
      path: new URL(`thebes-${width}.png`, output).pathname,
      fullPage: true,
    });

    await page.reload();
    await card("greek-antigone").waitFor();
    await ready();
    current = await state();
    assert.equal(current.actors.vale.place, "greek-gate");
    assert.equal(
      current.packs["greek-drama"].choices["greek-theban-response"],
      "refusal",
    );
    assert.equal(
      current.packs["greek-drama"].receipts["greek-decline-burial"],
      refusalTurn,
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
    await card(evidence).waitFor();
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
      "refusal",
    );
    assert.equal(rootHolder(current, evidence), "vale");

    // A second tab's committed journey uses the same migration and UI rebuild.
    // Reopen the crossing through a real card play, not a forged state edit.
    await signalShip();
    current = await state();
    const updated = commit(current, "move", "greek-harbor");
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
      `Greek crossing, Theban refusal, ${branch} branch, custody, reload and return passed at ${width}px.`,
    );
    await page.close();
  }
} finally {
  await browser?.close();
  await new Promise((resolve) => server.close(resolve));
}
