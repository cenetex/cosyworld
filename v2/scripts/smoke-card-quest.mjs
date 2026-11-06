import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { chromium } from "playwright";
import { createServer } from "../card-game/serve.mjs";
import { createWorld, encodeSave } from "../card-game/world.mjs";
import { availableCards } from "../card-game/cards.mjs";
import { selectCard, tapCard } from "./card-browser-helpers.mjs";

// The quest folds behind the player's avatar. A met quest stays, sealed,
// until its player clears it; clearing shows the experience it brought. The
// fold opens into the whole stack, where a quest can be chosen, pursued or
// dropped.
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
// Vale at the sanctuary with three things and three quests (#2256).
const shrine = createWorld();
shrine.actors.vale.place = "greek-sanctuary";
shrine.actors.vale.visited.push("pond");
shrine.crossings["pond-greek-harbor"].discovered = true;
for (const id of ["greek-funeral-cloth", "greek-decree", "lamp"])
  shrine.items[id].holder = "vale";
shrine.actors.vale.want = { ...gate.actors.vale.want };
shrine.actors.vale.under = [
  { kind: "item", target: "lamp", step: { verb: "give", to: "greek-ismene" } },
  { kind: "place", target: "greek-gate" },
].map((want) => ({ ...want, since: 0, refusals: 0 }));
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
    // Its label is the quest's verb alone, on one line; the whole quest is
    // its accessible name.
    const head = (scope) =>
      page
        .locator(
          `#hand .want-frame:not([hidden]) .want-card${scope} .quest-head`,
        )
        .first()
        .evaluate((el) => {
          const verb = el.querySelector(".quest-verb");
          return {
            name: verb.textContent,
            lines: Math.round(
              verb.getBoundingClientRect().height /
                parseFloat(getComputedStyle(verb).lineHeight),
            ),
            kicker: el.querySelectorAll(".quest-kicker").length,
            color: getComputedStyle(el).color,
          };
        });
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
      { name: "Hold", lines: 1, kicker: 0, color: "rgb(255, 240, 130)" },
      "the verb alone, in the Legendary lamp's tier",
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
    // Any play meets it; its checked card stays in the open avatar group.
    await page
      .locator(
        '#card-actions [data-action="wait"]:not([data-revealing="true"])',
      )
      .click();
    await ready();
    const card = page.locator('#hand .want-card[data-met="true"]');
    await card.waitFor();
    assert.equal(
      await page.locator("body").getAttribute("data-hand-expanded"),
      "true",
    );
    await page.waitForFunction(() => {
      const box = document
        .querySelector('#hand .want-card[data-met="true"]')
        .getBoundingClientRect();
      return box.left >= 0 && box.right <= innerWidth;
    });
    assert.equal(
      await page
        .locator('#hand [data-card="vale"]')
        .getAttribute("aria-expanded"),
      "true",
    );
    // Met by a play, the same quest is still face up.
    assert.equal(await card.getAttribute("data-unrevealed"), "false");
    assert.equal(await card.locator(".quest-seal").count(), 1);
    assert.equal(await page.locator("#hand .quest-fold").isHidden(), true);
    await page.screenshot({
      path: new URL(`met-${width}.png`, output).pathname,
    });
    // Cleared, it falls away as an inert ghost; reduced motion lets it go.
    await card.hover();
    const falling = await card.evaluate((el) => {
      el.click();
      return [...document.querySelectorAll(".card-exits > .beat-ghost")].map(
        (g) => [g.inert, getComputedStyle(g).pointerEvents],
      );
    });
    assert.deepEqual(falling, motion === "reduce" ? [] : [[true, "none"]]);
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
    // only the top quest offers Abandon.
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
    // No quest card lies ahead of a thing Vale carries (#2295).
    const groupOrdered = () =>
      page.evaluate(() => {
        const row = [...document.querySelector("#hand").children],
          first = row.findIndex(
            (f) => f.dataset.want && f.dataset.holder === "vale",
          );
        return (
          first < 0 ||
          !row
            .slice(first)
            .some((f) => !f.dataset.want && f.dataset.holder === "vale")
        );
      });
    const openFold = async () => {
      await page.locator("#hand .quest-fold").focus();
      await page.keyboard.press("Enter");
      await page.locator("#hand .want-frame:not([hidden])").first().waitFor();
    };
    await openFold();
    const fan = page.locator("#hand .want-frame:not([hidden])");
    assert.equal(await fan.count(), 2, "the open fold fans out the stack");
    // The fold's first tap opens the top quest's details as it fans the stack.
    const picked = page.locator('#hand .want-card[data-picked="true"]');
    assert.equal(await picked.count(), 1);
    assert.equal(await picked.getAttribute("data-quest-id"), "quest:0");
    assert.equal(
      await page
        .locator("#hand > .want-frame:not([hidden]) .want-card")
        .first()
        .getAttribute("data-picked"),
      "true",
    );
    assert.equal(await groupOrdered(), true, "Vale, its things, its quests");
    await page
      .locator(
        '#card-actions [data-drop-quest="0"]:not([data-revealing="true"])',
      )
      .waitFor();
    assert.equal(
      await page
        .locator('#card-actions [data-drop-quest="0"]')
        .getAttribute("aria-label"),
      "Abandon (−1 XP)",
    );
    // Drop is the beat's usual context button, its words red.
    assert.deepEqual(
      await page
        .locator('#card-actions [data-drop-quest="0"]')
        .evaluate((el) => {
          const style = getComputedStyle(el);
          return [style.color, style.textShadow, style.borderTopWidth];
        }),
      ["rgb(255, 143, 132)", "none", "0px"],
    );
    // The action names the goal; its quest card also keeps the level.
    const described = (
      await page.locator(".action-beat-heading:not([hidden])").textContent()
    ).trim();
    assert.ok(
      (await picked.getAttribute("aria-label"))
        .replace(/Level [IVXLCDM]+: /u, "")
        .startsWith(`Quest: ${described}`),
      `the beat names the quest: ${described}`,
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
    // A Talk quest's label reads "Talk" on one line; the sentence is only
    // its accessible name.
    const talk = page.locator('#hand .want-card[data-quest-id="quest:0"]');
    assert.deepEqual(
      await head('[data-quest-id="quest:0"]').then(({ name, lines }) => ({
        name,
        lines,
      })),
      { name: "Talk", lines: 1 },
    );
    assert.equal(
      await talk.getAttribute("aria-label"),
      "Quest: Find someone to talk to",
    );
    const drop = page.locator('#card-actions [data-drop-quest="0"]');
    await drop.waitFor();
    // The quest caption carries the unknown target; Abandon is its action.
    assert(await page.locator(".action-beat-note").isHidden());
    assert.equal(await page.locator("#card-actions button").count(), 1);
    assert.equal(
      await page.locator("#card-actions [data-drop-quest]").count(),
      1,
      "only the top quest offers Drop",
    );
    await page.screenshot({
      path: new URL(`stack-${width}.png`, output).pathname,
    });
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
      /Cost 0 XP/,
    );
    assert.equal(await panel.locator("button").count(), 1);
    const confirm = panel.locator("button");
    if ((await confirm.getAttribute("data-revealing")) === "true") {
      assert.equal(await confirm.textContent(), "Tap to finish");
      await panel.locator("button").click();
      assert.equal(
        (await saved()).turn,
        turn,
        "first confirmation tap finishes typing",
      );
      assert.equal(await panel.getAttribute("data-tier"), "danger");
    }
    assert.equal(await confirm.textContent(), "Tap to confirm");
    await page.keyboard.press("Escape");
    assert.equal((await saved()).turn, turn);
    await readyDrop.click();
    await panel.locator('button:not([data-revealing="true"])').click();
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
      name: "Give",
      lines: 1,
      kicker: 0,
      color: "rgb(255, 240, 130)",
    });
    assert.equal(
      await page
        .locator("#hand .want-frame:not([hidden]) .want-card")
        .first()
        .getAttribute("aria-label"),
      "Quest: Give The Burial Decree to The Gate Guard, near",
    );
    // The first fold tap also names the quest and offers its Give action.
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
    assert.notEqual(
      await page
        .locator("#action-beat")
        .evaluate((el) => getComputedStyle(el).backgroundColor),
      "rgba(0, 0, 0, 0)",
    );
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
    // The last held item leaves, and the completed quest stays in reach.
    const xp = await page.evaluate(
      (key) => JSON.parse(localStorage.getItem(key)).actors.vale.xp,
      gateKey,
    );
    await page
      .locator('#card-actions [data-quest-step]:not([data-revealing="true"])')
      .click();
    const metGift = page.locator('#hand .want-card[data-met="true"]');
    await metGift.waitFor();
    await page.waitForFunction(() => {
      const box = document
        .querySelector('#hand .want-card[data-met="true"]')
        .getBoundingClientRect();
      return box.left >= 0 && box.right <= innerWidth;
    });
    await page.waitForFunction(
      () =>
        document.querySelector('#hand .want-card[data-met="true"]')
          ?.disabled === false,
    );
    assert.equal(
      await page.locator("body").getAttribute("data-hand-expanded"),
      "true",
    );
    assert.equal(
      await page
        .locator('#hand [data-holder="vale"]:not([hidden], [data-want])')
        .count(),
      0,
    );
    assert.equal(
      await page.evaluate(
        (key) => JSON.parse(localStorage.getItem(key)).actors.vale.xp,
        gateKey,
      ),
      xp + 1,
    );
    await page.screenshot({
      path: new URL(`last-gift-${width}.png`, output).pathname,
      animations: "disabled",
    });
    await metGift.click({ position: { x: 40, y: 16 } });
    await page.locator(".quest-xp").waitFor();
    assert.equal(await metGift.count(), 0, "one tap clears the checked card");
    assert.equal(
      await page.evaluate(
        (key) => JSON.parse(localStorage.getItem(key)).actors.vale.xp,
        gateKey,
      ),
      xp + 1,
    );
    // Taking an item raises it at rest. Its next tap opens its full details.
    const pickup = structuredClone(gate);
    pickup.items["greek-decree"].holder = "greek-gate";
    pickup.actors.vale.want = null;
    pickup.actors.vale.content = true;
    await page.evaluate(({ key, save }) => localStorage.setItem(key, save), {
      key: gateKey,
      save: encodeSave(pickup),
    });
    await page.reload();
    await ready();
    await selectCard(page, "greek-decree");
    await page
      .locator(
        '#card-actions [data-action="take"]:not([data-revealing="true"])',
      )
      .click();
    const received = page.locator('#hand [data-card="greek-decree"]');
    await page.waitForFunction(
      () =>
        document.querySelector('#hand [data-card="greek-decree"]')?.disabled ===
          false &&
        document
          .querySelector('#hand [data-card="greek-decree"]')
          ?.getAttribute("aria-pressed") === "true",
    );
    await tapCard(received);
    assert.equal(
      await received.getAttribute("aria-pressed"),
      "true",
      "the received item's first tap opens details",
    );
    await page.waitForFunction(() =>
      document
        .querySelector("#action-beat")
        .innerText.includes("A public copy forbids burial"),
    );
    assert.equal(await page.locator("#action-beat").isVisible(), true);
    await tapCard(received);
    assert.equal(
      await received.getAttribute("aria-pressed"),
      "false",
      "the next tap lowers it",
    );
    // Choosing Vale shows its things and its quests as two stacks; a top
    // card fans its stack, a card chosen moves left, and Vale folds them
    // back, then lowers (#2256). + marks an open stack, * a raised card.
    const shrineKey = `cosyworld.reflected-shore.v1.quest-shrine-${width}`;
    await page.evaluate(
      ({ shrineKey, save, seen }) => {
        localStorage.setItem(shrineKey, save);
        localStorage.setItem(`${shrineKey}.seen`, JSON.stringify(seen));
      },
      { shrineKey, save: encodeSave(shrine), seen: availableCards(shrine) },
    );
    await page.goto(
      `http://127.0.0.1:${server.address().port}/?table=quest-shrine-${width}`,
    );
    await ready();
    const row = () =>
      page.evaluate(() =>
        [...document.querySelectorAll("#hand > .card-frame:not([hidden])")]
          .map((frame) => {
            const card = frame.querySelector(".card");
            return `${card.dataset.card ?? card.dataset.questId}${frame.dataset.raised === "true" ? "*" : ""}${card.getAttribute("aria-expanded") === "true" ? "+" : ""}`;
          })
          .join(" "),
      );
    let shot = 0;
    const play = async (selector, name, cards, actions) => {
      await page
        .locator(`#hand ${selector}`)
        .click({ position: { x: 40, y: 16 } });
      await page.waitForTimeout(500);
      assert.equal(
        await row(),
        `greek-sanctuary ${cards} greek-ismene greek-palace`,
        name,
      );
      if (actions)
        assert.deepEqual(
          await page
            .locator("#card-actions button")
            .evaluateAll((buttons) =>
              buttons.map(
                (button) =>
                  button.dataset.tapName ||
                  button.getAttribute("aria-label") ||
                  button.textContent,
              ),
            ),
          actions,
          name,
        );
      await page.screenshot({
        path: new URL(`stacks-${width}-${++shot}-${name}.png`, output).pathname,
      });
    };
    const vale = '[data-card="vale"]',
      top = '.want-card[data-quest-id="quest:0"]',
      lamp = "vale+ lamp* greek-funeral-cloth";
    await play(vale, "stacks", "vale*+ greek-funeral-cloth quest:0", ["Wait"]);
    assert.equal(
      await page
        .locator('#hand [data-holder="vale"]:not([hidden]) > .place-edge')
        .count(),
      4,
      "the rest lie face down behind each top card",
    );
    await play(
      '[data-card="greek-funeral-cloth"]',
      "items",
      "vale+ greek-funeral-cloth* greek-decree+ lamp quest:0",
    );
    assert.equal(
      await page
        .locator('#hand [data-card="greek-funeral-cloth"]')
        .getAttribute("aria-pressed"),
      "true",
    );
    assert.equal(
      await page.locator("#action-beat").isVisible(),
      true,
      "the first item tap opens its details",
    );
    await page.waitForFunction(() =>
      document
        .querySelector("#action-beat")
        .innerText.includes("Clean linen from the looms at Eleusis"),
    );
    assert.match(
      await page.locator("#action-beat").innerText(),
      /Clean linen from the looms at Eleusis/,
    );
    await page.screenshot({
      path: new URL(`details-${width}.png`, output).pathname,
      animations: "disabled",
    });
    await play(
      '[data-card="greek-funeral-cloth"]',
      "lower-item",
      "vale+ greek-funeral-cloth+ greek-decree lamp quest:0",
    );
    await play('[data-card="lamp"]', "item", `${lamp}+ greek-decree quest:0`, [
      "Light",
    ]);
    await play(
      top,
      "quest",
      "vale+ greek-funeral-cloth quest:0* quest:1+ quest:2",
      ["Travel"],
    );
    await play(
      top,
      "lower",
      "vale+ greek-funeral-cloth quest:0+ quest:1 quest:2",
    );
    await play(vale, "fold", "vale*+ greek-funeral-cloth quest:0");
    // A quest dealt while Vale's stacks show rises in its own slot, not
    // from Vale's card across its things (#2295).
    if (motion === "no-preference") {
      await page.evaluate(() => {
        window.questStart = null;
        const watch = new MutationObserver(() => {
          const frame = document.querySelector(
            '#hand > .want-frame:not([hidden]) > .want-card[data-quest-id="quest:0"]',
          )?.parentElement;
          if (!frame || window.questStart || !frame.getAnimations().length)
            return;
          window.questStart = frame.getBoundingClientRect().left;
        });
        watch.observe(document.getElementById("hand"), { childList: true });
      });
      // Another tab deals it: the same render path as a play.
      await page.evaluate((shrineKey) => {
        const s = JSON.parse(localStorage.getItem(shrineKey));
        s.actors.vale.want = {
          kind: "place",
          target: "greek-palace",
          since: s.turn,
          refusals: 0,
        };
        const newValue = JSON.stringify(s);
        localStorage.setItem(shrineKey, newValue);
        window.dispatchEvent(
          new StorageEvent("storage", { key: shrineKey, newValue }),
        );
      }, shrineKey);
      await page.waitForFunction(() => window.questStart !== null);
      await page.waitForTimeout(800);
      const [start, slot, valeLeft] = await page.evaluate(() => [
        window.questStart,
        document
          .querySelector("#hand > .want-frame:not([hidden])")
          .getBoundingClientRect().left,
        document
          .querySelector('#hand [data-card="vale"]')
          .getBoundingClientRect().left,
      ]);
      assert.ok(
        Math.abs(start - slot) < 24 && Math.abs(start - valeLeft) > 80,
        `a dealt quest starts in its slot (${start} vs ${slot}, Vale ${valeLeft})`,
      );
    }
    const dealtQuest = await page
      .locator("#hand > .want-frame:not([hidden])")
      .first()
      .evaluate((frame) => {
        const card = frame.getBoundingClientRect(),
          hand = frame.parentElement.getBoundingClientRect();
        return {
          left: card.left,
          right: card.right,
          start: hand.left,
          end: hand.right,
        };
      });
    assert(
      dealtQuest.right > dealtQuest.start && dealtQuest.left < dealtQuest.end,
      `the dealt quest appears in the visible hand: ${JSON.stringify(dealtQuest)}`,
    );
    await play(vale, "deselect", "vale", []);
    // A face-down item and destination stay unnamed in every card label.
    await page.evaluate((key) => {
      const save = JSON.parse(localStorage.getItem(key));
      save.actors.vale.want = {
        kind: "item",
        target: "routes",
        step: { verb: "bring", at: "train" },
        story: true,
        since: save.turn,
        refusals: 0,
      };
      delete save.actors.vale.under;
      localStorage.setItem(key, JSON.stringify(save));
      const seen = JSON.parse(localStorage.getItem(`${key}.seen`));
      localStorage.setItem(
        `${key}.seen`,
        JSON.stringify(seen.filter((id) => !["routes", "train"].includes(id))),
      );
    }, shrineKey);
    await page.reload();
    await page.locator("#hand .quest-fold").focus();
    await page.keyboard.press("Enter");
    assert.equal(
      (await page.locator(".action-beat-heading").textContent()).trim(),
      "Find something and bring it somewhere",
    );
    await page
      .locator('#card-actions [data-drop-quest]:not([data-revealing="true"])')
      .waitFor();
    assert.equal(
      await page.locator("#card-actions button").textContent(),
      "Tap to abandon",
    );
    const labels = await page
      .locator("#action-beat")
      .evaluate((el) =>
        [
          el.textContent,
          ...[...el.querySelectorAll("*")].flatMap((node) => [
            node.getAttribute("aria-label"),
            node.title,
          ]),
        ].join(" "),
      );
    assert.doesNotMatch(labels, /Route board|Between-hours carriage/);
    await page.waitForTimeout(250);
    await page.locator(".dialogue").screenshot({
      path: new URL(`hidden-quest-${width}.png`, output).pathname,
    });
    for (const [kind, target, step, level] of [
      ["item", "routes", { verb: "bring", at: "train" }],
      ["place", "greek-palace", null, 20],
      [
        "place",
        "greek-polynices-hollow",
        {
          verb: "lay",
          items: ["greek-oil-flask", "greek-funeral-cloth", "greek-shovel"],
        },
      ],
    ]) {
      const sceneWorld = createWorld();
      sceneWorld.actors.vale.visited.push("pond");
      sceneWorld.actors.vale.want = {
        kind,
        target,
        ...(step ? { step } : {}),
        ...(level ? { quest: { level, left: 4 } } : { story: true }),
        since: sceneWorld.turn,
        refusals: 0,
      };
      if (step?.verb === "lay") {
        sceneWorld.crossings["pond-greek-harbor"].discovered = true;
        sceneWorld.actors.vale.place = target;
        sceneWorld.actors["greek-antigone"].place = target;
        for (const item of step.items) sceneWorld.items[item].holder = "vale";
      }
      const place = step?.at ?? target;
      const label = step?.verb === "lay" ? "burial" : kind;
      const sceneTable = `quest-scene-${label}-${width}`;
      const sceneKey = `cosyworld.reflected-shore.v1.${sceneTable}`;
      const seen = availableCards(sceneWorld).filter(
        (id) => id !== place && id !== target,
      );
      // A rite appears only in the Hollow where Vale already stands.
      const visibility = step?.verb === "lay" ? [true] : [false, true];
      for (const revealed of visibility) {
        await page.evaluate(
          ({ sceneKey, save, seen }) => {
            localStorage.setItem(sceneKey, save);
            localStorage.setItem(`${sceneKey}.seen`, JSON.stringify(seen));
          },
          {
            sceneKey,
            save: encodeSave(sceneWorld),
            seen: revealed ? [...seen, place] : seen,
          },
        );
        await page.goto(
          `http://127.0.0.1:${server.address().port}/?table=${sceneTable}`,
        );
        await ready();
        await page.locator("#hand .quest-fold").focus();
        await page.keyboard.press("Enter");
        const scene = page.locator(".action-beat-cards .quest-screen");
        const ground = scene.locator(".quest-ground");
        await ground.waitFor();
        assert.equal(await scene.locator('[data-entity="vale"]').count(), 1);
        assert.equal(
          await ground.getAttribute("data-entity"),
          revealed ? place : null,
        );
        assert.equal(
          /card-back/u.test(await ground.getAttribute("src")),
          !revealed,
        );
        assert(
          !/Not found yet/u.test(
            await page.locator("#action-beat").innerText(),
          ),
        );
        if (!revealed) {
          assert(await page.locator(".action-beat-note").isHidden());
          if (kind === "item")
            assert.equal(
              (await page.locator(".action-beat-heading").textContent()).trim(),
              "Find something and bring it somewhere",
            );
        }
        await page.waitForFunction(
          () =>
            document.querySelector("#action-beat button")?.dataset.revealing ===
            "false",
        );
        await page.locator(".dialogue").screenshot({
          path: new URL(
            `scene-${label}-${revealed ? "revealed" : "hidden"}-${width}.png`,
            output,
          ).pathname,
          animations: "disabled",
        });
        if (level) {
          const action = page.locator("#action-beat");
          assert.doesNotMatch(await action.innerText(), /Level XX/u);
          assert.match(
            await page
              .locator('#hand .want-card[data-quest-id="quest:0"]')
              .getAttribute("aria-label"),
            /Level XX:/u,
          );
          assert.equal(await action.getAttribute("data-tier"), "rare");
          assert.equal(
            await page
              .locator('#hand .want-card[data-quest-id="quest:0"]')
              .getAttribute("data-tier"),
            "rare",
          );
          const style = await action.evaluate((el) => ({
            border: getComputedStyle(el).borderTopColor,
            shadow: getComputedStyle(el).boxShadow,
          }));
          assert.equal(style.border, "rgb(190, 130, 255)");
          assert.match(style.shadow, /14px/u, "rare quests glow");
          await action.locator("button").click();
          assert.equal(await action.getAttribute("data-tier"), "danger");
          assert.doesNotMatch(await action.innerText(), /Level XX/u);
          await page.keyboard.press("Escape");
          assert.equal(await action.getAttribute("data-tier"), "rare");
        }
      }
    }
    assert.deepEqual(errors, []);
    console.log(
      `Quest fold, met seal, click to clear and +XP, stack fan, choose and drop, avatar stacks passed at ${width}px (${motion}).`,
    );
    await page.close();
  }
} finally {
  await browser.close();
  server.close();
}
