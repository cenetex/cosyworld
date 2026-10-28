import { describe, expect, it } from "vitest";
import {
  legalActions,
  play,
  decodeSave,
  encodeSave,
  exits,
} from "../v2/card-game/world.mjs";
import { entityActive } from "../v2/card-game/pack-registry.mjs";
import {
  DANAID_SANCTUARY as S,
  DANAID_COURT as C,
  DANAID_NERA as N,
  danaidId,
  danaidState,
  danaidStory,
  danaidVerses,
  danaidOffered,
  danaidAction,
  danaidStart,
} from "./helpers/greek-danaid.mjs";

const paths = ["household", "common"].flatMap((route) =>
  ["placed", "carried-by-nera"].map((delivery) => ({ route, delivery })),
);

describe("The Door Chosen", () => {
  it.each(paths)(
    "earns $route lodging with $delivery provisions and keeps the signed return",
    ({ route, delivery }) => {
      let world = danaidStart();
      const initial = structuredClone(world),
        journal = [];
      const act = (kind, fields = {}) => {
        const action = danaidAction(world, kind, fields);
        const result = play(world, action, world.revision);
        expect(result.ok, result.error).toBe(true);
        const loaded = decodeSave(encodeSave(result.state));
        expect(loaded).toEqual(result.state);
        world = loaded;
        journal.push(structuredClone(action));
      };
      const choose = (name) => act("choose", { choiceId: danaidId(name) });
      const move = (target) => act("move", { target });
      const take = (name) => act("take", { item: danaidId(name) });

      expect(entityActive(world, S)).toBe(false);
      expect(entityActive(world, N)).toBe(false);
      choose("invitation");
      expect(danaidOffered(world, "invitation")).toBeUndefined();
      move("greek-harbor");
      expect(exits(world, "greek-harbor")).toContain("greek-argolid-road");
      move("greek-argolid-road");
      expect(exits(world, "greek-argolid-road")).toContain("greek-harbor");
      move(S);
      expect(exits(world, S)).toEqual(
        expect.arrayContaining(["greek-argolid-road", C]),
      );
      choose("hear-terms");
      expect(danaidOffered(world, "lay-branches")).toBeUndefined();
      move(C);
      expect(exits(world, C)).toContain(S);
      choose("hear-flight");
      take("water-jug");
      take("branch");
      expect(world.items[danaidId("water-jug")].holder).toBe("vale");
      expect(world.items[danaidId("branch")].holder).toBe("vale");
      move(S);
      choose("lay-branches");
      expect(world.items[danaidId("water-jug")].holder).toBe(S);
      expect(world.items[danaidId("branch")].holder).toBe(S);
      move(C);
      choose("offer-roof");
      take("host-pledge");
      take("provisions");
      move(S);

      const stalePledge = danaidOffered(world, "set-provisions");
      expect(stalePledge).toBeDefined();
      act("drop", { item: danaidId("host-pledge"), target: S });
      expect(danaidOffered(world, "set-provisions")).toBeUndefined();
      expect(play(world, stalePledge, world.revision).ok).toBe(false);
      take("host-pledge");
      choose("set-provisions");
      expect(world.items[danaidId("host-pledge")].holder).toBe(S);
      expect(world.items[danaidId("provisions")].holder).toBe(S);
      move(C);
      choose("hear-herald");
      move(S);
      expect(
        legalActions(world).some(
          (a) =>
            a.kind === "accompany" && a.target === N && a.destination === C,
        ),
      ).toBe(false);
      choose(`choose-${route}`);
      expect(
        danaidOffered(
          world,
          `choose-${route === "common" ? "household" : "common"}`,
        ),
      ).toBeUndefined();
      choose("agree-journey");
      expect(world.actors[N].place).toBe(S);
      take("host-pledge");
      take("provisions");
      move(C);
      expect(world.actors[N].place).toBe(S);
      expect(danaidOffered(world, `arrive-${route}`)).toBeUndefined();
      move(S);
      if (delivery === "carried-by-nera")
        act("give", { item: danaidId("provisions"), target: N });
      act("accompany", { target: N, destination: C });
      expect(world.actors[N].place).toBe(C);
      if (delivery === "placed") {
        const staleArrival = danaidOffered(world, `arrive-${route}`);
        expect(staleArrival).toBeDefined();
        act("drop", { item: danaidId("provisions"), target: C });
        expect(danaidOffered(world, `arrive-${route}`)).toBeUndefined();
        expect(play(world, staleArrival, world.revision).ok).toBe(false);
        take("provisions");
        choose(`arrive-${route}`);
        expect(world.items[danaidId("provisions")].holder).toBe(C);
      } else {
        expect(world.items[danaidId("provisions")].holder).toBe(N);
        choose(`receive-${route}`);
        expect(world.items[danaidId("provisions")].holder).toBe(N);
      }
      expect(danaidState(world).choices[danaidId("ending")]).toBe(route);
      expect(danaidState(world).flags[danaidId("arrived")]).toBe(true);
      expect(danaidStory(world, "journey").completion.actorId).toBe("vale");
      expect(world.items[danaidId("host-pledge")].holder).toBe("vale");
      move(S);
      expect(world.actors[N].place).toBe(C);
      move("greek-argolid-road");
      move("greek-harbor");
      move("greek-courtyard");
      choose(`return-${route}`);
      expect(world.items[danaidId("host-pledge")].holder).toBe(
        "greek-courtyard",
      );
      expect(danaidState(world).flags[danaidId("returned")]).toBe(true);
      expect(danaidVerses(world).map((verse) => verse.id)).toEqual([
        danaidId("lay-branches"),
        danaidId("set-provisions"),
        danaidId(`${delivery === "placed" ? "arrive" : "receive"}-${route}`),
        danaidId(`return-${route}`),
      ]);
      expect(danaidOffered(world, `return-${route}`)).toBeUndefined();
      for (const verse of Object.values(danaidState(world).recitals))
        if (verse.actor !== null) expect(verse.actor).toBe("vale");

      let replay = structuredClone(initial);
      for (const action of journal) {
        const result = play(replay, action, replay.revision);
        expect(result.ok, result.error).toBe(true);
        replay = decodeSave(encodeSave(result.state));
      }
      expect(replay).toEqual(world);
    },
  );
});
