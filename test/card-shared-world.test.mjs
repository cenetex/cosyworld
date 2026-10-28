import { describe, it, expect } from "vitest";
import {
  createWorld,
  play,
  legalActions,
  encodeSave,
  validateWorld,
  reflectionOpen,
  sensesFor,
} from "../v2/card-game/world.mjs";
import { enableMotives } from "../v2/card-game/motives.mjs";
import { dispatchShared } from "../v2/card-game/shared-world.mjs";
import { soundAt } from "../v2/card-game/pack-rules.mjs";
import {
  validCondition,
  questItemAvailable,
} from "../v2/card-game/situations.mjs";
import { generateProgram, alternatives } from "../v2/card-game/quests.mjs";
import { places, things } from "../v2/card-game/world.mjs";
import { humanAvatarIds, humanAvatars } from "../v2/card-game/human-cast.mjs";
import {
  questCards,
  questHand,
  questCardId,
} from "../v2/card-game/quest-cards.mjs";
import { availableCards } from "../v2/card-game/cards.mjs";

const shared = () =>
  dispatchShared({
    op: "create",
    save: encodeSave(
      enableMotives(createWorld(), {
        questPrograms: true,
        personalQuests: true,
      }),
    ),
  }).world;
const ask = (world, op, actor = "vale", extra = {}) =>
  dispatchShared({
    world,
    op,
    actor,
    claimed: humanAvatarIds,
    present: humanAvatarIds,
    ...extra,
  });

describe("the full world shared by human avatars", () => {
  it("matches selected item cards while personal and shared quest actions are offered", () => {
    let world = dispatchShared({ op: "create" }).world;
    for (const [kind, target] of [
      ["light", null],
      ["move", "pond"],
    ]) {
      const action = ask(world, "view").actions.find(
        (a) => a.kind === kind && (!target || a.target === target),
      );
      world = ask(world, "play", "vale", { action }).world;
    }
    world.items.cloth.holder = "vale";
    const actions = ask(world, "view").actions;
    for (const kind of ["pursue", "share-quest", "join-quest"])
      expect(actions.some((a) => a.kind === kind && !a.cards)).toBe(true);
    const cover = actions.find((a) => a.kind === "cover");
    expect(cover).toBeDefined();
    const selected = ask(world, "play", "vale", {
      selectedIds: ["vale", "cloth", "lamp", "cloth"],
    });
    const explicit = ask(world, "play", "vale", { action: cover });
    expect(selected.ok).toBe(true);
    expect(selected.world).toEqual(explicit.world);
    expect(selected.world.items.cloth.holder).toBe("lamp");
    const invalid = ask(world, "play", "vale", {
      selectedIds: ["cloth", "lamp", "pond"],
    });
    expect(invalid.ok).toBe(false);
    expect(invalid.world.revision).toBe(world.revision);
    expect(invalid.world.items.cloth.holder).toBe("vale");
  });
  it.each(humanAvatars.filter((a) => a.id !== "vale"))(
    "$name starts with an item on the floor and opens the home path by carrying it",
    (avatar) => {
      const destination = avatar.home.connection || "pond";
      let world = shared();
      let view = ask(world, "view", avatar.id);
      expect(world.items[avatar.item.id].holder).toBe(avatar.home.id);
      expect(availableCards(view.world)).toContain(avatar.item.id);
      expect(availableCards(view.world)).not.toContain(destination);
      expect(view.exits).not.toContain(destination);
      const take = view.actions.find(
        (a) => a.kind === "take" && a.item === avatar.item.id,
      );
      world = ask(world, "play", avatar.id, { action: take }).world;
      view = ask(world, "view", avatar.id);
      expect(availableCards(view.world)).toContain(destination);
      const move = view.actions.find(
        (a) => a.kind === "move" && a.target === destination,
      );
      expect(move).toBeDefined();
      const drop = view.actions.find(
        (a) => a.kind === "drop" && a.item === avatar.item.id,
      );
      world = ask(world, "play", avatar.id, { action: drop }).world;
      view = ask(JSON.parse(encodeSave(world)), "view", avatar.id);
      expect(world.items[avatar.item.id].holder).toBe(avatar.home.id);
      expect(availableCards(view.world)).not.toContain(destination);
      expect(view.exits).not.toContain(destination);
      expect(ask(world, "play", avatar.id, { action: move }).ok).toBe(false);
    },
  );
  it("places unused home items on the floor when an earlier local save is shared", () => {
    const old = createWorld();
    for (const avatar of humanAvatars.filter((a) => a.id !== "vale"))
      old.items[avatar.item.id].holder = avatar.id;
    const world = dispatchShared({ op: "create", save: encodeSave(old) }).world;
    for (const avatar of humanAvatars.filter((a) => a.id !== "vale"))
      expect(world.items[avatar.item.id].holder).toBe(avatar.home.id);
  });
  it("upgrades unused homes while preserving claimed avatars and existing item history", () => {
    const old = shared();
    for (const avatar of humanAvatars.filter((a) => a.id !== "vale"))
      old.items[avatar.item.id].holder = avatar.id;
    const result = ask(old, "upgrade", "vale", {
      from: "full-card-world/2",
      claimed: ["vale", "mara"],
      present: ["vale", "mara"],
    });
    expect(result.world.items.mask.holder).toBe("mara");
    expect(
      result.world.items[humanAvatars.find((a) => a.id === "ash").item.id]
        .holder,
    ).toBe(humanAvatars.find((a) => a.id === "ash").home.id);
    expect(result.world.turn).toBe(old.turn);
    expect(result.world.revision).toBe(old.revision + 1);
    expect(result.world.log).toEqual(old.log);
    expect(result.world.actors).toEqual({
      ...old.actors,
      boardyai: { ...old.actors.boardyai, place: old.actors.vale.place },
    });
  });
  it("imports the exact opening, fuel, progress, memory and life state", () => {
    let world = enableMotives(createWorld({ opening: true }), {
      questPrograms: true,
      personalQuests: true,
    });
    world = play(
      world,
      legalActions(world).find((a) => a.kind === "light"),
    ).state;
    world = play(
      world,
      legalActions(world).find((a) => a.kind === "move" && a.target === "pond"),
    ).state;
    expect(world.actors.vale.place).toBe("pond");
    const imported = dispatchShared({
      op: "create",
      save: encodeSave(world),
    }).world;
    const { sharedVersion, ...original } = imported;
    expect(sharedVersion).toBe(1);
    for (const avatar of humanAvatars.filter((a) => a.id !== "vale"))
      world.items[avatar.item.id].holder = avatar.home.id;
    expect(original).toEqual(world);
  });
  it("moves the selected human and preserves every other human's position", () => {
    const world = shared();
    world.items.mask.holder = "mara";
    const before = Object.fromEntries(
      humanAvatarIds.map((id) => [id, world.actors[id].place]),
    );
    const view = ask(world, "view", "mara");
    const result = ask(world, "play", "mara", {
      action: view.actions.find(
        (a) => a.kind === "move" && a.target === "pond",
      ),
    });
    expect(result.ok).toBe(true);
    expect(result.world.actors.mara.place).toBe("pond");
    for (const id of humanAvatarIds.filter((id) => id !== "mara"))
      expect(result.world.actors[id].place).toBe(before[id]);
    validateWorld(result.world);
  });
  it("hides full human rooms and rejects queued travel after the fourth arrival", () => {
    const world = shared();
    world.items.mask.holder = "mara";
    for (const id of ["vale", "ash", "nell", "tavi"])
      world.actors[id].place = "pond";
    const view = ask(world, "view", "mara");
    expect(view.exits).not.toContain("pond");
    expect(
      view.actions.some((a) => a.kind === "move" && a.target === "pond"),
    ).toBe(false);
    expect(
      ask(world, "play", "mara", { action: { key: "move:mara::pond" } }).ok,
    ).toBe(false);
    expect(
      ask(world, "view", "mara", {
        present: humanAvatarIds.filter((id) => id !== "tavi"),
      }).exits,
    ).toContain("pond");
  });
  it("opens a home through a nearby belonging and closes it when its carrier leaves", () => {
    const world = shared();
    world.items.mask.holder = "mara";
    world.actors.vale.place = "pond";
    world.actors.mara.place = "pond";
    expect(ask(world, "view").exits).toContain("theatre");
    const present = humanAvatarIds.filter((id) => id !== "mara");
    expect(ask(world, "view", "vale", { present }).exits).not.toContain(
      "theatre",
    );
    world.items.mask.holder = "pond";
    expect(ask(world, "view", "vale", { present }).exits).toContain("theatre");
  });
  it("records a two-line exchange after its human leaves, with shared sequence IDs", () => {
    const world = shared();
    world.actors.mara.place = "pond";
    const result = ask(world, "speech", "mara", {
      present: ["vale"],
      room: "pond",
      lines: [
        {
          actorId: "mara",
          entityId: "mara",
          speaker: "Mara",
          text: "The stage can wait.",
        },
        {
          actorId: null,
          entityId: "pond",
          speaker: "Black pond",
          text: "A pale ripple reaches the shore.",
        },
      ],
    });
    expect(result.lines.map((l) => l.kind)).toEqual(["dialogue", "narration"]);
    expect(result.lines[1].seq).toBe(result.lines[0].seq + 1);
    expect(result.world.log.slice(-2)).toEqual(result.lines);
  });
  it("restores reordered JSON keys through the server bridge", () => {
    const reorder = (value) =>
      Array.isArray(value)
        ? value.map(reorder)
        : value && typeof value === "object"
          ? Object.fromEntries(
              Object.keys(value)
                .sort()
                .map((key) => [key, reorder(value[key])]),
            )
          : value;
    let world = shared();
    for (let i = 0; i < 16; i++) {
      const actor = humanAvatarIds[i % humanAvatarIds.length];
      const view = ask(reorder(world), "view", actor);
      const action =
        view.actions.find((a) => a.kind === "move") || view.actions[0];
      const result = ask(reorder(world), "play", actor, { action });
      expect(result.ok).toBe(true);
      world = result.world;
    }
    expect(ask(reorder(world), "validate").ok).toBe(true);
  });
  it("applies light and sound presence to carried objects while floor and NPC objects remain", () => {
    const world = shared();
    world.actors.vale.place = "pond";
    world.items.lamp.holder = "vale";
    world.items.lamp.lit = true;
    world.items.bell.holder = "vale";
    world.items.bell.ringing = 3;
    world.items.oil.holder = "station";
    world.actors.mara.place = "pond";
    let visible = ask(world, "view", "mara", { present: ["mara"] }).world;
    expect(reflectionOpen(visible, "pond")).toBe(false);
    expect(soundAt(visible, "pond", sensesFor(visible))).toBe(false);
    visible = ask(world, "view", "mara", { present: ["mara", "vale"] }).world;
    expect(reflectionOpen(visible, "pond")).toBe(true);
    expect(soundAt(visible, "pond", sensesFor(visible))).toBe(true);
    for (const holder of ["pond", "moth"]) {
      world.items.lamp.holder = holder;
      world.items.bell.holder = holder;
      world.actors.moth.place = "pond";
      visible = ask(world, "view", "mara", { present: ["mara"] }).world;
      expect(reflectionOpen(visible, "pond")).toBe(true);
      expect(soundAt(visible, "pond", sensesFor(visible))).toBe(true);
    }
  });
  it("keeps absent humans and their belongings out of plays and new quest candidates", () => {
    const world = shared();
    world.items.mask.holder = "mara";
    world.actors.mara.place = "pond";
    world.actors.vale.place = "pond";
    const view = ask(world, "view", "vale", { present: ["vale"] });
    expect(
      view.actions.some(
        (a) => a.cards.includes("mara") || a.cards.includes("mask"),
      ),
    ).toBe(false);
    expect(questItemAvailable(view.world, "vale", "mask")).toBe(false);
    const program = generateProgram(view.world, "vale", places, things);
    expect(
      program.steps
        .flatMap(alternatives)
        .some((h) => h.items.includes("mask") || h.avatars.includes("mara")),
    ).toBe(false);
    const all = ask(world, "view").world;
    for (const npc of ["moth", "keeper"]) {
      const actions = legalActions(all, npc);
      expect(
        actions.some(
          (a) => a.kind === "accompany" && humanAvatarIds.includes(a.target),
        ),
      ).toBe(false);
      expect(actions.some((a) => a.kind === "take" && a.item === "mask")).toBe(
        false,
      );
    }
    expect(
      validCondition({ kind: "heldBy", item: "mask", avatar: "mara" }, "vale"),
    ).toBe(true);
    expect(
      validCondition(
        { kind: "heldBy", item: "unknown", avatar: "mara" },
        "vale",
      ),
    ).toBe(false);
  });
  it("rejects actor impersonation and extra actor keys before play", () => {
    const world = shared();
    world.items.mask.holder = "mara";
    expect(() => ask(world, "view", "__proto__")).toThrow();
    expect(() =>
      ask(world, "view", "vale", { claimed: ["vale", "constructor"] }),
    ).toThrow();
    const mara = ask(world, "view", "mara");
    const foreign = mara.actions.find((a) => a.kind === "move");
    expect(ask(world, "play", "vale", { action: foreign }).ok).toBe(false);
    const extra = JSON.parse(JSON.stringify(world));
    Object.defineProperty(extra.actors, "__proto__", {
      value: structuredClone(extra.actors.vale),
      enumerable: true,
    });
    expect(() => ask(extra, "validate")).toThrow();
    const own = ask(world, "view", "vale").actions[0];
    const result = ask(world, "play", "vale", {
      action: { ...own, actor: "mara", target: "theatre" },
    });
    expect(result.ok).toBe(true);
    expect(result.world.actors.mara.place).toBe(world.actors.mara.place);
  });
  it("migrates older carried belongings, lamp state and room dialogue", () => {
    const legacy = {
      version: 1,
      claimed: Array(8).fill(1),
      present: [1, 0, 0, 0, 0, 0, 0, 0],
      places: [0, 2, 3, 4, 5, 6, 7, 8],
      holders: Array(8).fill(0),
      uses: [3, 0, 0, 0, 0, 0, 0, 0],
      turn: 40,
    };
    const scene = {
      play: "legacy-scene-1",
      actor: 0,
      room: 0,
      turn: 32,
      starts_at: 1000,
      until_at: 8000,
      lines: [
        { speaker: "Vale", text: "Keep this light close." },
        { speaker: "Black pond", text: "A ripple catches the glow." },
      ],
    };
    const result = dispatchShared({
      op: "migrate",
      legacy,
      legacyScenes: [scene],
    });
    expect(result.world.items.lamp.lit).toBe(true);
    expect(result.world.items.lamp.fuel).toBeGreaterThan(0);
    expect(result.world.sharedMigration.inventoryAllowances).toEqual({
      vale: 8,
    });
    expect(result.world.sharedMigration.uses).toEqual(legacy.uses);
    expect(result.legacyScenes[0]).toMatchObject({
      play: scene.play,
      room: "pond",
      actor: "vale",
      starts_at: 1000,
      until_at: 8000,
    });
    expect(
      result.legacyScenes[0].lines.map(({ speaker, text }) => ({
        speaker,
        text,
      })),
    ).toEqual(scene.lines);
    expect(
      result.legacyScenes[0].lines.every((line) =>
        result.world.log.some(
          (e) => e.seq === line.seq && e.text === line.text,
        ),
      ),
    ).toBe(true);
    let world = result.world;
    for (let count = 8; count > 3; count--) {
      const view = ask(world, "view", "vale", { present: ["vale"] });
      expect(view.actions.some((a) => a.kind === "take")).toBe(false);
      world = ask(world, "play", "vale", {
        present: ["vale"],
        action: view.actions.find((a) => a.kind === "drop"),
      }).world;
      expect(world.sharedMigration.inventoryAllowances.vale).toBe(
        count > 4 ? count - 1 : undefined,
      );
    }
    const dark = dispatchShared({
      op: "migrate",
      legacy: { ...legacy, uses: [2, 0, 0, 0, 0, 0, 0, 0] },
    });
    expect(dark.world.items.lamp.lit).toBe(false);
    expect(() =>
      dispatchShared({
        op: "migrate",
        legacy,
        legacyScenes: Array(81).fill(scene),
      }),
    ).toThrow();
  });
  it("accepts migration allowances only from server migration, with exact bounded counts", () => {
    const legacy = {
      version: 1,
      claimed: Array(8).fill(1),
      present: [1, 0, 0, 0, 0, 0, 0, 0],
      places: [0, 2, 3, 4, 5, 6, 7, 8],
      holders: Array(8).fill(0),
      uses: Array(8).fill(0),
      turn: 40,
    };
    const result = dispatchShared({ op: "migrate", legacy });
    expect(() =>
      dispatchShared({ op: "create", save: JSON.stringify(result.world) }),
    ).toThrow();
    for (const allowance of [
      { vale: 9 },
      { vale: 7 },
      { moth: 8 },
      { vale: 3 },
    ]) {
      const tampered = structuredClone(result.world);
      tampered.sharedMigration.inventoryAllowances = allowance;
      expect(() => ask(tampered, "validate")).toThrow();
    }
    const imported = shared();
    imported.controlledActors = ["constructor"];
    imported.presentActors = ["constructor"];
    imported.claimed = Array(8).fill(1);
    imported.present = Array(8).fill(1);
    imported.sharedMigration = { version: 1, inventoryAllowances: { vale: 8 } };
    const clean = dispatchShared({
      op: "create",
      save: JSON.stringify(imported),
    }).world;
    for (const field of [
      "controlledActors",
      "presentActors",
      "claimed",
      "present",
      "sharedMigration",
    ])
      expect(clean[field]).toBeUndefined();
  });
  it("reserves an avatar before entering a full room", () => {
    const world = shared();
    for (const id of ["vale", "mara", "ash", "nell", "tavi"])
      world.actors[id].place = "pond";
    const joined = ask(world, "join", "mara", {
      claimed: ["vale", "ash", "nell", "tavi"],
      present: ["vale", "ash", "nell", "tavi"],
    });
    expect(joined.ok).toBe(true);
    expect(joined.world.actors.mara.place).toBe("pond");
  });
});

it.each(["mara", "rue"])(
  "places %s first among avatars with their items and quests together",
  (actor) => {
    const world = shared();
    for (const id of ["vale", "mara", "rue"])
      world.actors[id].place = "station";
    const item = humanAvatars.find((a) => a.id === actor).item.id;
    world.items[item].holder = actor;
    world.items.lamp.holder = actor;
    world.items.cloth.holder = "lamp";
    world.items.oil.holder = "station";
    const view = ask(world, "view", actor).world;
    const cards = availableCards(view),
      hand = questHand(view);
    expect(cards[0]).toBe(actor);
    expect(cards.indexOf("oil")).toBeGreaterThan(cards.indexOf(actor));
    expect(cards.indexOf(actor)).toBeLessThan(cards.indexOf("vale"));
    const start = hand.indexOf(actor);
    expect(hand.slice(start, start + 4)).toEqual([
      actor,
      item,
      "lamp",
      "cloth",
    ]);
    const quests = questCards(view, actor).map((q) => questCardId(view, q));
    expect(quests.length).toBeGreaterThan(0);
    expect(hand.slice(start + 4, start + 4 + quests.length)).toEqual(quests);
  },
);

it("connects Rue's carriage to the station through pickup, drop, travel and reload", () => {
  let world = shared();
  const act = (kind, target, item) => {
    const view = ask(world, "view", "rue");
    const action = view.actions.find(
      (a) =>
        a.kind === kind &&
        (!target || a.target === target) &&
        (!item || a.item === item),
    );
    expect(action).toBeDefined();
    const result = ask(world, "play", "rue", { action });
    expect(result.ok, result.error).toBe(true);
    world = JSON.parse(encodeSave(result.world));
    return action;
  };
  act("take", null, "routes");
  let view = ask(world, "view", "rue");
  expect(view.exits).toContain("station");
  expect(view.exits).not.toContain("pond");
  const earlier = view.actions.find(
    (a) => a.kind === "move" && a.target === "station",
  );
  act("drop", "train", "routes");
  expect(ask(world, "play", "rue", { action: earlier }).ok).toBe(false);
  act("take", null, "routes");
  act("move", "station");
  expect(world.actors.rue.place).toBe("station");
  expect(ask(world, "view", "rue").exits).toContain("train");
  act("drop", "station", "routes");
  act("move", "train");
  expect(ask(world, "view", "rue").exits).toContain("station");
  expect(Object.keys(world.crossings)).toEqual(
    expect.arrayContaining(["pond-train", "train-pond"]),
  );
});
