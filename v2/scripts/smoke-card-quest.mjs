import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { chromium } from "playwright";
import { createServer } from "../card-game/serve.mjs";
import { createWorld, encodeSave } from "../card-game/world.mjs";
import { availableCards } from "../card-game/cards.mjs";

// The quest folds behind the player's avatar. A met quest stays, sealed,
// until its player clears it; clearing shows the experience it brought. The
// fold opens into the whole stack, where a quest can be pursued or dropped.
const server = createServer();
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const browser = await chromium.launch({ headless: true });
const output = new URL("../../output/quest/", import.meta.url);
const gate = createWorld();
gate.actors.vale.place = "greek-gate";
gate.actors.vale.visited.push("pond");
gate.crossings["pond-greek-harbor"].discovered = true;
gate.items["greek-decree"].holder = "vale";
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
    const ready = () =>
      page.waitForFunction(
        () => document.querySelector("#hand").dataset.cooling === "false",
      );
    await page.goto(
      `http://127.0.0.1:${server.address().port}/?table=${table}`,
    );
    await ready();
    // Uncover the opening cards, then give Vale the quest of holding the lamp
    // it already holds, past the pond where quests begin.
    for (const id of ["vale", "lamp", "attic"])
      await page
        .locator(`#hand [data-card="${id}"]`)
        .evaluate((el) => el.click());
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
    // Its face names it "Quest", then the quest as a plain sentence.
    const head = (scope) =>
      page
        .locator(
          `#hand .want-frame:not([hidden]) .want-card${scope} .quest-head`,
        )
        .first()
        .evaluate((el) => ({
          kicker: el.querySelector(".quest-kicker").textContent,
          name: el.querySelector(".quest-verb").textContent,
          color: getComputedStyle(el).color,
        }));
    await page.screenshot({
      path: new URL(`folded-${width}.png`, output).pathname,
    });
    // Opening Vale's stack brings the quest forward with its halo; the fold
    // behind Vale hides, so Vale's card carries no quest glow.
    // Watches, from each change to the hand, whether a quest in view shows
    // the carved lid; the turn is quick, so polling could miss it.
    const watchFaceDown = () =>
      page.evaluate(() => {
        window.questFaceDown?.disconnect();
        const watch = new MutationObserver(() => {
          const back = document.querySelector(
            '#hand .want-frame:not([hidden]) .want-card[data-unrevealed="true"] .card-back',
          );
          if (back && getComputedStyle(back).display === "block")
            watch.seen = true;
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
    await watchFaceDown();
    await page.locator('#hand [data-card="vale"]').click();
    await quest.waitFor();
    // It enters face down, the carved lid showing, then turns to its face.
    const entered = page.locator("#hand .want-frame:not([hidden]) .want-card");
    await page.locator('#hand .want-card[data-unrevealed="false"]').waitFor();
    assert.equal(await sawFaceDown(), true, "the quest is dealt face down");
    assert.deepEqual(
      await head(""),
      { kicker: "Quest", name: "Hold Lamp", color: "rgb(255, 240, 130)" },
      "the kicker, the sentence and the Legendary lamp's tier",
    );
    // It turns once: folding Vale's stack and opening it again, redraw after
    // redraw, never deals it face down again.
    await watchFaceDown();
    for (let i = 0; i < 2; i++) {
      await page.locator('#hand [data-card="vale"]').click();
      await quest.waitFor({ state: "hidden" });
      await page.locator('#hand [data-card="vale"]').click();
      await quest.waitFor();
      assert.equal(await entered.getAttribute("data-unrevealed"), "false");
    }
    assert.equal(await sawFaceDown(), false, "it never turns back over");
    assert.equal(await page.locator("#hand .quest-fold").isHidden(), true);
    assert.equal(
      await page.locator('#hand .want-card[data-near="true"]').isVisible(),
      true,
    );
    await page.screenshot({
      path: new URL(`expanded-${width}.png`, output).pathname,
    });
    // Any play meets it; it stays sealed and the fold glows.
    await page
      .locator("#card-actions button", { hasText: "Wait" })
      .first()
      .click();
    await ready();
    const tab = page.locator('#hand .quest-fold[data-glow="invite"]');
    await tab.waitFor();
    // The fold peeks out behind Vale's card; it also takes the keyboard.
    await tab.focus();
    await page.keyboard.press("Enter");
    const card = page.locator('#hand .want-card[data-met="true"]');
    await card.waitFor();
    // Met by a play, the same quest is still face up.
    assert.equal(await card.getAttribute("data-unrevealed"), "false");
    assert.equal(await card.locator(".quest-seal").count(), 1);
    assert.equal(await page.locator("#hand .quest-fold").isHidden(), true);
    await page.screenshot({
      path: new URL(`met-${width}.png`, output).pathname,
    });
    await card.click();
    const gain = page.locator(".quest-xp");
    await gain.waitFor();
    assert.match(await gain.textContent(), /^\+\d+ XP$/);
    await page.screenshot({
      path: new URL(`cleared-${width}.png`, output).pathname,
    });
    assert.equal(
      await page.locator('#hand .want-card[data-met="true"]').count(),
      0,
    );
    await gain.waitFor({ state: "detached" });
    // A stack (#1831): the fold shows the top quest; opening it fans them all
    // out; choosing a quest beneath brings it to the top without a turn, and
    // only the top quest offers Drop quest.
    await page.evaluate((key) => {
      const s = JSON.parse(localStorage.getItem(key));
      const vale = s.actors.vale;
      vale.want = {
        kind: "place",
        target: "station",
        since: s.turn,
        refusals: 0,
        // A level quest: its Drop names the cost (rules 98).
        quest: { level: 2, left: 2 },
      };
      Object.assign(vale, { xp: 1, level: 1 });
      vale.under = [
        { kind: "person", target: "keeper", since: s.turn, refusals: 0 },
      ];
      localStorage.setItem(key, JSON.stringify(s));
    }, key);
    await page.reload();
    await ready();
    const saved = () =>
      page.evaluate((key) => {
        const s = JSON.parse(localStorage.getItem(key));
        const vale = s.actors.vale;
        return {
          turn: s.turn,
          targets: [vale.want, ...(vale.under || [])].map((w) => w.target),
        };
      }, key);
    const openFold = async () => {
      await page.locator("#hand .quest-fold").focus();
      await page.keyboard.press("Enter");
      await page.locator("#hand .want-frame:not([hidden])").first().waitFor();
    };
    await openFold();
    const fan = page.locator("#hand .want-frame:not([hidden])");
    assert.equal(await fan.count(), 2, "the open fold fans out the stack");
    const picked = page.locator('#hand .want-card[data-picked="true"]');
    assert.equal(await picked.getAttribute("data-quest-id"), "quest:0");
    assert.equal(
      await page.locator('#card-actions [data-drop-quest="0"]').textContent(),
      "Drop quest (−1 XP)",
    );
    // Drop is a secondary, destructive choice: red words with no panel.
    assert.deepEqual(
      await page
        .locator('#card-actions [data-drop-quest="0"]')
        .evaluate((el) => {
          const style = getComputedStyle(el);
          return [style.color, style.backgroundColor, style.borderTopColor];
        }),
      ["rgb(255, 143, 132)", "rgba(0, 0, 0, 0)", "rgba(0, 0, 0, 0)"],
    );
    assert.equal(
      await page.locator("#card-actions [data-focus-quest]").count(),
      0,
      "no Pursue button",
    );
    // Both are dealt face down here and turn once.
    const facedDown = page.locator(
      '#hand .want-frame:not([hidden]) .want-card[data-unrevealed="true"]',
    );
    await page.waitForFunction(
      () =>
        !document.querySelector(
          '#hand .want-frame:not([hidden]) .want-card[data-unrevealed="true"]',
        ),
    );
    await watchFaceDown();
    const { turn } = await saved();
    await page.locator('#hand .want-card[data-quest-id="quest:1"]').click();
    await page.waitForFunction(
      (key) =>
        JSON.parse(localStorage.getItem(key)).actors.vale.want.target ===
        "keeper",
      key,
    );
    assert.deepEqual(
      await saved(),
      { turn, targets: ["keeper", "station"] },
      "the chosen quest on top, no turn taken",
    );
    assert.equal(await fan.count(), 2, "the fan stays open");
    // Reordering the stack is progress, not a new deal: both stay face up.
    assert.equal(await facedDown.count(), 0, "no quest turns back over");
    assert.equal(await sawFaceDown(), false, "no quest turns back over");
    assert.equal(await picked.getAttribute("data-quest-id"), "quest:0");
    const drop = page.locator('#card-actions [data-drop-quest="0"]');
    await drop.waitFor();
    assert.equal(
      await page.locator("#card-actions [data-drop-quest]").count(),
      1,
      "only the top quest offers Drop",
    );
    await page.screenshot({
      path: new URL(`stack-${width}.png`, output).pathname,
    });
    await drop.click();
    await ready();
    assert.deepEqual(
      (await saved()).targets,
      ["station"],
      "the top quest dropped",
    );
    // At the Theban City Gate, giving the Decree to the guard shows all
    // three, Vale, the scroll and the guard, and takes the Legendary scroll's
    // tier.
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
    await openFold();
    await page.locator('#hand .want-card[data-unrevealed="false"]').waitFor();
    assert.deepEqual(await head(""), {
      kicker: "Quest",
      name: "Give The Burial Decree to The Gate Guard",
      color: "rgb(255, 240, 130)",
    });
    assert.equal(
      await page
        .locator('#hand .want-card .quest-screen[data-parts="3"] > img')
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
    assert.deepEqual(errors, []);
    console.log(
      `Quest fold, met seal, click to clear and +XP, stack fan, choose and drop passed at ${width}px (${motion}).`,
    );
    await page.close();
  }
} finally {
  await browser.close();
  server.close();
}
