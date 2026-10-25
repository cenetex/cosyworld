// Keep long-lived Greek-quest regression journeys inside the real lamp rules.
import { readFile, writeFile } from "node:fs/promises";
import assert from "node:assert/strict";
async function replace(path, before, after) {
  const text = await readFile(path, "utf8");
  assert.equal(text.split(before).length - 1, 1, `Unexpected source in ${path}`);
  await writeFile(path, text.replace(before, after));
}
await replace("test/card-greek-drama.test.mjs",
  'function move(world, target) {\n  expect(exits(world, world.actors.vale.place, "vale")).toContain(target);',
  `function move(world, target) {
  const boarding = world.actors.vale.place === "pond" && target === HARBOR;
  // The old fixture crossed permanently open topology. Now conserve the real
  // lamp during long Greek episodes, and relight it for each boarding.
  if (boarding && !world.items.lamp.lit) {
    expect(world.items.lamp.fuel).toBeGreaterThan(0);
    world = act(world, "light", { item: "lamp" });
  }
  expect(exits(world, world.actors.vale.place, "vale")).toContain(target);`);
await replace("test/card-greek-drama.test.mjs",
  '  expect(result.state.actors.vale.place).toBe(target);\n  return result.state;\n}',
  `  expect(result.state.actors.vale.place).toBe(target);
  return boarding && result.state.items.lamp.lit
    ? act(result.state, "snuff", { item: "lamp" })
    : result.state;
}`);
await replace("v2/scripts/smoke-card-greek-drama.mjs",
  `    const travel = async (id) => {
      await playCard(id);
      assert.equal((await state()).actors.vale.place, id, \`travel to \${id}\`);
      assert.equal(await page.textContent("#place-title"), places[id].name);
    };`,
  `    const travel = async (id) => {
      const before = await state();
      const boarding = before.actors.vale.place === "pond" && id === "greek-harbor";
      if (boarding && !before.items.lamp.lit) {
        assert.ok(before.items.lamp.fuel > 0);
        await playCard("lamp");
      }
      await playCard(id);
      assert.equal((await state()).actors.vale.place, id, \`travel to \${id}\`);
      assert.equal(await page.textContent("#place-title"), places[id].name);
      // Preserve fuel through long episodes by using the ordinary lamp card.
      if (boarding && (await state()).items.lamp.lit) await playCard("lamp");
    };`);
await replace("v2/scripts/smoke-card-greek-drama.mjs",
  '    // A second tab\'s committed journey uses the same migration and UI rebuild.\n    const updated = commit(current, "move", "greek-harbor");',
  `    // A second tab's committed journey uses the same migration and UI rebuild.
    // Reopen the crossing through a real card play, not a forged state edit.
    if (!current.items.lamp.lit) await playCard("lamp");
    current = await state();
    const updated = commit(current, "move", "greek-harbor");`);
