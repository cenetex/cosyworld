import { expressionOf } from "../expression.mjs";
import { controlledByHuman } from "../human-cast.mjs";
import {
  commitDisclosure,
  reserveKnowledge,
  reserveLaneKnowledge,
} from "../knowledge.mjs";
import {
  applyPackChoice,
  conditionsMet,
  packDefinitions,
  packTalkChoice,
} from "../pack-registry.mjs";
import { learnLane } from "../pack-transport.mjs";
import { people } from "./catalog.mjs";
import { atPort, laneToTell } from "./lanes.mjs";

export const authoredKnowledgeTopics = () =>
  packDefinitions.flatMap((pack) =>
    (pack.topics || []).map((topic) => ({ ...topic, packId: pack.id })),
  );

export function talkKnowledge(world, action, event, choice) {
  const pairs = [
    [action.actor, action.target],
    [action.target, action.actor],
  ];
  if (controlledByHuman(world, action.actor)) pairs.reverse();
  for (const [speaker, listener] of pairs) {
    if (expressionOf(people[speaker]) !== "speech") continue;
    const topics = authoredKnowledgeTopics().flatMap((topic) => {
      const selected =
        topic.id === choice?.topicId &&
        speaker === action.target &&
        listener === action.actor;
      if (selected) return [{ ...topic, said: true, commitChoice: true }];
      return conditionsMet(world, topic.packId, topic.requires, listener)
        ? [topic]
        : [];
    });
    const lane = laneToTell(world, speaker, listener);
    const port = lane && atPort(world, speaker) && !topics.some((t) => t.said);
    if (port && reserveLaneKnowledge(world, speaker, listener, event, lane))
      break;
    if (reserveKnowledge(world, speaker, listener, event, topics)) break;
    if (
      lane &&
      !port &&
      reserveLaneKnowledge(world, speaker, listener, event, lane)
    )
      break;
  }
}

export function applyTalkDisclosure(world, marker, line) {
  const { actorId: speaker, locationId: location } = line;
  const heard = commitDisclosure(world, marker, speaker, location);
  if (!heard) return null;
  const { factId, listener, turn } = heard;
  line.disclosedFactId = factId;
  const { kind, topic } = world.knowledge.facts[factId].source;
  if (kind === "lane")
    learnLane(world, listener, ...factId.slice(5).split(">"));
  if (kind === "topic" && heard.commitChoice) {
    // Recheck the reserved choice against the clock of the original play.
    const playedAt = turn - 1;
    const choice = packTalkChoice(
      world,
      { actor: listener, target: speaker },
      { turn: playedAt, topicId: factId },
    );
    if (
      choice?.topicId === topic.id &&
      choice.packId === topic.packId &&
      choice.choiceId === topic.choiceId
    )
      applyPackChoice(world, choice, { mode: "talk", turn: playedAt });
  }
  return heard;
}
