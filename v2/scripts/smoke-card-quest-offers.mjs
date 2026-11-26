// A lock or quest that concerns a card the traveler has not discovered names
// nothing: no word, aria label, title, alt text or image of it, in the bar,
// the button or the quest card; it shows the face-down back, and names the
// card once it is discovered.
//   node v2/scripts/smoke-card-quest-offers.mjs [screenshot-dir]
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { chromium } from "playwright";
import { createServer } from "../card-game/serve.mjs";
import { createWorld, decodeSave, encodeSave, legalActions, play } from "../card-game/world.mjs";
import { questing } from "../../test/helpers/first-quest.mjs";
import { holdQuest, newWant } from "../card-game/want.mjs";
import { recordOf } from "../card-game/world/arcana-record.mjs";
import { dealSpread, deck } from "../card-game/world/arcana.mjs";
import { levelCards } from "../card-game/quest-card.mjs";
import { cardLevel } from "../card-game/rarity.mjs";
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
const told = decodeSave(encodeSave(journey.told));
const accepted = play(told, legalActions(told).find((a) => a.kind === "accept" && a.target === "moth")).state;
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
    const open = async (name, world, covered = [], motion = "reduce") => {
      const page = await browser.newPage({
        viewport: { width, height },
        reducedMotion: motion,
      });
      page.setDefaultTimeout(20000);
      const key = `cosyworld.reflected-shore.v1.${name}-${width}`;
      const errors = [];
      page.on("pageerror", (error) => errors.push(error.message));
      page.on("console", (message) => {
        if (message.text().startsWith("CSP blocked")) errors.push(message.text());
      });
      await page.addInitScript(() =>
        document.addEventListener(
          "securitypolicyviolation",
          (event) =>
            console.error(
              `CSP blocked ${event.violatedDirective} on ${event.target.className || event.sourceFile}`,
            ),
          true,
        ),
      );
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
    // Check words, aria labels, titles, alt text and images across the bar,
    // button and quest cards. Undiscovered targets must appear in none of them.
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
    // The row from Pip's card to its quest card, and which of them show.
    const pipGroup = (page) =>
      page.evaluate(() => {
        const row = [...document.querySelectorAll("#hand > .card-frame")],
          from = row.findIndex((frame) => frame.querySelector('[data-card="moth"]')),
          to = row.findIndex((frame) => frame.dataset.questId === "offer:moth");
        return row
          .slice(from, to + 1)
          .map((frame) => `${frame.querySelector(".card").dataset.card ?? frame.dataset.questId}${frame.hidden ? "" : " shown"}`);
      });
    const held = '#hand .want-frame:not([data-quest-id^="offer:"])';
    const openHeld = async (page, t) => {
      await clearSelection(page);
      await selectCard(page, "vale");
      const fold = page.locator("#hand .quest-fold:not([data-owner])");
      if (await fold.isVisible()) await fold.click();
      else await tapCard(page.locator(`${held} > .want-card`).first());
      await page.locator(`${held}:not([hidden]) > .want-card`).waitFor();
      await t.ready();
    };

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
      assert.equal(
        await page.locator(".action-beat-text").textContent(),
        "Find something",
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
      const offer = page.locator('#hand .want-frame[data-quest-id="offer:moth"] > .want-card');
      const fold = page.locator('#hand .quest-fold[data-owner="moth"]');
      const openOffer = async (tap) => {
        await tapCard(tap);
        await page.locator(".action-beat-heading:not([hidden])").waitFor();
        assert.equal(await offer.getAttribute("aria-pressed"), "true");
        assert.equal(await page.locator(".action-beat-text").textContent(), "Pip asks for the Lamp");
        assert.equal(await t.oneButton(), 0, "a resident's card has no Accept");
        assert.equal((await t.state()).actors.vale.want, null);
      };
      await selectCard(page, "moth");
      await clearSelection(page);
      assert.equal(await fold.getAttribute("data-face"), "down", "Pip's quest lies face down behind Pip");
      assert.deepEqual(await pipGroup(page), ["moth shown", "offer:moth"], "it is stacked behind Pip");
      await tapCard(fold);
      assert.equal(await page.locator('#hand [data-card="moth"]').getAttribute("aria-pressed"), "true");
      assert.deepEqual(await pipGroup(page), ["moth shown", "offer:moth shown"], "it fans out as a full card");
      assert.equal(await fold.isVisible(), false);
      assert.equal(await offer.getAttribute("data-unrevealed"), "true", "face down");
      await page.locator('#card-actions [data-action="talk"]').click();
      await page.waitForFunction(
        () =>
          document.querySelector('#hand .want-frame[data-quest-id="offer:moth"] > .want-card')?.dataset
            .unrevealed === "false",
      );
      assert.equal(await page.locator("#speech-row").isVisible(), true, "it turns while Pip speaks");
      assert.equal(await fold.getAttribute("data-face"), "up");
      assert.doesNotMatch(
        await fold.evaluate((el) => getComputedStyle(el).getPropertyValue("--card-back")),
        /locked/u,
        "its face shows, not the locked back",
      );
      assert.equal(await offer.getAttribute("aria-pressed"), "false", "a Talk opens no offer by itself");
      await t.ready();
      await openOffer(offer);
      await t.shot("offer-after-talk");
      await clearSelection(page);
      await t.ready();
      await openOffer(fold);
      await clearSelection(page);
      await selectCard(page, "lamp");
      await selectCard(page, "moth");
      await page.locator('#card-actions [data-action="give"]').click();
      await t.ready();
      const met = await t.state();
      assert.equal(met.items.lamp.holder, "moth");
      assert.equal(met.actors.vale.want, null);
      assert.equal(met.log.filter((e) => e.verb === "want_met" && e.actorId === "vale" && e.ownerId === "moth").length, 1);
      assert.equal(await offer.count(), 0, "a met card leaves its owner");
      await t.layout();
      await t.shot("card-met");
      assert.deepEqual(t.errors, []);
      await page.close();
    }

    {
      const world = questing(createWorld());
      for (const id of ["vale", "moth", "keeper"]) world.actors[id].place = "station";
      world.items.lamp.holder = "vale";
      world.actors.vale.want = null;
      const t = await open("quest-offers-group", world);
      const { page } = t;
      await page.goto(`${origin}/?table=quest-offers-group-${width}`);
      await t.ready();
      assert.deepEqual(await pipGroup(page), ["moth shown", "cloth", "offer:moth"], "it is stacked with Pip's things");
      await selectCard(page, "moth");
      assert.deepEqual(await pipGroup(page), ["moth shown", "cloth shown", "offer:moth shown"], "and fans after them");
      await page.locator('#card-actions [data-action="talk"]').click();
      await page.waitForFunction(
        () => document.querySelector('#hand [data-quest-id="offer:moth"] > .want-card')?.dataset.unrevealed === "false",
      );
      assert.deepEqual(await pipGroup(page), ["moth shown", "cloth shown", "offer:moth shown"]);
      await t.shot("group-face-up");
      assert.deepEqual(t.errors, []);
      await page.close();
    }

    // Undiscovered quest targets show the card back; discovery reveals their names.
    {
      const t = await open(
        "quest-offers-covered",
        decodeSave(encodeSave(accepted)),
        ["lamp"],
      );
      const { page } = t;
      await page.goto(`${origin}/?table=quest-offers-covered-${width}`);
      await page.locator('[data-card="vale"]').waitFor({ state: "attached" });
      await t.ready();
      assert.equal(await page.locator(held).count(), 0, "a taken copy is not shown beside its owner's card");
      const openPip = async () => {
        await clearSelection(page);
        await page.locator('#hand .quest-fold[data-owner="moth"]').dispatchEvent("click");
        await page.locator(".action-beat-heading:not([hidden])").waitFor();
        await t.ready();
      };
      await openPip();
      assert.equal(await t.oneButton(), 0);
      const hidden = await surfaces(page);
      assert.match(hidden, /\bsomething\b/u);
      assert.doesNotMatch(hidden, /lamp/iu);
      // Its face is the card back, not the Lamp's art.
      const face = page.locator('#hand [data-quest-id="offer:moth"] .quest-screen');
      assert.equal(await face.locator(".quest-back").count(), 1);
      assert.equal(await face.locator(".quest-thing").count(), 0);
      await t.shot("held-undiscovered");
      // Discovered, the same quest names the Lamp and shows it.
      await clearSelection(page);
      await revealCard(page, "lamp");
      await openPip();
      assert.match(await surfaces(page), /Lamp/u);
      assert.equal(await face.locator(".quest-thing").count(), 1);
      assert.deepEqual(t.errors, []);
      await page.close();
    }

    // 4. Meeting the want pays a traveler no XP and needs no Claim.
    {
      const t = await open("quest-offers-met", decodeSave(encodeSave(accepted)));
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
      await page.locator("#beat-captions .beat-caption")
        .filter({ hasText: "1 of 3 people helped" }).waitFor();
      assert.equal(await page.getByText("The Listener is here for a reading.", { exact: true }).count(), 0);
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
      const t = await open("quest-offers-level", called, [], "no-preference");
      const { page } = t;
      await page.goto(`${origin}/?table=quest-offers-level-${width}`);
      await page.locator('[data-card="vale"]').waitFor({ state: "attached" });
      await t.ready();
      assert.equal(await offerCards(page).count(), 0);
      const offer = page.locator('#hand [data-holder="listener"] > .want-card[data-face="offered"]');
      await offer.waitFor();
      assert.deepEqual(
        recordOf(await t.state(), "vale").spread,
        [],
        "the card stays in the Listener's inventory before it is taken",
      );
      await t.shot("tarot-offered");
      await page.reload();
      await t.ready();
      await offer.waitFor();
      await tapCard(offer);
      await offer.waitFor({ state: "detached" });
      const inspectAlbum = async (state, art, count = "0 / 22") => {
        await page.locator("#toolbar-menu-button").click();
        await page.getByRole("button", { name: "Character", exact: true }).click();
        const collection = page.getByRole("region", { name: "Tarot collection" });
        const tiles = collection.locator(".sheet-deck > .sheet-tarot");
        await tiles.first().waitFor();
        assert.equal(await tiles.count(), 22);
        assert.equal(await tiles.first().getAttribute("data-tarot-state"), state);
        assert.match(await tiles.first().locator("img").getAttribute("src"), art);
        assert.equal(await collection.locator('[data-tarot-state="unknown"]').count(), 21);
        assert.equal(await collection.locator('[data-tarot-state="unknown"]').first().textContent(), "?");
        assert.equal(await collection.locator(".sheet-count").textContent(), count);
        assert.equal(await collection.getByRole("button").count(), state === "reward" ? 1 : 0);
        if (state !== "reward") assert.equal(await tiles.first().getAttribute("data-tarot"), null);
        await page.keyboard.press("Escape");
        await page.waitForFunction(() => !document.querySelector("#history-dialog").open && !document.querySelector("#messages img"));
      };
      const heading = async () =>
        (await page.locator(".action-beat-heading:not([hidden])").textContent()).trim();
      const tarot = page.locator('#hand .want-frame[data-quest-id^="tarot:"] > .want-card');
      const back = tarot.locator(".card-back");
      const showTarot = async () => {
        await clearSelection(page);
        await selectCard(page, "vale");
        const fold = page.locator("#hand .quest-fold:not([data-owner])");
        if (await fold.isVisible()) await fold.click();
        await tarot.waitFor();
      };
      await tarot.waitFor();
      assert.equal(await tarot.locator("..").getAttribute("data-holder"), "vale");
      assert.equal(await tarot.getAttribute("aria-pressed"), "true");
      await t.ready();
      await readyActionButton(page, "accept").waitFor();
      assert.equal(await t.oneButton(), 1, "the face-down card has one Turn over button");
      assert.equal(await heading(), "The Listener dealt you a card");
      assert.equal(await page.locator("[data-drop-quest]").count(), 0);
      assert.equal(await tarot.getAttribute("aria-label"), "Turn over the face-down card");
      assert.match(await back.getAttribute("src"), /tarot-back-locked\.webp/u);
      assert.notEqual(await back.evaluate((el) => getComputedStyle(el).display), "none");
      assert.doesNotMatch(await surfaces(page), /arcanum-0|The Fool/iu);
      await t.layout();
      await t.shot("level-up");
      await inspectAlbum("locked", /tarot-back-locked\.webp/u);
      await page.reload();
      await t.ready();
      await showTarot();
      if ((await tarot.getAttribute("aria-pressed")) !== "true") await tapCard(tarot);
      const beforeTurn = await t.state();
      const turn = readyActionButton(page, "accept");
      assert.equal(await turn.getAttribute("data-tap-hint"), "Tap to turn over");
      await Promise.all([
        page.waitForFunction(() =>
          /tarot-back-locked/u.test(document.querySelector("#hand .want-card > .reveal-lid")?.src ?? ""),
        ),
        turn.click(),
      ]);
      await t.ready();
      assert.equal((await t.state()).turn, beforeTurn.turn, "Turn over passes no world turn");
      assert.deepEqual(
        recordOf(await t.state(), "vale").spread.map((slot) => [slot.card, slot.face]),
        [["arcanum-0", "reward"]],
      );
      assert.match(await back.getAttribute("src"), /tarot-back\.webp/u);
      await page.waitForFunction(() => !document.querySelector("#hand [data-revealing]"));
      assert.equal(await tarot.getAttribute("data-unrevealed"), "false");
      assert.match(await tarot.locator(".art img").getAttribute("src"), /arcanum-0/u);
      assert.equal(await heading(), "Collect The Fool");
      assert.equal(await tarot.locator(".quest-verb").textContent(), "Collect");
      assert.equal(await tarot.locator(".quest-level").textContent(), "");
      assert.equal(await tarot.getAttribute("aria-label"), "Collect The Fool");
      assert.equal(await page.locator("[data-drop-quest]").count(), 0);
      assert.equal(await back.evaluate((el) => getComputedStyle(el).display), "none");
      await t.shot("tarot-reward");
      await inspectAlbum("reward", /arcanum-0/u);
      await page.reload();
      await t.ready();
      await showTarot();
      if ((await tarot.getAttribute("aria-pressed")) !== "true") await tapCard(tarot);
      await t.ready();
      assert.equal(await heading(), "Collect The Fool", "the saved reward still waits for Collect");
      assert.equal(await page.locator("[data-drop-quest]").count(), 0);
      const collect = readyActionButton(page, "accept");
      await page.waitForFunction(() => document.querySelector('#card-actions [data-action="accept"]')?.dataset.tapHint === "Tap to collect");
      const beforeCollect = await t.state();
      await collect.click();
      await page.waitForFunction(() => !document.querySelector('#hand [data-quest-id="tarot:vale:arcanum-0"]'));
      const collected = await t.state();
      assert.equal(collected.turn, beforeCollect.turn, "Collect passes no world turn");
      assert.equal(recordOf(collected, "vale").spread.length, 0);
      assert.equal(recordOf(collected, "vale").level, 1, "the first Collect reaches level 1");
      assert.deepEqual(recordOf(collected, "vale").proved, [], "acquisition does not prove the Fool's canonical deed");
      assert.ok(collected.actors.vale.upgrades.includes("arcanum-0"));
      await t.shot("tarot-collected");
      await page.locator("#toolbar-menu-button").click();
      await page.getByRole("button", { name: "Character", exact: true }).click();
      const sheet = page.getByRole("dialog", { name: "Character", exact: true });
      const collection = sheet.getByRole("region", { name: "Tarot collection" });
      const owned = collection.getByRole("button", { name: "View The Fool", exact: true });
      await owned.waitFor();
      assert.equal(await collection.getByRole("button").count(), 1);
      const tiles = collection.locator(".sheet-deck > .sheet-tarot");
      const unknown = collection.locator('[data-tarot-state="unknown"]');
      assert.equal(await tiles.count(), 22);
      assert.equal(await unknown.count(), 21);
      assert.equal(await collection.locator('[data-tarot-state="locked"]').count(), 0);
      assert.equal(await tiles.first().getAttribute("data-tarot"), "arcanum-0");
      assert.equal(await tiles.first().getAttribute("data-tarot-state"), "collected");
      assert.equal(await unknown.first().getAttribute("aria-hidden"), "true");
      assert.equal(await unknown.first().getAttribute("data-tarot"), null);
      assert.equal(await unknown.first().evaluate((el) => el.tagName), "DIV");
      assert.equal(await unknown.first().evaluate((el) => el.tabIndex), -1);
      assert.equal(await collection.locator(".sheet-count").textContent(), "1 / 22");
      const cardBox = await owned.boundingBox();
      assert(cardBox.width >= 40 && cardBox.width <= 64, "compact tarot tile");
      assert(cardBox.height < 100, "compact tarot tile height");
      assert.match(await sheet.locator(".sheet-level").textContent(), /Level I · Common/u);
      assert.doesNotMatch(await collection.innerText(), /Carry nothing|Discard|Level Up|Yours to keep|later quest spreads/u);
      assert.equal(await sheet.evaluate((el) => el.scrollWidth <= el.clientWidth + 1), true);
      await t.shot("character-sheet-fool");
      const beforeView = await t.state();
      await owned.click();
      await page.getByRole("dialog", { name: "The Fool", exact: true }).waitFor();
      assert.match(await page.locator("#item-view-image").getAttribute("src"), /arcanum-0/u);
      await page.keyboard.press("Escape");
      assert.equal(await owned.evaluate((el) => document.activeElement === el), true);
      await page.keyboard.press("Escape");
      await page.waitForFunction(() => !document.querySelector("#history-dialog").open && !document.querySelector("#messages img"));
      const afterView = await t.state();
      assert.equal(afterView.turn, beforeView.turn);
      assert.equal(afterView.revision, beforeView.revision);
      await page.reload();
      await t.ready();
      await page.locator("#toolbar-menu-button").click();
      await page.getByRole("button", { name: "Character", exact: true }).click();
      await owned.waitFor();
      assert.equal(await tiles.count(), 22);
      assert.equal(await unknown.count(), 21);
      assert.equal(await tiles.first().getAttribute("data-tarot-state"), "collected");
      await page.keyboard.press("Escape");
      assert.deepEqual(t.errors, []);
      await page.close();

      const later = decodeSave(encodeSave(collected));
      const known = deck.cards.filter((card) => ![0, 21].includes(card.number)).map((card) => card.id).sort().slice(0, 4);
      later.actors.vale.upgrades = [...new Set([...later.actors.vale.upgrades, ...known])].sort();
      assert.equal(dealSpread(later, "vale"), true);
      const spread = levelCards(later, "vale");
      assert.equal(spread.length, 3);
      assert.equal(spread.filter((card) => card.bonus).length, 1);
      const next = await open("quest-offers-known", later);
      await next.page.goto(`${origin}/?table=quest-offers-known-${width}`);
      await next.ready();
      await selectCard(next.page, "vale");
      for (const quest of spread.filter((card) => card.face === "up")) {
        const card = next.page.locator(`#hand [data-quest-id="${quest.key}"] > .want-card`);
        await tapCard(card);
        await next.ready();
        assert.equal(await card.locator(".quest-verb").textContent(), quest.bonus ? "Bonus quest" : "Level Up");
        assert.equal((await card.locator(".quest-level").textContent()).length > 0, !quest.bonus);
        assert.equal(await next.page.locator("[data-drop-quest]").count(), 1);
        assert.equal(await next.page.locator('#card-actions [data-action="accept"]').count(), 0);
        const words = await next.page.locator(".action-beat-heading:not([hidden])").textContent();
        assert.doesNotMatch(words, /Collect|Help (?:three|two|one).*complete their goal/u);
        await next.shot(quest.bonus ? "tarot-bonus-quest" : "tarot-required-quest");
      }
      assert.deepEqual(next.errors, []);
      await next.page.close();
    }

    {
      const world = decodeSave(encodeSave(accepted));
      holdQuest(world, "vale", newWant("item", "cloth", world.turn), "quest:box:test");
      holdQuest(world, "vale", newWant("item", "bell", world.turn), "quest:box:other");
      const t = await open("quest-offers-stack", world);
      const { page } = t;
      await page.goto(`${origin}/?table=quest-offers-stack-${width}`);
      await page.locator('[data-card="vale"]').waitFor({ state: "attached" });
      await t.ready();
      assert.equal(await offerCards(page).count(), 0);
      assert.equal(await page.locator(held).count(), 1, "only the top quest is shown");
      await openHeld(page, t);
      assert.equal(await t.oneButton(), 0, "a held quest has no Discard");
      assert.equal(
        await page.locator(`${held} > .place-edge`).count(),
        1,
        "the quest beneath lies as a stack edge",
      );
      await t.layout();
      await t.shot("stacked");
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
      assert.equal((await t.state()).actors.vale.want, null, "no box quest is held");
      const boxOffer = page.locator('#hand .want-frame[data-quest-id="offer:0"] > .want-card');
      const locked = async () => {
        await selectCard(page, "greek-battlefield");
        assert.equal(await t.oneButton(), 1);
        assert.equal(await page.locator("#card-actions button").first().textContent(), "Locked");
      };
      await locked();
      assert.equal(await boxOffer.count(), 0, "a shut box lays out no quest card");
      await t.layout();
      await t.shot("box-locked");
      assert.deepEqual(t.errors, []);
      await page.close();
    }

    {
      let world = structuredClone(greekErrands().decree);
      world.actors.vale.place = "greek-courtyard";
      world.items["greek-wine-skin"].holder = "greek-courtyard";
      world = play(world, legalActions(world).find((a) => a.kind === "wait" && !a.sleep && !a.guards)).state;
      const t = await open("quest-offers-place", world);
      const { page } = t;
      const gate = "greek-gate",
        card = page.locator(`#hand .want-frame[data-quest-id="offer:${gate}"] > .want-card`),
        fold = page.locator(`#hand .quest-fold[data-owner="${gate}"]`);
      const go = async (id, kind = null) => {
        await clearSelection(page);
        for (const one of [id].flat()) await selectCard(page, one);
        await page.locator(`#card-actions ${kind ? `[data-action="${kind}"]` : ".card-primary"}`).click();
        await t.ready();
      };
      await page.goto(`${origin}/?table=quest-offers-place-${width}`);
      await page.locator('[data-card="vale"]').waitFor({ state: "attached" });
      await t.ready();
      assert.equal(await fold.count(), 0, "a place's card shows only to one standing in it");
      await go(gate);
      assert.equal((await t.state()).actors.vale.place, gate);
      assert.equal(await fold.getAttribute("data-face"), "down", "it lies face down on arrival");
      assert.deepEqual(await page.evaluate((id) => [...document.querySelectorAll("#hand > .card-frame")]
        .filter((f) => !f.hidden && f.dataset.holder === id).map((f) => f.dataset.questId ?? f.querySelector(".card").dataset.card), gate),
        ["greek-shovel", "greek-battlefield", `offer:${gate}`], "it fans after the place's things");
      assert.equal(await card.getAttribute("data-unrevealed"), "true");
      assert.doesNotMatch(await surfaces(page), /wine skin/iu);
      await card.scrollIntoViewIfNeeded();
      await t.shot("place-card-down");
      await page.locator('#card-actions [data-action="wait"]').click();
      await t.ready();
      assert.equal(await fold.getAttribute("data-face"), "up", "a play there turns it");
      await tapCard(card);
      const words = "The Theban City Gate asks for the Wine Skin back, which lies at the Theban Courtyard";
      assert.equal(await page.locator(".action-beat-text").textContent(), words);
      assert.equal(await card.getAttribute("aria-label"), words);
      assert.equal(await t.oneButton(), 0);
      await t.shot("place-card-up");
      await go("greek-courtyard");
      await go("greek-wine-skin", "take");
      await go(gate);
      await go(["greek-wine-skin", gate], "drop");
      const met = await t.state();
      assert.deepEqual(met.placeMet, { [gate]: ["greek-wine-skin"] });
      assert.equal(cardLevel(met, gate), 2, "laying the thing back levels the place");
      assert.equal(met.log.filter((e) => e.verb === "want_met" && e.actorId === "vale" && e.ownerId === gate).length, 1);
      assert.equal(await fold.count() + (await card.count()), 0, "a met card leaves its place");
      assert.deepEqual(t.errors, []);
      await page.close();
    }
  }
} finally {
  await browser?.close();
  await new Promise((resolve) => server.close(resolve));
}
console.log("Held quests and stacks passed.");
