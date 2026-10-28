import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { chromium } from "playwright";
import { createServer } from "../card-game/serve.mjs";
import { encodeSave, legalActions } from "../card-game/world.mjs";
import { profiles } from "../card-game/memory.mjs";
import { packDefinition } from "../card-game/pack-registry.mjs";
import { recitalPoem } from "../card-game/pack-recital.mjs";
import { aulisJourney } from "../../test/helpers/greek-book-three.mjs";
import { selectCard, topicForChoice } from "./card-browser-helpers.mjs";

function steps(route) {
  const move = (target) => ({ kind: "move", target });
  const take = (item) => ({ kind: "take", item: `greek-lemnos-${item}` });
  const choose = (id) => ({ kind: "choose", choiceId: `greek-lemnos-${id}` });
  const accompany = (destination) => ({
    kind: "accompany",
    target: "greek-lemnos-philoctetes",
    destination,
  });
  const path =
    route === "home"
      ? [
          "greek-lemnos-landing",
          "greek-ship",
          "greek-athens-harbor",
          "greek-athens",
          "greek-delphi",
          "greek-trachis",
        ]
      : [
          "greek-lemnos-landing",
          "greek-ship",
          "greek-ajax-landing",
          "greek-greek-camp",
        ];
  return [
    move("greek-harbor"),
    choose("invitation"),
    move("greek-ship"),
    move("greek-lemnos-landing"),
    take("water"),
    take("herb"),
    move("greek-lemnos"),
    choose("care"),
    choose("hear-loan"),
    take("bow"),
    move("greek-lemnos-landing"),
    choose(`approach-${route === "repair" ? "deception" : "truth"}`),
    choose(`hear-${route === "repair" ? "confession" : "purpose"}`),
    move("greek-lemnos"),
    {
      kind: "give",
      item: "greek-lemnos-bow",
      target: "greek-lemnos-philoctetes",
    },
    choose("return-bow"),
    move("greek-lemnos-landing"),
    choose("hear-heracles"),
    move("greek-lemnos"),
    choose(`agree-${route}`),
    take("water"),
    ...path.map(accompany),
    choose(`arrive-${route}`),
    ...(route === "home"
      ? [
          move("greek-delphi"),
          move("greek-athens"),
          move("greek-athens-harbor"),
        ]
      : [move("greek-ajax-landing")]),
    move("greek-ship"),
    move("greek-harbor"),
    choose("check-manifest"),
    move("greek-courtyard"),
    choose(`return-${route}`),
  ];
}

export async function checkLemnos(browser, origin) {
  const output =
    process.env.COSYWORLD_LEMNOS_EVIDENCE ||
    new URL("../../output/lemnos/", import.meta.url).pathname;
  await mkdir(output, { recursive: true });
  for (const width of [1440, 390]) {
    for (const route of ["troy", "home", "repair"]) {
      const page = await browser.newPage({
        viewport: { width, height: width === 390 ? 844 : 900 },
        reducedMotion: "reduce",
        hasTouch: width === 390,
      });
      const table = `lemnos-${route}-${width}`;
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
          {
            key,
            save: encodeSave(aulisJourney()),
            seen: Object.keys(profiles),
          },
        );
        await page.route("**/card-game/text", async (request) => {
          const input = request.request().postDataJSON();
          await request.fulfill({
            json: {
              revision: input.revision,
              model: "lemnos-browser-fixture",
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
          throw new Error(`Lemnos stayed busy: ${route} ${width}px`);
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
              "greek-lemnos",
              "greek-lemnos-landing",
              "greek-greek-camp",
              "greek-trachis",
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
                .locator('#cast [data-avatar="greek-lemnos-philoctetes"]')
                .count(),
              1,
            );
            await page.screenshot({
              path: `${output}/passenger-${fields.destination}-${route}-${width}.png`,
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
              "greek-lemnos-agree-troy",
              "greek-lemnos-agree-home",
              "greek-lemnos-agree-repair",
            ].includes(action.choiceId) ||
            action.destination === "greek-ship"
          ) {
            const before = await state();
            await page.reload();
            await settle();
            assert.deepEqual(
              (await state()).packs["greek-drama"],
              before.packs["greek-drama"],
              "Reload keeps the agreed passenger and voyage",
            );
          }
        }
        const world = await state();
        assert.equal(
          world.packs["greek-drama"].choices["greek-lemnos-return"],
          route,
        );
        assert.equal(
          world.items["greek-lemnos-water"].holder,
          "greek-courtyard",
        );
        assert.equal(
          recitalPoem(world, packDefinition("greek-drama")).stanzas.filter(
            (v) => v.id.startsWith("greek-lemnos-"),
          ).length,
          4,
        );
        assert.equal(
          world.actors["greek-lemnos-philoctetes"].place,
          route === "home" ? "greek-trachis" : "greek-greek-camp",
        );
        assert.equal(
          world.items["greek-lemnos-bow"].holder,
          "greek-lemnos-philoctetes",
        );
        assert.deepEqual(errors, []);
        assert.deepEqual(failedAssets, []);
        await page.screenshot({
          path: `${output}/return-${route}-${width}.png`,
          fullPage: true,
        });
        console.log(`Lemnos ${route} journey passed at ${width}px.`);
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
    await checkLemnos(browser, `http://127.0.0.1:${server.address().port}`);
  } finally {
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }
}
