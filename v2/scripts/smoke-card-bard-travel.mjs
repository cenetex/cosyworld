import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { chromium } from "playwright";
import { createServer } from "../card-game/serve.mjs";
import {
  createWorld,
  encodeSave,
  play,
  legalActions,
} from "../card-game/world.mjs";
import { enableMotives } from "../card-game/motives.mjs";
import { addQuestRecord } from "../card-game/shared-quests.mjs";
import { recordQuestCompletion } from "../card-game/quest-completions.mjs";
import { questCards } from "../card-game/quest-cards.mjs";
import { narrativeContext } from "../card-game/narrative.mjs";
import { selectCard } from "./card-browser-helpers.mjs";

const singer = "greek-rhapsode";
function fixture() {
  let s = enableMotives(createWorld(), { personalQuests: true });
  s.sharedVersion = 1;
  s.controlledActors = ["vale"];
  s.presentActors = ["vale"];
  s.actors.vale.place = "theatre";
  s.actors[singer].place = "theatre";
  s.items.mask.holder = "theatre";
  const q = addQuestRecord(s, {
    holder: { kind: "place", id: "pond" },
    program: {
      id: "shore-deed",
      name: "A deed by the shore",
      steps: [{ items: [], avatars: [], location: "pond" }],
    },
  });
  q.completedTurn = s.turn;
  q.step = 1;
  recordQuestCompletion(s, q, { actorId: "keeper", locationId: "pond" });
  s = play(
    s,
    legalActions(s).find((a) => a.kind === "wait"),
  ).state;
  // Start with the shared help already collected through the shipping rules.
  // Quest cards now offer Drop; ordinary item plays fulfil the held request.
  const helpKey = s.roamingQuests[singer].blocked.questKey;
  const join = legalActions(s).find(
    (action) => action.kind === "join-quest" && action.questKey === helpKey,
  );
  assert(join);
  const joined = play(s, join);
  assert.equal(joined.ok, true);
  assert(joined.state.quests.hands.vale.includes(helpKey));
  assert(joined.state.quests.hands.vale.length <= 2);
  return joined.state;
}
const output = new URL("../../output/card-bard-travel/", import.meta.url);
await mkdir(output, { recursive: true });
const server = createServer();
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const browser = await chromium.launch({ headless: true });
try {
  for (const [width, height] of [
    [1440, 900],
    [390, 844],
  ]) {
    // A fresh bard follows a real completed quest through every ordinary step.
    {
      const world = enableMotives(createWorld(), { personalQuests: true });
      world.actors.vale.place = "greek-gate";
      world.crossings["pond-greek-harbor"].discovered = true;
      assert.equal(world.actors[singer].place, "greek-harbor");
      const key = `cosyworld.reflected-shore.v1.bard-route-${width}`;
      const page = await browser.newPage({
        viewport: { width, height },
        reducedMotion: "reduce",
      });
      const requests = [],
        errors = [];
      page.on("pageerror", (e) => errors.push(e.message));
      await page.addInitScript(
        ({ key, save }) => {
          if (!localStorage.getItem(key)) localStorage.setItem(key, save);
          localStorage.setItem("cosyworld.dialogue.sound", "off");
          localStorage.setItem(
            "cosyworld.room-music",
            JSON.stringify({ enabled: false }),
          );
        },
        { key, save: encodeSave(world) },
      );
      await page.route("**/card-game/text", (route) => {
        const input = route.request().postDataJSON();
        requests.push(input);
        return route.fulfill({
          json: {
            revision: input.revision,
            model: "bard-route-smoke",
            entries: input.entities.map(({ id }) => ({
              id,
              text:
                input.disclosures?.find((fact) => fact.speaker === id)?.text ||
                (id === singer
                  ? "The choice beside the wall has given my song a quieter turn."
                  : "The words remain with us."),
            })),
          },
        });
      });
      const saved = () =>
        page.evaluate((key) => JSON.parse(localStorage.getItem(key)), key);
      const settle = async () => {
        for (let i = 0; i < 180; i++) {
          if (await page.locator("#unveil-dialog[open]").count())
            await page.keyboard.press("Escape");
          else if (await page.locator("#dialogue-advance").isVisible())
            await page.locator("#dialogue-advance").click();
          await page.waitForTimeout(60);
          if (
            (await page.locator("#hand").getAttribute("data-cooling")) ===
              "false" &&
            (await page.locator("#card-actions").getAttribute("aria-busy")) ===
              "false"
          )
            return;
        }
        throw Error("Bard journey stayed busy");
      };
      const reachTurn = async (turn) => {
        await page.waitForFunction(
          ({ key, turn }) =>
            JSON.parse(localStorage.getItem(key)).turn === turn,
          { key, turn },
        );
        await settle();
      };
      await page.goto(
        `http://127.0.0.1:${server.address().port}/?table=bard-route-${width}`,
      );
      await settle();
      await selectCard(page, "greek-guard");
      await page.locator('[data-action="talk"]').click();
      await reachTurn(1);
      assert.equal((await saved()).actors[singer].place, "greek-harbor");
      await selectCard(page, "greek-antigone");
      await page.locator('[data-choice="greek-decline-burial"]').click();
      await reachTurn(2);
      // The Bard walks up the Theban Harbor Road, then into the city.
      let state = await saved();
      assert.equal(state.actors[singer].place, "greek-road-thebes");
      assert.equal(state.roamingQuests[singer].target.locationId, "greek-gate");
      await selectCard(page, "vale");
      await page.locator('#card-actions [data-action="wait"]').click();
      await reachTurn(3);
      state = await saved();
      assert.equal(state.actors[singer].place, "greek-courtyard");
      assert.equal(state.roamingQuests[singer].target.locationId, "greek-gate");
      assert.equal(
        state.packs["greek-drama"].recitals["greek-decline-burial"].visit,
        null,
      );
      await selectCard(page, "vale");
      await page.locator('#card-actions [data-action="wait"]').click();
      await reachTurn(4);
      state = await saved();
      assert.equal(state.actors[singer].place, "greek-gate");
      assert.equal(
        state.packs["greek-drama"].recitals["greek-decline-burial"].visit,
        4,
      );
      await selectCard(page, singer);
      await page.locator('#card-actions [data-action="talk"]').click();
      await reachTurn(5);
      assert.equal(await page.locator("#story-retry").isVisible(), false);
      const poem = requests.at(-1).entities.find((e) => e.id === singer)?.poem;
      assert.equal(poem.stanzas.length, 1);
      assert.deepEqual(poem.newLines, [
        "I told her I would turn away.",
        "Her brother waited by the wall.",
      ]);
      assert.equal(poem.stanzas[0].authorName, "Vale");
      await page.screenshot({
        path: new URL(`legal-arrival-${width}.png`, output).pathname,
      });
      await page.reload();
      await page.waitForSelector(`#hand [data-card="${singer}"]`);
      assert.equal((await saved()).actors[singer].place, "greek-gate");
      assert.deepEqual(errors, []);
      await page.close();
    }
    // Rue invites Pip through the carriage door while carrying its route token.
    {
      const world = createWorld();
      world.sharedVersion = 1;
      world.controlledActors = ["rue"];
      world.presentActors = ["rue"];
      world.playerActorId = "rue";
      world.actors.rue.place = world.actors.moth.place = "pond";
      world.items.routes.holder = "rue";
      world.actors.moth.trust.rue = 1;
      const table = `carriage-invitation-${width}`,
        key = `cosyworld.reflected-shore.v1.${table}`;
      const page = await browser.newPage({
        viewport: { width, height },
        reducedMotion: "reduce",
      });
      await page.addInitScript(
        ({ key, save }) => {
          if (!localStorage.getItem(key)) localStorage.setItem(key, save);
          localStorage.setItem("cosyworld.dialogue.sound", "off");
          localStorage.setItem(
            "cosyworld.room-music",
            JSON.stringify({ enabled: false }),
          );
        },
        { key, save: encodeSave(world) },
      );
      await page.route("**/card-game/text", (route) => {
        const input = route.request().postDataJSON();
        return route.fulfill({
          json: {
            revision: input.revision,
            model: "invitation-smoke",
            entries: input.entities.map((e) => ({
              id: e.id,
              text: "There is room for this visit.",
            })),
          },
        });
      });
      await page.goto(
        `http://127.0.0.1:${server.address().port}/?table=${table}`,
      );
      await selectCard(page, "moth");
      await selectCard(page, "train");
      await page.locator('#card-actions [data-action="accompany"]').click();
      await page.waitForFunction(
        (key) =>
          JSON.parse(localStorage.getItem(key)).actors.rue.place === "train",
        key,
      );
      const saved = await page.evaluate(
        (key) => JSON.parse(localStorage.getItem(key)),
        key,
      );
      assert.equal(saved.actors.moth.place, "train");
      assert.deepEqual(saved.invitedPlaces.moth, ["train"]);
      await page.reload();
      await page.waitForSelector('#hand [data-card="moth"]');
      await page.screenshot({
        path: new URL(`invitation-${width}.png`, output).pathname,
      });
      await page.close();
    }
    const world = fixture();
    const helpKey = world.roamingQuests[singer].blocked.questKey;
    const helpCard = questCards(world, "theatre").find(
      (q) => q.key === helpKey,
    );
    assert(helpCard);
    const key = `cosyworld.reflected-shore.v1.bard-${width}`;
    const page = await browser.newPage({
      viewport: { width, height },
      reducedMotion: "reduce",
    });
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.addInitScript(
      ({ key, save, seen }) => {
        if (!localStorage.getItem(key)) localStorage.setItem(key, save);
        localStorage.setItem(
          `${key}.quests`,
          JSON.stringify({ seen, read: [] }),
        );
        localStorage.setItem("cosyworld.dialogue.sound", "off");
        localStorage.setItem(
          "cosyworld.room-music",
          JSON.stringify({ enabled: false }),
        );
      },
      {
        key,
        save: encodeSave(world),
        seen: questCards(world).map((q) => q.key),
      },
    );
    await page.route("**/card-game/text", (route) => {
      const input = route.request().postDataJSON();
      return route.fulfill({
        json: {
          revision: input.revision,
          model: "bard-smoke",
          entries: input.entities.map((e) => ({
            id: e.id,
            text: "The door opens onto the shore.",
          })),
        },
      });
    });
    await page.goto(
      `http://127.0.0.1:${server.address().port}/?table=bard-${width}`,
    );
    // The journey and help cards stay out of the hand. Talk context tells
    // the bard's journey and the shared help to the people at the theatre.
    await page.waitForSelector(`#hand [data-card="${singer}"]`);
    assert.equal(await page.locator("#hand .quest-frame").count(), 0);
    assert.equal(await page.locator("#hand [data-quest]").count(), 0);
    const journey = questCards(world, singer).find(
      (q) => q.key === world.roamingQuests[singer].questKey,
    );
    const facts = (id) =>
      narrativeContext(world)
        .entities.find((entity) => entity.id === id)
        .facts.join(" ");
    assert(facts(singer).includes(journey.title));
    assert(facts("vale").includes(helpCard.title));
    await page.screenshot({
      path: new URL(`journey-${width}.png`, output).pathname,
    });
    await page.waitForFunction(
      ({ key, helpKey }) =>
        JSON.parse(localStorage.getItem(key)).quests.records[
          helpKey
        ].participants.includes("vale"),
      { key, helpKey },
    );
    await selectCard(page, "mask");
    await page.locator('#card-actions [data-action="take"]').click();
    await page.waitForFunction(
      ({ key, singer }) =>
        JSON.parse(localStorage.getItem(key)).actors[singer].place === "pond",
      { key, singer },
    );
    let saved = await page.evaluate(
      (key) => JSON.parse(localStorage.getItem(key)),
      key,
    );
    assert.equal(saved.items.mask.holder, "vale");
    assert.equal(saved.quests.records[helpKey].completion.cause.kind, "help");
    const fulfilledHelp = structuredClone(saved.quests.records[helpKey]);
    assert(fulfilledHelp.participants.includes("vale"));
    assert.equal(fulfilledHelp.step, fulfilledHelp.program.steps.length);
    await page.reload();
    await page.waitForSelector('#hand [data-card="vale"]');
    await selectCard(page, "pond");
    await page.locator('#card-actions [data-action="move"]').click();
    await page.waitForFunction(
      (key) =>
        JSON.parse(localStorage.getItem(key)).actors.vale.place === "pond",
      key,
    );
    saved = await page.evaluate(
      (key) => JSON.parse(localStorage.getItem(key)),
      key,
    );
    assert.equal(saved.actors[singer].place, "pond");
    assert.deepEqual(saved.quests.records[helpKey], fulfilledHelp);
    assert(saved.quests.hands.vale.length <= 2);
    assert.equal(
      saved.quests.records[saved.roamingQuests[singer].questKey]
        .completedTurn !== null,
      true,
    );
    await selectCard(page, singer);
    await page.screenshot({
      path: new URL(`arrival-${width}.png`, output).pathname,
    });
    assert.deepEqual(errors, []);
    await page.close();
  }
  console.log(
    "Bard quest cards, collected help, Drop action, item-gated travel, arrival and saved history passed at desktop and phone widths.",
  );
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
