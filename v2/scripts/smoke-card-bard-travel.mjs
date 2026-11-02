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
import { selectCard } from "./card-browser-helpers.mjs";

const singer = "greek-rhapsode";
const want = (kind, target, since = 0) => ({
  kind,
  target,
  since,
  refusals: 0,
});
// The Bard wants the shore. The theatre door opens to it only while someone
// carries the mask, so its journey waits on an ordinary item play.
function fixture() {
  const s = enableMotives(createWorld());
  s.sharedVersion = 1;
  s.controlledActors = ["vale"];
  s.presentActors = ["vale"];
  s.actors.vale.place = "theatre";
  s.actors[singer].place = "theatre";
  s.items.mask.holder = "theatre";
  s.actors[singer].want = want("place", "pond");
  return play(
    s,
    legalActions(s).find((a) => a.kind === "wait"),
  ).state;
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
    // A fresh Bard wants to hear Vale and walks every ordinary step to her.
    {
      const world = enableMotives(createWorld());
      world.actors.vale.place = "greek-gate";
      world.items["greek-shovel"].holder = "vale";
      world.crossings["pond-greek-harbor"].discovered = true;
      assert.equal(world.actors[singer].place, "greek-harbor");
      world.actors[singer].want = want("person", "vale");
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
          if (await page.locator("#dialogue-advance").isVisible())
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
      assert.equal((await saved()).actors[singer].place, "greek-road-thebes");
      // Handing the guard the shovel reports the plan.
      await selectCard(page, "greek-shovel");
      await selectCard(page, "greek-guard");
      await page.locator('#card-actions [data-action="give"]').click();
      await reachTurn(2);
      // The Bard walks on into the city; its first step after the deed
      // records the verse's visit.
      let state = await saved();
      assert.equal(state.actors[singer].place, "greek-courtyard");
      assert.deepEqual(state.actors[singer].want, want("person", "vale"));
      assert.equal(
        state.packs["greek-drama"].recitals["greek-report-plan"].visit,
        2,
      );
      await selectCard(page, "vale");
      await page.locator('#card-actions [data-action="wait"]').click();
      await reachTurn(3);
      state = await saved();
      assert.equal(state.actors[singer].place, "greek-gate");
      await selectCard(page, singer);
      await page.locator('#card-actions [data-action="talk"]').click();
      await reachTurn(4);
      assert.equal(await page.locator("#story-retry").isVisible(), false);
      const poem = requests.at(-1).entities.find((e) => e.id === singer)?.poem;
      assert.equal(poem.stanzas.length, 1);
      // Couplet text is lore, never dialogue context.
      assert.equal(poem.stanzas[0].id, "greek-report-plan");
      assert.equal(JSON.stringify(poem).includes("hidden plan"), false);
      assert.equal(poem.stanzas[0].authorName, "Vale");
      await page.screenshot({
        path: new URL(`legal-arrival-${width}.png`, output).pathname,
      });
      await page.reload();
      await page.waitForSelector("#hand .card");
      // Hearing Vale met the Bard's quest; it is recorded once and the Bard
      // turns for home by the world rules.
      state = await saved();
      assert.equal(
        state.log.filter((e) => e.verb === "want_met" && e.actorId === singer)
          .length,
        1,
      );
      assert.equal(state.actors[singer].xp, 1);
      assert.notEqual(state.actors[singer].want?.target, "vale");
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
    assert.equal(world.actors[singer].place, "theatre");
    const key = `cosyworld.reflected-shore.v1.bard-${width}`;
    const page = await browser.newPage({
      viewport: { width, height },
      reducedMotion: "reduce",
    });
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
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
    // Quests are not cards: the Bard's journey stays out of the hand.
    await page.waitForSelector(`#hand [data-card="${singer}"]`);
    assert.equal(await page.locator("#hand .quest-frame").count(), 0);
    assert.equal(await page.locator("#hand [data-quest]").count(), 0);
    await page.screenshot({
      path: new URL(`journey-${width}.png`, output).pathname,
    });
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
    assert.equal(saved.actors[singer].xp, 1);
    const met = saved.log.filter(
      (e) => e.verb === "want_met" && e.actorId === singer,
    );
    assert.deepEqual(
      met.map((e) => e.wantMet),
      [{ kind: "place", target: "pond" }],
    );
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
    assert.deepEqual(
      saved.log
        .filter((e) => e.verb === "want_met" && e.actorId === singer)
        .map((e) => e.seq),
      met.map((e) => e.seq),
      "the met quest stays recorded once",
    );
    await page.screenshot({
      path: new URL(`arrival-${width}.png`, output).pathname,
    });
    assert.deepEqual(errors, []);
    await page.close();
  }
  console.log(
    "Bard quest to hear Vale, carriage invitation, item-gated travel, arrival and saved history passed at desktop and phone widths.",
  );
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
