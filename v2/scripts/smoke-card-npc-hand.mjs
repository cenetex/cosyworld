import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { chromium } from "playwright";
import { createServer } from "../card-game/serve.mjs";
import { createWorld, encodeSave, legalActions, nameOf, play } from "../card-game/world.mjs";
import { settleHeldItems } from "../card-game/held-item.mjs";
import { createLandingWorld } from "../card-game/pack-landing.mjs";
import { packDefinition } from "../card-game/pack-registry.mjs";
import { profiles } from "../card-game/memory.mjs";
import { openingFixture } from "../../test/helpers/greek-opening.mjs";
import { readyActionButton, revealCard, selectCard, smokeWidths, tapCard } from "./card-browser-helpers.mjs";

const act = (world, kind, target) => {
  const result = play(world, legalActions(world).find(a => a.kind === kind && a.target === target));
  assert.ok(result.ok, result.error);
  return result.state;
};
function fixture(actor, sleeping) {
  let world = actor === "greek-guard" ? openingFixture("burial").decree
    : actor === "hoppycat-fable" ? createLandingWorld(packDefinition("hoppycat-archive"), 7) : createWorld();
  const gift = actor === "greek-guard" ? "greek-creon-writ" : actor === "hoppycat-fable" ? "hoppycat-meraki-brush" : "bell";
  const other = actor === "greek-guard" ? "greek-decree" : actor === "hoppycat-fable" ? "hoppycat-provenance-card" : "oil";
  if (actor === "hoppycat-fable") {
    world = act(world, "move", "hoppycat-meraki-atelier");
    world = act(world, "talk", actor);
  }
  if (actor === "mara") {
    world.sharedVersion = 1;
    world.controlledActors = world.presentActors = ["vale"];
  }
  world.actors.vale.place = world.actors[actor].place;
  world.items.lamp.holder = "pond";
  world.items.cloth.holder = "vale";
  world.items[gift].holder = "vale";
  world.items[other].holder = actor;
  if (actor !== "greek-guard")
    world.actors[actor].want = { kind: "item", target: gift, since: world.turn, refusals: 0 };
  if (sleeping) world.actors[actor].sleeping = { since: world.turn, place: world.actors[actor].place, present: [] };
  settleHeldItems(world);
  world.actors[actor].heldItem = other;
  return { world, gift, other };
}
const output = new URL("../../output/npc-hand/", import.meta.url);
await mkdir(output, { recursive: true });
const server = createServer();
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
const browser = await chromium.launch({ headless: true });
try {
  for (const width of smokeWidths([1440, 390]))
    for (const [actor, sleeping] of [["greek-guard", false], ["hoppycat-fable", false], ["mara", false], ["mara", true]]) {
      const { world, gift, other } = fixture(actor, sleeping);
      const page = await browser.newPage({ viewport: { width, height: width === 390 ? 844 : 900 } });
      const errors = [];
      page.on("pageerror", error => errors.push(error.message));
      const table = `npc-hand-${actor}-${sleeping}-${width}`;
      const key = `cosyworld.reflected-shore.v1.${table}`;
      await page.addInitScript(({ key, save, seen, other }) => {
        if (!localStorage.getItem(key)) {
          localStorage.setItem(key, save);
          localStorage.setItem(`${key}.seen`, JSON.stringify(seen));
          localStorage.setItem(`${key}.seen.covered`, JSON.stringify([other]));
        }
        localStorage.setItem("cosyworld.dialogue.sound", "off");
      }, { key, save: encodeSave(world), seen: Object.keys(profiles).filter(id => id !== other), other });
      await page.route("**/card-game/text", route => {
        const context = route.request().postDataJSON();
        return route.fulfill({ json: { revision: context.revision, model: "npc-hand-proof",
          entries: context.entities.map(({ id }) => ({ id, text: "Let us consider this." })) } });
      });
      const ready = () => page.waitForFunction(() => {
        const next = document.getElementById("dialogue-advance");
        if (next?.checkVisibility()) next.click();
        return document.getElementById("hand")?.dataset.cooling === "false";
      }, null, { polling: 40 });
      const card = page.locator(`#hand [data-card="${actor}"]`);
      const stage = page.locator(`#cast [data-avatar="${actor}"]`);
      const saved = () => page.evaluate(key => JSON.parse(localStorage.getItem(key)), key);
      const shot = name => page.screenshot({ path: new URL(`${actor}-${sleeping}-${name}-${width}.png`, output).pathname });
      const hands = async item => {
        for (const surface of [card, stage]) {
          const sticker = surface.locator(".portrait-held-item");
          assert.equal(await sticker.count(), sleeping ? 0 : 1);
          if (sleeping) continue;
          assert.equal(await sticker.getAttribute("data-item"), item);
          const image = sticker.locator("img").first();
          assert.equal(await image.evaluate(el => getComputedStyle(el).objectFit), "contain");
          assert.equal(await sticker.evaluate(el => Boolean(el.closest(".art"))), false);
        }
      };
      await page.goto(`http://127.0.0.1:${server.address().port}/?table=${table}`);
      await ready();
      await card.waitFor();
      await stage.waitFor();
      await hands(other);
      assert.equal(await page.locator('#hand [data-card="cloth"]').count(), 1);
      if (sleeping) {
        assert.match(await card.locator(".art img").first().getAttribute("src"), /sleeping/u);
        await tapCard(card);
        assert.match(await card.locator(".sr-only").textContent(), /Carries/u);
        await page.waitForTimeout(300);
        await card.scrollIntoViewIfNeeded();
        await shot("asleep");
      } else {
        for (const surface of [card, stage])
          assert.match(await surface.locator(".portrait-held-item img").first().getAttribute("src"), /card-back\.webp/u);
        assert.ok(!(await card.locator(".sr-only").textContent()).includes(nameOf(other)));
        await tapCard(card); // One tap opens the NPC's details and its one item.
        assert.equal(await card.getAttribute("aria-pressed"), "true");
        await page.waitForTimeout(300);
        await shot("covered");
        assert.ok(!(await stage.getAttribute("aria-label")).includes(nameOf(other)));
        await revealCard(page, other);
        await hands(other);
        assert.ok(!(await card.locator(".portrait-held-item img").first().getAttribute("src")).includes("card-back"));
        await page.keyboard.press("Escape");
        await selectCard(page, gift);
        await selectCard(page, actor);
        await readyActionButton(page, "give").click();
        await ready();
        const after = await saved();
        assert.equal(after.items[gift].holder, actor);
        assert.equal(after.items[other].holder, actor);
        assert.equal(after.actors[actor].heldItem, gift);
        assert.equal(after.turn, world.turn + 1);
        assert.equal(after.items.cloth.holder, "vale");
        assert.equal(await page.locator('#hand [data-card="cloth"]').count(), 1);
        await hands(gift);
        await page.locator("#beat-behind").click({ position: { x: 20, y: 4 } });
        await page.locator("#live-line").waitFor();
        await hands(gift); // Earlier words keep current physical custody.
        await page.locator("#live-line").click();
        assert.equal(await page.locator(`#hand [data-card="${other}"]`).count(), 0);
        assert.match(await card.locator(".sr-only").textContent(), /Holds/u);
        await page.keyboard.press("Escape");
        await card.scrollIntoViewIfNeeded();
        await page.waitForTimeout(300);
        await shot("resting");
        await tapCard(card);
        await page.waitForTimeout(300);
        await shot("raised");
        await page.reload();
        await ready();
        await hands(gift);
        assert.equal((await saved()).items[other].holder, actor);
        await selectCard(page, gift);
        await page.waitForFunction(() => {
          document.getElementById("dialogue-advance")?.click();
          return document.querySelector('#card-actions [data-action="ask"]')?.checkVisibility();
        }, null, { polling: 40 });
      }
      assert.deepEqual(errors, []);
      await page.close();
      console.log(`NPC hand ${actor} sleeping=${sleeping}: transfer, discovery and custody passed at ${width}px.`);
    }
} finally {
  await browser.close();
  server.close();
}
