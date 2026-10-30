import { packDefinitions } from "../card-game/pack-registry.mjs";

export const topicForChoice = (choiceId) =>
  choiceId &&
  packDefinitions
    .flatMap((pack) => pack.topics || [])
    .find((topic) => topic.choiceId === choiceId);

// Use the same holder reveal and selection gestures as a player.
export async function revealCard(page, id) {
  const card = page.locator(`#hand [data-card="${id}"]`);
  const frame = card.locator("..");
  if ((await frame.getAttribute("hidden")) !== null) {
    const holder = await frame.getAttribute("data-holder");
    const owner = await revealCard(page, holder);
    await owner.click();
  }
  await card.scrollIntoViewIfNeeded();
  return card;
}
// A held item stays raised through plays and new targets (#1417, #1435), so
// a scripted step that names its own cards first lowers it, as Escape does.
export async function clearSelection(page) {
  if (await page.locator('#hand .card[aria-pressed="true"]').count())
    await page.keyboard.press("Escape");
}
export async function selectCard(page, id, { touch = false } = {}) {
  const frame = page.locator(`#hand [data-card="${id}"]`).locator("..");
  const holder =
    (await frame.getAttribute("hidden")) !== null
      ? await frame.getAttribute("data-holder")
      : null;
  const card = await revealCard(page, id);
  if (touch) await card.tap();
  else await card.click();
  // Keep the chosen child raised while returning its browsing avatar to the stack.
  if (holder) {
    const owner = page.locator(`#hand [data-card="${holder}"]`);
    if (
      (await owner.getAttribute("aria-pressed")) === "true" &&
      !(await owner.evaluate((el) => el.classList.contains("location")))
    ) {
      await owner.scrollIntoViewIfNeeded();
      if (touch) await owner.tap();
      else await owner.click();
    }
  }
}
