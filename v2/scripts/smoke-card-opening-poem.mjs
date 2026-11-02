import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { chromium } from "playwright";
import { createServer } from "../card-game/serve.mjs";
import { encodeSave } from "../card-game/world.mjs";
import { recitalPoem } from "../card-game/pack-recital.mjs";
import { packDefinition } from "../card-game/pack-registry.mjs";
import { profiles } from "../card-game/memory.mjs";
import { narrativeContext } from "../card-game/narrative.mjs";
import { openingFixture } from "../../test/helpers/greek-opening.mjs";
import { selectCard } from "./card-browser-helpers.mjs";

export async function checkOpeningPoem(browser, origin) {
  const output = new URL("../../output/opening-poem/", import.meta.url);
  await mkdir(output, { recursive: true });
  // Every branch runs at desktop width. Each smaller width runs one branch;
  // test/card-opening-poem.test.mjs checks the poem of every branch.
  const branches = ["burial", "concession", "exposure"];
  for (const [index, width] of [1200, 390, 320, 667].entries()) {
    for (const branch of width === 1200
      ? branches
      : [branches[index % branches.length]]) {
      const fixtures = openingFixture(branch);
      const world = structuredClone(
        fixtures.beforeGraveReport || fixtures.returning,
      );
      // The Bard's quest is to hear Vale's account. The world rules carry
      // it to the courtyard by its known roads; the Talk there meets it.
      world.actors["greek-rhapsode"].want = {
        kind: "person",
        target: "vale",
        since: world.turn,
        refusals: 0,
      };
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
          ({ key, save, seen }) => {
            if (!localStorage.getItem(key)) {
              localStorage.setItem(key, save);
              localStorage.setItem(key + ".seen", JSON.stringify(seen));
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
            if (await page.locator("#dialogue-advance").isVisible())
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
        // The story has no card, and quests are not cards: Talk carries
        // one want line, not open-story lines.
        assert.equal(
          await page
            .locator('#hand [data-card="story-quest-greek-courtyard"]')
            .count(),
          0,
        );
        assert.equal(await page.locator("#hand [data-quest]").count(), 0);
        assert.doesNotMatch(
          narrativeContext(world)
            .entities.find((entity) => entity.id === "vale")
            .facts.join(" "),
          /What words will you bring home\?|Open story here/,
        );
        assert.equal(await page.locator("#poem-button").count(), 0);
        await page.screenshot({
          path: new URL(`${branch}-card-${width}.png`, output).pathname,
        });
        // The outcome item given to Dione is the report.
        const outcome =
          branch === "exposure" ? "greek-guard-tablet" : "greek-burial-account";
        await selectCard(page, outcome, { touch: width < 700 });
        await selectCard(page, "greek-baker", { touch: width < 700 });
        await page.locator('#card-actions [data-action="give"]').click();
        await settle();
        const expected = recitalPoem(
          fixtures.closed,
          packDefinition("greek-drama"),
        ).stanzas.map((s) => s.id);
        // The Bard sails and walks from wherever the fixture left it.
        for (let step = 0; step < 10; step++) {
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
            poem.stanzas.map((stanza) => stanza.id),
            expected,
          );
        };
        await speak();
        await page.screenshot({
          path: new URL(`${branch}-bard-${width}.png`, output).pathname,
        });
        await page.reload();
        await settle();
        // Hearing Vale met the Bard's quest; after reload the saved world
        // keeps that fact and sends the Bard home by the world rules.
        const bard = await page.evaluate((key) => {
          const s = JSON.parse(localStorage.getItem(key));
          return {
            xp: s.actors["greek-rhapsode"].xp,
            want: s.actors["greek-rhapsode"].want,
            met: s.log.filter(
              (e) => e.verb === "want_met" && e.actorId === "greek-rhapsode",
            ).length,
          };
        }, key);
        assert.ok(bard.met >= 1, "The Bard's quest was met by the Talk");
        assert.ok(bard.xp >= 1);
        assert.notDeepEqual(bard.want?.target, "vale");
        assert.deepEqual(errors, []);
        console.log(
          `Opening poem: ${branch}, ${width}px, story line in Talk, the Bard's quest to hear Vale, full song context, talk, and reload passed.`,
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
