import { describe, expect, it } from "vitest";
import { dispatchShared } from "../v2/card-game/shared-world.mjs";
import { entityActive, hub } from "../v2/card-game/pack-registry.mjs";
import { packProblems } from "../v2/card-game/pack-schema.mjs";
import compiled from "../v2/card-game/packs.json" with { type: "json" };
import { hidingPlaces } from "../v2/card-game/hidden-avatar.mjs";
import { questsOf } from "../v2/card-game/want.mjs";
import { legalActions, validateWorld } from "../v2/card-game/world.mjs";

const locked = ["rue", "ash", "tavi", "nell", "orin", "ada"];
const create = (seed = 7, extra = {}) =>
  dispatchShared({
    op: "create",
    seed,
    hidden: "mara",
    absent: locked,
    ...extra,
  }).world;
const ask = (world, op, actor = "vale", claimed = ["vale"], extra = {}) =>
  dispatchShared({ world, op, actor, claimed, present: claimed, ...extra });
const seated = (world) => ({
  ...world,
  controlledActors: ["vale"],
  presentActors: ["vale"],
});
// Vale walks straight to Mara, past the waking opening.
const talk = (world) => {
  delete world.opening;
  world.actors.vale.place = world.actors.mara.place;
  const action = legalActions(seated(world), "vale").find(
    (a) => a.kind === "talk" && a.target === "mara",
  );
  return ask(world, "play", "vale", ["vale"], { action });
};

describe("one hidden avatar per world (#1936)", () => {
  it("puts the host's pick in a seeded hiding place with a want", () => {
    const world = create();
    expect(world.hidden).toEqual({
      actor: "mara",
      place: world.actors.mara.place,
      met: [],
    });
    expect(hidingPlaces(world)).toContain(world.hidden.place);
    expect(world.actors.mara.want).toBeTruthy();
    expect(entityActive(seated(world), "mara")).toBe(true);
    // The same seed hides in the same place; seeds spread over the pool.
    expect(create().hidden).toEqual(world.hidden);
    const spots = new Set(
      [1, 2, 3, 4, 5, 6, 8, 9].map((seed) => create(seed).hidden.place),
    );
    expect(spots.size).toBeGreaterThan(2);
  });

  it("leaves the other locked avatars out until someone claims one", () => {
    const world = create();
    expect(world.absent).toEqual([...locked].sort());
    expect(entityActive(seated(world), "rue")).toBe(false);
    expect(world.actors.rue.want ?? null).toBe(null);
    const joined = ask(world, "join", "rue", ["vale", "rue"]).world;
    expect(joined.absent).not.toContain("rue");
    expect(() => validateWorld(joined)).not.toThrow();
  });

  it("refuses a pick that hides Vale or names an avatar twice", () => {
    expect(() => create(7, { hidden: "vale" })).toThrow(/hides/);
    expect(() => create(7, { absent: ["mara"] })).toThrow(/hides/);
  });

  it("unlocks on the first Talk and never again", () => {
    const first = talk(create());
    expect(first.error).toBeUndefined();
    const unlocks = (events) => events.filter((e) => e.unlock);
    expect(unlocks(first.events)).toEqual([
      expect.objectContaining({ unlock: "mara", actorId: "vale" }),
    ]);
    expect(first.world.hidden.met).toEqual(["vale"]);
    const again = talk(first.world);
    expect(again.ok).toBe(true);
    expect(unlocks(again.events)).toEqual([]);
  });

  it("replays the same unlock from the same journal", () => {
    expect(talk(create()).world).toEqual(talk(create()).world);
  });

  it("gives the player the quest to talk to the hidden avatar", () => {
    const sought = ask(create(), "seek").world;
    expect(questsOf(sought, "vale")[0]).toMatchObject({
      kind: "person",
      target: "mara",
    });
    // Asking twice keeps one quest; talking meets it.
    const twice = ask(sought, "seek").world;
    expect(
      questsOf(twice, "vale").filter((w) => w.target === "mara"),
    ).toHaveLength(1);
    const met = talk(twice).world;
    expect(questsOf(met, "vale").some((w) => w.target === "mara")).toBe(false);
    expect(() => ask(met, "seek")).toThrow(/Nobody/);
  });

  it("creates a plain world when the host hides nobody", () => {
    const world = dispatchShared({ op: "create", seed: 7 }).world;
    expect(world.hidden).toBeUndefined();
    expect(world.absent).toBeUndefined();
  });

  it("checks each pack's hiding places", () => {
    const forest = compiled.packs.find((p) => p.id === "lonely-forest");
    expect(packProblems(forest, hub)).toEqual([]);
    for (const pool of [
      [{ id: "attic", depth: "plain" }],
      [{ id: "forest-oak", depth: "deep" }],
      [],
    ])
      expect(packProblems({ ...forest, hiding: { pool } }, hub)).toContain(
        "hiding needs a pool of the pack's own undrawn places",
      );
  });
});
