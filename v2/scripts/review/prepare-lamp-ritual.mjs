// Verification-only materializer; the exported candidate contains source/tests,
// not this helper or its isolated workflow.
import assert from "node:assert/strict";
import { readFile, writeFile, copyFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
assert.equal(execFileSync("git",["rev-parse","HEAD"],{encoding:"utf8"}).trim(),
  "2442e6a4236fa7a9e0ea1a92b97076aa3afee85e");
async function replace(path, before, after, count=1) {
  const text=await readFile(path,"utf8");
  assert.equal(text.split(before).length-1,count,`Unexpected source in ${path}: ${before.slice(0,100)}`);
  await writeFile(path,text.replaceAll(before,after));
}
await copyFile(join(dirname(process.argv[1]),"card-ship-ritual.test.mjs"),"test/card-ship-ritual.test.mjs");
await replace("test/card-crossings.test.mjs",'  s.items.lamp.lit = true;\n  return s;',`  s.items.lamp.lit = true;
  s.items.lamp.fuel = 12;
  s.items.cloth.holder = "vale";
  let next = s;
  for (let i = 0; i < 2; i++) {
    next = act(next, "cover", "lamp", "cloth");
    next = act(next, "take", null, "cloth");
  }
  return next;`);
// Keep Greek-quest and custody regressions, but board through real ritual
// actions. The initial shore fixture stages its finite oil and cloth supplies.
{
  const path="test/card-greek-drama.test.mjs";
  let text=await readFile(path,"utf8");
  const start=text.indexOf("function move(world, target) {");
  const end=text.indexOf("\nconst walk =",start);
  assert(start>=0 && end>start);
  text=text.slice(0,start)+`function move(world, target) {
  const boarding = world.actors.vale.place === "pond" && target === HARBOR;
  if (boarding) {
    const clothHolder = world.items.cloth.holder;
    if (["lamp", "bell"].includes(clothHolder)) world = act(world,"take",{item:"cloth"});
    if (world.items.lamp.lit && world.items.lamp.fuel < 8)
      world = act(world,"snuff",{item:"lamp"});
    while (world.items.lamp.fuel < 8) world = act(world,"refill",{item:"oil"});
    if (!world.items.lamp.lit) world = act(world,"light",{item:"lamp"});
    for (let i=0;i<2;i++) {
      world = act(world,"cover",{item:"cloth",target:"lamp"});
      world = act(world,"take",{item:"cloth"});
    }
    if (clothHolder === "bell") world = act(world,"cover",{item:"cloth",target:"bell"});
    else if (clothHolder !== "vale") world = act(world,"drop",{item:"cloth",target:"pond"});
  }
  expect(exits(world, world.actors.vale.place, "vale")).toContain(target);
  expect(availableCards(world)).toContain(target);
  const action = cardPlay(world, [target]).action;
  expect(action).toMatchObject({ kind: "move", target });
  const result = play(world, action);
  expect(result.ok, result.error).toBe(true);
  expect(result.state.actors.vale.place).toBe(target);
  return boarding && result.state.items.lamp.lit
    ? act(result.state,"snuff",{item:"lamp"}) : result.state;
}
`+text.slice(end);
  const before='  return move(world, "pond");';
  assert.equal(text.split(before).length-1,1);
  text=text.replace(before,`  world = move(world, "pond");
  world.items.cloth.holder = "pond";
  world.items.oil.holder = "pond";
  world.items.lamp.fuel = 12;
  return world;`);
  await writeFile(path,text);
}
// Extend the existing actual-UI Greek playthrough with the same ritual.
{
  const path="v2/scripts/smoke-card-greek-drama.mjs";
  let text=await readFile(path,"utf8");
  text=text.replace('fixture.items.lamp.fuel = 12;','fixture.items.lamp.fuel = 12;\nfixture.items.oil.holder = "pond";');
  const start=text.indexOf("    const travel = async (id) => {");
  const end=text.indexOf("    const choose =",start); assert(start>=0&&end>start);
  text=text.slice(0,start)+`    const pair = async (one,two) => {
      await ready();
      await card(one).scrollIntoViewIfNeeded(); await card(one).click();
      await card(two).scrollIntoViewIfNeeded(); await card(two).click();
      await card(two).click(); await ready();
    };
    const signalShip = async () => {
      let s = await state();
      if (s.items.lamp.lit && s.items.lamp.fuel < 7) await playCard("lamp");
      while ((await state()).items.lamp.fuel < 7) await pair("oil","lamp");
      if (!(await state()).items.lamp.lit) await playCard("lamp");
      for(let i=0;i<2;i++) {
        await pair("cloth","lamp"); await playCard("cloth");
      }
      assert.equal((await state()).locations.pond.shipSignal,4);
    };
    const travel = async (id) => {
      const boarding = (await state()).actors.vale.place === "pond" && id === "greek-harbor";
      if (boarding) await signalShip();
      await playCard(id);
      assert.equal((await state()).actors.vale.place,id,\`travel to \${id}\`);
      assert.equal(await page.textContent("#place-title"),places[id].name);
      if (boarding && (await state()).items.lamp.lit) await playCard("lamp");
    };
`+text.slice(end);
  const waiting='    await card("greek-harbor").waitFor();';
  assert.equal(text.split(waiting).length-1,1);
  text=text.replace(waiting,'    await card("lamp").waitFor();\n    assert.equal(await card("greek-harbor").count(),0);');
  const before='    if (!current.items.lamp.lit) await playCard("lamp");';
  assert.equal(text.split(before).length-1,1);text=text.replace(before,'    await signalShip();');
  await writeFile(path,text);
}
// Dedicated UI checks cover each phase, reload halfway, and cancellation.
await replace("v2/scripts/smoke-card-pond-crossings.mjs",'  s.items.cloth.holder = "station";',
  '  s.items.cloth.holder = place === "pond" ? "vale" : "station";');
await replace("v2/scripts/smoke-card-pond-crossings.mjs",'    const load = async (save) => {',`    const pair = async (one, two) => {
      await ready();
      await card(one).scrollIntoViewIfNeeded(); await card(one).click();
      await card(two).scrollIntoViewIfNeeded(); await card(two).click();
      await card(two).click(); await ready();
    };
    const signal = async ({ reloadHalfway = false } = {}) => {
      assert.equal(await card("greek-harbor").count(), 0);
      for (let i = 0; i < 2; i++) {
        await pair("cloth", "lamp");
        assert.equal((await state()).locations.pond.shipSignal, 2 * i + 1);
        assert.equal(await card("greek-harbor").count(), 0);
        await use("cloth");
        assert.equal((await state()).locations.pond.shipSignal, 2 * i + 2);
        assert.equal(await card("greek-harbor").count(), i === 1 ? 1 : 0);
        if (i === 0 && reloadHalfway) {
          await page.reload(); await ready();
          assert.equal((await state()).locations.pond.shipSignal, 2);
          assert.equal(await card("greek-harbor").count(), 0);
        }
      }
    };
    const load = async (save) => {`);
await replace("v2/scripts/smoke-card-pond-crossings.mjs",'    await load(fixture("pond", true));',
  '    await load(fixture("pond", true));\n    await signal({ reloadHalfway: true });',2);
await replace("v2/scripts/smoke-card-pond-crossings.mjs",`    for (let i = 0; i < 3; i++) await use("pond");
    assert.equal(await card("greek-harbor").count(), 1);
    assert.equal(await page.locator("#location-overlay").isVisible(), true);`,
`    for (let i = 0; i < 3; i++) await use("pond");
    assert.equal(await card("greek-harbor").count(), 0);
    assert.equal((await state()).locations.pond.shipSignal, 0);
    assert.equal(await page.locator("#location-overlay").isVisible(), false);
    // Silence alone does not summon it again. Perform a real ritual before
    // checking cross-tab invalidation in a fresh provisioned fixture.
    await load(fixture("pond", true));
    await signal();`);
await replace("v2/content/greek-drama/README.md",`Black Pond–harbor topology. Shore-side entry requires a fueled, lit,
uncovered lamp physically at the pond and silence from the nearby bells.`,
`Black Pond–harbor topology. At the quiet pond, cover and uncover the fueled,
lit Lamp twice with the Black cloth. The second uncovering summons the ship.
Lighting the lamp alone does not open this crossing.`);
await replace("v2/content/greek-drama/README.md",`At Black Pond, bring an uncovered lit lamp and wait for the nearby bells to
fall silent. A Greek ship appears on the pond together with the **Wine-Dark
Harbor** travel card. Board it, then travel to **Theban Courtyard**.`,
`At quiet Black Pond, play **Black cloth + Lamp** to cover the lit lamp,
then **Black cloth** to uncover it. Repeat once. The second uncovering
reveals a Greek ship and the **Wine-Dark Harbor** boarding card together.
Board it, then travel to **Theban Courtyard**. Progress survives reload;
leaving, extinguishing the lamp, or nearby bells cancels the signal.`);
{
  const path="v2/docs/pond-crossings.md";
  let text=await readFile(path,"utf8"), start=text.indexOf("A Greek ship appears at Black Pond"),end=text.indexOf("\n## Scope and verification",start);
  assert(start>=0&&end>start);
  text=text.slice(0,start)+`At quiet Black Pond, cover the lit Lamp with the Black cloth, uncover it,
then repeat the complete cycle once. The ship and boarding card appear
on the **second uncovering**, not merely when the lamp is lit.

Use **Black cloth + Lamp** to cover it and **Black cloth** to uncover it.
The four resolved transitions are saved. Inspection, reload, generated
speech and rejected actions cannot count as flashes. An unlit or already
covered lamp cannot fabricate a complete cycle. The first flash gives a
ripple hint; waiting between flashes is allowed but consumes normal fuel.

Snuffing, running dry, leaving the pond, or sounding a nearby bell cancels
the signal. Restoring light or silence alone does not summon it again.
The variant, current facts and boarding offer share the same predicate.
The Greek harbor retains its return route without the entry lamp.

Legacy saves receive signal phase zero without resetting their stories.
Run the 24 ritual regressions in test/card-ship-ritual.test.mjs alongside
card-crossings.test.mjs and the desktop/phone browser smoke.
`+text.slice(end);await writeFile(path,text);
}
execFileSync(process.execPath,["scripts/bump-version.mjs"],{stdio:"inherit"});
