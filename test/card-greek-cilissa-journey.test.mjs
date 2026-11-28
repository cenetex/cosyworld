import { expect, it } from "vitest";
import { claimsIn } from "../v2/card-game/claims.mjs";
import { knowsFact } from "../v2/card-game/knowledge.mjs";
import { readPage } from "../v2/card-game/read-view.mjs";
import {
  entityActive,
  packPeople,
  packTalkChoice,
} from "../v2/card-game/pack-registry.mjs";
import { settleGuards } from "../v2/card-game/resident-guard.mjs";
import { dispatchShared } from "../v2/card-game/shared-world.mjs";
import {
  decodeSave,
  encodeSave,
  legalActions,
} from "../v2/card-game/world.mjs";
import { greekStart, traveler } from "./helpers/open-door.mjs";
import "./helpers/still-cast.mjs";

const PACK = "greek-drama";
const CILISSA = "greek-cilissa";
const TOMB = "greek-argos-tomb";
const COURT = "greek-areopagus";
const STEM = "greek-story-aeschylus-eumenides";
const ATHENA = `${STEM}-first`;
const FURY = `${STEM}-second`;
const BALLOT = `${STEM}-object`;
const VERDICT = `${STEM}-outcome`;
const ORDER = "greek-areopagus-witness-order";
const FILED = "greek-areopagus-file-atreid-evidence";
const ORDER_CLAIM = `claim:${PACK}:${ORDER}:${FILED}`;
const CONSENT = "greek-cilissa-agrees-to-testify";
const TESTIFY = "greek-areopagus-hear-cilissa";
const TESTIMONY = "greek-areopagus-cilissa-testimony";
const BENCH = "greek-areopagus-open-witness-bench";
const WATER = "greek-areopagus-witness-water";
const ISMENE = "greek-ismene";
const ELECTRA = "greek-electra-aeschylus";
const TOMB_QUESTION = "greek-areopagus-question-from-tomb";
const PALACE_QUESTION = "greek-areopagus-question-from-palace";
const PATH = [
  TOMB,
  "greek-argolid-road",
  "greek-harbor",
  "greek-road-thebes",
  "greek-courtyard",
  "greek-gate",
  "greek-battlefield",
  "greek-cithaeron",
  "greek-eleusis",
  "greek-road-athens-eleusis",
  "greek-athens",
  "greek-acropolis",
  COURT,
];

const receipts = ({ s }) => s.packs[PACK].receipts;
const ballot = ({ s }) => s.packs[PACK].choices[VERDICT];
const progress = ({ s }) => s.journeyProgress[CILISSA];
const talkChoice = ({ s }, target) =>
  packTalkChoice(s, { actor: "vale", target })?.choiceId;
const lastTalk = (s, targetId, actor = "vale") =>
  s.log.findLast((e) => e.verb === "talk" && e.targetId === targetId && e.actorId === actor)?.text;
const invitations = ({ s }) =>
  legalActions(s)
    .filter((a) => a.kind === "accompany" && a.target === CILISSA)
    .map(({ destination }) => destination);

function fileEvidence(t) {
  return t
    .move("harbor", "courtyard", "well")
    .take("water-jar")
    .move("courtyard")
    .give("water-jar", "baker")
    .take("bread")
    .move("gate")
    .trade("bread", "guard", "decree")
    .move("palace")
    .trade("decree", "creon", "creon-writ")
    .move("gate")
    .waitFor("guard")
    .give("creon-writ", "guard")
    .move(...PATH.slice(6))
    .act("talk", { target: ATHENA });
}

function accompany(t, step) {
  const destination = PATH[step];
  expect(invitations(t)).toEqual([destination]);
  t.act("accompany", { target: CILISSA, destination });
  expect(t.s.actors[CILISSA].place).toBe(destination);
  expect(t.s.actors.vale.place).toBe(destination);
  expect(progress(t)).toEqual({ agreement: CONSENT, step });
}

function aeschyleanAccount() {
  return traveler(greekStart())
    .move("harbor", "argolid-road")
    .take("atreid-record")
    .move("sanctuary")
    .waitFor(ISMENE)
    .give("atreid-record", ISMENE);
}

it("finds the Argive testimony, escorts Cilissa, and lets a late arrival open the witness bench independently of the ballot", () => {
  expect(packPeople[CILISSA].journey.path).toEqual(PATH);
  const t = aeschyleanAccount();
  for (const _ of [1, 2]) {
    t.act("talk", { target: ISMENE });
    expect(lastTalk(t.s, ISMENE)).toContain("Meet Electra at Agamemnon’s tomb");
  }
  t.move("argolid-road", TOMB).talk(ELECTRA);
  t.act("talk", { target: ELECTRA });
  expect(lastTalk(t.s, ELECTRA)).toContain("Eleusis");
  expect(lastTalk(t.s, ELECTRA)).toContain("Ask for Athena at the Areopagus");
  t.take("tomb-testimony");
  expect(entityActive(t.s, CILISSA)).toBe(false);
  expect(entityActive(t.s, TESTIMONY)).toBe(false);
  expect(invitations(t)).toEqual([]);

  fileEvidence(t.move("argolid-road"));
  expect(receipts(t)[FILED]).toBe(t.s.turn);
  expect(t.s.packs[PACK].flags[`${STEM}-heard`]).toBeUndefined();
  t.act("talk", { target: ATHENA });
  expect(entityActive(t.s, TESTIMONY)).toBe(false);
  expect(knowsFact(t.s, "vale", ORDER_CLAIM)).toBe(false);
  expect(entityActive(t.s, WATER)).toBe(false);
  expect(talkChoice(t, ATHENA)).toBe(TOMB_QUESTION);
  expect(talkChoice(t, FURY)).not.toBe(PALACE_QUESTION);
  t.act("talk", { target: ATHENA });
  expect(lastTalk(t.s, ATHENA)).toContain(
    "ask Cilissa who sent her for Aegisthus",
  );
  expect(ballot(t.fork().take(BALLOT).give(BALLOT, ATHENA))).toBe("first");
  t.act("read", { item: ORDER });
  t.move(...PATH.slice(0, -1).reverse());

  const unread = t.fork();
  delete unread.s.knowledge.known.vale[ORDER_CLAIM];
  expect(entityActive(unread.s, CILISSA)).toBe(true);
  expect(
    packTalkChoice(unread.s, { actor: "vale", target: CILISSA }),
  ).toBeNull();
  expect(invitations(t)).toEqual([]);
  t.act("talk", { target: CILISSA });
  expect(receipts(t)[CONSENT]).toBe(t.s.turn);
  expect(progress(t)).toEqual({ agreement: CONSENT, step: 0 });

  accompany(t, 1);
  accompany(t, 2);
  t.move(PATH[1]);
  t.s = decodeSave(encodeSave(t.s));
  expect(t.s.actors[CILISSA].place).toBe(PATH[2]);
  expect(progress(t)).toEqual({ agreement: CONSENT, step: 2 });
  expect(entityActive(t.s, TESTIMONY)).toBe(false);
  t.move(PATH[2]);
  for (let step = 3; step < PATH.length; step++) {
    if (PATH[step - 1] === "greek-gate") {
      const closed = t.fork();
      closed.s.items["greek-creon-writ"].holder = "greek-courtyard";
      settleGuards(closed.s);
      expect(invitations(closed)).toEqual([]);
      expect(
        legalActions(closed.s).some(
          (a) => a.kind === "move" && a.target === PATH[step],
        ),
      ).toBe(false);
      expect(progress(closed).step).toBe(step - 1);
    }
    accompany(t, step);
  }

  expect(invitations(t)).toEqual([]);
  expect(entityActive(t.s, TESTIMONY)).toBe(false);
  expect(ballot(t)).toBeUndefined();
  t.act("talk", { target: CILISSA });
  expect(receipts(t)[TESTIFY]).toBe(t.s.turn);
  expect(entityActive(t.s, TESTIMONY)).toBe(true);
  expect(t.s.items[TESTIMONY].holder).toBe(COURT);
  expect(
    legalActions(t.s).some((a) => a.kind === "take" && a.item === TESTIMONY),
  ).toBe(false);
  const [claim] = claimsIn(TESTIMONY, t.s);
  expect(claim).toMatchObject({ author: CILISSA, claim: TESTIFY });
  expect(ballot(t)).toBeUndefined();
  expect(ballot(t.fork().take(BALLOT).give(BALLOT, FURY))).toBe("second");
  expect(entityActive(t.s, WATER)).toBe(false);

  const shared = dispatchShared({ op: "create", save: encodeSave(t.s) });
  expect(shared.ok, shared.error).toBe(true);
  let world = shared.world;
  world.actors.mara.place = "greek-harbor";
  const seats = ["vale", "mara"];
  const act = (kind, fields, actor = "mara") => {
    const request = { actor, world, claimed: seats, present: seats };
    const view = dispatchShared({ ...request, op: "view" });
    const action = view.actions.find(
      (a) =>
        a.kind === kind &&
        Object.entries(fields).every(([key, value]) => a[key] === value),
    );
    expect(action, `${kind} ${JSON.stringify(fields)}`).toBeDefined();
    const result = dispatchShared({ ...request, op: "play", action });
    expect(result.ok, result.error).toBe(true);
    world = result.world;
  };
  for (const target of PATH.slice(3)) act("move", { target });
  expect(knowsFact(world, "mara", claim.id)).toBe(false);
  act("talk", { target: FURY });
  expect(lastTalk(world, FURY, "mara")).toContain("Read what the nurse actually heard");
  expect(receipts({ s: world })[BENCH]).toBeUndefined();

  const beforeOrder = world.eventSeq;
  act("read", { item: ORDER });
  expect(readPage(world, "mara", beforeOrder)?.claims[0]).toContain(
    "escort Cilissa from Agamemnon’s tomb",
  );
  act("talk", { target: FURY });
  expect(receipts({ s: world })[BENCH]).toBeUndefined();
  act("read", { item: TESTIMONY });
  expect(world.knowledge.known.mara[claim.id]).toMatchObject({
    kind: "read",
    book: TESTIMONY,
  });
  act("talk", { target: FURY });
  const opened = receipts({ s: world })[BENCH];
  expect(opened).toBe(world.turn);
  expect(world.items[WATER].holder).toBe(COURT);
  expect(entityActive(world, WATER)).toBe(true);
  expect(claimsIn(ORDER, world)).toContainEqual(
    expect.objectContaining({ claim: BENCH }),
  );
  expect(ballot({ s: world })).toBeUndefined();

  act("take", { item: WATER });
  act("eat", { item: WATER, target: null });
  expect(world.items[WATER].holder).toBe(COURT);
  act("talk", { target: FURY }, "vale");
  expect(lastTalk(world, FURY)).toContain("Anyone may use the water");
  expect(receipts({ s: world })[BENCH]).toBe(opened);
  act("take", { item: BALLOT });
  act("give", { item: BALLOT, target: FURY });
  expect(ballot({ s: world })).toBe("second");
  expect(decodeSave(encodeSave(world)).packs[PACK].receipts[BENCH]).toBe(
    opened,
  );
}, 60_000);

it("asks a different follow-up after reading the Agamemnon palace settlement", () => {
  const agamemnon = "greek-story-aeschylus-agamemnon";
  const t = aeschyleanAccount()
    .move("argolid-road", TOMB, "argos-palace")
    .talk(`${agamemnon}-first`)
    .take(`${agamemnon}-object`)
    .give(`${agamemnon}-object`, `${agamemnon}-second`)
    .act("read", { item: `${agamemnon}-record` })
    .move(TOMB, "argolid-road");
  expect(t.hands()).not.toContain("greek-tomb-testimony");
  expect(t.hands()).not.toContain("greek-aeschylean-cassandra-deposition");
  fileEvidence(t);
  expect(receipts(t)[FILED]).toBe(t.s.turn);
  expect(talkChoice(t, ATHENA)).not.toBe(TOMB_QUESTION);
  expect(talkChoice(t, FURY)).toBe(PALACE_QUESTION);
  t.act("talk", { target: FURY });
  expect(lastTalk(t.s, FURY)).toContain(
    "ask Cilissa what the women there told her to change",
  );
  expect(entityActive(t.s, WATER)).toBe(false);
  expect(ballot(t)).toBeUndefined();
}, 60_000);
