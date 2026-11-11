// A lost battle, seen in the browser: telegraph, hit, the fade to black, the
// loss screen with no buttons, then the slow lift onto the new place.
// Desktop, phone and reduced motion; against Antigone, Pip is a third
// combatant.
import { atticOpening } from "../../test/fixtures/card-attic-opening.mjs";
import {
  clearSelection,
  readyActionButton,
  selectCard,
} from "./card-browser-helpers.mjs";
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { chromium } from "playwright";
import { createServer } from "../card-game/serve.mjs";
import {
  encodeSave,
  holdChoice,
  legalActions,
  nameOf,
  play,
} from "../card-game/world.mjs";
import { enableMotives } from "../card-game/motives.mjs";
import { combatPortrait } from "../card-game/combat-portraits.mjs";

function fixture(opponent) {
  let s = enableMotives(atticOpening());
  // Played as a player does since Snuff and Light were retired: stow the lamp
  // to open the dark mirror, cross to the pond, then let a turn pass there.
  // The arrival beat fills the dialogue box, which adds to the hand's box; a
  // held Lamp would turn the opponent's Strike into Give Lamp.
  holdChoice(s, "vale", { item: null, revision: s.revision });
  // The opponent, and Pip as the third fighter against Antigone, wait there.
  for (const id of new Set([opponent, "moth"])) s.actors[id].place = "pond";
  for (const step of [
    (a) => a.kind === "move" && a.target === "pond",
    (a) => a.kind === "wait",
  ]) {
    const action = legalActions(s).find(step);
    assert.ok(action, "The stowed lamp opens the way to the pond");
    s = play(s, action).state;
  }
  // The opponent has the upper hand and was just struck by Vale, so it
  // strikes back: Vale's next brace loses the battle.
  const third = opponent === "moth" ? {} : { moth: 4 };
  const all = (v) => ({
    vale: v,
    [opponent]: v,
    ...(third.moth ? { moth: v } : {}),
  });
  s.standoffs = [
    {
      challenger: opponent,
      defender: "vale",
      location: "pond",
      item: "lamp",
      opened: s.turn - 1,
      answered: true,
      resolve: { vale: 1, [opponent]: 4, ...third },
      guarding: { ...all(false), vale: true },
      struck: all(true),
      steppedBack: all(false),
      covering: {},
      hitBy: { [opponent]: "vale" },
    },
  ];
  return s;
}

const server = createServer();
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const output = new URL("../../output/combat/", import.meta.url);
await mkdir(output, { recursive: true });
const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE,
});
const results = [];
try {
  for (const [width, height, motion, opponent, knownArrival] of [
    ...["moth", "greek-antigone"].flatMap((id) => [
      [1440, 900, "no-preference", id, true],
      [390, 844, "no-preference", id, true],
      [390, 844, "reduce", id, true],
    ]),
    [390, 844, "reduce", "moth", false],
  ]) {
    const page = await browser.newPage({
      viewport: { width, height },
      reducedMotion: motion,
    });
    page.setDefaultTimeout(15000);
    const table = `combat-${opponent}-${width}-${motion === "reduce" ? "r" : "m"}-${knownArrival ? "seen" : "new"}`;
    const key = `cosyworld.reflected-shore.v1.${table}`;
    const report = { opponent, width, motion, knownArrival, errors: [] };
    results.push(report);
    page.on("pageerror", (error) => report.errors.push(error.message));
    await page.addInitScript(
      ({ key, save, knownArrival }) => {
        localStorage.setItem(key, save);
        // The arrival reply comes from a host whose card was already revealed.
        localStorage.setItem(
          `${key}.seen`,
          JSON.stringify(knownArrival ? ["station", "keeper"] : []),
        );
        localStorage.setItem("cosyworld.dialogue.sound", "off");
        localStorage.setItem(
          "cosyworld.room-music",
          JSON.stringify({ enabled: false }),
        );
        // From the loss screen on: each frame's hand while the dock is up,
        // and each card dealt in.
        window.afterLoss = { up: [], dealt: [] };
        let lost = false;
        const look = () => {
          lost ||= Boolean(document.querySelector(".defeat-reveal"));
          const dock = document.querySelector(".play-dock");
          if (lost && dock.getBoundingClientRect().top < innerHeight - 60)
            window.afterLoss.up.push(
              [...document.querySelectorAll("#hand > :not([hidden]) .card")]
                .map((c) => c.dataset.card)
                .join(),
            );
          requestAnimationFrame(look);
        };
        requestAnimationFrame(look);
        const animate = Element.prototype.animate;
        Element.prototype.animate = function (frames, options) {
          if (lost && this.closest?.("#hand"))
            window.afterLoss.dealt.push(
              frames?.[0]?.opacity ?? frames?.opacity,
            );
          return animate.call(this, frames, options);
        };
      },
      { key, save: encodeSave(fixture(opponent)), knownArrival },
    );
    let request;
    await page.route("**/card-game/text", async (route) => {
      request = route.request().postDataJSON();
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          revision: request.revision,
          model: "combat-fixture",
          entries: request.entities.map(({ id }) => ({
            id,
            text: `${nameOf(id)} shakes off the dust of the road.`,
          })),
        }),
      });
    });
    await page.goto(
      `http://127.0.0.1:${server.address().port}/?table=${table}`,
    );
    await page.locator(`#hand [data-card="${opponent}"]`).waitFor();
    // In battle the room is locked: only this place (Wait), and no items but
    // the demanded Lamp, which Vale may still hand over.
    assert.deepEqual(
      [
        ...new Set(
          await page.$$eval("#hand [data-card]", (cards) =>
            cards.map((card) => card.dataset.card),
          ),
        ),
      ].sort(),
      [...new Set(["lamp", "moth", opponent, "vale", "pond"])].sort(),
      "In battle the hand holds the people, the place and the demanded item",
    );
    // Standing resolve shows under every combatant before the play.
    await page.waitForFunction(
      (count) =>
        document.querySelectorAll("#cast .combat-pips").length === count,
      opponent === "moth" ? 2 : 3,
    );
    assert.match(
      await page
        .locator('#cast [data-avatar="vale"] .portrait-body > img')
        .getAttribute("data-source"),
      /vale-guard\.webp$/,
      "The saved standing guard selects its painting before another play",
    );
    // Vale's own card alone is Brace; with the opponent it is Guard.
    await selectCard(page, opponent);
    const strikeButton = readyActionButton(page, "attack");
    await strikeButton.waitFor();
    assert.equal(
      await strikeButton.getAttribute("aria-label"),
      "Strike",
      "In battle the avatar card's Talk is Strike",
    );
    assert.equal(
      await strikeButton.getAttribute("data-tap-hint"),
      "Tap to strike",
    );
    await clearSelection(page);
    await selectCard(page, "vale");
    await page.evaluate(() => {
      window.combatArt = [];
      // The painted effects each beat drew (#1920).
      window.combatEffects = [];
      new MutationObserver((changes) => {
        for (const change of changes)
          for (const node of change.addedNodes)
            if (node.classList?.contains("combat-effect"))
              window.combatEffects.push(node.dataset.effect);
      }).observe(document.querySelector("#cast"), {
        subtree: true,
        childList: true,
      });
      // The caption's width at each beat.
      const caption = document.querySelector("#combat-caption");
      window.captionWidths = [];
      new MutationObserver(() => {
        if (!caption.hidden)
          window.captionWidths.push(caption.getBoundingClientRect().width);
      }).observe(caption, { childList: true, attributeFilter: ["hidden"] });
      // Who stands in the front row at each step of the exchange.
      window.battleRows = [];
      new MutationObserver(() => {
        const row = (name) =>
          [...document.querySelectorAll(`#cast [data-battle-row="${name}"]`)]
            .map((el) => el.dataset.avatar)
            .sort();
        const front = document.querySelector('#cast [data-battle-row="front"]');
        const back = document.querySelector('#cast [data-battle-row="back"]');
        window.battleRows.push({
          front: row("front"),
          back: row("back"),
          above:
            !back ||
            Number(getComputedStyle(front).zIndex) >
              Number(getComputedStyle(back).zIndex),
        });
      }).observe(document.querySelector("#cast"), {
        subtree: true,
        attributes: true,
        attributeFilter: ["data-battle-row"],
      });
      new MutationObserver(() => {
        for (const image of document.querySelectorAll(
          "#cast .portrait-body > img",
        ))
          window.combatArt.push(image.dataset.source);
      }).observe(document.querySelector("#cast"), {
        subtree: true,
        attributes: true,
        attributeFilter: ["data-source"],
      });
    });
    const handRect = () =>
      page.locator("#hand").evaluate((hand) => {
        const { left, top, width, height } = hand.getBoundingClientRect();
        return [left, top, width, height].map(Math.round);
      });
    await page.waitForTimeout(400); // the hand rises again after Escape
    // The dialogue box lies over the hand's foot and adds to the hand's box
    // while it shows. Real play always has a beat there, so a table without
    // one is not a fight the hand's layout can be judged on.
    assert.equal(
      await page.locator(".dialogue").evaluate((box) => !box.hidden),
      true,
      "The dialogue shows a beat before the strike, as after real play",
    );
    const raisedHand = await handRect();
    const brace = readyActionButton(page, "guard");
    await brace.waitFor();
    assert.equal(await brace.getAttribute("aria-label"), "Brace");
    assert.equal(await brace.getAttribute("data-tap-hint"), "Tap to brace");
    await brace.click();
    // The hand locks, untappable, as soon as the play commits, and the
    // dialogue steps aside; only the player lowers the hand.
    assert.deepEqual(
      await page.evaluate(() => {
        const dock = document.querySelector(".play-dock"),
          dialogue = document.querySelector(".dialogue");
        return [
          dock.dataset.covered,
          dock.inert,
          dialogue.dataset.dropped,
          document.body.dataset.handExpanded,
        ];
      }),
      ["true", true, "true", "true"],
      "The hand stays raised and locked while the strikes resolve",
    );
    // The telegraph and the rules line appear on stage before the new place.
    await page.locator("#combat-caption:not([hidden])").waitFor();
    // The locked hand tucks straight down out of the fighters' way, keeping
    // its layout, and the caption reads below the top bar. A busy runner may
    // take longer than the 280 ms tuck, so wait for it rather than a fixed
    // pause.
    await page
      .waitForFunction(
        (foot) =>
          document.querySelector("#hand").getBoundingClientRect().top >= foot,
        height - 60,
        { timeout: 2000 },
      )
      .catch(() => {});
    const tucked = await handRect();
    assert.deepEqual(
      [tucked[0], tucked[2], tucked[3]],
      [raisedHand[0], raisedHand[2], raisedHand[3]],
      "The strikes keep the raised hand's layout",
    );
    assert.ok(
      tucked[1] >= height - 60,
      `The hand tucks down during the beats ${tucked} from ${raisedHand}`,
    );
    if (width > 640)
      assert.ok(
        await page.evaluate(
          () =>
            document.querySelector("#combat-caption").getBoundingClientRect()
              .top >=
            document.querySelector(".topbar").getBoundingClientRect().bottom,
        ),
        "The caption reads below the top bar",
      );
    // From the first combat frame the two fighters face each other.
    assert.deepEqual(
      await page.evaluate(
        (opponent) =>
          Array.from(
            document.querySelectorAll("#cast .combat-pips"),
            (bar) => bar.parentElement.dataset.avatar,
          )
            .filter((id) => ["vale", opponent].includes(id))
            .map((id, i, pair) => {
              const at = (who) => {
                const box = document
                  .querySelector(`#cast [data-avatar="${who}"]`)
                  .getBoundingClientRect();
                return box.left + box.width / 2;
              };
              const toward = at(pair[1 - i]) > at(id) ? "right" : "left";
              const facing = document.querySelector(
                `#cast [data-avatar="${id}"]`,
              ).dataset.facing;
              return facing === toward;
            }),
        opponent,
      ),
      [true, true],
      "The fighters face each other before the first strike",
    );
    // The exchange stands apart at every width, including three-way phone
    // battles, where the ordinary scene pins foreground figures to one spot.
    await page.waitForTimeout(400); // the fighters step onto their marks
    const apart = await page.evaluate((opponent) => {
      const at = (who) => {
        const box = document
          .querySelector(`#cast [data-avatar="${who}"]`)
          .getBoundingClientRect();
        return box.left + box.width / 2;
      };
      return Math.abs(at("vale") - at(opponent)) / innerWidth;
    }, opponent);
    assert.ok(apart > 0.3, `The two fighters stand apart (${apart})`);
    report.telegraph = await page.locator("#combat-caption").textContent();
    assert.match(
      await page
        .locator('#cast [data-avatar="vale"] .portrait-body > img')
        .getAttribute("data-source"),
      /vale-guard\.webp$/,
    );
    await page.waitForFunction(() =>
      /loses \d+ resolve/.test(
        document.querySelector("#combat-caption").textContent,
      ),
    );
    // Those behind the exchange face it, and on phones the exchange shares
    // one scale whatever each painting's framing.
    const rowsNow = await page.evaluate(() => {
      const box = (el) => el.getBoundingClientRect();
      const centre = (el) => box(el).left + box(el).width / 2;
      const front = [
        ...document.querySelectorAll('#cast [data-battle-row="front"]'),
      ];
      const middle =
        front.reduce((sum, el) => sum + centre(el), 0) / front.length;
      return {
        heights: front.map((el) => box(el).height),
        away: [...document.querySelectorAll('#cast [data-battle-row="back"]')]
          .filter((el) => Math.abs(centre(el) - middle) > 5)
          .filter(
            (el) => (el.dataset.facing === "right") !== middle > centre(el),
          )
          .map((el) => el.dataset.avatar),
      };
    });
    assert.deepEqual(rowsNow.away, [], "The back row faces the exchange");
    if (width <= 700 && rowsNow.heights.length > 1)
      assert.ok(
        Math.max(...rowsNow.heights) - Math.min(...rowsNow.heights) < 2,
        `The exchange shares one scale ${rowsNow.heights}`,
      );
    // The trail runs toward the target and stays on screen.
    const trail = await page.evaluate(() => {
      const el = document.querySelector(
        '#cast .combat-effect[data-effect^="swipe"], #cast .combat-effect[data-effect^="jab"]',
      );
      if (!el) return null;
      const box = el.getBoundingClientRect();
      return { left: box.left, right: box.right };
    });
    if (motion !== "reduce" && trail)
      assert.ok(
        trail.left >= -1 && trail.right <= width + 1,
        `The strike trail stays on screen ${JSON.stringify(trail)}`,
      );
    // The painting has fallen back behind the fighters (cut with reduced
    // motion).
    await page.waitForFunction(
      () =>
        document.querySelector("#stage").dataset.recede === "true" &&
        getComputedStyle(document.querySelector("#backdrop")).opacity < 0.5,
    );
    // A hit lands: no target circle, a slim resolve bar under each fighter.
    await page.screenshot({
      path: new URL(`hit-${opponent}-${width}-${motion}.png`, output).pathname,
    });
    assert.equal(
      await page.evaluate(
        () =>
          document.querySelectorAll(".combat-reticle").length +
          [...document.querySelectorAll("#cast .portrait")].filter(
            (el) => getComputedStyle(el, "::after").borderStyle === "dashed",
          ).length,
      ),
      0,
      "The target shows a rim light, not a dashed circle",
    );
    assert.ok(
      (
        await page.$$eval("#cast .combat-pips", (bars) =>
          bars.map((bar) => bar.offsetHeight),
        )
      ).every((height) => height > 0 && height <= 4),
      "Resolve bars are slim",
    );
    report.word = await page
      .locator('#cast [data-avatar="vale"] .combat-word')
      .last()
      .textContent();
    // The scene fades toward black before the loss screen.
    await page.locator("#travel.fainting").waitFor();
    await page.waitForTimeout(motion === "reduce" ? 0 : 500);
    await page.screenshot({
      path: new URL(`faint-${opponent}-${width}-${motion}.png`, output)
        .pathname,
    });
    await page.locator(".defeat-reveal").waitFor();
    // The striker and Vale step forward together; Pip waits behind.
    const rows = await page.evaluate(() => window.battleRows);
    const strike = rows.findLast((r) => r.front.length === 2);
    assert.deepEqual(
      strike?.front,
      [opponent, "vale"].sort(),
      "Exchange in front",
    );
    assert.deepEqual(strike.back, opponent === "moth" ? [] : ["moth"]);
    assert.ok(
      rows.every((r) => r.above),
      `The front row is drawn above ${JSON.stringify(rows)}`,
    );
    // Brace raises its shield; the hit burst matches the recorded damage and,
    // with motion, a trail follows the lunge.
    const struck = (
      await page.evaluate((key) => JSON.parse(localStorage.getItem(key)), key)
    ).log.findLast((e) => e.verb === "attack");
    report.effects = await page.evaluate(() => window.combatEffects);
    assert.ok(report.effects.includes("brace-raise"), "Brace raises a shield");
    assert.ok(report.effects.includes(`hit-${Math.min(3, struck.damage)}`));
    if (motion !== "reduce")
      assert.ok(report.effects.some((e) => /^(swipe|jab)-/u.test(e)));
    report.art = [...new Set(await page.evaluate(() => window.combatArt))];
    for (const [id, pose] of [
      ["vale", "guard"],
      [opponent, "attack"],
      ["vale", "hit"],
    ]) {
      const source = combatPortrait(
        id,
        pose,
        `./assets/${id}.png`,
        id === "vale" ? "right" : "left",
      );
      if (source)
        assert.ok(
          report.art.includes(source),
          `${source} appeared in the committed combat beats`,
        );
    }
    assert.equal(
      await page
        .locator('#cast [data-avatar="vale"]')
        .getAttribute("data-pose"),
      "beaten",
    );
    // Full-art cards of who drove Vale off and what was lost, with the
    // words written under them, never on them.
    assert.deepEqual(
      await page.$$eval(".defeat-reveal .card", (cards) =>
        cards.map((card) => card.dataset.card),
      ),
      [opponent, "lamp"],
    );
    await page.locator('.defeat-reveal[data-step="read"]').waitFor();
    assert.equal(
      await page.locator(".defeat-line").textContent(),
      `${nameOf(opponent)} drove you off.`,
    );
    const captions = await page.locator(".defeat-captions").textContent();
    assert.match(captions, /You dropped the Lamp\./);
    assert.match(captions, /You wake at /);
    // The winner and the Lamp are written in their card colours.
    const named = await page.$$eval(".defeat-reveal .card-name", (runs) =>
      runs.map((run) => run.textContent),
    );
    assert.equal(named[0], nameOf(opponent));
    assert.ok(named.includes("Lamp"), named.join());
    assert.doesNotMatch(captions, /Standoffs lost/);
    assert.match(
      await page.locator("#combat-announcement").textContent(),
      new RegExp(`${nameOf(opponent)} drove you off`, "u"),
    );
    // No modal and no buttons: the hand stays locked until the new place.
    assert.equal(
      await page.locator("dialog[open], #travel button:not(.card)").count(),
      0,
    );
    assert.equal(
      await page.locator('.play-dock[data-covered="true"]').count(),
      1,
    );
    assert.equal(await page.locator("#travel.travelling").count(), 0);
    assert.deepEqual(
      await page.$eval("#travel", (veil) => [
        veil.classList.contains("fainting"),
        getComputedStyle(veil).opacity,
        getComputedStyle(veil).backgroundColor,
      ]),
      [true, "1", "rgb(0, 0, 0)"],
      "The scene has faded to black",
    );
    await page.screenshot({
      path: new URL(`defeat-${opponent}-${width}-${motion}.png`, output)
        .pathname,
    });
    // A tap moves on; left alone, the read moves on by itself.
    if (motion === "reduce") {
      assert.equal(
        await page.locator("#travel.travelling").count(),
        0,
        "Reduced motion arrives without an animated travel veil",
      );
    } else {
      await page.mouse.click(width / 2, height / 3);
      // The black lifts slowly and wordless onto the new place.
      await page.locator("#travel.travelling.waking").waitFor();
    }
    await page.locator(".defeat-reveal").waitFor({ state: "detached" });
    const saved = await page.evaluate(
      (key) => JSON.parse(localStorage.getItem(key)),
      key,
    );
    await page.waitForFunction(
      (place) => document.body.dataset.place === place,
      saved.actors.vale.place,
    );
    await page.waitForFunction(
      () => !document.querySelector("#travel.travelling"),
    );
    assert.equal(await page.locator("#travel.fainting").count(), 0);
    // The old hand never shows again over the black: the dock comes back
    // only with the new place's hand, dealt in.
    await page.waitForTimeout(900);
    const afterLoss = await page.evaluate(() => window.afterLoss);
    const hand = await page.evaluate(() =>
      [...document.querySelectorAll("#hand > :not([hidden]) .card")]
        .map((c) => c.dataset.card)
        .join(),
    );
    assert(afterLoss.up.length, "the dock comes back");
    assert(
      afterLoss.up.every((shown) => shown === hand),
      `only the new hand shows: ${[...new Set(afterLoss.up)]} vs ${hand}`,
    );
    assert(afterLoss.dealt.length, "the new hand is dealt in");
    // Each fighter's step and the defeat join Memory as beats.
    await page.evaluate(() =>
      document.querySelector("#history-button").click(),
    );
    const log = await page.locator("#messages").textContent();
    await page.evaluate(() =>
      document.querySelector("#history-dialog").close(),
    );
    assert.ok(log.includes(`${nameOf(opponent)} struck Vale.`));
    assert.match(log, /Vale was beaten and (sent home|fell back to )/);
    assert.match(log, /You came to at /);
    assert.equal(await page.locator(".combat-dim").count(), 0);
    assert.deepEqual(
      await page.$eval("#stage", (stage) => [
        stage.dataset.recede,
        getComputedStyle(stage.querySelector("#backdrop")).opacity,
      ]),
      [undefined, "1"],
      "The new place's painting is whole after the lift",
    );
    assert.equal(
      await page.locator('.play-dock[data-covered="false"]').count(),
      1,
      "The hand unlocks once the new place is drawn",
    );
    await page.waitForTimeout(400);
    assert.match(
      await page.$eval(
        ".play-dock",
        (dock) => getComputedStyle(dock).translate,
      ),
      /^(none|0px)$/u,
      "The hand rises back once the beats end",
    );
    assert.equal(
      await page.locator('.dialogue[data-dropped="false"]').count(),
      1,
      "The dialogue returns with the hand",
    );
    assert.equal(
      await page.locator("#combat-caption:not([hidden])").count(),
      0,
    );
    // Its box kept one width through every beat, whatever the words.
    const widths = await page.evaluate(() => window.captionWidths);
    assert.ok(
      widths.length >= 2 && Math.max(...widths) - Math.min(...widths) < 1,
      `The caption keeps its width ${widths}`,
    );
    const arrivalHost = page.locator('#hand [data-card="keeper"]');
    assert.equal(
      await arrivalHost.getAttribute("data-unrevealed"),
      String(!knownArrival),
      "The arrival preserves the host's saved reveal state",
    );
    if (knownArrival) {
      assert.ok(request, "The revealed arrival host asked for words");
      assert.deepEqual(request.speakers, ["keeper"]);
    } else {
      assert.equal(request, undefined, "A covered arrival host stays quiet");
    }
    await page.screenshot({
      path: new URL(
        `arrival-${opponent}-${width}-${motion}-${knownArrival}.png`,
        output,
      ).pathname,
    });
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth > window.innerWidth,
    );
    assert.equal(overflow, false, "No horizontal scroll");
    report.cancelled = await page.evaluate(async () => {
      const { createCombatView } = await import("/card-game/combat-view.mjs");
      const before = [
        ...document.querySelectorAll("#cast .portrait-body > img"),
      ].map((image) => image.getAttribute("src"));
      const view = createCombatView({
        stage: document.querySelector("#stage"),
        caption: document.querySelector("#combat-caption"),
        announce: document.querySelector("#combat-announcement"),
        reducedMotion: matchMedia("(prefers-reduced-motion: reduce)"),
        revealLine() {},
      });
      const playing = view.play([
        { kind: "guard", actorId: "vale", targetId: "keeper" },
      ]);
      view.cleanup();
      const completed = await playing;
      const after = [
        ...document.querySelectorAll("#cast .portrait-body > img"),
      ].map((image) => image.getAttribute("src"));
      return (
        completed === false &&
        JSON.stringify(before) === JSON.stringify(after) &&
        !document.querySelector("#stage").dataset.combat
      );
    });
    assert.equal(
      report.cancelled,
      true,
      "Cancelling during preload restores the stage without starting late beats",
    );
    assert.deepEqual(report.errors, []);
    report.passed = true;
    await page.close();
  }
} finally {
  await browser.close();
  server.close();
  console.log(JSON.stringify(results, null, 2));
}
