import assert from "node:assert/strict";
import { chromium } from "playwright";
import { createServer } from "../card-game/serve.mjs";
import { dispatchShared } from "../card-game/shared-world.mjs";
import { createWorld, encodeSave } from "../card-game/world.mjs";

// ☰ in each state, at 390 and 1440 (owner, 2026-11-02). Signed out it holds
// only the tools (#1892). Signed in, under the worlds is a row of your
// avatars: the found ones face up, grey while in a world and in colour while
// free, then a card back for each still to find (#1936). "+" is a
// seat-sized card, its glyph centred, level with the row's portraits, even
// when the row has no portrait (a world your avatar left). With everyone
// found + New world stays, and a free avatar offers Bring to that world
// whoever you had there (owner, 2026-11-03). Each world's edge, and the
// toolbar logo's glow, is the world's tier (world-level.mjs): the one played
// from its state, another as this browser last saw it.
const server = createServer();
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ headless: true });
const world = dispatchShared({
  op: "create",
  save: encodeSave(createWorld()),
  seed: 1868,
}).world;
delete world.opening;
world.actors.rue.place = "pond";
// A resident at level 20 makes this world Rare (world-level.mjs).
world.actors.moth.xp = 190;
world.turn = world.revision = 24;
// Seat order: vale, mara, ash, nell, tavi, rue, orin, ada.
const seats = (...held) => held.concat(Array(8 - held.length).fill(0));
const everyone = ["vale", "mara", "ash", "nell", "tavi", "rue", "orin", "ada"];
const playing = everyone.map((id) => Number(id === "rue"));
const snapshot = () => ({
  ...dispatchShared({
    op: "view",
    world,
    actor: "rue",
    claimed: ["rue"],
    present: ["rue"],
  }),
  id: "here",
  version: "full-card-world/3",
  claimed: playing,
  present: playing,
  bound: playing,
  holders: seats(null),
  owner: true,
  now: Date.now(),
  queue: [],
  history: [],
});
const states = {
  "signed-out": { at: "/" },
  // Rue plays here; Tavi is found and free; six still to find.
  "two-found": {
    at: "/?world=here",
    worlds: [
      { id: "here", owner: true, actor: "rue", held: playing, seed: 1868 },
    ],
    unlocked: ["rue", "tavi"],
    tiers: { here: "rare", root: "rare" },
  },
  // At the local table, Tavi left the attic, and everyone is found.
  "all-found-left": {
    at: "/",
    worlds: [
      {
        id: "attic",
        owner: true,
        actor: null,
        bound: "tavi",
        held: seats(0, 0, 0, 0, 1),
        seed: 4,
      },
    ],
    unlocked: everyone,
    cached: { "world:attic": "epic" },
    tiers: { attic: "epic", root: null },
  },
};
const geometry = () => {
  const box = (node) => node && node.getBoundingClientRect();
  const row = box(document.querySelector(".world-slot"));
  const plus = box(document.querySelector(".world-slot .seat-open"));
  const glyph = document.querySelector(".world-slot .seat-open");
  let text = null;
  if (glyph) {
    const range = document.createRange();
    range.selectNodeContents(glyph);
    text = range.getBoundingClientRect();
  }
  const cast = [...document.querySelectorAll(".slot-cast .slot-seat")].map(
    (item) => ({
      avatar: item.dataset.avatar || null,
      lit: item.dataset.lit,
      label: item.querySelector("button")?.getAttribute("aria-label") || null,
    }),
  );
  return {
    slots: document.querySelectorAll(".world-slot").length,
    row: row && { top: row.top, bottom: row.bottom, right: row.right },
    plus: plus && {
      width: plus.width,
      height: plus.height,
      middle: plus.top + plus.height / 2,
      right: plus.right,
    },
    glyph: text && { middle: text.top + text.height / 2 },
    newWorld: Boolean(document.querySelector("#avatar-new-world")),
    cast,
    castLabel: document.querySelector(".slot-cast")?.getAttribute("aria-label"),
    tiers: {
      root: document.documentElement.dataset.worldTier || null,
      ...Object.fromEntries(
        [...document.querySelectorAll(".world-slot")].map((slot) => [
          slot.dataset.slot,
          slot.dataset.worldTier || null,
        ]),
      ),
    },
    edge: getComputedStyle(
      document.querySelector(".world-slot") || document.body,
    ).boxShadow,
    logoGlow: getComputedStyle(
      document.querySelector(".brand-logo") || document.body,
    ).filter,
  };
};
try {
  for (const [width, height] of [
    [390, 844],
    [1440, 900],
  ]) {
    for (const [name, state] of Object.entries(states)) {
      const page = await browser.newPage({
        viewport: { width, height },
        isMobile: width <= 390,
        hasTouch: width <= 390,
        reducedMotion: "reduce",
      });
      page.setDefaultTimeout(10000);
      const errors = [];
      let releases = 0;
      page.on("pageerror", (error) => errors.push(error.message));
      if (state.cached)
        await page.addInitScript((cached) => {
          localStorage.setItem("cosyworld.world-tier", JSON.stringify(cached));
        }, state.cached);
      if (state.worlds) {
        await page.route("**/auth/account", (route) =>
          route.fulfill({ json: { authenticated: true, user_id: "smoke-user", account_revision: 0 } }),
        );
        await page.route(/\/card-game\/shared\/worlds$/, (route) =>
          route.fulfill({
            json: { worlds: state.worlds, unlocked: state.unlocked },
          }),
        );
        await page.route(
          /\/card-game\/shared\/worlds\/here(\/command)?$/,
          (route) => {
            if (route.request().postDataJSON()?.op === "release") releases++;
            return route.fulfill({ json: snapshot() });
          },
        );
      }
      await page.goto(`${origin}${state.at}`);
      await page.waitForFunction(() => document.body.inert === false);
      await page.locator("#toolbar-menu-button").click();
      const menu = page.locator("#world-menu");
      await menu.locator(".menu-tools").waitFor();
      if (state.worlds) await menu.locator(".slot-cast").waitFor();
      await page.waitForFunction(() =>
        [...document.querySelectorAll("#world-menu img")].every(
          (i) => i.complete,
        ),
      );
      const seen = await page.evaluate(geometry);
      if (!state.worlds) {
        assert.equal(seen.slots, 0, `${name}: no world UI signed out`);
        assert.equal(seen.cast.length, 0);
        assert.equal(seen.newWorld, false);
      } else {
        assert.equal(seen.slots, 1, name);
        assert.equal(seen.plus.width, 32, `${name}: + is seat-sized`);
        assert.equal(seen.plus.height, 43, `${name}: + is seat-sized`);
        assert(seen.plus.right <= seen.row.right, `${name}: + inside its row`);
        const rowMiddle = (seen.row.top + seen.row.bottom) / 2;
        assert(
          Math.abs(seen.plus.middle - rowMiddle) <= 1,
          `${name}: + centred`,
        );
        assert(
          Math.abs(seen.glyph.middle - seen.plus.middle) <= 2,
          `${name}: + glyph centred`,
        );
      }
      if (state.tiers) {
        assert.deepEqual(seen.tiers, state.tiers, `${name}: world tiers`);
        const color = { rare: "rgb(190, 130, 255)", epic: "rgb(255, 200, 90)" };
        assert(
          seen.edge.includes(color[state.tiers.here || state.tiers.attic]),
          `${name}: the world's edge is its tier (${seen.edge})`,
        );
        assert.equal(
          seen.logoGlow.includes("drop-shadow"),
          Boolean(state.tiers.root),
          `${name}: the toolbar logo glows past Common (${seen.logoGlow})`,
        );
      }
      if (name === "two-found") {
        assert.equal(seen.newWorld, true);
        assert.deepEqual(
          seen.cast.slice(0, 2).map(({ avatar, lit }) => [avatar, lit]),
          [
            ["rue", "false"],
            ["tavi", "true"],
          ],
        );
        assert.equal(seen.cast[0].label, "Rue, in The Weeping Cellar");
        assert.equal(seen.cast[1].label, "Tavi, free");
        assert.equal(seen.cast.filter((c) => !c.avatar).length, 6);
        assert.equal(seen.castLabel, "Your avatars, 6 still to find");
        // A free avatar is chosen for + New world.
        await menu.locator('.slot-cast [data-avatar="tavi"] button').click();
        assert.equal(
          await menu
            .locator('.slot-cast [data-avatar="tavi"] button')
            .getAttribute("aria-pressed"),
          "true",
        );
        await page.emulateMedia({ reducedMotion: "no-preference" });
        const seat = menu.locator('.world-slot [data-avatar="rue"] button');
        const leave = page.locator("#avatar-leave");
        const panel = page.locator('#action-beat[data-card-tap="hint"]');
        const message = panel.locator(".action-beat-text");
        await seat.click();
        assert.equal(await leave.textContent(), "Tap to finish");
        assert.equal(await leave.getAttribute("aria-label"), "Finish reading");
        await panel
          .locator('.action-beat-text[data-revealing="false"]')
          .waitFor();
        assert.equal(await leave.textContent(), "Tap to leave");
        assert.equal(await leave.getAttribute("aria-label"), "Leave");
        assert.equal(
          await message.textContent(),
          "Rue leaves The Weeping Cellar",
        );
        assert.equal(releases, 0, "reading the message takes no action");
        await page.keyboard.press("Escape");
        await panel.waitFor({ state: "hidden" });
        const showLeave = async () => {
          await page.locator("#toolbar-menu-button").click();
          await seat.click();
        };
        await showLeave();
        await leave.click();
        const handCard = page.locator('#hand [data-card="rue"]');
        await handCard.focus();
        await page.keyboard.press("Enter");
        await panel.waitFor({ state: "hidden" });
        assert.equal(releases, 0, "choosing another card clears Leave");
        await showLeave();
        await leave.click();
        assert.equal(releases, 0, "the first tap finishes the avatar message");
        assert.equal(await leave.getAttribute("data-revealing"), "false");
        const size = await panel.evaluate((el) => ({
          height: el.getBoundingClientRect().height,
          font: getComputedStyle(el.querySelector(".action-beat-text"))
            .fontSize,
          scenes: el.querySelectorAll(".quest-ground").length,
        }));
        assert(size.height <= 96, JSON.stringify(size));
        assert.equal(size.font, "16px");
        assert.equal(size.scenes, 1);
        await page.waitForTimeout(180);
        await page.screenshot({
          path: `output/card-world-menu-leave-${width}.png`,
        });
        await leave.click();
        await page.waitForURL(origin + "/");
        assert.equal(releases, 1, "the second tap leaves once");
      }
      if (name === "all-found-left") {
        assert.equal(seen.newWorld, true);
        assert.equal(seen.cast.length, 8);
        assert(seen.cast.every((c) => c.avatar && c.lit === "true"));
        assert.equal(seen.castLabel, "Your avatars");
        // Vale may go where Tavi was; Tavi would stay as a resident.
        await menu.locator('.slot-cast [data-avatar="vale"] button').click();
        const bring = page.locator("#avatar-bring");
        assert.equal(await bring.count(), 0);
        await menu.locator(".seat-open:enabled").first().click();
        assert.match(await bring.getAttribute("aria-label"), /^Bring to \S/);
        assert.equal(await bring.isEnabled(), true);
      }
      await page.screenshot({
        path: `output/card-world-menu-${name}-${width}.png`,
      });
      assert.deepEqual(errors, []);
      await page.close();
    }
  }
  console.log(
    "World menu: tools only signed out; signed in, a centred seat-sized + and your avatars face up (grey in a world) before card backs, and each world edged in its tier, at 390 and 1440.",
  );
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
