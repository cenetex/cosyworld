import { readFileSync } from "node:fs";
import { createContext, Script } from "node:vm";
import { describe, expect, it } from "vitest";
import { createWorld, encodeSave, decodeSave } from "../v2/card-game/world.mjs";
import { dispatchShared } from "../v2/card-game/shared-world.mjs";
import { packDefinition } from "../v2/card-game/pack-registry.mjs";
import { recitalPoem } from "../v2/card-game/pack-recital.mjs";

const engineFile = readFileSync(
  new URL("../v2/orchestrator-rust/src/card_shared/engine.rs", import.meta.url),
  "utf8",
).match(/const SOURCE: &str = include_str!\("(engine-v\d+\.js)"\)/)?.[1];
if (!engineFile) throw new Error("The current shared engine needs its source bundle.");
const bundled = readFileSync(
  new URL(`../v2/orchestrator-rust/src/card_shared/${engineFile}`, import.meta.url),
  "utf8",
);
function currentEngine() {
  const realm = createContext({ structuredClone });
  new Script(bundled).runInContext(realm, { timeout: 2000 });
  const call = new Script("cardShared(JSON.stringify(request))");
  return (request) => {
    realm.request = structuredClone(request);
    return JSON.parse(call.runInContext(realm, { timeout: 2000 }));
  };
}

function hostJSON(value, order) {
  if (order === "actor-reverse") {
    const copy = structuredClone(value);
    const world = copy.world || copy;
    if (world.actors)
      world.actors = Object.fromEntries(
        Object.keys(world.actors).sort().reverse().map((id) => [id, world.actors[id]]),
      );
    return copy;
  }
  return JSON.parse(JSON.stringify(value, (_key, entry) =>
    entry && typeof entry === "object" && !Array.isArray(entry)
      ? Object.fromEntries(Object.keys(entry).sort().map((key) => [key, entry[key]]))
      : entry,
  ));
}

const prefix = "greek-heracles-";
const house = `${prefix}theban-house`;
const road = `${prefix}athens-road`;
const guestRoom = `${prefix}athens-guest-room`;
const hero = `${prefix}heracles`;
const theseus = `${prefix}theseus`;
const humans = ["vale", "mara"];
function sharedSeed() {
  const created = dispatchShared({ op: "create", save: encodeSave(createWorld()) });
  expect(created.ok, created.error).toBe(true);
  const world = created.world;
  delete world.opening;
  // A valid save after the two players and shore residents reach the courtyard.
  // The neighbors exercise shared NPC partner choices beside the story deeds.
  for (const actor of [...humans, "moth", "keeper"])
    world.actors[actor].place = "greek-courtyard";
  world.items.lamp.holder = "station";
  world.crossings["pond-greek-harbor"].discovered = true;
  return decodeSave(encodeSave(world));
}

function replay(ending, order) {
  const actor = ending === "walk" ? "vale" : "mara";
  let reference = sharedSeed();
  let source = hostJSON(reference, order);
  let engine = hostJSON(reference, order);
  const dispatchEngine = currentEngine();
  let commands = 0;
  const command = (body) => {
    const request = (world) => ({ ...body, actor, claimed: humans, present: humans, world });
    const expected = dispatchShared(request(reference));
    expect(expected.ok, expected.error).toBe(true);
    const sourceInput = hostJSON(request(source), order);
    const engineInput = hostJSON(request(engine), order);
    const original = JSON.stringify(sourceInput);
    const observed = dispatchShared(sourceInput);
    const hosted = dispatchEngine(engineInput);
    expect(JSON.stringify(sourceInput)).toBe(original);
    expect(observed.ok, observed.error).toBe(true);
    expect(hosted.ok, hosted.error).toBe(true);
    expect(observed.world, `source command ${commands + 1}`).toEqual(expected.world);
    expect(hosted, `${engineFile} command ${commands + 1}`).toEqual(observed);
    expect(decodeSave(encodeSave(observed.world))).toEqual(observed.world);
    reference = expected.world;
    source = hostJSON(observed.world, order);
    engine = hostJSON(hosted.world, order);
    commands++;
    return expected;
  };
  const action = (kind, fields = {}) => {
    const view = dispatchShared({
      op: "view", actor, claimed: humans, present: humans, world: reference,
    });
    expect(view.ok, view.error).toBe(true);
    const choice = view.actions.find((entry) =>
      entry.kind === kind && Object.entries(fields).every(([key, value]) => entry[key] === value),
    );
    expect(choice, `${kind} ${JSON.stringify(fields)}`).toBeDefined();
    return command({ op: "play", action: choice });
  };
  const choose = (id) => action("choose", { choiceId: `${prefix}${id}` });
  const move = (target) => action("move", { target });
  const take = (item) => action("take", { item: `${prefix}${item}` });
  const accompany = (target, destination) => action("accompany", { target, destination });

  action("wait");
  const talked = action("talk", { target: "greek-baker" });
  const disclosure = talked.context.disclosures?.[0];
  command({
    op: "speech",
    room: reference.actors[actor].place,
    disclosures: disclosure ? [disclosure] : [],
    lines: [
      { actorId: actor, text: "I am listening beside the table." },
      ...(disclosure ? [{ actorId: disclosure.speaker, text: disclosure.text }] : []),
    ],
  });
  action("choose", { choiceId: "greek-inquire-euripides-heracles" });
  choose("enter"); move(house);
  choose("hear-megara"); choose("hear-amphitryon"); choose("hear-lycus");
  take("bread"); take("water-cup"); choose("set-altar-food");
  take("help-tablet"); move(road); move(guestRoom); choose("deliver-help");
  move(road); move(house);
  choose("hear-return"); choose("hear-divine-voices"); choose("hear-messenger");
  choose("hear-theseus"); choose("hear-heracles");
  take("water-cup"); take("care-cloth"); choose("prepare-care");
  take("funeral-cloth"); take("remembrance-tablet"); choose("prepare-funeral");
  choose("agree-heracles"); choose("agree-theseus");
  accompany(hero, road); move(house); accompany(theseus, road);
  accompany(hero, guestRoom); choose("receive-heracles");
  move(road); accompany(theseus, guestRoom); choose("receive-theseus");
  if (ending === "walk") choose("remain-with-heracles");
  move(road); move(house);
  if (ending === "vigil") {
    take("bread"); take("water-cup"); choose("return-to-amphitryon");
  }
  take("remembrance-tablet"); move("greek-courtyard"); choose(`report-${ending}`);

  const state = reference.packs["greek-drama"];
  expect(state.choices[`${prefix}care`]).toBe(ending);
  expect(reference.items[`${prefix}remembrance-tablet`].holder).toBe("greek-courtyard");
  expect(state.recitals[`${prefix}report-${ending}`].actor).toBe(actor);
  expect(reference.actors[hero].place).toBe(guestRoom);
  expect(reference.actors[theseus].place).toBe(guestRoom);
  expect(reference.log.filter((entry) =>
    entry.verb === "accompany" && entry.actorId === actor &&
    [hero, theseus].includes(entry.targetId) && entry.accepted,
  )).toHaveLength(4);
  expect(recitalPoem(reference, packDefinition("greek-drama")).stanzas
    .filter((verse) => verse.id.startsWith(prefix)).map((verse) => verse.id)).toEqual([
    `${prefix}deliver-help`, `${prefix}prepare-care`,
    `${prefix}${ending === "walk" ? "remain-with-heracles" : "return-to-amphitryon"}`,
    `${prefix}report-${ending}`,
  ]);
  expect(source).toEqual(reference);
  expect(engine).toEqual(reference);
}

describe("shared JSON host ordering", () => {
  it.each([
    ["walk", "actor-reverse"], ["walk", "host-sorted"],
    ["vigil", "actor-reverse"], ["vigil", "host-sorted"],
  ])("keeps %s deeds, NPC choices and engine output exact with %s maps", replay, 20_000);
});
