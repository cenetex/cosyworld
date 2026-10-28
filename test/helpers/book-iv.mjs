import { legalActions, play, exits } from "../../v2/card-game/world.mjs";
import {
  narrativeContext,
  applyGeneratedText,
} from "../../v2/card-game/narrative.mjs";
import { packDefinition } from "../../v2/card-game/pack-registry.mjs";
import { openDoorJourney, playOpenDoor } from "./open-door.mjs";
export const ivId = (work, slug) => `greek-book-iv-${work}-${slug}`;
let recording;
function record(world, step) {
  if (!recording) return;
  recording.world ||= structuredClone(world);
  recording.steps.push(step);
}
export function traceIV(journey, route) {
  const trace = { world: null, steps: [] };
  recording = trace;
  try {
    trace.result = journey(route);
    return trace;
  } finally {
    recording = null;
  }
}
export function ivPlay(world, kind, fields = {}, actor = "vale") {
  const action = legalActions(world, actor).find(
    (a) =>
      a.kind === kind && Object.entries(fields).every(([k, v]) => a[k] === v),
  );
  if (!action)
    throw new Error(
      `Missing ${actor} ${kind} ${JSON.stringify(fields)} at ${world.actors[actor].place}`,
    );
  record(world, { kind, ...fields });
  const result = play(world, action, world.revision);
  if (!result.ok) throw new Error(result.error);
  if (
    kind === "accompany" &&
    result.state.actors[fields.target].place !== fields.destination
  )
    throw new Error(`Refused journey: ${JSON.stringify(fields)}`);
  return result.state;
}
export const ivChoose = (world, work, slug) =>
  ivPlay(world, "choose", { choiceId: ivId(work, slug) });
export const ivMove = (world, target) => {
  record(world, { kind: "move", target });
  return playOpenDoor(world, "move", { target });
};
export const ivTake = (world, item) => ivPlay(world, "take", { item });
export function ivTalk(world, speaker, expectedTopic, actor = "vale", words) {
  const action = legalActions(world, actor).find(
    (a) => a.kind === "talk" && a.target === speaker,
  );
  if (!action)
    throw new Error(
      `Missing Talk to ${speaker} at ${world.actors[actor].place}`,
    );
  record(world, { kind: "talk", target: speaker, topic: expectedTopic });
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
export function helenEnding(
  route = "escape",
  { pauseAfterSupplies = false } = {},
) {
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
    world = ivMove(world, id("boat"));
    world = ivChoose(world, "helen", "prepare-voyage");
    if (pauseAfterSupplies) return world;
    world = ivMove(ivMove(world, id("landing")), "greek-egypt-tomb");
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

export function ivWalk(world, target) {
  const paths = [[world.actors.vale.place]],
    seen = new Set(paths[0]);
  while (paths.length) {
    const path = paths.shift(),
      here = path.at(-1);
    if (here === target)
      return path.slice(1).reduce((s, to) => ivMove(s, to), world);
    const nextPlaces =
      here === "greek-ship"
        ? packDefinition("greek-drama").transports["greek-ship"].docks
        : exits(world, here, "vale");
    for (const next of nextPlaces)
      if (!seen.has(next)) {
        seen.add(next);
        paths.push([...path, next]);
      }
  }
  throw new Error(`No road from ${world.actors.vale.place} to ${target}`);
}
export function andromacheEnding(route = "protection") {
  const w = "andromache",
    id = (slug) => ivId(w, slug);
  let world = ivWalk(ivStart(), "greek-thetis");
  for (const item of [id("food"), id("summons")]) world = ivTake(world, item);
  world = ivTalk(world, id("andromache"), id("hear-mother-words"));
  world = ivChoose(world, w, "feed-shrine");
  world = ivMove(world, id("household"));
  world = ivTalk(world, id("peleus"), id("peleus-consent-words"));
  world = ivPlay(world, "accompany", {
    target: id("peleus"),
    destination: "greek-thetis",
  });
  world = ivTalk(world, id("peleus"), id("defender-arrival-words"));
  world = ivTalk(world, id("andromache"), id("mother-consent-words"));
  world = ivMove(world, id("refuge"));
  world = ivTalk(world, id("molossus"), id("child-consent-words"));
  world = ivPlay(world, "accompany", {
    target: id("molossus"),
    destination: "greek-thetis",
  });
  world = ivPlay(world, "accompany", {
    target: id("molossus"),
    destination: id("household"),
  });
  world = ivTalk(world, id("molossus"), id("child-home-words"));
  world = ivMove(world, "greek-thetis");
  world = ivPlay(world, "accompany", {
    target: id("andromache"),
    destination: id("household"),
  });
  world = ivTalk(world, id("andromache"), id("mother-home-words"));
  for (const item of [id("pledge"), id("provisions")])
    world = ivTake(world, item);
  world = ivChoose(world, w, `plan-${route}`);
  // Visit the report via the boundary’s public approach before the household result.
  if (route === "departure") {
    world = ivTalk(world, id("andromache"), id("departure-consent-words"));
    world = ivPlay(world, "accompany", {
      target: id("molossus"),
      destination: id("boundary"),
    });
    world = ivTalk(world, id("molossus"), id("child-boundary-words"));
    world = ivMove(world, id("household"));
    world = ivPlay(world, "accompany", {
      target: id("andromache"),
      destination: id("boundary"),
    });
    world = ivTalk(world, id("andromache"), id("mother-boundary-words"));
  } else world = ivWalk(world, id("boundary"));
  world = ivTake(world, id("account"));
  world = ivTalk(world, id("messenger"), id("delphic-report-words"));
  if (route === "protection") world = ivMove(world, id("household"));
  return ivTalk(world, id("andromache"), id(`finish-${route}-words`));
}
export function andromacheJourney(route = "protection") {
  return ivChoose(
    ivWalk(andromacheEnding(route), "greek-courtyard"),
    "andromache",
    `return-${route}`,
  );
}

export function hippolytusPrepared() {
  const w = "hippolytus",
    id = (slug) => ivId(w, slug);
  let world = ivWalk(ivStart(), "greek-troezen");
  world = ivTake(world, id("water"));
  world = ivMove(world, id("sickroom"));
  world = ivTake(world, id("cloth"));
  world = ivTalk(world, id("phaedra"), id("hear-phaedra-words"));
  world = ivTalk(world, id("nurse"), id("hear-nurse-words"));
  world = ivChoose(world, w, "cool-cloth");
  world = ivTalk(world, id("nurse"), id("phaedra-death-words"));
  world = ivTake(world, id("account"));
  world = ivMove(world, "greek-troezen");
  world = ivTake(world, id("accusation"));
  world = ivTalk(world, id("hippolytus"), id("hear-oath-words"));
  world = ivMove(world, id("sickroom"));
  world = ivTalk(world, id("nurse"), id("nurse-witness-words"));
  world = ivChoose(ivMove(world, "greek-troezen"), w, "set-evidence");
  return world;
}
export function hippolytusEnding(route = "hearing") {
  const w = "hippolytus",
    id = (slug) => ivId(w, slug);
  let world = ivChoose(hippolytusPrepared(), w, `plan-${route}`);
  world = ivTake(world, id("account"));
  if (route === "hearing") {
    world = ivTake(world, id("delay"));
    world = ivMove(world, id("sea-shrine"));
    world = ivChoose(world, w, "deliver-delay");
    world = ivTalk(world, id("messenger"), id("theseus-delay-words"));
  } else {
    world = ivTake(world, id("covering"));
    world = ivMove(world, id("sea-shrine"));
    world = ivTalk(world, id("messenger"), id("curse-report-words"));
    world = ivTalk(world, id("messenger"), id("injury-report-words"));
    world = ivChoose(ivMove(world, "greek-troezen"), w, "cover-son");
    world = ivMove(world, id("sea-shrine"));
    world = ivTalk(world, id("messenger"), id("summon-father-words"));
    world = ivMove(world, "greek-troezen");
    world = ivTalk(world, id("hippolytus"), id("son-forgives-words"));
    world = ivMove(world, id("sea-shrine"));
  }
  return ivTalk(world, id("messenger"), id(`finish-${route}-words`));
}
export function hippolytusJourney(route = "hearing") {
  return ivChoose(
    ivWalk(hippolytusEnding(route), "greek-courtyard"),
    "hippolytus",
    `return-${route}`,
  );
}

export function medeaPrepared() {
  const w = "medea",
    id = (slug) => ivId(w, slug);
  let world = ivWalk(ivStart(), "greek-corinth");
  for (const item of [id("food"), id("account")]) world = ivTake(world, item);
  world = ivTalk(world, id("nurse"), id("hear-nurse-words"));
  world = ivChoose(world, w, "feed-house");
  world = ivMove(world, id("palace"));
  world = ivTake(world, id("shelter"));
  world = ivTalk(world, id("creon"), id("one-day-grant-words"));
  world = ivWalk(world, id("quay"));
  world = ivTake(world, id("oath"));
  world = ivTalk(world, id("aegeus"), id("aegeus-oath-words"));
  world = ivChoose(ivMove(world, "greek-corinth"), w, "carry-oath");
  world = ivTalk(world, id("medea"), id("gift-plan-words"));
  for (const item of [id("robe"), id("crown")]) world = ivTake(world, item);
  return ivChoose(world, w, "examine-gifts");
}
export function medeaEnding(route = "departure") {
  const w = "medea",
    id = (slug) => ivId(w, slug);
  let world = ivChoose(medeaPrepared(), w, `plan-${route}`);
  if (route === "departure") {
    for (const item of [id("robe"), id("crown")])
      world = ivPlay(world, "drop", { item });
    world = ivTake(world, id("provisions"));
    world = ivTalk(world, id("medea"), id("medea-consent-words"));
    world = ivTalk(world, id("nurse"), id("nurse-consent-words"));
    for (const who of ["medea", "nurse"]) {
      if (world.actors.vale.place !== "greek-corinth")
        world = ivMove(world, "greek-corinth");
      world = ivPlay(world, "accompany", {
        target: id(who),
        destination: id("quay"),
      });
      world = ivTalk(world, id(who), id(`${who}-arrival-words`));
    }
    world = ivChoose(world, w, "supply-quay");
    world = ivTalk(world, id("attendant"), id("living-sons-words"));
    return ivTalk(world, id("nurse"), id("finish-departure-words"));
  }
  world = ivChoose(ivMove(world, id("palace")), w, `deliver-${route}`);
  if (route === "source") {
    world = ivTalk(world, id("jason"), id("royal-deaths-words"));
    world = ivMove(world, "greek-corinth");
    world = ivTalk(world, id("nurse"), id("children-deaths-words"));
    world = ivChoose(world, w, "mourn-sons");
    return ivTalk(world, id("nurse"), id("finish-source-words"));
  }
  world = ivWalk(world, id("quay"));
  world = ivTalk(world, id("attendant"), id("guarded-shelter-words"));
  world = ivWalk(world, id("palace"));
  return ivTalk(world, id("creon"), id("finish-reckoning-words"));
}
export function medeaJourney(route = "departure") {
  return ivChoose(
    ivWalk(medeaEnding(route), "greek-courtyard"),
    "medea",
    `return-${route}`,
  );
}
export function ionRecognitionReady() {
  const w = "ion",
    id = (slug) => ivId(w, slug);
  let world = ivWalk(ivStart(), "greek-delphi");
  world = ivTake(world, id("broom"));
  world = ivMove(world, id("guesthouse"));
  for (const item of [id("water"), id("account")]) world = ivTake(world, item);
  world = ivMove(world, "greek-delphi");
  world = ivTalk(world, id("ion"), id("hear-worker-words"));
  world = ivTalk(world, id("priestess"), id("hear-carer-words"));
  world = ivChoose(world, w, "sweep-temple");
  world = ivTalk(world, id("ion"), id("poison-report-words"));
  world = ivMove(world, id("feast-court"));
  world = ivTake(world, id("cup"));
  world = ivChoose(world, w, "secure-cup");
  world = ivWalk(world, id("guesthouse"));
  world = ivTalk(world, id("creusa"), id("hear-creusa-words"));
  world = ivTalk(world, id("creusa"), id("name-signs-words"));
  world = ivMove(world, "greek-delphi");
  world = ivTalk(world, id("priestess"), id("entrust-basket-words"));
  for (const pair of [
    ["basket", "cloth"],
    ["snakes", "wreath"],
  ]) {
    world = ivMove(world, id("feast-court"));
    for (const item of pair) world = ivTake(world, id(item));
    world = ivMove(world, "greek-delphi");
    world = ivChoose(
      world,
      w,
      pair[0] === "basket" ? "lay-basket" : "lay-tokens",
    );
  }
  world = ivMove(world, id("guesthouse"));
  world = ivTalk(world, id("creusa"), id("creusa-consent-words"));
  world = ivPlay(world, "accompany", {
    target: id("creusa"),
    destination: "greek-delphi",
  });
  return world;
}
export function ionPrepared() {
  const w = "ion",
    id = (slug) => ivId(w, slug);
  let world = ivTalk(
    ionRecognitionReady(),
    id("creusa"),
    id("recognition-words"),
  );
  return ivChoose(world, w, "private-instruction");
}
export function ionEnding(route = "private") {
  const w = "ion",
    id = (slug) => ivId(w, slug);
  let world = ivChoose(ionPrepared(), w, `plan-${route}`);
  world = ivTalk(
    world,
    id(route === "temple" ? "ion" : "creusa"),
    id(`${route}-consent-words`),
  );
  return ivTalk(
    world,
    id(route === "public" ? "creusa" : "ion"),
    id(`finish-${route}-words`),
  );
}
export function ionJourney(route = "private") {
  return ivChoose(
    ivWalk(ionEnding(route), "greek-courtyard"),
    "ion",
    `return-${route}`,
  );
}
