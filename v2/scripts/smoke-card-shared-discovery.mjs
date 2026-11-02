import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { chromium } from "playwright";
import { createServer } from "../card-game/serve.mjs";
import { createWorld, addLog } from "../card-game/world.mjs";
import { profiles } from "../card-game/memory.mjs";
import { revealCard } from "./card-browser-helpers.mjs";

// UI lifecycle test. Mocked snapshots exercise the shipping shared client;
// authority and journal replay are covered by the real shared-server smoke.
const browser = await chromium.launch({ headless: true });
const server = createServer();
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const app = await readFile(
  new URL("../card-game/app.mjs", import.meta.url),
  "utf8",
);
const probe = `
// Test-only access to the actual lifecycle promises and shared polling path.
globalThis.discoveryProbe = {
  sync: () => sharedSession.sync(),
  state: () => ({ revision: world.revision, trip }),
  wait: (key) => {
    globalThis.discoverySettled ||= {};
    globalThis.discoverySettled[key] = false;
    prepareScene().then(() => { globalThis.discoverySettled[key] = true; });
  },
};
`;
try {
  for (const width of [1440, 390]) {
    const page = await browser.newPage({
      viewport: { width, height: 900 },
      reducedMotion: width === 390 ? "reduce" : "no-preference",
    });
    page.setDefaultTimeout(15000);
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    const world = createWorld();
    for (const id of ["oil", "bell", "cloth"]) world.items[id].holder = "attic";
    world.actors.vale.place = "station";
    world.actors.keeper.place = "attic";
    world.actors.moth.place = "pond";
    const seen = Object.keys(profiles).filter(
      (id) => !["oil", "bell", "cloth"].includes(id),
    );
    let snapshot = {
      actor: "vale",
      world,
      now: Date.now(),
      actions: [],
      queue: [],
      history: [],
      claimed: [true, false, false, false, false, false, false, false],
      present: [true, false, false, false, false, false, false, false],
    };
    await page.addInitScript(
      ({ seen }) => {
        const key =
          "cosyworld.reflected-shore.v1.shared.discovery-fixture.vale";
        localStorage.setItem(key + ".seen", JSON.stringify(seen));
        localStorage.setItem("cosyworld.dialogue.sound", "off");
        localStorage.setItem(
          "cosyworld.room-music",
          JSON.stringify({ enabled: false }),
        );
        window.discoveryReveals = [];
        window.addEventListener("DOMContentLoaded", () => {
          new MutationObserver(() => {
            const id = ["oil", "bell", "cloth"].find((id) => document.querySelector(`#hand [data-card="${id}"]`)?.dataset.unrevealed === "false" && !window.discoveryReveals.includes(id));
            if (
              id &&
              window.discoveryReveals.at(-1) !== id
            )
              window.discoveryReveals.push(id);
          }).observe(document.body, {
            subtree: true,
            childList: true,
            attributes: true,
            attributeFilter: ["open", "data-card", "data-unrevealed"],
          });
        });
      },
      { seen },
    );
    await page.route("**/app.mjs", (route) =>
      route.fulfill({ contentType: "text/javascript", body: app + probe }),
    );
    await page.route("**/auth/account", (route) =>
      route.fulfill({ json: { authenticated: true } }),
    );
    await page.route(
      "**/card-game/shared/worlds/discovery-fixture**",
      (route) => route.fulfill({ json: snapshot }),
    );
    await page.goto(`${origin}/?world=discovery-fixture`);
    await page.waitForFunction(() => Boolean(window.discoveryProbe));
    const publish = async (change) => {
      snapshot = structuredClone(snapshot);
      change(snapshot.world);
      snapshot.world.revision++;
      snapshot.now = Math.max(Date.now(), snapshot.now + 1);
      // Start the poll without returning its promise to Playwright. Under a
      // slow CI runner an awaited page promise can fail as a "destroyed
      // context" without any navigation; the revision wait below is the check.
      await page.evaluate(() => {
        void window.discoveryProbe.sync();
      });
      await page.waitForFunction(
        (revision) => window.discoveryProbe.state().revision === revision,
        snapshot.world.revision,
      );
    };
    const reveal = (id) =>
      page.waitForFunction((id) => {
        return (
          document.querySelector(`#hand [data-card="${id}"]`)?.dataset.unrevealed === "true"
        );
      }, id);
    const dismiss = async (id) => {
      await revealCard(page, id);
    };

    await publish((state) => {
      state.items.oil.holder = "station";
    });
    await reveal("oil");
    await page.evaluate(() => {
      document.querySelector("#history-dialog").showModal();
      document.dispatchEvent(new Event("shared-dialog-change"));
    });
    await publish((state) => {
      state.items.bell.holder = "station";
    });
    await publish((state) => {
      state.items.cloth.holder = "station";
    });
    await publish(() => {}); // Covered cards must not hold up scene playback.
    await page.evaluate(() => window.discoveryProbe.wait("queued"));
    await page.waitForFunction(() => window.discoverySettled.queued);
    assert.equal(
      await page.evaluate(() => window.discoverySettled.queued),
      true,
      "covered cards leave the latest scene promise free to settle",
    );
    await page.evaluate(() =>
      document.querySelector("#history-dialog").close(),
    );
    for (const id of ["oil", "bell", "cloth"]) {
      await reveal(id);
      await dismiss(id);
    }
    await page.waitForFunction(() => window.discoverySettled.queued);
    assert.deepEqual(await page.evaluate(() => window.discoveryReveals), [
      "oil",
      "bell",
      "cloth",
    ]);

    // A new trip leaves covered cards at their actual place without a modal.
    await page.evaluate(() => {
      const key =
        "cosyworld.reflected-shore.v1.shared.discovery-fixture.vale.seen";
      localStorage.setItem(
        key,
        JSON.stringify(
          JSON.parse(localStorage.getItem(key)).filter(
            (id) => !["oil", "bell", "cloth"].includes(id),
          ),
        ),
      );
    });
    await publish((state) => {
      for (const id of ["oil", "bell", "cloth"])
        state.items[id].holder = "attic";
    });
    await page.reload();
    await page.waitForFunction(() => Boolean(window.discoveryProbe));
    await publish((state) => {
      state.items.oil.holder = "station";
    });
    await reveal("oil");
    await page.evaluate(() => {
      document.querySelector("#history-dialog").showModal();
      document.dispatchEvent(new Event("shared-dialog-change"));
    });
    await publish((state) => {
      state.items.bell.holder = "station";
    });
    await page.evaluate(() => window.discoveryProbe.wait("cancelled"));
    await publish((state) => {
      state.actors.vale.place = "pond";
    });
    await page.evaluate(() =>
      document.querySelector("#history-dialog").close(),
    );
    await page.waitForFunction(() => window.discoverySettled.cancelled);
    await publish((state) => {
      state.items.oil.holder = "attic";
      state.items.bell.holder = "attic";
      state.items.cloth.holder = "pond";
    });
    await reveal("cloth");
    await page.evaluate(() => window.discoveryProbe.wait("newTrip"));
    await dismiss("cloth");
    await page.waitForFunction(() => window.discoverySettled.newTrip);
    // A reload of this viewer plays the room's next lines play in order.
    await page.reload();
    await page.waitForFunction(() => Boolean(window.discoveryProbe));
    await publish(() => {});
    await page.waitForTimeout(300);
    const first = "I can hear the pond while we talk about what we want.";
    const second = "I will wait here beside the water.";
    const startsAt = Math.max(Date.now(), snapshot.now + 1);
    const lines = [
      ["vale", "Vale", first],
      ["moth", "Pip", second],
    ].map(([actorId, speaker, text]) => {
      addLog(snapshot.world, speaker, text, {
        generated: true,
        kind: "dialogue",
        actorId,
        entityId: actorId,
        locationId: "pond",
      });
      return snapshot.world.log.at(-1);
    });
    snapshot.history = [
      { room: "pond", actor: "vale", starts_at: startsAt, lines },
    ];
    snapshot.now = startsAt;
    await publish(() => {});
    await page.waitForFunction(
      (first) => document.querySelector("#dialogue-text").textContent === first,
      first,
    );
    // Move the room clock past both lines; Live joins the latest line.
    snapshot.now += 12000;
    await page.evaluate(() => {
      void window.discoveryProbe.sync();
    });
    await page.waitForTimeout(250);
    // The reader follows the room clock; ● live shows only when behind it.
    if (await page.locator("#live-line").isVisible())
      await page.locator("#live-line").click();
    await page.waitForFunction(
      (second) =>
        document.querySelector("#dialogue-text").textContent === second,
      second,
    );
    assert.deepEqual(errors, []);
    console.log(
      `Shared card backs: same-room updates, unblocked playback and new trips passed at ${width}px.`,
    );
    await page.close();
  }
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
