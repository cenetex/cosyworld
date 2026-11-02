// The passkey panel says what a passkey keeps before one is made, sign-in
// says it in one line, and both link to the Privacy page, which Settings
// also links (#2052). The Rust test in card_game.rs checks /download.
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { chromium } from "playwright";
import { createServer } from "../card-game/serve.mjs";
import { createWorld, encodeSave } from "../card-game/world.mjs";

const output = process.env.PRIVACY_SHOTS || "output/card-privacy";
await mkdir(output, { recursive: true });
const server = createServer();
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const save = encodeSave(createWorld());
const browser = await chromium.launch({ headless: true });
try {
  for (const [width, height] of [
    [1440, 900],
    [390, 844],
  ]) {
    const page = await browser.newPage({ viewport: { width, height } });
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    // A virtual authenticator stands in for the device, as the shared smoke does.
    const cdp = await page.context().newCDPSession(page);
    await cdp.send("WebAuthn.enable");
    await cdp.send("WebAuthn.addVirtualAuthenticator", {
      options: {
        protocol: "ctap2",
        transport: "internal",
        hasUserVerification: true,
      },
    });
    let account = { authenticated: false };
    await page.route("**/auth/account", (route) =>
      route.fulfill({ json: account }),
    );
    const table = `privacy-${width}`;
    await page.addInitScript(
      ({ key, save }) => {
        if (!localStorage.getItem(key)) localStorage.setItem(key, save);
      },
      { key: `cosyworld.reflected-shore.v1.${table}`, save },
    );
    await page.goto(`${origin}/?table=${table}`);
    await page.locator("#toolbar-menu-button").click();
    await page.locator("#shared-worlds-button").click();
    const lobby = page.locator("#shared-lobby");
    const notice = lobby.locator(".privacy-notice");
    await notice.waitFor();
    const text = await notice.textContent();
    for (const phrase of ["log in", "public half", "OpenRouter", "type"])
      assert.ok(text.includes(phrase), `${phrase} at ${width}px`);
    const links = notice.locator("a");
    assert.deepEqual(
      await links.evaluateAll((all) => all.map((a) => a.getAttribute("href"))),
      ["/download", "/privacy"],
    );
    // The notice is read before the passkey buttons.
    const [noticeBox, createBox] = await Promise.all([
      notice.boundingBox(),
      lobby.getByRole("button", { name: "Create a passkey" }).boundingBox(),
    ]);
    assert.ok(noticeBox.y < createBox.y, `notice first at ${width}px`);
    await page.screenshot({ path: `${output}/passkey-${width}x${height}.png` });
    await lobby.getByRole("button", { name: "Close" }).click();

    // Settings links the Privacy page.
    await page.locator("#toolbar-menu-button").click();
    await page.locator("#menu-button").click();
    await page.locator("#privacy-link").waitFor();
    await page.screenshot({ path: `${output}/settings-${width}.png` });

    // A members-only server's sign-in lock shows the one-line notice.
    account = { authenticated: false, members_only: true };
    await page.reload();
    const lock = page.locator("#members-lock .privacy-notice");
    await lock.waitFor();
    assert.match(await lock.textContent(), /^Signing in keeps your avatars/u);
    await page.screenshot({ path: `${output}/sign-in-${width}x${height}.png` });

    // The Privacy page renders on its own, without the table.
    await page.goto(`${origin}/privacy`);
    await page.getByRole("heading", { name: "Privacy", level: 1 }).waitFor();
    for (const heading of [
      "Passkeys and your account",
      "AI providers",
      "Play on your own computer",
      "Deleting your data",
      "Contact",
    ])
      await page.getByRole("heading", { name: heading }).waitFor();
    assert.ok(
      (await page.evaluate(() => document.documentElement.scrollWidth)) <=
        width,
      `no sideways scroll at ${width}px`,
    );
    await page.screenshot({
      path: `${output}/privacy-${width}x${height}.png`,
      fullPage: true,
    });
    assert.deepEqual(errors, [], `page errors at ${width}px`);
    await page.close();
  }
  console.log("Privacy notice, sign-in line and Privacy page passed.");
} finally {
  await browser.close();
  server.close();
}
