// One-shot materializer for the exact f3e7263 PR base, used only on the
// verification branch. This script and its workflow are not release files.
import { readFile, writeFile, mkdir, copyFile } from "node:fs/promises";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
const base = "f3e72635697ac96b5aafc57e4d79fbb096e7098e";
assert.equal(execFileSync("git", ["rev-parse", "HEAD"], {encoding:"utf8"}).trim(), base);
async function replace(path, before, after, count = 1) {
  let text = await readFile(path,"utf8");
  assert.equal(text.split(before).length-1,count,`Unexpected source in ${path}: ${before}`);
  text=text.replaceAll(before,after);
  await writeFile(path,text);
}
await replace("test/card-awakening.test.mjs", "      openUntil: heard.turn + 3,", "      openUntil: heard.turn + 3,\n      returnRingingUntil: 0,");
await replace("test/card-awakening.test.mjs", 'exits(next, "clearing")', 'exits(next, "clearing", "vale")');
await replace("test/card-clearing-access.test.mjs", 'it("allows the final available turn and always keeps the way out",', 'it("allows the final entry turn but requires sound to reopen the return",');
await replace("test/card-clearing-access.test.mjs", `    s = act(act(s, "wait"), "wait");
    expect(exits(s, "clearing", "vale")).toContain("pond");
    s = act(decodeSave(encodeSave(s)), "move", "pond");`, `    s = act(act(s, "wait"), "wait");
    expect(exits(s, "clearing", "vale")).not.toContain("pond");
    expect(availableCards(s)).not.toContain("pond");
    s = act(decodeSave(encodeSave(s)), "ring", "clearing");
    expect(exits(s, "clearing", "vale")).toContain("pond");
    s = act(s, "move", "pond");`);
// Keep the nested-custody regression, but don't cover the lamp that now
// supplies this crossing. A muffled hand bell remains a nested carried item.
await replace("test/card-greek-drama.test.mjs", '    world.items.cloth.holder = "lamp";', '    world.items.bell.holder = "vale";\n    world.items.cloth.holder = "bell";\n    world.items.lamp.fuel = 12;');
{
  const path="test/card-greek-drama.test.mjs";
  let text=await readFile(path,"utf8");
  const from=text.indexOf('  it("travels through the pond');
  const to=text.indexOf('\n  it(',from+5);
  assert(from>=0 && to>from);
  const segment=text.slice(from,to);
  assert.equal(segment.split('expect(world.items.cloth.holder).toBe("lamp")').length-1,2);
  text=text.slice(0,from)+segment.replaceAll('expect(world.items.cloth.holder).toBe("lamp")','expect(world.items.cloth.holder).toBe("bell")')+text.slice(to);
  await writeFile(path,text);
}
await replace("v2/scripts/smoke-card-greek-drama.mjs", 'fixture.items.cloth.holder = "lamp";', 'fixture.items.cloth.holder = "vale";\nfixture.items.lamp.fuel = 12;');
{
  const path="v2/scripts/smoke-card-greek-drama.mjs";
  let text=await readFile(path,"utf8");
  assert(text.includes('current.items.cloth.holder, "lamp"'));
  text=text.replaceAll('current.items.cloth.holder, "lamp"','current.items.cloth.holder, "vale"');
  await writeFile(path,text);
}
await replace("v2/scripts/smoke-card-clearing-access.mjs", `    assert.equal((await state()).items.bell.ringing, 0);
    await page.reload();
    await ready();
    await use("pond");`, `    assert.equal((await state()).items.bell.ringing, 0);
    await page.reload();
    await ready();
    assert.equal(await card("pond").count(), 0);
    await page.locator('[data-choices-for="clearing"]').click();
    await page.getByRole("button", { name: "Ring the Steam Clock", exact: true }).click();
    await ready();
    assert.equal(await card("pond").count(), 1);
    await use("pond");`);
await replace("readme.md", `  Leaving the clearing remains possible after the sound fades. Badger sleeps
  there; a greeting wakes him.`, `  The return card also disappears when the bells fall silent. Ringing the
  Steam Clock's own bell in the clearing reopens the return for three turns,
  even when the hand bell was left behind. Badger sleeps there; a greeting wakes him.`);
await replace("v2/card-game/README.md", `The Black pond card in the clearing returns Vale and their belongings to the
shore. It works even if the bell has been left behind or stopped ringing.`, `The Black pond card in the clearing appears only while a bell is audible at
one of the two shores. Silence removes both the exit and the travel offer.
Choose **Ring the Steam Clock** on the clearing card to ring its installed
bell for three following turns, even if the hand bell was left behind.
Ringing the clock wakes or annoys Badger; it does not move or ring the hand bell.`);
await replace("v2/content/greek-drama/README.md", `unconditional Black Pond–harbor connection. The reusable source never names`, `Black Pond–harbor topology. Shore-side entry requires a fueled, lit,
uncovered lamp physically at the pond and silence from the nearby bells.
The Greek ship location variant and the boarding card share that predicate.
The harbor keeps its return route even if the entry lamp has gone out.
The reusable source never names`);
await replace("v2/content/greek-drama/README.md", `From Black Pond, travel to **The Wine-Dark Harbor**, then **Theban Courtyard**.`, `At Black Pond, bring an uncovered lit lamp and wait for the nearby bells to
fall silent. A Greek ship appears on the pond together with the **Wine-Dark
Harbor** travel card. Board it, then travel to **Theban Courtyard**.`);
const doc=`# Black Pond crossings\n\nThe following applies to the browser-local card table, not the shared classic\nworld. Discovery remembers a place; current light and sound decide access.\n\n## Forest Clearing\n\nTwo consecutive uncovered hand-bell rings at Black Pond still reveal the\nclearing for three following plays. Entry requires that bell at the pond.\nThe return card is no longer permanent: it is present only while the hand\nbell is audible at either shore, or the Steam Clock's own bell is sounding.\n\nThe clearing card's Choices menu offers **Ring the Steam Clock**. This\nrepeatable local action sounds the installed bell for three following plays.\nIt works without the hand bell and does not duplicate or relocate that item.\nThe clock wakes and irritates Badger. Its window survives reload and can be\nrefreshed by another ring. Silence hides the return card again.\n\n## Greek ship\n\nA Greek ship appears at Black Pond when a fueled, lit, uncovered lamp is\nphysically there and no uncovered hand bell at either shore or clock bell\nis audible. Custody by a resident counts only while that resident is at the\npond. Sound elsewhere does not block the ship.\n\nOne predicate selects the pond's ship layer, location-card art, current\nlocation facts and boarding offer. Extinguishing or covering the lamp,\nremoving its carrier, or sounding a nearby bell removes the ship and offer.\nPreviously raised offers are checked again when played. The Greek harbor's\nreturn remains available without the entry conditions.\n\n## Scope and verification\n\nThe ship is a transparent reuse of the pack's existing harbor SVG geometry\nover the existing pond image; this is an interim visual, not newly generated\npainterly scenery. Camera, mirror, shoreline and base pixels do not change.\nNo atmosphere simulator or ten-backdrop scenery integration is included.\n\nSaved schema 6 gains an optional validated clock deadline. Old saves acquire\na silent clock, without resetting inventory, residents, memories or branches.\nInspection and dialogue retries cannot advance windows.\n\nRun \`npx vitest run test/card-crossings.test.mjs\` and\n\`node v2/scripts/smoke-card-pond-crossings.mjs\` for model and desktop/phone\nchecks. The browser smoke uses fixture speech, not a paid model.\n`;
await mkdir("v2/docs",{recursive:true});
await writeFile("v2/docs/pond-crossings.md",doc);
await copyFile(join(dirname(process.argv[1]),"smoke-pond-crossings.mjs"),"v2/scripts/smoke-card-pond-crossings.mjs");
execFileSync(process.execPath,["scripts/bump-version.mjs"],{stdio:"inherit"});
