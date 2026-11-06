import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { chromium } from "playwright";
import { createServer } from "../card-game/serve.mjs";
const server = createServer();
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
const browser = await chromium.launch();
const output = process.env.CARD_CREATE_TOOLS_SHOTS;
if (output) await mkdir(output, { recursive: true });
try {
  for (const width of [1440, 390, 320]) {
    const page = await browser.newPage({ viewport: { width, height: 900 }, hasTouch: width < 700, reducedMotion: "reduce" });
    let owner = "first", release, uploadCalls = 0, requestKey, receipt;
    const errors = [], bodies = [], received = new Set();
    page.on("pageerror", error => errors.push(error.message));
    await page.route("**/auth/account", route => route.fulfill({ json: { authenticated: true, user_id: owner, display_name: owner } }));
    await page.route("**/card-game/authoring/assets/*", async route => {
      const request = route.request(); uploadCalls++;
      assert.equal(request.headers()["x-authoring-owner"], "first");
      requestKey ??= request.headers()["idempotency-key"];
      assert.equal(request.headers()["idempotency-key"], requestKey);
      if (width === 1440 && uploadCalls === 1) await new Promise(resolve => { release = resolve; });
      if (owner !== "first") return route.fulfill({ status: 409, json: { error: "Open the first account." } });
      received.add(owner);
      const bytes = request.postDataBuffer(), sha256 = createHash("sha256").update(bytes).digest("hex");
      assert(request.url().endsWith(sha256));
      return route.fulfill({ json: { sha256, size: bytes.length } });
    });
    await page.route("**/card-game/authoring/packs", route => {
      const request = route.request(), input = request.postDataJSON();
      assert.equal(request.headers()["x-authoring-owner"], "first");
      assert.equal(request.headers()["idempotency-key"], requestKey);
      assert.equal(owner, "first");
      bodies.push(input);
      if (width === 320 && bodies.length === 1)
        return route.fulfill({ status: 401, json: { error: "Sign in to finish Create." } });
      const { launch: _launch, ...source } = input;
      receipt ??= { ...source, id: "private-world", revision: 1 };
      if (width === 390 && bodies.length === 1) return route.abort("failed");
      return route.fulfill({ json: receipt });
    });
    const press = target => width < 700 ? target.tap() : target.click();
    const action = () => press(page.locator("#card-actions button:enabled"));
    const tool = async id => { await press(page.locator("#menu-button")); await press(page.locator(`[data-setting="designer-tool-${id}"]`)); };
    const retry = () => page.waitForFunction(() => document.querySelector("#card-actions button")?.textContent === "Retry Create");
    const read = () => page.evaluate(async () => {
      const { openAuthoringStore } = await import("/card-game/authoring-local-store.mjs");
      const store = await openAuthoringStore(), key = new URL(location.href).searchParams.get("draft");
      try {
        const original = await store.readCreate(key, "first");
        return { record: await store.read(key), original, files: original?.assets.size, other: await store.readCreate(key, "second") };
      }
      finally { store.close(); }
    });
    await page.goto(`http://127.0.0.1:${server.address().port}/make?sample=1`);
    await tool("create-private");
    await page.waitForFunction(() => document.querySelector("#card-actions button")?.textContent === "Create private world");
    await action();
    if (width === 1440) {
      await page.waitForFunction(() => document.querySelector(".action-beat-note").textContent.includes("Uploading"), null, { timeout: 10_000 })
        .catch(async failure => { throw new Error(`${failure.message}: ${await page.locator(".action-beat-note").innerText()}`); });
      while (!release) await new Promise(resolve => setTimeout(resolve, 10));
      owner = "second";
      await tool("sign-in"); await action();
      release();
      await tool("create-private"); await retry();
      const before = uploadCalls;
      await action();
      await page.waitForFunction(() => document.querySelector(".action-beat-note").textContent.includes("Signed in"));
      assert.equal(uploadCalls, before);
      assert.equal((await read()).original.owner, "first");
      owner = "first";
      await action(); await retry(); await action();
    } else if (width === 390) {
      await retry();
      await tool("source");
      await page.getByRole("textbox", { name: "World notes" }).fill("Later local notes");
      await action();
      await page.waitForFunction(() => document.querySelector(".action-beat-text")?.textContent.endsWith("Saved"), null, { timeout: 10_000 })
        .catch(async failure => { throw new Error(`${failure.message}: ${await page.locator("#action-beat").innerText()}`); });
      await page.reload();
      await tool("create-private"); await retry(); await action();
    } else {
      await page.waitForFunction(() => document.querySelector("#card-actions button")?.textContent === "Refresh account");
      await action(); await retry(); await action();
    }
    await page.waitForFunction(() => document.querySelector(".action-beat-note").textContent.includes("has a private saved copy"));
    const stored = await read();
    assert.deepEqual(stored.original.receipt, receipt);
    assert.equal(stored.files, 0);
    assert.equal(stored.other, null);
    assert.deepEqual([...received], ["first"]);
    assert(bodies.every(body => JSON.stringify(body) === JSON.stringify(bodies[0])));
    if (width === 390) assert.equal(stored.record.draft.document, "Later local notes");
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    assert.deepEqual(errors, []);
    if (output) await page.screenshot({ path: `${output}/${width}-private-create.png` });
    console.log(`Create tools ${width}: existing cards, account binding, sign-in/reload retry and durable receipt passed`);
    await page.close();
  }
} finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
