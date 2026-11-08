import { expect, it } from "vitest";
import { act, lifeWorld, reload } from "./helpers/world-life.mjs";
import { funeralJourney } from "./helpers/greek-funeral.mjs";
import {
  accompanyDecision,
  exits,
  legalActions,
} from "../v2/card-game/world.mjs";
import { entityActive } from "../v2/card-game/pack-registry.mjs";
import { talkedDirectly } from "../v2/card-game/conversation.mjs";

const gate = "greek-gate",
  field = "greek-battlefield",
  hollow = "greek-polynices-hollow",
  shade = "greek-polynices-shade",
  antigone = "greek-antigone";

it("lets a woken resident approach her own Talk prerequisite within ordinary rounds", () => {
  let s = lifeWorld({ place: gate, turn: 84 });
  s.items["greek-creon-writ"].holder = "greek-guard";
  s.actors["greek-guard"].trust.vale = 1;
  s = act(s, "wait");
  expect(s.actors[antigone].sleeping).toBeTruthy();
  const sleep = s.actors[antigone].slept;
  s = act(s, "talk", { target: antigone });
  expect(s.actors[antigone].sleeping).toBeUndefined();
  s = act(s, "move", { target: field });
  s = act(s, "talk", { target: shade });
  expect(s.actors[antigone].place).toBe(field);
  expect(talkedDirectly(s, antigone, shade)).toBe(false);
  expect(exits(s, field, antigone)).not.toContain(hollow);
  s = act(s, "move", { target: hollow });
  expect(talkedDirectly(s, antigone, shade)).toBe(true);
  expect(s.actors[antigone].place).toBe(field);
  s = act(s, "wait");
  expect(s.actors[antigone].place).toBe(hollow);
  expect(s.actors[antigone].slept).toBe(sleep);
  const talks = s.log.filter(
    (e) => e.actorId === antigone && e.verb === "talk",
  );
  expect(talks).toHaveLength(1);
  expect(talks[0]).toMatchObject({ targetId: shade, fromLocationId: field });
  expect(
    s.log.filter((e) => e.actorId === antigone && e.turn === talks[0].turn),
  ).toHaveLength(1);
  expect(reload(s)).toEqual(s);
});

it("requires a known willing companion to gain personal entry before travelling together", () => {
  const companion = "greek-baker";
  let s = act(lifeWorld({ place: field, turn: 36 }), "talk", { target: shade });
  s.actors[companion].place = field;
  const want = (kind, target) => ({ kind, target, since: s.turn, refusals: 0 });
  s.actors[companion].want = want("place", hollow);
  const invitation = () =>
    legalActions(s).find(
      (a) =>
        a.kind === "accompany" &&
        a.target === companion &&
        a.destination === hollow,
    );
  expect(accompanyDecision(s, "vale", companion, hollow).accepted).toBe(true);
  expect(invitation()).toBeUndefined();
  s.actors[companion].want = want("person", shade);
  s = act(s, "wait");
  expect(talkedDirectly(s, companion, shade)).toBe(true);
  s.actors[companion].want = want("place", hollow);
  expect(invitation()).toBeTruthy();
  s = act(s, "accompany", { target: companion, destination: hollow });
  expect(s.actors[companion].place).toBe(hollow);
  expect(reload(s)).toEqual(s);
});

it("commits an offstage Talk when the sleeping resident next meets the night shade", () => {
  let s = lifeWorld({ place: field, turn: 94 });
  s.items["greek-creon-writ"].holder = "greek-guard";
  s = act(s, "talk", { target: shade });
  expect(s.actors[antigone].sleeping).toBeTruthy();
  s = act(s, "move", { target: hollow });
  for (
    let turns = 0;
    turns < 48 && s.actors[antigone].place !== hollow;
    turns++
  )
    s = act(s, "wait");
  expect(s.actors[antigone].place).toBe(hollow);
  const conversation = s.log.find(
    (e) => e.actorId === antigone && e.verb === "talk" && e.targetId === shade,
  );
  expect(conversation).toBeTruthy();
  expect(conversation.turn % 48).toBeGreaterThanOrEqual(36);
  expect(conversation.fromLocationId).toBe(field);
  expect(talkedDirectly(s, antigone, shade)).toBe(true);
  expect(reload(s)).toEqual(s);
});

it("keeps burial history without granting someone else's conversation", () => {
  const s = funeralJourney().buried;
  expect(entityActive(s, shade)).toBe(false);
  expect(talkedDirectly(s, "vale", shade)).toBe(true);
  expect(talkedDirectly(s, "greek-ismene", shade)).toBe(false);
  expect(exits(s, field, "greek-ismene")).not.toContain(hollow);
  expect(exits(s, hollow, "greek-ismene")).toContain(field);
  expect(reload(s)).toEqual(s);
});
