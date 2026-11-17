import { afterEach, expect, it } from "vitest";
import "./helpers/still-cast.mjs";
import {
  createWorld,
  legalActions,
  plan,
  play,
} from "../v2/card-game/world.mjs";
import { installWants, stagedNext } from "../v2/card-game/want.mjs";
import { packDefinitions, packPeople } from "../v2/card-game/pack-registry.mjs";
import { worldLife } from "../v2/card-game/resident-home.mjs";

const R = "greek-ismene",
  home = "greek-sanctuary",
  next = "greek-palace",
  other = "greek-creon",
  thing = "greek-figs";
const saved = packPeople[R].wants;
afterEach(() => {
  packPeople[R].wants = saved;
  worldLife.on = false;
});
const item = (target, minTrust) => ({
  want: { kind: "item", target, ...(minTrust ? { minTrust } : {}) },
});
const place = (target, minTrust) => ({
  want: { kind: "place", target, ...(minTrust ? { minTrust } : {}) },
});
const world = (...wants) => {
  packPeople[R].wants = wants;
  const s = createWorld({ seed: 7, packScopes: { "greek-drama": "full" } });
  s.actors.vale.place = home;
  s.packs["greek-drama"].met[R] = 0;
  s.packs["greek-drama"].met[other] = 0;
  return s;
};
const act = (s, kind, test = () => true) => {
  const done = play(
    s,
    legalActions(s).find((a) => a.kind === kind && test(a)),
  );
  expect(done.ok, done.error).toBe(true);
  return done.state;
};
const trust = (s) => s.actors[R].trust.vale;

it("leaves the wanted thing on the ground when a deeper want waits on trust", () => {
  let s = world(item(thing), place(next, 1));
  expect(s.items[thing].holder).toBe(home);
  s = act(s, "talk", (a) => a.target === R);
  s = act(s, "wait");
  expect(s.items[thing].holder).toBe(home);
  s = act(s, "take", (a) => a.item === thing);
  s = act(s, "give", (a) => a.item === thing && a.target === R);
  expect(s.items[thing].holder).toBe(R);
  expect(trust(s)).toBe(1);
  expect(s.actors[R].want).toMatchObject({ kind: "place", target: next });
});

it("still picks the wanted thing up when no want waits on trust", () => {
  let s = world(item(thing), place(next));
  s = act(s, "wait");
  expect(s.items[thing].holder).toBe(R);
  expect(trust(s)).toBe(0);
});

it("does not take a staged want below its trust", () => {
  const s = world(place(next, 2));
  expect(s.actors[R].want?.target).not.toBe(next);
  s.actors[R].trust.vale = 1;
  s.actors[R].trust[other] = 3;
  expect(stagedNext(s, R)).toBeNull();
  delete s.actors[R].want;
  installWants(s);
  expect(s.actors[R].want).toBeNull();
  s.actors[R].trust.vale = 2;
  expect(stagedNext(s, R)).toMatchObject({ kind: "place", target: next });
});

it("takes the deeper want on the play that earns the trust", () => {
  let s = world(place(next), item(thing, 1));
  s.items[thing].holder = other;
  expect(s.actors[R].want).toMatchObject({ kind: "place", target: next });
  s = act(s, "accompany", (a) => a.target === R && a.destination === next);
  expect(trust(s)).toBe(1);
  expect(s.actors[R].want).toMatchObject({ kind: "item", target: thing });
});

it("credits the player who leads a resident to the person they want to see", () => {
  let s = world({ want: { kind: "person", target: other } });
  expect(s.actors[other].place).toBe(next);
  s = act(s, "accompany", (a) => a.target === R && a.destination === next);
  expect(s.actors[R].place).toBe(next);
  expect(s.actors[R].metTurn).toBe(s.turn);
  expect(trust(s)).toBe(1);
});

it("credits nobody when the person was already there", () => {
  let s = world({ want: { kind: "person", target: other } });
  s.actors.vale.place = next;
  s.actors[R].place = next;
  s = act(s, "wait");
  expect(trust(s)).toBe(0);
});

it("meets the person in the room before walking home", () => {
  const s = world({ want: { kind: "person", target: other } });
  worldLife.on = true;
  s.actors.vale.place = next;
  s.actors[R].place = next;
  s.actors[R].homeward = true;
  expect(plan(s, R).action).toMatchObject({ kind: "talk", target: other });
  s.actors[other].place = home;
  expect(plan(s, R).action).toMatchObject({ kind: "move", target: home });
});

const lay = { verb: "lay", items: [thing] };
const laid = (s) =>
  (s.actors[R].want = { kind: "place", target: home, since: 0, refusals: 0, step: lay });

it("credits the player whose own play lays the thing", () => {
  let s = world(place(next));
  s.items[thing].holder = "vale";
  laid(s);
  s = act(s, "drop", (a) => a.item === thing);
  expect(s.actors[R].metTurn).toBe(s.turn);
  expect(trust(s)).toBe(1);
});

it("credits nobody when the want was met before the play", () => {
  for (const kind of ["wait", "talk"]) {
    let s = world(place(next));
    laid(s);
    s = act(s, kind, (a) => kind === "wait" || a.target === R);
    expect(s.actors[R].metTurn, kind).toBe(s.turn);
    expect(trust(s), kind).toBe(0);
  }
});

it("credits the player once when a pack choice takes the gift that lays the thing", () => {
  const pack = packDefinitions.find((p) => p.id === "greek-drama");
  const choices = pack.choices;
  pack.choices = [
    ...choices,
    {
      id: "test-gift-lays",
      subject: R,
      at: home,
      label: "Lay it",
      text: "Vale lays it.",
      textTemplate: "{actor} lays it.",
      on: "give",
      requires: [{ kind: "holding", item: thing, role: "actor" }],
      effects: [{ kind: "place_item", item: thing, place: home }],
    },
  ];
  try {
    let s = world(place(next));
    s.items[thing].holder = "vale";
    laid(s);
    s = act(s, "give", (a) => a.item === thing && a.target === R);
    expect(s.items[thing].holder).toBe(home);
    expect(s.actors[R].metTurn).toBe(s.turn);
    expect(trust(s)).toBe(1);
  } finally {
    pack.choices = choices;
  }
});
