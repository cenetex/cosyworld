#!/usr/bin/env node
import assert from "node:assert/strict";
import { chromium } from "playwright";

const target = new URL(process.env.COSYWORLD_SMOKE_URL || "http://localhost:3102/");
assert(["localhost", "127.0.0.1"].includes(target.hostname), "Passkey smoke uses a local test world");
target.hostname = "localhost";
target.search = "?reset=1";

const browser = await chromium.launch({ headless: true });
async function device(credentials = []) {
  const context = await browser.newContext();
  const page = await context.newPage();
  const cdp = await context.newCDPSession(page);
  await cdp.send("WebAuthn.enable");
  const { authenticatorId } = await cdp.send("WebAuthn.addVirtualAuthenticator", {
    options: {
      protocol: "ctap2", transport: "internal", hasResidentKey: true,
      hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true,
    },
  });
  for (const credential of credentials) {
    await cdp.send("WebAuthn.addCredential", { authenticatorId, credential });
  }
  return { context, page, cdp, authenticatorId };
}

try {
  const first = await device();
  await first.page.goto(target.toString());
  await first.page.waitForFunction(() => Boolean(state?.primary_action));
  await first.page.evaluate(async () => { await createAvatar(); });
  const avatarId = await first.page.evaluate(() => actorId);
  assert(avatarId > 0);
  await first.page.evaluate(async () => { await registerPasskey(false); });
  assert.deepEqual(await first.page.evaluate(() => ({
    authenticated: identity.authenticated, actorId, wallets: identity.wallets.length,
  })), { authenticated: true, actorId: avatarId, wallets: 0 });
  const { credentials } = await first.cdp.send("WebAuthn.getCredentials", {
    authenticatorId: first.authenticatorId,
  });
  assert.equal(credentials.length, 1);
  assert.equal(credentials[0].isResidentCredential, true);
  await first.context.close();

  const second = await device(credentials);
  target.search = "";
  await second.page.goto(target.toString());
  await second.page.waitForFunction(() => Boolean(state?.primary_action));
  assert.equal(await second.page.evaluate(() => actorId), 0);
  await second.page.evaluate(async () => { await loginWithPasskey(); });
  assert.deepEqual(await second.page.evaluate(() => ({
    authenticated: identity.authenticated, actorId, wallets: identity.wallets.length,
    saved: Boolean(localStorage.getItem("cosyworld.actorSession")),
  })), { authenticated: true, actorId: avatarId, wallets: 0, saved: true });
  await second.page.reload();
  await second.page.waitForFunction((id) => actorId === id
    && state?.primary_action?.kind !== "create_avatar"
    && state?.actors?.some((actor) => actor.id === id), avatarId);
  await second.page.route("**/auth/avatar", (route) => route.fulfill({
    status: 503, contentType: "application/json",
    body: JSON.stringify({ ok: false, status: 503, error: "Avatar ownership storage is temporarily unavailable." }),
  }));
  await second.page.reload();
  await second.page.waitForFunction((id) => actorId === id
    && state?.primary_action?.kind !== "create_avatar"
    && state?.actors?.some((actor) => actor.id === id), avatarId);
  console.log("Passkey avatar smoke passed: wallet-free creation, account claim, synced-passkey recovery, reload.");
} finally {
  await browser.close();
}
