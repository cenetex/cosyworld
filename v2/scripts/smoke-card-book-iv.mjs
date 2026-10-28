import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { chromium } from "playwright";
import { createServer } from "../card-game/serve.mjs";
import { encodeSave, legalActions } from "../card-game/world.mjs";
import { profiles } from "../card-game/memory.mjs";
import { selectCard } from "./card-browser-helpers.mjs";
import {
  traceIV,
  helenJourney,
  andromacheJourney,
  hippolytusJourney,
  medeaJourney,
  ionJourney,
} from "../../test/helpers/book-iv.mjs";

const chapters = {
  helen: [helenJourney, ["hearing", "sanctuary", "escape"]],
  andromache: [andromacheJourney, ["protection", "departure"]],
  hippolytus: [hippolytusJourney, ["hearing", "source"]],
  medea: [medeaJourney, ["departure", "source", "reckoning"]],
  ion: [ionJourney, ["private", "public", "temple"]],
};
export async function checkBookIV(browser, origin) {
  const output =
    process.env.COSYWORLD_BOOK_IV_EVIDENCE ||
    new URL("../../output/book-iv/", import.meta.url).pathname;
  await mkdir(output, { recursive: true });
  const selected = process.env.COSYWORLD_BOOK_IV_CHAPTERS?.split(",");
  for (const [chapter, [journey, routes]] of Object.entries(chapters)) {
    if (selected && !selected.includes(chapter)) continue;
    for (const route of routes) {
      const trace = traceIV(journey, route);
      for (const width of [1440, 390]) {
        const page = await browser.newPage({
          viewport: { width, height: width === 390 ? 844 : 900 },
          reducedMotion: "reduce",
          hasTouch: width === 390,
        });
        const table = `book-iv-${chapter}-${route}-${width}`,
          key = `cosyworld.reflected-shore.v1.${table}`;
        const errors = [],
          failedAssets = [],
          photographed = new Set();
        let current;
        page.on("pageerror", (e) => errors.push(e.message));
        page.on("response", (r) => {
          if (
            r.status() >= 400 &&
            new URL(r.url()).pathname.includes("/assets/")
          )
            failedAssets.push(`${r.status()} ${r.url()}`);
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
            { key, save: encodeSave(trace.world), seen: Object.keys(profiles) },
          );
          await page.route("**/card-game/text", async (r) => {
            const input = r.request().postDataJSON();
            await r.fulfill({
              json: {
                revision: input.revision,
                model: "book-iv-browser-fixture",
                entries: input.entities.map(({ id }) => ({
                  id,
                  text:
                    input.disclosures?.find((d) => d.speaker === id)?.text ||
                    "I am listening to this account.",
                })),
              },
            });
          });
          const state = () =>
            page.evaluate((key) => JSON.parse(localStorage.getItem(key)), key);
          const settle = async () => {
            await page.waitForSelector("#hand .card");
            for (let i = 0; i < 250; i++) {
              if (await page.locator("#unveil-dialog[open]").count())
                await page.keyboard.press("Escape");
              else if (await page.locator("#dialogue-advance").isVisible())
                await page.locator("#dialogue-advance").click();
              assert.equal(
                await page.locator("#story-retry").isVisible(),
                false,
                "The scene completes",
              );
              if (
                (await page.locator("#hand").getAttribute("data-cooling")) ===
                "false"
              )
                return;
              await page.waitForTimeout(40);
            }
            throw new Error(`Busy scene ${chapter}/${route}/${width}`);
          };
          const scene = async () => {
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
            const here = (await state()).actors.vale.place;
            if (
              (here.startsWith("greek-book-iv-") ||
                [
                  "greek-thetis",
                  "greek-troezen",
                  "greek-corinth",
                  "greek-delphi",
                ].includes(here)) &&
              !photographed.has(here)
            ) {
              photographed.add(here);
              await page.screenshot({
                path: `${output}/${chapter}-${route}-${width}-${here}.png`,
                fullPage: true,
              });
            }
          };
          const step = async ({ kind, topic, ...fields }) => {
            current = { kind, topic, ...fields };
            await settle();
            if (kind === "move" && fields.target === "greek-ship")
              for (
                let i = 0;
                i < 32 &&
                !legalActions(await state()).some(
                  (a) => a.kind === "move" && a.target === "greek-ship",
                );
                i++
              )
                await step({ kind: "wait" });
            const before = await state();
            const action = legalActions(before).find(
              (a) =>
                a.kind === kind &&
                Object.entries(fields).every(([k, v]) => a[k] === v),
            );
            assert.ok(action, `Offer ${JSON.stringify(current)}`);
            const cards = action.cards?.length
              ? action.cards
              : [action.item || action.target || "vale"];
            for (const id of [...new Set(cards)])
              await selectCard(page, id, { touch: width === 390 });
            const selector = fields.choiceId
              ? `[data-choice="${fields.choiceId}"]`
              : `[data-action="${kind}"]`;
            await page.locator(`#card-actions ${selector}`).first().click();
            await settle();
            const after = await state();
            assert.equal(after.turn, before.turn + 1, "The play commits once");
            if (topic)
              assert.ok(
                after.knowledge.known.vale?.[topic],
                `Publish ${topic}`,
              );
            if (fields.choiceId)
              assert.equal(
                after.packs["greek-drama"].receipts[fields.choiceId],
                after.turn,
              );
            if (kind === "move")
              assert.equal(after.actors.vale.place, fields.target);
            if (kind === "take")
              assert.equal(after.items[fields.item].holder, "vale");
            if (kind === "accompany") {
              assert.equal(after.actors.vale.place, fields.destination);
              assert.equal(
                after.actors[fields.target].place,
                fields.destination,
              );
            }
            await scene();
          };
          await page.goto(`${origin}/?table=${table}`);
          await settle();
          for (let index = 0; index < trace.steps.length; index++) {
            await step(trace.steps[index]);
            if (index === Math.floor(trace.steps.length / 2)) {
              const before = await state();
              await page.reload();
              await settle();
              assert.deepEqual(
                (await state()).packs["greek-drama"],
                before.packs["greek-drama"],
                "Reload keeps the account",
              );
            }
          }
          const world = await state();
          assert.equal(
            world.packs["greek-drama"].choices[
              `greek-book-iv-${chapter}-return`
            ],
            route,
          );
          assert.equal(
            world.items[`greek-book-iv-${chapter}-account`].holder,
            "greek-courtyard",
          );
          assert.deepEqual(errors, []);
          assert.deepEqual(failedAssets, []);
          await page.screenshot({
            path: `${output}/${chapter}-${route}-${width}-return.png`,
            fullPage: true,
          });
          console.log(
            `Book IV ${chapter}/${route} passed at ${width}px (${trace.steps.length} plays).`,
          );
        } catch (error) {
          await page.screenshot({
            path: `${output}/failed-${chapter}-${route}-${width}.png`,
            fullPage: true,
          });
          await writeFile(
            `${output}/failed-${chapter}-${route}-${width}.json`,
            JSON.stringify({
              current,
              save: await state(),
              error: error.message,
            }),
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
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const browser = await chromium.launch({ headless: true });
  try {
    await checkBookIV(browser, `http://127.0.0.1:${server.address().port}`);
  } finally {
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }
}
