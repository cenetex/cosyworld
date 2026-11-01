import { selectCard } from "./card-browser-helpers.mjs";
import { legalActions } from "../card-game/world.mjs";
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { chromium } from "playwright";
import { createServer } from "../card-game/serve.mjs";
import { createWorld, addLog } from "../card-game/world.mjs";
import { profiles } from "../card-game/memory.mjs";
import { humanAvatarIds } from "../card-game/human-cast.mjs";

// Real shared-view rendering with fixed snapshots. The scene computes the gaze;
// the browser must turn the actual artwork toward the other staged portrait.
const output = "output/card-facing";
await mkdir(output, { recursive: true });
const server = createServer();
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ headless: true });
try {
  const pairs = [
    ...humanAvatarIds.map((actor) => ({ actor, resident: "greek-baker" })),
    { actor: "mara", resident: "keeper" },
  ];
  // Every portrait runs at desktop width; the phone width checks one human
  // and Mara, since the facing rule does not depend on the portrait.
  for (const width of [1440, 390]) {
    for (const { actor, resident } of width === 1440
      ? pairs
      : [pairs[0], pairs.at(-1)]) {
      for (const mirrored of [false, true]) {
        const world = createWorld();
        world.sharedVersion = 1;
        world.playerActorId = actor;
        world.controlledActors = [actor];
        world.presentActors = [actor];
        world.actors[actor].place = "greek-courtyard";
        world.items.lamp.holder = actor;
        if (resident === "keeper") {
          world.actors.keeper.place = "greek-courtyard";
          world.actors["greek-baker"].place = "greek-well";
        }
        world.crossings["pond-greek-harbor"].discovered = true;
        addLog(world, profiles[actor].name, "The traveler arrives.", {
          kind: "action",
          verb: "move",
          actorId: actor,
          fromLocationId: mirrored ? "greek-well" : "greek-harbor",
          locationId: "greek-courtyard",
        });
        const snapshot = {
          actor,
          world,
          now: Date.now(),
          actions: legalActions(world),
          queue: [],
          history: [],
          claimed: humanAvatarIds.map((id) => id === actor),
          present: humanAvatarIds.map((id) => id === actor),
        };
        const page = await browser.newPage({
          viewport: { width, height: width === 390 ? 844 : 900 },
          reducedMotion: "reduce",
        });
        const errors = [];
        page.on("pageerror", (error) => errors.push(error.message));
        await page.addInitScript(
          ({ actor, seen }) => {
            const key = `cosyworld.reflected-shore.v1.shared.facing-view.${actor}`;
            localStorage.setItem(key + ".seen", JSON.stringify(seen));
            localStorage.setItem("cosyworld.dialogue.sound", "off");
            localStorage.setItem(
              "cosyworld.room-music",
              JSON.stringify({ enabled: false }),
            );
          },
          {
            actor,
            seen: [...Object.keys(profiles), "lamp"],
          },
        );
        await page.route("**/auth/account", (route) =>
          route.fulfill({ json: { authenticated: true } }),
        );
        await page.route("**/card-game/shared/worlds/facing-view**", (route) =>
          route.fulfill({ json: snapshot }),
        );
        await page.goto(`${origin}/?world=facing-view`);
        await page.waitForFunction(
          ({ actor, resident }) => {
            const portraits = [
              ...document.querySelectorAll(
                '#cast .portrait[aria-hidden="false"]',
              ),
            ];
            return (
              portraits.length === 2 &&
              [actor, resident].every((id) =>
                portraits.some(
                  (p) =>
                    p.dataset.avatar === id &&
                    p.querySelector("img").complete &&
                    p.querySelector("img").naturalWidth > 0,
                ),
              )
            );
          },
          { actor, resident },
        );
        await selectCard(page, "lamp");
        const held = page.locator(
          `[data-avatar="${actor}"] .portrait-held-item`,
        );
        assert.equal(await held.count(), 1);
        const hand = await held.evaluate((el) => {
          const figure = el.closest(".portrait");
          const body = el.parentElement.getBoundingClientRect();
          const box = el.getBoundingClientRect();
          const flip = figure.querySelector(".portrait-body > img").dataset
            .flip;
          const nativeX =
            parseFloat(getComputedStyle(figure).getPropertyValue("--hand-x")) /
            100;
          return {
            flip,
            figureFlip: figure.dataset.flip,
            actual: (box.x + box.width / 2 - body.x) / body.width,
            expected: flip === "true" ? 1 - nativeX : nativeX,
          };
        });
        assert.equal(hand.figureFlip, hand.flip);
        assert(
          Math.abs(hand.actual - hand.expected) < 0.01,
          JSON.stringify(hand),
        );
        const staged = await page
          .locator('#cast .portrait[aria-hidden="false"]')
          .evaluateAll((figures) =>
            figures.map((figure) => {
              const image = figure.querySelector("img"),
                bounds = figure.getBoundingClientRect();
              return {
                id: figure.dataset.avatar,
                gaze: figure.dataset.gaze,
                facing: figure.dataset.facing,
                flip: image.dataset.flip,
                scaleX: new DOMMatrixReadOnly(getComputedStyle(image).transform)
                  .a,
                x: bounds.x + bounds.width / 2,
                src: image.getAttribute("src"),
              };
            }),
          );
        for (const figure of staged) {
          const target = staged.find((other) => other.id === figure.gaze);
          assert(target, JSON.stringify(staged));
          const desired = target.x > figure.x ? "right" : "left";
          assert.equal(figure.facing, desired);
          const native =
            figure.id === actor
              ? "right"
              : figure.id === "keeper"
                ? desired
                : "left";
          if (figure.id === "keeper")
            assert.equal(
              figure.src,
              await page.evaluate(
                async (source) =>
                  (await import("/card-game/images.mjs")).imageUrl(source),
                `./assets/keeper${desired === "right" ? "-right" : ""}.png`,
              ),
            );
          const flip = native !== desired;
          assert.equal(
            figure.flip,
            String(flip),
            `${actor} ${width}px ${figure.id}`,
          );
          assert.equal(figure.scaleX, flip ? -1 : 1);
        }
        if (["mara", "vale"].includes(actor))
          await page.screenshot({
            path: `${output}/${resident}-${actor}-${mirrored ? "left" : "right"}-${width}.png`,
            fullPage: true,
          });
        assert.deepEqual(errors, []);
        await page.close();
      }
    }
    console.log(
      `Stage facing: ${width === 1440 ? "all eight shared avatars" : "one shared avatar"} with Dione, both stage orders, plus both Keeper variants passed at ${width}px.`,
    );
  }
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
