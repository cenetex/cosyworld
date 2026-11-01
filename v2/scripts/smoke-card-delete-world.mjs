import assert from "node:assert/strict";
import { chromium } from "playwright";
import { createServer } from "../card-game/serve.mjs";
import { createAvatarWorld, avatarSlot } from "../card-game/avatar-world.mjs";
import { encodeSave } from "../card-game/world.mjs";
import { worldName } from "../card-game/world-name.mjs";

// Delete world (#1793, #1828): deleting another avatar's local world only
// removes it from ☰; deleting the world being played opens a fresh world for
// the same avatar, as New game does. It never sends the player into another
// avatar's shared world, which here fails to open (owner bug 2026-11-01).
const server = createServer();
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({
    viewport: { width: 390, height: 844 },
    reducedMotion: "reduce",
  });
  page.setDefaultTimeout(10000);
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("**/auth/account", (route) =>
    route.fulfill({ json: { authenticated: true } }),
  );
  await page.route(/\/card-game\/shared\/worlds$/, (route) =>
    route.fulfill({
      json: { worlds: [{ id: "elsewhere", actor: "mara", seed: 7 }] },
    }),
  );
  let sharedOpened = false;
  await page.route(/\/card-game\/shared\/worlds\/elsewhere/, (route) => {
    sharedOpened = true;
    route.fulfill({ status: 503, json: { error: "Reconnecting." } });
  });
  const ash = createAvatarWorld("ash", 42);
  await page.addInitScript(
    ([slot, save]) => {
      if (!sessionStorage.getItem("seeded")) {
        sessionStorage.setItem("seeded", "1");
        localStorage.setItem(slot, save);
        localStorage.setItem(`${slot}.bak`, save);
      }
    },
    [avatarSlot("ash"), encodeSave(ash)],
  );
  await page.goto(`${origin}/?avatar=vale`);
  await page.waitForFunction(() => document.body.inert === false);
  await page.waitForFunction(() =>
    localStorage.getItem("cosyworld.reflected-shore.v1"),
  );
  const valeSeed = () =>
    page.evaluate(
      () =>
        JSON.parse(localStorage.getItem("cosyworld.reflected-shore.v1") || "{}")
          .run?.seed,
    );
  const before = await valeSeed();
  const menu = page.locator("#world-menu");
  await page.locator("#toolbar-menu-button").click();
  await menu.waitFor({ state: "visible" });

  // Another avatar's world: gone from ☰, and the table stays put.
  const ashRow = menu.locator('[data-avatar="ash"].avatar-row');
  assert.match(await ashRow.innerText(), new RegExp(worldName(ash.run.seed)));
  await ashRow.locator(".avatar-face").click();
  const deleteAsh = ashRow.locator(".avatar-delete");
  await deleteAsh.click();
  assert.match(await deleteAsh.innerText(), /^Delete .+ and its progress\?$/);
  await deleteAsh.click();
  await page.waitForFunction(
    () =>
      document.querySelector('[data-avatar="ash"].avatar-row small')
        ?.textContent === "not in a world",
  );
  assert.match(await menu.locator(".avatar-status").innerText(), /is gone\./);
  assert.equal(new URL(page.url()).search, "?avatar=vale");
  assert.deepEqual(
    await page.evaluate(
      (slot) => [
        localStorage.getItem(slot),
        localStorage.getItem(`${slot}.bak`),
      ],
      avatarSlot("ash"),
    ),
    [null, null],
  );
  assert.equal(await valeSeed(), before);

  // The world being played: a fresh world for the same avatar, no detour.
  const here = menu.locator('[data-here="true"]');
  await here.locator(".avatar-face").click();
  const deleteHere = here.locator(".avatar-delete");
  await deleteHere.click();
  await Promise.all([page.waitForEvent("load"), deleteHere.click()]);
  await page.waitForFunction(() => document.body.inert === false);
  assert.equal(new URL(page.url()).search, "?avatar=vale");
  await page.waitForFunction(() =>
    localStorage.getItem("cosyworld.reflected-shore.v1"),
  );
  assert.notEqual(await valeSeed(), before);
  assert.equal(
    await page.evaluate(() =>
      localStorage.getItem("cosyworld.reflected-shore.v1.bak"),
    ),
    null,
  );
  assert.equal(sharedOpened, false, "no detour into another avatar's world");
  assert.equal(await page.locator("#shared-lobby[open]").count(), 0);
  assert.equal(await page.locator("#play-status").innerText(), "");
  assert.deepEqual(errors, []);
  console.log(
    "Delete world: another avatar's world leaves ☰; the world being played starts fresh.",
  );
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
