import { describe, expect, it } from "vitest";
import compiled from "../v2/card-game/packs.json" with { type: "json" };
import {
  createWorld,
  legalActions,
  play,
  exits,
  encodeSave,
  decodeSave,
} from "../v2/card-game/world.mjs";
import { packProblems } from "../v2/card-game/pack-schema.mjs";
import { enableMotives } from "../v2/card-game/motives.mjs";
import { dispatchShared } from "../v2/card-game/shared-world.mjs";
import { homecomingJourney } from "./helpers/greek-homecoming.mjs";
import { openDoorJourney } from "./helpers/open-door.mjs";
import { houseGo } from "./helpers/greek-house-of-blood.mjs";
import { entityActive } from "../v2/card-game/pack-registry.mjs";

const GREEK = "greek-drama";
function scene(place) {
  const world = enableMotives(
    createWorld({ packScopes: { [GREEK]: "full" } }),
    { questPrograms: true, personalQuests: true },
  );
  world.actors.vale.place = place;
  for (const item of Object.values(world.items))
    if (item.holder === "vale") item.holder = place;
  return world;
}
function act(world, kind, fields = {}) {
  const action = legalActions(world).find(
    (candidate) =>
      candidate.kind === kind &&
      Object.entries(fields).every(([key, value]) => candidate[key] === value),
  );
  if (!action) throw Error(`Missing action ${kind} ${JSON.stringify(fields)}`);
  const result = play(world, action, world.revision);
  if (!result.ok) throw Error(result.error);
  return result.state;
}
const take = (world, item) => act(world, "take", { item });
const give = (world, item, target) => act(world, "give", { item, target });
const move = (world, target) => act(world, "move", { target });
const choose = (world, choiceId) => act(world, "choose", { choiceId });
const accompany = (world, target, destination) =>
  act(world, "accompany", { target, destination });

describe("the shared Attic farm", () => {
  it.each(["sky", "civic"])(
    "opens through the %s invitation after the earlier return",
    (chapter) => {
      let world = openDoorJourney().world;
      const civic = chapter === "civic";
      world = houseGo(world, civic ? "greek-athens" : "greek-courtyard");
      world = choose(
        world,
        civic ? "greek-comedy-invitation" : "greek-vii-open-accounts",
      );
      world = houseGo(world, "greek-attic-farm");
      expect(world.actors.vale.place).toBe("greek-attic-farm");
      expect(world.packs[GREEK].flags["greek-attic-farm-open"]).toBe(true);
      expect(entityActive(world, "greek-comedy-wealth-chremylus")).toBe(civic);
      expect(entityActive(world, "greek-vii-trygaeus")).toBe(!civic);
      expect(decodeSave(encodeSave(world))).toEqual(world);
    },
  );
});

const cave = "greek-sicily";
const inner = "greek-vii-inner-cave";
const shore = "greek-vii-escape-shore";
const crew = "greek-vii-odysseus-crew";
const satyrs = "greek-vii-satyr-chorus";
const poly = "greek-vii-polyphemus";
const cyclops = (name) => `greek-vii-cyclops-${name}`;
function openCave(opening) {
  let w = scene(cave);
  w = give(take(w, "greek-vii-crew-basket"), "greek-vii-crew-basket", crew);
  w = give(take(w, "greek-vii-satyr-basket"), "greek-vii-satyr-basket", satyrs);
  w = choose(w, cyclops("provisions"));
  w = move(take(w, "greek-vii-cyclops-cup"), inner);
  w = give(w, "greek-vii-cyclops-cup", poly);
  w = move(w, cave);
  w = move(take(w, "greek-vii-cave-timber"), inner);
  w = choose(w, cyclops(`${opening}-exit`));
  w = take(move(w, cave), "greek-vii-escape-list");
  w = choose(w, cyclops("crew-consent"));
  return choose(w, cyclops("satyr-consent"));
}

const wild = "greek-bird-wilderness";
const gate = "greek-vii-air-gate";
const refuge = "greek-vii-bird-refuge";
const birds = "greek-vii-hoopoe-chorus";
const king = "greek-vii-pisthetaerus";
const key = "greek-vii-gate-key";
const basket = "greek-vii-nest-basket";
const tablet = "greek-vii-refuge-tablet";
const birdChoice = (name) => `greek-vii-birds-${name}`;
function birdGate(policy) {
  let w = scene(wild);
  w = choose(take(w, "greek-vii-bird-twine"), birdChoice("refuge-agreement"));
  w = take(w, basket);
  w = accompany(w, birds, gate);
  w = choose(w, birdChoice("at-gate"));
  return choose(take(w, key), birdChoice(`gate-${policy}`));
}

describe("Cyclops's physical departure", () => {
  it.each(["force", "brace"])(
    "opens the %s way through real custody",
    (opening) => {
      const w = openCave(opening);
      expect(w.items["greek-vii-cyclops-cup"].holder).toBe(poly);
      expect(w.items["greek-vii-cave-timber"].holder).toBe(inner);
      expect(w.items["greek-vii-crew-basket"].holder).toBe(crew);
      expect(w.items["greek-vii-satyr-basket"].holder).toBe(satyrs);
      expect(exits(w, cave, "vale")).toContain(shore);
    },
  );
  it.each(["all-home", "crew-first", "satyrs-first"])(
    "records %s from the actual cohorts' places",
    (ending) => {
      let w = openCave("brace");
      const first = ending === "satyrs-first" ? satyrs : crew;
      w = accompany(w, first, shore);
      w = choose(
        w,
        cyclops(first === crew ? "crew-arrived" : "satyrs-arrived"),
      );
      w = move(w, cave);
      if (ending === "all-home") {
        w = accompany(w, satyrs, shore);
        w = choose(w, cyclops("satyrs-arrived"));
      }
      const atClosing = w.actors.vale.place;
      w = choose(w, cyclops(ending));
      expect(w.packs[GREEK].choices[cyclops("ending")]).toBe(ending);
      expect(w.actors[crew].place).toBe(
        ending === "satyrs-first" ? cave : shore,
      );
      expect(w.actors[satyrs].place).toBe(
        ending === "crew-first" ? cave : shore,
      );
      expect(w.items["greek-vii-escape-list"].holder).toBe(atClosing);
      expect(exits(w, cave, "vale")).not.toContain(shore);
      expect(exits(w, shore, "vale")).toContain(cave);
      expect(decodeSave(encodeSave(w))).toEqual(w);
    },
  );
});

describe("Birds's actual passage and refuge", () => {
  it("admits the keyholder and keeps the cohort at the throne gate", () => {
    let w = birdGate("throne");
    expect(exits(w, gate, "vale")).toContain(refuge);
    expect(exits(w, gate, birds)).not.toContain(refuge);
    const before = w.eventSeq;
    w = accompany(w, birds, refuge);
    expect(w.actors[birds].place).toBe(gate);
    expect(w.actors.vale.place).toBe(gate);
    expect(
      w.log.some(
        (e) => e.seq > before && e.verb === "accompany" && e.accepted === false,
      ),
    ).toBe(true);
    w = move(w, refuge);
    expect(w.actors.vale.place).toBe(refuge);
    w = move(w, gate);
    w = give(w, basket, king);
    w = choose(take(w, tablet), birdChoice("throne"));
    expect(w.items[basket].holder).toBe(king);
    expect(w.actors[birds].place).toBe(gate);
    expect(w.items[tablet].holder).toBe(gate);
  });
  it.each([
    ["open", "open-flight"],
    ["dismantle", "broken-wall"],
  ])(
    "brings the cohort through the %s passage with its food",
    (policy, ending) => {
      let w = birdGate(policy);
      expect(exits(w, gate, birds)).toContain(refuge);
      w = accompany(w, birds, refuge);
      w = give(w, basket, birds);
      if (policy === "dismantle") w = give(w, key, birds);
      w = take(move(w, gate), tablet);
      w = choose(move(w, refuge), birdChoice(ending));
      expect(w.actors[birds].place).toBe(refuge);
      expect(w.items[basket].holder).toBe(birds);
      expect(w.items[key].holder).toBe(policy === "open" ? gate : birds);
      expect(w.items[tablet].holder).toBe(refuge);
      expect(exits(w, refuge, "vale")).toContain(gate);
      expect(exits(w, refuge, birds)).toContain(gate);
      expect(decodeSave(encodeSave(w))).toEqual(w);
    },
  );
  it("keeps the existing household's agreed journey playable", () => {
    const { world } = homecomingJourney({ berth: "family", reading: "basket" });
    expect(world.actors["greek-household-witness"].place).toBe("greek-piraeus");
    expect(world.packs[GREEK].flags["greek-homecoming-arrived"]).toBe(true);
  });
});

describe("bounded flame preconditions", () => {
  const problems = (pack) =>
    packProblems(
      pack,
      compiled.hub,
      compiled.packs.flatMap((p) => Object.keys(p.places)),
    );
  it("accepts actual hub custody, placement and light on a completion choice", () => {
    const p = structuredClone(compiled.packs.find((p) => p.id === GREEK));
    p.choices.push({
      id: "test-carried-flame",
      subject: "greek-baker",
      at: "greek-courtyard",
      label: "Record the actual flame",
      text: "The traveler carries the burning lamp before Dione.",
      requires: [
        { kind: "holding", item: "lamp", role: "actor" },
        { kind: "item_at", item: "oil", place: "greek-courtyard" },
        {
          kind: "light",
          item: "lamp",
          at: ["greek-courtyard"],
          uncovered: true,
        },
      ],
      effects: [{ kind: "set_flag", key: "test-flame-arrived", value: true }],
    });
    expect(problems(p)).toEqual([]);
    p.places["greek-courtyard"].requires = [
      { kind: "light", item: "lamp", at: ["greek-courtyard"] },
    ];
    expect(problems(p)).toContain(
      "greek-drama: place greek-courtyard requires must use saved state or human presence conditions",
    );
  });
});

const heights = "greek-divine-heights";
const farm = "greek-attic-farm";
const workshop = "greek-vii-peace-workshop";
const farmers = "greek-vii-farmers";
const smiths = "greek-vii-smiths";
const trygaeus = "greek-vii-trygaeus";
const grain = "greek-vii-peace-grain";
const tools = "greek-vii-smith-tools";
const peaceList = "greek-vii-peace-list";
const peace = (name) => `greek-vii-peace-${name}`;
function sharedPull() {
  let w = scene(heights);
  expect(legalActions(w).some((a) => a.item === grain)).toBe(false);
  w = give(
    take(w, "greek-vii-beetle-harness"),
    "greek-vii-beetle-harness",
    trygaeus,
  );
  w = choose(w, peace("harness"));
  w = give(take(w, "greek-vii-peace-rope"), "greek-vii-peace-rope", farmers);
  return choose(w, peace("pull"));
}
describe("Peace reaches actual workers and supplies", () => {
  it.each(["harvest", "workshops", "private-store"])(
    "earns %s from real holders",
    (ending) => {
      let w = sharedPull();
      expect(w.items["greek-vii-beetle-harness"].holder).toBe(trygaeus);
      expect(w.items["greek-vii-peace-rope"].holder).toBe(farmers);
      w = take(take(w, grain), peaceList);
      if (ending === "private-store") {
        w = give(w, grain, trygaeus);
      } else {
        w = accompany(w, farmers, farm);
        w = choose(w, peace("farmers-arrived"));
        w = give(w, grain, farmers);
        if (ending === "workshops") {
          w = take(move(w, heights), tools);
          w = move(move(w, farm), workshop);
          w = give(w, tools, smiths);
        }
      }
      w = choose(w, peace(ending));
      expect(w.items[grain].holder).toBe(
        ending === "private-store" ? trygaeus : farmers,
      );
      if (ending === "workshops") expect(w.items[tools].holder).toBe(smiths);
      expect(w.items[peaceList].holder).toBe(w.actors.vale.place);
      expect(w.packs[GREEK].choices[peace("ending")]).toBe(ending);
      expect(decodeSave(encodeSave(w))).toEqual(w);
    },
  );
});

const camp = "greek-vii-crag-camp";
const crag = "greek-scythian-crag";
const east = "greek-susa";
const io = "greek-vii-io";
const hermes = "greek-vii-hermes";
const stormRecord = "greek-vii-storm-record";
const prometheus = (name) => `greek-vii-prometheus-${name}`;
function carriedFlame() {
  let w = scene(camp);
  for (const id of ["lamp", "oil", "cloth"]) w.items[id].holder = camp;
  Object.assign(w.items.lamp, { fuel: 0, lit: false });
  w.items.oil.doses = 3;
  const road = [
    east,
    "greek-troy",
    "greek-greek-camp",
    "greek-aulis",
    "greek-gate",
    "greek-courtyard",
  ];
  for (const to of road) w = move(w, to);
  w = choose(w, "greek-vii-open-accounts");
  for (const to of [...road.slice(0, -1)].reverse()) w = move(w, to);
  w = move(w, camp);
  w = take(w, "oil");
  w = act(w, "refill", { item: "oil", target: "lamp" });
  w = act(w, "refill", { item: "oil", target: "lamp" });
  w = act(w, "drop", { item: "oil", target: camp });
  w = take(w, "cloth");
  w = act(w, "cover", { item: "cloth", target: "lamp" });
  w = take(w, "lamp");
  w = act(w, "light", { item: "lamp" });
  expect(w.items.lamp.fuel).toBe(7);
  w = move(w, crag);
  expect(w.items.lamp.fuel).toBe(6);
  w = take(w, "cloth");
  expect(w.items.lamp.fuel).toBe(5);
  w = choose(w, prometheus("flame-arrived"));
  expect(w.items.lamp.fuel).toBe(4);
  w = act(w, "snuff", { item: "lamp" });
  w = act(w, "drop", { item: "cloth", target: crag });
  return w;
}
function deliveredIoMessage() {
  let w = carriedFlame();
  w = take(take(w, "greek-vii-io-message"), stormRecord);
  w = move(move(w, camp), east);
  w = give(w, "greek-vii-io-message", io);
  return choose(w, prometheus("io-message-arrived"));
}
describe("Prometheus uses the finite carried flame and actual messages", () => {
  it("carries a covered flame, uncovers it and preserves fuel with Snuff", () => {
    const w = carriedFlame();
    expect(w.items.lamp).toMatchObject({ holder: "vale", fuel: 4, lit: false });
    expect(w.items.oil).toMatchObject({ holder: camp, doses: 1 });
    expect(w.packs[GREEK].flags[prometheus("flame-delivered")]).toBe(true);
    expect(
      w.log.find((e) => e.choiceId === prometheus("flame-arrived")),
    ).toMatchObject({ light: true });
  });
  it.each(["stay", "terms"])(
    "earns %s after the actual message reached Io",
    (ending) => {
      let w = deliveredIoMessage();
      expect(w.items["greek-vii-io-message"].holder).toBe(io);
      w = move(move(w, camp), crag);
      if (ending === "terms") {
        w = take(w, "greek-vii-power-terms");
        w = give(move(w, camp), "greek-vii-power-terms", hermes);
      }
      w = choose(w, prometheus(ending));
      expect(w.packs[GREEK].choices[prometheus("ending")]).toBe(ending);
      expect(w.items[stormRecord].holder).toBe(ending === "stay" ? crag : camp);
      if (ending === "terms")
        expect(w.items["greek-vii-power-terms"].holder).toBe(hermes);
      expect(decodeSave(encodeSave(w))).toEqual(w);
    },
  );
  it("rechecks real light after another human's turn and recovers with the remaining oil", () => {
    let w = move(deliveredIoMessage(), camp);
    w = act(w, "drop", { item: stormRecord, target: camp });
    w = act(w, "light", { item: "lamp" });
    w = act(w, "drop", { item: "lamp", target: camp });
    w = take(w, stormRecord);
    expect(w.items.lamp.fuel).toBe(1);
    const stale = legalActions(w).find(
      (a) => a.choiceId === prometheus("gifts"),
    );
    expect(stale).toBeDefined();
    w.sharedVersion = 1;
    const reply = dispatchShared({
      op: "play",
      world: w,
      actor: "mara",
      claimed: ["vale", "mara"],
      present: ["vale", "mara"],
      revision: w.revision,
      action: "wait:mara::",
    });
    expect(reply.ok).toBe(true);
    w = reply.world;
    expect(w.items.lamp).toMatchObject({ lit: false, fuel: 0 });
    expect(play(w, stale, w.revision).ok).toBe(false);
    expect(w.packs[GREEK].receipts[prometheus("gifts")]).toBeUndefined();
    w = act(w, "drop", { item: stormRecord, target: camp });
    w = take(w, "oil");
    w = act(w, "refill", { item: "oil", target: "lamp" });
    w = act(w, "drop", { item: "oil", target: camp });
    w = act(w, "light", { item: "lamp" });
    w = take(w, stormRecord);
    w = choose(w, prometheus("gifts"));
    expect(w.items.lamp).toMatchObject({ holder: camp, fuel: 1, lit: true });
    expect(w.items.oil.doses).toBe(0);
    expect(w.items[stormRecord].holder).toBe(camp);
    expect(decodeSave(encodeSave(w))).toEqual(w);
  });
});
