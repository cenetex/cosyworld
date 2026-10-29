import { it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { cardActions } from "../v2/card-game/cards.mjs";
import { dispatchShared } from "../v2/card-game/shared-world.mjs";

// Pass the accepted local browser save at test time. Its runtime state remains
// outside the repository; the focused rules tests run without this fixture.
const savedPath = process.env.COSYWORLD_FOREST_ACCEPTED_SAVE;
const people = ["vale", "mara"];
it.skipIf(!savedPath)(
  "continues the forest homecoming through an agreed cloth handover and the ship signal",
  () => {
    const saved = readFileSync(savedPath, "utf8");
    const opened = dispatchShared({ op: "create", save: saved });
    expect(opened.ok, opened.error).toBe(true);
    let world = opened.world;
    expect(world.turn).toBe(39);
    const forest = structuredClone(
      world.packs["lonely-forest"].personalQuests["forest-rati-scarf"].records
        .vale,
    );
    const homecoming = structuredClone(
      world.packs["lonely-forest"].choices["forest-homecoming"],
    );
    const originalCompletion = structuredClone(
      world.quests.records["lonely-forest:forest-rati-scarf:vale"].completion,
    );
    function play(actor, cards, fields) {
      const current = {
        ...world,
        playerActorId: actor,
        controlledActors: people,
        presentActors: people,
      };
      const selected = cardActions(current, cards).actions.find((a) =>
        Object.entries(fields).every(([key, value]) => a[key] === value),
      );
      expect(
        selected,
        `${world.turn}: ${actor} ${JSON.stringify(fields)} with ${cards.join(" + ")}`,
      ).toBeTruthy();
      const result = dispatchShared({
        op: "play",
        world,
        actor,
        claimed: people,
        present: people,
        action: selected,
      });
      expect(result.ok, result.error).toBe(true);
      expect(result.world.turn).toBe(world.turn + 1);
      world = result.world;
    }
    const move = (actor, place) =>
      play(actor, [place], { kind: "move", target: place });
    const ask = (actor, item, owner) =>
      play(actor, [item, owner], { kind: "ask", item, target: owner });
    const refill = () =>
      play("mara", ["oil", "lamp"], { kind: "refill", item: "oil" });
    play("mara", ["mask"], { kind: "take", item: "mask" });
    move("mara", "pond");
    play("mara", ["mask", "pond"], { kind: "drop", item: "mask" });
    move("vale", "pond");
    expect(world.turn).toBe(43);
    expect(world.items.cloth.holder).toBe("bell");
    play("mara", ["mask"], { kind: "take", item: "mask" });
    move("mara", "station");
    ask("mara", "oil", "moth");
    expect(world.items.oil.holder).toBe("mara");
    move("mara", "pond");
    expect(world.items.lamp.holder).toBe("keeper");
    move("mara", "station");
    play("mara", ["oil", "lamp"], {
      kind: "trade",
      item: "oil",
      receive: "lamp",
      target: "keeper",
    });
    refill();
    ask("mara", "oil", "keeper");
    play("mara", ["lamp", "keeper"], {
      kind: "give",
      item: "lamp",
      target: "keeper",
    });
    expect(world.items.bell.holder).toBe("keeper");
    expect(world.items.cloth.holder).toBe("bell");
    ask("mara", "cloth", "keeper");
    expect(world.items.cloth.holder).toBe("mara");
    expect(world.items.bell.holder).toBe("keeper");
    expect(world.log.at(-1).turn).toBe(53);
    expect(
      world.log.some(
        (e) => e.verb === "ask" && e.itemId === "cloth" && e.accepted === true,
      ),
    ).toBe(true);
    play("mara", ["mask", "station"], { kind: "drop", item: "mask" });
    ask("mara", "lamp", "keeper");
    expect(world.items.lamp.holder).toBe("keeper");
    play("mara", ["keeper", "pond"], {
      kind: "accompany",
      target: "keeper",
      destination: "pond",
    });
    expect(world.actors.keeper.place).toBe("pond");
    play("mara", ["mara"], { kind: "wait" });
    expect(world.items.oil.doses).toBe(3);
    play("mara", ["oil", "lamp"], {
      kind: "trade",
      item: "oil",
      receive: "lamp",
      target: "keeper",
    });
    refill();
    refill();
    for (let flash = 0; flash < 2; flash++) {
      play("mara", ["cloth", "lamp"], {
        kind: "cover",
        item: "cloth",
        target: "lamp",
      });
      play("mara", ["cloth"], { kind: "take", item: "cloth" });
    }
    expect(world.turn).toBe(64);
    expect(world.crossings["pond-greek-harbor"].discovered).toBe(true);
    expect(world.items.lamp.holder).toBe("mara");
    expect(world.items.cloth.holder).toBe("mara");
    expect(world.items[forest.button.id].holder).toBe(forest.reward.id);
    expect(world.items[forest.reward.id].holder).toBe("vale");
    expect(
      world.packs["lonely-forest"].personalQuests["forest-rati-scarf"].records
        .vale,
    ).toEqual(forest);
    expect(world.packs["lonely-forest"].choices["forest-homecoming"]).toEqual(
      homecoming,
    );
    expect(
      world.quests.records["lonely-forest:forest-rati-scarf:vale"].completion,
    ).toEqual(originalCompletion);
  },
);
