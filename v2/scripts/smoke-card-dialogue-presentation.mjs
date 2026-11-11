// The action panel shows only while choosing (presentation.mjs, #2017): never
// over a typing line, which keeps its full card. A tap anywhere on a typing
// card finishes it; clicking off deselects. A shared reply under a choice
// hides the panel until it is read; a shared refusal waits for the line.
import assert from "node:assert/strict";
import { chromium } from "playwright";
import { createServer } from "../card-game/serve.mjs";
import { dispatchShared } from "../card-game/shared-world.mjs";
import * as W from "../card-game/world.mjs";
import { availableCards } from "../card-game/cards.mjs";
import {
  clearSelection,
  readyActionButton,
  selectCard,
  smokeWidths,
} from "./card-browser-helpers.mjs";

const server = createServer();
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ headless: true });
const LONG = (who) =>
  `${who} speaks slowly here. ` + "The water keeps its counsel. ".repeat(9);
const state = (page) =>
  page.evaluate(() => {
    const q = (s) => document.querySelector(s);
    return {
      panel: !q("#action-beat").hidden,
      buttons: q("#card-actions").children.length,
      status: q("#play-status").hidden ? null : q("#play-status").textContent,
      strip: q(".beat-stack").dataset.action === "true",
      front: q("#speech-row").hidden ? null : q("#speech-row").dataset.beat,
      typing: q("#dialogue-advance").dataset.revealing === "true",
      cooling: q("#hand").dataset.cooling === "true",
      thinking: !q("#story-status").hidden,
      caption: q("#beat-captions").lastElementChild?.textContent || "",
      note: q(".action-beat-note").hidden
        ? ""
        : q(".action-beat-note").textContent,
      selected: [
        ...document.querySelectorAll('#hand .card[aria-pressed="true"]'),
      ].map((c) => c.dataset.card),
    };
  });
// Words that fail are a silent "…" line (#2008's note and Retry are gone).
async function noFailureUi(page) {
  assert.equal(await page.locator("#story-retry, #story-error").count(), 0);
  assert.equal(await page.locator("[data-retry-words]").count(), 0);
  assert.doesNotMatch(
    await page.locator("body").innerText(),
    /didn.t arrive|\bRetry\b/u,
  );
}
async function until(page, test, label, tries = 160) {
  let last;
  for (let i = 0; i < tries; i++) {
    if (test((last = await state(page)))) return last;
    await page.waitForTimeout(50);
  }
  throw new Error(`${label}: ${JSON.stringify(last)}`);
}
async function open(width, path, route) {
  const touch = width < 500;
  const page = await browser.newPage({
    viewport: { width, height: touch ? 844 : 900 },
    isMobile: touch,
    hasTouch: touch,
  });
  page.setDefaultTimeout(12000);
  page.errors = [];
  page.on("pageerror", (e) => page.errors.push(e.message));
  await route(page);
  await page.goto(`${origin}/${path}`);
  await page.waitForFunction(
    () => document.querySelector("#hand").dataset.cooling === "false",
  );
  const tap = (locator) => (touch ? locator.tap() : locator.click());
  const choose = (id) => selectCard(page, id, { touch, exposedTop: touch });
  const shot = (name) =>
    page.screenshot({
      path: `${process.env.SHOTS || "output"}/${name}-${width}.png`,
    });
  // A choice during a typing line waits; the line keeps its full card.
  const waits = async (label) => {
    const s = await until(page, (s) => s.typing, label);
    assert(s.typing && !s.panel && !s.strip, `${label} ${JSON.stringify(s)}`);
    assert.equal(s.front, "speech", label);
  };
  // Taps on the portrait, not the words, finish each line.
  const readAll = async (choice = true) => {
    const done = (s) => (choice ? s.panel : !s.cooling);
    for (let i = 0; i < 40 && !done(await state(page)); i++) {
      await tap(page.locator("#speaker-portrait")).catch(() => {});
      await page.waitForTimeout(250);
    }
    return until(page, done, "the line is read and the choice can continue");
  };
  const clickOff = () => page.mouse.click(Math.round(width * 0.3), 140);
  return { page, tap, shot, choose, waits, readAll, clickOff };
}

async function local(width) {
  const world = W.createWorld();
  world.actors.vale.place = world.actors.moth.place = "pond";
  world.actors.moth.want = null;
  world.items.lamp.holder = "vale";
  const key = "cosyworld.reflected-shore.v1.present";
  let mode = "reply";
  const held = [];
  const t = await open(width, "?table=present", (page) =>
    Promise.all([
      page.addInitScript(
        ([key, save, seen]) => {
          localStorage.setItem(key, save);
          localStorage.setItem(`${key}.seen`, seen);
          localStorage.setItem("cosyworld.dialogue.sound", "off");
        },
        [key, W.encodeSave(world), JSON.stringify(availableCards(world))],
      ),
      page.route("**/card-game/text", (route) => {
        const { revision, entities } = route.request().postDataJSON();
        const entries = entities.map(({ id }) => ({ id, text: LONG(id) }));
        const reply = () =>
          mode === "fail"
            ? route.fulfill({ status: 503, body: "busy" })
            : route.fulfill({ json: { revision, model: "smoke", entries } });
        if (mode === "hold") held.push(reply);
        else reply();
      }),
    ]),
  );
  await t.choose("moth");
  await readyActionButton(t.page, "talk").click();
  await t.choose("pond");
  await t.waits(`local ${width} choose while typing`);
  await t.shot("local-choose-while-typing");
  await t.tap(t.page.locator("#speaker-portrait"));
  await until(t.page, (s) => !s.typing, "a tap finishes the line");
  const chosen = await t.readAll();
  assert.deepEqual(chosen.selected, ["pond"]);
  await t.clickOff();
  const off = await until(t.page, (s) => !s.panel && !s.strip, "click off");
  assert.deepEqual([off.selected, off.front], [[], "speech"]);
  await t.shot("local-clicked-off");
  // Holding lights the lamp; stowing puts it out without a turn or beat.
  const speaker = await t.page.locator("#speaker").innerText();
  const saved = () =>
    t.page.evaluate((key) => JSON.parse(localStorage.getItem(key)), key);
  const beforeHold = await saved();
  await t.choose("lamp");
  const holding = await saved();
  assert.equal(holding.actors.vale.heldItem, "lamp");
  assert.equal(holding.items.lamp.lit, true);
  assert.equal(holding.turn, beforeHold.turn);
  assert.deepEqual(holding.log, beforeHold.log, "holding makes no action beat");
  await t.shot("local-held-lamp");
  await clearSelection(t.page);
  const stowed = await saved();
  assert.equal(stowed.actors.vale.heldItem, null);
  assert.equal(stowed.items.lamp.lit, false);
  assert.equal(stowed.turn, beforeHold.turn);
  assert.deepEqual(stowed.log, beforeHold.log, "stowing makes no action beat");
  assert.equal((await state(t.page)).front, "speech");
  assert.equal(await t.page.locator("#speaker").innerText(), speaker);
  assert.equal(await t.page.locator("#live-line").isHidden(), true);
  await t.shot("local-stowed-lamp");
  // D3: a choice made after a play waits behind its Thinking card.
  mode = "hold";
  await t.choose("moth");
  await readyActionButton(t.page, "talk").click();
  await t.choose("pond");
  await t.page.waitForTimeout(300);
  const thinking = await until(t.page, (s) => s.thinking, "Thinking card");
  assert.equal(thinking.panel, false, "no panel beside the Thinking card");
  await t.shot("local-thinking-after-play");
  mode = "reply";
  await until(t.page, () => held.length, "a reply was requested");
  await held.shift()();
  await t.waits(`local ${width} reply after a play`);
  // A new line never pulls a player who stepped back forward (#2017).
  await t.tap(t.page.locator("#speaker-portrait"));
  const unread = await t.page.locator("#dialogue-text").innerText();
  await t.page.locator("#beat-behind").click({ position: { x: 80, y: 6 } });
  const back = await t.page.locator("#speech-row").innerText();
  // Unread dialogue stays ahead; only returning Live can advance it.
  await t.page.waitForFunction(
    () => /·\s*[1-9]/.test(document.querySelector("#live-line").textContent),
    null,
    { timeout: 15000 },
  );
  assert.equal(await t.page.locator("#speech-row").innerText(), back);
  await t.page.locator("#live-line").click();
  assert.equal(await t.page.locator("#dialogue-text").innerText(), unread);
  // D5: a play chosen while the last line rests shows Thinking at once.
  await t.readAll();
  mode = "hold";
  await readyActionButton(t.page).click();
  await until(t.page, (s) => s.thinking && !s.panel, "Thinking at once", 16);
  // Words that fail are "…" on the speaker's beat, and a choice comes
  // forward with no failure note and no Retry.
  mode = "fail";
  await until(t.page, () => held.length, "the pending play requested words");
  await held.shift()();
  await until(
    t.page,
    (s) => s.front === "silent" && !s.thinking && !s.typing,
    "… after a failure",
  );
  assert.equal(await t.page.locator("#dialogue-text").innerText(), "…");
  await noFailureUi(t.page);
  await t.choose("pond");
  const failed = await until(t.page, (s) => s.panel, "a choice after failure");
  assert.equal(failed.note, "");
  await noFailureUi(t.page);
  assert.deepEqual(t.page.errors, []);
  await t.page.close();
}

async function shared(width) {
  let world = dispatchShared({
    op: "create",
    save: W.encodeSave(W.createWorld()),
  }).world;
  let queue = [],
    history = [],
    notice = null;
  const seat = { actor: "vale", claimed: ["vale"], present: ["vale"] };
  const view = () => ({
    ...dispatchShared({ op: "view", world, ...seat }),
    id: "present",
    version: "full-card-world/9",
    claimed: [1, 0, 0, 0, 0, 0, 0, 0],
    present: [1, 0, 0, 0, 0, 0, 0, 0],
    now: Date.now(),
    queue: queue.map(({ action, ...entry }) => entry),
    history,
    notice,
  });
  // Commit the queued play with a long line; `as` names another play, so
  // the player's own reads as refused.
  const commit = (as) => {
    const [entry] = queue;
    world = dispatchShared({
      op: "play",
      world,
      ...seat,
      action: entry.action,
    }).world;
    const place = world.actors.vale.place;
    const speech = { generated: true, kind: "dialogue", actorId: "vale" };
    W.addLog(world, "Vale", LONG("Vale"), { ...speech, locationId: place });
    const at = Date.now();
    const lines = [world.log.at(-1)];
    history = [{ play: as || entry.id, room: place, actor: "vale", lines }];
    Object.assign(history[0], { turn: world.turn, starts_at: at });
    history[0].until_at = at + 30000;
    queue = [];
    if (as) notice = "That play has changed. Check the cards.";
  };
  const t = await open(width, "?world=present", (page) =>
    Promise.all([
      page.addInitScript((seen) => {
        localStorage.setItem(
          "cosyworld.reflected-shore.v1.shared.present.vale.seen",
          JSON.stringify(seen),
        );
        localStorage.setItem("cosyworld.dialogue.sound", "off");
      }, availableCards(world)),
      page.route("**/auth/account", (r) =>
        r.fulfill({ json: { authenticated: true, user_id: "smoke-user", account_revision: 0 } }),
      ),
      page.route(/shared\/worlds\/present(?:\/command)?$/, (route) => {
        const body = route.request().postDataJSON();
        if (body?.op === "play")
          queue = [{ id: body.key, actor: "vale", status: "waiting", ...body }];
        route.fulfill({ json: view() });
      }),
    ]),
  );
  const playWait = async () => {
    await t.choose("vale");
    await readyActionButton(t.page).click();
    await until(t.page, () => queue.length, "the shared play was queued");
  };
  // A reply under a choice hides the panel until it is read.
  await playWait();
  await t.choose("lamp");
  await until(t.page, (s) => s.thinking && !s.panel, "shared Thinking alone");
  commit();
  await t.waits(`shared ${width} reply under a choice`);
  await t.shot("shared-reply-under-choice");
  const back = await t.readAll();
  assert(back.selected.includes("lamp") && back.buttons > 0);
  await t.clickOff();
  await until(t.page, (s) => !s.panel && !s.selected.length, "click off");
  // A refusal while a line types waits for the line.
  await playWait();
  await t.clickOff();
  commit("another-play");
  await t.waits(`shared ${width} refusal while typing`);
  await t.tap(t.page.locator("#speaker-portrait"));
  const refused = await until(t.page, (s) => s.status, "refusal after line");
  assert.match(refused.status, /^Not played: /);
  await t.shot("shared-refusal-after-line");
  assert.deepEqual(t.page.errors, []);
  await t.page.close();
}

// A reload shows a line already begun in full (D8) and asks again for words
// it interrupted (D9). A reply over 400 characters fails visibly, after its
// one retry, rather than holding Thinking.
async function reloads(width) {
  const world = W.createWorld();
  world.actors.vale.place = world.actors.moth.place = "pond";
  world.actors.moth.want = null;
  const key = "cosyworld.reflected-shore.v1.reload";
  let length = 280,
    asked = 0;
  const held = [];
  const t = await open(width, "?table=reload", (page) =>
    Promise.all([
      page.addInitScript(
        ([key, save, seen]) => {
          if (sessionStorage.getItem("seeded")) return;
          sessionStorage.setItem("seeded", "1");
          localStorage.setItem(key, save);
          localStorage.setItem(`${key}.seen`, seen);
          localStorage.setItem("cosyworld.dialogue.sound", "off");
        },
        [key, W.encodeSave(world), JSON.stringify(availableCards(world))],
      ),
      page.route("**/card-game/text", (route) => {
        asked++;
        const { revision, entities } = route.request().postDataJSON();
        const text = "Slowly. ".repeat(length / 8);
        const entries = entities.map(({ id }) => ({ id, text }));
        held.push(() =>
          route.fulfill({ json: { revision, model: "smoke", entries } }),
        );
      }),
    ]),
  );
  const play = async () => {
    await t.choose("moth");
    await readyActionButton(t.page, "talk").click();
    await until(t.page, () => held.length, "a reply was requested");
  };
  // D9: a reload while Thinking asks again instead of failing.
  await play();
  const before = asked;
  await t.page.reload();
  await until(t.page, (s) => s.thinking, "Thinking again after reload");
  await until(
    t.page, () => asked > before, "reload requests the interrupted reply",
  );
  await noFailureUi(t.page);
  await t.shot("reload-thinking");
  // D8: a reload mid-line shows the line whole.
  await held.at(-1)();
  await t.waits(`reload ${width} typing`);
  await t.page.reload();
  const whole = await until(t.page, (s) => s.front === "speech", "line");
  assert.equal(whole.typing, false, "a line begun before reload shows whole");
  await t.shot("reload-whole-line");
  // A reply too long to accept is "…" after its one quiet retry.
  length = 504;
  // Reload cleared the choice, so finish reading without expecting a panel.
  await t.readAll(false);
  await t.page.keyboard.press("Escape");
  held.length = 0;
  await play();
  await held.shift()();
  await until(t.page, () => held.length, "a reply was requested");
  await held.shift()();
  await until(t.page, (s) => s.front === "silent", "… for a long reply");
  await noFailureUi(t.page);
  assert.deepEqual(t.page.errors, []);
  await t.page.close();
}

try {
  for (const width of smokeWidths([1440, 390])) {
    await reloads(width);
    await local(width);
    await shared(width);
    console.log(`Dialogue presentation passed at ${width}px.`);
  }
} finally {
  await browser.close();
  server.close();
}
