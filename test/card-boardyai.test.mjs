import { describe, it, expect } from "vitest";
import { dispatchShared } from "../v2/card-game/shared-world.mjs";
import {
  createWorld,
  decodeSave,
  encodeSave,
  nameOf,
  plan,
  validateWorld,
  wantText,
} from "../v2/card-game/world.mjs";
import { CONNECT_TARGET, newWant, wantMet } from "../v2/card-game/want.mjs";
import { wantFact } from "../v2/card-game/want-talk.mjs";
import { narrativeContext } from "../v2/card-game/narrative.mjs";
import { availableCards } from "../v2/card-game/cards.mjs";
import {
  entityActive,
  validatePackDefinition,
} from "../v2/card-game/pack-registry.mjs";
import { enableMotives } from "../v2/card-game/motives.mjs";
import { boardyPack, boardyFacts } from "../v2/card-game/boardyai.mjs";
import { upgradeBoardyStationSave } from "../v2/card-game/legacy-saves.mjs";
import { sceneStaging } from "../v2/card-game/scene.mjs";

const view = (world, present = ["vale", "mara"], actor = "vale") =>
  dispatchShared({
    op: "view",
    world,
    actor,
    claimed: ["vale", "mara", "ash", "nell"],
    present,
  });
const fresh = () =>
  dispatchShared({
    op: "create",
    save: encodeSave(enableMotives(createWorld())),
  }).world;

describe("BoardyAI's presence and home", () => {
  it("appears for two connected humans and keeps his physical place", () => {
    const world = fresh();
    for (const present of [[], ["vale"]])
      expect(entityActive(view(world, present).world, "boardyai")).toBe(false);
    expect(entityActive(view(world).world, "boardyai")).toBe(true);
    expect(view(world).world.actors.boardyai.place).toBe("boardyai-parlour");
    world.actors.vale.place = "boardyai-parlour";
    expect(availableCards(view(world).world)).toContain("boardyai");
  });

  it("keeps the same position and search state across readers and reloads", () => {
    const world = fresh();
    world.actors.boardyai.place = "pond";
    const before = encodeSave(world);
    const a = view(world);
    const b = view(world, ["mara", "vale"], "mara");
    expect(a.world.actors.boardyai).toEqual(b.world.actors.boardyai);
    expect(a.world.actors.boardyai.place).toBe("pond");
    expect(encodeSave(world)).toBe(before);
    expect(view(decodeSave(before)).world.actors.boardyai.place).toBe("pond");
  });

  it("keeps human locations out of his facts until he has seen them", () => {
    const world = fresh();
    world.actors.boardyai.place = "station";
    const context = view(world).world;
    expect(boardyFacts(context, nameOf).join(" ")).toContain(
      "I have yet to find Mara",
    );
    expect(boardyFacts(context, nameOf).join(" ")).not.toContain(
      "Paper theatre",
    );
  });

  it("keeps a guest's carried items with his visible presence", () => {
    const world = fresh();
    world.items.cloth.holder = "boardyai";
    expect(entityActive(view(world).world, "cloth")).toBe(true);
    expect(entityActive(view(world, ["vale"]).world, "cloth")).toBe(false);
  });

  it("opens his home from Empty station with his calling card and keeps the return door", () => {
    let world = fresh();
    world.actors.vale.place = "station";
    const act = (kind, field, value) => {
      const action = view(world).actions.find(
        (a) => a.kind === kind && a[field] === value,
      );
      expect(action).toBeDefined();
      const result = dispatchShared({
        op: "play",
        world,
        actor: "vale",
        claimed: ["vale", "mara"],
        present: ["vale", "mara"],
        action,
      });
      expect(result.ok).toBe(true);
      world = result.world;
    };
    expect(availableCards(view(world).world)).toContain(
      "boardyai-calling-card",
    );
    expect(view(world).exits).toContain("boardyai-parlour");
    world.items["boardyai-calling-card"].holder = "mara";
    expect(view(world).exits).not.toContain("boardyai-parlour");
    world.items["boardyai-calling-card"].holder = "pond";
    expect(view(world).exits).not.toContain("boardyai-parlour");
    world.items["boardyai-calling-card"].holder = "station";
    act("take", "item", "boardyai-calling-card");
    expect(view(world).exits).toContain("boardyai-parlour");
    act("move", "target", "boardyai-parlour");
    expect(world.actors.vale.place).toBe("boardyai-parlour");
    expect(world.items["boardyai-calling-card"].holder).toBe("vale");
    expect(view(decodeSave(encodeSave(world)), ["vale"]).exits).toContain(
      "station",
    );
    act("move", "target", "station");
    expect(world.actors.vale.place).toBe("station");
    expect(view(world).exits).toContain("boardyai-parlour");
    act("move", "target", "pond");
    expect(view(world).exits).not.toContain("boardyai-parlour");
  });

  it("keeps his calling card and parlour door away until two humans connect", () => {
    const local = createWorld({ opening: true });
    local.actors.vale.place = "station";
    expect(entityActive(local, "boardyai-calling-card")).toBe(false);
    expect(availableCards(local)).not.toContain("boardyai-calling-card");
    expect(
      sceneStaging(local, { currentState: true }).floorItems.map((i) => i.id),
    ).not.toContain("boardyai-calling-card");
    const world = fresh();
    world.actors.vale.place = "station";
    const alone = view(world, ["vale"]);
    expect(entityActive(alone.world, "boardyai-calling-card")).toBe(false);
    expect(availableCards(alone.world)).not.toContain("boardyai-calling-card");
    expect(alone.exits).not.toContain("boardyai-parlour");
    expect(
      sceneStaging(alone.world, { currentState: true }).floorItems.map(
        (i) => i.id,
      ),
    ).not.toContain("boardyai-calling-card");
    const pair = view(world);
    expect(entityActive(pair.world, "boardyai-calling-card")).toBe(true);
    expect(
      sceneStaging(pair.world, { currentState: true }).floorItems.map(
        (i) => i.id,
      ),
    ).toContain("boardyai-calling-card");
  });

  it("moves a revision 1 card resting at the pond, with its routes, to the station", () => {
    const world = fresh();
    world.packs.boardyai.revision = 1;
    world.items["boardyai-calling-card"].holder = "pond";
    world.routeKnowledge.vale = [
      ["pond", "boardyai-parlour"],
      ["boardyai-parlour", "pond"],
      ["station", "boardyai-parlour"],
      ["pond", "station"],
    ];
    upgradeBoardyStationSave(world);
    expect(world.packs.boardyai.revision).toBe(2);
    expect(world.items["boardyai-calling-card"].holder).toBe("station");
    expect(world.routeKnowledge.vale).toEqual([
      ["station", "boardyai-parlour"],
      ["boardyai-parlour", "station"],
      ["pond", "station"],
    ]);
    const held = fresh();
    held.packs.boardyai.revision = 1;
    held.items["boardyai-calling-card"].holder = "mara";
    upgradeBoardyStationSave(held);
    expect(held.items["boardyai-calling-card"].holder).toBe("mara");
    const before = structuredClone(world);
    upgradeBoardyStationSave(world);
    expect(world).toEqual(before);
  });

  it("validates his home and bounded human presence conditions", () => {
    expect(validatePackDefinition(boardyPack)).toBe(boardyPack);
    for (const minimum of [0, 9, 1.5, "2"]) {
      const invalid = structuredClone(boardyPack);
      invalid.avatars.boardyai.requires[0].minimum = minimum;
      expect(() => validatePackDefinition(invalid)).toThrow();
    }
    const invalid = structuredClone(boardyPack);
    invalid.avatars.boardyai.place = "missing-home";
    expect(() => validatePackDefinition(invalid)).toThrow();
  });
});

describe("BoardyAI's starter quest: connect people", () => {
  const atParlour = (...ids) => {
    const world = fresh();
    for (const id of ids) world.actors[id].place = "boardyai-parlour";
    return world;
  };
  const play = (world, actor, present, fields) => {
    const action = view(world, present, actor).actions.find((a) =>
      Object.entries(fields).every(([k, v]) => a[k] === v),
    );
    expect(action, JSON.stringify(fields)).toBeDefined();
    const result = dispatchShared({
      op: "play",
      world,
      actor,
      claimed: ["vale", "mara", "ash", "nell"],
      present,
      action,
    });
    expect(result.ok, result.error).toBe(true);
    return result.world;
  };
  const introductions = (world) =>
    world.log.filter((e) => e.verb === "want_met" && e.actorId === "boardyai");

  it("starts with the authored connect quest and says it in one line", () => {
    const world = fresh();
    expect(world.actors.boardyai.want).toEqual(
      newWant("connect", CONNECT_TARGET, 0),
    );
    expect(wantFact(world, "boardyai", nameOf)).toBe(
      "I want to introduce you to someone.",
    );
    expect(wantText(world.actors.boardyai.want)).toBe("introduce two people");
    expect(validateWorld(decodeSave(encodeSave(world)))).toBeTruthy();
  });

  it("tells a guest in Talk while the other human is elsewhere", () => {
    let world = atParlour("vale");
    world.actors.mara.place = "station";
    const action = view(world).actions.find(
      (a) => a.kind === "talk" && a.target === "boardyai",
    );
    world = play(world, "vale", ["vale", "mara"], {
      kind: "talk",
      target: "boardyai",
    });
    expect(introductions(world)).toEqual([]);
    const facts = narrativeContext(view(world).world, action).entities.find(
      (e) => e.id === "boardyai",
    ).facts;
    expect(facts).toContain("I want to introduce you to someone.");
  });

  it("is met by a Talk in his room while two connected humans are there", () => {
    const world = view(atParlour("vale", "mara")).world;
    const talk = { actor: "vale", target: "boardyai" };
    expect(wantMet(world, "boardyai", talk)).toBe(true);
    // Humans talking with each other in his room introduces them too.
    expect(wantMet(world, "boardyai", { actor: "mara", target: "vale" })).toBe(
      true,
    );
    expect(wantMet(world, "boardyai")).toBe(false);
    // One connected human with him is not an introduction.
    const alone = view(atParlour("vale", "mara"), ["vale", "mara"]).world;
    alone.actors.mara.place = "station";
    expect(wantMet(alone, "boardyai", talk)).toBe(false);
    // Two humans in his room who are not both connected are not either.
    const away = view(atParlour("vale", "mara", "ash"), ["vale", "ash"]).world;
    away.actors.ash.place = "station";
    expect(wantMet(away, "boardyai", talk)).toBe(false);
  });

  it("commits the introduction as a world fact with experience, then moves on", () => {
    let world = atParlour("vale", "mara");
    world = play(world, "vale", ["vale", "mara"], {
      kind: "talk",
      target: "boardyai",
    });
    const [event] = introductions(world);
    expect(event.wantMet).toEqual({ kind: "connect", target: "humans" });
    expect(event.text).toBe("BoardyAI makes an introduction at last.");
    expect(world.actors.boardyai.xp).toBe(1);
    expect(world.actors.boardyai.want?.kind).not.toBe("connect");
    const saved = decodeSave(encodeSave(world));
    expect(saved.actors.boardyai).toEqual(world.actors.boardyai);
  });

  it("Talks once two humans share his room, and otherwise goes to one", () => {
    const world = view(atParlour("vale", "mara")).world;
    world.actors.boardyai.lastTalk = -1;
    const both = plan(world, "boardyai");
    expect(both.action).toMatchObject({ kind: "talk" });
    expect(["vale", "mara"]).toContain(both.action.target);
    expect(both.reason).toBe("I want to introduce two people.");
    const apart = view(atParlour("vale")).world;
    apart.actors.mara.place = "station";
    const step = plan(apart, "boardyai");
    expect(step.reason).toBe("I want to introduce two people.");
    expect(step.action?.kind ?? "wait").not.toBe("talk");
  });
});
