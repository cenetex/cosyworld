import { exits, legalActions, play } from "../../v2/card-game/world.mjs";
import {
  packDefinition,
  entityActive,
} from "../../v2/card-game/pack-registry.mjs";
import { transportUnlocked } from "../../v2/card-game/pack-transport.mjs";
import { knowsFact } from "../../v2/card-game/knowledge.mjs";
import {
  narrativeContext,
  applyGeneratedText,
} from "../../v2/card-game/narrative.mjs";
import { ajaxStart } from "./greek-ajax.mjs";

const pack = packDefinition("greek-drama");
const P = "greek-v-";
export const houseState = (world) => world.packs["greek-drama"];
export const houseChoice = (world, id) =>
  housePlay(world, "choose", { choiceId: P + id });

export function housePlay(world, kind, fields = {}) {
  const match = (a) =>
    a.kind === kind && Object.entries(fields).every(([k, v]) => a[k] === v);
  if (kind === "move" && fields.target === "greek-ship") {
    for (let i = 0; i < 32 && !legalActions(world).some(match); i++)
      world = housePlay(world, "wait");
  }
  const action = legalActions(world).find(match);
  if (!action)
    throw Error(
      `Missing ${kind} ${JSON.stringify(fields)} at ${world.actors.vale.place}`,
    );
  const result = play(world, action, world.revision);
  if (!result.ok) throw Error(result.error);
  return result.state;
}

// Plan a route through real roads and the established ship docks. Each step is
// still selected from the current legal actions; a boat wait is an actual turn.
export function houseGo(world, destination) {
  const docks = transportUnlocked(world, "greek-ship")
    ? pack.transports["greek-ship"].docks.filter((id) =>
        entityActive(world, id),
      )
    : [];
  const queue = [[world.actors.vale.place]],
    seen = new Set();
  while (queue.length) {
    const path = queue.shift(),
      here = path.at(-1);
    if (here === destination)
      return path
        .slice(1)
        .reduce((s, target) => housePlay(s, "move", { target }), world);
    if (seen.has(here)) continue;
    seen.add(here);
    const links = exits(world, here, "vale");
    if (docks.includes(here)) links.push("greek-ship");
    if (here === "greek-ship") links.push(...docks);
    for (const to of new Set(links))
      if (!seen.has(to)) queue.push([...path, to]);
  }
  throw Error(`No route to ${destination}`);
}

export function houseTalk(world, topicId, actor = "vale") {
  const topic = pack.topics.find((t) => t.id === topicId);
  if (!topic) throw Error(`Unknown topic ${topicId}`);
  for (let i = 0; i < 12 && !knowsFact(world, actor, topicId); i++) {
    const action = legalActions(world, actor).find(
      (a) => a.kind === "talk" && a.target === topic.speaker,
    );
    if (!action) throw Error(`Missing Talk with ${topic.speaker}`);
    const result = play(world, action, world.revision);
    if (!result.ok) throw Error(result.error);
    const context = narrativeContext(result.state, action),
      disclosure = context.disclosures?.[0];
    if (!disclosure) throw Error(`No published fact while seeking ${topicId}`);
    world = applyGeneratedText(result.state, context, {
      revision: context.revision,
      model: "fixture",
      entries: context.entities.map(({ id }) => ({
        id,
        text:
          id === disclosure.speaker
            ? disclosure.text
            : "I have heard the account.",
      })),
    });
  }
  if (!knowsFact(world, actor, topicId))
    throw Error(`Could not hear ${topicId}`);
  return world;
}

export function houseStart(account = "aeschylus") {
  let world = houseGo(ajaxStart(), "greek-harbor");
  world = houseChoice(world, "invitation");
  world = houseGo(world, "greek-argolid-road");
  return houseChoice(world, "follow-" + account);
}

export const HOUSE_PARTS = {
  agamemnon: {
    account: "aeschylus",
    record: "greek-argos-household-record",
    teller: "greek-argolid-road",
    endings: ["all-voices", "daughter-first", "refuge"],
    beats: ["supply-watch", "set-cup", "voices", "return"],
  },
  libation: {
    account: "aeschylus",
    record: "greek-tomb-testimony",
    teller: "greek-argos-tomb",
    endings: ["hearing", "refusal", "revenge"],
    beats: ["care", "signs", "answer", "return"],
    items: [
      "greek-libation-vessel",
      "greek-tomb-hair",
      "greek-tomb-woven-cloth",
    ],
  },
  "palace-electra": {
    account: "sophocles",
    record: "greek-palace-testimony",
    teller: "greek-mycenae-palace",
    endings: ["hearing", "refusal", "revenge"],
    beats: ["care", "signs", "answer", "return"],
    items: [
      "greek-palace-bread",
      "greek-palace-false-urn",
      "greek-palace-signet",
    ],
  },
  "farm-electra": {
    account: "euripides",
    record: "greek-farm-testimony",
    teller: "greek-argive-farm",
    endings: ["hearing", "refusal", "revenge"],
    beats: ["care", "signs", "answer", "return"],
    items: [
      "greek-farm-water-jar",
      "greek-farm-road-bread",
      "greek-farm-birth-message",
    ],
  },
  orestes: {
    account: "aeschylus",
    record: "greek-argos-city-petition",
    teller: "greek-argos-refuge",
    endings: ["hearing", "passage", "source"],
    beats: ["water", "petition", "answer", "return"],
  },
  eumenides: {
    account: "aeschylus",
    record: "greek-ares-case-record",
    teller: "greek-ares-hill",
    endings: ["source", "dissent", "restitution"],
    beats: ["refuge", "bowl", "answer", "return"],
  },
  tauris: {
    account: "aeschylus",
    record: "greek-tauris-shore-pact",
    teller: "greek-tauris",
    endings: ["source", "pact", "keeper"],
    beats: ["copy", "cloth", "answer", "return"],
  },
};

const prepared = new Map();
export function housePrepared(part) {
  if (prepared.has(part)) return structuredClone(prepared.get(part));
  const spec = HOUSE_PARTS[part];
  let world = houseStart(spec.account);
  const choose = (id) => {
    world = houseChoice(world, part + "-" + id);
  };
  const hear = (id) => {
    world = houseTalk(world, P + part + "-" + id);
  };
  const take = (item) => {
    world = housePlay(world, "take", { item });
  };
  const go = (place) => {
    world = houseGo(world, place);
  };
  if (part === "agamemnon") {
    hear("beacon");
    take("greek-beacon-fuel");
    choose("supply-watch");
    go("greek-argos-palace");
    hear("cassandra");
    take("greek-cassandra-cup");
    choose("set-cup");
    hear("doors");
    take(spec.record);
  } else if (spec.items) {
    go(spec.teller);
    hear("opening");
    take(spec.items[0]);
    choose("care");
    hear("recognition");
    spec.items.slice(1).forEach(take);
    choose("signs");
    if (part === "farm-electra") hear("mother");
    hear("source-ending");
    world = housePlay(world, "choose", {
      choiceId: "greek-hear-electra-" + spec.account,
    });
    take(spec.record);
  } else if (part === "orestes") {
    go(spec.teller);
    hear("opening");
    take("greek-sickroom-water");
    choose("water");
    hear("city");
    take(spec.record);
    choose("petition");
    hear("apollo");
    take("greek-argos-road-bundle");
  } else if (part === "eumenides") {
    go("greek-delphi");
    hear("delphi");
    take("greek-delphi-suppliant-branch");
    choose("refuge");
    choose("agree-court");
    ["greek-ares-vote-bowl", "greek-ares-voting-stones", spec.record].forEach(
      take,
    );
    for (const destination of ["greek-athens", "greek-ares-hill"])
      world = housePlay(world, "accompany", {
        target: "greek-furies",
        destination,
      });
    hear("trial");
    choose("bowl");
    hear("settlement");
    take(spec.record);
  } else if (part === "tauris") {
    go("greek-tauris");
    hear("letter");
    take("greek-tauris-sister-letter");
    choose("copy");
    hear("childhood");
    take("greek-tauris-childhood-cloth");
    choose("cloth");
    [
      "greek-tauris-cleansing-water",
      "greek-tauris-artemis-image",
      spec.record,
    ].forEach(take);
    go("greek-tauris-shore");
    hear("escape");
    choose("shore");
  }
  prepared.set(part, structuredClone(world));
  return world;
}

export function houseEnded(part, ending = HOUSE_PARTS[part].endings[0]) {
  const spec = HOUSE_PARTS[part];
  let world = housePrepared(part);
  const choose = (id) => {
    world = houseChoice(world, part + "-" + id);
  };
  const go = (place) => {
    world = houseGo(world, place);
  };
  if (part === "agamemnon") {
    if (ending === "refuge") {
      choose("agree-refuge");
      for (const destination of [
        "greek-argos-tomb",
        "greek-argolid-road",
        "greek-argos-refuge",
      ])
        world = housePlay(world, "accompany", {
          target: "greek-argos-housekeeper",
          destination,
        });
    } else if (ending === "all-voices") go("greek-argos-tomb");
  } else if (spec.items) {
    if (ending === "revenge") choose("choose-source");
    else
      world = housePlay(world, "choose", {
        choiceId: `greek-atreid-${spec.account}-${ending}`,
      });
    world = housePlay(world, "take", { item: spec.record });
    if (ending === "hearing") go("greek-ares-hill");
  } else if (part === "orestes") {
    if (ending === "hearing") choose("hermione-consent");
    if (ending === "passage") {
      choose("agree-passage");
      for (const destination of ["greek-argolid-road", "greek-harbor"])
        world = housePlay(world, "accompany", {
          target: "greek-phrygian-servant",
          destination,
        });
    }
  } else if (part === "eumenides" && ending === "restitution")
    world = housePlay(world, "take", { item: "greek-ares-vote-bowl" });
  else if (part === "tauris" && ending !== "source") {
    choose("assent-thoas");
    go("greek-tauris");
    choose("assent-women");
    if (ending === "keeper") choose("assent-iphigenia");
    go("greek-tauris-shore");
  }
  choose(ending);
  return world;
}

export function houseAccount(part, ending = HOUSE_PARTS[part].endings[0]) {
  const spec = HOUSE_PARTS[part];
  let world = houseEnded(part, ending);
  world = houseGo(world, world.items[spec.record].holder);
  world = housePlay(world, "take", { item: spec.record });
  world = houseGo(world, spec.teller);
  return houseTalk(world, P + part + "-account-" + ending);
}

export function houseJourney(part, ending = HOUSE_PARTS[part].endings[0]) {
  const world = houseGo(houseAccount(part, ending), "greek-courtyard");
  return houseChoice(world, part + "-return-" + ending);
}
