import { legalActions, play } from "../../v2/card-game/world.mjs";
import {
  narrativeContext,
  applyGeneratedText,
} from "../../v2/card-game/narrative.mjs";
import { greekStart, playGreek as playOpenDoor } from "./open-door.mjs";
import { greekTravelTargets } from "./greek-travel.mjs";
import { packDefinition } from "../../v2/card-game/pack-registry.mjs";

export const ajaxState = (world) => world.packs["greek-drama"];
export function ajaxChoice(world, id) {
  const choiceId = `greek-ajax-${id}`;
  const {
    on,
    subject: target,
    requires,
  } = packDefinition("greek-drama").choices.find((c) => c.id === choiceId);
  const item =
    on === "give" ? requires.find((c) => c.kind === "holding").item : null;
  const fields =
    on === "give" ? { item, target } : on === "talk" ? { target } : {};
  const next = playOpenDoor(world, on, fields);
  if (ajaxState(next).receipts[choiceId] !== next.turn)
    throw new Error(`Missing Ajax receipt for ${choiceId}`);
  return next;
}
export const ajaxMove = (world, ...places) =>
  places.reduce(
    (state, place) =>
      greekTravelTargets(state.actors.vale.place, place).reduce(
        (next, target) => playOpenDoor(next, "move", { target }),
        state,
      ),
    world,
  );

// Troy is a rumour in new worlds (rules 94); old full-scope worlds keep it,
// and there Myrto's invitation waits on nothing else.
let start;
export function ajaxStart() {
  start ||= greekStart({ full: true });
  return structuredClone(start);
}

// Publish the reserved source words through the same path as recorded Talk.
export function ajaxTalk(
  world,
  topicId,
  actor = "vale",
  words,
  target = "greek-ajax-teucer",
) {
  const action = legalActions(world, actor).find(
    (a) => a.kind === "talk" && a.target === target,
  );
  if (!action) throw new Error(`Missing ${target} Talk for ${actor}`);
  const result = play(world, action, world.revision);
  if (!result.ok) throw new Error(result.error);
  const context = narrativeContext(result.state, action);
  const disclosure = context.disclosures?.[0];
  if (disclosure?.factId !== topicId)
    throw new Error(`Expected ${topicId}, reserved ${disclosure?.factId}`);
  return applyGeneratedText(result.state, context, {
    revision: context.revision,
    model: "fixture",
    entries: context.entities.map(({ id }) => ({
      id,
      text:
        id === disclosure.speaker
          ? (words ?? disclosure.text)
          : "I have heard the account.",
    })),
  });
}

export function ajaxCamp() {
  let world = ajaxMove(ajaxStart(), "greek-harbor");
  world = ajaxChoice(world, "invitation");
  // The Northern Road walks from the harbor to the Trojan landing: the
  // Charybdis never sails to Troy (rules 94).
  return ajaxMove(world, "greek-ajax-landing", "greek-greek-camp");
}

// Any of Teucer, Odysseus or Tecmessa can say where the shield belongs.
export function ajaxShieldKeeper(world) {
  return ajaxTalk(world, "greek-ajax-shield-teucer");
}

export function ajaxPlea(route = "public") {
  let world = ajaxShieldKeeper(ajaxCamp());
  world = playOpenDoor(world, "take", { item: "greek-ajax-shield" });
  world = ajaxMove(world, "greek-ajax-household");
  world = ajaxChoice(world, "deliver-shield");
  world = ajaxMove(world, "greek-greek-camp");
  world = ajaxTalk(world, "greek-ajax-plea");
  world = playOpenDoor(world, "take", { item: "greek-ajax-plea" });
  world = ajaxChoice(world, "deliver-plea");
  if (route === "household") world = ajaxMove(world, "greek-ajax-household");
  world = ajaxChoice(world, `choose-${route}`);
  if (route !== "household") return world;
  world = playOpenDoor(world, "take", { item: "greek-ajax-plea" });
  return ajaxMove(world, "greek-greek-camp");
}

export function ajaxGrave(route = "public", witness = true) {
  let world = ajaxPlea(route);
  if (route === "appeal" && witness)
    world = ajaxChoice(world, "witness-appeal");
  for (const item of ["greek-ajax-tools", "greek-ajax-cloth"])
    world = playOpenDoor(world, "take", { item });
  world = ajaxMove(world, "greek-ajax-grave");
  for (const item of ["greek-ajax-tools", "greek-ajax-cloth"])
    world = playOpenDoor(world, "drop", { item, target: "greek-ajax-grave" });
  world = ajaxChoice(world, "prepare-grave");
  return ajaxChoice(world, "lay-cloth");
}

export function ajaxBuried(route = "public") {
  return ajaxChoice(ajaxGrave(route), `bury-${route}`);
}

export function ajaxAccount(route = "public") {
  let world = ajaxMove(ajaxBuried(route), "greek-greek-camp");
  if (world.items["greek-ajax-plea"].holder !== "vale")
    world = playOpenDoor(world, "take", { item: "greek-ajax-plea" });
  return ajaxTalk(world, `greek-ajax-account-${route}`);
}

export function ajaxJourney(route = "public") {
  let world = ajaxMove(
    ajaxAccount(route),
    "greek-ajax-landing",
    "greek-harbor",
    "greek-courtyard",
  );
  return ajaxChoice(world, `return-${route}`);
}
