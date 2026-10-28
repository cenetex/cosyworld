import { strict as assert } from "node:assert";
import {
  decodeSave,
  encodeSave,
  exits,
  legalActions,
  play,
} from "../../v2/card-game/world.mjs";
import { packDefinition } from "../../v2/card-game/pack-registry.mjs";
import { dispatchShared } from "../../v2/card-game/shared-world.mjs";
import {
  applyGeneratedText,
  narrativeContext,
} from "../../v2/card-game/narrative.mjs";
import { openDoorJourney } from "./open-door.mjs";

export const comedyPack = packDefinition("greek-drama");
export const comedyState = (world) => world.packs["greek-drama"];
export const comedyId = (work, suffix) => `greek-comedy-${work}-${suffix}`;
let returned;

// The fixture travels, carries, speaks and pays through public model actions.
// Every saved action is checked again after a complete save round trip.
export class ComedyPlayer {
  constructor(world, actor = "vale", shared = false) {
    this.world = structuredClone(world);
    this.actions = [];
    this.actor = actor;
    this.shared = shared;
  }
  request(op, actor, fields = {}) {
    const result = dispatchShared({
      op,
      world: this.world,
      actor,
      claimed: ["vale", "mara"],
      present: ["vale", "mara"],
      ...fields,
    });
    assert(result.ok, result.error);
    this.world = result.world;
    return result;
  }
  offered(actor = this.actor) {
    return this.shared
      ? this.request("view", actor).actions
      : legalActions(this.world, actor);
  }
  step(kind, fields = {}) {
    const action = this.offered().find(
      (entry) =>
        entry.kind === kind &&
        Object.entries(fields).every(([key, value]) => entry[key] === value),
    );
    assert(
      action,
      `Missing ${kind} ${JSON.stringify(fields)} at ${this.place}`,
    );
    const result = this.shared
      ? this.request("play", this.actor, { action })
      : play(this.world, action, this.world.revision);
    assert(result.ok, result.error);
    this.actions.push(action);
    this.world = decodeSave(
      encodeSave(this.shared ? result.world : result.state),
    );
    return this;
  }
  get place() {
    return this.world.actors[this.actor].place;
  }
  walk(target, recall = true) {
    const pending = [[this.place]],
      seen = new Set([this.place]);
    while (pending.length) {
      const path = pending.shift();
      if (path.at(-1) === target) {
        for (const to of path.slice(1)) this.step("move", { target: to });
        return this;
      }
      for (const to of exits(
        this.world,
        path.at(-1),
        this.actor,
        path.at(-2) || null,
      )) {
        if (seen.has(to)) continue;
        seen.add(to);
        pending.push([...path, to]);
      }
    }
    // A previous passenger can leave the shared ship at another shore. Wait
    // at the real harbor to recall it, then plan against its new saved dock.
    if (recall && seen.has("greek-harbor")) {
      this.walk("greek-harbor", false);
      for (let turns = 0; turns < 32; turns++) {
        if (exits(this.world, this.place, this.actor).includes("greek-ship"))
          return this.walk(target, false);
        this.step("wait");
      }
    }
    throw new Error(`No open route from ${this.place} to ${target}`);
  }
  take(item) {
    const holder = this.world.items[item].holder;
    if (holder === this.actor) return this;
    this.walk(this.world.actors[holder]?.place || holder);
    this.step(this.world.actors[holder] ? "ask" : "take", {
      item,
      ...(this.world.actors[holder] ? { target: holder } : {}),
    });
    assert.equal(this.world.items[item].holder, this.actor);
    return this;
  }
  give(item, target) {
    this.take(item).walk(this.world.actors[target].place);
    return this.step("give", { item, target });
  }
  escort(target, destination) {
    this.walk(this.world.actors[target].place);
    this.step("accompany", { target, destination });
    assert.equal(this.world.actors[target].place, destination);
    return this;
  }
  choice(id) {
    const choice = comedyPack.choices.find((entry) => entry.id === id);
    assert(choice, `Unknown choice ${id}`);
    for (const rule of choice.requires || [])
      if (rule.kind === "holding" && rule.role === "actor")
        this.take(rule.item);
    this.walk(choice.at);
    if (id.endsWith("-return")) this.beforeReturn = structuredClone(this.world);
    if (id.includes("-end-")) this.beforeEnding = structuredClone(this.world);
    const topic = comedyPack.topics.find((entry) => entry.choiceId === id);
    if (!topic) return this.step("choose", { choiceId: id });
    const action = legalActions(this.world).find(
      (entry) => entry.kind === "talk" && entry.target === topic.speaker,
    );
    assert(action, `Missing Talk for ${id}`);
    const result = play(this.world, action, this.world.revision);
    assert(result.ok, result.error);
    const context = narrativeContext(result.state, action);
    assert.equal(context.disclosures?.[0]?.factId, topic.id, `Reserved ${id}`);
    this.actions.push(action);
    this.world = applyGeneratedText(result.state, context, {
      revision: context.revision,
      model: "fixture",
      entries: context.entities.map(({ id: speaker }) => ({
        id: speaker,
        text:
          speaker === topic.speaker
            ? topic.text
            : comedyPack.avatars[speaker]?.expression === "movement"
              ? `${comedyPack.avatars[speaker].name} watches the plate.`
              : "I heard the account.",
      })),
    });
    assert(Object.hasOwn(comedyState(this.world).receipts, id), `Commit ${id}`);
    this.world = decodeSave(encodeSave(this.world));
    return this;
  }
  learn(topicId) {
    assert(this.shared, "Use the shared speech boundary for this lesson");
    const topic = comedyPack.topics.find((entry) => entry.id === topicId);
    for (const condition of topic.requires || [])
      if (condition.kind === "knows") this.learn(condition.topic);
    if (this.world.knowledge.known[this.actor]?.[topicId]) return this;
    this.walk(this.world.actors[topic.speaker].place);
    for (let i = 0; i < 16; i++) {
      if (this.world.knowledge.known[this.actor]?.[topicId]) return this;
      const action = this.offered().find(
        (a) => a.kind === "talk" && a.target === topic.speaker,
      );
      assert(action, `Missing ${topic.speaker} Talk`);
      const { context } = this.request("play", this.actor, { action });
      const disclosure = context.disclosures?.[0];
      assert(disclosure, `Missing source disclosure for ${topicId}`);
      this.request("speech", this.actor, {
        room: this.place,
        disclosures: context.disclosures,
        lines: [
          { actorId: this.actor, text: "Please share the authorised account." },
          { actorId: topic.speaker, text: disclosure.text },
        ],
      });
      this.world = decodeSave(encodeSave(this.world));
    }
    throw new Error(`Did not hear ${topicId}`);
  }
  in(work) {
    this.work = work;
    return this;
  }
  do(...suffixes) {
    for (const suffix of suffixes) this.choice(comedyId(this.work, suffix));
    return this;
  }
}

export function comedyStart(work) {
  returned ||= openDoorJourney().world;
  const player = new ComedyPlayer(returned);
  player.choice("greek-comedy-invitation").in(work).do("enter");
  return player;
}

export const comedyRoutes = {
  acharnians: ["private", "shared", "care"],
  knights: ["renewed", "stores", "patronage"],
  wasps: ["tricked", "open", "hired"],
  clouds: ["evasion", "repayment", "fire"],
  lysistrata: ["feast", "council", "narrow"],
  assemblywomen: ["whole", "amended", "hidden"],
  wealth: ["worthy", "share", "farm"],
  thesmophoria: ["rescue", "answer", "judgment"],
};

export function comedyResult(work, route, player = comedyStart(work)) {
  const id = (suffix) => comedyId(work, suffix);
  player.in(work);
  switch (work) {
    case "acharnians":
      player.do(
        "offered-truces",
        "private-terms",
        "set-truce",
        "lost-farm",
        "megarian-household",
        "boeotian-market",
        "lay-boundary",
        "two-suppers-report",
        `pledge-${route}`,
      );
      if (route === "private") player.do("private-meal");
      if (route === "care") player.do("soldier-care");
      if (route === "shared") {
        player.do(
          "shared-farmer-assent",
          "shared-megarian-assent",
          "shared-boeotian-assent",
          "open-lane",
          "first-exchange",
        );
        player.escort(id("dercetes"), id("trading-lane"));
      }
      break;
    case "knights":
      player.do(
        "demosthenes-kitchen",
        "nicias-kitchen",
        "bring-dish",
        "rivals-claim",
        "lay-oracles",
        "demos-appointment",
      );
      player.give(id("demoss-genuine-ring"), id("agoracritus"));
      player.do(
        "ring-handover",
        "prepare-renewal",
        "renewal-report",
        "renewed-demos",
        "renewed-feast",
        `pledge-${route}`,
      );
      if (route === "stores")
        player.do(
          "stores-approval",
          "keeper-demosthenes",
          "keeper-nicias",
          "public-tally",
        );
      if (route === "patronage") {
        player.do("private-favour");
        player.take(id("serving-dish"));
      }
      break;
    case "wasps": {
      const method = {
        tricked: "misdirection",
        open: "open",
        hired: "purchased",
      }[route];
      player.do(
        "father-terms",
        "son-terms",
        "set-court",
        "cheese-evidence",
        "dog-testimony",
        `method-${method}`,
        `vote-${method}-acquittal`,
        "record-verdict",
        "revel-report",
        "myrtia-claim",
        "injury-claim",
        "closing-dance",
        `pledge-${route}`,
      );
      player.do(
        ...(route === "hired"
          ? ["judge-favour"]
          : ["baker-payment", "claimant-care"]),
      );
      break;
    }
    case "clouds":
      player.do(
        "pasias-claim",
        "amynias-claim",
        "horses",
        "gather-debts",
        "school-arguments",
        "test-lesson",
        "father-harm",
        "son-harm",
        "weigh-lesson",
        `pledge-${route}`,
      );
      player.do(
        ...(route === "evasion"
          ? ["false-decision"]
          : route === "repayment"
            ? ["settlement", "amynias-payment", "father-repair", "son-repair"]
            : ["torch-at-door", "attack-damage"]),
      );
      break;
    case "lysistrata":
      player.do(
        "lysistrata-vow",
        "lampito-vow",
        "myrrhine-vow",
        "cinesias-reply",
        "oath-cup",
        "spending-account",
        "treasury-supplies",
        "weave-cloth",
        "herald-cloth",
        "envoy-terms",
        `pledge-${route}`,
        "lysistrata-terms",
        "herald-reply",
        "lampito-reply",
        "publish-treaty",
        "key-permission",
      );
      if (route === "council")
        player.do("council-pledge", "lampito-council", "lodge-council");
      else player.give(id("treasury-key"), id("lysistrata"));
      break;
    case "assemblywomen":
      player.do(
        "planned-speech",
        "assembly-outfit",
        "assembly-vote",
        "return-loan",
        "citizen-contribution",
        "citizen-withholding",
        "count-goods",
        "older-woman-law",
        "young-man-law",
        `pledge-${route}`,
      );
      if (route === "amended")
        player.do(
          "praxagora-amendment",
          "older-woman-amendment",
          "young-man-amendment",
        );
      if (route === "hidden")
        player.do("withholder-permission", "conceal-purse");
      player.do("publish-law", "cook-feast");
      break;
    case "wealth":
      player.do("plutus-at-gate", "plutus-consent");
      player.escort(id("plutus"), id("healing-porch"));
      player.do(
        "welcome-arrival",
        "poverty-claim",
        "household-wage",
        "healing-bed",
        "cure-report",
        "sight-answer",
        "record-healing",
        "just-man-claim",
        "carion-journey",
      );
      for (const who of ["plutus", "just-man", "carion"])
        player.escort(id(who), id("distribution-granary"));
      player.do(
        "informer-claim",
        "closing-petitioners",
        "god-arrived",
        `pledge-${route}`,
      );
      player.do(
        ...(route === "worthy"
          ? ["worthy-grain", "procession-pot"]
          : route === "share"
            ? ["distribution-terms", "shared-grain", "workers-wage"]
            : ["private-farm-terms", "farm-stores"]),
      );
      break;
    case "thesmophoria":
      player.do(
        "mica-words",
        "critylla-words",
        "speakers-garland",
        "robe-loan",
        "borrowed-dress",
        "kinsman-consent",
      );
      player.escort(id("mnesilochus"), "greek-festival");
      player.do(
        "festival-arrival",
        "exposure-report",
        "mica-wineskin",
        "custody-evidence",
      );
      player.escort(id("mnesilochus"), id("guarded-performance-stage"));
      player.do("guarded-arrival", "poet-consent");
      player.escort(id("euripides"), id("guarded-performance-stage"));
      player.do(
        `pledge-${route}`,
        "mica-pact",
        "critylla-pact",
        "stage-message",
        "perform-mask",
        "poet-answer",
        "release-terms",
      );
      player.escort(id("euripides"), "greek-athens").do("poet-exit");
      player.escort(id("mnesilochus"), "greek-athens");
      break;
    default:
      throw new Error(`Unknown comedy ${work}`);
  }
  return player.do(`end-${route}`);
}

export function comedyJourney(work, route) {
  const player = comedyResult(work, route);
  if (work === "acharnians") player.do("trader-signature");
  if (work === "lysistrata") player.do("lampito-signature");
  return player.do("signed-account", "return");
}
