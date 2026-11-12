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
import { needsVoyage, nextVoyagePlay } from "../../test/helpers/voyage.mjs";
import { MAX_DWELL } from "../card-game/world/dwell.mjs";
import { profiles } from "../card-game/memory.mjs";
import {
  OPEN_DOOR_PLACES,
  openDoorAction,
  openDoorStart,
} from "../../test/helpers/open-door.mjs";
import { greekMoveSteps } from "../../test/helpers/greek-travel.mjs";
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
    // A new world after the burial, played by real rules plays.
    const fixture = openDoorStart();
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
      // One honest solution, after the burial (puzzle 2, order a): the rites
      // sent the cloth home to Eleusis and the oil to Colonus. Carry the
      // petition to Theseus for the truce, gather the kit at Aethra's altar,
      // and give the urn she makes to the Argive Mother.
      assert.equal(
        (await state()).packs["greek-drama"].flags["greek-open-door-open"],
        undefined,
      );
      const move = greekMoveSteps("greek-courtyard");
      const steps = [
        ...move("eleusis"),
        { kind: "take", item: "greek-burial-petition" },
        { kind: "take", item: "greek-funeral-cloth" },
        { kind: "give", item: "greek-funeral-cloth", target: "greek-aethra" },
        ...greekMoveSteps("greek-eleusis")("athens"),
        {
          kind: "trade",
          item: "greek-burial-petition",
          receive: "greek-olive-branch",
        },
        ...greekMoveSteps("greek-athens")("eleusis", "colonus"),
        { kind: "take", item: "greek-oil-flask" },
        ...greekMoveSteps("greek-colonus")("eleusis"),
        { kind: "give", item: "greek-oil-flask", target: "greek-aethra" },
        { kind: "give", item: "greek-olive-branch", target: "greek-aethra" },
        { kind: "take", item: "greek-ash-urn" },
        { kind: "give", item: "greek-ash-urn", target: "greek-argive-mother" },
      ];
      for (const action of steps) {
        await step(action);
        const now = await state();
        assert.equal(
          legalActions(now).some((a) => a.kind === "choose"),
          false,
          "No story button is offered",
        );
        if (action.kind === "give" && action.item === "greek-olive-branch") {
          // Aethra made the urn: the kit went home and the mourners opened.
          assert.equal(now.usedUp.includes("greek-ash-urn"), false);
          assert.equal(now.items["greek-olive-branch"].holder, "greek-courtyard");
          assert.equal(now.items["greek-oil-flask"].holder, "greek-colonus");
          await page.screenshot({
            path: new URL(`eleusis-urn-${width}.png`, output).pathname,
            fullPage: true,
          });
          await page.reload();
          await settle();
          assert.deepEqual(
            (await state()).items,
            now.items,
            "Reload keeps where every thing lies",
          );
        }
      }
      const world = await state();
      assert.equal(world.items["greek-ash-urn"].holder, "greek-argive-mother");
      assert.equal(world.items["greek-burial-petition"].holder, "greek-theseus");
      assert.ok(world.actors["greek-argive-mother"].metTurn !== undefined);
      assert.deepEqual(
        Object.keys(world.packs["greek-drama"].flags).filter((k) =>
          k.startsWith("greek-open-door"),
        ),
        [],
        "No Open Door flag is set",
      );
      assert.equal(world.quests, undefined, "No quest records remain");
      for (const place of ["greek-athens", "greek-colonus", "greek-eleusis"])
        assert.ok(photographed.has(place), `${place} was seen`);
      assert.deepEqual(errors, []);
      assert.deepEqual(failedAssets, []);
      console.log(
        `Open Door: ${width}px, the petition, the truce, the urn and the Argive Mother by ordinary plays, with a reload, passed.`,
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
