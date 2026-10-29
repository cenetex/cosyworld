import { packDefinitions } from "../card-game/pack-registry.mjs";

export const topicForChoice = (choiceId) =>
  choiceId &&
  packDefinitions
    .flatMap((pack) => pack.topics || [])
    .find((topic) => topic.choiceId === choiceId);

// Use the same holder reveal and selection gestures as a player.
const turns = new WeakMap();
export async function revealCard(page, id) {
  const card = page.locator(`#hand [data-card="${id}"]`);
  const frame = card.locator("..");
  if ((await frame.getAttribute("hidden")) !== null) {
    const holder = await frame.getAttribute("data-holder");
    const owner = await revealCard(page, holder);
    const pressed = await owner.getAttribute("aria-pressed");
    await owner.click();
    if (pressed !== "true") await owner.click();
  }
  if (
    Number(await frame.getAttribute("data-stack-count")) > 1 &&
    (await frame.getAttribute("data-stack-expanded")) === "false" &&
    (await card.getAttribute("aria-pressed")) !== "true"
  ) {
    const holder = await frame.getAttribute("data-holder");
    const kind = await frame.getAttribute("data-stack-kind");
    const top = page.locator(
      `#hand .card-frame[data-holder="${holder}"][data-stack-kind="${kind}"][data-stack-index="0"] .card`,
    );
    await top.scrollIntoViewIfNeeded();
    if ((await top.getAttribute("aria-pressed")) === "true") {
      const last = page
        .locator(
          `#hand .card-frame[data-holder="${holder}"][data-stack-kind="${kind}"] .card`,
        )
        .last();
      await last.scrollIntoViewIfNeeded();
      const size = await last.boundingBox();
      await last.click({ position: { x: size.width - 3, y: 25 } });
    } else await top.click();
  }
  await card.scrollIntoViewIfNeeded();
  return card;
}
export async function selectCard(page, id, { touch = false } = {}) {
  await page.waitForFunction(
    () => document.querySelector("#hand")?.dataset.presentedTurn !== undefined,
  );
  const turn = await page.locator("#hand").getAttribute("data-presented-turn");
  if (turns.has(page) && turns.get(page) !== turn)
    await page.keyboard.press("Escape");
  turns.set(page, turn);
  const card = await revealCard(page, id);
  if (touch) await card.tap();
  else await card.click();
}
