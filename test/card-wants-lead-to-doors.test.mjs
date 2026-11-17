import { expect, it } from "vitest";
import {
  boxWant,
  boxesAt,
  createWorld,
  holdChoice,
  legalActions,
  play,
} from "../v2/card-game/world.mjs";
import { heldOf, questTerms } from "../v2/card-game/want.mjs";
import { stagedWants } from "../v2/card-game/want-talk.mjs";
import { questFor } from "../v2/card-game/talk-quest.mjs";
import { recordOf } from "../v2/card-game/world/arcana-record.mjs";
import { packDefinitions } from "../v2/card-game/pack-registry.mjs";

const me = "vale";
const hold = (s, item) => {
  const next = structuredClone(s);
  if (next.actors[me].heldItem !== item)
    holdChoice(next, me, { item, revision: next.revision });
  return next;
};
const mine = (s, item) => s.items[item]?.holder === me;

function obey(s, asked) {
  const a = s.actors[me];
  const legal = legalActions(s, me);
  const find = (test) => legal.find(test);
  const accept = find((x) => x.kind === "accept");
  if (accept) return [s, accept];
  for (const q of heldOf(a)) {
    const step = q.step ?? {};
    if (q.kind === "item" && q.lit === false && mine(s, q.target))
      return [hold(s, null), null];
    if (step.verb === "give" && mine(s, q.target)) {
      const lit = hold(s, q.target);
      const give = legalActions(lit, me).find(
        (x) => x.kind === "give" && x.item === q.target && x.target === step.to,
      );
      if (give) return [lit, give];
    }
    for (const item of step.verb === "lay" ? step.items : []) {
      const lay = find(
        (x) => x.kind === "drop" && x.item === item && x.target === q.target,
      );
      if (lay) return [s, lay];
    }
    const take = find(
      (x) =>
        x.kind === "take" && [q.target, ...(step.items ?? [])].includes(x.item),
    );
    if (take) return [s, take];
  }
  const talk = find((x) => x.kind === "talk" && !asked.has(x.target));
  if (talk) return [s, asked.add(talk.target) && talk];
  const onward = find(
    (x) => x.kind === "move" && !x.item && !a.visited.includes(x.target),
  );
  return [s, onward ?? null];
}

function obedientWalk(turns) {
  let s = createWorld({ opening: true, seed: 7 });
  const asked = new Set();
  for (let n = 0; n < turns; n++) {
    const [next, action] = obey(s, asked);
    if (!action && next === s) break;
    s = next;
    if (!action) continue;
    const done = play(s, action, s.revision, me);
    expect(done.ok, done.error).toBe(true);
    s = done.state;  }
  return s;
}

it("a new player who only does what is asked finishes a resident's quest and leaves home", () => {
  const s = obedientWalk(40);
  expect(recordOf(s, me).callers.length).toBeGreaterThanOrEqual(1);
  expect(s.actors[me].visited.length).toBeGreaterThanOrEqual(3);
});

it("each staged want in pack data is a quest Talk can give or a place the resident walks to", () => {
  const s = createWorld({ seed: 7 });
  for (const pack of packDefinitions)
    for (const [id, person] of Object.entries(pack.avatars ?? {}))
      for (const { want } of person.wants ? stagedWants(s, id) : [])
        expect(
          want.kind === "connect" ||
            want.kind === "place" ||
            Boolean(questFor(s, id, want)),
          `${id} ${want.kind} ${want.target}`,
        ).toBe(true);
});

it("the Gate Guard asks for what his gate's lock asks", () => {
  const s = createWorld({ seed: 7 });
  const guard = "greek-guard";
  const gate = boxesAt(s, "greek-gate", me).find(
    (box) => box.id === "greek-battlefield",
  );
  const lock = boxWant(s, gate, me);
  const asks = stagedWants(s, guard).map(({ want }) =>
    questTerms(questFor(s, guard, want)),
  );
  expect(asks).toContain(questTerms(lock));
});
