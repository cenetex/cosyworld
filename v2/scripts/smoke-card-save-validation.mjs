// Synthetic state only. Exercise the real app save function with a test-only
// module probe; production source receives no debug interface.
import assert from "node:assert/strict";
import { chromium } from "playwright";
import { createServer } from "../card-game/serve.mjs";

const server = createServer();
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE,
});
try {
  for (const [width, height, slowdown] of [
    [1440, 900, 1],
    [390, 844, 4],
  ]) {
    const page = await browser.newPage({ viewport: { width, height } });
    const cdp = await page.context().newCDPSession(page);
    await cdp.send("Emulation.setCPUThrottlingRate", { rate: slowdown });
    await page.route("**/app.mjs*", async (route) => {
      const response = await route.fetch();
      await route.fulfill({
        response,
        body:
          (await response.text()) +
          "\nwindow.saveProbe = { save, get world() { return world; } };\n",
      });
    });
    const table = `save-validation-${width}`;
    const key = `cosyworld.reflected-shore.v1.${table}`;
    await page.goto(
      `http://127.0.0.1:${server.address().port}/?table=${table}`,
    );
    await page.waitForFunction(() => window.saveProbe);
    const report = await page.evaluate(async (key) => {
      const { encodeSave, decodeSave, validateWorld, createWorld } =
        await import("/world.mjs");
      const probe = window.saveProbe;
      if (!probe.save()) throw new Error("Initial valid save failed");
      const good = localStorage.getItem(key);
      const turn = probe.world.turn;
      validateWorld(probe.world);
      probe.world.turn = -1;
      const topRefused = !probe.save() && localStorage.getItem(key) === good;
      probe.world.turn = turn;
      validateWorld(probe.world);
      const holder = probe.world.items.lamp.holder;
      probe.world.items.lamp.holder = "missing-holder";
      const nestedRefused = !probe.save() && localStorage.getItem(key) === good;
      probe.world.items.lamp.holder = holder;
      const restored =
        encodeSave(decodeSave(localStorage.getItem(key))) === good;
      const large = createWorld();
      // Fill both bounded history lanes with maximum-length valid narration.
      large.log = Array.from({ length: 200 }, (_, i) => ({
        seq: i + 1,
        turn: 0,
        speaker: "World",
        kind: "narration",
        text: "Synthetic history. ".repeat(30),
        ...(i >= 100 ? { generated: true } : {}),
      }));
      large.eventSeq = 200;
      const latency = [probe.world, large].map((world) => {
        for (let i = 0; i < 10; i++) encodeSave(world);
        const samples = Array.from({ length: 100 }, () => {
          const start = performance.now();
          encodeSave(world);
          return performance.now() - start;
        }).sort((a, b) => a - b);
        const bytes = encodeSave(world);
        decodeSave(bytes);
        return {
          bytes: bytes.length,
          medianMs: samples[50],
          p95Ms: samples[95],
        };
      });
      return { topRefused, nestedRefused, restored, good, latency };
    }, key);
    assert.ok(report.topRefused && report.nestedRefused && report.restored);
    await page.reload();
    await page.waitForFunction(() => window.saveProbe);
    assert.equal(
      await page.evaluate(() => window.saveProbe.world.turn),
      JSON.parse(report.good).turn,
    );
    assert.equal(
      await page.evaluate((key) => localStorage.getItem(key), key),
      report.good,
    );
    delete report.good;
    console.log(JSON.stringify({ width, slowdown, ...report }));
    await page.close();
  }
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
