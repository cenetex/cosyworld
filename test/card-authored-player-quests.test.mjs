import { describe, expect, it } from "vitest";
import {
  emptyAuthoredPlayerQuestState, validateAuthoredPlayerQuestDefinition,
  validateAuthoredPlayerQuestState, startAuthoredPlayerQuest,
  finishAuthoredPlayerQuest, authoredPlayerQuestItem, authoredPlayerQuestNesting,
} from "../v2/card-game/authored-player-quests.mjs";

const players = ["vale", "mara", "ash", "nell", "tavi", "rue", "orin", "ada"];
const host = "rati", at = "forest-cottage";
const locations = ["forest-garden", "forest-trail", "forest-oak"];
const definition = {
  id: "forest-rati-scarf", host, at, locations,
  playerItems: players.map((player) => ({ player,
    button: `forest-rati-button-${player}`, reward: `forest-rati-scarf-${player}` })),
};
const row = (player) => definition.playerItems.find((entry) => entry.player === player);
function fixture() {
  const world = {
    turn: 10, eventSeq: 100, actor: "vale", state: emptyAuthoredPlayerQuestState(),
    items: Object.fromEntries(definition.playerItems.flatMap((entry) =>
      [entry.button, entry.reward].map((key) => [key, { holder: at, history: [] }]))),
    actors: Object.fromEntries([...players, host].map((key) => [key, at])),
    present: new Set(players), reachable: [...locations], delivery: null,
    meetings: Object.fromEntries(players.map((player, index) =>
      [player, { turn: 10, seq: 90 + index, place: at }])),
  };
  const io = () => ({
    turn: world.turn, eventSeq: world.eventSeq,
    actor: () => world.actor,
    isPlayer: (key) => players.includes(key),
    isActor: (key) => Object.hasOwn(world.actors, key),
    isLocation: (key) => [at, ...locations, "pond"].includes(key),
    isItem: (key) => Object.hasOwn(world.items, key),
    item: (key) => world.items[key],
    initialHolder: () => at,
    isPresent: (key) => world.present.has(key),
    actorPlace: (key) => world.actors[key],
    firstMeeting: (player) => world.meetings[player],
    reachableActiveLocations: () => world.reachable,
    delivery: () => world.delivery,
    isSharedChoice: (key) => key === "forest-rati-first-scarf",
    hasSharedReceipt: () => false,
    canAward: ({ player, moves, state }) => {
      const projected = structuredClone(world.items);
      for (const move of moves) projected[move.item].holder = move.to;
      const seen = new Set();
      const root = (key) => {
        seen.clear();
        while (projected[key]) {
          if (seen.has(key)) throw Error("Custody cycle");
          seen.add(key); key = projected[key].holder;
        }
        return key;
      };
      return Object.keys(projected).filter((key) =>
        !authoredPlayerQuestItem(definition, state, key)?.consumed && root(key) === player).length <= 3;
    },
  });
  const commit = (decision) => {
    const next = structuredClone(world.items);
    for (const move of decision.moves) {
      expect(next[move.item].holder).toBe(move.from);
      next[move.item].holder = move.to;
    }
    world.items = next;
    world.state = decision.state;
    validateAuthoredPlayerQuestState(definition, world.state, io());
    return decision;
  };
  const start = (player = world.actor) => {
    world.actor = player;
    return commit(startAuthoredPlayerQuest(definition, world.state, player, io()));
  };
  const deliver = (player = world.actor, giver = player) => {
    world.actor = player;
    world.turn += 1; world.eventSeq += 1;
    world.items[row(player).button].holder = host;
    world.delivery = { actor: giver, item: row(player).button, target: host,
      accepted: true, turn: world.turn, seq: world.eventSeq };
  };
  const finish = (player = world.actor) => commit(
    finishAuthoredPlayerQuest(definition, world.state, player, io()));
  return { world, io, commit, start, deliver, finish };
}

describe("bounded authored player quests", () => {
  it("validates the eight authored rows and keeps unopened items inactive", () => {
    const f = fixture();
    expect(validateAuthoredPlayerQuestDefinition(definition, f.io())).toBe(definition);
    expect(validateAuthoredPlayerQuestState(definition, f.world.state, f.io())).toBe(f.world.state);
    for (const entry of definition.playerItems) for (const key of [entry.button, entry.reward])
      expect(authoredPlayerQuestItem(definition, f.world.state, key).active).toBe(false);
    expect(authoredPlayerQuestItem(definition, f.world.state, "lamp")).toBeNull();
  });

  it.each(players)("starts and awards %s's own button and scarf through a real Give", (player) => {
    const f = fixture();
    expect(f.start(player).started).toBe(true);
    const record = f.world.state.records[player];
    expect(locations).toContain(record.button.placedAt);
    expect(f.world.items[row(player).button].holder).toBe(record.button.placedAt);
    expect(authoredPlayerQuestItem(definition, f.world.state, row(player).button).active).toBe(true);
    f.deliver(player);
    expect(f.finish(player).completed).toBe(true);
    expect(f.world.items[row(player).button].holder).toBe(row(player).reward);
    expect(f.world.items[row(player).reward].holder).toBe(player);
    expect(f.world.state.records[player].button.delivery).toEqual({ giver: player, turn: 11, seq: 101 });
    expect(authoredPlayerQuestItem(definition, f.world.state, row(player).button))
      .toMatchObject({ active: false, consumed: true });
    expect(authoredPlayerQuestItem(definition, f.world.state, row(player).reward).active).toBe(true);
    expect(authoredPlayerQuestNesting(definition, f.world.state, row(player).button, row(player).reward)).toBe(true);
    expect(f.finish(player)).toMatchObject({ completed: false, moves: [] });
  });

  it("starts all eight in either order with identical saved bytes and separate items", () => {
    const a = fixture(), b = fixture();
    for (const player of players) a.start(player);
    for (const player of [...players].reverse()) b.start(player);
    expect(JSON.stringify(a.world.state)).toBe(JSON.stringify(b.world.state));
    expect(a.world.items).toEqual(b.world.items);
    expect(new Set(Object.values(a.world.state.records).map((r) => r.button.id)).size).toBe(8);
    expect(new Set(Object.values(a.world.state.records).map((r) => r.reward.id)).size).toBe(8);
    for (const player of players) {
      a.deliver(player); a.finish(player);
    }
    expect(Object.values(a.world.state.records).every((r) => r.reward.awardedTurn >= 11)).toBe(true);
  });

  it("uses only supplied active reachable candidates and normalizes their order", () => {
    const a = fixture(), b = fixture();
    a.world.reachable = [at, "pond", locations[1], locations[0], locations[1]];
    b.world.reachable = [locations[0], locations[1]];
    a.start(); b.start();
    expect(a.world.state).toEqual(b.world.state);
    expect(a.world.state.records.vale.eligiblePlaces).toEqual([locations[0], locations[1]].sort());
  });

  it("keeps a saved placement after routes change and a later meeting happens", () => {
    const f = fixture(); f.start();
    const before = structuredClone(f.world);
    f.world.reachable = [];
    f.world.turn = 50;
    f.world.meetings.vale = { turn: 50, seq: 100, place: at };
    expect(f.start()).toMatchObject({ started: false, moves: [] });
    expect(f.world.state).toEqual(before.state);
    expect(f.world.items).toEqual(before.items);
  });

  it("keeps custody in world.items through button and later scarf transfers", () => {
    const f = fixture(); f.start();
    f.world.items[row("vale").button].holder = "mara";
    expect(() => validateAuthoredPlayerQuestState(definition, f.world.state, f.io())).not.toThrow();
    expect(() => f.finish()).toThrow(/Give/);
    f.world.items[row("vale").button].holder = "vale";
    f.deliver(); f.finish();
    for (const holder of ["mara", "forest-oak", "vale"]) {
      f.world.items[row("vale").reward].holder = holder;
      expect(() => validateAuthoredPlayerQuestState(definition, f.world.state, f.io())).not.toThrow();
      expect(f.world.items[row("vale").button].holder).toBe(row("vale").reward);
    }
  });

  it("records an assisted Give and awards only to the fixed owner", () => {
    const f = fixture(); f.start("vale"); f.start("mara"); f.deliver("vale", "mara");
    f.world.actor = "mara";
    expect(f.finish("vale").completed).toBe(true);
    expect(f.world.state.records.vale.button.delivery.giver).toBe("mara");
    expect(f.world.items[row("vale").reward].holder).toBe("vale");
    expect(f.world.state.records.mara.button.consumedTurn).toBeNull();
    expect(f.world.items[row("mara").reward].holder).toBe(at);
  });

  it("retains an assisted delivery while the owner is away and awards after their return", () => {
    const f = fixture(); f.start(); f.deliver("vale", "mara");
    f.world.actor = "mara";
    f.world.present.delete("vale");
    expect(f.finish("vale")).toMatchObject({ completed: false, waitingForOwner: true, moves: [] });
    expect(f.world.state.records.vale.button.delivery).toEqual({ giver: "mara", turn: 11, seq: 101 });
    expect(f.world.items[row("vale").reward].holder).toBe(at);
    f.world.present.add("vale");
    f.world.turn = 20; f.world.eventSeq = 150; f.world.delivery = null;
    expect(f.finish("vale").completed).toBe(true);
    expect(f.world.items[row("vale").reward].holder).toBe("vale");
  });

  it("keeps the latest assisted Give through transfers, retries and pruned logs", () => {
    const f = fixture(); f.start(); f.world.present.delete("vale");
    f.deliver("vale", "mara");
    expect(f.finish("vale").waitingForOwner).toBe(true);
    const first = structuredClone(f.world.delivery);
    expect(f.world.state.records.vale.button.delivery.giver).toBe("mara");

    // The real item can leave RATi and arrive in another traveler's hands.
    f.world.items[row("vale").button].holder = "nell";
    validateAuthoredPlayerQuestState(definition, f.world.state, f.io());
    f.deliver("vale", "nell");
    expect(f.finish("vale").waitingForOwner).toBe(true);
    const latest = { giver: "nell", turn: 12, seq: 102 };
    expect(f.world.state.records.vale.button.delivery).toEqual(latest);
    const pending = structuredClone(f.world.state);
    f.finish("vale"); // The same event is safe to observe twice.
    expect(f.world.state).toEqual(pending);
    f.world.delivery = first; // A stale callback keeps the newer saved evidence.
    f.finish("vale");
    expect(f.world.state).toEqual(pending);

    f.world.delivery = null;
    f.world.turn = 20; f.world.eventSeq = 150;
    f.finish("vale");
    expect(f.world.state).toEqual(pending);
    f.world.present.add("vale");
    expect(f.finish("vale").completed).toBe(true);
    expect(f.world.state.records.vale.button.delivery).toEqual(latest);
    expect(f.world.state.records.vale.button.consumedTurn).toBe(20);
    expect(f.world.items[row("vale").reward].holder).toBe("vale");
  });

  it("checks each new handover before replacing pending Give evidence", () => {
    const f = fixture(); f.start(); f.world.present.delete("vale");
    f.deliver("vale", "mara"); f.finish("vale");
    f.deliver("vale", "nell"); f.world.delivery.accepted = false;
    const before = structuredClone(f.world);
    expect(() => f.finish("vale")).toThrow(/accepted ordinary Give/);
    expect(f.world).toEqual(before);
  });

  it("handles full inventory atomically and leaves the physical Give available for later sewing", () => {
    const f = fixture(); f.start(); f.deliver();
    for (const key of ["lamp", "oil", "bell"]) f.world.items[key] = { holder: "vale", history: [] };
    const before = structuredClone(f.world);
    expect(f.finish()).toMatchObject({ completed: false, waitingForSpace: true, moves: [] });
    expect(f.world.items).toEqual(before.items);
    expect(f.world.state.records.vale.button.consumedTurn).toBeNull();
    expect(f.world.state.records.vale.reward.awardedTurn).toBeNull();
    expect(f.world.state.records.vale.button.delivery).toEqual({ giver: "vale", turn: 11, seq: 101 });
    f.world.items.bell.holder = at;
    f.world.turn = 15; f.world.eventSeq = 120;
    f.world.delivery = null; // The transient log entry can age out.
    expect(f.finish().completed).toBe(true);
    expect(f.world.state.records.vale.button.consumedTurn).toBe(15);
    expect(f.world.state.records.vale.button.delivery.turn).toBe(11);
  });

  it("counts the scarf once after consuming its nested button", () => {
    const f = fixture(); f.start(); f.deliver();
    for (const key of ["lamp", "oil"]) f.world.items[key] = { holder: "vale", history: [] };
    expect(f.finish().completed).toBe(true);
    expect(f.world.items[row("vale").button].holder).toBe(row("vale").reward);
    expect(authoredPlayerQuestItem(definition, f.world.state, row("vale").button).consumed).toBe(true);
  });

  it("replays the same trusted facts and survives strict JSON reload", () => {
    const run = () => {
      const f = fixture(); f.start();
      f.world.state = JSON.parse(JSON.stringify(f.world.state));
      validateAuthoredPlayerQuestState(definition, f.world.state, f.io());
      f.deliver(); f.finish();
      return { state: f.world.state, items: f.world.items };
    };
    expect(run()).toEqual(run());
  });

  it.each([
    ["unknown definition key", (d) => { d.random = true; }],
    ["duplicate player", (d) => { d.playerItems[1].player = "vale"; }],
    ["duplicate item", (d) => { d.playerItems[1].reward = d.playerItems[0].button; }],
    ["unknown item", (d) => { d.playerItems[0].button = "invented-button"; }],
    ["host room placement", (d) => { d.locations.push(at); }],
    ["too many players", (d) => { d.playerItems.push(d.playerItems[0]); }],
    ["too many places", (d) => { d.locations = Array(129).fill(locations[0]); }],
  ])("rejects %s", (_, change) => {
    const f = fixture(), d = structuredClone(definition); change(d);
    expect(() => validateAuthoredPlayerQuestDefinition(d, f.io())).toThrow();
  });

  it.each([
    ["unknown state key", (s) => { s.secret = true; }],
    ["unknown player", (s) => { s.records.stranger = s.records.vale; }],
    ["future meeting", (s) => { s.records.vale.meeting.turn = 100; }],
    ["future event", (s) => { s.records.vale.meeting.seq = 200; }],
    ["wrong room", (s) => { s.records.vale.meeting.place = locations[0]; }],
    ["another button", (s) => { s.records.vale.button.id = row("mara").button; }],
    ["another reward", (s) => { s.records.vale.reward.id = row("mara").reward; }],
    ["different placement", (s) => { s.records.vale.button.placedAt = "pond"; }],
    ["duplicate snapshot", (s) => { s.records.vale.eligiblePlaces.push(s.records.vale.eligiblePlaces[0]); }],
    ["one-sided award", (s) => { s.records.vale.reward.awardedTurn = 10; }],
    ["invented consumption", (s) => { s.records.vale.button.consumedTurn = 10; }],
  ])("rejects tampered %s", (_, change) => {
    const f = fixture(); f.start(); const s = structuredClone(f.world.state); change(s);
    expect(() => validateAuthoredPlayerQuestState(definition, s, f.io())).toThrow();
  });

  it.each(["absent", "wrong player", "different room", "host moved", "missing first meeting", "no reachable place"])(
    "checks first-meeting authority: %s", (kind) => {
      const f = fixture();
      if (kind === "absent") f.world.present.delete("vale");
      if (kind === "wrong player") f.world.actor = "mara";
      if (kind === "different room") f.world.actors.vale = locations[0];
      if (kind === "host moved") f.world.actors.rati = locations[0];
      if (kind === "missing first meeting") f.world.meetings.vale = null;
      if (kind === "no reachable place") f.world.reachable = [at, "pond"];
      const before = structuredClone(f.world);
      expect(() => startAuthoredPlayerQuest(definition, f.world.state, "vale", f.io())).toThrow();
      expect(f.world).toEqual(before);
    },
  );

  it("requests the authored shared completion once after successful sewing", () => {
    const f = fixture();
    const authored = { ...definition, sharedCompletion: "forest-rati-first-scarf" };
    f.start(); f.deliver();
    const first = finishAuthoredPlayerQuest(authored, f.world.state, "vale", f.io());
    expect(first.sharedChoices).toEqual([{ choice: "forest-rati-first-scarf", actor: "vale" }]);
    f.commit(first);
    expect(finishAuthoredPlayerQuest(authored, f.world.state, "vale", f.io()).sharedChoices).toEqual([]);
    const g = fixture(); g.start(); g.deliver();
    expect(finishAuthoredPlayerQuest(authored, g.world.state, "vale",
      { ...g.io(), hasSharedReceipt: () => true }).sharedChoices).toEqual([]);
  });

  it("keeps inputs separate from returned pending delivery records", () => {
    const f = fixture(); f.start(); f.deliver();
    f.world.present.delete("vale");
    const pending = finishAuthoredPlayerQuest(definition, f.world.state, "vale", f.io());
    f.commit(pending);
    const second = finishAuthoredPlayerQuest(definition, f.world.state, "vale", f.io());
    second.state.records.vale.button.delivery.giver = "mara";
    expect(f.world.state.records.vale.button.delivery.giver).toBe("vale");
  });

  it("accepts exact legacy metadata without changing personal state", () => {
    const f = fixture(); f.world.items["forest-story-button"] = { holder: at, history: [] };
    const authored = { ...definition, legacy: { item: "forest-story-button",
      choice: "forest-mend-scarf", story: "story-quest-forest-hearth" } };
    expect(validateAuthoredPlayerQuestDefinition(authored, f.io())).toBe(authored);
    expect(startAuthoredPlayerQuest(authored, f.world.state, "vale", f.io()).state)
      .toEqual(startAuthoredPlayerQuest(definition, f.world.state, "vale", f.io()).state);
    expect(() => validateAuthoredPlayerQuestDefinition({ ...authored,
      legacy: { ...authored.legacy, unknown: true } }, f.io())).toThrow();
  });

  it("allows only the exact authored sewn pair and rejects custody cycles", () => {
    const f = fixture(); f.start(); f.deliver(); f.finish();
    expect(authoredPlayerQuestNesting(definition, f.world.state, row("vale").button, row("mara").reward)).toBe(false);
    expect(authoredPlayerQuestNesting(definition, f.world.state, row("vale").reward, row("vale").button)).toBe(false);
    f.world.items[row("vale").reward].holder = row("vale").button;
    expect(() => validateAuthoredPlayerQuestState(definition, f.world.state, f.io())).toThrow();
  });
});
