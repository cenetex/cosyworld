#!/usr/bin/env node
import assert from "node:assert/strict";
import { chromium } from "playwright";
import { assertBrowserReachability } from "./player-reachability.mjs";

const target = new URL(process.env.COSYWORLD_SMOKE_URL || "http://localhost:3102/");
assert(["localhost", "127.0.0.1"].includes(target.hostname), "Reachability smoke uses a local test world");
target.search = "?reset=1";
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage();
  await page.goto(target.toString());
  await page.waitForFunction(() => Boolean(state?.primary_action));
  await assertBrowserReachability(page, "entry");
  await page.evaluate(async () => { await createAvatar(); });
  await assertBrowserReachability(page, "created avatar");
  await page.evaluate(() => {
    localStorage.setItem("cosyworld.actorSession", "expired-session");
  });
  await page.reload();
  await page.waitForFunction(() => state?.primary_action?.kind === "create_avatar" && actorId > 0);
  await assertBrowserReachability(page, "expired session");
  assert(await page.evaluate(() => actions.some((action) => action.kind === "avatar-reconnect")));
  assert(await page.evaluate(() => actions.some((action) => action.kind === "begin-new-tale")));
  await page.evaluate(async () => { await actions.find((action) => action.kind === "begin-new-tale").run(); });
  assert.equal(await page.evaluate(() => actorId), 0);
  await assertBrowserReachability(page, "new tale choice");
  await page.evaluate(async () => { await createAvatar(); });
  await assertBrowserReachability(page, "new avatar after expired session");
  console.log("Player reachability smoke passed: entry, legal cards, expired session, reconnect, and new tale.");
} finally {
  await browser.close();
}
