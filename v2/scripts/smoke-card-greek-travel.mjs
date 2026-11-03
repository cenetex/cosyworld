import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { chromium } from "playwright";
import { createServer } from "../card-game/serve.mjs";
import { encodeSave, legalActions } from "../card-game/world.mjs";
import { profiles } from "../card-game/memory.mjs";
import { packDefinition } from "../card-game/pack-registry.mjs";
import { openDoorAction, openSeas } from "../../test/helpers/open-door.mjs";
import { selectCard, wordsFellSilent } from "./card-browser-helpers.mjs";
import { needsVoyage, nextVoyagePlay } from "../../test/helpers/voyage.mjs";

const output = new URL("../../output/greek-travel/", import.meta.url);
await mkdir(output, { recursive: true });
const server = createServer();
await new Promise((done) => server.listen(0, "127.0.0.1", done));
const origin = `http://127.0.0.1:${server.address().port}`;
let browser;
try {
  browser = await chromium.launch({
    headless: true,
    ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE
      ? {
          executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE,
          args: [
            "--use-gl=angle",
            "--use-angle=swiftshader",
            "--enable-unsafe-swiftshader",
          ],
        }
      : {}),
  });
  // Mara walks the Long Walls to Piraeus and back, the Sacred Way to the
  // countryside and back, then the ship takes her home from Piraeus.
  const athens = [
    "greek-road-athens-piraeus",
    "greek-piraeus",
    "greek-road-athens-piraeus",
    "greek-athens",
    "greek-road-athens-eleusis",
    "greek-eleusis",
    "greek-colonus",
    "greek-eleusis",
    "greek-road-athens-eleusis",
    "greek-athens",
    "greek-road-athens-piraeus",
    "greek-piraeus",
    "greek-ship",
    "greek-harbor",
    "greek-road-thebes",
    "greek-courtyard",
  ];
  // The land route from Piraeus (#2049, rules 94): the Long Walls, the
  // Agora, the Sacred Way, Eleusis and Cithaeron to the battlefield outside
  // the Theban City Gate.
  const land = [
    "greek-road-athens-piraeus",
    "greek-athens",
    "greek-road-athens-eleusis",
    "greek-eleusis",
    "greek-cithaeron",
    "greek-battlefield",
  ];
  // While the gate is shut Mara walks back to Piraeus; once the guard has
  // opened it she walks on through Thebes to the Wine-Dark Harbor.
  const back = [...land].reverse().slice(1).concat("greek-piraeus");
  const home = [
    ...land,
    "greek-gate",
    "greek-courtyard",
    "greek-road-thebes",
    "greek-harbor",
  ];
  // With the gate shut and no cargo aboard, the Charybdis still sails Mara
  // home from Piraeus: every way back toward Black Pond is free (rules 94).
  const free = ["greek-ship", "greek-harbor", "greek-ship", "pond"];
  // The Black Pond route with the Travel Provisions aboard: out to Piraeus
  // and the Hoppy Cat jetty, then back.
  const charybdis = [
    "greek-ship",
    "greek-piraeus",
    "greek-ship",
    "hoppycat-signal-jetty",
    "greek-ship",
    "greek-piraeus",
  ];
  // The Open Door fixture opened the City Gate with the decree; this one
  // shuts it again, as after an exposure the gate never opened.
  const gateShut = () => {
    const world = openSeas();
    world.items["greek-decree"].holder = "greek-palace";
    world.openedRoutes = world.openedRoutes.filter(
      (key) => key !== "greek-gate>greek-battlefield",
    );
    return world;
  };
  const gateOpen = () => {
    const world = openSeas();
    world.openedRoutes = [
      ...new Set([...world.openedRoutes, "greek-gate>greek-battlefield"]),
    ].sort();
    return world;
  };
  const journeys = [
    // After the plea, the petition and the Suppliant's Olive Branch rest in
    // the Agora, so the Sacred Way and the Long Walls stand open from both
    // ends. Thebes ended in exposure.
    { name: "athens", start: "greek-athens", route: athens, make: openSeas },
    {
      name: "land",
      start: "greek-piraeus",
      route: [...land, ...back, ...free],
      make: gateShut,
      shut: true,
      cargo: false,
    },
    { name: "home", start: "greek-piraeus", route: home, make: gateOpen },
    {
      name: "charybdis",
      start: "greek-harbor",
      route: charybdis,
      make: openSeas,
      hoppy: true,
    },
  ];
  for (const width of [1440, 390])
    for (const journey of journeys) {
      const table = `greek-travel-${journey.name}-${width}`;
      const key = `cosyworld.reflected-shore.v1.${table}`;
      const fixture = journey.make();
      fixture.playerActorId = "mara";
      fixture.sharedVersion = 1;
      fixture.controlledActors = ["vale", "mara"];
      fixture.presentActors = ["mara"];
      fixture.actors.mara.place = journey.start;
      // Black Pond sails only to the Wine-Dark Harbor. The Travel Provisions
      // on deck open the lane between Piraeus and the Wine-Dark Harbor.
      if (
        journey.make === openSeas &&
        fixture.items["greek-provisions"].holder !== "greek-ship"
      )
        throw new Error("The opening fixture keeps the provisions aboard.");
      // The free leg home carries no cargo: the provisions stay ashore.
      if (journey.cargo === false)
        fixture.items["greek-provisions"].holder = "greek-athens";
      // The voyage to Piraeus uses the provisions up (rules 95); a Hoppy
      // Cat thing aboard carries the ship on to the jetty.
      if (journey.hoppy)
        fixture.items["hoppycat-halfway-cup"].holder = "greek-ship";
      const page = await browser.newPage({
        viewport: { width, height: width === 390 ? 844 : 900 },
        reducedMotion: "reduce",
        hasTouch: width === 390,
      });
      const errors = [];
      page.on("pageerror", (e) => errors.push(e.message));
      page.on("response", (r) => {
        if (r.status() >= 400 && r.url().includes("/assets/"))
          errors.push(`${r.status()} ${r.url()}`);
      });
      await page.addInitScript(
        ({ key, save, seen }) => {
          if (!localStorage.getItem(key)) localStorage.setItem(key, save);
          localStorage.setItem(`${key}.seen`, JSON.stringify(seen));
          localStorage.setItem("cosyworld.dialogue.sound", "off");
          localStorage.setItem(
            "cosyworld.room-music",
            JSON.stringify({ enabled: false }),
          );
        },
        { key, save: encodeSave(fixture), seen: Object.keys(profiles) },
      );
      await page.route("**/card-game/text", async (route) => {
        const input = route.request().postDataJSON();
        await route.fulfill({
          json: {
            revision: input.revision,
            model: "greek-travel-browser-fixture",
            entries: input.entities.map(({ id }) => ({
              id,
              text: "The road lies ahead of us.",
            })),
          },
        });
      });
      const state = () =>
        page.evaluate((key) => JSON.parse(localStorage.getItem(key)), key);
      const settle = async () => {
        await page.waitForSelector("#hand .card");
        for (let n = 0; n < 300; n++) {
          if (await page.locator("#dialogue-advance").isVisible())
            await page.locator("#dialogue-advance").click();
          assert.equal(await wordsFellSilent(page, key), false);
          if (
            (await page.locator("#hand").getAttribute("data-cooling")) ===
            "false"
          )
            return;
          await page.waitForTimeout(40);
        }
        throw new Error(`Journey remained busy at ${width}px`);
      };
      const step = async (kind, target) => {
        await settle();
        // Aboard, a port is a voyage: the course card, a round at sea, Disembark.
        for (
          let n = 0;
          n < 12 &&
          kind === "move" &&
          needsVoyage(await state(), "mara", target);
          n++
        ) {
          const next = nextVoyagePlay(await state(), "mara", target);
          await step(next.kind, next.target);
        }
        if (target === "greek-ship")
          for (
            let n = 0;
            n < 32 &&
            !legalActions(await state()).some(
              (a) => a.kind === "move" && a.target === target,
            );
            n++
          )
            await step("wait");
        const before = await state();
        const action = openDoorAction(before, kind, target ? { target } : {});
        await page.keyboard.press("Escape");
        await selectCard(page, action.cards[0] || "mara", {
          touch: width === 390,
        });
        await page
          .locator(`#card-actions [data-action="${kind}"]`)
          .first()
          .click();
        await settle();
        const after = await state();
        assert.equal(after.turn, before.turn + 1);
        if (kind === "move") assert.equal(after.actors.mara.place, target);
        assert.ok(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth + 1,
          ),
        );
      };
      await page.goto(`${origin}/?table=${table}`);
      await settle();
      if (journey.name === "athens") {
        assert.match(
          await page.locator("#backdrop").getAttribute("src"),
          /athens-grand-agora(?:-night)?\.webp/,
        );
        await page.screenshot({
          path: new URL(`athens-empty-${width}.png`, output).pathname,
          fullPage: true,
        });
      }
      let branchSeen = false,
        shutSeen = false;
      for (const target of journey.route) {
        await step("move", target);
        // The retired Coast Road never leads from Piraeus.
        if (target === "greek-piraeus")
          assert.equal(
            await page.locator('#hand [data-card="greek-road-coast"]').count(),
            0,
          );
        // Without the decree the City Gate keeps Thebes shut to the land
        // route: the battlefield offers no way in.
        if (journey.shut && target === "greek-battlefield" && !shutSeen) {
          shutSeen = true;
          const here = await state();
          assert.ok(
            !legalActions(here, "mara").some(
              (a) => a.kind === "move" && a.target === "greek-gate",
            ),
          );
          assert.equal(
            await page.locator('#hand [data-card="greek-gate"]').count(),
            0,
          );
          await page.screenshot({
            path: new URL(`battlefield-gate-shut-${width}.png`, output)
              .pathname,
            fullPage: true,
          });
        }
        // The olive branch rests in the Agora, where it opens the Long Walls.
        if (target === "greek-athens" && !branchSeen) {
          branchSeen = true;
          await selectCard(page, "greek-olive-branch", {
            touch: width === 390,
          });
          const art = page.locator(
            '#hand [data-card="greek-olive-branch"] .art img',
          );
          await art.evaluate((img) => img.decode());
          assert.match(await art.getAttribute("src"), /olive-branch\.webp/);
          await page.evaluate(
            () =>
              new Promise((done) =>
                requestAnimationFrame(() => requestAnimationFrame(done)),
              ),
          );
          await page.screenshot({
            path: new URL(`olive-branch-${width}.png`, output).pathname,
            fullPage: true,
          });
          await page.keyboard.press("Escape");
        }
        // The Charybdis at each port of its route, and on deck.
        if (
          ["land", "charybdis"].includes(journey.name) &&
          [
            "greek-ship",
            "greek-harbor",
            "greek-piraeus",
            "hoppycat-signal-jetty",
            "pond",
          ].includes(target)
        ) {
          const at = (await state()).transports["greek-ship"].dock;
          await page.screenshot({
            path: new URL(
              `${journey.name}-${target}-${at}-${width}.png`,
              output,
            ).pathname,
            fullPage: true,
          });
        }
        const road = packDefinition("greek-drama").places[target]?.road;
        // A road's two ends stack behind it and fan out in road order.
        if (road) {
          await selectCard(page, target, { touch: width === 390 });
          const visibleOrder = await page
            .locator("#hand [data-card]")
            .evaluateAll(
              (cards, ids) =>
                cards
                  .map((card) => card.dataset.card)
                  .filter((id) => ids.includes(id)),
              ["mara", road[0], target, road[1]],
            );
          assert.deepEqual(visibleOrder, ["mara", target, road[0], road[1]]);
          await page.screenshot({
            path: new URL(`road-${journey.name}-${target}-${width}.png`, output)
              .pathname,
            fullPage: true,
          });
          await page.keyboard.press("Escape");
        }
        if (
          [
            "greek-road-athens-piraeus",
            "greek-athens",
            "greek-piraeus",
          ].includes(target)
        ) {
          await page.waitForFunction(() =>
            [...document.querySelectorAll("#backdrop")].every(
              (img) => img.complete && img.naturalWidth > 0,
            ),
          );
          await page.screenshot({
            path: new URL(`${target}-${width}.png`, output).pathname,
            fullPage: true,
          });
        }
        if (target === "greek-road-athens-piraeus") {
          const before = await state();
          await page.reload();
          await settle();
          assert.equal(
            (await state()).actors.mara.place,
            before.actors.mara.place,
          );
          await selectCard(page, "greek-athens", { touch: width === 390 });
          assert.equal(
            await page
              .locator('#hand [data-card="greek-athens"]')
              .getAttribute("aria-pressed"),
            "true",
          );
          await page.keyboard.press("Escape");
        }
      }
      assert.deepEqual(errors, []);
      console.log(
        `Greek travel (${journey.name}): ${width}px, Mara first, roads with their ends stacked behind, the gates, reload, and return passed.`,
      );
      await page.close();
    }
} finally {
  await browser?.close();
  await new Promise((done) => server.close(done));
}
