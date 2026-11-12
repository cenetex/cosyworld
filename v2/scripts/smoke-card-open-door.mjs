import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { chromium } from "playwright";
import { createServer } from "../card-game/serve.mjs";
import {
  currentActor,
  encodeSave,
  legalActions,
  play,
} from "../card-game/world.mjs";
import { worldLife } from "../card-game/resident-home.mjs";
import { needsVoyage, nextVoyagePlay } from "../../test/helpers/voyage.mjs";
import { MAX_DWELL } from "../card-game/world/dwell.mjs";
import { profiles } from "../card-game/memory.mjs";
import {
  OPEN_DOOR_PLACES,
  openDoorAction,
  openDoorJourney,
  playOpenDoor,
  openDoorSteps,
  openDoorStart,
} from "../../test/helpers/open-door.mjs";
import {
  clearSelection,
  selectCard,
  smokeWidths,
  unreachableCards,
  wordsFellSilent,
} from "./card-browser-helpers.mjs";

export async function checkOpenDoor(browser, origin) {
  const output = new URL("../../output/open-door/", import.meta.url);
  await mkdir(output, { recursive: true });
  for (const width of smokeWidths([1440, 390])) {
    // Marathon and the full return are rumours in new worlds (rules 94); an
    // old full-scope world keeps all five stories, so the walk plays there.
    const fixture = openDoorStart({ rumours: true });
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
          if (await page.locator("#dialogue-advance").isVisible())
            await page.locator("#dialogue-advance").click();
          if (await wordsFellSilent(page, key))
            throw new Error(`Story fell silent at ${width}px.`);
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
        // Everything lying at the traveler's place can be tapped: shown, or
        // in a stack whose top is shown (a place's things, the ways on).
        assert.deepEqual(
          await unreachableCards(page),
          [],
          `Every card at ${place} is reachable at ${width}px`,
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
          // Myrto's packed load is made from bread, figs and wine elsewhere
          // (tested on its own); this story only needs it lying on deck.
          const packed = await state();
          if (
            packed.actors.vale.place === "greek-harbor" &&
            packed.items["greek-provisions"].holder !== "greek-ship"
          ) {
            packed.usedUp = (packed.usedUp || []).filter(
              (id) => id !== "greek-provisions",
            );
            packed.items["greek-provisions"].holder = "greek-ship";
            await page.evaluate(
              ({ key, save }) => localStorage.setItem(key, save),
              { key, save: encodeSave(packed) },
            );
            await page.reload();
            await settle();
          }
        }
        // Residents move about twice a game day (the dwell rule): a play with
        // one waits until it stands here, then goes on. It must come within
        // two stays; if it never does, the story cannot be played.
        const legalNow = async () =>
          legalActions(await state()).some(
            (a) =>
              a.kind === kind &&
              Object.entries(fields).every(([k, v]) => a[k] === v),
          );
        for (
          let n = 0;
          n < 2 * MAX_DWELL && kind !== "wait" && !(await legalNow());
          n++
        )
          await step({ kind: "wait" });
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
        // A play commits one turn. Past bedtime the traveler sleeps on, and
        // the world runs on until Vale wakes, so those plays add turns.
        const sleptThrough = after.log
          .slice(-12)
          .some((line) => /\bVale wakes\b/u.test(line.text || ""));
        if (sleptThrough)
          assert.ok(
            after.turn > before.turn,
            `${kind} commits and Vale sleeps`,
          );
        else assert.equal(after.turn, before.turn + 1, `${kind} commits once`);
        if (kind === "move")
          assert.equal(after.actors.vale.place, fields.target);
        if (kind === "take")
          assert.equal(after.items[fields.item].holder, "vale");
        await scene();
      };

      await page.goto(`${origin}/?table=${table}`);
      await settle();
      // Burying Polynices opens nothing: Attica was there all along.
      assert.equal(
        (await state()).packs["greek-drama"].flags["greek-open-door-open"],
        undefined,
      );
      // Every story step is an ordinary play: a meeting, a Wait or a gift.
      // A deed done by Waiting needs its resident here; the residents move
      // about (the dwell rule), so the browser waits for the deed to be
      // possible. Which steps do a deed is learned from the cast standing
      // still, once, in the rules themselves.
      const steps = openDoorSteps({ rumours: true });
      const deeds = [];
      {
        let sim = openDoorStart({ rumours: true });
        for (const { kind, ...fields } of steps) {
          const prior = Object.keys(sim.packs["greek-drama"].receipts);
          sim = playOpenDoor(sim, kind, fields);
          deeds.push(
            Object.keys(sim.packs["greek-drama"].receipts).filter(
              (id) => !prior.includes(id),
            ),
          );
        }
      }
      const waitDoes = async (expected) => {
        const world = await state();
        const wait = legalActions(world).find((a) => a.kind === "wait");
        worldLife.on = true;
        try {
          const result = play(world, wait, world.revision);
          return (
            result.ok &&
            expected.every(
              (id) => id in result.state.packs["greek-drama"].receipts,
            )
          );
        } finally {
          worldLife.on = false;
        }
      };
      for (const [index, action] of steps.entries()) {
        if (action.kind === "wait" && deeds[index].length)
          for (
            let n = 0;
            n < 2 * MAX_DWELL && !(await waitDoes(deeds[index]));
            n++
          )
            await step({ kind: "wait" });
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
        // Arriving meets only whoever stands here; the rest come on a later play.
        for (const id of action.kind === "move" ? [] : deeds[index])
          assert.ok(done.includes(id), `${id} was done by ${action.kind}`);
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
