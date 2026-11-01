import { packDefinitions } from "../card-game/pack-registry.mjs";

// The full suite runs each width of a long journey on its own runner
// (scripts/browser-shards.json). Without COSYWORLD_SMOKE_WIDTHS, run them all.
export function smokeWidths(widths) {
  const only = process.env.COSYWORLD_SMOKE_WIDTHS?.split(",");
  if (!only) return widths;
  const chosen = widths.filter((width) => only.includes(String(width)));
  if (!chosen.length)
    throw new Error(`No journey width among ${only} (has ${widths})`);
  return chosen;
}

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
  // The first tap uncovers; a tap during the reveal only skips it.
  if ((await card.getAttribute("data-unrevealed")) === "true") {
    await card.click();
    await page.waitForFunction(
      (id) =>
        !document.querySelector(`#hand [data-card="${id}"]`)?.dataset.revealing,
      id,
    );
  }
  return card;
}
// A held item stays raised through plays and new targets (#1417, #1435), so
// a scripted step that names its own cards first lowers it, as Escape does.
export async function clearSelection(page) {
  if (await page.locator('#hand .card[aria-pressed="true"]').count())
    await page.keyboard.press("Escape");
}
// A standoff locks its room, so a scripted walk talks its way out first.
export async function endStandoff(page, world, actor = "vale") {
  const fight = world.standoffs?.find((c) =>
    [c.challenger, c.defender].includes(actor),
  );
  if (!fight) return false;
  await clearSelection(page);
  await selectCard(
    page,
    fight.challenger === actor ? fight.defender : fight.challenger,
  );
  await page.locator('#card-actions [data-action="talk"]').click();
  return true;
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
// The beat stack's cards take real pointer hits: the front card under its own
// centre, and the card behind under its peeking top line (#1538).
export async function stackHits(page) {
  return page.evaluate(() => {
    const hit = (id, dy) => {
      const card = document.getElementById(id);
      if (!card || card.hidden) return null;
      const box = card.getBoundingClientRect();
      const y = dy ? box.top + dy : box.top + box.height / 2;
      return Boolean(
        document
          .elementFromPoint(box.left + box.width / 2, y)
          ?.closest(`#${id}`),
      );
    };
    return { front: hit("speech-row"), behind: hit("beat-behind", 6) };
  });
}
