import { legalActions, play } from "../../v2/card-game/world.mjs";
import {
  narrativeContext,
  applyGeneratedText,
} from "../../v2/card-game/narrative.mjs";
import { ajaxJourney } from "./greek-ajax.mjs";

const earlierJourneys = new Map();
function earlierJourney(id, build) {
  if (!earlierJourneys.has(id)) earlierJourneys.set(id, build());
  return structuredClone(earlierJourneys.get(id));
}

export function bookPlay(world, kind, fields = {}, actor = "vale") {
  const action = legalActions(world, actor).find(
    (candidate) =>
      candidate.kind === kind &&
      Object.entries(fields).every(([key, value]) => candidate[key] === value),
  );
  if (!action)
    throw new Error(`${actor} needs ${kind} ${JSON.stringify(fields)}`);
  const result = play(world, action, world.revision);
  if (!result.ok) throw new Error(result.error);
  return result.state;
}

export const thraceChoice = (world, id) =>
  bookPlay(world, "choose", { choiceId: `greek-thrace-${id}` });

export function thraceStart() {
  let world = bookMove(earlierJourney("troy", troyJourney), "greek-harbor");
  world = thraceChoice(world, "invitation");
  return bookMove(bookBoard(world), "greek-thrace");
}

export function thraceEvidence() {
  const hecuba = "greek-thrace-hecuba";
  let world = bookPlay(thraceStart(), "take", {
    item: "greek-thrace-polyxena-cloth",
  });
  world = bookTalk(world, "greek-thrace-polyxena", "greek-thrace-farewell");
  world = thraceChoice(world, "lay-cloth");
  world = bookTalk(world, hecuba, "greek-thrace-losses");
  world = thraceChoice(world, "prepare-shroud");
  world = bookMove(world, "greek-thrace-burial-ground");
  world = bookPlay(world, "take", { item: "greek-thrace-polydorus-shroud" });
  world = bookMove(world, "greek-thrace");
  world = thraceChoice(world, "lay-shroud");
  world = bookMove(world, "greek-thrace-summons-tent");
  world = bookTalk(world, "greek-thrace-polymestor", "greek-thrace-custody");
  world = bookPlay(world, "take", { item: "greek-thrace-gold-record" });
  world = bookMove(world, "greek-thrace");
  world = thraceChoice(world, "compare-record");
  world = bookPlay(world, "take", { item: "greek-thrace-case-papers" });
  return bookPlay(world, "give", {
    item: "greek-thrace-case-papers",
    target: hecuba,
  });
}

export function thraceBurials(route = "revenge") {
  const hecuba = "greek-thrace-hecuba";
  let world = thraceEvidence();
  for (const id of ["gold-record", "polyxena-cloth", "polydorus-shroud"])
    world = bookPlay(world, "take", { item: `greek-thrace-${id}` });
  world = thraceChoice(world, `choose-${route}`);
  if (route === "two-burials") {
    world = thraceChoice(world, "leave-charge");
  } else {
    world = bookPlay(world, "accompany", {
      target: hecuba,
      destination: "greek-thrace-summons-tent",
    });
    if (route === "revenge") {
      world = thraceChoice(world, "set-trap");
      world = bookTalk(
        world,
        "greek-thrace-polymestor",
        "greek-thrace-prophecy",
      );
      world = bookTalk(world, hecuba, "greek-thrace-judgment");
    } else {
      world = thraceChoice(world, "file-charge");
      world = bookTalk(world, "greek-thrace-polymestor", "greek-thrace-answer");
      world = bookPlay(world, "ask", { item: "greek-thrace-entrusted-gold" });
      world = bookPlay(world, "give", {
        item: "greek-thrace-entrusted-gold",
        target: hecuba,
      });
      world = thraceChoice(world, "acknowledge-gold");
    }
  }
  world = bookPlay(world, "accompany", {
    target: hecuba,
    destination: "greek-thrace-burial-ground",
  });
  world = thraceChoice(world, `bury-${route}`);
  return thraceChoice(world, "seal-case");
}

export function thraceJourney(route = "revenge") {
  let world = bookPlay(thraceBurials(route), "ask", {
    item: "greek-thrace-case-papers",
  });
  world = bookTalk(
    world,
    "greek-thrace-hecuba",
    `greek-thrace-account-${route}`,
  );
  world = bookMove(world, "greek-thrace");
  world = bookMove(bookBoard(world), "greek-harbor", "greek-courtyard");
  return thraceChoice(world, `return-${route}`);
}

export const susaChoice = (world, id) =>
  bookPlay(world, "choose", { choiceId: `greek-susa-${id}` });

export function susaStart() {
  let world = bookMove(earlierJourney("thrace", thraceJourney), "greek-harbor");
  world = susaChoice(world, "invitation");
  return bookMove(
    bookBoard(world),
    "greek-ajax-landing",
    "greek-greek-camp",
    "greek-troy",
    "greek-susa-road",
    "greek-susa",
  );
}

export function susaReady() {
  let world = bookPlay(susaStart(), "take", { item: "greek-susa-broken-oar" });
  world = bookMove(world, "greek-susa-tomb");
  world = bookTalk(world, "greek-susa-atossa", "greek-susa-messenger");
  world = susaChoice(world, "set-oar");
  world = bookMove(world, "greek-susa");
  for (const id of ["dead-names", "offering-water"])
    world = bookPlay(world, "take", { item: `greek-susa-${id}` });
  world = bookMove(world, "greek-susa-tomb");
  world = susaChoice(world, "pour-water");
  world = bookTalk(world, "greek-susa-atossa", "greek-susa-warning");
  world = bookMove(world, "greek-susa");
  world = bookPlay(world, "take", { item: "greek-susa-cloak" });
  world = bookMove(world, "greek-susa-threshold");
  return bookPlay(world, "give", {
    item: "greek-susa-cloak",
    target: "greek-susa-xerxes",
  });
}

export function susaAudience(route = "public") {
  let world = susaChoice(susaReady(), `choose-${route}`);
  world = bookPlay(world, "accompany", {
    target: "greek-susa-xerxes",
    destination: "greek-susa",
  });
  world = susaChoice(world, "receive-return");
  if (route === "private") {
    world = bookMove(world, "greek-susa-tomb");
    world = susaChoice(world, "agree-mother");
    world = bookPlay(world, "accompany", {
      target: "greek-susa-atossa",
      destination: "greek-susa",
    });
  }
  return bookTalk(
    world,
    route === "private" ? "greek-susa-atossa" : "greek-susa-xerxes",
    `greek-susa-account-${route}`,
  );
}

export function susaJourney(route = "public") {
  let world = bookMove(
    susaAudience(route),
    "greek-susa-road",
    "greek-troy",
    "greek-greek-camp",
    "greek-ajax-landing",
  );
  world = bookMove(bookBoard(world), "greek-harbor", "greek-courtyard");
  return susaChoice(world, `return-${route}`);
}

export const bookMove = (world, ...places) =>
  places.reduce((state, target) => bookPlay(state, "move", { target }), world);
export const aulisChoice = (world, id) =>
  bookPlay(world, "choose", { choiceId: `greek-aulis-${id}` });
export const aulisState = (world) => world.packs["greek-drama"];

export const lemnosChoice = (world, id) =>
  bookPlay(world, "choose", { choiceId: `greek-lemnos-${id}` });

export function bookDocked(world, actor = "vale") {
  for (let turn = 0; turn < 16; turn++) {
    if (
      legalActions(world, actor).some(
        (a) => a.kind === "move" && a.target === "greek-ship",
      )
    )
      return world;
    world = bookPlay(world, "wait", {}, actor);
  }
  throw new Error("The shared ship still has passengers on another voyage.");
}

export const bookBoard = (world, actor = "vale") =>
  bookPlay(bookDocked(world, actor), "move", { target: "greek-ship" }, actor);

export function lemnosStart() {
  let world = bookMove(earlierJourney("aulis", aulisJourney), "greek-harbor");
  world = lemnosChoice(world, "invitation");
  return bookMove(bookBoard(world), "greek-lemnos-landing");
}

export function lemnosReturnedBow(route = "troy") {
  let world = lemnosStart();
  for (const item of ["water", "herb"])
    world = bookPlay(world, "take", { item: `greek-lemnos-${item}` });
  world = bookMove(world, "greek-lemnos");
  world = lemnosChoice(world, "care");
  world = bookTalk(world, "greek-lemnos-philoctetes", "greek-lemnos-loan");
  world = bookPlay(world, "take", { item: "greek-lemnos-bow" });
  world = bookMove(world, "greek-lemnos-landing");
  const deceptive = route === "repair";
  world = lemnosChoice(world, `approach-${deceptive ? "deception" : "truth"}`);
  world = bookTalk(
    world,
    "greek-lemnos-neoptolemus",
    `greek-lemnos-${deceptive ? "confession" : "purpose"}`,
  );
  world = bookMove(world, "greek-lemnos");
  world = bookPlay(world, "give", {
    item: "greek-lemnos-bow",
    target: "greek-lemnos-philoctetes",
  });
  return lemnosChoice(world, "return-bow");
}

export function lemnosReady(route = "troy") {
  let world = bookMove(lemnosReturnedBow(route), "greek-lemnos-landing");
  world = bookTalk(world, "greek-lemnos-neoptolemus", "greek-lemnos-heracles");
  return bookMove(world, "greek-lemnos");
}

export function lemnosAgreed(route = "troy") {
  let world = lemnosChoice(lemnosReady(route), `agree-${route}`);
  return bookPlay(world, "take", { item: "greek-lemnos-water" });
}

export function lemnosArrived(route = "troy") {
  let world = lemnosAgreed(route);
  const path =
    route === "home"
      ? [
          "greek-lemnos-landing",
          "greek-ship",
          "greek-athens-harbor",
          "greek-athens",
          "greek-delphi",
          "greek-trachis",
        ]
      : [
          "greek-lemnos-landing",
          "greek-ship",
          "greek-ajax-landing",
          "greek-greek-camp",
        ];
  for (const destination of path)
    world = bookPlay(world, "accompany", {
      target: "greek-lemnos-philoctetes",
      destination,
    });
  return bookTalk(
    world,
    "greek-lemnos-philoctetes",
    `greek-lemnos-arrival-${route}`,
  );
}

export function lemnosJourney(route = "troy") {
  let world = lemnosArrived(route);
  world =
    route === "home"
      ? bookMove(world, "greek-delphi", "greek-athens", "greek-athens-harbor")
      : bookMove(world, "greek-ajax-landing");
  world = bookMove(bookBoard(world), "greek-harbor");
  world = lemnosChoice(world, "check-manifest");
  world = bookMove(world, "greek-courtyard");
  return lemnosChoice(world, `return-${route}`);
}

export const rhesusChoice = (world, id) =>
  bookPlay(world, "choose", { choiceId: `greek-rhesus-${id}` });

export function rhesusStart() {
  let world = bookMove(earlierJourney("lemnos", lemnosJourney), "greek-harbor");
  world = rhesusChoice(world, "invitation");
  return bookMove(
    bookBoard(world),
    "greek-ajax-landing",
    "greek-greek-camp",
    "greek-troy",
    "greek-trojan-camp",
  );
}

export function rhesusWatch(route = "warning") {
  let world = bookPlay(rhesusStart(), "take", { item: "greek-rhesus-lamp" });
  world = bookMove(world, "greek-rhesus-allies");
  world = rhesusChoice(world, "set-lamp");
  world = bookMove(world, "greek-trojan-camp");
  world = bookTalk(world, "greek-rhesus-hector", "greek-rhesus-word");
  world = bookMove(world, "greek-rhesus-allies");
  world = bookPlay(world, "take", { item: "greek-rhesus-watchword" });
  world = bookMove(world, "greek-trojan-camp");
  world = rhesusChoice(world, "compare-word");
  return rhesusChoice(world, `choose-${route}`);
}

export function rhesusAccount(route = "warning") {
  let world = bookMove(rhesusWatch(route), "greek-rhesus-aid-tent");
  world = bookPlay(world, "take", { item: "greek-rhesus-bandage" });
  if (route === "warning") {
    world = bookMove(world, "greek-trojan-camp", "greek-rhesus-allies");
    world = rhesusChoice(world, "agree-warning");
    for (const destination of ["greek-trojan-camp", "greek-rhesus-aid-tent"])
      world = bookPlay(world, "accompany", {
        target: "greek-rhesus-rhesus",
        destination,
      });
    world = rhesusChoice(world, "complete-warning");
  } else {
    world = rhesusChoice(world, "bind-driver");
    world = bookTalk(world, "greek-rhesus-charioteer", "greek-rhesus-driver");
  }
  world = bookPlay(world, "take", { item: "greek-rhesus-testimony" });
  world = bookMove(world, "greek-trojan-camp");
  world = bookTalk(
    world,
    "greek-rhesus-hector",
    `greek-rhesus-account-${route}`,
  );
  return route === "raid"
    ? bookPlay(world, "take", { item: "greek-rhesus-testimony" })
    : world;
}

export function rhesusJourney(route = "warning") {
  let world = bookMove(
    rhesusAccount(route),
    "greek-troy",
    "greek-greek-camp",
    "greek-ajax-landing",
  );
  world = bookMove(bookBoard(world), "greek-harbor", "greek-courtyard");
  return rhesusChoice(world, `return-${route}`);
}

export const troyChoice = (world, id) =>
  bookPlay(world, "choose", { choiceId: `greek-troy-${id}` });
const troyTent = "greek-troy-womens-tent";
const troyPort = "greek-ajax-landing";
const troyAndromache = "greek-troy-andromache";
const troyHecuba = "greek-troy-hecuba";
const troyToPort = (world) =>
  bookMove(world, "greek-troy", "greek-greek-camp", troyPort);
const troyToTent = (world) =>
  bookMove(world, "greek-greek-camp", "greek-troy", troyTent);

export function troyStart(route = "witness") {
  let world = bookMove(earlierJourney("rhesus", rhesusJourney), "greek-harbor");
  world = troyChoice(world, "invitation");
  if (route !== "witness") {
    world = bookPlay(world, "take", { item: "greek-troy-crew-pledge" });
    world = troyChoice(world, "reserve-refuge");
  }
  world = bookMove(
    bookBoard(world),
    troyPort,
    "greek-greek-camp",
    "greek-troy",
  );
  world = bookTalk(world, "greek-troy-talthybius", "greek-troy-assignments");
  world = bookMove(world, troyTent);
  world = bookPlay(world, "take", { item: "greek-troy-names" });
  world = bookTalk(world, troyHecuba, "greek-troy-names");
  world = troyChoice(world, "write-names");
  world = troyChoice(world, `choose-${route}`);
  world = bookPlay(world, "take", { item: "greek-troy-message-a" });
  world = bookPlay(world, "give", {
    item: "greek-troy-message-a",
    target: troyHecuba,
  });
  return bookPlay(world, "take", { item: "greek-troy-message-b" });
}

export function troyPrepared(route = "witness") {
  let world = troyStart(route);
  if (route === "witness") {
    world = troyToPort(world);
    world = bookPlay(world, "give", {
      item: "greek-troy-message-b",
      target: troyAndromache,
    });
    world = troyChoice(world, "agree-andromache-witness");
    for (
      let turn = 0;
      turn < 24 && world.actors[troyAndromache].place !== "greek-harbor";
      turn++
    )
      world = bookPlay(world, "wait");
    world = bookMove(world, "greek-greek-camp", "greek-troy");
    world = bookTalk(world, "greek-troy-talthybius", "greek-troy-body");
    world = bookMove(world, troyTent);
    world = troyChoice(world, "agree-hecuba-witness");
    world = bookPlay(world, "take", { item: "greek-troy-child-cloth" });
    world = bookMove(world, "greek-troy", "greek-troy-shield-ground");
    world = bookPlay(world, "take", { item: "greek-troy-hector-shield" });
    world = troyChoice(world, "dress-shield");
    world = bookMove(world, "greek-troy", troyTent);
  } else {
    world = bookPlay(world, "take", { item: "greek-troy-child-cloth" });
    world = bookMove(world, "greek-troy");
    world = bookTalk(world, "greek-troy-talthybius", "greek-troy-crew");
    world = bookMove(world, "greek-troy-shield-ground");
    world = bookPlay(world, "take", { item: "greek-troy-hector-shield" });
    world = troyToPort(world);
    world = troyChoice(world, "set-refuge-shield");
    for (const item of ["child-cloth", "message-b"])
      world = bookPlay(world, "give", {
        item: `greek-troy-${item}`,
        target: troyAndromache,
      });
    world = troyChoice(world, "prepare-refuge");
    if (route === "child-refuge")
      world = troyChoice(world, "agree-andromache-child-refuge");
    world = troyToTent(world);
    world = troyChoice(world, `agree-hecuba-${route}`);
    if (route === "family-together")
      world = bookPlay(world, "take", { item: "greek-troy-berth-token" });
  }
  world = bookPlay(world, "take", { item: "greek-troy-names" });
  return troyToPort(world);
}

export const troyFamilyReady = () =>
  bookDocked(troyPrepared("family-together"));

export function troyArrivals(route = "witness") {
  let world =
    route === "family-together" ? troyFamilyReady() : troyPrepared(route);
  if (route === "family-together")
    world = troyChoice(world, "agree-andromache-family-together");
  if (route === "child-refuge") {
    world = bookDocked(world);
    for (const destination of ["greek-ship", "greek-harbor"])
      world = bookPlay(world, "accompany", {
        target: troyAndromache,
        destination,
      });
  } else {
    for (
      let turn = 0;
      turn < 32 &&
      [troyAndromache, troyHecuba].some(
        (id) => world.actors[id].place !== "greek-harbor",
      );
      turn++
    )
      world = bookPlay(world, "wait");
  }
  return world;
}

export function troyJourney(route = "witness") {
  return troyReturn(troyArrivals(route), route);
}

export function troyReturn(world, route = "witness") {
  if (world.actors.vale.place !== "greek-harbor")
    world = bookMove(bookBoard(world), "greek-harbor");
  world = bookTalk(world, "greek-shipmaster", `greek-troy-account-${route}`);
  world = troyChoice(world, "last-song");
  world = bookMove(world, "greek-courtyard");
  return troyChoice(world, `return-${route}`);
}

export function bookTalk(world, speaker, topic, actor = "vale") {
  const action = legalActions(world, actor).find(
    (candidate) => candidate.kind === "talk" && candidate.target === speaker,
  );
  if (!action) throw new Error(`${actor} needs Talk with ${speaker}`);
  const result = play(world, action, world.revision);
  if (!result.ok) throw new Error(result.error);
  const context = narrativeContext(result.state, action);
  const disclosure = context.disclosures?.[0];
  if (disclosure?.factId !== topic)
    throw new Error(`Expected ${topic}, reserved ${disclosure?.factId}`);
  return applyGeneratedText(result.state, context, {
    revision: context.revision,
    model: "fixture",
    entries: context.entities.map(({ id }) => ({
      id,
      text: id === disclosure.speaker ? disclosure.text : "I hear the account.",
    })),
  });
}

let prior;
export function aulisStart() {
  prior ||= ajaxJourney();
  let world = bookMove(structuredClone(prior), "greek-harbor");
  world = aulisChoice(world, "invitation");
  return bookMove(world, "greek-ship", "greek-aulis");
}

export function aulisWitness() {
  let world = bookTalk(
    aulisStart(),
    "greek-aulis-achilles",
    "greek-aulis-recall",
  );
  world = bookPlay(world, "take", { item: "greek-aulis-recall-letter" });
  world = bookMove(world, "greek-aulis-household");
  world = aulisChoice(world, "deliver-recall");
  world = bookTalk(world, "greek-aulis-clytemnestra", "greek-aulis-purpose");
  world = bookPlay(world, "take", { item: "greek-aulis-wedding-veil" });
  world = aulisChoice(world, "tell-daughter");
  world = bookTalk(world, "greek-aulis-iphigenia", "greek-aulis-daughter");
  world = bookMove(world, "greek-aulis");
  return aulisChoice(world, "secure-witness");
}

export function aulisPrepared(route = "rescue") {
  let world = bookMove(aulisWitness(), "greek-aulis-household");
  world = aulisChoice(world, `choose-${route}`);
  world = bookPlay(world, "take", { item: "greek-aulis-offering-cloth" });
  if (route === "escape")
    return bookPlay(world, "accompany", {
      target: "greek-aulis-iphigenia",
      destination: "greek-aulis",
    });
  world = bookMove(world, "greek-aulis", "greek-aulis-altar");
  world = aulisChoice(world, `prepare-${route}`);
  if (route === "rescue") {
    world = bookMove(world, "greek-aulis");
    world = bookTalk(
      world,
      "greek-aulis-achilles",
      "greek-aulis-rescue-report",
    );
    world = bookMove(world, "greek-aulis-altar");
  }
  return world;
}

export function aulisAccount(route = "rescue") {
  let world = aulisChoice(aulisPrepared(route), `complete-${route}`);
  if (route !== "escape") world = bookMove(world, "greek-aulis");
  world = bookMove(world, "greek-aulis-household");
  world = bookPlay(world, "take", { item: "greek-aulis-departure-record" });
  return bookTalk(
    world,
    "greek-aulis-clytemnestra",
    `greek-aulis-account-${route}`,
  );
}

export function aulisJourney(route = "rescue") {
  const world = bookMove(
    aulisAccount(route),
    "greek-aulis",
    "greek-ship",
    "greek-harbor",
    "greek-courtyard",
  );
  return aulisChoice(world, `return-${route}`);
}
