// Voice-context eval scenes (#1537): every narrative-contract case, plus a
// scripted conversation that builds real table history through the rules,
// the save's memories and the browser request builder. Rust's voice eval
// reads these to measure prompt sections; no model is called.
import { createWorld, legalActions, play } from "../../v2/card-game/world.mjs";
import { enableMotives } from "../../v2/card-game/motives.mjs";
import {
  narrativeContext,
  applyGeneratedText,
  voicesNobody,
} from "../../v2/card-game/narrative.mjs";
import {
  narrativeContractCases,
  playCard,
} from "./card-narrative-contexts.mjs";
import { atticOpening } from "./card-attic-opening.mjs";
import { sailTo } from "../helpers/voyage.mjs";

// Recorded lines, one per speaker and turn, standing in for model replies.
const recorded = {
  vale: [
    "Pip, what are you hoping to find out here?",
    "I could carry the lamp for you a while.",
    "The keeper looks tired tonight.",
    "Tell me again what the pond wants.",
    "I'll stay close until the light returns.",
    "Do you still want the lamp?",
  ],
  moth: [
    "I only want to see the far shore by lamplight.",
    "The lamp would help, if you trust me with it.",
    "He always looks tired. It's the oil.",
    "It wants quiet. Mostly it wants quiet.",
    "Then stay. I like company in the dark.",
    "More than anything, yes.",
  ],
  keeper: [
    "Mind the oil, both of you.",
    "I've kept this station longer than the lamp has burned.",
    "Tired is a kind word for it.",
    "The pond keeps its own counsel.",
    "Light returns when it returns.",
    "Ask her yourself, traveller.",
  ],
};

function step(world, kind, target, turnIndex) {
  const action = legalActions(world).find(
    (candidate) =>
      candidate.kind === kind && (!target || candidate.target === target),
  );
  if (!action) throw new Error(`Missing eval action: ${kind} ${target}`);
  const result = play(world, action);
  if (!result.ok) throw new Error(`Rejected eval action: ${kind}`);
  const context = narrativeContext(result.state);
  const entries = context.entities.map(({ id }) => ({
    id,
    text: recorded[id]?.[turnIndex % recorded[id].length] ?? "Quiet.",
  }));
  return {
    context,
    // This turn's recorded lines: a Talk's target answers the actor's line.
    lines: Object.fromEntries(entries.map(({ id, text }) => [id, text])),
    world: applyGeneratedText(result.state, context, {
      revision: context.revision,
      model: "voice-eval-fixture",
      entries,
    }),
  };
}

/** A station conversation: Vale talks with Pip turn after turn. */
export function stationConversation(turns = 6) {
  let world = enableMotives(createWorld());
  world.actors.moth.place = "station";
  world.actors.keeper.place = "station";
  world.items.lamp.holder = "vale";
  world.items.oil.holder = "keeper";
  const cases = [];
  for (let i = 0; i < turns; i++) {
    const kind = i % 3 === 2 ? "wait" : "talk";
    const next = step(world, kind, kind === "talk" ? "moth" : null, i);
    cases.push({
      name: `station talk ${i + 1}`,
      context: next.context,
      lines: next.lines,
    });
    world = next.world;
  }
  return cases;
}

/** A return visit (#2078): Vale talks with Pip, threatens Pip over the
 * Black cloth, and after the fight and a quiet spell talks with Pip again. */
export function returnVisit() {
  const { before, world } = beforeReturn();
  const after = step(world, "talk", "moth", 3);
  return [
    {
      name: "return visit before",
      context: before.context,
      lines: before.lines,
    },
    { name: "return visit after", context: after.context, lines: after.lines },
    ...pondVisit(world),
  ];
}

// The same pair talking again at the pond, where "Recent talk here" is
// empty, so the last words between them show under "Between us".
function pondVisit(world) {
  world = step(world, "accompany", "moth", 4).world;
  if (world.actors.moth.place !== world.actors.vale.place)
    throw new Error("Pip did not come along");
  world = step(world, "move", "pond", 4).world;
  if (world.actors.moth.place !== "pond")
    throw new Error("Pip is not at the pond");
  const talk = step(world, "talk", "moth", 5);
  return [
    { name: "return visit pond", context: talk.context, lines: talk.lines },
  ];
}

// The world just after the return Talk is played.
export function returnVisitWorld() {
  const { world } = beforeReturn();
  const action = legalActions(world).find(
    (a) => a.kind === "talk" && a.target === "moth",
  );
  return play(world, action).state;
}

function beforeReturn() {
  let world = enableMotives(createWorld());
  world.actors.moth.place = "station";
  world.actors.keeper.place = "station";
  world.items.lamp.holder = "vale";
  world.items.oil.holder = "keeper";
  const before = step(world, "talk", "moth", 0);
  world = step(before.world, "threaten", "moth", 1).world;
  const talks = (w) =>
    legalActions(w).some((a) => a.kind === "talk" && a.target === "moth");
  for (let i = 0; i < 10 && !talks(world); i++)
    world = step(world, "wait", null, 2).world;
  for (let i = 0; i < 8; i++) world = step(world, "wait", null, 2).world;
  return { before, world };
}

// Two scenes from .dev where a character answered its own context back as
// "you" (2026-11-03): Myrto at the harbor beside Vale (who holds the black
// cloth and the uncovered, burning Lamp) and Pip, and Dione, who wants the
// Funeral Oil that Vale carries.
export function assistantRoleScenes() {
  let world = playCard(enableMotives(atticOpening()), "snuff", "lamp");
  world = playCard(playCard(world, "move", null, "pond"), "light", "lamp");
  world.items.cloth.holder = "vale";
  world.items.lamp.fuel = 12;
  world = playCard(playCard(world, "cover", "cloth", "lamp"), "take", "cloth");
  world = sailTo(playCard(world, "move", null, "greek-ship"), "greek-harbor");
  world.actors.moth.place = "greek-harbor";
  const harbor = (kind, target, i) => step(world, kind, target, i).context;
  const road = playCard(world, "move", null, "greek-road-thebes");
  const bakery = playCard(road, "move", null, "greek-courtyard");
  bakery.items["greek-oil-flask"].holder = "vale";
  bakery.actors["greek-baker"].want = {
    kind: "item",
    target: "greek-oil-flask",
    since: bakery.turn,
    refusals: 0,
  };
  const dione = step(bakery, "talk", "greek-baker", 0);
  // Antigone at the city gate, who read back "Vale and Antigone are both at
  // Theban City Gate".
  const gate = playCard(road, "move", null, "greek-courtyard");
  const antigone = playCard(gate, "move", null, "greek-gate");
  // The reflected shore: Vale at Black pond with Pip, holding the unlit Lamp.
  const shore = enableMotives(createWorld());
  shore.items.cloth.holder = "vale";
  shore.items.lamp.holder = "vale";
  shore.items.lamp.lit = false;
  const pond = step(shore, "move", "pond", 0).world;
  return [
    { name: "Black pond wait", context: step(pond, "wait", null, 0).context },
    {
      name: "Black pond talk",
      context: step(pond, "talk", "moth", 0).context,
      lines: { vale: "The pond is very still tonight, Pip." },
    },
    { name: "harbor wait with Myrto", context: harbor("wait", null, 0) },
    {
      name: "harbor talk with Myrto",
      context: harbor("talk", "greek-shipmaster", 1),
      lines: { vale: "Are you sailing tonight?" },
    },
    {
      name: "Dione wants the Funeral Oil",
      context: dione.context,
      lines: { vale: "Good evening, Dione. What are you baking?" },
    },
    {
      name: "Antigone at the gate",
      context: step(antigone, "talk", "greek-antigone", 0).context,
      lines: { vale: "Antigone? What are you doing out here?" },
    },
    {
      name: "Dione waits for the Funeral Oil",
      context: step(dione.world, "wait", null, 2).context,
    },
  ].map(({ name, context, lines = {} }) => ({ name, context, lines }));
}

// A silent play (Light, Put down, Take, ...) sends no voice request, so only
// scenes that voice someone are measured.
export function voiceEvalCases() {
  return [
    ...narrativeContractCases().map(({ name, context }) => ({
      name,
      context,
      lines: {},
    })),
    ...stationConversation(),
    ...returnVisit(),
    ...assistantRoleScenes(),
  ].filter(({ context }) => !voicesNobody(context));
}
