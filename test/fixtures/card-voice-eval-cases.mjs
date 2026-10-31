// Voice-context eval scenes (#1537): every narrative-contract case, plus a
// scripted conversation that builds real table history through the rules,
// the save's memories and the browser request builder. Rust's voice eval
// reads these to measure prompt sections; no model is called.
import { createWorld, legalActions, play } from "../../v2/card-game/world.mjs";
import { enableMotives } from "../../v2/card-game/motives.mjs";
import {
  narrativeContext,
  applyGeneratedText,
} from "../../v2/card-game/narrative.mjs";
import { narrativeContractCases } from "./card-narrative-contexts.mjs";

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
    cases.push({ name: `station talk ${i + 1}`, context: next.context });
    world = next.world;
  }
  return cases;
}

export function voiceEvalCases() {
  return [
    ...narrativeContractCases().map(({ name, context }) => ({ name, context })),
    ...stationConversation(),
  ];
}
