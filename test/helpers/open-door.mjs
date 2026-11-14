import {
  createWorld,
  currentActor,
  legalActions,
  play,
} from "../../v2/card-game/world.mjs";
import { entityActive } from "../../v2/card-game/pack-registry.mjs";
import { greekTravelTargets } from "./greek-travel.mjs";
import { needsVoyage, sailTo } from "./voyage.mjs";
import { endStandoff } from "./standoff.mjs";
import { funeralJourney } from "./greek-funeral.mjs";
import { summonTransport } from "../../v2/card-game/pack-transport.mjs";

export const g = (id) =>
  id === "vale" || id.startsWith("greek-") ? id : `greek-${id}`;

export const OPEN_DOOR_LOCKS = {
  "greek-aethra": { item: "greek-funeral-cloth", at: "greek-eleusis" },
  "greek-theseus": { item: "greek-burial-petition", at: "greek-athens" },
  "greek-adrastus": { item: "greek-olive-branch", at: "greek-eleusis" },
  "greek-argive-mother": { item: "greek-ash-urn", at: "greek-eleusis" },
  "greek-iphis": { item: "greek-ash-urn", at: "greek-eleusis" },
  "greek-household-witness": { item: "greek-ash-urn", at: "greek-eleusis" },
  "greek-quay-host": { item: "greek-wheat", at: "greek-piraeus", lying: true },
  "greek-colonus-keeper": { item: "greek-oil-flask", at: "greek-colonus" },
};
export const OPEN_DOOR_KEYS = [
  "greek-burial-petition",
  "greek-olive-branch",
  "greek-funeral-cloth",
  "greek-oil-flask",
  "greek-ash-urn",
  "greek-wheat",
  "greek-bread",
];
export const OPEN_DOOR_CAST = [
  ...Object.keys(OPEN_DOOR_LOCKS),
  "greek-ismene",
  "greek-rhapsode",
  "greek-market-neighbor",
];

export function greekStart({ full = false } = {}) {
  const world = createWorld(
    full ? { packScopes: { "greek-drama": "full" } } : {},
  );
  world.crossings["pond-greek-harbor"].discovered = true;
  world.actors.vale.place = "greek-courtyard";
  world.actors.vale.visited.push("pond", "greek-harbor", "greek-courtyard");
  world.items.lamp.lit = false;
  if (world.items.lamp.holder === "vale")
    world.items.lamp.holder = "greek-courtyard";
  return world;
}

export function traveler(world = greekStart()) {
  const t = {
    s: world,
    start: world.turn,
    get turns() {
      return t.s.turn - t.start;
    },
    act(kind, fields = {}) {
      t.s = endStandoff(t.s);
      const action = legalActions(t.s).find(
        (a) =>
          a.kind === kind &&
          !a.guards &&
          (kind !== "wait" || !a.sleep) &&
          Object.entries(fields).every(([key, value]) => a[key] === value),
      );
      if (!action)
        throw new Error(
          `No ${kind} ${JSON.stringify(fields)} at ${t.s.actors.vale.place}, turn ${t.s.turn}`,
        );
      const result = play(t.s, action, t.s.revision);
      if (!result.ok) throw new Error(result.error);
      t.s = result.state;
      return t;
    },
    move(...places) {
      for (const place of places)
        for (const target of greekTravelTargets(
          t.s.actors.vale.place,
          g(place),
        )) {
          if (needsVoyage(t.s, currentActor(t.s), target))
            t.s = sailTo(t.s, target);
          else t.act("move", { target });
        }
      return t;
    },
    take: (item) => t.act("take", { item: g(item) }),
    drop: (item) =>
      t.act("drop", { item: g(item), target: t.s.actors.vale.place }),
    give: (item, to) => t.act("give", { item: g(item), target: g(to) }),
    trade: (item, to, receive) =>
      t.act("trade", { item: g(item), receive: g(receive) }),
    talk: (who) => t.act("talk", { target: g(who) }),
    walkWith(who, ...places) {
      for (const place of places)
        for (const destination of greekTravelTargets(
          t.s.actors.vale.place,
          g(place),
        ))
          t.act("accompany", { target: g(who), destination });
      return t;
    },
    waitFor(who, limit = 72) {
      const id = g(who);
      const ready = () =>
        t.s.actors[id].place === t.s.actors.vale.place &&
        !t.s.actors[id].sleeping &&
        entityActive(t.s, id);
      for (let i = 0; i < limit && !ready(); i++) t.act("wait");
      if (!ready()) throw new Error(`${id} never came to ${t.s.actors.vale.place}`);
      return t;
    },
    hands: () =>
      Object.keys(t.s.items)
        .filter((id) => t.s.items[id].holder === "vale")
        .sort(),
    fork: () => traveler(structuredClone(t.s)),
  };
  return t;
}

export function playGreek(world, kind, fields = {}) {
  if (
    kind === "move" &&
    Object.keys(fields).join() === "target" &&
    needsVoyage(world, currentActor(world), fields.target)
  )
    return sailTo(world, fields.target);
  return traveler(world).act(kind, fields).s;
}

export function landRoad(t = traveler()) {
  t.move("well").take("water-jar");
  t.move("courtyard").give("water-jar", "baker").take("bread");
  t.move("gate").trade("bread", "guard", "decree");
  t.move("palace").trade("decree", "creon", "creon-writ");
  t.move("gate").waitFor("guard").give("creon-writ", "guard");
  t.take("shovel");
  t.move("courtyard").take("oil-flask");
  t.move("sanctuary").take("funeral-cloth");
  return t;
}

export function seaRoad(t = traveler()) {
  t.move("well").take("water-jar");
  t.move("courtyard").give("water-jar", "baker").take("bread");
  t.take("oil-flask");
  t.move("gate").take("wine-skin");
  t.move("courtyard", "harbor").give("bread", "shipmaster");
  t.give("wine-skin", "shipmaster");
  t.move("road-thebes", "courtyard", "well", "palace", "sanctuary");
  t.take("figs").take("funeral-cloth");
  t.move("palace", "well", "courtyard", "road-thebes", "harbor");
  t.give("figs", "shipmaster").take("provisions");
  t.move("ship").drop("provisions");
  return t.move("piraeus");
}

export function burial(t) {
  t.move("battlefield");
  for (
    let i = 0;
    i < 48 &&
    !legalActions(t.s).some(
      (a) => a.kind === "talk" && a.target === "greek-polynices-shade",
    );
    i++
  )
    t.act("wait");
  t.talk("polynices-shade").move("polynices-hollow");
  for (const item of ["oil-flask", "funeral-cloth", "shovel"]) {
    for (
      let i = 0;
      i < 48 &&
      !legalActions(t.s).some(
        (a) => a.kind === "give" && a.target === "greek-antigone" && a.item === g(item),
      );
      i++
    )
      t.act("wait");
    t.give(item, "antigone");
  }
  return t;
}

export const whereIs = (s, id) => s.items[id].holder;
export const holds = (s, who, id) => s.items[id].holder === g(who);
export const satisfied = (s, who) => s.actors[g(who)].metTurn !== undefined;


export const OPEN_DOOR_PLACES = [
  "greek-athens",
  "greek-piraeus",
  "greek-colonus",
  "greek-eleusis",
];
export function openDoorAction(world, kind, fields = {}) {
  const action = legalActions(world).find(
    (a) =>
      a.kind === kind &&
      Object.entries(fields).every(([key, value]) => a[key] === value),
  );
  if (!action)
    throw new Error(`Missing Greek action: ${kind} ${JSON.stringify(fields)}`);
  return action;
}
export function playOpenDoor(world, kind, fields = {}) {
  if (kind === "move" && fields.target === "greek-ship")
    for (
      let wait = 0;
      wait < 32 &&
      !legalActions(world).some(
        (a) => a.kind === "move" && a.target === "greek-ship",
      );
      wait++
    ) {
      if (world.transports["greek-ship"].dock !== world.actors.vale.place)
        summonTransport(world, "greek-ship", world.actors.vale.place);
      world = playGreek(world, "wait");
    }
  return playGreek(world, kind, fields);
}
export const openDoorWalk = (world, ...places) =>
  traveler(world).move(...places).s;

let buried;
export function openDoorStart({ rumours = false } = {}) {
  buried ||= funeralJourney().buried;
  let world = structuredClone(buried);
  if (rumours) world.packs["greek-drama"].scope = "full";
  world = openDoorWalk(world, "courtyard");
  if (world.items.lamp.holder === "vale")
    world = playGreek(world, "drop", {
      item: "lamp",
      target: "greek-courtyard",
    });
  return world;
}

let plea;
export function openSeas() {
  if (!plea) {
    const t = traveler(openDoorStart());
    t.move("eleusis").take("burial-petition");
    t.move("athens").waitFor("theseus");
    t.trade("burial-petition", "theseus", "olive-branch").drop("olive-branch");
    plea = t.s;
  }
  return structuredClone(plea);
}
