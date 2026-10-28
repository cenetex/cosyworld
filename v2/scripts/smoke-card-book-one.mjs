import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { chromium } from "playwright";
import { createServer } from "../card-game/serve.mjs";
import { encodeSave, legalActions } from "../card-game/world.mjs";
import { profiles } from "../card-game/memory.mjs";
import { knowsFact } from "../card-game/knowledge.mjs";
import {
  bookJourney,
  bookStart,
  bookAccounts,
} from "../../test/helpers/greek-book-one.mjs";
import { selectCard } from "./card-browser-helpers.mjs";

export async function checkBookOne(browser, origin) {
  const output =
    process.env.COSYWORLD_BOOK_ONE_EVIDENCE ||
    new URL("../../output/book-one/", import.meta.url).pathname;
  await mkdir(output, { recursive: true });
  for (const width of [1440, 390])
    for (const [part, ending] of [
      ["seven", "two-name-vigil"],
      ["phoenician", "family-remembrance"],
      ["tyrannus", "attributed-witnesses"],
      ["bacchae", "local-gathering-agreement"],
    ]) {
      const page = await browser.newPage({
        viewport: { width, height: width === 390 ? 844 : 900 },
        reducedMotion: "reduce",
        hasTouch: width === 390,
      });
      const table = `book-one-${part}-${width}`,
        key = `cosyworld.reflected-shore.v1.${table}`;
      const errors = [],
        failedAssets = [],
        photographed = new Set();
      let current;
      page.on("pageerror", (e) => errors.push(e.message));
      page.on("response", (r) => {
        if (r.status() >= 400 && new URL(r.url()).pathname.includes("/assets/"))
          failedAssets.push(`${r.status()} ${r.url()}`);
      });
      const state = () =>
        page.evaluate((key) => JSON.parse(localStorage.getItem(key)), key);
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
          { key, save: encodeSave(bookStart()), seen: Object.keys(profiles) },
        );
        await page.route("**/card-game/text", async (route) => {
          const input = route.request().postDataJSON();
          await route.fulfill({
            json: {
              revision: input.revision,
              model: "book-one-browser-fixture",
              entries: input.entities.map(({ id }) => ({
                id,
                text:
                  input.disclosures?.find((d) => d.speaker === id)?.text ||
                  "I am listening to the account.",
              })),
            },
          });
        });
        const settle = async () => {
          await page.waitForSelector("#hand .card");
          for (let i = 0; i < 350; i++) {
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
          throw Error(`Book I stayed busy at ${part} ${width}px`);
        };
        const scene = async () => {
          assert.ok(
            await page.evaluate(
              () => document.documentElement.scrollWidth <= innerWidth + 1,
            ),
            "The page fits",
          );
          await page.waitForFunction(() =>
            [...document.querySelectorAll("#backdrop, #cast img")].every(
              (img) => img.complete && img.naturalWidth > 0,
            ),
          );
          const w = await state(),
            place = w.actors.vale.place,
            phase = Math.floor(w.turn / 24) % 2 ? "night" : "day",
            image = `${place}-${phase}`;
          if (
            ["greek-palace", "greek-cithaeron"].includes(place) &&
            !photographed.has(image)
          ) {
            photographed.add(image);
            await page.screenshot({
              path: `${output}/${part}-${image}-${width}.png`,
              fullPage: true,
            });
          }
        };
        const step = async (fields) => {
          current = fields;
          await settle();
          const before = await state(),
            action = legalActions(before).find((a) =>
              Object.entries(fields).every(([k, v]) => a[k] === v),
            );
          assert.ok(action, `Offer ${JSON.stringify(fields)}`);
          await selectCard(
            page,
            action.cards?.[0] || action.item || action.target || "vale",
            { touch: width === 390 },
          );
          const selector = fields.choiceId
            ? `[data-choice="${fields.choiceId}"]`
            : `[data-action="${fields.kind}"]`;
          await page.locator(`#card-actions ${selector}`).first().click();
          await settle();
          const after = await state();
          assert.equal(after.turn, before.turn + 1, "Each action commits once");
          if (fields.choiceId)
            assert.equal(
              after.packs["greek-drama"].receipts[fields.choiceId],
              after.turn,
            );
          if (fields.kind === "move")
            assert.equal(after.actors.vale.place, fields.target);
          if (fields.kind === "take")
            assert.equal(after.items[fields.item].holder, "vale");
          await scene();
        };
        await page.goto(`${origin}/?table=${table}`);
        await settle();
        const { trace } = bookJourney(part, ending);
        for (const entry of trace) {
          if (entry.context) {
            const fact = entry.context.disclosures[0];
            if (!fact.factId.startsWith("greek-")) continue;
            for (
              let i = 0;
              i < 24 && !knowsFact(await state(), "vale", fact.factId);
              i++
            )
              await step({ kind: "talk", target: entry.action.target });
            assert.ok(
              knowsFact(await state(), "vale", fact.factId),
              `Learn ${fact.factId}`,
            );
          } else {
            const action = Object.fromEntries(
              Object.entries(entry.action).filter(
                ([k, v]) =>
                  ["kind", "choiceId", "target", "item"].includes(k) &&
                  v != null,
              ),
            );
            await step(action);
            if (
              action.choiceId?.endsWith("compare-records") ||
              action.choiceId?.endsWith("elder-accepts")
            ) {
              const saved = await state();
              await page.reload();
              await settle();
              assert.deepEqual(
                (await state()).packs,
                saved.packs,
                "Reload preserves the unfinished deed",
              );
            }
          }
        }
        const world = await state();
        assert.equal(
          world.packs["greek-drama"].choices[`greek-${part}-return`],
          ending,
        );
        assert.equal(
          world.items[`greek-${part}-${bookAccounts[part]}`].holder,
          "greek-courtyard",
        );
        await page.reload();
        await settle();
        assert.deepEqual(
          (await state()).knowledge,
          world.knowledge,
          "Reload preserves learned sources",
        );
        assert.deepEqual(errors, []);
        assert.deepEqual(failedAssets, []);
        await page.screenshot({
          path: `${output}/${part}-return-${width}.png`,
          fullPage: true,
        });
        console.log(`Book I ${part} / ${ending} passed at ${width}px.`);
      } catch (error) {
        await page.screenshot({
          path: `${output}/failed-${part}-${width}.png`,
          fullPage: true,
        });
        await writeFile(
          `${output}/failed-${part}-${width}.json`,
          JSON.stringify({
            current,
            world: await state(),
            errors,
            failedAssets,
          }),
        );
        throw error;
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
  const browser = await chromium.launch({ headless: true });
  try {
    await checkBookOne(browser, `http://127.0.0.1:${server.address().port}`);
  } finally {
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }
}
