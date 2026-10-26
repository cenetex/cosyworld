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
      const errors = [];
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
          return route.fulfill({
            json: {
              revision: input.revision,
              model: "poem-fixture",
              entries: input.entities.map(({ id }) => ({
                id,
                text: "Dione hears the account.",
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
          "The poem toolbar fits the screen",
        );
        // The return card remains a short couplet at the smallest width.
        await selectCard(page, "story-quest-greek-courtyard", {
          touch: width < 700,
        });
        const face = page.locator(
          '#hand [data-card="story-quest-greek-courtyard"]',
        );
        assert.equal(
          (await face.locator(".quest-purpose").textContent()).split("\n")
            .length,
          2,
        );
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
          s.lines.join("\n"),
        );
        const readPoem = async () => {
          await page.locator("#poem-button").click();
          await page.locator("#poem-dialog[open]").waitFor();
          assert.deepEqual(
            await page.locator("#poem-verses p").allTextContents(),
            expected,
          );
          assert.ok(
            await page
              .locator("#poem-dialog")
              .evaluate(
                (el) =>
                  el.scrollWidth <= el.clientWidth + 1 &&
                  el.getBoundingClientRect().right <= innerWidth,
              ),
          );
        };
        await readPoem();
        await page.screenshot({
          path: new URL(`${branch}-poem-${width}.png`, output).pathname,
        });
        await page.locator('[data-close="poem-dialog"]').click();
        await page.reload();
        await settle();
        await readPoem();
        await page.locator('[data-close="poem-dialog"]').click();
        await selectCard(page, "greek-harbor", { touch: width < 700 });
        await page.locator('#card-actions [data-action="move"]').click();
        await settle();
        await readPoem();
        assert.deepEqual(errors, []);
        console.log(
          `Opening poem: ${branch}, ${width}px, card fit, return, reload, and travel passed.`,
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
