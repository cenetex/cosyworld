// The pack opening (pack-opening.mjs). Arriving at a place with three or more
// cards not yet turned, they lie in the hand as ONE face-down stack. Tapping
// it raises the hand and the cards rise into the row, still face down, a
// Rare or better showing only a rim glow. With nothing chosen but the held
// item, the one button is the whole descriptor (New cards unlocked, Tap to
// reveal all), on arrival too; choosing a card puts it away. A chosen
// face-down card shows its own Reveal. Reveal all turns the rest commons
// first; a tap finishes the run; All cards revealed, Tap to continue settles
// them back into the hand. A
// locked box in the pack is turned and stays locked. Nothing is named before
// it is turned. At 390 and 1440 px, and with reduced motion.
//
// The place is chosen at run time by counting the cards each place deals;
// the unturned set is seeded into the save's seen list.
//
//   node v2/scripts/smoke-card-pack-opening.mjs [screenshot-dir]
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { chromium } from "playwright";
import { createServer } from "../card-game/serve.mjs";
import { availableCards, cardPlay } from "../card-game/cards.mjs";
import { heldItem } from "../card-game/held-item.mjs";
import { isLockedBox } from "../card-game/locked-box.mjs";
import { levelTier } from "../card-game/level-tiers.mjs";
import { cardLevel } from "../card-game/rarity.mjs";
import {
  createWorld,
  encodeSave,
  legalActions,
  nameOf,
  people,
  places,
  play,
  things,
} from "../card-game/world.mjs";
import { createPipWorld } from "../card-game/pip-landing.mjs";
import { deck } from "../card-game/world/arcana.mjs";
import {
  clearSelection,
  focusedHandCard,
  holdItem,
  readyActionButton,
  selectCard,
  settleHand,
  tapCard,
  unreachableCards,
} from "./card-browser-helpers.mjs";

const shots = process.argv[2]
  ? new URL(`file://${process.argv[2].replace(/\/?$/u, "/")}`)
  : null;
if (shots) await mkdir(shots, { recursive: true });

// The place that deals the most cards, with a locked box and a Rare or better
// among them when one does. Counted now, from the rules, not named.
function chooseScenario() {
  let best = null;
  for (const place of Object.keys(places)) {
    let world;
    try {
      world = createWorld({ opening: false, seed: 7 });
      world.actors.vale.place = place;
    } catch {
      continue;
    }
    let here;
    try {
      here = availableCards(world).filter(
        (id) => id !== "vale" && !id.startsWith("quest:"),
      );
    } catch {
      continue;
    }
    const boxes = here.filter((id) => isLockedBox(world, id)).length,
      rare = here.filter(
        (id) => !id.startsWith("quest:") && levelTier(cardLevel(world, id)).rank >= 2,
      ).length;
    const score = here.length + (boxes ? 3 : 0) + (rare ? 3 : 0);
    if (!best || score > best.score) best = { place, score, here, world, boxes, rare };
  }
  assert.ok(best && best.here.length >= 4, "a place deals four or more cards");
  return best;
}
const scenario = chooseScenario();
console.log(
  `scenario: ${scenario.place}, ${scenario.here.length} cards, ${scenario.boxes} locked, ${scenario.rare} rare or better`,
);

const server = createServer();
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE,
});

async function openTable(width, motion, { covered, tag, place = scenario.place, world: given = null }) {
  const key = `cosyworld.reflected-shore.v1.${tag}`;
  const everything = [
    ...Object.keys(people),
    ...Object.keys(things),
    ...Object.keys(places),
  ];
  const world = given ?? createWorld({ opening: false, seed: 7 });
  if (!given) world.actors.vale.place = place;
  const page = await browser.newPage({
    viewport: { width, height: width < 600 ? 844 : 900 },
    reducedMotion: motion,
  });
  page.setDefaultTimeout(15000);
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.addInitScript(
    ({ key, save, seen, covered }) => {
      if (!localStorage.getItem(key)) {
        localStorage.setItem(key, save);
        localStorage.setItem(`${key}.seen`, JSON.stringify(seen));
        localStorage.setItem(`${key}.seen.covered`, JSON.stringify(covered));
      }
      localStorage.setItem("cosyworld.dialogue.sound", "off");
      localStorage.setItem("cosyworld.room-music", JSON.stringify({ enabled: false }));
    },
    {
      key,
      save: encodeSave(world),
      seen: everything.filter((id) => !covered.includes(id)),
      covered,
    },
  );
  await page.route("**/card-game/text", (route) => {
    const input = route.request().postDataJSON();
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        revision: input.revision,
        model: "pack-fixture",
        entries: input.entities.map(({ id }) => ({ id, text: "There is time to look around." })),
      }),
    });
  });
  await page.goto(`${origin}/?table=${tag}`);
  await page.waitForFunction(() => document.querySelector("#hand")?.dataset.cooling === "false");
  return { page, key, errors };
}

// The pack's one button is the whole descriptor: its sentence, and the tap
// cue in its corner.
const buttons = (page) =>
  page.evaluate(() =>
    [...document.querySelectorAll("#card-actions button")]
      .filter((b) => b.checkVisibility())
      .map((b) => `${b.textContent.trim()} / ${b.dataset.tapHint}`),
  );
const ASKS = {
  Reveal: "New card unlocked / Tap to reveal",
  "Reveal all": "New cards unlocked / Tap to reveal all",
  "Tap to finish": "Turning the cards / Tap to finish",
  Done: "All cards revealed / Tap to continue",
};
const oneButton = async (page, ask, step) => {
  const text = ASKS[ask];
  await page.waitForFunction(
    (text) => {
      const shown = [...document.querySelectorAll("#card-actions button")].filter((b) =>
        b.checkVisibility(),
      );
      return (
        shown.length === 1 &&
        document.querySelector("#action-beat").getAttribute("data-card-tap") === "" &&
        shown[0].dataset.revealing === "false" &&
        `${shown[0].textContent.trim()} / ${shown[0].dataset.tapHint}` === text
      );
    },
    text,
  );
  assert.deepEqual(await buttons(page), [text], step);
  // The button fills its descriptor: no strip is left under it.
  const fill = await page.evaluate(() => {
    const panel = document.querySelector("#action-beat").getBoundingClientRect(),
      button = document.querySelector("#card-actions button").getBoundingClientRect();
    return panel.height - button.height;
  });
  assert.ok(fill <= 4, `${step}: the button fills the descriptor (${fill}px left)`);
};
const unturned = (page, key) =>
  page.evaluate(
    (key) => JSON.parse(localStorage.getItem(`${key}.seen.covered`) || "[]"),
    key,
  );
const handIds = (page) =>
  page.evaluate(() =>
    [...document.querySelectorAll("#hand .card[data-card]")].map((c) => c.dataset.card),
  );

for (const [width, motion] of [
  [390, "no-preference"],
  [1440, "no-preference"],
  [390, "reduce"],
]) {
  const label = `${width}px ${motion}`;
  const tag = `pack-${width}-${motion}`;
  const members = scenario.here;
  const names = members.map((id) => nameOf(id)).filter(Boolean);
  const { page, key, errors } = await openTable(width, motion, { covered: members, tag });
  const shot = async (name) => {
    if (shots) await page.screenshot({ path: new URL(`${tag}-${name}.png`, shots).pathname });
  };

  // 1. One face-down stack, thickness hinting at the count, nothing named.
  await page.waitForFunction(() => document.querySelectorAll('#hand [data-pack="closed"]').length > 1);
  const visibleStacks = await page.evaluate(
    () => [...document.querySelectorAll('#hand [data-pack="closed"]')].filter((f) => !f.hidden).length,
  );
  assert.equal(visibleStacks, 1, `${label}: the pack is one stack`);
  const edges = await page.locator('#hand [data-pack="closed"]:not([hidden]) > .place-edge').count();
  assert.ok(edges >= 1 && edges <= 3, `${label}: the stack's thickness shows ${edges} edges`);
  const hiddenInStack = await page.locator('#hand [data-pack="closed"][hidden]').count();
  assert.equal(hiddenInStack + 1, await page.locator('#hand [data-pack="closed"]').count());
  await oneButton(page, "Reveal all", `${label}: a lowered closed stack asks Reveal all`);
  const closedFacts = await page.evaluate(() => ({
    labels: [...document.querySelectorAll("#hand .card")].map((c) => c.getAttribute("aria-label") || ""),
    levels: [...document.querySelectorAll('#hand [data-pack] .card, #hand [data-pack] > .card')].map((c) => c.dataset.level),
    tells: document.querySelectorAll("#hand [data-tell]").length,
    text: document.body.innerText,
  }));
  for (const name of names)
    for (const text of [...closedFacts.labels, closedFacts.text])
      assert.ok(
        !text.toLowerCase().includes(name.toLowerCase()) || name.length < 4,
        `${label}: "${name}" is named before its card is turned`,
      );
  assert.equal(closedFacts.tells, 0, `${label}: a closed stack shows no tell`);
  const valeCard = (page) =>
    page.evaluate(() => {
      const c = document.querySelector('#hand .card[data-card="vale"]');
      return c && { label: c.getAttribute("aria-label"), numeral: c.querySelector(".card-level")?.textContent ?? null };
    });
  const blank = await valeCard(page);
  assert.ok(blank, `${label}: Vale's card is in the hand`);
  assert.doesNotMatch(blank.label, /level/u, `${label}: Vale with no cards reads no level`);
  assert.equal(blank.numeral, "", `${label}: Vale with no cards shows no numeral`);
  assert.deepEqual(await unreachableCards(page), [], `${label}: a closed pack's cards are reachable`);
  await shot("1-closed");

  // 2. Tap the pack: the hand rises, the cards rise face down, one button.
  await tapCard(page.locator('#hand [data-pack="closed"]:not([hidden]) > .card'));
  await page.waitForFunction(() => document.querySelectorAll('#hand [data-pack="open"]').length > 1);
  assert.equal(await page.locator("body").getAttribute("data-hand-expanded"), "true");
  await page.waitForTimeout(400);
  assert.deepEqual(await buttons(page), [], `${label}: a raised hand puts Reveal all away`);
  const shownOpen = await page.evaluate(
    () => [...document.querySelectorAll('#hand [data-pack="open"]')].filter((f) => !f.hidden).length,
  );
  // The pack also holds the place's offered quests, closed boxes too.
  assert.ok(shownOpen >= members.length, `${label}: every card of the pack is in the row`);
  const open = await page.evaluate(() =>
    [...document.querySelectorAll('#hand [data-pack="open"] > .card')].map((c) => ({
      id: c.dataset.card,
      level: c.dataset.level,
      tier: c.dataset.tier,
      tell: c.dataset.tell || "",
      unrevealed: c.dataset.unrevealed,
      locked: c.dataset.locked,
      glow: c.getAnimations().filter((a) => a.id === "pack-tell").length,
      breathes: c
        .getAnimations()
        .some((a) => a.id === "pack-tell" && a.effect.getKeyframes().some((k) => "opacity" in k)),
      name: c.querySelector(".name")?.textContent.trim() ?? "",
    })),
  );
  assert.equal(open.length, shownOpen);
  for (const card of open) {
    assert.equal(card.level, "1", `${label}: ${card.id} still reads level 1 face down`);
    assert.equal(card.tier, "common", `${label}: ${card.id} still reads common face down`);
    assert.equal(card.name, "", `${label}: ${card.id} has no name face down`);
  }
  const tells = open.filter((card) => card.tell);
  assert.ok(tells.length >= scenario.rare, `${label}: the Rare or better show a tell`);
  assert.ok(tells.length < open.length, `${label}: not every card shows a tell`);
  for (const card of tells) {
    assert.ok(card.glow >= 1, `${label}: ${card.id} glows`);
    assert.equal(card.breathes, motion !== "reduce", `${label}: the glow pulses only with motion`);
  }
  await page.waitForTimeout(700);
  assert.deepEqual(await unreachableCards(page), [], `${label}: an open pack's cards are reachable`);
  await shot("2-open-face-down");

  // 3. A tap inside a pack chooses the card; its own Reveal turns it.
  const first = open.find((card) => card.locked !== "true" && !card.id.startsWith("quest:"));
  const firstCard = page.locator(`#hand [data-card="${first.id}"]`);
  await firstCard.scrollIntoViewIfNeeded();
  await tapCard(firstCard);
  assert.equal(await firstCard.getAttribute("aria-pressed"), "true", `${label}: the tap chose the card`);
  await oneButton(page, "Reveal", `${label}: a chosen face-down card asks Reveal`);
  await page.locator(`#card-actions [data-open-box="${first.id}"]`).click();
  await page.waitForFunction(
    (id) => document.querySelector(`#hand [data-card="${id}"]`)?.dataset.unrevealed === "false",
    first.id,
  );
  assert.ok(!(await unturned(page, key)).includes(first.id), `${label}: the turned card is remembered`);
  await page.waitForFunction(() => !document.querySelector("#hand [data-revealing]"));
  await shot("3-one-turned");

  // Lowering the hand settles the pack; the rest lie closed and Reveal all returns.
  await page.keyboard.press("Escape");
  await page.mouse.move(2, 2);
  await page.waitForFunction(() => !document.querySelector('#hand [data-pack="open"]'));
  await oneButton(page, "Reveal all", `${label}: the lowered stack asks Reveal all again`);

  // 4. Reveal all: one button, "Tap to finish"; mid-run frames.
  await page.locator("#card-actions [data-pack='reveal']").click();
  await oneButton(page, "Tap to finish", `${label}: a run asks to be finished`);
  assert.ok(members.includes(await focusedHandCard(page)), `${label}: Reveal all leaves focus on a card`);
  // 5. A tap finishes it: every card turned, none half turned, one Done.
  // With motion the run still plays once its button shows: past the quarter
  // second double-tap guard, this tap is the skip of the cards still down.
  await page.waitForTimeout(300);
  await shot("4-mid-run");
  const skipped = await page.evaluate(
    ({ key, members }) => {
      const finish = document.querySelector("#card-actions [data-pack='finish']"),
        down = JSON.parse(localStorage.getItem(`${key}.seen.covered`) || "[]").filter((id) =>
          members.includes(id),
        );
      finish?.click();
      return { playing: Boolean(finish), down: down.length };
    },
    { key, members },
  );
  if (motion !== "reduce") {
    assert.ok(skipped.playing, `${label}: the run is still playing`);
    assert.ok(skipped.down >= 1, `${label}: some cards are still face down to skip`);
  }
  await oneButton(page, "Done", `${label}: every card turned asks for Done`);
  await page.waitForFunction(() => !document.querySelector("#hand [data-revealing]"));
  assert.deepEqual(
    (await unturned(page, key)).filter((id) => members.includes(id)),
    [],
    `${label}: nothing is left face down`,
  );
  const turned = await page.evaluate(() =>
    [...document.querySelectorAll('#hand [data-pack="open"] > .card')].map((c) => ({
      id: c.dataset.card,
      unrevealed: c.dataset.unrevealed,
      locked: c.dataset.locked,
      level: c.dataset.level,
      revealing: c.dataset.revealing || "",
      tell: c.dataset.tell || "",
      glow: c.getAnimations().filter((a) => a.id === "pack-tell").length,
    })),
  );
  for (const card of turned) {
    assert.equal(card.unrevealed, "false", `${label}: ${card.id} is turned`);
    assert.equal(card.revealing, "", `${label}: ${card.id} is not half turned`);
    assert.equal(card.tell, "", `${label}: ${card.id} keeps no tell once turned`);
    assert.equal(card.glow, 0, `${label}: ${card.id} keeps no glow once turned`);
  }
  // A locked box in the pack is turned and still locked.
  for (const id of members.filter((id) => isLockedBox(scenario.world, id))) {
    const box = turned.find((card) => card.id === id);
    assert.ok(box, `${label}: the locked box ${id} was in the pack`);
    assert.equal(box.locked, "true", `${label}: ${id} is still locked`);
    assert.ok(!(await unturned(page, key)).includes(id), `${label}: ${id} was turned`);
  }
  assert.match(
    await page.locator("#discovery-announcement").textContent(),
    /^\d+ cards turned\. Rarest: (Common|Uncommon|Rare|Epic|Legendary|Mythic)\.$/u,
    `${label}: one batched announcement`,
  );
  const shownNames = await page.evaluate(
    () => [...document.querySelectorAll('#hand [data-pack="open"] .name')].map((n) => n.textContent.trim()).filter(Boolean),
  );
  assert.ok(shownNames.length >= 1, `${label}: turned cards show their names`);
  await shot("5-all-turned-done");

  // 6. Done settles the cards back into the hand.
  const before = await handIds(page);
  // A press right after the last turn is taken for the double tap of
  // "Tap to finish" and ignored (a quarter second).
  await page.waitForTimeout(300);
  await page.locator("#card-actions [data-pack='done']").click();
  await page.waitForFunction(() => !document.querySelector("#hand [data-pack]"));
  await page.waitForTimeout(700);
  assert.ok(before.includes(await focusedHandCard(page)), `${label}: Done leaves focus on a card`);
  assert.equal(await page.locator("body").getAttribute("data-hand-expanded"), "false");
  assert.deepEqual([...(await handIds(page))].sort(), [...before].sort(), `${label}: every card is in the hand`);
  assert.equal(await page.locator("#hand [data-unrevealed='true']").count(), 0);
  assert.equal(await page.locator("#hand [data-pack]").count(), 0);
  assert.deepEqual(await unreachableCards(page), [], `${label}: settled cards are reachable`);
  await shot("6-settled");
  assert.deepEqual(errors, [], `${label}: no page errors`);
  await page.close();
}

function chooseArrival(held) {
  for (const from of Object.keys(places)) {
    try {
      let world = createWorld({ opening: false, seed: 7 });
      world.actors.vale.place = from;
      const item = held
        ? Object.keys(world.items).find((id) => {
            try {
              const tried = structuredClone(world);
              tried.items[id].holder = "vale";
              return heldItem(holdItem(tried, id), "vale") === id;
            } catch {
              return false;
            }
          })
        : null;
      if (held && !item) continue;
      if (item) world.items[item].holder = "vale";
      world = holdItem(world, item);
      const before = availableCards(world);
      for (const move of legalActions(world).filter((a) => a.kind === "move" && !a.item)) {
        const moved = play(world, move);
        if (!moved.ok || heldItem(moved.state, "vale") !== item) continue;
        if (item && cardPlay(moved.state, [item]).action) continue;
        const fresh = availableCards(moved.state).filter(
          (id) => id !== "vale" && !id.startsWith("quest:") && !before.includes(id),
        );
        if (fresh.length >= 3) return { world, to: move.target, fresh, item };
      }
    } catch {
      continue;
    }
  }
  return null;
}
for (const width of [390, 1440])
  for (const held of [false, true]) {
    const arrival = chooseArrival(held);
    assert.ok(arrival, "a move leads to a place that deals a pack");
    const label = `${width}px arrival ${held ? "holding a thing" : "empty handed"}`;
    const { page, errors } = await openTable(width, "no-preference", {
      covered: arrival.fresh,
      tag: `pack-arrival-${width}-${held}`,
      world: arrival.world,
    });
    const chosen = () =>
      page.evaluate(() =>
        [...document.querySelectorAll('#hand .card[aria-pressed="true"]')].map((c) => c.dataset.card),
      );
    await selectCard(page, arrival.to);
    await readyActionButton(page, "move").click();
    await page.waitForFunction(() => document.querySelectorAll('#hand [data-pack="closed"]').length > 1);
    await oneButton(page, "Reveal all", `${label}: the new place asks Reveal all with no tap`);
    assert.deepEqual(await chosen(), held ? [arrival.item] : [], `${label}: only the held thing is chosen`);
    assert.equal(await page.locator("#play-readout").textContent(), "", `${label}: the readout names no other play`);
    if (shots) await page.screenshot({ path: new URL(`pack-arrival-${width}-${held}.png`, shots).pathname });
    await tapCard(page.locator('#hand [data-card="vale"]'));
    assert.ok((await chosen()).includes("vale"), `${label}: Vale is chosen`);
    assert.equal(
      await page.locator("#card-actions [data-pack]").count(),
      0,
      `${label}: another chosen card puts Reveal all away`,
    );
    assert.deepEqual(errors, [], `${label}: no page errors`);
    await page.close();
  }

// Fewer than three unturned cards are no pack: they turn in place as before.
{
  const pair = scenario.here.filter((id) => !id.startsWith("quest:")).slice(0, 2);
  const { page, key, errors } = await openTable(390, "no-preference", {
    covered: pair,
    tag: "pack-pair",
  });
  await page.waitForTimeout(800);
  assert.equal(await page.locator("#hand [data-pack]").count(), 0, "two cards form no pack");
  assert.ok((await unturned(page, key)).length >= 1);
  assert.deepEqual(errors, []);
  await page.close();
}

function chooseHandover() {
  for (const place of Object.keys(places)) {
    try {
      const world = createWorld({ opening: false, seed: 7 });
      world.actors.vale.place = place;
      const here = availableCards(world).filter(
        (id) => id !== "vale" && !id.startsWith("quest:"),
      );
      if (here.length < 3) continue;
      for (const take of legalActions(world).filter((a) => a.kind === "take")) {
        if (world.items[take.item].holder !== place || isLockedBox(world, take.item)) continue;
        const taken = play(world, take);
        if (!taken.ok) continue;
        const give = legalActions(taken.state)
          .filter((a) => a.kind === "give" && a.item === take.item && here.includes(a.target))
          .find((a) => {
            const given = play(taken.state, a);
            return given.ok && given.state.items[a.item].holder === a.target;
          });
        if (give) return { place, here, item: take.item, resident: give.target };
      }
    } catch {
      continue;
    }
  }
  return null;
}
const handover = chooseHandover();
assert.ok(handover, "a place has a loose thing to take and a resident to give it to");
console.log(`handover: ${handover.item} at ${handover.place}, then to ${handover.resident}`);

const besideHolder = (page, item, holder) =>
  page.evaluate(
    ({ item, holder }) => {
      const frameOf = (id) => document.querySelector(`#hand [data-card="${id}"]`)?.parentElement,
        frame = frameOf(item),
        owner = frameOf(holder);
      if (!frame || !owner) return { missing: true };
      let lead = frame.previousElementSibling;
      while (lead && lead !== owner && lead.dataset.holder === holder)
        lead = lead.previousElementSibling;
      const shown = [...document.querySelectorAll("#hand > .card-frame")].filter((f) => !f.hidden),
        box = frame.getBoundingClientRect(),
        base = owner.getBoundingClientRect();
      return {
        holder: frame.dataset.holder,
        pack: frame.dataset.pack ?? null,
        hidden: frame.hidden,
        pressed: frame.querySelector(".card").getAttribute("aria-pressed"),
        grouped: lead === owner,
        moving: frame.getAnimations().some((a) => a.playState === "running"),
        between: shown.filter((f) => {
          const left = f.getBoundingClientRect().left;
          return f !== frame && f !== owner && left > base.left && left < box.left;
        }).length,
        right: box.left - base.left,
        drop: Math.abs(box.top - base.top),
        height: base.height,
      };
    },
    { item, holder },
  );
const lies = async (page, item, holder, step, { settled = true } = {}) => {
  const at = await besideHolder(page, item, holder);
  assert.equal(at.holder, holder, `${step}: the card is its holder's`);
  assert.equal(at.pack, null, `${step}: the card has left the pack`);
  assert.equal(at.grouped, true, `${step}: the card lies in its holder's stack in the hand`);
  if (at.hidden || !settled) return at;
  assert.equal(at.between, 0, `${step}: no other card lies between the holder and the card`);
  assert.ok(at.right > 0, `${step}: the card lies after its holder`);
  assert.ok(at.drop < at.height / 2, `${step}: the card lies in its holder's row`);
  return at;
};
const turnAndChoose = async (page, id) => {
  const card = page.locator(`#hand [data-card="${id}"]`);
  for (let tap = 0; tap < 3 && (await card.getAttribute("aria-pressed")) !== "true"; tap++) {
    await tapCard(card);
    const reveal = page.locator(`#card-actions [data-open-box="${id}"]:not([data-revealing="true"])`);
    if ((await card.getAttribute("data-unrevealed")) === "true") await reveal.click();
    await page.waitForFunction(
      (id) => {
        const card = document.querySelector(`#hand [data-card="${id}"]`);
        return card?.dataset.unrevealed === "false" && !card.dataset.revealing;
      },
      id,
    );
    await page.waitForTimeout(300);
  }
  assert.equal(await card.getAttribute("aria-pressed"), "true", `${id} is chosen`);
};
const redraw = async (page) => {
  await tapCard(page.locator('#hand [data-card="vale"]'));
  await page.waitForTimeout(600);
};

for (const [width, motion] of [
  [390, "no-preference"],
  [1440, "no-preference"],
  [390, "reduce"],
]) {
  const label = `${width}px ${motion} handover`;
  const { item, resident, place, here } = handover;
  const { page, errors } = await openTable(width, motion, {
    covered: here,
    tag: `pack-handover-${width}-${motion}`,
    place,
  });
  await page.waitForFunction(() => document.querySelectorAll('#hand [data-pack="closed"]').length > 1);
  await tapCard(page.locator('#hand [data-pack="closed"]:not([hidden]) > .card'));
  await page.waitForFunction(() => document.querySelectorAll('#hand [data-pack="open"]').length > 1);
  await page.waitForTimeout(900);
  await turnAndChoose(page, item);
  await page.locator('#card-actions [data-action="take"]:not([data-revealing="true"])').click();
  const taken = await lies(page, item, "vale", `${label}: at once after Take`, { settled: false });
  assert.equal(taken.hidden, false, `${label}: the taken card shows`);
  assert.equal(taken.pressed, "true", `${label}: the taken card stays chosen`);
  assert.equal(taken.moving, motion !== "reduce", `${label}: the card travels only with motion`);
  if (motion === "reduce") await lies(page, item, "vale", `${label}: at once, without motion`);
  await page.waitForTimeout(700);
  await lies(page, item, "vale", `${label}: settled after Take`);
  assert.ok(
    (await page.locator('#hand [data-pack="open"]').count()) >= 1,
    `${label}: the rest of the pack stays open`,
  );
  await settleHand(page);
  await redraw(page);
  await lies(page, item, "vale", `${label}: after a redraw`);
  if ((await page.locator(`#hand [data-card="${item}"]`).getAttribute("aria-pressed")) !== "true")
    await tapCard(page.locator(`#hand [data-card="${item}"]`));
  await turnAndChoose(page, resident);
  await page.locator('#card-actions [data-action="give"]:not([data-revealing="true"])').click();
  await page.waitForFunction(
    ({ item, resident }) =>
      document.querySelector(`#hand [data-card="${item}"]`)?.parentElement.dataset.holder === resident,
    { item, resident },
  );
  await lies(page, item, resident, `${label}: at once after Give`, { settled: false });
  await page.waitForTimeout(700);
  await lies(page, item, resident, `${label}: settled after Give`);
  await settleHand(page);
  await redraw(page);
  await lies(page, item, resident, `${label}: after a redraw of the gift`);
  assert.deepEqual(errors, [], `${label}: no page errors`);
  await page.close();
}

// A spread the Listener deals for a thing comes as its own face-down cards in
// the same pack: the locked one under the keyhole back from the start, a
// chosen card turned by its own Reveal, the rest by Reveal all.
function spreadWorld() {
  let world = createPipWorld(5);
  const talk = legalActions(world, "vale").find((a) => a.kind === "talk" && a.target === "moth");
  world = play(world, talk, world.revision, "vale").state;
  const known = deck.cards.filter((card) => ![0, 21].includes(card.number)).map((card) => card.id);
  world.actors.vale.upgrades = ["arcanum-0", ...known.sort().slice(0, 4)].sort();
  world.actors.vale.arcana = { proved: [], did: [], level: 1, sale: true };
  world.items.bell.holder = "vale";
  return world;
}
const tarotFaces = (page) =>
  page.evaluate(() =>
    [...document.querySelectorAll('#hand .want-card[data-quest-key^="tarot:vale:"]')].map((c) => ({
      key: c.dataset.questKey,
      face: c.dataset.face ?? "",
      unrevealed: c.dataset.unrevealed,
      back: c.querySelector(".card-back")?.getAttribute("src") ?? "",
      pack: c.parentElement.dataset.pack ?? null,
      shown: !c.parentElement.hidden,
      label: c.getAttribute("aria-label"),
    })),
  );
for (const oneByOne of [false, true]) {
  const label = `spread ${oneByOne ? "one by one" : "Reveal all"}`;
  const { page, errors } = await openTable(390, "no-preference", {
    covered: [],
    tag: `pack-spread-${oneByOne}`,
    world: spreadWorld(),
  });
  const levelled = await page.evaluate(() => document.querySelector('#hand .card[data-card="vale"]')?.getAttribute("aria-label") ?? "");
  assert.match(levelled, /, level 1$/u, `${label}: Vale with a card keeps the level`);
  await selectCard(page, "bell");
  await selectCard(page, "listener");
  await readyActionButton(page, "give").click();
  await page.waitForFunction(
    () => document.querySelectorAll('#hand .want-card[data-quest-key^="tarot:vale:"]').length === 3,
  );
  await settleHand(page);
  const dealt = await tarotFaces(page);
  assert.deepEqual(dealt.map((c) => c.unrevealed), ["true", "true", "true"], `${label}: the spread is dealt face down`);
  assert.deepEqual(dealt.map((c) => c.pack), ["closed", "closed", "closed"], `${label}: the spread is one pack`);
  for (const card of dealt) {
    assert.match(card.label, /^(A face-down card|3 closed boxes\. Select to open\.)$/u, `${label}: ${card.key} is not named face down`);
    assert.match(
      card.back,
      card.face === "locked" ? /tarot-back-locked/u : /tarot-back(?!-locked)/u,
      `${label}: ${card.key} lies under its own back`,
    );
  }
  await clearSelection(page);
  await page.mouse.move(2, 2);
  await oneButton(page, "Reveal all", `${label}: a lowered spread asks Reveal all`);
  assert.equal(
    (await tarotFaces(page)).filter((c) => c.shown).length,
    1,
    `${label}: the lowered spread shows one stack`,
  );
  if (oneByOne) {
    await tapCard(page.locator('#hand [data-pack="closed"]:not([hidden]) > .card'));
    await page.waitForFunction(() => document.querySelectorAll('#hand [data-pack="open"]').length >= 3);
    await page.waitForTimeout(900);
    const up = dealt.find((c) => c.face === "up");
    const card = page.locator(`#hand .want-card[data-quest-key="${up.key}"]`);
    await tapCard(card);
    await oneButton(page, "Reveal", `${label}: a chosen face-down tarot asks Reveal`);
    await page.locator(`#card-actions [data-open-box="${up.key}"]`).click();
    await page.waitForFunction(
      (key) => document.querySelector(`#hand [data-quest-key="${key}"]`)?.dataset.unrevealed === "false",
      up.key,
    );
    assert.match(
      await page.locator("#discovery-announcement").textContent(),
      /^New card: /u,
      `${label}: the turned tarot is announced`,
    );
    await page.waitForFunction(() => !document.querySelector("#hand [data-revealing]"));
  } else {
    await page.locator("#card-actions [data-pack='reveal']").click();
    const finish = page.locator("#card-actions [data-pack='finish']");
    await page.waitForTimeout(400);
    if (await finish.count()) await finish.click();
    await oneButton(page, "Done", `${label}: the turned spread asks for Done`);
    await page.waitForFunction(() => !document.querySelector("#hand [data-revealing]"));
    const turned = await tarotFaces(page);
    for (const card of turned) {
      assert.equal(card.unrevealed, card.face === "down" ? "true" : "false", `${label}: ${card.key} is turned`);
      if (card.face !== "down") assert.match(card.label, /^Quest: Level/u, `${label}: ${card.key} is named`);
    }
    await page.waitForTimeout(300);
    await page.locator("#card-actions [data-pack='done']").click();
    await page.waitForFunction(() => !document.querySelector("#hand [data-pack]"));
  }
  assert.deepEqual(errors, [], `${label}: no page errors`);
  await page.close();
}

await browser.close();
server.close();
console.log("pack opening ok");
