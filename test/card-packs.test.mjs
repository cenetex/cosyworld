import { humanHomePack } from "../v2/card-game/human-cast.mjs";
import { questing } from "./helpers/first-quest.mjs";
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import {
  createWorld as baseCreateWorld,
  play,
  legalActions,
  exits,
  encodeSave,
  decodeSave,
  places,
  people,
  things,
  placeText,
  plan,
} from "../v2/card-game/world.mjs";
// Play here starts past the pond, where the first quest begins.
const createWorld = (...args) => questing(baseCreateWorld(...args));
import { enableMotives } from "../v2/card-game/motives.mjs";
import {
  availableCards,
  placePlays,
  playLabel,
} from "../v2/card-game/cards.mjs";
import { portrait } from "../v2/card-game/scene.mjs";
import { knownActors } from "../v2/card-game/want.mjs";
import { packProblems } from "../v2/card-game/pack-schema.mjs";
import {
  hub,
  packDefinitions,
  packPlaces,
  packPeople,
  packThings,
  packFixtures,
  crossings,
} from "../v2/card-game/pack-registry.mjs";
import { fixtureSounding, variantOf } from "../v2/card-game/pack-rules.mjs";

function act(s, kind, target, item) {
  const action = legalActions(s).find(
    (a) =>
      a.kind === kind &&
      (target === undefined || a.target === target) &&
      (item === undefined || a.item === item),
  );
  expect(action, `${kind} ${target ?? ""} ${item ?? ""}`).toBeTruthy();
  const result = play(s, action);
  expect(result.ok, result.error).toBe(true);
  return result.state;
}
// Vale stands in the clearing with every bell silent.
function clearing() {
  const s = enableMotives(createWorld());
  s.actors.vale.place = "clearing";
  s.crossings["pond-clearing"].discovered = true;
  return s;
}
const ringClock = (s) => act(s, "ring", "clearing", null);
const forest = () => structuredClone(packDefinitions[0]);

describe("world packs on the card table", () => {
  it("compiles packs.json exactly from its pack and bridge sources", () => {
    expect(() =>
      execFileSync(process.execPath, [
        "v2/scripts/build-card-worldpacks.mjs",
        "--check",
      ]),
    ).not.toThrow();
    expect(packDefinitions.map((p) => p.id)).toEqual([
      "badger-forest",
      "greek-drama",
      "hoppycat-archive",
      "willows",
      "lonely-forest",
      "shared-homes",
      "boardyai",
    ]);
  });

  it("joins only hub entities the engine really has", () => {
    const base = (map) =>
      Object.keys(map).filter(
        (id) => !packPlaces[id] && !packPeople[id] && !packThings[id],
      );
    expect(hub.places).toEqual(base(places));
    expect(hub.avatars).toEqual(base(people));
    expect(hub.items).toEqual(base(things));
    expect(hub.player).toBe("vale");
  });

  it("rejects packs outside the closed vocabulary with a readable reason", () => {
    expect(packProblems(forest(), hub)).toEqual([]);
    const broken = [
      [
        (p) => (p.crossings[0].requires[0].kind = "light-or-magic"),
        /condition/,
      ],
      [(p) => (p.crossings[1].from = "station"), /join a hub place/],
      [(p) => (p.crossings[0].signal.steps[0].verb = "sing"), /known verb/],
      [(p) => (p.avatars.bell = p.avatars.badger), /reuse hub ids/],
      [(p) => p.crossings.splice(1, 1), /crossing back to the hub/],
      [(p) => delete p.avatars.badger.travels, /stage needs/],
      [
        (p) => (p.avatars.badger.variants.awake.greet = "Hi {friend}."),
        /variant awake/,
      ],
      [(p) => (p.values.badger.crown = 4), /values/],
      [
        (p) => (p.places.clearing.backdrop = "assets/steam-clock.png"),
        /backdrop must be assets\/badger-forest/,
      ],
      [(p) => (p.places.clearing.secret = true), /unknown field/],
      [
        (p) => (p.fixtures["steam-clock"].sound.text = "{actor rings it."),
        /sound needs/,
      ],
    ];
    for (const [mutate, reason] of broken) {
      const pack = forest();
      mutate(pack);
      const problems = packProblems(pack, hub);
      expect(problems.join("\n"), String(mutate)).toMatch(reason);
    }
  });

  it("validates pack music filenames and titles", () => {
    const pack = forest();
    pack.places.clearing.music = [
      { file: "forest-song.mp3", title: "Forest song" },
    ];
    pack.places.clearing.musicMode = "random-per-visit";
    expect(packProblems(pack, hub)).toEqual([]);
    pack.places.clearing.musicMode = "shuffle";
    expect(packProblems(pack, hub).join("\n")).toMatch(/musicMode/);
    pack.places.clearing.musicMode = "random-per-visit";
    delete pack.places.clearing.music;
    expect(packProblems(pack, hub).join("\n")).toMatch(/musicMode/);
    for (const playlist of [
      [],
      null,
      [{ file: "../forest-song.mp3", title: "Forest song" }],
      [{ file: "forest-song.mp3", title: "" }],
    ]) {
      pack.places.clearing.music = playlist;
      expect(packProblems(pack, hub).join("\n")).toMatch(/music/);
    }
  });

  it("validates transport docks, routes, and signal conditions", () => {
    const greek = () =>
      structuredClone(packDefinitions.find((p) => p.id === "greek-drama"));
    expect(packProblems(greek(), hub, Object.keys(packPlaces))).toEqual([]);
    for (const mutate of [
      (p) => {
        p.transports["greek-ship"].docks = ["pond", "station"];
      },
      (p) => {
        p.transports["greek-ship"].docks = 7;
      },
      (p) => {
        p.transports["greek-ship"].at = "station";
      },
      (p) => {
        p.crossings[0].transport = "unknown";
      },
      (p) => {
        p.crossings[0].signal.while = [{ kind: "magic" }];
      },
      (p) => {
        p.crossings[0].signal.opens = 3;
      },
      (p) => {
        p.places["greek-ship"].exits = ["greek-harbor"];
      },
    ]) {
      const p = greek();
      mutate(p);
      expect(
        packProblems(p, hub, Object.keys(packPlaces)).length,
        String(mutate),
      ).toBeGreaterThan(0);
    }
  });

  it("keeps every pack id out of the engine's rules", () => {
    // The only module that may name a pack's ids is the schema 6 upgrade.
    const ids = [
      ...packDefinitions.map((p) => p.id),
      ...Object.keys(packPlaces),
      ...Object.keys(packPeople),
      ...Object.keys(packFixtures),
      ...crossings.map((c) => c.id),
    ];
    for (const file of [
      "world.mjs",
      "want.mjs",
      "motives.mjs",
      "life.mjs",
      "narrative.mjs",
      "scene.mjs",
      "cards.mjs",
      "app.mjs",
      "memory.mjs",
      "dialogue.mjs",
      "pack-rules.mjs",
      "pack-transport.mjs",
      "pack-registry.mjs",
      "pack-schema.mjs",
    ]) {
      const source = readFileSync(`v2/card-game/${file}`, "utf8");
      for (const id of ids)
        expect(
          new RegExp(`["'\`]${id}["'\`]`).test(source),
          `${file} names ${id}`,
        ).toBe(false);
    }
  });

  it("mounts a pack missing from a save without disturbing the shore", () => {
    let s = enableMotives(createWorld());
    s = act(act(s, "wait"), "move", "pond");
    const old = structuredClone(s);
    delete old.crossings["pond-clearing"];
    delete old.crossings["clearing-pond"];
    delete old.packs["badger-forest"];
    delete old.actors.badger;
    delete old.peaceUntil.badger;
    delete old.memories.badger;
    delete old.memories.clearing;
    delete old.motives.grievances.badger;
    for (const actor of Object.values(old.actors)) delete actor.trust.badger;
    const mounted = decodeSave(JSON.stringify(old));
    expect(mounted.items).toEqual(s.items);
    expect(mounted.log).toEqual(s.log);
    expect(mounted.actors.vale).toEqual(s.actors.vale);
    // A pack mounted later draws its avatar's want after a short rest.
    expect(mounted.actors.badger).toEqual({ ...s.actors.badger, want: null });
    expect(mounted.crossings).toEqual(s.crossings);
    expect(mounted.packs).toEqual(s.packs);
  });
});

describe("the forest crossing's signal", () => {
  function pond() {
    const s = enableMotives(createWorld());
    s.actors.vale.place = "pond";
    s.actors.moth.place = "attic";
    s.actors.keeper.place = "pond";
    s.items.bell.holder = "vale";
    return s;
  }
  it("counts resolved plays without disclosing the next step", () => {
    let s = pond();
    expect(knownActors(s)).not.toContain("badger");
    s = act(s, "ring", null, "bell");
    expect(s.crossings["pond-clearing"].phase).toBe(1);
    const before = encodeSave(s);
    legalActions(s);
    availableCards(s);
    expect(encodeSave(s)).toBe(before);
    // The next ring would complete the signal, and the offer says so.
    expect(
      legalActions(s).find((a) => a.kind === "ring" && a.item === "bell").text,
    ).toBe("Vale rings the Bell. The sound carries across the shore.");
    s = act(s, "ring", null, "bell");
    expect(s.crossings["pond-clearing"]).toMatchObject({
      phase: 0,
      discovered: true,
    });
    expect(knownActors(s)).toContain("badger");
    expect(exits(s, "pond", "vale")).toContain("clearing");
    expect(exits(s, "pond", "keeper")).not.toContain("clearing");
  });
});

describe("planning across crossings", () => {
  it("routes the player, but not residents, through a player-only crossing", () => {
    let s = enableMotives(createWorld());
    s.actors.vale.place = "clearing";
    s.crossings["pond-clearing"].discovered = true;
    s.items.bell.holder = "vale";
    s.items.bell.ringing = 2;
    expect(plan(s, "vale").action.key).toBe("move:vale::pond");
    expect(plan(s, "badger").action.kind).toBe("wait");
  });
});

describe("the Steam Clock's own bell", () => {
  it("never leaves a silent way back from the clearing", () => {
    const s = clearing();
    expect(exits(s, "clearing", "vale")).not.toContain("pond");
    expect(availableCards(s)).not.toContain("pond");
    expect(placeText(s, "clearing")).toMatch(/Moss lies between the roots/);
  });

  it("opens the way back while the hand bell sounds at either end", () => {
    for (const holder of ["vale", "clearing", "pond"]) {
      const s = clearing();
      s.items.bell.holder = holder;
      s.items.bell.ringing = 2;
      expect(availableCards(s), holder).toContain("pond");
      expect(placeText(s, "clearing")).toMatch(/opens onto Black pond/);
    }
    const distant = clearing();
    distant.items.bell.ringing = 2;
    expect(availableCards(distant)).not.toContain("pond");
    distant.items.bell.holder = "clearing";
    distant.items.cloth.holder = "bell";
    expect(availableCards(distant)).not.toContain("pond");
  });

  it("is a play on the clearing card that reopens the way and wakes Badger", () => {
    let s = clearing();
    const plays = placePlays(s, "clearing");
    expect(plays).toHaveLength(1);
    expect(playLabel(plays[0])).toBe("Ring the Steam Clock");
    expect(legalActions(s, "badger").some((a) => a.fixture)).toBe(false);
    s = ringClock(s);
    expect(fixtureSounding(s, "steam-clock")).toBe(true);
    expect(availableCards(s)).toContain("pond");
    expect(s.items.bell.ringing).toBe(0);
    expect(s.actors.badger).toMatchObject({
      awake: true,
      wakeCause: "sound",
      irritation: 2,
    });
    expect(s.log.map((e) => e.text)).toContain(
      "A dark reflection between the roots opens onto Black pond.",
    );
    expect(s.motives.grievances.badger.some((g) => g.kind === "noise")).toBe(
      true,
    );
  });

  it("sounds for three following plays, survives reload, and can be rung again", () => {
    let s = ringClock(clearing());
    const stale = legalActions(s).find(
      (a) => a.kind === "move" && a.target === "pond",
    );
    s = decodeSave(encodeSave(act(s, "wait")));
    expect(fixtureSounding(s, "steam-clock")).toBe(true);
    s = act(act(s, "wait"), "wait");
    expect(fixtureSounding(s, "steam-clock")).toBe(false);
    expect(availableCards(s)).not.toContain("pond");
    expect(
      s.log.some((e) => e.turn === s.turn && /bells fall silent/.test(e.text)),
    ).toBe(true);
    const before = encodeSave(s);
    expect(play(s, stale).ok).toBe(false);
    expect(encodeSave(s)).toBe(before);
    s = ringClock(s);
    expect(s.packs["badger-forest"].sounds["steam-clock"]).toBe(s.turn + 3);
  });

  it("keeps its own time apart from the hand bell", () => {
    let s = clearing();
    s.items.bell.holder = "clearing";
    s.items.bell.ringing = 2;
    s = ringClock(s);
    expect(s.items.bell.ringing).toBe(1);
  });

  it("rejects saves whose clock or crossing state is out of bounds", () => {
    const s = ringClock(clearing());
    for (const mutate of [
      (x) => (x.packs["badger-forest"].sounds["steam-clock"] = x.turn + 4),
      (x) => (x.packs["badger-forest"].revision = 2),
      (x) => (x.crossings["clearing-pond"].phase = 0),
      (x) => {
        x.crossings["pond-clearing"].until = x.turn;
        x.crossings["pond-clearing"].discovered = false;
      },
      (x) => (x.actors.badger.wakeCause = "bell"),
      (x) => (x.actors.badger.irritation = 4),
      (x) => (x.crossings.invented = { discovered: true }),
    ]) {
      const broken = structuredClone(s);
      mutate(broken);
      expect(
        () => decodeSave(JSON.stringify(broken)),
        String(mutate),
      ).toThrow();
    }
  });
});

describe("a resident's temperament", () => {
  it("chooses its portrait, greeting, want and voice note from its mood", () => {
    let s = clearing();
    s.items.bell.holder = "vale";
    expect(variantOf(s, "badger").name).toBe("asleep");
    expect(portrait("badger", null, s)).toBe(
      "./assets/badger-forest/badger-sleeping.png",
    );
    const wake = legalActions(s).find(
      (a) => a.kind === "talk" && a.target === "badger",
    );
    expect(playLabel(wake)).toBe("Wake gently");
    expect(wake.text).toBe("Vale gently wakes Grumpy Badger.");
    expect(
      legalActions(s).some(
        (a) => a.target === "badger" && a.kind === "threaten",
      ),
    ).toBe(false);
    s = act(s, "talk", "badger");
    expect(variantOf(s, "badger").name).toBe("awake");
    expect(portrait("badger", null, s)).toBe(
      "./assets/badger-forest/badger-grumpy.png",
    );
    // The mood's want is pack data, worded for Talk; the rules keep the mood.
    expect(variantOf(s, "badger").want).toBe("The warm patch of moss");
    s = act(s, "ring", null, "bell");
    expect(variantOf(s, "badger").name).toBe("irritated");
    expect(variantOf(s, "badger").want).toBe("Some quiet after all that noise");
    s = act(s, "wait");
    expect(s.actors.badger.irritation).toBe(2);
    s = act(s, "wait");
    expect(variantOf(s, "badger").name).toBe("awake");
  });
});

it("joins homes through distinct hub places while checking every home has a route", () => {
  expect(packProblems(humanHomePack, hub)).toEqual([]);
  const disconnected = structuredClone(humanHomePack);
  disconnected.crossings = disconnected.crossings.filter(
    (c) => c.to !== "train",
  );
  expect(packProblems(disconnected, hub)).toContain(
    "shared-homes: every place must be reachable from the entry",
  );
});
