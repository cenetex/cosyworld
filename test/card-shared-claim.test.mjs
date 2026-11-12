import { describe, expect, it } from "vitest";
import { humanAvatarIds } from "../v2/card-game/human-cast.mjs";
import { questXp } from "../v2/card-game/want.mjs";
import { questOffers } from "../v2/card-game/world.mjs";
import { currentSharedEngine } from "./fixtures/shared-engine.mjs";

const [first, second] = humanAvatarIds;
const seats = { claimed: [first, second], present: [first, second] };

describe("a claim into a newly founded shared world, at the bundled rules", () => {
  const engine = currentSharedEngine();
  const served = (request) =>
    JSON.parse(engine.cardShared(JSON.stringify(request)));
  const world = served({ op: "create", seed: 3, actor: first }).world;
  const claim = (actor, progress) =>
    served({ op: "join", world, actor, ...seats, progress });
  const levelOffer = (out, actor = second) =>
    questOffers(
      served({ op: "view", world: out.world, actor, ...seats }).world,
      actor,
    ).filter((o) => o.kind === "level");

  it.each([undefined, { upgrades: ["test-upgrade"] }])(
    "seats a fresh traveler at no level with no Level up offer on turn 0 (progress %o)",
    (progress) => {
      const out = claim(second, progress);
      expect(out.ok, out.error).toBe(true);
      expect(out.world.turn).toBe(0);
      expect(out.world.actors[second].xp).toBe(0);
      expect(out.world.actors[second].level).toBeUndefined();
      expect(out.world.actors[second].carried).toBeUndefined();
      expect(out.world.actors[second].upgrades).toEqual(progress?.upgrades);
      expect(levelOffer(out)).toEqual([]);
      expect(levelOffer(out, first)).toEqual([]);
    },
  );

  it("still replays a journaled claim that carried a level, with its offer", () => {
    const out = claim(second, { xp: questXp(3), level: 2 });
    expect(out.world.actors[second]).toMatchObject({
      xp: questXp(3),
      level: 2,
      carried: questXp(3),
    });
    expect(levelOffer(out)).toHaveLength(1);
  });
});
