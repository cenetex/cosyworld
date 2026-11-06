import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { chromium } from "playwright";
import { createServer } from "../card-game/serve.mjs";

const output = new URL("../../output/authoring-account/", import.meta.url)
  .pathname;
await mkdir(output, { recursive: true });
const server = createServer();
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const browser = await chromium.launch({ headless: true });
try {
  for (const width of [1440, 390, 320]) {
    const page = await browser.newPage({
      viewport: { width, height: 844 },
      hasTouch: width < 700,
    });
    const errors = [],
      calls = [];
    let authenticated = false;
    page.on("pageerror", (error) => errors.push(error.message));
    await page.route("**/auth/**", async (route) => {
      const path = new URL(route.request().url()).pathname;
      calls.push([path, route.request().postDataJSON()]);
      let json = {
        authenticated,
        members_only: width === 320,
        display_name: "Vale",
      };
      if (path.endsWith("/start"))
        json = {
          ceremony_id: "fixture",
          public_key: { challenge: "AQI", user: { id: "AQI" } },
        };
      if (path.endsWith("/finish")) {
        authenticated = true;
        json = { ok: true };
      }
      await route.fulfill({ json });
    });
    await page.addInitScript(() => {
      let attempt = 0;
      const credential = async ({ publicKey }) => {
        if (!(publicKey.challenge instanceof Uint8Array))
          throw new Error("Decode challenge");
        if (++attempt === 1)
          throw new DOMException("Closed", "NotAllowedError");
        return { toJSON: () => ({ id: "fixture-key", type: "public-key" }) };
      };
      Object.defineProperty(navigator, "credentials", {
        value: { get: credential, create: credential },
      });
    });
    try {
      await page.goto(`http://127.0.0.1:${server.address().port}/make`);
      const press = (locator) =>
        width < 700 ? locator.tap() : locator.click();
      const action = page.locator("#card-actions button"),
        note = page.locator(".action-beat-note");
      await press(page.locator("#menu-button"));
      await press(page.locator("[data-setting=designer-tool-source]"));
      await page.getByRole("textbox").waitFor();
      await note.fill("A world kept through the passkey step. 雪");
      await press(page.locator("#menu-button"));
      const register = width === 1440,
        id = register ? "create-passkey" : "sign-in";
      await press(page.locator(`[data-setting="designer-tool-${id}"]`));
      if (width === 320)
        assert.equal(
          await page
            .locator('[data-setting="designer-tool-create-passkey"]')
            .count(),
          0,
        );
      await press(action);
      await page.waitForFunction(() =>
        document
          .querySelector(".action-beat-note")
          .textContent.includes("You can try again"),
      );
      await page.screenshot({ path: `${output}/${width}-cancel.png` });
      await press(action);
      await page.waitForFunction(
        () =>
          document.querySelector(".action-beat-note").textContent ===
          "Signed in as Vale.",
      );
      await page.screenshot({ path: `${output}/${width}-signed-in.png` });
      const mode = register ? "register" : "login";
      assert.equal(
        calls.filter(([path]) => path === `/auth/passkey/${mode}/start`).length,
        2,
      );
      assert.deepEqual(calls.find(([path]) => path.endsWith("/finish"))[1], {
        ceremony_id: "fixture",
        credential: { id: "fixture-key", type: "public-key" },
      });
      await press(page.locator("#menu-button"));
      await press(page.locator("[data-setting=designer-tool-source]"));
      await page.getByRole("textbox").waitFor();
      assert.equal(
        await note.innerText(),
        "A world kept through the passkey step. 雪",
      );
      const box = await action.boundingBox();
      assert(box.y >= 0 && box.y + box.height <= 844);
      assert.deepEqual(errors, []);
      console.log(
        `Account ${width}: ${mode}, cancellation, retry, policy and retained source passed`,
      );
    } finally {
      await page.close();
    }
  }
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
