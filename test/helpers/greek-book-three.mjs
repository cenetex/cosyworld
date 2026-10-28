import { legalActions, play } from "../../v2/card-game/world.mjs";
import {
  narrativeContext,
  applyGeneratedText,
} from "../../v2/card-game/narrative.mjs";
import { ajaxJourney } from "./greek-ajax.mjs";

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

export const bookMove = (world, ...places) =>
  places.reduce((state, target) => bookPlay(state, "move", { target }), world);
export const aulisChoice = (world, id) =>
  bookPlay(world, "choose", { choiceId: `greek-aulis-${id}` });
export const aulisState = (world) => world.packs["greek-drama"];

export const lemnosChoice = (world, id) =>
  bookPlay(world, "choose", { choiceId: `greek-lemnos-${id}` });

export function bookBoard(world, actor = "vale") {
  for (let turn = 0; turn < 16; turn++) {
    if (
      legalActions(world, actor).some(
        (a) => a.kind === "move" && a.target === "greek-ship",
      )
    )
      return bookPlay(world, "move", { target: "greek-ship" }, actor);
    world = bookPlay(world, "wait", {}, actor);
  }
  throw new Error("The shared ship still has passengers on another voyage.");
}

export function lemnosStart() {
  let world = bookMove(aulisJourney(), "greek-harbor");
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
  let world = bookMove(lemnosJourney(), "greek-harbor");
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
