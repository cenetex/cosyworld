import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { chromium } from "playwright";
import { DAYLIGHT_TURNS } from "../card-game/pack-rules.mjs";
import { heldItem } from "../card-game/held-item.mjs";
import { profiles } from "../card-game/memory.mjs";
import { createServer } from "../card-game/serve.mjs";
import { dispatchShared } from "../card-game/shared-world.mjs";
import { createWorld, encodeSave, exits } from "../card-game/world.mjs";
import {
  clearSelection,
  readyActionButton,
  selectCard,
  settleHand,
} from "./card-browser-helpers.mjs";

const wayfinder = "elysium-wayfinder";
const entry = "elysium-void-001";
const encounterRoom = "elysium-void-002";
const resident = "elysium-claude";
const identity = "Vesper Ink";
const token = `${resident}-token`;
const id = "elysium-voyage-smoke";
const actors = ["vale", "mara"];
const generatedPortrait = await readFile(
  new URL("../card-game/assets/elysium/resident.png", import.meta.url),
);

function ordinaryStart() {
  for (let seed = 1; seed <= 128; seed++) {
    const initial = createWorld({ seed });
    if (initial.items[wayfinder]?.holder !== "station") continue;
    initial.actors.vale.place = "station";
    initial.revision = initial.turn = DAYLIGHT_TURNS - 2;
    const { world } = dispatchShared({
      op: "create",
      save: encodeSave(initial),
    });
    world.actors.mara.place = "pond";
    return world;
  }
  assert.fail("a seeded run places the Wayfinder at the Empty Station");
}

const server = createServer();
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const worldPath = `/card-game/shared/worlds/${id}`;
let browser;

try {
  let world = ordinaryStart();
  let introduction = null;
  let portraitReady = false;
  const resourceRequests = [];
  const errors = [];
  const dispatch = (actor, command) =>
    dispatchShared({
      ...command,
      world,
      actor,
      claimed: actors,
      present: actors,
    });
  const actions = (actor) => dispatch(actor, { op: "view" }).actions;
  const moveOffered = (actor) =>
    actions(actor).some(
      (action) => action.kind === "move" && action.target === entry,
    );
  browser = await chromium.launch({ headless: true });

  async function join(actor, width) {
    const page = await browser.newPage({
      viewport: { width, height: 844 },
      reducedMotion: "reduce",
      hasTouch: width === 390,
    });
    page.setDefaultTimeout(15000);
    page.on("pageerror", (error) => errors.push(error.message));
    await page.addInitScript(
      ({ key, known }) => {
        localStorage.setItem(`${key}.seen`, JSON.stringify(known));
        localStorage.setItem("cosyworld.dialogue.sound", "off");
        localStorage.setItem(
          "cosyworld.room-music",
          JSON.stringify({ enabled: false }),
        );
      },
      {
        key: `cosyworld.reflected-shore.v1.shared.${id}.${actor}`,
        known: Object.keys(profiles).filter((card) => card !== wayfinder),
      },
    );
    await page.route("**/auth/account", (route) =>
      route.fulfill({
        json: {
          authenticated: true,
          user_id: `smoke-${actor}`,
          account_revision: 0,
        },
      }),
    );
    await page.route(`**${worldPath}/elysium-identity/${resident}`, (route) => {
      resourceRequests.push({ actor, kind: "name" });
      if (!introduction) return route.fulfill({ status: 404 });
      return route.fulfill({ json: { name: identity } });
    });
    await page.route(`**${worldPath}/elysium-portrait/${resident}`, (route) => {
      resourceRequests.push({ actor, kind: "portrait" });
      if (!portraitReady || !world.elysiumEncounters?.[resident]?.returnedAt)
        return route.fulfill({ status: 404 });
      return route.fulfill({
        contentType: "image/png",
        headers: { "cache-control": "private, no-store" },
        body: generatedPortrait,
      });
    });
    await page.route(`**${worldPath}{,/command}`, async (route) => {
      const request = route.request();
      const command =
        request.method() === "POST" ? request.postDataJSON() : null;
      if (command && ["play", "hold"].includes(command.op)) {
        const result = dispatch(actor, { ...command, choice: command.action });
        if (!result.ok) return route.fulfill({ status: 409, json: result });
        world = result.world;
        if (result.events?.some((event) => event.elysiumModel === resident)) {
          const speech = dispatch(actor, {
            op: "speech",
            lines: [{ actorId: resident, text: `I am ${identity}.` }],
          });
          world = speech.world;
          const starts_at = Date.now();
          introduction = {
            actor,
            play: command.key,
            room: encounterRoom,
            turn: world.turn,
            starts_at,
            until_at: starts_at + 30000,
            lines: speech.lines,
          };
        }
      }
      await route.fulfill({
        json: {
          ...dispatch(actor, { op: "view" }),
          id,
          now: Date.now(),
          claimed: [1, 1, 0, 0, 0, 0, 0, 0],
          present: [1, 1, 0, 0, 0, 0, 0, 0],
          history: introduction ? [introduction] : [],
          queue: [],
        },
      });
    });
    await page.goto(`${origin}/?world=${id}`);
    await atRevision(page).catch((error) => {
      throw new Error(
        `${actor} cannot open the shared voyage: ${errors.join("; ")}`,
        { cause: error },
      );
    });
    return page;
  }

  const atRevision = (page) =>
    page.waitForFunction(
      (revision) =>
        document.querySelector("#hand")?.dataset.presentedRevision ===
        String(revision),
      world.revision,
    );
  const vale = await join("vale", 390);
  const mara = await join("mara", 1440);
  const card = (page, cardId) => page.locator(`#hand [data-card="${cardId}"]`);
  const commandResponse = (op) =>
    vale.waitForResponse((response) => {
      const request = response.request();
      return (
        new URL(response.url()).pathname === `${worldPath}/command` &&
        request.method() === "POST" &&
        request.postDataJSON().op === op
      );
    });
  const withCommand = async (op, perform) => {
    const [answered] = await Promise.all([commandResponse(op), perform()]);
    assert(answered.ok(), await answered.text());
    await atRevision(vale);
  };

  async function play(kind, target, item) {
    await settleHand(vale);
    const action = actions("vale").find(
      (candidate) =>
        candidate.kind === kind &&
        (!target || candidate.target === target || candidate.item === target) &&
        (!item || candidate.item === item),
    );
    assert(
      action,
      `${kind} ${target ?? ""} is offered at ${world.actors.vale.place}`,
    );
    await vale.keyboard.press("Escape");
    if (kind === "take" && !(await card(vale, target).isVisible()))
      await selectCard(vale, world.actors.vale.place, { touch: true });
    for (const selected of action.cards.length ? action.cards : ["vale"]) {
      if ((await card(vale, selected).getAttribute("aria-pressed")) === "true")
        continue;
      const choose = () => selectCard(vale, selected, { touch: true });
      if (
        world.items[selected]?.holder === "vale" &&
        heldItem(world, "vale") !== selected
      )
        await withCommand("hold", choose);
      else await choose();
    }
    const turn = world.turn;
    await withCommand("play", () =>
      readyActionButton(vale, kind).first().click(),
    ).catch(async (error) => {
      const buttons = await vale.locator("#card-actions").innerText();
      throw new Error(
        `${kind} ${target ?? ""} at ${world.actors.vale.place}: ${buttons}`,
        { cause: error },
      );
    });
    assert.equal(world.turn, turn + 1, `${kind} commits through the hand`);
    if (kind === "move") {
      assert.equal(world.actors.vale.place, target);
      await vale.waitForFunction(
        (place) => document.body.dataset.place === place,
        target,
      );
    }
  }

  function walkTo(destination) {
    const start = world.actors.vale.place;
    const queue = [[start, []]];
    const seen = new Set([start]);
    for (const [place, path] of queue) {
      if (place === destination) return path;
      for (const next of exits(world, place, "vale")) {
        if (seen.has(next) || next.startsWith("elysium-")) continue;
        seen.add(next);
        queue.push([next, [...path, next]]);
      }
    }
    assert.fail(`no ordinary way to ${destination} from ${start}`);
  }

  assert.equal(
    await card(mara, entry).count(),
    0,
    "Black Pond has no permanent Elysium card",
  );
  assert.equal(world.items[token].holder, resident);
  await card(vale, wayfinder).waitFor({ state: "attached" });
  await play("take", wayfinder);
  assert.equal(world.items[wayfinder].holder, "vale");
  assert.equal(heldItem(world, "vale"), wayfinder);
  assert.equal(
    moveOffered("vale"),
    false,
    "holding the Wayfinder in daylight does not open Elysium",
  );

  await withCommand("hold", () => clearSelection(vale));
  await play("wait");
  assert.equal(world.turn, DAYLIGHT_TURNS);
  assert.equal(heldItem(world, "vale"), null);
  assert.equal(
    moveOffered("vale"),
    false,
    "the carried but unheld Wayfinder leaves the night route shut",
  );
  await withCommand("hold", () => selectCard(vale, wayfinder, { touch: true }));
  assert(
    moveOffered("vale"),
    "the held Wayfinder opens a night route from the Empty Station",
  );
  assert.equal(moveOffered("mara"), false);
  await play("move", entry);
  assert.equal(heldItem(world, "vale"), wayfinder);
  await atRevision(mara);
  assert.equal(
    world.actors.mara.place,
    "pond",
    "the other player stays at Black Pond",
  );
  assert.equal(await card(mara, entry).count(), 0);
  await play("move", encounterRoom);

  const name = card(vale, resident).locator(".name");
  assert.match(await name.textContent(), /Resident of Void 002/u);
  const figures = [
    `#cast [data-avatar="${resident}"] .portrait-body > img`,
    `#hand [data-card="${resident}"] .art > img`,
  ];
  const awaitPortrait = (generated) =>
    vale.waitForFunction(
      ({ figures, generated }) =>
        figures.every((selector) => {
          const img = document.querySelector(selector);
          return (
            img?.naturalWidth > 0 &&
            img.src.startsWith("data:image/png;base64,") === generated
          );
        }),
      { figures, generated },
    );
  await awaitPortrait(false);
  assert.deepEqual(resourceRequests, []);
  assert.equal(world.items[token].holder, resident);
  await withCommand("hold", () => clearSelection(vale));
  await play("talk", resident);
  await settleHand(vale);
  await name.filter({ hasText: identity }).waitFor();
  const destination = world.items[token].holder;
  const { scatteredAt } = world.elysiumEncounters[resident];
  assert.ok(
    scatteredAt > 0 && world.log.some((event) => event.seq === scatteredAt),
  );
  assert.notEqual(destination, resident);
  assert(
    !destination.startsWith("elysium-"),
    "the token goes into the ordinary world",
  );
  await play("talk", resident);
  assert.equal(world.elysiumEncounters[resident].scatteredAt, scatteredAt);
  assert.equal(
    world.log.filter((event) => event.elysiumModel === resident).length,
    1,
  );
  assert.equal(world.items[token].holder, destination);

  await play("move", "station");
  for (const place of walkTo(destination)) await play("move", place);
  await play("take", token);
  assert.equal(heldItem(world, "vale"), token);
  assert.equal(
    moveOffered("vale"),
    false,
    "the token cannot stand in for the Wayfinder",
  );
  await withCommand("hold", () => selectCard(vale, wayfinder, { touch: true }));
  await play("move", entry);
  await play("move", encounterRoom);
  assert(!resourceRequests.some(({ kind }) => kind === "portrait"));
  const waitingForArt = vale.waitForResponse(
    (response) =>
      new URL(response.url()).pathname ===
        `${worldPath}/elysium-portrait/${resident}` &&
      response.status() === 404,
  );
  await Promise.all([
    waitingForArt,
    play("give", resident, token).then(() => {
      assert.equal(world.items[token].holder, resident);
      assert.equal(world.elysiumEncounters[resident].returnedBy, "vale");
    }),
  ]);
  assert.equal(world.elysiumEncounters[resident].scatteredAt, scatteredAt);
  assert.equal(
    world.log.filter((event) => event.portraitModel === resident).length,
    1,
  );
  await awaitPortrait(false);
  portraitReady = true;
  await awaitPortrait(true);
  assert(resourceRequests.every(({ actor }) => actor === "vale"));
  assert.deepEqual(errors, []);
  console.log(
    "Elysium voyage: discovery, night crossing, return, encounter and multiplayer isolation passed.",
  );
} finally {
  await browser?.close();
  await new Promise((resolve) => server.close(resolve));
}
