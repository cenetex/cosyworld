import { describe, expect, it } from "vitest";
import {
  createWorld,
  decodeSave,
  exits,
  sealedWays,
} from "../v2/card-game/world.mjs";
import { packDefinition } from "../v2/card-game/pack-registry.mjs";
import { conditionMet } from "../v2/card-game/pack-rules.mjs";
import { funeralJourney } from "./helpers/greek-funeral.mjs";

const PACK = "greek-drama",
  FIELD = "greek-battlefield",
  ROAD = "greek-cithaeron",
  ROAD_KEY = `${FIELD}>${ROAD}`;
const reload = (world) => decodeSave(JSON.stringify(world));
function atBattlefield() {
  const world = createWorld({ packScopes: { [PACK]: "full" } });
  world.crossings["pond-greek-harbor"].discovered = true;
  world.actors.vale.place = FIELD;
  world.actors["greek-antigone"].place = FIELD;
  world.turn = world.revision = 36;
  return world;
}
const flagMet = (world, key) =>
  conditionMet(world, { kind: "flag", key, value: true }, null, PACK);

describe("the Cithaeron road from the Exposed Battlefield", () => {
  it.each(["vale", "greek-antigone"])(
    "stays open for %s before and after Polynices is buried",
    (actor) => {
      const world = atBattlefield();
      expect(flagMet(world, "greek-burial-performed")).toBe(false);
      expect(exits(reload(world), FIELD, actor)).toContain(ROAD);
      expect(sealedWays(reload(world), actor).map((way) => way.to)).not.toContain(
        ROAD,
      );

      world.packs[PACK].flags["greek-burial-performed"] = true;
      expect(exits(world, FIELD, actor)).toContain(ROAD);
    },
  );


  });
