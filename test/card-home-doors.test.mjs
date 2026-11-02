import { describe, expect, it } from "vitest";
import forest from "../v2/card-game/forest.json" with { type: "json" };
import { dispatchShared } from "../v2/card-game/shared-world.mjs";
import {
  crossings,
  hub,
  packDefinitions,
  packPlaces,
  transports,
} from "../v2/card-game/pack-registry.mjs";
import {
  humanAvatar,
  lamplessPlaces,
  visitors,
} from "../v2/card-game/human-cast.mjs";
import { hidingPlaces } from "../v2/card-game/hidden-avatar.mjs";
import { questsOf } from "../v2/card-game/want.mjs";
import {
  questCard,
  questCaption,
  questVerb,
} from "../v2/card-game/quest-card.mjs";
import {
  decodeSave,
  encodeSave,
  exits,
  legalActions,
  wantText,
} from "../v2/card-game/world.mjs";

const locked = ["ash", "tavi", "nell", "orin", "ada"];
const create = (seed = 7, homecoming = "mara") =>
  dispatchShared({
    op: "create",
    seed,
    homecoming,
    hidden: homecoming === "rue" ? "mara" : "rue",
    absent: locked.filter((id) => id !== homecoming),
  }).world;
const ask = (world, op, actor, extra = {}) =>
  dispatchShared({
    world,
    op,
    actor,
    claimed: ["vale", actor],
    present: ["vale", actor],
    ...extra,
  });
const playAs = (world, actor, test) => {
  const action = legalActions(
    { ...world, controlledActors: [actor], presentActors: [actor] },
    actor,
  ).find(test);
  expect(action).toBeTruthy();
  return ask(world, "play", actor, { action });
};

// Where an avatar can go without Vale's lamp, over the authored graph: a
// requirement on the lamp's light never holds, an item must start somewhere
// reached, and everything else (a bell, a choice, the weather) can happen.
function reachedWithoutLamp(world) {
  const reached = new Set(["pond", "station"]);
  const lampGated = (c) =>
    JSON.stringify([c.requires, c.signal?.while, c.signal?.steps]).includes(
      '"lamp"',
    );
  const holds = (r) => {
    if (r.kind === "light") return false;
    if (r.kind === "home_door") return world.doors[r.home] === r.place;
    if (r.kind === "any") return r.conditions.some(holds);
    if (["item_near", "item_present", "item_at", "holding"].includes(r.kind)) {
      if (visitors.some((a) => a.item.id === r.item)) return true;
      let at = world.items[r.item]?.holder;
      while (world.items[at]) at = world.items[at].holder;
      return reached.has(world.actors[at]?.place ?? at);
    }
    return true;
  };
  const ship = (id) =>
    !crossings.some((c) => c.transport === id && c.signal && lampGated(c));
  for (let grew = true; grew; ) {
    grew = false;
    const add = (to) => !reached.has(to) && (reached.add(to), (grew = true));
    for (const from of [...reached]) {
      for (const to of forest.places[from]?.exits || []) add(to);
      for (const to of packPlaces[from]?.exits || []) add(to);
      for (const p of packDefinitions)
        for (const r of p.routes || [])
          if (r.from === from && (r.requires || []).every(holds)) add(r.to);
      for (const c of crossings) {
        if (c.from !== from || c.retired) continue;
        if (c.transport) {
          if (ship(c.transport)) add(transports[c.transport].place);
        } else if (!lampGated(c) && c.requires.every(holds)) add(c.to);
      }
      for (const t of Object.values(transports))
        if (t.place === from) t.docks.forEach(add);
    }
  }
  return reached;
}

describe("homes away from the pond (#1936)", () => {
  it("opens only Vale's way at the pond", () => {
    const homes = new Set(visitors.map((a) => a.home.id));
    expect(
      crossings.filter((c) => c.from === "pond" && homes.has(c.to)),
    ).toEqual([]);
    expect(humanAvatar("rue").home.doors).toEqual(["station"]);
  });

  it("seeds each home's door from its authored places", () => {
    const doors = (seed) => dispatchShared({ op: "create", seed }).world.doors;
    expect(doors(7)).toEqual(doors(7));
    for (const a of visitors)
      expect(a.home.doors).toContain(doors(7)[a.home.id]);
    const belfry = new Set([1, 2, 3, 4, 5, 6].map((s) => doors(s).belfry));
    expect(belfry.size).toBeGreaterThan(1);
  });

  it("keeps the doors of an earlier save and forgets its pond doors", () => {
    const world = create();
    const old = JSON.parse(encodeSave(world));
    old.crossings["pond-theatre"] = { discovered: true };
    delete old.doors;
    const loaded = decodeSave(JSON.stringify(old));
    expect(loaded.crossings["pond-theatre"]).toBeUndefined();
    expect(Object.keys(loaded.doors)).toHaveLength(visitors.length);
  });
});

describe("an unlocked avatar's homecoming", () => {
  it("scatters the belonging and the door to seeded spots", () => {
    const world = create();
    expect(create()).toEqual(world);
    expect(world.actors.mara.place).toBe("pond");
    const spot = world.items.mask.holder;
    expect(lamplessPlaces).toContain(spot);
    expect([...hidingPlaces(world), ...hub.places]).toContain(spot);
    expect(world.doors.theatre).toBe("clearing");
    expect(questsOf(world, "mara")[0]).toMatchObject({
      kind: "item",
      target: "mask",
      story: true,
      step: { verb: "bring", at: "theatre" },
    });
    expect(wantText(questsOf(world, "mara")[0])).toContain("home");
    const card = questCard(world, "mara");
    expect(questVerb(world, card)).toBe("Bring");
    expect(questCaption(card)).toBe("Bring Theatre mask home to Paper theatre");
  });

  it("puts every avatar's belonging and door where no lamp is needed", () => {
    for (const a of visitors)
      for (const seed of [1, 2, 3, 4, 5, 6, 7, 8]) {
        const world = create(seed, a.id);
        const reached = reachedWithoutLamp(world);
        expect(reached.has(world.items[a.item.id].holder)).toBe(true);
        expect(reached.has(world.doors[a.home.id])).toBe(true);
      }
  });

  it("meets the want when the belonging comes home, and replays the same", () => {
    const run = () => {
      let world = create();
      world.actors.mara.place = world.items.mask.holder;
      world = playAs(
        world,
        "mara",
        (a) => a.kind === "take" && a.item === "mask",
      ).world;
      world.actors.mara.place = world.doors.theatre;
      const seated = {
        ...world,
        controlledActors: ["mara"],
        presentActors: ["mara"],
      };
      expect(exits(seated, world.doors.theatre, "mara")).toContain("theatre");
      return playAs(
        world,
        "mara",
        (a) => a.kind === "move" && a.target === "theatre",
      ).world;
    };
    const home = run();
    expect(home.actors.mara.place).toBe("theatre");
    expect(home.actors.mara.xp).toBe(1);
    expect(questsOf(home, "mara").some((w) => w.target === "mask")).toBe(false);
    expect(run()).toEqual(home);
  });

  it("refuses a homecoming for Vale or the hidden avatar", () => {
    expect(() => create(7, "vale")).toThrow(/whose world/);
    expect(() =>
      dispatchShared({
        op: "create",
        seed: 7,
        homecoming: "rue",
        hidden: "rue",
      }),
    ).toThrow(/whose world/);
  });

  it("reports which authored doors and hiding places need Vale's lamp", () => {
    const reached = reachedWithoutLamp(create());
    for (const place of lamplessPlaces) expect(reached.has(place)).toBe(true);
    const gated = [
      ...new Set([
        ...visitors.flatMap((a) => a.home.doors),
        ...hidingPlaces(create()),
      ]),
    ].filter((place) => !reached.has(place));
    // Thematic doors behind the lamp stay as written: a Vale opens them.
    expect(gated.sort()).toEqual(
      [
        "forest-cottage",
        "forest-garden",
        "forest-oak",
        "greek-ship",
        "hoppycat-halfway-tea-garden",
        "willows-bank",
        "willows-camp",
        "willows-thicket",
      ].sort(),
    );
  });
});
