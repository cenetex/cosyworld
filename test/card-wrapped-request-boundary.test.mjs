import { describe, it, expect } from "vitest";
import {
  createWorld,
  validateWorld,
  legalActions,
  play,
  itemPlace,
  rootHolder,
} from "../v2/card-game/world.mjs";
import { enableMotives } from "../v2/card-game/motives.mjs";
import { availableCards, cardActions } from "../v2/card-game/cards.mjs";
import { entityActive } from "../v2/card-game/pack-registry.mjs";

function wrapped(container = "bell", trusted = true) {
  const s = enableMotives(createWorld(), { personalQuests: true });
  s.actors.vale.place = s.actors.keeper.place = "station";
  s.actors.moth.place = "pond";
  s.items[container].holder = "keeper";
  s.items.cloth.holder = container;
  if (trusted) s.actors.keeper.trust.vale = 1;
  validateWorld(s);
  return s;
}
function find(s, item = "cloth", target = "keeper") {
  return legalActions(s).find(
    (a) => a.kind === "ask" && a.item === item && a.target === target,
  );
}
function act(s, kind, fields = {}) {
  const a = legalActions(s).find(
    (a) =>
      a.kind === kind && Object.entries(fields).every(([k, v]) => a[k] === v),
  );
  expect(a).toBeTruthy();
  const r = play(s, a);
  expect(r.ok).toBe(true);
  return r.state;
}

describe("asking for wrapped cloth", () => {
  it.each(["bell", "lamp"])(
    "transfers only the cloth from the owner’s %s with agreement",
    (container) => {
      const s = wrapped(container);
      const action = find(s);
      expect(action).toBeTruthy();
      expect(availableCards(s)).toContain("cloth");
      expect(
        cardActions(s, ["cloth", "keeper"]).actions.map((a) => a.key),
      ).toContain(action.key);
      const result = play(s, action);
      expect(result.ok).toBe(true);
      expect(result.state.items.cloth.holder).toBe("vale");
      expect(result.state.items[container].holder).toBe("keeper");
      expect(
        result.state.log.findLast(
          (e) =>
            e.actorId === "vale" && e.verb === "ask" && e.itemId === "cloth",
        ).accepted,
      ).toBe(true);
    },
  );
  it.each(["bell", "lamp"])(
    "respects refusal and preserves both objects on the owner’s %s",
    (container) => {
      const s = wrapped(container, false);
      const action = find(s);
      expect(action).toBeTruthy();
      const result = play(s, action);
      expect(result.ok).toBe(true);
      expect(rootHolder(result.state, "cloth")).toBe("keeper");
      expect(result.state.items[container].holder).toBe("keeper");
      expect(
        result.state.log.findLast(
          (e) =>
            e.actorId === "vale" && e.verb === "ask" && e.itemId === "cloth",
        ).accepted,
      ).toBe(false);
    },
  );
  it("does not offer the request when the asker has no carrying space", () => {
    const s = wrapped("bell");
    for (const id of ["lamp", "oil", "hoppycat-red-thread-spool"])
      s.items[id].holder = "vale";
    validateWorld(s);
    expect(find(s)).toBeUndefined();
    expect(
      cardActions(s, ["cloth", "keeper"]).actions.some(
        (a) => a.kind === "ask" && a.item === "cloth",
      ),
    ).toBe(false);
  });
  it("rejects a previously offered request after custody changes", () => {
    const s = wrapped("bell");
    const stale = find(s);
    expect(stale).toBeTruthy();
    s.items.bell.holder = "station";
    const before = structuredClone(s);
    const result = play(s, stale);
    expect(result.ok).toBe(false);
    expect(result.state).toEqual(before);
  });
  it("keeps the consumed button hidden inside the scarf", () => {
    let s = createWorld();
    s.actors.vale.place = "attic";
    s.items.cloth.holder = "attic";
    s = act(s, "move", { target: "forest-cottage" });
    const record =
      s.packs["lonely-forest"].personalQuests["forest-rati-scarf"].records.vale;
    const button = record.button.id,
      scarf = record.reward.id;
    s.actors.vale.place = itemPlace(s, button);
    s = act(s, "take", { item: button });
    s.actors.vale.place = "forest-cottage";
    s = act(s, "give", { item: button, target: "rati" });
    expect(s.items[button].holder).toBe(scarf);
    s.sharedVersion = 1;
    s.actors.mara.place = "forest-cottage";
    s.items[scarf].holder = "mara";
    validateWorld(s);
    expect(entityActive(s, button)).toBe(false);
    expect(availableCards(s)).not.toContain(button);
    expect(legalActions(s).some((a) => a.item === button)).toBe(false);
  });
});
