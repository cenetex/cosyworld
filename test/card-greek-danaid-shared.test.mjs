import { describe, expect, it } from "vitest";
import { decodeSave, encodeSave } from "../v2/card-game/world.mjs";
import { dispatchShared } from "../v2/card-game/shared-world.mjs";
import {
  DANAID_SANCTUARY as S,
  DANAID_COURT as C,
  DANAID_NERA as N,
  danaidId,
  danaidStart,
  danaidPreparationSteps,
  danaidState,
  danaidStory,
} from "./helpers/greek-danaid.mjs";

const humans = ["vale", "mara"];

describe("The Door Chosen in a shared company", () => {
  it.each(["household", "common"])(
    "keeps both authors when Mara completes Vale’s agreed %s journey",
    (route) => {
      let world = danaidStart();
      world.sharedVersion = 1;
      world.actors.mara.place = "greek-courtyard";
      const initial = structuredClone(world),
        journal = [];
      const request = (op, actor, extra = {}) => ({
        op,
        actor,
        world,
        claimed: humans,
        present: humans,
        ...extra,
      });
      const act = (actor, kind, fields = {}) => {
        const view = dispatchShared(request("view", actor));
        const action = view.actions.find(
          (candidate) =>
            candidate.kind === kind &&
            Object.entries(fields).every(
              ([key, value]) => candidate[key] === value,
            ),
        );
        expect(
          action,
          `${actor} ${kind} ${JSON.stringify(fields)}`,
        ).toBeDefined();
        const command = {
          op: "play",
          actor,
          claimed: humans,
          present: humans,
          action,
          revision: world.revision,
        };
        const result = dispatchShared({ ...command, world });
        expect(result.ok, result.error).toBe(true);
        world = result.world;
        expect(decodeSave(encodeSave(world))).toEqual(world);
        journal.push(structuredClone(command));
      };
      const choose = (actor, name) =>
        act(actor, "choose", { choiceId: danaidId(name) });
      const move = (actor, target) => act(actor, "move", { target });
      const take = (actor, name) =>
        act(actor, "take", { item: danaidId(name) });

      for (const [kind, fields] of danaidPreparationSteps)
        act("vale", kind, fields);
      choose("vale", `choose-${route}`);
      choose("vale", "agree-journey");
      expect(world.actors[N].place).toBe(S);
      const agreement = danaidState(world).receipts[danaidId("agree-journey")];
      expect(agreement).toBe(world.turn);
      for (const target of ["greek-harbor", "greek-argolid-road", S])
        move("mara", target);
      expect(world.actors[N].place).toBe(S);
      take("mara", "host-pledge");
      take("mara", "provisions");
      act("mara", "give", { item: danaidId("provisions"), target: N });
      expect(world.items[danaidId("provisions")].holder).toBe(N);
      act("mara", "accompany", { target: N, destination: C });
      expect(world.actors.vale.place).toBe(S);
      expect(world.actors.mara.place).toBe(C);
      expect(world.actors[N].place).toBe(C);
      choose("mara", `receive-${route}`);
      expect(world.items[danaidId("provisions")].holder).toBe(N);
      const completion = danaidStory(world, "journey").completion;
      expect(completion.actorId).toBe("mara");
      expect(completion.participants).toEqual(["mara", "vale"]);
      expect(danaidState(world).receipts[danaidId("agree-journey")]).toBe(
        agreement,
      );
      expect(danaidState(world).choices[danaidId("ending")]).toBe(route);

      for (const target of [
        S,
        "greek-argolid-road",
        "greek-harbor",
        "greek-courtyard",
      ])
        move("mara", target);
      choose("mara", `return-${route}`);
      expect(world.items[danaidId("host-pledge")].holder).toBe(
        "greek-courtyard",
      );
      expect(world.actors[N].place).toBe(C);
      expect(danaidStory(world, "return").completion.actorId).toBe("mara");
      const authors = danaidState(world).recitals;
      expect(authors[danaidId("lay-branches")].actor).toBe("vale");
      expect(authors[danaidId("set-provisions")].actor).toBe("vale");
      expect(authors[danaidId(`receive-${route}`)].actor).toBe("mara");
      expect(authors[danaidId(`return-${route}`)].actor).toBe("mara");

      let replay = structuredClone(initial);
      for (const command of journal) {
        const result = dispatchShared({ ...command, world: replay });
        expect(result.ok, result.error).toBe(true);
        replay = result.world;
      }
      expect(replay).toEqual(world);
    },
  );
});
