import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { chromium } from "playwright";
import { createServer } from "../card-game/serve.mjs";
import { currentActor, encodeSave, legalActions } from "../card-game/world.mjs";
import { needsVoyage, nextVoyagePlay } from "../../test/helpers/voyage.mjs";
import { profiles } from "../card-game/memory.mjs";
import { openingFixture } from "../../test/helpers/greek-opening.mjs";
import {
  OPEN_DOOR_PLACES,
  openDoorAction,
  openDoorSteps,
} from "../../test/helpers/open-door.mjs";
import {
  clearSelection,
  selectCard,
  smokeWidths,
} from "./card-browser-helpers.mjs";

export async function checkOpenDoor(browser, origin) {
  const output = new URL("../../output/open-door/", import.meta.url);
  await mkdir(output, { recursive: true });
  for (const width of smokeWidths([1440, 390])) {
    const fixture = openingFixture("exposure").closed;
    const page = await browser.newPage({
      viewport: { width, height: width === 390 ? 844 : 900 },
      reducedMotion: "reduce",
      hasTouch: width === 390,
    });
    const table = `open-door-${width}`;
    const key = `cosyworld.reflected-shore.v1.${table}`;
    const errors = [],
      failedAssets = [],
      requests = [],
      photographed = new Set();
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("response", (response) => {
      if (
        response.status() >= 400 &&
        new URL(response.url()).pathname.includes("/assets/")
      )
        failedAssets.push(`${response.status()} ${response.url()}`);
    });
    try {
      await page.addInitScript(
        ({ key, save, seen }) => {
          if (!localStorage.getItem(key)) localStorage.setItem(key, save);
          localStorage.setItem(`${key}.seen`, JSON.stringify(seen));
          localStorage.setItem("cosyworld.dialogue.sound", "off");
          localStorage.setItem(
            "cosyworld.room-music",
            JSON.stringify({ enabled: false }),
          );
        },
        { key, save: encodeSave(fixture), seen: Object.keys(profiles) },
      );
      await page.route("**/card-game/text", async (route) => {
        const input = route.request().postDataJSON();
        requests.push(input);
        await route.fulfill({
          json: {
            revision: input.revision,
            model: "open-door-browser-fixture",
            entries: input.entities.map(({ id }) => ({
              id,
              text:
                input.disclosures?.find((fact) => fact.speaker === id)?.text ||
                "I will keep your words in mind.",
            })),
          },
        });
      });
      const state = () =>
        page.evaluate((key) => JSON.parse(localStorage.getItem(key)), key);
      const settle = async () => {
        await page.waitForSelector("#hand .card");
        for (let turn = 0; turn < 250; turn++) {
          if (await page.locator("#unveil-dialog[open]").count())
            await page.keyboard.press("Escape");
          else if (await page.locator("#dialogue-advance").isVisible())
            await page.locator("#dialogue-advance").click();
          if (await page.locator("#story-retry").isVisible())
            throw new Error(
              `Story retry at ${width}px: ${await page.locator("#story-retry").textContent()}`,
            );
          if (
            (await page.locator("#hand").getAttribute("data-cooling")) ===
            "false"
          )
            return;
          await page.waitForTimeout(40);
        }
        throw new Error(
          `Open Door stayed busy at ${width}px: ${errors.join("; ")}`,
        );
      };
      const scene = async () => {
        const world = await state(),
          place = world.actors.vale.place;
        assert.ok(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth + 1,
          ),
          "The page fits the viewport",
        );
        await page.waitForFunction(() =>
          [...document.querySelectorAll("#backdrop, #cast img")].every(
            (image) => image.complete && image.naturalWidth > 0,
          ),
        );
        if (OPEN_DOOR_PLACES.includes(place) && !photographed.has(place)) {
          photographed.add(place);
          await page.screenshot({
            path: new URL(`${place}-${width}.png`, output).pathname,
            fullPage: true,
          });
        }
      };
      const step = async ({ kind, ...fields }) => {
        await settle();
        // Aboard, a port is a voyage: the course card, a round at sea, Disembark.
        for (let n = 0; n < 12 && kind === "move"; n++) {
          const world = await state();
          if (!needsVoyage(world, currentActor(world), fields.target)) break;
          const next = nextVoyagePlay(
            world,
            currentActor(world),
            fields.target,
          );
          await step(next.target ? next : { kind: next.kind });
        }
        if (kind === "move" && fields.target === "greek-ship") {
          for (
            let wait = 0;
            wait < 32 &&
            !legalActions(await state()).some(
              (a) => a.kind === "move" && a.target === "greek-ship",
            );
            wait++
          )
            await step({ kind: "wait" });
        }
        const before = await state();
        const action = openDoorAction(before, kind, fields);
        const cards = action.cards?.length
          ? [...action.cards]
          : [action.item || action.target || "vale"];
        if (kind === "drop" && !cards.includes(fields.target))
          cards.push(fields.target);
        await clearSelection(page);
        for (const id of [...new Set(cards)])
          await selectCard(page, id, { touch: width === 390 });
        await page
          .locator(`#card-actions [data-action="${kind}"]`)
          .first()
          .click();
        await settle();
        const after = await state();
        assert.equal(after.turn, before.turn + 1, `${kind} commits once`);
        if (kind === "move")
          assert.equal(after.actors.vale.place, fields.target);
        if (kind === "take")
          assert.equal(after.items[fields.item].holder, "vale");
        await scene();
      };

      await page.goto(`${origin}/?table=${table}`);
      await settle();
      // The guard's tablet on Dione's table has opened the road to Eleusis.
      assert.ok(
        (await state()).packs["greek-drama"].flags["greek-open-door-open"],
      );
      await step({ kind: "drop", item: "lamp", target: "greek-courtyard" });
      // Every story step is an ordinary play: a meeting, a Wait or a gift.
      for (const action of openDoorSteps()) {
        const prior = (await state()).packs["greek-drama"].receipts;
        await step(action);
        const now = await state();
        assert.equal(
          legalActions(now).some(
            (a) =>
              a.kind === "choose" &&
              /^greek-(open-door|homecoming)-/.test(a.choiceId),
          ),
          false,
          "No story button is offered",
        );
        const done = Object.keys(now.packs["greek-drama"].receipts).filter(
          (id) => !(id in prior),
        );
        if (done.includes("greek-open-door-hear-mothers")) {
          // Aethra's story has no hand card; meeting her tells it.
          assert.equal(await page.locator("#hand [data-quest]").count(), 0);
          await page.screenshot({
            path: new URL(`eleusis-quest-${width}.png`, output).pathname,
            fullPage: true,
          });
        }
        if (done.includes("greek-open-door-hear-pyre"))
          await page.screenshot({
            path: new URL(`eleusis-rites-${width}.png`, output).pathname,
            fullPage: true,
          });
        if (
          done.some((id) =>
            [
              "greek-open-door-lay-ashes",
              "greek-open-door-colonus-farewell",
            ].includes(id),
          )
        ) {
          await page.reload();
          await settle();
          assert.deepEqual(
            (await state()).packs["greek-drama"],
            now.packs["greek-drama"],
            "Reload keeps the scene's choices and witnesses",
          );
        }
      }
      let world = await state();
      assert.equal(
        world.packs["greek-drama"].flags["greek-open-door-returned"],
        true,
      );
      assert.equal(world.quests, undefined, "No quest records remain");
      assert.deepEqual([...photographed].sort(), [...OPEN_DOOR_PLACES].sort());
      // The Bard's quest is to hear how the journey ended. The world rules
      // carry it to Vale along its known roads.
      world.actors["greek-rhapsode"].want = {
        kind: "person",
        target: "vale",
        since: world.turn,
        refusals: 0,
      };
      await page.evaluate(({ key, save }) => localStorage.setItem(key, save), {
        key,
        save: encodeSave(world),
      });
      await page.reload();
      await settle();
      for (
        let turn = 0;
        turn < 16 && world.actors["greek-rhapsode"].place !== "greek-courtyard";
        turn++
      ) {
        await step({ kind: "wait" });
        world = await state();
      }
      assert.equal(
        world.actors["greek-rhapsode"].place,
        "greek-courtyard",
        "The Bard reaches the final report",
      );
      const talk = legalActions(world).find(
        (action) =>
          action.kind === "talk" && action.target === "greek-rhapsode",
      );
      assert.ok(talk);
      await step({ kind: "talk", target: "greek-rhapsode" });
      const bard = requests
        .at(-1)
        .entities.find((entity) => entity.id === "greek-rhapsode");
      assert.ok(
        bard.poem.stanzas.some(
          (verse) => verse.id === "greek-open-door-return-dione",
        ),
      );
      await page.screenshot({
        path: new URL(`return-bard-${width}.png`, output).pathname,
        fullPage: true,
      });
      const met = (s) =>
        s.log.filter(
          (e) => e.verb === "want_met" && e.actorId === "greek-rhapsode",
        );
      const completed = met(await state());
      assert.ok(completed.length >= 1, "Hearing Vale meets the Bard's quest");
      await page.reload();
      await settle();
      assert.deepEqual(
        met(await state()),
        completed,
        "The met quest survives reload once",
      );
      assert.deepEqual(errors, []);
      assert.deepEqual(failedAssets, []);
      console.log(
        `Open Door: ${width}px, five places, all stories by ordinary plays, custody, reloads, and the Bard's quest passed.`,
      );
    } finally {
      await page.close();
    }
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const server = createServer();
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  let browser;
  try {
    browser = await chromium.launch({ headless: true });
    await checkOpenDoor(browser, `http://127.0.0.1:${server.address().port}`);
  } finally {
    await browser?.close();
    await new Promise((resolve) => server.close(resolve));
  }
}
