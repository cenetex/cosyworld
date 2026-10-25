import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
async function replace(path, before, after) {
  const text = await readFile(path, "utf8");
  assert.equal(text.split(before).length - 1, 1, `Unexpected source in ${path}`);
  await writeFile(path, text.replace(before, after));
}
await replace("v2/card-game/world.mjs", `          avatars: knownActors(s).filter(
            (id) =>
              id !== actor && s.actors[id].place === s.actors[actor].place,
          ),`, `          // handStatus already proved these participants were physically here.
          // A resident's receipt must not depend on who Vale has discovered,
          // nor collect unrelated bystanders beyond the hand's cast bound.
          avatars: [...target.avatars],`);
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
