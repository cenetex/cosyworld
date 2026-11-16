import assert from "node:assert/strict";
import { chromium } from "playwright";
import { createServer } from "../card-game/serve.mjs";
import { addLog, createWorld, encodeSave } from "../card-game/world.mjs";
import { availableCards } from "../card-game/cards.mjs";
import {
  readyActionButton,
  selectCard,
  smokeWidths,
} from "./card-browser-helpers.mjs";

const REJECTED = "That play could not be made. The world is as it was.";
const UNSAVED =
  "This browser could not save the world. Keep this tab open to keep playing.";
const CANARY = "Save recovery canary 7c1e";
const DIAGNOSTIC_KEYS = [
  "build",
  "check",
  "code",
  "ids",
  "revision",
  "schema",
  "turn",
];
const faults = [
  {
    name: "play",
    code: "save.transition.play",
    reason: REJECTED,
    check: "TypeError: fixture play fault",
  },
  {
    name: "encode",
    code: "save.transition.successor",
    reason: REJECTED,
    check: null,
  },
  {
    name: "readback",
    code: "save.transition.successor",
    reason: REJECTED,
    check: null,
  },
  {
    name: "write",
    code: "save.storage.write",
    reason: UNSAVED,
    check: null,
    advances: true,
  },
];

const server = createServer();
await new Promise((done) => server.listen(0, "127.0.0.1", done));
const origin = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ headless: true });

function fixture() {
  const world = createWorld();
  const place = world.actors.vale.place;
  addLog(world, "Vale", CANARY, {
    actorId: "vale",
    entityId: "vale",
    locationId: place,
    kind: "dialogue",
    generated: true,
  });
  return { save: encodeSave(world), seen: availableCards(world), place };
}

async function run(width, fault) {
  const table = `save-recovery-${fault.name}-${width}`;
  const key = `cosyworld.reflected-shore.v1.${table}`;
  const { save, seen, place } = fixture();
  const touch = width === 390;
  const page = await browser.newPage({
    viewport: { width, height: touch ? 844 : 900 },
    reducedMotion: "reduce",
    hasTouch: touch,
  });
  page.setDefaultTimeout(15000);
  const errors = [],
    logged = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.text().startsWith("[save]")) logged.push(message.text());
  });
  await page.route("**/card-game/text", (route) =>
    route.fulfill({ status: 503, json: { error: "fixture" } }),
  );
  await page.addInitScript(
    ({ key, save, seen }) => {
      if (!sessionStorage.getItem("seeded")) {
        sessionStorage.setItem("seeded", "1");
        localStorage.setItem(key, save);
        localStorage.setItem(`${key}.seen`, JSON.stringify(seen));
        localStorage.setItem("cosyworld.dialogue.sound", "off");
        localStorage.setItem(
          "cosyworld.room-music",
          JSON.stringify({ enabled: false }),
        );
      }
      const take = (name, match) => {
        if (window.__fault !== name || !match) return false;
        window.__fault = null;
        return true;
      };
      const worldLike = (value) =>
        Boolean(value?.actors && Number.isInteger(value.revision));
      const clone = globalThis.structuredClone;
      globalThis.structuredClone = (value, ...rest) => {
        if (take("play", worldLike(value)))
          throw new TypeError("fixture play fault");
        return clone(value, ...rest);
      };
      const stringify = JSON.stringify;
      JSON.stringify = (value, ...rest) => {
        if (take("encode", worldLike(value)))
          throw new Error("fixture encode fault");
        return stringify(value, ...rest);
      };
      const parse = JSON.parse;
      JSON.parse = (text, ...rest) => {
        if (
          take(
            "readback",
            typeof text === "string" && text.includes('"actors"'),
          )
        )
          throw new Error("fixture readback fault");
        return parse(text, ...rest);
      };
      const setItem = Storage.prototype.setItem;
      Storage.prototype.setItem = function (name, value) {
        if (take("write", this === localStorage && name === key))
          throw new DOMException("fixture quota", "QuotaExceededError");
        return setItem.call(this, name, value);
      };
    },
    { key, save, seen },
  );
  const stored = () => page.evaluate((key) => localStorage.getItem(key), key);
  const tableNow = () =>
    page.evaluate(() => ({
      place: document.querySelector("#place-title").textContent,
      hand: [...document.querySelectorAll("#hand [data-card]")]
        .map((card) => card.dataset.card)
        .sort(),
    }));
  const status = page.locator("#play-status");
  const settle = async () => {
    await page.waitForFunction(() => document.body.inert === false);
    await page.waitForFunction(
      () => document.querySelector("#hand").dataset.cooling === "false",
    );
  };
  const wait = async (arm) => {
    await settle();
    for (const card of ["vale", place]) {
      const pressed = await page
        .locator(`#hand [data-card="${card}"]`)
        .getAttribute("aria-pressed");
      if (pressed !== "true") await selectCard(page, card, { touch });
    }
    const button = readyActionButton(page, "wait");
    await button.waitFor();
    assert.equal(await page.locator("#card-actions button").count(), 1);
    await page.evaluate((arm) => {
      window.__fault = arm;
    }, arm);
    if (touch) await button.tap();
    else await button.click();
  };
  const noReset = async () => {
    const offered = await page.evaluate(() =>
      [...document.querySelectorAll("button")]
        .filter((button) => button.getClientRects().length)
        .map(
          (button) =>
            `${button.textContent} ${button.getAttribute("aria-label")}`,
        )
        .filter((words) => /new game/i.test(words)),
    );
    assert.deepEqual(offered, [], `${fault.name}: New game was offered`);
    assert.equal(await page.locator("#reset-dialog[open]").count(), 0);
  };
  try {
    await page.goto(`${origin}/?table=${table}`);
    await settle();
    let kept = await stored();
    assert(kept.includes(CANARY));
    const first = JSON.parse(kept);
    const before = await tableNow();
    let revision = first.revision;
    for (let attempt = 1; attempt <= 3; attempt++) {
      await wait(fault.name);
      await page.waitForFunction(
        (reason) =>
          document.querySelector("#play-status").textContent === reason,
        fault.reason,
      );
      assert.equal(await status.isVisible(), true);
      assert.equal(await page.evaluate(() => window.__fault), null);
      assert.equal(await stored(), kept, `${fault.name}: stored bytes changed`);
      assert.equal(logged.length, attempt);
      const text = logged.at(-1).slice("[save] ".length);
      const diagnostic = JSON.parse(text);
      assert.deepEqual(Object.keys(diagnostic).sort(), DIAGNOSTIC_KEYS);
      assert.equal(diagnostic.code, fault.code);
      assert.equal(diagnostic.check, fault.check);
      assert.equal(diagnostic.schema, first.schema);
      if (fault.advances) revision += 1;
      assert.equal(diagnostic.revision, revision);
      assert.equal(diagnostic.ids.includes("wait"), !fault.advances, text);
      assert(text.length < 400, text);
      assert(!text.includes(CANARY) && !text.includes("actors"), text);
      assert(!(await page.locator("body").innerText()).includes("fixture"));
      await noReset();
      if (!fault.advances) assert.deepEqual(await tableNow(), before);
    }
    if (!fault.advances) {
      await wait(null);
      await page.waitForFunction(
        ([key, kept]) => localStorage.getItem(key) !== kept,
        [key, kept],
      );
      kept = await stored();
      assert.equal(JSON.parse(kept).revision, first.revision + 1);
      assert.equal(JSON.parse(kept).turn, first.turn + 1);
      assert.equal(logged.length, 3);
      await wait(fault.name);
      await page.waitForFunction(
        (reason) =>
          document.querySelector("#play-status").textContent === reason,
        fault.reason,
      );
      assert.equal(await stored(), kept);
    }
    const shown = await tableNow();
    await page.reload();
    await settle();
    assert.equal(
      await stored(),
      kept,
      `${fault.name}: reload changed the save`,
    );
    assert.deepEqual(await tableNow(), fault.advances ? before : shown);
    assert.equal(await status.isVisible(), false);
    await noReset();
    await wait(null);
    await page.waitForFunction(
      ([key, kept]) => localStorage.getItem(key) !== kept,
      [key, kept],
    );
    assert.equal(
      JSON.parse(await stored()).revision,
      JSON.parse(kept).revision + 1,
    );
    assert.deepEqual(errors, []);
    console.log(`${fault.name} fault kept the last valid save at ${width}px`);
  } finally {
    await page.close();
  }
}

try {
  for (const width of smokeWidths([1440, 390]))
    for (const fault of faults) await run(width, fault);
  console.log("Save recovery smoke passed.");
} finally {
  await browser.close();
  await new Promise((done) => server.close(done));
}
