import { expect, it } from "vitest";
import { claimsIn } from "../v2/card-game/claims.mjs";
import { knowsFact } from "../v2/card-game/knowledge.mjs";
import {
  packGiveChoice,
  packTalkChoice,
} from "../v2/card-game/pack-registry.mjs";
import { knowsLane } from "../v2/card-game/pack-transport.mjs";
import { readPage } from "../v2/card-game/read-view.mjs";
import { legalActions } from "../v2/card-game/world.mjs";
import { greekStart, landRoad, traveler } from "./helpers/open-door.mjs";
import "./helpers/still-cast.mjs";

const PACK = "greek-drama";
const LETTER = "greek-story-euripides-tauris-object";
const ARGOS = "greek-argive-jury";
const ELECTRA = "greek-story-euripides-orestes-first";
const DELIVERY = "greek-tauris-deliver-letter";
const receipts = (t) => t.s.packs[PACK].receipts;

function sailWithDirections(t, speaker, destination, returnTo) {
  const from = t.s.actors.vale.place;
  expect(knowsLane(t.s, "vale", from, destination)).toBe(false);
  t.talk(speaker);
  const fact = `lane:${from}>${destination}`;
  expect(knowsLane(t.s, "vale", from, destination)).toBe(true);
  expect(knowsFact(t.s, "vale", fact)).toBe(true);
  expect(t.s.knowledge.known.vale[fact]).toMatchObject({
    kind: "heard",
    teller: speaker,
  });
  t.move("scylla");
  const courses = legalActions(t.s)
    .filter(({ kind }) => kind === "course")
    .map(({ target }) => target);
  expect(new Set(courses)).toEqual(
    new Set(returnTo ? [destination, returnTo] : [destination]),
  );
  t.act("course", { target: destination })
    .act("wait")
    .act("move", { target: destination });
}

function prepareHandoff(t, stem, response) {
  const resident = `${stem}-first`;
  const item = `${stem}-object`;
  const talk = { actor: "vale", target: resident };
  t.drop("shovel")
    .talk(resident)
    .take(item)
    .give(item, resident)
    .take("shovel")
    .act("read", { item: `${stem}-record` });

  const place = t.s.actors.vale.place;
  expect(t.hands()).toHaveLength(3);
  expect(packTalkChoice(t.s, talk)?.choiceId).not.toBe(response);
  t.talk(resident);
  expect(
    t.s.log.findLast(
      (entry) => entry.verb === "talk" && entry.actorId === "vale",
    ).text,
  ).toContain("carry three items");
  expect(receipts(t)[response]).toBeUndefined();
  expect(t.s.items[item].holder).toBe(place);

  t.drop("shovel");
  expect(packTalkChoice(t.s, talk)?.choiceId).toBe(response);
  t.talk(resident);
  expect(receipts(t)[response]).toBe(t.s.turn);
  expect(t.s.items[item].holder).toBe("vale");
  expect(packTalkChoice(t.s, talk)?.choiceId).not.toBe(response);
  return t;
}

it("lets Jocasta hand over the original summons after the traveler makes room", () => {
  prepareHandoff(
    landRoad(traveler(greekStart())).move("oedipus-court"),
    "greek-story-sophocles-oedipus-tyrannus",
    "greek-oedipus-keep-summons-private",
  );
});

it("carries Iphigenia’s original letter from Tauris to Electra and reads her acknowledgment", () => {
  const t = landRoad(traveler(greekStart())).move("pagasae");
  sailWithDirections(t, "greek-pagasae-pilot", "greek-lemnos");
  sailWithDirections(
    t,
    "greek-story-sophocles-philoctetes-first",
    "greek-thrace",
    "greek-pagasae",
  );
  sailWithDirections(
    t,
    "greek-story-euripides-hecuba-first",
    "greek-tauris",
    "greek-lemnos",
  );
  prepareHandoff(
    t,
    "greek-story-euripides-tauris",
    "greek-tauris-entrust-letter",
  );
  expect(claimsIn(LETTER, t.s)).toEqual([]);

  t.move("scylla", "pagasae", "harbor", "argos-sanctuary", ARGOS);
  const gift = { actor: "vale", item: LETTER, target: ELECTRA };
  expect(packGiveChoice(t.s, gift)?.choiceId).toBe(DELIVERY);
  t.give(LETTER, ELECTRA);
  expect(receipts(t)[DELIVERY]).toBe(t.s.turn);
  expect(t.s.items[LETTER].holder).toBe(ARGOS);
  expect(t.s.actors[ELECTRA].trust.vale).toBe(2);
  expect(
    t.s.packs[PACK].choices["greek-story-euripides-orestes-outcome"],
  ).toBeUndefined();

  t.take(LETTER).act("read", { item: LETTER });
  expect(packGiveChoice(t.s, gift)).toBeNull();
  const [acknowledgment] = claimsIn(LETTER, t.s);
  expect(readPage(t.s, "vale", 0)).toMatchObject({
    book: LETTER,
    author: "Electra",
    claims: [acknowledgment.text],
  });
  expect(t.s.knowledge.known.vale[acknowledgment.id]).toMatchObject({
    kind: "read",
    book: LETTER,
  });
}, 60_000);
