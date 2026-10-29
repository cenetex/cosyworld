import {
  emptyAuthoredPlayerQuestState,
  startAuthoredPlayerQuest,
  finishAuthoredPlayerQuest,
  validateAuthoredPlayerQuestState,
  authoredPlayerQuestItem,
  authoredPlayerQuestNesting,
} from "./authored-player-quests.mjs";

// Pack data owns the residents, items, route candidates and shared completion.
// World callbacks supply current physical custody and reachable locations.
export const initialPersonalQuests = (pack) =>
  Object.fromEntries((pack.personalQuests || []).map((quest) => [
    quest.id,
    { legacy: false, ...emptyAuthoredPlayerQuestState() },
  ]));

function stateFor(world, pack, quest) {
  return world.packs?.[pack.id]?.personalQuests?.[quest.id];
}
function questState(state) {
  return { version: state.version, records: state.records };
}
function commit(state, result, world) {
  state.version = result.state.version;
  state.records = result.state.records;
  for (const move of result.moves) {
    if (world.items[move.item]?.holder !== move.from)
      throw new Error("The quest item moved before the play completed.");
    world.items[move.item].holder = move.to;
  }
}
const indexes = new WeakMap();
function indexFor(packs) {
  let index = indexes.get(packs);
  if (index) return index;
  index = { items: new Map(), legacyChoices: new Map(), legacyStories: new Map() };
  for (const pack of packs) for (const quest of pack.personalQuests || []) {
    for (const row of quest.playerItems) {
      index.items.set(row.button, { pack, quest });
      index.items.set(row.reward, { pack, quest });
    }
    if (quest.legacy) {
      index.items.set(quest.legacy.item, { pack, quest, legacy: true });
      index.legacyChoices.set(quest.legacy.choice, { pack, quest });
      index.legacyStories.set(quest.legacy.story, { pack, quest });
    }
  }
  indexes.set(packs, index);
  return index;
}
export function personalItem(world, packs, item) {
  const entry = indexFor(packs).items.get(item);
  if (!entry) return null;
  const state = stateFor(world, entry.pack, entry.quest);
  if (!state) return { active: false };
  if (entry.legacy) {
    const finished = Object.hasOwn(world.packs[entry.pack.id].receipts, entry.quest.legacy.choice);
    return { kind: "legacy", active: state.legacy && !finished && Object.keys(state.records).length === 0 };
  }
  return authoredPlayerQuestItem(entry.quest, questState(state), item);
}
export function personalHostAccepts(world, packs, host, item) {
  const entry = indexFor(packs).items.get(item);
  if (!entry || entry.legacy || entry.quest.host !== host) return false;
  const state = stateFor(world, entry.pack, entry.quest);
  if (!state) return false;
  const info = authoredPlayerQuestItem(entry.quest, questState(state), item);
  return !!info && info.kind === "button" && info.active;
}
export function personalNesting(world, packs, item, holder) {
  const entry = indexFor(packs).items.get(item);
  if (!entry || entry.legacy) return false;
  const state = stateFor(world, entry.pack, entry.quest);
  return !!state && authoredPlayerQuestNesting(entry.quest, questState(state), item, holder);
}
export function personalLegacyAllowed(world, packs, kind, id, actor = null) {
  const entries = kind === "choice" ? indexFor(packs).legacyChoices : indexFor(packs).legacyStories;
  const entry = entries.get(id);
  if (!entry) return true;
  const state = stateFor(world, entry.pack, entry.quest);
  if (!state?.legacy) return false;
  if (kind !== "choice" || !actor) return true;
  return Object.keys(state.records).length === 0;
}
export function personalLegacyCardVisible(world, packs, id, actor) {
  const entry = indexFor(packs).legacyStories.get(id);
  if (!entry) return true;
  const state = stateFor(world, entry.pack, entry.quest);
  const finished = Object.hasOwn(world.packs[entry.pack.id].receipts, entry.quest.legacy.choice);
  return !!state?.legacy && (finished || Object.keys(state.records).length === 0);
}
export function personalSharedChoice(packs, packId, id) {
  return packs.some((pack) => pack.id === packId &&
    (pack.personalQuests || []).some((quest) => quest.sharedCompletion === id));
}
function ioFor(world, pack, quest, api, player, delivery = null) {
  return {
    turn: world.turn,
    eventSeq: world.eventSeq,
    isActor: (id) => !!world.actors[id],
    isPlayer: (id) => api.isPlayer(id),
    isLocation: (id) => api.isLocation(id),
    isItem: (id) => !!world.items[id] && !!pack.items[id],
    isSharedChoice: (id) => pack.choices.some((choice) => choice.id === id),
    item: (id) => world.items[id],
    initialHolder: (id) => pack.items[id]?.holder,
    actor: () => player,
    actorPlace: (id) => world.actors[id]?.place,
    isPresent: (id) => api.isPresent(world, id),
    firstMeeting: () => ({ turn: world.turn, seq: world.eventSeq, place: quest.at }),
    reachableActiveLocations: (id) => api.reachable(world, id, quest.at),
    delivery: () => delivery,
    canAward: ({ player: owner }) => api.canAward(world, owner),
    hasSharedReceipt: (id) => Object.hasOwn(world.packs[pack.id].receipts, id),
  };
}
export function validPersonalQuests(world, packs, api) {
  try {
    for (const pack of packs) {
      const definitions = pack.personalQuests || [];
      const states = world.packs[pack.id]?.personalQuests;
      if (!definitions.length) continue;
      if (!states || Array.isArray(states) || typeof states !== "object" ||
          Object.keys(states).sort().join() !== definitions.map((q) => q.id).sort().join())
        return false;
      for (const quest of definitions) {
        const state = states[quest.id];
        if (!state || typeof state.legacy !== "boolean" ||
            Object.keys(state).sort().join() !== "legacy,records,version") return false;
        validateAuthoredPlayerQuestState(quest, questState(state), ioFor(world, pack, quest, api));
        if (!state.legacy && quest.legacy) {
          const oldItem = world.items[quest.legacy.item];
          if (!oldItem || oldItem.holder !== pack.items[quest.legacy.item].holder ||
              oldItem.history?.length !== 0 ||
              Object.hasOwn(world.packs[pack.id].receipts, quest.legacy.choice)) return false;
        }
        if (quest.sharedCompletion) {
          const turns = Object.values(state.records).map((record) => record.reward.awardedTurn)
            .filter((turn) => turn !== null);
          const receipt = world.packs[pack.id].receipts[quest.sharedCompletion];
          if (turns.length ? receipt !== Math.min(...turns) : receipt !== undefined) return false;
        }
      }
    }
    return true;
  } catch { return false; }
}
export function beginPersonalMeetings(world, packs, api) {
  const started = [];
  for (const pack of packs) for (const quest of pack.personalQuests || []) {
    const state = stateFor(world, pack, quest);
    if (!state || world.actors[quest.host]?.place !== quest.at || !api.active(world, quest.host)) continue;
    for (const row of quest.playerItems) {
      if (state.records[row.player] || !api.isPresent(world, row.player) ||
          world.actors[row.player]?.place !== quest.at) continue;
      const result = startAuthoredPlayerQuest(quest, questState(state), row.player,
        ioFor(world, pack, quest, api, row.player));
      commit(state, result, world);
      if (result.started) {
        world.packs[pack.id].met[quest.host] ??= world.turn;
        started.push({ pack: pack.id, quest: quest.id, player: row.player, item: row.button });
      }
    }
  }
  return started;
}
export function advancePersonalQuests(world, packs, api, action = null) {
  const completed = [], sharedPending = new Set();
  for (const pack of packs) for (const quest of pack.personalQuests || []) {
    const state = stateFor(world, pack, quest);
    if (!state) continue;
    for (const row of quest.playerItems) {
      const record = state.records[row.player];
      if (!record || record.button.consumedTurn !== null || world.items[row.button]?.holder !== quest.host) continue;
      const accepted = action?.kind === "give" && action.item === row.button && action.target === quest.host
        ? world.log.findLast((event) => event.turn === world.turn && event.verb === "give" &&
            event.actorId === action.actor && event.itemId === row.button && event.targetId === quest.host)
        : null;
      const delivery = accepted ? { actor: action.actor, item: row.button, target: quest.host,
        accepted: true, turn: world.turn, seq: accepted.seq } : null;
      if (!record.button.delivery && !delivery) continue;
      const result = finishAuthoredPlayerQuest(quest, questState(state), row.player,
        ioFor(world, pack, quest, api, row.player, delivery));
      commit(state, result, world);
      if (result.completed) {
        const sharedChoices = result.sharedChoices.filter((choice) => {
          const key = `${pack.id}:${choice.choice}`;
          if (sharedPending.has(key)) return false;
          sharedPending.add(key);
          return true;
        });
        completed.push({ pack: pack.id, quest: quest.id,
          player: row.player, reward: row.reward, sharedChoices });
      }
    }
  }
  return completed;
}
