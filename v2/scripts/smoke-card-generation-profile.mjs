// Deterministic local-only evidence for #2007. No provider calls or user saves.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { chromium } from "playwright";
import { createServer } from "../card-game/serve.mjs";
import {
  addLog,
  createWorld,
  encodeSave,
  legalActions,
  play,
} from "../card-game/world.mjs";
import { enableMotives } from "../card-game/motives.mjs";
import { selectCard, smokeWidths } from "./card-browser-helpers.mjs";

const output = new URL("../../output/generation-profile/", import.meta.url);
await mkdir(output, { recursive: true });
const commit = execFileSync("git", ["rev-parse", "HEAD"], {
  encoding: "utf8",
}).trim();
function fixture(turns) {
  let world = enableMotives(createWorld({ opening: true, seed: 7 }));
  for (const kind of ["snuff", "move", "light"])
    world = play(
      world,
      legalActions(world).find(
        (a) => a.kind === kind && (kind !== "move" || a.target === "pond"),
      ),
    ).state;
  // A reload with no words for the opening turn asks the model again, so the
  // saved shore starts with its current line already heard.
  addLog(world, "Vale", "I remember this shore, at first light.", {
    actorId: "vale",
    entityId: "vale",
    locationId: world.actors.vale.place,
    kind: "dialogue",
    generated: true,
  });
  for (let i = 0; i < turns; i++) {
    world = play(
      world,
      legalActions(world).find((a) => a.kind === "wait"),
    ).state;
    addLog(world, "Vale", `I remember this shore, day ${i}.`, {
      actorId: "vale",
      entityId: "vale",
      locationId: world.actors.vale.place,
      kind: "dialogue",
      generated: true,
    });
  }
  world.actors.moth.place = world.actors.vale.place;
  return world;
}
const fixtures = [0, 120].map((turns) => {
  const world = fixture(turns);
  return {
    turns,
    save: encodeSave(world),
    turn: world.turn,
    seed: world.run.seed,
    logEntries: world.log.length,
  };
});
const server = createServer();
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({
  headless: true,
  ...(process.env.CHROMIUM_PATH
    ? { executablePath: process.env.CHROMIUM_PATH }
    : {}),
});
const reports = [];
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const rounded = (n) => Math.round(n * 10) / 10;
try {
  for (const width of smokeWidths([1440, 390])) {
    for (const fixture of fixtures) {
      for (const mode of (
        process.env.COSYWORLD_PROFILE_MODES ||
        "success,delayed,failure,retry,timeout"
      ).split(",")) {
        assert(
          ["success", "delayed", "failure", "retry", "timeout"].includes(mode),
        );
        const name = `${width}-${fixture.turns}-${mode}`;
        const key = `cosyworld.reflected-shore.v1.profile-${name}`;
        const page = await browser.newPage({
          viewport: { width, height: 900 },
          reducedMotion: "reduce",
        });
        page.setDefaultTimeout(10_000);
        const errors = [],
          requests = [],
          evaluations = [];
        let releaseProbe;
        const probed = new Promise((resolve) => {
          releaseProbe = resolve;
        });
        const report = {
          commit,
          browser: browser.version(),
          width,
          mode,
          fixture: {
            turns: fixture.turn,
            seed: fixture.seed,
            bytes: Buffer.byteLength(fixture.save),
            logEntries: fixture.logEntries,
          },
          errors,
          requests,
        };
        reports.push(report);
        page.on("pageerror", (error) => errors.push(error.message));
        await page.addInitScript(
          ({ key, save }) => {
            localStorage.setItem(key, save);
            localStorage.setItem(
              `${key}.seen`,
              JSON.stringify([
                "vale",
                "moth",
                "keeper",
                "lamp",
                "oil",
                "cloth",
                "bell",
                "attic",
                "pond",
                "station",
                "clearing",
              ]),
            );
            localStorage.setItem("cosyworld.dialogue.sound", "off");
            const data = (window.generationProfile = {
              active: false,
              tasks: [],
              gaps: [],
              saves: [],
            });
            new PerformanceObserver((list) => {
              if (data.active)
                for (const entry of list.getEntries())
                  data.tasks.push({
                    start: entry.startTime,
                    duration: entry.duration,
                  });
            }).observe({ type: "longtask" });
            let last = performance.now();
            setInterval(() => {
              const now = performance.now();
              if (data.active) data.gaps.push(now - last);
              last = now;
            }, 50);
            const setItem = Storage.prototype.setItem;
            Storage.prototype.setItem = function (name, value) {
              const start = performance.now();
              try {
                return setItem.call(this, name, value);
              } finally {
                const duration = performance.now() - start;
                if (data.active && name === key)
                  data.saves.push({
                    bytes: new Blob([value]).size,
                    duration,
                  });
              }
            };
          },
          { key, save: fixture.save },
        );
        // All traffic stays on this fixture server, even if the app adds a URL.
        await page.route("**/*", async (route) => {
          const url = new URL(route.request().url());
          if (url.origin !== origin) return route.abort("blockedbyclient");
          if (url.pathname !== "/card-game/text") return route.continue();
          const input = route.request().postDataJSON();
          const request = {
            revision: input.revision,
            turn: input.turn,
            start: performance.now(),
            status: "pending",
          };
          requests.push(request);
          if (mode === "timeout" && requests.length === 1) return;
          await sleep(mode === "delayed" ? 3000 : 100);
          if (mode === "delayed") await probed;
          const fail =
            mode === "failure" || (mode === "retry" && requests.length === 1);
          request.status = fail ? 503 : 200;
          request.fixtureResponseDelayMs = rounded(
            performance.now() - request.start,
          );
          await route.fulfill({
            status: request.status,
            contentType: "application/json",
            body: JSON.stringify(
              fail
                ? { error: "deterministic fixture unavailable" }
                : {
                    revision: input.revision,
                    model: "generation-profile-fixture",
                    entries: input.entities.map(({ id }) => ({
                      id,
                      text: `${id} speaks on turn ${input.turn}.`,
                    })),
                  },
            ),
          });
        });
        page.on("requestfailed", (request) => {
          if (!request.url().endsWith("/card-game/text")) return;
          const pending = requests.find((entry) => entry.status === "pending");
          if (pending) {
            pending.status = "aborted";
            pending.abortedAfterMs = rounded(performance.now() - pending.start);
          }
        });
        let cdp,
          sampling = false,
          sampleLoop;
        try {
          await page.goto(`${origin}/?table=profile-${name}`);
          for (let i = 0; i < 250; i++) {
            if (
              (await page.locator("#hand").getAttribute("data-cooling")) ===
              "false"
            )
              break;
            if (await page.locator("#dialogue-advance").isVisible())
              await page.locator("#dialogue-advance").click();
            await page.waitForTimeout(40);
          }
          assert.equal(requests.length, 0, "boot does not call a provider");
          await selectCard(page, "moth");
          cdp = await page.context().newCDPSession(page);
          await cdp.send("Profiler.enable");
          await cdp.send("Profiler.setSamplingInterval", { interval: 1000 });
          await cdp.send("Profiler.start");
          await page.evaluate(() => {
            window.generationProfile.active = true;
          });
          sampling = true;
          sampleLoop = (async () => {
            while (sampling) {
              const start = performance.now();
              await cdp.send("Runtime.evaluate", {
                expression: "performance.now()",
                returnByValue: true,
              });
              evaluations.push(performance.now() - start);
              await sleep(100);
            }
          })();
          const start = performance.now();
          const requested = page.waitForRequest("**/card-game/text");
          await page.locator("#card-actions .card-primary").click();
          await requested;
          const committed = await page.evaluate(
            (key) => JSON.parse(localStorage.getItem(key)),
            key,
          );
          assert.equal(committed.turn, fixture.turn + 1);
          // The delayed reply is held until both real input handlers finish.
          const pointerStart = performance.now();
          await page.locator("#toolbar-menu-button").click();
          await page.locator("#world-menu").waitFor({ state: "visible" });
          report.pointerMs = rounded(performance.now() - pointerStart);
          const keyboardStart = performance.now();
          await page.keyboard.press("Escape");
          await page.locator("#world-menu").waitFor({ state: "hidden" });
          report.keyboardMs = rounded(performance.now() - keyboardStart);
          report.replyPendingAfterInputs = requests[0].status === "pending";
          if (mode === "delayed") assert(report.replyPendingAfterInputs);
          releaseProbe();
          await page.waitForFunction(
            ({ mode, turn }) =>
              mode === "failure"
                ? document.querySelector("#speech-row")?.dataset.beat ===
                  "silent"
                : document
                    .querySelector("#dialogue-text")
                    ?.textContent.includes(`speaks on turn ${turn}`),
            { mode, turn: committed.turn },
            { timeout: 35_000 },
          );
          report.elapsedMs = rounded(performance.now() - start);
          const after = await page.evaluate(
            (key) => JSON.parse(localStorage.getItem(key)),
            key,
          );
          assert.equal(
            after.turn,
            committed.turn,
            "retry never repeats the action",
          );
          assert.deepEqual(
            after.items,
            committed.items,
            "retry preserves custody",
          );
          assert.equal(
            requests.length,
            ["retry", "failure", "timeout"].includes(mode) ? 2 : 1,
          );
          assert(
            requests.every(
              (request) => request.revision === committed.revision,
            ),
            "same-turn retry",
          );
          assert.deepEqual(errors, []);
          await page.waitForTimeout(100);
          report.passed = true;
        } catch (error) {
          report.error = error.stack;
        } finally {
          sampling = false;
          await sampleLoop;
          if (cdp) {
            const { profile } = await cdp.send("Profiler.stop");
            await writeFile(
              new URL(`${name}.cpuprofile`, output),
              JSON.stringify(profile),
            );
            const nodes = new Map(
              profile.nodes.map((node) => [node.id, node.callFrame]),
            );
            const self = new Map();
            for (const [i, id] of (profile.samples || []).entries()) {
              const frame = nodes.get(id);
              const label = `${frame.url.replace(origin, "")}:${frame.lineNumber + 1} ${frame.functionName}`;
              self.set(
                label,
                (self.get(label) || 0) + (profile.timeDeltas[i] || 0) / 1000,
              );
            }
            report.cpuTop = [...self]
              .sort((a, b) => b[1] - a[1])
              .slice(0, 20)
              .map(([frame, ms]) => ({ frame, ms: rounded(ms) }));
          }
          const data = await page.evaluate(() => {
            window.generationProfile.active = false;
            return window.generationProfile;
          });
          report.longTasks = data.tasks;
          report.maxHeartbeatMs = rounded(Math.max(0, ...data.gaps));
          report.maxEvaluationMs = rounded(Math.max(0, ...evaluations));
          report.evaluations = evaluations.length;
          report.saveWrites = data.saves;
          await page.close();
          await writeFile(
            new URL("report.json", output),
            JSON.stringify(reports, null, 2),
          );
          console.log(
            JSON.stringify({ ...report, cpuTop: report.cpuTop?.slice(0, 5) }),
          );
        }
      }
    }
  }
  assert(
    reports.every((report) => report.passed),
    "generation profile cases passed",
  );
} finally {
  await browser.close();
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
}
