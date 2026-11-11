import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { chromium } from "playwright";
import { createServer } from "../card-game/serve.mjs";
import { createWorld, encodeSave } from "../card-game/world.mjs";
import { availableCards } from "../card-game/cards.mjs";
import { questXp } from "../card-game/want.mjs";
import { revealOpening, tapCard } from "./card-browser-helpers.mjs";

// The player holds one quest. It folds behind the player's avatar as a face
// down card; opening the avatar's stack shows it as the one quest card. A
// chosen quest card gives exactly one button: its next step, or Discard when
// it has none. A quest the rules meet simply goes, and its experience is paid
// on the play that met it: there is nothing to claim.
const server = createServer();
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const browser = await chromium.launch({ headless: true });
const output = new URL("../../output/quest/", import.meta.url);
const gate = createWorld();
gate.actors.vale.place = "greek-gate";
gate.actors.vale.visited.push("pond");
gate.crossings["pond-greek-harbor"].discovered = true;
gate.items["greek-decree"].holder = "vale";
gate.items.lamp.holder = "attic";
gate.actors.vale.want = {
  kind: "item",
  target: "greek-decree",
  step: { verb: "give", to: "greek-guard" },
  since: 0,
  refusals: 0,
  story: true,
};
await mkdir(output, { recursive: true });
try {
  for (const [width, height, motion] of [
    [390, 844, "no-preference"],
    [1440, 900, "reduce"],
  ]) {
    const page = await browser.newPage({
      viewport: { width, height },
      reducedMotion: motion,
    });
    page.setDefaultTimeout(20000);
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.addInitScript(() => {
      localStorage.setItem("cosyworld.dialogue.sound", "off");
      localStorage.setItem(
        "cosyworld.room-music",
        JSON.stringify({ enabled: false }),
      );
    });
    await page.route("**/card-game/text", (route) =>
      route.fulfill({
        status: 400,
        contentType: "application/json",
        body: "{}",
      }),
    );
    const table = `quest-${width}`,
      key = `cosyworld.reflected-shore.v1.${table}`;
    const ready = async () => {
      for (let i = 0; i < 500; i++) {
        if ((await page.locator("#hand").getAttribute("data-cooling")) === "false")
          return;
        if (await page.locator("#dialogue-advance").isVisible())
          await page.locator("#dialogue-advance").click();
        await page.waitForTimeout(40);
      }
      throw new Error("Quest hand stayed busy");
    };
    const saved = (storageKey = key) =>
      page.evaluate((k) => {
        const s = JSON.parse(localStorage.getItem(k));
        return { turn: s.turn, xp: s.actors.vale.xp, want: s.actors.vale.want };
      }, storageKey);
    const head = () =>
      page
        .locator("#hand .want-frame:not([hidden]) .want-card .quest-head")
        .first()
        .evaluate((el) => {
          const verb = el.querySelector(".quest-verb");
          return {
            name: verb.textContent,
            lines: Math.round(
              verb.getBoundingClientRect().height /
                parseFloat(getComputedStyle(verb).lineHeight),
            ),
            color: getComputedStyle(el).color,
          };
        });
    await page.goto(
      `http://127.0.0.1:${server.address().port}/?table=${table}`,
    );
    await ready();
    // Uncover the opening cards, then give Vale the quest of holding the lamp
    // it already holds.
    await revealOpening(page);
    await page.evaluate((key) => {
      const s = JSON.parse(localStorage.getItem(key));
      const vale = s.actors.vale;
      vale.visited = [...new Set([...vale.visited, "pond"])];
      vale.want = { kind: "item", target: "lamp", since: s.turn, refusals: 0 };
      localStorage.setItem(key, JSON.stringify(s));
    }, key);
    await page.reload();
    await ready();
    const quest = page.locator("#hand .want-frame");
    assert.equal(await quest.count(), 1, "one quest card for one quest");
    assert.equal(await quest.isHidden(), true, "the quest folds behind Vale");
    // Vale already holds the lamp, so the folded quest wears the near halo.
    // It is a face-down card in Vale's stack, Vale's size, with no tab.
    const fold = page.locator('#hand .quest-fold[data-glow="near"]');
    assert.equal(await fold.count(), 1);
    assert.equal(await page.locator("#hand .quest-tab").count(), 0);
    const [foldBox, valeBox] = await page.evaluate(() =>
      [".quest-fold", '[data-card="vale"]'].map((s) => {
        const el = document.querySelector(`#hand ${s}`);
        return [el.offsetWidth, el.offsetHeight];
      }),
    );
    assert.deepEqual(foldBox, valeBox, "the folded quest is card sized");
    assert.match(
      await fold.evaluate((el) => getComputedStyle(el).backgroundImage),
      /card-back/,
    );
    assert.match(
      await fold.getAttribute("aria-label"),
      /^Quest: .+\. Open it\.$/u,
      "the fold names the one quest",
    );
    await page.screenshot({
      path: new URL(`folded-${width}.png`, output).pathname,
    });
    // Opening Vale's stack brings the quest forward; the fold hides. It
    // enters face down, the carved lid showing, then turns to its face. The
    // turn is quick, so a mutation observer watches for the lid.
    await page.evaluate(() => {
      const watch = new MutationObserver(() => {
        const back = document.querySelector(
          '#hand .want-frame:not([hidden]) .want-card[data-unrevealed="true"] .card-back',
        );
        if (back && getComputedStyle(back).display === "block") watch.seen = true;
      });
      watch.seen = false;
      watch.observe(document.getElementById("hand"), {
        subtree: true,
        childList: true,
        attributes: true,
      });
      window.questFaceDown = watch;
    });
    const sawFaceDown = () => page.evaluate(() => window.questFaceDown.seen);
    await page.locator('#hand [data-card="vale"]').click();
    await quest.waitFor();
    await page.locator('#hand .want-frame > .want-card[data-unrevealed="false"]').waitFor();
    assert.equal(await sawFaceDown(), true, "the quest is dealt face down");
    assert.equal(await page.locator("#hand .want-frame > .want-card").count(), 1);
    assert.deepEqual(
      await head(),
      { name: "Hold", lines: 1, color: "rgb(255, 240, 130)" },
      "the verb alone, in the Legendary lamp's tier",
    );
    assert.equal(await page.locator("#hand .quest-fold").isHidden(), true);
    assert.equal(
      await page.locator('#hand .want-frame > .want-card[data-near="true"]').isVisible(),
      true,
    );
    // Folding Vale's stack and opening it again never deals it face down
    // again.
    await page.evaluate(() => {
      window.questFaceDown.seen = false;
    });
    for (let i = 0; i < 2; i++) {
      await page.locator('#hand [data-card="vale"]').click();
      await quest.waitFor({ state: "hidden" });
      await page.locator('#hand [data-card="vale"]').click();
      await quest.waitFor();
      assert.equal(
        await page.locator("#hand .want-frame > .want-card").getAttribute("data-unrevealed"),
        "false",
      );
    }
    assert.equal(await sawFaceDown(), false, "it never turns back over");
    await page.screenshot({
      path: new URL(`expanded-${width}.png`, output).pathname,
    });
    // Choosing the quest card shows its details and one button. The lamp is
    // already held, so there is no step left: Discard is the one button.
    await page.locator("#hand .want-frame > .want-card").click({ position: { x: 40, y: 16 } });
    assert.equal(
      await page.locator("#hand .want-frame > .want-card").getAttribute("aria-pressed"),
      "true",
    );
    await page
      .locator('#card-actions button:not([data-revealing="true"])')
      .first()
      .waitFor();
    assert.equal(await page.locator("#card-actions button").count(), 1);
    // Tapping the chosen quest lowers it again; the avatar's stack stays.
    await page.locator("#hand .want-frame > .want-card").click({ position: { x: 40, y: 16 } });
    assert.equal(
      await page.locator("#hand .want-frame > .want-card").getAttribute("aria-pressed"),
      "false",
    );
    // Any play meets it. Its experience is paid on that play and the card
    // simply goes: there is no sealed card, no claim and no float.
    const before = await saved();
    await tapCard(page.locator('#hand [data-card="vale"]'));
    await page
      .locator(
        '#card-actions [data-action="wait"]:not([data-revealing="true"])',
      )
      .click();
    await ready();
    await page.waitForFunction(
      (k) => JSON.parse(localStorage.getItem(k)).actors.vale.want === null,
      key,
    );
    const after = await saved();
    assert.equal(after.xp, before.xp + 1, "the meeting play paid one XP");
    assert.equal(await page.locator("#hand .want-frame > .want-card").count(), 0);
    assert.equal(await page.locator("#hand .want-frame").count(), 0);
    assert.equal(await page.locator("#hand .quest-fold").count(), 0);
    assert.equal(await page.locator(".quest-seal, .quest-xp").count(), 0);
    assert.equal(
      await page.locator("#card-actions [data-claim]").count(),
      0,
      "no Claim button",
    );

    // Discard. A level quest names its cost on its one button, asks again,
    // and drops on the second tap with no turn passing.
    await page.evaluate(({ key, xp }) => {
      const s = JSON.parse(localStorage.getItem(key));
      const vale = s.actors.vale;
      vale.want = {
        kind: "place",
        target: "station",
        since: s.turn,
        refusals: 0,
        // A level quest: its Discard names the cost (rules 98).
        quest: { level: 2, left: 1 },
      };
      Object.assign(vale, { xp, level: 1 });
      localStorage.setItem(key, JSON.stringify(s));
    }, { key, xp: questXp(2) });
    await page.reload();
    await ready();
    await page.locator("#hand .quest-fold").focus();
    await page.keyboard.press("Enter");
    await page.locator("#hand .want-frame:not([hidden])").waitFor();
    assert.equal(await page.locator("#hand .want-frame > .want-card").count(), 1);
    // The fold's tap also chooses the quest and shows its details.
    assert.equal(
      await page.locator("#hand .want-frame > .want-card").getAttribute("aria-pressed"),
      "true",
    );
    const drop = page.locator('#card-actions [data-drop-quest="0"]');
    await page
      .locator('#card-actions [data-drop-quest="0"]:not([data-revealing="true"])')
      .waitFor();
    assert.equal(await page.locator("#card-actions button").count(), 1);
    assert.equal(await drop.getAttribute("aria-label"), "Discard (−1 XP)");
    // Discard is the beat's usual context button, its words red.
    assert.deepEqual(
      await drop.evaluate((el) => {
        const style = getComputedStyle(el);
        return [style.color, style.textShadow, style.borderTopWidth];
      }),
      ["rgb(255, 143, 132)", "none", "0px"],
    );
    const { turn } = await saved();
    const readyDrop = page.locator(
      '#card-actions [data-drop-quest]:not([data-revealing="true"])',
    );
    await readyDrop.click();
    assert.equal((await saved()).turn, turn);
    const panel = page.locator("#action-beat");
    assert.equal(
      await panel.evaluate((el) => getComputedStyle(el).borderTopColor),
      "rgb(255, 143, 132)",
    );
    assert.match(
      await panel.locator(".action-beat-note").innerText(),
      /Cost 1 XP/,
    );
    assert.equal(await panel.locator("button").count(), 1);
    // Escape asks no more; nothing was dropped.
    await page.keyboard.press("Escape");
    assert.equal((await saved()).want.target, "station");
    assert.equal((await saved()).turn, turn);
    await readyDrop.click();
    const confirm = panel.locator("button");
    // The first tap on words still being typed finishes them.
    if ((await confirm.getAttribute("data-revealing")) === "true")
      await confirm.click();
    await confirm.click();
    await ready();
    assert.deepEqual(
      await saved(),
      { turn: (await saved()).turn, xp: questXp(2) - 1, want: null },
      "the quest dropped and paid its cost",
    );
    assert.equal(await page.locator("#hand .want-frame > .want-card").count(), 0);

    // A step quest: at the Theban City Gate, the chosen quest card offers one
    // button, Give, and giving the Decree meets it and pays one XP.
    const gateKey = `cosyworld.reflected-shore.v1.quest-give-${width}`;
    await page.evaluate(
      ({ gateKey, save, seen }) => {
        localStorage.setItem(gateKey, save);
        localStorage.setItem(`${gateKey}.seen`, JSON.stringify(seen));
      },
      { gateKey, save: encodeSave(gate), seen: availableCards(gate) },
    );
    await page.goto(
      `http://127.0.0.1:${server.address().port}/?table=quest-give-${width}`,
    );
    await ready();
    await page.locator("#hand .quest-fold").focus();
    await page.keyboard.press("Enter");
    await page.locator('#hand .want-frame > .want-card[data-unrevealed="false"]').waitFor();
    assert.deepEqual(await head(), {
      name: "Give",
      lines: 1,
      color: "rgb(255, 240, 130)",
    });
    assert.equal(
      await page.locator("#hand .want-frame > .want-card").getAttribute("aria-label"),
      "Quest: Give The Burial Decree to The Gate Guard, near",
    );
    // The fold's tap names the quest and offers its Give action: one button.
    await page
      .locator('#card-actions [data-quest-step]:not([data-revealing="true"])')
      .waitFor();
    assert.equal(
      (
        await page.locator(".action-beat-heading:not([hidden])").textContent()
      ).trim(),
      "Give The Burial Decree to The Gate Guard",
    );
    assert.deepEqual(
      await page
        .locator("#card-actions button")
        .evaluateAll((buttons) =>
          buttons.map((b) => [b.textContent, b.disabled]),
        ),
      [["Tap to give", false]],
    );
    assert.equal(
      await page
        .locator('#hand .want-frame > .want-card .quest-screen[data-parts="3"] > img')
        .evaluateAll((imgs) =>
          imgs
            .filter((img) => !img.matches(".quest-ground"))
            .map((img) => img.className)
            .join(" | "),
        ),
      "quest-figure quest-left | quest-thing | quest-figure quest-right quest-to",
    );
    await page.screenshot({
      path: new URL(`give-${width}.png`, output).pathname,
    });
    const xp = (await saved(gateKey)).xp;
    await page
      .locator('#card-actions [data-quest-step]:not([data-revealing="true"])')
      .click();
    await page.waitForFunction(
      (k) => JSON.parse(localStorage.getItem(k)).actors.vale.want === null,
      gateKey,
    );
    await ready();
    assert.equal(
      (await saved(gateKey)).xp,
      xp + 1,
      "the Give paid the experience, with no claim",
    );
    assert.equal(await page.locator("#hand .want-frame > .want-card").count(), 0);
    assert.equal(await page.locator(".quest-seal, .quest-xp").count(), 0);
    assert.deepEqual(errors, []);
    console.log(
      `One quest card: fold, deal, one button (step or Discard), met with no claim passed at ${width}px (${motion}).`,
    );
    await page.close();
  }
} finally {
  await browser.close();
  server.close();
}
