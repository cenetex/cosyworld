// Quest offers are cards you can tap (rules 133, #2605). From a fresh world:
// the shut pond offers no quest and says why; Pip's Talk lays his Accept
// quest card beside him; chosen, it has exactly one button; pressing it takes
// the quest with no turn passing, the offer is gone and the held quest card
// is there; another offer then shows its reason as the button's label;
// meeting the want pays XP with no Claim; at the level's threshold the
// level-up card appears, is taken and the attic's Sleep raises the level.
// A lock or quest that concerns a card the traveler has not discovered names
// nothing: no word, aria label, title, alt text or image of it, in the bar,
// the button or the quest card; it shows the face-down back, and names the
// card once it is discovered.
//
//   node v2/scripts/smoke-card-quest-offers.mjs [screenshot-dir]
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { chromium } from "playwright";
import { createServer } from "../card-game/serve.mjs";
import { decodeSave, encodeSave } from "../card-game/world.mjs";
import { newWant } from "../card-game/want.mjs";
import { DISSOLVE_MS } from "../card-game/card-travel.mjs";
import { greekErrands } from "../../test/helpers/greek-opening.mjs";
import { journeyWorlds } from "../../test/helpers/journey.mjs";
import { questCards } from "../../test/journeys/quest-cards.mjs";
import {
  clearSelection,
  openPack,
  putOutOpening,
  revealCard,
  selectCard,
  smokeWidths,
  tapCard,
} from "./card-browser-helpers.mjs";

const output = new URL(
  process.argv[2]
    ? `file://${process.argv[2].replace(/\/?$/u, "/")}`
    : "../../output/quest-offers/",
  import.meta.url,
);
await mkdir(output, { recursive: true });
const BLOCKED = "Finish or discard your quest first";
const journey = journeyWorlds(questCards);
const server = createServer();
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
let browser;
try {
  browser = await chromium.launch({
    headless: true,
    executablePath: process.env.CHROMIUM_PATH,
  });
  for (const width of smokeWidths([1440, 390, 320])) {
    const height = width === 1440 ? 900 : width === 390 ? 844 : 640;
    const open = async (name, world, covered = []) => {
      const page = await browser.newPage({
        viewport: { width, height },
        reducedMotion: "reduce",
      });
      page.setDefaultTimeout(20000);
      const key = `cosyworld.reflected-shore.v1.${name}-${width}`;
      const errors = [];
      page.on("pageerror", (error) => errors.push(error.message));
      if (world)
        await page.addInitScript(
          ({ key, save, seen, covered }) => {
            if (!localStorage.getItem(key)) {
              localStorage.setItem(key, save);
              localStorage.setItem(`${key}.seen`, JSON.stringify(seen));
              localStorage.setItem(`${key}.seen.covered`, JSON.stringify(covered));
            }
            localStorage.setItem("cosyworld.dialogue.sound", "off");
          },
          {
            key,
            save: encodeSave(world),
            seen: [
              ...Object.keys(world.actors),
              ...Object.keys(world.items),
              ...Object.keys(world.locations),
            ],
            covered,
          },
        );
      await page.route("**/card-game/text", (route) => {
        const context = route.request().postDataJSON();
        return route.fulfill({
          json: {
            revision: context.revision,
            model: "quest-offers-fixture",
            entries: context.entities.map(({ id }) => ({
              id,
              text: "There is room beside the lamp.",
            })),
          },
        });
      });
      const state = () =>
        page.evaluate((k) => JSON.parse(localStorage.getItem(k)), key);
      const ready = async () => {
        for (let i = 0; i < 250; i++) {
          if ((await page.locator("#hand").getAttribute("data-cooling")) === "false")
            return;
          if (await page.locator("#dialogue-advance").isVisible())
            await page.locator("#dialogue-advance").click();
          await page.waitForTimeout(40);
        }
        throw new Error("The hand stayed busy.");
      };
      const shot = async (label) => {
        await page.waitForTimeout(900);
        await page.screenshot({
          path: new URL(`${label}-${width}.png`, output).pathname,
        });
      };
      // Exactly one button per chosen card, and nothing is clipped or
      // under the action bar.
      const oneButton = async () => {
        const buttons = await page.locator("#card-actions button").count();
        assert(buttons <= 1, `the action row has ${buttons} buttons`);
        return buttons;
      };
      const layout = async () => {
        const problems = await page.evaluate(() => {
          const bar = document.getElementById("action-beat").getBoundingClientRect();
          const out = [];
          for (const el of document.querySelectorAll('#hand [data-card^="quest:"]')) {
            const frame = el.parentElement;
            if (frame.hidden) continue;
            const box = el.getBoundingClientRect();
            if (box.width < 40 || box.height < 40) out.push(`${el.dataset.card} is tiny`);
            if (box.right < 0 || box.left > innerWidth + 1) continue;
            if (box.top < 0 || box.bottom > innerHeight + 2)
              out.push(`${el.dataset.card} leaves the page`);
            if (box.top < bar.bottom && box.bottom > bar.top && box.top > bar.top)
              out.push(`${el.dataset.card} lies under the action bar`);
          }
          return out;
        });
        assert.deepEqual(problems, []);
      };
      return { page, key, errors, state, ready, shot, oneButton, layout };
    };
    // Everything the traveler can read or see of the bar, the context button
    // and the quest cards: words, aria labels, titles, alt text and images.
    // A card the traveler has not discovered must appear in none of it.
    const surfaces = (page) =>
      page.evaluate(() => {
        const roots = [
          ...document.querySelectorAll(
            '#action-beat, #card-actions, #hand [data-card^="quest:"], #hand .want-frame, #hand .quest-fold',
          ),
        ];
        const seen = [];
        for (const root of roots)
          for (const el of [root, ...root.querySelectorAll("*")]) {
            seen.push(el.children.length ? "" : el.textContent);
            for (const name of ["aria-label", "title", "alt", "src", "data-tap-verb"])
              seen.push(el.getAttribute(name) ?? "");
          }
        return seen.filter(Boolean).join("\n");
      });
    const offerCards = (page) => page.locator('#hand [data-card^="quest:"]');
    const motion = async (page, reducedMotion) => {
      await page.emulateMedia({ reducedMotion });
      await page.evaluate(() => window.motionPreferenceReady);
    };
    const watchQuest = (page) =>
      page.evaluate(() => {
        const seen = (window.questWatch = []);
        const look = () => {
          const cards = [...document.querySelectorAll("#hand .card-frame:not([hidden]) > .want-card")],
            box = cards[0]?.getBoundingClientRect(),
            over = box && document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 4);
          seen.push({
            look: [cards.length, cards[0]?.getAttribute("aria-pressed"), cards[0]?.dataset.unrevealed],
            top: Boolean(over && cards[0].contains(over)),
            left: Math.round(box?.left),
            copies: document.querySelectorAll(".card-exits .want-card").length,
          });
          if (seen.length < 45) requestAnimationFrame(look);
        };
        look();
      });
    const label = async (page) =>
      (await page.locator("#card-actions button").first().getAttribute("data-tap-verb")) ||
      (await page.locator("#card-actions button").first().textContent());

    // A face-down offer leaks nothing: not in the bar, the button, any
    // accessible name or the card itself. Alone, it is selected by hand and
    // its one button opens it. Among three or more face-down cards it lies
    // in the pack, where the first tap turns it (pack-opening.mjs); it is
    // then chosen like any card.
    const closedOffer = async (page, t, id, shot) => {
      const card = page.locator(`#hand [data-card="${id}"]`);
      assert.equal(await card.getAttribute("data-unrevealed"), "true");
      assert.equal(await card.getAttribute("aria-label"), "Closed box. Select to inspect.");
      const leaks = (id) =>
        page.evaluate(
          (id) =>
            [
              document.querySelector(`#hand [data-card="${id}"]`).textContent,
              document.querySelector("#action-beat").innerText,
              ...[...document.querySelectorAll(
                `#card-actions *, #action-beat *, #hand [data-card="${id}"] *`,
              )].flatMap((el) => [
                el.getAttribute("aria-label"),
                el.getAttribute("title"),
                el.getAttribute("alt"),
                el.getAttribute("src"),
              ]),
            ]
              .filter(Boolean)
              .join(" | "),
          id,
        );
      const noLeak = /lamp|pip|moth|quest|give|take|accept|cloth|writ/iu;
      if ((await card.locator("..").getAttribute("data-pack")) !== null) {
        assert.doesNotMatch(await leaks(id), noLeak);
        assert.equal(await openPack(page, id), true);
        await page.waitForFunction(
          (id) => document.querySelector(`#hand [data-card="${id}"]`)?.dataset.unrevealed === "false",
          id,
        );
        await card.scrollIntoViewIfNeeded();
        await card.click();
        await t.ready();
        assert.equal(await t.oneButton(), 1);
        return;
      }
      await card.scrollIntoViewIfNeeded();
      await card.click();
      await t.ready();
      assert.equal(await t.oneButton(), 1);
      const button = page.locator("#card-actions button").first();
      assert.equal(await button.getAttribute("data-open-box"), id);
      assert.equal(await button.isDisabled(), false);
      assert.equal(await page.locator("#selection-name").textContent(), "Closed box");
      assert.match(await page.locator("#action-beat").innerText(), /A closed box/u);
      const seen = await leaks(id);
      assert.doesNotMatch(seen, noLeak, seen);
      if (shot) await t.shot(shot);
      await button.click();
      await page.waitForFunction(
        (id) => document.querySelector(`#hand [data-card="${id}"]`)?.dataset.unrevealed === "false" &&
          !document.querySelector(`#hand [data-card="${id}"]`)?.dataset.revealing,
        id,
      );
      await t.ready();
      assert.equal(await t.oneButton(), 1);
    };

    // 1. A fresh world: the pond is shut, offers nothing, and says why.
    {
      const t = await open("quest-offers-fresh");
      const { page } = t;
      await page.goto(`${origin}/?table=quest-offers-fresh-${width}`);
      await page.locator('[data-card="lamp"]').waitFor({ state: "attached" });
      await t.ready();
      assert.equal(await offerCards(page).count(), 0);
      // The shut pond has no quest; its one disabled button says why.
      await selectCard(page, "pond");
      assert.equal(await t.oneButton(), 1);
      const shut = page.locator("#card-actions button").first();
      assert.equal(await shut.isDisabled(), true);
      assert.equal(await shut.textContent(), "Locked");
      // The Lamp is not yet discovered: the lock asks for something
      // undiscovered, and names nothing.
      assert.equal(
        await page.locator(".action-beat-text").textContent(),
        "Find something undiscovered",
      );
      assert.doesNotMatch(await surfaces(page), /lamp/iu);
      assert.equal(await offerCards(page).count(), 0);
      await t.shot("pond-shut");
      await putOutOpening(page);
      await t.ready();
      await page.waitForFunction(
        () => !document.querySelector("#hand [data-revealing]"),
      );
      assert.equal(await offerCards(page).count(), 0);
      assert.deepEqual((await t.state()).opened, { pond: ["vale"] });
      // The lamp out, the pond is open: go to Pip.
      await clearSelection(page);
      await selectCard(page, "pond");
      await page.locator("#card-actions .card-primary").click();
      await t.ready();
      assert.equal((await t.state()).actors.vale.place, "pond");
      assert.equal(await offerCards(page).count(), 0, "no offer before Pip is heard");
      await clearSelection(page);
      await selectCard(page, "moth");
      await page.locator('#card-actions [data-action="talk"]').click();
      await t.ready();
      // 2. Pip's offer card lies in the hand.
      const offer = offerCards(page);
      await offer.first().waitFor({ state: "attached" });
      assert.deepEqual(
        await offer.evaluateAll((els) => els.map((el) => el.dataset.card)),
        ["quest:from:moth"],
      );
      assert.equal(await page.locator("#hand .want-frame").count(), 0, "nothing is held yet");
      await clearSelection(page);
      const turn = (await t.state()).turn;
      // Face down, the offer is a closed box: it shows nothing of the quest.
      await closedOffer(page, t, "quest:from:moth", "closed");
      await t.ready();
      assert.equal(await t.oneButton(), 1);
      assert.equal(await label(page), "Accept quest");
      await t.shot("opened");
      assert.equal(await page.locator("#card-actions button").first().isDisabled(), false);
      await t.layout();
      await t.shot("offer");
      // 3. Pressing it takes the quest and passes no turn.
      await motion(page, "no-preference");
      await watchQuest(page);
      await page.locator("#card-actions button").first().click();
      await page.waitForFunction(
        () => !document.querySelector('#hand [data-card="quest:from:moth"]'),
      );
      await page.waitForFunction(() => window.questWatch.length >= 45);
      const flight = await page.evaluate(() => window.questWatch);
      for (const [i, frame] of flight.entries())
        assert.deepEqual(
          [frame.look, frame.top, frame.copies],
          [[1, "true", "false"], true, 0],
          `frame ${i}: one quest card, chosen, face up, over the stacks`,
        );
      if (width === 1440)
        assert(new Set(flight.map((f) => f.left)).size > 4, "it travels to Vale's stack");
      assert.equal(await page.locator("#hand .want-frame:not([hidden]) > .want-card").count(), 1);
      assert.equal(await page.evaluate(() => document.activeElement.dataset.questId), "quest:0");
      assert.equal(await t.oneButton(), 1);
      assert.equal(await label(page), "Discard");
      await motion(page, "reduce");
      const taken = await t.state();
      assert.equal(taken.turn, turn, "taking a quest passes no turn");
      assert.deepEqual(
        { kind: taken.actors.vale.want.kind, target: taken.actors.vale.want.target },
        { kind: "item", target: "lamp" },
      );
      assert.equal(await offerCards(page).count(), 0);
      // A taken offer stays seen: it never lies face down again.
      assert.ok(
        await page.evaluate(
          (name) =>
            JSON.parse(localStorage.getItem(name) || "[]").includes(
              "quest:from:moth",
            ),
          `${t.key}.seen`,
        ),
        "the taken offer is still remembered as seen",
      );
      assert.equal(await page.locator("#hand .want-frame").count(), 1, "the held quest card");
      await t.oneButton();
      // Held, it lies behind Vale; her stack opens it, with its one button.
      await clearSelection(page);
      await selectCard(page, "vale");
      const fold = page.locator("#hand .quest-fold");
      if (await fold.isVisible()) await fold.click();
      else await tapCard(page.locator('#hand [data-quest-id="quest:0"].want-card'));
      await page.locator("#hand .want-frame:not([hidden]) > .want-card").waitFor();
      assert.equal(await t.oneButton(), 1);
      // A held quest's one button is always Discard.
      assert.equal(await label(page), "Discard");
      await t.shot("held-step");
      assert.deepEqual(t.errors, []);
      await page.close();
    }

    // 2b. A quest for a card not yet discovered shows the card back and names
    // nothing; it names the card once it is discovered.
    {
      const t = await open(
        "quest-offers-covered",
        decodeSave(encodeSave(journey.told)),
        ["lamp"],
      );
      const { page } = t;
      await page.goto(`${origin}/?table=quest-offers-covered-${width}`);
      await page.locator('[data-card="vale"]').waitFor({ state: "attached" });
      await t.ready();
      await selectCard(page, "quest:from:moth");
      await t.ready();
      assert.equal(await t.oneButton(), 1);
      const hidden = await surfaces(page);
      assert.match(hidden, /something undiscovered/u);
      assert.doesNotMatch(hidden, /lamp/iu);
      // Its face is the card back, not the Lamp's art.
      const face = page.locator('#hand [data-card="quest:from:moth"] .quest-screen');
      assert.equal(await face.locator(".quest-back").count(), 1);
      assert.equal(await face.locator(".quest-thing").count(), 0);
      await t.shot("offer-undiscovered");
      // Discovered, the same quest names the Lamp and shows it.
      await clearSelection(page);
      await revealCard(page, "lamp");
      await clearSelection(page);
      await selectCard(page, "quest:from:moth");
      await t.ready();
      assert.match(await surfaces(page), /Lamp/u);
      assert.equal(
        await page.locator('#hand [data-card="quest:from:moth"] .quest-thing').count(),
        1,
      );
      assert.deepEqual(t.errors, []);
      await page.close();
    }

    // 4. Meeting the want pays XP and needs no Claim.
    {
      const t = await open("quest-offers-met", decodeSave(encodeSave(journey.accepted)));
      const { page } = t;
      await page.goto(`${origin}/?table=quest-offers-met-${width}`);
      await page.locator('[data-card="vale"]').waitFor({ state: "attached" });
      await t.ready();
      const xp = (await t.state()).actors.vale.xp;
      await clearSelection(page);
      await selectCard(page, "lamp");
      await selectCard(page, "moth");
      await page.locator('#card-actions [data-action="give"]').click();
      await t.ready();
      const met = await t.state();
      assert(met.actors.vale.xp > xp, "XP rose");
      assert.equal(met.actors.vale.want, null);
      assert.equal(await page.getByText(/claim/i).count(), 0);
      assert.deepEqual(t.errors, []);
      await page.close();
    }

    // 5. The level threshold deals the level-up card; take it, sleep at home.
    {
      const t = await open("quest-offers-level", decodeSave(encodeSave(journey.met)));
      const { page } = t;
      await page.goto(`${origin}/?table=quest-offers-level-${width}`);
      await page.locator('[data-card="vale"]').waitFor({ state: "attached" });
      await t.ready();
      const level = page.locator('#hand [data-card="quest:level"]');
      await level.waitFor({ state: "attached" });
      await selectCard(page, "quest:level");
      assert.equal(await t.oneButton(), 1);
      assert.equal(await label(page), "Accept quest");
      await t.layout();
      await t.shot("level-up");
      await page.locator("#card-actions button").first().click();
      await page.waitForFunction(
        () => !document.querySelector('#hand [data-card="quest:level"]'),
      );
      const saved = await t.state();
      assert.equal(saved.actors.vale.want.quest.level, 2);
      assert.deepEqual(t.errors, []);
      await page.close();
    }

    // 6. A held quest blocks every other offer; Discard returns them.
    {
      const world = decodeSave(encodeSave(journey.told));
      world.actors.vale.want = newWant("item", "cloth", world.turn);
      const t = await open("quest-offers-blocked", world);
      const { page } = t;
      await page.goto(`${origin}/?table=quest-offers-blocked-${width}`);
      await page.locator('[data-card="vale"]').waitFor({ state: "attached" });
      await t.ready();
      await selectCard(page, "quest:from:moth");
      assert.equal(await t.oneButton(), 1);
      const button = page.locator("#card-actions button").first();
      assert.equal(await button.isDisabled(), true);
      assert.equal((await button.textContent()).trim(), BLOCKED);
      assert.doesNotMatch(await button.textContent(), /asleep/iu);
      await t.layout();
      await t.shot("blocked");
      // Discard returns the offers.
      await clearSelection(page);
      await selectCard(page, "vale");
      const fold = page.locator("#hand .quest-fold");
      if (await fold.isVisible()) await fold.click();
      else await tapCard(page.locator('#hand [data-quest-id="quest:0"].want-card'));
      assert.equal(await t.oneButton(), 1);
      const drop = page.locator("#card-actions [data-drop-quest]");
      // A held quest with no step to take reads Discard.
      assert.equal(await label(page), "Discard");
      await t.shot("held");
      await drop.click();
      await motion(page, "no-preference");
      await page.locator("#card-actions [data-drop-quest]").click();
      const fading = page.locator(".card-exits .want-card");
      await fading.waitFor({ state: "attached" });
      assert.ok(await page.evaluate(() => document.activeElement.closest("#hand")), "focus stays in the hand");
      assert.equal(
        await fading.evaluate((el) => el.parentElement.getAnimations()[0].effect.getTiming().duration),
        DISSOLVE_MS,
      );
      await fading.waitFor({ state: "detached" });
      await motion(page, "reduce");
      await t.ready();
      assert.equal((await t.state()).actors.vale.want, null);
      assert.equal(await page.locator("#hand .want-frame").count(), 0, "the discarded quest is gone");
      await selectCard(page, "quest:from:moth");
      assert.equal(await t.oneButton(), 1);
      assert.equal(await label(page), "Accept quest");
      assert.deepEqual(t.errors, []);
      await page.close();
    }

    // 7. A shut box's quest is an offer too, beside the box's own button.
    {
      const world = structuredClone(greekErrands().decree);
      world.actors.vale.place = "greek-gate";
      world.crossings["pond-greek-harbor"].discovered = true;
      for (const id of ["lamp", "cloth"]) world.items[id].holder = "pond";
      const t = await open("quest-offers-gate", world);
      const { page } = t;
      await page.goto(`${origin}/?table=quest-offers-gate-${width}`);
      await page.locator('[data-card="vale"]').waitFor({ state: "attached" });
      await t.ready();
      assert.equal(await offerCards(page).count(), 1);
      await selectCard(page, "greek-battlefield");
      assert.equal(await t.oneButton(), 1);
      assert.equal(await page.locator("#card-actions button").first().textContent(), "Locked");
      await clearSelection(page);
      await selectCard(page, "quest:box:greek-battlefield");
      assert.equal(await t.oneButton(), 1);
      assert.equal(await label(page), "Accept quest");
      await t.layout();
      await t.shot("box-offer");
      await page.locator("#card-actions button").first().click();
      await page.waitForFunction(
        () => !document.querySelector('#hand [data-card="quest:box:greek-battlefield"]'),
      );
      assert.equal((await t.state()).actors.vale.want.target, "greek-creon-writ");
      assert.deepEqual(t.errors, []);
      await page.close();
    }
  }
} finally {
  await browser?.close();
  await new Promise((resolve) => server.close(resolve));
}
console.log("Quest offer cards passed.");
