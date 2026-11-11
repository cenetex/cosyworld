// Settings is the game's own hand: group cards hold their settings as a
// place holds its things (settings-cards.mjs). You opens fanned, so Privacy
// is one tap away; a group's first setting peeks out behind it; a tap fans a
// group and folds the open one; a chosen setting puts its action in the
// context button, a press does it and folds the group back, a destructive one
// only on a second press; with nothing chosen the button closes Settings.
// Signed out, then signed in; desktop and phone widths, without a sideways
// scroll. Opening, the play hand falls away and the settings are dealt
// after it; closing deals the play hand back. SETTINGS_SHOTS=<dir> saves
// screenshots.
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { chromium } from "playwright";
import { createServer } from "../card-game/serve.mjs";
import {
  labelProblems,
  pressSetting,
  splitNameWords,
  tapCard,
} from "./card-browser-helpers.mjs";

const shots = process.env.SETTINGS_SHOTS;
if (shots) await mkdir(shots, { recursive: true });
const server = createServer();
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ headless: true });
const setting = (page, id) => page.locator(`[data-setting="${id}"]`);
const label = (page, id) => setting(page, id).getAttribute("aria-label");
const shown = (page, id) => setting(page, id).isVisible();
const expanded = (page, id) => setting(page, id).getAttribute("aria-expanded");
const button = (page) => page.locator("#card-actions button").first();
try {
  for (const [width, height, signedIn] of [
    [1440, 900, false],
    [390, 844, true],
    [320, 568, false],
  ]) {
    const page = await browser.newPage({ viewport: { width, height } });
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    // Every card that rises into a hand, and every ghost that falls.
    await page.addInitScript(() => {
      window.dealt = [];
      const animate = Element.prototype.animate;
      Element.prototype.animate = function (frames, options) {
        const delay = options?.delay ?? 0;
        if (frames?.[0]?.opacity === 0 && this.matches(".hand > .card-frame"))
          window.dealt.push([this.parentElement.id, delay]);
        if (this.matches(".beat-ghost")) window.dealt.push(["ghost", delay]);
        return animate.call(this, frames, options);
      };
    });
    const dealt = () => page.evaluate(() => window.dealt.splice(0));
    await page.route("**/auth/account", (route) =>
      route.fulfill({ json: { authenticated: signedIn, user_id: signedIn ? "smoke-user" : null, account_revision: signedIn ? 0 : null } }),
    );
    await page.goto(`${origin}/?table=settings-${width}`);
    await page.locator("#hand .card").first().waitFor();
    await page.waitForTimeout(300);
    await page.locator("#toolbar-menu-button").click();
    await dealt();
    await page.locator("#menu-button").click();
    await page.locator("#settings-hand .card").first().waitFor();
    assert.equal(await page.locator("#hand").isVisible(), false);
    const opened = await dealt(),
      fell = opened.filter(([where]) => where === "ghost"),
      rose = opened.filter(([where]) => where === "settings-hand");
    assert(fell.length && rose.length, `open: ${JSON.stringify(opened)}`);
    assert(
      Math.min(...rose.map(([, d]) => d)) >=
        Math.max(...fell.map(([, d]) => d)),
      "the settings are dealt after the play hand falls",
    );
    // The hand runs You, Sound, Play, World, You fanned with Privacy first.
    const groups = await page
      .locator("#settings-hand .card-frame:not([data-holder]) > .card")
      .evaluateAll((cards) => cards.map((c) => c.dataset.setting));
    assert.deepEqual(groups, ["you", "sound", "play", "world"]);
    assert.equal(await expanded(page, "you"), "true");
    const youHolds = await page
      .locator('#settings-hand [data-holder="you"] > .card')
      .evaluateAll((cards) => cards.map((c) => c.dataset.setting));
    assert.equal(youHolds[0], "privacy");
    assert.equal(await button(page).textContent(), "Close settings");
    // Privacy is one tap away.
    await tapCard(setting(page, "privacy"));
    assert.equal(await button(page).textContent(), "Open privacy");
    await tapCard(setting(page, "privacy"));
    assert.equal(await button(page).textContent(), "Close settings");
    // A folded group shows its first setting peeking out behind it.
    const sound = setting(page, "sound").locator("..");
    assert.equal(await sound.locator(".held-preview").count(), 1);
    assert.equal(await expanded(page, "sound"), "false");
    assert.equal(await shown(page, "music"), false);
    if (width > 700) {
      // A pointer lifts the group and its peek together.
      await setting(page, "sound").hover();
      await page.waitForFunction(
        () =>
          getComputedStyle(
            document.querySelector('[data-setting="sound"]').parentElement,
          ).translate === "0px -8px",
      );
    }
    // A tap fans Sound open and folds You.
    await tapCard(setting(page, "sound"));
    assert.equal(await expanded(page, "sound"), "true");
    assert.equal(await expanded(page, "you"), "false");
    assert.equal(await shown(page, "privacy"), false);
    assert.equal(await sound.locator(".held-preview").isVisible(), false);
    assert.equal(await label(page, "music"), "Music, on");
    // Choose, read the button, press it: the face follows, the group folds.
    await tapCard(setting(page, "music"));
    assert.deepEqual(await splitNameWords(page), [], `${width}px names`);
    const press = page.locator("#setting-music");
    assert.equal(await press.textContent(), "Turn music off");
    if (shots) await page.screenshot({ path: `${shots}/music-${width}.png` });
    await press.click();
    assert.equal(await label(page, "music"), "Music, off");
    assert.equal(
      await setting(page, "music").getAttribute("data-lit"),
      "false",
    );
    assert.equal(await expanded(page, "sound"), "false");
    assert.equal(await shown(page, "music"), false);
    assert.equal(await button(page).textContent(), "Close settings");
    // Next tip shows the next tip in place: Controls stays chosen.
    await pressSetting(page, "controls");
    const tipText = () => page.locator(".action-beat-heading").textContent();
    const tips = [await tipText()];
    for (let i = 0; i < 2; i++) {
      await page.locator("#setting-controls").click();
      tips.push(await tipText());
      assert.equal(await button(page).textContent(), "Next tip");
      assert.equal(await expanded(page, "play"), "true");
    }
    assert.equal(new Set(tips).size, 3, `three tips: ${tips}`);
    await tapCard(setting(page, "controls"));
    await tapCard(setting(page, "play"));
    assert.equal(await button(page).textContent(), "Close settings");
    // Radio is offered in World and uses the same pack action in every viewport.
    await pressSetting(page, "pack-radio");
    await page
      .locator('[data-setting="pack-radio"][data-lit="false"]')
      .waitFor({
        state: "attached",
      });
    await pressSetting(page, "pack-radio");
    await page.locator('[data-setting="pack-radio"][data-lit="true"]').waitFor({
      state: "attached",
    });
    // A pack switches off and dims, and on again.
    await pressSetting(page, "pack-sea");
    await page.locator('[data-setting="pack-sea"][data-lit="false"]').waitFor({
      state: "attached",
    });
    // Hoppy Cat, reached only by the Sea, dims with it and says why.
    const hoppy = setting(page, "pack-hoppy");
    assert.equal(await hoppy.getAttribute("data-lit"), "false");
    await tapCard(setting(page, "world"));
    await tapCard(hoppy);
    assert.equal(
      await page.locator("#setting-pack-hoppy").textContent(),
      "Reached by The Wine-Dark Sea",
    );
    await pressSetting(page, "pack-sea");
    await page.locator('[data-setting="pack-sea"][data-lit="true"]').waitFor({
      state: "attached",
    });
    // Every card is a place card: the quest card's place painting, its name
    // at the top where the quest sets its verb, broken only between words.
    await tapCard(setting(page, "world"));
    const pack = setting(page, "pack-sea");
    assert.equal(await pack.locator(".quest-screen .quest-ground").count(), 1);
    assert.equal(
      await pack.locator(".quest-head .quest-verb").textContent(),
      "The Wine-Dark Sea",
    );
    assert.equal(
      await page.locator("#settings-hand .card:not(.want-card)").count(),
      0,
    );
    assert.match(
      await page.locator(".settings-scene").getAttribute("src"),
      /moonlit-cozy-fantasy-workbench/,
    );
    // A pack name under the next card's overlap may take three lines
    // where system-ui runs wide (Linux), as on phones.
    assert.deepEqual(
      await page.evaluate(labelProblems, { root: "#settings-hand", lines: 3 }),
      [],
      `${width} labels`,
    );
    if (shots) await page.screenshot({ path: `${shots}/world-${width}.png` });
    // Sign out, signed in, or New game, signed out, waits for a second press.
    const [risky, confirm] = signedIn
      ? ["account", "Tap again to sign out"]
      : ["new-game", "Tap again to replace this world"];
    await pressSetting(page, risky);
    assert.equal(
      await page.locator(`#setting-${risky}`).textContent(),
      confirm,
    );
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
      true,
      `no sideways scroll at ${width}px`,
    );
    // Escape unchooses; Close settings brings the play hand back.
    await page.keyboard.press("Escape");
    assert.equal(await button(page).textContent(), "Close settings");
    await dealt();
    await button(page).click();
    await page.locator("#hand .card").first().waitFor();
    assert(
      (await dealt()).some(([where]) => where === "hand"),
      "the play hand is dealt back",
    );
    assert.equal(await page.locator("#settings-hand").isVisible(), false);
    // The same hand accepts an author's root card and a group of cards.
    // Its supplied beat adapter records the actions for this contract check.
    await page.evaluate(async () => {
      const { installCardWorkspace } = await import(
        "/card-game/settings-screen.mjs"
      );
      const art = "assets/settings/workbench-letter.png";
      window.workspaceEvents = [];
      window.workspaceName = "World idea";
      window.authorWorkspace = installCardWorkspace({
        label: "Authoring",
        cards: () => [
          { id: "idea", name: window.workspaceName, art, lit: true },
          { id: "avatars", name: "Avatars", art, lit: true, group: true },
          {
            id: "character",
            name: "Character",
            art,
            lit: true,
            holder: "avatars",
          },
        ],
        describe: (cards, chosen) => ({
          name: cards.find((c) => c.id === chosen)?.name || "Authoring",
          note: chosen
            ? "Write the world in your own words."
            : "Choose a card.",
          actions: chosen
            ? [{ label: "Create", run: "create", stays: true }]
            : [],
        }),
        actionBeat: {
          show: (beat) => {
            window.workspaceBeat = beat;
          },
          clear: () => window.workspaceEvents.push("cleared"),
        },
        run: async (action, context) => {
          window.workspaceEvents.push([action.run, context.cardId]);
          if (window.deferWorkspace)
            await new Promise((resolve, reject) => {
              window.settleWorkspace = { resolve, reject };
            });
          if (context.cardId === "character")
            throw new Error("Try this character again.");
          window.workspaceName = "Private world";
        },
        onClose: () => window.workspaceEvents.push("closed"),
      });
      window.authorWorkspace.open();
    });
    assert.equal(
      await page.locator("#settings-screen").getAttribute("aria-label"),
      "Authoring",
    );
    await tapCard(setting(page, "idea"));
    assert.equal(await label(page, "idea"), "World idea");
    assert.equal(
      await setting(page, "idea").getAttribute("aria-pressed"),
      "true",
    );
    assert.equal(
      await page.evaluate(() => window.workspaceBeat.note),
      "Write the world in your own words.",
    );
    await page.evaluate(() => window.workspaceBeat.buttons[0].run());
    assert.equal(await label(page, "idea"), "Private world");
    assert.deepEqual(await page.evaluate(() => window.workspaceEvents), [
      ["create", "idea"],
    ]);
    await tapCard(setting(page, "avatars"));
    await tapCard(setting(page, "character"));
    await page.evaluate(() => window.workspaceBeat.buttons[0].run());
    assert.equal(
      await page.evaluate(() => window.workspaceBeat.info),
      "Try this character again.",
    );
    // The earlier settings controller also receives Escape; ownership keeps
    // the active hand open while its selected card is lowered.
    await page.keyboard.press("Escape");
    assert.equal(await page.locator("#settings-screen").isVisible(), true);
    await page.keyboard.press("Escape");
    assert.equal(await page.locator("#settings-screen").isVisible(), false);
    assert.deepEqual(await page.evaluate(() => window.workspaceEvents), [
      ["create", "idea"],
      ["create", "character"],
      "cleared",
      "closed",
    ]);
    await page.evaluate(() => window.authorWorkspace.refresh());
    assert.equal(await page.locator("#settings-screen").isVisible(), false);
    // A real card starts an operation; closing and reopening ends only its
    // presentation ownership. Late success and failure leave the new beat,
    // selected card and keyboard focus alone at every viewport.
    for (const outcome of ["success", "failure"]) {
      await page.evaluate(() => {
        window.deferWorkspace = true;
        window.authorWorkspace.open();
      });
      await tapCard(setting(page, "idea"));
      await page.evaluate(() => {
        window.pendingWorkspace = window.workspaceBeat.buttons[0].run();
        window.authorWorkspace.close();
        window.authorWorkspace.close();
        window.authorWorkspace.open();
      });
      await tapCard(setting(page, "avatars"));
      await tapCard(setting(page, "character"));
      assert.equal(await label(page, "character"), "Character");
      await page.evaluate(async (result) => {
        const beat = window.workspaceBeat;
        const focus = document.activeElement;
        if (focus?.dataset.setting !== "character")
          throw new Error("The selected card must own keyboard focus.");
        if (result === "success") window.settleWorkspace.resolve();
        else window.settleWorkspace.reject(new Error("Old opening failed"));
        await window.pendingWorkspace;
        if (window.workspaceBeat !== beat)
          throw new Error("An old operation redrew the current beat.");
        if (document.activeElement !== focus)
          throw new Error("An old operation moved keyboard focus.");
      }, outcome);
      assert.equal(
        await setting(page, "character").getAttribute("aria-pressed"),
        "true",
      );
      await page.evaluate(() => window.authorWorkspace.close());
    }
    assert.deepEqual(errors, []);
    await page.close();
  }
  console.log("Settings hand: fan, choose, press, fold and close at 3 widths.");
} finally {
  await browser.close();
  server.close();
}
