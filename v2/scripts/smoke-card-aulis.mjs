import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { chromium } from "playwright";
import { createServer } from "../card-game/serve.mjs";
import { encodeSave, legalActions } from "../card-game/world.mjs";
import { profiles } from "../card-game/memory.mjs";
import { packDefinition } from "../card-game/pack-registry.mjs";
import { recitalPoem } from "../card-game/pack-recital.mjs";
import { ajaxJourney } from "../../test/helpers/greek-ajax.mjs";
import { selectCard, topicForChoice } from "./card-browser-helpers.mjs";

function steps(route) {
  const move = (target) => ({ kind: "move", target });
  const take = (item) => ({ kind: "take", item: `greek-aulis-${item}` });
  const choose = (id) => ({ kind: "choose", choiceId: `greek-aulis-${id}` });
  return [
    move("greek-harbor"),
    choose("invitation"),
    move("greek-ship"),
    move("greek-aulis"),
    choose("hear-recall"),
    take("recall-letter"),
    move("greek-aulis-household"),
    choose("deliver-recall"),
    choose("hear-purpose"),
    take("wedding-veil"),
    choose("tell-daughter"),
    choose("hear-daughter"),
    move("greek-aulis"),
    choose("secure-witness"),
    move("greek-aulis-household"),
    choose(`choose-${route}`),
    take("offering-cloth"),
    ...(route === "escape"
      ? [
          {
            kind: "accompany",
            target: "greek-aulis-iphigenia",
            destination: "greek-aulis",
          },
        ]
      : [
          move("greek-aulis"),
          move("greek-aulis-altar"),
          choose(`prepare-${route}`),
          ...(route === "rescue"
            ? [
                move("greek-aulis"),
                choose("hear-rescue-report"),
                move("greek-aulis-altar"),
              ]
            : []),
        ]),
    choose(`complete-${route}`),
    ...(route === "escape" ? [] : [move("greek-aulis")]),
    move("greek-aulis-household"),
    take("departure-record"),
    choose(`record-${route}`),
    move("greek-aulis"),
    move("greek-ship"),
    move("greek-harbor"),
    move("greek-courtyard"),
    choose(`return-${route}`),
  ];
}

export async function checkAulis(browser, origin) {
  const output =
    process.env.COSYWORLD_AULIS_EVIDENCE ||
    new URL("../../output/aulis/", import.meta.url).pathname;
  await mkdir(output, { recursive: true });
  for (const width of [1440, 390]) {
    for (const route of ["escape", "sacrifice", "rescue"]) {
      const page = await browser.newPage({
        viewport: { width, height: width === 390 ? 844 : 900 },
        reducedMotion: "reduce",
        hasTouch: width === 390,
      });
      const table = `aulis-${route}-${width}`;
      const key = `cosyworld.reflected-shore.v1.${table}`;
      const errors = [],
        failedAssets = [];
      page.on("pageerror", (error) => errors.push(error.message));
      page.on("response", (response) => {
        if (
          response.status() >= 400 &&
          new URL(response.url()).pathname.includes("/assets/")
        )
          failedAssets.push(`${response.status()} ${response.url()}`);
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
          { key, save: encodeSave(ajaxJourney()), seen: Object.keys(profiles) },
        );
        await page.route("**/card-game/text", async (request) => {
          const input = request.request().postDataJSON();
          await request.fulfill({
            json: {
              revision: input.revision,
              model: "aulis-browser-fixture",
              entries: input.entities.map(({ id }) => ({
                id,
                text:
                  input.disclosures?.find((fact) => fact.speaker === id)
                    ?.text || "I will keep your words in mind.",
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
          throw new Error(`Aulis stayed busy: ${route} ${width}px`);
        };
        const photographed = new Set();
        const scene = async () => {
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
          const place = (await state()).actors.vale.place;
          if (
            [
              "greek-aulis",
              "greek-aulis-household",
              "greek-aulis-altar",
            ].includes(place) &&
            !photographed.has(place)
          ) {
            photographed.add(place);
            await page.screenshot({
              path: `${output}/${place}-${route}-${width}.png`,
              fullPage: true,
            });
          }
        };
        const step = async ({ kind, ...fields }) => {
          current = { kind, ...fields };
          await settle();
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
          const topic = topicForChoice(fields.choiceId);
          const action = legalActions(before).find((a) =>
            topic
              ? a.kind === "talk" && a.target === topic.speaker
              : a.kind === kind &&
                Object.entries(fields).every(([k, v]) => a[k] === v),
          );
          assert.ok(action, `Offer ${kind} ${JSON.stringify(fields)}`);
          for (const id of action.cards?.length
            ? action.cards
            : [action.item || action.target || "vale"])
            await selectCard(page, id, { touch: width === 390 });
          const selector = topic
            ? '[data-action="talk"]'
            : fields.choiceId
              ? `[data-choice="${fields.choiceId}"]`
              : `[data-action="${kind}"]`;
          await page.locator(`#card-actions ${selector}`).first().click();
          await settle();
          const after = await state();
          assert.equal(after.turn, before.turn + 1, "Each action commits once");
          if (fields.choiceId)
            assert.equal(
              after.packs["greek-drama"].receipts[fields.choiceId],
              after.turn,
              fields.choiceId,
            );
          if (kind === "move")
            assert.equal(after.actors.vale.place, fields.target);
          if (kind === "accompany") {
            assert.equal(after.actors.vale.place, fields.destination);
            assert.equal(after.actors[fields.target].place, fields.destination);
          }
          if (kind === "take")
            assert.equal(after.items[fields.item].holder, "vale");
          await scene();
          if (kind === "accompany") {
            assert.equal(
              await page
                .locator('#cast [data-avatar="greek-aulis-iphigenia"]')
                .count(),
              1,
            );
            await page.screenshot({
              path: `${output}/living-arrival-${width}.png`,
              fullPage: true,
            });
          }
        };
        await page.goto(`${origin}/?table=${table}`);
        await settle();
        for (const action of steps(route)) {
          await step(action);
          if (
            [
              "greek-aulis-choose-escape",
              "greek-aulis-prepare-sacrifice",
              "greek-aulis-prepare-rescue",
            ].includes(action.choiceId)
          ) {
            const before = await state();
            await page.reload();
            await settle();
            assert.deepEqual(
              (await state()).packs["greek-drama"],
              before.packs["greek-drama"],
              "Reload keeps the prepared rite",
            );
          }
        }
        const world = await state();
        assert.equal(
          world.packs["greek-drama"].choices["greek-aulis-return"],
          route,
        );
        assert.equal(
          world.items["greek-aulis-departure-record"].holder,
          "greek-courtyard",
        );
        assert.equal(
          recitalPoem(world, packDefinition("greek-drama")).stanzas.filter(
            (v) => v.id.startsWith("greek-aulis-"),
          ).length,
          4,
        );
        assert.deepEqual(errors, []);
        assert.deepEqual(failedAssets, []);
        await page.screenshot({
          path: `${output}/return-${route}-${width}.png`,
          fullPage: true,
        });
        console.log(`Aulis ${route} journey passed at ${width}px.`);
      } catch (error) {
        await page.screenshot({
          path: `${output}/failed-${route}-${width}.png`,
          fullPage: true,
        });
        await writeFile(
          `${output}/failed-${route}-${width}.json`,
          JSON.stringify({
            current,
            save: await page.evaluate(
              (key) => JSON.parse(localStorage.getItem(key)),
              key,
            ),
            cards: await page
              .locator("#hand [data-card]")
              .evaluateAll((cards) => cards.map((card) => card.dataset.card)),
          }),
        );
        throw error;
      } finally {
        await page.close();
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
    await checkAulis(browser, `http://127.0.0.1:${server.address().port}`);
  } finally {
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }
}
