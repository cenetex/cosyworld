// Waking on the table (sleep spec §2 and §3). A long rest halfway to a level
// goes dark with only the dreamer, shows the DREAM card, "Dreaming…" and the
// dream, then opens on daylight at dawn; no quest is dealt on waking. An
// ordinary long rest shows no dream card: the stage fades, holds black and
// opens on night at dusk. Frames go to COSYWORLD_SLEEP_FRAMES when set.
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { chromium } from "playwright";
import { createServer } from "../card-game/serve.mjs";
import { createWorld, encodeSave } from "../card-game/world.mjs";
import { halfwayXp } from "../card-game/want.mjs";
import { availableCards } from "../card-game/cards.mjs";
import {
  readyActionButton,
  selectCard,
  smokeWidths,
} from "./card-browser-helpers.mjs";

const server = createServer();
await new Promise((done) => server.listen(0, "127.0.0.1", done));
const origin = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ headless: true });
const output = resolve(
  process.env.COSYWORLD_SLEEP_FRAMES || "output/card-sleep-dream",
);
await mkdir(output, { recursive: true });
const WAKE_LINE = "I wake, and the attic is still warm.";
const DREAM = "I dreamt of a carved box by the cottage fire, and it was open.";

async function wake(width, { halfway, reduced = false, replace = null }) {
  const page = await browser.newPage({
    viewport: { width, height: width === 390 ? 844 : 900 },
    reducedMotion: reduced ? "reduce" : "no-preference",
    hasTouch: width === 390,
  });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.setDefaultTimeout(20000);
  // Vale sleeps in the attic: from 31 to dawn (48) with experience halfway to
  // the next level, or from 6 to dusk (24) with none.
  const world = createWorld();
  world.actors.vale.place = "attic";
  world.turn = halfway ? 30 : 5;
  world.revision = Math.max(world.revision, world.turn);
  world.actors.vale.xp = halfway ? halfwayXp(1) : 0;
  world.actors.vale.level = 1;
  world.actors.vale.want = null;
  world.actors.moth.want = null;
  world.actors.keeper.want = null;
  world.items.lamp.holder = "station";
  world.items.lamp.lit = false;
  const seen = [...new Set([...availableCards(world), "vale", "attic"])];
  await page.route("**/card-game/text", (route) => {
    const c = JSON.parse(route.request().postData());
    route.fulfill({
      json: {
        revision: c.revision,
        model: "fixture",
        entries: [
          {
            id: c.speakers[0],
            text:
              c.rest === "long" ? WAKE_LINE : "I sit a while by the mirror.",
          },
        ],
        omitted: c.entities
          .filter((e) => e.id !== c.speakers[0])
          .map((e) => e.id),
      },
    });
  });
  // Keep Dreaming… in front until the pending cues have been checked.
  const { promise: dreamWords, resolve: showDream } = Promise.withResolvers();
  const { promise: reflectionDone, resolve: finishReflection } =
    Promise.withResolvers();
  await page.route("**/card-game/reflections", async (route) => {
    const c = JSON.parse(route.request().postData());
    if (halfway && c.rest === "long") await dreamWords;
    await route.fulfill({
      json: {
        revision: c.revision,
        reflections:
          c.rest === "long"
            ? [
                {
                  id: "vale",
                  reflection: {
                    thought: "Something waits for me past the pond.",
                    persona: "I am Vale, and I keep going.",
                    dream: DREAM,
                  },
                },
              ]
            : [],
      },
    });
    if (c.rest === "long") finishReflection();
  });
  await page.addInitScript(
    ({ save, seen }) => {
      localStorage.setItem("cosyworld.reflected-shore.v1.dream", save);
      localStorage.setItem(
        "cosyworld.reflected-shore.v1.dream.seen",
        JSON.stringify(seen),
      );
      localStorage.setItem("cosyworld.dialogue.sound", "off");
      // Every beat the body shows, and every label the front card shows.
      window.sleepBeats = [];
      window.frontBeats = [];
      window.wakeLineShown = false;
      addEventListener("DOMContentLoaded", () => {
        new MutationObserver(() => {
          const beat = document.body.dataset.sleep || "done";
          if (window.sleepBeats.at(-1) !== beat) window.sleepBeats.push(beat);
          const row = document.querySelector("#speech-row");
          const front = row && !row.hidden ? row.dataset.beat : "";
          if (front && window.frontBeats.at(-1) !== front)
            window.frontBeats.push(front);
          if (
            document
              .querySelector(".dialogue")
              ?.textContent.includes("I wake, and the attic")
          )
            window.wakeLineShown = true;
        }).observe(document.body, {
          attributes: true,
          subtree: true,
          childList: true,
          characterData: true,
        });
      });
    },
    { save: encodeSave(world), seen },
  );
  const touch = width === 390;
  const name = `${halfway ? "dream" : "dusk"}-${width}${reduced ? "-reduced" : ""}${replace ? `-${replace}` : ""}`;
  let frame = 0;
  const shot = (label) =>
    page.screenshot({
      path: resolve(
        output,
        `${name}-${String(++frame).padStart(2, "0")}-${label}.png`,
      ),
    });
  const beat = (value) =>
    page.waitForFunction((v) => document.body.dataset.sleep === v, value);
  const play = readyActionButton(page, "wait");
  const advance = page.locator("#dialogue-advance");
  const catcher = page.locator(".sleep-catcher");
  const savedTurn = () =>
    page.evaluate(
      () =>
        JSON.parse(localStorage.getItem("cosyworld.reflected-shore.v1.dream"))
          .turn,
    );
  const cue = async (hint, label) => {
    await page.waitForFunction((value) => {
      const el = document.querySelector("#speech-hint");
      return !el.hidden && el.textContent === value;
    }, hint);
    assert.equal(await advance.getAttribute("aria-label"), label);
    const aboveHand = await page.locator("#speech-hint").evaluate((el) => {
      const { right, top, height } = el.getBoundingClientRect();
      const panel = document
        .elementsFromPoint(right - 6, top + height / 2)
        .find((node) => node.closest(".dialogue, .play-dock"));
      return Boolean(panel?.closest(".dialogue"));
    });
    assert(aboveHand, "the hand does not cover the Dream cue");
  };
  const settled = () =>
    page.waitForFunction(
      () => document.querySelector("#hand").dataset.cooling === "false",
    );
  try {
    await page.goto(`${origin}/?table=dream`);
    await page.waitForFunction(() => document.body.inert === false);
    assert.equal(
      await page.locator("#hand .want-frame > .want-card").count(),
      0,
      "the old routine REST card leaves the hand",
    );
    await selectCard(page, "vale", { touch });
    await play.click();
    await settled();
    await page.waitForFunction(() => !document.body.dataset.sleep);
    await shot("before");
    await selectCard(page, "vale", { touch });
    await play.waitFor();
    assert.equal(await play.getAttribute("aria-label"), "Sleep");
    await play.click();
    if (!reduced) {
      await page.waitForTimeout(450);
      await shot("fade");
    }
    await beat("held");
    await shot("held");
    if (halfway) {
      await beat("dreaming");
      await cue("Tap to stop waiting", "Stop waiting");
      assert.equal(await page.locator("#speaker").textContent(), "Dream");
      assert.match(
        await page.locator("#story-status").textContent(),
        /Dreaming…/,
      );
      // Only the dreamer stays on the dark stage.
      assert.deepEqual(
        await page.evaluate(() =>
          [...document.querySelectorAll("#cast > .portrait")]
            .filter((f) => getComputedStyle(f).opacity !== "0")
            .map((f) => f.dataset.avatar),
        ),
        ["vale"],
      );
      await shot("dreaming");
      if (replace) {
        // Exercise the real app boundary while its reflection is still away.
        if (replace === "reset") {
          await page.locator("#new-game").evaluate((button) => button.click());
          await page.locator("#confirm-reset").click();
        } else {
          await page.evaluate((save) => {
            const key = "cosyworld.reflected-shore.v1.dream";
            localStorage.setItem(key, save);
            dispatchEvent(new StorageEvent("storage", { key, newValue: save }));
          }, encodeSave(world));
        }
        await page.waitForFunction(() => !document.body.dataset.sleep);
        showDream();
        await Promise.race([
          reflectionDone,
          page
            .waitForTimeout(20_000)
            .then(() => assert.fail("The old reflection did not settle.")),
        ]);
        await page.evaluate(
          () =>
            new Promise((done) =>
              requestAnimationFrame(() => requestAnimationFrame(done)),
            ),
        );
        assert.equal(await page.locator(".sleep-catcher").isHidden(), true);
        assert.equal(await page.locator("[data-dreamer]").count(), 0);
        assert.equal(
          await page.locator('#speech-row[data-beat="dream"]').count(),
          0,
        );
        assert.equal(
          await page.evaluate(() => document.body.dataset.sleepDream),
          "false",
        );
        assert.equal(await savedTurn(), replace === "reset" ? 0 : world.turn);
        assert.deepEqual(errors, []);
        return;
      }
      if (touch) await catcher.tap();
      else await catcher.click();
      await cue("Tap to confirm", "Confirm");
      assert.match(
        await page.locator("#story-status").textContent(),
        /Dreaming…/,
      );
      await page.keyboard.press("Escape");
      await cue("Tap to stop waiting", "Stop waiting");
      showDream();
      await beat("dream");
      if (!reduced) {
        await cue("Tap to finish", "Finish reading");
        await page.keyboard.press("Enter");
      }
      await cue("Tap to continue", "Continue the dream");
      const turn = await savedTurn();
      await page.waitForTimeout(2300);
      assert.equal(
        await page.evaluate(() => document.body.dataset.sleep),
        "dream",
      );
      assert.equal(await savedTurn(), turn);
      assert.equal(await page.locator("#dialogue-text").textContent(), DREAM);
      await cue("Tap to continue", "Continue the dream");
      await shot("dream");
      // Activate the same button a screen reader uses, without the catcher.
      await advance.evaluate((button) => button.click());
    }
    await beat("light");
    await page.waitForTimeout(reduced ? 100 : 1100);
    await shot("light");
    await page.waitForFunction(() => !document.body.dataset.sleep, null, {
      timeout: 30000,
    });
    await page.waitForTimeout(400);
    await shot("after");
    const beats = await page.evaluate(() => window.sleepBeats);
    const order = halfway
      ? ["fade", "held", "enter", "dream", "light", "done"]
      : ["fade", "held", "light", "done"];
    assert.deepEqual(
      beats.filter((b) => order.includes(b)).slice(-order.length),
      order,
      `beats ${beats}`,
    );
    const period = await page.evaluate(
      () => document.querySelector("#stage").dataset.period,
    );
    if (halfway) {
      assert.match(period, /morning/, "a dawn wake opens on daylight");
      // The dream card stays in the beat stack, in front, and Vale never
      // spoke on waking.
      assert.equal(
        await page.evaluate(
          () => document.querySelector("#speech-row").dataset.beat,
        ),
        "dream",
      );
      assert.equal(await page.evaluate(() => window.wakeLineShown), false);
      // No quest is dealt on waking: the avatar's stack holds none.
      assert.equal(
        await page.evaluate(
          () =>
            document.querySelectorAll("#hand .quest-fold, #hand .want-frame > .want-card")
              .length,
        ),
        0,
        "no quest is dealt on waking",
      );
    } else {
      assert.match(period, /night/, "a dusk wake opens on night");
      assert.equal(
        (await page.evaluate(() => window.frontBeats)).includes("dream"),
        false,
        "an ordinary rest shows no dream card",
      );
    }
    assert.deepEqual(errors, []);
  } finally {
    showDream();
    await page.close();
  }
}

try {
  for (const width of smokeWidths([390, 1440])) {
    await wake(width, { halfway: true });
    await wake(width, { halfway: false });
    for (const replace of ["reset", "storage"])
      await wake(width, { halfway: true, reduced: true, replace });
    console.log(`Sleep dream passed at ${width}px.`);
  }
  await wake(390, { halfway: true, reduced: true });
  console.log("Sleep dream passed under reduced motion.");
} finally {
  await browser.close();
  server.close();
}
