import { greekTravelTargets } from "../../test/helpers/greek-travel.mjs";
import {
  endStandoff,
  revealCard,
  selectCard,
} from "./card-browser-helpers.mjs";
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { chromium } from "playwright";
import { createServer } from "../card-game/serve.mjs";
import {
  createWorld,
  legalActions,
  play,
  encodeSave,
  decodeSave,
} from "../card-game/world.mjs";
import { summonTransport } from "../card-game/pack-transport.mjs";
const output = new URL("../../output/theban-scenery/", import.meta.url);
await mkdir(output, { recursive: true });
const act = (s, kind, fields = {}) => {
  const a = legalActions(s).find(
    (a) =>
      a.kind === kind && Object.entries(fields).every(([k, v]) => a[k] === v),
  );
  assert(a, `${kind} ${JSON.stringify(fields)}`);
  const r = play(s, a);
  assert(r.ok, r.error);
  return r.state;
};
function initial() {
  let s = createWorld({ opening: true });
  // Keep the ship at harbor until this scenery fixture completes the signal.
  s.actors["greek-rhapsode"].place = "attic";
  // The opening starts lit; douse it to open the mirror, then relight it at
  // the pond for the ship signal (#1653).
  s = act(s, "snuff");
  s = act(s, "move", { target: "pond" });
  s = act(s, "light");
  s.items.cloth.holder = "vale";
  s.items.lamp.fuel = 12;
  s.items.bell.holder = "station";
  s.actors.moth.place = "station";
  s.actors.keeper.place = "station";
  return s;
}
const server = createServer();
await new Promise((r) => server.listen(0, "127.0.0.1", r));
let browser;
const results = [];
try {
  browser = await chromium.launch({
    headless: true,
    ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE
      ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE }
      : {}),
  });
  for (const [width, height] of [
    [1440, 900],
    [390, 844],
  ]) {
    const page = await browser.newPage({
      viewport: { width, height },
      reducedMotion: "reduce",
    });
    page.setDefaultTimeout(12000);
    const errors = [],
      failed = [];
    page.on("pageerror", (e) => errors.push(e.message));
    page.on("response", (r) => {
      if (r.status() >= 400 && r.url().includes("/assets/"))
        failed.push(r.url());
    });
    await page.route("**/card-game/text", async (route) => {
      const c = route.request().postDataJSON();
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          revision: c.revision,
          model: "theban-scenery-fixture",
          entries: c.entities.map(({ id }) => ({
            id,
            text: "There is room beside the table.",
          })),
        }),
      });
    });
    const key = `cosyworld.reflected-shore.v1.theban-scenery-${width}`;
    await page.addInitScript(
      ({ key, save }) => {
        if (!localStorage.getItem(key)) localStorage.setItem(key, save);
        localStorage.setItem("cosyworld.dialogue.sound", "off");
        localStorage.setItem(
          "cosyworld.room-music",
          JSON.stringify({ enabled: false, volume: 0 }),
        );
      },
      { key, save: encodeSave(initial()) },
    );
    const state = () =>
        page.evaluate((key) => JSON.parse(localStorage.getItem(key)), key),
      card = (id) => page.locator(`#hand [data-card="${id}"]`);
    async function ready() {
      for (let i = 0; i < 200; i++) {
        if (await page.locator("#dialogue-advance").isVisible())
          await page.locator("#dialogue-advance").click();
        if (
          (await page.locator("#hand").getAttribute("data-cooling")) === "false"
        )
          return;
        await page.waitForTimeout(30);
      }
      throw Error("hand remained busy");
    }
    async function use(...ids) {
      await ready();
      if (await endStandoff(page, await state())) await ready();
      if (ids.length === 1) {
        const steps = greekTravelTargets(
          (await state()).actors.vale.place,
          ids[0],
        );
        if (steps.length > 1) {
          for (const step of steps) await use(step);
          return;
        }
      }
      // A held item stays raised after its play; start each play fresh.
      await page.keyboard.press("Escape");
      for (const id of ids) {
        await selectCard(page, id);
      }
      await page.locator("#card-actions .card-primary").click();
      await ready();
    }
    async function shot(name) {
      await page.waitForFunction(() =>
        [
          ...document.querySelectorAll("#hand img,#backdrop,.location-overlay"),
        ].every((i) => i.complete && i.naturalWidth > 0),
      );
      await page.keyboard.press("Escape");
      await page.locator("#hand").evaluate((h) => (h.scrollLeft = 0));
      assert(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth + 1,
        ),
      );
      assert.equal(
        await page.locator(".inspiration-meter,#hand-tip,#quest-guide").count(),
        0,
      );
      await page.screenshot({
        path: new URL(`${name}-${width}.png`, output).pathname,
      });
    }
    try {
      await page.goto(
        `http://127.0.0.1:${server.address().port}/?table=theban-scenery-${width}`,
      );
      await card("cloth").waitFor({ state: "attached" });
      await shot("pond-empty");
      assert.equal(
        await card("greek-ship").count(),
        (await state()).transports["greek-ship"].dock === "pond" ? 1 : 0,
      );
      // Cover, then uncover, the lit lamp; the call survives a reload.
      await use("cloth", "lamp");
      await use("cloth");
      await page.reload();
      await card("cloth").waitFor({ state: "attached" });
      // A newly docked ship arrives covered; uncover it before reading it.
      await revealCard(page, "greek-ship");
      assert.equal(
        await card("greek-ship").locator(".name").innerText(),
        "Greek ship",
      );
      assert(
        new URL(
          await card("greek-ship").locator(".art img").getAttribute("src"),
        ).pathname.endsWith("ship-card.webp"),
      );
      await shot("pond-ship");
      await use("greek-ship");
      assert.equal((await state()).actors.vale.place, "greek-ship");
      await shot("aboard-ship");
      // Aboard, the ship's own card shows the deck, not the Black Pond.
      assert.match(
        await card("greek-ship").locator(".art img").getAttribute("src"),
        /ship-deck/,
      );
      // The harbor card sets the course; a round at sea, then Disembark.
      await use("greek-harbor");
      assert.equal((await state()).transports["greek-ship"].phase, "sea");
      await shot("at-sea");
      await use("vale");
      await use("greek-harbor");
      assert.equal((await state()).packs["greek-drama"].scope, "opening");
      await use("lamp");
      if (await endStandoff(page, await state())) await ready();
      await shot("harbor");
      const harborSave = await page.evaluate(
        (key) => localStorage.getItem(key),
        key,
      );
      for (const [dock, file] of [
        ["pond", "harbor-open-berth.webp"],
        ["greek-harbor", "harbor-ship-at-berth.webp"],
      ]) {
        const harborState = decodeSave(harborSave);
        summonTransport(harborState, "greek-ship", dock);
        await page.evaluate(
          ({ key, save }) => localStorage.setItem(key, save),
          {
            key,
            save: encodeSave(harborState),
          },
        );
        await page.reload();
        await card("greek-harbor").waitFor({ state: "attached" });
        assert(
          new URL(
            await page.locator("#backdrop").getAttribute("src"),
          ).pathname.endsWith(file),
        );
        assert(
          new URL(
            await card("greek-harbor").locator(".art img").getAttribute("src"),
          ).pathname.endsWith(file),
        );
        assert.equal(
          await card("greek-ship").count(),
          dock === "greek-harbor" ? 1 : 0,
        );
        if (dock === "greek-harbor")
          assert.match(
            await card("greek-ship").locator(".art img").getAttribute("src"),
            /harbor-ship-at-berth/,
          );
        await shot(file.replace(".webp", ""));
      }
      const visited = new Set(["greek-ship", "greek-harbor"]);
      for (const id of [
        "greek-courtyard",
        // The Market Well lies within the courtyard and opens only onto it.
        "greek-well",
        "greek-courtyard",
        "greek-palace",
        // The sanctuary lies beyond the palace forecourt.
        "greek-sanctuary",
        "greek-palace",
        "greek-courtyard",
        "greek-gate",
        "greek-battlefield",
        "greek-gate",
        "greek-courtyard",
        "greek-harbor",
      ]) {
        await use(id);
        assert.equal((await state()).actors.vale.place, id);
        assert(
          new URL(
            await page.locator("#backdrop").getAttribute("src"),
          ).pathname.endsWith(".webp"),
        );
        const destinations = await page
          .locator("#hand [data-card]")
          .evaluateAll((cards) => cards.map((c) => c.dataset.card));
        for (const hidden of [
          "greek-athens",
          "greek-argolid-road",
          "greek-aulis",
          "greek-cithaeron",
        ])
          assert(!destinations.includes(hidden));
        if (!visited.has(id)) {
          await shot(id.replace("greek-", ""));
          visited.add(id);
        }
        // The gate opens onto the battlefield while the guard holds the
        // decree there; until then no card leads out.
        const decree = (await state()).items["greek-decree"].holder;
        if (id === "greek-palace" && !visited.has("greek-sanctuary"))
          await use("greek-decree");
        if (id === "greek-gate" && decree === "vale") {
          assert(!destinations.includes("greek-battlefield"));
          await use("greek-decree", "greek-guard");
        }
      }
      assert.deepEqual([...visited].sort(), [
        "greek-battlefield",
        "greek-courtyard",
        "greek-gate",
        "greek-harbor",
        "greek-palace",
        "greek-sanctuary",
        "greek-ship",
        "greek-well",
      ]);
      await page.reload();
      await card("greek-ship").waitFor({ state: "attached" });
      await use("greek-ship");
      await use("pond");
      await use("vale");
      await use("pond");
      assert.equal((await state()).actors.vale.place, "pond");
      assert.equal(await card("greek-harbor").count(), 0);
      assert.equal(await card("greek-ship").count(), 1);
      await shot("return");
      assert.deepEqual(errors, []);
      assert.deepEqual(failed, []);
      results.push({
        width,
        height,
        visited: [...visited],
        passed: true,
        pageErrors: errors,
        failedAssets: failed,
      });
    } catch (e) {
      results.push({
        width,
        passed: false,
        message: e.message,
        pageErrors: errors,
        failedAssets: failed,
      });
      await page
        .screenshot({ path: new URL(`failure-${width}.png`, output).pathname })
        .catch(() => {});
      throw e;
    } finally {
      await writeFile(
        new URL("report.json", output),
        JSON.stringify(results, null, 2),
      );
      await page.close();
    }
  }
} finally {
  await browser?.close();
  await new Promise((r) => server.close(r));
}
console.log(
  "Theban painted opening: seven places, quiet ritual, reload and return passed at desktop and phone widths.",
);
