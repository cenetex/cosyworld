import forest from "./forest.json" with { type: "json" };
import { humanAvatar } from "./human-cast.mjs";

const object = (value) => value && typeof value === "object" && !Array.isArray(value);
const members = (...actors) => [...new Set(actors.filter(Boolean))].sort();
const nameOf = (packs, id) => {
  for (const pack of packs)
    for (const field of ["avatars", "places", "items"])
      if (pack[field]?.[id]?.name) return pack[field][id].name;
  return humanAvatar(id)?.name || forest.places[id]?.name || id;
};

export const authoredPlayerStoryIds = (packs) => [
  ...new Set(packs.flatMap((pack) => (pack.personalQuests || []).map((quest) => quest.id))),
];

// Each player's helper record owns one stable card. Current custody changes
// the visible instruction while its saved program keeps the same identity.
export function authoredPlayerStoryDefinitions(world, packs) {
  return packs.flatMap((pack) => (pack.personalQuests || []).flatMap((quest) => {
    const state = world.packs?.[pack.id]?.personalQuests?.[quest.id];
    if (state?.version !== 1 || !object(state.records)) return [];
    return quest.playerItems.flatMap((row) => {
      const record = state.records[row.player];
      if (!object(record) || !object(record.meeting) || !object(record.button) ||
        !object(record.reward) || !world.actors?.[row.player] ||
        record.button.id !== row.button || record.reward.id !== row.reward ||
        !Number.isSafeInteger(record.meeting.turn) || record.meeting.turn < 0 ||
        record.meeting.turn > world.turn ||
        record.meeting.place !== quest.at ||
        record.button.consumedTurn !== record.reward.awardedTurn)
        return [];
      const completedTurn = record.reward.awardedTurn;
      if (completedTurn !== null && (!Number.isSafeInteger(completedTurn) ||
        completedTurn < record.meeting.turn || completedTurn > world.turn)) return [];
      const button = nameOf(packs, row.button),
        reward = nameOf(packs, row.reward),
        host = nameOf(packs, quest.host),
        holder = world.items?.[row.button]?.holder,
        resolved = completedTurn !== null,
        delivery = record.button.delivery,
        participants = members(row.player, delivery?.giver);
      let stage = "find", instruction;
      if (resolved) {
        stage = "completed";
        instruction = `${host} sewed ${reward}. Its button is attached.`;
      } else if (holder === quest.host && delivery) {
        stage = "delivered";
        instruction = `${host} has ${button}. Return beside ${host} to finish ${reward}.`;
      } else if (holder === row.player) {
        stage = "return";
        instruction = `Bring ${button} back to ${host}.`;
      } else if (world.actors?.[holder]) {
        stage = "held";
        instruction = `${nameOf(packs, holder)} carries ${button}. Arrange its delivery to ${host}.`;
      } else {
        instruction = `Find ${button} at ${nameOf(packs, holder || record.button.placedAt)}.`;
      }
      const key = `${pack.id}:${quest.id}:${row.player}`;
      const event = resolved && (world.log || []).find((entry) =>
        entry.verb === "personal-quest-complete" && entry.questKey === key &&
        entry.actorId === row.player && entry.targetId === quest.host &&
        entry.itemId === row.reward && entry.locationId === quest.at &&
        entry.turn === completedTurn);
      return [{
        packId: pack.id,
        id: quest.id,
        key,
        keyedCard: true,
        title: reward,
        purpose: `Bring ${button} back to ${host} for ${reward}.`,
        singleLine: false,
        story: true,
        status: resolved ? "fulfilled" : "pending",
        art: row.reward,
        displayArt: resolved ? row.reward : row.button,
        displayPurpose: instruction,
        stage,
        resolved,
        completion: "Fulfilled",
        holder: { kind: "avatar", id: row.player },
        choiceId: null,
        createdTurn: record.meeting.turn,
        completedTurn,
        personalOwner: row.player,
        completionActorId: row.player,
        completionLocationId: quest.at,
        completionParticipants: participants,
        completionSeq: event?.seq ?? null,
      }];
    });
  }));
}

export function matchesAuthoredPlayerStory(quest, definition) {
  if (!definition.personalOwner) return true;
  const receipt = quest.completion;
  return quest.createdTurn === definition.createdTurn &&
    definition.completionParticipants.every((id) => quest.participants.includes(id)) &&
    (definition.resolved
      ? !!receipt && quest.terminalRevision === 1 && receipt.terminalRevision === 1 &&
        receipt.turn === definition.completedTurn &&
        receipt.actorId === definition.completionActorId &&
        receipt.locationId === definition.completionLocationId &&
        JSON.stringify(receipt.participants) === JSON.stringify(definition.completionParticipants) &&
        (definition.completionSeq === null || receipt.eventSeq === definition.completionSeq)
      : receipt === undefined && quest.terminalRevision === undefined);
}
