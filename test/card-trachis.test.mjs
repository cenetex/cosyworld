import { describe, expect, it } from "vitest";
import {
  createWorld,
  decodeSave,
  encodeSave,
  legalActions,
  play,
} from "../v2/card-game/world.mjs";
import {
  entityActive,
  packDefinition,
} from "../v2/card-game/pack-registry.mjs";
import { recitalPoem } from "../v2/card-game/pack-recital.mjs";
import { openDoorStart } from "./helpers/open-door.mjs";

function scene(ending) {
  let world = openDoorStart();
  const offered = (kind, fields = {}) =>
    legalActions(world, "vale").find(
      (a) =>
        a.kind === kind &&
        Object.entries(fields).every(([key, value]) => a[key] === value),
    );
  const act = (kind, fields = {}) => {
    const action = offered(kind, fields);
    if (!action)
      throw new Error(
        `Missing ${kind} ${JSON.stringify(fields)} at ${world.actors.vale.place}`,
      );
    const result = play(world, action, world.revision);
    if (!result.ok) throw new Error(result.error);
    world = result.state;
  };
  const choose = (id) => act("choose", { choiceId: `greek-trachis-${id}` });
  const move = (id) => act("move", { target: id });
  const take = (id) => act("take", { item: `greek-trachis-${id}` });
  const drop = (id) => act("drop", { item: `greek-trachis-${id}` });
  const accompany = (id) => act("accompany", { target: `greek-trachis-${id}` });
  choose("invite");
  move("greek-pherae");
  move("greek-trachis");
  choose("hear-iole");
  take("meal");
  choose("meal");
  choose(ending === "changed" ? "choose-early" : "choose-source");
  if (ending === "changed") {
    take("wool-remnant");
    choose("wool-early");
    choose("prepare-plain");
  } else choose("prepare-robe");
  for (const id of ["gift-casket", "plain-cloth", "treated-robe"]) take(id);
  choose(ending === "changed" ? "plain-ready" : "robe-ready");
  drop("treated-robe");
  expect(
    offered("choose", { choiceId: "greek-trachis-dispatch" }),
  ).toBeUndefined();
  take("treated-robe");
  choose("dispatch");
  accompany("lichas");
  expect(world.actors["greek-trachis-lichas"].place).toBe(
    "greek-trachis-canae-approach",
  );
  choose("arrive-canae");
  if (ending !== "changed") {
    drop("plain-cloth");
    move("greek-trachis");
    take("wool-remnant");
    choose("wool-late");
    move("greek-trachis-canae-approach");
  }
  if (ending === "changed") choose("plain-ending");
  if (ending === "recovered") choose("recover-ending");
  if (ending === "care") {
    choose("harm");
    expect(world.items["greek-trachis-treated-robe"].holder).toBe(
      "greek-trachis-canae-approach",
    );
    expect(entityActive(world, "greek-trachis-deianira")).toBe(false);
    expect(entityActive(world, "greek-trachis-lichas")).toBe(false);
    world = decodeSave(encodeSave(world));
    move("greek-trachis");
    take("water-flask");
    move("greek-trachis-canae-approach");
    choose("agree-oeta");
    accompany("heracles");
    expect(world.actors["greek-trachis-heracles"].place).toBe("greek-oeta");
    choose("care-ending");
    move("greek-trachis");
  }
  if (ending !== "care") move("greek-trachis");
  take("wool-remnant");
  move("greek-pherae");
  move("greek-courtyard");
  choose(`return-${ending}`);
  return world;
}

describe("Women of Trachis", () => {
  it.each(["changed", "recovered", "care"])(
    "records the %s account through real custody, travel and return",
    (ending) => {
      const world = scene(ending);
      expect(world.packs["greek-drama"].choices["greek-trachis-ending"]).toBe(
        ending,
      );
      expect(world.items["greek-trachis-wool-remnant"].holder).toBe("vale");
      const poem = recitalPoem(world, packDefinition("greek-drama"));
      expect(poem.stanzas.map((line) => line.id)).toContain(
        `greek-trachis-return-${ending}`,
      );
      expect(decodeSave(encodeSave(world))).toEqual(world);
    },
  );
  it("rejects a forged meeting before an account opened", () => {
    const world = createWorld();
    world.packs["greek-drama"].met["greek-trachis-deianira"] = 0;
    expect(() => decodeSave(JSON.stringify(world))).toThrow();
  });
});
