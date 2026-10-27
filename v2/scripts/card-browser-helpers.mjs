// Use the same holder reveal and selection gestures as a player.
export async function revealCard(page, id) {
  const card = page.locator(`#hand [data-card="${id}"]`);
  const frame = card.locator("..");
  if ((await frame.getAttribute("hidden")) !== null) {
    const holder = await frame.getAttribute("data-holder");
    const owner = await revealCard(page, holder);
    await owner.click();
  }
  if ((await frame.getAttribute("data-stacked")) === "true") {
    const holder = await frame.getAttribute("data-holder");
    const top = page
      .locator(`#hand .quest-frame[data-holder="${holder}"] .card`)
      .first();
    await top.scrollIntoViewIfNeeded();
    await top.click();
  }
  await card.scrollIntoViewIfNeeded();
  return card;
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
