import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { chromium } from "playwright";
import { DAYLIGHT_TURNS } from "../card-game/pack-rules.mjs";
import { heldItem } from "../card-game/held-item.mjs";
import { profiles } from "../card-game/memory.mjs";
import { createServer } from "../card-game/serve.mjs";
import { dispatchShared, load } from "../card-game/shared-world.mjs";
import { createWorld, decodeSave, encodeSave, exits, holdChoice, legalActions, play as playWorld } from "../card-game/world.mjs";
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
const identity = "Vesper Silver-Lens";
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

async function personalIntroduction(browser, origin) {
  const resident = "elysium-gemini";
  const room = "elysium-void-003";
  const lens = `${resident}-token`;
  const name = "Vaelen Silver-Lens";
  const boundModel = "google/gemini-4-hydrogen";
  const exchanges = [
    {
      question: "What do I call you?",
      answer: "Listen first. The mirrors have never agreed on dawn.",
      model: boundModel,
    },
    {
      question: "Have you settled on a name?",
      answer: `You may call me ${name}.`,
      model: boundModel,
      name,
    },
    {
      question: "What do you see here?",
      answer: "Something of mine slipped through a mirror before you saw me.",
      model: boundModel,
    },
  ];
  const key = "cosyworld.reflected-shore.v1.elysium-personal-smoke";
  const initial = createWorld({ seed: 17 });
  initial.turn = initial.revision = DAYLIGHT_TURNS;
  initial.actors.vale.place = "station";
  initial.items[wayfinder].holder = "station";
  let world = initial;
  function playFixture(kind, target) {
    const action = legalActions(world).find((action) =>
      action.kind === kind && (action.target === target || action.item === target),
    );
    assert.ok(action, `${kind} ${target}`);
    const result = playWorld(world, action);
    assert.ok(result.ok, result.error);
    world = result.state;
  }
  playFixture("take", wayfinder);
  for (const place of [entry, encounterRoom, room]) playFixture("move", place);
  playFixture("talk", resident);
  assert.ok(world.elysiumEncounters[resident].talkedAt);
  holdChoice(world, "vale", { item: null, revision: world.revision });
  const page = await browser.newPage({
    viewport: { width: 390, height: 844 }, hasTouch: true, reducedMotion: "reduce",
  });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.setDefaultTimeout(15000);
  await page.addInitScript(({ key, save, known }) => {
    if (!localStorage.getItem(key)) localStorage.setItem(key, save);
    localStorage.setItem(`${key}.seen`, JSON.stringify(known));
    localStorage.setItem("cosyworld.dialogue.sound", "off");
    localStorage.setItem("cosyworld.room-music", JSON.stringify({ enabled: false }));
  }, { key, save: encodeSave(world), known: Object.keys(profiles).filter((id) => id !== lens) });
  await page.route("**/auth/account", (route) =>
    route.fulfill({ json: { authenticated: false } }),
  );
  const attempts = [];
  const portraitRequests = [];
  const portraitPath = `/card-game/elysium-portrait/${resident}`;
  await page.route(`**${portraitPath}`, (route) => {
    assert.equal(route.request().method(), "POST");
    portraitRequests.push(route.request().postDataJSON());
    if (portraitRequests.length === 1) return route.fulfill({ status: 202 });
    return route.fulfill({
      contentType: "image/png",
      headers: { "cache-control": "private, no-store" },
      body: generatedPortrait,
    });
  });
  let giveDialogueRequests = 0;
  await page.route("**/card-game/text", (route) => {
    const { revision, turn, outcome, conversation, elysiumIntroduced, elysiumTokenScattered } =
      route.request().postDataJSON();
    if (outcome?.card?.kind !== "talk" || outcome.card.target !== resident) {
      if (outcome?.card?.kind === "give" && outcome.card.target === resident) giveDialogueRequests++;
      return route.fulfill({ status: 503 });
    }
    const exchange = exchanges[attempts.length];
    attempts.push({ elysiumIntroduced, elysiumTokenScattered, conversation });
    if (!exchange) return route.fulfill({ status: 503 });
    const { question, answer, model } = exchange;
    const entries = [
      { id: "vale", text: question, model: "google/gemma-4-26b-a4b-it" },
      { id: resident, text: answer, model },
    ].map((entry) => {
      const claims = { entity: entry.id, world: "local", seq: revision, turn,
        ...(entry.id === resident && { rules: "fixture/elysium-v1" }) };
      const signed = {
        sig: `fixture-${revision}-${entry.id}`,
        claims: { kind: "line", ...claims },
      };
      if (entry.id !== resident) return { ...entry, signed };
      return { ...entry, signed, elysiumName: exchange.name ?? null,
        ...(exchange.name && { elysiumNameSigned: {
          sig: `fixture-name-${revision}`, claims: { kind: "elysium-name", ...claims },
        } }),
      };
    });
    const frames = [
      ...entries.map((entry) => ({ type: "delta", text: `${JSON.stringify(entry)}\n` })),
      { type: "complete", revision, model: "card-voices-v1", entries },
    ];
    return route.fulfill({
      contentType: "text/event-stream",
      body: frames.map((frame) => `data: ${JSON.stringify(frame)}\n\n`).join(""),
    });
  });
  await page.goto(`${origin}/?table=elysium-personal-smoke`);
  const title = page.locator(`#hand [data-card="${resident}"] .name`);
  const speech = page.locator("#dialogue-text");
  const speaker = page.locator("#speaker");
  const talk = async ({ question, answer }) => {
    await settleHand(page);
    await clearSelection(page);
    await selectCard(page, resident, { touch: true });
    await readyActionButton(page, "talk").tap();
    await speech.filter({ hasText: question }).waitFor();
    assert.equal(await speaker.textContent(), "Vale");
    await page.locator("#dialogue-advance").click();
    await speech.filter({ hasText: answer }).waitFor();
  };
  await title.filter({ hasText: /^\?\?\?$/u }).waitFor();
  await settleHand(page);
  const quiet = await page.evaluateHandle(() => {
    const seen = new Set();
    const front = document.querySelector("#speech-row");
    const behind = document.querySelector("#beat-behind");
    const observer = new MutationObserver(() => {
      if (!front.hidden && front.dataset.beat === "silent")
        seen.add(front.querySelector("#speaker").textContent);
      if (!behind.hidden && behind.querySelector(".beat-behind-speech")?.textContent === "…")
        seen.add(behind.querySelector("strong").textContent);
    });
    observer.observe(front.closest(".dialogue"), {
      subtree: true, childList: true, attributes: true,
    });
    return seen;
  });
  await talk(exchanges[0]);
  assert.equal(await speaker.textContent(), "???");
  await title.filter({ hasText: /^\?\?\?$/u }).waitFor();
  await talk(exchanges[1]);
  await title.filter({ hasText: name }).waitFor();
  assert.equal(await speaker.textContent(), name);
  await settleHand(page);
  assert.deepEqual(await quiet.evaluate((seen) => [...seen]), []);
  await page.reload();
  await title.filter({ hasText: name }).waitFor();
  await talk(exchanges[2]);
  assert.equal(await speaker.textContent(), name);
  assert.deepEqual(attempts.map(({ elysiumIntroduced }) => elysiumIntroduced), [undefined, undefined, resident]);
  assert(attempts.every(({ elysiumTokenScattered }) => elysiumTokenScattered));
  assert.equal(attempts[1].conversation.find((line) => line.actorId === resident)?.elysiumName, null);
  const saved = await page.evaluate((key) => JSON.parse(localStorage.getItem(key)), key);
  assert(saved.log.some((line) => line.actorId === resident && line.elysiumName === name));
  assert(!attempts[2].conversation.some((line) => line.text.includes("Lens")));
  world = decodeSave(JSON.stringify(saved));
  const landing = world.items[lens].holder;
  for (const place of [encounterRoom, "station"]) playFixture("move", place);
  if (landing !== "station") playFixture("move", landing);
  playFixture("take", lens);
  holdChoice(world, "vale", { item: wayfinder, revision: world.revision });
  for (const place of [entry, encounterRoom, room]) playFixture("move", place);
  holdChoice(world, "vale", { item: null, revision: world.revision });
  await page.evaluate(({ key, save }) => localStorage.setItem(key, save),
    { key, save: encodeSave(world) });
  await page.reload();
  await title.filter({ hasText: name }).waitFor();
  assert.deepEqual(portraitRequests, []);
  const stagePortrait = page.locator(`#cast [data-avatar="${resident}"] img`).first();
  const cardPortrait = page.locator(`#hand [data-card="${resident}"] .art > img`).first();
  const awaitPortrait = () =>
    Promise.all([stagePortrait, cardPortrait].map((image) =>
      image.and(page.locator('img[src^="data:image/png;base64,"]')).waitFor(),
    ));
  await settleHand(page);
  await clearSelection(page);
  await selectCard(page, lens, { touch: true });
  await selectCard(page, resident, { touch: true });
  await readyActionButton(page, "give").tap();
  await awaitPortrait();
  assert(giveDialogueRequests > 0, "the portrait arrives even when Give dialogue fails");
  const returned = await page.evaluate((key) => JSON.parse(localStorage.getItem(key)), key);
  assert.equal(returned.items[lens].holder, resident);
  const receipt = returned.elysiumEncounters[resident];
  assert.equal(receipt.returnedBy, "vale");
  assert.deepEqual(portraitRequests, [receipt, receipt]);
  await page.reload();
  await awaitPortrait();
  assert.deepEqual(portraitRequests, [receipt, receipt, receipt]);
  await title.filter({ hasText: name }).waitFor();
  assert.deepEqual(errors, []);
  await page.close();
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
        known: Object.keys(profiles).filter((card) => card !== wayfinder && card !== "elysium-gemini-token"),
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
            lines: [{ actorId: resident, elysiumName: identity, text: `You may call me ${identity}.` }],
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
    // Saved worlds leave presence to the request. Route checks need the same
    // seats as real plays, including doors that require another player.
    const routeWorld = load({ world, actor: "vale", claimed: actors, present: actors });
    const start = routeWorld.actors.vale.place;
    const queue = [[start, []]];
    const seen = new Set([start]);
    for (const [place, path] of queue) {
      if (place === destination) return path;
      routeWorld.actors.vale.place = place;
      for (const next of exits(routeWorld, place, "vale")) {
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
  const stageResident = `#cast [data-avatar="${resident}"]`;
  assert.equal(await name.textContent(), "???");
  assert.equal(
    await vale.locator(stageResident).getAttribute("aria-label"),
    "???",
  );
  const figures = [
    `${stageResident} .portrait-body > img`,
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
  const destination = world.items[token].holder;
  const { scatteredAt, talkedAt } = world.elysiumEncounters[resident];
  assert.equal(talkedAt, null);
  assert.ok(
    world.log.some(
      (event) => event.seq === scatteredAt && event.elysiumArrival === resident,
    ),
  );
  assert.notEqual(destination, resident);
  assert(
    !destination.startsWith("elysium-"),
    "the token goes into the ordinary world",
  );
  await withCommand("hold", () => clearSelection(vale));
  await play("talk", resident);
  await settleHand(vale);
  await name.filter({ hasText: identity }).waitFor();
  await vale.locator("#speaker").filter({ hasText: identity }).waitFor();
  await vale.waitForFunction(
    ({ stageResident, identity }) =>
      document.querySelector(stageResident)?.getAttribute("aria-label") ===
      identity,
    { stageResident, identity },
  );
  const firstTalk = world.elysiumEncounters[resident].talkedAt;
  assert.ok(firstTalk > scatteredAt);
  await play("talk", resident);
  assert.deepEqual(world.elysiumEncounters[resident], {
    scatteredAt,
    talkedAt: firstTalk,
  });
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
  assert.equal(
    world.log.filter((event) => event.elysiumArrival === resident).length,
    1,
  );
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
  await Promise.all([vale.close(), mara.close()]);
  await personalIntroduction(browser, origin);
  console.log("Elysium personal table: the name persists and the returned Twin Lens earns a portrait through a dialogue failure and reload.");
} finally {
  await browser?.close();
  await new Promise((resolve) => server.close(resolve));
}
