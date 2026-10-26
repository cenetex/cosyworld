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
import { humanAvatarIds } from "../v2/card-game/human-cast.mjs";

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
    expect(original).toEqual(world);
  });
  it("moves the selected human and preserves every other human's position", () => {
    const world = shared();
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
