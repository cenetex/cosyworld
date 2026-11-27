import { legalActions, play } from "../../v2/card-game/world.mjs";
import {
  narrativeContext,
  applyGeneratedText,
} from "../../v2/card-game/narrative.mjs";
import { greekStart, playGreek as playOpenDoor } from "./open-door.mjs";
import { greekTravelTargets } from "./greek-travel.mjs";
import { packDefinition } from "../../v2/card-game/pack-registry.mjs";
import { openGreekGate } from "./greek-gate.mjs";

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

let start;
export function ajaxStart() {
  // The Ajax journey starts with the Theban gate errands already settled.
  start ||= openGreekGate(greekStart({ full: true }));
  return structuredClone(start);
}

export function ajaxTalk(
  world,
  topicId,
  { actor = "vale", target = "greek-ajax-teucer" } = {},
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
  const { factId, speaker, listener, eventSeq } = disclosure;
  return applyGeneratedText(result.state, context, {
    revision: context.revision,
    model: "fixture",
    entries: context.entities.map(({ id }) => ({
      id,
      text: id === speaker ? disclosure.text : "I have heard the account.",
      ...(id === speaker && {
        disclosed: { factId, speaker, listener, eventSeq },
      }),
    })),
  });
}

function reachCamp() {
  let world = ajaxMove(ajaxStart(), "greek-harbor");
  world = ajaxChoice(world, "invitation");
  world = ajaxMove(world, "greek-pagasae");
  world = ajaxTalk(world, "lane:greek-pagasae>greek-lemnos", {
    target: "greek-pagasae-pilot",
  });
  return ajaxMove(world, "greek-scylla", "greek-ajax-landing", "greek-greek-camp");
}

let camp;
export function ajaxCamp() {
  // Dialogue and burial tests need independent camp states, not a repeated
  // walk across the mainland for every assertion.
  camp ||= reachCamp();
  return structuredClone(camp);
}

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
    "greek-scylla",
    "greek-pagasae",
    "greek-courtyard",
  );
  return ajaxChoice(world, `return-${route}`);
}
