import { describe, it, expect } from "vitest";
import {
  createWorld,
  play,
  legalActions,
  encodeSave,
  validateWorld,
} from "../v2/card-game/world.mjs";
import { enableMotives } from "../v2/card-game/motives.mjs";
import { dispatchShared } from "../v2/card-game/shared-world.mjs";
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
