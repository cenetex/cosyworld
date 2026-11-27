import { expect, it } from "vitest";
import { claimsIn } from "../v2/card-game/claims.mjs";
import { knowsFact } from "../v2/card-game/knowledge.mjs";
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
    .act("talk", { target: ATHENA })
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

it("escorts Cilissa only with evidence and consent, resumes after a detour, and posts her testimony independently of the ballot", () => {
  expect(packPeople[CILISSA].journey.path).toEqual(PATH);
  const t = traveler(greekStart())
    .move("harbor", "argolid-road")
    .take("atreid-record")
    .move("sanctuary")
    .waitFor("ismene")
    .give("atreid-record", "ismene")
    .move("argolid-road", TOMB)
    .talk("electra-aeschylus")
    .take("tomb-testimony");
  expect(entityActive(t.s, CILISSA)).toBe(false);
  expect(entityActive(t.s, TESTIMONY)).toBe(false);
  expect(invitations(t)).toEqual([]);

  fileEvidence(t.move("argolid-road"));
  expect(receipts(t)[FILED]).toBe(t.s.turn);
  expect(entityActive(t.s, TESTIMONY)).toBe(false);
  expect(knowsFact(t.s, "vale", ORDER_CLAIM)).toBe(false);
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
  t.take(BALLOT).give(BALLOT, FURY);
  expect(ballot(t)).toBe("second");

  const shared = dispatchShared({ op: "create", save: encodeSave(t.s) });
  expect(shared.ok, shared.error).toBe(true);
  shared.world.actors.mara.place = COURT;
  const request = {
    actor: "mara",
    world: shared.world,
    claimed: ["vale", "mara"],
    present: ["vale", "mara"],
  };
  expect(knowsFact(shared.world, "mara", claim.id)).toBe(false);
  const view = dispatchShared({ ...request, op: "view" });
  const action = view.actions.find(
    (a) => a.kind === "read" && a.item === TESTIMONY,
  );
  expect(action).toBeDefined();
  const read = dispatchShared({ ...request, op: "play", action });
  expect(read.ok, read.error).toBe(true);
  expect(read.world.knowledge.known.mara[claim.id]).toMatchObject({
    kind: "read",
    book: TESTIMONY,
  });
  expect(read.world.packs[PACK].choices[VERDICT]).toBe("second");
}, 60_000);
