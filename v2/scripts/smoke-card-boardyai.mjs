import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { chromium } from "playwright";
import { createServer } from "../card-game/serve.mjs";
import { dispatchShared } from "../card-game/shared-world.mjs";
import { createWorld, encodeSave } from "../card-game/world.mjs";
import { enableMotives } from "../card-game/motives.mjs";
import { selectCard } from "./card-browser-helpers.mjs";
import { UNKNOWN_PERSON } from "../card-game/speech-knowledge.mjs";

const server = createServer();
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const browser = await chromium.launch({ headless: true });
const output = new URL("../../output/card-boardyai/", import.meta.url);
await mkdir(output, { recursive: true });
try {
  for (const [width, height] of [
    [1440, 900],
    [390, 844],
  ]) {
    let seed = dispatchShared({
      op: "create",
      save: encodeSave(enableMotives(createWorld({ opening: true }))),
    }).world;
    const membership = {
      actor: "vale",
      claimed: ["vale", "mara"],
      present: ["vale", "mara"],
    };
    for (const fields of [
      // The opening starts lit; dousing opens the mirror (#1653).
      { kind: "snuff" },
      { kind: "move", target: "pond" },
    ]) {
      const view = dispatchShared({ op: "view", world: seed, ...membership });
      const action = view.actions.find((a) =>
        Object.entries(fields).every(([key, value]) => a[key] === value),
      );
      assert(action, JSON.stringify(fields));
      seed = dispatchShared({
        op: "play",
        world: seed,
        ...membership,
        action,
      }).world;
    }
    // With one connected human, Boardy and his calling card stay away.
    {
      const alone = structuredClone(seed);
      alone.actors.vale.place = "station";
      const view = dispatchShared({
        op: "view",
        world: alone,
        ...membership,
        present: ["vale"],
      });
      assert(!view.exits.includes("boardyai-parlour"));
      assert(
        !view.actions.some((a) => a.item === "boardyai-calling-card"),
        "one human sees no calling card",
      );
    }
    // Boardy steps out of his station door and meets Vale at the pond.
    const world = {
      ...seed,
      playerActorId: membership.actor,
      controlledActors: membership.claimed,
      presentActors: membership.present,
    };
    assert.equal(world.actors.vale.place, "pond");
    const startTurn = world.turn;
    // BoardyAI's quest is to meet Mara; Talk is how Vale learns it.
    world.actors.boardyai.want = {
      kind: "person",
      target: "mara",
      since: world.turn,
      refusals: 0,
    };
    // He steps out of his station door to meet Vale at the pond.
    world.actors.boardyai.place = "pond";
    const table = `boardyai-${width}`;
    const key = `cosyworld.reflected-shore.v1.${table}`;
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
    const requests = [];
    await page.route("**/card-game/text", (route) => {
      const input = route.request().postDataJSON();
      requests.push(input);
      return route.fulfill({
        json: {
          revision: input.revision,
          model: "boardy-smoke",
          entries: input.entities.map((e) => ({
            id: e.id,
            text: "Who would you like to meet?",
          })),
        },
      });
    });
    await page.goto(
      `http://127.0.0.1:${server.address().port}/?table=${table}`,
    );
    await page.locator('#hand [data-card="boardyai"]').waitFor();
    await page.locator('#cast [data-avatar="boardyai"]').waitFor();
    await selectCard(page, "boardyai");
    // His quest has no card; Talk context carries it.
    assert.equal(await page.locator("#hand .quest-frame").count(), 0);
    await page
      .locator("#hand img")
      .evaluateAll((images) => Promise.all(images.map((img) => img.decode())));
    const portrait = page.locator('#cast [data-avatar="boardyai"] img').first();
    assert(
      await portrait.evaluate((img) => img.complete && img.naturalWidth > 0),
    );
    assert(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    );
    await page.screenshot({
      path: new URL(`quest-${width}.png`, output).pathname,
    });
    await page.keyboard.press("Escape");
    await selectCard(page, "boardyai");
    await page.locator('#card-actions [data-action="talk"]').click();
    await page.waitForFunction(
      ({ key, turn }) => {
        const saved = JSON.parse(localStorage.getItem(key));
        return (
          saved.turn === turn &&
          saved.log.some((e) => e.generated && e.actorId === "boardyai")
        );
      },
      { key, turn: startTurn + 1 },
    );
    const told = requests
      .flatMap((input) => input.entities)
      .filter((entity) => entity.id === "boardyai")
      .at(-1);
    // Talk carries one quest line, not quest titles. BoardyAI has not met
    // Mara, so his line keeps her unnamed (#1850).
    assert(
      told.facts.some((fact) => fact === `I want to see ${UNKNOWN_PERSON}.`),
      "BoardyAI's Talk context carries his quest",
    );
    assert(!told.facts.some((fact) => fact.includes("Mara")));
    assert(!told.facts.some((fact) => fact.startsWith("What I want most now")));
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
      throw Error("BoardyAI's visit stayed busy.");
    };
    await settle();
    for (const [id, kind, turn, place] of [
      ["station", "move", startTurn + 2, "station"],
      ["boardyai-calling-card", "take", startTurn + 3, "station"],
      ["boardyai-parlour", "move", startTurn + 4, "boardyai-parlour"],
      ["station", "move", startTurn + 5, "station"],
    ]) {
      await page.keyboard.press("Escape");
      await selectCard(page, id);
      await page.locator(`#card-actions [data-action="${kind}"]`).click();
      await page.waitForFunction(
        ({ key, turn }) => JSON.parse(localStorage.getItem(key)).turn === turn,
        { key, turn },
      );
      await settle();
      assert.equal(
        await page.evaluate(
          (key) => JSON.parse(localStorage.getItem(key)).actors.vale.place,
          key,
        ),
        place,
      );
      if (place === "boardyai-parlour")
        await page.screenshot({
          path: new URL(`parlour-${width}.png`, output).pathname,
        });
    }
    await page.reload();
    await page.locator('#hand [data-card="vale"]').waitFor();
    await selectCard(page, "boardyai-calling-card");
    assert.equal(
      await page.evaluate(
        (key) => JSON.parse(localStorage.getItem(key)).turn,
        key,
      ),
      startTurn + 5,
    );
    const saved = await page.evaluate(
      (key) => JSON.parse(localStorage.getItem(key)),
      key,
    );
    assert.equal(saved.actors.vale.place, "station");
    assert.equal(saved.items["boardyai-calling-card"].holder, "vale");
    assert.equal(
      await page.locator('#hand [data-card="boardyai-calling-card"]').count(),
      1,
    );
    assert.deepEqual(errors, []);
    await page.close();
    console.log(
      `BoardyAI avatar, quest, conversation, calling card, home, return and reload passed at ${width}x${height}.`,
    );
  }
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
