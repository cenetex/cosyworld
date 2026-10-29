import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { chromium } from "playwright";
import { createServer } from "../card-game/serve.mjs";
import {
  createWorld,
  encodeSave,
  legalActions,
  play,
  addLog,
  nameOf,
} from "../card-game/world.mjs";
import { availableCards } from "../card-game/cards.mjs";
import { questCards } from "../card-game/quest-cards.mjs";
import { selectCard } from "./card-browser-helpers.mjs";

const server = createServer();
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ headless: true });
const app = await readFile(
  new URL("../card-game/app.mjs", import.meta.url),
  "utf8",
);
function fixture(actor) {
  const world = createWorld();
  world.playerActorId = actor;
  world.sharedVersion = 1;
  world.controlledActors = [actor];
  world.presentActors = [actor];
  for (const id of [actor, "moth", "keeper"])
    world.actors[id].place = "station";
  world.items.lamp.holder = "moth";
  addLog(world, "Vale", "An earlier line from Vale.", {
    generated: true,
    kind: "dialogue",
    actorId: "vale",
    locationId: "station",
  });
  return play(
    world,
    legalActions(world).find((action) => action.kind === "wait"),
  ).state;
}
async function seed(page, key, world) {
  await page.addInitScript(
    ({ key, save, seen, quests }) => {
      if (!localStorage.getItem(key)) localStorage.setItem(key, save);
      localStorage.setItem(`${key}.seen`, JSON.stringify(seen));
      localStorage.setItem(
        `${key}.quests`,
        JSON.stringify({ seen: quests, read: quests }),
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
      seen: availableCards(world),
      quests: Object.keys(world.actors).flatMap((id) =>
        questCards(world, id).map((q) => q.key),
      ),
    },
  );
}
async function waitingFor(page, id) {
  await page.waitForFunction(
    (id) =>
      document.querySelector("#speaker-portrait").dataset.entity === id &&
      document.querySelector("#speech-row").getAttribute("aria-busy") ===
        "true",
    id,
  );
  assert.equal(await page.locator("#speaker").innerText(), nameOf(id));
  assert.equal(await page.locator("#dialogue-text").innerText(), "");
}
const reports = [];
try {
  for (const width of [1440, 390]) {
    for (const [actor, kind] of [
      ["vale", "talk"],
      ["rue", "ask"],
    ]) {
      console.log(`Reply wait: ${actor} ${kind} at ${width}px`);
      const page = await browser.newPage({
        viewport: { width, height: 900 },
        reducedMotion: "reduce",
      });
      const errors = [];
      page.setDefaultTimeout(10000);
      page.on("pageerror", (e) => errors.push(e.message));
      const world = fixture(actor),
        table = `reply-${actor}-${width}`;
      const key = `cosyworld.reflected-shore.v1.${table}`;
      await seed(page, key, world);
      const requests = [];
      await page.route("**/card-game/text", (route) =>
        requests.push({ route, input: route.request().postDataJSON() }),
      );
      await page.goto(`${origin}/?table=${table}`);
      await selectCard(page, "moth");
      const requested = page.waitForRequest("**/card-game/text");
      requested.catch(() => {});
      await page
        .locator(`#card-actions [data-action="${kind}"]`)
        .first()
        .click();
      await requested;
      await waitingFor(page, "moth");
      const request = requests.at(-1);
      assert(request);
      await request.route.fulfill({
        json: {
          revision: request.input.revision,
          model: "reply-wait-fixture",
          entries: request.input.entities.map(({ id }) => ({
            id,
            text: `Accepted words for ${id}.`,
          })),
        },
      });
      await page.waitForFunction(
        (actor) =>
          document.querySelector("#speaker-portrait").dataset.entity ===
            actor &&
          document
            .querySelector("#dialogue-text")
            .textContent.includes(`Accepted words for ${actor}.`),
        actor,
      );
      const saved = await page.evaluate(
        (key) => JSON.parse(localStorage.getItem(key)),
        key,
      );
      assert.equal(
        saved.log.find(
          (e) => e.turn === saved.turn && e.generated && e.kind === "dialogue",
        ).actorId,
        actor,
      );
      assert.deepEqual(errors, []);
      reports.push({ width, actor, kind, local: "passed" });
      await page.close();

      const shared = await browser.newPage({
        viewport: { width, height: 900 },
        reducedMotion: "reduce",
      });
      const sharedErrors = [];
      shared.on("pageerror", (e) => sharedErrors.push(e.message));
      const committed = play(
        world,
        legalActions(world).find((a) => a.kind === kind && a.target === "moth"),
      ).state;
      // Keep this reply partner on stage for the shared view check.
      committed.actors.moth.place = "station";
      let snapshot = {
        actor,
        world: committed,
        now: Date.now(),
        actions: [],
        queue: [{ id: "reply", actor, status: "working" }],
        history: [],
        claimed: [true, true, true, true, true, true, true, true],
        present: [true, true, true, true, true, true, true, true],
      };
      await seed(
        shared,
        `cosyworld.reflected-shore.v1.shared.reply-wait.${actor}`,
        committed,
      );
      await shared.route("**/app.mjs", (route) =>
        route.fulfill({
          contentType: "text/javascript",
          body: app + "\nglobalThis.syncReply = () => sharedSession.sync();\n",
        }),
      );
      await shared.route("**/auth/account", (route) =>
        route.fulfill({ json: { authenticated: true } }),
      );
      await shared.route("**/card-game/shared/worlds/reply-wait**", (route) =>
        route.fulfill({ json: snapshot }),
      );
      await shared.goto(`${origin}/?world=reply-wait`);
      await waitingFor(shared, "moth");
      // The next visible partner replaces the old wait, even with old Vale speech saved.
      snapshot = structuredClone(snapshot);
      const next = structuredClone(committed);
      next.actors.keeper.place = "station";
      const reply = legalActions(next).find(
        (a) => a.kind === "talk" && a.target === "keeper",
      );
      assert(reply, "The next reply partner is present");
      snapshot.world = play(next, reply).state;
      snapshot.world.actors.keeper.place = "station";
      snapshot.now++;
      await shared.evaluate(() => globalThis.syncReply());
      await waitingFor(shared, "keeper");
      snapshot = structuredClone(snapshot);
      snapshot.queue = [];
      snapshot.now++;
      await shared.evaluate(() => globalThis.syncReply());
      await shared.waitForFunction(
        () =>
          document.querySelector("#speech-row").getAttribute("aria-busy") ===
          "false",
      );
      assert.notEqual(
        await shared.locator("#speaker-portrait").getAttribute("data-entity"),
        "keeper",
      );
      assert.deepEqual(sharedErrors, []);
      reports.push({ width, actor, kind, shared: "passed" });
      await shared.close();
    }
  }
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
console.log(JSON.stringify({ replyWait: reports }));
