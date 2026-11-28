import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { chromium } from "playwright";
import { createServer } from "../card-game/serve.mjs";
import { dispatchShared } from "../card-game/shared-world.mjs";
import { createWorld, encodeSave } from "../card-game/world.mjs";
import { enableMotives } from "../card-game/motives.mjs";
import { readyActionButton, selectCard } from "./card-browser-helpers.mjs";
import { UNKNOWN_PERSON } from "../card-game/speech-knowledge.mjs";
import { boardyPack } from "../card-game/boardyai.mjs";
const entrance = boardyPack.crossings.find(
  (c) => c.id === "station-boardyai-parlour",
);
const doorway = entrance.from;
const cardPlace = boardyPack.items["boardyai-calling-card"].holder;
assert(cardPlace === "station" || cardPlace === doorway);
assert.equal(entrance.to, "boardyai-parlour");
assert.equal(
  boardyPack.crossings.find((c) => c.id === "boardyai-parlour-station").to,
  doorway,
);

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
    // The opening starts lit; holding nothing puts the lamp out and opens the
    // mirror (#1653, #2580).
    seed = dispatchShared({
      op: "hold",
      world: seed,
      ...membership,
      choice: { item: null, revision: seed.revision },
    }).world;
    for (const fields of [{ kind: "move", target: "pond" }]) {
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
      alone.actors.vale.place = doorway;
      const view = dispatchShared({
        op: "view",
        world: alone,
        ...membership,
        present: ["vale"],
      });
      assert(!view.exits.includes("boardyai-parlour"));
      alone.actors.vale.place = cardPlace;
      const cardView = dispatchShared({
        op: "view",
        world: alone,
        ...membership,
        present: ["vale"],
      });
      assert(
        !cardView.actions.some((a) => a.item === "boardyai-calling-card"),
        "one human sees no calling card",
      );
    }
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
    // The seeded visit starts after Vale has met Boardy at the pond.
    world.actors.boardyai.place = "pond";
    world.opening.met.boardyai = startTurn;
    world.packs[boardyPack.id].met.boardyai = startTurn;
    const table = `boardyai-${width}`;
    const key = `cosyworld.reflected-shore.v1.${table}`;
    const page = await browser.newPage({
      viewport: { width, height },
      hasTouch: width === 390,
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
      const speakers = [
        input.scenery ? input.location : null,
        input.focus,
        ...input.speakers,
      ];
      const entries = [...new Set(speakers.filter(Boolean))].map((id) => ({
        id,
        text: id === "boardyai"
          ? "Who would you like to meet?"
          : "I take a moment to look around.",
      }));
      const frames = [
        ...entries.map((entry) => ({
          type: "delta",
          text: `${JSON.stringify(entry)}\n`,
        })),
        { type: "complete", revision: input.revision, model: "boardy-smoke", entries },
      ];
      return route.fulfill({
        contentType: "text/event-stream",
        body: frames.map((frame) => `data: ${JSON.stringify(frame)}\n\n`).join(""),
      });
    });
    await page.goto(
      `http://127.0.0.1:${server.address().port}/?table=${table}`,
    );
    await page.locator('#hand [data-card="boardyai"]').waitFor();
    await page.locator('#cast [data-avatar="boardyai"]').waitFor();
    const profile = page.getByRole("link", { name: "BoardyAI on X" });
    assert.equal(await profile.count(), 0);
    await selectCard(page, "boardyai");
    await profile.waitFor();
    const profileUrl = "https://x.com/boardyai";
    assert.equal(await profile.getAttribute("href"), profileUrl);
    assert.equal(await profile.getAttribute("rel"), "noopener noreferrer");
    await page.context().route(profileUrl, (route) =>
      route.fulfill({ body: "BoardyAI" }),
    );
    const [profilePage] = await Promise.all([
      page.context().waitForEvent("page"),
      width === 390 ? profile.tap() : profile.click(),
    ]);
    await profilePage.waitForURL(profileUrl);
    await profilePage.close();
    assert.equal(
      await page.evaluate((key) => JSON.parse(localStorage.getItem(key)).turn, key),
      startTurn,
    );
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
    assert.equal(await profile.count(), 0);
    await selectCard(page, "boardyai");
    await readyActionButton(page, "talk").click();
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
    assert(!JSON.stringify(requests).includes(profileUrl));
    // Talk carries one quest line, not quest titles. BoardyAI has not met
    // Mara, so his line keeps her unnamed (#1850).
    assert(
      // Talk now adds "I would be glad of your help." to the want line
      // (the offer rides in the Talk context, wants-and-arcs.md).
      told.facts.some((fact) =>
        fact.startsWith(`I want to see ${UNKNOWN_PERSON}.`),
      ),
      "BoardyAI's Talk context carries his quest",
    );
    assert(!told.facts.some((fact) => fact.includes("Mara")));
    assert(!told.facts.some((fact) => fact.startsWith("What I want most now")));
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
      throw Error("BoardyAI's visit stayed busy.");
    };
    await settle();
    const journey = [
      ["station", "move", "station"],
      ...(cardPlace === "station" ? [] : [[cardPlace, "move", cardPlace]]),
      ["boardyai-calling-card", "take", cardPlace],
      ...(doorway === cardPlace ? [] : [[doorway, "move", doorway]]),
      ["boardyai-parlour", "move", "boardyai-parlour"],
      [doorway, "move", doorway],
    ];
    let turn = startTurn + 1;
    for (const [id, kind, place] of journey) {
      turn += 1;
      await page.keyboard.press("Escape");
      await page.waitForFunction(
        () => !document.querySelector("#hand [data-revealing]"),
      );
      await selectCard(page, id);
      await readyActionButton(page, kind).click();
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
    const admittedBeforeReload = await page.evaluate(
      (key) => JSON.parse(localStorage.getItem(key)).stationExitOrder, key,
    );
    await page.reload();
    await page.locator('#hand [data-card="vale"]').waitFor();
    await selectCard(page, "boardyai-calling-card");
    assert.equal(
      await page.evaluate(
        (key) => JSON.parse(localStorage.getItem(key)).turn,
        key,
      ),
      turn,
    );
    const saved = await page.evaluate(
      (key) => JSON.parse(localStorage.getItem(key)),
      key,
    );
    assert.equal(saved.actors.vale.place, doorway);
    assert.deepEqual(saved.stationExitOrder, admittedBeforeReload);
    await page.locator('#hand [data-card="boardyai-parlour"]').waitFor();
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
