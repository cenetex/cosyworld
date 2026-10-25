import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
async function replace(path, before, after, count = 1) {
  const text = await readFile(path, "utf8");
  assert.equal(text.split(before).length - 1, count, `Unexpected source in ${path}: ${before.slice(0,80)}`);
  await writeFile(path, text.replaceAll(before, after));
}
await replace("v2/card-game/world.mjs", `          avatars: knownActors(s).filter(
            (id) =>
              id !== actor && s.actors[id].place === s.actors[actor].place,
          ),`, `          // Include the actual required participants, even before Vale meets
          // them. Keep nearby witnesses within the receipt's two-person bound.
          avatars: [...new Set([
            ...target.avatars,
            ...actorIds.filter((id) => id !== actor && entityActive(s, id) &&
              s.actors[id].place === s.actors[actor].place),
          ])].slice(0, 2).sort((a, b) => actorIds.indexOf(a) - actorIds.indexOf(b)),`);
await replace("test/fixtures/card-narrative-contexts.mjs",
  `  const harbor = playCard(pond, "move", null, "greek-harbor");`,
  `  const signalStart = structuredClone(pond);
  signalStart.items.cloth.holder = "vale";
  signalStart.items.lamp.fuel = 12;
  const firstCover = playCard(signalStart, "cover", "cloth", "lamp");
  const firstFlash = playCard(firstCover, "take", "cloth");
  const secondCover = playCard(firstFlash, "cover", "cloth", "lamp");
  const ship = playCard(secondCover, "take", "cloth");
  const harbor = playCard(ship, "move", null, "greek-harbor");`);
await replace("test/fixtures/card-narrative-contexts.mjs",
  `    ["Greek harbor crossing", harbor],`,
  `    ["first lamp covering", firstCover],
    ["first lamp flash", firstFlash],
    ["second lamp covering", secondCover],
    ["ship summoned", ship],
    ["reload summoned ship", decodeSave(encodeSave(ship))],
    ["Steam Clock return bell", playCard(clearing, "ring", null, "clearing")],
    ["Greek harbor crossing", harbor],`);
const testPath = "test/card-ship-ritual.test.mjs";
await writeFile(testPath, await readFile(testPath, "utf8") + `
// NPCs can fulfil their own meetings before the player knows the witness.
import { enableMotives } from "../v2/card-game/motives.mjs";
test("the four-action crossing preserves an NPC receipt for a witness Vale has not met", () => {
  let s = enableMotives(createWorld({ opening: true }), {
    questPrograms: true, personalQuests: true,
  });
  s = act(s, "light", "lamp");
  s = act(s, "move", null, "pond");
  s.items.cloth.holder = "pond";
  s.items.oil.holder = "pond";
  s.items.lamp.fuel = 12;
  assert.equal(s.opening.met.keeper, undefined);
  s = summon(s);
  s = act(s, "drop", "cloth", "pond");
  s = act(s, "move", null, "greek-harbor");
  s = act(s, "snuff", "lamp");
  const receipt = s.log.find(e => e.kind === "quest" && e.actorId === "moth" && e.step === 1);
  assert(receipt);
  assert.deepEqual(receipt.fulfillment.avatars, ["keeper"]);
  assert.equal(s.opening.met.keeper, undefined);
  assert.deepEqual(reload(s), s);
});
`);
// Stage the unique finite oil flask at the Greek harbor, not on the shore
// where Pip legitimately takes it for his own quest. Refuel there through
// real plays before each return. The ritual and capacity rules remain strict.
await replace("test/card-greek-drama.test.mjs", '  world.items.cloth.holder = "pond";\n  world.items.oil.holder = "pond";',
  '  world.items.cloth.holder = "vale";\n  world.items.oil.holder = HARBOR;');
{
  const path = "test/card-greek-drama.test.mjs";
  let text = await readFile(path, "utf8");
  const start = text.indexOf("function move(world, target) {");
  const end = text.indexOf("\nconst walk =", start);
  assert(start >= 0 && end > start);
  text = text.slice(0, start) + `function move(world, target) {
  const boarding = world.actors.vale.place === "pond" && target === HARBOR;
  if (world.actors.vale.place === HARBOR && target === "pond") {
    if (world.items.lamp.lit) world = act(world,"snuff",{item:"lamp"});
    while (world.items.lamp.fuel < 7) world = act(world,"refill",{item:"oil"});
    if (rootHolder(world,"cloth") !== "vale") world = act(world,"take",{item:"cloth"});
  }
  const nested = boarding && world.items.cloth.holder === "bell";
  if (boarding) {
    if (["lamp", "bell"].includes(world.items.cloth.holder))
      world = act(world,"take",{item:"cloth"});
    if (!world.items.lamp.lit) world = act(world,"light",{item:"lamp"});
    for (let i=0;i<2;i++) {
      world = act(world,"cover",{item:"cloth",target:"lamp"});
      world = act(world,"take",{item:"cloth"});
    }
    if (nested) world = act(world,"cover",{item:"cloth",target:"bell"});
  }
  expect(exits(world, world.actors.vale.place, "vale")).toContain(target);
  expect(availableCards(world)).toContain(target);
  const action = cardPlay(world, [target]).action;
  expect(action).toMatchObject({ kind: "move", target });
  const result = play(world, action);
  expect(result.ok, result.error).toBe(true);
  expect(result.state.actors.vale.place).toBe(target);
  world = result.state;
  if (boarding) {
    if (world.items.lamp.lit) world = act(world,"snuff",{item:"lamp"});
    // Reserve capacity for funeral supplies, then collect this same cloth
    // at the harbor before a return. The nested-custody case keeps its pair.
    if (!nested) world = act(world,"drop",{item:"cloth",target:HARBOR});
  }
  return world;
}
` + text.slice(end);
  await writeFile(path, text);
}
await replace("v2/scripts/smoke-card-greek-drama.mjs", 'fixture.items.oil.holder = "pond";',
  'fixture.items.oil.holder = "greek-harbor";');
await replace("v2/scripts/smoke-card-greek-drama.mjs", `      let s = await state();
      if (s.items.lamp.lit && s.items.lamp.fuel < 7) await playCard("lamp");
      while ((await state()).items.lamp.fuel < 7) await pair("oil","lamp");`,
  `      const s = await state();
      assert.ok(s.items.lamp.fuel >= 6, "the return was provisioned at the harbor");`);
await replace("v2/scripts/smoke-card-greek-drama.mjs", `      const boarding = (await state()).actors.vale.place === "pond" && id === "greek-harbor";
      if (boarding) await signalShip();`,
  `      const before = await state();
      const boarding = before.actors.vale.place === "pond" && id === "greek-harbor";
      if (before.actors.vale.place === "greek-harbor" && id === "pond") {
        if (before.items.lamp.lit) await playCard("lamp");
        while ((await state()).items.lamp.fuel < 7) await pair("oil", "lamp");
      }
      if (boarding) await signalShip();`);
