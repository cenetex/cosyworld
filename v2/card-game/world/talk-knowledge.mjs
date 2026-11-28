import { expressionOf } from "../expression.mjs";
import { controlledByHuman } from "../human-cast.mjs";
import {
  commitDisclosure,
  knowsFact,
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
import { atPort, laneToTell, scyllaDirections, scyllaPilot } from "./lanes.mjs";

export const authoredKnowledgeTopics = () =>
  packDefinitions.flatMap((pack) =>
    (pack.topics || []).map((topic) => ({ ...topic, packId: pack.id })),
  );

const ajaxEvidence = (topic) =>
  topic.packId === "greek-drama" && topic.choiceId?.startsWith("greek-ajax-");

function tellAuthored(world, event, marker, addLog) {
  if (!marker) return false;
  const { speaker, listener, locationId } = marker;
  const witnesses = [speaker, listener];
  const line = {
    kind: "dialogue",
    actorId: speaker,
    targetId: listener,
    locationId,
    cast: witnesses,
    witnesses,
    sourceSeq: event.seq,
  };
  if (!applyTalkDisclosure(world, marker, line)) return false;
  addLog(world, people[speaker].name, world.knowledge.facts[marker.factId].text, line);
  return true;
}

export function talkKnowledge(world, action, event, choice, addLog) {
  const pairs = [
    [action.actor, action.target],
    [action.target, action.actor],
  ];
  const traveler = controlledByHuman(world, action.actor);
  if (traveler) pairs.reverse();
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
    if (traveler && speaker === action.target) {
      const offered = topics.filter((t) => ajaxEvidence(t) && t.speaker === speaker);
      const topic = offered.find((t) => t.commitChoice) ?? offered.find((t) =>
        Object.hasOwn(world.packs[t.packId].receipts, t.choiceId) &&
        !knowsFact(world, listener, t.id),
      );
      const marker = topic
        ? reserveKnowledge(world, speaker, listener, event, [{ ...topic, said: true }])
        : scyllaPilot(speaker)
          ? reserveLaneKnowledge(world, speaker, listener, event, scyllaDirections(world, speaker, listener))
          : null;
      if (tellAuthored(world, event, marker, addLog)) break;
    }
    const lane = scyllaPilot(speaker) ? null : laneToTell(world, speaker, listener);
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
