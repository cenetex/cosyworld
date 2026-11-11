import { describe, expect, it } from "vitest";
import {
  createWorld,
  holdChoice,
  legalActions,
  places,
  play,
  sanctuaries,
  standoffFor,
  validateWorld,
  decodeSave,
  LONG_SLEEP_TURNS,
} from "../v2/card-game/world.mjs";
import {
  crossings,
  packDefinitions,
  packOf,
} from "../v2/card-game/pack-registry.mjs";
import { halfwayXp, knownActors, questXp } from "../v2/card-game/want.mjs";
import { DAYLIGHT_TURNS } from "../v2/card-game/daylight.mjs";
import { reflectionDue } from "../v2/card-game/reflections.mjs";
import { narrativeContext } from "../v2/card-game/narrative.mjs";

const act = (s, pick, actor = "vale") => {
  const action = legalActions(s, actor).find(pick);
  expect(action, `${actor} at ${s.actors[actor].place}`).toBeTruthy();
  return play(s, action, s.revision, actor).state;
};
const wait = (s, actor = "vale") => act(s, (a) => a.kind === "wait", actor);
// Sleep is a Wait offered after a Wait.
const sleep = (s, actor = "vale") => act(wait(s, actor), (a) => a.sleep, actor);
const woke = (s, actor) =>
  s.log.findLast((e) => e.actorId === actor && e.woke !== undefined);
// Moves the clock on to `turn`, as if quiet turns had passed.
const at = (s, turn) => {
  const next = structuredClone(s);
  next.revision += turn - next.turn;
  next.turn = turn;
  return next;
};
// A shared world seats these avatars; its clock moves on every seat's play.
const seat = (ids) => {
  const s = createWorld();
  s.sharedVersion = 1;
  s.controlledActors = [...ids];
  s.presentActors = [...ids];
  s.heldActors = [...ids];
  return s;
};

describe("rest and sanctuary", () => {
  it("gives each world exactly one sanctuary, and the Willows none", () => {
    // Badger's glade is a hidden part of the Lonely Forest, which shares
    // the Cosy Cottage as its one sanctuary.
    const partOf = { "badger-forest": "lonely-forest" };
    const worldOf = (id) => {
      const pack = packOf(id)?.id ?? "hub";
      return partOf[pack] ?? pack;
    };
    const count = (world) =>
      sanctuaries.filter((id) => worldOf(id) === world).length;
    expect(count("hub")).toBe(1);
    for (const id of ["greek-drama", "hoppycat-archive", "lonely-forest"])
      expect(count(id)).toBe(1);
    expect(count("willows")).toBe(0);
    expect(sanctuaries.some((id) => packOf(id)?.id === "badger-forest")).toBe(
      false,
    );
    expect(packDefinitions.every((pack) => count(pack.id) <= 1)).toBe(true);
    expect(sanctuaries).not.toContain("greek-ship");
    expect(sanctuaries.every((id) => places[id])).toBe(true);
  });

  it("leaves a player's losses as they are on a Wait away from a sanctuary", () => {
    let s = createWorld();
    s.defeats = { vale: 2 };
    s = wait(s);
    expect(s.defeats).toEqual({ vale: 2 });
    expect(s.actors.vale.sleeping).toBeUndefined();
    s = wait(s);
    expect(s.defeats).toEqual({ vale: 2 });
  });

  it("keeps a sanctuary Wait to one turn: losses clear, but no long rest or dream", () => {
    let s = createWorld();
    s.actors.vale.place = "attic";
    s.actors.vale.xp = questXp(2);
    s.defeats = { vale: 2 };
    s = wait(s);
    expect(s.turn).toBe(1);
    expect(s.defeats).toEqual({});
    expect(s.actors.vale.sleeping).toBeUndefined();
    expect(s.log.findLast((e) => e.verb === "wait").rest).toBeUndefined();
    expect(narrativeContext(s).rest).toBeFalsy();
    expect(s.actors.vale.want?.quest).toBeUndefined();
    expect(validateWorld(s)).toBe(s);
  });

  it("dreams only after a long sanctuary Sleep; short ones just clear losses", () => {
    let s = createWorld();
    s.actors.vale.place = "attic";
    s.actors.vale.xp = halfwayXp(1);
    s.actors.vale.level = 1;
    // Keep unrelated resident visits from interrupting this daylight test.
    const quietResidents = (world) => {
      for (const id of ["moth", "keeper"])
        Object.assign(world.actors[id], {
          want: null, content: true, metTurn: world.turn,
        });
      return world;
    };
    // Each short Sleep starts four turns before the light changes.
    for (const light of [2, 3, 4]) {
      s = wait(quietResidents(at(s, light * DAYLIGHT_TURNS - 4)));
      expect(legalActions(s).find((a) => a.sleep)).toMatchObject({
        kind: "wait",
        label: "Sleep",
        key: "sleep:vale::",
      });
      s.defeats = { vale: 2 };
      s = act(s, (a) => a.sleep);
      expect(woke(s, "vale")).toMatchObject({ turn: light * DAYLIGHT_TURNS });
      expect(woke(s, "vale").rest).toBeUndefined();
      expect(s.defeats).toEqual({});
      expect(narrativeContext(s).rest).toBeFalsy();
      expect(s.actors.vale.want?.quest).toBeUndefined();
      expect(woke(s, "vale").dream).toBeUndefined();
    }
    // A Sleep from just after the light changes lasts until it next does.
    s = sleep(quietResidents(at(s, 5 * DAYLIGHT_TURNS)));
    const waking = woke(s, "vale");
    expect(waking).toMatchObject({
      turn: 6 * DAYLIGHT_TURNS,
      woke: "dawn",
      rest: "long",
      text: "Vale wakes at dawn.",
    });
    expect(DAYLIGHT_TURNS - 2).toBeGreaterThanOrEqual(LONG_SLEEP_TURNS);
    // The long rest dreams the halfway glimpse and deals no quest.
    expect(waking.dream).toBe("glimpse");
    expect(s.actors.vale.want).toBeNull();
    const told = narrativeContext(s);
    expect(told.rest).toBe("long");
    expect(told.entities.find((e) => e.id === "vale").facts[0]).toMatch(
      /^In a dream, a glimpse: /,
    );
    expect(validateWorld(s)).toBe(s);
  });

  it("sleeps several times in a row, each Sleep offered as the last ends", () => {
    let s = wait(at(createWorld(), 30));
    s.actors.vale.place = "station";
    // Keep the lamp away from this sequence of repeated sleeps.
    s.items.lamp.holder = "attic";
    const reasons = [];
    for (let i = 0; i < 4; i++) {
      s = act(s, (a) => a.sleep);
      expect(s.actors.vale.sleeping).toBeUndefined();
      reasons.push(woke(s, "vale").woke);
    }
    expect(reasons).toHaveLength(4);
    expect(s.log.filter((e) => e.woke && e.actorId === "vale")).toHaveLength(4);
    expect(validateWorld(s)).toBe(s);
  });

  it("clears a resident's losses when it waits at a sanctuary, and only there", () => {
    let s = createWorld();
    s.actors.vale.place = "station";
    s.actors.keeper.place = "attic";
    s.actors.moth.place = "pond";
    // Neither resident is after anything, so each waits where it is.
    s.actors.keeper.want = s.actors.moth.want = null;
    s.actors.keeper.metTurn = s.actors.moth.metTurn = 0;
    s.defeats = { keeper: 2, moth: 2 };
    s = wait(s);
    expect(s.actors.keeper.place).toBe("attic");
    expect(s.defeats).toEqual({ moth: 2 });
    expect(validateWorld(s)).toBe(s);
  });

  it("wakes a shared sleeper when another seat arrives, on the shared clock", () => {
    let s = seat(["mara", "nell"]);
    s = act(s, (a) => a.kind === "move" && a.target === "clearing", "mara");
    s = sleep(s, "mara");
    // Who is there is who is physically there, the unmet Badger too.
    expect(s.actors.mara.sleeping).toEqual({
      since: s.turn,
      place: "clearing",
      present: ["badger", "mara"],
    });
    expect(knownActors(s)).not.toContain("badger");
    // Finding the Badger's way is no arrival.
    for (const c of crossings.filter((c) => c.packId === "badger-forest"))
      s.crossings[c.id].discovered = true;
    expect(knownActors(s)).toContain("badger");
    s = wait(s, "nell");
    expect(s.actors.mara.sleeping).toBeDefined();
    s = act(s, (a) => a.kind === "move" && a.target === "clearing", "nell");
    expect(s.actors.mara.sleeping).toBeUndefined();
    expect(woke(s, "mara")).toMatchObject({
      turn: s.turn,
      woke: "arrival",
      text: "Mara wakes as Iris arrives.",
    });
    // The clearing is no sanctuary: no long rest.
    expect(woke(s, "mara").rest).toBeUndefined();
    expect(legalActions(s, "mara").some((a) => a.sleep)).toBe(true);
    expect(validateWorld(s)).toBe(s);
  });

  it("lets a sleeper sleep on or choose any play, which wakes it first", () => {
    let s = seat(["mara", "nell"]);
    s.actors.mara.place = "clearing";
    s = sleep(s, "mara");
    const plays = legalActions(s, "mara");
    expect(plays[0]).toMatchObject({ key: "sleep:mara::", sleep: true });
    expect(plays.map((a) => a.text)).toContain("Mara waits one turn.");
    const go = plays.find((a) => a.kind === "move");
    expect(go).toBeTruthy();
    s = play(s, plays[0], s.revision, "mara").state;
    expect(s.actors.mara.sleeping).toBeDefined();
    s = play(s, go, s.revision, "mara").state;
    expect(s.actors.mara.sleeping).toBeUndefined();
    expect(s.actors.mara.place).toBe(go.target);
    expect(woke(s, "mara")).toMatchObject({
      turn: s.turn,
      woke: "chose",
      text: "Mara wakes.",
      locationId: "clearing",
    });
    const moved = s.log.findLast((e) => e.actorId === "mara" && !e.woke);
    expect(moved.seq).toBeGreaterThan(woke(s, "mara").seq);
    expect(validateWorld(s)).toBe(s);
  });

  it("wakes a sleeper at the first change where it sleeps", () => {
    const asleep = (s, actor = "mara") => {
      s.actors[actor].place ??= "clearing";
      return sleep(s, actor);
    };
    const quiet = (turn = 0) => {
      const s = seat(["mara"]);
      s.actors.mara.place = "clearing";
      s.turn = s.revision = turn;
      return s;
    };
    // Someone leaves.
    let s = seat(["mara", "nell"]);
    s.actors.mara.place = s.actors.nell.place = "clearing";
    s = act(
      asleep(s),
      (a) => a.kind === "move" && a.target === "glasshouse",
      "nell",
    );
    expect(woke(s, "mara")).toMatchObject({
      woke: "departure",
      text: "Mara wakes as Iris leaves.",
    });
    // A low lamp burns by room, so waiting neither drains it nor wakes Mara.
    s = seat(["mara", "nell"]);
    s.actors.mara.place = "clearing";
    s.actors.nell.place = "station";
    Object.assign(s.items.lamp, { holder: "mara", lit: true, fuel: 4,
      fuelRooms: 1, fuelPlace: "clearing", fuelVisit: true });
    holdChoice(s, "mara", { item: "lamp", revision: s.revision });
    s = asleep(s);
    for (let turn = 0; turn < 4; turn++) s = wait(s, "nell");
    expect(s.items.lamp).toMatchObject({ lit: true, fuel: 4, fuelRooms: 1 });
    expect(s.actors.mara.sleeping).toBeDefined();
    expect(woke(s, "mara")).toBeUndefined();
    // Dusk and dawn.
    s = wait(asleep(quiet(21)), "mara");
    expect(woke(s, "mara")).toMatchObject({
      turn: 24,
      woke: "dusk",
      text: "Mara wakes at dusk.",
    });
    s = wait(asleep(quiet(45)), "mara");
    expect(woke(s, "mara")).toMatchObject({
      turn: 48,
      woke: "dawn",
      text: "Mara wakes at dawn.",
    });
    // The 24-turn cap.
    s = asleep(quiet(30));
    s.actors.mara.sleeping.since = s.turn - 23;
    s = wait(s, "mara");
    expect(woke(s, "mara")).toMatchObject({
      woke: "rested",
      text: "Mara wakes, rested.",
    });
    // A last-room lamp arrives where Mara sleeps and runs dry.
    s = seat(["mara", "nell"]);
    s.actors.mara.place = "attic";
    s.actors.nell.place = "pond";
    Object.assign(s.items.lamp, { holder: "nell", lit: true, fuel: 4,
      fuelRooms: 1, fuelPlace: "pond", fuelVisit: true });
    holdChoice(s, "nell", { item: "lamp", revision: s.revision });
    s = sleep(s, "mara");
    s = act(s, (a) => a.kind === "move" && a.target === "attic", "nell");
    expect(woke(s, "mara")).toMatchObject({
      woke: "dry",
      text: "Mara wakes as the lamp runs dry.",
    });
    // A crossing where it sleeps closes: the lamp at the pond goes out.
    s = seat(["mara", "nell"]);
    s.actors.mara.place = s.actors.nell.place = "pond";
    s.actors.boardyai.place = "station";
    Object.assign(s.items.lamp, { holder: "nell", lit: true, fuel: 12,
      fuelRooms: 3, fuelPlace: "pond", fuelVisit: true });
    holdChoice(s, "nell", { item: "lamp", revision: s.revision });
    s = sleep(s, "mara");
    expect(s.actors.mara.sleeping).toBeDefined();
    const turnBeforeStowing = s.turn;
    holdChoice(s, "nell", { item: null, revision: s.revision });
    expect(s.turn).toBe(turnBeforeStowing);
    expect(s.items.lamp).toMatchObject({ lit: false, fuelRooms: 3 });
    expect(woke(s, "mara")).toMatchObject({
      woke: "crossing",
      text: "Mara wakes as a way here closes.",
    });
    // Carried off in its sleep, it wakes where it is, never as itself leaving.
    s = seat(["mara", "nell"]);
    s.actors.mara.place = "glasshouse";
    s = sleep(s, "mara");
    s.actors.mara.place = "clearing";
    s = wait(s, "nell");
    expect(woke(s, "mara")).toMatchObject({
      woke: "moved",
      text: "Mara wakes in Forest Clearing.",
    });
    // A threat: Iris opens a standoff while another seat's play moves the clock.
    s = seat(["mara", "rue"]);
    s.actors.mara.place = s.actors.nell.place = "clearing";
    s = asleep(s);
    const none = { nell: false, mara: false };
    s.standoffs.push({
      challenger: "nell",
      defender: "mara",
      location: "clearing",
      item: null,
      opened: s.turn,
      answered: false,
      resolve: { nell: 4, mara: 4 },
      guarding: { ...none },
      struck: { ...none },
      steppedBack: { ...none },
      covering: {},
      hitBy: {},
    });
    s = wait(s, "rue");
    expect(woke(s, "mara")).toMatchObject({
      woke: "threat",
      text: "Mara wakes to a threat.",
    });
    // A ship docks where it sleeps.
    s = seat(["vale"]);
    s.actors.vale.place = "greek-harbor";
    s = sleep(s);
    Object.assign(s.transports["greek-ship"], {
      phase: "sea",
      dock: "pond",
      destination: "greek-harbor",
      since: s.turn,
    });
    s = wait(s);
    expect(woke(s, "vale")).toMatchObject({
      woke: "dock",
      text: "Vale wakes as The Charybdis docks.",
    });
    expect(validateWorld(s)).toBe(s);
  });

  it("offers Sleep only after a Wait, never aboard a ship", () => {
    let s = createWorld();
    expect(legalActions(s).some((a) => a.sleep)).toBe(false);
    s = wait(s);
    expect(legalActions(s).some((a) => a.sleep)).toBe(true);
    s = act(s, (a) => a.kind === "move");
    expect(legalActions(s).some((a) => a.sleep)).toBe(false);
    // Residents never sleep.
    expect(legalActions(s, "keeper").some((a) => a.sleep)).toBe(false);
    let ship = seat(["ada"]);
    ship = act(
      ship,
      (a) => a.kind === "move" && a.target === "greek-ship",
      "ada",
    );
    ship = wait(ship, "ada");
    expect(ship.actors.ada.place).toBe("greek-ship");
    expect(legalActions(ship, "ada").some((a) => a.sleep)).toBe(false);
  });

  it("lets a save from before rules 89 wake from its old sleep", () => {
    const s = createWorld();
    s.actors.vale.sleepUntil = DAYLIGHT_TURNS;
    const loaded = decodeSave(JSON.stringify(s));
    expect(loaded.actors.vale.sleepUntil).toBeUndefined();
    expect(loaded.actors.vale.sleeping).toBeUndefined();
  });

  it("brings a thought on waking from a long rest, and a dream only by the rules", () => {
    const context = { turn: 24, resting: "vale", rest: "long", entities: [] };
    // An ordinary long rest dreams no more (rules 99).
    expect(reflectionDue(context, "vale", null)).toEqual({
      thought: true,
      dream: false,
    });
    for (const dream of ["glimpse", "quest"])
      expect(reflectionDue({ ...context, dream }, "vale", null)).toEqual({
        thought: true,
        dream: true,
      });
    expect(reflectionDue({ ...context, resting: null }, "vale", null)).toEqual({
      thought: false,
      dream: false,
    });
  });

  it("never offers an attack at a sanctuary and wakes every sleeper through a long run", () => {
    let s = createWorld();
    let longRests = 0,
      seen = 0;
    for (let step = 0; step < 300; step++) {
      // Now and then the player sleeps at home in the attic.
      // A fighter is never lifted out of a battle.
      if (step % 50 === 0 && !standoffFor(s, "vale")) {
        s.actors.vale.place = "attic";
        s = sleep(s);
      }
      const actions = legalActions(s);
      const here = s.actors.vale.place;
      if (sanctuaries.includes(here))
        expect(actions.some((a) => a.kind === "attack")).toBe(false);
      if (standoffFor(s, "vale") && !sanctuaries.includes(here))
        expect(actions.some((a) => a.kind === "attack")).toBe(true);
      s = play(s, actions[(step * 7919) % actions.length]).state;
      // Alone, a sleeper is always awake again when the play returns.
      expect(s.actors.vale.sleeping).toBeUndefined();
      for (const e of s.log.filter((e) => e.seq > seen && e.rest === "long")) {
        expect(e.woke).toBeDefined();
        expect(sanctuaries).toContain(e.locationId);
        longRests++;
      }
      seen = s.log.at(-1).seq;
    }
    expect(validateWorld(s)).toBe(s);
    expect(longRests).toBeGreaterThan(0);
  });
});
