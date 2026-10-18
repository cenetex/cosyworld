import { describe, it, expect } from "vitest";
import {
  createWorld,
  legalActions,
  play,
  standoffFor,
  encodeSave,
  decodeSave,
  validateWorld,
  plan,
} from "../v2/card-game/world.mjs";
import { avatarPlays, cardPlay } from "../v2/card-game/cards.mjs";
import { narrativeContext } from "../v2/card-game/narrative.mjs";
import { levelOf, hand, hold, at } from "../v2/card-game/quests.mjs";

const act = (s, kind, target, item) => {
  const action = legalActions(s).find(
    (a) =>
      a.kind === kind &&
      (!target || a.target === target) &&
      (!item || a.item === item),
  );
  expect(action, `${kind} ${target || ""}`).toBeTruthy();
  const result = play(s, action);
  expect(result.ok).toBe(true);
  return result.state;
};
const meeting = () => {
  const s = createWorld();
  s.actors.moth.place = "station";
  s.actors.keeper.place = "pond";
  s.items.lamp.holder = "moth";
  s.items.bell.holder = "keeper";
  return s;
};

describe("card standoffs", () => {
  it("opens combat with a threat and keeps dialogue and item plays available", () => {
    let s = meeting();
    expect(avatarPlays(s, "moth").map((a) => a.kind)).toEqual([
      "talk",
      "threaten",
    ]);
    expect(legalActions(s).some((a) => a.kind === "attack")).toBe(false);
    expect(play(s, { key: "attack:vale::moth" }).ok).toBe(false);
    s = act(s, "threaten", "moth");
    expect(standoffFor(s, "vale")).toMatchObject({
      challenger: "vale",
      defender: "moth",
      item: "lamp",
      resolve: { vale: 4, moth: 4 },
      guarding: { moth: true },
    });
    expect(avatarPlays(s, "moth").map((a) => a.kind)).toEqual([
      "talk",
      "guard",
      "attack",
    ]);
    expect(cardPlay(s, ["moth"]).action.kind).toBe("talk");
    expect(cardPlay(s, ["lamp"]).action.kind).toBe("ask");
    expect(legalActions(s).some((a) => a.kind === "move")).toBe(true);
    expect(s.log.some((e) => e.verb === "attack")).toBe(false);
  });
  it("lets an avatar ignore a threat and continue with its goal", () => {
    let s = meeting();
    // Keeper still needs the cloth at the station, so its reply leaves the standoff open.
    s.actors.keeper.place = "station";
    s.turn = s.revision = 3;
    s.actors.keeper.progress = { program: 1, step: 0, marks: [1, 2] };
    s = act(s, "threaten", "keeper");
    expect(s.log.some((e) => e.verb === "talk" && e.actorId === "keeper")).toBe(
      true,
    );
    expect(standoffFor(s, "vale").resolve).toEqual({ vale: 4, keeper: 4 });
    s = act(s, "talk", "keeper");
    expect(s.log.filter((e) => e.verb === "attack")).toHaveLength(0);
  });
  it("applies guarded damage, retaliation, item release and retreat", () => {
    let s = act(meeting(), "threaten", "moth");
    s = act(s, "attack", "moth");
    expect(standoffFor(s, "vale").resolve).toEqual({ vale: 2, moth: 3 });
    // Guard reduces Pip's two damage to one and lasts for one reply.
    s = act(s, "guard", "moth");
    expect(standoffFor(s, "vale").resolve.vale).toBe(1);
    s = act(s, "attack", "moth");
    expect(standoffFor(s, "vale")).toBeUndefined();
    expect(s.actors.vale.place).toBe("attic");
    expect(levelOf(s, "vale")).toBe(1);
    expect(s.peaceUntil.vale).toBe(s.turn + 3);
  });
  it("settles an item demand through a trade while combat is open", () => {
    let s = createWorld();
    s.actors.moth.place = "station";
    s.items.lamp.holder = "vale";
    s = act(s, "threaten", "moth");
    const trade = cardPlay(s, ["lamp", "cloth"]).action;
    expect(trade.kind).toBe("trade");
    s = play(s, trade).state;
    expect(s.items.cloth.holder).toBe("vale");
    expect(s.standoffs).toEqual([]);
    expect(s.log.some((e) => e.verb === "attack")).toBe(false);
  });
  it("ends a standoff when either avatar travels and keeps items with their owner", () => {
    let s = act(meeting(), "threaten", "moth");
    s = act(s, "move", "attic");
    expect(s.standoffs).toEqual([]);
    expect(s.items.lamp.holder).toBe("moth");
  });
  it("preserves a standoff through saves, rejects stale plays and validates combat fields", () => {
    const s = act(meeting(), "threaten", "moth");
    const restored = decodeSave(encodeSave(s));
    expect(act(restored, "attack", "moth")).toEqual(act(s, "attack", "moth"));
    const attack = legalActions(s).find((a) => a.kind === "attack");
    expect(play(s, attack, s.revision - 1).ok).toBe(false);
    const departed = act(s, "move", "attic");
    expect(play(departed, attack).ok).toBe(false);
    for (const patch of [
      { resolve: { vale: 99, moth: 4 } },
      { guarding: { vale: false, moth: "yes" } },
      { defender: "vale" },
      { opened: 99 },
      { location: "pond" },
      { item: "oil" },
    ]) {
      const broken = structuredClone(s);
      Object.assign(broken.standoffs[0], patch);
      expect(() => validateWorld(broken)).toThrow();
    }
    const old = meeting();
    old.schema = 4;
    delete old.standoffs;
    delete old.peaceUntil;
    const migrated = decodeSave(JSON.stringify(old));
    expect(migrated.schema).toBe(5);
    expect(migrated.items).toEqual(old.items);
    expect(migrated.standoffs).toEqual([]);
  });
  it("breaks a repeated cast impasse through a threat, combat and a released item", () => {
    const old = meeting();
    old.schema = 2;
    old.turn = old.revision = 8;
    for (const [id, actor] of Object.entries(old.actors)) {
      actor.place = "station";
      actor.progress = {
        program: 2,
        step: 0,
        marks: Array.from({ length: id === "vale" ? 5 : 4 }, (_, i) => i + 1),
      };
    }
    old.items.oil.holder = "keeper";
    let s = decodeSave(JSON.stringify(old));
    s.actors.moth.progress.current.steps = [
      hand(hold("lamp", "oil"), at("attic")),
    ];
    s.actors.keeper.progress.current.steps = [
      hand(hold("lamp", "oil"), at("pond")),
    ];
    expect(plan(s, "moth").action.kind).toBe("ask");
    let seenThreat = false,
      seenAttack = false,
      released = false;
    for (let i = 0; i < 12; i++) {
      s = act(s, "wait");
      seenThreat ||= s.log.some(
        (e) => e.verb === "threaten" && ["moth", "keeper"].includes(e.actorId),
      );
      seenAttack ||= s.log.some((e) => e.verb === "attack");
      released ||= s.log.some(
        (e) => e.verb === "attack" && e.text.includes("drops the"),
      );
      expect(() => validateWorld(s)).not.toThrow();
    }
    expect(seenThreat).toBe(true);
    expect(seenAttack).toBe(true);
    expect(released).toBe(true);
  });
  it("lets the winning avatar collect the released item as a card play", () => {
    let s = meeting();
    s.turn = s.revision = 3;
    s.actors.vale.progress = { program: 1, step: 0, marks: [1, 2, 3] };
    s = act(s, "threaten", "moth");
    s = act(s, "attack", "moth");
    s = act(s, "attack", "moth");
    expect(s.items.lamp.holder).toBe("station");
    expect(s.items.cloth.holder).toBe("moth");
    expect(s.actors.moth.place).toBe("attic");
    expect(s.standoffs).toEqual([]);
    expect(levelOf(s, "vale")).toBe(2);
    s = act(s, "take", null, "lamp");
    expect(s.items.lamp.holder).toBe("vale");
  });
  it("carries the threat, guard and combat facts into each witness's model context", () => {
    const s = act(meeting(), "threaten", "moth");
    const context = narrativeContext(s, { target: "moth" });
    expect(context.speakers).toEqual(["vale", "moth"]);
    for (const id of ["vale", "moth", "lamp", "station"])
      expect(
        s.memories[id].events.some((e) => e.text.includes("threatens")),
      ).toBe(true);
    const moth = context.entities.find((e) => e.id === "moth");
    expect(moth.facts.join(" ")).toContain("resolve 4/4; guarding");
    expect(
      context.entities.every(
        (e) => e.facts.length <= 8 && e.facts.every((f) => f.length <= 240),
      ),
    ).toBe(true);
  });
});
