// Residents roam, can be invited along and can stand their ground. Every
// resident of every mounted pack is checked against one explicit allow-list:
// anyone not listed is offered Invite beside the player and joins a standoff
// when threatened; anyone freed to roam walks on a want, sleeps at home and
// never leaves their pack. The allow-list is the whole list of who stays put.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  createWorld,
  decodeSave,
  encodeSave,
  exits,
  legalActions,
  play,
} from "../v2/card-game/world.mjs";
import {
  entityActive,
  packDefinitions,
  packEntity,
  packPeople,
  packOf,
  transports,
} from "../v2/card-game/pack-registry.mjs";
import {
  hops,
  lifeHome,
  rangeOf,
  worldLife,
} from "../v2/card-game/resident-home.mjs";
import { residentAsleep } from "../v2/card-game/resident-sleep.mjs";
import { humanAvatarIds } from "../v2/card-game/human-cast.mjs";
import { selectLamp } from "./fixtures/card-attic-opening.mjs";
import { enableMotives } from "../v2/card-game/motives.mjs";
import { endStandoff } from "./helpers/standoff.mjs";
import { openDoorStart } from "./helpers/open-door.mjs";
import { ajaxCamp } from "./helpers/greek-ajax.mjs";

// Residents who are not offered Invite (Oak and the Badger because they stay
// in one place by design; the rest because their place is structural).
const NO_INVITE = {
  oak: "Oak stays in one place by design (a backdrop tree).",
  badger: "The Badger stays on his moss by design; his clearing has no way out.",
  skull:
    "Skull's home, the Moonlit Trail, is shut until the drain is cleared: out of it he could not walk home.",
  "greek-guard": "The Gate Guard is a lock: if he leaves his post the way opens for everyone.",
  "greek-polynices-shade": "The Shade is a night apparition at the Hollow.",
  "greek-household-witness": "Myrine has an authored journey and travels only on it.",
  "greek-patroclus":
    "Patroclus starts aboard the Charybdis, where the only plays are the ship's course; the quay invites him once the ship has docked (card-greek-patroclus).",
  "willows-swede": "The Swede stays at camp until the kit is back (stayUntil).",
  boardyai: "Boardy's parlour has no way out; he visits by his own calls.",
};
// Residents who do not join a standoff.
const NO_STANDOFF = {
  badger:
    "The Badger is asleep until greeted and card-packs pins that a sleeper cannot be threatened (standoffs: false).",
  "greek-rhapsode": "The rhapsode is the pack's recital actor, which the pack schema pins to standoffs: false.",
  "greek-household-witness": "Myrine (journey).",
  "greek-polynices-shade": "The Shade (night apparition).",
  "willows-swede": "The Swede (stayUntil).",
  boardyai: "Boardy, the shared-world connector.",
};
// The Hoppy Cat pack is paused by the owner: left exactly as it was.
const paused = (id) => id.startsWith("hoppycat-");

const scopes = Object.fromEntries(
  packDefinitions.filter((p) => p.release).map((p) => [p.id, "full"]),
);

const restore = [];
const routeKeys =packDefinitions.flatMap((p) =>
  (p.routes || []).filter((r) => r.requires?.length).map((r) => `${r.from}>${r.to}`),
);
function beside(id, open = true) {
  const s = createWorld({ seed: 7, packScopes: scopes });
  if (open) {
    for (const key of Object.keys(s.crossings)) s.crossings[key].discovered = true;
    s.openedRoutes = routeKeys;
  }
  const pack = packPeople[id]?.packId;
  if (pack && s.packs[pack].met) s.packs[pack].met[id] = 0;
  s.actors.vale.place = s.actors[id].place;
  return s;
}
const offered = (id, kind) =>
  legalActions(beside(id)).some((a) => a.kind === kind && a.target === id);
const cast = () =>
  Object.keys(createWorld({ seed: 7, packScopes: scopes }).actors).filter(
    (id) => !humanAvatarIds.includes(id) && id !== "vale",
  );

describe("who can be invited along and threatened", () => {
  // Show every resident at once. Only legalActions is read on these worlds,
  // and the registry is put back before the movement tests.
  beforeAll(() => {
    for (const a of Object.values(packPeople)) {
      restore.push([a, a.requires, a.appearsWhen]);
      a.requires = [];
      a.appearsWhen = [];
    }
  });
  afterAll(() => {
    for (const [a, requires, appearsWhen] of restore) {
      a.requires = requires;
      a.appearsWhen = appearsWhen;
    }
  });

  it("lists every resident of every mounted pack", () => {
    expect(cast().length).toBeGreaterThan(50);
    for (const id of Object.keys(NO_INVITE)) expect(cast()).toContain(id);
    for (const id of Object.keys(NO_STANDOFF)) expect(cast()).toContain(id);
  });

  it("offers Invite beside everyone except the allow-list", () => {
    const missing = cast().filter(
      (id) => !(id in NO_INVITE) && !paused(id) && !offered(id, "accompany"),
    );
    expect(missing).toEqual([]);
  });

  it("keeps the allow-list honest: nobody on it is offered Invite", () => {
    for (const id of Object.keys(NO_INVITE))
      expect(offered(id, "accompany"), id).toBe(false);
  });

  it("offers Threaten beside everyone except the allow-list", () => {
    const missing = cast().filter(
      (id) => !(id in NO_STANDOFF) && !paused(id) && !offered(id, "threaten"),
    );
    expect(missing).toEqual([]);
    // Oak stays in one place but still stands his ground.
    expect(offered("oak", "threaten")).toBe(true);
  });

  it("says plainly who is offered what", () => {
    // The table the pull request prints, kept in step with the rules.
    const table = {};
    for (const id of cast())
      if (!paused(id))
        table[id] = [
          offered(id, "accompany") ? "invite" : "-",
          offered(id, "threaten") ? "threaten" : "-",
        ].join(" ");
    expect(table.oak).toBe("- threaten");
    expect(table.badger).toBe("- -");
    expect(table.rati).toBe("invite threaten");
    expect(table.whiskerwind).toBe("invite threaten");
    expect(table["greek-aethra"]).toBe("invite threaten");
  });
});

// Freed residents, the world that shows them, and the want that sends each
// walking. Range is hops from home; none may leave their pack.
const FREED = {
  rati: "default",
  whiskerwind: "default",
  "greek-aethra": "opendoor",
  "greek-adrastus": "opendoor",
  "greek-theseus": "opendoor",
  "greek-quay-host": "ajax",
  "greek-colonus-keeper": "opendoor",
  "greek-marathon-keeper": "opendoor",
  "greek-argive-mother": "ajax",
  "greek-iphis": "ajax",
  "greek-ajax-tecmessa": "ajax",
  "greek-ajax-teucer": "ajax",
  "greek-ajax-odysseus": "ajax",
};
// The helper worlds are built with world life off, as their journeys expect.
const built = (make) => () => {
  worldLife.on = false;
  return make();
};
const worlds = {
  default: built(() => createWorld({ seed: 7, packScopes: scopes })),
  opendoor: built(() => openDoorStart({ rumours: true })),
  ajax: built(() => ajaxCamp()),
};
const DAY = 48;
const life = worldLife.on;
afterAll(() => {
  worldLife.on = life;
});

describe("freed residents walk on their wants and sleep at home", () => {
  for (const [id, scenario] of Object.entries(FREED))
    it(`${id} errands out and home again`, () => {
      let s = worlds[scenario]();
      const home = lifeHome(id, s);
      // The player stays out of the way: residents step off only where none is.
      if (s.actors.vale.place === home)
        s.actors.vale.place = exits(s, home, "vale")[0];
      if (!entityActive(s, id)) {
        // Sealed until its story opens: shown the way the story would.
        packPeople[id].requires = [];
      }
      expect(entityActive(s, id), id).toBe(true);
      const range = rangeOf(s, id);
      expect(range, id).toBeGreaterThan(0);
      const there = exits(s, home, id).find(
        (p) =>
          entityActive(s, p) &&
          !Object.hasOwn(transports, p) && // a ship needs sailing
          hops(home, p) <= range &&
          p !== home,
      );
      expect(there, `${id} has somewhere to go`).toBeTruthy();
      s.actors[id].want = {
        kind: "place",
        target: there,
        since: s.turn,
        refusals: 0,
      };
      s = decodeSave(encodeSave(s));
      worldLife.on = true;
      s.turn = s.revision = Math.max(s.turn, DAY);
      s = decodeSave(encodeSave(s));
      const visited = new Set([s.actors[id].place]);
      let slept = 0,
        awayAsleep = 0;
      for (let i = 0; i < 2 * DAY; i++) {
        const wait = legalActions(s).find(
          (a) => a.kind === "wait" && !a.sleep && !a.guards,
        );
        const done = play(s, wait, s.revision);
        expect(done.ok, done.error).toBe(true);
        s = done.state;
        const place = s.actors[id].place;
        visited.add(place);
        // Never beyond range, never out of the pack.
        expect(hops(home, place), `${id} at ${place}`).toBeLessThanOrEqual(range);
        expect(packEntity(place)?.packId, `${id} at ${place}`).toBe(
          packOf(id).id,
        );
        if (residentAsleep(s, id)) {
          if (place === home) slept++;
          else awayAsleep++;
        }
      }
      expect(visited.size, `${id} visited ${[...visited]}`).toBeGreaterThanOrEqual(2);
      expect(slept, `${id} slept at home`).toBeGreaterThan(0);
      expect(awayAsleep, `${id} slept away from home`).toBe(0);
      expect(decodeSave(encodeSave(s))).toEqual(s);
    });
});

describe("residents stand their ground", () => {
  const move = (s, target) => {
    const action = legalActions(s).find(
      (a) => a.kind === "move" && a.target === target,
    );
    expect(action, "move " + target).toBeTruthy();
    const done = play(s, action, s.revision);
    expect(done.ok, done.error).toBe(true);
    return done.state;
  };
  const forest = (...route) => {
    let s = enableMotives(createWorld());
    s.actors.vale.place = "attic";
    s.items.cloth.holder = "vale";
    s.items.lamp.holder = "attic";
    s.items.lamp.lit = true;
    s.items.lamp.fuel = 12;
    for (const place of route) s = move(s, place);
    return s;
  };
  const threatened = (s, id) => {
    const action = legalActions(s).find(
      (a) => a.kind === "threaten" && a.target === id,
    );
    expect(action, "threaten " + id).toBeTruthy();
    const done = play(s, action, s.revision);
    expect(done.ok, done.error).toBe(true);
    expect(done.state.standoffs.some((c) => Object.hasOwn(c.resolve, id))).toBe(
      true,
    );
    return endStandoff(done.state);
  };
  it("RATi, Whiskerwind and Oak join a standoff and it ends", () => {
    threatened(forest("forest-cottage"), "rati");
    threatened(forest("forest-cottage", "forest-garden"), "whiskerwind");
    threatened(forest("forest-cottage", "forest-garden", "forest-oak"), "oak");
  });
  it("the Badger stays on his moss and is greeted, not threatened", () => {
    let s = enableMotives(createWorld());
    s.actors.vale.place = "pond";
    s.actors.moth.place = "attic";
    s.actors.keeper.place = "station";
    s.items.bell.holder = "vale";
    s.items.lamp.holder = "vale";
    s = selectLamp(s);
    const act = (kind, target) => {
      s = endStandoff(s);
      const action = legalActions(s).find(
        (a) =>
          a.kind === kind &&
          (!target || a.target === target) &&
          (kind !== "ring" || a.item === "bell"),
      );
      expect(action, kind + " " + target).toBeTruthy();
      s = play(s, action).state;
    };
    act("ring");
    act("ring");
    act("move", "clearing");
    expect(s.actors.vale.place).toBe("clearing");
    expect(legalActions(s).some((a) => a.kind === "accompany")).toBe(false);
    expect(legalActions(s).some((a) => a.kind === "threaten")).toBe(false);
  });
});
