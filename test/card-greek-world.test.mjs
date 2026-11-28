import { beforeAll, describe, expect, it } from "vitest";
import { cardPlay } from "../v2/card-game/cards.mjs";
import { claimsIn } from "../v2/card-game/claims.mjs";
import {
  entityActive,
  neverBack,
  packDefinition,
  packGiveChoice,
  packTalkChoice,
} from "../v2/card-game/pack-registry.mjs";
import { readPage } from "../v2/card-game/read-view.mjs";
import {
  decodeSave,
  encodeSave,
  legalActions,
  play,
} from "../v2/card-game/world.mjs";
import {
  greekStart,
  landRoad,
  playGreek,
  traveler,
} from "./helpers/open-door.mjs";
import "./helpers/still-cast.mjs";

const PACK = "greek-drama";
const MARKET = "greek-acharnae";
const STALL = "greek-acharnae-stall";
const BREAD = "greek-bread";
const PUBLIC_SUPPLY = "greek-acharnae-trader-loaf-supply";
const PRIVATE_SUPPLY = "greek-acharnae-private-loaf-supply";
const OUTCOME = "greek-story-aristophanes-acharnians-outcome";
const SEAL = "greek-story-aristophanes-acharnians-object";
const DICAEOPOLIS = "greek-story-aristophanes-acharnians-first";
const MEGARIAN = "greek-story-aristophanes-acharnians-second";
const PACK_DEF = packDefinition(PACK);
const episodes = PACK_DEF.works.filter(({ hookChoiceIds }) =>
  hookChoiceIds.some((id) => id.startsWith("greek-story-")),
);
const offerEpisodes = episodes.filter(
  ({ id }) => !["euripides-cyclops", "euripides-hippolytus", "euripides-rhesus"].includes(id),
);
const choices = new Map(PACK_DEF.choices.map((choice) => [choice.id, choice]));
const supplies = PACK_DEF.choices.filter(
  ({ on, effects }) => !on && effects.some(({ kind }) => kind === "drop_item"),
);
const localResponses = {
  "greek-story-euripides-alcestis-first-answer": "greek-pherae-tend-vigil-lamp",
  "greek-story-aeschylus-persians-second-answer":
    "greek-susa-read-missing-names",
  "greek-story-aeschylus-seven-thebes-first-answer":
    "greek-seven-gates-set-watch",
  "greek-story-sophocles-oedipus-tyrannus-first-answer":
    "greek-oedipus-keep-summons-private",
  "greek-story-euripides-andromache-first-answer":
    "greek-thetis-stand-with-andromache",
  "greek-story-euripides-heracles-first-answer":
    "greek-heracles-keep-altar-watch",
  "greek-story-euripides-heracles-second-answer":
    "greek-heracles-keep-children-inside",
  "greek-story-euripides-ion-first-answer": "greek-delphi-hear-ion",
  "greek-story-euripides-orestes-first-answer": "greek-argos-admit-appeal",
  "greek-story-euripides-hecuba-second-answer":
    "greek-thrace-protect-hearing-witness",
  "greek-story-euripides-phoenician-women-second-answer":
    "greek-jocasta-lodge-refugees",
  "greek-story-aristophanes-thesmophoria-second-answer":
    "greek-story-aristophanes-thesmophoria-dispatch-summons",
};
const recordedAftermath = {
  "greek-story-euripides-heracles-second-answer": {
    former: "greek-theban-messenger-pledge",
    disposition: "retire_item",
    text: "The messenger accepts Megara’s pledge and grants the children time to remain inside.",
  },
  "greek-story-euripides-ion-first-answer": {
    former: "greek-delphi-witness-tablet",
    disposition: "place_item",
    text: "Creusa recognizes the tokens she left with her infant before Ion and the Pythia at the temple bench.",
  },
  "greek-story-euripides-orestes-first-answer": {
    former: "greek-argos-herald-vote-tablet",
    disposition: "place_item",
    text: "The herald delays the vote until the Argive jurors hear Electra’s appeal.",
  },
  "greek-story-aeschylus-eumenides-first-answer": {
    former: "greek-areopagus-acquittal-counterseal",
    disposition: "retire_item",
    text: "Athena cast her stone for Orestes and the Areopagus declared him acquitted.",
  },
  "greek-story-euripides-trojan-women-first-answer": {
    former: "greek-trojan-kin-roll-copy",
    disposition: "retire_item",
    text: "Andromache left a copy of the kin and ship names before folding the roll into her bundle.",
  },
  "greek-story-euripides-tauris-first-answer": {
    former: "greek-tauris-release-tablet",
    disposition: "place_item",
    text: "Iphigenia recognized her brother and removed him from the altar line.",
  },
};
const localFollowups = [
  {
    place: "greek-tauris",
    scene: "greek-story-euripides-tauris",
    resident: "greek-story-euripides-tauris-first",
    response: "greek-tauris-entrust-letter",
    entrustsProp: true,
  },
];
const receipts = (world) => world.packs[PACK].receipts;
const canGo = (world, target) =>
  legalActions(world).some(
    (action) => action.kind === "move" && action.target === target,
  );
const canSupply = (world, id) =>
  legalActions(world).some(
    (action) => action.kind === "choose" && action.choiceId === id,
  );

function fixtureAt(place, world = greekStart()) {
  world.actors.vale.place = place;
  if (!world.actors.vale.visited.includes(place))
    world.actors.vale.visited.push(place);
  return world;
}

function cragAfterEatingFigs() {
  const travelerWithFigs = traveler(greekStart())
    .move("well", "palace", "sanctuary")
    .take("figs");
  travelerWithFigs.act("eat", { item: "greek-figs", target: null });
  return fixtureAt("greek-scythian-crag", travelerWithFigs.s);
}

function reachArgivePalace() {
  const t = traveler(greekStart()).move("harbor", "argolid-road");
  expect(entityActive(t.s, "greek-argos-palace")).toBe(false);
  t.take("atreid-record").move("sanctuary").waitFor("ismene");
  t.give("atreid-record", "ismene");
  expect(t.s.packs[PACK].choices["greek-atreid-account"]).toBe("aeschylus");
  return t.move("argolid-road", "argos-tomb", "argos-palace").s;
}

describe("the world of the Greek plays", () => {
  let market;
  beforeAll(() => {
    market = landRoad(traveler(greekStart()))
      .move("battlefield")
      .drop("shovel")
      .drop("oil-flask")
      .move("cithaeron", "eleusis", "attic-farm", MARKET).s;
    expect(market.actors.vale.place).toBe(MARKET);
  });

  it("adds 35 branching episodes to the 44-work repertoire", () => {
    expect(PACK_DEF.works).toHaveLength(44);
    expect(episodes).toHaveLength(35);
  });

  it("keeps an irreversible episode gift under the traveler's control", () => {
    const world = traveler(market).talk(DICAEOPOLIS).take(SEAL).s;
    const gift = { kind: "give", target: MEGARIAN, item: SEAL };
    expect(packGiveChoice(world, { ...gift, actor: "vale" })?.choiceId).toBe(
      "greek-story-aristophanes-acharnians-second-answer",
    );
    const resident = "greek-rhapsode";
    world.actors[resident].place = MARKET;
    world.items[SEAL].holder = resident;
    expect(packGiveChoice(world, { ...gift, actor: resident })).toBeNull();
    expect(world.packs[PACK].choices[OUTCOME]).toBeUndefined();
  });

  it("preserves a revision 38 gift and enables its new branch-specific aftermath", () => {
    const work = PACK_DEF.works.find(({ id }) => id === "euripides-medea");
    const [place] = work.placeIds;
    const [hear, answer] = work.hookChoiceIds.map((id) => choices.get(id));
    const object = answer.requires.find((c) => c.kind === "holding").item;
    const outcome = answer.effects.find((e) => e.kind === "choose");
    const resolved = traveler(fixtureAt(place))
      .talk(hear.subject)
      .take(object)
      .give(object, answer.subject).s;
    const props = Object.entries(PACK_DEF.items).filter(([, definition]) =>
      definition.requires?.some(
        (c) => c.kind === "choice" && c.key === outcome.key,
      ),
    );
    resolved.packs[PACK].revision = 38;
    const committedTurn = receipts(resolved)[answer.id];
    for (const [id] of props) delete resolved.items[id];
    const loaded = decodeSave(JSON.stringify(resolved));
    expect(loaded.packs[PACK].revision).toBe(PACK_DEF.revision);
    expect(receipts(loaded)[answer.id]).toBe(committedTurn);
    expect(loaded.packs[PACK].choices[outcome.key]).toBe(outcome.value);
    expect(
      props.filter(([id]) => entityActive(loaded, id)).length,
    ).toBeGreaterThan(0);
    expect(loaded.items[object]?.holder).toBe(resolved.items[object]?.holder);
  });

  it.each(offerEpisodes)("plays and reads both outcomes of $id", (work) => {
    const [place] = work.placeIds;
    const [hear, ...outcomes] = work.hookChoiceIds.map((id) => choices.get(id));
    const [first, second] = outcomes.map(({ subject }) => subject);
    const item = outcomes[0].requires.find(
      ({ kind }) => kind === "holding",
    )?.item;
    const [record, book] = Object.entries(PACK_DEF.items).find(
      ([, definition]) =>
        outcomes.every(({ id }) => definition.records?.includes(id)),
    );

    expect(work.status).toBe("branching-episode");
    expect(hear).toMatchObject({ on: "talk", at: place, subject: first });
    expect(outcomes).toHaveLength(2);
    expect(first).not.toBe(second);
    expect(book).toMatchObject({
      author: first,
      lifecycle: "fixed",
      holder: place,
    });

    const start =
      place === MARKET
        ? market
        : place === "greek-argos-palace"
          ? reachArgivePalace()
          : place === "greek-scythian-crag"
            ? cragAfterEatingFigs()
            : fixtureAt(place);
    expect(start.packs[PACK].scope).toBe("opening");
    expect(entityActive(start, place)).toBe(true);
    expect(start.actors[first].place).toBe(place);
    expect(start.actors[second].place).toBe(place);
    if (item) expect(start.items[item].holder).toBe(place);
    else
      for (const outcome of outcomes)
        expect(canSupply(start, outcome.id)).toBe(false);
    expect(entityActive(start, record)).toBe(false);
    expect(claimsIn(record, start)).toEqual([]);

    const heard = playGreek(start, "talk", { target: first });
    expect(receipts(heard)[hear.id]).toBe(heard.turn);
    expect(entityActive(heard, second)).toBe(true);
    const prepared = item ? playGreek(heard, "take", { item }) : heard;
    for (const outcome of outcomes) {
      const other = outcomes.find(({ id }) => id !== outcome.id);
      const { action } = cardPlay(
        prepared,
        item ? [item, outcome.subject] : [outcome.subject],
      );
      expect(action).toMatchObject(
        item
          ? { kind: "give", item, target: outcome.subject }
          : {
              kind: "choose",
              choiceId: outcome.id,
              label: outcome.label,
              target: outcome.subject,
            },
      );
      const result = play(prepared, action, prepared.revision);
      expect(result.ok, result.error).toBe(true);
      const closed = result.state;
      const committed = outcome.effects.find(({ kind }) => kind === "choose");
      expect(receipts(closed)[outcome.id]).toBe(closed.turn);
      expect(receipts(closed)[other.id]).toBeUndefined();
      expect(entityActive(closed, record)).toBe(true);
      expect(closed.packs[PACK].choices[committed.key]).toBe(committed.value);

      const aftermath = Object.entries(PACK_DEF.items).filter(
        ([id, definition]) =>
          id !== record &&
          id !== item &&
          definition.requires?.some(
            (condition) =>
              condition.kind === "choice" && condition.key === committed.key,
          ),
      );
      const appeared = aftermath.filter(
        ([id]) => !entityActive(start, id) && entityActive(closed, id),
      );
      const branchSupplies = supplies.filter(({ requires }) =>
        requires.some(
          (condition) =>
            condition.kind === "choice" && condition.key === committed.key,
        ),
      );
      const offered = branchSupplies.filter((supply) => {
        const branch = supply.requires.find(({ key }) => key === committed.key);
        if (branch.value !== committed.value) {
          expect(canSupply(closed, supply.id), supply.id).toBe(false);
          return false;
        }
        const atSupply =
          supply.at === place ? closed : traveler(closed).move(supply.at).s;
        return canSupply(atSupply, supply.id);
      });
      const consolidated = recordedAftermath[outcome.id];
      const response = choices.get(localResponses[outcome.id]);
      if (consolidated)
        expect(closed.items[consolidated.former]).toBeUndefined();
      else if (!response)
        expect(
          appeared.length + offered.length,
          `${outcome.id} opens an item or supply`,
        ).toBeGreaterThan(0);
      for (const [id, definition] of aftermath) {
        const branch = definition.requires.find(
          (c) => c.kind === "choice" && c.key === committed.key,
        );
        if (branch.value !== committed.value)
          expect(entityActive(closed, id), id).toBe(false);
      }

      const itemEffect = outcome.effects.find((effect) => effect.item === item);
      if (consolidated) expect(itemEffect.kind).toBe(consolidated.disposition);
      if (!item) {
        expect(
          closed.items[`${hear.id.slice(0, -"-hear".length)}-object`],
        ).toBeUndefined();
        expect(canSupply(closed, other.id)).toBe(false);
      } else if (itemEffect.kind === "retire_item") {
        expect(itemEffect.forGood).toBe(true);
        expect(closed.gone).toContain(item);
        expect(neverBack(closed, item)).toBe(true);
        expect(
          legalActions(closed).some(
            (a) => a.kind === "take" && a.item === item,
          ),
        ).toBe(false);
      } else {
        expect(itemEffect.kind).toBe("place_item");
        expect(closed.items[item].holder).toBe(itemEffect.holder ?? itemEffect.place);
      }

      const claims = claimsIn(record, closed);
      expect(claims).toHaveLength(1);
      expect(claims[0]).toMatchObject({
        claim: outcome.id,
        author: first,
      });
      const written = book.recordText?.[outcome.id];
      if (consolidated) expect(claims[0].text).toBe(consolidated.text);
      if (written) expect(claims[0].text).toBe(written);
      else expect(outcome.text.startsWith(claims[0].text)).toBe(true);
      const read = playGreek(closed, "read", { item: record });
      expect(readPage(read, "vale", 0)).toMatchObject({
        book: record,
        claims: [claims[0].text],
      });
      const loaded = decodeSave(encodeSave(read));
      expect(loaded.packs[PACK].choices[committed.key]).toBe(committed.value);
      expect(receipts(loaded)[other.id]).toBeUndefined();
      expect(loaded.knowledge.known.vale[claims[0].id]).toMatchObject({
        kind: "read",
        book: record,
      });
      if (response) {
        const speaker = { actor: "vale", target: response.subject };
        const next = (world) => packTalkChoice(world, speaker)?.choiceId;
        if (response.requires.some(({ kind }) => kind === "knows"))
          expect(next(closed)).not.toBe(response.id);
        else expect(next(closed)).toBe(response.id);
        expect(next(loaded)).toBe(response.id);
        const replied = playGreek(loaded, "talk", { target: response.subject });
        expect(receipts(replied)[response.id]).toBe(replied.turn);
        expect(next(replied)).not.toBe(response.id);
        if (response.id === "greek-oedipus-keep-summons-private")
          expect(replied.items[item].holder).toBe("vale");
        else
          expect(replied.actors[response.subject].trust.vale).toBeGreaterThan(
            0,
          );
        if (book.records.includes(response.id))
          expect(claimsIn(record, replied).map(({ claim }) => claim)).toEqual([
            outcome.id,
            response.id,
          ]);
      }
    }
  });

  it.each(localFollowups)(
    "lets a reader ask the resident to act at $place",
    ({ place, scene, resident, response, entrustsProp }) => {
      const first = `${scene}-first`;
      const second = `${scene}-second`;
      const record = `${scene}-record`;
      const item = `${scene}-object`;
      const speaker = { actor: "vale", target: resident };
      const nextReply = (t) => packTalkChoice(t.s, speaker)?.choiceId;
      const start = traveler(fixtureAt(place)).talk(first).take(item);
      const alternate = start.fork().give(item, second);
      alternate.act("read", { item: record });
      expect(nextReply(alternate)).not.toBe(response);

      const resolved = start.give(item, first);
      expect(nextReply(resolved)).not.toBe(response);
      resolved.act("read", { item: record });
      expect(nextReply(resolved)).toBe(response);
      if (entrustsProp) {
        const held = resolved.fork().take(item);
        expect(nextReply(held)).not.toBe(response);
      }

      resolved.talk(resident);
      expect(receipts(resolved.s)[response]).toBe(resolved.s.turn);
      expect(nextReply(resolved)).not.toBe(response);
      if (entrustsProp) expect(resolved.s.items[item].holder).toBe("vale");
      else expect(resolved.s.actors[resident].trust.vale).toBe(2);
      expect(claimsIn(record, resolved.s).map(({ claim }) => claim)).toEqual([
        `${scene}-first-answer`,
        response,
      ]);
      resolved.act("read", { item: record });
      const saved = decodeSave(encodeSave(resolved.s));
      expect(
        saved.knowledge.known.vale[`claim:${PACK}:${record}:${response}`],
      ).toMatchObject({
        book: record,
        kind: "read",
      });
    },
  );

  it("opens the Megarian's stall and its Bread supply with the market agreement", () => {
    expect(canGo(market, STALL)).toBe(false);
    expect(canSupply(market, PUBLIC_SUPPLY)).toBe(false);
    expect(canSupply(market, PRIVATE_SUPPLY)).toBe(false);
    const publicMarket = traveler(market)
      .talk(DICAEOPOLIS)
      .take(SEAL)
      .give(SEAL, MEGARIAN);
    expect(canGo(publicMarket.s, STALL)).toBe(true);
    expect(canSupply(publicMarket.s, PRIVATE_SUPPLY)).toBe(false);
    publicMarket.move(STALL);
    const { action } = cardPlay(publicMarket.s, [STALL]);
    expect(action).toMatchObject({
      kind: "choose",
      target: STALL,
      label: "Set out Bread",
      choiceId: PUBLIC_SUPPLY,
    });
    const supplied = play(publicMarket.s, action, publicMarket.s.revision);
    expect(supplied.ok, supplied.error).toBe(true);
    publicMarket.s = supplied.state;
    expect(receipts(publicMarket.s)[PUBLIC_SUPPLY]).toBe(publicMarket.s.turn);
    expect(publicMarket.s.items[BREAD].holder).toBe(STALL);
    publicMarket.take(BREAD).move(MARKET);
    expect(publicMarket.s.items[BREAD].holder).toBe("vale");

    publicMarket.take(SEAL).give(SEAL, DICAEOPOLIS);
    expect(publicMarket.s.packs[PACK].choices[OUTCOME]).toBe("second");
    expect(
      receipts(publicMarket.s)[
        "greek-story-aristophanes-acharnians-first-answer"
      ],
    ).toBeUndefined();
  });

  it("keeps the stall closed and lets the household supply Bread after a private sale", () => {
    const privateMarket = traveler(market)
      .talk(DICAEOPOLIS)
      .take(SEAL)
      .give(SEAL, DICAEOPOLIS);
    expect(canGo(privateMarket.s, STALL)).toBe(false);
    expect(canSupply(privateMarket.s, PUBLIC_SUPPLY)).toBe(false);
    privateMarket.act("choose", { choiceId: PRIVATE_SUPPLY });
    expect(receipts(privateMarket.s)[PRIVATE_SUPPLY]).toBe(
      privateMarket.s.turn,
    );
    expect(privateMarket.s.items[BREAD].holder).toBe(MARKET);
    privateMarket.take(BREAD);
    expect(privateMarket.s.items[BREAD].holder).toBe("vale");
  });
});
