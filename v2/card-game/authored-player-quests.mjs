// Pure authored quest decisions. The caller commits each returned state and its
// physical item moves together through the ordinary authoritative game turn.
export const authoredPlayerQuestLimits = Object.freeze({ players: 8, places: 128 });
const object = (value) => !!value && typeof value === "object" && !Array.isArray(value);
const exact = (value, keys) => object(value) &&
  Object.keys(value).sort().join() === [...keys].sort().join();
const id = (value) => typeof value === "string" && value.length <= 96 &&
  /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value);
const integer = (value, minimum, maximum) => Number.isSafeInteger(value) &&
  value >= minimum && value <= maximum;
const require = (condition, message) => { if (!condition) throw new Error(message); };
const sorted = (values) => [...values].sort();
const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const rowFor = (definition, player) => definition.playerItems.find((row) => row.player === player);
const call = (io, name, ...args) => {
  require(typeof io[name] === "function", `Supply the ${name} game callback.`);
  return io[name](...args);
};
const item = (io, key) => {
  require(call(io, "isItem", key), "Use an authored item identity.");
  const value = call(io, "item", key);
  require(object(value) && typeof value.holder === "string", "Keep the real item custody record.");
  return value;
};
const ordinaryHolder = (io, holder) => call(io, "isPlayer", holder) ||
  call(io, "isActor", holder) || call(io, "isLocation", holder);
function timing(io) {
  require(integer(io.turn, 0, Number.MAX_SAFE_INTEGER) &&
    integer(io.eventSeq, 0, Number.MAX_SAFE_INTEGER), "Use the committed world turn and event sequence.");
}

export function validateAuthoredPlayerQuestDefinition(definition, io) {
  require(exact(definition, ["id", "host", "at", "locations", "playerItems",
    ...(Object.hasOwn(definition, "sharedCompletion") ? ["sharedCompletion"] : [])]) &&
    id(definition.id) && id(definition.host) && id(definition.at), "Use an exact authored quest definition.");
  require(call(io, "isActor", definition.host) && !call(io, "isPlayer", definition.host) &&
    call(io, "isLocation", definition.at), "Use a resident host and an authored host room.");
  require(Array.isArray(definition.locations) && definition.locations.length > 0 &&
    definition.locations.length <= authoredPlayerQuestLimits.places &&
    new Set(definition.locations).size === definition.locations.length &&
    definition.locations.every((place) => id(place) && place !== definition.at &&
      call(io, "isLocation", place)), "Use distinct authored search locations outside the host room.");
  require(Array.isArray(definition.playerItems) && definition.playerItems.length > 0 &&
    definition.playerItems.length <= authoredPlayerQuestLimits.players &&
    definition.playerItems.every((row) => exact(row, ["player", "button", "reward"]) &&
      id(row.player) && id(row.button) && id(row.reward) && call(io, "isPlayer", row.player) &&
      call(io, "isItem", row.button) && call(io, "isItem", row.reward)),
  "Use bounded explicit player, button and reward identities.");
  if (Object.hasOwn(definition, "sharedCompletion"))
    require(id(definition.sharedCompletion) && call(io, "isSharedChoice", definition.sharedCompletion),
      "Use an authored shared completion choice.");
  const players = definition.playerItems.map((row) => row.player);
  const items = definition.playerItems.flatMap((row) => [row.button, row.reward]);
  require(new Set(players).size === players.length && new Set(items).size === items.length,
    "Give each player a distinct button and reward.");
  return definition;
}

export const emptyAuthoredPlayerQuestState = () => ({ version: 1, records: {} });

// UTF-16 integer arithmetic has the same result in the browser and QuickJS.
function placement(definition, player, meeting, eligiblePlaces) {
  let hash = 2166136261;
  for (const part of [definition.id, player, String(meeting.turn), String(meeting.seq)]) {
    for (let i = 0; i < part.length; i++) hash = Math.imul(hash ^ part.charCodeAt(i), 16777619) >>> 0;
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  return eligiblePlaces[hash % eligiblePlaces.length];
}
function canonical(state) {
  return { version: 1, records: Object.fromEntries(Object.entries(state.records).sort(([a], [b]) =>
    a < b ? -1 : a > b ? 1 : 0)) };
}
function validMeeting(meeting, definition, io) {
  return exact(meeting, ["turn", "seq", "place"]) &&
    integer(meeting.turn, 0, io.turn) && integer(meeting.seq, 0, io.eventSeq) &&
    meeting.place === definition.at;
}

function validDelivery(delivery, meeting, io) {
  return exact(delivery, ["giver", "turn", "seq"]) && call(io, "isActor", delivery.giver) &&
    integer(delivery.turn, meeting.turn, io.turn) && integer(delivery.seq, meeting.seq, io.eventSeq);
}

export function validateAuthoredPlayerQuestState(definition, state, io) {
  validateAuthoredPlayerQuestDefinition(definition, io);
  timing(io);
  require(exact(state, ["version", "records"]) && state.version === 1 && object(state.records) &&
    Object.keys(state.records).length <= definition.playerItems.length,
  "Use a bounded version-one authored quest state.");
  for (const player of Object.keys(state.records))
    require(!!rowFor(definition, player), "Use a configured human quest owner.");
  const deliverySequences = new Set();
  for (const row of definition.playerItems) {
    const button = item(io, row.button), reward = item(io, row.reward);
    const record = state.records[row.player];
    if (!record) {
      require(button.holder === call(io, "initialHolder", row.button) &&
        reward.holder === call(io, "initialHolder", row.reward),
        "Keep unopened quest items at their authored staging room.");
      continue;
    }
    require(exact(record, ["meeting", "eligiblePlaces", "button", "reward"]) &&
      validMeeting(record.meeting, definition, io), "Keep the first personal meeting evidence.");
    require(Array.isArray(record.eligiblePlaces) && record.eligiblePlaces.length > 0 &&
      record.eligiblePlaces.length <= authoredPlayerQuestLimits.places &&
      new Set(record.eligiblePlaces).size === record.eligiblePlaces.length &&
      equal(record.eligiblePlaces, sorted(record.eligiblePlaces)) &&
      record.eligiblePlaces.every((place) => definition.locations.includes(place)),
    "Keep the bounded sorted placement snapshot.");
    require(exact(record.button, ["id", "placedAt", "consumedTurn", "delivery"]) &&
      record.button.id === row.button && record.button.placedAt ===
        placement(definition, row.player, record.meeting, record.eligiblePlaces) &&
      exact(record.reward, ["id", "awardedTurn"]) && record.reward.id === row.reward,
    "Keep this owner's authored button, reward and deterministic placement.");
    if (record.button.delivery) {
      require(record.button.delivery.giver !== definition.host &&
        !deliverySequences.has(record.button.delivery.seq), "Keep distinct real Give evidence for each button.");
      deliverySequences.add(record.button.delivery.seq);
    }
    const consumed = record.button.consumedTurn;
    const awarded = record.reward.awardedTurn;
    if (consumed === null) {
      require(awarded === null && (record.button.delivery === null ||
        validDelivery(record.button.delivery, record.meeting, io)) &&
        ordinaryHolder(io, button.holder) && reward.holder === call(io, "initialHolder", row.reward),
      "Keep an unfinished quest's button in ordinary custody and its reward staged.");
    } else {
      const delivery = record.button.delivery;
      require(integer(consumed, record.meeting.turn, io.turn) && awarded === consumed &&
        validDelivery(delivery, record.meeting, io) && delivery.turn <= consumed &&
        button.holder === row.reward && ordinaryHolder(io, reward.holder),
      "Keep the sewn button in its own awarded scarf with matching delivery evidence.");
    }
  }
  return state;
}

function ownPresent(definition, player, io) {
  require(call(io, "actor") === player && call(io, "isPresent", player) &&
    call(io, "actorPlace", player) === definition.at &&
    call(io, "actorPlace", definition.host) === definition.at,
  "Bring your own present avatar beside the host.");
}

export function startAuthoredPlayerQuest(definition, state, player, io) {
  validateAuthoredPlayerQuestState(definition, state, io);
  const row = rowFor(definition, player);
  require(!!row, "Choose a configured human quest owner.");
  ownPresent(definition, player, io);
  if (state.records[player]) return { state: structuredClone(state), moves: [], started: false };
  const meeting = call(io, "firstMeeting", player, definition.host);
  require(validMeeting(meeting, definition, io) && meeting.turn === io.turn,
    "Start the quest from this player's first committed meeting.");
  const supplied = call(io, "reachableActiveLocations", player);
  require(Array.isArray(supplied) && supplied.length <= authoredPlayerQuestLimits.places &&
    supplied.every((place) => typeof place === "string"), "Supply a bounded reachable location list.");
  const eligiblePlaces = sorted(new Set(supplied.filter((place) => definition.locations.includes(place))));
  require(eligiblePlaces.length > 0, "Provide a reachable active search location outside the host room.");
  const placedAt = placement(definition, player, meeting, eligiblePlaces);
  const next = structuredClone(state);
  next.records[player] = {
    meeting: structuredClone(meeting), eligiblePlaces,
    button: { id: row.button, placedAt, consumedTurn: null, delivery: null },
    reward: { id: row.reward, awardedTurn: null },
  };
  return {
    state: canonical(next),
    moves: [{ item: row.button, from: item(io, row.button).holder, to: placedAt }],
    started: true,
  };
}

export function finishAuthoredPlayerQuest(definition, state, player, io) {
  validateAuthoredPlayerQuestState(definition, state, io);
  const row = rowFor(definition, player), record = state.records[player];
  require(!!row && !!record, "Start this player's own authored quest first.");
  if (record.button.consumedTurn !== null)
    return { state: structuredClone(state), moves: [], sharedChoices: [], completed: false };
  require(item(io, row.button).holder === definition.host,
    "Give this player's own button to the host first.");
  let delivery = record.button.delivery;
  if (delivery === null) {
    const delivered = call(io, "delivery", player, row.button, definition.host);
    require(exact(delivered, ["actor", "item", "target", "accepted", "turn", "seq"]) &&
      call(io, "isActor", delivered.actor) && delivered.actor !== definition.host &&
      delivered.item === row.button &&
      delivered.target === definition.host && delivered.accepted === true &&
      validDelivery({ giver: delivered.actor, turn: delivered.turn, seq: delivered.seq }, record.meeting, io),
    "Use the accepted ordinary Give of this button from committed game history.");
    delivery = { giver: delivered.actor, turn: delivered.turn, seq: delivered.seq };
  }
  const pending = structuredClone(state);
  pending.records[player].button.delivery = structuredClone(delivery);
  if (!call(io, "isPresent", player) || call(io, "actorPlace", player) !== definition.at ||
    call(io, "actorPlace", definition.host) !== definition.at)
    return { state: canonical(pending), moves: [], sharedChoices: [], completed: false,
      waitingForOwner: true, waitingForSpace: false };
  const next = structuredClone(pending), saved = next.records[player];
  saved.button.consumedTurn = io.turn;
  saved.reward.awardedTurn = io.turn;
  const moves = [
    { item: row.button, from: definition.host, to: row.reward },
    { item: row.reward, from: item(io, row.reward).holder, to: player },
  ];
  const fits = call(io, "canAward", { player, button: row.button, reward: row.reward,
    moves: structuredClone(moves), state: structuredClone(next) });
  require(typeof fits === "boolean", "Return the authoritative inventory capacity answer.");
  if (!fits)
    return { state: canonical(pending), moves: [], sharedChoices: [], completed: false, waitingForOwner: false, waitingForSpace: true };
  const sharedChoices = definition.sharedCompletion &&
    !call(io, "hasSharedReceipt", definition.sharedCompletion)
    ? [{ choice: definition.sharedCompletion, actor: player }]
    : [];
  return { state: canonical(next), moves, sharedChoices, completed: true, waitingForOwner: false, waitingForSpace: false };
}

// These checks read the quest block, so item visibility, carrying space and the
// narrow nested-custody allowance use the same authoritative evidence.
export function authoredPlayerQuestItem(definition, state, itemId) {
  const row = definition.playerItems.find((entry) => entry.button === itemId || entry.reward === itemId);
  if (!row) return null;
  const record = state.records[row.player];
  const button = row.button === itemId;
  return {
    player: row.player, kind: button ? "button" : "reward",
    active: !!record && (button ? record.button.consumedTurn === null : record.reward.awardedTurn !== null),
    consumed: !!record && button && record.button.consumedTurn !== null,
  };
}
export function authoredPlayerQuestNesting(definition, state, itemId, holder) {
  const row = definition.playerItems.find((entry) => entry.button === itemId);
  const record = row && state.records[row.player];
  return !!record && record.button.consumedTurn !== null &&
    record.reward.awardedTurn === record.button.consumedTurn && holder === row.reward;
}
