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
import { homecomingJourney } from "./helpers/greek-homecoming.mjs";

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
