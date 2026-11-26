import { expect, it } from "vitest";
import {
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
import { packDefinition } from "../v2/card-game/pack-registry.mjs";
import { dispatchShared } from "../v2/card-game/shared-world.mjs";

const claude = "elysium-claude";
const gemini = "elysium-gemini";
const token = elysiumModelToken(claude);
const wayfinder = "elysium-wayfinder";
const entry = "elysium-void-001";
const study = "elysium-void-002";

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

function arrive(seed = 17) {
  const s = createWorld({ seed });
  s.turn = s.revision = DAYLIGHT_TURNS;
  s.actors.vale.place = "station";
  for (const item of Object.values(s.items))
    if (item.holder === "vale") item.holder = "station";
  s.items[wayfinder].holder = "station";
  const equipped = act(s, "take", null, wayfinder);
  return act(act(equipped, "move", entry), "move", study);
}
function bringBack(s) {
  s = act(s, "move", "station");
  if (s.items[token].holder === "pond") s = act(s, "move", "pond");
  s = act(s, "take", null, token);
  expect(s.items[token].holder).toBe("vale");
  holdChoice(s, "vale", { item: wayfinder, revision: s.revision });
  return act(act(s, "move", entry), "move", study);
}

it("scatters each resident's own token only on a first Talk", () => {
  const routes = [
    [], ["elysium-void-003"], ["elysium-void-003", "elysium-void-004"],
    ["elysium-void-003", "elysium-void-005"],
    ["elysium-void-003", "elysium-void-005", "elysium-void-006"],
    ["elysium-void-003", "elysium-void-004", "elysium-void-007"],
  ];
  for (const [i, resident] of ELYSIUM_MODEL_IDS.entries()) {
    const item = elysiumModelToken(resident);
    let s = arrive();
    for (const place of routes[i]) s = act(s, "move", place);
    expect(s.elysiumEncounters?.[resident]).toBeUndefined();
    expect(s.actors[resident].want).toBeNull();
    expect(s.items[item].holder).toBe(resident);
    expect(legalActions(s).some((a) => a.kind === "ask" && a.item === item)).toBe(false);
    s = act(s, "talk", resident);
    const event = s.log.find((e) => e.elysiumModel === resident);
    expect(event).toMatchObject({ kind: "action", verb: "talk", targetId: resident });
    const destination = s.items[item].holder;
    expect(["pond", "station"]).toContain(destination);
    expect(s.actors[resident].want).toMatchObject({ kind: "item", target: item });
    expect(s.elysiumEncounters[resident]).toEqual({ scatteredAt: event.seq });
    s = act(s, "talk", resident);
    expect(s.items[item].holder).toBe(destination);
    expect(s.log.filter((e) => e.elysiumModel === resident)).toHaveLength(1);
  }
});

it("can scatter through an open ordinary door with the Wayfinder put away", () => {
  const kitchen = "ratiradio-staff-kitchen";
  let s = arrive(4);
  s.items["ratiradio-station-key"].holder = kitchen;
  holdChoice(s, "vale", { item: null, revision: s.revision });
  s = act(s, "talk", claude);
  expect(s.items[token].holder).toBe(kitchen);
  s = act(act(s, "move", "station"), "move", kitchen);
  s = act(s, "take", null, token);
  expect(s.items[token].holder).toBe("vale");
});

it("commits the portrait receipt only for an accepted Give to the matching resident", () => {
  let s = bringBack(act(arrive(), "talk", claude));
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
  let local = act(arrive(), "talk", claude);
  if (progress === "returned") local = act(bringBack(local), "give", claude, token);
  local.items.cloth.holder = "keeper";
  const localSeq = local.eventSeq;
  const shared = dispatchShared({ op: "create", save: encodeSave(local) }).world;
  expect(shared.elysiumEncounters).toBeUndefined();
  expect(shared.items[token].holder).toBe(claude);
  expect(shared.actors[claude].want).toBeNull();
  expect(shared.items.cloth.holder).toBe("keeper");
  expect(shared.actors.vale.xp).toBe(local.actors.vale.xp);
  expect(shared.log.some((e) => e.elysiumModel || e.portraitModel)).toBe(false);

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
  expect(met.events.find((e) => e.elysiumModel === claude).seq).toBeGreaterThan(localSeq);
  let s = sharedAct(met.world, "move", "station").world;
  if (s.items[token].holder === "pond") s = sharedAct(s, "move", "pond").world;
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
