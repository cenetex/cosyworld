import { expect, it } from "vitest";
import {
  addLog,
  createWorld,
  decodeSave,
  encodeSave,
  holdChoice,
  legalActions,
  play,
} from "../v2/card-game/world.mjs";
import {
  ELYSIUM_MODEL_IDS,
  elysiumModelToken,
} from "../v2/card-game/elysium-models.mjs";
import { DAYLIGHT_TURNS } from "../v2/card-game/pack-rules.mjs";
import { entityActive, packDefinition, packIdOf } from "../v2/card-game/pack-registry.mjs";
import { dispatchShared } from "../v2/card-game/shared-world.mjs";
import { places } from "../v2/card-game/world/catalog.mjs";
import { elysiumTokenLanding } from "../v2/card-game/world/elysium-travel.mjs";

const claude = "elysium-claude";
const gemini = "elysium-gemini";
const token = elysiumModelToken(claude);
const wayfinder = "elysium-wayfinder";
const entry = "elysium-void-001";
const study = "elysium-void-002";
const rear = "behind-station";
const ordinary = (place) => Object.hasOwn(places, place) && packIdOf(place) !== "elysium";

const reload = (s) => decodeSave(encodeSave(s));
function act(s, kind, target, item) {
  const action = legalActions(s).find(
    (a) => a.kind === kind && (target === undefined || a.target === target) &&
      (item === undefined || a.item === item),
  );
  expect(action, `${kind} ${target ?? item ?? ""}`).toBeDefined();
  const result = play(s, action);
  expect(result.ok, result.error).toBe(true);
  return reload(result.state);
}

function approach(seed = 17) {
  const s = createWorld({ seed });
  s.turn = s.revision = DAYLIGHT_TURNS;
  s.actors.vale.place = "station";
  for (const item of Object.values(s.items))
    if (item.holder === "vale") item.holder = "station";
  s.items[wayfinder].holder = "station";
  const equipped = act(s, "take", null, wayfinder);
  return act(equipped, "move", entry);
}
const arrive = (seed) => act(approach(seed), "move", study);
const tour = (s) => [2, 3, 4, 7, 6, 5].reduce(
  (world, room) => act(world, "move", `elysium-void-00${room}`),
  s,
);
const tokens = ELYSIUM_MODEL_IDS.map(elysiumModelToken);
const landings = (s) => tokens.map((id) => s.items[id].holder);

function bringBack(s) {
  s = act(s, "move", "station");
  s.items[token].holder = "station";
  s = act(s, "take", null, token);
  expect(s.items[token].holder).toBe("vale");
  holdChoice(s, "vale", { item: wayfinder, revision: s.revision });
  return act(act(s, "move", entry), "move", study);
}

it("scatters each resident's own token on arrival and records first Talk separately", () => {
  const routes = [
    [], ["elysium-void-003"], ["elysium-void-003", "elysium-void-004"],
    ["elysium-void-003", "elysium-void-005"],
    ["elysium-void-003", "elysium-void-005", "elysium-void-006"],
    ["elysium-void-003", "elysium-void-004", "elysium-void-007"],
  ];
  for (const [i, resident] of ELYSIUM_MODEL_IDS.entries()) {
    const item = elysiumModelToken(resident);
    const route = [study, ...routes[i]];
    let s = approach();
    for (const place of route.slice(0, -1)) s = act(s, "move", place);
    expect(s.elysiumEncounters?.[resident]).toBeUndefined();
    expect(s.actors[resident].want).toBeNull();
    expect(s.items[item].holder).toBe(resident);
    s = act(s, "move", route.at(-1));
    const arrival = s.log.find((e) => e.elysiumArrival === resident);
    expect(arrival).toMatchObject({
      kind: "narration", locationId: route.at(-1), targetId: resident, itemId: item,
    });
    const destination = s.items[item].holder;
    expect(ordinary(destination)).toBe(true);
    expect(s.actors[resident].want).toMatchObject({ kind: "item", target: item });
    expect(s.elysiumEncounters[resident]).toEqual({ scatteredAt: arrival.seq, talkedAt: null });
    expect(s.log.some((e) => e.elysiumModel === resident)).toBe(false);
    s = act(s, "talk", resident);
    const talk = s.log.find((e) => e.elysiumModel === resident);
    expect(talk).toMatchObject({ kind: "action", verb: "talk", targetId: resident });
    expect(s.elysiumEncounters[resident]).toEqual({ scatteredAt: arrival.seq, talkedAt: talk.seq });
    s = act(s, "talk", resident);
    expect(s.items[item].holder).toBe(destination);
    expect(s.log.filter((e) => e.elysiumArrival === resident)).toHaveLength(1);
    expect(s.log.filter((e) => e.elysiumModel === resident)).toHaveLength(1);
  }
});

it("keeps a legacy first-Talk encounter and its token location on reload", () => {
  const s = act(arrive(), "talk", claude);
  const destination = s.items[token].holder;
  const arrival = s.log.find((e) => e.elysiumArrival === claude);
  delete arrival.elysiumArrival;
  s.elysiumEncounters[claude] = { scatteredAt: s.elysiumEncounters[claude].talkedAt };
  const restored = reload(s);
  const later = act(act(act(restored, "move", entry), "move", study), "talk", claude);
  expect(later.elysiumEncounters[claude]).toEqual(s.elysiumEncounters[claude]);
  expect(later.items[token].holder).toBe(destination);
  expect(later.log.filter((e) => e.elysiumModel === claude)).toHaveLength(1);
  expect(later.log.some((e) => e.elysiumArrival === claude)).toBe(false);
});

it("scatters a full tour into a different world each and repeats the same placements on replay", () => {
  const first = landings(tour(approach()));
  expect(first.every(ordinary)).toBe(true);
  expect(new Set(first.map(packIdOf)).size).toBe(first.length);
  expect(landings(tour(approach()))).toEqual(first);
});

it("lands in a world without a token, then in its emptiest room", () => {
  const s = createWorld({ seed: 4 });
  const others = tokens.filter((id) => id !== token);
  const worlds = ["hub", "lonely-forest", "willows", "ratiradio", "hoppycat-archive"];
  const room = (world) => Object.keys(places).find((p) => packIdOf(p) === world && ordinary(p));
  others.forEach((id, i) => (s.items[id].holder = room(worlds[i])));
  const landing = elysiumTokenLanding(s, token);
  expect(["badger-forest", "greek-drama"]).toContain(packIdOf(landing));
  const loose = (p) => Object.entries(s.items).filter(([id, i]) => i.holder === p && entityActive(s, id)).length;
  const rooms = Object.keys(places).filter((p) => packIdOf(p) === packIdOf(landing) && ordinary(p) && entityActive(s, p));
  expect(loose(landing)).toBe(Math.min(...rooms.map(loose)));
});

it("scatters the tokens already out once more on upgrade, even one a traveler carries", () => {
  let s = bringBack(arrive());
  expect(s.items[token].holder).toBe("vale");
  delete s.voidTokensSpread;
  s = reload(s);
  expect(s.voidTokensSpread).toBe(true);
  expect(ordinary(s.items[token].holder)).toBe(true);
  expect(s.items[token].history.at(-1)).toMatch(/Scattered through the worlds/);
  const placed = s.items[token].holder;
  expect(reload(s).items[token].holder).toBe(placed);
  expect(s.items[elysiumModelToken(gemini)].holder).toBe(gemini);
});

it("commits the portrait receipt only for an accepted Give to the matching resident", () => {
  let s = bringBack(arrive());
  s = act(s, "give", claude, token);
  expect(s.items[token].holder).toBe("vale");
  expect(s.log.findLast((e) => e.verb === "give")).toMatchObject({ accepted: false });
  expect(s.elysiumEncounters[claude].returnedAt).toBeUndefined();
  s = act(s, "talk", claude);
  s = act(s, "drop", study, token);
  expect(s.elysiumEncounters[claude].returnedAt).toBeUndefined();
  s = act(s, "take", null, token);

  s = act(s, "move", "elysium-void-003");
  s = act(s, "give", gemini, token);
  expect(s.items[token].holder).toBe("vale");
  expect(s.log.findLast((e) => e.verb === "give" && e.itemId === token)).toMatchObject({
    targetId: gemini, accepted: false,
  });
  s = act(s, "move", study);
  s = act(s, "give", claude, token);
  const event = s.log.find((e) => e.portraitModel === claude);
  expect(event).toMatchObject({
    kind: "action", verb: "give", accepted: true, itemId: token,
    actorId: "vale", targetId: claude, locationId: study,
  });
  expect(s.elysiumEncounters[claude]).toMatchObject({
    returnedAt: event.seq, returnedBy: "vale",
  });
  expect(s.items[token].holder).toBe(claude);
  expect(s.actors[claude].want).toBeNull();
  s = act(s, "talk", claude);
  expect(s.log.filter((e) => e.portraitModel === claude)).toHaveLength(1);
  expect(s.items[token].holder).toBe(claude);
});

it.each(["scattered", "returned"])("can play the shared encounter after importing a %s local token", (progress) => {
  let local = arrive();
  if (progress === "returned") {
    local = act(local, "talk", claude);
    addLog(local, "Resident of Void 002", "The leaves keep their own time.", {
      actorId: claude, entityId: claude, kind: "dialogue", generated: true,
      locationId: study, elysiumName: "Mica Thread",
    });
    expect(reload(local).log.at(-1).elysiumName).toBe("Mica Thread");
    const malformed = structuredClone(local);
    malformed.log.at(-1).elysiumName = "Unusable-Name-7";
    expect(() => decodeSave(JSON.stringify(malformed))).toThrow("This save needs a fresh start.");
    local = act(bringBack(local), "give", claude, token);
  }
  local.items.cloth.holder = "keeper";
  const localSeq = local.eventSeq;
  const shared = dispatchShared({ op: "create", save: encodeSave(local) }).world;
  expect(shared.elysiumEncounters).toBeUndefined();
  expect(shared.items[token].holder).toBe(claude);
  expect(shared.actors[claude].want).toBeNull();
  expect(shared.items.cloth.holder).toBe("keeper");
  expect(shared.actors.vale.xp).toBe(local.actors.vale.xp);
  expect(shared.log.some((e) => e.elysiumArrival || e.elysiumModel || e.portraitModel)).toBe(false);
  if (progress === "returned")
    expect(shared.log.find((line) => line.text === "The leaves keep their own time.")?.elysiumName).toBeNull();

  const sharedAct = (world, kind, target, item) => {
    const request = { world, actor: "vale", claimed: ["vale"], present: ["vale"] };
    const action = dispatchShared({ ...request, op: "view" }).actions.find(
      (a) => a.kind === kind && a.target === target && (item === undefined || a.item === item),
    );
    expect(action, `${kind} ${target ?? item}`).toBeDefined();
    const result = dispatchShared({ ...request, op: "play", action: action.key });
    expect(result.ok, result.error).toBe(true);
    return result;
  };
  const met = sharedAct(shared, "talk", claude);
  const arrivalSeq = met.events.find((e) => e.elysiumArrival === claude).seq;
  expect(arrivalSeq).toBeGreaterThan(localSeq);
  expect(met.events.find((e) => e.elysiumModel === claude).seq).toBeGreaterThan(arrivalSeq);
  let s = sharedAct(met.world, "move", "station").world;
  s.items[token].holder = "station";
  s = sharedAct(s, "take", null, token).world;
  s = dispatchShared({
    op: "hold", world: s, actor: "vale",
    choice: { item: wayfinder, revision: s.revision },
  }).world;
  s = sharedAct(sharedAct(s, "move", entry).world, "move", study).world;
  const returned = sharedAct(s, "give", claude, token);
  expect(returned.events.filter((e) => e.portraitModel)).toHaveLength(1);
  expect(returned.world.elysiumEncounters[claude].returnedAt).toBeGreaterThan(localSeq);
});

it("adds the six token holders to old Elysium saves with their relationships intact", () => {
  const s = createWorld({ seed: 17 });
  const pilot = "elysium-resident";
  s.packs.elysium.revision = 2;
  s.actors.vale.trust[pilot] = 2;
  for (const id of ELYSIUM_MODEL_IDS) {
    for (const actor of Object.values(s.actors)) delete actor.trust[id];
    delete s.actors[id];
    delete s.peaceUntil[id];
    delete s.memories[id];
    delete s.motives?.grievances[id];
    delete s.items[elysiumModelToken(id)];
    delete s.memories[elysiumModelToken(id)];
  }
  const loaded = decodeSave(JSON.stringify(s));
  expect(loaded.packs.elysium.revision).toBe(packDefinition("elysium").revision);
  expect(loaded.actors.vale.trust[pilot]).toBe(2);
  for (const id of ELYSIUM_MODEL_IDS) {
    expect(loaded.actors[id].trust.vale).toBe(0);
    expect(loaded.actors.vale.trust[id]).toBe(0);
    expect(loaded.items[elysiumModelToken(id)].holder).toBe(id);
  }
});
