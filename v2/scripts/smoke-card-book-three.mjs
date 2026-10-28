import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { chromium } from "playwright";
import { createServer } from "../card-game/serve.mjs";
import { encodeSave, legalActions } from "../card-game/world.mjs";
import { profiles } from "../card-game/memory.mjs";
import { packDefinition } from "../card-game/pack-registry.mjs";
import { recitalPoem } from "../card-game/pack-recital.mjs";
import { locationDaylight } from "../card-game/daylight.mjs";
import { selectCard } from "./card-browser-helpers.mjs";
import {
  traceBookJourney,
  rhesusJourney,
  troyJourney,
  thraceJourney,
  susaJourney,
} from "../../test/helpers/greek-book-three.mjs";

const chapters = [
  { id: "rhesus", routes: ["warning", "raid"], journey: rhesusJourney },
  {
    id: "troy",
    routes: ["witness", "child-refuge", "family-together"],
    journey: troyJourney,
  },
  {
    id: "thrace",
    routes: ["revenge", "hearing", "two-burials"],
    journey: thraceJourney,
  },
  {
    id: "susa",
    routes: ["public", "private", "reckoning"],
    journey: susaJourney,
  },
];

export async function checkBookThree(browser, origin) {
  const output =
    process.env.COSYWORLD_BOOK_THREE_EVIDENCE ||
    new URL("../../output/book-three/", import.meta.url).pathname;
  await mkdir(output, { recursive: true });
  for (const chapter of chapters.filter(
    (c) =>
      !process.env.COSYWORLD_BOOK_THREE_CHAPTER ||
      c.id === process.env.COSYWORLD_BOOK_THREE_CHAPTER,
  )) {
    for (const route of chapter.routes) {
      const { opening, actions, ending } = traceBookJourney(
        () => chapter.journey(route),
        `greek-${chapter.id}-invitation`,
      );
      for (const width of [1440, 390]) {
        const name = `${chapter.id}-${route}-${width}`;
        const key = `cosyworld.reflected-shore.v1.${name}`;
        const page = await browser.newPage({
          viewport: { width, height: width === 390 ? 844 : 900 },
          reducedMotion: "reduce",
          hasTouch: width === 390,
        });
        const errors = [];
        page.on("pageerror", (e) => errors.push(e.message));
        page.on("response", (r) => {
          if (r.status() >= 400 && r.url().includes("/assets/"))
            errors.push(`${r.status()} ${r.url()}`);
        });
        let current;
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
            { key, save: encodeSave(opening), seen: Object.keys(profiles) },
          );
          await page.route("**/card-game/text", async (request) => {
            const input = request.request().postDataJSON();
            await request.fulfill({
              json: {
                revision: input.revision,
                model: "book-three-browser-fixture",
                entries: input.entities.map(({ id }) => ({
                  id,
                  text:
                    input.disclosures?.find((f) => f.speaker === id)?.text ||
                    "I will keep your words in mind.",
                })),
              },
            });
          });
          const state = () =>
            page.evaluate((key) => JSON.parse(localStorage.getItem(key)), key);
          const settle = async () => {
            await page.waitForSelector("#hand .card");
            for (let n = 0; n < 400; n++) {
              if (await page.locator("#unveil-dialog[open]").count())
                await page.keyboard.press("Escape");
              else if (await page.locator("#dialogue-advance").isVisible())
                await page.locator("#dialogue-advance").click();
              assert.equal(
                await page.locator("#story-retry").isVisible(),
                false,
                "The story completes",
              );
              if (
                (await page.locator("#hand").getAttribute("data-cooling")) ===
                "false"
              )
                return;
              await page.waitForTimeout(40);
            }
            throw new Error(`${name} stayed busy`);
          };
          const photographed = new Set();
          const capture = async (label = null) => {
            assert.ok(
              await page.evaluate(
                () => document.documentElement.scrollWidth <= innerWidth + 1,
              ),
              "The page fits the viewport",
            );
            await page.waitForFunction(() =>
              [...document.querySelectorAll("#backdrop, #cast img")].every(
                (i) => i.complete && i.naturalWidth > 0,
              ),
            );
            const world = await state(),
              place = world.actors.vale.place;
            const phase = locationDaylight(world, place)?.phase || "scene";
            const scene = label || `${place}-${phase}`;
            if (
              (place.startsWith(`greek-${chapter.id}`) || label) &&
              !photographed.has(scene)
            ) {
              photographed.add(scene);
              await page.screenshot({
                path: `${output}/${name}-${scene}.png`,
                fullPage: true,
              });
            }
          };
          await page.goto(`${origin}/?table=${name}`);
          await settle();
          for (const expected of actions) {
            current = expected;
            const before = await state();
            const action = legalActions(before).find((a) =>
              [
                "kind",
                "choiceId",
                "target",
                "item",
                "destination",
                "give",
                "receive",
              ].every((k) => a[k] === expected[k]),
            );
            assert.ok(action, `Offer ${JSON.stringify(expected)}`);
            await page.keyboard.press("Escape");
            for (const id of action.cards?.length
              ? action.cards
              : [action.item || action.target || "vale"])
              await selectCard(page, id, { touch: width === 390 });
            const selector = action.choiceId
              ? `[data-choice="${action.choiceId}"]`
              : `[data-action="${action.kind}"]`;
            await page.locator(`#card-actions ${selector}`).first().click();
            await settle();
            const after = await state();
            assert.equal(
              after.turn,
              before.turn + 1,
              "Each action commits once",
            );
            if (action.choiceId)
              assert.equal(
                after.packs["greek-drama"].receipts[action.choiceId],
                after.turn,
                action.choiceId,
              );
            if (action.kind === "move")
              assert.equal(after.actors.vale.place, action.target);
            if (action.kind === "accompany") {
              assert.equal(after.actors.vale.place, action.destination);
              assert.equal(
                after.actors[action.target].place,
                action.destination,
              );
            }
            for (const receipt of Object.keys(
              after.packs["greek-drama"].receipts,
            )) {
              if (
                receipt.startsWith("greek-troy-record-") &&
                !before.packs["greek-drama"].receipts[receipt]
              ) {
                for (const [carrier, item] of [
                  ["greek-troy-hecuba", "greek-troy-message-a"],
                  ["greek-troy-andromache", "greek-troy-message-b"],
                ]) {
                  assert.equal(after.actors[carrier].place, "greek-harbor");
                  assert.equal(after.items[item].holder, carrier);
                }
              }
            }
            await capture();
            if (
              action.kind === "accompany" ||
              action.choiceId?.includes("agree-") ||
              action.choiceId?.includes("choose-")
            ) {
              const saved = encodeSave(after);
              await page.reload();
              await settle();
              assert.equal(
                encodeSave(await state()),
                saved,
                "Reload keeps physical custody and agreed journeys",
              );
            }
          }
          const world = await state(),
            pack = packDefinition("greek-drama");
          assert.equal(
            world.packs[pack.id].choices[`greek-${chapter.id}-return`],
            route,
          );
          for (const field of ["choices", "flags", "recitals"])
            assert.deepEqual(
              world.packs[pack.id][field],
              ending.packs[pack.id][field],
              `The UI keeps the source’s ${field}`,
            );
          for (const receipt of Object.keys(ending.packs[pack.id].receipts))
            assert.ok(
              world.packs[pack.id].receipts[receipt],
              `The UI records ${receipt}`,
            );
          assert.equal(
            recitalPoem(world, pack).stanzas.filter((s) =>
              s.id.startsWith(`greek-${chapter.id}-`),
            ).length,
            4,
          );
          assert.deepEqual(errors, []);
          await capture("returned-account");
          console.log(
            `Book III ${name}: physical journey, custody, published account, reload and four stanzas passed.`,
          );
        } catch (error) {
          await page
            .screenshot({
              path: `${output}/${name}-failure.png`,
              fullPage: true,
            })
            .catch(() => {});
          await writeFile(
            `${output}/${name}-failure.json`,
            JSON.stringify({ current, errors }, null, 2),
          );
          throw error;
        } finally {
          await page.close();
        }
      }
    }
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const server = createServer();
  await new Promise((done) => server.listen(0, "127.0.0.1", done));
  let browser;
  try {
    browser = await chromium.launch({ headless: true });
    await checkBookThree(browser, `http://127.0.0.1:${server.address().port}`);
  } finally {
    await browser?.close();
    await new Promise((done) => server.close(done));
  }
}
