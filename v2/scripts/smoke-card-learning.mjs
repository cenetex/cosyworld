import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { chromium } from "playwright";
import { createServer } from "../card-game/serve.mjs";
import {
  createWorld,
  legalActions,
  play,
  encodeSave,
} from "../card-game/world.mjs";
import { enableMotives } from "../card-game/motives.mjs";
import { guardPost, settleGuards } from "../card-game/resident-guard.mjs";
import { packPeople } from "../card-game/pack-registry.mjs";
import { selectCard } from "./card-browser-helpers.mjs";
import { rest } from "../../test/fixtures/card-rest.mjs";
import {
  narrativeContext,
  applyGeneratedText,
} from "../card-game/narrative.mjs";

function practiceWorld() {
  const w = enableMotives(createWorld());
  w.actors.keeper.place = "station";
  w.items.lamp.holder = "vale";
  w.items.bell.holder = "vale";
  w.items.cloth.holder = "keeper";
  return w;
}
// A flask is always full, so the keeper's spare item is the lamp it values
// least; the flask rests on the station floor.
function spareWorld() {
  const w = practiceWorld();
  w.items.lamp.holder = "keeper";
  w.items.oil.holder = "station";
  return w;
}
const spare = spareWorld();
const requested = play(
  spare,
  legalActions(spare).find((a) => a.kind === "ask" && a.item === "lamp"),
).state;
const tradeStart = spareWorld();
const traded = play(
  tradeStart,
  legalActions(tradeStart).find(
    (a) => a.kind === "trade" && a.item === "bell" && a.receive === "lamp",
  ),
).state;
const probes = [requested, traded].map((practised) => {
  const w = spareWorld();
  w.turn = 2;
  w.revision = 2;
  w.eventSeq = 100;
  w.log = [];
  w.memories.vale.learning = practised.memories.vale.learning;
  return encodeSave(w);
});

let world = enableMotives(createWorld());
world.actors.keeper.place = "station";
world.items.lamp.holder = "vale";
world.items.bell.holder = "keeper";
world = play(
  world,
  legalActions(world).find((a) => a.kind === "ask" && a.item === "oil"),
).state;
// Thoughts and dreams come only on a Wait (#1427), so Vale rests until a
// thought and a dream are both due before the reflection is written.
world = rest(world, { dream: true });
const context = narrativeContext(world);
world = applyGeneratedText(world, context, {
  revision: context.revision,
  model: "fixture-model",
  entries: context.entities.map(({ id }) => ({
    id,
    text: "The shore feels quiet.",
    ...(id === "vale"
      ? {
          reflection: {
            thought: "I expected an easy gift. A fair offer may help.",
            persona: "I am learning to listen before asking again.",
            // Inner-life lines are first person (#1850).
            dream: "I dreamt a little boat carried a gift across the pond.",
          },
        }
      : {}),
  })),
});
world.memories.keeper.innerLife = {
  persona: "Keeper private sentinel.",
  thoughts: [],
  dreams: [],
};
const output =
  process.env.COSYWORLD_LEARNING_SCREENSHOTS || resolve("output/card-learning");
await mkdir(output, { recursive: true });
const server = createServer();
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const browser = await chromium.launch({ headless: true });
try {
  for (const width of [1440, 390]) {
    const page = await browser.newPage({
      viewport: { width, height: 900 },
      reducedMotion: "reduce",
    });
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.addInitScript(
      (save) =>
        localStorage.setItem("cosyworld.reflected-shore.v1.learning", save),
      encodeSave(world),
    );
    await page.route("**/card-game/text", async (route) => {
      const scene = route.request().postDataJSON();
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          revision: scene.revision,
          model: "fixture-model",
          entries: scene.entities.map((e) => ({
            id: e.id,
            text: "I can listen for a moment.",
          })),
        }),
      });
    });
    await page.goto(
      `http://127.0.0.1:${server.address().port}/?table=learning`,
    );
    const choices = await page.evaluate(async (saves) => {
      const { decodeSave, legalActions } = await import("/card-game/world.mjs");
      const { reconsiderPlan } = await import("/card-game/learning.mjs");
      return saves.map((save) => {
        const world = decodeSave(save);
        const before = JSON.stringify(world);
        const actions = legalActions(world);
        const action = actions.find(
          (a) =>
            a.kind === "trade" && a.item === "bell" && a.receive === "lamp",
        );
        const choice = reconsiderPlan(
          world,
          "vale",
          { action, reason: "Seek the lamp." },
          actions,
        );
        if (JSON.stringify(world) !== before)
          throw Error("A preview must preserve the save.");
        return {
          kind: choice.action.kind,
          samples: choice.learning.expected.samples,
        };
      });
    }, probes);
    assert.deepEqual(choices, [
      { kind: "ask", samples: 1 },
      { kind: "trade", samples: 1 },
    ]);
    for (let attempt = 0; attempt < 2; attempt++) {
      await page.getByRole("button", { name: "Menu", exact: true }).click();
      // Inner life opens Memory: the present first, the past below (#1579).
      await page.getByRole("button", { name: "Memory", exact: true }).click();
      const dialog = page.getByRole("dialog", { name: "Memory" });
      await dialog.waitFor();
      const inner = dialog.getByRole("region", { name: "Vale's inner life" });
      await inner.waitFor();
      assert.equal(
        await dialog.evaluate(
          (box) => box.querySelector("#messages > *")?.className,
        ),
        "inner-life",
      );
      // The region's name is visually hidden: what shows opens on "I'm",
      // then "I dream".
      const text = await inner.evaluate((section) =>
        [...section.children]
          .filter((child) => !child.classList.contains("sr-only"))
          .map((child) => child.textContent)
          .join("\n"),
      );
      assert(text.startsWith("I'm Vale. The Lamplighter."), text);
      assert(!text.includes("inner life"));
      assert(!text.includes("I'm becoming"));
      assert(!text.includes("A fair offer may help."));
      assert(!text.includes("learning to listen"));
      assert(text.includes("I dream"));
      assert(text.includes("little boat"));
      assert(text.trim().endsWith("— Vale"));
      assert.equal(
        await dialog.evaluate((box) => {
          const visible = [...box.querySelectorAll("h2, h3")].filter(
            (h) => h.closest(".memory-visit") === null,
          );
          return visible.filter((h) => h.offsetWidth > 1).length;
        }),
        0,
      );
      assert.equal(
        await dialog.getByRole("button", { name: "Save conversation" }).count(),
        0,
      );
      // Measured attempts guide the planner; the panel never shows them.
      assert(!text.includes("measured attempt"));
      assert(!text.includes("Keeper private sentinel"));
      const box = await dialog.boundingBox();
      assert(box.x >= 0 && box.x + box.width <= width + 1);
      if (!attempt)
        await page.screenshot({
          path: `${output}/memory-inner-life-${width}.png`,
          fullPage: true,
        });
      const close = dialog.getByRole("button", { name: "Close", exact: true });
      const at = await close.boundingBox();
      assert(at.x + at.width > box.x + box.width - 48 && at.y < box.y + 48);
      if (attempt) await close.click();
      else {
        // Escape closes it too.
        await page.keyboard.press("Escape");
        await dialog.waitFor({ state: "hidden" });
        await page.reload();
      }
    }
    const guard = "greek-guard",
      beyond = guardPost(guard).to;
    const guarded = createWorld({ seed: 2 });
    guarded.actors.vale.place = "greek-gate";
    guarded.packs["greek-drama"].met[guard] = 0;
    guarded.items["greek-creon-writ"].holder = guard;
    guarded.items["greek-decree"].holder = "vale";
    settleGuards(guarded);
    const key = "cosyworld.reflected-shore.v1.learning-guard";
    await page.evaluate(
      ({ key, save }) => {
        localStorage.setItem(key, save);
        localStorage.setItem(
          `${key}.seen`,
          JSON.stringify([
            "vale",
            "greek-guard",
            "greek-creon-writ",
            "greek-gate",
            "greek-battlefield",
            "greek-courtyard",
          ]),
        );
      },
      { key, save: encodeSave(guarded) },
    );
    await page.goto(
      `http://127.0.0.1:${server.address().port}/?table=learning-guard`,
    );
    const ready = async () => {
      for (let n = 0; n < 375; n++) {
        if (await page.locator("#dialogue-advance").isVisible())
          await page.locator("#dialogue-advance").click();
        if (
          (await page.locator("#hand").getAttribute("data-cooling")) === "false"
        )
          return;
        await page.waitForTimeout(40);
      }
      throw Error("The Guard learning hand stayed busy.");
    };
    await ready();
    await selectCard(page, "greek-creon-writ");
    await page.locator("#card-actions .card-primary").click();
    await ready();
    await page.keyboard.press("Escape");
    await selectCard(page, "vale");
    await selectCard(page, beyond);
    await page.locator("#card-actions .card-primary").click();
    await ready();
    const trial = await page.evaluate(
      (key) =>
        JSON.parse(localStorage.getItem(key)).memories.vale.learning.at(-1),
      key,
    );
    assert.equal(trial.action.kind, "wait");
    assert.equal(trial.action.target, beyond);
    await page.reload();
    await ready();
    assert.deepEqual(
      await page.evaluate(
        (key) =>
          JSON.parse(localStorage.getItem(key)).memories.vale.learning.at(-1),
        key,
      ),
      trial,
    );
    await page.waitForFunction(() =>
      [...document.querySelectorAll("#backdrop, #cast img, .card img")].every(
        (img) => img.complete && img.naturalWidth > 0,
      ),
    );
    await page.screenshot({
      path: `${output}/learned-guard-${width}.png`,
      fullPage: true,
    });
    const fable = "hoppycat-fable",
      companyKey = `${key}-company`;
    const encounter = createWorld({ seed: 7 });
    delete encounter.opening;
    encounter.actors.vale.place = encounter.actors[fable].place;
    encounter.packs[packPeople[fable].packId].met[fable] = 0;
    await page.evaluate(({ key, save }) => localStorage.setItem(key, save), {
      key: companyKey,
      save: encodeSave(encounter),
    });
    await page.goto(
      `http://127.0.0.1:${server.address().port}/?table=learning-guard-company`,
    );
    await ready();
    await selectCard(page, fable);
    assert.equal(
      await page.locator("#card-actions .card-primary").textContent(),
      "Talk",
    );
    await page.locator("#card-actions .card-primary").click();
    await ready();
    const currentPair = () =>
      page.evaluate((key) => {
        const s = JSON.parse(localStorage.getItem(key));
        return s.conversations.find(
          (c) =>
            c.actors.includes("vale") && c.actors.includes("hoppycat-fable"),
        );
      }, companyKey);
    const company = await currentPair();
    assert.ok(Number.isSafeInteger(company.company));
    await page.reload();
    await ready();
    assert.deepEqual(await currentPair(), company);
    const move = await page.evaluate(async (key) => {
      const { decodeSave, legalActions } = await import("/card-game/world.mjs");
      return legalActions(decodeSave(localStorage.getItem(key))).find(
        (a) => a.kind === "move",
      );
    }, companyKey);
    assert.ok(move, "Fable's room has a way to leave");
    await page.keyboard.press("Escape");
    await selectCard(page, move.target);
    await page.locator("#card-actions .card-primary").click();
    await ready();
    const ended = await currentPair();
    assert.equal(ended.company, undefined);
    assert.equal(ended.seq, company.seq);
    assert.deepEqual(errors, []);
    await page.close();
  }
  console.log(
    "Avatar learning browser check passed at desktop and phone widths, including reload and private-panel checks.",
  );
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
