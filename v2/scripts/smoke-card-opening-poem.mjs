import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { chromium } from "playwright";
import { createServer } from "../card-game/serve.mjs";
import { encodeSave } from "../card-game/world.mjs";
import { activeQuests, openingPoem } from "../card-game/quest-cards.mjs";
import { profiles } from "../card-game/memory.mjs";
import { openingFixture } from "../../test/helpers/greek-opening.mjs";
import { selectCard } from "./card-browser-helpers.mjs";

export async function checkOpeningPoem(browser, origin) {
  const output = new URL("../../output/opening-poem/", import.meta.url);
  await mkdir(output, { recursive: true });
  for (const width of [1200, 390, 320, 667]) {
    for (const branch of ["burial", "concession", "refusal", "exposure"]) {
      const fixtures = openingFixture(branch);
      const world = fixtures.beforeGraveReport || fixtures.returning;
      const table = `poem-${branch}-${width}`;
      const key = `cosyworld.reflected-shore.v1.${table}`;
      const page = await browser.newPage({
        viewport: {
          width,
          height: width === 320 ? 568 : width === 667 ? 375 : 850,
        },
        reducedMotion: "reduce",
        hasTouch: width < 700,
      });
      const errors = [],
        requests = [];
      page.on("pageerror", (e) => errors.push(e.message));
      try {
        await page.addInitScript(
          ({ key, save, seen, quests }) => {
            if (!localStorage.getItem(key)) {
              localStorage.setItem(key, save);
              localStorage.setItem(key + ".seen", JSON.stringify(seen));
              localStorage.setItem(
                key + ".quests",
                JSON.stringify({ seen: quests, read: quests }),
              );
            }
            localStorage.setItem("cosyworld.dialogue.sound", "off");
            localStorage.setItem(
              "cosyworld.room-music",
              JSON.stringify({ enabled: false }),
            );
          },
          {
            key,
            save: encodeSave(world),
            seen: Object.keys(profiles),
            quests: activeQuests(world).map((q) => q.key),
          },
        );
        await page.route("**/card-game/text", (route) => {
          const input = route.request().postDataJSON();
          requests.push(input);
          return route.fulfill({
            json: {
              revision: input.revision,
              model: "poem-fixture",
              entries: input.entities.map(({ id }) => ({
                id,
                text:
                  id === "greek-rhapsode"
                    ? "I hear the weight of that choice in these lines."
                    : "Dione hears the account.",
              })),
            },
          });
        });
        const settle = async () => {
          await page.waitForSelector("#hand .card");
          for (let i = 0; i < 180; i++) {
            if (await page.locator("#unveil-dialog[open]").count())
              await page.keyboard.press("Escape");
            else if (await page.locator("#dialogue-advance").isVisible())
              await page.locator("#dialogue-advance").click();
            await page.waitForTimeout(60);
            if (
              (await page.locator("#hand").getAttribute("data-cooling")) ===
              "false"
            )
              return;
          }
          throw Error("Opening poem stayed busy");
        };
        await page.goto(`${origin}/?table=${table}`);
        await settle();
        assert.ok(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth + 1,
          ),
          "The toolbar fits the screen",
        );
        // The quest face has one line, including when it is selected.
        await selectCard(page, "story-quest-greek-courtyard", {
          touch: width < 700,
        });
        const face = page.locator(
          '#hand [data-card="story-quest-greek-courtyard"]',
        );
        await page.waitForFunction(
          () => {
            const card = document.querySelector(
              '#hand [data-card="story-quest-greek-courtyard"]',
            );
            const hand = document.querySelector("#hand");
            const bounds = card.getBoundingClientRect(),
              room = hand.getBoundingClientRect();
            return bounds.left >= room.left && bounds.right <= room.right + 1;
          },
          null,
          { timeout: 3000 },
        );
        assert.equal(await face.locator(".quest-purpose").count(), 0);
        assert.equal(
          await face.locator(".name").textContent(),
          "What words will you bring home?",
        );
        assert.equal(await page.locator("#poem-button").count(), 0);
        assert.ok(
          await face.evaluate((el) => el.scrollHeight <= el.clientHeight + 1),
        );
        await page.screenshot({
          path: new URL(`${branch}-card-${width}.png`, output).pathname,
        });
        await selectCard(page, "greek-baker", { touch: width < 700 });
        const choice =
          branch === "concession"
            ? "greek-courtyard-permitted-burial"
            : `greek-courtyard-${branch}`;
        await page.locator(`[data-choice="${choice}"]`).click();
        await settle();
        const expected = openingPoem(fixtures.closed).stanzas.map((s) =>
          s.lines.join(" "),
        );
        // The longer burial route leaves one ordinary step before arrival.
        for (let step = 0; step < 4; step++) {
          const arrived = await page.evaluate((key) => {
            const s = JSON.parse(localStorage.getItem(key));
            return s.actors["greek-rhapsode"].place === s.actors.vale.place;
          }, key);
          if (arrived) break;
          await selectCard(page, "vale", { touch: width < 700 });
          await page.locator('#card-actions [data-action="wait"]').click();
          await settle();
        }
        // Poem-only fixtures preserve arrival at the report site through reload.
        await page.reload();
        await settle();
        assert.equal(
          await page.locator('#hand [data-card="greek-rhapsode"]').count(),
          1,
        );
        const speak = async () => {
          await selectCard(page, "greek-rhapsode", { touch: width < 700 });
          await page.locator('#card-actions [data-action="talk"]').click();
          await settle();
          assert.equal(
            await page.locator("#story-retry").isVisible(),
            false,
            "The bard response is accepted",
          );
          const input = requests.at(-1);
          assert.ok(input.speakers.includes("greek-rhapsode"));
          const poem = input.entities.find(
            (e) => e.id === "greek-rhapsode",
          ).poem;
          assert.deepEqual(
            poem.stanzas.map((stanza) => stanza.lines.join(" ")),
            expected,
          );
        };
        await speak();
        await page.screenshot({
          path: new URL(`${branch}-bard-${width}.png`, output).pathname,
        });
        await page.reload();
        await settle();
        await speak();
        assert.deepEqual(errors, []);
        console.log(
          `Opening poem: ${branch}, ${width}px, single-line card, quest-site bard, full song context, talk, and reload passed.`,
        );
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
  let browser;
  try {
    browser = await chromium.launch({ headless: true });
    await checkOpeningPoem(
      browser,
      `http://127.0.0.1:${server.address().port}`,
    );
  } finally {
    await browser?.close();
    await new Promise((resolve) => server.close(resolve));
  }
}
