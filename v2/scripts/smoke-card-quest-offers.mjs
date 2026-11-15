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
import { decodeSave, encodeSave, legalActions, play } from "../card-game/world.mjs";
import { newWant } from "../card-game/want.mjs";
import { recordOf } from "../card-game/world/arcana-record.mjs";
import { DISSOLVE_MS } from "../card-game/card-travel.mjs";
import { greekErrands } from "../../test/helpers/greek-opening.mjs";
import { journeyWorlds } from "../../test/helpers/journey.mjs";
import { questCards } from "../../test/journeys/quest-cards.mjs";
import {
  clearSelection,
  openPack,
  putOutOpening,
  readyActionButton,
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
      // A settled quest action has one button above the hand.
      const oneButton = async () => {
        const buttons = await page.locator("#card-actions button").count();
        assert(buttons <= 1, `the action row has ${buttons} buttons`);
        return buttons;
      };
      const layout = async () => {
        assert(await page.locator('#hand .want-frame:not([hidden]) > .want-card[data-quest-id]').isVisible(),
          "measure a visible held quest");
        const problems = await page.evaluate(() => {
          const bar = document.getElementById("action-beat").getBoundingClientRect();
          const out = [];
          for (const el of document.querySelectorAll('#hand .want-card[data-quest-id]')) {
            const frame = el.parentElement;
            if (frame.hidden) continue;
            const box = el.getBoundingClientRect();
            if (box.width < 40 || box.height < 40) out.push(`${el.dataset.questId} is tiny`);
            if (box.right < 0 || box.left > innerWidth + 1) continue;
            if (box.top < 0 || box.bottom > innerHeight + 2)
              out.push(`${el.dataset.questId} leaves the page`);
            if (box.top < bar.bottom && box.bottom > bar.top && box.top > bar.top)
              out.push(`${el.dataset.questId} lies under the action bar`);
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
    const label = async (page) =>
      (await page.locator("#card-actions button").first().getAttribute("data-tap-verb")) ||
      (await page.locator("#card-actions button").first().textContent());

    const accept = async (page, t, source, review = false) => {
      await clearSelection(page);
      await selectCard(page, source);
      if (review) await page.locator("[data-review-quests]").click();
      const before = await t.state();
      await page.locator('[data-accept-quest]:not([data-revealing="true"])').click();
      await page.waitForFunction(({ key, revision }) =>
        JSON.parse(localStorage.getItem(key)).revision > revision,
      { key: t.key, revision: before.revision });
      await t.ready();
      assert.equal((await t.state()).turn, before.turn, "Accept advances no time");
    };
    const openHeld = async (page, t) => {
      await clearSelection(page);
      await selectCard(page, "vale");
      const fold = page.locator("#hand .quest-fold");
      if (await fold.isVisible()) await fold.click();
      else await tapCard(page.locator("#hand .want-frame > .want-card").first());
      await page.locator("#hand .want-frame:not([hidden]) > .want-card").waitFor();
      await t.ready();
    };

    {
      const t = await open("quest-offers-fresh");
      const { page } = t;
      await page.goto(`${origin}/?table=quest-offers-fresh-${width}`);
      await page.locator('[data-card="lamp"]').waitFor({ state: "attached" });
      await t.ready();
      assert.equal(await offerCards(page).count(), 0);
      assert.deepEqual(recordOf(await t.state(), "vale").spread, [], "a fresh avatar starts without a tarot");
      // Accept the ordinary opening quest before inspecting its locked source.
      await selectCard(page, "pond");
      assert.equal((await t.state()).actors.vale.want, null);
      assert.equal(await page.locator("#card-actions button").count(), 2);
      assert(await page.locator("[data-accept-quest]").isEnabled());
      assert(await page.locator('[data-unlock-box="pond"]').isDisabled());
      assert.doesNotMatch(await surfaces(page), /lamp/iu);
      await accept(page, t, "pond");
      assert.equal((await t.state()).actors.vale.want.from, "quest:box:pond");
      assert.equal((await t.state()).actors.vale.want.accepted, true);
      await clearSelection(page);
      await selectCard(page, "pond");
      assert.equal(await t.oneButton(), 1);
      const shut = page.locator("#card-actions button").first();
      assert.equal(await shut.isDisabled(), true);
      assert.equal(await shut.textContent(), "Unlock");
      assert.equal(
        await page.locator(".action-beat-text").textContent(),
        "Lay something you haven't found somewhere you haven't discovered",
      );
      assert.doesNotMatch(await surfaces(page), /lamp/iu);
      assert.equal(await offerCards(page).count(), 0);
      await t.shot("pond-shut");
      await openHeld(page, t);
      await page.waitForFunction(() => {
        const quest = document.querySelector('#hand .want-frame:not([hidden]) > .want-card');
        return quest?.dataset.unrevealed === "false" && !quest.dataset.revealing;
      });
      assert.doesNotMatch(await surfaces(page), /lamp/iu);
      await putOutOpening(page, { unlock: false });
      await t.ready();
      await page.waitForFunction(
        () => !document.querySelector("#hand [data-revealing]"),
      );
      assert.equal(await offerCards(page).count(), 0);
      assert.deepEqual((await t.state()).opened, { pond: ["vale"] });
      assert.equal((await t.state()).actors.vale.want, null, "Put down completes the accepted opening quest");
      // Unlock the eligible pond, then go to Pip.
      await clearSelection(page);
      await selectCard(page, "pond");
      await page.locator('[data-unlock-box="pond"]:not([data-revealing="true"])').click();
      await page.waitForFunction(() =>
        !document.querySelector('#hand [data-card="pond"]').dataset.revealing);
      await revealCard(page, "pond", { keepSelected: true });
      await readyActionButton(page, "move").click();
      await page.waitForFunction((key) =>
        JSON.parse(localStorage.getItem(key)).actors.vale.place === "pond", t.key);
      await t.ready();
      assert.equal((await t.state()).actors.vale.place, "pond");
      assert.equal(await offerCards(page).count(), 0, "no offer before Pip is heard");
      await clearSelection(page);
      await selectCard(page, "moth");
      await page.locator('#card-actions [data-action="talk"]').click();
      await t.ready();
      assert.equal((await t.state()).actors.vale.want, null, "hearing Pip leaves the quest unheld");
      await accept(page, t, "moth");
      const held = await t.state();
      assert.deepEqual(
        { kind: held.actors.vale.want.kind, target: held.actors.vale.want.target, from: held.actors.vale.want.from },
        { kind: "item", target: "lamp", from: "quest:from:moth" },
      );
      assert.equal(await offerCards(page).count(), 0, "nothing lies to accept");
      assert.equal(await page.locator("#hand .want-frame").count(), 1, "the held quest card");
      assert.equal(await page.getByText(/accept quest/iu).count(), 0);
      await openHeld(page, t);
      assert.equal(await t.oneButton(), 1);
      assert.equal(await label(page), "Discard");
      await t.layout();
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
      await accept(page, t, "moth");
      await openHeld(page, t);
      assert.equal(await t.oneButton(), 1);
      const hidden = await surfaces(page);
      assert.match(hidden, /\bsomething\b/u);
      assert.doesNotMatch(hidden, /lamp/iu);
      // Its face is the card back, not the Lamp's art.
      const face = page.locator("#hand .want-frame .quest-screen");
      assert.equal(await face.locator(".quest-back").count(), 1);
      assert.equal(await face.locator(".quest-thing").count(), 0);
      await t.shot("held-undiscovered");
      // Discovered, the same quest names the Lamp and shows it.
      await clearSelection(page);
      await revealCard(page, "lamp");
      await openHeld(page, t);
      assert.match(await surfaces(page), /Lamp/u);
      assert.equal(
        await page.locator("#hand .want-frame .quest-thing").count(),
        1,
      );
      assert.deepEqual(t.errors, []);
      await page.close();
    }

    // 4. Meeting the want pays a traveler no XP and needs no Claim.
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
      assert.equal(met.actors.vale.xp, xp, "a traveler earns no XP");
      assert.notEqual(met.actors.vale.want?.from, "quest:from:moth");
      assert.equal(await page.getByText(/claim/i).count(), 0);
      assert.deepEqual(t.errors, []);
      await page.close();
    }

    {
      let called = decodeSave(encodeSave(journey.met));
      called.actors.vale.arcana = { proved: [], did: [], calls: 3 };
      called = play(
        called,
        legalActions(called).find((a) => a.kind === "wait" && !a.sleep && !a.guards),
      ).state;
      called = play(
        called,
        legalActions(called).find((a) => a.kind === "talk" && a.target === "listener"),
      ).state;
      const t = await open("quest-offers-level", called);
      const { page } = t;
      await page.goto(`${origin}/?table=quest-offers-level-${width}`);
      await page.locator('[data-card="vale"]').waitFor({ state: "attached" });
      await t.ready();
      assert.equal(await offerCards(page).count(), 0);
      const level = await t.state();
      assert.equal(level.actors.vale.want?.quest, undefined);
      assert.deepEqual(
        recordOf(level, "vale").spread.map((slot) => slot.face),
        ["down"],
        "the Fool is given face down",
      );
      await accept(page, t, "vale", true);
      assert.equal((await t.state()).actors.vale.arcana.spread[0].accepted, true);
      await openHeld(page, t);
      assert.equal(await t.oneButton(), 1);
      assert.equal(await label(page), "Reveal");
      const beforeReveal = await t.state();
      await page.locator('[data-open-box^="tarot:vale:down:"]').click();
      await page.waitForFunction(() => !document.querySelector("#hand [data-revealing]"));
      assert.deepEqual(await t.state(), beforeReveal, "revealing the tarot changes no world state");
      assert.equal(await label(page), "Discard");
      assert.doesNotMatch(await surfaces(page), /The Fool/u);
      const back = page.locator("#hand .want-frame:not([hidden]) > .want-card > .card-back");
      assert.match(await back.getAttribute("src"), /tarot-back\.webp/u);
      assert.notEqual(
        await back.evaluate((el) => getComputedStyle(el).display),
        "none",
        "the face-down tarot shows the star back",
      );
      await t.layout();
      await t.shot("level-up");
      assert.deepEqual(t.errors, []);
      await page.close();
    }

    {
      const world = decodeSave(encodeSave(journey.told));
      world.actors.vale.pendingQuests.push({ ...newWant("item", "cloth", world.turn), from: "quest:box:test" });
      const t = await open("quest-offers-stack", world);
      const { page } = t;
      await page.goto(`${origin}/?table=quest-offers-stack-${width}`);
      await page.locator('[data-card="vale"]').waitFor({ state: "attached" });
      await t.ready();
      assert.equal(await offerCards(page).count(), 0);
      await accept(page, t, "moth");
      await accept(page, t, "vale", true);
      assert.equal((await t.state()).actors.vale.want.target, "cloth");
      assert.equal(await page.locator("#hand .want-frame").count(), 1, "only the top quest is shown");
      await openHeld(page, t);
      assert.equal(await t.oneButton(), 1);
      assert.equal(await label(page), "Discard");
      assert.equal(
        await page.locator("#hand .want-frame > .place-edge").count(),
        1,
        "the quest beneath lies as a stack edge",
      );
      await t.layout();
      await t.shot("stacked");
      await page.locator("#card-actions [data-drop-quest]").click();
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
      const next = await t.state();
      assert.equal(next.actors.vale.want.from, "quest:from:moth", "the next quest shows");
      assert.equal(next.actors.vale.under, undefined);
      assert.equal(next.actors.vale.closed["quest:box:test"][1].includes("cloth"), true);
      await openHeld(page, t);
      assert.equal(await page.locator("#hand .want-frame > .place-edge").count(), 0);
      assert.equal(await label(page), "Discard");
      assert.deepEqual(t.errors, []);
      await page.close();
    }

    {
      const world = structuredClone(greekErrands().decree);
      world.actors.vale.place = "greek-gate";
      world.crossings["pond-greek-harbor"].discovered = true;
      for (const id of ["lamp", "cloth"]) world.items[id].holder = "pond";
      const waited = play(
        world,
        legalActions(world).find((a) => a.kind === "wait" && !a.sleep && !a.guards),
      ).state;
      const t = await open("quest-offers-gate", waited);
      const { page } = t;
      await page.goto(`${origin}/?table=quest-offers-gate-${width}`);
      await page.locator('[data-card="vale"]').waitFor({ state: "attached" });
      await t.ready();
      assert.equal(await offerCards(page).count(), 0);
      await accept(page, t, "greek-battlefield");
      assert.equal((await t.state()).actors.vale.want.target, "greek-creon-writ");
      await clearSelection(page);
      await selectCard(page, "greek-battlefield");
      assert.equal(await t.oneButton(), 1);
      assert.equal(await page.locator("#card-actions button").first().textContent(), "Unlock");
      await openHeld(page, t);
      assert.equal(await label(page), "Discard");
      await t.layout();
      await t.shot("box-held");
      assert.deepEqual(t.errors, []);
      await page.close();
    }
  }
} finally {
  await browser?.close();
  await new Promise((resolve) => server.close(resolve));
}
console.log("Held quests and stacks passed.");
