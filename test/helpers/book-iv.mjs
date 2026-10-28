import { legalActions, play, exits } from "../../v2/card-game/world.mjs";
import {
  narrativeContext,
  applyGeneratedText,
} from "../../v2/card-game/narrative.mjs";
import { openDoorJourney, playOpenDoor } from "./open-door.mjs";
export const ivId = (work, slug) => `greek-book-iv-${work}-${slug}`;
export function ivPlay(world, kind, fields = {}, actor = "vale") {
  const action = legalActions(world, actor).find(
    (a) =>
      a.kind === kind && Object.entries(fields).every(([k, v]) => a[k] === v),
  );
  if (!action)
    throw new Error(
      `Missing ${actor} ${kind} ${JSON.stringify(fields)} at ${world.actors[actor].place}`,
    );
  const result = play(world, action, world.revision);
  if (!result.ok) throw new Error(result.error);
  return result.state;
}
export const ivChoose = (world, work, slug) =>
  ivPlay(world, "choose", { choiceId: ivId(work, slug) });
export const ivMove = (world, target) =>
  playOpenDoor(world, "move", { target });
export const ivTake = (world, item) => ivPlay(world, "take", { item });
export function ivTalk(world, speaker, expectedTopic, actor = "vale", words) {
  const action = legalActions(world, actor).find(
    (a) => a.kind === "talk" && a.target === speaker,
  );
  if (!action)
    throw new Error(
      `Missing Talk to ${speaker} at ${world.actors[actor].place}`,
    );
  const result = play(world, action, world.revision);
  if (!result.ok) throw new Error(result.error);
  const context = narrativeContext(result.state, action);
  const disclosure = context.disclosures?.find((d) => d.speaker === speaker);
  if (disclosure?.factId !== expectedTopic)
    throw new Error(`Expected ${expectedTopic}, got ${disclosure?.factId}`);
  return applyGeneratedText(result.state, context, {
    revision: context.revision,
    model: "fixture",
    entries: context.entities.map(({ id }) => ({
      id,
      text: id === speaker ? (words ?? disclosure.text) : "I am listening.",
    })),
  });
}
let start;
export function ivStart(account = "egypt") {
  start ||= openDoorJourney().world;
  let world = ivMove(structuredClone(start), "greek-harbor");
  world = ivChoose(world, "invitation", "accept");
  if (!world.packs["greek-drama"].choices["greek-helen-account"])
    world = ivPlay(world, "choose", { choiceId: `greek-helen-${account}` });
  return world;
}
export function helenPrepared(route = "escape") {
  const id = (slug) => ivId("helen", slug);
  let world = ivMove(ivMove(ivStart(), "greek-ship"), id("landing"));
  world = ivMove(world, "greek-egypt-tomb");
  for (const item of ["greek-egypt-testimony", id("appeal"), id("account")])
    world = ivTake(world, item);
  world = ivTalk(world, "greek-helen-egypt", id("hear-helen-words"));
  world = ivMove(world, id("landing"));
  world = ivTalk(world, id("messenger"), id("hear-messenger-words"));
  world = ivChoose(
    ivMove(world, "greek-egypt-tomb"),
    "helen",
    "confirm-witness",
  );
  world = ivMove(world, id("court"));
  world = ivTalk(world, id("theonoe"), id("hear-theonoe-words"));
  world = ivChoose(ivMove(world, "greek-egypt-tomb"), "helen", `plan-${route}`);
  return world;
}
export function helenEnding(route = "escape") {
  const id = (slug) => ivId("helen", slug);
  let world = helenPrepared(route);
  if (route === "escape") {
    world = ivTalk(world, "greek-helen-egypt", id("helen-consent-words"));
    world = ivTalk(world, "greek-menelaus-egypt", id("menelaus-consent-words"));
    world = ivPlay(world, "give", {
      item: "greek-egypt-testimony",
      target: "greek-helen-egypt",
    });
    world = ivMove(world, id("landing"));
    for (const item of [id("cloth"), id("provisions")])
      world = ivTake(world, item);
    world = ivChoose(world, "helen", "prepare-voyage");
    world = ivMove(world, "greek-egypt-tomb");
    for (const person of ["greek-helen-egypt", "greek-menelaus-egypt"]) {
      if (world.actors.vale.place !== "greek-egypt-tomb")
        world = ivMove(ivMove(world, id("landing")), "greek-egypt-tomb");
      for (const destination of [id("landing"), id("boat")])
        world = ivPlay(world, "accompany", { target: person, destination });
    }
    return ivTalk(world, "greek-menelaus-egypt", id("finish-escape-words"));
  }
  if (route === "hearing") {
    world = ivTalk(world, "greek-helen-egypt", id("public-consent-words"));
    world = ivChoose(ivMove(world, id("court")), "helen", "place-hearing");
    return ivTalk(world, id("theoclymenus"), id("finish-hearing-words"));
  }
  world = ivMove(world, id("landing"));
  world = ivTake(world, id("provisions"));
  world = ivChoose(
    ivMove(world, "greek-egypt-tomb"),
    "helen",
    "supply-sanctuary",
  );
  return ivTalk(world, "greek-helen-egypt", id("finish-sanctuary-words"));
}
export function helenJourney(route = "escape") {
  let world = helenEnding(route);
  if (world.actors.vale.place === ivId("helen", "boat"))
    world = ivMove(world, ivId("helen", "landing"));
  if (world.actors.vale.place === ivId("helen", "court"))
    world = ivMove(world, "greek-egypt-tomb");
  if (world.actors.vale.place === "greek-egypt-tomb")
    world = ivMove(world, ivId("helen", "landing"));
  world = ivMove(
    ivMove(ivMove(world, "greek-ship"), "greek-harbor"),
    "greek-courtyard",
  );
  return ivChoose(world, "helen", `return-${route}`);
}
