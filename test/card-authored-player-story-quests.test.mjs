import { afterEach, describe, expect, it, vi } from "vitest";

const fixtures = vi.hoisted(() => {
  const players = ["vale", "mara", "ash", "nell", "tavi", "rue", "orin", "ada"];
  const rows = players.map((player) => ({
    player, button: `forest-rati-button-${player}`, reward: `forest-rati-scarf-${player}`,
  }));
  const legacyIds = ["story-quest-forest-hearth", "story-quest-forest-path", "story-quest-forest-return"];
  const pack = {
    id: "lonely-forest",
    avatars: { rati: { name: "RATi" } },
    places: { "forest-cottage": { name: "Cosy Cottage" }, "forest-garden": { name: "Rain-Soft Garden" } },
    items: Object.fromEntries(rows.flatMap((row) => [
      [row.button, { name: `${row.player}'s Story Button` }],
      [row.reward, { name: `${row.player}'s Scarf` }],
    ])),
    personalQuests: [{
      id: "forest-rati-scarf", host: "rati", at: "forest-cottage",
      locations: ["forest-garden"], playerItems: rows,
      legacy: { item: "forest-story-button", choice: "forest-mend-scarf", story: legacyIds[0] },
    }],
    choices: [],
    storyQuests: legacyIds.map((id) => ({
      id, line: `Original ${id}.`, art: "forest-story-button",
      holder: { kind: "avatar", id: "rati" },
      start: { kind: "receipt", choice: "legacy-start" },
      created: { kind: "receipt", choice: "legacy-start" },
      related: ["legacy-start", "legacy-end"], endings: [{ choice: "legacy-end" }],
    })),
  };
  return { players, rows, legacyIds, pack };
});

vi.mock("../v2/card-game/pack-registry.mjs", async (original) => ({
  ...await original(), packDefinitions: [fixtures.pack],
}));

import { authoredPlayerStoryDefinitions } from "../v2/card-game/authored-player-story-quests.mjs";
import { syncStoryQuests, storyDefinitions, createStoryQuestValidator } from "../v2/card-game/story-quests.mjs";
import { publishQuestCompletions } from "../v2/card-game/quest-completions.mjs";
import { questHistoryCards, questCardId } from "../v2/card-game/quest-cards.mjs";

const task = "forest-rati-scarf";
const key = (owner) => `lonely-forest:${task}:${owner}`;
function fresh({ legacy = false } = {}) {
  return {
    turn: 20, revision: 20, eventSeq: 60, playerActorId: "vale", life: { actors: Object.fromEntries(fixtures.players.map((id) => [id, { collection: { cards: [], archive: [], active: null } }])) }, log: [],
    actors: Object.fromEntries([...fixtures.players, "rati"].map((id) => [id, { place: "forest-cottage", progress: { program: 0, step: 0, marks: [] } }])),
    items: Object.fromEntries(fixtures.rows.flatMap((row) => [
      [row.button, { holder: "forest-garden" }], [row.reward, { holder: "rati" }],
    ])),
    packs: { "lonely-forest": {
      flags: {}, choices: {}, receipts: {}, met: {},
      personalQuests: { [task]: { legacy, version: 1, records: {} } },
    } },
  };
}
function meet(world, owner = "vale") {
  const row = fixtures.rows.find((row) => row.player === owner);
  world.packs["lonely-forest"].personalQuests[task].records[owner] = {
    meeting: { turn: 2, seq: 5, place: "forest-cottage" },
    eligiblePlaces: ["forest-garden"],
    button: { id: row.button, placedAt: "forest-garden", consumedTurn: null, delivery: null },
    reward: { id: row.reward, awardedTurn: null },
  };
  return row;
}
const definition = (world, owner = "vale") =>
  authoredPlayerStoryDefinitions(world, [fixtures.pack]).find((entry) => entry.personalOwner === owner);
const sync = (world, actor = null) => {
  publishQuestCompletions(world, syncStoryQuests(world, actor));
  return world;
};
function finish(world, owner = "vale", giver = "mara", log = true) {
  const row = fixtures.rows.find((row) => row.player === owner);
  const record = world.packs["lonely-forest"].personalQuests[task].records[owner];
  record.button.delivery = { giver, turn: 10, seq: 25 };
  record.button.consumedTurn = record.reward.awardedTurn = 16;
  world.items[row.button].holder = row.reward;
  world.items[row.reward].holder = owner;
  if (log) world.log.push({
    kind: "action", verb: "personal-quest-complete", actorId: owner,
    targetId: "rati", itemId: row.reward, locationId: "forest-cottage",
    questKey: key(owner), turn: 16, seq: 40,
  });
}

afterEach(() => vi.restoreAllMocks());

describe("authored player story cards", () => {
  it("starts only from each owner's saved meeting and leaves reads unchanged", () => {
    const world = fresh();
    expect(definition(world)).toBeUndefined();
    meet(world);
    const before = JSON.stringify(world);
    expect(definition(world)).toMatchObject({
      key: key("vale"), createdTurn: 2, stage: "find", keyedCard: true,
      holder: { kind: "avatar", id: "vale" },
    });
    expect(definition(world, "mara")).toBeUndefined();
    expect(JSON.stringify(world)).toBe(before);
  });

  it("gives all eight owners distinct cards and preserves the stored program through the stages", () => {
    const world = fresh();
    for (const owner of fixtures.players) meet(world, owner);
    sync(world);
    expect(new Set(storyDefinitions(world).map((entry) => entry.key)).size).toBe(8);
    for (const owner of fixtures.players) {
      const row = fixtures.rows.find((entry) => entry.player === owner);
      const record = world.quests.records[key(owner)];
      expect(record.holder).toEqual({ kind: "avatar", id: owner });
      expect(record.participants).toEqual([owner]);
      const program = JSON.stringify(record.program);
      world.items[row.button].holder = owner;
      sync(world);
      expect(definition(world, owner).stage).toBe("return");
      const card = questHistoryCards(world, owner).find((entry) => entry.key === key(owner));
      expect(card.purpose).toMatch(/^Bring /);
      expect(card.art).toBe(row.button);
      expect(questCardId(world, card)).toMatch(/^quest-card:/);
      expect(JSON.stringify(record.program)).toBe(program);
    }
  });

  it("shows actual floor and helper custody while retaining the owner's card", () => {
    const world = fresh(); const row = meet(world);
    world.items[row.button].holder = "mara";
    expect(definition(world)).toMatchObject({ stage: "held", holder: { id: "vale" } });
    expect(definition(world).displayPurpose).toContain("Mara carries");
    world.items[row.button].holder = "station";
    expect(definition(world).displayPurpose).toContain("Empty station");
  });

  it("keeps a delivered button pending until the helper records the completed scarf", () => {
    const world = fresh(); const row = meet(world);
    world.items[row.button].holder = "rati";
    world.packs["lonely-forest"].personalQuests[task].records.vale.button.delivery = { giver: "mara", turn: 10, seq: 25 };
    sync(world);
    expect(definition(world)).toMatchObject({ stage: "delivered", resolved: false, completedTurn: null });
    expect(world.quests.records[key("vale")].completedTurn).toBeNull();
    expect(world.questCompletions).toBeUndefined();
  });

  it("records the sewing owner and site, preserves the actual giver, and uses the completion event", () => {
    const world = fresh(); meet(world); sync(world);
    const original = JSON.stringify(world.quests.records[key("vale")].program);
    finish(world); sync(world, "mara");
    const record = world.quests.records[key("vale")];
    expect(record.completedTurn).toBe(16);
    expect(record.completion).toMatchObject({
      actorId: "vale", locationId: "forest-cottage", participants: ["mara", "vale"], eventSeq: 40, turn: 16,
    });
    expect(JSON.stringify(record.program)).toBe(original);
    expect(createStoryQuestValidator(world)(record)).toBe(true);
    const card = questHistoryCards(world, "vale").find((entry) => entry.key === key("vale"));
    expect(card).toMatchObject({ status: "fulfilled", art: "forest-rati-scarf-vale" });
    expect(card.purpose).toMatch(/^RATi sewed /);
    const saved = JSON.stringify(record), ledger = JSON.stringify(world.questCompletions);
    sync(world);
    expect(JSON.stringify(record)).toBe(saved);
    expect(JSON.stringify(world.questCompletions)).toBe(ledger);
  });

  it("retains delivery credit and the terminal sequence after the log is pruned", () => {
    const world = fresh(); meet(world); finish(world); sync(world);
    const record = JSON.stringify(world.quests.records[key("vale")]);
    const restored = JSON.parse(JSON.stringify(world));
    restored.log = [];
    sync(restored);
    expect(JSON.stringify(restored.quests.records[key("vale")])).toBe(record);
    expect(createStoryQuestValidator(restored)(restored.quests.records[key("vale")])).toBe(true);
  });

  it("rebuilds a missing card from durable completion evidence after conversation pruning", () => {
    const world = fresh(); meet(world); finish(world, "vale", "mara", false); sync(world);
    const record = world.quests.records[key("vale")];
    expect(record.completion).toMatchObject({
      actorId: "vale", participants: ["mara", "vale"],
      locationId: "forest-cottage", turn: 16, eventSeq: 0,
    });
    expect(createStoryQuestValidator(world)(record)).toBe(true);
  });

  it.each(["holder", "name", "purpose", "art", "created", "completed", "giver", "recipient", "site", "sequence", "missing-receipt"])(
    "rejects a changed personal card %s", (field) => {
      const world = fresh(); meet(world); finish(world); sync(world);
      const record = world.quests.records[key("vale")];
      if (field === "holder") record.holder.id = "mara";
      if (field === "name") record.program.name = "Another scarf";
      if (field === "purpose") record.program.purpose = "Another purpose";
      if (field === "art") record.program.art = "forest-rati-button-vale";
      if (field === "created") record.createdTurn++;
      if (field === "completed") record.completedTurn++;
      if (field === "giver") record.completion.participants = ["vale"];
      if (field === "recipient") record.completion.actorId = "mara";
      if (field === "site") record.completion.locationId = "station";
      if (field === "sequence") record.completion.eventSeq = 25;
      if (field === "missing-receipt") delete record.completion;
      expect(createStoryQuestValidator(world)(record)).toBe(false);
    },
  );

  it("preserves each completed legacy forest record and receipt byte for byte", () => {
    const world = fresh({ legacy: true });
    world.packs["lonely-forest"].receipts = { "legacy-start": 1, "legacy-end": 3 };
    world.log = [{ kind: "action", packId: "lonely-forest", choiceId: "legacy-end", actorId: "vale", locationId: "forest-cottage", turn: 3, seq: 8 }];
    sync(world);
    const before = new Map(fixtures.legacyIds.map((id) => [id, JSON.stringify(world.quests.records[`lonely-forest:${id}`])]));
    const ledger = JSON.stringify(world.questCompletions);
    world.log.push({ kind: "action", packId: "lonely-forest", choiceId: "legacy-end", actorId: "mara", locationId: "forest-cottage", turn: 3, seq: 9 });
    meet(world); sync(world, "mara");
    for (const id of fixtures.legacyIds) {
      const record = world.quests.records[`lonely-forest:${id}`];
      expect(JSON.stringify(record)).toBe(before.get(id));
      expect(createStoryQuestValidator(world)(record)).toBe(true);
    }
    expect(JSON.stringify(world.questCompletions)).toBe(ledger);
  });
});
